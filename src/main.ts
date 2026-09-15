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
import { politicaDesdeConfig } from './salud/politica.js';
import { crearMonitor } from './salud/monitor.js';
import { arrancarServicios, resumenPolitica } from './servicios.js';
import { crearServicioAjustes } from './ajustes/generales.js';
import { crearServicioStickers } from './stickers/stickers.js';
import { mediaDirectory } from './whatsapp/local/media.js';
import { crearBus } from './eventos/bus.js';
import { observarRepos } from './eventos/observar.js';
import { crearServicioIA } from './ia/servicio.js';

const runtime = await createRuntime({ migrate: true });
const { config, settings, wa } = runtime;

// El bus de eventos: lo que pasa (llega un mensaje, se entrega, mandan la
// ubicacion) se anuncia una vez y los webhooks salientes lo reparten. Los
// repositorios se envuelven para que todo camino que escriba avise solo.
const bus = crearBus((m, d) => console.warn(m, d));
const repos = observarRepos(runtime.repos, bus);

// La politica de ritmo depende del proveedor: la oficial de Meta tiene tier y
// calidad; un cliente no oficial no, y ahi se va bastante mas despacio. Se
// calcula por llamada porque el proveedor puede cambiar desde /setup.
// Los ajustes generales (horario, ritmo, modo prueba, avisos, nombre) que se
// cambian desde la pantalla van encima de lo que diga el .env.
const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config });
const politica = () =>
  ajustes.politica(politicaDesdeConfig(config, providerOf(settings.current()) === 'cloud' ? 'cloud' : 'no_oficial'));

// El monitor de salud: mira errores, entregas, bajas y desconexiones cada
// minuto, frena o pausa solo, y le da al sender el marcapasos. El aviso al
// supervisor se conecta despues de crear el sender (el monitor avisa por el
// sender, y el sender consulta al monitor).
let avisarSupervisor: ((texto: string) => Promise<void>) | undefined;
// Sin Meta no hay id de numero: 'local' es la clave fija de esa fila.
const phoneNumberId = () => settings.current().phoneNumberId || 'local';

const salud = crearMonitor({
  repos,
  politica,
  phoneNumberId,
  avisar: (texto) => (avisarSupervisor ? avisarSupervisor(texto) : Promise.resolve()),
  // La cola se crea mas abajo; solo se toca cuando el monitor pausa o
  // reanuda, y para entonces ya existe.
  cola: { pause: () => queue.pause(), resume: () => queue.resume() },
});

const sender = createSender({
  repos,
  wa,
  // Funcion, no valor: el numero puede cambiar desde /setup sin reiniciar.
  phoneNumberId,
  warmup: politica().warmup,
  maxMarketingPerContact7d: config.MAX_MARKETING_PER_CONTACT_7D,
  // La ventana de 24 h la impone Meta; fuera de la Cloud API no existe.
  serviceWindowApplies: () => providerOf(settings.current()) === 'cloud',
  salud,
  politica,
  soloNumeros: () => ajustes.soloNumeros(),
});

// La biblioteca de stickers y los automaticos (tras el saludo, el gracias y
// la despedida). Los ficheros van a la carpeta de medios.
const stickers = crearServicioStickers({ repo: repos.stickers, mediaDir: mediaDirectory(), sender, ajustes, publicBase: config.PUBLIC_BASE_URL });

// El asistente de IA de la tienda: contesta con lo que la tienda escribio
// en "Mi asistente IA" y deriva a una persona cuando no puede. Ver src/ia.
const ia = await crearServicioIA({
  settingsRepo: runtime.settingsRepo,
  settingsKeyBase64: runtime.secrets.settingsKey,
  repos,
  sender,
  config,
  nombreNegocio: () => ajustes.nombreNegocio(),
  supervisor: () => politica().avisarA,
  conBoton: () => providerOf(settings.current()) === 'cloud' || config.WHATSAPP_NATIVE_BUTTONS,
  log: (m, d) => console.warn(m, d ?? ''),
});

if (ajustes.soloNumeros().length) {
  console.log(`
  MODO PRUEBA: solo se escribe a ${ajustes.soloNumeros().join(', ')} (se cambia en /panel#configuracion).
`);
}

avisarSupervisor = async (texto) => {
  const destino = politica().avisarA;
  if (!destino) return;
  // Manual a proposito: es un aviso de operacion a una persona conocida, no
  // una campana, y tiene que salir aunque el numero este frenado.
  await sender.send({ phone: destino, kind: 'freeform', category: 'UTILITY', text: texto, manual: true });
};

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

const app = await buildServer({ config, repos, settings, wa, sender, queue, salud, politica, ajustes, stickers, bus, ia, mediaDir: mediaDirectory(), autoConectarLocal: true });

const worker = conRedis
  ? createOutboundWorker({ redisUrl: config.REDIS_URL, sender, queue, onResult })
  : null;

// Todo lo que trabaja solo: monitor, secuencias, goteo, rutas, avisos, GSG.
const pararServicios = arrancarServicios({ config, repos, settings, wa, sender, salud, politica, ajustes, stickers, bus, log: app.log });

await app.listen({ port: config.PORT, host: '0.0.0.0' });

const missing = settings.missing();
console.log(`
  wa-locator en http://localhost:${config.PORT}
${runtime.migrated.length ? `\n  Migraciones aplicadas: ${runtime.migrated.join(', ')}\n` : ''}
  Entrar: http://localhost:${config.PORT}/login  (la primera vez, crea tu cuenta ahi mismo)
  ${missing.length ? `Configuracion pendiente  http://localhost:${config.PORT}/setup  (faltan: ${missing.join(', ')})` : `Panel  http://localhost:${config.PORT}/panel`}

  Integraciones (Stoky, GSG, scripts): claves de API y webhooks en http://localhost:${config.PORT}/panel#integraciones
  API publica: http://localhost:${config.PORT}/api/v1/openapi.json

  Ritmo: ${resumenPolitica(politica())}.
  Salud del numero: http://localhost:${config.PORT}/panel#salud
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
  pararServicios();
  await worker?.close();
  await queue.close();
  await app.close();
  await runtime.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
