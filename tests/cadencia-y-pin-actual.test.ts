import { afterEach, describe, expect, it, vi } from 'vitest';
import { envioProgramado, escribirComoHumano } from '../src/salud/humano.js';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG } from './escenario-entregas.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { loadConfig } from '../src/config.js';
import { crearMotor, OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import { crearControlEnvios } from '../src/salud/control-envios.js';
import { POLITICA_NO_OFICIAL } from '../src/salud/politica.js';
import { createSender } from '../src/outbound/sender.js';
import { esperaDeEnvio } from '../src/rutas/espera-envio.js';
import { setFakeClock } from './fakes.js';

const telefono = '987601208';
const phone = '51' + telefono;
const fijo = { lat: -11.997014, lng: -77.097061 };
const pedido = { ...OBLIGATORIOS_GSG, tracking: 'GSG-E-208', cliente: 'Antonio', telefono, distrito: 'Lince' };
const config = loadConfig({ PUBLIC_BASE_URL: 'http://localhost:3000', DATABASE_URL: 'mysql://x/y', TRACKING_SECRET: 'x'.repeat(40), TIMEZONE: 'America/Lima' });
afterEach(() => setFakeClock(null));

describe('ubicación actual sin confirmación por distrito', () => {
  it.each([false, true])('registra un pin fijo lejos del distrito y agradece una vez, bot pausado: %s', async (pausado) => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido); await e.trabajar();
      const c = (await e.repos.contacts.getByPhone(phone))!;
      if (pausado) await e.repos.contacts.pausarBot(c.id, true, e.ahora());
      const antes = e.mensajesA(telefono).length;
      await e.contesta(telefono, { pin: fijo });
      expect(await e.entrega('GSG-E-208')).toMatchObject({ ubicacionEstado: 'recibida', lat: fijo.lat, lng: fijo.lng, pinPropuestoAt: null });
      expect(e.repos.rutas._solicitudes[0]).toMatchObject({ estado: 'resuelto', proximoIntentoAt: null });
      expect(e.mensajesA(telefono)).toHaveLength(antes + 1);
      expect(e.textosA(telefono).at(-1)).toMatch(/ubicación/i);
      expect(e.textosA(telefono).join('\n')).not.toMatch(/queda lejos|es ahí donde/i);
      await e.contesta(telefono, { pin: fijo });
      await e.contesta(telefono, { texto: 'Si' });
      expect(e.mensajesA(telefono)).toHaveLength(antes + 1);
      await e.despacharAGsg();
      expect(e.simulador.recibido.some(r => r.tipo === 'ubicacion' && (r.cuerpo.tracking ?? r.cuerpo.referencia) === 'GSG-E-208')).toBe(true);
    } finally { await e.cerrar(); }
  });

  it('rechaza ubicación en tiempo real, pero registra el pin fijo posterior', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido); await e.trabajar();
      await e.api.post('/admin/dev/inbound', { from: phone, location: { latitude: fijo.lat, longitude: fijo.lng }, enVivo: true });
      expect(await e.entrega('GSG-E-208')).toMatchObject({ ubicacionEstado: 'pendiente', lat: null, pinPropuestoAt: null });
      expect(await e.repos.rutas.reportesRecientes(100, 'ubicacion')).toHaveLength(0);
      await e.contesta(telefono, { texto: 'Si' });
      expect((await e.entrega('GSG-E-208'))!.ubicacionEstado).toBe('pendiente');
      await e.contesta(telefono, { pin: fijo });
      expect((await e.entrega('GSG-E-208'))!.ubicacionEstado).toBe('recibida');
    } finally { await e.cerrar(); }
  });

  it('recupera un pin fijo antiguo pendiente del SÍ y no repite el agradecimiento', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido); await e.trabajar();
      const entrega = (await e.entrega('GSG-E-208'))!;
      await e.repos.entregas.actualizar(entrega.id, { pinPropuestoLat: fijo.lat, pinPropuestoLng: fijo.lng, pinPropuestoAt: e.ahora(), pinPropuestoFuente: 'pin de whatsapp' });
      const antes = e.mensajesA(telefono).length;
      await e.entregas.revisarReparto();
      await e.entregas.revisarReparto();
      expect((await e.entrega('GSG-E-208'))!.ubicacionEstado).toBe('recibida');
      expect(e.repos.rutas._solicitudes[0]!.estado).toBe('resuelto');
      expect(e.mensajesA(telefono)).toHaveLength(antes + 1);
    } finally { await e.cerrar(); }
  });
});

describe('web → política global → motor → sender con reloj controlado', () => {
  it('no añade escritura artificial a la espera configurada', async () => {
    const dormir = vi.fn(async () => undefined);
    const enviar = vi.fn(async () => 'wamid-real');
    const teclado = { escribiendo: vi.fn(async () => undefined), parado: vi.fn(async () => undefined) };
    expect(await envioProgramado(() => escribirComoHumano(teclado, 'Solicitud de ubicación', enviar, { dormir }))).toBe('wamid-real');
    expect(dormir).not.toHaveBeenCalled();
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('dos envíos programados paralelos y dentro de ventana no saltan la pausa global', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: new Date('2026-10-15T15:00:00Z') });
    setFakeClock(e.ahora);
    try {
      const politica = () => ({ ...POLITICA_NO_OFICIAL, soloRitmo: true, pausaMinMs: 15000, pausaMaxMs: 30000, diasPermitidos: [], nuevosContactosPorDia: 0,
        warmup: { ...POLITICA_NO_OFICIAL.warmup, reinicioTrasDiasInactivo: 0 } });
      const salud = await crearControlEnvios({ repos: e.repos, politica, phoneNumberId: () => 'PNID', ahora: e.ahora, azar: () => 0.5 });
      const sender = createSender({ repos: e.repos, wa: e.wa, phoneNumberId: 'PNID', warmup: politica().warmup, maxMarketingPerContact7d: 2, now: e.ahora, salud, politica, serviceWindowApplies: false });
      for (const numero of [phone, '51987601209']) { await e.repos.contacts.upsertFromInbound(numero); await e.repos.contacts.touchInbound(numero, e.ahora()); }
      const send = (numero: string) => sender.send({ phone: numero, kind: 'freeform', category: 'UTILITY', text: 'Ubicación, por favor.', programado: true });
      const salidas = await Promise.all([send(phone), send('51987601209')]);
      expect(salidas.filter(s => s.ok)).toHaveLength(1);
      expect(salidas.find(s => !s.ok)).toMatchObject({ blocked: true, code: 'rhythm' });
      e.avanzarSegundos(22.5);
      expect((await send('51987601209')).ok).toBe(true);
    } finally { await e.cerrar(); }
  });

  it('atiende un recordatorio vencido antes que los primeros mensajes de un lote acumulado', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/admin/rutas/ajustes', { esperasMensajesMinutos: [1, 1] });
      await e.api.post('/api/v1/entregas', pedido); await e.trabajar();
      await e.api.post('/api/v1/entregas', { ...pedido, tracking: 'GSG-E-209', telefono: '987601209' });
      e.avanzar(1);
      const siguiente = (await e.repos.rutas.tocaIntentar(e.ahora(), 1))[0]!;
      expect(siguiente.intentos).toBe(1);
      expect((await e.motorReparto.tick()).solicitudId).toBe(siguiente.id);
      expect(e.mensajesA(telefono)).toHaveLength(2);
      expect(e.mensajesA('987601209')).toHaveLength(0);
    } finally { await e.cerrar(); }
  });

  it.each([1, 5, 15])('respeta %i minutos y cambia la pausa global en caliente', async (minutos) => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: new Date('2026-10-15T15:00:00Z') });
    setFakeClock(e.ahora);
    try {
      const guardado = await e.api.post('/admin/rutas/ajustes', { pausaMinSegundos: 15, pausaMaxSegundos: 30, esperasMensajesMinutos: [minutos, minutos] });
      expect(guardado.status).toBe(200);
      const generales = await crearServicioAjustes({ repo: e.repos.ajustesGenerales, config, releerCadaMs: 0 });
      const politica = () => ({ ...generales.politica({ ...POLITICA_NO_OFICIAL, diasPermitidos: [], maxPorMinuto: 100, maxPorHora: 10000, nuevosContactosPorDia: 0, warmup: { ...POLITICA_NO_OFICIAL.warmup, startPerDay: 10000, hardCap: 10000, reinicioTrasDiasInactivo: 0 } }), soloRitmo: true });
      expect(politica()).toMatchObject({ pausaMinMs: 15000, pausaMaxMs: 30000 });
      const salud = await crearControlEnvios({ repos: e.repos, politica, phoneNumberId: () => 'PNID', ahora: e.ahora, azar: () => 0.5 });
      const sender = createSender({ repos: e.repos, wa: e.wa, phoneNumberId: 'PNID', serviceWindowApplies: false, warmup: politica().warmup, maxMarketingPerContact7d: 2, now: e.ahora, salud, politica });
      const motor = crearMotor({ repos: e.repos, sender, wa: e.wa, gsg: e.conexionGsg.puerto(), opciones: OPCIONES_POR_DEFECTO, ahora: e.ahora, usarPlantilla: () => false, salud, politica, primerMensaje: e.entregas.primerMensajeReparto });
      await e.api.post('/api/v1/entregas', pedido);
      expect((await motor.tick()).accion).toBe('envio');
      const primero = e.repos.rutas._solicitudes[0]!.ultimoEnvioAt!.getTime();
      e.avanzarSegundos(minutos * 60 - 1);
      expect((await motor.tick()).accion).toBe('nada');
      e.avanzarSegundos(1);
      expect((await motor.tick()).accion).toBe('envio');
      expect(e.repos.rutas._solicitudes[0]!.ultimoEnvioAt!.getTime() - primero).toBe(minutos * 60_000);
      e.avanzarSegundos(minutos * 60);
      expect((await motor.tick()).accion).toBe('envio');
      expect(e.repos.rutas._solicitudes[0]!.intentos).toBe(3);

      // El mismo sorteo vigente se adapta al nuevo rango sin reiniciar.
      await e.api.post('/admin/rutas/ajustes', { pausaMinSegundos: 10, pausaMaxSegundos: 10 });
      await generales.recargar();
      expect(salud.marcapasos.pausaSorteadaMs()).toBe(10000);
      const leido = await e.api.get<{ ajustes: { pausaMinSegundos: number } }>('/admin/rutas/ajustes');
      expect(leido.body.ajustes.pausaMinSegundos).toBe(10);
    } finally { await e.cerrar(); }
  });

  it('muestra desconexión sin gastar intentos y limpia el motivo al enviar', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      let conectado = false;
      e.wa.conectado = () => conectado;
      const s = e.repos.rutas._solicitudes[0]!;
      await e.motorReparto.tick();
      expect(s.intentos).toBe(0);
      expect(esperaDeEnvio(e.repos.rutas, s, e.ahora().getTime())?.codigo).toBe('sin_conexion');
      const pantalla = await e.api.get<{ items: Array<{ esperaEnvio: { codigo: string } }> }>('/admin/rutas/solicitudes');
      expect(pantalla.body.items[0]!.esperaEnvio.codigo).toBe('sin_conexion');
      conectado = true; e.avanzarSegundos(5);
      expect((await e.motorReparto.tick()).accion).toBe('envio');
      expect(esperaDeEnvio(e.repos.rutas, e.repos.rutas._solicitudes[0]!, e.ahora().getTime())?.codigo).toBe('programado');
    } finally { await e.cerrar(); }
  });
});
