/**
 * Cómo se leen las respuestas: un banco de frases de clientes ("sí", "ya no",
 * "mañana", cosas raras) y de motorizados ("40", "media hora", "a las 4",
 * "no puedo"), con reglas y con la IA de mentira.
 */

import { describe, expect, it } from 'vitest';
import { extraerJson, leerConfirmacion, leerConfirmacionConReglas, leerEntregado, leerEntregadoConReglas, leerPreguntaPorPedido, leerTiempo, leerTiempoConReglas, normalizar, quitarReferencias, type LectorIA, leerMotorizadoCorta } from '../src/entregas/interpretar.js';
import { distanciaEnPalabras, haversineKm } from '../src/entregas/geo.js';
import { minutosEnPalabras, rellenar, textoDe, AJUSTES_ENTREGAS_POR_DEFECTO } from '../src/entregas/textos.js';

const iaQueDice = (...respuestas: string[]): LectorIA & { llamadas: number } => {
  const cola = [...respuestas];
  const lector = {
    llamadas: 0,
    async completar() {
      lector.llamadas++;
      const r = cola.shift();
      if (r === undefined) throw new Error('sin respuesta');
      return r;
    },
  };
  return lector;
};

describe('normalizar', () => {
  it('quita tildes y signos, y conserva las horas', () => {
    expect(normalizar('¡Sí, claro! ¿A las 4:30?')).toBe('si claro a las 4h30');
    expect(normalizar('  MAÑANA   mejor... ')).toBe('manana mejor');
  });
});

describe('la confirmación con reglas', () => {
  const si = ['si', 'Sí', 'SÍ', 'sii', 'ok', 'Ok dale', 'confirmo', 'Confirmado', 'claro', 'sí, confirmo', 'Sí por favor', 'de acuerdo', 'correcto', 'listo', 'lo espero', 'manden nomás', 'sí, ¿a qué hora llegan?', '👍', '✅', 'sí gracias', 'ya', 'bueno', 'está bien', 'siempre sí', 'yes', 'afirmativo', 'sí, aquí estaré'];
  for (const t of si) {
    it(`"${t}" es un sí`, () => {
      expect(leerConfirmacionConReglas(t).decision).toBe('si');
    });
  }

  const no = ['no', 'No', 'ya no', 'ya no lo quiero', 'No, ya no lo quiero', 'cancelen', 'cancelar', 'anulen el pedido', 'no gracias', 'no lo quiero', 'no pedí nada', 'no soy yo', 'se equivocaron', 'número equivocado', 'no me interesa', 'ya lo compré en otro lado', 'no manden nada', '👎', '❌', 'negativo', 'nop'];
  for (const t of no) {
    it(`"${t}" es un no`, () => {
      expect(leerConfirmacionConReglas(t).decision).toBe('no');
    });
  }

  const cambio = ['mañana', 'mañana mejor', 'mejor otro día', 'más tarde', 'hoy no voy a estar', 'sí pero mañana', 'a otra dirección por favor', 'en la tarde mejor', 'reprogramar', 'el sábado', 'no estaré en casa hoy', 'sí, pero a mi oficina'];
  for (const t of cambio) {
    it(`"${t}" pide un cambio`, () => {
      expect(leerConfirmacionConReglas(t).decision).toBe('cambio');
    });
  }

  const noClaro = ['no sé', 'no entiendo', '¿quién habla?', '¿qué pedido?', 'cuánto es', 'a qué hora', 'depende', 'ya veremos', 'bueno ya veremos', 'no me han dicho el precio todavía', 'hola', 'gracias', 'creo que sí porque mi esposa va a estar en la casa toda la tarde y le puede recibir sin problema', 'si no llegan hoy cancelen', '¿si es a domicilio?', 'un momento te confirmo', 'lo consulto con mi esposo', ''];
  for (const t of noClaro) {
    it(`"${t}" no está claro`, () => {
      expect(leerConfirmacionConReglas(t).decision).toBe('no_claro');
    });
  }

  it('dice cómo lo leyó', () => {
    expect(leerConfirmacionConReglas('sí confirmo')).toMatchObject({ como: 'reglas', detalle: expect.stringContaining('confirma') });
    expect(leerConfirmacionConReglas('ya no lo quiero')).toMatchObject({ como: 'reglas', detalle: expect.stringContaining('ya no lo quiero') });
  });
});

describe('la confirmación con la IA', () => {
  it('lo que las reglas entienden no llega a la IA', async () => {
    const ia = iaQueDice('{"decision":"no","seguridad":1}');
    expect((await leerConfirmacion('sí', ia)).decision).toBe('si');
    expect(ia.llamadas).toBe(0);
  });

  it('lo dudoso lo lee la IA y se acepta con seguridad suficiente', async () => {
    const ia = iaQueDice('Claro: {"decision":"si","seguridad":0.85,"motivo":"quiere recibirlo"}');
    const r = await leerConfirmacion('creo que sí porque mi esposa va a estar en la casa toda la tarde', ia);
    expect(r).toMatchObject({ decision: 'si', como: 'ia', detalle: 'quiere recibirlo' });
  });

  it('un "no" de la IA con poca seguridad no cancela; un "si" flojo tampoco confirma', async () => {
    expect((await leerConfirmacion('uy es que hoy tengo una situación', iaQueDice('{"decision":"no","seguridad":0.5}'))).decision).toBe('no_claro');
    expect((await leerConfirmacion('uy es que hoy tengo una situación', iaQueDice('{"decision":"si","seguridad":0.3}'))).decision).toBe('no_claro');
    expect((await leerConfirmacion('uy es que hoy tengo una situación', iaQueDice('{"decision":"no","seguridad":0.9}'))).decision).toBe('no');
    expect((await leerConfirmacion('uy es que hoy tengo una situación', iaQueDice('{"decision":"cambio","seguridad":0.8}'))).decision).toBe('cambio');
  });

  it('si la IA falla o contesta basura, queda no claro (y no revienta)', async () => {
    expect((await leerConfirmacion('ehh', iaQueDice())).decision).toBe('no_claro');
    expect((await leerConfirmacion('ehh', iaQueDice('no tengo ni idea'))).decision).toBe('no_claro');
    expect((await leerConfirmacion('ehh', iaQueDice('{"decision":"borrar todo","seguridad":1}'))).decision).toBe('no_claro');
    expect((await leerConfirmacion('ehh', null)).decision).toBe('no_claro');
  });

  it('extraerJson saca el objeto aunque venga rodeado de texto', () => {
    expect(extraerJson('Aquí va: {"a":1} y ya')).toEqual({ a: 1 });
    expect(extraerJson('[1,2]')).toBeNull();
    expect(extraerJson('nada')).toBeNull();
  });
});

describe('el tiempo del motorizado con reglas', () => {
  const ahora = new Date('2026-09-21T19:30:00Z'); // 14:30 en Lima
  const casos: Array<[string, number]> = [
    ['40', 40],
    ['40 min', 40],
    ['40min', 40],
    ['45 minutos', 45],
    ['unos 25 minutitos', 25],
    ['en 15', 15],
    ['llego en 20', 20],
    ['10 m', 10],
    ['1 h', 60],
    ['1h', 60],
    ['una hora', 60],
    ['1h30', 90],
    ['1 h 15', 75],
    ['1:30', 90],
    ['2 horas', 120],
    ['1 hora 20 minutos', 80],
    ['media hora', 30],
    ['hora y media', 90],
    ['una hora y media', 90],
    ['hora y cuarto', 75],
    ['cuarto de hora', 15],
    ['20 a 30 min', 30],
    ['entre 30 y 40', 40],
    ['cuarenta minutos', 40],
    ['veinte', 20],
    ['P-1002 en 1h15', 75],
    ['a las 4', 90],
    ['llego a las 4:30', 120],
    ['a las 15:10', 40],
    ['tipo 3 pm', 30],
  ];
  for (const [texto, minutos] of casos) {
    it(`"${texto}" son ${minutos} minutos`, () => {
      const r = leerTiempoConReglas(texto, { ahora, timezone: 'America/Lima' });
      expect(r.rechaza).toBe(false);
      expect(r.minutos).toBe(minutos);
    });
  }

  const rechazos = ['no puedo', 'no llego', 'estoy muy lejos', 'no puedo, estoy lejos', 'que lo tome otro', 'hoy no trabajo', 'me quedé sin gasolina', 'no', 'estoy ocupado'];
  for (const t of rechazos) {
    it(`"${t}" es un no puedo`, () => {
      expect(leerTiempoConReglas(t, { ahora }).rechaza).toBe(true);
    });
  }

  const sinTiempo = ['ya voy', 'en camino', 'saliendo', 'ok', 'dale', 'listo', 'ya', '', 'a las 2'];
  for (const t of sinTiempo) {
    it(`"${t}" no dice cuánto`, () => {
      const r = leerTiempoConReglas(t, { ahora });
      expect(r.minutos).toBeNull();
      expect(r.rechaza).toBe(false);
    });
  }

  it('"no, 40 min" es un tiempo, no un rechazo', () => {
    expect(leerTiempoConReglas('no, 40 min', { ahora })).toMatchObject({ minutos: 40, rechaza: false });
  });
});

describe('el tiempo con la IA', () => {
  const ahora = new Date('2026-09-21T19:30:00Z');
  it('lee lo que las reglas no pudieron y redondea', async () => {
    const ia = iaQueDice('{"minutos":45.4,"rechaza":false,"seguridad":0.8,"motivo":"tráfico"}');
    expect(await leerTiempo('el tráfico está pesado, calcula cuarenta y pico', { ahora, ia })).toMatchObject({ minutos: 45, como: 'ia' });
  });
  it('un rechazo de la IA necesita seguridad; sin ella, se pregunta otra vez', async () => {
    expect((await leerTiempo('uff', { ahora, ia: iaQueDice('{"minutos":null,"rechaza":true,"seguridad":0.9}') })).rechaza).toBe(true);
    expect((await leerTiempo('uff', { ahora, ia: iaQueDice('{"minutos":null,"rechaza":true,"seguridad":0.4}') })).rechaza).toBe(false);
    expect((await leerTiempo('uff', { ahora, ia: iaQueDice('{"minutos":9999,"rechaza":false,"seguridad":0.9}') })).minutos).toBeNull();
    expect((await leerTiempo('uff', { ahora, ia: iaQueDice() })).minutos).toBeNull();
  });
  it('lo que ya se entiende no gasta un turno', async () => {
    const ia = iaQueDice('{"minutos":1}');
    expect((await leerTiempo('40', { ahora, ia })).minutos).toBe(40);
    expect(ia.llamadas).toBe(0);
  });
});

describe('los textos', () => {
  it('rellenan las variables y no dejan huecos feos', () => {
    expect(rellenar('Hola {nombre}, {pedido} de {negocio}', { nombre: 'Ana Quispe', pedido: 'P-1', negocio: 'Tienda' })).toBe('Hola Ana, P-1 de Tienda');
    expect(rellenar('Hola {nombre}, {pedido} de {negocio}', { nombre: null, pedido: null, negocio: 'Tienda' })).toBe('Hola, tu pedido de Tienda');
    expect(rellenar('Llega en {minutos} a las {hora}', { negocio: 'T', minutos: 100, hora: '15:40' })).toBe('Llega en 1 h 40 min a las 15:40');
  });
  it('el de la pantalla manda sobre el de siempre', () => {
    const ajustes = { ...AJUSTES_ENTREGAS_POR_DEFECTO, textos: { ...AJUSTES_ENTREGAS_POR_DEFECTO.textos, confirmada: 'Listo {nombre}, {pedido} va hoy.' } };
    expect(textoDe('confirmada', ajustes, { nombre: 'Luis', pedido: 'P-2', negocio: 'T' })).toBe('Listo Luis, P-2 va hoy.');
    expect(textoDe('cancelada', ajustes, { nombre: 'Luis', pedido: 'P-2', negocio: 'T' })).toContain('P-2 sin entregar por hoy');
  });
  it('minutos en palabras', () => {
    expect(minutosEnPalabras(45)).toBe('45 min');
    expect(minutosEnPalabras(60)).toBe('1 h');
    expect(minutosEnPalabras(100)).toBe('1 h 40 min');
    expect(minutosEnPalabras(0)).toBe('0 min');
  });
});

describe('el tiempo con el número de pedido delante', () => {
  it('"P-1002 40" son 40 minutos: la referencia no es un tiempo', () => {
    expect(quitarReferencias('P-1002 40').trim()).toBe('40');
    expect(leerTiempoConReglas('P-1002 40').minutos).toBe(40);
    expect(leerTiempoConReglas('E-2007 25 min').minutos).toBe(25);
    expect(leerTiempoConReglas('Y-4 media hora').minutos).toBe(30);
    expect(leerTiempoConReglas('GSG12345 en 15').minutos).toBe(15);
    // Sin referencia, todo sigue igual.
    expect(leerTiempoConReglas('1h30').minutos).toBe(90);
    expect(leerTiempoConReglas('40').minutos).toBe(40);
  });
});

describe('entregado, con reglas', () => {
  const ENTREGADO = ['entregado', 'Entregada ✅', 'ya entregué', 'ya le entregué', 'ya le di', 'ya lo tiene', 'recibido', 'lo recibió la señora', 'listo entregado', 'entregado P-1001', 'hecho, entregado', 'done', 'delivered', 'ya quedó entregado', 'lo dejé en recepción', 'pedido entregado ok'];
  const NO_ENTREGADO = ['no estaba', 'no estaba nadie', 'no había nadie', 'no pude entregar', 'no me abrieron', 'no lo quiso', 'lo rechazaron', 'me regresé con el pedido', 'no encontré la dirección', 'dirección equivocada', 'no entregado', 'no pude llegar'];
  const FLOJOS = ['listo', 'ya', 'ok', 'hecho', 'ya está', '👍', '✅'];
  const NADA = ['voy en camino', 'hay tráfico', 'en 10 llego', 'dónde es?', 'el cliente no contesta el celular pero sigo esperando', 'ya casi', 'estoy en la puerta'];

  it.each(ENTREGADO)('"%s" es entregado', (t) => {
    const l = leerEntregadoConReglas(t);
    expect(l.entregado).toBe(true);
    expect(l.noEntregado).toBe(false);
  });
  it.each(NO_ENTREGADO)('"%s" es NO entregado', (t) => {
    const l = leerEntregadoConReglas(t);
    expect(l.noEntregado).toBe(true);
    expect(l.entregado).toBe(false);
  });
  it.each(FLOJOS)('"%s" es un entregado flojo (solo vale sin otro pedido esperando su tiempo)', (t) => {
    const l = leerEntregadoConReglas(t);
    expect(l.flojo).toBe(true);
    expect(l.entregado).toBe(false);
  });
  it.each(NADA)('"%s" no dice nada de entregar', (t) => {
    const l = leerEntregadoConReglas(t);
    expect(l.entregado).toBe(false);
    expect(l.noEntregado).toBe(false);
    expect(l.flojo).toBe(false);
  });
  it('"no entregado" gana a "entregado" aunque contenga la palabra', () => {
    expect(leerEntregadoConReglas('no entregado, no había nadie').noEntregado).toBe(true);
    expect(leerEntregadoConReglas('no pude entregar el pedido').noEntregado).toBe(true);
  });
});

describe('entregado, con la IA', () => {
  it('lo claro no llama a la IA; lo raro sí, y solo se acepta con seguridad', async () => {
    const ia = iaQueDice('{"entregado":true,"problema":"","seguridad":0.9}', '{"entregado":false,"problema":"reja cerrada","seguridad":0.8}', '{"entregado":true,"problema":"","seguridad":0.4}', 'bla bla');
    expect((await leerEntregado('entregado', ia)).como).toBe('reglas');
    expect(ia.llamadas).toBe(0);
    const si = await leerEntregado('ya quedó todo ok con la señora', ia);
    expect(si).toMatchObject({ entregado: true, como: 'ia' });
    const no = await leerEntregado('llegué pero hay una reja con candado', ia);
    expect(no).toMatchObject({ noEntregado: true, como: 'ia', detalle: 'reja cerrada' });
    const flojo = await leerEntregado('creo que ya', ia);
    expect(flojo.entregado).toBe(false);
    expect(flojo.noEntregado).toBe(false);
    const basura = await leerEntregado('mmm', ia);
    expect(basura.entregado).toBe(false);
    expect(basura.detalle).toMatch(/no lo vio claro/);
    // Sin IA o con la IA caída, nada.
    expect((await leerEntregado('mmm', null)).entregado).toBe(false);
    expect((await leerEntregado('mmm', iaQueDice())).detalle).toBe('la IA no respondió');
  });
});

describe('¿dónde está mi pedido?', () => {
  const PREGUNTA = ['dónde está mi pedido?', 'a qué hora llega', 'ya viene?', 'cuánto falta', 'y mi pedido', 'hola, a que hora me llega', 'cuándo llega', 'sigue en camino?', 'ya salió mi pedido', 'por dónde va', 'Hola buenas, mi pedido?'];
  const NO_LLEGO = ['no ha llegado', 'todavía no llega', 'no me llegó nada', 'nadie vino', 'ya pasó la hora y no llega', 'sigo esperando', 'no vino nadie', 'aún no me llega'];
  const NADA = ['hola', 'gracias', 'quiero otro producto', 'cuánto cuesta el envío', 'buenas tardes', 'sí', 'no', 'mañana mejor'];
  it.each(PREGUNTA)('"%s" pregunta por el pedido', (t) => {
    expect(leerPreguntaPorPedido(t)).toEqual({ pregunta: true, noLlego: false });
  });
  it.each(NO_LLEGO)('"%s" dice que no llegó (y es pregunta)', (t) => {
    expect(leerPreguntaPorPedido(t)).toEqual({ pregunta: true, noLlego: true });
  });
  it.each(NADA)('"%s" no pregunta por el pedido', (t) => {
    expect(leerPreguntaPorPedido(t).pregunta).toBe(false);
  });
});

describe('lo corto que dice un motorizado: cerca, sin moto, ruta', () => {
  const CERCA = ['cerca', 'estoy cerca', 'ya estoy cerca', 'llegando', 'ya llego', 'estoy afuera', 'ya estoy en la puerta', 'estoy abajo', 'a dos cuadras', 'voy llegando, P-1002', 'ya casi llego'];
  const SIN_MOTO = ['me quedo sin moto', 'se me malogró la moto', 'tuve un accidente', 'accidente, no puedo seguir', 'me chocaron', 'se me pinchó la llanta', 'no puedo seguir trabajando', 'me retiro por hoy', 'tengo una emergencia', 'me siento mal, no puedo continuar'];
  const RUTA = ['ruta', 'mi ruta', 'ruta de hoy', 'qué llevo', 'mis pedidos', 'por dónde empiezo', 'en qué orden'];
  const NADA = ['40', 'entregado', 'listo', 'no estaba nadie', 'no puedo', 'no estoy cerca todavía', 'estoy lejos', 'ya voy', 'ya estoy en camino', 'hay tráfico', 'la ruta de siempre está cerrada por obras hoy', 'vi un accidente en la vía, llego en 20', 'me quedo aquí esperando al cliente'];
  it.each(CERCA)('"%s" es cerca', (t) => {
    expect(leerMotorizadoCorta(t)).toMatchObject({ cerca: true, sinMoto: false, pideRuta: false });
  });
  it.each(SIN_MOTO)('"%s" es quedarse sin moto (y manda sobre lo demás)', (t) => {
    expect(leerMotorizadoCorta(t)).toMatchObject({ sinMoto: true, cerca: false, pideRuta: false });
  });
  it.each(RUTA)('"%s" pide la ruta', (t) => {
    expect(leerMotorizadoCorta(t)).toMatchObject({ pideRuta: true, sinMoto: false, cerca: false });
  });
  it.each(NADA)('"%s" no es ninguna de las tres', (t) => {
    expect(leerMotorizadoCorta(t)).toEqual({ cerca: false, sinMoto: false, pideRuta: false });
  });
  it('"no puedo" sigue siendo el rechazo de UN pedido; "se me malogró la moto" ya no', () => {
    expect(leerTiempoConReglas('no puedo').rechaza).toBe(true);
    expect(leerMotorizadoCorta('no puedo').sinMoto).toBe(false);
    expect(leerMotorizadoCorta('se me malogró la moto').sinMoto).toBe(true);
  });
  it('la confirmación con reglas dice qué frase decidió', () => {
    expect(leerConfirmacionConReglas('ya no lo quiero').frase).toBe('ya no lo quiero');
    expect(leerConfirmacionConReglas('no').frase).toBe('no');
    expect(leerConfirmacionConReglas('mañana mejor').frase).toBe('manana');
    expect(leerConfirmacionConReglas('Sí, recibo hoy').frase).toBe('si');
  });
  it('la IA de "entregado" también puede decir que está cerca', async () => {
    const ia = iaQueDice('{"entregado":false,"cerca":true,"problema":"","seguridad":0.9}', '{"entregado":false,"cerca":true,"problema":"","seguridad":0.3}');
    expect(await leerEntregado('ya mero ahí, dos semáforos', ia)).toMatchObject({ cerca: true, entregado: false, noEntregado: false, como: 'ia' });
    const floja = await leerEntregado('mmm', ia);
    expect(floja.cerca).toBeFalsy();
  });
});

describe('distancias', () => {
  it('Lima centro a Callao son unos 12 km; el mismo punto es 0', () => {
    const lima = { lat: -12.0464, lng: -77.0428 };
    const callao = { lat: -12.0566, lng: -77.1181 };
    const km = haversineKm(lima, callao);
    expect(km).toBeGreaterThan(7.5);
    expect(km).toBeLessThan(9);
    expect(haversineKm(lima, lima)).toBe(0);
    // Miraflores a Cercado, unos 8-9 km.
    const miraflores = { lat: -12.1211, lng: -77.0301 };
    expect(haversineKm(miraflores, lima)).toBeGreaterThan(8);
    expect(haversineKm(miraflores, lima)).toBeLessThan(9);
    expect(distanciaEnPalabras(0.4)).toBe('a 400 m');
    expect(distanciaEnPalabras(2.34)).toBe('a 2,3 km');
  });
});
