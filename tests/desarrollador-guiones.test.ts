/**
 * Módulo desarrollador · conversaciones completas: el cliente de prueba y su
 * motorizado de prueba hablan con el sistema de principio a fin (pregunta en
 * cuánto llega, por dónde va, reclama que no llega, no estaba en casa, lo
 * cambia para mañana, ya no lo quiere) y cada paso sale como se espera.
 *
 * Y lo que no puede pasar nunca: un pedido de prueba en manos de un motorizado
 * de VERDAD (le llegaria un WhatsApp real), ni un pedido real en uno de prueba.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { armarTienda, type TiendaViva } from '../src/plataforma/tienda.js';
import { bootstrapSecrets } from '../src/settings/crypto.js';
import { GUIONES, type ResultadoGuion } from '../src/desarrollador/guiones.js';
import { leerPreguntaPorPedido } from '../src/entregas/interpretar.js';
import { EJEMPLO_CASO, interpretarCaso, limpiarRespuestaIA } from '../src/desarrollador/casos.js';
import { desarrolladorPage } from '../src/desarrollador/pagina.js';
import { createFakeWhatsApp, type FakeWhatsApp } from './fakes.js';

const puertoLibre = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

const esperar = async (cond: () => boolean | Promise<boolean>, ms: number, que: string): Promise<void> => {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no se cumplio a tiempo: ${que}`);
};

describe('el cliente pregunta por su pedido: el lector lo entiende', () => {
  it('en cuánto llega, por dónde va, dónde está el motorizado, y el reclamo de que no llega', () => {
    for (const t of ['¿En cuánto llega mi pedido?', '¿Por dónde va el motorizado?', 'dónde anda el delivery', '¿Cuántos minutos faltan?', '¿me mandan la ubicación del motorizado?', 'a qué hora me lo traen']) {
      expect(leerPreguntaPorPedido(t), t).toMatchObject({ pregunta: true, noLlego: false });
    }
    expect(leerPreguntaPorPedido('Ya pasó la hora y no llega')).toEqual({ pregunta: true, noLlego: true });
    for (const t of ['sí', 'hola buenas', 'mañana mejor', 'gracias']) expect(leerPreguntaPorPedido(t).pregunta, t).toBe(false);
  });
});

describe('la página del módulo', () => {
  it('todo su JavaScript compila (un error ahí deja la pestaña muerta sin que falle nada más)', () => {
    const html = desarrolladorPage({ nombreNegocio: 'Tienda', demo: false, esAdmin: true });
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(() => new Function(s)).not.toThrow();
    expect(html).toContain('id="vv-caso-texto"');
    expect(html).toContain('data-rapida="pordonde"');
  });
});

describe('«Mis casos»: el caso escrito a mano se entiende (o se dice qué línea no)', () => {
  it('el ejemplo se entiende, empieza sin ubicación y trae sus comprobaciones', () => {
    const g = interpretarCaso(EJEMPLO_CASO, 'Ejemplo');
    expect(g.inicio).toBe('sin_pin');
    const escribe = g.pasos.filter((p) => p.tipo === 'escribe');
    expect(escribe[1]).toMatchObject({ quien: 'cliente', dice: { tipo: 'pin' }, espera: { contiene: 'Ubicación registrada' } });
    expect(escribe.at(-1)).toMatchObject({ quien: 'motorizado', dice: { texto: 'entregado' }, espera: { estado: ['entregada'] } });
  });

  it('entiende atajos y estados dichos en palabras', () => {
    const g = interpretarCaso(['c: hola', 'moto: [foto]', '-> queda: para una persona o cancelado', 'adelantar: 1,5 h', 'cliente: [audio: ya estoy en casa]', 'adelantar: pasada la hora', '# un comentario', 'esperar motorizado'].join('\n'));
    expect(g.inicio).toBe('con_pin');
    expect(g.pasos[1]).toMatchObject({ quien: 'motorizado', dice: { tipo: 'foto' }, espera: { estado: ['incidencia', 'cancelada'] } });
    expect(g.pasos[2]).toMatchObject({ tipo: 'adelantar', minutos: 90 });
    expect(g.pasos[3]).toMatchObject({ dice: { tipo: 'audio', texto: 'ya estoy en casa' } });
    expect(g.pasos[4]).toMatchObject({ tipo: 'adelantar', minutos: 'pasada_la_hora' });
    expect(g.pasos[5]).toMatchObject({ tipo: 'esperar_motorizado' });
  });

  it('lo que no se entiende se dice con su línea y qué escribir', () => {
    expect(() => interpretarCaso('cliente: hola\nel cliente se enoja')).toThrow(/Línea 2: no entiendo .*Empieza la línea con «cliente:»/);
    expect(() => interpretarCaso('cliente: hola\n=> estado: feliz')).toThrow(/Línea 2: no conozco el estado «feliz»/);
    expect(() => interpretarCaso('=> dice: hola')).toThrow(/Línea 1: «=>» dice lo que se espera/);
    expect(() => interpretarCaso('adelantar: un rato')).toThrow(/Línea 1: en «adelantar»/);
    expect(() => interpretarCaso('cliente: [video]')).toThrow(/no conozco «\[video\]»/);
    expect(() => interpretarCaso('   \n# nada')).toThrow(/vacío/);
  });

  it('lo que devuelve la IA se limpia de adornos antes de leerlo', () => {
    expect(limpiarRespuestaIA('```\n- cliente: hola\n\n* motorizado: 40\n```')).toBe('cliente: hola\nmotorizado: 40');
  });
});

describe('Módulo desarrollador: conversaciones completas', () => {
  let raiz: string;
  let tienda: TiendaViva;
  let wa: FakeWhatsApp;
  let cookie: string;

  const api = async (method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const r = await tienda.app.inject({ method, url, headers: { cookie, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, payload: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as any) : {} };
  };

  beforeAll(async () => {
    raiz = mkdtempSync(path.join(tmpdir(), 'dev-guiones-'));
    const secretos = bootstrapSecrets(raiz);
    const puerto = await puertoLibre();
    wa = createFakeWhatsApp();
    tienda = await armarTienda({
      id: 'guiones',
      slug: 'guiones',
      env: {
        PUBLIC_BASE_URL: `http://127.0.0.1:${puerto}`,
        DATABASE_URL: `pglite://${path.join(raiz, 'datos')}`,
        TRACKING_SECRET: secretos.trackingSecret,
        WHATSAPP_PROVIDER: 'local',
        BUSINESS_NAME: 'Tienda de prueba',
        RAFAGA_MS: '0',
        TIMEZONE: 'America/Lima',
        RUTAS_HORA_INICIO: '0',
        RUTAS_HORA_FIN: '24',
        HORARIO_ENVIO_INICIO: '0',
        HORARIO_ENVIO_FIN: '24',
        RUTAS_PAUSA_MIN_SEG: '1',
        RUTAS_PAUSA_MAX_SEG: '1',
      } as NodeJS.ProcessEnv,
      secretos,
      base: { tipo: 'pglite', dir: path.join(raiz, 'datos') },
      authDir: path.join(raiz, 'auth'),
      mediaDir: path.join(raiz, 'medios'),
      carpetaCopias: path.join(raiz, 'copias'),
      primeraCuentaRol: 'superadmin',
      autoConectarLocal: false,
      sembrarPlantillasLocales: true,
      prefijoLog: '[guiones] ',
      waParaPruebas: wa,
    });
    await tienda.app.listen({ port: puerto, host: '127.0.0.1' });
    const alta = await tienda.app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'ali-2026-wa' } });
    cookie = String(alta.headers['set-cookie']).split(';')[0]!;
    expect((await api('POST', '/admin/rutas/ajustes', { horaInicio: 0, horaFin: 24, pausaMinSegundos: 1, pausaMaxSegundos: 1 })).status).toBe(200);
    // El horario de ENTREGAS tambien todo el dia: la prueba no puede depender de la hora.
    expect((await api('POST', '/admin/entregas/ajustes', { horarioEntregas: { desde: '00:00', hasta: '23:59', extendidoHasta: '23:59' } })).status).toBe(200);
    expect((await api('POST', '/admin/entregas/gsg', { modo: 'simulador' })).body.gsg).toMatchObject({ conectada: true });
    // Un motorizado DE VERDAD, activo y en la zona: un pedido de prueba no le puede llegar nunca.
    const real = await tienda.entregas!.crearMotorizado({ phone: '51944000001', nombre: 'Motorizado Real', placa: 'REAL-1', zona: 'Miraflores, Surco, San Borja, Lince, Breña, Jesús María, San Isidro, Pueblo Libre, Cercado de Lima' });
    expect(real.ok).toBe(true);
  }, 180_000);

  afterAll(async () => {
    await tienda?.parar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('las cinco conversaciones salen paso a paso como se espera', async () => {
    const r = await api('POST', '/admin/desarrollador/vivo/guiones', { guiones: GUIONES.map((g) => g.id), veces: 1 });
    expect(r.status).toBe(200);
    let estado: { enMarcha: boolean; resultados: ResultadoGuion[] } = { enMarcha: true, resultados: [] };
    await esperar(async () => {
      estado = (await api('GET', '/admin/desarrollador/vivo/guiones')).body;
      return !estado.enMarcha;
    }, 420_000, 'que terminen las conversaciones');
    const fallidas = estado.resultados.filter((x) => !x.ok).map((x) => ({ guion: x.guion, error: x.error, paso: x.pasos.find((p) => !p.ok) }));
    expect(fallidas).toEqual([]);
    expect(estado.resultados).toHaveLength(GUIONES.length);
  }, 480_000);

  it('el cliente que pregunta por dónde va oye que el motorizado ya está cerca, y la hora con lo que falta', async () => {
    const curioso = (await api('GET', '/admin/desarrollador/vivo/guiones')).body.resultados.find((x: ResultadoGuion) => x.guion === 'curioso') as ResultadoGuion;
    const respuestas = curioso.pasos.map((p) => p.respuesta ?? '').join('\n');
    expect(respuestas).toMatch(/va en camino con .* le llega alrededor de las \d{1,2}:\d{2} \(faltan unos/);
    expect(respuestas).toMatch(/ya está cerca de su dirección/);
  });

  it('«Mis casos»: se guarda, se edita, se corre de punta a punta y se borra', async () => {
    const miCaso = [
      'titulo: Reclama y luego cancela',
      'inicio: con ubicación',
      'cliente: si, lo recibo hoy',
      '=> estado: con motorizado',
      'motorizado: 25',
      '=> estado: en camino',
      'cliente: por donde va??',
      '=> dice: va en camino',
      'adelantar: pasada la hora',
      'cliente: ya paso la hora y no llega nada',
      '=> estado: para una persona',
      '=> dice: disculpe la demora',
    ].join('\n');
    const revisado = await api('POST', '/admin/desarrollador/vivo/casos/revisar', { texto: miCaso });
    expect(revisado.status).toBe(200);
    expect(revisado.body.empieza).toContain('con la ubicación');
    const guardado = await api('POST', '/admin/desarrollador/vivo/casos', { titulo: 'Reclama', texto: miCaso });
    expect(guardado.status).toBe(200);
    const id = guardado.body.caso.id as string;
    // Preguntar si se entiende uno mal escrito dice la línea (sin ser un error).
    const dudoso = await api('POST', '/admin/desarrollador/vivo/casos/revisar', { texto: 'cliente: hola\nesto no vale' });
    expect(dudoso).toMatchObject({ status: 200, body: { ok: false, linea: 2 } });
    // Un caso mal escrito no se guarda: se dice la línea.
    const malo = await api('POST', '/admin/desarrollador/vivo/casos', { titulo: 'Malo', texto: 'cliente: hola\nesto no vale' });
    expect(malo.status).toBe(400);
    expect(malo.body).toMatchObject({ linea: 2 });
    // Se corren el guardado y el ejemplo (sin guardar) a la vez.
    const r = await api('POST', '/admin/desarrollador/vivo/guiones', { casos: [id], texto: EJEMPLO_CASO, titulo: 'Ejemplo', veces: 1 });
    expect(r.status).toBe(200);
    let estado: { enMarcha: boolean; resultados: ResultadoGuion[] } = { enMarcha: true, resultados: [] };
    await esperar(async () => {
      estado = (await api('GET', '/admin/desarrollador/vivo/guiones')).body;
      return !estado.enMarcha;
    }, 300_000, 'que terminen los casos');
    const fallidos = estado.resultados.filter((x) => !x.ok).map((x) => ({ titulo: x.titulo, paso: x.pasos.find((p) => !p.ok) }));
    expect(fallidos).toEqual([]);
    expect(estado.resultados.map((x) => x.guion).sort()).toEqual([`caso:${id}`, 'caso:sin-guardar'].sort());
    // Editar lo reemplaza, borrar lo quita.
    expect((await api('POST', '/admin/desarrollador/vivo/casos', { id, titulo: 'Reclama (editado)', texto: miCaso })).body.caso.id).toBe(id);
    expect((await api('GET', '/admin/desarrollador/vivo/casos')).body.casos).toMatchObject([{ id, titulo: 'Reclama (editado)' }]);
    const tienda2 = await tienda.app.inject({ method: 'DELETE', url: `/admin/desarrollador/vivo/casos/${id}`, headers: { cookie } });
    expect(tienda2.statusCode).toBe(200);
    expect((await api('GET', '/admin/desarrollador/vivo/casos')).body.casos).toEqual([]);
  }, 360_000);

  it('«Escribirlo con la IA» sin IA conectada dice qué hacer', async () => {
    const r = await api('POST', '/admin/desarrollador/vivo/casos/ia', { descripcion: 'un cliente que pregunta tres veces y cancela' });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('no está conectada');
    expect((await api('GET', '/admin/desarrollador/vivo/casos')).body.conIA).toBe(false);
  });

  it('un pedido de prueba nunca va a un motorizado de verdad (ni le llega nada por WhatsApp)', async () => {
    const aReal = wa.sent.filter((m) => m.to === '51944000001');
    expect(aReal).toEqual([]);
    const conReal = (await tienda.repos.desarrollador!.query<{ n: number }>(`select count(*)::int as n from entregas e join motorizados m on m.id = e.motorizado_id where m.phone = '51944000001'`)).rows[0]!.n;
    expect(conReal).toBe(0);
  });

  it('y un pedido real nunca va a un motorizado de prueba', async () => {
    const k = await api('POST', '/admin/claves-api', { nombre: 'GSG de prueba', permisos: ['entregas:gestionar', 'entregas:leer'] });
    const alta = await tienda.app.inject({
      method: 'POST',
      url: '/api/v1/entregas',
      headers: { authorization: `Bearer ${k.body.clave}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ pedidos: [{ referencia: 'R-0001', telefono: '51944000099', nombre: 'Cliente Real', distrito: 'Miraflores', lat: -12.1211, lng: -77.0301, faltaConfirmar: false }] }),
    });
    expect(alta.statusCode).toBeLessThan(300);
    await esperar(async () => {
      const [f] = (await tienda.repos.desarrollador!.query<{ phone: string | null }>(`select m.phone from entregas e left join motorizados m on m.id = e.motorizado_id where e.referencia = 'R-0001'`)).rows;
      return Boolean(f?.phone);
    }, 60_000, 'que el pedido real tenga motorizado');
    const [f] = (await tienda.repos.desarrollador!.query<{ phone: string }>(`select m.phone from entregas e join motorizados m on m.id = e.motorizado_id where e.referencia = 'R-0001'`)).rows;
    expect(f!.phone).toBe('51944000001');
    // Reasignarlo a mano a uno de prueba tampoco se deja.
    const [prueba] = (await tienda.repos.desarrollador!.query<{ id: number }>(`select id from motorizados where phone like '519001%' limit 1`)).rows;
    const [ent] = (await tienda.repos.desarrollador!.query<{ id: number }>(`select id from entregas where referencia = 'R-0001'`)).rows;
    const r = await tienda.entregas!.reasignar(ent!.id, prueba!.id, 'prueba');
    expect(r).toMatchObject({ error: expect.stringContaining('No se mezcla lo de prueba con lo real') });
  }, 120_000);
});
