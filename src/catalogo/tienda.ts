/**
 * El catalogo real de la tienda, para que el asistente hable de productos
 * que existen, con su precio y su stock de ahora mismo.
 *
 * Se lee de una URL que la tienda pone en "Mi asistente IA" (su API de
 * productos) y se cachea cinco minutos. Se entienden tres formas:
 *
 *  - la de la tienda de Elysian (Next + Nest): `{ items: [...] }` paginado,
 *    con `variants[{sku, price, salePrice, stock}]`, `images[{url}]` y `slug`;
 *  - una lista simple: `[{ sku, nombre, precio, stock, url?, imagen? }]` (o
 *    con los nombres en ingles: name, price, stock, url, image);
 *  - WooCommerce Store API (`/wp-json/wc/store/v1/products`): `id, name,
 *    prices.price (centimos), is_in_stock, permalink, images[0].src`.
 *
 * Sale con la misma forma que el catalogo de Stoky (`StokyClient`), asi que
 * el asistente y la preventa lo usan sin saber de donde viene.
 */

import { TtlCache } from '../util/cache.js';
import { puntuar, type ConsultaCatalogo, type ProductoStoky, type StokyClient } from '../stoky/client.js';

export interface ProductoTienda extends ProductoStoky {
  /** Enlace a la ficha, para que el asistente lo mande. */
  url: string | null;
  imagen: string | null;
  /** Precio antes de la oferta, si la hay. */
  precioNormal: number | null;
}

export type FormatoCatalogo = 'auto' | 'elysian' | 'simple' | 'woocommerce';

const texto = (v: unknown): string => (v == null ? '' : String(v)).trim();
const numero = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const absoluta = (url: string | null, base: string): string | null => {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
};

/** De donde salen los enlaces relativos: el origen de la URL del catalogo. */
function origenDe(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

export function detectarFormato(cuerpo: unknown): FormatoCatalogo {
  const arr = Array.isArray(cuerpo) ? cuerpo : (cuerpo as { items?: unknown[] })?.items;
  const primero = (Array.isArray(arr) ? arr[0] : null) as Record<string, unknown> | null;
  if (!primero) return 'simple';
  if (Array.isArray(primero.variants) && 'slug' in primero) return 'elysian';
  if (primero.prices && typeof primero.prices === 'object' && 'permalink' in primero) return 'woocommerce';
  return 'simple';
}

/** Convierte lo que devuelve la tienda en productos con precio y stock. */
export function leerCatalogo(cuerpo: unknown, opts: { formato?: FormatoCatalogo; base: string }): ProductoTienda[] {
  const formato = opts.formato && opts.formato !== 'auto' ? opts.formato : detectarFormato(cuerpo);
  const arr = (Array.isArray(cuerpo) ? cuerpo : ((cuerpo as { items?: unknown[]; data?: unknown[]; products?: unknown[] })?.items ?? (cuerpo as { data?: unknown[] })?.data ?? (cuerpo as { products?: unknown[] })?.products ?? [])) as Array<Record<string, unknown>>;
  const salida: ProductoTienda[] = [];

  for (const p of arr) {
    if (p.active === false) continue;
    if (formato === 'elysian') {
      const nombre = texto(p.name);
      const marca = texto((p.brand as { name?: unknown } | undefined)?.name);
      const url = p.slug ? absoluta(`/producto/${texto(p.slug)}`, opts.base) : null;
      const imagen = absoluta(texto((p.images as Array<{ url?: unknown }> | undefined)?.[0]?.url) || null, opts.base);
      const variantes = (Array.isArray(p.variants) ? p.variants : []) as Array<Record<string, unknown>>;
      for (const v of variantes) {
        if (v.active === false) continue;
        const oferta = numero(v.salePrice);
        const normal = numero(v.price);
        const nombreVariante = texto(v.name);
        salida.push({
          sku: texto(v.sku) || `${p.id}-${v.id}`,
          // Algunas tiendas ya llevan la variante en el nombre del producto: no se repite.
          name: nombreVariante && !nombre.toLowerCase().includes(nombreVariante.toLowerCase()) ? `${nombre} — ${nombreVariante}` : nombre,
          product: marca ? `${nombre} (${marca})` : nombre,
          price: oferta ?? normal,
          precioNormal: oferta != null && normal != null && normal > oferta ? normal : null,
          stock: Number(v.stock ?? 0) || 0,
          url,
          imagen,
        });
      }
      continue;
    }
    if (formato === 'woocommerce') {
      const precios = (p.prices ?? {}) as { price?: unknown; regular_price?: unknown; currency_minor_unit?: unknown };
      const menor = Number(precios.currency_minor_unit ?? 2);
      const div = 10 ** (Number.isFinite(menor) ? menor : 2);
      const precio = numero(precios.price);
      const regular = numero(precios.regular_price);
      salida.push({
        sku: texto(p.sku) || texto(p.id),
        name: texto(p.name),
        product: texto(p.name),
        price: precio != null ? precio / div : null,
        precioNormal: regular != null && precio != null && regular > precio ? regular / div : null,
        stock: p.is_in_stock === false ? 0 : Number((p as { stock_quantity?: unknown }).stock_quantity ?? 1) || 1,
        url: absoluta(texto(p.permalink) || null, opts.base),
        imagen: absoluta(texto((p.images as Array<{ src?: unknown }> | undefined)?.[0]?.src) || null, opts.base),
      });
      continue;
    }
    // simple
    const nombre = texto(p.nombre ?? p.name);
    if (!nombre) continue;
    const precio = numero(p.precio ?? p.price);
    const normal = numero(p.precioNormal ?? p.precio_normal ?? p.regularPrice);
    salida.push({
      sku: texto(p.sku ?? p.id) || nombre,
      name: nombre,
      product: texto(p.producto ?? p.product) || nombre,
      price: precio,
      precioNormal: normal != null && precio != null && normal > precio ? normal : null,
      stock: p.stock == null ? 1 : Number(p.stock) || 0,
      url: absoluta(texto(p.url ?? p.enlace ?? p.link) || null, opts.base),
      imagen: absoluta(texto(p.imagen ?? p.image ?? p.foto) || null, opts.base),
    });
  }
  return salida;
}

export interface OpcionesCatalogoTienda {
  url: string;
  formato?: FormatoCatalogo;
  /** Cabeceras extra (una clave de la tienda, si la pide). */
  cabeceras?: Record<string, string>;
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  /** Cuantas paginas se siguen como mucho (Elysian pagina de 24). */
  maxPaginas?: number;
}

export interface CatalogoTienda extends StokyClient {
  /** Los productos con enlace e imagen: lo que el asistente puede mandar. */
  productosTienda(): Promise<ProductoTienda[]>;
  porSku(sku: string): Promise<ProductoTienda | null>;
  /** Lo que se le cuenta al modelo sobre lo que pregunto el cliente. */
  contextoPara(texto: string, limite?: number): Promise<string | null>;
}

/** El texto que ve el modelo por cada producto. */
export function lineaDeProducto(p: ProductoTienda): string {
  const precio = p.price != null ? `${p.price}${p.precioNormal != null ? ` (antes ${p.precioNormal})` : ''}` : 'precio a confirmar';
  return `- ${p.name} [${p.sku}]: ${precio}${p.stock > 0 ? ` · stock ${p.stock}` : ' · AGOTADO'}${p.url ? ` · ${p.url}` : ''}`;
}

export function crearCatalogoTienda(opts: OpcionesCatalogoTienda): CatalogoTienda {
  const doFetch = opts.fetchImpl ?? fetch;
  const cache = new TtlCache<ProductoTienda[]>(opts.ttlMs ?? 5 * 60 * 1000, 2);
  const base = origenDe(opts.url);
  let ultimoBueno: ProductoTienda[] | null = null;
  let cargando: Promise<ProductoTienda[]> | null = null;

  async function pagina(n: number): Promise<{ productos: ProductoTienda[]; totalPaginas: number }> {
    const u = new URL(opts.url);
    if (n > 1) u.searchParams.set('page', String(n));
    const r = await doFetch(u.toString(), { headers: { accept: 'application/json', ...(opts.cabeceras ?? {}) }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`la tienda respondio ${r.status}`);
    const cuerpo = (await r.json()) as { totalPages?: unknown };
    const totalPaginas = Number(cuerpo?.totalPages ?? 1) || 1;
    return { productos: leerCatalogo(cuerpo, { formato: opts.formato, base }), totalPaginas };
  }

  async function cargar(): Promise<ProductoTienda[]> {
    const primera = await pagina(1);
    const todos = [...primera.productos];
    const max = Math.min(primera.totalPaginas, opts.maxPaginas ?? 20);
    for (let n = 2; n <= max; n++) todos.push(...(await pagina(n)).productos);
    return todos;
  }

  async function productosTienda(): Promise<ProductoTienda[]> {
    const guardado = cache.get('catalogo');
    if (guardado) return guardado;
    cargando ??= cargar()
      .then((p) => {
        cache.set('catalogo', p);
        ultimoBueno = p;
        return p;
      })
      .finally(() => {
        cargando = null;
      });
    try {
      return await cargando;
    } catch (error) {
      if (ultimoBueno) return ultimoBueno;
      throw error;
    }
  }

  const buscarTienda = async (texto: string, limite = 5): Promise<ProductoTienda[]> => {
    let todos: ProductoTienda[];
    try {
      todos = await productosTienda();
    } catch {
      return [];
    }
    return todos
      .map((producto) => ({ producto, puntos: puntuar(producto, texto) }))
      .filter((x) => x.puntos > 0)
      .sort((a, b) => b.puntos - a.puntos)
      .slice(0, limite)
      .map((x) => x.producto);
  };

  return {
    async ping() {
      try {
        const p = await productosTienda();
        return { ok: true, detail: `${p.length} productos` };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
    productos: () => productosTienda(),
    productosTienda,
    async precargar() {
      try {
        return { ok: true, total: (await productosTienda()).length };
      } catch (error) {
        return { ok: false, total: 0, detail: error instanceof Error ? error.message : String(error) };
      }
    },
    buscar: (texto, limite) => buscarTienda(texto, limite),
    async consultar(texto): Promise<ConsultaCatalogo> {
      const casan = await buscarTienda(texto, 8);
      const disponibles = casan.filter((p) => p.stock > 0).slice(0, 4);
      const agotados = casan.filter((p) => p.stock <= 0).slice(0, 3);
      return { disponibles, agotados: disponibles.length ? [] : agotados, similares: [], otrasVariantes: [] };
    },
    async porSku(sku) {
      const s = sku.trim().toLowerCase();
      return (await productosTienda().catch(() => [] as ProductoTienda[])).find((p) => p.sku.toLowerCase() === s) ?? null;
    },
    async contextoPara(texto, limite = 6) {
      const encontrados = await buscarTienda(texto, limite);
      return encontrados.length ? encontrados.map(lineaDeProducto).join('\n') : null;
    },
  };
}
