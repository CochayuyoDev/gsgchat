/**
 * Conectores de tiendas: WooCommerce y Shopify avisan de un pedido y sale
 * el WhatsApp que diga la regla, sin que la tienda toque su codigo.
 *
 * Se prueba con cuerpos como los que mandan de verdad: la firma en su
 * cabecera, el ping de WooCommerce, los topics de Shopify, el telefono sin
 * prefijo, y que cada cosa que llega quede apuntada con su resultado.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { firmaBase64, leerShopify, leerWooCommerce, rellenar } from '../src/conectores/tiendas.js';
import { approvedTemplate, createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, type FakeWhatsApp, CLAVE_API_PRUEBA as TODO } from './fakes.js';

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'none',
  BUSINESS_NAME: 'La Tienda',
  RUTAS_PAIS: 'peru',
} as NodeJS.ProcessEnv;

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

const con = (clave: string) => ({ authorization: `Bearer ${clave}`, 'content-type': 'application/json' });
const config = loadConfig(ENV);

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;

async function build() {
  repos = createFakeRepos();
  wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  const settings = await createFakeSettings(config);
  await repos.templates.upsert(approvedTemplate({ name: 'confirmacion_pedido', category: 'UTILITY', variables: 2, body: 'Hola {{1}}, tu pedido {{2}} esta confirmado.' }));
  return buildServer({ config, repos, settings, wa, sender, queue, logger: false });
}

/** Un pedido de WooCommerce, como lo manda su webhook. */
const PEDIDO_WOO = {
  id: 1024,
  number: '1024',
  status: 'processing',
  currency: 'PEN',
  total: '150.00',
  billing: { first_name: 'Maria', last_name: 'Quispe', phone: '987 654 321' },
  shipping: { phone: '' },
  line_items: [{ name: 'Zapato negro 40', quantity: 1 }, { name: 'Correa', quantity: 2 }],
  meta_data: [{ key: '_wc_shipment_tracking_items', value: 'ABC123' }],
};

/** Un pedido de Shopify. */
const PEDIDO_SHOPIFY = {
  id: 450789469,
  order_number: 1001,
  name: '#1001',
  financial_status: 'paid',
  fulfillment_status: null,
  total_price: '199.90',
  currency: 'PEN',
  phone: null,
  customer: { first_name: 'Luis', last_name: 'Torres', phone: '+51 912 345 678' },
  billing_address: { phone: null },
  shipping_address: { first_name: 'Luis', last_name: 'Torres', phone: null },
  line_items: [{ title: 'Polo blanco M', quantity: 3 }],
  fulfillments: [{ tracking_number: 'TRK-9', tracking_url: 'https://courier.test/TRK-9' }],
};

beforeAll(async () => {
  app = await build();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.close();
  app = await build();
  await app.ready();
});

describe('leer lo que manda cada tienda', () => {
  it('WooCommerce: topic + estado dicen el evento; billing trae nombre y telefono', () => {
    const creado = leerWooCommerce({ 'x-wc-webhook-topic': 'order.created' }, PEDIDO_WOO);
    expect(creado.pedido).toMatchObject({ evento: 'pedido.creado', eventoOrigen: 'order.created', numero: '1024', total: '150.00', moneda: 'PEN', nombre: 'Maria Quispe', telefono: '987 654 321', seguimiento: 'ABC123', items: '1 x Zapato negro 40, 2 x Correa' });
    expect(leerWooCommerce({ 'x-wc-webhook-topic': 'order.updated' }, PEDIDO_WOO).pedido?.evento).toBe('pedido.pagado');
    expect(leerWooCommerce({ 'x-wc-webhook-topic': 'order.updated' }, { ...PEDIDO_WOO, status: 'completed' }).pedido?.evento).toBe('pedido.completado');
    expect(leerWooCommerce({ 'x-wc-webhook-topic': 'order.updated' }, { ...PEDIDO_WOO, status: 'cancelled' }).pedido?.evento).toBe('pedido.cancelado');
    expect(leerWooCommerce({ 'x-wc-webhook-topic': 'order.updated' }, { ...PEDIDO_WOO, status: 'on-hold' }).pedido?.evento).toBe('pedido.actualizado');
    expect(leerWooCommerce({ 'x-wc-webhook-topic': 'product.updated' }, {})).toEqual({ ignorado: 'product.updated' });
    expect(leerWooCommerce({}, { webhook_id: 5 })).toEqual({ ping: true });
  });

  it('Shopify: el topic dice el evento; el telefono se busca en cuatro sitios', () => {
    const pagado = leerShopify({ 'x-shopify-topic': 'orders/paid' }, PEDIDO_SHOPIFY);
    expect(pagado.pedido).toMatchObject({ evento: 'pedido.pagado', numero: '1001', total: '199.90', nombre: 'Luis Torres', telefono: '+51 912 345 678', seguimiento: 'https://courier.test/TRK-9', estado: 'paid', items: '3 x Polo blanco M' });
    expect(leerShopify({ 'x-shopify-topic': 'orders/fulfilled' }, PEDIDO_SHOPIFY).pedido?.evento).toBe('pedido.enviado');
    expect(leerShopify({ 'x-shopify-topic': 'orders/create' }, PEDIDO_SHOPIFY).pedido?.evento).toBe('pedido.creado');
    expect(leerShopify({ 'x-shopify-topic': 'orders/cancelled' }, PEDIDO_SHOPIFY).pedido?.evento).toBe('pedido.cancelado');
    expect(leerShopify({ 'x-shopify-topic': 'orders/updated' }, PEDIDO_SHOPIFY).pedido?.evento).toBe('pedido.actualizado');
    expect(leerShopify({ 'x-shopify-topic': 'products/create' }, {})).toEqual({ ignorado: 'products/create' });
    // Sin telefono en el cliente, se mira el del envio.
    const sinCliente = leerShopify({ 'x-shopify-topic': 'orders/create' }, { ...PEDIDO_SHOPIFY, customer: {}, shipping_address: { phone: '999888777' } });
    expect(sinCliente.pedido?.telefono).toBe('999888777');
  });

  it('las variables se rellenan y lo desconocido se deja como esta', () => {
    const p = leerWooCommerce({ 'x-wc-webhook-topic': 'order.created' }, PEDIDO_WOO).pedido!;
    expect(rellenar('Hola {nombre}, tu pedido {numero} de {tienda} ({total} {moneda}) {seguimiento} {otra}', p, 'La Tienda')).toBe('Hola Maria Quispe, tu pedido 1024 de La Tienda (150.00 PEN) ABC123 {otra}');
  });
});

describe('POST /conectores/:id (lo que pega la tienda)', () => {
  async function crear(tipo: 'woocommerce' | 'shopify', reglas: unknown[], secreto?: string) {
    const r = await app.inject({ method: 'POST', url: '/api/v1/conectores', headers: con(TODO), payload: { tipo, nombre: tipo === 'woocommerce' ? 'Tienda Woo' : 'Tienda Shopify', reglas, secreto } });
    expect(r.statusCode).toBe(201);
    return r.json() as { conector: { id: string; url: string }; secreto: string };
  }
  const mandarWoo = (id: string, secreto: string, topic: string, cuerpo: unknown, firma?: string) => {
    const raw = JSON.stringify(cuerpo);
    return app.inject({ method: 'POST', url: `/conectores/${id}`, headers: { 'content-type': 'application/json', 'x-wc-webhook-topic': topic, 'x-wc-webhook-signature': firma ?? firmaBase64(secreto, raw) }, payload: raw });
  };

  it('WooCommerce: pedido nuevo → plantilla con las variables rellenas, consentimiento escrito y entrada anotada', async () => {
    const { conector, secreto } = await crear('woocommerce', [{ evento: 'pedido.creado', plantilla: { nombre: 'confirmacion_pedido' }, variables: ['{nombre}', '{numero}'] }]);
    expect(secreto.startsWith('wcs_')).toBe(true);
    expect(conector.url).toBe(`http://localhost:3000/conectores/${conector.id}`);

    const r = await mandarWoo(conector.id, secreto, 'order.created', PEDIDO_WOO);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, evento: 'pedido.creado', resultado: 'enviado' });
    // El telefono sin prefijo quedo con el 51 del plan peruano.
    expect(wa.sent[0]).toMatchObject({ to: '51987654321', name: 'confirmacion_pedido' });
    expect(JSON.stringify(wa.sent[0])).toContain('Maria Quispe');
    const c = await repos.contacts.getByPhone('51987654321');
    expect(c).toMatchObject({ name: 'Maria Quispe', optInSource: 'pedido 1024 en Tienda Woo' });

    const entradas = await app.inject({ method: 'GET', url: `/api/v1/conectores/${conector.id}/entradas`, headers: con(TODO) });
    expect(entradas.json().entradas[0]).toMatchObject({ evento: 'pedido.creado', eventoOrigen: 'order.created', pedido: '1024', telefono: '51987654321', resultado: 'enviado' });
    const lista = await app.inject({ method: 'GET', url: '/api/v1/conectores', headers: con(TODO) });
    expect(lista.json().conectores[0]).toMatchObject({ eventosRecibidos: 1, tipo: 'woocommerce' });
    expect(JSON.stringify(lista.json())).not.toContain(secreto);
  });

  it('firma mala → 401 y no sale nada; el ping de alta → 200', async () => {
    const { conector, secreto } = await crear('woocommerce', [{ evento: 'pedido.creado', texto: 'hola' }]);
    const mal = await mandarWoo(conector.id, secreto, 'order.created', PEDIDO_WOO, 'firma-falsa');
    expect(mal.statusCode).toBe(401);
    expect(wa.sent).toHaveLength(0);
    const ping = await mandarWoo(conector.id, secreto, '', { webhook_id: 7 });
    expect(ping.json()).toEqual({ ok: true, ping: true });
    expect((await app.inject({ method: 'POST', url: '/conectores/no-existe', payload: {} })).statusCode).toBe(404);
  });

  it('sin regla para ese evento, sin telefono o conector pausado: se apunta y se contesta 200', async () => {
    const { conector, secreto } = await crear('woocommerce', [{ evento: 'pedido.creado', plantilla: { nombre: 'confirmacion_pedido' }, variables: ['{nombre}', '{numero}'] }]);
    const sinRegla = await mandarWoo(conector.id, secreto, 'order.updated', { ...PEDIDO_WOO, status: 'completed' });
    expect(sinRegla.json()).toMatchObject({ resultado: 'sin_regla' });
    const sinTel = await mandarWoo(conector.id, secreto, 'order.created', { ...PEDIDO_WOO, billing: { first_name: 'X' } });
    expect(sinTel.json()).toMatchObject({ resultado: 'sin_telefono' });
    const telMalo = await mandarWoo(conector.id, secreto, 'order.created', { ...PEDIDO_WOO, billing: { phone: '12' } });
    expect(telMalo.json()).toMatchObject({ resultado: 'sin_telefono' });
    expect(telMalo.json().detalle).toContain('numero_corto');

    await app.inject({ method: 'PATCH', url: `/api/v1/conectores/${conector.id}`, headers: con(TODO), payload: { activo: false } });
    const pausado = await mandarWoo(conector.id, secreto, 'order.created', PEDIDO_WOO);
    expect(pausado.json()).toMatchObject({ ok: true, ignorado: 'conector pausado' });
    expect(wa.sent).toHaveLength(0);
    const entradas = (await app.inject({ method: 'GET', url: `/api/v1/conectores/${conector.id}/entradas`, headers: con(TODO) })).json().entradas as Array<{ resultado: string }>;
    expect(entradas.map((e) => e.resultado)).toEqual(['ignorado', 'sin_telefono', 'sin_telefono', 'sin_regla']);
  });

  it('Shopify: se usa el secreto que da Shopify, el topic manda y el pedido sale', async () => {
    const { conector, secreto } = await crear('shopify', [{ evento: 'pedido.enviado', plantilla: { nombre: 'confirmacion_pedido' }, variables: ['{nombre}', '{numero} ({seguimiento})'] }], 'shpss_secreto_de_shopify_123');
    expect(secreto).toBe('shpss_secreto_de_shopify_123');
    const raw = JSON.stringify(PEDIDO_SHOPIFY);
    const r = await app.inject({
      method: 'POST',
      url: `/conectores/${conector.id}`,
      headers: { 'content-type': 'application/json', 'x-shopify-topic': 'orders/fulfilled', 'x-shopify-hmac-sha256': firmaBase64(secreto, raw), 'x-shopify-shop-domain': 'tienda.myshopify.com' },
      payload: raw,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ evento: 'pedido.enviado', resultado: 'enviado' });
    expect(wa.sent[0]).toMatchObject({ to: '51912345678' });
    expect(JSON.stringify(wa.sent[0])).toContain('1001 (https://courier.test/TRK-9)');
  });

  it('una regla con plantilla que no existe deja error, no un 500', async () => {
    const { conector, secreto } = await crear('woocommerce', [{ evento: 'pedido.creado', plantilla: { nombre: 'no_existe' } }]);
    const r = await mandarWoo(conector.id, secreto, 'order.created', PEDIDO_WOO);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ resultado: 'error' });
    expect(r.json().detalle).toContain('no_existe');
  });
});

describe('gestion por la API', () => {
  it('opciones, crear, cambiar reglas, secreto nuevo, probar y borrar', async () => {
    const op = await app.inject({ method: 'GET', url: '/api/v1/conectores/opciones', headers: con(TODO) });
    expect(op.json()).toMatchObject({ tipos: ['woocommerce', 'shopify'] });
    expect(op.json().plantillas.map((p: { nombre: string }) => p.nombre)).toEqual(['confirmacion_pedido']);
    expect(op.json().variables).toContain('numero');

    const malTipo = await app.inject({ method: 'POST', url: '/api/v1/conectores', headers: con(TODO), payload: { tipo: 'magento', nombre: 'x' } });
    expect(malTipo.statusCode).toBe(400);
    const malEvento = await app.inject({ method: 'POST', url: '/api/v1/conectores', headers: con(TODO), payload: { tipo: 'shopify', nombre: 'x', reglas: [{ evento: 'pedido.volado' }] } });
    expect(malEvento.statusCode).toBe(400);

    const alta = await app.inject({ method: 'POST', url: '/api/v1/conectores', headers: con(TODO), payload: { tipo: 'woocommerce', nombre: 'Woo' } });
    const id = alta.json().conector.id as string;
    const cambio = await app.inject({ method: 'PATCH', url: `/api/v1/conectores/${id}`, headers: con(TODO), payload: { nombre: 'Woo 2', reglas: [{ evento: 'pedido.creado', texto: 'Gracias {nombre}, pedido {numero}' }] } });
    expect(cambio.json().conector).toMatchObject({ nombre: 'Woo 2', reglas: [{ evento: 'pedido.creado', activo: true, texto: 'Gracias {nombre}, pedido {numero}', plantilla: null, variables: [] }] });

    const rotado = await app.inject({ method: 'POST', url: `/api/v1/conectores/${id}/secreto`, headers: con(TODO), payload: {} });
    expect(rotado.json().secreto.startsWith('wcs_')).toBe(true);
    const puesto = await app.inject({ method: 'POST', url: `/api/v1/conectores/${id}/secreto`, headers: con(TODO), payload: { secreto: 'shpss_el_de_shopify' } });
    expect(puesto.json().secreto).toBe('shpss_el_de_shopify');

    // Probar: con la API de Meta y una regla solo de texto a alguien que nunca
    // escribio, la ventana esta cerrada: la guarda lo frena y se dice.
    const prueba = await app.inject({ method: 'POST', url: `/api/v1/conectores/${id}/probar`, headers: con(TODO), payload: { telefono: '987654321', evento: 'pedido.creado' } });
    expect(prueba.statusCode).toBe(200);
    expect(prueba.json()).toMatchObject({ ok: false, resultado: 'bloqueado', telefono: '51987654321' });
    expect(prueba.json().detalle).toContain('window_closed');

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/conectores/${id}`, headers: con(TODO) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/conectores/${id}`, headers: con(TODO) })).statusCode).toBe(404);
  });

  it('exige el permiso conectores:gestionar', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/conectores', headers: { authorization: 'Bearer wak_noExiste00000000000000000000000000' } });
    expect(r.statusCode).toBe(401);
  });
});
