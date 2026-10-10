/**
 * Lo publico de una tienda de la plataforma, cuya direccion lleva ruta
 * (https://x/tienda/<slug>): el widget, el chat embebido, el rastreo en vivo
 * y dos registros a la vez con el mismo nombre de tienda.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { origenPermitido, origenDe } from '../src/web-visitantes/canal.js';
import { embedScript } from '../src/embed/embed-js.js';
import { viewerPage } from '../src/tracking/page.js';
import { crearPlataforma } from '../src/plataforma/plataforma.js';

const BASE = 'https://chat.gsg.pe/tienda/bodega-rosa';

describe('lo publico de una tienda con prefijo', () => {
  it('el widget acepta su propio origen aunque su base lleve /tienda/<slug>', () => {
    expect(origenDe(BASE)).toBe('https://chat.gsg.pe');
    expect(origenPermitido('https://chat.gsg.pe', BASE, [])).toBe(true);
    expect(origenPermitido('https://otra.web', BASE, [])).toBe(false);
    expect(origenPermitido('https://mitienda.pe', BASE, ['https://mitienda.pe'])).toBe(true);
    // La instalacion de siempre (sin ruta) sigue igual.
    expect(origenPermitido('http://localhost:3000', 'http://localhost:3000', [])).toBe(true);
  });

  it('embed.js carga el iframe con la base (con prefijo) y compara los mensajes con el origen (sin ruta)', () => {
    const js = embedScript(BASE);
    // Se ejecuta lo que calcula el script, como lo haria el navegador.
    const origen = new Function(`${js.split('function montar')[0]!.replace('(function () {', '')} return ORIGEN;`)() as string;
    expect(origen).toBe('https://chat.gsg.pe');
    expect(js).toContain("var url = BASE + '/embed/chat'");
    expect(js).toContain('ev.origin !== ORIGEN');
    expect(js).toContain('postMessage(msg, ORIGEN)');
  });

  it('el rastreo en vivo abre su WebSocket por el prefijo de la tienda (un WebSocket no manda Referer)', () => {
    const html = viewerPage('tok123', '', 'Pedido');
    const fuente = /function wsUrl\(token, role\) \{[\s\S]*?\+ role;\s*\}/.exec(html)![0];
    const wsUrl = (pathname: string) =>
      new Function('location', `${fuente}; return wsUrl('tok123', 'view');`)({ protocol: 'https:', host: 'chat.gsg.pe', pathname }) as string;
    expect(wsUrl('/tienda/bodega-rosa/t/tok123')).toBe('wss://chat.gsg.pe/tienda/bodega-rosa/ws/track/tok123?role=view');
    expect(wsUrl('/t/tok123')).toBe('wss://chat.gsg.pe/ws/track/tok123?role=view');
  });
});

describe('dos registros a la vez con el mismo nombre de tienda', () => {
  it('los dos salen bien, cada uno con su slug', async () => {
    const raiz = mkdtempSync(path.join(tmpdir(), 'plataforma-carrera-'));
    const p = await crearPlataforma({ raiz, publicBaseUrl: 'http://localhost:0', proceso: {}, base: { tipo: 'pglite' }, principal: null, autoConectarLocal: false, sembrarPlantillasLocales: false, carpetaCopias: path.join(raiz, 'c'), log: () => undefined });
    try {
      await p.arrancar();
      const datos = (usuario: string) => ({ tienda: 'Bodega Rosa', nombre: 'Rosa', usuario, clave: 'clave-12345' });
      const [a, b] = await Promise.all([p.registrar(datos('rosa-uno'), '1.1.1.1'), p.registrar(datos('rosa-dos'), '2.2.2.2')]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(new Set([a.tienda!.slug, b.tienda!.slug])).toEqual(new Set(['bodega-rosa', 'bodega-rosa-2']));
      // Y dos registros a la vez con el MISMO usuario: uno gana, el otro se explica y no deja nada a medias.
      const [c, d] = await Promise.all([p.registrar({ ...datos('mismo'), tienda: 'Tienda C' }, '3.3.3.3'), p.registrar({ ...datos('mismo'), tienda: 'Tienda D' }, '4.4.4.4')]);
      expect([c.status, d.status].sort()).toEqual([200, 400]);
      expect(await p.cuantas()).toBe(3);
    } finally {
      await p.parar();
      rmSync(raiz, { recursive: true, force: true });
    }
  }, 180_000);
});
