/**
 * La lista de envio automatico: quien entra, quien sale y por que.
 *
 * La regla de la casa es que el sistema no le escribe solo a nadie que no
 * este en esta lista (o en un lote del reparto, que es la otra forma de
 * darle numeros). Entrar en la lista es dar permiso; salir es que ya no hace
 * falta: se consiguio lo que se buscaba (la ubicacion, una respuesta), se
 * agotaron los intentos, el cliente se dio de baja o alguien lo quito.
 *
 * Los numeros entran de cuatro maneras y todas pasan por aqui:
 *
 *  - a mano, desde la pantalla (`origen: manual`);
 *  - por el asistente de IA en el chat: cuando le pide la ubicacion a un
 *    cliente, lo apunta para insistirle si no la manda (`origen: ia`);
 *  - por el ayudante del panel, cuando el dueño se lo dice con palabras
 *    (`origen: ayudante`);
 *  - por la API publica (`origen: api`).
 *
 * Con el reparto no se duplica nada: sus clientes ya estan en sus lotes y la
 * pantalla los ensena juntos. Si un numero de esta lista aparece en un lote,
 * el reparto se lo queda (`alCargarLote`); si a un numero le esta escribiendo
 * el reparto, aqui no se admite.
 */

import type { Contact, Repos } from '../db/repos.js';
import { ajustesPorDefecto, aplicarAjustes, type AjustesRutas } from '../rutas/ajustes.js';
import type { OpcionesMotor } from '../rutas/motor.js';
import { enHorario } from '../rutas/motor.js';
import { revisarTelefono, type PlanNumeracion } from '../rutas/telefono.js';
import type { Monitor } from '../salud/monitor.js';
import type { SolicitudConLote, EventoReciente } from '../db/rutas.js';
import type { Entrada, EnvioAutomaticoRepo, Hasta, Movimiento, OrigenEntrada, QueEnviar } from './repo.js';

export interface AltaEnLista {
  telefono: string;
  nombre?: string | null;
  que?: QueEnviar;
  texto?: string | null;
  hasta?: Hasta;
  referencia?: string | null;
  maxEnvios?: number | null;
  origen: OrigenEntrada;
  /** Quien exactamente: el usuario, "el asistente en el chat con Maria"... */
  origenDetalle?: string | null;
  /** El primer mensaje ya salio por otro camino (el asistente en el chat). */
  yaEnviado?: boolean;
}

export type ResultadoAlta =
  | { ok: true; entrada: Entrada; nueva: boolean }
  | { ok: false; codigo: 'telefono' | 'baja' | 'en_reparto' | 'texto' | 'grupo'; motivo: string };

export interface Quien {
  origen: OrigenEntrada | 'reparto' | 'sistema';
  detalle?: string | null;
}

/** Como se ve cada numero en la pantalla, venga de la lista o del reparto. */
export interface FilaLista {
  /** `e:<id>` para una entrada propia, `s:<id>` para una solicitud del reparto. */
  clave: string;
  phone: string;
  nombre: string | null;
  que: QueEnviar;
  texto: string | null;
  hasta: Hasta;
  referencia: string | null;
  origen: OrigenEntrada | 'reparto';
  origenDetalle: string | null;
  enviados: number;
  maxEnvios: number;
  respondio: boolean;
  pausado: boolean;
  ultimoEnvioAt: Date | null;
  proximoEnvioAt: Date | null;
  /** Lo que esta pasando con el, en cristiano. */
  situacion: string;
  lote?: { id: string; nombre: string; estado: string };
}

export interface MovimientoVisto {
  at: Date;
  phone: string;
  nombre: string | null;
  tipo: string;
  texto: string;
  origen: string | null;
}

export interface AjustesLista {
  cadaHoras: number;
  maxEnvios: number;
  horaInicio: number;
  horaFin: number;
  timezone: string;
}

export interface ResumenLista {
  ajustes: AjustesLista;
  cifras: {
    enLista: number;
    propios: number;
    reparto: number;
    pausados: number;
    hoyEnviados: number;
    /** Lo que puede llegar a salir hoy por la lista, con este ritmo. */
    hoyComoMucho: number;
    /** El cupo de hoy del numero y lo que ya se uso (todo lo iniciado por la empresa). */
    cupoHoy: number | null;
    cupoUsado: number | null;
  };
  numeros: FilaLista[];
  movimientos: MovimientoVisto[];
  motor: { enHorario: boolean; parado: string | null };
}

export interface ServicioEnvioAutomatico {
  agregar(alta: AltaEnLista): Promise<ResultadoAlta>;
  /** Por telefono o por id; devuelve null si no estaba. */
  quitar(quien: string | number, por: Quien, motivo?: string): Promise<Entrada | null>;
  pausar(quien: string | number, por: Quien): Promise<Entrada | null>;
  reanudar(quien: string | number, por: Quien): Promise<Entrada | null>;
  /** Cambia lo que se manda o el tope, sin sacarlo de la lista. */
  editar(quien: string | number, patch: { nombre?: string | null; que?: QueEnviar; texto?: string | null; hasta?: Hasta; maxEnvios?: number | null; referencia?: string | null }): Promise<Entrada | null>;
  porTelefono(telefono: string): Promise<Entrada | null>;
  /** Un mensaje del cliente: si era lo que se buscaba, sale de la lista. */
  alRecibir(contact: Pick<Contact, 'phone' | 'name'>, entrada: { ubicacion?: boolean; fueraDeZona?: boolean }): Promise<void>;
  /** Un lote del reparto se queda con este numero: la lista lo suelta. */
  alCargarLote(phone: string, lote: { id: string; nombre: string }): Promise<void>;
  /** Todo lo que ensena la pantalla. */
  resumen(): Promise<ResumenLista>;
  ajustes(): Promise<AjustesLista>;
  guardarAjustes(patch: Partial<Pick<AjustesLista, 'cadaHoras' | 'maxEnvios' | 'horaInicio' | 'horaFin'>>): Promise<AjustesLista>;
  /** La lista contada en una linea por numero, para el prompt de la IA. */
  descripcionParaIA(): Promise<string>;
  /** Anota que salio un mensaje / fallo, y aplica el tope. Lo usa el motor. */
  anotarEnvio(entrada: Entrada, resultado: { ok: true; proximoEnvioAt: Date } | { ok: false; motivo: string; proximoEnvioAt: Date | null; definitivo?: boolean }): Promise<Entrada | null>;
  /** El maximo de envios que aplica a una entrada. */
  maxEnviosDe(entrada: Entrada, ajustes: AjustesRutas): number;
  /** Los ajustes del reparto vigentes (misma cadencia para todo lo automatico). */
  ajustesReparto(): Promise<AjustesRutas>;
}

export interface DepsServicio {
  repos: Repos;
  /** Las opciones del reparto desde la configuracion: de ahi salen los valores por defecto. */
  opcionesReparto: OpcionesMotor;
  plan: PlanNumeracion;
  salud?: Monitor;
  ahora?: () => Date;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
}

/** Cuantos mensajes puede recibir un numero hoy, con este ritmo y este horario. */
export function enviosPosiblesHoy(ajustes: Pick<AjustesLista, 'cadaHoras' | 'horaInicio' | 'horaFin'>): number {
  const ventana = Math.max(0, ajustes.horaFin - ajustes.horaInicio);
  return Math.max(1, Math.floor(ventana / Math.max(ajustes.cadaHoras, 0.25)) + 1);
}

export function crearServicioEnvioAutomatico(deps: DepsServicio): ServicioEnvioAutomatico {
  const { repos } = deps;
  const repo: EnvioAutomaticoRepo = repos.envioAutomatico;
  const ahora = deps.ahora ?? (() => new Date());
  const log = deps.log ?? (() => undefined);

  const quienEs = (por: Quien): string => (por.detalle ? `${por.origen}: ${por.detalle}` : por.origen);

  async function ajustesReparto(): Promise<AjustesRutas> {
    return repos.rutas.ajustes.get(ajustesPorDefecto(deps.opcionesReparto));
  }

  async function ajustes(): Promise<AjustesLista> {
    const a = aplicarAjustes(deps.opcionesReparto, await ajustesReparto());
    return {
      cadaHoras: Math.round((a.esperaRespuestaMinutos / 60) * 100) / 100,
      maxEnvios: a.maxIntentos,
      horaInicio: a.horaInicio,
      horaFin: a.horaFin,
      timezone: a.timezone,
    };
  }

  function maxEnviosDe(entrada: Entrada, a: AjustesRutas): number {
    return Math.max(1, entrada.maxEnvios ?? a.maxIntentos);
  }

  async function buscar(quien: string | number): Promise<Entrada | null> {
    if (typeof quien === 'number') return repo.porId(quien);
    const digitos = quien.replace(/\D+/g, '');
    if (!digitos) return null;
    const directa = await repo.porTelefono(digitos);
    if (directa) return directa;
    // Escrito sin el pais o con espacios: se revisa como un telefono del lote.
    const revision = revisarTelefono(quien, deps.plan);
    return revision.ok ? repo.porTelefono(revision.phone) : null;
  }

  async function salir(entrada: Entrada, motivo: string, por: Quien): Promise<Entrada | null> {
    const quitada = await repo.quitar(entrada.id);
    if (!quitada) return null;
    await repo.anotarMovimiento({ phone: entrada.phone, nombre: entrada.nombre, tipo: 'salio', motivo, origen: quienEs(por), at: ahora() });
    log('sale de la lista de envio automatico', { telefono: entrada.phone, motivo, por: quienEs(por) });
    return quitada;
  }

  /** Lo que el reparto esta haciendo con cada solicitud viva, en una frase. */
  function situacionDeSolicitud(s: SolicitudConLote, a: AjustesRutas): string {
    if (s.lote.estado === 'pausado') return 'el lote está pausado: no se le escribe hasta reanudarlo';
    if (s.lote.estado === 'preparado') return 'el lote todavía no arrancó';
    if (s.intentos >= a.maxIntentos) return 'agotó los mensajes: pasa a una persona en el siguiente turno';
    if (s.estado === 'pendiente') return 'esperando turno para el primer mensaje';
    if (s.estado === 'respondio') return 'contestó sin ubicación: se le vuelve a pedir';
    return 'esperando su ubicación';
  }

  function situacionDeEntrada(e: Entrada, a: AjustesRutas, contacto?: Contact | null): string {
    if (e.estado === 'pausado') return 'en pausa: no se le escribe hasta reanudarlo';
    if (contacto?.botPausadoAt) return 'una persona atiende ese chat: se espera a que lo suelte';
    const max = maxEnviosDe(e, a);
    if (e.enviados >= max) return e.hasta === 'envios' ? 'ya se mandaron todos' : 'agotó los mensajes: sale en el siguiente turno';
    if (e.enviados === 0) return 'esperando turno para el primer mensaje';
    if (e.que === 'ubicacion') return e.respondioAt ? 'contestó sin ubicación: se le vuelve a pedir' : 'esperando su ubicación';
    if (e.hasta === 'respuesta') return 'esperando que conteste';
    return `van ${e.enviados} de ${max}`;
  }

  const QUE_TEXTO: Record<QueEnviar, string> = { ubicacion: 'pedirle su ubicación', mensaje: 'mandarle un mensaje' };
  const HASTA_TEXTO: Record<Hasta, string> = { ubicacion: 'hasta que mande su ubicación', respuesta: 'hasta que conteste', envios: 'hasta completar los envíos' };

  return {
    ajustesReparto,
    ajustes,
    maxEnviosDe,

    async agregar(alta) {
      const revision = revisarTelefono(alta.telefono, deps.plan);
      if (!revision.ok) return { ok: false, codigo: 'telefono', motivo: `Ese número no sirve: ${revision.detalle}.` };
      const phone = revision.phone;
      const que: QueEnviar = alta.que ?? 'ubicacion';
      const hasta: Hasta = alta.hasta ?? (que === 'ubicacion' ? 'ubicacion' : 'respuesta');
      const texto = (alta.texto ?? '').trim() || null;
      if (que === 'mensaje' && !texto) return { ok: false, codigo: 'texto', motivo: 'Para mandarle un mensaje hay que escribir cuál.' };

      const previo = await repos.contacts.getByPhone(phone);
      if (previo?.tipo === 'grupo') return { ok: false, codigo: 'grupo', motivo: 'Eso es un grupo de WhatsApp: a los grupos no se les escribe solo.' };
      if (previo?.optOutAt) {
        return { ok: false, codigo: 'baja', motivo: `${previo.name ? `${previo.name} (${phone})` : phone} se dio de baja: no se le escribe solo hasta que él responda ALTA.` };
      }
      const enReparto = await repos.rutas.abiertaPorTelefono(phone);
      if (enReparto && ['pendiente', 'enviado', 'respondio'].includes(enReparto.estado)) {
        const lote = await repos.rutas.lote(enReparto.loteId);
        return { ok: false, codigo: 'en_reparto', motivo: `A ese número ya le está escribiendo el reparto${lote ? ` (lote "${lote.nombre}")` : ''}: no hace falta ponerlo aquí.` };
      }

      // Dar el numero es dar el consentimiento: sin opt-in, las guardas no
      // dejarian salir nada iniciado por la empresa.
      const nombre = (alta.nombre ?? '').trim() || previo?.name || null;
      await repos.contacts.upsertFromInbound(phone, nombre ?? undefined);
      if (!previo?.optInAt) await repos.contacts.setOptIn(phone, `lista de envío automático (${alta.origen})`);

      const momento = ahora();
      const a = await ajustesReparto();
      const { entrada, nueva } = await repo.agregar({
        phone,
        nombre,
        que,
        texto,
        hasta,
        referencia: (alta.referencia ?? '').trim() || null,
        origen: alta.origen,
        origenDetalle: alta.origenDetalle ?? null,
        maxEnvios: alta.maxEnvios ?? null,
        enviados: alta.yaEnviado ? 1 : 0,
        ultimoEnvioAt: alta.yaEnviado ? momento : null,
        proximoEnvioAt: alta.yaEnviado ? new Date(momento.getTime() + a.esperaRespuestaMinutos * 60_000) : null,
      });
      if (nueva) {
        await repo.anotarMovimiento({
          phone,
          nombre,
          tipo: 'entro',
          motivo: `${QUE_TEXTO[que]} ${HASTA_TEXTO[hasta]}`,
          origen: quienEs({ origen: alta.origen, detalle: alta.origenDetalle }),
          at: momento,
        });
        log('entra en la lista de envio automatico', { telefono: phone, que, origen: alta.origen });
        return { ok: true, entrada, nueva: true };
      }
      // Ya estaba: si acaba de recibir un mensaje por otro camino, se
      // respeta la cadencia desde ahora; y si estaba en pausa, sigue en pausa.
      if (alta.yaEnviado) {
        const actualizada = await repo.actualizar(entrada.id, {
          enviados: entrada.enviados + 1,
          ultimoEnvioAt: momento,
          proximoEnvioAt: new Date(momento.getTime() + a.esperaRespuestaMinutos * 60_000),
        });
        return { ok: true, entrada: actualizada ?? entrada, nueva: false };
      }
      return { ok: true, entrada, nueva: false };
    },

    async quitar(quien, por, motivo) {
      const entrada = await buscar(quien);
      if (!entrada) return null;
      return salir(entrada, motivo ?? (por.origen === 'manual' ? 'lo quitaron de la lista' : `lo quitó ${por.origen === 'ayudante' ? 'el ayudante' : por.origen === 'ia' ? 'el asistente' : por.origen}`), por);
    },

    async pausar(quien, por) {
      const entrada = await buscar(quien);
      if (!entrada) return null;
      if (entrada.estado === 'pausado') return entrada;
      const actualizada = await repo.actualizar(entrada.id, { estado: 'pausado' });
      await repo.anotarMovimiento({ phone: entrada.phone, nombre: entrada.nombre, tipo: 'pausa', motivo: 'no se le escribe hasta reanudarlo', origen: quienEs(por), at: ahora() });
      return actualizada;
    },

    async reanudar(quien, por) {
      const entrada = await buscar(quien);
      if (!entrada) return null;
      if (entrada.estado === 'activo') return entrada;
      const actualizada = await repo.actualizar(entrada.id, { estado: 'activo' });
      await repo.anotarMovimiento({ phone: entrada.phone, nombre: entrada.nombre, tipo: 'reanudo', motivo: 'vuelve a estar activo', origen: quienEs(por), at: ahora() });
      return actualizada;
    },

    async editar(quien, patch) {
      const entrada = await buscar(quien);
      if (!entrada) return null;
      const que = patch.que ?? entrada.que;
      const texto = patch.texto === undefined ? entrada.texto : (patch.texto ?? '').trim() || null;
      if (que === 'mensaje' && !texto) throw new Error('Para mandarle un mensaje hay que escribir cuál.');
      const hasta = patch.hasta ?? (patch.que && patch.que !== entrada.que ? (que === 'ubicacion' ? 'ubicacion' : 'respuesta') : entrada.hasta);
      return repo.actualizar(entrada.id, {
        nombre: patch.nombre === undefined ? undefined : (patch.nombre ?? '').trim() || null,
        que,
        texto,
        hasta,
        maxEnvios: patch.maxEnvios === undefined ? undefined : patch.maxEnvios,
        referencia: patch.referencia === undefined ? undefined : (patch.referencia ?? '').trim() || null,
      });
    },

    porTelefono: (telefono) => buscar(telefono),

    async alRecibir(contact, entrada) {
      const e = await repo.porTelefono(contact.phone);
      if (!e) return;
      const nombre = e.nombre ?? contact.name ?? null;
      if (entrada.ubicacion) {
        if (e.que === 'ubicacion' || e.hasta === 'ubicacion') {
          await salir({ ...e, nombre }, entrada.fueraDeZona ? 'mandó su ubicación (fuera de la zona de cobertura)' : 'mandó su ubicación', { origen: 'sistema' });
          return;
        }
      }
      if (e.hasta === 'respuesta') {
        await salir({ ...e, nombre }, 'contestó', { origen: 'sistema' });
        return;
      }
      // Contesto algo que no es lo que se buscaba: se anota para que el
      // siguiente mensaje reconozca que contesto, y no suene a sordo.
      if (!e.respondioAt || (e.ultimoEnvioAt && e.respondioAt.getTime() < e.ultimoEnvioAt.getTime())) {
        await repo.actualizar(e.id, { respondioAt: ahora() });
      }
    },

    async alCargarLote(phone, lote) {
      const e = await repo.porTelefono(phone);
      if (!e) return;
      await salir(e, `pasó al reparto: lote "${lote.nombre}"`, { origen: 'reparto', detalle: lote.nombre });
    },

    async anotarEnvio(entrada, resultado) {
      const momento = ahora();
      if (resultado.ok) {
        const actualizada = await repo.actualizar(entrada.id, {
          enviados: entrada.enviados + 1,
          ultimoEnvioAt: momento,
          proximoEnvioAt: resultado.proximoEnvioAt,
        });
        await repo.anotarMovimiento({ phone: entrada.phone, nombre: entrada.nombre, tipo: 'envio', motivo: entrada.que === 'ubicacion' ? 'se le pidió la ubicación' : 'se le mandó el mensaje', origen: 'sistema', at: momento });
        if (!actualizada) return null;
        const a = await ajustesReparto();
        if (entrada.hasta === 'envios' && actualizada.enviados >= maxEnviosDe(actualizada, a)) {
          return salir(actualizada, `se mandaron los ${actualizada.enviados} mensajes previstos`, { origen: 'sistema' });
        }
        return actualizada;
      }
      await repo.anotarMovimiento({ phone: entrada.phone, nombre: entrada.nombre, tipo: 'fallo', motivo: resultado.motivo, origen: 'sistema', at: momento });
      if (resultado.definitivo) return salir(entrada, resultado.motivo, { origen: 'sistema' });
      return repo.actualizar(entrada.id, { proximoEnvioAt: resultado.proximoEnvioAt });
    },

    async guardarAjustes(patch) {
      const porDefecto = ajustesPorDefecto(deps.opcionesReparto);
      const cambio: Record<string, number> = {};
      if (patch.cadaHoras !== undefined) cambio.esperaRespuestaMinutos = Math.max(1, Math.round(patch.cadaHoras * 60));
      if (patch.maxEnvios !== undefined) cambio.maxIntentos = patch.maxEnvios;
      if (patch.horaInicio !== undefined) cambio.horaInicio = patch.horaInicio;
      if (patch.horaFin !== undefined) cambio.horaFin = patch.horaFin;
      await repos.rutas.ajustes.set(cambio, porDefecto);
      return ajustes();
    },

    async resumen() {
      const momento = ahora();
      const a = await ajustesReparto();
      const vigente = aplicarAjustes(deps.opcionesReparto, a);
      const [entradas, solicitudes, movimientos, eventos, cuenta] = await Promise.all([
        repo.listar(),
        repos.rutas.vivasEnLotesAbiertos(500),
        repo.movimientos(40),
        repos.rutas.eventosRecientes(40),
        repo.contar(),
      ]);

      const numeros: FilaLista[] = [];
      for (const e of entradas) {
        const contacto = await repos.contacts.getByPhone(e.phone).catch(() => null);
        numeros.push({
          clave: `e:${e.id}`,
          phone: e.phone,
          nombre: e.nombre ?? contacto?.name ?? null,
          que: e.que,
          texto: e.texto,
          hasta: e.hasta,
          referencia: e.referencia,
          origen: e.origen,
          origenDetalle: e.origenDetalle,
          enviados: e.enviados,
          maxEnvios: maxEnviosDe(e, a),
          respondio: Boolean(e.respondioAt && (!e.ultimoEnvioAt || e.respondioAt.getTime() >= e.ultimoEnvioAt.getTime())),
          pausado: e.estado === 'pausado',
          ultimoEnvioAt: e.ultimoEnvioAt,
          proximoEnvioAt: e.proximoEnvioAt,
          situacion: situacionDeEntrada(e, a, contacto),
        });
      }
      for (const s of solicitudes) {
        if (!s.phone) continue;
        numeros.push({
          clave: `s:${s.id}`,
          phone: s.phone,
          nombre: s.nombre,
          que: 'ubicacion',
          texto: null,
          hasta: 'ubicacion',
          referencia: s.referencia,
          origen: 'reparto',
          origenDetalle: `lote "${s.lote.nombre}"`,
          enviados: s.intentos,
          maxEnvios: a.maxIntentos,
          respondio: s.estado === 'respondio',
          pausado: s.lote.estado !== 'enviando',
          ultimoEnvioAt: s.ultimoEnvioAt,
          proximoEnvioAt: s.proximoIntentoAt,
          situacion: situacionDeSolicitud(s, a),
          lote: s.lote,
        });
      }

      const vistos: MovimientoVisto[] = [
        ...movimientos.map((m: Movimiento) => ({ at: m.createdAt, phone: m.phone, nombre: m.nombre, tipo: m.tipo, texto: m.motivo ?? m.tipo, origen: m.origen })),
        ...eventos
          .filter((ev: EventoReciente) => ev.phone && ['envio', 'ubicacion', 'derivacion', 'incidencia'].includes(ev.tipo))
          .map((ev: EventoReciente) => ({
            at: ev.createdAt,
            phone: ev.phone!,
            nombre: ev.nombre,
            tipo: ev.tipo === 'envio' ? 'envio' : ev.tipo === 'ubicacion' ? 'salio' : ev.tipo === 'derivacion' ? 'salio' : 'fallo',
            texto: ev.tipo === 'ubicacion' ? 'mandó su ubicación' : ev.tipo === 'derivacion' ? `pasa a una persona: ${ev.detalle ?? ''}`.trim() : ev.detalle ?? ev.tipo,
            origen: `reparto: lote "${ev.loteNombre}"`,
          })),
      ]
        .sort((x, y) => y.at.getTime() - x.at.getTime())
        .slice(0, 50);

      const inicioHoy = new Date(momento);
      inicioHoy.setHours(0, 0, 0, 0);
      const hoyEnviados = await repo.enviadosDesde(inicioHoy);
      const cadaHoras = vigente.esperaRespuestaMinutos / 60;
      const posiblesPorNumero = enviosPosiblesHoy({ cadaHoras, horaInicio: vigente.horaInicio, horaFin: vigente.horaFin });
      const activos = numeros.filter((n) => !n.pausado);
      const hoyComoMucho = activos.reduce((suma, n) => suma + Math.min(posiblesPorNumero, Math.max(0, n.maxEnvios - n.enviados)), 0);

      let cupoHoy: number | null = null;
      let cupoUsado: number | null = null;
      let parado: string | null = null;
      if (deps.salud) {
        try {
          const foto = await deps.salud.snapshot();
          cupoHoy = foto.ritmo.cupoHoy;
          cupoUsado = foto.ritmo.hoy;
          if (foto.factor <= 0) parado = `el monitor de salud tiene el número parado${foto.motivos.length ? `: ${foto.motivos[0]}` : ''}`;
        } catch {
          // Sin foto de salud la pantalla sigue: es un dato de adorno aqui.
        }
      }

      return {
        ajustes: { cadaHoras: Math.round(cadaHoras * 100) / 100, maxEnvios: vigente.maxIntentos, horaInicio: vigente.horaInicio, horaFin: vigente.horaFin, timezone: vigente.timezone },
        cifras: {
          enLista: numeros.length,
          propios: entradas.length,
          reparto: numeros.length - entradas.length,
          pausados: cuenta.pausados + numeros.filter((n) => n.origen === 'reparto' && n.pausado).length,
          hoyEnviados,
          hoyComoMucho,
          cupoHoy,
          cupoUsado,
        },
        numeros,
        movimientos: vistos,
        motor: { enHorario: enHorario(momento, vigente), parado },
      };
    },

    async descripcionParaIA() {
      const r = await this.resumen();
      if (!r.numeros.length) return 'La lista de envío automático está vacía.';
      const lineas = r.numeros.slice(0, 60).map((n) => {
        const quien = n.nombre ? `${n.nombre} (${n.phone})` : n.phone;
        const por = n.origen === 'reparto' ? `puesto por el reparto, ${n.origenDetalle}` : `puesto por ${n.origen === 'manual' ? 'una persona' : n.origen === 'ia' ? 'el asistente' : n.origen === 'ayudante' ? 'el ayudante' : 'la API'}`;
        return `- ${quien}: ${QUE_TEXTO[n.que]} ${HASTA_TEXTO[n.hasta]}; ${n.enviados} de ${n.maxEnvios} mensajes; ${n.pausado ? 'EN PAUSA' : n.situacion}; ${por}.`;
      });
      const mas = r.numeros.length > 60 ? `\n(y ${r.numeros.length - 60} más)` : '';
      return `Lista de envío automático (${r.numeros.length} números; un mensaje cada ${r.ajustes.cadaHoras} h a cada uno, de ${r.ajustes.horaInicio}:00 a ${r.ajustes.horaFin}:00, máximo ${r.ajustes.maxEnvios} mensajes por número):\n${lineas.join('\n')}${mas}`;
    },
  };
}
