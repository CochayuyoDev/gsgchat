/**
 * ¿Le llegó el mensaje al cliente? (caso del 11/11)
 *
 * A una clienta se le mandaron tres mensajes pidiendo su ubicación. Meta los
 * aceptó al enviarlos y después avisó por el webhook que no los entregaba.
 * GSG, que toma la base de GSGchat como la verdad, los pintaba como enviados;
 * el reparto los contó como intentos («no contestó a 3 mensajes») y nadie supo
 * que había que llamarla.
 *
 * Aquí se fija lo que tiene que pasar ahora:
 *  - la API dice en cada mensaje si llegó (`llegoAWhatsapp`: true / null); lo
 *    que no llegó no sale a GSG (regla de GSG, 12/11): desaparece del historial
 *    y del hilo, y su mensaje.estado no se encola a los webhooks;
 *  - un acuse que llega antes que el mensaje no se pierde;
 *  - volver a guardar un mensaje no le baja el estado;
 *  - el reparto no cuenta como intento un mensaje que no llegó y lo pasa a
 *    incidencia con el motivo; el primer mensaje del pedido queda «fallido».
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entregaDelMensaje, MINUTOS_SIN_CONFIRMAR_PREOCUPANTE } from '../src/whatsapp/estado-entrega.js';
import { EstadosAdelantados } from '../src/db/messages.js';
import { createFakeRepos, createFakeWhatsApp } from './fakes.js';
import { createSender } from '../src/outbound/sender.js';
import { processChange } from '../src/whatsapp/webhook.js';
import { observarRepos } from '../src/eventos/observar.js';
import { crearBus } from '../src/eventos/bus.js';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { mensajeNoLlego, vigilarMensajesNoEntregados } from '../src/rutas/no-llego.js';
import { respuestaDeEnvio } from '../src/api/v1/routes.js';
import { encolarEventos, esMensajeQueNoSalio } from '../src/webhooks/despachador.js';
import type { Repos } from '../src/db/repos.js';

const ahora = new Date('2026-11-11T19:00:00Z');
const hace = (min: number) => new Date(ahora.getTime() - min * 60_000);

/** El aviso de Meta: ese mensaje no se entregó. */
const fallo = (wamid: string, telefono: string, code: number, title: string) => ({
  statuses: [{ id: wamid, status: 'failed' as const, timestamp: '1', recipient_id: telefono, errors: [{ code, title }] }],
});

/** Espera a que algo se cumpla (los oyentes del bus son asíncronos). */
async function hasta(cond: () => Promise<boolean> | boolean, ms = 2_000): Promise<void> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('no se cumplió a tiempo');
}

describe('entregaDelMensaje: la respuesta única a «¿le llegó?»', () => {
  it('entregado y leído = sí; failed = no, con el motivo; sent o nada = todavía no se sabe', () => {
    expect(entregaDelMensaje({ direction: 'out', status: 'delivered' }, null, ahora)).toMatchObject({ llegoAWhatsapp: true, estado: 'entregado' });
    expect(entregaDelMensaje({ direction: 'out', status: 'read' }, null, ahora)).toMatchObject({ llegoAWhatsapp: true, estado: 'leido' });
    expect(entregaDelMensaje({ direction: 'out', status: 'sent', createdAt: hace(1) }, null, ahora)).toMatchObject({ llegoAWhatsapp: null, estado: 'enviado', minutosSinConfirmar: 1 });
    expect(entregaDelMensaje({ direction: 'out', status: null, createdAt: hace(0) }, null, ahora)).toMatchObject({ llegoAWhatsapp: null, estado: 'sin_confirmar' });
    const no = entregaDelMensaje({ direction: 'out', status: 'failed' }, { code: '131047', title: 'Re-engagement message' }, ahora)!;
    expect(no).toMatchObject({ llegoAWhatsapp: false, estado: 'no_entregado', error: { codigo: '131047', tipo: 'meta', reintentar: 'no' } });
    expect(no.descripcion).toMatch(/No le llegó.*24 horas/);
  });

  it('un mensaje del cliente no lleva estado de entrega', () => {
    expect(entregaDelMensaje({ direction: 'in', status: null }, null, ahora)).toBeNull();
  });

  it('un failed sin motivo apuntado lo dice, en vez de inventarlo', () => {
    const e = entregaDelMensaje({ direction: 'out', status: 'failed' }, null, ahora)!;
    expect(e.llegoAWhatsapp).toBe(false);
    expect(e.error?.motivo).toBe('WhatsApp no dio el motivo.');
  });

  it('un bloqueo interno (no llegó a salir) también es «no llegó», con su porqué', () => {
    const e = entregaDelMensaje({ direction: 'out', status: 'blocked_by_gate' }, { code: null, title: 'allowlist: modo prueba' }, ahora)!;
    expect(e).toMatchObject({ llegoAWhatsapp: false, error: { codigo: 'allowlist', tipo: 'interno' } });
  });

  it('un mensaje sin confirmar demasiado tiempo avisa de que algo va mal; antes, no', () => {
    const poco = entregaDelMensaje({ direction: 'out', status: 'sent', createdAt: hace(MINUTOS_SIN_CONFIRMAR_PREOCUPANTE - 1) }, null, ahora)!;
    expect(poco.descripcion).not.toMatch(/Lleva/);
    const mucho = entregaDelMensaje({ direction: 'out', status: 'sent', createdAt: hace(180) }, null, ahora)!;
    expect(mucho.descripcion).toMatch(/Lleva 3 horas así/);
  });

  it('datos raros no lo rompen: fecha inválida o estado desconocido = sin confirmar', () => {
    expect(entregaDelMensaje({ direction: 'out', status: 'cualquiera', createdAt: 'no-es-fecha' }, null, ahora)).toMatchObject({ llegoAWhatsapp: null, estado: 'sin_confirmar', minutosSinConfirmar: null });
    expect(entregaDelMensaje({ direction: 'out', status: undefined }, undefined, ahora)).toMatchObject({ llegoAWhatsapp: null });
  });
});

describe('respuesta al enviar por la API', () => {
  it('aceptado = todavía sin confirmar (no «llegó»); frenado o rechazado = no llegó; sin respuesta = no se sabe', () => {
    const ok = respuestaDeEnvio({ ok: true, wamid: 'w1', deliveryId: 1 });
    expect(ok.cuerpo).toMatchObject({ ok: true, estado: 'enviado', llegoAWhatsapp: null, entrega: { estado: 'sin_confirmar' } });
    const frenado = respuestaDeEnvio({ ok: false, blocked: true, code: 'allowlist', reason: 'modo prueba', deliveryId: 2 });
    expect(frenado.cuerpo).toMatchObject({ llegoAWhatsapp: false, entrega: { estado: 'no_entregado', error: { codigo: 'allowlist' } } });
    const rechazado = respuestaDeEnvio({ ok: false, blocked: false, error: '(#131026) Message undeliverable', retryable: false, deliveryId: 3, code: '131026' });
    expect(rechazado.cuerpo).toMatchObject({ llegoAWhatsapp: false, entrega: { error: { codigo: '131026' } } });
    const incierto = respuestaDeEnvio({ ok: false, blocked: false, error: 'socket hang up', retryable: true, deliveryId: 4, incierto: true });
    expect(incierto.cuerpo).toMatchObject({ llegoAWhatsapp: null, entrega: { estado: 'sin_confirmar' } });
  });
});

describe('acuses que llegan antes que el mensaje', () => {
  it('se guardan y se aplican al guardar el mensaje; un failed manda sobre los demás', () => {
    const a = new EstadosAdelantados();
    a.guardar('w1', 'sent');
    a.guardar('w1', 'delivered');
    a.guardar('w1', 'sent');
    expect(a.tomar('w1')).toEqual({ status: 'delivered' });
    expect(a.tomar('w1')).toBeNull();
    a.guardar('w2', 'failed', { code: '131047', title: 'x' });
    a.guardar('w2', 'delivered');
    expect(a.tomar('w2')).toEqual({ status: 'failed', error: { code: '131047', title: 'x' } });
  });

  it('caducan y tienen tope de tamaño', () => {
    let t = 0;
    const a = new EstadosAdelantados(1_000, 3, () => t);
    a.guardar('viejo', 'delivered');
    t = 2_000;
    expect(a.tomar('viejo')).toBeNull();
    for (const w of ['a', 'b', 'c', 'd']) a.guardar(w, 'sent');
    expect(a.tamano).toBe(3);
    expect(a.tomar('a')).toBeNull();
    expect(a.tomar('d')).toEqual({ status: 'sent' });
  });

  it('en el repo: el failed que se adelantó queda puesto al guardar el mensaje', async () => {
    const repos = createFakeRepos();
    const c = await repos.contacts.upsertFromInbound('51900111222');
    await repos.messages.setStatusByWamid('wamid.adelantado', 'failed', { code: '131049', title: 'limit' });
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'wamid.adelantado', kind: 'text', body: 'hola', status: 'sent' });
    expect(repos.messages._all.at(-1)).toMatchObject({ wamid: 'wamid.adelantado', status: 'failed' });
  });

  it('volver a guardar un mensaje no le baja el estado ni le quita el failed', async () => {
    const repos = createFakeRepos();
    const c = await repos.contacts.upsertFromInbound('51900111223');
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'w.d', kind: 'text', body: 'a', status: 'sent' });
    await repos.messages.setStatusByWamid('w.d', 'delivered');
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'w.d', kind: 'text', body: 'a', status: 'sent' });
    expect(repos.messages._all.find((m) => m.wamid === 'w.d')!.status).toBe('delivered');
    await repos.messages.setStatusByWamid('w.d', 'failed');
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'w.d', kind: 'text', body: 'a', status: 'sent' });
    expect(repos.messages._all.find((m) => m.wamid === 'w.d')!.status).toBe('failed');
  });
});

describe('el evento mensaje.estado dice si llegó', () => {
  it('failed: llegoAWhatsapp false con el motivo; delivered: true', async () => {
    const bus = crearBus();
    const vistos: Array<Record<string, unknown>> = [];
    bus.escuchar('mensaje.estado', (p) => void vistos.push(p as unknown as Record<string, unknown>));
    const base = createFakeRepos();
    const repos = observarRepos(base, bus);
    const wa = createFakeWhatsApp();
    const sender = createSender({ repos: base, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false });
    await base.contacts.upsertFromInbound('51900222333');
    const r = await sender.send({ phone: '51900222333', kind: 'freeform', category: 'UTILITY', text: 'hola', manual: true });
    if (!r.ok) throw new Error('no salió');
    await processChange('messages', fallo(r.wamid, '51900222333', 131047, 'Re-engagement message'), { repos, settings: { current: () => ({ phoneNumberId: 'PNID' }) } } as never);
    expect(vistos.at(-1)).toMatchObject({ mensajeId: r.wamid, estado: 'failed', llegoAWhatsapp: false, entrega: { estado: 'no_entregado' }, error: { codigo: '131047' } });
    const r2 = await sender.send({ phone: '51900222333', kind: 'freeform', category: 'UTILITY', text: 'otra', manual: true });
    if (!r2.ok) throw new Error('no salió');
    await processChange('messages', { statuses: [{ id: r2.wamid, status: 'delivered', timestamp: '1', recipient_id: '51900222333' }] }, { repos, settings: { current: () => ({ phoneNumberId: 'PNID' }) } } as never);
    expect(vistos.at(-1)).toMatchObject({ mensajeId: r2.wamid, llegoAWhatsapp: true, entrega: { estado: 'entregado' } });
  });

  it('el failed se queda dentro: no se encola a los webhooks (GSG) y no lleva nota; el delivered sí sale', async () => {
    const bus = crearBus();
    const encolados: Array<{ evento: string; payload: Record<string, unknown> }> = [];
    const repoWebhooks = {
      activosPara: async () => [{ id: 1 }],
      encolar: async (_id: number, evento: string, payload: Record<string, unknown>) => void encolados.push({ evento, payload }),
    } as never;
    const soltar = encolarEventos(bus, repoWebhooks);
    const base = createFakeRepos();
    const repos = observarRepos(base, bus);
    const wa = createFakeWhatsApp();
    const sender = createSender({ repos: base, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false });
    await base.contacts.upsertFromInbound('51900222334');
    const r = await sender.send({ phone: '51900222334', kind: 'freeform', category: 'UTILITY', text: 'hola', manual: true });
    if (!r.ok) throw new Error('no salió');
    await processChange('messages', fallo(r.wamid, '51900222334', 131047, 'Re-engagement message'), { repos, settings: { current: () => ({ phoneNumberId: 'PNID' }) } } as never);
    await new Promise((res) => setTimeout(res, 20));
    expect(encolados.filter((x) => x.evento === 'mensaje.estado')).toHaveLength(0);
    const r2 = await sender.send({ phone: '51900222334', kind: 'freeform', category: 'UTILITY', text: 'otra', manual: true });
    if (!r2.ok) throw new Error('no salió');
    await processChange('messages', { statuses: [{ id: r2.wamid, status: 'delivered', timestamp: '1', recipient_id: '51900222334' }] }, { repos, settings: { current: () => ({ phoneNumberId: 'PNID' }) } } as never);
    await new Promise((res) => setTimeout(res, 20));
    const estados = encolados.filter((x) => x.evento === 'mensaje.estado');
    expect(estados).toHaveLength(1);
    expect(estados[0]!.payload).toMatchObject({ mensajeId: r2.wamid, llegoAWhatsapp: true });
    expect(JSON.stringify(encolados)).not.toMatch(/mensaje_no_llego|no llegó al cliente/i);
    soltar();
  });

  it('esMensajeQueNoSalio: solo los mensaje.estado que no llegaron', () => {
    expect(esMensajeQueNoSalio('mensaje.estado', { estado: 'failed', llegoAWhatsapp: false })).toBe(true);
    expect(esMensajeQueNoSalio('mensaje.estado', { estado: 'blocked_by_gate', llegoAWhatsapp: null })).toBe(true);
    expect(esMensajeQueNoSalio('mensaje.estado', { estado: 'delivered', llegoAWhatsapp: true })).toBe(false);
    expect(esMensajeQueNoSalio('mensaje.estado', { estado: 'sent', llegoAWhatsapp: null })).toBe(false);
    expect(esMensajeQueNoSalio('mensaje.enviado', { estado: 'failed' })).toBe(false);
  });
});

describe('el caso del 11/11 de punta a punta: pedido de GSG, Meta no entrega', () => {
  let e: EscenarioEntregas;
  let clave: string;
  let repos: Repos;
  const TEL = '938854380';
  const PHONE = '51938854380';
  let solicitudId = 0;
  let wamidFallido = '';

  beforeAll(async () => {
    e = await crearEscenarioEntregas({});
    clave = generarClaveApi();
    await e.repos.claves.crear({ nombre: 'GSG', hash: hashClaveApi(clave), prefijo: prefijoDeClave(clave), creadaPor: null, permisos: ['entregas:gestionar', 'conversaciones:leer', 'mensajes:enviar'] });
    repos = observarRepos(e.repos, e.bus);
    // Como en produccion (src/servicios.ts): el vigilante de mensajes no entregados.
    vigilarMensajesNoEntregados(e.bus, { repos: e.repos, ahora: e.ahora, esperasMs: [] });
    const alta = await e.app.inject({
      method: 'POST', url: '/api/v1/entregas', headers: { 'x-api-key': clave, 'content-type': 'application/json' },
      payload: JSON.stringify({ ...OBLIGATORIOS_GSG, tracking: 'GSG-E-269342', cliente: 'Dayana Prueba', telefono: TEL }),
    });
    expect(alta.statusCode).toBe(201);
    await e.trabajar();
  });
  afterAll(async () => { await e?.cerrar(); });

  const historial = async () => (await e.app.inject({ method: 'GET', url: '/api/v1/historial?tracking=GSG-E-269342', headers: { 'x-api-key': clave } })).json();
  const solicitud = async () => (await e.repos.rutas.abiertaPorTelefono(PHONE)) ?? null;
  const salientes = () => e.repos.messages._all.filter((m) => m.direction === 'out' && m.contactId && m.wamid);

  it('recién enviado, el historial dice que todavía no se sabe si llegó (no «enviado» a secas)', async () => {
    expect(salientes().length).toBeGreaterThan(0);
    const h = await historial();
    const primero = h.mensajes.find((m: any) => m.direccion === 'saliente');
    expect(primero).toMatchObject({ llegoAWhatsapp: null, entrega: { estado: 'enviado', llegoAWhatsapp: null }, error: null });
    const s = await solicitud();
    expect(s).toMatchObject({ estado: 'enviado', intentos: 1 });
  });

  it('Meta avisa que no lo entregó: desaparece del historial de GSG (sin nota), y el pedido no cuenta ese intento', async () => {
    const s = (await solicitud())!;
    const eventos = await e.repos.rutas.eventos(s.id);
    const wamid = String(eventos.find((x) => x.tipo === 'envio')!.payload!.wamid);
    solicitudId = s.id;
    wamidFallido = wamid;
    await processChange('messages', fallo(wamid, PHONE, 131047, 'Re-engagement message'), { repos, settings: e.settings } as never);

    // Regla de GSG (12/11): si no sale en WhatsApp, no sale en GSG. Ni el mensaje ni una nota.
    const h = await historial();
    expect(h.mensajes.find((x: any) => x.id === wamid)).toBeUndefined();
    expect(h.mensajes.some((x: any) => x.llegoAWhatsapp === false)).toBe(false);
    expect(h.nota?.codigo ?? null).not.toBe('mensaje_no_llego');
    // Ni en el hilo por teléfono de la API.
    const hilo = (await e.app.inject({ method: 'GET', url: `/api/v1/conversaciones/${PHONE}`, headers: { 'x-api-key': clave } })).json();
    expect(hilo.mensajes.find((x: any) => x.mensajeId === wamid)).toBeUndefined();
    // GSGchat sí lo sigue guardando (su chat y «Qué pasó» lo muestran).
    expect(e.repos.messages._all.find((x) => x.wamid === wamid)).toMatchObject({ status: 'failed' });

    // El reparto: no es «no contestó», es una incidencia con el motivo, y el intento no cuenta.
    await hasta(async () => (await e.repos.rutas.solicitud(s.id))?.estado === 'incidencia');
    const despues = (await e.repos.rutas.solicitud(s.id))!;
    expect(despues).toMatchObject({ intentos: 0, incidencia: 'envio_bloqueado' });
    expect(despues.incidenciaDetalle).toMatch(/no le entregó el mensaje/);
    const evs = await e.repos.rutas.eventos(s.id);
    expect(evs.some((x) => x.tipo === 'incidencia' && x.payload?.noLlego === true && x.payload?.wamid === wamid)).toBe(true);

    // El primer mensaje del pedido (API de entregas): fallido y reintentable, con el porqué.
    const pedido = await e.repos.entregas.porTracking('GSG-E-269342');
    expect(pedido).toMatchObject({ mensajeEstado: 'fallido', mensajeErrorCodigo: 'rechazado_131047' });
    expect(pedido!.mensajeError).toMatch(/No le llegó/);
  });

  it('un fallo pasajero de WhatsApp (131000) no es incidencia: no cuenta como intento y vuelve a salir solo', async () => {
    const TEL2 = '938854381';
    const alta = await e.app.inject({
      method: 'POST', url: '/api/v1/entregas', headers: { 'x-api-key': clave, 'content-type': 'application/json' },
      payload: JSON.stringify({ ...OBLIGATORIOS_GSG, tracking: 'GSG-E-PASAJERO', cliente: 'Cliente Pasajero', telefono: TEL2 }),
    });
    expect(alta.statusCode).toBe(201);
    await e.trabajar();
    const s = (await e.repos.rutas.abiertaPorTelefono('51' + TEL2))!;
    expect(s).toMatchObject({ estado: 'enviado', intentos: 1 });
    const wamid = String((await e.repos.rutas.eventos(s.id)).find((x) => x.tipo === 'envio')!.payload!.wamid);
    await processChange('messages', fallo(wamid, '51' + TEL2, 131000, 'Something went wrong'), { repos, settings: e.settings } as never);
    await hasta(async () => (await e.repos.rutas.solicitud(s.id))?.incidencia === 'error_envio');
    const tras = (await e.repos.rutas.solicitud(s.id))!;
    expect(tras).toMatchObject({ estado: 'pendiente', intentos: 0, incidencia: 'error_envio' });
    expect(tras.proximoIntentoAt!.getTime()).toBeGreaterThan(e.ahora().getTime());
    expect(await e.repos.entregas.porTracking('GSG-E-PASAJERO')).toMatchObject({ mensajeEstado: 'reintentando' });
    // Pasados los minutos de espera, el motor lo vuelve a mandar.
    const antes = e.mensajesA(TEL2).length;
    e.avanzar(6);
    await e.trabajar();
    expect(e.mensajesA(TEL2).length).toBe(antes + 1);
    expect(await e.repos.rutas.solicitud(s.id)).toMatchObject({ estado: 'enviado', intentos: 1, incidencia: null });
    expect(await e.repos.entregas.porTracking('GSG-E-PASAJERO')).toMatchObject({ mensajeEstado: 'enviado' });
  });

  it('si el aviso llega antes de que el mensaje esté guardado, se vuelve a buscar y se trata igual', async () => {
    const TEL3 = '938854382';
    const alta = await e.app.inject({
      method: 'POST', url: '/api/v1/entregas', headers: { 'x-api-key': clave, 'content-type': 'application/json' },
      payload: JSON.stringify({ ...OBLIGATORIOS_GSG, tracking: 'GSG-E-ADELANTADO', cliente: 'Cliente Adelantado', telefono: TEL3 }),
    });
    expect(alta.statusCode).toBe(201);
    await e.trabajar();
    const s = (await e.repos.rutas.abiertaPorTelefono('51' + TEL3))!;
    const wamid = String((await e.repos.rutas.eventos(s.id)).find((x) => x.tipo === 'envio')!.payload!.wamid);
    // Las dos primeras búsquedas no encuentran el mensaje (todavía no se había guardado).
    let faltan = 2;
    const reposTarde = {
      ...e.repos,
      messages: {
        ...e.repos.messages,
        referenciaVisiblePorWamid: async (w: string, d: Date) => (faltan-- > 0 ? null : e.repos.messages.referenciaVisiblePorWamid(w, d)),
      },
    } as Repos;
    const r = await mensajeNoLlego({ repos: reposTarde, ahora: e.ahora, esperasMs: [5, 5, 5] }, wamid, { codigo: '131026', tipo: 'meta', titulo: 'Message undeliverable', motivo: 'El número no tiene WhatsApp.', queHacer: 'Confirmar el número.', reintentar: 'no' });
    expect(r).toBe('incidencia');
    expect(await e.repos.rutas.solicitud(s.id)).toMatchObject({ estado: 'incidencia', incidencia: 'sin_whatsapp', intentos: 0 });
    expect(await e.repos.entregas.porTracking('GSG-E-ADELANTADO')).toMatchObject({ mensajeEstado: 'fallido', mensajeErrorCodigo: 'rechazado_131026', mensajePermanente: true });
  });

  it('un mensaje que no es de ningún pedido no toca el reparto', async () => {
    const r = await mensajeNoLlego({ repos: e.repos, ahora: e.ahora, esperasMs: [] }, 'wamid.de-ningun-pedido', null);
    expect(r).toBe('no_es_del_reparto');
  });

  it('el mismo aviso repetido no lo cuenta dos veces ni toca el pedido', async () => {
    const antes = await e.repos.rutas.solicitud(solicitudId);
    const eventosAntes = (await e.repos.rutas.eventos(solicitudId)).length;
    await processChange('messages', fallo(wamidFallido, PHONE, 131047, 'Re-engagement message'), { repos, settings: e.settings } as never);
    const r = await mensajeNoLlego({ repos: e.repos, ahora: e.ahora, esperasMs: [] }, wamidFallido, null);
    expect(r).not.toBe('incidencia');
    await new Promise((res) => setTimeout(res, 50));
    expect(await e.repos.rutas.solicitud(solicitudId)).toMatchObject({ intentos: antes!.intentos, estado: antes!.estado });
    expect((await e.repos.rutas.eventos(solicitudId)).length).toBe(eventosAntes);
  });
});
