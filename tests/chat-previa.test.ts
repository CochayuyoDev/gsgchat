/**
 * La previa de un enlace en el chat: las entidades HTML del <meta> se
 * decodifican en el servidor. Antes el título de Google Maps salía como
 * «12°04&#39;39.0"S» (la página lo escapaba otra vez al pintarlo), 30/09.
 */

import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodificarEntidades, registerChatRoutes, type ChatDeps } from '../src/admin/chat-routes.js';

describe('decodificarEntidades', () => {
  it('numéricas, hexadecimales y con nombre', () => {
    expect(decodificarEntidades('12°04&#39;39.0&quot;S 77°01&#x27;48.4&quot;W')).toBe('12°04\'39.0"S 77°01\'48.4"W');
    expect(decodificarEntidades('Tom &amp; Jerry &lt;3 &apos;hola&apos;&nbsp;ya')).toBe('Tom & Jerry <3 \'hola\' ya');
    expect(decodificarEntidades('&amp;#39;')).toBe('&#39;'); // una sola vez: no se decodifica en cadena
    expect(decodificarEntidades('sin entidades &raro; & suelto')).toBe('sin entidades &raro; & suelto');
  });
});

describe('GET /admin/chat/previa', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('el título y la descripción llegan ya decodificados (una sola vez)', async () => {
    const html = `<html><head>
      <meta property="og:title" content="12°04&#39;39.0&quot;S 77°05&#39;24.0&quot;W">
      <meta property="og:description" content="Busca negocios locales &amp; rutas en Google Maps.">
      <title>no se usa</title></head><body></body></html>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })));
    const app = Fastify();
    await registerChatRoutes(app, { settings: { current: () => ({}) } } as unknown as ChatDeps);
    const res = await app.inject({ method: 'GET', url: '/admin/chat/previa?url=' + encodeURIComponent('https://maps.google.com/?q=-12.0775,-77.09') });
    expect(res.statusCode).toBe(200);
    const p = res.json() as { titulo: string; descripcion: string; sitio: string };
    expect(p.titulo).toBe('12°04\'39.0"S 77°05\'24.0"W');
    expect(p.titulo).not.toContain('&#39;');
    expect(p.descripcion).toBe('Busca negocios locales & rutas en Google Maps.');
    expect(p.sitio).toBe('maps.google.com');
    await app.close();
  });
});
