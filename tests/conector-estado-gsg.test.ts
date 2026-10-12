/**
 * El conector del endpoint de estado de GSG (pedido del dueño, 12/10): antes
 * de escribirle a un cliente se le pregunta a GSG por cada tracking. Si GSG
 * dice cancelado, numero incorrecto, tracking incorrecto o no se puede
 * contactar, se deja de escribir SOLO por ese tracking; los otros envios del
 * mismo cliente siguen. Una falla de GSG nunca se toma como cancelacion.
 */

import { describe, expect, it, vi } from 'vitest';
import { crearPuertoHttp, interpretarEstadoGsg } from '../src/rutas/gsg.js';
import { telefonoParaGsg } from '../src/entregas/servicio.js';
import { connectPage } from '../src/web/connect-page.js';
import { OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import { ajustesPorDefecto } from '../src/rutas/ajustes.js';
import { crearEscenarioEntregas, PAUSA_SEGUNDOS, type EscenarioEntregas } from './escenario-entregas.js';

describe('interpretar lo que contesta GSG', () => {
  it.each([
    [{ estado: 'CANCELADO' }, 'cancelado'],
    [{ status: 'cancelled' }, 'cancelado'],
    [{ data: { estado: 'Anulado por la empresa' } }, 'cancelado'],
    [{ cancelado: true }, 'cancelado'],
    [{ estado: 'NUMERO_INCORRECTO' }, 'numero_incorrecto'],
    [{ motivo: 'El número está mal' }, 'numero_incorrecto'],
    [{ telefonoIncorrecto: true }, 'numero_incorrecto'],
    [{ estado: 'TRACKING_INCORRECTO' }, 'tracking_incorrecto'],
    [{ mensaje: 'El código de tracking no existe' }, 'tracking_incorrecto'],
    [{ estado: 'NO_CONTACTABLE' }, 'no_contactable'],
    [{ motivo: 'No se puede comunicar con el cliente' }, 'no_contactable'],
    [{ contactable: false }, 'no_contactable'],
    [{ estado: 'ACTIVO' }, 'activo'],
    [{ status: 'pending' }, 'activo'],
    [{ estado: 'EN RUTA' }, 'activo'],
    [{ estado: 'algo raro' }, 'desconocido'],
    [{}, 'desconocido'],
    [null, 'desconocido'],
  ] as const)('%j → %s', (cuerpo, decision) => {
    expect(interpretarEstadoGsg(cuerpo).decision).toBe(decision);
  });

  it('el teléfono va como lo maneja GSG: 9 dígitos, sin el 51', () => {
    expect(telefonoParaGsg('51987654321')).toBe('987654321');
    expect(telefonoParaGsg('987654321')).toBe('987654321');
  });
});

describe('el GET de la consulta', () => {
  const respuesta = (status: number, cuerpo: unknown) => new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

  it('va a base + ruta con tracking y teléfono, la clave SOLO en X-API-Key y sin seguir redirecciones', async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, { estado: 'CANCELADO' }));
    const p = crearPuertoHttp({ url: 'https://gsg.example/api/', token: 'clave-gsg-123', rutaEstado: 'v1/gsgchat/estado', paramTracking: 'trackingCode', paramTelefono: 'phone', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(p.urlEstado?.()).toBe('https://gsg.example/api/v1/gsgchat/estado');
    const r = await p.consultarEstado!({ tracking: 'PED 1/2', telefono: '987654321' });
    expect(r).toMatchObject({ decision: 'cancelado', configurada: true, http: 200 });
    const [url, opciones] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://gsg.example/api/v1/gsgchat/estado');
    expect(u.searchParams.get('trackingCode')).toBe('PED 1/2');
    expect(u.searchParams.get('phone')).toBe('987654321');
    expect(opciones.method).toBe('GET');
    expect(opciones.redirect).toBe('error');
    expect(opciones.headers['X-API-Key'] ?? opciones.headers['x-api-key']).toBe('clave-gsg-123');
    expect(opciones.headers.authorization ?? opciones.headers.Authorization).toBeUndefined();
  });

  it('los nombres de los parámetros los pone GSG', async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, { estado: 'ACTIVO' }));
    const p = crearPuertoHttp({ url: 'https://gsg.example/api', token: 'clave-gsg-123', rutaEstado: 'estado', paramTracking: 'codigo', paramTelefono: 'celular', fetchImpl: fetchImpl as unknown as typeof fetch });
    await p.consultarEstado!({ tracking: 'X1', telefono: '987654321' });
    const u = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(u.searchParams.get('codigo')).toBe('X1');
    expect(u.searchParams.get('celular')).toBe('987654321');
  });

  it('sin ruta configurada no llama a GSG', async () => {
    const fetchImpl = vi.fn();
    const p = crearPuertoHttp({ url: 'https://gsg.example/api', token: 'clave-gsg-123', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(p.urlEstado?.()).toBeNull();
    expect(await p.consultarEstado!({ tracking: 'X', telefono: '' })).toMatchObject({ decision: 'desconocido', configurada: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('401/403 es problema de conexión; 500, 404 de ruta o la red caída son «desconocido», nunca cancelado', async () => {
    for (const [status, cuerpo, auth] of [[401, { error: 'x' }, 401], [403, {}, 403], [500, 'error', undefined], [404, '<html>Not Found</html>', undefined]] as const) {
      const p = crearPuertoHttp({ url: 'https://gsg.example/api', token: 'clave-gsg-123', rutaEstado: 'estado', fetchImpl: (async () => respuesta(status, cuerpo)) as unknown as typeof fetch });
      const r = await p.consultarEstado!({ tracking: 'X', telefono: '987654321' });
      expect(r.decision, String(status)).toBe('desconocido');
      expect(r.autenticacion).toBe(auth);
      expect(r.motivo).not.toContain('clave-gsg-123');
    }
    const caido = crearPuertoHttp({ url: 'https://gsg.example/api', token: 'clave-gsg-123', rutaEstado: 'estado', fetchImpl: (async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }) as unknown as typeof fetch });
    expect((await caido.consultarEstado!({ tracking: 'X', telefono: '' })).decision).toBe('desconocido');
    // Un 404 que dice «ese tracking no existe» si cuenta como tracking incorrecto.
    const noExiste = crearPuertoHttp({ url: 'https://gsg.example/api', token: 'clave-gsg-123', rutaEstado: 'estado', fetchImpl: (async () => respuesta(404, { estado: 'TRACKING_INCORRECTO' })) as unknown as typeof fetch });
    expect((await noExiste.consultarEstado!({ tracking: 'X', telefono: '' })).decision).toBe('tracking_incorrecto');
  });
});

// ------------------------------------------------------- con el flujo entero

const GSG = { empresa: { codigo: 'T01', nombre: 'Tienda Prueba' }, metodoPago: 'Contraentrega', montoCobrar: 40 };

function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** Un GSG de mentira: el estado de cada tracking se puede cambiar en la prueba; lo demas contesta 201. */
function gsgFalso() {
  const estados = new Map<string, unknown>();
  const consultas: Array<{ tracking: string | null; telefono: string | null }> = [];
  let caido = false;
  const fetchImpl = (async (url: string, opciones?: RequestInit) => {
    const u = new URL(url);
    if ((opciones?.method ?? 'GET') === 'GET' && u.pathname.endsWith('/v1/estado')) {
      consultas.push({ tracking: u.searchParams.get('trackingCode'), telefono: u.searchParams.get('phone') });
      if (caido) throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      return new Response(JSON.stringify(estados.get(u.searchParams.get('trackingCode') ?? '') ?? { estado: 'ACTIVO' }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'GSG-1' }), { status: 201 });
  }) as unknown as typeof fetch;
  return { estados, consultas, fetchImpl, caer: (si: boolean) => { caido = si; } };
}

async function armar(gsg: ReturnType<typeof gsgFalso>): Promise<EscenarioEntregas> {
  const e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true, geocodificador: null, fetchGsg: gsg.fetchImpl });
  await e.entregas.guardarAjustes({ soporte: { whatsapp: '987654321', llamadas: '' } });
  const base = ajustesPorDefecto({ ...OPCIONES_POR_DEFECTO, pausaMinSegundos: PAUSA_SEGUNDOS, pausaMaxSegundos: PAUSA_SEGUNDOS, horaInicio: 0, horaFin: 24 });
  await e.repos.rutas.ajustes.set({ esperaRespuestaMinutos: 30, maxIntentos: 3 }, base);
  // Lo mismo que «Guardar» en Conexión (esa ruta exige una persona administradora, no una clave).
  const con = await e.conexionGsg.conectarReal({ url: 'https://gsg.example/api', rutaUbicacion: 'sendLocation', rutaEstado: 'v1/estado', apiKey: 'clave-gsg-123' });
  expect(con.destinoEstado).toBe('https://gsg.example/api/v1/estado');
  return e;
}

async function trabajar(e: EscenarioEntregas, vueltas = 3) {
  for (let i = 0; i < vueltas; i++) {
    await e.trabajar();
    e.avanzar(1);
  }
}

const enviar = (e: EscenarioEntregas, trackings: string[], telefono: string) =>
  e.api.post<any>('/api/v1/entregas', { pedidos: trackings.map((tracking) => ({ ...GSG, tracking, cliente: 'Cliente Tres Envíos', telefono })) });

const pedido = async (e: EscenarioEntregas, ref: string) => (await e.api.get<any>(`/api/v1/entregas/${ref}`)).body;

describe('antes de escribirle, GSG dice si sigue', () => {
  it('mismo cliente con 3 trackings y GSG cancela uno: ese se para, a los otros dos se les pide la ubicación', async () => {
    const gsg = gsgFalso();
    const e = await armar(gsg);
    try {
      const tel = '987750001';
      gsg.estados.set('PED-B', { estado: 'CANCELADO', motivo: 'la tienda anuló el envío' });
      expect((await enviar(e, ['PED-A', 'PED-B', 'PED-C'], tel)).status).toBe(201);
      await trabajar(e);
      // Se le pregunto a GSG por los tres, con el telefono en 9 digitos.
      expect(new Set(gsg.consultas.map((c) => c.tracking))).toEqual(new Set(['PED-A', 'PED-B', 'PED-C']));
      expect(gsg.consultas.every((c) => c.telefono === tel)).toBe(true);
      const b = await pedido(e, 'PED-B');
      expect(b.entrega.estado).toBe('cancelada');
      expect(b.eventos.some((x: any) => /GSG: el envío fue cancelado/.test(x.detalle) && /otros envíos/.test(x.detalle))).toBe(true);
      for (const ref of ['PED-A', 'PED-C']) {
        const x = await pedido(e, ref);
        expect(x.entrega.estado, ref).not.toBe('cancelada');
        expect(x.entrega.estado, ref).not.toBe('incidencia');
      }
      // Al cliente si le llega la solicitud (por A y C).
      expect(e.mensajesA(tel).some((m) => String(m.kind) === 'location_request')).toBe(true);
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('número incorrecto en su único tracking: no se le escribe nada y queda «necesita atención» con el motivo', async () => {
    const gsg = gsgFalso();
    const e = await armar(gsg);
    try {
      const tel = '987750002';
      gsg.estados.set('PED-N', { estado: 'NUMERO_INCORRECTO' });
      expect((await enviar(e, ['PED-N'], tel)).status).toBe(201);
      await trabajar(e);
      expect(e.mensajesA(tel)).toHaveLength(0);
      const n = await pedido(e, 'PED-N');
      expect(n.entrega.estado).toBe('incidencia');
      expect(n.eventos.some((x: any) => /el número es incorrecto/.test(x.detalle))).toBe(true);
      const sols = await e.repos.rutas.listarSolicitudes({ q: tel, limit: 10, offset: 0 });
      expect(sols.every((s) => !['pendiente', 'enviado', 'respondio'].includes(s.estado))).toBe(true);
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('GSG caído: no se toma como cancelado, al cliente se le escribe igual', async () => {
    const gsg = gsgFalso();
    gsg.caer(true);
    const e = await armar(gsg);
    try {
      const tel = '987750003';
      expect((await enviar(e, ['PED-CAIDO'], tel)).status).toBe(201);
      await trabajar(e);
      expect(gsg.consultas.length).toBeGreaterThan(0);
      expect(e.mensajesA(tel).length).toBeGreaterThan(0);
      expect((await pedido(e, 'PED-CAIDO')).entrega.estado).not.toBe('cancelada');
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('cancelado DESPUÉS del primer mensaje: el recordatorio ya no sale', async () => {
    const gsg = gsgFalso();
    const e = await armar(gsg);
    try {
      const tel = '987750004';
      expect((await enviar(e, ['PED-TARDE'], tel)).status).toBe(201);
      await trabajar(e);
      const tras = e.mensajesA(tel).length;
      expect(tras).toBeGreaterThan(0);
      gsg.estados.set('PED-TARDE', { estado: 'CANCELADO' });
      for (let i = 0; i < 3; i++) {
        e.avanzar(31);
        await e.trabajar();
      }
      expect(e.mensajesA(tel).length, 'ni un recordatorio').toBe(tras);
      expect((await pedido(e, 'PED-TARDE')).entrega.estado).toBe('cancelada');
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('Conexión: «Consultar a GSG» dice la decisión sin cambiar el pedido', async () => {
    const gsg = gsgFalso();
    const e = await armar(gsg);
    try {
      gsg.estados.set('PED-P', { estado: 'NO_CONTACTABLE' });
      const r = await e.api.post<any>('/admin/entregas/gsg/consultar-estado', { tracking: 'PED-P', telefono: '51987750005' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true, decision: 'no_contactable', para: true, url: 'https://gsg.example/api/v1/estado' });
      expect(gsg.consultas.at(-1)).toEqual({ tracking: 'PED-P', telefono: '987750005' });
      const sin = await e.api.post<any>('/admin/entregas/gsg/consultar-estado', {});
      expect(sin.status).toBe(400);
    } finally {
      await e.cerrar();
    }
  }, 90_000);
});

describe('la pantalla de Conexión', () => {
  it('trae la ruta de consulta, sus parámetros, el probador y un script que compila', () => {
    const html = connectPage({ labels: {} as never, nombreNegocio: 'Prueba', demo: false, conGsg: true });
    for (const id of ['gsg-ruta-estado', 'gsg-param-tracking', 'gsg-param-telefono', 'gsg-url-estado', 'gsg-consulta-form', 'gsg-consulta-resultado']) expect(html, id).toContain(`id="${id}"`);
    for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      if (!m[1]!.trim()) continue;
      expect(() => new Function(m[1]!)).not.toThrow();
    }
  });
});
