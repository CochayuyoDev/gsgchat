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
import { crearServicioEntrenamiento, iaParaEntrenar } from './entrenamiento/servicio.js';
import { crearServicioVoz } from './voz/servicio.js';
import { crearConexionStoky } from './stoky/conexion.js';
import { crearConexionGsg, TOKEN_SIMULADOR } from './rutas/conexion-gsg.js';
import { crearGsgSimulado } from './entregas/gsg-simulado.js';
import { crearServicioEntregas } from './entregas/servicio.js';
import { crearServicioResumenes } from './resumenes/servicio.js';
import { cargarLote } from './rutas/cargar.js';
import { crearFiabilidad } from './salud/fiabilidad.js';
import { carpetaDeCopiasPorDefecto } from './respaldo/servicio.js';
import { getLocalState } from './whatsapp/local/session.js';
import { CABECERA_INTERNA, CABECERA_USUARIO_INTERNO } from './auth/routes.js';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { crearServicioEnvioAutomatico } from './envio-automatico/servicio.js';
import { opcionesDesdeConfig } from './rutas/motor.js';
import { PLANES } from './rutas/telefono.js';

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

import { crearServicioPlan, type EstadoInstancia } from './plan/servicio.js';
import { versionDelPaquete } from './util/version.js';

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

// La lista de numeros a los que el sistema escribe solo. Ver src/envio-automatico.
const lista = crearServicioEnvioAutomatico({
  repos,
  opcionesReparto: opcionesDesdeConfig(config),
  plan: PLANES[config.RUTAS_PAIS] ?? PLANES.peru!,
  salud,
  log: (m, d) => console.log(m, d ?? ''),
});
// El plan de esta tienda en el SaaS (vencimiento, topes). Sin PLAN_URL, libre. Ver src/plan.
// El parte de salud que esta instalacion le manda al maestro en cada consulta
// del plan (Tiendas lo enseña en palabras). Se completa mas abajo, cuando
// existen el monitor, la IA y las entregas.
const parteDeSalud: { dar: null | (() => Promise<EstadoInstancia>) } = { dar: null };
const plan = await crearServicioPlan({
  settingsRepo: runtime.settingsRepo,
  url: config.PLAN_URL,
  token: config.PLAN_TOKEN,
  log: (m, d) => console.warn(m, d ?? ''),
  estado: () => (parteDeSalud.dar ? parteDeSalud.dar() : { whatsapp: settings.isConfigured() ? 'conectado' : 'sin_conectar', mensajesHoy: 0, fallosIA: 0, entregasHoy: 0, version: versionDelPaquete() }),
});
const pararPlan = plan.arrancar();

// El asistente de IA de la tienda: contesta con lo que la tienda escribio
// en "Mi asistente IA" y deriva a una persona cuando no puede. Ver src/ia.
// La conexion con Stoky (catalogo, panel), configurable desde la pantalla. Ver src/stoky/conexion.ts.
const conexionStoky = await crearConexionStoky({ settingsRepo: runtime.settingsRepo, settingsKeyBase64: runtime.secrets.settingsKey, config, log: (m, d) => console.warn(`[stoky] ${m}`, d ?? '') });
const catalogo = conexionStoky.cliente();

// Lo que se le enseno al asistente a gran escala. Ver src/entrenamiento.
const entrenamiento = await crearServicioEntrenamiento({ repo: repos.entrenamiento, nombreNegocio: () => ajustes.nombreNegocio(), log: (m, d) => console.warn(`[entrenamiento] ${m}`, d ?? '') });
await entrenamiento.cargar();

// La voz del asistente (ElevenLabs): notas de voz y transcripcion. Ver src/voz.
const voz = await crearServicioVoz({ settingsRepo: runtime.settingsRepo, settingsKeyBase64: runtime.secrets.settingsKey, sender, mediaDir: mediaDirectory(), log: (m, d) => console.warn(`[voz] ${m}`, d ?? '') });

// La conexion con GSG (real o el simulador), configurable desde Entregas del dia. Ver src/rutas/conexion-gsg.ts.
const conexionGsg = await crearConexionGsg({ settingsRepo: runtime.settingsRepo, settingsKeyBase64: runtime.secrets.settingsKey, config, log: (m, d) => console.warn(`[gsg] ${m}`, d ?? '') });
const simuladorGsg = crearGsgSimulado({ token: TOKEN_SIMULADOR });

// Las entregas del dia: confirmacion, motorizados y hora de llegada. Ver src/entregas.
const entregas = await crearServicioEntregas({
  repos,
  repo: repos.entregas,
  sender,
  settingsRepo: runtime.settingsRepo,
  gsg: conexionGsg.puerto(),
  conexionGsg,
  cargarLote: (body) => cargarLote({ repos, plan: PLANES[config.RUTAS_PAIS] ?? PLANES.peru!, timezone: config.timezone, lista }, body),
  nombreNegocio: () => ajustes.nombreNegocio(),
  supervisor: () => politica().avisarA,
  ia: () => (ia.estado().tieneToken ? { completar: (mensajes, opts) => ia.completar(mensajes, opts) } : null),
  usarPlantilla: () => providerOf(settings.current()) === 'cloud',
  timezone: config.timezone,
  plan: PLANES[config.RUTAS_PAIS] ?? PLANES.peru!,
  publicBaseUrl: config.PUBLIC_BASE_URL,
  bus,
  log: (m, d) => console.warn(`[entregas] ${m}`, d ?? ''),
});

const ia = await crearServicioIA({
  settingsRepo: runtime.settingsRepo,
  settingsKeyBase64: runtime.secrets.settingsKey,
  repos,
  sender,
  config,
  nombreNegocio: () => ajustes.nombreNegocio(),
  supervisor: () => politica().avisarA,
  conBoton: () => providerOf(settings.current()) === 'cloud' || config.WHATSAPP_NATIVE_BUTTONS,
  lista,
  bus,
  plan,
  entrenamiento,
  catalogo,
  voz,
  entregas,
  log: (m, d) => console.warn(m, d ?? ''),
});
entrenamiento.conectarIA(iaParaEntrenar(ia));
parteDeSalud.dar = async () => ({
  whatsapp: !settings.isConfigured() ? 'sin_conectar' : (wa.conectado?.() ?? true) ? 'conectado' : 'caido',
  mensajesHoy: (await salud.snapshot()).ritmo.hoy,
  fallosIA: ia.uso().hoy.fallos,
  entregasHoy: (await entregas.resumen()).cifras.total,
  version: versionDelPaquete(),
});

// El resumen de la mañana y de la tarde al supervisor (Ajustes → Resumen del dia).
const resumenes = await crearServicioResumenes({
  settingsRepo: runtime.settingsRepo,
  sender,
  ajustes: () => ajustes.resumenes(),
  supervisor: () => politica().avisarA,
  nombreNegocio: () => ajustes.nombreNegocio(),
  entregas,
  ia: () => (ia.estado().tieneToken ? { completar: (m, o) => ia.completar(m, o) } : null),
  whatsappConectado: () => settings.isConfigured() && (wa.conectado?.() ?? true),
  timezone: config.timezone,
  publicBaseUrl: config.PUBLIC_BASE_URL,
  log: (m, d) => console.warn(`[resumenes] ${m}`, d ?? ''),
});

// "Que todo funcione": el vigilante del WhatsApp, la prueba de cada manana,
// el cupo previsto y la copia de seguridad. Ver src/salud/fiabilidad.ts.
const secretoInterno = randomBytes(24).toString('hex');
let reconectarLocal: (() => Promise<unknown>) | undefined;
const fiabilidad = await crearFiabilidad({
  settingsRepo: runtime.settingsRepo,
  settingsKeyBase64: runtime.secrets.settingsKey,
  salud,
  timezone: config.timezone,
  log: (m, d) => console.warn(`[fiabilidad] ${m}`, d ?? ''),
  vigilante: {
    conectado: () => wa.conectado?.(),
    proveedor: () => (settings.isConfigured() ? providerOf(settings.current()) : null),
    estadoLocal: () => getLocalState(),
    reconectar: () => (reconectarLocal ? reconectarLocal() : Promise.resolve()),
    avisarWhatsApp: async (texto) => {
      const destino = politica().avisarA;
      if (!destino) return { ok: false, detalle: 'no hay número del supervisor' };
      const r = await sender.send({ phone: destino, kind: 'freeform', category: 'UTILITY', text: texto, manual: true, origen: 'sistema' });
      return { ok: r.ok, detalle: r.ok ? undefined : r.blocked ? r.reason : r.error };
    },
  },
  humo: {
    sender,
    supervisor: () => politica().avisarA,
    deliveries: repos.deliveries,
    conexionGsg,
    ia,
    entregas,
    carpetas: () => [process.cwd(), path.resolve(config.ARCHIVE_DIR)],
  },
  cupo: { entregas, lista, reparto: () => lista.ajustesReparto() },
  respaldo: {
    // Con Postgres de verdad la base la vuelca pg_dump (si esta en el PATH); si no, solo los respaldos.
    baseDatos: () => ({ tipo: 'postgres', url: config.DATABASE_URL }),
    archiveDir: config.ARCHIVE_DIR,
    carpetaPorDefecto: carpetaDeCopiasPorDefecto(),
  },
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

const app = await buildServer({ config, repos, settings, wa, sender, queue, salud, politica, ajustes, stickers, bus, ia, entrenamiento, conexionStoky, catalogo, lista, plan, voz, entregas, conexionGsg, simuladorGsg, resumenes, fiabilidad, secretoInterno, mediaDir: mediaDirectory(), autoConectarLocal: true });
reconectarLocal = () =>
  app.inject({
    method: 'POST',
    url: '/admin/local/connect',
    headers: { [CABECERA_INTERNA]: secretoInterno, [CABECERA_USUARIO_INTERNO]: JSON.stringify({ id: 'vigilante', usuario: 'vigilante', nombre: 'Vigilante del WhatsApp', rol: 'admin', permisos: [] }) },
  });

const worker = conRedis
  ? createOutboundWorker({ redisUrl: config.REDIS_URL, sender, queue, onResult })
  : null;

// Todo lo que trabaja solo: monitor, secuencias, goteo, rutas, avisos, GSG.
const pararServicios = arrancarServicios({ config, repos, settings, wa, sender, salud, politica, ajustes, stickers, bus, lista, gsg: conexionGsg.puerto(), entregas, ia, resumenes, fiabilidad, log: app.log });

await app.listen({ port: config.PORT, host: '0.0.0.0' });

const missing = settings.missing();
console.log(`
  GSGchat en http://localhost:${config.PORT}
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
