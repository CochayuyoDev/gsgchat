/**
 * La conversacion de preventa, escenario a escenario.
 *
 * No se prueban funciones sueltas sino charlas enteras, porque los fallos de
 * un flujo conversacional no salen en el turno uno: salen en el cuatro, cuando
 * el bot vuelve a preguntar algo que el cliente ya contesto, o contesta dos
 * veces al mismo mensaje.
 *
 * Las dos invariantes que se comprueban en casi todos los casos:
 *
 *   1. un mensaje del cliente produce como mucho UNA respuesta;
 *   2. nada que ya se sepa se vuelve a preguntar.
 */

import { describe, expect, it } from 'vitest';
import {
  BOTON,
  intencionDe,
  pareceTecleoAlAzar,
  responder,
  respuestaValida,
  siguienteCampo,
  textoDePregunta,
  type Contexto,
} from '../src/preventa/flow.js';
import type { Lead, LeadPatch } from '../src/db/leads.js';
import { nuevaFicha } from './fakes-leads.js';

const CTX: Contexto = {
  negocio: 'GSG Courier',
  cobertura: 'todo Lima y Callao',
  saludo: 'Buenos dias',
  horario: 'lunes a sabado de 9:00 a 19:00',
};

/** Una charla: se le van pasando mensajes y va acumulando la ficha. */
function conversacion(inicial: Partial<Lead> = {}) {
  let lead: Lead = nuevaFicha('c1', inicial);
  const dichos: string[] = [];
  let primer = true;

  return {
    get ficha() {
      return lead;
    },
    get todo() {
      return dichos;
    },
    /** Un turno. Devuelve lo que contesto el bot, o null si se callo. */
    dice(texto: string, extra: { ubicacion?: { lat: number; lng: number }; adjunto?: boolean } = {}) {
      const { patch, respuesta } = responder(
        lead,
        { texto, esPrimerMensaje: primer, ...extra },
        CTX,
      );
      primer = false;
      lead = { ...lead, ...(patch as Partial<Lead>) };
      if (respuesta) dichos.push(respuesta.texto);
      return respuesta ?? null;
    },
  };
}

describe('escenario: el cliente escribe "hola" y llega hasta el final', () => {
  it('la charla completa, sin repetir ni encadenar mensajes', () => {
    const c = conversacion();

    // 1. Se presenta la tienda. Una sola cosa, con el menu.
    const bienvenida = c.dice('hola');
    expect(bienvenida?.texto).toContain('GSG Courier');
    expect(bienvenida?.texto).toContain('Buenos dias');
    expect(bienvenida?.texto).toContain('todo Lima y Callao');
    expect(bienvenida?.botones).toHaveLength(3);

    // 2. Responde con el numero de la opcion, que es lo que va a hacer la
    //    gente sin botones nativos.
    expect(c.dice('1')?.texto).toContain('distrito');

    // 3. El cuestionario, en orden y sin repetirse.
    expect(c.dice('Santa Anita')?.texto).toContain('a qué distrito');
    expect(c.dice('Miraflores')?.texto).toContain('Qué vas a enviar');
    expect(c.dice('Una caja de documentos')?.texto).toContain('Para cuándo');
    expect(c.dice('Hoy')?.texto).toContain('nombre');
    expect(c.dice('Roberto Ramirez')?.texto).toContain('DNI');

    // 4. El cierre: resumen y a manos de una persona.
    const cierre = c.dice('45678912');
    expect(cierre?.texto).toContain('Recojo: Santa Anita');
    expect(cierre?.texto).toContain('Entrega: Miraflores');
    expect(cierre?.texto).toContain('Roberto Ramirez');
    expect(c.ficha.estado).toBe('calificado');

    // 5. Y a partir de ahi el bot se calla: manda la persona.
    expect(c.dice('gracias')).toBeNull();
    expect(c.dice('sigo ahi?')).toBeNull();
  });

  it('cada mensaje del cliente produjo exactamente una respuesta', () => {
    const c = conversacion();
    const mensajes = ['hola', '1', 'Santa Anita', 'Miraflores', 'Documentos', 'Hoy', 'Roberto', '45678912'];
    for (const m of mensajes) c.dice(m);
    expect(c.todo).toHaveLength(mensajes.length);
  });
});

describe('escenario: el cliente va directo al grano', () => {
  it('"cuanto cuesta" entra a cotizar sin pasar por el menu', () => {
    const c = conversacion();
    expect(c.dice('cuanto cuesta un envio?')?.texto).toContain('distrito');
    expect(c.ficha.estado).toBe('en_conversacion');
  });

  it('pedir asesor corta la conversacion en cualquier punto', () => {
    const c = conversacion();
    c.dice('hola');
    c.dice('1');
    c.dice('Santa Anita');

    const salida = c.dice('mejor quiero hablar con una persona');
    expect(salida?.texto).toContain('una persona del equipo');
    expect(c.ficha.estado).toBe('calificado');
    // Lo que ya habia contestado no se pierde: el asesor lo necesita.
    expect(c.ficha.recojoDistrito).toBe('Santa Anita');
  });

  it('preguntar por horarios no saca al cliente de donde estaba', () => {
    const c = conversacion();
    c.dice('hola');
    c.dice('1');
    c.dice('Santa Anita');

    const info = c.dice('cual es su horario?');
    expect(info?.texto).toContain('lunes a sabado');
    expect(info?.texto).toContain('todo Lima y Callao');

    // Y al volver, sigue por donde iba: no vuelve a preguntar el recojo.
    expect(c.dice('Surco')?.texto).toContain('Qué vas a enviar');
    expect(c.ficha.recojoDistrito).toBe('Santa Anita');
    // Se guarda el nombre canonico: quien escribe "Surco" queda como
    // "Santiago de Surco", que es como se llama y como se puede contar.
    expect(c.ficha.entregaDistrito).toBe('Santiago de Surco');
  });
});

describe('escenario: comparte la ubicacion en vez de escribir', () => {
  it('la primera ubicacion es el recojo, la segunda la entrega', () => {
    const c = conversacion();
    c.dice('hola');
    c.dice('1');

    const tras = c.dice('', { ubicacion: { lat: -12.0577, lng: -76.9699 } });
    expect(tras?.texto).toContain('recojo');
    expect(c.ficha.recojoLat).toBeCloseTo(-12.0577, 4);

    c.dice('Santa Anita');
    const tras2 = c.dice('', { ubicacion: { lat: -12.1211, lng: -77.0296 } });
    expect(tras2?.texto).toContain('entrega');
    expect(c.ficha.entregaLat).toBeCloseTo(-12.1211, 4);
  });
});

describe('escenario: el cliente ya dijo cosas antes', () => {
  it('no se le vuelve a preguntar lo que ya esta en la ficha', () => {
    const c = conversacion({
      estado: 'en_conversacion',
      recojoDistrito: 'Ate',
      entregaDistrito: 'San Isidro',
      contenido: 'Un sobre',
    });

    // Salta las tres primeras y va directo a "cuando".
    expect(c.dice('sigo aqui')?.texto).toContain('Para cuándo');
  });

  it('una ficha ya completa se cierra en el primer turno', () => {
    const c = conversacion({
      estado: 'en_conversacion',
      recojoDistrito: 'Ate',
      entregaDistrito: 'San Isidro',
      contenido: 'Un sobre',
      cuando: 'Hoy',
      nombre: 'Ana',
      documentoNumero: '12345678',
    });

    const cierre = c.dice('hola?');
    expect(cierre?.texto).toContain('Esto es lo que tengo');
    expect(c.ficha.estado).toBe('calificado');
  });
});

describe('el orden en que se pregunta', () => {
  it('primero de donde a donde, y los datos personales al final', () => {
    const vacia = nuevaFicha('c1');
    expect(siguienteCampo(vacia)).toBe('recojo');
    expect(siguienteCampo({ ...vacia, recojoDistrito: 'Ate' })).toBe('entrega');
    expect(siguienteCampo({ ...vacia, recojoDistrito: 'Ate', entregaDistrito: 'Surco' })).toBe(
      'contenido',
    );
  });

  it('una ficha completa no tiene siguiente campo', () => {
    const completa: Lead = {
      ...nuevaFicha('c1'),
      recojoDistrito: 'Ate',
      entregaDistrito: 'Surco',
      contenido: 'Sobre',
      cuando: 'Hoy',
      nombre: 'Ana',
      documentoNumero: '123',
    };
    expect(siguienteCampo(completa)).toBeNull();
  });

  it('los espacios en blanco no cuentan como respondido', () => {
    expect(siguienteCampo({ ...nuevaFicha('c1'), recojoDistrito: '   ' })).toBe('recojo');
  });
});

describe('leer lo que responde el cliente', () => {
  const entrada = (texto: string) => ({ texto, esPrimerMensaje: false });

  it('un numero se lee contra las opciones del mensaje anterior', () => {
    const ofrecidas = [BOTON.cotizar, BOTON.info, BOTON.asesor];
    expect(intencionDe(entrada('2'), ofrecidas)).toBe(BOTON.info);
    expect(intencionDe(entrada('3.'), ofrecidas)).toBe(BOTON.asesor);
  });

  it('sin opciones anteriores, un numero suelto no significa nada', () => {
    expect(intencionDe(entrada('2'), null)).toBeNull();
  });

  it('un numero fuera de rango tampoco', () => {
    expect(intencionDe(entrada('9'), [BOTON.cotizar])).toBeNull();
  });

  it('el boton pulsado manda sobre el texto', () => {
    expect(intencionDe({ texto: 'horarios', esPrimerMensaje: false, botonId: BOTON.cotizar })).toBe(
      BOTON.cotizar,
    );
  });

  it('las palabras sueltas llevan a la misma intencion que el boton', () => {
    expect(intencionDe(entrada('quiero cotizar'))).toBe(BOTON.cotizar);
    expect(intencionDe(entrada('a que hora abren'))).toBe(BOTON.info);
    expect(intencionDe(entrada('me pasas con un asesor'))).toBe(BOTON.asesor);
  });

  it('sin acentos y en mayusculas se entiende igual', () => {
    expect(intencionDe(entrada('CUÁNTO CUESTA'))).toBe(BOTON.cotizar);
  });
});

describe('la memoria de las opciones ofrecidas', () => {
  it('se guarda con cada mensaje que lleva opciones', () => {
    const { patch } = responder(nuevaFicha('c1'), { texto: 'hola', esPrimerMensaje: true }, CTX);
    expect((patch as LeadPatch).ultimasOpciones).toEqual([BOTON.cotizar, BOTON.info, BOTON.asesor]);
  });

  it('se limpia cuando el mensaje no lleva opciones', () => {
    const lead = nuevaFicha('c1', {
      estado: 'en_conversacion',
      ultimasOpciones: [BOTON.cotizar, BOTON.info, BOTON.asesor],
    });
    const { patch } = responder(lead, { texto: 'Santa Anita', esPrimerMensaje: false }, CTX);
    // La siguiente pregunta es abierta: un "2" despues no puede significar
    // "horarios" solo porque lo significara hace dos mensajes.
    expect((patch as LeadPatch).ultimasOpciones).toBeNull();
  });
});

describe('el bot se calla cuando toca', () => {
  it('con la ficha ya pasada al asesor', () => {
    for (const estado of ['calificado', 'enviado', 'descartado'] as const) {
      const c = conversacion({ estado });
      expect(c.dice('hola?')).toBeNull();
    }
  });

  it('un mensaje vacio no dispara nada', () => {
    const c = conversacion({ estado: 'en_conversacion' });
    // El primer turno pregunta el recojo; un vacio despues no repregunta.
    c.dice('empiezo');
    expect(c.dice('   ')).toBeNull();
  });
});


/**
 * Lo que pasa cuando el cliente no colabora.
 *
 * Es la mitad que decide si un bot sirve: una conversacion feliz la aguanta
 * cualquiera. Lo que se prueba aqui es que no se guarde basura en la ficha y
 * que el bot sepa retirarse en vez de insistir hasta que el cliente se va.
 */
describe('respuestas que no se entienden', () => {
  it('una sola letra no vale como distrito', () => {
    expect(respuestaValida('recojo', 'a')).toBe(false);
    expect(respuestaValida('recojo', 'Ate')).toBe(true);
  });

  it('un numero no vale como distrito ni como nombre', () => {
    expect(respuestaValida('recojo', '12345')).toBe(false);
    expect(respuestaValida('nombre', '2')).toBe(false);
  });

  it('solo emojis o signos no valen para nada', () => {
    for (const campo of ['recojo', 'entrega', 'contenido', 'nombre'] as const) {
      expect(respuestaValida(campo, '???')).toBe(false);
      expect(respuestaValida(campo, '👍')).toBe(false);
    }
  });

  it('el documento pide digitos, o un NO explicito', () => {
    expect(respuestaValida('documento', '45678912')).toBe(true);
    expect(respuestaValida('documento', '20-100-123-456')).toBe(true);
    expect(respuestaValida('documento', 'no')).toBe(true);
    expect(respuestaValida('documento', 'luego te digo')).toBe(false);
  });

  it('lo que no se entiende no se guarda: mejor hueco que basura', () => {
    const c = conversacion({ estado: 'en_conversacion' });
    c.dice('cotizar');

    const aviso = c.dice('???');
    expect(aviso?.texto).toContain('No reconocí');
    // Y repite la pregunta en el MISMO mensaje, no en otro aparte.
    expect(aviso?.texto).toContain('distrito');
    expect(c.ficha.recojoDistrito).toBeNull();
  });

  it('a la tercera deja de insistir y pasa a una persona', () => {
    const c = conversacion({ estado: 'en_conversacion' });
    c.dice('cotizar');

    expect(c.dice('???')?.texto).toContain('No reconocí');
    expect(c.dice('!!!')?.texto).toContain('No reconocí');

    const rendicion = c.dice('...');
    expect(rendicion?.texto).toContain('una persona del equipo');
    expect(c.ficha.estado).toBe('calificado');
  });

  it('una respuesta buena reinicia la cuenta de intentos', () => {
    const c = conversacion({ estado: 'en_conversacion' });
    c.dice('cotizar');
    c.dice('???');
    expect(c.ficha.intentosFallidos).toBe(1);

    c.dice('Santa Anita');
    expect(c.ficha.intentosFallidos).toBe(0);
    expect(c.ficha.recojoDistrito).toBe('Santa Anita');
  });
});

describe('cuando responde con un audio o una foto', () => {
  it('se le contesta: esta contestando, aunque no se pueda leer', () => {
    const c = conversacion({ estado: 'en_conversacion' });
    c.dice('cotizar');

    const respuesta = c.dice('', { adjunto: true });
    expect(respuesta?.texto).toContain('solo puedo leer texto');
    expect(respuesta?.texto).toContain('distrito');
  });

  it('un adjunto sin pregunta pendiente no dispara el aviso', () => {
    const c = conversacion({ estado: 'en_conversacion' });
    const respuesta = c.dice('', { adjunto: true });
    expect(respuesta?.texto ?? '').not.toContain('solo puedo leer texto');
  });

  it('insistir con audios acaba pasando a una persona', () => {
    const c = conversacion({ estado: 'en_conversacion' });
    c.dice('cotizar');
    c.dice('', { adjunto: true });
    c.dice('', { adjunto: true });
    expect(c.dice('', { adjunto: true })?.texto).toContain('una persona del equipo');
  });
});

describe('los textos los edita la tienda', () => {
  it('un mensaje reescrito manda sobre el de fabrica', () => {
    const { respuesta } = responder(
      nuevaFicha('c1'),
      { texto: 'hola', esPrimerMensaje: true },
      { ...CTX, mensajes: { bienvenida: 'Hola, somos {negocio} y llegamos a {cobertura}.' } },
    );

    expect(respuesta?.texto).toBe('Hola, somos GSG Courier y llegamos a todo Lima y Callao.');
  });

  it('las etiquetas de las opciones tambien', () => {
    const { respuesta } = responder(
      nuevaFicha('c1'),
      { texto: 'hola', esPrimerMensaje: true },
      { ...CTX, mensajes: { botonCotizar: 'Pedir precio' } },
    );

    expect(respuesta?.botones?.[0]?.title).toBe('Pedir precio');
  });

  it('un texto vacio vuelve al de fabrica, no manda un mensaje en blanco', () => {
    const { respuesta } = responder(
      nuevaFicha('c1'),
      { texto: 'hola', esPrimerMensaje: true },
      { ...CTX, mensajes: { bienvenida: '   ' } },
    );

    expect(respuesta?.texto).toContain('GSG Courier');
  });

  it('una variable que no existe se deja a la vista, para que se note el error', () => {
    const { respuesta } = responder(
      nuevaFicha('c1'),
      { texto: 'hola', esPrimerMensaje: true },
      { ...CTX, mensajes: { bienvenida: 'Precio desde {precio}' } },
    );

    expect(respuesta?.texto).toBe('Precio desde {precio}');
  });
});

describe('elegir servicio o courier', () => {
  const servicios = ['Express', 'Mismo dia', 'Programado'];

  it('con varios servicios se pregunta cual', () => {
    const lead = nuevaFicha('c1', {
      recojoDistrito: 'Ate',
      entregaDistrito: 'Surco',
      contenido: 'Sobre',
    });
    expect(siguienteCampo(lead, servicios)).toBe('servicio');
  });

  it('con uno solo no se pregunta: no hay nada que elegir', () => {
    const lead = nuevaFicha('c1', {
      recojoDistrito: 'Ate',
      entregaDistrito: 'Surco',
      contenido: 'Sobre',
    });
    expect(siguienteCampo(lead, ['Express'])).toBe('cuando');
    expect(siguienteCampo(lead, [])).toBe('cuando');
  });

  it('el numero elegido se guarda como el nombre del servicio', () => {
    const lead = nuevaFicha('c1', {
      estado: 'en_conversacion',
      recojoDistrito: 'Ate',
      entregaDistrito: 'Surco',
      contenido: 'Sobre',
      preguntaPendiente: 'servicio',
      ultimasOpciones: ['pv_serv_0', 'pv_serv_1', 'pv_serv_2'],
    });

    const { patch } = responder(lead, { texto: '3', esPrimerMensaje: false }, { ...CTX, servicios });
    expect((patch as LeadPatch).servicio).toBe('Programado');
  });
});

describe('repetir la pregunta que estaba en el aire', () => {
  it('textoDePregunta da el texto sin pasar por la conversacion', () => {
    // Lo usa el catalogo cuando contesta un precio a mitad del cuestionario:
    // dar el precio y dejar al cliente colgado le obliga a adivinar por donde
    // iban.
    expect(textoDePregunta('recojo', CTX)).toContain('distrito');
    expect(textoDePregunta('nombre', CTX)).toContain('nombre');
    expect(textoDePregunta('documento', CTX)).toContain('DNI');
  });

  it('respeta el texto que reescribio la tienda', () => {
    expect(textoDePregunta('recojo', { ...CTX, mensajes: { pedirRecojo: '¿Desde donde?' } })).toBe(
      '¿Desde donde?',
    );
  });

  it('un campo que no existe no revienta: devuelve vacio', () => {
    expect(textoDePregunta('inventado', CTX)).toBe('');
  });
});

describe('tecleo al azar', () => {
  it('un tramo de teclado no es una respuesta', () => {
    expect(pareceTecleoAlAzar('asdfgh qwerty')).toBe(true);
    expect(pareceTecleoAlAzar('zxcvbn')).toBe(true);
  });

  it('cuatro consonantes seguidas tampoco: en español no pasa', () => {
    expect(pareceTecleoAlAzar('jklmnp')).toBe(true);
  });

  it('los distritos de verdad pasan', () => {
    for (const distrito of [
      'Surco', 'Miraflores', 'San Borja', 'Villa El Salvador', 'Jesús María',
      'Callao', 'Santa Anita', 'Chorrillos', 'Independencia', 'Puente Piedra',
    ]) {
      expect(pareceTecleoAlAzar(distrito)).toBe(false);
    }
  });

  it('y los nombres tambien', () => {
    for (const nombre of ['Roberto Ramirez', 'Ana Torres', 'Luis Fernández', 'Ali Gomez']) {
      expect(pareceTecleoAlAzar(nombre)).toBe(false);
    }
  });

  it('no se guarda como respuesta a nada', () => {
    const c = conversacion({ estado: 'en_conversacion' });
    c.dice('cotizar');
    c.dice('asdfgh qwerty');
    expect(c.ficha.recojoDistrito).toBeNull();
  });
});
