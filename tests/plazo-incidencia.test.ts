/**
 * Regla del dueño (20/10): pasado el plazo para marcar la incidencia (el
 * ultimo mensaje y su espera final), el sistema ya no hace nada con ese
 * cliente. Se marca la incidencia, se le reporta a GSG y se acaba: ni se le
 * contesta, ni se registra el pin que mande despues.
 */
import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, PIN_LIMA, type EscenarioEntregas } from './escenario-entregas.js';
import { createFakeRepos } from './fakes.js';
import { atenderRespuestaDeRuta, cerradaPorPlazo } from '../src/rutas/inbound.js';
import { crearPuertoEnEspera } from '../src/rutas/gsg.js';

const tel = '987601888';
const pedido = { ...OBLIGATORIOS_GSG, tracking: 'PLAZO-1', cliente: 'Cliente de prueba', telefono: tel };

/** Deja la solicitud con sus cuatro mensajes mandados y la espera final corriendo. */
async function enEsperaFinal(e: EscenarioEntregas, minutos: number) {
  await e.api.post('/api/v1/entregas', pedido);
  await e.trabajar();
  const s = e.repos.rutas._solicitudes[0]!;
  await e.repos.rutas.actualizarSolicitud(s.id, {
    estado: 'enviado',
    intentos: 4,
    ultimoEnvioAt: e.ahora(),
    proximoIntentoAt: new Date(e.ahora().getTime() + minutos * 60_000),
  });
  return s.id;
}

const solicitud = (e: EscenarioEntregas, id: number) => e.repos.rutas._solicitudes.find((s) => s.id === id)!;
const reportes = (e: EscenarioEntregas, tipo: string) => e.repos.rutas._reportes.filter((r) => r.tipo === tipo);

describe('el plazo para marcar la incidencia', () => {
  it('se marca a su hora aunque ya haya cerrado el horario de envío, y se reporta a GSG', async () => {
    // 18:30 en Lima; el horario de envío acaba a las 19:00 y el plazo vence a las 19:10.
    const e = await crearEscenarioEntregas({ horario: [9, 19], arranque: new Date('2026-10-20T23:30:00Z') });
    try {
      const id = await enEsperaFinal(e, 40);
      // A las 18:30 el motor despierta a la hora del plazo, no a la apertura de mañana.
      expect(await e.motorReparto.proximoDespertarEn()).toBe(40 * 60_000);
      e.avanzar(41);
      const r = await e.motorReparto.tick();
      expect(r).toMatchObject({ accion: 'derivacion', solicitudId: id });
      expect(solicitud(e, id)).toMatchObject({ estado: 'derivado', incidencia: 'sin_respuesta' });
      expect(reportes(e, 'incidencia').some((x) => x.payload.codigo === 'sin_respuesta')).toBe(true);
    } finally {
      await e.cerrar();
    }
  });

  it('un pin después del plazo no se registra ni se contesta: la incidencia se queda', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const id = await enEsperaFinal(e, 20);
      e.avanzar(21);
      await e.trabajar();
      expect(solicitud(e, id).estado).toBe('derivado');
      const antes = e.mensajesA(tel).length;

      await e.contesta(tel, { pin: PIN_LIMA });
      await e.contesta(tel, { texto: 'ya le mandé mi ubicación' });

      expect(e.mensajesA(tel)).toHaveLength(antes);
      expect(solicitud(e, id)).toMatchObject({ estado: 'derivado', incidencia: 'sin_respuesta', lat: null });
      expect(reportes(e, 'ubicacion')).toHaveLength(0);
    } finally {
      await e.cerrar();
    }
  });

  it('si el pin llega pasado el plazo antes de que el motor lo mire, se marca la incidencia ahí mismo', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const id = await enEsperaFinal(e, 20);
      e.avanzar(21);
      const antes = e.mensajesA(tel).length;

      await e.contesta(tel, { pin: PIN_LIMA });

      expect(e.mensajesA(tel)).toHaveLength(antes);
      expect(solicitud(e, id)).toMatchObject({ estado: 'derivado', incidencia: 'sin_respuesta', lat: null });
      expect(reportes(e, 'incidencia').some((x) => x.payload.codigo === 'sin_respuesta')).toBe(true);
      expect(reportes(e, 'ubicacion')).toHaveLength(0);
    } finally {
      await e.cerrar();
    }
  });

  it('dentro del plazo el pin vale; contestar otra cosa no adelanta la incidencia', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const id = await enEsperaFinal(e, 20);
      const plazo = solicitud(e, id).proximoIntentoAt!.getTime();
      e.avanzar(2);
      await e.contesta(tel, { texto: 'ahorita le mando' });
      expect(solicitud(e, id).proximoIntentoAt?.getTime()).toBe(plazo);

      e.avanzar(5);
      await e.trabajar();
      expect(solicitud(e, id).estado).not.toBe('derivado');
      await e.contesta(tel, { pin: PIN_LIMA });
      expect(solicitud(e, id).estado).toBe('resuelto');
      expect(reportes(e, 'ubicacion')).toHaveLength(1);
    } finally {
      await e.cerrar();
    }
  });

  it('un texto en la espera final deja el plazo donde estaba (antes lo adelantaba a un minuto)', async () => {
    const repos = createFakeRepos();
    const contacto = await repos.contacts.upsertFromInbound('51987654321', 'Ana');
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '51987654321', phone: '51987654321', nombre: 'Ana', referencia: 'P-1' }]);
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
    const ahora = new Date('2026-10-20T15:00:00Z');
    const plazo = new Date(ahora.getTime() + 20 * 60_000);
    const id = repos.rutas._solicitudes[0]!.id;
    await repos.rutas.actualizarSolicitud(id, { estado: 'enviado', intentos: 4, proximoIntentoAt: plazo });

    await atenderRespuestaDeRuta({ repos, gsg: crearPuertoEnEspera(), ahora: () => ahora, maxIntentos: async () => 4 }, contacto, { texto: 'ya le mando' });
    expect(repos.rutas._solicitudes[0]).toMatchObject({ estado: 'respondio', proximoIntentoAt: plazo });
  });

  it('un caso derivado ayer no calla al cliente hoy', async () => {
    const repos = createFakeRepos();
    const contacto = await repos.contacts.upsertFromInbound('51987654321', 'Ana');
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '51987654321', phone: '51987654321', nombre: 'Ana', referencia: 'P-1' }]);
    const id = repos.rutas._solicitudes[0]!.id;
    await repos.rutas.actualizarSolicitud(id, { estado: 'derivado', intentos: 4, incidencia: 'sin_respuesta', ultimoEnvioAt: new Date('2026-10-20T20:00:00Z') });
    const deps = { repos, gsg: crearPuertoEnEspera(), timezone: 'America/Lima', maxIntentos: async () => 4 };

    expect(await cerradaPorPlazo(deps, contacto, new Date('2026-10-20T23:00:00Z'))).toMatchObject({ id });
    expect(await cerradaPorPlazo(deps, contacto, new Date('2026-10-21T14:00:00Z'))).toBeNull();
  });
});

describe('los ajustes del panel mandan sobre el plazo', () => {
  const incidencias = async (e: EscenarioEntregas) =>
    (await e.repos.rutas.reportesRecientes(100, 'incidencia')).filter((r) => r.payload.tracking === 'PLAZO-1' && r.payload.codigo === 'sin_respuesta').length;

  it('con tres mensajes cada 2 min y espera final de 10 min: incidencia justo a los 10 min del último, ni antes ni después', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      const r = await e.api.post('/admin/rutas/ajustes', { esperasMensajesSegundos: [120, 120], esperaFinalSegundos: 600 });
      expect(r.status).toBe(200);
      expect((r.body as { vigente: { maxIntentos: number } }).vigente.maxIntentos).toBe(3);
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      e.avanzar(2);
      await e.trabajar();
      e.avanzar(2);
      await e.trabajar();
      const s = e.repos.rutas._solicitudes[0]!;
      expect(s.intentos).toBe(3);
      expect(s.proximoIntentoAt!.getTime() - s.ultimoEnvioAt!.getTime()).toBe(600_000);
      const enviados = e.mensajesA(tel).length;

      e.avanzar(9);
      await e.trabajar();
      expect(s.estado).not.toBe('derivado');
      expect(await incidencias(e)).toBe(0);

      e.avanzar(2);
      await e.trabajar();
      expect(solicitud(e, s.id)).toMatchObject({ estado: 'derivado', incidencia: 'sin_respuesta' });
      expect(await incidencias(e)).toBe(1);
      expect(e.mensajesA(tel)).toHaveLength(enviados);
    } finally {
      await e.cerrar();
    }
  });

  it('cambiar la espera final mueve el plazo de quien ya la estaba esperando, aunque hubiera contestado', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const id = await enEsperaFinal(e, 20);
      await e.repos.rutas.actualizarSolicitud(id, { estado: 'respondio', requiereHumano: true, incidencia: 'respondio_sin_ubicacion', primeraRespuestaAt: e.ahora() });
      const ultimo = solicitud(e, id).ultimoEnvioAt!.getTime();

      await e.api.post('/admin/rutas/ajustes', { esperasMensajesSegundos: [60, 60, 60], esperaFinalSegundos: 300 });
      expect(solicitud(e, id).proximoIntentoAt!.getTime()).toBe(ultimo + 300_000);

      e.avanzar(1);
      await e.api.post('/admin/rutas/ajustes', { esperasMensajesSegundos: [60, 60, 60], esperaFinalSegundos: 0 });
      await e.trabajar();
      expect(solicitud(e, id)).toMatchObject({ estado: 'derivado', incidencia: 'respondio_sin_ubicacion' });
    } finally {
      await e.cerrar();
    }
  });

  it('bajar el número de mensajes deja en incidencia a quien ya los había recibido', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      const id = e.repos.rutas._solicitudes[0]!.id;
      await e.repos.rutas.actualizarSolicitud(id, { estado: 'enviado', intentos: 3, ultimoEnvioAt: new Date(e.ahora().getTime() - 30 * 60_000), proximoIntentoAt: new Date(e.ahora().getTime() + 10 * 60_000) });

      await e.api.post('/admin/rutas/ajustes', { esperasMensajesSegundos: [60], esperaFinalSegundos: 600 });
      await e.trabajar();
      expect(solicitud(e, id)).toMatchObject({ estado: 'derivado', incidencia: 'sin_respuesta' });
    } finally {
      await e.cerrar();
    }
  });

  it('un pin esperando su «¿es ahí?» no se convierte en incidencia al vencer el plazo, y su respuesta se atiende', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const id = await enEsperaFinal(e, 20);
      const entrega = (await e.repos.entregas.vivasPorTelefono('51' + tel))[0]!;
      await e.repos.entregas.actualizar(entrega.id, { pinPropuestoAt: e.ahora(), pinPropuestoLat: PIN_LIMA.lat, pinPropuestoLng: PIN_LIMA.lng });
      e.avanzar(21);
      await e.trabajar();
      expect(solicitud(e, id).estado).toBe('enviado');
      expect(solicitud(e, id).proximoIntentoAt!.getTime()).toBeGreaterThan(e.ahora().getTime());
      expect(await incidencias(e)).toBe(0);

      // Al resolverse la duda, el plazo vuelve a mandar.
      await e.repos.entregas.actualizar(entrega.id, { pinPropuestoAt: null, pinPropuestoLat: null, pinPropuestoLng: null });
      e.avanzar(6);
      await e.trabajar();
      expect(solicitud(e, id).estado).toBe('derivado');
    } finally {
      await e.cerrar();
    }
  });

  it('una derivación a mano (antes de agotar los mensajes) no calla al cliente', async () => {
    const repos = createFakeRepos();
    const contacto = await repos.contacts.upsertFromInbound('51987654321', 'Ana');
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '51987654321', phone: '51987654321', nombre: 'Ana', referencia: 'P-1' }]);
    const ahora = new Date('2026-10-20T20:00:00Z');
    await repos.rutas.actualizarSolicitud(repos.rutas._solicitudes[0]!.id, { estado: 'derivado', intentos: 1, incidencia: 'sin_respuesta', ultimoEnvioAt: ahora });
    expect(await cerradaPorPlazo({ repos, gsg: crearPuertoEnEspera(), timezone: 'America/Lima', maxIntentos: async () => 4 }, contacto, ahora)).toBeNull();
  });
});
