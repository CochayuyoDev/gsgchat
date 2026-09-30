/**
 * «Me equivoqué de ubicación» y el menú de respaldo de un cliente de ENTREGA
 * (lo que reportó el dueño el 30/09 con Ana Quispe, GSG-A-1001):
 *
 *  - Con «Todo el sistema» (las tiendas nuevas de /registro), «me equivoqué
 *    de ubicación» caía al menú de la preventa («No reconocí ese mensaje…
 *    1. Cotizar envío…»). Ahora es un pedido de cambio de ubicación: antes de
 *    la 1:00 PM se le pide la nueva; después, que coordine con el motorizado.
 *  - A un cliente con una entrega en curso el menú de respaldo solo le ofrece
 *    «Horarios y zona» y «Hablar con asesor»: nunca «Cotizar envío».
 *  - Diego Paz: el cliente de «falta confirmar» que escribe ANTES de que el
 *    sistema le pregunte no recibe respuesta, pero queda dicho en su pedido.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { crearGsgFalso, type GsgFalso } from '../scripts/gsg-falso.js';
import { pideCambioUbicacion } from '../src/entregas/interpretar.js';
import { pareceCambioUbicacion } from '../src/ia/agente-operativo.js';
import { BOTON, responder, type Contexto } from '../src/preventa/flow.js';
import type { Lead } from '../src/db/leads.js';

/** Las 09:00 de Lima del último día que ya empezó. */
function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

const PIDE_LA_NUEVA = '¡Claro! Entiendo. Mándame la nueva ubicación para tenerla en cuenta para el mismo día.';
const AVISO_1PM = /Si por algún motivo deseas cambiar tu ubicación, avísanos antes de la 1:00 PM para tenerla en cuenta el mismo día\./;
const MOTO = '999888777';

// ------------------------------------------------------------------ reglas

describe('pideCambioUbicacion: el cliente quiere cambiar la ubicación que ya dio', () => {
  const SI = [
    'me equivoqué de ubicación',
    'me equivoque de ubicacion',
    'Me equivoqué de ubicación 😅',
    'no, me equivoqué de ubicación',
    'me equiboque de ubicasion',
    'me ekivoke de ubikcion',
    'me equivoke de hubicacion',
    'esa no es mi ubicación',
    'esa no es mi ubicacion',
    'esa no es mi direccion',
    'quiero cambiar mi ubicación',
    'kiero cambiar mi ubicacion',
    'puedo cambiar la dirección?',
    'mandé mal la ubicación',
    'mande mal la ubicacion',
    'la mandé mal',
    'la ubicación está mal',
    'la ubicacion esta mal',
    'ubicación equivocada',
    'me confundí de dirección',
    'puse mal el pin',
    'te mando otra ubicación',
    'te mando otra',
    'ahora te paso la correcta',
    'la ubicación es otra',
    'no es ahí',
    'la direccion no era esa',
    'ubicacion incorrecta',
  ];
  const NO = [
    'gracias',
    'ok',
    'sí',
    'ya te mandé mi ubicación',
    'por qué necesitan mi ubicación?',
    'no es necesario mandar la ubicación',
    'no me equivoqué de ubicación',
    'la ubicación está bien',
    'ubicación correcta, gracias',
    'la ubicación no está mal',
    'no quiero cambiar mi ubicación',
    'a qué hora llega mi pedido?',
    'me equivoqué de talla',
    'quiero cambiar la hora',
    'cuánto cuesta el envío',
    'no es mi pedido',
  ];
  for (const t of SI) it(`«${t}» → sí`, () => expect(pideCambioUbicacion(t)).toBe(true));
  for (const t of NO) it(`«${t}» → no`, () => expect(pideCambioUbicacion(t)).toBe(false));

  it('el agente operativo («Solo lo de GSG») reconoce las mismas variantes', () => {
    for (const t of ['esa no es mi ubicación', 'me equiboque de ubicasion', 'la mandé mal', 'te mando otra']) expect(pareceCambioUbicacion(t), t).toBe(true);
  });
});

// ------------------------------------------------------ el menú de respaldo

describe('preventa: a un cliente con entrega en curso nunca se le ofrece «Cotizar envío»', () => {
  const ctx: Contexto = { negocio: 'Demo GSG', cobertura: 'Lima', saludo: 'Buenos días', horario: 'de 2:00 PM a 8:00 PM', conEntrega: true };
  const lead = (extra: Partial<Lead> = {}): Lead => ({ estado: 'en_conversacion', preguntaPendiente: null, ultimasOpciones: null, intentosFallidos: 0, ...extra }) as unknown as Lead;
  const titulos = (r: ReturnType<typeof responder>) => r.respuesta?.botones?.map((b) => b.title) ?? [];

  it('lo que no se entiende: «No reconocí…» con solo «Horarios y zona» y «Hablar con asesor»', () => {
    const r = responder(lead(), { texto: 'asdf qwer', esPrimerMensaje: false }, ctx);
    expect(r.respuesta?.texto).toBe('No reconocí ese mensaje. ¿En qué te ayudo?');
    expect(titulos(r)).toEqual(['Horarios y zona', 'Hablar con asesor']);
    expect(r.patch.ultimasOpciones).toEqual([BOTON.info, BOTON.asesor]);
  });

  it('el primer mensaje y el saludo tampoco llevan «Cotizar envío»', () => {
    expect(titulos(responder(lead({ estado: 'nuevo' }), { texto: 'hola', esPrimerMensaje: true }, ctx))).toEqual(['Horarios y zona', 'Hablar con asesor']);
    expect(titulos(responder(lead(), { texto: 'hola buenas', esPrimerMensaje: false }, ctx))).toEqual(['Horarios y zona', 'Hablar con asesor']);
  });

  it('responder «1» da el horario (de las entregas) y «2» pasa a una persona', () => {
    const menu = [BOTON.info, BOTON.asesor];
    const uno = responder(lead({ ultimasOpciones: menu }), { texto: '1', esPrimerMensaje: false }, ctx);
    expect(uno.respuesta?.texto).toBe('Atendemos Lima. Horario: de 2:00 PM a 8:00 PM.');
    expect(titulos(uno)).toEqual(['Hablar con asesor']);
    const dos = responder(lead({ ultimasOpciones: menu }), { texto: '2', esPrimerMensaje: false }, ctx);
    expect(dos.respuesta?.texto).toMatch(/te atiende una persona/);
    expect(dos.patch.estado).toBe('calificado');
  });

  it('«cotizar», «envío» o un distrito no abren el cuestionario de cotización', () => {
    for (const texto of ['quiero cotizar', 'mi envío', 'de Surco a Miraflores']) {
      const r = responder(lead(), { texto, esPrimerMensaje: false }, ctx);
      expect(r.respuesta?.texto, texto).toBe('No reconocí ese mensaje. ¿En qué te ayudo?');
      expect(r.patch.preguntaPendiente ?? null, texto).toBeNull();
      expect(r.patch.recojoDistrito, texto).toBeUndefined();
    }
  });

  it('sin entrega en curso (cliente nuevo del courier) el menú sigue con sus tres opciones', () => {
    const r = responder(lead(), { texto: 'asdf qwer', esPrimerMensaje: false }, { ...ctx, conEntrega: false });
    expect(titulos(r)).toEqual(['Cotizar envío', 'Horarios y zona', 'Hablar con asesor']);
  });
});

// ------------------------------------- la conversación del dueño, de punta a punta

describe('la conversación de Ana Quispe con «Todo el sistema» (tienda nueva de /registro)', () => {
  let e: EscenarioEntregas;
  let gsg: GsgFalso;
  const ANA = '987600001';
  const nuevos = async (tel: string, accion: () => Promise<unknown>): Promise<string[]> => {
    const a = e.textosA(tel).length;
    await accion();
    await e.trabajar();
    return e.textosA(tel).slice(a);
  };
  const botonesNuevos = async (tel: string, accion: () => Promise<unknown>) => {
    const a = e.botonesA(tel).length;
    await accion();
    await e.trabajar();
    return e.botonesA(tel).slice(a);
  };

  beforeAll(async () => {
    gsg = await crearGsgFalso({
      token: 'token-de-gsg',
      lista: {
        faltaUbicacion: [{ tracking: 'GSG-A-1001', telefono: ANA, nombre: 'Ana Quispe', direccion: 'Av. La Marina 1234', distrito: 'San Miguel', telefonoMotorizado: MOTO }],
        faltaConfirmacion: [],
      },
    });
    // Sin `agente`: sin «Solo lo de GSG», con la preventa encendida (como las tiendas nuevas).
    e = await crearEscenarioEntregas({ arranque: hoyALas9(), confirmarLista: true });
    await e.conexionGsg.conectarReal({ url: gsg.url, token: gsg.token });
    await e.api.post('/admin/entregas/sincronizar');
    await e.api.post('/admin/entregas/confirmar-envio', { todos: true });
    await e.trabajar();
  });
  afterAll(async () => {
    await e?.cerrar();
    await gsg?.cerrar();
  });

  it('1. se le pide la ubicación y, con el pin, «Ubicación registrada» con el aviso de la 1:00 PM', async () => {
    expect(e.mensajesA(ANA).some((m) => m.kind === 'location_request')).toBe(true);
    const r = await nuevos(ANA, () => e.contesta(ANA, { pin: { lat: -12.0775, lng: -77.09 } }));
    const gracias = r.find((t) => t.includes('Ubicación registrada correctamente'));
    expect(gracias, r.join('\n---\n')).toBeTruthy();
    expect(gracias).toMatch(AVISO_1PM);
  });

  it('2. «me equivoqué de ubicación» → que mande la nueva; nada de «No reconocí» ni menú', async () => {
    const antes = e.botonesA(ANA).length;
    const r = await nuevos(ANA, () => e.contesta(ANA, { texto: 'me equivoqué de ubicación' }));
    expect(r).toEqual([PIDE_LA_NUEVA]);
    expect(e.botonesA(ANA).length).toBe(antes);
  });

  it('3. el pin nuevo → «Tu nueva ubicación se ha registrado»', async () => {
    const r = await nuevos(ANA, () => e.contesta(ANA, { pin: { lat: -12.079, lng: -77.088 } }));
    expect(r.some((t) => /Tu nueva ubicación se ha registrado correctamente/.test(t)), r.join('\n---\n')).toBe(true);
    expect((await e.entrega('GSG-A-1001'))?.lat).toBeCloseTo(-12.079, 5);
  });

  it('4. las variantes (sin tildes, con faltas) también piden la nueva', async () => {
    for (const texto of ['me equivoque de ubicacion', 'esa no es mi ubicación', 'mande mal la ubicacion', 'la ubicación está mal', 'me equiboque de ubicasion']) {
      const antes = e.botonesA(ANA).length;
      expect(await nuevos(ANA, () => e.contesta(ANA, { texto })), texto).toEqual([PIDE_LA_NUEVA]);
      expect(e.botonesA(ANA).length, texto).toBe(antes);
    }
  });

  it('5. lo que no se entiende: el menú SIN «Cotizar envío»; «1» da el horario y «2» pasa a una persona', async () => {
    const menu = await botonesNuevos(ANA, () => e.contesta(ANA, { texto: 'asdf qwer' }));
    expect(menu).toHaveLength(1);
    expect(menu[0]!.body).toBe('No reconocí ese mensaje. ¿En qué te ayudo?');
    expect(menu[0]!.buttons.map((b) => b.title)).toEqual(['Horarios y zona', 'Hablar con asesor']);

    const info = await botonesNuevos(ANA, () => e.contesta(ANA, { texto: '1' }));
    expect(info[0]?.body).toMatch(/Horario: de \d{1,2}:\d{2} [AP]M a \d{1,2}:\d{2} [AP]M/);
    expect(info[0]?.buttons.map((b) => b.title)).toEqual(['Hablar con asesor']);

    await botonesNuevos(ANA, () => e.contesta(ANA, { texto: 'zzz' }));
    const r = await nuevos(ANA, () => e.contesta(ANA, { texto: '2' }));
    expect(r.at(-1)).toMatch(/te atiende una persona/);
    // En ningún momento salió «Cotizar envío» a este cliente.
    expect(e.botonesA(ANA).flatMap((b) => b.buttons.map((x) => x.title))).not.toContain('Cotizar envío');
  });

  it('6. después de la 1:00 PM: «me equivoqué» → que coordine con el motorizado, y el pin no se registra', async () => {
    e.avanzar(5 * 60); // ~14:0x en Lima
    const r = await nuevos(ANA, () => e.contesta(ANA, { texto: 'me equivoqué de ubicación' }));
    expect(r.at(-1)).toMatch(/después de la 1:00 PM, por favor comunícate directamente con el motorizado.*999 ?888 ?777/);
    const r2 = await nuevos(ANA, () => e.contesta(ANA, { pin: { lat: -12.08, lng: -77.087 } }));
    expect(r2.at(-1)).toMatch(/comunícate directamente con el motorizado/);
    expect((await e.entrega('GSG-A-1001'))?.lat).toBeCloseTo(-12.079, 5);
  });
});

// ------------------------------- «Solo lo de GSG»: variantes y el caso de Diego Paz

describe('«Solo lo de GSG»: variantes del cambio y el cliente que escribe antes de que se le pregunte', () => {
  let e: EscenarioEntregas;
  let gsg: GsgFalso;
  const BRUNO = '987600002';
  const DIEGO = '987600003';
  const EN_CERCADO = { lat: -12.0464, lng: -77.0308 };
  const nuevos = async (tel: string, accion: () => Promise<unknown>): Promise<string[]> => {
    const a = e.textosA(tel).length;
    await accion();
    await e.trabajar();
    return e.textosA(tel).slice(a);
  };

  beforeAll(async () => {
    gsg = await crearGsgFalso({
      token: 'token-de-gsg',
      lista: {
        faltaUbicacion: [{ tracking: 'GSG-A-1002', telefono: BRUNO, nombre: 'Bruno Salas', direccion: 'Jr. Huallaga 320', distrito: 'Cercado de Lima' }],
        faltaConfirmacion: [{ tracking: 'GSG-A-2002', telefono: DIEGO, nombre: 'Diego Paz', direccion: 'Calle Las Begonias 415', distrito: 'San Isidro' }],
      },
    });
    e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true, confirmarLista: true });
    await e.conexionGsg.conectarReal({ url: gsg.url, token: gsg.token });
    await e.api.post('/admin/entregas/sincronizar');
    await e.api.post('/admin/entregas/confirmar-envio', { todos: true });
  });
  afterAll(async () => {
    await e?.cerrar();
    await gsg?.cerrar();
  });

  it('Diego escribe «Sí» antes de que se le pregunte: no se le contesta y queda dicho en su pedido', async () => {
    // Todavía no trabajó el motor: a Diego aún no le salió la pregunta.
    expect(e.textosA(DIEGO)).toEqual([]);
    await e.contesta(DIEGO, { texto: 'Sí' });
    expect(e.textosA(DIEGO)).toEqual([]);
    const fila = await e.entrega('GSG-A-2002');
    const evs = await e.repos.entregas.eventos(fila!.id, 100);
    expect(evs.some((x) => /escribió antes de que el sistema le preguntara si recibe hoy/.test(x.detalle ?? ''))).toBe(true);
    expect(fila?.confirmacionEstado).not.toBe('confirmada');
  });

  // Segundos después del primer «Sí»: antes se tomaba por copia del primero
  // (la regla de las acciones repetidas) y se perdía sin respuesta.
  it('luego le llega la pregunta en su turno y su «Sí» sí confirma (no es una copia del primero)', async () => {
    await e.trabajar();
    expect(e.botonesA(DIEGO).at(-1)?.buttons.map((b) => b.title)).toEqual(['Sí, recibo hoy', 'No']);
    const r = await nuevos(DIEGO, () => e.contesta(DIEGO, { texto: 'Sí' }));
    expect(r.join('\n')).toMatch(/confirmado/);
    expect((await e.entrega('GSG-A-2002'))?.confirmacionEstado).toBe('confirmada');
  });

  it('Bruno: pin → registrada; «esa no es mi ubicación» → que mande la nueva; pin → «se ha registrado»', async () => {
    const r = await nuevos(BRUNO, () => e.contesta(BRUNO, { pin: EN_CERCADO }));
    expect(r.some((t) => t.includes('Ubicación registrada correctamente')), r.join('\n---\n')).toBe(true);
    for (const texto of ['esa no es mi ubicación', 'me equiboque de ubicasion', 'la mandé mal']) {
      expect(await nuevos(BRUNO, () => e.contesta(BRUNO, { texto })), texto).toEqual([PIDE_LA_NUEVA]);
    }
    const r2 = await nuevos(BRUNO, () => e.contesta(BRUNO, { pin: { lat: EN_CERCADO.lat + 0.003, lng: EN_CERCADO.lng + 0.003 } }));
    expect(r2.some((t) => /Tu nueva ubicación se ha registrado correctamente/.test(t)), r2.join('\n---\n')).toBe(true);
  });
});
