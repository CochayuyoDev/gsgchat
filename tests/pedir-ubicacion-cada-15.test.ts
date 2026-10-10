/**
 * «Cada 15 minutos el bot pide la ubicación» (pedido del dueño, 10/10).
 *
 * El bot manda el primer mensaje y desde ahí solo contesta la ubicación: un
 * «hola», una charla larga, un audio... quedan en el chat sin respuesta y sin
 * esperar a que termine de escribir. Si no la manda, a los 15 minutos de su
 * último pedido se le vuelve a pedir, sin tope de mensajes. Si la comparte en
 * tiempo real, se le dice que esa es la de tiempo real y que mande la actual.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pasoDe, OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import type { Solicitud } from '../src/db/rutas.js';
import { crearEscenario, conPais, PIN_LIMA, type Escenario } from './escenario-reparto.js';

const CADA = 15;

describe('pedir la ubicación cada 15 minutos', () => {
  const TEL = '987650001';
  const phone = conPais(TEL);
  let e: Escenario;

  const solicitud = async (): Promise<Solicitud> => (await e.buscar(phone))[0]!;
  const enviados = () => e.mensajesA(TEL).length;

  beforeAll(async () => {
    e = await crearEscenario();
    const r = await e.api.post('/admin/rutas/ajustes', { pedirUbicacionCadaMinutos: CADA });
    expect(r.status).toBe(200);
    await e.cargarLote('Hoy', [{ telefono: TEL, nombre: 'Ana Pérez', referencia: 'P-1' }]);
    await e.trabajar();
  });

  afterAll(async () => {
    await e?.cerrar();
  });

  it('el primer mensaje sale y la solicitud espera su ubicación', async () => {
    expect(enviados()).toBe(1);
    expect((await solicitud()).estado).toBe('enviado');
  });

  it('a su «hola» y a lo que siga escribiendo no se le contesta nada', async () => {
    await e.contesta(TEL, { texto: 'hola' });
    await e.contesta(TEL, { texto: 'quién es?' });
    await e.contesta(TEL, { texto: 'mi pedido cuándo llega, lo necesito para hoy' });
    await e.contesta(TEL, { adjunto: 'audio' });
    expect(enviados()).toBe(1);

    const s = await solicitud();
    expect(s.estado).toBe('respondio');
    // Sin «una persona tiene que mirarlo»: el bot se la sigue pidiendo solo.
    expect(s.requiereHumano).toBe(false);
  });

  it('lo que escribe no adelanta el siguiente pedido: sale a los 15 minutos, no antes', async () => {
    await e.trabajar();
    expect(enviados()).toBe(1);
    e.avanzar(CADA - 2);
    await e.trabajar();
    expect(enviados()).toBe(1);
    e.avanzar(3);
    await e.trabajar();
    expect(enviados()).toBe(2);
  });

  it('se le sigue pidiendo cada 15 minutos, más allá de los tres intentos de siempre', async () => {
    for (let i = 0; i < 4; i++) {
      e.avanzar(CADA + 1);
      await e.trabajar();
    }
    expect(enviados()).toBe(6);
    const s = await solicitud();
    expect(s.estado).toBe('respondio');
    expect(s.intentos).toBe(6);
  });

  it('su ubicación en tiempo real no se registra: se le pide la actual, una vez', async () => {
    const antes = enviados();
    await e.api.post('/admin/dev/inbound', { phone, location: { latitude: PIN_LIMA.lat, longitude: PIN_LIMA.lng }, enVivo: true });
    // Las actualizaciones de la misma ubicación en vivo no repiten el aviso.
    await e.api.post('/admin/dev/inbound', { phone, location: { latitude: PIN_LIMA.lat + 0.0005, longitude: PIN_LIMA.lng }, enVivo: true });
    const nuevos = e.mensajesA(TEL).slice(antes);
    expect(nuevos).toHaveLength(1);
    expect(JSON.stringify(nuevos[0])).toMatch(/tiempo real/i);
    expect(JSON.stringify(nuevos[0])).toMatch(/ubicaci[oó]n actual/i);
    expect((await solicitud()).lat).toBeNull();
  });

  it('cuando manda su ubicación, se le contesta y no se le vuelve a pedir', async () => {
    const antes = enviados();
    await e.contesta(TEL, { pin: PIN_LIMA });
    expect(enviados()).toBe(antes + 1);
    expect((await solicitud()).estado).toBe('resuelto');

    e.avanzar(CADA + 1);
    await e.trabajar();
    e.avanzar(CADA + 1);
    await e.trabajar();
    expect(enviados()).toBe(antes + 1);
  });
});

describe('«no soy yo» sí se atiende', () => {
  it('a un número equivocado no se le sigue pidiendo la ubicación', async () => {
    const e = await crearEscenario();
    try {
      await e.api.post('/admin/rutas/ajustes', { pedirUbicacionCadaMinutos: CADA });
      await e.cargarLote('Hoy', [{ telefono: '987650003', nombre: 'Rosa', referencia: 'P-3' }]);
      await e.trabajar();
      await e.contesta('987650003', { noSoyYo: true });
      const [s] = await e.buscar(conPais('987650003'));
      expect(s!.incidencia).toBe('numero_equivocado');
      const antes = e.mensajesA('987650003').length;
      e.avanzar(CADA + 1);
      await e.trabajar();
      expect(e.mensajesA('987650003').length).toBe(antes);
    } finally {
      await e.cerrar();
    }
  });
});

describe('con el ajuste en 0, como antes', () => {
  it('a los tres intentos pasa a una persona', () => {
    const base = { intentos: 3, estado: 'enviado' } as Solicitud;
    expect(pasoDe(base, { ...OPCIONES_POR_DEFECTO, pedirUbicacionCadaMinutos: 0 })).toBe('derivar');
    expect(pasoDe(base, { ...OPCIONES_POR_DEFECTO, pedirUbicacionCadaMinutos: 15 })).toBe('recordatorio');
  });

  it('su texto sí se atiende como respuesta', async () => {
    const e = await crearEscenario();
    try {
      await e.api.post('/admin/rutas/ajustes', { pedirUbicacionCadaMinutos: 0 });
      await e.cargarLote('Hoy', [{ telefono: '987650002', nombre: 'Luis', referencia: 'P-2' }]);
      await e.trabajar();
      await e.contesta('987650002', { texto: 'hola' });
      const [s] = await e.buscar(conPais('987650002'));
      expect(s!.requiereHumano).toBe(true);
    } finally {
      await e.cerrar();
    }
  });
});
