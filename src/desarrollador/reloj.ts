/**
 * «Adelantar el tiempo» SOLO para lo de prueba.
 *
 * No se toca el reloj del sistema, ni el horario, ni el marcapasos del numero
 * (los dos dieron problemas cuando se jugo con ellos): lo que se hace es
 * correr HACIA ATRAS todas las marcas de tiempo de lo de prueba (los pedidos,
 * las solicitudes del reparto, sus eventos, sus mensajes, sus envios y los
 * motorizados de prueba). Para el motor es como si hubiera pasado ese tiempo:
 * en su siguiente vuelta (cada 5 s) le toca insistir, recordar o pasar al
 * repartidor, igual que en un dia de verdad. Lo real no se mueve ni un
 * segundo: cada UPDATE va acotado a los numeros de prueba.
 *
 * El «día» de cada pedido (una fecha) no lo mueve `adelantarLoDePrueba`. Para
 * ver el cierre del día esta `cerrarDiaDePrueba`: pasa los pedidos de prueba
 * que siguen vivos al día anterior y cierra SOLO esos (entregas.cerrarDia con
 * soloPrueba): sin avisar al supervisor real y sin contar como el cierre del
 * día de verdad, que sigue a su hora con los pedidos reales.
 */

import type { DesarrolladorRepo } from '../db/desarrollador.js';
import { PREFIJO_CLIENTE_PRUEBA, PREFIJO_MOTORIZADO_PRUEBA } from './numeros.js';

/** Hasta un dia de golpe: mas no aporta y descuadra los recordatorios. */
export const MAXIMO_MINUTOS = 24 * 60;

/** La condicion SQL "este telefono es de prueba" sobre una columna. */
function dePrueba(columna: string): string {
  return `((${columna} like '${PREFIJO_CLIENTE_PRUEBA}%' or ${columna} like '${PREFIJO_MOTORIZADO_PRUEBA}%') and char_length(${columna}) = 11)`;
}

/** Que filas de cada tabla son de prueba. */
const TABLAS: Array<{ tabla: string; donde: string }> = [
  { tabla: 'entregas', donde: dePrueba('phone') },
  { tabla: 'entregas_eventos', donde: `entrega_id in (select id from entregas where ${dePrueba('phone')})` },
  { tabla: 'rutas_solicitudes', donde: dePrueba('phone') },
  { tabla: 'rutas_eventos', donde: `solicitud_id in (select id from rutas_solicitudes where ${dePrueba('phone')})` },
  { tabla: 'motorizados', donde: dePrueba('phone') },
  { tabla: 'contacts', donde: dePrueba('phone') },
  { tabla: 'messages', donde: `contact_id in (select id from contacts where ${dePrueba('phone')})` },
  { tabla: 'deliveries', donde: `contact_id in (select id from contacts where ${dePrueba('phone')})` },
];

async function columnasDeTiempo(db: DesarrolladorRepo, tabla: string): Promise<string[]> {
  // El alias hace falta: MySQL 8 devuelve COLUMN_NAME en mayusculas.
  const r = await db.query<{ column_name: string }>(
    `select column_name as column_name from information_schema.columns
      where table_schema = database() and table_name = $1 and data_type in ('datetime', 'timestamp')`,
    [tabla],
  );
  return r.rows.map((x) => x.column_name).filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));
}

export interface ResultadoAdelantar {
  minutos: number;
  filas: number;
  porTabla: Record<string, number>;
}

export interface ResultadoCierrePrueba {
  movidos: number;
  sinTerminar: string[];
  dadasPorEntregadas: string[];
}

/**
 * «Fin del día» de lo de prueba: cierra los pedidos de prueba vivos como lo
 * haria el cierre de medianoche, sin tocar ni un pedido real.
 */
export async function cerrarDiaDePrueba(
  db: DesarrolladorRepo,
  entregas: { cerrarDia(opts: { soloPrueba: true; quien: string }): Promise<{ ok: boolean; motivo?: string; resultado?: { sinTerminar: string[]; dadasPorEntregadas: string[] } }> },
): Promise<ResultadoCierrePrueba> {
  // Al dia anterior (si ese dia no tiene ya esa referencia: dia+referencia es
  // unica). MySQL no deja leer en un subselect la tabla que se actualiza: los
  // que chocarian se apartan antes en una derivada (que se materializa).
  const movidos = await db.query(
    `update entregas e set e.dia = date_sub(e.dia, interval 1 day)
      where ${dePrueba('e.phone')} and e.estado not in ('entregada', 'terminada', 'cancelada')
        and e.id not in (
          select id from (
            select y.id from entregas y join entregas x on x.dia = date_sub(y.dia, interval 1 day) and x.referencia = y.referencia
          ) chocan
        )`,
  );
  const r = await entregas.cerrarDia({ soloPrueba: true, quien: 'Módulo desarrollador' });
  return { movidos: movidos.rowCount, sinTerminar: r.resultado?.sinTerminar ?? [], dadasPorEntregadas: r.resultado?.dadasPorEntregadas ?? [] };
}

export async function adelantarLoDePrueba(db: DesarrolladorRepo, minutos: number): Promise<ResultadoAdelantar> {
  const m = Math.max(1, Math.min(MAXIMO_MINUTOS, Math.floor(minutos)));
  const porTabla: Record<string, number> = {};
  let filas = 0;
  for (const { tabla, donde } of TABLAS) {
    const cols = await columnasDeTiempo(db, tabla);
    if (!cols.length) continue;
    const set = cols.map((c) => `\`${c}\` = \`${c}\` - interval $1 minute`).join(', ');
    const r = await db.query(`update ${tabla} set ${set} where ${donde}`, [m]);
    porTabla[tabla] = r.rowCount;
    filas += r.rowCount;
  }
  return { minutos: m, filas, porTabla };
}
