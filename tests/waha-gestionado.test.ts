/**
 * El WAHA que levanta el propio sistema.
 *
 * El fallo que lo origino: pulsar "Conectar con WAHA" sin contenedor daba
 * "Falta la direccion del contenedor de WAHA" y ahi se acababa el camino. Y
 * aunque alguien lo arrancara a mano, WAHA exige clave desde 2025 y el
 * detector, que llamaba sin clave, no lo veia nunca.
 */

import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { registerWahaRoutes } from '../src/web/waha-routes.js';
import {
  CONTENEDOR_WAHA,
  crearWahaGestionado,
  esLocal,
  vistaDesdeContenedor,
  type EstadoWaha,
  type WahaGestionado,
} from '../src/whatsapp/waha/gestionado.js';
import { detectWaha, sondearWaha } from '../src/whatsapp/waha/session.js';
import { createFakeRepos, createFakeSettings } from './fakes.js';

const NO_AUTORIZADO = () =>
  new Response(JSON.stringify({ message: 'Unauthorized', statusCode: 401 }), { status: 401 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reconocer un WAHA que pide clave', () => {
  it('el 401 de WAHA se distingue de un puerto cualquiera', async () => {
    const impl = vi.fn(async () => NO_AUTORIZADO()) as unknown as typeof fetch;
    expect(await sondearWaha('http://localhost:3001', undefined, impl)).toBe('clave');
  });

  it('un 401 que no es de WAHA no cuenta', async () => {
    const impl = vi.fn(
      async () => new Response(JSON.stringify({ error: 'Inicia sesión' }), { status: 401 }),
    ) as unknown as typeof fetch;
    expect(await sondearWaha('http://localhost:3000', undefined, impl)).toBe('nada');
  });

  it('con la clave, el detector entra y lo encuentra', async () => {
    const cabeceras: Array<Record<string, string>> = [];
    const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      cabeceras.push(h);
      return h['X-Api-Key'] === 'secreta' ? new Response('[]', { status: 200 }) : NO_AUTORIZADO();
    }) as unknown as typeof fetch;

    expect(await detectWaha(['http://localhost:3001'], impl)).toBeNull();
    expect(await detectWaha(['http://localhost:3001'], impl, 1200, 'secreta')).toBe('http://localhost:3001');
    expect(cabeceras.at(-1)).toEqual({ 'X-Api-Key': 'secreta' });
  });
});

describe('levantar el contenedor', () => {
  function docker(estado: { existe: boolean; corriendo: boolean; clave?: string; sinDocker?: boolean }) {
    const llamadas: string[][] = [];
    const ejecutar = vi.fn(async (_programa: string, args: string[]) => {
      llamadas.push(args);
      if (estado.sinDocker) throw new Error('docker: command not found');
      if (args[0] === 'version') return '29.0.0';
      if (args[0] === 'inspect') {
        if (!estado.existe) throw new Error('No such object: gsgchat-waha');
        return JSON.stringify({
          State: { Running: estado.corriendo },
          Config: { Env: ['PATH=/usr/bin', `WAHA_API_KEY=${estado.clave ?? ''}`] },
        });
      }
      if (args[0] === 'run') {
        estado.existe = true;
        estado.corriendo = true;
        estado.clave = args.find((a) => a.startsWith('WAHA_API_KEY='))!.slice('WAHA_API_KEY='.length);
      }
      if (args[0] === 'start') estado.corriendo = true;
      return '';
    });
    // WAHA contesta solo cuando el contenedor corre y le llega su clave.
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (!estado.corriendo) throw new Error('ECONNREFUSED');
      const h = (init?.headers ?? {}) as Record<string, string>;
      return h['X-Api-Key'] === estado.clave ? new Response('[]', { status: 200 }) : NO_AUTORIZADO();
    }) as unknown as typeof fetch;
    return { llamadas, ejecutar, fetchImpl };
  }

  async function hastaQueTermine(waha: WahaGestionado): Promise<EstadoWaha> {
    for (let i = 0; i < 50; i++) {
      const e = await waha.asegurar();
      if (e.fase !== 'descargando' && e.fase !== 'arrancando') return e;
    }
    throw new Error('no termino');
  }

  it('sin contenedor: descarga la imagen, lo crea con clave propia y queda listo', async () => {
    const d = docker({ existe: false, corriendo: false });
    const waha = crearWahaGestionado({ puerto: 3001, ejecutar: d.ejecutar, fetchImpl: d.fetchImpl, pausaMs: 1 });

    const final = await hastaQueTermine(waha);

    expect(final.fase).toBe('listo');
    expect(final.url).toBe('http://127.0.0.1:3001');
    expect(final.apiKey.length).toBeGreaterThan(20);
    expect(d.llamadas.map((a) => a[0])).toEqual(['version', 'inspect', 'pull', 'run']);
    const run = d.llamadas.find((a) => a[0] === 'run')!;
    expect(run).toContain(CONTENEDOR_WAHA);
    // Solo desde esta maquina y con el volumen de sesiones.
    expect(run).toContain('127.0.0.1:3001:3000');
    expect(run).toContain('gsgchat-waha-sesiones:/app/.sessions');
    expect(run).toContain('host.docker.internal:host-gateway');
  });

  it('contenedor parado: lo arranca y reutiliza su clave, sin crear otro', async () => {
    const d = docker({ existe: true, corriendo: false, clave: 'la-de-siempre' });
    const waha = crearWahaGestionado({ puerto: 3001, ejecutar: d.ejecutar, fetchImpl: d.fetchImpl, pausaMs: 1 });

    const final = await hastaQueTermine(waha);

    expect(final).toMatchObject({ fase: 'listo', apiKey: 'la-de-siempre' });
    expect(d.llamadas.map((a) => a[0])).not.toContain('run');
    expect(d.llamadas).toContainEqual(['start', CONTENEDOR_WAHA]);
  });

  it('sin Docker lo dice claro, con donde conseguirlo', async () => {
    const d = docker({ existe: false, corriendo: false, sinDocker: true });
    const waha = crearWahaGestionado({ puerto: 3001, ejecutar: d.ejecutar, fetchImpl: d.fetchImpl });

    const final = await hastaQueTermine(waha);

    expect(final.fase).toBe('sin-docker');
    expect(final.detalle).toMatch(/Docker Desktop/);
  });

  it('la clave se lee del contenedor aunque la base se haya borrado', async () => {
    const d = docker({ existe: true, corriendo: true, clave: 'guardada-en-docker' });
    const waha = crearWahaGestionado({ puerto: 3001, ejecutar: d.ejecutar, fetchImpl: d.fetchImpl });
    expect(await waha.claveExistente()).toBe('guardada-en-docker');
  });
});

describe('los mensajes tienen que poder volver', () => {
  it('localhost se ve desde el contenedor como host.docker.internal', () => {
    expect(vistaDesdeContenedor('http://localhost:3300')).toBe('http://host.docker.internal:3300');
    expect(vistaDesdeContenedor('http://127.0.0.1:3300/')).toBe('http://host.docker.internal:3300');
    expect(vistaDesdeContenedor('https://gsgchat.midominio.com')).toBe('https://gsgchat.midominio.com');
  });

  it('sabe que direcciones son de esta maquina', () => {
    expect(esLocal('http://127.0.0.1:3001')).toBe(true);
    expect(esLocal('http://waha:3000')).toBe(false);
  });
});

describe('conectar sin haber escrito ninguna direccion', () => {
  async function montar(estado: EstadoWaha) {
    const config = loadConfig({
      PUBLIC_BASE_URL: 'http://localhost:3300',
      DATABASE_URL: 'mysql://x/y',
      WHATSAPP_PROVIDER: 'waha',
      TRACKING_SECRET: 'x'.repeat(40),
    } as NodeJS.ProcessEnv);
    const settings = await createFakeSettings(config);
    const wahaGestionado: WahaGestionado = {
      asegurar: vi.fn(async () => estado),
      estado: () => estado,
      claveExistente: vi.fn(async () => estado.apiKey),
    };
    const app = Fastify();
    await registerWahaRoutes(app, { config, settings, repos: createFakeRepos(), wahaGestionado });
    await app.ready();
    return { app, settings };
  }

  it('mientras se descarga contesta 202 para que la pantalla espere', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const { app } = await montar({ fase: 'descargando', url: '', apiKey: '', detalle: 'Descargando WAHA…' });

    const r = await app.inject({ method: 'POST', url: '/admin/waha/connect', payload: {} });

    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ preparando: true, detalle: 'Descargando WAHA…' });
    await app.close();
  });

  it('sin Docker da el motivo en vez de pedir una direccion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const { app } = await montar({ fase: 'sin-docker', url: '', apiKey: '', detalle: 'Instala Docker Desktop' });

    const r = await app.inject({ method: 'POST', url: '/admin/waha/connect', payload: {} });

    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('Instala Docker Desktop');
    await app.close();
  });

  it('con el contenedor listo guarda direccion y clave, y el webhook apunta a host.docker.internal', async () => {
    const creadas: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (!href.startsWith('http://127.0.0.1:3001')) throw new Error('ECONNREFUSED');
        const h = (init?.headers ?? {}) as Record<string, string>;
        if (h['X-Api-Key'] !== 'clave-del-contenedor') return NO_AUTORIZADO();
        if (href.endsWith('/api/sessions') && init?.method === 'POST') {
          creadas.push(String(init.body));
          return new Response(JSON.stringify({ name: 'default', status: 'STARTING' }), { status: 201 });
        }
        if (href.endsWith('/api/sessions/default')) return new Response('{}', { status: 404 });
        return new Response('[]', { status: 200 });
      }),
    );
    const { app, settings } = await montar({
      fase: 'listo',
      url: 'http://127.0.0.1:3001',
      apiKey: 'clave-del-contenedor',
      detalle: '',
    });

    const r = await app.inject({ method: 'POST', url: '/admin/waha/connect', payload: {} });

    expect(r.statusCode).toBe(200);
    expect(r.json().webhookUrl).toBe('http://host.docker.internal:3300/webhooks/waha');
    expect(settings.current()).toMatchObject({ wahaUrl: 'http://127.0.0.1:3001', wahaApiKey: 'clave-del-contenedor' });
    expect(creadas[0]).toContain('host.docker.internal:3300');
    await app.close();
  });
});
