/**
 * El que escribe a la lista de envio automatico: a quien le toca, que se le
 * manda y que pasa despues.
 *
 * Es hermano del motor del reparto y sigue sus mismas reglas, porque el
 * numero es uno solo y WhatsApp lo mira entero:
 *
 *  1. Un mensaje a cada numero cada pocas horas (el ajuste "cada cuantas
 *     horas", el mismo del reparto). Es lo que hace que parezca una persona
 *     escribiendo y no un robot, y lo que evita llegar al cupo del dia: con
 *     veinte numeros y un mensaje cada tres horas salen sesenta mensajes en
 *     toda la jornada, no sesenta en un minuto.
 *  2. Entre un numero y el siguiente, la pausa sorteada del reparto y el
 *     marcapasos general (cupos por minuto y hora, factor de riesgo).
 *  3. En horario. Fuera de la franja no sale nada.
 *  4. Con final. Agotados los mensajes, sale de la lista y se avisa a quien
 *     supervisa. Insistir mas no consigue nada: consigue bloqueos.
 *
 * Lo que este fichero NO hace es leer las respuestas: de eso se ocupa
 * `servicio.alRecibir`, desde el manejador de entrantes.
 */

import type { Repos } from '../db/repos.js';
import { esNumeroDePrueba } from '../desarrollador/numeros.js';
import type { Sender } from '../outbound/sender.js';
import type { Monitor } from '../salud/monitor.js';
import type { Politica } from '../salud/politica.js';
import { decidirRitmo } from '../salud/ritmo.js';
import { elegirVariante } from '../salud/variantes.js';
import { aplicarAjustes, rellenarTexto, type AjustesRutas } from '../rutas/ajustes.js';
import { enHorario, type OpcionesMotor } from '../rutas/motor.js';
import { PLANTILLAS, textoLibre, type ContextoMensaje, type PasoUbicacion } from '../rutas/mensajes.js';
import { incidenciaDeErrorDeEnvio } from '../rutas/incidencias.js';
import type { Entrada } from './repo.js';
import { diaEnZona, ubicacionYaRegistrada } from '../entregas/ubicacion-unica.js';
import type { ServicioEnvioAutomatico } from './servicio.js';

export interface MotorListaDeps {
  repos: Repos;
  lista: ServicioEnvioAutomatico;
  sender: Sender;
  opciones: OpcionesMotor;
  nombreNegocio?: () => string;
  /** Con la API de Meta, plantilla; con el cliente no oficial, texto libre. */
  usarPlantilla: () => boolean;
  conBoton?: () => boolean;
  /** A quien se avisa cuando un numero agota sus mensajes. Vacio = a nadie. */
  supervisor?: () => string;
  salud?: Monitor;
  politica?: () => Politica;
  ahora?: () => Date;
  azar?: () => number;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
  /**
   * Otra franja que amplia la del reparto: el horario de entregas de la
   * pantalla (Hoy → Ajustes). Con GSG entregando hasta las 22:00, pedir la
   * ubicacion solo de 9 a 19 dejaba a los de la tarde para el dia siguiente.
   */
  horarioExtra?: () => { desde: string; hasta: string } | null;
}

export interface ResultadoTickLista {
  accion: 'nada' | 'envio' | 'salida' | 'fallo';
  entradaId?: number;
  motivo?: string;
}

export interface MotorLista {
  tick(): Promise<ResultadoTickLista>;
  proximoEnvioEn(): number;
}

/** Que paso le toca a una entrada de ubicacion: como en el reparto. */
export function pasoDeEntrada(e: Entrada): PasoUbicacion {
  if (e.enviados === 0) return 'solicitud';
  const contesto = Boolean(e.respondioAt && (!e.ultimoEnvioAt || e.respondioAt.getTime() >= e.ultimoEnvioAt.getTime()));
  return contesto ? 'insistencia' : 'recordatorio';
}

/** Lo que se le dice al supervisor cuando un numero agota sus mensajes. */
export function textoAvisoAgotado(e: Entrada, max: number): string {
  const quien = e.nombre ? `${e.nombre} (${e.phone})` : e.phone;
  const que = e.que === 'ubicacion' ? 'no mandó su ubicación' : 'no contestó';
  return `${quien} ${que} después de ${max} mensaje${max === 1 ? '' : 's'} de la lista de envío automático: ya no se le escribe solo. Si hace falta, llámalo.`;
}

export function crearMotorLista(deps: MotorListaDeps): MotorLista {
  const { repos, lista, sender } = deps;
  const ahora = deps.ahora ?? (() => new Date());
  const azar = deps.azar ?? Math.random;
  const log = deps.log ?? (() => undefined);

  let ajustes: AjustesRutas | null = null;
  let opciones: OpcionesMotor = deps.opciones;
  let ultimoEnvio = 0;
  let pausaActual = opciones.pausaMinSegundos * 1000;

  function sortearPausa(): number {
    const min = Math.max(1, opciones.pausaMinSegundos);
    const max = Math.max(min, opciones.pausaMaxSegundos);
    return Math.round((min + azar() * (max - min)) * 1000);
  }

  function pausaEfectiva(): number {
    const factor = deps.salud?.factor() ?? 1;
    return pausaActual / Math.max(factor, 0.05);
  }

  async function refrescar(): Promise<void> {
    try {
      ajustes = await lista.ajustesReparto();
      opciones = aplicarAjustes(deps.opciones, ajustes);
      if (deps.nombreNegocio) opciones = { ...opciones, negocio: deps.nombreNegocio() };
      const extra = deps.horarioExtra?.();
      if (extra) {
        const desde = Number(extra.desde.slice(0, 2));
        const hasta = Number(extra.hasta.slice(0, 2)) + (Number(extra.hasta.slice(3, 5)) > 0 ? 1 : 0);
        if (Number.isFinite(desde) && Number.isFinite(hasta)) {
          opciones = { ...opciones, horaInicio: Math.min(opciones.horaInicio, Math.max(0, desde)), horaFin: Math.max(opciones.horaFin, Math.min(24, hasta)) };
        }
      }
    } catch (error) {
      log('no se pudieron leer los ajustes para la lista de envio automatico', { detalle: String(error) });
    }
  }

  function contexto(e: Entrada): ContextoMensaje {
    return {
      nombre: e.nombre,
      negocio: opciones.negocio,
      referencia: e.referencia,
      conBoton: deps.conBoton?.() ?? false,
    };
  }

  /** El texto que se manda: el propio de la entrada, el de los ajustes, o el de siempre. */
  function textoPara(e: Entrada, paso: PasoUbicacion): string {
    const ctx = contexto(e);
    const clave = `${e.phone}:${e.enviados}`;
    if (e.que === 'mensaje') return rellenarTexto(e.texto ?? '', ctx);
    if (e.texto) return rellenarTexto(e.texto, ctx);
    const propias = ajustes?.textos[paso] ?? [];
    if (propias.length) return rellenarTexto(elegirVariante(propias, clave), ctx);
    return textoLibre(paso, ctx, clave);
  }

  async function avisarSupervisor(texto: string): Promise<void> {
    const destino = deps.supervisor?.();
    if (!destino) return;
    await sender.send({ phone: destino, kind: 'freeform', category: 'UTILITY', text: texto, manual: true }).catch(() => undefined);
  }

  async function enviar(e: Entrada): Promise<ResultadoTickLista> {
    const momento = ahora();
    const paso = pasoDeEntrada(e);
    const limitesContacto = {
      separacionMs: Math.min(opciones.esperaRespuestaMinutos * 60_000, 60_000),
      maxPorDia: opciones.maxIntentos + 1,
    };

    let salida;
    if (e.que === 'ubicacion' && deps.usarPlantilla()) {
      const def = PLANTILLAS[paso];
      salida = await sender.send({
        phone: e.phone,
        kind: 'template',
        category: 'UTILITY',
        templateName: def.name,
        templateLanguage: def.language,
        variables: def.variables(contexto(e)),
        limitesContacto,
      });
    } else if (e.que === 'ubicacion') {
      salida = await sender.send({
        phone: e.phone,
        kind: 'interactive',
        category: 'UTILITY',
        interactive: { body: textoPara(e, paso), locationRequest: true },
        limitesContacto,
      });
    } else {
      salida = await sender.send({
        phone: e.phone,
        kind: 'freeform',
        category: 'UTILITY',
        text: textoPara(e, paso),
        limitesContacto,
      });
    }

    if (salida.ok) {
      // Lo de prueba no marca el ritmo del numero real (ver src/desarrollador).
      if (!esNumeroDePrueba(e.phone)) {
        ultimoEnvio = momento.getTime();
        pausaActual = sortearPausa();
      }
      const proximo = new Date(momento.getTime() + opciones.esperaRespuestaMinutos * 60_000);
      const despues = await lista.anotarEnvio(e, { ok: true, proximoEnvioAt: proximo });
      log('mensaje de la lista de envio automatico', { telefono: e.phone, paso: e.que === 'ubicacion' ? paso : 'mensaje', enviados: e.enviados + 1 });
      return { accion: 'envio', entradaId: e.id, motivo: despues ? undefined : 'completó sus envíos y salió de la lista' };
    }

    if (salida.blocked) {
      if (salida.code === 'sin_conexion') {
        await lista.anotarEnvio(e, { ok: false, motivo: 'WhatsApp no está conectado: se reintenta en dos minutos', proximoEnvioAt: new Date(momento.getTime() + (salida.retryAfterMs ?? 2 * 60_000)) });
        return { accion: 'nada', entradaId: e.id, motivo: salida.reason };
      }
      if (salida.code === 'opt_out') {
        await lista.anotarEnvio(e, { ok: false, motivo: 'se dio de baja: no se le escribe más', proximoEnvioAt: null, definitivo: true });
        return { accion: 'salida', entradaId: e.id, motivo: salida.reason };
      }
      if (salida.code === 'contact_suppressed' && /131026|no tiene whatsapp/i.test(salida.reason)) {
        await lista.anotarEnvio(e, { ok: false, motivo: 'el número no tiene WhatsApp', proximoEnvioAt: null, definitivo: true });
        return { accion: 'salida', entradaId: e.id, motivo: salida.reason };
      }
      const espera = salida.retryAfterMs ?? 15 * 60_000;
      await lista.anotarEnvio(e, { ok: false, motivo: `envío detenido por una guarda propia (${salida.code}): ${salida.reason}`, proximoEnvioAt: new Date(momento.getTime() + espera) });
      return { accion: 'fallo', entradaId: e.id, motivo: salida.reason };
    }

    const codigo = incidenciaDeErrorDeEnvio(salida.error, salida.code);
    if (codigo === 'sin_whatsapp' || codigo === 'numero_invalido') {
      await lista.anotarEnvio(e, { ok: false, motivo: codigo === 'sin_whatsapp' ? 'el número no tiene WhatsApp' : 'el número no es válido', proximoEnvioAt: null, definitivo: true });
      return { accion: 'salida', entradaId: e.id, motivo: salida.error };
    }
    // Lo de prueba no marca el ritmo del numero real (ver src/desarrollador).
    if (!esNumeroDePrueba(e.phone)) {
      ultimoEnvio = momento.getTime();
      pausaActual = sortearPausa();
    }
    await lista.anotarEnvio(e, {
      ok: false,
      motivo: `WhatsApp no pudo enviar (${salida.retryable ? 'se reintenta' : 'rechazado'}): ${salida.error.slice(0, 200)}`,
      proximoEnvioAt: new Date(momento.getTime() + (salida.retryable ? 3 : opciones.esperaRespuestaMinutos) * 60_000),
    });
    return { accion: 'fallo', entradaId: e.id, motivo: salida.error };
  }

  return {
    proximoEnvioEn: () => Math.max(0, ultimoEnvio + pausaEfectiva() - Date.now()),

    async tick() {
      const momento = ahora();
      await refrescar();
      if (!ajustes) return { accion: 'nada', motivo: 'sin ajustes' };

      if (!enHorario(momento, opciones)) {
        return { accion: 'nada', motivo: `fuera del horario de envío (${opciones.horaInicio}:00 a ${opciones.horaFin}:00)` };
      }
      if (ultimoEnvio && momento.getTime() - ultimoEnvio < pausaEfectiva()) {
        return { accion: 'nada', motivo: 'esperando la pausa entre mensajes' };
      }
      if (deps.salud && deps.salud.factor() <= 0) {
        return { accion: 'nada', motivo: 'el monitor de salud tiene el número parado' };
      }

      // Se miran unos cuantos: el primero puede estar en manos de una
      // persona (bot pausado) y no por eso el resto tiene que esperar.
      const candidatos = await repos.envioAutomatico.tocaEnviar(momento, 5);
      for (const e of candidatos) {
        const max = lista.maxEnviosDe(e, ajustes);
        if (e.enviados >= max) {
          // Se esperaron sus horas tras el ultimo mensaje y no llego lo que
          // se buscaba: se acabo, y que lo sepa una persona.
          await lista.quitar(e.id, { origen: 'sistema' }, e.que === 'ubicacion' ? `no mandó su ubicación después de ${max} mensaje${max === 1 ? '' : 's'}` : `no contestó después de ${max} mensaje${max === 1 ? '' : 's'}`);
          // De un numero de prueba no se molesta al supervisor real.
          if (!esNumeroDePrueba(e.phone)) await avisarSupervisor(textoAvisoAgotado(e, max));
          return { accion: 'salida', entradaId: e.id, motivo: 'agotó los mensajes' };
        }

        // La «única verdad» de la ubicacion: si hoy ya la registro (en las
        // entregas, venga por donde venga), no se le vuelve a pedir: sale.
        if (e.que === 'ubicacion' || e.hasta === 'ubicacion') {
          const registrada = await ubicacionYaRegistrada(repos, e.phone, diaEnZona(momento, opciones.timezone));
          if (registrada) {
            await lista.quitar(e.id, { origen: 'sistema' }, `ya mandó su ubicación (pedido ${registrada.referencia}): no se le vuelve a pedir`);
            return { accion: 'salida', entradaId: e.id, motivo: 'ya tenía su ubicación registrada' };
          }
        }
        const contacto = await repos.contacts.upsertFromInbound(e.phone, e.nombre ?? undefined);
        if (contacto.optOutAt) {
          await lista.quitar(e.id, { origen: 'sistema' }, 'se dio de baja: no se le escribe más');
          return { accion: 'salida', entradaId: e.id, motivo: 'baja' };
        }
        // Contesto desde el ultimo envio y era eso lo que se buscaba (por si
        // el entrante no paso por el manejador: reinicio, historial...).
        if (e.hasta === 'respuesta' && e.ultimoEnvioAt && contacto.lastInboundAt && contacto.lastInboundAt.getTime() > e.ultimoEnvioAt.getTime()) {
          await lista.quitar(e.id, { origen: 'sistema' }, 'contestó');
          return { accion: 'salida', entradaId: e.id, motivo: 'contestó' };
        }
        // "De este me encargo yo": mientras una persona atiende ese chat, el
        // sistema calla. Se vuelve a mirar en media hora.
        if (contacto.botPausadoAt) {
          await repos.envioAutomatico.actualizar(e.id, { proximoEnvioAt: new Date(momento.getTime() + 30 * 60_000) });
          continue;
        }

        // Un numero de prueba no sale por WhatsApp: el marcapasos del real no aplica.
        if (deps.salud && deps.politica && !esNumeroDePrueba(e.phone)) {
          const decision = decidirRitmo(await deps.salud.fotoRitmo(contacto, momento), deps.politica());
          if (!decision.ok) return { accion: 'nada', motivo: `${decision.codigo}: ${decision.motivo}` };
        }
        return enviar(e);
      }
      return { accion: 'nada', motivo: candidatos.length ? 'los que tocaban están en manos de una persona' : 'no hay nada pendiente' };
    },
  };
}

/** Ticker del motor; devuelve la funcion para pararlo. */
export function startMotorLista(deps: MotorListaDeps, intervalMs = 5_000): () => void {
  const motor = crearMotorLista(deps);
  let corriendo = false;
  const tick = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      await motor.tick();
    } catch (error) {
      deps.log?.('fallo el motor de la lista de envio automatico', { detalle: error instanceof Error ? error.message : String(error) });
    } finally {
      corriendo = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
