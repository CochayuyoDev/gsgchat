/**
 * Logica de conversacion sobre los mensajes entrantes.
 *
 * Aqui se conecta el geo core con WhatsApp y con la automatizacion. El
 * orden de preferencia importa:
 *
 *  1. ubicacion nativa: no hay nada que parsear y la coordenada es exacta;
 *  2. botones de confirmacion de una ubicacion dudosa;
 *  3. palabras de baja y alta (no admiten excepciones);
 *  4. reglas de respuesta automatica por palabra clave;
 *  5. coordenadas dentro del texto (links de mapas, DMS, plus codes...);
 *  6. bienvenida o comodin, si hay regla; si no, el boton nativo para pedir
 *     la ubicacion (configurable).
 *
 * Ademas, cualquier mensaje del cliente cuenta como respuesta: las
 * secuencias de seguimiento con `stopOnReply` se cancelan.
 */

import { extractLocation, fromWhatsAppLocation } from '../geo/extract.js';
import type { Config } from '../config.js';
import type { Contact, Repos } from '../db/repos.js';
import type { AutoReply } from '../db/automation.js';
import type { Sender } from '../outbound/sender.js';
import type { InboundMessage } from '../whatsapp/types.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { ExtractionSuccess, FailureReason } from '../types.js';
import type { MessageKind } from '../db/messages.js';
import { enrollContact, matchRule, onInboundReply, renderPlaceholders } from '../automation/engine.js';

export interface InboundDeps {
  repos: Repos;
  sender: Sender;
  wa: WhatsAppClient;
  config: Config;
}

export const CONFIRM_PREFIX = 'loc_ok:';
export const REJECT_ID = 'loc_no';

const normalize = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    // Quita los diacriticos combinantes: "BAJA", "bajá" y "Bajá" son la misma baja.
    .replace(/[̀-ͯ]/g, '');

function matchesKeyword(text: string, keywords: string[]): boolean {
  const clean = normalize(text);
  return keywords.some((k) => clean === k || clean.startsWith(`${k} `));
}

function describe(result: ExtractionSuccess): string {
  return `${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`;
}

/**
 * Como se guarda un entrante en la conversacion.
 *
 * Los tipos que el bot no sabe atender (una foto, un audio, un contacto
 * compartido) igual se anotan: en el chat el operador tiene que VER que el
 * cliente mando algo, aunque el sistema no pueda responderlo solo.
 */
export function readInbound(message: InboundMessage): { kind: MessageKind; body: string; payload: Record<string, unknown> | null } {
  if (message.type === 'location' && message.location) {
    const { latitude, longitude, name } = message.location;
    return {
      kind: 'location',
      body: `Ubicacion: ${name ? `${name} — ` : ''}${latitude}, ${longitude}`,
      payload: { location: message.location },
    };
  }
  if (message.type === 'interactive' && message.interactive) {
    const reply = message.interactive.button_reply ?? message.interactive.list_reply;
    return {
      kind: 'interactive',
      body: reply?.title ?? '(respuesta a un boton)',
      payload: { interactive: message.interactive },
    };
  }
  if (message.button?.text) {
    return { kind: 'interactive', body: message.button.text, payload: { button: message.button } };
  }
  if (message.text?.body) {
    return { kind: 'text', body: message.text.body, payload: null };
  }
  const known: MessageKind[] = ['image', 'audio', 'video', 'document', 'sticker'];
  const kind = (known as string[]).includes(message.type) ? (message.type as MessageKind) : 'unknown';
  const etiquetas: Record<string, string> = {
    image: '(foto)',
    audio: '(audio)',
    video: '(video)',
    document: '(documento)',
    sticker: '(sticker)',
  };

  // Con el fichero ya bajado, el cuerpo es el pie de foto (o el nombre del
  // documento) y la referencia va al payload para que el chat lo pinte.
  if (message.media) {
    return {
      kind,
      body: message.media.caption?.trim() || message.media.filename || etiquetas[kind] || '(adjunto)',
      payload: { media: message.media },
    };
  }

  return { kind, body: etiquetas[kind] ?? `(mensaje de tipo ${message.type})`, payload: null };
}

/** Aplica una regla: responde si tiene texto e inscribe si apunta a una secuencia. */
async function applyRule(rule: AutoReply, contact: Contact, deps: InboundDeps): Promise<void> {
  const { repos, sender } = deps;
  if (rule.reply?.trim()) {
    await sender.send({
      phone: contact.phone,
      kind: 'freeform',
      category: 'UTILITY',
      text: renderPlaceholders(rule.reply, contact),
    });
  }
  if (rule.sequenceId) {
    const sequence = await repos.automation.getSequence(rule.sequenceId);
    if (sequence?.enabled) {
      await enrollContact({ repos, sender }, sequence, contact, `regla: ${rule.name}`);
    }
  }
}

export async function handleInboundMessage(
  message: InboundMessage,
  profileName: string | undefined,
  deps: InboundDeps,
): Promise<void> {
  const { repos, sender, wa, config } = deps;
  const phone = message.from;

  const contact = await repos.contacts.upsertFromInbound(phone, profileName);
  // Antes de anotar el entrante: asi se sabe si es el primer mensaje.
  const isFirstMessage = !contact.lastInboundAt;
  // El entrante abre la ventana de servicio de 24 h: sin esto el sender
  // creeria que toda respuesta necesita plantilla.
  const receivedAt = new Date(Number(message.timestamp) * 1000 || Date.now());
  await repos.contacts.touchInbound(phone, receivedAt);
  contact.lastInboundAt = receivedAt;

  // La conversacion se guarda ANTES de decidir que hacer con el mensaje: si
  // el bot no sabe atenderlo, el operador tiene que verlo igual en el chat.
  const leido = readInbound(message);
  await repos.messages.add({
    contactId: contact.id,
    direction: 'in',
    wamid: message.id,
    kind: leido.kind,
    body: leido.body,
    payload: leido.payload,
    createdAt: receivedAt,
  });

  // Acuse de lectura: mejora la percepcion y no cuesta cuota.
  await wa.markAsRead(message.id).catch(() => undefined);

  // Cualquier mensaje del cliente es una respuesta: corta los seguimientos
  // que estaban esperando precisamente eso.
  await onInboundReply(repos, contact);

  /**
   * Por que no se pudo usar una ubicacion, en cristiano.
   *
   * Todos los fallos daban el mismo "no pude leer esa ubicacion", y el mas
   * comun de todos -la caja geografica- no tiene nada que ver con leerla: la
   * ubicacion se leyo perfectamente, lo que pasa es que cae fuera de la zona
   * configurada. Con el mensaje generico, el operador ve a un cliente
   * mandando su pin una y otra vez sin saber que el problema es GEO_BBOX.
   */
  const explicarFallo = (reason: FailureReason): string => {
    switch (reason) {
      case 'outside_bbox':
        return config.coverageName
          ? `Esa ubicacion queda fuera de nuestra cobertura. Atendemos ${config.coverageName}.`
          : 'Esa ubicacion queda fuera de la zona que atendemos.';
      case 'null_island':
      case 'out_of_range':
        return 'Esas coordenadas no son validas. Intenta enviarla de nuevo, por favor.';
      case 'short_link_unresolved':
        return 'No pude abrir ese link de mapa. Mandame el pin de ubicacion, por favor.';
      default:
        return 'No pude leer esa ubicacion. Intenta enviarla de nuevo, por favor.';
    }
  };

  const reply = (text: string) =>
    sender.send({ phone, kind: 'freeform', category: 'UTILITY', text });

  const askForLocation = (body: string) =>
    sender.send({
      phone,
      kind: 'interactive',
      category: 'UTILITY',
      interactive: { body, locationRequest: true },
    });

  // --- ubicacion nativa: el camino bueno -------------------------------
  if (message.type === 'location' && message.location) {
    const result = fromWhatsAppLocation(message.location, { bbox: config.bbox });
    if (!result.ok) {
      await reply(explicarFallo(result.reason));
      return;
    }
    const id = await repos.locations.save(contact.id, result, JSON.stringify(message.location));
    await repos.locations.confirm(id);
    await reply(`Ubicacion recibida: ${describe(result)}\n${result.mapsUrl}`);
    return;
  }

  // --- respuesta a la confirmacion -------------------------------------
  if (message.type === 'interactive' && message.interactive?.button_reply) {
    const buttonId = message.interactive.button_reply.id;
    if (buttonId.startsWith(CONFIRM_PREFIX)) {
      const locationId = Number.parseInt(buttonId.slice(CONFIRM_PREFIX.length), 10);
      if (Number.isFinite(locationId)) await repos.locations.confirm(locationId);
      await reply('Listo, confirmada la ubicacion.');
      return;
    }
    if (buttonId === REJECT_ID) {
      await askForLocation('Sin problema. Comparte tu ubicacion con el boton de abajo.');
      return;
    }
  }

  const text = message.text?.body ?? message.button?.text ?? '';
  if (!text.trim()) return;

  // --- baja y alta ------------------------------------------------------
  if (matchesKeyword(text, config.optOutKeywords)) {
    await repos.contacts.setOptOut(phone);
    // Se responde dentro de la ventana, asi que el gate de opt-out no aplica
    // a esta confirmacion: es la ultima cortesia antes de dejar de escribir.
    await wa
      .sendText(phone, 'Listo, no volveras a recibir mensajes nuestros. Responde ALTA si cambias de idea.')
      .catch(() => undefined);
    return;
  }

  if (matchesKeyword(text, config.optInKeywords)) {
    await repos.contacts.setOptIn(phone, 'whatsapp_keyword');
    await reply('Gracias, quedaste suscrito. Responde BAJA cuando quieras dejar de recibirlos.');
    return;
  }

  // --- reglas y coordenadas --------------------------------------------
  const [rules, prefs, result] = await Promise.all([
    repos.automation.listRules(),
    repos.automation.getPrefs(),
    extractLocation(text, { bbox: config.bbox }),
  ]);

  const rule = matchRule(rules, text, { isFirstMessage, hasCoordinates: result.ok });
  if (rule) await applyRule(rule, contact, deps);

  if (!result.ok) {
    // La regla ya contesto; si no habia regla, se pide la ubicacion con el
    // boton nativo (salvo que el operador lo haya apagado).
    if (!rule && prefs.askLocationFallback) {
      await askForLocation(
        'No encontre coordenadas en ese mensaje. Comparte tu ubicacion con el boton de abajo.',
      );
    }
    return;
  }

  const locationId = await repos.locations.save(contact.id, result, text);

  if (result.needsConfirmation) {
    // Confianza baja (tipico de un link con solo @lat,lng): se pregunta antes
    // de que alguien salga a repartir a la coordenada equivocada.
    await sender.send({
      phone,
      kind: 'interactive',
      category: 'UTILITY',
      interactive: {
        body: `Entendi esta ubicacion: ${describe(result)}\n${result.mapsUrl}\n\n¿Es correcta?`,
        buttons: [
          { id: `${CONFIRM_PREFIX}${locationId}`, title: 'Si, es esa' },
          { id: REJECT_ID, title: 'No, corregir' },
        ],
      },
    });
    return;
  }

  await repos.locations.confirm(locationId);
  await reply(`Ubicacion registrada: ${describe(result)}\n${result.mapsUrl}`);
}
