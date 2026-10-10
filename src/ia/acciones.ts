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
 *  - `cambio`: modifica algo. NINGUNO se ejecuta sin que la persona pulse
 *    «Hacerlo» en su tarjeta (decision del dueño, 28/09): primero se prepara
 *    leyendo (`preparar`, ver acciones-base.ts) y se enseña exactamente lo
 *    que va a pasar; las `peligrosa` llevan ademas su aviso.
 *
 * Las acciones de las pantallas del panel (Hoy, Numeros del dia,
 * Motorizados, Chats, Ajustes, Respuestas rapidas, Campañas...) viven en
 * acciones-panel.ts; aqui quedan las de siempre y se juntan todas abajo.
 *
 * Lo que NO hay aqui, a proposito: crear o ver claves de API, crear o
 * cambiar usuarios y contrasenas, tocar la conexion de WhatsApp, borrar
 * conversaciones. Eso se hace a mano, en su pantalla, por una persona.
 */

import { z } from 'zod';
import { acortar, def, errorDe, ok, telefono, telefonoADigitos, texto, type Accion, type ContextoAccion, type Preparado, type ResultadoAccion, type TipoAccion } from './acciones-base.js';
import { ACCIONES_PANEL, PREPARAR_DE_SIEMPRE } from './acciones-panel.js';
import { ACCIONES_MENSAJES } from './acciones-mensajes.js';
import { ACCIONES_INFORMES } from './acciones-informes.js';
import { ACCIONES_GENERAL } from './acciones-general.js';
import { ACCIONES_CHATS } from './acciones-chats.js';

export type { Accion, ContextoAccion, Llamada, Llamar, Preparado, ResultadoAccion, RespuestaLlamada, Tarjeta, TipoAccion } from './acciones-base.js';
export { telefonoADigitos } from './acciones-base.js';

/** Busca un motorizado por nombre o telefono. */
async function buscarMotorizado(ctx: ContextoAccion, quien: string): Promise<{ id: number; nombre: string; phone: string } | null> {
  const r = await ctx.llamar({ method: 'GET', url: '/admin/motorizados' });
  if (!ok(r)) return null;
  const lista = ((r.json as { motorizados?: Array<{ id: number; nombre: string; phone: string }> }).motorizados ?? []);
  const digitos = telefonoADigitos(quien);
  const q = quien.trim().toLowerCase();
  return lista.find((m) => /^\d{6,}$/.test(digitos) && m.phone === digitos) ?? lista.find((m) => m.nombre.toLowerCase() === q) ?? lista.find((m) => m.nombre.toLowerCase().includes(q)) ?? null;
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

const ACCIONES_DE_SIEMPRE: Accion[] = [
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

  // ------------------------------------------------------------ entregas
  def({
    nombre: 'entregas.ver',
    tipo: 'consulta',
    descripcion: 'Las entregas de hoy: cuántas faltan de ubicación, cuántas de confirmar, cuáles esperan motorizado, cuáles ya tienen hora de llegada, cuáles necesitan una persona. Con "q" filtra por nombre, pedido o teléfono.',
    parametros: 'q (opcional), estado (opcional: esperando_ubicacion | esperando_confirmacion | lista | esperando_motorizado | avisada | terminada | cancelada | incidencia)',
    ejemplo: { orden: '¿cómo van las entregas de hoy?', accion: { accion: 'entregas.ver' } },
    schema: z.object({ q: z.string().trim().max(120).optional(), estado: z.string().trim().max(40).optional() }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/entregas' });
      if (!ok(r)) return errorDe(r, 'No se pudieron leer las entregas.');
      const j = r.json as { dia: string; cifras: Record<string, number>; entregas: Array<{ id: number; referencia: string; phone: string; nombre: string | null; estado: string; situacion: string; motorizado: { nombre: string } | null; llegaAproxAt: string | null }> };
      const q = (p.q ?? '').toLowerCase();
      const lista = j.entregas.filter((e) => (!p.estado || e.estado === p.estado) && (!q || (e.nombre ?? '').toLowerCase().includes(q) || e.referencia.toLowerCase().includes(q) || e.phone.includes(q.replace(/\D/g, '') || '§')));
      const c = j.cifras;
      const resumen = `Entregas de hoy (${j.dia}): ${c.total} en total · ${c.faltaUbicacion} sin ubicación · ${c.faltaConfirmacion} sin confirmar · ${c.lista} listas · ${c.esperando_motorizado} esperando motorizado · ${(c.avisada ?? 0) + (c.terminada ?? 0)} con hora de llegada · ${c.incidencia} necesitan una persona · ${c.cancelada} canceladas.`;
      return { ok: true, resumen, datos: lista.slice(0, 30).map((e) => ({ id: e.id, pedido: e.referencia, cliente: e.nombre ?? e.phone, telefono: e.phone, estado: e.estado, situacion: e.situacion, motorizado: e.motorizado?.nombre ?? null, llega: e.llegaAproxAt })), ir: '/entregas' };
    },
  }),
  def({
    nombre: 'motorizados.ver',
    tipo: 'consulta',
    descripcion: 'Los motorizados: quiénes están activos, su zona y cuántas entregas llevan hoy.',
    parametros: '(ninguno)',
    ejemplo: { orden: '¿qué motorizados hay hoy?', accion: { accion: 'motorizados.ver' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/entregas' });
      if (!ok(r)) return errorDe(r, 'No se pudieron leer los motorizados.');
      const j = r.json as { motorizados: Array<{ id: number; nombre: string; phone: string; placa: string | null; zona: string | null; estado: string; entregasHoy: number; enManos: number }> };
      const activos = j.motorizados.filter((m) => m.estado === 'activo');
      return { ok: true, resumen: `${activos.length} motorizados activos de ${j.motorizados.length}: ${activos.map((m) => `${m.nombre} (${m.entregasHoy} hoy${m.enManos ? `, ${m.enManos} en mano` : ''})`).join(', ') || 'ninguno'}.`, datos: j.motorizados.map((m) => ({ id: m.id, nombre: m.nombre, telefono: m.phone, placa: m.placa, zona: m.zona, estado: m.estado, hoy: m.entregasHoy, enMano: m.enManos })), ir: '/entregas' };
    },
  }),
  def({
    nombre: 'motorizados.alta',
    tipo: 'cambio',
    descripcion: 'Dar de alta un motorizado con su WhatsApp (y su zona y placa si se dicen).',
    parametros: 'nombre, telefono, zona (opcional), placa (opcional)',
    ejemplo: { orden: 'da de alta al motorizado Carlos Rojas, 999000001, zona Miraflores y San Isidro', accion: { accion: 'motorizados.alta', nombre: 'Carlos Rojas', telefono: '999000001', zona: 'Miraflores, San Isidro' } },
    schema: z.object({ nombre: texto(120), telefono, zona: z.string().trim().max(300).optional(), placa: z.string().trim().max(20).optional() }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/motorizados', body: { nombre: p.nombre, telefono: p.telefono, zona: p.zona, placa: p.placa } });
      if (!ok(r)) return errorDe(r, 'No se pudo dar de alta.');
      const j = r.json as { nuevo: boolean; motorizado: { nombre: string; phone: string } };
      return { ok: true, resumen: j.nuevo ? `${j.motorizado.nombre} (${j.motorizado.phone}) dado de alta como motorizado.` : `${j.motorizado.nombre} ya estaba dado de alta.`, ir: '/entregas' };
    },
  }),

  // ------------------------------------------------ conversaciones guardadas
  def({
    nombre: 'guardados.buscar',
    tipo: 'consulta',
    descripcion: 'Busca en las conversaciones guardadas (las ya cerradas): por lo que se dijo, por etiqueta (reclamo, entrega, cancelacion, cambio, pago, motorizado, consulta, venta, sin_respuesta, otro), por pedido, por cliente o teléfono, y por fechas. Devuelve el resumen de cada una.',
    parametros: 'texto (opcional: palabras que se dijeron), etiqueta (opcional), pedido (opcional), q (opcional: nombre o teléfono), desde y hasta (opcionales, AAAA-MM-DD)',
    ejemplo: { orden: '¿quién se quejó de la demora la semana pasada?', accion: { accion: 'guardados.buscar', texto: 'demora', etiqueta: 'reclamo', desde: '2026-09-14', hasta: '2026-09-20' } },
    schema: z.object({
      texto: z.string().trim().max(200).optional(),
      etiqueta: z.string().trim().max(40).optional(),
      pedido: z.string().trim().max(120).optional(),
      q: z.string().trim().max(120).optional(),
      desde: z.string().trim().max(10).optional(),
      hasta: z.string().trim().max(10).optional(),
    }),
    async ejecutar(p, ctx) {
      const qs = new URLSearchParams({ limit: '10' });
      if (p.texto) qs.set('texto', p.texto);
      if (p.etiqueta) qs.set('etiqueta', p.etiqueta.toLowerCase().replace(/\s+/g, '_'));
      if (p.pedido) qs.set('pedido', p.pedido);
      if (p.q) qs.set('q', /\d{6,}/.test(p.q) ? telefonoADigitos(p.q) : p.q);
      if (p.desde) qs.set('desde', p.desde);
      if (p.hasta) qs.set('hasta', p.hasta);
      const r = await ctx.llamar({ method: 'GET', url: `/admin/archives?${qs.toString()}` });
      if (!ok(r)) return errorDe(r, 'No se pudieron leer las conversaciones guardadas.');
      const j = r.json as { total: number; items: Array<{ id: number; name: string | null; phone: string; pedido: string | null; createdAt: string; etiquetas: string[]; resumen: string | null; messageCount: number }> };
      const que = [p.texto ? `con "${p.texto}"` : '', p.etiqueta ? `etiqueta ${p.etiqueta}` : '', p.pedido ? `pedido ${p.pedido}` : '', p.q ? `de ${p.q}` : '', p.desde || p.hasta ? `entre ${p.desde ?? 'el principio'} y ${p.hasta ?? 'hoy'}` : ''].filter(Boolean).join(', ');
      if (!j.total) return { ok: true, resumen: `No hay ninguna conversación guardada ${que || 'con esos filtros'}.`, ir: '/guardados' };
      const resumen = `${j.total} conversación(es) guardada(s) ${que}${j.total > j.items.length ? ` (se muestran ${j.items.length})` : ''}.`;
      return {
        ok: true,
        resumen,
        datos: j.items.map((a) => ({ id: a.id, cliente: a.name ?? a.phone, telefono: a.phone, pedido: a.pedido, fecha: a.createdAt.slice(0, 10), mensajes: a.messageCount, etiquetas: a.etiquetas, resumen: acortar(a.resumen, 220) })),
        ir: '/guardados',
      };
    },
  }),
  def({
    nombre: 'guardados.resumen',
    tipo: 'consulta',
    descripcion: 'El resumen, las etiquetas, las notas y las primeras líneas de una conversación guardada concreta (por su id, o la última de un cliente).',
    parametros: 'id (opcional: el id de la conversación guardada) o cliente (nombre o teléfono)',
    ejemplo: { orden: '¿qué pasó en la última conversación guardada de Ana Quispe?', accion: { accion: 'guardados.resumen', cliente: 'Ana Quispe' } },
    schema: z.object({ id: z.coerce.number().int().positive().optional(), cliente: z.string().trim().max(120).optional() }).refine((v) => v.id || v.cliente, { message: 'Hace falta el id o el cliente.' }),
    async ejecutar(p, ctx) {
      let id = p.id ?? null;
      if (!id && p.cliente) {
        const q = /\d{6,}/.test(p.cliente) ? telefonoADigitos(p.cliente) : p.cliente;
        const lista = await ctx.llamar({ method: 'GET', url: `/admin/archives?q=${encodeURIComponent(q)}&limit=1` });
        if (!ok(lista)) return errorDe(lista, 'No se pudieron leer las conversaciones guardadas.');
        const items = (lista.json as { items: Array<{ id: number }> }).items;
        if (!items.length) return { ok: true, resumen: `No hay ninguna conversación guardada de ${p.cliente}.`, ir: '/guardados' };
        id = items[0]!.id;
      }
      const r = await ctx.llamar({ method: 'GET', url: `/admin/archives/${id}` });
      if (!ok(r)) return errorDe(r, 'No se pudo leer esa conversación guardada.');
      const j = r.json as { archive: { id: number; name: string | null; phone: string; pedido: string | null; createdAt: string; etiquetas: string[]; resumen: string | null; notas: string | null; messageCount: number; cerradoPor: string | null }; messages: Array<{ direction: 'in' | 'out'; body: string | null; kind: string; createdAt: string }> };
      const a = j.archive;
      const lineas = j.messages.slice(0, 10).map((m) => `${m.direction === 'in' ? a.name ?? a.phone : 'Nosotros'}: ${m.body ?? `[${m.kind}]`}`.slice(0, 200));
      const resumen = `Conversación guardada #${a.id} de ${a.name ?? a.phone}${a.pedido ? ` (pedido ${a.pedido})` : ''}, ${a.messageCount} mensajes, guardada el ${a.createdAt.slice(0, 10)}. ${a.resumen ?? 'Sin resumen todavía.'}`;
      return { ok: true, resumen, datos: { id: a.id, cliente: a.name ?? a.phone, telefono: a.phone, pedido: a.pedido, etiquetas: a.etiquetas, resumen: a.resumen, notas: a.notas, cerradoPor: a.cerradoPor, primerasLineas: lineas }, ir: `/guardados?abrir=${a.id}` };
    },
  }),

  // ------------------------------------------ entregas: lo de las últimas vueltas
  def({
    nombre: 'entregas.probarDia',
    tipo: 'cambio',
    soloAdmin: true,
    descripcion: 'En la demostración: probar el día entero con datos ficticios (clientes, motorizados, pines, confirmaciones, tiempos y entregas, paso a paso), o pararlo.',
    parametros: 'parar (opcional: true para detener la prueba en marcha)',
    ejemplo: { orden: 'prueba el día entero con datos ficticios', accion: { accion: 'entregas.probarDia' } },
    schema: z.object({ parar: z.boolean().default(false) }),
    async ejecutar(p, ctx) {
      if (p.parar) {
        const r = await ctx.llamar({ method: 'DELETE', url: '/admin/entregas/simulador/probar-dia' });
        if (!ok(r)) return errorDe(r, 'No se pudo detener la prueba.');
        return { ok: true, resumen: 'Prueba del día detenida.', ir: '/hoy' };
      }
      const r = await ctx.llamar({ method: 'POST', url: '/admin/entregas/simulador/probar-dia', body: {} });
      if (!ok(r)) return errorDe(r, 'No se pudo arrancar la prueba del día.');
      return { ok: true, resumen: 'Prueba del día en marcha: en Hoy se ven los pasos según van pasando (pines, confirmaciones, motorizados, entregas).', ir: '/hoy' };
    },
  }),
  def({
    nombre: 'motorizados.ruta',
    tipo: 'consulta',
    descripcion: 'La ruta de hoy de un motorizado: sus pedidos en orden de cercanía, los kilómetros y el mensaje tal cual se le manda.',
    parametros: 'motorizado (nombre o teléfono)',
    ejemplo: { orden: '¿qué ruta tiene Carlos hoy?', accion: { accion: 'motorizados.ruta', motorizado: 'Carlos' } },
    schema: z.object({ motorizado: texto(120) }),
    async ejecutar(p, ctx) {
      const m = await buscarMotorizado(ctx, p.motorizado);
      if (!m) return { ok: false, resumen: `No encuentro ningún motorizado que se llame "${p.motorizado}".`, ir: '/motorizados' };
      const r = await ctx.llamar({ method: 'GET', url: `/admin/motorizados/${m.id}/ruta` });
      if (!ok(r)) return errorDe(r, 'No se pudo armar la ruta.');
      const ruta = (r.json as { ruta: { paradas: Array<{ orden: number; entrega: { referencia: string; nombre: string | null; distrito: string | null }; distancia: string | null; situacion: string }>; totalKm: number; texto: string } }).ruta;
      const paradas = ruta.paradas.map((x) => `${x.orden}) ${x.entrega.referencia}${x.entrega.nombre ? ` · ${x.entrega.nombre}` : ''}${x.entrega.distrito ? ` (${x.entrega.distrito})` : ''}${x.distancia ? `, ${x.distancia}` : ''}`);
      const resumen = paradas.length ? `Ruta de ${m.nombre}: ${paradas.length} parada(s), unos ${Math.round(ruta.totalKm * 10) / 10} km. ${paradas.join(' → ')}.` : `${m.nombre} no lleva pedidos ahora mismo.`;
      return { ok: true, resumen, datos: { motorizado: m.nombre, paradas: ruta.paradas.map((x) => ({ orden: x.orden, pedido: x.entrega.referencia, cliente: x.entrega.nombre, distrito: x.entrega.distrito, distancia: x.distancia, situacion: x.situacion })), totalKm: ruta.totalKm, mensaje: ruta.texto }, ir: '/motorizados' };
    },
  }),

  // ------------------------------------------ guardados: enlace de evidencia
  def({
    nombre: 'guardados.enlace',
    tipo: 'cambio',
    descripcion: 'Crear un enlace público con caducidad para enseñar una conversación guardada a alguien sin cuenta (por ejemplo, a GSG ante un reclamo).',
    parametros: 'id (opcional) o cliente (nombre o teléfono); dias (1-30, 7 por defecto)',
    ejemplo: { orden: 'dame un enlace de la conversación guardada de Ana Quispe para mandárselo a GSG', accion: { accion: 'guardados.enlace', cliente: 'Ana Quispe', dias: 7 } },
    schema: z.object({ id: z.coerce.number().int().positive().optional(), cliente: z.string().trim().max(120).optional(), dias: z.coerce.number().int().min(1).max(30).default(7) }).refine((v) => v.id || v.cliente, { message: 'Hace falta el id o el cliente.' }),
    async ejecutar(p, ctx) {
      let id = p.id ?? null;
      if (!id && p.cliente) {
        const q = /\d{6,}/.test(p.cliente) ? telefonoADigitos(p.cliente) : p.cliente;
        const lista = await ctx.llamar({ method: 'GET', url: `/admin/archives?q=${encodeURIComponent(q)}&limit=1` });
        if (!ok(lista)) return errorDe(lista, 'No se pudieron leer las conversaciones guardadas.');
        const items = (lista.json as { items: Array<{ id: number }> }).items;
        if (!items.length) return { ok: true, resumen: `No hay ninguna conversación guardada de ${p.cliente}.`, ir: '/guardados' };
        id = items[0]!.id;
      }
      const r = await ctx.llamar({ method: 'POST', url: `/admin/archives/${id}/enlace`, body: { dias: p.dias } });
      if (!ok(r)) return errorDe(r, 'No se pudo crear el enlace.');
      const j = r.json as { url: string; caducaEn: string; dias: number };
      return { ok: true, resumen: `Enlace listo (vale ${j.dias} día(s), hasta ${String(j.caducaEn).slice(0, 10)}): ${j.url}`, datos: { url: j.url, caducaEn: j.caducaEn }, ir: `/guardados?abrir=${id}` };
    },
  }),

  // ------------------------------------------------- que todo funcione
  def({
    nombre: 'fiabilidad.probar',
    tipo: 'cambio',
    descripcion: 'Correr ahora la prueba de cada mañana (WhatsApp, GSG, IA, entregas, disco) y decir qué pasó, sin avisar a nadie.',
    parametros: '(ninguno)',
    ejemplo: { orden: '¿está todo funcionando? prueba ahora', accion: { accion: 'fiabilidad.probar' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/fiabilidad/humo/probar', body: {} });
      if (!ok(r)) return errorDe(r, 'No se pudo correr la prueba.');
      const j = r.json as { resultado: { ok: boolean; pasos: Array<{ nombre: string; ok: boolean; omitido?: boolean; detalle: string }> } };
      const malos = j.resultado.pasos.filter((x) => !x.ok && !x.omitido);
      const resumen = malos.length ? `Prueba con ${malos.length} fallo(s): ${malos.map((x) => `${x.nombre}: ${x.detalle}`).join(' · ')}` : `Todo funciona: ${j.resultado.pasos.filter((x) => !x.omitido).map((x) => x.nombre).join(', ')} en orden.`;
      return { ok: true, resumen, datos: j.resultado.pasos, ir: '/fiabilidad' };
    },
  }),
  def({
    nombre: 'fiabilidad.copia',
    tipo: 'cambio',
    soloAdmin: true,
    descripcion: 'Hacer ahora la copia de seguridad de la base y de los respaldos de conversaciones.',
    parametros: '(ninguno)',
    ejemplo: { orden: 'haz una copia de seguridad ahora', accion: { accion: 'fiabilidad.copia' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/fiabilidad/copia/ahora', body: {} });
      if (!ok(r)) return errorDe(r, 'No se pudo hacer la copia.');
      const j = r.json as { enMarcha?: boolean; detalle?: string; resultado?: { carpeta: string; ficheros: Array<{ nombre?: string }>; notas: string[] } };
      if (j.enMarcha) return { ok: true, resumen: j.detalle ?? 'La copia sigue haciéndose.', ir: '/fiabilidad' };
      const res = j.resultado;
      return { ok: true, resumen: res ? `Copia hecha en ${res.carpeta} (${res.ficheros.length} fichero(s)).${res.notas.length ? ` ${res.notas.join(' ')}` : ''}` : 'Copia hecha.', ir: '/fiabilidad' };
    },
  }),

  // ------------------------------------------------------------- GSG
  def({
    nombre: 'gsg.verificar',
    tipo: 'consulta',
    soloAdmin: true,
    descripcion: 'Revisar lo que GSG nos ha mandado (POST /api/v1/entregas y los pedidos descartados) contra el contrato. No llama a GSG: GSGchat nunca le pide nada.',
    parametros: '(ninguno)',
    ejemplo: { orden: '¿lo que manda GSG cumple el contrato?', accion: { accion: 'gsg.verificar' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/gsg/verificar-contrato', body: {} });
      if (!ok(r)) return errorDe(r, 'No se pudo verificar el contrato con GSG.');
      const j = r.json as { ok: boolean; verificacion: { resumen: string; hallazgos: Array<{ tipo: string; donde: string; detalle: string }> } };
      return { ok: true, resumen: j.verificacion.resumen, datos: j.verificacion.hallazgos.slice(0, 20), ir: '/setup#gsg' };
    },
  }),
  def({
    nombre: 'gsg.cuadre',
    tipo: 'consulta',
    descripcion: 'El cierre de un día con lo de aquí: cuántos pedidos están entregados o cancelados y cuáles siguen abiertos. A GSG no se le pregunta nada.',
    parametros: 'dia (opcional, AAAA-MM-DD; hoy por defecto)',
    ejemplo: { orden: '¿quedó algún pedido de hoy sin cerrar?', accion: { accion: 'gsg.cuadre' } },
    schema: z.object({ dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: `/admin/gsg/cuadre${p.dia ? `?dia=${p.dia}` : ''}` });
      if (!ok(r)) return errorDe(r, 'No se pudo cuadrar con GSG.');
      const c = (r.json as { cuadre: { resumen: string; ok: boolean; total: number; cerradasAqui: number; abiertas: string[] } }).cuadre;
      return { ok: true, resumen: c.resumen, datos: { total: c.total, cerradas: c.cerradasAqui, abiertas: c.abiertas, cuadra: c.ok }, ir: '/setup#gsg' };
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

  // --------------------------------------------------------------- procesos
  def({
    nombre: 'procesos.listar',
    tipo: 'consulta',
    descripcion: 'Ver los procesos de la empresa (pedir datos, confirmaciones, avisos al personal, cobranza): sus pasos, cuántas personas tienen en curso y cuántas necesitan a alguien; y las plantillas para crear uno.',
    parametros: '(sin parámetros)',
    ejemplo: { orden: '¿qué procesos tenemos?', accion: { accion: 'procesos.listar' } },
    schema: z.object({}),
    async ejecutar(_p, ctx) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/procesos' });
      if (!ok(r)) return errorDe(r, 'No se pudieron leer los procesos.');
      const j = r.json as { procesos: Array<{ id: number; nombre: string; plantilla: string | null; estado: string; resumenPasos: string; vivas: number; necesitan: number; cifras: Record<string, number> }>; plantillas: Array<{ id: string; nombre: string; resumen: string }>; gsgActivo: boolean };
      return {
        ok: true,
        resumen: `${j.procesos.length} proceso(s). Entregas de courier ${j.gsgActivo ? 'activas' : 'sin activar'}.`,
        datos: { procesos: j.procesos.map((p) => ({ id: p.id, nombre: p.nombre, plantilla: p.plantilla, estado: p.estado, pasos: p.resumenPasos, enCurso: p.vivas, necesitanAAlguien: p.necesitan, completadas: p.cifras.completada ?? 0 })), plantillas: j.plantillas.map((pl) => ({ id: pl.id, nombre: pl.nombre, para: pl.resumen })) },
        ir: '/procesos',
      };
    },
  }),
  def({
    nombre: 'procesos.crear',
    tipo: 'cambio',
    soloAdmin: true,
    descripcion: 'Crear un proceso desde una plantilla: datos (pedir y validar datos), confirmaciones (citas y recordatorios), campo (avisos al personal de campo), cobranza (pagos y trámites) o gsg (activar las entregas de courier).',
    parametros: 'plantilla (obligatorio: datos | confirmaciones | campo | cobranza | gsg), nombre (opcional)',
    ejemplo: { orden: 'crea un proceso para confirmar las citas de la clínica', accion: { accion: 'procesos.crear', plantilla: 'confirmaciones', nombre: 'Citas de la clínica' } },
    schema: z.object({ plantilla: z.enum(['datos', 'confirmaciones', 'campo', 'cobranza', 'gsg']), nombre: z.string().trim().max(120).optional() }),
    async ejecutar(p, ctx) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/procesos/desde-plantilla', body: { plantilla: p.plantilla, nombre: p.nombre } });
      if (!ok(r)) return errorDe(r, 'No se pudo crear el proceso.');
      const j = r.json as { proceso: { id: number; nombre: string }; ir: string };
      return { ok: true, resumen: p.plantilla === 'gsg' ? 'Entregas de courier activadas: Hoy, Números del día, Motorizados y Mapa ya están en el menú.' : `Proceso «${j.proceso.nombre}» creado. Revisa sus mensajes en el editor y carga la lista de personas.`, datos: { id: j.proceso.id }, ir: j.ir };
    },
  }),
  def({
    nombre: 'procesos.cargarPersonas',
    tipo: 'cambio',
    peligrosa: true,
    descripcion: 'Cargar personas en un proceso para que el sistema empiece a escribirles (pedirles un dato, confirmar su cita, avisarles una tarea o recordarles un pago).',
    parametros: 'proceso (nombre o número del proceso), personas (lista de { telefono, nombre, y columnas como fecha, hora, monto, tarea, direccion }), nombre (de la corrida, opcional)',
    ejemplo: { orden: 'carga a Ana 987654321 y a Luis 912345678 en confirmar citas, las dos mañana a las 10', accion: { accion: 'procesos.cargarPersonas', proceso: 'Confirmar citas', personas: [{ telefono: '987654321', nombre: 'Ana', fecha: 'mañana', hora: '10:00' }, { telefono: '912345678', nombre: 'Luis', fecha: 'mañana', hora: '10:00' }] } },
    schema: z.object({ proceso: z.union([z.string().trim().min(1).max(120), z.number().int().positive()]), personas: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).min(1).max(500), nombre: z.string().trim().max(120).optional() }),
    async ejecutar(p, ctx) {
      const lista = await ctx.llamar({ method: 'GET', url: '/admin/procesos' });
      if (!ok(lista)) return errorDe(lista, 'No se pudieron leer los procesos.');
      const procesos = (lista.json as { procesos: Array<{ id: number; nombre: string; plantilla: string | null }> }).procesos.filter((x) => x.plantilla !== 'gsg');
      const q = String(p.proceso).trim().toLowerCase();
      const proc = procesos.find((x) => String(x.id) === q) ?? procesos.find((x) => x.nombre.toLowerCase() === q) ?? procesos.find((x) => x.nombre.toLowerCase().includes(q));
      if (!proc) return { ok: false, resumen: `No encuentro ningún proceso «${p.proceso}». Los que hay: ${procesos.map((x) => x.nombre).join(', ') || 'ninguno (créalo desde una plantilla)'}.`, ir: '/procesos' };
      const filas = p.personas.map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)])));
      const r = await ctx.llamar({ method: 'POST', url: `/admin/procesos/${proc.id}/personas`, body: { personas: filas, nombre: p.nombre } });
      if (!ok(r)) return errorDe(r, 'No se pudieron cargar las personas.');
      const j = r.json as { aviso: string; ir: string; listas: number };
      return { ok: true, resumen: j.aviso, datos: { listas: j.listas }, ir: j.ir };
    },
  }),
  def({
    nombre: 'procesos.estado',
    tipo: 'consulta',
    descripcion: 'Cómo van los procesos: cuántas personas en curso, esperando respuesta, completadas y quién necesita a alguien (y por qué). Con un proceso, el detalle de sus corridas.',
    parametros: 'proceso (opcional: nombre o número)',
    ejemplo: { orden: '¿cómo va la confirmación de citas?', accion: { accion: 'procesos.estado', proceso: 'citas' } },
    schema: z.object({ proceso: z.union([z.string().trim().min(1).max(120), z.number().int().positive()]).optional() }),
    async ejecutar(p, ctx) {
      if (p.proceso === undefined) {
        const r = await ctx.llamar({ method: 'GET', url: '/admin/procesos/resumen' });
        if (!ok(r)) return errorDe(r, 'No se pudo leer cómo van los procesos.');
        const j = r.json as { procesosActivos: number; vivas: number; esperando: number; necesitan: number; completadas: number };
        const personas = await ctx.llamar({ method: 'GET', url: '/admin/procesos/personas?estado=persona&limit=20' });
        const necesitan = ok(personas) ? ((personas.json as { personas: Array<{ nombre: string | null; telefono: string; proceso: string; motivo: string | null }> }).personas ?? []).map((x) => ({ quien: x.nombre ?? x.telefono, proceso: x.proceso, porque: x.motivo })) : [];
        return { ok: true, resumen: `${j.procesosActivos} proceso(s) activos; ${j.vivas} persona(s) en curso (${j.esperando} esperando respuesta); ${j.necesitan} necesitan a alguien; ${j.completadas} completadas hoy.`, datos: { necesitanAAlguien: necesitan }, ir: '/personas' };
      }
      const lista = await ctx.llamar({ method: 'GET', url: '/admin/procesos' });
      if (!ok(lista)) return errorDe(lista, 'No se pudieron leer los procesos.');
      const procesos = (lista.json as { procesos: Array<{ id: number; nombre: string }> }).procesos;
      const q = String(p.proceso).trim().toLowerCase();
      const proc = procesos.find((x) => String(x.id) === q) ?? procesos.find((x) => x.nombre.toLowerCase() === q) ?? procesos.find((x) => x.nombre.toLowerCase().includes(q));
      if (!proc) return { ok: false, resumen: `No encuentro ningún proceso «${p.proceso}».`, ir: '/procesos' };
      const r = await ctx.llamar({ method: 'GET', url: `/admin/procesos/corridas?procesoId=${proc.id}` });
      if (!ok(r)) return errorDe(r, 'No se pudieron leer sus corridas.');
      const corridas = (r.json as { corridas: Array<{ id: number; nombre: string; estado: string; cifras: Record<string, number>; total: number }> }).corridas;
      return { ok: true, resumen: `«${proc.nombre}»: ${corridas.length} corrida(s).`, datos: corridas.map((c) => ({ corrida: c.nombre, estado: c.estado, personas: c.total, completadas: c.cifras.completada ?? 0, esperando: c.cifras.esperando ?? 0, necesitanAAlguien: c.cifras.persona ?? 0 })), ir: corridas[0] ? `/procesos/corrida?id=${corridas[0].id}` : '/procesos' };
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

/** Lo comercial que vive aqui (el resto lo marca acciones-panel.ts con `ventas`). */
for (const a of ACCIONES_DE_SIEMPRE) if (a.nombre === 'campanas.ver' || a.nombre === 'catalogo.buscar') a.ventas = true;
for (const a of ACCIONES_DE_SIEMPRE) {
  const preparar = PREPARAR_DE_SIEMPRE[a.nombre];
  if (preparar) a.preparar = preparar as Accion['preparar'];
}

/** Todas: las de siempre y las de las pantallas del panel (estas mandan si se llaman igual). */
const DEL_PANEL_Y_NUEVAS = [...ACCIONES_PANEL, ...ACCIONES_MENSAJES, ...ACCIONES_CHATS, ...ACCIONES_INFORMES, ...ACCIONES_GENERAL];
const DEL_PANEL = new Set(DEL_PANEL_Y_NUEVAS.map((a) => a.nombre));
// La via general (panel.*) va al final: el modelo prueba antes las acciones con nombre propio.
export const ACCIONES: Accion[] = [...ACCIONES_DE_SIEMPRE.filter((a) => !DEL_PANEL.has(a.nombre) && !a.nombre.startsWith('motorizados.')), ...DEL_PANEL_Y_NUEVAS].filter((a) => !/^(?:motorizados|procesos|personas|respuestas|campanas|campana|grupos|tracking|stoky|catalogo|membresia|tiendas|lista)\./.test(a.nombre));

export const ACCIONES_POR_NOMBRE = new Map(ACCIONES.map((a) => [a.nombre, a]));

/**
 * Lo comercial (campañas de venta, catalogo de productos): en modo "Solo lo
 * de GSG" la IA operadora ni lo ofrece ni lo ejecuta. El codigo sigue ahi.
 */
export const ACCIONES_DE_VENTAS: ReadonlySet<string> = new Set(ACCIONES.filter((a) => a.ventas).map((a) => a.nombre));

/** Las unicas llamadas POST que solo leen (previsualizar): las unicas que se permiten al preparar. */
const POST_QUE_SOLO_LEEN = ['/admin/grupos/previsualizar', '/admin/entregas/previsualizar'];

/** Lo que se le dice a quien no puede: en palabras y a quien pedirselo. */
export function motivoSoloAdmin(a: Accion): string {
  return `Eso solo lo puede hacer un administrador de la tienda («${a.descripcion.replace(/\.$/, '')}»). Pídeselo a un administrador: lo puede hacer desde aquí mismo o desde su pantalla.`;
}

/**
 * El mismo contexto, pero que solo lee: cualquier llamada que no sea GET (o
 * uno de los POST que solo previsualizan) se rechaza. Lo usan `preparar` y
 * las consultas, que se hacen sin «Hacerlo»: asi ninguna puede cambiar nada
 * aunque una accion este mal escrita.
 */
export function contextoDeLectura(ctx: ContextoAccion, quien = 'una consulta'): ContextoAccion {
  return {
    ...ctx,
    llamar: async (l) => {
      if (l.method !== 'GET' && !(l.method === 'POST' && POST_QUE_SOLO_LEEN.includes(l.url.split('?')[0] ?? ''))) throw new Error(`${quien} solo se lee (se intentó ${l.method} ${l.url})`);
      return ctx.llamar(l);
    },
  };
}

/**
 * Prepara un cambio para su tarjeta de «Hacerlo». NUNCA escribe: el contexto
 * que recibe `preparar` rechaza cualquier llamada que no sea de lectura.
 */
export async function prepararAccion(accion: Accion, params: Record<string, unknown>, ctx: ContextoAccion): Promise<Preparado> {
  if (accion.soloAdmin && !ctx.esAdmin) return { tipo: 'no', resumen: motivoSoloAdmin(accion) };
  if (accion.ventas && ctx.sinVentas) return { tipo: 'no', resumen: 'Con «Solo lo de GSG» no hay campañas ni catálogo: eso está apagado en este modo. Si quieres parar todo lo que sale, dime «pausa todos los envíos».' };
  const lectura = contextoDeLectura(ctx, 'al preparar');
  if (!accion.preparar) {
    const partes = Object.entries(params)
      .filter(([k, v]) => k !== 'accion' && v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    return { tipo: 'listo', params, tarjeta: { que: accion.descripcion.replace(/\.$/, ''), ...(partes.length ? { despues: partes.join(' · ') } : {}) } };
  }
  try {
    return (await accion.preparar(params, lectura)) as Preparado;
  } catch (error) {
    return { tipo: 'no', resumen: `No se pudo preparar: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** El catalogo tal y como se le cuenta al modelo. */
export function catalogoParaElModelo(opts: { esAdmin: boolean; conCatalogo: boolean; sinVentas?: boolean }): string {
  return ACCIONES.filter((a) => (opts.esAdmin || !a.soloAdmin) && (opts.conCatalogo || a.nombre !== 'catalogo.buscar') && !(opts.sinVentas && ACCIONES_DE_VENTAS.has(a.nombre)))
    .map((a) => `- ${a.nombre} [${a.tipo === 'consulta' ? 'consulta: se hace al momento' : `cambio: tarjeta + «Hacerlo»${a.peligrosa ? ', delicado' : ''}`}]: ${a.descripcion} Parámetros: ${a.parametros}. Ej.: «${a.ejemplo.orden}» → ${JSON.stringify(a.ejemplo.accion)}`)
    .join('\n');
}

/** El catalogo para la pantalla (ayuda "que le puedo pedir"). */
export function catalogoParaPantalla(): Array<{ nombre: string; tipo: TipoAccion; descripcion: string; ejemplo: string; peligrosa: boolean; soloAdmin: boolean }> {
  return ACCIONES.map((a) => ({ nombre: a.nombre, tipo: a.tipo, descripcion: a.descripcion, ejemplo: a.ejemplo.orden, peligrosa: Boolean(a.peligrosa), soloAdmin: Boolean(a.soloAdmin) }));
}
