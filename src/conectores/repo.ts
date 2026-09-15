/**
 * Conectores de tiendas: la configuracion y el registro de lo que llega.
 */

import type { Pool } from '../db/pool.js';
import type { EventoTienda, TipoTienda } from './tiendas.js';

export interface ReglaConector {
  evento: EventoTienda;
  activo: boolean;
  /** Con la API de Meta, lo que sale es una plantilla aprobada. */
  plantilla: { nombre: string; idioma: string } | null;
  /** Las variables de la plantilla, con {numero}, {nombre}, {total}... */
  variables: string[];
  /** Texto libre: con cliente no oficial, o dentro de la ventana de 24 h. */
  texto: string | null;
}

export interface Conector {
  id: string;
  tipo: TipoTienda;
  nombre: string;
  activo: boolean;
  reglas: ReglaConector[];
  creadoPor: string | null;
  createdAt: Date;
  ultimoEventoAt: Date | null;
  eventosRecibidos: number;
}

export interface ConectorConSecreto extends Conector {
  secreto: string;
}

export type ResultadoEntrada = 'enviado' | 'bloqueado' | 'sin_regla' | 'sin_telefono' | 'ignorado' | 'error';

export interface EntradaConector {
  id: number;
  conectorId: string;
  evento: string;
  eventoOrigen: string | null;
  pedido: string | null;
  telefono: string | null;
  resultado: ResultadoEntrada;
  detalle: string | null;
  createdAt: Date;
}

export interface ConectoresRepo {
  crear(input: { tipo: TipoTienda; nombre: string; secreto: string; reglas: ReglaConector[]; creadoPor: string | null }): Promise<Conector>;
  listar(): Promise<Conector[]>;
  obtener(id: string): Promise<Conector | null>;
  conSecreto(id: string): Promise<ConectorConSecreto | null>;
  actualizar(id: string, patch: { nombre?: string; activo?: boolean; reglas?: ReglaConector[] }): Promise<Conector | null>;
  cambiarSecreto(id: string, secreto: string): Promise<boolean>;
  borrar(id: string): Promise<boolean>;
  anotarEntrada(entrada: Omit<EntradaConector, 'id' | 'createdAt'> & { at?: Date }): Promise<void>;
  entradas(conectorId: string, limite: number): Promise<EntradaConector[]>;
}

interface Row {
  id: string;
  tipo: TipoTienda;
  nombre: string;
  secreto: string;
  activo: boolean;
  reglas: ReglaConector[] | string;
  creado_por: string | null;
  created_at: Date;
  ultimo_evento_at: Date | null;
  eventos_recibidos: number;
}

interface EntradaRow {
  id: number;
  conector_id: string;
  evento: string;
  evento_origen: string | null;
  pedido: string | null;
  telefono: string | null;
  resultado: ResultadoEntrada;
  detalle: string | null;
  created_at: Date;
}

const COLUMNAS = 'id, tipo, nombre, secreto, activo, reglas, creado_por, created_at, ultimo_evento_at, eventos_recibidos';

const deFila = (r: Row): ConectorConSecreto => ({
  id: r.id,
  tipo: r.tipo,
  nombre: r.nombre,
  secreto: r.secreto,
  activo: r.activo,
  reglas: typeof r.reglas === 'string' ? (JSON.parse(r.reglas) as ReglaConector[]) : r.reglas,
  creadoPor: r.creado_por,
  createdAt: r.created_at,
  ultimoEventoAt: r.ultimo_evento_at,
  eventosRecibidos: r.eventos_recibidos,
});

export const sinSecretoConector = ({ secreto: _s, ...resto }: ConectorConSecreto): Conector => resto;

const entradaDeFila = (r: EntradaRow): EntradaConector => ({
  id: r.id,
  conectorId: r.conector_id,
  evento: r.evento,
  eventoOrigen: r.evento_origen,
  pedido: r.pedido,
  telefono: r.telefono,
  resultado: r.resultado,
  detalle: r.detalle,
  createdAt: r.created_at,
});

export function createConectoresRepo(pool: Pool): ConectoresRepo {
  return {
    async crear(input) {
      const { rows } = await pool.query<Row>(
        `insert into conectores (tipo, nombre, secreto, reglas, creado_por) values ($1,$2,$3,$4,$5) returning ${COLUMNAS}`,
        [input.tipo, input.nombre, input.secreto, JSON.stringify(input.reglas), input.creadoPor],
      );
      return sinSecretoConector(deFila(rows[0]!));
    },
    async listar() {
      const { rows } = await pool.query<Row>(`select ${COLUMNAS} from conectores order by created_at desc`);
      return rows.map((r) => sinSecretoConector(deFila(r)));
    },
    async obtener(id) {
      const { rows } = await pool.query<Row>(`select ${COLUMNAS} from conectores where id = $1`, [id]);
      return rows[0] ? sinSecretoConector(deFila(rows[0])) : null;
    },
    async conSecreto(id) {
      const { rows } = await pool.query<Row>(`select ${COLUMNAS} from conectores where id = $1`, [id]);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async actualizar(id, patch) {
      const { rows } = await pool.query<Row>(
        `update conectores
            set nombre = coalesce($2, nombre), activo = coalesce($3, activo), reglas = coalesce($4::jsonb, reglas)
          where id = $1 returning ${COLUMNAS}`,
        [id, patch.nombre ?? null, patch.activo ?? null, patch.reglas ? JSON.stringify(patch.reglas) : null],
      );
      return rows[0] ? sinSecretoConector(deFila(rows[0])) : null;
    },
    async cambiarSecreto(id, secreto) {
      const { rowCount } = await pool.query('update conectores set secreto = $2 where id = $1', [id, secreto]);
      return (rowCount ?? 0) > 0;
    },
    async borrar(id) {
      const { rowCount } = await pool.query('delete from conectores where id = $1', [id]);
      return (rowCount ?? 0) > 0;
    },
    async anotarEntrada(e) {
      await pool.query(
        `insert into conector_entradas (conector_id, evento, evento_origen, pedido, telefono, resultado, detalle, created_at)
         values ($1,$2,$3,$4,$5,$6,$7, coalesce($8, now()))`,
        [e.conectorId, e.evento, e.eventoOrigen, e.pedido, e.telefono, e.resultado, e.detalle, e.at ?? null],
      );
      await pool.query(
        `update conectores set ultimo_evento_at = coalesce($2, now()), eventos_recibidos = eventos_recibidos + 1 where id = $1`,
        [e.conectorId, e.at ?? null],
      );
    },
    async entradas(conectorId, limite) {
      const { rows } = await pool.query<EntradaRow>(
        `select * from conector_entradas where conector_id = $1 order by id desc limit $2`,
        [conectorId, limite],
      );
      return rows.map(entradaDeFila);
    },
  };
}
