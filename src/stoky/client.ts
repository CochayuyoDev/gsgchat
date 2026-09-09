/**
 * Lo que este sistema le pregunta a Stoky.
 *
 * Stoky es donde vive el catálogo: los precios, el stock y los clientes. Aquí
 * no se copia nada de eso —una copia se queda vieja el día que alguien sube un
 * precio— sino que se consulta en el momento y se cachea unos minutos.
 *
 * Se entra por la API de tiendas que Stoky ya tenía (`/api/v1`), con un token
 * `stk_…` de una conexión suya. No se inventó un camino nuevo a propósito: esa
 * API ya autentica, ya acota por tienda y almacén, y ya limita el ritmo.
 *
 *   php scripts/conexion-whatsapp.php <tienda>    (en el proyecto de Stoky)
 *
 * Sin STOKY_URL y STOKY_TOKEN, todo lo de aquí se comporta como si no hubiera
 * catálogo: el asistente sigue funcionando y simplemente no cotiza precios.
 */

import { TtlCache } from '../util/cache.js';

export interface ProductoStoky {
  sku: string;
  /** Nombre con su variante: "Zapato de vestir — NEGRO / 40". */
  name: string;
  /** Nombre del producto base, sin la variante. */
  product: string | null;
  price: number | null;
  stock: number;
}

export interface ConsultaCatalogo {
  /** Lo que pidió y está disponible. */
  disponibles: ProductoStoky[];
  /** Lo que pidió pero se agotó. Lleva precio: preguntó cuánto cuesta. */
  agotados: ProductoStoky[];
  /** Otras cosas CON stock que se le parecen. Vacío si no hay ninguna. */
  similares: ProductoStoky[];
}

export interface StokyClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Cuánto vale un catálogo ya traído. Por defecto cinco minutos. */
  ttlMs?: number;
}

export class StokyError extends Error {
  constructor(
    message: string,
    readonly step: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'StokyError';
  }
}

/**
 * Las formas de una palabra que valen como la misma.
 *
 * El cliente escribe "zapatos" y el catálogo dice "Zapato": sin esto, la
 * pregunta más normal del mundo no encuentra su producto. No es un lematizador
 * —no hace falta— sino las dos terminaciones de plural del español, y solo
 * mientras lo que quede siga siendo una palabra (para no convertir "mes" en
 * "m" y hacer que case con todo).
 */
export function formasDe(palabra: string): string[] {
  const formas = new Set([palabra]);
  for (const sufijo of ['es', 's']) {
    if (palabra.endsWith(sufijo)) {
      const raiz = palabra.slice(0, -sufijo.length);
      if (raiz.length >= 3) formas.add(raiz);
    }
  }
  // Y al revés: quien escribe "zapato" también encuentra "zapatos".
  formas.add(`${palabra}s`);
  formas.add(`${palabra}es`);
  return [...formas];
}

/**
 * Las palabras de la consulta que valen para buscar.
 *
 * Las de menos de tres letras casan con todo y no dicen nada de lo que quiere
 * el cliente ("de", "el", "un").
 */
export function palabrasDe(consulta: string): string[] {
  return normaliza(consulta)
    .split(' ')
    .filter((p) => p.length >= 3);
}

/** Si el producto contiene TODAS las palabras que pidió el cliente. */
export function coincideDelTodo(producto: ProductoStoky, consulta: string): boolean {
  const texto = normaliza(`${producto.name} ${producto.product ?? ''} ${producto.sku}`);
  const palabras = palabrasDe(consulta).filter((p) => !RUIDO.has(p));
  if (!palabras.length) return false;
  return palabras.every((p) => formasDe(p).some((f) => texto.includes(f)));
}

/* eslint-disable no-use-before-define */
/**
 * Palabras que aparecen en la pregunta y no describen el producto.
 *
 * Sin esta lista, "cuanto cuesta el zapato negro" no coincidiría "del todo"
 * con ningún producto —porque ninguno se llama "cuanto"— y toda respuesta
 * saldría marcada como aproximada.
 */
const RUIDO = new Set([
  'cuanto', 'cuesta', 'cuestan', 'precio', 'precios', 'vale', 'valen', 'tienen', 'tienes',
  'hay', 'para', 'por', 'con', 'del', 'los', 'las', 'una', 'uno', 'que', 'esta', 'este',
  'quiero', 'busco', 'necesito', 'venden', 'talla', 'color',
]);

export interface StokyClient {
  /** Si la conexión está viva y a qué tienda apunta. */
  ping(): Promise<{ ok: boolean; tenant?: string; warehouse?: string; detail?: string }>;
  /** El catálogo entero, cacheado. */
  productos(): Promise<ProductoStoky[]>;
  /** Los que casan con lo que escribió el cliente, mejor primero. */
  buscar(texto: string, limite?: number): Promise<ProductoStoky[]>;
  /**
   * Lo que hay, lo que se agotó y qué ofrecer en su lugar.
   *
   * Separa las tres cosas porque al cliente se le dicen distinto: lo que hay
   * se ofrece, lo agotado se avisa con su precio —saber cuánto cuesta le sirve
   * igual— y lo parecido solo se menciona si de verdad existe. Recomendar por
   * recomendar, cuando no hay nada que se le parezca, es peor que decir que no
   * hay: el cliente pierde el tiempo mirando algo que no quería.
   */
  consultar(texto: string): Promise<ConsultaCatalogo>;
  /**
   * Trae el catálogo antes de que nadie pregunte.
   *
   * Se llama al arrancar: así el primer cliente del día no espera a que se
   * cargue, y si Stoky está caído se sabe en la consola y no en mitad de una
   * conversación.
   */
  precargar(): Promise<{ ok: boolean; total: number; detail?: string }>;
}

const normaliza = (texto: string): string =>
  texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Los signos pegados a la palabra la vuelven otra distinta: "negro?" no
    // casaba con "negro", y casi toda pregunta termina en signo.
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ');

/**
 * Cuánto casa un producto con lo que escribió el cliente.
 *
 * Se puntúa en vez de filtrar porque quien pregunta "cuánto está el zapato
 * negro" no escribe el nombre exacto del catálogo. Cero significa que no
 * aparece ninguna de sus palabras y no se ofrece.
 */
/** Debajo de esto, una palabra solo cuenta si aparece entera. */
const MINIMO_PARA_BUSCAR_DENTRO = 5;

export function puntuar(producto: ProductoStoky, consulta: string): number {
  const texto = normaliza(`${producto.name} ${producto.product ?? ''} ${producto.sku}`);
  const palabras = palabrasDe(consulta).filter((p) => !RUIDO.has(p));

  if (!palabras.length) return 0;

  const sueltas = new Set(texto.split(' '));

  let puntos = 0;
  for (const palabra of palabras) {
    const formas = formasDe(palabra);

    if (formas.some((f) => sueltas.has(f))) {
      puntos += 12;
      continue;
    }

    // Una palabra corta DENTRO de otra es casi siempre casualidad: "las"
    // aparece en "clasico", y con eso preguntar por unas zapatillas devolvia
    // un pantalon. Solo las largas valen como fragmento.
    if (palabra.length >= MINIMO_PARA_BUSCAR_DENTRO && formas.some((f) => texto.includes(f))) {
      puntos += 8;
    }
  }
  if (!puntos) return 0;

  // El SKU exacto manda sobre cualquier coincidencia de palabras: quien lo
  // escribe sabe exactamente lo que quiere.
  if (normaliza(producto.sku) === normaliza(consulta)) puntos += 100;
  // Con stock antes que sin stock: ofrecer lo agotado es hacer perder el viaje.
  if (producto.stock > 0) puntos += 3;

  return puntos;
}

export function createStokyClient(opts: StokyClientOptions): StokyClient {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  // Un catálogo por cliente: la clave da igual, lo que importa es la caducidad.
  const cache = new TtlCache<ProductoStoky[]>(opts.ttlMs ?? 5 * 60 * 1000, 4);

  /**
   * El último catálogo que llegó bien, sin caducidad.
   *
   * Es el que se sirve cuando Stoky no responde: unos precios de hace media
   * hora son incomparablemente mejores que dejar al cliente sin respuesta
   * porque el otro sistema se está reiniciando. Solo se queda sin nada si
   * Stoky nunca llegó a contestar desde que arrancó esto.
   */
  let ultimoBueno: ProductoStoky[] | null = null;

  /** Una sola recarga a la vez: diez clientes a la vez no piden diez veces. */
  let cargando: Promise<ProductoStoky[]> | null = null;

  async function pedir<T>(path: string, step: string): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${opts.token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      throw new StokyError(
        `no se pudo contactar con Stoky en ${base}: ${error instanceof Error ? error.message : String(error)}`,
        step,
      );
    }

    const texto = await response.text();
    const payload = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};

    if (!response.ok) {
      const detalle =
        (typeof payload.message === 'string' && payload.message) ||
        (typeof payload.error === 'string' && payload.error) ||
        `HTTP ${response.status}`;
      throw new StokyError(detalle, step, response.status);
    }

    return payload as T;
  }

  return {
    async ping() {
      try {
        const r = await pedir<{ ok?: boolean; tenant?: string; warehouse?: string }>(
          '/api/v1/ping',
          'comprobar la conexion',
        );
        return { ok: r.ok !== false, tenant: r.tenant, warehouse: r.warehouse };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },

    async productos() {
      const guardado = cache.get('catalogo');
      if (guardado) return guardado;

      if (!cargando) {
        cargando = pedir<{ data?: ProductoStoky[] }>('/api/v1/products', 'pedir el catalogo')
          .then((r) => {
            const productos = (r.data ?? []).map((p) => ({
              sku: String(p.sku ?? ''),
              name: String(p.name ?? ''),
              product: p.product ?? null,
              price: p.price == null ? null : Number(p.price),
              stock: Number(p.stock ?? 0),
            }));
            cache.set('catalogo', productos);
            ultimoBueno = productos;
            return productos;
          })
          .finally(() => {
            cargando = null;
          });
      }

      try {
        return await cargando;
      } catch (error) {
        // Con algo guardado se responde con eso; sin nada, que lo vea quien
        // llamó y decida (el asistente sigue sin cotizar, no se cae).
        if (ultimoBueno) return ultimoBueno;
        throw error;
      }
    },

    async precargar() {
      try {
        const productos = await this.productos();
        return { ok: true, total: productos.length };
      } catch (error) {
        return {
          ok: false,
          total: 0,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async consultar(texto) {
      const todos = await this.productos().catch(() => [] as ProductoStoky[]);

      const casan = todos
        .map((producto) => ({ producto, puntos: puntuar(producto, texto) }))
        .filter((x) => x.puntos > 0)
        .sort((a, b) => b.puntos - a.puntos);

      if (!casan.length) return { disponibles: [], agotados: [], similares: [] };

      const conStock = casan.filter((x) => x.producto.stock > 0);
      const sinStock = casan.filter((x) => x.producto.stock <= 0);

      // Lo que decide es la PUNTUACION, no el stock. Si lo que mejor casa con
      // lo que pidio esta agotado, hay que decirselo: contestar con otra cosa
      // que casa peor -aunque la haya- es no responder a lo que pregunto.
      const mejorConStock = conStock[0]?.puntos ?? 0;
      const mejorSinStock = sinStock[0]?.puntos ?? 0;

      if (mejorConStock >= mejorSinStock) {
        return {
          disponibles: conStock.slice(0, 3).map((x) => x.producto),
          agotados: [],
          similares: [],
        };
      }

      // Lo que pidio esta agotado. Lo parecido son los que SI hay, empezando
      // por el que mas se le parece; si no hay ninguno, no se ofrece nada.
      const agotados = sinStock
        .filter((x) => x.puntos === mejorSinStock)
        .slice(0, 3)
        .map((x) => x.producto);

      return {
        disponibles: [],
        agotados,
        similares: conStock.slice(0, 3).map((x) => x.producto),
      };
    },

    async buscar(texto, limite = 3) {
      let productos: ProductoStoky[];
      try {
        productos = await this.productos();
      } catch {
        // Sin catálogo no hay precios que dar, pero la conversación sigue.
        return [];
      }

      return productos
        .map((producto) => ({ producto, puntos: puntuar(producto, texto) }))
        .filter((x) => x.puntos > 0)
        .sort((a, b) => b.puntos - a.puntos)
        .slice(0, limite)
        .map((x) => x.producto);
    },
  };
}
