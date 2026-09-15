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
import { buildServer } from '../src/server.js';
import { createSender } from '../src/outbound/sender.js';
import { createMemoryOutboundQueue } from '../src/outbound/memory-queue.js';
import { createRepos, createSettingsRepo } from '../src/db/repos.js';
import { openPglite } from '../src/db/pglite.js';
import { bootstrapSecrets } from '../src/settings/crypto.js';
import { providerOf, createSettingsService } from '../src/settings/service.js';
import { createDynamicWhatsAppClient } from '../src/whatsapp/dynamic.js';
import { defaultAuthDir } from '../src/whatsapp/local/session.js';
import { createStokyClient } from '../src/stoky/client.js';
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

const { pool } = await openPglite(DATA_DIR);
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

// Sin las dos variables no hay catalogo, y el asistente hace todo lo demas.
const catalogo =
  config.STOKY_URL && config.STOKY_TOKEN
    ? createStokyClient({ baseUrl: config.STOKY_URL, token: config.STOKY_TOKEN })
    : undefined;

// El asistente de IA de la tienda (ver src/ia): con el catalogo de Stoky si esta.
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
  log: (m, d) => console.warn(m, d ?? ''),
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

// La bienvenida la da el asistente de preventa, que ademas ofrece el menu y
// va llenando la ficha. Una regla `first_message` encima seria un segundo
// mensaje por el mismo entrante, que es justo lo que no puede pasar.

const app = await buildServer({
  config,
  repos,
  settings,
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
  // Para poder guardar en la biblioteca un sticker que llego por el chat: su
  // fichero vive aqui.
  mediaDir: mediaDirectory(),
  // Con la vinculacion guardada, la sesion se reabre sola: no hay que volver
  // a /setup despues de cada reinicio.
  autoConectarLocal: true,
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
  log: consola as never,
});
process.on('SIGINT', () => {
  pararServicios();
  process.exit(0);
});

if (catalogo) {
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
  wa-locator - arranque corto (Postgres embebido, WhatsApp de verdad)

  1. Abre       ${BASE}/login   (la primera vez, crea tu cuenta ahi mismo)
  2. Ve a        ${BASE}/setup   y elige "Escanear el QR y ya"
  3. Escanea con el telefono (o pide el codigo con tu numero)

  Integraciones (GSG, scripts): claves de API en ${BASE}/panel#integraciones

  Chat          ${BASE}/chat
  Panel         ${BASE}/panel   (Inicio: cifras del dia; #salud: riesgo, ritmo y por que frena)
  Ubicaciones   ${BASE}/rutas

  Ritmo: ${resumenPolitica(politica())}.

  Vinculacion   ${defaultAuthDir()}
  Datos         ${DATA_DIR}

  Las dos carpetas sobreviven al reinicio: no hay que volver a escanear ni a
  escribir los numeros.
`);
