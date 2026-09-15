/**
 * Los ajustes generales que se cambian desde la pantalla, sin reiniciar.
 *
 * El `.env` pone el punto de partida (BUSINESS_NAME, SOLO_NUMEROS, HORARIO_*,
 * RITMO_*, RUTAS_SUPERVISOR...). Lo que se guarde aqui manda sobre eso, y
 * `null` en un campo significa "lo que diga el servidor". Es lo que le da a
 * quien opera el control de verdad: a que horas se escribe, a que ritmo, a
 * quien se avisa, como se llama el negocio y -en pruebas- a que numeros se
 * puede escribir.
 *
 * Una excepcion a proposito: si el servidor arranco con SOLO_NUMEROS, esa
 * lista no se puede ampliar desde la pantalla. Es el freno de mano de quien
 * despliega; la pantalla solo puede apretarlo mas (una lista mas corta), no
 * soltarlo.
 *
 * Se guarda en `settings` con la clave `ajustes.generales`, como los del
 * reparto (`rutas.ajustes`). El servicio cachea el valor en memoria y lo
 * relee cada minuto, por si otro proceso lo cambio.
 */

import { z } from 'zod';
import type { Pool } from '../db/pool.js';
import type { Config } from '../config.js';
import type { Politica } from '../salud/politica.js';

export const AJUSTES_GENERALES_KEY = 'ajustes.generales';

const telefono = z.string().trim().transform((v) => v.replace(/\D+/g, '')).pipe(z.string().min(8).max(15));
const horaONada = z.coerce.number().int().min(0).max(24).nullable();
const enteroONada = (max: number) => z.coerce.number().int().min(0).max(max).nullable();

export const ajustesGeneralesSchema = z.object({
  /** Como se presenta el negocio en los mensajes y en las pantallas. */
  nombreNegocio: z.string().trim().min(1).max(80).nullable(),
  modoPrueba: z.object({
    activo: z.boolean(),
    numeros: z.array(telefono).max(50),
  }),
  horario: z.object({
    inicio: horaONada,
    fin: horaONada,
    /** 0 = domingo ... 6 = sabado. null = lo del servidor. */
    dias: z.array(z.number().int().min(0).max(6)).max(7).nullable(),
  }),
  ritmo: z.object({
    maxPorMinuto: enteroONada(60),
    maxPorHora: enteroONada(2000),
    pausaMinSeg: enteroONada(600),
    pausaMaxSeg: enteroONada(900),
    nuevosContactosPorDia: enteroONada(5000),
    maxPorContactoDia: enteroONada(20),
    separacionContactoMin: enteroONada(24 * 60),
  }),
  avisos: z.object({
    /** A quien se avisa por WhatsApp (nivel del numero, resumen del reparto). */
    supervisor: telefono.nullable().or(z.literal('').transform(() => null)),
  }),
  humanizar: z.boolean().nullable(),
  autoPausa: z.boolean().nullable(),
  /** Respuestas rapidas del chat: "/atajo" -> texto (y un sticker pegado, opcional). null = las de fabrica. */
  atajos: z
    .array(
      z.object({
        atajo: z.string().trim().min(1).max(30).transform((v) => v.replace(/^\//, '').toLowerCase()),
        texto: z.string().trim().min(1).max(1000),
        sticker: z.string().max(40).nullable().optional(),
      }),
    )
    .max(50)
    .nullable(),
  /**
   * Desde que webs se puede embeber el chat (iframe). Vacio = ninguna.
   * Van como origen: "https://stoky.app". Ver src/embed.
   */
  embebido: z
    .object({
      dominios: z
        .array(z.string().trim().min(1).max(200))
        .max(50)
        .transform((lista) => [...new Set(lista.map((d) => d.replace(/\/+$/, '').toLowerCase()).filter(Boolean))]),
    })
    .nullable(),
  /** Que sticker sale solo en cada momento. Ver src/stickers. */
  stickers: z
    .object({
      inicio: z.string().max(40).nullable().default(null),
      inicioEnReparto: z.boolean().default(false),
      gracias: z.string().max(40).nullable().default(null),
      despedida: z.string().max(40).nullable().default(null),
    })
    .nullable(),
});

/** Las respuestas rapidas que trae el sistema; se cambian desde Automatizacion. */
export const ATAJOS_POR_DEFECTO: Array<{ atajo: string; texto: string; sticker?: string | null }> = [
  { atajo: 'ubi', texto: 'Hola {nombre}, ¿me compartes tu ubicación por favor? Con el clip 📎 → Ubicación. Así el repartidor llega sin llamarte.' },
  { atajo: 'camino', texto: 'Hola {nombre}, tu pedido {pedido} ya está en camino. En un rato te llega.' },
  { atajo: 'gracias', texto: 'Gracias por su tiempo, {nombre}. ¡Que tenga un buen día!' },
  { atajo: 'espera', texto: 'Un momento por favor, ya lo reviso y le confirmo.' },
  { atajo: 'horario', texto: 'Atendemos de lunes a sábado, de 9:00 a 20:00. Fuera de ese horario le respondemos a primera hora.' },
  { atajo: 'datos', texto: 'Para registrar su pedido necesito: nombre completo, distrito, dirección con referencia y su DNI. ¿Me los pasa por aquí?' },
];

export type AjustesGenerales = z.infer<typeof ajustesGeneralesSchema>;

export const AJUSTES_GENERALES_VACIOS: AjustesGenerales = {
  nombreNegocio: null,
  modoPrueba: { activo: false, numeros: [] },
  horario: { inicio: null, fin: null, dias: null },
  ritmo: {
    maxPorMinuto: null,
    maxPorHora: null,
    pausaMinSeg: null,
    pausaMaxSeg: null,
    nuevosContactosPorDia: null,
    maxPorContactoDia: null,
    separacionContactoMin: null,
  },
  avisos: { supervisor: null },
  humanizar: null,
  autoPausa: null,
  atajos: null,
  stickers: null,
  embebido: null,
};

/** Un parche: cualquier rama, y dentro de cada rama cualquier campo. */
export const ajustesGeneralesPatchSchema = z.object({
  nombreNegocio: ajustesGeneralesSchema.shape.nombreNegocio.optional(),
  modoPrueba: ajustesGeneralesSchema.shape.modoPrueba.partial().optional(),
  horario: ajustesGeneralesSchema.shape.horario.partial().optional(),
  ritmo: ajustesGeneralesSchema.shape.ritmo.partial().optional(),
  avisos: ajustesGeneralesSchema.shape.avisos.partial().optional(),
  humanizar: ajustesGeneralesSchema.shape.humanizar.optional(),
  autoPausa: ajustesGeneralesSchema.shape.autoPausa.optional(),
  atajos: ajustesGeneralesSchema.shape.atajos.optional(),
  stickers: ajustesGeneralesSchema.shape.stickers.optional(),
  embebido: ajustesGeneralesSchema.shape.embebido.optional(),
});

export type AjustesGeneralesPatch = z.infer<typeof ajustesGeneralesPatchSchema>;

export function fusionarAjustes(base: AjustesGenerales, patch: Partial<AjustesGenerales> | AjustesGeneralesPatch): AjustesGenerales {
  return {
    nombreNegocio: patch.nombreNegocio !== undefined ? patch.nombreNegocio : base.nombreNegocio,
    modoPrueba: { ...base.modoPrueba, ...(patch.modoPrueba ?? {}) },
    horario: { ...base.horario, ...(patch.horario ?? {}) },
    ritmo: { ...base.ritmo, ...(patch.ritmo ?? {}) },
    avisos: { ...base.avisos, ...(patch.avisos ?? {}) },
    humanizar: patch.humanizar !== undefined ? patch.humanizar : base.humanizar,
    autoPausa: patch.autoPausa !== undefined ? patch.autoPausa : base.autoPausa,
    atajos: patch.atajos !== undefined ? patch.atajos : base.atajos,
    stickers: patch.stickers !== undefined ? patch.stickers : base.stickers,
    embebido: patch.embebido !== undefined ? patch.embebido : base.embebido,
  };
}

export interface AjustesGeneralesRepo {
  get(): Promise<AjustesGenerales>;
  set(patch: AjustesGeneralesPatch): Promise<AjustesGenerales>;
  reset(): Promise<void>;
}

export function createAjustesGeneralesRepo(pool: Pool): AjustesGeneralesRepo {
  async function leer(): Promise<AjustesGenerales> {
    const { rows } = await pool.query<{ value: string }>('select value from settings where key = $1', [AJUSTES_GENERALES_KEY]);
    if (!rows[0]) return AJUSTES_GENERALES_VACIOS;
    try {
      const parsed = ajustesGeneralesPatchSchema.safeParse(JSON.parse(rows[0].value));
      return parsed.success ? fusionarAjustes(AJUSTES_GENERALES_VACIOS, parsed.data) : AJUSTES_GENERALES_VACIOS;
    } catch {
      return AJUSTES_GENERALES_VACIOS;
    }
  }
  return {
    get: leer,
    async set(patch) {
      const nuevo = fusionarAjustes(await leer(), patch);
      await pool.query(
        `insert into settings (key, value, encrypted, updated_at) values ($1,$2,false,now())
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [AJUSTES_GENERALES_KEY, JSON.stringify(nuevo)],
      );
      return nuevo;
    },
    async reset() {
      await pool.query('delete from settings where key = $1', [AJUSTES_GENERALES_KEY]);
    },
  };
}

/** Lo que el servidor trae de fabrica: se enseña al lado de cada campo. */
export interface AjustesDelServidor {
  nombreNegocio: string;
  soloNumeros: string[];
  supervisor: string;
  timezone: string;
}

export interface ServicioAjustes {
  /** Lo guardado, tal cual (con sus null). */
  actual(): AjustesGenerales;
  /** Vuelve a leer de la base. */
  recargar(): Promise<AjustesGenerales>;
  guardar(patch: AjustesGeneralesPatch): Promise<AjustesGenerales>;
  restablecer(): Promise<AjustesGenerales>;
  /** La politica de ritmo con los ajustes encima. */
  politica(base: Politica): Politica;
  /** Modo prueba efectivo: vacio = a todos. */
  soloNumeros(): string[];
  nombreNegocio(): string;
  supervisor(): string;
  /** Lo del servidor, para que la pantalla diga que hay debajo de cada null. */
  servidor(): AjustesDelServidor;
  /** true si SOLO_NUMEROS vino del servidor: la pantalla no puede soltarlo. */
  modoPruebaFijado(): boolean;
  /** Las respuestas rapidas del chat: las guardadas o las de fabrica. */
  atajos(): Array<{ atajo: string; texto: string; sticker?: string | null }>;
  /** Los origenes que pueden embeber el chat. Vacio = nadie. */
  dominiosEmbebido(): string[];
}

export async function crearServicioAjustes(deps: {
  repo: AjustesGeneralesRepo;
  config: Config;
  ahora?: () => number;
  /** Cada cuanto se relee la base, en ms (0 = nunca; el guardado ya refresca). */
  releerCadaMs?: number;
}): Promise<ServicioAjustes> {
  const { repo, config } = deps;
  const ahora = deps.ahora ?? (() => Date.now());
  const releerCadaMs = deps.releerCadaMs ?? 60_000;
  let valor = await repo.get();
  let leidoEn = ahora();

  const fresco = (): AjustesGenerales => {
    if (releerCadaMs > 0 && ahora() - leidoEn > releerCadaMs) {
      leidoEn = ahora();
      // En segundo plano: la lectura no puede frenar un envio.
      repo
        .get()
        .then((v) => {
          valor = v;
        })
        .catch(() => undefined);
    }
    return valor;
  };

  const servidor: AjustesDelServidor = {
    nombreNegocio: config.businessName,
    soloNumeros: config.soloNumeros,
    supervisor: config.SALUD_AVISAR_A?.trim() || config.RUTAS_SUPERVISOR?.trim() || '',
    timezone: config.timezone,
  };

  return {
    actual: fresco,
    async recargar() {
      valor = await repo.get();
      leidoEn = ahora();
      return valor;
    },
    async guardar(patch) {
      // Por el esquema aunque venga de codigo: normaliza telefonos y acota rangos.
      valor = await repo.set(ajustesGeneralesPatchSchema.parse(patch));
      leidoEn = ahora();
      return valor;
    },
    async restablecer() {
      await repo.reset();
      valor = await repo.get();
      leidoEn = ahora();
      return valor;
    },
    politica(base) {
      const a = fresco();
      const p: Politica = { ...base, warmup: { ...base.warmup }, umbrales: { ...base.umbrales } };
      if (a.horario.inicio !== null) p.horaInicio = a.horario.inicio;
      if (a.horario.fin !== null) p.horaFin = a.horario.fin;
      if (a.horario.dias && a.horario.dias.length) p.diasPermitidos = [...a.horario.dias];
      if (p.horaFin <= p.horaInicio) p.horaFin = Math.min(24, p.horaInicio + 1);
      const r = a.ritmo;
      if (r.maxPorMinuto !== null && r.maxPorMinuto > 0) p.maxPorMinuto = r.maxPorMinuto;
      if (r.maxPorHora !== null && r.maxPorHora > 0) p.maxPorHora = r.maxPorHora;
      if (r.pausaMinSeg !== null) p.pausaMinMs = r.pausaMinSeg * 1000;
      if (r.pausaMaxSeg !== null) p.pausaMaxMs = r.pausaMaxSeg * 1000;
      if (p.pausaMaxMs < p.pausaMinMs) p.pausaMaxMs = p.pausaMinMs;
      if (r.nuevosContactosPorDia !== null) p.nuevosContactosPorDia = r.nuevosContactosPorDia;
      if (r.maxPorContactoDia !== null && r.maxPorContactoDia > 0) p.maxPorContactoDia = r.maxPorContactoDia;
      if (r.separacionContactoMin !== null) p.separacionContactoMs = r.separacionContactoMin * 60_000;
      if (a.avisos.supervisor !== null) p.avisarA = a.avisos.supervisor;
      if (a.humanizar !== null) p.humanizar = a.humanizar;
      if (a.autoPausa !== null) p.autoPausa = a.autoPausa;
      return p;
    },
    soloNumeros() {
      const a = fresco();
      const delServidor = config.soloNumeros;
      if (delServidor.length) {
        // El servidor fijo la lista: la pantalla solo puede recortarla.
        if (!a.modoPrueba.activo || !a.modoPrueba.numeros.length) return delServidor;
        const recorte = a.modoPrueba.numeros.filter((n) => delServidor.includes(n));
        return recorte.length ? recorte : delServidor;
      }
      return a.modoPrueba.activo ? a.modoPrueba.numeros : [];
    },
    nombreNegocio() {
      return fresco().nombreNegocio ?? config.businessName;
    },
    supervisor() {
      const a = fresco();
      return a.avisos.supervisor ?? servidor.supervisor;
    },
    servidor: () => servidor,
    modoPruebaFijado: () => config.soloNumeros.length > 0,
    atajos: () => fresco().atajos ?? ATAJOS_POR_DEFECTO,
    dominiosEmbebido: () => fresco().embebido?.dominios ?? [],
  };
}
