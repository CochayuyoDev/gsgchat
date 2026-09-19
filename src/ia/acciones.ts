/**
 * Lo que la IA operadora puede hacer en el sistema, y como lo hace.
 *
 * Cada accion es un nombre corto (`lista.agregar`, `reparto.cargar`...), sus
 * parametros con su validacion, y una funcion que la ejecuta. La ejecucion
 * NO toca la base a mano: llama a los mismos endpoints que usan las
 * pantallas (`llamar`), con la identidad de quien dio la orden. Eso es lo
 * que hace que la IA no pueda mas que la persona que le habla: si a un
 * operador una ruta le dice 403, a la IA que trabaja para el tambien; y
 * todo queda en la bitacora, marcado como hecho "por la IA".
 *
 * Dos clases de acciones:
 *  - `consulta`: solo lee. Se ejecuta siempre y su resultado se le devuelve
 *    al modelo para que responda o decida el siguiente paso.
 *  - `cambio`: modifica algo. Las marcadas `peligrosa` (envios a muchos,
 *    borrar, quitar el modo prueba, tocar el ritmo) no se ejecutan sin que
 *    una persona las confirme en pantalla.
 *
 * Lo que NO hay aqui, a proposito: crear o ver claves de API, crear o
 * cambiar usuarios y contrasenas, tocar la conexion de WhatsApp, borrar
 * conversaciones. Eso se hace a mano, en su pantalla, por una persona.
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
  ejecutar: (params: P, ctx: ContextoAccion) => Promise<ResultadoAccion>;
}

const telefono = z.string().trim().min(6).max(30);
const texto = (max: number) => z.string().trim().min(1).max(max);

/** El error de una respuesta HTTP, dicho para una persona. */
function errorDe(r: RespuestaLlamada, fallback: string): ResultadoAccion {
  const j = (r.json ?? {}) as { error?: string; ir?: string };
  if (r.status === 403) return { ok: false, resumen: j.error ? `No tienes permiso: ${j.error}` : 'No tienes permiso para eso.', ir: j.ir };
  if (r.status === 404) return { ok: false, resumen: j.error ?? 'No existe (o ya no).', ir: j.ir };
  if (r.status === 401) return { ok: false, resumen: 'La sesión no es válida.' };
  return { ok: false, resumen: j.error ?? fallback, ir: j.ir };
}

const ok = (r: RespuestaLlamada) => r.status >= 200 && r.status < 300;

/** Un telefono a digitos con pais: "987 654 321" -> 51987654321 (Peru). */
export function telefonoADigitos(t: string, pais = '51'): string {
  let d = t.replace(/\D+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && pais === '51') d = pais + d;
  return d;
}

function acortar(s: unknown, n = 160): string {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** Busca un contacto por telefono o nombre a traves del panel. */
async function buscarContacto(ctx: ContextoAccion, quien: string): Promise<{ id: string; phone: string; name: string | null } | null> {
  const digitos = telefonoADigitos(quien);
  const q = /^\d{6,}$/.test(digitos) ? digitos : quien;
  const r = await ctx.llamar({ method: 'GET', url: `/admin/chat/conversations?q=${encodeURIComponent(q)}&limit=5` });
  if (!ok(r)) return null;
  const items = ((r.json as { items?: Array<{ contactId: string; phone: string; name: string | null }> }).items ?? []);
  const exacto = items.find((c) => c.phone === digitos) ?? items[0];
  if (exacto) return { id: exacto.contactId, phone: exacto.phone, name: exacto.name };
  // Sin conversacion todavia: la libreta.
  const c = await ctx.llamar({ method: 'GET', url: `/admin/contacts?q=${encodeURIComponent(q)}&limit=5` });
  if (!ok(c)) return null;
  const contactos = ((c.json as { items?: Array<{ id: string; phone: string; name: string | null }> }).items ?? []);
  const e2 = contactos.find((x) => x.phone === digitos) ?? contactos[0];
  return e2 ? { id: e2.id, phone: e2.phone, name: e2.name } : null;
}

/** Una solicitud del reparto por telefono. */
async function buscarSolicitud(ctx: ContextoAccion, telefonoONombre: string): Promise<{ id: number; phone: string | null; nombre: string | null; estado: string; referencia: string | null } | null> {
  const digitos = telefonoADigitos(telefonoONombre);
  const q = /^\d{6,}$/.test(digitos) ? digitos : telefonoONombre;
  const r = await ctx.llamar({ method: 'GET', url: `/admin/rutas/solicitudes?q=${encodeURIComponent(q)}&limit=5` });
  if (!ok(r)) return null;
  const items = ((r.json as { items?: Array<{ id: number; phone: string | null; nombre: string | null; estado: string; referencia: string | null }> }).items ?? []);
  return items.find((s) => s.phone === digitos) ?? items[0] ?? null;
}

async function buscarLote(ctx: ContextoAccion, idONombre: string): Promise<{ id: string; nombre: string; estado: string } | null> {
  const r = await ctx.llamar({ method: 'GET', url: '/admin/rutas' });
  if (!ok(r)) return null;
  const lotes = ((r.json as { lotes?: Array<{ id: string; nombre: string; estado: string }> }).lotes ?? []);
  const n = idONombre.trim().toLowerCase();
  return lotes.find((l) => l.id === idONombre) ?? lotes.find((l) => l.nombre.toLowerCase() === n) ?? lotes.find((l) => l.nombre.toLowerCase().includes(n)) ?? null;
}

const def = <P>(a: Accion<P>): Accion => a as unknown as Accion;

export const ACCIONES: Accion[] = [
  // ------------------------------------------------ lista de envio automatico
  def({
    nombre: 'lista.ver',
    tipo: 'consulta',
    descripcion: 'Ver la lista de envío automático: a quién se le está escribiendo solo, qué se le manda y cómo va.',
    parametros: '(sin parámetros)',
    ejemplo: { orden: '¿quién está en la lista de envío automático?', accion: { accion: 'lista.ver' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/envio-automatico' });
      if (!ok(r)) return errorDe(r, 'No se pudo leer la lista.');
      const j = r.json as { numeros: Array<{ phone: string; nombre: string | null; que: string; enviados: number; maxEnvios: number; situacion: string; origen: string; pausado: boolean }>; cifras: { enLista: number; hoyEnviados: number; hoyComoMucho: number }; ajustes: { cadaHoras: number; horaInicio: number; horaFin: number; maxEnvios: number } };
      const filas = j.numeros.map((n) => ({ telefono: n.phone, nombre: n.nombre, que: n.que, mensajes: `${n.enviados}/${n.maxEnvios}`, situacion: n.situacion, puestoPor: n.origen, pausado: n.pausado }));
      return {
        ok: true,
        resumen: `${j.cifras.enLista} número(s) en la lista; hoy salieron ${j.cifras.hoyEnviados} mensajes y saldrán como mucho ${j.cifras.hoyComoMucho}. Ritmo: cada ${j.ajustes.cadaHoras} h, de ${j.ajustes.horaInicio}:00 a ${j.ajustes.horaFin}:00, máximo ${j.ajustes.maxEnvios} por número.`,
        datos: filas.slice(0, 80),
        ir: '/envio-automatico',
      };
    },
  }),
  def({
    nombre: 'lista.agregar',
    tipo: 'cambio',
    descripcion: 'Poner un número en la lista de envío automático (pedirle su ubicación, o mandarle un mensaje).',
    parametros: 'telefono (obligatorio), nombre, que: "ubicacion" | "mensaje" (por defecto ubicacion), texto (obligatorio si que=mensaje), hasta: "ubicacion" | "respuesta" | "envios", referencia (pedido o motivo), maxEnvios (1-10)',
    ejemplo: { orden: 'pon a Juan, el 987 654 321, para pedirle su ubicación', accion: { accion: 'lista.agregar', telefono: '987654321', nombre: 'Juan', que: 'ubicacion' } },
    schema: z.object({
      telefono,
      nombre: z.string().trim().max(120).optional(),
      que: z.enum(['ubicacion', 'mensaje']).default('ubicacion'),
      texto: z.string().trim().max(1000).optional(),
      hasta: z.enum(['ubicacion', 'respuesta', 'envios']).optional(),
      referencia: z.string().trim().max(120).optional(),
      maxEnvios: z.coerce.number().int().min(1).max(10).optional(),
    }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/envio-automatico', body: { telefonos: p.telefono, nombre: p.nombre, que: p.que, texto: p.texto, hasta: p.hasta, referencia: p.referencia, maxEnvios: p.maxEnvios ?? null } });
      if (!ok(r)) return errorDe(r, 'No se pudo poner en la lista.');
      const j = r.json as { puestos: Array<{ phone: string; nombre: string | null; nueva: boolean }>; rechazados: Array<{ telefono: string; motivo: string }> };
      const puesto = j.puestos[0];
      if (!puesto) return { ok: false, resumen: j.rechazados[0]?.motivo ?? 'No entró en la lista.', ir: '/envio-automatico' };
      const quien = puesto.nombre ? `${puesto.nombre} (${puesto.phone})` : puesto.phone;
      return { ok: true, resumen: puesto.nueva ? `${quien} ya está en la lista: ${p.que === 'ubicacion' ? 'se le pedirá su ubicación' : 'se le mandará el mensaje'} con el ritmo de siempre.` : `${quien} ya estaba en la lista.`, ir: '/envio-automatico' };
    },
  }),
  def({
    nombre: 'lista.quitar',
    tipo: 'cambio',
    descripcion: 'Quitar un número de la lista de envío automático (si es del reparto, pasa a una persona).',
    parametros: 'telefono (o nombre, si es único)',
    ejemplo: { orden: 'quita a María de la lista', accion: { accion: 'lista.quitar', telefono: 'María' } },
    schema: z.object({ telefono: z.string().trim().min(2).max(120) }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/envio-automatico' });
      if (!ok(r)) return errorDe(r, 'No se pudo leer la lista.');
      const j = r.json as { numeros: Array<{ clave: string; phone: string; nombre: string | null; origen: string }> };
      const digitos = telefonoADigitos(p.telefono);
      const n = p.telefono.trim().toLowerCase();
      const candidatos = j.numeros.filter((x) => x.phone === digitos || (x.nombre ?? '').toLowerCase() === n || (n.length >= 3 && (x.nombre ?? '').toLowerCase().includes(n)));
      if (!candidatos.length) return { ok: false, resumen: `${p.telefono} no está en la lista.`, ir: '/envio-automatico' };
      if (candidatos.length > 1 && !candidatos.some((x) => x.phone === digitos)) {
        return { ok: false, resumen: `Hay ${candidatos.length} en la lista que coinciden con "${p.telefono}": ${candidatos.map((x) => `${x.nombre ?? 'sin nombre'} (${x.phone})`).join(', ')}. Dime el número exacto.` };
      }
      const e = candidatos.find((x) => x.phone === digitos) ?? candidatos[0]!;
      const d = await ctx.llamar({ method: 'DELETE', url: `/admin/envio-automatico/${encodeURIComponent(e.clave)}` });
      if (!ok(d)) return errorDe(d, 'No se pudo quitar.');
      const quien = e.nombre ? `${e.nombre} (${e.phone})` : e.phone;
      return { ok: true, resumen: e.origen === 'reparto' ? `${quien} salió de la lista: era del reparto y pasa a una persona para que lo llame.` : `${quien} salió de la lista: ya no se le escribe solo.`, ir: '/envio-automatico' };
    },
  }),
  def({
    nombre: 'lista.pausar',
    tipo: 'cambio',
    descripcion: 'Pausar un número de la lista (no se le escribe hasta reanudarlo).',
    parametros: 'telefono',
    ejemplo: { orden: 'pausa al 987654321 en la lista', accion: { accion: 'lista.pausar', telefono: '987654321' } },
    schema: z.object({ telefono: z.string().trim().min(2).max(120) }),
    async ejecutar(p, ctx) {
      return cambiarEstadoEnLista(ctx, p.telefono, 'pausar');
    },
  }),
  def({
    nombre: 'lista.reanudar',
    tipo: 'cambio',
    descripcion: 'Reanudar un número pausado de la lista.',
    parametros: 'telefono',
    ejemplo: { orden: 'reanuda a Juan en la lista', accion: { accion: 'lista.reanudar', telefono: 'Juan' } },
    schema: z.object({ telefono: z.string().trim().min(2).max(120) }),
    async ejecutar(p, ctx) {
      return cambiarEstadoEnLista(ctx, p.telefono, 'reanudar');
    },
  }),
  def({
    nombre: 'lista.ajustes',
    tipo: 'cambio',
    peligrosa: true,
    descripcion: 'Cambiar el ritmo del envío automático y del reparto: cada cuántas horas, máximo de mensajes por número, horario.',
    parametros: 'cadaHoras (0.25-48), maxEnvios (1-10), horaInicio (0-23), horaFin (1-24); todos opcionales',
    ejemplo: { orden: 'que escriba cada 4 horas y como mucho 2 veces', accion: { accion: 'lista.ajustes', cadaHoras: 4, maxEnvios: 2 } },
    schema: z.object({ cadaHoras: z.coerce.number().min(0.25).max(48).optional(), maxEnvios: z.coerce.number().int().min(1).max(10).optional(), horaInicio: z.coerce.number().int().min(0).max(23).optional(), horaFin: z.coerce.number().int().min(1).max(24).optional() }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/envio-automatico/ajustes', body: p });
      if (!ok(r)) return errorDe(r, 'No se pudieron guardar los ajustes.');
      const a = (r.json as { ajustes: { cadaHoras: number; maxEnvios: number; horaInicio: number; horaFin: number } }).ajustes;
      return { ok: true, resumen: `Ritmo guardado: cada ${a.cadaHoras} h, máximo ${a.maxEnvios} por número, de ${a.horaInicio}:00 a ${a.horaFin}:00.`, ir: '/envio-automatico' };
    },
  }),

  // ------------------------------------------------------------- contactos
  def({
    nombre: 'contactos.buscar',
    tipo: 'consulta',
    descripcion: 'Buscar contactos por nombre o teléfono: consentimiento, última vez que escribió.',
    parametros: 'q (nombre o teléfono), cuantos (por defecto 10)',
    ejemplo: { orden: '¿tenemos a alguien llamado Rosa?', accion: { accion: 'contactos.buscar', q: 'Rosa' } },
    schema: z.object({ q: texto(120), cuantos: z.coerce.number().int().min(1).max(50).default(10) }),
    async ejecutar(p, ctx) {
      const digitos = telefonoADigitos(p.q);
      const q = /^\d{6,}$/.test(digitos) ? digitos : p.q;
      const r = await ctx.llamar({ method: 'GET', url: `/admin/contacts?q=${encodeURIComponent(q)}&limit=${p.cuantos}` });
      if (!ok(r)) return errorDe(r, 'No se pudo buscar.');
      const j = r.json as { items: Array<{ phone: string; name: string | null; optInAt: string | null; optOutAt: string | null; lastInboundAt: string | null }>; total: number };
      const filas = j.items.map((c) => ({ telefono: c.phone, nombre: c.name, consentimiento: c.optOutAt ? 'BAJA' : c.optInAt ? 'sí' : 'no', ultimoMensaje: c.lastInboundAt }));
      return { ok: true, resumen: j.total ? `${j.total} contacto(s) coinciden con "${p.q}".` : `Ningún contacto coincide con "${p.q}".`, datos: filas, ir: '/panel#contactos' };
    },
  }),
  def({
    nombre: 'contactos.agregar',
    tipo: 'cambio',
    descripcion: 'Crear un contacto (o ponerle nombre) y registrar su consentimiento para recibir mensajes.',
    parametros: 'telefono, nombre',
    ejemplo: { orden: 'guarda a Pedro Ruiz con el 912 345 678', accion: { accion: 'contactos.agregar', telefono: '912345678', nombre: 'Pedro Ruiz' } },
    schema: z.object({ telefono, nombre: z.string().trim().max(200).optional() }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/contacts/opt-in', body: { phone: telefonoADigitos(p.telefono), name: p.nombre, source: `la IA del panel, por ${ctx.quien}` } });
      if (!ok(r)) return errorDe(r, 'No se pudo guardar el contacto.');
      return { ok: true, resumen: `${p.nombre ? `${p.nombre} (${telefonoADigitos(p.telefono)})` : telefonoADigitos(p.telefono)} guardado con consentimiento.`, ir: '/panel#contactos' };
    },
  }),
  def({
    nombre: 'contactos.baja',
    tipo: 'cambio',
    descripcion: 'Dar de baja un contacto: no recibirá más mensajes iniciados por el negocio.',
    parametros: 'telefono',
    ejemplo: { orden: 'da de baja al 987654321', accion: { accion: 'contactos.baja', telefono: '987654321' } },
    schema: z.object({ telefono }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/contacts/opt-out', body: { phone: telefonoADigitos(p.telefono) } });
      if (!ok(r)) return errorDe(r, 'No se pudo dar de baja.');
      return { ok: true, resumen: `${telefonoADigitos(p.telefono)} dado de baja: no se le escribe más salvo que él escriba primero.`, ir: '/panel#contactos' };
    },
  }),

  // -------------------------------------------------------------- mensajes
  def({
    nombre: 'mensaje.enviar',
    tipo: 'cambio',
    descripcion: 'Mandar UN mensaje de texto a UN número, como si lo escribiera una persona desde el chat.',
    parametros: 'telefono, texto',
    ejemplo: { orden: 'escríbele a Juan (987654321) que su pedido sale mañana', accion: { accion: 'mensaje.enviar', telefono: '987654321', texto: 'Hola Juan, tu pedido sale mañana.' } },
    schema: z.object({ telefono, texto: texto(4000) }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/chat/send', body: { phone: telefonoADigitos(p.telefono), text: p.texto } });
      if (!ok(r)) return errorDe(r, 'No se pudo enviar.');
      const j = r.json as { ok?: boolean; blocked?: boolean; reason?: string; error?: string };
      if (j.ok) return { ok: true, resumen: `Mensaje enviado a ${telefonoADigitos(p.telefono)}: «${acortar(p.texto, 80)}».`, ir: '/chat' };
      return { ok: false, resumen: j.blocked ? `No salió: ${j.reason}` : `No salió: ${j.error ?? 'WhatsApp lo rechazó'}`, ir: '/panel#historial' };
    },
  }),
  def({
    nombre: 'mensaje.pedirUbicacion',
    tipo: 'cambio',
    descripcion: 'Pedirle ahora mismo la ubicación a un número (una sola vez; para insistir cada pocas horas usa lista.agregar).',
    parametros: 'telefono, texto (opcional)',
    ejemplo: { orden: 'pídele la ubicación al 987654321 ahora', accion: { accion: 'mensaje.pedirUbicacion', telefono: '987654321' } },
    schema: z.object({ telefono, texto: z.string().trim().max(1000).optional() }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/chat/send', body: { phone: telefonoADigitos(p.telefono), askLocation: true, text: p.texto } });
      if (!ok(r)) return errorDe(r, 'No se pudo enviar.');
      const j = r.json as { ok?: boolean; blocked?: boolean; reason?: string; error?: string };
      return j.ok ? { ok: true, resumen: `Se le pidió la ubicación a ${telefonoADigitos(p.telefono)}.`, ir: '/chat' } : { ok: false, resumen: `No salió: ${j.reason ?? j.error ?? 'WhatsApp lo rechazó'}`, ir: '/panel#historial' };
    },
  }),

  // ------------------------------------------------------------------ chat
  def({
    nombre: 'chat.conversaciones',
    tipo: 'consulta',
    descripcion: 'Las últimas conversaciones (quién escribió, cuándo, cuántos sin leer).',
    parametros: 'q (opcional), cuantos (por defecto 10)',
    ejemplo: { orden: '¿quién nos escribió hoy?', accion: { accion: 'chat.conversaciones', cuantos: 15 } },
    schema: z.object({ q: z.string().trim().max(120).optional(), cuantos: z.coerce.number().int().min(1).max(50).default(10) }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: `/admin/chat/conversations?limit=${p.cuantos}${p.q ? `&q=${encodeURIComponent(p.q)}` : ''}` });
      if (!ok(r)) return errorDe(r, 'No se pudieron leer las conversaciones.');
      const j = r.json as { items: Array<{ phone: string; name: string | null; tipo?: string; lastMessage: { direction: string; body: string | null; createdAt: string } | null; unread?: number }> };
      const filas = j.items.filter((c) => c.tipo !== 'grupo').map((c) => ({ telefono: c.phone, nombre: c.name, ultimo: c.lastMessage?.createdAt ?? null, quien: c.lastMessage?.direction === 'in' ? 'cliente' : 'nosotros', sinLeer: c.unread ?? 0, texto: acortar(c.lastMessage?.body ?? '', 80) }));
      return { ok: true, resumen: `${filas.length} conversación(es).`, datos: filas, ir: '/chat' };
    },
  }),
  def({
    nombre: 'chat.ver',
    tipo: 'consulta',
    descripcion: 'Leer los últimos mensajes de la conversación con un número.',
    parametros: 'telefono (o nombre), cuantos (por defecto 15)',
    ejemplo: { orden: '¿qué dijo Rosa?', accion: { accion: 'chat.ver', telefono: 'Rosa', cuantos: 10 } },
    schema: z.object({ telefono: z.string().trim().min(2).max(120), cuantos: z.coerce.number().int().min(1).max(60).default(15) }),
    async ejecutar(p, ctx) {
      const c = await buscarContacto(ctx, p.telefono);
      if (!c) return { ok: false, resumen: `No encuentro ninguna conversación con "${p.telefono}".` };
      const r = await ctx.llamar({ method: 'GET', url: `/admin/chat/${encodeURIComponent(c.id)}?limit=${p.cuantos}` });
      if (!ok(r)) return errorDe(r, 'No se pudo leer el chat.');
      const j = r.json as { messages: Array<{ direction: 'in' | 'out'; body: string | null; kind: string; createdAt: string }>; reparto?: { referencia: string | null; estado: string } | null };
      const lineas = j.messages.map((m) => ({ quien: m.direction === 'in' ? 'cliente' : 'nosotros', cuando: m.createdAt, texto: acortar(m.body ?? `(${m.kind})`, 200) }));
      return { ok: true, resumen: `Conversación con ${c.name ?? c.phone} (${c.phone}): ${lineas.length} mensajes${j.reparto ? `; tiene una solicitud de ubicación del reparto (${j.reparto.estado})` : ''}.`, datos: lineas, ir: '/chat' };
    },
  }),
  def({
    nombre: 'chat.atenderPersona',
    tipo: 'cambio',
    descripcion: 'Parar (o soltar) el bot en un chat: "de este me encargo yo" / "que vuelva a contestar solo".',
    parametros: 'telefono, pausar (true = una persona atiende; false = el sistema vuelve a contestar)',
    ejemplo: { orden: 'del chat de Rosa me encargo yo', accion: { accion: 'chat.atenderPersona', telefono: 'Rosa', pausar: true } },
    schema: z.object({ telefono: z.string().trim().min(2).max(120), pausar: z.boolean().default(true) }),
    async ejecutar(p, ctx) {
      const c = await buscarContacto(ctx, p.telefono);
      if (!c) return { ok: false, resumen: `No encuentro a "${p.telefono}".` };
      const r = await ctx.llamar({ method: 'POST', url: `/admin/chat/${encodeURIComponent(c.id)}/bot`, body: { pausado: p.pausar } });
      if (!ok(r)) return errorDe(r, 'No se pudo cambiar.');
      return { ok: true, resumen: p.pausar ? `Listo: en el chat de ${c.name ?? c.phone} el sistema se calla; lo atiende una persona.` : `Listo: en el chat de ${c.name ?? c.phone} el sistema vuelve a contestar solo.`, ir: '/chat' };
    },
  }),

  // --------------------------------------------------------------- reparto
  def({
    nombre: 'reparto.estado',
    tipo: 'consulta',
    descripcion: 'Cómo va el reparto: lotes, cuántos con y sin ubicación, quién necesita a una persona.',
    parametros: '(sin parámetros)',
    ejemplo: { orden: '¿cómo va el reparto de hoy?', accion: { accion: 'reparto.estado' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/rutas' });
      if (!ok(r)) return errorDe(r, 'No se pudo leer el reparto.');
      const j = r.json as { lotes: Array<{ id: string; nombre: string; estado: string; total: number; cifras: Record<string, number> }>; cifras: Record<string, number>; alertas: { requierenPersona: number }; motor: { enHorario: boolean; trabajando: boolean } };
      const lotes = j.lotes.slice(0, 10).map((l) => ({ id: l.id, nombre: l.nombre, estado: l.estado, total: l.total, conUbicacion: l.cifras.resuelto ?? 0, esperando: (l.cifras.pendiente ?? 0) + (l.cifras.enviado ?? 0) + (l.cifras.respondio ?? 0), paraUnaPersona: (l.cifras.derivado ?? 0) + (l.cifras.supervision ?? 0) + (l.cifras.incidencia ?? 0) }));
      return { ok: true, resumen: `${j.lotes.length} lote(s); ${j.cifras.resuelto ?? 0} con ubicación, ${j.alertas.requierenPersona} esperan a una persona; ${j.motor.trabajando ? 'hay un lote en marcha' : 'ningún lote en marcha'}${j.motor.enHorario ? '' : ' (fuera de horario)'}.`, datos: lotes, ir: '/rutas' };
    },
  }),
  def({
    nombre: 'reparto.sinUbicacion',
    tipo: 'consulta',
    descripcion: 'Quiénes todavía no mandaron su ubicación (y por qué: no contesta, contestó sin pin, número sin WhatsApp...).',
    parametros: 'cuantos (por defecto 30)',
    ejemplo: { orden: '¿a quién le falta la ubicación?', accion: { accion: 'reparto.sinUbicacion' } },
    schema: z.object({ cuantos: z.coerce.number().int().min(1).max(200).default(30) }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: `/admin/rutas/solicitudes?vista=sin_ubicacion&limit=${p.cuantos}` });
      if (!ok(r)) return errorDe(r, 'No se pudo leer.');
      const j = r.json as { items: Array<{ phone: string | null; nombre: string | null; referencia: string | null; estado: string; intentos: number; incidencia: string | null; incidenciaDetalle: string | null }>; total: number };
      const filas = j.items.map((s) => ({ telefono: s.phone, nombre: s.nombre, pedido: s.referencia, estado: s.estado, mensajes: s.intentos, motivo: s.incidenciaDetalle ?? s.incidencia ?? null }));
      return { ok: true, resumen: `${j.total} cliente(s) sin ubicación todavía.`, datos: filas, ir: '/rutas' };
    },
  }),
  def({
    nombre: 'reparto.cargar',
    tipo: 'cambio',
    peligrosa: true,
    descripcion: 'Cargar un lote del reparto con clientes (se les pedirá la ubicación uno a uno) y, si se pide, arrancarlo.',
    parametros: 'nombre, filas: [{telefono, nombre, referencia (pedido), direccion, distrito}], arrancar (true/false)',
    ejemplo: { orden: 'carga el reparto de hoy con Juan 987654321 pedido 1001 y Rosa 912345678 pedido 1002, y arráncalo', accion: { accion: 'reparto.cargar', nombre: 'Reparto de hoy', filas: [{ telefono: '987654321', nombre: 'Juan', referencia: '1001' }, { telefono: '912345678', nombre: 'Rosa', referencia: '1002' }], arrancar: true } },
    schema: z.object({ nombre: z.string().trim().max(160).optional(), filas: z.array(z.object({ telefono: z.string().min(1), nombre: z.string().max(200).optional(), referencia: z.string().max(120).optional(), direccion: z.string().max(300).optional(), distrito: z.string().max(120).optional(), notas: z.string().max(500).optional() })).min(1).max(5000), arrancar: z.boolean().default(false) }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/rutas/lotes', body: { nombre: p.nombre, filas: p.filas, arrancar: p.arrancar, notas: `cargado por la IA a petición de ${ctx.quien}` } });
      if (!ok(r)) return errorDe(r, 'No se pudo cargar el lote.');
      const j = r.json as { lote: { id: string; nombre: string; estado: string }; total: number; listas: number; conIncidencia: number };
      return { ok: true, resumen: `Lote "${j.lote.nombre}" cargado: ${j.total} clientes, ${j.listas} listos para escribirles y ${j.conIncidencia} con algo que revisar. ${p.arrancar ? 'Ya está en marcha.' : 'Todavía no arrancó.'}`, datos: { loteId: j.lote.id }, ir: '/rutas' };
    },
  }),
  def({
    nombre: 'reparto.lote',
    tipo: 'cambio',
    descripcion: 'Arrancar, pausar o terminar un lote del reparto.',
    parametros: 'lote (nombre o id), estado: "enviando" (arrancar) | "pausado" | "terminado"',
    ejemplo: { orden: 'pausa el reparto de hoy', accion: { accion: 'reparto.lote', lote: 'Reparto de hoy', estado: 'pausado' } },
    schema: z.object({ lote: texto(160), estado: z.enum(['enviando', 'pausado', 'terminado', 'preparado']) }),
    async ejecutar(p, ctx) {
      const lote = await buscarLote(ctx, p.lote);
      if (!lote) return { ok: false, resumen: `No encuentro ningún lote que se llame "${p.lote}".`, ir: '/rutas' };
      const r = await ctx.llamar({ method: 'POST', url: `/admin/rutas/lotes/${encodeURIComponent(lote.id)}/estado`, body: { estado: p.estado } });
      if (!ok(r)) return errorDe(r, 'No se pudo cambiar el lote.');
      const verbo = p.estado === 'enviando' ? 'en marcha' : p.estado === 'pausado' ? 'pausado' : p.estado === 'terminado' ? 'terminado' : 'preparado';
      return { ok: true, resumen: `Lote "${lote.nombre}" ${verbo}.`, ir: '/rutas' };
    },
  }),
  def({
    nombre: 'reparto.pasarAPersona',
    tipo: 'cambio',
    descripcion: 'Dejar de escribirle a un cliente del reparto y pasarlo a una persona (para que lo llame).',
    parametros: 'telefono (o nombre), motivo (opcional)',
    ejemplo: { orden: 'a Rosa ya no le insistas, que la llame el repartidor', accion: { accion: 'reparto.pasarAPersona', telefono: 'Rosa', motivo: 'la llama el repartidor' } },
    schema: z.object({ telefono: z.string().trim().min(2).max(120), motivo: z.string().trim().max(300).optional() }),
    async ejecutar(p, ctx) {
      const s = await buscarSolicitud(ctx, p.telefono);
      if (!s) return { ok: false, resumen: `No encuentro a "${p.telefono}" en el reparto.`, ir: '/rutas' };
      const r = await ctx.llamar({ method: 'POST', url: `/admin/rutas/solicitudes/${s.id}/derivar`, body: { motivo: p.motivo ?? `pasado a una persona por la IA a petición de ${ctx.quien}` } });
      if (!ok(r)) return errorDe(r, 'No se pudo pasar a una persona.');
      return { ok: true, resumen: `${s.nombre ?? s.phone} (${s.referencia ? `pedido ${s.referencia}` : 'sin pedido'}) pasa a una persona: el sistema ya no le escribe.`, ir: '/rutas' };
    },
  }),
  def({
    nombre: 'reparto.reintentar',
    tipo: 'cambio',
    descripcion: 'Devolver a la cola a un cliente del reparto que estaba apartado (se le vuelve a pedir la ubicación).',
    parametros: 'telefono (o nombre)',
    ejemplo: { orden: 'vuelve a intentar con el 987654321', accion: { accion: 'reparto.reintentar', telefono: '987654321' } },
    schema: z.object({ telefono: z.string().trim().min(2).max(120) }),
    async ejecutar(p, ctx) {
      const s = await buscarSolicitud(ctx, p.telefono);
      if (!s) return { ok: false, resumen: `No encuentro a "${p.telefono}" en el reparto.`, ir: '/rutas' };
      const r = await ctx.llamar({ method: 'POST', url: `/admin/rutas/solicitudes/${s.id}/reintentar`, body: {} });
      if (!ok(r)) return errorDe(r, 'No se pudo devolver a la cola.');
      return { ok: true, resumen: `${s.nombre ?? s.phone} vuelve a la cola del reparto.`, ir: '/rutas' };
    },
  }),

  // ------------------------------------------------------ grupos y campanas
  def({
    nombre: 'grupo.previsualizar',
    tipo: 'consulta',
    descripcion: 'Cuántos clientes cumplen un criterio (para un envío a un grupo), y una muestra.',
    parametros: 'criterio: { consentimiento: "opt_in"|"todos", reparto: "cualquiera"|"sin_ubicacion"|"contesto_sin_ubicacion"|"derivado"|"con_ubicacion"|"incidencia"|"sin_solicitud", actividad: "cualquiera"|..., dias, q, telefonos: [] }',
    ejemplo: { orden: '¿cuántos clientes no han mandado su ubicación?', accion: { accion: 'grupo.previsualizar', criterio: { reparto: 'sin_ubicacion' } } },
    schema: z.object({ criterio: z.record(z.string(), z.unknown()).default({}) }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/grupos/previsualizar', body: p.criterio });
      if (!ok(r)) return errorDe(r, 'No se pudo previsualizar.');
      const j = r.json as { total: number; clientes: Array<{ phone: string; nombre?: string | null }> };
      return { ok: true, resumen: `${j.total} cliente(s) cumplen ese criterio.`, datos: j.clientes.slice(0, 20).map((c) => ({ telefono: c.phone, nombre: c.nombre ?? null })), ir: '/panel#grupos' };
    },
  }),
  def({
    nombre: 'grupo.enviar',
    tipo: 'cambio',
    peligrosa: true,
    descripcion: 'Mandar un mensaje a TODOS los clientes que cumplen un criterio (sale por goteo, al ritmo del número). Siempre pide confirmación.',
    parametros: 'criterio (como en grupo.previsualizar), texto (con {nombre}, {pedido}, {negocio}) o plantilla: {name, language}, nombre (de la campaña)',
    ejemplo: { orden: 'mándales a los que no dieron ubicación: "Hola {nombre}, seguimos esperando tu ubicación"', accion: { accion: 'grupo.enviar', criterio: { reparto: 'sin_ubicacion' }, texto: 'Hola {nombre}, seguimos esperando tu ubicación para {pedido}.' } },
    schema: z.object({ criterio: z.record(z.string(), z.unknown()).default({}), texto: z.string().trim().min(5).max(1024).optional(), plantilla: z.object({ name: z.string().min(1), language: z.string().default('es') }).optional(), nombre: z.string().trim().max(120).optional() }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/grupos/enviar', body: { criterio: p.criterio, texto: p.texto, plantilla: p.plantilla, nombre: p.nombre ?? `Envío pedido a la IA por ${ctx.quien}` } });
      if (!ok(r)) return errorDe(r, 'No se pudo crear el envío.');
      const j = r.json as { total?: number; campaign?: { id: string; name: string }; campana?: { id: string; name: string } };
      return { ok: true, resumen: `Envío creado para ${j.total ?? '?'} cliente(s); sale por goteo al ritmo del número.`, ir: '/panel#campanas' };
    },
  }),
  def({
    nombre: 'campanas.ver',
    tipo: 'consulta',
    descripcion: 'Las campañas y cómo van.',
    parametros: '(sin parámetros)',
    ejemplo: { orden: '¿cómo van las campañas?', accion: { accion: 'campanas.ver' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/campaigns' });
      if (!ok(r)) return errorDe(r, 'No se pudieron leer las campañas.');
      const lista = (Array.isArray(r.json) ? r.json : (r.json as { items?: unknown[] }).items ?? []) as Array<{ id: string; name: string; status?: string; estado?: string; total?: number }>;
      return { ok: true, resumen: `${lista.length} campaña(s).`, datos: lista.slice(0, 20).map((c) => ({ id: c.id, nombre: c.name, estado: c.status ?? c.estado ?? null, total: c.total ?? null })), ir: '/panel#campanas' };
    },
  }),
  def({
    nombre: 'campana.estado',
    tipo: 'cambio',
    descripcion: 'Pausar, reanudar o parar una campaña.',
    parametros: 'campana (id o nombre), accion: "pausar" | "reanudar" | "parar"',
    ejemplo: { orden: 'pausa la campaña de septiembre', accion: { accion: 'campana.estado', campana: 'septiembre', accionCampana: 'pausar' } },
    schema: z.object({ campana: texto(120), accionCampana: z.enum(['pausar', 'reanudar', 'parar']) }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/campaigns' });
      if (!ok(r)) return errorDe(r, 'No se pudieron leer las campañas.');
      const lista = (Array.isArray(r.json) ? r.json : (r.json as { items?: unknown[] }).items ?? []) as Array<{ id: string; name: string }>;
      const n = p.campana.toLowerCase();
      const c = lista.find((x) => x.id === p.campana) ?? lista.find((x) => x.name.toLowerCase().includes(n));
      if (!c) return { ok: false, resumen: `No encuentro la campaña "${p.campana}".`, ir: '/panel#campanas' };
      const e = await ctx.llamar({ method: 'POST', url: `/admin/campaigns/${encodeURIComponent(c.id)}/estado`, body: { accion: p.accionCampana, motivo: `por la IA a petición de ${ctx.quien}` } });
      if (!ok(e)) return errorDe(e, 'No se pudo cambiar la campaña.');
      return { ok: true, resumen: `Campaña "${c.name}": ${p.accionCampana === 'pausar' ? 'pausada' : p.accionCampana === 'reanudar' ? 'reanudada' : 'parada'}.`, ir: '/panel#campanas' };
    },
  }),

  // -------------------------------------------------------- numero y salud
  def({
    nombre: 'numero.estado',
    tipo: 'consulta',
    descripcion: 'Cómo está el número: conectado, nivel de riesgo (verde/amarillo/naranja/rojo), cupo de hoy, por qué frena.',
    parametros: '(sin parámetros)',
    ejemplo: { orden: '¿por qué no salen mensajes?', accion: { accion: 'numero.estado' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const [h, s] = await Promise.all([ctx.llamar({ method: 'GET', url: '/admin/health' }), ctx.llamar({ method: 'GET', url: '/admin/salud' })]);
      const salud = ok(s) ? (s.json as { nivel?: string; factor?: number; motivos?: string[]; pausadaHasta?: string | null; ritmo?: { hoy?: number; cupoHoy?: number; enHorario?: boolean } }) : {};
      const health = ok(h) ? (h.json as Record<string, unknown>) : {};
      const resumen = `Nivel ${salud.nivel ?? '?'}${salud.motivos?.length ? ` (${salud.motivos.join('; ')})` : ''}; hoy ${salud.ritmo?.hoy ?? '?'} de ${salud.ritmo?.cupoHoy ?? '?'} del cupo; ${salud.ritmo?.enHorario ? 'en horario' : 'fuera de horario'}${salud.pausadaHasta ? `; pausado hasta ${salud.pausadaHasta}` : ''}.`;
      return { ok: true, resumen, datos: { conexion: health, salud: { nivel: salud.nivel, factor: salud.factor, motivos: salud.motivos, ritmo: salud.ritmo } }, ir: '/panel#estado' };
    },
  }),
  def({
    nombre: 'numero.pausarEnvios',
    tipo: 'cambio',
    peligrosa: true,
    descripcion: 'Pausar (o reanudar) TODOS los envíos del número a mano.',
    parametros: 'pausar (true/false), motivo',
    ejemplo: { orden: 'para todos los envíos ahora mismo', accion: { accion: 'numero.pausarEnvios', pausar: true, motivo: 'lo pidió el dueño' } },
    schema: z.object({ pausar: z.boolean(), motivo: z.string().trim().max(200).optional() }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/pause', body: { paused: p.pausar, reason: p.motivo ?? `por la IA a petición de ${ctx.quien}` } });
      if (!ok(r)) return errorDe(r, 'No se pudo cambiar.');
      return { ok: true, resumen: p.pausar ? 'Todos los envíos quedan pausados hasta que alguien los reanude.' : 'Los envíos vuelven a salir.', ir: '/panel#estado' };
    },
  }),
  def({
    nombre: 'historial.envios',
    tipo: 'consulta',
    descripcion: 'Lo último que salió (o no salió) y por qué: entregado, bloqueado por una guarda, rechazado por WhatsApp.',
    parametros: 'telefono (opcional), cuantos (por defecto 15)',
    ejemplo: { orden: '¿le llegó el mensaje al 987654321?', accion: { accion: 'historial.envios', telefono: '987654321', cuantos: 5 } },
    schema: z.object({ telefono: z.string().trim().max(30).optional(), cuantos: z.coerce.number().int().min(1).max(100).default(15) }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: `/admin/deliveries?limit=${p.cuantos}${p.telefono ? `&phone=${encodeURIComponent(telefonoADigitos(p.telefono))}` : ''}` });
      if (!ok(r)) return errorDe(r, 'No se pudo leer el historial.');
      const lista = (Array.isArray(r.json) ? r.json : (r.json as { items?: unknown[] }).items ?? []) as Array<{ phone?: string; name?: string | null; status?: string; errorTitle?: string | null; errorCode?: string | null; queuedAt?: string; kind?: string; templateName?: string | null }>;
      return { ok: true, resumen: `${lista.length} envío(s) en el historial.`, datos: lista.slice(0, p.cuantos).map((d) => ({ telefono: d.phone, nombre: d.name ?? null, tipo: d.templateName ? `plantilla ${d.templateName}` : d.kind, estado: d.status, motivo: d.errorTitle ?? d.errorCode ?? null, cuando: d.queuedAt })), ir: '/panel#historial' };
    },
  }),
  def({
    nombre: 'ubicaciones.ver',
    tipo: 'consulta',
    descripcion: 'Las últimas ubicaciones recibidas (con su enlace de mapa).',
    parametros: 'telefono (opcional), cuantos (por defecto 10)',
    ejemplo: { orden: '¿qué ubicación mandó Juan?', accion: { accion: 'ubicaciones.ver', telefono: '987654321', cuantos: 1 } },
    schema: z.object({ telefono: z.string().trim().max(30).optional(), cuantos: z.coerce.number().int().min(1).max(100).default(10) }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: `/admin/locations?limit=${p.cuantos}${p.telefono ? `&phone=${encodeURIComponent(telefonoADigitos(p.telefono))}` : ''}` });
      if (!ok(r)) return errorDe(r, 'No se pudieron leer las ubicaciones.');
      const lista = (Array.isArray(r.json) ? r.json : (r.json as { items?: unknown[] }).items ?? []) as Array<{ phone?: string; name?: string | null; lat?: number; lng?: number; resolvedUrl?: string | null; createdAt?: string; confirmed?: boolean }>;
      return { ok: true, resumen: `${lista.length} ubicación(es).`, datos: lista.slice(0, p.cuantos).map((l) => ({ telefono: l.phone, nombre: l.name ?? null, mapa: l.resolvedUrl ?? (l.lat !== undefined ? `https://maps.google.com/?q=${l.lat},${l.lng}` : null), cuando: l.createdAt ?? null, confirmada: l.confirmed ?? null })), ir: '/panel#ubicaciones' };
    },
  }),

  // -------------------------------------------------------- configuracion
  def({
    nombre: 'configuracion.ver',
    tipo: 'consulta',
    soloAdmin: true,
    descripcion: 'La configuración vigente: nombre, horario, modo prueba, ritmo, a quién se avisa.',
    parametros: '(sin parámetros)',
    ejemplo: { orden: '¿está activo el modo prueba?', accion: { accion: 'configuracion.ver' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/ajustes' });
      if (!ok(r)) return errorDe(r, 'No se pudo leer la configuración.');
      const j = r.json as { efectivo?: Record<string, unknown>; guardado?: Record<string, unknown> };
      return { ok: true, resumen: 'Configuración leída.', datos: j.efectivo ?? j.guardado ?? j, ir: '/panel#configuracion' };
    },
  }),
  def({
    nombre: 'configuracion.cambiar',
    tipo: 'cambio',
    peligrosa: true,
    soloAdmin: true,
    descripcion: 'Cambiar la configuración: nombre del negocio, horario de envío, modo prueba (activo y números), supervisor a quien avisar.',
    parametros: 'nombreNegocio, horario: {inicio, fin}, modoPrueba: {activo, numeros: []}, avisos: {supervisor}; solo lo que se cambia',
    ejemplo: { orden: 'apaga el modo prueba', accion: { accion: 'configuracion.cambiar', modoPrueba: { activo: false } } },
    schema: z.object({ nombreNegocio: z.string().trim().max(80).optional(), horario: z.object({ inicio: z.coerce.number().int().min(0).max(23).optional(), fin: z.coerce.number().int().min(1).max(24).optional() }).optional(), modoPrueba: z.object({ activo: z.boolean().optional(), numeros: z.array(z.string()).max(50).optional() }).optional(), avisos: z.object({ supervisor: z.string().nullable().optional() }).optional() }),
    async ejecutar(p, ctx) {
      const body: Record<string, unknown> = {};
      if (p.nombreNegocio) body.nombreNegocio = p.nombreNegocio;
      if (p.horario) body.horario = p.horario;
      if (p.modoPrueba) body.modoPrueba = { ...p.modoPrueba, numeros: p.modoPrueba.numeros?.map((n) => telefonoADigitos(n)) };
      if (p.avisos) body.avisos = { supervisor: p.avisos.supervisor ? telefonoADigitos(p.avisos.supervisor) : p.avisos.supervisor };
      const r = await ctx.llamar({ method: 'POST', url: '/admin/ajustes', body });
      if (!ok(r)) return errorDe(r, 'No se pudo guardar la configuración.');
      return { ok: true, resumen: `Configuración guardada (${Object.keys(body).join(', ')}).`, ir: '/panel#configuracion' };
    },
  }),
  def({
    nombre: 'plantillas.ver',
    tipo: 'consulta',
    descripcion: 'Las plantillas (mensajes aprobados) y su estado.',
    parametros: '(sin parámetros)',
    ejemplo: { orden: '¿qué plantillas tenemos aprobadas?', accion: { accion: 'plantillas.ver' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/templates' });
      if (!ok(r)) return errorDe(r, 'No se pudieron leer las plantillas.');
      const lista = (Array.isArray(r.json) ? r.json : (r.json as { items?: unknown[]; templates?: unknown[] }).items ?? (r.json as { templates?: unknown[] }).templates ?? []) as Array<{ name: string; language?: string; status?: string; category?: string; body?: string }>;
      return { ok: true, resumen: `${lista.length} plantilla(s).`, datos: lista.slice(0, 40).map((t) => ({ nombre: t.name, idioma: t.language, estado: t.status, tipo: t.category, texto: acortar(t.body ?? '', 100) })), ir: '/panel#plantillas' };
    },
  }),
  def({
    nombre: 'ia.saber',
    tipo: 'cambio',
    soloAdmin: true,
    descripcion: 'Añadir algo a lo que sabe el asistente de WhatsApp (precios, envíos, horarios, políticas).',
    parametros: 'texto (lo que tiene que saber, una o varias líneas)',
    ejemplo: { orden: 'que el asistente sepa que hacemos envíos a Trujillo en 2 días', accion: { accion: 'ia.saber', texto: 'Envíos a Trujillo: llegan en 2 días.' } },
    schema: z.object({ texto: texto(4000) }),
    async ejecutar(p, ctx) {
      const actual = await ctx.llamar({ method: 'GET', url: '/admin/ia' });
      if (!ok(actual)) return errorDe(actual, 'No se pudo leer lo que sabe el asistente.');
      const conocimiento = String((actual.json as { conocimiento?: string }).conocimiento ?? '');
      const nuevo = `${conocimiento.trim()}\n${p.texto.trim()}`.trim().slice(0, 20_000);
      const r = await ctx.llamar({ method: 'POST', url: '/admin/ia', body: { conocimiento: nuevo } });
      if (!ok(r)) return errorDe(r, 'No se pudo guardar.');
      return { ok: true, resumen: `El asistente ya lo sabe: «${acortar(p.texto, 100)}».`, ir: '/panel#ia' };
    },
  }),
  def({
    nombre: 'ia.estado',
    tipo: 'consulta',
    descripcion: 'Si el asistente de WhatsApp está encendido, con qué modelo, y un resumen de lo que sabe.',
    parametros: '(sin parámetros)',
    ejemplo: { orden: '¿está encendido el asistente?', accion: { accion: 'ia.estado' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/ia' });
      if (!ok(r)) return errorDe(r, 'No se pudo leer.');
      const j = r.json as { activa?: boolean; tieneToken?: boolean; modeloEfectivo?: string; conocimiento?: string; nombreAsistente?: string };
      return { ok: true, resumen: `Asistente "${j.nombreAsistente ?? ''}": ${j.activa ? 'encendido' : 'apagado'}${j.tieneToken ? '' : ' (sin conexión a Puter)'}; modelo ${j.modeloEfectivo ?? '?'}; sabe ${(j.conocimiento ?? '').length} caracteres de texto.`, datos: { conocimiento: acortar(j.conocimiento ?? '', 600) }, ir: '/panel#ia' };
    },
  }),

  // --------------------------------------------------------- entrenamiento
  def({
    nombre: 'ia.ensenar',
    tipo: 'cambio',
    descripcion: 'Enseñarle una lección al asistente de WhatsApp: un ejemplo (cuando el cliente diga X, contesta Y), un dato o una regla. Queda en uso al momento.',
    parametros: 'tipo (ejemplo | dato | regla; por defecto ejemplo), pregunta (lo que dice el cliente; obligatoria en un ejemplo), respuesta (lo que hay que contestar, o el dato, o la regla), tema (opcional: envios, pagos, precios...)',
    ejemplo: { orden: 'enséñale que si preguntan por envíos a Trujillo diga que tardan 2 días y cuestan S/ 15', accion: { accion: 'ia.ensenar', tipo: 'ejemplo', pregunta: '¿Hacen envíos a Trujillo?', respuesta: 'Sí, enviamos a Trujillo: llega en 2 días y cuesta S/ 15.', tema: 'envios' } },
    schema: z.object({ tipo: z.enum(['ejemplo', 'dato', 'regla']).default('ejemplo'), pregunta: z.string().trim().max(1000).optional(), respuesta: texto(4000), tema: z.string().trim().max(60).optional() }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/entrenamiento/lecciones', body: { tipo: p.tipo, pregunta: p.pregunta ?? null, respuesta: p.respuesta, tema: p.tema ?? null, origen: 'manual', origenDetalle: 'por la IA operadora' } });
      if (!ok(r)) return errorDe(r, 'No se pudo guardar la lección.');
      const j = r.json as { nueva?: boolean; leccion?: { id: number } };
      return { ok: true, resumen: j.nueva ? `Aprendido (lección #${j.leccion?.id}): «${acortar(p.pregunta ? `${p.pregunta} → ${p.respuesta}` : p.respuesta, 140)}».` : 'Eso ya lo sabía: la lección ya existía.', ir: '/entrenamiento' };
    },
  }),
  def({
    nombre: 'ia.lecciones',
    tipo: 'consulta',
    descripcion: 'Qué sabe el asistente: cuántas lecciones tiene en uso (ejemplos, datos, reglas), cuántas esperan revisión, cómo fue el último examen; o buscar lecciones por texto o tema.',
    parametros: 'q (texto a buscar, opcional), tema (opcional), estado (activa | pendiente | descartada, opcional), cuantas (por defecto 10)',
    ejemplo: { orden: '¿qué sabe el asistente sobre envíos?', accion: { accion: 'ia.lecciones', q: 'envío' } },
    schema: z.object({ q: z.string().trim().max(200).optional(), tema: z.string().trim().max(60).optional(), estado: z.enum(['activa', 'pendiente', 'descartada']).optional(), cuantas: z.coerce.number().int().min(1).max(50).default(10) }),
    async ejecutar(p, ctx) {
      const resumen = await ctx.llamar({ method: 'GET', url: '/admin/entrenamiento' });
      if (!ok(resumen)) return errorDe(resumen, 'No se pudo leer el entrenamiento.');
      const c = (resumen.json as { cifras: { porEstado: Record<string, number>; porTipo: Record<string, number>; fallanExamen: number }; examenes: Array<{ estado: string; aprobados: number; fallados: number; detalle?: { porcentaje?: number } }> }).cifras;
      const ultimo = (resumen.json as { examenes: Array<{ estado: string; aprobados: number; fallados: number; detalle?: { porcentaje?: number } }> }).examenes.find((e) => e.estado !== 'corriendo');
      const lineas = [`${c.porEstado.activa ?? 0} lecciones en uso (${c.porTipo.ejemplo ?? 0} ejemplos, ${c.porTipo.dato ?? 0} datos, ${c.porTipo.regla ?? 0} reglas)${c.porEstado.pendiente ? `, ${c.porEstado.pendiente} pendientes de revisar` : ''}.`];
      if (ultimo) lineas.push(`Último examen: ${ultimo.detalle?.porcentaje ?? '?'} % (${ultimo.aprobados} bien, ${ultimo.fallados} mal)${c.fallanExamen ? `; ${c.fallanExamen} en uso fallaron.` : '.'}`);
      let datos: unknown;
      if (p.q || p.tema || p.estado) {
        const q = new URLSearchParams();
        if (p.q) q.set('q', p.q);
        if (p.tema) q.set('tema', p.tema);
        if (p.estado) q.set('estado', p.estado);
        q.set('limite', String(p.cuantas));
        const r = await ctx.llamar({ method: 'GET', url: `/admin/entrenamiento/lecciones?${q.toString()}` });
        if (ok(r)) {
          const j = r.json as { items: Array<{ id: number; tipo: string; pregunta: string | null; respuesta: string; tema: string | null; estado: string }>; total: number };
          lineas.push(`${j.total} lección(es) coinciden.`);
          datos = j.items.map((l) => ({ id: l.id, tipo: l.tipo, cliente: l.pregunta, respuesta: acortar(l.respuesta, 200), tema: l.tema, estado: l.estado }));
        }
      }
      return { ok: true, resumen: lineas.join(' '), datos, ir: '/entrenamiento' };
    },
  }),
  def({
    nombre: 'ia.aprenderDeChats',
    tipo: 'cambio',
    soloAdmin: true,
    descripcion: 'Que el asistente aprenda de las conversaciones reales: recorre todos los chats y guarda cada respuesta que dio una persona del negocio como lección pendiente de revisar (o en uso directo si se pide).',
    parametros: 'desde (fecha AAAA-MM-DD, opcional), revisar (true por defecto: quedan pendientes; false: en uso desde ya)',
    ejemplo: { orden: 'que aprenda de todos los chats de este año', accion: { accion: 'ia.aprenderDeChats', desde: '2026-01-01', revisar: true } },
    schema: z.object({ desde: z.string().trim().max(30).optional(), revisar: z.boolean().default(true) }),
    peligrosa: true,
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/entrenamiento/aprender', body: { desde: p.desde, revisar: p.revisar } });
      if (!ok(r)) return errorDe(r, 'No se pudo arrancar el aprendizaje.');
      return { ok: true, resumen: `Aprendiendo de los chats${p.desde ? ` desde ${p.desde}` : ''}; lo aprendido queda ${p.revisar ? 'pendiente de revisar' : 'en uso'}. El avance se ve en Entrenar a la IA.`, ir: '/entrenamiento' };
    },
  }),
  def({
    nombre: 'ia.examinar',
    tipo: 'cambio',
    soloAdmin: true,
    descripcion: 'Examinar al asistente en masa: le hace la pregunta de cada lección y comprueba que responda como se le enseñó. Tarda (unos segundos por lección).',
    parametros: 'tema (opcional), muestra (cuántas al azar; sin esto, todas), soloFallidas (true = solo las que fallaron la última vez)',
    ejemplo: { orden: 'examínala con 100 lecciones al azar', accion: { accion: 'ia.examinar', muestra: 100 } },
    schema: z.object({ tema: z.string().trim().max(60).optional(), muestra: z.coerce.number().int().min(1).max(5000).optional(), soloFallidas: z.boolean().default(false) }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/entrenamiento/examen', body: { tema: p.tema, muestra: p.muestra, soloFallidas: p.soloFallidas } });
      if (!ok(r)) return errorDe(r, 'No se pudo lanzar el examen.');
      const t = (r.json as { trabajo?: { total?: number } }).trabajo;
      return { ok: true, resumen: `Examen en marcha con ${t?.total ?? '?'} lecciones. El resultado se ve en Entrenar a la IA (y en ia.lecciones cuando termine).`, ir: '/entrenamiento#examen' };
    },
  }),

  // --------------------------------------------------------------- sistema
  def({
    nombre: 'sistema.resumen',
    tipo: 'consulta',
    descripcion: 'Un vistazo a todo: mensajes de hoy, chats sin leer, reparto, campañas, estado del número.',
    parametros: '(sin parámetros)',
    ejemplo: { orden: '¿cómo va todo hoy?', accion: { accion: 'sistema.resumen' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/resumen' });
      if (!ok(r)) return errorDe(r, 'No se pudo leer el resumen.');
      return { ok: true, resumen: 'Resumen leído.', datos: r.json, ir: '/panel#inicio' };
    },
  }),
  def({
    nombre: 'actividad.ver',
    tipo: 'consulta',
    soloAdmin: true,
    descripcion: 'La bitácora: quién hizo qué y cuándo.',
    parametros: 'cuantos (por defecto 20)',
    ejemplo: { orden: '¿quién cambió la configuración?', accion: { accion: 'actividad.ver', cuantos: 30 } },
    schema: z.object({ cuantos: z.coerce.number().int().min(1).max(100).default(20) }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: `/admin/actividad?limit=${p.cuantos}` });
      if (!ok(r)) return errorDe(r, 'No se pudo leer la bitácora.');
      const j = r.json as { items?: Array<{ at: string; usuario: string; accion: string }>; etiquetas?: Record<string, string> };
      return { ok: true, resumen: `${j.items?.length ?? 0} entrada(s).`, datos: (j.items ?? []).map((e) => ({ cuando: e.at, quien: e.usuario, que: j.etiquetas?.[e.accion] ?? e.accion })), ir: '/panel#actividad' };
    },
  }),
  def({
    nombre: 'integraciones.ver',
    tipo: 'consulta',
    soloAdmin: true,
    descripcion: 'Qué otros sistemas están conectados: conectores de tiendas y webhooks (sin secretos).',
    parametros: '(sin parámetros)',
    ejemplo: { orden: '¿qué tiendas tenemos conectadas?', accion: { accion: 'integraciones.ver' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const [c, w] = await Promise.all([ctx.llamar({ method: 'GET', url: '/api/v1/conectores' }), ctx.llamar({ method: 'GET', url: '/api/v1/webhooks' })]);
      const conectores = ok(c) ? (((c.json as { conectores?: unknown[] }).conectores ?? []) as Array<{ tipo: string; nombre: string; activo: boolean; eventosRecibidos?: number }>) : [];
      const webhooks = ok(w) ? (((w.json as { webhooks?: unknown[] }).webhooks ?? []) as Array<{ url: string; activo?: boolean; eventos?: string[] }>) : [];
      return { ok: true, resumen: `${conectores.length} conector(es) de tienda y ${webhooks.length} webhook(s).`, datos: { conectores: conectores.map((x) => ({ tipo: x.tipo, nombre: x.nombre, activo: x.activo, eventos: x.eventosRecibidos })), webhooks: webhooks.map((x) => ({ url: x.url, activo: x.activo, eventos: x.eventos })) }, ir: '/panel#integraciones' };
    },
  }),
  def({
    nombre: 'catalogo.buscar',
    tipo: 'consulta',
    descripcion: 'Buscar un producto en el catálogo de Stoky (precio y stock reales), si está conectado.',
    parametros: 'q (nombre del producto), cuantos (por defecto 5)',
    ejemplo: { orden: '¿hay stock del zapato negro 42?', accion: { accion: 'catalogo.buscar', q: 'zapato negro 42' } },
    schema: z.object({ q: texto(120), cuantos: z.coerce.number().int().min(1).max(20).default(5) }),
    async ejecutar(p, ctx) {
      if (!ctx.catalogo) return { ok: false, resumen: 'Stoky no está conectado a este sistema: no hay catálogo que consultar.', ir: '/panel#integraciones' };
      const encontrados = await ctx.catalogo.buscar(p.q, p.cuantos).catch(() => []);
      if (!encontrados.length) return { ok: true, resumen: `No hay ningún producto que coincida con "${p.q}".` };
      return { ok: true, resumen: `${encontrados.length} producto(s) para "${p.q}".`, datos: encontrados.map((x) => ({ nombre: x.name, precio: x.price ?? null, stock: x.stock })) };
    },
  }),
];

async function cambiarEstadoEnLista(ctx: ContextoAccion, quien: string, que: 'pausar' | 'reanudar'): Promise<ResultadoAccion> {
  const r = await ctx.llamar({ method: 'GET', url: '/admin/envio-automatico' });
  if (!ok(r)) return errorDe(r, 'No se pudo leer la lista.');
  const j = r.json as { numeros: Array<{ clave: string; phone: string; nombre: string | null; origen: string }> };
  const digitos = telefonoADigitos(quien);
  const n = quien.trim().toLowerCase();
  const e = j.numeros.find((x) => x.phone === digitos) ?? j.numeros.find((x) => (x.nombre ?? '').toLowerCase() === n) ?? j.numeros.find((x) => n.length >= 3 && (x.nombre ?? '').toLowerCase().includes(n));
  if (!e) return { ok: false, resumen: `${quien} no está en la lista.`, ir: '/envio-automatico' };
  const p = await ctx.llamar({ method: 'POST', url: `/admin/envio-automatico/${encodeURIComponent(e.clave)}/${que}`, body: {} });
  if (!ok(p)) return errorDe(p, `No se pudo ${que}.`);
  const nombre = e.nombre ? `${e.nombre} (${e.phone})` : e.phone;
  return { ok: true, resumen: que === 'pausar' ? `${nombre} en pausa: no se le escribe hasta reanudarlo.` : `${nombre} reanudado.`, ir: '/envio-automatico' };
}

export const ACCIONES_POR_NOMBRE = new Map(ACCIONES.map((a) => [a.nombre, a]));

/** El catalogo tal y como se le cuenta al modelo. */
export function catalogoParaElModelo(opts: { esAdmin: boolean; conCatalogo: boolean }): string {
  return ACCIONES.filter((a) => (opts.esAdmin || !a.soloAdmin) && (opts.conCatalogo || a.nombre !== 'catalogo.buscar'))
    .map((a) => `- ${a.nombre} [${a.tipo}${a.peligrosa ? ', pide confirmación' : ''}]: ${a.descripcion} Parámetros: ${a.parametros}. Ej.: «${a.ejemplo.orden}» → ${JSON.stringify(a.ejemplo.accion)}`)
    .join('\n');
}

/** El catalogo para la pantalla (ayuda "que le puedo pedir"). */
export function catalogoParaPantalla(): Array<{ nombre: string; tipo: TipoAccion; descripcion: string; ejemplo: string; peligrosa: boolean; soloAdmin: boolean }> {
  return ACCIONES.map((a) => ({ nombre: a.nombre, tipo: a.tipo, descripcion: a.descripcion, ejemplo: a.ejemplo.orden, peligrosa: Boolean(a.peligrosa), soloAdmin: Boolean(a.soloAdmin) }));
}
