/**
 * Traer el historial que ya vive en WAHA.
 *
 * Lo que importa demostrar: que el hilo queda en orden, que un grupo no entra,
 * que volver a importar no duplica nada -es lo que hace que se pueda pulsar el
 * boton dos veces sin miedo- y que la ventana de 24 h se recalcula, porque de
 * eso depende que el chat deje escribir texto libre.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { createFakeRepos, type FakeRepos } from './fakes.js';
import {
  cuerpoDe,
  esConversacionDirecta,
  importarConversaciones,
  tipoDe,
} from '../src/whatsapp/waha/importar.js';

const AYER = Math.floor(Date.now() / 1000) - 24 * 3600;

const CHATS = [
  { id: '51987654321@c.us', name: 'Ana Ruiz' },
  { id: '120363000000000000@g.us', name: 'Grupo de reparto' },
];

const MENSAJES: Record<string, unknown[]> = {
  '51987654321@c.us': [
    { id: 'false_51987654321@c.us_B', timestamp: AYER + 60, fromMe: true, body: 'Buenas, le escribimos por su pedido' },
    { id: 'false_51987654321@c.us_A', timestamp: AYER, fromMe: false, body: 'Hola' },
    { id: 'false_51987654321@c.us_C', timestamp: AYER + 120, fromMe: false, type: 'image', hasMedia: true },
  ],
};

/** WAHA de mentira: responde a las dos rutas que usa el importador. */
function wahaFalso(fallos: Record<string, number> = {}) {
  const llamadas: string[] = [];
  const fetchImpl = (async (url: string) => {
    llamadas.push(url);
    const ruta = new URL(url);

    if (ruta.pathname.endsWith('/chats')) {
      return new Response(JSON.stringify(CHATS), { status: 200 });
    }

    const chat = decodeURIComponent(ruta.pathname.split('/chats/')[1]?.split('/')[0] ?? '');
    if (fallos[chat]) return new Response('boom', { status: fallos[chat] });
    return new Response(JSON.stringify(MENSAJES[chat] ?? []), { status: 200 });
  }) as unknown as typeof fetch;

  return { fetchImpl, llamadas };
}

let repos: FakeRepos;

beforeEach(() => {
  repos = createFakeRepos();
});

describe('importar conversaciones de WAHA', () => {
  it('trae el hilo en orden y crea el contacto', async () => {
    const { fetchImpl } = wahaFalso();

    const resumen = await importarConversaciones(
      { repos },
      { baseUrl: 'http://waha:3000', session: 'default', fetchImpl },
      { limiteChats: 10, mensajesPorChat: 50 },
    );

    expect(resumen).toMatchObject({ chats: 1, contactos: 1, mensajes: 3, omitidos: 1 });

    const contacto = await repos.contacts.getByPhone('51987654321');
    expect(contacto?.name).toBe('Ana Ruiz');

    const hilo = await repos.messages.listMessages(contacto!.id, 50);
    expect(hilo.map((m) => m.body)).toEqual([
      'Hola',
      'Buenas, le escribimos por su pedido',
      '(foto)',
    ]);
    expect(hilo.map((m) => m.direction)).toEqual(['in', 'out', 'in']);
  });

  it('los grupos no entran: esto es atencion uno a uno', async () => {
    const { fetchImpl, llamadas } = wahaFalso();

    await importarConversaciones({ repos }, { baseUrl: 'http://waha:3000', fetchImpl });

    expect(llamadas.some((u) => u.includes('g.us'))).toBe(false);
  });

  it('importar dos veces no duplica el hilo', async () => {
    const { fetchImpl } = wahaFalso();
    const conexion = { baseUrl: 'http://waha:3000', fetchImpl };

    await importarConversaciones({ repos }, conexion);
    await importarConversaciones({ repos }, conexion);

    const contacto = await repos.contacts.getByPhone('51987654321');
    expect(await repos.messages.listMessages(contacto!.id, 50)).toHaveLength(3);
  });

  it('deja la ventana de 24 h bien puesta', async () => {
    const { fetchImpl } = wahaFalso();

    await importarConversaciones({ repos }, { baseUrl: 'http://waha:3000', fetchImpl });

    const contacto = await repos.contacts.getByPhone('51987654321');
    // El ultimo ENTRANTE, no el ultimo mensaje.
    expect(contacto?.lastInboundAt?.getTime()).toBe((AYER + 120) * 1000);
  });

  it('una conversacion que falla no tumba la importacion entera', async () => {
    const { fetchImpl } = wahaFalso({ '51987654321@c.us': 500 });

    const resumen = await importarConversaciones({ repos }, { baseUrl: 'http://waha:3000', fetchImpl });

    expect(resumen.mensajes).toBe(0);
    expect(resumen.fallos).toHaveLength(1);
    expect(resumen.fallos[0]?.error).toMatch(/500/);
  });

  it('si WAHA no responde, se dice y no se escribe nada', async () => {
    const fetchImpl = (async () => new Response('no', { status: 503 })) as unknown as typeof fetch;

    await expect(
      importarConversaciones({ repos }, { baseUrl: 'http://waha:3000', fetchImpl }),
    ).rejects.toThrow(/503/);
  });
});

describe('lectura de un mensaje de WAHA', () => {
  it('distingue conversaciones directas de grupos y difusiones', () => {
    expect(esConversacionDirecta('51987654321@c.us')).toBe(true);
    expect(esConversacionDirecta('120363@g.us')).toBe(false);
    expect(esConversacionDirecta('status@broadcast')).toBe(false);
  });

  it('traduce los tipos y deja una marca legible', () => {
    expect(tipoDe({ type: 'ptt' })).toBe('audio');
    expect(tipoDe({ type: 'image' })).toBe('image');
    expect(tipoDe({ body: 'hola' })).toBe('text');
    expect(cuerpoDe({ type: 'audio', body: '' })).toBe('(audio)');
    expect(cuerpoDe({ type: 'chat', body: 'hola' })).toBe('hola');
  });
});
