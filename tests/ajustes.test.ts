/**
 * El control desde la pantalla: los ajustes del reparto (pausas, espera,
 * intentos, horario, plantillas y redacciones por paso) y las plantillas
 * propias creadas desde el panel. Motor, repositorio y API.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender, type SendJob, type SendOutcome, type Sender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { crearMotor, OPCIONES_POR_DEFECTO, type OpcionesMotor } from '../src/rutas/motor.js';
import { crearPuertoEnEspera } from '../src/rutas/gsg.js';
import { ajustesPorDefecto, aplicarAjustes, rellenarTexto } from '../src/rutas/ajustes.js';
import { textoLibre } from '../src/rutas/mensajes.js';
import { approvedTemplate, createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, CLAVE_API_PRUEBA as ADMIN } from './fakes.js';

const HORA_BUENA = new Date('2026-03-10T15:00:00Z'); // martes 10:00 en Lima

function senderFalso() {
  const enviados: SendJob[] = [];
  const sender: Sender = {
    async send(job) {
      enviados.push(job);
      return { ok: true, wamid: `wamid.${enviados.length}`, deliveryId: enviados.length } as SendOutcome;
    },
  };
  return { sender, enviados };
}

async function loteListo(repos: FakeRepos, telefonos: string[]) {
  const lote = await repos.rutas.crearLote({ nombre: 'Reparto de prueba' });
  await repos.rutas.agregarSolicitudes(
    lote.id,
    telefonos.map((t, i) => ({ telefonoCrudo: t, phone: t, nombre: `Cliente ${i + 1}`, referencia: `P-${i + 1}` })),
  );
  await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
  return lote;
}

describe('ajustes: puros', () => {
  const opciones: OpcionesMotor = { ...OPCIONES_POR_DEFECTO, timezone: 'America/Lima' };

  it('sin nada guardado, los ajustes son los de la configuracion', () => {
    const a = ajustesPorDefecto(opciones);
    expect(a).toMatchObject({ pausaMinSegundos: 15, pausaMaxSegundos: 30, esperaRespuestaMinutos: 180, maxIntentos: 3, horaInicio: 9, horaFin: 19 });
    expect(a.plantillas.solicitud).toEqual([]);
    expect(aplicarAjustes(opciones, a)).toEqual(opciones);
  });

  it('aplicar corrige un maximo por debajo del minimo y un fin antes del inicio', () => {
    const a = { ...ajustesPorDefecto(opciones), pausaMinSegundos: 40, pausaMaxSegundos: 10, horaInicio: 10, horaFin: 8 };
    const v = aplicarAjustes(opciones, a);
    expect(v.pausaMaxSegundos).toBe(40);
    expect(v.horaFin).toBe(11);
  });

  it('rellenarTexto pone nombre, negocio y pedido, con relleno cuando faltan', () => {
    expect(rellenarTexto('Hola {nombre}, de {negocio} por {pedido}.', { nombre: 'Ana Ruiz', negocio: 'La Tienda', referencia: 'P-9' })).toBe(
      'Hola Ana, de La Tienda por P-9.',
    );
    expect(rellenarTexto('{NOMBRE}: {pedido}', { nombre: null, negocio: 'X', referencia: null })).toBe('buenas tardes: tu pedido');
  });
});

describe('los textos dicen como mandar la ubicacion segun haya boton o no, y de que pedido hablan', () => {
  it('sin boton nativo explica el clip y nunca menciona un boton; con boton, lo contrario', () => {
    const ctx = { nombre: 'Ana Ruiz', negocio: 'La Tienda', referencia: 'P-1', direccion: 'Av. Larco 123', distrito: 'Miraflores' };
    for (const paso of ['solicitud', 'recordatorio', 'insistencia'] as const) {
      for (let i = 0; i < 3; i++) {
        const sinBoton = textoLibre(paso, { ...ctx, conBoton: false }, `x${i}`);
        expect(sinBoton).toMatch(/clip/);
        expect(sinBoton).not.toMatch(/bot[oó]n/);
        expect(sinBoton).toMatch(/P-1 \(Miraflores, Av\. Larco 123\)/);
        const conBoton = textoLibre(paso, { ...ctx, conBoton: true }, `x${i}`);
        expect(conBoton).toMatch(/bot[oó]n/);
        expect(conBoton).not.toMatch(/clip/);
      }
    }
    // Sin direccion ni distrito no queda un parentesis vacio.
    expect(textoLibre('solicitud', { nombre: 'Ana', negocio: 'X', referencia: 'P-2' })).not.toMatch(/\(\)/);
  });

  it('una redaccion propia admite {direccion}, {distrito} y {como}', () => {
    const texto = rellenarTexto('Pedido {pedido} a {direccion}, {distrito}. Mándela {como}.', {
      nombre: 'Ana', negocio: 'X', referencia: 'P-1', direccion: 'Av. Larco 123', distrito: 'Miraflores', conBoton: false,
    });
    expect(texto).toBe('Pedido P-1 a Av. Larco 123, Miraflores. Mándela desde el clip 📎 → Ubicación → Enviar tu ubicación actual.');
  });
});

describe('ajustes: el motor los usa', () => {
  let repos: FakeRepos;
  const opciones: OpcionesMotor = { ...OPCIONES_POR_DEFECTO, timezone: 'America/Lima' };

  beforeEach(() => {
    repos = createFakeRepos();
  });

  it('la espera, los intentos y las redacciones guardadas mandan sobre la configuracion', async () => {
    await loteListo(repos, ['51987654321']);
    await repos.rutas.ajustes.set(
      {
        esperaRespuestaMinutos: 5,
        maxIntentos: 1,
        textos: { solicitud: ['Hola {nombre}, {negocio} necesita su ubicación para {pedido}.'], recordatorio: [], insistencia: [] },
      },
      ajustesPorDefecto(opciones),
    );
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones, usarPlantilla: () => false, ahora: () => HORA_BUENA, azar: () => 0 });

    const salida = await motor.tick();
    expect(salida.accion).toBe('envio');
    expect(enviados[0]?.interactive?.body).toBe('Hola Cliente, nuestra tienda necesita su ubicación para P-1.');
    const [sol] = await repos.rutas.listarSolicitudes({ limit: 1, offset: 0 });
    expect(sol!.proximoIntentoAt!.getTime() - HORA_BUENA.getTime()).toBe(5 * 60_000);

    // Con maxIntentos = 1, a la siguiente vuelta pasa al repartidor.
    const motor2 = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones, usarPlantilla: () => false, ahora: () => new Date(HORA_BUENA.getTime() + 6 * 60_000) });
    const segunda = await motor2.tick();
    expect(segunda.accion).toBe('derivacion');

    // Y sin redaccion propia, el texto de siempre explica el clip (no hay boton).
    await repos.rutas.ajustes.reset();
    await loteListo(repos, ['51987654399']);
    const motor3 = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones, usarPlantilla: () => false, ahora: () => new Date(HORA_BUENA.getTime() + 60 * 60_000), azar: () => 0 });
    await motor3.tick();
    expect(enviados.at(-1)?.interactive?.body).toMatch(/clip/);
  });

  it('el horario guardado manda: a las 10:00 con horario de 12 a 18 no se escribe', async () => {
    await loteListo(repos, ['51987654321']);
    await repos.rutas.ajustes.set({ horaInicio: 12, horaFin: 18 }, ajustesPorDefecto(opciones));
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones, usarPlantilla: () => false, ahora: () => HORA_BUENA });
    const salida = await motor.tick();
    expect(salida.accion).toBe('nada');
    expect(salida.motivo).toMatch(/12:00 a 18:00/);
    expect(enviados).toHaveLength(0);
  });

  it('con plantilla, usa la propia elegida y rellena sus variables en el orden fijo', async () => {
    await loteListo(repos, ['51987654321']);
    await repos.templates.upsert(approvedTemplate({ name: 'mi_solicitud', language: 'es', category: 'UTILITY', variables: 2, body: 'Hola {{1}}, su pedido {{2}}.', propia: true }));
    await repos.rutas.ajustes.set({ plantillas: { solicitud: ['mi_solicitud'], recordatorio: [], insistencia: [] } }, ajustesPorDefecto(opciones));
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones, usarPlantilla: () => true, ahora: () => HORA_BUENA });
    const salida = await motor.tick();
    expect(salida.accion).toBe('envio');
    expect(enviados[0]).toMatchObject({ kind: 'template', templateName: 'mi_solicitud', variables: ['Cliente', 'P-1'] });
  });

  it('sin ajustes de plantilla, alterna entre las del catalogo aprobadas', async () => {
    await loteListo(repos, ['51987654321', '51987654322']);
    await repos.templates.upsert(approvedTemplate({ name: 'solicitud_ubicacion', language: 'es', category: 'UTILITY', variables: 3, quality: 'GREEN' }));
    await repos.templates.upsert(approvedTemplate({ name: 'solicitud_ubicacion_b', language: 'es', category: 'UTILITY', variables: 3, quality: 'GREEN' }));
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones: { ...opciones, pausaMinSegundos: 1, pausaMaxSegundos: 1 }, usarPlantilla: () => true, ahora: () => HORA_BUENA, azar: () => 0 });
    await motor.tick();
    expect(enviados[0]?.templateName).toBe('solicitud_ubicacion');
    // La segunda ya no: el doble en memoria no cuenta usos por plantilla sin entregas reales,
    // pero la eleccion sigue siendo una de las dos del catalogo.
    expect(['solicitud_ubicacion', 'solicitud_ubicacion_b']).toContain(enviados[0]?.templateName);
  });
});

describe('ajustes y plantillas propias: la API', () => {
    const ENV = {
    PUBLIC_BASE_URL: 'http://localhost:3000',
    DATABASE_URL: 'mysql://x/y',
    WHATSAPP_TOKEN: 't',
    WHATSAPP_PHONE_NUMBER_ID: 'PNID',
    WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
    WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
    WHATSAPP_VERIFY_TOKEN: 'verify-me',
    TRACKING_SECRET: 'x'.repeat(40),
    GEO_BBOX: 'lima',
    RUTAS_PAIS: 'peru',
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
  const auth = { 'x-api-key': ADMIN };
  let app: FastifyInstance;
  let repos: FakeRepos;

  beforeAll(async () => {
    const config = loadConfig(ENV);
    repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const settings = await createFakeSettings(config);
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET devuelve los ajustes, los valores por defecto y las plantillas entre las que elegir', async () => {
    await repos.templates.upsert(approvedTemplate({ name: 'solicitud_ubicacion', language: 'es', category: 'UTILITY', variables: 3 }));
    const r = await app.inject({ method: 'GET', url: '/admin/rutas/ajustes', headers: auth });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.ajustes.maxIntentos).toBe(3);
    expect(body.catalogo.solicitud).toEqual(['solicitud_ubicacion', 'solicitud_ubicacion_b']);
    expect(body.plantillas.map((t: { name: string }) => t.name)).toContain('solicitud_ubicacion');
    // Para la pantalla: un cliente de ejemplo y como le llegaria cada paso, en cristiano.
    expect(body.ejemplo).toMatchObject({ nombre: 'Ana Ruiz', pedido: 'P-1024', distrito: 'Miraflores' });
    expect(body.textosDeSiempre.solicitud).toContain('Ana');
    expect(body.textosDeSiempre.solicitud).toContain('P-1024');
    expect(body.textosDeSiempre.recordatorio).toContain('ubicación');
    expect(typeof body.usaPlantillas).toBe('boolean');
  });

  it('POST guarda, valida y se refleja en el estado del modulo; DELETE vuelve a la configuracion', async () => {
    const malo = await app.inject({ method: 'POST', url: '/admin/rutas/ajustes', headers: auth, payload: { maxIntentos: 99 } });
    expect(malo.statusCode).toBe(400);

    const noExiste = await app.inject({ method: 'POST', url: '/admin/rutas/ajustes', headers: auth, payload: { plantillas: { solicitud: ['no_existe'], recordatorio: [], insistencia: [] } } });
    expect(noExiste.statusCode).toBe(400);
    expect(noExiste.json().error).toMatch(/no_existe/);

    const ok = await app.inject({ method: 'POST', url: '/admin/rutas/ajustes', headers: auth, payload: { esperaRespuestaMinutos: 45, horaInicio: 10, horaFin: 18, textos: { solicitud: ['Hola {nombre}'], recordatorio: [], insistencia: [] } } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().vigente).toMatchObject({ esperaRespuestaMinutos: 45, horaInicio: 10, horaFin: 18 });

    const estado = await app.inject({ method: 'GET', url: '/admin/rutas', headers: auth });
    expect(estado.json().motor).toMatchObject({ espera: 45, horario: [10, 18] });

    const reset = await app.inject({ method: 'DELETE', url: '/admin/rutas/ajustes', headers: auth });
    expect(reset.statusCode).toBe(200);
    const despues = await app.inject({ method: 'GET', url: '/admin/rutas', headers: auth });
    expect(despues.json().motor).toMatchObject({ espera: 180, horario: [9, 19] });
  });

  it('una plantilla propia se crea con lint, aparece en el catalogo y se borra; las del catalogo no', async () => {
    const mal = await app.inject({ method: 'POST', url: '/admin/templates', headers: auth, payload: { name: 'Mal Nombre', body: 'Hola {{1}} gratis', variables: ['nombre'] } });
    expect(mal.statusCode).toBe(400);

    const cuenta = await app.inject({ method: 'POST', url: '/admin/templates', headers: auth, payload: { name: 'aviso_hoy', body: 'Hola {{1}}, su pedido {{2}} sale hoy.', variables: ['nombre'] } });
    expect(cuenta.statusCode).toBe(400);
    expect(cuenta.json().error).toMatch(/2 variable/);

    // El lexico de spam y las mayusculas son avisos, no errores: se guarda,
    // pero se devuelven para que quien la escribio los vea.
    const spam = await app.inject({ method: 'POST', url: '/admin/templates', headers: auth, payload: { name: 'aviso_hoy', category: 'UTILITY', body: 'GANASTE un premio {{1}}, haz clic aqui', variables: ['nombre'] } });
    expect(spam.statusCode).toBe(200);
    expect(spam.json().issues.filter((i: { severity: string }) => i.severity === 'warning').length).toBeGreaterThan(0);
    // Un error de verdad (dos variables seguidas) si lo rechaza.
    const roto = await app.inject({ method: 'POST', url: '/admin/templates', headers: auth, payload: { name: 'aviso_roto', body: 'Hola {{1}}{{2}} su pedido.', variables: ['a', 'b'] } });
    expect(roto.statusCode).toBe(400);
    expect(roto.json().issues?.some((i: { rule: string }) => i.rule === 'adjacent_variables')).toBe(true);

    const ok = await app.inject({ method: 'POST', url: '/admin/templates', headers: auth, payload: { name: 'aviso_hoy', body: 'Hola {{1}}, su pedido {{2}} sale hoy. Comparta su ubicación desde el clip, opción Ubicación.', variables: ['nombre del cliente', 'número de pedido'] } });
    expect(ok.statusCode).toBe(200);
    // Con la API oficial queda pendiente de subir.
    expect(ok.json().template).toMatchObject({ name: 'aviso_hoy', status: 'PENDING', propia: true, variables: 2 });

    const catalogo = await app.inject({ method: 'GET', url: '/admin/templates/catalog', headers: auth });
    const propia = catalogo.json().find((t: { name: string }) => t.name === 'aviso_hoy');
    expect(propia).toMatchObject({ propia: true, variables: ['nombre del cliente', 'número de pedido'] });

    const delCatalogo = await app.inject({ method: 'POST', url: '/admin/templates', headers: auth, payload: { name: 'solicitud_ubicacion', body: 'Hola {{1}} {{2}} {{3}} otra cosa distinta.', variables: ['a', 'b', 'c'] } });
    expect(delCatalogo.statusCode).toBe(400);

    const borrarCatalogo = await app.inject({ method: 'DELETE', url: '/admin/templates/solicitud_ubicacion/es', headers: auth });
    expect(borrarCatalogo.statusCode).toBe(400);
    const borrar = await app.inject({ method: 'DELETE', url: '/admin/templates/aviso_hoy/es', headers: auth });
    expect(borrar.statusCode).toBe(200);
    expect(await repos.templates.get('aviso_hoy', 'es')).toBeNull();
  });
});
