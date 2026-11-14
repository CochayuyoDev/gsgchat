/**
 * Envio por tandas, solo para las lineas de la API oficial: hasta N mensajes
 * seguidos y despues M minutos de espera. Las lineas normales (QR) siguen con
 * su pausa entre clientes de siempre.
 */

import { describe, expect, it } from 'vitest';
import { decidirRitmo, decidirTanda, Marcapasos, type FotoRitmo } from '../src/salud/ritmo.js';
import { POLITICA_CLOUD, POLITICA_NO_OFICIAL, type Politica } from '../src/salud/politica.js';
import { AJUSTES_GENERALES_VACIOS, ajustesGeneralesPatchSchema, crearServicioAjustes, fusionarAjustes, type AjustesGenerales, type AjustesGeneralesRepo } from '../src/ajustes/generales.js';
import { loadConfig } from '../src/config.js';

const ENV_BASE = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
  BUSINESS_NAME: 'La Tienda',
  RUTAS_SUPERVISOR: '51912000001',
  HORARIO_ENVIO_INICIO: '9',
  HORARIO_ENVIO_FIN: '18',
} as NodeJS.ProcessEnv;

const MIN = 60_000;
const TANDA = { tamano: 50, ventanaMs: 3 * MIN };
// Un martes a las 11:00 de Lima: dentro del horario de fabrica.
const BASE = new Date('2026-11-10T16:00:00Z');

function foto(ahora: Date, enviosTanda: number[], ultimoEnvioAt: Date | null = null): FotoRitmo {
  return { ahora, factor: 1, ultimoMinuto: 0, ultimaHora: 0, ultimoEnvioAt, pausaSorteadaMs: 20_000, destinatariosUnicos24h: 0, limiteTier: null, nuevosContactosHoy: 0, esContactoNuevo: false, enviosTanda };
}

describe('la tanda', () => {
  it('salen 50 seguidos sin pausa y el 51 espera a que pasen los 3 minutos', () => {
    const envios: number[] = [];
    for (let i = 0; i < 50; i++) {
      const momento = new Date(BASE.getTime() + i * 100);
      expect(decidirTanda(envios, momento, TANDA).ok).toBe(true);
      envios.push(momento.getTime());
    }
    const r = decidirTanda(envios, new Date(BASE.getTime() + 5_000), TANDA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe('pausa_entre_tandas');
      // Hasta que el primero de la tanda cumpla 3 minutos: ~2 min 55 s.
      expect(r.esperaMs).toBeGreaterThan(3 * MIN - 6_000);
      expect(r.esperaMs).toBeLessThanOrEqual(3 * MIN);
      expect(r.motivo).toMatch(/50.*3 min/);
    }
    // Pasados los 3 minutos sale la siguiente tanda entera.
    expect(decidirTanda(envios, new Date(BASE.getTime() + 3 * MIN + 5_000), TANDA).ok).toBe(true);
  });

  it('500 mensajes salen en 10 tandas: la ultima a los 27 minutos', () => {
    const envios: number[] = [];
    let t = BASE.getTime();
    while (envios.length < 500) {
      const d = decidirTanda(envios, new Date(t), TANDA);
      if (d.ok) { envios.push(t); t += 50; } else t += d.esperaMs;
    }
    const minutos = (envios[499]! - envios[0]!) / MIN;
    expect(minutos).toBeGreaterThan(26.9);
    expect(minutos).toBeLessThan(27.5);
  });
});

describe('solo para la API', () => {
  const conTandas: Politica = { ...POLITICA_CLOUD, soloRitmo: true, tandas: TANDA };
  const normal: Politica = { ...POLITICA_NO_OFICIAL, soloRitmo: true, pausaMinMs: 15_000, pausaMaxMs: 30_000 };

  it('con tandas, el marcapasos no espera la pausa entre clientes', () => {
    // Acaba de salir uno (pausa de 20 s sin cumplir), pero la tanda tiene hueco.
    expect(decidirRitmo(foto(BASE, [BASE.getTime() - 1_000], new Date(BASE.getTime() - 1_000)), conTandas).ok).toBe(true);
  });

  it('una linea normal sigue esperando su pausa entre clientes', () => {
    const r = decidirRitmo(foto(BASE, [], new Date(BASE.getTime() - 1_000)), normal);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe('pausa_entre_envios');
  });

  it('los envios por la API no mueven la pausa de las lineas normales', () => {
    const m = new Marcapasos(() => normal, () => 0.5);
    m.anotar(new Date(BASE.getTime() - 60_000)); // uno normal hace un minuto
    for (let i = 0; i < 50; i++) m.anotar(new Date(BASE.getTime() - 500 + i), true); // tanda de la API ahora
    expect(m.ultimoEnvioAt()!.getTime()).toBe(BASE.getTime() - 60_000);
    expect(m.enviosTanda(BASE)).toHaveLength(50);
    expect(m.enUltimoMinuto(BASE)).toBe(51);
  });
});

describe('la opcion en los ajustes', () => {
  const repoEnMemoria = (): AjustesGeneralesRepo => {
    let valor: AjustesGenerales = AJUSTES_GENERALES_VACIOS;
    return { get: async () => valor, set: async (p) => (valor = fusionarAjustes(valor, p)), reset: async () => { valor = AJUSTES_GENERALES_VACIOS; } };
  };
  const config = loadConfig(ENV_BASE);

  it('viene apagada; encendida, la API recibe 50 cada 3 min y las lineas normales nada', async () => {
    const ajustes = await crearServicioAjustes({ repo: repoEnMemoria(), config, releerCadaMs: 0 });
    expect(ajustes.politica(POLITICA_CLOUD).tandas).toBeNull();
    await ajustes.guardar({ tandasApi: { activo: true, tamano: 50, pausaMin: 3 } });
    expect(ajustes.politica(POLITICA_CLOUD).tandas).toEqual({ tamano: 50, ventanaMs: 3 * MIN });
    expect(ajustes.politica(POLITICA_NO_OFICIAL).tandas).toBeNull();
    await ajustes.guardar({ tandasApi: { activo: false, tamano: 50, pausaMin: 3 } });
    expect(ajustes.politica(POLITICA_CLOUD).tandas).toBeNull();
  });

  it('no deja valores peligrosos: como mucho 80 por tanda y al menos 2 minutos', () => {
    expect(ajustesGeneralesPatchSchema.safeParse({ tandasApi: { activo: true, tamano: 500, pausaMin: 3 } }).success).toBe(false);
    expect(ajustesGeneralesPatchSchema.safeParse({ tandasApi: { activo: true, tamano: 50, pausaMin: 1 } }).success).toBe(false);
    expect(ajustesGeneralesPatchSchema.safeParse({ tandasApi: { activo: true } }).data?.tandasApi).toEqual({ activo: true, tamano: 50, pausaMin: 3 });
  });
});
