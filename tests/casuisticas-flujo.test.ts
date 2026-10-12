/**
 * Casuisticas del flujo antes del PR: entradas raras, repeticiones,
 * llamadas a la vez y estados limite en /api/v1/entregas, «Volver a solicitar
 * ubicación», el catalogo de errores y los reprogramados. Cada caso dice que
 * deberia pasar; si falla, es un fallo del sistema, no de la prueba.
 */

import { describe, expect, it } from 'vitest';
import { OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import { ajustesPorDefecto } from '../src/rutas/ajustes.js';
import { crearEscenarioEntregas, PAUSA_SEGUNDOS, PIN_LIMA, type EscenarioEntregas } from './escenario-entregas.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { connectPage } from '../src/web/connect-page.js';

const ESPERA_MIN = 30;
const GSG = { empresa: { codigo: 'T01', nombre: 'Tienda Prueba' }, metodoPago: 'Contraentrega', montoCobrar: 40 };

function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

async function armar(opciones: { confirmarLista?: boolean } = {}): Promise<EscenarioEntregas> {
  const e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true, geocodificador: null, ...opciones });
  await e.entregas.guardarAjustes({ soporte: { whatsapp: '987654321', llamadas: '' }, ...(opciones.confirmarLista ? { confirmarListaGsg: true } : {}) });
  const base = ajustesPorDefecto({ ...OPCIONES_POR_DEFECTO, pausaMinSegundos: PAUSA_SEGUNDOS, pausaMaxSegundos: PAUSA_SEGUNDOS, horaInicio: 0, horaFin: 24 });
  await e.repos.rutas.ajustes.set({ esperaRespuestaMinutos: ESPERA_MIN, maxIntentos: 3 }, base);
  return e;
}

async function trabajar(e: EscenarioEntregas, vueltas = 3) {
  for (let i = 0; i < vueltas; i++) {
    await e.trabajar();
    e.avanzar(1);
  }
}

async function desdeGsg(e: EscenarioEntregas, tracking: string, telefono: string) {
  const r = await e.api.post<any>('/api/v1/entregas', { ...GSG, tracking, cliente: 'Cliente Casuistica', telefono });
  expect(r.status, `${tracking}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
  await trabajar(e, 2);
  return r;
}

const flujo = (e: EscenarioEntregas, cuerpo: unknown, headers?: Record<string, string>) =>
  e.app.inject({ method: 'POST', url: '/api/v1/entregas', headers: { 'x-api-key': (e as any).claveApi ?? CLAVE, 'content-type': 'application/json', ...(headers ?? {}) }, payload: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) });

// La clave «de todo» del escenario (la misma que usa e.api).
let CLAVE = '';
async function conClave(e: EscenarioEntregas, permisos: string[]): Promise<string> {
  const clave = generarClaveApi();
  await e.repos.claves.crear({ nombre: 'Casuistica', hash: hashClaveApi(clave), prefijo: prefijoDeClave(clave), creadaPor: null, permisos });
  return clave;
}

async function preparar(e: EscenarioEntregas) {
  CLAVE = await conClave(e, ['*']);
}

describe('POST /api/v1/entregas: entradas raras', () => {
  it('tracking numerico, accion en minusculas con espacios y tracking en otra caja: todo encuentra el mismo pedido', async () => {
    const e = await armar();
    try {
      await preparar(e);
      await desdeGsg(e, '20281', '987740001');
      const numerico = await flujo(e, { tracking: 20281, accion: '  reintentar ' });
      expect(numerico.statusCode, numerico.body).toBe(200);
      await desdeGsg(e, 'Ped-Caja', '987740002');
      const caja = await flujo(e, { tracking: 'ped-caja', accion: 'Cancelar' });
      expect(caja.statusCode, caja.body).toBe(200);
      expect(caja.json().entrega.estado).toBe('cancelada');
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('cuerpos malos: JSON roto, sin tracking, tracking en blanco o larguisimo, accion desconocida → 400 con su campo', async () => {
    const e = await armar();
    try {
      await preparar(e);
      const roto = await flujo(e, '{"tracking": "X"');
      expect(roto.statusCode).toBe(400);
      expect(roto.json()).toMatchObject({ ok: false, codigo: 'JSON_INVALIDO' });
      for (const [cuerpo, campo] of [[{ accion: 'CANCELAR' }, 'tracking'], [{ tracking: '   ', accion: 'CANCELAR' }, 'tracking'], [{ tracking: 'x'.repeat(121), accion: 'CANCELAR' }, 'tracking'], [{ tracking: 'X', accion: 'BORRAR' }, 'accion'], [{ tracking: 'X', accion: 5 }, 'accion']] as const) {
        const r = await flujo(e, cuerpo);
        expect(r.statusCode, JSON.stringify(cuerpo)).toBe(400);
        expect(r.json()).toMatchObject({ ok: false, codigo: 'VALIDACION' });
        expect(r.json().detalles.some((d: any) => d.campo === campo), `${JSON.stringify(cuerpo)} → ${r.body}`).toBe(true);
      }
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('sin clave 401, clave de solo lectura 403, con texto plano 415 o 400 (nunca 500)', async () => {
    const e = await armar();
    try {
      await preparar(e);
      const sin = await e.app.inject({ method: 'POST', url: '/api/v1/entregas', headers: { 'content-type': 'application/json' }, payload: '{}' });
      expect(sin.statusCode).toBe(401);
      expect(sin.json().ok).toBe(false);
      const leer = await conClave(e, ['entregas:leer']);
      const r403 = await flujo(e, { tracking: 'X', accion: 'CANCELAR' }, { 'x-api-key': leer });
      expect(r403.statusCode).toBe(403);
      expect(r403.json()).toMatchObject({ ok: false, codigo: 'SIN_PERMISO' });
      const texto = await e.app.inject({ method: 'POST', url: '/api/v1/entregas', headers: { 'x-api-key': CLAVE, 'content-type': 'text/plain' }, payload: 'CANCELAR X' });
      expect([400, 415]).toContain(texto.statusCode);
      expect(texto.json().ok).toBe(false);
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('telefono corregido que no vale (12): 400, y el pedido queda como estaba', async () => {
    const e = await armar();
    try {
      await preparar(e);
      await desdeGsg(e, 'PED-T1', '987740003');
      const r = await flujo(e, { tracking: 'PED-T1', accion: 'REINTENTAR', telefono: '12' });
      expect(r.statusCode).toBe(400);
      expect(r.json().detalles[0].campo).toBe('telefono');
      const sigue = await e.api.get<any>('/api/v1/entregas/PED-T1');
      expect(sigue.body.entrega.telefono ?? sigue.body.entrega.phone).toContain('987740003');
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('el mismo telefono como «corregido»: no cambia nada y reinicia la solicitud de ese pedido', async () => {
    const e = await armar();
    try {
      await preparar(e);
      const tel = '987740004';
      await desdeGsg(e, 'PED-T2', tel);
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const antes = e.mensajesA(tel).length;
      const r = await flujo(e, { tracking: 'PED-T2', accion: 'REINTENTAR', telefono: tel });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().telefonoCorregido).toBeUndefined();
      await trabajar(e);
      expect(e.mensajesA(tel).length - antes).toBe(1);
    } finally {
      await e.cerrar();
    }
  }, 90_000);
});

describe('POST /api/v1/entregas: a la vez y en orden raro', () => {
  it('cinco REINTENTAR a la vez: el cliente recibe UNA sola solicitud', async () => {
    const e = await armar();
    try {
      await preparar(e);
      const tel = '987740010';
      await desdeGsg(e, 'PED-C1', tel);
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const antes = e.mensajesA(tel).length;
      const rs = await Promise.all(Array.from({ length: 5 }, () => flujo(e, { tracking: 'PED-C1', accion: 'REINTENTAR' })));
      for (const r of rs) expect(r.statusCode, r.body).toBe(200);
      expect(rs.filter((r) => !r.json().sinCambios).length, 'solo uno reinicia').toBe(1);
      await trabajar(e);
      expect(e.mensajesA(tel).length - antes).toBe(1);
      const sols = (await e.repos.rutas.listarSolicitudes({ q: tel, limit: 20, offset: 0 })).filter((s) => ['pendiente', 'enviado', 'respondio'].includes(s.estado));
      expect(sols.length, 'una sola solicitud viva').toBe(1);
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('tres CANCELAR a la vez: se cancela una vez, los otros dicen sinCambios', async () => {
    const e = await armar();
    try {
      await preparar(e);
      await desdeGsg(e, 'PED-C2', '987740011');
      const rs = await Promise.all(Array.from({ length: 3 }, () => flujo(e, { tracking: 'PED-C2', accion: 'CANCELAR' })));
      for (const r of rs) expect(r.statusCode, r.body).toBe(200);
      expect(rs.filter((r) => !r.json().sinCambios).length).toBe(1);
      const ev = await e.api.get<any>('/api/v1/entregas/PED-C2');
      expect(ev.body.eventos.filter((x: any) => /cancel/i.test(x.detalle)).length).toBeGreaterThanOrEqual(1);
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('REINTENTAR y despues el pin: la ubicacion queda en ESE pedido y sale hacia GSG', async () => {
    const e = await armar();
    try {
      await preparar(e);
      const tel = '987740012';
      await desdeGsg(e, 'PED-C3', tel);
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      expect((await flujo(e, { tracking: 'PED-C3', accion: 'REINTENTAR' })).statusCode).toBe(200);
      await trabajar(e);
      await e.contesta(tel, { pin: { lat: -12.09, lng: -77.04 } });
      await e.trabajar();
      const r = await e.api.get<any>('/api/v1/entregas/PED-C3');
      expect(r.body.entrega.ubicacionEstado ?? r.body.entrega.ubicacion?.estado).toBe('recibida');
      expect(JSON.stringify(r.body.entrega)).toContain('-12.09');
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('con «Confirmar y enviar» encendido: REINTENTAR de un pedido retenido es 409 ESPERA_CONFIRMACION', async () => {
    const e = await armar({ confirmarLista: true });
    try {
      await preparar(e);
      await desdeGsg(e, 'PED-C4', '987740013');
      const r = await flujo(e, { tracking: 'PED-C4', accion: 'REINTENTAR' });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().codigo).toBe('ESPERA_CONFIRMACION');
      // Cancelar si se puede: todavia no se le escribio.
      expect((await flujo(e, { tracking: 'PED-C4', accion: 'CANCELAR' })).statusCode).toBe(200);
    } finally {
      await e.cerrar();
    }
  }, 90_000);
});

describe('«Volver a solicitar ubicación» desde el panel: ids raros', () => {
  it('id que no es numero o es 0: 400; pedido cancelado: 409', async () => {
    const e = await armar();
    try {
      await preparar(e);
      for (const id of ['abc', '0', '-3', '1.5']) {
        const r = await e.api.post<any>(`/admin/entregas/${id}/volver-a-pedir-ubicacion`);
        expect(r.status, id).toBe(400);
        expect(r.body.codigo).toBe('VALIDACION');
      }
      await desdeGsg(e, 'PED-P1', '987740020');
      const id = (await e.api.get<any>('/api/v1/entregas/PED-P1')).body.entrega.id;
      await flujo(e, { tracking: 'PED-P1', accion: 'CANCELAR' });
      const r = await e.api.post<any>(`/admin/entregas/${id}/volver-a-pedir-ubicacion`);
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ ok: false, codigo: 'CONFLICTO' });
    } finally {
      await e.cerrar();
    }
  }, 90_000);
});

describe('catalogo de errores: consultas raras', () => {
  it('status que no es numero lista todo; status sin codigos da lista vacia; POST es 405 con Allow', async () => {
    const e = await armar();
    try {
      const todos = (await e.app.inject({ method: 'GET', url: '/api/v1/errores' })).json().errores.length;
      expect((await e.app.inject({ method: 'GET', url: '/api/v1/errores?status=abc' })).json().errores.length).toBe(todos);
      expect((await e.app.inject({ method: 'GET', url: '/api/v1/errores?status=999' })).json().errores).toEqual([]);
      const post = await e.app.inject({ method: 'POST', url: '/api/v1/errores', headers: { 'content-type': 'application/json' }, payload: '{}' });
      expect(post.statusCode).toBe(405);
      expect(post.headers.allow).toContain('GET');
      const raro = await e.app.inject({ method: 'GET', url: '/api/v1/errores/%3Cscript%3E' });
      expect(raro.statusCode).toBe(404);
      expect(raro.body).not.toContain('<script>');
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('una pantalla que no existe pedida sin HTML (curl) sigue siendo JSON', async () => {
    const e = await armar();
    try {
      const r = await e.app.inject({ method: 'GET', url: '/no-hay-nada', headers: { accept: '*/*' } });
      expect(r.statusCode).toBe(404);
      expect(() => r.json()).not.toThrow();
    } finally {
      await e.cerrar();
    }
  }, 90_000);
});

describe('reprogramados: casos limite', () => {
  it('reprogramado dos veces: se marca con el dia mas reciente, y el reenvio del mismo dia no duplica', async () => {
    const e = await armar();
    try {
      await preparar(e);
      const tel = '987740030';
      await desdeGsg(e, 'PED-R1', tel);
      e.avanzar(24 * 60);
      await e.trabajar();
      await desdeGsg(e, 'PED-R1', tel);
      const segundo = (await e.api.get<any>('/admin/entregas')).body.entregas.find((x: any) => x.referencia === 'PED-R1');
      e.avanzar(24 * 60);
      await e.trabajar();
      await desdeGsg(e, 'PED-R1', tel);
      const hoy = (await e.api.get<any>('/admin/entregas')).body.entregas.find((x: any) => x.referencia === 'PED-R1');
      expect(hoy.reprogramado.dia).toBe(segundo.dia);
      const antes = e.mensajesA(tel).length;
      const otra = await e.api.post<any>('/api/v1/entregas', { ...GSG, tracking: 'PED-R1', cliente: 'Cliente Casuistica', telefono: tel });
      expect(otra.status).toBe(200);
      await trabajar(e);
      expect(e.mensajesA(tel).length).toBe(antes);
    } finally {
      await e.cerrar();
    }
  }, 120_000);

  it('el reprogramado con el tracking en otra caja (ped-r2 / PED-R2) tambien se reconoce', async () => {
    const e = await armar();
    try {
      await preparar(e);
      await desdeGsg(e, 'ped-r2', '987740031');
      e.avanzar(24 * 60);
      await e.trabajar();
      await desdeGsg(e, 'PED-R2', '987740031');
      const hoy = (await e.api.get<any>('/admin/entregas')).body.entregas.find((x: any) => x.referencia === 'PED-R2');
      expect(hoy.reprogramado, JSON.stringify(hoy)).toBeTruthy();
    } finally {
      await e.cerrar();
    }
  }, 120_000);
});

describe('Conexión → endpoints de GSGchat para GSG', () => {
  it('simular dice lo que haria sin cambiar el pedido ni escribirle al cliente', async () => {
    const e = await armar();
    try {
      await preparar(e);
      const tel = '987740040';
      await desdeGsg(e, 'PED-S1', tel);
      const antes = e.mensajesA(tel).length;
      for (const accion of ['CANCELAR', 'REINTENTAR']) {
        const r = await flujo(e, { tracking: 'PED-S1', accion, simular: true });
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json()).toMatchObject({ ok: true, simulado: true, accion });
        expect(r.json().detalle).toMatch(/^Se (cancelaría|reiniciaría)/);
      }
      const tel2 = await flujo(e, { tracking: 'PED-S1', accion: 'REINTENTAR', telefono: '987740041', simular: true });
      expect(tel2.json().detalle).toContain('51987740041');
      const malo = await flujo(e, { tracking: 'PED-S1', accion: 'REINTENTAR', telefono: '12', simular: true });
      expect(malo.statusCode).toBe(400);
      await trabajar(e);
      expect(e.mensajesA(tel).length).toBe(antes);
      const sigue = await e.api.get<any>('/api/v1/entregas/PED-S1');
      expect(sigue.body.entrega.estado).not.toBe('cancelada');
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('la bitácora de GSG anota las llamadas a /api/v1/entregas con lo que se contestó', async () => {
    const e = await armar();
    try {
      await preparar(e);
      await desdeGsg(e, 'PED-S2', '987740042');
      await flujo(e, { tracking: 'PED-S2', accion: 'CANCELAR', simular: true });
      await flujo(e, { tracking: 'NO-HAY', accion: 'CANCELAR' });
      const r = await e.api.get<any>('/admin/gsg');
      const deFlujo = (r.body.bitacora as any[]).filter((l) => String(l.que).includes('/api/v1/entregas'));
      expect(deFlujo.some((l) => l.status === 200 && /Se cancelaría/.test(l.resultado))).toBe(true);
      expect(deFlujo.some((l) => l.status === 404 && /NO-HAY/.test(l.resultado))).toBe(true);
      // La prueba desde Conexión (con la sesión) tambien queda, por su ruta del panel.
      await e.api.post<any>('/admin/entregas/flujo', { tracking: 'PED-S2', accion: 'REINTENTAR', simular: true });
      const tras = await e.api.get<any>('/admin/gsg');
      expect((tras.body.bitacora as any[]).some((l) => String(l.que).includes('/admin/entregas/flujo') && /Se reiniciaría/.test(l.resultado))).toBe(true);
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('la página de Conexión trae los tres endpoints, el probador y un script que el navegador puede ejecutar', async () => {
    const html = connectPage({ labels: {} as never, nombreNegocio: 'Prueba', demo: false, conGsg: true });
    for (const id of ['ep-entregas', 'ep-flujo-form', 'ep-llamadas', 'seguimiento-cuando']) expect(html, id).toContain(`id="${id}"`);
    // Un solo endpoint: ni /flujo ni el catalogo como direcciones aparte.
    for (const id of ['ep-flujo"', 'ep-errores']) expect(html).not.toContain(`id="${id}`);
    expect(html).not.toContain('/api/v1/flujo');
    for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      if (!m[1]!.trim()) continue;
      expect(() => new Function(m[1]!), 'el script de la página no compila').not.toThrow();
    }
  });
});
