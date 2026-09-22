/**
 * Vuelta 4 de las entregas: la nota de voz del motorizado, su pagina sin
 * instalar nada (/m/<token>), el cliente recurrente en la lista pegada y en
 * el pedido a mano, el pin que cae fuera de Lima, y el espejo de lo que GSG
 * cambia o cancela.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, conPais, type EscenarioEntregas } from './escenario-entregas.js';

const SUPERVISOR = '51912426667';
const pinDe = (i: number) => ({ lat: PIN_LIMA.lat + i * 0.001, lng: PIN_LIMA.lng - i * 0.001 });

/** El reloj arranca a las 09:00 de Lima del ultimo dia que ya empezo (ver entregas.test.ts). */
function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

async function riderDe(e: EscenarioEntregas, referencia: string): Promise<{ id: number; phone: string; nombre: string }> {
  const fila = await e.entrega(referencia);
  const m = fila?.motorizado;
  if (!m) throw new Error(`${referencia} no tiene motorizado`);
  return { id: m.id, phone: m.phone, nombre: m.nombre };
}

describe('vuelta 4 · notas de voz, página del motorizado, recurrente en lista y a mano, pin fuera de zona, espejo de GSG', () => {
  let e: EscenarioEntregas;

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ supervisor: SUPERVISOR, arranque: hoyALas9() });
    await e.api.post('/admin/motorizados/de-prueba');
  });
  afterAll(() => e.cerrar());

  it('un audio del motorizado con transcripción vale como texto ("entregado"); sin transcripción se le pide que lo escriba', async () => {
    e.simulador.cargar([{ referencia: 'V-1', telefono: '987410001', nombre: 'Vera Audio', direccion: 'Av. Salaverry 500', distrito: 'Jesús María', faltaUbicacion: true, faltaConfirmacion: false }]);
    await e.api.post('/admin/entregas/sincronizar');
    await e.trabajar();
    await e.contesta('987410001', { pin: pinDe(41) });
    await e.trabajar();
    const rider = await riderDe(e, 'V-1');
    // Audio sin transcripcion: se le pide que lo escriba (texto editable), sin tocar el pedido.
    await e.contesta(rider.phone, { adjunto: 'audio' });
    const textosRider = e.textosA(rider.phone);
    expect(textosRider[textosRider.length - 1]).toMatch(/no pude entenderlo|Escríbelo por aquí/i);
    expect((await e.entrega('V-1'))?.estado).toBe('esperando_motorizado');
    // Audio transcrito "35": es su tiempo.
    await e.contesta(rider.phone, { audio: '35 minutos' });
    let v1 = await e.entrega('V-1');
    expect(v1?.minutosMotorizado).toBe(35);
    expect(v1?.estado).toBe('avisada');
    // Audio transcrito "entregado": queda entregada.
    await e.contesta(rider.phone, { audio: 'ya, entregado' });
    v1 = await e.entrega('V-1');
    expect(v1?.estado).toBe('entregada');
  });

  it('la página del motorizado: enlace de 7 días, sus paradas en orden y botones que hacen lo mismo que su WhatsApp', async () => {
    e.simulador.cargar([{ referencia: 'V-2', telefono: '987410002', nombre: 'Víctor Página', direccion: 'Jr. Lampa 300', distrito: 'Lima', faltaUbicacion: true, faltaConfirmacion: false }]);
    await e.api.post('/admin/entregas/sincronizar');
    await e.trabajar();
    await e.contesta('987410002', { pin: pinDe(42) });
    await e.trabajar();
    const rider = await riderDe(e, 'V-2');

    // Sin sesion del panel, la pagina no existe sin token valido.
    const mala = await e.api.get('/m/no-existe/datos');
    expect(mala.status).toBe(404);
    expect(String((mala.body as { error?: string }).error)).toMatch(/no vale/i);

    // El coordinador le manda su enlace por WhatsApp.
    const r = await e.api.post<{ ok: boolean; url: string; enviado: boolean; venceAt: string }>(`/admin/motorizados/${rider.id}/enlace`, { mandar: true });
    expect(r.status).toBe(200);
    expect(r.body.enviado).toBe(true);
    expect(r.body.url).toMatch(/\/m\/[A-Za-z0-9_-]{20,}$/);
    const token = r.body.url.split('/m/')[1]!;
    const textosRider = e.textosA(rider.phone);
    expect(textosRider[textosRider.length - 1]).toContain(r.body.url);
    expect(new Date(r.body.venceAt).getTime() - e.ahora().getTime()).toBeGreaterThan(6 * 86_400_000);

    // La pagina (HTML publico) y sus datos.
    const html = await e.app.inject({ method: 'GET', url: `/m/${token}` });
    expect(html.statusCode).toBe(200);
    expect(html.body).toContain('Mis pedidos de hoy');
    expect(html.body).not.toContain('${');
    const datos = await e.api.get<{ ok: boolean; motorizado: { nombre: string }; ruta: { paradas: Array<{ entrega: { referencia: string; id: number } }> }; sinPin: Array<{ id: number }>; acciones: Record<number, string[]> }>(`/m/${token}/datos`);
    expect(datos.status).toBe(200);
    expect(datos.body.motorizado.nombre).toBe(rider.nombre);
    const parada = datos.body.ruta.paradas.find((p) => p.entrega.referencia === 'V-2')!;
    expect(parada).toBeTruthy();
    expect(datos.body.acciones[parada.entrega.id]).toContain('minutos');
    // La ruta ya incluye al final los pedidos que esperan el pin del cliente:
    // `sinPin` es un subconjunto suyo, y por eso la pagina los pinta una sola
    // vez (los quita de las paradas y los enseña abajo, sin botones).
    const idsRuta = new Set(datos.body.ruta.paradas.map((p) => p.entrega.id));
    expect((datos.body.sinPin ?? []).every((x) => idsRuta.has(x.id))).toBe(true);

    // Los minutos desde el boton: mismo camino que "V-2 40" por WhatsApp.
    const min = await e.api.post<{ ok: boolean; respuesta: string }>(`/m/${token}/accion`, { accion: 'minutos', referencia: 'V-2', minutos: 40 });
    expect(min.status).toBe(200);
    let v2 = await e.entrega('V-2');
    expect(v2?.minutosMotorizado).toBe(40);
    expect(v2?.estado).toBe('avisada');
    const textosCliente = e.textosA(conPais('987410002'));
    expect(textosCliente[textosCliente.length - 1]).toMatch(/en camino/i);

    // "Estoy cerca" y "Entregado" desde la pagina.
    const cerca = await e.api.post<{ ok: boolean }>(`/m/${token}/accion`, { accion: 'cerca', referencia: 'V-2' });
    expect(cerca.status).toBe(200);
    v2 = await e.entrega('V-2');
    expect(v2?.cercaAvisadoAt).toBeTruthy();
    const ent = await e.api.post<{ ok: boolean }>(`/m/${token}/accion`, { accion: 'entregado', referencia: 'V-2' });
    expect(ent.status).toBe(200);
    v2 = await e.entrega('V-2');
    expect(v2?.estado).toBe('entregada');
    // Queda apuntado que fue desde su pagina.
    const ficha = await e.api.get<{ eventos: Array<{ detalle: string }> }>(`/admin/entregas/${v2!.id}`);
    expect(ficha.body.eventos.some((ev) => /desde su página/.test(ev.detalle))).toBe(true);

    // Un pedido que ya no es suyo: se le dice.
    const otra = await e.api.post(`/m/${token}/accion`, { accion: 'entregado', referencia: 'V-2' });
    expect(otra.status).toBe(400);
    expect(String((otra.body as { error?: string }).error)).toMatch(/ya no está entre tus pedidos/);

    // Caducado: mensaje claro.
    e.avanzar(8 * 24 * 60);
    const cad = await e.api.get(`/m/${token}/datos`);
    expect(cad.status).toBe(404);
    expect(String((cad.body as { error?: string }).error)).toMatch(/caducó/);
    e.avanzar(-8 * 24 * 60);
  });

  it('el cliente recurrente también en «Pegar la lista del día» y en «Pedido a mano»', async () => {
    for (const [tel, nombre, i] of [['987410003', 'Lucía Lista', 43], ['987410004', 'Mario Mano', 44]] as const) {
      const contacto = await e.repos.contacts.upsertFromInbound(conPais(tel), nombre);
      const id = await e.repos.locations.save(contacto.id, { ok: true, lat: pinDe(i).lat, lng: pinDe(i).lng, source: 'whatsapp_location', confidence: 'high', precisionMeters: 10, mapsUrl: 'https://maps.google.com/?q=x', warnings: [] } as never, 'pin');
      await e.repos.locations.confirm(id);
    }
    const lista = await e.api.post<{ ok: boolean; creadas: Array<{ referencia: string; loteId: string | null; ubicacionPropuestaLat: number | null }> }>('/admin/entregas/cargar-lista', { texto: 'telefono, nombre, pedido, direccion\n987410003, Lucía Lista, L-1, Av. Petit Thouars 900', faltaUbicacion: true, faltaConfirmacion: false });
    expect(lista.status).toBe(200);
    const l1 = await e.entrega('L-1');
    expect(l1?.ubicacionPropuestaLat).toBeCloseTo(pinDe(43).lat, 5);
    expect(l1?.loteId).toBeNull();

    const mano = await e.api.post<{ ok: boolean; entrega: { referencia: string } }>('/admin/entregas/crear', { referencia: 'M-1', telefono: '987410004', nombre: 'Mario Mano', direccion: 'Av. Arequipa 2000', faltaUbicacion: true, faltaConfirmacion: false });
    expect(mano.status).toBe(200);
    const m1 = await e.entrega('M-1');
    expect(m1?.ubicacionPropuestaLat).toBeCloseTo(pinDe(44).lat, 5);
    expect(m1?.loteId).toBeNull();

    await e.trabajar();
    const textos = e.textosA(conPais('987410003'));
    expect(textos[textos.length - 1]).toMatch(/misma dirección de la última vez/);
    await e.contesta('987410003', { texto: 'sí, la misma' });
    expect((await e.entrega('L-1'))?.ubicacionEstado).toBe('recibida');
  });

  it('un pin fuera de Lima no se registra: pasa a una persona y al cliente se le explica', async () => {
    e.simulador.cargar([{ referencia: 'V-5', telefono: '987410005', nombre: 'Fuera Zona', direccion: 'Km 30', distrito: 'Lima', faltaUbicacion: true, faltaConfirmacion: false }]);
    await e.api.post('/admin/entregas/sincronizar');
    await e.trabajar();
    // Arequipa, lejos de Lima.
    await e.contesta('987410005', { pin: { lat: -16.409, lng: -71.537 } });
    const v5 = await e.entrega('V-5');
    expect(v5?.ubicacionEstado).toBe('pendiente');
    expect(v5?.lat).toBeNull();
    expect(v5?.estado).toBe('incidencia');
    expect(v5?.incidencia).toBe('ubicacion_fuera_de_zona');
    const textos = e.textosA(conPais('987410005'));
    expect(textos[textos.length - 1]).toMatch(/fuera de la zona/i);
    // El supervisor se entera.
    const alSupervisor = e.textosA(SUPERVISOR);
    expect(alSupervisor.some((t) => /V-5/.test(t) && /fuera de la zona/.test(t))).toBe(true);
    // Un pin dentro de Lima despues lo arregla.
    await e.api.post(`/admin/entregas/${v5!.id}/reintentar`).catch(() => undefined);
    await e.contesta('987410005', { pin: pinDe(45) });
    expect((await e.entrega('V-5'))?.ubicacionEstado).toBe('recibida');
  });

  it('el espejo de GSG: cambia la dirección (se refleja y se apunta), cancela (se cancela aquí y se avisa al cliente con hora); una lista vacía no cancela nada', async () => {
    e.simulador.cargar([
      { referencia: 'V-6', telefono: '987410006', nombre: 'Cambio Dirección', direccion: 'Calle A 1', distrito: 'Lince', faltaUbicacion: true, faltaConfirmacion: false },
      { referencia: 'V-7', telefono: '987410007', nombre: 'Cancelado Gsg', direccion: 'Calle B 2', distrito: 'Lince', faltaUbicacion: true, faltaConfirmacion: false },
    ]);
    await e.api.post('/admin/entregas/sincronizar');
    await e.trabajar();
    // GSG cambia la direccion de V-6.
    expect(e.simulador.cambiar('V-6', { direccion: 'Calle A 99, dpto 3', distrito: 'San Isidro' })).toBeTruthy();
    const s = await e.api.post<{ cambiadas?: number }>('/admin/entregas/sincronizar');
    expect(s.body.cambiadas).toBe(1);
    const v6 = await e.entrega('V-6');
    expect(v6?.direccion).toBe('Calle A 99, dpto 3');
    expect(v6?.distrito).toBe('San Isidro');
    const ficha = await e.api.get<{ eventos: Array<{ detalle: string }> }>(`/admin/entregas/${v6!.id}`);
    expect(ficha.body.eventos.some((ev) => /GSG cambió: dirección/.test(ev.detalle))).toBe(true);

    // V-7 llega hasta tener hora, y entonces GSG lo cancela.
    await e.contesta('987410007', { pin: pinDe(47) });
    await e.trabajar();
    const rider = await riderDe(e, 'V-7');
    await e.contesta(rider.phone, { texto: 'V-7 30' });
    expect((await e.entrega('V-7'))?.estado).toBe('avisada');
    const antesCliente = e.textosA(conPais('987410007')).length;
    const antesRider = e.textosA(rider.phone).length;
    expect(e.simulador.cancelar('V-7', 'el cliente llamó a GSG')).toBe(true);
    const s2 = await e.api.post<{ canceladas?: number }>('/admin/entregas/sincronizar');
    expect(s2.body.canceladas).toBe(1);
    const v7 = await e.entrega('V-7');
    expect(v7?.estado).toBe('cancelada');
    const textosCliente = e.textosA(conPais('987410007'));
    expect(textosCliente.length).toBe(antesCliente + 1);
    expect(textosCliente[textosCliente.length - 1]).toMatch(/cancelado/i);
    // El motorizado se entera de que ya no lo lleva.
    expect(e.textosA(rider.phone).length).toBeGreaterThan(antesRider);

    // Salvaguarda: GSG contesta vacio (o se cae): nada se cancela.
    const vivasAntes = (await e.resumen()).cifras.cancelada;
    e.simulador.reiniciar();
    await e.api.post('/admin/entregas/sincronizar');
    expect((await e.resumen()).cifras.cancelada).toBe(vivasAntes);
    e.simulador.modo = 'caido';
    const caido = await e.api.post<{ ok: boolean }>('/admin/entregas/sincronizar');
    expect(caido.body.ok).toBe(false);
    expect((await e.resumen()).cifras.cancelada).toBe(vivasAntes);
    e.simulador.modo = 'ok';
  });
});

describe('vuelta 4 · la zona horaria de Ajustes manda en las horas de las entregas', () => {
  it('con la zona cambiada a Ciudad de México (una hora menos), la hora que ve el cliente va en esa zona', async () => {
    let zona = 'America/Lima';
    // Arranca a las 09:00 de Lima para que el cambio de zona no cruce la medianoche.
    const arranque = new Date();
    arranque.setUTCHours(14, 0, 0, 0);
    if (arranque.getTime() > Date.now()) arranque.setUTCDate(arranque.getUTCDate() - 1);
    const z = await crearEscenarioEntregas({ supervisor: '51912426667', zonaHoraria: () => zona, arranque });
    try {
      z.simulador.cargarDePrueba();
      await z.api.post('/admin/motorizados/de-prueba');
      await z.api.post('/admin/entregas/sincronizar');
      await z.contesta('987000010', { pin: pinDe(10) });
      await z.trabajar();
      const antes = await z.entrega('P-1010');
      const rider = antes?.motorizado;
      expect(rider).toBeTruthy();
      zona = 'America/Mexico_City';
      await z.contesta(rider!.phone, { texto: 'P-1010 30' });
      const e = await z.entrega('P-1010');
      expect(e?.estado).toBe('avisada');
      const enMadrid = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(e!.llegaAproxAt!));
      const enLima = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(e!.llegaAproxAt!));
      const textos = z.textosA(conPais('987000010'));
      expect(textos[textos.length - 1]).toContain(enMadrid);
      if (enMadrid !== enLima) expect(textos[textos.length - 1]).not.toContain(enLima);
    } finally {
      await z.cerrar();
    }
  });
});
