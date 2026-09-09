/**
 * La ficha de preventa de cada contacto.
 *
 * Es lo que se averigua hablando -que envia, de donde a donde, cuando, con que
 * datos de facturacion- antes de que haya venta. Una fila por contacto: la
 * preventa es un estado del cliente, no un historico.
 *
 * `Repos` lo expone como `repos.leads`.
 */

import type { Pool } from './pool.js';

export type LeadEstado = 'nuevo' | 'en_conversacion' | 'calificado' | 'enviado' | 'descartado';

export const ESTADOS: LeadEstado[] = [
  'nuevo',
  'en_conversacion',
  'calificado',
  'enviado',
  'descartado',
];

export interface Lead {
  id: number;
  contactId: string;

  nombre: string | null;
  origen: string | null;

  recojoDireccion: string | null;
  recojoDistrito: string | null;
  recojoReferencia: string | null;
  recojoLat: number | null;
  recojoLng: number | null;

  entregaDireccion: string | null;
  entregaDistrito: string | null;
  entregaReferencia: string | null;
  entregaLat: number | null;
  entregaLng: number | null;

  contenido: string | null;
  pesoKg: number | null;
  fragil: boolean;
  cuando: string | null;

  documentoTipo: string | null;
  documentoNumero: string | null;
  razonSocial: string | null;

  estado: LeadEstado;
  notas: string | null;

  /** Ids de las opciones ofrecidas en el ultimo mensaje, para leer un "2". */
  ultimasOpciones: string[] | null;
  /** Que se le pregunto y esta esperando respuesta. Null = nada pendiente. */
  preguntaPendiente: string | null;

  crmId: string | null;
  enviadoAt: Date | null;
  ultimoError: string | null;

  createdAt: Date;
  updatedAt: Date;
}

/** Lo que se puede escribir desde la ficha. El estado va aparte. */
export type LeadPatch = Partial<
  Pick<
    Lead,
    | 'nombre'
    | 'origen'
    | 'recojoDireccion'
    | 'recojoDistrito'
    | 'recojoReferencia'
    | 'recojoLat'
    | 'recojoLng'
    | 'entregaDireccion'
    | 'entregaDistrito'
    | 'entregaReferencia'
    | 'entregaLat'
    | 'entregaLng'
    | 'contenido'
    | 'pesoKg'
    | 'fragil'
    | 'cuando'
    | 'documentoTipo'
    | 'documentoNumero'
    | 'razonSocial'
    | 'estado'
    | 'notas'
    | 'ultimasOpciones'
    | 'preguntaPendiente'
  >
>;

/** Una ficha con el telefono al lado, para la bandeja y para exportar. */
export interface LeadConContacto extends Lead {
  phone: string;
  contactName: string | null;
}

export interface LeadsRepo {
  /** La ficha del contacto; se crea vacia la primera vez que se pide. */
  ensure(contactId: string, nombre?: string | null): Promise<Lead>;
  get(contactId: string): Promise<Lead | null>;
  /** Escribe solo los campos presentes: lo que no viene, no se toca. */
  update(contactId: string, patch: LeadPatch): Promise<Lead>;
  list(query: { estado?: LeadEstado; limit: number; offset: number }): Promise<LeadConContacto[]>;
  /** Marca la ficha como entregada al sistema de ventas. */
  marcarEnviada(contactId: string, crmId: string | null): Promise<void>;
  marcarError(contactId: string, error: string): Promise<void>;
  contarPorEstado(): Promise<Record<string, number>>;
}

interface Row {
  id: number;
  contact_id: string;
  nombre: string | null;
  origen: string | null;
  recojo_direccion: string | null;
  recojo_distrito: string | null;
  recojo_referencia: string | null;
  recojo_lat: number | null;
  recojo_lng: number | null;
  entrega_direccion: string | null;
  entrega_distrito: string | null;
  entrega_referencia: string | null;
  entrega_lat: number | null;
  entrega_lng: number | null;
  contenido: string | null;
  peso_kg: string | number | null;
  fragil: boolean;
  cuando: string | null;
  documento_tipo: string | null;
  documento_numero: string | null;
  razon_social: string | null;
  estado: LeadEstado;
  notas: string | null;
  ultimas_opciones: string[] | null;
  pregunta_pendiente: string | null;
  crm_id: string | null;
  enviado_at: Date | null;
  ultimo_error: string | null;
  created_at: Date;
  updated_at: Date;
  phone?: string;
  contact_name?: string | null;
}

const toLead = (r: Row): Lead => ({
  id: r.id,
  contactId: r.contact_id,
  nombre: r.nombre,
  origen: r.origen,
  recojoDireccion: r.recojo_direccion,
  recojoDistrito: r.recojo_distrito,
  recojoReferencia: r.recojo_referencia,
  recojoLat: r.recojo_lat,
  recojoLng: r.recojo_lng,
  entregaDireccion: r.entrega_direccion,
  entregaDistrito: r.entrega_distrito,
  entregaReferencia: r.entrega_referencia,
  entregaLat: r.entrega_lat,
  entregaLng: r.entrega_lng,
  contenido: r.contenido,
  // numeric llega como cadena para no perder precision; la ficha lo quiere
  // como numero para poder sumarlo y compararlo.
  pesoKg: r.peso_kg == null ? null : Number(r.peso_kg),
  fragil: r.fragil,
  cuando: r.cuando,
  documentoTipo: r.documento_tipo,
  documentoNumero: r.documento_numero,
  razonSocial: r.razon_social,
  estado: r.estado,
  notas: r.notas,
  ultimasOpciones: r.ultimas_opciones,
  preguntaPendiente: r.pregunta_pendiente,
  crmId: r.crm_id,
  enviadoAt: r.enviado_at,
  ultimoError: r.ultimo_error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Nombre de columna por campo de la ficha. Es el unico sitio que los casa. */
const COLUMNAS: Record<keyof LeadPatch, string> = {
  nombre: 'nombre',
  origen: 'origen',
  recojoDireccion: 'recojo_direccion',
  recojoDistrito: 'recojo_distrito',
  recojoReferencia: 'recojo_referencia',
  recojoLat: 'recojo_lat',
  recojoLng: 'recojo_lng',
  entregaDireccion: 'entrega_direccion',
  entregaDistrito: 'entrega_distrito',
  entregaReferencia: 'entrega_referencia',
  entregaLat: 'entrega_lat',
  entregaLng: 'entrega_lng',
  contenido: 'contenido',
  pesoKg: 'peso_kg',
  fragil: 'fragil',
  cuando: 'cuando',
  documentoTipo: 'documento_tipo',
  documentoNumero: 'documento_numero',
  razonSocial: 'razon_social',
  estado: 'estado',
  notas: 'notas',
  ultimasOpciones: 'ultimas_opciones',
  preguntaPendiente: 'pregunta_pendiente',
};

export function createLeadsRepo(pool: Pool): LeadsRepo {
  async function get(contactId: string): Promise<Lead | null> {
    const { rows } = await pool.query<Row>('select * from leads where contact_id = $1', [contactId]);
    return rows[0] ? toLead(rows[0]) : null;
  }

  return {
    get,

    async ensure(contactId, nombre) {
      const { rows } = await pool.query<Row>(
        `insert into leads (contact_id, nombre)
         values ($1, $2)
         on conflict (contact_id) do update
            -- El do update es lo que hace que devuelva la fila existente; de
            -- paso rellena el nombre si la ficha no tenia ninguno.
            set nombre = coalesce(leads.nombre, excluded.nombre)
         returning *`,
        [contactId, nombre ?? null],
      );
      return toLead(rows[0]!);
    },

    async update(contactId, patch) {
      await this.ensure(contactId);

      const campos = Object.keys(patch) as Array<keyof LeadPatch>;
      const asignaciones: string[] = [];
      const valores: unknown[] = [contactId];

      for (const campo of campos) {
        const columna = COLUMNAS[campo];
        if (!columna) continue;
        valores.push(patch[campo] ?? null);
        asignaciones.push(`${columna} = $${valores.length}`);
      }

      if (!asignaciones.length) return (await get(contactId))!;

      const { rows } = await pool.query<Row>(
        `update leads set ${asignaciones.join(', ')}, updated_at = now()
          where contact_id = $1
          returning *`,
        valores,
      );
      return toLead(rows[0]!);
    },

    async list(query) {
      const where = query.estado ? 'where l.estado = $3' : '';
      const params: unknown[] = [query.limit, query.offset];
      if (query.estado) params.push(query.estado);

      const { rows } = await pool.query<Row>(
        `select l.*, c.phone, c.name as contact_name
           from leads l
           join contacts c on c.id = l.contact_id
           ${where}
          order by l.updated_at desc
          limit $1 offset $2`,
        params,
      );

      return rows.map((r) => ({
        ...toLead(r),
        phone: r.phone ?? '',
        contactName: r.contact_name ?? null,
      }));
    },

    async marcarEnviada(contactId, crmId) {
      await pool.query(
        `update leads
            set estado = 'enviado', crm_id = $2, enviado_at = now(),
                ultimo_error = null, updated_at = now()
          where contact_id = $1`,
        [contactId, crmId],
      );
    },

    async marcarError(contactId, error) {
      // El estado NO cambia: una ficha que fallo al enviarse sigue calificada
      // y tiene que volver a intentarse, no quedarse en un limbo propio.
      await pool.query(
        `update leads set ultimo_error = $2, updated_at = now() where contact_id = $1`,
        [contactId, error.slice(0, 500)],
      );
    },

    async contarPorEstado() {
      const { rows } = await pool.query<{ estado: string; total: number }>(
        'select estado, count(*)::int as total from leads group by estado',
      );
      return Object.fromEntries(rows.map((r) => [r.estado, Number(r.total)]));
    },
  };
}
