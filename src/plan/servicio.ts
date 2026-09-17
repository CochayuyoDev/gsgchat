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
 * maestro no puede parar a las tiendas. Sin PLAN_URL (una instalacion
 * suelta, fuera del SaaS) no hay plan y todo esta permitido.
 */

import type { SettingsRepo } from '../settings/service.js';

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
}

export type Capacidad = 'ia' | 'campanas' | 'conectores';

export interface EstadoPlanLocal {
  /** 'maestro' si esta tienda tiene plan; 'libre' si es una instalacion suelta. */
  origen: 'maestro' | 'libre';
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
}

export interface DepsPlan {
  settingsRepo: SettingsRepo;
  /** PLAN_URL y PLAN_TOKEN. Sin URL, la instancia es libre. */
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  ahora?: () => Date;
  cadaMs?: number;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

const CLAVE_ESTADO = 'plan.estado';
const CLAVE_USO = 'plan.uso';

const mesDe = (d: Date) => d.toISOString().slice(0, 7);

export async function crearServicioPlan(deps: DepsPlan): Promise<ServicioPlan> {
  const doFetch = deps.fetchImpl ?? fetch;
  const ahora = deps.ahora ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const libre = !deps.url;

  let plan: PlanRemoto | null = null;
  let consultadoEn: string | null = null;
  let error: string | null = null;
  let uso = { mes: mesDe(ahora()), turnos: 0 };

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
    if (s.key === CLAVE_USO) {
      try {
        uso = JSON.parse(s.value) as typeof uso;
      } catch {
        /* se empieza de cero */
      }
    }
  }

  function usoDelMes(): number {
    const mes = mesDe(ahora());
    if (uso.mes !== mes) uso = { mes, turnos: 0 };
    return uso.turnos;
  }

  /** El plan de hoy: lo que dijo el maestro, pero con los dias contados desde ahora. */
  function planDeHoy(): PlanRemoto | null {
    if (!plan) return null;
    const dias = Math.ceil((new Date(plan.vencimiento).getTime() - ahora().getTime()) / (24 * 60 * 60 * 1000));
    return { ...plan, diasRestantes: dias, vencido: dias <= 0 };
  }

  function motivo(que: Capacidad): string | null {
    if (libre) return null;
    const p = planDeHoy();
    if (!p) return null; // Todavia no se supo del maestro: no se para nada por eso.
    if (p.vencido) return que === 'ia' ? 'El plan está vencido: el asistente IA está en pausa.' : que === 'campanas' ? 'El plan está vencido: las campañas están en pausa.' : 'El plan está vencido.';
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
      const texto = p.vencido && !p.aviso ? 'El plan está vencido: el asistente IA y las campañas están en pausa. Los chats siguen funcionando.' : p.aviso!;
      aviso = { nivel: p.vencido ? 'bad' : 'warn', texto: p.contacto ? `${texto} ${p.contacto}` : texto };
    } else if (p && motivo('ia')) {
      aviso = { nivel: 'warn', texto: motivo('ia')! };
    }
    return { origen: libre ? 'libre' : 'maestro', plan: p, iaTurnosMes: usoDelMes(), mes: uso.mes, consultadoEn, error, aviso };
  }

  async function refrescar(): Promise<EstadoPlanLocal> {
    if (libre) return estado();
    try {
      const r = await doFetch(deps.url, { headers: { authorization: `Bearer ${deps.token}`, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
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
    arrancar() {
      if (libre) return () => undefined;
      void refrescar();
      const t = setInterval(() => void refrescar(), deps.cadaMs ?? 15 * 60 * 1000);
      t.unref?.();
      return () => clearInterval(t);
    },
  };
}
