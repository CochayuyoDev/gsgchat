/**
 * «Números del día»: los filtros salen del estado real de cada entrega y
 * cambian solos con los mensajes (pin → «Falta confirmar», «sí» → «Ya
 * contactados»), y el endpoint en masa repite en bucle las acciones de una
 * sola entrega, pasando todo por el sender y los motores de siempre.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { createRepos, type Repos } from '../src/db/repos.js';
import { crearEscenarioEntregas, PIN_LIMA, type EscenarioEntregas } from './escenario-entregas.js';
import { avisoEnPalabras, etapaDe } from '../src/entregas/numeros.js';
import type { FilaEntrega } from '../src/entregas/servicio.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

interface Numero {
  id: number;
  referencia: string;
  etapa: string;
  punto: string;
  pausado: boolean;
  contactadoAt: string | null;
  contactadoPor: string | null;
}
interface RespuestaNumeros {
  numeros: Numero[];
  cifras: Record<string, number>;
}
interface RespuestaMasa {
  ok: boolean;
  hechos: number;
  saltados: Record<string, number>;
  aviso: string;
  resultados: Array<{ id: number; hecho: boolean; motivo: string }>;
}

/** Las 09:00 de Lima del último día que ya empezó: las pruebas avanzan el reloj y no deben cruzar la medianoche. */
function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

describe('Números del día: los filtros y las acciones en masa', () => {
  let e: EscenarioEntregas;

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ arranque: hoyALas9() });
    await e.api.post('/admin/motorizados/de-prueba');
  });
  afterAll(() => e.cerrar());

  const numeros = async (): Promise<RespuestaNumeros> => {
    const r = await e.api.get<RespuestaNumeros>('/admin/entregas/numeros');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  const numero = async (referencia: string): Promise<Numero> => {
    const n = (await numeros()).numeros.find((x) => x.referencia === referencia);
    expect(n, `no aparece ${referencia}`).toBeTruthy();
    return n!;
  };
  const crear = async (referencia: string, telefono: string, extra: Record<string, unknown> = {}): Promise<number> => {
    const r = await e.api.post<{ entrega: { id: number } }>('/admin/entregas/crear', { referencia, telefono, nombre: `Cliente ${referencia}`, distrito: 'Miraflores', ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.entrega.id;
  };
  const masa = async (accion: string, ids: number[]): Promise<RespuestaMasa> => {
    const r = await e.api.post<RespuestaMasa>('/admin/entregas/masa', { accion, ids });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  const conConfirmacion = { faltaUbicacion: false, faltaConfirmacion: true, lat: PIN_LIMA.lat, lng: PIN_LIMA.lng };

  it('recién llegado → «Falta pedir»; con el pedido de pin → «Falta su ubicación»; manda el pin → «Falta confirmar»; dice sí → «Ya contactados»', async () => {
    await crear('N-100', '987400100');
    expect((await numero('N-100')).etapa).toBe('falta_pedir');

    await e.trabajar();
    expect(e.mensajesA('987400100').length, 'el reparto tenía que pedirle el pin').toBeGreaterThan(0);
    const pedida = await numero('N-100');
    expect(pedida.etapa).toBe('falta_ubicacion');
    expect(pedida.punto).toMatch(/se le pidió la ubicación/i);

    await e.contesta('987400100', { pin: PIN_LIMA });
    const conPin = await numero('N-100');
    expect(conPin.etapa, 'al mandar su ubicación pasa solo a «Falta confirmar»').toBe('falta_confirmar');
    expect((await e.entrega('N-100'))?.confirmacionEstado).toBe('pedida');

    await e.contesta('987400100', { texto: 'sí' });
    expect((await numero('N-100')).etapa, 'al decir que sí pasa solo a «Ya contactados»').toBe('contactados');
  });

  it('a quien ya se le pedía confirmar, mandar su ubicación vale como su SÍ: pasa solo a «Ya contactados» y GSG se entera', async () => {
    await crear('N-110', '987400110', conConfirmacion);
    expect((await numero('N-110')).etapa).toBe('falta_confirmar');
    await e.trabajar();
    expect((await e.entrega('N-110'))?.confirmacionEstado).toBe('pedida');

    await e.contesta('987400110', { pin: { lat: PIN_LIMA.lat + 0.002, lng: PIN_LIMA.lng } });
    const despues = await e.entrega('N-110');
    expect(despues?.confirmacionEstado).toBe('confirmada');
    expect(despues?.confirmacionComo).toBe('reglas');
    expect((await numero('N-110')).etapa).toBe('contactados');
    expect(e.textosA('987400110').at(-1)).toMatch(/confirmado/i);
    await e.despacharAGsg();
    expect(e.simulador.recibido.find((r) => r.tipo === 'confirmacion' && r.cuerpo.referencia === 'N-110')?.cuerpo).toMatchObject({ confirmada: true });
  });

  it('el pin puesto a mano desde el panel NO confirma por el cliente', async () => {
    const id = await crear('N-120', '987400120', conConfirmacion);
    await e.trabajar();
    expect((await e.entrega('N-120'))?.confirmacionEstado).toBe('pedida');
    const r = await e.api.post(`/admin/entregas/${id}/ubicacion`, { lat: PIN_LIMA.lat + 0.003, lng: PIN_LIMA.lng });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await e.entrega('N-120'))?.confirmacionEstado).toBe('pedida');
    expect((await numero('N-120')).etapa).toBe('falta_confirmar');
  });

  it('cada filtro tiene su contador y «Todos» los suma a todos', async () => {
    const r = await numeros();
    const suma = ['falta_pedir', 'falta_ubicacion', 'falta_confirmar', 'contactados', 'necesita', 'cancelada'].reduce((a, k) => a + (r.cifras[k] ?? 0), 0);
    expect(r.cifras.todos).toBe(r.numeros.length);
    expect(suma).toBe(r.numeros.length);
    for (const n of r.numeros) expect(['falta_pedir', 'falta_ubicacion', 'falta_confirmar', 'contactados', 'necesita', 'cancelada']).toContain(n.etapa);
  });

  it('«Pedir ubicación ahora» le reenvía el pedido del pin y salta a los que ya la mandaron o no existen, y lo dice en palabras', async () => {
    const id = await crear('N-130', '987400130');
    await e.trabajar();
    const antes = e.mensajesA('987400130').length;
    expect(antes).toBeGreaterThan(0);
    const conPin = (await numero('N-100')).id;

    const r = await masa('pedir_ubicacion', [id, conPin, 999_999]);
    expect(r.hechos).toBe(1);
    expect(r.saltados).toMatchObject({ ya_tiene_ubicacion: 1, no_existe: 1 });
    expect(r.aviso).toBe('Se pidió la ubicación a 1; 1 ya la había mandado y se saltó; 1 ya no existía y se saltó. Salen de uno en uno, con la pausa de siempre entre mensaje y mensaje.');

    await e.trabajar();
    expect(e.mensajesA('987400130').length, 'el recordatorio tenía que salir ya, sin esperar las horas de espera').toBe(antes + 1);
    expect((await numero('N-130')).etapa).toBe('falta_ubicacion');
    const eventos = (await e.api.get<{ eventos: Array<{ detalle: string | null }> }>(`/admin/entregas/${id}`)).body.eventos;
    expect(eventos.some((ev) => /pidió la ubicación desde Números del día/.test(ev.detalle ?? ''))).toBe(true);
  });

  it('«Pedir confirmación» la vuelve a pedir ya; a quien le falta la ubicación se lo salta y dice por qué', async () => {
    const id = await crear('N-140', '987400140', conConfirmacion);
    await e.trabajar();
    const antes = e.botonesA('987400140').length;
    expect(antes).toBe(1);
    const sinPin = (await numero('N-130')).id;

    const r = await masa('pedir_confirmacion', [id, sinPin]);
    expect(r.hechos).toBe(1);
    expect(r.saltados).toMatchObject({ falta_ubicacion: 1 });
    expect(r.aviso).toMatch(/^Se pidió la confirmación a 1; 1 todavía no manda su ubicación/);

    await e.trabajar();
    expect(e.botonesA('987400140').length, 'la pregunta de confirmar tenía que volver a salir').toBe(antes + 1);
    expect((await e.entrega('N-140'))?.confirmacionIntentos).toBe(2);
  });

  it('«Marcar como contactado» lo pasa a «Ya contactados» y se guarda; «Quitar marca» lo devuelve a su sitio', async () => {
    const id = await crear('N-150', '987400150');
    await e.trabajar();
    expect((await numero('N-150')).etapa).toBe('falta_ubicacion');

    const r = await masa('marcar_contactado', [id]);
    expect(r.aviso).toBe('1 quedó marcado como contactado.');
    const marcado = await numero('N-150');
    expect(marcado.etapa).toBe('contactados');
    expect(marcado.contactadoAt).toBeTruthy();
    expect(e.repos.entregas._entregas.find((x) => x.id === id)?.contactadoAt).toBeInstanceOf(Date);

    const otra = await masa('marcar_contactado', [id]);
    expect(otra.hechos).toBe(0);
    expect(otra.aviso).toBe('No se marcó ninguno; 1 ya estaba marcado y se saltó.');

    await masa('quitar_marca', [id]);
    const sinMarca = await numero('N-150');
    expect(sinMarca.etapa).toBe('falta_ubicacion');
    expect(sinMarca.contactadoAt).toBeNull();
  });

  it('«Pausar» detiene el pedido de ubicación del reparto y «Reanudar» lo suelta', async () => {
    const id = await crear('N-160', '987400160');
    const r = await masa('pausar', [id]);
    expect(r.aviso).toBe('Se detuvieron los mensajes automáticos a 1.');
    expect((await numero('N-160')).pausado).toBe(true);

    await e.trabajar();
    expect(e.mensajesA('987400160'), 'en pausa no se le escribe').toHaveLength(0);
    // Pedir la ubicación a un número en pausa tampoco: se dice que se reanude primero.
    const pedir = await masa('pedir_ubicacion', [id]);
    expect(pedir.saltados).toMatchObject({ pausado: 1 });
    expect(pedir.aviso).toMatch(/reanúdalo primero/);

    await masa('reanudar', [id]);
    expect((await numero('N-160')).pausado).toBe(false);
    await e.trabajar();
    expect(e.mensajesA('987400160').length, 'al reanudar se le pide el pin').toBeGreaterThan(0);
    expect((await numero('N-160')).etapa).toBe('falta_ubicacion');
  });

  it('«Pausar» también detiene la pregunta de confirmar, y sus respuestas se siguen leyendo', async () => {
    const id = await crear('N-170', '987400170', conConfirmacion);
    await masa('pausar', [id]);
    await e.trabajar();
    expect(e.botonesA('987400170'), 'en pausa no se le pide confirmar').toHaveLength(0);
    await masa('reanudar', [id]);
    await e.trabajar();
    expect(e.botonesA('987400170')).toHaveLength(1);
    // En pausa otra vez: lo que conteste se sigue leyendo.
    await masa('pausar', [id]);
    await e.contesta('987400170', { texto: 'sí' });
    expect((await numero('N-170')).etapa).toBe('contactados');
  });

  it('el endpoint en masa explica en palabras lo que no puede hacer', async () => {
    const mala = await e.api.post<{ error: string }>('/admin/entregas/masa', { accion: 'borrar_todo', ids: [1] });
    expect(mala.status).toBe(400);
    expect(mala.body.error).toMatch(/Esa acción no existe/);
    const vacia = await e.api.post<{ error: string }>('/admin/entregas/masa', { accion: 'pausar', ids: [] });
    expect(vacia.status).toBe(400);
    expect(vacia.body.error).toMatch(/ningún número seleccionado/);
  });

  it('la pantalla existe, está en el menú (y «Ubicaciones registradas» a la vista la abre filtrada) y no enseña nada técnico', async () => {
    const r = await e.app.inject({ method: 'GET', url: '/numeros', headers: { authorization: 'Bearer x' } });
    // Sin sesión de panel la página pide entrar; con la clave de API de las pruebas no hay cookie.
    expect([200, 302]).toContain(r.statusCode);
    const { MENU_GSG } = await import('../src/web/shell.js');
    expect(MENU_GSG.find((x) => x.id === 'numeros')?.href).toBe('/numeros');
    const ubi = MENU_GSG.find((x) => x.id === 'ubicaciones');
    expect(ubi?.href).toBe('/numeros?etapa=contactados');
    expect(ubi?.seccion).toBeUndefined();
    const { numerosPage } = await import('../src/web/numeros-page.js');
    const html = numerosPage({ disponible: true, demo: false, nombreNegocio: 'Tienda' });
    expect(html).toContain('Falta pedir ubicación');
    expect(html).toContain('Necesitan a alguien');
    const js = html.slice(html.indexOf('var FILTROS'));
    expect(js.includes('`')).toBe(false);
    expect(js.includes('$' + '{')).toBe(false);
  });
});

describe('etapaDe y el aviso, sin servidor', () => {
  const base = { estado: 'pendiente', ubicacionEstado: 'pendiente', confirmacionEstado: 'pendiente', requiereHumano: false, segundaVisitaPedidaAt: null, ubicacionPropuestaAt: null, contactadoAt: null, solicitud: null } as unknown as FilaEntrega;
  const con = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as unknown as FilaEntrega;

  it('clasifica cada combinación real de estados', () => {
    expect(etapaDe(base)).toBe('falta_pedir');
    expect(etapaDe(con({ solicitud: { estado: 'pendiente', intentos: 0 } }))).toBe('falta_pedir');
    expect(etapaDe(con({ estado: 'esperando_ubicacion', solicitud: { estado: 'enviado', intentos: 1 } }))).toBe('falta_ubicacion');
    expect(etapaDe(con({ estado: 'esperando_ubicacion', solicitud: { estado: 'respondio', intentos: 1 } }))).toBe('falta_ubicacion');
    expect(etapaDe(con({ estado: 'esperando_ubicacion', ubicacionPropuestaAt: new Date() }))).toBe('falta_ubicacion');
    expect(etapaDe(con({ estado: 'esperando_ubicacion', solicitud: { estado: 'derivado', intentos: 3 } }))).toBe('necesita');
    expect(etapaDe(con({ estado: 'esperando_confirmacion', ubicacionEstado: 'recibida', confirmacionEstado: 'pedida' }))).toBe('falta_confirmar');
    expect(etapaDe(con({ estado: 'esperando_confirmacion', ubicacionEstado: 'no_hace_falta', confirmacionEstado: 'pendiente' }))).toBe('falta_confirmar');
    expect(etapaDe(con({ estado: 'lista', ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada' }))).toBe('contactados');
    expect(etapaDe(con({ estado: 'avisada', ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada' }))).toBe('contactados');
    expect(etapaDe(con({ estado: 'entregada', ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada' }))).toBe('contactados');
    expect(etapaDe(con({ estado: 'incidencia', requiereHumano: true }))).toBe('necesita');
    expect(etapaDe(con({ estado: 'incidencia', segundaVisitaPedidaAt: new Date(), ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada' }))).toBe('contactados');
    expect(etapaDe(con({ estado: 'cancelada' }))).toBe('cancelada');
    // La marca a mano manda sobre la etapa automática, salvo que necesite a alguien.
    expect(etapaDe(con({ contactadoAt: new Date() }))).toBe('contactados');
    expect(etapaDe(con({ contactadoAt: new Date(), estado: 'incidencia', requiereHumano: true }))).toBe('necesita');
  });

  it('el aviso habla en singular y en plural', () => {
    expect(avisoEnPalabras('pedir_ubicacion', 12, { ya_tiene_ubicacion: 3 })).toBe('Se pidió la ubicación a 12; 3 ya la habían mandado y se saltaron. Salen de uno en uno, con la pausa de siempre entre mensaje y mensaje.');
    expect(avisoEnPalabras('reanudar', 0, { no_pausado: 2 })).toBe('No se reanudó ninguno; 2 no estaban en pausa y se saltaron.');
  });
});

// ----------------------------------------------------------- el SQL real

describe('Números del día contra MySQL/MariaDB: las columnas de la migración 038', () => {
  let b: BaseDePrueba;
  let pool: Pool;
  let repos: Repos;

  beforeAll(async () => {
    b = await baseDePrueba();
    pool = b.pool;
    repos = createRepos(pool);
  });
  afterAll(async () => {
    await b?.cerrar();
  });

  it('guarda la marca y la pausa, y la pausa saca al número de las colas de confirmar y de proponer dirección', async () => {
    const { entrega } = await repos.entregas.crearEntrega({ dia: '2026-09-24', referencia: 'S-1', phone: '51987400901', nombre: 'Uno', ubicacionEstado: 'recibida', confirmacionEstado: 'pendiente', estado: 'esperando_confirmacion' });
    const propuesta = (await repos.entregas.crearEntrega({ dia: '2026-09-24', referencia: 'S-2', phone: '51987400902', nombre: 'Dos', ubicacionEstado: 'pendiente', confirmacionEstado: 'pendiente', estado: 'pendiente' })).entrega;
    await repos.entregas.actualizar(propuesta.id, { ubicacionPropuestaLat: -12.1, ubicacionPropuestaLng: -77.0 });
    const ahora = new Date('2026-09-24T15:00:00Z');
    expect((await repos.entregas.tocaPedirConfirmacion(ahora, 10)).map((x) => x.id)).toContain(entrega.id);
    expect((await repos.entregas.tocaProponerUbicacion(ahora, 10)).map((x) => x.id)).toContain(propuesta.id);

    const cuando = new Date('2026-09-24T14:30:00Z');
    const act = await repos.entregas.actualizar(entrega.id, { contactadoAt: cuando, contactadoPor: 'Ana', mensajesPausadosAt: cuando });
    await repos.entregas.actualizar(propuesta.id, { mensajesPausadosAt: cuando });
    expect(act?.contactadoAt?.toISOString()).toBe(cuando.toISOString());
    expect(act?.contactadoPor).toBe('Ana');
    expect(act?.mensajesPausadosAt?.toISOString()).toBe(cuando.toISOString());
    expect((await repos.entregas.tocaPedirConfirmacion(ahora, 10)).map((x) => x.id)).not.toContain(entrega.id);
    expect((await repos.entregas.tocaProponerUbicacion(ahora, 10)).map((x) => x.id)).not.toContain(propuesta.id);
    expect(await repos.entregas.pausadoPorTelefono('51987400901')).toBe(true);
    expect(await repos.entregas.pausadoPorTelefono('51987400999')).toBe(false);

    await repos.entregas.actualizar(entrega.id, { contactadoAt: null, contactadoPor: null, mensajesPausadosAt: null });
    const limpia = await repos.entregas.entrega(entrega.id);
    expect(limpia?.contactadoAt).toBeNull();
    expect(limpia?.mensajesPausadosAt).toBeNull();
    expect(await repos.entregas.pausadoPorTelefono('51987400901')).toBe(false);
    expect((await repos.entregas.tocaPedirConfirmacion(ahora, 10)).map((x) => x.id)).toContain(entrega.id);
  });
});
