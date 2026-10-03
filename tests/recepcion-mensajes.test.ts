/**
 * El flujo entero de un pedido de GSG y su primer mensaje, con el servidor
 * real y WhatsApp de mentira (nada sale a un cliente de verdad):
 *
 *   POST /api/v1/entregas → queda guardado con su id real y sale en Hoy
 *     → el reparto le pide la ubicación (el primer mensaje)
 *     → si WhatsApp falla: el pedido sigue, el mensaje va a reintento o a la bandeja
 *     → «Reintentar mensaje» usa el pedido que ya existe
 *
 * Y lo que no puede pasar: dos pedidos o dos mensajes por pedidos repetidos,
 * clics dobles o reintentos; un mensaje antes de «Confirmar y enviar»; un
 * reenvío a ciegas de un resultado incierto.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, conPais, type EscenarioEntregas } from './escenario-entregas.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';
import type { ItemBandejaMensajes } from '../src/entregas/servicio.js';

/** Lo que GSG manda siempre (obligatorio en el contrato). */
const GSG = { empresa: { codigo: 'T01', nombre: 'Tienda Prueba' }, metodoPago: 'Contraentrega', montoCobrar: 59.9 };
const pedido = (tracking: string, telefono: string, extra: Record<string, unknown> = {}) => ({ ...GSG, tracking, cliente: `Cliente ${tracking}`, telefono, direccion: 'Av. Larco 345', distrito: 'Miraflores', ...extra });

type Creadas = { ok: boolean; creadas: Array<Record<string, any>>; repetidas: string[]; existentes: Array<{ referencia: string; id: number | null }>; avisosMensaje?: Array<Record<string, unknown>>; detalle: string };

let esc: EscenarioEntregas;
afterEach(async () => {
  await esc?.cerrar();
});

/** Las peticiones de ubicación que salieron hacia un teléfono (el primer mensaje del reparto). */
const pedidosDeUbicacion = (telefono: string) => esc.wa.sent.filter((m) => m.to === conPais(telefono) && JSON.stringify(m).includes('location'));
const bandeja = async () => (await esc.api.get<{ ok: boolean; total: number; items: ItemBandejaMensajes[] }>('/admin/entregas/mensajes/errores')).body;
const mensajeDe = async (tracking: string) => (await esc.repos.entregas.porDiaYReferencia((await esc.resumen()).dia, tracking))!;
const reintentar = (id: number, body: Record<string, unknown> = {}) => esc.api.post<Record<string, any>>(`/admin/entregas/${id}/mensaje/reintentar`, body);

describe('pedido válido', () => {
  beforeEach(async () => {
    esc = await crearEscenarioEntregas();
  });

  it('queda guardado, devuelve su id real (el de la base) y aparece en Hoy de su tienda', async () => {
    const r = await esc.api.post<Creadas>('/api/v1/entregas', pedido('GSG-1001', '987100001', { id: 'luis-77' }));
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    const creada = r.body.creadas[0]!;
    expect(typeof creada.id).toBe('number');
    expect(creada.id).toBeGreaterThan(0);
    // El id de GSG se guarda y vuelve aparte: ya no se confunde con el nuestro.
    expect(creada.idExterno).toBe('luis-77');
    const enBase = await esc.repos.entregas.entrega(creada.id);
    expect(enBase).toMatchObject({ referencia: 'GSG-1001', externoId: 'luis-77', phone: '51987100001' });
    // Lo que GSG manda siempre llega a los datos del envío.
    expect(enBase!.datosEnvio).toMatchObject({ empresaCodigo: 'T01', empresaNombre: 'Tienda Prueba', metodoPago: 'Contraentrega' });
    // Hoy (lo que pinta la web) lo tiene, con el mismo id.
    const hoy = await esc.api.get<{ entregas: Array<{ id: number; referencia: string }> }>('/admin/entregas');
    expect(hoy.body.entregas.find((e) => e.referencia === 'GSG-1001')?.id).toBe(creada.id);
    // Y el GET de la API lo cuenta con el mismo id.
    const uno = await esc.api.get<{ entrega: { id: number } }>('/api/v1/entregas/GSG-1001');
    expect(uno.body.entrega.id).toBe(creada.id);
  });

  it('con más de 1000 pedidos en el día, el nuevo también sale en Hoy y en la respuesta (antes quedaba fuera del tope)', async () => {
    const dia = (await esc.resumen()).dia;
    for (let i = 0; i < 1000; i++) {
      await esc.repos.entregas.crearEntrega({ dia, referencia: `VIEJO-${i}`, phone: `5198700${String(i).padStart(4, '0')}`, ubicacionEstado: 'no_hace_falta', confirmacionEstado: 'no_hace_falta', estado: 'pendiente' });
    }
    const r = await esc.api.post<Creadas>('/api/v1/entregas', pedido('GSG-1500', '987150001'));
    expect(r.status).toBe(201);
    expect(r.body.creadas.map((c) => c.referencia)).toEqual(['GSG-1500']);
    const hoy = await esc.api.get<{ entregas: Array<{ referencia: string }> }>('/admin/entregas');
    expect(hoy.body.entregas).toHaveLength(1001);
    expect(hoy.body.entregas.some((e) => e.referencia === 'GSG-1500')).toBe(true);
    expect((await esc.api.get('/api/v1/entregas/GSG-1500')).status).toBe(200);
  });

  it('el primer mensaje sale una vez y queda «enviado»', async () => {
    const r = await esc.api.post<Creadas>('/api/v1/entregas', pedido('GSG-1002', '987100002'));
    expect(r.body.creadas[0]!.mensaje.estado).toBe('encolado');
    await esc.trabajar();
    expect(pedidosDeUbicacion('987100002')).toHaveLength(1);
    const e = await mensajeDe('GSG-1002');
    expect(e).toMatchObject({ mensajeEstado: 'enviado', mensajeVia: 'ubicacion', mensajeIntentos: 1, mensajeErrorCodigo: null });
    expect(e.mensajeWamid).toMatch(/^wamid\./);
    expect((await bandeja()).total).toBe(0);
  });
});

describe('fallo de WhatsApp', () => {
  beforeEach(async () => {
    esc = await crearEscenarioEntregas();
  });

  it('un fallo pasajero: el pedido sigue, sale en la bandeja reintentándose y se envía solo después de la espera', async () => {
    await esc.api.post('/api/v1/entregas', pedido('GSG-2001', '987200001'));
    esc.wa.failNext = new WhatsAppApiError('Service temporarily unavailable', 503, 131000, undefined, true);
    await esc.trabajar();
    let e = await mensajeDe('GSG-2001');
    expect(e.estado).not.toBe('cancelada');
    expect(e).toMatchObject({ mensajeEstado: 'reintentando', mensajeIntentos: 1, mensajeReintentosAuto: 1, mensajePermanente: false });
    expect(e.mensajeProximoAt!.getTime() - e.mensajeUltimoIntentoAt!.getTime()).toBe(60_000);
    const b = await bandeja();
    expect(b.items.map((x) => x.referencia)).toEqual(['GSG-2001']);
    expect(b.items[0]!.mensaje).toMatchObject({ estado: 'reintentando', intentos: 1, puedeReintentar: false });
    expect(b.items[0]!.mensaje.motivo).toMatch(/se reintenta solo/);
    // Antes de la espera no se insiste.
    esc.avanzarSegundos(30);
    await esc.trabajar();
    expect((await mensajeDe('GSG-2001')).mensajeIntentos).toBe(1);
    // Pasada la espera, sale (una sola vez) y deja la bandeja.
    esc.avanzarSegundos(31);
    await esc.trabajar();
    e = await mensajeDe('GSG-2001');
    expect(e).toMatchObject({ mensajeEstado: 'enviado', mensajeIntentos: 2, mensajeErrorCodigo: null });
    expect(pedidosDeUbicacion('987200001')).toHaveLength(1);
    expect((await bandeja()).total).toBe(0);
  });

  it('un error permanente (no tiene WhatsApp) no se reintenta solo y queda en la bandeja para corregirlo', async () => {
    await esc.api.post('/api/v1/entregas', pedido('GSG-2002', '987200002'));
    esc.wa.failNext = new WhatsAppApiError('(#131026) Message undeliverable', 400, 131026, undefined, false);
    await esc.trabajar();
    const e = await mensajeDe('GSG-2002');
    expect(e).toMatchObject({ mensajeEstado: 'fallido', mensajePermanente: true, mensajeErrorCodigo: 'sin_whatsapp' });
    esc.avanzar(120);
    await esc.trabajar();
    expect((await mensajeDe('GSG-2002')).mensajeIntentos).toBe(1);
    expect(pedidosDeUbicacion('987200002')).toHaveLength(0);
    const fila = (await bandeja()).items.find((x) => x.referencia === 'GSG-2002')!;
    expect(fila.mensaje).toMatchObject({ estado: 'fallido', permanente: true, puedeReintentar: true });
    expect(fila.mensaje.motivo).toMatch(/no tiene WhatsApp/);
    expect(fila).toMatchObject({ nombre: 'Cliente GSG-2002', telefono: '51987200002' });
    expect(fila.mensaje.ultimoIntentoEn).toBeTruthy();
  });

  it('el reparto no se pudo cargar al recibir: 201 con el pedido guardado, el fallo del mensaje aparte, y se recupera solo', async () => {
    const original = esc.repos.rutas.crearLote;
    esc.repos.rutas.crearLote = async () => {
      throw new Error('cola del reparto no disponible');
    };
    const r = await esc.api.post<Creadas>('/api/v1/entregas', pedido('GSG-2003', '987200003'));
    esc.repos.rutas.crearLote = original;
    expect(r.status).toBe(201);
    expect(r.body.creadas[0]!.id).toBeGreaterThan(0);
    expect(r.body.creadas[0]!.mensaje).toMatchObject({ estado: 'reintentando', codigo: 'no_encolado' });
    expect(r.body.avisosMensaje).toEqual([expect.objectContaining({ referencia: 'GSG-2003', estado: 'reintentando' })]);
    expect(r.body.detalle).toMatch(/guardados pero su primer mensaje no salió/);
    // Tras la espera, la revisión del motor lo vuelve a disparar sobre el MISMO pedido.
    esc.avanzar(2);
    await esc.trabajar();
    expect(await mensajeDe('GSG-2003')).toMatchObject({ mensajeEstado: 'enviado' });
    expect(pedidosDeUbicacion('987200003')).toHaveLength(1);
    expect((await esc.resumen()).entregas.filter((x) => x.referencia === 'GSG-2003')).toHaveLength(1);
  });
});

describe('reintento manual', () => {
  beforeEach(async () => {
    esc = await crearEscenarioEntregas();
  });

  it('procesa el mensaje del pedido existente: no crea otro, no se puede pulsar dos veces y sale una sola vez', async () => {
    const alta = await esc.api.post<Creadas>('/api/v1/entregas', pedido('GSG-3001', '987300001'));
    const id = alta.body.creadas[0]!.id as number;
    esc.wa.failNext = new WhatsAppApiError('(#131021) Recipient phone number not valid', 400, 131021, undefined, false);
    await esc.trabajar();
    expect(await mensajeDe('GSG-3001')).toMatchObject({ mensajeEstado: 'fallido', mensajeErrorCodigo: 'numero_invalido' });

    // Tres clics a la vez: solo uno entra.
    const r = await Promise.all([reintentar(id), reintentar(id), reintentar(id)]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 409, 409]);
    const rechazos = r.filter((x) => x.status === 409);
    for (const x of rechazos) expect(x.body).toMatchObject({ ok: false, codigo: 'MENSAJE_EN_CURSO' });
    // En curso: la bandeja lo enseña sin botón activo.
    const fila = (await bandeja()).items.find((x) => x.id === id)!;
    expect(fila.mensaje.puedeReintentar).toBe(false);

    await esc.trabajar();
    expect(await mensajeDe('GSG-3001')).toMatchObject({ mensajeEstado: 'enviado', mensajeIntentos: 2 });
    expect(pedidosDeUbicacion('987300001')).toHaveLength(1);
    expect((await esc.resumen()).entregas.filter((x) => x.referencia === 'GSG-3001')).toHaveLength(1);
    expect((await bandeja()).total).toBe(0);
    // Ya enviado: otro reintento se niega (no se manda dos veces).
    const otra = await reintentar(id);
    expect(otra.status).toBe(409);
    expect(otra.body.codigo).toBe('MENSAJE_YA_ENVIADO');
  });

  it('un resultado incierto no se reenvía solo ni sin confirmar', async () => {
    const alta = await esc.api.post<Creadas>('/api/v1/entregas', pedido('GSG-3002', '987300002'));
    const id = alta.body.creadas[0]!.id as number;
    esc.wa.failNext = new TypeError('fetch failed');
    await esc.trabajar();
    expect(await mensajeDe('GSG-3002')).toMatchObject({ mensajeEstado: 'incierto', mensajeErrorCodigo: 'resultado_incierto' });
    esc.avanzar(180);
    await esc.trabajar();
    expect((await mensajeDe('GSG-3002')).mensajeIntentos).toBe(1);
    const fila = (await bandeja()).items.find((x) => x.id === id)!;
    expect(fila.mensaje).toMatchObject({ estado: 'incierto', requiereConfirmar: true, puedeReintentar: true });
    const sinConfirmar = await reintentar(id);
    expect(sinConfirmar.status).toBe(409);
    expect(sinConfirmar.body.codigo).toBe('RESULTADO_INCIERTO');
    const confirmado = await reintentar(id, { confirmarIncierto: true });
    expect(confirmado.status).toBe(200);
    await esc.trabajar();
    expect(await mensajeDe('GSG-3002')).toMatchObject({ mensajeEstado: 'enviado' });
    expect(pedidosDeUbicacion('987300002')).toHaveLength(1);
  });

  it('lo que el servicio dejó «enviando» al cortarse pasa a incierto en la revisión (no se reenvía)', async () => {
    const alta = await esc.api.post<Creadas>('/api/v1/entregas', pedido('GSG-3003', '987300003'));
    const id = alta.body.creadas[0]!.id as number;
    // Como si el proceso se hubiera caído justo después de marcarlo.
    await esc.repos.entregas.cambiarMensaje(id, ['encolado'], { mensajeEstado: 'enviando', mensajeUltimoIntentoAt: esc.ahora() });
    esc.avanzar(5);
    const r = await esc.entregas.revisarMensajes();
    expect(r.inciertos).toBe(1);
    expect(await mensajeDe('GSG-3003')).toMatchObject({ mensajeEstado: 'incierto' });
    await esc.trabajar();
    expect(pedidosDeUbicacion('987300003')).toHaveLength(0);
  });

  it('id que no es de esta tienda: 404; id mal escrito: 400', async () => {
    expect((await reintentar(999_999)).status).toBe(404);
    expect((await reintentar(999_999)).body.codigo).toBe('NO_EXISTE');
    const malo = await esc.api.post<Record<string, any>>('/admin/entregas/abc/mensaje/reintentar', {});
    expect(malo.status).toBe(400);
    expect(malo.body.codigo).toBe('VALIDACION');
  });
});

describe('reintentos automáticos', () => {
  beforeEach(async () => {
    esc = await crearEscenarioEntregas();
    await esc.entregas.guardarAjustes({ mensajeReintentosMax: 2, mensajeReintentoBaseSeg: 60, mensajeReintentoMaxSeg: 1800 });
  });

  it('esperan cada vez el doble y paran en el límite configurado (a la bandeja)', async () => {
    await esc.api.post('/api/v1/entregas', pedido('GSG-4001', '987400001'));
    const falla = () => {
      esc.wa.failNext = new WhatsAppApiError('Service temporarily unavailable', 503, 131000, undefined, true);
    };
    falla();
    await esc.trabajar();
    let e = await mensajeDe('GSG-4001');
    expect(e).toMatchObject({ mensajeEstado: 'reintentando', mensajeIntentos: 1 });
    expect(e.mensajeProximoAt!.getTime() - e.mensajeUltimoIntentoAt!.getTime()).toBe(60_000);

    esc.avanzarSegundos(61);
    falla();
    await esc.trabajar();
    e = await mensajeDe('GSG-4001');
    expect(e).toMatchObject({ mensajeEstado: 'reintentando', mensajeIntentos: 2, mensajeReintentosAuto: 2 });
    expect(e.mensajeProximoAt!.getTime() - e.mensajeUltimoIntentoAt!.getTime()).toBe(120_000);

    // A los 60 s de la segunda espera todavía no toca.
    esc.avanzarSegundos(60);
    await esc.trabajar();
    expect((await mensajeDe('GSG-4001')).mensajeIntentos).toBe(2);

    esc.avanzarSegundos(61);
    falla();
    await esc.trabajar();
    e = await mensajeDe('GSG-4001');
    expect(e).toMatchObject({ mensajeEstado: 'fallido', mensajeIntentos: 3, mensajeErrorCodigo: 'reintentos_agotados', mensajePermanente: false });
    // Pasado el tope ya no lo intenta nadie solo.
    esc.avanzar(240);
    await esc.trabajar();
    expect((await mensajeDe('GSG-4001')).mensajeIntentos).toBe(3);
    expect(pedidosDeUbicacion('987400001')).toHaveLength(0);
    expect((await bandeja()).items.find((x) => x.referencia === 'GSG-4001')!.mensaje).toMatchObject({ estado: 'fallido', puedeReintentar: true });
  });

  it('el estado y los intentos viven en la base: otro motor (tras un reinicio) sigue donde iba', async () => {
    await esc.api.post('/api/v1/entregas', pedido('GSG-4002', '987400002'));
    esc.wa.failNext = new WhatsAppApiError('Service temporarily unavailable', 503, 131000, undefined, true);
    await esc.trabajar();
    const antes = await mensajeDe('GSG-4002');
    expect(antes).toMatchObject({ mensajeEstado: 'reintentando', mensajeIntentos: 1 });
    // Nada vive en memoria: lo que hace falta para seguir está en la fila.
    expect(antes.mensajeProximoAt).toBeInstanceOf(Date);
    esc.avanzarSegundos(61);
    await esc.trabajar();
    expect(await mensajeDe('GSG-4002')).toMatchObject({ mensajeEstado: 'enviado', mensajeIntentos: 2 });
  });
});

describe('solicitudes repetidas o simultáneas', () => {
  beforeEach(async () => {
    esc = await crearEscenarioEntregas();
  });

  it('el mismo pedido mandado cinco veces a la vez: un pedido y un mensaje', async () => {
    const r = await Promise.all(Array.from({ length: 5 }, () => esc.api.post<Creadas>('/api/v1/entregas', pedido('GSG-5001', '987500001'))));
    expect(r.filter((x) => x.status === 201)).toHaveLength(1);
    expect(r.filter((x) => x.status === 200)).toHaveLength(4);
    const id = r.find((x) => x.status === 201)!.body.creadas[0]!.id;
    for (const x of r.filter((y) => y.status === 200)) {
      expect(x.body.repetidas).toEqual(['GSG-5001']);
      expect(x.body.existentes).toEqual([{ referencia: 'GSG-5001', id }]);
    }
    expect((await esc.resumen()).entregas.filter((e) => e.referencia === 'GSG-5001')).toHaveLength(1);
    await esc.trabajar();
    // Reenviarlo después tampoco manda nada nuevo.
    await esc.api.post('/api/v1/entregas', pedido('GSG-5001', '987500001'));
    await esc.trabajar();
    expect(pedidosDeUbicacion('987500001')).toHaveLength(1);
  });

  it('el mismo tracking dos veces en la misma llamada cuenta una', async () => {
    const r = await esc.api.post<Creadas>('/api/v1/entregas', { pedidos: [pedido('GSG-5002', '987500002'), pedido('GSG-5002', '987500002')] });
    expect(r.status).toBe(201);
    expect(r.body.creadas).toHaveLength(1);
    expect(r.body.repetidas).toEqual(['GSG-5002']);
  });
});

describe('confirmación manual («Confirmar y enviar»)', () => {
  beforeEach(async () => {
    esc = await crearEscenarioEntregas({ confirmarLista: true });
  });

  it('no envía nada antes de confirmar, ni por reintento; al confirmar (dos veces a la vez) sale una sola vez', async () => {
    const alta = await esc.api.post<Creadas>('/api/v1/entregas', pedido('GSG-6001', '987600001'));
    const id = alta.body.creadas[0]!.id as number;
    expect(alta.body.creadas[0]!.mensaje.estado).toBe('retenido');
    esc.avanzar(30);
    await esc.trabajar();
    expect(pedidosDeUbicacion('987600001')).toHaveLength(0);
    expect(await mensajeDe('GSG-6001')).toMatchObject({ mensajeEstado: 'retenido', mensajeIntentos: 0 });
    // El botón de la bandeja no se salta la confirmación.
    const r = await reintentar(id);
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe('ESPERA_CONFIRMACION');
    expect((await bandeja()).total).toBe(0);

    const [a, b] = await Promise.all([
      esc.api.post<{ liberadas: number }>('/admin/entregas/confirmar-envio', { ids: [id] }),
      esc.api.post<{ liberadas: number }>('/admin/entregas/confirmar-envio', { ids: [id] }),
    ]);
    expect(a.body.liberadas + b.body.liberadas).toBe(1);
    await esc.trabajar();
    expect(pedidosDeUbicacion('987600001')).toHaveLength(1);
    expect(await mensajeDe('GSG-6001')).toMatchObject({ mensajeEstado: 'enviado' });
  });
});
