/**
 * Los ajustes del reparto que se cambian desde la pantalla, sin reiniciar.
 *
 * Las variables de entorno (RUTAS_*) ponen el punto de partida; lo que se
 * guarde aqui manda sobre ellas. Es lo que le da a quien opera el control de
 * verdad: cuanto se espera antes de insistir, cuantas veces, en que horario,
 * y -sobre todo- QUE se le dice al cliente en cada paso: con que plantilla
 * de Meta, o con que redacciones cuando se escribe libre.
 *
 * Se guarda en `settings` con la clave `rutas.ajustes`, igual que las
 * preferencias del bot.
 */

import { z } from 'zod';
import type { Pool } from '../db/pool.js';
import type { PasoUbicacion } from './mensajes.js';
import type { OpcionesMotor } from './motor.js';

export const PASOS: PasoUbicacion[] = ['solicitud', 'recordatorio', 'insistencia'];

export interface AjustesRutas {
  /** Pausa entre envios, en segundos; se sortea entre los dos. */
  pausaMinSegundos: number;
  pausaMaxSegundos: number;
  /** Cuanto se espera una respuesta antes de volver a escribir. */
  esperaRespuestaMinutos: number;
  /** Minutos que espera el primer mensaje desde que llega el pedido (0 = de inmediato). */
  esperaPrimerMensajeMinutos?: number;
  /** Campo canónico: espera antes de la primera plantilla, en segundos. */
  esperaPrimerMensajeSegundos?: number;
  /** Minutos entre cada mensaje y el siguiente; el primero es del 1 al 2. */
  esperasMensajesMinutos: number[];
  /** Campo canónico: esperas de seguimiento, en segundos. */
  esperasMensajesSegundos?: number[];
  /** Mensajes por cliente antes de pasarlo al repartidor. */
  maxIntentos: number;
  /**
   * Minutos que se espera tras el ÚLTIMO mensaje antes de darlo por «sin
   * respuesta» y reportarlo a GSG (0 = en el momento). Sin guardar: lo mismo
   * que la última espera entre mensajes.
   */
  esperaFinalMinutos: number;
  esperaFinalSegundos?: number;
  /** Campo antiguo: siempre desactivado, incluso al leer ajustes previos. */
  pedirUbicacionCadaMinutos: number;
  /** Franja horaria de envio, hora del negocio. */
  horaInicio: number;
  horaFin: number;
  /**
   * Plantillas de Meta por paso (nombres del registro). Vacio = las del
   * catalogo. Con varias, el motor las alterna y deja fuera las pausadas.
   */
  plantillas: Record<PasoUbicacion, string[]>;
  /**
   * Redacciones para cuando se escribe libre (cliente no oficial o dentro de
   * la ventana), una por linea. Admiten {nombre}, {negocio}, {tienda} y {pedido}.
   * Vacio = las tres de siempre de cada paso.
   */
  textos: Record<PasoUbicacion, string[]>;
  /** Redacciones propias por mensaje a partir del cuarto. */
  textosAdicionales: string[][];
  textosSeguimientos?: { recordatorio: string[]; insistencia: string[] }[];
}

const listaDeTextos = z.array(z.string().trim().min(1).max(1000)).max(10);
const textosAdicionalesSchema = z.array(listaDeTextos).max(97);
const listaDeNombres = z.array(z.string().trim().min(1).max(120)).max(10);
const esperasSchema = z.array(z.coerce.number().int().min(1).max(24 * 60)).max(99);
const esperasSegundosSchema = z.array(z.coerce.number().int().min(1).max(24 * 60 * 60)).max(99);

export const ajustesSchema = z.object({
  pausaMinSegundos: z.coerce.number().int().min(1).max(24 * 60 * 60),
  pausaMaxSegundos: z.coerce.number().int().min(1).max(24 * 60 * 60),
  esperaRespuestaMinutos: z.coerce.number().int().min(1).max(24 * 60),
  esperaPrimerMensajeMinutos: z.coerce.number().int().min(0).max(24 * 60),
  esperaPrimerMensajeSegundos: z.coerce.number().int().min(0).max(24 * 60 * 60),
  esperasMensajesMinutos: esperasSchema,
  esperasMensajesSegundos: esperasSegundosSchema,
  maxIntentos: z.coerce.number().int().min(1).max(100),
  esperaFinalMinutos: z.coerce.number().int().min(0).max(24 * 60),
  esperaFinalSegundos: z.coerce.number().int().min(0).max(24 * 60 * 60),
  pedirUbicacionCadaMinutos: z.literal(0),
  horaInicio: z.coerce.number().int().min(0).max(23),
  horaFin: z.coerce.number().int().min(1).max(24),
  plantillas: z.object({ solicitud: listaDeNombres, recordatorio: listaDeNombres, insistencia: listaDeNombres }),
  textos: z.object({ solicitud: listaDeTextos, recordatorio: listaDeTextos, insistencia: listaDeTextos }),
  textosAdicionales: textosAdicionalesSchema,
  textosSeguimientos: z.array(z.object({ recordatorio: listaDeTextos, insistencia: listaDeTextos })).max(99),
});

export type AjustesPatch = Partial<z.infer<typeof ajustesSchema>>;

/** Los ajustes que salen de la configuracion, sin nada guardado. */
export function ajustesPorDefecto(opciones: OpcionesMotor): AjustesRutas {
  const secuenciaPredeterminada = [opciones.esperaRespuestaMinutos, 25, 20];
  const esperasMensajesMinutos = Array.from(
    { length: Math.max(0, opciones.maxIntentos - 1) },
    (_, i) => secuenciaPredeterminada[i] ?? 20,
  );
  return {
    pausaMinSegundos: opciones.pausaMinSegundos,
    pausaMaxSegundos: opciones.pausaMaxSegundos,
    esperaRespuestaMinutos: opciones.esperaRespuestaMinutos,
    esperasMensajesMinutos,
    maxIntentos: opciones.maxIntentos,
    esperaFinalMinutos: esperasMensajesMinutos.at(-1) ?? opciones.esperaRespuestaMinutos,
    esperaPrimerMensajeSegundos: 0,
    esperasMensajesSegundos: esperasMensajesMinutos.map((n) => n * 60),
    esperaFinalSegundos: (esperasMensajesMinutos.at(-1) ?? opciones.esperaRespuestaMinutos) * 60,
    pedirUbicacionCadaMinutos: 0,
    horaInicio: opciones.horaInicio,
    horaFin: opciones.horaFin,
    plantillas: { solicitud: [], recordatorio: [], insistencia: [] },
    textos: { solicitud: [], recordatorio: [], insistencia: [] },
    textosAdicionales: [],
  };
}

/** Las opciones del motor con los ajustes guardados por encima. */
export function aplicarAjustes(opciones: OpcionesMotor, ajustes: AjustesRutas): OpcionesMotor {
  return {
    ...opciones,
    pausaMinSegundos: ajustes.pausaMinSegundos,
    // El minimo manda si alguien pone el maximo por debajo.
    pausaMaxSegundos: Math.max(ajustes.pausaMinSegundos, ajustes.pausaMaxSegundos),
    esperaRespuestaMinutos: ajustes.esperaRespuestaMinutos,
    esperaPrimerMensajeMinutos: ajustes.esperaPrimerMensajeSegundos !== undefined ? ajustes.esperaPrimerMensajeSegundos / 60 : ajustes.esperaPrimerMensajeMinutos,
    esperaPrimerMensajeSegundos: ajustes.esperaPrimerMensajeSegundos ?? (ajustes.esperaPrimerMensajeMinutos ?? 0) * 60,
    esperasMensajesMinutos: ajustes.esperasMensajesSegundos?.map((n) => n / 60) ?? ajustes.esperasMensajesMinutos,
    esperasMensajesSegundos: ajustes.esperasMensajesSegundos ?? ajustes.esperasMensajesMinutos.map((n) => n * 60),
    maxIntentos: ajustes.maxIntentos,
    esperaFinalMinutos: ajustes.esperaFinalSegundos !== undefined ? ajustes.esperaFinalSegundos / 60 : ajustes.esperaFinalMinutos,
    esperaFinalSegundos: ajustes.esperaFinalSegundos ?? ajustes.esperaFinalMinutos * 60,
    pedirUbicacionCadaMinutos: 0,
    // El horario de aqui es solo el SUELO: en una instalacion sin ajustes
    // generales (una suelta, las pruebas) sigue siendo el que manda. Donde si
    // los hay -todas las tiendas- la franja general se pone encima con
    // `conFranjaDeLaPolitica`, y es la unica que cuenta: antes convivian dos
    // horarios y ganaba el mas estricto sin que la pantalla lo dijera.
    horaInicio: ajustes.horaInicio,
    horaFin: Math.max(ajustes.horaInicio + 1, ajustes.horaFin),
  };
}

/**
 * La franja de envio de verdad: la de los ajustes generales.
 *
 * Es la UNICA fuente del horario (inicio, fin y zona horaria) para los dos
 * motores y para el freno de ritmo de la salud, que ya la usaba. Sin politica
 * -en las pruebas, o antes de que haya ajustes- se queda la de la
 * configuracion del proceso.
 */
export function conFranjaDeLaPolitica(
  opciones: OpcionesMotor,
  politica?: { horaInicio: number; horaFin: number; timezone?: string; pausaMinMs?: number; pausaMaxMs?: number } | null,
): OpcionesMotor {
  if (!politica) return opciones;
  const inicio = Math.max(0, Math.min(23, Math.floor(politica.horaInicio)));
  const fin = Math.max(inicio + 1, Math.min(24, Math.floor(politica.horaFin)));
  return { ...opciones, horaInicio: inicio, horaFin: fin, timezone: politica.timezone || opciones.timezone,
    pausaMinSegundos: (politica.pausaMinMs ?? opciones.pausaMinSegundos * 1000) / 1000,
    pausaMaxSegundos: (politica.pausaMaxMs ?? opciones.pausaMaxSegundos * 1000) / 1000 };
}

/**
 * Una redaccion propia con sus huecos rellenos.
 *
 * {nombre}, {negocio}, {tienda} y {pedido}, sin distinguir mayusculas. Lo que no se
 * sepa (un cliente sin nombre) se sustituye por lo mismo que usan los
 * textos de siempre, para que no quede un hueco raro.
 */
export function rellenarTexto(
  plantilla: string,
  ctx: {
    nombre?: string | null;
    negocio: string;
    /** La tienda que vende, como la manda GSG en el pedido («Mass»). */
    tienda?: string | null;
    /** El producto que manda GSG en el pedido; sin el, {producto} no sale. */
    producto?: string | null;
    referencia?: string | null;
    direccion?: string | null;
    distrito?: string | null;
    conBoton?: boolean;
  },
): string {
  const nombre = (ctx.nombre ?? '').trim().split(/\s+/)[0] || 'buenas tardes';
  const pedido = (ctx.referencia ?? '').trim() || 'tu pedido';
  const como = ctx.conBoton ? 'con el botón de aquí abajo' : 'desde el clip 📎 → Ubicación → Enviar tu ubicación actual';
  return plantilla
    .replace(/\{nombre\}/gi, nombre)
    .replace(/\{negocio\}/gi, ctx.negocio)
    .replace(/\{tienda\}/gi, (ctx.tienda ?? '').trim() || 'la tienda')
    .replace(/\{producto\}/gi, (ctx.producto ?? '').trim())
    .replace(/\{pedido\}/gi, pedido)
    .replace(/\{referencia\}/gi, pedido)
    .replace(/\{direccion\}/gi, (ctx.direccion ?? '').trim())
    .replace(/\{distrito\}/gi, (ctx.distrito ?? '').trim())
    .replace(/\{como\}/gi, como)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ,/g, ',')
    .trim();
}

/**
 * Lo guardado encima de la base. La secuencia de esperas manda: el maximo de
 * mensajes es siempre `esperas + 1`, y sin espera final guardada sigue a la
 * ultima espera. Exportada para que el repo en memoria de las pruebas haga
 * exactamente lo mismo que el de la base.
 */
export const fusionarAjustesRutas = (base: AjustesRutas, guardado: Partial<AjustesRutas>): AjustesRutas => {
  const intervalo = guardado.esperaRespuestaMinutos ?? base.esperaRespuestaMinutos;
  const maxIntentos = Math.max(1, Math.min(100, guardado.maxIntentos ?? base.maxIntentos));
  let esperasSegundos = guardado.esperasMensajesSegundos
    ?? (guardado.esperasMensajesMinutos ? guardado.esperasMensajesMinutos.map((n) => n * 60) : undefined)
    ?? base.esperasMensajesSegundos
    ?? base.esperasMensajesMinutos.map((n) => n * 60);
  let esperas = guardado.esperasMensajesMinutos ?? esperasSegundos.map((n) => n / 60);
  // Compatibilidad con ajustes previos: replicar el intervalo antiguo por
  // cada seguimiento. Si el cliente solo cambia el máximo, conservar el
  // ritmo actual y ajustar la longitud de la secuencia.
  if (!guardado.esperasMensajesMinutos && !guardado.esperasMensajesSegundos) {
    const cantidad = guardado.maxIntentos !== undefined ? maxIntentos - 1 : esperas.length;
    esperas = Array.from({ length: cantidad }, (_, i) =>
      guardado.esperaRespuestaMinutos !== undefined || !esperas[i] ? intervalo : esperas[i]);
    esperasSegundos = esperas.map((n) => n * 60);
  }
  esperas = esperas.slice(0, 99);
  esperasSegundos = esperasSegundos.slice(0, 99);
  const primerSegundos = guardado.esperaPrimerMensajeSegundos ?? (guardado.esperaPrimerMensajeMinutos !== undefined ? guardado.esperaPrimerMensajeMinutos * 60 : base.esperaPrimerMensajeSegundos ?? (base.esperaPrimerMensajeMinutos ?? 0) * 60);
  const finalSegundos = guardado.esperaFinalSegundos ?? (guardado.esperaFinalMinutos !== undefined ? guardado.esperaFinalMinutos * 60 : guardado.esperasMensajesSegundos || guardado.esperasMensajesMinutos ? esperasSegundos.at(-1) ?? intervalo * 60 : base.esperaFinalSegundos ?? base.esperaFinalMinutos * 60);
  return {
    ...base,
    ...guardado,
    esperaRespuestaMinutos: esperas[0] ?? intervalo,
    esperasMensajesMinutos: esperas,
    esperaPrimerMensajeSegundos: primerSegundos,
    esperaPrimerMensajeMinutos: primerSegundos / 60,
    esperasMensajesSegundos: esperasSegundos,
    maxIntentos: esperas.length + 1,
    // Sin guardar, la espera final sigue a la última espera entre mensajes.
    esperaFinalMinutos: finalSegundos / 60,
    esperaFinalSegundos: finalSegundos,
    pedirUbicacionCadaMinutos: 0,
    plantillas: { ...base.plantillas, ...(guardado.plantillas ?? {}) },
    textos: { ...base.textos, ...(guardado.textos ?? {}) },
    textosAdicionales: (guardado.textosAdicionales ?? base.textosAdicionales).slice(0, 97),
  };
};

export const AJUSTES_KEY = 'rutas.ajustes';

export interface AjustesRepo {
  /** Lo guardado, encima de los valores por defecto que se le pasen. */
  get(porDefecto: AjustesRutas): Promise<AjustesRutas>;
  set(patch: AjustesPatch, porDefecto: AjustesRutas): Promise<AjustesRutas>;
  /** Vuelve a los valores de la configuracion. */
  reset(): Promise<void>;
}

export function createAjustesRepo(pool: Pool): AjustesRepo {
  const VIGENCIA_CACHE_MS = 5_000;
  let cacheAjustes: Partial<AjustesRutas> = {};
  let cacheListo = false;
  let cacheLeidoAt = 0;
  let generacionCache = 0;
  let lecturaEnCurso: Promise<Partial<AjustesRutas>> | null = null;

  async function leer(): Promise<Partial<AjustesRutas>> {
    if (cacheListo && Date.now() - cacheLeidoAt < VIGENCIA_CACHE_MS) return cacheAjustes;
    if (lecturaEnCurso) return lecturaEnCurso;
    const generacion = generacionCache;
    const actual = pool.query<{ value: string }>('select value from settings where `key` = $1', [AJUSTES_KEY])
      .then(({ rows }) => {
        let valor: Partial<AjustesRutas> = {};
        if (rows[0]) {
          try { valor = JSON.parse(rows[0].value) as Partial<AjustesRutas>; } catch { valor = {}; }
        }
        if (generacion === generacionCache) {
          cacheAjustes = valor;
          cacheListo = true;
          cacheLeidoAt = Date.now();
        }
        return valor;
      })
      .finally(() => { if (lecturaEnCurso === actual) lecturaEnCurso = null; });
    lecturaEnCurso = actual;
    return actual;
  }

  return {
    async get(porDefecto) {
      return fusionarAjustesRutas(porDefecto, await leer());
    },
    async set(patch, porDefecto) {
      const actual = fusionarAjustesRutas(porDefecto, await leer());
      const nuevo = fusionarAjustesRutas(actual, patch as Partial<AjustesRutas>);
      await pool.query(
        `insert into settings (\`key\`, value, encrypted, updated_at) values ($1,$2,false,now(3))
         on duplicate key update value = values(value), updated_at = now(3)`,
        [AJUSTES_KEY, JSON.stringify(nuevo)],
      );
      // El cambio local se aplica inmediatamente; los otros procesos que
      // compartan la base lo verán al vencer el TTL corto.
      generacionCache++;
      cacheAjustes = nuevo;
      cacheListo = true;
      cacheLeidoAt = Date.now();
      return nuevo;
    },
    async reset() {
      await pool.query('delete from settings where `key` = $1', [AJUSTES_KEY]);
      generacionCache++;
      cacheAjustes = {};
      cacheListo = true;
      cacheLeidoAt = Date.now();
    },
  };
}
