import { afterEach, describe, expect, it } from 'vitest';
import { armarCasos, contarFlujo, contarReportados, marcarQuienEscribio, quejasEscritasHoy, TOPE_CASOS, type PedidoConCaso, type PedidoEnFlujo } from '../src/admin/flujo-routes.js';
import { panelPage } from '../src/web/pages.js';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, PIN_LIMA, type EscenarioEntregas } from './escenario-entregas.js';

const base: PedidoEnFlujo = { estado: 'esperando_ubicacion', ubicacionEstado: 'pendiente', mensajeEstado: 'enviado' };

describe('contarFlujo: cada pedido de hoy en su paso del flujo', () => {
  it('separa el SÍ (mandó ubicación), el NO (respondió sin ubicación / no contestó) y los que aún no contestan', () => {
    const c = contarFlujo([
      { ...base, estado: 'lista', ubicacionEstado: 'recibida' },
      { ...base, solicitud: { estado: 'respondio', incidencia: null } },
      { ...base, solicitud: { estado: 'derivado', incidencia: 'respondio_sin_ubicacion' } },
      { ...base, solicitud: { estado: 'derivado', incidencia: 'sin_respuesta' }, requiereHumano: true },
      { ...base, solicitud: { estado: 'enviado', incidencia: null } },
      // Contestó texto: el bot le vuelve a pedir la ubicación (la solicitud sigue «enviado»), pero ya respondió.
      { ...base, solicitud: { estado: 'enviado', incidencia: null, primeraRespuestaAt: new Date() } },
      { ...base, ubicacionEstado: 'no_hace_falta', mensajeEstado: 'no_aplica', estado: 'lista' },
      { ...base, estado: 'cancelada' },
    ]);
    expect(c.recibidos).toBe(8);
    expect(c.cancelados).toBe(1);
    expect(c.yaConUbicacion).toBe(1);
    expect(c.pidenUbicacion).toBe(6);
    expect(c.respuesta).toEqual({ si: 1, respondioSinUbicacion: 3, noContesto: 1, esperando: 1, noEsLaPersona: 0 });
    expect(c.conversacionDirecta).toBe(4);
  });

  it('cuenta el primer mensaje por su estado: enviado, en cola, retenido y fallido', () => {
    const c = contarFlujo([
      { ...base },
      { ...base, mensajeEstado: 'encolado' },
      { ...base, mensajeEstado: 'reintentando' },
      { ...base, mensajeEstado: 'retenido' },
      { ...base, mensajeEstado: 'fallido' },
      { ...base, mensajeEstado: 'incierto', datosEnvio: { firstMessage: 'Hola, soy GSG' } },
    ]);
    expect(c.primerMensaje).toEqual({ enviados: 1, enCola: 2, retenidos: 1, fallidos: 2, conTextoDeGsg: 1 });
    // Sin mensaje enviado no se cuenta como «aún no contesta».
    expect(c.respuesta.esperando).toBe(1);
  });

  it('quien escribió después del primer mensaje (y sigue sin ubicación) cuenta como respuesta sin ubicación', async () => {
    const enviado = new Date('2026-11-17T15:00:00Z');
    const pedidos = [
      { ...base, phone: '51987000001', mensajeEnviadoAt: enviado }, // escribió después
      { ...base, phone: '51987000002', mensajeEnviadoAt: enviado }, // escribió ANTES del mensaje
      { ...base, phone: '51987000003', mensajeEnviadoAt: enviado }, // nunca escribió
      { ...base, phone: '51987000001', mensajeEnviadoAt: enviado, ubicacionEstado: 'recibida' as const }, // ya la mandó: no se consulta
    ];
    const consultados: string[] = [];
    const ultimos: Record<string, Date | null> = { '51987000001': new Date('2026-11-17T15:05:00Z'), '51987000002': new Date('2026-11-17T14:00:00Z'), '51987000003': null };
    await marcarQuienEscribio(pedidos, async (t) => {
      consultados.push(t);
      return ultimos[t];
    });
    expect(consultados.sort()).toEqual(['51987000001', '51987000002', '51987000003']);
    expect(pedidos.map((p) => Boolean(p.escribioTrasElMensaje))).toEqual([true, false, false, false]);
    expect(contarFlujo(pedidos).respuesta).toEqual({ si: 1, respondioSinUbicacion: 1, noContesto: 0, esperando: 2, noEsLaPersona: 0 });
  });

  it('separa «no es la persona», los que esperan su sí a una dirección, los intentos y los cambios de ubicación', () => {
    const c = contarFlujo([
      { ...base, solicitud: { estado: 'derivado', incidencia: 'numero_equivocado' } },
      { ...base, pinPropuestoAt: new Date() },
      { ...base, solicitud: { estado: 'enviado', incidencia: null, intentos: 1 } },
      { ...base, solicitud: { estado: 'enviado', incidencia: null, intentos: 2 } },
      { ...base, solicitud: { estado: 'enviado', incidencia: null, intentos: 4 } },
      { ...base, estado: 'lista', ubicacionEstado: 'recibida', ubicacionCambios: 2, requiereHumano: true },
    ]);
    expect(c.respuesta).toEqual({ si: 1, respondioSinUbicacion: 1, noContesto: 0, esperando: 3, noEsLaPersona: 1 });
    expect(c.porConfirmarUbicacion).toBe(1);
    expect(c.esperandoPorIntento).toEqual({ uno: 1, dos: 1, tresOMas: 1 });
    expect(c.cambiaronUbicacion).toBe(1);
    expect(c.requierenPersona).toBe(1);
  });

  it('cuenta los números reportados del día por motivo', () => {
    const r = contarReportados(
      [
        { dia: '2026-11-17', error: 'sin_whatsapp', estado: 'pendiente' },
        { dia: '2026-11-17', error: 'sin_whatsapp', estado: 'corregido' },
        { dia: '2026-11-17', error: 'numero_corto', estado: 'pendiente' },
        { dia: '2026-11-16', error: 'numero_fijo', estado: 'pendiente' },
      ],
      '2026-11-17',
    );
    expect(r).toEqual({ total: 3, pendientes: 2, corregidos: 1, porMotivo: { sin_whatsapp: 2, numero_corto: 1 } });
  });

  it('arma los casos concretos: quién cambió su ubicación, qué mensaje falló, cuál no salió, quién se quejó', () => {
    const p = (o: Partial<PedidoConCaso>): PedidoConCaso => ({ ...base, phone: '51987000000', nombre: 'Cliente', referencia: 'REF', ...o });
    const casos = armarCasos(
      [
        p({ phone: '51987000001', nombre: 'Ana', datosEnvio: { tracking: 'GSG-1' }, estado: 'lista', ubicacionEstado: 'recibida', ubicacionFuente: 'whatsapp', ubicacionAt: '2026-11-17T15:00:00Z', ubicacionCambios: 1, cambioUbicacion: 'cambió su ubicación (10:42)' }),
        p({ phone: '51987000002', nombre: 'Luis', mensajeEstado: 'fallido', mensajeError: 'El número no tiene WhatsApp', mensajeUltimoIntentoAt: '2026-11-17T14:00:00Z' }),
        p({ phone: '51987000003', nombre: 'María', mensajeEstado: 'retenido' }),
        p({ phone: '51987000004', nombre: 'Jorge', requiereHumano: true, incidenciaDetalle: 'pidió hablar con una persona (una queja tras UBI REGISTRADA): pésimo servicio', solicitud: { estado: 'supervision', incidencia: 'respondio_sin_ubicacion' } }),
        p({ phone: '51987000005', nombre: 'Carla', solicitud: { estado: 'enviado', incidencia: null, intentos: 2 } }),
      ],
      [
        { phone: '987000005', etiqueta: 'reclamo', nombreEtiqueta: 'Reclamo', motivo: 'Dice que nunca llega', en: '2026-11-17T16:00:00Z' },
        { phone: '987000001', etiqueta: 'cambiar_ubicacion', nombreEtiqueta: 'Cambiar ubicación', motivo: null, en: '2026-11-17T15:30:00Z' },
      ],
      [{ dia: '2026-11-17', error: 'numero_corto', estado: 'pendiente', tracking: 'GSG-9', telefono: '12345', mensaje: 'Le faltan dígitos', detalle: null, reportadoAt: '2026-11-17T13:00:00Z' }],
      '2026-11-17',
    );
    expect(casos.cambiaronUbicacion.casos[0]).toMatchObject({ nombre: 'Ana', tracking: 'GSG-1', detalle: 'cambió su ubicación (10:42)' });
    expect(casos.ubicacionRecibida.casos[0]!.detalle).toBe('Pin de WhatsApp');
    expect(casos.erroresEnvio.casos[0]).toMatchObject({ nombre: 'Luis', detalle: 'El número no tiene WhatsApp' });
    expect(casos.sinEnviar.casos[0]).toMatchObject({ nombre: 'María', detalle: 'Espera «Confirmar y enviar» en Pedidos GSG' });
    // La queja del chat (Jorge) y la nota «reclamo» de la IA (Carla, cruzada con su pedido).
    expect(casos.quejas.total).toBe(2);
    expect(casos.quejas.casos.map((c) => c.nombre).sort()).toEqual(['Carla', 'Jorge']);
    expect(casos.respondioSinUbicacion.casos[0]!.nombre).toBe('Jorge');
    expect(casos.esperando.casos[0]).toMatchObject({ nombre: 'Carla', detalle: 'Va en el 2.º mensaje, aún no contesta' });
    expect(casos.reportados.casos[0]).toMatchObject({ tracking: 'GSG-9', detalle: 'numero_corto|Sin corregir' });
    expect(casos.notas.map((n) => n.codigo).sort()).toEqual(['cambiar_ubicacion', 'reclamo']);
    expect(casos.notas.find((n) => n.codigo === 'cambiar_ubicacion')!.casos[0]!.nombre).toBe('Ana');
  });

  it('encuentra las quejas escritas hoy en los chats aunque el bot no las haya contestado', async () => {
    const desde = new Date('2026-11-17T05:00:00Z');
    const convs = [
      { contactId: 'c1', phone: '51987000006', name: 'Pedro', tipo: 'persona', lastInboundAt: new Date('2026-11-17T16:00:00Z') },
      { contactId: 'c2', phone: '51987000007', name: 'Rosa', tipo: 'persona', lastInboundAt: new Date('2026-11-17T16:05:00Z') },
      { contactId: 'c3', phone: '51987000008', name: 'Viejo', tipo: 'persona', lastInboundAt: new Date('2026-11-16T16:00:00Z') },
    ];
    const msgs: Record<string, Array<{ direction: 'in' | 'out'; body: string; createdAt: Date }>> = {
      c1: [
        { direction: 'out', body: 'Hola, comparta su ubicación', createdAt: new Date('2026-11-17T15:00:00Z') },
        { direction: 'in', body: 'Pésimo servicio, nunca llega. Quiero mi dinero', createdAt: new Date('2026-11-17T16:00:00Z') },
      ],
      c2: [{ direction: 'in', body: 'gracias, ahí va mi ubicación', createdAt: new Date('2026-11-17T16:05:00Z') }],
    };
    const leidos: string[] = [];
    const repo = {
      listConversations: async () => convs as never,
      listMessages: async (id: string) => {
        leidos.push(id);
        return (msgs[id] ?? []) as never;
      },
    };
    const quejas = await quejasEscritasHoy(repo, desde, (t) => /p[eé]simo|quiero mi dinero/i.test(t));
    expect(quejas).toEqual([{ phone: '51987000006', nombre: 'Pedro', texto: 'Pésimo servicio, nunca llega. Quiero mi dinero', en: new Date('2026-11-17T16:00:00Z') }]);
    // El chat sin actividad hoy ni se lee.
    expect(leidos.sort()).toEqual(['c1', 'c2']);
    const casos = armarCasos([{ ...base, phone: '51987000006', nombre: 'Pedro Castillo', referencia: 'GSG-6' }], [], [], null, quejas);
    expect(casos.quejas.casos[0]).toMatchObject({ nombre: 'Pedro Castillo', tracking: 'GSG-6', detalle: 'Escribió: «Pésimo servicio, nunca llega. Quiero mi dinero»' });
  });

  it('un mensaje que no salió no cuenta como «no contestó»', () => {
    const p: PedidoConCaso = { ...base, phone: '51987000009', mensajeEstado: 'incierto', mensajeError: 'Se cortó la red', solicitud: { estado: 'derivado', incidencia: 'sin_respuesta' } };
    expect(contarFlujo([p]).respuesta.noContesto).toBe(0);
    const casos = armarCasos([p], [], [], null);
    expect(casos.noContesto.total).toBe(0);
    expect(casos.erroresEnvio.total).toBe(1);
  });

  it('las listas se cortan en el tope pero dicen cuántos hay', () => {
    const muchos = Array.from({ length: TOPE_CASOS + 15 }, (_, i): PedidoConCaso => ({ ...base, phone: '51987' + String(i).padStart(6, '0'), mensajeEstado: 'fallido', mensajeError: 'x' }));
    const c = armarCasos(muchos, [], [], null);
    expect(c.erroresEnvio.total).toBe(TOPE_CASOS + 15);
    expect(c.erroresEnvio.casos).toHaveLength(TOPE_CASOS);
  });

  it('sin pedidos todo queda en cero', () => {
    const c = contarFlujo([]);
    expect(c.recibidos).toBe(0);
    expect(c.conversacionDirecta).toBe(0);
  });
});

describe('Inicio dibuja el flujo de GSGchat', () => {
  it('la página trae el diagrama y su script', () => {
    const html = panelPage({ configured: true, nombreNegocio: 'Tienda Prueba' });
    expect(html).toContain('id="flujo-gsg"');
    expect(html).toContain('Flujo de GSGchat');
    expect(html).toContain('function cargarFlujo()');
    expect(html).toContain("api('/admin/flujo')");
    expect(html).toContain('Desplegar todo');
    expect(html).toContain('id="flujo-panel"');
  });
});

let esc: EscenarioEntregas | undefined;
afterEach(async () => {
  await esc?.cerrar();
  esc = undefined;
});
const pedido = (tracking: string, telefono: string) => ({ ...OBLIGATORIOS_GSG, tracking, cliente: 'Cliente ' + tracking, telefono });

describe('GET /admin/flujo con pedidos reales del día', () => {
  it('empresa, WhatsApp, primer mensaje y la respuesta de cada cliente', async () => {
    esc = await crearEscenarioEntregas({ confirmarLista: false });
    const alta = await esc.api.post('/api/v1/entregas', { pedidos: [pedido('FL-SI', '987300001'), pedido('FL-NO', '987300002'), pedido('FL-CALLA', '987300003')] });
    expect(alta.status).toBe(201);
    await esc.trabajar();

    let flujo = await esc.api.get<any>('/admin/flujo');
    expect(flujo.status).toBe(200);
    expect(flujo.body.disponible).toBe(true);
    expect(flujo.body.empresa.nombre).toBeTruthy();
    expect(flujo.body.whatsapp.lineas.length).toBeGreaterThanOrEqual(1);
    expect(['api', 'business']).toContain(flujo.body.whatsapp.lineas[0].tipo);
    expect(flujo.body.cifras).toMatchObject({ recibidos: 3, pidenUbicacion: 3 });
    expect(flujo.body.cifras.primerMensaje.enviados).toBe(3);
    expect(flujo.body.cifras.respuesta.esperando).toBe(3);

    // Las respuestas entran por el webhook con la hora REAL y el reloj del escenario va unos segundos
    // por delante: se espera a que la hora real pase la del primer mensaje, como en la calle.
    const enviadoAt = new Date((await esc.entrega('FL-NO'))!.mensajeEnviadoAt!).getTime();
    while (Date.now() < enviadoAt + 1500) await new Promise((r) => setTimeout(r, 250));
    await esc.contesta('987300001', { pin: PIN_LIMA });
    await esc.contesta('987300002', { texto: 'no estoy en casa, no sé mi ubicación' });
    await esc.trabajar();

    flujo = await esc.api.get<any>('/admin/flujo');
    const r = flujo.body.cifras.respuesta;
    expect(r.si).toBe(1);
    // El que calla sigue esperando; el que contestó otra cosa ya no.
    expect(r.esperando).toBe(1);
    expect(r.respondioSinUbicacion).toBe(1);
    expect(r.noContesto).toBe(0);
    expect(flujo.body.cifras.conversacionDirecta).toBe(1);
  }, 60_000);
});
