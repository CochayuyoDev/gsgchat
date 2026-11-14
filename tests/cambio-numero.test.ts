/**
 * Cambio de número (rama feature/cambio_numero): GSGchat detecta que el
 * número de un pedido no tiene WhatsApp, GSG manda OTRA VEZ ese pedido con el
 * MISMO tracking y otro número → GSGchat tiene que volver a pedirle la
 * ubicación, ahora al número nuevo.
 *
 * Casos:
 *  - el pedido sigue en incidencia «sin WhatsApp»: se cambia el número y se le
 *    pide la ubicación al nuevo;
 *  - GSG (o una persona) canceló el pedido tras el «sin WhatsApp»: el reenvío
 *    con otro número lo reabre y se le pide al nuevo (antes contestaba «ya
 *    estaba» y no le escribía a nadie);
 *  - cancelado y reenviado con el MISMO número: sigue cancelado, sin mensajes;
 *  - el reenvío llega al día siguiente: es un pedido nuevo y se le pide.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import { CLAVE_API_PRUEBA } from './fakes.js';

function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

const pedido = (tracking: string, telefono: string) => ({
  ...OBLIGATORIOS_GSG,
  tracking,
  cliente: `Cliente ${tracking}`,
  telefono,
});

type Cuerpo = Record<string, any>;

describe('cambio de número tras «sin WhatsApp»', () => {
  let e: EscenarioEntregas;
  const sinWhatsApp = new Set<string>();

  const llamar = async (url: string, body: unknown) => {
    const r = await e.app.inject({ method: 'POST', url, headers: { 'x-api-key': CLAVE_API_PRUEBA }, payload: body as Record<string, unknown> });
    return { status: r.statusCode, body: r.json() as Cuerpo };
  };
  const pedidasA = (telefono: string) => e.mensajesA(telefono).length;
  /** Deja trabajar a los motores unas vueltas, con el reloj avanzando. */
  const vueltas = async (n = 3) => {
    for (let i = 0; i < n; i++) {
      await e.trabajar();
      e.avanzar(30);
    }
    await e.trabajar();
  };
  /** GSG manda el pedido con un número sin WhatsApp y GSGchat lo detecta. */
  const llegaSinWhatsApp = async (tracking: string, telefono: string) => {
    sinWhatsApp.add(`51${telefono}`);
    expect((await llamar('/api/v1/entregas', pedido(tracking, telefono))).status).toBe(201);
    await vueltas();
    const x = await e.entrega(tracking);
    expect(x).toMatchObject({ estado: 'incidencia', incidencia: 'sin_whatsapp', ubicacionEstado: 'pendiente' });
    expect(pedidasA(telefono)).toBe(0);
  };

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ arranque: hoyALas9() });
    e.wa.tieneWhatsApp = async (phone: string) => !sinWhatsApp.has(phone);
  });
  afterAll(async () => {
    await e?.cerrar();
  });

  it('el mismo tracking con otro número: se le pide la ubicación al número nuevo', async () => {
    await llegaSinWhatsApp('CN-1', '987000301');

    const r = await llamar('/api/v1/entregas', pedido('CN-1', '987000302'));
    expect(r.status).toBe(200);
    expect(r.body.telefonosCorregidos).toEqual([expect.objectContaining({ referencia: 'CN-1', antes: '51987000301', ahora: '51987000302' })]);
    await vueltas();

    const x = await e.entrega('CN-1');
    expect(x!.phone).toBe('51987000302');
    expect(pedidasA('987000302')).toBeGreaterThan(0);
    expect(pedidasA('987000301')).toBe(0);
  });

  it('cancelado tras el «sin WhatsApp»: el reenvío con otro número lo reabre y le pide la ubicación', async () => {
    await llegaSinWhatsApp('CN-2', '987000311');
    const c = await llamar('/api/v1/flujo', { tracking: 'CN-2', accion: 'CANCELAR', motivo: 'el número no tiene WhatsApp' });
    expect(c.status).toBe(200);
    expect((await e.entrega('CN-2'))!.estado).toBe('cancelada');

    const r = await llamar('/api/v1/entregas', pedido('CN-2', '987000312'));
    expect(r.status).toBe(200);
    expect(r.body.telefonosCorregidos).toEqual([expect.objectContaining({ referencia: 'CN-2', antes: '51987000311', ahora: '51987000312' })]);
    expect(r.body.descartadas).toEqual([]);
    await vueltas();

    const x = await e.entrega('CN-2');
    expect(x!.phone).toBe('51987000312');
    expect(x!.estado).not.toBe('cancelada');
    expect(x!.ubicacionEstado).toBe('pendiente');
    expect(pedidasA('987000312')).toBeGreaterThan(0);
    // Sigue siendo un solo pedido con ese tracking.
    expect((await e.resumen()).entregas.filter((y) => y.referencia === 'CN-2')).toHaveLength(1);
  });

  it('cancelado y reenviado con el MISMO número: sigue cancelado y no se le escribe', async () => {
    await llegaSinWhatsApp('CN-3', '987000321');
    await llamar('/api/v1/flujo', { tracking: 'CN-3', accion: 'CANCELAR' });
    sinWhatsApp.delete('51987000321');

    const r = await llamar('/api/v1/entregas', pedido('CN-3', '987000321'));
    expect(r.status).toBe(200);
    expect(r.body.repetidas).toContain('CN-3');
    expect(r.body.telefonosCorregidos).toBeUndefined();
    await vueltas();
    expect((await e.entrega('CN-3'))!.estado).toBe('cancelada');
    expect(pedidasA('987000321')).toBe(0);
  });

  it('el reenvío llega al día siguiente: pedido nuevo, se le pide la ubicación al número nuevo', async () => {
    await llegaSinWhatsApp('CN-4', '987000331');
    e.avanzar(24 * 60);
    await vueltas();

    const r = await llamar('/api/v1/entregas', pedido('CN-4', '987000332'));
    expect(r.status).toBe(201);
    await vueltas();
    const x = await e.entrega('CN-4');
    expect(x!.phone).toBe('51987000332');
    expect(pedidasA('987000332')).toBeGreaterThan(0);
  });
});
