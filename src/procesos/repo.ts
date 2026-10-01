/**
 * Los procesos, sus corridas y sus personas: las filas y su bitacora.
 *
 * Aqui no hay decisiones, solo consultas. Quien decide que se le manda a
 * quien es `nucleo.ts`; el ritmo lo pone `motor.ts`. La version en memoria
 * (repo-memoria.ts) hace exactamente lo mismo para la demo y las pruebas.
 */

import type { Pool } from '../db/pool.js';
import {
  ESTADOS_VIVOS,
  type Cierre,
  type Corrida,
  type EstadoCorrida,
  type EstadoPersona,
  type EstadoProceso,
  type NuevaPersona,
  type Paso,
  type PatchPersona,
  type PersonaProceso,
  type PlantillaId,
  type Proceso,
  type Respuesta,
  type Ritmo,
} from './modelo.js';

export interface NuevoProceso {
  nombre: string;
  plantilla?: PlantillaId | null;
  descripcion?: string;
  pasos: Paso[];
  ritmo: Ritmo;
  cierre: Cierre;
  estado?: EstadoProceso;
}

export type PatchProceso = Partial<Pick<Proceso, 'nombre' | 'descripcion' | 'pasos' | 'ritmo' | 'cierre' | 'estado'>>;

export interface FiltroPersonas {
  corridaId?: number;
  procesoId?: number;
  estados?: EstadoPersona[];
  phone?: string;
  /** Solo las que ya respondieron algo. */
  conRespuestas?: boolean;
  limit?: number;
}

export interface EventoPersona {
  id: number;
  personaId: number;
  tipo: string;
  detalle: string | null;
  en: Date;
}

export interface ProcesosRepo {
  crearProceso(p: NuevoProceso): Promise<Proceso>;
  actualizarProceso(id: number, patch: PatchProceso): Promise<Proceso | null>;
  proceso(id: number): Promise<Proceso | null>;
  procesos(): Promise<Proceso[]>;
  borrarProceso(id: number): Promise<boolean>;

  crearCorrida(c: { procesoId: number; nombre: string; origen: string }): Promise<Corrida>;
  corrida(id: number): Promise<Corrida | null>;
  corridas(filtro?: { procesoId?: number; limit?: number }): Promise<Corrida[]>;
  actualizarCorrida(id: number, patch: { estado?: EstadoCorrida; nombre?: string }): Promise<Corrida | null>;

  agregarPersonas(corridaId: number, procesoId: number, personas: NuevaPersona[]): Promise<PersonaProceso[]>;
  persona(id: number): Promise<PersonaProceso | null>;
  personas(filtro: FiltroPersonas): Promise<PersonaProceso[]>;
  actualizarPersona(id: number, patch: PatchPersona): Promise<PersonaProceso | null>;
  /** La persona viva mas reciente con ese telefono cuya corrida no termino (la que espera su respuesta). */
  vivaPorTelefono(phone: string): Promise<PersonaProceso | null>;
  /** La ultima persona con ese telefono (viva o no): para saber si se paso a alguien hace poco. */
  ultimaPorTelefono(phone: string): Promise<PersonaProceso | null>;
  /** A quien le toca algo: vivas, sin pausa, con su corrida activa y su proceso activo, y su hora ya llego. */
  tocaEnviar(ahora: Date, limit: number): Promise<PersonaProceso[]>;
  /** Cuantas hay en cada estado (de una corrida, de un proceso o de todo). */
  cifras(filtro?: { corridaId?: number; procesoId?: number }): Promise<Record<string, number>>;

  registrarEvento(personaId: number, tipo: string, detalle?: string | null): Promise<void>;
  eventos(personaId: number, limit?: number): Promise<EventoPersona[]>;
}

// ------------------------------------------------------------ lectura de filas

/** La columna json llega como objeto (la capa de la base la convierte); por si acaso, tambien se acepta texto. */
function json<T>(v: unknown, porDefecto: T): T {
  if (v === null || v === undefined) return porDefecto;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return porDefecto;
    }
  }
  return v as T;
}

const fecha = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

interface ProcesoRow {
  id: number | string;
  nombre: string;
  plantilla: string | null;
  descripcion: string | null;
  pasos: unknown;
  ritmo: unknown;
  cierre: unknown;
  estado: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function procesoDe(r: ProcesoRow): Proceso {
  const ritmo = json<Partial<Ritmo>>(r.ritmo, {});
  const cierre = json<Partial<Cierre>>(r.cierre, {});
  return {
    id: Number(r.id),
    nombre: r.nombre,
    plantilla: (r.plantilla as PlantillaId | null) ?? null,
    descripcion: r.descripcion ?? '',
    pasos: json<Paso[]>(r.pasos, []),
    ritmo: { desde: ritmo.desde ?? '08:00', hasta: ritmo.hasta ?? '20:00' },
    cierre: { fin: cierre.fin ?? '', ajena: cierre.ajena ?? '', persona: cierre.persona ?? '' },
    estado: r.estado as EstadoProceso,
    createdAt: fecha(r.created_at)!,
    updatedAt: fecha(r.updated_at)!,
  };
}

interface CorridaRow {
  id: number | string;
  proceso_id: number | string;
  nombre: string;
  estado: string;
  origen: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function corridaDe(r: CorridaRow): Corrida {
  return { id: Number(r.id), procesoId: Number(r.proceso_id), nombre: r.nombre, estado: r.estado as EstadoCorrida, origen: r.origen, createdAt: fecha(r.created_at)!, updatedAt: fecha(r.updated_at)! };
}

interface PersonaRow {
  id: number | string;
  corrida_id: number | string;
  proceso_id: number | string;
  phone: string | null;
  telefono_crudo: string;
  nombre: string | null;
  datos: unknown;
  estado: string;
  paso: number;
  intentos: number;
  fallos: number;
  sub: string | null;
  proximo_at: Date | string | null;
  ultimo_envio_at: Date | string | null;
  respuestas: unknown;
  ultimo: string | null;
  motivo: string | null;
  pausada: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  terminada_at: Date | string | null;
}

function personaDe(r: PersonaRow): PersonaProceso {
  return {
    id: Number(r.id),
    corridaId: Number(r.corrida_id),
    procesoId: Number(r.proceso_id),
    phone: r.phone,
    telefonoCrudo: r.telefono_crudo ?? '',
    nombre: r.nombre,
    datos: json<Record<string, string>>(r.datos, {}),
    estado: r.estado as EstadoPersona,
    paso: Number(r.paso),
    intentos: Number(r.intentos),
    fallos: Number(r.fallos),
    sub: r.sub,
    proximoAt: fecha(r.proximo_at),
    ultimoEnvioAt: fecha(r.ultimo_envio_at),
    respuestas: json<Record<string, Respuesta>>(r.respuestas, {}),
    ultimo: r.ultimo,
    motivo: r.motivo,
    pausada: Boolean(r.pausada),
    createdAt: fecha(r.created_at)!,
    updatedAt: fecha(r.updated_at)!,
    terminadaAt: fecha(r.terminada_at),
  };
}

/** Columna de la base para cada campo que se puede cambiar de una persona. */
const COLUMNAS_PERSONA: Record<keyof PatchPersona, string> = {
  estado: 'estado',
  paso: 'paso',
  intentos: 'intentos',
  fallos: 'fallos',
  sub: 'sub',
  proximoAt: 'proximo_at',
  ultimoEnvioAt: 'ultimo_envio_at',
  respuestas: 'respuestas',
  ultimo: 'ultimo',
  motivo: 'motivo',
  pausada: 'pausada',
  terminadaAt: 'terminada_at',
  datos: 'datos',
  nombre: 'nombre',
};
const JSON_PERSONA = new Set(['respuestas', 'datos']);

const VIVOS_SQL = `(${ESTADOS_VIVOS.map((e) => `'${e}'`).join(',')})`;

export function createProcesosRepo(pool: Pool): ProcesosRepo {
  const repo: ProcesosRepo = {
    async crearProceso(p) {
      const { insertId } = await pool.query(
        `insert into procesos (nombre, plantilla, descripcion, pasos, ritmo, cierre, estado)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [p.nombre, p.plantilla ?? null, p.descripcion ?? '', JSON.stringify(p.pasos), JSON.stringify(p.ritmo), JSON.stringify(p.cierre), p.estado ?? 'activo'],
      );
      const { rows } = await pool.query<ProcesoRow>('select * from procesos where id = $1', [insertId]);
      return procesoDe(rows[0]!);
    },

    async actualizarProceso(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [];
      const poner = (col: string, v: unknown, esJson = false) => {
        params.push(esJson ? JSON.stringify(v) : v);
        sets.push(`${col} = $${params.length}`);
      };
      if (patch.nombre !== undefined) poner('nombre', patch.nombre);
      if (patch.descripcion !== undefined) poner('descripcion', patch.descripcion);
      if (patch.pasos !== undefined) poner('pasos', patch.pasos, true);
      if (patch.ritmo !== undefined) poner('ritmo', patch.ritmo, true);
      if (patch.cierre !== undefined) poner('cierre', patch.cierre, true);
      if (patch.estado !== undefined) poner('estado', patch.estado);
      params.push(id);
      await pool.query(`update procesos set ${[...sets, 'updated_at = now(3)'].join(', ')} where id = $${params.length}`, params);
      const { rows } = await pool.query<ProcesoRow>('select * from procesos where id = $1', [id]);
      return rows[0] ? procesoDe(rows[0]) : null;
    },

    async proceso(id) {
      const { rows } = await pool.query<ProcesoRow>('select * from procesos where id = $1', [id]);
      return rows[0] ? procesoDe(rows[0]) : null;
    },

    async procesos() {
      const { rows } = await pool.query<ProcesoRow>(`select * from procesos order by (estado = 'archivado'), id`);
      return rows.map(procesoDe);
    },

    async borrarProceso(id) {
      const { rowCount } = await pool.query('delete from procesos where id = $1', [id]);
      return (rowCount ?? 0) > 0;
    },

    async crearCorrida(c) {
      const { insertId } = await pool.query('insert into proceso_corridas (proceso_id, nombre, origen) values ($1, $2, $3)', [c.procesoId, c.nombre, c.origen]);
      const { rows } = await pool.query<CorridaRow>('select * from proceso_corridas where id = $1', [insertId]);
      return corridaDe(rows[0]!);
    },

    async corrida(id) {
      const { rows } = await pool.query<CorridaRow>('select * from proceso_corridas where id = $1', [id]);
      return rows[0] ? corridaDe(rows[0]) : null;
    },

    async corridas(filtro = {}) {
      const params: unknown[] = [];
      let where = '';
      if (filtro.procesoId !== undefined) {
        params.push(filtro.procesoId);
        where = `where proceso_id = $1`;
      }
      params.push(Number(filtro.limit ?? 50));
      const { rows } = await pool.query<CorridaRow>(`select * from proceso_corridas ${where} order by id desc limit $${params.length}`, params);
      return rows.map(corridaDe);
    },

    async actualizarCorrida(id, patch) {
      const sets: string[] = ['updated_at = now(3)'];
      const params: unknown[] = [];
      if (patch.estado !== undefined) {
        params.push(patch.estado);
        sets.push(`estado = $${params.length}`);
      }
      if (patch.nombre !== undefined) {
        params.push(patch.nombre);
        sets.push(`nombre = $${params.length}`);
      }
      params.push(id);
      await pool.query(`update proceso_corridas set ${sets.join(', ')} where id = $${params.length}`, params);
      return repo.corrida(id);
    },

    async agregarPersonas(corridaId, procesoId, personas) {
      const creadas: PersonaProceso[] = [];
      for (const p of personas) {
        const { insertId } = await pool.query(
          `insert into proceso_personas (corrida_id, proceso_id, phone, telefono_crudo, nombre, datos, estado, motivo)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [corridaId, procesoId, p.phone, p.telefonoCrudo, p.nombre, JSON.stringify(p.datos ?? {}), p.estado ?? 'pendiente', p.motivo ?? null],
        );
        const { rows } = await pool.query<PersonaRow>('select * from proceso_personas where id = $1', [insertId]);
        creadas.push(personaDe(rows[0]!));
      }
      return creadas;
    },

    async persona(id) {
      const { rows } = await pool.query<PersonaRow>('select * from proceso_personas where id = $1', [id]);
      return rows[0] ? personaDe(rows[0]) : null;
    },

    async personas(filtro) {
      const where: string[] = [];
      const params: unknown[] = [];
      const poner = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replace('?', `$${params.length}`));
      };
      if (filtro.corridaId !== undefined) poner('corrida_id = ?', filtro.corridaId);
      if (filtro.procesoId !== undefined) poner('proceso_id = ?', filtro.procesoId);
      if (filtro.phone) poner('phone = ?', filtro.phone);
      if (filtro.estados?.length) poner('estado in (?)', filtro.estados);
      if (filtro.conRespuestas) where.push(`json_length(respuestas) > 0`);
      params.push(Number(filtro.limit ?? 2000));
      const { rows } = await pool.query<PersonaRow>(`select * from proceso_personas ${where.length ? `where ${where.join(' and ')}` : ''} order by id desc limit $${params.length}`, params);
      return rows.map(personaDe);
    },

    async actualizarPersona(id, patch) {
      const sets: string[] = ['updated_at = now(3)'];
      const params: unknown[] = [];
      for (const [clave, valor] of Object.entries(patch) as Array<[keyof PatchPersona, unknown]>) {
        if (valor === undefined) continue;
        const col = COLUMNAS_PERSONA[clave];
        if (!col) continue;
        const esJson = JSON_PERSONA.has(clave);
        params.push(esJson ? JSON.stringify(valor) : valor);
        sets.push(`${col} = $${params.length}`);
      }
      params.push(id);
      await pool.query(`update proceso_personas set ${sets.join(', ')} where id = $${params.length}`, params);
      return repo.persona(id);
    },

    async vivaPorTelefono(phone) {
      const { rows } = await pool.query<PersonaRow>(
        `select p.* from proceso_personas p join proceso_corridas c on c.id = p.corrida_id
          where p.phone = $1 and p.estado in ('esperando', 'programada') and c.estado <> 'terminada'
          order by p.updated_at desc limit 1`,
        [phone],
      );
      return rows[0] ? personaDe(rows[0]) : null;
    },

    async ultimaPorTelefono(phone) {
      const { rows } = await pool.query<PersonaRow>('select * from proceso_personas where phone = $1 order by updated_at desc limit 1', [phone]);
      return rows[0] ? personaDe(rows[0]) : null;
    },

    async tocaEnviar(ahora, limit) {
      const { rows } = await pool.query<PersonaRow>(
        `select p.* from proceso_personas p
           join proceso_corridas c on c.id = p.corrida_id
           join procesos r on r.id = p.proceso_id
          where p.estado in ${VIVOS_SQL} and not p.pausada and p.phone is not null
            and c.estado = 'activa' and r.estado = 'activo'
            and (p.proximo_at is null or p.proximo_at <= $1)
          order by p.proximo_at is not null, p.proximo_at, p.id
          limit $2`,
        [ahora, Number(limit)],
      );
      return rows.map(personaDe);
    },

    async cifras(filtro = {}) {
      const params: unknown[] = [];
      const where: string[] = [];
      if (filtro.corridaId !== undefined) {
        params.push(filtro.corridaId);
        where.push(`corrida_id = $${params.length}`);
      }
      if (filtro.procesoId !== undefined) {
        params.push(filtro.procesoId);
        where.push(`proceso_id = $${params.length}`);
      }
      const { rows } = await pool.query<{ estado: string; n: number }>(`select estado, count(*) as n from proceso_personas ${where.length ? `where ${where.join(' and ')}` : ''} group by estado`, params);
      const salida: Record<string, number> = {};
      for (const r of rows) salida[r.estado] = Number(r.n);
      return salida;
    },

    async registrarEvento(personaId, tipo, detalle) {
      await pool.query('insert into proceso_eventos (persona_id, tipo, detalle) values ($1, $2, $3)', [personaId, tipo, detalle ?? null]);
    },

    async eventos(personaId, limit = 100) {
      const { rows } = await pool.query<{ id: number; persona_id: number; tipo: string; detalle: string | null; en: Date | string }>('select * from proceso_eventos where persona_id = $1 order by id desc limit $2', [personaId, Number(limit)]);
      return rows.map((r) => ({ id: Number(r.id), personaId: Number(r.persona_id), tipo: r.tipo, detalle: r.detalle, en: fecha(r.en)! }));
    },
  };
  return repo;
}
