/**
 * Lo que rodea a la conexión con GSG: los pedidos que GSG manda y no se pueden
 * usar (a la vista, no solo en el log), el verificador del contrato, los
 * tokens caducables del simulador, la bitácora de lo que GSG nos mandó y el
 * cuadre de fin de día.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearGsgExtras, estadoDeToken, revisarPedidoGsg, verificarCuerpoPendientes, BITACORA_MAX } from '../src/rutas/gsg-extras.js';
import type { PuertoGsg, ResultadoConsulta } from '../src/rutas/gsg.js';
import { createMemorySettingsRepo, TEST_SETTINGS_KEY } from './fakes.js';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import Fastify, { type FastifyInstance } from 'fastify';
import { crearGsgSimulado, registerGsgSimulado } from '../src/entregas/gsg-simulado.js';
import { crearConexionGsg, RUTA_SIMULADOR, TOKEN_SIMULADOR, type ServicioConexionGsg } from '../src/rutas/conexion-gsg.js';
import { registerGsgExtrasRoutes, resultadoEnPalabras } from '../src/rutas/gsg-extras-routes.js';

const pedidoBueno = { referencia: 'P-1', telefono: '987654321', nombre: 'Ana', direccion: 'Av. Larco 123', distrito: 'Miraflores' };

function puertoFalso(respuesta: () => ResultadoConsulta<unknown>, conectado = true): PuertoGsg {
  return {
    conectado: () => conectado,
    descripcion: () => 'falso',
    enviar: async () => ({ ok: true }),
    consultar: async <T,>() => respuesta() as ResultadoConsulta<T>,
  };
}

describe('revisar cada pedido de GSG', () => {
  it('acepta lo bien formado y explica en palabras lo que no', () => {
    expect(revisarPedidoGsg(pedidoBueno)).toEqual({ ok: true });
    expect(revisarPedidoGsg({ ...pedidoBueno, referencia: '' })).toMatchObject({ ok: false, motivo: 'sin referencia' });
    expect(revisarPedidoGsg({ ...pedidoBueno, telefono: '12' })).toMatchObject({ ok: false });
    expect(String((revisarPedidoGsg({ ...pedidoBueno, telefono: '12' }) as { motivo: string }).motivo)).toMatch(/teléfono inválido/);
    expect(revisarPedidoGsg({ ...pedidoBueno, lat: 'x', lng: -77 })).toMatchObject({ ok: false, motivo: 'el pin (lat, lng) no son números' });
    expect(revisarPedidoGsg({ ...pedidoBueno, lat: -120, lng: -77 })).toMatchObject({ ok: false, motivo: 'el pin (lat, lng) está fuera del mapa' });
    expect(revisarPedidoGsg(null as never)).toMatchObject({ ok: false });
  });
});

describe('el verificador del contrato', () => {
  it('dice campo por campo qué falta, qué viene raro y qué sobra', () => {
    const v = verificarCuerpoPendientes({
      dia: '21/09/2026',
      faltaUbicacion: [{ ...pedidoBueno, color: 'rojo' }, { referencia: 'P-2', telefono: '999', urgente: 'si' }],
      terminados: [{ referencia: 'P-9' }, {}],
    });
    expect(v.ok).toBe(false);
    const de = (donde: string) => v.hallazgos.filter((h) => h.donde.startsWith(donde));
    expect(v.hallazgos.find((h) => h.donde === 'dia')?.tipo).toBe('formato');
    expect(v.hallazgos.find((h) => h.donde === 'faltaConfirmacion')?.tipo).toBe('falta');
    expect(de('faltaUbicacion[0] (P-1).color')[0]?.tipo).toBe('sobra');
    expect(de('faltaUbicacion[1] (P-2)').some((h) => h.tipo === 'formato' && /teléfono/.test(h.detalle))).toBe(true);
    expect(de('faltaUbicacion[1] (P-2).urgente')[0]?.detalle).toMatch(/true\/false/);
    expect(de('terminados[1]')[0]?.tipo).toBe('falta');
    expect(v.resumen).toMatch(/problema/);
  });

  it('con un cuerpo perfecto, se cumple', () => {
    const v = verificarCuerpoPendientes({ dia: '2026-09-21', faltaUbicacion: [pedidoBueno], faltaConfirmacion: [{ ...pedidoBueno, referencia: 'P-3', lat: -12.1, lng: -77.03 }], terminados: [] });
    expect(v.ok).toBe(true);
    expect(v.resumen).toMatch(/se cumple/);
    expect(v.hallazgos.every((h) => h.tipo === 'ok')).toBe(true);
  });

  it('una respuesta que no es un objeto se explica', () => {
    expect(verificarCuerpoPendientes([]).ok).toBe(false);
    expect(verificarCuerpoPendientes('hola').resumen).toMatch(/objeto JSON/);
  });
});

describe('los tokens del simulador, los descartes, la bitácora y el cuadre (servicio)', () => {
  it('los descartes de hoy se guardan con su motivo y no se repiten en cada consulta', async () => {
    const settingsRepo = createMemorySettingsRepo();
    const s = await crearGsgExtras({ settingsRepo, puerto: () => puertoFalso(() => ({ ok: true, cuerpo: {} })) });
    const cuerpo = { faltaUbicacion: [pedidoBueno, { referencia: 'P-MAL', telefono: '12' }], faltaConfirmacion: [{ telefono: '987654321' }] };
    expect(await s.observarPendientes(cuerpo)).toBe(2);
    expect(await s.observarPendientes(cuerpo)).toBe(2);
    const d = s.descartesDeHoy();
    expect(d.lista).toHaveLength(2);
    expect(d.lista.map((x) => x.referencia)).toEqual(['P-MAL', '(sin referencia, el n.º 1 de faltaConfirmacion)']);
    expect(d.lista[0]?.motivo).toMatch(/teléfono inválido/);
    // Sobrevive a un reinicio: se lee de settings.
    const s2 = await crearGsgExtras({ settingsRepo, puerto: () => puertoFalso(() => ({ ok: true, cuerpo: {} })) });
    expect(s2.descartesDeHoy().lista).toHaveLength(2);
  });

  it('el verificador usa la conexión vigente y explica un 401 o un 404', async () => {
    let respuesta: ResultadoConsulta<unknown> = { ok: false, status: 401, error: 'Unauthorized' };
    const s = await crearGsgExtras({ settingsRepo: createMemorySettingsRepo(), puerto: () => puertoFalso(() => respuesta) });
    expect((await s.verificarContrato()).resumen).toMatch(/rechazó el token \(error 40[13]\)/);
    respuesta = { ok: false, status: 404, error: 'Not found' };
    expect((await s.verificarContrato()).resumen).toMatch(/error 404: no tiene la ruta/);
    respuesta = { ok: true, cuerpo: { dia: '2026-09-21', faltaUbicacion: [], faltaConfirmacion: [] } };
    const v = await s.verificarContrato();
    expect(v.ok).toBe(true);
    expect(s.ultimaVerificacion()?.at).toBe(v.at);
    const sinConexion = await crearGsgExtras({ settingsRepo: createMemorySettingsRepo(), puerto: () => puertoFalso(() => respuesta, false) });
    expect((await sinConexion.verificarContrato()).resumen).toMatch(/No hay conexión/);
  });

  it('un token se ve una vez, se guarda como hash, caduca y se anula', async () => {
    let reloj = new Date('2026-09-21T15:00:00Z');
    const settingsRepo = createMemorySettingsRepo();
    const s = await crearGsgExtras({ settingsRepo, puerto: () => puertoFalso(() => ({ ok: true, cuerpo: {} })), ahora: () => reloj });
    const { token, registro } = await s.crearTokenSimulador({ nombre: 'Equipo GSG', dias: 2 });
    expect(token).toMatch(/^gsgsim_/);
    expect(registro.pista).toBe(token.slice(-4));
    expect(JSON.stringify(await settingsRepo.getAll())).not.toContain(token);
    expect((await s.resolverTokenSimulador(token))?.nombre).toBe('Equipo GSG');
    expect(await s.resolverTokenSimulador('gsgsim_otro')).toBeNull();
    expect(await s.resolverTokenSimulador(null)).toBeNull();
    expect(s.tokensSimulador()[0]).toMatchObject({ estado: 'vigente', usos: 1 });
    reloj = new Date('2026-09-24T15:00:01Z');
    expect(await s.resolverTokenSimulador(token)).toBeNull();
    expect(s.tokensSimulador()[0]?.estado).toBe('caducado');
    expect(estadoDeToken({ caducaAt: '2030-01-01T00:00:00Z', anuladoAt: '2026-01-01T00:00:00Z' }, reloj)).toBe('anulado');
    const { token: t2, registro: r2 } = await s.crearTokenSimulador({});
    expect(r2.nombre).toBe('Programadores de GSG');
    expect(await s.anularTokenSimulador(r2.id)).toBe(true);
    expect(await s.anularTokenSimulador(r2.id)).toBe(false);
    expect(await s.resolverTokenSimulador(t2)).toBeNull();
  });

  it('la bitácora guarda las últimas 50 y el cuadre compara con terminados', async () => {
    const terminados = [{ referencia: 'P-1' }, { referencia: 'P-2' }, { referencia: 'P-7' }];
    const s = await crearGsgExtras({
      settingsRepo: createMemorySettingsRepo(),
      puerto: () => puertoFalso(() => ({ ok: true, cuerpo: { terminados } })),
      entregasDelDia: async () => [
        { referencia: 'P-1', estado: 'entregada' },
        { referencia: 'P-2', estado: 'cancelada' },
        { referencia: 'P-3', estado: 'entregada' },
        { referencia: 'P-4', estado: 'avisada' },
      ],
    });
    for (let i = 0; i < BITACORA_MAX + 5; i++) await s.anotarLlamada({ que: `GET /x/${i}`, status: 200, resultado: 'bien', quien: 'prueba' });
    expect(s.bitacora()).toHaveLength(BITACORA_MAX);
    expect(s.bitacora()[0]?.que).toBe(`GET /x/${BITACORA_MAX + 4}`);
    const c = await s.cuadrar('2026-09-21');
    expect(c).toMatchObject({ ok: false, terminadosGsg: 3, cerradasAqui: 3, coinciden: 2, faltanEnGsg: ['P-3'], sobranEnGsg: ['P-7'] });
    expect(c.resumen).toMatch(/No cuadra/);
    expect(s.ultimoCuadre()?.dia).toBe('2026-09-21');
  });

  it('cada llamada se cuenta en palabras', () => {
    expect(resultadoEnPalabras(200, { faltaUbicacion: [1, 2], faltaConfirmacion: [], terminados: [3] })).toBe('respondió: falta ubicación 2 · falta confirmar 0 · terminados 1');
    expect(resultadoEnPalabras(201, { creadas: 3, repetidas: 1, descartadas: [{}] })).toBe('creados 3, repetidos 1, descartados 1');
    expect(resultadoEnPalabras(401, { error: 'token inválido' })).toBe('rechazada: token inválido');
    expect(resultadoEnPalabras(404, {})).toBe('rechazada: ruta desconocida');
    expect(resultadoEnPalabras(200, { detalle: 'todo bien' })).toBe('todo bien');
    expect(resultadoEnPalabras(200, null)).toBe('bien');
  });
});

describe('las rutas: el token del simulador vale desde fuera y todo queda en la bitácora', () => {
  let e: EscenarioEntregas;
  const json = { 'content-type': 'application/json' };
  let admin: Record<string, string> = {};
  const galleta = (r: { headers: Record<string, unknown> }) => {
    const c = (r.headers['set-cookie'] as string | string[] | undefined) ?? '';
    return (Array.isArray(c) ? (c[0] ?? '') : c).split(';')[0]!;
  };

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ supervisor: '51912426667' });
    const r = await e.app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { usuario: 'ali', nombre: 'Ali', clave: 'ali-2026-wa' } });
    admin = { cookie: galleta(r), ...json };
  });
  afterAll(() => e.cerrar());

  it('un pedido de GSG con teléfono inválido queda a la vista en /admin/gsg', async () => {
    e.simulador.cargarDePrueba();
    e.simulador.cargar([{ referencia: 'P-ROTO', telefono: '123456', nombre: 'Sin número' }]);
    await e.api.post('/admin/entregas/sincronizar');
    const r = await e.api.get<{ descartes: { lista: Array<{ referencia: string; motivo: string }> }; conSimulador: boolean; estado: { modo: string } }>('/admin/gsg');
    expect(r.status).toBe(200);
    expect(r.body.conSimulador).toBe(true);
    expect(r.body.descartes.lista.map((d) => d.referencia)).toContain('P-ROTO');
    expect(r.body.descartes.lista.find((d) => d.referencia === 'P-ROTO')?.motivo).toMatch(/teléfono inválido/);
  });

  it('el verificador y el cuadre responden con el simulador', async () => {
    const v = await e.app.inject({ method: 'POST', url: '/admin/gsg/verificar-contrato', headers: admin, payload: {} });
    expect(v.statusCode).toBe(200);
    const cuerpo = v.json() as { ok: boolean; verificacion: { hallazgos: Array<{ donde: string; tipo: string }> } };
    // P-ROTO tiene el teléfono mal: el verificador lo señala, sin crear nada.
    expect(cuerpo.ok).toBe(false);
    expect(cuerpo.verificacion.hallazgos.some((h) => h.donde.includes('P-ROTO') && h.tipo === 'formato')).toBe(true);
    const c = await e.api.get<{ cuadre: { ok: boolean; dia: string } }>('/admin/gsg/cuadre');
    expect(c.status).toBe(200);
    expect(c.body.cuadre.ok).toBe(true);
    const nadie = await e.app.inject({ method: 'POST', url: '/admin/gsg/verificar-contrato', headers: { authorization: 'Bearer nada' }, payload: {} });
    expect(nadie.statusCode).toBe(401);
  });

  it('las llamadas a la API de pedidos quedan en la bitácora con la clave que entró', async () => {
    const api = await e.api.post('/api/v1/entregas', { ...OBLIGATORIOS_GSG, referencia: 'P-API-1', telefono: '987000099', nombre: 'Api' });
    expect([200, 201]).toContain(api.status);
    const r2 = await e.api.get<{ bitacora: Array<{ que: string; quien: string; resultado: string }> }>('/admin/gsg');
    const fila = r2.body.bitacora.find((x) => x.que === 'POST /api/v1/entregas');
    expect(fila?.quien).toMatch(/clave de API/);
    expect(fila?.resultado).toMatch(/creados 1/);
  });

  it('crear o anular tokens exige un administrador de la pantalla', async () => {
    const r = await e.api.post('/admin/gsg/tokens-simulador', { nombre: 'x' });
    expect(r.status).toBe(403);
  });
});

describe('el token del simulador vale desde fuera (servidor mínimo con el simulador de verdad)', () => {
  let app: FastifyInstance;
  let conexion: ServicioConexionGsg;
  const admin = { 'x-prueba-admin': '1', 'content-type': 'application/json' };

  beforeAll(async () => {
    app = Fastify();
    app.decorateRequest('usuario', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { usuario: unknown }).usuario = request.headers['x-prueba-admin'] ? { rol: 'admin', porToken: false, nombre: 'Ali' } : null;
    });
    const simulador = crearGsgSimulado({ token: TOKEN_SIMULADOR });
    simulador.cargarDePrueba();
    await registerGsgSimulado(app, { simulador, prefijo: RUTA_SIMULADOR });
    conexion = await crearConexionGsg({ settingsRepo: createMemorySettingsRepo(), settingsKeyBase64: TEST_SETTINGS_KEY, config: { GSG_URL: '', GSG_TOKEN: '', PUBLIC_BASE_URL: 'http://localhost' } });
    await registerGsgExtrasRoutes(app, { conexion, conSimulador: () => true });
    await app.ready();
  });
  afterAll(() => app.close());

  it('con un token vigente entra; caducado o anulado, se le explica; y queda en la bitácora', async () => {
    const creado = await app.inject({ method: 'POST', url: '/admin/gsg/tokens-simulador', headers: admin, payload: { nombre: 'Equipo GSG', dias: 5 } });
    expect(creado.statusCode, creado.body).toBe(201);
    const { token, registro } = creado.json() as { token: string; registro: { id: string } };
    const ok = await app.inject({ method: 'GET', url: `${RUTA_SIMULADOR}/reparto/pendientes`, headers: { authorization: `Bearer ${token}` } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as { faltaUbicacion: unknown[] }).faltaUbicacion.length).toBeGreaterThan(0);
    const malo = await app.inject({ method: 'GET', url: `${RUTA_SIMULADOR}/reparto/pendientes`, headers: { authorization: 'Bearer gsgsim_inventado' } });
    expect(malo.statusCode).toBe(401);
    expect((malo.json() as { error: string }).error).toMatch(/caducó o fue anulado/);
    const sinToken = await app.inject({ method: 'GET', url: `${RUTA_SIMULADOR}/reparto/pendientes` });
    expect(sinToken.statusCode).toBe(401);
    expect(await app.inject({ method: 'DELETE', url: `/admin/gsg/tokens-simulador/${registro.id}`, headers: { 'x-prueba-admin': '1' } }).then((r) => r.statusCode)).toBe(200);
    const despues = await app.inject({ method: 'GET', url: `${RUTA_SIMULADOR}/reparto/pendientes`, headers: { authorization: `Bearer ${token}` } });
    expect(despues.statusCode).toBe(401);
    const r = (await app.inject({ method: 'GET', url: '/admin/gsg' })).json() as { bitacora: Array<{ que: string; status: number; quien: string; resultado: string }>; tokens: Array<{ estado: string; usos: number }> };
    expect(r.bitacora[0]).toMatchObject({ que: `GET ${RUTA_SIMULADOR}/reparto/pendientes`, status: 401 });
    expect(r.bitacora.find((x) => x.status === 200 && x.quien.includes('Equipo GSG'))?.resultado).toMatch(/respondió: falta ubicación/);
    expect(r.bitacora.find((x) => x.quien === 'sin token')?.status).toBe(401);
    expect(r.tokens[0]).toMatchObject({ estado: 'anulado', usos: 1 });
    const sinPermiso = await app.inject({ method: 'POST', url: '/admin/gsg/tokens-simulador', payload: { nombre: 'x' } });
    expect(sinPermiso.statusCode).toBe(403);
  });
});

describe('las pruebas del espejo de cambios desde la pantalla (cancelar uno / cambiar la dirección de uno)', () => {
  let app: FastifyInstance;
  let sim: ReturnType<typeof crearGsgSimulado>;
  beforeAll(async () => {
    sim = crearGsgSimulado({ token: TOKEN_SIMULADOR });
    app = Fastify({ logger: false });
    app.decorateRequest('usuario', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { usuario: unknown }).usuario = { rol: 'admin', porToken: false, nombre: 'Ali' };
    });
    await registerGsgSimulado(app, { simulador: sim, prefijo: RUTA_SIMULADOR });
    const conexion = await crearConexionGsg({ settingsRepo: createMemorySettingsRepo(), settingsKeyBase64: TEST_SETTINGS_KEY, config: { GSG_URL: '', GSG_TOKEN: '', PUBLIC_BASE_URL: 'http://localhost' } });
    await registerGsgExtrasRoutes(app, { conexion, conSimulador: () => true, simulador: sim });
    await app.ready();
  });
  afterAll(() => app.close());

  it('sin pedidos pendientes lo dice; con pedidos, cancela uno y lo deja en cancelados con cancelado:true', async () => {
    const vacio = await app.inject({ method: 'POST', url: '/admin/gsg/simulador/cancelar-uno', payload: {} });
    expect(vacio.statusCode).toBe(409);
    expect((vacio.json() as { error: string }).error).toContain('ningún pedido de prueba vivo');
    sim.cargarDePrueba();
    const r = await app.inject({ method: 'POST', url: '/admin/gsg/simulador/cancelar-uno', payload: {} });
    expect(r.statusCode).toBe(200);
    const { referencia, detalle } = r.json() as { referencia: string; detalle: string };
    expect(detalle).toContain(referencia);
    const c = sim.pendientes().cancelados.find((x) => x.referencia === referencia);
    expect(c).toMatchObject({ cancelado: true });
    expect(String(c!.motivoCancelacion)).toContain('Prueba');
  });

  it('cambia la dirección de uno y la lista lo devuelve con la nueva; el verificador no lo cuenta como campo que sobra', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/gsg/simulador/cambiar-uno', payload: {} });
    expect(r.statusCode).toBe(200);
    const { referencia, direccion, distrito } = r.json() as { referencia: string; direccion: string; distrito: string };
    expect(direccion).toContain('(dirección cambiada)');
    const p = sim.pendientes();
    const c = [...p.faltaUbicacion, ...p.faltaConfirmacion].find((x) => x.referencia === referencia)!;
    expect(c.direccion).toBe(direccion);
    expect(c.distrito).toBe(distrito);
    const v = verificarCuerpoPendientes({ dia: '2026-09-21', faltaUbicacion: [{ referencia: 'X-1', telefono: '987000001', cancelado: true, motivoCancelacion: 'anulado' }], faltaConfirmacion: [], terminados: [] });
    expect(v.hallazgos.filter((h) => h.tipo === 'sobra')).toHaveLength(0);
  });
});
