import { describe, expect, it, vi } from 'vitest';
import { crearPuertoHttp, sinClave } from '../src/rutas/gsg.js';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

describe('protecciones del transporte GSG', () => {
  it.each([{ ok: false, error: 'tracking desconocido' }, { success: false, message: 'no se guardó la ubicación' }])('no marca como recibido un HTTP 200 que declara un fallo: %j', async cuerpo => {
    const p = crearPuertoHttp({ url: 'https://gsg.example', token: 'secret', fetchImpl: (async () => new Response(JSON.stringify(cuerpo), { status: 200 })) as typeof fetch });
    expect(await p.enviar('ubicacion', { tracking: 'P', lat: -12, lng: -77 })).toMatchObject({ ok: false, reintentable: false, error: expect.stringContaining('rechazó el reporte') });
  });

  it.each([new Response(null, { status: 204 }), new Response('OK', { status: 200 }), new Response(JSON.stringify({ ok: true, id: '1' }), { status: 201 })])('sigue aceptando respuestas correctas sin inventar fallos', async respuesta => {
    const p = crearPuertoHttp({ url: 'https://gsg.example', token: 'secret', fetchImpl: (async () => respuesta) as typeof fetch });
    expect(await p.enviar('ubicacion', { tracking: 'P', lat: -12, lng: -77 })).toMatchObject({ ok: true });
  });

  it.each([undefined, '', '   '])('no reintenta un envío incierto con clave idempotente inválida %s', async idempotencyKey => {
    const fetchImpl = vi.fn(async () => new Response('error', { status: 503 })) as unknown as typeof fetch;
    const p = crearPuertoHttp({ url: 'https://gsg.example', token: 'secret', idempotenciaUbicacion: true, fetchImpl });
    expect(await p.enviar('ubicacion', { tracking: 'P', lat: -12, lng: -77, idempotencyKey })).toMatchObject({ ok: false, reintentable: false });
    expect((fetchImpl as any).mock.calls[0][1].headers).not.toHaveProperty('Idempotency-Key');
  });

  it('bloquea redirecciones en los envíos (no hay lecturas: a GSG no se le pide nada)', async () => {
    const pedir = vi.fn(async () => new Response('{}'));
    const p = crearPuertoHttp({ url: 'https://gsg.example', token: 'secret', fetchImpl: pedir as typeof fetch });
    await p.enviar('ubicacion', { tracking: 'P', lat: -12, lng: -77 });
    for (const llamada of pedir.mock.calls as unknown as Array<[string, RequestInit]>) expect(llamada[1].redirect).toBe('error');
  });

  it('una redirección real no recibe la API key ni repite el POST', async () => {
    let recibidos = 0;
    const destino = createServer((_req, res) => { recibidos++; res.end('{}'); });
    await new Promise<void>(resolve => destino.listen(0, '127.0.0.1', resolve));
    const direccion = `http://127.0.0.1:${(destino.address() as AddressInfo).port}`;
    const origen = createServer((_req, res) => { res.writeHead(307, { location: direccion }); res.end(); });
    await new Promise<void>(resolve => origen.listen(0, '127.0.0.1', resolve));
    try {
      const p = crearPuertoHttp({ url: `http://127.0.0.1:${(origen.address() as AddressInfo).port}`, token: 'secreto-local' });
      expect(await p.enviar('ubicacion', { tracking: 'P', lat: -12, lng: -77 })).toMatchObject({ ok: false, reintentable: false });
      expect(recibidos).toBe(0);
    } finally {
      await Promise.all([origen, destino].map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
    }
  });

  it('oculta claves cortas y claves que cruzan el límite del mensaje', async () => {
    expect(sinClave('clave abc repetida abc', 'abc')).not.toContain('abc');
    const token = 'CLAVE_PRIVADA_DE_PRUEBA';
    const p = crearPuertoHttp({ url: 'https://gsg.example', token, fetchImpl: (async () => new Response('x'.repeat(190) + token, { status: 400 })) as typeof fetch });
    const envio = await p.enviar('ubicacion', { tracking: 'P', lat: -12, lng: -77 });
    expect(envio.error).not.toContain('CLAVE_');
  });
});
