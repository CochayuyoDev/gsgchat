import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import { crearServidorPlataforma, type ServidorPlataforma } from '../src/plataforma/servidor.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import type { Plataforma } from '../src/plataforma/plataforma.js';
import type { Directorio, TiendaRegistrada } from '../src/plataforma/directorio.js';
import type { TiendaViva } from '../src/plataforma/tienda.js';
import { openApi } from '../src/api/v1/openapi.js';

let a: EscenarioEntregas, b: EscenarioEntregas, servidor: ServidorPlataforma, base: string;
let claveA: string, claveB: string, soloLeer: string, revocada: string;
let tiendas: TiendaRegistrada[];
const nueva = async (esc: EscenarioEntregas, permisos: string[]) => {
  const clave = generarClaveApi();
  const registro = await esc.repos.claves.crear({ nombre: 'GSG Courier', hash: hashClaveApi(clave), prefijo: prefijoDeClave(clave), creadaPor: null, permisos });
  return { clave, registro };
};
beforeAll(async () => {
  a = await crearEscenarioEntregas({ confirmarLista: true });
  b = await crearEscenarioEntregas({ confirmarLista: true });
  claveA = (await nueva(a, ['entregas:gestionar'])).clave;
  claveB = (await nueva(b, ['entregas:gestionar'])).clave;
  soloLeer = (await nueva(a, ['entregas:leer'])).clave;
  const rev = await nueva(a, ['entregas:gestionar']); revocada = rev.clave;
  await a.repos.claves.revocar(rev.registro.id);
  tiendas = ['tienda-a', 'tienda-b'].map(slug => ({ id: slug, slug, nombre: slug, estado: 'activa', principal: false, rubro: null, creadaAt: new Date() }));
  const vivas = new Map(tiendas.map((t, i) => [t.slug, { id: t.id, slug: t.slug, app: (i ? b : a).app, repos: (i ? b : a).repos, contexto: { id: t.id, slug: t.slug } } as unknown as TiendaViva]));
  const plataforma = { directorio: { tiendas: async () => tiendas } as Directorio,
    tiendaPorSlug: async (slug: string) => vivas.get(slug) ?? null,
    tiendaPrincipal: async () => vivas.get('tienda-b')!,
  } as Plataforma;
  servidor = await crearServidorPlataforma({ plataforma, segura: false });
  await servidor.escuchar(0, '127.0.0.1');
  base = 'http://127.0.0.1:' + (servidor.server.address() as AddressInfo).port;
});
afterAll(async () => { await servidor.cerrar(); await a.cerrar(); await b.cerrar(); });

function enviar(clave?: string, ruta = '/api/v1/entregas', tracking = 'GLOBAL-1') {
  return fetch(base + ruta, { method: 'POST', headers: { 'content-type': 'application/json',
    ...(clave ? { 'x-api-key': clave } : {}), cookie: 'gsg_tienda=tienda-b', referer: base + '/tienda/tienda-b/conexion-gsg' },
    body: JSON.stringify({ ...OBLIGATORIOS_GSG, tracking, cliente: 'Cliente Global', telefono: '987654321', tienda: 'tienda-b' }) });
}
describe('recepcion global aislada por clave', () => {
  it('la clave decide el destino, ignorando cookie, Referer y tienda del cuerpo', async () => {
    const r = await enviar(claveA);
    expect(r.status).toBe(201);
    expect(await a.entrega('GLOBAL-1')).toBeTruthy();
    expect(await b.entrega('GLOBAL-1')).toBeFalsy();
    expect((await enviar(claveB, '/api/v1/entregas', 'GLOBAL-B')).status).toBe(201);
    expect(await b.entrega('GLOBAL-B')).toBeTruthy();
    expect(await a.entrega('GLOBAL-B')).toBeFalsy();
    expect(a.wa.sent).toHaveLength(0); expect(b.wa.sent).toHaveLength(0);
  });
  it('responde el id real del pedido guardado en la tienda de la clave', async () => {
    const r = await enviar(claveA, '/api/v1/entregas', 'GLOBAL-ID');
    expect(r.status).toBe(201);
    const body = await r.json() as { ok: boolean; creadas: Array<{ id: number; referencia: string }> };
    const guardada = await a.entrega('GLOBAL-ID');
    expect(body.ok).toBe(true);
    expect(body.creadas[0]).toMatchObject({ referencia: 'GLOBAL-ID', id: guardada!.id });
    expect(typeof body.creadas[0]!.id).toBe('number');
  });
  it('ausente, desconocida y revocada dan 401 con su codigo; sin permiso, 403', async () => {
    const casos: Array<[string | undefined, number, string]> = [
      [undefined, 401, 'CLAVE_AUSENTE'],
      [generarClaveApi(), 401, 'CLAVE_INVALIDA'],
      ['no-es-una-clave', 401, 'CLAVE_INVALIDA'],
      [revocada, 401, 'CLAVE_REVOCADA'],
      [soloLeer, 403, 'SIN_PERMISO'],
    ];
    for (const [clave, status, codigo] of casos) {
      const r = await enviar(clave);
      expect(r.status).toBe(status);
      if (status === 401) expect(r.headers.get('www-authenticate')).toMatch(/^ApiKey .*X-API-Key/);
      const cuerpo = await r.json() as Record<string, unknown>;
      expect(cuerpo).toMatchObject({ ok: false, codigo });
      expect(typeof cuerpo.error).toBe('string');
    }
    expect(await a.entrega('GLOBAL-1')).toBeTruthy();
  });
  it('el endpoint con nombre de tienda no existe (404) incluso con una clave válida', async () => {
    for (const slug of ['tienda-a', 'tienda-b', 'no-existe']) {
      const r = await enviar(claveA, '/tienda/' + slug + '/api/v1/entregas');
      expect(r.status).toBe(404);
      expect(await r.json()).toMatchObject({ ok: false, codigo: 'RUTA_NO_EXISTE' });
    }
  });
  it('una tienda suspendida o una clave asignada a dos tiendas no recibe pedidos', async () => {
    tiendas[0]!.estado = 'suspendida';
    const suspendida = await enviar(claveA);
    expect(suspendida.status).toBe(403);
    expect(await suspendida.json()).toMatchObject({ ok: false, codigo: 'TIENDA_SUSPENDIDA' });
    tiendas[0]!.estado = 'activa';
    const copiada = await b.repos.claves.crear({ nombre: 'Copia ambigua', hash: hashClaveApi(claveA), prefijo: prefijoDeClave(claveA), creadaPor: null, permisos: ['entregas:gestionar'] });
    const ambigua = await enviar(claveA, '/api/v1/entregas', 'AMBIGUO');
    expect(ambigua.status).toBe(409);
    expect(await ambigua.json()).toMatchObject({ ok: false, codigo: 'CLAVE_AMBIGUA' });
    expect(await a.entrega('AMBIGUO')).toBeFalsy(); expect(await b.entrega('AMBIGUO')).toBeFalsy();
    await b.repos.claves.revocar(copiada.id);
  });
  it('consultar desde Postman con X-API-Key también usa la tienda de la clave, sin cookies', async () => {
    const clave = (await nueva(a, ['entregas:gestionar', 'entregas:leer'])).clave;
    expect((await enviar(clave, '/api/v1/entregas', 'POSTMAN-CONSULTA')).status).toBe(201);
    const lista = await fetch(base + '/api/v1/entregas', { headers: { 'x-api-key': clave, cookie: 'gsg_tienda=tienda-b' } });
    expect(lista.status).toBe(200);
    expect((await lista.json() as any).entregas.some((e: any) => e.referencia === 'POSTMAN-CONSULTA')).toBe(true);
    const detalle = await fetch(base + '/api/v1/entregas/POSTMAN-CONSULTA', { headers: { 'x-api-key': clave } });
    expect(detalle.status).toBe(200);
    expect((await detalle.json() as any).entrega.referencia).toBe('POSTMAN-CONSULTA');
    const ajena = await fetch(base + '/api/v1/entregas/POSTMAN-CONSULTA', { headers: { 'x-api-key': soloLeer } });
    expect(ajena.status).toBe(200);
    const sinLectura = await fetch(base + '/api/v1/entregas', { headers: { 'x-api-key': claveB } });
    expect(sinLectura.status).toBe(403);
  });
  it('acepta la clave como API key (X-API-Key)', async () => {
    const r = await fetch(base + '/api/v1/entregas', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': claveA, cookie: 'gsg_tienda=tienda-b' },
      body: JSON.stringify({ ...OBLIGATORIOS_GSG, tracking: 'APIKEY-1', cliente: 'Cliente API key', telefono: '987654321' }) });
    expect(r.status).toBe(201);
    expect(await a.entrega('APIKEY-1')).toBeTruthy();
    expect(await b.entrega('APIKEY-1')).toBeFalsy();
    const lista = await fetch(base + '/api/v1/entregas', { headers: { 'x-api-key': soloLeer } });
    expect(lista.status).toBe(200);
    const mala = await fetch(base + '/api/v1/entregas', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'wak_no_existe' }, body: '{}' });
    expect(mala.status).toBe(401);
  });
  it('una clave válida en Authorization: Bearer (sin X-API-Key) da 401 CLAVE_AUSENTE y no guarda nada', async () => {
    const cuerpo = JSON.stringify({ ...OBLIGATORIOS_GSG, tracking: 'BEARER-1', cliente: 'Cliente Bearer', telefono: '987654321' });
    const r = await fetch(base + '/api/v1/entregas', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${claveA}` }, body: cuerpo });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toMatch(/^ApiKey .*X-API-Key/);
    expect(r.headers.get('www-authenticate')).not.toMatch(/Bearer/);
    const json = await r.json() as Record<string, unknown>;
    expect(json).toMatchObject({ ok: false, codigo: 'CLAVE_AUSENTE' });
    expect(String(json.error)).toContain('X-API-Key');
    expect(JSON.stringify(json)).not.toContain(claveA);
    expect(await a.entrega('BEARER-1')).toBeFalsy();
    expect(await b.entrega('BEARER-1')).toBeFalsy();
    // Tambien al consultar.
    const lista = await fetch(base + '/api/v1/entregas', { headers: { authorization: `Bearer ${soloLeer}` } });
    expect(lista.status).toBe(401);
    expect(await lista.json()).toMatchObject({ codigo: 'CLAVE_AUSENTE' });
  });
  it('con las dos cabeceras vale solo X-API-Key: el Bearer se ignora', async () => {
    const cuerpo = (tracking: string) => JSON.stringify({ ...OBLIGATORIOS_GSG, tracking, cliente: 'Cliente Doble', telefono: '987654321' });
    // X-API-Key buena y Bearer de otra tienda: entra en la tienda de X-API-Key.
    const r = await fetch(base + '/api/v1/entregas', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': claveA, authorization: `Bearer ${claveB}` }, body: cuerpo('DOBLE-1') });
    expect(r.status).toBe(201);
    expect(await a.entrega('DOBLE-1')).toBeTruthy();
    expect(await b.entrega('DOBLE-1')).toBeFalsy();
    // X-API-Key sin permiso y Bearer con permiso: manda X-API-Key (403), no cae en el Bearer.
    const sinPermiso = await fetch(base + '/api/v1/entregas', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': soloLeer, authorization: `Bearer ${claveA}` }, body: cuerpo('DOBLE-2') });
    expect(sinPermiso.status).toBe(403);
    expect(await a.entrega('DOBLE-2')).toBeFalsy();
    // X-API-Key mala y Bearer bueno: 401 por la X-API-Key.
    const mala = await fetch(base + '/api/v1/entregas', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': generarClaveApi(), authorization: `Bearer ${claveA}` }, body: cuerpo('DOBLE-3') });
    expect(mala.status).toBe(401);
    expect(await mala.json()).toMatchObject({ codigo: 'CLAVE_INVALIDA' });
    expect(await a.entrega('DOBLE-3')).toBeFalsy();
  });
  it('OpenAPI anuncia solo X-API-Key para las claves (sin esquema bearer)', () => {
    const doc = openApi('https://gsgchat.example') as any;
    const esquemas = doc.components.securitySchemes as Record<string, any>;
    expect(Object.values(esquemas).some((e) => e.scheme === 'bearer')).toBe(false);
    expect(esquemas.claveApi).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-API-Key' });
    expect(doc.paths['/entregas'].post.security).toEqual([{ claveApi: [] }]);
  });
  it('OpenAPI anuncia el endpoint de recepcion sin slug', () => {
    const doc = openApi('https://gsgchat.example/tienda/tienda-a') as any;
    expect(doc.paths['/entregas'].post.servers).toEqual([{ url: 'https://gsgchat.example/api/v1' }]);
    expect(doc.paths['/entregas'].post.responses['404']).toBeTruthy();
  });
});
