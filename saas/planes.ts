/**
 * Planes y cobro de las tiendas del SaaS.
 *
 * Cada instancia tiene un `plan.json` junto a su `.env`: que plan tiene,
 * hasta cuando esta pagado y los pagos que se le han apuntado. No se cobra
 * con tarjeta desde aqui: el dueño del SaaS cobra como quiera (Yape,
 * transferencia, factura) y apunta el pago en el maestro; eso corre la
 * fecha de vencimiento. La instancia pregunta al maestro cada rato por su
 * plan (GET /api/plan/:slug con su token) y, si esta vencido, pone en pausa
 * lo que cuesta dinero (la IA y las campañas) y avisa en el panel. Los chats
 * siguen funcionando: una tienda con el plan vencido no pierde clientes.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export type NombrePlan = 'prueba' | 'basico' | 'pro';

export interface LimitesPlan {
  /** Turnos del asistente de IA al mes. 0 = sin IA; null = sin limite. */
  iaTurnosMes: number | null;
  campanas: boolean;
  conectores: boolean;
  /** Cuentas de usuario del panel. null = sin limite. */
  usuarios: number | null;
}

export interface DefinicionPlan {
  nombre: string;
  /** Lo que cuesta al mes, en la moneda del SaaS. 0 para la prueba. */
  precioMes: number;
  /** Dias que dura la prueba (solo el plan prueba). */
  diasPrueba?: number;
  limites: LimitesPlan;
  descripcion: string;
}

export const MONEDA_PLANES = 'PEN';

export const PLANES: Record<NombrePlan, DefinicionPlan> = {
  prueba: {
    nombre: 'Prueba',
    precioMes: 0,
    diasPrueba: 14,
    limites: { iaTurnosMes: 300, campanas: true, conectores: true, usuarios: 2 },
    descripcion: '14 días con todo, para que la tienda lo pruebe con clientes reales.',
  },
  basico: {
    nombre: 'Básico',
    precioMes: 49,
    limites: { iaTurnosMes: 2000, campanas: false, conectores: true, usuarios: 3 },
    descripcion: 'Chats, asistente IA (2.000 respuestas al mes), chat en la web y conector de tienda.',
  },
  pro: {
    nombre: 'Pro',
    precioMes: 149,
    limites: { iaTurnosMes: null, campanas: true, conectores: true, usuarios: null },
    descripcion: 'Todo sin límite: IA, campañas por goteo, conectores, usuarios.',
  },
};

export interface Pago {
  fecha: string;
  plan: NombrePlan;
  meses: number;
  monto: number;
  moneda: string;
  nota: string;
}

export interface PlanInstancia {
  plan: NombrePlan;
  /** Hasta cuando esta pagado (ISO). */
  vencimiento: string;
  /** El token con el que la instancia pregunta por su plan. */
  token: string;
  pagos: Pago[];
  /** Un aviso propio del maestro para esa tienda ("escríbenos al ..."). */
  contacto?: string;
}

/** Lo que la instancia recibe: su plan de hoy, ya calculado. */
export interface EstadoPlan {
  plan: NombrePlan;
  nombre: string;
  limites: LimitesPlan;
  precioMes: number;
  moneda: string;
  vencimiento: string;
  diasRestantes: number;
  vencido: boolean;
  /** A partir de 7 dias antes de vencer, y siempre que este vencido. */
  aviso: string | null;
  contacto: string | null;
}

const DIA = 24 * 60 * 60 * 1000;
/** `dir` es la carpeta de la instancia (saas/instancias/<slug>). */
const ficheroPlan = (dir: string) => path.join(dir, 'plan.json');

export const nuevoTokenPlan = () => `plt_${randomBytes(24).toString('base64url')}`;

/** El plan con el que nace una tienda: la prueba, desde hoy. */
export function planInicial(ahora = new Date(), plan: NombrePlan = 'prueba', token = nuevoTokenPlan()): PlanInstancia {
  const dias = PLANES[plan].diasPrueba ?? 30;
  return { plan, vencimiento: new Date(ahora.getTime() + dias * DIA).toISOString(), token, pagos: [] };
}

export function leerPlan(dir: string): PlanInstancia | null {
  const f = ficheroPlan(dir);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, 'utf8')) as PlanInstancia;
}

export function guardarPlan(dir: string, plan: PlanInstancia): void {
  writeFileSync(ficheroPlan(dir), JSON.stringify(plan, null, 2) + '\n');
}

/** Los dias que faltan (negativos si ya vencio), contando dias enteros. */
export function diasRestantes(vencimiento: string, ahora = new Date()): number {
  return Math.ceil((new Date(vencimiento).getTime() - ahora.getTime()) / DIA);
}

export function estadoPlan(p: PlanInstancia, ahora = new Date()): EstadoPlan {
  const def = PLANES[p.plan] ?? PLANES.prueba;
  const dias = diasRestantes(p.vencimiento, ahora);
  const vencido = dias <= 0;
  // Las fechas se guardan y se leen en UTC: una fecha "2026-09-01" tiene que salir como 1 de septiembre en todas partes.
  const cuando = new Date(p.vencimiento).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  let aviso: string | null = null;
  if (vencido) {
    aviso = p.plan === 'prueba' ? `Tu prueba gratis terminó el ${cuando}: el asistente IA y las campañas están en pausa. Los chats siguen funcionando.` : `Tu plan ${def.nombre} venció el ${cuando}: el asistente IA y las campañas están en pausa hasta renovarlo. Los chats siguen funcionando.`;
  } else if (dias <= 7) {
    aviso = p.plan === 'prueba' ? `Tu prueba gratis termina en ${dias} día${dias === 1 ? '' : 's'} (${cuando}). Elige un plan para no parar.` : `Tu plan ${def.nombre} vence en ${dias} día${dias === 1 ? '' : 's'} (${cuando}).`;
  }
  return {
    plan: p.plan,
    nombre: def.nombre,
    limites: def.limites,
    precioMes: def.precioMes,
    moneda: MONEDA_PLANES,
    vencimiento: p.vencimiento,
    diasRestantes: dias,
    vencido,
    aviso,
    contacto: p.contacto ?? null,
  };
}

/**
 * Apunta un pago: cambia al plan pagado y corre el vencimiento tantos
 * meses, desde lo que quede (si aun no vencio) o desde hoy (si ya vencio).
 */
export function registrarPago(p: PlanInstancia, pago: { plan: NombrePlan; meses: number; monto?: number; nota?: string }, ahora = new Date()): PlanInstancia {
  if (!PLANES[pago.plan] || pago.plan === 'prueba') throw new Error('El pago tiene que ser de un plan de pago (basico o pro).');
  if (!Number.isInteger(pago.meses) || pago.meses < 1 || pago.meses > 24) throw new Error('Los meses van de 1 a 24.');
  const desde = p.plan !== 'prueba' && new Date(p.vencimiento) > ahora ? new Date(p.vencimiento) : ahora;
  const hasta = new Date(desde);
  hasta.setMonth(hasta.getMonth() + pago.meses);
  const monto = pago.monto ?? PLANES[pago.plan].precioMes * pago.meses;
  return {
    ...p,
    plan: pago.plan,
    vencimiento: hasta.toISOString(),
    pagos: [...p.pagos, { fecha: ahora.toISOString(), plan: pago.plan, meses: pago.meses, monto, moneda: MONEDA_PLANES, nota: (pago.nota ?? '').trim() }],
  };
}

/** Un cambio a mano: otro plan y/o otra fecha (una cortesia, una prorroga). */
export function cambiarPlan(p: PlanInstancia, cambio: { plan?: NombrePlan; vencimiento?: string; contacto?: string }): PlanInstancia {
  if (cambio.plan && !PLANES[cambio.plan]) throw new Error(`No existe el plan "${cambio.plan}".`);
  // Una fecha sola ("2026-09-01") vale hasta el final de ese dia.
  const v = cambio.vencimiento && /^\d{4}-\d{2}-\d{2}$/.test(cambio.vencimiento) ? `${cambio.vencimiento}T23:59:59.000Z` : cambio.vencimiento;
  if (v && Number.isNaN(new Date(v).getTime())) throw new Error('La fecha de vencimiento no es valida.');
  return {
    ...p,
    plan: cambio.plan ?? p.plan,
    vencimiento: v ? new Date(v).toISOString() : p.vencimiento,
    contacto: cambio.contacto !== undefined ? cambio.contacto : p.contacto,
  };
}

/** Lo que cobra el SaaS al mes con lo que hay ahora (solo planes vigentes). */
export function ingresosMensuales(planes: PlanInstancia[], ahora = new Date()): number {
  return planes.filter((p) => p.plan !== 'prueba' && new Date(p.vencimiento) > ahora).reduce((s, p) => s + PLANES[p.plan].precioMes, 0);
}
