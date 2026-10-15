import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG } from './escenario-entregas.js';
import { crearControlEnvios } from '../src/salud/control-envios.js';
import { POLITICA_NO_OFICIAL } from '../src/salud/politica.js';
import { decidirRitmo } from '../src/salud/ritmo.js';
import { createSender } from '../src/outbound/sender.js';
import { crearMotor, OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import { setFakeClock } from './fakes.js';
import { rutasPage } from '../src/web/rutas-page.js';
import { fiabilidadPage } from '../src/web/fiabilidad-page.js';

afterEach(() => setFakeClock(null));
const phone = '51987601210';
const pedido = { ...OBLIGATORIOS_GSG, tracking: 'SIN-FRENO', cliente: 'Cliente', telefono: phone };

describe('control de envíos sin salud de cuenta', () => {
  it('la web no anuncia multiplicadores, evaluación de riesgo ni rampas de salud', () => {
    const rutas = rutasPage({ configured: true, nombreNegocio: 'GSGchat' });
    const estado = fiabilidadPage({ disponible: true, demo: false, nombreNegocio: 'GSGchat' });
    expect(rutas).not.toContain('pausa-salud');
    expect(rutas).not.toContain('salud en');
    expect(rutas).not.toContain('m.pausa[0] / factor');
    expect(estado).not.toContain('Evaluar riesgo');
    expect(estado).not.toContain('/admin/salud/reanudar');
    expect(estado).not.toContain('setInterval(saludNumero');
  });
  it('retira la pausa y rampa antiguas, ignora cupos internos y respeta 30 segundos', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: new Date('2026-10-15T15:00:00Z') });
    setFakeClock(e.ahora);
    try {
      await e.repos.numberState.setPaused('PNID', true, 'salud: riesgo alto');
      await e.repos.numberState.setRiesgo('PNID', { riesgo: 80, nivel: 'rojo', factor: 0.1, motivos: ['pausa antigua'], rampaDesde: e.ahora(), pausadaHasta: new Date(e.ahora().getTime() + 3600000), ultimaEvaluacion: e.ahora() });
      const politica = () => ({ ...POLITICA_NO_OFICIAL, soloRitmo: true, pausaMinMs: 30000, pausaMaxMs: 30000, diasPermitidos: [], maxPorHora: 1, maxPorMinuto: 1, nuevosContactosPorDia: 1 });
      const control = await crearControlEnvios({ repos: e.repos, politica, phoneNumberId: () => 'PNID', ahora: e.ahora });
      expect(control.factor()).toBe(1);
      expect(await e.repos.numberState.get('PNID')).toMatchObject({ paused: false, factor: 1, rampaDesde: null, pausadaHasta: null });
      const c = await e.repos.contacts.upsertFromInbound(phone);
      await e.repos.contacts.setOptIn(phone, 'pedido de GSG');
      await e.repos.contacts.suprimir(phone, new Date(e.ahora().getTime() + 86400000), 'salud antigua', 'todo');
      for (let i = 0; i < 30; i++) await e.repos.counters.increment('PNID', 'UTILITY', e.ahora());
      const sender = createSender({ repos: e.repos, wa: e.wa, phoneNumberId: 'PNID', serviceWindowApplies: false, warmup: { startPerDay: 1, growth: 1, hardCap: 1 }, maxMarketingPerContact7d: 2, salud: control, politica, now: e.ahora });
      const send = () => sender.send({ phone, kind: 'freeform', category: 'UTILITY', text: 'Pedido', programado: true });
      expect((await send()).ok).toBe(true);
      e.avanzarSegundos(29);
      expect(await send()).toMatchObject({ ok: false, blocked: true, code: 'rhythm' });
      e.avanzarSegundos(1);
      expect((await send()).ok).toBe(true);
      // El control no consulta estadísticas para aplicar la pausa.
      const estadisticas = vi.spyOn(e.repos.deliveries, 'resumenDesde');
      const foto = await control.fotoRitmo(c, e.ahora());
      expect(estadisticas).not.toHaveBeenCalled();
      expect(decidirRitmo({ ...foto, factor: 0.1, ultimaHora: 10000, ultimoMinuto: 1000 }, politica())).toMatchObject({ codigo: 'pausa_entre_envios' });
      e.avanzarSegundos(30);
      expect(decidirRitmo(await control.fotoRitmo(c, e.ahora()), politica())).toEqual({ ok: true });
    } finally { await e.cerrar(); }
  });

  it('recupera el pedido retenido 20 minutos por un cupo eliminado y envía desde su cola', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: new Date('2026-10-15T15:00:00Z') });
    setFakeClock(e.ahora);
    try {
      await e.api.post('/admin/rutas/ajustes', { esperasMensajesMinutos: [1, 1] });
      await e.api.post('/api/v1/entregas', pedido);
      const entrega = (await e.entrega('SIN-FRENO'))!;
      const s = e.repos.rutas._solicitudes[0]!;
      const esperaVieja = new Date(e.ahora().getTime() + 3600000);
      await e.repos.rutas.actualizarSolicitud(s.id, { incidencia: 'envio_bloqueado', incidenciaDetalle: 'daily_cap: cupo alcanzado', proximoIntentoAt: esperaVieja });
      await e.repos.entregas.actualizar(entrega.id, { mensajeEstado: 'reintentando', mensajeErrorCodigo: 'daily_cap', mensajeError: 'cupo alcanzado', mensajeProximoAt: esperaVieja });
      e.avanzar(20);
      const politica = () => ({ ...POLITICA_NO_OFICIAL, soloRitmo: true, pausaMinMs: 15000, pausaMaxMs: 30000, diasPermitidos: [] });
      const control = await crearControlEnvios({ repos: e.repos, politica, phoneNumberId: () => 'PNID', ahora: e.ahora });
      expect((await e.repos.rutas.solicitud(s.id))!.proximoIntentoAt!.getTime()).toBeLessThanOrEqual(e.ahora().getTime());
      const sender = createSender({ repos: e.repos, wa: e.wa, phoneNumberId: 'PNID', serviceWindowApplies: false, warmup: politica().warmup, maxMarketingPerContact7d: 2, salud: control, politica, now: e.ahora });
      const motor = crearMotor({ repos: e.repos, sender, wa: e.wa, gsg: e.conexionGsg.puerto(), opciones: OPCIONES_POR_DEFECTO, salud: control, politica, ahora: e.ahora, usarPlantilla: () => false, primerMensaje: e.entregas.primerMensajeReparto });
      expect((await motor.tick()).accion).toBe('envio');
      e.avanzar(1);
      expect((await motor.tick()).accion).toBe('envio');
      expect(e.mensajesA(phone)).toHaveLength(2);
    } finally { await e.cerrar(); }
  });
});
