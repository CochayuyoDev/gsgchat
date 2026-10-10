/**
 * El único flujo que pide el dueño (29/09), contra la API de GSG de mentira
 * (scripts/gsg-falso.ts) conectada como «API real»: servidor aparte, con su
 * token, por la red.
 *
 *  1. GSG manda la lista (GSGchat nunca se la pide): los que falta pedirles
 *     la ubicación y los que falta confirmar. Cada uno se identifica por su
 *     WhatsApp + su código de tracking.
 *  2. Primer mensaje: pedir la ubicación, o preguntar SÍ/NO para confirmar.
 *  3. Llega la ubicación: gracias, con el aviso de que un cambio tiene que
 *     ser antes de la 1:00 PM para tenerlo en cuenta el mismo día.
 *  4. El cliente pide cambiarla antes de la 1:00 PM: se le pide la nueva y,
 *     al mandarla, «se ha registrado».
 *  5. Después de la 1:00 PM: que coordine con el motorizado; el pin nuevo no
 *     se registra.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, type EscenarioEntregas } from './escenario-entregas.js';
import { crearGsgFalso, type GsgFalso } from '../scripts/gsg-falso.js';

/** Las 09:00 de Lima del último día que ya empezó. */
function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

const ANA = '987400001'; // falta ubicación
const BETO = '987400002'; // falta ubicación
const CARLA = '987500001'; // falta confirmar
const MOTO = '999888777';
const PIN_NUEVO = { lat: PIN_LIMA.lat + 0.003, lng: PIN_LIMA.lng + 0.003 };
const PIN_TARDE = { lat: PIN_LIMA.lat - 0.003, lng: PIN_LIMA.lng - 0.003 };
const AVISO_1PM = /Si por algún motivo deseas cambiar tu ubicación, avísanos antes de la 1:00 PM para tenerla en cuenta el mismo día\./;

describe('GSG por la API: pedir o confirmar la ubicación, gracias y cambio hasta la 1:00 PM', () => {
  let e: EscenarioEntregas;
  let gsg: GsgFalso;
  const nuevos = async (tel: string, accion: () => Promise<unknown>): Promise<string[]> => {
    const a = e.textosA(tel).length;
    await accion();
    await e.trabajar();
    return e.textosA(tel).slice(a);
  };
  const aGsg = (ruta: string) => gsg.llamadas.filter((c) => c.metodo === 'POST' && c.ruta === ruta).map((c) => c.cuerpo as Record<string, unknown>);

  beforeAll(async () => {
    gsg = await crearGsgFalso({
      token: 'token-de-gsg',
      lista: {
        faltaUbicacion: [
          { tracking: 'GSG-A-1001', telefono: ANA, nombre: 'Ana Quispe', direccion: 'Av. Larco 1', distrito: 'Miraflores', telefonoMotorizado: MOTO },
          { tracking: 'GSG-A-1002', telefono: BETO, nombre: 'Beto Salas' },
        ],
        faltaConfirmacion: [{ tracking: 'GSG-A-2001', telefono: CARLA, nombre: 'Carla Rojas', direccion: 'Av. Arequipa 2450', distrito: 'Lince' }],
      },
    });
    e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true, confirmarLista: true });
    await e.entregas.guardarAjustes({ soporte: { whatsapp: '987654321', llamadas: '' } });
    await e.api.post('/admin/motorizados/de-prueba');
    // Lo que hace «Conectar» en la pantalla (POST /admin/entregas/gsg) tras comprobar que es admin.
    const estado = await e.conexionGsg.conectarReal({ url: gsg.url, token: gsg.token });
    expect(estado).toMatchObject({ conectada: true, modo: 'real' });
  });
  afterAll(async () => {
    await e?.cerrar();
    await gsg?.cerrar();
  });

  it('1. GSG manda la lista (sin que se le pida) y cada cliente queda identificado por WhatsApp + tracking', async () => {
    const s = await e.entregas.recibirListaGsg(gsg.lista as never);
    expect(s).toMatchObject({ ok: true, nuevas: 3 });
    // A la API de GSG no se le hizo ninguna lectura.
    expect(gsg.llamadas.filter((c) => c.metodo === 'GET')).toEqual([]);
    expect(await e.entrega('GSG-A-1001')).toMatchObject({ phone: `51${ANA}`, ubicacionEstado: 'pendiente' });
    expect(await e.entrega('GSG-A-1002')).toMatchObject({ phone: `51${BETO}`, ubicacionEstado: 'pendiente' });
    expect(await e.entrega('GSG-A-2001')).toMatchObject({ phone: `51${CARLA}`, confirmacionEstado: 'pendiente' });
    // Otra vez la misma lista: no duplica.
    expect((await e.entregas.recibirListaGsg(gsg.lista as never)).nuevas).toBe(0);
  });

  it('2. primer mensaje: a los de «falta ubicación» se les pide el pin; a los de «falta confirmar», SÍ/NO', async () => {
    await e.api.post('/admin/entregas/confirmar-envio', { todos: true });
    await e.trabajar();
    for (const t of [ANA, BETO]) expect(e.mensajesA(t).some((m) => m.kind === 'location_request'), t).toBe(true);
    expect(e.mensajesA(CARLA).some((m) => m.kind === 'location_request')).toBe(false);
    expect(e.botonesA(CARLA)[0]?.buttons.map((b) => b.title)).toEqual(['Sí, recibo hoy', 'No']);
  });

  it('3. manda su ubicación: gracias, con el aviso de la 1:00 PM, y GSG la recibe con WhatsApp + tracking', async () => {
    const r = await nuevos(ANA, () => e.contesta(ANA, { pin: PIN_LIMA }));
    const gracias = r.find((t) => t.includes('Ubicación registrada correctamente'));
    expect(gracias, r.join('\n---\n')).toBeTruthy();
    expect(gracias).toMatch(AVISO_1PM);
    await e.despacharAGsg();
    expect(aGsg('/ubicaciones').find((c) => c.referencia === 'GSG-A-1001')).toMatchObject({ referencia: 'GSG-A-1001', telefono: `51${ANA}`, lat: PIN_LIMA.lat, lng: PIN_LIMA.lng });
  });

  it('4. antes de la 1:00 PM pide cambiarla: se le pide la nueva y, al mandarla, «se ha registrado»', async () => {
    expect(await nuevos(ANA, () => e.contesta(ANA, { texto: 'me equivoqué de ubicación' }))).toEqual(['Claro, Ana, por favor mándeme su nueva ubicación por WhatsApp (el botón de ubicación) para registrarla.']);
    const r = await nuevos(ANA, () => e.contesta(ANA, { pin: PIN_NUEVO }));
    expect(r.some((t) => /Tu nueva ubicación se ha registrado correctamente/.test(t)), r.join('\n---\n')).toBe(true);
    expect((await e.entrega('GSG-A-1001'))?.lat).toBeCloseTo(PIN_NUEVO.lat, 5);
    await e.despacharAGsg();
    expect(aGsg('/ubicaciones').filter((c) => c.referencia === 'GSG-A-1001').at(-1)).toMatchObject({ lat: PIN_NUEVO.lat, lng: PIN_NUEVO.lng });
  });

  it('5. después de la 1:00 PM: que coordine con el motorizado y el pin nuevo NO se registra', async () => {
    e.avanzar(5 * 60); // ~14:0x en Lima
    const r = await nuevos(ANA, () => e.contesta(ANA, { texto: 'quiero cambiar mi ubicación' }));
    expect(r.at(-1)).toMatch(/después de la 1:00 PM, por favor comunícate directamente con el motorizado.*999 ?888 ?777/);
    const r2 = await nuevos(ANA, () => e.contesta(ANA, { pin: PIN_TARDE }));
    expect(r2.at(-1)).toMatch(/comunícate directamente con el motorizado/);
    expect((await e.entrega('GSG-A-1001'))?.lat).toBeCloseTo(PIN_NUEVO.lat, 5);
  });
});
