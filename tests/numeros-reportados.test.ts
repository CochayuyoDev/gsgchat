/**
 * Los numeros y trackings malos que GSGchat le reporta a GSG («Luis»), su
 * bandeja, las correcciones que GSG manda de vuelta y lo que ya se hizo por
 * WhatsApp con cada tracking (ver src/entregas/reportados.ts).
 *
 * Reglas que se prueban:
 *  - cada error crea UN reporte y UN POST a GSG, sin repetirse;
 *  - la bandeja (GET /api/v1/reportados) los lista y exige clave;
 *  - una correccion cambia el pedido y vuelve a pedir la ubicacion;
 *  - reenviar un tracking ya contactado contesta `ya_contactado` con la fecha
 *    y al cliente no le llega otro mensaje;
 *  - dos trackings del mismo telefono el mismo dia: un solo mensaje,
 *    `agrupado_con`, y la ubicacion sale a GSG para los dos;
 *  - el mismo cliente otro dia es un intento nuevo: se le escribe otra vez;
 *  - el mapa de trackings del dia;
 *  - ningun GET a GSG y ningun temporizador nuevo.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, PIN_LIMA, type EscenarioEntregas } from './escenario-entregas.js';
import { CLAVE_API_PRUEBA, crearClaveDePrueba } from './fakes.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';
import { crearReportadosEnMemoria, reportarNumero, type ReportadosRepo } from '../src/entregas/reportados.js';
import { crearPuertoHttp } from '../src/rutas/gsg.js';

function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

const pedido = (tracking: string | undefined, telefono: string | undefined, extra: Record<string, unknown> = {}) => ({
  ...OBLIGATORIOS_GSG,
  ...(tracking !== undefined ? { tracking } : {}),
  cliente: `Cliente ${tracking ?? 'sin tracking'}`,
  ...(telefono !== undefined ? { telefono } : {}),
  ...extra,
});

type Cuerpo = Record<string, any>;

describe('números reportados a GSG', () => {
  let e: EscenarioEntregas;
  let reportados: ReportadosRepo & { _filas: Array<{ clave: string; error: string; estado: string }> };

  const llamar = async (method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, clave: string | null = CLAVE_API_PRUEBA) => {
    const r = await e.app.inject({ method, url, headers: clave ? { 'x-api-key': clave } : {}, ...(body === undefined ? {} : { payload: body as Record<string, unknown> }) });
    return { status: r.statusCode, body: r.json() as Cuerpo };
  };
  /** Los reportes de numeros que hay en la cola hacia GSG. */
  const enCola = async () => (await e.repos.rutas.reportesRecientes(500, 'numero_reportado')).map((r) => r.payload);
  /** Lo que el GSG falso recibio como numero reportado. */
  const recibidos = () => e.simulador.recibido.filter((r) => r.tipo === 'numero_reportado').map((r) => r.cuerpo);
  const filas = (clave: string, error: string) => reportados._filas.filter((f) => f.clave === clave && f.error === error);
  const pedidasDeUbicacion = (telefono: string) => e.mensajesA(telefono).length;

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ arranque: hoyALas9() });
    reportados = e.repos.reportados as typeof reportados;
  });
  afterAll(async () => {
    await e?.cerrar();
  });

  it('teléfono inválido: un reporte y un POST a GSG, aunque GSG mande el pedido otra vez', async () => {
    const r = await llamar('POST', '/api/v1/entregas', { pedidos: [pedido('R-INV', '12'), pedido('R-OK', '987000101')] });
    expect(r.status).toBe(201);
    expect(r.body.descartadas).toEqual([expect.objectContaining({ referencia: 'R-INV', error: 'telefono_invalido' })]);
    await llamar('POST', '/api/v1/entregas', { pedidos: [pedido('R-INV', '12')] });
    await e.despacharAGsg();
    await e.despacharAGsg();
    expect(filas('R-INV', 'telefono_invalido')).toHaveLength(1);
    expect((await enCola()).filter((p) => p.tracking === 'R-INV')).toHaveLength(1);
    const llegado = recibidos().filter((p) => p.tracking === 'R-INV');
    expect(llegado).toHaveLength(1);
    expect(llegado[0]).toMatchObject({ tipo: 'numero_reportado', tracking: 'R-INV', referencia: 'R-INV', telefono: '12', error: 'telefono_invalido' });
    expect(String(llegado[0]!.mensaje)).toMatch(/no es un número válido/);
    expect(Number.isNaN(Date.parse(String(llegado[0]!.reportadoAt)))).toBe(false);
    expect(llegado[0]!.idempotencyKey).toBeUndefined();
  });

  it('tracking que falta o no vale: la llamada se rechaza (400) y se reporta una vez', async () => {
    const sin = await llamar('POST', '/api/v1/entregas', pedido(undefined, '987000102'));
    expect(sin.status).toBe(400);
    const largo = 'T'.repeat(70);
    const malo = await llamar('POST', '/api/v1/entregas', pedido(largo, '987000103'));
    expect(malo.status).toBe(400);
    const control = await llamar('POST', '/api/v1/entregas', pedido('R-\nX', '987000104'));
    expect(control.status).toBe(400);
    await llamar('POST', '/api/v1/entregas', pedido(undefined, '987000102'));
    await llamar('POST', '/api/v1/entregas', pedido(largo, '987000103'));
    await e.despacharAGsg();
    expect(reportados._filas.filter((f) => f.error === 'tracking_falta')).toHaveLength(1);
    expect(reportados._filas.filter((f) => f.error === 'tracking_invalido')).toHaveLength(2);
    expect(recibidos().filter((p) => p.error === 'tracking_falta')).toHaveLength(1);
    expect(recibidos().filter((p) => p.error === 'tracking_invalido')).toHaveLength(2);
  });

  it('tracking duplicado en la llamada y tracking de otro pedido: no se guardan y se reportan una vez', async () => {
    const dup = await llamar('POST', '/api/v1/entregas', [pedido('R-DUP', '987000105'), pedido('R-DUP', '987000106')]);
    expect(dup.status).toBe(201);
    expect(dup.body.creadas).toHaveLength(1);
    expect(dup.body.descartadas).toEqual([expect.objectContaining({ error: 'tracking_duplicado' })]);

    const otro = await llamar('POST', '/api/v1/entregas', pedido('R-DUP', '987000107'));
    expect(otro.status).toBe(400);
    expect(JSON.stringify(otro.body)).toContain('tracking_de_otro_pedido');
    await llamar('POST', '/api/v1/entregas', pedido('R-DUP', '987000107'));
    // El pedido bueno sigue con su telefono.
    expect((await e.entrega('R-DUP'))!.phone).toBe('51987000105');
    await e.despacharAGsg();
    expect(filas('R-DUP', 'tracking_duplicado')).toHaveLength(1);
    expect(filas('R-DUP', 'tracking_de_otro_pedido')).toHaveLength(1);
    expect(recibidos().filter((p) => p.tracking === 'R-DUP')).toHaveLength(2);
  });

  it('teléfono de un motorizado: no se le escribe como cliente y se reporta', async () => {
    // La pantalla de motorizados se retiro; los que haya en la base siguen contando.
    await e.repos.entregas.crearMotorizado({ phone: '51987000150', nombre: 'Moto Uno' });
    const r = await llamar('POST', '/api/v1/entregas', pedido('R-MOTO', '987000150'));
    expect(r.status).toBe(400);
    await llamar('POST', '/api/v1/entregas', pedido('R-MOTO', '987000150'));
    expect(await e.entrega('R-MOTO')).toBeUndefined();
    expect(filas('R-MOTO', 'telefono_de_motorizado')).toHaveLength(1);
  });

  it('número sin WhatsApp: se reporta una vez aunque el motor siga trabajando', async () => {
    e.wa.tieneWhatsApp = async (phone: string) => phone !== '51987000107' && phone !== '51987000177';
    await llamar('POST', '/api/v1/entregas', pedido('R-SINWA', '987000177'));
    await e.trabajar();
    await e.trabajar();
    e.avanzar(30);
    await e.trabajar();
    expect(filas('R-SINWA', 'sin_whatsapp')).toHaveLength(1);
    expect((await enCola()).filter((p) => p.tracking === 'R-SINWA')).toHaveLength(1);
    expect(pedidasDeUbicacion('987000177')).toBe(0);
  });

  it('el envío por WhatsApp falla para siempre: se reporta como envio_fallido una vez', async () => {
    e.wa.failNext = new WhatsAppApiError('Recipient cannot be messaged', 400, 131000, 'rechazado', false);
    await llamar('POST', '/api/v1/entregas', pedido('R-FALLA', '987000108'));
    await e.trabajar();
    e.avanzar(30);
    await e.trabajar();
    expect(filas('R-FALLA', 'envio_fallido')).toHaveLength(1);
    expect((await enCola()).filter((p) => p.tracking === 'R-FALLA')).toHaveLength(1);
  });

  it('«no soy yo»: se reporta una vez', async () => {
    await llamar('POST', '/api/v1/entregas', pedido('R-NOSOY', '987000109'));
    await e.trabajar();
    expect(pedidasDeUbicacion('987000109')).toBe(1);
    await e.contesta('987000109', { texto: 'No soy yo, número equivocado' });
    await e.contesta('987000109', { texto: 'ya te dije, no soy yo' });
    expect(filas('R-NOSOY', 'no_soy_yo')).toHaveLength(1);
    await e.despacharAGsg();
    expect(recibidos().filter((p) => p.tracking === 'R-NOSOY' && p.error === 'no_soy_yo')).toHaveLength(1);
  });

  it('la bandeja de GSG lista lo reportado y exige una clave con permiso', async () => {
    const sinClave = await llamar('GET', '/api/v1/reportados', undefined, null);
    expect(sinClave.status).toBe(401);
    const otraClave = await crearClaveDePrueba(e.repos, ['mensajes:enviar']);
    expect((await llamar('GET', '/api/v1/reportados', undefined, otraClave)).status).toBe(403);
    const lectora = await crearClaveDePrueba(e.repos, ['entregas:leer'], 'lectora');
    const r = await llamar('GET', '/api/v1/reportados?estado=pendiente', undefined, lectora);
    expect(r.status).toBe(200);
    const errores = (r.body.items as Cuerpo[]).map((i) => i.error);
    for (const c of ['telefono_invalido', 'sin_whatsapp', 'envio_fallido', 'tracking_falta', 'tracking_invalido', 'tracking_duplicado', 'tracking_de_otro_pedido', 'telefono_de_motorizado', 'no_soy_yo']) expect(errores).toContain(c);
    const uno = (r.body.items as Cuerpo[]).find((i) => i.tracking === 'R-SINWA')!;
    expect(uno).toMatchObject({ tracking: 'R-SINWA', referencia: 'R-SINWA', telefono: '51987000177', error: 'sin_whatsapp', estado: 'pendiente', corregidoAt: null });
    expect(typeof uno.mensaje).toBe('string');
    expect(typeof uno.reportadoAt).toBe('string');
    // Corregir exige entregas:gestionar.
    expect((await llamar('POST', '/api/v1/reportados/R-SINWA/correccion', { telefono: '987000178' }, lectora)).status).toBe(403);
    expect((await llamar('GET', '/api/v1/reportados?estado=otro')).status).toBe(400);
    // La pantalla lee lo mismo.
    const panel = await llamar('GET', '/admin/entregas/reportados?estado=pendiente');
    expect(panel.status).toBe(200);
    expect(panel.body.items.length).toBe(r.body.items.length);
  });

  it('corrección del teléfono: el pedido cambia y se le pide la ubicación al número nuevo', async () => {
    const r = await llamar('POST', '/api/v1/reportados/R-SINWA/correccion', { telefono: '987000178' });
    expect(r.status).toBe(200);
    expect(r.body.corregidos).toEqual([expect.objectContaining({ error: 'sin_whatsapp', estado: 'corregido' })]);
    expect(r.body.entrega).toMatchObject({ referencia: 'R-SINWA', telefono: '51987000178' });
    await e.trabajar();
    expect(pedidasDeUbicacion('987000178')).toBe(1);
    expect((await e.entrega('R-SINWA'))!.phone).toBe('51987000178');
    const lista = await llamar('GET', '/api/v1/reportados?estado=corregido');
    expect((lista.body.items as Cuerpo[]).find((i) => i.tracking === 'R-SINWA')).toMatchObject({ estado: 'corregido' });
    expect((lista.body.items as Cuerpo[]).find((i) => i.tracking === 'R-SINWA')!.corregidoAt).toBeTruthy();
    // Ya corregido: 409, y sin reportado: 404.
    expect((await llamar('POST', '/api/v1/reportados/R-SINWA/correccion', { telefono: '987000179' })).status).toBe(409);
    expect((await llamar('POST', '/api/v1/reportados/NO-EXISTE/correccion', { telefono: '987000179' })).status).toBe(404);
  });

  it('corrección de un pedido que no se llegó a guardar: se crea con lo corregido y se le pide la ubicación', async () => {
    const malo = await llamar('POST', '/api/v1/reportados/R-INV/correccion', { telefono: '55' });
    expect(malo.status).toBe(400);
    const r = await llamar('POST', '/api/v1/reportados/R-INV/correccion', { telefono: '987000111' });
    expect(r.status).toBe(200);
    expect(r.body.entrega).toMatchObject({ referencia: 'R-INV', telefono: '51987000111' });
    await e.trabajar();
    expect(pedidasDeUbicacion('987000111')).toBe(1);
  });

  it('corrección por PATCH /api/v1/entregas/{referencia}: cambia el teléfono y vuelve a pedir la ubicación', async () => {
    const r = await llamar('PATCH', '/api/v1/entregas/R-FALLA', { telefono: '987000112' });
    expect(r.status).toBe(200);
    expect(r.body.cambios.join(' ')).toMatch(/teléfono corregido/);
    expect(r.body.corregidos).toEqual([expect.objectContaining({ error: 'envio_fallido', estado: 'corregido' })]);
    await e.trabajar();
    expect(pedidasDeUbicacion('987000112')).toBe(1);
    const invalido = await llamar('PATCH', '/api/v1/entregas/R-FALLA', { telefono: 'abc' });
    expect(invalido.status).toBe(400);
  });

  it('con «Confirmar y enviar» encendido, el número corregido espera a una persona', async () => {
    await e.entregas.guardarAjustes({ confirmarListaGsg: true });
    try {
      const r = await llamar('POST', '/api/v1/reportados/R-NOSOY/correccion', { telefono: '987000113' });
      expect(r.status).toBe(200);
      await e.trabajar();
      expect(pedidasDeUbicacion('987000113')).toBe(0);
      expect((await e.entrega('R-NOSOY'))!.envioRetenidoAt).toBeTruthy();
    } finally {
      await e.entregas.guardarAjustes({ confirmarListaGsg: false });
    }
  });

  it('reenviar un tracking ya contactado: ya_contactado con la fecha y ningún mensaje nuevo', async () => {
    await llamar('POST', '/api/v1/entregas', pedido('C-1', '987000120'));
    await e.trabajar();
    expect(pedidasDeUbicacion('987000120')).toBe(1);
    const otra = await llamar('POST', '/api/v1/entregas', pedido('C-1', '987000120'));
    expect(otra.status).toBe(200);
    const ficha = (otra.body.whatsapp as Cuerpo[]).find((w) => w.tracking === 'C-1')!;
    const ya = (ficha.avisos as Cuerpo[]).find((a) => a.codigo === 'ya_contactado')!;
    expect(ya.en).toBeTruthy();
    expect(ya.mensaje).toMatch(/ya se le envió mensaje por WhatsApp el \d{2}\/\d{2}\/\d{4}/);
    expect((ficha.avisos as Cuerpo[]).map((a) => a.codigo)).toContain('ubicacion_pedida');
    await e.trabajar();
    expect(pedidasDeUbicacion('987000120')).toBe(1);
  });

  it('dos trackings del mismo teléfono el mismo día: un solo mensaje, agrupado_con, y la ubicación sale para los dos', async () => {
    const r = await llamar('POST', '/api/v1/entregas', [pedido('G-1', '987000130'), pedido('G-2', '987000130')]);
    expect(r.status).toBe(201);
    const g2 = (r.body.whatsapp as Cuerpo[]).find((w) => w.tracking === 'G-2')!;
    expect((g2.avisos as Cuerpo[]).find((a) => a.codigo === 'agrupado_con')).toMatchObject({ con: 'G-1' });
    await e.trabajar();
    expect(pedidasDeUbicacion('987000130')).toBe(1);
    // Un tercer tracking mas tarde, con la peticion aun abierta: tampoco se le escribe otra vez.
    const tarde = await llamar('POST', '/api/v1/entregas', pedido('G-3', '987000130'));
    expect(tarde.status).toBe(201);
    const g3 = (tarde.body.whatsapp as Cuerpo[]).find((w) => w.tracking === 'G-3')!;
    expect((g3.avisos as Cuerpo[]).map((a) => a.codigo)).toEqual(expect.arrayContaining(['ya_contactado', 'agrupado_con']));
    await e.trabajar();
    expect(pedidasDeUbicacion('987000130')).toBe(1);
    await e.contesta('987000130', { pin: PIN_LIMA });
    const ubicaciones = (await e.repos.rutas.reportesRecientes(500, 'ubicacion')).map((x) => x.payload.tracking);
    expect(ubicaciones).toEqual(expect.arrayContaining(['G-1', 'G-2', 'G-3']));
    const otra = await llamar('POST', '/api/v1/entregas', pedido('G-2', '987000130'));
    const ficha = (otra.body.whatsapp as Cuerpo[]).find((w) => w.tracking === 'G-2')!;
    expect((ficha.avisos as Cuerpo[]).map((a) => a.codigo)).toEqual(expect.arrayContaining(['ya_contactado', 'ubicacion_registrada']));
  });

  it('el mapa de trackings del día dice lo hecho por WhatsApp con cada uno', async () => {
    const dia = e.entregas.diaDeHoy();
    const r = await llamar('GET', `/api/v1/trackings?dia=${dia}`);
    expect(r.status).toBe(200);
    const por = new Map((r.body.trackings as Cuerpo[]).map((t) => [t.tracking, t]));
    expect(por.get('C-1')).toMatchObject({ contactado: true, ubicacion: { estado: 'pendiente', pedida: true } });
    expect(por.get('C-1')!.mensaje.enviadoEn).toBeTruthy();
    expect(por.get('C-1')!.ubicacion.veces).toBeGreaterThanOrEqual(1);
    expect(por.get('G-1')).toMatchObject({ contactado: true, ubicacion: { estado: 'registrada' } });
    expect(por.get('G-1')!.agrupadoCon).toEqual(expect.arrayContaining(['G-2', 'G-3']));
    expect(por.get('R-SINWA')!.reportes).toEqual([expect.objectContaining({ error: 'sin_whatsapp', estado: 'corregido' })]);
    expect((por.get('R-SINWA')!.avisos as Cuerpo[]).map((a) => a.codigo)).toContain('corregido');
    expect(por.get('R-OK')).toMatchObject({ telefono: '51987000101' });
    // Otro dia sin pedidos: vacio. Un dia mal escrito: 400. Sin clave: 401.
    expect((await llamar('GET', '/api/v1/trackings?dia=2001-01-01')).body.total).toBe(0);
    expect((await llamar('GET', '/api/v1/trackings?dia=ayer')).status).toBe(400);
    expect((await llamar('GET', '/api/v1/trackings', undefined, null)).status).toBe(401);
  });

  it('el mismo cliente al día siguiente es un intento nuevo: se le escribe otra vez', async () => {
    const antes = pedidasDeUbicacion('987000120');
    e.avanzar(24 * 60);
    const r = await llamar('POST', '/api/v1/entregas', pedido('C-1', '987000120'));
    expect(r.status).toBe(201);
    const ficha = (r.body.whatsapp as Cuerpo[]).find((w) => w.tracking === 'C-1')!;
    expect((ficha.avisos as Cuerpo[]).map((a) => a.codigo)).not.toContain('ya_contactado');
    await e.trabajar();
    expect(pedidasDeUbicacion('987000120')).toBe(antes + 1);
  });

  it('a GSG solo le salen POST: ninguna consulta (GET)', () => {
    expect(e.llamadasAGsg.length).toBeGreaterThan(0);
    expect(e.llamadasAGsg.every((l) => l.metodo === 'POST')).toBe(true);
    expect(e.llamadasAGsg.some((l) => l.ruta === '/numeros-reportados')).toBe(true);
  });
});

describe('reportar un número (sin servidor)', () => {
  it('una vez por tracking + error; tras corregirlo, si vuelve, se reporta otra vez; sin temporizadores', async () => {
    const intervalos = vi.spyOn(globalThis, 'setInterval');
    const cola: Array<Record<string, unknown>> = [];
    const repos = { reportados: crearReportadosEnMemoria(), rutas: { encolarReporte: async (r: { payload: Record<string, unknown> }) => { cola.push(r.payload); return {} as never; } } as never };
    const n = { error: 'sin_whatsapp' as const, dia: '2026-10-10', tracking: 'X-1', referencia: 'X-1', telefono: '51987000001' };
    expect(await reportarNumero({ repos }, n)).toBeTruthy();
    expect(await reportarNumero({ repos }, n)).toBeNull();
    expect(cola).toHaveLength(1);
    await repos.reportados.marcarCorregidos('X-1', { telefono: '51987000002' }, new Date());
    const otra = await reportarNumero({ repos }, n);
    expect(otra).toMatchObject({ estado: 'pendiente', veces: 2 });
    expect(cola).toHaveLength(2);
    expect(cola[0]!.idReporte).not.toBe(cola[1]!.idReporte);
    expect(intervalos).not.toHaveBeenCalled();
    intervalos.mockRestore();
  });

  it('el POST a GSG va a la ruta configurable, con X-API-Key e Idempotency-Key', async () => {
    const llamadas: Array<{ url: string; init: RequestInit }> = [];
    const puerto = crearPuertoHttp({ url: 'https://gsg.example/api/', rutaUbicacion: 'v1/gsgchat/location', rutaReportados: 'v1/gsgchat/reportados', token: 'clave-de-gsg-123', fetchImpl: (async (url: string, init: RequestInit) => { llamadas.push({ url, init }); return new Response('{"id":"R1"}', { status: 201 }); }) as never });
    const r = await puerto.enviar('numero_reportado', { tipo: 'numero_reportado', tracking: 'X-1', error: 'sin_whatsapp', idReporte: 'gsgchat-reportado-1-1', idempotencyKey: 'gsgchat-ubicacion-9' });
    expect(r).toMatchObject({ ok: true, id: 'R1' });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.url).toBe('https://gsg.example/api/v1/gsgchat/reportados');
    expect(llamadas[0]!.init.method).toBe('POST');
    const h = new Headers(llamadas[0]!.init.headers);
    expect(h.get('x-api-key')).toBe('clave-de-gsg-123');
    expect(h.get('idempotency-key')).toBe('gsgchat-reportado-1-1');
    expect(JSON.parse(String(llamadas[0]!.init.body))).toEqual({ tipo: 'numero_reportado', tracking: 'X-1', error: 'sin_whatsapp', idReporte: 'gsgchat-reportado-1-1' });
    // Sin ruta propia: <base>/numeros-reportados.
    const porDefecto = crearPuertoHttp({ url: 'https://gsg.example/api/', rutaUbicacion: 'sendLocation', token: 'clave-de-gsg-123', fetchImpl: (async (url: string, init: RequestInit) => { llamadas.push({ url, init }); return new Response('{}', { status: 200 }); }) as never });
    await porDefecto.enviar('numero_reportado', { idReporte: 'a' });
    expect(llamadas[1]!.url).toBe('https://gsg.example/api/numeros-reportados');
  });
});

describe('la pantalla «Números reportados»', () => {
  it('sale en Pedidos GSG junto a la bandeja de errores y su JS compila', async () => {
    const { pedidosPage } = await import('../src/web/pedidos-page.js');
    const html = pedidosPage({ disponible: true, demo: false, nombreNegocio: 'Prueba' });
    expect(html).toContain('id="numeros-reportados"');
    expect(html.indexOf('id="bandeja-mensajes"')).toBeLessThan(html.indexOf('id="numeros-reportados"'));
    expect(html).toContain('/admin/entregas/reportados');
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).filter((c) => c.includes('cargarNumerosReportados'));
    expect(scripts.length).toBeGreaterThan(0);
    for (const codigo of scripts) expect(() => new Function(codigo)).not.toThrow();
  });
});
