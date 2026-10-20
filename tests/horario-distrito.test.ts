/**
 * El horario aproximado de llegada por distrito (regla del dueño: GSGchat no
 * le pide nada a GSG; «Ancón de 6 a 8 de la noche, Jesús María de 3 a 5 de la
 * tarde, Comas de 5 a 7 de la noche»).
 *
 * Quién manda: la ventana que GSG mandó para el pedido; si no, la de su
 * distrito; si no, el horario general.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { registerEntregasRoutes } from '../src/entregas/routes.js';
import { ajustesEntregasSchema, AJUSTES_ENTREGAS_POR_DEFECTO, horarioEnPalabras, rellenar, TEXTOS_POR_DEFECTO, VARIABLES_TEXTOS } from '../src/entregas/textos.js';
import { fuenteEnPalabras, variablesDeVentana, ventanaDeEntrega } from '../src/entregas/horario-distrito.js';
import { crearEscenarioEntregas, PIN_LIMA, type EscenarioEntregas } from './escenario-entregas.js';

const AJUSTES = AJUSTES_ENTREGAS_POR_DEFECTO;

describe('la hora dicha en palabras', () => {
  it('como lo dice el dueño', () => {
    expect(horarioEnPalabras('18:00', '20:00')).toBe('de 6 a 8 de la noche');
    expect(horarioEnPalabras('15:00', '17:00')).toBe('de 3 a 5 de la tarde');
    expect(horarioEnPalabras('17:00', '19:00')).toBe('de 5 a 7 de la noche');
    expect(horarioEnPalabras('10:00', '12:00')).toBe('de 10 a 12 del mediodía');
    expect(horarioEnPalabras('16:00', '18:00')).toBe('de 4 a 6 de la tarde');
  });

  it('una ventana larga o que da la vuelta al 12 se dice entera; los minutos se dicen', () => {
    expect(horarioEnPalabras('14:00', '20:00')).toBe('de 2 de la tarde a 8 de la noche');
    expect(horarioEnPalabras('11:00', '14:00')).toBe('de 11 de la mañana a 2 de la tarde');
    expect(horarioEnPalabras('08:30', '10:00')).toBe('de 8:30 a 10 de la mañana');
    expect(horarioEnPalabras('19:15', '21:45')).toBe('de 7:15 a 9:45 de la noche');
  });
});

describe('el ajuste horariosPorDistrito', () => {
  it('de fábrica trae los tres ejemplos del dueño', () => {
    expect(AJUSTES.horariosPorDistrito).toEqual([
      { distrito: 'Ancón', desde: '18:00', hasta: '20:00' },
      { distrito: 'Jesús María', desde: '15:00', hasta: '17:00' },
      { distrito: 'Comas', desde: '17:00', hasta: '19:00' },
    ]);
  });

  it('unos ajustes guardados sin el campo se siguen leyendo (con los de fábrica)', () => {
    const viejos = JSON.parse(JSON.stringify({ ...AJUSTES, horariosPorDistrito: undefined }));
    const a = ajustesEntregasSchema.parse(viejos);
    expect(a.horariosPorDistrito.map((f) => f.distrito)).toEqual(['Ancón', 'Jesús María', 'Comas']);
    expect(a.horarioEntregas).toEqual(AJUSTES.horarioEntregas);
  });

  it('el distrito queda con su nombre de siempre; se rechazan horas mal escritas, al revés, distritos desconocidos y repetidos', () => {
    const ok = ajustesEntregasSchema.parse({ horariosPorDistrito: [{ distrito: 'ancon', desde: '18:00', hasta: '20:00' }, { distrito: 'JESUS MARIA', desde: '15:00', hasta: '17:00' }] });
    expect(ok.horariosPorDistrito.map((f) => f.distrito)).toEqual(['Ancón', 'Jesús María']);
    // Lo ya leído se vuelve a leer igual (se guarda y se carga).
    expect(ajustesEntregasSchema.parse(JSON.parse(JSON.stringify(ok))).horariosPorDistrito).toEqual(ok.horariosPorDistrito);
    const mal = (filas: unknown) => ajustesEntregasSchema.safeParse({ horariosPorDistrito: filas }).success;
    expect(mal([{ distrito: 'Comas', desde: '5pm', hasta: '19:00' }])).toBe(false);
    expect(mal([{ distrito: 'Comas', desde: '25:00', hasta: '26:00' }])).toBe(false);
    expect(mal([{ distrito: 'Comas', desde: '19:00', hasta: '17:00' }])).toBe(false);
    expect(mal([{ distrito: 'Comas', desde: '17:00', hasta: '17:00' }])).toBe(false);
    expect(mal([{ distrito: 'Narnia', desde: '17:00', hasta: '19:00' }])).toBe(false);
    expect(mal([{ distrito: 'Comas', desde: '17:00', hasta: '19:00' }, { distrito: 'comas', desde: '10:00', hasta: '12:00' }])).toBe(false);
    expect(mal([])).toBe(true);
  });
});

describe('quién manda en la ventana de un pedido', () => {
  it('1) la ventana que GSG mandó para el pedido, aunque su distrito tenga horario', () => {
    const v = ventanaDeEntrega({ distrito: 'Ancón', datosEnvio: { horarioEntregaDesde: '09:00', horarioEntregaHasta: '11:00' } }, AJUSTES);
    expect(v).toMatchObject({ desde: '09:00', hasta: '11:00', fuente: 'gsg', distrito: 'Ancón' });
    expect(fuenteEnPalabras(v)).toMatch(/GSG/);
  });

  it('2) sin ventana de GSG, la de su distrito (escrito como sea, o nombrado en la dirección)', () => {
    expect(ventanaDeEntrega({ distrito: 'Ancón' }, AJUSTES)).toMatchObject({ desde: '18:00', hasta: '20:00', extendidoHasta: '22:00', fuente: 'distrito', distrito: 'Ancón' });
    expect(ventanaDeEntrega({ distrito: 'jesus maria' }, AJUSTES)).toMatchObject({ desde: '15:00', hasta: '17:00', fuente: 'distrito', distrito: 'Jesús María' });
    expect(ventanaDeEntrega({ distrito: null, direccion: 'Av. Túpac Amaru 1234, Comas' }, AJUSTES)).toMatchObject({ desde: '17:00', hasta: '19:00', fuente: 'distrito', distrito: 'Comas' });
    expect(variablesDeVentana(ventanaDeEntrega({ distrito: 'Ancón' }, AJUSTES)).horario).toBe('de 6 a 8 de la noche');
  });

  it('3) un distrito sin horario propio, o desconocido, va al horario general', () => {
    expect(ventanaDeEntrega({ distrito: 'Miraflores' }, AJUSTES)).toMatchObject({ desde: '14:00', hasta: '20:00', extendidoHasta: '22:00', fuente: 'general', distrito: 'Miraflores' });
    const desconocido = ventanaDeEntrega({ distrito: 'Narnia', direccion: 'Calle Falsa 123' }, AJUSTES);
    expect(desconocido).toMatchObject({ desde: '14:00', hasta: '20:00', fuente: 'general', distrito: null });
    expect(fuenteEnPalabras(desconocido)).toMatch(/general/);
    expect(ventanaDeEntrega(null, AJUSTES).fuente).toBe('general');
    // Unos ajustes sin la tabla (de antes) también.
    expect(ventanaDeEntrega({ distrito: 'Ancón' }, { horarioEntregas: AJUSTES.horarioEntregas }).fuente).toBe('general');
  });
});

describe('los textos al cliente', () => {
  it('«Ubicación registrada» dice la ventana de su distrito', () => {
    const v = variablesDeVentana(ventanaDeEntrega({ distrito: 'Ancón' }, AJUSTES));
    const t = rellenar(TEXTOS_POR_DEFECTO.ubicacionRegistrada, { negocio: 'GSG', nombre: 'Ana', distrito: 'Ancón', ...v });
    expect(t).toContain('Horario aproximado de llegada para Ancón: de 6 a 8 de la noche.');
    expect(t).toContain('hasta las 10:00 PM');
  });

  it('sin distrito se quita el «para» y queda el horario general', () => {
    const v = variablesDeVentana(ventanaDeEntrega(null, AJUSTES));
    const t = rellenar(TEXTOS_POR_DEFECTO.confirmada, { negocio: 'GSG', pedido: 'P-1', ...v });
    expect(t).toContain('Horario aproximado de llegada: de 2 de la tarde a 8 de la noche.');
  });

  it('{distrito} y {horario} se enseñan junto a los textos que llevan el horario', () => {
    for (const clave of ['ubicacionRegistrada', 'graciasYConfirmar', 'graciasYConfirmarVarios', 'confirmada', 'horaEnSilencioSinTiempo'] as const) {
      expect(VARIABLES_TEXTOS[clave]).toEqual(expect.arrayContaining(['{distrito}', '{horario}']));
    }
  });
});

describe('de punta a punta: la pantalla de ajustes y el cliente', () => {
  let e: EscenarioEntregas;
  // Las rutas de entregas de verdad, con una sesión de administrador (como la pantalla).
  let admin: FastifyInstance;
  const post = async (url: string, body: unknown) => {
    const r = await admin.inject({ method: 'POST', url, payload: body as Record<string, unknown> });
    return { status: r.statusCode, body: r.json() as { ajustes: typeof AJUSTES } };
  };
  beforeAll(async () => {
    e = await crearEscenarioEntregas({});
    e.simulador.cargarDePrueba();
    await e.api.post('/admin/motorizados/de-prueba');
    await e.gsgManda();
    admin = Fastify();
    admin.decorateRequest('usuario', null);
    admin.addHook('onRequest', async (request) => {
      (request as unknown as { usuario: unknown }).usuario = { rol: 'admin', nombre: 'Ali' };
    });
    // Como el servidor: un cuerpo que no pasa la validación es un 400.
    admin.setErrorHandler((error, _request, reply) => reply.code(error instanceof ZodError ? 400 : 500).send({ error: error instanceof Error ? error.message : String(error) }));
    await registerEntregasRoutes(admin, { entregas: e.entregas, config: { bbox: null } as never });
    await admin.ready();
  });
  afterAll(async () => {
    await admin?.close();
    await e.cerrar();
  });

  it('la tabla se guarda por la ruta de admin, vuelve normalizada y la rechaza si está mal', async () => {
    const r = await post('/admin/entregas/ajustes', {
      horarioEntregas: { desde: '00:00', hasta: '23:59', extendidoHasta: '23:59' },
      horariosPorDistrito: [
        { distrito: 'miraflores', desde: '16:00', hasta: '18:00' },
        { distrito: 'Ancón', desde: '18:00', hasta: '20:00' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.ajustes.horariosPorDistrito).toEqual([
      { distrito: 'Miraflores', desde: '16:00', hasta: '18:00' },
      { distrito: 'Ancón', desde: '18:00', hasta: '20:00' },
    ]);
    const leido = (await admin.inject({ method: 'GET', url: '/admin/entregas' })).json() as { ajustes: typeof AJUSTES };
    expect(leido.ajustes.horariosPorDistrito).toEqual(r.body.ajustes.horariosPorDistrito);
    // Otros ajustes no tocan la tabla.
    await post('/admin/entregas/ajustes', { margenMinutos: 30 });
    expect(e.entregas.ajustes().horariosPorDistrito.map((f) => f.distrito)).toEqual(['Miraflores', 'Ancón']);
    // Mal escrita: no se guarda.
    const mal = await post('/admin/entregas/ajustes', { horariosPorDistrito: [{ distrito: 'Narnia', desde: '18:00', hasta: '20:00' }] });
    expect(mal.status).toBe(400);
    const alReves = await post('/admin/entregas/ajustes', { horariosPorDistrito: [{ distrito: 'Comas', desde: '19:00', hasta: '17:00' }] });
    expect(alReves.status).toBe(400);
    expect(e.entregas.ajustes().horariosPorDistrito.map((f) => f.distrito)).toEqual(['Miraflores', 'Ancón']);
  });

  it('el cliente de Miraflores recibe la ventana de Miraflores, y la IA la sabe con su origen', async () => {
    const antes = e.textosA('987000001').length;
    await e.contesta('987000001', { pin: PIN_LIMA });
    const nuevos = e.textosA('987000001').slice(antes).join('\n');
    expect(nuevos).toContain('Horario aproximado de llegada para Miraflores: de 4 a 6 de la tarde');
    const ctx = (await e.entregas.contextoDeCliente('51987000001')) ?? '';
    expect(ctx).toContain('de 4:00 PM a 6:00 PM');
    expect(ctx).toContain('horario por distrito de Miraflores');
    expect(ctx).toMatch(/No inventes otro horario/);
  });
});
