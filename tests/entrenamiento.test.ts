/**
 * El entrenamiento del asistente a gran escala.
 *
 * Las piezas sueltas (texto, indice, aprender, importar, examen) se prueban
 * a secas; el servicio y sus rutas, con el servidor real, los repos en
 * memoria y un modelo de mentira. Lo que importa al negocio: que lo que se
 * le ensena llegue al prompt del turno (y solo lo que viene al caso), que de
 * un chat se aprenda lo que contesto una persona y no el propio asistente,
 * que un Excel de mil filas entre sin repetidas, que el examen diga si
 * respondio como se le enseno, y que un operador no pueda lo de un admin.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender, type Sender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService, type SettingsRepo } from '../src/settings/service.js';
import { crearServicioIA, type ServicioIA } from '../src/ia/servicio.js';
import type { MensajeIA, ProveedorIA } from '../src/ia/proveedores.js';
import { crearServicioEntrenamiento, iaParaEntrenar, leerJson, type ServicioEntrenamiento } from '../src/entrenamiento/servicio.js';
import { cifras, cifrasQueFaltan, cobertura, esGenerica, huellaDe, normalizar, palabras, raiz, similitud, taparDatosPersonales } from '../src/entrenamiento/texto.js';
import { Indice } from '../src/entrenamiento/indice.js';
import { paresDeConversacion } from '../src/entrenamiento/aprender.js';
import { leerImportacion } from '../src/entrenamiento/importar.js';
import { leerXlsx } from '../src/entrenamiento/xlsx.js';
import { calificarLeccion } from '../src/entrenamiento/examen.js';
import { crearClaveDePrueba, createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos, type FakeWhatsApp } from './fakes.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

// ------------------------------------------------------------------ texto
describe('texto', () => {
  it('normaliza y saca raices para que envio, envios y enviar sean lo mismo', () => {
    expect(normalizar('¿Cuánto CUESTA el Envío?')).toBe('cuanto cuesta el envio');
    expect(raiz('envios')).toBe(raiz('envio'));
    expect(raiz('zapatillas')).toBe(raiz('zapatilla'));
    expect(palabras('¿Cuánto cuesta el envío a Trujillo?')).toEqual(['cuant', 'cuest', 'envi', 'trujill']);
  });

  it('tapa telefonos, DNI, correos y tarjetas pero deja precios y tallas', () => {
    const t = taparDatosPersonales('Mi número es 987 654 321 y mi DNI 12345678, escríbeme a juan@mail.com. Talla 42, precio S/ 120, tarjeta 4111 1111 1111 1111. Precios: 120 130 140 150.');
    expect(t).toContain('[teléfono]');
    expect(t).toContain('[DNI]');
    expect(t).toContain('[correo]');
    expect(t).toContain('[tarjeta]');
    expect(t).toContain('Talla 42');
    expect(t).toContain('S/ 120');
    expect(t).toContain('120 130 140 150');
    expect(t).not.toContain('987');
    expect(taparDatosPersonales('llámame al +51 912 345 678')).toBe('llámame al [teléfono]');
    expect(taparDatosPersonales('el 51987654321 es mío')).toBe('el [teléfono] es mío');
  });

  it('cifras y cobertura: lo que hay que comprobar en un examen', () => {
    expect(cifras('Cuesta S/ 120,50 y llega en 2 a 3 días; abrimos de 9 a 19.')).toEqual(['120,50', '2', '3', '9', '19']);
    expect(cifrasQueFaltan('Llega en 2 a 3 días y cuesta S/ 15', 'Te llega en 2 o 3 días por S/ 15')).toEqual([]);
    expect(cifrasQueFaltan('Cuesta S/ 15', 'Cuesta S/ 20')).toEqual(['15']);
    expect(cobertura('Enviamos a todo el Perú en 2 a 3 días', 'Sí, hacemos envíos a todo el Perú, llegan en 2 a 3 días')).toBeGreaterThan(0.8);
    expect(cobertura('Enviamos a todo el Perú en 2 a 3 días', 'Gracias por escribirnos, ¿en qué te ayudo?')).toBeLessThan(0.2);
    // Con una falta de ortografia cuenta igual.
    expect(cobertura('zapatillas rojas', 'tenemos zapatiyas rojas')).toBe(1);
    expect(similitud('¿Hacen envíos a provincias?', 'hacen envio a provincia?')).toBeGreaterThan(0.6);
  });

  it('lo que no ensena nada no se aprende como pregunta', () => {
    for (const g of ['ok', 'Gracias!', 'si', '👍', 'Buenas tardes', 'jaja']) expect(esGenerica(g)).toBe(true);
    expect(esGenerica('¿tienen talla 42?')).toBe(false);
  });

  it('la huella no distingue tildes, mayusculas ni signos', () => {
    expect(huellaDe('¿Hacen envíos?', 'Sí, a todo el Perú.')).toBe(huellaDe('hacen envios', 'si a todo el peru'));
    expect(huellaDe('¿Hacen envíos?', 'Sí')).not.toBe(huellaDe('¿Hacen envíos?', 'No'));
  });
});

// ----------------------------------------------------------------- indice
describe('indice', () => {
  const idx = new Indice();
  beforeAll(() => {
    idx.agregar(1, '¿Hacen envíos a provincias? envios');
    idx.agregar(2, '¿Aceptan Yape o Plin? pagos');
    idx.agregar(3, '¿Tienen zapatillas en talla 42? stock');
    idx.agregar(4, '¿Cuál es el horario de atención? horario');
    idx.agregar(5, '¿Cuánto cuesta el envío a Trujillo? envios');
    for (let i = 100; i < 3000; i++) idx.agregar(i, `pregunta de relleno numero ${i} sobre el producto ${i % 17}`);
  });

  it('encuentra lo parecido aunque venga sin tildes, con faltas y con otra forma', () => {
    const r = idx.buscar('cuanto sale el envio a trujiyo', 3);
    expect(r[0]!.id).toBe(5);
    const s = idx.buscar('hacen envio a provincia?', 3).map((a) => a.id);
    expect(s[0]).toBe(1);
    expect(idx.buscar('aceptan yape', 3)[0]!.id).toBe(2);
    expect(idx.buscar('zapatiyas 42', 3)[0]!.id).toBe(3);
  });

  it('lo que no tiene nada que ver no se cuela por ser "lo mejor de lo malo"', () => {
    expect(idx.buscar('quiero devolver una plancha rota', 5).filter((a) => a.id < 100)).toEqual([]);
    expect(idx.buscar('xyzzy', 5)).toEqual([]);
  });

  it('quitar y volver a agregar', () => {
    idx.quitar(5);
    expect(idx.buscar('envio a trujillo', 3).map((a) => a.id)).not.toContain(5);
    idx.agregar(5, '¿Cuánto cuesta el envío a Trujillo? envios');
    expect(idx.buscar('envio a trujillo', 3)[0]!.id).toBe(5);
    expect(idx.tamano).toBe(2905);
  });

  it('es rapido con miles de lecciones', () => {
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) idx.buscar('cuanto cuesta el envio a provincias con yape', 8);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

// --------------------------------------------------------------- aprender
const m = (direction: 'in' | 'out', body: string, minuto: number, origen: string | null = null) => ({ direction, body, kind: 'text', createdAt: new Date(2026, 8, 10, 10, minuto), origen });

describe('aprender de una conversacion', () => {
  it('junta bloques, empareja pregunta con la respuesta de una persona y tapa lo personal', () => {
    const pares = paresDeConversacion([
      m('in', 'hola', 0),
      m('in', 'hacen envios a trujillo?', 1),
      m('out', 'Hola! Sí, enviamos a Trujillo.', 2),
      m('out', 'Llega en 2 días y cuesta S/ 15. Mi número es 987654321 por si acaso.', 3),
      m('in', 'ok gracias', 4),
      m('out', 'De nada, escríbenos cuando quieras.', 5),
      m('in', 'y aceptan yape?', 30),
      m('out', 'Sí, Yape y Plin.', 31, 'ia'),
      m('in', 'cuanto demora a lima', 40),
      m('out', 'Recordatorio: comparte tu ubicación.', 41, 'sistema'),
    ]);
    expect(pares).toHaveLength(1);
    expect(pares[0]!.pregunta).toBe('hola\nhacen envios a trujillo?');
    expect(pares[0]!.respuesta).toContain('Llega en 2 días y cuesta S/ 15');
    expect(pares[0]!.respuesta).toContain('[teléfono]');
    expect(pares[0]!.respuesta).not.toContain('987654321');
  });

  it('una respuesta demasiado tarde no es respuesta; lo que el negocio dice sin pregunta, tampoco', () => {
    const tarde = [m('in', 'precio del modelo negro?', 0), { ...m('out', 'S/ 120', 0), createdAt: new Date(2026, 8, 11, 10, 0) }];
    expect(paresDeConversacion(tarde)).toEqual([]);
    expect(paresDeConversacion([m('out', 'Hola, ¿sigues interesado?', 0), m('out', 'Tenemos oferta.', 1)])).toEqual([]);
    expect(paresDeConversacion([m('in', 'precio?', 0), m('out', 'S/', 1)])).toEqual([]);
  });
});

// --------------------------------------------------------------- importar
describe('importar', () => {
  it('una tabla con cabecera (pegada de Excel, con tabuladores)', () => {
    const l = leerImportacion({ texto: 'Pregunta\tRespuesta\tTema\n¿Hacen envíos?\tSí, a todo el Perú.\tenvios\n\tHorario de 9 a 19.\t\n¿Talla 44?\tHasta la 45.\t' });
    expect(l.formato).toBe('tabla');
    expect(l.filas).toHaveLength(3);
    expect(l.filas[0]).toMatchObject({ tipo: 'ejemplo', pregunta: '¿Hacen envíos?', respuesta: 'Sí, a todo el Perú.', tema: 'envios' });
    expect(l.filas[1]).toMatchObject({ tipo: 'dato', pregunta: null, respuesta: 'Horario de 9 a 19.' });
  });

  it('un CSV sin cabecera con comillas y saltos de linea dentro', () => {
    const l = leerImportacion({ texto: '"¿Hacen envíos?","Sí, a todo el Perú.\nLlega en 2 días."\n"¿Yape?","Sí"', nombre: 'lecciones.csv' });
    expect(l.formato).toBe('tabla');
    expect(l.filas).toHaveLength(2);
    expect(l.filas[0]!.respuesta).toBe('Sí, a todo el Perú.\nLlega en 2 días.');
    expect(l.avisos[0]).toContain('Sin cabecera');
  });

  it('un JSON con claves en espanol o en ingles', () => {
    const l = leerImportacion({ texto: JSON.stringify([{ pregunta: 'a?', respuesta: 'b b', tema: 'x' }, { question: 'c?', answer: 'd d' }, { tipo: 'regla', respuesta: 'Nunca prometas plazos exactos.' }, 'Un dato suelto.']) });
    expect(l.formato).toBe('json');
    expect(l.filas.map((f) => f.tipo)).toEqual(['ejemplo', 'ejemplo', 'regla', 'dato']);
  });

  it('un chat exportado de WhatsApp, sabiendo quien es el negocio', () => {
    const chat = [
      '12/3/26, 10:15 - Los mensajes están cifrados de extremo a extremo.',
      '12/3/26, 10:15 - María: hola, hacen envíos a Trujillo?',
      '12/3/26, 10:17 - Zapatería Lima: Hola María! Sí, enviamos a Trujillo: llega en 2 días y cuesta S/ 15.',
      '12/3/26, 10:18 - María: y aceptan yape?',
      '12/3/26, 10:19 - Zapatería Lima: Sí, Yape, Plin y transferencia.',
      '12/3/26, 10:20 - María: <Multimedia omitido>',
    ].join('\n');
    const sin = leerImportacion({ texto: chat });
    expect(sin.formato).toBe('whatsapp');
    expect(sin.autores).toContain('María');
    expect(sin.filas).toHaveLength(2);
    const con = leerImportacion({ texto: chat, yoSoy: 'Zapatería Lima' });
    expect(con.negocio).toBe('Zapatería Lima');
    expect(con.filas[0]).toMatchObject({ pregunta: 'hola, hacen envíos a Trujillo?' });
    expect(con.filas[0]!.respuesta).toContain('S/ 15');
    // Al reves: si el negocio fuera Maria, las "respuestas" serian sus preguntas.
    const alReves = leerImportacion({ texto: chat, yoSoy: 'María' });
    expect(alReves.filas[0]!.pregunta).toContain('Sí, enviamos a Trujillo');
  });

  it('un dialogo Cliente/Tu con tema', () => {
    const l = leerImportacion({ texto: 'Tema: envios\nCliente: hacen envíos?\nTú: Sí, a todo el Perú.\nCliente: y a provincias?\ncuánto demora\nTú: 2 a 3 días.\nTema: pagos\nCliente: yape?\nTú: Sí.' });
    expect(l.formato).toBe('dialogo');
    expect(l.filas).toHaveLength(3);
    expect(l.filas[1]).toMatchObject({ pregunta: 'y a provincias?\ncuánto demora', respuesta: '2 a 3 días.', tema: 'envios' });
    expect(l.filas[2]!.tema).toBe('pagos');
  });

  it('lineas sueltas: con flecha es un ejemplo, sin nada es un dato; una frase con comas no es una tabla', () => {
    const l = leerImportacion({ texto: '¿Hacen envíos? => Sí, a todo el Perú.\nEnvío gratis desde S/ 150 en Lima, Callao y alrededores.\nHorario | lunes a sábado' });
    expect(l.formato).toBe('lineas');
    expect(l.filas.map((f) => f.tipo)).toEqual(['ejemplo', 'dato', 'ejemplo']);
    expect(l.filas[1]!.respuesta).toContain('Lima, Callao');
  });

  it('un .xlsx de verdad', async () => {
    const datos = await readFile(path.join(FIXTURES, 'lecciones.xlsx'));
    const filas = leerXlsx(datos);
    expect(filas[0]).toEqual(['Pregunta', 'Respuesta', 'Tema']);
    expect(filas).toHaveLength(5);
    const l = leerImportacion({ datos, nombre: 'lecciones.xlsx' });
    expect(l.formato).toBe('excel');
    expect(l.filas).toHaveLength(4);
    expect(l.filas[0]).toMatchObject({ tipo: 'ejemplo', pregunta: '¿Hacen envíos a provincias?', tema: 'envios' });
    expect(l.filas[2]).toMatchObject({ tipo: 'dato', respuesta: 'Horario: lunes a sábado de 9 a 19.' });
  });

  it('lo vacio y lo que no se puede usar se explica', () => {
    expect(leerImportacion({ texto: '   ' }).formato).toBe('vacio');
    const l = leerImportacion({ texto: 'pregunta,respuesta\n¿algo?,\n¿otra?,x' });
    expect(l.descartadas).toHaveLength(2);
    expect(l.descartadas[0]!.motivo).toBe('sin respuesta');
  });
});

// ---------------------------------------------------------------- examen
describe('calificar una leccion', () => {
  const ctx = { conocimiento: 'Envíos a provincias 2 a 3 días, S/ 15.' };
  it('aprueba si dice los mismos datos con otras palabras', () => {
    const n = calificarLeccion('Sí, enviamos a provincias: llega en 2 a 3 días y cuesta S/ 15.', { texto: 'Claro, hacemos envíos a provincias. Suele llegar en 2 a 3 días y el costo es S/ 15.', derivar: false, pedirUbicacion: false }, ctx);
    expect(n.ok).toBe(true);
    expect(n.motivos).toEqual([]);
  });
  it('suspende si falta una cifra, si cambia un precio o si se va por otro lado', () => {
    expect(calificarLeccion('Cuesta S/ 15 y llega en 2 días.', { texto: 'Cuesta S/ 15.', derivar: false, pedirUbicacion: false }, ctx).motivos).toContain('faltó decir «2»');
    const otro = calificarLeccion('Cuesta S/ 15.', { texto: 'Cuesta S/ 20.', derivar: false, pedirUbicacion: false }, ctx);
    expect(otro.ok).toBe(false);
    expect(otro.motivos.some((x) => x.includes('no esta en lo que sabe'))).toBe(true);
    const lejos = calificarLeccion('Enviamos a provincias en 2 a 3 días.', { texto: 'Gracias por escribirnos, ¿me das tu nombre?', derivar: false, pedirUbicacion: false }, ctx);
    expect(lejos.ok).toBe(false);
    expect(lejos.motivos.some((x) => x.startsWith('se parece poco'))).toBe(true);
  });
  it('derivar cuando no toca (o no derivar cuando toca) suspende', () => {
    expect(calificarLeccion('Cuesta S/ 15.', { texto: 'Te paso con una persona.', derivar: true, pedirUbicacion: false }, ctx).motivos).toContain('pasó con una persona en vez de responder');
    expect(calificarLeccion('Eso lo revisa una persona del equipo. [DERIVAR]', { texto: 'Claro, ya está confirmado.', derivar: false, pedirUbicacion: false }, ctx).motivos).toContain('tenía que pasar con una persona y no lo hizo');
    expect(calificarLeccion('Eso lo revisa una persona del equipo. [DERIVAR]', { texto: 'Eso lo revisa una persona del equipo.', derivar: true, pedirUbicacion: false }, ctx).ok).toBe(true);
  });
  it('lee el JSON del modelo aunque venga con texto alrededor', () => {
    expect(leerJson('Aquí va:\n```json\n{"util": true, "tema": "envios"}\n```')).toEqual({ util: true, tema: 'envios' });
    expect(leerJson('no hay nada')).toBeNull();
  });
});

// ------------------------------------------------------------ con servidor
const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'none',
  BUSINESS_NAME: 'Zapateria Lima',
  BUSINESS_HOURS: 'lunes a sabado de 9 a 19',
  RUTAS_PAIS: 'peru',
} as NodeJS.ProcessEnv;

const queue: OutboundQueue = {
  async enqueue() {},
  async enqueueMany(jobs) {
    return jobs.length;
  },
  async pause() {},
  async resume() {},
  async counts() {
    return {};
  },
  async close() {},
};

const config = loadConfig(ENV);

/** Un modelo de mentira: contesta con una funcion que ve lo que recibe. */
function modeloFalso() {
  const recibido: MensajeIA[][] = [];
  const estado = { responder: (_m: MensajeIA[]): string | Promise<string> => 'Hola, ¿en qué te ayudo?' };
  const proveedor: ProveedorIA = {
    nombre: 'falso',
    async chat(mensajes) {
      recibido.push(mensajes);
      return estado.responder(mensajes);
    },
  };
  return { proveedor, recibido, estado };
}

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
let sender: Sender;
let settingsRepo: SettingsRepo;
let ia: ServicioIA;
let entrenamiento: ServicioEntrenamiento;
let modelo: ReturnType<typeof modeloFalso>;

async function build() {
  repos = createFakeRepos();
  wa = createFakeWhatsApp();
  sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false });
  settingsRepo = createMemorySettingsRepo();
  const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
  await settings.save({ provider: 'local' });
  modelo = modeloFalso();
  entrenamiento = await crearServicioEntrenamiento({ repo: repos.entrenamiento, nombreNegocio: () => 'Zapateria Lima', pausaMs: 0 });
  await entrenamiento.cargar();
  ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Zapateria Lima', proveedor: modelo.proveedor, modelosGratis: ['google/gemma-4-31b-it'], entrenamiento });
  await ia.guardar({ token: 'tok', activa: true, conocimiento: 'Somos una zapatería en Lima.' });
  entrenamiento.conectarIA(iaParaEntrenar(ia));
  return buildServer({ config, repos, settings, wa, sender, queue, logger: false, ia, entrenamiento });
}

beforeAll(async () => {
  app = await build();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.close();
  app = await build();
  await app.ready();
});

const galletaDe = (r: { headers: Record<string, unknown> }) => {
  const c = (r.headers['set-cookie'] as string | string[] | undefined) ?? '';
  return (Array.isArray(c) ? (c[0] ?? '') : c).split(';')[0]!;
};

/** Entra como una persona (cookie). La primera vez crea la cuenta admin; despues entra con ella. */
async function sesion(rol: 'admin' | 'operador' = 'admin'): Promise<Record<string, string>> {
  let primera = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { usuario: 'ali', nombre: 'Ali', clave: 'ali-2026-wa' } });
  if (primera.statusCode !== 200) primera = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ali', clave: 'ali-2026-wa' } });
  const galleta = galletaDe(primera);
  if (rol === 'admin') return { cookie: galleta, 'content-type': 'application/json' };
  const crear = await app.inject({ method: 'POST', url: '/admin/usuarios', headers: { cookie: galleta, 'content-type': 'application/json' }, payload: { usuario: 'ope', nombre: 'Operadora', clave: 'ope-2026-wa', rol: 'operador' } });
  expect([200, 409]).toContain(crear.statusCode);
  const entrar = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ope', clave: 'ope-2026-wa' } });
  return { cookie: galletaDe(entrar), 'content-type': 'application/json' };
}

/** Espera a que el trabajo de ese tipo deje de correr. */
async function esperarTrabajo(tipo: 'aprender' | 'pulir' | 'examen') {
  for (let i = 0; i < 400; i++) {
    const t = entrenamiento.trabajos().find((x) => x.tipo === tipo);
    if (t && t.estado !== 'corriendo') return t;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`el trabajo ${tipo} no termino`);
}

describe('ensenar y usar en el turno', () => {
  it('lo que se ensena va al prompt solo cuando viene al caso, y se anota su uso en un turno real', async () => {
    const h = await sesion();
    const r1 = await app.inject({ method: 'POST', url: '/admin/entrenamiento/lecciones', headers: h, payload: { tipo: 'ejemplo', pregunta: '¿Hacen envíos a Trujillo?', respuesta: 'Sí, enviamos a Trujillo: llega en 2 días y cuesta S/ 15.', tema: 'envios' } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ nueva: true, leccion: { estado: 'activa', origen: 'manual', creadoPor: expect.stringContaining('Ali') } });
    await app.inject({ method: 'POST', url: '/admin/entrenamiento/lecciones', headers: h, payload: { tipo: 'dato', respuesta: 'Aceptamos Yape, Plin y transferencia.', tema: 'pagos' } });
    await app.inject({ method: 'POST', url: '/admin/entrenamiento/lecciones', headers: h, payload: { tipo: 'regla', respuesta: 'Nunca prometas una fecha exacta de entrega.' } });
    // Repetida: no entra dos veces.
    const r2 = await app.inject({ method: 'POST', url: '/admin/entrenamiento/lecciones', headers: h, payload: { tipo: 'ejemplo', pregunta: 'hacen envios a trujillo', respuesta: 'Si, enviamos a Trujillo: llega en 2 dias y cuesta S/ 15', tema: 'envios' } });
    expect(r2.json().nueva).toBe(false);
    expect(entrenamiento.cargadas()).toBe(3);

    const c = await repos.contacts.upsertFromInbound('51987654321', 'Maria');
    await repos.contacts.setOptIn('51987654321', 'prueba');
    // Sobre envios: entra el ejemplo, la regla (siempre) y NO el dato de pagos.
    await ia.turno(c, 'cuanto cuesta el envio a trujillo?');
    const sistema = modelo.recibido.at(-1)![0]!.content;
    expect(sistema).toContain('Cliente: ¿Hacen envíos a Trujillo?');
    expect(sistema).toContain('cuesta S/ 15');
    expect(sistema).toContain('Nunca prometas una fecha exacta');
    expect(sistema).not.toContain('Yape, Plin');
    // Sobre pagos: el dato si, el ejemplo de envios no.
    await ia.turno(c, 'aceptan yape?');
    const s2 = modelo.recibido.at(-1)![0]!.content;
    expect(s2).toContain('Yape, Plin');
    expect(s2).not.toContain('Cliente: ¿Hacen envíos a Trujillo?');
    // El uso quedo anotado en las que fueron al prompt de un turno real.
    await new Promise((r) => setTimeout(r, 10));
    const lista = await repos.entrenamiento.listar({}, { limite: 10, offset: 0 });
    const ejemplo = lista.items.find((l) => l.tipo === 'ejemplo')!;
    const dato = lista.items.find((l) => l.tipo === 'dato')!;
    expect(ejemplo.usos).toBe(1);
    expect(dato.usos).toBe(1);
  });

  it('una pregunta corta se busca con lo anterior de la conversacion', async () => {
    await entrenamiento.ensenar({ tipo: 'ejemplo', pregunta: '¿Cuánto cuesta el envío a provincias?', respuesta: 'A provincias S/ 15.' }, { origen: 'manual' });
    const c = await repos.contacts.upsertFromInbound('51987654321', 'Maria');
    const r = await ia.responder({ contact: c, texto: 'y cuánto?', historial: [{ role: 'user', content: 'hacen envíos a provincias?' }, { role: 'assistant', content: 'Sí.' }] });
    expect(r.texto).toBeTruthy();
    expect(modelo.recibido.at(-1)![0]!.content).toContain('A provincias S/ 15');
  });

  it('una correccion desde el chat lleva lo que dijo mal y el prompt pide no repetirlo', async () => {
    const h = await sesion('operador');
    const r = await app.inject({ method: 'POST', url: '/admin/entrenamiento/lecciones', headers: h, payload: { tipo: 'ejemplo', pregunta: '¿Tienen talla 46?', respuesta: 'Solo hasta la 45; te aviso si entra la 46.', mala: 'Sí, tenemos todas las tallas.', origen: 'correccion', origenDetalle: 'Maria (51987654321)' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().leccion).toMatchObject({ origen: 'correccion', mala: 'Sí, tenemos todas las tallas.' });
    const p = await app.inject({ method: 'POST', url: '/admin/entrenamiento/probar', headers: h, payload: { texto: 'tienen la talla 46?' } });
    expect(p.json().ejemplos).toHaveLength(1);
    expect(p.json().prompt).toContain('No respondas así: «Sí, tenemos todas las tallas.»');
  });

  it('cambiar, descartar y borrar se reflejan al momento en lo que usa el turno', async () => {
    const h = await sesion();
    const { leccion } = await entrenamiento.ensenar({ tipo: 'ejemplo', pregunta: '¿Envían a Arequipa?', respuesta: 'Sí, en 3 días.' }, { origen: 'manual' });
    const cambio = await app.inject({ method: 'PATCH', url: `/admin/entrenamiento/lecciones/${leccion.id}`, headers: h, payload: { respuesta: 'Sí, en 4 días.' } });
    expect(cambio.statusCode).toBe(200);
    expect(entrenamiento.relevantes('envian a arequipa?').ejemplos[0]!.respuesta).toBe('Sí, en 4 días.');
    await app.inject({ method: 'PATCH', url: `/admin/entrenamiento/lecciones/${leccion.id}`, headers: h, payload: { estado: 'descartada' } });
    expect(entrenamiento.relevantes('envian a arequipa?').ejemplos).toEqual([]);
    await app.inject({ method: 'PATCH', url: `/admin/entrenamiento/lecciones/${leccion.id}`, headers: h, payload: { estado: 'activa' } });
    expect(entrenamiento.relevantes('envian a arequipa?').ejemplos).toHaveLength(1);
    // Un operador no borra.
    const ope = await sesion('operador');
    expect((await app.inject({ method: 'DELETE', url: `/admin/entrenamiento/lecciones/${leccion.id}`, headers: ope })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/admin/entrenamiento/lecciones/${leccion.id}`, headers: h })).statusCode).toBe(200);
    expect(entrenamiento.cargadas()).toBe(0);
  });

  it('un ejemplo sin pregunta no vale', async () => {
    const h = await sesion();
    const r = await app.inject({ method: 'POST', url: '/admin/entrenamiento/lecciones', headers: h, payload: { tipo: 'ejemplo', respuesta: 'algo' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('lo que dice el cliente');
  });
});

describe('importar en masa', () => {
  it('vista previa sin guardar, luego importar mil filas sin repetidas; un operador no importa', async () => {
    const h = await sesion();
    const filas = ['pregunta;respuesta;tema'];
    for (let i = 0; i < 1000; i++) filas.push(`¿Tienen el modelo ${i}?;Sí, el modelo ${i} está a S/ ${100 + (i % 50)}.;catalogo`);
    filas.push('¿Tienen el modelo 1?;Sí, el modelo 1 está a S/ 101.;catalogo');
    const texto = filas.join('\n');
    const previa = await app.inject({ method: 'POST', url: '/admin/entrenamiento/importar/previa', headers: h, payload: { texto } });
    expect(previa.statusCode).toBe(200);
    expect(previa.json()).toMatchObject({ formato: 'tabla', total: 1001, porTipo: { ejemplo: 1001 } });
    expect(previa.json().muestra).toHaveLength(20);
    expect((await repos.entrenamiento.cifras()).total).toBe(0);

    const ope = await sesion('operador');
    expect((await app.inject({ method: 'POST', url: '/admin/entrenamiento/importar', headers: ope, payload: { texto } })).statusCode).toBe(403);

    const r = await app.inject({ method: 'POST', url: '/admin/entrenamiento/importar', headers: h, payload: { texto, nombre: 'catalogo.csv' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ nuevas: 1000, repetidas: 1 });
    expect(entrenamiento.cargadas()).toBe(1000);
    expect(entrenamiento.relevantes('tienen el modelo 777?').ejemplos[0]!.respuesta).toContain('modelo 777');
    // Otra vez lo mismo: todo repetido.
    const r2 = await app.inject({ method: 'POST', url: '/admin/entrenamiento/importar', headers: h, payload: { texto } });
    expect(r2.json()).toMatchObject({ nuevas: 0, repetidas: 1001 });
    const lista = await app.inject({ method: 'GET', url: '/admin/entrenamiento/lecciones?origen=importado&q=modelo%20777&limite=10', headers: h });
    expect(lista.json().total).toBe(1);
    expect(lista.json().items[0]).toMatchObject({ origen: 'importado', origenDetalle: 'catalogo.csv' });
  });

  it('un Excel en base64, pendiente de revisar, y aprobar todas las pendientes', async () => {
    const h = await sesion();
    const base64 = (await readFile(path.join(FIXTURES, 'lecciones.xlsx'))).toString('base64');
    const r = await app.inject({ method: 'POST', url: '/admin/entrenamiento/importar', headers: h, payload: { base64, nombre: 'lecciones.xlsx', revisar: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ formato: 'excel', nuevas: 4 });
    expect(entrenamiento.cargadas()).toBe(0);
    const resumen = await app.inject({ method: 'GET', url: '/admin/entrenamiento', headers: h });
    expect(resumen.json().cifras.porEstado.pendiente).toBe(4);
    const lote = await app.inject({ method: 'POST', url: '/admin/entrenamiento/lecciones/lote', headers: h, payload: { accion: 'aprobar', estado: 'pendiente' } });
    expect(lote.json()).toMatchObject({ cuantas: 4 });
    expect(entrenamiento.cargadas()).toBe(4);
    expect(entrenamiento.relevantes('aceptan yape?').ejemplos[0]!.respuesta).toContain('Yape');
    // Sin filtro no se toca nada en masa.
    expect((await app.inject({ method: 'POST', url: '/admin/entrenamiento/lecciones/lote', headers: h, payload: { accion: 'borrar' } })).statusCode).toBe(400);
  });

  it('por la API, con el permiso ia:entrenar', async () => {
    const clave = await crearClaveDePrueba(repos, ['ia:entrenar']);
    const sin = await crearClaveDePrueba(repos, ['estado:leer']);
    const cab = (k: string) => ({ authorization: `Bearer ${k}`, 'content-type': 'application/json' });
    expect((await app.inject({ method: 'POST', url: '/api/v1/ia/lecciones', headers: cab(sin), payload: { pregunta: 'a?', respuesta: 'bb' } })).statusCode).toBe(403);
    const una = await app.inject({ method: 'POST', url: '/api/v1/ia/lecciones', headers: cab(clave), payload: { pregunta: '¿Envían a Cusco?', respuesta: 'Sí, en 3 días.', tema: 'envios' } });
    expect(una.statusCode).toBe(200);
    expect(una.json().leccion).toMatchObject({ origen: 'api', estado: 'activa' });
    const varias = await app.inject({ method: 'POST', url: '/api/v1/ia/lecciones', headers: cab(clave), payload: { lecciones: [{ pregunta: 'x?', respuesta: 'yy' }, { tipo: 'dato', respuesta: 'Horario 9 a 19.' }], revisar: true } });
    expect(varias.json()).toMatchObject({ nuevas: 2 });
    const lista = await app.inject({ method: 'GET', url: '/api/v1/ia/lecciones?estado=pendiente', headers: cab(clave) });
    expect(lista.json().total).toBe(2);
  });
});

describe('aprender de los chats', () => {
  it('saca lo que contesto una persona, no lo del asistente ni lo del sistema, y lo deja pendiente', async () => {
    const h = await sesion();
    const c = await repos.contacts.upsertFromInbound('51987654321', 'Maria');
    const g = await repos.contacts.upsertGrupo('123@g.us', 'Grupo');
    const t = (min: number) => new Date(2026, 8, 10, 10, min);
    await repos.messages.add({ contactId: c.id, direction: 'in', kind: 'text', body: 'hacen envios a trujillo?', createdAt: t(0) });
    await repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', body: 'Sí, enviamos a Trujillo: 2 días, S/ 15. Cualquier duda al 987654321.', createdAt: t(2) });
    await repos.messages.add({ contactId: c.id, direction: 'in', kind: 'text', body: 'aceptan yape?', createdAt: t(5) });
    await repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', body: 'Sí, Yape y Plin.', payload: { origen: 'ia' }, createdAt: t(6) });
    await repos.messages.add({ contactId: c.id, direction: 'in', kind: 'text', body: 'gracias', createdAt: t(7) });
    await repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', body: 'A ti, buen día.', payload: { origen: 'persona' }, createdAt: t(8) });
    await repos.messages.add({ contactId: g.id, direction: 'in', kind: 'text', body: 'en el grupo preguntan precios', createdAt: t(0) });
    await repos.messages.add({ contactId: g.id, direction: 'out', kind: 'text', body: 'En el grupo contestan.', createdAt: t(1) });

    const ope = await sesion('operador');
    expect((await app.inject({ method: 'POST', url: '/admin/entrenamiento/aprender', headers: ope, payload: {} })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/admin/entrenamiento/aprender', headers: h, payload: { revisar: true } });
    expect(r.statusCode).toBe(200);
    const t1 = await esperarTrabajo('aprender');
    expect(t1).toMatchObject({ estado: 'terminado', resumen: { pares: 1, nuevas: 1, repetidas: 0 } });
    const lista = await repos.entrenamiento.listar({}, { limite: 10, offset: 0 });
    expect(lista.items).toHaveLength(1);
    expect(lista.items[0]).toMatchObject({ estado: 'pendiente', origen: 'chat', origenDetalle: 'Maria (51987654321)', pregunta: 'hacen envios a trujillo?' });
    expect(lista.items[0]!.respuesta).toContain('[teléfono]');
    expect(entrenamiento.cargadas()).toBe(0);
    // Otra vez: nada nuevo.
    await app.inject({ method: 'POST', url: '/admin/entrenamiento/aprender', headers: h, payload: { revisar: false } });
    const t2 = await esperarTrabajo('aprender');
    expect(t2.resumen).toMatchObject({ nuevas: 0, repetidas: 1 });
  });

  it('pulir con la IA: limpia, clasifica y descarta lo que no sirve', async () => {
    const h = await sesion();
    const a = await entrenamiento.ensenar({ tipo: 'ejemplo', pregunta: 'hola juan, hacen envios a trujillo?', respuesta: 'Hola Maria! si, 2 dias, S/ 15' }, { origen: 'chat', estado: 'pendiente' });
    const b = await entrenamiento.ensenar({ tipo: 'ejemplo', pregunta: 'ya estoy en la puerta', respuesta: 'voy bajando, dame un minuto' }, { origen: 'chat', estado: 'pendiente' });
    modelo.estado.responder = (mensajes) => {
      const u = mensajes.at(-1)!.content;
      if (u.includes('puerta')) return '{"util": false, "motivo": "coordinación puntual de una entrega"}';
      return '```json\n{"util": true, "motivo": "sirve", "pregunta": "¿Hacen envíos a Trujillo?", "respuesta": "Sí, enviamos a Trujillo: llega en 2 días y cuesta S/ 15.", "tema": "Envios"}\n```';
    };
    const r = await app.inject({ method: 'POST', url: '/admin/entrenamiento/pulir', headers: h, payload: { limite: 100, activar: true } });
    expect(r.statusCode).toBe(200);
    const t = await esperarTrabajo('pulir');
    expect(t).toMatchObject({ estado: 'terminado', resumen: { utiles: 1, descartadas: 1 } });
    const la = await repos.entrenamiento.porId(a.leccion.id);
    expect(la).toMatchObject({ estado: 'activa', pregunta: '¿Hacen envíos a Trujillo?', tema: 'envios', nota: 'Pulida por la IA' });
    const lb = await repos.entrenamiento.porId(b.leccion.id);
    expect(lb).toMatchObject({ estado: 'descartada' });
    expect(lb!.nota).toContain('coordinación puntual');
    expect(entrenamiento.cargadas()).toBe(1);
  });
});

describe('examen a gran escala', () => {
  it('pregunta cada leccion al asistente real, califica, guarda el historico y marca cada leccion', async () => {
    const h = await sesion();
    await entrenamiento.ensenarVarias(
      [
        { tipo: 'ejemplo', pregunta: '¿Hacen envíos a Trujillo?', respuesta: 'Sí, enviamos a Trujillo: llega en 2 días y cuesta S/ 15.', tema: 'envios', mala: null },
        { tipo: 'ejemplo', pregunta: '¿Aceptan Yape?', respuesta: 'Sí, aceptamos Yape, Plin y transferencia.', tema: 'pagos', mala: null },
        { tipo: 'ejemplo', pregunta: '¿Tienen talla 46?', respuesta: 'Solo hasta la talla 45.', tema: 'stock', mala: null },
      ],
      { origen: 'manual' },
    );
    // El modelo "aprendio" dos y la tercera la contesta mal.
    modelo.estado.responder = (mensajes) => {
      const u = mensajes.at(-1)!.content.toLowerCase();
      if (u.includes('trujillo')) return 'Claro, hacemos envíos a Trujillo: suele llegar en 2 días y el costo es S/ 15.';
      if (u.includes('yape')) return 'Sí, puedes pagar con Yape, Plin o transferencia bancaria.';
      return 'Sí, tenemos todas las tallas, hasta la 48.';
    };
    const ope = await sesion('operador');
    expect((await app.inject({ method: 'POST', url: '/admin/entrenamiento/examen', headers: ope, payload: {} })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/admin/entrenamiento/examen', headers: h, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().trabajo).toMatchObject({ tipo: 'examen', total: 3 });
    const t = await esperarTrabajo('examen');
    expect(t).toMatchObject({ estado: 'terminado', resumen: { aprobados: 2, fallados: 1, errores: 0 } });

    const ex = await app.inject({ method: 'GET', url: '/admin/entrenamiento/examenes', headers: h });
    expect(ex.json().examenes[0]).toMatchObject({ estado: 'terminado', total: 3, aprobados: 2, fallados: 1, detalle: { porcentaje: 67 } });
    const id = ex.json().examenes[0].id;
    const casos = await app.inject({ method: 'GET', url: `/admin/entrenamiento/examenes/${id}?fallos=1`, headers: h });
    expect(casos.json().casos).toHaveLength(1);
    expect(casos.json().casos[0]).toMatchObject({ pregunta: '¿Tienen talla 46?', ok: false });
    expect(casos.json().casos[0].motivos.join(' ')).toMatch(/faltó decir «45»|no esta en lo que sabe/);
    // Cada leccion quedo marcada, y el filtro "fallaron" las encuentra.
    const mal = await app.inject({ method: 'GET', url: '/admin/entrenamiento/lecciones?examen=mal', headers: h });
    expect(mal.json().total).toBe(1);
    expect(mal.json().items[0].examenNota).toBeTruthy();
    const resumen = await app.inject({ method: 'GET', url: '/admin/entrenamiento', headers: h });
    expect(resumen.json().cifras).toMatchObject({ pasanExamen: 2, fallanExamen: 1 });
    // Solo las que fallaron, otra vez, ya corregido el modelo.
    modelo.estado.responder = () => 'Lo siento, solo tenemos hasta la talla 45.';
    await app.inject({ method: 'POST', url: '/admin/entrenamiento/examen', headers: h, payload: { soloFallidas: true } });
    const t2 = await esperarTrabajo('examen');
    expect(t2).toMatchObject({ total: 1, resumen: { aprobados: 1, fallados: 0 } });
    expect((await repos.entrenamiento.cifras()).fallanExamen).toBe(0);
    // Y lo que sabe la IA operadora del entrenamiento.
    expect(await entrenamiento.descripcionParaIA()).toMatch(/3 lecciones activas.*Último examen.*100 %/s);
  });

  it('sin lecciones que examinar, o sin IA, se explica', async () => {
    const h = await sesion();
    const r = await app.inject({ method: 'POST', url: '/admin/entrenamiento/examen', headers: h, payload: { tema: 'nada' } });
    expect(r.statusCode).toBe(404);
    await ia.guardar({ token: '' });
    const s = await app.inject({ method: 'POST', url: '/admin/entrenamiento/examen', headers: h, payload: {} });
    expect(s.statusCode).toBe(400);
    expect(s.json()).toMatchObject({ ir: '/panel#ia' });
  });

  it('se puede cancelar un examen largo', async () => {
    const h = await sesion();
    await entrenamiento.ensenarVarias(
      Array.from({ length: 60 }, (_, i) => ({ tipo: 'ejemplo' as const, pregunta: `¿Pregunta ${i}?`, respuesta: `Respuesta ${i}.`, tema: null, mala: null })),
      { origen: 'manual' },
    );
    // Un modelo que tarda un poco: si no, las 60 acaban antes de que llegue el "cancelar".
    modelo.estado.responder = () => new Promise<string>((r) => setTimeout(() => r('Respuesta.'), 5));
    await app.inject({ method: 'POST', url: '/admin/entrenamiento/examen', headers: h, payload: {} });
    await app.inject({ method: 'POST', url: '/admin/entrenamiento/trabajos/examen/cancelar', headers: h, payload: {} });
    const t = await esperarTrabajo('examen');
    expect(t.estado).toBe('cancelado');
    expect(t.hecho).toBeLessThan(60);
    const ex = await repos.entrenamiento.examenes(1);
    expect(ex[0]!.estado).toBe('cancelado');
  });
});

describe('la pantalla', () => {
  it('/entrenamiento se sirve con el armazon y el menu la lleva', async () => {
    const h = await sesion();
    const r = await app.inject({ method: 'GET', url: '/entrenamiento', headers: h });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Entrenar a la IA');
    expect(r.body).toContain('Enséñale una cosa');
    expect(r.body).toContain('/admin/entrenamiento/lecciones');
    expect(r.body).toContain('function pedirLeccion');
    const chat = await app.inject({ method: 'GET', url: '/chat', headers: h });
    expect(chat.body).toContain('data-corregir');
    const manual = await app.inject({ method: 'GET', url: '/manual', headers: h });
    expect(manual.body).toContain('m-entrenamiento');
  });
});
