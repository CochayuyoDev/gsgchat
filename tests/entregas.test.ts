/**
 * Un día de entregas de principio a fin, con diez clientes y diez motorizados
 * ficticios, el sistema de GSG simulado y el servidor real.
 *
 * Las preguntas son las de operación: ¿a quién se le pidió qué? ¿qué pasa
 * cuando el cliente dice "sí", "no", "mañana" o algo raro? ¿qué recibe el
 * motorizado y qué recibe el cliente después? ¿qué se entera GSG y cuándo
 * pasa a "terminados"? ¿y si GSG se cae?
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, conPais, type EscenarioEntregas } from './escenario-entregas.js';
import { CLIENTES_DE_PRUEBA, MOTORIZADOS_DE_PRUEBA } from '../src/entregas/datos-de-prueba.js';
import { haversineKm } from '../src/entregas/geo.js';
import { crearClaveDePrueba } from './fakes.js';

const SUPERVISOR = '51912426667';
const pinDe = (i: number) => ({ lat: PIN_LIMA.lat + i * 0.001, lng: PIN_LIMA.lng - i * 0.001 });
const horaDe = (d: Date) => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

describe('un día de entregas con GSG simulado', () => {
  let e: EscenarioEntregas;

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ supervisor: SUPERVISOR });
  });
  afterAll(() => e.cerrar());

  it('GSG manda sus dos listas y el sistema las reparte: 7 al reparto (ubicación) y 9 por confirmar', async () => {
    expect(e.simulador.cargarDePrueba()).toBe(10);
    const m = await e.api.post<{ nuevos: number }>('/admin/motorizados/de-prueba');
    expect(m.status).toBe(200);
    expect(m.body.nuevos).toBe(10);

    const s = await e.api.post<{ ok: boolean; nuevas: number; ubicacionesPedidas: number; confirmacionesPendientes: number; lote: { total: number } | null; detalle: string }>('/admin/entregas/sincronizar');
    expect(s.status).toBe(200);
    expect(s.body.ok).toBe(true);
    expect(s.body.nuevas).toBe(10);
    // Los 7 que necesitan ubicación (P-1001..1006 y P-1010) van a un lote del reparto.
    expect(s.body.ubicacionesPedidas).toBe(7);
    expect(s.body.lote?.total).toBe(7);
    // Los 3 que solo faltan confirmar (GSG ya tiene su pin) se atienden aquí.
    expect(s.body.confirmacionesPendientes).toBe(3);

    const r = await e.resumen();
    expect(r.cifras.total).toBe(10);
    expect(r.cifras.faltaUbicacion).toBe(7);
    expect(r.cifras.faltaConfirmacion).toBe(9);
    expect(r.cifras.esperando_ubicacion).toBe(7);
    expect(r.cifras.esperando_confirmacion).toBe(3);
    expect(r.motorizados).toHaveLength(10);

    // Los que GSG ya tenía ubicados llegan con su pin.
    const rosa = await e.entrega('P-1007');
    expect(rosa?.ubicacionEstado).toBe('recibida');
    expect(rosa?.lat).toBeCloseTo(-12.0977, 3);
    // Y el que ya confirmó por teléfono no necesita que se le pregunte.
    const diego = await e.entrega('P-1010');
    expect(diego?.confirmacionEstado).toBe('no_hace_falta');
    expect(diego?.ubicacionEstado).toBe('pendiente');

    // Sincronizar dos veces no duplica nada.
    const otra = await e.api.post<{ nuevas: number; ubicacionesPedidas: number }>('/admin/entregas/sincronizar');
    expect(otra.body.nuevas).toBe(0);
    expect(otra.body.ubicacionesPedidas).toBe(0);
    expect((await e.resumen()).cifras.total).toBe(10);
  });

  it('el reparto pide la ubicación a los 7 y se les pide confirmar a los 3 que ya tienen pin', async () => {
    await e.trabajar();
    for (const c of CLIENTES_DE_PRUEBA.filter((c) => c.faltaUbicacion)) {
      const pedidas = e.mensajesA(c.telefono).filter((m) => m.kind === 'location_request');
      expect(pedidas, `${c.referencia} debía recibir la petición de ubicación`).toHaveLength(1);
      // A quien todavía no ha dado el pin no se le pide confirmar: sería escribirle dos veces por dos cosas.
      expect(e.textosA(c.telefono).some((t) => /confirm/i.test(t))).toBe(false);
    }
    for (const c of CLIENTES_DE_PRUEBA.filter((c) => !c.faltaUbicacion)) {
      const textos = e.textosA(c.telefono);
      expect(textos, `${c.referencia} debía recibir la pregunta de confirmar`).toHaveLength(1);
      expect(textos[0]).toMatch(/confirma/i);
      expect(textos[0]).toContain(c.referencia);
      expect(textos[0]).toContain(c.nombre.split(' ')[0]);
      expect((await e.entrega(c.referencia))?.confirmacionEstado).toBe('pedida');
    }
    // Ningún motorizado recibió nada todavía: nadie tiene las dos cosas.
    for (const m of MOTORIZADOS_DE_PRUEBA) expect(e.mensajesA(m.telefono)).toHaveLength(0);
  });

  it('un cliente manda su pin: el gracias lleva la pregunta de confirmar pegada (un solo mensaje)', async () => {
    const antes = e.textosA('987000001').length;
    await e.contesta('987000001', { pin: pinDe(1) });
    const textos = e.textosA('987000001');
    expect(textos).toHaveLength(antes + 1);
    expect(textos[textos.length - 1]).toMatch(/recibimos su ubicación/i);
    expect(textos[textos.length - 1]).toMatch(/confirma/i);

    const ana = await e.entrega('P-1001');
    expect(ana?.ubicacionEstado).toBe('recibida');
    expect(ana?.lat).toBeCloseTo(pinDe(1).lat, 5);
    expect(ana?.confirmacionEstado).toBe('pedida');
    expect(ana?.estado).toBe('esperando_confirmacion');

    // GSG recibe la ubicación (la reporta el reparto, no dos veces).
    await e.despacharAGsg();
    const ubicaciones = e.simulador.recibido.filter((r) => r.tipo === 'ubicacion' && r.cuerpo.referencia === 'P-1001');
    expect(ubicaciones).toHaveLength(1);
    expect(e.simulador.pendientes().faltaUbicacion.map((c) => c.referencia)).not.toContain('P-1001');
    // Pero sigue en "falta confirmar": son dos cosas distintas.
    expect(e.simulador.pendientes().faltaConfirmacion.map((c) => c.referencia)).toContain('P-1001');
    expect(e.simulador.pendientes().terminados).toHaveLength(0);
  });

  it('"sí, confirmo" la confirma, GSG se entera y el pin sale hacia un motorizado con la pregunta de los minutos', async () => {
    await e.contesta('987000001', { texto: 'Sí, confirmo' });
    const textos = e.textosA('987000001');
    expect(textos[textos.length - 1]).toMatch(/queda confirmado/i);
    let ana = await e.entrega('P-1001');
    expect(ana?.confirmacionEstado).toBe('confirmada');
    expect(ana?.confirmacionComo).toBe('reglas');
    expect(ana?.estado).toBe('lista');

    await e.despacharAGsg();
    const conf = e.simulador.recibido.find((r) => r.tipo === 'confirmacion' && r.cuerpo.referencia === 'P-1001');
    expect(conf?.cuerpo).toMatchObject({ confirmada: true, como: 'reglas', telefono: '51987000001' });
    // Con las dos cosas, GSG ya la pasa a terminados (el aviso de llegada llega después, como dato extra).
    expect(e.simulador.pendientes().terminados.map((c) => c.referencia)).toContain('P-1001');

    await e.trabajar();
    ana = await e.entrega('P-1001');
    expect(ana?.estado).toBe('esperando_motorizado');
    expect(ana?.motorizado).not.toBeNull();
    // Miraflores: le toca a uno de la zona.
    expect(ana!.motorizado!.nombre).toMatch(/Carlos Rojas|Bruno Cárdenas/);
    const rider = ana!.motorizado!.phone;
    const alRider = e.mensajesA(rider);
    const texto = String(alRider.find((m) => m.kind === 'text')?.body ?? '');
    expect(texto).toContain('P-1001');
    expect(texto).toContain('Ana Quispe');
    expect(texto).toContain('maps.google.com/?q=');
    expect(texto).toMatch(/en cuántos minutos/i);
    // Y el pin nativo, además del enlace.
    expect(alRider.some((m) => m.kind === 'location')).toBe(true);
  });

  it('el motorizado dice "40": al cliente se le avisa 1 h 40 min con la hora, y GSG recibe la entrega', async () => {
    const ana = await e.entrega('P-1001');
    const rider = ana!.motorizado!.phone;
    const antes = e.textosA('987000001').length;
    await e.contesta(rider, { texto: '40' });

    const aRider = e.textosA(rider);
    expect(aRider[aRider.length - 1]).toMatch(/Anotado: P-1001 en 40 min/);
    expect(aRider[aRider.length - 1]).toContain('1 h 40 min');

    const aAna = e.textosA('987000001');
    expect(aAna).toHaveLength(antes + 1);
    const aviso = aAna[aAna.length - 1]!;
    expect(aviso).toContain('P-1001');
    expect(aviso).toContain('1 h 40 min');
    const esperada = horaDe(new Date(e.ahora().getTime() + 100 * 60_000));
    expect(aviso).toContain(esperada);

    const despues = await e.entrega('P-1001');
    expect(despues?.minutosMotorizado).toBe(40);
    expect(despues?.minutosAviso).toBe(100);
    expect(despues?.estado).toBe('avisada');
    expect(despues?.avisoEnviadoAt).not.toBeNull();

    await e.despacharAGsg();
    const entrega = e.simulador.recibido.find((r) => r.tipo === 'entrega' && r.cuerpo.referencia === 'P-1001');
    expect(entrega?.cuerpo).toMatchObject({ minutosMotorizado: 40, margenMinutos: 60, minutosAviso: 100 });
    expect((entrega?.cuerpo.motorizado as { telefono: string }).telefono).toBe(rider);

    // GSG la tiene en terminados: al sincronizar, aquí queda terminada.
    await e.api.post('/admin/entregas/sincronizar');
    expect((await e.entrega('P-1001'))?.estado).toBe('terminada');
    // Y el motorizado cuenta una entrega más hoy.
    const r = await e.resumen();
    expect(r.motorizados.find((m) => m.phone === rider)?.entregasHoy).toBe(1);
  });

  it('"no, ya no lo quiero" cancela: al cliente se le dice, GSG lo pasa a cancelados y no va a ningún motorizado', async () => {
    await e.contesta('987000007', { texto: 'No, ya no lo quiero' });
    const textos = e.textosA('987000007');
    expect(textos[textos.length - 1]).toMatch(/sin entregar por hoy/i);
    const rosa = await e.entrega('P-1007');
    expect(rosa?.estado).toBe('cancelada');
    expect(rosa?.confirmacionEstado).toBe('rechazada');
    await e.despacharAGsg();
    expect(e.simulador.pendientes().cancelados.map((c) => c.referencia)).toContain('P-1007');
    await e.trabajar();
    expect((await e.entrega('P-1007'))?.motorizado).toBeNull();
  });

  it('"mañana mejor" pasa a una persona: se le contesta, se avisa al supervisor y GSG sabe que pide un cambio', async () => {
    await e.contesta('987000008', { texto: 'mañana mejor, hoy no voy a estar' });
    const textos = e.textosA('987000008');
    expect(textos[textos.length - 1]).toMatch(/se comunicará con usted/i);
    const miguel = await e.entrega('P-1008');
    expect(miguel?.estado).toBe('incidencia');
    expect(miguel?.incidencia).toBe('cambio');
    expect(miguel?.requiereHumano).toBe(true);
    const alSupervisor = e.textosA(SUPERVISOR);
    expect(alSupervisor.some((t) => t.includes('P-1008') && /cambio/.test(t))).toBe(true);
    await e.despacharAGsg();
    const conf = e.simulador.recibido.find((r) => r.tipo === 'confirmacion' && r.cuerpo.referencia === 'P-1008');
    expect(conf?.cuerpo).toMatchObject({ confirmada: false, motivo: 'cambio' });
    // Sigue en "falta confirmar" para GSG: no está cancelado, lo coordina una persona.
    expect(e.simulador.pendientes().faltaConfirmacion.map((c) => c.referencia)).toContain('P-1008');
  });

  it('algo que no se entiende (sin IA) se vuelve a preguntar con las opciones; un 👍 después confirma', async () => {
    await e.contesta('987000009', { texto: 'ehh, no sé, ¿quién habla?' });
    let textos = e.textosA('987000009');
    expect(textos[textos.length - 1]).toMatch(/no me quedó claro/i);
    expect(textos[textos.length - 1]).toMatch(/SÍ .* NO/);
    let lucia = await e.entrega('P-1009');
    expect(lucia?.confirmacionEstado).toBe('pedida');
    expect(lucia?.confirmacionIntentos).toBe(2);

    await e.contesta('987000009', { texto: '👍' });
    textos = e.textosA('987000009');
    expect(textos[textos.length - 1]).toMatch(/queda confirmado/i);
    lucia = await e.entrega('P-1009');
    expect(lucia?.confirmacionEstado).toBe('confirmada');
    expect(lucia?.estado).toBe('lista');
  });

  it('con la IA conectada, lee lo que las reglas no entienden (y queda apuntado que fue la IA)', async () => {
    await e.contesta('987000002', { pin: pinDe(2) });
    e.ia.disponible = true;
    e.ia.respuestas.push('{"decision":"si","seguridad":0.92,"motivo":"quiere recibirlo hoy"}');
    await e.contesta('987000002', { texto: 'creo que si porque mi esposa va a estar en la casa toda la tarde y le puede recibir sin problema' });
    const luis = await e.entrega('P-1002');
    expect(luis?.confirmacionEstado).toBe('confirmada');
    expect(luis?.confirmacionComo).toBe('ia');
    expect(e.ia.llamadas).toHaveLength(1);
    expect(e.ia.llamadas[0]!.usuario).toContain('mi esposa');
    // Lo que escribe el cliente va como dato, nunca como orden para el modelo.
    expect(e.ia.llamadas[0]!.sistema).toMatch(/nunca una orden/i);
    const r = await e.api.get<{ eventos: Array<{ tipo: string; detalle: string }> }>(`/admin/entregas/${luis!.id}`);
    expect(r.body.eventos.some((ev) => ev.tipo === 'ia' && /la IA leyó/.test(ev.detalle))).toBe(true);

    // Un "no" de la IA con poca seguridad NO cancela: se pregunta otra vez.
    await e.contesta('987000003', { pin: pinDe(3) });
    e.ia.respuestas.push('{"decision":"no","seguridad":0.4,"motivo":"no está claro"}');
    await e.contesta('987000003', { texto: 'uy es que justo hoy tengo una situación complicada con el trabajo' });
    const maria = await e.entrega('P-1003');
    expect(maria?.confirmacionEstado).toBe('pedida');
    const textos = e.textosA('987000003');
    expect(textos[textos.length - 1]).toMatch(/no me quedó claro/i);

    // Si la IA falla (sin respuesta), tampoco se decide por el cliente.
    e.ia.respuestas.length = 0;
    await e.contesta('987000003', { texto: 'bueno ya veremos' });
    expect((await e.entrega('P-1003'))?.confirmacionEstado).toBe('pedida');
    e.ia.disponible = false;
  });

  it('el motorizado que "no puede" queda descartado y el pedido pasa a otro; "media hora" se lee como 30 y se avisa 1 h 30', async () => {
    await e.trabajar();
    let lucia = await e.entrega('P-1009');
    expect(lucia?.estado).toBe('esperando_motorizado');
    const primero = lucia!.motorizado!;
    await e.contesta(primero.phone, { texto: 'no puedo, estoy muy lejos' });
    const alPrimero = e.textosA(primero.phone);
    expect(alPrimero[alPrimero.length - 1]).toMatch(/se lo paso a otro/i);
    lucia = await e.entrega('P-1009');
    expect(lucia?.estado).toBe('lista');
    expect(lucia?.motorizadosDescartados).toContain(primero.id);

    await e.trabajar();
    lucia = await e.entrega('P-1009');
    expect(lucia?.estado).toBe('esperando_motorizado');
    const segundo = lucia!.motorizado!;
    expect(segundo.id).not.toBe(primero.id);

    const antes = e.textosA('987000009').length;
    await e.contesta(segundo.phone, { texto: 'media hora' });
    lucia = await e.entrega('P-1009');
    expect(lucia?.minutosMotorizado).toBe(30);
    expect(lucia?.minutosAviso).toBe(90);
    expect(lucia?.estado).toBe('avisada');
    const aLucia = e.textosA('987000009');
    expect(aLucia).toHaveLength(antes + 1);
    expect(aLucia[aLucia.length - 1]).toContain('1 h 30 min');
  });

  it('el motorizado que no contesta: se le insiste a los 10 min y, a la segunda, el pedido pasa a otro', async () => {
    await e.trabajar();
    let luis = await e.entrega('P-1002');
    expect(luis?.estado).toBe('esperando_motorizado');
    const primero = luis!.motorizado!;
    const mensajesAntes = e.textosA(primero.phone).length;

    e.avanzar(11);
    await e.trabajar();
    luis = await e.entrega('P-1002');
    expect(luis?.motorizadoIntentos).toBe(2);
    expect(luis?.motorizado?.id).toBe(primero.id);
    const insistencia = e.textosA(primero.phone);
    expect(insistencia).toHaveLength(mensajesAntes + 1);
    expect(insistencia[insistencia.length - 1]).toMatch(/sigo esperando tu tiempo/i);

    e.avanzar(11);
    await e.trabajar();
    luis = await e.entrega('P-1002');
    expect(luis?.motorizado?.id).not.toBe(primero.id);
    expect(luis?.motorizadosDescartados).toContain(primero.id);
    expect(luis?.estado).toBe('esperando_motorizado');
    const alPrimero = e.textosA(primero.phone);
    expect(alPrimero[alPrimero.length - 1]).toMatch(/ya no lo llevas tú/i);
  });

  it('un motorizado que contesta algo sin tiempo recibe la aclaración; "1h15" se lee como 75 minutos', async () => {
    const luis = await e.entrega('P-1002');
    const rider = luis!.motorizado!.phone;
    await e.contesta(rider, { texto: 'ya voy saliendo' });
    let aRider = e.textosA(rider);
    expect(aRider[aRider.length - 1]).toMatch(/responde solo los minutos/i);
    await e.contesta(rider, { texto: 'P-1002 en 1h15' });
    aRider = e.textosA(rider);
    expect(aRider[aRider.length - 1]).toMatch(/Anotado: P-1002 en 1 h 15 min/);
    const despues = await e.entrega('P-1002');
    expect(despues?.minutosMotorizado).toBe(75);
    expect(despues?.minutosAviso).toBe(135);
    expect(despues?.estado).toBe('avisada');
  });

  it('el que solo faltaba de ubicación (P-1010) va directo al motorizado en cuanto manda el pin', async () => {
    await e.contesta('987000010', { pin: pinDe(10) });
    const textos = e.textosA('987000010');
    // Ya estaba confirmado por teléfono: gracias a secas, sin volver a preguntar.
    expect(textos[textos.length - 1]).toMatch(/recibimos su ubicación/i);
    expect(textos[textos.length - 1]).not.toMatch(/confirma/i);
    let diego = await e.entrega('P-1010');
    expect(diego?.estado).toBe('lista');
    await e.trabajar();
    diego = await e.entrega('P-1010');
    expect(diego?.estado).toBe('esperando_motorizado');
    // Primero manda la cercanía: en esta prueba todos los pines están a
    // menos de 2 km, así que lo lleva el que ya anda por ahí (su última
    // posición es el pin de su último pedido) y no tiene otro pin sin
    // contestar. Si nadie estuviera cerca, sería Kevin Aguilar, el de la zona.
    const motorizados = (await e.resumen()).motorizados;
    const cerca = motorizados
      .filter((m) => m.estado === 'activo' && m.ultimaLat != null && m.ultimaLng != null && (m.enManos === 0 || m.id === diego?.motorizado?.id) && haversineKm({ lat: m.ultimaLat, lng: m.ultimaLng }, pinDe(10)) <= 6)
      .sort((a, b) => haversineKm({ lat: a.ultimaLat!, lng: a.ultimaLng! }, pinDe(10)) - haversineKm({ lat: b.ultimaLat!, lng: b.ultimaLng! }, pinDe(10)));
    if (cerca.length) expect(diego?.motorizado?.id).toBe(cerca[0]!.id);
    else expect(diego?.motorizado?.nombre).toBe('Kevin Aguilar');
  });

  it('la confirmación sin respuesta se insiste cada 2 h y a la tercera pasa a una persona; GSG lo sabe', async () => {
    // P-1004 y P-1005 mandan su pin y no contestan a la pregunta de confirmar.
    await e.contesta('987000004', { pin: pinDe(4) });
    await e.contesta('987000005', { pin: pinDe(5) });
    let jorge = await e.entrega('P-1004');
    expect(jorge?.confirmacionIntentos).toBe(1);

    e.avanzar(121);
    await e.trabajar();
    jorge = await e.entrega('P-1004');
    expect(jorge?.confirmacionIntentos).toBe(2);
    const textos = e.textosA('987000004');
    expect(textos[textos.length - 1]).toMatch(/seguimos pendientes/i);

    e.avanzar(121);
    await e.trabajar();
    expect((await e.entrega('P-1004'))?.confirmacionIntentos).toBe(3);

    e.avanzar(121);
    await e.trabajar();
    jorge = await e.entrega('P-1004');
    expect(jorge?.estado).toBe('incidencia');
    expect(jorge?.incidencia).toBe('sin_confirmacion');
    await e.despacharAGsg();
    const conf = e.simulador.recibido.find((r) => r.tipo === 'confirmacion' && r.cuerpo.referencia === 'P-1004');
    expect(conf?.cuerpo).toMatchObject({ confirmada: false, motivo: 'sin_respuesta' });
    // Una persona la confirma a mano (llamó): vuelve a la vida y sale hacia un motorizado.
    const r = await e.api.post<{ entrega: { estado: string } }>(`/admin/entregas/${jorge!.id}/confirmar`, { confirmada: true });
    expect(r.status).toBe(200);
    expect(r.body.entrega.estado).toBe('lista');
  });

  it('GSG caído: la sincronización lo dice en cristiano y los reportes esperan en la cola hasta que vuelve', async () => {
    e.simulador.modo = 'caido';
    const s = await e.api.post<{ ok: boolean; detalle: string }>('/admin/entregas/sincronizar');
    expect(s.body.ok).toBe(false);
    expect(s.body.detalle).toMatch(/GSG no respondió/);
    const p = await e.api.post<{ ok: boolean; prueba: { detalle: string } }>('/admin/entregas/gsg/probar');
    expect(p.body.ok).toBe(false);

    // P-1006 confirma mientras GSG está caído: el reporte se queda esperando.
    await e.contesta('987000006', { pin: pinDe(6) });
    await e.contesta('987000006', { texto: 'ok dale' });
    expect((await e.entrega('P-1006'))?.confirmacionEstado).toBe('confirmada');
    const primerIntento = await e.despacharAGsg();
    expect(primerIntento.enviados).toBe(0);
    expect((await e.repos.rutas.cifrasReportes()).pendiente).toBeGreaterThan(0);

    e.simulador.modo = 'ok';
    const segundo = await e.despacharAGsg();
    expect(segundo.enviados).toBeGreaterThan(0);
    expect(e.simulador.recibido.some((r) => r.tipo === 'confirmacion' && r.cuerpo.referencia === 'P-1006')).toBe(true);
  });

  it('el cliente que corrige su pin después de confirmar: el motorizado recibe el nuevo', async () => {
    await e.trabajar();
    let pedro = await e.entrega('P-1006');
    expect(pedro?.estado).toBe('esperando_motorizado');
    const rider = pedro!.motorizado!.phone;
    const antes = e.textosA(rider).length;
    await e.contesta('987000006', { pin: pinDe(16) });
    pedro = await e.entrega('P-1006');
    expect(pedro?.lat).toBeCloseTo(pinDe(16).lat, 5);
    const aRider = e.textosA(rider);
    expect(aRider).toHaveLength(antes + 1);
    expect(aRider[aRider.length - 1]).toMatch(/corrigió su ubicación/);
  });

  it('un motorizado sin pedidos entre manos recibe una respuesta corta y no le vende nada el asistente', async () => {
    const libre = MOTORIZADOS_DE_PRUEBA.find((m) => e.mensajesA(m.telefono).length === 0)!;
    await e.contesta(libre.telefono, { texto: 'hola, ¿hay algo para mí?' });
    const textos = e.textosA(libre.telefono);
    expect(textos[textos.length - 1]).toMatch(/no tienes ningún pedido/i);
  });

  it('la pantalla, la conexión con GSG y la API pública responden', async () => {
    const pagina = await e.app.inject({ method: 'GET', url: '/entregas', headers: { authorization: `Bearer ${(await import('./fakes.js')).CLAVE_API_PRUEBA}` } });
    expect(pagina.statusCode).toBe(200);
    expect(pagina.body).toContain('Pedidos de hoy');
    expect(pagina.body).toContain('Probar con números ficticios');

    const gsg = await e.api.get<{ gsg: { modo: string; conectada: boolean; origen: string } }>('/admin/entregas/gsg');
    expect(gsg.body.gsg).toMatchObject({ modo: 'real', conectada: true, origen: 'env' });

    const clave = await crearClaveDePrueba(e.repos, ['entregas:leer']);
    const r = await e.app.inject({ method: 'GET', url: '/api/v1/entregas', headers: { authorization: `Bearer ${clave}` } });
    expect(r.statusCode).toBe(200);
    const cuerpo = r.json() as { cifras: { total: number }; entregas: Array<{ referencia: string; llegaAproxEn: string | null }> };
    expect(cuerpo.cifras.total).toBe(10);
    expect(cuerpo.entregas.find((x) => x.referencia === 'P-1001')?.llegaAproxEn).not.toBeNull();
    // Sin el permiso de gestionar, no se sincroniza.
    const sinPermiso = await e.app.inject({ method: 'POST', url: '/api/v1/entregas/sincronizar', headers: { authorization: `Bearer ${clave}` }, payload: {} });
    expect(sinPermiso.statusCode).toBe(403);

    const sim = await e.api.get<{ estado: { terminados: number; cancelados: number } }>('/admin/entregas/simulador');
    expect(sim.status).toBe(200);
    expect(sim.body.estado.terminados).toBeGreaterThanOrEqual(3);
    expect(sim.body.estado.cancelados).toBe(1);
  });

  it('el resumen final del día cuadra', async () => {
    const r = await e.resumen();
    const por = Object.fromEntries(r.entregas.map((x) => [x.referencia, x.estado]));
    expect(por).toMatchObject({
      'P-1001': 'terminada',
      'P-1007': 'cancelada',
      'P-1008': 'incidencia',
    });
    expect(['avisada', 'terminada']).toContain(por['P-1009']);
    expect(['avisada', 'terminada']).toContain(por['P-1002']);
    expect(r.cifras.total).toBe(10);
    const descripcion = await e.entregas.descripcionParaIA();
    expect(descripcion).toMatch(/Entregas de hoy/);
    expect(descripcion).toMatch(/10 en total/);
    // Lo que el asistente le puede decir a Ana si pregunta por su pedido.
    const contexto = await e.entregas.contextoDeCliente(conPais('987000001'));
    expect(contexto).toBeNull(); // terminada: ya no está viva
    const contextoLucia = await e.entregas.contextoDeCliente(conPais('987000009'));
    expect(contextoLucia).toMatch(/P-1009/);
    expect(contextoLucia).toMatch(/Hora aproximada de llegada/);
  });
});
