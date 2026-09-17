/**
 * El catalogo real y los pedidos desde el chat.
 *
 * Con un catalogo de mentira (la forma de Elysian, la de WooCommerce y la
 * simple) se comprueba que el asistente vea precio, stock y enlace de
 * productos que existen, y que cuando cierra una venta el pedido se guarde
 * con los precios del catalogo, se anuncie a la tienda y se le confirme al
 * cliente con el total del sistema, nunca el que dijo el modelo.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender, type Sender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService } from '../src/settings/service.js';
import { crearBus } from '../src/eventos/bus.js';
import { observarRepos } from '../src/eventos/observar.js';
import { crearServicioIA, type ServicioIA } from '../src/ia/servicio.js';
import type { MensajeIA, ProveedorIA } from '../src/ia/proveedores.js';
import { crearCatalogoTienda, detectarFormato, leerCatalogo, lineaDeProducto } from '../src/catalogo/tienda.js';
import { extraerPedido, resumenDePedido } from '../src/pedidos/servicio.js';
import { createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos, type FakeWhatsApp, CLAVE_API_PRUEBA as TODO } from './fakes.js';

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
  BUSINESS_NAME: 'Elysian',
  RUTAS_SUPERVISOR: '51900000000',
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

const config = loadConfig(ENV);
const con = (clave: string) => ({ authorization: `Bearer ${clave}`, 'content-type': 'application/json' });

/** La API de productos de Elysian, de mentira: dos paginas. */
const ELYSIAN_P1 = {
  items: [
    { id: 44, name: 'Casio Edifice Slim EFR-S108D', slug: 'efr-s108d-2av', active: true, brand: { name: 'Edifice' }, images: [{ url: '/uploads/a.avif' }], variants: [{ id: 44, name: 'Acero / Esfera azul', sku: 'EFR-S108D-2AV', price: '1000', salePrice: '749', stock: 13, active: true }] },
    { id: 45, name: 'Casio Vintage LA670WA · Plateado / Cara azul', slug: 'la670wa-2df', active: true, brand: { name: 'Casio' }, images: [], variants: [{ id: 45, name: 'Plateado / Cara azul', sku: 'LA670WA-2DF', price: '199', salePrice: null, stock: 0, active: true }] },
  ],
  total: 3,
  page: 1,
  pageSize: 2,
  totalPages: 2,
};
const ELYSIAN_P2 = { items: [{ id: 46, name: 'Citizen Tsuyosa Automático', slug: 'nj0151-51x', active: true, brand: { name: 'Citizen' }, images: [], variants: [{ id: 46, name: 'Dorado', sku: 'NJ0153-51X', price: '2299', salePrice: null, stock: 10, active: true }] }], total: 3, page: 2, pageSize: 2, totalPages: 2 };

const fetchElysian = (async (url: string | URL | Request) => {
  const u = new URL(String(url));
  return new Response(JSON.stringify(u.searchParams.get('page') === '2' ? ELYSIAN_P2 : ELYSIAN_P1), { status: 200 });
}) as unknown as typeof fetch;

describe('leer el catalogo de la tienda', () => {
  it('Elysian: una linea por variante, precio de oferta, stock, enlace absoluto y sin repetir la variante', () => {
    expect(detectarFormato(ELYSIAN_P1)).toBe('elysian');
    const p = leerCatalogo(ELYSIAN_P1, { base: 'https://elysian.pe' });
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ sku: 'EFR-S108D-2AV', name: 'Casio Edifice Slim EFR-S108D — Acero / Esfera azul', price: 749, precioNormal: 1000, stock: 13, url: 'https://elysian.pe/producto/efr-s108d-2av', imagen: 'https://elysian.pe/uploads/a.avif' });
    expect(p[1]!.name).toBe('Casio Vintage LA670WA · Plateado / Cara azul');
    expect(lineaDeProducto(p[0]!)).toBe('- Casio Edifice Slim EFR-S108D — Acero / Esfera azul [EFR-S108D-2AV]: 749 (antes 1000) · stock 13 · https://elysian.pe/producto/efr-s108d-2av');
    expect(lineaDeProducto(p[1]!)).toContain('AGOTADO');
  });

  it('WooCommerce Store API y la lista simple', () => {
    const woo = [{ id: 7, name: 'Polo blanco', permalink: 'https://tienda.com/polo', prices: { price: '4990', regular_price: '5990', currency_minor_unit: 2 }, is_in_stock: true, images: [{ src: 'https://tienda.com/p.jpg' }] }];
    expect(detectarFormato(woo)).toBe('woocommerce');
    expect(leerCatalogo(woo, { base: 'https://tienda.com' })[0]).toMatchObject({ sku: '7', name: 'Polo blanco', price: 49.9, precioNormal: 59.9, stock: 1, url: 'https://tienda.com/polo' });
    const simple = [{ sku: 'A1', nombre: 'Zapato negro 40', precio: 'S/ 120', stock: 3, url: '/p/a1' }, { name: 'Sin sku', price: 10 }];
    expect(detectarFormato(simple)).toBe('simple');
    const s = leerCatalogo(simple, { base: 'https://z.com' });
    expect(s[0]).toMatchObject({ sku: 'A1', price: 120, stock: 3, url: 'https://z.com/p/a1' });
    expect(s[1]).toMatchObject({ sku: 'Sin sku', price: 10, stock: 1 });
  });

  it('sigue las paginas, cachea, busca y saca el contexto para el modelo', async () => {
    const cat = crearCatalogoTienda({ url: 'https://elysian.pe/api/products', fetchImpl: fetchElysian });
    expect(await cat.precargar()).toEqual({ ok: true, total: 3 });
    expect((await cat.buscar('edifice azul', 2))[0]?.sku).toBe('EFR-S108D-2AV');
    expect((await cat.porSku('nj0153-51x'))?.name).toContain('Citizen');
    const ctx = await cat.contextoPara('tienen casio azul?');
    expect(ctx).toContain('[EFR-S108D-2AV]');
    expect(ctx).toContain('https://elysian.pe/producto/efr-s108d-2av');
    expect(await cat.contextoPara('bicicleta montañera')).toBeNull();
    const c = await cat.consultar('casio');
    expect(c.disponibles.map((p) => p.sku)).toContain('EFR-S108D-2AV');
  });
});

describe('leer el pedido que cierra el modelo', () => {
  it('saca el JSON tras la marca y deja el texto limpio; sin JSON o roto, lo dice', () => {
    const r = extraerPedido('Perfecto, te resumo: 1 Edifice azul a Miraflores, pago Yape. ¿Confirmas? [PEDIDO]{"items":[{"sku":"EFR-S108D-2AV","cantidad":1}],"nombre":"Maria","direccion":"Av. Larco 123, Miraflores","pago":"yape"} gracias');
    expect(r.texto.startsWith('Perfecto, te resumo: 1 Edifice azul a Miraflores, pago Yape. ¿Confirmas?')).toBe(true);
    expect(r.texto.endsWith('gracias')).toBe(true);
    expect(r.pedido).toMatchObject({ nombre: 'Maria', pago: 'yape', items: [{ sku: 'EFR-S108D-2AV', cantidad: 1 }] });
    expect(extraerPedido('Hola sin pedido').pedido).toBeNull();
    expect(extraerPedido('Listo [PEDIDO]{"items":[{"sku":"X"').error).toContain('cortado');
    expect(extraerPedido('Listo [PEDIDO]{"nombre":"x"}').error).toContain('items');
    expect(resumenDePedido({ items: [{ sku: 'a', nombre: 'Reloj', cantidad: 2, precio: 100, subtotal: 200 }], total: 200, moneda: 'PEN', nombre: 'Maria', direccion: 'Lima', pago: 'yape' })).toContain('Total: S/ 200.00');
  });
});

describe('el asistente con el catalogo real cierra ventas', () => {
  let app: FastifyInstance;
  let repos: FakeRepos;
  let wa: FakeWhatsApp;
  let ia: ServicioIA;
  let bus: ReturnType<typeof crearBus>;
  const modelo = { siguiente: '', recibido: [] as MensajeIA[][] };
  const proveedor: ProveedorIA = {
    nombre: 'falso',
    async chat(m) {
      modelo.recibido.push(m);
      return modelo.siguiente;
    },
  };
  const enviados = () => wa.sent.filter((s) => s.kind !== 'read');

  async function build() {
    bus = crearBus();
    repos = observarRepos(createFakeRepos(), bus) as FakeRepos;
    wa = createFakeWhatsApp();
    const sender: Sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    const settingsRepo = createMemorySettingsRepo();
    const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
    ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Elysian', supervisor: () => '51900000000', proveedor, fetchImpl: fetchElysian, bus, modelosGratis: ['google/gemma-4-31b-it'] });
    await ia.guardar({ activa: true, token: 'tok', conocimiento: 'Relojes originales. Pago con Yape o tarjeta. Envio a Lima 24 h.', catalogoUrl: 'https://elysian.pe/api/products' });
    app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, ia, bus });
    await app.ready();
  }

  beforeAll(build);
  afterAll(async () => app.close());
  beforeEach(async () => {
    await app.close();
    modelo.recibido = [];
    await build();
  });

  async function cliente() {
    const c = await repos.contacts.upsertFromInbound('51987654321', 'Maria');
    await repos.contacts.setOptIn(c.phone, 'prueba');
    await repos.contacts.touchInbound(c.phone, new Date());
    return c;
  }

  it('el prompt lleva los productos reales que casan con la pregunta y las instrucciones para tomar pedidos', async () => {
    const c = await cliente();
    modelo.siguiente = 'El Edifice azul está a S/ 749 (antes 1000), quedan 13. Míralo: https://elysian.pe/producto/efr-s108d-2av';
    await ia.turno(c, 'tienen el casio edifice azul?');
    const sistema = modelo.recibido[0]![0]!.content;
    expect(sistema).toContain('[EFR-S108D-2AV]: 749 (antes 1000) · stock 13');
    expect(sistema).toContain('Puedes TOMAR PEDIDOS');
    expect(sistema).toContain('[PEDIDO]');
    expect(ia.estado().catalogoUrl).toBe('https://elysian.pe/api/products');
    expect(await ia.probarCatalogo()).toMatchObject({ ok: true, total: 3 });
  });

  it('cierra el pedido: precios del catalogo, resumen al cliente, evento a la tienda, aviso al supervisor y visible en el panel', async () => {
    const c = await cliente();
    const eventos: unknown[] = [];
    bus.escuchar('pedido.creado', (p) => {
      eventos.push(p);
    });
    // El modelo dice un precio equivocado a proposito: manda el del catalogo.
    modelo.siguiente = 'Perfecto, te resumo: 2 Edifice azul a S/ 500 cada uno, a Av. Larco 123, pago Yape. ¿Confirmas? [PEDIDO]{"items":[{"sku":"EFR-S108D-2AV","nombre":"Casio Edifice","cantidad":2},{"nombre":"reloj inexistente 999","cantidad":1}],"nombre":"Maria Quispe","direccion":"Av. Larco 123, Miraflores","pago":"yape","notas":"para regalo"}';
    const r = await ia.turno(c, 'dale, quiero dos');
    expect(r.resultado).toBe('respondio');
    expect(r.detalle).toMatch(/^pedido \d+$/);

    const textos = enviados().map((s) => String(s.body));
    expect(textos[0]).toBe('Perfecto, te resumo: 2 Edifice azul a S/ 500 cada uno, a Av. Larco 123, pago Yape. ¿Confirmas?');
    expect(textos[1]).toContain('2 x Casio Edifice Slim EFR-S108D — Acero / Esfera azul — S/ 1498.00');
    expect(textos[1]).toContain('Total: S/ 1498.00');
    expect(textos[1]).toContain('Entrega: Av. Larco 123, Miraflores');
    expect(textos[1]).toContain('No encontré: reloj inexistente 999');
    expect(enviados().find((s) => s.to === '51900000000')?.body).toContain('tomo un pedido');

    const guardado = repos.pedidos._pedidos[0]!;
    expect(guardado).toMatchObject({ estado: 'nuevo', total: 1498, nombre: 'Maria Quispe', direccion: 'Av. Larco 123, Miraflores', pago: 'yape', origen: 'ia', telefono: '51987654321' });
    expect(guardado.items).toEqual([{ sku: 'EFR-S108D-2AV', nombre: 'Casio Edifice Slim EFR-S108D — Acero / Esfera azul', cantidad: 2, precio: 749, subtotal: 1498, url: 'https://elysian.pe/producto/efr-s108d-2av' }]);
    expect(guardado.notas).toContain('para regalo');
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ pedido: { id: guardado.id, total: 1498 }, contacto: { telefono: '51987654321' } });
    // El bot NO se pausa: el cliente puede seguir hablando.
    expect((await repos.contacts.getById(c.id))!.botPausadoAt).toBeFalsy();

    const lista = await app.inject({ method: 'GET', url: '/api/v1/pedidos', headers: con(TODO) });
    expect(lista.json().pedidos[0]).toMatchObject({ id: guardado.id, contactoTelefono: '51987654321', estado: 'nuevo' });
    expect(lista.json().porEstado).toEqual({ nuevo: 1 });
    const cambio = await app.inject({ method: 'PATCH', url: `/api/v1/pedidos/${guardado.id}`, headers: con(TODO), payload: { estado: 'enviado_tienda', externoId: 'EL-1001' } });
    expect(cambio.json().pedido).toMatchObject({ estado: 'enviado_tienda', externoId: 'EL-1001' });
  });

  it('si ningun producto existe, no se guarda nada y se le pide el nombre tal como esta en la web', async () => {
    const c = await cliente();
    modelo.siguiente = 'Listo. [PEDIDO]{"items":[{"nombre":"bicicleta montañera","cantidad":1}],"nombre":"Maria"}';
    const r = await ia.turno(c, 'quiero la bicicleta');
    expect(r.detalle).toContain('pedido no registrado');
    expect(repos.pedidos._pedidos).toHaveLength(0);
    expect(enviados().map((s) => String(s.body)).at(-1)).toContain('No encontré esos productos');
  });
});
