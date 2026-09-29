/**
 * La IA operadora con la conversacion entera de un numero (29/09): «si le
 * digo guarda todos los mensajes de tal numero, exporta este chat o elimina
 * esta conversacion, que pueda».
 *
 * Lo que se prueba, con un panel de mentira que contesta a cada ruta:
 * exportar un chat vivo lo guarda y da el enlace; sin chat vivo da el enlace
 * de lo guardado sin cambiar nada; sin nada que exportar lo dice; eliminar
 * manda a la papelera (nunca definitivo) con la palabra de confirmacion; y
 * «preparar» nunca escribe.
 */

import { describe, expect, it } from 'vitest';
import { ACCIONES_POR_NOMBRE, prepararAccion } from '../src/ia/acciones.js';
import type { ContextoAccion, Llamada, RespuestaLlamada } from '../src/ia/acciones-base.js';

const LUIS = { id: 'c-luis', phone: '51912426667', name: 'Luis Ramírez' };

function panel(opts: { vivos: number; guardadas: Array<{ id: number; createdAt: string }> }) {
  const llamadas: Llamada[] = [];
  const ctx: ContextoAccion = {
    quien: 'ali',
    esAdmin: true,
    async llamar(l): Promise<RespuestaLlamada> {
      llamadas.push(l);
      const url = l.url.split('?')[0]!;
      if (l.method === 'GET' && url === '/admin/chat/conversations') return { status: 200, json: { conversations: [{ contactId: LUIS.id, phone: LUIS.phone, name: LUIS.name }], contacts: [LUIS] } };
      if (l.method === 'GET' && url === `/admin/chat/${LUIS.id}/ficha`) return { status: 200, json: { contacto: LUIS } };
      if (l.method === 'GET' && url === `/admin/chat/${LUIS.id}`) return { status: 200, json: { messages: Array.from({ length: opts.vivos }, (_, i) => ({ id: i + 1 })) } };
      if (l.method === 'GET' && url === '/admin/archives') return { status: 200, json: { items: opts.guardadas, total: opts.guardadas.length } };
      if (l.method === 'GET' && url.startsWith('/admin/contacts')) return { status: 200, json: { items: [LUIS], contacts: [LUIS] } };
      if (l.method === 'POST' && url === `/admin/chat/${LUIS.id}/archive`) return opts.vivos ? { status: 200, json: { ok: true, archive: { id: 77 }, borrados: opts.vivos } } : { status: 409, json: { error: 'sin mensajes' } };
      if (l.method === 'POST' && url === '/admin/archives/borrar-cliente') return { status: 200, json: { ok: true, guardadas: 1, aPapelera: 2, papeleraDias: 30 } };
      return { status: 404, json: { error: `ruta de prueba desconocida: ${l.method} ${l.url}` } };
    },
  };
  const escrituras = () => llamadas.filter((l) => l.method !== 'GET');
  return { ctx, llamadas, escrituras };
}

const accion = (n: string) => ACCIONES_POR_NOMBRE.get(n)!;

describe('IA operadora: exportar y eliminar la conversación de un número', () => {
  it('están en el catálogo, y «guardar todos los mensajes» se entiende como chat.cerrar', () => {
    expect(accion('chat.exportar').tipo).toBe('cambio');
    expect(accion('chat.eliminar').peligrosa).toBe(true);
    expect(accion('chat.cerrar').descripcion).toMatch(/Guardar todos los mensajes/);
  });

  it('exportar un chat vivo: la tarjeta avisa que se guarda, y con «Hacerlo» se guarda y da el enlace', async () => {
    const p = panel({ vivos: 12, guardadas: [] });
    const prep = await prepararAccion(accion('chat.exportar'), { telefono: '912426667', contactId: LUIS.id }, p.ctx);
    expect(prep.tipo).toBe('listo');
    if (prep.tipo !== 'listo') return;
    expect(prep.tarjeta.que).toMatch(/Guardar el chat de Luis Ramírez y darte el enlace/);
    expect(prep.tarjeta.antes).toMatch(/12 mensaje/);
    expect(p.escrituras()).toHaveLength(0);

    const r = await accion('chat.exportar').ejecutar(prep.params, p.ctx);
    expect(r.ok).toBe(true);
    expect(r.ir).toBe('/admin/archives/77/export.html');
    expect(p.escrituras().map((l) => l.url)).toEqual([`/admin/chat/${LUIS.id}/archive`]);
  });

  it('exportar sin chat vivo: el enlace de la última guardada, en texto y anónimo, sin escribir nada', async () => {
    const p = panel({ vivos: 0, guardadas: [{ id: 41, createdAt: '2026-09-28T10:00:00Z' }, { id: 30, createdAt: '2026-09-20T10:00:00Z' }] });
    const prep = await prepararAccion(accion('chat.exportar'), { telefono: '912426667', contactId: LUIS.id, formato: 'texto', anonimo: true }, p.ctx);
    expect(prep.tipo).toBe('listo');
    if (prep.tipo !== 'listo') return;
    expect(prep.tarjeta.despues).toMatch(/no cambia nada/);
    const r = await accion('chat.exportar').ejecutar(prep.params, p.ctx);
    expect(r.ir).toBe('/admin/archives/41/export.txt?anonimo=si');
    expect(p.escrituras()).toHaveLength(0);
  });

  it('exportar sin nada: lo dice y no prepara tarjeta', async () => {
    const p = panel({ vivos: 0, guardadas: [] });
    const prep = await prepararAccion(accion('chat.exportar'), { telefono: '912426667', contactId: LUIS.id }, p.ctx);
    expect(prep.tipo).toBe('no');
  });

  it('eliminar: la tarjeta avisa de la papelera de 30 días y con «Hacerlo» va a la papelera, nunca definitivo', async () => {
    const p = panel({ vivos: 5, guardadas: [{ id: 41, createdAt: '2026-09-28T10:00:00Z' }] });
    const prep = await prepararAccion(accion('chat.eliminar'), { telefono: '912426667', contactId: LUIS.id }, p.ctx);
    expect(prep.tipo).toBe('listo');
    if (prep.tipo !== 'listo') return;
    expect(prep.tarjeta.antes).toMatch(/5 mensaje.*1 conversación/);
    expect(prep.tarjeta.avisos?.join(' ')).toMatch(/30 días/);
    expect(p.escrituras()).toHaveLength(0);

    const r = await accion('chat.eliminar').ejecutar(prep.params, p.ctx);
    expect(r.ok).toBe(true);
    const [w] = p.escrituras();
    expect(w).toMatchObject({ method: 'POST', url: '/admin/archives/borrar-cliente', body: { contactId: LUIS.id, confirmar: 'BORRAR' } });
    expect(p.llamadas.some((l) => /definitivo/.test(l.url))).toBe(false);
  });
});
