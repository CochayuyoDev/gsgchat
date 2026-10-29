import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { firmarArchivo } from '../src/api/v1/archivos-gsg.js';
import { idDeMedia, mediaDirectory } from '../src/whatsapp/local/media.js';
import { loadConfig } from '../src/config.js';
import { hashClave } from '../src/auth/usuarios.js';
import { COOKIE_SESION, firmarSesion } from '../src/auth/sesion.js';
import { secretoDeSesion } from '../src/auth/routes.js';

// GSG ve los archivos del chat (fotos, videos, audios, documentos) con el
// historial que ya pide: cada mensaje con un archivo trae `archivo.url`, un
// enlace firmado que abre el fichero sin clave (para un <img>, <video>, <audio>).
let e: EscenarioEntregas;
let clave: string;
const dir = mediaDirectory();
const FOTO = idDeMedia('wamid.foto-historial-gsg', '.jpg');
const DOC = idDeMedia('wamid.doc-historial-gsg', '.html');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
let contactId = '';

const historial = (tracking: string) => e.app.inject({ method: 'GET', url: `/api/v1/historial?tracking=${tracking}`, headers: { 'x-api-key': clave } });
/** La ruta del enlace, sin la direccion publica (en la prueba se pide al mismo app). */
const ruta = (url: string) => new URL(url).pathname;

beforeAll(async () => {
  e = await crearEscenarioEntregas({ confirmarLista: true });
  clave = generarClaveApi();
  await e.repos.claves.crear({ nombre: 'GSG lee', hash: hashClaveApi(clave), prefijo: prefijoDeClave(clave), creadaPor: null, permisos: ['entregas:gestionar', 'conversaciones:leer'] });
  const r = await e.app.inject({ method: 'POST', url: '/api/v1/entregas', headers: { 'x-api-key': clave, 'content-type': 'application/json' }, payload: JSON.stringify({ ...OBLIGATORIOS_GSG, tracking: 'ARCH-1', cliente: 'Marta', telefono: '987650011' }) });
  expect(r.statusCode).toBe(201);
  await e.contesta('987650011', { texto: 'le mando la foto del comprobante' });
  contactId = (await e.repos.contacts.getByPhone('51987650011'))!.id;
  await writeFile(path.join(dir, FOTO), JPEG);
  await writeFile(path.join(dir, DOC), '<script>alert(1)</script>');
  // Una foto que llegó por QR (el fichero ya está en el disco)…
  await e.repos.messages.add({ contactId, direction: 'in', wamid: 'wamid.foto-historial-gsg', kind: 'image', body: 'el comprobante', payload: { media: { id: FOTO, mimeType: 'image/jpeg', caption: 'el comprobante', bytes: JPEG.length } } });
  // …un audio que llegó por la API de Meta (solo trae el id de Meta)…
  await e.repos.messages.add({ contactId, direction: 'in', wamid: 'wamid.audio-meta', kind: 'audio', body: 'ya pagué', payload: { media: { id: '1234567890', mimeType: 'audio/ogg', seconds: 7, voice: true }, transcripcion: 'ya pagué' } });
  // …y un documento HTML (no se abre en la página: se descarga).
  await e.repos.messages.add({ contactId, direction: 'in', wamid: 'wamid.doc-historial-gsg', kind: 'document', body: null, payload: { media: { id: DOC, mimeType: 'text/html', filename: 'pagina.html' } } });
});
afterAll(async () => {
  await e.cerrar();
  for (const f of [FOTO, DOC, idDeMedia('meta:1234567890', '.ogg')]) await rm(path.join(dir, f), { force: true });
});

describe('los archivos del chat en el historial de GSG', () => {
  it('cada mensaje con archivo trae su enlace; los de texto, null', async () => {
    const r = await historial('ARCH-1');
    expect(r.statusCode).toBe(200);
    const mensajes = r.json().mensajes as Array<Record<string, any>>;
    const texto = mensajes.find((m) => m.texto === 'le mando la foto del comprobante')!;
    expect(texto.archivo).toBeNull();
    const foto = mensajes.find((m) => m.tipo === 'image')!;
    expect(foto.archivo).toMatchObject({ tipo: 'imagen', mimeType: 'image/jpeg', bytes: JPEG.length, voz: false, url: expect.stringMatching(/^http:\/\/localhost:3000\/archivos\/[\w-]+\.[\w-]+$/) });
    expect(new Date(foto.archivo.caducaEn).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    const audio = mensajes.find((m) => m.tipo === 'audio')!;
    expect(audio.archivo).toMatchObject({ tipo: 'audio', segundos: 7, voz: true });
    // Sin transcripción: el audio se escucha con su enlace.
    expect(audio.texto).toBe('(audio)');
    expect(JSON.stringify(audio)).not.toMatch(/transcripcion|ya pagué/);
  });

  it('el enlace abre la foto tal cual, sin clave de API', async () => {
    const foto = ((await historial('ARCH-1')).json().mensajes as any[]).find((m) => m.tipo === 'image');
    const r = await e.app.inject({ method: 'GET', url: ruta(foto.archivo.url) });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(r.headers['content-disposition']).toBe('inline');
    expect(r.rawPayload.equals(JPEG)).toBe(true);
  });

  it('lo que llegó por Meta se baja de Meta la primera vez y luego sale del disco', async () => {
    let bajadas = 0;
    e.wa.downloadMedia = async (id: string) => {
      bajadas++;
      expect(id).toBe('1234567890');
      return { datos: Buffer.from('OggS-audio'), mimeType: 'audio/ogg' };
    };
    try {
      const audio = ((await historial('ARCH-1')).json().mensajes as any[]).find((m) => m.tipo === 'audio');
      for (let i = 0; i < 2; i++) {
        const r = await e.app.inject({ method: 'GET', url: ruta(audio.archivo.url) });
        expect(r.statusCode).toBe(200);
        expect(r.headers['content-type']).toMatch(/^audio\/ogg/);
        expect(r.body).toBe('OggS-audio');
      }
      expect(bajadas).toBe(1);
    } finally {
      delete (e.wa as { downloadMedia?: unknown }).downloadMedia;
    }
  });

  it('un documento que no es PDF se descarga, no se abre en la página', async () => {
    const doc = ((await historial('ARCH-1')).json().mensajes as any[]).find((m) => m.tipo === 'document');
    expect(doc.archivo).toMatchObject({ tipo: 'documento', nombre: 'pagina.html' });
    const r = await e.app.inject({ method: 'GET', url: ruta(doc.archivo.url) });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/^application\/octet-stream/);
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="pagina.html"/);
  });

  it('el cliente con su pedido manda foto, audio y video: se guardan, el bot no contesta y GSG los abre', async () => {
    const r = await e.app.inject({ method: 'POST', url: '/api/v1/entregas', headers: { 'x-api-key': clave, 'content-type': 'application/json' }, payload: JSON.stringify({ ...OBLIGATORIOS_GSG, tracking: 'ARCH-2', cliente: 'Pablo', telefono: '987650022' }) });
    expect(r.statusCode).toBe(201);
    await e.trabajar();
    const antes = e.mensajesA('987650022').length;
    const pedidoAntes = await e.entrega('ARCH-2');
    for (const adjunto of ['image', 'audio', 'video'] as const) await e.contesta('987650022', { adjunto });
    expect(e.mensajesA('987650022')).toHaveLength(antes);
    const pedido = await e.entrega('ARCH-2');
    expect(pedido).toMatchObject({ estado: pedidoAntes!.estado, ubicacionEstado: pedidoAntes!.ubicacionEstado });
    const mensajes = (await historial('ARCH-2')).json().mensajes as Array<Record<string, any>>;
    const entrantes = mensajes.filter((m) => m.direccion === 'entrante');
    expect(entrantes.map((m) => m.archivo?.tipo)).toEqual(['imagen', 'audio', 'video']);
    // Llegaron por la API de Meta (solo el id): al abrir el enlace se baja de Meta.
    e.wa.downloadMedia = async () => ({ datos: Buffer.from('JPEG'), mimeType: 'image/jpeg' });
    try {
      const foto = await e.app.inject({ method: 'GET', url: ruta(entrantes[0]!.archivo.url) });
      expect(foto.statusCode).toBe(200);
      expect(foto.body).toBe('JPEG');
    } finally {
      delete (e.wa as { downloadMedia?: unknown }).downloadMedia;
    }
  });

  it('en el chat del panel la foto, el audio y el video traen el mismo enlace: se ven y se escuchan ahí', async () => {
    const config = loadConfig({ PUBLIC_BASE_URL: 'http://localhost:3000', DATABASE_URL: 'mysql://x/y', TIMEZONE: 'America/Lima', TRACKING_SECRET: 'x'.repeat(40) });
    const usuario = await e.repos.usuarios.crear({ usuario: 'operadorarchivos', nombre: 'Op', rol: 'admin', clave: hashClave('Clave-123-segura') });
    const cookie = `${COOKIE_SESION}=${firmarSesion(secretoDeSesion(config), { u: usuario.id, v: usuario.sesionVersion })}`;
    const contacto = (await e.repos.contacts.getByPhone('51987650022'))!;
    // El chat existe desde que el sistema le escribió (aquí, el primer mensaje del pedido).
    await e.repos.messages.add({ contactId: contacto.id, direction: 'out', kind: 'text', wamid: 'archivos.primer-mensaje', body: '¿Nos comparte su ubicación?', payload: { origen: 'sistema' } });
    const hilo = await e.app.inject({ url: `/admin/chat/${contacto.id}?limit=30`, headers: { cookie } });
    expect(hilo.statusCode).toBe(200);
    const conArchivo = (hilo.json().messages as Array<{ kind: string; archivo: { url: string; tipo: string } | null }>).filter((m) => m.archivo);
    expect(conArchivo.map((m) => m.archivo!.tipo)).toEqual(['imagen', 'audio', 'video']);
    // Relativo: vale con el prefijo de la tienda (/tienda/<slug>/archivos/...).
    expect(conArchivo.every((m) => m.archivo!.url.startsWith('./archivos/'))).toBe(true);
    // Un texto no trae archivo.
    expect((hilo.json().messages as Array<{ kind: string; archivo: unknown }>).filter((m) => m.kind === 'text' || m.kind === 'interactive').every((m) => m.archivo === null)).toBe(true);
    e.wa.downloadMedia = async () => ({ datos: Buffer.from('OGG'), mimeType: 'audio/ogg' });
    try {
      const audio = await e.app.inject({ method: 'GET', url: conArchivo[1]!.archivo!.url.slice(1) });
      expect(audio.statusCode).toBe(200);
      expect(audio.body).toBe('OGG');
    } finally {
      delete (e.wa as { downloadMedia?: unknown }).downloadMedia;
    }
  });

  it('un enlace tocado no abre nada, y uno caducado lo dice (410)', async () => {
    const foto = ((await historial('ARCH-1')).json().mensajes as any[]).find((m) => m.tipo === 'image');
    const tocado = ruta(foto.archivo.url).replace(/.$/, (c: string) => (c === 'A' ? 'B' : 'A'));
    expect((await e.app.inject({ method: 'GET', url: tocado })).statusCode).toBe(404);
    // Otro mensaje con la firma de este: la firma cubre el mensaje.
    const [cuerpo, firma] = ruta(foto.archivo.url).split('/archivos/')[1]!.split('.');
    const otro = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cuerpo!, 'base64url').toString()), m: 1 })).toString('base64url');
    expect((await e.app.inject({ method: 'GET', url: `/archivos/${otro}.${firma}` })).statusCode).toBe(404);
    const viejo = firmarArchivo({ c: contactId, m: foto.cursor, exp: Math.floor(Date.now() / 1000) - 60 }, 'x'.repeat(40));
    const r = await e.app.inject({ method: 'GET', url: `/archivos/${viejo}` });
    expect(r.statusCode).toBe(410);
    expect(r.json().error).toMatch(/caducó/);
  });
});
