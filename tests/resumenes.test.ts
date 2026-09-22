/**
 * El resumen del dia al supervisor: el texto fijo con las cifras del sistema,
 * la IA que redacta (y se le rechaza si toca una cifra), el ticker con reloj
 * falso (una vez por franja y dia, reintento si WhatsApp estaba caido) y las
 * rutas de la pantalla.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import type { ResumenEntregas } from '../src/entregas/servicio.js';
import { cifrasDe, crearServicioResumenes, numerosDe, respetaLasCifras, textoFijo, type CifrasResumen, type ServicioResumenes } from '../src/resumenes/servicio.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, createMemorySettingsRepo, type FakeRepos, type FakeWhatsApp, CLAVE_API_PRUEBA } from './fakes.js';

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
  BUSINESS_NAME: 'GSG Reparto',
  TIMEZONE: 'America/Lima',
} as NodeJS.ProcessEnv;
const config = loadConfig(ENV);
const URL = 'http://localhost:3000';

const queue: OutboundQueue = {
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

/** Un dia cualquiera en Lima (UTC-5): las 08:31 de Lima son las 13:31Z. */
const limaA = (hhmm: string, dia = '2026-09-21'): Date => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 8, Number(dia.slice(8, 10)), (h ?? 0) + 5, m ?? 0, 0));
};

/** Lo que Hoy ensena, con lo justo para las cifras. */
function resumenDePrueba(extra: Partial<ResumenEntregas['cifras']> = {}): ResumenEntregas {
  const cifras = { pendiente: 0, esperando_ubicacion: 10, esperando_confirmacion: 15, lista: 4, esperando_motorizado: 0, avisada: 3, entregada: 20, terminada: 5, cancelada: 1, incidencia: 2, total: 62, faltaUbicacion: 10, faltaConfirmacion: 15, conMotorizado: 3, enCamino: 3, ...extra };
  const fila = (referencia: string, estado: string, incidenciaDetalle: string | null = null) => ({ referencia, nombre: 'Cliente ' + referencia, phone: '51987000001', estado, incidencia: incidenciaDetalle ? 'no_entregado' : null, incidenciaDetalle }) as unknown as ResumenEntregas['entregas'][number];
  return {
    dia: '2026-09-21',
    cifras: cifras as ResumenEntregas['cifras'],
    entregas: [fila('P-1001', 'avisada'), fila('P-1002', 'esperando_confirmacion'), fila('P-1003', 'incidencia', 'el cliente no estaba'), fila('P-1004', 'incidencia', 'pidió otro día'), fila('P-1005', 'entregada')],
    motorizados: [
      { id: 1, nombre: 'Kevin Aguilar', estado: 'activo', entregasHoy: 12 },
      { id: 2, nombre: 'Rosa Díaz', estado: 'activo', entregasHoy: 8 },
      { id: 3, nombre: 'Luis', estado: 'descanso', entregasHoy: 0 },
    ] as unknown as ResumenEntregas['motorizados'],
    gsg: { modo: 'real', conectada: true, descripcion: 'conectado a la API de GSG' } as unknown as ResumenEntregas['gsg'],
    gsgCola: { pendiente: 0, enviado: 40, fallido: 1 },
  } as unknown as ResumenEntregas;
}

describe('el texto fijo y las cifras', () => {
  const cifras: CifrasResumen = cifrasDe(resumenDePrueba(), { whatsappConectado: true, dia: '2026-09-21' });

  it('las cifras salen de lo que ensena Hoy', () => {
    expect(cifras.total).toBe(62);
    expect(cifras.entregadas).toBe(25);
    expect(cifras.sinTerminar).toBe(2);
    expect(cifras.motorizadosActivos).toBe(2);
    expect(cifras.incidencias.map((i) => i.referencia)).toEqual(['P-1003', 'P-1004']);
    expect(cifras.mejorMotorizado).toEqual({ nombre: 'Kevin Aguilar', entregas: 12 });
    expect(cifras.reportesFallidos).toBe(1);
  });

  it('el de la mañana dice como arranca el dia, con enlace a Hoy', () => {
    const t = textoFijo('manana', cifras, { negocio: 'GSG Reparto', timezone: 'America/Lima', url: URL });
    expect(t).toContain('Buenos días');
    expect(t).toContain('Pedidos de hoy: 62');
    expect(t).toContain('falta ubicación: 10');
    expect(t).toContain('Motorizados activos: 2');
    expect(t).toContain('Necesitan a alguien: 2 (P-1003, P-1004)');
    expect(t).toContain('Reportes que GSG no aceptó: 1');
    expect(t.trim().endsWith(`${URL}/hoy`)).toBe(true);
  });

  it('el de la tarde dice como cerro: entregados, sin terminar, incidencias y quien entrego mas', () => {
    const t = textoFijo('tarde', cifras, { negocio: 'GSG Reparto', timezone: 'America/Lima', url: URL });
    expect(t).toContain('Entregados: 25 de 62');
    expect(t).toContain('Sin terminar: 2 (P-1001, P-1002)');
    expect(t).toContain('P-1003: el cliente no estaba');
    expect(t).toContain('Cancelado: 1');
    expect(t).toContain('Quien más entregó: Kevin Aguilar (12)');
  });

  it('el de la tarde lleva el cuadre con GSG en palabras cuando hay conexión, y no por la mañana', async () => {
    const t = textoFijo('tarde', { ...cifras, cuadreGsg: 'No cuadra: 1 cerrado(s) aquí que GSG no tiene como terminados (P-1010); 0 terminado(s) en GSG que aquí siguen abiertos.' }, { negocio: 'GSG Reparto', timezone: 'America/Lima', url: URL });
    expect(t).toContain('Cuadre con GSG: No cuadra: 1 cerrado(s)');
    const m = textoFijo('manana', { ...cifras, cuadreGsg: 'lo que sea' }, { negocio: 'GSG Reparto', timezone: 'America/Lima', url: URL });
    expect(m).not.toContain('Cuadre con GSG');
    // Por el servicio: el cuadre se pide solo por la tarde y solo con GSG conectado.
    const pedidos: string[] = [];
    const sender = { send: async () => ({ ok: true }) } as unknown as import('../src/outbound/sender.js').Sender;
    const servicio = await crearServicioResumenes({
      settingsRepo: createMemorySettingsRepo(),
      sender,
      ajustes: () => ({ activo: true, horaManana: '08:30', horaTarde: '18:30' }),
      supervisor: () => '51912426667',
      nombreNegocio: () => 'GSG Reparto',
      entregas: { resumen: async () => resumenDePrueba() },
      gsgExtras: () => ({ cuadrar: async (dia?: string) => { pedidos.push(dia ?? ''); return { resumen: 'Cuadra: 25 entregados aquí y 25 terminados en GSG.' }; } }),
      timezone: 'America/Lima',
      publicBaseUrl: URL,
    });
    const tarde = await servicio.redactar('tarde');
    expect(tarde.texto).toContain('Cuadre con GSG: Cuadra: 25 entregados');
    expect(pedidos).toHaveLength(1);
    const manana = await servicio.redactar('manana');
    expect(manana.texto).not.toContain('Cuadre con GSG');
    expect(pedidos).toHaveLength(1);
  });

  it('sin pedidos ni WhatsApp lo dice sin cifras inventadas', () => {
    const vacias = cifrasDe(null, { whatsappConectado: false, dia: '2026-09-21' });
    const t = textoFijo('manana', vacias, { negocio: 'GSG', timezone: 'America/Lima', url: URL });
    expect(t).toContain('WhatsApp no está conectado');
    expect(t).toContain('GSG no está conectado, hay que pegar la lista');
    expect(t).toContain('No hay ningún motorizado activo');
  });

  it('numerosDe saca los numeros tal cual', () => {
    expect(numerosDe('62 pedidos, P-1003 y 08 minutos')).toEqual(['62', '1003', '8']);
  });

  it('la IA respeta las cifras solo si no cambia ni inventa ninguna', () => {
    const fijo = textoFijo('manana', cifras, { negocio: 'GSG Reparto', timezone: 'America/Lima', url: URL });
    const bueno = `Buen día. Arrancamos con 62 pedidos: a 10 les falta la ubicación y a 15 confirmar; 4 listos para salir y 3 en camino. Hay 2 motorizados activos y GSG está conectado. Ojo con los 2 que necesitan a alguien (P-1003 y P-1004) y con 1 reporte que GSG no aceptó. Es 21 de septiembre.\nLo ves en ${URL}/hoy`;
    expect(respetaLasCifras(bueno, fijo, URL)).toBe(true);
    // Cambia una cifra (60 en vez de 62).
    expect(respetaLasCifras(bueno.replace('62 pedidos', '60 pedidos'), fijo, URL)).toBe(false);
    // Inventa una hora.
    expect(respetaLasCifras(bueno + ' Llegan a las 9.', fijo, URL)).toBe(false);
    // Se calla una cifra que estaba (los 15 por confirmar).
    expect(respetaLasCifras(bueno.replace('a 15 confirmar', 'a varios confirmar'), fijo, URL)).toBe(false);
  });
});

describe('el servicio: cuando sale, a quien, y que pasa si no puede', () => {
  let repos: FakeRepos;
  let wa: FakeWhatsApp;
  let servicio: ServicioResumenes;
  let ahora = limaA('08:00');
  let supervisor = '51900000000';
  let iaRespuesta: string | null = null;
  const activo = { activo: true, horaManana: '08:30', horaTarde: '18:30' };
  let ajustes = { ...activo };
  let resumen = resumenDePrueba();

  const textosAlSupervisor = () => wa.sent.filter((s) => s.kind !== 'read' && s.to === supervisor).map((s) => String(s.body ?? s.text ?? ''));

  beforeAll(async () => {
    repos = createFakeRepos();
    wa = createFakeWhatsApp();
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 5000, growth: 2, hardCap: 10000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false, now: () => ahora });
    servicio = await crearServicioResumenes({
      settingsRepo: createMemorySettingsRepo(),
      sender,
      ajustes: () => ajustes,
      supervisor: () => supervisor,
      nombreNegocio: () => 'GSG Reparto',
      entregas: { resumen: async () => resumen },
      ia: () => (iaRespuesta === null ? null : { completar: async () => iaRespuesta! }),
      whatsappConectado: () => true,
      timezone: 'America/Lima',
      publicBaseUrl: URL,
      ahora: () => ahora,
    });
  });

  it('antes de la hora no manda nada; a la hora manda el de la mañana una sola vez', async () => {
    ahora = limaA('08:10');
    expect(await servicio.tick()).toBeNull();
    ahora = limaA('08:31');
    const r = await servicio.tick();
    expect(r).toEqual({ franja: 'manana', ok: true, motivo: undefined });
    expect(textosAlSupervisor()).toHaveLength(1);
    expect(textosAlSupervisor()[0]).toContain('Pedidos de hoy: 62');
    // Un minuto despues no se repite.
    ahora = limaA('08:32');
    expect(await servicio.tick()).toBeNull();
    const e = servicio.estado();
    expect(e.ultimos.manana?.ok).toBe(true);
    expect(e.ultimos.manana?.conIA).toBe(false);
    expect(e.proximo).toEqual({ franja: 'tarde', hora: '18:30', hoy: true });
  });

  it('pasada la ventana de hora y media ya no sale (queda para mañana)', async () => {
    ahora = limaA('20:30');
    expect(await servicio.tick()).toBeNull();
    expect(servicio.estado().ultimos.tarde).toBeNull();
  });

  it('el de la tarde sale a su hora, y con la IA si respeta las cifras', async () => {
    ahora = limaA('18:35');
    iaRespuesta = `Buenas tardes. Cerramos con 25 entregados de 62, 3 en camino y 2 sin terminar (P-1001, P-1002). Necesitan a alguien 2: P-1003 (el cliente no estaba) y P-1004 (pidió otro día). Hubo 1 cancelado y 1 reporte que GSG no aceptó. Kevin Aguilar entregó 12. 21 de septiembre.\nLo ves en ${URL}/hoy`;
    const r = await servicio.tick();
    expect(r?.ok).toBe(true);
    const u = servicio.estado().ultimos.tarde!;
    expect(u.conIA).toBe(true);
    expect(u.texto).toContain('Kevin Aguilar entregó 12');
  });

  it('si la IA toca una cifra, sale el texto fijo', async () => {
    iaRespuesta = 'Cerramos con 30 entregados de 62. Lo ves en ' + URL + '/hoy';
    const r = await servicio.mandar('tarde', { quien: 'Ali', forzar: true });
    expect(r.ok).toBe(true);
    expect(r.conIA).toBe(false);
    expect(r.texto).toContain('Entregados: 25 de 62');
    expect(servicio.estado().ultimos.tarde?.quien).toBe('Ali');
    iaRespuesta = null;
  });

  it('sin supervisor no hay a quien mandarlo, y lo dice', async () => {
    supervisor = '';
    const r = await servicio.mandar('manana', { forzar: true });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('supervisor');
    ahora = limaA('08:40', '2026-09-22');
    expect(await servicio.tick()).toBeNull();
    supervisor = '51900000000';
  });

  it('si WhatsApp rechaza, queda anotado y se reintenta a los diez minutos', async () => {
    const antes = textosAlSupervisor().length;
    ahora = limaA('08:40', '2026-09-22');
    wa.failNext = new Error('sin red');
    const r1 = await servicio.tick();
    expect(r1).toMatchObject({ franja: 'manana', ok: false });
    expect(servicio.estado().ultimos.manana?.ok).toBe(false);
    expect(servicio.estado().ultimos.manana?.motivo).toBeTruthy();
    // Cinco minutos despues todavia no; a los diez, si.
    ahora = limaA('08:45', '2026-09-22');
    expect(await servicio.tick()).toBeNull();
    ahora = limaA('08:51', '2026-09-22');
    const r2 = await servicio.tick();
    expect(r2?.ok).toBe(true);
    expect(textosAlSupervisor().length).toBe(antes + 1);
  });

  it('apagado, no manda nada', async () => {
    ajustes = { ...activo, activo: false };
    ahora = limaA('18:35', '2026-09-22');
    expect(await servicio.tick()).toBeNull();
    expect(servicio.estado().proximo).toBeNull();
    ajustes = { ...activo };
  });

  it('las cifras cambian con lo que ensena Hoy', async () => {
    resumen = resumenDePrueba({ total: 5, faltaUbicacion: 1, faltaConfirmacion: 0 });
    const c = await servicio.cifras();
    expect(c.total).toBe(5);
    expect(c.faltaUbicacion).toBe(1);
    resumen = resumenDePrueba();
  });
});

describe('las rutas de la pantalla', () => {
  let app: FastifyInstance;
  let wa: FakeWhatsApp;
  const auth = { authorization: `Bearer ${CLAVE_API_PRUEBA}` };

  beforeAll(async () => {
    const repos = createFakeRepos();
    wa = createFakeWhatsApp();
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 5000, growth: 2, hardCap: 10000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false });
    const settings = await createFakeSettings(config);
    const resumenes = await crearServicioResumenes({
      settingsRepo: createMemorySettingsRepo(),
      sender,
      ajustes: () => ({ activo: true, horaManana: '08:30', horaTarde: '18:30' }),
      supervisor: () => '51900000000',
      nombreNegocio: () => 'GSG Reparto',
      entregas: { resumen: async () => resumenDePrueba() },
      timezone: 'America/Lima',
      publicBaseUrl: URL,
    });
    app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, resumenes });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /admin/resumenes dice como esta', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/resumenes', headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().ajustes.horaManana).toBe('08:30');
    expect(r.json().supervisor).toBe('51900000000');
    expect(r.json().ultimos).toEqual({ manana: null, tarde: null });
  });

  it('la vista previa no manda nada; "mandar" si, y queda anotado', async () => {
    const v = await app.inject({ method: 'POST', url: '/admin/resumenes/vista-previa', headers: auth, payload: { franja: 'tarde' } });
    expect(v.statusCode).toBe(200);
    expect(v.json().texto).toContain('Entregados: 25 de 62');
    expect(wa.sent.filter((s) => s.kind !== 'read')).toHaveLength(0);

    const m = await app.inject({ method: 'POST', url: '/admin/resumenes/mandar', headers: auth, payload: { franja: 'manana' } });
    expect(m.statusCode).toBe(200);
    expect(wa.sent.filter((s) => s.kind !== 'read')).toHaveLength(1);
    expect(m.json().estado.ultimos.manana.ok).toBe(true);

    const mal = await app.inject({ method: 'POST', url: '/admin/resumenes/mandar', headers: auth, payload: { franja: 'noche' } });
    expect(mal.statusCode).toBe(400);
  });
});
