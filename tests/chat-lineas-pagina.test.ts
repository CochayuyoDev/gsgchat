/**
 * La pantalla de Chats con varias lineas: el JS compila y trae la etiqueta de
 * cada chat, la de cada mensaje y el selector de linea.
 */

import { describe, expect, it } from 'vitest';
import { chatPage } from '../src/web/chat-page.js';

describe('pantalla de chats con lineas', () => {
  const html = chatPage({ proveedor: 'local', configured: true, nombreNegocio: 'Prueba' });

  it('los scripts compilan', () => {
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).filter(Boolean);
    expect(scripts.length).toBeGreaterThan(0);
    for (const js of scripts) expect(() => new Function(js)).not.toThrow();
  });

  it('rotula cada chat y cada mensaje con su linea, y deja elegir por cual contestar', () => {
    expect(html).toContain('id="linea-sel"');
    expect(html).toContain('lineaTagHtml');
    expect(html).toContain('payload.lineaId = lineaDeEnvio');
    expect(html).toContain('.linea-tag');
  });
});

describe('pantalla de conexion con lineas', () => {
  it('trae la tarjeta de lineas y su script compila', async () => {
    const { connectPage } = await import('../src/web/connect-page.js');
    const html = connectPage({ labels: {}, nombreNegocio: 'Prueba', vista: 'whatsapp' });
    expect(html).toContain('id="card-lineas"');
    expect(html).toContain('/admin/lineas');
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).filter(Boolean);
    for (const js of scripts) expect(() => new Function(js)).not.toThrow();
  });
});
