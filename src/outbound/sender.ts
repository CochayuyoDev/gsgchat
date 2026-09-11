/**
 * Envio de un mensaje, con las guardas por delante.
 *
 * Todo lo que sale del sistema pasa por aqui. No hay atajo que se salte
 * `evaluateGates`, y cada intento deja una fila en `deliveries` aunque el
 * mensaje no llegue a salir: los bloqueos son la senal mas util que hay
 * para saber si una lista esta sucia antes de quemar el numero con ella.
 */

import type { Repos, TemplateCategory } from '../db/repos.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import { WhatsAppApiError } from '../whatsapp/client.js';
import { renderTemplate, TemplateRenderError } from '../templates/render.js';
import type { Monitor } from '../salud/monitor.js';
import type { Politica } from '../salud/politica.js';
import { decidirRitmo, type DecisionRitmo } from '../salud/ritmo.js';
import { codigoDeError } from '../salud/supresion.js';
import { inicioDelDia } from '../salud/monitor.js';
import { dailyCapFor, type WarmupPolicy } from './throttle.js';
import {
  evaluateGates,
  isWithinServiceWindow,
  sevenDaysBefore,
  type GateCode,
  type MessageKind,
} from './gates.js';

export interface SendJob {
  phone: string;
  kind: MessageKind;
  category: TemplateCategory;
  campaignId?: string | null;
  /** Escrito a mano desde /chat: ver `SendIntent.manual` en gates. */
  manual?: boolean;

  templateName?: string;
  templateLanguage?: string;
  variables?: string[];

  text?: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  interactive?: {
    body: string;
    buttons?: Array<{ id: string; title: string }>;
    locationRequest?: boolean;
  };
}

export type SendOutcome =
  | { ok: true; wamid: string; deliveryId: number }
  | {
      ok: false;
      blocked: true;
      code: GateCode;
      reason: string;
      retryAfterMs?: number;
      deliveryId: number;
    }
  | {
      ok: false;
      blocked: false;
      error: string;
      retryable: boolean;
      deliveryId: number | null;
      /** Codigo de Meta (131026...) o del cliente, normalizado; null si no se reconocio. */
      code?: string | null;
    };

export interface SenderDeps {
  repos: Repos;
  wa: WhatsAppClient;
  /** Funcion si el numero puede cambiar desde /setup sin reiniciar. */
  phoneNumberId: string | (() => string);
  warmup: WarmupPolicy;
  maxMarketingPerContact7d: number;
  /** Si la ventana de 24 h de Meta aplica. Ver `GateSnapshot`. */
  serviceWindowApplies?: boolean | (() => boolean);
  now?: () => Date;
  /**
   * El monitor de salud y la politica de ritmo. Opcionales para que las
   * pruebas de los gates de siempre no tengan que montarlos; en el sistema
   * real van siempre, y con ellos entran el marcapasos, la supresion por
   * contacto, la fatiga y el techo del tier.
   */
  salud?: Monitor;
  politica?: () => Politica;
}

export interface Sender {
  send(job: SendJob): Promise<SendOutcome>;
}

export function createSender(deps: SenderDeps): Sender {
  const { repos, wa, warmup, maxMarketingPerContact7d } = deps;
  const now = deps.now ?? (() => new Date());
  const phoneId = () =>
    typeof deps.phoneNumberId === 'function' ? deps.phoneNumberId() : deps.phoneNumberId;
  const ventanaAplica = () =>
    typeof deps.serviceWindowApplies === 'function'
      ? deps.serviceWindowApplies()
      : deps.serviceWindowApplies !== false;

  return {
    async send(job) {
      const at = now();
      const contact = await repos.contacts.upsertFromInbound(job.phone);

      const template =
        job.kind === 'template' && job.templateName
          ? await repos.templates.get(job.templateName, job.templateLanguage ?? 'es_MX')
          : null;

      // Iniciado por la empresa: con plantilla o fuera de la ventana. Es lo
      // que cuenta para el tier de Meta, el warm-up y el marcapasos.
      const businessInitiated = job.kind === 'template' || !isWithinServiceWindow(contact, at);
      const automatico = businessInitiated && job.manual !== true;

      const [numberState, marketingLast7d, sentToday] = await Promise.all([
        repos.numberState.get(phoneId()),
        repos.deliveries.countMarketingSince(contact.id, sevenDaysBefore(at)),
        repos.counters.totalForDay(phoneId(), at),
      ]);

      // Lo que aporta la capa de salud, solo cuando esta y solo para lo
      // automatico: responderle a un cliente no pasa por el marcapasos.
      const politica = deps.politica?.();
      let ritmo: DecisionRitmo | undefined;
      let sentToContactToday: number | undefined;
      let lastSentToContactAt: Date | null | undefined;
      if (automatico && politica) {
        [sentToContactToday, lastSentToContactAt] = await Promise.all([
          repos.deliveries.contarIniciadosAContactoDesde(contact.id, inicioDelDia(at, politica.timezone)),
          repos.deliveries.ultimoEnvioA(contact.id),
        ]);
        if (deps.salud) ritmo = decidirRitmo(await deps.salud.fotoRitmo(contact, at), politica);
      }

      const deliveryId = await repos.deliveries.create({
        contactId: contact.id,
        campaignId: job.campaignId ?? null,
        kind: job.kind,
        templateName: job.templateName ?? null,
        category: job.category,
        variables: job.variables,
        businessInitiated,
      });

      const decision = evaluateGates(
        { contact, kind: job.kind, category: job.category, template, now: at, manual: job.manual },
        {
          numberState,
          marketingLast7d,
          sentToday,
          dailyCap: dailyCapFor(numberState.warmupStartedOn, at, politica?.warmup ?? warmup),
          maxMarketingPerContact7d,
          serviceWindowApplies: ventanaAplica(),
          sinMarketing: deps.salud?.sinMarketing(),
          fatigaEnvios: politica?.fatigaEnvios,
          sentToContactToday,
          maxPorContactoDia: politica?.maxPorContactoDia,
          lastSentToContactAt,
          separacionContactoMs: politica?.separacionContactoMs,
          ritmo,
        },
      );

      if (!decision.allow) {
        await repos.deliveries.markBlocked(deliveryId, `${decision.code}: ${decision.reason}`);
        return {
          ok: false,
          blocked: true,
          code: decision.code,
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
          deliveryId,
        };
      }

      try {
        const result = await dispatch(wa, job, template);
        await repos.deliveries.markSent(deliveryId, result.wamid);

        // El chat lee de `messages`: sin esta fila el operador manda algo y no
        // lo ve aparecer en la conversacion.
        await repos.messages.add({
          contactId: contact.id,
          direction: 'out',
          wamid: result.wamid,
          kind: job.kind === 'freeform' ? 'text' : job.kind,
          // Lo que el cliente REALMENTE recibio, si el proveedor lo dice.
          body: result.body ?? describeOutgoing(job, template),
          payload: job.location ? { location: job.location } : job.interactive ? { interactive: job.interactive } : null,
          status: 'sent',
          deliveryId,
          createdAt: at,
        });

        // Solo lo iniciado por la empresa consume cupo diario: responder
        // dentro de la ventana de servicio no gasta warm-up. Y es lo unico
        // que mueve el marcapasos y la cuenta de "sin respuesta" del contacto.
        if (businessInitiated) {
          await repos.counters.increment(phoneId(), job.category, at);
          await repos.contacts.anotarEnvioIniciado(contact.id, at);
          if (job.manual !== true) deps.salud?.marcapasos.anotar(at);
        }

        return { ok: true, wamid: result.wamid, deliveryId };
      } catch (error) {
        const retryable = error instanceof WhatsAppApiError ? error.retryable : false;
        const message = error instanceof Error ? error.message : 'error desconocido';
        const rawCode = error instanceof WhatsAppApiError ? error.code : undefined;
        const code = codigoDeError(rawCode, message) ?? (rawCode !== undefined ? String(rawCode) : null);

        // Un fallo del proveedor es un envio que SALIO y volvio con error: se
        // apunta como `failed` con su codigo, que es lo que el monitor mira.
        // No es un bloqueo de guarda propia, donde no salio nada.
        await repos.deliveries.markFailed(deliveryId, code, message);
        if (deps.salud) {
          await deps.salud
            .registrarErrorEnvio({
              codigo: rawCode ?? code,
              mensaje: message,
              contact,
              category: job.category,
              campaignId: job.campaignId ?? null,
            })
            .catch(() => null);
        }
        // Un error que apunta al contacto (no tiene WhatsApp, esta saturado)
        // no se reintenta: insistir es exactamente lo que hay que evitar.
        const insistir = retryable && !NO_REINTENTAR.has(code ?? '');
        return { ok: false, blocked: false, error: message, retryable: insistir, deliveryId, code };
      }
    },
  };
}

/** Codigos con los que reintentar en la misma cola no tiene sentido. */
const NO_REINTENTAR = new Set(['131026', '131049', '131050', '131056', '130403', '131048', '131031', '368', '403', '131021', '131009']);

/**
 * Como se lee ese mensaje en la conversacion. Una plantilla se guarda ya
 * renderizada: en el chat interesa lo que le llego al cliente, no el nombre
 * de la plantilla ni sus variables sueltas.
 */
function describeOutgoing(
  job: SendJob,
  template: Awaited<ReturnType<Repos['templates']['get']>>,
): string {
  switch (job.kind) {
    case 'template':
      if (!template) return job.templateName ?? 'plantilla';
      try {
        return renderTemplate(template, job.variables ?? []).preview;
      } catch {
        return template.body ?? (job.templateName ?? 'plantilla');
      }
    case 'location':
      return job.location
        ? `Ubicacion: ${job.location.name ? `${job.location.name} — ` : ''}${job.location.latitude}, ${job.location.longitude}`
        : 'Ubicacion';
    case 'interactive': {
      // Con las opciones incluidas: en el chat tiene que leerse lo mismo que
      // le llego al cliente, no el cuerpo a secas. Si no, el operador no
      // entiende que significa el "2" que le acaban de contestar.
      const body = job.interactive?.body ?? '';
      const opciones = job.interactive?.buttons ?? [];
      if (opciones.length) {
        const lista = opciones.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
        return `${body}\n\n${lista}`;
      }
      // Sin `body` del proveedor -la Cloud API manda un boton nativo, que no
      // es texto- se anota que se pidio, para que el hilo no parezca cortado.
      return job.interactive?.locationRequest ? `${body}\n\n(se pidio la ubicacion)` : body;
    }
    default:
      return job.text ?? '';
  }
}

async function dispatch(
  wa: WhatsAppClient,
  job: SendJob,
  template: Awaited<ReturnType<Repos['templates']['get']>>,
) {
  switch (job.kind) {
    case 'template': {
      if (!template) throw new TemplateRenderError('plantilla no encontrada');
      const rendered = renderTemplate(template, job.variables ?? []);
      return wa.sendTemplate(job.phone, rendered.name, rendered.language, rendered.components);
    }
    case 'location': {
      if (!job.location) throw new Error('falta el campo location');
      return wa.sendLocation(job.phone, job.location);
    }
    case 'interactive': {
      if (!job.interactive) throw new Error('falta el campo interactive');
      if (job.interactive.locationRequest) {
        return wa.sendLocationRequest(job.phone, job.interactive.body);
      }
      return wa.sendButtons(job.phone, job.interactive.body, job.interactive.buttons ?? []);
    }
    case 'freeform':
    default: {
      if (!job.text) throw new Error('falta el campo text');
      return wa.sendText(job.phone, job.text);
    }
  }
}
