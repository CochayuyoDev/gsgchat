/**
 * Lo humano del cliente no oficial: la escritura simulada antes de cada
 * envio (presencia composing/paused en Baileys, startTyping/stopTyping en
 * WAHA) y los cortes del socket que llegan al monitor, con el 403 parando
 * la reconexion.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalClient } from '../src/whatsapp/local/client.js';
import { createWahaClient } from '../src/whatsapp/waha/client.js';
import { aMano } from '../src/salud/humano.js';
import {
  ackToStatus,
  acksToStatuses,
  explicarCierre,
  getLocalState,
  resetLocalForTests,
  startLocal,
  type LocalSocket,
} from '../src/whatsapp/local/session.js';

beforeEach(() => {
  resetLocalForTests();
});

function fakeSocket() {
  const handlers = new Map<string, (arg: unknown) => void>();
  const pasos: string[] = [];
  const sock: LocalSocket = {
    async sendMessage(jid, content) {
      pasos.push(`send:${jid}:${JSON.stringify(content)}`);
      return { key: { id: 'wamid-local-1' } };
    },
    async readMessages() {},
    async requestPairingCode() {
      return 'ABCD1234';
    },
    async logout() {},
    end() {},
    ev: { on: (evento, handler) => handlers.set(evento, handler as (arg: unknown) => void) },
    user: { id: '5215500000000:1@s.whatsapp.net', name: 'Mi Negocio' },
    async sendPresenceUpdate(type, jid) {
      pasos.push(`presence:${type}:${jid ?? ''}`);
    },
    async presenceSubscribe(jid) {
      pasos.push(`subscribe:${jid}`);
    },
  };
  async function listo() {
    for (let i = 0; i < 100 && !handlers.has('connection.update'); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  return { sock, pasos, listo, emitir: (e: string, arg: unknown) => handlers.get(e)?.(arg) };
}

async function conectado(opts: { onDisconnect?: (code: number | undefined, detail: string) => void } = {}) {
  const f = fakeSocket();
  const promesa = startLocal({
    authDir: 'C:/no/existe/da/igual',
    createSocket: async () => ({ sock: f.sock, saveCreds: async () => {} }),
    onDisconnect: opts.onDisconnect,
  });
  await f.listo();
  f.emitir('connection.update', { connection: 'open' });
  await promesa;
  return f;
}

describe('escritura simulada con Baileys', () => {
  it('avisa que escribe, espera lo que tardaria y entonces manda; el texto es el mismo', async () => {
    const { pasos } = await conectado();
    const esperas: number[] = [];
    const wa = createLocalClient({ humanizar: true, dormir: async (ms) => { esperas.push(ms); } });
    const r = await wa.sendText('5215512345678', 'Hola, le escribimos por su pedido P-1');
    expect(r.wamid).toBe('wamid-local-1');
    expect(pasos).toEqual([
      'subscribe:5215512345678@s.whatsapp.net',
      'presence:composing:5215512345678@s.whatsapp.net',
      'presence:paused:5215512345678@s.whatsapp.net',
      'send:5215512345678@s.whatsapp.net:{"text":"Hola, le escribimos por su pedido P-1"}',
    ]);
    expect(esperas.length).toBe(1);
    expect(esperas[0]).toBeGreaterThanOrEqual(1200);
    expect(esperas[0]).toBeLessThanOrEqual(9000);
  });

  it('lo que manda una persona desde el chat no espera lo que tardaria en teclearlo: un parpadeo y sale', async () => {
    const { pasos } = await conectado();
    const esperas: number[] = [];
    const wa = createLocalClient({ humanizar: true, dormir: async (ms) => { esperas.push(ms); } });
    const texto = 'Gracias por su tiempo, Ana. Que tenga un buen dia y cualquier cosa nos escribe por aqui mismo.';
    await aMano(() => wa.sendText('51987654321', texto));
    expect(pasos.at(-1)).toBe('send:51987654321@s.whatsapp.net:{"text":"' + texto + '"}');
    expect(pasos).toContain('presence:composing:51987654321@s.whatsapp.net');
    expect(esperas).toEqual([700]);
    // Fuera del contexto "a mano", el mismo texto vuelve a esperar lo normal.
    esperas.length = 0;
    await wa.sendText('51987654321', texto);
    expect(esperas[0]).toBeGreaterThan(700);
  });

  it('apagado, manda directo y sin presencia', async () => {
    const { pasos } = await conectado();
    const wa = createLocalClient({ humanizar: false });
    await wa.sendText('5215512345678', 'directo');
    expect(pasos).toEqual(['send:5215512345678@s.whatsapp.net:{"text":"directo"}']);
  });

  it('se puede decidir por llamada (la politica puede cambiar sin reiniciar)', async () => {
    const { pasos } = await conectado();
    let activo = false;
    const wa = createLocalClient({ humanizar: () => activo, dormir: async () => {} });
    await wa.sendText('5215512345678', 'uno');
    activo = true;
    await wa.sendText('5215512345678', 'dos');
    expect(pasos.filter((p) => p.startsWith('presence')).length).toBe(2);
  });

  it('un socket sin presencia no impide el envio', async () => {
    const f = fakeSocket();
    delete (f.sock as Partial<LocalSocket>).sendPresenceUpdate;
    delete (f.sock as Partial<LocalSocket>).presenceSubscribe;
    const promesa = startLocal({ authDir: 'C:/x', createSocket: async () => ({ sock: f.sock, saveCreds: async () => {} }) });
    await f.listo();
    f.emitir('connection.update', { connection: 'open' });
    await promesa;
    const wa = createLocalClient({ humanizar: true, dormir: async () => {} });
    const r = await wa.sendText('5215512345678', 'sin presencia');
    expect(r.wamid).toBe('wamid-local-1');
  });
});

describe('los cortes del socket', () => {
  it('cada corte llega al monitor con su codigo', async () => {
    const cortes: Array<[number | undefined, string]> = [];
    const f = await conectado({ onDisconnect: (code, detail) => cortes.push([code, detail]) });
    f.emitir('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 428 }, message: 'Connection Closed' } } });
    expect(cortes).toEqual([[428, 'Connection Closed']]);
    // 428 es de red: se reintenta.
    expect(getLocalState().status).toBe('FAILED');
  });

  it('un 403 es un baneo: se para y no se reintenta solo', async () => {
    const cortes: number[] = [];
    const f = await conectado({ onDisconnect: (code) => cortes.push(code ?? -1) });
    f.emitir('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 403 } } } });
    expect(cortes).toEqual([403]);
    expect(getLocalState().status).toBe('STOPPED');
    expect(getLocalState().detail).toMatch(/baneo/i);
  });

  it('explica cada codigo en cristiano', () => {
    expect(explicarCierre(401)).toMatch(/escanear/);
    expect(explicarCierre(403)).toMatch(/baneo/);
    expect(explicarCierre(440)).toMatch(/otra sesion/i);
    expect(explicarCierre(515)).toMatch(/reiniciar/);
    expect(explicarCierre(undefined)).toMatch(/corto/);
  });

  it('un aviso que revienta no tumba la reconexion', async () => {
    const f = await conectado({
      onDisconnect: () => {
        throw new Error('boom');
      },
    });
    f.emitir('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 428 } } } });
    expect(getLocalState().status).toBe('FAILED');
  });
});

describe('escritura simulada con WAHA', () => {
  it('startTyping, espera, stopTyping y el envio, en ese orden', async () => {
    const llamadas: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      llamadas.push(path);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (path === '/api/sendText') {
        return new Response(JSON.stringify({ id: `true_${body.chatId}_ABC` }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const wa = createWahaClient({ baseUrl: 'http://waha.test', fetchImpl, humanizar: true, dormir: async () => {} });
    const r = await wa.sendText('5215512345678', 'hola');
    expect(llamadas).toEqual(['/api/startTyping', '/api/stopTyping', '/api/sendText']);
    expect(r.wamid).toBe('true_5215512345678@c.us_ABC');
  });

  it('si startTyping falla, el mensaje sale igual', async () => {
    const fetchImpl = (async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/api/startTyping') return new Response('{"error":"no"}', { status: 500 });
      if (path === '/api/sendText') return new Response(JSON.stringify({ id: 'X' }), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const wa = createWahaClient({ baseUrl: 'http://waha.test', fetchImpl, humanizar: true, dormir: async () => {} });
    expect((await wa.sendText('5215512345678', 'hola')).wamid).toBe('X');
  });
});

describe('los acuses de Baileys', () => {
  it('traduce el estado numerico al de Meta', () => {
    expect(ackToStatus(0)).toBe('failed');
    expect(ackToStatus(1)).toBeNull();
    expect(ackToStatus(2)).toBe('sent');
    expect(ackToStatus(3)).toBe('delivered');
    expect(ackToStatus(4)).toBe('read');
    expect(ackToStatus(5)).toBe('read');
    expect(ackToStatus('3')).toBe('delivered');
    expect(ackToStatus(undefined)).toBeNull();
  });

  it('solo los mensajes propios con estado util llegan como statuses', () => {
    const statuses = acksToStatuses([
      { key: { id: 'A', remoteJid: '5215512345678@s.whatsapp.net', fromMe: true }, update: { status: 3 } },
      { key: { id: 'B', remoteJid: '5215512345678@s.whatsapp.net', fromMe: false }, update: { status: 4 } },
      { key: { id: 'C', remoteJid: '5215512345678@s.whatsapp.net', fromMe: true }, update: { status: 1 } },
      { key: { id: 'D', remoteJid: '5215512345678@s.whatsapp.net' }, update: { status: 4 } },
    ]);
    expect(statuses.map((s) => [s.id, s.status, s.recipient_id])).toEqual([
      ['A', 'delivered', '5215512345678'],
      ['D', 'read', '5215512345678'],
    ]);
  });

  it('un acuse del socket llega a onChange como statuses', async () => {
    const recibidos: unknown[] = [];
    const f = fakeSocket();
    const handlers = new Map<string, (arg: unknown) => void>();
    f.sock.ev = { on: (evento, handler) => handlers.set(evento, handler as (arg: unknown) => void) };
    const promesa = startLocal({
      authDir: 'C:/x',
      createSocket: async () => ({ sock: f.sock, saveCreds: async () => {} }),
      onChange: (value) => {
        recibidos.push(value);
      },
    });
    for (let i = 0; i < 100 && !handlers.has('messages.update'); i++) await new Promise((r) => setTimeout(r, 5));
    handlers.get('connection.update')?.({ connection: 'open' });
    await promesa;
    handlers.get('messages.update')?.([
      { key: { id: 'wamid-local-1', remoteJid: '5215512345678@s.whatsapp.net', fromMe: true }, update: { status: 3 } },
    ]);
    await new Promise((r) => setTimeout(r, 10));
    expect(recibidos[0]).toMatchObject({ statuses: [{ id: 'wamid-local-1', status: 'delivered' }] });
  });
});
