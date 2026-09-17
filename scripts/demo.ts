/**
 * Servidor de demostracion: el codigo real de `buildServer` pero con la capa
 * de datos en memoria y un cliente de WhatsApp falso.
 *
 * Existe para poder ver y tocar el panel y las paginas de rastreo sin
 * Postgres, sin Redis y sin credenciales de Meta. NO es un modo de
 * produccion: no persiste nada y no manda mensajes de verdad.
 *
 *   npm run demo
 */

import { loadConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { buildTrackingUrls } from '../src/tracking/tokens.js';
import { createFakeRepos, createFakeWhatsApp, approvedTemplate, createMemorySettingsRepo, TEST_SETTINGS_KEY } from '../tests/fakes.js';
import { createSettingsService } from '../src/settings/service.js';
import { crearServicioIA } from '../src/ia/servicio.js';
import { crearServicioEnvioAutomatico } from '../src/envio-automatico/servicio.js';
import { startMotorLista } from '../src/envio-automatico/motor.js';
import { opcionesDesdeConfig } from '../src/rutas/motor.js';
import { PLANES } from '../src/rutas/telefono.js';
import { crearBus } from '../src/eventos/bus.js';
import { observarRepos } from '../src/eventos/observar.js';
import { encolarEventos, startDespachadorWebhooks } from '../src/webhooks/despachador.js';
import { CATALOG } from '../src/templates/catalog.js';
import { countVariables } from '../src/templates/render.js';
import { extractLocationSync } from '../src/geo/extract.js';
import { enrollContact, startScheduler } from '../src/automation/engine.js';
import { politicaDesdeConfig } from '../src/salud/politica.js';
import { crearMonitor, startMonitorSalud } from '../src/salud/monitor.js';
import { startGoteo } from '../src/campanas/goteo.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { crearServicioStickers } from '../src/stickers/stickers.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 3000);
const BASE = `http://localhost:${PORT}`;

const config = loadConfig({
  PORT: String(PORT),
  PUBLIC_BASE_URL: BASE,
  DATABASE_URL: 'postgres://demo/demo',
  WHATSAPP_TOKEN: 'demo',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'demo-app-secret',
  WHATSAPP_VERIFY_TOKEN: 'demo-verify',
  // Sin clave, la pagina cae a OpenStreetMap y se ve igual de bien.
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? '',
  // Que las pantallas avisen de que aqui no sale ningun mensaje de verdad.
  DEMO_MODE: 'true',
  TRACKING_SECRET: 'demo'.repeat(12),
  GEO_BBOX: 'lima',
  // Los respaldos de la demo van a un directorio aparte y no se limpia nada
  // solo: es una demo, no tiene sentido que borre conversaciones de ejemplo.
  ARCHIVE_DIR: process.env.ARCHIVE_DIR ?? '.wa-demo-respaldos',
  ARCHIVE_INACTIVE_DAYS: '0',
} as NodeJS.ProcessEnv);

// El bus de eventos, como en el arranque real: el chat embebido y los
// webhooks salientes se pueden probar tambien en la demo.
const bus = crearBus();
const repos = observarRepos(createFakeRepos(), bus) as ReturnType<typeof createFakeRepos>;
const wa = createFakeWhatsApp();
const settingsRepo = createMemorySettingsRepo();
const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);

const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config });
const politica = () => ajustes.politica(politicaDesdeConfig(config, 'cloud'));
const salud = crearMonitor({
  repos,
  politica,
  phoneNumberId: () => settings.current().phoneNumberId,
});

const sender = createSender({
  repos,
  wa,
  phoneNumberId: () => settings.current().phoneNumberId,
  warmup: politica().warmup,
  maxMarketingPerContact7d: config.MAX_MARKETING_PER_CONTACT_7D,
  salud,
  politica,
});

/** Cola de pega: envia en el acto en vez de pasar por Redis. */
const queue: OutboundQueue = {
  async enqueue(job) {
    await sender.send(job);
  },
  async enqueueMany(jobs) {
    for (const job of jobs) await sender.send(job);
    return jobs.length;
  },
  async pause() {},
  async resume() {},
  async counts() {
    return { waiting: 0, active: 0, delayed: 0, completed: wa.sent.length, failed: 0, paused: 0 };
  },
  async close() {},
};

// --- datos de ejemplo para que las pantallas tengan algo que ensenar -----
for (const template of CATALOG) {
  await repos.templates.upsert(
    approvedTemplate({
      name: template.name,
      language: template.language,
      category: template.category,
      body: template.body,
      variables: countVariables(template.body),
      // Una queda pendiente para que se vea el estado en el panel.
      status: template.name === 'recuperacion_carrito' ? 'PENDING' : 'APPROVED',
    }),
  );
}
wa.remoteTemplates = CATALOG.map((t) => ({
  name: t.name,
  language: t.language,
  category: t.category,
  status: 'APPROVED',
  quality_score: { score: 'GREEN' },
  components: [{ type: 'BODY', text: t.body }],
}));

await repos.contacts.upsertFromInbound('51987654321', 'Ana Demo');
await repos.contacts.setOptIn('51987654321', 'demo');
await repos.contacts.touchInbound('51987654321', new Date());
await repos.contacts.upsertFromInbound('51912345678', 'Luis Reparto');
await repos.contacts.setOptIn('51912345678', 'formulario web');
await repos.contacts.upsertFromInbound('51955555555', 'Sin consentimiento');
await repos.contacts.upsertFromInbound('51966666666', 'Carla Baja');
await repos.contacts.setOptIn('51966666666', 'demo');
await repos.contacts.setOptOut('51966666666');

const contact = (await repos.contacts.getByPhone('51987654321'))!;
for (const input of [
  'https://www.google.com/maps/place/Parque+Kennedy/data=!8m2!3d-12.1211!4d-77.0297',
  'https://www.google.com/maps/@-12.0464,-77.0428,15z',
  '-12.0931, -77.0465',
]) {
  const result = extractLocationSync(input, { bbox: config.bbox });
  if (result.ok) {
    const id = await repos.locations.save(contact.id, result, input);
    if (!result.needsConfirmation) await repos.locations.confirm(id);
  }
}

// Una campana ya lanzada: una entrega sale, otra se bloquea por falta de opt-in.
const campaignId = await repos.campaigns.create({
  name: 'Recordatorio de ejemplo',
  templateName: 'recordatorio_cita',
  templateLanguage: 'es',
  category: 'UTILITY',
});
await repos.campaigns.setStatus(campaignId, 'running');
for (const phone of ['51987654321', '51955555555']) {
  await sender.send({
    phone,
    kind: 'template',
    category: 'UTILITY',
    campaignId,
    templateName: 'recordatorio_cita',
    templateLanguage: 'es',
    variables: ['Ana', 'lunes 3', '10:00'],
  });
}

// --- una conversacion de ejemplo, para que el chat no nazca vacio ------
const hace = (minutos: number) => new Date(Date.now() - minutos * 60_000);

for (const [minutos, direccion, texto] of [
  [190, 'in', 'Hola, buenas tardes'],
  [188, 'out', 'Hola Ana, gracias por escribir. En que te ayudamos?'],
  [180, 'in', 'Queria saber si llegan a San Juan de Lurigancho'],
  [176, 'out', 'Si, llegamos a toda Lima. Compartenos tu ubicacion y te confirmo el costo.'],
  [40, 'in', 'Ubicacion: -12.0931, -77.0465'],
  [38, 'out', 'Ubicacion registrada: -12.093100, -77.046500\nhttps://www.google.com/maps/search/?api=1&query=-12.0931,-77.0465'],
  [35, 'in', 'Perfecto, cuanto tardan?'],
] as Array<[number, 'in' | 'out', string]>) {
  await repos.messages.add({
    contactId: contact.id,
    direction: direccion,
    kind: texto.startsWith('Ubicacion:') ? 'location' : 'text',
    body: texto,
    status: direccion === 'out' ? 'read' : null,
    createdAt: hace(minutos),
  });
}

const luisChat = (await repos.contacts.getByPhone('51912345678'))!;
await repos.contacts.touchInbound(luisChat.phone, hace(1500));
await repos.messages.add({
  contactId: luisChat.id,
  direction: 'in',
  kind: 'text',
  body: 'Buenas, quiero cotizar 20 piezas',
  createdAt: hace(1500),
});
await repos.messages.add({
  contactId: luisChat.id,
  direction: 'out',
  kind: 'text',
  body: 'Con gusto, Luis Reparto. Un asesor te contacta en breve.',
  status: 'delivered',
  createdAt: hace(1499),
});

const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
const link = await repos.tracking.createLink(contact.id, 'Pedido A-1024', expiresAt);
await repos.tracking.addPoint(link.id, { lat: -12.0464, lng: -77.0428, accuracy: 12 });
const urls = buildTrackingUrls(link.id, expiresAt, config.TRACKING_SECRET, BASE);

// Automatizacion de ejemplo: una bienvenida, una regla por palabra y una
// secuencia de seguimiento con un contacto inscrito.
const followUp = await repos.automation.createSequence({
  name: 'Seguimiento de cotizacion',
  description: 'Recordatorio al dia siguiente y cierre a los tres dias si no responde.',
  stopOnReply: true,
  steps: [
    {
      delayMinutes: 24 * 60,
      kind: 'template',
      templateName: 'seguimiento_entrega',
      templateLanguage: 'es',
      category: 'UTILITY',
      variables: ['{nombre}', '{fecha}'],
    },
    { delayMinutes: 48 * 60, kind: 'text', text: 'Hola {nombre}, seguimos a tus ordenes. Responde y te atendemos.' },
  ],
});
await repos.automation.createRule({
  name: 'Bienvenida',
  trigger: 'first_message',
  reply: 'Hola {nombre}, gracias por escribir. Comparte tu ubicacion o dinos en que te ayudamos.',
});
await repos.automation.createRule({
  name: 'Cotizacion',
  trigger: 'keyword',
  keyword: 'cotizar',
  match: 'contains',
  reply: 'Con gusto, {nombre}. Un asesor te contacta en breve.',
  sequenceId: followUp.id,
});
const luis = (await repos.contacts.getByPhone('51912345678'))!;
await enrollContact({ repos, sender }, followUp, luis, 'demo');

// --- un lote de ubicaciones con los casos que se ven de verdad ---------
//
// La pantalla /rutas no se entiende con datos vacios: lo que hay que ver de
// un vistazo es que casos existen y donde acaba cada uno.
const lote = await repos.rutas.crearLote({ nombre: 'Reparto de hoy (demo)' });
const solicitudes = await repos.rutas.agregarSolicitudes(lote.id, [
  { telefonoCrudo: '987654321', phone: '51987654321', nombre: 'Ana Ruiz', referencia: 'P-1024', distrito: 'Miraflores' },
  { telefonoCrudo: '912345678', phone: '51912345678', nombre: 'Luis Paz', referencia: 'P-1025', distrito: 'Surco' },
  { telefonoCrudo: '955555555', phone: '51955555555', nombre: 'Marta Gil', referencia: 'P-1026', distrito: 'San Borja' },
  { telefonoCrudo: '966666666', phone: '51966666666', nombre: 'Jose Vera', referencia: 'P-1027', distrito: 'Lince' },
  { telefonoCrudo: '977777777', phone: '51977777777', nombre: 'Rosa Diaz', referencia: 'P-1028', distrito: 'Breña' },
  {
    telefonoCrudo: '98765432',
    phone: null,
    nombre: 'Pedro Soto',
    referencia: 'P-1029',
    estado: 'incidencia',
    incidencia: 'numero_corto',
    incidenciaDetalle: '"98765432" tiene 8 dígitos y un celular necesita 9; falta 1',
    requiereHumano: true,
  },
  { telefonoCrudo: '944444444', phone: '51944444444', nombre: 'Carla Nunez', referencia: 'P-1030', distrito: 'Jesús María' },
]);

const [ana, luisR, marta, jose, rosa, , carla] = solicitudes;

// Ana mando su pin: caso resuelto, ya en la cola de GSG.
await repos.rutas.actualizarSolicitud(ana!.id, {
  estado: 'resuelto',
  intentos: 1,
  ultimoEnvioAt: new Date(Date.now() - 40 * 60_000),
  primeraRespuestaAt: new Date(Date.now() - 35 * 60_000),
  resueltoAt: new Date(Date.now() - 35 * 60_000),
  lat: -12.1211,
  lng: -77.0301,
  mapsUrl: 'https://www.google.com/maps?q=-12.1211,-77.0301',
  ubicacionFuente: 'pin de whatsapp',
});
await repos.rutas.registrarEvento(ana!.id, 'envio', 'primera solicitud de ubicación');
await repos.rutas.registrarEvento(ana!.id, 'ubicacion', 'ubicación recibida (pin de whatsapp)');
await repos.rutas.encolarReporte({
  solicitudId: ana!.id,
  loteId: lote.id,
  tipo: 'ubicacion',
  payload: { referencia: 'P-1024', telefono: '51987654321', lat: -12.1211, lng: -77.0301 },
});

// Luis contesto, pero con texto: se aparta para que lo mire una persona.
await repos.rutas.actualizarSolicitud(luisR!.id, {
  estado: 'respondio',
  intentos: 2,
  ultimoEnvioAt: new Date(Date.now() - 20 * 60_000),
  primeraRespuestaAt: new Date(Date.now() - 18 * 60_000),
  incidencia: 'respondio_sin_ubicacion',
  incidenciaDetalle: 'estoy en el jirón Puno 340, altura del mercado',
  requiereHumano: true,
});
await repos.rutas.registrarEvento(luisR!.id, 'envio', 'primera solicitud de ubicación');
await repos.rutas.registrarEvento(luisR!.id, 'respuesta', 'contestó: "estoy en el jirón Puno 340, altura del mercado"');

// Marta: se le escribio y no ha contestado.
await repos.rutas.actualizarSolicitud(marta!.id, {
  estado: 'enviado',
  intentos: 1,
  ultimoEnvioAt: new Date(Date.now() - 12 * 60_000),
  proximoIntentoAt: new Date(Date.now() + 18 * 60_000),
});
await repos.rutas.registrarEvento(marta!.id, 'envio', 'primera solicitud de ubicación');

// Jose: el numero existe pero no tiene WhatsApp.
await repos.rutas.actualizarSolicitud(jose!.id, {
  estado: 'incidencia',
  incidencia: 'sin_whatsapp',
  incidenciaDetalle: 'el número 51966666666 no tiene una cuenta de WhatsApp',
  requiereHumano: true,
});
await repos.rutas.registrarEvento(jose!.id, 'incidencia', 'El número no tiene WhatsApp');

// Rosa: tres mensajes sin respuesta, la llama el repartidor.
await repos.rutas.actualizarSolicitud(rosa!.id, {
  estado: 'derivado',
  intentos: 3,
  ultimoEnvioAt: new Date(Date.now() - 90 * 60_000),
  incidencia: 'sin_respuesta',
  incidenciaDetalle: 'no contestó a 3 mensajes',
  requiereHumano: true,
});
await repos.rutas.registrarEvento(rosa!.id, 'derivacion', 'pasa al repartidor para llamada telefónica');

// Carla sigue en la cola, sin escribir todavia.
void carla;

await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');

// Los stickers de la demo van a una carpeta temporal: nada queda en el proyecto.
const stickers = crearServicioStickers({ repo: repos.stickers, mediaDir: mkdtempSync(join(tmpdir(), 'wa-demo-stickers-')), sender, ajustes, publicBase: config.PUBLIC_BASE_URL });
const lista = crearServicioEnvioAutomatico({ repos, opcionesReparto: opcionesDesdeConfig(config), plan: PLANES[config.RUTAS_PAIS] ?? PLANES.peru!, salud });
const ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => ajustes.nombreNegocio(), supervisor: () => politica().avisarA, lista, bus });
const app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, salud, politica, ajustes, stickers, bus, ia, lista });
startMotorLista({ repos, lista, sender, opciones: opcionesDesdeConfig(config), nombreNegocio: () => ajustes.nombreNegocio(), usarPlantilla: () => false, salud, politica });
const desconectarWebhooks = encolarEventos(bus, repos.webhooks);
const pararWebhooks = startDespachadorWebhooks({ repo: repos.webhooks }, 3_000);
process.on('exit', () => { desconectarWebhooks(); pararWebhooks(); });
startScheduler({ repos, sender }, 3_000);
startMonitorSalud(salud, undefined, 15_000);
startGoteo({ repos, sender, salud, politica }, 3_000);
await app.listen({ port: PORT, host: '127.0.0.1' });

console.log(`
  wa-locator - servidor de demostracion (datos en memoria)

  Chat         ${BASE}/chat
  Configuracion ${BASE}/setup
  Panel        ${BASE}/panel
  Ubicaciones  ${BASE}/rutas
  Salud        ${BASE}/health
  Ver en vivo  ${urls.viewUrl}
  Compartir    ${urls.publishUrl}
  Caducado     ${BASE}/t/token-invalido

  Entrar en el navegador: ${BASE}/login (crea la primera cuenta ahi mismo)
  API para programas: crea una clave en ${BASE}/panel#integraciones y luego
    curl -H "authorization: Bearer wak_..." ${BASE}/admin/health
`);
