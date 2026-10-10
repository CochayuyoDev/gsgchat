/**
 * Lo que Meta cambia en 2026 y el sistema tiene que saber (ver
 * src/whatsapp/avisos-meta.ts):
 *  - los avisos con fecha (metodo de pago antes del 30/09/2026, registro
 *    incorporado v4 antes del 15/10/2026, Graph v21 hasta el 21/01/2027),
 *    solo con la API oficial, y marcables como hechos;
 *  - el limite de mensajeria por portafolio: campo nuevo del numero (con
 *    vuelta al viejo si Graph no lo conoce) y del webhook;
 *  - el reparto dentro de la ventana de 24 h manda texto con boton (servicio,
 *    con franquicia) y no plantilla (utilidad, sin ella), aunque el
 *    proveedor sea Meta.
 */

import { describe, expect, it } from 'vitest';
import { avisosDeMeta, FECHA_METODO_PAGO, FECHA_REGISTRO_V4, numeroDeGraph } from '../src/whatsapp/avisos-meta.js';
import { createWhatsAppClient } from '../src/whatsapp/client.js';
import { processChange } from '../src/whatsapp/webhook.js';
import { loadConfig } from '../src/config.js';
import { crearMotor, OPCIONES_POR_DEFECTO, type OpcionesMotor } from '../src/rutas/motor.js';
import { crearPuertoEnEspera } from '../src/rutas/gsg.js';
import { ajustesGeneralesPatchSchema, fusionarAjustes, AJUSTES_GENERALES_VACIOS } from '../src/ajustes/generales.js';
import type { SendJob, SendOutcome, Sender } from '../src/outbound/sender.js';
import { createSender } from '../src/outbound/sender.js';
import { approvedTemplate, createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos } from './fakes.js';

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'none',
} as NodeJS.ProcessEnv;

describe('los avisos con fecha de Meta', () => {
  const hoy = new Date('2026-09-18T12:00:00-05:00');

  it('solo con la API oficial; con QR o WAHA no hay ninguno', () => {
    expect(avisosDeMeta({ ahora: hoy, proveedor: 'local', graphVersion: 'v21.0', hechos: {} })).toEqual([]);
    expect(avisosDeMeta({ ahora: hoy, proveedor: 'waha', graphVersion: 'v21.0', hechos: {} })).toEqual([]);
    expect(avisosDeMeta({ ahora: hoy, proveedor: 'cloud', graphVersion: 'v25.0', hechos: {} })).toHaveLength(3);
  });

  it('el metodo de pago y el registro v4 urgen a menos de 30 dias, vencen despues de su fecha y se marcan como hechos', () => {
    const a = avisosDeMeta({ ahora: hoy, proveedor: 'cloud', graphVersion: 'v25.0', hechos: {} });
    const pago = a.find((x) => x.id === 'metodoPago')!;
    expect(pago).toMatchObject({ limite: FECHA_METODO_PAGO, estado: 'urgente', diasRestantes: 12, marcable: true, hechoEl: null });
    expect(pago.detalle).toContain('1 000');
    expect(pago.detalle).toContain('S/ 0,0998');
    const v4 = a.find((x) => x.id === 'registroV4')!;
    expect(v4).toMatchObject({ limite: FECHA_REGISTRO_V4, estado: 'urgente', diasRestantes: 27 });
    expect(v4.detalle).toContain('Facebook Login for Business');

    // Pasada la fecha, vencido; marcado, hecho (con su fecha).
    const despues = avisosDeMeta({ ahora: new Date('2026-10-20T12:00:00-05:00'), proveedor: 'cloud', graphVersion: 'v25.0', hechos: { metodoPagoEl: '2026-09-20T10:00:00.000Z' } });
    expect(despues.find((x) => x.id === 'metodoPago')).toMatchObject({ estado: 'hecho', hechoEl: '2026-09-20T10:00:00.000Z' });
    expect(despues.find((x) => x.id === 'registroV4')).toMatchObject({ estado: 'vencido' });
    expect(despues.find((x) => x.id === 'registroV4')!.diasRestantes).toBeLessThan(0);

    // Con mas de un mes por delante, pendiente sin prisa.
    const antes = avisosDeMeta({ ahora: new Date('2026-07-01T12:00:00-05:00'), proveedor: 'cloud', graphVersion: 'v25.0', hechos: {} });
    expect(antes.find((x) => x.id === 'metodoPago')!.estado).toBe('pendiente');
  });

  it('Graph: al dia desde la v24 (limite por portafolio); una version vieja fijada en el .env avisa con la fecha', () => {
    expect(numeroDeGraph('v25.0')).toBe(25);
    expect(numeroDeGraph('21.0')).toBe(21);
    expect(numeroDeGraph('')).toBe(0);
    const alDia = avisosDeMeta({ ahora: hoy, proveedor: 'cloud', graphVersion: 'v25.0', hechos: {} }).find((x) => x.id === 'graphVersion')!;
    expect(alDia).toMatchObject({ estado: 'ok', marcable: false });
    const vieja = avisosDeMeta({ ahora: hoy, proveedor: 'cloud', graphVersion: 'v21.0', hechos: {} }).find((x) => x.id === 'graphVersion')!;
    expect(vieja.estado).toBe('pendiente');
    expect(vieja.titulo).toContain('v21.0');
    expect(vieja.detalle).toContain('GRAPH_API_VERSION');
    expect(avisosDeMeta({ ahora: new Date('2027-01-25T12:00:00-05:00'), proveedor: 'cloud', graphVersion: 'v21.0', hechos: {} }).find((x) => x.id === 'graphVersion')!.estado).toBe('vencido');
  });

  it('los hechos se acumulan en los ajustes generales: marcar uno no borra el otro', () => {
    const a = fusionarAjustes(AJUSTES_GENERALES_VACIOS, ajustesGeneralesPatchSchema.parse({ meta: { metodoPagoEl: '2026-09-20T00:00:00.000Z' } }));
    expect(a.meta).toEqual({ metodoPagoEl: '2026-09-20T00:00:00.000Z' });
    const b = fusionarAjustes(a, ajustesGeneralesPatchSchema.parse({ meta: { registroV4El: '2026-09-21T00:00:00.000Z' } }));
    expect(b.meta).toEqual({ metodoPagoEl: '2026-09-20T00:00:00.000Z', registroV4El: '2026-09-21T00:00:00.000Z' });
    expect(fusionarAjustes(b, { meta: null }).meta).toBeNull();
  });
});

describe('el limite de mensajeria por portafolio', () => {
  /** Un Graph de mentira: en v25 conoce el campo nuevo; en v21 lo rechaza como los de verdad. */
  function graphFalso(conoceCampoNuevo: boolean) {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('whatsapp_business_manager_messaging_limit') && !conoceCampoNuevo) {
        return new Response(JSON.stringify({ error: { message: '(#100) Tried accessing nonexisting field (whatsapp_business_manager_messaging_limit) on node type (WhatsAppBusinessPhoneNumber)', code: 100 } }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      const cuerpo = conoceCampoNuevo
        ? { display_phone_number: '+51 987 654 321', verified_name: 'Zapateria', quality_rating: 'GREEN', whatsapp_business_manager_messaging_limit: 'TIER_2K', is_on_biz_app: true, platform_type: 'CLOUD_API' }
        : { display_phone_number: '+51 987 654 321', verified_name: 'Zapateria', quality_rating: 'GREEN', messaging_limit_tier: 'TIER_1K' };
      return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return { fetchImpl, urls };
  }

  it('el numero se pide con el campo nuevo (y si esta en el celular, se dice)', async () => {
    const g = graphFalso(true);
    const wa = createWhatsAppClient({ token: 't', phoneNumberId: 'PNID', businessAccountId: 'WABA', fetchImpl: g.fetchImpl });
    const n = await wa.getPhoneNumber();
    expect(n).toMatchObject({ messagingLimitTier: 'TIER_2K', enLaApp: true, plataforma: 'CLOUD_API', qualityRating: 'GREEN' });
    expect(g.urls[0]).toContain('/v25.0/PNID?fields=');
    expect(g.urls[0]).toContain('whatsapp_business_manager_messaging_limit');
    expect(g.urls).toHaveLength(1);
  });

  it('con una Graph vieja que no conoce el campo, se vuelve a pedir como antes', async () => {
    const g = graphFalso(false);
    const wa = createWhatsAppClient({ token: 't', phoneNumberId: 'PNID', businessAccountId: 'WABA', graphVersion: 'v21.0', fetchImpl: g.fetchImpl });
    const n = await wa.getPhoneNumber();
    expect(n).toMatchObject({ messagingLimitTier: 'TIER_1K', enLaApp: null, plataforma: '' });
    expect(g.urls).toHaveLength(2);
    expect(g.urls[1]).toContain('messaging_limit_tier');
    expect(g.urls[1]).not.toContain('whatsapp_business_manager');
  });

  it('el webhook entiende el campo del portafolio (v24+) y sigue entendiendo el del telefono', async () => {
    const config = loadConfig(ENV);
    const repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    const deps = { repos, wa, sender, config, settings: await createFakeSettings(config) };
    await processChange('business_capability_update', { max_daily_conversations_per_business: 10000, max_phone_numbers_per_business: 2 }, deps);
    expect((await repos.numberState.get('PNID')).limite24h).toBe(10000);
    await processChange('business_capability_update', { max_daily_conversation_per_phone: 2000 }, deps);
    expect((await repos.numberState.get('PNID')).limite24h).toBe(2000);
    // Si vienen los dos, manda el del portafolio.
    await processChange('business_capability_update', { max_daily_conversations_per_business: 100000, max_daily_conversation_per_phone: 2000 }, deps);
    expect((await repos.numberState.get('PNID')).limite24h).toBe(100000);
  });
});

describe('el reparto dentro de la ventana de 24 h', () => {
  const HORA_BUENA = new Date('2026-03-10T15:00:00Z'); // martes 10:00 en Lima
  const opciones: OpcionesMotor = { ...OPCIONES_POR_DEFECTO, timezone: 'America/Lima' };

  function senderFalso() {
    const enviados: SendJob[] = [];
    const sender: Sender = {
      async send(job) {
        enviados.push(job);
        return { ok: true, wamid: `wamid.${enviados.length}`, deliveryId: enviados.length } as SendOutcome;
      },
    };
    return { sender, enviados };
  }

  async function loteListo(repos: FakeRepos, telefonos: string[]) {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto de prueba' });
    await repos.rutas.agregarSolicitudes(lote.id, telefonos.map((t, i) => ({ telefonoCrudo: t, phone: t, nombre: `Cliente ${i + 1}`, referencia: `P-${i + 1}` })));
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
    return lote;
  }

  it('con Meta y el cliente escribiendo hace menos de 24 h, sale texto con boton (servicio) y no plantilla (utilidad)', async () => {
    const repos = createFakeRepos();
    await loteListo(repos, ['51987654321']);
    await repos.templates.upsert(approvedTemplate({ name: 'solicitud_ubicacion', language: 'es', category: 'UTILITY', variables: 3, quality: 'GREEN' }));
    await repos.contacts.upsertFromInbound('51987654321', 'Ana');
    await repos.contacts.touchInbound('51987654321', new Date(HORA_BUENA.getTime() - 2 * 60 * 60 * 1000));
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones, usarPlantilla: () => true, ahora: () => HORA_BUENA, azar: () => 0 });
    const salida = await motor.tick();
    expect(salida.accion).toBe('envio');
    expect(enviados[0]).toMatchObject({ kind: 'interactive', interactive: { locationRequest: true } });
    const eventos = await repos.rutas.eventos(salida.solicitudId!);
    expect(eventos.find((e) => e.tipo === 'envio')!.payload).toMatchObject({ via: expect.stringContaining('ventana abierta') });
  });

  it('con la ventana cerrada (escribio hace dos dias, o nunca), plantilla como siempre', async () => {
    const repos = createFakeRepos();
    await loteListo(repos, ['51987654321', '51987654322']);
    await repos.templates.upsert(approvedTemplate({ name: 'solicitud_ubicacion', language: 'es', category: 'UTILITY', variables: 3, quality: 'GREEN' }));
    await repos.contacts.upsertFromInbound('51987654321', 'Ana');
    await repos.contacts.touchInbound('51987654321', new Date(HORA_BUENA.getTime() - 2 * 24 * 60 * 60 * 1000));
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones: { ...opciones, pausaMinSegundos: 0, pausaMaxSegundos: 0 }, usarPlantilla: () => true, ahora: () => HORA_BUENA, azar: () => 0 });
    expect((await motor.tick()).accion).toBe('envio');
    expect(enviados[0]).toMatchObject({ kind: 'template', templateName: 'solicitud_ubicacion' });
  });
});
