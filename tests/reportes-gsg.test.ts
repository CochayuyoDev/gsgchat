/**
 * GSGchat le reporta a GSG los números mal y los errores (su endpoint de
 * reportes, p. ej. POST v1/gsgchat/reported), con el contrato del plan de GSG:
 * { tracking, tipo: 'PROBLEMA', motivo, comentario, telefonoOrigen, fechaMensaje, eventoId }.
 */

import { describe, expect, it } from 'vitest';
import { crearPuertoHttp, motivoGsg, problemaParaGsg } from '../src/rutas/gsg.js';
import { OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import { ajustesPorDefecto } from '../src/rutas/ajustes.js';
import { errorDeTelefono, TEXTOS_REPORTADOS } from '../src/entregas/reportados.js';
import { INCIDENCIAS } from '../src/rutas/incidencias.js';
import { crearEscenarioEntregas, PAUSA_SEGUNDOS, type EscenarioEntregas } from './escenario-entregas.js';

describe('el formato de GSG', () => {
  it('cada código de GSGchat cae en un motivo de su catálogo', () => {
    expect(motivoGsg('sin_whatsapp')).toBe('TELEFONO_MAL');
    expect(motivoGsg('telefono_invalido')).toBe('TELEFONO_MAL');
    expect(motivoGsg('numero_corto')).toBe('TELEFONO_MAL');
    expect(motivoGsg('no_soy_yo')).toBe('NO_RECONOCE_PEDIDO');
    expect(motivoGsg('numero_equivocado')).toBe('NO_RECONOCE_PEDIDO');
    expect(motivoGsg('rechaza_contacto')).toBe('RECHAZA');
    expect(motivoGsg('ubicacion_fuera_de_zona')).toBe('DIRECCION_MAL');
    expect(motivoGsg('sin_respuesta')).toBe('OTRO');
  });

  it('una incidencia del reparto (como la de luchito) sale en su formato', () => {
    const p = problemaParaGsg({ tipo: 'incidencia', referencia: 'GSG-E-240268', tracking: 'GSG-E-240268', telefono: '51999999999', codigo: 'sin_whatsapp', titulo: 'El número no tiene WhatsApp', detalle: 'el número 51999999999 no tiene una cuenta de WhatsApp', detectadoEn: '2026-10-12T18:40:00.000Z' });
    expect(p).toEqual({
      tracking: 'GSG-E-240268', tipo: 'PROBLEMA', motivo: 'TELEFONO_MAL',
      // «Sin WhatsApp» le llega a GSG como numero invalido, para que edite el numero.
      codigo: 'numero_invalido', queHacer: 'Corrige el número del cliente y vuelve a mandar el pedido.',
      comentario: 'Número inválido: no tiene WhatsApp: el número 999999999 no tiene una cuenta de WhatsApp',
      telefonoOrigen: '999999999', fechaMensaje: '2026-10-12T18:40:00.000Z',
      eventoId: 'gsgchat-GSG-E-240268-sin_whatsapp-2026-10-12',
    });
  });

  it('cada error con su nombre: faltan dígitos, no es la persona (no uno general)', () => {
    expect(errorDeTelefono('98765432')).toBe('numero_corto');
    expect(errorDeTelefono('+51 98765432')).toBe('numero_corto');
    expect(errorDeTelefono('9876543210')).toBe('numero_largo');
    expect(errorDeTelefono('hola')).toBe('telefono_invalido');
    expect(TEXTOS_REPORTADOS.numero_corto.titulo).toBe('Al número le faltan dígitos');
    expect(INCIDENCIAS.numero_corto.titulo).toBe('Al número le faltan dígitos');
    expect(INCIDENCIAS.numero_equivocado.titulo).toBe('No es la persona');
    const p = problemaParaGsg({ tracking: 'GSG-E-1', codigo: 'no_soy_yo', telefono: '51987654321', titulo: TEXTOS_REPORTADOS.no_soy_yo.titulo, detalle: 'contestó: "no es mi pedido"' });
    expect(p).toMatchObject({ codigo: 'no_soy_yo', motivo: 'NO_RECONOCE_PEDIDO', telefonoOrigen: '987654321' });
    expect(p.comentario).toMatch(/^No es la persona/);
    expect(p.comentario).not.toMatch(/no se le puede escribir/i);
  });

  it('el envío va a la ruta del panel, con Idempotency-Key = eventoId; sin tracking no se manda', async () => {
    const llegadas: Array<{ url: string; cuerpo: any; idem: string | undefined }> = [];
    const fetchImpl = (async (url: string, o: RequestInit & { headers: Record<string, string> }) => { llegadas.push({ url, cuerpo: JSON.parse(String(o.body)), idem: o.headers['Idempotency-Key'] }); return new Response('{}', { status: 201 }); }) as unknown as typeof fetch;
    const p = crearPuertoHttp({ url: 'https://gsg.example/api', token: 'clave-gsg-123', rutaIncidencias: 'v1/gsgchat/reported', fetchImpl });
    expect((await p.enviar('incidencia', { tracking: 'GSG-E-1', codigo: 'sin_whatsapp', telefono: '51999999999', titulo: 'Sin WhatsApp' })).ok).toBe(true);
    expect(llegadas[0]!.url).toBe('https://gsg.example/api/v1/gsgchat/reported');
    expect(llegadas[0]!.cuerpo).toMatchObject({ tracking: 'GSG-E-1', tipo: 'PROBLEMA', motivo: 'TELEFONO_MAL', telefonoOrigen: '999999999' });
    expect(llegadas[0]!.idem).toBe(llegadas[0]!.cuerpo.eventoId);
    const sinTracking = await p.enviar('incidencia', { codigo: 'sin_whatsapp' });
    expect(sinTracking).toMatchObject({ ok: false, reintentable: false });
    expect(llegadas).toHaveLength(1);
  });
});

function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

describe('de punta a punta', () => {
  it('número sin WhatsApp: GSG recibe UN reporte en /v1/gsgchat/reported con su tracking, aunque venga por el reparto y por la bandeja', async () => {
    const llegadas: Array<{ url: string; cuerpo: any }> = [];
    const fetchGsg = (async (url: string, o?: RequestInit) => { llegadas.push({ url, cuerpo: o?.body ? JSON.parse(String(o.body)) : null }); return new Response('{"id":"GSG-1"}', { status: 201 }); }) as unknown as typeof fetch;
    const e: EscenarioEntregas = await crearEscenarioEntregas({ arranque: hoyALas9(), geocodificador: null, fetchGsg });
    try {
      const base = ajustesPorDefecto({ ...OPCIONES_POR_DEFECTO, pausaMinSegundos: PAUSA_SEGUNDOS, pausaMaxSegundos: PAUSA_SEGUNDOS, horaInicio: 0, horaFin: 24 });
      await e.repos.rutas.ajustes.set({ esperaRespuestaMinutos: 30, maxIntentos: 3 }, base);
      await e.conexionGsg.conectarReal({ url: 'https://gsg.example/api', rutaUbicacion: 'v1/gsgchat/send-location', rutaIncidencias: 'v1/gsgchat/reported', apiKey: 'clave-gsg-123' });
      e.wa.tieneWhatsApp = async (phone: string) => phone !== '51999999999';
      const alta = await e.api.post<any>('/api/v1/entregas', { tracking: 'GSG-E-240268', cliente: 'luchito', telefono: '999999999', distrito: 'SAN MARTÍN DE PORRES', empresa: { codigo: '516', nombre: 'Empresa' }, metodoPago: 'Efectivo', montoCobrar: 85 });
      expect(alta.status).toBe(201);
      for (let i = 0; i < 3; i++) { await e.trabajar(); e.avanzar(1); }
      await e.despacharAGsg();
      const reportes = llegadas.filter((l) => l.url.endsWith('/v1/gsgchat/reported'));
      expect(reportes, JSON.stringify(llegadas.map((l) => l.url))).toHaveLength(1);
      expect(reportes[0]!.cuerpo).toMatchObject({ tracking: 'GSG-E-240268', tipo: 'PROBLEMA', motivo: 'TELEFONO_MAL', codigo: 'numero_invalido', telefonoOrigen: '999999999' });
      expect(reportes[0]!.cuerpo.comentario).toMatch(/WhatsApp/);
      // Y en «Lo que enviamos a GSG» se ve como Problema, enviado.
      const env = await e.api.get<any>('/admin/gsg/envios');
      expect(env.body.destinoProblemas).toBe('https://gsg.example/api/v1/gsgchat/reported');
      expect(env.body.items.some((r: any) => r.tipo === 'incidencia' && r.estado === 'enviado' && r.cuerpo.motivo === 'TELEFONO_MAL')).toBe(true);
    } finally {
      await e.cerrar();
    }
  }, 90_000);
});
