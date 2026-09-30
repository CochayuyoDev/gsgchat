/**
 * Pruebas de las rutas que alimentan el panel y la pantalla de conexion:
 * contactos, ubicaciones, historial, campanas, plantillas, rastreo y
 * automatizacion. Todo contra el servidor real con dobles en memoria.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import {
  createFakeRepos,
  createFakeSettings,
  createFakeWhatsApp,
  type FakeRepos,
  type FakeWhatsApp,
  CLAVE_API_PRUEBA as ADMIN,
} from './fakes.js';


const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  GOOGLE_MAPS_API_KEY: 'maps-key',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'mexico',
} as NodeJS.ProcessEnv;

/** Cola de prueba: cuenta lo encolado sin enviarlo. */
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

const auth = { authorization: `Bearer ${ADMIN}` };

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
const config = loadConfig(ENV);

beforeAll(async () => {
  repos = createFakeRepos();
  wa = createFakeWhatsApp();
  const sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 },
    maxMarketingPerContact7d: 2,
  });
  const settings = await createFakeSettings(config);
  app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('errores utiles para el panel', () => {
  it('un cuerpo invalido devuelve 400 con el detalle, no un 500', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/messages/text',
      headers: auth,
      payload: { phone: '12', text: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Revisa los datos');
  });
});

describe('contactos', () => {
  it('importa una lista pegada y registra el opt-in con su origen', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/contacts/import',
      headers: auth,
      payload: {
        source: 'formulario web',
        text: '+52 1 55 1000 0001, Ana Perez\n5215510000002;Luis\n\nbasura\n',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ imported: 2, received: 2 });

    const ana = await repos.contacts.getByPhone('5215510000001');
    expect(ana).toMatchObject({ name: 'Ana Perez', optInSource: 'formulario web' });
    expect(ana?.optInAt).toBeInstanceOf(Date);
  });

  it('lista, busca y filtra por estado', async () => {
    await repos.contacts.upsertFromInbound('5215510000003', 'Carla');
    await repos.contacts.setOptOut('5215510000003');

    const all = await app.inject({ url: '/admin/contacts', headers: auth });
    expect(all.json().total).toBeGreaterThanOrEqual(3);

    const search = await app.inject({ url: '/admin/contacts?q=carla', headers: auth });
    expect(search.json().items.map((c: { phone: string }) => c.phone)).toEqual(['5215510000003']);

    const out = await app.inject({ url: '/admin/contacts?state=opted_out', headers: auth });
    expect(out.json().items.every((c: { optOutAt: string | null }) => c.optOutAt)).toBe(true);
  });

  it('exporta los contactos del filtro a CSV para Excel (BOM, punto y coma)', async () => {
    const res = await app.inject({ url: '/admin/contacts.csv?state=opted_out', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('contactos.csv');
    const lineas = res.body.replace(/^\ufeff/, '').trim().split('\r\n');
    expect(lineas[0]).toBe('telefono;nombre;estado;opt_in;origen_opt_in;baja;ultimo_mensaje;ultima_ubicacion;alta');
    expect(lineas.slice(1).some((l) => l.startsWith('5215510000003;Carla;baja;'))).toBe(true);
    expect(res.body.startsWith('\ufeff')).toBe(true);
  });

  it('normaliza el telefono al dar de alta', async () => {
    const optIn = await app.inject({
      method: 'POST',
      url: '/admin/contacts/opt-in',
      headers: auth,
      payload: { phone: '+52 (55) 1000-0004', source: 'llamada' },
    });
    expect(optIn.statusCode).toBe(200);
    expect(optIn.json().contact.phone).toBe('525510000004');
  });
});

describe('ubicaciones, historial y campanas', () => {
  it('lista las ubicaciones recibidas con su contacto', async () => {
    const contact = await repos.contacts.upsertFromInbound('5215510000005', 'Geo');
    await repos.locations.save(
      contact.id,
      {
        ok: true,
        lat: 19.4326,
        lng: -99.1332,
        source: 'query_param',
        confidence: 'high',
        precisionMeters: 11,
        mapsUrl: 'https://maps',
        warnings: [],
        needsConfirmation: false,
      },
      'https://maps.google.com/?q=19.4326,-99.1332',
    );

    const response = await app.inject({ url: '/admin/locations?phone=5215510000005', headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({
      phone: '5215510000005',
      name: 'Geo',
      source: 'query_param',
    });
  });

  it('el historial muestra cada intento con el motivo del bloqueo', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/messages/text',
      headers: auth,
      payload: { phone: '5215510000006', text: 'hola' },
    });
    const response = await app.inject({ url: '/admin/deliveries?phone=5215510000006', headers: auth });
    expect(response.json()[0]).toMatchObject({ status: 'blocked_by_gate' });
    expect(response.json()[0].errorTitle).toContain('no_opt_in');
  });

  it('el historial se descarga en CSV con los mismos filtros', async () => {
    const res = await app.inject({ url: '/admin/deliveries.csv?phone=5215510000006', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('historial-envios.csv');
    const lineas = res.body.replace(/^\ufeff/, '').trim().split('\r\n');
    expect(lineas[0]).toBe('fecha;telefono;nombre;tipo;plantilla;categoria;estado;error;campana;entregado');
    expect(lineas).toHaveLength(2);
    expect(lineas[1]).toContain(';5215510000006;');
    expect(lineas[1]).toContain(';blocked_by_gate;');
  });

  it('las campanas se listan con sus conteos', async () => {
    await repos.templates.upsert({
      name: 'recordatorio_cita',
      language: 'es',
      category: 'UTILITY',
      status: 'APPROVED',
      quality: 'GREEN',
      variables: 3,
      body: 'Hola {{1}}, cita el {{2}} a las {{3}}.',
    });
    const launch = await app.inject({
      method: 'POST',
      url: '/admin/campaigns',
      headers: auth,
      payload: {
        name: 'Citas',
        templateName: 'recordatorio_cita',
        category: 'UTILITY',
        recipients: [{ phone: '5215510000001', variables: ['Ana', 'lunes', '10:00'] }],
      },
    });
    expect(launch.statusCode).toBe(200);
    expect(launch.json().enqueued).toBe(1);

    const list = await app.inject({ url: '/admin/campaigns', headers: auth });
    const campaign = list.json().find((c: { name: string }) => c.name === 'Citas');
    expect(campaign).toMatchObject({ templateName: 'recordatorio_cita', category: 'UTILITY' });
  });
});

describe('rastreo: sesiones activas', () => {
  it('lista las sesiones vigentes con sus enlaces y revoca desde el panel', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/tracking',
      headers: auth,
      payload: { label: 'Reparto 7' },
    });
    const { linkId, viewUrl } = created.json();

    const list = await app.inject({ url: '/admin/tracking', headers: auth });
    const session = list.json().find((s: { id: string }) => s.id === linkId);
    expect(session).toMatchObject({ label: 'Reparto 7', viewUrl, viewers: 0, pointCount: 0 });

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/admin/tracking/${linkId}`,
      headers: auth,
    });
    expect(revoke.statusCode).toBe(200);
    const after = await app.inject({ url: '/admin/tracking', headers: auth });
    expect(after.json().some((s: { id: string }) => s.id === linkId)).toBe(false);
  });
});

describe('plantillas y numero desde el panel', () => {
  it('el catalogo llega con su lint', async () => {
    const response = await app.inject({ url: '/admin/templates/catalog', headers: auth });
    expect(response.statusCode).toBe(200);
    const names = response.json().map((t: { name: string }) => t.name);
    expect(names).toContain('confirmacion_pedido');
    expect(response.json().every((t: { issues: unknown[] }) => Array.isArray(t.issues))).toBe(true);
  });

  it('sincroniza el registro desde Meta', async () => {
    wa.remoteTemplates = [
      {
        name: 'hello_world',
        language: 'en_US',
        category: 'UTILITY',
        status: 'APPROVED',
        quality_score: { score: 'GREEN' },
        components: [{ type: 'BODY', text: 'Welcome!' }],
      },
    ];
    const response = await app.inject({ method: 'POST', url: '/admin/templates/sync', headers: auth });
    expect(response.json().synced).toBe(1);
    expect(await repos.templates.get('hello_world', 'en_US')).toMatchObject({ status: 'APPROVED' });
  });

  it('da de alta el catalogo y lo deja como PENDING en el registro', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/templates/push',
      headers: auth,
      payload: { names: ['confirmacion_pedido'] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().results[0]).toMatchObject({
      name: 'confirmacion_pedido',
      ok: true,
      status: 'PENDING',
    });
    expect(wa.sent.some((m) => m.kind === 'create_template')).toBe(true);
  });

  it('trae calidad y tier del numero desde Meta', async () => {
    wa.phoneInfo = { ...wa.phoneInfo, qualityRating: 'YELLOW', messagingLimitTier: 'TIER_10K' };
    const response = await app.inject({ method: 'POST', url: '/admin/number/sync', headers: auth });
    expect(response.json().number).toMatchObject({ quality: 'YELLOW', tier: 'TIER_10K' });

    const health = await app.inject({ url: '/admin/health', headers: auth });
    expect(health.json().number.tier).toBe('TIER_10K');
    await repos.numberState.setQuality('PNID', 'GREEN');
  });
});

describe('conexion de la cuenta desde /setup', () => {
  it('el estado dice si la app esta suscrita a la cuenta de negocio', async () => {
    const before = await app.inject({ url: '/admin/settings/status', headers: auth });
    expect(before.json()).toMatchObject({ subscribed: false, verifyTokenSet: true, appSecretSet: true });

    const subscribe = await app.inject({ method: 'POST', url: '/admin/settings/subscribe', headers: auth });
    expect(subscribe.json()).toMatchObject({ success: true, subscribed: true });

    const after = await app.inject({ url: '/admin/settings/status', headers: auth });
    expect(after.json().subscribed).toBe(true);
  });

  it('registra el numero con un PIN de 6 digitos y rechaza otros', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/admin/settings/register',
      headers: auth,
      payload: { pin: '123456' },
    });
    expect(ok.json()).toMatchObject({ success: true });

    const bad = await app.inject({
      method: 'POST',
      url: '/admin/settings/register',
      headers: auth,
      payload: { pin: '12' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('el mensaje de prueba sale con hello_world al telefono del operador', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/settings/test-message',
      headers: auth,
      payload: { phone: '+52 1 55 9999 0000' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, template: 'hello_world' });
    expect(wa.sent.at(-1)).toMatchObject({
      kind: 'template',
      name: 'hello_world',
      to: '5215599990000',
    });
    expect((await repos.contacts.getByPhone('5215599990000'))?.optInSource).toBe(
      'numero de prueba del operador',
    );
  });
});

describe('la pantalla de conexion (/setup)', () => {
  let pagina = '';

  beforeAll(async () => {
    const r = await app.inject({ url: '/setup', headers: auth });
    expect(r.statusCode).toBe(200);
    pagina = r.body;
  });

  it('ensena los cuatro pasos con su progreso: sin el, nadie sabe cuanto falta', () => {
    for (const id of ['paso1', 'paso2', 'paso3', 'paso4']) {
      expect(pagina, id).toContain(`id="${id}"`);
    }
    expect(pagina).toContain('id="progreso"');
    // El texto "Paso N de 4" lo pone el navegador, pero la plantilla tiene los cuatro peldanos.
    expect(pagina.match(/data-paso="\d"/g)).toHaveLength(4);
  });

  it('la primera pregunta no es tecnica y ofrece los cinco caminos como radios', () => {
    expect(pagina).toContain('¿Quieres seguir usando WhatsApp en el móvil?');
    for (const modo of ['local', 'coexistence', 'dedicated', 'manual', 'waha']) {
      expect(pagina, modo).toContain(`<input type="radio" name="modo" value="${modo}">`);
    }
  });

  it('solo hay un boton para cerrar la sesion de WhatsApp: dos hacian lo mismo y confundian', () => {
    expect(pagina.match(/id="desconectar"/g)).toHaveLength(1);
    expect(pagina).not.toContain('id="waha-logout"');
  });

  it('usa las clases compartidas del armazon y no colores a pelo (romperian el modo oscuro)', () => {
    expect(pagina).toContain('class="btn primario"');
    expect(pagina).toContain('class="tarjeta paso"');
    // El unico blanco permitido es el fondo del QR (un QR invertido no se escanea)
    // y el azul de marca de Facebook, declarado como variable.
    // Solo el CSS propio de esta pantalla: empieza en .wrap y acaba en su ultima regla.
    const css = pagina.slice(pagina.indexOf('.wrap { --fb:'), pagina.indexOf('#gsg-sim-valor'));
    const colores = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(colores.filter((c) => c.toLowerCase() !== '#fff' && c.toLowerCase() !== '#1877f2')).toEqual([]);
  });
});

describe('automatizacion desde la API', () => {
  it('crea una secuencia, una regla que la usa e inscribe contactos', async () => {
    const sequence = await app.inject({
      method: 'POST',
      url: '/admin/automation/sequences',
      headers: auth,
      payload: { name: 'Seguimiento', steps: [{ delayMinutes: 60, kind: 'text', text: 'Hola {nombre}' }] },
    });
    expect(sequence.statusCode).toBe(200);
    const sequenceId = sequence.json().id;

    const rule = await app.inject({
      method: 'POST',
      url: '/admin/automation/rules',
      headers: auth,
      payload: { name: 'Cotizar', trigger: 'keyword', keyword: 'cotizar', reply: 'Va', sequenceId },
    });
    expect(rule.statusCode).toBe(200);

    const enroll = await app.inject({
      method: 'POST',
      url: `/admin/automation/sequences/${sequenceId}/enroll`,
      headers: auth,
      payload: { phones: ['5215510000001', '5215510000001', '52 155 1000 0002'], source: 'test' },
    });
    expect(enroll.json()).toMatchObject({ enrolled: 2, already: 1 });

    const enrollments = await app.inject({
      url: '/admin/automation/enrollments?status=active',
      headers: auth,
    });
    expect(enrollments.json()).toHaveLength(2);

    const scheduled = await app.inject({
      url: '/admin/automation/scheduled?status=pending',
      headers: auth,
    });
    expect(scheduled.json()).toHaveLength(2);
    expect(scheduled.json()[0]).toMatchObject({ sequenceName: 'Seguimiento', stepPosition: 1 });
  });

  it('rechaza reglas sin palabra o sin accion', async () => {
    const noKeyword = await app.inject({
      method: 'POST',
      url: '/admin/automation/rules',
      headers: auth,
      payload: { name: 'x', trigger: 'keyword', reply: 'y' },
    });
    expect(noKeyword.statusCode).toBe(400);

    const noAction = await app.inject({
      method: 'POST',
      url: '/admin/automation/rules',
      headers: auth,
      payload: { name: 'x', trigger: 'any' },
    });
    expect(noAction.statusCode).toBe(400);
  });

  it('programa un mensaje suelto, lo ejecuta y cancela otro', async () => {
    await repos.contacts.touchInbound('5215510000001', new Date());

    const due = await app.inject({
      method: 'POST',
      url: '/admin/automation/scheduled',
      headers: auth,
      payload: {
        phone: '5215510000001',
        dueAt: new Date(Date.now() - 1000).toISOString(),
        kind: 'freeform',
        text: 'ya',
      },
    });
    expect(due.statusCode).toBe(200);

    const later = await app.inject({
      method: 'POST',
      url: '/admin/automation/scheduled',
      headers: auth,
      payload: {
        phone: '5215510000001',
        dueAt: new Date(Date.now() + 3_600_000).toISOString(),
        kind: 'freeform',
        text: 'luego',
      },
    });

    const run = await app.inject({ method: 'POST', url: '/admin/automation/run', headers: auth });
    expect(run.json().sent).toBeGreaterThanOrEqual(1);
    expect(wa.sent.some((m) => m.kind === 'text' && m.body === 'ya')).toBe(true);

    const cancel = await app.inject({
      method: 'POST',
      url: `/admin/automation/scheduled/${later.json().id}/cancel`,
      headers: auth,
    });
    expect(cancel.statusCode).toBe(200);

    const again = await app.inject({
      method: 'POST',
      url: `/admin/automation/scheduled/${later.json().id}/cancel`,
      headers: auth,
    });
    expect(again.statusCode).toBe(409);
  });

  it('guarda la preferencia del boton de ubicacion', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/automation/prefs',
      headers: auth,
      payload: { askLocationFallback: false },
    });
    const prefs = await app.inject({ url: '/admin/automation/prefs', headers: auth });
    expect(prefs.json()).toMatchObject({ askLocationFallback: false });
  });
});

describe('los scripts de las pantallas', () => {
  it('cada <script> del panel, el chat y el manual compila (un error de sintaxis deja la pantalla muerta)', async () => {
    const vm = await import('node:vm');
    for (const url of ['/panel', '/chat', '/rutas', '/manual', '/setup', '/soporte']) {
      const r = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${ADMIN}` } });
      expect(r.statusCode, url).toBe(200);
      let n = 0;
      for (const m of r.body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
        n++;
        expect(() => new vm.Script(m[1]!, { filename: `${url}#${n}` }), `${url} script ${n}`).not.toThrow();
      }
      expect(n, url).toBeGreaterThan(0);
    }
  });
});

describe('las secciones del panel', () => {
  it('todo enlace a /panel#algo tiene su seccion, y ninguna repite arriba el titulo que ya pinta la barra', async () => {
    const r = await app.inject({ url: '/panel', headers: auth });
    expect(r.statusCode).toBe(200);

    // El menu de shell.ts y los atajos de las tarjetas enlazan por ancla: si una
    // seccion desaparece o se renombra, el enlace lleva a una pantalla en blanco.
    const anclas = new Set([...r.body.matchAll(/\/panel#([a-z-]+)/g)].map((m) => m[1]!));
    expect(anclas.size).toBeGreaterThan(10);
    for (const ancla of anclas) {
      expect(r.body, `falta la seccion #${ancla}`).toContain(`id="tab-${ancla}"`);
    }

    // El armazon ya escribe el titulo de la seccion en la barra de arriba:
    // volver a ponerlo en un <h2> era la misma frase dos veces en pantalla.
    for (const repetido of ['Contactos', 'Actividad', 'Plantillas', 'Usuarios', 'Tiendas', 'Stickers', 'Mi cuenta']) {
      expect(r.body, `el titulo "${repetido}" sale dos veces`).not.toContain(`<h2>${repetido}</h2>`);
    }
  });

  it('Plantillas: la lista por defecto, crear en un cajon y las variables salen del cuerpo', async () => {
    const r = await app.inject({ url: '/panel', headers: auth });
    // Dos pestañas (lo tuyo y lo del sistema) y el alta en un cajon aparte, no debajo de la lista.
    expect(r.body).toContain('id="tp-tab-tuyas"');
    expect(r.body).toContain('id="tp-tab-sistema"');
    expect(r.body).toMatch(/<aside class="tp-cajon" id="tp-cajon" role="dialog"/);
    expect(r.body).toContain('id="tp-nueva"');
    expect(r.body).toContain('id="tp-insertar"');
    expect(r.body).toContain('id="tp-previa"');
    // Ya no se describen las variables a mano en un textarea: se pintan un campo por {{n}}.
    expect(r.body).not.toContain('<textarea id="tp-vars"');
    expect(r.body).toContain('<div id="tp-vars"></div>');
  });
});
