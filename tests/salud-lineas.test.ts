/**
 * La tabla «Números de WhatsApp» de Salud / Fiabilidad: el estado de cada numero
 * (operativo, con problemas, desconectado, no verificado) con su causa, y el
 * maximo por dia con su consumo («342 / 500» o «Sin límite») por la API.
 */

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerLineasLimitesRoutes, textoDeConsumo } from '../src/web/lineas-limites-routes.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';
import { crearSaludDeLineas } from '../src/whatsapp/salud-lineas.js';
import { LimiteInvalido, validarLimiteDiario } from '../src/whatsapp/limite-diario.js';
import type { Linea } from '../src/whatsapp/lineas.js';
import { createFakeUsoLineas } from './fakes-uso-lineas.js';

const linea = (id: string, extra: Partial<Linea> = {}): Linea => ({
  id, etiqueta: `wsp-${id}`, telefono: `5190000000${id}`, proveedor: 'local', idExterno: null, estado: 'conectado', principal: false, habilitada: true, posicion: 1, limiteDiario: 0, ...extra,
});

type Sesion = { status: string; detail: string; phone?: string; bloqueado?: boolean };
const conSesion = (s: Sesion) => ({ sesion: { getLocalState: () => s }, cliente: {} });

function salud(lineas: Linea[], transportes: Record<string, unknown>, ahora = () => 0) {
  return crearSaludDeLineas({
    lineas: { listar: async () => lineas },
    registro: { transporte: async (id?: string | null) => (transportes[id ?? ''] ?? null) as never },
    ahora,
    esperaMs: 50,
  });
}

describe('salud de cada numero', () => {
  it('sesion local: operativo, esperando QR, caida, bloqueada, fallo', async () => {
    const lineas = ['a', 'b', 'c', 'd', 'e'].map((id) => linea(id));
    const r = await salud(lineas, {
      a: conSesion({ status: 'WORKING', detail: '' }),
      b: conSesion({ status: 'SCAN_QR_CODE', detail: '' }),
      c: conSesion({ status: 'STOPPED', detail: 'El teléfono cerró la sesión' }),
      d: conSesion({ status: 'WORKING', detail: '', bloqueado: true }),
      e: conSesion({ status: 'FAILED', detail: 'No se pudo abrir el socket' }),
    }).consultar();
    expect(r.map((x) => [x.id, x.estado, x.causa])).toEqual([
      ['a', 'operativo', null],
      ['b', 'desconectado', 'Esperando que escanees el código QR'],
      ['c', 'desconectado', 'El teléfono cerró la sesión'],
      ['d', 'con_problemas', 'WhatsApp rechazó este número'],
      ['e', 'con_problemas', 'No se pudo abrir el socket'],
    ]);
  });

  it('deshabilitada es desconectada y sin datos de conexion es con problemas', async () => {
    const r = await salud([linea('a', { habilitada: false }), linea('b')], {}).consultar();
    expect(r[0]).toMatchObject({ estado: 'desconectado', causa: expect.stringContaining('deshabilitada') });
    expect(r[1]).toMatchObject({ estado: 'con_problemas', causa: expect.stringContaining('Faltan datos') });
  });

  it('con la API de Meta se consulta el numero (nunca se manda un mensaje): operativo, calidad roja, clave vencida o sin respuesta', async () => {
    const ok = { cliente: { getPhoneNumber: async () => ({ qualityRating: 'GREEN' }) } };
    const rojo = { cliente: { getPhoneNumber: async () => ({ qualityRating: 'RED' }) } };
    const vencida = { cliente: { getPhoneNumber: async () => { throw new WhatsAppApiError('Invalid OAuth access token', 401, 190); } } };
    const colgada = { cliente: { getPhoneNumber: () => new Promise(() => undefined) } };
    const caida = { cliente: { conectado: () => false, getPhoneNumber: async () => { throw new Error('no debe consultarse'); } } };
    const nube = (id: string) => linea(id, { proveedor: 'cloud' });
    const r = await salud(['a', 'b', 'c', 'd', 'e'].map(nube), { a: ok, b: rojo, c: vencida, d: colgada, e: caida }).consultar();
    expect(r.map((x) => x.estado)).toEqual(['operativo', 'con_problemas', 'con_problemas', 'no_verificado', 'desconectado']);
    expect(r[1]!.causa).toContain('calidad');
    expect(r[2]!.causa).toContain('clave');
    expect(r[3]!.causa).toContain('no contestó');
  });

  it('la respuesta del proveedor se recuerda unos segundos', async () => {
    let llamadas = 0;
    let t = 0;
    const s = salud([linea('a', { proveedor: 'waha' })], { a: { cliente: { getPhoneNumber: async () => { llamadas++; return { qualityRating: 'NA' }; } } } }, () => t);
    await s.consultar();
    await s.consultar();
    expect(llamadas).toBe(1);
    t += 60_000;
    await s.consultar();
    expect(llamadas).toBe(2);
  });
});

describe('API de limites en Salud / Fiabilidad', () => {
  async function montar(rol: string | null = 'admin') {
    const uso = createFakeUsoLineas();
    const lineas = [linea('a', { principal: true, limiteDiario: 500 }), linea('b')];
    const app = Fastify();
    app.addHook('onRequest', async (request) => { (request as never as { usuario: unknown }).usuario = rol ? { rol } : null; });
    await registerLineasLimitesRoutes(app, {
      lineas: {
        listar: async () => lineas,
        obtener: async (id) => lineas.find((l) => l.id === id) ?? null,
        fijarLimite: async (id, valor) => {
          const n = validarLimiteDiario(valor);
          lineas.find((l) => l.id === id)!.limiteDiario = n;
          return n;
        },
      },
      uso,
      salud: { consultar: async () => [{ id: 'a', etiqueta: 'wsp-a', numero: '51900000000', estado: 'operativo', causa: null }] },
      ahora: () => new Date('2026-11-05T04:00:00Z'),
    });
    await uso.reservar({ clave: 'x', lineaId: 'a', dia: '2026-11-04', motivo: 'asignacion_original' });
    return { app };
  }

  it('lista cada numero con «usados / maximo» o «Sin límite», en el dia de Lima', async () => {
    const { app } = await montar();
    const r = (await app.inject({ method: 'GET', url: '/admin/fiabilidad/limites' })).json();
    expect(r).toMatchObject({ zona: 'America/Lima', dia: '2026-11-04' });
    expect(r.lineas.map((l: { consumo: string }) => l.consumo)).toEqual(['1 / 500', 'Sin límite']);
    expect(textoDeConsumo(342, 500)).toBe('342 / 500');
  });

  it('guarda el maximo; vacio o 0 es sin limite', async () => {
    const { app } = await montar();
    const guardar = (valor: unknown) => app.inject({ method: 'PUT', url: '/admin/fiabilidad/limites/b', payload: { limiteDiario: valor } });
    expect((await guardar('200')).json()).toMatchObject({ ok: true, limiteDiario: 200 });
    expect((await guardar('')).json()).toMatchObject({ ok: true, limiteDiario: 0 });
    expect((await guardar(0)).json()).toMatchObject({ ok: true, limiteDiario: 0 });
  });

  it('rechaza negativos, decimales y texto con un error claro, y no cambia nada', async () => {
    const { app } = await montar();
    for (const malo of [-1, 2.5, 'abc']) {
      const r = await app.inject({ method: 'PUT', url: '/admin/fiabilidad/limites/a', payload: { limiteDiario: malo } });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toMatch(/entero|negativo/);
    }
    const lista = (await app.inject({ method: 'GET', url: '/admin/fiabilidad/limites' })).json();
    expect(lista.lineas[0].limiteDiario).toBe(500);
    expect(() => validarLimiteDiario(-1)).toThrow(LimiteInvalido);
  });

  it('solo un administrador lo cambia y un numero que no existe da 404', async () => {
    const { app } = await montar('operador');
    expect((await app.inject({ method: 'PUT', url: '/admin/fiabilidad/limites/a', payload: { limiteDiario: 5 } })).statusCode).toBe(403);
    const admin = await montar('admin');
    expect((await admin.app.inject({ method: 'PUT', url: '/admin/fiabilidad/limites/zzz', payload: { limiteDiario: 5 } })).statusCode).toBe(404);
  });

  it('el estado de salud sale por su ruta', async () => {
    const { app } = await montar();
    const r = (await app.inject({ method: 'GET', url: '/admin/fiabilidad/whatsapp' })).json();
    expect(r.lineas).toEqual([{ id: 'a', etiqueta: 'wsp-a', numero: '51900000000', estado: 'operativo', causa: null }]);
  });
});
