/**
 * Las tiendas que controla el superadministrador.
 *
 * Cada negocio tiene su propia instalacion del sistema de WhatsApp. Desde
 * aqui, el superadministrador las tiene todas a la vista y las gobierna:
 * las da de alta (con su plan y su vencimiento), apunta sus pagos, las
 * suspende o reactiva, y ve cuando fue la ultima vez que cada una se
 * conecto. Esto es lo que antes hacia el "maestro" del SaaS en ficheros,
 * metido en el panel y en la base.
 *
 * Como se enteran las tiendas: su instalacion pregunta por su plan a este
 * servidor (`GET /api/plan/<slug>` con su token, el mismo contrato de
 * siempre), cada cuarto de hora. Con lo que se le responde, alla se para
 * la IA y las campañas si esta vencida o suspendida. Si esta tienda es la
 * misma instalacion que este servidor (una sola tienda), su Membresia local
 * hace lo mismo sin pasar por aqui.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { armarMembresia, membresiaConPago, planDeMembresia, PLANES_ELEGIBLES, type EntradaMembresia, type MembresiaLocal, type PlanRemoto } from '../plan/servicio.js';
import type { Tienda, TiendasRepo } from './repo.js';
import type { Alojamiento, EstadoAlojamiento } from './alojamiento.js';

export interface TiendaVista extends Omit<Tienda, 'tokenHash'> {
  /** El plan de hoy: dias, vencida, aviso. */
  plan: PlanRemoto;
  /** verde: pagada y en linea; ambar: por vencer o sin conectar; rojo: vencida o suspendida. */
  semaforo: 'verde' | 'ambar' | 'rojo';
  /** Su sistema pregunto por el plan hace menos de 20 minutos. */
  enLinea: boolean;
  /** Lo que hay que pegar en la tienda (Membresia → Depende de un maestro). */
  urlPlan: string;
  /** Si su instalacion la levanto este panel (alojamiento). */
  instalada: boolean;
}

export interface NuevaTiendaEntrada {
  nombre: string;
  slug?: string;
  url?: string | null;
  contacto?: string | null;
  notas?: string | null;
  membresia: EntradaMembresia;
  /** Levantar tambien su instalacion (subdominio) en este servidor, si hay alojamiento. */
  crearInstalacion?: boolean;
  proveedor?: 'cloud' | 'local' | 'waha';
}

export interface ResultadoInstalacion {
  intentada: boolean;
  ok: boolean;
  url: string | null;
  error: string | null;
}

export interface ServicioTiendas {
  listar(): Promise<{ tiendas: TiendaVista[]; resumen: { total: number; activas: number; porVencer: number; vencidas: number; suspendidas: number; enLinea: number; ingresosMes: number; moneda: string }; alojamiento: EstadoAlojamiento }>;
  porId(id: string): Promise<TiendaVista | null>;
  /** Da de alta la tienda (y su instalacion, si se pide y hay alojamiento) y devuelve el token UNA vez. */
  crear(entrada: NuevaTiendaEntrada, quien: string | null): Promise<{ tienda: TiendaVista; token: string; instalacion: ResultadoInstalacion }>;
  cambiar(id: string, cambio: { nombre?: string; url?: string | null; contacto?: string | null; notas?: string | null; membresia?: EntradaMembresia }, quien: string | null): Promise<TiendaVista | null>;
  anotarPago(id: string, pago: { meses: number; monto: number; moneda?: string; nota?: string }, quien: string | null): Promise<TiendaVista | null>;
  suspender(id: string, suspendida: boolean, quien: string | null): Promise<TiendaVista | null>;
  /** Un token nuevo (el anterior deja de valer); se ve una vez. */
  rotarToken(id: string): Promise<{ tienda: TiendaVista; token: string } | null>;
  /** Borra el registro; con `quitarInstalacion` tambien para su instalacion (y con `borrarDatos`, la borra). */
  borrar(id: string, opciones?: { quitarInstalacion?: boolean; borrarDatos?: boolean }): Promise<{ ok: boolean; instalacion: ResultadoInstalacion }>;
  /** Lo que se le responde a la tienda que pregunta con su token; null si no vale. */
  planPara(slug: string, token: string, ip: string | null): Promise<PlanRemoto | null>;
}

export interface DepsTiendas {
  repo: TiendasRepo;
  /** La direccion publica de este servidor, para armar la URL del plan. */
  baseUrl: string;
  /**
   * La direccion con la que las INSTALACIONES llegan a este panel, si no es
   * la publica (por ejemplo, dentro de la red de Docker). Vacio = la publica.
   */
  urlPlanInterna?: string;
  /** Levantar instalaciones en este servidor (Docker). Sin el, solo se registra. */
  alojamiento?: Alojamiento;
  ahora?: () => Date;
}

const SIN_ALOJAMIENTO: EstadoAlojamiento = { disponible: false, dominioBase: null, motivo: 'Este panel no tiene alojamiento: las tiendas se registran aquí y su instalación se hace aparte.' };

export const nuevoTokenTienda = () => `plt_${randomBytes(24).toString('base64url')}`;
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const EN_LINEA_MS = 20 * 60_000;

export function slugDe(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

export function slugValido(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(slug)) return 'El identificador lleva entre 2 y 30 caracteres: minúsculas, números y guiones.';
  return null;
}

export function crearServicioTiendas(deps: DepsTiendas): ServicioTiendas {
  const { repo } = deps;
  const ahora = deps.ahora ?? (() => new Date());
  const base = deps.baseUrl.replace(/\/+$/, '');
  const baseInterna = (deps.urlPlanInterna ?? '').trim().replace(/\/+$/, '') || base;
  const alojamiento = deps.alojamiento ?? null;
  const estadoAlojamiento = () => alojamiento?.estado() ?? SIN_ALOJAMIENTO;

  function vista(t: Tienda): TiendaVista {
    const plan = planDeMembresia(t.membresia, ahora());
    const enLinea = Boolean(t.ultimaConsultaAt && ahora().getTime() - t.ultimaConsultaAt.getTime() < EN_LINEA_MS);
    const semaforo: TiendaVista['semaforo'] = plan.vencido ? 'rojo' : plan.diasRestantes <= 7 || !t.ultimaConsultaAt ? 'ambar' : 'verde';
    const { tokenHash: _h, ...resto } = t;
    return { ...resto, plan, semaforo, enLinea, urlPlan: `${base}/api/plan/${t.slug}`, instalada: Boolean(alojamiento?.existe(t.slug)) };
  }

  return {
    async listar() {
      const tiendas = (await repo.listar()).map(vista);
      const hoy = ahora();
      const resumen = {
        total: tiendas.length,
        activas: tiendas.filter((t) => !t.plan.vencido).length,
        porVencer: tiendas.filter((t) => !t.plan.vencido && t.plan.diasRestantes <= 7).length,
        vencidas: tiendas.filter((t) => t.plan.vencido && t.membresia.estado !== 'suspendida').length,
        suspendidas: tiendas.filter((t) => t.membresia.estado === 'suspendida').length,
        enLinea: tiendas.filter((t) => t.enLinea).length,
        ingresosMes: tiendas.filter((t) => !t.plan.vencido && new Date(t.membresia.vencimiento) > hoy).reduce((s, t) => s + (t.membresia.precioMes || 0), 0),
        moneda: tiendas[0]?.membresia.moneda ?? PLANES_ELEGIBLES[0]!.moneda,
      };
      return { tiendas, resumen, alojamiento: estadoAlojamiento() };
    },
    async porId(id) {
      const t = await repo.porId(id);
      return t ? vista(t) : null;
    },
    async crear(entrada, quien) {
      const nombre = entrada.nombre.trim();
      if (!nombre) throw new Error('La tienda necesita un nombre.');
      const slug = (entrada.slug?.trim() || slugDe(nombre)).toLowerCase();
      const mal = slugValido(slug);
      if (mal) throw new Error(mal);
      if (await repo.porSlug(slug)) throw new Error(`Ya hay una tienda con el identificador "${slug}".`);
      const url = (entrada.url ?? '').trim();
      if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('La dirección de la tienda tiene que empezar por http:// o https://.');
      const token = nuevoTokenTienda();
      const t = await repo.crear({
        slug,
        nombre,
        url: url || null,
        contacto: entrada.contacto?.trim() || null,
        notas: entrada.notas?.trim() || null,
        membresia: armarMembresia(entrada.membresia, null, ahora(), quien),
        tokenHash: hashToken(token),
        tokenPrefijo: token.slice(0, 10),
        creadoPor: quien,
      });
      // Su instalacion, si se pidio y este servidor puede: nace ya apuntando
      // a este panel (PLAN_URL + PLAN_TOKEN en su .env). Si falla, la tienda
      // queda registrada igual y se dice que fallo: se reintenta o se hace a mano.
      const instalacion: ResultadoInstalacion = { intentada: false, ok: false, url: null, error: null };
      if (entrada.crearInstalacion && alojamiento?.estado().disponible) {
        instalacion.intentada = true;
        try {
          const r = await alojamiento.crear({ slug, nombre, token, urlPlan: `${baseInterna}/api/plan/${slug}`, proveedor: entrada.proveedor });
          instalacion.ok = true;
          instalacion.url = r.url;
          await repo.actualizar(t.id, { url: r.url });
        } catch (error) {
          instalacion.error = error instanceof Error ? error.message : String(error);
        }
      }
      const final = (await repo.porId(t.id)) ?? t;
      return { tienda: vista(final), token, instalacion };
    },
    async cambiar(id, cambio, quien) {
      const t = await repo.porId(id);
      if (!t) return null;
      const patch: Parameters<TiendasRepo['actualizar']>[1] = {};
      if (cambio.nombre !== undefined) {
        if (!cambio.nombre.trim()) throw new Error('La tienda necesita un nombre.');
        patch.nombre = cambio.nombre.trim();
      }
      if (cambio.url !== undefined) {
        const url = (cambio.url ?? '').trim();
        if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('La dirección de la tienda tiene que empezar por http:// o https://.');
        patch.url = url || null;
      }
      if (cambio.contacto !== undefined) patch.contacto = cambio.contacto?.trim() || null;
      if (cambio.notas !== undefined) patch.notas = cambio.notas?.trim() || null;
      if (cambio.membresia) patch.membresia = armarMembresia(cambio.membresia, t.membresia, ahora(), quien);
      const n = await repo.actualizar(id, patch);
      return n ? vista(n) : null;
    },
    async anotarPago(id, pago, quien) {
      const t = await repo.porId(id);
      if (!t) return null;
      const n = await repo.actualizar(id, { membresia: membresiaConPago(t.membresia, pago, ahora(), quien) });
      return n ? vista(n) : null;
    },
    async suspender(id, suspendida, quien) {
      const t = await repo.porId(id);
      if (!t) return null;
      const n = await repo.actualizar(id, { membresia: { ...t.membresia, estado: suspendida ? 'suspendida' : 'activa', actualizadoEn: ahora().toISOString(), actualizadoPor: quien } });
      return n ? vista(n) : null;
    },
    async rotarToken(id) {
      const t = await repo.porId(id);
      if (!t) return null;
      const token = nuevoTokenTienda();
      const n = await repo.actualizar(id, { tokenHash: hashToken(token), tokenPrefijo: token.slice(0, 10) });
      return n ? { tienda: vista(n), token } : null;
    },
    async borrar(id, opciones = {}) {
      const t = await repo.porId(id);
      if (!t) return { ok: false, instalacion: { intentada: false, ok: false, url: null, error: null } };
      const instalacion: ResultadoInstalacion = { intentada: false, ok: false, url: null, error: null };
      if (opciones.quitarInstalacion && alojamiento?.existe(t.slug)) {
        instalacion.intentada = true;
        try {
          await alojamiento.quitar(t.slug, Boolean(opciones.borrarDatos));
          instalacion.ok = true;
        } catch (error) {
          instalacion.error = error instanceof Error ? error.message : String(error);
        }
      }
      return { ok: await repo.borrar(id), instalacion };
    },
    async planPara(slug, token, ip) {
      const t = await repo.porSlug(slug);
      if (!t || !token) return null;
      const a = Buffer.from(hashToken(token));
      const b = Buffer.from(t.tokenHash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      await repo.anotarConsulta(t.id, ahora(), ip);
      return planDeMembresia(t.membresia, ahora());
    },
  };
}

export type { MembresiaLocal };
