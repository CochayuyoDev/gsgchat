/**
 * El que trabaja el lote: a quien le toca, que se le manda y que pasa despues.
 *
 * Tres reglas gobiernan esto, y las tres estan para lo mismo -que el numero
 * siga vivo manana-:
 *
 *  1. De uno en uno y despacio. Entre mensaje y mensaje pasan entre quince y
 *     treinta segundos, elegidos al azar dentro de ese rango. Doscientos
 *     mensajes identicos en un minuto es el patron exacto que WhatsApp busca
 *     para bloquear una cuenta.
 *  2. En horario. Fuera de la franja del negocio no sale nada: un mensaje
 *     comercial a las tres de la manana se responde con "reportar".
 *  3. Con final. Tres intentos y el caso pasa a una persona. Insistir mas no
 *     consigue ubicaciones, consigue bloqueos.
 *
 * Lo que este fichero NO hace es leer las respuestas: de eso se encarga
 * `inbound.ts`, porque una respuesta llega cuando llega y no cuando al motor
 * le toca mirar.
 */

import type { ServicioStickers } from '../stickers/stickers.js';
import type { Config } from '../config.js';
import type { Repos } from '../db/repos.js';
import type { Solicitud } from '../db/rutas.js';
import type { Sender, SendOutcome } from '../outbound/sender.js';
import type { Monitor } from '../salud/monitor.js';
import type { Politica } from '../salud/politica.js';
import { decidirRitmo } from '../salud/ritmo.js';
import { esNumeroDePrueba } from '../desarrollador/numeros.js';
import { esLoteDePrueba } from './alertas.js';
import { elegirPlantilla, elegirVariante } from '../salud/variantes.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import { ajustesPorDefecto, aplicarAjustes, rellenarTexto, type AjustesRutas } from './ajustes.js';
import { INCIDENCIAS, incidenciaDeErrorDeEnvio, type CodigoIncidencia } from './incidencias.js';
import { despacharReportes, payloadIncidencia, payloadResumen, payloadUbicacionDelPedido, type PuertoGsg } from './gsg.js';
import { diaEnZona, resolverPorUbicacion, ubicacionYaRegistrada } from '../entregas/ubicacion-unica.js';
import {
  DESCRIPCION_PASO,
  PLANTILLAS,
  textoDerivacion,
  textoLibre,
  type ContextoMensaje,
  type PasoUbicacion,
} from './mensajes.js';

export interface OpcionesMotor {
  /** Pausa entre envios, en segundos: se sortea entre los dos. */
  pausaMinSegundos: number;
  pausaMaxSegundos: number;
  /** Cuanto se espera una respuesta antes de volver a escribir. */
  esperaRespuestaMinutos: number;
  /** Mensajes por cliente antes de pasarlo a una persona. */
  maxIntentos: number;
  /** Franja horaria en la que se puede escribir, hora del negocio. */
  horaInicio: number;
  horaFin: number;
  timezone: string;
  /** Como se presenta el negocio al cliente. */
  negocio: string;
}

export const OPCIONES_POR_DEFECTO: OpcionesMotor = {
  pausaMinSegundos: 15,
  pausaMaxSegundos: 30,
  esperaRespuestaMinutos: 180,
  maxIntentos: 3,
  horaInicio: 9,
  horaFin: 19,
  timezone: 'America/Lima',
  negocio: 'nuestra tienda',
};

/** Las opciones del motor, sacadas de la configuracion del proceso. */
export function opcionesDesdeConfig(config: Config): OpcionesMotor {
  return {
    pausaMinSegundos: config.RUTAS_PAUSA_MIN_SEG,
    // Si alguien pone el maximo por debajo del minimo, el minimo manda: es
    // mejor ir lento de mas que sortear una pausa negativa.
    pausaMaxSegundos: Math.max(config.RUTAS_PAUSA_MIN_SEG, config.RUTAS_PAUSA_MAX_SEG),
    esperaRespuestaMinutos: config.RUTAS_ESPERA_MIN,
    maxIntentos: config.RUTAS_MAX_INTENTOS,
    horaInicio: config.RUTAS_HORA_INICIO,
    horaFin: config.RUTAS_HORA_FIN,
    timezone: config.timezone,
    negocio: config.businessName,
  };
}

export interface MotorDeps {
  repos: Repos;
  sender: Sender;
  wa?: WhatsAppClient;
  gsg: PuertoGsg;
  opciones: OpcionesMotor;
  /** Como se llama el negocio ahora (se cambia desde la pantalla). */
  nombreNegocio?: () => string;
  /**
   * El horario de entregas (Hoy → Ajustes), "HH:MM": AMPLIA el horario del
   * reparto, nunca lo recorta. Sin el, a las 20:00 el reparto dejaba de pedir
   * pines aunque GSG entregue hasta las 22:00.
   */
  horarioExtra?: () => { desde: string; hasta: string } | null;
  /** Los stickers automaticos (tras el primer mensaje, tras la despedida). Ver src/stickers. */
  stickers?: ServicioStickers;
  /**
   * Si hay que mandar plantilla en vez de texto libre.
   *
   * Con la Cloud API fuera de la ventana de 24 h no hay alternativa. Con un
   * cliente no oficial no existe tal regla y se manda el texto con boton, que
   * al cliente le resulta mucho mas facil.
   *
   * Dentro de la ventana (el cliente escribio hace menos de 24 h) tampoco se
   * usa plantilla aunque el proveedor sea Meta: desde el 1/10/2026 una
   * plantilla de utilidad dentro de la ventana se cobra sin franquicia, y el
   * texto libre con boton (mensaje de servicio) entra en los 1 000 gratis del
   * mes y ademas le da al cliente el boton de un toque.
   */
  usarPlantilla: () => boolean;
  ahora?: () => Date;
  /** Inyectable para que las pruebas no dependan del azar. */
  azar?: () => number;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
  /**
   * El monitor de salud y la politica de ritmo. Con ellos el motor:
   *  - pregunta al marcapasos antes de intentar nada (cupos, horario, tier,
   *    factor de riesgo), en vez de descubrirlo en el rechazo del sender;
   *  - alterna entre las plantillas aprobadas de cada paso y deja fuera las
   *    que Meta tenga pausadas;
   *  - estira su propia pausa segun el factor: en amarillo, el doble.
   * Opcionales para que las pruebas del motor sigan siendo pequenas.
   */
  salud?: Monitor;
  politica?: () => Politica;
  /**
   * Si el texto libre va a llevar un boton nativo de ubicacion. Con la Cloud
   * API si; con el cliente no oficial solo si WHATSAPP_NATIVE_BUTTONS esta
   * encendido (y viene apagado porque llegan rotos a una cuenta personal).
   * Sin boton, el mensaje explica el camino del clip.
   */
  conBoton?: () => boolean;
  /**
   * El primer mensaje de una solicitud que es de una entrega de GSG (ver
   * entregas → textoSolicitudUbicacion): la plantilla con producto, empresa,
   * codigo, monto... null = no es de una entrega, va la redaccion de siempre.
   * Los recordatorios siguen con sus textos cortos de siempre.
   */
  textoSolicitud?: (solicitud: Solicitud) => Promise<string | null>;
  /**
   * El seguimiento del primer mensaje de los pedidos (src/entregas/primer-mensaje.ts):
   * el reparto avisa antes y despues de mandar el primer mensaje de una
   * solicitud, y obedece cuando reintentar o que se pare.
   */
  primerMensaje?: PrimerMensajeReparto;
}

/** Ver MotorDeps.primerMensaje. */
export interface PrimerMensajeReparto {
  /** Justo antes del primer mensaje. false = no se manda ahora (otro intento en curso o espera a una persona). */
  antes(solicitud: Solicitud): Promise<boolean>;
  /** Lo que paso. `esperaMs`: cuando reintentar un fallo pasajero; `detener`: no insistir solo (incierto, permanente o tope de reintentos). */
  despues(solicitud: Solicitud, salida: SendOutcome): Promise<{ esperaMs?: number; detener?: string } | void>;
  /** Antes de enviar ya se supo que el numero no tiene WhatsApp. */
  sinWhatsApp(solicitud: Solicitud, detalle: string): Promise<void>;
}

export interface ResultadoTick {
  /** Que se hizo: nada, un envio, una derivacion. */
  accion: 'nada' | 'envio' | 'derivacion' | 'incidencia';
  solicitudId?: number;
  paso?: PasoUbicacion;
  /** Por que no se hizo nada. */
  motivo?: string;
  /** Lotes que se dieron por terminados en esta pasada. */
  lotesCerrados?: string[];
  /**
   * Era un numero del Modulo desarrollador: no marco el ritmo del numero real,
   * asi que el ticker puede seguir con el siguiente en la misma pasada.
   */
  dePrueba?: boolean;
}

/** La hora del negocio, no la del servidor. */
export function horaLocal(fecha: Date, timezone: string): number {
  try {
    const formato = new Intl.DateTimeFormat('es-PE', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    return Number(formato.format(fecha)) % 24;
  } catch {
    // Zona horaria mal escrita: mejor la del servidor que reventar el motor.
    return fecha.getHours();
  }
}

export function enHorario(fecha: Date, opciones: OpcionesMotor): boolean {
  const hora = horaLocal(fecha, opciones.timezone);
  return hora >= opciones.horaInicio && hora < opciones.horaFin;
}

/** El paso que le toca a una solicitud, o null si ya no le toca ninguno. */
export function pasoDe(solicitud: Solicitud, opciones: OpcionesMotor): PasoUbicacion | 'derivar' | null {
  if (solicitud.intentos >= opciones.maxIntentos) return 'derivar';
  if (solicitud.estado === 'pendiente') return 'solicitud';
  if (solicitud.estado === 'respondio') return 'insistencia';
  if (solicitud.estado === 'enviado') return 'recordatorio';
  return null;
}

export interface Motor {
  tick(): Promise<ResultadoTick>;
  /** Cuando podra salir el proximo mensaje, para ensenarlo en pantalla. */
  proximoEnvioEn(): number;
}

export function crearMotor(deps: MotorDeps): Motor {
  const ahora = deps.ahora ?? (() => new Date());
  const azar = deps.azar ?? Math.random;
  const { repos, sender, gsg } = deps;

  /**
   * Las opciones vigentes: las de la configuracion con los ajustes que se
   * guardaron desde la pantalla por encima. Se refrescan en cada tick, asi
   * que cambiar la espera o el horario no obliga a reiniciar.
   */
  let ajustes: AjustesRutas = ajustesPorDefecto(deps.opciones);
  let opciones: OpcionesMotor = deps.opciones;

  async function refrescarAjustes(): Promise<void> {
    try {
      ajustes = await repos.rutas.ajustes.get(ajustesPorDefecto(deps.opciones));
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
      // Sin ajustes legibles se sigue con los de la configuracion: el
      // reparto no se para por una fila corrupta en settings.
      deps.log?.('no se pudieron leer los ajustes de rutas', { detalle: String(error) });
    }
  }

  /** Cuando se mando el ultimo mensaje, para respetar la pausa. */
  let ultimoEnvio = 0;
  /** La pausa sorteada para el siguiente: cambia en cada envio. */
  let pausaActual = opciones.pausaMinSegundos * 1000;

  function sortearPausa(): number {
    const min = Math.max(1, opciones.pausaMinSegundos);
    const max = Math.max(min, opciones.pausaMaxSegundos);
    return Math.round((min + azar() * (max - min)) * 1000);
  }

  /**
   * El texto de un paso cuando se escribe libre: las redacciones guardadas
   * desde la pantalla si las hay, o las de siempre.
   */
  function textoDelPaso(paso: PasoUbicacion, ctx: ContextoMensaje, clave: string): string {
    const propias = ajustes.textos[paso];
    if (propias.length) return rellenarTexto(elegirVariante(propias, clave), ctx);
    return textoLibre(paso, ctx, clave);
  }

  /**
   * Las variables de una plantilla, en su orden.
   *
   * Las del catalogo tienen su orden propio. Para una plantilla propia el
   * orden es fijo y esta escrito en la pantalla: {{1}} nombre, {{2}} pedido,
   * {{3}} negocio; se pasan tantas como la plantilla tenga.
   */
  function variablesPara(nombre: string, paso: PasoUbicacion, ctx: ContextoMensaje, cuantas: number): string[] {
    if (PLANTILLAS[paso].variantes.includes(nombre)) return PLANTILLAS[paso].variables(ctx);
    const nombreCliente = (ctx.nombre ?? '').trim().split(/\s+/)[0] || 'buenas tardes';
    const pedido = (ctx.referencia ?? '').trim() || 'su pedido';
    return [nombreCliente, pedido, ctx.negocio].slice(0, Math.max(0, cuantas));
  }

  /** La pausa vigente, estirada por el factor de riesgo (0.5 = el doble). */
  function pausaEfectiva(): number {
    const factor = deps.salud?.factor() ?? 1;
    return pausaActual / Math.max(factor, 0.05);
  }

  /**
   * La plantilla que toca para este paso: entre las variantes aprobadas y
   * no pausadas, la de mejor calidad y menos usada en 24 h. Si no hay
   * ninguna valida, la principal, para que el rechazo del sender diga por que.
   */
  async function plantillaPara(paso: PasoUbicacion, momento: Date): Promise<{ name: string; language: string; variables: number }> {
    const def = PLANTILLAS[paso];
    // Las que se eligieron desde la pantalla mandan sobre las del catalogo.
    const nombres = ajustes.plantillas[paso].length ? ajustes.plantillas[paso] : def.variantes;
    const todas = await repos.templates.list();
    const candidatas = todas.filter((t) => nombres.includes(t.name));
    if (!candidatas.length) return { name: nombres[0] ?? def.name, language: def.language, variables: def.variables({ negocio: '' }).length };

    const desde = new Date(momento.getTime() - 24 * 60 * 60 * 1000);
    const uso24h: Record<string, number> = {};
    for (const t of candidatas) uso24h[t.name] = await repos.deliveries.contarPlantillaDesde(t.name, desde);

    const politica = deps.politica?.();
    const eleccion = elegirPlantilla(candidatas, {
      ahora: momento,
      uso24h,
      plantillaNuevaDias: politica?.plantillaNuevaDias ?? 0,
      plantillaNuevaPorDia: politica?.plantillaNuevaPorDia ?? 0,
    });
    if (eleccion.plantilla) {
      return { name: eleccion.plantilla.name, language: eleccion.plantilla.language, variables: eleccion.plantilla.variables };
    }
    const primera = candidatas[0]!;
    return { name: primera.name, language: primera.language, variables: primera.variables };
  }

  const contexto = (solicitud: Solicitud): ContextoMensaje => ({
    nombre: solicitud.nombre,
    negocio: opciones.negocio,
    referencia: solicitud.referencia,
    direccion: solicitud.direccion,
    distrito: solicitud.distrito,
    // Sin boton nativo, el texto explica el clip en vez de un boton que no existe.
    conBoton: deps.conBoton?.() ?? false,
  });

  /** Marca la incidencia, la apunta en la bitacora y la encola para GSG. */
  async function anotarIncidencia(
    solicitud: Solicitud,
    codigo: CodigoIncidencia,
    detalle: string,
    estado: 'incidencia' | 'supervision' | 'derivado' = 'incidencia',
  ): Promise<void> {
    const ficha = INCIDENCIAS[codigo];
    const actualizada = await repos.rutas.actualizarSolicitud(solicitud.id, {
      estado,
      incidencia: codigo,
      incidenciaDetalle: detalle,
      requiereHumano: ficha.requiereHumano,
      proximoIntentoAt: null,
    });

    await repos.rutas.registrarEvento(solicitud.id, 'incidencia', `${ficha.titulo}: ${detalle}`, {
      codigo,
      estado,
    });

    if (ficha.reportable) {
      const lote = await repos.rutas.lote(solicitud.loteId);
      if (lote) {
        await repos.rutas.encolarReporte({
          solicitudId: solicitud.id,
          loteId: lote.id,
          tipo: 'incidencia',
          payload: payloadIncidencia(actualizada, lote),
        });
      }
    }

    deps.log?.('incidencia en una solicitud de ubicacion', {
      solicitud: solicitud.id,
      telefono: solicitud.phone,
      codigo,
      detalle,
    });
  }

  /** Pasa el caso a una persona: se acabaron los intentos del bot. */
  async function derivar(solicitud: Solicitud): Promise<ResultadoTick> {
    const respondio = Boolean(solicitud.primeraRespuestaAt);
    const codigo: CodigoIncidencia = respondio ? 'respondio_sin_ubicacion' : 'sin_respuesta';
    const detalle = respondio
      ? `contestó pero no envió ubicación después de ${solicitud.intentos} mensajes`
      : `no contestó a ${solicitud.intentos} mensajes`;

    await anotarIncidencia(solicitud, codigo, detalle, 'derivado');
    await repos.rutas.registrarEvento(
      solicitud.id,
      'derivacion',
      'Pendiente de atención: tres intentos sin ubicación',
    );

    // Avisar al cliente solo si se puede escribir gratis y si alguna vez
    // contesto: a quien ignoro tres mensajes, un cuarto solo le suma motivos
    // para bloquear; y con plantilla, gastar una en despedirse no aporta.


    return { accion: 'derivacion', solicitudId: solicitud.id };
  }

  /** Manda el mensaje del paso y deja la solicitud como corresponda. */
  async function enviarPaso(solicitud: Solicitud, paso: PasoUbicacion): Promise<ResultadoTick> {
    const phone = solicitud.phone!;
    const ctx = contexto(solicitud);

    // Antes del primer mensaje, preguntar si ese numero tiene WhatsApp. Solo
    // lo saben los clientes no oficiales; con Meta devuelve null y se sigue.
    // Un numero de prueba no existe en WhatsApp y no sale nunca: ni se pregunta.
    if (solicitud.intentos === 0 && deps.wa?.tieneWhatsApp && !esNumeroDePrueba(phone)) {
      const tiene = await deps.wa.tieneWhatsApp(phone).catch(() => null);
      if (tiene === false) {
        await anotarIncidencia(
          solicitud,
          'sin_whatsapp',
          `el número ${phone} no tiene una cuenta de WhatsApp`,
        );
        if (paso === 'solicitud') await deps.primerMensaje?.sinWhatsApp(solicitud, `el número ${phone} no tiene una cuenta de WhatsApp`).catch((error: unknown) => deps.log?.('no se pudo anotar el primer mensaje', { detalle: String(error) }));
        // Que lo sepa el resto del sistema: una campana o una secuencia no
        // tienen por que volver a descubrirlo a base de intentos fallidos.
        await repos.contacts
          .suprimir(phone, new Date(ahora().getTime() + 30 * 24 * 60 * 60 * 1000), 'el numero no tiene WhatsApp (consulta al proveedor)', 'todo')
          .catch(() => undefined);
        return { accion: 'incidencia', solicitudId: solicitud.id };
      }
    }

    // Con la ventana de 24 h abierta, texto con boton aunque el proveedor
    // pida plantilla: es servicio (con franquicia) y no utilidad (sin ella).
    const contacto = await repos.contacts.getByPhone(phone).catch(() => null);
    const ventanaAbierta = Boolean(contacto?.lastInboundAt && ahora().getTime() - contacto.lastInboundAt.getTime() < 24 * 60 * 60 * 1000);
    const conPlantilla = deps.usarPlantilla() && !ventanaAbierta;
    const elegida = conPlantilla ? await plantillaPara(paso, ahora()) : null;
    // La primera solicitud de una entrega de GSG: la plantilla con los datos del envio.
    const deEntrega = !conPlantilla && paso === 'solicitud' && deps.textoSolicitud ? await deps.textoSolicitud(solicitud).catch(() => null) : null;
    // La cadencia por cliente la fija el reparto (espera e intentos), no la
    // politica general: ver `SendJob.limitesContacto`.
    const limitesContacto = {
      separacionMs: Math.min(opciones.esperaRespuestaMinutos * 60_000, 60_000),
      maxPorDia: opciones.maxIntentos + 1,
    };
    // El primer mensaje de un pedido: queda «enviando» en la base antes de
    // salir. Si otro intento ya esta en marcha (otro proceso, un reintento
    // manual) o el pedido espera a una persona, no se manda.
    const esPrimero = paso === 'solicitud' && Boolean(deps.primerMensaje);
    if (esPrimero && !(await deps.primerMensaje!.antes(solicitud))) {
      await repos.rutas.actualizarSolicitud(solicitud.id, { proximoIntentoAt: new Date(ahora().getTime() + 2 * 60_000) });
      return { accion: 'nada', solicitudId: solicitud.id, motivo: 'el primer mensaje de ese pedido ya está en curso o espera a una persona' };
    }
    const salida = conPlantilla
      ? await sender.send({
          phone,
          kind: 'template',
          category: 'UTILITY',
          templateName: elegida!.name,
          templateLanguage: elegida!.language,
          variables: variablesPara(elegida!.name, paso, ctx, elegida!.variables),
          limitesContacto,
        })
      : await sender.send({
          phone,
          kind: 'interactive',
          category: 'UTILITY',
          // La redaccion que le toca a este cliente en este intento.
          interactive: { body: deEntrega || textoDelPaso(paso, ctx, `${phone}:${solicitud.intentos}`), locationRequest: true },
          limitesContacto,
        });

    const momento = ahora();
    const decision = esPrimero
      ? ((await deps.primerMensaje!.despues(solicitud, salida).catch((error: unknown) => {
          deps.log?.('no se pudo anotar el resultado del primer mensaje', { detalle: String(error) });
        })) ?? {})
      : {};

    if (salida.ok) {
      // Lo de prueba no marca el ritmo del numero real (ver src/desarrollador).
      if (!esNumeroDePrueba(phone)) {
        ultimoEnvio = momento.getTime();
        pausaActual = sortearPausa();
      }

      await repos.rutas.actualizarSolicitud(solicitud.id, {
        estado: solicitud.estado === 'respondio' ? 'respondio' : 'enviado',
        intentos: solicitud.intentos + 1,
        ultimoEnvioAt: momento,
        proximoIntentoAt: new Date(momento.getTime() + opciones.esperaRespuestaMinutos * 60_000),
        // Un envio que sale bien deja atras cualquier incidencia de envio
        // anterior: si antes fallo y ahora salio, ya no hay nada que reportar.
        incidencia: null,
        incidenciaDetalle: null,
      });
      await repos.rutas.registrarEvento(solicitud.id, 'envio', DESCRIPCION_PASO[paso], {
        paso,
        wamid: salida.wamid,
        via: conPlantilla ? `plantilla ${elegida!.name}` : ventanaAbierta && deps.usarPlantilla() ? 'texto con boton de ubicacion (ventana abierta: servicio, no plantilla)' : 'texto con boton de ubicacion',
      });
      if (paso === 'solicitud' && deps.stickers) await deps.stickers.automatico('inicio', phone, { reparto: true });

      return { accion: 'envio', solicitudId: solicitud.id, paso };
    }

    if (salida.blocked) {
      // Sin socket no se toca la solicitud: no es una incidencia del cliente
      // ni del numero, es que WhatsApp esta cerrado. Se vuelve a intentar en
      // dos minutos y el motor no vuelve a mirar hasta entonces.
      if (salida.code === 'sin_conexion') {
        await repos.rutas.actualizarSolicitud(solicitud.id, {
          proximoIntentoAt: new Date(momento.getTime() + (salida.retryAfterMs ?? 2 * 60_000)),
        });
        return { accion: 'nada', solicitudId: solicitud.id, motivo: salida.reason };
      }
      // El monitor aparto a este contacto porque Meta dijo que no tiene
      // WhatsApp: es una incidencia con nombre, no una espera de un mes.
      if (salida.code === 'contact_suppressed' && /131026|no tiene whatsapp/i.test(salida.reason)) {
        await anotarIncidencia(solicitud, 'sin_whatsapp', salida.reason.slice(0, 300));
        return { accion: 'incidencia', solicitudId: solicitud.id };
      }
      // Una guarda que no se va a abrir sola (baja del cliente, modo prueba,
      // sin plantilla) con el primer mensaje de un pedido: a la bandeja.
      if (decision.detener) {
        await anotarIncidencia(solicitud, 'envio_bloqueado', decision.detener.slice(0, 300));
        return { accion: 'incidencia', solicitudId: solicitud.id, motivo: decision.detener };
      }
      // Una guarda propia (cupo, calentamiento, opt-out). No cuenta como
      // intento: el cliente no ha recibido nada.
      const espera = salida.retryAfterMs ?? 15 * 60_000;
      await repos.rutas.actualizarSolicitud(solicitud.id, {
        proximoIntentoAt: new Date(momento.getTime() + espera),
        incidencia: 'envio_bloqueado',
        incidenciaDetalle: `${salida.code}: ${salida.reason}`,
      });
      await repos.rutas.registrarEvento(
        solicitud.id,
        'incidencia',
        `envío detenido por una guarda propia: ${salida.reason}`,
        { code: salida.code },
      );
      return { accion: 'incidencia', solicitudId: solicitud.id, motivo: salida.reason };
    }

    // Error de WhatsApp. El codigo decide si es un numero imposible o un
    // tropiezo pasajero.
    const codigo = incidenciaDeErrorDeEnvio(salida.error, salida.code);
    if (codigo === 'sin_whatsapp' || codigo === 'numero_invalido') {
      await anotarIncidencia(solicitud, codigo, salida.error.slice(0, 300));
      return { accion: 'incidencia', solicitudId: solicitud.id };
    }
    // El primer mensaje de un pedido con un resultado incierto, un rechazo que
    // no se arregla insistiendo o el tope de reintentos: no se reenvia solo.
    // Queda en la bandeja de errores para que una persona decida.
    if (decision.detener) {
      await anotarIncidencia(solicitud, 'error_envio', decision.detener.slice(0, 300));
      return { accion: 'incidencia', solicitudId: solicitud.id, motivo: decision.detener };
    }

    // Un tropiezo pasajero (5xx, rate limit, socket caido a mitad) no gasta
    // un intento: el cliente no recibio nada. Se vuelve en unos minutos.
    if (salida.retryable) {
      await repos.rutas.actualizarSolicitud(solicitud.id, {
        // La espera la decide el seguimiento del primer mensaje (progresiva); si no, la de siempre.
        proximoIntentoAt: new Date(momento.getTime() + (decision.esperaMs ?? 3 * 60_000)),
        incidencia: 'error_envio',
        incidenciaDetalle: salida.error.slice(0, 300),
      });
      await repos.rutas.registrarEvento(solicitud.id, 'incidencia', `WhatsApp no pudo enviar (se reintenta): ${salida.error}`);
      // Lo de prueba no marca el ritmo del numero real (ver src/desarrollador).
      if (!esNumeroDePrueba(phone)) {
        ultimoEnvio = momento.getTime();
        pausaActual = sortearPausa();
      }
      return { accion: 'incidencia', solicitudId: solicitud.id, motivo: salida.error };
    }

    const intentos = solicitud.intentos + 1;
    await repos.rutas.actualizarSolicitud(solicitud.id, {
      intentos,
      ultimoEnvioAt: momento,
      proximoIntentoAt: new Date(momento.getTime() + opciones.esperaRespuestaMinutos * 60_000),
      incidencia: 'error_envio',
      incidenciaDetalle: salida.error.slice(0, 300),
    });
    await repos.rutas.registrarEvento(solicitud.id, 'incidencia', `WhatsApp rechazó el envío: ${salida.error}`);
    // Lo de prueba no marca el ritmo del numero real (ver src/desarrollador).
    if (!esNumeroDePrueba(phone)) {
      ultimoEnvio = momento.getTime();
      pausaActual = sortearPausa();
    }

    return { accion: 'incidencia', solicitudId: solicitud.id, motivo: salida.error };
  }

  /** Cierra los lotes que ya no tienen nada vivo y encola su resumen. */
  async function cerrarLotesTerminados(): Promise<string[]> {
    const cerrados: string[] = [];
    for (const lote of await repos.rutas.lotesActivos()) {
      const cifras = await repos.rutas.cifrasPorEstado(lote.id);
      const vivos =
        (cifras.pendiente ?? 0) + (cifras.enviado ?? 0) + (cifras.respondio ?? 0);
      if (vivos > 0) continue;

      await repos.rutas.cambiarEstadoLote(lote.id, 'terminado');
      // El cierre de un lote de prueba no es asunto de GSG.
      if (await esLoteDePrueba(repos, lote.id)) {
        cerrados.push(lote.id);
        continue;
      }
      await repos.rutas.encolarReporte({
        loteId: lote.id,
        tipo: 'resumen',
        payload: payloadResumen(lote, cifras, await repos.rutas.cifrasPorIncidencia(lote.id)),
      });
      cerrados.push(lote.id);
      deps.log?.('lote terminado', { lote: lote.nombre, cifras });
    }
    return cerrados;
  }

  return {
    proximoEnvioEn: () => Math.max(0, ultimoEnvio + pausaEfectiva() - Date.now()),

    async tick() {
      const momento = ahora();
      await refrescarAjustes();

      if (!enHorario(momento, opciones)) {
        return {
          accion: 'nada',
          motivo: `fuera del horario de envio (${opciones.horaInicio}:00 a ${opciones.horaFin}:00)`,
        };
      }

      let [siguiente] = await repos.rutas.tocaIntentar(momento, 1);
      // Numeros del dia: una persona detuvo los mensajes automaticos a ese
      // numero. No se le escribe; se aparta unos minutos para que no tape la
      // cola y se vuelve a mirar (al reanudarlo sale en cuanto le toque).
      const pausado = async (phone: string | null): Promise<boolean> =>
        Boolean(phone) && typeof repos.entregas?.pausadoPorTelefono === 'function' && (await repos.entregas.pausadoPorTelefono(phone!).catch(() => false));
      // La red de seguridad de la «única verdad» de la ubicacion: si ese
      // telefono ya tiene hoy su ubicacion registrada en las entregas (venga
      // por donde venga), NO se le pide otra vez: la solicitud (y cualquier
      // otra abierta de ese telefono) pasa a resuelta con ese punto y el motor
      // sigue con el siguiente. Asi un recordatorio nunca le llega a quien ya
      // mando su pin, aunque algun camino se haya olvidado de cerrarla.
      const yaTieneUbicacion = async (s: Solicitud): Promise<boolean> => {
        const registrada = await ubicacionYaRegistrada(repos, s.phone, diaEnZona(momento, opciones.timezone));
        if (!registrada || registrada.lat == null || registrada.lng == null) return false;
        const cerradas = await resolverPorUbicacion(repos, s.phone!, { lat: registrada.lat, lng: registrada.lng, mapsUrl: registrada.mapsUrl, fuente: registrada.ubicacionFuente }, { ahora: momento, motivo: `ya la había mandado (pedido ${registrada.referencia})` });
        // Si era de OTRO pedido del mismo cliente (que aun no la tenia), GSG se
        // entera por aqui, como cuando el reparto la resuelve.
        for (const c of cerradas) {
          if (!c.referencia || c.referencia === registrada.referencia) continue;
          const lote = await repos.rutas.lote(c.loteId).catch(() => null);
          if (lote) await repos.rutas.encolarReporte({ solicitudId: c.id, loteId: lote.id, tipo: 'ubicacion', payload: await payloadUbicacionDelPedido(repos, c, lote) }).catch(() => undefined);
        }
        // La ubicacion sale YA hacia GSG, sin esperar a la pasada de cada minuto.
        if (cerradas.length) void despacharReportes({ rutas: repos.rutas }, gsg, 25, ['ubicacion']).catch(() => undefined);
        deps.log?.('el cliente ya tenía su ubicación registrada: no se le vuelve a pedir', { telefono: s.phone, solicitud: s.id });
        return true;
      };
      for (let vueltas = 0; siguiente && vueltas < 50; vueltas++) {
        if (await yaTieneUbicacion(siguiente)) {
          [siguiente] = await repos.rutas.tocaIntentar(momento, 1);
          continue;
        }
        if (!(await pausado(siguiente.phone))) break;
        await repos.rutas.actualizarSolicitud(siguiente.id, { proximoIntentoAt: new Date(momento.getTime() + 5 * 60_000) });
        [siguiente] = await repos.rutas.tocaIntentar(momento, 1);
      }
      if (!siguiente) {
        const lotesCerrados = await cerrarLotesTerminados();
        return { accion: 'nada', motivo: 'no hay nada pendiente', lotesCerrados };
      }
      // Un numero del Modulo desarrollador no sale por WhatsApp (el sender lo
      // simula): ni la pausa, ni el monitor, ni el marcapasos del numero real
      // tienen nada que decir, y lo suyo no los consume.
      const dePrueba = esNumeroDePrueba(siguiente.phone);

      // El ritmo. Es lo que separa "un negocio escribiendo a sus clientes" de
      // "un robot", y lo unico que de verdad evita el bloqueo del numero.
      if (!dePrueba && ultimoEnvio && momento.getTime() - ultimoEnvio < pausaEfectiva()) {
        return { accion: 'nada', motivo: 'esperando la pausa entre mensajes' };
      }

      // El monitor de salud manda sobre el ritmo propio: parado es parado.
      if (!dePrueba && deps.salud && deps.salud.factor() <= 0) {
        return { accion: 'nada', motivo: 'el monitor de salud tiene el numero parado' };
      }

      const paso = pasoDe(siguiente, opciones);
      if (paso === null) return { accion: 'nada', motivo: 'la solicitud ya no espera mensajes' };
      if (paso === 'derivar') return { ...(await derivar(siguiente)), ...(dePrueba ? { dePrueba: true } : {}) };

      // Sin telefono valido no se manda nada: eso ya se marco al cargar el
      // lote, pero mas vale no fiarse.
      if (!siguiente.phone) {
        await anotarIncidencia(siguiente, 'numero_invalido', 'la solicitud no tiene teléfono al que escribir');
        return { accion: 'incidencia', solicitudId: siguiente.id };
      }

      // El marcapasos global (cupos por minuto y hora, tier de Meta, contactos
      // nuevos) se consulta ANTES de tocar la solicitud: un "todavia no" no es
      // una incidencia y no tiene por que quedar en su bitacora.
      if (deps.salud && deps.politica && !dePrueba) {
        const contacto = await repos.contacts.upsertFromInbound(siguiente.phone);
        const decision = decidirRitmo(await deps.salud.fotoRitmo(contacto, momento), deps.politica());
        if (!decision.ok) {
          return { accion: 'nada', motivo: `${decision.codigo}: ${decision.motivo}` };
        }
      }

      const hecho = await enviarPaso(siguiente, paso);
      return dePrueba ? { ...hecho, dePrueba: true } : hecho;
    },
  };
}

/**
 * Ticker del motor. Devuelve la funcion para pararlo.
 *
 * Corre cada pocos segundos aunque la pausa entre mensajes sea mayor: asi el
 * primer envio despues de una espera sale en cuanto toca y no al final del
 * siguiente intervalo largo.
 */
export function startMotorRutas(deps: MotorDeps, intervalMs = 5_000): () => void {
  const motor = crearMotor(deps);
  let corriendo = false;

  const tick = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      // Lo de prueba no consume el ritmo: en la misma pasada se sigue con el
      // siguiente mientras sean de prueba (con tope, para no acaparar el proceso).
      for (let i = 0; i < 25; i++) {
        const r = await motor.tick();
        if (!r.dePrueba) break;
      }
    } catch (error) {
      deps.log?.('fallo el motor de rutas', {
        detalle: error instanceof Error ? error.message : String(error),
      });
    } finally {
      corriendo = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
