/**
 * «Borrar todo lo de prueba»: SOLO lo del Modulo desarrollador.
 *
 * Lo de prueba se reconoce por dos marcas que un dato real no puede tener:
 * los telefonos del rango reservado (51 000 0xx xxx clientes, 51 000 1xx xxx
 * motorizados, ver numeros.ts) y las referencias que empiezan por PRUEBA-.
 * Cada sentencia va acotada a esas marcas; nada se borra "por fecha" ni "por
 * lote" sin haber comprobado antes que era de prueba.
 */

import type { DesarrolladorRepo } from '../db/desarrollador.js';
import { PREFIJO_CLIENTE_PRUEBA, PREFIJO_MOTORIZADO_PRUEBA, PREFIJO_REFERENCIA_PRUEBA } from './numeros.js';

export interface ResultadoLimpieza {
  entregas: number;
  solicitudes: number;
  lotes: number;
  reportes: number;
  webhooks: number;
  envioAutomatico: number;
  contactos: number;
  motorizados: number;
  claves: number;
}

/** Los patrones LIKE de las marcas de prueba. */
const CLI = `${PREFIJO_CLIENTE_PRUEBA}%`;
const MOTO = `${PREFIJO_MOTORIZADO_PRUEBA}%`;
const REF = `${PREFIJO_REFERENCIA_PRUEBA}%`;

export async function borrarTodoLoDePrueba(db: DesarrolladorRepo): Promise<ResultadoLimpieza> {
  const n = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rowCount;

  // Lo que va a GSG y lo que va a los webhooks: por la referencia o el telefono
  // que llevan dentro. Antes que las solicitudes (algunos reportes cuelgan de ellas).
  const reportes = await n(
    `delete from rutas_reportes
      where json_unquote(json_extract(payload, '$.referencia')) like $1 or json_unquote(json_extract(payload, '$.telefono')) like $2 or json_unquote(json_extract(payload, '$.telefono')) like $3`,
    [REF, CLI, MOTO],
  );
  const webhooks = await n(
    `delete from webhook_entregas
      where estado <> 'enviada' and (cast(payload as char) like $1 or cast(payload as char) like $2 or cast(payload as char) like $3)`,
    [`%${PREFIJO_REFERENCIA_PRUEBA}%`, `%${PREFIJO_CLIENTE_PRUEBA}%`, `%${PREFIJO_MOTORIZADO_PRUEBA}%`],
  );

  // Las entregas de prueba (sus eventos se van en cascada).
  const entregas = await n(`delete from entregas where phone like $1 or referencia like $2`, [CLI, REF]);

  // El reparto: primero se apuntan los lotes que tenian solicitudes de prueba,
  // se borran esas solicitudes y solo despues los lotes que quedaron VACIOS
  // (un lote con clientes reales se queda, con sus clientes reales).
  const lotes = (await db.query<{ lote_id: string }>(`select distinct lote_id from rutas_solicitudes where phone like $1 or referencia like $2`, [CLI, REF])).rows.map((r) => r.lote_id);
  const solicitudes = await n(`delete from rutas_solicitudes where phone like $1 or referencia like $2`, [CLI, REF]);
  let lotesBorrados = 0;
  if (lotes.length) {
    lotesBorrados = await n(
      `delete l from rutas_lotes l where l.id in ($1) and not exists (select 1 from rutas_solicitudes s where s.lote_id = l.id)`,
      [lotes],
    );
  }

  const envioAutomatico =
    (await n(`delete from envio_automatico where phone like $1 or phone like $2 or referencia like $3`, [CLI, MOTO, REF])) +
    (await n(`delete from envio_automatico_movimientos where phone like $1 or phone like $2`, [CLI, MOTO]));

  // Los contactos se llevan en cascada sus mensajes, envios, ubicaciones,
  // fichas, conversaciones guardadas y pedidos del chat.
  const contactos = await n(`delete from contacts where phone like $1 or phone like $2`, [CLI, MOTO]);
  const motorizados = await n(`delete from motorizados where phone like $1`, [MOTO]);

  // La clave de prueba ya se revoca al terminar cada tanda; por si quedo alguna
  // de un corte a medias, se revocan todas las que llevan su nombre.
  const claves = await n(`update claves_api set revocada_at = now(3) where nombre = $1 and revocada_at is null`, ['Módulo desarrollador (prueba)']);

  return { entregas, solicitudes, lotes: lotesBorrados, reportes, webhooks, envioAutomatico, contactos, motorizados, claves };
}

/** Lo que hay de prueba ahora mismo en esta tienda, por estado. */
export async function contarLoDePrueba(db: DesarrolladorRepo): Promise<{ porEstado: Record<string, number>; clientes: number; motorizados: number; reportesPendientes: number; escritos: number }> {
  const porEstado: Record<string, number> = {};
  for (const r of (await db.query<{ estado: string; n: number | string }>(`select estado, count(*) as n from entregas where phone like $1 or referencia like $2 group by estado`, [CLI, REF])).rows) {
    porEstado[r.estado] = Number(r.n);
  }
  const uno = async (sql: string, params: unknown[]) => Number((await db.query<{ n: number | string }>(sql, params)).rows[0]?.n ?? 0);
  return {
    porEstado,
    clientes: Object.values(porEstado).reduce((a, b) => a + b, 0),
    motorizados: await uno(`select count(*) as n from motorizados where phone like $1`, [MOTO]),
    reportesPendientes: await uno(`select count(*) as n from rutas_reportes where estado = 'pendiente' and (json_unquote(json_extract(payload, '$.referencia')) like $1 or json_unquote(json_extract(payload, '$.telefono')) like $2)`, [REF, CLI]),
    // A cuantos clientes de prueba ya se les escribio (hay un mensaje saliente en su hilo).
    escritos: await uno(`select count(distinct c.id) as n from contacts c join messages m on m.contact_id = c.id and m.direction = 'out' where c.phone like $1`, [CLI]),
  };
}
