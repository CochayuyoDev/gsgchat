/**
 * Lo que pasa después del aviso de llegada: el motorizado dice "entregado"
 * (o manda la foto, o dice que no pudo), el cliente pregunta "¿a qué hora
 * llega?", los eventos salen por el bus, la lista del día se pega sin GSG y
 * el pedido se le da al motorizado que anda más cerca.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, conPais, type EscenarioEntregas } from './escenario-entregas.js';
import type { EventoEntregaDelDia } from '../src/eventos/bus.js';

const SUPERVISOR = '51912426667';
const pinDe = (i: number) => ({ lat: PIN_LIMA.lat + i * 0.001, lng: PIN_LIMA.lng - i * 0.001 });

/** Lleva un pedido hasta "avisada": pin, sí, motorizado, tiempo. Devuelve el teléfono del motorizado. */
async function hastaAvisada(e: EscenarioEntregas, referencia: string, telefono: string, pin: { lat: number; lng: number }, minutos = '40'): Promise<string> {
  await e.api.post('/admin/entregas/crear', { referencia, telefono, nombre: `Cliente ${referencia}`, distrito: 'Miraflores', faltaUbicacion: true, faltaConfirmacion: true });
  await e.trabajar();
  await e.contesta(telefono, { pin });
  await e.contesta(telefono, { texto: 'sí' });
  await e.trabajar();
  const entrega = await e.entrega(referencia);
  expect(entrega?.estado, `${referencia} debía estar esperando al motorizado`).toBe('esperando_motorizado');
  const rider = entrega!.motorizado!.phone;
  await e.contesta(rider, { texto: minutos });
  expect((await e.entrega(referencia))?.estado).toBe('avisada');
  return rider;
}

describe('entregado, ¿dónde está mi pedido?, eventos, lista pegada y cercanía', () => {
  let e: EscenarioEntregas;

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ supervisor: SUPERVISOR });
    await e.api.post('/admin/motorizados/de-prueba');
  });
  afterAll(() => e.cerrar());

  it('(a) el motorizado escribe "entregado": la entrega queda entregada, el cliente recibe las gracias y GSG la hora', async () => {
    const rider = await hastaAvisada(e, 'E-2001', '987100001', pinDe(1));
    const antesCliente = e.textosA('987100001').length;
    await e.contesta(rider, { texto: 'entregado' });
    const entrega = await e.entrega('E-2001');
    expect(entrega?.estado).toBe('entregada');
    expect(entrega?.entregadaComo).toBe('reglas');
    expect(entrega?.entregadaAt).not.toBeNull();
    expect(entrega?.entregadaRespuesta).toBe('entregado');
    expect(entrega?.acciones).toEqual([]);
    expect(entrega?.situacion).toMatch(/Entregada a las \d\d:\d\d/);
    // Al motorizado se le contesta; al cliente se le da las gracias.
    const alRider = e.textosA(rider);
    expect(alRider[alRider.length - 1]).toMatch(/E-2001 entregado/i);
    const alCliente = e.textosA('987100001');
    expect(alCliente).toHaveLength(antesCliente + 1);
    expect(alCliente[alCliente.length - 1]).toMatch(/quedó entregado/i);
    // GSG recibe un segundo reporte de entrega con la hora.
    await e.despacharAGsg();
    const reportes = e.simulador.recibido.filter((r) => r.tipo === 'entrega' && r.cuerpo.referencia === 'E-2001');
    expect(reportes).toHaveLength(2);
    expect(reportes[0]!.cuerpo.entregadoEn).toBeNull();
    expect(typeof reportes[1]!.cuerpo.entregadoEn).toBe('string');
    expect(reportes[1]!.cuerpo.entregadaComo).toBe('reglas');
    // El motorizado deja su última posición en ese pin.
    const m = (await e.resumen()).motorizados.find((x) => x.phone === rider)!;
    expect(m.ultimaLat).toBeCloseTo(pinDe(1).lat, 5);
    expect(m.ultimaPosicionAt).not.toBeNull();
    // La tarjeta de la pantalla lo cuenta.
    expect((await e.resumen()).cifras.entregada).toBe(1);
  });

  it('(b) la foto del motorizado vale por "entregado"', async () => {
    const rider = await hastaAvisada(e, 'E-2002', '987100002', pinDe(2));
    await e.contesta(rider, { adjunto: 'image' });
    const entrega = await e.entrega('E-2002');
    expect(entrega?.estado).toBe('entregada');
    expect(entrega?.entregadaComo).toBe('foto');
    expect(entrega?.entregadaRespuesta).toBe('[foto]');
    expect(entrega?.situacion).toMatch(/mandó la foto/);
    const alRider = e.textosA(rider);
    expect(alRider[alRider.length - 1]).toMatch(/E-2002 entregado/i);
  });

  it('(c) "no estaba nadie" (con la segunda visita apagada): incidencia no_entregado, el supervisor se entera y GSG recibe la incidencia', async () => {
    // Con la segunda visita activa (lo normal) primero se le pregunta al cliente si volvemos hoy: eso lo cubre tests/entregas-ronda2.test.ts.
    await e.entregas.guardarAjustes({ segundaVisita: { activa: false, esperaMin: 30 } });
    const rider = await hastaAvisada(e, 'E-2003', '987100003', pinDe(3));
    const antesSupervisor = e.textosA(SUPERVISOR).length;
    await e.contesta(rider, { texto: 'no estaba nadie, toqué y no abren' });
    await e.entregas.guardarAjustes({ segundaVisita: { activa: true, esperaMin: 30 } });
    const entrega = await e.entrega('E-2003');
    expect(entrega?.estado).toBe('incidencia');
    expect(entrega?.incidencia).toBe('no_entregado');
    expect(entrega?.requiereHumano).toBe(true);
    expect(entrega?.acciones).toContain('marcar_entregada');
    const alRider = e.textosA(rider);
    expect(alRider[alRider.length - 1]).toMatch(/no se pudo entregar/i);
    const alSupervisor = e.textosA(SUPERVISOR);
    expect(alSupervisor.length).toBe(antesSupervisor + 1);
    expect(alSupervisor[alSupervisor.length - 1]).toMatch(/E-2003/);
    expect(alSupervisor[alSupervisor.length - 1]).toMatch(/no pudo entregar/);
    await e.despacharAGsg();
    const reporte = e.simulador.recibido.filter((r) => r.tipo === 'entrega' && r.cuerpo.referencia === 'E-2003').pop();
    expect(reporte?.cuerpo).toMatchObject({ entregadoEn: null, incidencia: 'no_entregado' });
    // Una persona la puede dar por entregada después (el motorizado volvió).
    const r = await e.api.post<{ ok: boolean; entrega: { estado: string; entregadaComo: string } }>(`/admin/entregas/${entrega!.id}/entregada`);
    expect(r.status).toBe(200);
    expect(r.body.entrega.estado).toBe('entregada');
    expect(r.body.entrega.entregadaComo).toBe('persona');
  });

  it('(d) lo que las reglas no entienden lo lee la IA: "ya quedó todo ok con la señora" es entregado', async () => {
    const rider = await hastaAvisada(e, 'E-2004', '987100004', pinDe(4));
    e.ia.disponible = true;
    e.ia.respuestas.push('{"entregado":true,"problema":"","seguridad":0.9}');
    await e.contesta(rider, { texto: 'ya quedó todo ok con la señora' });
    const entrega = await e.entrega('E-2004');
    expect(entrega?.estado).toBe('entregada');
    expect(entrega?.entregadaComo).toBe('ia');
    expect(e.ia.llamadas[e.ia.llamadas.length - 1]!.sistema).toMatch(/YA LO ENTREGÓ/);
    // Y si la IA ve un problema, pasa a una persona.
    const rider2 = await hastaAvisada(e, 'E-2005', '987100005', pinDe(5));
    e.ia.respuestas.push('{"entregado":false,"problema":"la casa estaba cerrada","seguridad":0.85}');
    await e.contesta(rider2, { texto: 'llegué pero la reja está con candado y nadie sale' });
    const entrega2 = await e.entrega('E-2005');
    expect(entrega2?.estado).toBe('incidencia');
    expect(entrega2?.incidencia).toBe('no_entregado');
    expect(entrega2?.incidenciaDetalle).toMatch(/la casa estaba cerrada/);
    e.ia.disponible = false;
  });

  it('(e) con "avisar entregado" apagado no se le escribe al cliente; varias avisadas sin nombrar → la última y la puerta para corregir', async () => {
    await e.entregas.guardarAjustes({ avisarEntregado: false });
    const rider = await hastaAvisada(e, 'E-2006', '987100006', pinDe(6));
    // Al mismo motorizado, otro pedido: se le fuerza por reasignación.
    await e.api.post('/admin/entregas/crear', { referencia: 'E-2007', telefono: '987100007', nombre: 'Cliente E-2007', distrito: 'Miraflores', faltaUbicacion: true, faltaConfirmacion: true });
    await e.trabajar();
    await e.contesta('987100007', { pin: pinDe(7) });
    await e.contesta('987100007', { texto: 'sí' });
    const e2007 = await e.entrega('E-2007');
    const idRider = (await e.resumen()).motorizados.find((m) => m.phone === rider)!.id;
    await e.api.post(`/admin/entregas/${e2007!.id}/reasignar`, { motorizadoId: idRider });
    expect((await e.entrega('E-2007'))?.motorizado?.phone).toBe(rider);
    await e.contesta(rider, { texto: 'E-2007 25' });
    expect((await e.entrega('E-2007'))?.estado).toBe('avisada');

    const antesCliente6 = e.textosA('987100006').length;
    const antesCliente7 = e.textosA('987100007').length;
    await e.contesta(rider, { texto: 'listo entregado' });
    // Sin nombrar cuál: la más reciente (E-2007) y se le dice cómo corregir.
    expect((await e.entrega('E-2007'))?.estado).toBe('entregada');
    expect((await e.entrega('E-2006'))?.estado).toBe('avisada');
    const alRider = e.textosA(rider);
    expect(alRider[alRider.length - 1]).toMatch(/Anotado como entregado E-2007/);
    expect(alRider[alRider.length - 1]).toMatch(/Si era otro/);
    // Nombrándola: esa.
    await e.contesta(rider, { texto: 'entregado E-2006' });
    expect((await e.entrega('E-2006'))?.estado).toBe('entregada');
    // A los clientes no se les escribió nada (ajuste apagado).
    expect(e.textosA('987100006')).toHaveLength(antesCliente6);
    expect(e.textosA('987100007')).toHaveLength(antesCliente7);
    await e.entregas.guardarAjustes({ avisarEntregado: true });
    // Ya sin nada entre manos, un "listo" suelto no rompe nada.
    await e.contesta(rider, { texto: 'listo' });
    const ultimo = e.textosA(rider).pop();
    expect(ultimo).toMatch(/no tienes ningún pedido esperando tu tiempo/);
  });

  it('(f) un "listo" con un pin sin contestar es el tiempo que falta, no un entregado', async () => {
    const rider = await hastaAvisada(e, 'E-2008', '987100008', pinDe(8));
    await e.api.post('/admin/entregas/crear', { referencia: 'E-2009', telefono: '987100009', nombre: 'Cliente E-2009', faltaUbicacion: true, faltaConfirmacion: true });
    await e.trabajar();
    await e.contesta('987100009', { pin: pinDe(9) });
    await e.contesta('987100009', { texto: 'sí' });
    const e2009 = await e.entrega('E-2009');
    const idRider = (await e.resumen()).motorizados.find((m) => m.phone === rider)!.id;
    await e.api.post(`/admin/entregas/${e2009!.id}/reasignar`, { motorizadoId: idRider });
    await e.contesta(rider, { texto: 'listo' });
    // No cuenta como entregado de E-2008: tiene E-2009 esperando su tiempo.
    expect((await e.entrega('E-2008'))?.estado).toBe('avisada');
    expect((await e.entrega('E-2009'))?.estado).toBe('esperando_motorizado');
    const alRider = e.textosA(rider);
    expect(alRider[alRider.length - 1]).toMatch(/No te entendí/);
    await e.contesta(rider, { texto: '30' });
    expect((await e.entrega('E-2009'))?.estado).toBe('avisada');
    await e.contesta(rider, { texto: 'entregado E-2008' });
    await e.contesta(rider, { texto: 'entregado E-2009' });
    expect((await e.entrega('E-2008'))?.estado).toBe('entregada');
    expect((await e.entrega('E-2009'))?.estado).toBe('entregada');
  });

  it('el cliente pregunta "¿a qué hora llega?": se le contesta según el estado, sin IA', async () => {
    // Falta ubicación.
    await e.api.post('/admin/entregas/crear', { referencia: 'D-3001', telefono: '987200001', nombre: 'Rosa Vega', faltaUbicacion: true, faltaConfirmacion: true });
    await e.trabajar();
    await e.contesta('987200001', { texto: 'hola, a qué hora llega mi pedido?' });
    let textos = e.textosA('987200001');
    expect(textos[textos.length - 1]).toMatch(/nos falta su ubicación/i);
    // Un "hola" a secas no es una pregunta por el pedido: sigue su camino (a la IA o al reparto).
    const antes = textos.length;
    const r = await e.entregas.alTexto({ id: '', phone: conPais('987200001'), name: 'Rosa' }, 'hola buenas');
    expect(r.atendida).toBe(false);
    expect(e.textosA('987200001')).toHaveLength(antes);
    // Con pin y confirmada, esperando al motorizado.
    await e.contesta('987200001', { pin: pinDe(11) });
    await e.contesta('987200001', { texto: 'sí' });
    await e.contesta('987200001', { texto: 'ya viene?' });
    textos = e.textosA('987200001');
    expect(textos[textos.length - 1]).toMatch(/ya está con un motorizado|le avisamos/i);
    await e.trabajar();
    const entrega = await e.entrega('D-3001');
    const rider = entrega!.motorizado!.phone;
    await e.contesta(rider, { texto: '45' });
    const avisada = await e.entrega('D-3001');
    expect(avisada?.estado).toBe('avisada');
    // Avisada: la hora.
    await e.contesta('987200001', { texto: 'cuánto falta?' });
    textos = e.textosA('987200001');
    const horaLlega = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(avisada!.llegaAproxAt!));
    expect(textos[textos.length - 1]).toMatch(/va en camino/i);
    expect(textos[textos.length - 1]).toContain(horaLlega);
    // "No llegó" 40 min después de la hora: incidencia y aviso al supervisor.
    const antesSupervisor = e.textosA(SUPERVISOR).length;
    e.avanzar(45 + 60 + 40);
    await e.contesta('987200001', { texto: 'todavía no llega nadie' });
    textos = e.textosA('987200001');
    expect(textos[textos.length - 1]).toMatch(/Disculpe la demora/i);
    const conIncidencia = await e.entrega('D-3001');
    expect(conIncidencia?.estado).toBe('incidencia');
    expect(conIncidencia?.incidencia).toBe('no_llego');
    expect(e.textosA(SUPERVISOR).length).toBe(antesSupervisor + 1);
    // Entregada: "según nuestro registro".
    await e.api.post(`/admin/entregas/${conIncidencia!.id}/entregada`);
    await e.contesta('987200001', { texto: 'y mi pedido?' });
    textos = e.textosA('987200001');
    expect(textos[textos.length - 1]).toMatch(/quedó entregado a las \d\d:\d\d/i);
    // Con el ajuste apagado, no se contesta solo.
    await e.entregas.guardarAjustes({ responderDondeEsta: false });
    const r2 = await e.entregas.alTexto({ id: '', phone: conPais('987200001'), name: 'Rosa' }, 'dónde está mi pedido');
    expect(r2.atendida).toBe(false);
    await e.entregas.guardarAjustes({ responderDondeEsta: true });
  });

  it('los eventos salen por el bus con referencia y teléfono', async () => {
    const nombres = e.eventos.map((x) => x.nombre);
    expect(nombres).toContain('entrega.confirmada');
    expect(nombres).toContain('entrega.avisada');
    expect(nombres).toContain('entrega.entregada');
    expect(nombres).toContain('entrega.incidencia');
    const entregada = e.eventos.find((x) => x.nombre === 'entrega.entregada')!.payload as EventoEntregaDelDia;
    expect(entregada.entrega.referencia).toBe('E-2001');
    expect(entregada.entrega.telefono).toBe('51987100001');
    expect(entregada.entrega.estado).toBe('entregada');
    expect(typeof entregada.entrega.entregadoEn).toBe('string');
    expect(entregada.entrega.motorizado?.telefono).toMatch(/^51999/);
    const incidencia = e.eventos.find((x) => x.nombre === 'entrega.incidencia' && (x.payload as EventoEntregaDelDia).entrega.referencia === 'E-2003')!.payload as EventoEntregaDelDia;
    expect(incidencia.entrega.incidencia).toBe('no_entregado');
    // La campana y el inicio del panel los cuentan. (E-2005 esperaba al cliente por la
    // segunda visita; con el reloj ya avanzado, el motor la pasa a una persona.)
    await e.trabajar();
    expect((await e.entrega('E-2005'))?.requiereHumano).toBe(true);
    const avisos = await e.api.get<{ avisos: Array<{ tipo: string; href: string; n?: number }> }>('/admin/avisos');
    expect(avisos.status).toBe(200);
    const deEntregas = avisos.body.avisos.find((a) => a.tipo === 'entregas');
    expect(deEntregas?.href).toBe('/hoy');
    expect(deEntregas?.n).toBeGreaterThan(0);
    const resumen = await e.api.get<{ entregas: { total: number; entregadas: number; incidencia: number; enCamino: number } }>('/admin/resumen');
    expect(resumen.status).toBe(200);
    expect(resumen.body.entregas.total).toBeGreaterThan(5);
    expect(resumen.body.entregas.entregadas).toBeGreaterThan(3);
    expect(resumen.body.entregas.incidencia).toBeGreaterThan(0);
  });

  it('la lista del día pegada crea las entregas de golpe, con UN lote para las que necesitan ubicación', async () => {
    const texto = [
      '987300021, Juan Pérez, L-4001, Av. Larco 345, Surco',
      '987300022, María Torres, L-4002, Jr. Monterrey 120, San Borja',
      '987300023, Pedro Ruiz, L-4003, Av. Aviación 2800, Lince',
      '987300021, Juan Pérez, L-4001, Av. Larco 345, Surco',
      'sin teléfono, Alguien, L-4004',
    ].join('\n');
    const r = await e.api.post<{ creadas: number; referencias: string[]; repetidas: string[]; descartadas: Array<{ linea: number; motivo: string }>; lote: { total: number; nombre: string } | null }>('/admin/entregas/cargar-lista', { texto, faltaUbicacion: true, faltaConfirmacion: true, destino: 'sistema' });
    expect(r.status).toBe(200);
    expect(r.body.creadas).toBe(3);
    expect(r.body.referencias).toEqual(['L-4001', 'L-4002', 'L-4003']);
    expect(r.body.repetidas).toEqual(['L-4001']);
    expect(r.body.descartadas).toHaveLength(1);
    expect(r.body.descartadas[0]!.motivo).toMatch(/teléfono/i);
    expect(r.body.lote?.total).toBe(3);
    const l1 = await e.entrega('L-4001');
    expect(l1?.estado).toBe('esperando_ubicacion');
    expect(l1?.loteId).toBe((await e.entrega('L-4002'))?.loteId);
    // Pegarla otra vez no duplica.
    const otra = await e.api.post<{ creadas: number; repetidas: string[] }>('/admin/entregas/cargar-lista', { texto, faltaUbicacion: true, faltaConfirmacion: true, destino: 'sistema' });
    expect(otra.body.creadas).toBe(0);
    expect(otra.body.repetidas).toContain('L-4002');
    // Con cabecera y columnas ubicación/confirmar por fila.
    const conCabecera = ['telefono;nombre;pedido;distrito;ubicacion;confirmar', '987300031;Ana Soto;L-4011;Miraflores;no;si', '987300032;Luis Cano;L-4012;Miraflores;si;no'].join('\n');
    const r2 = await e.api.post<{ creadas: number; lote: { total: number } | null }>('/admin/entregas/cargar-lista', { texto: conCabecera, faltaUbicacion: true, faltaConfirmacion: true, destino: 'sistema' });
    expect(r2.body.creadas).toBe(2);
    expect(r2.body.lote?.total).toBe(1);
    expect((await e.entrega('L-4011'))?.ubicacionEstado).toBe('no_hace_falta');
    expect((await e.entrega('L-4011'))?.confirmacionEstado).toBe('pendiente');
    expect((await e.entrega('L-4012'))?.ubicacionEstado).toBe('pendiente');
    expect((await e.entrega('L-4012'))?.confirmacionEstado).toBe('no_hace_falta');
    // Al simulador de GSG, para probar.
    const antesSim = e.simulador.estado().clientes.length;
    const r3 = await e.api.post<{ creadas: number; destino: string }>('/admin/entregas/cargar-lista', { texto: '987300041, Carla Díaz, L-4021, Av. X, Surco', destino: 'simulador' });
    expect(r3.body.destino).toBe('simulador');
    expect(r3.body.creadas).toBe(1);
    expect(e.simulador.estado().clientes.length).toBe(antesSim + 1);
    expect(e.simulador.pendientes().faltaUbicacion.map((c) => c.referencia)).toContain('L-4021');
  });

  it('el pedido se le da al motorizado que anda más cerca (su última posición de hoy), y si no hay, al de la zona', async () => {
    const motorizados = (await e.resumen()).motorizados;
    // Todos a descanso menos dos sin zona: uno con última posición a 500 m del pin, otro lejos.
    for (const m of motorizados) await e.api.post(`/admin/motorizados/${m.id}`, { estado: 'descanso' });
    const cerca = await e.api.post<{ motorizado: { id: number; phone: string } }>('/admin/motorizados', { telefono: '999100001', nombre: 'Cerca Pérez' });
    const lejos = await e.api.post<{ motorizado: { id: number; phone: string } }>('/admin/motorizados', { telefono: '999100002', nombre: 'Lejos Gómez' });
    const pin = { lat: -12.0464, lng: -77.0308 };
    await e.entregas.editarMotorizado(cerca.body.motorizado.id, { ultimaLat: pin.lat + 0.004, ultimaLng: pin.lng, ultimaPosicionAt: e.ahora(), entregasHoy: 5, entregasHoyDia: e.entregas.hoy() });
    await e.entregas.editarMotorizado(lejos.body.motorizado.id, { ultimaLat: -12.1211, ultimaLng: -77.0301, ultimaPosicionAt: e.ahora(), entregasHoy: 0, entregasHoyDia: e.entregas.hoy() });
    await e.api.post('/admin/entregas/crear', { referencia: 'C-5001', telefono: '987400001', nombre: 'Cliente C', distrito: 'Cercado de Lima', faltaUbicacion: false, faltaConfirmacion: false, lat: pin.lat, lng: pin.lng });
    await e.trabajar();
    // Aunque el lejano tiene menos carga, gana el que está a 400 m.
    expect((await e.entrega('C-5001'))?.motorizado?.phone).toBe('51999100001');
    // Sin nadie cerca (posiciones de ayer no cuentan), manda la zona.
    await e.entregas.editarMotorizado(cerca.body.motorizado.id, { ultimaPosicionAt: new Date(e.ahora().getTime() - 2 * 24 * 60 * 60 * 1000) });
    await e.entregas.editarMotorizado(lejos.body.motorizado.id, { zona: 'Cercado de Lima' });
    await e.api.post('/admin/entregas/crear', { referencia: 'C-5002', telefono: '987400002', nombre: 'Cliente C2', distrito: 'Cercado de Lima', faltaUbicacion: false, faltaConfirmacion: false, lat: pin.lat, lng: pin.lng });
    await e.trabajar();
    expect((await e.entrega('C-5002'))?.motorizado?.phone).toBe('51999100002');
  });

  it('la vista previa de un texto sale con la hora y los minutos rellenos', async () => {
    const r = await e.api.post<{ texto: string }>('/admin/entregas/previsualizar', { clave: 'avisoLlegada', texto: '' });
    expect(r.status).toBe(200);
    expect(r.body.texto).toMatch(/alrededor de las \d\d:\d\d/);
    expect(r.body.texto).toMatch(/en \d+ (min|h)/);
    expect(r.body.texto).not.toMatch(/\{hora\}|\{minutos\}/);
    const propio = await e.api.post<{ texto: string }>('/admin/entregas/previsualizar', { clave: 'motorizadoNuevo', texto: 'Pedido {pedido} para {nombreCompleto}{distrito}: {mapa}' });
    expect(propio.body.texto).toMatch(/^Pedido [A-Z]-\d+ para .+ \(.+\): https:\/\/maps\.google\.com/);
    const mala = await e.api.post('/admin/entregas/previsualizar', { clave: 'noExiste', texto: '' });
    expect(mala.status).toBe(400);
  });
});
