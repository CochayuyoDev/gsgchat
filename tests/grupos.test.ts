/**
 * Grupos de clientes: que los filtros escojan bien (reparto, ficha,
 * actividad, consentimiento), que el mensaje se personalice por cliente, que
 * un texto libre se vuelva plantilla propia y que el envio cree una campaña
 * por goteo con las variables de cada uno. Y los atajos del chat.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { camposFaltantes, evaluarGrupo, primerNombre, textoAPlantilla, variablesDeCliente, renderParaCliente } from '../src/segmentos/segmentos.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, approvedTemplate, type FakeRepos } from './fakes.js';

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
  BUSINESS_NAME: 'La Tienda',
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

const DIA = 24 * 60 * 60 * 1000;

/** Un mundo pequeño: seis clientes en distintos puntos. */
async function poblar(repos: FakeRepos, ahora: Date) {
  const alta = async (phone: string, name: string, optIn: boolean, ultimo: Date | null) => {
    const c = await repos.contacts.upsertFromInbound(phone, name);
    if (optIn) await repos.contacts.setOptIn(phone, 'prueba');
    const guardado = repos._contacts.get(phone)!;
    guardado.lastInboundAt = ultimo;
    return c;
  };
  const ana = await alta('51912000001', 'Ana Perez', true, new Date(ahora.getTime() - 2 * 60 * 60 * 1000)); // escribio hace 2 h
  const luis = await alta('51912000002', 'Luis Soto', true, new Date(ahora.getTime() - 10 * DIA)); // callado 10 dias
  const rosa = await alta('51912000003', 'Rosa Diaz', true, null); // nunca escribio
  const pedro = await alta('51912000004', 'Pedro Lau', false, new Date(ahora.getTime() - 1 * DIA)); // sin opt-in
  const baja = await alta('51912000005', 'Baja', true, null);
  await repos.contacts.setOptOut('51912000005');
  const carla = await alta('51912000006', 'Carla', true, new Date(ahora.getTime() - 3 * DIA));

  const lote = await repos.rutas.crearLote({ nombre: 'Reparto viernes' });
  await repos.rutas.agregarSolicitudes(lote.id, [
    { telefonoCrudo: '51912000001', phone: '51912000001', nombre: 'Ana Perez', referencia: 'P-1001', direccion: 'Av. Larco 123', distrito: 'Miraflores', estado: 'enviado' },
    { telefonoCrudo: '51912000002', phone: '51912000002', nombre: 'Luis Soto', referencia: 'P-1002', distrito: 'Surco', estado: 'resuelto' },
    { telefonoCrudo: '51912000003', phone: '51912000003', nombre: 'Rosa Diaz', referencia: 'P-1003', estado: 'supervision', requiereHumano: true },
    { telefonoCrudo: '51912000004', phone: '51912000004', nombre: 'Pedro Lau', referencia: 'P-1004', estado: 'derivado' },
  ]);

  // Fichas: Ana completa, Carla incompleta, el resto sin ficha.
  await repos.leads.ensure(ana.id, 'Ana Perez');
  await repos.leads.update(ana.id, { recojoDistrito: 'Miraflores', entregaDistrito: 'Surco', contenido: 'ropa', cuando: 'hoy', nombre: 'Ana Perez', documentoNumero: '12345678', estado: 'calificado' });
  await repos.leads.ensure(carla.id, 'Carla');
  await repos.leads.update(carla.id, { recojoDistrito: 'Lince' });
  return { ana, luis, rosa, pedro, baja, carla, lote };
}

describe('evaluar un grupo', () => {
  const ahora = new Date('2026-09-11T15:00:00Z');

  it('por defecto: con opt-in, sin bajas; y las cifras cuadran', async () => {
    const repos = createFakeRepos();
    await poblar(repos, ahora);
    const r = await evaluarGrupo(repos, { consentimiento: 'opt_in', reparto: 'cualquiera', ficha: 'cualquiera', actividad: 'cualquiera', dias: 7 }, ahora);
    expect(r.clientes.map((c) => c.phone).sort()).toEqual(['51912000001', '51912000002', '51912000003', '51912000006']);
    expect(r.cifras.conOptIn).toBe(4);
    expect(r.cifras.ventanaAbierta).toBe(1);
    expect(r.cifras.reparto).toEqual({ enviado: 1, resuelto: 1, supervision: 1, sin_solicitud: 1 });
    expect(r.cifras.ficha).toEqual({ completa: 1, incompleta: 1, sin_ficha: 2 });
    const todos = await evaluarGrupo(repos, { consentimiento: 'todos', reparto: 'cualquiera', ficha: 'cualquiera', actividad: 'cualquiera', dias: 7 }, ahora);
    expect(todos.total).toBe(5); // Pedro entra, la baja nunca
  });

  it('filtra por punto del reparto y trae el pedido como variable', async () => {
    const repos = createFakeRepos();
    await poblar(repos, ahora);
    const base = { consentimiento: 'todos' as const, ficha: 'cualquiera' as const, actividad: 'cualquiera' as const, dias: 7 };
    const sin = await evaluarGrupo(repos, { ...base, reparto: 'sin_ubicacion' }, ahora);
    expect(sin.clientes.map((c) => c.phone)).toEqual(['51912000001']);
    expect(sin.clientes[0]?.variables).toEqual({ nombre: 'Ana', pedido: 'P-1001', direccion: 'Av. Larco 123', distrito: 'Miraflores' });
    expect((await evaluarGrupo(repos, { ...base, reparto: 'contesto_sin_ubicacion' }, ahora)).clientes.map((c) => c.phone)).toEqual(['51912000003']);
    expect((await evaluarGrupo(repos, { ...base, reparto: 'derivado' }, ahora)).clientes.map((c) => c.phone)).toEqual(['51912000004']);
    expect((await evaluarGrupo(repos, { ...base, reparto: 'con_ubicacion' }, ahora)).clientes.map((c) => c.phone)).toEqual(['51912000002']);
    expect((await evaluarGrupo(repos, { ...base, reparto: 'sin_solicitud' }, ahora)).clientes.map((c) => c.phone)).toEqual(['51912000006']);
  });

  it('filtra por ficha, por actividad y por lista pegada', async () => {
    const repos = createFakeRepos();
    await poblar(repos, ahora);
    const base = { consentimiento: 'todos' as const, reparto: 'cualquiera' as const, dias: 7 };
    expect((await evaluarGrupo(repos, { ...base, ficha: 'incompleta', actividad: 'cualquiera' }, ahora)).clientes.map((c) => c.phone)).toEqual(['51912000006']);
    const inc = await evaluarGrupo(repos, { ...base, ficha: 'incompleta', actividad: 'cualquiera' }, ahora);
    expect(inc.clientes[0]?.ficha?.faltan).toEqual(['distrito de entrega', 'qué se envía', 'cuándo', 'documento']);
    expect((await evaluarGrupo(repos, { ...base, ficha: 'completa', actividad: 'cualquiera' }, ahora)).clientes.map((c) => c.phone)).toEqual(['51912000001']);
    expect((await evaluarGrupo(repos, { ...base, ficha: 'sin_ficha', actividad: 'cualquiera' }, ahora)).total).toBe(3);
    expect((await evaluarGrupo(repos, { ...base, ficha: 'cualquiera', actividad: 'ventana_abierta' }, ahora)).clientes.map((c) => c.phone)).toEqual(['51912000001']);
    expect((await evaluarGrupo(repos, { ...base, ficha: 'cualquiera', actividad: 'callado_dias', dias: 7 }, ahora)).clientes.map((c) => c.phone).sort()).toEqual(['51912000002', '51912000003']);
    expect((await evaluarGrupo(repos, { ...base, ficha: 'cualquiera', actividad: 'escribio_dias', dias: 7 }, ahora)).clientes.map((c) => c.phone).sort()).toEqual(['51912000001', '51912000004', '51912000006']);
    expect((await evaluarGrupo(repos, { ...base, ficha: 'cualquiera', actividad: 'nunca_escribio' }, ahora)).clientes.map((c) => c.phone)).toEqual(['51912000003']);
    const pegados = await evaluarGrupo(repos, { ...base, ficha: 'cualquiera', actividad: 'cualquiera', telefonos: ['+51 912 000 002', '51912000006', '51999999999'] }, ahora);
    expect(pegados.clientes.map((c) => c.phone).sort()).toEqual(['51912000002', '51912000006']);
  });

  it('un texto con marcadores se vuelve plantilla y se rellena por cliente', () => {
    const t = textoAPlantilla('Hola {nombre}, tu pedido {pedido} sale hoy. Gracias, {negocio}. ({nombre})');
    expect(t.body).toBe('Hola {{1}}, tu pedido {{2}} sale hoy. Gracias, {{3}}. ({{1}})');
    expect(t.variables).toEqual(['nombre', 'pedido', 'negocio']);
    const cliente = {
      contactId: 'c', phone: '51912000001', nombre: 'Ana Perez', optIn: true, ultimoMensajeAt: null, ventanaAbierta: false, reparto: null, ficha: null,
      variables: { nombre: 'Ana', pedido: 'P-1', direccion: '', distrito: '' },
    };
    expect(variablesDeCliente(cliente, t.variables, 'La Tienda', 3)).toEqual(['Ana', 'P-1', 'La Tienda']);
    expect(variablesDeCliente(cliente, [], 'La Tienda', 3)).toEqual(['Ana', 'P-1', 'La Tienda']);
    expect(variablesDeCliente({ ...cliente, variables: { nombre: '', pedido: '', direccion: '', distrito: '' } }, ['Nombre del cliente', 'Referencia del pedido'], 'X', 2)).toEqual(['buenas', 'su pedido']);
    expect(renderParaCliente(t.body, t.variables, cliente, 'La Tienda')).toBe('Hola Ana, tu pedido P-1 sale hoy. Gracias, La Tienda. (Ana)');
    expect(primerNombre('  Rosa  Diaz ')).toBe('Rosa');
    expect(camposFaltantes({ recojoDistrito: 'x', entregaDistrito: 'y', contenido: 'z', cuando: 'hoy', nombre: 'n', documentoNumero: '1' } as never)).toEqual([]);
  });
});

describe('/admin/grupos y atajos del chat', () => {
  let app: FastifyInstance;
  let repos: FakeRepos;
  let admin = '';
  const ahora = new Date();

  function cookieDe(res: { headers: Record<string, unknown> }): string {
    const set = res.headers['set-cookie'];
    const linea = Array.isArray(set) ? set[0] : (set as string | undefined);
    return (linea as string).split(';')[0]!;
  }

  beforeAll(async () => {
    const config = loadConfig(ENV);
    repos = createFakeRepos();
    await poblar(repos, ahora);
    await repos.templates.upsert(approvedTemplate({ name: 'aviso_pedido', body: 'Hola {{1}}, tu pedido {{2}} va en camino. {{3}}', variables: 3 }));
    const wa = createFakeWhatsApp();
    const settings = await createFakeSettings(config);
    await settings.save({ provider: 'local' });
    const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, ajustes });
    await app.ready();
    admin = cookieDe(await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'clave-segura-1' } }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('las opciones traen etiquetas, lotes, plantillas aprobadas y si vale el texto libre', async () => {
    const r = (await app.inject({ method: 'GET', url: '/admin/grupos/opciones', headers: { cookie: admin } })).json();
    expect(r.reparto.sin_ubicacion).toContain('sin ubicación');
    expect(r.lotes[0]).toMatchObject({ nombre: 'Reparto viernes' });
    expect(r.plantillas.map((t: { name: string }) => t.name)).toContain('aviso_pedido');
    expect(r.textoLibre).toBe(true);
    expect(r.negocio).toBe('La Tienda');
  });

  it('previsualiza el grupo con cifras y muestra', async () => {
    const r = (await app.inject({ method: 'POST', url: '/admin/grupos/previsualizar', headers: { cookie: admin }, payload: { reparto: 'sin_ubicacion', consentimiento: 'todos' } })).json();
    expect(r.total).toBe(1);
    expect(r.telefonos).toEqual(['51912000001']);
    expect(r.clientes[0]).toMatchObject({ nombre: 'Ana Perez', reparto: { estado: 'enviado', pedido: 'P-1001' }, ficha: { completa: true } });
  });

  it('un texto libre crea una plantilla propia y una campaña con las variables de cada cliente', async () => {
    const previa = (await app.inject({ method: 'POST', url: '/admin/grupos/enviar', headers: { cookie: admin }, payload: { criterio: { consentimiento: 'opt_in' }, texto: 'Hola {nombre}, ¿nos mandas tu ubicación para {pedido}? Gracias, {negocio}.', soloVistaPrevia: true } })).json();
    expect(previa.total).toBe(4);
    expect(previa.muestra.find((m: { phone: string }) => m.phone === '51912000001').texto).toBe('Hola Ana, ¿nos mandas tu ubicación para P-1001? Gracias, La Tienda.');
    expect(previa.muestra.find((m: { phone: string }) => m.phone === '51912000006').texto).toBe('Hola Carla, ¿nos mandas tu ubicación para su pedido? Gracias, La Tienda.');
    // Sin mandar, no se crea nada.
    expect((await repos.templates.list()).some((t) => t.name.startsWith('grupo_'))).toBe(false);

    const envio = (await app.inject({ method: 'POST', url: '/admin/grupos/enviar', headers: { cookie: admin }, payload: { criterio: { consentimiento: 'opt_in', reparto: 'sin_ubicacion' }, texto: 'Hola {nombre}, ¿nos mandas tu ubicación para {pedido}?', nombre: 'Recordatorio', canario: 0 } })).json();
    expect(envio.ok).toBe(true);
    expect(envio.enqueued).toBe(1);
    const propia = (await repos.templates.list()).find((t) => t.name.startsWith('grupo_'));
    expect(propia).toMatchObject({ propia: true, status: 'APPROVED', body: 'Hola {{1}}, ¿nos mandas tu ubicación para {{2}}?', variablesDoc: ['nombre', 'pedido'] });
    const destinatario = repos._recipients.find((r) => r.campaignId === envio.campaignId);
    expect(destinatario).toMatchObject({ phone: '51912000001', variables: ['Ana', 'P-1001'] });
    expect((await repos.campaigns.get(envio.campaignId))?.name).toBe('Recordatorio');
  });

  it('con una plantilla del registro rellena sus variables; sin clientes, avisa', async () => {
    const envio = (await app.inject({ method: 'POST', url: '/admin/grupos/enviar', headers: { cookie: admin }, payload: { criterio: { consentimiento: 'todos', reparto: 'derivado' }, plantilla: { name: 'aviso_pedido', language: 'es' }, canario: 0 } })).json();
    expect(envio.enqueued).toBe(1);
    const d = repos._recipients.find((r) => r.campaignId === envio.campaignId);
    expect(d).toMatchObject({ phone: '51912000004', variables: ['Pedro', 'P-1004', 'La Tienda'] });
    const vacio = await app.inject({ method: 'POST', url: '/admin/grupos/enviar', headers: { cookie: admin }, payload: { criterio: { consentimiento: 'opt_in', reparto: 'incidencia' }, plantilla: { name: 'aviso_pedido' } } });
    expect(vacio.statusCode).toBe(400);
    expect(vacio.json().error).toContain('ningún cliente');
  });

  it('exporta el grupo en CSV', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/grupos/exportar', headers: { cookie: admin }, payload: { consentimiento: 'todos', ficha: 'incompleta' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('grupo-clientes.csv');
    expect(res.body).toContain('51912000006;Carla;si;');
    expect(res.body).toContain('distrito de entrega');
  });

  it('los atajos del chat vienen de fabrica, se cambian y se restablecen', async () => {
    const fabrica = (await app.inject({ method: 'GET', url: '/admin/chat/atajos', headers: { cookie: admin } })).json();
    expect(fabrica.deFabrica).toBe(true);
    expect(fabrica.atajos.map((a: { atajo: string }) => a.atajo)).toContain('ubi');
    const guardado = (await app.inject({ method: 'POST', url: '/admin/chat/atajos', headers: { cookie: admin }, payload: { atajos: [{ atajo: '/Hola', texto: 'Hola {nombre}, soy de {negocio}.' }] } })).json();
    expect(guardado.atajos).toEqual([{ atajo: 'hola', texto: 'Hola {nombre}, soy de {negocio}.' }]);
    expect((await app.inject({ method: 'GET', url: '/admin/chat/atajos', headers: { cookie: admin } })).json().deFabrica).toBe(false);
    const vuelta = (await app.inject({ method: 'POST', url: '/admin/chat/atajos', headers: { cookie: admin }, payload: { atajos: null } })).json();
    expect(vuelta.deFabrica).toBe(true);
  });

  it('el chat dice en que punto del reparto va el cliente', async () => {
    const ana = await repos.contacts.getByPhone('51912000001');
    const r = (await app.inject({ method: 'GET', url: `/admin/chat/${ana!.id}`, headers: { cookie: admin } })).json();
    expect(r.reparto).toMatchObject({ referencia: 'P-1001', estado: 'enviado', distrito: 'Miraflores' });
  });
});
