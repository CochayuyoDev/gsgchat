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
import { responder, siguienteCampo, intencionDe, BOTON, type Contexto } from '../src/preventa/flow.js';
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
    dice(texto: string, extra: { ubicacion?: { lat: number; lng: number } } = {}) {
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
    expect(c.dice('Santa Anita')?.texto).toContain('a que distrito');
    expect(c.dice('Miraflores')?.texto).toContain('Que vas a enviar');
    expect(c.dice('Una caja de documentos')?.texto).toContain('Para cuando');
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
    expect(c.dice('Surco')?.texto).toContain('Que vas a enviar');
    expect(c.ficha.recojoDistrito).toBe('Santa Anita');
    expect(c.ficha.entregaDistrito).toBe('Surco');
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
    expect(c.dice('sigo aqui')?.texto).toContain('Para cuando');
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
