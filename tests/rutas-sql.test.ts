/**
 * El SQL del modulo de rutas, contra MySQL/MariaDB de verdad (tests/mysql.ts).
 *
 * Los dobles en memoria prueban las decisiones; esto prueba las consultas: las
 * cifras por lote sobre cero filas, el orden de la cola -que es lo que decide
 * a quien le toca- y que los filtros de la bandeja devuelven lo que dicen.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { createRepos, type Repos } from '../src/db/repos.js';
import { ESTADOS_SIN_UBICACION } from '../src/db/rutas.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

let b: BaseDePrueba;
let pool: Pool;
let repos: Repos;

beforeAll(async () => {
  b = await baseDePrueba();
  pool = b.pool;
  repos = createRepos(pool);
});

afterAll(async () => {
  await b?.cerrar();
});

beforeEach(async () => {
  for (const tabla of ['rutas_reportes', 'rutas_eventos', 'rutas_solicitudes', 'rutas_lotes']) {
    await pool.query(`delete from ${tabla}`);
  }
});

describe('lotes y solicitudes', () => {
  it('un lote recien creado cuenta cero sin romperse', async () => {
    await repos.rutas.crearLote({ nombre: 'Vacio' });
    const [lote] = await repos.rutas.listarLotes(10, 0);
    expect(lote).toMatchObject({ nombre: 'Vacio', total: 0, cifras: {} });
  });

  it('guarda las solicitudes con su incidencia y las cuenta por estado', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '987654321', phone: '51987654321', referencia: 'P-1' },
      {
        telefonoCrudo: '98765432',
        phone: null,
        referencia: 'P-2',
        estado: 'incidencia',
        incidencia: 'numero_corto',
        incidenciaDetalle: 'falta 1 digito',
        requiereHumano: true,
      },
    ]);

    expect(await repos.rutas.cifrasPorEstado(lote.id)).toEqual({ pendiente: 1, incidencia: 1 });
    expect(await repos.rutas.cifrasPorIncidencia(lote.id)).toEqual({ numero_corto: 1 });

    const [conCifras] = await repos.rutas.listarLotes(10, 0);
    expect(conCifras?.total).toBe(2);
    expect(conCifras?.cifras).toMatchObject({ pendiente: 1, incidencia: 1 });
  });

  it('la cola solo saca lo de los lotes en marcha y en orden de espera', async () => {
    const parado = await repos.rutas.crearLote({ nombre: 'Parado' });
    const enMarcha = await repos.rutas.crearLote({ nombre: 'En marcha' });
    await repos.rutas.cambiarEstadoLote(enMarcha.id, 'enviando');

    await repos.rutas.agregarSolicitudes(parado.id, [
      { telefonoCrudo: '911111111', phone: '51911111111' },
    ]);
    const [primera, segunda, sinTelefono] = await repos.rutas.agregarSolicitudes(enMarcha.id, [
      { telefonoCrudo: '922222222', phone: '51922222222' },
      { telefonoCrudo: '933333333', phone: '51933333333' },
      { telefonoCrudo: 'nada', phone: null, estado: 'incidencia' },
    ]);

    // La segunda espera desde hace mas: le toca antes.
    await repos.rutas.actualizarSolicitud(primera!.id, {
      proximoIntentoAt: new Date('2026-03-10T12:00:00Z'),
    });
    await repos.rutas.actualizarSolicitud(segunda!.id, {
      proximoIntentoAt: new Date('2026-03-10T11:00:00Z'),
    });

    const cola = await repos.rutas.tocaIntentar(new Date('2026-03-10T13:00:00Z'), 10);

    expect(cola.map((s) => s.id)).toEqual([segunda!.id, primera!.id]);
    expect(cola.some((s) => s.id === sinTelefono!.id)).toBe(false);
  });

  it('lo que todavia no vence no sale en la cola', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
    const [solicitud] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '922222222', phone: '51922222222' },
    ]);
    await repos.rutas.actualizarSolicitud(solicitud!.id, {
      proximoIntentoAt: new Date('2026-03-10T18:00:00Z'),
    });

    expect(await repos.rutas.tocaIntentar(new Date('2026-03-10T13:00:00Z'), 10)).toHaveLength(0);
  });

  it('la bandeja ensena primero lo que espera a una persona', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    const [normal, urgente] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '922222222', phone: '51922222222' },
      { telefonoCrudo: '933333333', phone: '51933333333' },
    ]);
    await repos.rutas.actualizarSolicitud(urgente!.id, {
      estado: 'supervision',
      requiereHumano: true,
      incidencia: 'numero_equivocado',
    });

    const lista = await repos.rutas.listarSolicitudes({ loteId: lote.id, limit: 10, offset: 0 });
    expect(lista[0]?.id).toBe(urgente!.id);
    expect(lista[1]?.id).toBe(normal!.id);

    const soloHumano = await repos.rutas.listarSolicitudes({
      requiereHumano: true,
      limit: 10,
      offset: 0,
    });
    expect(soloHumano).toHaveLength(1);
    expect(await repos.rutas.contarSolicitudes({ incidencia: 'numero_equivocado' })).toBe(1);
  });

  it('cuenta a los que faltan por dar la ubicacion, sea cual sea el motivo', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    const [conPin, esperando, derivado, cancelado, roto] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '911111111', phone: '51911111111', referencia: 'P-1' },
      { telefonoCrudo: '922222222', phone: '51922222222', referencia: 'P-2' },
      { telefonoCrudo: '933333333', phone: '51933333333', referencia: 'P-3' },
      { telefonoCrudo: '944444444', phone: '51944444444', referencia: 'P-4' },
      { telefonoCrudo: '9555', phone: null, referencia: 'P-5', estado: 'incidencia', incidencia: 'numero_corto' },
    ]);
    await repos.rutas.actualizarSolicitud(conPin!.id, { estado: 'resuelto', lat: -12.1, lng: -77.0 });
    await repos.rutas.actualizarSolicitud(esperando!.id, { estado: 'enviado', intentos: 1 });
    await repos.rutas.actualizarSolicitud(derivado!.id, { estado: 'derivado', requiereHumano: true });
    await repos.rutas.actualizarSolicitud(cancelado!.id, { estado: 'cancelado' });

    const faltan = await repos.rutas.listarSolicitudes({
      loteId: lote.id,
      estados: ESTADOS_SIN_UBICACION,
      limit: 10,
      offset: 0,
    });
    expect(faltan.map((s) => s.referencia).sort()).toEqual(['P-2', 'P-3', 'P-5']);
    expect(await repos.rutas.contarSolicitudes({ loteId: lote.id, estados: ESTADOS_SIN_UBICACION })).toBe(3);
    // El roto sigue ahi aunque no tenga telefono: tambien falta.
    expect(faltan.some((s) => s.id === roto!.id)).toBe(true);
    // Y la lista vacia no filtra nada.
    expect(await repos.rutas.contarSolicitudes({ loteId: lote.id, estados: [] })).toBe(5);
  });

  it('la resuelta reciente de un telefono solo cuenta si su lote sigue en marcha', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Hoy' });
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
    const [ana, luis] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '911111111', phone: '51911111111', referencia: 'P-1' },
      { telefonoCrudo: '922222222', phone: '51922222222', referencia: 'P-2' },
    ]);
    await repos.rutas.actualizarSolicitud(ana!.id, { estado: 'resuelto', lat: -12.1, lng: -77.0 });
    await repos.rutas.actualizarSolicitud(luis!.id, { estado: 'enviado', intentos: 1 });

    expect((await repos.rutas.resueltaRecientePorTelefono('51911111111'))?.id).toBe(ana!.id);
    // El que no ha resuelto no sale; el que no existe tampoco.
    expect(await repos.rutas.resueltaRecientePorTelefono('51922222222')).toBeNull();
    expect(await repos.rutas.resueltaRecientePorTelefono('51933333333')).toBeNull();

    // Terminado el lote, ya no hay nada que corregir.
    await repos.rutas.cambiarEstadoLote(lote.id, 'terminado');
    expect(await repos.rutas.resueltaRecientePorTelefono('51911111111')).toBeNull();
  });

  it('busca por telefono, nombre o referencia', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '922222222', phone: '51922222222', nombre: 'Ana Ruiz', referencia: 'P-77' },
      { telefonoCrudo: '933333333', phone: '51933333333', nombre: 'Luis Paz', referencia: 'P-88' },
    ]);

    expect(await repos.rutas.listarSolicitudes({ q: 'ruiz', limit: 10, offset: 0 })).toHaveLength(1);
    expect(await repos.rutas.listarSolicitudes({ q: 'P-88', limit: 10, offset: 0 })).toHaveLength(1);
    expect(await repos.rutas.listarSolicitudes({ q: '9333', limit: 10, offset: 0 })).toHaveLength(1);
  });

  it('borrar el lote se lleva sus solicitudes, eventos y reportes', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    const [solicitud] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '922222222', phone: '51922222222' },
    ]);
    await repos.rutas.registrarEvento(solicitud!.id, 'envio', 'primera solicitud');
    await repos.rutas.encolarReporte({ solicitudId: solicitud!.id, loteId: lote.id, tipo: 'ubicacion', payload: {} });

    await repos.rutas.borrarLote(lote.id);

    expect(await repos.rutas.contarSolicitudes({})).toBe(0);
    expect(await repos.rutas.eventos(solicitud!.id)).toHaveLength(0);
    expect((await repos.rutas.cifrasReportes()).pendiente).toBe(0);
  });
});

describe('bitacora y cola de reportes', () => {
  it('guarda los eventos en orden con su payload', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    const [solicitud] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '922222222', phone: '51922222222' },
    ]);

    await repos.rutas.registrarEvento(solicitud!.id, 'envio', 'primera solicitud', { paso: 'solicitud' });
    await repos.rutas.registrarEvento(solicitud!.id, 'respuesta', 'contesto: "ahorita"');

    const eventos = await repos.rutas.eventos(solicitud!.id);
    expect(eventos.map((e) => e.tipo)).toEqual(['envio', 'respuesta']);
    expect(eventos[0]?.payload).toMatchObject({ paso: 'solicitud' });
  });

  it('la cola se marca enviada con el id de GSG', async () => {
    const reporte = await repos.rutas.encolarReporte({ tipo: 'resumen', payload: { total: 3 } });
    expect((await repos.rutas.reportesPendientes(10))).toHaveLength(1);

    await repos.rutas.marcarReporte(reporte.id, 'enviado', { externoId: 'GSG-1' });

    expect(await repos.rutas.reportesPendientes(10)).toHaveLength(0);
    expect(await repos.rutas.cifrasReportes()).toMatchObject({ enviado: 1, pendiente: 0 });
  });

  it('un fallo deja el error escrito y cuenta el intento', async () => {
    const reporte = await repos.rutas.encolarReporte({ tipo: 'incidencia', payload: {} });
    await repos.rutas.marcarReporte(reporte.id, 'pendiente', { error: 'GSG no responde' });

    const [pendiente] = await repos.rutas.reportesPendientes(10);
    expect(pendiente).toMatchObject({ intentos: 1, ultimoError: 'GSG no responde' });
    // Y cuenta como atascado: pendiente que ya se intento y GSG no acepto.
    expect(await repos.rutas.cifrasReportes()).toMatchObject({ pendiente: 1, atascado: 1, fallido: 0 });
  });
});
