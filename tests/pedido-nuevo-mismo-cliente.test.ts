/**
 * El flujo de ubicacion es del PEDIDO, no del telefono (pedido del dueño, 12/10).
 * GSG empuja por POST /api/v1/entregas:
 *  - mismo telefono con otro tracking (otro dia o el mismo) = pedido nuevo con su propio flujo;
 *  - el mismo tracking reenviado = el mismo pedido: no se le escribe otra vez;
 *  - un pedido no toca a los otros del mismo cliente;
 *  - «Volver a solicitar ubicación» reinicia solo ese pedido y reenvia la plantilla una vez.
 */

import { describe, expect, it } from 'vitest';
import { OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import { ajustesPorDefecto } from '../src/rutas/ajustes.js';
import { runInNewContext } from 'node:vm';
import { crearEscenarioEntregas, PAUSA_SEGUNDOS, PIN_LIMA, type EscenarioEntregas } from './escenario-entregas.js';
import { pedidosPage } from '../src/web/pedidos-page.js';

const ESPERA_MIN = 30;
const GSG = { empresa: { codigo: 'T01', nombre: 'Tienda Prueba' }, metodoPago: 'Contraentrega', montoCobrar: 40 };

function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

async function armar(): Promise<EscenarioEntregas> {
  const e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true, geocodificador: null });
  await e.entregas.guardarAjustes({ soporte: { whatsapp: '987654321', llamadas: '' } });
  const base = ajustesPorDefecto({ ...OPCIONES_POR_DEFECTO, pausaMinSegundos: PAUSA_SEGUNDOS, pausaMaxSegundos: PAUSA_SEGUNDOS, horaInicio: 0, horaFin: 24 });
  await e.repos.rutas.ajustes.set({ esperaRespuestaMinutos: ESPERA_MIN, maxIntentos: 3 }, base);
  return e;
}

async function desdeGsg(e: EscenarioEntregas, tracking: string, telefono: string) {
  const r = await e.api.post<any>('/api/v1/entregas', { ...GSG, tracking, cliente: 'Cliente Recurrente', telefono });
  expect(r.status, `${tracking}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
  for (let i = 0; i < 2; i++) {
    await e.trabajar();
    e.avanzar(1);
  }
  return r;
}

describe('el mismo cliente puede volver a pedir', () => {
  it('lunes PED-100, martes PED-205: el martes se le vuelve a escribir; PED-205 reenviado no duplica', async () => {
    const e = await armar();
    try {
      const tel = '987730001';
      await desdeGsg(e, 'PED-100', tel);
      const lunes = e.mensajesA(tel).length;
      expect(lunes, 'el lunes sale el primer mensaje').toBeGreaterThan(0);
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();

      e.avanzar(24 * 60);
      const antesMartes = e.mensajesA(tel).length;
      const r = await desdeGsg(e, 'PED-205', tel);
      expect(r.status).toBe(201);
      const martes = e.mensajesA(tel).length;
      expect(martes, 'el martes, pedido nuevo: se le escribe otra vez').toBeGreaterThan(antesMartes);

      const repetido = await desdeGsg(e, 'PED-205', tel);
      expect(repetido.body.repetidas).toContain('PED-205');
      expect(e.mensajesA(tel).length, 'PED-205 reenviado: ningun mensaje nuevo').toBe(martes);
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('el dia siguiente, aunque ayer no contesto, el pedido nuevo arranca su propio flujo', async () => {
    const e = await armar();
    try {
      const tel = '987730002';
      await desdeGsg(e, 'PED-300', tel);
      e.avanzar(24 * 60);
      const antes = e.mensajesA(tel).length;
      await desdeGsg(e, 'PED-301', tel);
      expect(e.mensajesA(tel).length).toBeGreaterThan(antes);
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('cancelar un pedido no toca el otro del mismo cliente', async () => {
    const e = await armar();
    try {
      const tel = '987730003';
      await desdeGsg(e, 'PED-400', tel);
      e.avanzar(24 * 60);
      await desdeGsg(e, 'PED-401', tel);
      const borrar = await e.api.delete<any>('/api/v1/entregas/PED-400');
      expect(borrar.status).toBeLessThan(500);
      const sigue = await e.api.get<any>('/api/v1/entregas/PED-401');
      expect(sigue.status).toBe(200);
      expect(JSON.stringify(sigue.body)).not.toMatch(/cancelad/);
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  const pedidoDe = async (e: EscenarioEntregas, tel: string, ref: string) => (await e.repos.entregas.listar({ q: tel, limit: 50 })).find((x) => x.referencia === ref)!;
  const pidenUbicacion = (e: EscenarioEntregas, tel: string, desde: number) => e.mensajesA(tel).slice(desde).filter((m) => String(m.kind) === 'location_request' || /ubicaci/i.test(String(m.body ?? '')));

  it('«Volver a solicitar ubicación» reinicia solo ese pedido, apunta quien y no se duplica con un doble clic', async () => {
    const e = await armar();
    try {
      const tel = '987730004';
      await desdeGsg(e, 'PED-500', tel);
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const idLunes = (await pedidoDe(e, tel, 'PED-500')).id;
      e.avanzar(24 * 60);
      await desdeGsg(e, 'PED-501', tel);
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const martes = await pedidoDe(e, tel, 'PED-501');
      expect(martes.ubicacionEstado).toBe('recibida');

      // Como estaba el del lunes justo antes del reinicio del martes.
      const lunes = (await e.repos.entregas.entrega(idLunes))!;
      const antes = e.mensajesA(tel).length;
      const url = `/admin/entregas/${martes.id}/volver-a-pedir-ubicacion`;
      const r = await e.api.post<any>(url);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const doble = await e.api.post<any>(url);
      expect(doble.status).toBe(409);
      expect(doble.body).toMatchObject({ ok: false, codigo: 'MENSAJE_EN_CURSO' });

      for (let i = 0; i < 3; i++) {
        await e.trabajar();
        e.avanzar(1);
      }
      expect(pidenUbicacion(e, tel, antes).length, 'sale la solicitud otra vez, una sola').toBe(1);

      const reiniciado = (await e.repos.entregas.entrega(martes.id))!;
      expect(reiniciado.ubicacionEstado).toBe('pendiente');
      expect(reiniciado.lat).toBeNull();
      const actividad = (await e.repos.entregas.eventos(reiniciado.id)).map((x) => x.detalle).join(' | ');
      expect(actividad).toMatch(/volvió a solicitar la ubicación/);

      // El del lunes no se toca.
      const lunesDespues = (await e.repos.entregas.entrega(idLunes))!;
      expect(lunesDespues).toMatchObject({ ubicacionEstado: lunes.ubicacionEstado, lat: lunes.lat, lng: lunes.lng, estado: lunes.estado });

      const falta = await e.api.post<any>('/admin/entregas/999999/volver-a-pedir-ubicacion');
      expect(falta.status).toBe(404);
      expect(falta.body).toMatchObject({ ok: false, codigo: 'NO_EXISTE' });
    } finally {
      await e.cerrar();
    }
  }, 90_000);
});

describe('POST /api/v1/entregas: GSG le dice a GSGchat que cancele o reintente', () => {
  const flujo = (e: EscenarioEntregas, cuerpo: Record<string, unknown>) => e.api.post<any>('/api/v1/flujo', cuerpo);

  it('CANCELAR: el pedido se cancela y la repeticion no cambia nada', async () => {
    const e = await armar();
    try {
      const tel = '987730010';
      await desdeGsg(e, 'PED-700', tel);
      const r = await flujo(e, { tracking: 'PED-700', accion: 'cancelar', motivo: 'el cliente anuló' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ ok: true, accion: 'CANCELAR' });
      expect(r.body.entrega.estado).toBe('cancelada');
      const otra = await flujo(e, { tracking: 'PED-700', accion: 'CANCELAR' });
      expect(otra.status).toBe(200);
      expect(otra.body.sinCambios).toBe(true);
      const tras = await flujo(e, { tracking: 'PED-700', accion: 'REINTENTAR' });
      expect(tras.status).toBe(409);
      expect(tras.body.codigo).toBe('CONFLICTO');
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('REINTENTAR sin telefono: reinicia ese pedido y la repeticion no duplica', async () => {
    const e = await armar();
    try {
      const tel = '987730011';
      await desdeGsg(e, 'PED-710', tel);
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const antes = e.mensajesA(tel).length;
      const r = await flujo(e, { tracking: 'PED-710', accion: 'REINTENTAR', motivo: 'datos corregidos' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.sinCambios).toBeUndefined();
      const repetida = await flujo(e, { tracking: 'PED-710', accion: 'REINTENTAR' });
      expect(repetida.status).toBe(200);
      expect(repetida.body.sinCambios).toBe(true);
      for (let i = 0; i < 3; i++) {
        await e.trabajar();
        e.avanzar(1);
      }
      expect(e.mensajesA(tel).length - antes, 'una sola solicitud nueva').toBe(1);
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('REINTENTAR con telefono corregido: se le escribe al numero nuevo', async () => {
    const e = await armar();
    try {
      await desdeGsg(e, 'PED-720', '987730012');
      const r = await flujo(e, { tracking: 'PED-720', accion: 'REINTENTAR', telefono: '987730013' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.telefonoCorregido).toBe('51987730013');
      for (let i = 0; i < 3; i++) {
        await e.trabajar();
        e.avanzar(1);
      }
      expect(e.mensajesA('987730013').length).toBeGreaterThan(0);
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('400 si falta el tracking o la accion no vale; 404 si el tracking no existe', async () => {
    const e = await armar();
    try {
      const sinTracking = await flujo(e, { accion: 'CANCELAR' });
      expect(sinTracking.status).toBe(400);
      expect(sinTracking.body).toMatchObject({ ok: false, codigo: 'VALIDACION' });
      const malaAccion = await flujo(e, { tracking: 'X', accion: 'BORRAR' });
      expect(malaAccion.status).toBe(400);
      expect(malaAccion.body.detalles.some((d: any) => d.campo === 'accion')).toBe(true);
      const falta = await flujo(e, { tracking: 'NO-EXISTE', accion: 'CANCELAR' });
      expect(falta.status).toBe(404);
      expect(falta.body).toMatchObject({ ok: false, codigo: 'NO_EXISTE' });
      // El de ayer se cerró con el día: se dice que entre como pedido nuevo.
      await desdeGsg(e, 'PED-730', '987730014');
      e.avanzar(24 * 60);
      await e.trabajar();
      const ayer = await flujo(e, { tracking: 'PED-730', accion: 'REINTENTAR' });
      expect(ayer.status).toBe(404);
      expect(ayer.body.error).toContain('POST /api/v1/entregas');
    } finally {
      await e.cerrar();
    }
  }, 90_000);
});

describe('reprogramado: el mismo tracking otro dia', () => {
  it('Pedidos GSG lo marca con el dia y lo de antes, y se le vuelve a pedir la ubicacion', async () => {
    const e = await armar();
    try {
      const tel = '987730020';
      await desdeGsg(e, 'PED-800', tel);
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      e.avanzar(24 * 60);
      await e.trabajar();
      const antes = e.mensajesA(tel).length;
      await desdeGsg(e, 'PED-800', tel);
      await desdeGsg(e, 'PED-801', '987730021');
      expect(e.mensajesA(tel).length, 'reprogramado: se le vuelve a escribir').toBeGreaterThan(antes);

      const r = await e.api.get<any>('/admin/entregas');
      const fila = r.body.entregas.find((x: any) => x.referencia === 'PED-800');
      expect(fila.ubicacionEstado, 'la ubicacion de ayer no se reutiliza').toBe('pendiente');
      expect(fila.reprogramado).toMatchObject({ lat: -12.1211, lng: -77.0301 });
      expect(fila.reprogramado.dia < fila.dia).toBe(true);
      expect(r.body.entregas.find((x: any) => x.referencia === 'PED-801').reprogramado).toBeNull();

      // Lo que pinta la tarjeta, con la funcion tal cual sale en la pagina.
      const html = pedidosPage({ disponible: true, demo: false, nombreNegocio: 'Prueba' });
      const marca = /function marcaReprogramado\(e\) \{[\s\S]*?\n\}/.exec(html)![0];
      const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      const pinta = runInNewContext(`${marca};marcaReprogramado`, { esc, encodeURIComponent }) as (f: unknown) => string;
      const tarjeta = pinta(fila);
      expect(tarjeta).toContain('Reprogramado del ' + fila.reprogramado.dia.split('-').reverse().join('/'));
      expect(tarjeta).toContain('ubicación de ese día');
      expect(tarjeta).toContain('No se reutiliza');
      expect(pinta({ reprogramado: null })).toBe('');
    } finally {
      await e.cerrar();
    }
  }, 90_000);
});
