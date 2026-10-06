/**
 * Lo que la web enseña: la bandeja de errores de Hoy y el código HTTP de
 * cada fallo. Se ejecuta el JS de verdad de la página (el que sirve /entregas)
 * con un DOM mínimo de mentira, contra el servidor real: lo que sale en
 * pantalla es lo que contestó el servidor, con su código.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { CLAVE_API_PRUEBA } from './fakes.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';
import { mensajeDeErrorHttp } from '../src/web/bandeja-mensajes.js';

const GSG = { empresa: 'Tienda Prueba', metodoPago: 'Yape', montoCobrar: '35.00' };

let esc: EscenarioEntregas;
beforeEach(async () => {
  esc = await crearEscenarioEntregas();
});
afterEach(async () => {
  await esc?.cerrar();
});

/** Un trozo `function nombre(...) {...}` del HTML, con sus llaves equilibradas. */
function funcionDe(html: string, cabecera: string): string {
  const i = html.indexOf(cabecera);
  if (i < 0) throw new Error(`no está ${cabecera}`);
  let nivel = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}' && --nivel === 0) return html.slice(i, j + 1);
  }
  throw new Error(`sin cierre: ${cabecera}`);
}
function trozo(html: string, desde: string, hasta: string): string {
  const i = html.indexOf(desde);
  const j = html.indexOf(hasta, i);
  if (i < 0 || j < 0) throw new Error(`no está ${desde}`);
  return html.slice(i, j);
}

/** El JS de la bandeja y el api() de la página, ejecutados con un DOM de mentira y fetch contra el servidor. */
async function montarPagina() {
  const r = await esc.app.inject({ method: 'GET', url: '/entregas', headers: { 'x-api-key': CLAVE_API_PRUEBA } });
  expect(r.statusCode).toBe(200);
  const html = r.body;
  const elementos: Record<string, { innerHTML: string; textContent: string; clases: Set<string>; classList: { toggle(c: string, si?: boolean): void; add(c: string): void; remove(c: string): void } }> = {};
  const elemento = (id: string) => {
    if (!elementos[id]) {
      const clases = new Set<string>(id === 'bandeja-mensajes' ? ['hidden'] : []);
      elementos[id] = {
        innerHTML: '',
        textContent: '',
        clases,
        classList: {
          toggle: (c, si) => (si ?? !clases.has(c) ? clases.add(c) : clases.delete(c)),
          add: (c) => clases.add(c),
          remove: (c) => clases.delete(c),
        },
      };
    }
    return elementos[id]!;
  };
  const toasts: string[] = [];
  const confirmaciones: string[] = [];
  let respuestaConfirmar = true;
  const fetchFalso = async (path: string, init: { method?: string; body?: string }) => {
    const res = await esc.app.inject({ method: (init.method ?? 'GET') as 'GET', url: path, headers: { 'x-api-key': CLAVE_API_PRUEBA, 'content-type': 'application/json' }, payload: init.body });
    return { ok: res.statusCode < 400, status: res.statusCode, statusText: '', json: async () => JSON.parse(res.body) };
  };
  const codigo = [
    trozo(html, 'function mensajeDeErrorHttp(', '\n}\n') + '\n}',
    funcionDe(html, 'async function api(path, options)'),
    trozo(html, '/* ------------------------------------------------ bandeja de errores de mensajes */', '(function () {\n  var lista = document.getElementById'),
    'return { pintarBandejaMensajes, cargarBandejaMensajes, reintentarMensajeBandeja, api };',
  ].join('\n');
  const fabrica = new Function('document', 'fetch', '$', 'esc', 'telefonoBonito', 'hora', 'toast', 'confirmarDialogo', 'irAlLogin', 'errorHttp', codigo);
  const pagina = fabrica(
    { getElementById: elemento },
    fetchFalso,
    elemento,
    (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!),
    (t: string) => t,
    (iso: string) => iso.slice(11, 16),
    (t: string) => toasts.push(t),
    async (o: { titulo: string }) => {
      confirmaciones.push(o.titulo);
      return respuestaConfirmar;
    },
    () => undefined,
    (s: number) => `HTTP ${s}`,
  ) as { pintarBandejaMensajes(r: unknown): void; cargarBandejaMensajes(): Promise<void>; reintentarMensajeBandeja(id: string | number): Promise<void>; api(p: string, o?: unknown): Promise<unknown> };
  return { html, pagina, elementos, toasts, confirmaciones, alConfirmar: (si: boolean) => (respuestaConfirmar = si) };
}

const crear = async (tracking: string, telefono: string) => {
  const r = await esc.api.post<{ creadas: Array<{ id: number }> }>('/api/v1/entregas', { ...GSG, tracking, cliente: `Cliente ${tracking}`, telefono });
  return r.body.creadas[0]!.id;
};

describe('la bandeja de errores en la web', () => {
  it('Hoy trae la sección de la bandeja', async () => {
    const { html } = await montarPagina();
    expect(html).toContain('id="bandeja-mensajes"');
    expect(html).toContain('btn-reintentar-mensaje');
    expect(html).toContain('Mensajes que no salieron');
  });

  it('enseña referencia, cliente, estado, motivo, último intento e intentos; el botón según el estado; y se vacía al enviarse', async () => {
    const id = await crear('WEB-1', '987900001');
    esc.wa.failNext = new WhatsAppApiError('(#131021) Recipient phone number not valid', 400, 131021, undefined, false);
    await esc.trabajar();
    const { pagina, elementos, toasts } = await montarPagina();
    await pagina.cargarBandejaMensajes();
    expect(elementos['bandeja-mensajes']!.clases.has('hidden')).toBe(false);
    expect(elementos['bandeja-mensajes-n']!.textContent).toBe('1');
    const fila = elementos['bandeja-mensajes-lista']!.innerHTML;
    expect(fila).toContain('WEB-1');
    expect(fila).toContain('Cliente WEB-1');
    expect(fila).toContain('Falló (no se reintenta solo)');
    expect(fila).toContain('El teléfono no es válido');
    expect(fila).toContain('Intentos: 1');
    expect(fila).toMatch(/Último intento: (?!—)/);
    expect(fila).toMatch(new RegExp(`class="btn sm btn-reintentar-mensaje" type="button" data-id="${id}">Reintentar mensaje`));

    await pagina.reintentarMensajeBandeja(id);
    expect(toasts.at(-1)).toMatch(/^WEB-1: Reintento en marcha/);
    // En curso: botón apagado.
    expect(elementos['bandeja-mensajes-lista']!.innerHTML).toMatch(/data-id="\d+" disabled aria-disabled="true">En curso…/);
    // Un segundo clic (otra pestaña) lo cuenta con su código HTTP.
    await pagina.reintentarMensajeBandeja(id);
    expect(toasts.at(-1)).toMatch(/^WEB-1: HTTP 409 · El mensaje de WEB-1 ya tiene un intento en curso/);

    await esc.trabajar();
    await pagina.cargarBandejaMensajes();
    expect(elementos['bandeja-mensajes-n']!.textContent).toBe('0');
    expect(elementos['bandeja-mensajes-lista']!.innerHTML).toContain('no hay nada que reintentar');
  });

  it('un incierto pide confirmación antes de reintentar; si se cancela no se llama al servidor', async () => {
    const id = await crear('WEB-2', '987900002');
    esc.wa.failNext = new TypeError('fetch failed');
    await esc.trabajar();
    const { pagina, elementos, toasts, confirmaciones, alConfirmar } = await montarPagina();
    await pagina.cargarBandejaMensajes();
    expect(elementos['bandeja-mensajes-lista']!.innerHTML).toContain('Incierto: no se sabe si le llegó');
    alConfirmar(false);
    await pagina.reintentarMensajeBandeja(id);
    expect(confirmaciones).toHaveLength(1);
    expect(toasts).toHaveLength(0);
    expect((await esc.repos.entregas.entrega(id))!.mensajeEstado).toBe('incierto');
    alConfirmar(true);
    await pagina.reintentarMensajeBandeja(id);
    expect(toasts.at(-1)).toMatch(/Reintento en marcha/);
    expect((await esc.repos.entregas.entrega(id))!.mensajeEstado).toBe('encolado');
  });

});

describe('la web muestra el código HTTP y el mensaje del servidor', () => {
  it('para cada respuesta de error de la API, lo que sale en pantalla lleva su código y su mensaje', async () => {
    const { pagina } = await montarPagina();
    const fallo = async (path: string, opciones?: unknown) => {
      try {
        await pagina.api(path, opciones);
        return null;
      } catch (e) {
        return e as Error & { status: number; codigo?: string };
      }
    };
    // 400 con los campos que faltan.
    const e400 = await fallo('/api/v1/entregas', { method: 'POST', body: { tracking: 'WEB-400', telefono: '987900003' } });
    expect(e400!.status).toBe(400);
    expect(e400!.message).toMatch(/^HTTP 400 · /);
    expect(e400!.message).toContain('empresa');
    expect(e400!.codigo).toBe('VALIDACION');
    // 404 de un pedido que no existe y de una ruta que no existe.
    const e404 = await fallo('/api/v1/entregas/NO-HAY');
    expect(e404!.message).toBe('HTTP 404 · No hay ningún pedido de hoy con la referencia "NO-HAY".');
    const ruta = await fallo('/api/v1/nada');
    expect(ruta!.message).toMatch(/^HTTP 404 · No existe GET \/api\/v1\/nada/);
    // 409 al cancelar dos veces.
    await crear('WEB-409', '987900004');
    await pagina.api('/api/v1/entregas/WEB-409', { method: 'DELETE' });
    const e409 = await fallo('/api/v1/entregas/WEB-409', { method: 'DELETE' });
    expect(e409!.message).toMatch(/^HTTP 409 · El pedido WEB-409 ya está cancelado/);
    // 503 si la base no contesta.
    const original = esc.repos.entregas.crearEntrega;
    esc.repos.entregas.crearEntrega = async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    };
    const e503 = await fallo('/api/v1/entregas', { method: 'POST', body: { ...GSG, tracking: 'WEB-503', cliente: 'X', telefono: '987900005' } });
    esc.repos.entregas.crearEntrega = original;
    expect(e503!.message).toMatch(/^HTTP 503 · La base de datos no responde/);
  });

  it('el formateador: 401, 403, 429, 500 y un cuerpo que no es JSON', () => {
    expect(mensajeDeErrorHttp(401, 'Unauthorized', { ok: false, codigo: 'CLAVE_AUSENTE', error: 'Falta la clave de API' })).toBe('HTTP 401 · Falta la clave de API');
    expect(mensajeDeErrorHttp(403, 'Forbidden', { ok: false, codigo: 'SIN_PERMISO', error: 'Sin permiso' })).toBe('HTTP 403 · Sin permiso');
    expect(mensajeDeErrorHttp(429, 'Too Many Requests', { ok: false, codigo: 'DEMASIADAS_PETICIONES', error: 'Espera 12 s' })).toBe('HTTP 429 · Espera 12 s');
    expect(mensajeDeErrorHttp(500, 'Internal Server Error', { ok: false, codigo: 'ERROR_INTERNO', error: 'Error interno' })).toBe('HTTP 500 · Error interno');
    expect(mensajeDeErrorHttp(502, 'Bad Gateway', null)).toBe('HTTP 502 · Bad Gateway');
    expect(mensajeDeErrorHttp(400, '', { error: 'No se entiende', detalles: [{ campo: 'pedidos[0].empresa', mensaje: 'falta (es obligatorio)' }] })).toBe('HTTP 400 · No se entiende · pedidos[0].empresa: falta (es obligatorio)');
  });
});
