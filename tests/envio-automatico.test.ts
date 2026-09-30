/**
 * La lista de envio automatico: quien entra, a quien se le escribe, cuando
 * sale y por que.
 *
 * Se prueba lo que le importa a quien opera: que poner un numero es dar
 * permiso (y consentimiento), que se le escribe cada pocas horas y no antes,
 * que en cuanto manda su ubicacion sale solo, que al agotar los mensajes
 * sale y se avisa, que el reparto y la lista no se pisan, y que la pantalla
 * ensena las dos cosas juntas.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender, type Sender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { processChange } from '../src/whatsapp/webhook.js';
import type { ChangeValue, InboundMessage } from '../src/whatsapp/types.js';
import { crearServicioEnvioAutomatico, enviosPosiblesHoy, type ServicioEnvioAutomatico } from '../src/envio-automatico/servicio.js';
import { crearMotorLista, pasoDeEntrada, textoAvisoAgotado } from '../src/envio-automatico/motor.js';
import { partirTelefonos } from '../src/envio-automatico/routes.js';
import { OPCIONES_POR_DEFECTO, type OpcionesMotor } from '../src/rutas/motor.js';
import { PERU } from '../src/rutas/telefono.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, type FakeWhatsApp, CLAVE_API_PRUEBA as TODO } from './fakes.js';

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
  BUSINESS_NAME: 'La Tienda',
  RUTAS_PAIS: 'peru',
  RUTAS_SUPERVISOR: '51912000000',
} as NodeJS.ProcessEnv;

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

const config = loadConfig(ENV);
const con = (clave: string) => ({ authorization: `Bearer ${clave}`, 'content-type': 'application/json' });
/** Un martes a las 11 de la manana en Lima: dentro del horario. */
const HORA_BUENA = new Date('2026-09-15T16:00:00Z');
const opciones: OpcionesMotor = { ...OPCIONES_POR_DEFECTO, negocio: 'La Tienda', esperaRespuestaMinutos: 180 };

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
let sender: Sender;
let lista: ServicioEnvioAutomatico;
let reloj = HORA_BUENA;

async function build() {
  repos = createFakeRepos();
  wa = createFakeWhatsApp();
  sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false, now: () => reloj });
  lista = crearServicioEnvioAutomatico({ repos, opcionesReparto: opciones, plan: PERU, ahora: () => reloj });
  const settings = await createFakeSettings(config);
  return buildServer({ config, repos, settings, wa, sender, queue, logger: false, lista });
}

beforeAll(async () => {
  app = await build();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.close();
  reloj = HORA_BUENA;
  app = await build();
  await app.ready();
});

const enviados = () => wa.sent.filter((s) => s.kind !== 'read');
const motor = (extra: Partial<Parameters<typeof crearMotorLista>[0]> = {}) =>
  crearMotorLista({ repos, lista, sender, opciones, usarPlantilla: () => false, ahora: () => reloj, azar: () => 0, supervisor: () => '51912000000', ...extra });

function entrante(texto: string, phone = '51987654321', extra: Partial<InboundMessage> = {}): ChangeValue {
  return {
    contacts: [{ wa_id: phone, profile: { name: 'Juan' } }],
    messages: [{ id: `wamid.${Math.random()}`, from: phone, timestamp: String(Math.floor(reloj.getTime() / 1000)), type: 'text', text: { body: texto }, ...extra } as InboundMessage],
  };
}

describe('poner y quitar numeros', () => {
  it('poner un numero es darle permiso: queda con consentimiento y en la lista, con quien lo puso', async () => {
    const r = await lista.agregar({ telefono: '987 654 321', nombre: 'Juan', origen: 'manual', origenDetalle: 'ali' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entrada).toMatchObject({ phone: '51987654321', nombre: 'Juan', que: 'ubicacion', hasta: 'ubicacion', origen: 'manual', origenDetalle: 'ali', enviados: 0 });
    expect((await repos.contacts.getByPhone('51987654321'))?.optInAt).toBeTruthy();
    const mov = await repos.envioAutomatico.movimientos(5);
    expect(mov[0]).toMatchObject({ tipo: 'entro', phone: '51987654321', origen: 'manual: ali' });
  });

  it('rechaza lo que no puede ser: numero corto, mensaje vacio, un cliente dado de baja, uno que ya lleva el reparto', async () => {
    expect(await lista.agregar({ telefono: '1234', origen: 'manual' })).toMatchObject({ ok: false, codigo: 'telefono' });
    expect(await lista.agregar({ telefono: '987654321', que: 'mensaje', origen: 'manual' })).toMatchObject({ ok: false, codigo: 'texto' });

    await repos.contacts.upsertFromInbound('51911111111', 'Baja');
    await repos.contacts.setOptOut('51911111111');
    expect(await lista.agregar({ telefono: '911111111', origen: 'manual' })).toMatchObject({ ok: false, codigo: 'baja' });

    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '922222222', phone: '51922222222', nombre: 'Rosa' }]);
    const r = await lista.agregar({ telefono: '922222222', origen: 'manual' });
    expect(r).toMatchObject({ ok: false, codigo: 'en_reparto' });
    if (!r.ok) expect(r.motivo).toContain('Reparto');
  });

  it('el mismo numero dos veces no se duplica, y quitarlo deja apuntado quien y por que', async () => {
    await lista.agregar({ telefono: '987654321', origen: 'manual' });
    const otra = await lista.agregar({ telefono: '51987654321', origen: 'ia' });
    expect(otra).toMatchObject({ ok: true, nueva: false });
    expect((await repos.envioAutomatico.listar()).length).toBe(1);

    const quitada = await lista.quitar('987654321', { origen: 'manual', detalle: 'ali' }, 'lo quitó ali');
    expect(quitada?.phone).toBe('51987654321');
    expect(await lista.porTelefono('987654321')).toBeNull();
    expect((await repos.envioAutomatico.movimientos(1))[0]).toMatchObject({ tipo: 'salio', motivo: 'lo quitó ali' });
  });

  it('pausar y reanudar', async () => {
    await lista.agregar({ telefono: '987654321', origen: 'manual' });
    expect((await lista.pausar('987654321', { origen: 'manual' }))?.estado).toBe('pausado');
    expect(await repos.envioAutomatico.tocaEnviar(reloj, 5)).toHaveLength(0);
    expect((await lista.reanudar('987654321', { origen: 'manual' }))?.estado).toBe('activo');
    expect(await repos.envioAutomatico.tocaEnviar(reloj, 5)).toHaveLength(1);
  });

  it('varios telefonos pegados de cualquier manera', () => {
    expect(partirTelefonos('987 654 321\n51912345678, 999888777;  911222333 ')).toEqual(['987 654 321', '51912345678', '999888777', '911222333']);
  });
});

describe('el motor: cada pocas horas, como una persona', () => {
  it('manda el primer mensaje con el boton de ubicacion y no vuelve a escribir hasta que pasen las horas', async () => {
    await lista.agregar({ telefono: '987654321', nombre: 'Juan', origen: 'manual', referencia: 'pedido 1001' });
    const m = motor();
    const r1 = await m.tick();
    expect(r1.accion).toBe('envio');
    expect(enviados()).toHaveLength(1);
    expect(enviados()[0]).toMatchObject({ kind: 'location_request', to: '51987654321' });
    expect(String(enviados()[0]!.body)).toContain('pedido 1001');

    const e = await lista.porTelefono('987654321');
    expect(e).toMatchObject({ enviados: 1 });
    expect(e!.proximoEnvioAt!.getTime() - reloj.getTime()).toBe(180 * 60_000);

    // Una hora despues: nada. Tres horas despues: el recordatorio.
    reloj = new Date(HORA_BUENA.getTime() + 60 * 60_000);
    expect((await motor().tick()).accion).toBe('nada');
    reloj = new Date(HORA_BUENA.getTime() + 181 * 60_000);
    const r2 = await motor().tick();
    expect(r2.accion).toBe('envio');
    expect(String(enviados()[1]!.body)).toMatch(/seguimos pendientes|todavía no recibimos|otra vez/i);
  });

  it('fuera de horario no sale nada', async () => {
    await lista.agregar({ telefono: '987654321', origen: 'manual' });
    reloj = new Date('2026-09-15T04:00:00Z'); // 23:00 en Lima
    const r = await motor().tick();
    expect(r.accion).toBe('nada');
    expect(r.motivo).toContain('horario');
    expect(enviados()).toHaveLength(0);
  });

  it('un mensaje propio se manda tal cual, con {nombre} relleno, y sale de la lista al completar los envios', async () => {
    await lista.agregar({ telefono: '987654321', nombre: 'Juan Pérez', que: 'mensaje', texto: 'Hola {nombre}, tu pedido está listo en {negocio}.', hasta: 'envios', maxEnvios: 1, origen: 'manual' });
    const r = await motor().tick();
    expect(r.accion).toBe('envio');
    expect(enviados()[0]).toMatchObject({ kind: 'text', body: 'Hola Juan, tu pedido está listo en La Tienda.' });
    expect(await lista.porTelefono('987654321')).toBeNull();
    expect((await repos.envioAutomatico.movimientos(1))[0]).toMatchObject({ tipo: 'salio', motivo: 'se mandaron los 1 mensajes previstos' });
  });

  it('agotados los mensajes sin respuesta, sale de la lista y se avisa al supervisor', async () => {
    await lista.agregar({ telefono: '987654321', nombre: 'Juan', origen: 'manual', maxEnvios: 2 });
    expect((await motor().tick()).accion).toBe('envio');
    reloj = new Date(HORA_BUENA.getTime() + 181 * 60_000);
    expect((await motor().tick()).accion).toBe('envio');
    reloj = new Date(HORA_BUENA.getTime() + 362 * 60_000);
    const r = await motor().tick();
    expect(r.accion).toBe('salida');
    expect(await lista.porTelefono('987654321')).toBeNull();
    const aviso = enviados().at(-1)!;
    expect(aviso).toMatchObject({ kind: 'text', to: '51912000000' });
    expect(String(aviso.body)).toContain('Juan (51987654321) no mandó su ubicación después de 2 mensajes');
    expect(textoAvisoAgotado({ nombre: null, phone: '51987654321', que: 'mensaje' } as never, 1)).toContain('no contestó después de 1 mensaje');
  });

  it('si una persona atiende ese chat, el motor calla y pasa al siguiente', async () => {
    await lista.agregar({ telefono: '987654321', nombre: 'Juan', origen: 'manual' });
    await lista.agregar({ telefono: '912345678', nombre: 'Rosa', origen: 'manual' });
    const juan = await repos.contacts.getByPhone('51987654321');
    await repos.contacts.pausarBot(juan!.id, true, reloj);
    const r = await motor().tick();
    expect(r.accion).toBe('envio');
    expect(enviados()[0]).toMatchObject({ to: '51912345678' });
    expect((await lista.porTelefono('987654321'))!.proximoEnvioAt).toBeTruthy();
  });

  it('el que se dio de baja sale sin que se le escriba', async () => {
    await lista.agregar({ telefono: '987654321', origen: 'manual' });
    await repos.contacts.setOptOut('51987654321');
    const r = await motor().tick();
    expect(r.accion).toBe('salida');
    expect(enviados()).toHaveLength(0);
    expect((await repos.envioAutomatico.movimientos(1))[0]?.motivo).toContain('baja');
  });

  it('el paso del mensaje sigue la logica del reparto: solicitud, recordatorio, y si contesto sin pin, insistencia', () => {
    const base = { enviados: 0, respondioAt: null, ultimoEnvioAt: null } as never;
    expect(pasoDeEntrada(base)).toBe('solicitud');
    expect(pasoDeEntrada({ ...(base as object), enviados: 1, ultimoEnvioAt: new Date(1000) } as never)).toBe('recordatorio');
    expect(pasoDeEntrada({ ...(base as object), enviados: 1, ultimoEnvioAt: new Date(1000), respondioAt: new Date(2000) } as never)).toBe('insistencia');
  });

  it('cuantos mensajes caben en un dia con ese ritmo', () => {
    expect(enviosPosiblesHoy({ cadaHoras: 3, horaInicio: 9, horaFin: 19 })).toBe(4);
    expect(enviosPosiblesHoy({ cadaHoras: 24, horaInicio: 9, horaFin: 19 })).toBe(1);
  });
});

describe('las respuestas del cliente', () => {
  const deps = () => ({ repos, wa, sender, config, settings: null as never, lista });

  it('cuando manda su ubicacion sale de la lista solo', async () => {
    await lista.agregar({ telefono: '987654321', nombre: 'Juan', origen: 'manual' });
    await motor().tick();
    const settings = await createFakeSettings(config);
    await processChange('messages', entrante('', '51987654321', { type: 'location', location: { latitude: -12.05, longitude: -77.03 } }), { ...deps(), settings });
    expect(await lista.porTelefono('987654321')).toBeNull();
    expect((await repos.envioAutomatico.movimientos(1))[0]).toMatchObject({ tipo: 'salio', motivo: 'mandó su ubicación' });
  });

  it('un enlace de mapa tambien cuenta como su ubicacion', async () => {
    await lista.agregar({ telefono: '987654321', origen: 'manual' });
    const settings = await createFakeSettings(config);
    await processChange('messages', entrante('acá estoy https://maps.google.com/?q=-12.0464,-77.0428'), { ...deps(), settings });
    expect(await lista.porTelefono('987654321')).toBeNull();
  });

  it('si contesta con texto pero sin ubicacion, sigue en la lista y el siguiente mensaje lo reconoce', async () => {
    await lista.agregar({ telefono: '987654321', nombre: 'Juan', origen: 'manual' });
    await motor().tick();
    const settings = await createFakeSettings(config);
    await processChange('messages', entrante('mañana te la mando'), { ...deps(), settings });
    const e = await lista.porTelefono('987654321');
    expect(e).not.toBeNull();
    expect(e!.respondioAt).toBeTruthy();
    expect(pasoDeEntrada(e!)).toBe('insistencia');
  });

  it('con un mensaje "hasta que conteste", cualquier respuesta lo saca', async () => {
    await lista.agregar({ telefono: '987654321', que: 'mensaje', texto: '¿Confirmas tu pedido?', origen: 'manual' });
    await motor().tick();
    const settings = await createFakeSettings(config);
    await processChange('messages', entrante('sí, confirmo'), { ...deps(), settings });
    expect(await lista.porTelefono('987654321')).toBeNull();
    expect((await repos.envioAutomatico.movimientos(1))[0]).toMatchObject({ tipo: 'salio', motivo: 'contestó' });
  });
});

describe('la lista y el reparto no se pisan', () => {
  it('si un numero de la lista entra en un lote, el reparto se lo queda', async () => {
    await lista.agregar({ telefono: '987654321', origen: 'manual' });
    const r = await app.inject({ method: 'POST', url: '/admin/rutas/lotes', headers: con(TODO), payload: { nombre: 'Hoy', filas: [{ telefono: '987654321', nombre: 'Juan', referencia: '1001' }], arrancar: true } });
    expect(r.statusCode).toBe(200);
    expect(await lista.porTelefono('987654321')).toBeNull();
    expect((await repos.envioAutomatico.movimientos(1))[0]?.motivo).toContain('pasó al reparto');
  });

  it('la pantalla ensena la lista y el reparto juntos, con cifras y ajustes', async () => {
    await lista.agregar({ telefono: '987654321', nombre: 'Juan', origen: 'manual', origenDetalle: 'ali' });
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto de hoy' });
    await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '912345678', phone: '51912345678', nombre: 'Rosa', referencia: '1002' }]);
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');

    const r = await app.inject({ method: 'GET', url: '/admin/envio-automatico', headers: con(TODO) });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.cifras).toMatchObject({ enLista: 2, propios: 1, reparto: 1 });
    expect(j.ajustes).toMatchObject({ cadaHoras: 3, maxEnvios: 3, horaInicio: 9, horaFin: 19 });
    const rosa = j.numeros.find((n: { phone: string }) => n.phone === '51912345678');
    expect(rosa).toMatchObject({ origen: 'reparto', lote: { nombre: 'Reparto de hoy' }, situacion: 'esperando turno para el primer mensaje' });
    expect(j.numeros.find((n: { phone: string }) => n.phone === '51987654321')).toMatchObject({ origen: 'manual', origenDetalle: 'ali', maxEnvios: 3 });
    expect(j.movimientos[0]).toMatchObject({ tipo: 'entro', phone: '51987654321' });
  });

  it('quitar a un cliente del reparto desde la lista lo pasa a una persona', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Hoy' });
    const [s] = await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '912345678', phone: '51912345678', nombre: 'Rosa' }]);
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
    const r = await app.inject({ method: 'DELETE', url: `/admin/envio-automatico/s:${s!.id}`, headers: con(TODO) });
    expect(r.statusCode).toBe(200);
    expect(r.json().pasoAPersona).toBe(true);
    expect((await repos.rutas.solicitud(s!.id))?.estado).toBe('derivado');
  });
});

describe('las rutas de la pantalla', () => {
  it('poner varios de una vez, con los rechazados explicados', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/envio-automatico', headers: con(TODO), payload: { telefonos: '987654321\n1234\n912 345 678', que: 'ubicacion' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().puestos).toHaveLength(2);
    expect(r.json().rechazados[0]).toMatchObject({ telefono: '1234' });
    expect(r.json().rechazados[0].motivo).toContain('no sirve');
  });

  it('un solo numero malo es un 400 con el motivo', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/envio-automatico', headers: con(TODO), payload: { telefonos: '12' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('no sirve');
  });

  it('el ritmo se cambia desde la pantalla y vale para el reparto tambien', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/envio-automatico/ajustes', headers: con(TODO), payload: { cadaHoras: 2, maxEnvios: 4, horaInicio: 8, horaFin: 20 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ajustes).toMatchObject({ cadaHoras: 2, maxEnvios: 4, horaInicio: 8, horaFin: 20 });
    const reparto = await app.inject({ method: 'GET', url: '/admin/rutas/ajustes', headers: con(TODO) });
    expect(reparto.json().ajustes).toMatchObject({ esperaRespuestaMinutos: 120, maxIntentos: 4, horaInicio: 8, horaFin: 20 });
    const mal = await app.inject({ method: 'POST', url: '/admin/envio-automatico/ajustes', headers: con(TODO), payload: { horaInicio: 10, horaFin: 9 } });
    expect(mal.statusCode).toBe(400);
  });

  it('pausar, reanudar, editar y quitar', async () => {
    const alta = await app.inject({ method: 'POST', url: '/admin/envio-automatico', headers: con(TODO), payload: { telefonos: '987654321', nombre: 'Juan' } });
    const clave = `e:${(await lista.porTelefono('987654321'))!.id}`;
    expect(alta.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/admin/envio-automatico/${clave}/pausar`, headers: con(TODO) })).json().entrada.estado).toBe('pausado');
    expect((await app.inject({ method: 'POST', url: `/admin/envio-automatico/${clave}/reanudar`, headers: con(TODO) })).json().entrada.estado).toBe('activo');
    const ed = await app.inject({ method: 'POST', url: `/admin/envio-automatico/${clave}/editar`, headers: con(TODO), payload: { que: 'mensaje', texto: 'Hola {nombre}', maxEnvios: 2 } });
    expect(ed.statusCode).toBe(200);
    expect(ed.json().entrada).toMatchObject({ que: 'mensaje', texto: 'Hola {nombre}', hasta: 'respuesta', maxEnvios: 2 });
    expect((await app.inject({ method: 'DELETE', url: `/admin/envio-automatico/${clave}`, headers: con(TODO) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/admin/envio-automatico/${clave}`, headers: con(TODO) })).statusCode).toBe(404);
  });

  it('la pagina existe y lleva su JS', async () => {
    const { envioAutomaticoPage } = await import('../src/web/envio-automatico-page.js');
    const html = envioAutomaticoPage({ configured: true, nombreNegocio: 'Z' });
    expect(html).toContain('/admin/envio-automatico');
    expect(html).toContain('abrirOperadorIA');
    expect(html).toContain('id="filas"');
  });

  it('la pagina usa la paleta del armazon y sabe si falta conectar WhatsApp', async () => {
    const { envioAutomaticoPage } = await import('../src/web/envio-automatico-page.js');
    const sinConectar = envioAutomaticoPage({ configured: false, nombreNegocio: 'Z' });
    // Sin WhatsApp no sale ningun mensaje: la pantalla lo sabe y no puede
    // decir que el motor esta trabajando.
    expect(sinConectar).toContain('data-configurado="0"');
    expect(envioAutomaticoPage({ configured: true, nombreNegocio: 'Z' })).toContain('data-configurado="1"');
    // Su CSS no puede redefinir la paleta: pisaba la del armazon en toda la
    // pantalla (menu y dialogos incluidos) y rompia el modo oscuro.
    const css = sinConectar.slice(sinConectar.indexOf('<style>'), sinConectar.indexOf('</style>'));
    const propio = css.slice(css.indexOf('Solo lo propio de esta pantalla'));
    expect(propio).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(propio).not.toContain(':root');
  });
});
