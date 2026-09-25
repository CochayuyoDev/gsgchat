/**
 * El selector de modelos de OpenAI: la lista REAL de la cuenta (GET /v1/models),
 * solo los de conversar, el de consumo muy bajo primero y elegido, y si no se
 * puede listar, gpt-4o-mini con el motivo en palabras.
 */
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { listarModelosOpenAI, ordenarModelosOpenAI, etiquetaDeModelo, MODELO_OPENAI_POR_DEFECTO } from '../src/ia/proveedores.js';
import { registerIaRoutes } from '../src/ia/routes.js';
import type { ServicioIA } from '../src/ia/servicio.js';

const respuesta = (status: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

const CUENTA = ['gpt-4o', 'text-embedding-3-small', 'whisper-1', 'tts-1', 'dall-e-3', 'omni-moderation-latest', 'gpt-4o-realtime-preview', 'gpt-4o-mini-transcribe', 'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4o-search-preview', 'gpt-image-1', 'gpt-5.6-nano', 'luna-small', 'gpt-4.1'];

describe('listar los modelos de la cuenta de OpenAI', () => {
  it('deja solo los de conversar, recomienda los de consumo muy bajo primero y elige gpt-4o-mini', async () => {
    let pedido: { url: string; auth: string | null } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      pedido = { url, auth: new Headers(init?.headers).get('authorization') };
      return respuesta(200, { data: CUENTA.map((id) => ({ id, object: 'model' })) });
    }) as unknown as typeof fetch;
    const r = await listarModelosOpenAI({ clave: 'sk-prueba', fetchImpl });
    expect(pedido).toEqual({ url: 'https://api.openai.com/v1/models', auth: 'Bearer sk-prueba' });
    expect(r.ok).toBe(true);
    const ids = r.modelos.map((m) => m.id);
    expect(ids.slice(0, 2)).toEqual(['gpt-4o-mini', 'gpt-4.1-mini']);
    for (const fuera of ['text-embedding-3-small', 'whisper-1', 'tts-1', 'dall-e-3', 'omni-moderation-latest', 'gpt-4o-realtime-preview', 'gpt-4o-mini-transcribe', 'gpt-4o-search-preview', 'gpt-image-1']) expect(ids).not.toContain(fuera);
    expect(ids).toEqual(expect.arrayContaining(['gpt-4o', 'gpt-4.1', 'gpt-5.6-nano', 'luna-small']));
    expect(r.elegido).toBe('gpt-4o-mini');
    expect(r.modelos[0]!.etiqueta).toBe('Recomendado · consumo muy bajo');
    expect(r.modelos.find((m) => m.id === 'gpt-5.6-nano')!.etiqueta).toBe('consumo bajo');
    expect(r.modelos.find((m) => m.id === 'luna-small')!.etiqueta).toBe('consumo bajo');
    expect(r.modelos.find((m) => m.id === 'gpt-4o')!.etiqueta).toBeNull();
  });

  it('no inventa modelos: si la cuenta no tiene gpt-4o-mini, no aparece y se elige el primero que haya', async () => {
    const fetchImpl = (async () => respuesta(200, { data: [{ id: 'gpt-4.1' }, { id: 'gpt-5.6-mini' }] })) as unknown as typeof fetch;
    const r = await listarModelosOpenAI({ clave: 'sk-x', fetchImpl });
    expect(r.modelos.map((m) => m.id)).toEqual(['gpt-5.6-mini', 'gpt-4.1']);
    expect(r.elegido).toBe('gpt-5.6-mini');
  });

  it('con una clave mala cae a gpt-4o-mini y lo dice en palabras', async () => {
    const fetchImpl = (async () => respuesta(401, { error: { message: 'Incorrect API key provided' } })) as unknown as typeof fetch;
    const r = await listarModelosOpenAI({ clave: 'sk-mala', fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.elegido).toBe(MODELO_OPENAI_POR_DEFECTO);
    expect(r.modelos.map((m) => m.id)).toEqual(['gpt-4o-mini']);
    expect(r.detalle).toMatch(/clave no vale/);
    expect(r.detalle).not.toMatch(/Incorrect|401/);
  });

  it('sin red (o sin clave) nunca lanza: gpt-4o-mini', async () => {
    const fetchImpl = (async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;
    const r = await listarModelosOpenAI({ clave: 'sk-x', fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.elegido).toBe('gpt-4o-mini');
    expect(r.detalle).toMatch(/internet/);
    const sinClave = await listarModelosOpenAI({ clave: '  ' });
    expect(sinClave.elegido).toBe('gpt-4o-mini');
  });

  it('las etiquetas solo miran el nombre del modelo', () => {
    expect(etiquetaDeModelo('gpt-4o-mini')).toBe('Recomendado · consumo muy bajo');
    expect(etiquetaDeModelo('gpt-4.1-mini')).toBe('Recomendado · consumo muy bajo');
    expect(etiquetaDeModelo('gpt-4o')).toBeNull();
    expect(ordenarModelosOpenAI(['gpt-4o', 'gpt-4o', 'gpt-4o-mini']).map((m) => m.id)).toEqual(['gpt-4o-mini', 'gpt-4o']);
  });
});

describe('POST /admin/ia/modelos', () => {
  async function app(rol: 'admin' | 'operador', fetchImpl: typeof fetch) {
    const a = Fastify();
    a.addHook('preHandler', async (request) => {
      (request as unknown as { usuario: unknown }).usuario = { id: '1', usuario: 'u', nombre: 'U', rol, permisos: [] };
    });
    await registerIaRoutes(a, { ia: {} as ServicioIA, fetchImpl });
    return a;
  }

  it('un administrador ve los modelos de su cuenta', async () => {
    const a = await app('admin', (async () => respuesta(200, { data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] })) as unknown as typeof fetch);
    const r = await a.inject({ method: 'POST', url: '/admin/ia/modelos', payload: { clave: 'sk-1' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().elegido).toBe('gpt-4o-mini');
    expect(r.json().modelos[0]).toEqual({ id: 'gpt-4o-mini', etiqueta: 'Recomendado · consumo muy bajo', recomendado: true });
    await a.close();
  });

  it('un operador no', async () => {
    const a = await app('operador', (async () => respuesta(200, { data: [] })) as unknown as typeof fetch);
    const r = await a.inject({ method: 'POST', url: '/admin/ia/modelos', payload: { clave: 'sk-1' } });
    expect(r.statusCode).toBe(403);
    await a.close();
  });
});
