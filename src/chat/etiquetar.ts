/**
 * «Etiquetar los chats de hoy»: el boton de Chats que le pone a cada
 * conversacion del dia su etiqueta (la necesidad pendiente mas reciente del
 * cliente, catalogo de src/archive/clasificar.ts): la nota automatica del chat.
 *
 * Un lote:
 *  1. Se leen los mensajes de hoy (zona del negocio) de los chats que se ven
 *     en la bandeja, sin grupos.
 *  2. Se juntan por numero de WhatsApp normalizado: un mismo cliente guardado
 *     como "987654321" y como "51987654321" es UNA conversacion.
 *  3. Se guarda la copia de los mensajes de cada una (chat_etiquetas_lote_chats)
 *     y el lote procesa ESA copia: lo que entre mientras corre no lo cambia.
 *  4. Solo se leen los chats que aun no tienen etiqueta de hoy (nuevos, o que
 *     la IA no pudo clasificar). Un chat ya etiquetado se queda con su
 *     etiqueta aunque le lleguen mensajes: no vuelve a la IA. La excepcion es
 *     una etiqueta que ya no esta en el catalogo del negocio, que ya no vale.
 *  5. Las demas van a la IA con el catalogo, pocas a la vez. La IA devuelve
 *     el codigo de una etiqueta (o `otro` si ninguna corresponde); se valida
 *     contra el catalogo. Si la IA falla o contesta algo que no vale, el chat
 *     queda como error, sin etiqueta: aqui no hay reglas que adivinen.
 *
 * GSG no recibe nada aparte: lee la etiqueta como la nota del chat en el
 * historial que ya pide al abrirlo (GET /api/v1/historial, ver
 * src/api/v1/conversaciones-gsg.ts). En cuanto se guarda, GSG la ve.
 *
 * Cada lote queda apuntado (chat_etiquetas_lotes) con su estado y sus cifras,
 * y lo que pasa en el (inicio, fin, fallos de la IA) en chat_etiquetas_eventos.
 * Clasificar no contesta nada al cliente ni toca su pedido: solo apunta.
 */

import { createHash } from 'node:crypto';
import { CATALOGO_POR_DEFECTO, clasificarConIA, firmaCatalogo, nombreDeEtiqueta, type Catalogo, type IAQueCompleta } from '../archive/clasificar.js';
import type { AlcanceMensajes, ChatEtiquetasRepo, EstadoLote, EtiquetaChat, EventoEtiquetas, LoteEtiquetas, MensajeCapturado, MensajeDelDia, TipoLote } from '../db/chat-etiquetas.js';
import { RETENCION_CHAT_MS } from '../whatsapp/retencion-chat.js';
import { fechaDelNegocio } from '../ajustes/generales.js';
import { inicioDelDia } from '../salud/monitor.js';
import { revisarTelefono, soloDigitos } from '../rutas/telefono.js';

/** Cuantos mensajes del dia se leen como mucho en un lote. */
export const TOPE_MENSAJES = 20_000;
/** Cuantas conversaciones se mandan a la IA a la vez. */
const A_LA_VEZ = 3;
/** El evento de cuando una persona cambia la etiqueta que puso la IA (ver src/chat/ejemplos-etiquetado.ts). */
export const CODIGO_CORRECCION = 'correccion_ia';

export interface EtiquetadoDeps {
  repo: ChatEtiquetasRepo;
  /** La IA, si esta configurada. */
  ia: () => IAQueCompleta | null;
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

/**
 * La huella de una conversacion: cambia si entra, sale, se edita o se borra un
 * mensaje (los checks no cuentan) y, con `catalogo`, si cambia el catalogo.
 */
export function huellaDe(mensajes: Pick<MensajeDelDia, 'id' | 'direction' | 'kind' | 'body'>[], catalogo?: string): string {
  const h = createHash('sha256');
  for (const m of mensajes) h.update(JSON.stringify([m.id, m.direction, m.kind, m.body ?? null])).update('\n');
  if (catalogo) h.update(`catalogo:${catalogo}`);
  return h.digest('hex');
}

/** Lo que se guarda de cada mensaje en la copia del lote. */
export const capturaDe = (m: MensajeDelDia): MensajeCapturado => ({ id: m.id, direction: m.direction, kind: m.kind, body: m.body, createdAt: m.createdAt.toISOString() });

/** El catalogo vigente del negocio (el de fabrica si no guardo ninguno). */
export async function catalogoVigente(repo: ChatEtiquetasRepo): Promise<Catalogo> {
  return (await repo.catalogo()) ?? CATALOGO_POR_DEFECTO;
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
 * Si un chat ya esta etiquetado y no hay que volver a leerlo: tiene etiqueta
 * de hoy, no la puso un respaldo por fallo de la IA (`motivo`) y sigue en el
 * catalogo. Lo que quedo sin clasificar se vuelve a leer. Aunque el chat haya
 * cambiado, no se relee: asi lo pidio el negocio (solo lo que falta).
 */
export function yaEtiquetado(guardada: EtiquetaChat | undefined, catalogo?: Catalogo): boolean {
  if (!guardada?.etiqueta || guardada.motivo) return false;
  return !catalogo || catalogo.some((e) => e.codigo === guardada.etiqueta);
}

/**
 * Lo de antes: reutilizar solo con la misma huella. Se conserva para quien
 * compare conversaciones; el lote usa `yaEtiquetado`.
 */
export function sePuedeReutilizar(guardada: EtiquetaChat | undefined, huella: string): boolean {
  return Boolean(guardada && guardada.huella === huella && guardada.etiqueta && !guardada.motivo);
}

export interface EstadoEtiquetado {
  enCurso: boolean;
  loteId: string | null;
  tipo: TipoLote | null;
  /** El estado del lote: en_curso, completado, completado_con_errores, fallido (null = nunca hubo). */
  estado: EstadoLote | null;
  dia: string | null;
  /** Conversaciones de hoy. */
  total: number;
  /** Las que ya se miraron (reutilizadas + clasificadas + sin clasificar). */
  hechas: number;
  reutilizadas: number;
  clasificadas: number;
  /** De las clasificadas, las que puso la IA. */
  porIA: number;
  sinClasificar: number;
  /** true si habia mas mensajes de los que se leen en un lote. */
  recortado: boolean;
  empezo: string | null;
  termino: string | null;
  error: string | null;
}

const VACIO: EstadoEtiquetado = {
  enCurso: false,
  loteId: null,
  tipo: null,
  estado: null,
  dia: null,
  total: 0,
  hechas: 0,
  reutilizadas: 0,
  clasificadas: 0,
  porIA: 0,
  sinClasificar: 0,
  recortado: false,
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
    hechas: l.reutilizadas + l.clasificadas + l.sinClasificar,
    reutilizadas: l.reutilizadas,
    clasificadas: l.clasificadas,
    porIA: l.porIA,
    sinClasificar: l.sinClasificar,
    empezo: l.empezoAt.toISOString(),
    termino: l.terminoAt?.toISOString() ?? null,
    error: l.error,
  };
}

/**
 * El etiquetado solo necesita la CLAVE de la IA, no el asistente activo: la IA
 * solo lee la conversacion y marca la etiqueta. Quien habla con el cliente es
 * el bot; que el bot conteste con IA depende de «activar el asistente», que es
 * otra cosa. Este modulo no tiene con que mandar mensajes.
 */
const NO_HAY_IA = 'Para etiquetar los chats hace falta la clave de la IA: guárdala en Avanzado → Asistente IA. No hace falta activar el asistente: la IA solo lee y etiqueta, no le contesta a nadie.';

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

type ChatDeLoteConMensajes = Awaited<ReturnType<ChatEtiquetasRepo['chatsDelLote']>>[number];

/** Un lote completo. `alAvanzar` recibe el estado cada vez que algo avanza. */
export async function etiquetarDelDia(
  deps: EtiquetadoDeps,
  alcance: AlcanceMensajes,
  alAvanzar: (estado: EstadoEtiquetado) => void = () => undefined,
  /** releer = volver a leer TODOS los chats de hoy, tambien los ya etiquetados (p. ej. tras cambiar el catalogo). */
  opciones: { iniciadoPor?: string | null; releer?: boolean } = {},
): Promise<EstadoEtiquetado> {
  const ia = deps.ia();
  if (!ia) throw new Error(NO_HAY_IA);
  const ahora = deps.ahora?.() ?? new Date();
  const zona = deps.zonaHoraria();
  const dia = fechaDelNegocio(ahora, zona);
  const lote = await deps.repo.crearLote({ dia, tipo: 'completo', iniciadoPor: opciones.iniciadoPor ?? null });
  const registrar = registrador(deps, lote.id);
  const estado: EstadoEtiquetado = { ...VACIO, enCurso: true, loteId: lote.id, tipo: 'completo', estado: 'en_curso', dia, empezo: ahora.toISOString() };
  alAvanzar({ ...estado });
  await registrar({ phone: null, fase: 'lote', nivel: 'info', codigo: 'lote_inicio', detalle: `${opciones.releer ? 'Volver a etiquetar todo' : 'Etiquetado'} del ${dia}${opciones.iniciadoPor ? ` (lo pidió ${opciones.iniciadoPor})` : ''}.` });

  try {
    const negocio = deps.nombreNegocio();
    // La copia de los mensajes no dura mas que el chat: lo que paso la retencion se vacia.
    await deps.repo.vaciarCopiasAntes(new Date(ahora.getTime() - RETENCION_CHAT_MS)).catch(() => 0);
    const catalogo = await catalogoVigente(deps.repo);
    const firma = firmaCatalogo(catalogo);
    const mensajes = await deps.repo.mensajesDelDia(inicioDelDia(ahora, zona), alcance, TOPE_MENSAJES);
    const conversaciones = agruparPorNumero(mensajes);
    estado.recortado = mensajes.length >= TOPE_MENSAJES;
    if (estado.recortado) await registrar({ phone: null, fase: 'analisis', nivel: 'aviso', codigo: 'mensajes_recortados', detalle: `Hoy hay ${TOPE_MENSAJES} mensajes o más: solo se miraron los primeros.` });

    // 1. La copia: el conjunto que procesa este lote, y nada mas.
    await deps.repo.capturar(
      lote.id,
      dia,
      conversaciones.map((c) => ({ phone: c.phone, nombre: c.nombre, huella: huellaDe(c.mensajes, firma), mensajes: c.mensajes.map(capturaDe) })),
    );
    const copia = await deps.repo.chatsDelLote(lote.id, true);
    estado.total = copia.length;
    await registrar({ phone: null, fase: 'analisis', nivel: 'info', codigo: 'lote_capturado', detalle: `${copia.length} chat(s) con ${copia.reduce((n, c) => n + c.totalMensajes, 0)} mensaje(s) copiados para este lote.` });
    const ya = new Map((await deps.repo.delDia(dia, copia.map((c) => c.phone))).map((e) => [e.phone, e]));

    // 2. Lo que ya tiene etiqueta no se vuelve a leer: solo va a la IA lo que falta.
    const pendientes: ChatDeLoteConMensajes[] = [];
    for (const c of copia) {
      const antes = ya.get(c.phone);
      // Lo que puso una persona a mano no lo pisa la IA, ni al «volver a etiquetar todo».
      if (antes?.origen === 'manual' || (!opciones.releer && yaEtiquetado(antes, catalogo))) {
        await deps.repo.marcarChatLote(lote.id, c.phone, { estado: 'reutilizada', etiqueta: antes!.etiqueta });
        estado.reutilizadas++;
        estado.hechas++;
      } else pendientes.push(c as ChatDeLoteConMensajes);
    }
    alAvanzar({ ...estado });

    // 3. Lo demas, a la IA: solo clasifica, no contesta a nadie.
    const una = async (c: ChatDeLoteConMensajes) => {
      const base = { phone: c.phone, dia, huella: c.huella, mensajes: c.totalMensajes, loteId: lote.id };
      try {
        const r = await clasificarConIA(ia, c.mensajes ?? [], c.nombre, negocio, { catalogo, conReglas: false });
        // Mientras la IA leia, una persona pudo ponerla a mano: esa manda y no se pisa.
        const mientras = (await deps.repo.delDia(dia, [c.phone]))[0];
        if (mientras?.origen === 'manual') {
          await deps.repo.marcarChatLote(lote.id, c.phone, { estado: 'reutilizada', etiqueta: mientras.etiqueta });
          estado.reutilizadas++;
        } else if (r.estado === 'clasificada') {
          await deps.repo.guardar({ ...base, etiqueta: r.etiqueta, origen: 'ia', motivo: null });
          await deps.repo.marcarChatLote(lote.id, c.phone, { estado: 'clasificada', etiqueta: r.etiqueta });
          estado.clasificadas++;
          estado.porIA++;
        } else {
          await deps.repo.guardar({ ...base, etiqueta: null, origen: 'ia', motivo: r.motivo });
          await deps.repo.marcarChatLote(lote.id, c.phone, { estado: 'error', error: r.motivo });
          estado.sinClasificar++;
          await registrar({ phone: c.phone, fase: 'analisis', nivel: 'error', codigo: 'ia_fallo', detalle: r.motivo });
        }
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        estado.sinClasificar++;
        await deps.repo.marcarChatLote(lote.id, c.phone, { estado: 'error', error: detalle }).catch(() => undefined);
        await registrar({ phone: c.phone, fase: 'analisis', nivel: 'error', codigo: 'guardar_fallo', detalle });
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
  } catch (error) {
    return terminar(deps, estado, registrar, alAvanzar, error);
  }
  return terminar(deps, estado, registrar, alAvanzar);
}

/**
 * Una persona pone (o quita, con `etiqueta: null`) la etiqueta de hoy a un
 * chat. Queda como `manual`: ningun lote de la IA la pisa. GSG la ve en el
 * historial del chat al momento. No le escribe nada al cliente.
 */
export async function etiquetarAMano(
  deps: EtiquetadoDeps,
  entrada: { phone: string; etiqueta: string | null; quien?: string | null },
): Promise<EtiquetaChat | null> {
  const phone = numeroNormalizado(entrada.phone);
  const dia = fechaDelNegocio(deps.ahora?.() ?? new Date(), deps.zonaHoraria());
  const catalogo = await catalogoVigente(deps.repo);
  const registrar = registrador(deps, null);
  const quien = entrada.quien?.trim() || 'Una persona';
  if (!entrada.etiqueta) {
    await deps.repo.quitar(phone, dia);
    await registrar({ phone, fase: 'analisis', nivel: 'info', codigo: 'etiqueta_quitada', detalle: `${quien} quitó la etiqueta.` });
    return null;
  }
  if (!catalogo.some((e) => e.codigo === entrada.etiqueta)) throw new Error('Esa etiqueta no está en el catálogo del negocio.');
  const antes = (await deps.repo.delDia(dia, [phone]))[0];
  const huella = createHash('sha256').update(`manual|${phone}|${dia}|${entrada.etiqueta}|${Date.now()}`).digest('hex');
  await deps.repo.guardar({ phone, dia, etiqueta: entrada.etiqueta, origen: 'manual', huella, mensajes: antes?.mensajes ?? 0, motivo: null, loteId: null });
  await registrar({ phone, fase: 'analisis', nivel: 'info', codigo: 'etiqueta_manual', detalle: `${quien} puso «${nombreDeEtiqueta(entrada.etiqueta, catalogo)}»${antes?.etiqueta ? ` (antes «${nombreDeEtiqueta(antes.etiqueta, catalogo)}»)` : ''}.` });
  // Corregir lo que puso la IA es una leccion: queda apuntado con el lote que la
  // clasifico (donde esta la copia de la conversacion) para ofrecerla como ejemplo
  // en Entrenamiento IA. Detalle: «antes>ahora» (codigos).
  if (antes?.etiqueta && antes.origen !== 'manual' && antes.etiqueta !== entrada.etiqueta && antes.loteId) {
    await deps.repo
      .registrar({ loteId: antes.loteId, phone, fase: 'analisis', nivel: 'info', codigo: CODIGO_CORRECCION, detalle: `${antes.etiqueta}>${entrada.etiqueta}` })
      .catch(() => undefined);
  }
  return (await deps.repo.delDia(dia, [phone]))[0] ?? null;
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
    estado: detalleError ? 'fallido' : estado.sinClasificar ? 'completado_con_errores' : 'completado',
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
        error: detalleError,
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
    detalle: detalleError ?? `${final.estado}: ${final.total} conversación(es), ${final.reutilizadas} reutilizada(s), ${final.clasificadas} clasificada(s), ${final.sinClasificar} sin clasificar.`,
  });
  alAvanzar(final);
  return final;
}

/** Los lotes en segundo plano, uno a la vez: pulsar mientras ya corre uno devuelve el que esta en marcha. */
export function crearEtiquetador(deps: EtiquetadoDeps) {
  let estado: EstadoEtiquetado | null = null;
  let enMarcha: Promise<EstadoEtiquetado | null> | null = null;
  // Un lote que quedo 'en_curso' es de un proceso que se apago a mitad.
  const colgados = deps.repo.cerrarLotesColgados('El servidor se reinició con el lote a mitad: vuelve a etiquetar.').catch(() => 0);

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
    /** Empieza un lote (o devuelve el que corre). Lanza si no hay IA. */
    iniciar(alcance: AlcanceMensajes, opciones: { iniciadoPor?: string | null; releer?: boolean } = {}): EstadoEtiquetado {
      if (enMarcha && estado) return { ...estado };
      if (!deps.ia()) throw new Error(NO_HAY_IA);
      estado = { ...VACIO, enCurso: true, tipo: 'completo', estado: 'en_curso', empezo: (deps.ahora?.() ?? new Date()).toISOString() };
      enMarcha = colgados
        .then(() => etiquetarDelDia(deps, alcance, (e) => (estado = e), opciones))
        .catch((error) => {
          estado = { ...(estado ?? VACIO), enCurso: false, estado: 'fallido', termino: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
          deps.log?.('el etiquetado de chats falló', { detalle: estado.error });
          return estado;
        })
        .finally(() => (enMarcha = null));
      return { ...estado };
    },
    /** Pone o quita a mano la etiqueta de hoy de un chat (ver etiquetarAMano). */
    etiquetarAMano: (entrada: { phone: string; etiqueta: string | null; quien?: string | null }) => etiquetarAMano(deps, entrada),
    /** Para las pruebas: espera al lote en marcha. */
    esperar: (): Promise<EstadoEtiquetado | null> => enMarcha ?? Promise.resolve(null),
  };
}
export type Etiquetador = ReturnType<typeof crearEtiquetador>;
