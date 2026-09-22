/**
 * Los perfiles de instalacion: cada uno deja el modo, el tono, la preventa y
 * los interruptores de las entregas como toca, sin tocar textos ni datos, y
 * queda apuntado quien lo aplico y cuando.
 */

import { describe, expect, it } from 'vitest';
import { crearServicioPerfiles, PERFILES, PERFIL_INICIAL } from '../src/perfiles/servicio.js';
import { createMemorySettingsRepo } from './fakes.js';

function deps() {
  const guardado: Record<string, unknown>[] = [];
  const entregasAjustes = { segundaVisita: { activa: true, esperaMin: 30 }, cierreDelDia: { activo: true, hora: 0 }, clienteRecurrente: { activo: true } };
  let prefs: Record<string, unknown> = { preventaActiva: true };
  let generales: Record<string, unknown> = {};
  return {
    guardado,
    prefs: () => prefs,
    generales: () => generales,
    d: {
      settingsRepo: createMemorySettingsRepo(),
      ajustes: { async guardar(patch: Record<string, unknown>) { generales = { ...generales, ...patch }; return generales; } },
      entregas: { ajustes: () => entregasAjustes, async guardarAjustes(patch: Record<string, unknown>) { guardado.push(patch); return patch; } },
      automation: { async setPrefs(p: Record<string, unknown>) { prefs = { ...prefs, ...p }; return prefs; } },
      ahora: () => new Date('2026-09-21T15:00:00Z'),
    },
  };
}

describe('los perfiles de instalación', () => {
  it('hay tres, el de siempre es el reparto para GSG, y al principio no hay ninguno aplicado', async () => {
    expect(PERFILES.map((p) => p.id)).toEqual(['reparto', 'tienda', 'chat']);
    expect(PERFIL_INICIAL).toBe('reparto');
    const { d } = deps();
    const s = await crearServicioPerfiles(d);
    expect(s.actual()).toBeNull();
    expect(s.perfiles().every((p) => p.cambia.length >= 2 && p.descripcion.length > 20)).toBe(true);
  });

  it('«Solo atención por chat» apaga los automatismos de las entregas, pone usted y el menú completo; «Reparto para GSG» los vuelve a encender', async () => {
    const { d, guardado, prefs, generales } = deps();
    const s = await crearServicioPerfiles(d);
    const r = await s.aplicar('chat', 'Ali');
    expect(r.detalle).toContain('Solo atención por chat');
    expect(r.detalle).toContain('no se tocaron');
    expect(generales()).toMatchObject({ modo: 'completo', tono: 'usted' });
    expect(prefs()).toMatchObject({ preventaActiva: false });
    expect(guardado.at(-1)).toMatchObject({ responderDondeEsta: false, avisarEntregado: false, segundaVisita: { activa: false, esperaMin: 30 }, cierreDelDia: { activo: false, hora: 0 }, clienteRecurrente: { activo: false } });
    expect(s.actual()).toMatchObject({ perfil: 'chat', quien: 'Ali', en: '2026-09-21T15:00:00.000Z' });

    await s.aplicar('reparto', null);
    expect(generales()).toMatchObject({ modo: 'gsg', tono: 'auto' });
    expect(guardado.at(-1)).toMatchObject({ responderDondeEsta: true, usarBotones: true, segundaVisita: { activa: true }, cierreDelDia: { activo: true }, clienteRecurrente: { activo: true } });
    // Ningun perfil toca textos.
    expect(guardado.every((g) => !('textos' in g))).toBe(true);
  });

  it('lo aplicado se recuerda al volver a arrancar y un perfil inventado se rechaza', async () => {
    const { d } = deps();
    const s = await crearServicioPerfiles(d);
    await s.aplicar('tienda', 'Ali');
    const otra = await crearServicioPerfiles(d);
    expect(otra.actual()).toMatchObject({ perfil: 'tienda' });
    await expect(s.aplicar('nada' as never, null)).rejects.toThrow('no existe');
  });
});
