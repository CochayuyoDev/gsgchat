/**
 * Conversaciones guardadas como modulo: buscar dentro de lo dicho, resumen y
 * etiquetas (reglas y con la IA), el pedido de GSG ligado, exportar en algo
 * que se pueda abrir (texto, pagina, Excel; con o sin datos personales),
 * notas, papelera de 30 dias, cerrar en masa las de los pedidos terminados
 * hoy, los adjuntos copiados junto al respaldo, el enlace publico de
 * evidencia, las estadisticas, aprender de lo guardado, borrar todo lo de un
 * cliente e importar un chat del telefono. Contra MySQL/MariaDB de verdad
 * (tests/mysql.ts), ficheros de verdad y el servidor real.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { createRepos, type Repos } from '../src/db/repos.js';
import { lunesRecientes } from '../src/db/archives.js';
import {
  archivarConversacion,
  borrarTodoDeCliente,
  exportarCsv,
  exportarHtml,
  exportarTexto,
  importarChatDeWhatsApp,
  iniciales,
  leerAdjunto,
  leerRespaldo,
  moverAPapelera,
  paresParaAprender,
  primeraRespuestaSeg,
  purgarPapelera,
  resumirConReglas,
  resumirRespaldo,
  revisarRespaldos,
  sacarDePapelera,
  taparNombre,
  taparTelefono,
  type ArchiveDeps,
} from '../src/archive/service.js';
import { carpetaDeAdjuntos, rutaDe } from '../src/archive/store.js';
import { crearEnlace, firmarEnlace, verificarEnlace } from '../src/archive/enlace.js';
import { leerChatDeWhatsApp } from '../src/archive/importar-whatsapp.js';
import { guardadosPage } from '../src/web/guardados-page.js';
import type { Message } from '../src/db/messages.js';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, CLAVE_API_PRUEBA } from './fakes.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

let b: BaseDePrueba;
let pool: Pool;
let repos: Repos;
let dir: string;
let mediaDir: string;

/** Un JPEG minimo (cabecera valida) para los adjuntos. */
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');

beforeAll(async () => {
  b = await baseDePrueba();
  pool = b.pool;
  repos = createRepos(pool);
  dir = await mkdtemp(path.join(tmpdir(), 'gsgchat-guardados-'));
  mediaDir = await mkdtemp(path.join(tmpdir(), 'gsgchat-media-'));
});

afterAll(async () => {
  await b?.cerrar();
  await rm(dir, { recursive: true, force: true });
  await rm(mediaDir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const tabla of ['chat_archives', 'messages', 'contacts']) await pool.query(`delete from ${tabla}`);
});

/**
 * El resumen se escribe despues de guardar, sin hacer esperar: se espera a
 * que aparezca (con una base cargada puede tardar mas de unos milisegundos).
 */
async function esperarResumen(id: number): Promise<void> {
  const hasta = Date.now() + 120_000;
  while (Date.now() < hasta) {
    if ((await repos.archives.get(id))?.resumen) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

type Linea = [dir: 'in' | 'out', texto: string] | { direction: 'in' | 'out'; body?: string | null; kind?: Message['kind']; payload?: Record<string, unknown> | null; enSeg?: number };

async function conversacion(phone: string, nombre: string, lineas: Linea[]) {
  const contacto = await repos.contacts.upsertFromInbound(phone, nombre);
  let i = 0;
  for (const l of lineas) {
    const m = Array.isArray(l) ? { direction: l[0], body: l[1] } : l;
    await repos.messages.add({
      contactId: contacto.id,
      direction: m.direction,
      wamid: `wamid.${phone}.${i}`,
      kind: m.kind ?? 'text',
      body: m.body ?? null,
      payload: m.payload ?? null,
      createdAt: m.enSeg !== undefined ? new Date(Date.UTC(2026, 8, 21, 14, 0, m.enSeg)) : new Date(Date.UTC(2026, 8, 21, 14, i)),
    });
    i++;
  }
  return contacto;
}

const iaFalsa = (respuesta: string) => ({ completar: async () => respuesta });

describe('guardar una conversacion deja lo que hace falta para encontrarla', () => {
  it('texto para buscar, quien la cerro, el pedido de GSG, y el resumen con reglas', async () => {
    const c = await conversacion('51987000001', 'Ana Quispe', [
      ['out', 'Hola Ana, ¿nos confirma que recibe hoy P-1001?'],
      ['in', 'sí, pero el motorizado de la vez pasada llegó tardísimo, un reclamo'],
      ['out', 'Disculpe, hoy le avisamos la hora.'],
    ]);
    const salida = await archivarConversacion({ repos, dir, pedidoDe: async () => 'P-1001' }, c.id, 'manual', 'Ali (ali)');
    expect(salida.ok).toBe(true);
    // El resumen se pone despues, sin hacer esperar: se espera a que este.
    await esperarResumen(salida.archive!.id);
    const a = (await repos.archives.get(salida.archive!.id))!;
    expect(a.cerradoPor).toBe('Ali (ali)');
    expect(a.pedido).toBe('P-1001');
    expect(a.resumen).toMatch(/Ana Quispe escribió 1 mensaje/);
    expect(a.etiquetas).toContain('reclamo');
    expect(a.etiquetas).toContain('motorizado');
    // Del primer mensaje del cliente (minuto 1) a la respuesta de la persona (minuto 2): 60 s.
    expect(a.primeraRespuestaSeg).toBe(60);
    expect(a.adjuntos).toEqual([]);
    expect(a.origen).toBeNull();
    // Buscar dentro de lo que se dijo.
    expect((await repos.archives.list({ texto: 'tardísimo', limit: 10, offset: 0 })).map((x) => x.id)).toEqual([a.id]);
    expect(await repos.archives.count({ texto: 'no existe esto' })).toBe(0);
    expect((await repos.archives.list({ etiqueta: 'reclamo', limit: 10, offset: 0 })).length).toBe(1);
    expect((await repos.archives.list({ pedido: 'P-1001', limit: 10, offset: 0 })).length).toBe(1);
    expect((await repos.archives.list({ reason: 'inactividad', limit: 10, offset: 0 })).length).toBe(0);
  });

  it('con la IA, el resumen y las etiquetas salen del modelo (JSON estricto, leido a la defensiva)', async () => {
    const c = await conversacion('51987000002', 'Luis', [['in', 'quiero cancelar'], ['out', 'Listo.']]);
    const deps: ArchiveDeps = { repos, dir, ia: () => iaFalsa('Claro: {"resumen":"El cliente canceló su pedido.","etiquetas":["cancelacion","otra_que_no_existe"],"pendiente":"nada"} y ya') };
    const salida = await archivarConversacion(deps, c.id, 'manual');
    const a = (await resumirRespaldo(deps, salida.archive!.id, { forzar: true }))!;
    expect(a.resumen).toBe('El cliente canceló su pedido. Pendiente: nada');
    expect(a.etiquetas).toEqual(['cancelacion']);
    // Si la IA contesta basura, quedan las reglas.
    const b = (await resumirRespaldo({ ...deps, ia: () => iaFalsa('no sé') }, salida.archive!.id, { forzar: true }))!;
    expect(b.resumen).toMatch(/Luis escribió/);
    expect(b.etiquetas).toContain('cancelacion');
    // Y si falla, tambien.
    const cc = (await resumirRespaldo({ ...deps, ia: () => ({ completar: async () => { throw new Error('caída'); } }) }, salida.archive!.id, { forzar: true }))!;
    expect(cc.resumen).toMatch(/Luis escribió/);
  });

  it('las reglas entienden lo basico: sin respuesta, cambio, pago, venta', () => {
    const m = (direction: 'in' | 'out', body: string): Message => ({ id: 1, contactId: 'c', direction, wamid: null, kind: 'text', body, payload: null, status: null, deliveryId: null, createdAt: new Date() }) as unknown as Message;
    expect(resumirConReglas([m('out', 'Hola')], 'Ana').etiquetas).toEqual(['sin_respuesta']);
    expect(resumirConReglas([m('in', 'mejor mañana a otra dirección')], 'Ana').etiquetas).toContain('cambio');
    expect(resumirConReglas([m('in', 'ya pagué por Yape')], 'Ana').etiquetas).toContain('pago');
    expect(resumirConReglas([m('in', 'quiero comprar dos, cuánto cuesta')], 'Ana').etiquetas).toContain('venta');
    expect(resumirConReglas([m('in', 'jajaja')], null).etiquetas).toEqual(['otro']);
  });

  it('la primera respuesta se mide hasta una persona, no hasta la IA ni el sistema', () => {
    const m = (direction: 'in' | 'out', seg: number, origen?: string): Pick<Message, 'direction' | 'body' | 'kind' | 'createdAt' | 'payload'> => ({ direction, body: 'x', kind: 'text', createdAt: new Date(seg * 1000), payload: origen ? { origen } : null });
    expect(primeraRespuestaSeg([m('in', 0), m('out', 90)])).toBe(90);
    expect(primeraRespuestaSeg([m('in', 0), m('out', 5, 'ia'), m('out', 120)])).toBe(120);
    expect(primeraRespuestaSeg([m('out', 0), m('in', 10), m('out', 40, 'sistema')])).toBeNull();
    expect(primeraRespuestaSeg([m('out', 0)])).toBeNull();
    // Desde el panel, con la ventana de 24 h de Meta, el chat marca 'sistema' pero pone el nombre de quien escribio: es una persona.
    expect(primeraRespuestaSeg([m('in', 0), { direction: 'out', body: 'x', kind: 'text', createdAt: new Date(20_000), payload: { origen: 'sistema', autorNombre: 'Ali' } }])).toBe(20);
  });
});

describe('adjuntos: las fotos y los audios se copian junto al respaldo', () => {
  it('se copian, se listan, se sirven, se incrustan en la pagina y se van con la papelera; lo que no esta se anota', async () => {
    await writeFile(path.join(mediaDir, 'aaaaaaaaaaaaaaaaaaaaaaaa.jpg'), JPEG);
    const c = await conversacion('51987000010', 'Rosa', [
      ['in', 'mire cómo llegó la caja'],
      { direction: 'in', kind: 'image', body: '(foto)', payload: { media: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa.jpg', kind: 'image', mimeType: 'image/jpeg', bytes: JPEG.length } } },
      { direction: 'in', kind: 'audio', body: '(audio)', payload: { media: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb.ogg', kind: 'audio', mimeType: 'audio/ogg' } } },
      { direction: 'in', kind: 'sticker', body: '(sticker)', payload: { media: { id: 'cccccccccccccccccccccccc.webp', kind: 'sticker', mimeType: 'image/webp' } } },
      ['out', 'Qué pena, Rosa. Se lo cambiamos.'],
    ]);
    const deps: ArchiveDeps = { repos, dir, mediaDir, nombreNegocio: () => 'GSG' };
    const salida = await archivarConversacion(deps, c.id, 'manual');
    expect(salida.ok).toBe(true);
    const a = salida.archive!;
    // La foto se copio; el audio no estaba; el sticker ni se intenta.
    expect(a.adjuntos).toHaveLength(2);
    expect(a.adjuntos[0]).toMatchObject({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa.jpg', kind: 'image', mimeType: 'image/jpeg', bytes: JPEG.length });
    expect(a.adjuntos[0]!.omitido).toBeUndefined();
    expect(a.adjuntos[1]).toMatchObject({ id: 'bbbbbbbbbbbbbbbbbbbbbbbb.ogg', kind: 'audio', omitido: 'no estaba en el servidor' });
    const carpeta = rutaDe(dir, carpetaDeAdjuntos(a.file));
    expect(existsSync(path.join(carpeta, 'aaaaaaaaaaaaaaaaaaaaaaaa.jpg'))).toBe(true);
    // Se lee de vuelta.
    const leido = (await leerAdjunto(deps, a, 'aaaaaaaaaaaaaaaaaaaaaaaa.jpg'))!;
    expect(leido.datos.equals(JPEG)).toBe(true);
    expect(await leerAdjunto(deps, a, 'bbbbbbbbbbbbbbbbbbbbbbbb.ogg')).toBeNull();
    expect(await leerAdjunto(deps, a, '../../etc/passwd')).toBeNull();
    // La pagina para imprimir lleva la foto dentro y dice que el audio no se guardo.
    const html = (await exportarHtml(deps, a.id))!;
    expect(html.html).toContain('src="data:image/jpeg;base64,');
    expect(html.html).toContain('adjunto no guardado: no estaba en el servidor');
    // La revision cuenta los adjuntos que faltan.
    expect((await revisarRespaldos(deps)).find((r) => r.id === a.id)).toMatchObject({ ok: true, adjuntosFaltan: 0 });
    await rm(path.join(carpeta, 'aaaaaaaaaaaaaaaaaaaaaaaa.jpg'));
    expect((await revisarRespaldos(deps)).find((r) => r.id === a.id)).toMatchObject({ ok: false, adjuntosFaltan: 1 });
    expect((await revisarRespaldos(deps)).find((r) => r.id === a.id)!.detalle).toMatch(/falta 1 adjunto/);
    // Las estadisticas cuentan las que tienen algo.
    expect((await repos.archives.stats()).conAdjuntos).toBe(1);
    // Papelera + purga: la carpeta se va con el fichero.
    await moverAPapelera(deps, a.id);
    await pool.query('update chat_archives set deleted_at = now(3) - interval 31 day where id = $1', [a.id]);
    expect(await purgarPapelera(deps)).toBe(1);
    expect(existsSync(carpeta)).toBe(false);
    expect(existsSync(rutaDe(dir, a.file))).toBe(false);
  });

  it('sin directorio de medios, los adjuntos quedan anotados como no guardados y el respaldo sale igual', async () => {
    const c = await conversacion('51987000011', 'Pepe', [{ direction: 'in', kind: 'image', body: '(foto)', payload: { media: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa.jpg', mimeType: 'image/jpeg' } } }]);
    const salida = await archivarConversacion({ repos, dir }, c.id, 'manual');
    expect(salida.ok).toBe(true);
    expect(salida.archive!.adjuntos[0]).toMatchObject({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa.jpg', kind: 'image', omitido: 'este arranque no guarda ficheros del chat' });
  });
});

describe('el resumen automatico no pisa el de una persona', () => {
  it('si alguien le puso resumen mientras la IA pensaba, se queda el suyo', async () => {
    const c = await conversacion('51987000050', 'Rosa', [['in', 'hola'], ['out', 'buenas']]);
    const salida = await archivarConversacion({ repos, dir }, c.id, 'manual');
    await esperarResumen(salida.archive!.id);
    await repos.archives.update(salida.archive!.id, { resumen: 'Lo puso Ali.' });
    // Lo que escribe el resumen automatico al terminar, llegue cuando llegue.
    const despues = await repos.archives.ponerResumenSiFalta(salida.archive!.id, 'Rosa escribió 1 mensaje.', ['otro']);
    expect(despues!.resumen).toBe('Lo puso Ali.');
    // Y a una sin resumen si se lo pone.
    await repos.archives.update(salida.archive!.id, { resumen: null });
    expect((await repos.archives.ponerResumenSiFalta(salida.archive!.id, 'Rosa escribió 1 mensaje.', ['otro']))!.resumen).toBe('Rosa escribió 1 mensaje.');
  });
});

describe('exportar', () => {
  it('texto plano con cabecera y una linea por mensaje; pagina imprimible con los globos; CSV con BOM para Excel', async () => {
    const c = await conversacion('51987000003', 'María', [['in', 'hola'], ['out', 'buenas, María']]);
    const deps: ArchiveDeps = { repos, dir, nombreNegocio: () => 'GSG' };
    const salida = await archivarConversacion(deps, c.id, 'manual', 'Ali');
    await repos.archives.update(salida.archive!.id, { notas: 'cliente amable', resumen: 'Saludó.', etiquetas: ['consulta'] });
    const txt = (await exportarTexto(deps, salida.archive!.id))!;
    expect(txt.nombre).toMatch(/^conversacion-51987000003-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(txt.texto).toContain('Conversación con María (+51987000003)');
    expect(txt.texto).toContain('Resumen: Saludó.');
    expect(txt.texto).toContain('Notas: cliente amable');
    expect(txt.texto).toMatch(/\] María: hola/);
    expect(txt.texto).toMatch(/\] GSG: buenas, María/);
    const html = (await exportarHtml(deps, salida.archive!.id))!;
    expect(html.html).toContain('<div class="g cli">');
    expect(html.html).toContain('<div class="g neg">');
    expect(html.html).toContain('Etiquetas:</b> Consulta');
    const csv = await exportarCsv(deps, {});
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Cliente";"Teléfono";"Pedido"');
    expect(csv).toContain('"María";"+51987000003"');
    expect(csv).toContain('"Consulta";"Saludó."');
    expect(await exportarTexto(deps, 9999)).toBeNull();
  });

  it('sin datos personales: telefono tapado, iniciales, y lo personal tapado dentro de los mensajes', async () => {
    expect(taparTelefono('51987000003')).toBe('+51 987 *** 003');
    expect(taparTelefono('34600111222')).toBe('+34600 *** 222');
    expect(iniciales('Ana María Quispe')).toBe('A. M. Q.');
    expect(iniciales(null)).toBeNull();
    const c = await conversacion('51987000003', 'María Flores', [['in', 'mi otro número es 912 345 678 y mi correo maria@correo.pe'], ['out', 'Anotado, María.']]);
    const deps: ArchiveDeps = { repos, dir, nombreNegocio: () => 'GSG' };
    const salida = await archivarConversacion(deps, c.id, 'manual', 'Ali');
    await repos.archives.update(salida.archive!.id, { notas: 'llamar al 987 654 321', resumen: 'Dio otro número.' });
    const txt = (await exportarTexto(deps, salida.archive!.id, { anonimo: true }))!;
    expect(txt.nombre).toMatch(/-sin-datos\.txt$/);
    expect(txt.texto).not.toContain('51987000003');
    expect(txt.texto).not.toContain('María Flores');
    expect(txt.texto).toContain('M. F.');
    expect(txt.texto).toContain('+51 987 *** 003');
    expect(txt.texto).not.toContain('912 345 678');
    expect(txt.texto).toContain('[teléfono]');
    expect(txt.texto).toContain('[correo]');
    expect(txt.texto).not.toContain('987 654 321');
    expect(txt.texto).toContain('Copia sin datos personales.');
    // El nombre tampoco se cuela por dentro de los mensajes ni del resumen.
    expect(txt.texto).toContain('Anotado, M.');
    expect(txt.texto).not.toMatch(/María|Flores/);
    expect(taparNombre('María Flores escribió; la de María', 'María Flores')).toBe('M. F. escribió; la de M.');
    const html = (await exportarHtml(deps, salida.archive!.id, { anonimo: true }))!;
    expect(html.html).not.toContain('51987000003');
    expect(html.html).toContain('M. F.');
    const csv = await exportarCsv(deps, {}, { anonimo: true });
    expect(csv).toContain('"M. F.";"+51 987 *** 003"');
    expect(csv).not.toContain('María Flores');
    expect(csv).not.toContain('987 654 321');
    // Con todo, el normal sigue entero.
    expect(await exportarCsv(deps, {})).toContain('"María Flores";"+51987000003"');
  });
});

describe('la papelera', () => {
  it('a la papelera deja el fichero; sale de la lista; se recupera; y a los 30 dias se borra de verdad', async () => {
    const c = await conversacion('51987000004', 'Jorge', [['in', 'ok']]);
    const deps: ArchiveDeps = { repos, dir };
    const salida = await archivarConversacion(deps, c.id, 'manual');
    const id = salida.archive!.id;
    await moverAPapelera(deps, id);
    expect(await repos.archives.count({})).toBe(0);
    expect(await repos.archives.count({ papelera: true })).toBe(1);
    expect(existsSync(rutaDe(dir, salida.archive!.file))).toBe(true);
    await sacarDePapelera(deps, id);
    expect(await repos.archives.count({})).toBe(1);
    await moverAPapelera(deps, id);
    // Todavia no toca (30 dias).
    expect(await purgarPapelera(deps)).toBe(0);
    await pool.query('update chat_archives set deleted_at = now(3) - interval 31 day where id = $1', [id]);
    expect(await purgarPapelera(deps)).toBe(1);
    expect(await repos.archives.get(id)).toBeNull();
    expect(existsSync(rutaDe(dir, salida.archive!.file))).toBe(false);
    const s = await repos.archives.stats();
    expect(s.total).toBe(0);
    expect(s.enPapelera).toBe(0);
  });

  it('borrar todo lo de un cliente: lo vivo se guarda primero y todo lo suyo va a la papelera', async () => {
    const deps: ArchiveDeps = { repos, dir };
    const c = await conversacion('51987000012', 'Carla', [['in', 'primera conversación']]);
    await archivarConversacion(deps, c.id, 'manual');
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'w-nuevo', kind: 'text', body: 'segunda, aún viva', createdAt: new Date() });
    const otro = await conversacion('51987000013', 'Otro', [['in', 'no me toques']]);
    await archivarConversacion(deps, otro.id, 'manual');

    const r = await borrarTodoDeCliente(deps, c.id, 'Ali');
    expect(r).toMatchObject({ ok: true, guardadas: 1, aPapelera: 2 });
    expect(await repos.archives.count({ contactId: c.id })).toBe(0);
    expect(await repos.archives.count({ contactId: c.id, papelera: true })).toBe(2);
    expect((await repos.messages.summaryByContact(c.id)).count).toBe(0);
    // El otro cliente sigue como estaba; el contacto de Carla tambien existe.
    expect(await repos.archives.count({ contactId: otro.id })).toBe(1);
    expect(await repos.contacts.getById(c.id)).not.toBeNull();
    const enPapelera = await repos.archives.list({ contactId: c.id, papelera: true, limit: 10, offset: 0 });
    expect(enPapelera.some((a) => a.cerradoPor === 'Ali (borrado a petición del cliente)')).toBe(true);
  });
});

describe('estadisticas', () => {
  it('por semana (8 semanas con ceros), tiempo medio hasta la primera respuesta y porcentaje con reclamo', async () => {
    const deps: ArchiveDeps = { repos, dir };
    const a1 = await conversacion('51987000020', 'Uno', [{ direction: 'in', body: 'hola, llegó tarde, un reclamo', enSeg: 0 }, { direction: 'out', body: 'disculpe', enSeg: 90 }]);
    const a2 = await conversacion('51987000021', 'Dos', [{ direction: 'in', body: 'hola', enSeg: 0 }, { direction: 'out', body: 'buenas', enSeg: 30 }]);
    const a3 = await conversacion('51987000022', 'Tres', [{ direction: 'out', body: 'sin respuesta', enSeg: 0 }]);
    const r1 = await archivarConversacion(deps, a1.id, 'manual');
    const r2 = await archivarConversacion(deps, a2.id, 'manual');
    const r3 = await archivarConversacion(deps, a3.id, 'inactividad');
    await new Promise((r) => setTimeout(r, 80));
    expect(r1.archive!.primeraRespuestaSeg).toBe(90);
    expect(r2.archive!.primeraRespuestaSeg).toBe(30);
    expect(r3.archive!.primeraRespuestaSeg).toBeNull();
    const lunes = lunesRecientes(8);
    expect(lunes).toHaveLength(8);
    expect(lunes.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l))).toBe(true);
    // Una de esta semana (ya lo es), una de hace 2 semanas, una de hace 10 (fuera del tramo).
    await pool.query('update chat_archives set created_at = created_at - interval 14 day where id = $1', [r2.archive!.id]);
    await pool.query('update chat_archives set created_at = created_at - interval 70 day where id = $1', [r3.archive!.id]);
    const s = await repos.archives.stats();
    expect(s.porSemana).toHaveLength(8);
    expect(s.porSemana.map((w) => w.semana)).toEqual(lunes);
    expect(s.porSemana[7]!.n).toBe(1);
    expect(s.porSemana[5]!.n).toBe(1);
    expect(s.porSemana.reduce((t, w) => t + w.n, 0)).toBe(2);
    expect(s.primeraRespuestaMedioSeg).toBe(60);
    expect(s.pctReclamo).toBe(33);
    expect(s.porMotivo).toEqual({ manual: 2, inactividad: 1 });
  });
});

describe('aprender de lo guardado', () => {
  it('saca los pares pregunta/respuesta de una persona; lo que contesto la IA no cuenta', async () => {
    const deps: ArchiveDeps = { repos, dir };
    const c = await conversacion('51987000030', 'Nina', [
      ['in', '¿hasta qué hora hacen entregas los sábados?'],
      { direction: 'out', body: 'Hola, soy el asistente. ¿En qué te ayudo?', payload: { origen: 'sistema' } },
      ['out', 'Los sábados entregamos hasta las 6 de la tarde en toda Lima.'],
      ['in', '¿y aceptan pago con Yape al recibir?'],
      { direction: 'out', body: 'Sí, aceptamos Yape y Plin al momento de la entrega.', payload: { origen: 'ia' } },
      ['in', '¿tienen delivery a Callao?'],
      ['out', 'Sí, llegamos a Callao con un costo adicional de 5 soles.'],
    ]);
    const salida = await archivarConversacion(deps, c.id, 'manual');
    const r = (await paresParaAprender(deps, salida.archive!.id))!;
    expect(r.pares).toHaveLength(2);
    expect(r.pares[0]).toMatchObject({ pregunta: '¿hasta qué hora hacen entregas los sábados?', respuesta: 'Los sábados entregamos hasta las 6 de la tarde en toda Lima.' });
    expect(r.pares[1]!.pregunta).toMatch(/Callao/);
    expect(await paresParaAprender(deps, 9999)).toBeNull();
  });
});

describe('enlace de evidencia', () => {
  it('se firma, se verifica, caduca, y no se puede retocar', () => {
    const { token, caducaEn } = crearEnlace(42, 7, 'secreto-de-prueba');
    expect(caducaEn.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    const v = verificarEnlace(token, 'secreto-de-prueba');
    expect(v.ok && v.payload.a).toBe(42);
    expect(verificarEnlace(token, 'otro-secreto')).toEqual({ ok: false, motivo: 'no_valido' });
    expect(verificarEnlace(`${token}x`, 'secreto-de-prueba')).toEqual({ ok: false, motivo: 'no_valido' });
    expect(verificarEnlace('nada', 'secreto-de-prueba')).toEqual({ ok: false, motivo: 'no_valido' });
    // Cambiar el cuerpo (otro id) rompe la firma.
    const [, firma] = token.split('.');
    const otro = `${Buffer.from(JSON.stringify({ a: 43, exp: Math.floor(caducaEn.getTime() / 1000), sinTelefono: true })).toString('base64url')}.${firma}`;
    expect(verificarEnlace(otro, 'secreto-de-prueba')).toEqual({ ok: false, motivo: 'no_valido' });
    // Caducado.
    const viejo = firmarEnlace({ a: 42, exp: Math.floor(Date.now() / 1000) - 10, sinTelefono: true }, 'secreto-de-prueba');
    expect(verificarEnlace(viejo, 'secreto-de-prueba')).toEqual({ ok: false, motivo: 'caducado' });
    // Sin la marca de "sin telefono" no vale, aunque este bien firmado.
    const sinMarca = firmarEnlace({ a: 42, exp: Math.floor(Date.now() / 1000) + 100, sinTelefono: false as unknown as true }, 'secreto-de-prueba');
    expect(verificarEnlace(sinMarca, 'secreto-de-prueba')).toEqual({ ok: false, motivo: 'no_valido' });
  });
});

describe('importar un chat exportado del telefono', () => {
  const ANDROID = [
    'Los mensajes y las llamadas están cifrados de extremo a extremo. Nadie fuera de este chat, ni siquiera WhatsApp, puede leerlos ni escucharlos.',
    '12/03/26, 10:15 - Ana Quispe: hola, ¿a qué hora llega mi pedido?',
    '12/03/26, 10:17 - GSG: Buenos días Ana, sale a las 11',
    'y llega antes de la 1.',
    '12/03/26, 10:18 - Ana Quispe: <Multimedia omitido>',
    '12/03/26, 10:18 - Ana Quispe: esa es la fachada',
    '12/03/26, 12:40 - GSG: Entregado, gracias Ana.',
  ].join('\n');

  it('android: fechas en hora de Lima, direcciones bien, continuacion de linea, multimedia omitido y ruido descartado', () => {
    const r = leerChatDeWhatsApp(ANDROID, { nombreNegocio: 'GSG' });
    expect(r.mensajes).toHaveLength(5);
    expect(r.cliente).toBe('Ana Quispe');
    expect(r.negocio).toBe('GSG');
    expect(r.mensajes[0]).toMatchObject({ direction: 'in', kind: 'text', body: 'hola, ¿a qué hora llega mi pedido?' });
    expect(r.mensajes[0]!.createdAt.toISOString()).toBe('2026-03-12T15:15:00.000Z');
    expect(r.mensajes[1]).toMatchObject({ direction: 'out', body: 'Buenos días Ana, sale a las 11\ny llega antes de la 1.' });
    expect(r.mensajes[2]).toMatchObject({ direction: 'in', kind: 'image', body: null });
    expect(r.mensajes[4]).toMatchObject({ direction: 'out', body: 'Entregado, gracias Ana.' });
    expect(r.desde!.toISOString()).toBe('2026-03-12T15:15:00.000Z');
    expect(r.hasta!.toISOString()).toBe('2026-03-12T17:40:00.000Z');
  });

  it('iphone (con corchetes y segundos) y 12 horas; sin nombre del negocio, el cliente es quien mas escribe', () => {
    const ios = ['[12/03/26, 10:15:22] Ana: hola', '[12/03/26, 10:17:05] Tienda: buenas', '[12/03/26, 10:18:00] Ana: ¿tienen stock?'].join('\n');
    const r = leerChatDeWhatsApp(ios, { nombreCliente: 'Ana' });
    expect(r.mensajes.map((m) => m.direction)).toEqual(['in', 'out', 'in']);
    expect(r.mensajes[1]!.createdAt.toISOString()).toBe('2026-03-12T15:17:05.000Z');
    const doce = ['12/3/26 1:05 p. m. - Ana: hola', '12/3/26 1:06 p. m. - Tienda: buenas', '12/3/26 1:07 p. m. - Ana: ok'].join('\n');
    const r2 = leerChatDeWhatsApp(doce, {});
    expect(r2.cliente).toBe('Ana');
    expect(r2.negocio).toBe('Tienda');
    expect(r2.mensajes[0]!.createdAt.toISOString()).toBe('2026-03-12T18:05:00.000Z');
    expect(leerChatDeWhatsApp('esto no es un chat', {}).mensajes).toHaveLength(0);
  });

  it('queda como una conversacion guardada mas, con origen "importado_txt", que se lee y se busca', async () => {
    const deps: ArchiveDeps = { repos, dir, nombreNegocio: () => 'GSG' };
    const r = await importarChatDeWhatsApp(deps, { texto: ANDROID, telefono: '987 000 040', quien: 'Ali' });
    expect(r.ok).toBe(true);
    expect(r.mensajes).toBe(5);
    const a = r.archive!;
    expect(a.origen).toBe('importado_txt');
    expect(a.phone).toBe('51987000040');
    expect(a.name).toBe('Ana Quispe');
    expect(a.messageCount).toBe(5);
    expect(a.cerradoPor).toBe('Ali (importada del teléfono)');
    // Del primer mensaje del cliente (10:15) a la respuesta (10:17): 120 s.
    expect(a.primeraRespuestaSeg).toBe(120);
    const leido = (await leerRespaldo(deps, a.id))!;
    expect(leido.header.motivo).toBe('importado');
    expect(leido.messages).toHaveLength(5);
    expect(leido.messages[2]!.kind).toBe('image');
    expect((await repos.archives.list({ texto: 'fachada', limit: 5, offset: 0 })).map((x) => x.id)).toEqual([a.id]);
    await esperarResumen(a.id);
    expect((await repos.archives.get(a.id))!.resumen).toMatch(/Ana Quispe escribió 2 mensajes \(5 en total\)/);
    // Sin telefono no hay contacto al que colgarla.
    expect((await importarChatDeWhatsApp(deps, { texto: ANDROID, telefono: '12' })).ok).toBe(false);
    expect((await importarChatDeWhatsApp(deps, { texto: 'nada que leer', telefono: '987000041' })).motivo).toMatch(/Exportar chat/);
  });
});

describe('las rutas de la pantalla', () => {
  const cola: OutboundQueue = { async enqueue() {}, async enqueueMany(j) { return j.length; }, async pause() {}, async resume() {}, async counts() { return {}; }, async close() {} };
  const SECRETO = 'x'.repeat(40);
  const config = loadConfig({ PUBLIC_BASE_URL: 'http://localhost:3000', DATABASE_URL: 'mysql://x/y', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: 'PNID', WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA', WHATSAPP_APP_SECRET: 's', WHATSAPP_VERIFY_TOKEN: 'v', TRACKING_SECRET: SECRETO, BUSINESS_NAME: 'GSG' } as NodeJS.ProcessEnv);

  async function servidor(extra: { entrenamiento?: unknown; sinMedia?: boolean } = {}) {
    const fakes = createFakeRepos();
    const wa = createFakeWhatsApp();
    const settings = await createFakeSettings(config);
    const sender = createSender({ repos: fakes, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 5000, growth: 2, hardCap: 10000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false, soloNumeros: () => [] });
    const dirRutas = await mkdtemp(path.join(tmpdir(), 'gsgchat-rutas-'));
    const entregasFalsas = {
      pedidoDe: async (phone: string) => (phone === '51987000005' ? 'P-2001' : null),
      telefonosTerminadosHoy: async () => [{ phone: '51987000005', referencia: 'P-2001' }, { phone: '51987000006', referencia: 'P-2002' }],
    };
    const app = await buildServer({ config: { ...config, ARCHIVE_DIR: dirRutas }, repos: fakes, settings, wa, sender, queue: cola, logger: false, entregas: entregasFalsas as never, mediaDir: extra.sinMedia ? undefined : mediaDir, entrenamiento: extra.entrenamiento as never });
    await app.ready();
    return { app, fakes, dirRutas, auth: { authorization: `Bearer ${CLAVE_API_PRUEBA}` } };
  }

  it('cerrar de golpe las de los pedidos terminados hoy, listar con filtros, notas, exportar, papelera', async () => {
    const { app, fakes, dirRutas, auth } = await servidor();
    try {
      const ana = await fakes.contacts.upsertFromInbound('51987000005', 'Ana');
      await fakes.messages.add({ contactId: ana.id, direction: 'in', wamid: 'w1', kind: 'text', body: 'llegó tarde, un reclamo', createdAt: new Date() });
      await fakes.contacts.upsertFromInbound('51987000006', 'Sin mensajes');

      const cierre = await app.inject({ method: 'POST', url: '/admin/archives/cerrar', headers: auth, payload: { pedidosDeHoy: true } });
      expect(cierre.statusCode).toBe(200);
      const r = cierre.json() as { guardadas: number; hechas: Array<{ pedido?: string }>; saltadas: Array<{ motivo: string }> };
      expect(r.guardadas).toBe(1);
      expect(r.hechas[0]!.pedido).toBe('P-2001');
      expect(r.saltadas).toHaveLength(1);
      await new Promise((res) => setTimeout(res, 50));

      const lista = await app.inject({ method: 'GET', url: '/admin/archives?texto=reclamo', headers: auth });
      const l = lista.json() as { items: Array<{ id: number; pedido: string; reason: string; etiquetas: string[]; cerradoPor: string }>; total: number; etiquetas: unknown[]; conIA: boolean; conAdjuntos: boolean; conEnlaces: boolean; conEntrenamiento: boolean; stats: { porSemana: unknown[]; pctReclamo: number } };
      expect(l.total).toBe(1);
      expect(l.items[0]).toMatchObject({ pedido: 'P-2001', reason: 'entrega' });
      expect(l.items[0]!.etiquetas).toContain('reclamo');
      expect(l.etiquetas.length).toBeGreaterThan(5);
      expect(l.conIA).toBe(false);
      expect(l.conAdjuntos).toBe(true);
      expect(l.conEnlaces).toBe(true);
      expect(l.conEntrenamiento).toBe(false);
      expect(l.stats.porSemana).toHaveLength(8);
      expect(l.stats.pctReclamo).toBe(100);
      const id = l.items[0]!.id;

      const notas = await app.inject({ method: 'POST', url: `/admin/archives/${id}/notas`, headers: auth, payload: { notas: 'se disculpó el motorizado', etiquetas: ['reclamo', 'motorizado'] } });
      expect(notas.statusCode).toBe(200);
      expect((notas.json() as { archive: { notas: string; etiquetas: string[] } }).archive).toMatchObject({ notas: 'se disculpó el motorizado', etiquetas: ['reclamo', 'motorizado'] });
      expect(((await app.inject({ method: 'GET', url: '/admin/archives?texto=disculp', headers: auth })).json() as { total: number }).total).toBe(1);

      const txt = await app.inject({ method: 'GET', url: `/admin/archives/${id}/export.txt`, headers: auth });
      expect(txt.statusCode).toBe(200);
      expect(txt.headers['content-disposition']).toMatch(/conversacion-51987000005/);
      expect(txt.body).toContain('Pedido: P-2001');
      const anon = await app.inject({ method: 'GET', url: `/admin/archives/${id}/export.txt?anonimo=si`, headers: auth });
      expect(anon.body).not.toContain('51987000005');
      expect(anon.body).toContain('+51 987 *** 005');
      const html = await app.inject({ method: 'GET', url: `/admin/archives/${id}/export.html`, headers: auth });
      expect(html.body).toContain('<div class="g cli">');
      const csv = await app.inject({ method: 'GET', url: '/admin/archives/export.csv?etiqueta=reclamo', headers: auth });
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.body).toContain('"Ana";"+51987000005";"P-2001"');
      const csvAnon = await app.inject({ method: 'GET', url: '/admin/archives/export.csv?anonimo=si', headers: auth });
      expect(csvAnon.body).toContain('"A.";"+51 987 *** 005"');
      expect(csvAnon.headers['content-disposition']).toMatch(/-sin-datos\.csv/);

      const revision = await app.inject({ method: 'GET', url: '/admin/archives/revision', headers: auth });
      expect(revision.json()).toMatchObject({ revisados: 1, rotos: 0, adjuntosFaltan: 0 });

      const papelera = await app.inject({ method: 'DELETE', url: `/admin/archives/${id}`, headers: auth });
      expect(papelera.json()).toMatchObject({ ok: true, definitivo: false });
      expect(((await app.inject({ method: 'GET', url: '/admin/archives', headers: auth })).json() as { total: number }).total).toBe(0);
      expect(((await app.inject({ method: 'GET', url: '/admin/archives?papelera=si', headers: auth })).json() as { total: number }).total).toBe(1);
      // En la papelera no se comparte.
      expect((await app.inject({ method: 'POST', url: `/admin/archives/${id}/enlace`, headers: auth, payload: { dias: 3 } })).statusCode).toBe(409);
      const recuperar = await app.inject({ method: 'POST', url: `/admin/archives/${id}/recuperar`, headers: auth, payload: {} });
      expect(recuperar.statusCode).toBe(200);
      expect(((await app.inject({ method: 'GET', url: '/admin/archives', headers: auth })).json() as { total: number }).total).toBe(1);

      const pagina = await app.inject({ method: 'GET', url: '/guardados', headers: auth });
      expect(pagina.statusCode).toBe(200);
      expect(pagina.body).toContain('Conversaciones guardadas');
      expect(pagina.body).toContain('Compartir como evidencia');
      expect(pagina.body).toContain('Importar un chat exportado del teléfono');
    } finally {
      await app.close();
      await rm(dirRutas, { recursive: true, force: true });
    }
  });

  it('el adjunto se sirve con su tipo; el enlace de evidencia se abre sin sesion, sin el telefono entero y con la foto; roto o caducado, no', async () => {
    const { app, fakes, dirRutas, auth } = await servidor();
    try {
      await writeFile(path.join(mediaDir, 'dddddddddddddddddddddddd.jpg'), JPEG);
      const rosa = await fakes.contacts.upsertFromInbound('51987000007', 'Rosa Paredes');
      await fakes.messages.add({ contactId: rosa.id, direction: 'in', wamid: 'w7a', kind: 'image', body: '(foto)', payload: { media: { id: 'dddddddddddddddddddddddd.jpg', kind: 'image', mimeType: 'image/jpeg' } }, createdAt: new Date() });
      await fakes.messages.add({ contactId: rosa.id, direction: 'out', wamid: 'w7b', kind: 'text', body: 'Gracias Rosa, lo vemos.', createdAt: new Date() });
      const cierre = await app.inject({ method: 'POST', url: `/admin/chat/${rosa.id}/archive`, headers: auth });
      expect(cierre.statusCode).toBe(200);
      const id = (cierre.json() as { archive: { id: number; adjuntos: Array<{ id: string }> } }).archive.id;
      expect((cierre.json() as { archive: { adjuntos: Array<{ id: string; omitido?: string }> } }).archive.adjuntos[0]).toMatchObject({ id: 'dddddddddddddddddddddddd.jpg' });

      const adj = await app.inject({ method: 'GET', url: `/admin/archives/${id}/adjunto/dddddddddddddddddddddddd.jpg`, headers: auth });
      expect(adj.statusCode).toBe(200);
      expect(adj.headers['content-type']).toMatch(/image\/jpeg/);
      expect(adj.rawPayload.equals(JPEG)).toBe(true);
      expect((await app.inject({ method: 'GET', url: `/admin/archives/${id}/adjunto/no-existe.jpg`, headers: auth })).statusCode).toBe(404);
      // Sin sesion, el adjunto privado no se ve.
      expect((await app.inject({ method: 'GET', url: `/admin/archives/${id}/adjunto/dddddddddddddddddddddddd.jpg` })).statusCode).toBe(401);
      // El hilo lo trae y la pagina imprimible lo incrusta.
      const html = await app.inject({ method: 'GET', url: `/admin/archives/${id}/export.html`, headers: auth });
      expect(html.body).toContain('data:image/jpeg;base64,');

      // El enlace de evidencia.
      const enlace = await app.inject({ method: 'POST', url: `/admin/archives/${id}/enlace`, headers: auth, payload: { dias: 3 } });
      expect(enlace.statusCode).toBe(200);
      const e = enlace.json() as { url: string; ruta: string; caducaEn: string; dias: number };
      expect(e.dias).toBe(3);
      expect(e.ruta).toMatch(/^\/guardados\/ver\//);
      expect(e.url).toMatch(/^http:\/\/localhost(:\d+)?\/guardados\/ver\//);
      expect(new Date(e.caducaEn).getTime() - Date.now()).toBeGreaterThan(2.9 * 24 * 60 * 60 * 1000);

      const publica = await app.inject({ method: 'GET', url: e.ruta });
      expect(publica.statusCode).toBe(200);
      expect(publica.headers['content-type']).toMatch(/text\/html/);
      expect(publica.body).toContain('Copia de solo lectura');
      expect(publica.body).toContain('Rosa Paredes');
      expect(publica.body).toContain('+51 987 *** 007');
      expect(publica.body).not.toContain('51987000007');
      expect(publica.body).toContain('Gracias Rosa, lo vemos.');
      expect(publica.body).toContain(`${e.ruta}/adjunto/dddddddddddddddddddddddd.jpg`);
      expect(publica.body).not.toContain('data:image');
      const foto = await app.inject({ method: 'GET', url: `${e.ruta}/adjunto/dddddddddddddddddddddddd.jpg` });
      expect(foto.statusCode).toBe(200);
      expect(foto.headers['content-type']).toMatch(/image\/jpeg/);
      // Las notas internas no salen en la copia publica.
      await app.inject({ method: 'POST', url: `/admin/archives/${id}/notas`, headers: auth, payload: { notas: 'nota interna secreta' } });
      expect((await app.inject({ method: 'GET', url: e.ruta })).body).not.toContain('nota interna secreta');

      // Retocado: no existe. Caducado: 410. En la papelera: 410.
      expect((await app.inject({ method: 'GET', url: `${e.ruta}x` })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/guardados/ver/cualquier-cosa' })).statusCode).toBe(404);
      const caducado = firmarEnlace({ a: id, exp: Math.floor(Date.now() / 1000) - 5, sinTelefono: true }, SECRETO);
      const rc = await app.inject({ method: 'GET', url: `/guardados/ver/${caducado}` });
      expect(rc.statusCode).toBe(410);
      expect(rc.body).toContain('Este enlace caducó');
      await app.inject({ method: 'DELETE', url: `/admin/archives/${id}`, headers: auth });
      expect((await app.inject({ method: 'GET', url: e.ruta })).statusCode).toBe(410);
      expect((await app.inject({ method: 'GET', url: `${e.ruta}/adjunto/dddddddddddddddddddddddd.jpg` })).statusCode).toBe(410);
    } finally {
      await app.close();
      await rm(dirRutas, { recursive: true, force: true });
    }
  });

  it('ensenar a la IA: con entrenamiento, los pares entran pendientes; sin el, 409 en cristiano', async () => {
    const ensenado: Array<{ filas: Array<{ pregunta: string | null; respuesta: string }>; opts: { origen: string; origenDetalle?: string | null; estado?: string } }> = [];
    const entrenamiento = {
      async ensenarVarias(filas: Array<{ pregunta: string | null; respuesta: string }>, opts: { origen: string; origenDetalle?: string | null; estado?: string }) {
        ensenado.push({ filas, opts });
        return { nuevas: filas.length, repetidas: 0, ids: filas.map((_, i) => i + 1) };
      },
      cargadas: () => 0,
      trabajos: () => [],
      cifras: async () => ({}),
      temas: async () => [],
      examenes: async () => [],
    };
    const con = await servidor({ entrenamiento });
    try {
      const nina = await con.fakes.contacts.upsertFromInbound('51987000008', 'Nina');
      const t0 = Date.now();
      await con.fakes.messages.add({ contactId: nina.id, direction: 'in', wamid: 'w8a', kind: 'text', body: '¿hasta qué hora hacen entregas los sábados?', createdAt: new Date(t0) });
      await con.fakes.messages.add({ contactId: nina.id, direction: 'out', wamid: 'w8b', kind: 'text', body: 'Los sábados entregamos hasta las 6 de la tarde.', createdAt: new Date(t0 + 60_000) });
      await con.fakes.messages.add({ contactId: nina.id, direction: 'in', wamid: 'w8c', kind: 'text', body: '¿aceptan Yape?', createdAt: new Date(t0 + 120_000) });
      await con.fakes.messages.add({ contactId: nina.id, direction: 'out', wamid: 'w8d', kind: 'text', body: 'Sí, aceptamos Yape y Plin al recibir.', payload: { origen: 'ia' }, createdAt: new Date(t0 + 180_000) });
      const cierre = await con.app.inject({ method: 'POST', url: `/admin/chat/${nina.id}/archive`, headers: con.auth });
      const id = (cierre.json() as { archive: { id: number } }).archive.id;

      expect(((await con.app.inject({ method: 'GET', url: '/admin/archives', headers: con.auth })).json() as { conEntrenamiento: boolean }).conEntrenamiento).toBe(true);
      const r = await con.app.inject({ method: 'POST', url: `/admin/archives/${id}/aprender`, headers: con.auth, payload: {} });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, pares: 1, nuevas: 1, repetidas: 0 });
      expect(ensenado).toHaveLength(1);
      expect(ensenado[0]!.filas[0]).toMatchObject({ pregunta: '¿hasta qué hora hacen entregas los sábados?', respuesta: 'Los sábados entregamos hasta las 6 de la tarde.' });
      expect(ensenado[0]!.opts).toMatchObject({ origen: 'chat', estado: 'pendiente' });
      expect(ensenado[0]!.opts.origenDetalle).toMatch(/Nina/);

      // Las de este mes, de golpe.
      const mes = await con.app.inject({ method: 'POST', url: '/admin/archives/aprender', headers: con.auth, payload: {} });
      expect(mes.statusCode).toBe(200);
      expect(mes.json()).toMatchObject({ ok: true, conversaciones: 1, pares: 1, nuevas: 1 });
      expect(ensenado).toHaveLength(2);
    } finally {
      await con.app.close();
      await rm(con.dirRutas, { recursive: true, force: true });
    }

    const sin = await servidor();
    try {
      const r = await sin.app.inject({ method: 'POST', url: '/admin/archives/1/aprender', headers: sin.auth, payload: {} });
      expect(r.statusCode).toBe(409);
      expect((r.json() as { error: string }).error).toMatch(/no hay entrenamiento/);
      expect((await sin.app.inject({ method: 'POST', url: '/admin/archives/aprender', headers: sin.auth, payload: {} })).statusCode).toBe(409);
    } finally {
      await sin.app.close();
      await rm(sin.dirRutas, { recursive: true, force: true });
    }
  });

  it('borrar todo lo de un cliente exige BORRAR; importar un chat del telefono lo deja en la lista', async () => {
    const { app, fakes, dirRutas, auth } = await servidor();
    try {
      const carla = await fakes.contacts.upsertFromInbound('51987000009', 'Carla');
      await fakes.messages.add({ contactId: carla.id, direction: 'in', wamid: 'w9a', kind: 'text', body: 'primera', createdAt: new Date() });
      await app.inject({ method: 'POST', url: `/admin/chat/${carla.id}/archive`, headers: auth });
      await fakes.messages.add({ contactId: carla.id, direction: 'in', wamid: 'w9b', kind: 'text', body: 'segunda, viva', createdAt: new Date() });

      const sinConfirmar = await app.inject({ method: 'POST', url: '/admin/archives/borrar-cliente', headers: auth, payload: { contactId: carla.id } });
      expect(sinConfirmar.statusCode).toBe(400);
      expect((sinConfirmar.json() as { error: string }).error).toMatch(/BORRAR/);
      expect((await app.inject({ method: 'POST', url: '/admin/archives/borrar-cliente', headers: auth, payload: { telefono: '912000000', confirmar: 'BORRAR' } })).statusCode).toBe(404);
      const r = await app.inject({ method: 'POST', url: '/admin/archives/borrar-cliente', headers: auth, payload: { telefono: '987 000 009', confirmar: 'BORRAR' } });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, guardadas: 1, aPapelera: 2, papeleraDias: 30 });
      expect(((await app.inject({ method: 'GET', url: `/admin/archives?contactId=${carla.id}`, headers: auth })).json() as { total: number }).total).toBe(0);
      expect(((await app.inject({ method: 'GET', url: `/admin/archives?contactId=${carla.id}&papelera=si`, headers: auth })).json() as { total: number }).total).toBe(2);
      expect((await fakes.messages.summaryByContact(carla.id)).count).toBe(0);

      const texto = ['12/03/26, 10:15 - Ana Quispe: hola, ¿a qué hora llega mi pedido?', '12/03/26, 10:17 - GSG: Buenos días Ana, sale a las 11.'].join('\n');
      const imp = await app.inject({ method: 'POST', url: '/admin/archives/importar', headers: auth, payload: { texto, telefono: '987000050' } });
      expect(imp.statusCode).toBe(200);
      const j = imp.json() as { mensajes: number; archive: { id: number; origen: string; name: string } };
      expect(j.mensajes).toBe(2);
      expect(j.archive).toMatchObject({ origen: 'importado_txt', name: 'Ana Quispe' });
      const hilo = await app.inject({ method: 'GET', url: `/admin/archives/${j.archive.id}`, headers: auth });
      expect((hilo.json() as { messages: unknown[] }).messages).toHaveLength(2);
      const malo = await app.inject({ method: 'POST', url: '/admin/archives/importar', headers: auth, payload: { texto: 'esto no es un chat', telefono: '987000051' } });
      expect(malo.statusCode).toBe(400);
      expect((malo.json() as { error: string }).error).toMatch(/Exportar chat/);
    } finally {
      await app.close();
      await rm(dirRutas, { recursive: true, force: true });
    }
  });
});

/**
 * La pantalla se arma pegando cadenas: un parentesis de mas en el JS no lo
 * ve nadie hasta que el navegador lo abre, y un boton que apunta a un id que
 * ya no existe tampoco. Aqui se comprueban las dos cosas sin navegador.
 */
describe('la pantalla de conversaciones guardadas', () => {
  const html = guardadosPage({ demo: false, nombreNegocio: 'Mi Tienda', conIA: false });

  it('trae lo que la pantalla promete', () => {
    expect(html).toContain('Conversaciones guardadas');
    expect(html).toContain('Compartir como evidencia');
    expect(html).toContain('Importar un chat exportado del teléfono');
    // Leer una guardada tiene que ser tan comodo como leer el chat vivo: se busca dentro.
    expect(html).toContain('Buscar dentro de esta conversación');
  });

  it('su JS es valido y todos los ids que busca existen en la pagina', () => {
    const script = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
    expect(() => new Function(script)).not.toThrow();
    const pedidos = new Set([...script.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]));
    const puestos = new Set([...html.matchAll(/id="([a-z0-9-]+)"/g)].map((m) => m[1]));
    expect(pedidos.size).toBeGreaterThan(20);
    expect([...pedidos].filter((id) => !puestos.has(id))).toEqual([]);
  });

  it('no pinta colores a pelo: el modo oscuro se rompe con ellos', () => {
    // El CSS de la pantalla va el ultimo del <style>: empieza en su primer comentario propio.
    const css = html.slice(html.indexOf('El armazon no viste los formularios'), html.indexOf('</style>'));
    expect(css).toContain('.hilo-buscar');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
