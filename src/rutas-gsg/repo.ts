/**
 * Lo que guarda el webhook de estados de rutas: el ultimo estado de cada ruta,
 * que chats quedaron cerrados por ella, la bitacora de avisos y la huella del
 * secreto. Ver db/migrations/021_webhook_rutas.sql y src/rutas-gsg/servicio.ts.
 */
import type { Pool } from '../db/pool.js';

export interface EstadoRuta {
  ruta: string;
  estado: string;
  activa: boolean;
  cambiadoAt: Date;
  recibidoAt: Date;
}

export interface BloqueoChat {
  contactId: string;
  ruta: string;
  estado: string;
  desde: Date;
}

export type ResultadoAvisoRuta = 'recibido' | 'aplicado' | 'sin_pedidos' | 'ignorado_viejo' | 'error';

export interface EventoRuta {
  id: number;
  recibidoAt: Date;
  ruta: string | null;
  estado: string | null;
  cambiadoAt: Date | null;
  resultado: ResultadoAvisoRuta;
  detalle: string | null;
  chats: number;
  prueba: boolean;
}

export interface RutasGsgRepo {
  ruta(ruta: string): Promise<EstadoRuta | null>;
  guardarRuta(r: EstadoRuta): Promise<void>;
  /** Las rutas conocidas, las cerradas primero, con cuantos chats tienen cerrados. */
  rutas(limite: number): Promise<Array<EstadoRuta & { chatsCerrados: number }>>;
  /** Cierra esos chats por esa ruta. Devuelve cuantos quedaron cerrados por ella. */
  bloquear(contactIds: string[], ruta: string, estado: string, desde: Date): Promise<number>;
  /** Abre los chats que esa ruta tenia cerrados. Devuelve sus contactos. */
  desbloquear(ruta: string): Promise<string[]>;
  /** Por que esta cerrado este chat (la ruta mas reciente), o null si esta abierto. */
  bloqueoDe(contactId: string): Promise<BloqueoChat | null>;
  anotarEvento(e: Omit<EventoRuta, 'id'>): Promise<number>;
  cerrarEvento(id: number, resultado: ResultadoAvisoRuta, detalle: string, chats: number): Promise<void>;
  eventos(limite: number): Promise<EventoRuta[]>;
  secreto(): Promise<{ hash: string; ultimos: string; creadoAt: Date } | null>;
  guardarSecreto(hash: string, ultimos: string, at: Date): Promise<void>;
}

interface FilaRuta { ruta: string; estado: string; activa: number | boolean; cambiado_at: Date; recibido_at: Date }
const deRuta = (r: FilaRuta): EstadoRuta => ({
  ruta: r.ruta,
  estado: r.estado,
  activa: Boolean(Number(r.activa)),
  cambiadoAt: new Date(r.cambiado_at),
  recibidoAt: new Date(r.recibido_at),
});

interface FilaEvento { id: number | string; recibido_at: Date; ruta: string | null; estado: string | null; cambiado_at: Date | null; resultado: ResultadoAvisoRuta; detalle: string | null; chats: number; prueba: number | boolean }
const deEvento = (r: FilaEvento): EventoRuta => ({
  id: Number(r.id),
  recibidoAt: new Date(r.recibido_at),
  ruta: r.ruta,
  estado: r.estado,
  cambiadoAt: r.cambiado_at ? new Date(r.cambiado_at) : null,
  resultado: r.resultado,
  detalle: r.detalle,
  chats: Number(r.chats),
  prueba: Boolean(Number(r.prueba)),
});

export function createRutasGsgRepo(pool: Pool): RutasGsgRepo {
  return {
    async ruta(ruta) {
      const { rows } = await pool.query<FilaRuta>('select * from rutas_gsg_estado where ruta = $1', [ruta]);
      return rows[0] ? deRuta(rows[0]) : null;
    },
    async guardarRuta(r) {
      await pool.query(
        `insert into rutas_gsg_estado (ruta, estado, activa, cambiado_at, recibido_at)
         values ($1,$2,$3,$4,$5)
         on duplicate key update estado = values(estado), activa = values(activa), cambiado_at = values(cambiado_at),
           recibido_at = values(recibido_at)`,
        [r.ruta, r.estado, r.activa ? 1 : 0, r.cambiadoAt, r.recibidoAt],
      );
    },
    async rutas(limite) {
      const { rows } = await pool.query<FilaRuta & { chats: number | string }>(
        `select r.*, (select count(*) from chats_bloqueo_ruta b where b.ruta = r.ruta) as chats
           from rutas_gsg_estado r order by r.activa asc, r.recibido_at desc limit $1`,
        [Number(limite)],
      );
      return rows.map((r) => ({ ...deRuta(r), chatsCerrados: Number(r.chats) }));
    },
    async bloquear(contactIds, ruta, estado, desde) {
      for (const id of [...new Set(contactIds)]) {
        await pool.query(
          `insert into chats_bloqueo_ruta (contact_id, ruta, estado, desde) values ($1,$2,$3,$4)
           on duplicate key update estado = values(estado)`,
          [id, ruta, estado, desde],
        );
      }
      const { rows } = await pool.query<{ n: number | string }>('select count(*) as n from chats_bloqueo_ruta where ruta = $1', [ruta]);
      return Number(rows[0]?.n ?? 0);
    },
    async desbloquear(ruta) {
      const { rows } = await pool.query<{ contact_id: string }>('select contact_id from chats_bloqueo_ruta where ruta = $1', [ruta]);
      await pool.query('delete from chats_bloqueo_ruta where ruta = $1', [ruta]);
      return rows.map((r) => r.contact_id);
    },
    async bloqueoDe(contactId) {
      const { rows } = await pool.query<{ contact_id: string; ruta: string; estado: string; desde: Date }>(
        'select * from chats_bloqueo_ruta where contact_id = $1 order by desde desc limit 1',
        [contactId],
      );
      const r = rows[0];
      return r ? { contactId: r.contact_id, ruta: r.ruta, estado: r.estado, desde: new Date(r.desde) } : null;
    },
    async anotarEvento(e) {
      const { insertId } = await pool.query(
        `insert into rutas_webhook_eventos (recibido_at, ruta, estado, cambiado_at, resultado, detalle, chats, prueba)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [e.recibidoAt, e.ruta, e.estado, e.cambiadoAt, e.resultado, e.detalle, e.chats, e.prueba ? 1 : 0],
      );
      return insertId;
    },
    async cerrarEvento(id, resultado, detalle, chats) {
      await pool.query('update rutas_webhook_eventos set resultado = $2, detalle = $3, chats = $4 where id = $1', [id, resultado, detalle, chats]);
    },
    async eventos(limite) {
      const { rows } = await pool.query<FilaEvento>('select * from rutas_webhook_eventos order by id desc limit $1', [Number(limite)]);
      return rows.map(deEvento);
    },
    async secreto() {
      const { rows } = await pool.query<{ hash: string; ultimos: string; creado_at: Date }>('select * from rutas_webhook_secreto where id = 1');
      const r = rows[0];
      return r ? { hash: r.hash, ultimos: r.ultimos, creadoAt: new Date(r.creado_at) } : null;
    },
    async guardarSecreto(hash, ultimos, at) {
      await pool.query(
        `insert into rutas_webhook_secreto (id, hash, ultimos, creado_at) values (1,$1,$2,$3)
         on duplicate key update hash = values(hash), ultimos = values(ultimos), creado_at = values(creado_at)`,
        [hash, ultimos, at],
      );
    },
  };
}

/** La misma interfaz en memoria: para las pruebas y la demo. */
export function createRutasGsgEnMemoria(): RutasGsgRepo & { _bloqueos: BloqueoChat[]; _rutas: Map<string, EstadoRuta>; _eventos: EventoRuta[] } {
  const rutas = new Map<string, EstadoRuta>();
  const bloqueos: BloqueoChat[] = [];
  const eventos: EventoRuta[] = [];
  let secreto: { hash: string; ultimos: string; creadoAt: Date } | null = null;
  return {
    _bloqueos: bloqueos,
    _rutas: rutas,
    _eventos: eventos,
    async ruta(ruta) {
      const r = rutas.get(ruta);
      return r ? { ...r } : null;
    },
    async guardarRuta(r) {
      rutas.set(r.ruta, { ...r });
    },
    async rutas(limite) {
      return [...rutas.values()]
        .sort((a, b) => Number(a.activa) - Number(b.activa) || b.recibidoAt.getTime() - a.recibidoAt.getTime())
        .slice(0, limite)
        .map((r) => ({ ...r, chatsCerrados: bloqueos.filter((b) => b.ruta === r.ruta).length }));
    },
    async bloquear(contactIds, ruta, estado, desde) {
      for (const id of new Set(contactIds)) {
        const ya = bloqueos.find((b) => b.contactId === id && b.ruta === ruta);
        if (ya) ya.estado = estado;
        else bloqueos.push({ contactId: id, ruta, estado, desde });
      }
      return bloqueos.filter((b) => b.ruta === ruta).length;
    },
    async desbloquear(ruta) {
      const ids: string[] = [];
      for (let i = bloqueos.length - 1; i >= 0; i--) {
        if (bloqueos[i]!.ruta === ruta) ids.push(bloqueos.splice(i, 1)[0]!.contactId);
      }
      return ids;
    },
    async bloqueoDe(contactId) {
      const suyos = bloqueos.filter((b) => b.contactId === contactId).sort((a, b) => b.desde.getTime() - a.desde.getTime());
      return suyos[0] ? { ...suyos[0] } : null;
    },
    async anotarEvento(e) {
      const id = eventos.length + 1;
      eventos.push({ ...e, id });
      return id;
    },
    async cerrarEvento(id, resultado, detalle, chats) {
      const e = eventos.find((x) => x.id === id);
      if (e) Object.assign(e, { resultado, detalle, chats });
    },
    async eventos(limite) {
      return [...eventos].sort((a, b) => b.id - a.id).slice(0, limite);
    },
    async secreto() {
      return secreto;
    },
    async guardarSecreto(hash, ultimos, at) {
      secreto = { hash, ultimos, creadoAt: at };
    },
  };
}
