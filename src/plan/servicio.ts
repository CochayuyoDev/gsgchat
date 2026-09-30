/**
 * El plan de esta instancia, visto desde dentro.
 *
 * En el SaaS cada tienda nace con PLAN_URL y PLAN_TOKEN en su .env: la
 * direccion del maestro donde pregunta por su plan y el token que la
 * identifica. Cada cuarto de hora (y al arrancar) se le pregunta, la
 * respuesta se guarda en settings (`plan.estado`) para que un reinicio
 * no arranque a ciegas, y con eso se decide que se puede hacer:
 *
 *  - vencido: la IA y las campañas se paran; los chats siguen.
 *  - con tope de turnos de IA al mes: al llegar, la IA se para hasta el mes
 *    que viene (el conteo vive en settings, `plan.uso`).
 *
 * Si el maestro no responde se sigue con lo ultimo que dijo: una caida del
 * maestro no puede parar a las tiendas.
 *
 * Sin PLAN_URL (una instalacion suelta, fuera del SaaS) la membresia la
 * lleva el **superadministrador** de la propia instancia, desde la pantalla
 * Membresia: elige el plan, hasta cuando esta pagada, los topes, apunta los
 * pagos y puede suspenderla. Se guarda en settings (`plan.local`) y manda
 * exactamente igual que si viniera del maestro. Con maestro, lo local no
 * cuenta: manda el maestro y la pantalla es de solo lectura. Sin ninguna de
 * las dos cosas, la instancia es libre y todo esta permitido.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { SettingsRepo } from '../settings/service.js';

/** Lo que se guarda del acceso de soporte: el codigo solo como hash; el enlace, para mandarselo al maestro. */
interface SoporteGuardado {
  hash: string;
  hasta: string;
  enlace: string;
  concedidoEn: string;
}
import { MONEDA_PLANES, PLANES, type NombrePlan } from '../../saas/planes.js';

export interface LimitesPlan {
  iaTurnosMes: number | null;
  campanas: boolean;
  conectores: boolean;
  usuarios: number | null;
}

/** Lo que manda el maestro (saas/planes.ts, EstadoPlan). */
export interface PlanRemoto {
  plan: string;
  nombre: string;
  limites: LimitesPlan;
  precioMes: number;
  moneda: string;
  vencimiento: string;
  diasRestantes: number;
  vencido: boolean;
  aviso: string | null;
  contacto: string | null;
  /** Solo lo manda el maestro: como se le paga (ver CobroPlan). */
  cobro?: CobroPlan | null;
  /** Solo lo manda el maestro: la ultima captura de pago que mando esta tienda. */
  ultimoPago?: PagoCapturaVista | null;
}

export type Capacidad = 'ia' | 'campanas' | 'conectores';

/**
 * El parte de salud que cada instalacion manda al maestro cuando pregunta
 * por su plan (cabecera `x-gsgchat-estado`). El maestro lo guarda y lo
 * enseña en Tiendas: "WhatsApp caido desde las 10:12", no `wa: false`.
 */
export interface EstadoInstancia {
  whatsapp: 'conectado' | 'caido' | 'sin_conectar';
  mensajesHoy: number;
  fallosIA: number;
  entregasHoy: number;
  version: string;
  /**
   * Acceso de soporte concedido por la tienda: hasta cuando y el enlace con el
   * que el dueño entra a su panel. Lo pone el servicio del plan, no quien
   * arma el parte.
   */
  soporte?: { hasta: string; enlace: string } | null;
}

/** El acceso de soporte que la tienda concede al dueño del sistema (24 h). */
export interface AccesoSoporte {
  hasta: string;
  enlace: string;
  concedidoEn: string;
}

/** Como se le paga al dueño: lo configura en Tiendas y lo ve cada tienda en /pagar. */
export interface CobroPlan {
  /** "Yape o Plin al 987 654 321, a nombre de..." */
  texto: string;
  /** El numero de Yape/Plin, tal cual se escribio. */
  numero: string;
  /** El QR, como data URL (base64); vacio = sin QR. */
  qr: string;
}

/** La ultima captura de pago que mando la tienda, tal como la ve en /pagar. */
export interface PagoCapturaVista {
  id: number;
  meses: number;
  monto: number | null;
  moneda: string | null;
  nota: string | null;
  estado: 'pendiente' | 'aceptado' | 'rechazado';
  motivo: string | null;
  at: string;
  resueltoAt: string | null;
}

/** Lo que enseña /pagar en la tienda. */
export interface ParaPagar {
  origen: EstadoPlanLocal['origen'];
  plan: PlanRemoto | null;
  /** Solo con maestro: como se le paga al dueño (si lo configuro). */
  cobro: CobroPlan | null;
  ultimoPago: PagoCapturaVista | null;
  /** Se puede mandar la captura (hay maestro con token). */
  puedeMandarCaptura: boolean;
  /** Por que no, en palabras. */
  motivo: string | null;
}

/** Un pago apuntado a mano por el superadministrador. */
export interface PagoLocal {
  fecha: string;
  meses: number;
  monto: number;
  moneda: string;
  nota: string;
  por: string | null;
}

/** La membresia que lleva el superadministrador cuando no hay maestro. */
export interface MembresiaLocal {
  /** prueba | basico | pro | personalizado */
  plan: string;
  nombre: string;
  limites: LimitesPlan;
  precioMes: number;
  moneda: string;
  /** Hasta cuando esta pagada (ISO). */
  vencimiento: string;
  /** Suspendida = como vencida, aunque este pagada (impago, abuso...). */
  estado: 'activa' | 'suspendida';
  /** Lo que se le dice al negocio para renovar ("escribenos al ..."). */
  contacto: string | null;
  /** Un aviso propio que vera el negocio en el panel. */
  aviso: string | null;
  pagos: PagoLocal[];
  actualizadoEn: string;
  actualizadoPor: string | null;
}

export interface EstadoPlanLocal {
  /** 'maestro' si manda el maestro del SaaS; 'local' si la lleva el superadmin de aqui; 'libre' si no hay membresia. */
  origen: 'maestro' | 'local' | 'libre';
  /** true = el superadministrador de esta instancia puede cambiarla (no hay maestro). */
  editable: boolean;
  /** Lo guardado localmente, tal cual (solo lo ve el superadmin). */
  local: MembresiaLocal | null;
  /** El maestro del que depende esta instalacion, si lo hay (sin el token). */
  maestro: { url: string; origen: 'env' | 'pantalla'; tieneToken: boolean } | null;
  plan: PlanRemoto | null;
  /** Turnos de IA gastados este mes. */
  iaTurnosMes: number;
  mes: string;
  /** Cuando se hablo con el maestro por ultima vez, y si fallo. */
  consultadoEn: string | null;
  error: string | null;
  /** Lo que ve el panel: el aviso del maestro, o el del tope de IA. */
  aviso: { nivel: 'warn' | 'bad'; texto: string } | null;
}

export interface ServicioPlan {
  estado(): EstadoPlanLocal;
  /** Si el plan deja hacer esto ahora mismo. Sin plan, siempre. */
  permite(que: Capacidad): boolean;
  /** Por que no se permite, en palabras para el panel. */
  motivo(que: Capacidad): string | null;
  /** Un turno de IA mas este mes. */
  anotarTurnoIA(): Promise<void>;
  /** Vuelve a preguntar al maestro. */
  refrescar(): Promise<EstadoPlanLocal>;
  arrancar(): () => void;
  /** Cuantas cuentas permite la membresia (null = sin tope; tambien si es libre). */
  limiteUsuarios(): number | null;
  /** El superadministrador fija (o cambia) la membresia local. Con maestro no se puede. */
  guardarLocal(entrada: EntradaMembresia, quien: string | null): Promise<EstadoPlanLocal>;
  /** Un pago apuntado: corre el vencimiento tantos meses. */
  anotarPago(pago: { meses: number; monto: number; moneda?: string; nota?: string }, quien: string | null): Promise<EstadoPlanLocal>;
  /** Vuelve a instancia libre (sin membresia). */
  quitarLocal(): Promise<EstadoPlanLocal>;
  /** Esta instalacion pasa a depender de un maestro (la pantalla Tiendas de otro superadministrador). */
  conectarMaestro(entrada: { url: string; token: string }): Promise<EstadoPlanLocal>;
  desconectarMaestro(): Promise<EstadoPlanLocal>;
  /** Lo que enseña la pantalla /pagar de esta instalacion. */
  paraPagar(): ParaPagar;
  /**
   * "Ya pague": la captura de Yape/Plin va al maestro, que la enseña al dueño
   * en Tiendas; un clic alli corre el vencimiento. Solo con maestro.
   */
  mandarCaptura(entrada: { imagen: string; meses: number; nota?: string; monto?: number }): Promise<{ ok: true; mensaje: string; pago: PagoCapturaVista } | { ok: false; error: string }>;
  /**
   * Acceso de soporte: la tienda le abre la puerta al dueño del sistema por
   * unas horas (24 por defecto). El enlace viaja al maestro en el parte de
   * salud; caduca solo y se puede quitar antes.
   */
  concederSoporte(horas?: number): Promise<AccesoSoporte>;
  revocarSoporte(): Promise<void>;
  /** El acceso vigente, o null si no hay o ya caduco. */
  soporte(): AccesoSoporte | null;
  /** Si ese codigo del enlace vale ahora mismo. */
  canjearSoporte(codigo: string): boolean;
  /** Avisa cuando el acceso se quita o caduca (para cerrar la cuenta de soporte). */
  alCambiarSoporte(fn: (acceso: AccesoSoporte | null) => void | Promise<void>): void;
}

export interface EntradaMembresia {
  plan: string;
  /** Con un plan del catalogo (prueba/basico/pro) se rellenan solos si no vienen. */
  nombre?: string;
  limites?: Partial<LimitesPlan>;
  precioMes?: number;
  moneda?: string;
  vencimiento: string;
  estado?: 'activa' | 'suspendida';
  contacto?: string | null;
  aviso?: string | null;
}

/** Los planes que se pueden elegir de una lista, mas el personalizado. */
export const PLANES_ELEGIBLES: Array<{ clave: string; nombre: string; precioMes: number; moneda: string; limites: LimitesPlan; descripcion: string }> = [
  ...(Object.entries(PLANES) as Array<[NombrePlan, (typeof PLANES)[NombrePlan]]>).map(([clave, d]) => ({ clave, nombre: d.nombre, precioMes: d.precioMes, moneda: MONEDA_PLANES, limites: d.limites, descripcion: d.descripcion })),
  { clave: 'personalizado', nombre: 'Personalizado', precioMes: 0, moneda: MONEDA_PLANES, limites: { iaTurnosMes: null, campanas: true, conectores: true, usuarios: null }, descripcion: 'Tu eliges cada tope.' },
];

export interface DepsPlan {
  settingsRepo: SettingsRepo;
  /** PLAN_URL y PLAN_TOKEN. Sin URL, la instancia es libre. */
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  ahora?: () => Date;
  cadaMs?: number;
  log?: (m: string, d?: Record<string, unknown>) => void;
  /**
   * El parte de salud de esta instalacion, para mandarselo al maestro en
   * cada consulta (cabecera `x-gsgchat-estado`). Sin el, no se manda nada.
   */
  estado?: () => Promise<EstadoInstancia> | EstadoInstancia;
  /** La direccion publica de esta instalacion, para armar el enlace de soporte. */
  baseUrl?: string;
}

/** Cuantos caracteres puede ocupar el parte en la cabecera (por si algo se desmadra). */
const MAX_CABECERA_ESTADO = 2000;

const CLAVE_ESTADO = 'plan.estado';
const CLAVE_USO = 'plan.uso';
const CLAVE_LOCAL = 'plan.local';
const CLAVE_MAESTRO = 'plan.maestro';
const CLAVE_SOPORTE = 'plan.soporte';

/**
 * Arma (o cambia) una membresia a partir de lo que se escribio en pantalla.
 * Lo que no venga se toma de la anterior, y si no hay, del plan elegido.
 */
/**
 * Una fecha de vencimiento escrita en pantalla ("2026-12-31") vale hasta el
 * FINAL de ese dia en Lima. Sin esto, `new Date('2026-12-31')` es la
 * medianoche UTC, que en Lima es el 30 a las siete de la tarde: la pantalla
 * enseñaba un dia menos del que se escribio.
 */
export function finDelDia(fecha: string): Date {
  const f = fecha.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return new Date(`${f}T23:59:59-05:00`);
  return new Date(f);
}

export function armarMembresia(entrada: EntradaMembresia, anterior: MembresiaLocal | null, ahora: Date, quien: string | null): MembresiaLocal {
  const vence = finDelDia(entrada.vencimiento);
  if (Number.isNaN(vence.getTime())) throw new Error('La fecha de vencimiento no se entiende.');
  const base = PLANES_ELEGIBLES.find((p) => p.clave === entrada.plan) ?? PLANES_ELEGIBLES[PLANES_ELEGIBLES.length - 1]!;
  const limites: LimitesPlan = { ...base.limites, ...(entrada.limites ?? {}) };
  if (limites.iaTurnosMes != null && (!Number.isInteger(limites.iaTurnosMes) || limites.iaTurnosMes < 0)) throw new Error('El tope de respuestas de IA al mes tiene que ser un número entero (0 = sin IA, vacío = sin tope).');
  if (limites.usuarios != null && (!Number.isInteger(limites.usuarios) || limites.usuarios < 1)) throw new Error('El tope de cuentas tiene que ser 1 o más (vacío = sin tope).');
  return {
    plan: base.clave,
    nombre: (entrada.nombre ?? '').trim() || base.nombre,
    limites,
    precioMes: entrada.precioMes ?? anterior?.precioMes ?? base.precioMes,
    moneda: (entrada.moneda ?? anterior?.moneda ?? base.moneda).trim() || base.moneda,
    vencimiento: vence.toISOString(),
    estado: entrada.estado ?? anterior?.estado ?? 'activa',
    contacto: entrada.contacto === undefined ? (anterior?.contacto ?? null) : entrada.contacto?.trim() || null,
    aviso: entrada.aviso === undefined ? (anterior?.aviso ?? null) : entrada.aviso?.trim() || null,
    pagos: anterior?.pagos ?? [],
    actualizadoEn: ahora.toISOString(),
    actualizadoPor: quien,
  };
}

/** Un pago corre el vencimiento tantos meses (desde lo que quede, o desde hoy si ya vencio) y activa. */
export function membresiaConPago(m: MembresiaLocal, pago: { meses: number; monto: number; moneda?: string; nota?: string }, ahora: Date, quien: string | null): MembresiaLocal {
  if (!Number.isInteger(pago.meses) || pago.meses < 1 || pago.meses > 60) throw new Error('Los meses tienen que ser un número entero entre 1 y 60.');
  const desde = new Date(Math.max(new Date(m.vencimiento).getTime(), ahora.getTime()));
  const nuevo = new Date(desde);
  nuevo.setMonth(nuevo.getMonth() + pago.meses);
  return {
    ...m,
    vencimiento: nuevo.toISOString(),
    estado: 'activa',
    pagos: [...m.pagos, { fecha: ahora.toISOString(), meses: pago.meses, monto: Number(pago.monto) || 0, moneda: (pago.moneda ?? m.moneda).trim() || m.moneda, nota: (pago.nota ?? '').trim(), por: quien }].slice(-200),
    actualizadoEn: ahora.toISOString(),
    actualizadoPor: quien,
  };
}

/**
 * El plan de hoy de una membresia, tal como lo ve la instancia (la misma
 * forma que manda el maestro): dias contados desde ahora, vencido si paso
 * la fecha o esta suspendida, y el aviso que toca.
 */
export function planDeMembresia(m: MembresiaLocal, ahora: Date): PlanRemoto {
  const dias = Math.ceil((new Date(m.vencimiento).getTime() - ahora.getTime()) / (24 * 60 * 60 * 1000));
  const suspendida = m.estado === 'suspendida';
  const vencido = dias <= 0 || suspendida;
  const cuando = new Date(m.vencimiento).toLocaleDateString('es-PE');
  let aviso = m.aviso;
  if (!aviso) {
    if (suspendida) aviso = 'La membresía está suspendida: el asistente IA y las campañas están en pausa. Los chats siguen funcionando.';
    else if (vencido) aviso = `La membresía venció el ${cuando}: el asistente IA y las campañas están en pausa. Los chats siguen funcionando.`;
    else if (dias <= 7) aviso = `La membresía vence en ${dias} día${dias === 1 ? '' : 's'} (${cuando}).`;
  }
  return { plan: m.plan, nombre: m.nombre, limites: m.limites, precioMes: m.precioMes, moneda: m.moneda, vencimiento: m.vencimiento, diasRestantes: dias, vencido, aviso, contacto: m.contacto };
}


const mesDe = (d: Date) => d.toISOString().slice(0, 7);

export async function crearServicioPlan(deps: DepsPlan): Promise<ServicioPlan> {
  const doFetch = deps.fetchImpl ?? fetch;
  const ahora = deps.ahora ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  // El maestro: el del .env, o el que se pego en la pantalla Membresia.
  let maestro: { url: string; token: string; origen: 'env' | 'pantalla' } | null = deps.url ? { url: deps.url, token: deps.token, origen: 'env' } : null;
  const conMaestroAhora = () => maestro !== null;

  let plan: PlanRemoto | null = null;
  let local: MembresiaLocal | null = null;
  let consultadoEn: string | null = null;
  let error: string | null = null;
  let uso = { mes: mesDe(ahora()), turnos: 0 };
  let soporteGuardado: SoporteGuardado | null = null;

  // Lo ultimo que se supo, para no arrancar a ciegas.
  for (const s of await deps.settingsRepo.getAll()) {
    if (s.key === CLAVE_ESTADO) {
      try {
        const g = JSON.parse(s.value) as { plan: PlanRemoto | null; consultadoEn: string | null };
        plan = g.plan;
        consultadoEn = g.consultadoEn;
      } catch {
        /* se vuelve a pedir */
      }
    }
    if (s.key === CLAVE_SOPORTE) {
      try {
        soporteGuardado = JSON.parse(s.value) as SoporteGuardado;
      } catch {
        soporteGuardado = null;
      }
    }
    if (s.key === CLAVE_USO) {
      try {
        uso = JSON.parse(s.value) as typeof uso;
      } catch {
        /* se empieza de cero */
      }
    }
    if (s.key === CLAVE_LOCAL) {
      try {
        local = JSON.parse(s.value) as MembresiaLocal;
      } catch {
        log('la membresia guardada no se pudo leer: se ignora');
      }
    }
    if (s.key === CLAVE_MAESTRO) {
      try {
        const m = JSON.parse(s.value) as { url: string; token: string };
        if (m.url && m.token) maestro = { url: m.url, token: m.token, origen: 'pantalla' };
      } catch {
        log('el maestro guardado no se pudo leer: se ignora');
      }
    }
  }

  /** Libre = ni maestro ni membresia local: todo permitido. */
  const libre = () => !conMaestroAhora() && !local;

  function usoDelMes(): number {
    const mes = mesDe(ahora());
    if (uso.mes !== mes) uso = { mes, turnos: 0 };
    return uso.turnos;
  }

  /** El plan de hoy: el del maestro (o el local), con los dias contados desde ahora. */
  function planDeHoy(): PlanRemoto | null {
    if (conMaestroAhora()) {
      if (!plan) return null;
      const dias = Math.ceil((new Date(plan.vencimiento).getTime() - ahora().getTime()) / (24 * 60 * 60 * 1000));
      // Si el maestro dijo "vencido" aunque la fecha no haya llegado (una suspension), se le hace caso.
      return { ...plan, diasRestantes: dias, vencido: dias <= 0 || Boolean(plan.vencido) };
    }
    return local ? planDeMembresia(local, ahora()) : null;
  }

  function motivo(que: Capacidad): string | null {
    if (libre()) return null;
    const p = planDeHoy();
    if (!p) return null; // Todavia no se supo del maestro: no se para nada por eso.
    // Con maestro se habla de "plan" (es lo que dice el maestro del SaaS); la
    // membresia local se llama membresia en su pantalla.
    const vencido = conMaestroAhora() ? 'El plan está vencido' : local?.estado === 'suspendida' ? 'La membresía está suspendida' : 'La membresía está vencida';
    if (p.vencido) return que === 'ia' ? `${vencido}: el asistente IA está en pausa.` : que === 'campanas' ? `${vencido}: las campañas están en pausa.` : `${vencido}.`;
    if (que === 'ia') {
      if (p.limites.iaTurnosMes === 0) return `El plan ${p.nombre} no incluye el asistente IA.`;
      if (p.limites.iaTurnosMes != null && usoDelMes() >= p.limites.iaTurnosMes) return `Se llegó al tope de ${p.limites.iaTurnosMes} respuestas de IA al mes del plan ${p.nombre}; vuelve el mes que viene.`;
    }
    if (que === 'campanas' && !p.limites.campanas) return `El plan ${p.nombre} no incluye campañas.`;
    if (que === 'conectores' && !p.limites.conectores) return `El plan ${p.nombre} no incluye conectores de tiendas.`;
    return null;
  }

  function estado(): EstadoPlanLocal {
    const p = planDeHoy();
    let aviso: EstadoPlanLocal['aviso'] = null;
    if (p?.aviso || p?.vencido) {
      // Con maestro el texto lo redacta el maestro; la membresia local ya trae el suyo (planDeMembresia).
      const texto = p!.aviso ?? 'El plan está vencido: el asistente IA y las campañas están en pausa. Los chats siguen funcionando.';
      aviso = { nivel: p!.vencido ? 'bad' : 'warn', texto: p!.contacto ? `${texto} ${p!.contacto}` : texto };
    } else if (p && motivo('ia')) {
      aviso = { nivel: 'warn', texto: motivo('ia')! };
    }
    const conM = conMaestroAhora();
    return {
      origen: conM ? 'maestro' : local ? 'local' : 'libre',
      editable: !conM,
      local: conM ? null : local,
      maestro: maestro ? { url: maestro.url, origen: maestro.origen, tieneToken: Boolean(maestro.token) } : null,
      plan: p,
      iaTurnosMes: usoDelMes(),
      mes: uso.mes,
      consultadoEn,
      error,
      aviso,
    };
  }

  async function guardarLocalEn(m: MembresiaLocal): Promise<void> {
    local = m;
    await deps.settingsRepo.put(CLAVE_LOCAL, JSON.stringify(m), false);
  }

  // ------------------------------------------------------- acceso de soporte
  const oyentesSoporte: Array<(acceso: AccesoSoporte | null) => void | Promise<void>> = [];
  const hashCodigo = (codigo: string) => createHash('sha256').update(codigo).digest('hex');
  function soporte(): AccesoSoporte | null {
    if (!soporteGuardado) return null;
    if (new Date(soporteGuardado.hasta).getTime() <= ahora().getTime()) {
      // Caduco: se olvida y se avisa una sola vez.
      soporteGuardado = null;
      void deps.settingsRepo.remove(CLAVE_SOPORTE).catch(() => undefined);
      for (const fn of oyentesSoporte) void Promise.resolve(fn(null)).catch(() => undefined);
      return null;
    }
    return { hasta: soporteGuardado.hasta, enlace: soporteGuardado.enlace, concedidoEn: soporteGuardado.concedidoEn };
  }
  async function concederSoporte(horas = 24): Promise<AccesoSoporte> {
    const h = Math.min(72, Math.max(1, Math.round(horas)));
    const codigo = `sop_${randomBytes(24).toString('base64url')}`;
    const base = (deps.baseUrl ?? '').replace(/\/+$/, '');
    const guardado: SoporteGuardado = {
      hash: hashCodigo(codigo),
      hasta: new Date(ahora().getTime() + h * 3600_000).toISOString(),
      enlace: `${base}/soporte/${codigo}`,
      concedidoEn: ahora().toISOString(),
    };
    soporteGuardado = guardado;
    await deps.settingsRepo.put(CLAVE_SOPORTE, JSON.stringify(guardado), false);
    const acceso = soporte()!;
    for (const fn of oyentesSoporte) await Promise.resolve(fn(acceso)).catch(() => undefined);
    // Que el maestro se entere ya, no dentro de un cuarto de hora.
    if (maestro) await refrescar().catch(() => undefined);
    return acceso;
  }
  async function revocarSoporte(): Promise<void> {
    soporteGuardado = null;
    await deps.settingsRepo.remove(CLAVE_SOPORTE).catch(() => undefined);
    for (const fn of oyentesSoporte) await Promise.resolve(fn(null)).catch(() => undefined);
    if (maestro) await refrescar().catch(() => undefined);
  }
  function canjearSoporte(codigo: string): boolean {
    const s = soporte();
    return Boolean(s && soporteGuardado && soporteGuardado.hash === hashCodigo(codigo.trim()));
  }

  /** El parte de salud en JSON para la cabecera; null si no hay quien lo de o falla. */
  async function parteDeSalud(): Promise<string | null> {
    if (!deps.estado) return null;
    try {
      const acceso = soporte();
      const e = { ...(await deps.estado()), ...(acceso ? { soporte: acceso } : {}) };
      const texto = JSON.stringify(e);
      return texto.length <= MAX_CABECERA_ESTADO ? texto : null;
    } catch (e) {
      log('no se pudo armar el parte de salud para el maestro', { error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  function paraPagar(): ParaPagar {
    const p = planDeHoy();
    const conM = conMaestroAhora();
    return {
      origen: conM ? 'maestro' : local ? 'local' : 'libre',
      plan: p,
      cobro: conM ? (plan?.cobro ?? null) : null,
      ultimoPago: conM ? (plan?.ultimoPago ?? null) : null,
      puedeMandarCaptura: conM && Boolean(maestro?.token),
      motivo: conM ? null : local ? 'Esta instalación lleva su propia membresía: los pagos se apuntan en Mi negocio → Membresía.' : 'Esta instalación no tiene membresía: no hay nada que pagar.',
    };
  }

  async function mandarCaptura(entrada: { imagen: string; meses: number; nota?: string; monto?: number }): Promise<{ ok: true; mensaje: string; pago: PagoCapturaVista } | { ok: false; error: string }> {
    if (!maestro) return { ok: false, error: paraPagar().motivo ?? 'Esta instalación no depende de un maestro.' };
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(entrada.imagen)) return { ok: false, error: 'La captura tiene que ser una imagen (PNG, JPG o WebP).' };
    if (entrada.imagen.length > 3_000_000) return { ok: false, error: 'La captura pesa demasiado: recórtala o baja la calidad (máximo 2 MB).' };
    if (!Number.isInteger(entrada.meses) || entrada.meses < 1 || entrada.meses > 60) return { ok: false, error: 'Los meses tienen que ser un número entero entre 1 y 60.' };
    try {
      const r = await doFetch(`${maestro.url.replace(/\/+$/, '')}/pago`, {
        method: 'POST',
        headers: { authorization: `Bearer ${maestro.token}`, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ imagen: entrada.imagen, meses: entrada.meses, nota: entrada.nota ?? '', monto: entrada.monto ?? null }),
        signal: AbortSignal.timeout(20000),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; pago?: PagoCapturaVista };
      if (!r.ok || !j.pago) return { ok: false, error: j.error ?? `Quien controla las tiendas no aceptó la captura (respondió ${r.status}). Inténtalo de nuevo o escríbele.` };
      await refrescar();
      return { ok: true, mensaje: 'Captura enviada: quien controla las tiendas la revisa y, en cuanto la apunte, la membresía corre sola. Aquí verás si la aceptó.', pago: j.pago };
    } catch (e) {
      return { ok: false, error: `No se pudo mandar la captura: ${e instanceof Error ? e.message : String(e)}. Revisa la conexión y vuelve a intentarlo.` };
    }
  }

  async function refrescar(): Promise<EstadoPlanLocal> {
    if (!maestro) return estado();
    try {
      const headers: Record<string, string> = { authorization: `Bearer ${maestro.token}`, accept: 'application/json' };
      const parte = await parteDeSalud();
      if (parte) headers['x-gsgchat-estado'] = parte;
      const r = await doFetch(maestro.url, { headers, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`el maestro respondió ${r.status}`);
      const j = (await r.json()) as PlanRemoto;
      if (!j || typeof j.plan !== 'string' || !j.limites || !j.vencimiento) throw new Error('el maestro respondió algo que no es un plan');
      const antes = plan?.plan;
      plan = j;
      error = null;
      consultadoEn = ahora().toISOString();
      await deps.settingsRepo.put(CLAVE_ESTADO, JSON.stringify({ plan, consultadoEn }), false);
      if (antes !== j.plan) log('plan de la tienda', { plan: j.plan, vence: j.vencimiento });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      log('no se pudo consultar el plan; se sigue con el último conocido', { error });
    }
    return estado();
  }

  return {
    estado,
    permite: (que) => motivo(que) === null,
    motivo,
    async anotarTurnoIA() {
      usoDelMes();
      uso.turnos++;
      await deps.settingsRepo.put(CLAVE_USO, JSON.stringify(uso), false);
    },
    refrescar,
    limiteUsuarios() {
      if (libre()) return null;
      return planDeHoy()?.limites.usuarios ?? null;
    },
    async guardarLocal(entrada, quien) {
      if (conMaestroAhora()) throw new Error('Esta instalación depende de un maestro: la membresía se cambia desde el panel de quien la controla.');
      await guardarLocalEn(armarMembresia(entrada, local, ahora(), quien));
      return estado();
    },
    async anotarPago(pago, quien) {
      if (conMaestroAhora()) throw new Error('Esta instalación depende de un maestro: los pagos se apuntan desde el panel de quien la controla.');
      if (!local) throw new Error('Primero elige un plan y guárdalo; después se apuntan los pagos.');
      await guardarLocalEn(membresiaConPago(local, pago, ahora(), quien));
      return estado();
    },
    async quitarLocal() {
      if (conMaestroAhora()) throw new Error('Esta instalación depende de un maestro: la membresía no se quita desde aquí.');
      local = null;
      await deps.settingsRepo.remove(CLAVE_LOCAL);
      return estado();
    },
    async conectarMaestro(entrada) {
      const url = entrada.url.trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^\s]+\/api\/plan\/[a-z0-9-]+$/i.test(url)) throw new Error('La dirección del maestro tiene la forma http://servidor/api/plan/<tienda> (la que te dio quien controla las tiendas).');
      const token = entrada.token.trim();
      if (!token) throw new Error('Falta el token de la tienda.');
      const antes = maestro;
      maestro = { url, token, origen: 'pantalla' };
      const r = await refrescar();
      if (r.error) {
        maestro = antes;
        throw new Error(`El maestro no respondió con un plan: ${r.error}. Revisa la dirección y el token.`);
      }
      await deps.settingsRepo.put(CLAVE_MAESTRO, JSON.stringify({ url, token }), false);
      return estado();
    },
    paraPagar,
    mandarCaptura,
    concederSoporte,
    revocarSoporte,
    soporte,
    canjearSoporte,
    alCambiarSoporte(fn) {
      oyentesSoporte.push(fn);
    },
    async desconectarMaestro() {
      if (maestro?.origen === 'env') throw new Error('El maestro viene del arranque (.env): se quita de ahí.');
      maestro = null;
      plan = null;
      await deps.settingsRepo.remove(CLAVE_MAESTRO);
      await deps.settingsRepo.remove(CLAVE_ESTADO);
      return estado();
    },
    arrancar() {
      if (!maestro) return () => undefined;
      void refrescar();
      const t = setInterval(() => void refrescar(), deps.cadaMs ?? 15 * 60 * 1000);
      t.unref?.();
      return () => clearInterval(t);
    },
  };
}
