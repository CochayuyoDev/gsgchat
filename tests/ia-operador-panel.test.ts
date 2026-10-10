/**
 * La IA operadora en las pantallas del panel de la tienda (28/09): «le mando
 * lo que sea y lo cumple».
 *
 * Decision del dueño que se prueba aqui: lo que solo lee se contesta al
 * momento; TODO lo que escribe o cambia algo vuelve preparado en una
 * tarjeta (que, a quien, cuantos, antes -> despues) y NO cambia nada hasta
 * pulsar «Hacerlo»; al pulsarlo cambia exactamente lo mismo que el boton de
 * la pantalla (misma ruta, mismos permisos, misma bitacora). Mas: permisos
 * por rol, otra tienda intacta, modo prueba respetado, orden multiple con
 * lo que sale y lo que no, y la ambiguedad resuelta con opciones.
 *
 * El modelo es un doble que contesta lo que la prueba le diga.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService } from '../src/settings/service.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { crearServicioIA } from '../src/ia/servicio.js';
import type { ProveedorIA } from '../src/ia/proveedores.js';
import { ACCIONES, prepararAccion } from '../src/ia/acciones.js';
import { horaHHMM } from '../src/ia/acciones-panel.js';
import { def } from '../src/ia/acciones-base.js';
import { createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos, type FakeWhatsApp } from './fakes.js';
import { z } from 'zod';

type Json = Record<string, any>;
const bloque = (...acciones: Array<Record<string, unknown>>) => `Listo, revisa la tarjeta.\n[ACCIONES]\n${acciones.map((a) => JSON.stringify(a)).join('\n')}\n[/ACCIONES]`;

/** Entra como una persona (cookie). La primera cuenta es administradora. */
async function sesion(app: FastifyInstance, rol: 'admin' | 'operador' = 'admin'): Promise<Record<string, string>> {
  const primera = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { usuario: 'ali', nombre: 'Ali', clave: 'ali-2026-wa' } });
  let cookie = (primera.headers['set-cookie'] as string | string[] | undefined) ?? '';
  if (!cookie || primera.statusCode >= 400) {
    const entrar = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ali', clave: 'ali-2026-wa' } });
    cookie = (entrar.headers['set-cookie'] as string | string[] | undefined) ?? '';
  }
  const galleta = (Array.isArray(cookie) ? (cookie[0] ?? '') : cookie).split(';')[0]!;
  if (rol === 'admin') return { cookie: galleta, 'content-type': 'application/json' };
  await app.inject({ method: 'POST', url: '/admin/usuarios', headers: { cookie: galleta, 'content-type': 'application/json' }, payload: { usuario: 'ope', nombre: 'Operadora', clave: 'ope-2026-wa', rol: 'operador' } });
  const entrar = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ope', clave: 'ope-2026-wa' } });
  const c = (entrar.headers['set-cookie'] as string | string[] | undefined) ?? '';
  return { cookie: (Array.isArray(c) ? (c[0] ?? '') : c).split(';')[0]!, 'content-type': 'application/json' };
}

async function ordenar(app: FastifyInstance, h: Record<string, string>, texto: string, empujar: () => void): Promise<Json> {
  empujar();
  const r = await app.inject({ method: 'POST', url: '/admin/ia/ordenes', headers: h, payload: { texto } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function hacer(app: FastifyInstance, h: Record<string, string>, pendientes: Json[], orden = ''): Promise<Json[]> {
  const r = await app.inject({ method: 'POST', url: '/admin/ia/ordenes/confirmar', headers: h, payload: { acciones: pendientes.map((p) => ({ accion: p.accion, ...p.parametros })), orden } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().hechas;
}

// ------------------------------------------------------------ con entregas (GSG)

const abiertos: Array<{ cerrar(): Promise<void> }> = [];
afterEach(async () => {
  while (abiertos.length) await abiertos.pop()!.cerrar();
});

async function tienda(opciones: Parameters<typeof crearEscenarioEntregas>[0] = {}): Promise<EscenarioEntregas & { h: Record<string, string>; op: () => Promise<Record<string, string>>; dice: (...r: string[]) => () => void }> {
  const esc = await crearEscenarioEntregas({ agente: true, ...opciones });
  abiertos.push(esc);
  await esc.asistente!.guardar({ token: 'tok' });
  const h = await sesion(esc.app);
  for (const [telefono, nombre] of [['999000001', 'Carlos Rojas'], ['999000002', 'Ali Torres'], ['999000003', 'Diego Ruiz']] as const) {
    const r = await esc.api.post('/admin/motorizados', { telefono, nombre });
    expect(r.status).toBe(200);
  }
  const pedidos: Array<[string, string, string, string]> = [
    ['GSG-IA-001', '912000001', 'Ana Quispe', 'Lince'],
    ['GSG-IA-002', '912000002', 'Beto Salas', 'Miraflores'],
    ['GSG-IA-003', '912000003', 'Carla Díaz', 'Surco'],
    ['GSG-IA-004', '912000004', 'Dora Ruiz', 'Jesús María'],
  ];
  for (const [referencia, telefono, nombre, distrito] of pedidos) {
    const r = await esc.api.post('/admin/entregas/crear', { referencia, telefono, nombre, direccion: `Av. Siempre Viva ${telefono.slice(-3)}`, distrito });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
  return Object.assign(esc, { h, op: () => sesion(esc.app, 'operador'), dice: (...r: string[]) => () => esc.ia.respuestas.push(...r) });
}

describe('pedidos de hoy: tarjeta primero, «Hacerlo» después, lo mismo que la pantalla', () => {
  it('«asígnale el pedido GSG-IA-001 a Carlos»: sin Hacerlo no cambia nada; con Hacerlo, igual que el botón de Hoy, y a la bitácora', async () => {
    const t = await tienda();
    const enviados = t.wa.sent.length;
    const j = await ordenar(t.app, t.h, 'asígnale el pedido GSG-IA-001 a Carlos', t.dice(bloque({ accion: 'entregas.reasignar', cliente: 'GSG-IA-001', motorizado: 'Carlos' })));
    expect(j.hechas).toEqual([]);
    expect(j.elegir).toEqual([]);
    expect(j.pendientes).toHaveLength(1);
    const p = j.pendientes[0];
    expect(p.tarjeta).toMatchObject({ que: 'Asignar el pedido GSG-IA-001 a Carlos Rojas', antes: 'sin motorizado' });
    expect(p.tarjeta.aQuien).toContain('Ana Quispe');
    expect(p.tarjeta.avisos.join(' ')).toContain('Todavía no tiene ubicación');
    // Sin «Hacerlo»: nada cambió ni salió nada.
    expect((await t.entrega('GSG-IA-001'))!.motorizado).toBeNull();
    expect(t.wa.sent.length).toBe(enviados);

    const hechas = await hacer(t.app, t.h, j.pendientes, 'asígnale el pedido GSG-IA-001 a Carlos');
    expect(hechas[0]).toMatchObject({ accion: 'entregas.reasignar', ok: true });
    const ia = (await t.entrega('GSG-IA-001'))!;
    expect(ia.motorizado?.nombre).toBe('Carlos Rojas');

    // Lo mismo, a mano desde la pantalla, con otro pedido: el mismo resultado.
    const beto = (await t.entrega('GSG-IA-002'))!;
    const carlos = (await t.api.get<{ motorizados: Json[] }>('/admin/motorizados')).body.motorizados.find((m) => m.nombre === 'Carlos Rojas')!;
    expect((await t.api.post(`/admin/entregas/${beto.id}/sin-ubicacion`, { motorizadoId: carlos.id })).status).toBe(200);
    const pantalla = (await t.entrega('GSG-IA-002'))!;
    expect({ estado: ia.estado, motorizadoEstado: ia.motorizadoEstado, motorizado: ia.motorizado?.id }).toEqual({ estado: pantalla.estado, motorizadoEstado: pantalla.motorizadoEstado, motorizado: pantalla.motorizado?.id });

    // Bitácora: la ruta, con «(por la IA)», y quién pulsó «Hacerlo».
    expect(t.repos._actividad.find((e) => e.accion === 'entrega.motorizado' && e.usuario.includes('(por la IA)'))).toBeTruthy();
    expect(t.repos._actividad.find((e) => e.accion === 'ia.hecho')).toMatchObject({ usuario: 'Ali', detalle: expect.objectContaining({ bien: 1, mal: 0 }) });
  });

  it('ubicación, entregado y cancelar: antes → después en la tarjeta y el cambio real al pulsar', async () => {
    const t = await tienda();
    const j = await ordenar(
      t.app,
      t.h,
      'ponle la ubicación -12.05,-77.03 al pedido GSG-IA-002, marca como entregado el GSG-IA-003 y cancela el GSG-IA-004 porque el cliente no quiere',
      t.dice(bloque({ accion: 'entregas.ubicacion', cliente: 'GSG-IA-002', coordenadas: '-12.05,-77.03' }, { accion: 'entregas.entregada', cliente: 'GSG-IA-003' }, { accion: 'entregas.cancelar', cliente: 'GSG-IA-004', motivo: 'el cliente no quiere' })),
    );
    expect(j.pendientes.map((p: Json) => p.accion)).toEqual(['entregas.ubicacion', 'entregas.entregada', 'entregas.cancelar']);
    expect(j.pendientes[0].tarjeta).toMatchObject({ antes: 'sin ubicación', despues: expect.stringContaining('-12.05, -77.03') });
    expect(j.pendientes[1].tarjeta).toMatchObject({ antes: 'esperando su ubicación', despues: expect.stringContaining('entregada') });
    expect(j.pendientes[2].tarjeta).toMatchObject({ que: 'Cancelar el pedido GSG-IA-004', despues: expect.stringContaining('GSG se entera') });
    expect(j.pendientes[2].tarjeta.avisos.join(' ')).toContain('el cliente no quiere');
    expect((await t.entrega('GSG-IA-002'))!.lat).toBeNull();
    expect((await t.entrega('GSG-IA-004'))!.estado).not.toBe('cancelada');

    const hechas = await hacer(t.app, t.h, j.pendientes);
    expect(hechas.map((x) => x.ok)).toEqual([true, true, true]);
    expect((await t.entrega('GSG-IA-002'))!).toMatchObject({ lat: -12.05, lng: -77.03 });
    expect((await t.entrega('GSG-IA-003'))!.estado).toBe('entregada');
    expect((await t.entrega('GSG-IA-004'))!.estado).toBe('cancelada');
    // Lo que ya está hecho no se vuelve a proponer: se dice.
    const otra = await ordenar(t.app, t.h, 'cancela el GSG-IA-004', t.dice(bloque({ accion: 'entregas.cancelar', cliente: 'GSG-IA-004' }), 'Ya estaba cancelado.'));
    expect(otra.pendientes).toEqual([]);
    expect(otra.hechas[0]).toMatchObject({ ok: false, resumen: 'GSG-IA-004 ya está cancelado.' });
  });

  it('orden múltiple: una tarjeta, un solo Hacerlo, en orden; dice cuáles salieron y cuáles no y por qué', async () => {
    const t = await tienda();
    const j = await ordenar(t.app, t.h, 'pasa a descanso al motorizado Ali y asígnale el GSG-IA-003 a Ali', t.dice(bloque({ accion: 'motorizados.estado', motorizado: 'Ali', estado: 'descanso' }, { accion: 'entregas.reasignar', cliente: 'GSG-IA-003', motorizado: 'Ali' })));
    expect(j.pendientes).toHaveLength(2);
    expect(j.pendientes[0].tarjeta).toMatchObject({ que: 'Poner a Ali Torres en descanso', antes: 'activo', despues: 'en descanso' });
    const hechas = await hacer(t.app, t.h, j.pendientes);
    expect(hechas[0]).toMatchObject({ accion: 'motorizados.estado', ok: true, resumen: 'Ali Torres queda en descanso.' });
    // El segundo ya no se puede: Ali quedó en descanso. Se dice por qué, en palabras.
    expect(hechas[1]).toMatchObject({ accion: 'entregas.reasignar', ok: false });
    expect(hechas[1]!.resumen).toMatch(/descanso/);
    expect((await t.entrega('GSG-IA-003'))!.motorizado).toBeNull();
    const ali = (await t.api.get<{ motorizados: Json[] }>('/admin/motorizados')).body.motorizados.find((m) => m.nombre === 'Ali Torres')!;
    expect(ali.estado).toBe('descanso');
    expect(t.repos._actividad.find((e) => e.accion === 'ia.hecho')!.detalle).toMatchObject({ bien: 1, mal: 1 });
  });

  it('ambigüedad: dos Carlos → opciones con botones (no adivina); elegir prepara la tarjeta del elegido', async () => {
    const t = await tienda();
    await t.api.post('/admin/motorizados', { telefono: '999000009', nombre: 'Carlos Mendoza' });
    const j = await ordenar(t.app, t.h, 'asígnale el GSG-IA-002 a Carlos', t.dice(bloque({ accion: 'entregas.reasignar', cliente: 'GSG-IA-002', motorizado: 'Carlos' })));
    expect(j.pendientes).toEqual([]);
    expect(j.elegir).toHaveLength(1);
    expect(j.elegir[0].pregunta).toContain('Hay 2 motorizados que coinciden con "Carlos"');
    const etiquetas = j.elegir[0].opciones.map((o: Json) => o.etiqueta).join(' | ');
    expect(etiquetas).toContain('Carlos Rojas');
    expect(etiquetas).toContain('Carlos Mendoza');
    const mendoza = j.elegir[0].opciones.find((o: Json) => o.etiqueta.includes('Mendoza'));
    const prep = await t.app.inject({ method: 'POST', url: '/admin/ia/ordenes/preparar', headers: t.h, payload: { accion: { accion: j.elegir[0].accion, ...mendoza.parametros } } });
    expect(prep.statusCode).toBe(200);
    expect(prep.json().pendiente.tarjeta.que).toBe('Asignar el pedido GSG-IA-002 a Carlos Mendoza');
    // Preparar no cambió nada.
    expect((await t.entrega('GSG-IA-002'))!.motorizado).toBeNull();
    const hechas = await hacer(t.app, t.h, [prep.json().pendiente]);
    expect(hechas[0]!.ok).toBe(true);
    expect((await t.entrega('GSG-IA-002'))!.motorizado?.nombre).toBe('Carlos Mendoza');

    // Y dos pedidos del mismo cliente: se pregunta cuál.
    await t.api.post('/admin/entregas/crear', { referencia: 'GSG-IA-009', telefono: '912000001', nombre: 'Ana Quispe', direccion: 'Jr. Otro 1', distrito: 'Lince' });
    const k = await ordenar(t.app, t.h, 'marca urgente el pedido de Ana Quispe', t.dice(bloque({ accion: 'entregas.urgente', cliente: 'Ana Quispe' })));
    expect(k.elegir[0].opciones.map((o: Json) => o.etiqueta.split(' · ')[0]).sort()).toEqual(['GSG-IA-001', 'GSG-IA-009']);
  });

  it('las consultas se hacen al momento: pedidos sin ubicación, cuántos entregó Carlos, qué pasó con un pedido', async () => {
    const t = await tienda();
    const sin = await ordenar(t.app, t.h, 'dame los pedidos sin ubicación', t.dice(bloque({ accion: 'entregas.sinUbicacion' }), 'Son 4.'));
    expect(sin.hechas[0]).toMatchObject({ accion: 'entregas.sinUbicacion', tipo: 'consulta', ok: true });
    expect(sin.hechas[0]!.resumen).toContain('4 pedido(s) sin ubicación');
    expect(sin.pendientes).toEqual([]);
    // Carlos entrega uno (desde la pantalla) y se le pregunta a la IA.
    const ana = (await t.entrega('GSG-IA-001'))!;
    const carlos = (await t.api.get<{ motorizados: Json[] }>('/admin/motorizados')).body.motorizados.find((m) => m.nombre === 'Carlos Rojas')!;
    await t.api.post(`/admin/entregas/${ana.id}/sin-ubicacion`, { motorizadoId: carlos.id });
    await t.api.post(`/admin/entregas/${ana.id}/entregada`, {});
    const cuantos = await ordenar(t.app, t.h, '¿cuántos entregó Carlos hoy?', t.dice(bloque({ accion: 'motorizados.hoy', motorizado: 'Carlos' }), 'Uno.'));
    expect(cuantos.hechas[0]!.resumen).toBe('Carlos Rojas entregó hoy 1 pedido(s) (GSG-IA-001) y lleva 0 todavía.');
    const que = await ordenar(t.app, t.h, '¿qué pasó con el pedido GSG-IA-001?', t.dice(bloque({ accion: 'entregas.detalle', cliente: 'GSG-IA-001' }), 'Se entregó.'));
    expect(que.hechas[0]!.resumen).toContain('GSG-IA-001 · Ana Quispe (Lince), entregada');
    // Los datos (la bitácora del pedido) volvieron al modelo para que conteste con ellos.
    const ultimo = t.ia.llamadas.at(-1)!.usuario;
    expect(ultimo).toContain('[RESULTADOS]');
    expect(ultimo).toContain('bitacora');
  });
});

describe('ajustes, textos, números del día y respuestas rápidas', () => {
  it('«cambia el horario de entrega a 3 PM - 9 PM y sube el margen a 45 minutos»: antes → después; nada cambia hasta Hacerlo', async () => {
    const t = await tienda();
    const j = await ordenar(t.app, t.h, 'cambia el horario de entrega a 3 PM - 9 PM y sube el margen a 45 minutos', t.dice(bloque({ accion: 'entregas.ajustes', horario: { desde: '3 PM', hasta: '9 PM' }, margenMinutos: 45 })));
    const tj = j.pendientes[0].tarjeta;
    expect(tj.antes).toContain('Margen que se suma a lo que dice el motorizado: 60 min');
    expect(tj.despues).toContain('Margen que se suma a lo que dice el motorizado: 45 min');
    expect(tj.antes).toContain('de 2:00 p. m. a 8:00 p. m.');
    expect(tj.despues).toContain('de 3:00 p. m. a 9:00 p. m.');
    expect(t.entregas.ajustes().margenMinutos).toBe(60);
    const hechas = await hacer(t.app, t.h, j.pendientes);
    expect(hechas[0]!.ok).toBe(true);
    expect(t.entregas.ajustes()).toMatchObject({ margenMinutos: 45, horarioEntregas: { desde: '15:00', hasta: '21:00', extendidoHasta: '22:00' } });
  });

  it('«cambia el texto de ubicación registrada por …»: enseña el de ahora y avisa de las variables que se pierden', async () => {
    const t = await tienda();
    const nuevo = 'Listo {nombre}, ya tenemos tu ubicación. Te escribe el motorizado.';
    const j = await ordenar(t.app, t.h, `cambia el texto de ubicación registrada por "${nuevo}"`, t.dice(bloque({ accion: 'entregas.texto', clave: 'ubicacionRegistrada', texto: nuevo })));
    const tj = j.pendientes[0].tarjeta;
    expect(tj.antes).toContain('Ubicación registrada correctamente');
    expect(tj.despues).toBe(nuevo);
    expect(tj.avisos.join(' ')).toContain('{mapa}');
    expect(t.entregas.ajustes().textos.ubicacionRegistrada).toBe('');
    await hacer(t.app, t.h, j.pendientes);
    expect(t.entregas.ajustes().textos.ubicacionRegistrada).toBe(nuevo);
  });

  it('permisos por rol: un operador puede cancelar un pedido (su pantalla lo deja) pero no tocar los ajustes; se le dice a quién pedírselo', async () => {
    const t = await tienda();
    const ope = await t.op();
    const aj = await ordenar(t.app, ope, 'sube el margen a 45 minutos', t.dice(bloque({ accion: 'entregas.ajustes', margenMinutos: 45 }), 'Eso lo cambia un administrador.'));
    expect(aj.pendientes).toEqual([]);
    expect(aj.hechas[0]).toMatchObject({ accion: 'entregas.ajustes', ok: false, resumen: expect.stringContaining('Pídeselo a un administrador') });
    // El catálogo que vio el modelo ni se lo ofrecía.
    expect(t.ia.llamadas.at(-2)!.sistema).not.toContain('- entregas.ajustes [');
    // Ni armando la confirmación a mano.
    const forzado = await hacer(t.app, ope, [{ accion: 'entregas.ajustes', parametros: { margenMinutos: 45 } }]);
    expect(forzado[0]).toMatchObject({ ok: false, resumen: expect.stringContaining('administrador') });
    expect(t.entregas.ajustes().margenMinutos).toBe(60);
    // Lo que sí puede, lo hace (con su nombre en la bitácora).
    const c = await ordenar(t.app, ope, 'cancela el GSG-IA-004', t.dice(bloque({ accion: 'entregas.cancelar', cliente: 'GSG-IA-004', motivo: 'no lo quiere' })));
    const hechas = await hacer(t.app, ope, c.pendientes);
    expect(hechas[0]!.ok).toBe(true);
    expect((await t.entrega('GSG-IA-004'))!.estado).toBe('cancelada');
    expect(t.repos._actividad.find((e) => e.accion === 'entrega.cancelar')!.usuario).toBe('Operadora (por la IA)');
  });

  it('«confirma el envío de todos los números del día»: la tarjeta dice cuántos; Hacerlo los suelta como el botón', async () => {
    const t = await tienda({ confirmarLista: true });
    t.simulador.cargar([
      { referencia: 'GSG-N-1', telefono: '51911000001', nombre: 'Uno', faltaUbicacion: true },
      { referencia: 'GSG-N-2', telefono: '51911000002', nombre: 'Dos', faltaUbicacion: true },
      { referencia: 'GSG-N-3', telefono: '51911000003', nombre: 'Tres', faltaUbicacion: false, faltaConfirmacion: true },
    ] as never);
    expect((await t.gsgManda()).body.ok).toBe(true);
    const porConfirmar = async () => (await t.api.get<{ numeros: Json[] }>('/admin/entregas/numeros')).body.numeros.filter((n) => n.porConfirmar).length;
    expect(await porConfirmar()).toBe(3);
    const j = await ordenar(t.app, t.h, 'confirma el envío de todos los números del día', t.dice(bloque({ accion: 'numeros.confirmarEnvio', todos: true })));
    expect(j.pendientes[0].tarjeta).toMatchObject({ que: 'Confirmar y enviar 3 número(s) del día', cuantos: 3 });
    expect(j.pendientes[0].tarjeta.despues).toContain('2 recibirán el pedido de ubicación y 1 la pregunta SÍ/NO');
    expect(j.pendientes[0].parametros.ids).toHaveLength(3);
    expect(await porConfirmar()).toBe(3);
    const hechas = await hacer(t.app, t.h, j.pendientes);
    expect(hechas[0]!.ok).toBe(true);
    expect(await porConfirmar()).toBe(0);
  });

  it('«crea una respuesta rápida /envio con …» (solo admin) y «manda la ruta a Carlos»', async () => {
    const t = await tienda();
    const j = await ordenar(t.app, t.h, 'crea una respuesta rápida /envio con "El envío a Lima cuesta S/ 10"', t.dice(bloque({ accion: 'respuestas.guardar', atajo: '/envio', texto: 'El envío a Lima cuesta S/ 10' })));
    expect(j.pendientes[0].tarjeta).toMatchObject({ que: 'Crear la respuesta rápida /envio', antes: 'no existe', despues: 'El envío a Lima cuesta S/ 10' });
    await hacer(t.app, t.h, j.pendientes);
    const atajos = (await t.app.inject({ method: 'GET', url: '/admin/chat/atajos', headers: t.h })).json().atajos as Json[];
    expect(atajos.find((a) => a.atajo === 'envio')?.texto).toBe('El envío a Lima cuesta S/ 10');
    expect(atajos.length).toBeGreaterThan(1);

    // La ruta: Carlos lleva un pedido con pin (hecho desde la pantalla).
    const beto = (await t.entrega('GSG-IA-002'))!;
    await t.api.post(`/admin/entregas/${beto.id}/ubicacion`, { lat: -12.1211, lng: -77.0301 });
    await t.api.post(`/admin/entregas/${beto.id}/confirmar`, { confirmada: true });
    const carlos = (await t.api.get<{ motorizados: Json[] }>('/admin/motorizados')).body.motorizados.find((m) => m.nombre === 'Carlos Rojas')!;
    await t.api.post(`/admin/entregas/${beto.id}/reasignar`, { motorizadoId: carlos.id });
    const enviadosACarlos = () => t.textosA('999000001').length;
    const antes = enviadosACarlos();
    const r = await ordenar(t.app, t.h, 'manda la ruta a Carlos', t.dice(bloque({ accion: 'motorizados.mandarRuta', motorizado: 'Carlos' })));
    expect(r.pendientes[0].tarjeta.mensaje).toContain('GSG-IA-002');
    expect(enviadosACarlos()).toBe(antes);
    const hechas = await hacer(t.app, t.h, r.pendientes);
    expect(hechas[0]).toMatchObject({ ok: true });
    expect(enviadosACarlos()).toBe(antes + 1);
  });

  it('con «Solo lo de GSG» las campañas no se ofrecen ni se hacen: lo dice y ofrece parar todos los envíos', async () => {
    const t = await tienda();
    const j = await ordenar(t.app, t.h, 'pausa las campañas', t.dice(bloque({ accion: 'campanas.todas', accionCampana: 'pausar' }), 'En este modo no hay campañas.'));
    expect(j.pendientes).toEqual([]);
    expect(j.hechas[0]!.resumen).toContain('Solo lo de GSG');
  });
});

describe('otra tienda intacta', () => {
  it('lo que se hace en una tienda no toca la otra, ni con los datos de la primera', async () => {
    const a = await tienda();
    const b = await tienda();
    const j = await ordenar(a.app, a.h, 'asígnale el pedido GSG-IA-001 a Carlos', a.dice(bloque({ accion: 'entregas.reasignar', cliente: 'GSG-IA-001', motorizado: 'Carlos' })));
    await hacer(a.app, a.h, j.pendientes);
    expect((await a.entrega('GSG-IA-001'))!.motorizado?.nombre).toBe('Carlos Rojas');
    expect((await b.entrega('GSG-IA-001'))!.motorizado).toBeNull();
    // La tarjeta de A llevada a B (con el pedido y el motorizado de A): no encuentra nada suyo que tocar.
    const cruzada = await hacer(b.app, b.h, j.pendientes);
    expect(cruzada[0]!.ok).toBe(false);
    expect(cruzada[0]!.resumen).toMatch(/ya no está|ya no existe/);
    expect((await b.entrega('GSG-IA-001'))!.motorizado).toBeNull();
    // Y la sesión de A no abre B.
    const conSesionDeA = await b.app.inject({ method: 'POST', url: '/admin/ia/ordenes/confirmar', headers: { cookie: 'wa_sesion=inventada', 'content-type': 'application/json' }, payload: { acciones: [{ accion: 'entregas.cancelar', cliente: 'GSG-IA-001' }] } });
    expect(conSesionDeA.statusCode).toBe(401);
  });
});

// ---------------------------------------------------- chats, mensajes y modo prueba

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'none',
  BUSINESS_NAME: 'Zapateria Lima',
  RUTAS_PAIS: 'peru',
  RUTAS_HORA_INICIO: '0',
  RUTAS_HORA_FIN: '24',
} as NodeJS.ProcessEnv;
const cola: OutboundQueue = {
  async enqueue() {},
  async enqueueMany(jobs) {
    return jobs.length;
  },
  async pause() {},
  async resume() {},
  async counts() {
    return {};
  },
  async close() {},
};

async function tiendaDeChats(): Promise<{ app: FastifyInstance; repos: FakeRepos; wa: FakeWhatsApp; h: Record<string, string>; dice: (...r: string[]) => () => void; soloNumeros: () => string[]; cerrar(): Promise<void> }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ia-panel-'));
  const config = { ...loadConfig(ENV), ARCHIVE_DIR: dir };
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const settingsRepo = createMemorySettingsRepo();
  const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
  await settings.save({ provider: 'local' });
  const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
  // Como en produccion: el modo prueba lo aplica el sender, no la IA.
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 500, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false, soloNumeros: () => ajustes.soloNumeros() });
  const respuestas: string[] = [];
  const proveedor: ProveedorIA = { nombre: 'falso', async chat() { return respuestas.shift() ?? 'No sé.'; } };
  const ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Zapateria Lima', proveedor, modelosGratis: ['google/gemma-4-31b-it'] });
  await ia.guardar({ token: 'tok' });
  const app = await buildServer({ config, repos, settings, wa, sender, queue: cola, logger: false, ia, ajustes });
  await app.ready();
  const h = await sesion(app);
  const t = { app, repos, wa, h, dice: (...r: string[]) => () => respuestas.push(...r), soloNumeros: () => ajustes.soloNumeros(), async cerrar() { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
  abiertos.push(t);
  return t;
}

describe('chats, mensajes a clientes y modo prueba', () => {
  it('«cierra el chat de Luis», «apaga el bot en el chat de 912426667» y «mándale a 51912426667: ya salió tu pedido»: una tarjeta, un Hacerlo', async () => {
    const t = await tiendaDeChats();
    const luis = await t.repos.contacts.upsertFromInbound('51913000111', 'Luis Huamán');
    await t.repos.messages.add({ contactId: luis.id, direction: 'in', wamid: 'l1', kind: 'text', body: 'hola, ¿y mi pedido?', payload: null, createdAt: new Date() });
    const otro = await t.repos.contacts.upsertFromInbound('51912426667', 'Rosa');
    await t.repos.messages.add({ contactId: otro.id, direction: 'in', wamid: 'r1', kind: 'text', body: 'buenas', payload: null, createdAt: new Date() });
    const j = await ordenar(
      t.app,
      t.h,
      'cierra el chat de Luis, apaga el bot en el chat de 912426667 y mándale a 51912426667: ya salió tu pedido',
      t.dice(bloque({ accion: 'chat.cerrar', telefono: 'Luis' }, { accion: 'chat.atenderPersona', telefono: '912426667', pausar: true }, { accion: 'mensaje.enviar', telefono: '51912426667', texto: 'ya salió tu pedido' })),
    );
    expect(j.pendientes.map((p: Json) => p.tarjeta.que)).toEqual(['Cerrar el chat de Luis Huamán', 'Apagar el bot en el chat de Rosa', 'Mandar un WhatsApp a 51 912 426 667']);
    expect(j.pendientes[1].tarjeta).toMatchObject({ antes: 'el bot contesta solo', despues: expect.stringContaining('bot apagado') });
    expect(j.pendientes[2].tarjeta.mensaje).toBe('ya salió tu pedido');
    // Nada todavía.
    expect(t.wa.sent.filter((s) => s.kind === 'text')).toEqual([]);
    expect((await t.repos.contacts.getById(otro.id))!.botPausadoAt ?? null).toBeNull();
    expect(await t.repos.archives.count({ contactId: luis.id })).toBe(0);

    const hechas = await hacer(t.app, t.h, j.pendientes);
    expect(hechas.map((x) => x.ok)).toEqual([true, true, true]);
    expect(await t.repos.archives.count({ contactId: luis.id })).toBe(1);
    expect((await t.repos.contacts.getById(otro.id))!.botPausadoAt).toBeTruthy();
    expect(t.wa.sent.find((s) => s.kind === 'text')).toMatchObject({ to: '51912426667', body: 'ya salió tu pedido' });
  });

  it('modo prueba: «activa el modo prueba solo con mi número» pide el número si no lo hay; activo, un mensaje a otro número se ve frenado en la tarjeta y NO sale', async () => {
    const t = await tiendaDeChats();
    const sin = await ordenar(t.app, t.h, 'activa el modo prueba solo con mi número', t.dice(bloque({ accion: 'ajustes.modoPrueba', activo: true }), '¿Con qué número?'));
    expect(sin.hechas[0]).toMatchObject({ ok: false, resumen: expect.stringContaining('¿Con qué número?') });
    const j = await ordenar(t.app, t.h, 'activa el modo prueba solo con el 999111222', t.dice(bloque({ accion: 'ajustes.modoPrueba', activo: true, numeros: ['999111222'] })));
    expect(j.pendientes[0].tarjeta).toMatchObject({ que: 'Activar el modo prueba', antes: 'apagado: se escribe a todos', despues: 'activo: solo se escribe a 51 999 111 222' });
    expect(t.soloNumeros()).toEqual([]);
    await hacer(t.app, t.h, j.pendientes);
    expect(t.soloNumeros()).toEqual(['51999111222']);

    const m = await ordenar(t.app, t.h, 'mándale a 51912426667: ya salió tu pedido', t.dice(bloque({ accion: 'mensaje.enviar', telefono: '51912426667', texto: 'ya salió tu pedido' })));
    expect(m.pendientes[0].tarjeta.avisos.join(' ')).toContain('Modo prueba activo');
    expect(m.pendientes[0].tarjeta.avisos.join(' ')).toContain('NO le saldrá');
    const hechas = await hacer(t.app, t.h, m.pendientes);
    expect(hechas[0]).toMatchObject({ ok: false, resumen: expect.stringContaining('No salió') });
    expect(t.wa.sent.filter((s) => s.to === '51912426667')).toEqual([]);
    // Al número de prueba, sí.
    const ok = await ordenar(t.app, t.h, 'mándale al 999111222: prueba', t.dice(bloque({ accion: 'mensaje.enviar', telefono: '999111222', texto: 'prueba' })));
    expect((await hacer(t.app, t.h, ok.pendientes))[0]!.ok).toBe(true);
    expect(t.wa.sent.find((s) => s.to === '51999111222')).toMatchObject({ body: 'prueba' });
  });

  it('«pausa las campañas» (modo completo) y «programa un mensaje»: tarjeta con cuántos; Hacerlo cambia lo mismo que la pantalla', async () => {
    const t = await tiendaDeChats();
    await t.repos.contacts.upsertFromInbound('51987654321', 'Juan');
    await t.repos.contacts.setOptIn('51987654321', 'x');
    const envio = await t.app.inject({ method: 'POST', url: '/admin/grupos/enviar', headers: t.h, payload: { criterio: { consentimiento: 'opt_in' }, texto: 'Hola {nombre}, tenemos novedades.' } });
    expect(envio.statusCode, envio.body).toBe(200);
    const estados = () => [...t.repos._campaigns.values()].map((c) => c.status);
    expect(estados().some((s) => s === 'running' || s === 'canary')).toBe(true);
    const j = await ordenar(t.app, t.h, 'pausa las campañas', t.dice(bloque({ accion: 'campanas.todas', accionCampana: 'pausar' })));
    expect(j.pendientes[0].tarjeta).toMatchObject({ que: 'Pausar 1 campaña(s)', cuantos: 1 });
    expect(estados()).not.toContain('paused');
    await hacer(t.app, t.h, j.pendientes);
    expect(estados()).toEqual(['paused']);

    const manana = new Date(Date.now() + 26 * 3600_000);
    const cuando = `${manana.getFullYear()}-${String(manana.getMonth() + 1).padStart(2, '0')}-${String(manana.getDate()).padStart(2, '0')} 10:00`;
    const p = await ordenar(t.app, t.h, 'programa para mañana a las 10 a 987654321: te visitamos hoy', t.dice(bloque({ accion: 'mensaje.programar', telefono: '987654321', cuando, texto: 'Te visitamos hoy.' })));
    expect(p.pendientes[0].tarjeta).toMatchObject({ cuantos: 1, mensaje: 'Te visitamos hoy.' });
    expect(p.pendientes[0].tarjeta.que).toContain('Programar un WhatsApp para el');
    expect(t.repos.automation._scheduled.size).toBe(0);
    const hechas = await hacer(t.app, t.h, p.pendientes);
    expect(hechas[0]!.ok).toBe(true);
    expect([...t.repos.automation._scheduled.values()][0]).toMatchObject({ text: 'Te visitamos hoy.', kind: 'freeform' });
  });
});

describe('piezas', () => {
  it('preparar SOLO lee: una tarjeta que intenta escribir se corta y se dice', async () => {
    const tramposa = def({ nombre: 'x.trampa', tipo: 'cambio', descripcion: 'Trampa.', parametros: '', ejemplo: { orden: '', accion: {} }, schema: z.object({}), async preparar(_p, ctx) { await ctx.llamar({ method: 'POST', url: '/admin/entregas/1/cancelar', body: {} }); return { tipo: 'listo', params: {}, tarjeta: { que: 'x' } }; }, async ejecutar() { return { ok: true, resumen: '' }; } });
    const llamadas: string[] = [];
    const r = await prepararAccion(tramposa, {}, { quien: 'ali', esAdmin: true, llamar: async (l) => { llamadas.push(`${l.method} ${l.url}`); return { status: 200, json: {} }; } });
    expect(r).toMatchObject({ tipo: 'no', resumen: expect.stringContaining('al preparar solo se lee') });
    expect(llamadas).toEqual([]);
  });

  it('las horas como las dice la gente', () => {
    expect(horaHHMM('3 PM')).toBe('15:00');
    expect(horaHHMM('9 pm')).toBe('21:00');
    expect(horaHHMM('3:30 p. m.')).toBe('15:30');
    expect(horaHHMM('15:00')).toBe('15:00');
    expect(horaHHMM('12 am')).toBe('00:00');
    expect(horaHHMM('25:00')).toBeNull();
  });

  it('todo cambio del catálogo es «Hacerlo» y lo nuevo está: las acciones del dueño existen', () => {
    const nombres = ACCIONES.map((a) => a.nombre);
    for (const n of ['entregas.reasignar', 'entregas.ubicacion', 'entregas.entregada', 'entregas.cancelar', 'entregas.ajustes', 'entregas.texto', 'entregas.detalle', 'entregas.sinUbicacion', 'numeros.confirmarEnvio', 'numeros.masa', 'motorizados.estado', 'motorizados.mandarRuta', 'motorizados.hoy', 'chat.cerrar', 'chat.atenderPersona', 'mensaje.enviar', 'mensaje.programar', 'ajustes.modoPrueba', 'respuestas.guardar', 'campanas.todas']) expect(nombres).toContain(n);
    expect(new Set(nombres).size).toBe(nombres.length);
    // Lo de cuentas, claves y conexión sigue fuera, a propósito.
    expect(nombres.some((n) => /usuario|clave|password|contrasena|conexion|tienda/i.test(n))).toBe(false);
    for (const a of ACCIONES.filter((x) => ['entregas.ajustes', 'entregas.texto', 'ajustes.modoPrueba', 'respuestas.guardar', 'respuestas.quitar', 'entregas.cerrarDia', 'configuracion.cambiar'].includes(x.nombre))) expect(a.soloAdmin, a.nombre).toBe(true);
  });
});
