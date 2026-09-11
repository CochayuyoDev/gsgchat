/**
 * Campanas por goteo, con canario.
 *
 * Antes una campana se volcaba entera en la cola y salia a diez mensajes por
 * segundo. Es exactamente lo que Meta describe como patron de riesgo, y con
 * un cliente no oficial es un baneo en una tarde. Ahora:
 *
 *  1. Los destinatarios se guardan ordenados por compromiso: primero quien
 *     escribio hace poco, luego quien dio el opt-in mas reciente. Meta mira
 *     como cae una plantilla en sus primeras horas (pacing): los primeros
 *     mensajes tienen que ir a quien mas probablemente los lea.
 *  2. Sale primero el canario: un grupo pequeno (por defecto el 10 %, entre
 *     5 y 20). Se espera un rato y se mira que paso: cuantos fallaron, con
 *     que codigo, cuantos se dieron de baja, cuantos constan entregados. Si
 *     la plantilla o la lista tienen un problema, se ve en veinte mensajes y
 *     no en dos mil.
 *  3. Si el canario sale bien, el resto sale al ritmo del marcapasos (y, si
 *     la campana lo dice, no mas de N por hora). Cada envio pasa por las
 *     mismas guardas que todo lo demas.
 *
 * Un rechazo con espera que afecta al numero entero (cupo, horario, riesgo)
 * para el tick; uno que afecta solo a ese contacto lo pospone y sigue con el
 * siguiente. Uno en firme (baja, sin opt-in, fatiga) lo marca y no vuelve.
 */

import type { Campaign, CampaignRecipient, Repos, ResumenEntregas } from '../db/repos.js';
import type { SendOutcome, Sender } from '../outbound/sender.js';
import type { GateCode } from '../outbound/gates.js';
import type { Monitor } from '../salud/monitor.js';
import type { Politica } from '../salud/politica.js';
import { decidirRitmo } from '../salud/ritmo.js';

export interface GoteoDeps {
  repos: Repos;
  sender: Sender;
  salud?: Monitor;
  politica?: () => Politica;
  ahora?: () => Date;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
}

export interface ResultadoGoteo {
  campanas: number;
  enviados: number;
  bloqueados: number;
  fallidos: number;
  pospuestos: number;
  /** Campanas que este tick paro por el canario, con su motivo. */
  pausadas: Array<{ id: string; motivo: string }>;
  terminadas: string[];
  /** Por que se paro el tick antes de tiempo, si se paro. */
  detenido?: string;
}

/** Rechazos que afectan al numero entero: no tiene sentido probar con el siguiente. */
const GLOBALES = new Set<GateCode>([
  'sin_conexion',
  'number_paused',
  'number_quality',
  'daily_cap',
  'risk_marketing_paused',
  'rhythm',
  'template_paused',
  'template_not_approved',
  'template_quality',
  'template_missing',
]);

/** Rechazos por contacto con espera: se pospone y se sigue. */
const POSPONIBLES = new Set<GateCode>(['contact_spacing', 'contact_daily_cap', 'contact_suppressed']);

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

/**
 * Tamano del canario por defecto: el 10 %, entre 5 y 20. Con menos de 30
 * destinatarios no hay canario que valga: se manda todo y se mira despues.
 */
export function canarioPorDefecto(total: number): number {
  if (total < 30) return 0;
  return Math.max(5, Math.min(20, Math.round(total * 0.1)));
}

export interface VeredictoCanario {
  ok: boolean;
  motivo: string | null;
  cifras: ResumenEntregas & { bajas: number };
}

/**
 * Que dice el canario. Puro: recibe cifras y umbrales, devuelve un veredicto.
 *
 * Se juzga con lo que hay: con dos envios no se para nada, pero con veinte,
 * cuatro fallos ya son el 20 %.
 */
export function juzgarCanario(
  cifras: ResumenEntregas & { bajas: number },
  umbrales: Politica['umbrales'],
  esperaMin: number,
): VeredictoCanario {
  const { enviados, fallidos, porCodigo, entregados } = cifras;
  if (enviados < 5) return { ok: true, motivo: null, cifras };

  const pct = (n: number) => (n / enviados) * 100;
  // Los codigos con nombre van antes que el porcentaje de fallos a secas: el
  // motivo tiene que decir QUE fallo, no solo cuanto.
  const porUsuario = porCodigo['131049'] ?? 0;
  if (pct(porUsuario) >= 30) {
    return {
      ok: false,
      motivo: `${porUsuario} de ${enviados} del canario ya no admiten marketing (131049): la lista esta saturada`,
      cifras,
    };
  }
  const sinWhatsapp = porCodigo['131026'] ?? 0;
  if (pct(sinWhatsapp) >= umbrales.maxSinWhatsappPct) {
    return { ok: false, motivo: `${sinWhatsapp} de ${enviados} del canario no tienen WhatsApp: lista sucia`, cifras };
  }
  if (pct(fallidos) >= umbrales.maxFallosPct) {
    return { ok: false, motivo: `el canario fallo en ${fallidos} de ${enviados} envios`, cifras };
  }
  if (pct(cifras.bajas) >= umbrales.maxBajasPct && cifras.bajas >= 2) {
    return { ok: false, motivo: `${cifras.bajas} bajas entre los ${enviados} del canario`, cifras };
  }
  // La entrega solo se juzga si hubo tiempo de que llegara.
  if (esperaMin >= 60 && enviados >= 10 && pct(entregados) < umbrales.minEntregaPct) {
    return {
      ok: false,
      motivo: `solo ${entregados} de ${enviados} del canario constan entregados tras ${esperaMin} min`,
      cifras,
    };
  }
  return { ok: true, motivo: null, cifras };
}

async function enviarDestinatario(
  deps: GoteoDeps,
  campana: Campaign,
  r: CampaignRecipient,
  momento: Date,
): Promise<SendOutcome> {
  return deps.sender.send({
    phone: r.phone,
    kind: 'template',
    category: campana.category,
    campaignId: campana.id,
    templateName: campana.templateName,
    templateLanguage: campana.templateLanguage,
    variables: r.variables,
  });
}

/**
 * Un tick del goteo. Lo llama el ticker cada pocos segundos y el boton del
 * panel. `porTick` limita cuantos salen en una pasada; el marcapasos limita
 * por debajo de eso.
 */
export async function correrGoteo(deps: GoteoDeps, porTick = 5): Promise<ResultadoGoteo> {
  const { repos } = deps;
  const momento = deps.ahora?.() ?? new Date();
  const politica = deps.politica?.();
  const resultado: ResultadoGoteo = {
    campanas: 0,
    enviados: 0,
    bloqueados: 0,
    fallidos: 0,
    pospuestos: 0,
    pausadas: [],
    terminadas: [],
  };

  let presupuesto = porTick;

  for (const campana of await repos.campaigns.listarActivas()) {
    if (campana.status === 'paused') continue;
    resultado.campanas++;

    // --- el canario ya salio: hay que juzgarlo antes de seguir --------
    if (campana.status === 'canary' && campana.canarioEnviadoAt) {
      const esperaMin = campana.canarioEsperaMin ?? 60;
      if (momento.getTime() - campana.canarioEnviadoAt.getTime() < esperaMin * MINUTO) continue;
      const cifras = await repos.campaigns.resumenCanario(campana.id);
      const bajas = await repos.contacts.contarBajasDesde(campana.canarioEnviadoAt);
      const umbrales = politica?.umbrales ?? {
        maxFallosPct: 20,
        maxSinWhatsappPct: 15,
        maxBajasPct: 2,
        minEntregaPct: 60,
        maxQuejasPct: 5,
        maxRatioSalidaEntrada: 15,
        minEnviosParaJuzgar: 20,
      };
      const veredicto = juzgarCanario({ ...cifras, bajas }, umbrales, esperaMin);
      if (!veredicto.ok) {
        await repos.campaigns.setStatus(campana.id, 'paused', veredicto.motivo);
        await deps.salud?.registrarEvento('campana', 'CANARIO', `${campana.name}: ${veredicto.motivo}`, {
          campaignId: campana.id,
          payload: { cifras: veredicto.cifras },
        });
        resultado.pausadas.push({ id: campana.id, motivo: veredicto.motivo ?? 'canario' });
        deps.log?.('campana pausada por el canario', { campana: campana.name, motivo: veredicto.motivo });
        continue;
      }
      await repos.campaigns.setStatus(campana.id, 'running');
      await deps.salud?.registrarEvento('campana', 'CANARIO_OK', `${campana.name}: el canario salio bien, sigue el resto`, {
        campaignId: campana.id,
      });
      campana.status = 'running';
    }

    if (presupuesto <= 0) break;

    // --- ritmo propio de la campana ------------------------------------
    if (campana.ritmoPorHora && campana.ritmoPorHora > 0) {
      const ultimaHora = await repos.deliveries.contarCampanaDesde(campana.id, new Date(momento.getTime() - HORA));
      if (ultimaHora >= campana.ritmoPorHora) continue;
      presupuesto = Math.min(presupuesto, campana.ritmoPorHora - ultimaHora);
    }

    const soloCanario = campana.status === 'canary';
    const siguientes = await repos.campaigns.siguientesPendientes(campana.id, presupuesto, soloCanario, momento);

    if (!siguientes.length) {
      if (soloCanario) {
        // Canario entero fuera (o pospuesto): empieza a contar la espera.
        const quedan = (await repos.campaigns.siguientesPendientes(campana.id, 1, true, new Date(8.64e15))).length;
        if (!quedan && !campana.canarioEnviadoAt) await repos.campaigns.setCanarioEnviado(campana.id, momento);
        continue;
      }
      if ((await repos.campaigns.contarPendientes(campana.id)) === 0) {
        await repos.campaigns.setStatus(campana.id, 'finished');
        resultado.terminadas.push(campana.id);
      }
      continue;
    }

    for (const r of siguientes) {
      if (presupuesto <= 0) break;

      // El marcapasos se pregunta antes de tocar nada: un "todavia no" no
      // deja fila de entrega ni cambia al destinatario.
      if (deps.salud && politica) {
        const contacto = await repos.contacts.upsertFromInbound(r.phone);
        const decision = decidirRitmo(await deps.salud.fotoRitmo(contacto, momento), politica);
        if (!decision.ok) {
          resultado.detenido = `${decision.codigo}: ${decision.motivo}`;
          return resultado;
        }
      }

      const salida = await enviarDestinatario(deps, campana, r, momento);
      presupuesto--;

      if (salida.ok) {
        await repos.campaigns.marcarDestinatario(r.id, 'enviado', null, salida.deliveryId, momento);
        resultado.enviados++;
        continue;
      }

      if (salida.blocked) {
        const detalle = `${salida.code}: ${salida.reason}`;
        if (GLOBALES.has(salida.code)) {
          // Afecta al numero entero: se para el tick y se vuelve mas tarde.
          resultado.detenido = detalle;
          return resultado;
        }
        if (POSPONIBLES.has(salida.code) && salida.retryAfterMs && salida.retryAfterMs < 3 * 24 * HORA && r.intentos < 5) {
          await repos.campaigns.posponerDestinatario(r.id, new Date(momento.getTime() + salida.retryAfterMs), detalle);
          resultado.pospuestos++;
          continue;
        }
        await repos.campaigns.marcarDestinatario(r.id, 'bloqueado', detalle, salida.deliveryId, momento);
        resultado.bloqueados++;
        continue;
      }

      // Error del proveedor: reintentable se pospone unos minutos, hasta tres
      // veces; el resto (o el que apunta al contacto) se da por fallido.
      if (salida.retryable && r.intentos < 3) {
        await repos.campaigns.posponerDestinatario(r.id, new Date(momento.getTime() + 10 * MINUTO), salida.error.slice(0, 300));
        resultado.pospuestos++;
        continue;
      }
      await repos.campaigns.marcarDestinatario(r.id, 'fallido', salida.error.slice(0, 300), salida.deliveryId, momento);
      resultado.fallidos++;
    }

    // Si con esta pasada no quedo nada pendiente, la campana termina ya, sin
    // esperar al siguiente tick para enterarse.
    if (campana.status === 'running' && (await repos.campaigns.contarPendientes(campana.id)) === 0) {
      await repos.campaigns.setStatus(campana.id, 'finished');
      resultado.terminadas.push(campana.id);
    }
  }

  return resultado;
}

/** Ticker del goteo. Devuelve la funcion para pararlo. */
export function startGoteo(deps: GoteoDeps, intervalMs = 10_000, porTick = 5): () => void {
  let corriendo = false;
  const tick = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      await correrGoteo(deps, porTick);
    } catch (error) {
      deps.log?.('fallo el goteo de campanas', { detalle: error instanceof Error ? error.message : String(error) });
    } finally {
      corriendo = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Orden de salida de los destinatarios: quien escribio hace poco primero,
 * luego por opt-in mas reciente, y los que nunca dieron senales al final.
 * Puro para poder probarlo.
 */
export function ordenarPorCompromiso<T extends { lastInboundAt: Date | null; optInAt: Date | null }>(
  contactos: T[],
): T[] {
  const peso = (c: T) => {
    const inbound = c.lastInboundAt?.getTime() ?? 0;
    const optIn = c.optInAt?.getTime() ?? 0;
    // El ultimo mensaje pesa mucho mas que el opt-in: alguien que escribio
    // ayer va antes que alguien que se dio de alta hace un ano y calla.
    return inbound * 10 + optIn;
  };
  return [...contactos].sort((a, b) => peso(b) - peso(a));
}
