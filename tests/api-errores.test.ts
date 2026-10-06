/**
 * Cada fallo de la recepción de pedidos con el código HTTP de su causa y el
 * mismo cuerpo JSON ({ ok:false, codigo, error, detalles? }), sin SQL, trazas
 * ni secretos. Y el aislamiento entre tiendas de la bandeja de errores.
 *
 * Se habla con el servidor de delante de la plataforma (el que reparte por
 * clave, cookie y prefijo), con dos tiendas de mentira.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { crearServidorPlataforma, type ServidorPlataforma } from '../src/plataforma/servidor.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import type { Plataforma } from '../src/plataforma/plataforma.js';
import type { Directorio, TiendaRegistrada } from '../src/plataforma/directorio.js';
import type { TiendaViva } from '../src/plataforma/tienda.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';

const GSG = { empresa: { codigo: 'T01', nombre: 'Tienda Prueba' }, metodoPago: 'Contraentrega', montoCobrar: 40 };
const pedido = (tracking: string, telefono: string, extra: Record<string, unknown> = {}) => ({ ...GSG, tracking, cliente: `Cliente ${tracking}`, telefono, ...extra });

let a: EscenarioEntregas, b: EscenarioEntregas, servidor: ServidorPlataforma, base: string;
let claveA: string, claveB: string, adminA: string, adminB: string, soloLeer: string, revocada: string;
let tiendas: TiendaRegistrada[];

const nueva = async (esc: EscenarioEntregas, permisos: string[]) => {
  const clave = generarClaveApi();
  const registro = await esc.repos.claves.crear({ nombre: 'GSG Courier', hash: hashClaveApi(clave), prefijo: prefijoDeClave(clave), creadaPor: null, permisos });
  return { clave, registro };
};

beforeAll(async () => {
  a = await crearEscenarioEntregas();
  b = await crearEscenarioEntregas();
  claveA = (await nueva(a, ['entregas:gestionar', 'entregas:leer'])).clave;
  claveB = (await nueva(b, ['entregas:gestionar', 'entregas:leer'])).clave;
  adminA = (await nueva(a, ['*'])).clave;
  adminB = (await nueva(b, ['*'])).clave;
  soloLeer = (await nueva(a, ['entregas:leer'])).clave;
  const rev = await nueva(a, ['entregas:gestionar']);
  revocada = rev.clave;
  await a.repos.claves.revocar(rev.registro.id);
  tiendas = ['tienda-a', 'tienda-b'].map((slug) => ({ id: slug, slug, nombre: slug, estado: 'activa', principal: false, rubro: null, creadaAt: new Date() }));
  const vivas = new Map(tiendas.map((t, i) => [t.slug, { id: t.id, slug: t.slug, app: (i ? b : a).app, repos: (i ? b : a).repos, contexto: { id: t.id, slug: t.slug } } as unknown as TiendaViva]));
  const plataforma = {
    directorio: { tiendas: async () => tiendas } as Directorio,
    tiendaPorSlug: async (slug: string) => tiendas.find(t => t.slug === slug)?.estado === 'suspendida' ? null : vivas.get(slug) ?? null,
    consultarClaveGsg: async (t: TiendaRegistrada, hash: string) => (t.slug === 'tienda-a' ? a : b).repos.claves.porHashConRevocadas!(hash),
    tiendaPrincipal: async () => vivas.get('tienda-b')!,
  } as Plataforma;
  servidor = await crearServidorPlataforma({ plataforma, segura: false });
  await servidor.escuchar(0, '127.0.0.1');
  base = `http://127.0.0.1:${(servidor.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await servidor.cerrar();
  await a.cerrar();
  await b.cerrar();
});

async function pedir(ruta: string, o: { metodo?: string; clave?: string; cuerpo?: unknown; crudo?: string; tienda?: string; tipoContenido?: string | null } = {}) {
  const res = await fetch(base + ruta, {
    method: o.metodo ?? 'POST',
    headers: { ...(o.tipoContenido === null ? {} : { 'content-type': o.tipoContenido ?? 'application/json' }), ...(o.clave ? { 'x-api-key': o.clave } : {}), ...(o.tienda ? { cookie: `gsg_tienda=${o.tienda}` } : {}) },
    body: o.metodo === 'GET' || o.metodo === 'HEAD' || o.metodo === 'DELETE' ? undefined : (o.crudo ?? JSON.stringify(o.cuerpo ?? {})),
  });
  const texto = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(texto);
  } catch {
    json = null;
  }
  return { status: res.status, json, texto, cabeceras: res.headers };
}

/** El cuerpo de error de siempre, sin nada interno. */
function esErrorLimpio(r: { json: any; texto: string }, codigo: string) {
  expect(r.json).toMatchObject({ ok: false, codigo });
  expect(typeof r.json.error).toBe('string');
  expect(r.texto).not.toMatch(/select |insert into|update entregas|\bat .+\.ts:\d+|stack|wak_[A-Za-z0-9]{10}/i);
}

describe('códigos HTTP de POST /api/v1/entregas', () => {
  it('201 con el id real cuando se guarda', async () => {
    const r = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: pedido('ERR-201', '987700001') });
    expect(r.status).toBe(201);
    expect(r.json.ok).toBe(true);
    expect(r.json.creadas[0].id).toBe((await a.entrega('ERR-201'))!.id);
  });

  it('400: faltan campos obligatorios, con el detalle de cada uno', async () => {
    const r = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: { pedidos: [{ tracking: 'ERR-400', telefono: '987700002' }, pedido('ERR-400B', '987700003', { montoCobrar: 'cuarenta' })] } });
    expect(r.status).toBe(400);
    esErrorLimpio(r, 'VALIDACION');
    const campos = (r.json.detalles as Array<{ campo: string; mensaje: string }>).map((d) => d.campo);
    expect(campos).toEqual(expect.arrayContaining(['pedidos[0].cliente', 'pedidos[0].empresa', 'pedidos[0].metodoPago', 'pedidos[0].montoCobrar', 'pedidos[1].montoCobrar']));
    expect(r.json.detalles.find((d: { campo: string }) => d.campo === 'pedidos[0].empresa').mensaje).toMatch(/obligatorio/);
    expect(r.json.detalles.find((d: { campo: string }) => d.campo === 'pedidos[0].empresa')).toMatchObject({ pedido: 1, tracking: 'ERR-400', cliente: null });
    expect(r.json.detalles.find((d: { campo: string }) => d.campo === 'pedidos[1].montoCobrar')).toMatchObject({ pedido: 2, tracking: 'ERR-400B', cliente: 'Cliente ERR-400B' });
    expect(r.json.error).toContain('tracking "ERR-400"');
    expect(r.json.error).toContain('cliente "Cliente ERR-400B"');
    // Nada se guardó (ni el bueno de la misma llamada).
    expect(await a.entrega('ERR-400')).toBeFalsy();
    expect(await a.entrega('ERR-400B')).toBeFalsy();
  });

  it('400: sin tracking lo dice con el nombre que usa GSG', async () => {
    const r = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: { ...GSG, cliente: 'Sin tracking', telefono: '987700004' } });
    expect(r.status).toBe(400);
    expect(r.json.detalles).toEqual(expect.arrayContaining([expect.objectContaining({ campo: 'tracking', mensaje: 'falta (es obligatorio)', pedido: 1, cliente: 'Sin tracking', tracking: null })]));
    expect(r.json.error).toContain('cliente "Sin tracking"');
  });

  it('400: informa los seis obligatorios vacíos sin exigir los campos opcionales', async () => {
    const r = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: { tracking: ' ', cliente: '', telefono: null, empresa: ' ', metodoPago: '', montoCobrar: null } });
    expect(r.status).toBe(400);
    expect(r.json.detalles.map((d: { campo: string }) => d.campo).sort()).toEqual(['cliente', 'empresa', 'metodoPago', 'montoCobrar', 'telefono', 'tracking']);
    expect(r.json.error).toContain('pedido 1');
    for (const d of r.json.detalles) expect(d.mensaje).toBe('falta (es obligatorio)');
  });

  it('201: acepta solo los seis obligatorios y monto cero', async () => {
    const r = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: pedido('ERR-MINIMO', '987700030', { montoCobrar: 0 }) });
    expect(r.status).toBe(201);
    expect((await a.entrega('ERR-MINIMO'))?.datosEnvio?.monto).toBe('0.00');
  });

  it('400: un objeto vacío enumera todos los datos que Luis debe completar', async () => {
    const r = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: {} });
    expect(r.status).toBe(400);
    expect(r.json.detalles.map((d: { campo: string }) => d.campo).sort()).toEqual(['cliente', 'empresa', 'metodoPago', 'montoCobrar', 'telefono', 'tracking']);
    expect(r.json.detalles.every((d: { pedido: number; cliente: unknown; tracking: unknown }) => d.pedido === 1 && d.cliente === null && d.tracking === null)).toBe(true);
  });

  it('400: JSON mal formado', async () => {
    const r = await pedir('/api/v1/entregas', { clave: claveA, crudo: '{"tracking": "X"' });
    expect(r.status).toBe(400);
    esErrorLimpio(r, 'JSON_INVALIDO');
  });

  it('400: todos los pedidos con un teléfono imposible (no se guardó nada)', async () => {
    const r = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: pedido('ERR-TEL', '12') });
    expect(r.status).toBe(400);
    esErrorLimpio(r, 'VALIDACION');
    expect(r.json.detalles[0].campo).toBe('telefono');
  });

  it('400 cuando dos filas repiten referencia pero ninguna se guarda', async () => {
    const r = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: [pedido('ERR-REPETIDO-INVALIDO', '12'), pedido('ERR-REPETIDO-INVALIDO', '12')] });
    expect(r.status).toBe(400);
    esErrorLimpio(r, 'VALIDACION');
    expect(await a.entrega('ERR-REPETIDO-INVALIDO')).toBeFalsy();
  });

  it('201 y después 200 para duplicados guardados, con su id real', async () => {
    const p = pedido('ERR-DUPLICADO-VALIDO', '987700020');
    const primera = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: [p, p] });
    expect(primera.status).toBe(201);
    expect(primera.json.creadas).toHaveLength(1);
    const segunda = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: p });
    expect(segunda.status).toBe(200);
    expect(segunda.json.existentes).toEqual([{ referencia: p.tracking, id: primera.json.creadas[0].id }]);
  });

  it('405 con Allow para métodos no admitidos, sin depender de cookies o de la clave', async () => {
    for (const metodo of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const r = await pedir('/api/v1/entregas?prueba=1', { metodo });
      expect(r.status).toBe(405);
      esErrorLimpio(r, 'METODO_NO_PERMITIDO');
      expect(r.cabeceras.get('allow')).toBe('GET, HEAD, POST');
    }
    const detalle = await pedir('/api/v1/entregas/ERR-201', { metodo: 'PUT', clave: claveA, tienda: 'tienda-a' });
    expect(detalle.status).toBe(405);
    esErrorLimpio(detalle, 'METODO_NO_PERMITIDO');
    expect(detalle.cabeceras.get('allow')?.split(', ')).toEqual(['GET', 'HEAD', 'PATCH', 'DELETE']);
    expect((await pedir('/api/v1/entregas', { metodo: 'GET', clave: soloLeer, tienda: 'tienda-a' })).status).toBe(200);
    expect((await pedir('/api/v1/entregas', { metodo: 'HEAD', clave: soloLeer, tienda: 'tienda-a' })).status).toBe(200);
  });

  it('413 para un cuerpo mayor de 4 MiB, sin guardar pedidos', async () => {
    const r = await pedir('/api/v1/entregas', { clave: claveA, crudo: JSON.stringify({ ...pedido('ERR-413', '987700021'), relleno: 'x'.repeat(4 * 1024 * 1024) }) });
    expect(r.status).toBe(413);
    esErrorLimpio(r, 'CUERPO_DEMASIADO_GRANDE');
    expect(await a.entrega('ERR-413')).toBeFalsy();
  });

  it('415 para formatos ajenos a JSON, después de comprobar la autenticación', async () => {
    for (const tipoContenido of ['text/plain', 'application/xml', 'application/octet-stream', null]) {
      const r = await pedir('/api/v1/entregas', { clave: claveA, tipoContenido, cuerpo: pedido('ERR-415', '987700022') });
      expect(r.status).toBe(415);
      esErrorLimpio(r, 'TIPO_CONTENIDO_NO_SOPORTADO');
    }
    const sinClave = await pedir('/api/v1/entregas', { tipoContenido: 'text/plain', crudo: '{mal' });
    expect(sinClave.status).toBe(401);
    esErrorLimpio(sinClave, 'CLAVE_AUSENTE');
    expect(await a.entrega('ERR-415')).toBeFalsy();
  });

  it('401: sin clave, con una clave que no existe y con una revocada (con WWW-Authenticate)', async () => {
    const sin = await pedir('/api/v1/entregas', { cuerpo: pedido('ERR-401', '987700005') });
    expect(sin.status).toBe(401);
    esErrorLimpio(sin, 'CLAVE_AUSENTE');
    expect(sin.cabeceras.get('www-authenticate')).toMatch(/^ApiKey .*X-API-Key/);
    const mala = await pedir('/api/v1/entregas', { clave: generarClaveApi(), cuerpo: pedido('ERR-401', '987700005') });
    expect(mala.status).toBe(401);
    esErrorLimpio(mala, 'CLAVE_INVALIDA');
    const basura = await pedir('/api/v1/entregas', { clave: 'no-es-una-clave', cuerpo: pedido('ERR-401', '987700005') });
    expect(basura.status).toBe(401);
    esErrorLimpio(basura, 'CLAVE_INVALIDA');
    const rev = await pedir('/api/v1/entregas', { clave: revocada, cuerpo: pedido('ERR-401', '987700005') });
    expect(rev.status).toBe(401);
    esErrorLimpio(rev, 'CLAVE_REVOCADA');
    expect(await a.entrega('ERR-401')).toBeFalsy();
  });

  it('403: clave válida sin permiso para crear (no un 404 ni un 401)', async () => {
    const r = await pedir('/api/v1/entregas', { clave: soloLeer, cuerpo: pedido('ERR-403', '987700006') });
    expect(r.status).toBe(403);
    esErrorLimpio(r, 'SIN_PERMISO');
    expect(r.json.error).toMatch(/entregas:gestionar/);
  });

  it('404: la ruta con nombre de tienda, una ruta que no existe y un pedido que no existe', async () => {
    const pref = await pedir('/tienda/tienda-a/api/v1/entregas', { clave: claveA, cuerpo: pedido('ERR-404', '987700007') });
    expect(pref.status).toBe(404);
    esErrorLimpio(pref, 'RUTA_NO_EXISTE');
    const ruta = await pedir('/api/v1/no-existe', { clave: adminA, tienda: 'tienda-a', metodo: 'GET' });
    expect(ruta.status).toBe(404);
    esErrorLimpio(ruta, 'RUTA_NO_EXISTE');
    const uno = await pedir('/api/v1/entregas/NADA-404', { clave: claveA, tienda: 'tienda-a', metodo: 'GET' });
    expect(uno.status).toBe(404);
    esErrorLimpio(uno, 'NO_EXISTE');
  });

  it('409: una clave registrada en dos tiendas, y cancelar dos veces', async () => {
    const copia = await b.repos.claves.crear({ nombre: 'Copia', hash: hashClaveApi(claveA), prefijo: prefijoDeClave(claveA), creadaPor: null, permisos: ['entregas:gestionar'] });
    const r = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: pedido('ERR-409', '987700008') });
    await b.repos.claves.revocar(copia.id);
    expect(r.status).toBe(409);
    esErrorLimpio(r, 'CLAVE_AMBIGUA');
    await pedir('/api/v1/entregas', { clave: claveA, cuerpo: pedido('ERR-409B', '987700009') });
    expect((await pedir('/api/v1/entregas/ERR-409B', { clave: claveA, tienda: 'tienda-a', metodo: 'DELETE' })).status).toBe(200);
    const otra = await pedir('/api/v1/entregas/ERR-409B', { clave: claveA, tienda: 'tienda-a', metodo: 'DELETE' });
    expect(otra.status).toBe(409);
    esErrorLimpio(otra, 'CONFLICTO');
  });

  it('403: la tienda suspendida no recibe', async () => {
    tiendas[0]!.estado = 'suspendida';
    const r = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: pedido('ERR-SUSP', '987700010') });
    tiendas[0]!.estado = 'activa';
    expect(r.status).toBe(403);
    esErrorLimpio(r, 'TIENDA_SUSPENDIDA');
  });

  it('una suspendida no vuelve válidas claves desconocidas o revocadas', async () => {
    tiendas[0]!.estado = 'suspendida';
    try {
      const desconocida = await pedir('/api/v1/entregas', { clave: generarClaveApi() });
      expect(desconocida.status).toBe(401);
      esErrorLimpio(desconocida, 'CLAVE_INVALIDA');
      const rev = await pedir('/api/v1/entregas', { clave: revocada });
      expect(rev.status).toBe(401);
      esErrorLimpio(rev, 'CLAVE_REVOCADA');
    } finally {
      tiendas[0]!.estado = 'activa';
    }
  });

  it('404 JSON para la API de una tienda inexistente y una plataforma sin principal', async () => {
    const inexistente = await pedir('/tienda/no-existe/api/v1/entregas/NADA', { metodo: 'GET' });
    expect(inexistente.status).toBe(404);
    esErrorLimpio(inexistente, 'RUTA_NO_EXISTE');
    const vacia = await crearServidorPlataforma({ plataforma: {
      directorio: { tiendas: async () => [] }, tiendaPrincipal: async () => null, tiendaPorSlug: async () => null,
    } as unknown as Plataforma, segura: false });
    try {
      await vacia.escuchar(0, '127.0.0.1');
      const res = await fetch(`http://127.0.0.1:${(vacia.server.address() as AddressInfo).port}/api/v1/no-existe`, { headers: { accept: 'text/html' } });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ ok: false, codigo: 'RUTA_NO_EXISTE' });
    } finally {
      await vacia.cerrar();
    }
  });

  it('503 con Retry-After si la base no contesta; 500 sin detalles internos si algo revienta', async () => {
    const original = a.repos.entregas.crearEntrega;
    a.repos.entregas.crearEntrega = async () => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED' });
    };
    const caida = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: pedido('ERR-503', '987700011') });
    a.repos.entregas.crearEntrega = async () => {
      throw Object.assign(new Error("ER_PARSE_ERROR: You have an error in your SQL syntax near 'select * from entregas'"), { code: 'ER_PARSE_ERROR' });
    };
    const rota = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: pedido('ERR-500', '987700012') });
    a.repos.entregas.crearEntrega = original;
    expect(caida.status).toBe(503);
    esErrorLimpio(caida, 'BASE_NO_DISPONIBLE');
    expect(caida.cabeceras.get('retry-after')).toBe('30');
    expect(rota.status).toBe(500);
    esErrorLimpio(rota, 'ERROR_INTERNO');
    expect(rota.texto).not.toMatch(/ER_PARSE_ERROR|SQL syntax/);
    // Ninguno dijo ok:true.
    expect(caida.json.ok).toBe(false);
    expect(rota.json.ok).toBe(false);
  });

  it('503 también si la base de las claves no contesta (no un 401 que haga creer que la clave está mal)', async () => {
    const original = a.repos.claves.porHash;
    const originalR = a.repos.claves.porHashConRevocadas;
    a.repos.claves.porHash = async () => {
      throw Object.assign(new Error('Connection lost: The server closed the connection.'), { code: 'PROTOCOL_CONNECTION_LOST' });
    };
    a.repos.claves.porHashConRevocadas = a.repos.claves.porHash;
    const r = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: pedido('ERR-503B', '987700013') });
    a.repos.claves.porHash = original;
    a.repos.claves.porHashConRevocadas = originalR;
    expect(r.status).toBe(503);
    esErrorLimpio(r, 'BASE_NO_DISPONIBLE');
  });

  it('429 con Retry-After al pasar el tope de la clave', async () => {
    let ultimo: Awaited<ReturnType<typeof pedir>> | null = null;
    for (let i = 0; i < 125; i++) {
      ultimo = await pedir('/api/v1/entregas/NADA', { clave: soloLeer, tienda: 'tienda-a', metodo: 'GET' });
      if (ultimo.status === 429) break;
    }
    expect(ultimo!.status).toBe(429);
    esErrorLimpio(ultimo!, 'DEMASIADAS_PETICIONES');
    expect(Number(ultimo!.cabeceras.get('retry-after'))).toBeGreaterThan(0);
  });

  it('el 402 no se usa: ninguna regla de pago bloquea la recepción', async () => {
    const r = await pedir('/api/v1/entregas', { clave: claveB, cuerpo: pedido('ERR-402', '987700014') });
    expect(r.status).toBe(201);
  });
});

describe('aislamiento entre tiendas en la bandeja de errores', () => {
  it('ninguna tienda ve ni reintenta los pedidos de otra', async () => {
    // Lo que quedó en cola de las pruebas de arriba sale antes: el fallo es para este pedido.
    await a.trabajar();
    const alta = await pedir('/api/v1/entregas', { clave: claveA, cuerpo: pedido('AISLA-1', '987800001') });
    expect(alta.status).toBe(201);
    const id = alta.json.creadas[0].id as number;
    a.wa.failNext = new WhatsAppApiError('(#131026) Message undeliverable', 400, 131026, undefined, false);
    await a.trabajar();
    const deA = await pedir('/admin/entregas/mensajes/errores', { clave: adminA, tienda: 'tienda-a', metodo: 'GET' });
    expect(deA.json.items.map((x: { referencia: string }) => x.referencia)).toEqual(['AISLA-1']);
    // B no lo ve...
    const deB = await pedir('/admin/entregas/mensajes/errores', { clave: adminB, tienda: 'tienda-b', metodo: 'GET' });
    expect(deB.status).toBe(200);
    expect(deB.json.items.map((x: { referencia: string }) => x.referencia)).not.toContain('AISLA-1');
    // ...ni lo puede reintentar por su id.
    const desdeB = await pedir(`/admin/entregas/${id}/mensaje/reintentar`, { clave: adminB, tienda: 'tienda-b', cuerpo: {} });
    expect(desdeB.status).toBe(404);
    esErrorLimpio(desdeB, 'NO_EXISTE');
    // La clave de A tampoco entra en el panel de B.
    const cruzada = await pedir(`/admin/entregas/${id}/mensaje/reintentar`, { clave: adminA, tienda: 'tienda-b', cuerpo: {} });
    expect(cruzada.status).toBe(401);
    // Sin sesion ni clave, nadie.
    expect((await pedir(`/admin/entregas/${id}/mensaje/reintentar`, { tienda: 'tienda-a', cuerpo: {} })).status).toBe(401);
    // Una clave acotada (sin '*') no entra al panel: 403.
    expect((await pedir(`/admin/entregas/${id}/mensaje/reintentar`, { clave: claveA, tienda: 'tienda-a', cuerpo: {} })).status).toBe(403);
    // El de A sigue igual.
    expect((await a.repos.entregas.entrega(id))!.mensajeEstado).toBe('fallido');
    // Y A sí puede.
    const desdeA = await pedir(`/admin/entregas/${id}/mensaje/reintentar`, { clave: adminA, tienda: 'tienda-a', cuerpo: {} });
    expect(desdeA.status).toBe(200);
    expect(desdeA.json.ok).toBe(true);
  });
});
