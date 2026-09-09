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
  /**
   * Las otras presentaciones del MISMO producto que sí hay.
   *
   * Es distinto de `similares`: aquí no se le ofrece otra cosa, se le ofrece
   * lo mismo en otro color o en otra talla, que es lo que suele resolver la
   * venta. Vacío cuando el producto no tiene variantes, o cuando ninguna
   * queda.
   */
  otrasVariantes: ProductoStoky[];
}

/**
 * La parte del nombre que distingue una variante: "NEGRO / 40".
 *
 * Stoky manda el nombre completo ("Zapato de vestir — NEGRO / 40") y aparte el
 * del producto base. Lo que sobra es la variante; si no sobra nada, ese
 * producto no tiene variantes y no hay ninguna que mencionar.
 */
export function etiquetaVariante(producto: ProductoStoky): string | null {
  const base = producto.product?.trim();
  const nombre = producto.name.trim();
  if (!base || nombre === base || !nombre.startsWith(base)) return null;

  // El separador que usa Stoky es una raya larga; se acepta cualquiera para
  // no depender de un carácter concreto.
  const resto = nombre.slice(base.length).replace(/^[\s—–-]+/, '').trim();
  return resto || null;
}

/** Si de ese producto hay más de una presentación en el catálogo. */
export function tieneVariantes(producto: ProductoStoky, catalogo: ProductoStoky[]): boolean {
  if (etiquetaVariante(producto)) return true;
  const base = producto.product?.trim();
  if (!base) return false;
  return catalogo.filter((p) => p.product?.trim() === base).length > 1;
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
  if (esTalla(palabra)) return [palabra];

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
/**
 * Palabras con las que se pregunta por un producto.
 *
 * Sirven para distinguir "¿tienen zapatillas?" —que merece un "no lo
 * tenemos"— de "hola" o "gracias", que no. Sin esta distinción, cualquier
 * mensaje suelto recibiría un "ese producto no está disponible" y el bot
 * parecería sordo.
 */
const PIDE_PRODUCTO = [
  'tienen', 'tienes', 'hay', 'venden', 'vendes', 'quiero', 'busco', 'necesito',
  'cuanto', 'cuesta', 'cuestan', 'precio', 'vale', 'valen', 'disponible',
  'stock', 'me interesa', 'quisiera',
];

/**
 * Palabras del envío. Aquí NO se pregunta por un producto.
 *
 * "¿Cuánto cuesta mandar un paquete?" lleva "cuánto cuesta" y no encuentra
 * nada en el catálogo; sin esta lista se le contestaría que ese producto no
 * está disponible, cuando lo que quiere es cotizar un envío.
 */
// Por raiz: "manden", "enviarme" y "lleveselo" son la misma peticion, y una
// lista de palabras enteras se queda corta en cuanto el cliente conjuga.
const ES_DE_ENVIO = [
  'envi', 'mand', 'llev', 'recoj', 'recog', 'entreg', 'despach', 'traslad',
  'paquete', 'encomienda', 'delivery', 'courier', 'flete', 'reparto',
];

/**
 * Si el mensaje pregunta por un producto del catálogo.
 *
 * No mira si existe: eso lo dice la búsqueda. Mira si TIENE SENTIDO
 * contestarle que no lo hay.
 */
/**
 * Colores con los que la gente pide una variante.
 *
 * No pretende ser la carta de colores completa: son los que aparecen en un
 * "lo tienes en negro?" y sirven para saber que el mensaje habla del producto
 * anterior y no empieza uno nuevo.
 */
const COLORES = new Set([
  'negro', 'negra', 'blanco', 'blanca', 'beige', 'marron', 'azul', 'rojo',
  'roja', 'verde', 'gris', 'plomo', 'crema', 'camel', 'dorado', 'plateado',
  'rosado', 'rosa', 'celeste', 'amarillo', 'morado', 'vino', 'mostaza',
  'naranja', 'turquesa', 'nude', 'caramelo', 'tan',
]);

/** Palabras que solo acompañan a la variante: "en talla 41", "el negro". */
const ACOMPANA_VARIANTE = new Set([
  'talla', 'tallas', 'color', 'colores', 'numero', 'nro', 'medida', 'en', 'el',
  'la', 'los', 'las', 'un', 'una', 'de', 'y', 'o', 'me', 'lo', 'hay', 'tienen',
  'tienes', 'queda', 'quedan', 'tendran', 'sera', 'seria', 'porfavor', 'porfa',
]);

/**
 * Si el mensaje es solo una variante: "talla 41", "en negro", "41".
 *
 * Sirve para leerlo como lo que es -una pregunta sobre el producto del que se
 * acaba de hablar- y no como un mensaje suelto. Sin esto, el cliente que
 * afina su pregunta despues de ver el precio acababa metido en el
 * cuestionario de envio, con "talla 41" contestado con "de que distrito
 * recogemos".
 */
export function pareceVarianteSuelta(texto: string): boolean {
  const palabras = normaliza(texto).split(' ').filter(Boolean);
  if (!palabras.length || palabras.length > 5) return false;

  // Al menos una tiene que SER la variante: "en el" no es una pregunta.
  const nucleo = palabras.filter((p) => esTalla(p) || COLORES.has(p));
  if (!nucleo.length) return false;

  return palabras.every((p) => esTalla(p) || COLORES.has(p) || ACOMPANA_VARIANTE.has(p));
}

export function pareceConsultaDeProducto(texto: string): boolean {
  const t = normaliza(texto);
  if (!t) return false;
  if (ES_DE_ENVIO.some((p) => t.includes(p))) return false;
  return PIDE_PRODUCTO.some((p) => t.includes(p));
}

/** Una talla: 38, 40, S, M, L, XL... */
export function esTalla(palabra: string): boolean {
  return /^\d{1,3}$/.test(palabra) || /^(xs|s|m|l|xl|xxl|xxxl)$/.test(palabra);
}

export function palabrasDe(consulta: string): string[] {
  return normaliza(consulta)
    .split(' ')
    // Las tallas entran aunque sean cortas: "40" y "M" son EXACTAMENTE lo que
    // distingue una variante de otra, y descartarlas por cortas hacia que
    // "quiero el negro talla 40" no encontrara la talla 40.
    .filter((p) => p.length >= 3 || esTalla(p));
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
      // La talla acertada vale mas que el nombre: quien pide la 40 quiere la
      // 40, y darle la 38 al mismo precio no es contestarle.
      puntos += esTalla(palabra) ? 20 : 12;
      continue;
    }

    // Una palabra corta DENTRO de otra es casi siempre casualidad: "las"
    // aparece en "clasico", y con eso preguntar por unas zapatillas devolvia
    // un pantalon. Solo las largas valen como fragmento, y una talla jamas:
    // el "40" de la 40 no puede casar con el "40" de 400.
    if (
      !esTalla(palabra) &&
      palabra.length >= MINIMO_PARA_BUSCAR_DENTRO &&
      formas.some((f) => texto.includes(f))
    ) {
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

      const vacio = { disponibles: [], agotados: [], similares: [], otrasVariantes: [] };
      if (!casan.length) return vacio;

      const conStock = casan.filter((x) => x.producto.stock > 0);
      const sinStock = casan.filter((x) => x.producto.stock <= 0);

      // Lo que decide es la PUNTUACION, no el stock. Si lo que mejor casa con
      // lo que pidio esta agotado, hay que decirselo: contestar con otra cosa
      // que casa peor -aunque la haya- es no responder a lo que pregunto.
      const mejorConStock = conStock[0]?.puntos ?? 0;
      const mejorSinStock = sinStock[0]?.puntos ?? 0;

      if (mejorConStock >= mejorSinStock) {
        const disponibles = conStock.slice(0, 4).map((x) => x.producto);
        return { disponibles, agotados: [], similares: [], otrasVariantes: [] };
      }

      // Lo que pidio esta agotado.
      const agotados = sinStock
        .filter((x) => x.puntos === mejorSinStock)
        .slice(0, 3)
        .map((x) => x.producto);

      // Primero se mira si hay OTRA PRESENTACION del mismo producto: quien
      // pide el polo en talla L y no lo hay, casi siempre se lleva la M. Eso
      // resuelve la venta; ofrecerle un pantalon, no.
      const base = agotados[0]?.product?.trim();
      const yaNombrados = new Set(agotados.map((p) => p.sku));

      const otrasVariantes = base
        ? todos
            .filter((p) => p.stock > 0 && p.product?.trim() === base && !yaNombrados.has(p.sku))
            .slice(0, 4)
        : [];

      // Y si no queda ninguna de ese producto, lo parecido de todo el
      // catalogo; si tampoco hay, no se ofrece nada.
      const similares = otrasVariantes.length
        ? []
        : conStock
            .filter((x) => !yaNombrados.has(x.producto.sku))
            .slice(0, 3)
            .map((x) => x.producto);

      return { disponibles: [], agotados, similares, otrasVariantes };
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
