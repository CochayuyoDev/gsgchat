/**
 * Arranque corto: WhatsApp de verdad, sin montar nada.
 *
 * El servidor real, el cliente real y Postgres real, pero sin instalar nada:
 * la base corre embebida (PGlite, Postgres compilado a WebAssembly) sobre una
 * carpeta local, y la cola va en memoria en vez de en Redis.
 *
 *   npm run quick        y luego /setup, escanear el QR, listo
 *
 * Todo persiste entre reinicios: la vinculacion de WhatsApp en `.wa-auth`, y
 * los contactos, mensajes y ubicaciones en `.wa-data`. Es para probar en una
 * maquina, no para produccion: un solo proceso y sin concurrencia.
 */

import path from 'node:path';
import { loadConfig } from '../src/config.js';

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
import { buildServer } from '../src/server.js';
import { createSender } from '../src/outbound/sender.js';
import { createMemoryOutboundQueue } from '../src/outbound/memory-queue.js';
import { createRepos, createSettingsRepo } from '../src/db/repos.js';
import { openPglite } from '../src/db/pglite.js';
import { bootstrapSecrets } from '../src/settings/crypto.js';
import { providerOf, createSettingsService } from '../src/settings/service.js';
import { createDynamicWhatsAppClient } from '../src/whatsapp/dynamic.js';
import { defaultAuthDir, getLocalState } from '../src/whatsapp/local/session.js';
import { crearConexionStoky } from '../src/stoky/conexion.js';
import { crearServicioPlan, type EstadoInstancia } from '../src/plan/servicio.js';
import { versionDelPaquete } from '../src/util/version.js';
import { secretsDirectory } from '../src/runtime.js';
import { CATALOG } from '../src/templates/catalog.js';
import { countVariables } from '../src/templates/render.js';
import { politicaDesdeConfig } from '../src/salud/politica.js';
import { crearMonitor } from '../src/salud/monitor.js';
import { arrancarServicios, resumenPolitica } from '../src/servicios.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { crearServicioStickers } from '../src/stickers/stickers.js';
import { mediaDirectory } from '../src/whatsapp/local/media.js';
import { crearBus } from '../src/eventos/bus.js';
import { observarRepos } from '../src/eventos/observar.js';
import { crearServicioIA } from '../src/ia/servicio.js';
import { crearServicioEntrenamiento, iaParaEntrenar } from '../src/entrenamiento/servicio.js';
import { crearServicioVoz } from '../src/voz/servicio.js';
import { crearServicioEnvioAutomatico } from '../src/envio-automatico/servicio.js';
import { opcionesDesdeConfig } from '../src/rutas/motor.js';
import { PLANES } from '../src/rutas/telefono.js';
import { crearConexionGsg, TOKEN_SIMULADOR } from '../src/rutas/conexion-gsg.js';
import { crearGsgSimulado } from '../src/entregas/gsg-simulado.js';
import { crearServicioEntregas } from '../src/entregas/servicio.js';
import { crearServicioResumenes } from '../src/resumenes/servicio.js';
import { cargarLote } from '../src/rutas/cargar.js';
import { crearFiabilidad } from '../src/salud/fiabilidad.js';
import { carpetaDeCopiasPorDefecto } from '../src/respaldo/servicio.js';
import { CABECERA_INTERNA, CABECERA_USUARIO_INTERNO } from '../src/auth/routes.js';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 3000);
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = process.env.QUICK_DATA_DIR ?? path.join(process.cwd(), '.wa-data');

// El mismo .secrets.json que el arranque de verdad: asi el token de admin y la
// clave que cifra las credenciales no cambian cada vez.
const secrets = bootstrapSecrets(secretsDirectory());

const config = loadConfig({
  // Primero el entorno (y el .env, que config.ts carga con dotenv): asi las
  // variables de ritmo, salud y rutas (RITMO_*, SALUD_*, RUTAS_*, HORARIO_*)
  // tambien mandan en el arranque corto. Antes solo se leian las de abajo, y
  // afinar el ritmo obligaba a usar el arranque completo.
  ...process.env,
  PORT: String(PORT),
  PUBLIC_BASE_URL: BASE,
  DATABASE_URL: `pglite://${DATA_DIR}`,
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
} as NodeJS.ProcessEnv);

const pglite = await openPglite(DATA_DIR);
const { pool } = pglite;
// Los repositorios observados: cada escritura avisa al bus, y los webhooks
// salientes reparten el aviso (igual que en el arranque completo).
const bus = crearBus((m, d) => console.warn(m, d));
const repos = observarRepos(createRepos(pool), bus);
const settingsRepo = createSettingsRepo(pool);
const settings = await createSettingsService(settingsRepo, config, secrets.settingsKey);

// La politica de ritmo: aqui casi siempre `no_oficial` (Baileys), que es el
// perfil lento, con escritura simulada y warm-up desde 20 al dia.
// Encima del .env van los ajustes que se cambian desde /panel#configuracion.
const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config });
const politica = () =>
  ajustes.politica(politicaDesdeConfig(config, providerOf(settings.current()) === 'cloud' ? 'cloud' : 'no_oficial'));

const wa = createDynamicWhatsAppClient(settings, {
  resolveTemplateBody: async (name, language) =>
    (await repos.templates.get(name, language))?.body ?? undefined,
  nativeButtons: config.WHATSAPP_NATIVE_BUTTONS,
  humanizar: () => politica().humanizar,
});

const phoneNumberId = () => settings.current().phoneNumberId || 'local';

let avisarSupervisor: ((texto: string) => Promise<void>) | undefined;
const salud = crearMonitor({
  repos,
  politica,
  phoneNumberId,
  avisar: (texto) => (avisarSupervisor ? avisarSupervisor(texto) : Promise.resolve()),
  cola: { pause: () => queue.pause(), resume: () => queue.resume() },
  log: (mensaje, detalle) => console.log(`[salud] ${mensaje}`, detalle ?? ''),
});

const sender = createSender({
  repos,
  wa,
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

if (ajustes.soloNumeros().length) {
  console.log(`
  MODO PRUEBA: solo se escribe a ${ajustes.soloNumeros().join(', ')} (se cambia en /panel#configuracion).
`);
}

avisarSupervisor = async (texto) => {
  const destino = politica().avisarA;
  if (!destino) return;
  await sender.send({ phone: destino, kind: 'freeform', category: 'UTILITY', text: texto, manual: true });
};

const queue = createMemoryOutboundQueue({ sender });

// La membresia: sin PLAN_URL no hay maestro y la lleva el superadministrador
// desde la pantalla Membresia (ver src/plan).
// El parte de salud que esta instalacion le manda al maestro en cada consulta
// del plan (Tiendas lo enseña en palabras). Se completa mas abajo, cuando
// existen el monitor, la IA y las entregas.
const parteDeSalud: { dar: null | (() => Promise<EstadoInstancia>) } = { dar: null };
const plan = await crearServicioPlan({
  settingsRepo,
  url: config.PLAN_URL,
  token: config.PLAN_TOKEN,
  baseUrl: config.PUBLIC_BASE_URL,
  log: (m, d) => console.warn(m, d ?? ''),
  estado: () => (parteDeSalud.dar ? parteDeSalud.dar() : { whatsapp: settings.isConfigured() ? 'conectado' : 'sin_conectar', mensajesHoy: 0, fallosIA: 0, entregasHoy: 0, version: versionDelPaquete() }),
});
plan.arrancar();

// La conexion con Stoky se configura desde la pantalla (Conectar mi web y
// tienda → Stoky) o la manda Stoky al vincularse; el .env es el valor inicial.
// El catalogo es siempre el mismo objeto: apunta a la conexion vigente.
const conexionStoky = await crearConexionStoky({ settingsRepo, settingsKeyBase64: secrets.settingsKey, config, log: (m, d) => console.warn(`[stoky] ${m}`, d ?? '') });
const catalogo = conexionStoky.cliente();

// La lista de numeros a los que el sistema escribe solo (ver src/envio-automatico).
const lista = crearServicioEnvioAutomatico({
  repos,
  opcionesReparto: opcionesDesdeConfig(config),
  plan: PLANES[config.RUTAS_PAIS] ?? PLANES.peru!,
  salud,
  log: (m, d) => console.log(`[wa] ${m}`, d ?? ''),
});

// El asistente de IA de la tienda (ver src/ia): con el catalogo de Stoky si esta.
// Lo que se le enseno al asistente a gran escala (lecciones, aprender de
// los chats, examen). Se carga antes que la IA: cada turno elige de aqui.
const entrenamiento = await crearServicioEntrenamiento({ repo: repos.entrenamiento, nombreNegocio: () => ajustes.nombreNegocio(), log: (m, d) => console.warn(`[entrenamiento] ${m}`, d ?? '') });
await entrenamiento.cargar();

// La voz del asistente (ElevenLabs): notas de voz y transcripcion de los
// audios del cliente. Se configura en Mi asistente IA → Voz. Ver src/voz.
const voz = await crearServicioVoz({ settingsRepo, settingsKeyBase64: secrets.settingsKey, sender, mediaDir: mediaDirectory(), log: (m, d) => console.warn(`[voz] ${m}`, d ?? '') });

// La conexion con GSG se configura desde Entregas del dia (real o el
// simulador de este servidor); el .env es el valor inicial. Ver src/rutas/conexion-gsg.ts.
const conexionGsg = await crearConexionGsg({ settingsRepo, settingsKeyBase64: secrets.settingsKey, config, log: (m, d) => console.warn(`[gsg] ${m}`, d ?? '') });
// El simulador del sistema de GSG: sus tres listas, en memoria, en /simulador/gsg.
const simuladorGsg = crearGsgSimulado({ token: TOKEN_SIMULADOR });

// Las entregas del dia: confirmacion, motorizados y hora de llegada. Ver src/entregas.
const entregas = await crearServicioEntregas({
  zonaHoraria: () => ajustes.zonaHoraria(),
  repos,
  repo: repos.entregas,
  sender,
  settingsRepo,
  gsg: conexionGsg.puerto(),
  conexionGsg,
  cargarLote: (body) => cargarLote({ repos, plan: PLANES[config.RUTAS_PAIS] ?? PLANES.peru!, timezone: config.timezone, lista }, body),
  ampliarHorario: (fn) => ajustes.ampliarHorario(fn),
  nombreNegocio: () => ajustes.nombreNegocio(),
  supervisor: () => politica().avisarA,
  ia: () => (ia.estado().tieneToken ? { completar: (mensajes, opts) => ia.completar(mensajes, opts) } : null),
  usarPlantilla: () => providerOf(settings.current()) === 'cloud',
  timezone: config.timezone,
  plan: PLANES[config.RUTAS_PAIS] ?? PLANES.peru!,
  publicBaseUrl: config.PUBLIC_BASE_URL,
  bus,
  geo: { bbox: config.bbox, cobertura: config.coverageName },
  log: (m, d) => console.warn(`[entregas] ${m}`, d ?? ''),
});

const ia = await crearServicioIA({
  settingsRepo,
  settingsKeyBase64: secrets.settingsKey,
  repos,
  sender,
  config,
  nombreNegocio: () => ajustes.nombreNegocio(),
  supervisor: () => politica().avisarA,
  catalogo,
  conBoton: () => providerOf(settings.current()) === 'cloud' || config.WHATSAPP_NATIVE_BUTTONS,
  lista,
  bus,
  entrenamiento,
  plan,
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
  settingsRepo,
  sender,
  ajustes: () => ajustes.resumenes(),
  supervisor: () => politica().avisarA,
  nombreNegocio: () => ajustes.nombreNegocio(),
  entregas,
  ia: () => (ia.estado().tieneToken ? { completar: (m, o) => ia.completar(m, o) } : null),
  whatsappConectado: () => settings.isConfigured() && (wa.conectado?.() ?? true),
  zonaHoraria: () => ajustes.zonaHoraria(), timezone: config.timezone,
  publicBaseUrl: config.PUBLIC_BASE_URL,
  log: (m, d) => console.warn(`[resumenes] ${m}`, d ?? ''),
});

// El catalogo local hace de catalogo aprobado: sin Meta no hay a quien pedir
// permiso, pero los gates siguen exigiendo que la plantilla exista y este
// aprobada antes de dejar salir nada. Se refresca en cada arranque por si el
// catalogo cambio; el estado de las que ya estaban no se toca.
for (const template of CATALOG) {
  if (await repos.templates.get(template.name, template.language)) continue;
  await repos.templates.upsert({
    name: template.name,
    language: template.language,
    category: template.category,
    body: template.body,
    variables: countVariables(template.body),
    status: 'APPROVED',
    quality: null,
  });
}

// "Que todo funcione": el vigilante del WhatsApp, la prueba de cada manana,
// el cupo previsto y la copia de seguridad. Ver src/salud/fiabilidad.ts.
const secretoInterno = randomBytes(24).toString('hex');
let reconectarLocal: (() => Promise<unknown>) | undefined;
const fiabilidad = await crearFiabilidad({
  settingsRepo,
  settingsKeyBase64: secrets.settingsKey,
  salud,
  timezone: () => ajustes.zonaHoraria(),
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
    carpetas: () => [DATA_DIR, path.resolve(config.ARCHIVE_DIR)],
  },
  cupo: { entregas, lista, reparto: () => lista.ajustesReparto() },
  respaldo: {
    baseDatos: () => ({ tipo: 'pglite', dump: () => pglite.dump(), dataDir: DATA_DIR }),
    archiveDir: config.ARCHIVE_DIR,
    carpetaPorDefecto: carpetaDeCopiasPorDefecto(),
  },
});

// La bienvenida la da el asistente de preventa, que ademas ofrece el menu y
// va llenando la ficha. Una regla `first_message` encima seria un segundo
// mensaje por el mismo entrante, que es justo lo que no puede pasar.

const app = await buildServer({
  config,
  repos,
  settings,
  settingsRepo,
  wa,
  sender,
  queue,
  catalogo,
  logger: false,
  salud,
  politica,
  ajustes,
  stickers,
  bus,
  ia,
  entrenamiento,
  conexionStoky,
  plan,
  lista,
  voz,
  entregas,
  conexionGsg,
  simuladorGsg,
  resumenes,
  fiabilidad,
  secretoInterno,
  // Para poder guardar en la biblioteca un sticker que llego por el chat: su
  // fichero vive aqui.
  mediaDir: mediaDirectory(),
  // Con la vinculacion guardada, la sesion se reabre sola: no hay que volver
  // a /setup despues de cada reinicio.
  autoConectarLocal: true,
});
reconectarLocal = () =>
  app.inject({
    method: 'POST',
    url: '/admin/local/connect',
    headers: { [CABECERA_INTERNA]: secretoInterno, [CABECERA_USUARIO_INTERNO]: JSON.stringify({ id: 'vigilante', usuario: 'vigilante', nombre: 'Vigilante del WhatsApp', rol: 'admin', permisos: [] }) },
  });

// Todo lo que trabaja solo: monitor de salud, secuencias, goteo de campanas,
// motor de rutas, avisos y GSG. Antes el arranque corto no levantaba nada de
// esto y un lote de rutas se quedaba cargado sin que saliera un mensaje.
const consola = {
  info: (detalle: unknown, mensaje?: string) => console.log(`[wa] ${mensaje ?? ''}`, resumir(detalle)),
  warn: (detalle: unknown, mensaje?: string) => console.warn(`[wa] ${mensaje ?? ''}`, resumir(detalle)),
};
function resumir(detalle: unknown): string {
  if (!detalle || (typeof detalle === 'object' && !Object.keys(detalle as object).length)) return '';
  try {
    return JSON.stringify(detalle);
  } catch {
    return String(detalle);
  }
}
const pararServicios = arrancarServicios({
  config,
  repos,
  settings,
  wa,
  sender,
  salud,
  politica,
  ajustes,
  stickers,
  bus,
  lista,
  gsg: conexionGsg.puerto(),
  entregas,
  ia,
  resumenes,
  fiabilidad,
  log: consola as never,
});
process.on('SIGINT', () => {
  pararServicios();
  process.exit(0);
});

if (conexionStoky.estado().configurada) {
  // Se trae el catalogo ANTES de atender a nadie: el primer cliente del dia no
  // tiene por que esperar a que cargue, y si Stoky esta caido se sabe aqui y
  // no en mitad de una conversacion.
  const [estado, precarga] = await Promise.all([catalogo.ping(), catalogo.precargar()]);
  console.log(
    estado.ok
      ? `  Stoky conectado: ${estado.tenant} / ${estado.warehouse} (${precarga.total} productos)`
      : `  Stoky NO responde: ${estado.detail}`,
  );
}
await app.listen({ port: PORT, host: '127.0.0.1' });

console.log(`
  GSGchat - arranque corto (Postgres embebido, WhatsApp de verdad)

  1. Abre       ${BASE}/login   (la primera vez, crea tu cuenta ahi mismo)
  2. Ve a        ${BASE}/setup   y elige "Escanear el QR y ya"
  3. Escanea con el telefono (o pide el codigo con tu numero)

  Integraciones (GSG, scripts): claves de API en ${BASE}/panel#integraciones

  Chat          ${BASE}/chat
  Panel         ${BASE}/panel   (Inicio: cifras del dia; #salud: riesgo, ritmo y por que frena)
  Entregas      ${BASE}/entregas   (GSG: ${conexionGsg.estado().descripcion})
  Ubicaciones   ${BASE}/rutas
  Envio autom.  ${BASE}/envio-automatico

  Ritmo: ${resumenPolitica(politica())}.

  Vinculacion   ${defaultAuthDir()}
  Datos         ${DATA_DIR}

  Las dos carpetas sobreviven al reinicio: no hay que volver a escanear ni a
  escribir los numeros.
`);
