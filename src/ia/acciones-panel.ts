/**
 * Lo que la IA operadora puede hacer en las pantallas del panel de la tienda
 * (Hoy, Números del día, Motorizados, Chats, Ajustes, Respuestas rápidas,
 * Campañas, Procesos...), con su tarjeta de «Hacerlo».
 *
 * Cada cambio llama a la MISMA ruta que el boton de su pantalla (nunca SQL
 * ni una logica paralela): la ruta valida, comprueba el rol, trabaja solo
 * con la tienda de quien ordena y apunta en la bitacora "(por la IA)".
 * `preparar` solo lee (ver acciones-base.ts) y arma la tarjeta; si hay dos
 * pedidos o dos motorizados que encajan, devuelve las opciones en vez de
 * adivinar.
 */

import { z } from 'zod';
import { ajustesEntregasSchema, horaEnReloj, TEXTOS_POR_DEFECTO } from '../entregas/textos.js';
import {
  acortar,
  avisosDeEnvio,
  candidatosEntrega,
  def,
  elegirMotorizado,
  errorDe,
  estadoEnPalabras,
  idOpcional,
  leerEntregas,
  leerMotorizados,
  lineaEntrega,
  lineaMotorizado,
  normal,
  ok,
  prepararConContacto,
  prepararConEntrega,
  telefono,
  telefonoADigitos,
  telefonoBonito,
  texto,
  unContacto,
  unaEntrega,
  unMotorizado,
  type Accion,
  type ContextoAccion,
  type EntregaVista,
  type MotorizadoVista,
  type Preparado,
  type ResultadoAccion,
} from './acciones-base.js';

const ESTADOS_FINALES = ['entregada', 'terminada', 'cancelada'];
const clienteSchema = { cliente: texto(120), entregaId: idOpcional };
const quienEntrega = (e: EntregaVista) => `${e.nombre ?? telefonoBonito(e.phone)} (${telefonoBonito(e.phone)})`;
const mapaDe = (lat: number, lng: number) => `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;

/** «15:00», «3 PM», «3:30 p. m.», «15h», «15» -> "15:00". null si no se entiende. */
export function horaHHMM(s: unknown): string | null {
  const t = normal(s).replace(/\./g, '').replace(/\s+/g, '');
  const m = /^(\d{1,2})(?::|h)?(\d{2})?(am|pm|a\.?m|p\.?m)?h?s?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const suf = m[3] ?? '';
  if (suf.startsWith('p') && h < 12) h += 12;
  if (suf.startsWith('a') && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
const hora = z.union([z.string(), z.number()]).transform((v, c) => {
  const h = horaHHMM(String(v));
  if (!h) {
    c.addIssue({ code: z.ZodIssueCode.custom, message: 'la hora va como 15:00 o 3 PM' });
    return z.NEVER;
  }
  return h;
});
const horaBonita = (h: string): string => {
  const [hh, mm] = h.split(':').map(Number);
  const suf = hh! >= 12 ? 'p. m.' : 'a. m.';
  const h12 = hh! % 12 === 0 ? 12 : hh! % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${suf}`;
};

/** Las coordenadas de "-12.05,-77.03" (o de lat y lng sueltos). */
function coordenadasDe(p: { lat?: number; lng?: number; coordenadas?: string }): { lat: number; lng: number } | null {
  if (typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng)) return { lat: p.lat, lng: p.lng };
  const m = /(-?\d{1,3}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(p.coordenadas ?? '');
  if (!m) return null;
  return { lat: Number(m[1]), lng: Number(m[2]) };
}

// ===================================================================== ENTREGAS

const entregasConfirmar = def({
  nombre: 'entregas.confirmar',
  tipo: 'cambio',
  descripcion: 'Dar por confirmada a mano la entrega de un cliente (te lo dijo por teléfono), o cancelarla.',
  parametros: 'cliente (pedido, nombre o teléfono), confirmada (true/false), motivo (si se cancela)',
  ejemplo: { orden: 'Ana Quispe confirmó por teléfono su pedido', accion: { accion: 'entregas.confirmar', cliente: 'Ana Quispe', confirmada: true } },
  schema: z.object({ ...clienteSchema, confirmada: z.boolean().default(true), motivo: z.string().trim().max(300).optional() }),
  async preparar(p, ctx) {
    return prepararConEntrega(ctx, p, p.cliente, '¿Cuál confirmo?', (e) => {
      if (ESTADOS_FINALES.includes(e.estado)) return { tipo: 'no', resumen: `${e.referencia} ya está ${estadoEnPalabras(e.estado)}: no hay nada que confirmar.`, ir: '/hoy' };
      return {
        tipo: 'listo',
        params: { ...p, entregaId: e.id },
        tarjeta: p.confirmada
          ? { que: `Dar por confirmado el pedido ${e.referencia}`, aQuien: quienEntrega(e), antes: `confirmación: ${e.confirmacionEstado ?? '?'} (${estadoEnPalabras(e.estado)})`, despues: 'confirmada a mano; si ya tiene ubicación, pasa a un motorizado' }
          : { que: `Cancelar el pedido ${e.referencia}`, aQuien: quienEntrega(e), antes: estadoEnPalabras(e.estado), despues: 'cancelada (GSG se entera)', avisos: p.motivo ? [`Motivo: ${p.motivo}`] : undefined },
      };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unaEntrega(ctx, p.cliente, p.entregaId);
    if ('error' in u) return u.error;
    const e = u.e;
    const r = p.confirmada
      ? await ctx.llamar({ method: 'POST', url: `/admin/entregas/${e.id}/confirmar`, body: { confirmada: true } })
      : await ctx.llamar({ method: 'POST', url: `/admin/entregas/${e.id}/cancelar`, body: { motivo: p.motivo ?? `cancelada por la IA a petición de ${ctx.quien}` } });
    if (!ok(r)) return errorDe(r, 'No se pudo cambiar la entrega.');
    return { ok: true, resumen: p.confirmada ? `${e.referencia} de ${e.nombre ?? e.phone} queda confirmada; si tiene ubicación, se le manda a un motorizado.` : `${e.referencia} de ${e.nombre ?? e.phone} queda cancelada y GSG se entera.`, ir: '/hoy' };
  },
});

const entregasCancelar = def({
  nombre: 'entregas.cancelar',
  tipo: 'cambio',
  descripcion: 'Cancelar un pedido de hoy (el cliente ya no lo quiere, se equivocaron...). GSG se entera y, si un motorizado lo lleva, se le avisa.',
  parametros: 'cliente (pedido, nombre o teléfono), motivo (en palabras)',
  ejemplo: { orden: 'cancela el pedido GSG-IA-004 porque el cliente no lo quiere', accion: { accion: 'entregas.cancelar', cliente: 'GSG-IA-004', motivo: 'el cliente ya no lo quiere' } },
  schema: z.object({ ...clienteSchema, motivo: z.string().trim().max(300).optional() }),
  async preparar(p, ctx) {
    return prepararConEntrega(ctx, p, p.cliente, '¿Cuál cancelo?', (e) => {
      if (e.estado === 'cancelada') return { tipo: 'no', resumen: `${e.referencia} ya está cancelado.`, ir: '/hoy' };
      if (e.estado === 'entregada' || e.estado === 'terminada') return { tipo: 'no', resumen: `${e.referencia} ya figura ${estadoEnPalabras(e.estado)}: no se puede cancelar un pedido entregado.`, ir: '/hoy' };
      return {
        tipo: 'listo',
        params: { ...p, entregaId: e.id },
        tarjeta: { que: `Cancelar el pedido ${e.referencia}`, aQuien: quienEntrega(e), antes: `${estadoEnPalabras(e.estado)}${e.motorizado ? ` (lo lleva ${e.motorizado.nombre})` : ''}`, despues: `cancelado; GSG se entera${e.motorizado ? ` y a ${e.motorizado.nombre} se le avisa que ya no lo lleve` : ''}`, avisos: [`Motivo que queda apuntado: ${p.motivo ?? 'cancelado desde la IA'}`] },
      };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unaEntrega(ctx, p.cliente, p.entregaId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/entregas/${u.e.id}/cancelar`, body: { motivo: p.motivo ? `${p.motivo} (por la IA, a petición de ${ctx.quien})` : `cancelado por la IA a petición de ${ctx.quien}` } });
    if (!ok(r)) return errorDe(r, 'No se pudo cancelar.');
    return { ok: true, resumen: `${u.e.referencia} de ${u.e.nombre ?? u.e.phone} queda cancelado y GSG se entera.`, ir: '/hoy' };
  },
});

/** ¿Va por «asignar sin ubicación» (el motorizado lo recibe con la dirección escrita) o por «pasar a otro»? */
const vaSinUbicacion = (e: EntregaVista) => e.ubicacionEstado === 'pendiente' && !(e.motorizado && e.lat == null);

const entregasReasignar = def({
  nombre: 'entregas.reasignar',
  tipo: 'cambio',
  descripcion: 'Asignar un pedido a un motorizado, o pasárselo a otro (uno concreto, o el que menos carga tenga). Si todavía no tiene ubicación, el motorizado lo recibe con el teléfono y la dirección escrita.',
  parametros: 'cliente (pedido, nombre o teléfono), motorizado (nombre o teléfono; sin él, el que toque)',
  ejemplo: { orden: 'asígnale el pedido GSG-IA-001 a Carlos', accion: { accion: 'entregas.reasignar', cliente: 'GSG-IA-001', motorizado: 'Carlos' } },
  schema: z.object({ ...clienteSchema, motorizado: z.string().trim().max(120).optional(), motorizadoId: idOpcional }),
  async preparar(p, ctx) {
    return prepararConEntrega(ctx, p, p.cliente, '¿Qué pedido asigno?', ({ ...e }, { motorizados }) => {
      if (ESTADOS_FINALES.includes(e.estado)) return { tipo: 'no', resumen: `${e.referencia} ya está ${estadoEnPalabras(e.estado)}: no necesita motorizado.`, ir: '/hoy' };
      let m: MotorizadoVista | null = null;
      if (p.motorizado || p.motorizadoId) {
        const x = elegirMotorizado(motorizados, p.motorizado ?? '', p.motorizadoId, `¿A cuál motorizado le paso ${e.referencia}?`, (mm) => ({ ...p, entregaId: e.id, motorizadoId: mm.id }));
        if ('preparado' in x) return x.preparado;
        m = x.m;
        if (m.estado && m.estado !== 'activo') return { tipo: 'no', resumen: `${m.nombre} está ${m.estado === 'descanso' ? 'en descanso' : 'de baja'} y no puede recibir pedidos. Actívalo primero («activa a ${m.nombre.split(' ')[0]}») o elige otro.`, ir: '/motorizados' };
        if (e.motorizado?.id === m.id) return { tipo: 'no', resumen: `${e.referencia} ya lo lleva ${m.nombre}.`, ir: '/hoy' };
      }
      const sinPin = vaSinUbicacion(e);
      const avisos: string[] = [];
      if (sinPin) avisos.push(`Todavía no tiene ubicación: ${m ? m.nombre : 'el motorizado'} lo recibe con el teléfono y la dirección escrita${e.direccion ? ` («${acortar(e.direccion, 80)}»)` : ''}, sin pin.`);
      if (e.motorizado) avisos.push(`A ${e.motorizado.nombre} se le avisa que ya no lo lleve.`);
      avisos.push(`${m ? m.nombre : 'El motorizado'} recibe el pedido por WhatsApp (con las guardas de siempre del número).`);
      return {
        tipo: 'listo',
        params: { ...p, entregaId: e.id, ...(m ? { motorizadoId: m.id, motorizado: m.nombre } : {}) },
        tarjeta: { que: m ? `Asignar el pedido ${e.referencia} a ${m.nombre}` : `Volver a repartir ${e.referencia} al motorizado que toque`, aQuien: quienEntrega(e), antes: e.motorizado ? `lo lleva ${e.motorizado.nombre}` : 'sin motorizado', despues: m ? `lo lleva ${lineaMotorizado(m)}` : 'el motorizado activo menos cargado', avisos },
      };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unaEntrega(ctx, p.cliente, p.entregaId);
    if ('error' in u) return u.error;
    const e = u.e;
    let motorizadoId: number | null = null;
    let nombre = '';
    if (p.motorizado || p.motorizadoId) {
      const m = await unMotorizado(ctx, p.motorizado ?? '', p.motorizadoId);
      if ('error' in m) return m.error;
      motorizadoId = m.m.id;
      nombre = m.m.nombre;
    }
    const sinPin = vaSinUbicacion(e);
    const r = await ctx.llamar({ method: 'POST', url: `/admin/entregas/${e.id}/${sinPin ? 'sin-ubicacion' : 'reasignar'}`, body: { motorizadoId } });
    if (!ok(r)) return errorDe(r, 'No se pudo asignar.');
    const quien = nombre || (r.json as { motorizado?: { nombre?: string } }).motorizado?.nombre || '';
    return { ok: true, resumen: `${e.referencia} de ${e.nombre ?? e.phone} ${quien ? `se le asigna a ${quien}` : 'vuelve a repartirse al motorizado menos cargado'}${sinPin ? ' (sin pin: con la dirección escrita)' : ''}.`, ir: '/hoy' };
  },
});

const entregasReintentar = def({
  nombre: 'entregas.reintentar',
  tipo: 'cambio',
  descripcion: 'Volver a poner en marcha una entrega que estaba apartada para una persona (incidencia).',
  parametros: 'cliente (pedido, nombre o teléfono)',
  ejemplo: { orden: 'vuelve a intentar la entrega de Luis Huamán', accion: { accion: 'entregas.reintentar', cliente: 'Luis Huamán' } },
  schema: z.object(clienteSchema),
  async preparar(p, ctx) {
    return prepararConEntrega(ctx, p, p.cliente, '¿Cuál reintento?', (e) => ({ tipo: 'listo', params: { ...p, entregaId: e.id }, tarjeta: { que: `Volver a poner en marcha ${e.referencia}`, aQuien: quienEntrega(e), antes: `${estadoEnPalabras(e.estado)}${e.situacion ? ` (${acortar(e.situacion, 90)})` : ''}`, despues: 'en marcha otra vez: el sistema retoma lo que le falte (ubicación, confirmación o motorizado)' } }));
  },
  async ejecutar(p, ctx) {
    const u = await unaEntrega(ctx, p.cliente, p.entregaId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/entregas/${u.e.id}/reintentar`, body: {} });
    if (!ok(r)) return errorDe(r, 'No se pudo reintentar.');
    return { ok: true, resumen: `${u.e.referencia} de ${u.e.nombre ?? u.e.phone} vuelve a estar en marcha.`, ir: '/hoy' };
  },
});

const entregasSegundaVisita = def({
  nombre: 'entregas.segundaVisita',
  tipo: 'cambio',
  descripcion: 'Mandar al motorizado a pasar otra vez por una entrega en la que no había nadie (sin preguntarle al cliente).',
  parametros: 'cliente (pedido, nombre o teléfono)',
  ejemplo: { orden: 'que vuelvan a pasar por el pedido de Rosa', accion: { accion: 'entregas.segundaVisita', cliente: 'Rosa' } },
  schema: z.object(clienteSchema),
  async preparar(p, ctx) {
    return prepararConEntrega(ctx, p, p.cliente, '¿A cuál vuelven a pasar?', (e) => {
      if (e.lat == null) return { tipo: 'no', resumen: `${e.referencia} no tiene ubicación: ponle el pin primero.`, ir: '/hoy' };
      return { tipo: 'listo', params: { ...p, entregaId: e.id }, tarjeta: { que: `Segunda visita a ${e.referencia}`, aQuien: quienEntrega(e), antes: estadoEnPalabras(e.estado), despues: `${e.motorizado ? e.motorizado.nombre : 'el motorizado'} vuelve a pasar hoy (solo hay una segunda visita por pedido)` } };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unaEntrega(ctx, p.cliente, p.entregaId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/entregas/${u.e.id}/segunda-visita`, body: {} });
    if (!ok(r)) return errorDe(r, 'No se pudo arrancar la segunda visita.');
    return { ok: true, resumen: `${u.e.referencia} de ${u.e.nombre ?? u.e.phone}: el motorizado vuelve a pasar hoy.`, ir: '/hoy' };
  },
});

const entregasUrgente = def({
  nombre: 'entregas.urgente',
  tipo: 'cambio',
  descripcion: 'Marcar (o quitar) un pedido como urgente: va primero hacia el motorizado y en su ruta.',
  parametros: 'cliente (pedido, nombre o teléfono), urgente (true por defecto; false para quitarlo)',
  ejemplo: { orden: 'el pedido P-1003 es urgente', accion: { accion: 'entregas.urgente', cliente: 'P-1003', urgente: true } },
  schema: z.object({ ...clienteSchema, urgente: z.boolean().default(true) }),
  async preparar(p, ctx) {
    return prepararConEntrega(ctx, p, p.cliente, '¿Cuál?', (e) => {
      const ya = (e.prioridad === 'urgente') === p.urgente;
      if (ya) return { tipo: 'no', resumen: `${e.referencia} ya ${p.urgente ? 'es urgente' : 'no es urgente'}.`, ir: '/hoy' };
      return { tipo: 'listo', params: { ...p, entregaId: e.id }, tarjeta: { que: `${p.urgente ? 'Marcar como URGENTE' : 'Quitar lo de urgente a'} ${e.referencia}`, aQuien: quienEntrega(e), antes: e.prioridad === 'urgente' ? 'urgente' : 'normal', despues: p.urgente ? 'urgente: va primero' : 'normal', avisos: p.urgente && e.motorizado ? [`A ${e.motorizado.nombre}, que ya lo lleva, se le avisa por WhatsApp.`] : undefined } };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unaEntrega(ctx, p.cliente, p.entregaId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/entregas/${u.e.id}/prioridad`, body: { urgente: p.urgente } });
    if (!ok(r)) return errorDe(r, 'No se pudo cambiar la prioridad.');
    return { ok: true, resumen: p.urgente ? `${u.e.referencia} de ${u.e.nombre ?? u.e.phone} queda como URGENTE: va primero.` : `${u.e.referencia} de ${u.e.nombre ?? u.e.phone} deja de ser urgente.`, ir: '/hoy' };
  },
});

const entregasUbicacion = def({
  nombre: 'entregas.ubicacion',
  tipo: 'cambio',
  descripcion: 'Ponerle la ubicación a un pedido a mano (unas coordenadas o un enlace de Google Maps), como si el cliente la hubiera mandado.',
  parametros: 'cliente (pedido, nombre o teléfono), coordenadas ("-12.05,-77.03") o lat y lng, o enlace (de Google Maps)',
  ejemplo: { orden: 'ponle la ubicación -12.05,-77.03 al pedido GSG-IA-002', accion: { accion: 'entregas.ubicacion', cliente: 'GSG-IA-002', coordenadas: '-12.05,-77.03' } },
  schema: z
    .object({ ...clienteSchema, coordenadas: z.string().trim().max(80).optional(), lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(), enlace: z.string().trim().max(2000).optional() })
    .refine((v) => coordenadasDe(v) || v.enlace, { message: 'Hacen falta las coordenadas ("-12.05,-77.03") o un enlace de Google Maps.' }),
  async preparar(p, ctx) {
    const c = coordenadasDe(p);
    if (c && (Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180)) return { tipo: 'no', resumen: `"${p.coordenadas ?? `${p.lat},${p.lng}`}" no son coordenadas válidas: van como latitud, longitud (por ejemplo -12.05,-77.03).` };
    return prepararConEntrega(ctx, p, p.cliente, '¿A qué pedido le pongo la ubicación?', (e) => {
      if (ESTADOS_FINALES.includes(e.estado)) return { tipo: 'no', resumen: `${e.referencia} ya está ${estadoEnPalabras(e.estado)}.`, ir: '/hoy' };
      const nueva = c ? `${c.lat}, ${c.lng} (${mapaDe(c.lat, c.lng)})` : `la del enlace ${acortar(p.enlace, 80)}`;
      return {
        tipo: 'listo',
        params: { ...p, entregaId: e.id, ...(c ? { lat: c.lat, lng: c.lng } : {}) },
        tarjeta: { que: `Poner la ubicación del pedido ${e.referencia}`, aQuien: quienEntrega(e), antes: e.lat != null && e.lng != null ? `${e.lat}, ${e.lng}` : 'sin ubicación', despues: nueva, avisos: ['Cuenta como si el cliente la hubiera mandado: el sistema sigue solo (si falta, se le pide la confirmación por WhatsApp; con todo, pasa a un motorizado).'] },
      };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unaEntrega(ctx, p.cliente, p.entregaId);
    if ('error' in u) return u.error;
    const c = coordenadasDe(p);
    const r = await ctx.llamar({ method: 'POST', url: `/admin/entregas/${u.e.id}/ubicacion`, body: c ? { lat: c.lat, lng: c.lng } : { texto: p.enlace } });
    if (!ok(r)) return errorDe(r, 'No se pudo poner la ubicación.');
    const n = (r.json as { entrega?: { lat?: number | null; lng?: number | null } }).entrega;
    return { ok: true, resumen: `Ubicación puesta a ${u.e.referencia} de ${u.e.nombre ?? u.e.phone}${n?.lat != null && n?.lng != null ? `: ${mapaDe(n.lat, n.lng)}` : ''}.`, ir: '/hoy' };
  },
});

const entregasEntregada = def({
  nombre: 'entregas.entregada',
  tipo: 'cambio',
  descripcion: 'Marcar un pedido como entregado a mano (el motorizado lo dijo por teléfono). GSG se entera.',
  parametros: 'cliente (pedido, nombre o teléfono)',
  ejemplo: { orden: 'marca como entregado el GSG-IA-003', accion: { accion: 'entregas.entregada', cliente: 'GSG-IA-003' } },
  schema: z.object(clienteSchema),
  async preparar(p, ctx) {
    return prepararConEntrega(ctx, p, p.cliente, '¿Cuál marco como entregado?', (e, { ajustes }) => {
      if (e.estado === 'entregada' || e.estado === 'terminada') return { tipo: 'no', resumen: `${e.referencia} ya figura entregado.`, ir: '/hoy' };
      if (e.estado === 'cancelada') return { tipo: 'no', resumen: `${e.referencia} está cancelado: no se puede marcar como entregado.`, ir: '/hoy' };
      const avisos = ['GSG recibe el entregado.'];
      if (ajustes.avisarEntregado !== false && ajustes.silencioTrasUbi === false) avisos.push('Al cliente le llega el mensaje de gracias (ajuste «avisar al cliente al entregar»).');
      return { tipo: 'listo', params: { ...p, entregaId: e.id }, tarjeta: { que: `Marcar ${e.referencia} como entregado`, aQuien: `${quienEntrega(e)}${e.motorizado ? `, lo llevaba ${e.motorizado.nombre}` : ''}`, antes: estadoEnPalabras(e.estado), despues: 'entregada (la marcaste a mano)', avisos } };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unaEntrega(ctx, p.cliente, p.entregaId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/entregas/${u.e.id}/entregada`, body: {} });
    if (!ok(r)) return errorDe(r, 'No se pudo marcar como entregado.');
    return { ok: true, resumen: `${u.e.referencia} de ${u.e.nombre ?? u.e.phone} queda entregado.`, ir: '/hoy' };
  },
});

const entregasCrear = def({
  nombre: 'entregas.crear',
  tipo: 'cambio',
  descripcion: 'Crear un pedido a mano en Hoy (sin GSG): se le pedirá la ubicación y la confirmación al cliente, como a los demás.',
  parametros: 'telefono, nombre, direccion, distrito, referencia (opcional: si no, la pone el sistema), urgente (true/false), faltaUbicacion (true por defecto), faltaConfirmacion (true por defecto), notas',
  ejemplo: { orden: 'crea un pedido para Rosa Díaz, 987 111 222, Av. Arequipa 1200, Lince', accion: { accion: 'entregas.crear', telefono: '987111222', nombre: 'Rosa Díaz', direccion: 'Av. Arequipa 1200', distrito: 'Lince' } },
  schema: z.object({ telefono, nombre: z.string().trim().max(120).optional(), direccion: z.string().trim().max(300).optional(), distrito: z.string().trim().max(120).optional(), referencia: z.string().trim().max(60).optional(), notas: z.string().trim().max(300).optional(), urgente: z.boolean().optional(), faltaUbicacion: z.boolean().default(true), faltaConfirmacion: z.boolean().default(true) }),
  async preparar(p, ctx) {
    const tel = telefonoADigitos(p.telefono);
    const avisos = await avisosDeEnvio(ctx, [tel]);
    const que = [p.faltaUbicacion ? 'se le pedirá su ubicación' : '', p.faltaConfirmacion ? 'se le preguntará si recibe hoy (SÍ/NO)' : ''].filter(Boolean).join(' y ') || 'no se le pide nada: va directo a un motorizado cuando tenga pin';
    return { tipo: 'listo', params: p, tarjeta: { que: `Crear un pedido a mano${p.referencia ? ` (${p.referencia})` : ''}`, aQuien: `${p.nombre ?? 'sin nombre'} (${telefonoBonito(tel)})${p.direccion ? `, ${p.direccion}` : ''}${p.distrito ? `, ${p.distrito}` : ''}`, despues: `pedido nuevo en Hoy${p.urgente ? ', URGENTE' : ''}: ${que}`, avisos } };
  },
  async ejecutar(p, ctx) {
    const r = await ctx.llamar({ method: 'POST', url: '/admin/entregas/crear', body: { ...p, telefono: telefonoADigitos(p.telefono) } });
    if (!ok(r)) return errorDe(r, 'No se pudo crear el pedido.');
    const e = (r.json as { entrega?: { referencia?: string } }).entrega;
    return { ok: true, resumen: `Pedido ${e?.referencia ?? ''} creado para ${p.nombre ?? telefonoADigitos(p.telefono)}.`, ir: '/hoy' };
  },
});

const entregasCerrarDia = def({
  nombre: 'entregas.cerrarDia',
  tipo: 'cambio',
  soloAdmin: true,
  peligrosa: true,
  descripcion: 'Cerrar el día a mano: lo que quedó vivo de días anteriores pasa a "necesita a una persona", lo avisado sin "entregado" se da por entregado, GSG se entera y el supervisor recibe el resumen.',
  parametros: '(ninguno)',
  ejemplo: { orden: 'cierra el día', accion: { accion: 'entregas.cerrarDia' } },
  schema: z.object({}),
  async preparar(p, ctx) {
    const r = await ctx.llamar({ method: 'GET', url: '/admin/entregas' });
    if (!ok(r)) return { tipo: 'no', resumen: errorDe(r, 'No se pudieron leer las entregas.').resumen };
    const j = r.json as { cierrePendiente?: number; cifras?: Record<string, number> };
    return { tipo: 'listo', params: p, tarjeta: { que: 'Cerrar el día de entregas', cuantos: j.cierrePendiente ?? 0, antes: `${j.cierrePendiente ?? 0} pedido(s) vivos de días anteriores; hoy ${j.cifras?.avisada ?? 0} con hora de llegada sin «entregado»`, despues: 'lo vivo de ayer pasa a «necesita a una persona»; lo avisado se da por entregado; GSG y el supervisor se enteran' } };
  },
  async ejecutar(_p, ctx) {
    const r = await ctx.llamar({ method: 'POST', url: '/admin/entregas/cerrar-dia', body: { forzar: true } });
    if (!ok(r)) return errorDe(r, 'No se pudo cerrar el día.');
    const j = r.json as { ok: boolean; motivo?: string | null; resultado?: { sinTerminar: string[]; dadasPorEntregadas: string[] } | null };
    if (!j.ok) return { ok: false, resumen: j.motivo ?? 'No se cerró el día.', ir: '/hoy' };
    return { ok: true, resumen: `Día cerrado: ${j.resultado?.sinTerminar.length ?? 0} sin terminar pasan a una persona y ${j.resultado?.dadasPorEntregadas.length ?? 0} se dan por entregados.`, ir: '/hoy' };
  },
});

// ------------------------------------------------ ajustes y textos de las entregas

const AJUSTES_EN_PALABRAS: Array<[clave: string, etiqueta: string, sufijo?: string]> = [
  ['margenMinutos', 'Margen que se suma a lo que dice el motorizado', ' min'],
  ['confirmacionEsperaMin', 'Espera antes de volver a pedir la confirmación', ' min'],
  ['confirmacionMaxIntentos', 'Veces que se pide la confirmación'],
  ['motorizadoEsperaMin', 'Espera a que conteste el motorizado', ' min'],
  ['motorizadoMaxIntentos', 'Veces que se le escribe a un motorizado antes de pasar a otro'],
  ['reasignarMotorizadoMin', 'Minutos hasta pasar el pedido solo a otro motorizado', ' min'],
  ['avisarEntregado', 'Avisar al cliente al entregar'],
  ['avisarCerca', 'Avisar al cliente cuando el motorizado está cerca'],
  ['responderDondeEsta', 'Contestar solo «¿dónde está mi pedido?»'],
  ['usarBotones', 'Usar botones SÍ / NO'],
  ['confirmarListaGsg', 'Revisar y confirmar la lista de GSG antes de enviar'],
  ['silencioTrasUbi', 'No escribirle más al cliente tras «Ubicación registrada»'],
];

const siNo = (v: unknown) => (v === true ? 'sí' : v === false ? 'no' : String(v ?? '—'));

const entregasAjustes = def({
  nombre: 'entregas.ajustes',
  tipo: 'cambio',
  soloAdmin: true,
  descripcion: 'Cambiar los ajustes de las entregas: horario de entrega (desde, hasta, extendido), margen de la hora de llegada, esperas e intentos, número de soporte, hora del cierre del día, y los interruptores (avisar al entregar, avisar cerca, botones, revisar la lista de GSG antes de enviar...).',
  parametros: 'solo lo que cambia: margenMinutos (0-240), horario: {desde, hasta, extendidoHasta} ("15:00" o "3 PM"), soporte: {whatsapp, llamadas}, confirmacionEsperaMin, confirmacionMaxIntentos, motorizadoEsperaMin, motorizadoMaxIntentos, reasignarMotorizadoMin, cierreHora (0-23), avisarEntregado, avisarCerca, responderDondeEsta, usarBotones, confirmarListaGsg, silencioTrasUbi (true/false)',
  ejemplo: { orden: 'cambia el horario de entrega a 3 PM - 9 PM y sube el margen a 45 minutos', accion: { accion: 'entregas.ajustes', horario: { desde: '15:00', hasta: '21:00' }, margenMinutos: 45 } },
  schema: z.object({
    margenMinutos: z.coerce.number().int().min(0).max(240).optional(),
    horario: z.object({ desde: hora.optional(), hasta: hora.optional(), extendidoHasta: hora.optional() }).optional(),
    soporte: z.object({ whatsapp: z.string().trim().max(20).optional(), llamadas: z.string().trim().max(20).optional() }).optional(),
    confirmacionEsperaMin: z.coerce.number().int().min(5).max(1440).optional(),
    confirmacionMaxIntentos: z.coerce.number().int().min(1).max(6).optional(),
    motorizadoEsperaMin: z.coerce.number().int().min(1).max(180).optional(),
    motorizadoMaxIntentos: z.coerce.number().int().min(1).max(5).optional(),
    reasignarMotorizadoMin: z.coerce.number().int().min(5).max(240).optional(),
    cierreHora: z.coerce.number().int().min(0).max(23).optional(),
    avisarEntregado: z.boolean().optional(),
    avisarCerca: z.boolean().optional(),
    responderDondeEsta: z.boolean().optional(),
    usarBotones: z.boolean().optional(),
    confirmarListaGsg: z.boolean().optional(),
    silencioTrasUbi: z.boolean().optional(),
  }),
  async preparar(p, ctx) {
    const l = await leerEntregas(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const a = l.ajustes as Record<string, unknown> & { horarioEntregas?: { desde: string; hasta: string; extendidoHasta: string }; soporte?: { whatsapp: string; llamadas: string }; cierreDelDia?: { hora: number } };
    const antes: string[] = [];
    const despues: string[] = [];
    for (const [k, etiqueta, suf] of AJUSTES_EN_PALABRAS) {
      const v = (p as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (a[k] === v) continue;
      antes.push(`${etiqueta}: ${typeof v === 'boolean' ? siNo(a[k]) : `${a[k] ?? '—'}${suf ?? ''}`}`);
      despues.push(`${etiqueta}: ${typeof v === 'boolean' ? siNo(v) : `${v}${suf ?? ''}`}`);
    }
    if (p.horario) {
      const h = a.horarioEntregas ?? { desde: '14:00', hasta: '20:00', extendidoHasta: '22:00' };
      const n = { ...h, ...Object.fromEntries(Object.entries(p.horario).filter(([, v]) => v)) } as typeof h;
      if (n.hasta <= n.desde) return { tipo: 'no', resumen: `El horario no cuadra: "hasta" (${horaBonita(n.hasta)}) tiene que ser después de "desde" (${horaBonita(n.desde)}).` };
      if (n.extendidoHasta < n.hasta) n.extendidoHasta = n.hasta;
      antes.push(`Horario de entrega: de ${horaBonita(h.desde)} a ${horaBonita(h.hasta)} (extendido hasta ${horaBonita(h.extendidoHasta)})`);
      despues.push(`Horario de entrega: de ${horaBonita(n.desde)} a ${horaBonita(n.hasta)} (extendido hasta ${horaBonita(n.extendidoHasta)})`);
    }
    if (p.soporte) {
      const s = a.soporte ?? { whatsapp: '', llamadas: '' };
      antes.push(`Soporte: WhatsApp ${s.whatsapp || 'este mismo'}, llamadas ${s.llamadas || 'el mismo'}`);
      despues.push(`Soporte: WhatsApp ${p.soporte.whatsapp ?? s.whatsapp ?? 'este mismo'}, llamadas ${p.soporte.llamadas ?? s.llamadas ?? 'el mismo'}`);
    }
    if (p.cierreHora !== undefined) {
      antes.push(`Cierre del día: a las ${a.cierreDelDia?.hora ?? 0}:00`);
      despues.push(`Cierre del día: a las ${p.cierreHora}:00`);
    }
    if (!despues.length) return { tipo: 'no', resumen: 'Eso ya está así: no hay nada que cambiar.', ir: '/hoy#ajustes' };
    return { tipo: 'listo', params: p, tarjeta: { que: 'Cambiar los ajustes de las entregas', antes: antes.join(' · '), despues: despues.join(' · '), avisos: p.horario ? ['El horario sale en los textos al cliente ({desde}, {hasta}, {hastaExtendido}) y amplía el horario de envío del número.'] : undefined } };
  },
  async ejecutar(p, ctx) {
    const body: Record<string, unknown> = {};
    for (const [k] of AJUSTES_EN_PALABRAS) if ((p as Record<string, unknown>)[k] !== undefined) body[k] = (p as Record<string, unknown>)[k];
    if (p.horario) {
      const l = await leerEntregas(ctx);
      const h = ('error' in l ? null : (l.ajustes.horarioEntregas as { desde: string; hasta: string; extendidoHasta: string } | undefined)) ?? { desde: '14:00', hasta: '20:00', extendidoHasta: '22:00' };
      const n = { ...h, ...Object.fromEntries(Object.entries(p.horario).filter(([, v]) => v)) } as typeof h;
      if (n.extendidoHasta < n.hasta) n.extendidoHasta = n.hasta;
      body.horarioEntregas = n;
    }
    if (p.soporte) body.soporte = Object.fromEntries(Object.entries(p.soporte).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v).replace(/\D/g, '')]));
    if (p.cierreHora !== undefined) body.cierreDelDia = { hora: p.cierreHora };
    const r = await ctx.llamar({ method: 'POST', url: '/admin/entregas/ajustes', body });
    if (!ok(r)) return errorDe(r, 'No se pudieron guardar los ajustes de las entregas.');
    const a = (r.json as { ajustes?: { margenMinutos?: number; horarioEntregas?: { desde: string; hasta: string } } }).ajustes;
    return { ok: true, resumen: `Ajustes de las entregas guardados${a?.horarioEntregas ? `: entregas de ${horaBonita(a.horarioEntregas.desde)} a ${horaBonita(a.horarioEntregas.hasta)}` : ''}${a?.margenMinutos !== undefined ? `, margen ${a.margenMinutos} min` : ''}.`, ir: '/hoy#ajustes' };
  },
});

const CLAVES_TEXTOS = Object.keys(ajustesEntregasSchema.shape.textos.removeDefault().shape) as Array<keyof typeof TEXTOS_POR_DEFECTO>;
const variablesDe = (t: string): string[] => [...new Set(t.match(/\{[a-zA-Z]+\}/g) ?? [])];

const entregasTexto = def({
  nombre: 'entregas.texto',
  tipo: 'cambio',
  soloAdmin: true,
  descripcion: 'Cambiar uno de los textos que el sistema manda en las entregas (al cliente o al motorizado). Las variables van entre llaves: {nombre}, {pedido}, {negocio}, {mapa}, {desde}, {hasta}, {hastaExtendido}, {soporte}, {hora}...',
  parametros: `clave (cuál texto: ubicacionRegistrada = «Ubicación registrada», solicitudUbicacion = el primer pedido de ubicación, pedirConfirmacion, insistirConfirmacion, confirmada, cancelada, avisoLlegada = la hora de llegada, clienteEntregado, clienteCerca, motorizadoNuevo = lo que recibe el motorizado, motorizadoRuta; todas: ${CLAVES_TEXTOS.join(', ')}), texto (el texto nuevo entero; "" = volver al de fábrica)`,
  ejemplo: { orden: 'cambia el texto de ubicación registrada por "Listo {nombre}, ya tenemos tu ubicación: {mapa}"', accion: { accion: 'entregas.texto', clave: 'ubicacionRegistrada', texto: 'Listo {nombre}, ya tenemos tu ubicación: {mapa}' } },
  schema: z.object({ clave: z.enum(CLAVES_TEXTOS as [string, ...string[]], { errorMap: () => ({ message: `ese texto no existe; son: ${CLAVES_TEXTOS.join(', ')}` }) }), texto: z.string().max(2000) }),
  async preparar(p, ctx) {
    const l = await leerEntregas(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const propios = (l.ajustes.textos ?? {}) as Record<string, string>;
    const actual = propios[p.clave]?.trim() ? propios[p.clave]! : (TEXTOS_POR_DEFECTO as Record<string, string>)[p.clave] ?? '';
    const nuevo = p.texto.trim() ? p.texto : (TEXTOS_POR_DEFECTO as Record<string, string>)[p.clave] ?? '';
    if (actual.trim() === nuevo.trim()) return { tipo: 'no', resumen: 'Ese texto ya dice exactamente eso.', ir: '/hoy#ajustes' };
    const faltan = variablesDe(actual).filter((v) => !nuevo.includes(v));
    const avisos = faltan.length ? [`El texto de ahora usa ${faltan.join(', ')} y el nuevo no: eso dejará de salir.`] : [];
    if (!p.texto.trim()) avisos.push('Vuelve al texto de fábrica.');
    return { tipo: 'listo', params: p, tarjeta: { que: `Cambiar el texto «${p.clave}» de las entregas`, antes: acortar(actual, 400), despues: acortar(nuevo, 400), avisos } };
  },
  async ejecutar(p, ctx) {
    const r = await ctx.llamar({ method: 'POST', url: '/admin/entregas/ajustes', body: { textos: { [p.clave]: p.texto } } });
    if (!ok(r)) return errorDe(r, 'No se pudo guardar el texto.');
    return { ok: true, resumen: `Texto «${p.clave}» guardado: desde ya sale así.`, ir: '/hoy#ajustes' };
  },
});

// ---------------------------------------------------------- números del día

interface NumeroVista {
  id: number;
  referencia: string;
  nombre: string | null;
  telefono: string;
  etapa: string;
  grupo: 'ubicacion' | 'confirmar';
  porConfirmar: boolean;
  pausado: boolean;
}

async function leerNumeros(ctx: ContextoAccion): Promise<NumeroVista[] | { error: ResultadoAccion }> {
  const r = await ctx.llamar({ method: 'GET', url: '/admin/entregas/numeros' });
  if (!ok(r)) return { error: errorDe(r, 'No se pudieron leer los números del día.') };
  return ((r.json as { numeros?: NumeroVista[] }).numeros ?? []) as NumeroVista[];
}

/** Los números que se quieren tocar: por pedido (código, nombre o teléfono) o todos los de una etapa. */
function escogerNumeros(lista: NumeroVista[], pedidos: string[] | undefined, filtro: (n: NumeroVista) => boolean): { elegidos: NumeroVista[]; noEncontrados: string[] } {
  if (!pedidos?.length) return { elegidos: lista.filter(filtro), noEncontrados: [] };
  const elegidos: NumeroVista[] = [];
  const noEncontrados: string[] = [];
  for (const q of pedidos) {
    const cod = normal(q).replace(/[^a-z0-9]/g, '');
    const dig = telefonoADigitos(q);
    const n = lista.find((x) => normal(x.referencia).replace(/[^a-z0-9]/g, '') === cod) ?? lista.find((x) => /^\d{6,}$/.test(dig) && x.telefono === dig) ?? lista.find((x) => normal(x.nombre) === normal(q));
    if (n && filtro(n)) elegidos.push(n);
    else noEncontrados.push(q);
  }
  return { elegidos: elegidos.filter((x, i, t) => t.findIndex((y) => y.id === x.id) === i), noEncontrados };
}

const listaCorta = (ns: NumeroVista[]) => `${ns.slice(0, 8).map((n) => `${n.referencia} (${n.nombre ?? telefonoBonito(n.telefono)})`).join(', ')}${ns.length > 8 ? ` y ${ns.length - 8} más` : ''}`;

const numerosConfirmarEnvio = def({
  nombre: 'numeros.confirmarEnvio',
  tipo: 'cambio',
  descripcion: 'Números del día: «Confirmar y enviar» lo que llegó de GSG y espera tu revisión. Al confirmarlo, a cada uno se le pide la ubicación (o se le pregunta SÍ/NO), con el ritmo de siempre.',
  parametros: 'todos (true = todos los que esperan) o pedidos (lista de códigos, nombres o teléfonos)',
  ejemplo: { orden: 'confirma el envío de todos los números del día', accion: { accion: 'numeros.confirmarEnvio', todos: true } },
  schema: z.object({ todos: z.boolean().optional(), pedidos: z.array(z.string().trim().min(1)).max(2000).optional(), ids: z.array(z.coerce.number().int().positive()).max(2000).optional() }),
  async preparar(p, ctx) {
    const l = await leerNumeros(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const { elegidos, noEncontrados } = escogerNumeros(l, p.todos ? undefined : p.pedidos, (n) => n.porConfirmar);
    if (!p.todos && !p.pedidos?.length) return { tipo: 'no', resumen: '¿Todos los que esperan, o cuáles? Dime «todos» o los pedidos.' };
    if (!elegidos.length) return { tipo: 'no', resumen: noEncontrados.length ? `Ninguno de esos espera que se confirme su envío (${noEncontrados.join(', ')}).` : 'No hay ningún número esperando que confirmes su envío.', ir: '/numeros' };
    const ub = elegidos.filter((n) => n.grupo === 'ubicacion').length;
    const avisos = await avisosDeEnvio(ctx, elegidos.map((n) => n.telefono));
    if (noEncontrados.length) avisos.push(`No esperan confirmación (se quedan como están): ${noEncontrados.join(', ')}.`);
    return { tipo: 'listo', params: { ids: elegidos.map((n) => n.id) }, tarjeta: { que: `Confirmar y enviar ${elegidos.length} número(s) del día`, cuantos: elegidos.length, aQuien: listaCorta(elegidos), antes: 'esperando que confirmes el envío', despues: `${ub} recibirán el pedido de ubicación y ${elegidos.length - ub} la pregunta SÍ/NO, de uno en uno con el ritmo del número`, avisos } };
  },
  async ejecutar(p, ctx) {
    let ids = p.ids;
    if (!ids?.length) {
      const l = await leerNumeros(ctx);
      if ('error' in l) return l.error;
      ids = escogerNumeros(l, p.todos ? undefined : p.pedidos, (n) => n.porConfirmar).elegidos.map((n) => n.id);
    }
    if (!ids.length) return { ok: false, resumen: 'No hay ningún número esperando que confirmes su envío.', ir: '/numeros' };
    const r = await ctx.llamar({ method: 'POST', url: '/admin/entregas/confirmar-envio', body: { ids } });
    if (!ok(r)) return errorDe(r, 'No se pudo confirmar el envío.');
    const j = r.json as { liberadas?: number; saltadas?: number; aviso?: string };
    return { ok: (j.liberadas ?? 0) > 0, resumen: j.aviso || `Envío confirmado a ${j.liberadas ?? 0}.`, ir: '/numeros' };
  },
});

const MASA = ['pedir_ubicacion', 'pedir_confirmacion', 'marcar_contactado', 'quitar_marca', 'pausar', 'reanudar'] as const;
const MASA_EN_PALABRAS: Record<(typeof MASA)[number], string> = {
  pedir_ubicacion: 'Pedirles la ubicación ahora',
  pedir_confirmacion: 'Pedirles la confirmación (SÍ/NO) ahora',
  marcar_contactado: 'Marcarlos como contactados',
  quitar_marca: 'Quitarles la marca de contactados',
  pausar: 'Parar sus mensajes automáticos',
  reanudar: 'Reanudar sus mensajes automáticos',
};

const numerosMasa = def({
  nombre: 'numeros.masa',
  tipo: 'cambio',
  descripcion: 'Números del día, varios de golpe: pedirles la ubicación o la confirmación ahora, marcarlos como contactados (o quitar la marca), parar o reanudar sus mensajes automáticos.',
  parametros: 'accionMasa: pedir_ubicacion | pedir_confirmacion | marcar_contactado | quitar_marca | pausar | reanudar; pedidos (lista de códigos, nombres o teléfonos) o etapa (falta_pedir | falta_ubicacion | falta_confirmar | contactados | necesita)',
  ejemplo: { orden: 'pídeles la ubicación ahora a todos los que les falta', accion: { accion: 'numeros.masa', accionMasa: 'pedir_ubicacion', etapa: 'falta_ubicacion' } },
  schema: z.object({ accionMasa: z.enum(MASA), pedidos: z.array(z.string().trim().min(1)).max(2000).optional(), etapa: z.string().trim().max(40).optional(), ids: z.array(z.coerce.number().int().positive()).max(2000).optional() }).refine((v) => v.pedidos?.length || v.etapa || v.ids?.length, { message: 'Hace falta decir a cuáles: pedidos o etapa.' }),
  async preparar(p, ctx) {
    const l = await leerNumeros(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const { elegidos, noEncontrados } = escogerNumeros(l, p.pedidos, (n) => !p.etapa || n.etapa === p.etapa);
    if (!elegidos.length) return { tipo: 'no', resumen: `No hay ningún número ${p.etapa ? `en «${p.etapa}»` : 'con esos pedidos'}.`, ir: '/numeros' };
    const avisos = p.accionMasa === 'pedir_ubicacion' || p.accionMasa === 'pedir_confirmacion' ? await avisosDeEnvio(ctx, elegidos.map((n) => n.telefono)) : [];
    if (noEncontrados.length) avisos.push(`No encontrados (no se tocan): ${noEncontrados.join(', ')}.`);
    return { tipo: 'listo', params: { accionMasa: p.accionMasa, ids: elegidos.map((n) => n.id) }, tarjeta: { que: `${MASA_EN_PALABRAS[p.accionMasa]} a ${elegidos.length} número(s)`, cuantos: elegidos.length, aQuien: listaCorta(elegidos), avisos } };
  },
  async ejecutar(p, ctx) {
    let ids = p.ids;
    if (!ids?.length) {
      const l = await leerNumeros(ctx);
      if ('error' in l) return l.error;
      ids = escogerNumeros(l, p.pedidos, (n) => !p.etapa || n.etapa === p.etapa).elegidos.map((n) => n.id);
    }
    if (!ids.length) return { ok: false, resumen: 'No hay ningún número al que hacérselo.', ir: '/numeros' };
    const r = await ctx.llamar({ method: 'POST', url: '/admin/entregas/masa', body: { accion: p.accionMasa, ids } });
    if (!ok(r)) return errorDe(r, 'No se pudo hacer.');
    const j = r.json as { hechos?: number; saltados?: number; aviso?: string };
    return { ok: (j.hechos ?? 0) > 0, resumen: j.aviso ?? `Hecho a ${j.hechos ?? 0}.`, ir: '/numeros' };
  },
});

// ================================================================== MOTORIZADOS

const motorizadosEstado = def({
  nombre: 'motorizados.estado',
  tipo: 'cambio',
  descripcion: 'Poner a un motorizado activo, en descanso o de baja (si lleva pedidos, pasan a otros antes).',
  parametros: 'motorizado (nombre o teléfono), estado: activo | descanso | baja',
  ejemplo: { orden: 'pasa a descanso al motorizado Ali', accion: { accion: 'motorizados.estado', motorizado: 'Ali', estado: 'descanso' } },
  schema: z.object({ motorizado: texto(120), motorizadoId: idOpcional, estado: z.enum(['activo', 'descanso', 'baja']) }),
  async preparar(p, ctx) {
    const l = await leerMotorizados(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const x = elegirMotorizado(l, p.motorizado, p.motorizadoId, `¿A cuál pongo ${p.estado === 'activo' ? 'activo' : p.estado === 'descanso' ? 'en descanso' : 'de baja'}?`, (m) => ({ ...p, motorizadoId: m.id }));
    if ('preparado' in x) return x.preparado;
    const m = x.m;
    if (m.estado === p.estado) return { tipo: 'no', resumen: `${m.nombre} ya está ${p.estado === 'activo' ? 'activo' : p.estado === 'descanso' ? 'en descanso' : 'de baja'}.`, ir: '/motorizados' };
    const palabra = (e?: string) => (e === 'descanso' ? 'en descanso' : e === 'baja' ? 'de baja' : 'activo');
    const avisos = p.estado !== 'activo' && m.enManos ? [`Lleva ${m.enManos} pedido(s) entre manos: pasan a otros motorizados.`] : [];
    return { tipo: 'listo', params: { ...p, motorizadoId: m.id, motorizado: m.nombre }, tarjeta: { que: `Poner a ${m.nombre} ${palabra(p.estado)}`, aQuien: lineaMotorizado(m), antes: palabra(m.estado), despues: palabra(p.estado), avisos } };
  },
  async ejecutar(p, ctx) {
    const u = await unMotorizado(ctx, p.motorizado, p.motorizadoId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/motorizados/${u.m.id}`, body: { estado: p.estado } });
    if (!ok(r)) return errorDe(r, 'No se pudo cambiar el estado.');
    return { ok: true, resumen: `${u.m.nombre} queda ${p.estado === 'activo' ? 'activo' : p.estado === 'descanso' ? 'en descanso' : 'de baja'}.`, ir: '/motorizados' };
  },
});

const motorizadosEditar = def({
  nombre: 'motorizados.editar',
  tipo: 'cambio',
  descripcion: 'Cambiarle a un motorizado el nombre, la zona (distritos) o la placa.',
  parametros: 'motorizado (nombre o teléfono), nombre (nuevo), zona, placa: solo lo que cambia',
  ejemplo: { orden: 'la zona de Carlos ahora es Surco y La Molina', accion: { accion: 'motorizados.editar', motorizado: 'Carlos', zona: 'Surco, La Molina' } },
  schema: z.object({ motorizado: texto(120), motorizadoId: idOpcional, nombre: z.string().trim().min(1).max(120).optional(), zona: z.string().trim().max(300).optional(), placa: z.string().trim().max(20).optional() }).refine((v) => v.nombre || v.zona !== undefined || v.placa !== undefined, { message: 'Dime qué le cambio: nombre, zona o placa.' }),
  async preparar(p, ctx) {
    const l = await leerMotorizados(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const x = elegirMotorizado(l, p.motorizado, p.motorizadoId, '¿A cuál le cambio los datos?', (m) => ({ ...p, motorizadoId: m.id }));
    if ('preparado' in x) return x.preparado;
    const m = x.m;
    const antes: string[] = [];
    const despues: string[] = [];
    if (p.nombre && p.nombre !== m.nombre) {
      antes.push(`nombre: ${m.nombre}`);
      despues.push(`nombre: ${p.nombre}`);
    }
    if (p.zona !== undefined && p.zona !== (m.zona ?? '')) {
      antes.push(`zona: ${m.zona || '—'}`);
      despues.push(`zona: ${p.zona || '—'}`);
    }
    if (p.placa !== undefined && p.placa !== (m.placa ?? '')) {
      antes.push(`placa: ${m.placa || '—'}`);
      despues.push(`placa: ${p.placa || '—'}`);
    }
    if (!despues.length) return { tipo: 'no', resumen: `${m.nombre} ya tiene esos datos.`, ir: '/motorizados' };
    return { tipo: 'listo', params: { ...p, motorizadoId: m.id }, tarjeta: { que: `Cambiar los datos de ${m.nombre}`, aQuien: lineaMotorizado(m), antes: antes.join(' · '), despues: despues.join(' · ') } };
  },
  async ejecutar(p, ctx) {
    const u = await unMotorizado(ctx, p.motorizado, p.motorizadoId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/motorizados/${u.m.id}`, body: { ...(p.nombre ? { nombre: p.nombre } : {}), ...(p.zona !== undefined ? { zona: p.zona } : {}), ...(p.placa !== undefined ? { placa: p.placa } : {}) } });
    if (!ok(r)) return errorDe(r, 'No se pudieron cambiar los datos.');
    return { ok: true, resumen: `Datos de ${p.nombre ?? u.m.nombre} guardados.`, ir: '/motorizados' };
  },
});

const motorizadosQuitar = def({
  nombre: 'motorizados.quitar',
  tipo: 'cambio',
  peligrosa: true,
  descripcion: 'Quitar a un motorizado de la lista (deja de recibir pedidos). Para un día de descanso es mejor ponerlo en descanso.',
  parametros: 'motorizado (nombre o teléfono)',
  ejemplo: { orden: 'quita al motorizado Julio de la lista', accion: { accion: 'motorizados.quitar', motorizado: 'Julio' } },
  schema: z.object({ motorizado: texto(120), motorizadoId: idOpcional }),
  async preparar(p, ctx) {
    const l = await leerMotorizados(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const x = elegirMotorizado(l, p.motorizado, p.motorizadoId, '¿A cuál quito?', (m) => ({ ...p, motorizadoId: m.id }));
    if ('preparado' in x) return x.preparado;
    const m = x.m;
    return { tipo: 'listo', params: { ...p, motorizadoId: m.id, motorizado: m.nombre }, tarjeta: { que: `Quitar a ${m.nombre} de los motorizados`, aQuien: lineaMotorizado(m), antes: `en la lista (${m.estado ?? 'activo'})`, despues: 'fuera de la lista: ya no recibe pedidos', avisos: m.enManos ? [`Lleva ${m.enManos} pedido(s): mejor traspásalos antes («pásale sus pedidos a …»).`] : undefined } };
  },
  async ejecutar(p, ctx) {
    const u = await unMotorizado(ctx, p.motorizado, p.motorizadoId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'DELETE', url: `/admin/motorizados/${u.m.id}` });
    if (!ok(r)) return errorDe(r, 'No se pudo quitar.');
    return { ok: true, resumen: `${u.m.nombre} ya no está en la lista de motorizados.`, ir: '/motorizados' };
  },
});

const motorizadosEnlace = def({
  nombre: 'motorizados.enlace',
  tipo: 'cambio',
  descripcion: 'Mandarle a un motorizado por WhatsApp el enlace de su página (sus pedidos de hoy sin instalar nada; vale 7 días).',
  parametros: 'motorizado (nombre o teléfono)',
  ejemplo: { orden: 'mándale a Diego el enlace de su página', accion: { accion: 'motorizados.enlace', motorizado: 'Diego' } },
  schema: z.object({ motorizado: texto(120), motorizadoId: idOpcional }),
  async preparar(p, ctx) {
    const l = await leerMotorizados(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const x = elegirMotorizado(l, p.motorizado, p.motorizadoId, '¿A cuál le mando el enlace?', (m) => ({ ...p, motorizadoId: m.id }));
    if ('preparado' in x) return x.preparado;
    return { tipo: 'listo', params: { ...p, motorizadoId: x.m.id, motorizado: x.m.nombre }, tarjeta: { que: `Mandarle a ${x.m.nombre} el enlace de su página`, aQuien: lineaMotorizado(x.m), despues: 'recibe por WhatsApp un enlace nuevo (el anterior deja de valer)', avisos: await avisosDeEnvio(ctx, [x.m.phone]) } };
  },
  async ejecutar(p, ctx) {
    const u = await unMotorizado(ctx, p.motorizado, p.motorizadoId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/motorizados/${u.m.id}/enlace`, body: { mandar: true } });
    if (!ok(r)) return errorDe(r, 'No se pudo crear el enlace.');
    const j = r.json as { enviado?: boolean; motivo?: string; url?: string };
    return { ok: Boolean(j.enviado), resumen: j.enviado ? `Enlace mandado a ${u.m.nombre}.` : `El enlace se creó pero no salió por WhatsApp: ${j.motivo ?? 'el envío quedó frenado'}.`, ir: '/motorizados' };
  },
});

const motorizadosMandarRuta = def({
  nombre: 'motorizados.mandarRuta',
  tipo: 'cambio',
  descripcion: 'Mandarle por WhatsApp a un motorizado su ruta de hoy (un solo mensaje con sus paradas en orden).',
  parametros: 'motorizado (nombre o teléfono)',
  ejemplo: { orden: 'manda la ruta a Carlos', accion: { accion: 'motorizados.mandarRuta', motorizado: 'Carlos' } },
  schema: z.object({ motorizado: texto(120), motorizadoId: idOpcional }),
  async preparar(p, ctx) {
    const l = await leerMotorizados(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const x = elegirMotorizado(l, p.motorizado, p.motorizadoId, '¿A cuál le mando su ruta?', (m) => ({ ...p, motorizadoId: m.id }));
    if ('preparado' in x) return x.preparado;
    const r = await ctx.llamar({ method: 'GET', url: `/admin/motorizados/${x.m.id}/ruta` });
    if (!ok(r)) return { tipo: 'no', resumen: errorDe(r, 'No se pudo armar la ruta.').resumen };
    const ruta = (r.json as { ruta: { paradas: unknown[]; texto: string; totalKm: number } }).ruta;
    if (!ruta.paradas.length) return { tipo: 'no', resumen: `${x.m.nombre} no lleva pedidos ahora mismo: no hay ruta que mandar.`, ir: '/motorizados' };
    return { tipo: 'listo', params: { ...p, motorizadoId: x.m.id, motorizado: x.m.nombre }, tarjeta: { que: `Mandarle a ${x.m.nombre} su ruta de hoy`, aQuien: lineaMotorizado(x.m), cuantos: ruta.paradas.length, mensaje: acortar(ruta.texto, 900), avisos: await avisosDeEnvio(ctx, [x.m.phone]) } };
  },
  async ejecutar(p, ctx) {
    const u = await unMotorizado(ctx, p.motorizado, p.motorizadoId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/motorizados/${u.m.id}/ruta/mandar`, body: {} });
    if (!ok(r)) return errorDe(r, 'No se pudo mandar la ruta.');
    const ruta = (r.json as { ruta?: { paradas?: unknown[] } }).ruta;
    return { ok: true, resumen: `Ruta mandada a ${u.m.nombre}${ruta?.paradas ? ` (${ruta.paradas.length} parada(s))` : ''}.`, ir: '/motorizados' };
  },
});

const motorizadosTraspasar = def({
  nombre: 'motorizados.traspasar',
  tipo: 'cambio',
  peligrosa: true,
  descripcion: 'Quitarle a un motorizado todo lo que lleva y repartirlo a otro (uno concreto o el que toque), dejándolo activo o en descanso.',
  parametros: 'motorizado (nombre o teléfono), destino (nombre, opcional), descanso (true para dejarlo en descanso), motivo (opcional)',
  ejemplo: { orden: 'Carlos se quedó sin moto: pásale sus pedidos a Diego', accion: { accion: 'motorizados.traspasar', motorizado: 'Carlos', destino: 'Diego', descanso: true, motivo: 'se quedó sin moto' } },
  schema: z.object({ motorizado: texto(120), motorizadoId: idOpcional, destino: z.string().trim().max(120).optional(), destinoId: idOpcional, descanso: z.boolean().default(false), motivo: z.string().trim().max(200).optional() }),
  async preparar(p, ctx) {
    const l = await leerMotorizados(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const x = elegirMotorizado(l, p.motorizado, p.motorizadoId, '¿A quién le quito los pedidos?', (m) => ({ ...p, motorizadoId: m.id }));
    if ('preparado' in x) return x.preparado;
    let d: MotorizadoVista | null = null;
    if (p.destino || p.destinoId) {
      const y = elegirMotorizado(l, p.destino ?? '', p.destinoId, '¿A quién se los paso?', (m) => ({ ...p, motorizadoId: x.m.id, destinoId: m.id }));
      if ('preparado' in y) return y.preparado;
      d = y.m;
      if (d.id === x.m.id) return { tipo: 'no', resumen: 'El destino es el mismo motorizado.' };
      if (d.estado && d.estado !== 'activo') return { tipo: 'no', resumen: `${d.nombre} no está activo: actívalo primero o elige otro.`, ir: '/motorizados' };
    }
    return { tipo: 'listo', params: { ...p, motorizadoId: x.m.id, ...(d ? { destinoId: d.id } : {}) }, tarjeta: { que: `Traspasar los pedidos de ${x.m.nombre}${d ? ` a ${d.nombre}` : ''}`, aQuien: lineaMotorizado(x.m), cuantos: x.m.enManos ?? undefined, antes: `lleva ${x.m.enManos ?? 0} pedido(s)`, despues: `${d ? `los lleva ${d.nombre}` : 'se reparten a los que toque'}; ${x.m.nombre} queda ${p.descanso ? 'en descanso' : 'activo'}`, avisos: ['A los clientes que ya tenían hora se les avisa del cambio de motorizado.'] } };
  },
  async ejecutar(p, ctx) {
    const u = await unMotorizado(ctx, p.motorizado, p.motorizadoId);
    if ('error' in u) return u.error;
    let destino: number | null = null;
    let destinoNombre: string | undefined;
    if (p.destino || p.destinoId) {
      const d = await unMotorizado(ctx, p.destino ?? '', p.destinoId);
      if ('error' in d) return d.error;
      destino = d.m.id;
      destinoNombre = d.m.nombre;
    }
    const r = await ctx.llamar({ method: 'POST', url: `/admin/motorizados/${u.m.id}/traspasar`, body: { motorizadoId: destino, descanso: p.descanso, ...(p.motivo ? { motivo: p.motivo } : {}) } });
    if (!ok(r)) return errorDe(r, 'No se pudo traspasar.');
    const j = r.json as { traspasadas?: Array<{ referencia: string }>; destino?: { nombre: string } | null };
    const cuantos = j.traspasadas?.length ?? 0;
    return { ok: true, resumen: cuantos ? `${cuantos} pedido(s) de ${u.m.nombre} (${j.traspasadas!.map((x) => x.referencia).join(', ')}) pasan a ${j.destino?.nombre ?? destinoNombre ?? 'otros motorizados'}${p.descanso ? '; queda en descanso' : ''}.` : `${u.m.nombre} no tenía pedidos entre manos${p.descanso ? '; queda en descanso' : ''}.`, ir: '/motorizados' };
  },
});

const motorizadosHoy = def({
  nombre: 'motorizados.hoy',
  tipo: 'consulta',
  descripcion: 'Cuántos pedidos entregó hoy cada motorizado (o uno concreto), cuáles, y cuántos lleva todavía.',
  parametros: 'motorizado (opcional: nombre o teléfono)',
  ejemplo: { orden: '¿cuántos entregó Carlos hoy?', accion: { accion: 'motorizados.hoy', motorizado: 'Carlos' } },
  schema: z.object({ motorizado: z.string().trim().max(120).optional() }),
  async ejecutar(p, ctx) {
    const l = await leerEntregas(ctx);
    if ('error' in l) return l.error;
    let motos = l.motorizados;
    if (p.motorizado) {
      const x = elegirMotorizado(motos, p.motorizado, undefined, '', (m) => m);
      if ('preparado' in x) {
        const pr = x.preparado;
        if (pr.tipo === 'elegir') motos = pr.opciones.map((o) => o.params as MotorizadoVista);
        else return { ok: false, resumen: pr.tipo === 'no' ? pr.resumen : 'No lo encuentro.', ir: '/motorizados' };
      } else motos = [x.m];
    }
    const filas = motos.map((m) => {
      const suyas = l.entregas.filter((e) => e.motorizado?.id === m.id);
      const entregadas = suyas.filter((e) => e.estado === 'entregada' || e.estado === 'terminada');
      const vivas = suyas.filter((e) => !ESTADOS_FINALES.includes(e.estado) && e.estado !== 'incidencia');
      return { motorizado: m.nombre, entregadas: entregadas.length, pedidos: entregadas.map((e) => e.referencia), lleva: vivas.length, llevaPedidos: vivas.map((e) => e.referencia) };
    });
    const resumen = filas.length === 1 ? `${filas[0]!.motorizado} entregó hoy ${filas[0]!.entregadas} pedido(s)${filas[0]!.pedidos.length ? ` (${filas[0]!.pedidos.join(', ')})` : ''} y lleva ${filas[0]!.lleva} todavía.` : `Hoy: ${filas.map((f) => `${f.motorizado} ${f.entregadas}`).join(', ') || 'ningún motorizado'}.`;
    return { ok: true, resumen, datos: filas, ir: '/motorizados' };
  },
});

// ========================================================= consultas de entregas

const entregasDetalle = def({
  nombre: 'entregas.detalle',
  tipo: 'consulta',
  descripcion: 'Qué pasó con un pedido: su estado, su ubicación, su confirmación, su motorizado, la hora de llegada y la bitácora de todo lo que le pasó hoy.',
  parametros: 'cliente (pedido, nombre o teléfono)',
  ejemplo: { orden: '¿qué pasó con el pedido GSG-IA-002?', accion: { accion: 'entregas.detalle', cliente: 'GSG-IA-002' } },
  schema: z.object({ cliente: texto(120), entregaId: idOpcional }),
  async ejecutar(p, ctx) {
    const l = await leerEntregas(ctx);
    if ('error' in l) return l.error;
    let e = p.entregaId ? l.entregas.find((x) => x.id === p.entregaId) : undefined;
    if (!e) {
      const c = candidatosEntrega(l.entregas, p.cliente);
      if (!c.length) return { ok: false, resumen: `No encuentro ninguna entrega de hoy para "${p.cliente}".`, ir: '/hoy' };
      if (c.length > 1) return { ok: true, resumen: `Hay ${c.length} pedidos que coinciden con "${p.cliente}": ${c.slice(0, 8).map(lineaEntrega).join(' | ')}. ¿De cuál quieres el detalle?`, datos: c.slice(0, 8).map((x) => ({ pedido: x.referencia, cliente: x.nombre, estado: x.estado })), ir: '/hoy' };
      e = c[0]!;
    }
    const r = await ctx.llamar({ method: 'GET', url: `/admin/entregas/${e.id}` });
    if (!ok(r)) return errorDe(r, 'No se pudo leer ese pedido.');
    const j = r.json as { entrega: EntregaVista & { incidencia?: string | null; incidenciaDetalle?: string | null }; eventos: Array<{ createdAt?: string; at?: string; tipo: string; detalle: string | null }> };
    const x = j.entrega;
    // La ruta trae `createdAt` (en UTC): la hora se dice en el reloj de la tienda.
    const cuando = (ev: { createdAt?: string; at?: string }) => String(ev.createdAt ?? ev.at ?? '');
    const eventos = [...(j.eventos ?? [])].sort((a, b) => cuando(a).localeCompare(cuando(b))).slice(-20).map((ev) => `${cuando(ev) ? horaEnReloj(new Date(cuando(ev)), process.env.TIMEZONE || 'America/Lima') : '--:--'} ${ev.tipo}: ${acortar(ev.detalle ?? '', 140)}`);
    const resumen = `${lineaEntrega(x)}. ${x.situacion ?? ''} Ubicación: ${x.lat != null ? `sí (${mapaDe(x.lat, x.lng!)})` : 'no'}; confirmación: ${x.confirmacionEstado ?? '?'}${x.llegaAproxAt ? `; llega hacia las ${horaEnReloj(new Date(x.llegaAproxAt as string | Date), process.env.TIMEZONE || 'America/Lima')}` : ''}${x.incidenciaDetalle ? `; incidencia: ${x.incidenciaDetalle}` : ''}.`;
    return { ok: true, resumen, datos: { bitacora: eventos }, ir: '/hoy' };
  },
});

const entregasSinUbicacion = def({
  nombre: 'entregas.sinUbicacion',
  tipo: 'consulta',
  descripcion: 'Los pedidos de hoy que todavía no tienen ubicación (con su cliente, su teléfono y por dónde van).',
  parametros: '(ninguno)',
  ejemplo: { orden: 'dame los pedidos sin ubicación', accion: { accion: 'entregas.sinUbicacion' } },
  schema: z.object({}),
  async ejecutar(_p, ctx) {
    const l = await leerEntregas(ctx);
    if ('error' in l) return l.error;
    const sin = l.entregas.filter((e) => e.ubicacionEstado === 'pendiente' && !ESTADOS_FINALES.includes(e.estado));
    return { ok: true, resumen: sin.length ? `${sin.length} pedido(s) sin ubicación: ${sin.slice(0, 15).map((e) => `${e.referencia} (${e.nombre ?? telefonoBonito(e.phone)})`).join(', ')}${sin.length > 15 ? '…' : ''}.` : 'Todos los pedidos de hoy tienen ubicación.', datos: sin.slice(0, 60).map((e) => ({ pedido: e.referencia, cliente: e.nombre, telefono: e.phone, distrito: e.distrito, estado: estadoEnPalabras(e.estado), situacion: e.situacion })), ir: '/numeros' };
  },
});

// ======================================================================= CHATS

const chatAtenderPersona = def({
  nombre: 'chat.atenderPersona',
  tipo: 'cambio',
  descripcion: 'Apagar (o volver a encender) el bot en un chat: «de este me encargo yo» / «que vuelva a contestar solo».',
  parametros: 'telefono (o nombre), pausar (true = apagar el bot, lo atiende una persona; false = encenderlo)',
  ejemplo: { orden: 'apaga el bot en el chat de 912426667', accion: { accion: 'chat.atenderPersona', telefono: '912426667', pausar: true } },
  schema: z.object({ telefono: z.string().trim().min(2).max(120), contactId: z.string().max(80).optional(), pausar: z.boolean().default(true) }),
  async preparar(p, ctx) {
    return prepararConContacto(ctx, p, p.telefono, '¿En qué chat?', async (c) => {
      const f = await ctx.llamar({ method: 'GET', url: `/admin/chat/${encodeURIComponent(c.id)}/ficha` });
      const pausado = ok(f) ? Boolean((f.json as { contacto?: { botPausadoAt?: string | null } }).contacto?.botPausadoAt) : null;
      if (pausado === p.pausar) return { tipo: 'no', resumen: `En el chat de ${c.name ?? c.phone} el bot ya está ${p.pausar ? 'apagado' : 'encendido'}.`, ir: '/chat' };
      return { tipo: 'listo', params: { ...p, contactId: c.id }, tarjeta: { que: `${p.pausar ? 'Apagar' : 'Encender'} el bot en el chat de ${c.name ?? telefonoBonito(c.phone)}`, aQuien: `${c.name ?? 'sin nombre'} (${telefonoBonito(c.phone)})`, antes: pausado === null ? undefined : pausado ? 'bot apagado: lo atiende una persona' : 'el bot contesta solo', despues: p.pausar ? 'bot apagado: lo atiende una persona (los mensajes siguen entrando)' : 'el bot vuelve a contestar solo' } };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unContacto(ctx, p.telefono, p.contactId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/chat/${encodeURIComponent(u.c.id)}/bot`, body: { pausado: p.pausar } });
    if (!ok(r)) return errorDe(r, 'No se pudo cambiar.');
    return { ok: true, resumen: p.pausar ? `Listo: en el chat de ${u.c.name ?? u.c.phone} el sistema se calla; lo atiende una persona.` : `Listo: en el chat de ${u.c.name ?? u.c.phone} el sistema vuelve a contestar solo.`, ir: '/chat' };
  },
});

const chatAsistente = def({
  nombre: 'chat.asistente',
  tipo: 'cambio',
  descripcion: 'Devolverle un chat al asistente de IA (después de que lo cerrara para una persona) o quitárselo a mano.',
  parametros: 'telefono (o nombre), atiende (true = el asistente vuelve a atenderlo; false = se lo quitas)',
  ejemplo: { orden: 'que el asistente vuelva a atender a Luis', accion: { accion: 'chat.asistente', telefono: 'Luis', atiende: true } },
  schema: z.object({ telefono: z.string().trim().min(2).max(120), contactId: z.string().max(80).optional(), atiende: z.boolean().default(true) }),
  async preparar(p, ctx) {
    return prepararConContacto(ctx, p, p.telefono, '¿Qué chat?', async (c) => {
      const f = await ctx.llamar({ method: 'GET', url: `/admin/chat/${encodeURIComponent(c.id)}/ficha` });
      const cerrado = ok(f) ? Boolean((f.json as { contacto?: { iaCerradaAt?: string | null } }).contacto?.iaCerradaAt) : null;
      if (cerrado === !p.atiende) return { tipo: 'no', resumen: `El asistente ya ${p.atiende ? 'atiende' : 'no atiende'} el chat de ${c.name ?? c.phone}.`, ir: '/chat' };
      return { tipo: 'listo', params: { ...p, contactId: c.id }, tarjeta: { que: p.atiende ? `Devolverle al asistente el chat de ${c.name ?? telefonoBonito(c.phone)}` : `Quitarle al asistente el chat de ${c.name ?? telefonoBonito(c.phone)}`, aQuien: `${c.name ?? 'sin nombre'} (${telefonoBonito(c.phone)})`, antes: cerrado === null ? undefined : cerrado ? 'el asistente está callado: lo ve una persona' : 'lo atiende el asistente', despues: p.atiende ? 'lo atiende el asistente' : 'el asistente se calla: lo ve una persona' } };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unContacto(ctx, p.telefono, p.contactId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/chat/${encodeURIComponent(u.c.id)}/asistente`, body: { cerrado: !p.atiende } });
    if (!ok(r)) return errorDe(r, 'No se pudo cambiar.');
    return { ok: true, resumen: p.atiende ? `El asistente vuelve a atender a ${u.c.name ?? u.c.phone}.` : `El asistente deja de atender a ${u.c.name ?? u.c.phone}: lo ve una persona.`, ir: '/chat' };
  },
});

const chatCerrar = def({
  nombre: 'chat.cerrar',
  tipo: 'cambio',
  descripcion: 'Guardar todos los mensajes de un número / cerrar su chat: se guarda entero en Conversaciones guardadas y se vacía de Chats (se puede devolver al chat desde Guardados).',
  parametros: 'telefono (o nombre)',
  ejemplo: { orden: 'cierra el chat de Luis', accion: { accion: 'chat.cerrar', telefono: 'Luis' } },
  schema: z.object({ telefono: z.string().trim().min(2).max(120), contactId: z.string().max(80).optional() }),
  async preparar(p, ctx) {
    return prepararConContacto(ctx, p, p.telefono, '¿Qué chat cierro?', async (c) => {
      const r = await ctx.llamar({ method: 'GET', url: `/admin/chat/${encodeURIComponent(c.id)}?limit=200` });
      const n = ok(r) ? ((r.json as { messages?: unknown[] }).messages ?? []).length : null;
      if (n === 0) return { tipo: 'no', resumen: `El chat de ${c.name ?? c.phone} está vacío: no hay nada que guardar.`, ir: '/chat' };
      return { tipo: 'listo', params: { ...p, contactId: c.id }, tarjeta: { que: `Cerrar el chat de ${c.name ?? telefonoBonito(c.phone)}`, aQuien: `${c.name ?? 'sin nombre'} (${telefonoBonito(c.phone)})`, cuantos: n ?? undefined, antes: n === null ? 'en Chats' : `en Chats con ${n >= 200 ? '200 o más' : n} mensaje(s)`, despues: 'guardado en Conversaciones guardadas (con resumen y etiquetas) y vacío en Chats' } };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unContacto(ctx, p.telefono, p.contactId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/chat/${encodeURIComponent(u.c.id)}/archive`, body: {} });
    if (!ok(r)) return errorDe(r, 'No se pudo cerrar el chat.');
    const j = r.json as { archive?: { id?: number }; borrados?: number };
    return { ok: true, resumen: `Chat de ${u.c.name ?? u.c.phone} cerrado y guardado${j.borrados !== undefined ? ` (${j.borrados} mensajes)` : ''}.`, ir: j.archive?.id ? `/guardados?abrir=${j.archive.id}` : '/guardados' };
  },
});

const chatCerrarTerminados = def({
  nombre: 'chat.cerrarTerminados',
  tipo: 'cambio',
  descripcion: 'Guardar y vaciar de golpe los chats de los pedidos que ya terminaron hoy (entregados o avisados).',
  parametros: '(ninguno)',
  ejemplo: { orden: 'guarda los chats de los pedidos terminados de hoy', accion: { accion: 'chat.cerrarTerminados' } },
  schema: z.object({}),
  async preparar(p, ctx) {
    const l = await leerEntregas(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const t = l.entregas.filter((e) => ['entregada', 'terminada', 'avisada'].includes(e.estado));
    const tels = [...new Set(t.map((e) => e.phone))];
    if (!tels.length) return { tipo: 'no', resumen: 'Hoy todavía no terminó ningún pedido: no hay chats que guardar.', ir: '/guardados' };
    return { tipo: 'listo', params: p, tarjeta: { que: `Guardar y vaciar los chats de ${tels.length} cliente(s) con pedido terminado hoy`, cuantos: tels.length, aQuien: t.slice(0, 8).map((e) => `${e.referencia} (${e.nombre ?? telefonoBonito(e.phone)})`).join(', '), despues: 'quedan en Conversaciones guardadas; Chats se vacía de ellos' } };
  },
  async ejecutar(_p, ctx) {
    const r = await ctx.llamar({ method: 'POST', url: '/admin/archives/cerrar', body: { pedidosDeHoy: true } });
    if (!ok(r)) return errorDe(r, 'No se pudieron guardar.');
    const j = r.json as { guardadas?: number; saltadas?: unknown[] };
    return { ok: true, resumen: `${j.guardadas ?? 0} chat(s) guardados${j.saltadas?.length ? `; ${j.saltadas.length} sin mensajes que guardar` : ''}.`, ir: '/guardados' };
  },
});

// ==================================================================== MENSAJES

async function prepararMensaje<P extends { telefono: string }>(ctx: ContextoAccion, p: P, que: string, mensaje?: string): Promise<Preparado<P>> {
  const tel = telefonoADigitos(p.telefono);
  if (!/^\d{8,15}$/.test(tel)) return { tipo: 'no', resumen: `"${p.telefono}" no parece un número de WhatsApp: escríbelo con sus 9 dígitos (o con el 51 delante).` };
  const c = await ctx.llamar({ method: 'GET', url: `/admin/contacts?q=${tel}&limit=1` });
  const cont = ok(c) ? ((c.json as { items?: Array<{ phone: string; name: string | null; optOutAt: string | null }> }).items ?? []).find((x) => x.phone === tel) : undefined;
  const avisos = await avisosDeEnvio(ctx, [tel]);
  if (cont?.optOutAt) avisos.unshift('Este número se dio de BAJA: el sistema no le escribirá (salvo que él escriba primero).');
  return { tipo: 'listo', params: p, tarjeta: { que, aQuien: `${cont?.name ? `${cont.name} ` : ''}(${telefonoBonito(tel)})`, cuantos: 1, mensaje, avisos } };
}

const mensajeEnviar = def({
  nombre: 'mensaje.enviar',
  tipo: 'cambio',
  descripcion: 'Mandar UN mensaje de texto a UN número, como si lo escribiera una persona desde el chat (pasa por todas las guardas: modo prueba, anti-baneo, horario y tope).',
  parametros: 'telefono, texto (tal cual lo dijo la persona si lo dictó entre comillas o tras dos puntos)',
  ejemplo: { orden: 'mándale a 51912426667: ya salió tu pedido', accion: { accion: 'mensaje.enviar', telefono: '51912426667', texto: 'ya salió tu pedido' } },
  schema: z.object({ telefono, texto: texto(4000) }),
  preparar: (p, ctx) => prepararMensaje(ctx, p, `Mandar un WhatsApp a ${telefonoBonito(telefonoADigitos(p.telefono))}`, p.texto),
  async ejecutar(p, ctx) {
    const r = await ctx.llamar({ method: 'POST', url: '/admin/chat/send', body: { phone: telefonoADigitos(p.telefono), text: p.texto } });
    if (!ok(r)) return errorDe(r, 'No se pudo enviar.');
    const j = r.json as { ok?: boolean; blocked?: boolean; reason?: string; error?: string };
    if (j.ok) return { ok: true, resumen: `Mensaje enviado a ${telefonoADigitos(p.telefono)}: «${acortar(p.texto, 80)}».`, ir: '/chat' };
    return { ok: false, resumen: j.blocked ? `No salió: ${j.reason}` : `No salió: ${j.error ?? 'WhatsApp lo rechazó'}`, ir: '/panel#historial' };
  },
});

const mensajePedirUbicacion = def({
  nombre: 'mensaje.pedirUbicacion',
  tipo: 'cambio',
  descripcion: 'Pedirle ahora mismo la ubicación a un número (una sola vez; para insistir cada pocas horas usa lista.agregar).',
  parametros: 'telefono, texto (opcional)',
  ejemplo: { orden: 'pídele la ubicación al 987654321 ahora', accion: { accion: 'mensaje.pedirUbicacion', telefono: '987654321' } },
  schema: z.object({ telefono, texto: z.string().trim().max(1000).optional() }),
  preparar: (p, ctx) => prepararMensaje(ctx, p, `Pedirle la ubicación a ${telefonoBonito(telefonoADigitos(p.telefono))} (con el botón de WhatsApp)`, p.texto),
  async ejecutar(p, ctx) {
    const r = await ctx.llamar({ method: 'POST', url: '/admin/chat/send', body: { phone: telefonoADigitos(p.telefono), askLocation: true, text: p.texto } });
    if (!ok(r)) return errorDe(r, 'No se pudo enviar.');
    const j = r.json as { ok?: boolean; blocked?: boolean; reason?: string; error?: string };
    return j.ok ? { ok: true, resumen: `Se le pidió la ubicación a ${telefonoADigitos(p.telefono)}.`, ir: '/chat' } : { ok: false, resumen: `No salió: ${j.reason ?? j.error ?? 'WhatsApp lo rechazó'}`, ir: '/panel#historial' };
  },
});

/** "2026-09-29 10:00", "2026-09-29T10:00", ISO. Sin zona = hora de la tienda (la del servidor). */
function fechaDe(s: string): Date | null {
  const t = s.trim().replace(' ', 'T');
  const d = new Date(/T\d{2}:\d{2}$/.test(t) ? `${t}:00` : t);
  return Number.isNaN(d.getTime()) ? null : d;
}
const fechaBonita = (d: Date) => d.toLocaleString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

const mensajeProgramar = def({
  nombre: 'mensaje.programar',
  tipo: 'cambio',
  peligrosa: true,
  descripcion: 'Programar un WhatsApp para más tarde (una fecha y hora) a uno o varios números, o a un grupo de clientes (como una campaña programada). Cada mensaje sale a su hora por el sender, con todas las guardas.',
  parametros: 'texto, cuando ("AAAA-MM-DD HH:MM", hora de la tienda), y a quién: telefono, o telefonos (lista), o criterio (como en grupo.previsualizar); como mucho 500',
  ejemplo: { orden: 'programa para mañana a las 10 un mensaje a los que no dieron ubicación: "Hola {nombre}, hoy pasamos por tu pedido"', accion: { accion: 'mensaje.programar', criterio: { reparto: 'sin_ubicacion' }, cuando: '2026-09-29 10:00', texto: 'Hola, hoy pasamos por tu pedido.' } },
  schema: z
    .object({ texto: texto(1000), cuando: z.string().trim().min(8).max(40), telefono: z.string().trim().max(30).optional(), telefonos: z.array(z.string().trim().min(6).max(30)).max(500).optional(), criterio: z.record(z.string(), z.unknown()).optional() })
    .refine((v) => v.telefono || v.telefonos?.length || v.criterio, { message: 'Hace falta a quién: un teléfono, una lista o un grupo (criterio).' }),
  async preparar(p, ctx) {
    const d = fechaDe(p.cuando);
    if (!d) return { tipo: 'no', resumen: `"${p.cuando}" no se entiende como fecha y hora: dímela como 2026-09-29 10:00.` };
    if (d.getTime() < Date.now() + 60_000) return { tipo: 'no', resumen: `${fechaBonita(d)} ya pasó (o es ahora mismo): para mandar ya, usa «mándale…».` };
    let tels: string[] = [];
    if (p.criterio) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/grupos/previsualizar', body: p.criterio });
      if (!ok(r)) return { tipo: 'no', resumen: errorDe(r, 'No se pudo leer el grupo.').resumen };
      tels = ((r.json as { telefonos?: string[] }).telefonos ?? []).map(String);
    } else tels = [...(p.telefonos ?? []), ...(p.telefono ? [p.telefono] : [])].map((t) => telefonoADigitos(t));
    tels = [...new Set(tels)].filter((t) => /^\d{8,15}$/.test(t));
    if (!tels.length) return { tipo: 'no', resumen: 'No hay ningún número al que programárselo.' };
    if (tels.length > 500) return { tipo: 'no', resumen: `Son ${tels.length} números: como mucho 500 de golpe. Afina el grupo.` };
    const avisos = await avisosDeEnvio(ctx, tels);
    return { tipo: 'listo', params: { ...p, telefonos: tels, telefono: undefined, criterio: undefined, cuando: d.toISOString() }, tarjeta: { que: `Programar un WhatsApp para el ${fechaBonita(d)}`, cuantos: tels.length, aQuien: `${tels.slice(0, 8).map(telefonoBonito).join(', ')}${tels.length > 8 ? ` y ${tels.length - 8} más` : ''}`, mensaje: p.texto, despues: 'a esa hora sale por el sender (si el ritmo o el horario lo frenan, se reprograma solo)', avisos } };
  },
  async ejecutar(p, ctx) {
    const d = fechaDe(p.cuando);
    if (!d) return { ok: false, resumen: 'La fecha no se entiende.' };
    const tels = p.telefonos?.length ? p.telefonos : p.telefono ? [telefonoADigitos(p.telefono)] : [];
    if (!tels.length) return { ok: false, resumen: 'Sin números a los que programarlo (vuelve a pedírmelo).' };
    let hechos = 0;
    const fallos: string[] = [];
    for (const t of tels) {
      const r = await ctx.llamar({ method: 'POST', url: '/admin/automation/scheduled', body: { phone: t, dueAt: d.toISOString(), kind: 'freeform', category: 'UTILITY', text: p.texto } });
      if (ok(r)) hechos++;
      else fallos.push(`${t}: ${errorDe(r, 'no se pudo').resumen}`);
    }
    return { ok: hechos > 0, resumen: `${hechos} mensaje(s) programados para el ${fechaBonita(d)}${fallos.length ? `; ${fallos.length} no: ${fallos.slice(0, 3).join(' · ')}` : ''}.`, ir: '/panel#programados' };
  },
});

// ===================================================================== AJUSTES

async function leerAjustes(ctx: ContextoAccion): Promise<{ guardado: Record<string, unknown>; efectivo: Record<string, unknown>; fijado: boolean } | { error: string }> {
  const r = await ctx.llamar({ method: 'GET', url: '/admin/ajustes' });
  if (!ok(r)) return { error: errorDe(r, 'No se pudo leer la configuración.').resumen };
  const j = r.json as { guardado?: Record<string, unknown>; efectivo?: Record<string, unknown>; modoPruebaFijado?: boolean };
  return { guardado: j.guardado ?? {}, efectivo: j.efectivo ?? {}, fijado: Boolean(j.modoPruebaFijado) };
}

const ajustesModoPrueba = def({
  nombre: 'ajustes.modoPrueba',
  tipo: 'cambio',
  soloAdmin: true,
  descripcion: 'Activar el modo prueba (el sistema SOLO le escribe a esos números y a nadie más) o apagarlo (vuelve a escribir a todos). «Con mi número» = el número de avisos (supervisor).',
  parametros: 'activo (true/false), numeros (lista; si no se dicen al activarlo, se usa el número de avisos)',
  ejemplo: { orden: 'activa el modo prueba solo con mi número', accion: { accion: 'ajustes.modoPrueba', activo: true } },
  schema: z.object({ activo: z.boolean(), numeros: z.array(z.string().trim().min(6).max(30)).max(50).optional() }),
  async preparar(p, ctx) {
    const a = await leerAjustes(ctx);
    if ('error' in a) return { tipo: 'no', resumen: a.error };
    const mp = (a.guardado.modoPrueba ?? { activo: false, numeros: [] }) as { activo: boolean; numeros: string[] };
    let numeros = (p.numeros ?? []).map((n) => telefonoADigitos(n));
    if (p.activo && !numeros.length) {
      const sup = String(a.efectivo.supervisor ?? '').replace(/\D/g, '');
      if (!sup) return { tipo: 'no', resumen: '¿Con qué número? No tengo el tuyo (no hay número de avisos en Ajustes): dímelo y lo activo con ese.', ir: '/panel#configuracion' };
      numeros = [sup];
    }
    const antes = mp.activo && mp.numeros.length ? `activo: solo se escribe a ${mp.numeros.map(telefonoBonito).join(', ')}` : 'apagado: se escribe a todos';
    const despues = p.activo ? `activo: solo se escribe a ${numeros.map(telefonoBonito).join(', ')}` : 'apagado: se escribe a todos los clientes de verdad';
    if (antes === despues) return { tipo: 'no', resumen: `El modo prueba ya está así (${antes}).` };
    const avisos = p.activo ? ['Mientras esté activo, cualquier mensaje a otro número se frena (y se dice por qué).'] : ['Desde que pulses, los mensajes salen a clientes reales.'];
    if (a.fijado) avisos.push('El servidor tiene fijada una lista de números de prueba: la pantalla solo puede recortarla, no quitarla.');
    return { tipo: 'listo', params: { activo: p.activo, numeros: p.activo ? numeros : undefined }, tarjeta: { que: p.activo ? 'Activar el modo prueba' : 'Apagar el modo prueba', antes, despues, avisos } };
  },
  async ejecutar(p, ctx) {
    let numeros = (p.numeros ?? []).map((n) => telefonoADigitos(n));
    if (p.activo && !numeros.length) {
      const a = await leerAjustes(ctx);
      const sup = 'error' in a ? '' : String(a.efectivo.supervisor ?? '').replace(/\D/g, '');
      if (!sup) return { ok: false, resumen: 'Falta el número para el modo prueba.', ir: '/panel#configuracion' };
      numeros = [sup];
    }
    const r = await ctx.llamar({ method: 'POST', url: '/admin/ajustes', body: { modoPrueba: p.activo ? { activo: true, numeros } : { activo: false } } });
    if (!ok(r)) return errorDe(r, 'No se pudo cambiar el modo prueba.');
    return { ok: true, resumen: p.activo ? `Modo prueba activo: solo se escribe a ${numeros.map(telefonoBonito).join(', ')}.` : 'Modo prueba apagado: se escribe a todos.', ir: '/hoy' };
  },
});

const configuracionCambiar = def({
  nombre: 'configuracion.cambiar',
  tipo: 'cambio',
  peligrosa: true,
  soloAdmin: true,
  descripcion: 'Cambiar la configuración general: nombre del negocio, horario de envío del número (inicio, fin), modo prueba (activo y números), número de avisos (supervisor).',
  parametros: 'nombreNegocio, horario: {inicio, fin} (horas 0-24), modoPrueba: {activo, numeros: []}, avisos: {supervisor}; solo lo que se cambia',
  ejemplo: { orden: 'que los mensajes salgan de 8 a 20', accion: { accion: 'configuracion.cambiar', horario: { inicio: 8, fin: 20 } } },
  schema: z.object({ nombreNegocio: z.string().trim().max(80).optional(), horario: z.object({ inicio: z.coerce.number().int().min(0).max(23).optional(), fin: z.coerce.number().int().min(1).max(24).optional() }).optional(), modoPrueba: z.object({ activo: z.boolean().optional(), numeros: z.array(z.string()).max(50).optional() }).optional(), avisos: z.object({ supervisor: z.string().nullable().optional() }).optional() }),
  async preparar(p, ctx) {
    const a = await leerAjustes(ctx);
    if ('error' in a) return { tipo: 'no', resumen: a.error };
    const antes: string[] = [];
    const despues: string[] = [];
    if (p.nombreNegocio) {
      antes.push(`nombre: ${a.efectivo.nombreNegocio ?? '—'}`);
      despues.push(`nombre: ${p.nombreNegocio}`);
    }
    if (p.horario) {
      const h = (a.efectivo.horario ?? {}) as { inicio?: number; fin?: number };
      antes.push(`horario de envío: de ${h.inicio ?? '?'}:00 a ${h.fin ?? '?'}:00`);
      despues.push(`horario de envío: de ${p.horario.inicio ?? h.inicio ?? '?'}:00 a ${p.horario.fin ?? h.fin ?? '?'}:00`);
    }
    if (p.modoPrueba) {
      const mp = (a.guardado.modoPrueba ?? { activo: false, numeros: [] }) as { activo: boolean; numeros: string[] };
      antes.push(`modo prueba: ${mp.activo ? `activo (${mp.numeros.join(', ')})` : 'apagado'}`);
      despues.push(`modo prueba: ${p.modoPrueba.activo ?? mp.activo ? `activo (${(p.modoPrueba.numeros ?? mp.numeros).map((n) => telefonoADigitos(n)).join(', ')})` : 'apagado'}`);
    }
    if (p.avisos) {
      antes.push(`avisos a: ${a.efectivo.supervisor || 'nadie'}`);
      despues.push(`avisos a: ${p.avisos.supervisor ? telefonoADigitos(p.avisos.supervisor) : 'nadie'}`);
    }
    if (!despues.length) return { tipo: 'no', resumen: 'Dime qué cambio de la configuración.' };
    return { tipo: 'listo', params: p, tarjeta: { que: 'Cambiar la configuración general', antes: antes.join(' · '), despues: despues.join(' · ') } };
  },
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
});

// ------------------------------------------------------ respuestas rápidas

interface Atajo {
  atajo: string;
  texto: string;
  sticker?: string | null;
}
async function leerAtajos(ctx: ContextoAccion): Promise<{ atajos: Atajo[]; deFabrica: boolean } | { error: ResultadoAccion }> {
  const r = await ctx.llamar({ method: 'GET', url: '/admin/chat/atajos' });
  if (!ok(r)) return { error: errorDe(r, 'No se pudieron leer las respuestas rápidas.') };
  const j = r.json as { atajos?: Atajo[]; deFabrica?: boolean };
  return { atajos: j.atajos ?? [], deFabrica: Boolean(j.deFabrica) };
}
const limpiarAtajo = (a: string) => a.trim().replace(/^\//, '').toLowerCase().replace(/\s+/g, '-');

const respuestasVer = def({
  nombre: 'respuestas.ver',
  tipo: 'consulta',
  descripcion: 'Las respuestas rápidas del chat ("/atajo" → texto).',
  parametros: '(ninguno)',
  ejemplo: { orden: '¿qué respuestas rápidas tenemos?', accion: { accion: 'respuestas.ver' } },
  schema: z.object({}),
  async ejecutar(_p, ctx) {
    const l = await leerAtajos(ctx);
    if ('error' in l) return l.error;
    return { ok: true, resumen: `${l.atajos.length} respuesta(s) rápida(s)${l.deFabrica ? ' (las de fábrica)' : ''}: ${l.atajos.map((a) => `/${a.atajo}`).join(', ')}.`, datos: l.atajos.map((a) => ({ atajo: `/${a.atajo}`, texto: acortar(a.texto, 160) })), ir: '/chat' };
  },
});

const respuestasGuardar = def({
  nombre: 'respuestas.guardar',
  tipo: 'cambio',
  soloAdmin: true,
  descripcion: 'Crear o cambiar una respuesta rápida del chat: al escribir "/atajo" en el chat sale ese texto.',
  parametros: 'atajo (sin espacios, con o sin /), texto',
  ejemplo: { orden: 'crea una respuesta rápida /envio con "El envío a Lima cuesta S/ 10 y llega en el día"', accion: { accion: 'respuestas.guardar', atajo: 'envio', texto: 'El envío a Lima cuesta S/ 10 y llega en el día.' } },
  schema: z.object({ atajo: z.string().trim().min(1).max(30), texto: texto(1000) }),
  async preparar(p, ctx) {
    const l = await leerAtajos(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const a = limpiarAtajo(p.atajo);
    const actual = l.atajos.find((x) => x.atajo === a);
    if (actual && actual.texto.trim() === p.texto.trim()) return { tipo: 'no', resumen: `/${a} ya dice exactamente eso.` };
    if (!actual && l.atajos.length >= 50) return { tipo: 'no', resumen: 'Ya hay 50 respuestas rápidas (el máximo): quita alguna primero.' };
    return { tipo: 'listo', params: { ...p, atajo: a }, tarjeta: { que: `${actual ? 'Cambiar' : 'Crear'} la respuesta rápida /${a}`, antes: actual ? acortar(actual.texto, 300) : 'no existe', despues: p.texto, avisos: l.deFabrica ? ['Hasta ahora estaban las de fábrica: se guardan junto con esta.'] : undefined } };
  },
  async ejecutar(p, ctx) {
    const l = await leerAtajos(ctx);
    if ('error' in l) return l.error;
    const a = limpiarAtajo(p.atajo);
    const lista = l.atajos.filter((x) => x.atajo !== a).concat([{ atajo: a, texto: p.texto }]);
    const r = await ctx.llamar({ method: 'POST', url: '/admin/chat/atajos', body: { atajos: lista.map((x) => ({ atajo: x.atajo, texto: x.texto, sticker: x.sticker ?? null })) } });
    if (!ok(r)) return errorDe(r, 'No se pudo guardar la respuesta rápida.');
    return { ok: true, resumen: `Respuesta rápida /${a} guardada: en el chat, escribe /${a}.`, ir: '/chat' };
  },
});

const respuestasQuitar = def({
  nombre: 'respuestas.quitar',
  tipo: 'cambio',
  soloAdmin: true,
  descripcion: 'Quitar una respuesta rápida del chat.',
  parametros: 'atajo',
  ejemplo: { orden: 'quita la respuesta rápida /horario', accion: { accion: 'respuestas.quitar', atajo: 'horario' } },
  schema: z.object({ atajo: z.string().trim().min(1).max(30) }),
  async preparar(p, ctx) {
    const l = await leerAtajos(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const a = limpiarAtajo(p.atajo);
    const actual = l.atajos.find((x) => x.atajo === a);
    if (!actual) return { tipo: 'no', resumen: `No hay ninguna respuesta rápida /${a}. Las que hay: ${l.atajos.map((x) => `/${x.atajo}`).join(', ')}.` };
    return { tipo: 'listo', params: { atajo: a }, tarjeta: { que: `Quitar la respuesta rápida /${a}`, antes: acortar(actual.texto, 300), despues: 'ya no existe' } };
  },
  async ejecutar(p, ctx) {
    const l = await leerAtajos(ctx);
    if ('error' in l) return l.error;
    const a = limpiarAtajo(p.atajo);
    const r = await ctx.llamar({ method: 'POST', url: '/admin/chat/atajos', body: { atajos: l.atajos.filter((x) => x.atajo !== a).map((x) => ({ atajo: x.atajo, texto: x.texto, sticker: x.sticker ?? null })) } });
    if (!ok(r)) return errorDe(r, 'No se pudo quitar.');
    return { ok: true, resumen: `Respuesta rápida /${a} quitada.`, ir: '/chat' };
  },
});

// ==================================================================== CAMPAÑAS

interface CampanaVista {
  id: string;
  name: string;
  status?: string;
}
async function leerCampanas(ctx: ContextoAccion): Promise<CampanaVista[] | { error: ResultadoAccion }> {
  const r = await ctx.llamar({ method: 'GET', url: '/admin/campaigns' });
  if (!ok(r)) return { error: errorDe(r, 'No se pudieron leer las campañas.') };
  return (Array.isArray(r.json) ? r.json : ((r.json as { items?: unknown[] }).items ?? [])) as CampanaVista[];
}
const ESTADO_CAMPANA: Record<string, string> = { running: 'en marcha', canary: 'en prueba (canario)', paused: 'pausada', stopped: 'parada', completed: 'terminada', draft: 'borrador' };
const puedeCampana = (accion: string, status?: string) => (accion === 'pausar' ? ['running', 'canary'].includes(status ?? '') : accion === 'reanudar' ? status === 'paused' : ['running', 'canary', 'paused'].includes(status ?? ''));

const campanaEstado = def({
  nombre: 'campana.estado',
  tipo: 'cambio',
  ventas: true,
  descripcion: 'Pausar, reanudar o parar UNA campaña.',
  parametros: 'campana (id o nombre), accionCampana: "pausar" | "reanudar" | "parar"',
  ejemplo: { orden: 'pausa la campaña de septiembre', accion: { accion: 'campana.estado', campana: 'septiembre', accionCampana: 'pausar' } },
  schema: z.object({ campana: texto(120), campanaId: z.string().max(80).optional(), accionCampana: z.enum(['pausar', 'reanudar', 'parar']) }),
  async preparar(p, ctx) {
    const l = await leerCampanas(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const n = normal(p.campana);
    const c = p.campanaId ? l.filter((x) => x.id === p.campanaId) : l.filter((x) => x.id === p.campana || normal(x.name).includes(n));
    if (!c.length) return { tipo: 'no', resumen: `No encuentro la campaña "${p.campana}".`, ir: '/panel#campanas' };
    if (c.length > 1) return { tipo: 'elegir', pregunta: `Hay ${c.length} campañas que coinciden con "${p.campana}":`, opciones: c.slice(0, 8).map((x) => ({ etiqueta: `${x.name} (${ESTADO_CAMPANA[x.status ?? ''] ?? x.status ?? '?'})`, params: { ...p, campanaId: x.id } })) };
    const x = c[0]!;
    if (!puedeCampana(p.accionCampana, x.status)) return { tipo: 'no', resumen: `La campaña «${x.name}» está ${ESTADO_CAMPANA[x.status ?? ''] ?? x.status}: no se puede ${p.accionCampana}.`, ir: '/panel#campanas' };
    return { tipo: 'listo', params: { ...p, campanaId: x.id }, tarjeta: { que: `${p.accionCampana === 'pausar' ? 'Pausar' : p.accionCampana === 'reanudar' ? 'Reanudar' : 'Parar del todo'} la campaña «${x.name}»`, antes: ESTADO_CAMPANA[x.status ?? ''] ?? x.status, despues: p.accionCampana === 'pausar' ? 'pausada' : p.accionCampana === 'reanudar' ? 'en marcha' : 'parada (lo que faltaba no sale)' } };
  },
  async ejecutar(p, ctx) {
    const l = await leerCampanas(ctx);
    if ('error' in l) return l.error;
    const n = normal(p.campana);
    const c = (p.campanaId ? l.filter((x) => x.id === p.campanaId) : l.filter((x) => x.id === p.campana || normal(x.name).includes(n)))[0];
    if (!c) return { ok: false, resumen: `No encuentro la campaña "${p.campana}".`, ir: '/panel#campanas' };
    const e = await ctx.llamar({ method: 'POST', url: `/admin/campaigns/${encodeURIComponent(c.id)}/estado`, body: { accion: p.accionCampana, motivo: `por la IA a petición de ${ctx.quien}` } });
    if (!ok(e)) return errorDe(e, 'No se pudo cambiar la campaña.');
    return { ok: true, resumen: `Campaña "${c.name}": ${p.accionCampana === 'pausar' ? 'pausada' : p.accionCampana === 'reanudar' ? 'reanudada' : 'parada'}.`, ir: '/panel#campanas' };
  },
});

const campanasTodas = def({
  nombre: 'campanas.todas',
  tipo: 'cambio',
  ventas: true,
  descripcion: 'Pausar (o reanudar) TODAS las campañas de golpe.',
  parametros: 'accionCampana: "pausar" | "reanudar"',
  ejemplo: { orden: 'pausa las campañas', accion: { accion: 'campanas.todas', accionCampana: 'pausar' } },
  schema: z.object({ accionCampana: z.enum(['pausar', 'reanudar']), ids: z.array(z.string().max(80)).max(200).optional() }),
  async preparar(p, ctx) {
    const l = await leerCampanas(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    const c = l.filter((x) => puedeCampana(p.accionCampana, x.status));
    if (!c.length) return { tipo: 'no', resumen: p.accionCampana === 'pausar' ? 'No hay ninguna campaña en marcha que pausar.' : 'No hay ninguna campaña pausada que reanudar.', ir: '/panel#campanas' };
    return { tipo: 'listo', params: { accionCampana: p.accionCampana, ids: c.map((x) => x.id) }, tarjeta: { que: `${p.accionCampana === 'pausar' ? 'Pausar' : 'Reanudar'} ${c.length} campaña(s)`, cuantos: c.length, aQuien: c.slice(0, 10).map((x) => x.name).join(', '), antes: p.accionCampana === 'pausar' ? 'en marcha' : 'pausadas', despues: p.accionCampana === 'pausar' ? 'pausadas (nada más sale hasta reanudarlas)' : 'en marcha otra vez, con el ritmo del número' } };
  },
  async ejecutar(p, ctx) {
    const l = await leerCampanas(ctx);
    if ('error' in l) return l.error;
    const c = l.filter((x) => (p.ids?.length ? p.ids.includes(x.id) : true) && puedeCampana(p.accionCampana, x.status));
    if (!c.length) return { ok: false, resumen: 'Ninguna campaña estaba en ese estado.', ir: '/panel#campanas' };
    const bien: string[] = [];
    const mal: string[] = [];
    for (const x of c) {
      const r = await ctx.llamar({ method: 'POST', url: `/admin/campaigns/${encodeURIComponent(x.id)}/estado`, body: { accion: p.accionCampana, motivo: `por la IA a petición de ${ctx.quien}` } });
      if (ok(r)) bien.push(x.name);
      else mal.push(`${x.name}: ${errorDe(r, 'no se pudo').resumen}`);
    }
    return { ok: bien.length > 0, resumen: `${bien.length} campaña(s) ${p.accionCampana === 'pausar' ? 'pausadas' : 'reanudadas'}${mal.length ? `; ${mal.length} no: ${mal.join(' · ')}` : ''}.`, ir: '/panel#campanas' };
  },
});

// ==================================================================== PROCESOS

const procesosCambiarEstado = def({
  nombre: 'procesos.cambiarEstado',
  tipo: 'cambio',
  soloAdmin: true,
  descripcion: 'Activar, pausar o archivar un proceso (pausado: deja de escribirle a su gente hasta reactivarlo).',
  parametros: 'proceso (nombre o número), estado: activo | pausado | archivado',
  ejemplo: { orden: 'pausa el proceso de cobranza', accion: { accion: 'procesos.cambiarEstado', proceso: 'cobranza', estado: 'pausado' } },
  schema: z.object({ proceso: z.union([z.string().trim().min(1).max(120), z.number().int().positive()]), procesoId: idOpcional, estado: z.enum(['activo', 'pausado', 'archivado']) }),
  async preparar(p, ctx) {
    const r = await ctx.llamar({ method: 'GET', url: '/admin/procesos' });
    if (!ok(r)) return { tipo: 'no', resumen: errorDe(r, 'No se pudieron leer los procesos.').resumen };
    const lista = (r.json as { procesos: Array<{ id: number; nombre: string; estado: string; vivas: number }> }).procesos;
    const q = normal(String(p.proceso));
    const c = p.procesoId ? lista.filter((x) => x.id === p.procesoId) : lista.filter((x) => String(x.id) === q || normal(x.nombre).includes(q));
    if (!c.length) return { tipo: 'no', resumen: `No encuentro ningún proceso «${p.proceso}». Los que hay: ${lista.map((x) => x.nombre).join(', ') || 'ninguno'}.`, ir: '/procesos' };
    if (c.length > 1) return { tipo: 'elegir', pregunta: `Hay ${c.length} procesos que coinciden:`, opciones: c.slice(0, 8).map((x) => ({ etiqueta: `${x.nombre} (${x.estado})`, params: { ...p, procesoId: x.id } })) };
    const x = c[0]!;
    if (x.estado === p.estado) return { tipo: 'no', resumen: `«${x.nombre}» ya está ${p.estado}.`, ir: '/procesos' };
    return { tipo: 'listo', params: { ...p, procesoId: x.id }, tarjeta: { que: `Poner el proceso «${x.nombre}» ${p.estado}`, antes: x.estado, despues: p.estado, avisos: x.vivas && p.estado !== 'activo' ? [`Tiene ${x.vivas} persona(s) en curso: no se les escribe mientras no esté activo.`] : undefined } };
  },
  async ejecutar(p, ctx) {
    let id = p.procesoId;
    if (!id) {
      const r = await ctx.llamar({ method: 'GET', url: '/admin/procesos' });
      if (!ok(r)) return errorDe(r, 'No se pudieron leer los procesos.');
      const q = normal(String(p.proceso));
      id = (r.json as { procesos: Array<{ id: number; nombre: string }> }).procesos.find((x) => String(x.id) === q || normal(x.nombre).includes(q))?.id;
      if (!id) return { ok: false, resumen: `No encuentro el proceso «${p.proceso}».`, ir: '/procesos' };
    }
    const r = await ctx.llamar({ method: 'POST', url: `/admin/procesos/${id}/estado`, body: { estado: p.estado } });
    if (!ok(r)) return errorDe(r, 'No se pudo cambiar el proceso.');
    return { ok: true, resumen: `Proceso ${p.estado === 'activo' ? 'activado' : p.estado === 'pausado' ? 'pausado' : 'archivado'}.`, ir: '/procesos' };
  },
});

/** Las acciones de este archivo. Las que tienen el mismo nombre que una de acciones.ts la sustituyen. */
export const ACCIONES_PANEL: Accion[] = [
  entregasConfirmar,
  entregasCancelar,
  entregasReasignar,
  entregasReintentar,
  entregasSegundaVisita,
  entregasUrgente,
  entregasUbicacion,
  entregasEntregada,
  entregasCrear,
  entregasCerrarDia,
  entregasAjustes,
  entregasTexto,
  entregasDetalle,
  entregasSinUbicacion,
  numerosConfirmarEnvio,
  numerosMasa,
  motorizadosEstado,
  motorizadosEditar,
  motorizadosQuitar,
  motorizadosEnlace,
  motorizadosMandarRuta,
  motorizadosTraspasar,
  motorizadosHoy,
  chatAtenderPersona,
  chatAsistente,
  chatCerrar,
  chatCerrarTerminados,
  mensajeEnviar,
  mensajePedirUbicacion,
  mensajeProgramar,
  ajustesModoPrueba,
  configuracionCambiar,
  respuestasVer,
  respuestasGuardar,
  respuestasQuitar,
  campanaEstado,
  campanasTodas,
  procesosCambiarEstado,
];

// ------------------------------------------- tarjetas para las acciones de siempre

/** Quitar, pausar o reanudar a alguien de la lista de envío automático: quién es exactamente. */
async function prepararEnLista(p: Record<string, unknown>, ctx: ContextoAccion, que: 'quitar' | 'pausar' | 'reanudar'): Promise<Preparado> {
  const quien = String(p.telefono ?? '');
  const r = await ctx.llamar({ method: 'GET', url: '/admin/envio-automatico' });
  if (!ok(r)) return { tipo: 'no', resumen: errorDe(r, 'No se pudo leer la lista.').resumen };
  const lista = ((r.json as { numeros?: Array<{ phone: string; nombre: string | null; origen: string; pausado?: boolean }> }).numeros ?? []);
  const dig = telefonoADigitos(quien);
  const n = normal(quien);
  const exacto = lista.filter((x) => x.phone === dig);
  const c = exacto.length ? exacto : lista.filter((x) => normal(x.nombre) === n || (n.length >= 3 && normal(x.nombre).includes(n)));
  if (!c.length) return { tipo: 'no', resumen: `${quien} no está en la lista.`, ir: '/envio-automatico' };
  if (c.length > 1) return { tipo: 'elegir', pregunta: `Hay ${c.length} en la lista que coinciden con "${quien}":`, opciones: c.slice(0, 8).map((x) => ({ etiqueta: `${x.nombre ?? 'sin nombre'} (${telefonoBonito(x.phone)})`, params: { ...p, telefono: x.phone } })) };
  const x = c[0]!;
  if (que === 'pausar' && x.pausado) return { tipo: 'no', resumen: `${x.nombre ?? x.phone} ya está en pausa.`, ir: '/envio-automatico' };
  if (que === 'reanudar' && x.pausado === false) return { tipo: 'no', resumen: `${x.nombre ?? x.phone} no está en pausa.`, ir: '/envio-automatico' };
  const aQuien = `${x.nombre ?? 'sin nombre'} (${telefonoBonito(x.phone)})`;
  const tarjeta =
    que === 'quitar'
      ? { que: `Quitar a ${aQuien} del envío automático`, aQuien, antes: 'en la lista: el sistema le escribe solo', despues: x.origen === 'reparto' ? 'fuera de la lista: era del reparto y pasa a una persona para que lo llame' : 'fuera de la lista: ya no se le escribe solo' }
      : que === 'pausar'
        ? { que: `Pausar a ${aQuien} en el envío automático`, aQuien, antes: 'se le escribe con el ritmo de la lista', despues: 'en pausa: no se le escribe hasta reanudarlo' }
        : { que: `Reanudar a ${aQuien} en el envío automático`, aQuien, antes: 'en pausa', despues: 'se le vuelve a escribir con el ritmo de la lista' };
  return { tipo: 'listo', params: { ...p, telefono: x.phone }, tarjeta };
}

/**
 * Las tarjetas de las acciones que viven en acciones.ts (lista, contactos,
 * reparto, grupos, numero...): solo leen y dicen en palabras que va a pasar.
 */
export const PREPARAR_DE_SIEMPRE: Record<string, (p: Record<string, unknown>, ctx: ContextoAccion) => Promise<Preparado>> = {
  async 'lista.agregar'(p, ctx) {
    const tel = telefonoADigitos(String(p.telefono));
    const avisos = await avisosDeEnvio(ctx, [tel]);
    return { tipo: 'listo', params: p, tarjeta: { que: `Poner a ${p.nombre ? `${p.nombre} ` : ''}(${telefonoBonito(tel)}) en el envío automático`, aQuien: `${p.nombre ?? 'sin nombre'} (${telefonoBonito(tel)})`, despues: p.que === 'mensaje' ? 'se le manda el mensaje con el ritmo de la lista' : 'se le pide su ubicación con el ritmo de la lista (cada pocas horas, solo en horario)', mensaje: typeof p.texto === 'string' ? p.texto : undefined, avisos } };
  },
  async 'grupo.enviar'(p, ctx) {
    const r = await ctx.llamar({ method: 'POST', url: '/admin/grupos/previsualizar', body: p.criterio ?? {} });
    if (!ok(r)) return { tipo: 'no', resumen: errorDe(r, 'No se pudo leer el grupo.').resumen };
    const j = r.json as { total: number; telefonos?: string[]; clientes?: Array<{ phone: string; nombre?: string | null }> };
    if (!j.total) return { tipo: 'no', resumen: 'Con esos filtros no hay ningún cliente: no hay a quién mandarle.', ir: '/panel#grupos' };
    const avisos = await avisosDeEnvio(ctx, (j.telefonos ?? []).slice(0, 2000));
    return { tipo: 'listo', params: p, tarjeta: { que: `Mandar un mensaje a ${j.total} cliente(s) del grupo`, cuantos: j.total, aQuien: (j.clientes ?? []).slice(0, 8).map((c) => c.nombre ?? telefonoBonito(c.phone)).join(', ') + (j.total > 8 ? ` y ${j.total - 8} más` : ''), mensaje: typeof p.texto === 'string' ? p.texto : p.plantilla ? `plantilla ${(p.plantilla as { name: string }).name}` : undefined, despues: 'sale por goteo, al ritmo del número (anti-baneo y horario incluidos)', avisos } };
  },
  async 'numero.pausarEnvios'(p) {
    return { tipo: 'listo', params: p, tarjeta: { que: p.pausar ? 'Pausar TODOS los envíos del número' : 'Reanudar los envíos del número', despues: p.pausar ? 'no sale nada (ni reparto, ni entregas, ni campañas) hasta reanudarlo' : 'vuelve a salir todo, con el ritmo de siempre', avisos: p.motivo ? [`Motivo: ${p.motivo}`] : undefined } };
  },
  async 'lista.ajustes'(p, ctx) {
    const r = await ctx.llamar({ method: 'GET', url: '/admin/envio-automatico' });
    const a = ok(r) ? ((r.json as { ajustes?: Record<string, number> }).ajustes ?? {}) : {};
    const campos: Array<[string, string, string]> = [['cadaHoras', 'cada', ' h'], ['maxEnvios', 'máximo por número', ''], ['horaInicio', 'desde las', ':00'], ['horaFin', 'hasta las', ':00']];
    const cambia = campos.filter(([k]) => p[k] !== undefined);
    if (!cambia.length) return { tipo: 'no', resumen: 'Dime qué cambio del ritmo: cada cuántas horas, máximo por número u horario.' };
    return { tipo: 'listo', params: p, tarjeta: { que: 'Cambiar el ritmo del envío automático y del reparto', antes: cambia.map(([k, e, s]) => `${e} ${a[k] ?? '?'}${s}`).join(' · '), despues: cambia.map(([k, e, s]) => `${e} ${p[k]}${s}`).join(' · ') } };
  },
  async 'reparto.cargar'(p, ctx) {
    const filas = (p.filas as unknown[]) ?? [];
    const avisos = p.arrancar ? await avisosDeEnvio(ctx, filas.map((f) => telefonoADigitos(String((f as { telefono: string }).telefono)))) : ['Queda cargado sin arrancar: no se le escribe a nadie hasta arrancarlo.'];
    return { tipo: 'listo', params: p, tarjeta: { que: `Cargar el lote «${p.nombre ?? 'sin nombre'}» del reparto`, cuantos: filas.length, aQuien: filas.slice(0, 8).map((f) => (f as { nombre?: string; telefono: string }).nombre ?? (f as { telefono: string }).telefono).join(', '), despues: p.arrancar ? 'se le pide la ubicación a cada uno, de uno en uno' : 'cargado, sin arrancar', avisos } };
  },
  'lista.quitar': (p, ctx) => prepararEnLista(p, ctx, 'quitar'),
  'lista.pausar': (p, ctx) => prepararEnLista(p, ctx, 'pausar'),
  'lista.reanudar': (p, ctx) => prepararEnLista(p, ctx, 'reanudar'),
  async 'contactos.baja'(p) {
    return { tipo: 'listo', params: p, tarjeta: { que: `Dar de baja a ${telefonoBonito(telefonoADigitos(String(p.telefono)))}`, despues: 'no recibe más mensajes iniciados por el negocio (salvo que escriba él)' } };
  },
};
