/**
 * Los mensajes que escribe un usuario de GSG (POST /api/v1/chat).
 *
 * Por cada mensaje que GSG manda se apunta quien lo escribio (su usuario y su
 * rol en ese momento), a que tracking y con que id de GSG (`idExterno`). Ese id
 * es lo que evita duplicados: si GSG reintenta el mismo mensaje, ya esta aqui
 * y no se le vuelve a mandar al cliente. Tabla `mensajes_gsg` (migracion 012).
 *
 * Solo se apunta lo que SALIO: un envio que fallo o quedo bloqueado no se
 * guarda, para que el reintento de GSG si lo vuelva a intentar.
 */

import type { Pool } from './pool.js';

export interface MensajeGsg {
  idExterno: string;
  tracking: string;
  usuarioId: string;
  usuarioNombre: string | null;
  rol: string | null;
  phone: string;
  /** El id de WhatsApp con el que salio, si el proveedor lo dio. */
  wamid: string | null;
  createdAt: Date;
}

export interface MensajesGsgRepo {
  porIdExterno(idExterno: string): Promise<MensajeGsg | null>;
  /** Apunta un mensaje enviado. false si ese `idExterno` ya estaba (no se pisa). */
  guardar(mensaje: Omit<MensajeGsg, 'createdAt'>): Promise<boolean>;
}

interface Fila {
  id_externo: string;
  tracking: string;
  usuario_id: string;
  usuario_nombre: string | null;
  rol: string | null;
  phone: string;
  wamid: string | null;
  created_at: Date;
}

const deFila = (r: Fila): MensajeGsg => ({
  idExterno: r.id_externo,
  tracking: r.tracking,
  usuarioId: r.usuario_id,
  usuarioNombre: r.usuario_nombre,
  rol: r.rol,
  phone: r.phone,
  wamid: r.wamid,
  createdAt: r.created_at,
});

export function crearMensajesGsgRepo(pool: Pool): MensajesGsgRepo {
  return {
    async porIdExterno(idExterno) {
      const { rows } = await pool.query<Fila>('select * from mensajes_gsg where id_externo = $1', [idExterno]);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async guardar(m) {
      const { rowCount } = await pool.query(
        `insert ignore into mensajes_gsg (id_externo, tracking, usuario_id, usuario_nombre, rol, phone, wamid)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [m.idExterno, m.tracking, m.usuarioId, m.usuarioNombre, m.rol, m.phone, m.wamid],
      );
      return (rowCount ?? 0) > 0;
    },
  };
}

/** En memoria, para las pruebas (y para quien arranca sin base). */
export function crearMensajesGsgEnMemoria(): MensajesGsgRepo {
  const filas = new Map<string, MensajeGsg>();
  return {
    async porIdExterno(idExterno) {
      return filas.get(idExterno) ?? null;
    },
    async guardar(m) {
      if (filas.has(m.idExterno)) return false;
      filas.set(m.idExterno, { ...m, createdAt: new Date() });
      return true;
    },
  };
}
