/**
 * Refinado de las entregas: un mismo cliente con dos pedidos el mismo día
 * (un pin para los dos, una pregunta a la vez, un solo viaje del motorizado,
 * un solo aviso, un solo "entregado"), y lo demás que llegó con el refinado.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, conPais, type EscenarioEntregas } from './escenario-entregas.js';

const SUPERVISOR = '51912426667';
const DORA = '987111111';
const pinDe = (i: number) => ({ lat: PIN_LIMA.lat + i * 0.001, lng: PIN_LIMA.lng - i * 0.001 });

/** El reloj arranca a las 09:00 de Lima del último día que ya empezó (ver entregas.test.ts). */
function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

describe('un cliente con dos pedidos el mismo día', () => {
  let e: EscenarioEntregas;
  let rider: { id: number; phone: string; nombre: string };

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ supervisor: SUPERVISOR, arranque: hoyALas9() });
    await e.api.post('/admin/motorizados/de-prueba');
    e.simulador.cargar([
      { referencia: 'D-1', telefono: DORA, nombre: 'Dora Díaz', direccion: 'Av. Brasil 1200', distrito: 'Jesús María', faltaUbicacion: true, faltaConfirmacion: true },
      { referencia: 'D-2', telefono: DORA, nombre: 'Dora Díaz', direccion: 'Av. Brasil 1200', distrito: 'Jesús María', faltaUbicacion: true, faltaConfirmacion: true },
    ]);
    const s = await e.api.post<{ nuevas: number }>('/admin/entregas/sincronizar');
    expect(s.body.nuevas).toBe(2);
    await e.trabajar();
  });
  afterAll(() => e.cerrar());

  it('su pin vale para los dos pedidos y se le pregunta por uno solo, nombrándolo', async () => {
    const antes = e.textosA(conPais(DORA)).length;
    await e.contesta(DORA, { pin: pinDe(21) });
    const d1 = await e.entrega('D-1');
    const d2 = await e.entrega('D-2');
    expect(d1?.ubicacionEstado).toBe('recibida');
    expect(d2?.ubicacionEstado).toBe('recibida');
    expect(d1?.confirmacionEstado).toBe('pedida');
    expect(d2?.confirmacionEstado).toBe('pendiente');
    const textos = e.textosA(conPais(DORA));
    expect(textos.length).toBe(antes + 1);
    const ultimo = textos[textos.length - 1]!;
    expect(ultimo).toContain('D-1 y D-2');
    expect(ultimo).toMatch(/recibir D-1 hoy/);
    // Los botones son los de D-1.
    const botones = e.botonesA(conPais(DORA));
    expect(botones[botones.length - 1]?.buttons[0]?.id).toBe(`entrega:si:${d1!.id}`);
    // Hoy lo enseña agrupado.
    expect(d1?.mismoCliente).toEqual(['D-2']);
    expect(d2?.mismoCliente).toEqual(['D-1']);
  });

  it('el motor no le hace la segunda pregunta mientras no conteste la primera', async () => {
    const antes = e.textosA(conPais(DORA)).length;
    await e.trabajar();
    expect(e.textosA(conPais(DORA)).length).toBe(antes);
    expect((await e.entrega('D-2'))?.confirmacionEstado).toBe('pendiente');
  });

  it('un "sí" confirma el que se preguntó y, en el mismo mensaje, pregunta por el otro con sus botones', async () => {
    await e.contesta(DORA, { texto: 'si' });
    const d1 = await e.entrega('D-1');
    const d2 = await e.entrega('D-2');
    expect(d1?.confirmacionEstado).toBe('confirmada');
    expect(d2?.confirmacionEstado).toBe('pedida');
    const textos = e.textosA(conPais(DORA));
    const ultimo = textos[textos.length - 1]!;
    expect(ultimo).toMatch(/D-1 queda confirmado/);
    expect(ultimo).toMatch(/Y D-2, ¿también lo recibe hoy\?/);
    const botones = e.botonesA(conPais(DORA));
    expect(botones[botones.length - 1]?.buttons[0]?.id).toBe(`entrega:si:${d2!.id}`);
  });

  it('el botón del segundo pedido confirma ese pedido y los dos quedan listos', async () => {
    const d2 = await e.entrega('D-2');
    await e.contesta(DORA, { boton: { id: `entrega:si:${d2!.id}`, title: 'Sí, recibo hoy' } });
    expect((await e.entrega('D-2'))?.confirmacionEstado).toBe('confirmada');
    expect((await e.entrega('D-2'))?.confirmacionComo).toBe('boton');
    expect((await e.entrega('D-1'))?.estado).toBe('lista');
    expect((await e.entrega('D-2'))?.estado).toBe('lista');
  });

  it('los dos van al mismo motorizado en un solo mensaje y con un solo pin', async () => {
    await e.trabajar();
    const d1 = await e.entrega('D-1');
    const d2 = await e.entrega('D-2');
    expect(d1?.estado).toBe('esperando_motorizado');
    expect(d2?.estado).toBe('esperando_motorizado');
    expect(d1?.motorizado?.id).toBe(d2?.motorizado?.id);
    rider = { id: d1!.motorizado!.id, phone: d1!.motorizado!.phone, nombre: d1!.motorizado!.nombre };
    const alMotorizado = e.textosA(rider.phone);
    expect(alMotorizado).toHaveLength(1);
    expect(alMotorizado[0]).toContain('D-1 y D-2');
    expect(alMotorizado[0]).toContain('2 pedidos del mismo cliente');
    // Un solo pin nativo.
    expect(e.mensajesA(rider.phone).filter((m) => m.kind === 'location')).toHaveLength(1);
  });

  it('el tiempo del motorizado vale para los dos: un solo aviso a la clienta, y GSG se entera de cada uno', async () => {
    const antes = e.textosA(conPais(DORA)).length;
    await e.contesta(rider.phone, { texto: '30' });
    const d1 = await e.entrega('D-1');
    const d2 = await e.entrega('D-2');
    expect(d1?.estado).toBe('avisada');
    expect(d2?.estado).toBe('avisada');
    expect(d1?.llegaAproxAt).toBe(d2?.llegaAproxAt);
    const textos = e.textosA(conPais(DORA));
    expect(textos.length).toBe(antes + 1);
    expect(textos[textos.length - 1]).toContain('D-1 y D-2');
    // Al motorizado se le agradece nombrando los dos.
    const alMotorizado = e.textosA(rider.phone);
    expect(alMotorizado[alMotorizado.length - 1]).toContain('D-1 y D-2');
    await e.despacharAGsg();
    const entregas = e.simulador.recibido.filter((r) => r.tipo === 'entrega').map((r) => r.cuerpo.referencia);
    expect(entregas).toContain('D-1');
    expect(entregas).toContain('D-2');
  });

  it('"entregado" cierra los dos y a la clienta se le da las gracias una sola vez', async () => {
    const antes = e.textosA(conPais(DORA)).length;
    await e.contesta(rider.phone, { texto: 'entregado' });
    expect((await e.entrega('D-1'))?.estado).toBe('entregada');
    expect((await e.entrega('D-2'))?.estado).toBe('entregada');
    expect(e.textosA(conPais(DORA)).length).toBe(antes + 1);
    await e.despacharAGsg();
    expect(e.simulador.estado().terminados).toBeGreaterThanOrEqual(2);
  });
});
