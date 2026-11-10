/**
 * La plantilla aprobada por Meta para el primer mensaje (pedido del dueño,
 * 10/11): «solicitud_ubicacion_entrega» con 8 datos. Con la conexión
 * principal por QR y una línea de WhatsApp API en uso, el primer mensaje sale
 * con ella; sin plantilla aprobada, todo sigue como antes.
 */

import { describe, expect, it } from 'vitest';
import { ajustesEntregasSchema, juntarVariablesPlantilla, montoParaPlantilla, variablesPlantillaEntrega, VARIABLES_PLANTILLA_ENTREGA } from '../src/entregas/textos.js';
import { crearMotor, OPCIONES_POR_DEFECTO, type OpcionesMotor } from '../src/rutas/motor.js';
import { crearPuertoEnEspera } from '../src/rutas/gsg.js';
import type { SendJob, SendOutcome, Sender } from '../src/outbound/sender.js';
import { approvedTemplate, createFakeRepos, type FakeRepos } from './fakes.js';

const AJUSTES = ajustesEntregasSchema.parse({});
const CTX_ALI = {
  nombre: 'Ali',
  negocio: 'GSG Courier',
  pedido: 'GSG-E-215',
  direccion: 'Av. Lima 123',
  distrito: 'Lince',
  envio: { producto: 'Zapatos', empresaNombre: 'Tienda Uno', tracking: 'GSG-E-215', metodoPago: 'Efectivo', monto: '85' },
} as never;

describe('los 8 datos de la plantilla', () => {
  it('salen como el ejemplo aprobado por Meta', () => {
    expect(VARIABLES_PLANTILLA_ENTREGA).toHaveLength(8);
    expect(variablesPlantillaEntrega(CTX_ALI, AJUSTES)).toEqual([
      'Ali',
      'Zapatos',
      'Tienda Uno',
      'GSG-E-215',
      'Efectivo',
      '85.00',
      'Lince - Av. Lima 123',
      'de 2 de la tarde a 8 de la noche',
    ]);
  });

  it('nunca van vacíos ni con saltos de línea (Meta los rechazaría)', () => {
    const vars = variablesPlantillaEntrega({ nombre: null, negocio: 'GSG', direccion: 'Calle 1\nInterior 2', envio: {} } as never, AJUSTES);
    expect(vars).toHaveLength(8);
    for (const v of vars) {
      expect(v.trim()).not.toBe('');
      expect(v).not.toMatch(/[\n\r\t]| {4,}/);
    }
  });

  it('el monto va sin «S/» y con dos decimales', () => {
    expect(montoParaPlantilla('S/ 85')).toBe('85.00');
    expect(montoParaPlantilla('s/.40,5')).toBe('40.50');
    expect(montoParaPlantilla('0')).toBe('0.00');
    expect(montoParaPlantilla('')).toBe('');
  });

  it('varios pedidos en una plantilla: cada dato distinto unido con « / »', () => {
    const a = variablesPlantillaEntrega(CTX_ALI, AJUSTES);
    const b = [...a];
    b[1] = 'Polo';
    b[3] = 'GSG-E-216';
    b[5] = '40.00';
    const juntas = juntarVariablesPlantilla([a, b]);
    expect(juntas[0]).toBe('Ali');
    expect(juntas[1]).toBe('Zapatos / Polo');
    expect(juntas[2]).toBe('Tienda Uno');
    expect(juntas[3]).toBe('GSG-E-215 / GSG-E-216');
    expect(juntas[5]).toBe('85.00 / 40.00');
  });

  it('el ajuste viene encendido con el nombre de la plantilla de GSG', () => {
    expect(AJUSTES.plantillaMeta).toEqual({ usar: true, nombre: 'solicitud_ubicacion_entrega' });
    expect(ajustesEntregasSchema.safeParse({ plantillaMeta: { nombre: 'Con Espacios' } }).success).toBe(false);
  });
});

describe('el primer mensaje con la principal por QR y una línea de WhatsApp API', () => {
  const HORA_BUENA = new Date('2026-03-10T15:00:00Z'); // martes 10:00 en Lima
  const opciones: OpcionesMotor = { ...OPCIONES_POR_DEFECTO, timezone: 'America/Lima' };
  const VARS = variablesPlantillaEntrega(CTX_ALI, AJUSTES);

  function senderFalso() {
    const enviados: SendJob[] = [];
    const sender: Sender = {
      async send(job) {
        enviados.push(job);
        return { ok: true, wamid: `wamid.${enviados.length}`, deliveryId: enviados.length } as SendOutcome;
      },
    };
    return { sender, enviados };
  }

  async function loteListo(repos: FakeRepos) {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto de prueba' });
    await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '51987654321', phone: '51987654321', nombre: 'Ali', referencia: 'GSG-E-215' }]);
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
  }

  it('con la plantilla aprobada sale ESA plantilla con sus 8 datos (antes salía texto libre y Meta lo frenaba)', async () => {
    const repos = createFakeRepos();
    await loteListo(repos);
    await repos.templates.upsert(approvedTemplate({ name: 'solicitud_ubicacion_entrega', language: 'es_PE', category: 'UTILITY', variables: 8, quality: 'GREEN' }));
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({
      repos, sender, gsg: crearPuertoEnEspera(), opciones, ahora: () => HORA_BUENA, azar: () => 0,
      usarPlantilla: () => false, // la principal es la de QR
      plantillaMeta: async () => true, // pero hay una línea de API en uso y la plantilla está aprobada
      plantillaSolicitud: async () => ({ name: 'solicitud_ubicacion_entrega', language: 'es_PE', variables: VARS }),
    });
    const salida = await motor.tick();
    expect(salida.accion).toBe('envio');
    expect(enviados[0]).toMatchObject({ kind: 'template', templateName: 'solicitud_ubicacion_entrega', templateLanguage: 'es_PE', variables: VARS });
  });

  it('si el cliente escribió en las últimas 24 h, sale el texto de siempre (no gasta plantilla)', async () => {
    const repos = createFakeRepos();
    await loteListo(repos);
    await repos.contacts.upsertFromInbound('51987654321', 'Ali');
    await repos.contacts.touchInbound('51987654321', new Date(HORA_BUENA.getTime() - 60 * 60 * 1000));
    const { sender, enviados } = senderFalso();
    let preguntado = false;
    const motor = crearMotor({
      repos, sender, gsg: crearPuertoEnEspera(), opciones, ahora: () => HORA_BUENA, azar: () => 0,
      usarPlantilla: () => false,
      plantillaMeta: async () => { preguntado = true; return true; },
      plantillaSolicitud: async () => ({ name: 'solicitud_ubicacion_entrega', variables: VARS }),
    });
    await motor.tick();
    expect(enviados[0]?.kind).toBe('interactive');
    expect(preguntado).toBe(false);
  });

  it('el recordatorio sin plantilla propia aprobada en Meta sale con la plantilla del pedido (antes pedía una que Meta no tenía: #132001)', async () => {
    const repos = createFakeRepos();
    await loteListo(repos);
    // Lo que deja la sincronización: la del pedido aprobada; las del catálogo, desactivadas (no están en Meta).
    await repos.templates.upsert(approvedTemplate({ name: 'solicitud_ubicacion_entrega', language: 'es_PE', category: 'UTILITY', variables: 8, quality: 'GREEN' }));
    await repos.templates.upsert({ ...approvedTemplate({ name: 'recordatorio_ubicacion', language: 'es', category: 'UTILITY', variables: 2, quality: 'GREEN' }), status: 'DISABLED' });
    const { sender, enviados } = senderFalso();
    let ahora = HORA_BUENA;
    const motor = crearMotor({
      repos, sender, gsg: crearPuertoEnEspera(), opciones, ahora: () => ahora, azar: () => 0,
      usarPlantilla: () => false,
      plantillaMeta: async () => true,
      plantillaSolicitud: async () => ({ name: 'solicitud_ubicacion_entrega', language: 'es_PE', variables: VARS }),
    });
    await motor.tick();
    ahora = new Date(HORA_BUENA.getTime() + 3 * 60 * 60 * 1000);
    await motor.tick();
    expect(enviados.map((e) => e.templateName)).toEqual(['solicitud_ubicacion_entrega', 'solicitud_ubicacion_entrega']);
  });

  it('un rechazo de PLANTILLA de Meta (#132001) no gasta un intento: al cliente no le llegó nada', async () => {
    const repos = createFakeRepos();
    await loteListo(repos);
    const sender: Sender = { async send() { return { ok: false, error: '(#132001) Template name does not exist in the translation', retryable: false, deliveryId: 1 } as SendOutcome; } };
    const motor = crearMotor({
      repos, sender, gsg: crearPuertoEnEspera(), opciones, ahora: () => HORA_BUENA, azar: () => 0,
      usarPlantilla: () => true,
      plantillaSolicitud: async () => ({ name: 'solicitud_ubicacion_entrega', language: 'es_PE', variables: VARS }),
    });
    await motor.tick();
    const [s] = await repos.rutas.listarSolicitudes({ limit: 10, offset: 0 });
    expect(s).toMatchObject({ intentos: 0, incidencia: 'envio_bloqueado' });
    expect(s!.incidenciaDetalle).toContain('no le llegó al cliente');
  });

  it('sin plantilla aprobada (o apagada) todo sigue como antes: texto con botón', async () => {
    const repos = createFakeRepos();
    await loteListo(repos);
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({
      repos, sender, gsg: crearPuertoEnEspera(), opciones, ahora: () => HORA_BUENA, azar: () => 0,
      usarPlantilla: () => false,
      plantillaMeta: async () => false,
    });
    await motor.tick();
    expect(enviados[0]).toMatchObject({ kind: 'interactive', interactive: { locationRequest: true } });
  });
});
