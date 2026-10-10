/**
 * La API del modulo de rutas, contra el servidor real con dobles en memoria.
 *
 * Es el camino que usa la pantalla y el que usara GSG cuando tenga API, asi
 * que lo que se prueba aqui es el contrato: que una tabla pegada acabe en
 * solicitudes marcadas, que las vistas cuenten lo que dicen y que corregir un
 * telefono devuelva el caso a la cola en vez de dejarlo colgado.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import type { Sender, SendJob, SendOutcome } from '../src/outbound/sender.js';
import { crearMotor, OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import { crearPuertoEnEspera } from '../src/rutas/gsg.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, CLAVE_API_PRUEBA as ADMIN } from './fakes.js';


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
  const sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 },
    maxMarketingPerContact7d: 2,
  });
  app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  repos.rutas._lotes.length = 0;
  repos.rutas._solicitudes.length = 0;
  repos.rutas._reportes.length = 0;
  repos.rutas._eventos.length = 0;
});

const TABLA = [
  'telefono;nombre;pedido;distrito',
  '987654321;Ana Ruiz;P-1;Miraflores',
  '98765432;Pedro Soto;P-2;Surco',
  '911111111;Luis Paz;P-3;Lince',
].join('\n');

async function crearLote(extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/rutas/lotes',
    headers: auth,
    payload: { nombre: 'Reparto de prueba', texto: TABLA, ...extra },
  });
  return { res, cuerpo: res.json() };
}

describe('cargar el lote', () => {
  it('previsualizar dice que entendio sin guardar nada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/rutas/previsualizar',
      headers: auth,
      payload: { texto: TABLA },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      conCabecera: true,
      listas: 2,
      conIncidencia: 1,
      incidencias: { numero_corto: 1 },
    });
    expect(repos.rutas._lotes).toHaveLength(0);
  });

  it('crea el lote con los numeros malos ya marcados', async () => {
    const { res, cuerpo } = await crearLote();

    expect(res.statusCode).toBe(200);
    expect(cuerpo).toMatchObject({ total: 3, listas: 2, conIncidencia: 1 });

    const solicitudes = repos.rutas._solicitudes;
    expect(solicitudes).toHaveLength(3);
    const mala = solicitudes.find((s) => s.telefonoCrudo === '98765432');
    expect(mala).toMatchObject({ estado: 'incidencia', incidencia: 'numero_corto', requiereHumano: true });
    expect(mala?.phone).toBeNull();

    // Y GSG se entera del numero roto desde el primer minuto.
    expect(repos.rutas._reportes.some((r) => r.tipo === 'incidencia')).toBe(true);
  });

  it('arranca el envio si se le pide', async () => {
    const { cuerpo } = await crearLote({ arrancar: true });
    expect(cuerpo.lote.estado).toBe('enviando');
  });

  it('acepta las filas en JSON: es por donde entrara GSG', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/rutas/lotes',
      headers: auth,
      payload: {
        nombre: 'Desde la API',
        externoId: 'GSG-LOTE-9',
        filas: [{ telefono: '987654321', nombre: 'Ana', referencia: 'P-9' }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().lote).toMatchObject({ origen: 'api', externoId: 'GSG-LOTE-9' });
  });

  it('el mismo numero en un segundo lote no se escribe dos veces: queda como "ya en curso"', async () => {
    const primero = await app.inject({
      method: 'POST',
      url: '/admin/rutas/lotes',
      headers: auth,
      payload: { nombre: 'Lunes', arrancar: true, filas: [{ telefono: '987654321', nombre: 'Ana', referencia: 'P-1' }] },
    });
    expect(primero.statusCode).toBe(200);
    const segundo = await app.inject({
      method: 'POST',
      url: '/admin/rutas/lotes',
      headers: auth,
      payload: { nombre: 'Martes', arrancar: true, filas: [{ telefono: '987654321', nombre: 'Ana', referencia: 'P-2' }, { telefono: '912345678', nombre: 'Luis', referencia: 'P-3' }] },
    });
    expect(segundo.statusCode).toBe(200);
    const loteB = segundo.json().lote.id as string;
    const bandeja = await app.inject({ method: 'GET', url: `/admin/rutas/solicitudes?loteId=${loteB}&limit=10`, headers: auth });
    const items = bandeja.json().items as Array<{ phone: string; estado: string; incidencia: string | null; incidenciaDetalle: string | null }>;
    const repetida = items.find((s) => s.phone === '51987654321')!;
    expect(repetida.estado).toBe('incidencia');
    expect(repetida.incidencia).toBe('ya_en_curso');
    expect(repetida.incidenciaDetalle).toMatch(/P-1/);
    // El otro cliente del segundo lote sigue su camino normal.
    expect(items.find((s) => s.phone === '51912345678')?.estado).toBe('pendiente');
  });

  it('una tabla sin telefonos se rechaza con el motivo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/rutas/lotes',
      headers: auth,
      payload: { texto: 'nombre;pedido\nAna;P-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/teléfono/);
  });
});

describe('la bandeja', () => {
  it('las vistas cuentan lo que dice su nombre', async () => {
    await crearLote();

    const res = await app.inject({ method: 'GET', url: '/admin/rutas/vistas', headers: auth });
    const { cifras, nombres } = res.json();

    expect(cifras).toMatchObject({ todos: 3, pendientes: 2, numero_malo: 1, requieren_persona: 1 });
    expect(nombres.numero_malo).toBe('Número mal escrito');
  });

  it('filtra por vista', async () => {
    await crearLote();

    const res = await app.inject({
      method: 'GET',
      url: '/admin/rutas/solicitudes?vista=numero_malo',
      headers: auth,
    });

    const { items, total } = res.json();
    expect(total).toBe(1);
    expect(items[0].incidencia).toBe('numero_corto');
  });

  it('el detalle trae la bitacora y la explicacion de la incidencia', async () => {
    await crearLote();
    const mala = repos.rutas._solicitudes.find((s) => s.incidencia === 'numero_corto')!;

    const res = await app.inject({
      method: 'GET',
      url: `/admin/rutas/solicitudes/${mala.id}`,
      headers: auth,
    });

    const cuerpo = res.json();
    expect(cuerpo.incidencia).toMatchObject({ titulo: 'Número incompleto' });
    expect(cuerpo.incidencia.queHacer).toMatch(/[Cc]orregir/);
    expect(cuerpo.eventos.length).toBeGreaterThan(0);
  });
});

describe('arreglar a mano', () => {
  it('corregir el telefono devuelve el caso a la cola', async () => {
    await crearLote();
    const mala = repos.rutas._solicitudes.find((s) => s.incidencia === 'numero_corto')!;

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/rutas/solicitudes/${mala.id}`,
      headers: auth,
      payload: { telefono: '987654399' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().solicitud).toMatchObject({
      phone: '51987654399',
      telefonoCrudo: '987654399',
      estado: 'pendiente',
      incidencia: null,
      requiereHumano: false,
      intentos: 0,
    });
  });

  it('un telefono que sigue mal se rechaza explicando por que', async () => {
    await crearLote();
    const mala = repos.rutas._solicitudes.find((s) => s.incidencia === 'numero_corto')!;

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/rutas/solicitudes/${mala.id}`,
      headers: auth,
      payload: { telefono: '12345' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ incidencia: 'numero_corto' });
    // Y la solicitud se queda como estaba.
    expect(repos.rutas._solicitudes.find((s) => s.id === mala.id)?.estado).toBe('incidencia');
  });

  it('la ubicacion conseguida por telefono se carga y se reporta', async () => {
    await crearLote();
    const buena = repos.rutas._solicitudes.find((s) => s.phone === '51987654321')!;

    const res = await app.inject({
      method: 'POST',
      url: `/admin/rutas/solicitudes/${buena.id}/resolver`,
      headers: auth,
      payload: { lat: -12.09, lng: -77.03, nota: 'la dio por telefono' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().solicitud).toMatchObject({ estado: 'resuelto', ubicacionFuente: 'cargada a mano' });
    expect(repos.rutas._reportes.some((r) => r.tipo === 'ubicacion')).toBe(true);
  });

  it('derivar al repartidor lo saca de la cola y avisa a GSG', async () => {
    await crearLote();
    const buena = repos.rutas._solicitudes.find((s) => s.phone === '51987654321')!;

    const res = await app.inject({
      method: 'POST',
      url: `/admin/rutas/solicitudes/${buena.id}/derivar`,
      headers: auth,
      payload: { motivo: 'el cliente pidio que lo llamen', asignadoA: 'Motorizado 2' },
    });

    expect(res.json().solicitud).toMatchObject({
      estado: 'derivado',
      requiereHumano: true,
      asignadoA: 'Motorizado 2',
      proximoIntentoAt: null,
    });
  });

  it('no se puede devolver a la cola algo sin telefono marcable', async () => {
    await crearLote();
    const mala = repos.rutas._solicitudes.find((s) => s.incidencia === 'numero_corto')!;

    const res = await app.inject({
      method: 'POST',
      url: `/admin/rutas/solicitudes/${mala.id}/reintentar`,
      headers: auth,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/corrígelo/);
  });
});

describe('lo que se lleva GSG', () => {
  it('el CSV del lote trae lo que hace falta para trabajarlo', async () => {
    const { cuerpo } = await crearLote();

    const res = await app.inject({
      method: 'GET',
      url: `/admin/rutas/lotes/${cuerpo.lote.id}.csv`,
      headers: auth,
    });

    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lineas = res.body.trim().split('\r\n');
    expect(lineas[0]).toContain('referencia;telefono;telefono_original');
    expect(lineas).toHaveLength(4);
    expect(res.body).toContain('numero_corto');
  });

  it('la cola se puede mirar y bajar mientras no haya API', async () => {
    await crearLote();

    const estado = await app.inject({ method: 'GET', url: '/admin/rutas/cola', headers: auth });
    expect(estado.json()).toMatchObject({ conectado: false, cifras: { pendiente: 1 } });

    const fichero = await app.inject({ method: 'GET', url: '/admin/rutas/cola.ndjson', headers: auth });
    expect(fichero.headers['content-type']).toMatch(/ndjson/);
    expect(fichero.body).toContain('numero_corto');

    // Y despachar sin API no rompe: dice por que no mando nada.
    const despacho = await app.inject({ method: 'POST', url: '/admin/rutas/cola/despachar', headers: auth });
    expect(despacho.json()).toMatchObject({ enviados: 0 });
    expect(despacho.json().motivo).toMatch(/GSG_URL/);
  });

  it('el resumen general trae las alertas y el estado del motor', async () => {
    await crearLote();

    const res = await app.inject({ method: 'GET', url: '/admin/rutas', headers: auth });
    const cuerpo = res.json();

    expect(cuerpo.alertas.requierenPersona).toBe(1);
    expect(cuerpo.motor).toMatchObject({ pausa: [15, 30], maxIntentos: 3, horario: [9, 19] });
    expect(cuerpo.gsg.conectado).toBe(false);
    expect(cuerpo.catalogo.sin_whatsapp.titulo).toBe('El número no tiene WhatsApp');
  });
});

describe('el token de admin protege el modulo', () => {
  it('sin token no se ve nada', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/rutas' });
    expect(res.statusCode).toBe(401);
  });
});

describe('la lista de quien no mandó su ubicación', () => {
  it('el javascript de la página de rutas no tiene errores de sintaxis', async () => {
    // La pantalla entera vive dentro de una plantilla de texto: TypeScript no
    // mira lo que hay dentro, así que un paréntesis de menos deja la página
    // muerta con la suite en verde.
    const html = (await app.inject({ url: '/rutas', headers: auth })).body;
    const desde = html.lastIndexOf('<script>');
    const hasta = html.lastIndexOf('</script>');
    expect(desde).toBeGreaterThan(-1);
    expect(() => new Function(html.slice(desde + '<script>'.length, hasta))).not.toThrow();
  });

  it('la pantalla no trae su propia paleta: los colores salen de los tokens', async () => {
    // La página redefinía --bg, --panel, --accent... con colores a pelo y su
    // propio modo oscuro: lo que se veía aquí no era lo que se veía en el
    // resto del sistema. Los tonos los pone `tokens.ts` y nadie más.
    const html = (await app.inject({ url: '/rutas', headers: auth })).body;
    expect(html).not.toMatch(/--(panel|line|accent|chip|muted|text):\s*#/);
    expect(html).not.toContain('#d9fdd3');
  });

  it('en modo demostración la pantalla lo dice, no solo el armazón', async () => {
    // El aviso se armaba y no se pegaba en ninguna parte: en modo prueba la
    // pantalla no decía que no sale nada a ningún cliente.
    const { rutasPage } = await import('../src/web/rutas-page.js');
    expect(rutasPage({ configured: true, demo: true, nombreNegocio: 'Tienda' })).toContain('Modo demostración');
    expect(rutasPage({ configured: true, demo: false, nombreNegocio: 'Tienda' })).not.toContain('Modo demostración');
  });
});

describe('contactos sin ubicación', () => {
  it('lista solo a quien nunca mandó el pin, y sale de la lista al mandarlo', async () => {
    await repos.contacts.upsertFromInbound('51912000001', 'Sin pin');
    await repos.contacts.upsertFromInbound('51912000002', 'Con pin');

    const conPin = (await repos.contacts.getByPhone('51912000002'))!;
    const id = await repos.locations.save(
      conPin.id,
      { lat: -12.05, lng: -76.96, mapsUrl: 'https://maps.google.com/?q=-12.05,-76.96' } as never,
      'link',
    );
    await repos.locations.confirm(id);

    const lista = await app.inject({ url: '/admin/contacts?sinUbicacion=1&limit=100', headers: auth });
    expect(lista.statusCode).toBe(200);

    const telefonos = lista.json().items.map((c: { phone: string }) => c.phone);
    expect(telefonos).toContain('51912000001');
    // Y el que ya mandó su ubicación no está: no hay que sacarlo a mano.
    expect(telefonos).not.toContain('51912000002');
  });

  it('con esos teléfonos se crea el lote sin pegar nada', async () => {
    await repos.contacts.upsertFromInbound('51912000003', 'Ana');

    const r = await app.inject({
      method: 'POST',
      url: '/admin/rutas/lotes',
      headers: auth,
      payload: {
        nombre: 'Los que faltan',
        filas: [{ telefono: '51912000003', nombre: 'Ana' }],
        arrancar: false,
      },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().listas).toBe(1);
  });
});

describe('pedir la ubicación otra vez y quitar de la automatización', () => {
  const HORA_BUENA = new Date('2026-03-10T15:00:00Z'); // 10:00 en Lima

  /** Un motor con un sender de mentira: lo que «salga» queda en `enviados`. */
  function motorDePrueba() {
    const enviados: SendJob[] = [];
    const sender: Sender = {
      async send(job) {
        enviados.push(job);
        return { ok: true, wamid: `wamid.${enviados.length}`, deliveryId: enviados.length } as SendOutcome;
      },
    };
    const motor = crearMotor({
      repos,
      sender,
      gsg: crearPuertoEnEspera(),
      opciones: { ...OPCIONES_POR_DEFECTO, timezone: 'America/Lima' },
      usarPlantilla: () => false,
      ahora: () => HORA_BUENA,
    });
    return { motor, enviados };
  }

  /** Un cliente cargado en su lote y, si se pide, ya resuelto a mano. */
  async function clienteCargado(telefono: string, opciones: { resuelto?: boolean; arrancar?: boolean } = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/rutas/lotes',
      headers: auth,
      payload: {
        nombre: 'Lote original',
        arrancar: opciones.arrancar ?? false,
        filas: [{ telefono, nombre: 'Rosa Diaz', referencia: 'P-77', direccion: 'Av. Arequipa 100', distrito: 'Lince', notas: 'tocar fuerte' }],
      },
    });
    expect(res.statusCode).toBe(200);
    const solicitud = repos.rutas._solicitudes.find((s) => s.loteId === res.json().lote.id)!;
    if (opciones.resuelto) {
      const r = await app.inject({
        method: 'POST',
        url: `/admin/rutas/solicitudes/${solicitud.id}/resolver`,
        headers: auth,
        payload: { lat: -12.08, lng: -77.03 },
      });
      expect(r.statusCode).toBe(200);
    }
    return solicitud;
  }

  const volverAEmpezar = (id: number | string) =>
    app.inject({ method: 'POST', url: `/admin/rutas/solicitudes/${id}/volver-a-empezar`, headers: auth });

  it('crea una solicitud nueva en un lote nuevo y deja intacta la resuelta', async () => {
    const original = await clienteCargado('966100001', { resuelto: true });
    const antes = structuredClone(repos.rutas._solicitudes.find((s) => s.id === original.id)!);
    const eventosAntes = repos.rutas._eventos.filter((e) => e.solicitudId === original.id).map((e) => ({ ...e }));
    const reportesAntes = repos.rutas._reportes.map((r) => ({ ...r }));
    expect(antes).toMatchObject({ estado: 'resuelto', lat: -12.08, lng: -77.03 });
    expect(antes.resueltoAt).toBeInstanceOf(Date);

    const res = await volverAEmpezar(original.id);
    expect(res.statusCode).toBe(200);
    const cuerpo = res.json();
    expect(cuerpo).toEqual({ ok: true, loteId: expect.any(String), solicitudId: expect.any(Number) });

    // Lo nuevo: un lote de un solo cliente, en marcha, con los datos copiados.
    const lote = repos.rutas._lotes.find((l) => l.id === cuerpo.loteId)!;
    expect(lote).toMatchObject({ origen: 'reinicio_manual', estado: 'enviando' });
    expect(lote.nombre).toMatch(/^Reinicio manual — Rosa Diaz — /);
    const nueva = repos.rutas._solicitudes.find((s) => s.id === cuerpo.solicitudId)!;
    expect(nueva).toMatchObject({
      loteId: lote.id,
      estado: 'pendiente',
      phone: '51966100001',
      nombre: 'Rosa Diaz',
      referencia: 'P-77',
      direccion: 'Av. Arequipa 100',
      distrito: 'Lince',
      notas: 'tocar fuerte',
      lat: null,
      incidencia: null,
    });
    expect(repos.rutas._solicitudes.filter((s) => s.loteId === lote.id)).toHaveLength(1);

    // Lo de antes: la misma fila, la misma ubicacion, los mismos reportes.
    const despues = repos.rutas._solicitudes.find((s) => s.id === original.id)!;
    expect(despues).toEqual(antes);
    expect(repos.rutas._reportes.filter((r) => reportesAntes.some((a) => a.id === r.id))).toEqual(reportesAntes);
    // Y en su bitacora, solo una nota mas.
    const eventosDespues = repos.rutas._eventos.filter((e) => e.solicitudId === original.id);
    expect(eventosDespues.slice(0, eventosAntes.length)).toEqual(eventosAntes);
    expect(eventosDespues).toHaveLength(eventosAntes.length + 1);
    expect(eventosDespues.at(-1)).toMatchObject({ tipo: 'nota' });
    expect(eventosDespues.at(-1)!.detalle).toBe(`se inició un nuevo flujo manual: lote ${lote.nombre}, solicitud ${nueva.id}`);
  });

  it('a un cliente dado de baja no se le crea nada enviable: 422 y el motor no le escribe', async () => {
    const original = await clienteCargado('966100002', { resuelto: true });
    await repos.contacts.setOptOut('51966100002');
    const eventosAntes = repos.rutas._eventos.filter((e) => e.solicitudId === original.id).length;

    const res = await volverAEmpezar(original.id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: expect.stringMatching(/baja/), motivo: 'opt_out' });

    const deEseTelefono = repos.rutas._solicitudes.filter((s) => s.phone === '51966100002');
    expect(deEseTelefono.some((s) => ['pendiente', 'enviado', 'respondio'].includes(s.estado))).toBe(false);
    // Ningun lote suyo quedo en marcha, y a la original no se le anoto un flujo que no hubo.
    const lotes = new Set(deEseTelefono.map((s) => s.loteId));
    expect(repos.rutas._lotes.filter((l) => lotes.has(l.id)).some((l) => l.estado === 'enviando')).toBe(false);
    expect(repos.rutas._eventos.filter((e) => e.solicitudId === original.id)).toHaveLength(eventosAntes);

    const { motor, enviados } = motorDePrueba();
    await motor.tick();
    expect(enviados.filter((j) => j.phone === '51966100002')).toHaveLength(0);
  });

  it('sin telefono valido: 409 y no crea nada', async () => {
    await crearLote();
    const mala = repos.rutas._solicitudes.find((s) => s.incidencia === 'numero_corto')!;
    const lotesAntes = repos.rutas._lotes.length;

    const res = await volverAEmpezar(mala.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/teléfono/);
    expect(repos.rutas._lotes).toHaveLength(lotesAntes);
  });

  it('id invalido: 400; inexistente: 404', async () => {
    expect((await volverAEmpezar('abc')).statusCode).toBe(400);
    expect((await volverAEmpezar(0)).statusCode).toBe(400);
    const no = await volverAEmpezar(999999);
    expect(no.statusCode).toBe(404);
    expect(no.json().error).toBeTruthy();
  });

  it('si ya hay una solicitud abierta de ese telefono: 409 con cual es, sin duplicar', async () => {
    const abierta = await clienteCargado('966100003', { arrancar: true });
    const solicitudesAntes = repos.rutas._solicitudes.length;
    const lotesAntes = repos.rutas._lotes.length;

    const res = await volverAEmpezar(abierta.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: expect.any(String),
      abierta: { id: abierta.id, loteId: abierta.loteId, estado: 'pendiente' },
    });
    expect(repos.rutas._solicitudes).toHaveLength(solicitudesAntes);
    expect(repos.rutas._lotes).toHaveLength(lotesAntes);
  });

  it('dos clics a la vez crean un solo lote y una sola solicitud', async () => {
    const original = await clienteCargado('966100004', { resuelto: true });

    const [a, b] = await Promise.all([volverAEmpezar(original.id), volverAEmpezar(original.id)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const perdedora = a.statusCode === 409 ? a : b;
    const ganadora = a.statusCode === 200 ? a : b;
    expect(perdedora.json().abierta.id).toBe(ganadora.json().solicitudId);

    expect(repos.rutas._lotes.filter((l) => l.origen === 'reinicio_manual')).toHaveLength(1);
    const vivas = repos.rutas._solicitudes.filter((s) => s.phone === '51966100004' && s.estado === 'pendiente');
    expect(vivas).toHaveLength(1);
  });

  it('cancelar conserva la fila, deja nota y el motor ya no le escribe', async () => {
    const solicitud = await clienteCargado('966100005', { arrancar: true });
    const eventosAntes = repos.rutas._eventos.filter((e) => e.solicitudId === solicitud.id).length;

    const res = await app.inject({
      method: 'POST',
      url: `/admin/rutas/solicitudes/${solicitud.id}/cancelar`,
      headers: auth,
      payload: { motivo: 'el cliente recoge en tienda' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, yaEstaba: false });

    const fila = repos.rutas._solicitudes.find((s) => s.id === solicitud.id)!;
    expect(fila).toMatchObject({ estado: 'cancelado', proximoIntentoAt: null, phone: '51966100005' });
    const eventos = repos.rutas._eventos.filter((e) => e.solicitudId === solicitud.id);
    expect(eventos).toHaveLength(eventosAntes + 1);
    expect(eventos.at(-1)).toMatchObject({ tipo: 'nota', detalle: 'el cliente recoge en tienda' });
    // El contacto sigue ahi.
    expect(await repos.contacts.getByPhone('51966100005')).toBeTruthy();

    // El lote sigue en marcha, pero el motor no tiene nada que mandarle.
    expect((await repos.rutas.tocaIntentar(HORA_BUENA, 10)).map((s) => s.id)).not.toContain(solicitud.id);
    const { motor, enviados } = motorDePrueba();
    await motor.tick();
    await motor.tick();
    expect(enviados.filter((j) => j.phone === '51966100005')).toHaveLength(0);
    expect(repos.rutas._solicitudes.find((s) => s.id === solicitud.id)?.estado).toBe('cancelado');
  });

  it('el mismo motor si escribe a una que no se cancelo (el escenario sirve)', async () => {
    await clienteCargado('966100006', { arrancar: true });
    const { motor, enviados } = motorDePrueba();
    await motor.tick();
    expect(enviados.filter((j) => j.phone === '51966100006')).toHaveLength(1);
  });

  it('cancelar dos veces es idempotente y sin motivo usa el texto por defecto', async () => {
    const solicitud = await clienteCargado('966100007');
    const cancelar = () =>
      app.inject({ method: 'POST', url: `/admin/rutas/solicitudes/${solicitud.id}/cancelar`, headers: auth });

    const primera = await cancelar();
    expect(primera.json()).toEqual({ ok: true, yaEstaba: false });
    const eventos = repos.rutas._eventos.filter((e) => e.solicitudId === solicitud.id).length;
    expect(repos.rutas._eventos.filter((e) => e.solicitudId === solicitud.id).at(-1)?.detalle).toBe(
      'retirada manualmente de la automatización',
    );

    const segunda = await cancelar();
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json()).toEqual({ ok: true, yaEstaba: true });
    expect(repos.rutas._eventos.filter((e) => e.solicitudId === solicitud.id)).toHaveLength(eventos);

    expect((await app.inject({ method: 'POST', url: '/admin/rutas/solicitudes/x/cancelar', headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/admin/rutas/solicitudes/999999/cancelar', headers: auth })).statusCode).toBe(404);
  });

  it('reintentar sigue como antes: vuelve a la cola desde cero', async () => {
    const solicitud = await clienteCargado('966100008');
    await app.inject({ method: 'POST', url: `/admin/rutas/solicitudes/${solicitud.id}/derivar`, headers: auth, payload: {} });

    const res = await app.inject({ method: 'POST', url: `/admin/rutas/solicitudes/${solicitud.id}/reintentar`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().solicitud).toMatchObject({
      id: solicitud.id,
      estado: 'pendiente',
      intentos: 0,
      requiereHumano: false,
      incidencia: null,
      proximoIntentoAt: null,
    });
    expect(repos.rutas._eventos.filter((e) => e.solicitudId === solicitud.id).at(-1)?.detalle).toBe('devuelta a la cola por el operador');
    // Y no abre lotes nuevos.
    expect(repos.rutas._lotes.filter((l) => l.origen === 'reinicio_manual')).toHaveLength(0);
  });

  it('las dos acciones piden la misma llave que el resto del modulo', async () => {
    const sinLlave1 = await app.inject({ method: 'POST', url: '/admin/rutas/solicitudes/1/volver-a-empezar' });
    const sinLlave2 = await app.inject({ method: 'POST', url: '/admin/rutas/solicitudes/1/cancelar' });
    expect(sinLlave1.statusCode).toBe(401);
    expect(sinLlave2.statusCode).toBe(401);
  });
});
