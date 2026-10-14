import { WhatsAppApiError } from '../src/whatsapp/client.js';
import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA } from './escenario-entregas.js';
import { solicitudDePedidos, PLANTILLA_PEDIDOS_GSG } from '../src/entregas/solicitud-varios.js';
import { approvedTemplate } from './fakes.js';
import { CATALOG } from '../src/templates/catalog.js';
import { lintTemplate } from '../src/templates/lint.js';

const pedido = (tracking: string, montoCobrar: number, telefono = '987600551') => ({ tracking, cliente: 'Ana Pérez', telefono, empresa: { codigo: 'T01', nombre: 'Tienda Lima' }, metodoPago: montoCobrar ? 'Contraentrega' : 'Pagado', montoCobrar, producto: `Producto ${tracking}`, nroPedido: `N-${tracking}`, direccion: 'Av. Larco 123', distrito: 'Miraflores' });

describe('primer mensaje con varios pedidos GSG', () => {
  it('incluye S/ 0 y S/ 200 en una burbuja y reporta el pin para ambos trackings', async () => {
    const e = await crearEscenarioEntregas();
    try {
      expect((await e.api.post('/api/v1/entregas', [pedido('DOBLE-0', 0), pedido('DOBLE-200', 200)])).status).toBe(201);
      await e.trabajar();
      const textos = e.textosA('987600551');
      expect(textos).toHaveLength(1);
      expect(textos[0]).toContain('Tenemos 2 pedidos');
      for (const contenido of ['DOBLE-0', 'DOBLE-200', 'S/ 0.00', 'S/ 200.00', 'Contraentrega', 'Pagado', 'Tienda Lima', 'Av. Larco 123']) expect(textos[0]).toContain(contenido);
      expect(textos[0]!.match(/compartir su ubicación/g)).toHaveLength(1);
      const meta = await e.entregas.plantillaSolicitudUbicacion({ phone: '51987600551', loteId: (await e.entrega('DOBLE-0'))!.loteId });
      expect(meta?.name).toBe(PLANTILLA_PEDIDOS_GSG);
      expect(meta?.variables[2]).toContain('S/ 200.00');
      await e.contesta('987600551', { pin: PIN_LIMA });
      for (const tracking of ['DOBLE-0', 'DOBLE-200']) expect((await e.entrega(tracking))!.ubicacionEstado).toBe('recibida');
      expect((await e.repos.rutas.reportesRecientes(100, 'ubicacion')).map((r) => r.payload.tracking)).toEqual(expect.arrayContaining(['DOBLE-0', 'DOBLE-200']));
      const antes = e.mensajesA('987600551').length;
      await e.api.post('/api/v1/entregas', [pedido('DOBLE-0', 0), pedido('DOBLE-200', 200)]);
      await e.trabajar();
      expect(e.mensajesA('987600551')).toHaveLength(antes);
    } finally { await e.cerrar(); }
  });

  it('agrupa solicitudes separadas antes de enviar; un pedido posterior tiene un aviso propio', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido('SEP-1', 0));
      await e.api.post('/api/v1/entregas', pedido('SEP-2', 200));
      await e.trabajar();
      expect(e.textosA('987600551')).toHaveLength(1);
      expect(e.textosA('987600551')[0]).toContain('SEP-2');
      e.avanzar(2);
      await e.api.post('/api/v1/entregas', pedido('SEP-3', 50));
      await e.trabajar();
      const textos = e.textosA('987600551');
      expect(textos).toHaveLength(2);
      expect(textos[1]).toContain('SEP-3');
      expect(textos[1]).toContain('S/ 50.00');
      expect(textos[1]).not.toContain('SEP-1');
      expect((await e.entrega('SEP-3'))!.mensajeEstado).toBe('enviado');
    } finally { await e.cerrar(); }
  });

  it('por Meta envía la plantilla agrupada aprobada con todos los datos', async () => {
    const e = await crearEscenarioEntregas({ usarPlantilla: true });
    try {
      const catalogo = await e.api.get('/admin/templates/catalog');
      expect(JSON.stringify(catalogo.body)).toContain(PLANTILLA_PEDIDOS_GSG);
      await e.repos.templates.upsert(approvedTemplate({ name: PLANTILLA_PEDIDOS_GSG, language: 'es', category: 'UTILITY', variables: 3, body: CATALOG.find((t) => t.name === PLANTILLA_PEDIDOS_GSG)!.body }));
      await e.api.post('/api/v1/entregas', [pedido('META-0', 0), pedido('META-200', 200)]);
      await e.trabajar();
      const mensajes = e.mensajesA('987600551');
      expect(mensajes).toHaveLength(1);
      expect(mensajes[0]).toMatchObject({ kind: 'template', name: PLANTILLA_PEDIDOS_GSG });
      expect(JSON.stringify(mensajes[0])).toContain('META-0');
      expect(JSON.stringify(mensajes[0])).toContain('META-200');
      expect(JSON.stringify(mensajes[0])).toContain('S/ 200.00');
    } finally { await e.cerrar(); }
  });

  it('sin plantilla aprobada no manda un resumen incompleto y deja ambos errores visibles', async () => {
    const e = await crearEscenarioEntregas({ usarPlantilla: true });
    try {
      await e.api.post('/api/v1/entregas', [pedido('SIN-META-0', 0), pedido('SIN-META-200', 200)]);
      await e.trabajar();
      expect(e.mensajesA('987600551')).toHaveLength(0);
      const bandeja = await e.entregas.bandejaMensajes();
      expect(bandeja.map((x) => x.referencia)).toEqual(expect.arrayContaining(['SIN-META-0', 'SIN-META-200']));
    } finally { await e.cerrar(); }
  });

  it('un fallo temporal reintenta una sola burbuja completa para ambos pedidos', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', [pedido('RETRY-0', 0), pedido('RETRY-200', 200)]);
      e.wa.failNext = new WhatsAppApiError('Service temporarily unavailable', 503, 131000, undefined, true);
      await e.trabajar();
      expect(e.textosA('987600551')).toHaveLength(0);
      for (const tracking of ['RETRY-0', 'RETRY-200']) expect((await e.entrega(tracking))!.mensajeEstado).toBe('reintentando');
      e.avanzar(2);
      await e.trabajar();
      expect(e.textosA('987600551')).toHaveLength(1);
      expect(e.textosA('987600551')[0]).toContain('RETRY-200');
      for (const tracking of ['RETRY-0', 'RETRY-200']) expect((await e.entrega(tracking))!.mensajeEstado).toBe('enviado');
    } finally { await e.cerrar(); }
  });

  it('un aviso posterior fallido se reintenta sin reenviar los pedidos originales', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido('ANTES', 0));
      await e.trabajar();
      e.avanzar(2);
      e.wa.failNext = new WhatsAppApiError('Service temporarily unavailable', 503, 131000, undefined, true);
      await e.api.post('/api/v1/entregas', pedido('DESPUES', 200));
      expect((await e.entrega('DESPUES'))!.mensajeEstado).toBe('reintentando');
      e.avanzar(2);
      await e.trabajar();
      expect(e.textosA('987600551')).toHaveLength(2);
      expect(e.textosA('987600551')[1]).toContain('DESPUES');
      expect(e.textosA('987600551')[1]).not.toContain('ANTES');
    } finally { await e.cerrar(); }
  });

  it('no mezcla los datos de otro teléfono en el mensaje agrupado', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', [pedido('MISMO-1', 0), pedido('MISMO-2', 200), pedido('MISMO-3', 50), pedido('OTRO', 999, '987600552')]);
      await e.trabajar();
      expect(e.textosA('987600551')).toHaveLength(1);
      expect(e.textosA('987600551')[0]).toContain('Tenemos 3 pedidos');
      expect(e.textosA('987600551')[0]).not.toContain('OTRO');
      expect(e.textosA('987600552')[0]).toContain('OTRO');
      expect(e.textosA('987600552')[0]).not.toContain('MISMO-1');
    } finally { await e.cerrar(); }
  });

  it('un tracking recibido durante el envío no se marca como incluido en ese mensaje', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', [pedido('EN-CURSO-1', 0), pedido('EN-CURSO-2', 200)]);
      const enviar = e.wa.sendLocationRequest;
      e.wa.sendLocationRequest = async (phone, texto) => {
        e.wa.sendLocationRequest = enviar;
        await e.api.post('/api/v1/entregas', pedido('RECIBIDO-DURANTE', 50));
        return enviar(phone, texto);
      };
      await e.trabajar();
      expect(e.textosA('987600551')[0]).not.toContain('RECIBIDO-DURANTE');
      e.avanzar(2);
      await e.trabajar();
      expect(e.textosA('987600551')).toHaveLength(2);
      expect(e.textosA('987600551')[1]).toContain('RECIBIDO-DURANTE');
      expect((await e.entrega('RECIBIDO-DURANTE'))!.mensajeEstado).toBe('enviado');
    } finally { await e.cerrar(); }
  });

  it('si el detalle supera el límite de Meta no trunca ni omite pedidos: muestra el error', async () => {
    const e = await crearEscenarioEntregas({ usarPlantilla: true });
    try {
      await e.repos.templates.upsert(approvedTemplate({ name: PLANTILLA_PEDIDOS_GSG, language: 'es', category: 'UTILITY', variables: 3, body: CATALOG.find((t) => t.name === PLANTILLA_PEDIDOS_GSG)!.body }));
      const alta = await e.api.post('/api/v1/entregas', Array.from({ length: 6 }, (_, i) => ({ ...pedido(`LARGO-${i}`, i * 50), producto: 'Producto con detalle '.repeat(6) })));
      expect(alta.status).toBe(201);
      await e.trabajar();
      expect(e.mensajesA('987600551')).toHaveLength(0);
      expect(await e.entregas.bandejaMensajes()).toHaveLength(6);
    } finally { await e.cerrar(); }
  });

  it('tres pedidos conservan sus importes y cero no se convierte en «pagado»', () => {
    const mensaje = solicitudDePedidos([0, 200, 25].map((monto, i) => ({ negocio: 'GSG', nombre: 'Ana', pedido: `T-${i}`, envio: { tracking: `T-${i}`, monto: String(monto), metodoPago: 'Contraentrega' } })));
    expect(mensaje.texto).toContain('Tenemos 3 pedidos');
    expect(mensaje.texto).toContain('S/ 0.00');
    expect(mensaje.texto).toContain('S/ 200.00');
    expect(mensaje.texto).toContain('S/ 25.00');
    expect(mensaje.texto).not.toContain('pagado');
    expect(mensaje.variables[2]).not.toContain('\n');
  });

  it('la nueva plantilla oficial pasa la validación local de Meta', () => {
    const plantilla = CATALOG.find((t) => t.name === PLANTILLA_PEDIDOS_GSG)!;
    expect(plantilla).toBeDefined();
    expect(lintTemplate(plantilla).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
