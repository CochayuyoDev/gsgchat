/**
 * «Etiquetar los chats de hoy»: el boton de Chats que le pone a cada
 * conversacion del dia su etiqueta (la necesidad pendiente mas reciente del
 * cliente, catalogo de src/archive/clasificar.ts) y se la manda a GSG.
 *
 * Un lote completo tiene dos fases:
 *
 * Analisis
 *  1. Se leen los mensajes de hoy (zona del negocio) de los chats que se ven
 *     en la bandeja, sin grupos.
 *  2. Se juntan por numero de WhatsApp normalizado: un mismo cliente guardado
 *     como "987654321" y como "51987654321" es UNA conversacion.
 *  3. De cada una se saca la huella (los mensajes tal cual). Si ya tenia
 *     etiqueta de hoy con la misma huella, se reutiliza: no se llama a la IA.
 *  4. Las demas se clasifican con la IA, pocas a la vez, y se guardan.
 *
 * Sincronizacion
 *  5. Cada etiqueta que GSG aun no tiene (nueva, cambiada o que fallo antes)
 *     se le manda por el numero de WhatsApp, sin tracking. Lo que GSG ya
 *     acepto con la misma huella no se vuelve a mandar.
 *
 * Todo lo que no llega a GSG queda 'fallido' con su motivo, aunque no se
 * llegara a intentar (falta la ruta, GSG rechazo la clave): asi «Reintentar»
 * (un lote de tipo reintento) recoge exactamente lo que falta, y lo manda con
 * la etiqueta ya guardada, sin volver a la IA.
 *
 * Cada lote queda apuntado (chat_etiquetas_lotes) con su estado y sus cifras,
 * y lo que pasa en el (inicio, fin, fallos de la IA, rechazos de GSG) en
 * chat_etiquetas_eventos. Clasificar no contesta nada al cliente ni toca su
 * pedido: solo apunta.
 */

import { createHash } from 'node:crypto';
import { clasificarConIA, clasificarConReglas, nombreDeEtiqueta, type IAQueCompleta } from '../archive/clasificar.js';
import type {
  AlcanceMensajes,
  ChatEtiquetasRepo,
  EstadoLote,
  EtiquetaChat,
  EventoEtiquetas,
  LoteEtiquetas,
  MensajeDelDia,
  TipoLote,
} from '../db/chat-etiquetas.js';
import { fechaDelNegocio } from '../ajustes/generales.js';
import { inicioDelDia } from '../salud/monitor.js';
import { revisarTelefono, soloDigitos } from '../rutas/telefono.js';
import { nueveDigitosGsg, type EtiquetaParaGsg, type PuertoGsg } from '../rutas/gsg.js';

/** Cuantos mensajes del dia se leen como mucho en un lote. */
export const TOPE_MENSAJES = 20_000;
/** Cuantas conversaciones se mandan a la IA a la vez. */
const A_LA_VEZ = 3;

export interface EtiquetadoDeps {
  repo: ChatEtiquetasRepo;
  /** La IA, si esta configurada. */
  ia: () => IAQueCompleta | null;
  /** El puerto hacia GSG (el vigente). Sin el, las etiquetas quedan sin mandar. */
  gsg?: () => PuertoGsg | null;
  zonaHoraria: () => string;
  nombreNegocio: () => string;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
  ahora?: () => Date;
}

/**
 * El numero con el que se juntan los mensajes: el del plan de numeracion
 * (51 + 9 digitos) si es un celular valido; si no, sus digitos tal cual
 * (numeros de otros paises o identificadores que no son un celular).
 */
export function numeroNormalizado(phone: string): string {
  const r = revisarTelefono(phone);
  if (r.ok) return r.phone;
  return soloDigitos(phone) || phone.trim();
}

/** La huella de una conversacion: cambia si entra, sale, se edita o se borra un mensaje. Los checks no cuentan. */
export function huellaDe(mensajes: Pick<MensajeDelDia, 'id' | 'direction' | 'kind' | 'body'>[]): string {
  const h = createHash('sha256');
  for (const m of mensajes) h.update(JSON.stringify([m.id, m.direction, m.kind, m.body ?? null])).update('\n');
  return h.digest('hex');
}

export interface ConversacionDelDia {
  phone: string;
  nombre: string | null;
  contactIds: string[];
  mensajes: MensajeDelDia[];
}

/** Junta los mensajes por numero normalizado, cada conversacion en orden de llegada. */
export function agruparPorNumero(mensajes: MensajeDelDia[]): ConversacionDelDia[] {
  const porNumero = new Map<string, ConversacionDelDia>();
  for (const m of mensajes) {
    const phone = numeroNormalizado(m.phone);
    let c = porNumero.get(phone);
    if (!c) porNumero.set(phone, (c = { phone, nombre: null, contactIds: [], mensajes: [] }));
    if (!c.contactIds.includes(m.contactId)) c.contactIds.push(m.contactId);
    if (!c.nombre && m.name?.trim()) c.nombre = m.name.trim();
    c.mensajes.push(m);
  }
  for (const c of porNumero.values()) c.mensajes.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  return [...porNumero.values()];
}

/**
 * Si lo que ya estaba guardado vale para esta huella. Solo se reutiliza lo
 * definitivo: lo que puso la IA, o lo que no necesito IA (sin mensajes del
 * cliente). Lo que quedo sin clasificar, o con las reglas porque la IA fallo,
 * se reintenta.
 */
export function sePuedeReutilizar(guardada: EtiquetaChat | undefined, huella: string): boolean {
  return Boolean(guardada && guardada.huella === huella && guardada.etiqueta && !guardada.motivo);
}

/** Lo que se le manda a GSG por una etiqueta guardada. El eventoId cambia solo si cambia la conversacion. */
export function etiquetaParaGsg(e: EtiquetaChat): EtiquetaParaGsg {
  return {
    telefono: e.phone,
    telefonoNacional: nueveDigitosGsg(e.phone),
    dia: e.dia,
    etiqueta: e.etiqueta!,
    etiquetaNombre: nombreDeEtiqueta(e.etiqueta!),
    origen: e.origen,
    mensajes: e.mensajes,
    clasificadoEn: e.updatedAt.toISOString(),
    eventoId: `gsgchat-etiqueta-${e.phone}-${e.dia}-${e.huella.slice(0, 12)}`,
  };
}

export interface EstadoEtiquetado {
  enCurso: boolean;
  loteId: string | null;
  tipo: TipoLote | null;
  /** El estado del lote: en_curso, completado, completado_con_errores, fallido (null = nunca hubo). */
  estado: EstadoLote | null;
  /** En que fase va (null cuando termino). */
  fase: 'analisis' | 'sincronizacion' | null;
  dia: string | null;
  /** Conversaciones de hoy (en un reintento: envios a reintentar). */
  total: number;
  /** Las que ya se miraron en el analisis (reutilizadas + clasificadas + sin clasificar). */
  hechas: number;
  reutilizadas: number;
  clasificadas: number;
  /** De las clasificadas, las que puso la IA (el resto, las reglas). */
  porIA: number;
  sinClasificar: number;
  /** true si habia mas mensajes de los que se leen en un lote. */
  recortado: boolean;
  /** El envio a GSG en este lote. */
  syncTotal: number;
  syncEnviadas: number;
  syncFallidas: number;
  /** Por que no se mando nada a GSG (sin conexion, sin ruta...), o null. */
  syncMotivo: string | null;
  empezo: string | null;
  termino: string | null;
  error: string | null;
}

const VACIO: EstadoEtiquetado = {
  enCurso: false,
  loteId: null,
  tipo: null,
  estado: null,
  fase: null,
  dia: null,
  total: 0,
  hechas: 0,
  reutilizadas: 0,
  clasificadas: 0,
  porIA: 0,
  sinClasificar: 0,
  recortado: false,
  syncTotal: 0,
  syncEnviadas: 0,
  syncFallidas: 0,
  syncMotivo: null,
  empezo: null,
  termino: null,
  error: null,
};

/** Un lote guardado, con la forma del estado (para cuando el proceso ya no lo tiene en memoria). */
export function estadoDeLote(l: LoteEtiquetas): EstadoEtiquetado {
  return {
    ...VACIO,
    enCurso: l.estado === 'en_curso',
    loteId: l.id,
    tipo: l.tipo,
    estado: l.estado,
    dia: l.dia,
    total: l.total,
    hechas: l.tipo === 'completo' ? l.reutilizadas + l.clasificadas + l.sinClasificar : 0,
    reutilizadas: l.reutilizadas,
    clasificadas: l.clasificadas,
    porIA: l.porIA,
    sinClasificar: l.sinClasificar,
    syncTotal: l.syncEnviadas + l.syncFallidas + l.syncPendientes,
    syncEnviadas: l.syncEnviadas,
    syncFallidas: l.syncFallidas,
    empezo: l.empezoAt.toISOString(),
    termino: l.terminoAt?.toISOString() ?? null,
    error: l.error,
  };
}

const NO_HAY_IA = 'Para etiquetar los chats hace falta la IA: conéctala en Avanzado → Asistente IA.';

/** Apunta un evento sin dejar que un fallo del registro tumbe el lote. */
function registrador(deps: EtiquetadoDeps, loteId: string | null) {
  return async (e: Omit<EventoEtiquetas, 'id' | 'createdAt' | 'loteId'>) => {
    try {
      await deps.repo.registrar({ ...e, loteId });
    } catch (error) {
      deps.log?.('no se pudo apuntar un evento del etiquetado', { codigo: e.codigo, detalle: error instanceof Error ? error.message : String(error) });
    }
    if (e.nivel !== 'info') deps.log?.(`etiquetado: ${e.codigo}`, { loteId, phone: e.phone, detalle: e.detalle });
  };
}
type Registrar = ReturnType<typeof registrador>;

/** El estado final de un lote segun lo que paso. */
function estadoFinal(e: EstadoEtiquetado): EstadoLote {
  return e.sinClasificar || e.syncFallidas || e.syncMotivo ? 'completado_con_errores' : 'completado';
}

/**
 * La fase de envio: manda a GSG las etiquetas del dia en esos estados, de una
 * en una. Lo que no sale queda 'fallido' con el motivo (sin contar intento si
 * ni se intento). Nunca vuelve a la IA.
 */
async function sincronizar(
  deps: EtiquetadoDeps,
  dia: string,
  filas: EtiquetaChat[],
  estado: EstadoEtiquetado,
  registrar: Registrar,
  alAvanzar: (e: EstadoEtiquetado) => void,
): Promise<void> {
  estado.fase = 'sincronizacion';
  estado.syncTotal = filas.length;
  alAvanzar({ ...estado });
  if (!filas.length) return;

  const puerto = deps.gsg?.() ?? null;
  // Sin a donde mandar: todas quedan fallidas con el motivo, sin gastar intento.
  const sinDestino = !puerto || !puerto.enviarEtiqueta ? 'GSG no está conectado: conecta GSG en Conexión con GSG y reintenta los envíos.' : null;
  const apartar = async (resto: EtiquetaChat[], motivo: string) => {
    for (const f of resto) {
      await deps.repo.marcarSync(f.phone, dia, { estado: 'fallido', error: motivo, contarIntento: false });
      estado.syncFallidas++;
    }
    estado.syncMotivo = motivo;
    alAvanzar({ ...estado });
  };
  if (sinDestino) {
    await registrar({ phone: null, fase: 'sincronizacion', nivel: 'error', codigo: 'gsg_sin_conexion', detalle: `${sinDestino} (${filas.length} sin enviar)` });
    await apartar(filas, sinDestino);
    return;
  }

  for (let i = 0; i < filas.length; i++) {
    const f = filas[i]!;
    const r = await puerto!.enviarEtiqueta!(etiquetaParaGsg(f));
    if (r.ok) {
      await deps.repo.marcarSync(f.phone, dia, { estado: 'enviado', error: null, huella: f.huella });
      estado.syncEnviadas++;
      await registrar({ phone: f.phone, fase: 'sincronizacion', nivel: 'info', codigo: 'gsg_enviada', detalle: `${f.etiqueta}${r.id ? ` (id de GSG ${r.id})` : ''}` });
      alAvanzar({ ...estado });
      continue;
    }
    const error = r.error ?? 'GSG no aceptó la etiqueta.';
    if (r.configuracion) {
      // Falta la ruta o la clave: no se intento ninguna. Todas fallidas con el motivo.
      await registrar({ phone: null, fase: 'sincronizacion', nivel: 'error', codigo: 'gsg_sin_configurar', detalle: `${error} (${filas.length - i} sin enviar)` });
      await apartar(filas.slice(i), error);
      return;
    }
    await deps.repo.marcarSync(f.phone, dia, { estado: 'fallido', error });
    estado.syncFallidas++;
    if (r.autenticacion) {
      // La clave no vale: las de detras fallarian igual. Se apartan sin intentarlas.
      await registrar({ phone: f.phone, fase: 'sincronizacion', nivel: 'error', codigo: 'gsg_clave', detalle: error });
      const resto = filas.slice(i + 1);
      if (resto.length) await apartar(resto, `No se intentó: ${error}`);
      else estado.syncMotivo = error;
      return;
    }
    await registrar({ phone: f.phone, fase: 'sincronizacion', nivel: 'error', codigo: r.reintentable ? 'gsg_no_disponible' : 'gsg_rechazo', detalle: error });
    alAvanzar({ ...estado });
  }
}

/** Un lote completo: analisis y envio. `alAvanzar` recibe el estado cada vez que algo avanza. */
export async function etiquetarDelDia(
  deps: EtiquetadoDeps,
  alcance: AlcanceMensajes,
  alAvanzar: (estado: EstadoEtiquetado) => void = () => undefined,
  opciones: { iniciadoPor?: string | null } = {},
): Promise<EstadoEtiquetado> {
  const ia = deps.ia();
  if (!ia) throw new Error(NO_HAY_IA);
  const ahora = deps.ahora?.() ?? new Date();
  const zona = deps.zonaHoraria();
  const dia = fechaDelNegocio(ahora, zona);
  const lote = await deps.repo.crearLote({ dia, tipo: 'completo', iniciadoPor: opciones.iniciadoPor ?? null });
  const registrar = registrador(deps, lote.id);
  const estado: EstadoEtiquetado = { ...VACIO, enCurso: true, loteId: lote.id, tipo: 'completo', estado: 'en_curso', fase: 'analisis', dia, empezo: ahora.toISOString() };
  alAvanzar({ ...estado });
  await registrar({ phone: null, fase: 'lote', nivel: 'info', codigo: 'lote_inicio', detalle: `Etiquetado completo del ${dia}${opciones.iniciadoPor ? ` (lo pidió ${opciones.iniciadoPor})` : ''}.` });

  try {
    const negocio = deps.nombreNegocio();
    const mensajes = await deps.repo.mensajesDelDia(inicioDelDia(ahora, zona), alcance, TOPE_MENSAJES);
    const conversaciones = agruparPorNumero(mensajes);
    const ya = new Map((await deps.repo.delDia(dia, conversaciones.map((c) => c.phone))).map((e) => [e.phone, e]));
    estado.total = conversaciones.length;
    estado.recortado = mensajes.length >= TOPE_MENSAJES;
    if (estado.recortado) await registrar({ phone: null, fase: 'analisis', nivel: 'aviso', codigo: 'mensajes_recortados', detalle: `Hoy hay ${TOPE_MENSAJES} mensajes o más: solo se miraron los primeros.` });

    const pendientes: ConversacionDelDia[] = [];
    for (const c of conversaciones) {
      if (sePuedeReutilizar(ya.get(c.phone), huellaDe(c.mensajes))) {
        estado.reutilizadas++;
        estado.hechas++;
      } else pendientes.push(c);
    }
    alAvanzar({ ...estado });

    const una = async (c: ConversacionDelDia) => {
      const huella = huellaDe(c.mensajes);
      const base = { phone: c.phone, dia, huella, mensajes: c.mensajes.length, loteId: lote.id };
      try {
        if (!c.mensajes.some((m) => m.direction === 'in')) {
          // El cliente no escribio hoy: no hay necesidad que leer, y no se gasta IA.
          await deps.repo.guardar({ ...base, etiqueta: clasificarConReglas(c.mensajes) ?? 'otro', origen: 'reglas', motivo: null });
          estado.clasificadas++;
        } else {
          const r = await clasificarConIA(ia, c.mensajes, c.nombre, negocio);
          if (r.estado === 'clasificada') {
            await deps.repo.guardar({ ...base, etiqueta: r.etiqueta, origen: r.origen, motivo: r.origen === 'ia' ? null : 'la IA falló: puesta por las reglas' });
            estado.clasificadas++;
            if (r.origen === 'ia') estado.porIA++;
            else await registrar({ phone: c.phone, fase: 'analisis', nivel: 'aviso', codigo: 'ia_fallo_reglas', detalle: `La IA no pudo clasificar; las reglas pusieron ${r.etiqueta}.` });
          } else {
            await deps.repo.guardar({ ...base, etiqueta: null, origen: 'ia', motivo: r.motivo });
            estado.sinClasificar++;
            await registrar({ phone: c.phone, fase: 'analisis', nivel: 'error', codigo: 'ia_fallo', detalle: r.motivo });
          }
        }
      } catch (error) {
        estado.sinClasificar++;
        await registrar({ phone: c.phone, fase: 'analisis', nivel: 'error', codigo: 'guardar_fallo', detalle: error instanceof Error ? error.message : String(error) });
      }
      estado.hechas++;
      alAvanzar({ ...estado });
    };

    // Pocas a la vez: es la misma IA que contesta a los clientes.
    let siguiente = 0;
    await Promise.all(
      Array.from({ length: Math.min(A_LA_VEZ, pendientes.length) }, async () => {
        while (siguiente < pendientes.length) await una(pendientes[siguiente++]!);
      }),
    );
    await deps.repo.actualizarLote(lote.id, { total: estado.total, reutilizadas: estado.reutilizadas, clasificadas: estado.clasificadas, porIA: estado.porIA, sinClasificar: estado.sinClasificar });

    // Lo que GSG aun no tiene: nuevo, cambiado, o que fallo en un lote anterior.
    await sincronizar(deps, dia, await deps.repo.porSincronizar(dia, ['pendiente', 'fallido']), estado, registrar, alAvanzar);
  } catch (error) {
    return terminar(deps, estado, registrar, alAvanzar, error);
  }
  return terminar(deps, estado, registrar, alAvanzar);
}

/**
 * Reintenta SOLO los envios a GSG que fallaron ese dia, con la etiqueta ya
 * guardada: no lee mensajes ni llama a la IA. null si no hay nada que reintentar.
 */
export async function reintentarEnvios(
  deps: EtiquetadoDeps,
  alAvanzar: (estado: EstadoEtiquetado) => void = () => undefined,
  opciones: { dia?: string; iniciadoPor?: string | null } = {},
): Promise<EstadoEtiquetado | null> {
  const ahora = deps.ahora?.() ?? new Date();
  const dia = opciones.dia ?? fechaDelNegocio(ahora, deps.zonaHoraria());
  const fallidas = await deps.repo.porSincronizar(dia, ['fallido']);
  if (!fallidas.length) return null;
  const lote = await deps.repo.crearLote({ dia, tipo: 'reintento', iniciadoPor: opciones.iniciadoPor ?? null });
  const registrar = registrador(deps, lote.id);
  const estado: EstadoEtiquetado = { ...VACIO, enCurso: true, loteId: lote.id, tipo: 'reintento', estado: 'en_curso', dia, total: fallidas.length, empezo: ahora.toISOString() };
  await deps.repo.actualizarLote(lote.id, { total: fallidas.length });
  await registrar({ phone: null, fase: 'lote', nivel: 'info', codigo: 'lote_inicio', detalle: `Reintento de ${fallidas.length} envío(s) fallido(s) a GSG del ${dia}, sin volver a la IA${opciones.iniciadoPor ? ` (lo pidió ${opciones.iniciadoPor})` : ''}.` });
  try {
    await sincronizar(deps, dia, fallidas, estado, registrar, alAvanzar);
  } catch (error) {
    return terminar(deps, estado, registrar, alAvanzar, error);
  }
  return terminar(deps, estado, registrar, alAvanzar);
}

/** Cierra el lote: estado final, cifras en la base y el evento de fin. */
async function terminar(
  deps: EtiquetadoDeps,
  estado: EstadoEtiquetado,
  registrar: Registrar,
  alAvanzar: (e: EstadoEtiquetado) => void,
  error?: unknown,
): Promise<EstadoEtiquetado> {
  const detalleError = error === undefined ? null : error instanceof Error ? error.message : String(error);
  const final: EstadoEtiquetado = {
    ...estado,
    enCurso: false,
    fase: null,
    estado: detalleError ? 'fallido' : estadoFinal(estado),
    error: detalleError,
    termino: (deps.ahora?.() ?? new Date()).toISOString(),
  };
  if (estado.loteId) {
    try {
      await deps.repo.actualizarLote(estado.loteId, {
        estado: final.estado!,
        total: final.total,
        reutilizadas: final.reutilizadas,
        clasificadas: final.clasificadas,
        porIA: final.porIA,
        sinClasificar: final.sinClasificar,
        syncEnviadas: final.syncEnviadas,
        syncFallidas: final.syncFallidas,
        syncPendientes: Math.max(0, final.syncTotal - final.syncEnviadas - final.syncFallidas),
        error: detalleError ?? final.syncMotivo,
        terminoAt: new Date(final.termino!),
      });
    } catch (e) {
      deps.log?.('no se pudo cerrar el lote del etiquetado', { loteId: estado.loteId, detalle: e instanceof Error ? e.message : String(e) });
    }
  }
  await registrar({
    phone: null,
    fase: 'lote',
    nivel: final.estado === 'completado' ? 'info' : final.estado === 'fallido' ? 'error' : 'aviso',
    codigo: final.estado === 'fallido' ? 'lote_fallido' : 'lote_fin',
    detalle:
      detalleError ??
      `${final.estado}: ${final.tipo === 'completo' ? `${final.total} conversación(es), ${final.reutilizadas} reutilizada(s), ${final.clasificadas} clasificada(s), ${final.sinClasificar} sin clasificar; ` : ''}` +
        `GSG ${final.syncEnviadas} enviada(s), ${final.syncFallidas} fallida(s) de ${final.syncTotal}.`,
  });
  alAvanzar(final);
  return final;
}

/**
 * Los lotes en segundo plano, uno a la vez (completo o reintento): pulsar
 * mientras ya corre uno devuelve el que esta en marcha en vez de empezar otro.
 */
export function crearEtiquetador(deps: EtiquetadoDeps) {
  let estado: EstadoEtiquetado | null = null;
  let enMarcha: Promise<EstadoEtiquetado | null> | null = null;
  // Un lote que quedo 'en_curso' es de un proceso que se apago a mitad.
  const colgados = deps.repo.cerrarLotesColgados('El servidor se reinició con el lote a mitad: vuelve a etiquetar o reintenta los envíos.').catch(() => 0);

  const lanzar = (trabajo: (alAvanzar: (e: EstadoEtiquetado) => void) => Promise<EstadoEtiquetado | null>, inicial: EstadoEtiquetado) => {
    estado = inicial;
    enMarcha = colgados
      .then(() => trabajo((e) => (estado = e)))
      .catch((error) => {
        estado = { ...(estado ?? VACIO), enCurso: false, estado: 'fallido', fase: null, termino: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
        deps.log?.('el etiquetado de chats falló', { detalle: estado.error });
        return estado;
      })
      .finally(() => (enMarcha = null));
  };

  return {
    /** Lo del lote en marcha o el ultimo de este proceso; si no hay, el ultimo guardado. */
    async estado(): Promise<EstadoEtiquetado> {
      if (estado) return { ...estado };
      await colgados;
      const [ultimo] = await deps.repo.lotes(1);
      return ultimo ? estadoDeLote(ultimo) : { ...VACIO };
    },
    hayIA: (): boolean => Boolean(deps.ia()),
    enCurso: (): boolean => Boolean(enMarcha),
    /** Empieza un lote completo (o devuelve el que corre). Lanza si no hay IA. */
    iniciar(alcance: AlcanceMensajes, opciones: { iniciadoPor?: string | null } = {}): EstadoEtiquetado {
      if (enMarcha && estado) return { ...estado };
      if (!deps.ia()) throw new Error(NO_HAY_IA);
      lanzar((alAvanzar) => etiquetarDelDia(deps, alcance, alAvanzar, opciones), { ...VACIO, enCurso: true, tipo: 'completo', estado: 'en_curso', fase: 'analisis', empezo: (deps.ahora?.() ?? new Date()).toISOString() });
      return { ...estado! };
    },
    /**
     * Reintenta solo los envios fallidos de ese dia (por defecto hoy). Devuelve
     * el estado del reintento, el del lote en marcha si ya corre uno, o null si
     * no hay ningun envio fallido.
     */
    async reintentar(opciones: { dia?: string; iniciadoPor?: string | null } = {}): Promise<EstadoEtiquetado | null> {
      if (enMarcha && estado) return { ...estado };
      const dia = opciones.dia ?? fechaDelNegocio(deps.ahora?.() ?? new Date(), deps.zonaHoraria());
      if (!(await deps.repo.porSincronizar(dia, ['fallido'])).length) return null;
      if (enMarcha && estado) return { ...estado };
      lanzar((alAvanzar) => reintentarEnvios(deps, alAvanzar, { ...opciones, dia }), { ...VACIO, enCurso: true, tipo: 'reintento', estado: 'en_curso', fase: 'sincronizacion', dia, empezo: (deps.ahora?.() ?? new Date()).toISOString() });
      return { ...estado! };
    },
    /** Para las pruebas: espera al lote en marcha. */
    esperar: (): Promise<EstadoEtiquetado | null> => enMarcha ?? Promise.resolve(null),
  };
}
export type Etiquetador = ReturnType<typeof crearEtiquetador>;
