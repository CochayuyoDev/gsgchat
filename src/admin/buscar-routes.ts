/**
 * Dos cosas que el armazon usa en todas las pantallas:
 *
 *  GET /admin/buscar?q=…            el buscador global (Ctrl K): clientes,
 *                                   pedidos de hoy y conversaciones guardadas
 *                                   por nombre, numero o referencia.
 *  GET /admin/mensajes/:id/traza    "que paso con este mensaje": cuando se
 *                                   encolo, que guarda lo freno (en palabras),
 *                                   cuando WhatsApp lo dio por entregado o
 *                                   leido, si salio con plantilla y quien lo
 *                                   mando (persona, sistema o la IA).
 *
 * Todo sale de los repos que ya existen; aqui solo se junta y se traduce.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DeliveryListItem, Repos } from '../db/repos.js';
import type { Message } from '../db/messages.js';
import type { ServicioEntregas } from '../entregas/servicio.js';

export interface BuscarDeps {
  repos: Repos;
  entregas?: Pick<ServicioEntregas, 'resumen'>;
}

const soloDigitos = (v: string): string => v.replace(/\D+/g, '');
const sinAcentos = (v: string): string => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export interface ResultadoBusqueda {
  q: string;
  pedidos: Array<{ id: number; referencia: string; nombre: string | null; telefono: string; estado: string; situacion: string; href: string }>;
  clientes: Array<{ id: string; nombre: string | null; telefono: string; href: string; guardadosHref: string }>;
  guardados: Array<{ id: number; nombre: string | null; telefono: string; cerradoEn: Date; resumen: string | null; pedido: string | null; href: string }>;
}

/** Busca en lo de hoy, en los contactos y en lo guardado. Puro: se prueba sin servidor. */
export async function buscarEnTodo(deps: BuscarDeps, q: string, limite = 6): Promise<ResultadoBusqueda> {
  const texto = q.trim();
  const vacio: ResultadoBusqueda = { q: texto, pedidos: [], clientes: [], guardados: [] };
  if (texto.length < 2) return vacio;
  const t = sinAcentos(texto);
  const digitos = soloDigitos(texto);
  const casa = (...campos: Array<string | null | undefined>): boolean =>
    campos.some((c) => {
      if (!c) return false;
      if (sinAcentos(c).includes(t)) return true;
      // Un numero se busca por sus digitos: "987 000 001" casa con 51987000001.
      return digitos.length >= 3 && soloDigitos(c).includes(digitos);
    });

  // Un numero escrito con espacios o guiones ("987 000 001") se busca por sus digitos.
  const qRepos = digitos.length >= 3 && /^[\d\s()+.-]+$/.test(texto) ? digitos : texto;
  const [resumen, contactos, archivos] = await Promise.all([
    deps.entregas ? deps.entregas.resumen().catch(() => null) : Promise.resolve(null),
    deps.repos.contacts.list({ q: qRepos, limit: limite, offset: 0 }).catch(() => ({ items: [], total: 0 })),
    deps.repos.archives.list({ q: qRepos, limit: limite, offset: 0 }).catch(() => []),
  ]);

  const pedidos = (resumen?.entregas ?? [])
    .filter((e) => casa(e.referencia, e.nombre, e.phone))
    .slice(0, limite)
    .map((e) => ({ id: e.id, referencia: e.referencia, nombre: e.nombre, telefono: e.phone, estado: e.estado, situacion: e.situacion, href: `/hoy?buscar=${encodeURIComponent(e.referencia)}` }));

  const clientes = contactos.items
    .filter((c) => c.tipo !== 'grupo')
    .slice(0, limite)
    .map((c) => ({ id: c.id, nombre: c.name, telefono: c.phone, href: `/chat?phone=${encodeURIComponent(c.phone)}`, guardadosHref: `/guardados?tel=${encodeURIComponent(c.phone)}` }));

  const guardados = archivos.slice(0, limite).map((a) => ({ id: a.id, nombre: a.name, telefono: a.phone, cerradoEn: a.createdAt, resumen: a.resumen, pedido: a.pedido, href: `/guardados?abrir=${a.id}` }));

  return { q: texto, pedidos, clientes, guardados };
}

// --- la traza de un mensaje ------------------------------------------------

/** Lo que cada guarda del sender significa para quien no programa. */
export const MOTIVOS_EN_PALABRAS: Record<string, string> = {
  allowlist: 'El sistema está en modo prueba y este número no está en la lista de permitidos.',
  sin_conexion: 'WhatsApp no estaba conectado en ese momento.',
  opt_out: 'El equipo lo dio de baja: no recibe más mensajes.',
  no_opt_in: 'El cliente no dio su consentimiento para recibir mensajes iniciados por el negocio.',
  number_paused: 'Los envíos del número estaban pausados.',
  number_quality: 'La calidad del número estaba baja y Meta no deja mandar más.',
  window_closed: 'Habían pasado más de 24 h desde el último mensaje del cliente: con la API de Meta solo puede salir una plantilla aprobada.',
  template_missing: 'La plantilla que hacía falta no existe.',
  template_not_approved: 'La plantilla todavía no está aprobada por Meta.',
  template_quality: 'Meta marcó esa plantilla con calidad baja.',
  template_paused: 'Meta tiene esa plantilla en pausa.',
  frequency_cap: 'Ese cliente ya recibió el máximo de mensajes de marketing de la semana.',
  daily_cap: 'Se llegó al cupo de mensajes del día del número.',
  contact_suppressed: 'El monitor apartó a ese contacto (rebotes, quejas o silencio).',
  risk_marketing_paused: 'El número estaba en riesgo y el marketing estaba frenado.',
  fatigue: 'Ese cliente ya había recibido demasiados mensajes seguidos.',
  contact_daily_cap: 'Ese cliente ya recibió el máximo de mensajes del día.',
  contact_spacing: 'Hacía muy poco que se le había escrito a ese cliente.',
  rhythm: 'El marcapasos del número lo dejó para más tarde (ritmo, horario o pausa).',
};

const QUE_ES: Record<string, string> = {
  text: 'un texto',
  freeform: 'un texto',
  template: 'una plantilla aprobada',
  interactive: 'un mensaje con botón',
  location: 'un pin de ubicación',
  image: 'una foto',
  video: 'un video',
  audio: 'un audio',
  document: 'un documento',
  sticker: 'un sticker',
  media: 'un archivo',
};

export interface PasoTraza {
  cuando: Date | null;
  que: string;
  /** 'ok' | 'warn' | 'bad' | 'muted' */
  tono: 'ok' | 'warn' | 'bad' | 'muted';
}

export interface TrazaMensaje {
  id: number;
  direccion: 'in' | 'out';
  quien: string;
  como: string;
  estado: string;
  pasos: PasoTraza[];
  /** Otros intentos hacia ese cliente que no salieron cerca de esa hora. */
  otrosIntentos: Array<{ cuando: Date; que: string; motivo: string }>;
}

function motivoEnPalabras(errorTitle: string | null): string {
  if (!errorTitle) return 'No salió (sin motivo apuntado).';
  const [codigo] = errorTitle.split(':');
  const conocido = codigo ? MOTIVOS_EN_PALABRAS[codigo.trim()] : undefined;
  return conocido ?? errorTitle;
}

function quienLoMando(m: Message): string {
  const origen = String(m.payload?.origen ?? '');
  const autor = m.payload?.autorNombre ? String(m.payload.autorNombre) : '';
  if (origen === 'ia') return 'Lo escribió el asistente IA.';
  if (origen === 'persona') return autor ? `Lo mandó ${autor} desde el chat.` : 'Lo mandó una persona desde el chat.';
  if (origen === 'sistema') return 'Lo mandó el sistema solo (reparto, entregas, un aviso o una regla).';
  return 'No quedó apuntado quién lo mandó.';
}

export function armarTraza(m: Message, d: DeliveryListItem | null, otros: DeliveryListItem[]): TrazaMensaje {
  const pasos: PasoTraza[] = [];
  if (m.direction === 'in') {
    pasos.push({ cuando: m.createdAt, que: 'El cliente lo mandó y llegó al sistema.', tono: 'ok' });
    return { id: m.id, direccion: 'in', quien: 'Lo escribió el cliente.', como: `Llegó como ${QUE_ES[m.kind] ?? m.kind}.`, estado: m.status ?? 'recibido', pasos, otrosIntentos: [] };
  }
  const tipo = d?.kind ?? m.kind;
  let como = `Salió como ${QUE_ES[tipo] ?? tipo}`;
  if (d?.templateName) como += ` («${d.templateName}»)`;
  como += '.';
  pasos.push({ cuando: d?.queuedAt ?? m.createdAt, que: 'Se puso en la cola de salida.', tono: 'muted' });
  if (d) {
    if (d.status === 'blocked_by_gate') pasos.push({ cuando: d.failedAt ?? d.queuedAt, que: `No salió: ${motivoEnPalabras(d.errorTitle)}`, tono: 'bad' });
    if (d.sentAt || d.status === 'sent' || d.status === 'delivered' || d.status === 'read') pasos.push({ cuando: d.sentAt, que: 'Salió hacia WhatsApp.', tono: 'ok' });
    if (d.deliveredAt || d.status === 'delivered' || d.status === 'read') pasos.push({ cuando: d.deliveredAt, que: 'WhatsApp lo entregó al teléfono del cliente.', tono: 'ok' });
    if (d.readAt || d.status === 'read') pasos.push({ cuando: d.readAt, que: 'El cliente lo leyó.', tono: 'ok' });
    if (d.status === 'failed') pasos.push({ cuando: d.failedAt, que: `WhatsApp lo rechazó${d.errorTitle ? `: ${d.errorTitle}` : ''}${d.errorCode ? ` (código ${d.errorCode})` : ''}.`, tono: 'bad' });
    if (d.status === 'sent') pasos.push({ cuando: null, que: 'WhatsApp todavía no confirmó que llegara al teléfono (un solo check).', tono: 'warn' });
  } else {
    pasos.push({ cuando: m.createdAt, que: `Salió hacia WhatsApp${m.status ? ` (estado: ${m.status})` : ''}.`, tono: 'ok' });
  }
  const estado = d?.status === 'read' ? 'leído' : d?.status === 'delivered' ? 'entregado' : d?.status === 'sent' ? 'enviado' : d?.status === 'failed' ? 'rechazado' : d?.status === 'blocked_by_gate' ? 'no salió' : (m.status ?? 'enviado');
  return {
    id: m.id,
    direccion: 'out',
    quien: quienLoMando(m),
    como,
    estado,
    pasos,
    otrosIntentos: otros.map((o) => ({ cuando: o.failedAt ?? o.queuedAt, que: `${QUE_ES[o.kind] ?? o.kind}${o.templateName ? ` «${o.templateName}»` : ''}`, motivo: o.status === 'failed' ? `WhatsApp lo rechazó${o.errorTitle ? `: ${o.errorTitle}` : ''}` : motivoEnPalabras(o.errorTitle) })),
  };
}

export async function registerBuscarRoutes(app: FastifyInstance, deps: BuscarDeps): Promise<void> {
  app.get('/admin/buscar', async (request) => {
    const query = z.object({ q: z.string().max(120).default(''), limite: z.coerce.number().int().min(1).max(20).default(6) }).parse(request.query ?? {});
    return buscarEnTodo(deps, query.q, query.limite);
  });

  app.get('/admin/mensajes/:id/traza', async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const { contacto } = z.object({ contacto: z.string().min(1).max(80) }).parse(request.query ?? {});
    const contact = await deps.repos.contacts.getById(contacto);
    if (!contact) return reply.code(404).send({ error: 'Ese contacto ya no existe.' });
    // El hilo se lee hacia atras desde ese id: el primero es el mensaje si sigue ahi.
    const [m] = await deps.repos.messages.listMessages(contact.id, 1, id + 1);
    if (!m || m.id !== id) return reply.code(404).send({ error: 'Ese mensaje ya no está en el hilo (se guardó la conversación o se borró).' });
    const entregas = await deps.repos.deliveries.listRecent({ phone: contact.phone, limit: 300, offset: 0 }).catch(() => [] as DeliveryListItem[]);
    const d = m.deliveryId != null ? (entregas.find((x) => x.id === m.deliveryId) ?? null) : null;
    const eje = (d?.queuedAt ?? m.createdAt).getTime();
    const otros = entregas.filter((x) => x.id !== d?.id && (x.status === 'blocked_by_gate' || x.status === 'failed') && Math.abs(x.queuedAt.getTime() - eje) <= 15 * 60_000).slice(0, 5);
    return armarTraza(m, d, otros);
  });
}
