/**
 * Motor de automatizacion.
 *
 * Tres piezas:
 *  - reglas de respuesta automatica sobre lo que escribe el cliente;
 *  - secuencias de seguimiento: al inscribir a un contacto se programa el
 *    primer paso y, cuando ese paso se procesa, el siguiente;
 *  - el ticker que reclama los mensajes vencidos y los manda por el sender.
 *
 * Nada de esto se salta las guardas: cada envio pasa por `sender.send`, que
 * bloquea sin opt-in, fuera de ventana o con el numero pausado. Un paso
 * bloqueado de forma definitiva termina la secuencia; uno con espera se
 * vuelve a programar.
 */

import type { Contact, Repos } from '../db/repos.js';
import type {
  AutoReply,
  Enrollment,
  ScheduledMessage,
  Sequence,
  SequenceStep,
} from '../db/automation.js';
import type { Sender, SendOutcome } from '../outbound/sender.js';

const normalize = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * "Buenos dias", "Buenas tardes" o "Buenas noches" segun la hora del negocio.
 *
 * La hora que importa es la del cliente, no la del servidor: este puede estar
 * en cualquier parte, y un "buenos dias" a medianoche delata al robot. Por eso
 * se calcula con la zona horaria configurada (TIMEZONE) y no con la del
 * proceso.
 *
 * Los cortes son los del habla, no los astronomicos: la tarde empieza a las 12
 * y la noche a las 19.
 */
export function saludoPorHora(now: Date = new Date(), timezone = 'America/Lima'): string {
  let hora: number;
  try {
    hora = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone,
      }).format(now),
    );
  } catch {
    // Zona horaria invalida: mejor saludar con la del servidor que reventar.
    hora = now.getHours();
  }
  // Intl devuelve 24 para la medianoche en algunas versiones de Node.
  if (hora === 24) hora = 0;

  if (hora < 12) return 'Buenos dias';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/** {nombre}, {telefono}, {saludo} y {fecha} dentro de un texto o una variable. */
export function renderPlaceholders(
  value: string,
  contact: Contact,
  now: Date = new Date(),
  timezone = 'America/Lima',
): string {
  const name = contact.name?.trim() || '';
  return value
    .replace(/\{nombre\}/gi, name)
    .replace(/\{telefono\}/gi, contact.phone)
    .replace(/\{saludo\}/gi, saludoPorHora(now, timezone))
    .replace(/\{fecha\}/gi, now.toLocaleDateString('es-PE', { timeZone: timezone }))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function keywordMatches(rule: AutoReply, text: string): boolean {
  const keyword = normalize(rule.keyword ?? '');
  if (!keyword) return false;
  const clean = normalize(text);
  switch (rule.match) {
    case 'equals':
      return clean === keyword;
    case 'starts':
      return clean === keyword || clean.startsWith(`${keyword} `);
    case 'contains':
    default:
      return clean.includes(keyword);
  }
}

/**
 * Elige la regla que aplica a un texto. Las de palabra clave mandan; si
 * ninguna casa, la de bienvenida (solo en el primer mensaje) y por ultimo
 * la de "cualquier texto". Dentro de cada grupo decide `priority`.
 */
export function matchRule(
  rules: AutoReply[],
  text: string,
  opts: { isFirstMessage: boolean; hasCoordinates: boolean },
): AutoReply | null {
  const enabled = rules.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);

  const keyword = enabled.find((r) => r.trigger === 'keyword' && keywordMatches(r, text));
  if (keyword) return keyword;

  // Con coordenadas en el mensaje, el flujo de ubicacion se encarga de
  // responder: bienvenida y comodin solo actuan cuando no hay nada mejor.
  if (opts.hasCoordinates) return null;

  if (opts.isFirstMessage) {
    const welcome = enabled.find((r) => r.trigger === 'first_message');
    if (welcome) return welcome;
  }
  return enabled.find((r) => r.trigger === 'any') ?? null;
}

export interface EngineDeps {
  repos: Repos;
  sender: Sender;
  now?: () => Date;
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

function stepDue(from: Date, step: SequenceStep): Date {
  return new Date(from.getTime() + Math.max(0, step.delayMinutes) * 60_000);
}

async function scheduleStep(
  repos: Repos,
  enrollment: Enrollment,
  step: SequenceStep,
  from: Date,
): Promise<number> {
  const id = await repos.automation.schedule({
    contactId: enrollment.contactId,
    enrollmentId: enrollment.id,
    stepPosition: step.position,
    dueAt: stepDue(from, step),
    kind: step.kind === 'template' ? 'template' : 'freeform',
    category: step.category,
    templateName: step.templateName,
    templateLanguage: step.templateLanguage,
    variables: step.variables,
    text: step.text,
  });
  await repos.automation.setEnrollmentStep(enrollment.id, step.position);
  return id;
}

/**
 * Inscribe a un contacto y programa el primer paso. Si ya estaba inscrito
 * y activo, no duplica: devuelve la inscripcion existente.
 */
export async function enrollContact(
  deps: EngineDeps,
  sequence: Sequence,
  contact: Contact,
  source: string | null,
): Promise<{ enrollment: Enrollment; created: boolean }> {
  const now = deps.now?.() ?? new Date();
  const result = await deps.repos.automation.enroll(sequence.id, contact.id, source);
  if (!result.created) return result;

  const first = sequence.steps[0];
  if (!first) {
    await deps.repos.automation.finishEnrollment(result.enrollment.id, 'completed');
    return result;
  }
  await scheduleStep(deps.repos, result.enrollment, first, now);
  return result;
}

/** Cancela una inscripcion y todo lo que tuviera pendiente. */
export async function cancelEnrollment(repos: Repos, enrollmentId: string): Promise<void> {
  await repos.automation.cancelPendingForEnrollment(enrollmentId);
  await repos.automation.finishEnrollment(enrollmentId, 'cancelled');
}

/**
 * El contacto escribio: las secuencias con `stopOnReply` se cancelan. Es lo
 * que evita mandar el "no hemos sabido de ti" a quien acaba de responder.
 */
export async function onInboundReply(repos: Repos, contact: Contact): Promise<number> {
  let cancelled = 0;
  for (const enrollment of await repos.automation.activeEnrollmentsFor(contact.id)) {
    if (!enrollment.stopOnReply) continue;
    await cancelEnrollment(repos, enrollment.id);
    cancelled++;
  }
  return cancelled;
}

/** Tras procesar un paso, programa el siguiente o cierra la inscripcion. */
async function advance(deps: EngineDeps, message: ScheduledMessage, processedAt: Date): Promise<void> {
  const { repos } = deps;
  if (!message.enrollmentId) return;
  const enrollment = await repos.automation.getEnrollment(message.enrollmentId);
  if (!enrollment || enrollment.status !== 'active') return;

  const sequence = await repos.automation.getSequence(enrollment.sequenceId);
  const next = sequence?.steps.find((s) => s.position === (message.stepPosition ?? 0) + 1);
  if (!sequence || !next) {
    await repos.automation.finishEnrollment(enrollment.id, 'completed');
    return;
  }
  await scheduleStep(repos, enrollment, next, processedAt);
}

async function dispatch(deps: EngineDeps, message: ScheduledMessage, contact: Contact, now: Date): Promise<SendOutcome> {
  if (message.kind === 'template') {
    return deps.sender.send({
      phone: contact.phone,
      kind: 'template',
      category: message.category,
      templateName: message.templateName ?? '',
      templateLanguage: message.templateLanguage ?? 'es_MX',
      variables: message.variables.map((v) => renderPlaceholders(v, contact, now)),
    });
  }
  return deps.sender.send({
    phone: contact.phone,
    kind: 'freeform',
    category: message.category,
    text: renderPlaceholders(message.text ?? '', contact, now),
  });
}

export interface RunReport {
  processed: number;
  sent: number;
  blocked: number;
  failed: number;
  rescheduled: number;
}

/**
 * Procesa los mensajes programados vencidos. Lo llama el ticker cada pocos
 * segundos y el boton "ejecutar ahora" del panel.
 */
export async function runDueMessages(deps: EngineDeps, limit = 100): Promise<RunReport> {
  const { repos } = deps;
  const now = deps.now?.() ?? new Date();
  const report: RunReport = { processed: 0, sent: 0, blocked: 0, failed: 0, rescheduled: 0 };

  for (const message of await repos.automation.claimDue(now, limit)) {
    report.processed++;
    const contact = await repos.contacts.getById(message.contactId);
    if (!contact) {
      await repos.automation.markScheduled(message.id, 'failed', 'el contacto ya no existe');
      report.failed++;
      continue;
    }

    let outcome: SendOutcome;
    try {
      outcome = await dispatch(deps, message, contact, now);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await repos.automation.markScheduled(message.id, 'failed', detail);
      report.failed++;
      deps.log?.('mensaje programado fallido', { id: message.id, detail });
      continue;
    }

    if (outcome.ok) {
      await repos.automation.markScheduled(message.id, 'sent', null, outcome.deliveryId);
      report.sent++;
      await advance(deps, message, now);
      continue;
    }

    if (outcome.blocked && outcome.retryAfterMs) {
      // Cupo agotado o numero en amarillo: se reprograma tal cual, sin
      // avanzar la secuencia. La inscripcion sigue activa.
      await repos.automation.markScheduled(message.id, 'cancelled', `reprogramado: ${outcome.reason}`, outcome.deliveryId);
      await repos.automation.schedule({
        contactId: message.contactId,
        enrollmentId: message.enrollmentId,
        stepPosition: message.stepPosition,
        dueAt: new Date(now.getTime() + outcome.retryAfterMs),
        kind: message.kind,
        category: message.category,
        templateName: message.templateName,
        templateLanguage: message.templateLanguage,
        variables: message.variables,
        text: message.text,
      });
      report.rescheduled++;
      continue;
    }

    const detail = outcome.blocked ? `${outcome.code}: ${outcome.reason}` : outcome.error;
    await repos.automation.markScheduled(
      message.id,
      outcome.blocked ? 'blocked' : 'failed',
      detail,
      outcome.deliveryId,
    );
    if (outcome.blocked) report.blocked++;
    else report.failed++;

    // Un bloqueo definitivo (baja, sin opt-in) o un error no reintentable
    // cierra la secuencia: insistir solo suma bloqueos.
    if (message.enrollmentId) {
      await cancelEnrollment(repos, message.enrollmentId);
    }
  }

  return report;
}

/** Ticker: procesa vencidos cada `intervalMs`. Devuelve la funcion para pararlo. */
export function startScheduler(deps: EngineDeps, intervalMs = 10_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueMessages(deps);
    } catch (error) {
      deps.log?.('fallo del ticker de automatizacion', {
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
