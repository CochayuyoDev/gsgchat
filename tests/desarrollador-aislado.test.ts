/**
 * Lo del Modulo desarrollador no toca nada del numero real:
 *
 *  1. no cuenta en el cupo, ni en el ritmo, ni en la salud del numero, y va
 *     tan rapido como el motor permite (sin la pausa entre mensajes);
 *  2. no se le pregunta a WhatsApp si un numero de prueba tiene cuenta;
 *  3. no se le avisa de nada al supervisor real (incidencias, cierre, reparto);
 *     y el «fin del dia» de prueba cierra solo lo de prueba;
 *  4. una tienda recien creada no hace su copia de seguridad al nacer.
 *
 * Todo lo de produccion (armarTienda con su base MySQL de prueba y sus motores) salvo
 * el WhatsApp, que es uno falso que apunta lo que se le pide.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { armarTienda, type TiendaViva } from '../src/plataforma/tienda.js';
import { bootstrapSecrets } from '../src/settings/crypto.js';
import { numeroDePrueba } from '../src/desarrollador/numeros.js';
import { cerrarDiaDePrueba } from '../src/desarrollador/reloj.js';
import { createFakeWhatsApp, type FakeWhatsApp } from './fakes.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { OBLIGATORIOS_GSG } from './escenario-entregas.js';

/** Con un disco lento (cada commit de MySQL tarda) se alargan todas las esperas: GSG_PRUEBAS_LENTO=4. */
const LENTO = Number(process.env.GSG_PRUEBAS_LENTO) || 1;

const SUPERVISOR = '51999888777';

const esperar = async (cond: () => boolean | Promise<boolean>, ms: number, que: string): Promise<void> => {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no se cumplio a tiempo: ${que}`);
};

describe('lo de prueba no toca el numero real', () => {
  let raiz: string;
  let tienda: TiendaViva;
  let b: BaseDePrueba;
  let wa: FakeWhatsApp & { preguntados: string[] };
  let cookie: string;
  const copias = () => path.join(raiz, 'copias');

  const api = async (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const r = await tienda.app.inject({ method, url, headers: { cookie, ...headers, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as Record<string, any>) : {} };
  };
  const escribe = (phone: string, text: string) => api('POST', '/admin/dev/inbound', { phone, name: 'Cliente', text });
  const alSupervisor = () => wa.sent.filter((m) => m.to === SUPERVISOR);
  const db = () => tienda.repos.desarrollador!;

  // La base aparte: la primera vez hay que crear sus tablas y tarda (usa el
  // hookTimeout largo de vitest.config, no el de armar la tienda).
  beforeAll(async () => {
    b = await baseDePrueba();
  });

  beforeAll(async () => {
    raiz = mkdtempSync(path.join(tmpdir(), 'aislado-'));
    const secretos = bootstrapSecrets(raiz);
    const base = createFakeWhatsApp();
    const preguntados: string[] = [];
    // Un WhatsApp que dice que NADIE tiene cuenta: si se le preguntara por un
    // numero de prueba, ese numero quedaria como «sin WhatsApp».
    wa = Object.assign(base, { preguntados, tieneWhatsApp: async (phone: string) => { preguntados.push(phone); return false; } });
    tienda = await armarTienda({
      id: 'aislado',
      slug: 'aislado',
      env: {
        PUBLIC_BASE_URL: 'http://localhost:0',
        DATABASE_URL: b.url,
        TRACKING_SECRET: secretos.trackingSecret,
        WHATSAPP_PROVIDER: 'local',
        DEV_SIMULATE_INBOUND: 'true',
        RAFAGA_MS: '0',
        TIMEZONE: 'America/Lima',
        RUTAS_HORA_INICIO: '0',
        RUTAS_HORA_FIN: '24',
        HORARIO_ENVIO_INICIO: '0',
        HORARIO_ENVIO_FIN: '24',
      } as NodeJS.ProcessEnv,
      secretos,
      base: { url: b.url, base: b.base },
      authDir: path.join(raiz, 'auth'),
      mediaDir: path.join(raiz, 'medios'),
      carpetaCopias: copias(),
      primeraCuentaRol: 'superadmin',
      autoConectarLocal: false,
      sembrarPlantillasLocales: true,
      prefijoLog: '[aislado] ',
      waParaPruebas: wa,
    });
    const alta = await tienda.app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'ali-2026-wa' } });
    cookie = String(alta.headers['set-cookie']).split(';')[0]!;
    // Horario abierto todo el dia, pero la pausa entre mensajes la de siempre (15-30 s).
    expect((await api('POST', '/admin/rutas/ajustes', { horaInicio: 0, horaFin: 24 })).status).toBe(200);
    expect((await api('POST', '/admin/ajustes', { avisos: { supervisor: SUPERVISOR } })).status).toBe(200);
  }, 180_000 * LENTO);

  afterAll(async () => {
    await tienda?.parar();
    await b?.cerrar();
    if (raiz) rmSync(raiz, { recursive: true, force: true });
  });

  it('4. una tienda recién creada no hace su copia de seguridad al nacer', async () => {
    // Un par de pasadas del reloj de la copia (cada minuto) no pueden haber copiado nada.
    const nada = !existsSync(copias()) || readdirSync(copias()).length === 0;
    expect(nada).toBe(true);
  });

  it('1+2. cinco clientes de prueba reciben su pedido de ubicación sin esperar la pausa, sin preguntar a WhatsApp y sin gastar el cupo real', async () => {
    const telefonos = [1, 2, 3, 4, 5].map((n) => numeroDePrueba('cliente', n));
    const r = await api('POST', '/admin/rutas/lotes', { nombre: 'Lote de prueba', arrancar: true, filas: telefonos.map((t, i) => ({ telefono: t, nombre: `Prueba ${i + 1}`, referencia: `PRUEBA-A${i + 1}` })) });
    expect(r.status).toBe(200);
    const t0 = Date.now();
    // Con la pausa real (15-30 s entre mensajes) cinco tardarian mas de un minuto.
    await esperar(async () => (await db().query<{ n: number }>("select count(*) as n from rutas_solicitudes where phone like '510000%' and intentos > 0")).rows[0]!.n === 5, 45_000 * LENTO, 'los cinco pedidos de ubicación de prueba');
    expect(Date.now() - t0).toBeLessThan(45_000);
    // No se le pregunto a WhatsApp por ninguno, y ninguno quedo como «sin WhatsApp».
    expect(wa.preguntados.filter((p) => p.startsWith('510000'))).toEqual([]);
    const incidencias = await db().query<{ n: number }>("select count(*) as n from rutas_solicitudes where phone like '510000%' and incidencia = 'sin_whatsapp'");
    expect(incidencias.rows[0]!.n).toBe(0);
    // Nada salio por el WhatsApp (el sender los simula) y nada cuenta en el cupo ni en la salud.
    expect(wa.sent.filter((m) => String(m.to ?? '').startsWith('510000'))).toEqual([]);
    const envios = await db().query<{ n: number }>("select count(*) as n from deliveries d join contacts c on c.id = d.contact_id where c.phone like '510000%'");
    expect(envios.rows[0]!.n).toBe(0);
    expect(await tienda.repos.deliveries.contarIniciadosDesde(new Date(Date.now() - 3600_000))).toBe(0);
    // Pero en el hilo del chat si quedaron, como enviados.
    const hilos = await db().query<{ n: number }>("select count(*) as n from messages m join contacts c on c.id = m.contact_id where c.phone like '510000%' and m.direction = 'out'");
    expect(hilos.rows[0]!.n).toBeGreaterThanOrEqual(5);
  }, 120_000 * LENTO);

  it('una BAJA o un «no soy yo» de prueba no cuentan como riesgo del número real', async () => {
    const desde = new Date(Date.now() - 3600_000);
    await escribe(numeroDePrueba('cliente', 1), 'BAJA');
    await escribe(numeroDePrueba('cliente', 2), 'no soy yo, número equivocado');
    expect(await tienda.repos.contacts.contarBajasDesde(desde)).toBe(0);
    expect(await tienda.repos.messages.contarEntrantesDesde(desde)).toBe(0);
    const quejas = await db().query<{ n: number }>("select count(*) as n from salud_eventos where tipo = 'respuesta_negativa'").catch(() => ({ rows: [{ n: 0 }] }));
    expect(quejas.rows[0]!.n).toBe(0);
  });

  it('3. el «fin del día» de prueba cierra solo lo de prueba, sin avisar al supervisor real', async () => {
    const clave = await api('POST', '/admin/claves-api', { nombre: 'prueba aislado', permisos: ['entregas:leer', 'entregas:gestionar'] });
    expect(clave.status).toBe(200);
    const token = String(clave.body.clave ?? clave.body.token ?? '');
    expect(token.startsWith('wak_')).toBe(true);
    const alta = await tienda.app.inject({
      method: 'POST',
      url: '/api/v1/entregas',
      headers: { 'x-api-key': token, 'content-type': 'application/json' },
      payload: JSON.stringify({
        pedidos: [
          { ...OBLIGATORIOS_GSG, referencia: 'PRUEBA-C1', telefono: numeroDePrueba('cliente', 11), nombre: 'Prueba Cierre', faltaUbicacion: true, faltaConfirmar: true },
          { ...OBLIGATORIOS_GSG, referencia: 'REAL-1', telefono: '987654321', nombre: 'Cliente Real', faltaUbicacion: true, faltaConfirmar: true },
        ],
      }),
    });
    expect(alta.statusCode).toBeLessThan(300);
    const antes = alSupervisor().length;

    // Por el servicio de entregas de la tienda, como lo llama el modulo.
    const r = await cerrarDiaDePrueba(db(), tienda.entregas);
    expect(r.movidos).toBe(1);
    expect(r.sinTerminar).toContain('PRUEBA-C1');
    expect(r.sinTerminar).not.toContain('REAL-1');

    const filas = await db().query<{ referencia: string; estado: string; dia: string }>("select referencia, estado, cast(dia as char) as dia from entregas where referencia in ('PRUEBA-C1','REAL-1') order by referencia");
    const real = filas.rows.find((f) => f.referencia === 'REAL-1')!;
    const prueba = filas.rows.find((f) => f.referencia === 'PRUEBA-C1')!;
    expect(prueba.estado).toBe('incidencia');
    expect(real.estado).not.toBe('incidencia');
    // Nadie le escribio al supervisor por lo de prueba.
    expect(alSupervisor().length).toBe(antes);
  });

  it('3. nada de lo de prueba de toda la pasada le llegó al supervisor real', () => {
    const deLoDePrueba = alSupervisor().filter((m) => /PRUEBA-|51900[01]/.test(String(m.body ?? '')));
    expect(deLoDePrueba).toEqual([]);
  });
});

