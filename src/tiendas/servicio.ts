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
 *
 * Segunda ronda (el panel del dueño):
 *  - con cada consulta la tienda manda su PARTE DE SALUD (cabecera
 *    `x-gsgchat-estado`: WhatsApp conectado o caido, mensajes de hoy, fallos
 *    de IA, entregas de hoy, version) y aqui se guarda y se enseña en
 *    palabras ("WhatsApp caido, parte de hace 12 min");
 *  - el dueño configura COMO LE PAGAN (Yape/Plin + QR) y cada tienda lo ve en
 *    su pantalla /pagar; desde alli manda la CAPTURA del pago, que aqui se
 *    revisa con un clic (apuntar el pago corre el vencimiento) o se rechaza
 *    con un motivo que la tienda lee;
 *  - el historial de cada tienda sale de la bitacora, y se le puede escribir
 *    por WhatsApp desde la misma fila.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { armarMembresia, membresiaConPago, planDeMembresia, PLANES_ELEGIBLES, type CobroPlan, type EntradaMembresia, type EstadoInstancia, type MembresiaLocal, type PagoCapturaVista, type PlanRemoto } from '../plan/servicio.js';
import type { ActividadRepo, EntradaActividad } from '../auth/actividad.js';
import type { Sender } from '../outbound/sender.js';
import { revisarTelefono } from '../rutas/telefono.js';
import type { AvisoTienda, PagoTienda, Tienda, TiendasRepo } from './repo.js';
import type { Alojamiento, EstadoAlojamiento } from './alojamiento.js';

export type NivelSalud = 'ok' | 'warn' | 'bad' | 'sin';

/** La salud de una tienda, en palabras, a partir de su ultimo parte. */
export interface SaludTienda {
  whatsapp: { nivel: NivelSalud; texto: string };
  mensajes: { nivel: NivelSalud; texto: string };
  ia: { nivel: NivelSalud; texto: string };
  entregasHoy: number | null;
  version: string | null;
  /** Cuando llego el ultimo parte, y "hace N min". */
  parteAt: string | null;
  hace: string | null;
  /** El parte tiene mas de 40 minutos: la tienda dejo de preguntar (o esta apagada). */
  parteViejo: boolean;
}

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
  /** Lo que dijo su ultimo parte de salud, en palabras. */
  salud: SaludTienda;
  /** El WhatsApp del contacto de la tienda, si en "contacto" hay un numero. */
  telefonoContacto: string | null;
  /** Capturas de pago esperando revision. */
  pagosPendientes: number;
}

/** Una captura de pago tal como la ve el dueño en Tiendas (sin la imagen; se pide aparte). */
export interface PagoVista extends Omit<PagoTienda, 'imagen'> {
  tienda: { id: string; nombre: string; slug: string } | null;
}

/** Como el dueño quiere que le paguen (lo ven las tiendas en /pagar). */
export interface CobroConfig extends CobroPlan {
  /** Si esta apagado, las tiendas no ven nada de esto. */
  activo: boolean;
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

export interface ResumenTiendas {
  total: number;
  activas: number;
  porVencer: number;
  vencidas: number;
  suspendidas: number;
  enLinea: number;
  /** Tiendas cuyo ultimo parte dice que el WhatsApp esta caido o sin vincular. */
  conProblemas: number;
  pagosPendientes: number;
  ingresosMes: number;
  moneda: string;
}

export interface ServicioTiendas {
  listar(): Promise<{ tiendas: TiendaVista[]; resumen: ResumenTiendas; alojamiento: EstadoAlojamiento; cobro: CobroConfig; pagosPendientes: PagoVista[] }>;
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
  /**
   * Lo que se le responde a la tienda que pregunta con su token; null si no
   * vale. Si la tienda mando su parte de salud, se guarda.
   */
  planPara(slug: string, token: string, ip: string | null, estado?: EstadoInstancia | null): Promise<PlanRemoto | null>;
  /** La tienda manda la captura de su pago (desde /pagar, con su token). */
  recibirPago(slug: string, token: string, entrada: { imagen: string; meses: number; monto?: number | null; nota?: string | null }): Promise<{ ok: true; pago: PagoCapturaVista } | { ok: false; error: string; codigo: 401 | 400 }>;
  /** Una captura entera (con imagen), para verla en Tiendas. */
  pago(id: number): Promise<(PagoVista & { imagen: string | null }) | null>;
  /** Un clic: apunta el pago (corre el vencimiento) y cierra la captura. */
  aceptarPago(id: number, quien: string | null, cambio?: { meses?: number; monto?: number }): Promise<{ ok: true; tienda: TiendaVista; pago: PagoVista; mensaje: string } | { ok: false; error: string }>;
  rechazarPago(id: number, motivo: string, quien: string | null): Promise<{ ok: true; pago: PagoVista } | { ok: false; error: string }>;
  cobro(): Promise<CobroConfig>;
  guardarCobro(cambio: Partial<CobroConfig>): Promise<CobroConfig>;
  /** Lo que se hizo con esa tienda (alta, pagos, suspensiones...), de la bitacora. */
  historial(id: string): Promise<Array<{ at: string; usuario: string; accion: string; etiqueta: string; detalle: Record<string, unknown> | null }>>;
  /** Un WhatsApp al contacto de la tienda, escrito por el dueño. */
  avisar(id: string, texto: string): Promise<{ ok: true; telefono: string } | { ok: false; error: string }>;
  /** El WhatsApp del contacto, si lo hay. */
  telefonoDe(tienda: Pick<Tienda, 'contacto'>): string | null;
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
  /** La bitacora, para el historial por tienda. Sin ella, el historial va vacio. */
  actividad?: ActividadRepo;
  /** Para escribirle a la tienda por WhatsApp desde la pantalla. */
  sender?: Sender;
  ahora?: () => Date;
}

const SIN_ALOJAMIENTO: EstadoAlojamiento = { disponible: false, dominioBase: null, motivo: 'Este panel no tiene alojamiento: las tiendas se registran aquí y su instalación se hace aparte.' };

export const nuevoTokenTienda = () => `plt_${randomBytes(24).toString('base64url')}`;
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const EN_LINEA_MS = 20 * 60_000;
/** Un parte de mas de 40 minutos ya no dice como esta la tienda ahora. */
const PARTE_VIEJO_MS = 40 * 60_000;
const CLAVE_COBRO = 'cobro';

export const COBRO_POR_DEFECTO: CobroConfig = { activo: false, texto: '', numero: '', qr: '' };

/** Etiquetas de la bitacora que son de tiendas (ver src/auth/actividad.ts). */
export const ETIQUETAS_TIENDA: Record<string, string> = {
  'tienda.alta': 'Dio de alta la tienda',
  'tienda.cambiar': 'Cambió la tienda (nombre, plan o datos)',
  'tienda.pago': 'Apuntó un pago',
  'tienda.suspender': 'Suspendió o reactivó la tienda',
  'tienda.token': 'Creó un token nuevo',
  'tienda.borrar': 'Borró la tienda',
  'tienda.avisar': 'Le escribió por WhatsApp',
  'tienda.pago.aceptar': 'Aceptó una captura de pago',
  'tienda.pago.rechazar': 'Rechazó una captura de pago',
};

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

/** Una fecha como la escribe la gente aqui: 05/10/2026, en hora de Lima. */
export function fechaLima(d: Date | string): string {
  return new Date(d).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "hace 3 min", "hace 2 h", "hace 3 días". */
export function haceCuanto(desde: Date, ahora: Date): string {
  const min = Math.max(0, Math.round((ahora.getTime() - desde.getTime()) / 60_000));
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d === 1 ? '' : 's'}`;
}

/** El parte de salud de una tienda, en palabras. */
export function saludDe(t: Pick<Tienda, 'estado' | 'estadoAt'>, ahora: Date): SaludTienda {
  if (!t.estado || !t.estadoAt) {
    const sin = { nivel: 'sin' as const, texto: 'Sin parte todavía' };
    return { whatsapp: sin, mensajes: sin, ia: sin, entregasHoy: null, version: null, parteAt: null, hace: null, parteViejo: false };
  }
  const e = t.estado;
  const hace = haceCuanto(t.estadoAt, ahora);
  const viejo = ahora.getTime() - t.estadoAt.getTime() > PARTE_VIEJO_MS;
  const whatsapp =
    e.whatsapp === 'conectado'
      ? { nivel: 'ok' as const, texto: viejo ? `WhatsApp conectado en su último parte (${hace})` : 'WhatsApp conectado' }
      : e.whatsapp === 'caido'
        ? { nivel: 'bad' as const, texto: `WhatsApp caído (parte de ${hace})` }
        : { nivel: 'warn' as const, texto: 'WhatsApp sin vincular' };
  const mensajes = { nivel: (e.mensajesHoy > 0 ? 'ok' : 'sin') as NivelSalud, texto: e.mensajesHoy === 1 ? '1 mensaje hoy' : `${e.mensajesHoy} mensajes hoy` };
  const ia = e.fallosIA > 0 ? { nivel: 'warn' as const, texto: e.fallosIA === 1 ? '1 fallo de IA hoy' : `${e.fallosIA} fallos de IA hoy` } : { nivel: 'ok' as const, texto: 'IA sin fallos hoy' };
  return { whatsapp, mensajes, ia, entregasHoy: Number.isFinite(e.entregasHoy) ? e.entregasHoy : null, version: e.version || null, parteAt: t.estadoAt.toISOString(), hace, parteViejo: viejo };
}

/** Un numero de WhatsApp dentro de "Rosa · 987 654 321", si lo hay. */
export function telefonoEnTexto(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = texto.match(/\+?\d[\d\s.-]{7,}\d/);
  if (!m) return null;
  const r = revisarTelefono(m[0]);
  return r.ok ? r.phone : null;
}

const pagoVista = (p: PagoTienda, tienda: Tienda | null): PagoVista => {
  const { imagen: _i, ...resto } = p;
  return { ...resto, tienda: tienda ? { id: tienda.id, nombre: tienda.nombre, slug: tienda.slug } : null };
};

const capturaVista = (p: PagoTienda): PagoCapturaVista => ({ id: p.id, meses: p.meses, monto: p.monto, moneda: p.moneda, nota: p.nota, estado: p.estado, motivo: p.motivo, at: p.at.toISOString(), resueltoAt: p.resueltoAt ? p.resueltoAt.toISOString() : null });

export function crearServicioTiendas(deps: DepsTiendas): ServicioTiendas {
  const { repo } = deps;
  const ahora = deps.ahora ?? (() => new Date());
  const base = deps.baseUrl.replace(/\/+$/, '');
  const baseInterna = (deps.urlPlanInterna ?? '').trim().replace(/\/+$/, '') || base;
  const alojamiento = deps.alojamiento ?? null;
  const estadoAlojamiento = () => alojamiento?.estado() ?? SIN_ALOJAMIENTO;

  async function pendientesDe(id: string): Promise<number> {
    return (await repo.pagos({ tiendaId: id, estado: 'pendiente', limit: 50 })).length;
  }

  async function vista(t: Tienda): Promise<TiendaVista> {
    const plan = planDeMembresia(t.membresia, ahora());
    const enLinea = Boolean(t.ultimaConsultaAt && ahora().getTime() - t.ultimaConsultaAt.getTime() < EN_LINEA_MS);
    const semaforo: TiendaVista['semaforo'] = plan.vencido ? 'rojo' : plan.diasRestantes <= 7 || !t.ultimaConsultaAt ? 'ambar' : 'verde';
    const { tokenHash: _h, ...resto } = t;
    return {
      ...resto,
      plan,
      semaforo,
      enLinea,
      urlPlan: `${base}/api/plan/${t.slug}`,
      instalada: Boolean(alojamiento?.existe(t.slug)),
      salud: saludDe(t, ahora()),
      telefonoContacto: telefonoEnTexto(t.contacto),
      pagosPendientes: await pendientesDe(t.id),
    };
  }

  async function cobro(): Promise<CobroConfig> {
    const g = await repo.config<Partial<CobroConfig>>(CLAVE_COBRO);
    return { ...COBRO_POR_DEFECTO, ...(g ?? {}) };
  }

  /** Lo que ve la tienda de como pagar: solo si esta activo y hay algo escrito. */
  async function cobroParaTienda(): Promise<CobroPlan | null> {
    const c = await cobro();
    if (!c.activo || (!c.texto && !c.numero && !c.qr)) return null;
    return { texto: c.texto, numero: c.numero, qr: c.qr };
  }

  async function tiendaConToken(slug: string, token: string): Promise<Tienda | null> {
    const t = await repo.porSlug(slug);
    if (!t || !token) return null;
    const a = Buffer.from(hashToken(token));
    const b = Buffer.from(t.tokenHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return t;
  }

  return {
    async listar() {
      const tiendas: TiendaVista[] = [];
      const filas = await repo.listar();
      for (const t of filas) tiendas.push(await vista(t));
      const hoy = ahora();
      const pendientes = await repo.pagos({ estado: 'pendiente', limit: 200 });
      const porId = new Map(filas.map((t) => [t.id, t]));
      const resumen: ResumenTiendas = {
        total: tiendas.length,
        activas: tiendas.filter((t) => !t.plan.vencido).length,
        porVencer: tiendas.filter((t) => !t.plan.vencido && t.plan.diasRestantes <= 7).length,
        vencidas: tiendas.filter((t) => t.plan.vencido && t.membresia.estado !== 'suspendida').length,
        suspendidas: tiendas.filter((t) => t.membresia.estado === 'suspendida').length,
        enLinea: tiendas.filter((t) => t.enLinea).length,
        conProblemas: tiendas.filter((t) => t.salud.whatsapp.nivel === 'bad' || t.salud.whatsapp.nivel === 'warn').length,
        pagosPendientes: pendientes.length,
        ingresosMes: tiendas.filter((t) => !t.plan.vencido && new Date(t.membresia.vencimiento) > hoy).reduce((s, t) => s + (t.membresia.precioMes || 0), 0),
        moneda: tiendas[0]?.membresia.moneda ?? PLANES_ELEGIBLES[0]!.moneda,
      };
      return { tiendas, resumen, alojamiento: estadoAlojamiento(), cobro: await cobro(), pagosPendientes: pendientes.map((p) => pagoVista(p, porId.get(p.tiendaId) ?? null)) };
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
      return { tienda: await vista(final), token, instalacion };
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
      return n ? { tienda: await vista(n), token } : null;
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
    async planPara(slug, token, ip, estado) {
      const t = await tiendaConToken(slug, token);
      if (!t) return null;
      await repo.anotarConsulta(t.id, ahora(), ip);
      if (estado) await repo.anotarEstado(t.id, estado, ahora());
      const ultimo = (await repo.pagos({ tiendaId: t.id, limit: 1 }))[0];
      return { ...planDeMembresia(t.membresia, ahora()), cobro: await cobroParaTienda(), ultimoPago: ultimo ? capturaVista(ultimo) : null };
    },
    async recibirPago(slug, token, entrada) {
      const t = await tiendaConToken(slug, token);
      if (!t) return { ok: false, error: 'Tienda o token incorrectos.', codigo: 401 };
      if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(entrada.imagen)) return { ok: false, error: 'La captura tiene que ser una imagen (PNG, JPG o WebP).', codigo: 400 };
      if (entrada.imagen.length > 3_000_000) return { ok: false, error: 'La captura pesa demasiado (máximo 2 MB).', codigo: 400 };
      if (!Number.isInteger(entrada.meses) || entrada.meses < 1 || entrada.meses > 60) return { ok: false, error: 'Los meses tienen que ser un número entero entre 1 y 60.', codigo: 400 };
      // Una captura pendiente por tienda: la nueva sustituye a la anterior sin revisar.
      for (const p of await repo.pagos({ tiendaId: t.id, estado: 'pendiente', limit: 20 })) {
        await repo.resolverPago(p.id, { estado: 'rechazado', motivo: 'La tienda mandó otra captura después.', por: null, at: ahora() });
      }
      const pago = await repo.crearPago({ tiendaId: t.id, meses: entrada.meses, monto: entrada.monto ?? null, moneda: t.membresia.moneda, nota: (entrada.nota ?? '').trim().slice(0, 300) || null, imagen: entrada.imagen }, ahora());
      return { ok: true, pago: capturaVista(pago) };
    },
    async pago(id) {
      const p = await repo.pago(id);
      if (!p) return null;
      return { ...pagoVista(p, await repo.porId(p.tiendaId)), imagen: p.imagen };
    },
    async aceptarPago(id, quien, cambio = {}) {
      const p = await repo.pago(id);
      if (!p) return { ok: false, error: 'Esa captura no existe.' };
      if (p.estado !== 'pendiente') return { ok: false, error: `Esa captura ya se ${p.estado === 'aceptado' ? 'aceptó' : 'rechazó'}.` };
      const t = await repo.porId(p.tiendaId);
      if (!t) return { ok: false, error: 'La tienda de esa captura ya no existe.' };
      const meses = cambio.meses ?? p.meses;
      const monto = cambio.monto ?? p.monto ?? 0;
      const n = await repo.actualizar(t.id, { membresia: membresiaConPago(t.membresia, { meses, monto, moneda: p.moneda ?? undefined, nota: `Captura #${p.id}${p.nota ? `: ${p.nota}` : ''}` }, ahora(), quien) });
      const resuelto = (await repo.resolverPago(id, { estado: 'aceptado', motivo: null, por: quien, at: ahora() })) ?? p;
      const tienda = await vista(n ?? t);
      return { ok: true, tienda, pago: pagoVista(resuelto, t), mensaje: `Pago apuntado: ${meses} mes${meses === 1 ? '' : 'es'}. ${tienda.nombre} queda pagada hasta el ${fechaLima(tienda.membresia.vencimiento)}.` };
    },
    async rechazarPago(id, motivo, quien) {
      const p = await repo.pago(id);
      if (!p) return { ok: false, error: 'Esa captura no existe.' };
      if (p.estado !== 'pendiente') return { ok: false, error: `Esa captura ya se ${p.estado === 'aceptado' ? 'aceptó' : 'rechazó'}.` };
      const texto = motivo.trim();
      if (!texto) return { ok: false, error: 'Escribe por qué se rechaza: la tienda lo va a leer.' };
      const r = (await repo.resolverPago(id, { estado: 'rechazado', motivo: texto.slice(0, 300), por: quien, at: ahora() })) ?? p;
      return { ok: true, pago: pagoVista(r, await repo.porId(p.tiendaId)) };
    },
    cobro,
    async guardarCobro(cambio) {
      const actual = await cobro();
      const nuevo: CobroConfig = {
        activo: cambio.activo ?? actual.activo,
        texto: (cambio.texto ?? actual.texto).trim().slice(0, 600),
        numero: (cambio.numero ?? actual.numero).trim().slice(0, 40),
        qr: cambio.qr === undefined ? actual.qr : cambio.qr,
      };
      if (nuevo.qr && !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(nuevo.qr)) throw new Error('El QR tiene que ser una imagen (PNG, JPG o WebP).');
      if (nuevo.qr.length > 1_500_000) throw new Error('El QR pesa demasiado: sube una imagen más pequeña (máximo 1 MB).');
      await repo.guardarConfig(CLAVE_COBRO, nuevo);
      return nuevo;
    },
    async historial(id) {
      const t = await repo.porId(id);
      if (!t) return [];
      const salida: Array<{ at: string; usuario: string; accion: string; etiqueta: string; detalle: Record<string, unknown> | null }> = [];
      if (deps.actividad) {
        const { items } = await deps.actividad.listar({ limit: 500, offset: 0 });
        const esDeEsta = (e: EntradaActividad): boolean => {
          if (!e.accion.startsWith('tienda.')) return false;
          const d = e.detalle ?? {};
          if (d.id === t.id) return true;
          if (e.accion === 'tienda.alta') return d.nombre === t.nombre || d.slug === t.slug;
          if (e.accion.startsWith('tienda.pago.')) return d.tiendaId === t.id;
          return false;
        };
        for (const e of items.filter(esDeEsta)) {
          salida.push({ at: e.at.toISOString(), usuario: e.usuario, accion: e.accion, etiqueta: ETIQUETAS_TIENDA[e.accion] ?? e.accion, detalle: e.detalle });
        }
      }
      // Los pagos apuntados viven en la membresia: por si la bitacora no los
      // tiene (o se borro). Cada pago de la bitacora "gasta" uno de la membresia
      // con los mismos meses y monto, para no enseñarlo dos veces.
      const enBitacora = salida.filter((s) => s.accion === 'tienda.pago' || s.accion === 'tienda.pago.aceptar').map((s) => ({ usado: false, meses: Number(s.detalle?.meses ?? NaN), monto: Number(s.detalle?.monto ?? NaN) }));
      for (const p of t.membresia.pagos) {
        const gemelo = enBitacora.find((b) => !b.usado && (Number.isNaN(b.meses) || b.meses === p.meses) && (Number.isNaN(b.monto) || b.monto === p.monto));
        if (gemelo) {
          gemelo.usado = true;
          continue;
        }
        salida.push({ at: p.fecha, usuario: p.por ?? 'sistema', accion: 'tienda.pago', etiqueta: ETIQUETAS_TIENDA['tienda.pago']!, detalle: { meses: p.meses, monto: p.monto, moneda: p.moneda, nota: p.nota } });
      }
      if (!salida.some((s) => s.accion === 'tienda.alta')) {
        salida.push({ at: t.createdAt.toISOString(), usuario: t.creadoPor ?? 'sistema', accion: 'tienda.alta', etiqueta: ETIQUETAS_TIENDA['tienda.alta']!, detalle: { nombre: t.nombre, plan: t.membresia.plan } });
      }
      return salida.sort((a, b) => b.at.localeCompare(a.at));
    },
    async avisar(id, texto) {
      const t = await repo.porId(id);
      if (!t) return { ok: false, error: 'Esa tienda no existe.' };
      const telefono = telefonoEnTexto(t.contacto);
      if (!telefono) return { ok: false, error: 'La tienda no tiene un WhatsApp en su contacto. Ponlo con "Cambiar datos" (por ejemplo: Rosa · 987 654 321).' };
      const cuerpo = texto.trim();
      if (!cuerpo) return { ok: false, error: 'Escribe el mensaje.' };
      if (!deps.sender) return { ok: false, error: 'Este arranque no puede mandar WhatsApp desde Tiendas.' };
      const r = await deps.sender.send({ phone: telefono, kind: 'freeform', category: 'UTILITY', text: cuerpo.slice(0, 2000), manual: true, origen: 'persona' });
      if (!r.ok) return { ok: false, error: `No salió: ${r.blocked ? r.reason : r.error}. Revisa la Conexión de WhatsApp.` };
      return { ok: true, telefono };
    },
    telefonoDe: (t) => telefonoEnTexto(t.contacto),
  };
}

export type { MembresiaLocal, AvisoTienda };
