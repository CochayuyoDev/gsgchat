/**
 * Los datos del envio que GSG manda con cada pedido (producto, empresa,
 * codigo, numero de pedido, metodo de pago, monto y quien firma): se leen en
 * todas sus formas, llegan por la API, por la lista de GSG y por el
 * simulador, se guardan con la entrega y se reflejan si GSG los cambia.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { CLAVE_API_PRUEBA } from './fakes.js';
import { datosEnvioDeCrudo, empresaEnTexto, fusionarDatosEnvio, montoEnTexto } from '../src/entregas/datos-envio.js';
import { crearGsgSimulado } from '../src/entregas/gsg-simulado.js';
import { clienteInventado } from '../src/desarrollador/datos-peru.js';
import { avisoDireccionPublica } from '../src/config.js';
import { CAMPOS_PEDIDO } from '../src/rutas/gsg-extras.js';

function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

describe('leer los datos del envío', () => {
  it('acepta la empresa como objeto, en campos sueltos o como texto, y el monto como número', () => {
    expect(datosEnvioDeCrudo({ producto: 'Zapatillas talla 40', empresa: { codigo: '516', nombre: 'Zapatería Lima' }, tracking: 'GSG-A-102345', nroPedido: '#1042', metodoPago: 'YAPE', monto: 85, remitente: 'Juan Quispe' })).toEqual({
      producto: 'Zapatillas talla 40',
      empresaCodigo: '516',
      empresaNombre: 'Zapatería Lima',
      tracking: 'GSG-A-102345',
      nroPedido: '#1042',
      metodoPago: 'YAPE',
      monto: '85.00',
      remitente: 'Juan Quispe',
    });
    expect(datosEnvioDeCrudo({ tiendaCodigo: 516, tiendaNombre: 'Zapatería Lima' })).toEqual({ empresaCodigo: '516', empresaNombre: 'Zapatería Lima' });
    expect(datosEnvioDeCrudo({ empresaCodigo: '7', empresaNombre: 'X' })).toEqual({ empresaCodigo: '7', empresaNombre: 'X' });
    expect(datosEnvioDeCrudo({ empresa: '516 - Zapatería Lima' })).toEqual({ empresaNombre: '516 - Zapatería Lima' });
    // Nada del envio: null (no se guarda un objeto vacio).
    expect(datosEnvioDeCrudo({ referencia: 'P-1', telefono: '987000001', monto: '  ', producto: null })).toBeNull();
  });

  it('el monto: número con dos decimales, texto raro tal cual', () => {
    expect(montoEnTexto(85)).toBe('85.00');
    expect(montoEnTexto('59.9')).toBe('59.90');
    expect(montoEnTexto('S/ 85,50')).toBe('S/ 85,50');
    expect(montoEnTexto(undefined)).toBeNull();
  });

  it('la empresa en una línea sin repetir el código', () => {
    expect(empresaEnTexto({ empresaCodigo: '516', empresaNombre: 'Zapatería Lima' })).toBe('516 - Zapatería Lima');
    expect(empresaEnTexto({ empresaCodigo: '516', empresaNombre: '516 - Zapatería Lima' })).toBe('516 - Zapatería Lima');
    expect(empresaEnTexto({ empresaNombre: 'Zapatería Lima' })).toBe('Zapatería Lima');
    expect(empresaEnTexto(null)).toBe('');
  });

  it('fusionar: lo nuevo manda, lo que no llega no borra, y sin cambios da null', () => {
    const antes = { producto: 'A', monto: '10.00' };
    expect(fusionarDatosEnvio(antes, { monto: '12.00' })).toEqual({ producto: 'A', monto: '12.00' });
    expect(fusionarDatosEnvio(antes, { monto: '10.00' })).toBeNull();
    expect(fusionarDatosEnvio(antes, null)).toBeNull();
  });

  it('el verificador del contrato no marca los campos nuevos como sobrantes', () => {
    for (const c of ['producto', 'empresa', 'tracking', 'nroPedido', 'metodoPago', 'monto', 'remitente']) expect(CAMPOS_PEDIDO.has(c), c).toBe(true);
  });

  it('el generador del Módulo desarrollador inventa los datos del envío', () => {
    const c = clienteInventado(() => 0.3);
    expect(c.producto).toBeTruthy();
    expect(c.empresa.codigo).toMatch(/^\d+$/);
    expect(c.tracking).toMatch(/^GSG-A-\d{6}$/);
    expect(c.nroPedido).toMatch(/^#\d{4}$/);
    expect(c.remitente).toBeTruthy();
  });
});

describe('el simulador de GSG manda los datos del envío', () => {
  it('sus pedidos de prueba traen producto, empresa, código, pedido, pago, monto y remitente', () => {
    const sim = crearGsgSimulado({ token: 't' });
    sim.cargarDePrueba();
    const p = sim.pendientes().faltaUbicacion.find((x) => x.referencia === 'P-1001')!;
    expect(p).toMatchObject({ producto: 'Zapatillas talla 40', empresa: { codigo: '516', nombre: 'Zapatería Lima' }, tracking: 'GSG-A-102345', nroPedido: '#1042', metodoPago: 'YAPE', monto: '85.00', remitente: 'Juan Quispe' });
    // P-1005 no trae remitente: no sale la clave (nada de "undefined").
    const sinRemitente = sim.pendientes().faltaUbicacion.find((x) => x.referencia === 'P-1005')!;
    expect('remitente' in sinRemitente).toBe(false);
    // GSG cambia el monto de uno: sale el nuevo y se conserva lo demas.
    const r = sim.atender('POST', '/reparto/cambiar', 't', { referencia: 'P-1001', monto: 90 });
    expect(r.status).toBe(200);
    expect(sim.pendientes().faltaUbicacion.find((x) => x.referencia === 'P-1001')).toMatchObject({ monto: '90.00', producto: 'Zapatillas talla 40' });
  });
});

describe('los datos del envío llegan a la entrega', () => {
  let e: EscenarioEntregas;
  beforeAll(async () => {
    e = await crearEscenarioEntregas({ supervisor: '51912426667', arranque: hoyALas9() });
  });
  afterAll(() => e.cerrar());

  it('por la API: con y sin pin, y lo que falta no se inventa', async () => {
    const r = await e.api.post<{ creadas: Array<Record<string, unknown>> }>('/api/v1/entregas', {
      pedidos: [
        { referencia: 'D-1', telefono: '987000301', nombre: 'María Pérez', direccion: 'Av. La Marina 1234', distrito: 'San Miguel', producto: 'Zapatillas talla 40', empresa: { codigo: '516', nombre: 'Zapatería Lima' }, tracking: 'GSG-A-102345', nroPedido: '#1042', metodoPago: 'YAPE', monto: 85, remitente: 'Juan Quispe' },
        { referencia: 'D-2', telefono: '987000302', nombre: 'Luis Rojas', lat: -12.1211, lng: -77.0301, faltaConfirmar: true, tiendaCodigo: '231', tiendaNombre: 'Moda Gamarra', metodoPago: 'Pagado' },
        { referencia: 'D-3', telefono: '987000303', nombre: 'Sin datos' },
      ],
    });
    expect(r.status).toBe(201);
    const d1 = await e.entrega('D-1');
    expect(d1?.datosEnvio).toEqual({ producto: 'Zapatillas talla 40', empresaCodigo: '516', empresaNombre: 'Zapatería Lima', tracking: 'GSG-A-102345', nroPedido: '#1042', metodoPago: 'YAPE', monto: '85.00', remitente: 'Juan Quispe' });
    expect((await e.entrega('D-2'))?.datosEnvio).toEqual({ empresaCodigo: '231', empresaNombre: 'Moda Gamarra', metodoPago: 'Pagado' });
    expect((await e.entrega('D-3'))?.datosEnvio).toBeNull();
    // La API los devuelve al consultar el pedido.
    const uno = await e.api.get<{ entrega: Record<string, unknown> }>('/api/v1/entregas/D-1');
    expect(uno.body.entrega).toMatchObject({ producto: 'Zapatillas talla 40', empresa: { codigo: '516', nombre: 'Zapatería Lima', texto: '516 - Zapatería Lima' }, monto: '85.00', remitente: 'Juan Quispe' });
  });

  it('PATCH cambia los datos del envío (y queda en la bitácora); repetir el POST con datos nuevos también los refleja', async () => {
    const r = await e.app.inject({ method: 'PATCH', url: '/api/v1/entregas/D-1', headers: { authorization: `Bearer ${CLAVE_API_PRUEBA}` }, payload: { monto: '95.50', metodoPago: 'Efectivo' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().cambios.join(' ')).toMatch(/datos del envío/);
    expect((await e.entrega('D-1'))?.datosEnvio).toMatchObject({ monto: '95.50', metodoPago: 'Efectivo', producto: 'Zapatillas talla 40' });
    const otra = await e.api.post<{ repetidas: string[] }>('/api/v1/entregas', { referencia: 'D-3', telefono: '987000303', producto: 'Casaca talla L' });
    expect(otra.body.repetidas).toEqual(['D-3']);
    expect((await e.entrega('D-3'))?.datosEnvio).toEqual({ producto: 'Casaca talla L' });
    const conPin = await e.api.post<{ repetidas: string[] }>('/api/v1/entregas', { referencia: 'D-2', telefono: '987000302', lat: -12.1211, lng: -77.0301, monto: 40 });
    expect(conPin.body.repetidas).toEqual(['D-2']);
    expect((await e.entrega('D-2'))?.datosEnvio).toMatchObject({ monto: '40.00', empresaNombre: 'Moda Gamarra' });
  });

  it('por la lista de GSG (sincronización con el simulador), con espejo si GSG los cambia', async () => {
    e.simulador.cargarDePrueba();
    const s = await e.api.post<{ ok: boolean }>('/admin/entregas/sincronizar');
    expect(s.body.ok).toBe(true);
    expect((await e.entrega('P-1001'))?.datosEnvio).toMatchObject({ producto: 'Zapatillas talla 40', empresaCodigo: '516', tracking: 'GSG-A-102345', monto: '85.00', remitente: 'Juan Quispe' });
    expect((await e.entrega('P-1005'))?.datosEnvio?.remitente).toBeUndefined();
    expect(e.simulador.cambiar('P-1001', { datosEnvio: { producto: 'Zapatillas talla 41' } })).not.toBeNull();
    await e.api.post('/admin/entregas/sincronizar');
    expect((await e.entrega('P-1001'))?.datosEnvio).toMatchObject({ producto: 'Zapatillas talla 41', monto: '85.00' });
  });
});

describe('«Para salir a producción» (Módulo desarrollador → ¿Está listo para GSG?)', () => {
  const base = (o: { https?: boolean; gsg?: 'real' | 'simulador'; soporte?: string; supervisor?: string; prueba?: string[]; agente?: boolean }) =>
    ({
      config: { PUBLIC_BASE_URL: o.https ? 'https://gsgchat.ejemplo.pe' : 'http://localhost:3000', soloNumeros: [] },
      settings: { isConfigured: () => true },
      wa: { conectado: () => true },
      conexionGsg: { estado: () => ({ modo: o.gsg ?? 'simulador', url: o.gsg === 'real' ? 'https://api.gsg.pe/v1' : 'http://localhost:3000/simulador/gsg', aviso: null }) },
      entregas: { ajustes: () => ({ soporte: { whatsapp: o.soporte ?? '', llamadas: '' } }), motorizados: async () => [{ estado: 'activo' }] },
      ajustes: { supervisor: () => o.supervisor ?? '', soloNumeros: () => o.prueba ?? [], modoPruebaFijado: () => false },
      ia: { estado: () => ({ agenteOperativoEfectivo: o.agente ?? true, tieneToken: true, modeloEfectivo: 'gpt-4o-mini' }) },
    }) as never;

  it('en la demo (simulador, localhost, sin soporte ni supervisor) dice qué falta, en palabras', async () => {
    const { revisarProduccion } = await import('../src/desarrollador/listo.js');
    const r = await revisarProduccion(base({ prueba: ['51900000000'] }));
    expect(r.listo).toBe(false);
    const faltan = r.puntos.filter((p) => !p.ok).map((p) => p.clave);
    expect(faltan).toEqual(expect.arrayContaining(['gsg', 'direccion', 'soporte', 'supervisor', 'modoPrueba']));
    // Sin jerga en pantalla: ni nombres de variables ni del .env.
    for (const p of r.puntos) expect(`${p.explicacion} ${p.queHacer ?? ''}`).not.toMatch(/PUBLIC_BASE_URL|SOLO_NUMEROS|\.env/);
  });

  it('con todo puesto: listo', async () => {
    const { revisarProduccion } = await import('../src/desarrollador/listo.js');
    const r = await revisarProduccion(base({ https: true, gsg: 'real', soporte: '51987654321', supervisor: '51912345678' }));
    expect(r.puntos.filter((p) => !p.ok)).toEqual([]);
    expect(r.listo).toBe(true);
    const sinAgente = await revisarProduccion(base({ https: true, gsg: 'real', soporte: '51987654321', supervisor: '51912345678', agente: false }));
    expect(sinAgente.listo).toBe(false);
  });
});

describe('la dirección pública para producción', () => {
  it('avisa con localhost, sin https o vacía; con https de verdad no dice nada', () => {
    expect(avisoDireccionPublica('http://localhost:3000')).toMatch(/solo abre en esta máquina/);
    expect(avisoDireccionPublica('http://192.168.1.20:3000')).toMatch(/solo abre/);
    expect(avisoDireccionPublica('http://gsgchat.ejemplo.pe')).toMatch(/https/);
    expect(avisoDireccionPublica('')).toMatch(/no hay dirección/);
    expect(avisoDireccionPublica('https://gsgchat.ejemplo.pe')).toBeNull();
  });
});
