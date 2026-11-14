/**
 * Las lineas de WhatsApp de una tienda (hasta 8).
 *
 * La linea PRINCIPAL es la conexion de siempre: sus credenciales siguen en
 * `settings` (ver src/settings/service.ts) y su fila en `whatsapp_numbers`
 * solo la identifica. Las demas guardan las suyas cifradas en `credentials`.
 * El tope de ocho se comprueba aqui, dentro de un cerrojo de la base, para
 * que dos altas simultaneas no puedan dejar una novena.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from '../db/pool.js';
import { decrypt, encrypt } from '../settings/crypto.js';
import type { Provider } from '../settings/service.js';
import { validarLimiteDiario } from './limite-diario.js';
import { CLAVE_MODO_LINEAS, esModoLineas, MODO_LINEAS_POR_DEFECTO, type ModoLineas } from './modo-lineas.js';

export const MAX_LINEAS = 8;
export const ID_LINEA_PRINCIPAL = '00000000-0000-0000-0000-000000000001';

export type EstadoLinea = 'conectado' | 'desconectado' | 'esperando_qr' | 'caido';

export interface Linea {
  id: string;
  etiqueta: string;
  /** Digitos, sin +. Vacio mientras no se sepa. */
  telefono: string;
  proveedor: Provider;
  /** phone_number_id de Meta o nombre de sesion de WAHA; null en el cliente local. */
  idExterno: string | null;
  estado: EstadoLinea;
  principal: boolean;
  habilitada: boolean;
  posicion: number;
  /** Maximo de mensajes por dia (de Lima). 0 = sin limite. */
  limiteDiario: number;
}

/** Lo que se puede guardar de las credenciales de una linea que no es la principal. */
export interface CredencialesLinea {
  token?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  wahaUrl?: string;
  wahaApiKey?: string;
  wahaSession?: string;
  /** Solo la API oficial: con que se firma y se verifica el webhook de Meta de esta linea. */
  appSecret?: string;
  verifyToken?: string;
}

export class LineasError extends Error {
  constructor(
    readonly codigo: 'tope' | 'no_existe' | 'principal' | 'etiqueta' | 'proveedor' | 'duplicada',
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'LineasError';
  }
}

interface Fila {
  id: string;
  label: string;
  phone: string;
  provider: string;
  external_id: string | null;
  status: string;
  is_primary: boolean;
  enabled: boolean;
  position: number;
  daily_limit?: number | null;
}

const COLUMNAS = 'id, label, phone, provider, external_id, status, is_primary, enabled, position, daily_limit';

function aLinea(f: Fila): Linea {
  return {
    id: f.id,
    etiqueta: f.label,
    telefono: f.phone,
    proveedor: f.provider === 'waha' ? 'waha' : f.provider === 'cloud' ? 'cloud' : 'local',
    idExterno: f.external_id,
    estado: (['conectado', 'desconectado', 'esperando_qr', 'caido'] as const).find((e) => e === f.status) ?? 'desconectado',
    principal: Boolean(f.is_primary),
    habilitada: Boolean(f.enabled),
    posicion: f.position,
    limiteDiario: Number(f.daily_limit ?? 0),
  };
}

function limpiarEtiqueta(texto: string): string {
  const etiqueta = texto.trim().replace(/\s+/g, ' ');
  if (!etiqueta) throw new LineasError('etiqueta', 'La linea necesita un nombre.');
  if (etiqueta.length > 80) throw new LineasError('etiqueta', 'El nombre de la linea no puede pasar de 80 caracteres.');
  return etiqueta;
}

export interface ServicioLineas {
  listar(): Promise<Linea[]>;
  obtener(id: string): Promise<Linea | null>;
  /** La principal; siempre existe (la crea la migracion). */
  principal(): Promise<Linea>;
  /** La linea que corresponde a un aviso de Meta (phone_number_id) o de WAHA (sesion). */
  porIdExterno(proveedor: Provider, idExterno: string): Promise<Linea | null>;
  crear(datos: { etiqueta: string; proveedor: Provider; telefono?: string; idExterno?: string | null; credenciales?: CredencialesLinea }): Promise<Linea>;
  renombrar(id: string, etiqueta: string): Promise<Linea>;
  /** Estado y, si se sabe, el numero real de la linea. */
  actualizarEstado(id: string, estado: EstadoLinea, telefono?: string): Promise<void>;
  /** Lo que se sabe de la linea por su sesion: estado, numero real y (la principal) proveedor. */
  sincronizar(id: string, datos: { estado?: EstadoLinea; telefono?: string; proveedor?: Provider }): Promise<void>;
  habilitar(id: string, habilitada: boolean): Promise<void>;
  /** Maximo de mensajes por dia. Vacio, null o 0 = sin limite; un negativo o un decimal se rechaza con `LimiteInvalido`. Devuelve el valor guardado. */
  fijarLimite(id: string, limite: unknown): Promise<number>;
  /** Quita una linea que no sea la principal. Sus mensajes viejos conservan su etiqueta. */
  eliminar(id: string): Promise<void>;
  credenciales(id: string): Promise<CredencialesLinea>;
  /**
   * La linea que la tienda eligio como principal («Hacer principal»). Es la
   * principal DE USO: la que se rotula y se prefiere cuando la del cliente esta
   * caida. La conexion de /setup (`principal: true`, id fijo) no se mueve: su
   * sesion, sus credenciales y sus mensajes viejos siguen donde estaban.
   * Sin eleccion (o si la elegida ya no existe o esta deshabilitada), la de /setup.
   */
  preferida?(): Promise<string>;
  /** Fija la principal de uso. Solo una linea que exista y este habilitada. */
  fijarPreferida?(id: string): Promise<Linea>;
  /** Que lineas usa la tienda: normales, API o las dos (ver src/whatsapp/modo-lineas.ts). */
  modo?(): Promise<ModoLineas>;
  fijarModo?(modo: ModoLineas): Promise<ModoLineas>;
  /** Cambia las credenciales de una linea que no es la principal (las que falten se conservan). */
  fijarCredenciales?(id: string, credenciales: CredencialesLinea): Promise<Linea>;
}

/** No empieza por `whatsapp.`: esas claves las lee el servicio de ajustes como credenciales. */
export const CLAVE_LINEA_PREFERIDA = 'lineas.principal_de_uso';

export function crearServicioLineas(pool: Pool, claveCifrado: Buffer, base: string): ServicioLineas {
  /**
   * La migracion siembra la principal, pero una base de tienda nueva sale de
   * un banco vaciado (ver src/db/bases.ts) y llega sin esa fila: se garantiza aqui.
   */
  let principalLista = false;
  async function asegurarPrincipal(): Promise<void> {
    if (principalLista) return;
    await pool.query(
      `insert ignore into whatsapp_numbers (id, label, provider, is_primary, position) values ($1, 'Principal', 'local', 1, 0)`,
      [ID_LINEA_PRINCIPAL],
    );
    principalLista = true;
  }

  async function obtener(id: string): Promise<Linea | null> {
    await asegurarPrincipal();
    const { rows } = await pool.query<Fila>(`select ${COLUMNAS} from whatsapp_numbers where id = $1`, [id]);
    return rows[0] ? aLinea(rows[0]) : null;
  }

  async function exigir(id: string): Promise<Linea> {
    const linea = await obtener(id);
    if (!linea) throw new LineasError('no_existe', 'Esa linea no existe.');
    return linea;
  }

  // En memoria: se consulta en cada envio que necesita alternativa. Un proceso
  // por tienda, y quien la cambia es este mismo servicio.
  let preferidaGuardada: string | null | undefined;
  async function leerPreferida(): Promise<string | null> {
    if (preferidaGuardada !== undefined) return preferidaGuardada;
    try {
      const { rows } = await pool.query<{ value: string }>('select value from settings where `key` = $1', [CLAVE_LINEA_PREFERIDA]);
      preferidaGuardada = rows[0]?.value?.trim() || null;
    } catch {
      // Sin tabla de ajustes (bases de prueba): la de siempre, sin cachear el fallo.
      return null;
    }
    return preferidaGuardada;
  }

  // Igual que la preferida: se consulta en cada envio y solo lo cambia este servicio.
  let modoGuardado: ModoLineas | undefined;
  async function leerModo(): Promise<ModoLineas> {
    if (modoGuardado) return modoGuardado;
    try {
      const { rows } = await pool.query<{ value: string }>('select value from settings where `key` = $1', [CLAVE_MODO_LINEAS]);
      const valor = rows[0]?.value?.trim();
      modoGuardado = esModoLineas(valor) ? valor : MODO_LINEAS_POR_DEFECTO;
    } catch {
      return MODO_LINEAS_POR_DEFECTO;
    }
    return modoGuardado;
  }

  return {
    obtener,

    modo: leerModo,

    async fijarModo(modo) {
      if (!esModoLineas(modo)) throw new LineasError('proveedor', 'Ese modo no existe.');
      await pool.query(
        `insert into settings (\`key\`, value, encrypted, updated_at) values ($1,$2,false,now(3))
         on duplicate key update value = values(value), updated_at = now(3)`,
        [CLAVE_MODO_LINEAS, modo],
      );
      modoGuardado = modo;
      return modo;
    },

    async fijarCredenciales(id, nuevas) {
      const linea = await exigir(id);
      if (linea.principal) throw new LineasError('principal', 'Las credenciales de la línea principal se cambian en su tarjeta de Conexión.');
      const limpias = Object.fromEntries(Object.entries(nuevas).filter(([, v]) => typeof v === 'string' && v.trim() !== '')) as CredencialesLinea;
      const actuales = await leerCredenciales(id);
      const juntas: CredencialesLinea = { ...actuales, ...limpias };
      const idExterno = linea.proveedor === 'cloud' ? juntas.phoneNumberId ?? linea.idExterno : linea.proveedor === 'waha' ? juntas.wahaSession ?? linea.idExterno : null;
      if (idExterno && idExterno !== linea.idExterno) {
        const repetida = await pool.query('select 1 from whatsapp_numbers where provider = $1 and external_id = $2 and id <> $3 limit 1', [linea.proveedor, idExterno, id]);
        if (repetida.rowCount) throw new LineasError('duplicada', 'Ese número ya está registrado en otra línea.');
      }
      await pool.query('update whatsapp_numbers set credentials = $2, external_id = $3, updated_at = now(3) where id = $1', [
        id,
        encrypt(JSON.stringify(juntas), claveCifrado),
        idExterno ?? null,
      ]);
      return exigir(id);
    },

    async preferida() {
      const id = await leerPreferida();
      if (!id || id === ID_LINEA_PRINCIPAL) return ID_LINEA_PRINCIPAL;
      const linea = await obtener(id);
      return linea && linea.habilitada ? linea.id : ID_LINEA_PRINCIPAL;
    },

    async fijarPreferida(id) {
      const linea = await exigir(id);
      if (!linea.principal && !linea.habilitada) throw new LineasError('principal', 'Una línea deshabilitada no puede ser la principal: habilítala primero.');
      if (linea.principal) {
        await pool.query('delete from settings where `key` = $1', [CLAVE_LINEA_PREFERIDA]);
        preferidaGuardada = null;
      } else {
        await pool.query(
          `insert into settings (\`key\`, value, encrypted, updated_at) values ($1,$2,false,now(3))
           on duplicate key update value = values(value), updated_at = now(3)`,
          [CLAVE_LINEA_PREFERIDA, linea.id],
        );
        preferidaGuardada = linea.id;
      }
      return linea;
    },

    async listar() {
      await asegurarPrincipal();
      const { rows } = await pool.query<Fila>(`select ${COLUMNAS} from whatsapp_numbers order by is_primary desc, position, created_at`);
      return rows.map(aLinea);
    },

    async principal() {
      const linea = await obtener(ID_LINEA_PRINCIPAL);
      if (!linea) throw new Error('falta la linea principal: la migracion 016 no se aplico');
      return linea;
    },

    async porIdExterno(proveedor, idExterno) {
      if (!idExterno) return null;
      const { rows } = await pool.query<Fila>(
        `select ${COLUMNAS} from whatsapp_numbers where provider = $1 and external_id = $2 limit 1`,
        [proveedor, idExterno],
      );
      return rows[0] ? aLinea(rows[0]) : null;
    },

    async crear(datos) {
      const etiqueta = limpiarEtiqueta(datos.etiqueta);
      if (datos.proveedor === 'cloud' && !(datos.idExterno || datos.credenciales?.phoneNumberId)) {
        throw new LineasError('proveedor', 'Una linea de la API oficial necesita su Phone number ID.');
      }
      const idExterno =
        datos.idExterno ?? (datos.proveedor === 'cloud' ? datos.credenciales?.phoneNumberId : datos.proveedor === 'waha' ? datos.credenciales?.wahaSession : null) ?? null;

      // El cerrojo evita que dos altas a la vez vean «7» y las dos inserten.
      const cliente = await pool.connect();
      try {
        const cerrojo = await cliente.query<{ ok: number | null }>('select get_lock(?, 10) as ok', [`gsgchat_lineas_${base}`]);
        if (cerrojo.rows[0]?.ok !== 1) throw new Error('hay otra alta de linea en curso; reintenta');
        try {
          await asegurarPrincipal();
          const total = await cliente.query<{ n: number }>('select count(*) as n from whatsapp_numbers');
          if (Number(total.rows[0]?.n ?? 0) >= MAX_LINEAS) {
            throw new LineasError('tope', `Una tienda admite como maximo ${MAX_LINEAS} lineas de WhatsApp.`);
          }
          if (idExterno) {
            const repetida = await cliente.query('select 1 from whatsapp_numbers where provider = $1 and external_id = $2 limit 1', [datos.proveedor, idExterno]);
            if (repetida.rowCount) throw new LineasError('duplicada', 'Esa linea ya esta registrada.');
          }
          const id = randomUUID();
          const posicion = await cliente.query<{ n: number }>('select coalesce(max(position), 0) + 1 as n from whatsapp_numbers');
          const secretos = datos.credenciales && Object.keys(datos.credenciales).length ? encrypt(JSON.stringify(datos.credenciales), claveCifrado) : null;
          await cliente.query(
            `insert into whatsapp_numbers (id, label, phone, provider, external_id, status, is_primary, credentials, position)
             values ($1,$2,$3,$4,$5,'desconectado',0,$6,$7)`,
            [id, etiqueta, (datos.telefono ?? '').replace(/\D+/g, ''), datos.proveedor, idExterno, secretos, Number(posicion.rows[0]?.n ?? 1)],
          );
          // Se lee con la MISMA conexion: con otra, diez altas esperando el cerrojo agotarian el pool.
          const fila = await cliente.query<Fila>(`select ${COLUMNAS} from whatsapp_numbers where id = $1`, [id]);
          return aLinea(fila.rows[0]!);
        } finally {
          await cliente.query('select release_lock(?)', [`gsgchat_lineas_${base}`]).catch(() => undefined);
        }
      } finally {
        cliente.release();
      }
    },

    async renombrar(id, etiqueta) {
      await exigir(id);
      await pool.query('update whatsapp_numbers set label = $2, updated_at = now(3) where id = $1', [id, limpiarEtiqueta(etiqueta)]);
      return exigir(id);
    },

    async actualizarEstado(id, estado, telefono) {
      if (telefono) {
        await pool.query('update whatsapp_numbers set status = $2, phone = $3, updated_at = now(3) where id = $1', [id, estado, telefono.replace(/\D+/g, '')]);
      } else {
        await pool.query('update whatsapp_numbers set status = $2, updated_at = now(3) where id = $1', [id, estado]);
      }
    },

    async sincronizar(id, datos) {
      const sets: string[] = [];
      const params: unknown[] = [id];
      if (datos.estado) { params.push(datos.estado); sets.push(`status = $${params.length}`); }
      if (datos.telefono) { params.push(datos.telefono.replace(/\D+/g, '')); sets.push(`phone = $${params.length}`); }
      if (datos.proveedor) { params.push(datos.proveedor); sets.push(`provider = $${params.length}`); }
      if (!sets.length) return;
      // Solo toca updated_at si algo cambio de verdad: se llama cada pocos segundos.
      const cambia = sets.map((s) => s.replace(/ = \$(\d+)/, (_m, n) => ` <> $${n}`)).join(' or ');
      await pool.query(`update whatsapp_numbers set ${sets.join(', ')}, updated_at = now(3) where id = $1 and (${cambia})`, params);
    },

    async habilitar(id, habilitada) {
      await exigir(id);
      await pool.query('update whatsapp_numbers set enabled = $2, updated_at = now(3) where id = $1', [id, habilitada]);
    },

    async fijarLimite(id, limite) {
      const valor = validarLimiteDiario(limite);
      await exigir(id);
      await pool.query('update whatsapp_numbers set daily_limit = $2, updated_at = now(3) where id = $1', [id, valor]);
      return valor;
    },

    async eliminar(id) {
      const linea = await exigir(id);
      if (linea.principal) throw new LineasError('principal', 'La linea principal no se puede quitar.');
      await pool.query('delete from whatsapp_numbers where id = $1', [id]);
    },

    credenciales: leerCredenciales,
  };

  async function leerCredenciales(id: string): Promise<CredencialesLinea> {
    const { rows } = await pool.query<{ credentials: string | null }>('select credentials from whatsapp_numbers where id = $1', [id]);
    const guardado = rows[0]?.credentials;
    if (!guardado) return {};
    try {
      return JSON.parse(decrypt(guardado, claveCifrado)) as CredencialesLinea;
    } catch {
      // Clave rotada o dato corrupto: se trata como sin credenciales, no se tumba el arranque.
      return {};
    }
  }
}
