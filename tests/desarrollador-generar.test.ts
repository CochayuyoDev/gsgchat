/**
 * Modulo desarrollador · «Clientes de prueba»: generar por la API, que nada
 * salga al WhatsApp, y borrar SOLO lo de prueba. Con la tienda entera de
 * produccion (armarTienda, base PGlite real) y un WhatsApp de mentira que
 * apunta todo lo que se le pide mandar.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { armarTienda, type TiendaViva } from '../src/plataforma/tienda.js';
import { bootstrapSecrets } from '../src/settings/crypto.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { NOMBRE_CLAVE_PRUEBA } from '../src/desarrollador/clave-prueba.js';
import { esNumeroDePrueba } from '../src/desarrollador/numeros.js';
import { clienteInventado, DISTRITOS } from '../src/desarrollador/datos-peru.js';
import { createFakeWhatsApp, type FakeWhatsApp } from './fakes.js';

describe('Módulo desarrollador: clientes de prueba', () => {
  let raiz: string;
  let tienda: TiendaViva;
  let wa: FakeWhatsApp;
  let cookie: string;

  const api = async (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = { cookie }) => {
    const r = await tienda.app.inject({ method, url, headers: { ...headers, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as Record<string, any>) : {} };
  };
  const db = () => tienda.pglite!.db;
  const cuenta = async (sql: string, params: unknown[] = []) => Number((await db().query<{ n: number | string }>(sql, params)).rows[0]?.n ?? 0);

  beforeAll(async () => {
    raiz = mkdtempSync(path.join(tmpdir(), 'dev-generar-'));
    const secretos = bootstrapSecrets(raiz);
    wa = createFakeWhatsApp();
    tienda = await armarTienda({
      id: 'dev',
      slug: 'dev',
      env: {
        PUBLIC_BASE_URL: 'https://chat.gsg.pe',
        DATABASE_URL: `pglite://${path.join(raiz, 'datos')}`,
        TRACKING_SECRET: secretos.trackingSecret,
        WHATSAPP_PROVIDER: 'local',
        BUSINESS_NAME: 'GSG',
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
      prefijoLog: '[dev] ',
      waParaPruebas: wa,
    });
    const alta = await tienda.app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'ali-2026-wa' } });
    cookie = String(alta.headers['set-cookie']).split(';')[0]!;
    // Horario de entregas abierto todo el dia: la prueba no puede depender de la hora.
    await api('POST', '/admin/entregas/ajustes', { horarioEntregas: { desde: '00:00', hasta: '23:59', extendidoHasta: '23:59' } });
  }, 180_000);

  afterAll(async () => {
    await tienda?.parar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('los datos inventados son de Lima y el monto va en soles', () => {
    const c = clienteInventado();
    expect(DISTRITOS.map((d) => d.nombre)).toContain(c.distrito);
    expect(c.lat).toBeGreaterThan(-12.3);
    expect(c.lat).toBeLessThan(-11.8);
    expect(c.notas).toMatch(/^Cobrar S\/ \d+\.\d{2}/);
  });

  it('una persona que no es administradora, o una clave de API, no puede usarlo', async () => {
    const op = await api('POST', '/admin/usuarios', { nombre: 'Operadora', usuario: 'opera', clave: 'opera-2026-wa', rol: 'operador' });
    expect(op.status).toBe(200);
    const login = await tienda.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'opera', clave: 'opera-2026-wa' } });
    const cookieOp = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await api('POST', '/admin/desarrollador/generar', { faltaConfirmar: 1 }, { cookie: cookieOp })).status).toBe(403);
    expect((await api('DELETE', '/admin/desarrollador/prueba', undefined, { cookie: cookieOp })).status).toBe(403);

    const clave = generarClaveApi();
    await tienda.repos.claves.crear({ nombre: 'Todo', prefijo: prefijoDeClave(clave), hash: hashClaveApi(clave), creadaPor: null, permisos: ['*'] });
    expect((await api('POST', '/admin/desarrollador/generar', { faltaConfirmar: 1 }, { authorization: `Bearer ${clave}` })).status).toBe(403);
  });

  it('el tope es de 500 clientes por tanda y los errores se dicen en palabras', async () => {
    const mucho = await api('POST', '/admin/desarrollador/generar', { faltaConfirmar: 300, faltaUbicacion: 201 });
    expect(mucho.status).toBe(400);
    expect(mucho.body.error).toContain('500');
    const uno = await api('POST', '/admin/desarrollador/generar', { faltaConfirmar: 501 });
    expect(uno.status).toBe(400);
    const nada = await api('POST', '/admin/desarrollador/generar', {});
    expect(nada.status).toBe(400);
    expect(nada.body.error).toContain('al menos uno');
  });

  it('20 contactados + 20 sin ubicación + 5 motorizados entran por la API con la clave de prueba', async () => {
    // Un cliente REAL al lado, que tiene que sobrevivir al borrado.
    const real = await tienda.app.inject({ method: 'POST', url: '/admin/dev/inbound', headers: { cookie, 'content-type': 'application/json' }, payload: JSON.stringify({ phone: '51987654321', name: 'Cliente real', text: 'hola' }) });
    expect([200, 404]).toContain(real.statusCode);
    await tienda.repos.contacts.upsertFromInbound('51987654321', 'Cliente real');
    await tienda.repos.entregas.crearMotorizado({ phone: '51911222333', nombre: 'Moto real' });

    const r = await api('POST', '/admin/desarrollador/generar', { faltaConfirmar: 20, faltaUbicacion: 20, motorizados: 5 });
    expect(r.status).toBe(200);
    expect(r.body.creados).toEqual({ faltaConfirmar: 20, faltaUbicacion: 20, motorizados: 5 });
    // Como la lista de GSG: nada sale hasta que se confirma el envío.
    expect(r.body.preguntados).toBe(0);
    expect(r.body.esperanEnvio).toBe(40);
    expect(r.body.detalle).toContain('Esperan que confirmes el envío: 40');
    expect(r.body.tecnico.peticion).toMatchObject({ metodo: 'POST', ruta: '/api/v1/entregas', pedidos: 40 });
    expect(r.body.tecnico.respuesta.status).toBe(201);
    // La clave no sale a la pantalla.
    expect(JSON.stringify(r.body)).not.toMatch(/wak_/);

    // Entraron por la API: la clave de prueba se uso y quedo revocada.
    const claves = (await tienda.repos.claves.listar()).filter((c) => c.nombre === NOMBRE_CLAVE_PRUEBA);
    expect(claves.length).toBe(1);
    expect(claves[0]!.ultimoUsoAt).toBeInstanceOf(Date);
    expect(claves[0]!.revocadaAt).toBeInstanceOf(Date);

    // Estados reales del sistema.
    const hoy = (await tienda.app.inject({ method: 'GET', url: '/admin/entregas', headers: { cookie } })).json() as { entregas: Array<{ referencia: string; phone: string; estado: string; confirmacionEstado: string; ubicacionEstado: string; notas: string | null }> };
    const deprueba = hoy.entregas.filter((e) => e.referencia.startsWith('PRUEBA-'));
    expect(deprueba.length).toBe(40);
    expect(deprueba.every((e) => esNumeroDePrueba(e.phone))).toBe(true);
    // Todos esperan que se confirme su envío: todavía no se le escribió a nadie.
    expect(await cuenta(`select count(*) as n from entregas where referencia like 'PRUEBA-%' and envio_retenido_at is not null`)).toBe(40);
    expect(await cuenta(`select count(*) as n from rutas_solicitudes where phone like '510000%'`)).toBe(0);
    // Los que ya traen pin son del grupo «falta confirmar»: solo SÍ/NO, nunca la ubicación.
    const confirmar = deprueba.filter((e) => e.ubicacionEstado === 'recibida');
    const ubicacion = deprueba.filter((e) => e.ubicacionEstado === 'pendiente');
    expect(confirmar.length).toBe(20);
    expect(ubicacion.length).toBe(20);
    expect(confirmar.every((e) => e.confirmacionEstado === 'pendiente')).toBe(true);
    expect(deprueba.every((e) => /Cobrar S\//.test(e.notas ?? ''))).toBe(true);

    // «📤 Confirmar el envío»: lo mismo que el botón de Números del día.
    const envio = await api('POST', '/admin/desarrollador/confirmar-envio', {});
    expect(envio.status).toBe(200);
    expect(envio.body).toMatchObject({ liberadas: 40, ubicacion: 20, confirmar: 20 });
    expect(await cuenta(`select count(*) as n from entregas where referencia like 'PRUEBA-%' and envio_retenido_at is not null`)).toBe(0);
    expect(await cuenta(`select count(*) as n from rutas_solicitudes where phone like '510000%'`)).toBe(20);
    const otra = await api('POST', '/admin/desarrollador/confirmar-envio', {});
    expect(otra.body.aviso).toContain('No hay ningún cliente de prueba esperando');

    const motos = (await tienda.app.inject({ method: 'GET', url: '/admin/motorizados', headers: { cookie } })).json() as { motorizados?: Array<{ phone: string }> } | Array<{ phone: string }>;
    const listaMotos = Array.isArray(motos) ? motos : (motos.motorizados ?? []);
    expect(listaMotos.filter((m) => m.phone.startsWith('510001')).length).toBe(5);
  }, 180_000);

  it('NADA pasó por el WhatsApp: el sender lo simuló y quedó en el hilo como enviado', async () => {
    // Un respiro para que el motor del reparto pida alguna ubicación.
    await new Promise((r) => setTimeout(r, 8000));
    expect(wa.sent.filter((m) => esNumeroDePrueba(String(m.to ?? ''))).length).toBe(0);
    const escritos = await cuenta(`select count(distinct c.id) as n from contacts c join messages m on m.contact_id = c.id and m.direction = 'out' where c.phone like '510000%'`);
    expect(escritos).toBeGreaterThanOrEqual(1);
    // A los de «falta confirmar» nunca se les pide la ubicación.
    expect(await cuenta(`select count(*) as n from rutas_solicitudes s join entregas e on e.phone = s.phone where e.referencia like 'PRUEBA-%' and e.ubicacion_estado = 'recibida' and e.ubicacion_fuente = 'a mano (GSG (API))'`)).toBe(0);
    const estado = await api('GET', '/admin/desarrollador/prueba');
    expect(estado.body).toMatchObject({ clientes: 40, motorizados: 5 });
  }, 60_000);

  it('una segunda tanda no pisa los números de la primera', async () => {
    const r = await api('POST', '/admin/desarrollador/generar', { faltaUbicacion: 3, motorizados: 1 });
    expect(r.body.creados).toEqual({ faltaConfirmar: 0, faltaUbicacion: 3, motorizados: 1 });
    expect((await api('GET', '/admin/desarrollador/prueba')).body).toMatchObject({ clientes: 43, motorizados: 6 });
  }, 120_000);

  it('«Borrar todo lo de prueba» deja todo limpio y lo real intacto', async () => {
    const r = await api('DELETE', '/admin/desarrollador/prueba');
    expect(r.status).toBe(200);
    expect(r.body.borrado.entregas).toBe(43);
    expect(r.body.borrado.motorizados).toBe(6);
    expect(r.body.detalle).toContain('Lo real no se tocó');

    expect(await cuenta(`select count(*) as n from entregas where phone like '51900%' or referencia like 'PRUEBA-%'`)).toBe(0);
    expect(await cuenta(`select count(*) as n from contacts where phone like '51900%'`)).toBe(0);
    expect(await cuenta(`select count(*) as n from motorizados where phone like '51900%'`)).toBe(0);
    expect(await cuenta(`select count(*) as n from rutas_solicitudes where phone like '51900%'`)).toBe(0);
    expect(await cuenta(`select count(*) as n from rutas_reportes where payload->>'referencia' like 'PRUEBA-%'`)).toBe(0);
    expect(await cuenta(`select count(*) as n from messages m join contacts c on c.id = m.contact_id where c.phone like '51900%'`)).toBe(0);
    expect(await cuenta(`select count(*) as n from envio_automatico where phone like '51900%'`)).toBe(0);
    // Lo real, en su sitio.
    expect(await tienda.repos.contacts.getByPhone('51987654321')).toBeTruthy();
    expect(await cuenta(`select count(*) as n from motorizados where phone = '51911222333'`)).toBe(1);
    expect(await cuenta(`select count(*) as n from usuarios`)).toBe(2);

    const otra = await api('DELETE', '/admin/desarrollador/prueba');
    expect(otra.body.detalle).toContain('No había nada de prueba');
  }, 120_000);

  it('la pestaña se pinta dentro del módulo, sin jerga y con su botón de borrar', async () => {
    const r = await tienda.app.inject({ method: 'GET', url: '/desarrollador', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Falta que confirme');
    expect(r.body).toContain('Confirmar el envío de los de prueba');
    expect(r.body).toContain('Falta que mande su ubicación');
    expect(r.body).toContain('Borrar todo lo de prueba');
    expect(r.body).toContain('Ver lo técnico');
    expect(r.body).not.toContain('${');
  });
});
