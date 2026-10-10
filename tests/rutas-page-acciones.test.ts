/**
 * Las acciones del detalle en la pantalla de Automatización GSG.
 *
 * La pantalla entera vive en plantillas de texto: TypeScript no mira lo que
 * hay dentro. Aqui se comprueba que el JS compila, que salen los textos y las
 * rutas nuevas y, sobre todo, que una solicitud cancelada no ofrece ningun
 * boton que vuelva a escribirle al cliente.
 */

import { describe, expect, it } from 'vitest';
import { rutasPage } from '../src/web/rutas-page.js';

const html = rutasPage({ configured: true, demo: false, nombreNegocio: 'Tienda' });

function scriptDeLaPagina(): string {
  const desde = html.lastIndexOf('<script>');
  const hasta = html.lastIndexOf('</script>');
  expect(desde).toBeGreaterThan(-1);
  return html.slice(desde + '<script>'.length, hasta);
}

/** Una funcion de nivel superior del script, desde su firma hasta su "}" de cierre. */
function funcionDe(fuente: string, firma: string): string {
  const desde = fuente.indexOf(firma);
  expect(desde, firma).toBeGreaterThan(-1);
  const hasta = fuente.indexOf('\n}\n', desde);
  return fuente.slice(desde, hasta + 2);
}

interface Elemento { innerHTML: string; textContent: string; onclick: unknown; classList: { toggle(): void } }

/** Pinta el detalle de una solicitud con un DOM de mentira y devuelve las acciones. */
function accionesPintadas(estado: string, extra: Record<string, unknown> = {}): string {
  const js = scriptDeLaPagina();
  const codigo = [
    'var detalleId = null;',
    funcionDe(js, 'function accionesDeEstado(estado)'),
    funcionDe(js, 'function pintarDetalle(data)'),
    'return pintarDetalle;',
  ].join('\n');
  const elementos: Record<string, Elemento> = {};
  const documento = {
    getElementById: (id: string) =>
      (elementos[id] ??= { innerHTML: '', textContent: '', onclick: null, classList: { toggle: () => undefined } }),
  };
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const pintar = new Function('document', 'esc', 'ver', 'chipEstado', 'cuando', codigo)(
    documento, esc, () => undefined, (e: string) => e, (iso: string) => iso,
  ) as (d: unknown) => void;
  pintar({
    solicitud: { id: 7, estado, nombre: 'Ana', phone: '51987654321', telefonoCrudo: '987654321', lat: null, lng: null, ...extra },
    incidencia: null,
    eventos: [],
  });
  return elementos['detalle-acciones']!.innerHTML;
}

describe('acciones del detalle en Automatización GSG', () => {
  it('el javascript de la página compila sin errores de sintaxis', () => {
    expect(() => new Function(scriptDeLaPagina())).not.toThrow();
  });

  it('trae los textos y las rutas nuevas, y ya no «Devolver a la cola»', () => {
    expect(html).toContain('Reintentar esta solicitud');
    expect(html).toContain('Pedir ubicación otra vez');
    expect(html).toContain('Quitar de esta automatización');
    expect(html).toContain('Quitada de esta automatización');
    expect(html).toContain('/volver-a-empezar');
    expect(html).toContain('/cancelar');
    expect(html).not.toContain('Devolver a la cola');
  });

  it('usa los cuadros propios, nunca confirm() ni prompt() del navegador', () => {
    const js = scriptDeLaPagina();
    expect(js).toContain('confirmarDialogo(');
    expect(js).toContain('pedirDato(');
    expect(js).not.toMatch(/[^.\w]confirm\(/);
    expect(js).not.toMatch(/[^.\w]prompt\(/);
  });

  it('decide los botones por estado', () => {
    const js = scriptDeLaPagina();
    const acciones = new Function(`${funcionDe(js, 'function accionesDeEstado(estado)')}\nreturn accionesDeEstado;`)() as (
      e: string,
    ) => { cancelada: boolean; reintentar: boolean; pedirOtraVez: boolean; quitar: boolean };

    for (const estado of ['pendiente', 'enviado', 'respondio', 'supervision', 'derivado', 'incidencia']) {
      expect(acciones(estado), estado).toEqual({ cancelada: false, reintentar: true, pedirOtraVez: false, quitar: true });
    }
    expect(acciones('resuelto')).toEqual({ cancelada: false, reintentar: true, pedirOtraVez: true, quitar: true });
    expect(acciones('cancelado')).toEqual({ cancelada: true, reintentar: false, pedirOtraVez: false, quitar: false });
  });

  it('una resuelta ofrece pedir la ubicación otra vez, reintentar y quitar', () => {
    const pintado = accionesPintadas('resuelto');
    expect(pintado).toContain('Pedir ubicación otra vez');
    expect(pintado).toContain('Reintentar esta solicitud');
    expect(pintado).toContain('Quitar de esta automatización');
  });

  it('una en curso no ofrece pedir otra vez', () => {
    const pintado = accionesPintadas('enviado');
    expect(pintado).toContain('Reintentar esta solicitud');
    expect(pintado).toContain('Quitar de esta automatización');
    expect(pintado).not.toContain('Pedir ubicación otra vez');
  });

  it('una cancelada solo dice que está fuera y deja abrir el chat', () => {
    const pintado = accionesPintadas('cancelado');
    expect(pintado).toContain('Quitada de esta automatización');
    expect(pintado).toContain('Abrir el chat');
    expect(pintado).toContain('/chat?phone=51987654321');
    // Nada que pueda volver a escribirle al cliente.
    expect(pintado).not.toContain('<button');
    expect(pintado).not.toContain('<input');
    expect(pintado).not.toContain('Reintentar');
    expect(pintado).not.toContain('Pedir ubicación otra vez');
  });
});
