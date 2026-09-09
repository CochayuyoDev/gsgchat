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
  | { ok: false; blocked: false; error: string; retryable: boolean; deliveryId: number | null };

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

      const [numberState, marketingLast7d, sentToday] = await Promise.all([
        repos.numberState.get(phoneId()),
        repos.deliveries.countMarketingSince(contact.id, sevenDaysBefore(at)),
        repos.counters.totalForDay(phoneId(), at),
      ]);

      const deliveryId = await repos.deliveries.create({
        contactId: contact.id,
        campaignId: job.campaignId ?? null,
        kind: job.kind,
        templateName: job.templateName ?? null,
        category: job.category,
        variables: job.variables,
      });

      const decision = evaluateGates(
        { contact, kind: job.kind, category: job.category, template, now: at, manual: job.manual },
        {
          numberState,
          marketingLast7d,
          sentToday,
          dailyCap: dailyCapFor(numberState.warmupStartedOn, at, warmup),
          maxMarketingPerContact7d,
          serviceWindowApplies: ventanaAplica(),
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
        // dentro de la ventana de servicio no gasta warm-up.
        const businessInitiated = job.kind === 'template' || !isWithinServiceWindow(contact, at);
        if (businessInitiated) {
          await repos.counters.increment(phoneId(), job.category, at);
        }

        return { ok: true, wamid: result.wamid, deliveryId };
      } catch (error) {
        const retryable = error instanceof WhatsAppApiError ? error.retryable : false;
        const message = error instanceof Error ? error.message : 'error desconocido';
        await repos.deliveries.markBlocked(deliveryId, message.slice(0, 500));
        return { ok: false, blocked: false, error: message, retryable, deliveryId };
      }
    },
  };
}

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
