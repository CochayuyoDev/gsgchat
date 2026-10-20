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
  it('una ubicación recibida muestra los mensajes anteriores como historial, no como intentos pendientes', () => {
    const intentos = new Function('cuando', funcionDe(scriptDeLaPagina(), 'function intentosDe(s, maxIntentos)') + '\nreturn intentosDe;')(() => 'hora') as (s: unknown, max: number) => string;
    expect(intentos({ estado: 'resuelto', intentos: 3 }, 3)).toBe('3 mensajes enviados antes de recibir la ubicación');
    expect(intentos({ estado: 'enviado', intentos: 2 }, 3)).toBe('intento 2 de 3');
  });

  it('permite configurar intervalos por mensaje y agregar más de tres, sin modo ilimitado', () => {
    expect(html).toContain('id="aj-secuencia"');
    expect(html).toContain('id="aj-agregar-mensaje"');
    expect(html).toContain('esperasMensajesMinutos');
    expect(html).toContain('Máximo 99 recordatorios');
    expect(html).not.toContain('aj-cada');
    expect(html).not.toContain('sin tope de mensajes');
    expect(html).not.toContain('hasta que la mande');
    expect(html).not.toContain('max="10" class="aj-num" aria-label="Mensajes como máximo"');
    expect(html).toContain('id="aj-pasos-adicionales"');
    expect(html).toContain('data-texto-adicional');
    expect(html).toContain('textosAdicionales');
    expect(html).toContain('textosSeguimientos');
    expect(html).toContain('Solicitud inicial de ubicación');
    expect(html).toContain('class="aj-seccion aj-seccion-inicial"');
    expect(html).toContain('id="aj-tiempo-solicitud"');
    expect(html).toContain('Plantilla «Solicitud de ubicación»');
    expect(html).toContain('Recordatorios y seguimientos');
    expect(html).toContain('class="aj-tiempo-grid"');
    expect(html).toContain("' + antecedente + '");
    expect(html).toContain('Recordatorio ');
    expect(html).toContain('id="aj-secuencia"');
    expect(html).toContain('id="aj-espera-primero-unidad"');
    expect(html).toContain("indice === 0 ? 'Después de la solicitud inicial' : 'Después del recordatorio ' + indice");
    expect(html).toContain('data-indice-espera');
    expect(html).toContain('data-quitar-adicional');
    expect(html).toContain('data-unidad-secuencia');
    expect(html).toContain('id="aj-pausa-min-unidad"');
    expect(html).toContain('horas</option>');
    expect(html).toContain('Pausa entre clientes');
    expect(html).toContain('Textos de los seguimientos');
    expect(html).not.toContain('Plantillas de Meta para este paso');
    expect(html).not.toContain('data-paso=');
  });
  it('muestra exactamente un cuadro de texto por seguimiento, incluso al agregar y quitar', () => {
    const caja = { innerHTML: '', querySelectorAll: () => [] };
    const pintar = new Function('document', 'esc', 'marcadoresHtml', 'textoDeLineas', 'AYUDA_REDACCION',
      funcionDe(scriptDeLaPagina(), 'function pintarTextosAdicionales(cantidad, textos)') + '\nreturn pintarTextosAdicionales;')(
        { getElementById: () => caja }, String, () => '', (l: string[]) => (l || []).join('\n---\n'), '',
      );
    for (const cantidad of [0, 2, 3, 2, 1]) {
      pintar(cantidad, []);
      expect((caja.innerHTML.match(/data-texto-seguimiento=/g) || []).length).toBe(cantidad);
      expect((caja.innerHTML.match(/data-rama="recordatorio"/g) || []).length).toBe(cantidad);
      expect((caja.innerHTML.match(/data-rama="insistencia"/g) || []).length).toBe(cantidad);
    }
  });

  it('conserva las redacciones anteriores al convertirlas en seguimientos', () => {
    const convertir = new Function(funcionDe(scriptDeLaPagina(), 'function textosSeguimientosDe(a, cantidad)') + '\nreturn textosSeguimientosDe;')();
    const a = { textos: { recordatorio: ['R'], insistencia: ['I'] }, textosAdicionales: [['Tercero']] };
    expect(convertir(a, 3)).toEqual([
      { recordatorio: ['R'], insistencia: ['I'] },
      { recordatorio: ['R'], insistencia: ['I'] },
      { recordatorio: ['Tercero'], insistencia: ['Tercero'] },
    ]);
  });

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
