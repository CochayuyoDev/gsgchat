/**
 * El modo de Conexion (solo normal / solo API / los dos) en el sender:
 *  - un cliente nuevo solo entra por una linea en uso;
 *  - una linea en pausa por el modo termina sus chats abiertos (< 24 h) y
 *    despues el cliente sale por una linea en uso, sin cambiar su asignacion;
 *  - una linea en pausa elegida a mano con el chat cerrado se frena y se dice;
 *  - con los dos juntos, un texto libre a un cliente de la API fuera de las
 *    24 h sale por una linea normal (con plantilla, por la API);
 *  - cada linea va con la politica de su tipo.
 */

import { describe, expect, it } from 'vitest';
import { createSender, type LineaDeEnvio } from '../src/outbound/sender.js';
import { admiteTipo, type ModoLineas } from '../src/whatsapp/modo-lineas.js';
import { politicaBase } from '../src/salud/politica.js';
import { approvedTemplate, createFakeRepos, createFakeWhatsApp } from './fakes.js';

const WARMUP = { startPerDay: 50, growth: 1.5, hardCap: 1000 };
const NORMAL = '00000000-0000-0000-0000-000000000001';
const API = 'linea-api';

function montar(modoInicial: ModoLineas) {
  const repos = createFakeRepos();
  const waNormal = createFakeWhatsApp();
  const waApi = createFakeWhatsApp();
  const estado = { modo: modoInicial, sorteo: null as string | null };
  const base: Record<string, Omit<LineaDeEnvio, 'enUso'>> = {
    [NORMAL]: { id: NORMAL, etiqueta: 'wsp-normal', numero: '51911111111', cliente: waNormal, identidad: 'PNID', ventanaAplica: false, tipo: 'normal' },
    [API]: { id: API, etiqueta: 'wsp-api', numero: '51922222222', cliente: waApi, identidad: `linea:${API}`, ventanaAplica: true, tipo: 'api' },
  };
  // Igual que tienda.ts: cada linea sale con su tipo y si el modo la deja en uso.
  const vista = (id: string): LineaDeEnvio => {
    const l = base[id]!;
    const enUso = admiteTipo(estado.modo, l.tipo!);
    return { ...l, enUso, ...(enUso ? {} : { motivoPausa: `La línea «${l.etiqueta}» está en pausa por el modo.` }) };
  };
  const politicasPedidas: string[] = [];
  const sender = createSender({
    repos,
    wa: waNormal,
    resolverLinea: async (id) => (base[id ?? NORMAL] ? vista(id ?? NORMAL) : null),
    // El reparto real ya descarta las lineas fuera del modo; aqui el sorteo lo fija la prueba.
    elegirLinea: async (excluir) => {
      const candidatas = Object.keys(base).map(vista).filter((l) => l.enUso && l.id !== excluir);
      return candidatas.find((l) => l.id === estado.sorteo) ?? candidatas[0] ?? null;
    },
    alternativas: async (excluir) => Object.keys(base).map(vista).filter((l) => l.enUso && l.id !== excluir),
    phoneNumberId: 'PNID',
    warmup: WARMUP,
    maxMarketingPerContact7d: 2,
    politicaDe: (l) => {
      politicasPedidas.push(`${l.id}:${l.tipo}`);
      return { ...politicaBase(l.tipo === 'api' ? 'cloud' : 'no_oficial'), soloRitmo: true, autoPausa: false };
    },
  });
  return { repos, waNormal, waApi, estado, sender, politicasPedidas };
}

const texto = (phone: string, extra: Record<string, unknown> = {}) => ({ phone, kind: 'freeform' as const, category: 'UTILITY' as const, text: 'hola', manual: true, ...extra });

/** Un cliente que escribio por esa linea hace `horas` horas (abre o no la ventana de 24 h). */
async function escribio(repos: ReturnType<typeof createFakeRepos>, phone: string, lineaId: string, horas: number) {
  const c = await repos.contacts.upsertFromInbound(phone);
  const cuando = new Date(Date.now() - horas * 3_600_000);
  await repos.messages.add({ contactId: c.id, direction: 'in', wamid: `IN-${phone}-${horas}`, kind: 'text', body: 'hola', lineaId, createdAt: cuando });
  await repos.contacts.touchInbound(phone, cuando);
  return c;
}

describe('modo de lineas en el sender', () => {
  it('solo API: un cliente nuevo entra por la API aunque el sorteo dijera la normal', async () => {
    const { sender, waApi, waNormal, estado } = montar('api');
    estado.sorteo = NORMAL;
    const r = await sender.send(texto('51900000101'));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: API });
    expect(waNormal.sent).toHaveLength(0);
    expect(waApi.sent).toHaveLength(1);
  });

  it('solo API: el chat abierto en una linea normal se sigue contestando por ella', async () => {
    const { sender, repos, waNormal, waApi } = montar('api');
    await escribio(repos, '51900000102', NORMAL, 2);
    const r = await sender.send(texto('51900000102'));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: NORMAL });
    expect(waNormal.sent).toHaveLength(1);
    expect(waApi.sent).toHaveLength(0);
  });

  it('solo API: con el chat cerrado sale por la API y el cliente conserva su linea', async () => {
    const { sender, repos, waNormal, waApi } = montar('api');
    await repos.templates.upsert(approvedTemplate({ name: 'aviso', language: 'es', variables: 0, body: 'Hola, tenemos novedades de tu pedido.' }));
    const c = await escribio(repos, '51900000103', NORMAL, 30);
    await repos.contacts.setOptIn(c.phone, 'prueba');
    const r = await sender.send({ phone: c.phone, kind: 'template', templateName: 'aviso', templateLanguage: 'es', category: 'UTILITY', variables: [] });
    expect(r).toMatchObject({ ok: true, whatsappNumberId: API });
    expect(waApi.sent).toHaveLength(1);
    expect(waNormal.sent).toHaveLength(0);
    expect(repos._deliveries.at(-1)).toMatchObject({ whatsappNumberId: API, lineaMotivo: 'original_no_disponible' });
    // Su linea sigue siendo la normal: al volver a «los dos juntos», vuelve a ella.
    expect(await repos.messages.lineaDeLaConversacion(c.id)).toBe(NORMAL);
  });

  it('solo API: la linea normal elegida a mano con el chat cerrado se frena con el motivo', async () => {
    const { sender, repos, waNormal } = montar('api');
    await escribio(repos, '51900000104', NORMAL, 30);
    const r = await sender.send(texto('51900000104', { whatsappNumberId: NORMAL }));
    expect(r).toMatchObject({ ok: false, blocked: true, code: 'linea_fuera_de_modo', whatsappNumberId: NORMAL });
    expect(!r.ok && r.blocked ? r.reason : '').toContain('en pausa');
    expect(waNormal.sent).toHaveLength(0);
  });

  it('solo API: elegida a mano con el chat abierto, sale', async () => {
    const { sender, repos, waNormal } = montar('api');
    await escribio(repos, '51900000105', NORMAL, 1);
    const r = await sender.send(texto('51900000105', { whatsappNumberId: NORMAL }));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: NORMAL });
    expect(waNormal.sent).toHaveLength(1);
  });

  it('solo normal: un cliente de la API con el chat cerrado sale por la normal', async () => {
    const { sender, repos, waNormal, waApi } = montar('normal');
    await escribio(repos, '51900000106', API, 30);
    const r = await sender.send(texto('51900000106'));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: NORMAL });
    expect(waNormal.sent).toHaveLength(1);
    expect(waApi.sent).toHaveLength(0);
  });

  it('los dos: texto libre a un cliente de la API fuera de las 24 h sale por la normal, solo esa vez', async () => {
    const { sender, repos, waNormal, waApi } = montar('ambos');
    const c = await escribio(repos, '51900000107', API, 30);
    const r = await sender.send(texto('51900000107'));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: NORMAL });
    expect(waNormal.sent).toHaveLength(1);
    expect(waApi.sent).toHaveLength(0);
    expect(repos._deliveries.at(-1)).toMatchObject({ whatsappNumberId: NORMAL, lineaMotivo: 'ventana_cerrada' });
    expect(await repos.messages.lineaDeLaConversacion(c.id)).toBe(API);
  });

  it('los dos: dentro de las 24 h el cliente de la API se contesta por la API', async () => {
    const { sender, repos, waNormal, waApi } = montar('ambos');
    await escribio(repos, '51900000108', API, 3);
    const r = await sender.send(texto('51900000108'));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: API });
    expect(waApi.sent).toHaveLength(1);
    expect(waNormal.sent).toHaveLength(0);
  });

  it('los dos: con plantilla, el cliente de la API sigue por la API aunque pasen las 24 h', async () => {
    const { sender, repos, waApi, waNormal } = montar('ambos');
    await repos.templates.upsert(approvedTemplate({ name: 'aviso', language: 'es', variables: 0, body: 'Hola, tenemos novedades de tu pedido.' }));
    const c = await escribio(repos, '51900000109', API, 30);
    await repos.contacts.setOptIn(c.phone, 'prueba');
    const r = await sender.send({ phone: c.phone, kind: 'template', templateName: 'aviso', templateLanguage: 'es', category: 'UTILITY', variables: [] });
    expect(r).toMatchObject({ ok: true, whatsappNumberId: API });
    expect(waApi.sent).toHaveLength(1);
    expect(waNormal.sent).toHaveLength(0);
  });

  it('los dos: a un cliente nuevo con texto libre no se le asigna la API si hay una normal', async () => {
    const { sender, repos, waNormal, estado } = montar('ambos');
    estado.sorteo = API;
    const r = await sender.send(texto('51900000110'));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: NORMAL });
    expect(waNormal.sent).toHaveLength(1);
    expect(repos._deliveries.at(-1)).toMatchObject({ whatsappNumberId: NORMAL, lineaMotivo: 'asignacion_original' });
    const c = await repos.contacts.getByPhone('51900000110');
    expect(await repos.lineasContacto.fijarSiNoTiene(c!.id, API, new Date())).toBe(NORMAL);
  });

  it('cada linea pide la politica de su tipo', async () => {
    const { sender, repos, politicasPedidas } = montar('ambos');
    await escribio(repos, '51900000111', API, 1);
    await escribio(repos, '51900000112', NORMAL, 1);
    await sender.send(texto('51900000111'));
    await sender.send(texto('51900000112'));
    expect(politicasPedidas).toEqual([`${API}:api`, `${NORMAL}:normal`]);
  });
});
