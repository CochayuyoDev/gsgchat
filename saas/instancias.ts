/**
 * El SaaS: una instancia de wa-locator por negocio.
 *
 * Cada cliente tiene su contenedor, su base de datos, su Redis, su numero de
 * WhatsApp y sus ficheros (vinculacion, adjuntos, respaldos). Nada se
 * comparte: una clave de la tienda 1 no abre nada de la tienda 2 porque son
 * servidores distintos. Lo unico comun es Postgres (una base por tienda) y
 * Caddy, que enruta por subdominio y saca el HTTPS solo.
 *
 *   tienda1.wa.tuservicio.com  ->  contenedor wa-tienda1  ->  base wa_tienda1
 *
 * Todo lo que hay que saber de una instancia vive en saas/instancias/<slug>:
 * su `.env`, su `compose.yml` y un `instancia.json` con lo basico. El alta y
 * la baja son funciones de aqui, y las usan tanto los CLIs (alta.ts,
 * baja.ts, estado.ts) como el panel maestro. Docker se llama por linea de
 * comandos: no hay que instalar nada mas que Docker y Node.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estadoPlan, guardarPlan, leerPlan, planInicial, type EstadoPlan, type PlanInstancia } from './planes.js';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const SAAS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(SAAS_DIR, '..');

/** Nombre del proyecto compose de la base (Caddy + Postgres). */
export const PROYECTO_BASE = 'wa-saas';
export const RED = 'wa-saas';
export const CONTENEDOR_POSTGRES = 'wa-saas-postgres';
export const CONTENEDOR_CADDY = 'wa-saas-caddy';
export const IMAGEN = 'wa-locator:latest';

// ------------------------------------------------------------ configuracion

export interface ConfigSaas {
  /** "wa.tuservicio.com": cada tienda es un subdominio. "localhost" para probar. */
  dominioBase: string;
  postgresPassword: string;
  /** El pais por defecto de las tiendas nuevas (plan de numeracion). */
  pais: 'peru' | 'mexico' | 'generico';
  zonaHoraria: string;
  geoBbox: 'lima' | 'mexico' | 'none';
  maestroUsuario: string;
  maestroClave: string;
  maestroPuerto: number;
}

/** Lee saas/.env (KEY=valor, una por linea). Lo que falte toma su valor por defecto. */
export function leerConfigSaas(dir = SAAS_DIR, env: NodeJS.ProcessEnv = process.env): ConfigSaas {
  const fichero = path.join(dir, '.env');
  const valores: Record<string, string> = {};
  if (existsSync(fichero)) {
    for (const linea of readFileSync(fichero, 'utf8').split(/\r?\n/)) {
      const l = linea.trim();
      if (!l || l.startsWith('#')) continue;
      const i = l.indexOf('=');
      if (i <= 0) continue;
      valores[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  const v = (k: string, porDefecto: string) => env[k]?.trim() || valores[k] || porDefecto;
  const pais = v('PAIS', 'peru');
  const bbox = v('GEO_BBOX', 'none');
  return {
    dominioBase: v('DOMINIO_BASE', 'localhost').toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    postgresPassword: v('POSTGRES_PASSWORD', 'wa'),
    pais: pais === 'mexico' || pais === 'generico' ? pais : 'peru',
    zonaHoraria: v('TIMEZONE', 'America/Lima'),
    geoBbox: bbox === 'lima' || bbox === 'mexico' ? bbox : 'none',
    maestroUsuario: v('MAESTRO_USUARIO', 'maestro'),
    maestroClave: v('MAESTRO_CLAVE', ''),
    maestroPuerto: Number(v('MAESTRO_PUERTO', '3900')) || 3900,
  };
}

/** "localhost" y "*.localhost" van sin TLS: Caddy no puede pedir un certificado para eso. */
export function esLocal(dominioBase: string): boolean {
  const host = dominioBase.replace(/:\d+$/, '');
  return host === 'localhost' || host.endsWith('.localhost') || /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}

/** El puerto HTTP que escucha Caddy: el que lleve el dominio base ("localhost:8080"), o el 80. */
export function puertoHttp(dominioBase: string): number {
  const m = /:(\d+)$/.exec(dominioBase);
  return m ? Number(m[1]) : 80;
}

// ---------------------------------------------------------------- el slug

/** El identificador de la tienda: va en el subdominio, en el nombre del contenedor y en la base. */
export function slugValido(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$/.test(slug)) {
    return 'El nombre corto tiene que ser de 2 a 30 caracteres: minusculas, numeros y guiones, sin empezar ni terminar por guion.';
  }
  if (['maestro', 'www', 'api', 'caddy', 'postgres', 'redis', 'saas'].includes(slug)) return `"${slug}" esta reservado.`;
  return null;
}

export const contenedorDe = (slug: string) => `wa-${slug}`;
export const baseDe = (slug: string) => `wa_${slug.replace(/-/g, '_')}`;
export const dominioDe = (slug: string, cfg: ConfigSaas) => `${slug}.${cfg.dominioBase}`;
export const urlDe = (slug: string, cfg: ConfigSaas) => `${esLocal(cfg.dominioBase) ? 'http' : 'https'}://${dominioDe(slug, cfg)}`;
/** Donde pregunta la instancia por su plan: el maestro corre en el host. */
export const urlPlanDe = (slug: string, cfg: ConfigSaas) => `http://host.docker.internal:${cfg.maestroPuerto}/api/plan/${slug}`;

// ------------------------------------------------------------ los ficheros

export interface OpcionesAlta {
  /** Como se llama el negocio de cara a sus clientes. */
  nombre?: string;
  /** cloud | local | waha. Por defecto cloud (API oficial de Meta); los QR son para pruebas. */
  proveedor?: 'cloud' | 'local' | 'waha';
  pais?: ConfigSaas['pais'];
  /** Variables extra para el .env de esa instancia (GOOGLE_MAPS_API_KEY, STOKY_URL...). */
  extra?: Record<string, string>;
  /** El plan con el que nace (por defecto la prueba de 14 dias). */
  plan?: PlanInstancia;
}

export interface Instancia {
  slug: string;
  nombre: string;
  dominio: string;
  url: string;
  proveedor: string;
  creadaEn: string;
}

export function generarEnv(slug: string, cfg: ConfigSaas, opts: OpcionesAlta = {}): string {
  const lineas: Record<string, string> = {
    PORT: '3000',
    PUBLIC_BASE_URL: urlDe(slug, cfg),
    DATABASE_URL: `postgres://wa:${cfg.postgresPassword}@${CONTENEDOR_POSTGRES}:5432/${baseDe(slug)}`,
    REDIS_URL: `redis://${contenedorDe(slug)}-redis:6379`,
    SECRETS_DIR: '/app/data',
    WHATSAPP_PROVIDER: opts.proveedor ?? 'cloud',
    BUSINESS_NAME: opts.nombre ?? slug,
    RUTAS_PAIS: opts.pais ?? cfg.pais,
    TIMEZONE: cfg.zonaHoraria,
    GEO_BBOX: cfg.geoBbox,
    ...(opts.plan ? { PLAN_URL: urlPlanDe(slug, cfg), PLAN_TOKEN: opts.plan.token } : {}),
    ...(opts.extra ?? {}),
  };
  return (
    `# Instancia "${slug}" del SaaS. Generado por saas/alta.ts; se puede editar y reiniciar.\n` +
    Object.entries(lineas)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') +
    '\n'
  );
}

export function generarCompose(slug: string): string {
  const c = contenedorDe(slug);
  return `# Instancia "${slug}": la app y su Redis. Postgres y Caddy son los del SaaS (saas/docker-compose.yml).
name: ${c}
services:
  app:
    image: ${IMAGEN}
    container_name: ${c}
    env_file: .env
    volumes:
      - datos:/app/data
      - wa-auth:/app/.wa-auth
      - wa-media:/app/.wa-media
      - respaldos:/app/respaldos
    depends_on:
      redis:
        condition: service_healthy
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    networks: [${RED}]
    restart: unless-stopped
  redis:
    image: redis:7-alpine
    container_name: ${c}-redis
    command: ['redis-server', '--appendonly', 'yes']
    volumes:
      - redis:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 10
    networks: [${RED}]
    restart: unless-stopped
volumes:
  datos:
  wa-auth:
  wa-media:
  respaldos:
  redis:
networks:
  ${RED}:
    external: true
`;
}

export function generarCaddy(slug: string, cfg: ConfigSaas): string {
  const host = esLocal(cfg.dominioBase) ? `http://${dominioDe(slug, cfg)}` : dominioDe(slug, cfg);
  return `# Instancia "${slug}". Generado por saas/alta.ts.
${host} {
	reverse_proxy ${contenedorDe(slug)}:3000
}
`;
}

/** El Caddyfile base: las instancias entran por `import`; el maestro corre en el host. */
export function generarCaddyfile(cfg: ConfigSaas): string {
  const maestro = esLocal(cfg.dominioBase) ? `http://maestro.${cfg.dominioBase}` : `maestro.${cfg.dominioBase}`;
  return `# Caddy del SaaS: un subdominio por tienda. Generado por saas/alta.ts.
# (La API de administracion de Caddy queda en localhost:2019 dentro del
# contenedor: es lo que usa "caddy reload" al dar de alta una tienda.)

import instancias/*.caddy

# El panel maestro corre en el host (npm run saas:maestro), no en un contenedor.
${maestro} {
	reverse_proxy host.docker.internal:${cfg.maestroPuerto}
}
`;
}

// ------------------------------------------------------------------ rutas

export const dirInstancias = (base = SAAS_DIR) => path.join(base, 'instancias');
export const dirInstancia = (slug: string, base = SAAS_DIR) => path.join(dirInstancias(base), slug);
export const dirCaddy = (base = SAAS_DIR) => path.join(base, 'caddy', 'instancias');

export function listarInstancias(base = SAAS_DIR): Instancia[] {
  const dir = dirInstancias(base);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, 'instancia.json')))
    .map((d) => JSON.parse(readFileSync(path.join(dir, d.name, 'instancia.json'), 'utf8')) as Instancia)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

// ----------------------------------------------------------------- docker

export interface Ejecutor {
  (comando: string, args: string[], opts?: { cwd?: string }): Promise<{ stdout: string; stderr: string }>;
}

export const ejecutarReal: Ejecutor = async (comando, args, opts) => {
  const r = await execFileAsync(comando, args, { cwd: opts?.cwd, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
  return { stdout: String(r.stdout), stderr: String(r.stderr) };
};

const psql = (ejecutar: Ejecutor, sql: string) =>
  ejecutar('docker', ['exec', CONTENEDOR_POSTGRES, 'psql', '-U', 'wa', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql]);

const recargarCaddy = (ejecutar: Ejecutor) =>
  ejecutar('docker', ['exec', CONTENEDOR_CADDY, 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile']);

export interface DepsSaas {
  cfg?: ConfigSaas;
  base?: string;
  ejecutar?: Ejecutor;
  log?: (linea: string) => void;
  ahora?: () => Date;
}

/** Levanta lo comun (Caddy + Postgres) y deja el Caddyfile al dia. Se puede repetir. */
export async function prepararBase(deps: DepsSaas = {}): Promise<void> {
  const cfg = deps.cfg ?? leerConfigSaas();
  const base = deps.base ?? SAAS_DIR;
  const ejecutar = deps.ejecutar ?? ejecutarReal;
  const log = deps.log ?? (() => undefined);

  mkdirSync(dirCaddy(base), { recursive: true });
  mkdirSync(dirInstancias(base), { recursive: true });
  writeFileSync(path.join(base, 'Caddyfile'), generarCaddyfile(cfg));
  // Caddy no acepta un `import` que no case con nada: un fichero vacio lo evita.
  const vacio = path.join(dirCaddy(base), '_vacio.caddy');
  if (!existsSync(vacio)) writeFileSync(vacio, '# Sin instancias todavia. Se generan con saas/alta.ts.\n');

  log('Levantando Caddy y Postgres del SaaS...');
  await ejecutar('docker', ['compose', '-f', path.join(base, 'docker-compose.yml'), '--env-file', path.join(base, '.env'), 'up', '-d', '--wait'], { cwd: base });
}

/** Construye la imagen de la app una vez; todas las instancias la comparten. */
export async function construirImagen(deps: DepsSaas = {}): Promise<void> {
  const ejecutar = deps.ejecutar ?? ejecutarReal;
  deps.log?.(`Construyendo la imagen ${IMAGEN}...`);
  await ejecutar('docker', ['build', '-t', IMAGEN, RAIZ], { cwd: RAIZ });
}

export async function altaInstancia(slug: string, opts: OpcionesAlta = {}, deps: DepsSaas = {}): Promise<Instancia> {
  const mal = slugValido(slug);
  if (mal) throw new Error(mal);
  const cfg = deps.cfg ?? leerConfigSaas();
  const base = deps.base ?? SAAS_DIR;
  const ejecutar = deps.ejecutar ?? ejecutarReal;
  const log = deps.log ?? (() => undefined);
  const dir = dirInstancia(slug, base);
  if (existsSync(path.join(dir, 'instancia.json'))) throw new Error(`La instancia "${slug}" ya existe.`);

  // 1. Su base de datos, en el Postgres comun.
  log(`Creando la base ${baseDe(slug)}...`);
  try {
    await psql(ejecutar, `create database ${baseDe(slug)}`);
  } catch (error) {
    // Si quedo de una baja sin --borrar-datos, se reutiliza: son sus datos.
    if (!/already exists|ya existe/i.test(String((error as { stderr?: string }).stderr ?? error))) throw error;
    log(`La base ${baseDe(slug)} ya existia: se reutiliza.`);
  }

  // 2. Sus ficheros.
  mkdirSync(dir, { recursive: true });
  const plan = opts.plan ?? planInicial(deps.ahora?.() ?? new Date());
  guardarPlan(dir, plan);
  writeFileSync(path.join(dir, '.env'), generarEnv(slug, cfg, { ...opts, plan }));
  writeFileSync(path.join(dir, 'compose.yml'), generarCompose(slug));
  const instancia: Instancia = {
    slug,
    nombre: opts.nombre ?? slug,
    dominio: dominioDe(slug, cfg),
    url: urlDe(slug, cfg),
    proveedor: opts.proveedor ?? 'cloud',
    creadaEn: (deps.ahora?.() ?? new Date()).toISOString(),
  };
  writeFileSync(path.join(dir, 'instancia.json'), JSON.stringify(instancia, null, 2) + '\n');

  // 3. Su contenedor (y su Redis).
  log(`Levantando ${contenedorDe(slug)}...`);
  await ejecutar('docker', ['compose', '-f', path.join(dir, 'compose.yml'), 'up', '-d', '--wait'], { cwd: dir });

  // 4. Su subdominio.
  mkdirSync(dirCaddy(base), { recursive: true });
  writeFileSync(path.join(dirCaddy(base), `${slug}.caddy`), generarCaddy(slug, cfg));
  log('Recargando Caddy...');
  await recargarCaddy(ejecutar);

  return instancia;
}

/**
 * Da plan a una instancia anterior a los planes: escribe su plan.json, le
 * pone PLAN_URL y PLAN_TOKEN en el .env y recrea el contenedor para que lo
 * lea. Si ya tenia plan, no toca nada.
 */
export async function iniciarPlan(slug: string, deps: DepsSaas = {}): Promise<PlanInstancia> {
  const mal = slugValido(slug);
  if (mal) throw new Error(mal);
  const cfg = deps.cfg ?? leerConfigSaas();
  const base = deps.base ?? SAAS_DIR;
  const ejecutar = deps.ejecutar ?? ejecutarReal;
  const dir = dirInstancia(slug, base);
  if (!existsSync(path.join(dir, 'instancia.json'))) throw new Error(`La instancia "${slug}" no existe.`);
  const ya = leerPlan(dir);
  if (ya) return ya;
  const plan = planInicial(deps.ahora?.() ?? new Date());
  guardarPlan(dir, plan);
  const envPath = path.join(dir, '.env');
  const env = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^PLAN_(URL|TOKEN)=/.test(l))
    .join('\n')
    .replace(/\n*$/, '\n');
  writeFileSync(envPath, `${env}PLAN_URL=${urlPlanDe(slug, cfg)}\nPLAN_TOKEN=${plan.token}\n`);
  deps.log?.(`${slug}: plan de prueba creado; recreando el contenedor para que lo lea...`);
  await ejecutar('docker', ['compose', '-f', path.join(dir, 'compose.yml'), 'up', '-d', '--wait'], { cwd: dir });
  return plan;
}

export async function bajaInstancia(slug: string, opciones: { borrarDatos?: boolean } = {}, deps: DepsSaas = {}): Promise<void> {
  const mal = slugValido(slug);
  if (mal) throw new Error(mal);
  const base = deps.base ?? SAAS_DIR;
  const ejecutar = deps.ejecutar ?? ejecutarReal;
  const log = deps.log ?? (() => undefined);
  const dir = dirInstancia(slug, base);
  if (!existsSync(path.join(dir, 'compose.yml'))) throw new Error(`La instancia "${slug}" no existe.`);

  // 1. Fuera del proxy: deja de recibir trafico antes de apagarse.
  const caddy = path.join(dirCaddy(base), `${slug}.caddy`);
  if (existsSync(caddy)) {
    rmSync(caddy);
    log('Recargando Caddy...');
    await recargarCaddy(ejecutar).catch(() => undefined);
  }

  // 2. Los contenedores. Con --borrar-datos, tambien sus volumenes.
  log(`Parando ${contenedorDe(slug)}...`);
  const args = ['compose', '-f', path.join(dir, 'compose.yml'), 'down', '--remove-orphans'];
  if (opciones.borrarDatos) args.push('--volumes');
  await ejecutar('docker', args, { cwd: dir });

  // 3. La base y los ficheros, solo si se pide: una baja normal deja los
  // datos por si el cliente vuelve (o por si hay que entregarselos).
  if (opciones.borrarDatos) {
    log(`Borrando la base ${baseDe(slug)}...`);
    await psql(ejecutar, `drop database if exists ${baseDe(slug)}`);
    rmSync(dir, { recursive: true, force: true });
  } else {
    rmSync(path.join(dir, 'instancia.json'), { force: true });
    writeFileSync(path.join(dir, 'BAJA.txt'), `Dada de baja el ${(deps.ahora?.() ?? new Date()).toISOString()}. La base ${baseDe(slug)} y los volumenes siguen; saas/baja.ts ${slug} --borrar-datos los quita.\n`);
  }
}

export interface EstadoInstancia extends Instancia {
  viva: boolean;
  configurado: boolean | null;
  detalle: string | null;
  /** Su plan de hoy (null si la instancia es anterior a los planes). */
  plan: EstadoPlan | null;
}

/** Pregunta a cada instancia por su /health, a traves de Caddy. */
export async function estadoInstancias(deps: { base?: string; fetchImpl?: typeof fetch; timeoutMs?: number; ahora?: () => Date } = {}): Promise<EstadoInstancia[]> {
  const doFetch = deps.fetchImpl ?? fetch;
  return Promise.all(
    listarInstancias(deps.base).map(async (i) => {
      const p = leerPlan(dirInstancia(i.slug, deps.base));
      const plan = p ? estadoPlan(p, deps.ahora?.() ?? new Date()) : null;
      try {
        const r = await doFetch(`${i.url}/health`, { signal: AbortSignal.timeout(deps.timeoutMs ?? 5000) });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; configured?: boolean; connected?: boolean };
        return { ...i, viva: r.ok && j.ok === true, configurado: (j.connected ?? j.configured) ?? null, detalle: r.ok ? null : `HTTP ${r.status}`, plan };
      } catch (error) {
        return { ...i, viva: false, configurado: null, detalle: error instanceof Error ? error.message : String(error), plan };
      }
    }),
  );
}
