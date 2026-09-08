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
import type { ExtractionSuccess } from '../types.js';
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

  // Acuse de lectura: mejora la percepcion y no cuesta cuota.
  await wa.markAsRead(message.id).catch(() => undefined);

  // Cualquier mensaje del cliente es una respuesta: corta los seguimientos
  // que estaban esperando precisamente eso.
  await onInboundReply(repos, contact);

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
      await reply('No pude leer esa ubicacion. Intenta enviarla de nuevo, por favor.');
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
