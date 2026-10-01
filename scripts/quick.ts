/**
 * Arranque corto: WhatsApp de verdad, sin montar nada.
 *
 * El servidor real y el cliente real, contra el MySQL/MariaDB de esta maquina
 * (en Windows, el de XAMPP: root sin clave en 127.0.0.1:3306), y con las
 * colas en memoria en vez de en Redis.
 *
 *   npm run quick        y luego /registro (o /login), escanear el QR, listo
 *
 * La base por defecto es mysql://root@127.0.0.1:3306/gsgchat; otra con
 * DATABASE_URL en el entorno o en el .env. Las tablas se crean solas.
 *
 * Es una PLATAFORMA de tiendas (ver src/plataforma): cualquiera se registra en
 * /registro y cada registro es una tienda nueva, con su base (gsgchat_t_<id>),
 * su WhatsApp y sus carpetas en `.wa-tiendas/<id>/`. La instalacion de antes
 * (la base gsgchat, `.wa-auth`, `.wa-media`) sigue tal cual como la tienda
 * "principal", con sus cuentas, su numero vinculado y sus integraciones.
 *
 * Todo persiste entre reinicios. Es para probar en una maquina, no para
 * produccion: un solo proceso y sin Redis.
 */

import path from 'node:path';

// Una promesa suelta que falle no puede apagar el sistema entero: se apunta
// y se sigue. El 16 de septiembre de 2026 un ENOENT al guardar la
// vinculacion (la carpeta la habia borrado un cierre tardio) tumbo el
// servidor mientras el usuario escaneaba el QR.
process.on('unhandledRejection', (razon) => {
  console.error('[sistema] fallo sin atender (se sigue):', razon);
});
process.on('uncaughtException', (error) => {
  console.error('[sistema] error inesperado (se sigue):', error);
});

import { avisoDireccionPublica, loadConfig } from '../src/config.js';
import { bootstrapSecrets } from '../src/settings/crypto.js';
import { comprobarServidorDeBase, explicarErrorDeBase, secretsDirectory } from '../src/runtime.js';
import { baseDeLaUrl } from '../src/db/pool.js';
import { existeBase } from '../src/db/bases.js';
import { defaultAuthDir } from '../src/whatsapp/local/session.js';
import { mediaDirectory } from '../src/whatsapp/local/media.js';
import { carpetaDeCopiasPorDefecto } from '../src/respaldo/servicio.js';
import { basesDeLaPlataforma, crearPlataforma } from '../src/plataforma/plataforma.js';
import { crearServidorPlataforma } from '../src/plataforma/servidor.js';

const PORT = Number(process.env.PORT ?? 3000);
// La direccion con la que se arman los enlaces que salen por WhatsApp (la
// pagina del motorizado, la evidencia) y la que ve GSG. Si el .env trae
// PUBLIC_BASE_URL (el dominio https de produccion o un tunel), manda esa; si
// no, localhost, como siempre: solo abre en esta maquina y se avisa abajo.
const BASE = (process.env.PUBLIC_BASE_URL?.trim() || `http://localhost:${PORT}`).replace(/\/+$/, '');
// Donde escucha: solo esta maquina (lo de siempre; un proxy https delante la
// publica) salvo que HOST diga otra cosa (0.0.0.0 = toda la red).
const HOST = process.env.HOST?.trim() || '127.0.0.1';
// La base: la de DATABASE_URL si la hay (entorno o .env), si no la de XAMPP.
const DATABASE_URL = process.env.DATABASE_URL?.trim() || 'mysql://root@127.0.0.1:3306/gsgchat';
if (!/^(mysql|mariadb):\/\//i.test(DATABASE_URL)) {
  console.error(
    `\n  No se puede arrancar: DATABASE_URL es «${DATABASE_URL.replace(/\/\/[^@/]*@/, '//…@')}» y GSGchat ahora guarda todo en MySQL/MariaDB.\n` +
      '  Bórrala del .env (se usa la de XAMPP: mysql://root@127.0.0.1:3306/gsgchat) o pon la de tu servidor: mysql://usuario:clave@host:3306/gsgchat\n',
  );
  process.exit(1);
}
const TIENDAS_DIR = process.env.TIENDAS_DIR ?? path.join(process.cwd(), '.wa-tiendas');

// El mismo .secrets.json que el arranque de verdad: asi la clave que cifra
// las credenciales de la principal no cambia cada vez.
const secrets = bootstrapSecrets(secretsDirectory());

/** El entorno de la tienda principal: el de siempre del arranque corto. */
const envPrincipal = {
  // Primero el entorno (y el .env, que config.ts carga con dotenv): asi las
  // variables de ritmo, salud y rutas (RITMO_*, SALUD_*, RUTAS_*, HORARIO_*)
  // tambien mandan en el arranque corto.
  ...process.env,
  PORT: String(PORT),
  PUBLIC_BASE_URL: BASE,
  DATABASE_URL,
  // Ni Meta ni contenedor: el cliente corre dentro de este proceso.
  WHATSAPP_PROVIDER: 'local',
  TRACKING_SECRET: secrets.trackingSecret,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? '',
  // La zona que se atiende. Vacio o sin definir significa "no acotar": una
  // caja equivocada rechaza ubicaciones perfectamente validas, que es peor que
  // no comprobar nada. Valores: lima (Lima y Callao), mexico, none.
  GEO_BBOX: process.env.GEO_BBOX?.trim() || 'none',
  // Como se presenta la tienda y que contesta a "¿a que hora atienden?".
  BUSINESS_NAME: process.env.BUSINESS_NAME?.trim() || 'nuestra tienda',
  BUSINESS_HOURS: process.env.BUSINESS_HOURS?.trim() || 'lunes a sabado de 9:00 a 19:00',
  COVERAGE_NAME: process.env.COVERAGE_NAME?.trim() || '',
  TIMEZONE: process.env.TIMEZONE?.trim() || 'America/Lima',
  // El arranque corto es para probar: se permite simular entrantes.
  DEV_SIMULATE_INBOUND: 'true',
  // Se espera 4 s a que el cliente termine de escribir: quien manda tres
  // trozos seguidos recibe UNA respuesta, no tres.
  RAFAGA_MS: process.env.RAFAGA_MS ?? '4000',
  // El catalogo de Stoky: precios y stock salen de ahi, no de una copia.
  STOKY_URL: process.env.STOKY_URL?.trim() || '',
  STOKY_TOKEN: process.env.STOKY_TOKEN?.trim() || '',
  // El panel al que se manda a registrar la venta, que no es la misma URL
  // que la API en cuanto Stoky corre detras de un proxy.
  STOKY_PANEL_URL: process.env.STOKY_PANEL_URL?.trim() || '',
} as NodeJS.ProcessEnv;
// Se valida ya: un .env roto se dice aqui y no a mitad de arranque.
const configPrincipal = loadConfig(envPrincipal);
const avisoPublico = avisoDireccionPublica(BASE);

// Sin MySQL no hay nada que hacer: se dice que falta y como arreglarlo.
const sinBase = await comprobarServidorDeBase(DATABASE_URL);
if (sinBase) {
  console.error(`\n  No se puede arrancar: ${sinBase}\n`);
  process.exit(1);
}

// La tienda de siempre existe si esta maquina ya tenia su base (la de la URL).
const BASE_PRINCIPAL = baseDeLaUrl(DATABASE_URL)!;
const hayPrincipal = await existeBase(DATABASE_URL, BASE_PRINCIPAL);

// Donde van las copias de seguridad: COPIAS_DIR si esta (la de cada tienda
// nueva es COPIAS_DIR/<su nombre>); si no, la carpeta de siempre.
const CARPETA_COPIAS = process.env.COPIAS_DIR?.trim() || carpetaDeCopiasPorDefecto();

/** Un fallo de la base al arrancar: se explica y se termina. */
function sinArrancar(error: unknown): never {
  console.error(`\n  No se puede arrancar: ${explicarErrorDeBase(error, DATABASE_URL)}\n`);
  process.exit(1);
}

const plataforma = await crearPlataforma({
  raiz: TIENDAS_DIR,
  publicBaseUrl: BASE,
  proceso: process.env,
  // Lo mismo que el arranque corto le da a la principal: simular entrantes y
  // esperar a que el cliente termine de escribir.
  extraTiendas: { DEV_SIMULATE_INBOUND: 'true', RAFAGA_MS: process.env.RAFAGA_MS ?? '4000', TIMEZONE: configPrincipal.timezone },
  base: { url: DATABASE_URL },
  redisUrl: null,
  principal: hayPrincipal
    ? {
        env: envPrincipal,
        secretos: secrets,
        base: { url: DATABASE_URL },
        authDir: defaultAuthDir(),
        mediaDir: mediaDirectory(),
        carpetaCopias: CARPETA_COPIAS,
        redisUrl: null,
        autoConectarLocal: true,
        sembrarPlantillasLocales: true,
        logger: false,
        prefijoLog: '',
      }
    : null,
  logger: false,
  // Con la vinculacion guardada, la sesion de cada tienda se reabre sola.
  autoConectarLocal: true,
  // El catalogo local hace de catalogo aprobado: sin Meta no hay a quien pedir permiso.
  sembrarPlantillasLocales: true,
  carpetaCopias: CARPETA_COPIAS,
}).catch(sinArrancar);
await plataforma.arrancar().catch(sinArrancar);

const servidor = await crearServidorPlataforma({ plataforma, segura: BASE.startsWith('https://') });
await servidor.escuchar(PORT, HOST);

async function apagar(): Promise<void> {
  await servidor.cerrar().catch(() => undefined);
  await plataforma.parar().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void apagar());
process.on('SIGTERM', () => void apagar());

const tiendas = await plataforma.directorio.tiendas();
console.log(`
  GSGchat - plataforma de tiendas (MySQL/MariaDB, WhatsApp de verdad)

  Entrar           ${BASE}/login
  Crear una tienda ${BASE}/registro   (cada registro es una tienda nueva e independiente)

  Tiendas: ${tiendas.length ? tiendas.map((t) => `${t.nombre} (${t.principal ? 'principal' : `/tienda/${t.slug}`})`).join(', ') : 'ninguna todavía'}

  Cada tienda conecta SU WhatsApp desde su panel (Conexión → escanear el QR).
  Base                    ${BASE_PRINCIPAL} en ${servidorDe(DATABASE_URL)} (tiendas nuevas: ${basesDeLaPlataforma(DATABASE_URL).raiz}_t_<id>)
  Vinculación principal   ${defaultAuthDir()}
  Carpetas de las tiendas ${TIENDAS_DIR}
${avisoPublico ? `\n  ⚠ Dirección pública: ${avisoPublico}\n    (Para pruebas en esta PC está bien; para producción mira docs/PASO-A-PRODUCCION.md.)\n` : ''}${
  configPrincipal.soloNumeros.length
    ? `\n  ⚠ MODO PRUEBA (SOLO_NUMEROS en el .env): solo se escribe a ${configPrincipal.soloNumeros.join(', ')}.\n    Para atender a los clientes de verdad, deja SOLO_NUMEROS vacío y reinicia.\n`
    : ''
}`);

/** "127.0.0.1:3306" (sin usuario ni clave: esto se ve en la consola). */
function servidorDe(url: string): string {
  const u = new URL(url.replace(/^mariadb:/i, 'mysql:'));
  return `${u.hostname || 'localhost'}:${u.port || '3306'}`;
}
