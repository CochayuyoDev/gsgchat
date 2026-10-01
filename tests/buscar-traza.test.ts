/**
 * El buscador global (Ctrl K) y "que paso con este mensaje", contra el
 * servidor real con dobles en memoria. Y los primeros pasos del modo GSG en
 * /admin/resumen.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender, type Sender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { armarTraza, buscarEnTodo, MOTIVOS_EN_PALABRAS } from '../src/admin/buscar-routes.js';
import type { ResumenEntregas } from '../src/entregas/servicio.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, type FakeWhatsApp, CLAVE_API_PRUEBA } from './fakes.js';

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
} as NodeJS.ProcessEnv;
const config = loadConfig(ENV);
const queue: OutboundQueue = {
  async enqueue() {},
  async enqueueMany(jobs) {
    return jobs.length;
  },
  async pause() {},
  async resume() {},
  async counts() {
    return {};
  },
  async close() {},
};
const auth = { authorization: `Bearer ${CLAVE_API_PRUEBA}` };

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
let sender: Sender;

beforeAll(async () => {
  repos = createFakeRepos();
  wa = createFakeWhatsApp();
  sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  const settings = await createFakeSettings(config);
  app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('el buscador global', () => {
  it('encuentra clientes por nombre o por digitos del numero, y conversaciones guardadas', async () => {
    await repos.contacts.upsertFromInbound('51987000001', 'Ana Quispe');
    await repos.contacts.upsertFromInbound('51987000002', 'José Pérez');
    const ana = await repos.contacts.getByPhone('51987000001');
    await repos.archives.add({ contactId: ana!.id, phone: '51987000001', name: 'Ana Quispe', file: 'a.ndjson.gz', bytes: 10, messageCount: 3, firstMessageAt: new Date(), lastMessageAt: new Date(), reason: 'manual', sha256: null, textoBusqueda: 'se quejó de la demora', pedido: 'P-0900' });

    const porNombre = await app.inject({ method: 'GET', url: '/admin/buscar?q=ana', headers: auth });
    expect(porNombre.statusCode).toBe(200);
    expect(porNombre.json().clientes.map((c: { nombre: string }) => c.nombre)).toEqual(['Ana Quispe']);
    expect(porNombre.json().clientes[0].href).toBe('/chat?phone=51987000001');
    expect(porNombre.json().guardados).toHaveLength(1);
    expect(porNombre.json().guardados[0].pedido).toBe('P-0900');
    expect(porNombre.json().guardados[0].href).toMatch(/^\/guardados\?abrir=\d+$/);

    const porNumero = await app.inject({ method: 'GET', url: '/admin/buscar?q=987 000 002', headers: auth });
    expect(porNumero.json().clientes.map((c: { nombre: string }) => c.nombre)).toEqual(['José Pérez']);

    const corto = await app.inject({ method: 'GET', url: '/admin/buscar?q=a', headers: auth });
    expect(corto.json()).toEqual({ q: 'a', pedidos: [], clientes: [], guardados: [] });
  });

  it('con las entregas del dia, encuentra pedidos por referencia, nombre o telefono', async () => {
    const entregas = {
      async resumen() {
        return {
          entregas: [
            { id: 1, referencia: 'P-1001', nombre: 'Ana Quispe', phone: '51987000001', estado: 'avisada', situacion: 'llega a las 16:30' },
            { id: 2, referencia: 'P-1002', nombre: 'Luis Rojas', phone: '51987000010', estado: 'esperando_confirmacion', situacion: 'se le preguntó' },
          ],
        } as unknown as ResumenEntregas;
      },
    };
    const r1 = await buscarEnTodo({ repos, entregas }, 'p-1002');
    expect(r1.pedidos.map((p) => p.referencia)).toEqual(['P-1002']);
    expect(r1.pedidos[0]!.href).toBe('/hoy?buscar=P-1002');
    const r2 = await buscarEnTodo({ repos, entregas }, 'quispe');
    expect(r2.pedidos.map((p) => p.referencia)).toEqual(['P-1001']);
    expect(r2.clientes.map((c) => c.nombre)).toEqual(['Ana Quispe']);
    const r3 = await buscarEnTodo({ repos, entregas }, '000010');
    expect(r3.pedidos.map((p) => p.referencia)).toEqual(['P-1002']);
  });
});

describe('que paso con este mensaje', () => {
  it('un mensaje que salio: cola, salida y quien lo mando; y su estado cuando WhatsApp lo entrega', async () => {
    await repos.contacts.upsertFromInbound('51911111111', 'Rosa');
    await repos.contacts.setOptIn('51911111111', 'prueba');
    await repos.contacts.touchInbound('51911111111', new Date());
    const r = await sender.send({ phone: '51911111111', kind: 'freeform', category: 'UTILITY', text: 'Hola Rosa', manual: true, origen: 'persona', autorNombre: 'Ali' });
    expect(r.ok).toBe(true);
    const contact = await repos.contacts.getByPhone('51911111111');
    const [m] = await repos.messages.listMessages(contact!.id, 1);
    expect(m!.direction).toBe('out');

    const t = await app.inject({ method: 'GET', url: `/admin/mensajes/${m!.id}/traza?contacto=${contact!.id}`, headers: auth });
    expect(t.statusCode).toBe(200);
    expect(t.json().quien).toBe('Lo mandó Ali desde el chat.');
    expect(t.json().como).toBe('Salió como un texto.');
    expect(t.json().estado).toBe('enviado');
    expect(t.json().pasos.map((p: { que: string }) => p.que)).toEqual(['Se puso en la cola de salida.', 'Salió hacia WhatsApp.', 'WhatsApp todavía no confirmó que llegara al teléfono (un solo check).']);

    await repos.deliveries.updateByWamid(m!.wamid!, 'delivered');
    await repos.deliveries.updateByWamid(m!.wamid!, 'read');
    const t2 = await app.inject({ method: 'GET', url: `/admin/mensajes/${m!.id}/traza?contacto=${contact!.id}`, headers: auth });
    expect(t2.json().estado).toBe('leído');
    expect(t2.json().pasos.map((p: { que: string }) => p.que)).toContain('El cliente lo leyó.');
  });

  it('lo que no salio se ve al lado, con el motivo en palabras', async () => {
    await repos.contacts.upsertFromInbound('51922222222', 'Baja');
    await repos.contacts.setOptIn('51922222222', 'prueba');
    await repos.contacts.touchInbound('51922222222', new Date());
    const ok = await sender.send({ phone: '51922222222', kind: 'freeform', category: 'UTILITY', text: 'Primero', origen: 'sistema' });
    expect(ok.ok).toBe(true);
    await repos.contacts.setOptOut('51922222222');
    const bloqueado = await sender.send({ phone: '51922222222', kind: 'freeform', category: 'UTILITY', text: 'Segundo' });
    expect(bloqueado.ok).toBe(false);
    const contact = await repos.contacts.getByPhone('51922222222');
    const [m] = await repos.messages.listMessages(contact!.id, 1);
    const t = await app.inject({ method: 'GET', url: `/admin/mensajes/${m!.id}/traza?contacto=${contact!.id}`, headers: auth });
    expect(t.json().quien).toContain('el sistema solo');
    expect(t.json().otrosIntentos).toHaveLength(1);
    expect(t.json().otrosIntentos[0].motivo).toBe(MOTIVOS_EN_PALABRAS.opt_out);
  });

  it('un mensaje que ya no esta en el hilo o un contacto que no existe dan 404 con explicacion', async () => {
    const contact = await repos.contacts.getByPhone('51911111111');
    const noHay = await app.inject({ method: 'GET', url: `/admin/mensajes/999999/traza?contacto=${contact!.id}`, headers: auth });
    expect(noHay.statusCode).toBe(404);
    expect(noHay.json().error).toContain('ya no está en el hilo');
    const sinContacto = await app.inject({ method: 'GET', url: '/admin/mensajes/1/traza?contacto=nadie', headers: auth });
    expect(sinContacto.statusCode).toBe(404);
  });

  it('armarTraza traduce un envio frenado por una guarda', () => {
    const ahora = new Date();
    const traza = armarTraza(
      { id: 5, contactId: 'c', direction: 'out', wamid: null, kind: 'text', body: 'x', payload: { origen: 'ia' }, status: null, deliveryId: 9, createdAt: ahora },
      { id: 9, campaignId: null, campaignName: null, contactId: 'c', phone: '51912000000', name: null, wamid: null, kind: 'template', templateName: 'entrega_aviso', category: 'UTILITY', status: 'blocked_by_gate', errorCode: null, errorTitle: 'daily_cap: se llego al cupo', queuedAt: ahora, sentAt: null, deliveredAt: null, readAt: null, failedAt: ahora },
      [],
    );
    expect(traza.quien).toBe('Lo escribió el asistente IA.');
    expect(traza.como).toBe('Salió como una plantilla aprobada («entrega_aviso»).');
    expect(traza.estado).toBe('no salió');
    expect(traza.pasos[1]!.que).toBe(`No salió: ${MOTIVOS_EN_PALABRAS.daily_cap}`);
    expect(traza.pasos[1]!.tono).toBe('bad');
  });
});

describe('los primeros pasos del modo GSG', () => {
  it('la campana avisa de lo que GSG mandó y no se pudo leer, y del día que no cuadra', async () => {
    const { crearConexionGsg } = await import('../src/rutas/conexion-gsg.js');
    const { createMemorySettingsRepo, TEST_SETTINGS_KEY } = await import('./fakes.js');
    // La conexion creada aqui queda como la vigente del proceso: es la que mira la campana.
    const conexion = await crearConexionGsg({ settingsRepo: createMemorySettingsRepo(), settingsKeyBase64: TEST_SETTINGS_KEY, config: { GSG_URL: '', GSG_TOKEN: '', PUBLIC_BASE_URL: 'http://localhost:3000', timezone: 'America/Lima' } });
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const descartados = await conexion.extras.observarPendientes({ dia: hoy, faltaUbicacion: [{ referencia: 'P-9', telefono: '12' }, { referencia: '', telefono: '51987000001' }], faltaConfirmacion: [], terminados: [] });
    expect(descartados).toBeGreaterThan(0);
    const r = await app.inject({ method: 'GET', url: '/admin/avisos', headers: auth });
    expect(r.statusCode).toBe(200);
    const avisos = r.json().avisos as Array<{ tipo: string; texto: string; href: string; n?: number }>;
    const descarte = avisos.find((a) => a.tipo === 'gsg_descartes');
    expect(descarte).toBeTruthy();
    expect(descarte!.texto).toMatch(/de GSG no se pud/);
    expect(descarte!.href).toBe('/setup#gsg');
    expect(descarte!.n).toBe(descartados);
    // Sin cuadre hecho, no hay aviso de cuadre.
    expect(avisos.find((a) => a.tipo === 'gsg_cuadre')).toBeUndefined();
  });

  it('/admin/resumen dice el modo y lo que GSGchat necesita para arrancar', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/resumen', headers: auth });
    expect(r.statusCode).toBe(200);
    const p = r.json().primerosPasos;
    expect(p.modo).toBe('gsg');
    // Sin entregas en este arranque, no se sabe: null, no cero.
    expect(p.motorizadosActivos).toBeNull();
    expect(p.gsg).toBeNull();
    expect(p.entregasHoy).toBeNull();
    expect(typeof p.supervisor).toBe('boolean');
  });
});
