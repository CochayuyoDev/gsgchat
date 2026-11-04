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
import { CandadoOcupado, ESTADOS_SIN_UBICACION } from '../src/db/rutas.js';
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

  it('consulta solicitudes de varios clientes y cifras de vistas por lote en bloque', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Resumen en bloque' });
    await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '911111111', phone: '51911111111', estado: 'pendiente' },
      { telefonoCrudo: '922222222', phone: '51922222222', estado: 'enviado' },
      { telefonoCrudo: '933333333', phone: null, estado: 'incidencia', incidencia: 'numero_corto', requiereHumano: true },
    ]);

    const clientes = await repos.rutas.solicitudesPorLoteYTelefonos(lote.id, ['51911111111', '51922222222', '51900000000']);
    expect(clientes.map((s) => s.phone).sort()).toEqual(['51911111111', '51922222222']);
    expect(await repos.rutas.resumenSolicitudes(lote.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ estado: 'pendiente', total: 1 }),
      expect.objectContaining({ estado: 'enviado', total: 1 }),
      expect.objectContaining({ estado: 'incidencia', incidencia: 'numero_corto', requiereHumano: true, total: 1 }),
    ]));
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

  it('obtiene una sola vez la próxima fecha activa para dormir sin sondear la cola', async () => {
    const enMarcha = await repos.rutas.crearLote({ nombre: 'Con trabajo' });
    const preparado = await repos.rutas.crearLote({ nombre: 'Aún no inicia' });
    await repos.rutas.cambiarEstadoLote(enMarcha.id, 'enviando');
    const [primera, segunda] = await repos.rutas.agregarSolicitudes(enMarcha.id, [
      { telefonoCrudo: '911111111', phone: '51911111111' },
      { telefonoCrudo: '922222222', phone: '51922222222' },
    ]);
    const [ignorada] = await repos.rutas.agregarSolicitudes(preparado.id, [
      { telefonoCrudo: '933333333', phone: '51933333333' },
    ]);
    const primeraFecha = new Date('2026-03-10T18:00:00Z');
    const segundaFecha = new Date('2026-03-10T17:00:00Z');
    await repos.rutas.actualizarSolicitud(primera!.id, { proximoIntentoAt: primeraFecha });
    await repos.rutas.actualizarSolicitud(segunda!.id, { proximoIntentoAt: segundaFecha });
    await repos.rutas.actualizarSolicitud(ignorada!.id, { proximoIntentoAt: new Date('2026-03-10T12:00:00Z') });

    expect((await repos.rutas.proximoIntentoAt())?.getTime()).toBe(segundaFecha.getTime());
  });

  it('prioriza el seguimiento vencido frente a primeras solicitudes más antiguas', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Seguimiento puntual' });
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
    const [nuevo, seguimiento] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '911111111', phone: '51911111111' },
      { telefonoCrudo: '922222222', phone: '51922222222' },
    ]);
    await repos.rutas.actualizarSolicitud(nuevo!.id, { proximoIntentoAt: new Date('2026-03-10T11:00:00Z') });
    await repos.rutas.actualizarSolicitud(seguimiento!.id, { estado: 'enviado', intentos: 1, proximoIntentoAt: new Date('2026-03-10T12:00:00Z') });
    expect((await repos.rutas.tocaIntentar(new Date('2026-03-10T13:00:00Z'), 1))[0]!.id).toBe(seguimiento!.id);
  });

  it('libera solo esperas heredadas de salud y deja intactos los fallos reales', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Sin frenos de salud' });
    const [salud, desconectado, humano] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '911111111', phone: '51911111111' },
      { telefonoCrudo: '922222222', phone: '51922222222' },
      { telefonoCrudo: '933333333', phone: '51933333333' },
    ]);
    const despues = new Date(Date.now() + 3600000);
    for (const s of [salud, desconectado, humano]) await repos.rutas.actualizarSolicitud(s!.id, {
      incidencia: 'envio_bloqueado', incidenciaDetalle: s === desconectado ? 'sin_conexion: sin socket' : 'daily_cap: cupo interno',
      proximoIntentoAt: despues, requiereHumano: s === humano,
    });
    expect(await repos.rutas.liberarFrenosCuenta()).toBe(1);
    // La hora la pone la base y el reloj de la prueba es el de Node: pueden diferir unos milisegundos.
    expect((await repos.rutas.solicitud(salud!.id))!.proximoIntentoAt!.getTime()).toBeLessThanOrEqual(Date.now() + 2000);
    expect((await repos.rutas.solicitud(desconectado!.id))!.proximoIntentoAt!.getTime()).toBe(despues.getTime());
    expect((await repos.rutas.solicitud(humano!.id))!.requiereHumano).toBe(true);
  });

  it('libera el primer mensaje de un pedido frenado por salud sin reintentar resultados inciertos', async () => {
    const registros = [];
    for (const referencia of ['SALUD-ANTIGUA', 'RED-REAL', 'RESULTADO-INCIERTO']) {
      const { entrega } = await repos.entregas.crearEntrega({ dia: '2026-10-15', referencia, phone: '51911111111',
        ubicacionEstado: 'pendiente', confirmacionEstado: 'no_hace_falta', estado: 'esperando_ubicacion', mensajeEstado: 'pendiente' });
      registros.push(entrega);
      await repos.entregas.actualizar(entrega.id, { mensajeEstado: referencia === 'RESULTADO-INCIERTO' ? 'incierto' : 'reintentando',
        mensajeErrorCodigo: referencia === 'RED-REAL' ? 'sin_conexion' : 'daily_cap', mensajeError: referencia,
        mensajeProximoAt: new Date(Date.now() + 3600000) });
    }
    expect(await repos.entregas.liberarFrenosCuenta()).toBe(1);
    expect(await repos.entregas.entrega(registros[0]!.id)).toMatchObject({ mensajeEstado: 'pendiente', mensajeErrorCodigo: null });
    expect(await repos.entregas.entrega(registros[1]!.id)).toMatchObject({ mensajeEstado: 'reintentando', mensajeErrorCodigo: 'sin_conexion' });
    expect(await repos.entregas.entrega(registros[2]!.id)).toMatchObject({ mensajeEstado: 'incierto' });
  });

  it('reprograma en un solo cambio los seguimientos vivos desde el ultimo envio', async () => {
    const activo = await repos.rutas.crearLote({ nombre: 'Cadencia activa' });
    const pausado = await repos.rutas.crearLote({ nombre: 'Cadencia pausada' });
    await repos.rutas.cambiarEstadoLote(activo.id, 'enviando');
    await repos.rutas.cambiarEstadoLote(pausado.id, 'pausado');
    const [m2, m3, m4, maximo, humano, fueraDeLote] = await repos.rutas.agregarSolicitudes(activo.id, [
      { telefonoCrudo: '911111111', phone: '51911111111' },
      { telefonoCrudo: '922222222', phone: '51922222222' },
      { telefonoCrudo: '933333333', phone: '51933333333' },
      { telefonoCrudo: '944444444', phone: '51944444444' },
      { telefonoCrudo: '955555555', phone: '51955555555' },
    ]);
    const [enPausa] = await repos.rutas.agregarSolicitudes(pausado.id, [
      { telefonoCrudo: '966666666', phone: '51966666666' },
    ]);
    const ultimoEnvioAt = new Date(Date.now() - 40 * 60_000);
    for (const [solicitud, intentos] of [[m2, 1], [m3, 2], [m4, 3], [maximo, 4], [humano, 1], [enPausa, 1]] as const) {
      await repos.rutas.actualizarSolicitud(solicitud!.id, {
        estado: 'enviado', intentos, ultimoEnvioAt,
        proximoIntentoAt: new Date(ultimoEnvioAt.getTime() + 60_000),
        ...(solicitud === humano ? { requiereHumano: true } : {}),
      });
    }

    expect(await repos.rutas.reprogramarSeguimientos([30, 25, 20])).toBe(5);
    expect((await repos.rutas.solicitud(m2!.id))!.proximoIntentoAt!.getTime()).toBe(ultimoEnvioAt.getTime() + 30 * 60_000);
    expect((await repos.rutas.solicitud(m3!.id))!.proximoIntentoAt!.getTime()).toBe(ultimoEnvioAt.getTime() + 25 * 60_000);
    expect((await repos.rutas.solicitud(m4!.id))!.proximoIntentoAt!.getTime()).toBe(ultimoEnvioAt.getTime() + 20 * 60_000);
    expect(Math.abs(Date.now() - (await repos.rutas.solicitud(maximo!.id))!.proximoIntentoAt!.getTime())).toBeLessThan(5_000);
    expect((await repos.rutas.solicitud(humano!.id))!.proximoIntentoAt!.getTime()).toBe(ultimoEnvioAt.getTime() + 60_000);
    expect((await repos.rutas.solicitud(enPausa!.id))!.proximoIntentoAt!.getTime()).toBe(ultimoEnvioAt.getTime() + 30 * 60_000);
  });

  it('la espera final se reprograma también para quien contestó (requiere humano) y ya agotó sus mensajes', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Plazo final' });
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
    const [contesto] = await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '977777777', phone: '51977777777' }]);
    const ultimoEnvioAt = new Date(Date.now() - 5 * 60_000);
    await repos.rutas.actualizarSolicitud(contesto!.id, { estado: 'respondio', intentos: 4, requiereHumano: true, ultimoEnvioAt, proximoIntentoAt: new Date(ultimoEnvioAt.getTime() + 60 * 60_000) });

    expect(await repos.rutas.reprogramarSeguimientosSegundos([60, 60, 60], 20 * 60)).toBe(1);
    expect((await repos.rutas.solicitud(contesto!.id))!.proximoIntentoAt!.getTime()).toBe(ultimoEnvioAt.getTime() + 20 * 60_000);
  });

  it('los plazos vencidos salen con horario o sin él, de lotes en marcha o en pausa, y nunca de un lote terminado', async () => {
    const enMarcha = await repos.rutas.crearLote({ nombre: 'En marcha' });
    const enPausa = await repos.rutas.crearLote({ nombre: 'En pausa' });
    const terminado = await repos.rutas.crearLote({ nombre: 'Terminado' });
    await repos.rutas.cambiarEstadoLote(enMarcha.id, 'enviando');
    await repos.rutas.cambiarEstadoLote(enPausa.id, 'pausado');
    await repos.rutas.cambiarEstadoLote(terminado.id, 'terminado');
    const ahora = new Date();
    const hace = (min: number) => new Date(ahora.getTime() - min * 60_000);
    const [vencida, futura, sinHora, faltanMensajes] = await repos.rutas.agregarSolicitudes(enMarcha.id, [
      { telefonoCrudo: '911111111', phone: '51911111111' },
      { telefonoCrudo: '922222222', phone: '51922222222' },
      { telefonoCrudo: '933333333', phone: '51933333333' },
      { telefonoCrudo: '944444444', phone: '51944444444' },
    ]);
    const [pausada] = await repos.rutas.agregarSolicitudes(enPausa.id, [{ telefonoCrudo: '955555555', phone: '51955555555' }]);
    const [cerrada] = await repos.rutas.agregarSolicitudes(terminado.id, [{ telefonoCrudo: '966666666', phone: '51966666666' }]);
    await repos.rutas.actualizarSolicitud(vencida!.id, { estado: 'enviado', intentos: 4, proximoIntentoAt: hace(10) });
    await repos.rutas.actualizarSolicitud(futura!.id, { estado: 'respondio', intentos: 4, proximoIntentoAt: new Date(ahora.getTime() + 15 * 60_000) });
    await repos.rutas.actualizarSolicitud(sinHora!.id, { estado: 'enviado', intentos: 4, proximoIntentoAt: null });
    await repos.rutas.actualizarSolicitud(faltanMensajes!.id, { estado: 'enviado', intentos: 2, proximoIntentoAt: hace(30) });
    await repos.rutas.actualizarSolicitud(pausada!.id, { estado: 'enviado', intentos: 5, proximoIntentoAt: hace(5) });
    await repos.rutas.actualizarSolicitud(cerrada!.id, { estado: 'enviado', intentos: 4, proximoIntentoAt: hace(60) });

    const ids = (await repos.rutas.plazosVencidos(ahora, 4, 50)).map((s) => s.id).sort((a, b) => a - b);
    expect(ids).toEqual([vencida!.id, sinHora!.id, pausada!.id].sort((a, b) => a - b));
    // El proximo plazo es el mas antiguo de esos (el sin hora cuenta desde que se creo).
    expect((await repos.rutas.proximoPlazoAt(4))!.getTime()).toBeLessThanOrEqual(hace(10).getTime());

    for (const id of ids) await repos.rutas.actualizarSolicitud(id, { estado: 'derivado', proximoIntentoAt: null });
    expect((await repos.rutas.proximoPlazoAt(4))!.getTime()).toBe(ahora.getTime() + 15 * 60_000);
  });

  it('reprograma el envío inicial pendiente de Solicitud de ubicación desde que llegó el pedido', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Solicitud inicial' });
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
    const [pendiente] = await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '977777777', phone: '51977777777' }]);
    await repos.rutas.actualizarSolicitud(pendiente!.id, { proximoIntentoAt: new Date(Date.now() + 10 * 60_000) });

    expect(await repos.rutas.reprogramarPrimerosMensajesSegundos(30)).toBe(1);
    const reprogramada = (await repos.rutas.solicitud(pendiente!.id))!;
    expect(Math.abs(reprogramada.proximoIntentoAt!.getTime() - (reprogramada.createdAt.getTime() + 30_000))).toBeLessThan(1_000);

    expect(await repos.rutas.reprogramarPrimerosMensajesSegundos(0)).toBe(1);
    expect((await repos.rutas.solicitud(pendiente!.id))!.proximoIntentoAt).toBeNull();
  });

  it('la bandeja ensena primero lo ultimo que se movio, y el id desempata', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    const [a, b, c, d] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '911111111', phone: '51911111111' },
      { telefonoCrudo: '922222222', phone: '51922222222' },
      { telefonoCrudo: '933333333', phone: '51933333333' },
      { telefonoCrudo: '944444444', phone: '51944444444' },
    ]);
    // Fechas a mano: a y c empatan, b es la mas vieja, d la mas nueva. Una
    // en supervision NO sube por su estado: manda la actividad.
    const fecha = async (id: number, iso: string) =>
      pool.query('update rutas_solicitudes set updated_at = $1 where id = $2', [new Date(iso), id]);
    await fecha(a!.id, '2026-03-10T12:00:00.000Z');
    await fecha(b!.id, '2026-03-10T11:00:00.000Z');
    await fecha(c!.id, '2026-03-10T12:00:00.000Z');
    await fecha(d!.id, '2026-03-10T13:00:00.000Z');
    await pool.query(`update rutas_solicitudes set estado = 'supervision', requiere_humano = 1 where id = $1`, [b!.id]);
    await fecha(b!.id, '2026-03-10T11:00:00.000Z');

    const ids = async (limit: number, offset: number) =>
      (await repos.rutas.listarSolicitudes({ loteId: lote.id, limit, offset })).map((s) => s.id);
    expect(await ids(10, 0)).toEqual([d!.id, c!.id, a!.id, b!.id]);
    // El limite y el desplazamiento siguen igual, sobre el orden nuevo.
    expect(await ids(2, 1)).toEqual([c!.id, a!.id]);

    // Tocarla la sube: actualizarSolicitud pone updated_at a ahora.
    await repos.rutas.actualizarSolicitud(b!.id, { incidencia: 'numero_equivocado' });
    expect((await ids(10, 0))[0]).toBe(b!.id);

    const soloHumano = await repos.rutas.listarSolicitudes({ requiereHumano: true, limit: 10, offset: 0 });
    expect(soloHumano.map((s) => s.id)).toEqual([b!.id]);
    expect(await repos.rutas.contarSolicitudes({ incidencia: 'numero_equivocado' })).toBe(1);
  });

  it('el candado por telefono no deja solapar dos llamadas del mismo numero', async () => {
    const traza: string[] = [];
    const tarea = (n: string) => async () => {
      traza.push(`entra ${n}`);
      await new Promise((r) => setTimeout(r, 50));
      traza.push(`sale ${n}`);
      return n;
    };
    const [uno, dos] = await Promise.all([
      repos.rutas.conCandadoDeTelefono('51900000001', tarea('1')),
      repos.rutas.conCandadoDeTelefono('51900000001', tarea('2')),
    ]);
    expect([uno, dos]).toEqual(['1', '2']);
    // Una detras de otra, nunca intercaladas (la que entra primero da igual).
    const primero = traza[0]!.split(' ')[1];
    const segundo = primero === '1' ? '2' : '1';
    expect(traza).toEqual([`entra ${primero}`, `sale ${primero}`, `entra ${segundo}`, `sale ${segundo}`]);

    // Con el candado tomado y sin espera, la segunda no entra.
    await repos.rutas.conCandadoDeTelefono('51900000002', async () => {
      await expect(repos.rutas.conCandadoDeTelefono('51900000002', async () => 'no', 0)).rejects.toBeInstanceOf(CandadoOcupado);
    });
    // Y al soltarlo, si.
    expect(await repos.rutas.conCandadoDeTelefono('51900000002', async () => 'si', 0)).toBe('si');
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
