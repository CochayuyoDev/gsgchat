/**
 * Las solicitudes de privacidad de los clientes y el borrado de sus datos.
 *
 * Tabla `solicitudes_privacidad` (migracion 020). El borrado recorre todas las
 * tablas donde queda algo del cliente (por su numero o por su contacto) en una
 * sola transaccion: o se borra todo, o no se borra nada.
 *
 * Tras borrar, el numero queda libre: si mañana entra un pedido nuevo para el,
 * el sistema crea un contacto nuevo y empieza de cero, como con cualquiera.
 */

import type { Pool, Queryable } from '../db/pool.js';

export type TipoPrivacidad = 'baja' | 'borrar_datos';
export type EstadoPrivacidad = 'pendiente' | 'atendida';
/** Como se atendio: se le dio de baja, se borraron sus datos, o una persona vio que no era eso. */
export type AtendidaComo = 'baja' | 'datos_borrados' | 'descartada';
export type ComoSeReconocio = 'reglas' | 'ia' | 'equipo';

export interface SolicitudPrivacidad {
  id: number;
  phone: string;
  contactId: string | null;
  tipo: TipoPrivacidad;
  texto: string | null;
  como: ComoSeReconocio;
  estado: EstadoPrivacidad;
  atendidaComo: AtendidaComo | null;
  atendidaPor: string | null;
  atendidaAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NuevaSolicitudPrivacidad {
  phone: string;
  contactId: string | null;
  tipo: TipoPrivacidad;
  texto: string | null;
  como: ComoSeReconocio;
}

/** Cuanto se borro de cada cosa: lo que se le cuenta a quien pulso el boton. */
export interface ResultadoBorrado {
  /** Si existia un contacto con ese numero. */
  contacto: boolean;
  mensajes: number;
  pedidos: number;
  solicitudesUbicacion: number;
  otros: number;
  /** Los wamid de sus mensajes: con ellos se borran los adjuntos del disco. */
  wamids: string[];
}

export interface PrivacidadRepo {
  /**
   * Apunta lo que pidio el cliente. Si ya tenia una pendiente del mismo tipo,
   * no se duplica: se actualiza su texto y se devuelve con `nueva: false`.
   */
  registrar(s: NuevaSolicitudPrivacidad): Promise<{ solicitud: SolicitudPrivacidad; nueva: boolean }>;
  pendientes(limite?: number): Promise<SolicitudPrivacidad[]>;
  contarPendientes(): Promise<number>;
  /** Las pendientes de un numero (para la cabecera del chat). */
  pendientesDe(phone: string): Promise<SolicitudPrivacidad[]>;
  /** Cierra todas las pendientes de ese numero (o solo las de un tipo). */
  atender(phone: string, como: AtendidaComo, por: string | null, tipo?: TipoPrivacidad): Promise<number>;
  /** Borra todo lo del cliente y deja sus solicitudes como constancia, sin numero completo ni texto. */
  borrarDatosDelCliente(phone: string, por: string | null): Promise<ResultadoBorrado>;
}

interface Fila {
  id: number;
  phone: string;
  contact_id: string | null;
  tipo: TipoPrivacidad;
  texto: string | null;
  como: ComoSeReconocio;
  estado: EstadoPrivacidad;
  atendida_como: AtendidaComo | null;
  atendida_por: string | null;
  atendida_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const deFila = (r: Fila): SolicitudPrivacidad => ({
  id: Number(r.id),
  phone: r.phone,
  contactId: r.contact_id,
  tipo: r.tipo,
  texto: r.texto,
  como: r.como,
  estado: r.estado,
  atendidaComo: r.atendida_como,
  atendidaPor: r.atendida_por,
  atendidaAt: r.atendida_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** «51987654321» → «••••••4321»: lo que queda de constancia tras borrar. */
export function numeroOculto(phone: string): string {
  const d = phone.replace(/\D+/g, '');
  return d.length <= 4 ? '••••' : '•'.repeat(Math.min(d.length - 4, 8)) + d.slice(-4);
}

/**
 * Las formas en que ese numero puede estar guardado: con codigo de pais, sin
 * el (los 9 digitos de un celular de Peru) y con «+» (lo crudo que llego).
 */
export function variantesDelNumero(phone: string): string[] {
  const d = phone.replace(/\D+/g, '');
  const local = d.length > 9 ? d.slice(-9) : d;
  return [...new Set([d, local, `+${d}`, d.startsWith('51') ? d : `51${local}`].filter((v) => v.replace(/\D+/g, '').length >= 6))];
}

async function contar(db: Queryable, sql: string, params: unknown[]): Promise<number> {
  const r = await db.query(sql, params);
  return Number(r.rowCount ?? 0);
}

export function crearPrivacidadRepo(pool: Pool): PrivacidadRepo {
  return {
    async registrar(s) {
      const { rows } = await pool.query<Fila>(
        `select * from solicitudes_privacidad where phone = $1 and tipo = $2 and estado = 'pendiente' order by id desc limit 1`,
        [s.phone, s.tipo],
      );
      const texto = s.texto ? s.texto.slice(0, 500) : null;
      if (rows[0]) {
        await pool.query(
          `update solicitudes_privacidad set texto = coalesce($2, texto), contact_id = coalesce(contact_id, $3), updated_at = now(3) where id = $1`,
          [rows[0].id, texto, s.contactId],
        );
        const { rows: otra } = await pool.query<Fila>('select * from solicitudes_privacidad where id = $1', [rows[0].id]);
        return { solicitud: deFila(otra[0] ?? rows[0]), nueva: false };
      }
      const { insertId } = await pool.query(
        `insert into solicitudes_privacidad (phone, contact_id, tipo, texto, como) values ($1, $2, $3, $4, $5)`,
        [s.phone, s.contactId, s.tipo, texto, s.como],
      );
      const { rows: nueva } = await pool.query<Fila>('select * from solicitudes_privacidad where id = $1', [insertId]);
      return { solicitud: deFila(nueva[0]!), nueva: true };
    },

    async pendientes(limite = 100) {
      const { rows } = await pool.query<Fila>(
        `select * from solicitudes_privacidad where estado = 'pendiente' order by created_at desc, id desc limit $1`,
        [Number(limite)],
      );
      return rows.map(deFila);
    },

    async contarPendientes() {
      const { rows } = await pool.query<{ n: number }>(`select count(*) as n from solicitudes_privacidad where estado = 'pendiente'`);
      return Number(rows[0]?.n ?? 0);
    },

    async pendientesDe(phone) {
      const { rows } = await pool.query<Fila>(
        `select * from solicitudes_privacidad where phone = $1 and estado = 'pendiente' order by created_at desc, id desc`,
        [phone],
      );
      return rows.map(deFila);
    },

    async atender(phone, como, por, tipo) {
      return contar(
        pool,
        `update solicitudes_privacidad
            set estado = 'atendida', atendida_como = $2, atendida_por = $3, atendida_at = now(3), updated_at = now(3)
          where phone = $1 and estado = 'pendiente'${tipo ? ' and tipo = $4' : ''}`,
        tipo ? [phone, como, por, tipo] : [phone, como, por],
      );
    },

    async borrarDatosDelCliente(phone, por) {
      const numeros = variantesDelNumero(phone);
      const db = await pool.connect();
      try {
        await db.query('start transaction');
        const { rows: contactos } = await db.query<{ id: string }>(`select id from contacts where phone in ($1) and tipo <> 'grupo'`, [numeros]);
        const ids = contactos.map((c) => c.id);
        const { rows: wam } = ids.length
          ? await db.query<{ wamid: string | null }>('select wamid from messages where contact_id in ($1)', [ids])
          : { rows: [] as Array<{ wamid: string | null }> };
        const mensajes = wam.length;

        // Los trackings de sus pedidos: el ultimo seguimiento de GSG se guarda por tracking.
        const { rows: suyas } = await db.query<{ id: number; referencia: string; tracking: string | null }>(
          `select id, referencia, json_unquote(json_extract(datos_envio, '$.tracking')) as tracking from entregas where phone in ($1)`,
          [numeros],
        );
        const trackings = [...new Set(suyas.flatMap((e) => [e.referencia, e.tracking]).filter((t): t is string => Boolean(t && t !== 'null')))];

        let otros = 0;
        const pedidos = await contar(db, 'delete from entregas where phone in ($1)', [numeros]);
        const solicitudesUbicacion = await contar(
          db,
          `delete from rutas_solicitudes where phone in ($1) or telefono_crudo in ($1)${ids.length ? ' or contact_id in ($2)' : ''}`,
          ids.length ? [numeros, ids] : [numeros],
        );
        if (trackings.length) otros += await contar(db, 'delete from seguimientos_gsg where tracking in ($1)', [trackings]);
        // Lo que se guarda por numero y no cuelga del contacto.
        const porNumero: Array<[string, string]> = [
          ['chat_archives', 'phone'],
          ['mensajes_gsg', 'phone'],
          ['chat_etiquetas', 'phone'],
          ['chat_etiquetas_eventos', 'phone'],
          ['chat_etiquetas_lote_chats', 'phone'],
          ['envio_automatico', 'phone'],
          ['envio_automatico_movimientos', 'phone'],
          ['numeros_reportados', 'telefono'],
          ['proceso_personas', 'phone'],
          ['campaign_recipients', 'phone'],
          ['decisiones_bot', 'phone'],
          ['pedidos_chat', 'telefono'],
          ['conector_entradas', 'telefono'],
        ];
        for (const [tabla, columna] of porNumero) otros += await contar(db, `delete from ${tabla} where ${columna} in ($1)`, [numeros]);
        // La bitacora de acciones del equipo (dar de baja, abrir su chat...) guarda el numero en el detalle: se vacia.
        for (const n of numeros) {
          await db.query(`update actividad set detalle = null where cast(detalle as char) like $1`, [`%${n.replace(/[%_\\]/g, '')}%`]);
        }
        if (ids.length) {
          // tracking_links queda en «set null» al borrar el contacto: se borra a mano (sus puntos caen en cascada).
          otros += await contar(db, 'delete from tracking_links where contact_id in ($1)', [ids]);
          otros += await contar(db, 'update salud_eventos set contact_id = null where contact_id in ($1)', [ids]);
          // Lo demas (mensajes, ubicaciones, leads, envios, secuencias, decisiones) cae en cascada.
          await db.query('delete from contacts where id in ($1)', [ids]);
        }
        // La constancia: que se pidio y que se cumplio, sin el numero completo ni lo que escribio.
        await db.query(
          `update solicitudes_privacidad
              set estado = 'atendida', atendida_como = 'datos_borrados', atendida_por = coalesce($2, atendida_por), atendida_at = now(3), updated_at = now(3)
            where phone in ($1) and estado = 'pendiente'`,
          [numeros, por],
        );
        await db.query(
          `update solicitudes_privacidad set phone = $2, texto = null, contact_id = null, updated_at = now(3) where phone in ($1)`,
          [numeros, numeroOculto(phone)],
        );
        await db.query('commit');
        return {
          contacto: ids.length > 0,
          mensajes,
          pedidos,
          solicitudesUbicacion,
          otros,
          wamids: wam.map((m) => m.wamid).filter((w): w is string => Boolean(w)),
        };
      } catch (error) {
        await db.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        db.release();
      }
    },
  };
}
