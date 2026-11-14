/**
 * `firstMessage`: GSG puede mandar ya redactado el PRIMER mensaje que se le
 * escribe al cliente. Si viene, sale tal cual (con su boton de siempre); si
 * no, va el texto editable de GSGchat. Los recordatorios y el resto del flujo
 * no cambian.
 */

import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA } from './escenario-entregas.js';
import { datosEnvioDeCrudo } from '../src/entregas/datos-envio.js';
import { MAX_FIRST_MESSAGE } from '../src/entregas/repo.js';
import { CAMPOS_PEDIDO } from '../src/rutas/gsg-extras.js';

const pedido = (tracking: string, telefono: string, extra: Record<string, unknown> = {}) => ({
  tracking,
  cliente: 'Ana Pérez',
  telefono,
  empresa: { codigo: 'T01', nombre: 'Tienda Lima' },
  metodoPago: 'Contraentrega',
  montoCobrar: 50,
  producto: `Producto ${tracking}`,
  direccion: 'Av. Larco 123',
  distrito: 'Miraflores',
  ...extra,
});

const PRIMERO = 'Hola Ana 👋, te escribe GSG Courier.\nHoy llega tu pedido FM-1 de Tienda Lima.\n¿Nos compartes tu ubicación?';

describe('firstMessage: leerlo y guardarlo', () => {
  it('se lee del pedido crudo sin recortarlo a 200 y conserva los saltos de línea', () => {
    const largo = `${'a'.repeat(600)}\n${'b'.repeat(300)}`;
    expect(datosEnvioDeCrudo({ firstMessage: `  ${largo}  ` })).toEqual({ firstMessage: largo });
    expect(datosEnvioDeCrudo({ firstMessage: '   ' })).toBeNull();
    expect(datosEnvioDeCrudo({ firstMessage: null })).toBeNull();
  });

  it('el verificador del contrato no lo marca como campo sobrante', () => {
    expect(CAMPOS_PEDIDO.has('firstMessage')).toBe(true);
  });

  it('la API lo guarda, lo devuelve al consultar y rechaza uno que no cabe en WhatsApp', async () => {
    const e = await crearEscenarioEntregas();
    try {
      expect((await e.api.post('/api/v1/entregas', pedido('FM-G1', '987600701', { firstMessage: PRIMERO }))).status).toBe(201);
      expect((await e.entrega('FM-G1'))?.datosEnvio?.firstMessage).toBe(PRIMERO);
      const uno = await e.api.get<{ entrega: Record<string, unknown> }>('/api/v1/entregas/FM-G1');
      expect(uno.body.entrega.firstMessage).toBe(PRIMERO);

      const r = await e.api.post<{ error: { mensaje?: string } } & Record<string, unknown>>('/api/v1/entregas', pedido('FM-G2', '987600702', { firstMessage: 'x'.repeat(MAX_FIRST_MESSAGE + 1) }));
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toContain('firstMessage');
      expect(await e.entrega('FM-G2')).toBeUndefined();
    } finally { await e.cerrar(); }
  });
});

describe('firstMessage: el primer mensaje al cliente', () => {
  it('pedir la ubicación: sale el texto de GSG tal cual; el recordatorio es el de siempre', async () => {
    const e = await crearEscenarioEntregas();
    try {
      expect((await e.api.post('/api/v1/entregas', pedido('FM-1', '987600711', { firstMessage: PRIMERO }))).status).toBe(201);
      await e.trabajar();
      const textos = e.textosA('987600711');
      expect(textos).toHaveLength(1);
      expect(textos[0]).toBe(PRIMERO);
      // El mismo mensaje con boton de ubicacion: solo cambia el texto.
      expect((await e.entrega('FM-1'))!.mensajeEstado).toBe('enviado');

      // Sin respuesta: el recordatorio NO repite el texto de GSG.
      for (let i = 0; i < 12 && e.textosA('987600711').length < 2; i++) {
        e.avanzar(30);
        await e.trabajar();
      }
      const despues = e.textosA('987600711');
      expect(despues.length).toBeGreaterThanOrEqual(2);
      expect(despues[1]).not.toBe(PRIMERO);

      // El resto del flujo sigue igual: el pin cierra el pedido.
      await e.contesta('987600711', { pin: PIN_LIMA });
      expect((await e.entrega('FM-1'))!.ubicacionEstado).toBe('recibida');
    } finally { await e.cerrar(); }
  });

  it('si el pedido cambió de lote mientras esperaba en la cola, igual sale su firstMessage', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido('FM-L', '987600716', { firstMessage: 'Mensaje de GSG para FM-L' }));
      const entrega = (await e.entrega('FM-L'))!;
      // Como cuando el motor de entregas lo vuelve a encolar en otro lote antes de que salga.
      await e.repos.entregas!.actualizar(entrega.id, { loteId: '00000000-0000-0000-0000-000000000000' });
      await e.trabajar();
      expect(e.textosA('987600716')[0]).toBe('Mensaje de GSG para FM-L');
    } finally { await e.cerrar(); }
  });

  it('sin firstMessage sale el texto editable de GSGchat, como siempre', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido('FM-2', '987600712'));
      await e.trabajar();
      const textos = e.textosA('987600712');
      expect(textos).toHaveLength(1);
      expect(textos[0]).toContain('FM-2');
      expect(textos[0]).toContain('Tienda Lima');
      expect(textos[0]).not.toBe(PRIMERO);
    } finally { await e.cerrar(); }
  });

  it('varios pedidos del mismo cliente: si todos lo traen se juntan; si a uno le falta, va el texto agrupado de siempre', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', [
        pedido('FM-A', '987600713', { firstMessage: 'Mensaje de GSG para FM-A' }),
        pedido('FM-B', '987600713', { firstMessage: 'Mensaje de GSG para FM-B' }),
      ]);
      await e.trabajar();
      expect(e.textosA('987600713')).toEqual(['Mensaje de GSG para FM-A\n\nMensaje de GSG para FM-B']);

      await e.api.post('/api/v1/entregas', [
        pedido('FM-C', '987600714', { firstMessage: 'Mensaje de GSG para FM-C' }),
        pedido('FM-D', '987600714'),
      ]);
      await e.trabajar();
      const mixtos = e.textosA('987600714');
      expect(mixtos).toHaveLength(1);
      expect(mixtos[0]).toContain('Tenemos 2 pedidos');
      expect(mixtos[0]).toContain('FM-C');
      expect(mixtos[0]).toContain('FM-D');
    } finally { await e.cerrar(); }
  });

  it('pedir confirmar (GSG ya tiene la dirección): la primera pregunta usa el texto de GSG y conserva sus botones', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const texto = 'GSG Courier: hoy entregamos tu pedido FM-3. ¿Lo podrás recibir?';
      expect((await e.api.post('/api/v1/entregas', pedido('FM-3', '987600715', { lat: -12.1211, lng: -77.0301, faltaConfirmar: true, firstMessage: texto }))).status).toBe(201);
      await e.trabajar();
      const primeros = e.mensajesA('987600715');
      expect(primeros.length).toBeGreaterThanOrEqual(1);
      expect(String(primeros[0]!.body)).toBe(texto);
      // Solo el PRIMER mensaje lleva el texto de GSG: el siguiente (ubicacion o SÍ/NO) va con el de siempre.
      expect(e.textosA('987600715').filter((t) => t === texto)).toHaveLength(1);
      // Sus botones SÍ/NO de siempre, si la instalación los usa.
      const conBotones = e.botonesA('987600715');
      if (conBotones.length) expect(conBotones[0]!.buttons.length).toBeGreaterThan(0);
    } finally { await e.cerrar(); }
  });
});
