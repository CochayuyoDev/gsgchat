import { describe, expect, it } from 'vitest';
import {
  evaluateGates,
  isWithinServiceWindow,
  type GateSnapshot,
  type SendIntent,
} from '../src/outbound/gates.js';
import { dailyCapFor, daysSince, msUntilNextDay } from '../src/outbound/throttle.js';
import type { Contact } from '../src/db/repos.js';
import { approvedTemplate } from './fakes.js';

const NOW = new Date('2026-03-10T12:00:00Z');

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    phone: '5215512345678',
    name: 'Ana',
    optInAt: new Date('2026-01-01T00:00:00Z'),
    optInSource: 'formulario_web',
    optOutAt: null,
    lastInboundAt: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<GateSnapshot> = {}): GateSnapshot {
  return {
    numberState: {
      phoneNumberId: 'PNID',
      quality: 'GREEN',
      paused: false,
      pausedReason: null,
      tier: null,
      warmupStartedOn: new Date('2026-01-01T00:00:00Z'),
    },
    marketingLast7d: 0,
    sentToday: 0,
    dailyCap: 1000,
    maxMarketingPerContact7d: 2,
    ...overrides,
  };
}

function intent(overrides: Partial<SendIntent> = {}): SendIntent {
  return {
    contact: contact(),
    kind: 'template',
    category: 'UTILITY',
    template: approvedTemplate(),
    now: NOW,
    ...overrides,
  };
}

describe('ventana de servicio de 24 h', () => {
  it('abierta si el cliente escribio hace menos de 24 h', () => {
    const c = contact({ lastInboundAt: new Date('2026-03-10T02:00:00Z') });
    expect(isWithinServiceWindow(c, NOW)).toBe(true);
  });

  it('cerrada a las 24 h exactas', () => {
    const c = contact({ lastInboundAt: new Date('2026-03-09T12:00:00Z') });
    expect(isWithinServiceWindow(c, NOW)).toBe(false);
  });

  it('cerrada si nunca escribio', () => {
    expect(isWithinServiceWindow(contact(), NOW)).toBe(false);
  });
});

describe('gates', () => {
  it('deja pasar una plantilla aprobada a un contacto con opt-in', () => {
    expect(evaluateGates(intent(), snapshot())).toEqual({ allow: true });
  });

  it('la baja bloquea aunque todo lo demas este bien', () => {
    const decision = evaluateGates(
      intent({ contact: contact({ optOutAt: new Date() }) }),
      snapshot(),
    );
    expect(decision).toMatchObject({ allow: false, code: 'opt_out' });
  });

  it('sin opt-in no sale nada iniciado por la empresa', () => {
    const decision = evaluateGates(intent({ contact: contact({ optInAt: null }) }), snapshot());
    expect(decision).toMatchObject({ allow: false, code: 'no_opt_in' });
  });

  it('pero si deja responder dentro de la ventana a quien escribio primero', () => {
    const decision = evaluateGates(
      intent({
        kind: 'freeform',
        template: null,
        contact: contact({ optInAt: null, lastInboundAt: new Date('2026-03-10T11:00:00Z') }),
      }),
      snapshot(),
    );
    expect(decision).toEqual({ allow: true });
  });

  it('fuera de la ventana el texto libre exige plantilla', () => {
    const decision = evaluateGates(intent({ kind: 'freeform', template: null }), snapshot());
    expect(decision).toMatchObject({ allow: false, code: 'window_closed' });
  });

  it('una plantilla no aprobada no se envia', () => {
    const decision = evaluateGates(
      intent({ template: approvedTemplate({ status: 'PAUSED' }) }),
      snapshot(),
    );
    expect(decision).toMatchObject({ allow: false, code: 'template_not_approved' });
  });

  it('una plantilla en rojo no se envia', () => {
    const decision = evaluateGates(
      intent({ template: approvedTemplate({ quality: 'RED' }) }),
      snapshot(),
    );
    expect(decision).toMatchObject({ allow: false, code: 'template_quality' });
  });

  it('una plantilla de marketing en amarillo se frena antes de que Meta la pause', () => {
    const decision = evaluateGates(
      intent({ category: 'MARKETING', template: approvedTemplate({ category: 'MARKETING', quality: 'YELLOW' }) }),
      snapshot(),
    );
    expect(decision).toMatchObject({ allow: false, code: 'template_quality' });
  });

  it('numero en amarillo: frena marketing pero deja pasar utility', () => {
    const yellow = snapshot({
      numberState: { ...snapshot().numberState, quality: 'YELLOW' },
    });

    expect(evaluateGates(intent({ category: 'MARKETING' }), yellow)).toMatchObject({
      allow: false,
      code: 'number_quality',
    });
    expect(evaluateGates(intent({ category: 'UTILITY' }), yellow)).toEqual({ allow: true });
  });

  it('numero en rojo: corta todo lo iniciado por la empresa', () => {
    const red = snapshot({ numberState: { ...snapshot().numberState, quality: 'RED' } });
    const decision = evaluateGates(intent({ category: 'UTILITY' }), red);
    expect(decision).toMatchObject({ allow: false, code: 'number_quality' });
  });

  it('numero pausado: rechaza con reintento, no descarta', () => {
    const paused = snapshot({
      numberState: { ...snapshot().numberState, paused: true, pausedReason: 'calidad en ROJO' },
    });
    const decision = evaluateGates(intent(), paused);
    expect(decision).toMatchObject({ allow: false, code: 'number_paused' });
    expect(decision.allow === false && decision.retryAfterMs).toBeGreaterThan(0);
  });

  it('tope de frecuencia de marketing por contacto', () => {
    const decision = evaluateGates(
      intent({ category: 'MARKETING', template: approvedTemplate({ category: 'MARKETING' }) }),
      snapshot({ marketingLast7d: 2 }),
    );
    expect(decision).toMatchObject({ allow: false, code: 'frequency_cap' });
  });

  it('el tope de frecuencia no afecta a utility', () => {
    const decision = evaluateGates(intent({ category: 'UTILITY' }), snapshot({ marketingLast7d: 9 }));
    expect(decision).toEqual({ allow: true });
  });

  it('cupo diario alcanzado: se reprograma', () => {
    const decision = evaluateGates(intent(), snapshot({ sentToday: 50, dailyCap: 50 }));
    expect(decision).toMatchObject({ allow: false, code: 'daily_cap' });
  });
});

describe('warm-up', () => {
  const policy = { startPerDay: 50, growth: 1.5, hardCap: 1000 };

  it('el primer dia arranca en el cupo inicial', () => {
    const start = new Date('2026-03-10T00:00:00Z');
    expect(dailyCapFor(start, new Date('2026-03-10T18:00:00Z'), policy)).toBe(50);
  });

  it('crece con los dias', () => {
    const start = new Date('2026-03-01T00:00:00Z');
    expect(dailyCapFor(start, new Date('2026-03-02T00:00:00Z'), policy)).toBe(75);
    expect(dailyCapFor(start, new Date('2026-03-03T00:00:00Z'), policy)).toBe(112);
  });

  it('nunca pasa del techo duro', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    expect(dailyCapFor(start, new Date('2026-06-01T00:00:00Z'), policy)).toBe(1000);
  });

  it('cuenta dias completos, no horas', () => {
    expect(daysSince(new Date('2026-03-01T23:00:00Z'), new Date('2026-03-02T01:00:00Z'))).toBe(1);
  });

  it('calcula lo que falta para el reinicio de cupo', () => {
    const ms = msUntilNextDay(new Date('2026-03-10T23:00:00Z'));
    expect(ms).toBe(60 * 60 * 1000);
  });
});

/**
 * Escribir a mano desde /chat no es una campana.
 *
 * Las guardas existen para que un envio automatico a una lista no queme el
 * numero. Con un cliente no oficial, donde no hay reglas de Meta que cumplir,
 * pedirle opt-in al operador para poder contestar convierte la pantalla en un
 * tramite: ahi el chat tiene que comportarse como el WhatsApp Web de siempre.
 */
describe('envio manual desde el chat', () => {
  it('sin opt-in se puede escribir a mano', () => {
    const sinOptIn = contact({ optInAt: null, optInSource: null });
    expect(evaluateGates(intent({ contact: sinOptIn, kind: 'freeform', template: null }), snapshot())).toMatchObject({
      allow: false,
      code: 'no_opt_in',
    });
    expect(
      evaluateGates(
        intent({ contact: sinOptIn, kind: 'freeform', template: null, manual: true }),
        snapshot(),
      ),
    ).toEqual({ allow: true });
  });

  it('la ventana de 24 h no frena lo escrito a mano', () => {
    const frio = contact({ lastInboundAt: new Date('2026-03-01T00:00:00Z') });
    expect(evaluateGates(intent({ contact: frio, kind: 'freeform', template: null }), snapshot())).toMatchObject({
      code: 'window_closed',
    });
    expect(
      evaluateGates(intent({ contact: frio, kind: 'freeform', template: null, manual: true }), snapshot()),
    ).toEqual({ allow: true });
  });

  it('el cupo diario tampoco: lo que teclea una persona no quema un numero', () => {
    const lleno = snapshot({ sentToday: 1000, dailyCap: 1000 });
    expect(evaluateGates(intent(), lleno)).toMatchObject({ code: 'daily_cap' });
    expect(evaluateGates(intent({ manual: true }), lleno)).toEqual({ allow: true });
  });

  it('el tope de marketing por contacto se salta igual', () => {
    const saturado = snapshot({ marketingLast7d: 5, maxMarketingPerContact7d: 2 });
    expect(evaluateGates(intent({ category: 'MARKETING' }), saturado)).toMatchObject({
      code: 'frequency_cap',
    });
    expect(evaluateGates(intent({ category: 'MARKETING', manual: true }), saturado)).toEqual({
      allow: true,
    });
  });

  it('la BAJA sigue siendo intocable: la pidio una persona', () => {
    const baja = contact({ optOutAt: new Date('2026-03-01T00:00:00Z') });
    expect(evaluateGates(intent({ contact: baja, manual: true }), snapshot())).toMatchObject({
      allow: false,
      code: 'opt_out',
    });
  });

  it('el freno de emergencia tampoco se salta a mano', () => {
    const pausado = snapshot({
      numberState: { ...snapshot().numberState, paused: true, pausedReason: 'pausa manual' },
    });
    expect(evaluateGates(intent({ manual: true }), pausado)).toMatchObject({
      allow: false,
      code: 'number_paused',
    });
  });

  it('una plantilla sin aprobar sigue sin salir, aunque sea a mano', () => {
    expect(
      evaluateGates(intent({ manual: true, template: approvedTemplate({ status: 'PAUSED' }) }), snapshot()),
    ).toMatchObject({ allow: false, code: 'template_not_approved' });
  });
});

/**
 * La ventana de 24 h es de Meta, no nuestra.
 *
 * La Cloud API rechaza el texto libre pasadas 24 h del ultimo mensaje del
 * cliente. Con un cliente no oficial esa regla no existe, y aplicarla igual
 * seria inventarse una limitacion que el propio WhatsApp no tiene.
 */
describe('la ventana de servicio segun el proveedor', () => {
  const frio = contact({ lastInboundAt: new Date('2026-03-01T00:00:00Z') });

  it('con la Cloud API, fuera de la ventana solo se puede plantilla', () => {
    expect(
      evaluateGates(intent({ contact: frio, kind: 'freeform', template: null }), snapshot()),
    ).toMatchObject({ allow: false, code: 'window_closed' });
  });

  it('sin Cloud API detras, la ventana no frena nada', () => {
    expect(
      evaluateGates(
        intent({ contact: frio, kind: 'freeform', template: null }),
        snapshot({ serviceWindowApplies: false }),
      ),
    ).toEqual({ allow: true });
  });

  it('quien no diga nada se comporta como Meta', () => {
    // El valor por defecto tiene que ser el restrictivo: olvidarse de ponerlo
    // no puede acabar mandando texto libre que la Cloud API va a rechazar.
    expect(
      evaluateGates(intent({ contact: frio, kind: 'freeform', template: null }), snapshot()),
    ).toMatchObject({ code: 'window_closed' });
  });

  it('sin ventana, el opt-in sigue haciendo falta para escribir primero', () => {
    const sinOptIn = contact({ optInAt: null, optInSource: null, lastInboundAt: null });
    expect(
      evaluateGates(
        intent({ contact: sinOptIn, kind: 'freeform', template: null }),
        snapshot({ serviceWindowApplies: false }),
      ),
    ).toMatchObject({ allow: false, code: 'no_opt_in' });
  });

  it('sin ventana, una baja sigue bloqueando', () => {
    expect(
      evaluateGates(
        intent({ contact: contact({ optOutAt: new Date() }) }),
        snapshot({ serviceWindowApplies: false }),
      ),
    ).toMatchObject({ allow: false, code: 'opt_out' });
  });
});
