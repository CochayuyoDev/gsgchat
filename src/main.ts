/**
 * Punto de entrada: la plataforma de tiendas, con servidor HTTP y colas en
 * el mismo proceso.
 *
 * Cada registro en /registro es una tienda nueva e independiente (ver
 * src/plataforma): con Postgres, cada una en su propio esquema (tienda_<id>);
 * con DATABASE_URL=pglite://..., cada una en su propia carpeta. Su WhatsApp,
 * sus adjuntos y sus secretos van en TIENDAS_DIR/<id>. La instalacion de
 * antes (la base de siempre, .wa-auth, .secrets.json) sigue como la tienda
 * "principal": a ella llega todo lo que no dice de que tienda es.
 *
 * Arranca aunque no haya credenciales de WhatsApp: cada tienda las pide por
 * pantalla en su /setup. Las migraciones pendientes se aplican al arrancar.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';

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

import { avisoDireccionPublica, loadConfig, type Config } from './config.js';
import { bootstrapSecrets } from './settings/crypto.js';
import { secretsDirectory } from './runtime.js';
import { redisReachable } from './outbound/queue.js';
import { defaultAuthDir } from './whatsapp/local/session.js';
import { mediaDirectory } from './whatsapp/local/media.js';
import { carpetaDeCopiasPorDefecto } from './respaldo/servicio.js';
import { crearPlataforma } from './plataforma/plataforma.js';
import { crearServidorPlataforma } from './plataforma/servidor.js';

// Sin configuracion valida no hay servidor: se dice que falta y se termina,
// en vez de quedarse vivo sin escuchar (Docker lo reiniciaria en bucle sin
// decir por que).
const secrets = bootstrapSecrets(secretsDirectory());
process.env.TRACKING_SECRET ??= secrets.trackingSecret;
let config: Config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`[sistema] no se puede arrancar: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const publicBase = config.PUBLIC_BASE_URL.replace(/\/+$/, '');
// No frena el arranque (la demo y las pruebas usan localhost), pero se dice
// fuerte: en produccion los enlaces por WhatsApp y los avisos de GSG la usan.
const avisoPublico = avisoDireccionPublica(publicBase);
const conPglite = config.DATABASE_URL.startsWith('pglite://');
const dirPrincipal = conPglite ? config.DATABASE_URL.slice('pglite://'.length) || '.wa-data' : null;
const tiendasDir = process.env.TIENDAS_DIR?.trim() || path.join(process.cwd(), '.wa-tiendas');

// Sin Redis se usa la cola en memoria en vez de no arrancar. Se avisa fuerte:
// es una degradacion real (no sobrevive al reinicio), no un modo equivalente.
const conRedis = await redisReachable(config.REDIS_URL);

// Donde van las copias de seguridad: COPIAS_DIR si esta (la de cada tienda
// nueva es COPIAS_DIR/<su nombre>); si no, la carpeta de siempre.
const CARPETA_COPIAS = process.env.COPIAS_DIR?.trim() || carpetaDeCopiasPorDefecto();

const plataforma = await crearPlataforma({
  raiz: tiendasDir,
  publicBaseUrl: publicBase,
  proceso: process.env,
  base: conPglite ? { tipo: 'pglite' } : { tipo: 'postgres', url: config.DATABASE_URL },
  redisUrl: conRedis ? config.REDIS_URL : null,
  // La principal: con PGlite, si su carpeta existe; con Postgres, siempre se
  // mira (la plataforma la aparca sola si no tiene ninguna cuenta).
  principal:
    !conPglite || existsSync(dirPrincipal!)
      ? {
          env: process.env,
          secretos: secrets,
          base: conPglite ? { tipo: 'pglite', dir: dirPrincipal! } : { tipo: 'postgres', url: config.DATABASE_URL },
          authDir: defaultAuthDir(),
          mediaDir: mediaDirectory(),
          carpetaCopias: CARPETA_COPIAS,
          redisUrl: conRedis ? config.REDIS_URL : null,
          autoConectarLocal: true,
          sembrarPlantillasLocales: false,
          logger: true,
          prefijoLog: '',
        }
      : null,
  logger: true,
  autoConectarLocal: true,
  // Las tiendas nuevas empiezan con el cliente local (QR): sin Meta, el
  // catalogo local hace de catalogo aprobado.
  sembrarPlantillasLocales: true,
  carpetaCopias: CARPETA_COPIAS,
});
await plataforma.arrancar();

const servidor = await crearServidorPlataforma({ plataforma, segura: publicBase.startsWith('https://') });
await servidor.escuchar(config.PORT, '0.0.0.0');

const tiendas = await plataforma.directorio.tiendas();
console.log(`
  GSGchat - plataforma de tiendas en ${publicBase}

  Entrar            ${publicBase}/login
  Crear una tienda  ${publicBase}/registro   (cada registro es una tienda nueva e independiente)

  Tiendas: ${tiendas.length ? tiendas.map((t) => `${t.nombre} (${t.principal ? 'principal' : `/tienda/${t.slug}`})`).join(', ') : 'ninguna todavía'}
  Base: ${conPglite ? `PGlite (una carpeta por tienda en ${tiendasDir})` : 'Postgres (un esquema por tienda: tienda_<id>)'}
${
  conRedis
    ? ''
    : `
  ⚠ Sin Redis en ${config.REDIS_URL}: las colas van en memoria.
    Funciona, pero lo encolado y no enviado se pierde si reinicias.
    Para produccion levanta Redis y reinicia.
`
}${avisoPublico ? `\n  ⚠ Dirección pública: ${avisoPublico}\n` : ''}${
  config.soloNumeros.length
    ? `\n  ⚠ MODO PRUEBA (SOLO_NUMEROS): solo se escribe a ${config.soloNumeros.join(', ')}.\n    Para atender a los clientes de verdad, deja SOLO_NUMEROS vacío en el .env y reinicia.\n`
    : ''
}`);

async function shutdown(signal: string): Promise<void> {
  console.log(`[sistema] cerrando (${signal})`);
  await servidor.cerrar().catch(() => undefined);
  await plataforma.parar().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
