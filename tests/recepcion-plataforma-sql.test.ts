/**
 * La recepción de pedidos con todo de verdad: la plataforma, dos tiendas
 * registradas por /registro, cada una en su base de MySQL/MariaDB (la de
 * pruebas, tests/mysql.ts), la clave creada desde el panel y POST
 * /api/v1/entregas al endpoint global. Era el caso del fallo: 201, ok:true y
 * `id: null`, sin poder saber qué fila se había guardado.
 *
 * Y los candados del primer mensaje con concurrencia real de la base: dos
 * intentos a la vez nunca pasan los dos.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { basesDeLaPlataforma, crearPlataforma, type Plataforma } from '../src/plataforma/plataforma.js';
import { createPool } from '../src/db/pool.js';
import { generarClaveApi, hashClaveApi } from '../src/auth/claves-api.js';
import { crearServidorPlataforma, type ServidorPlataforma } from '../src/plataforma/servidor.js';
import { rellenarBanco } from '../src/db/bases.js';
import { bancoDePrueba, devolverBasesDePrueba, urlConBase } from './mysql.js';

const PREFIJO = 'gsgchat_prueba_recep_';
const BANCO = bancoDePrueba(PREFIJO);
const TIEMPO = 3_600_000;
const GSG = { empresa: { codigo: 'T01', nombre: 'Tienda Prueba' }, metodoPago: 'Contraentrega', montoCobrar: 59.9 };

let raiz: string;
let plataforma: Plataforma;
let servidor: ServidorPlataforma;
let base: string;
let cookieA = '';
let cookieB = '';
let claveA = '';

async function registrar(tienda: string, usuario: string, ip: string): Promise<string> {
  const r = await fetch(`${base}/registro`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ tienda, rubro: 'Servicios', nombre: usuario, celular: '987 654 321', usuario, clave: `${usuario}-2026-segura` }) });
  expect(r.status).toBe(200);
  return r.headers.getSetCookie().map((l) => l.split(';')[0]).join('; ');
}
async function panel(cookie: string, ruta: string, init: { method?: string; body?: unknown } = {}) {
  const r = await fetch(base + ruta, { method: init.method ?? 'GET', headers: { cookie, 'content-type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}
const recibir = (cuerpo: unknown, clave = claveA) =>
  fetch(`${base}/api/v1/entregas`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${clave}` }, body: JSON.stringify(cuerpo) }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));

beforeAll(async () => {
  await devolverBasesDePrueba(BANCO);
  await rellenarBanco({ ...BANCO, reserva: 2 });
  raiz = mkdtempSync(path.join(tmpdir(), 'recepcion-'));
  plataforma = await crearPlataforma({
    raiz,
    publicBaseUrl: 'http://localhost:0',
    proceso: { TIMEZONE: 'America/Lima' },
    extraTiendas: { DEV_SIMULATE_INBOUND: 'true', RAFAGA_MS: '0' },
    base: { url: urlConBase(`${PREFIJO}a`) },
    banco: BANCO,
    principal: null,
    autoConectarLocal: false,
    sembrarPlantillasLocales: true,
    carpetaCopias: path.join(raiz, 'copias'),
    registrosPorHora: 50,
    log: () => undefined,
  });
  await plataforma.arrancar();
  servidor = await crearServidorPlataforma({ plataforma, segura: false });
  await servidor.escuchar(0, '127.0.0.1');
  base = `http://127.0.0.1:${(servidor.server.address() as AddressInfo).port}`;
  cookieA = await registrar('Courier Uno', 'courieruno', '10.0.0.1');
  cookieB = await registrar('Courier Dos', 'courierdos', '10.0.0.2');
  const clave = await panel(cookieA, '/admin/claves-api', { method: 'POST', body: { nombre: 'GSG Courier', permisos: ['entregas:gestionar', 'entregas:leer'] } });
  expect(clave.status).toBe(200);
  claveA = clave.json.clave;
  expect((await panel(cookieA, '/admin/entregas/ajustes', { method: 'POST', body: { confirmarListaGsg: true } })).status).toBe(200);
}, TIEMPO);

afterAll(async () => {
  await servidor?.cerrar();
  await plataforma?.parar();
  if (raiz) rmSync(raiz, { recursive: true, force: true });
  await devolverBasesDePrueba(BANCO);
}, TIEMPO);

describe('recepción contra la base de verdad', () => {
  it('una tienda suspendida devuelve 403 para su clave vigente y 401 para una desconocida o revocada', async () => {
    const tienda = (await plataforma.tiendaPorSlug('courier-uno'))!;
    const revocada = generarClaveApi();
    const registro = await tienda.repos.claves.crear({ nombre: 'Prueba revocada', prefijo: revocada.slice(0, 12), hash: hashClaveApi(revocada), creadaPor: null, permisos: ['entregas:gestionar'] });
    await tienda.repos.claves.revocar(registro.id);
    const url = urlConBase(`${PREFIJO}a`);
    const directorio = createPool(url, basesDeLaPlataforma(url).directorio);
    try {
      await directorio.query("update pl_tiendas set estado = 'suspendida' where slug = ?", ['courier-uno']);
      expect(await plataforma.tiendaPorSlug('courier-uno')).toBeNull();
      const vigente = await recibir({}, claveA);
      expect(vigente.status).toBe(403);
      expect(vigente.json.codigo).toBe('TIENDA_SUSPENDIDA');
      const desconocida = await recibir({}, generarClaveApi());
      expect(desconocida.status).toBe(401);
      expect(desconocida.json.codigo).toBe('CLAVE_INVALIDA');
      const eliminada = await recibir({}, revocada);
      expect(eliminada.status).toBe(401);
      expect(eliminada.json.codigo).toBe('CLAVE_REVOCADA');
    } finally {
      await directorio.query("update pl_tiendas set estado = 'activa' where slug = ?", ['courier-uno']);
      await directorio.end();
    }
  }, TIEMPO);
  it('201 con el id de la fila guardada, y el pedido sale en Hoy de SU tienda (no en la otra)', async () => {
    const r = await recibir({ ...GSG, tracking: 'SQL-1', cliente: 'Ana Prueba', telefono: '987111222', direccion: 'Av. Siempre Viva 123', distrito: 'Miraflores', id: 'luis-1' });
    expect(r.status).toBe(201);
    const creada = r.json.creadas[0];
    expect(creada.id).toEqual(expect.any(Number));
    expect(creada.idExterno).toBe('luis-1');
    // Retenido: la tienda confirma el envío a mano (ajuste por defecto), así que no sale nada todavía.
    expect(creada.mensaje.estado).toBe('retenido');
    const tiendaA = (await plataforma.tiendaPorSlug('courier-uno'))!;
    const { rows } = await tiendaA.pool.query<{ id: number; referencia: string; mensaje_estado: string; externo_id: string }>('select id, referencia, mensaje_estado, externo_id from entregas where referencia = ?', ['SQL-1']);
    expect(rows).toEqual([{ id: creada.id, referencia: 'SQL-1', mensaje_estado: 'retenido', externo_id: 'luis-1' }]);
    const hoyA = await panel(cookieA, '/admin/entregas');
    expect(hoyA.json.entregas.map((e: { id: number; referencia: string }) => [e.id, e.referencia])).toContainEqual([creada.id, 'SQL-1']);
    const hoyB = await panel(cookieB, '/admin/entregas');
    expect(hoyB.status).toBe(200);
    expect(hoyB.json.entregas.map((e: { referencia: string }) => e.referencia)).not.toContain('SQL-1');
  }, TIEMPO);

  it('el mismo pedido diez veces a la vez: una sola fila', async () => {
    const r = await Promise.all(Array.from({ length: 10 }, () => recibir({ ...GSG, tracking: 'SQL-2', cliente: 'Doble', telefono: '987111333' })));
    expect(r.filter((x) => x.status === 201)).toHaveLength(1);
    expect(r.filter((x) => x.status === 200)).toHaveLength(9);
    const tiendaA = (await plataforma.tiendaPorSlug('courier-uno'))!;
    const { rows } = await tiendaA.pool.query<{ n: number }>('select count(*) as n from entregas where referencia = ?', ['SQL-2']);
    expect(Number(rows[0]!.n)).toBe(1);
  }, TIEMPO);

  it('los candados del mensaje con la base de verdad: diez intentos a la vez, uno pasa; dos «Confirmar y enviar» a la vez, uno libera', async () => {
    const tiendaA = (await plataforma.tiendaPorSlug('courier-uno'))!;
    const repo = tiendaA.repos.entregas;
    const alta = await recibir({ ...GSG, tracking: 'SQL-3', cliente: 'Candado', telefono: '987111444' });
    const id = alta.json.creadas[0].id as number;
    const liberadas = await Promise.all([repo.liberarRetenida(id, new Date()), repo.liberarRetenida(id, new Date())]);
    expect(liberadas.filter(Boolean)).toHaveLength(1);
    await repo.cambiarMensaje(id, ['retenido'], { mensajeEstado: 'fallido', mensajeErrorCodigo: 'numero_invalido' });
    const intentos = await Promise.all(Array.from({ length: 10 }, () => repo.cambiarMensaje(id, ['fallido', 'incierto'], { mensajeEstado: 'pendiente' })));
    expect(intentos.filter(Boolean)).toHaveLength(1);
    expect((await repo.entrega(id))!.mensajeEstado).toBe('pendiente');
    // Y la bandeja lo encuentra mientras tenga su error.
    expect((await repo.bandejaMensajes(50)).map((e) => e.id)).toContain(id);
  }, TIEMPO);

  it('la bandeja y el reintento por la web: con la sesión de la tienda, y nada de la otra', async () => {
    const deA = await panel(cookieA, '/admin/entregas/mensajes/errores');
    expect(deA.status).toBe(200);
    const deB = await panel(cookieB, '/admin/entregas/mensajes/errores');
    expect(deB.status).toBe(200);
    expect(deB.json.items).toEqual([]);
    const id = deA.json.items[0]?.id as number;
    const desdeB = await panel(cookieB, `/admin/entregas/${id}/mensaje/reintentar`, { method: 'POST', body: {} });
    expect(desdeB.status).toBe(404);
    expect(desdeB.json.codigo).toBe('NO_EXISTE');
    // Con la tienda pero sin sesión: 401.
    expect((await panel('gsg_tienda=courier-uno', `/admin/entregas/${id}/mensaje/reintentar`, { method: 'POST', body: {} })).status).toBe(401);
  }, TIEMPO);
});
