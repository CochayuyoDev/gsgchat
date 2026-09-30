/**
 * Grupos de clientes: elegir a quien se le escribe sin ir uno por uno.
 *
 * Un criterio dice como es el cliente (consentimiento, en que punto esta su
 * solicitud de ubicacion, cuanto le falta a su ficha, cuando escribio por
 * ultima vez) y de ahi sale la lista con la que se lanza una campaña por
 * goteo, se inscribe en una secuencia o se exporta. Cada cliente sale con
 * sus variables ya puestas (nombre, pedido, direccion, distrito, negocio),
 * que es lo que permite un mensaje "segun el cliente" a cientos a la vez.
 *
 * Se calcula cruzando lo que ya guardan los repos (contactos, solicitudes de
 * reparto, fichas de preventa): ninguna tabla nueva. Escala a algunos miles
 * de clientes, que es el tamaño de este negocio; no es un motor de consultas.
 */

import { z } from 'zod';
import type { Repos } from '../db/repos.js';
import type { Solicitud, EstadoSolicitud } from '../db/rutas.js';
import type { Lead } from '../db/leads.js';
import { siguienteCampo } from '../preventa/flow.js';

export const REPARTO = ['cualquiera', 'sin_ubicacion', 'contesto_sin_ubicacion', 'derivado', 'con_ubicacion', 'incidencia', 'sin_solicitud'] as const;
export const FICHA = ['cualquiera', 'sin_ficha', 'incompleta', 'completa', 'enviada'] as const;
export const ACTIVIDAD = ['cualquiera', 'escribio_dias', 'callado_dias', 'ventana_abierta', 'nunca_escribio'] as const;

export const criterioSchema = z.object({
  /** opt_in: solo con consentimiento. todos: tambien sin consentimiento (nunca las bajas). */
  consentimiento: z.enum(['opt_in', 'todos']).default('opt_in'),
  reparto: z.enum(REPARTO).default('cualquiera'),
  /** Solo las solicitudes de ese lote. Vacio = cualquier lote. */
  loteId: z.string().max(80).optional(),
  ficha: z.enum(FICHA).default('cualquiera'),
  actividad: z.enum(ACTIVIDAD).default('cualquiera'),
  /** Los dias de "escribio en los ultimos N" / "no escribe desde hace N". */
  dias: z.coerce.number().int().min(1).max(365).default(7),
  /** Busqueda por nombre o telefono. */
  q: z.string().trim().max(120).optional(),
  /** Una lista pegada: si viene, solo estos (y ademas lo que digan los filtros). */
  telefonos: z.array(z.string()).max(5000).optional(),
});

export type Criterio = z.infer<typeof criterioSchema>;

export const ETIQUETAS_REPARTO: Record<(typeof REPARTO)[number], string> = {
  cualquiera: 'Cualquiera',
  sin_ubicacion: 'Todavía sin ubicación (se le está pidiendo)',
  contesto_sin_ubicacion: 'Contestó, pero sin ubicación (supervisión)',
  derivado: 'Derivado al repartidor',
  con_ubicacion: 'Ya mandó su ubicación',
  incidencia: 'Con incidencia (número mal escrito, sin WhatsApp…)',
  sin_solicitud: 'Nunca se le pidió ubicación',
};

export const ETIQUETAS_FICHA: Record<(typeof FICHA)[number], string> = {
  cualquiera: 'Cualquiera',
  sin_ficha: 'Sin ficha de pedido',
  incompleta: 'Ficha incompleta (faltan datos)',
  completa: 'Ficha completa',
  enviada: 'Ficha ya enviada a ventas',
};

export const ETIQUETAS_ACTIVIDAD: Record<(typeof ACTIVIDAD)[number], string> = {
  cualquiera: 'Cualquiera',
  escribio_dias: 'Escribió en los últimos N días',
  callado_dias: 'No escribe desde hace más de N días',
  ventana_abierta: 'Escribió en las últimas 24 h (se le puede escribir libre)',
  nunca_escribio: 'Nunca escribió',
};

const NOMBRES_CAMPO: Record<string, string> = {
  recojo: 'distrito de recojo',
  entrega: 'distrito de entrega',
  contenido: 'qué se envía',
  servicio: 'servicio',
  cuando: 'cuándo',
  nombre: 'nombre',
  documento: 'documento',
};

/** Todo lo que le falta a una ficha, en el orden en que se pregunta. */
export function camposFaltantes(lead: Lead): string[] {
  const faltan: string[] = [];
  // siguienteCampo devuelve el primero que falta; se simula rellenando uno a uno.
  const copia: Lead = { ...lead };
  for (let i = 0; i < 10; i++) {
    const campo = siguienteCampo(copia);
    if (!campo) break;
    faltan.push(NOMBRES_CAMPO[campo] ?? campo);
    switch (campo) {
      case 'recojo':
        copia.recojoDistrito = 'x';
        break;
      case 'entrega':
        copia.entregaDistrito = 'x';
        break;
      case 'contenido':
        copia.contenido = 'x';
        break;
      case 'servicio':
        copia.servicio = 'x';
        break;
      case 'cuando':
        copia.cuando = 'x';
        break;
      case 'nombre':
        copia.nombre = 'x';
        break;
      case 'documento':
        copia.documentoNumero = 'x';
        break;
      default:
        return faltan;
    }
  }
  return faltan;
}

export interface ClienteDeGrupo {
  contactId: string;
  phone: string;
  nombre: string | null;
  optIn: boolean;
  ultimoMensajeAt: Date | null;
  ventanaAbierta: boolean;
  reparto: {
    estado: EstadoSolicitud;
    pedido: string | null;
    direccion: string | null;
    distrito: string | null;
    lote: string;
    intentos: number;
    incidencia: string | null;
  } | null;
  ficha: { estado: string; faltan: string[]; completa: boolean } | null;
  /** Lo que se puede poner en el mensaje: {nombre}, {pedido}, {direccion}, {distrito}. */
  variables: { nombre: string; pedido: string; direccion: string; distrito: string };
}

export interface ResultadoGrupo {
  total: number;
  clientes: ClienteDeGrupo[];
  cifras: { reparto: Record<string, number>; ficha: Record<string, number>; conOptIn: number; ventanaAbierta: number };
}

const VENTANA_MS = 24 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

const digitos = (v: string) => v.replace(/\D+/g, '');

/** El primer nombre, para saludar: "Ana Perez" -> "Ana". */
export function primerNombre(nombre: string | null | undefined): string {
  return (nombre ?? '').trim().split(/\s+/)[0] || '';
}

export async function evaluarGrupo(repos: Repos, criterio: Criterio, ahora = new Date()): Promise<ResultadoGrupo> {
  // 1. Contactos, sin bajas nunca.
  const contactos: Array<{ id: string; phone: string; name: string | null; optInAt: Date | null; lastInboundAt: Date | null }> = [];
  for (let offset = 0; ; offset += 500) {
    const page = await repos.contacts.list({
      q: criterio.q || undefined,
      state: criterio.consentimiento === 'opt_in' ? 'opted_in' : 'all',
      limit: 500,
      offset,
    });
    for (const c of page.items) if (!c.optOutAt) contactos.push(c);
    if (page.items.length < 500 || contactos.length >= 5000) break;
  }

  const pegados = criterio.telefonos?.length ? new Set(criterio.telefonos.map(digitos).filter((t) => t.length >= 8)) : null;

  // 2. La ultima solicitud de reparto por telefono.
  const porTelefono = new Map<string, Solicitud>();
  for (let offset = 0; ; offset += 500) {
    const page = await repos.rutas.listarSolicitudes({ loteId: criterio.loteId || undefined, limit: 500, offset });
    for (const s of page) {
      if (!s.phone) continue;
      const previa = porTelefono.get(s.phone);
      if (!previa || s.createdAt > previa.createdAt) porTelefono.set(s.phone, s);
    }
    if (page.length < 500 || offset > 20_000) break;
  }
  const lotes = new Map<string, string>();
  for (const l of await repos.rutas.listarLotes(200, 0)) lotes.set(l.id, l.nombre);

  // 3. Fichas de preventa por contacto.
  const fichas = new Map<string, Lead>();
  for (let offset = 0; ; offset += 500) {
    const page = await repos.leads.list({ limit: 500, offset });
    for (const l of page) fichas.set(l.contactId, l);
    if (page.length < 500 || offset > 20_000) break;
  }

  const clientes: ClienteDeGrupo[] = [];
  const cifras: ResultadoGrupo['cifras'] = { reparto: {}, ficha: {}, conOptIn: 0, ventanaAbierta: 0 };
  const cuenta = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };

  for (const c of contactos) {
    if (pegados && !pegados.has(c.phone)) continue;

    const s = porTelefono.get(c.phone) ?? null;
    if (criterio.loteId && !s) continue;
    const estado = s?.estado ?? null;
    switch (criterio.reparto) {
      case 'sin_ubicacion':
        if (!estado || !['pendiente', 'enviado', 'respondio'].includes(estado)) continue;
        break;
      case 'contesto_sin_ubicacion':
        if (estado !== 'supervision') continue;
        break;
      case 'derivado':
        if (estado !== 'derivado') continue;
        break;
      case 'con_ubicacion':
        if (estado !== 'resuelto') continue;
        break;
      case 'incidencia':
        if (estado !== 'incidencia') continue;
        break;
      case 'sin_solicitud':
        if (s) continue;
        break;
      default:
        break;
    }

    const lead = fichas.get(c.id) ?? null;
    const faltan = lead ? camposFaltantes(lead) : [];
    const completa = Boolean(lead) && faltan.length === 0;
    switch (criterio.ficha) {
      case 'sin_ficha':
        if (lead) continue;
        break;
      case 'incompleta':
        if (!lead || completa || lead.estado === 'enviado' || lead.estado === 'descartado') continue;
        break;
      case 'completa':
        if (!lead || !completa || lead.estado === 'enviado') continue;
        break;
      case 'enviada':
        if (!lead || lead.estado !== 'enviado') continue;
        break;
      default:
        break;
    }

    const ultimo = c.lastInboundAt ? c.lastInboundAt.getTime() : null;
    const ventanaAbierta = ultimo !== null && ahora.getTime() - ultimo < VENTANA_MS;
    const hace = ultimo !== null ? ahora.getTime() - ultimo : null;
    switch (criterio.actividad) {
      case 'escribio_dias':
        if (hace === null || hace > criterio.dias * DIA_MS) continue;
        break;
      case 'callado_dias':
        if (hace !== null && hace <= criterio.dias * DIA_MS) continue;
        break;
      case 'ventana_abierta':
        if (!ventanaAbierta) continue;
        break;
      case 'nunca_escribio':
        if (ultimo !== null) continue;
        break;
      default:
        break;
    }

    const nombre = s?.nombre || lead?.nombre || c.name || null;
    const cliente: ClienteDeGrupo = {
      contactId: c.id,
      phone: c.phone,
      nombre,
      optIn: Boolean(c.optInAt),
      ultimoMensajeAt: c.lastInboundAt,
      ventanaAbierta,
      reparto: s
        ? {
            estado: s.estado,
            pedido: s.referencia,
            direccion: s.direccion,
            distrito: s.distrito,
            lote: lotes.get(s.loteId) ?? s.loteId,
            intentos: s.intentos,
            incidencia: s.incidencia,
          }
        : null,
      ficha: lead ? { estado: lead.estado, faltan, completa } : null,
      variables: {
        nombre: primerNombre(nombre),
        pedido: (s?.referencia ?? '').trim(),
        direccion: (s?.direccion ?? lead?.entregaDireccion ?? '').trim(),
        distrito: (s?.distrito ?? lead?.entregaDistrito ?? '').trim(),
      },
    };
    clientes.push(cliente);
    cuenta(cifras.reparto, s ? s.estado : 'sin_solicitud');
    cuenta(cifras.ficha, lead ? (lead.estado === 'enviado' ? 'enviada' : completa ? 'completa' : 'incompleta') : 'sin_ficha');
    if (cliente.optIn) cifras.conOptIn++;
    if (ventanaAbierta) cifras.ventanaAbierta++;
  }

  return { total: clientes.length, clientes, cifras };
}

/** Los marcadores que admite un texto de grupo, en el orden en que se documentan. */
export const MARCADORES = ['nombre', 'pedido', 'negocio', 'direccion', 'distrito'] as const;
export type Marcador = (typeof MARCADORES)[number];

/**
 * De un texto con {nombre}, {pedido}... a una plantilla {{1}}, {{2}}... con
 * la lista de que significa cada una, en orden de aparicion.
 */
export function textoAPlantilla(texto: string): { body: string; variables: Marcador[] } {
  const variables: Marcador[] = [];
  const body = texto.replace(/\{(nombre|pedido|negocio|direccion|distrito)\}/g, (_m, clave: Marcador) => {
    let i = variables.indexOf(clave);
    if (i < 0) {
      variables.push(clave);
      i = variables.length - 1;
    }
    return `{{${i + 1}}}`;
  });
  return { body, variables };
}

/** Las variables de un cliente en el orden que pide una plantilla documentada. */
export function variablesDeCliente(cliente: ClienteDeGrupo, doc: string[], negocio: string, cuantas: number): string[] {
  const valor = (nombre: string): string => {
    const k = nombre.trim().toLowerCase();
    if (k.includes('nombre') || k.includes('cliente')) return cliente.variables.nombre || 'buenas';
    if (k.includes('pedido') || k.includes('referencia') || k.includes('orden')) return cliente.variables.pedido || 'su pedido';
    if (k.includes('negocio') || k.includes('tienda') || k.includes('empresa')) return negocio;
    if (k.includes('direccion') || k.includes('dirección')) return cliente.variables.direccion || 'su dirección';
    if (k.includes('distrito') || k.includes('zona')) return cliente.variables.distrito || 'su zona';
    if (k.includes('fecha') || k.includes('cuando') || k.includes('cuándo')) return 'hoy';
    return '';
  };
  // Sin documentacion, el orden de siempre: nombre, pedido, negocio.
  const orden = doc.length ? doc : ['nombre', 'pedido', 'negocio'];
  const out: string[] = [];
  for (let i = 0; i < cuantas; i++) out.push(valor(orden[i] ?? ''));
  return out;
}

/** Como le quedaria el mensaje a un cliente concreto, para la vista previa. */
export function renderParaCliente(body: string, doc: string[], cliente: ClienteDeGrupo, negocio: string): string {
  const vars = variablesDeCliente(cliente, doc, negocio, 10);
  return body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => vars[Number(n) - 1] ?? '');
}
