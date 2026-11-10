/**
 * Endpoint del webhook de Meta.
 *
 * Dos reglas que no son negociables:
 *  - se valida la firma antes de mirar el contenido;
 *  - se responde 200 de inmediato y se procesa despues. Meta reintenta y
 *    acaba desuscribiendo el webhook si tardas; procesar dentro del request
 *    es como se pierden mensajes en produccion.
 *
 * Y una tercera que evita respuestas dobles: Meta reintenta entregas que
 * cree perdidas, asi que el mismo mensaje puede llegar dos veces. Cada id
 * se recuerda un rato y la repeticion se ignora.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Repos, TemplateQuality, TemplateStatus } from '../db/repos.js';
import { verifyChallenge, verifySignature } from './signature.js';
import type { ChangeValue, WebhookPayload } from './types.js';
import { claveEntrada, handleInboundMessage, type InboundDeps } from '../handlers/inbound.js';
import type { CredencialesLinea, ServicioLineas } from './lineas.js';
import type { RegistroClientes } from './registro.js';
import { resumenDelAviso, type ServicioWebhookMeta } from './webhook-meta.js';
import type { WhatsAppClient } from './client.js';
import type { LineaDeMensaje } from './types.js';
import type { SettingsService } from '../settings/service.js';
import { TtlCache } from '../util/cache.js';
import { esPausaAutomatica } from '../salud/monitor.js';
import { perteneceAlChatActual } from './alcance-chat.js';
import { entradaAdmitida } from './entradas-admitidas.js';
import { tamanoMedia, conCupoDeDescarga, extensionDe, idDeMedia, mediaDirectory, type MediaKind } from './local/media.js';

export interface WebhookDeps extends InboundDeps {
  repos: Repos;
  config: Config;
  settings: SettingsService;
  /** Ids de mensajes ya procesados; si falta, no se deduplica. */
  seen?: TtlCache<true>;
  /** Donde se guardan los ficheros que llegan (por defecto, el de siempre). */
  mediaDir?: string;
  /** Las lineas de la tienda, para saber por cual llego cada mensaje. Sin ellas, no se anota. */
  lineas?: ServicioLineas;
  /**
   * El cliente de cada linea: un adjunto que llega por una linea de la API que
   * no es la principal se baja con el token de ESA linea. Sin esto, con `wa`.
   */
  registroClientes?: Pick<RegistroClientes, 'transporte'>;
  /** Verify token y app secret propios del webhook de Meta, y su bitacora (ver webhook-meta.ts). */
  webhookMeta?: ServicioWebhookMeta;
}

/** Cabecera con la que la prueba de «Nuestra API» marca sus llamadas (no cuentan como de Meta). */
export const CABECERA_PRUEBA_WEBHOOK = 'x-gsgchat-prueba-webhook';

/**
 * Los app secret y verify token con los que Meta puede firmar o verificar: el
 * de /setup y el de cada linea de la API que no es la principal (pueden ser
 * apps distintas de Meta). Sin repetidos ni vacios.
 */
export async function secretosDeMeta(settings: SettingsService, lineas: ServicioLineas | undefined, webhookMeta?: ServicioWebhookMeta): Promise<{ appSecrets: string[]; verifyTokens: string[] }> {
  const actual = settings.current();
  const propio = webhookMeta?.config();
  // Los propios de «Nuestra API» primero; los de /setup se siguen aceptando.
  const appSecrets = [propio?.appSecret ?? '', actual.appSecret];
  const verifyTokens = [propio?.verifyToken ?? '', actual.verifyToken];
  if (lineas) {
    for (const linea of await lineas.listar().catch(() => [])) {
      if (linea.principal || linea.proveedor !== 'cloud') continue;
      const cred = await lineas.credenciales(linea.id).catch(() => ({}) as CredencialesLinea);
      appSecrets.push(cred.appSecret ?? '');
      verifyTokens.push(cred.verifyToken ?? '');
    }
  }
  const limpios = (lista: string[]) => [...new Set(lista.map((s) => (s ?? '').trim()).filter(Boolean))];
  return { appSecrets: limpios(appSecrets), verifyTokens: limpios(verifyTokens) };
}

type RawRequest = FastifyRequest & { rawBody?: Buffer };

/** Motivo con el que el sistema pausa solo; se usa para reanudar solo eso. */
export const AUTO_PAUSE_REASON = 'calidad en ROJO reportada por Meta';

/** Cuanto dura cada pausa de plantilla segun Meta: 3 h la primera, 6 h la segunda, la tercera la deshabilita. */
export function duracionPausaPlantilla(otherInfoTitle: string | undefined, pausasPrevias: number): number | null {
  const t = (otherInfoTitle ?? '').toUpperCase();
  const numero = t.includes('FIRST') ? 1 : t.includes('SECOND') ? 2 : t.includes('THIRD') ? 3 : pausasPrevias + 1;
  if (numero >= 3) return null;
  return numero === 1 ? 3 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
}

/** El limite del tier que llega en `business_capability_update` o `current_limit`. */
function limiteNumerico(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) return valor;
  return null;
}

export function createSeenCache(): TtlCache<true> {
  // Meta reintenta durante horas como mucho; 24 h y 20.000 ids cubren de sobra.
  return new TtlCache<true>(24 * 60 * 60 * 1000, 20_000);
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: WebhookDeps,
): Promise<void> {
  const { settings } = deps;
  const withSeen: WebhookDeps = { ...deps, seen: deps.seen ?? createSeenCache() };

  // Handshake de verificacion.
  app.get('/webhooks/whatsapp', async (request, reply) => {
    // Vale el verify token de /setup o el de cualquier linea de la API.
    const { verifyTokens } = await secretosDeMeta(settings, deps.lineas, deps.webhookMeta);
    const prueba = request.headers[CABECERA_PRUEBA_WEBHOOK] === '1';
    const challenge = verifyTokens
      .map((token) => verifyChallenge(request.query as Record<string, unknown>, token))
      .find((c): c is string => c !== null) ?? null;
    if (!challenge) {
      deps.webhookMeta?.anotar({ resultado: 'verificacion_fallida', detalle: verifyTokens.length ? 'el verify token no coincide con el guardado' : 'no hay ningún verify token guardado', prueba });
      return reply.code(403).send('forbidden');
    }
    deps.webhookMeta?.anotar({ resultado: 'verificado', detalle: 'Meta verificó el webhook', prueba });
    return reply.type('text/plain').send(challenge);
  });

  app.post('/webhooks/whatsapp', async (request, reply) => {
    const raw = (request as RawRequest).rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    const signature = request.headers['x-hub-signature-256'];
    const prueba = request.headers[CABECERA_PRUEBA_WEBHOOK] === '1';

    const { appSecrets } = await secretosDeMeta(settings, deps.lineas, deps.webhookMeta);
    if (!appSecrets.length) {
      request.log.error('webhook recibido sin app secret configurado: revisa /setup');
      deps.webhookMeta?.anotar({ resultado: 'sin_secreto', detalle: 'llegó un aviso pero no hay app secret guardado para comprobar la firma', prueba });
      return reply.code(503).send('not configured');
    }

    if (!appSecrets.some((appSecret) => verifySignature(raw, typeof signature === 'string' ? signature : undefined, appSecret))) {
      request.log.warn('webhook con firma invalida');
      deps.webhookMeta?.anotar({ resultado: 'firma_invalida', detalle: signature ? 'la firma no cuadra con el app secret guardado' : 'llegó sin firma (cabecera X-Hub-Signature-256)', prueba });
      return reply.code(401).send('invalid signature');
    }

    // 200 primero, trabajo despues.
    void reply.code(200).send('ok');

    const payload = request.body as WebhookPayload;
    deps.webhookMeta?.anotar({ resultado: 'recibido', detalle: resumenDelAviso(payload), prueba });
    setImmediate(() => {
      void processPayload(payload, withSeen).catch((error) => {
        request.log.error({ err: error }, 'fallo procesando el webhook');
      });
    });
  });
}

export async function processPayload(payload: WebhookPayload, deps: WebhookDeps): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      await processChange(change.field, change.value, deps);
    }
  }
}

/**
 * Traduce el evento de calidad del numero a un semaforo.
 *
 * El payload real de `phone_number_quality_update` no trae el color: trae
 * `event` = FLAGGED (el numero paso a rojo), UNFLAGGED (volvio a verde),
 * DOWNGRADE / UPGRADE (cambio de tier, que Meta solo baja cuando la calidad
 * flaquea) u ONBOARDING. Se admite ademas el color literal por si Meta lo
 * incluye en el futuro o alguien lo manda a mano.
 */
export function qualityFromEvent(event: string | undefined): 'GREEN' | 'YELLOW' | 'RED' | null {
  const value = (event ?? '').toUpperCase();
  if (!value) return null;
  if (value.includes('RED')) return 'RED';
  if (value.includes('YELLOW')) return 'YELLOW';
  if (value.includes('GREEN')) return 'GREEN';
  if (value.includes('UNFLAG')) return 'GREEN';
  if (value.includes('FLAG')) return 'RED';
  if (value.includes('DOWNGRADE')) return 'YELLOW';
  if (value.includes('UPGRADE')) return 'GREEN';
  return null;
}

/**
 * La linea por la que llego un aviso: la que diga el transporte (`lineaId`:
 * WAHA por sesion, local por socket) o, en Meta, la del `phone_number_id` de
 * los metadatos. Si no se reconoce, es la principal: asi lo de siempre sigue
 * funcionando aunque llegue algo que no encaja con ninguna linea.
 */
export async function lineaDelAviso(value: ChangeValue, lineas: ServicioLineas | undefined): Promise<LineaDeMensaje | undefined> {
  if (!lineas) return undefined;
  const linea =
    (value.lineaId ? await lineas.obtener(value.lineaId) : null) ??
    (value.metadata?.phone_number_id ? await lineas.porIdExterno('cloud', value.metadata.phone_number_id) : null) ??
    (await lineas.principal());
  return { id: linea.id, etiqueta: linea.etiqueta, numero: linea.telefono };
}

export async function processChange(
  field: string,
  value: ChangeValue,
  deps: WebhookDeps,
): Promise<void> {
  const { repos, settings, seen } = deps;
  const principalId = settings.current().phoneNumberId;
  const phoneNumberId = principalId;

  switch (field) {
    case 'messages': {
      for (const status of value.statuses ?? []) {
        const codigo = status.errors?.[0]?.code ? String(status.errors[0].code) : undefined;
        const titulo = status.errors?.[0]?.title ?? status.errors?.[0]?.message;
        await repos.deliveries.updateByWamid(status.id, status.status, { code: codigo, title: titulo });
        // El doble check del chat sale de aqui.
        await repos.messages.setStatusByWamid(status.id, status.status);
        // Un `failed` con codigo es un envio que Meta acepto y luego no
        // entrego: el 131049 (limite por usuario) y el 131026 llegan asi. El
        // monitor aplica la misma regla que a un error en caliente.
        if (status.status === 'failed' && codigo && deps.salud) {
          await deps.salud
            .registrarFalloWebhook({ codigo, titulo: titulo ?? `error ${codigo}`, phone: status.recipient_id })
            .catch(() => undefined);
        }
      }

      const profileName = value.contacts?.[0]?.profile?.name;
      const linea = (value.messages ?? []).length ? await lineaDelAviso(value, deps.lineas) : undefined;
      for (const recibido of value.messages ?? []) {
        const message = linea ? { ...recibido, linea } : recibido;
        if (!entradaAdmitida(message)) continue;
        if (!(await perteneceAlChatActual(repos, deps.settings, message))) continue;
        // La segunda entrega de un mensaje (el telefono reenvio un "ver una
        // vez") lleva el mismo id a proposito: no es un duplicado, es el
        // fichero que faltaba.
        if (seen && message.id && !message.reenvio) {
          const clave = claveEntrada(message);
          if (seen.get(clave)) continue;
          seen.set(clave, true);
        }
        const entrante = conMediaDeMeta({ ...message, provider: message.provider ?? 'meta' });
        await guardarMediaDeMeta(entrante, deps, await clienteDelAviso(linea?.id, deps));
        await handleInboundMessage(entrante, profileName, deps);
      }
      return;
    }

    // Una plantilla rechazada o deshabilitada sale de circulacion sola. Una
    // pausada vuelve sola cuando Meta la suelta (3 h, 6 h): del final de la
    // pausa Meta no avisa, asi que se calcula y se guarda.
    case 'message_template_status_update': {
      const name = value.message_template_name;
      const language = value.message_template_language;
      if (!name || !language) return;
      const status = (value.event ?? '').toUpperCase();
      const motivo = [value.reason, value.other_info?.title, value.other_info?.description]
        .filter(Boolean)
        .join(' - ') || null;
      const actual = await repos.templates.get(name, language);

      if (status.includes('PAUSE')) {
        const pausas = (actual?.pausas ?? 0) + 1;
        const duracion = duracionPausaPlantilla(value.other_info?.title, actual?.pausas ?? 0);
        if (duracion === null) {
          await repos.templates.setStatus(name, language, 'DISABLED', motivo ?? 'tercera pausa: deshabilitada');
          await repos.templates.marcarPausa(name, language, null, pausas, motivo);
        } else {
          const hasta = new Date(Date.now() + duracion);
          // El estado local vuelve a APPROVED con `pausadaHasta`: asi el gate
          // la suelta solo cuando pase la pausa, sin esperar a ningun webhook.
          await repos.templates.setStatus(name, language, 'APPROVED', motivo);
          await repos.templates.marcarPausa(name, language, hasta, pausas, motivo);
        }
        await deps.salud?.registrarEvento('plantilla', 'PAUSED', `${name}: pausa ${pausas} (${motivo ?? 'sin motivo'})`).catch(() => undefined);
        return;
      }

      const mapped: TemplateStatus =
        status.includes('APPROVE') || status.includes('REINSTATE') ? 'APPROVED'
        : status.includes('REJECT') ? 'REJECTED'
        : status.includes('DISABLE') ? 'DISABLED'
        : status.includes('FLAG') ? 'PAUSED'
        : 'PENDING';
      await repos.templates.setStatus(name, language, mapped, motivo);
      if (mapped === 'APPROVED') await repos.templates.marcarPausa(name, language, null, actual?.pausas ?? 0, motivo);
      if (mapped === 'DISABLED' || mapped === 'REJECTED') {
        await deps.salud?.registrarEvento('plantilla', mapped, `${name}: ${motivo ?? status}`).catch(() => undefined);
      }
      return;
    }

    // Meta reclasifico la plantilla: de UTILITY a MARKETING cambia lo que
    // exige (opt-in, frecuencia) y lo que cuesta. Se anota tal cual.
    case 'template_category_update': {
      const name = value.message_template_name;
      const language = value.message_template_language;
      const nueva = (value.new_category ?? '').toUpperCase();
      if (!name || !language || !nueva) return;
      const actual = await repos.templates.get(name, language);
      if (!actual) return;
      const categoria = nueva === 'MARKETING' || nueva === 'UTILITY' || nueva === 'AUTHENTICATION' ? nueva : null;
      if (!categoria || categoria === actual.category) return;
      await repos.templates.upsert({ ...actual, category: categoria });
      await deps.salud
        ?.registrarEvento('plantilla', 'CATEGORIA', `${name}: de ${value.previous_category ?? actual.category} a ${categoria}`)
        .catch(() => undefined);
      return;
    }

    // Amarillo en una plantilla es el aviso previo a que Meta la pause.
    case 'message_template_quality_update': {
      const name = value.message_template_name;
      const language = value.message_template_language;
      if (!name || !language) return;
      const quality = (value.new_quality_score ?? '').toUpperCase();
      const mapped: TemplateQuality =
        quality === 'GREEN' || quality === 'YELLOW' || quality === 'RED' ? quality : 'UNKNOWN';
      await repos.templates.setQuality(name, language, mapped);
      return;
    }

    // Circuit breaker del numero: en rojo se pausa todo lo saliente y, cuando
    // Meta lo levanta, se reanuda solo si fue el sistema quien pauso.
    case 'phone_number_quality_update': {
      // La calidad es de UN numero: si es el de otra linea de la API, va a su estado y no al de la principal.
      const phoneNumberId = await identidadDelNumero(value, deps, principalId);
      if (value.current_limit) {
        await repos.numberState.setTier(phoneNumberId, value.current_limit);
      }
      const evento = (value.event ?? '').toUpperCase();
      await deps.salud?.registrarEvento('calidad', evento || null, `phone_number_quality_update: ${evento}`).catch(() => undefined);
      const mapped = qualityFromEvent(value.event);
      if (!mapped) return;

      await repos.numberState.setQuality(phoneNumberId, mapped);
      // FLAGGED es el estado que Meta pone al numero en rojo; se guarda tal
      // cual para que el panel diga lo mismo que WhatsApp Manager.
      if (evento.includes('UNFLAG')) await repos.numberState.setEstado(phoneNumberId, 'CONNECTED');
      else if (evento.includes('FLAG')) await repos.numberState.setEstado(phoneNumberId, 'FLAGGED');

      if (mapped === 'RED' && !deps.salud?.soloRitmo) {
        await repos.numberState.setPaused(phoneNumberId, true, AUTO_PAUSE_REASON);
        await deps.salud?.evaluar().catch(() => undefined);
        return;
      }
      const state = await repos.numberState.get(phoneNumberId);
      if (state.paused && esPausaAutomatica(state.pausedReason)) {
        await repos.numberState.setPaused(phoneNumberId, false);
      }
      await deps.salud?.evaluar().catch(() => undefined);
      return;
    }

    // La cuenta entera: restringida, deshabilitada, reinstaurada. Es el
    // aviso mas grave que manda Meta y llega por aqui, no por el numero.
    case 'account_update': {
      const evento = (value.event ?? '').toUpperCase();
      const restricciones = (value.restriction_info ?? [])
        .map((r) => `${r.restriction_type ?? 'restriccion'}${r.expiration ? ` hasta ${r.expiration}` : ''}`)
        .join(', ');
      const banState = (value.ban_info?.waba_ban_state ?? '').toUpperCase();
      const detalle = [evento, restricciones, banState, value.violation_info?.violation_type].filter(Boolean).join(' | ');
      await deps.salud?.registrarEvento('cuenta', evento || null, detalle).catch(() => undefined);

      const restringeEnvio = (value.restriction_info ?? []).some((r) =>
        (r.restriction_type ?? '').toUpperCase().includes('BIZ_INITIATED'),
      );
      const deshabilitada = banState === 'DISABLE' || banState === 'SCHEDULE_FOR_DISABLE' || evento === 'DISABLED_UPDATE' && banState !== 'REINSTATE';
      const grave = evento === 'ACCOUNT_RESTRICTION' && restringeEnvio || evento === 'ACCOUNT_VIOLATION' || deshabilitada;

      if (grave) {
        await repos.numberState.setEstado(phoneNumberId, deshabilitada ? 'BANNED' : 'RESTRICTED');
        if (!deps.salud?.soloRitmo) await repos.numberState.setPaused(phoneNumberId, true, `salud: Meta restringio la cuenta (${detalle.slice(0, 200)})`);
        await deps.salud?.evaluar().catch(() => undefined);
        return;
      }
      if (banState === 'REINSTATE' || evento === 'ACCOUNT_REINSTATED') {
        await repos.numberState.setEstado(phoneNumberId, 'CONNECTED');
        const state = await repos.numberState.get(phoneNumberId);
        if (state.paused && esPausaAutomatica(state.pausedReason)) await repos.numberState.setPaused(phoneNumberId, false);
        await deps.salud?.evaluar().catch(() => undefined);
      }
      return;
    }

    // El limite numerico de conversaciones por dia: es el dato exacto del
    // tier, mejor que deducirlo del nombre TIER_xxx. Desde Graph v24 viene
    // como `max_daily_conversations_per_business` (es del portafolio de
    // Meta, compartido por todos sus numeros); antes, por telefono.
    case 'business_capability_update': {
      const porPortafolio = limiteNumerico(value.max_daily_conversations_per_business);
      const limite = porPortafolio ?? limiteNumerico(value.max_daily_conversation_per_phone);
      if (limite !== null) {
        await repos.numberState.setLimite24h(phoneNumberId, limite);
        await deps.salud?.registrarEvento('cuenta', 'LIMITE', `${porPortafolio !== null ? 'max_daily_conversations_per_business (portafolio)' : 'max_daily_conversation_per_phone'} = ${limite}`).catch(() => undefined);
      }
      return;
    }

    // La persona pulso "dejar de recibir marketing" en WhatsApp. Es una baja
    // de marketing a todos los efectos, y `resume` la levanta.
    case 'user_preferences': {
      for (const pref of value.user_preferences ?? []) {
        if (!pref.wa_id || (pref.category ?? '') !== 'marketing_messages') continue;
        const contacto = await repos.contacts.upsertFromInbound(pref.wa_id);
        if ((pref.value ?? '').toLowerCase() === 'stop') {
          await repos.contacts.suprimir(
            contacto.phone,
            new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            'pidio no recibir marketing desde WhatsApp (user_preferences)',
            'marketing',
          );
          await deps.salud?.registrarEvento('supresion', '131050', `${contacto.phone}: marketing stop`, { contactId: contacto.id }).catch(() => undefined);
        } else if ((pref.value ?? '').toLowerCase() === 'resume') {
          await repos.contacts.levantarSupresion(contacto.phone);
          await deps.salud?.registrarEvento('supresion', 'RESUME', `${contacto.phone}: marketing resume`, { contactId: contacto.id }).catch(() => undefined);
        }
      }
      return;
    }

    default:
      return;
  }
}

/**
 * Meta solo guarda el fichero un tiempo (unos 30 dias): si nadie lo abre antes,
 * la foto, el video o el audio desaparecen del chat. Por eso se baja en cuanto
 * llega y se deja en el disco, con el nombre que ya busca `GET /archivos/:token`
 * (ver src/api/v1/archivos-gsg.ts). Si falla no se pierde nada: se vuelve a
 * intentar cuando alguien lo abra.
 */
/**
 * Con que id se lleva el estado del numero del aviso: el de otra linea de la
 * API si el numero mostrado es suyo (`linea:<id>`, como en el sender), si no
 * el de la principal.
 */
async function identidadDelNumero(value: ChangeValue, deps: WebhookDeps, principal: string): Promise<string> {
  const mostrado = String(value.display_phone_number ?? value.metadata?.display_phone_number ?? '').replace(/\D+/g, '');
  if (!mostrado || !deps.lineas) return principal;
  const linea = (await deps.lineas.listar().catch(() => [])).find((l) => !l.principal && l.proveedor === 'cloud' && l.telefono === mostrado);
  return linea ? `linea:${linea.id}` : principal;
}

/** El cliente de la linea por la que llego el aviso; sin registro o sin linea, el de siempre. */
async function clienteDelAviso(lineaId: string | undefined, deps: WebhookDeps): Promise<WhatsAppClient> {
  if (!lineaId || !deps.registroClientes) return deps.wa;
  const t = await deps.registroClientes.transporte(lineaId).catch(() => null);
  return t?.cliente ?? deps.wa;
}

async function guardarMediaDeMeta(message: { type?: string; media?: unknown }, deps: WebhookDeps, wa: WhatsAppClient = deps.wa): Promise<void> {
  const media = message.media as { id?: unknown; mimeType?: unknown } | undefined;
  if (!media || typeof media.id !== 'string' || typeof media.mimeType !== 'string' || (!wa.downloadMedia && !wa.downloadMediaToFile)) return;
  try {
    const dir = deps.mediaDir ?? mediaDirectory();
    const copia = idDeMedia(`meta:${media.id}`, extensionDe(media.mimeType, message.type as MediaKind));
    // Ya esta en disco: lo del QR se guarda al recibirlo (su id es el nombre del fichero) y lo de Meta, la vez anterior. No se baja nada.
    if ((await tamanoMedia(dir, media.id)) !== null || (await tamanoMedia(dir, copia)) !== null) return;
    await mkdir(dir, { recursive: true });
    await conCupoDeDescarga(async () => {
      if (wa.downloadMediaToFile) {
        await wa.downloadMediaToFile(media.id as string, path.join(dir, copia));
        return;
      }
      const bajado = await wa.downloadMedia!(media.id as string);
      await writeFile(path.join(dir, copia), bajado.datos);
    });
  } catch (error) {
    console.warn('[webhook] no se pudo guardar el archivo de Meta al recibirlo', error instanceof Error ? error.message : error);
  }
}

/**
 * La API de Meta trae el adjunto como `image: { id, mime_type, caption }` (o
 * `audio`, `video`): solo el id, el fichero se baja aparte cuando alguien lo
 * abre (ver src/api/v1/archivos-gsg.ts). Aqui se pasa a `media`, la forma
 * comun con la que se guarda en el chat.
 */
export function conMediaDeMeta<T extends { type?: string; media?: unknown }>(message: T): T {
  if (message.media || !message.type || !['image', 'audio', 'video', 'sticker'].includes(message.type)) return message;
  const crudo = (message as Record<string, unknown>)[message.type] as { id?: unknown; mime_type?: unknown; caption?: unknown; voice?: unknown } | undefined;
  if (!crudo || typeof crudo.id !== 'string') return message;
  return {
    ...message,
    media: {
      id: crudo.id,
      mimeType: typeof crudo.mime_type === 'string' ? crudo.mime_type : 'application/octet-stream',
      ...(typeof crudo.caption === 'string' && crudo.caption ? { caption: crudo.caption } : {}),
      ...(crudo.voice === true ? { voice: true } : {}),
    },
  };
}
