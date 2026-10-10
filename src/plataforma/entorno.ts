/**
 * Lo que una tienda nueva hereda del servidor, y lo que NO.
 *
 * El `.env` de siempre es el de la tienda principal: ahi estan su token de
 * Meta, el de GSG, el de Stoky, su supervisor, su modo prueba y su plan. Si
 * una tienda nueva leyera ese entorno entero, mandaria con el numero de otra,
 * avisaria al supervisor de otra y le pediria pedidos a GSG en su nombre. Por
 * eso a las tiendas nuevas solo pasa una lista cerrada de ajustes del
 * servidor (versiones, zona horaria, comportamiento del cliente de WhatsApp),
 * y todo lo suyo lo configuran ellas desde su pantalla.
 */

import path from 'node:path';

/** Lo del servidor que vale igual para cualquier tienda. Nada de credenciales ni de numeros. */
export const HEREDABLES = [
  'GRAPH_API_VERSION',
  'WHATSAPP_NATIVE_BUTTONS',
  'HUMANIZAR',
  'RAFAGA_MS',
  'DEV_SIMULATE_INBOUND',
  'TIMEZONE',
  'RUTAS_PAIS',
  'OPT_IN_KEYWORDS',
  'OPT_OUT_KEYWORDS',
  'TRACKING_TTL_MINUTES',
  'NODE_ENV',
] as const;

export interface DatosDeEntorno {
  /** La URL publica de la tienda: la de la plataforma + /tienda/<slug>. */
  publicBaseUrl: string;
  /** pglite://<carpeta> o la URL de Postgres (el esquema va aparte). */
  databaseUrl: string;
  trackingSecret: string;
  archiveDir: string;
  nombre: string;
}

export function entornoDeTienda(proceso: NodeJS.ProcessEnv, datos: DatosDeEntorno, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const clave of HEREDABLES) {
    const valor = proceso[clave];
    if (valor !== undefined && valor !== '') env[clave] = valor;
  }
  return {
    ...env,
    ...extra,
    PUBLIC_BASE_URL: datos.publicBaseUrl,
    DATABASE_URL: datos.databaseUrl,
    TRACKING_SECRET: datos.trackingSecret,
    ARCHIVE_DIR: datos.archiveDir,
    BUSINESS_NAME: datos.nombre,
    // Una tienda nueva empieza por el camino corto: escanear su QR. Si
    // quiere la API oficial de Meta, pega SUS credenciales en Conexion.
    WHATSAPP_PROVIDER: 'local',
    // Sin caja de coordenadas: una caja equivocada rechaza ubicaciones buenas.
    GEO_BBOX: 'none',
  };
}

/** Palabras que no pueden ser el nombre de una tienda en la URL. */
const RESERVADOS = new Set(['admin', 'api', 'login', 'logout', 'registro', 'plataforma', 'principal', 'tienda', 'tiendas', 'www', 'static', 'webhooks', 'soporte']);

/** "Bodega Doña Rosa" -> "bodega-dona-rosa". */
export function slugDe(nombre: string): string {
  const base = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  if (!base || RESERVADOS.has(base)) return `tienda${base ? `-${base}` : ''}`;
  return base;
}

/** Un slug valido en la URL (lo que se acepta en /tienda/<slug>/). */
export function pareceSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug);
}

/** Donde guarda sus cosas una tienda nueva, dentro de la raiz de la plataforma. */
export interface LugarDeTienda {
  dir: string;
  datos: string;
  vinculacion: string;
  medios: string;
  respaldos: string;
}

export function lugarDeTienda(raiz: string, id: string): LugarDeTienda {
  const dir = path.join(raiz, id);
  return {
    dir,
    datos: path.join(dir, 'datos'),
    vinculacion: path.join(dir, 'vinculacion'),
    medios: path.join(dir, 'medios'),
    respaldos: path.join(dir, 'respaldos'),
  };
}
