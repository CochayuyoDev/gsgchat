/**
 * Webhook de estados de rutas (pedido de GSG, 12/11).
 *
 * El sistema de rutas de GSG avisa cuando una ruta cambia de estado. GSG manda
 * solo CUATRO estados (acuerdo con GSG, 12/11), y un quinto caso:
 *
 *   - INACTIVO: los chats de los clientes de esa ruta se CIERRAN. El emisor
 *     (src/outbound/sender.ts) no deja salir NINGUN mensaje a un chat cerrado,
 *     ni automatico ni escrito a mano: no se gasta.
 *   - RECHAZADO, ENTREGADO y CANCELADO: NO cierran el chat. Sigue la regla de
 *     siempre, la ventana de 24 h (src/outbound/gates.ts). Si estaba cerrado
 *     por un INACTIVO anterior, deja de estarlo. Lo automatico que esperaba
 *     no se despierta: el pedido ya termino.
 *   - Cualquier otro estado (EN RUTA, ACTIVA…): un operador corrigio una ruta
 *     que estaba en uno de los cuatro. Quiere decir «la ruta volvio a estar
 *     activa»: si el chat estaba cerrado se ABRE, y lo que estaba esperando
 *     (el pedido de ubicacion, un recordatorio) sigue.
 *
 * Contrato (POST /api/v1/rutas/estado, header x-webhook-secret):
 *
 *   { "ruta": "GSG123456", "estado": "INACTIVO", "fecha": "2026-11-12T15:30:00-05:00" }
 *
 *   - `ruta`: el codigo de ruta, que es el TRACKING del pedido (el mismo
 *     `tracking` de la API 1; pedido del dueño, 12/11). Es lo unico que
 *     identifica la ruta: se cierra o abre el chat de ese pedido.
 *   - `estado`: el nuevo estado, tal cual lo llama GSG.
 *   - `fecha`: cuando cambio. Un aviso mas viejo que el ultimo aplicado a esa
 *     ruta se ignora (los avisos pueden llegar desordenados).
 *   - Se acepta un aviso o una lista de avisos.
 *
 * Reglas:
 *  - Se contesta al momento (202) y se procesa detras: GSG no espera ni reintenta por tiempo.
 *  - Un chat lo pueden cerrar varias rutas: se abre cuando ya no lo cierra ninguna.
 *  - Un pedido que llega de una ruta que ya esta inactiva entra con el chat cerrado.
 *  - Todo queda en la bitacora (Nuestra API → Webhook de rutas) y en la del pedido.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Repos } from '../db/repos.js';
import type { Entrega } from '../entregas/repo.js';
import type { EventoRuta, ResultadoAvisoRuta } from './repo.js';
import { despertarMotorRutas } from '../rutas/despertador.js';
import { limpiarEsperasEnvio } from '../rutas/espera-envio.js';

/** El estado que cierra el chat (sin tildes, en minusculas; se acepta tambien en femenino). */
export const ESTADOS_QUE_CIERRAN = ['inactivo', 'inactiva'] as const;

/** Los estados finales que NO cierran el chat: siguen la regla de 24 h. */
export const ESTADOS_FINALES = ['rechazado', 'rechazada', 'entregado', 'entregada', 'cancelado', 'cancelada'] as const;

/** Los cuatro estados que manda GSG, como los escribe GSG. */
export const ESTADOS_GSG = ['INACTIVO', 'RECHAZADO', 'ENTREGADO', 'CANCELADO'] as const;

/**
 * Que hace un estado: `cierra` (INACTIVO), `final` (RECHAZADO, ENTREGADO,
 * CANCELADO: no cierra, regla de 24 h) o `activa` (cualquier otro: la ruta
 * volvio a estar activa).
 */
export type EfectoEstado = 'cierra' | 'final' | 'activa';

/** «En Ruta» → «en ruta»; «INACTIVO» → «inactivo»; «en_ruta» → «en ruta». */
export function normalizarEstado(estado: string): string {
  return estado
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function efectoDeEstado(estado: string): EfectoEstado {
  const n = normalizarEstado(estado);
  if ((ESTADOS_QUE_CIERRAN as readonly string[]).includes(n)) return 'cierra';
  if ((ESTADOS_FINALES as readonly string[]).includes(n)) return 'final';
  return 'activa';
}

/** Si ese estado cierra los chats de la ruta (solo INACTIVO). */
export function estadoCierra(estado: string): boolean {
  return efectoDeEstado(estado) === 'cierra';
}

const texto = z.union([z.string(), z.number()]).transform((v) => String(v).trim());

/** Un aviso, con los nombres que GSG pueda usar. */
const avisoCrudo = z
  .object({
    ruta: texto.optional(), idRuta: texto.optional(), codigoRuta: texto.optional(), rutaId: texto.optional(), routeId: texto.optional(), route_id: texto.optional(),
    estado: texto.optional(), status: texto.optional(), state: texto.optional(),
    fecha: texto.optional(), fechaCambio: texto.optional(), fecha_cambio: texto.optional(), changedAt: texto.optional(), timestamp: texto.optional(),
  })
  .passthrough();

export interface AvisoRuta {
  ruta: string;
  estado: string;
  fecha: Date;
}

/** Lee el cuerpo del webhook. Devuelve los avisos o el error en palabras (con el campo). */
export function leerAvisos(cuerpo: unknown, ahora: Date): { avisos: AvisoRuta[] } | { error: string; campo: string } {
  const lista = Array.isArray(cuerpo) ? cuerpo : cuerpo && typeof cuerpo === 'object' && Array.isArray((cuerpo as { avisos?: unknown }).avisos) ? (cuerpo as { avisos: unknown[] }).avisos : [cuerpo];
  if (!lista.length) return { error: 'No llegó ningún aviso: manda { "ruta", "estado", "fecha" }.', campo: 'cuerpo' };
  if (lista.length > 200) return { error: 'Como mucho 200 avisos por llamada.', campo: 'cuerpo' };
  const avisos: AvisoRuta[] = [];
  for (const [i, crudo] of lista.entries()) {
    const donde = lista.length > 1 ? `avisos[${i}].` : '';
    if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return { error: 'Cada aviso es un objeto JSON: { "ruta", "estado", "fecha" }.', campo: `${donde}cuerpo` };
    const r = avisoCrudo.safeParse(crudo);
    if (!r.success) {
      const x = r.error.issues[0];
      return { error: `El aviso no se entiende: ${x?.path.join('.') || 'cuerpo'}: ${x?.message ?? 'formato no válido'}.`, campo: `${donde}${x?.path.join('.') || 'cuerpo'}` };
    }
    const a = r.data;
    const ruta = a.ruta || a.idRuta || a.codigoRuta || a.rutaId || a.routeId || a.route_id || '';
    const estado = a.estado || a.status || a.state || '';
    const fechaTexto = a.fecha || a.fechaCambio || a.fecha_cambio || a.changedAt || a.timestamp || '';
    if (!estado) return { error: 'Falta el estado nuevo de la ruta (campo "estado"): INACTIVO, RECHAZADO, ENTREGADO o CANCELADO (o el estado nuevo si la ruta volvió a estar activa, p. ej. "EN RUTA").', campo: `${donde}estado` };
    if (estado.length > 60) return { error: 'El estado es demasiado largo (60 caracteres como mucho).', campo: `${donde}estado` };
    if (!ruta) return { error: 'Falta el código de ruta (campo "ruta"): el tracking del pedido, por ejemplo "GSG123456".', campo: `${donde}ruta` };
    if (ruta.length > 120) return { error: 'El código de la ruta es demasiado largo (120 caracteres como mucho).', campo: `${donde}ruta` };
    let fecha = ahora;
    if (fechaTexto) {
      const n = /^\d{10,13}$/.test(fechaTexto) ? new Date(fechaTexto.length === 10 ? Number(fechaTexto) * 1000 : Number(fechaTexto)) : new Date(fechaTexto);
      if (Number.isNaN(n.getTime())) return { error: `La fecha "${fechaTexto}" no se entiende: usa ISO 8601, por ejemplo "2026-11-12T15:30:00-05:00".`, campo: `${donde}fecha` };
      fecha = n;
    }
    avisos.push({ ruta, estado, fecha });
  }
  return { avisos };
}

/** La huella del secreto (lo unico que se guarda). */
export const huellaSecreto = (secreto: string): string => createHash('sha256').update(secreto, 'utf8').digest('hex');

/** Un secreto nuevo para el header x-webhook-secret. */
export const generarSecretoRutas = (): string => `whr_${randomBytes(24).toString('base64url')}`;

/** Si el secreto que llego es el guardado, sin filtrar por tiempo cuanto se parece. */
export function secretoValido(llegado: string | undefined, hashGuardado: string): boolean {
  if (!llegado) return false;
  const a = Buffer.from(huellaSecreto(llegado.trim()), 'hex');
  const b = Buffer.from(hashGuardado, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const igual = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

export interface DepsRutasGsg {
  repos: Repos;
  ahora?: () => Date;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
}

export interface ResultadoAviso {
  resultado: ResultadoAvisoRuta;
  detalle: string;
  chats: number;
}

export interface ServicioRutasGsg {
  /** Aplica un aviso (cierra, deja abierto o reabre los chats). Nunca lanza: el error vuelve en el resultado. */
  aplicar(aviso: AvisoRuta, opciones?: { prueba?: boolean }): Promise<ResultadoAviso>;
  /** Anota el aviso, lo procesa detras y devuelve su id en la bitacora (para contestar al momento). */
  recibir(aviso: AvisoRuta, opciones?: { prueba?: boolean }): Promise<{ id: number; procesado: Promise<ResultadoAviso> }>;
  /** Un pedido que acaba de entrar o cambiar: si su ruta ya esta cerrada, su chat tambien. */
  alPedido(e: Entrega): Promise<void>;
  /** Por que esta cerrado el chat de ese telefono, o null. */
  bloqueoDeTelefono(phone: string): Promise<{ ruta: string; estado: string; desde: Date } | null>;
}

export function crearServicioRutasGsg(deps: DepsRutasGsg): ServicioRutasGsg {
  const { repos } = deps;
  const ahora = deps.ahora ?? (() => new Date());
  const log = deps.log ?? (() => undefined);

  /** Los pedidos de esa ruta: el codigo de ruta es el tracking del pedido. */
  async function pedidosDe(ruta: string): Promise<Entrega[]> {
    const vivos = await repos.entregas.listar({ limit: 5000 }).catch(() => [] as Entrega[]);
    const deEsaRuta = vivos.filter((e) => igual(e.datosEnvio?.tracking, ruta) || igual(e.referencia, ruta));
    if (deEsaRuta.length) return deEsaRuta;
    // Uno que ya no esta entre los vivos (entregado, de otro dia): se busca igual.
    const e = await repos.entregas.porTracking(ruta).catch(() => null);
    return e ? [e] : [];
  }

  /** Lo que estaba esperando a ese chat sale ya: el reparto lo vuelve a mirar. */
  async function reanudar(phones: string[]): Promise<void> {
    for (const phone of new Set(phones)) {
      const s = await repos.rutas.abiertaPorTelefono(phone).catch(() => null);
      if (s && ['pendiente', 'enviado', 'respondio'].includes(s.estado) && s.proximoIntentoAt && s.proximoIntentoAt.getTime() > ahora().getTime()) {
        await repos.rutas.actualizarSolicitud(s.id, { proximoIntentoAt: ahora() }).catch(() => undefined);
      }
      if (s) limpiarEsperasEnvio(repos.rutas, s.id);
    }
    despertarMotorRutas();
  }

  async function aplicar(aviso: AvisoRuta, opciones: { prueba?: boolean } = {}): Promise<ResultadoAviso> {
    try {
      const efecto = efectoDeEstado(aviso.estado);
      const cierra = efecto === 'cierra';
      const ruta = aviso.ruta;
      const prueba = opciones.prueba ? ' (prueba desde Nuestra API)' : '';
      const antes = await repos.rutasGsg.ruta(ruta);
      if (antes && antes.cambiadoAt.getTime() > aviso.fecha.getTime()) {
        return { resultado: 'ignorado_viejo', detalle: `Aviso más viejo que el último aplicado a ${ruta} («${antes.estado}», ${antes.cambiadoAt.toISOString()}): se ignora.`, chats: 0 };
      }
      const pedidos = await pedidosDe(ruta);
      await repos.rutasGsg.guardarRuta({ ruta, estado: aviso.estado, activa: !cierra, cambiadoAt: aviso.fecha, recibidoAt: ahora() });
      if (cierra) {
        const contactos: string[] = [];
        for (const e of pedidos) {
          if (!e.phone) continue;
          contactos.push((await repos.contacts.upsertFromInbound(e.phone)).id);
        }
        const cerrados = contactos.length ? await repos.rutasGsg.bloquear(contactos, ruta, aviso.estado, aviso.fecha) : 0;
        for (const e of pedidos) {
          await repos.entregas.registrarEvento(e.id, 'nota', `Chat cerrado: la ruta ${ruta} pasó a «${aviso.estado}». No sale ningún mensaje a este cliente hasta que la ruta vuelva a estar activa.${prueba}`, { rutaGsg: ruta, estado: aviso.estado, cierra: true, efecto }).catch(() => undefined);
        }
        if (!pedidos.length) return { resultado: 'sin_pedidos', detalle: `Cierra los chats. ${ruta}: todavía no hay pedidos con esa ruta; el estado queda guardado y los que lleguen entran con su chat cerrado.`, chats: 0 };
        return { resultado: 'aplicado', detalle: `Cierra los chats. ${ruta}: ${pedidos.length} pedido${pedidos.length === 1 ? '' : 's'}, ${cerrados} chat${cerrados === 1 ? '' : 's'} cerrado${cerrados === 1 ? '' : 's'}.`, chats: new Set(contactos).size };
      }
      // RECHAZADO, ENTREGADO o CANCELADO no cierran: el chat sigue con la regla de
      // 24 h. Si un INACTIVO anterior lo habia cerrado, ese cierre se quita.
      // Cualquier otro estado: la ruta volvio a estar activa y se reabre.
      const final = efecto === 'final';
      const abiertos = await repos.rutasGsg.desbloquear(ruta);
      // Los que siguen cerrados por otra ruta no se cuentan como abiertos.
      const delTodo: string[] = [];
      for (const id of abiertos) if (!(await repos.rutasGsg.bloqueoDe(id))) delTodo.push(id);
      const phones: string[] = [];
      for (const id of delTodo) {
        const c = await repos.contacts.getById(id).catch(() => null);
        if (c?.phone) phones.push(c.phone);
      }
      for (const e of pedidos) {
        if (final) {
          // Se anota en cada pedido de la ruta: el chat no se cierra y por que.
          const reabierto = Boolean(e.phone && phones.includes(e.phone));
          await repos.entregas.registrarEvento(e.id, 'nota', `La ruta ${ruta} pasó a «${aviso.estado}»: el chat no se cierra y sigue la regla de 24 horas${reabierto ? ' (estaba cerrado por un «inactivo» anterior: ya no)' : ''}.${prueba}`, { rutaGsg: ruta, estado: aviso.estado, cierra: false, efecto }).catch(() => undefined);
          continue;
        }
        if (!e.phone || !phones.includes(e.phone)) continue;
        await repos.entregas.registrarEvento(e.id, 'nota', `Chat abierto de nuevo: la ruta ${ruta} volvió a estar activa («${aviso.estado}»).${prueba}`, { rutaGsg: ruta, estado: aviso.estado, cierra: false, efecto }).catch(() => undefined);
      }
      // Solo una ruta que volvio a estar activa despierta lo que esperaba; un pedido
      // rechazado, entregado o cancelado ya no necesita el pedido de ubicacion.
      if (phones.length && !final) await reanudar(phones);
      const siguen = abiertos.length - delTodo.length;
      const otraRuta = siguen ? ` (${siguen} sigue${siguen === 1 ? '' : 'n'} cerrado${siguen === 1 ? '' : 's'} por otra ruta)` : '';
      if (final) {
        const quitados = delTodo.length ? ` Se quitó el cierre de ${delTodo.length} chat${delTodo.length === 1 ? '' : 's'} que un «inactivo» anterior había cerrado${otraRuta}.` : '';
        if (!pedidos.length && !abiertos.length) return { resultado: 'sin_pedidos', detalle: `No cierra el chat (regla de 24 h). ${ruta}: todavía no hay pedidos con esa ruta; el estado queda guardado.`, chats: 0 };
        return { resultado: 'aplicado', detalle: `No cierra el chat (regla de 24 h). ${ruta}: ${pedidos.length} pedido${pedidos.length === 1 ? '' : 's'}.${quitados}`, chats: delTodo.length };
      }
      if (!pedidos.length && !abiertos.length) return { resultado: 'sin_pedidos', detalle: `La ruta volvió a estar activa. ${ruta}: no tenía chats cerrados ni pedidos todavía; el estado queda guardado.`, chats: 0 };
      return { resultado: 'aplicado', detalle: `La ruta volvió a estar activa: abre los chats. ${ruta}: ${delTodo.length} chat${delTodo.length === 1 ? '' : 's'} abierto${delTodo.length === 1 ? '' : 's'}${otraRuta}.`, chats: delTodo.length };
    } catch (error) {
      log('no se pudo aplicar un aviso de ruta', { ruta: aviso.ruta, detalle: String(error) });
      return { resultado: 'error', detalle: `No se pudo aplicar: ${error instanceof Error ? error.message : String(error)}`, chats: 0 };
    }
  }

  return {
    aplicar,
    async recibir(aviso, opciones = {}) {
      const id = await repos.rutasGsg.anotarEvento({
        recibidoAt: ahora(), ruta: aviso.ruta, estado: aviso.estado, cambiadoAt: aviso.fecha,
        resultado: 'recibido', detalle: 'Recibido: procesando.', chats: 0, prueba: Boolean(opciones.prueba),
      });
      const procesado = aplicar(aviso, opciones).then(async (r) => {
        await repos.rutasGsg.cerrarEvento(id, r.resultado, r.detalle, r.chats).catch((error: unknown) => log('no se pudo cerrar el aviso de ruta en la bitacora', { id, detalle: String(error) }));
        return r;
      });
      return { id, procesado };
    },
    async alPedido(e) {
      try {
        // El codigo de ruta es el tracking del pedido.
        const ruta = e.datosEnvio?.tracking ?? e.referencia;
        if (!e.phone || !ruta) return;
        const r = await repos.rutasGsg.ruta(ruta);
        if (!r || r.activa) return;
        const c = await repos.contacts.upsertFromInbound(e.phone);
        await repos.rutasGsg.bloquear([c.id], ruta, r.estado, r.cambiadoAt);
        await repos.entregas.registrarEvento(e.id, 'nota', `Chat cerrado: el pedido es de la ruta ${ruta}, que está «${r.estado}». No sale ningún mensaje hasta que la ruta vuelva a estar activa.`, { rutaGsg: ruta, estado: r.estado, cierra: true }).catch(() => undefined);
      } catch (error) {
        log('no se pudo revisar la ruta de un pedido nuevo', { referencia: e.referencia, detalle: String(error) });
      }
    },
    async bloqueoDeTelefono(phone) {
      const c = await repos.contacts.getByPhone(phone).catch(() => null);
      if (!c) return null;
      const b = await repos.rutasGsg.bloqueoDe(c.id);
      return b ? { ruta: b.ruta, estado: b.estado, desde: b.desde } : null;
    },
  };
}

/** Un evento de la bitacora para la pantalla, con la ruta legible. */
export function eventoParaPantalla(e: EventoRuta): Record<string, unknown> {
  return { ...e, rutaTexto: e.ruta ?? '—' };
}
