/**
 * La bandeja de preventa: fichas, edicion a mano y exportacion.
 *
 * Sin esto el asistente llena fichas que nadie ve. La tienda necesita mirar
 * las calificadas, corregir lo que el cliente dijo a medias y bajarselas para
 * meterlas donde cierre la venta.
 *
 * La exportacion existe porque la integracion con el sistema de ventas todavia
 * no esta: un CSV se sube a cualquier sitio y no depende de que nadie publique
 * una API.
 */

import { aCsvCon } from './csv.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Repos } from '../db/repos.js';
import { ESTADOS, type LeadConContacto, type LeadEstado } from '../db/leads.js';

export interface LeadsRoutesDeps {
  repos: Repos;
  /** Panel de Stoky, para derivar la venta. Vacio = no se ofrece. */
  /** El panel de Stoky; una funcion porque se puede cambiar desde la pantalla sin reiniciar. */
  panelStoky?: string | (() => string);
  /**
   * Se llama cuando la ficha llega a su estado final (enviada o descartada).
   *
   * Lo usa el respaldo de conversaciones: ahi es donde el chat deja de estar
   * en curso y puede guardarse y limpiarse. Entra por parametro para que esta
   * pantalla no sepa nada de ficheros ni de archivado.
   */
  alCerrarFicha?: (contactId: string) => Promise<void>;
}

/** Estados en los que la conversacion se da por terminada. */
const ESTADOS_FINALES: LeadEstado[] = ['enviado', 'descartado'];

const listQuery = z.object({
  estado: z.enum(ESTADOS as [LeadEstado, ...LeadEstado[]]).optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const patchSchema = z.object({
  nombre: z.string().max(200).nullish(),
  origen: z.string().max(120).nullish(),
  recojoDireccion: z.string().max(300).nullish(),
  recojoDistrito: z.string().max(120).nullish(),
  recojoReferencia: z.string().max(300).nullish(),
  entregaDireccion: z.string().max(300).nullish(),
  entregaDistrito: z.string().max(120).nullish(),
  entregaReferencia: z.string().max(300).nullish(),
  contenido: z.string().max(500).nullish(),
  pesoKg: z.number().nonnegative().max(10_000).nullish(),
  fragil: z.boolean().optional(),
  cuando: z.string().max(200).nullish(),
  documentoTipo: z.enum(['DNI', 'RUC', 'CE', 'PAS']).nullish(),
  documentoNumero: z.string().max(40).nullish(),
  razonSocial: z.string().max(300).nullish(),
  estado: z.enum(ESTADOS as [LeadEstado, ...LeadEstado[]]).optional(),
  notas: z.string().max(2000).nullish(),
});

/** Las columnas del CSV, en el orden en que se leen. */
const COLUMNAS: Array<[string, (l: LeadConContacto) => unknown]> = [
  ['telefono', (l) => l.phone],
  ['nombre', (l) => l.nombre ?? l.contactName],
  ['estado', (l) => l.estado],
  ['recojo_distrito', (l) => l.recojoDistrito],
  ['recojo_direccion', (l) => l.recojoDireccion],
  ['recojo_referencia', (l) => l.recojoReferencia],
  ['recojo_lat', (l) => l.recojoLat],
  ['recojo_lng', (l) => l.recojoLng],
  ['entrega_distrito', (l) => l.entregaDistrito],
  ['entrega_direccion', (l) => l.entregaDireccion],
  ['entrega_referencia', (l) => l.entregaReferencia],
  ['entrega_lat', (l) => l.entregaLat],
  ['entrega_lng', (l) => l.entregaLng],
  ['contenido', (l) => l.contenido],
  ['peso_kg', (l) => l.pesoKg],
  ['fragil', (l) => (l.fragil ? 'si' : 'no')],
  ['cuando', (l) => l.cuando],
  ['documento_tipo', (l) => l.documentoTipo],
  ['documento_numero', (l) => l.documentoNumero],
  ['razon_social', (l) => l.razonSocial],
  ['notas', (l) => l.notas],
  ['creada', (l) => l.createdAt.toISOString()],
  ['actualizada', (l) => l.updatedAt.toISOString()],
];

/**
 * Una celda de CSV.
 *
 * El punto y coma como separador y el BOM de abajo son por Excel en español,
 * que con coma mete todo en una columna y sin BOM se come los acentos.
 */
function celda(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function aCsv(leads: LeadConContacto[]): string {
  const cabecera = COLUMNAS.map(([nombre]) => nombre).join(';');
  const filas = leads.map((l) => COLUMNAS.map(([, leer]) => celda(leer(l))).join(';'));
  return `﻿${[cabecera, ...filas].join('\r\n')}\r\n`;
}

export async function registerLeadsRoutes(
  app: FastifyInstance,
  deps: LeadsRoutesDeps,
): Promise<void> {
  const { repos, alCerrarFicha } = deps;
  const panelDeStoky = () => (typeof deps.panelStoky === 'function' ? deps.panelStoky() : deps.panelStoky) ?? '';

  app.get('/admin/leads', async (request) => {
    const query = listQuery.parse(request.query ?? {});
    return {
      items: await repos.leads.list(query),
      counts: await repos.leads.contarPorEstado(),
    };
  });

  /** Las fichas en CSV, listas para importar donde haga falta. */
  app.get('/admin/leads.csv', async (request, reply) => {
    const query = listQuery.parse(request.query ?? {});
    const items = await repos.leads.list({ ...query, limit: 5000, offset: 0 });
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="preventa.csv"')
      .send(aCsv(items));
  });

  /**
   * Todos los numeros que han pasado por el sistema, en CSV.
   *
   * La agenda no vive en WhatsApp: vive aqui. Desvincular el telefono, cambiar
   * de numero o reinstalar no se lleva por delante a quien ya escribio, y esto
   * es lo que permite ademas sacarlos del sistema y llevarselos a otro sitio.
   */
  app.get('/admin/contacts.csv', async (request, reply) => {
    const query = z
      .object({ q: z.string().max(120).optional(), state: z.enum(['all', 'opted_in', 'opted_out', 'pending']).default('all') })
      .parse(request.query ?? {});

    const { items } = await repos.contacts.list({ q: query.q, state: query.state, limit: 20_000, offset: 0 });
    const csv = aCsvCon(
      [
        ['telefono', (c) => c.phone],
        ['nombre', (c) => c.name],
        ['estado', (c) => (c.optOutAt ? 'baja' : c.optInAt ? 'opt-in' : 'sin consentimiento')],
        ['opt_in', (c) => c.optInAt],
        ['origen_opt_in', (c) => c.optInSource],
        ['baja', (c) => c.optOutAt],
        ['ultimo_mensaje', (c) => c.lastInboundAt],
        ['ultima_ubicacion', (c) => (c.lastLocation ? `${c.lastLocation.lat},${c.lastLocation.lng}` : '')],
        ['alta', (c) => c.createdAt],
      ],
      items,
    );
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="contactos.csv"')
      .send(csv);
  });

  /**
   * El enlace que abre la venta en Stoky con la ficha ya puesta.
   *
   * Se arma aqui y no en la pantalla para que el formato de la URL viva en un
   * solo sitio: si Stoky cambia el nombre de un parametro, se cambia aqui.
   *
   * Lo que no viaja es el producto ni el precio. Ninguna conversacion decide
   * eso: "una caja de arroz" no es un SKU. Lo pone una persona mirando el
   * catalogo, y por eso el enlace RELLENA la venta pero no la registra.
   */
  app.get('/admin/leads/:contactId/derivar', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };

    const panelStoky = panelDeStoky();
    if (!panelStoky) {
      return reply.code(409).send({
        error: 'Falta la dirección del panel de Stoky: ponla en Conectar mi web y tienda → Stoky.',
        ir: '/panel#integraciones',
      });
    }

    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });

    const lead = await repos.leads.ensure(contactId, contact.name);

    // Lo que no cabe en un campo de la venta va a la observacion, que es lo
    // que lee quien despacha: que envia, para cuando y que servicio eligio.
    const notas = [
      lead.contenido?.trim() ? `Envio: ${lead.contenido.trim()}` : null,
      lead.servicio?.trim() ? `Servicio: ${lead.servicio.trim()}` : null,
      lead.cuando?.trim() ? `Cuando: ${lead.cuando.trim()}` : null,
      lead.recojoDistrito?.trim() ? `Recojo: ${lead.recojoDistrito.trim()}` : null,
      lead.notas?.trim() || null,
    ]
      .filter(Boolean)
      .join(' · ');

    const params = new URLSearchParams({ preventa: '1', phone: contact.phone });
    const opcionales: Array<[string, string | null]> = [
      ['name', lead.nombre ?? contact.name],
      // El distrito de ENTREGA es el destino de la venta; el de recojo va en
      // la observacion, porque en la ficha del cliente solo cabe uno.
      ['district', lead.entregaDistrito],
      ['address', lead.entregaDireccion],
      ['reference', lead.entregaReferencia],
      ['document', lead.documentoNumero === 'no proporcionado' ? null : lead.documentoNumero],
      ['notas', notas || null],
    ];

    for (const [clave, valor] of opcionales) {
      if (valor?.trim()) params.set(clave, valor.trim());
    }

    return {
      url: `${panelStoky.replace(/\/+$/, '')}/admin/sales?${params.toString()}`,
      lead,
    };
  });

  app.get('/admin/leads/:contactId', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    return { lead: await repos.leads.ensure(contactId, contact.name), contact };
  });

  /**
   * Corrige la ficha a mano.
   *
   * El asistente escribe lo que entiende del cliente; el operador tiene la
   * ultima palabra, porque es quien va a leer la conversacion entera.
   */
  app.put('/admin/leads/:contactId', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const patch = patchSchema.parse(request.body ?? {});
    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });

    const previo = await repos.leads.ensure(contactId, contact.name);
    // Tocar la ficha a mano cancela la pregunta que estuviera esperando: si el
    // operador acaba de escribir el distrito, el bot no puede seguir pidiendolo.
    const lead = await repos.leads.update(contactId, { ...patch, preguntaPendiente: null });

    // Solo al ENTRAR en el estado final. Sin comparar con el estado previo,
    // guardar dos veces una ficha ya enviada dispararia dos respaldos.
    const cierra =
      ESTADOS_FINALES.includes(lead.estado) && !ESTADOS_FINALES.includes(previo.estado);
    if (cierra && alCerrarFicha) await alCerrarFicha(contactId);

    return lead;
  });
}
