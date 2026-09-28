/**
 * Las piezas comunes del catalogo de la IA operadora (acciones.ts y
 * acciones-panel.ts): los tipos, como se llama al panel, como se dice un
 * error en palabras y como se encuentra "el pedido de Ana" o "Carlos".
 *
 * Decision del dueño (28/09): la IA lee y responde al momento, pero TODO lo
 * que escribe o cambia algo se arma entero, se enseña en una tarjeta con
 * exactamente lo que va a hacer (que, a quien, cuantos, antes -> despues) y
 * se ejecuta de verdad solo al pulsar «Hacerlo». Por eso cada cambio tiene
 * dos partes:
 *  - `preparar`: SOLO LEE (el contexto que recibe rechaza cualquier llamada
 *    que no sea GET). Encuentra el objetivo exacto (el id del pedido, del
 *    motorizado, del chat), lee como esta ahora y arma la tarjeta. Si hay
 *    varios candidatos no adivina: devuelve las opciones para elegir.
 *  - `ejecutar`: hace el cambio por la MISMA ruta que usa la pantalla, con la
 *    identidad de quien ordena (permisos, tienda y bitacora incluidos).
 */

import { z } from 'zod';
import type { StokyClient } from '../stoky/client.js';

export type TipoAccion = 'consulta' | 'cambio';

export interface Llamada {
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT';
  url: string;
  body?: unknown;
}

export interface RespuestaLlamada {
  status: number;
  json: unknown;
}

/** Como llega al sistema: los endpoints del panel, con la identidad de quien ordena. */
export type Llamar = (llamada: Llamada) => Promise<RespuestaLlamada>;

export interface ContextoAccion {
  llamar: Llamar;
  /** Quien ordena, para apuntarlo en lo que se crea. */
  quien: string;
  esAdmin: boolean;
  catalogo?: StokyClient;
  /** Modo «Solo lo de GSG»: lo comercial (campañas, catalogo) no se ofrece ni se hace. */
  sinVentas?: boolean;
}

export interface ResultadoAccion {
  ok: boolean;
  /** Una o dos frases para el modelo y para la pantalla. */
  resumen: string;
  /** Datos compactos (ya sin secretos) para que el modelo siga trabajando. */
  datos?: unknown;
  /** Si se puede arreglar en una pantalla, cual. */
  ir?: string;
}

/** Lo que se enseña antes de «Hacerlo»: exactamente lo que va a pasar, en palabras. */
export interface Tarjeta {
  /** Que se va a hacer, en una frase: «Pasar el pedido GSG-IA-001 a Carlos Rojas». */
  que: string;
  /** A quien o sobre que (cliente, motorizado, chat, ajuste). */
  aQuien?: string;
  /** Cuantos (numeros, pedidos, mensajes), si es mas de uno o importa. */
  cuantos?: number;
  /** Como esta ahora. */
  antes?: string;
  /** Como queda despues. */
  despues?: string;
  /** El texto exacto que sale por WhatsApp, si sale alguno. */
  mensaje?: string;
  /** Lo que conviene saber antes de pulsar (modo prueba, fuera de horario, dado de baja...). */
  avisos?: string[];
}

export type Preparado<P = Record<string, unknown>> =
  | { tipo: 'listo'; params: P; tarjeta: Tarjeta }
  | { tipo: 'elegir'; pregunta: string; opciones: Array<{ etiqueta: string; params: P }> }
  | { tipo: 'no'; resumen: string; ir?: string };

export interface Accion<P = unknown> {
  nombre: string;
  tipo: TipoAccion;
  /** Para el prompt: que hace, en una linea. */
  descripcion: string;
  /** Para el prompt: los parametros con su significado. */
  parametros: string;
  /** Un ejemplo de orden en lenguaje natural y su llamada. */
  ejemplo: { orden: string; accion: Record<string, unknown> };
  schema: z.ZodType<P>;
  peligrosa?: boolean;
  /** Solo un administrador (las rutas lo exigen igual; es para explicarlo antes). */
  soloAdmin?: boolean;
  /** Lo comercial: con «Solo lo de GSG» ni se ofrece ni se hace. */
  ventas?: boolean;
  /** Solo en los cambios: arma la tarjeta leyendo (nunca escribe). Sin esto, una tarjeta generica. */
  preparar?: (params: P, ctx: ContextoAccion) => Promise<Preparado<P>>;
  ejecutar: (params: P, ctx: ContextoAccion) => Promise<ResultadoAccion>;
}

export const telefono = z.string().trim().min(6).max(30);
export const texto = (max: number) => z.string().trim().min(1).max(max);
export const idOpcional = z.coerce.number().int().positive().optional();

export const def = <P>(a: Accion<P>): Accion => a as unknown as Accion;

/** El error de una respuesta HTTP, dicho para una persona (y a quien pedirselo si es de permisos). */
export function errorDe(r: RespuestaLlamada, fallback: string): ResultadoAccion {
  const j = (r.json ?? {}) as { error?: string; ir?: string };
  if (r.status === 403) return { ok: false, resumen: j.error ? `No tienes permiso: ${j.error}. Pídeselo a un administrador de la tienda.` : 'No tienes permiso para eso: pídeselo a un administrador de la tienda.', ir: j.ir };
  if (r.status === 404) return { ok: false, resumen: j.error ?? 'No existe (o ya no).', ir: j.ir };
  if (r.status === 401) return { ok: false, resumen: 'La sesión no es válida.' };
  if (r.status === 402) return { ok: false, resumen: j.error ?? 'Tu plan no incluye esto.', ir: j.ir ?? '/panel#configuracion' };
  return { ok: false, resumen: j.error ?? fallback, ir: j.ir };
}

export const ok = (r: RespuestaLlamada) => r.status >= 200 && r.status < 300;

/** Un telefono a digitos con pais: "987 654 321" -> 51987654321 (Peru). */
export function telefonoADigitos(t: string, pais = '51'): string {
  let d = t.replace(/\D+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && pais === '51') d = pais + d;
  return d;
}

export function acortar(s: unknown, n = 160): string {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** Minusculas, sin tildes y sin espacios de sobra: para comparar nombres y pedidos. */
export function normal(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Un codigo de pedido sin guiones ni espacios: "gsg ia 001" = "GSG-IA-001". */
const codigo = (s: unknown): string => normal(s).replace(/[^a-z0-9]/g, '');

/** El telefono tal como se ve: 51 912 426 667. */
export function telefonoBonito(p: string): string {
  const d = String(p ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('51')) return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return d || String(p ?? '');
}

// ---------------------------------------------------------------- entregas

export interface EntregaVista {
  id: number;
  referencia: string;
  phone: string;
  nombre: string | null;
  estado: string;
  situacion?: string;
  direccion?: string | null;
  distrito?: string | null;
  lat?: number | null;
  lng?: number | null;
  ubicacionEstado?: string;
  confirmacionEstado?: string;
  prioridad?: string | null;
  motorizado?: { id: number; nombre: string; phone?: string } | null;
  llegaAproxAt?: string | null;
  entregadaAt?: string | null;
}

export interface MotorizadoVista {
  id: number;
  nombre: string;
  phone: string;
  estado?: string;
  zona?: string | null;
  placa?: string | null;
  entregasHoy?: number;
  enManos?: number;
}

export const ESTADO_ENTREGA_EN_PALABRAS: Record<string, string> = {
  pendiente: 'pendiente',
  esperando_ubicacion: 'esperando su ubicación',
  esperando_confirmacion: 'esperando que confirme',
  lista: 'lista para el motorizado',
  esperando_motorizado: 'esperando al motorizado',
  avisada: 'con hora de llegada',
  entregada: 'entregada',
  terminada: 'terminada',
  cancelada: 'cancelada',
  incidencia: 'necesita a una persona',
};

export const estadoEnPalabras = (e: string): string => ESTADO_ENTREGA_EN_PALABRAS[e] ?? e;

/** La entrega en una linea: «GSG-IA-001 · Ana Quispe (Lince), esperando su ubicación». */
export function lineaEntrega(e: EntregaVista): string {
  return `${e.referencia} · ${e.nombre ?? telefonoBonito(e.phone)}${e.distrito ? ` (${e.distrito})` : ''}, ${estadoEnPalabras(e.estado)}${e.motorizado ? `, la lleva ${e.motorizado.nombre}` : ''}`;
}

/** Las entregas y los motorizados de hoy, por la misma ruta que la pantalla Hoy. */
export async function leerEntregas(ctx: ContextoAccion): Promise<{ entregas: EntregaVista[]; motorizados: MotorizadoVista[]; ajustes: Record<string, unknown>; dia?: string } | { error: ResultadoAccion }> {
  const r = await ctx.llamar({ method: 'GET', url: '/admin/entregas' });
  if (!ok(r)) return { error: errorDe(r, 'No se pudieron leer las entregas de hoy.') };
  const j = r.json as { entregas?: EntregaVista[]; motorizados?: MotorizadoVista[]; ajustes?: Record<string, unknown>; dia?: string };
  return { entregas: j.entregas ?? [], motorizados: j.motorizados ?? [], ajustes: j.ajustes ?? {}, dia: j.dia };
}

/**
 * Quienes pueden ser "el pedido de X": por codigo exacto, por telefono, por
 * nombre exacto y por parte del nombre, en ese orden. Se para en el primer
 * nivel que encuentra algo: si ahi hay mas de uno, se pregunta.
 */
export function candidatosEntrega(lista: EntregaVista[], quien: string): EntregaVista[] {
  const q = normal(quien);
  if (!q) return [];
  const cod = codigo(quien);
  const porCodigo = lista.filter((e) => codigo(e.referencia) === cod);
  if (porCodigo.length) return porCodigo;
  const digitos = telefonoADigitos(quien);
  if (/^\d{6,}$/.test(digitos)) {
    const porTel = lista.filter((e) => e.phone === digitos || (digitos.length >= 9 && e.phone.endsWith(digitos.slice(-9))));
    if (porTel.length) return porTel;
  }
  const porNombre = lista.filter((e) => normal(e.nombre) === q);
  if (porNombre.length) return porNombre;
  if (q.length < 3) return [];
  const palabras = q.split(' ');
  return lista.filter((e) => {
    const n = normal(e.nombre);
    return palabras.every((p) => n.includes(p)) || (cod.length >= 3 && codigo(e.referencia).includes(cod));
  });
}

/** Una entrega concreta (por su id, o si solo una coincide). Para ejecutar. */
export async function unaEntrega(ctx: ContextoAccion, quien: string, id?: number | null): Promise<{ e: EntregaVista; motorizados: MotorizadoVista[] } | { error: ResultadoAccion }> {
  const l = await leerEntregas(ctx);
  if ('error' in l) return l;
  if (id) {
    const e = l.entregas.find((x) => x.id === id);
    if (!e) return { error: { ok: false, resumen: `El pedido ${quien} ya no está en las entregas de hoy.`, ir: '/hoy' } };
    // La tarjeta nombraba un pedido: si ese id ya es otro, no se toca.
    if (quien.trim() && !candidatosEntrega([e], quien).length) return { error: { ok: false, resumen: `El pedido ${quien} ya no está en las entregas de hoy (vuelve a pedírmelo).`, ir: '/hoy' } };
    return { e, motorizados: l.motorizados };
  }
  const c = candidatosEntrega(l.entregas, quien);
  if (!c.length) return { error: { ok: false, resumen: `No encuentro ninguna entrega de hoy para "${quien}".`, ir: '/hoy' } };
  if (c.length > 1) return { error: { ok: false, resumen: `Hay ${c.length} pedidos de hoy que coinciden con "${quien}": ${c.slice(0, 6).map((e) => e.referencia).join(', ')}. Dime cuál (el código del pedido).`, ir: '/hoy' } };
  return { e: c[0]!, motorizados: l.motorizados };
}

/**
 * Para preparar: encuentra la entrega o devuelve las opciones (con el id ya
 * puesto) para que la persona elija con un boton.
 */
export async function prepararConEntrega<P extends { entregaId?: number }>(
  ctx: ContextoAccion,
  p: P,
  quien: string,
  pregunta: string,
  armar: (e: EntregaVista, datos: { motorizados: MotorizadoVista[]; ajustes: Record<string, unknown> }) => Promise<Preparado<P>> | Preparado<P>,
): Promise<Preparado<P>> {
  const l = await leerEntregas(ctx);
  if ('error' in l) return { tipo: 'no', resumen: l.error.resumen, ir: l.error.ir };
  let e: EntregaVista | undefined;
  if (p.entregaId) {
    e = l.entregas.find((x) => x.id === p.entregaId);
    if (!e) return { tipo: 'no', resumen: `El pedido ${quien} ya no está en las entregas de hoy.`, ir: '/hoy' };
  } else {
    const c = candidatosEntrega(l.entregas, quien);
    if (!c.length) return { tipo: 'no', resumen: `No encuentro ninguna entrega de hoy para "${quien}". Mira el código en Hoy o dime el teléfono.`, ir: '/hoy' };
    if (c.length > 1) return { tipo: 'elegir', pregunta: `${pregunta} Hay ${c.length} pedidos que coinciden con "${quien}":`, opciones: c.slice(0, 8).map((x) => ({ etiqueta: lineaEntrega(x), params: { ...p, entregaId: x.id } })) };
    e = c[0]!;
  }
  return armar(e, { motorizados: l.motorizados, ajustes: l.ajustes });
}

// ------------------------------------------------------------- motorizados

export function candidatosMotorizado(lista: MotorizadoVista[], quien: string): MotorizadoVista[] {
  const q = normal(quien).replace(/^(el|al|a|la) (motorizado|moto|repartidor)\s*/, '').trim();
  if (!q) return [];
  const digitos = telefonoADigitos(quien);
  if (/^\d{6,}$/.test(digitos)) {
    const porTel = lista.filter((m) => m.phone === digitos || (digitos.length >= 9 && m.phone.endsWith(digitos.slice(-9))));
    if (porTel.length) return porTel;
  }
  const exactos = lista.filter((m) => normal(m.nombre) === q);
  if (exactos.length) return exactos;
  const palabras = q.split(' ');
  // «Carlos» = el que se llama Carlos algo (si hay dos Carlos, se pregunta).
  const porPalabra = lista.filter((m) => {
    const trozos = normal(m.nombre).split(' ');
    return palabras.every((p) => trozos.includes(p));
  });
  if (porPalabra.length) return porPalabra;
  if (q.length < 3) return [];
  return lista.filter((m) => normal(m.nombre).includes(q));
}

export const lineaMotorizado = (m: MotorizadoVista): string => `${m.nombre} (${telefonoBonito(m.phone)}${m.estado && m.estado !== 'activo' ? `, ${m.estado === 'descanso' ? 'en descanso' : 'de baja'}` : ''}${m.zona ? `, ${m.zona}` : ''})`;

export async function leerMotorizados(ctx: ContextoAccion): Promise<MotorizadoVista[] | { error: ResultadoAccion }> {
  const r = await ctx.llamar({ method: 'GET', url: '/admin/motorizados' });
  if (!ok(r)) return { error: errorDe(r, 'No se pudieron leer los motorizados.') };
  return ((r.json as { motorizados?: MotorizadoVista[] }).motorizados ?? []) as MotorizadoVista[];
}

/** Un motorizado concreto (por su id, o si solo uno coincide). Para ejecutar. */
export async function unMotorizado(ctx: ContextoAccion, quien: string, id?: number | null): Promise<{ m: MotorizadoVista } | { error: ResultadoAccion }> {
  const l = await leerMotorizados(ctx);
  if ('error' in l) return l;
  if (id) {
    const m = l.find((x) => x.id === id);
    if (!m || (quien.trim() && !candidatosMotorizado([m], quien).length)) return { error: { ok: false, resumen: `Ese motorizado (${quien}) ya no existe.`, ir: '/motorizados' } };
    return { m };
  }
  const c = candidatosMotorizado(l, quien);
  if (!c.length) return { error: { ok: false, resumen: `No encuentro ningún motorizado que se llame "${quien}".`, ir: '/motorizados' } };
  if (c.length > 1) return { error: { ok: false, resumen: `Hay ${c.length} motorizados que coinciden con "${quien}": ${c.map((m) => m.nombre).join(', ')}. Dime cuál.`, ir: '/motorizados' } };
  return { m: c[0]! };
}

/** Para preparar: el motorizado, o las opciones para elegir. */
export function elegirMotorizado<P>(lista: MotorizadoVista[], quien: string, id: number | undefined, pregunta: string, conId: (m: MotorizadoVista) => P): { m: MotorizadoVista } | { preparado: Preparado<P> } {
  if (id) {
    const m = lista.find((x) => x.id === id);
    return m ? { m } : { preparado: { tipo: 'no', resumen: `Ese motorizado (${quien}) ya no existe.`, ir: '/motorizados' } };
  }
  const c = candidatosMotorizado(lista, quien);
  if (!c.length) return { preparado: { tipo: 'no', resumen: `No encuentro ningún motorizado que se llame "${quien}". Los que hay: ${lista.slice(0, 12).map((m) => m.nombre).join(', ') || 'ninguno (dalo de alta en Motorizados)'}.`, ir: '/motorizados' } };
  if (c.length > 1) return { preparado: { tipo: 'elegir', pregunta: `${pregunta} Hay ${c.length} motorizados que coinciden con "${quien}":`, opciones: c.slice(0, 8).map((m) => ({ etiqueta: lineaMotorizado(m), params: conId(m) })) } };
  return { m: c[0]! };
}

// ----------------------------------------------------------------- chats

export interface ContactoVista {
  id: string;
  phone: string;
  name: string | null;
}

/** Quienes pueden ser "el chat de Luis": por telefono (unico) o por nombre (puede haber varios). */
export async function candidatosContacto(ctx: ContextoAccion, quien: string): Promise<ContactoVista[] | { error: ResultadoAccion }> {
  const digitos = telefonoADigitos(quien);
  const esTel = /^\d{6,}$/.test(digitos);
  const q = esTel ? digitos : quien.trim();
  const r = await ctx.llamar({ method: 'GET', url: `/admin/chat/conversations?q=${encodeURIComponent(q)}&limit=10` });
  if (!ok(r)) return { error: errorDe(r, 'No se pudieron leer los chats.') };
  const items = ((r.json as { items?: Array<{ contactId: string; phone: string; name: string | null; tipo?: string }> }).items ?? []).filter((c) => c.tipo !== 'grupo');
  let lista: ContactoVista[] = items.map((c) => ({ id: c.contactId, phone: c.phone, name: c.name }));
  if (!lista.length) {
    const c = await ctx.llamar({ method: 'GET', url: `/admin/contacts?q=${encodeURIComponent(q)}&limit=10` });
    if (ok(c)) lista = ((c.json as { items?: Array<{ id: string; phone: string; name: string | null }> }).items ?? []).map((x) => ({ id: x.id, phone: x.phone, name: x.name }));
  }
  if (esTel) {
    const exacto = lista.filter((c) => c.phone === digitos || (digitos.length >= 9 && c.phone.endsWith(digitos.slice(-9))));
    return exacto.length ? exacto.slice(0, 1) : [];
  }
  const n = normal(quien);
  const exactos = lista.filter((c) => normal(c.name) === n);
  return exactos.length ? exactos : lista;
}

export const lineaContacto = (c: ContactoVista): string => `${c.name ?? 'sin nombre'} (${telefonoBonito(c.phone)})`;

/** Para ejecutar: el chat por su id, o si solo uno coincide. */
export async function unContacto(ctx: ContextoAccion, quien: string, id?: string | null): Promise<{ c: ContactoVista } | { error: ResultadoAccion }> {
  if (id) {
    const r = await ctx.llamar({ method: 'GET', url: `/admin/chat/${encodeURIComponent(id)}/ficha` });
    if (!ok(r)) return { error: errorDe(r, `Ese chat (${quien}) ya no existe.`) };
    const f = (r.json as { contacto: { id: string; phone: string; name: string | null } }).contacto;
    return { c: { id: f.id, phone: f.phone, name: f.name } };
  }
  const l = await candidatosContacto(ctx, quien);
  if ('error' in l) return l;
  if (!l.length) return { error: { ok: false, resumen: `No encuentro ningún chat de "${quien}".`, ir: '/chat' } };
  if (l.length > 1) return { error: { ok: false, resumen: `Hay ${l.length} chats que coinciden con "${quien}": ${l.slice(0, 6).map(lineaContacto).join(', ')}. Dime el número.`, ir: '/chat' } };
  return { c: l[0]! };
}

/** Para preparar: el chat, o las opciones para elegir. */
export async function prepararConContacto<P extends { contactId?: string }>(ctx: ContextoAccion, p: P, quien: string, pregunta: string, armar: (c: ContactoVista) => Promise<Preparado<P>>): Promise<Preparado<P>> {
  if (p.contactId) {
    const u = await unContacto(ctx, quien, p.contactId);
    if ('error' in u) return { tipo: 'no', resumen: u.error.resumen, ir: u.error.ir };
    return armar(u.c);
  }
  const l = await candidatosContacto(ctx, quien);
  if ('error' in l) return { tipo: 'no', resumen: l.error.resumen, ir: l.error.ir };
  if (!l.length) return { tipo: 'no', resumen: `No encuentro ningún chat de "${quien}". Dime su número.`, ir: '/chat' };
  if (l.length > 1) return { tipo: 'elegir', pregunta: `${pregunta} Hay ${l.length} chats que coinciden con "${quien}":`, opciones: l.slice(0, 8).map((c) => ({ etiqueta: lineaContacto(c), params: { ...p, contactId: c.id } })) };
  return armar(l[0]!);
}

// --------------------------------------------------- lo que frena un envio

/**
 * Lo que va a frenar un mensaje a este numero, leido de las mismas pantallas
 * (Ajustes y Salud): modo prueba, numero pausado, fuera de horario, baja. No
 * se salta nada: el envio pasa igual por el sender con todas sus guardas;
 * esto es para que la tarjeta lo diga ANTES de pulsar.
 */
export async function avisosDeEnvio(ctx: ContextoAccion, telefonos: string[]): Promise<string[]> {
  const avisos: string[] = [];
  const [aj, sal] = await Promise.all([ctx.llamar({ method: 'GET', url: '/admin/ajustes' }).catch(() => null), ctx.llamar({ method: 'GET', url: '/admin/salud' }).catch(() => null)]);
  if (aj && ok(aj)) {
    const solo = ((aj.json as { efectivo?: { soloNumeros?: string[] } }).efectivo?.soloNumeros ?? []).map(String);
    if (solo.length) {
      const fuera = telefonos.filter((t) => !solo.includes(t));
      avisos.push(
        fuera.length === telefonos.length
          ? `Modo prueba activo: solo se escribe a ${solo.map(telefonoBonito).join(', ')}. ${telefonos.length === 1 ? 'A este número NO le saldrá' : 'A estos números NO les saldrá'} (el sistema lo frena).`
          : fuera.length
            ? `Modo prueba activo: ${fuera.length} de ${telefonos.length} no están entre los números de prueba y NO recibirán nada.`
            : 'Modo prueba activo: el número está entre los de prueba, así que sí le sale.',
      );
    }
  }
  if (sal && ok(sal)) {
    const s = sal.json as { nivel?: string; pausadaHasta?: string | null; ritmo?: { hoy?: number; cupoHoy?: number; enHorario?: boolean } };
    if (s.ritmo && s.ritmo.enHorario === false) avisos.push('Ahora está fuera del horario de envío del número: el sistema lo frenará y lo dirá (no se salta el horario).');
    if (s.pausadaHasta) avisos.push(`Los envíos del número están pausados hasta ${String(s.pausadaHasta).slice(0, 16).replace('T', ' ')}.`);
    if (s.nivel === 'rojo' || s.nivel === 'naranja') avisos.push(`El número está en ${s.nivel}: el anti-baneo puede frenar este envío.`);
    if (s.ritmo?.cupoHoy && s.ritmo.hoy !== undefined && s.ritmo.hoy >= s.ritmo.cupoHoy) avisos.push('Hoy ya se llegó al tope de mensajes del número: el envío quedará frenado.');
  }
  return avisos;
}
