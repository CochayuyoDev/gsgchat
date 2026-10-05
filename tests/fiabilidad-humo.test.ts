/**
 * Las pruebas de humo de cada mañana: con GSG caído la pasada marca ✗ en
 * GSG y avisa; con todo bien no avisa a nadie; "Probar ahora" responde con
 * los pasos sin avisar; el ticker la hace una vez por día a la hora dicha.
 */

import { describe, expect, it } from 'vitest';
import type { DeliveryListItem } from '../src/db/repos.js';
import type { SendJob, SendOutcome } from '../src/outbound/sender.js';
import { crearHumo, explicarBloqueo } from '../src/salud/humo.js';
import { cupoPrevisto } from '../src/salud/cupo-previsto.js';
import { createMemorySettingsRepo } from './fakes.js';

function montar(opciones: { supervisor?: string; gsgOk?: boolean; gsgModo?: string; entrega?: 'delivered' | 'sent' | 'failed'; bloqueo?: string; iaToken?: boolean; hora?: string; activo?: boolean } = {}) {
  const settingsRepo = createMemorySettingsRepo();
  let ahora = new Date('2026-09-21T11:30:00Z'); // 06:30 Lima
  const enviados: SendJob[] = [];
  const avisos: string[] = [];
  const entregas: DeliveryListItem[] = [];
  const sender = {
    async send(job: SendJob): Promise<SendOutcome> {
      enviados.push(job);
      if (opciones.bloqueo) return { ok: false, blocked: true, code: opciones.bloqueo as never, reason: 'bloqueado', deliveryId: 1 };
      const wamid = `wamid.${enviados.length}`;
      entregas.unshift({ id: enviados.length, campaignId: null, campaignName: null, contactId: 'c1', phone: job.phone, name: null, wamid, kind: 'text', templateName: null, category: 'UTILITY', status: opciones.entrega ?? 'delivered', errorCode: null, errorTitle: opciones.entrega === 'failed' ? 'Número no válido' : null, queuedAt: ahora } as DeliveryListItem);
      return { ok: true, wamid, deliveryId: enviados.length };
    },
  };
  const ajustes = { activo: opciones.activo ?? true, hora: opciones.hora ?? '07:00' };
  const humo = crearHumo({
    sender,
    supervisor: () => opciones.supervisor ?? '51912426667',
    deliveries: { listRecent: async ({ phone }) => entregas.filter((e) => !phone || e.phone === phone) },
    conexionGsg: { estado: () => ({ modo: opciones.gsgModo ?? 'real' }), probar: async () => (opciones.gsgOk === false ? { ok: false, detalle: 'No se pudo consultar a GSG: sin respuesta.' } : { ok: true, detalle: 'GSG contestó: 3 por pedir ubicación.' }) },
    ia: opciones.iaToken ? { estado: () => ({ tieneToken: true }), probarConexion: async () => ({ ok: true, detalle: 'hola', ms: 900 }) } : null,
    entregas: { resumen: async () => ({ cifras: { total: 12 } }) },
    carpetas: () => [process.cwd()],
    minimoLibreMB: 1,
    esperaEntregaMs: 0,
    ajustes: () => ajustes,
    settingsRepo,
    ahora: () => ahora,
    log: () => undefined,
    timezone: 'America/Lima',
    whatsappCaido: () => false,
    avisar: async (texto) => {
      avisos.push(texto);
      return { ok: true, por: 'whatsapp', detalle: 'ok' };
    },
    dormir: async () => undefined,
  });
  return { humo, enviados, avisos, ajustes, settingsRepo, avanzar: (min: number) => (ahora = new Date(ahora.getTime() + min * 60_000)) };
}

describe('las pruebas de humo', () => {
  it('con todo bien: cinco pasos, WhatsApp llegó, GSG contestó, IA apagada se omite, y no se avisa a nadie', async () => {
    const m = montar();
    const r = await m.humo.correr({ quien: 'cada mañana', avisar: true });
    expect(r.ok).toBe(true);
    expect(r.pasos.map((p) => p.clave)).toEqual(['whatsapp', 'gsg', 'ia', 'entregas', 'disco']);
    expect(r.pasos[0]).toMatchObject({ ok: true });
    expect(r.pasos[0]!.detalle).toContain('llegó al teléfono del supervisor');
    expect(m.enviados[0]).toMatchObject({ phone: '51912426667', manual: true, origen: 'sistema' });
    expect(r.pasos[1]!.detalle).toContain('GSG contestó');
    expect(r.pasos[2]).toMatchObject({ ok: true, omitido: true });
    expect(r.pasos[3]!.detalle).toContain('12 pedidos de hoy');
    expect(r.pasos[4]!.ok).toBe(true);
    expect(m.avisos).toHaveLength(0);
    expect(m.humo.estado().ultima?.ok).toBe(true);
    const guardado = (await m.settingsRepo.getAll()).find((x) => x.key === 'fiabilidad.humo.historial');
    expect(guardado).toBeTruthy();
  });

  it('con GSG caído marca ✗ en GSG y manda UN aviso al supervisor con el porqué', async () => {
    const m = montar({ gsgOk: false });
    const r = await m.humo.correr({ quien: 'cada mañana', avisar: true });
    expect(r.ok).toBe(false);
    expect(r.pasos.find((p) => p.clave === 'gsg')).toMatchObject({ ok: false });
    expect(m.avisos).toHaveLength(1);
    expect(m.avisos[0]).toContain('falló GSG');
    expect(m.avisos[0]).toContain('Que todo funcione');
    expect(r.aviso?.ok).toBe(true);
  });

  it('"Probar ahora" no avisa a nadie aunque algo falle, y queda en el historial con quién lo pidió', async () => {
    const m = montar({ gsgModo: 'ninguna' });
    const r = await m.humo.correr({ quien: 'Ali', avisar: false });
    expect(r.ok).toBe(false);
    expect(r.pasos.find((p) => p.clave === 'gsg')?.detalle).toContain('GSG no está conectado');
    expect(m.avisos).toHaveLength(0);
    expect(m.humo.estado().ultima?.quien).toBe('Ali');
  });

  it('sin supervisor, o con el envío frenado, lo dice en cristiano', async () => {
    const sin = montar({ supervisor: '' });
    let r = await sin.humo.correr({ avisar: false });
    expect(r.pasos[0]!.ok).toBe(false);
    expect(r.pasos[0]!.detalle).toContain('No hay número del supervisor');
    expect(sin.enviados).toHaveLength(0);

    const frenado = montar({ bloqueo: 'daily_cap' });
    r = await frenado.humo.correr({ avisar: false });
    expect(r.pasos[0]!.detalle).toContain('cupo de mensajes de hoy');

    const rechazado = montar({ entrega: 'failed' });
    r = await rechazado.humo.correr({ avisar: false });
    expect(r.pasos[0]!.ok).toBe(false);
    expect(r.pasos[0]!.detalle).toContain('Número no válido');

    const sinAcuse = montar({ entrega: 'sent' });
    r = await sinAcuse.humo.correr({ avisar: false });
    expect(r.pasos[0]!.ok).toBe(true);
    expect(r.pasos[0]!.detalle).toContain('no confirmó la entrega');

    expect(explicarBloqueo('opt_out', '')).toContain('dado de baja');
    expect(explicarBloqueo('lo_que_sea', 'motivo crudo')).toBe('motivo crudo');
  });

  it('con la IA encendida se le pide una frase y se dice cuánto tardó', async () => {
    const m = montar({ iaToken: true });
    const r = await m.humo.correr({ avisar: false });
    expect(r.pasos[2]).toMatchObject({ ok: true });
    expect(r.pasos[2]!.omitido).toBeUndefined();
    expect(r.pasos[2]!.detalle).toContain('0.9 s');
  });

  it('el ticker: nada antes de la hora, una pasada a la hora, ninguna más ese día, y otra al día siguiente', async () => {
    const m = montar();
    expect(await m.humo.tick()).toBe(false);
    expect(m.humo.estado().proxima).toBe('hoy a las 07:00');
    m.avanzar(29);
    expect(await m.humo.tick()).toBe(false);
    m.avanzar(1);
    expect(await m.humo.tick()).toBe(true);
    expect(m.enviados).toHaveLength(1);
    expect(m.humo.estado().proxima).toBe('mañana a las 07:00');
    m.avanzar(60);
    expect(await m.humo.tick()).toBe(false);
    expect(m.enviados).toHaveLength(1);
    m.avanzar(24 * 60);
    expect(await m.humo.tick()).toBe(true);
    expect(m.enviados).toHaveLength(2);
    // Un servidor que arranca a las tres de la tarde no hace "la de la mañana".
    m.avanzar(24 * 60 + 6 * 60);
    expect(await m.humo.tick()).toBe(false);
    expect(m.enviados).toHaveLength(2);
    m.avanzar(24 * 60 - 6 * 60);
    m.ajustes.activo = false;
    m.avanzar(24 * 60);
    expect(await m.humo.tick()).toBe(false);
    expect(m.humo.estado().proxima).toContain('apagadas');
  });
});

describe('el cupo del día contado por adelantado', () => {
  const salud = (cupoHoy: number, hoy: number) => ({ snapshot: async () => ({ ritmo: { cupoHoy, hoy } }) }) as never;
  const pedido = (extra: Partial<{ estado: string; ubicacionEstado: string; confirmacionEstado: string; motorizadoEstado: string; confirmacionIntentos: number; motorizadoIntentos: number }> = {}) => ({
    estado: 'esperando_ubicacion',
    ubicacionEstado: 'pendiente',
    confirmacionEstado: 'pendiente',
    motorizadoEstado: 'sin_asignar',
    confirmacionIntentos: 0,
    motorizadoIntentos: 0,
    ...extra,
  });
  const ajustes = { confirmacionMaxIntentos: 3, motorizadoMaxIntentos: 2, avisarEntregado: true };

  it('cupo 100 y 60 pedidos enteros: no alcanza, y dice qué recortar', async () => {
    const r = await cupoPrevisto({
      salud: salud(100, 0),
      entregas: { resumen: async () => ({ ajustes, entregas: Array.from({ length: 60 }, () => pedido()) }) },
      reparto: () => ({ maxIntentos: 3 }),
      ahora: () => new Date(),
    });
    // Por pedido: tres solicitudes de ubicación y tres de confirmación.
    expect(r.necesitan).toBe(60 * 6);
    expect(r.puedenSalir).toBe(100);
    expect(r.alcanza).toBe(false);
    expect(r.frase).toContain('faltan 260');
    expect(r.queRecortar.some((q) => q.includes('insistencias'))).toBe(true);
    expect(r.queRecortar.some((q) => q.includes('gracias'))).toBe(false);
    expect(r.detalle.map((d) => d.cantidad)).toEqual([180, 180]);
  });

  it('con pocos pedidos alcanza y las terminadas no cuentan; lo ya hecho tampoco', async () => {
    const r = await cupoPrevisto({
      salud: salud(200, 50),
      entregas: {
        resumen: async () => ({
          ajustes: { ...ajustes, avisarEntregado: false },
          entregas: [
            pedido({ estado: 'avisada', ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', motorizadoEstado: 'respondio' }),
            pedido({ estado: 'entregada', ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', motorizadoEstado: 'respondio' }),
            pedido({ estado: 'esperando_confirmacion', ubicacionEstado: 'recibida', confirmacionEstado: 'pedida', confirmacionIntentos: 2 }),
          ],
        }),
      },
      lista: { resumen: async () => ({ cifras: { hoyComoMucho: 10, hoyEnviados: 4 } }) },
      reparto: async () => ({ maxIntentos: 2 }),
      ahora: () => new Date(),
    });
    expect(r.puedenSalir).toBe(150);
    // Los pedidos completados no cuentan. Falta una repregunta y seis mensajes de la lista.
    expect(r.necesitan).toBe(1 + 6);
    expect(r.alcanza).toBe(true);
    expect(r.queRecortar).toEqual([]);
    expect(r.frase).toContain('sobran');
  });

  it('sin cupo conocido lo dice, sin inventar cifras', async () => {
    const r = await cupoPrevisto({ salud: salud(0, 0), ahora: () => new Date() });
    expect(r.frase).toContain('Todavía no se sabe el cupo');
    expect(r.necesitan).toBe(0);
  });
});
