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
  /** Mensajes por cliente antes de pasarlo al repartidor. */
  maxIntentos: number;
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
   * la ventana), una por linea. Admiten {nombre}, {negocio} y {pedido}.
   * Vacio = las tres de siempre de cada paso.
   */
  textos: Record<PasoUbicacion, string[]>;
}

const listaDeTextos = z.array(z.string().trim().min(1).max(1000)).max(10);
const listaDeNombres = z.array(z.string().trim().min(1).max(120)).max(10);

export const ajustesSchema = z.object({
  pausaMinSegundos: z.coerce.number().int().min(1).max(600),
  pausaMaxSegundos: z.coerce.number().int().min(1).max(900),
  esperaRespuestaMinutos: z.coerce.number().int().min(1).max(24 * 60),
  maxIntentos: z.coerce.number().int().min(1).max(3),
  horaInicio: z.coerce.number().int().min(0).max(23),
  horaFin: z.coerce.number().int().min(1).max(24),
  plantillas: z.object({ solicitud: listaDeNombres, recordatorio: listaDeNombres, insistencia: listaDeNombres }),
  textos: z.object({ solicitud: listaDeTextos, recordatorio: listaDeTextos, insistencia: listaDeTextos }),
});

export type AjustesPatch = Partial<z.infer<typeof ajustesSchema>>;

/** Los ajustes que salen de la configuracion, sin nada guardado. */
export function ajustesPorDefecto(opciones: OpcionesMotor): AjustesRutas {
  return {
    pausaMinSegundos: opciones.pausaMinSegundos,
    pausaMaxSegundos: opciones.pausaMaxSegundos,
    esperaRespuestaMinutos: opciones.esperaRespuestaMinutos,
    maxIntentos: opciones.maxIntentos,
    horaInicio: opciones.horaInicio,
    horaFin: opciones.horaFin,
    plantillas: { solicitud: [], recordatorio: [], insistencia: [] },
    textos: { solicitud: [], recordatorio: [], insistencia: [] },
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
    maxIntentos: Math.min(3, ajustes.maxIntentos),
    horaInicio: ajustes.horaInicio,
    horaFin: Math.max(ajustes.horaInicio + 1, ajustes.horaFin),
  };
}

/**
 * Una redaccion propia con sus huecos rellenos.
 *
 * {nombre}, {negocio} y {pedido}, sin distinguir mayusculas. Lo que no se
 * sepa (un cliente sin nombre) se sustituye por lo mismo que usan los
 * textos de siempre, para que no quede un hueco raro.
 */
export function rellenarTexto(
  plantilla: string,
  ctx: {
    nombre?: string | null;
    negocio: string;
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
    .replace(/\{pedido\}/gi, pedido)
    .replace(/\{referencia\}/gi, pedido)
    .replace(/\{direccion\}/gi, (ctx.direccion ?? '').trim())
    .replace(/\{distrito\}/gi, (ctx.distrito ?? '').trim())
    .replace(/\{como\}/gi, como)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ,/g, ',')
    .trim();
}

export const AJUSTES_KEY = 'rutas.ajustes';

export interface AjustesRepo {
  /** Lo guardado, encima de los valores por defecto que se le pasen. */
  get(porDefecto: AjustesRutas): Promise<AjustesRutas>;
  set(patch: AjustesPatch, porDefecto: AjustesRutas): Promise<AjustesRutas>;
  /** Vuelve a los valores de la configuracion. */
  reset(): Promise<void>;
}

export function createAjustesRepo(pool: Pool): AjustesRepo {
  async function leer(): Promise<Partial<AjustesRutas>> {
    const { rows } = await pool.query<{ value: string }>('select value from settings where `key` = $1', [AJUSTES_KEY]);
    if (!rows[0]) return {};
    try {
      return JSON.parse(rows[0].value) as Partial<AjustesRutas>;
    } catch {
      return {};
    }
  }

  const fusionar = (base: AjustesRutas, guardado: Partial<AjustesRutas>): AjustesRutas => ({
    ...base,
    ...guardado,
    plantillas: { ...base.plantillas, ...(guardado.plantillas ?? {}) },
    textos: { ...base.textos, ...(guardado.textos ?? {}) },
  });

  return {
    async get(porDefecto) {
      return fusionar(porDefecto, await leer());
    },
    async set(patch, porDefecto) {
      const actual = fusionar(porDefecto, await leer());
      const nuevo = fusionar(actual, patch as Partial<AjustesRutas>);
      await pool.query(
        `insert into settings (\`key\`, value, encrypted, updated_at) values ($1,$2,false,now(3))
         on duplicate key update value = values(value), updated_at = now(3)`,
        [AJUSTES_KEY, JSON.stringify(nuevo)],
      );
      return nuevo;
    },
    async reset() {
      await pool.query('delete from settings where `key` = $1', [AJUSTES_KEY]);
    },
  };
}
