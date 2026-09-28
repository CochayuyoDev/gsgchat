/**
 * «Una solicitud de otro día que quedó abierta no bloquea el pedido de hoy»
 * se decide con el reloj de la tienda, no con el de la máquina.
 *
 * El 28/09 una prueba que corría antes de las 9:00 de Lima (el escenario
 * arranca «hoy a las 9», que a esa hora es ayer) veía la solicitud de hace
 * un momento como de otro día: la cancelaba y al cliente le salían DOS
 * pedidos de ubicación.
 */

import { describe, expect, it } from 'vitest';
import { cargarLote } from '../src/rutas/cargar.js';
import { PLANES } from '../src/rutas/telefono.js';
import { createFakeRepos } from './fakes.js';
import { createFakeRutas } from './fakes-rutas.js';

describe('dos pedidos del mismo número el mismo día (con el reloj de la tienda)', () => {
  it('la solicitud de hace un momento no se cancela como «de otro día»', async () => {
    // Un día que no es el de la máquina: el 15/01/2020, a las 10:00 de Lima.
    const reloj = () => new Date('2020-01-15T15:00:00Z');
    const repos = createFakeRepos();
    repos.rutas = createFakeRutas(reloj);
    const deps = { repos, plan: PLANES.peru!, timezone: 'America/Lima', ahora: reloj };

    const primera = await cargarLote(deps, { nombre: 'uno', filas: [{ telefono: '999111800', nombre: 'Doble', referencia: 'P-DOBLE-1' }] });
    const segunda = await cargarLote(deps, { nombre: 'dos', filas: [{ telefono: '999111800', nombre: 'Doble', referencia: 'P-DOBLE-2' }] });

    const s1 = await repos.rutas.solicitud(primera.solicitudes[0]!.id);
    const s2 = await repos.rutas.solicitud(segunda.solicitudes[0]!.id);
    // La primera sigue viva: se le sigue pidiendo por ella, una sola vez.
    expect(s1?.estado).not.toBe('cancelado');
    expect(s2?.estado).toBe('incidencia');
    expect(s2?.incidencia).toBe('ya_en_curso');
  });
});
