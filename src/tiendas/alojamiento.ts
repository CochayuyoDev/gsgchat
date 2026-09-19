/**
 * El alojamiento: levantar la instalacion de una tienda desde el panel.
 *
 * Cuando este panel corre en el servidor del SaaS (con Docker, Caddy y el
 * `saas/.env` con el dominio), "Dar de alta" en Tiendas no solo registra la
 * tienda: le crea su base, su contenedor y su subdominio (lo mismo que
 * `npm run saas:alta`), y le deja puesto en el `.env` la direccion del plan
 * y el token de aqui. Asi la tienda nace ya controlada por este panel, sin
 * pegar nada, y el cliente entra por su URL a crear su primera cuenta.
 *
 * Sin `saas/.env` (una instalacion suelta, o una PC), el alojamiento no
 * esta disponible: Tiendas sigue registrando y dando el token para pegar a
 * mano. La deteccion es esa y nada mas: si hay dominio, hay alojamiento.
 */

import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { altaInstancia, bajaInstancia, leerConfigSaas, listarInstancias, SAAS_DIR, urlDe, type ConfigSaas, type DepsSaas } from '../../saas/instancias.js';
import { planInicial } from '../../saas/planes.js';

export interface EstadoAlojamiento {
  disponible: boolean;
  /** "wa.tuservicio.com": cada tienda sale como <slug>.dominio. */
  dominioBase: string | null;
  /** Por que no esta disponible, en palabras. */
  motivo: string | null;
}

export interface Alojamiento {
  estado(): EstadoAlojamiento;
  /** Levanta la instalacion de la tienda con el plan apuntando a este panel. Devuelve su URL. */
  crear(input: { slug: string; nombre: string; token: string; urlPlan: string; proveedor?: 'cloud' | 'local' | 'waha' }): Promise<{ url: string }>;
  /** Para la instalacion (conserva sus datos salvo que se pida borrarlos). */
  quitar(slug: string, borrarDatos: boolean): Promise<void>;
  /** Si esa tienda tiene instalacion aqui. */
  existe(slug: string): boolean;
}

export interface DepsAlojamiento {
  /** La carpeta saas/ (por defecto la del proyecto). Para pruebas. */
  base?: string;
  /** Quien ejecuta docker (por defecto el real). Para pruebas. */
  ejecutar?: DepsSaas['ejecutar'];
  cfg?: ConfigSaas;
  log?: (m: string) => void;
  ahora?: () => Date;
}

export function crearAlojamiento(deps: DepsAlojamiento = {}): Alojamiento {
  const base = deps.base ?? SAAS_DIR;
  const hayEnv = existsSync(path.join(base, '.env'));
  const cfg = deps.cfg ?? (hayEnv ? leerConfigSaas(base) : null);
  const disponible = Boolean(cfg && cfg.dominioBase);
  const saas: DepsSaas = { base, ejecutar: deps.ejecutar, cfg: cfg ?? undefined, log: deps.log, ahora: deps.ahora };

  return {
    estado: () => ({
      disponible,
      dominioBase: cfg?.dominioBase ?? null,
      motivo: disponible ? null : 'Este panel no corre en un servidor con el SaaS preparado (falta saas/.env con DOMINIO_BASE).',
    }),
    async crear(input) {
      if (!disponible || !cfg) throw new Error('El alojamiento no está disponible en este servidor.');
      try {
        const instancia = await altaInstancia(
          input.slug,
          {
            nombre: input.nombre,
            proveedor: input.proveedor ?? 'local',
            // El plan.json es el formato viejo del maestro; se escribe con el
            // mismo token para que nada se contradiga. Lo que manda es el .env:
            // la instancia pregunta a ESTE panel, no al maestro antiguo.
            plan: planInicial(deps.ahora?.() ?? new Date(), 'prueba', input.token),
            extra: { PLAN_URL: input.urlPlan, PLAN_TOKEN: input.token },
          },
          saas,
        );
        return { url: instancia.url || urlDe(input.slug, cfg) };
      } catch (error) {
        // Si Docker fallo a medias, la instancia no cuenta como levantada y
        // se puede volver a intentar: se quita la marca, se dejan los
        // ficheros para mirar que paso.
        rmSync(path.join(base, 'instancias', input.slug, 'instancia.json'), { force: true });
        throw error;
      }
    },
    async quitar(slug, borrarDatos) {
      if (!disponible) return;
      await bajaInstancia(slug, { borrarDatos }, saas);
    },
    existe: (slug) => disponible && listarInstancias(base).some((i) => i.slug === slug),
  };
}
