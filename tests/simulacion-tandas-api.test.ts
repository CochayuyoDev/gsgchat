/**
 * Simulacion del envio por tandas (pedido del dueño, 11/11), sin WhatsApp:
 * el motor real del reparto, el marcapasos real (control de envios de las
 * tiendas) y un WhatsApp falso que solo apunta cuando sale cada mensaje.
 *
 *  - Linea de la API con «Enviar por tandas» (50 cada 3 min): 120 pedidos
 *    salen en tandas de 50, 50 y 20, con 3 minutos entre tandas, todos con la
 *    plantilla «solicitud_inicial» y sus 8 datos.
 *  - Los recordatorios salen con «recordatorio_inicial» (nombre, producto, tienda).
 *  - Linea normal (QR): sigue con su pausa entre clientes de siempre.
 */

import { describe, expect, it } from 'vitest';
import { ajustesEntregasSchema, variablesPlantillaEntrega } from '../src/entregas/textos.js';
import { crearMotor, OPCIONES_POR_DEFECTO, type OpcionesMotor } from '../src/rutas/motor.js';
import { crearPuertoEnEspera } from '../src/rutas/gsg.js';
import { crearControlEnvios } from '../src/salud/control-envios.js';
import { POLITICA_CLOUD, POLITICA_NO_OFICIAL, type Politica } from '../src/salud/politica.js';
import type { SendJob, SendOutcome, Sender } from '../src/outbound/sender.js';
import type { Monitor } from '../src/salud/monitor.js';
import { approvedTemplate, createFakeRepos } from './fakes.js';

const MIN = 60_000;
const INICIO = new Date('2026-03-10T15:00:00Z'); // martes 10:00 en Lima
const opciones: OpcionesMotor = { ...OPCIONES_POR_DEFECTO, timezone: 'America/Lima' };
const AJUSTES = ajustesEntregasSchema.parse({});

const datosDe = (i: number) =>
  variablesPlantillaEntrega(
    { nombre: `Cliente ${i}`, negocio: 'GSG Courier', pedido: `GSG-E-${1000 + i}`, direccion: 'Av. Ejemplo 123', distrito: 'Lince', envio: { producto: 'Llanta Pirelli', empresaNombre: 'Unboxtech', tracking: `GSG-E-${1000 + i}`, metodoPago: 'YAPE', monto: '100' } } as never,
    AJUSTES,
  );

async function simular(politica: Politica, pedidos: number, minutos: number) {
  const repos = createFakeRepos();
  const lote = await repos.rutas.crearLote({ nombre: 'Lista del día' });
  await repos.rutas.agregarSolicitudes(
    lote.id,
    Array.from({ length: pedidos }, (_, i) => {
      const phone = `51900${String(100000 + i).slice(-6)}`;
      return { telefonoCrudo: phone, phone, nombre: `Cliente ${i}`, referencia: `GSG-E-${1000 + i}` };
    }),
  );
  await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
  await repos.templates.upsert(approvedTemplate({ name: 'solicitud_inicial', language: 'es_PE', category: 'UTILITY', variables: 8, quality: 'GREEN' }));
  await repos.templates.upsert(approvedTemplate({ name: 'recordatorio_inicial', language: 'es_PE', category: 'UTILITY', variables: 3, quality: 'GREEN' }));

  let ahora = INICIO;
  const salud = await crearControlEnvios({ repos, politica: () => politica, phoneNumberId: () => 'PNID', ahora: () => ahora, azar: () => 0.5 });
  // El WhatsApp falso: apunta la hora y la plantilla; el marcapasos anota como lo hace el sender real.
  const salidas: Array<{ t: number; job: SendJob }> = [];
  const sender: Sender = {
    async send(job) {
      salidas.push({ t: ahora.getTime(), job });
      salud.marcapasos.anotar(ahora, Boolean(politica.tandas));
      return { ok: true, wamid: `w.${salidas.length}`, deliveryId: salidas.length } as SendOutcome;
    },
  };
  const motor = crearMotor({
    repos, sender, gsg: crearPuertoEnEspera(), opciones, ahora: () => ahora, azar: () => 0.5,
    usarPlantilla: () => false, plantillaMeta: async () => true,
    plantillaSolicitud: async (s) => ({ name: 'solicitud_inicial', language: 'es_PE', variables: datosDe(Number((s.referencia ?? '').slice(6)) - 1000) }),
    datosPedido: async (s) => datosDe(Number((s.referencia ?? '').slice(6)) - 1000),
    salud: salud as Monitor,
    politica: () => politica,
  });

  const fin = INICIO.getTime() + minutos * MIN;
  while (ahora.getTime() < fin) {
    const r = await motor.tick();
    // Si salio uno, enseguida se mira el siguiente; si no, el reloj avanza 5 s.
    ahora = new Date(ahora.getTime() + (r.accion === 'envio' ? 50 : 5_000));
  }
  return salidas;
}

/** Agrupa los envios en tandas: un hueco de mas de 1 minuto abre una tanda nueva. */
function tandas(salidas: Array<{ t: number }>): Array<{ desdeMin: number; cuantos: number }> {
  const grupos: Array<{ desdeMin: number; cuantos: number }> = [];
  let anterior = -Infinity;
  for (const s of salidas) {
    if (s.t - anterior > MIN) grupos.push({ desdeMin: (s.t - INICIO.getTime()) / MIN, cuantos: 0 });
    grupos[grupos.length - 1]!.cuantos++;
    anterior = s.t;
  }
  return grupos;
}

describe('simulacion: envio por tandas en la API (sin WhatsApp)', () => {
  const API_CON_TANDAS: Politica = { ...POLITICA_CLOUD, soloRitmo: true, autoPausa: false, horaInicio: 0, horaFin: 24, diasPermitidos: [0, 1, 2, 3, 4, 5, 6], tandas: { tamano: 50, ventanaMs: 3 * MIN } };

  it('120 pedidos salen en tandas de 50, 50 y 20 con 3 minutos entre tandas, con solicitud_inicial y sus 8 datos', async () => {
    const salidas = (await simular(API_CON_TANDAS, 120, 12)).filter((s) => s.job.templateName === 'solicitud_inicial');
    expect(salidas).toHaveLength(120);
    const g = tandas(salidas);
    expect(g.map((x) => x.cuantos)).toEqual([50, 50, 20]);
    expect(g[1]!.desdeMin - g[0]!.desdeMin).toBeGreaterThanOrEqual(3);
    expect(g[1]!.desdeMin - g[0]!.desdeMin).toBeLessThan(3.5);
    expect(g[2]!.desdeMin - g[1]!.desdeMin).toBeGreaterThanOrEqual(3);
    // Nunca mas de 50 en ninguna ventana de 3 minutos.
    for (const s of salidas) expect(salidas.filter((o) => o.t >= s.t && o.t < s.t + 3 * MIN).length).toBeLessThanOrEqual(50);
    // Cada uno con su plantilla y sus 8 datos, en es_PE.
    expect(salidas[0]!.job).toMatchObject({ kind: 'template', templateName: 'solicitud_inicial', templateLanguage: 'es_PE' });
    expect(salidas[0]!.job.variables).toEqual(['Cliente 0', 'Llanta Pirelli', 'Unboxtech', 'GSG-E-1000', 'YAPE', '100.00', 'Lince - Av. Ejemplo 123', 'de 2 de la tarde a 8 de la noche']);
    console.log('[simulacion API] tandas:', g.map((x) => `${x.cuantos} al minuto ${x.desdeMin.toFixed(1)}`).join(' · '));
  }, 120_000);

  it('los recordatorios salen con recordatorio_inicial (nombre, producto y tienda), tambien por tandas', async () => {
    const salidas = await simular({ ...API_CON_TANDAS }, 60, 4 * 60);
    const recordatorios = salidas.filter((s) => s.job.templateName === 'recordatorio_inicial');
    expect(recordatorios.length).toBeGreaterThan(0);
    expect(recordatorios[0]!.job.templateLanguage).toBe('es_PE');
    expect(recordatorios[0]!.job.variables).toEqual(['Cliente 0', 'Llanta Pirelli', 'Unboxtech']);
    // Ningun otro nombre de plantilla: solo las dos del dueño.
    expect([...new Set(salidas.map((s) => s.job.templateName))].sort()).toEqual(['recordatorio_inicial', 'solicitud_inicial']);
    for (const s of salidas) expect(salidas.filter((o) => o.t >= s.t && o.t < s.t + 3 * MIN).length).toBeLessThanOrEqual(50);
  }, 240_000);

  it('una linea normal (QR) sigue con la pausa entre clientes: nada de tandas', async () => {
    const normal: Politica = { ...POLITICA_NO_OFICIAL, soloRitmo: true, autoPausa: false, horaInicio: 0, horaFin: 24, diasPermitidos: [0, 1, 2, 3, 4, 5, 6], pausaMinMs: 15_000, pausaMaxMs: 30_000 };
    const salidas = (await simular(normal, 40, 5)).filter((s) => s.job.templateName === 'solicitud_inicial');
    expect(salidas.length).toBeGreaterThan(5);
    expect(salidas.length).toBeLessThan(25);
    for (let i = 1; i < salidas.length; i++) expect(salidas[i]!.t - salidas[i - 1]!.t).toBeGreaterThanOrEqual(15_000);
    console.log(`[simulacion QR] en 5 minutos salieron ${salidas.length} (uno cada 15-30 s)`);
  }, 120_000);
});
