/**
 * El catálogo de Stoky.
 *
 * Lo que se prueba aquí es la búsqueda, porque es lo que decide qué precio ve
 * el cliente. Un empate mal resuelto no falla: contesta con seguridad el
 * precio del producto equivocado, que es peor que no contestar.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  coincideDelTodo,
  createStokyClient,
  formasDe,
  palabrasDe,
  puntuar,
  type ProductoStoky,
} from '../src/stoky/client.js';

const producto = (overrides: Partial<ProductoStoky> = {}): ProductoStoky => ({
  sku: 'ALIP-001-NEG-40',
  name: 'Zapato de vestir clásico — NEGRO / 40',
  product: 'Zapato de vestir clásico',
  price: 189.9,
  stock: 9,
  ...overrides,
});

const CATALOGO: ProductoStoky[] = [
  producto({ sku: 'ALIP-001-MAR-38', name: 'Zapato de vestir clásico — MARRON / 38' }),
  producto({ sku: 'ALIP-001-MAR-40', name: 'Zapato de vestir clásico — MARRON / 40' }),
  producto({ sku: 'ALIP-001-NEG-38', name: 'Zapato de vestir clásico — NEGRO / 38' }),
  producto({ sku: 'ALIP-001-NEG-40', name: 'Zapato de vestir clásico — NEGRO / 40' }),
  producto({ sku: 'ALIP-009-AZU-M', name: 'Casaca impermeable — AZUL / M', product: 'Casaca impermeable', price: 249 }),
];

/** Un catálogo servido como lo sirve Stoky. */
function clienteFalso(productos = CATALOGO) {
  const llamadas: string[] = [];
  const impl = vi.fn(async (url: string | URL | Request) => {
    llamadas.push(String(url));
    if (String(url).includes('/ping')) {
      return new Response(JSON.stringify({ ok: true, tenant: 'alip', warehouse: 'Principal' }));
    }
    return new Response(JSON.stringify({ data: productos }));
  }) as unknown as typeof fetch;

  return {
    llamadas,
    cliente: createStokyClient({ baseUrl: 'http://stoky.local', token: 'stk_test', fetchImpl: impl }),
  };
}

describe('puntuar una coincidencia', () => {
  it('el signo de interrogación no puede cambiar la palabra', () => {
    // Casi toda pregunta acaba en signo: si "negro?" no casa con "negro", la
    // búsqueda falla justo en el caso normal.
    const negro = producto();
    const marron = producto({ sku: 'ALIP-001-MAR-40', name: 'Zapato de vestir clásico — MARRON / 40' });

    expect(puntuar(negro, 'cuanto cuesta el zapato negro?')).toBeGreaterThan(
      puntuar(marron, 'cuanto cuesta el zapato negro?'),
    );
  });

  it('las tildes tampoco', () => {
    expect(puntuar(producto(), 'zapato clasico')).toBeGreaterThan(0);
    expect(puntuar(producto(), 'zapato clásico')).toBeGreaterThan(0);
  });

  it('la palabra suelta vale más que encontrarla dentro de otra', () => {
    const suelta = producto({ name: 'Casaca AZUL / M' });
    const dentro = producto({ name: 'Casacazul de temporada' });
    expect(puntuar(suelta, 'casaca azul')).toBeGreaterThan(puntuar(dentro, 'casaca azul'));
  });

  it('lo que hay en stock se ofrece antes que lo agotado', () => {
    const hay = producto({ stock: 5 });
    const agotado = producto({ stock: 0 });
    expect(puntuar(hay, 'zapato de vestir')).toBeGreaterThan(puntuar(agotado, 'zapato de vestir'));
  });

  it('el SKU exacto manda sobre cualquier coincidencia de palabras', () => {
    const porSku = puntuar(producto(), 'ALIP-001-NEG-40');
    const porPalabras = puntuar(producto(), 'zapato de vestir clasico negro');
    expect(porSku).toBeGreaterThan(porPalabras);
  });

  it('sin ninguna palabra en común no se ofrece nada', () => {
    expect(puntuar(producto(), 'cuanto cuesta mandar un paquete')).toBe(0);
  });

  it('las palabras de dos letras no cuentan: casarían con todo', () => {
    expect(puntuar(producto(), 'de la el')).toBe(0);
  });
});

describe('buscar en el catálogo', () => {
  it('devuelve los mejores primero y no más de los pedidos', async () => {
    const { cliente } = clienteFalso();
    const encontrados = await cliente.buscar('zapato negro 40', 2);

    expect(encontrados).toHaveLength(2);
    expect(encontrados[0]?.name).toContain('NEGRO');
  });

  it('una pregunta de envío no devuelve productos', async () => {
    const { cliente } = clienteFalso();
    // Es lo que separa "cuánto cuesta el zapato" de "cuánto cuesta el envío":
    // si esto devolviera algo, cotizar un envío contestaría con un zapato.
    expect(await cliente.buscar('cuanto cuesta mandar un paquete a Miraflores')).toEqual([]);
  });

  it('el catálogo se pide una sola vez mientras esté fresco', async () => {
    const { cliente, llamadas } = clienteFalso();
    await cliente.buscar('zapato');
    await cliente.buscar('casaca');
    await cliente.productos();

    expect(llamadas.filter((u) => u.includes('/products'))).toHaveLength(1);
  });

  it('el token viaja en la cabecera, no en la URL', async () => {
    const vistas: Array<{ url: string; auth: string | null }> = [];
    const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      vistas.push({ url: String(url), auth: headers.get('authorization') });
      return new Response(JSON.stringify({ data: [] }));
    }) as unknown as typeof fetch;

    await createStokyClient({ baseUrl: 'http://stoky.local', token: 'stk_test', fetchImpl: impl }).productos();

    expect(vistas[0]?.auth).toBe('Bearer stk_test');
    expect(vistas[0]?.url).not.toContain('stk_test');
  });
});

describe('cuando Stoky no responde', () => {
  it('el ping lo dice en vez de lanzar', async () => {
    const impl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const estado = await createStokyClient({
      baseUrl: 'http://stoky.local',
      token: 'stk_test',
      fetchImpl: impl,
    }).ping();

    expect(estado.ok).toBe(false);
    expect(estado.detail).toContain('no se pudo contactar');
  });

  it('un token revocado se explica con lo que dijo Stoky', async () => {
    const impl = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'token revocado' }), { status: 401 }),
    ) as unknown as typeof fetch;

    await expect(
      createStokyClient({ baseUrl: 'http://stoky.local', token: 'stk_viejo', fetchImpl: impl }).productos(),
    ).rejects.toThrow(/token revocado/);
  });
});

/**
 * Lo que pidió, o solo lo más parecido.
 *
 * Es el fallo caro de una cotización automática: contestar "Casaca de cuero"
 * con el mismo aplomo a quien preguntó por una impermeable. El cliente cree
 * que le cotizaron lo suyo, y el error se descubre en la entrega.
 */
describe('distinguir lo exacto de lo parecido', () => {
  it('coincide del todo cuando están todas las palabras del producto', () => {
    expect(coincideDelTodo(producto(), 'zapato de vestir negro')).toBe(true);
    expect(coincideDelTodo(producto(), 'zapato clasico')).toBe(true);
  });

  it('no coincide si falta alguna: es lo parecido, no lo pedido', () => {
    const casaca = producto({
      sku: 'ALIP-009-MAR-M',
      name: 'Casaca de cuero sintético — MARRON / M',
      product: 'Casaca de cuero sintético',
    });
    expect(coincideDelTodo(casaca, 'casaca impermeable')).toBe(false);
    expect(coincideDelTodo(casaca, 'casaca de cuero')).toBe(true);
  });

  it('las palabras de la pregunta no cuentan como parte del producto', () => {
    // Sin quitar "cuanto" y "cuesta", ninguna respuesta sería nunca exacta y
    // todas saldrían marcadas como aproximadas: el aviso dejaría de significar.
    expect(coincideDelTodo(producto(), 'cuanto cuesta el zapato negro')).toBe(true);
    expect(coincideDelTodo(producto(), 'que precio tienen los zapatos de vestir')).toBe(true);
  });

  it('una consulta sin palabras útiles no coincide con nada', () => {
    expect(coincideDelTodo(producto(), 'cuanto cuesta')).toBe(false);
    expect(coincideDelTodo(producto(), '???')).toBe(false);
  });

  it('las palabras que importan se separan de las que no', () => {
    expect(palabrasDe('cuanto cuesta el zapato negro?')).toContain('zapato');
    expect(palabrasDe('cuanto cuesta el zapato negro?')).not.toContain('el');
  });
});

describe('cuando Stoky se cae a mitad del dia', () => {
  it('se sigue respondiendo con el ultimo catalogo que llego bien', async () => {
    let vivo = true;
    const impl = vi.fn(async () => {
      if (!vivo) throw new Error('ECONNREFUSED');
      return new Response(JSON.stringify({ data: CATALOGO }));
    }) as unknown as typeof fetch;

    // ttl de 0 para que el segundo intento tenga que volver a pedirlo.
    const cliente = createStokyClient({
      baseUrl: 'http://stoky.local',
      token: 'stk_test',
      fetchImpl: impl,
      ttlMs: 0,
    });

    expect(await cliente.buscar('zapato')).not.toHaveLength(0);

    vivo = false;
    // Unos precios de hace un rato valen infinitamente mas que dejar al
    // cliente sin respuesta porque el otro sistema se esta reiniciando.
    expect(await cliente.buscar('zapato')).not.toHaveLength(0);
  });

  it('sin nada guardado, buscar devuelve vacio en vez de tumbar la conversacion', async () => {
    const impl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const cliente = createStokyClient({ baseUrl: 'http://x', token: 'stk', fetchImpl: impl });
    expect(await cliente.buscar('zapato')).toEqual([]);
  });

  it('diez clientes a la vez piden el catalogo una sola vez', async () => {
    let peticiones = 0;
    const impl = vi.fn(async () => {
      peticiones++;
      await new Promise((r) => setTimeout(r, 10));
      return new Response(JSON.stringify({ data: CATALOGO }));
    }) as unknown as typeof fetch;

    const cliente = createStokyClient({ baseUrl: 'http://x', token: 'stk', fetchImpl: impl });
    await Promise.all(Array.from({ length: 10 }, () => cliente.buscar('zapato')));

    expect(peticiones).toBe(1);
  });

  it('precargar dice si hubo catalogo, sin lanzar', async () => {
    const impl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const estado = await createStokyClient({ baseUrl: 'http://x', token: 'stk', fetchImpl: impl }).precargar();
    expect(estado.ok).toBe(false);
    expect(estado.total).toBe(0);
  });
});

describe('el cliente escribe en plural y el catalogo en singular', () => {
  it('"zapatos" encuentra "Zapato"', () => {
    expect(coincideDelTodo(producto(), 'zapatos de vestir')).toBe(true);
    expect(puntuar(producto(), 'zapatos')).toBeGreaterThan(0);
  });

  it('y al reves: "casaca" encuentra "Casacas"', () => {
    const casacas = producto({ name: 'Casacas de temporada — AZUL / M', product: 'Casacas de temporada' });
    expect(puntuar(casacas, 'casaca azul')).toBeGreaterThan(0);
  });

  it('no se recorta tanto que empiece a casar con cualquier cosa', () => {
    // "mes" no puede convertirse en "m": casaria con media tienda.
    expect(formasDe('mes')).not.toContain('m');
  });
});
