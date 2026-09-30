/**
 * El cierre «Por este canal no se reciben consultas» sale UNA vez, también
 * cuando el cliente manda dos mensajes seguidos.
 *
 * El 26/09, tras «Ubicación registrada», el cliente mandó dos mensajes en el
 * mismo segundo y el cierre le llegó dos veces: se atendían en paralelo y los
 * dos leían el chat antes de que el otro lo cerrara.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, type EscenarioEntregas } from './escenario-entregas.js';

function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

describe('dos mensajes seguidos tras la ubicación registrada', () => {
  let e: EscenarioEntregas;

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true });
    await e.entregas.guardarAjustes({ soporte: { whatsapp: '987654321', llamadas: '' } });
    e.simulador.cargarDePrueba();
    await e.api.post('/admin/motorizados/de-prueba');
    await e.api.post('/admin/entregas/sincronizar');
    await e.trabajar();
  });
  afterAll(() => e?.cerrar());

  it('llegan a la vez y el cierre sale una sola vez', async () => {
    await e.contesta('987000001', { pin: PIN_LIMA });
    const antes = e.textosA('987000001').length;

    await Promise.all([
      e.contesta('987000001', { texto: 'Ya se' }),
      e.contesta('987000001', { texto: 'y cuánto cuesta el envío' }),
    ]);

    const cierres = e.textosA('987000001').slice(antes).filter((t) => t.includes('no se reciben consultas'));
    expect(cierres).toHaveLength(1);
  });
});

describe('cancelar dos veces seguidas', () => {
  let e: EscenarioEntregas;

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ arranque: hoyALas9() });
    e.simulador.cargarDePrueba();
    await e.api.post('/admin/motorizados/de-prueba');
    await e.api.post('/admin/entregas/sincronizar');
    await e.trabajar();
  });
  afterAll(() => e?.cerrar());

  it('al motorizado le llega «ya no lo llevas tú» una sola vez', async () => {
    await e.contesta('987000001', { pin: PIN_LIMA });
    await e.contesta('987000001', { texto: 'Sí, confirmo' });
    await e.trabajar();
    const pedido = (await e.entrega('P-1001'))!;
    const moto = pedido.motorizado!;
    expect(moto).toBeTruthy();

    await Promise.all([
      e.api.post(`/admin/entregas/${pedido.id}/cancelar`, { motivo: 'asas' }),
      e.api.post(`/admin/entregas/${pedido.id}/cancelar`, { motivo: 'ada' }),
    ]);
    await e.api.post(`/admin/entregas/${pedido.id}/cancelar`, { motivo: 'otra vez' });

    expect(e.textosA(moto.phone).filter((t) => /ya no lo llevas tú/.test(t))).toHaveLength(1);
  });
});

describe('un motorizado con dos pedidos de clientes distintos', () => {
  let e: EscenarioEntregas;
  const MOTO = '987555001';

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ arranque: hoyALas9() });
    e.simulador.cargarDePrueba();
    await e.api.post('/admin/motorizados', { telefono: MOTO, nombre: 'Chesco Prueba', zona: 'Miraflores' });
    await e.api.post('/admin/entregas/sincronizar');
    await e.trabajar();
    for (const [tel, dLat] of [['987000001', 0], ['987000002', 0.004]] as const) {
      await e.contesta(tel, { pin: { lat: PIN_LIMA.lat + dLat, lng: PIN_LIMA.lng } });
      await e.contesta(tel, { texto: 'Sí, confirmo' });
    }
    await e.trabajar();
  });
  afterAll(() => e?.cerrar());

  it('el segundo pedido le avisa de que tiene dos y cómo contestar', async () => {
    const a = (await e.entrega('P-1001'))!;
    const b = (await e.entrega('P-1002'))!;
    expect(a.motorizado?.phone).toBe(b.motorizado?.phone);
    expect(e.textosA(MOTO).some((t) => /Tienes 2 pedidos esperando tu tiempo/.test(t))).toBe(true);
  });

  it('un «20» a secas no se le pone a ninguno: se le pregunta a cuál', async () => {
    await e.contesta(MOTO, { texto: '20' });
    expect(e.textosA(MOTO).at(-1)).toMatch(/¿Para cuál es\?/);
    expect((await e.entrega('P-1001'))?.minutosMotorizado).toBeNull();
    expect((await e.entrega('P-1002'))?.minutosMotorizado).toBeNull();
  });

  it('un «no» a secas tampoco suelta ninguno', async () => {
    await e.contesta(MOTO, { texto: 'no' });
    expect(e.textosA(MOTO).at(-1)).toMatch(/¿Para cuál es\?/);
    expect((await e.entrega('P-1001'))?.estado).toBe('esperando_motorizado');
    expect((await e.entrega('P-1002'))?.estado).toBe('esperando_motorizado');
  });

  it('«P-1001 20, P-1002 45» pone cada tiempo en su pedido', async () => {
    await e.contesta(MOTO, { texto: 'P-1001 20, P-1002 45' });
    expect((await e.entrega('P-1001'))?.minutosMotorizado).toBe(20);
    expect((await e.entrega('P-1002'))?.minutosMotorizado).toBe(45);
  });
});

describe('la misma acción repetida seguida se atiende una vez', () => {
  let e: EscenarioEntregas;

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true });
    e.simulador.cargarDePrueba();
    await e.api.post('/admin/motorizados/de-prueba');
    await e.api.post('/admin/entregas/sincronizar');
    await e.trabajar();
  });
  afterAll(() => e?.cerrar());

  it('cinco «jaja» a la vez: una sola insistencia', async () => {
    const antes = e.textosA('987000002').length;
    await Promise.all(Array.from({ length: 5 }, () => e.contesta('987000002', { texto: 'jaja' })));
    expect(e.textosA('987000002').slice(antes)).toHaveLength(1);
  });

  it('el mismo pin dos veces a la vez: una sola respuesta', async () => {
    const antes = e.mensajesA('987000004').length;
    await Promise.all([e.contesta('987000004', { pin: PIN_LIMA }), e.contesta('987000004', { pin: PIN_LIMA })]);
    expect(e.mensajesA('987000004').slice(antes)).toHaveLength(1);
  });

  it('preguntar por el pedido se contesta cada vez', async () => {
    const antes = e.textosA('987000004').length;
    await e.contesta('987000004', { texto: '¿dónde va mi pedido?' });
    await e.contesta('987000004', { texto: '¿dónde va mi pedido?' });
    expect(e.textosA('987000004').length - antes).toBe(2);
  });
});
