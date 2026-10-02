import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
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
    ...(clave ? { authorization: 'Bearer ' + clave } : {}), cookie: 'gsg_tienda=tienda-b', referer: base + '/tienda/tienda-b/conexion-gsg' },
    body: JSON.stringify({ tracking, telefono: '987654321', tienda: 'tienda-b' }) });
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
  it('ausente, desconocida, revocada y sin permiso devuelven el mismo 404', async () => {
    for (const clave of [undefined, generarClaveApi(), revocada, soloLeer]) {
      const r = await enviar(clave);
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: 'No tiene permiso' });
    }
  });
  it('el endpoint con nombre de tienda se rechaza incluso con una clave válida', async () => {
    for (const slug of ['tienda-a', 'tienda-b', 'no-existe']) {
      const r = await enviar(claveA, '/tienda/' + slug + '/api/v1/entregas');
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: 'No tiene permiso' });
    }
  });
  it('una tienda suspendida o una clave asignada a dos tiendas no recibe pedidos', async () => {
    tiendas[0]!.estado = 'suspendida';
    expect((await enviar(claveA)).status).toBe(404);
    tiendas[0]!.estado = 'activa';
    const copiada = await b.repos.claves.crear({ nombre: 'Copia ambigua', hash: hashClaveApi(claveA), prefijo: prefijoDeClave(claveA), creadaPor: null, permisos: ['entregas:gestionar'] });
    expect((await enviar(claveA, '/api/v1/entregas', 'AMBIGUO')).status).toBe(404);
    expect(await a.entrega('AMBIGUO')).toBeFalsy(); expect(await b.entrega('AMBIGUO')).toBeFalsy();
    await b.repos.claves.revocar(copiada.id);
  });
  it('OpenAPI anuncia el endpoint de recepcion sin slug', () => {
    const doc = openApi('https://gsgchat.example/tienda/tienda-a') as any;
    expect(doc.paths['/entregas'].post.servers).toEqual([{ url: 'https://gsgchat.example/api/v1' }]);
    expect(doc.paths['/entregas'].post.responses['404']).toBeTruthy();
  });
});
