/**
 * La IA operadora revisa el flujo y hace reportes (src/ia/acciones-informes.ts).
 *
 *  - «¿por qué no avanza el pedido de Ana?»: la linea de tiempo en palabras y
 *    lo que esta mal (mensajes en pausa, fuera de horario: «sale a las 9:00»).
 *  - «¿qué está atascado hoy?»: el dia entero, con el motivo de cada uno.
 *  - «dame el reporte de hoy»: pedidos por estado, motorizados, mensajes.
 *  - «mándale el resumen al supervisor»: tarjeta primero, envio al pulsar.
 *
 * Las consultas no cambian nada y se contestan al momento. El modelo es un
 * doble que contesta lo que la prueba le diga.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { ACCIONES, ACCIONES_POR_NOMBRE, catalogoParaElModelo, prepararAccion } from '../src/ia/acciones.js';
import type { ContextoAccion, Llamada } from '../src/ia/acciones-base.js';

type Json = Record<string, any>;
const bloque = (...acciones: Array<Record<string, unknown>>) => `Voy.\n[ACCIONES]\n${acciones.map((a) => JSON.stringify(a)).join('\n')}\n[/ACCIONES]`;

async function sesion(app: FastifyInstance): Promise<Record<string, string>> {
  const primera = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { usuario: 'ali', nombre: 'Ali', clave: 'ali-2026-wa' } });
  let cookie = (primera.headers['set-cookie'] as string | string[] | undefined) ?? '';
  if (!cookie || primera.statusCode >= 400) {
    const entrar = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ali', clave: 'ali-2026-wa' } });
    cookie = (entrar.headers['set-cookie'] as string | string[] | undefined) ?? '';
  }
  return { cookie: (Array.isArray(cookie) ? (cookie[0] ?? '') : cookie).split(';')[0]!, 'content-type': 'application/json' };
}

async function ordenar(app: FastifyInstance, h: Record<string, string>, texto: string, empujar: () => void): Promise<Json> {
  empujar();
  const r = await app.inject({ method: 'POST', url: '/admin/ia/ordenes', headers: h, payload: { texto } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

const abiertos: Array<{ cerrar(): Promise<void> }> = [];
afterEach(async () => {
  while (abiertos.length) await abiertos.pop()!.cerrar();
});

async function tienda(opciones: Parameters<typeof crearEscenarioEntregas>[0] = {}): Promise<EscenarioEntregas & { h: Record<string, string>; dice: (...r: string[]) => () => void }> {
  const esc = await crearEscenarioEntregas({ agente: true, ...opciones });
  abiertos.push(esc);
  await esc.asistente!.guardar({ token: 'tok' });
  const h = await sesion(esc.app);
  for (const [telefono, nombre] of [['999000001', 'Carlos Rojas'], ['999000002', 'Ali Torres']] as const) {
    expect((await esc.api.post('/admin/motorizados', { telefono, nombre })).status).toBe(200);
  }
  const pedidos: Array<[string, string, string, string]> = [
    ['GSG-IA-001', '912000001', 'Ana Quispe', 'Lince'],
    ['GSG-IA-002', '912000002', 'Beto Salas', 'Miraflores'],
    ['GSG-IA-003', '912000003', 'Carla Díaz', 'Surco'],
  ];
  for (const [referencia, telefono, nombre, distrito] of pedidos) {
    const r = await esc.api.post('/admin/entregas/crear', { referencia, telefono, nombre, direccion: `Av. Siempre Viva ${telefono.slice(-3)}`, distrito });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
  return Object.assign(esc, { h, dice: (...r: string[]) => () => esc.ia.respuestas.push(...r) });
}

describe('revisar el flujo', () => {
  it('un pedido: línea de tiempo en palabras y lo que está mal (mensajes en pausa), sin cambiar nada', async () => {
    const t = await tienda();
    const ana = (await t.entrega('GSG-IA-001'))!;
    expect((await t.api.post('/admin/entregas/masa', { accion: 'pausar', ids: [ana.id] })).status).toBe(200);
    const antes = JSON.stringify(await t.entrega('GSG-IA-001'));
    const enviados = t.wa.sent.length;

    const j = await ordenar(t.app, t.h, '¿por qué no avanza el pedido de Ana?', t.dice(bloque({ accion: 'flujo.revisar', cliente: 'Ana' }), 'Tiene los mensajes en pausa.'));
    expect(j.pendientes).toEqual([]);
    const h = j.hechas[0];
    expect(h).toMatchObject({ accion: 'flujo.revisar', tipo: 'consulta', ok: true });
    expect(h.resumen).toContain('GSG-IA-001 · Ana Quispe (Lince)');
    expect(h.resumen).toContain('Lo que está mal');
    expect(h.resumen).toContain('mensajes automáticos en pausa');
    // Los datos vuelven al modelo: línea de tiempo y qué hacer.
    const ultimo = t.ia.llamadas.at(-1)!.usuario;
    expect(ultimo).toContain('lineaDeTiempo');
    expect(ultimo).toContain('se creó el pedido');
    expect(ultimo).toContain('reanúdalo');
    // Revisar no toca nada.
    expect(JSON.stringify(await t.entrega('GSG-IA-001'))).toBe(antes);
    expect(t.wa.sent.length).toBe(enviados);
  });

  it('el día entero: lista los atascados con su motivo y qué hacer', async () => {
    // A las 10:00 de Lima: después de las 12:00 los que no mandaron su ubicación también salen como atascados.
    const t = await tienda({ arranque: new Date('2026-09-29T15:00:00Z') });
    const ana = (await t.entrega('GSG-IA-001'))!;
    await t.api.post('/admin/entregas/masa', { accion: 'pausar', ids: [ana.id] });
    const j = await ordenar(t.app, t.h, '¿qué está atascado hoy?', t.dice(bloque({ accion: 'flujo.revisar' }), 'Uno.'));
    const h = j.hechas[0];
    expect(h).toMatchObject({ accion: 'flujo.revisar', ok: true });
    expect(h.resumen).toMatch(/3 pedido\(s\)/);
    expect(h.resumen).toContain('1 atascado(s): GSG-IA-001');
    expect(t.ia.llamadas.at(-1)!.usuario).toContain('"hacer"');
  });

  it('creado fuera del horario de envío y aún sin escribir: «sale a las 9:00»', async () => {
    // 23:30 en Lima (UTC-5): fuera del horario del reparto (9 a 19, ampliado hasta las 22 por el horario de entregas).
    const t = await tienda({ horario: [9, 19], arranque: new Date('2026-09-29T04:30:00Z') });
    const ctx = contexto(t);
    const accion = ACCIONES_POR_NOMBRE.get('flujo.revisar')!;
    const uno = await accion.ejecutar({ cliente: 'GSG-IA-002' }, ctx);
    expect(uno.ok).toBe(true);
    expect(uno.resumen).toContain('fuera del horario de envío');
    expect(uno.resumen).toContain('sale a las 9:00');
    const dia = await accion.ejecutar({}, ctx);
    expect(dia.resumen).toContain('salen a las 9:00');
    expect(dia.resumen).toContain('3 atascado(s)');
  });

  it('dos pedidos que encajan: pregunta cuál en vez de adivinar', async () => {
    const t = await tienda();
    await t.api.post('/admin/entregas/crear', { referencia: 'GSG-IA-009', telefono: '912000009', nombre: 'Ana Quispe', distrito: 'Lince' });
    const r = await ACCIONES_POR_NOMBRE.get('flujo.revisar')!.ejecutar({ cliente: 'Ana Quispe' }, contexto(t));
    expect(r.resumen).toContain('Hay 2 pedidos');
    expect(r.resumen).toContain('¿Cuál reviso?');
  });
});

describe('reportes', () => {
  it('el reporte de hoy: por estado, entregados, cancelados, por motorizado y mensajes', async () => {
    const t = await tienda();
    const ana = (await t.entrega('GSG-IA-001'))!;
    const carlos = (await t.api.get<{ motorizados: Json[] }>('/admin/motorizados')).body.motorizados.find((m) => m.nombre === 'Carlos Rojas')!;
    await t.api.post(`/admin/entregas/${ana.id}/sin-ubicacion`, { motorizadoId: carlos.id });
    await t.api.post(`/admin/entregas/${ana.id}/entregada`, {});
    const beto = (await t.entrega('GSG-IA-002'))!;
    await t.api.post(`/admin/entregas/${beto.id}/cancelar`, { motivo: 'el cliente ya no lo quiere' });

    const j = await ordenar(t.app, t.h, 'dame el reporte de hoy', t.dice(bloque({ accion: 'reportes.dia' }), 'Listo.'));
    const h = j.hechas[0];
    expect(h).toMatchObject({ accion: 'reportes.dia', tipo: 'consulta', ok: true });
    expect(h.resumen).toContain('3 pedido(s); 1 entregado(s)');
    expect(h.resumen).toContain('1 cancelado(s)');
    expect(h.resumen).toContain('Carlos Rojas 1 entregado(s)');
    expect(h.resumen).toContain('Mensajes:');
    const datos = t.ia.llamadas.at(-1)!.usuario;
    expect(datos).toContain('el cliente ya no lo quiere');
    expect(datos).toContain('porMotorizado');
  });

  it('un día pasado: solo hay mensajes, y lo dice', async () => {
    const t = await tienda();
    const r = await ACCIONES_POR_NOMBRE.get('reportes.dia')!.ejecutar({ dia: '2020-01-01' }, contexto(t));
    expect(r.ok).toBe(true);
    expect(r.resumen).toContain('solo lo tengo de hoy');
  });

  it('mandar el resumen al supervisor: tarjeta (solo lee) y el envío por la ruta de Ajustes al pulsar', async () => {
    const llamadas: Llamada[] = [];
    const ctx: ContextoAccion = {
      quien: 'Ali',
      esAdmin: true,
      llamar: async (l) => {
        llamadas.push(l);
        if (l.url === '/admin/resumenes') return { status: 200, json: { supervisor: '51999888777', ultimos: { manana: null, tarde: null }, conIA: false } };
        if (l.url === '/admin/entregas') return { status: 200, json: { dia: '2026-09-29', cifras: { total: 4, entregada: 2, faltaUbicacion: 1, incidencia: 0, cancelada: 1 }, entregas: [], motorizados: [], ajustes: {} } };
        if (l.url === '/admin/resumenes/mandar') return { status: 200, json: { ok: true, franja: 'tarde', texto: 'Así cerró el día: 2 entregados.', conIA: false } };
        return { status: 404, json: { error: 'no' } };
      },
    };
    const accion = ACCIONES_POR_NOMBRE.get('reportes.mandar')!;
    expect(accion.tipo).toBe('cambio');
    const pr = await prepararAccion(accion, { franja: 'tarde' }, ctx);
    expect(pr.tipo).toBe('listo');
    if (pr.tipo !== 'listo') return;
    expect(pr.tarjeta.que).toContain('de la tarde');
    expect(pr.tarjeta.aQuien).toContain('51 999 888 777');
    expect(pr.tarjeta.antes).toContain('4 pedido(s), 2 entregado(s)');
    expect(llamadas.every((l) => l.method === 'GET')).toBe(true);

    const r = await accion.ejecutar(pr.params, ctx);
    expect(r).toMatchObject({ ok: true, resumen: expect.stringContaining('mandado al supervisor') });
    expect(llamadas.at(-1)).toEqual({ method: 'POST', url: '/admin/resumenes/mandar', body: { franja: 'tarde' } });
  });

  it('sin número de supervisor no hay tarjeta: dice dónde ponerlo', async () => {
    const ctx: ContextoAccion = { quien: 'Ali', esAdmin: true, llamar: async () => ({ status: 200, json: { supervisor: '', ultimos: {} } }) };
    const pr = await prepararAccion(ACCIONES_POR_NOMBRE.get('reportes.mandar')!, {}, ctx);
    expect(pr).toMatchObject({ tipo: 'no', resumen: expect.stringContaining('supervisor') });
  });
});

describe('catálogo', () => {
  it('las tres acciones están, con su tipo, y se le cuentan al modelo', () => {
    const nombres = ACCIONES.map((a) => a.nombre);
    for (const n of ['flujo.revisar', 'reportes.dia', 'reportes.mandar']) expect(nombres).toContain(n);
    expect(new Set(nombres).size).toBe(nombres.length);
    expect(ACCIONES_POR_NOMBRE.get('flujo.revisar')!.tipo).toBe('consulta');
    expect(ACCIONES_POR_NOMBRE.get('reportes.dia')!.tipo).toBe('consulta');
    const cat = catalogoParaElModelo({ esAdmin: false, conCatalogo: false, sinVentas: true });
    expect(cat).toContain('flujo.revisar');
    expect(cat).toContain('reportes.mandar');
  });
});

/** Llama a las rutas del panel como la persona de la sesión (lo mismo que hace la IA). */
function contexto(t: EscenarioEntregas & { h: Record<string, string> }): ContextoAccion {
  return {
    quien: 'Ali',
    esAdmin: true,
    llamar: async (l) => {
      const r = await t.app.inject({ method: l.method, url: l.url, headers: t.h, ...(l.body === undefined ? {} : { payload: l.body as Record<string, unknown> }) });
      let json: unknown = null;
      try {
        json = r.json();
      } catch {
        json = r.body;
      }
      return { status: r.statusCode, json };
    },
  };
}
