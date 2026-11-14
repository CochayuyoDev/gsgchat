/**
 * El maximo de mensajes por dia de cada numero de WhatsApp.
 *
 * Cubre: el tope (500 salen, el 501 va a otro), sin limite, cupo compartido entre
 * clientes, reinicio a medianoche de Lima, alternativo temporal sin tocar la
 * asignacion, envios simultaneos, rechazo del proveedor, reintento con la misma
 * clave, el motivo de cada seleccion y el aviso cuando no queda ningun numero.
 */

import { describe, expect, it } from 'vitest';
import { createSender, type LineaDeEnvio } from '../src/outbound/sender.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';
import { diaLima, LimiteInvalido, msHastaMedianocheLima, validarLimiteDiario } from '../src/whatsapp/limite-diario.js';
import { createFakeRepos, createFakeWhatsApp } from './fakes.js';

const WARMUP = { startPerDay: 100000, growth: 1.5, hardCap: 100000 };
const IDS = ['a', 'b', 'c'] as const;

function montar() {
  const repos = createFakeRepos();
  let ahora = new Date('2026-11-04T15:00:00Z'); // 10:00 en Lima
  const conectadas: Record<string, boolean> = { a: true, b: true, c: true };
  const clientes = Object.fromEntries(IDS.map((id) => [id, Object.assign(createFakeWhatsApp(), { conectado: () => conectadas[id]! })]));
  const lineas: Record<string, LineaDeEnvio> = Object.fromEntries(
    IDS.map((id) => [id, { id, etiqueta: `wsp-${id}`, numero: `5190000000${id}`, cliente: clientes[id]!, identidad: `linea:${id}`, ventanaAplica: false }]),
  );
  const sender = createSender({
    repos,
    wa: clientes.a!,
    phoneNumberId: 'linea:a',
    warmup: WARMUP,
    maxMarketingPerContact7d: 2,
    sendsPerSecond: 100000,
    maxConcurrentSends: 50,
    now: () => ahora,
    resolverLinea: async (id) => lineas[id ?? 'a'] ?? null,
    // El reparto de un cliente nuevo: siempre la a, para que la prueba sea predecible.
    elegirLinea: async (excluir) => (excluir === 'a' ? lineas.b! : lineas.a!),
    // Alternativas en orden estable: a, b, c.
    alternativas: async (excluir) => IDS.filter((id) => id !== excluir && conectadas[id]).map((id) => lineas[id]!),
  });
  return {
    repos, sender, clientes, conectadas,
    enviados: (id: string) => clientes[id]!.sent.length,
    pasarA: (iso: string) => { ahora = new Date(iso); },
    limite: (id: string, n: number) => repos.usoLineas.fijarLimite(id, n),
    uso: async (id: string) => (await repos.usoLineas.usoDelDia(diaLima(ahora))).get(id) ?? 0,
  };
}

const texto = (phone: string, extra: Record<string, unknown> = {}) => ({ phone, kind: 'freeform' as const, category: 'UTILITY' as const, text: 'hola', manual: true, ...extra });

describe('el maximo de mensajes por dia de cada numero', () => {
  it('con un limite de 500 salen 500 por ese numero y el 501 sale por otro elegible', async () => {
    const m = montar();
    await m.limite('a', 500);
    for (let i = 1; i <= 500; i++) {
      const r = await m.sender.send(texto('51910000001', { claveEnvio: `k${i}` }));
      expect(r).toMatchObject({ ok: true, whatsappNumberId: 'a' });
    }
    expect(await m.uso('a')).toBe(500);
    const r501 = await m.sender.send(texto('51910000001', { claveEnvio: 'k501' }));
    expect(r501).toMatchObject({ ok: true, whatsappNumberId: 'b' });
    expect(m.enviados('a')).toBe(500);
    expect(m.enviados('b')).toBe(1);
  }, 60_000);

  it('vacio o 0 es sin limite: no rota por cupo', async () => {
    const m = montar();
    await m.limite('a', 0);
    for (let i = 0; i < 30; i++) await m.sender.send(texto('51910000002'));
    expect(m.enviados('a')).toBe(30);
    expect(m.enviados('b')).toBe(0);
  });

  it('el consumo se comparte entre todos los clientes que salen por ese numero', async () => {
    const m = montar();
    await m.limite('a', 3);
    await m.sender.send(texto('51910000003'));
    await m.sender.send(texto('51910000004'));
    await m.sender.send(texto('51910000005'));
    expect(await m.uso('a')).toBe(3);
    // Un cuarto cliente, distinto, ya no cabe en a.
    expect(await m.sender.send(texto('51910000006'))).toMatchObject({ ok: true, whatsappNumberId: 'b' });
  });

  it('usar un alternativo por limite es temporal: el cliente sigue asignado al original y el motivo queda anotado', async () => {
    const m = montar();
    await m.limite('a', 1);
    const c = await m.repos.contacts.upsertFromInbound('51910000007');
    await m.repos.lineasContacto.fijarSiNoTiene(c.id, 'a', new Date());
    await m.sender.send(texto('51910000007'));
    const r = await m.sender.send(texto('51910000007'));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: 'b' });
    expect(await m.repos.messages.lineaDeLaConversacion(c.id)).toBe('a');
    expect(await m.repos.lineasContacto.cambios({ contactId: c.id })).toHaveLength(0);
    const entregas = m.repos._deliveries as Array<{ whatsappNumberId?: string; lineaMotivo?: string }>;
    expect(entregas.map((e) => [e.whatsappNumberId, e.lineaMotivo])).toEqual([['a', 'asignacion_original'], ['b', 'limite_alcanzado']]);
  });

  it('con su numero desconectado sale por otro con el motivo original_no_disponible, y al volver vuelve el original', async () => {
    const m = montar();
    const c = await m.repos.contacts.upsertFromInbound('51910000008');
    await m.repos.lineasContacto.fijarSiNoTiene(c.id, 'a', new Date());
    m.conectadas.a = false;
    expect(await m.sender.send(texto('51910000008'))).toMatchObject({ ok: true, whatsappNumberId: 'b' });
    m.conectadas.a = true;
    expect(await m.sender.send(texto('51910000008'))).toMatchObject({ ok: true, whatsappNumberId: 'a' });
    const motivos = (m.repos._deliveries as Array<{ lineaMotivo?: string }>).map((e) => e.lineaMotivo);
    expect(motivos).toEqual(['original_no_disponible', 'asignacion_original']);
  });

  it('el limite se reinicia a las 00:00 de Lima y el original vuelve a ser la primera opcion', async () => {
    const m = montar();
    await m.limite('a', 1);
    const c = await m.repos.contacts.upsertFromInbound('51910000009');
    await m.repos.lineasContacto.fijarSiNoTiene(c.id, 'a', new Date());
    m.pasarA('2026-11-05T04:59:00Z'); // 23:59 del 4 en Lima
    expect(await m.sender.send(texto('51910000009'))).toMatchObject({ whatsappNumberId: 'a' });
    expect(await m.sender.send(texto('51910000009'))).toMatchObject({ whatsappNumberId: 'b' });
    m.pasarA('2026-11-05T05:00:30Z'); // 00:00:30 del 5 en Lima
    expect(await m.sender.send(texto('51910000009'))).toMatchObject({ whatsappNumberId: 'a' });
    expect(await m.uso('a')).toBe(1);
  });

  it('envios simultaneos no pueden pasar del limite', async () => {
    const m = montar();
    await m.limite('a', 5);
    const resultados = await Promise.all(Array.from({ length: 40 }, (_, i) => m.sender.send(texto('51910000010', { claveEnvio: `s${i}` }))));
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(m.enviados('a')).toBe(5);
    expect(await m.uso('a')).toBe(5);
    expect(m.enviados('b') + m.enviados('c')).toBe(35);
  });

  it('si el proveedor rechaza el envio se libera el cupo', async () => {
    const m = montar();
    await m.limite('a', 1);
    m.clientes.a!.failNext = new WhatsAppApiError('Numero invalido', 400, 131026);
    const r = await m.sender.send(texto('51910000011'));
    expect(r).toMatchObject({ ok: false, blocked: false });
    expect(await m.uso('a')).toBe(0);
    expect(await m.sender.send(texto('51910000011'))).toMatchObject({ ok: true, whatsappNumberId: 'a' });
    expect(await m.uso('a')).toBe(1);
  });

  it('si no se sabe si salio (corte sin respuesta) el cupo queda gastado y el reintento con la misma clave no cuenta ni envia otra vez', async () => {
    const m = montar();
    await m.limite('a', 5);
    m.clientes.a!.failNext = new Error('socket hang up');
    const r = await m.sender.send(texto('51910000012', { claveEnvio: 'dudoso' }));
    expect(r).toMatchObject({ ok: false, incierto: true });
    expect(await m.uso('a')).toBe(1);
    const otra = await m.sender.send(texto('51910000012', { claveEnvio: 'dudoso' }));
    expect(otra).toMatchObject({ ok: false, incierto: true, code: 'resultado_incierto' });
    expect(await m.uso('a')).toBe(1);
    expect(m.enviados('a')).toBe(0);
  });

  it('un reintento de un envio ya aceptado devuelve lo que salio sin contar ni enviar de nuevo', async () => {
    const m = montar();
    await m.limite('a', 5);
    const primero = await m.sender.send(texto('51910000013', { claveEnvio: 'mismo' }));
    const repetido = await m.sender.send(texto('51910000013', { claveEnvio: 'mismo' }));
    expect(primero.ok && repetido.ok).toBe(true);
    expect((repetido as { wamid: string }).wamid).toBe((primero as { wamid: string }).wamid);
    expect(m.enviados('a')).toBe(1);
    expect(await m.uso('a')).toBe(1);
  });

  it('un mensaje frenado por una guarda no gasta cupo', async () => {
    const m = montar();
    await m.limite('a', 5);
    const c = await m.repos.contacts.upsertFromInbound('51910000014');
    await m.repos.contacts.setOptIn('51910000014', 'prueba');
    await m.repos.contacts.setOptOut('51910000014');
    const r = await m.sender.send(texto('51910000014', { manual: false }));
    expect(r.ok).toBe(false);
    expect(await m.uso('a')).toBe(0);
    expect(c.id).toBeTruthy();
  });

  it('sin ningun numero habilitado, conectado y con cupo no se da por enviado: queda bloqueado y visible con su motivo', async () => {
    const m = montar();
    for (const id of IDS) await m.limite(id, 1);
    await m.sender.send(texto('51910000015'));
    await m.sender.send(texto('51910000016'));
    await m.sender.send(texto('51910000017'));
    const r = await m.sender.send(texto('51910000018', { claveEnvio: 'sin-numero' }));
    expect(r).toMatchObject({ ok: false, blocked: true, code: 'sin_lineas_disponibles', reason: 'No hay números vinculados habilitados con cupo disponible' });
    const entrega = (m.repos._deliveries as Array<{ id: number; status: string; errorTitle?: string }>).find((d) => d.id === (r as { deliveryId: number }).deliveryId)!;
    expect(entrega.status).toBe('blocked_by_gate');
    expect(entrega.errorTitle).toContain('No hay números vinculados habilitados con cupo disponible');
    // Un reintento del mismo envio no abre otra entrega.
    const antes = m.repos._deliveries.length;
    await m.sender.send(texto('51910000018', { claveEnvio: 'sin-numero' }));
    expect(m.repos._deliveries.length).toBe(antes);
    // Cuando hay cupo (otro dia) sale.
    m.pasarA('2026-11-05T15:00:00Z');
    expect(await m.sender.send(texto('51910000018', { claveEnvio: 'sin-numero' }))).toMatchObject({ ok: true });
  });

  it('la linea elegida a mano que llego a su maximo no se sustituye: se frena y se dice', async () => {
    const m = montar();
    await m.limite('b', 1);
    await m.sender.send(texto('51910000019', { whatsappNumberId: 'b' }));
    const r = await m.sender.send(texto('51910000020', { whatsappNumberId: 'b' }));
    expect(r).toMatchObject({ ok: false, blocked: true, code: 'limite_diario' });
    expect(m.enviados('a') + m.enviados('c')).toBe(0);
  });
});

describe('validacion y dia de Lima', () => {
  it('acepta enteros no negativos; vacio, null y 0 son sin limite', () => {
    expect(validarLimiteDiario('')).toBe(0);
    expect(validarLimiteDiario('  ')).toBe(0);
    expect(validarLimiteDiario(null)).toBe(0);
    expect(validarLimiteDiario(undefined)).toBe(0);
    expect(validarLimiteDiario(0)).toBe(0);
    expect(validarLimiteDiario('500')).toBe(500);
    expect(validarLimiteDiario(342)).toBe(342);
  });

  it('rechaza negativos, decimales y texto con un mensaje claro', () => {
    for (const malo of [-1, '-5', 1.5, '1.5', 'abc', '10x', NaN, Infinity, true, {}, 2_000_000]) {
      expect(() => validarLimiteDiario(malo)).toThrow(LimiteInvalido);
    }
    expect(() => validarLimiteDiario(-1)).toThrow(/no puede ser negativo/);
  });

  it('el dia cambia a las 00:00 de Lima (05:00 UTC)', () => {
    expect(diaLima(new Date('2026-11-05T04:59:59Z'))).toBe('2026-11-04');
    expect(diaLima(new Date('2026-11-05T05:00:00Z'))).toBe('2026-11-05');
    expect(msHastaMedianocheLima(new Date('2026-11-05T04:00:00Z'))).toBe(3600_000);
    expect(msHastaMedianocheLima(new Date('2026-11-05T05:00:00Z'))).toBe(24 * 3600_000);
  });
});
