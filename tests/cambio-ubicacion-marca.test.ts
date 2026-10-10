/**
 * El cliente que cambia su ubicación (pedido del dueño, 10/10):
 *
 *  - «quiero cambiar mi ubicación» (o un mensaje igual) antes de la 1:00 PM →
 *    «Claro, {nombre}, por favor mándeme su nueva ubicación…», con el botón
 *    de ubicación, como el primer mensaje.
 *  - El pin nuevo deja el pedido en «Ubicación registrada» y marcado
 *    «cambió su ubicación» (con la hora): lo guardan las columnas de la
 *    migración 006 y lo ven Hoy, Números del día, la ficha, la API v1 y el
 *    reporte a GSG.
 *  - Después de la 1:00 PM, lo de siempre (que coordine con el motorizado).
 *  - Las reglas primero; con la IA configurada, el clasificador solo AÑADE el
 *    cambio que las reglas no vieron. La etiqueta nunca le llega al cliente.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, conPais, type EscenarioEntregas } from './escenario-entregas.js';
import { pideCambioUbicacion } from '../src/entregas/interpretar.js';
import { pareceCambioUbicacion } from '../src/ia/agente-operativo.js';
import { esEtiquetaDeClasificador } from '../src/ia/consulta-pedido.js';
import { rellenar, TEXTOS_POR_DEFECTO } from '../src/entregas/textos.js';
import { entregaParaApi } from '../src/api/v1/entregas-gsg.js';
import type { MensajeIA } from '../src/ia/proveedores.js';

/** Las 09:00 de Lima del último día que ya empezó. */
function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

const pideLaNueva = (nombre: string): string => `Claro, ${nombre}, por favor mándeme su nueva ubicación por WhatsApp (el botón de ubicación) para registrarla.`;
const MOTO_GSG = '999888777';

// ------------------------------------------------------------------ reglas

describe('las reglas: «un mensaje igual» a «quiero cambiar mi ubicación»', () => {
  const SI = [
    'quiero cambiar mi ubicación',
    'me equivoqué de dirección',
    'la ubicación está mal',
    'te mando otra',
    'es otra dirección',
    'cambié de casa, ahora estoy en Surco',
    'me cambié de depa',
    'me mudé',
    'ya no vivo ahí',
    'me lo pueden llevar a otro sitio?',
    'mándenlo a otra dirección',
    'déjenlo en mi nueva casa',
    'error en la ubicación',
    'quiero actualizar mi dirección',
    'la dirección que tienen está mal',
    'puse mal mi dirección',
    'oe causa la ubi q te pase esta mal',
    'ahorita te paso la nueva ubicación',
    'es en otra casa',
  ];
  const NO = [
    'no quiero cambiar mi ubicación',
    'no voy a cambiar la ubicación',
    'no hay que cambiar la ubicación',
    'no es necesario cambiar la ubicación',
    'no me equivoqué de dirección',
    'la ubicación no está mal',
    'la ubicación está bien',
    'no, la ubicación está bien así',
    'no me mudé',
    'no cambié de casa',
    'no estoy ahí ahorita, llego en una hora',
    'ya te mandé mi ubicación',
    'a qué hora llega mi pedido',
    'gracias',
  ];
  for (const t of SI) {
    it(`«${t}» → es un cambio`, () => {
      expect(pideCambioUbicacion(t)).toBe(true);
      expect(pareceCambioUbicacion(t)).toBe(true);
    });
  }
  for (const t of NO) {
    it(`«${t}» → no es un cambio`, () => {
      expect(pideCambioUbicacion(t)).toBe(false);
      expect(pareceCambioUbicacion(t)).toBe(false);
    });
  }

  it('la plantilla sin nombre queda «Claro, por favor…» (sin la coma suelta)', () => {
    expect(rellenar(TEXTOS_POR_DEFECTO.cambioUbicacionAntes, { nombre: null, negocio: 'Demo' })).toBe('Claro, por favor mándeme su nueva ubicación por WhatsApp (el botón de ubicación) para registrarla.');
    expect(rellenar(TEXTOS_POR_DEFECTO.cambioUbicacionAntes, { nombre: 'Rosa María Quispe', negocio: 'Demo' })).toBe(pideLaNueva('Rosa'));
  });
});

// ------------------------------------------- de punta a punta, con la marca

describe('«quiero cambiar mi ubicación»: plantilla con el nombre, pin nuevo y la marca en las pantallas', () => {
  let e: EscenarioEntregas;
  const TEL = '987440001';
  const NUEVO = { lat: PIN_LIMA.lat + 0.004, lng: PIN_LIMA.lng + 0.004 };
  const TARDE = { lat: PIN_LIMA.lat - 0.004, lng: PIN_LIMA.lng - 0.004 };
  const nuevos = async (accion: () => Promise<unknown>): Promise<Array<Record<string, unknown>>> => {
    const a = e.mensajesA(conPais(TEL)).length;
    await accion();
    await e.trabajar();
    return e.mensajesA(conPais(TEL)).slice(a);
  };

  /** Los reportes de ubicación hacia GSG, tal como se guardan con el pin. */
  const reportes: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true });
    const original = e.repos.entregas.registrarUbicacionAtomica.bind(e.repos.entregas);
    e.repos.entregas.registrarUbicacionAtomica = async (id, patch, reporte, propuestaAt) => {
      if (reporte) reportes.push(reporte.payload);
      return original(id, patch, reporte, propuestaAt);
    };
    await e.entregas.guardarAjustes({ soporte: { whatsapp: '987654321', llamadas: '' } });
    await e.api.post('/admin/motorizados/de-prueba');
    e.simulador.cargar([{ referencia: 'CM-1', telefono: TEL, nombre: 'Rosa Cambio', direccion: 'Av. Larco 1', distrito: 'Miraflores', faltaUbicacion: true, faltaConfirmacion: false, telefonoMotorizado: MOTO_GSG } as never]);
    await e.gsgManda();
    await e.trabajar();
    await e.contesta(TEL, { pin: PIN_LIMA });
    await e.trabajar();
    expect((await e.entrega('CM-1'))?.ubicacionEstado).toBe('recibida');
  });
  afterAll(() => e?.cerrar());

  it('antes de la 1:00 PM: «Claro, Rosa, por favor mándeme su nueva ubicación…» con el botón de ubicación', async () => {
    const salio = await nuevos(() => e.contesta(TEL, { texto: 'quiero cambiar mi ubicación' }));
    expect(salio.map((m) => m.body)).toEqual([pideLaNueva('Rosa')]);
    expect(salio[0]!.kind).toBe('location_request');
    const c = await e.entrega('CM-1');
    expect(c?.ubicacionCambioPedidoAt).toBeInstanceOf(Date);
    expect(c?.ubicacionCambiadaAt ?? null).toBeNull();
  });

  it('el pin nuevo: «Ubicación registrada», marcada «cambió su ubicación», con la anterior guardada', async () => {
    const salio = await nuevos(() => e.contesta(TEL, { pin: NUEVO }));
    expect(salio.some((m) => /Tu nueva ubicación se ha registrado correctamente/.test(String(m.body ?? '')))).toBe(true);
    const c = (await e.entrega('CM-1'))!;
    expect(c.ubicacionEstado).toBe('recibida');
    expect(c.lat).toBeCloseTo(NUEVO.lat, 5);
    expect(c.ubicacionCambiadaAt).toBeInstanceOf(Date);
    expect(c.ubicacionCambios).toBe(1);
    expect(c.ubicacionCambioPedidoAt ?? null).toBeNull();
    expect(c.ubicacionAnteriorLat).toBeCloseTo(PIN_LIMA.lat, 5);
    expect(c.ubicacionAnteriorLng).toBeCloseTo(PIN_LIMA.lng, 5);
    expect(c.cambioUbicacion).toMatch(/^cambió su ubicación \(\d{2}:\d{2}\)$/);

    // La bitácora: «ubicación cambiada por el cliente» con la vieja y la nueva.
    const ficha = await e.api.get<{ eventos: Array<{ detalle: string | null }> }>(`/admin/entregas/${c.id}`);
    const ev = ficha.body.eventos.find((x) => /ubicación cambiada por el cliente/.test(x.detalle ?? ''));
    expect(ev?.detalle).toContain(`antes ${PIN_LIMA.lat.toFixed(5)}, ${PIN_LIMA.lng.toFixed(5)}`);
    expect(ev?.detalle).toContain(`ahora ${NUEVO.lat.toFixed(5)}, ${NUEVO.lng.toFixed(5)}`);
  });

  it('Hoy y Números del día: «Ubicación registrada» con la marca y la hora', async () => {
    const hoy = await e.api.get<{ entregas: Array<{ referencia: string; ubicacionEstado: string; ubicacionCambiadaAt: string | null; cambioUbicacion: string | null }> }>('/admin/entregas');
    const fila = hoy.body.entregas.find((x) => x.referencia === 'CM-1')!;
    expect(fila.ubicacionEstado).toBe('recibida');
    expect(fila.ubicacionCambiadaAt).toBeTruthy();
    expect(fila.cambioUbicacion).toMatch(/^cambió su ubicación \(\d{2}:\d{2}\)$/);

    const numeros = await e.api.get<{ numeros: Array<{ referencia: string; ubiRegistrada: boolean; ubicacionCambiada: boolean; ubicacionCambios: number; cambioUbicacion: string | null }> }>('/admin/entregas/numeros');
    const n = numeros.body.numeros.find((x) => x.referencia === 'CM-1')!;
    expect(n).toMatchObject({ ubiRegistrada: true, ubicacionCambiada: true, ubicacionCambios: 1 });
    expect(n.cambioUbicacion).toMatch(/cambió su ubicación/);

    // La página pinta la marca a partir de esos datos.
    const pagina = await e.api.get<{ raw?: string }>('/entregas');
    if (typeof pagina.body.raw === 'string') expect(pagina.body.raw).toContain('chip-cambio');
  });

  it('la API v1 y el reporte a GSG llevan el cambio', async () => {
    const api = entregaParaApi((await e.entrega('CM-1'))!) as { ubicacion: Record<string, unknown> };
    expect(api.ubicacion).toMatchObject({ estado: 'recibida', cambiada: true, cambios: 1 });
    expect(api.ubicacion.cambiadaEn).toEqual(expect.any(String));
    expect(api.ubicacion.anterior).toEqual({ lat: PIN_LIMA.lat, lng: PIN_LIMA.lng });

    // El reporte de ubicación a GSG (se guarda en la misma transacción que el pin).
    const ubis = reportes.filter((x) => x.referencia === 'CM-1');
    // (el primer pin lo reportó el reparto; este es el del cambio)
    expect(ubis.length).toBeGreaterThanOrEqual(1);
    expect(ubis.at(-1)).toMatchObject({ corregida: true, cambioUbicacion: true, cambios: 1, anterior: { lat: PIN_LIMA.lat, lng: PIN_LIMA.lng } });
  });

  it('después de la 1:00 PM: lo de siempre, y la marca no cambia', async () => {
    e.avanzar(5 * 60); // ~14:0x en Lima
    const salio = await nuevos(() => e.contesta(TEL, { texto: 'quiero cambiar mi ubicación' }));
    expect(salio).toHaveLength(1);
    expect(salio[0]!.kind).not.toBe('location_request');
    expect(String(salio[0]!.body)).toMatch(/^Entiendo que deseas cambiar tu ubicación, pero al ser después de la 1:00 PM, por favor comunícate directamente con el motorizado/);
    const otra = await nuevos(() => e.contesta(TEL, { pin: TARDE }));
    expect(String(otra.at(-1)?.body)).toMatch(/comunícate directamente con el motorizado/);
    const c = (await e.entrega('CM-1'))!;
    expect(c.lat).toBeCloseTo(NUEVO.lat, 5);
    expect(c.ubicacionCambios).toBe(1);
    expect(c.ubicacionCambioPedidoAt ?? null).toBeNull();
  });
});

// ------------------------------------------- la IA solo añade el cambio

describe('con la IA configurada: lo que las reglas no ven lo reconoce el clasificador (sin etiquetas al cliente)', () => {
  let e: EscenarioEntregas;
  let n = 0;
  const modelo: { responde: string; prompts: string[] } = { responde: 'OTRA', prompts: [] };

  /** Un cliente con su ubicación ya registrada. */
  const conUbicacion = async (nombre: string): Promise<string> => {
    n++;
    const tel = `98745${String(n).padStart(4, '0')}`;
    e.simulador.cargar([{ referencia: `CMI-${n}`, telefono: tel, nombre, direccion: `Jr. Prueba ${n}`, distrito: 'Miraflores', faltaUbicacion: true, faltaConfirmacion: false, telefonoMotorizado: MOTO_GSG } as never]);
    await e.gsgManda();
    await e.trabajar();
    await e.contesta(tel, { pin: PIN_LIMA });
    await e.trabajar();
    expect((await e.entrega(`CMI-${n}`))?.ubicacionEstado).toBe('recibida');
    return tel;
  };

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true });
    await e.entregas.guardarAjustes({ soporte: { whatsapp: '987654321', llamadas: '' } });
    await e.api.post('/admin/motorizados/de-prueba');
    e.ia.completar = async (mensajes: MensajeIA[]) => {
      modelo.prompts.push(mensajes[0]?.content ?? '');
      return modelo.responde;
    };
    await e.asistente!.guardar({ activa: true, proveedor: 'openai', servicio: 'openai', modelo: 'gpt-4o-mini', token: 'sk-prueba' });
    await e.asistente!.probarConexion();
  }, 60_000);
  afterAll(() => e?.cerrar());

  it('una frase libre que las reglas no ven: el modelo dice CAMBIAR_UBICACION y sale la plantilla, nunca la etiqueta', async () => {
    const tel = await conUbicacion('Lucía Torres');
    const libre = 'oye mejor que vaya donde la señora del puesto 14';
    expect(pareceCambioUbicacion(libre)).toBe(false);
    modelo.responde = 'CAMBIAR_UBICACION';
    const a = e.mensajesA(conPais(tel)).length;
    const llamadas = modelo.prompts.length;
    await e.contesta(tel, { texto: libre });
    await e.trabajar();
    const salio = e.mensajesA(conPais(tel)).slice(a);
    expect(modelo.prompts.length).toBeGreaterThan(llamadas);
    expect(salio.map((m) => m.body)).toEqual([pideLaNueva('Lucía')]);
    expect(salio[0]!.kind).toBe('location_request');
    for (const m of e.wa.sent) expect(esEtiquetaDeClasificador(String(m.body ?? '')), String(m.body)).toBe(false);
    expect((await e.entrega(tel))?.ubicacionCambioPedidoAt).toBeInstanceOf(Date);

    // Y el pin que mande cuenta como el cambio.
    modelo.responde = 'OTRA';
    await e.contesta(tel, { pin: { lat: PIN_LIMA.lat + 0.002, lng: PIN_LIMA.lng + 0.002 } });
    await e.trabajar();
    const c = (await e.entrega(tel))!;
    expect(c.ubicacionCambiadaAt).toBeInstanceOf(Date);
    expect(c.ubicacionCambios).toBe(1);
  });

  it('si el modelo dice otra cosa, no se inventa un cambio: silencio como siempre', async () => {
    const tel = await conUbicacion('Mario Ríos');
    modelo.responde = 'OTRA';
    const a = e.mensajesA(conPais(tel)).length;
    await e.contesta(tel, { texto: 'oye mejor que vaya donde la señora del puesto 14' });
    await e.trabajar();
    expect(e.mensajesA(conPais(tel)).slice(a)).toEqual([]);
    expect((await e.entrega(tel))?.ubicacionCambioPedidoAt ?? null).toBeNull();
  });

  it('una «consulta» que en realidad es un cambio: la IA de la consulta lo marca y va al flujo del cambio', async () => {
    const tel = await conUbicacion('Nora Paz');
    const texto = '¿me lo pueden llevar donde mi tía?';
    modelo.responde = '[CAMBIO_UBICACION]';
    const a = e.mensajesA(conPais(tel)).length;
    await e.contesta(tel, { texto });
    await e.trabajar();
    const salio = e.mensajesA(conPais(tel)).slice(a);
    expect(salio.map((m) => m.body)).toEqual([pideLaNueva('Nora')]);
    for (const m of e.wa.sent) expect(String(m.body ?? '')).not.toContain('[CAMBIO_UBICACION]');
  });

  it('las reglas van primero: «quiero cambiar mi ubicación» no gasta una llamada al modelo', async () => {
    const tel = await conUbicacion('Pedro Luna');
    modelo.responde = 'OTRA';
    const llamadas = modelo.prompts.length;
    const a = e.mensajesA(conPais(tel)).length;
    await e.contesta(tel, { texto: 'quiero cambiar mi ubicación' });
    await e.trabajar();
    expect(e.mensajesA(conPais(tel)).slice(a).map((m) => m.body)).toEqual([pideLaNueva('Pedro')]);
    expect(modelo.prompts.length).toBe(llamadas);
  });
});
