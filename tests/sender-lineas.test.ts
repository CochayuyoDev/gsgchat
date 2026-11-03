/**
 * El sender con varias lineas: cada trabajo sale por SU linea, la conversacion
 * sigue por donde llego, un reintento no cambia de numero y el cupo de cada
 * linea se cuenta aparte.
 */

import { describe, expect, it, vi } from 'vitest';
import { createSender, type LineaDeEnvio } from '../src/outbound/sender.js';
import { createMemoryOutboundQueue } from '../src/outbound/memory-queue.js';
import { createFakeRepos, createFakeWhatsApp } from './fakes.js';

const sorteo: { cual: string | null } = { cual: null };
const WARMUP = { startPerDay: 50, growth: 1.5, hardCap: 1000 };
const PRINCIPAL = '00000000-0000-0000-0000-000000000001';

function montar() {
  sorteo.cual = null;
  const repos = createFakeRepos();
  const waPrincipal = createFakeWhatsApp();
  const waVentas = createFakeWhatsApp();
  const estado = { ventasConectada: true, ventasHabilitada: true };
  const lineas: Record<string, LineaDeEnvio> = {
    [PRINCIPAL]: { id: PRINCIPAL, etiqueta: 'Principal', numero: '51911111111', cliente: waPrincipal, identidad: 'PNID', ventanaAplica: false },
    ventas: {
      id: 'ventas', etiqueta: 'Ventas', numero: '51922222222', identidad: 'linea:ventas', ventanaAplica: false,
      cliente: Object.assign(waVentas, { conectado: () => estado.ventasConectada }),
    },
  };
  const sender = createSender({
    repos,
    wa: waPrincipal,
    sortearLinea: async () => (sorteo.cual ? lineas[sorteo.cual]! : null),
    resolverLinea: async (id) => {
      const l = lineas[id ?? PRINCIPAL];
      return l && (l.id !== 'ventas' || estado.ventasHabilitada) ? l : null;
    },
    phoneNumberId: 'PNID',
    warmup: WARMUP,
    maxMarketingPerContact7d: 2,
  });
  return { repos, waPrincipal, waVentas, estado, sender };
}

const texto = (phone: string, extra: Record<string, unknown> = {}) => ({ phone, kind: 'freeform' as const, category: 'UTILITY' as const, text: 'hola', manual: true, ...extra });

describe('sender con varias lineas', () => {
  it('un cliente nuevo abre por la linea que toque en el sorteo, y desde ahi el proceso sigue por ella', async () => {
    const { sender, waPrincipal, waVentas, repos } = montar();
    sorteo.cual = 'ventas';
    const r = await sender.send(texto('51900000020'));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: 'ventas' });
    // El sorteo ahora diria otra, pero el cliente ya tiene su linea.
    sorteo.cual = PRINCIPAL;
    await sender.send(texto('51900000020'));
    await sender.send(texto('51900000020'));
    expect(waVentas.sent).toHaveLength(3);
    expect(waPrincipal.sent).toHaveLength(0);
    // Otro cliente nuevo si puede caer en otra.
    await sender.send(texto('51900000021'));
    expect(waPrincipal.sent).toHaveLength(1);
    expect(repos._deliveries.at(-1)).toMatchObject({ whatsappNumberId: PRINCIPAL });
  });

  it('un chat nuevo sin sorteo posible sale por la principal', async () => {
    const { sender, waPrincipal, waVentas, repos } = montar();
    const r = await sender.send(texto('51900000001'));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: PRINCIPAL });
    expect(waPrincipal.sent).toHaveLength(1);
    expect(waVentas.sent).toHaveLength(0);
    expect(repos._deliveries.at(-1)).toMatchObject({ whatsappNumberId: PRINCIPAL });
  });

  it('la linea elegida manda, y el mensaje guarda su etiqueta y numero', async () => {
    const { sender, waPrincipal, waVentas, repos } = montar();
    const r = await sender.send(texto('51900000002', { whatsappNumberId: 'ventas' }));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: 'ventas' });
    expect(waVentas.sent).toHaveLength(1);
    expect(waPrincipal.sent).toHaveLength(0);
    const guardado = repos.messages._all.at(-1);
    expect(guardado).toMatchObject({ lineaId: 'ventas', lineaEtiqueta: 'Ventas', lineaNumero: '51922222222' });
  });

  it('sin linea indicada, contesta por donde llego el ultimo mensaje del cliente', async () => {
    const { sender, waVentas, repos } = montar();
    const c = await repos.contacts.upsertFromInbound('51900000003');
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'IN1', kind: 'text', body: 'hola', lineaId: 'ventas', lineaEtiqueta: 'Ventas', lineaNumero: '51922222222' });
    const r = await sender.send(texto('51900000003'));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: 'ventas' });
    expect(waVentas.sent).toHaveLength(1);
  });

  it('lo que se empezo por una linea sigue por ella aunque el cliente aun no haya contestado', async () => {
    const { sender, waPrincipal, waVentas } = montar();
    await sender.send(texto('51900000010', { whatsappNumberId: 'ventas' }));
    // Los siguientes, sin indicar linea (un recordatorio, un seguimiento...), salen por la misma.
    await sender.send(texto('51900000010'));
    await sender.send(texto('51900000010'));
    expect(waVentas.sent).toHaveLength(3);
    expect(waPrincipal.sent).toHaveLength(0);
  });

  it('si el cliente escribe por otra linea, la conversacion pasa a esa', async () => {
    const { sender, waPrincipal, waVentas, repos } = montar();
    await sender.send(texto('51900000011', { whatsappNumberId: 'ventas' }));
    const c = await repos.contacts.upsertFromInbound('51900000011');
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'IN9', kind: 'text', body: 'hola', lineaId: PRINCIPAL, createdAt: new Date(Date.now() + 5000) });
    await sender.send(texto('51900000011'));
    expect(waVentas.sent).toHaveLength(1);
    expect(waPrincipal.sent).toHaveLength(1);
  });

  it('una linea caida espera (no cambia de numero) y el reintento queda fijado a ella', async () => {
    const { sender, waPrincipal, estado } = montar();
    estado.ventasConectada = false;
    const r = await sender.send(texto('51900000004', { whatsappNumberId: 'ventas' }));
    expect(r).toMatchObject({ ok: false, blocked: true, code: 'sin_conexion', whatsappNumberId: 'ventas' });
    expect(waPrincipal.sent).toHaveLength(0);
  });

  it('una linea pedida que no esta disponible no se sustituye por otra', async () => {
    const { sender, waPrincipal, estado } = montar();
    estado.ventasHabilitada = false;
    const r = await sender.send(texto('51900000005', { whatsappNumberId: 'ventas' }));
    expect(r).toMatchObject({ ok: false, blocked: true, code: 'sin_conexion' });
    expect(waPrincipal.sent).toHaveLength(0);
  });

  it('si la linea implicita ya no esta disponible, cae en la principal', async () => {
    const { sender, waPrincipal, estado, repos } = montar();
    const c = await repos.contacts.upsertFromInbound('51900000006');
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'IN2', kind: 'text', body: 'hola', lineaId: 'ventas' });
    estado.ventasHabilitada = false;
    expect((await sender.send(texto('51900000006'))).ok).toBe(true);
    expect(waPrincipal.sent).toHaveLength(1);
  });

  it('el cupo diario se cuenta por linea', async () => {
    const { sender, repos } = montar();
    const plantilla = { phone: '51900000007', kind: 'freeform' as const, category: 'UTILITY' as const, text: 'aviso', programado: true };
    await repos.contacts.upsertFromInbound('51900000007');
    await repos.contacts.setOptIn('51900000007', 'formulario');
    await sender.send({ ...plantilla, whatsappNumberId: 'ventas' });
    const hoy = new Date();
    expect(await repos.counters.totalForDay('linea:ventas', hoy)).toBeGreaterThan(0);
    expect(await repos.counters.totalForDay('PNID', hoy)).toBe(0);
  });

  it('la cola reintenta por la linea del primer intento aunque despues llegue un mensaje por otra', async () => {
    vi.useFakeTimers();
    try {
      const { sender, waVentas, waPrincipal, estado, repos } = montar();
      const c = await repos.contacts.upsertFromInbound('51900000008');
      await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'IN3', kind: 'text', body: 'hola', lineaId: 'ventas' });
      estado.ventasConectada = false;
      const cola = createMemoryOutboundQueue({ sender });
      await cola.enqueue(texto('51900000008')); // sin linea: sale la del ultimo entrante (ventas)
      await vi.advanceTimersByTimeAsync(500);
      expect(waVentas.sent).toHaveLength(0);
      // Mientras espera, el cliente escribe por la principal y ventas se recupera.
      await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'IN4', kind: 'text', body: 'otra vez', lineaId: PRINCIPAL, createdAt: new Date(Date.now() + 1000) });
      estado.ventasConectada = true;
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      expect(waVentas.sent).toHaveLength(1);
      expect(waPrincipal.sent).toHaveLength(0);
      await cola.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
