/**
 * Punto de entrada: servidor HTTP + worker de la cola en el mismo proceso.
 *
 * Arranca aunque no haya credenciales de WhatsApp: en ese caso levanta igual
 * y las pide por pantalla en /setup. Los secretos propios (token de admin,
 * firma de los enlaces de rastreo) se generan solos la primera vez y quedan
 * en .secrets.json, para no obligar a editar un .env a mano. Las migraciones
 * pendientes se aplican al arrancar, asi que `npm run migrate` es opcional.
 */

import { createRuntime } from './runtime.js';
import { providerOf } from './settings/service.js';
import { createSender, type SendJob, type SendOutcome } from './outbound/sender.js';
import { createOutboundQueue, createOutboundWorker, redisReachable } from './outbound/queue.js';
import { createMemoryOutboundQueue } from './outbound/memory-queue.js';
import { buildServer } from './server.js';
import { startScheduler } from './automation/engine.js';

const runtime = await createRuntime({ migrate: true });
const { config, repos, settings, wa } = runtime;

const sender = createSender({
  repos,
  wa,
  // Funcion, no valor: el numero puede cambiar desde /setup sin reiniciar.
  phoneNumberId: () => settings.current().phoneNumberId,
  warmup: {
    startPerDay: config.WARMUP_START_PER_DAY,
    growth: config.WARMUP_GROWTH,
    hardCap: config.DAILY_SEND_CAP,
  },
  maxMarketingPerContact7d: config.MAX_MARKETING_PER_CONTACT_7D,
  // La ventana de 24 h la impone Meta; fuera de la Cloud API no existe.
  serviceWindowApplies: () => providerOf(settings.current()) === 'cloud',
});

// Sin Redis se usa la cola en memoria en vez de no arrancar. Se avisa fuerte:
// es una degradacion real (no sobrevive al reinicio), no un modo equivalente.
const conRedis = await redisReachable(config.REDIS_URL);

const onResult = (job: SendJob, outcome: SendOutcome): void => {
  if (outcome.ok) return;
  // Los bloqueos por gate no son errores del sistema: son la senal de que
  // la lista o el estado del numero no permiten ese envio.
  const detail = outcome.blocked ? `${outcome.code}: ${outcome.reason}` : outcome.error;
  app.log.warn({ phone: job.phone, detail }, 'envio no realizado');
};

const queue = conRedis
  ? createOutboundQueue(config.REDIS_URL)
  : createMemoryOutboundQueue({ sender, onResult: (job, outcome) => onResult(job, outcome) });

const app = await buildServer({ config, repos, settings, wa, sender, queue });

const worker = conRedis
  ? createOutboundWorker({ redisUrl: config.REDIS_URL, sender, queue, onResult })
  : null;

// Seguimientos y mensajes programados: se procesan cada 10 s.
const stopScheduler = startScheduler({
  repos,
  sender,
  log: (message, detail) => app.log.warn(detail ?? {}, message),
});

await app.listen({ port: config.PORT, host: '0.0.0.0' });

const missing = settings.missing();
console.log(`
  wa-locator en http://localhost:${config.PORT}
${runtime.migrated.length ? `\n  Migraciones aplicadas: ${runtime.migrated.join(', ')}\n` : ''}
  ${missing.length ? `Configuracion pendiente  http://localhost:${config.PORT}/setup  (faltan: ${missing.join(', ')})` : `Panel  http://localhost:${config.PORT}/panel`}

  Token de administracion: ${config.ADMIN_TOKEN}
  (guardado en .secrets.json; pegalo cuando la web te lo pida)
${
  conRedis
    ? ''
    : `
  ⚠ Sin Redis en ${config.REDIS_URL}: la cola va en memoria.
    Funciona, pero lo encolado y no enviado se pierde si reinicias.
    Para produccion levanta Redis y reinicia.
`
}`);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'cerrando');
  stopScheduler();
  await worker?.close();
  await queue.close();
  await app.close();
  await runtime.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
