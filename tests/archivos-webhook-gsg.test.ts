import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { crearBus } from '../src/eventos/bus.js';
import { observarRepos } from '../src/eventos/observar.js';
import { idDeMedia, mediaDirectory } from '../src/whatsapp/local/media.js';

// Fotos, videos y audios entre GSG y GSGchat, en las dos direcciones:
//  - del cliente a GSG: el webhook mensaje.recibido trae `archivo.url` (el mismo
//    enlace firmado del historial) y abre el fichero tal cual.
//  - de GSG al cliente: POST /api/v1/chat con `media`; el archivo queda en el chat
//    y GSG lo vuelve a ver en el historial con su enlace.
let e: EscenarioEntregas;
let lectura: string;
let escritura: string;
const dir = mediaDirectory();
const FOTO = idDeMedia('wamid.foto-webhook-gsg', '.jpg');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(200, 9)]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(200, 5)]);
const ARCHIVOS = { publicBase: 'http://localhost:3000', secreto: 'x'.repeat(40) };
const ruta = (url: string) => new URL(url).pathname;
let servidor: Server;
let base = '';

beforeAll(async () => {
  e = await crearEscenarioEntregas({ confirmarLista: true });
  lectura = generarClaveApi();
  escritura = generarClaveApi();
  await e.repos.claves.crear({ nombre: 'GSG lee', hash: hashClaveApi(lectura), prefijo: prefijoDeClave(lectura), creadaPor: null, permisos: ['entregas:gestionar', 'conversaciones:leer'] });
  await e.repos.claves.crear({ nombre: 'GSG escribe', hash: hashClaveApi(escritura), prefijo: prefijoDeClave(escritura), creadaPor: null, permisos: ['conversaciones:leer', 'mensajes:enviar'] });
  const r = await e.app.inject({ method: 'POST', url: '/api/v1/entregas', headers: { 'x-api-key': lectura, 'content-type': 'application/json' }, payload: JSON.stringify({ ...OBLIGATORIOS_GSG, tracking: 'MEDIA-1', cliente: 'Lucia', telefono: '987650022' }) });
  expect(r.statusCode).toBe(201);
  await e.contesta('987650022', { texto: 'hola' });
  await writeFile(path.join(dir, FOTO), JPEG);
  const ficheros: Record<string, { tipo: string; datos: Buffer }> = {
    '/foto.jpg': { tipo: 'image/jpeg', datos: JPEG },
    '/video.mp4': { tipo: 'video/mp4', datos: MP4 },
    '/nota.ogg': { tipo: 'audio/ogg', datos: OGG },
  };
  servidor = createServer((req, res) => {
    const f = ficheros[req.url ?? ''];
    if (!f) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', f.tipo);
    res.end(f.datos);
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((ok) => servidor.close(ok));
  await e.cerrar();
  await rm(path.join(dir, FOTO), { force: true });
});

const historial = async () => ((await e.app.inject({ method: 'GET', url: '/api/v1/historial?tracking=MEDIA-1', headers: { 'x-api-key': lectura } })).json().mensajes as any[]);
const escribir = (cuerpo: Record<string, unknown>) =>
  e.app.inject({ method: 'POST', url: '/api/v1/chat', headers: { 'x-api-key': escritura, 'content-type': 'application/json' }, payload: JSON.stringify({ tracking: 'MEDIA-1', usuario: { id: 5, nombre: 'Ana', rol: 'operador' }, ...cuerpo }) });

describe('del cliente a GSG: el webhook trae el archivo', () => {
  it('mensaje.recibido de una foto trae archivo.url y abre la foto tal cual', async () => {
    const bus = crearBus();
    const vistos: any[] = [];
    bus.escucharTodo((nombre, payload) => { vistos.push({ nombre, payload }); });
    const repos = observarRepos(e.repos, bus, ARCHIVOS);
    const c = (await e.repos.contacts.getByPhone('51987650022'))!;
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'wamid.foto-webhook-gsg', kind: 'image', body: 'el comprobante', payload: { media: { id: FOTO, mimeType: 'image/jpeg', bytes: JPEG.length } }, createdAt: new Date() });
    const evento = vistos.find((x) => x.nombre === 'mensaje.recibido')!.payload;
    expect(evento.chatId).toBe('MEDIA-1');
    expect(evento.mensaje.archivo).toMatchObject({ tipo: 'imagen', mimeType: 'image/jpeg', bytes: JPEG.length, url: expect.stringMatching(/^http:\/\/localhost:3000\/archivos\/[\w-]+\.[\w-]+$/) });
    const r = await e.app.inject({ method: 'GET', url: ruta(evento.mensaje.archivo.url) });
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.equals(JPEG)).toBe(true);
  });

  it('mensaje.recibido de un sticker trae archivo.url de tipo sticker y abre el webp', async () => {
    const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([9, 9, 9, 9]), Buffer.from('WEBP'), Buffer.alloc(40, 3)]);
    const id = idDeMedia('wamid.sticker-webhook-gsg', '.webp');
    await writeFile(path.join(dir, id), WEBP);
    try {
      const bus = crearBus();
      const vistos: any[] = [];
      bus.escucharTodo((nombre, payload) => { vistos.push({ nombre, payload }); });
      const c = (await e.repos.contacts.getByPhone('51987650022'))!;
      await observarRepos(e.repos, bus, ARCHIVOS).messages.add({ contactId: c.id, direction: 'in', wamid: 'wamid.sticker-webhook-gsg', kind: 'sticker', body: '(sticker)', payload: { media: { id, mimeType: 'image/webp', bytes: WEBP.length } }, createdAt: new Date() });
      const evento = vistos.find((x) => x.nombre === 'mensaje.recibido')!.payload;
      expect(evento.mensaje.archivo).toMatchObject({ tipo: 'sticker', mimeType: 'image/webp' });
      const r = await e.app.inject({ method: 'GET', url: ruta(evento.mensaje.archivo.url) });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toMatch(/^image\/webp/);
      expect(r.rawPayload.equals(WEBP)).toBe(true);
      const historial = ((await e.app.inject({ method: 'GET', url: '/api/v1/historial?tracking=MEDIA-1', headers: { 'x-api-key': lectura } })).json().mensajes as any[]);
      expect(historial.find((m) => m.tipo === 'sticker')?.archivo).toMatchObject({ tipo: 'sticker' });
    } finally {
      await rm(path.join(dir, id), { force: true });
    }
  });

  it('un mensaje de texto trae archivo: null, y sin la direccion publica configurada tambien', async () => {
    const bus = crearBus();
    const vistos: any[] = [];
    bus.escucharTodo((nombre, payload) => { vistos.push({ nombre, payload }); });
    const c = (await e.repos.contacts.getByPhone('51987650022'))!;
    await observarRepos(e.repos, bus, ARCHIVOS).messages.add({ contactId: c.id, direction: 'in', wamid: 'wamid.texto-webhook-gsg', kind: 'text', body: 'ya voy', payload: null, createdAt: new Date() });
    await observarRepos(e.repos, bus).messages.add({ contactId: c.id, direction: 'in', wamid: 'wamid.foto-sin-base', kind: 'image', body: null, payload: { media: { id: FOTO, mimeType: 'image/jpeg' } }, createdAt: new Date() });
    const eventos = vistos.filter((x) => x.nombre === 'mensaje.recibido').map((x) => x.payload);
    expect(eventos[0].mensaje.archivo).toBeNull();
    expect(eventos[1].mensaje.archivo).toBeNull();
  });
});

describe('de GSG al cliente: lo que GSG manda se ve en GSGchat', () => {
  it('foto, video y audio de GSG quedan en el chat y el historial los devuelve con enlace que abre el mismo fichero', async () => {
    expect((await escribir({ idExterno: 'wh-foto', texto: 'La puerta', media: { url: `${base}/foto.jpg` } })).statusCode).toBe(200);
    expect((await escribir({ idExterno: 'wh-video', media: { url: `${base}/video.mp4` } })).statusCode).toBe(200);
    expect((await escribir({ idExterno: 'wh-audio', media: { url: `${base}/nota.ogg`, voz: true } })).statusCode).toBe(200);

    const mensajes = await historial();
    for (const [tipo, bytes, familia] of [['image', JPEG, 'imagen'], ['video', MP4, 'video'], ['audio', OGG, 'audio']] as const) {
      const m = mensajes.filter((x) => x.tipo === tipo && x.direccion === 'saliente').at(-1);
      expect(m, tipo).toBeTruthy();
      expect(m.autor).toBe('persona');
      expect(m.emisor).toMatchObject({ tipo: 'gsg', usuarioId: '5' });
      expect(m.archivo).toMatchObject({ tipo: familia, bytes: bytes.length });
      const r = await e.app.inject({ method: 'GET', url: ruta(m.archivo.url) });
      expect(r.statusCode, tipo).toBe(200);
      expect(r.rawPayload.equals(bytes), tipo).toBe(true);
    }
    expect(mensajes.find((x) => x.tipo === 'image' && x.direccion === 'saliente').texto).toBe('La puerta');
  });

  it('el chat de la pantalla de GSGchat tambien trae el archivo del mensaje de GSG', async () => {
    const c = (await e.repos.contacts.getByPhone('51987650022'))!;
    const guardados = await e.repos.messages.listMessages(c.id, 100);
    const foto = guardados.find((m) => m.kind === 'image' && m.direction === 'out')!;
    expect((foto.payload as any).media.id).toBeTruthy();
    expect((foto.payload as any).emisor).toMatchObject({ tipo: 'gsg' });
  });
});
