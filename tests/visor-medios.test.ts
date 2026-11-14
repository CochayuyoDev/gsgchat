/**
 * El visor de fotos y videos: se abren dentro de la misma pagina, no en otra
 * pestaña. Aqui se comprueba que el visor va en todas las pantallas del
 * armazon y que el chat marca sus fotos y videos para abrirse en el. El
 * comportamiento (flechas, zoom, Esc, video) se prueba en el navegador.
 */

import { describe, expect, it } from 'vitest';
import { VISOR_CSS, VISOR_JS } from '../src/web/visor-medios.js';
import { appShell } from '../src/web/shell.js';
import { chatPage } from '../src/web/chat-page.js';

describe('visor de fotos y videos', () => {
  it('el JS se puede ejecutar y respeta la regla de las paginas (sin backticks ni ${)', () => {
    expect(() => new Function(VISOR_JS)).not.toThrow();
    expect(VISOR_JS).not.toContain('`');
    expect(VISOR_JS).not.toContain('${');
    expect(VISOR_JS).not.toMatch(/<\/script/i);
    expect(VISOR_JS).toContain('window.abrirVisor = abrirVisor');
    // Nunca abre otra pestaña por su cuenta.
    expect(VISOR_JS).not.toContain('window.open');
    expect(VISOR_CSS).toContain('.vis {');
  });

  it('va en todas las pantallas del armazon', () => {
    const html = appShell({ titulo: 'Prueba', contenido: '<p>hola</p>' } as Parameters<typeof appShell>[0]);
    expect(html).toContain(VISOR_CSS.trim().slice(0, 40));
    expect(html).toContain('window.abrirVisor = abrirVisor');
  });

  it('en el chat, la foto y el video se abren en el visor y no en una pestaña nueva', () => {
    const html = chatPage({ proveedor: 'local', configured: true, nombreNegocio: 'Prueba' });
    const adjunto = html.slice(html.indexOf('function adjuntoHtml(m)'), html.indexOf('function ubicacionHtml(m)'));
    expect(adjunto).toContain('data-visor="imagen"');
    expect(adjunto).toContain('data-visor="video"');
    expect(adjunto).not.toContain('_blank');
    // El hilo es el grupo: las flechas pasan por las fotos y videos de esa conversacion.
    expect(html).toMatch(/id="messages"[^>]*data-visor-grupo/);
  });
});
