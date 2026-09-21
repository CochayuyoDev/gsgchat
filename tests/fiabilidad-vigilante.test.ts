/**
 * El vigilante del WhatsApp: con el reloj en la mano, una caída avisa UNA
 * vez por correo a los minutos del ajuste, la vuelta se cuenta con su
 * duración, la sesión parada por el teléfono no se reintenta, y "avisar"
 * elige el canal que quede.
 */

import { describe, expect, it } from 'vitest';
import { crearCorreo, URL_BREVO, explicarFalloBrevo } from '../src/salud/correo.js';
import { crearVigilante, CLAVE_ULTIMA_CAIDA } from '../src/salud/vigilante.js';
import { crearAlmacenFiabilidad, crearFiabilidad, diaEn, horaEn, minutosDelDia } from '../src/salud/fiabilidad.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemorySettingsRepo, TEST_SETTINGS_KEY } from './fakes.js';

function fetchFalso(status = 201) {
  const llamadas: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const fn = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : (entrada as { url: string }).url;
    llamadas.push({ url, body: JSON.parse(String(init?.body ?? '{}')), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return new Response(JSON.stringify(status >= 400 ? { message: 'Key not found', code: 'unauthorized' } : { messageId: '<1@brevo>' }), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fn, llamadas };
}

async function montar(opciones: { correo?: string; clave?: string; minutos?: number; proveedor?: 'local' | 'cloud' | null; status?: number } = {}) {
  const settingsRepo = createMemorySettingsRepo();
  const almacen = await crearAlmacenFiabilidad({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY });
  await almacen.guardar({ vigilante: { correoAviso: opciones.correo ?? 'dueno@gsg.pe', minutosAntesDeAvisar: opciones.minutos ?? 3 }, claveBrevo: opciones.clave === undefined ? 'xkeysib-prueba' : opciones.clave || null });
  const brevo = fetchFalso(opciones.status);
  const correo = crearCorreo({ fetchImpl: brevo.fn, clave: () => almacen.claveBrevo(), ajustes: () => almacen.ajustes().vigilante });
  let ahora = new Date('2026-09-21T13:00:00Z'); // 08:00 Lima
  const estado = { conectado: true as boolean | undefined, local: null as { status: string; detail: string } | null, proveedor: (opciones.proveedor === undefined ? 'local' : opciones.proveedor) as 'local' | 'cloud' | null };
  const reconexiones: Date[] = [];
  const whatsapps: string[] = [];
  const vigilante = crearVigilante({
    conectado: () => estado.conectado,
    proveedor: () => estado.proveedor,
    estadoLocal: () => estado.local,
    reconectar: async () => {
      reconexiones.push(ahora);
    },
    avisarWhatsApp: async (texto) => {
      whatsapps.push(texto);
      return { ok: true };
    },
    ajustes: () => almacen.ajustes().vigilante,
    correo,
    settingsRepo,
    ahora: () => ahora,
    log: () => undefined,
    timezone: 'America/Lima',
    permitirSimulacion: true,
  });
  const avanzar = (min: number) => {
    ahora = new Date(ahora.getTime() + min * 60_000);
  };
  return { vigilante, estado, brevo, reconexiones, whatsapps, avanzar, ahora: () => ahora, settingsRepo, correo, almacen };
}

describe('el reloj del negocio', () => {
  it('día y hora en Lima', () => {
    const d = new Date('2026-09-21T04:30:00Z'); // 23:30 del 20 en Lima
    expect(diaEn(d, 'America/Lima')).toBe('2026-09-20');
    expect(horaEn(d, 'America/Lima')).toBe('23:30');
    expect(minutosDelDia(d, 'America/Lima')).toBe(23 * 60 + 30);
    expect(horaEn(new Date('2026-09-21T05:00:00Z'), 'America/Lima')).toBe('00:00');
  });
});

describe('el correo de aviso (Brevo)', () => {
  it('sin clave o sin correo dice qué falta; con los dos manda por la API de Brevo', async () => {
    const settingsRepo = createMemorySettingsRepo();
    const almacen = await crearAlmacenFiabilidad({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY });
    const brevo = fetchFalso();
    const correo = crearCorreo({ fetchImpl: brevo.fn, clave: () => almacen.claveBrevo(), ajustes: () => almacen.ajustes().vigilante });
    expect(correo.configurado().ok).toBe(false);
    expect(correo.configurado().falta).toContain('clave de Brevo');
    await almacen.guardar({ claveBrevo: 'xkeysib-abc' });
    expect(correo.configurado().falta).toContain('correo que recibe');
    await almacen.guardar({ vigilante: { correoAviso: 'dueno@gsg.pe', nombreRemitente: 'GSGchat de prueba' } });
    const r = await correo.probar();
    expect(r.ok).toBe(true);
    expect(brevo.llamadas).toHaveLength(1);
    expect(brevo.llamadas[0]!.url).toBe(URL_BREVO);
    expect(brevo.llamadas[0]!.headers['api-key']).toBe('xkeysib-abc');
    expect(brevo.llamadas[0]!.body).toMatchObject({ to: [{ email: 'dueno@gsg.pe' }], sender: { email: 'dueno@gsg.pe', name: 'GSGchat de prueba' } });
    // La clave se guarda cifrada y la pantalla solo sabe que existe.
    const fila = (await settingsRepo.getAll()).find((r) => r.key === 'fiabilidad.brevo');
    expect(fila?.encrypted).toBe(true);
    expect(fila?.value).not.toContain('xkeysib');
    expect(almacen.tieneClaveBrevo()).toBe(true);
    await almacen.guardar({ claveBrevo: null });
    expect(almacen.tieneClaveBrevo()).toBe(false);
  });

  it('una clave mala se explica sin jerga', async () => {
    const m = await montar({ status: 401 });
    const r = await m.correo.probar();
    expect(r.ok).toBe(false);
    expect(r.detalle).toContain('rechazó la clave');
    expect(explicarFalloBrevo(400, 'sender not valid')).toContain('remitente');
    expect(explicarFalloBrevo(402, '')).toContain('cupo');
  });

  it('un correo que no tiene pinta de correo no se guarda', async () => {
    const m = await montar();
    await expect(m.almacen.guardar({ vigilante: { correoAviso: 'esto no es un correo' } })).rejects.toThrow();
    expect(m.almacen.ajustes().vigilante.correoAviso).toBe('dueno@gsg.pe');
  });
});

describe('el vigilante del WhatsApp', () => {
  it('conectado: lo dice con la hora; una caída avisa UNA vez por correo a los 3 minutos y no otra a los 4', async () => {
    const m = await montar();
    await m.vigilante.tick();
    expect(m.vigilante.estado().conectado).toBe(true);
    expect(m.vigilante.estado().frase).toContain('Conectado desde las 08:00');

    m.estado.conectado = false;
    m.estado.local = { status: 'FAILED', detail: 'Se corto la conexion.' };
    await m.vigilante.tick();
    expect(m.vigilante.estado().conectado).toBe(false);
    expect(m.vigilante.estado().caidoDesde).toBe(m.ahora().toISOString());
    expect(m.brevo.llamadas).toHaveLength(0);
    m.avanzar(1);
    await m.vigilante.tick();
    expect(m.brevo.llamadas).toHaveLength(0);
    expect(m.vigilante.estado().frase).toContain('se avisará por correo a los 3 min');
    m.avanzar(2);
    await m.vigilante.tick();
    expect(m.brevo.llamadas).toHaveLength(1);
    expect(m.brevo.llamadas[0]!.body.subject).toContain('caído desde las 08:00');
    expect(String(m.brevo.llamadas[0]!.body.textContent)).toContain('Conexión (/setup)');
    expect(m.vigilante.estado().aviso?.por).toBe('correo');
    m.avanzar(1);
    await m.vigilante.tick();
    expect(m.brevo.llamadas).toHaveLength(1);
    expect(m.vigilante.estado().frase).toContain('se avisó por correo a las 08:03');
  });

  it('en "fallo" pide la conexión pasados dos minutos, como mucho cinco veces por hora', async () => {
    const m = await montar({ minutos: 60 });
    await m.vigilante.tick();
    m.estado.conectado = false;
    m.estado.local = { status: 'FAILED', detail: 'Se corto la conexion.' };
    await m.vigilante.tick();
    m.avanzar(1);
    await m.vigilante.tick();
    expect(m.reconexiones).toHaveLength(0);
    m.avanzar(1);
    await m.vigilante.tick();
    expect(m.reconexiones).toHaveLength(1);
    // Cada dos minutos, hasta cinco en la hora.
    for (let i = 0; i < 20; i++) {
      m.avanzar(2);
      await m.vigilante.tick();
    }
    expect(m.reconexiones).toHaveLength(5);
    expect(m.vigilante.estado().reintentos).toBe(5);
    expect(m.vigilante.estado().frase).toContain('se pidió la conexión 5 veces');
  });

  it('cuando vuelve: apunta la última caída, avisa por WhatsApp y por correo con la duración', async () => {
    const m = await montar();
    await m.vigilante.tick();
    m.estado.conectado = false;
    m.estado.local = { status: 'FAILED', detail: 'x' };
    await m.vigilante.tick();
    m.avanzar(3);
    await m.vigilante.tick();
    expect(m.brevo.llamadas).toHaveLength(1);
    m.avanzar(16);
    m.estado.conectado = true;
    m.estado.local = { status: 'WORKING', detail: '' };
    await m.vigilante.tick();
    const e = m.vigilante.estado();
    expect(e.conectado).toBe(true);
    expect(e.caidoDesde).toBeNull();
    expect(e.ultimaCaida?.minutos).toBe(19);
    expect(e.ultimaCaida?.avisadoPor).toBe('correo');
    expect(m.whatsapps).toHaveLength(1);
    expect(m.whatsapps[0]).toContain('WhatsApp volvió a las 08:19 (estuvo caído 19 min)');
    expect(m.brevo.llamadas).toHaveLength(2);
    expect(m.brevo.llamadas[1]!.body.subject).toContain('volvió');
    expect(e.frase).toContain('la última caída fue hace un momento y duró 19 min');
    const guardada = (await m.settingsRepo.getAll()).find((r) => r.key === CLAVE_ULTIMA_CAIDA);
    expect(guardada).toBeTruthy();
  });

  it('una caída corta (vuelve antes del aviso) no manda nada y no avisa la vuelta', async () => {
    const m = await montar();
    await m.vigilante.tick();
    m.estado.conectado = false;
    m.estado.local = { status: 'FAILED', detail: 'x' };
    await m.vigilante.tick();
    m.avanzar(1);
    m.estado.conectado = true;
    await m.vigilante.tick();
    expect(m.brevo.llamadas).toHaveLength(0);
    expect(m.whatsapps).toHaveLength(0);
    expect(m.vigilante.estado().ultimaCaida?.minutos).toBe(1);
  });

  it('parada por el teléfono (401): dice que hay que escanear el QR y no reintenta; con 403, que el número no vale', async () => {
    const m = await montar();
    await m.vigilante.tick();
    m.estado.conectado = false;
    m.estado.local = { status: 'STOPPED', detail: 'El telefono cerro la sesion (401): hay que vincular otra vez.' };
    for (let i = 0; i < 4; i++) {
      m.avanzar(1);
      await m.vigilante.tick();
    }
    const e = m.vigilante.estado();
    expect(e.necesitaQr).toBe(true);
    expect(m.reconexiones).toHaveLength(0);
    expect(e.frase).toContain('escanear el qr');
    expect(m.brevo.llamadas).toHaveLength(1);
    expect(String(m.brevo.llamadas[0]!.body.textContent)).toContain('escanear el QR');

    const m2 = await montar();
    await m2.vigilante.tick();
    m2.estado.conectado = false;
    m2.estado.local = { status: 'STOPPED', detail: 'WhatsApp no quiere este numero (403): prohibido.' };
    m2.avanzar(3);
    await m2.vigilante.tick();
    expect(m2.vigilante.estado().frase).toContain('no quiere este número');
  });

  it('sin correo configurado el aviso no sale y la pantalla dice qué falta', async () => {
    const m = await montar({ clave: '' });
    await m.vigilante.tick();
    m.estado.conectado = false;
    m.estado.local = { status: 'FAILED', detail: 'x' };
    await m.vigilante.tick();
    m.avanzar(3);
    await m.vigilante.tick();
    const e = m.vigilante.estado();
    expect(e.aviso?.por).toBe('nadie');
    expect(e.aviso?.detalle).toContain('clave de Brevo');
    expect(e.correo.listo).toBe(false);
    expect(e.frase).toContain('no se pudo avisar por correo');
  });

  it('con la API de Meta no hay sesión que vigilar; sin configurar, tampoco; sin haberse conectado nunca no es una caída', async () => {
    const meta = await montar({ proveedor: 'cloud' });
    meta.estado.conectado = false;
    await meta.vigilante.tick();
    expect(meta.vigilante.estado().seguimiento).toBe('meta');
    expect(meta.vigilante.estado().conectado).toBeNull();
    expect(meta.brevo.llamadas).toHaveLength(0);

    const nada = await montar({ proveedor: null });
    await nada.vigilante.tick();
    expect(nada.vigilante.estado().seguimiento).toBe('sin_configurar');
    expect(nada.vigilante.estado().frase).toContain('conéctalo en Conexión');

    const nuevo = await montar();
    nuevo.estado.conectado = false;
    nuevo.estado.local = { status: 'SCAN_QR_CODE', detail: '' };
    nuevo.avanzar(10);
    await nuevo.vigilante.tick();
    expect(nuevo.vigilante.estado().seguimiento).toBe('sin_conectar');
    expect(nuevo.brevo.llamadas).toHaveLength(0);
  });

  it('avisar(): por WhatsApp si funciona, por correo si está caído', async () => {
    const m = await montar();
    await m.vigilante.tick();
    let r = await m.vigilante.avisar('todo bien');
    expect(r.por).toBe('whatsapp');
    expect(m.whatsapps).toEqual(['todo bien']);
    m.estado.conectado = false;
    m.estado.local = { status: 'FAILED', detail: 'x' };
    await m.vigilante.tick();
    r = await m.vigilante.avisar('algo falló');
    expect(r.por).toBe('correo');
    expect(m.brevo.llamadas).toHaveLength(1);
    expect(m.brevo.llamadas[0]!.body.textContent).toBe('algo falló');
  });

  it('simular una caída solo cuando se permite, y el tick la ve como real', async () => {
    const m = await montar();
    await m.vigilante.tick();
    m.vigilante.simular(true);
    await m.vigilante.tick();
    expect(m.vigilante.estado().conectado).toBe(false);
    expect(m.vigilante.estado().simulando).toBe(true);
    m.vigilante.simular(null);
    await m.vigilante.tick();
    expect(m.vigilante.estado().conectado).toBe(true);
  });
});

describe('el servicio entero', () => {
  it('crearFiabilidad junta las cuatro piezas y arrancar() devuelve el paro', async () => {
    const settingsRepo = createMemorySettingsRepo();
    const salud = { snapshot: async () => ({ ritmo: { cupoHoy: 100, hoy: 10 } }) } as never;
    const carpeta = mkdtempSync(join(tmpdir(), 'gsgchat-copias-prueba-'));
    const f = await crearFiabilidad({
      settingsRepo,
      settingsKeyBase64: TEST_SETTINGS_KEY,
      salud,
      timezone: 'America/Lima',
      demo: true,
      vigilante: { conectado: () => true, proveedor: () => 'local', avisarWhatsApp: async () => ({ ok: true }) },
      humo: { sender: { send: async () => ({ ok: true, wamid: 'w', deliveryId: 1 }) }, supervisor: () => '', deliveries: { listRecent: async () => [] }, carpetas: () => [] },
      cupo: {},
      respaldo: { baseDatos: () => ({ tipo: 'memoria' }), archiveDir: 'no-existe', carpetaPorDefecto: carpeta },
    });
    const e = await f.estado();
    expect(e.vigilante.seguimiento).toBe('desconocido');
    expect(e.cupo.puedenSalir).toBe(90);
    expect(e.copia.base.tipo).toBe('memoria');
    expect(e.demo).toBe(true);
    const parar = f.arrancar();
    await f.vigilante.tick();
    expect(f.vigilante.estado().conectado).toBe(true);
    parar();
    rmSync(carpeta, { recursive: true, force: true });
  });
});
