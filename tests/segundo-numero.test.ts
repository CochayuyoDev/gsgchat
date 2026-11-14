/**
 * Segundo número (pedido del dueño, 12/11): «si un número no es accesible se le
 * escribe al 2do número y si ninguno es accesible te lo mando como error de
 * número inaccesible».
 *
 *   - Al recibir: el principal no es válido y el telefono2 sí → se usa el telefono2.
 *     Ninguno válido → el pedido se descarta con `numero_inaccesible`.
 *   - Al escribir: el principal no tiene WhatsApp → el pedido pasa al telefono2 y
 *     se le escribe ahí (sin incidencia ni reporte del primero). Si el segundo
 *     tampoco → `numero_inaccesible` para GSG.
 *   - WhatsApp rechaza después (131026): lo mismo.
 *   - Sin telefono2, todo como siempre (`sin_whatsapp`).
 */
import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import { mensajeNoLlego } from '../src/rutas/no-llego.js';

const PRINCIPAL = '987600111';
const SEGUNDO = '987600222';
const pedido = (extra: Record<string, unknown> = {}) => ({ ...OBLIGATORIOS_GSG, tracking: 'DOS-1', cliente: 'Juan Pérez', telefono: PRINCIPAL, telefono2: SEGUNDO, ...extra });

/** Esos números no tienen WhatsApp (los demás sí). */
function sinWhatsApp(e: EscenarioEntregas, ...telefonos: string[]) {
  const sin = new Set(telefonos.map((t) => `51${t}`));
  e.wa.tieneWhatsApp = async (phone: string) => !sin.has(phone);
}

const pedidoGuardado = async (e: EscenarioEntregas) => (await e.repos.entregas.porTracking('DOS-1'))!;
const notas = async (e: EscenarioEntregas) => (await e.repos.entregas.eventos((await pedidoGuardado(e)).id)).map((x) => x.detalle ?? '');
const problemasAGsg = (e: EscenarioEntregas) => e.repos.rutas._reportes.filter((r) => r.tipo === 'incidencia').map((r) => String(r.payload.codigo));

describe('al recibir el pedido', () => {
  it('el principal no es válido y el segundo sí: se guarda con el segundo y se le escribe ahí', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const r = await e.api.post<{ creadas: Array<{ telefono: string }> }>('/api/v1/entregas', pedido({ telefono: '12345' }));
      expect(r.status).toBe(201);
      expect(r.body.creadas[0]!.telefono).toBe(SEGUNDO);
      expect((await notas(e)).some((n) => /El número principal 12345 no es válido .*: se le escribe al segundo número 987600222/.test(n))).toBe(true);
      await e.trabajar();
      expect(e.mensajesA(SEGUNDO).length).toBeGreaterThan(0);
    } finally {
      await e.cerrar();
    }
  });

  it('ninguno es válido: se descarta como «número inaccesible» y GSG lo ve en reportados', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const r = await e.api.post<{ codigo?: string; detalles?: Array<{ error?: string; mensaje: string }> }>('/api/v1/entregas', pedido({ telefono: '12345', telefono2: '6789' }));
      expect(r.status).toBe(400);
      expect(r.body.detalles![0]).toMatchObject({ error: 'numero_inaccesible' });
      expect(r.body.detalles![0]!.mensaje).toMatch(/Número inaccesible: ni el número principal \(12345.*\) ni el segundo número \(6789/);
      const reportados = await e.api.get<{ items: Array<{ error: string }> }>('/api/v1/reportados');
      expect(reportados.body.items.map((x) => x.error)).toContain('numero_inaccesible');
    } finally {
      await e.cerrar();
    }
  });
});

describe('al escribirle', () => {
  it('el principal no tiene WhatsApp: pasa al segundo, le escribe ahí y no reporta el primero', async () => {
    const e = await crearEscenarioEntregas();
    try {
      sinWhatsApp(e, PRINCIPAL);
      await e.api.post('/api/v1/entregas', pedido());
      await e.trabajar();
      await e.trabajar();
      expect(e.mensajesA(PRINCIPAL)).toHaveLength(0);
      expect(e.mensajesA(SEGUNDO).length).toBeGreaterThan(0);
      const p = await pedidoGuardado(e);
      expect(p.phone).toBe(`51${SEGUNDO}`);
      expect((await notas(e)).some((n) => /El número principal 51987600111 no es accesible .*: se le escribe al segundo número 51987600222/.test(n))).toBe(true);
      expect(problemasAGsg(e)).not.toContain('sin_whatsapp');
      expect(problemasAGsg(e)).not.toContain('numero_invalido');
    } finally {
      await e.cerrar();
    }
  });

  it('ninguno tiene WhatsApp: a GSG le llega «número inaccesible»', async () => {
    const e = await crearEscenarioEntregas();
    try {
      sinWhatsApp(e, PRINCIPAL, SEGUNDO);
      await e.api.post('/api/v1/entregas', pedido());
      await e.trabajar();
      await e.trabajar();
      expect(e.mensajesA(PRINCIPAL)).toHaveLength(0);
      expect(e.mensajesA(SEGUNDO)).toHaveLength(0);
      const p = await pedidoGuardado(e);
      expect(p).toMatchObject({ mensajeEstado: 'fallido', mensajeErrorCodigo: 'numero_inaccesible' });
      expect(p.mensajeError).toMatch(/ni el número principal \(51987600111.*\) ni el segundo número \(51987600222/);
      expect(problemasAGsg(e)).toContain('numero_inaccesible');
      const reportados = await e.api.get<{ items: Array<{ error: string }> }>('/api/v1/reportados');
      expect(reportados.body.items.map((x) => x.error)).toContain('numero_inaccesible');
    } finally {
      await e.cerrar();
    }
  });

  it('sin segundo número, como siempre: «sin WhatsApp»', async () => {
    const e = await crearEscenarioEntregas();
    try {
      sinWhatsApp(e, PRINCIPAL);
      await e.api.post('/api/v1/entregas', pedido({ telefono2: undefined }));
      await e.trabajar();
      const p = await pedidoGuardado(e);
      expect(p.phone).toBe(`51${PRINCIPAL}`);
      expect(p.mensajeErrorCodigo).toBe('sin_whatsapp');
      expect(problemasAGsg(e)).toContain('sin_whatsapp');
      expect(problemasAGsg(e)).not.toContain('numero_inaccesible');
    } finally {
      await e.cerrar();
    }
  });
});

describe('WhatsApp rechaza después (131026: no tiene WhatsApp)', () => {
  it('el pedido pasa al segundo número y se le escribe ahí', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido());
      await e.trabajar();
      const salio = e.repos.messages._all.find((m) => m.direction === 'out' && m.wamid);
      expect(salio).toBeTruthy();
      const r = await mensajeNoLlego(
        { repos: e.repos, ahora: e.ahora, esperasMs: [], segundoNumero: (phone, codigo, motivo) => e.entregas.segundoNumeroTrasRechazo(phone, codigo, motivo) },
        salio!.wamid!,
        { codigo: '131026', tipo: 'meta', titulo: 'Message undeliverable', motivo: 'El número no tiene WhatsApp.', queHacer: 'Corregir el número.', reintentar: 'no' },
      );
      expect(r).toBe('segundo_numero');
      expect((await pedidoGuardado(e)).phone).toBe(`51${SEGUNDO}`);
      e.avanzar(1);
      await e.trabajar();
      expect(e.mensajesA(SEGUNDO).length).toBeGreaterThan(0);
      expect(problemasAGsg(e)).not.toContain('sin_whatsapp');
    } finally {
      await e.cerrar();
    }
  });
});
