/**
 * Los procesos en una tienda entera (armarTienda, PGlite real con la
 * migracion 040, SQL real, motores reales) y el Modulo desarrollador
 * simulando una corrida de cada plantilla con numeros de prueba: los cinco
 * casos (bien, primero mal, sin respuesta, consulta ajena, «¿para qué?")
 * terminan donde deben. Ademas: la API publica con su permiso, y que el menu
 * enseña las pantallas de GSG solo con su plantilla activa.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { armarTienda, type TiendaViva } from '../src/plataforma/tienda.js';
import { bootstrapSecrets } from '../src/settings/crypto.js';
import { createFakeWhatsApp } from './fakes.js';

describe('procesos en una tienda (PGlite real)', () => {
  let raiz: string;
  let tienda: TiendaViva;
  let cookie: string;

  const api = async (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const r = await tienda.app.inject({ method, url, headers: { ...(headers.authorization ? {} : { cookie }), ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, payload: payload === undefined ? undefined : JSON.stringify(payload) });
    let body: any = {};
    try {
      body = r.body ? JSON.parse(r.body) : {};
    } catch {
      body = { crudo: r.body };
    }
    return { status: r.statusCode, body, crudo: r.body, headers: r.headers };
  };

  beforeAll(async () => {
    raiz = mkdtempSync(path.join(tmpdir(), 'procesos-tienda-'));
    const secretos = bootstrapSecrets(raiz);
    tienda = await armarTienda({
      id: 'clinica',
      slug: 'clinica',
      env: {
        PUBLIC_BASE_URL: 'http://127.0.0.1:9',
        DATABASE_URL: `pglite://${path.join(raiz, 'datos')}`,
        TRACKING_SECRET: secretos.trackingSecret,
        WHATSAPP_PROVIDER: 'local',
        BUSINESS_NAME: 'Clínica de prueba',
        RAFAGA_MS: '0',
        TIMEZONE: 'America/Lima',
        RUTAS_HORA_INICIO: '0',
        RUTAS_HORA_FIN: '24',
        HORARIO_ENVIO_INICIO: '0',
        HORARIO_ENVIO_FIN: '24',
      } as NodeJS.ProcessEnv,
      secretos,
      base: { tipo: 'pglite', dir: path.join(raiz, 'datos') },
      authDir: path.join(raiz, 'auth'),
      mediaDir: path.join(raiz, 'medios'),
      carpetaCopias: path.join(raiz, 'copias'),
      primeraCuentaRol: 'superadmin',
      autoConectarLocal: false,
      sembrarPlantillasLocales: true,
      prefijoLog: '[clinica] ',
      waParaPruebas: createFakeWhatsApp(),
    });
    const alta = await tienda.app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'ali-2026-wa' } });
    cookie = String(alta.headers['set-cookie']).split(';')[0]!;
  }, 120_000);

  afterAll(async () => {
    await tienda?.parar();
    try {
      rmSync(raiz, { recursive: true, force: true });
    } catch {
      // Windows a veces tarda en soltar la carpeta de PGlite
    }
  });

  it('una tienda nueva no trae las entregas de courier: el menu no enseña Hoy, Números, Motorizados ni Mapa', async () => {
    const r = await api('GET', '/admin/procesos');
    expect(r.status).toBe(200);
    expect(r.body.gsgActivo).toBe(false);
    const pagina = await tienda.app.inject({ method: 'GET', url: '/procesos', headers: { cookie } });
    expect(pagina.statusCode).toBe(200);
    const menu = pagina.body.slice(pagina.body.indexOf('class="s-menu-gsg"'), pagina.body.indexOf('class="s-menu-completo"'));
    expect(menu).toContain('data-ir="/procesos"');
    expect(menu).toContain('data-ir="/personas"');
    expect(menu).toContain('data-ir="/respuestas"');
    expect(menu).not.toContain('data-ir="/hoy"');
    expect(menu).not.toContain('data-ir="/motorizados"');
    // El orden: Inicio, Procesos, Personas, Respuestas, Chats.
    const orden = ['/panel#inicio', '/procesos', '/personas', '/respuestas', '/chat'].map((h) => menu.indexOf(`data-ir="${h}"`));
    expect(orden.every((x, i) => x >= 0 && (i === 0 || x > orden[i - 1]!))).toBe(true);
  });

  it('al activar la plantilla GSG, el menu enseña sus pantallas (y al desactivarla se esconden)', async () => {
    const a = await api('POST', '/admin/procesos/desde-plantilla', { plantilla: 'gsg' });
    expect(a.status).toBe(200);
    expect(a.body.ir).toBe('/hoy');
    let pagina = await tienda.app.inject({ method: 'GET', url: '/procesos', headers: { cookie } });
    let menu = pagina.body.slice(pagina.body.indexOf('class="s-menu-gsg"'), pagina.body.indexOf('class="s-menu-completo"'));
    expect(menu).toContain('data-ir="/hoy"');
    expect(menu).toContain('data-ir="/numeros"');
    expect(menu.indexOf('data-ir="/hoy"')).toBeLessThan(menu.indexOf('data-ir="/motorizados"'));
    const id = (await api('GET', '/admin/procesos')).body.procesos.find((p: { plantilla: string }) => p.plantilla === 'gsg').id;
    expect((await api('POST', `/admin/procesos/${id}/estado`, { estado: 'pausado' })).body.gsgActivo).toBe(false);
    pagina = await tienda.app.inject({ method: 'GET', url: '/procesos', headers: { cookie } });
    menu = pagina.body.slice(pagina.body.indexOf('class="s-menu-gsg"'), pagina.body.indexOf('class="s-menu-completo"'));
    expect(menu).not.toContain('data-ir="/hoy"');
  });

  for (const plantilla of ['datos', 'confirmaciones', 'campo', 'cobranza'] as const) {
    it(`Módulo desarrollador: simula «${plantilla}» con los cinco casos y cada uno termina donde debe`, async () => {
      const r = await api('POST', '/admin/desarrollador/procesos/simular', { plantilla, personas: 5, guion: 'mezcla' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const c = r.body.conversaciones as Array<{ caso: string; estado: string; mensajes: Array<{ de: string; texto: string }>; motivo: string | null }>;
      expect(c).toHaveLength(5);
      const de = (caso: string) => c.find((x) => x.caso === caso)!;
      // Todos recibieron al menos su primer mensaje.
      for (const x of c) expect(x.mensajes.some((m) => m.de === 'sistema'), x.caso).toBe(true);
      // Consulta ajena: el cierre, una vez, y a una persona.
      expect(de('ajena').estado).toBe('persona');
      expect(de('ajena').motivo).toMatch(/no es de este proceso/);
      // Sin respuesta: insistencias y luego lo que diga el paso (una persona).
      expect(de('sin_respuesta').estado).toBe('persona');
      expect(de('sin_respuesta').mensajes.filter((m) => m.de === 'sistema').length).toBeGreaterThanOrEqual(3);
      // Bien, primero mal y «¿para qué?» terminan: completada (o en manos de una persona si el paso asi lo dice: la captura de pago se valida).
      const esperado = plantilla === 'cobranza' ? 'persona' : 'completada';
      for (const caso of ['bien', 'mal', 'por_que']) expect(de(caso).estado, `${plantilla}/${caso}: ${JSON.stringify(de(caso))}`).toBe(esperado);
      // Primero mal: se le explicó que no valía antes de la buena.
      expect(de('mal').mensajes.filter((m) => m.de === 'sistema').length).toBeGreaterThan(de('bien').mensajes.filter((m) => m.de === 'sistema').length);
      // La corrida se ve en la pantalla y se exporta.
      const corrida = await api('GET', `/admin/procesos/corridas/${r.body.corrida.id}`);
      expect(corrida.status).toBe(200);
      expect(corrida.body.personas).toHaveLength(5);
      const csv = await api('GET', `/admin/procesos/exportar?corridaId=${r.body.corrida.id}`);
      expect(csv.status).toBe(200);
      expect(String(csv.headers['content-type'])).toMatch(/text\/csv/);
      expect(csv.crudo.split('\r\n')).toHaveLength(6);
    }, 60_000);
  }

  it('la API pública: POST /api/v1/procesos/:id/personas con el permiso procesos:gestionar (y sin él, 403)', async () => {
    const p = await api('POST', '/admin/procesos/desde-plantilla', { plantilla: 'confirmaciones', nombre: 'Citas por API' });
    const id = p.body.proceso.id;
    const k = await api('POST', '/admin/claves-api', { nombre: 'Sistema de citas', permisos: ['procesos:gestionar'] });
    expect(k.status).toBe(200);
    const auth = { authorization: `Bearer ${k.body.clave}` };
    const carga = await api('POST', `/api/v1/procesos/${id}/personas`, { nombre: 'Lote API', personas: [{ telefono: '900000950', nombre: 'Ana API', fecha: '30/12/2026', hora: '10:00' }, { telefono: '123', nombre: 'Malo' }] }, auth);
    expect(carga.status, JSON.stringify(carga.body)).toBe(201);
    expect(carga.body).toMatchObject({ ok: true, listas: 1, conError: 1 });
    const corrida = await api('GET', `/api/v1/procesos/corridas/${carga.body.corrida.id}`, undefined, auth);
    expect(corrida.status).toBe(200);
    expect(corrida.body.personas.map((x: { nombre: string }) => x.nombre).sort()).toEqual(['Ana API', 'Malo']);
    const lista = await api('GET', '/api/v1/procesos', undefined, auth);
    expect(lista.body.procesos.some((x: { id: number }) => x.id === id)).toBe(true);

    const otra = await api('POST', '/admin/claves-api', { nombre: 'Solo mensajes', permisos: ['mensajes:enviar'] });
    const sin = await api('POST', `/api/v1/procesos/${id}/personas`, { personas: [{ telefono: '900000951' }] }, { authorization: `Bearer ${otra.body.clave}` });
    expect(sin.status).toBe(403);
  });

  it('el editor guarda por formulario y dice en palabras lo que falta', async () => {
    const p = await api('POST', '/admin/procesos/desde-plantilla', { plantilla: 'datos', nombre: 'Fichas' });
    const id = p.body.proceso.id;
    const actual = (await api('GET', `/admin/procesos/${id}`)).body.proceso;
    const mal = await api('POST', `/admin/procesos/${id}`, { ...actual, pasos: [...actual.pasos, { id: 'nuevo', tipo: 'pedir', titulo: 'Pedir el correo', texto: '', insistir: { veces: 1, cadaMin: 60 }, sinRespuesta: 'persona' }] });
    expect(mal.status).toBe(400);
    expect(mal.body.error).toMatch(/Paso 5 .*falta el mensaje/);
    const bien = await api('POST', `/admin/procesos/${id}`, { ...actual, nombre: 'Fichas de clientes', pasos: actual.pasos.slice(0, 2) });
    expect(bien.status).toBe(200);
    const leido = (await api('GET', `/admin/procesos/${id}`)).body.proceso;
    expect(leido.nombre).toBe('Fichas de clientes');
    expect(leido.pasos).toHaveLength(2);
  });

  it('las pantallas nuevas responden y llevan el armazón', async () => {
    for (const url of ['/procesos', '/procesos/editor?id=1', '/procesos/corrida?id=1', '/personas', '/respuestas', '/desarrollador']) {
      const r = await tienda.app.inject({ method: 'GET', url, headers: { cookie } });
      expect(r.statusCode, url).toBe(200);
      expect(r.body, url).toContain('id="s-app"');
    }
    // Sin sesion, al login.
    const r = await tienda.app.inject({ method: 'GET', url: '/procesos' });
    expect(r.statusCode).toBe(302);
  });
});
