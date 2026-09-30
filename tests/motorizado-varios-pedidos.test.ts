/**
 * Un motorizado con varios pedidos a la vez (revisión del 28/09):
 *
 *   - «P-1001 20, P-2001 20»: cada trozo va a SU pedido. P-2001 iba en el
 *     mismo viaje que P-1001 (mismo cliente) y ya quedó con su tiempo: su
 *     trozo se salta, NUNCA cae en «si queda un solo cliente, ese» (le daba
 *     los minutos a P-1002 y a su cliente un aviso de llegada falso).
 *   - Las referencias se comparan por palabra completa (P-100 no es P-1001).
 *   - «Tienes N pedidos esperando tu tiempo» cuenta todos, también los del
 *     mismo cliente; y al quitar «Responde solo con los minutos (ej. 40).» no
 *     queda «40).» colgando.
 *   - Contestar citando el pin (el mensaje de ubicación aparte) también vale.
 *   - «Ya no lo llevas tú» sale otra vez si se le vuelve a dar el pedido y se
 *     le vuelve a quitar; si no sale, queda a la vista.
 *   - El cierre no espera al reparto fuera del horario de envío.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, conPais, type EscenarioEntregas } from './escenario-entregas.js';
import { mismoMensaje, posicionDeReferencia, sinUnionFinal, wamidsDelEvento } from '../src/entregas/servicio.js';

function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

const MOTO = '987555101';
const pinEn = (i: number) => ({ lat: PIN_LIMA.lat + i * 0.004, lng: PIN_LIMA.lng });

/** Pedidos a mano (sin confirmar), un motorizado y los pines en el orden dado. */
async function armar(pedidos: Array<{ referencia: string; telefono: string; nombre: string }>, ordenPines: string[], motorizados: Array<{ telefono: string; nombre: string }> = [{ telefono: MOTO, nombre: 'Chesco Prueba' }]): Promise<EscenarioEntregas> {
  const e = await crearEscenarioEntregas({ arranque: hoyALas9() });
  e.simulador.cargar(pedidos.map((p) => ({ ...p, direccion: 'Av. Arequipa 100', distrito: 'Lima', faltaUbicacion: true, faltaConfirmacion: false })));
  for (const m of motorizados) await e.api.post('/admin/motorizados', { telefono: m.telefono, nombre: m.nombre, zona: 'Lima' });
  await e.api.post('/admin/entregas/sincronizar');
  await e.trabajar();
  // Un pin por cliente, y el motor reparte entre pin y pin (así se sabe en qué orden le llegan).
  for (const [i, tel] of ordenPines.entries()) {
    await e.contesta(tel, { pin: pinEn(i) });
    await e.trabajar();
  }
  return e;
}

describe('las piezas', () => {
  it('la referencia se busca por palabra completa', () => {
    expect(posicionDeReferencia('p-1001 20, p-100 40', 'P-100')).toBe(11);
    expect(posicionDeReferencia('p-1001 20', 'P-100')).toBe(-1);
    expect(posicionDeReferencia('P-1001 20', 'P-1001')).toBe(0);
    expect(posicionDeReferencia('el p-1001, 20', 'P-1001')).toBe(3);
  });
  it('del trozo se quita la coma o la «y» suelta, nunca la «y» de una palabra', () => {
    expect(sinUnionFinal('P-1001 20, ')).toBe('P-1001 20');
    expect(sinUnionFinal('P-1001 20 y ')).toBe('P-1001 20');
    expect(sinUnionFinal('P-1001 no voy')).toBe('P-1001 no voy');
    expect(sinUnionFinal('P-1001 no voy y ')).toBe('P-1001 no voy');
    expect(sinUnionFinal('P-1001 hoy; ')).toBe('P-1001 hoy');
  });
  it('los ids del mensaje del pedido y del pin; WAHA a veces cita solo la última parte', () => {
    expect(wamidsDelEvento({ wamid: 'a1', wamids: ['a1', 'b2'] })).toEqual(['a1', 'b2']);
    expect(wamidsDelEvento({ wamid: 'a1' })).toEqual(['a1']);
    expect(wamidsDelEvento(null)).toEqual([]);
    expect(mismoMensaje('true_51987555101@c.us_3EB0ABCDEF12', '3EB0ABCDEF12')).toBe(true);
    expect(mismoMensaje('wamid.1', 'wamid.12')).toBe(false);
  });
});

describe('dos pedidos del mismo cliente (mismo viaje) y uno de otro cliente', () => {
  let e: EscenarioEntregas;
  const ANA = '987000101';
  const BETO = '987000102';

  beforeAll(async () => {
    // Beto primero: al llegar el viaje de Ana (P-1001 + P-2001) ya tiene P-1002 esperando.
    e = await armar(
      [
        { referencia: 'P-1001', telefono: ANA, nombre: 'Ana Prueba' },
        { referencia: 'P-2001', telefono: ANA, nombre: 'Ana Prueba' },
        { referencia: 'P-1002', telefono: BETO, nombre: 'Beto Prueba' },
      ],
      [BETO, ANA],
    );
  });
  afterAll(() => e?.cerrar());

  it('le llegan los tres y el recuento dice 3, sin «40).» colgando', async () => {
    for (const ref of ['P-1001', 'P-2001', 'P-1002']) expect((await e.entrega(ref))?.motorizado?.phone, ref).toBe(conPais(MOTO));
    const conVarios = e.textosA(MOTO).find((t) => /pedidos esperando tu tiempo/.test(t));
    expect(conVarios).toMatch(/Tienes 3 pedidos esperando tu tiempo/);
    expect(conVarios).not.toMatch(/40\)/);
    expect(conVarios).not.toMatch(/Responde solo con los minutos/);
    expect(conVarios).toMatch(/¿En cuántos minutos lo entregas\?\n/);
  });

  it('«P-1001 20, P-2001 20»: los dos de Ana con 20 y P-1002 intacto (a Beto no le llega ningún aviso)', async () => {
    const antesBeto = e.textosA(BETO).length;
    await e.contesta(MOTO, { texto: 'P-1001 20, P-2001 20' });
    expect((await e.entrega('P-1001'))?.minutosMotorizado).toBe(20);
    expect((await e.entrega('P-2001'))?.minutosMotorizado).toBe(20);
    expect((await e.entrega('P-1002'))?.minutosMotorizado).toBeNull();
    expect((await e.entrega('P-1002'))?.estado).toBe('esperando_motorizado');
    expect(e.textosA(BETO).slice(antesBeto)).toEqual([]);
  });
});

describe('P-100 y P-1001 a la vez', () => {
  let e: EscenarioEntregas;

  beforeAll(async () => {
    e = await armar(
      [
        { referencia: 'P-1001', telefono: '987000111', nombre: 'Uno Prueba' },
        { referencia: 'P-100', telefono: '987000112', nombre: 'Dos Prueba' },
      ],
      ['987000111', '987000112'],
    );
  });
  afterAll(() => e?.cerrar());

  it('«P-1001 25, P-100 40» pone cada tiempo en el suyo', async () => {
    await e.contesta(MOTO, { texto: 'P-1001 25, P-100 40' });
    expect((await e.entrega('P-1001'))?.minutosMotorizado).toBe(25);
    expect((await e.entrega('P-100'))?.minutosMotorizado).toBe(40);
  });
});

describe('contestar citando el pin', () => {
  let e: EscenarioEntregas;

  beforeAll(async () => {
    e = await armar(
      [
        { referencia: 'P-3001', telefono: '987000121', nombre: 'Tres Prueba' },
        { referencia: 'P-3002', telefono: '987000122', nombre: 'Cuatro Prueba' },
      ],
      ['987000121', '987000122'],
    );
  });
  afterAll(() => e?.cerrar());

  it('un «30» citando el pin de P-3001 va a P-3001', async () => {
    const p1 = (await e.entrega('P-3001'))!;
    // El pin que salió aparte hacia el motorizado, tal como quedó en su chat.
    const moto = (await e.repos.contacts.getByPhone(conPais(MOTO)))!;
    const hilo = await e.repos.messages.listMessages(moto.id, 50);
    const pines = hilo.filter((m) => m.direction === 'out' && m.kind === 'location');
    expect(pines).toHaveLength(2);
    const evs = await e.repos.entregas.eventos(p1.id, 100);
    const enviado = evs.filter((ev) => ev.tipo === 'motorizado_enviado').at(-1)!;
    const delPin = pines.find((m) => wamidsDelEvento(enviado.payload).includes(m.wamid!));
    expect(delPin).toBeTruthy();
    // El que cita el pin: sin decir el pedido y con dos clientes esperando.
    const r = await e.entregas.alTexto({ id: moto.id, phone: moto.phone, name: moto.name }, '30', { citaId: delPin!.wamid });
    expect(r.resultado).not.toBe('motorizado_cual');
    expect((await e.entrega('P-3001'))?.minutosMotorizado).toBe(30);
    expect((await e.entrega('P-3002'))?.minutosMotorizado).toBeNull();
  });
});

describe('«ya no lo llevas tú» cuando se lo vuelven a dar y a quitar', () => {
  let e: EscenarioEntregas;
  const OTRO = '987555102';

  beforeAll(async () => {
    e = await armar([{ referencia: 'P-4001', telefono: '987000131', nombre: 'Cinco Prueba' }], ['987000131'], [
      { telefono: MOTO, nombre: 'Chesco Prueba' },
      { telefono: OTRO, nombre: 'Otro Prueba' },
    ]);
  });
  afterAll(() => e?.cerrar());

  it('sale cada vez que se le quita, y si no sale queda a la vista', async () => {
    let p = (await e.entrega('P-4001'))!;
    const primero = p.motorizado!;
    const motos = await e.repos.entregas.listarMotorizados();
    const segundo = motos.find((m) => m.phone !== primero.phone)!;
    const avisos = (tel: string) => e.textosA(tel).filter((t) => /ya no lo llevas tú/.test(t)).length;

    // Se lo pasan al otro: al primero le llega el aviso.
    await e.entregas.reasignar(p.id, segundo.id, 'prueba');
    expect(avisos(primero.phone)).toBe(1);
    // Se lo devuelven al primero y luego se cancela: el aviso vuelve a salir.
    await e.entregas.reasignar(p.id, primero.id, 'prueba');
    p = (await e.entrega('P-4001'))!;
    expect(p.motorizado?.phone).toBe(primero.phone);
    await e.entregas.cancelar(p.id, 'ya no lo quiere', 'prueba');
    expect(avisos(primero.phone)).toBe(2);
    // Cancelar otra vez no lo repite.
    await e.entregas.cancelar(p.id, 'otra vez', 'prueba');
    expect(avisos(primero.phone)).toBe(2);
  });

  it('si WhatsApp no deja mandar el aviso, queda un evento que lo dice', async () => {
    const otro = await armar([{ referencia: 'P-4002', telefono: '987000132', nombre: 'Seis Prueba' }], ['987000132']);
    try {
      const p = (await otro.entrega('P-4002'))!;
      expect(p.motorizado).toBeTruthy();
      otro.wa.failNext = new Error('sin conexión');
      await otro.entregas.cancelar(p.id, 'ya no lo quiere', 'prueba');
      const evs = await otro.repos.entregas.eventos(p.id, 200);
      expect(evs.some((ev) => ev.tipo === 'incidencia' && /no se le pudo avisar a .* que ya no lleva P-4002/.test(ev.detalle ?? ''))).toBe(true);
    } finally {
      await otro.cerrar();
    }
  });
});

describe('el cierre fuera del horario de envío', () => {
  it('no espera al reparto (que a esa hora no asigna a nadie); dentro del horario sí espera y da el número del motorizado', async () => {
    const e = await crearEscenarioEntregas({ arranque: hoyALas9(), esperaMotorizadoMs: 3_000 });
    try {
      e.simulador.cargar([{ referencia: 'P-5001', telefono: '987000141', nombre: 'Siete Prueba', direccion: 'Av. Arequipa 100', distrito: 'Lima', faltaUbicacion: true, faltaConfirmacion: false }]);
      await e.api.post('/admin/motorizados', { telefono: MOTO, nombre: 'Chesco Prueba', zona: 'Lima' });
      await e.api.post('/admin/entregas/sincronizar');
      await e.trabajar();
      await e.contesta('987000141', { pin: PIN_LIMA });
      // Sin pasar por el motor: ubicación registrada y todavía sin motorizado.
      const antes = (await e.entrega('P-5001'))!;
      expect(antes.ubicacionEstado).toBe('recibida');
      expect(antes.motorizado).toBeNull();

      e.entregas.conectarMotor({ proximoEnvioEn: () => 0, parado: () => null, enHorario: () => false });
      const t0 = Date.now();
      await e.entregas.textoAgente('cierreAgente', conPais('987000141'), 'Siete Prueba');
      expect(Date.now() - t0).toBeLessThan(1_000);

      // En horario: espera y, si el reparto lo asigna mientras, da SU número.
      e.entregas.conectarMotor({ proximoEnvioEn: () => 0, parado: () => null, enHorario: () => true });
      const cierre = e.entregas.textoAgente('cierreAgente', conPais('987000141'), 'Siete Prueba');
      await new Promise((r) => setTimeout(r, 300));
      await e.trabajar();
      expect(await cierre).toContain('+51 987 555 101');
    } finally {
      await e.cerrar();
    }
  }, 20_000);
});
