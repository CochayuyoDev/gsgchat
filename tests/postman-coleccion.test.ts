import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARPETAS_POSTMAN, coleccionPostman, entornoPostman } from '../src/web/postman-coleccion.js';
import { openApi } from '../src/api/v1/openapi.js';
import { manualPage } from '../src/web/ayuda-pages.js';
import { CLAVE_API_PRUEBA } from './fakes.js';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';

type Json = Record<string, any>;
const contrato = openApi('http://localhost:3000') as Json;
const esquemas = contrato.components.schemas as Json;
const llamadas = CARPETAS_POSTMAN.flatMap((c) => c.llamadas);

/** /entregas/{{tracking}} -> la ruta del OpenAPI (/entregas/{referencia}). */
function operacion(metodo: string, ruta: string): Json | undefined {
  const partes = ruta.split('/');
  const clave = Object.keys(contrato.paths).find((p) => {
    const q = p.split('/');
    return q.length === partes.length && q.every((s, i) => s === partes[i] || (s.startsWith('{') && partes[i] === '{{tracking}}'));
  });
  return clave ? contrato.paths[clave][metodo.toLowerCase()] : undefined;
}

/** Las propiedades de primer nivel de una respuesta del contrato. */
function propiedades(op: Json, status: number): string[] {
  const schema = op.responses[status]?.content?.['application/json']?.schema ?? {};
  const final = schema.$ref ? esquemas[schema.$ref.split('/').pop()] : schema;
  return Object.keys(final.properties ?? {});
}

describe('la colección de Postman', () => {
  it('el archivo de docs/postman es el que genera el código (npx tsx scripts/generar-postman.ts)', () => {
    const leer = (f: string) => JSON.parse(readFileSync(new URL(`../docs/postman/${f}`, import.meta.url), 'utf8'));
    expect(leer('gsgchat.postman_collection.json')).toEqual(coleccionPostman());
    expect(leer('gsgchat.postman_environment.json')).toEqual(entornoPostman());
  });

  it('cada llamada existe en el OpenAPI, y sus ejemplos tienen sus códigos y sus campos', () => {
    for (const l of llamadas) {
      const op = operacion(l.metodo, l.ruta);
      expect(op, `${l.metodo} ${l.ruta}`).toBeTruthy();
      for (const e of l.ejemplos) {
        expect(Object.keys(op!.responses), `${l.nombre}: ${e.status}`).toContain(String(e.status));
        const validas = propiedades(op!, e.status);
        if (!validas.length) continue;
        for (const k of Object.keys(e.cuerpo)) expect(validas, `${l.nombre} (${e.status}): ${k}`).toContain(k);
      }
      const cuerpo = op!.requestBody?.content?.['application/json']?.schema;
      if (cuerpo?.additionalProperties === false) for (const k of Object.keys(l.cuerpo as Json)) expect(Object.keys(cuerpo.properties), `${l.nombre}: ${k}`).toContain(k);
      for (const k of cuerpo?.required ?? []) expect(l.cuerpo as Json, `${l.nombre}: ${k}`).toHaveProperty(k);
    }
  });

  it('no lleva ninguna clave: la API Key va en el entorno, secreta y vacía', () => {
    const texto = JSON.stringify(coleccionPostman()) + JSON.stringify(entornoPostman());
    expect(texto).not.toContain(CLAVE_API_PRUEBA);
    expect(texto).not.toMatch(/wak_[A-Za-z0-9]{8,}/);
    expect(entornoPostman().values).toContainEqual({ key: 'apiKey', value: '', type: 'secret', enabled: true });
  });

  it('el Manual enseña los mismos ejemplos y ofrece la colección para descargar', () => {
    const html = manualPage({ nombreNegocio: 'Z' });
    for (const ancla of ['m-gsg-courier', 'm-gsg-flujo', 'm-postman', 'm-conexion-gsg']) expect(html.split(`id="${ancla}"`).length - 1, ancla).toBe(1);
    expect(html).toContain('id="manual-postman"');
    expect(html).toContain('id="manual-postman-entorno"');
  });
});

describe('la colección contra el servidor', () => {
  let esc: EscenarioEntregas;
  afterEach(async () => esc?.cerrar());

  it('cada llamada, en orden, responde con uno de los códigos de sus ejemplos', async () => {
    esc = await crearEscenarioEntregas({ confirmarLista: false });
    for (const l of llamadas) {
      const query = (l.query ?? []).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const url = `/api/v1${l.ruta}`.replace(/\{\{tracking\}\}/g, 'GSG-E-205') + (query ? `?${query}` : '');
      const payload = l.cuerpo === undefined ? undefined : JSON.parse(JSON.stringify(l.cuerpo).replace(/\{\{tracking\}\}/g, 'GSG-E-205'));
      const res = await esc.app.inject({ method: l.metodo, url, headers: l.sinClave ? {} : { 'x-api-key': CLAVE_API_PRUEBA }, ...(payload === undefined ? {} : { payload }) });
      expect(l.ejemplos.map((e) => e.status), `${l.nombre}: ${res.statusCode} ${res.body.slice(0, 200)}`).toContain(res.statusCode);
      if (res.statusCode >= 400) expect(l.ejemplos.find((e) => e.status === res.statusCode)!.cuerpo.codigo, l.nombre).toBe(res.json().codigo);
    }
  }, 90_000);
});
