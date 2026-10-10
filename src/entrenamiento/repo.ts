/**
 * Las lecciones del asistente y sus examenes: solo consultas, sin decisiones.
 *
 * Quien decide que se ensena, que se aprende de un chat y como se examina es
 * `servicio.ts`; aqui van las filas. Pensado para miles de lecciones: las
 * altas en masa van en un solo insert por tandas, la lista pagina en SQL y
 * el recorrido de conversaciones para aprender va contacto a contacto.
 */

import type { Pool } from '../db/pool.js';

export type TipoLeccion = 'ejemplo' | 'dato' | 'regla';
export type OrigenLeccion = 'manual' | 'importado' | 'chat' | 'correccion' | 'ia' | 'api';
export type EstadoLeccion = 'activa' | 'pendiente' | 'descartada';

export interface Leccion {
  id: number;
  tipo: TipoLeccion;
  pregunta: string | null;
  respuesta: string;
  mala: string | null;
  tema: string | null;
  origen: OrigenLeccion;
  origenDetalle: string | null;
  estado: EstadoLeccion;
  huella: string;
  usos: number;
  ultimoUsoAt: Date | null;
  examenOk: boolean | null;
  examenAt: Date | null;
  examenNota: string | null;
  nota: string | null;
  creadoPor: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NuevaLeccion {
  tipo: TipoLeccion;
  pregunta?: string | null;
  respuesta: string;
  mala?: string | null;
  tema?: string | null;
  origen: OrigenLeccion;
  origenDetalle?: string | null;
  estado?: EstadoLeccion;
  huella: string;
  nota?: string | null;
  creadoPor?: string | null;
}

export interface PatchLeccion {
  tipo?: TipoLeccion;
  pregunta?: string | null;
  respuesta?: string;
  mala?: string | null;
  tema?: string | null;
  estado?: EstadoLeccion;
  huella?: string;
  examenOk?: boolean | null;
  examenAt?: Date | null;
  examenNota?: string | null;
  nota?: string | null;
}

export interface FiltroLecciones {
  estado?: EstadoLeccion;
  tipo?: TipoLeccion;
  tema?: string;
  origen?: OrigenLeccion;
  origenDetalle?: string;
  /** Busca en pregunta, respuesta y tema. */
  q?: string;
  /** Solo las que fallaron (false) o pasaron (true) su ultimo examen. */
  examenOk?: boolean;
  ids?: number[];
}

export interface Cifras {
  total: number;
  porEstado: Record<EstadoLeccion, number>;
  porTipo: Record<TipoLeccion, number>;
  porOrigen: Record<string, number>;
  /** Lecciones activas que fallaron su ultimo examen. */
  fallanExamen: number;
  /** Lecciones activas que pasaron su ultimo examen. */
  pasanExamen: number;
  /** Activas que nunca se examinaron. */
  sinExaminar: number;
}

export interface Examen {
  id: number;
  nombre: string | null;
  total: number;
  aprobados: number;
  fallados: number;
  errores: number;
  estado: 'corriendo' | 'terminado' | 'cancelado';
  detalle: Record<string, unknown> | null;
  creadoPor: string | null;
  empezadoAt: Date;
  terminadoAt: Date | null;
}

export interface CasoExamen {
  id: number;
  examenId: number;
  leccionId: number | null;
  pregunta: string;
  esperada: string;
  respuesta: string | null;
  ok: boolean;
  motivos: string[];
  createdAt: Date;
}

/** Lo justo de un mensaje para aprender de el. */
export interface MensajeParaAprender {
  direction: 'in' | 'out';
  body: string | null;
  kind: string;
  createdAt: Date;
  /** payload.origen: quien lo mando (persona, ia, sistema...). Ausente = una persona. */
  origen: string | null;
}

export interface EntrenamientoRepo {
  crear(input: NuevaLeccion): Promise<{ leccion: Leccion; nueva: boolean }>;
  /** Alta en masa: devuelve cuantas entraron y cuantas ya estaban (misma huella). */
  crearVarias(inputs: NuevaLeccion[]): Promise<{ nuevas: number; repetidas: number; ids: number[] }>;
  porId(id: number): Promise<Leccion | null>;
  porHuella(huella: string): Promise<Leccion | null>;
  actualizar(id: number, patch: PatchLeccion): Promise<Leccion | null>;
  borrar(id: number): Promise<boolean>;
  listar(filtro: FiltroLecciones, pagina: { limite: number; offset: number }): Promise<{ items: Leccion[]; total: number }>;
  /** Todas las activas, para cargar el indice (sin paginar: son miles, no millones). */
  activas(): Promise<Leccion[]>;
  /** Cambia el estado (o borra) a todas las del filtro; devuelve cuantas. */
  cambiarEstadoEnMasa(filtro: FiltroLecciones, estado: EstadoLeccion): Promise<number>;
  borrarEnMasa(filtro: FiltroLecciones): Promise<number>;
  cifras(): Promise<Cifras>;
  temas(): Promise<Array<{ tema: string; total: number }>>;
  /** Suma un uso a cada una (van al prompt de un turno real). */
  anotarUsos(ids: number[], at: Date): Promise<void>;
  /** Una muestra de ids que cumplen el filtro, al azar si `alAzar`. */
  idsPara(filtro: FiltroLecciones, limite: number, alAzar: boolean): Promise<number[]>;

  // --- aprender de los chats ---
  /** Los contactos (personas, no grupos) con mensajes de texto desde una fecha. */
  contactosConTexto(desde: Date | null): Promise<Array<{ contactId: string; phone: string; nombre: string | null; mensajes: number }>>;
  /** Los mensajes de texto de un contacto, del mas viejo al mas nuevo. */
  mensajesDeTexto(contactId: string, desde: Date | null): Promise<MensajeParaAprender[]>;

  // --- examenes ---
  crearExamen(input: { nombre: string | null; total: number; creadoPor: string | null; detalle?: Record<string, unknown> | null }): Promise<Examen>;
  anotarCaso(input: Omit<CasoExamen, 'id' | 'createdAt'>): Promise<void>;
  cerrarExamen(id: number, estado: 'terminado' | 'cancelado', cifras: { aprobados: number; fallados: number; errores: number }, detalle?: Record<string, unknown> | null): Promise<Examen | null>;
  examenes(limite: number): Promise<Examen[]>;
  examen(id: number): Promise<Examen | null>;
  casosDeExamen(id: number, soloFallos: boolean, limite: number): Promise<CasoExamen[]>;
}

interface Row {
  id: number | string;
  tipo: TipoLeccion;
  pregunta: string | null;
  respuesta: string;
  mala: string | null;
  tema: string | null;
  origen: OrigenLeccion;
  origen_detalle: string | null;
  estado: EstadoLeccion;
  huella: string;
  usos: number | string;
  ultimo_uso_at: Date | null;
  examen_ok: boolean | null;
  examen_at: Date | null;
  examen_nota: string | null;
  nota: string | null;
  creado_por: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ExamenRow {
  id: number | string;
  nombre: string | null;
  total: number | string;
  aprobados: number | string;
  fallados: number | string;
  errores: number | string;
  estado: 'corriendo' | 'terminado' | 'cancelado';
  detalle: Record<string, unknown> | string | null;
  creado_por: string | null;
  empezado_at: Date;
  terminado_at: Date | null;
}

interface CasoRow {
  id: number | string;
  examen_id: number | string;
  leccion_id: number | string | null;
  pregunta: string;
  esperada: string;
  respuesta: string | null;
  ok: boolean;
  motivos: string[] | string | null;
  created_at: Date;
}

const deFila = (r: Row): Leccion => ({
  id: Number(r.id),
  tipo: r.tipo,
  pregunta: r.pregunta,
  respuesta: r.respuesta,
  mala: r.mala,
  tema: r.tema,
  origen: r.origen,
  origenDetalle: r.origen_detalle,
  estado: r.estado,
  huella: r.huella,
  usos: Number(r.usos),
  ultimoUsoAt: r.ultimo_uso_at,
  examenOk: r.examen_ok,
  examenAt: r.examen_at,
  examenNota: r.examen_nota,
  nota: r.nota,
  creadoPor: r.creado_por,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const json = <T>(v: T | string | null): T | null => (typeof v === 'string' ? (JSON.parse(v) as T) : v);

const examenDeFila = (r: ExamenRow): Examen => ({
  id: Number(r.id),
  nombre: r.nombre,
  total: Number(r.total),
  aprobados: Number(r.aprobados),
  fallados: Number(r.fallados),
  errores: Number(r.errores),
  estado: r.estado,
  detalle: json<Record<string, unknown>>(r.detalle),
  creadoPor: r.creado_por,
  empezadoAt: r.empezado_at,
  terminadoAt: r.terminado_at,
});

const casoDeFila = (r: CasoRow): CasoExamen => ({
  id: Number(r.id),
  examenId: Number(r.examen_id),
  leccionId: r.leccion_id === null ? null : Number(r.leccion_id),
  pregunta: r.pregunta,
  esperada: r.esperada,
  respuesta: r.respuesta,
  ok: r.ok,
  motivos: json<string[]>(r.motivos) ?? [],
  createdAt: r.created_at,
});

const COLUMNAS_PATCH: Array<[keyof PatchLeccion, string]> = [
  ['tipo', 'tipo'],
  ['pregunta', 'pregunta'],
  ['respuesta', 'respuesta'],
  ['mala', 'mala'],
  ['tema', 'tema'],
  ['estado', 'estado'],
  ['huella', 'huella'],
  ['examenOk', 'examen_ok'],
  ['examenAt', 'examen_at'],
  ['examenNota', 'examen_nota'],
  ['nota', 'nota'],
];

/** El WHERE de un filtro, con sus parametros numerados a partir de `desde`. */
function donde(filtro: FiltroLecciones, valores: unknown[]): string {
  const partes: string[] = [];
  const param = (v: unknown) => {
    valores.push(v);
    return `$${valores.length}`;
  };
  if (filtro.estado) partes.push(`estado = ${param(filtro.estado)}`);
  if (filtro.tipo) partes.push(`tipo = ${param(filtro.tipo)}`);
  if (filtro.tema) partes.push(`lower(coalesce(tema, '')) = lower(${param(filtro.tema)})`);
  if (filtro.origen) partes.push(`origen = ${param(filtro.origen)}`);
  if (filtro.origenDetalle) partes.push(`origen_detalle = ${param(filtro.origenDetalle)}`);
  if (filtro.examenOk !== undefined) partes.push(`examen_ok = ${param(filtro.examenOk)}`);
  if (filtro.ids?.length) partes.push(`id in (${param(filtro.ids)})`);
  if (filtro.q?.trim()) {
    // La colacion es binaria: el "ilike" de antes se hace con lower() a los dos lados.
    const p = param(`%${filtro.q.trim()}%`);
    partes.push(`(lower(coalesce(pregunta, '')) like lower(${p}) or lower(respuesta) like lower(${p}) or lower(coalesce(tema, '')) like lower(${p}))`);
  }
  return partes.length ? `where ${partes.join(' and ')}` : '';
}

export function createEntrenamientoRepo(pool: Pool): EntrenamientoRepo {
  const repo: EntrenamientoRepo = {
    async crear(input) {
      const r = await repo.crearVarias([input]);
      if (r.nuevas) {
        const leccion = await repo.porId(r.ids[0]!);
        if (leccion) return { leccion, nueva: true };
      }
      const existente = await repo.porHuella(input.huella);
      if (!existente) return repo.crear(input);
      return { leccion: existente, nueva: false };
    },

    async crearVarias(inputs) {
      const ids: number[] = [];
      let nuevas = 0;
      // Dentro de la misma tanda tambien se quitan las repetidas.
      const vistas = new Set<string>();
      const unicas = inputs.filter((i) => (vistas.has(i.huella) ? false : (vistas.add(i.huella), true)));
      for (let i = 0; i < unicas.length; i += 400) {
        // MySQL no tiene "returning": se miran antes las huellas que ya
        // estaban, se insertan las otras (la clave unica sigue de guardia:
        // una que se colara a la vez no se duplica) y se leen sus ids.
        const candidatas = unicas.slice(i, i + 400);
        const { rows: yaEstan } = await pool.query<{ huella: string }>('select huella from ia_lecciones where huella in ($1)', [candidatas.map((l) => l.huella)]);
        const estaban = new Set(yaEstan.map((r) => r.huella));
        const tanda = candidatas.filter((l) => !estaban.has(l.huella));
        if (!tanda.length) continue;
        const valores: unknown[] = [];
        const filas = tanda.map((l) => {
          const base = valores.length;
          valores.push(l.tipo, l.pregunta ?? null, l.respuesta, l.mala ?? null, l.tema ?? null, l.origen, l.origenDetalle ?? null, l.estado ?? 'activa', l.huella, l.nota ?? null, l.creadoPor ?? null);
          return `(${Array.from({ length: 11 }, (_, k) => `$${base + k + 1}`).join(',')})`;
        });
        const { rowCount } = await pool.query(
          `insert into ia_lecciones (tipo, pregunta, respuesta, mala, tema, origen, origen_detalle, estado, huella, nota, creado_por)
           values ${filas.join(',')}
           on duplicate key update huella = huella`,
          valores,
        );
        if (!rowCount) continue;
        const { rows } = await pool.query<{ id: number | string }>('select id from ia_lecciones where huella in ($1) order by id', [tanda.map((l) => l.huella)]);
        nuevas += rowCount;
        for (const r of rows.slice(0, rowCount)) ids.push(Number(r.id));
      }
      return { nuevas, repetidas: inputs.length - nuevas, ids };
    },

    async porId(id) {
      const { rows } = await pool.query<Row>('select * from ia_lecciones where id = $1', [id]);
      return rows[0] ? deFila(rows[0]) : null;
    },

    async porHuella(huella) {
      const { rows } = await pool.query<Row>('select * from ia_lecciones where huella = $1', [huella]);
      return rows[0] ? deFila(rows[0]) : null;
    },

    async actualizar(id, patch) {
      const sets: string[] = [];
      const valores: unknown[] = [];
      for (const [clave, columna] of COLUMNAS_PATCH) {
        if (patch[clave] === undefined) continue;
        valores.push(patch[clave]);
        sets.push(`${columna} = $${valores.length}`);
      }
      if (!sets.length) return repo.porId(id);
      valores.push(id);
      const { rowCount } = await pool.query(`update ia_lecciones set ${sets.join(', ')}, updated_at = now(3) where id = $${valores.length}`, valores);
      return rowCount ? repo.porId(id) : null;
    },

    async borrar(id) {
      const { rowCount } = await pool.query('delete from ia_lecciones where id = $1', [id]);
      return (rowCount ?? 0) > 0;
    },

    async listar(filtro, pagina) {
      const valores: unknown[] = [];
      const where = donde(filtro, valores);
      const { rows: cuenta } = await pool.query<{ n: number | string }>(`select count(*) as n from ia_lecciones ${where}`, valores);
      valores.push(Number(pagina.limite), Number(pagina.offset));
      const { rows } = await pool.query<Row>(`select * from ia_lecciones ${where} order by id desc limit $${valores.length - 1} offset $${valores.length}`, valores);
      return { items: rows.map(deFila), total: Number(cuenta[0]?.n ?? 0) };
    },

    async activas() {
      const { rows } = await pool.query<Row>(`select * from ia_lecciones where estado = 'activa' order by id asc`);
      return rows.map(deFila);
    },

    async cambiarEstadoEnMasa(filtro, estado) {
      const valores: unknown[] = [];
      const where = donde(filtro, valores);
      valores.push(estado);
      const { rowCount } = await pool.query(`update ia_lecciones set estado = $${valores.length}, updated_at = now(3) ${where}`, valores);
      return rowCount ?? 0;
    },

    async borrarEnMasa(filtro) {
      const valores: unknown[] = [];
      const where = donde(filtro, valores);
      const { rowCount } = await pool.query(`delete from ia_lecciones ${where}`, valores);
      return rowCount ?? 0;
    },

    async cifras() {
      const { rows } = await pool.query<{ estado: EstadoLeccion; tipo: TipoLeccion; origen: string; examen_ok: boolean | null; n: number | string }>(
        'select estado, tipo, origen, examen_ok, count(*) as n from ia_lecciones group by estado, tipo, origen, examen_ok',
      );
      const c: Cifras = {
        total: 0,
        porEstado: { activa: 0, pendiente: 0, descartada: 0 },
        porTipo: { ejemplo: 0, dato: 0, regla: 0 },
        porOrigen: {},
        fallanExamen: 0,
        pasanExamen: 0,
        sinExaminar: 0,
      };
      for (const r of rows) {
        const n = Number(r.n);
        c.total += n;
        c.porEstado[r.estado] = (c.porEstado[r.estado] ?? 0) + n;
        if (r.estado === 'activa') {
          c.porTipo[r.tipo] = (c.porTipo[r.tipo] ?? 0) + n;
          c.porOrigen[r.origen] = (c.porOrigen[r.origen] ?? 0) + n;
          if (r.examen_ok === true) c.pasanExamen += n;
          else if (r.examen_ok === false) c.fallanExamen += n;
          else c.sinExaminar += n;
        }
      }
      return c;
    },

    async temas() {
      const { rows } = await pool.query<{ tema: string; n: number | string }>(
        `select tema, count(*) as n from ia_lecciones where tema is not null and tema <> '' and estado <> 'descartada' group by tema order by n desc, tema asc limit 200`,
      );
      return rows.map((r) => ({ tema: r.tema, total: Number(r.n) }));
    },

    async anotarUsos(ids, at) {
      if (!ids.length) return;
      await pool.query('update ia_lecciones set usos = usos + 1, ultimo_uso_at = $2 where id in ($1)', [ids, at]);
    },

    async idsPara(filtro, limite, alAzar) {
      const valores: unknown[] = [];
      const where = donde(filtro, valores);
      valores.push(Number(limite));
      const { rows } = await pool.query<{ id: number | string }>(`select id from ia_lecciones ${where} order by ${alAzar ? 'rand()' : 'id asc'} limit $${valores.length}`, valores);
      return rows.map((r) => Number(r.id));
    },

    async contactosConTexto(desde) {
      const valores: unknown[] = [];
      let filtro = '';
      if (desde) {
        valores.push(desde);
        filtro = `and m.created_at >= $1`;
      }
      const { rows } = await pool.query<{ contact_id: string; phone: string; name: string | null; n: number | string }>(
        `select c.id as contact_id, c.phone, c.name, count(*) as n
           from messages m
           join contacts c on c.id = m.contact_id
          where m.kind = 'text' and coalesce(c.tipo, 'persona') <> 'grupo' ${filtro}
          group by c.id, c.phone, c.name
         having count(*) >= 2
          order by c.id`,
        valores,
      );
      return rows.map((r) => ({ contactId: r.contact_id, phone: r.phone, nombre: r.name, mensajes: Number(r.n) }));
    },

    async mensajesDeTexto(contactId, desde) {
      const valores: unknown[] = [contactId];
      let filtro = '';
      if (desde) {
        valores.push(desde);
        filtro = 'and created_at >= $2';
      }
      const { rows } = await pool.query<{ direction: 'in' | 'out'; body: string | null; kind: string; created_at: Date; origen: string | null }>(
        // Un `"origen": null` en el JSON es un null de SQL (como el ->> de antes), no el texto 'null'.
        `select direction, body, kind, created_at,
                case when json_type(json_extract(payload, '$.origen')) = 'NULL' then null else json_unquote(json_extract(payload, '$.origen')) end as origen
           from messages
          where contact_id = $1 and kind = 'text' ${filtro}
          order by created_at asc, id asc`,
        valores,
      );
      return rows.map((r) => ({ direction: r.direction, body: r.body, kind: r.kind, createdAt: r.created_at, origen: r.origen }));
    },

    async crearExamen(input) {
      const { insertId } = await pool.query(`insert into ia_examenes (nombre, total, creado_por, detalle) values ($1,$2,$3,$4)`, [
        input.nombre,
        input.total,
        input.creadoPor,
        input.detalle ? JSON.stringify(input.detalle) : null,
      ]);
      return (await repo.examen(insertId))!;
    },

    async anotarCaso(c) {
      await pool.query(
        `insert into ia_examen_casos (examen_id, leccion_id, pregunta, esperada, respuesta, ok, motivos) values ($1,$2,$3,$4,$5,$6,$7)`,
        [c.examenId, c.leccionId, c.pregunta, c.esperada, c.respuesta, c.ok, JSON.stringify(c.motivos)],
      );
    },

    async cerrarExamen(id, estado, cifras, detalle) {
      const { rowCount } = await pool.query(
        `update ia_examenes set estado = $2, aprobados = $3, fallados = $4, errores = $5, detalle = coalesce($6, detalle), terminado_at = now(3) where id = $1`,
        [id, estado, cifras.aprobados, cifras.fallados, cifras.errores, detalle ? JSON.stringify(detalle) : null],
      );
      return rowCount ? repo.examen(id) : null;
    },

    async examenes(limite) {
      const { rows } = await pool.query<ExamenRow>('select * from ia_examenes order by id desc limit $1', [Number(limite)]);
      return rows.map(examenDeFila);
    },

    async examen(id) {
      const { rows } = await pool.query<ExamenRow>('select * from ia_examenes where id = $1', [id]);
      return rows[0] ? examenDeFila(rows[0]) : null;
    },

    async casosDeExamen(id, soloFallos, limite) {
      const { rows } = await pool.query<CasoRow>(
        `select * from ia_examen_casos where examen_id = $1 ${soloFallos ? 'and ok = false' : ''} order by ok asc, id asc limit $2`,
        [id, Number(limite)],
      );
      return rows.map(casoDeFila);
    },
  };
  return repo;
}
