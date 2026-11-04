/**
 * Varias cuentas de WhatsApp: escenarios de asignacion, disponibilidad y cambio.
 *
 * Lo que se quiere comprobar es la continuidad con el cliente: siempre se le
 * escribe desde el mismo numero salvo que ese numero ya no este, y entonces
 * pasa a otro activo y se queda ahi, sin volver atras ni ir y venir.
 */

import { describe, expect, it, vi } from 'vitest';
import { createSender, type LineaDeEnvio, type SendJob } from '../src/outbound/sender.js';
import { createMemoryOutboundQueue } from '../src/outbound/memory-queue.js';
import { crearRepartoDeLineas, elegirLineaEquilibrada, type CargaDeLinea } from '../src/whatsapp/reparto-lineas.js';
import { crearMotor } from '../src/rutas/motor.js';
import type { Linea } from '../src/whatsapp/lineas.js';
import type { RegistroClientes } from '../src/whatsapp/registro.js';
import { createFakeRepos, createFakeWhatsApp } from './fakes.js';

const WARMUP = { startPerDay: 50, growth: 1.5, hardCap: 1000 };
const MIN = 60_000;
const IDS = ['a', 'b', 'c'] as const;

function montar(opciones: { soloNumeros?: string[] } = {}) {
  const repos = createFakeRepos();
  let ahora = new Date('2026-11-04T15:00:00Z');
  const estado: Record<string, { conectada: boolean; existe: boolean; desde: Date | null; cupo: number }> = {};
  const clientes: Record<string, ReturnType<typeof createFakeWhatsApp>> = {};
  const lineas: Linea[] = IDS.map((id, i) => {
    estado[id] = { conectada: true, existe: true, desde: null, cupo: 200 };
    clientes[id] = Object.assign(createFakeWhatsApp(), { conectado: () => estado[id]!.conectada });
    return { id, etiqueta: `wsp-${id}`, telefono: `5190000000${i}`, proveedor: 'local', idExterno: null, estado: 'conectado', principal: i === 0, habilitada: true, posicion: i };
  });
  const aLinea = (l: Linea): LineaDeEnvio => ({
    id: l.id, etiqueta: l.etiqueta, numero: l.telefono, cliente: clientes[l.id]!, identidad: `linea:${l.id}`, ventanaAplica: false, noDisponibleDesde: estado[l.id]!.desde,
  });
  const registro = {
    estados: async () => lineas.filter((l) => estado[l.id]!.existe).map((linea) => ({ linea, conectada: estado[linea.id]!.conectada })),
  } as unknown as RegistroClientes;
  const politica = () => ({ timezone: 'America/Lima', warmup: WARMUP, soloRitmo: true }) as never;
  const reparto = crearRepartoDeLineas({ registro, repos, politica, identidadDe: (l) => `linea:${l.id}` });
  const sender = createSender({
    repos,
    wa: clientes.a!,
    phoneNumberId: 'linea:a',
    warmup: WARMUP,
    maxMarketingPerContact7d: 2,
    now: () => ahora,
    esperaCambioLineaMs: () => 30 * MIN,
    soloNumeros: opciones.soloNumeros,
    resolverLinea: async (id) => {
      const l = lineas.find((x) => x.id === (id ?? 'a'));
      return l && estado[l.id]!.existe ? aLinea(l) : null;
    },
    elegirLinea: async (excluir) => {
      const id = await reparto.elegir(excluir);
      return id ? aLinea(lineas.find((l) => l.id === id)!) : null;
    },
  });
  const caer = (id: string) => {
    estado[id]!.conectada = false;
    estado[id]!.desde = ahora;
  };
  const volver = (id: string) => {
    estado[id]!.conectada = true;
    estado[id]!.desde = null;
  };
  return {
    repos, sender, clientes, estado, reparto, caer, volver,
    pasar: (ms: number) => { ahora = new Date(ahora.getTime() + ms); },
    ahora: () => ahora,
    enviadosPor: (id: string) => clientes[id]!.sent.length,
  };
}

const texto = (phone: string, extra: Partial<SendJob> = {}): SendJob => ({ phone, kind: 'freeform', category: 'UTILITY', text: 'hola', manual: true, ...extra });
const carga = (id: string, extra: Partial<CargaDeLinea> = {}): CargaDeLinea => ({ id, etiqueta: id, numero: '', posicion: 0, conectada: true, clientes: 0, nuevosHoy: 0, enviadosHoy: 0, cupoDiario: 100, pausada: false, ...extra });

describe('que linea le toca a un cliente nuevo', () => {
  it('la menos ocupada segun su cupo del dia', () => {
    expect(elegirLineaEquilibrada([carga('a', { nuevosHoy: 10 }), carga('b', { nuevosHoy: 2 })])).toBe('b');
    // Una linea que se esta calentando tiene poco cupo: 5 de 10 pesa mas que 20 de 100.
    expect(elegirLineaEquilibrada([carga('nueva', { nuevosHoy: 5, cupoDiario: 10 }), carga('veterana', { nuevosHoy: 20, cupoDiario: 100 })])).toBe('veterana');
  });

  it('no le da clientes a una linea pausada ni a una con el cupo gastado', () => {
    expect(elegirLineaEquilibrada([carga('a', { pausada: true }), carga('b', { nuevosHoy: 50 })])).toBe('b');
    expect(elegirLineaEquilibrada([carga('a', { enviadosHoy: 100 }), carga('b', { enviadosHoy: 90 })])).toBe('b');
  });

  it('si todas gastaron el cupo se reparte igual, y si todas estan pausadas no elige ninguna', () => {
    expect(elegirLineaEquilibrada([carga('a', { enviadosHoy: 120 }), carga('b', { enviadosHoy: 100 })])).toBe('b');
    expect(elegirLineaEquilibrada([carga('a', { pausada: true })])).toBeNull();
    expect(elegirLineaEquilibrada([])).toBeNull();
  });

  it('a igual carga decide quien lleva menos clientes y luego el orden, sin azar', () => {
    expect(elegirLineaEquilibrada([carga('a', { clientes: 9 }), carga('b', { clientes: 3 })])).toBe('b');
    expect(elegirLineaEquilibrada([carga('b', { posicion: 1 }), carga('a', { posicion: 0 })])).toBe('a');
  });

  it('treinta clientes nuevos se reparten a partes iguales entre tres lineas', async () => {
    const { sender, enviadosPor } = montar();
    for (let i = 0; i < 30; i++) await sender.send(texto(`519100000${String(i).padStart(2, '0')}`));
    expect(IDS.map(enviadosPor)).toEqual([10, 10, 10]);
  });

  it('una tanda a la vez tampoco deja a un cliente en dos lineas', async () => {
    const { sender, repos, enviadosPor } = montar();
    const resultados = await Promise.all(Array.from({ length: 6 }, () => sender.send(texto('51910000099'))));
    expect(resultados.every((r) => r.ok)).toBe(true);
    const c = await repos.contacts.upsertFromInbound('51910000099');
    const linea = await repos.messages.lineaDeLaConversacion(c.id);
    expect(enviadosPor(linea!)).toBe(6);
    expect(repos.messages._all.filter((m) => m.lineaId !== linea)).toHaveLength(0);
  });

  it('lo que frena el modo prueba no cuenta como cliente repartido', async () => {
    const { sender, repos } = montar({ soloNumeros: ['51910000001'] });
    const r = await sender.send(texto('51910000002'));
    expect(r).toMatchObject({ ok: false, code: 'allowlist' });
    const c = await repos.contacts.upsertFromInbound('51910000002');
    expect(await repos.messages.lineaDeLaConversacion(c.id)).toBeNull();
  });
});

describe('el cliente se queda con su numero', () => {
  it('sigue por su linea aunque otra este mas desahogada', async () => {
    const { sender, enviadosPor } = montar();
    await sender.send(texto('51910000010'));
    for (let i = 0; i < 20; i++) await sender.send(texto(`519100001${String(i).padStart(2, '0')}`));
    const antes = enviadosPor('a');
    for (let i = 0; i < 5; i++) await sender.send(texto('51910000010'));
    expect(enviadosPor('a')).toBe(antes + 5);
  });

  it('el cliente que escribe primero recibe la respuesta por la linea a la que escribio', async () => {
    const { sender, repos, enviadosPor } = montar();
    const c = await repos.contacts.upsertFromInbound('51910000011');
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'E1', kind: 'text', body: 'hola', lineaId: 'c' });
    await sender.send(texto('51910000011'));
    expect(enviadosPor('c')).toBe(1);
    expect(enviadosPor('a') + enviadosPor('b')).toBe(0);
  });

  it('el historial viejo que llega al vincular un numero no le cambia la linea a nadie', async () => {
    const { sender, repos, ahora } = montar();
    await sender.send(texto('51910000012'));
    const c = await repos.contacts.upsertFromInbound('51910000012');
    const suya = await repos.messages.lineaDeLaConversacion(c.id);
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'H1', kind: 'text', body: 'de hace un mes', lineaId: 'c', createdAt: new Date(ahora().getTime() - 30 * 24 * 60 * MIN), payload: { historial: true } });
    expect(await repos.messages.lineaDeLaConversacion(c.id)).toBe(suya);
    expect(await repos.lineasContacto.cambios()).toHaveLength(0);
  });

  it('un reintento pendiente no le devuelve al cliente una linea que ya dejo', async () => {
    vi.useFakeTimers();
    try {
      const { sender, repos, caer, volver, enviadosPor, ahora } = montar();
      const c = await repos.contacts.upsertFromInbound('51910000013');
      await repos.lineasContacto.fijarSiNoTiene(c.id, 'b', ahora());
      caer('b');
      const cola = createMemoryOutboundQueue({ sender });
      await cola.enqueue(texto('51910000013'));
      await vi.advanceTimersByTimeAsync(500);
      expect(enviadosPor('b')).toBe(0);
      await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'E2', kind: 'text', body: 'te escribo aqui', lineaId: 'c', createdAt: new Date(ahora().getTime() + 1000) });
      volver('b');
      await vi.advanceTimersByTimeAsync(3 * MIN);
      // El reintento sale por donde se empezo, pero el cliente sigue en la que escribio.
      expect(enviadosPor('b')).toBe(1);
      expect(await repos.messages.lineaDeLaConversacion(c.id)).toBe('c');
      await cola.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('la excepcion: su numero ya no esta disponible', () => {
  async function conLinea(m: ReturnType<typeof montar>, phone: string, linea: string) {
    const c = await m.repos.contacts.upsertFromInbound(phone);
    await m.repos.lineasContacto.fijarSiNoTiene(c.id, linea, m.ahora());
    return c;
  }

  it('una caida corta espera: no cambia de numero y sale al volver', async () => {
    const m = montar();
    const c = await conLinea(m, '51910000020', 'b');
    m.caer('b');
    m.pasar(10 * MIN);
    expect(await m.sender.send(texto('51910000020'))).toMatchObject({ ok: false, blocked: true, code: 'sin_conexion', whatsappNumberId: 'b' });
    m.volver('b');
    expect((await m.sender.send(texto('51910000020'))).ok).toBe(true);
    expect(m.enviadosPor('b')).toBe(1);
    expect(await m.repos.lineasContacto.cambios({ contactId: c.id })).toHaveLength(0);
  });

  it('pasado el plazo sale por otra activa, queda anotado el motivo y ya no vuelve aunque la vieja regrese', async () => {
    const m = montar();
    const c = await conLinea(m, '51910000021', 'b');
    m.caer('b');
    m.pasar(31 * MIN);
    const r = await m.sender.send(texto('51910000021'));
    expect(r).toMatchObject({ ok: true });
    const nueva = (r as { whatsappNumberId: string }).whatsappNumberId;
    expect(nueva).not.toBe('b');
    expect(await m.repos.lineasContacto.cambios({ contactId: c.id })).toMatchObject([{ desdeLineaId: 'b', aLineaId: nueva, motivo: 'linea_caida' }]);

    m.volver('b');
    await m.sender.send(texto('51910000021'));
    expect(m.enviadosPor('b')).toBe(0);
    expect(m.enviadosPor(nueva)).toBe(2);
    expect(await m.repos.lineasContacto.cambios({ contactId: c.id })).toHaveLength(1);
  });

  it('una linea quitada o deshabilitada no se espera: cambia en el acto', async () => {
    const m = montar();
    const c = await conLinea(m, '51910000022', 'b');
    m.estado.b!.existe = false;
    expect((await m.sender.send(texto('51910000022'))).ok).toBe(true);
    expect(await m.repos.lineasContacto.cambios({ contactId: c.id })).toMatchObject([{ desdeLineaId: 'b', motivo: 'linea_no_disponible' }]);
  });

  it('sin ninguna otra activa se queda donde esta, esperando, sin perder su asignacion', async () => {
    const m = montar();
    const c = await conLinea(m, '51910000023', 'b');
    for (const id of IDS) m.caer(id);
    m.pasar(60 * MIN);
    expect(await m.sender.send(texto('51910000023'))).toMatchObject({ ok: false, code: 'sin_conexion', whatsappNumberId: 'b' });
    expect(await m.repos.messages.lineaDeLaConversacion(c.id)).toBe('b');
    expect(await m.repos.lineasContacto.cambios({ contactId: c.id })).toHaveLength(0);
  });

  it('un cliente nuevo sin ninguna linea conectada espera sin quedar atado a ninguna', async () => {
    const m = montar();
    for (const id of IDS) m.caer(id);
    expect(await m.sender.send(texto('51910000024'))).toMatchObject({ ok: false, code: 'sin_conexion', whatsappNumberId: null });
    m.volver('c');
    expect(await m.sender.send(texto('51910000024'))).toMatchObject({ ok: true, whatsappNumberId: 'c' });
  });

  it('la linea que eligio una persona no se sustituye nunca', async () => {
    const m = montar();
    m.caer('b');
    m.pasar(120 * MIN);
    expect(await m.sender.send(texto('51910000025', { whatsappNumberId: 'b' }))).toMatchObject({ ok: false, code: 'sin_conexion' });
    expect(m.enviadosPor('a') + m.enviadosPor('c')).toBe(0);
  });

  it('elegir otra linea en el chat cambia la del cliente y queda anotado', async () => {
    const m = montar();
    const c = await conLinea(m, '51910000026', 'b');
    await m.sender.send(texto('51910000026', { whatsappNumberId: 'c' }));
    expect(await m.repos.messages.lineaDeLaConversacion(c.id)).toBe('c');
    expect(await m.repos.lineasContacto.cambios({ contactId: c.id })).toMatchObject([{ desdeLineaId: 'b', aLineaId: 'c', motivo: 'persona' }]);
  });

  it('un reintento en cola tambien cambia si su linea se cayo del todo', async () => {
    vi.useFakeTimers();
    try {
      const m = montar();
      await conLinea(m, '51910000027', 'b');
      m.caer('b');
      const cola = createMemoryOutboundQueue({ sender: m.sender });
      await cola.enqueue(texto('51910000027'));
      await vi.advanceTimersByTimeAsync(500);
      expect(cola.size()).toBe(1);
      m.pasar(31 * MIN);
      await vi.advanceTimersByTimeAsync(3 * MIN);
      expect(cola.size()).toBe(0);
      expect(m.enviadosPor('a') + m.enviadosPor('c')).toBe(1);
      await cola.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('un grupo se queda en su linea: no se reparte ni se cambia', async () => {
    const m = montar();
    const c = await m.repos.contacts.upsertFromInbound('120363000000000000@g.us');
    (c as { tipo: string }).tipo = 'grupo';
    await m.repos.lineasContacto.fijarSiNoTiene(c.id, 'b', m.ahora());
    m.caer('b');
    m.pasar(120 * MIN);
    expect(await m.sender.send(texto(c.phone))).toMatchObject({ ok: false, code: 'sin_conexion', whatsappNumberId: 'b' });
    expect(await m.repos.lineasContacto.cambios({ contactId: c.id })).toHaveLength(0);
  });
});

describe('el motor de pedidos con varias lineas', () => {
  const opciones = { esperaRespuestaMinutos: 30, maxIntentos: 3, esperaFinalMinutos: 0, horaInicio: 0, horaFin: 24, timezone: 'America/Lima', negocio: 'Prueba' } as never;
  const mensajeDeEspera = 'WhatsApp está desconectado; el envío continúa al reconectarse.';
  const motorCon = (extra: { conectada: boolean; hay?: boolean }) =>
    crearMotor({
      repos: createFakeRepos(),
      sender: { send: async () => ({ ok: false, blocked: true, code: 'sin_conexion', reason: '', deliveryId: -1 }) },
      gsg: { conectado: () => false } as never,
      opciones,
      usarPlantilla: () => false,
      wa: { conectado: () => extra.conectada } as never,
      ...(extra.hay === undefined ? {} : { hayLineaConectada: () => extra.hay! }),
    });

  it('con la principal caida y otra linea viva no se para', async () => {
    expect((await motorCon({ conectada: false, hay: true }).tick()).motivo).not.toBe(mensajeDeEspera);
  });

  it('solo se para si no queda ninguna', async () => {
    expect((await motorCon({ conectada: false, hay: false }).tick()).motivo).toBe(mensajeDeEspera);
  });

  it('con una sola linea sigue igual que siempre', async () => {
    expect((await motorCon({ conectada: false }).tick()).motivo).toBe(mensajeDeEspera);
    expect((await motorCon({ conectada: true }).tick()).motivo).not.toBe(mensajeDeEspera);
  });
});
