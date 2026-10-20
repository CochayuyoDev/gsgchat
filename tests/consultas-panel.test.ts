import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSULTAS_JS } from '../src/web/consultas.js';
import { chatPage } from '../src/web/chat-page.js';
import { panelPage } from '../src/web/pages.js';
import { connectPage } from '../src/web/connect-page.js';

interface Panel {
  leerPanel(url: string): Promise<unknown>;
  sondearPanel(fn: () => Promise<unknown>, ms: number, inmediato?: boolean): () => void;
}
function entorno(fetch: ReturnType<typeof vi.fn>) {
  const window = {} as Panel;
  const document = new EventTarget() as EventTarget & { hidden: boolean };
  document.hidden = false;
  const location = { href: '', pathname: '/chat', hash: '' };
  new Function('window', 'document', 'fetch', 'location', 'AbortController', 'setTimeout', 'clearTimeout', 'Date', CONSULTAS_JS)(window, document, fetch, location, AbortController, setTimeout, clearTimeout, Date);
  return { window, document, location };
}
const respuesta = (status = 200, headers = {}) => new Response(JSON.stringify(status === 200 ? { ok: true } : { error: 'Servicio no disponible' }), { status, headers });
afterEach(() => { vi.useRealTimers(); });

describe('consultas del chat y panel sin sobrecargar el servidor', () => {
  it('reutiliza el JSON con 304 y recibe los cambios con un ETag nuevo', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ mensajes: [1] }), { headers: { etag: '"uno"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mensajes: [1, 2] }), { headers: { etag: '"dos"' } }));
    const { window } = entorno(fetch);
    expect(await window.leerPanel('/admin/chat/1')).toEqual({ mensajes: [1] });
    expect(await window.leerPanel('/admin/chat/1')).toEqual({ mensajes: [1] });
    expect(fetch.mock.calls[1]![1].headers).toEqual({ 'if-none-match': '"uno"' });
    expect(await window.leerPanel('/admin/chat/1')).toEqual({ mensajes: [1, 2] });
  });
  it('varias lecturas simultáneas de la misma URL hacen una sola petición', async () => {
    let resolver!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(r => { resolver = r; }));
    const { window } = entorno(fetch);
    const lecturas = Array.from({ length: 10 }, () => window.leerPanel('/admin/deliveries'));
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    resolver(respuesta());
    expect(await Promise.all(lecturas)).toEqual(Array(10).fill({ ok: true }));
    const siguiente = window.leerPanel('/admin/deliveries');
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    resolver(respuesta()); await siguiente;
  });

  it('un servidor que falla se consulta cada vez menos y se recupera al responder', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(respuesta(503)));
    const { window } = entorno(fetch);
    await expect(window.leerPanel('/admin/avisos')).rejects.toThrow('Servicio no disponible');
    for (let i = 0; i < 10; i++) await expect(window.leerPanel('/admin/avisos')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15000);
    await expect(window.leerPanel('/admin/avisos')).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000);
    await expect(window.leerPanel('/admin/avisos')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15000);
    fetch.mockImplementation(() => Promise.resolve(respuesta()));
    await window.leerPanel('/admin/avisos');
    await window.leerPanel('/admin/avisos');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('respeta Retry-After y deja de consultar cuando termina la sesión', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(respuesta(429, { 'retry-after': '90' })));
    const { window, location } = entorno(fetch);
    await expect(window.leerPanel('/admin/deliveries')).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(60000);
    await expect(window.leerPanel('/admin/deliveries')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);
    fetch.mockImplementation(() => Promise.resolve(respuesta(401)));
    await expect(window.leerPanel('/admin/deliveries')).rejects.toThrow();
    await expect(window.leerPanel('/admin/chat/conversations')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(location.href).toContain('/login?next=');
  });

  it('no superpone ciclos lentos, pausa con la pestaña oculta y retoma una sola vez', async () => {
    vi.useFakeTimers();
    const { window, document } = entorno(vi.fn());
    let terminar!: () => void;
    const tarea = vi.fn(() => new Promise<void>(r => { terminar = r; }));
    const detener = window.sondearPanel(tarea, 15000, true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(tarea).toHaveBeenCalledTimes(1);
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
    terminar(); await vi.advanceTimersByTimeAsync(120000);
    expect(tarea).toHaveBeenCalledTimes(1);
    document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(tarea).toHaveBeenCalledTimes(2);
    terminar(); await vi.advanceTimersByTimeAsync(15000);
    expect(tarea).toHaveBeenCalledTimes(3);
    detener(); terminar(); await vi.advanceTimersByTimeAsync(60000);
    expect(tarea).toHaveBeenCalledTimes(3);
  });

  it('corta una petición colgada y evita reintentar inmediatamente', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, opts) => new Promise<Response>((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new DOMException('Abortado', 'AbortError')))));
    const { window } = entorno(fetch);
    const error = window.leerPanel('/admin/health').catch(e => e);
    await vi.advanceTimersByTimeAsync(20000);
    expect((await error as Error).message).toContain('tardó demasiado');
    await expect(window.leerPanel('/admin/health')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('el JavaScript generado para ambas pantallas compila', () => {
    for (const html of [chatPage({ configured: true, nombreNegocio: 'Prueba' }), panelPage({ configured: true, nombreNegocio: 'Prueba' }), connectPage({ labels: {}, nombreNegocio: 'Prueba' })]) {
      const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
      expect(() => new Function(script)).not.toThrow();
    }
  });

  it('cambiar el filtro del historial durante una consulta lenta no pinta resultados antiguos', async () => {
    const html = panelPage({ configured: true, nombreNegocio: 'Prueba' });
    const inicio = html.indexOf('var peticionHistorial=0;');
    const fin = html.indexOf("evento('historial-refrescar'", inicio);
    const filtro = { value: 'failed' };
    const pendientes: Array<(data: unknown) => void> = [];
    const api = vi.fn(() => new Promise(r => pendientes.push(r)));
    const tabla = vi.fn();
    const cargar = new Function('api', '$', 'tablaHtml', 'fecha', 'location', 'document', 'esc', 'cifra', html.slice(inicio, fin) + '\nreturn historial;')(api, () => filtro, tabla, (d: unknown) => d, { hash: '#historial' }, { hidden: false, querySelectorAll: () => [] }, (v: unknown) => String(v ?? ''), (n: unknown) => String(Number(n) || 0));
    const vieja = cargar();
    const nueva = cargar();
    pendientes[1]!({ items: [{ at: 'nueva', detalle: { http: 200 } }] });
    await nueva;
    pendientes[0]!({ items: [{ at: 'antigua', detalle: { http: 400 } }] });
    await vieja;
    expect(tabla).toHaveBeenCalledTimes(1);
    const filas = tabla.mock.calls[0]?.[2] as string[][];
    expect(filas).toHaveLength(1);
    expect(filas[0]![0]).toBe('nueva');
    expect(filas[0]![1]).toContain('200');
  });
});
