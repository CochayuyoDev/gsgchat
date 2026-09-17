/**
 * Lo que pasa en la operación de verdad, contra la API y con todo lo de
 * fuera mockeado (ver `escenario-reparto.ts`).
 *
 * `reparto-escenarios.test.ts` recorre el día limpio: se carga, se escribe,
 * contestan, se reporta. Aquí van las cosas que pasan alrededor: la lista
 * viene sucia de Excel, el cliente manda una foto en vez del pin, se
 * equivoca y manda otro, escribe antes de que le pidan nada, el operador
 * pausa el lote o corrige un número, GSG carga la lista dos veces, el modo
 * prueba frena a quien no está en la lista, y el número se frena solo cuando
 * la gente contesta "no soy yo".
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Solicitud } from '../src/db/rutas.js';
import {
  clientesDePrueba,
  conPais,
  crearEscenario,
  PIN_LIMA,
  type Escenario,
} from './escenario-reparto.js';

const pinDe = (i: number) => ({ lat: PIN_LIMA.lat + i * 0.001, lng: PIN_LIMA.lng - i * 0.001 });

// =====================================================================
// 1. La lista tal como la manda GSG: pegada de Excel, con sus manías
// =====================================================================

describe('la lista pegada tal como viene de Excel', () => {
  let e: Escenario;

  beforeAll(async () => {
    e = await crearEscenario();
  });

  afterAll(async () => {
    await e.cerrar();
  });

  // Tabuladores (así pega Excel), cabeceras con tilde y "N° Pedido", teléfonos
  // en todos los formatos que se ven, una fila en blanco, un fijo, uno corto,
  // uno repetido con otro pedido y uno sin teléfono.
  const TABLA = [
    'Teléfono\tCliente\tN° Pedido\tDistrito\tDirección',
    '+51 987 654 321\tAna Ruiz\tGSG-1\tMiraflores\tAv. Larco 123',
    '987-654-322\tLuis Paz\tGSG-2\tSurco\tJr. Puno 340',
    '51987654323\tMarta Gil\tGSG-3\tSan Borja\t',
    '0987654324\tJosé Vera\tGSG-4\tLince\tCalle 5 s/n',
    '',
    '(01) 456-7890\tOficina Central\tGSG-5\tCercado\tJr. de la Unión 1',
    '9876543\tPedro Soto\tGSG-6\tBreña\t',
    '987 654 321\tAna Ruiz (2do pedido)\tGSG-7\tMiraflores\tAv. Larco 123',
    '\tSin Teléfono\tGSG-8\tJesús María\t',
    '987.654.327\tCarla Núñez\tGSG-9\tPueblo Libre\t',
  ].join('\n');

  it('previsualizar cuenta lo que hay antes de guardar nada', async () => {
    const { status, body } = await e.api.post<{
      conCabecera: boolean;
      columnas: Record<string, unknown>;
      total: number;
      listas: number;
      conIncidencia: number;
      duplicadas: number;
      incidencias: Record<string, number>;
      descartadas: unknown[];
    }>('/admin/rutas/previsualizar', { texto: TABLA });

    expect(status).toBe(200);
    expect(body.conCabecera).toBe(true);
    // Cada columna cayó donde tenía que caer, aunque se llamen a su manera.
    expect(body.columnas).toMatchObject({ telefono: 'Teléfono', nombre: 'Cliente', referencia: 'N° Pedido', distrito: 'Distrito', direccion: 'Dirección' });
    // 9 filas con algo (la vacía se descarta): 5 buenas + 1 repetida + 3 rotas
    // (el fijo, el corto y el pedido que vino sin teléfono).
    expect(body).toMatchObject({ total: 9, descartadas: [], listas: 5, duplicadas: 1, conIncidencia: 3 });
    expect(body.incidencias).toEqual({ numero_fijo: 1, numero_corto: 1, numero_invalido: 1 });
    expect(e.repos.rutas._lotes).toHaveLength(0);
  });

  it('al cargarla, cada teléfono queda normalizado con 51 y los rotos con su motivo', async () => {
    const { body } = await e.api.post<{ lote: { id: string }; total: number; listas: number; duplicadas: number }>(
      '/admin/rutas/lotes',
      { nombre: 'Del Excel', texto: TABLA, arrancar: true },
    );
    const loteId = body.lote.id;
    expect(body).toMatchObject({ listas: 5, duplicadas: 1 });

    const { items } = await e.solicitudes({ loteId, limit: 50 });
    const porPedido = Object.fromEntries(items.map((s) => [s.referencia, s]));
    expect(porPedido['GSG-1']).toMatchObject({ phone: '51987654321', nombre: 'Ana Ruiz', distrito: 'Miraflores', direccion: 'Av. Larco 123' });
    expect(porPedido['GSG-2']).toMatchObject({ phone: '51987654322' });
    expect(porPedido['GSG-3']).toMatchObject({ phone: '51987654323' });
    expect(porPedido['GSG-4']).toMatchObject({ phone: '51987654324', telefonoCrudo: '0987654324' });
    expect(porPedido['GSG-9']).toMatchObject({ phone: '51987654327' });
    expect(porPedido['GSG-5']).toMatchObject({ phone: null, estado: 'incidencia', incidencia: 'numero_fijo' });
    expect(porPedido['GSG-6']).toMatchObject({ phone: null, incidencia: 'numero_corto' });
    expect(porPedido['GSG-6']!.incidenciaDetalle).toMatch(/faltan 2/);
    expect(porPedido['GSG-8']).toMatchObject({ phone: null, incidencia: 'numero_invalido', nombre: 'Sin Teléfono' });
    expect(porPedido['GSG-8']!.incidenciaDetalle).toMatch(/vac[ií]o/);
    // El segundo pedido de Ana no crea otra solicitud: se anota en la suya.
    expect(porPedido['GSG-7']).toBeUndefined();
    expect(porPedido['GSG-1']!.notas).toContain('GSG-7');

    // Se escribe una sola vez a cada número bueno.
    const hecho = await e.trabajar();
    expect(hecho.filter((h) => h.accion === 'envio')).toHaveLength(5);
    expect(e.mensajesA('987654321')).toHaveLength(1);

    const faltan = await e.sinUbicacion(loteId);
    expect(faltan.total).toBe(8);
    expect(faltan.telefonos).toEqual(
      expect.arrayContaining(['51987654321', '51987654322', '51987654323', '51987654324', '51987654327', '(01) 456-7890', '9876543']),
    );
  });

  it('una tabla con las columnas en otro orden y separada por punto y coma también entra', async () => {
    const { status, body } = await e.api.post<{ listas: number; total: number }>('/admin/rutas/lotes', {
      nombre: 'Otro formato',
      texto: 'pedido;nombre;celular\nX-1;Rosa Díaz;987 111 222\nX-2;Juan Roca;+51 987 111 223',
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ total: 2, listas: 2 });
    expect((await e.buscar('X-2'))[0]).toMatchObject({ phone: '51987111223', nombre: 'Juan Roca' });
  });
});

// =====================================================================
// 2. Lo que contesta la gente que no es ni pin ni texto
// =====================================================================

describe('respuestas que no son un pin', () => {
  let e: Escenario;
  let loteId = '';

  beforeAll(async () => {
    e = await crearEscenario();
    loteId = (await e.cargarLote('Adjuntos', clientesDePrueba(4, 987800001))).loteId;
    await e.trabajar();
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('una foto de la fachada o un audio con la dirección cuentan como respuesta: lo mira una persona', async () => {
    await e.contesta('987800001', { adjunto: 'image' });
    await e.contesta('987800002', { adjunto: 'audio' });

    const [foto] = await e.buscar('987800001');
    expect(foto).toMatchObject({ estado: 'respondio', incidencia: 'respondio_sin_ubicacion', requiereHumano: true });
    expect(foto!.incidenciaDetalle).toMatch(/adjunto/);
    const [audio] = await e.buscar('987800002');
    expect(audio).toMatchObject({ estado: 'respondio', requiereHumano: true });

    expect(await e.vistas(loteId)).toMatchObject({ respondieron: 2, esperando: 2, requieren_persona: 2, sin_ubicacion: 4 });
  });

  it('un sticker es charla: no cambia nada', async () => {
    await e.contesta('987800003', { adjunto: 'sticker' });
    expect((await e.buscar('987800003'))[0]).toMatchObject({ estado: 'enviado', requiereHumano: false });
  });

  it('a quien mandó la foto se le insiste con el pin, y si lo manda queda resuelto', async () => {
    const hecho = await e.insistir();
    expect(hecho.filter((h) => h.paso === 'insistencia')).toHaveLength(2);
    expect(hecho.filter((h) => h.paso === 'recordatorio')).toHaveLength(2);

    await e.contesta('987800001', { pin: pinDe(1) });
    expect((await e.buscar('987800001'))[0]).toMatchObject({ estado: 'resuelto', requiereHumano: false, incidencia: null });
    expect(await e.vistas(loteId)).toMatchObject({ resueltos: 1, respondieron: 1, sin_ubicacion: 3 });
  });
});

// =====================================================================
// 3. El cliente que escribe antes, y el que se corrige
// =====================================================================

describe('escribir antes de tiempo y corregirse después', () => {
  let e: Escenario;
  let loteId = '';

  beforeAll(async () => {
    e = await crearEscenario();
    loteId = (await e.cargarLote('Anticipados', clientesDePrueba(3, 987900001))).loteId;
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('quien escribe antes de que se le pida nada no cuenta como "contestó": el primer mensaje sale igual', async () => {
    await e.contesta('987900001', { texto: 'hola, ¿a qué hora llegan hoy?' });

    const [antes] = await e.buscar('987900001');
    expect(antes).toMatchObject({ estado: 'pendiente', intentos: 0, requiereHumano: false, incidencia: null });
    const ficha = await e.api.get<{ eventos: Array<{ tipo: string; detalle: string | null }> }>(`/admin/rutas/solicitudes/${antes!.id}`);
    expect(ficha.body.eventos.some((ev) => /antes de que le pidiéramos/.test(ev.detalle ?? ''))).toBe(true);

    await e.trabajar();
    expect((await e.buscar('987900001'))[0]).toMatchObject({ estado: 'enviado', intentos: 1 });
    expect(e.mensajesA('987900001').some((m) => m.kind === 'location_request')).toBe(true);
  });

  it('un segundo pin corrige al primero mientras el lote está en marcha, y GSG recibe el corregido', async () => {
    await e.contesta('987900002', { pin: pinDe(2) });
    const [primera] = await e.buscar('987900002');
    expect(primera).toMatchObject({ estado: 'resuelto' });
    expect(primera!.lat).toBeCloseTo(pinDe(2).lat, 5);

    // "Mejor mándamelo a este otro punto".
    await e.contesta('987900002', { pin: pinDe(20) });
    const [corregida] = await e.buscar('987900002');
    expect(corregida!.estado).toBe('resuelto');
    expect(corregida!.lat).toBeCloseTo(pinDe(20).lat, 5);
    expect(corregida!.lng).toBeCloseTo(pinDe(20).lng, 5);
    // Sigue contando una sola vez: es la misma persona.
    expect(await e.cifrasLote(loteId)).toMatchObject({ conUbicacion: 1, sinUbicacion: 2 });

    const ficha = await e.api.get<{ eventos: Array<{ tipo: string; detalle: string | null }> }>(`/admin/rutas/solicitudes/${corregida!.id}`);
    expect(ficha.body.eventos.filter((ev) => ev.tipo === 'ubicacion')).toHaveLength(2);
    expect(ficha.body.eventos.some((ev) => /corregida por el cliente/.test(ev.detalle ?? ''))).toBe(true);

    await e.despacharAGsg();
    const deEste = e.gsg.ubicaciones().filter((u) => u.telefono === '51987900002');
    expect(deEste).toHaveLength(2);
    expect(deEste[0]).not.toHaveProperty('corregida');
    expect(deEste[1]).toMatchObject({ corregida: true, referencia: 'P-1002' });
    expect(deEste[1]!.lat).toBeCloseTo(pinDe(20).lat, 5);
    // Y se le vuelve a dar las gracias, no se le deja hablando solo.
    expect(e.mensajesA('987900002').filter((m) => /recibimos/i.test(String(m.body ?? '')))).toHaveLength(2);
  });

  it('con el lote terminado un pin nuevo ya no toca nada del reparto', async () => {
    await e.api.post(`/admin/rutas/lotes/${loteId}/estado`, { estado: 'terminado' });
    await e.contesta('987900002', { pin: pinDe(30) });

    const [igual] = await e.buscar('987900002');
    expect(igual!.lat).toBeCloseTo(pinDe(20).lat, 5);
    expect(e.gsg.ubicaciones().filter((u) => u.telefono === '51987900002')).toHaveLength(2);
    expect((await e.api.get<{ cifras: Record<string, number> }>('/admin/rutas/cola')).body.cifras.pendiente ?? 0).toBe(0);
  });
});

// =====================================================================
// 4. Lo que hace el operador con el lote
// =====================================================================

describe('pausar, reanudar, terminar y borrar el lote', () => {
  let e: Escenario;
  let loteId = '';

  beforeAll(async () => {
    e = await crearEscenario();
    loteId = (await e.cargarLote('Con pausa', clientesDePrueba(4, 988000001))).loteId;
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('pausado, el motor no escribe a nadie; al reanudar sigue por donde iba', async () => {
    await e.api.post(`/admin/rutas/lotes/${loteId}/estado`, { estado: 'pausado' });
    expect(await e.trabajar()).toHaveLength(0);
    expect(e.wa.sent).toHaveLength(0);
    expect(await e.vistas(loteId)).toMatchObject({ pendientes: 4 });

    const estado = await e.api.get<{ motor: { trabajando: boolean }; lotes: Array<{ id: string; estado: string }> }>('/admin/rutas');
    expect(estado.body.motor.trabajando).toBe(false);
    expect(estado.body.lotes.find((l) => l.id === loteId)?.estado).toBe('pausado');

    await e.api.post(`/admin/rutas/lotes/${loteId}/estado`, { estado: 'enviando' });
    expect((await e.trabajar()).filter((h) => h.accion === 'envio')).toHaveLength(4);
  });

  it('pausar a mitad de camino deja de insistir pero sigue leyendo respuestas', async () => {
    await e.api.post(`/admin/rutas/lotes/${loteId}/estado`, { estado: 'pausado' });
    expect(await e.insistir()).toHaveLength(0);

    await e.contesta('988000001', { pin: pinDe(1) });
    expect((await e.buscar('988000001'))[0]).toMatchObject({ estado: 'resuelto' });
    expect(await e.cifrasLote(loteId)).toMatchObject({ conUbicacion: 1, sinUbicacion: 3 });

    await e.api.post(`/admin/rutas/lotes/${loteId}/estado`, { estado: 'enviando' });
    expect((await e.trabajar()).filter((h) => h.accion === 'envio')).toHaveLength(3);
  });

  it('terminarlo a mano manda el resumen a GSG y deja de escribir a los que faltan', async () => {
    await e.api.post(`/admin/rutas/lotes/${loteId}/estado`, { estado: 'terminado' });
    expect(await e.insistir()).toHaveLength(0);

    // El cierre a mano no encola resumen (eso lo hace el motor al agotar el
    // lote); lo que sí está es la ubicación conseguida.
    await e.despacharAGsg();
    expect(e.gsg.ubicaciones()).toHaveLength(1);
  });

  it('borrar el lote se lleva sus clientes de todas las listas y su cola', async () => {
    const { loteId: equivocadoId } = await e.cargarLote('Equivocado', clientesDePrueba(3, 988100001));
    const equivocado = e.repos.rutas._lotes.find((l) => l.id === equivocadoId)!;
    const [uno] = await e.buscar('988100001');
    await e.contesta('988100001', { pin: pinDe(1) });
    expect(e.repos.rutas._reportes.some((r) => r.loteId === equivocado.id)).toBe(true);

    const res = await e.api.delete(`/admin/rutas/lotes/${equivocado.id}`);
    expect(res.status).toBe(200);

    expect((await e.api.get(`/admin/rutas/lotes/${equivocado.id}`)).status).toBe(404);
    expect((await e.api.get(`/admin/rutas/solicitudes/${uno!.id}`)).status).toBe(404);
    expect(await e.buscar('988100001')).toHaveLength(0);
    expect((await e.sinUbicacion()).telefonos).not.toContain('51988100002');
    expect(e.repos.rutas._reportes.some((r) => r.loteId === equivocado.id)).toBe(false);
  });
});

// =====================================================================
// 5. Devolver a la cola lo que se arregló fuera del sistema
// =====================================================================

describe('reintentar a mano', () => {
  let e: Escenario;
  let loteId = '';
  const SIN_WA = conPais('988200003');

  beforeAll(async () => {
    e = await crearEscenario({ sinWhatsApp: [SIN_WA] });
    loteId = (await e.cargarLote('Reintentos', clientesDePrueba(3, 988200001))).loteId;
    await e.trabajar();
    await e.insistir();
    await e.insistir();
    await e.insistir();
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('el derivado vuelve a la cola desde cero y recibe la primera petición otra vez', async () => {
    const [derivado] = await e.buscar('988200001');
    expect(derivado).toMatchObject({ estado: 'derivado', intentos: 3 });
    expect(e.mensajesA('988200001')).toHaveLength(3);

    const res = await e.api.post<{ solicitud: Solicitud }>(`/admin/rutas/solicitudes/${derivado!.id}/reintentar`);
    expect(res.status).toBe(200);
    expect(res.body.solicitud).toMatchObject({ estado: 'pendiente', intentos: 0, incidencia: null, requiereHumano: false });

    // El lote se había cerrado solo al no quedar nadie vivo: hay que volver a abrirlo.
    await e.api.post(`/admin/rutas/lotes/${loteId}/estado`, { estado: 'enviando' });
    const hecho = await e.trabajar();
    expect(hecho.filter((h) => h.accion === 'envio' && h.paso === 'solicitud')).toHaveLength(1);
    expect(e.mensajesA('988200001')).toHaveLength(4);
    expect(await e.vistas(loteId)).toMatchObject({ esperando: 1, derivados: 1, sin_whatsapp: 1 });
  });

  it('el que no tenía WhatsApp y ya lo instaló: se levanta y se le escribe', async () => {
    const [sinWa] = await e.buscar('988200003');
    expect(sinWa).toMatchObject({ estado: 'incidencia', incidencia: 'sin_whatsapp' });
    expect(e.mensajesA('988200003')).toHaveLength(0);

    // Sigue sin WhatsApp: reintentar lo vuelve a apartar sin escribirle.
    await e.api.post(`/admin/rutas/solicitudes/${sinWa!.id}/reintentar`);
    await e.trabajar();
    expect((await e.buscar('988200003'))[0]).toMatchObject({ estado: 'incidencia', incidencia: 'sin_whatsapp' });
    expect(e.mensajesA('988200003')).toHaveLength(0);

    // Ahora sí lo tiene (el proveedor lo dice) y el número estaba suprimido
    // un mes: al levantar la supresión y reintentar, sale.
    e.sinWhatsApp.delete(SIN_WA);
    await e.api.post('/admin/salud/contactos/levantar', { phone: SIN_WA });
    await e.api.post(`/admin/rutas/solicitudes/${sinWa!.id}/reintentar`);
    await e.trabajar();
    expect((await e.buscar('988200003'))[0]).toMatchObject({ estado: 'enviado', intentos: 1, incidencia: null });
    expect(e.mensajesA('988200003')).toHaveLength(1);
  });
});

// =====================================================================
// 6. El mismo cliente, otro día
// =====================================================================

describe('el mismo cliente en el reparto de mañana', () => {
  let e: Escenario;

  beforeAll(async () => {
    e = await crearEscenario();
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('con el lote de ayer cerrado, hoy se le vuelve a escribir con normalidad', async () => {
    const ayer = await e.cargarLote('Ayer', [{ telefono: '988300001', nombre: 'Ana', referencia: 'AYER-1' }]);
    await e.trabajar();
    await e.contesta('988300001', { pin: pinDe(1) });
    await e.trabajar(); // sin nadie vivo, el motor cierra el lote
    expect((await e.cifrasLote(ayer.loteId)).lote.estado).toBe('terminado');

    e.avanzar(24 * 60);
    const hoy = await e.cargarLote('Hoy', [{ telefono: '988300001', nombre: 'Ana', referencia: 'HOY-1' }]);
    const [deHoy] = await e.buscar('HOY-1');
    expect(deHoy).toMatchObject({ estado: 'pendiente', incidencia: null });

    await e.trabajar();
    expect((await e.buscar('HOY-1'))[0]).toMatchObject({ estado: 'enviado', intentos: 1 });
    expect(e.mensajesA('988300001').filter((m) => m.kind === 'location_request')).toHaveLength(2);

    // Y el pin de hoy resuelve el de hoy, no toca el de ayer.
    await e.contesta('988300001', { pin: pinDe(5) });
    expect((await e.buscar('HOY-1'))[0]).toMatchObject({ estado: 'resuelto' });
    expect((await e.buscar('AYER-1'))[0]!.lat).toBeCloseTo(pinDe(1).lat, 5);
    expect(await e.cifrasLote(hoy.loteId)).toMatchObject({ conUbicacion: 1, sinUbicacion: 0 });
  });

  it('si ayer pasó al repartidor (el bot ya se rindió), hoy es otro pedido y se le vuelve a escribir', async () => {
    await e.cargarLote('Ayer 2', [{ telefono: '988300002', nombre: 'Luis', referencia: 'AYER-2' }]);
    await e.trabajar();
    await e.insistir();
    await e.insistir();
    await e.insistir();
    expect((await e.buscar('AYER-2'))[0]).toMatchObject({ estado: 'derivado' });
    expect(e.mensajesA('988300002')).toHaveLength(3);

    await e.cargarLote('Hoy 2', [{ telefono: '988300002', nombre: 'Luis', referencia: 'HOY-2' }]);
    await e.trabajar();
    expect((await e.buscar('HOY-2'))[0]).toMatchObject({ estado: 'enviado', intentos: 1, incidencia: null });
    expect(e.mensajesA('988300002')).toHaveLength(4);

    // El pin de hoy resuelve el de hoy; el de ayer se queda como lo dejó el repartidor.
    await e.contesta('988300002', { pin: pinDe(7) });
    expect((await e.buscar('HOY-2'))[0]).toMatchObject({ estado: 'resuelto' });
    expect((await e.buscar('AYER-2'))[0]).toMatchObject({ estado: 'derivado' });
  });

  it('si ayer dijo "no soy yo" (caso en revisión), hoy queda como "ya en curso" y no se le escribe', async () => {
    await e.cargarLote('Ayer 3', [{ telefono: '988300003', nombre: 'Marta', referencia: 'AYER-3' }]);
    await e.trabajar();
    await e.contesta('988300003', { noSoyYo: true });
    expect((await e.buscar('AYER-3'))[0]).toMatchObject({ estado: 'supervision', incidencia: 'numero_equivocado' });

    await e.cargarLote('Hoy 3', [{ telefono: '988300003', nombre: 'Marta', referencia: 'HOY-3' }]);
    await e.trabajar();
    const [hoy] = await e.buscar('HOY-3');
    expect(hoy).toMatchObject({ estado: 'incidencia', incidencia: 'ya_en_curso', requiereHumano: true });
    expect(hoy!.incidenciaDetalle).toContain('AYER-3');
    // Un mensaje de ayer y la disculpa: hoy nada.
    expect(e.mensajesA('988300003')).toHaveLength(2);
  });
});

// =====================================================================
// 7. Los avisos no se repiten
// =====================================================================

describe('la cadencia de los avisos', () => {
  const SUPERVISOR = '51999111222';
  let e: Escenario;

  beforeAll(async () => {
    e = await crearEscenario({ supervisor: SUPERVISOR });
    await e.cargarLote('Avisos', clientesDePrueba(5, 988400001));
    await e.trabajar();
    await e.contesta('988400001', { texto: 'por el parque' });
    await e.contesta('988400002', { noSoyYo: true });
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('un resumen cada media hora y un aviso al coordinador cada hora, no más', async () => {
    expect(await e.revisarAlertas()).toMatchObject({ resumenes: 1, avisos: 1 });
    expect(e.mensajesA(SUPERVISOR)).toHaveLength(1);
    expect(String(e.mensajesA(SUPERVISOR)[0]!.body)).toMatch(/0 de 5 con ubicación/);

    // Al minuto siguiente, nada nuevo.
    e.avanzar(1);
    expect(await e.revisarAlertas()).toMatchObject({ resumenes: 0, avisos: 0 });

    // A la media hora, otro resumen para GSG; al coordinador todavía no.
    e.avanzar(30);
    expect(await e.revisarAlertas()).toMatchObject({ resumenes: 1, avisos: 0 });
    expect(e.mensajesA(SUPERVISOR)).toHaveLength(1);

    // A la hora, el coordinador recibe el segundo, con las cifras al día.
    await e.contesta('988400003', { pin: pinDe(3) });
    e.avanzar(30);
    expect(await e.revisarAlertas()).toMatchObject({ resumenes: 1, avisos: 1 });
    expect(String(e.mensajesA(SUPERVISOR)[1]!.body)).toMatch(/1 de 5 con ubicación/);

    await e.despacharAGsg();
    expect(e.gsg.resumenes()).toHaveLength(3);
    expect(e.gsg.resumenes().map((r) => r.conUbicacion)).toEqual([0, 0, 1]);
  });

  it('sin lotes en marcha no se avisa de nada', async () => {
    for (const l of e.repos.rutas._lotes) await e.api.post(`/admin/rutas/lotes/${l.id}/estado`, { estado: 'terminado' });
    e.avanzar(120);
    const salida = await e.revisarAlertas();
    expect(salida).toMatchObject({ resumenes: 0, avisos: 0 });
    expect(salida.motivo).toMatch(/no hay ning[uú]n lote/);
  });
});

// =====================================================================
// 8. Los ajustes de la pantalla mandan sobre el motor
// =====================================================================

describe('los ajustes cambiados desde la pantalla', () => {
  let e: Escenario;
  let loteId = '';

  beforeAll(async () => {
    e = await crearEscenario();
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('con dos intentos y diez minutos de espera, se deriva antes y sin reiniciar nada', async () => {
    const guardado = await e.api.post<{ vigente: { maxIntentos: number; esperaRespuestaMinutos: number } }>('/admin/rutas/ajustes', {
      maxIntentos: 2,
      esperaRespuestaMinutos: 10,
    });
    expect(guardado.status).toBe(200);
    expect(guardado.body.vigente).toMatchObject({ maxIntentos: 2, esperaRespuestaMinutos: 10 });

    loteId = (await e.cargarLote('Ajustado', clientesDePrueba(2, 988500001))).loteId;
    await e.trabajar();
    // A los 11 minutos ya toca el recordatorio (antes eran 30).
    expect((await e.insistir(10)).filter((h) => h.paso === 'recordatorio')).toHaveLength(2);
    // Y al siguiente, con dos mensajes ya, pasan al repartidor.
    const tercera = await e.insistir(10);
    expect(tercera.filter((h) => h.accion === 'derivacion')).toHaveLength(2);

    const [uno] = await e.buscar('988500001');
    expect(uno).toMatchObject({ estado: 'derivado', intentos: 2 });
    expect(e.mensajesA('988500001')).toHaveLength(2);
    expect(await e.vistas(loteId)).toMatchObject({ derivados: 2, sin_ubicacion: 2 });
  });

  it('borrar los ajustes vuelve a lo de la configuración', async () => {
    await e.api.delete('/admin/rutas/ajustes');
    const { body } = await e.api.get<{ ajustes: { maxIntentos: number; esperaRespuestaMinutos: number } }>('/admin/rutas/ajustes');
    expect(body.ajustes).toMatchObject({ maxIntentos: 3, esperaRespuestaMinutos: 180 });
  });
});

// =====================================================================
// 9. Modo prueba: solo a los números de la lista
// =====================================================================

describe('en modo prueba', () => {
  let e: Escenario;
  let loteId = '';
  const PERMITIDO = conPais('988600002');

  beforeAll(async () => {
    e = await crearEscenario({ soloNumeros: [PERMITIDO] });
    loteId = (await e.cargarLote('Modo prueba', clientesDePrueba(3, 988600001))).loteId;
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('solo sale el mensaje al número permitido; los demás quedan explicados, sin gastar intentos', async () => {
    const hecho = await e.trabajar();
    expect(hecho.filter((h) => h.accion === 'envio')).toHaveLength(1);
    expect(e.wa.sent.map((m) => m.to)).toEqual([PERMITIDO]);

    const [bloqueado] = await e.buscar('988600001');
    expect(bloqueado).toMatchObject({ estado: 'pendiente', intentos: 0, incidencia: 'envio_bloqueado', requiereHumano: false });
    expect(bloqueado!.incidenciaDetalle).toMatch(/modo prueba/);
    expect(bloqueado!.incidenciaDetalle).toMatch(/lista de numeros permitidos/);

    const faltan = await e.sinUbicacion(loteId);
    expect(faltan.total).toBe(3);
    expect(faltan.items.filter((s) => s.incidencia === 'envio_bloqueado')).toHaveLength(2);
    expect(await e.vistas(loteId)).toMatchObject({ esperando: 1, pendientes: 2, requieren_persona: 0 });
  });

  it('al quitar el modo prueba, a los bloqueados se les escribe en la siguiente vuelta', async () => {
    e.soloNumeros.length = 0;
    // Todavía no les toca: la guarda los dejó para dentro de quince minutos.
    expect((await e.trabajar()).filter((h) => h.accion === 'envio')).toHaveLength(0);

    e.avanzar(16);
    expect((await e.trabajar()).filter((h) => h.accion === 'envio')).toHaveLength(2);
    expect((await e.buscar('988600001'))[0]).toMatchObject({ estado: 'enviado', intentos: 1, incidencia: null });
    expect(await e.vistas(loteId)).toMatchObject({ esperando: 3, pendientes: 0 });
  });
});

// =====================================================================
// 10. La misma lista cargada dos veces
// =====================================================================

describe('la misma lista cargada dos veces por error', () => {
  let e: Escenario;

  beforeAll(async () => {
    e = await crearEscenario();
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('la segunda carga no escribe a nadie y lo dice caso por caso', async () => {
    const lista = clientesDePrueba(6, 988700001);
    const primera = await e.cargarLote('Lista de hoy', lista);
    await e.trabajar();
    expect(e.wa.sent).toHaveLength(6);

    const segunda = await e.cargarLote('Lista de hoy (otra vez)', lista);
    expect(segunda.cuerpo).toMatchObject({ total: 6 });
    await e.trabajar();
    expect(e.wa.sent).toHaveLength(6);

    expect(await e.cifrasLote(segunda.loteId)).toMatchObject({ total: 6, sinUbicacion: 6, incidencias: { ya_en_curso: 6 } });
    expect(await e.vistas(segunda.loteId)).toMatchObject({ requieren_persona: 6, esperando: 0 });
    const { items } = await e.solicitudes({ loteId: segunda.loteId, limit: 10 });
    expect(items.every((s) => s.incidencia === 'ya_en_curso' && /P-100\d/.test(s.incidenciaDetalle ?? ''))).toBe(true);

    // Borrar la repetida deja todo como estaba.
    await e.api.delete(`/admin/rutas/lotes/${segunda.loteId}`);
    expect(await e.vistas()).toMatchObject({ todos: 6, esperando: 6, requieren_persona: 0 });
    expect((await e.cifrasLote(primera.loteId)).total).toBe(6);
  });
});

// =====================================================================
// 11. El número se frena solo
// =====================================================================

describe('cuando la gente contesta "no soy yo" y BAJA, el número se frena solo', () => {
  let e: Escenario;
  let loteId = '';
  const clientes = clientesDePrueba(25, 988800001);
  const RECHAZADOS = clientes.slice(0, 5).map((c) => conPais(c.telefono));

  beforeAll(async () => {
    e = await crearEscenario({
      conSalud: true,
      rechazos: Object.fromEntries(RECHAZADOS.map((t) => [t, { code: 131026, message: '(#131026) Message Undeliverable' }])),
    });
    loteId = (await e.cargarLote('Lista sucia', clientes)).loteId;
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('se escribe a los 25: cinco no tienen WhatsApp según Meta', async () => {
    const hecho = await e.trabajar();
    expect(hecho.filter((h) => h.accion === 'envio')).toHaveLength(20);
    expect(await e.vistas(loteId)).toMatchObject({ esperando: 20, sin_whatsapp: 5 });
    expect((await e.api.get<{ nivel: string }>('/admin/salud')).body.nivel).toBe('verde');
  });

  it('tres "no soy yo" y dos BAJA en una lista con un 20 % de números muertos ponen el número en rojo y lo paran', async () => {
    for (const c of clientes.slice(5, 8)) await e.contesta(c.telefono, { noSoyYo: true });
    for (const c of clientes.slice(8, 10)) await e.contesta(c.telefono, { baja: true });

    const evaluacion = await e.api.post<{ riesgo: { nivel: string; puntos: number; motivos: string[] } }>('/admin/salud/evaluar');
    expect(evaluacion.body.riesgo.nivel).toBe('rojo');
    expect(evaluacion.body.riesgo.motivos.join(' ')).toMatch(/no soy yo/);
    expect(evaluacion.body.riesgo.motivos.join(' ')).toMatch(/bajas/);
    expect(evaluacion.body.riesgo.motivos.join(' ')).toMatch(/sin WhatsApp/);

    const salud = await e.api.get<{ nivel: string; factor: number; pausada: boolean; motivos: string[] }>('/admin/salud');
    expect(salud.body.nivel).toBe('rojo');
    expect(salud.body.factor).toBe(0);

    // El motor no manda nada más aunque toque insistir.
    const hecho = await e.insistir();
    expect(hecho.filter((h) => h.accion === 'envio')).toHaveLength(0);
    expect((await e.motor.tick()).motivo).toMatch(/parado/);
    const rutas = await e.api.get<{ motor: { salud: { nivel: string; factor: number } } }>('/admin/rutas');
    expect(rutas.body.motor.salud).toMatchObject({ nivel: 'rojo', factor: 0 });
    // Los 15 que siguen esperando no recibieron el recordatorio.
    expect(e.mensajesA(clientes[10]!.telefono)).toHaveLength(1);
  });

  it('una persona lo reanuda desde el panel y se vuelve despacio, sin repetir el susto', async () => {
    const res = await e.api.post<{ snapshot: { nivel: string; factor: number } }>('/admin/salud/reanudar', { motivo: 'lista limpiada' });
    expect(res.status).toBe(200);
    expect(res.body.snapshot.factor).toBeGreaterThan(0);
    expect(res.body.snapshot.factor).toBeLessThan(1);

    const hecho = await e.trabajar();
    expect(hecho.filter((h) => h.accion === 'envio').length).toBeGreaterThan(0);
    expect((await e.api.get<{ nivel: string }>('/admin/salud')).body.nivel).not.toBe('rojo');
  });
});
