/**
 * Donde nacen los eventos: envolviendo los repositorios.
 *
 * Se podria emitir desde cada handler, pero hay tres proveedores de
 * WhatsApp, una importacion de historial, el sender, el motor de rutas y el
 * chat, y todos acaban en las mismas escrituras: `messages.add`,
 * `setStatusByWamid`, `locations.save`, `contacts.setOptOut`... Envolver
 * esas escrituras es un solo sitio, y no se olvida ninguna puerta.
 *
 * Lo que devuelve es un `Repos` igual al que entra; el resto del sistema no
 * sabe que esta observado. Si el bus falla, el repositorio ya escribio: un
 * evento perdido es mucho menos grave que un mensaje sin guardar.
 */

import type { Repos } from '../db/repos.js';
import type { Bus, ContactoEvento, Eventos } from './bus.js';

const iso = (d?: Date | null) => (d ?? new Date()).toISOString();

/** Quien mando un saliente, con los tres valores del contrato (ver sender.ts `conOrigen`). */
const autorDe = (origen: unknown): 'persona' | 'ia' | 'sistema' => (origen === 'persona' || origen === 'ia' ? origen : 'sistema');

export function observarRepos(repos: Repos, bus: Bus): Repos {
  const contacto = async (id: string): Promise<ContactoEvento | null> => {
    const c = await repos.contacts.getById(id);
    return c ? { id: c.id, telefono: c.phone, nombre: c.name } : null;
  };
  const ventanaAbierta = (lastInboundAt: Date | null | undefined, ahora: Date) =>
    Boolean(lastInboundAt && ahora.getTime() - lastInboundAt.getTime() < 24 * 60 * 60 * 1000);

  const messages: Repos['messages'] = {
    ...repos.messages,
    async add(message) {
      // Con `on conflict (wamid)` la misma fila puede entrar dos veces
      // (WhatsApp Web reentrega al reconectar; la importacion de WAHA se
      // puede repetir). Se avisa solo la primera.
      const repetido = message.wamid ? await repos.messages.existsByWamid(message.wamid) : false;
      const id = await repos.messages.add(message);
      if (repetido) return id;

      const c = await repos.contacts.getById(message.contactId);
      if (!c) return id;
      const quien: ContactoEvento = { id: c.id, telefono: c.phone, nombre: c.name };
      const fecha = iso(message.createdAt);

      const payload = (message.payload ?? {}) as { transcripcion?: unknown; anuncio?: unknown; origen?: unknown; autorNombre?: unknown; media?: { voz?: unknown } };
      if (message.direction === 'in') {
        bus.emitir('mensaje.recibido', {
          contacto: quien,
          mensaje: {
            id: message.wamid ?? null,
            tipo: message.kind,
            texto: message.body ?? null,
            transcripcion: typeof payload.transcripcion === 'string' ? payload.transcripcion : null,
            anuncio: payload.anuncio && typeof payload.anuncio === 'object' ? (payload.anuncio as Eventos['mensaje.recibido']['mensaje']['anuncio']) : null,
            datos: message.payload ?? null,
            fecha,
          },
          ventanaAbierta: ventanaAbierta(c.lastInboundAt, message.createdAt ?? new Date()),
        });
      } else {
        bus.emitir('mensaje.enviado', {
          contacto: quien,
          mensaje: {
            id: message.wamid ?? null,
            tipo: message.kind,
            texto: message.body ?? null,
            autor: autorDe(payload.origen),
            autorNombre: typeof payload.autorNombre === 'string' ? payload.autorNombre : null,
            voz: payload.media?.voz === true,
            fecha,
          },
        });
      }
      return id;
    },
    async setStatusByWamid(wamid, status) {
      await repos.messages.setStatusByWamid(wamid, status);
      bus.emitir('mensaje.estado', { mensajeId: wamid, estado: status, fecha: iso() });
    },
  };

  const locations: Repos['locations'] = {
    ...repos.locations,
    async save(contactId, result, rawInput) {
      const id = await repos.locations.save(contactId, result, rawInput);
      const quien = await contacto(contactId);
      if (quien) {
        bus.emitir('ubicacion.recibida', {
          contacto: quien,
          ubicacion: {
            lat: result.lat,
            lng: result.lng,
            fuente: result.source,
            confianza: result.confidence,
            necesitaConfirmacion: result.needsConfirmation,
          },
          fecha: iso(),
        });
      }
      return id;
    },
  };

  const contacts: Repos['contacts'] = {
    ...repos.contacts,
    async setOptIn(phone, source) {
      await repos.contacts.setOptIn(phone, source);
      bus.emitir('contacto.alta', { contacto: { telefono: phone }, origen: source, fecha: iso() });
    },
    async bulkOptIn(entries, source) {
      const n = await repos.contacts.bulkOptIn(entries, source);
      const fecha = iso();
      for (const e of entries) bus.emitir('contacto.alta', { contacto: { telefono: e.phone }, origen: source, fecha });
      return n;
    },
    async setOptOut(phone) {
      await repos.contacts.setOptOut(phone);
      bus.emitir('contacto.baja', { contacto: { telefono: phone }, fecha: iso() });
    },
  };

  const rutas: Repos['rutas'] = {
    ...repos.rutas,
    async actualizarSolicitud(id, patch) {
      const s = await repos.rutas.actualizarSolicitud(id, patch);
      // Solo lo que le importa a otro sistema: el estado o la incidencia.
      // Un "ultimo intento a las 10:32" no es un cambio que anunciar.
      if (patch.estado !== undefined || patch.incidencia !== undefined) {
        bus.emitir('reparto.solicitud.actualizada', {
          solicitud: {
            id: s.id,
            loteId: s.loteId,
            telefono: s.phone ?? s.telefonoCrudo,
            referencia: s.referencia,
            estado: s.estado,
            incidencia: s.incidencia,
          },
          ubicacion: s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null,
          fecha: iso(),
        });
      }
      return s;
    },
  };

  // El monitor guarda el riesgo cada minuto; el nivel cambia pocas veces.
  // Se recuerda el ultimo para avisar solo cuando de verdad cambia.
  let nivelAnterior: string | null | undefined;
  const numberState: Repos['numberState'] = {
    ...repos.numberState,
    async setRiesgo(phoneNumberId, patch) {
      if (nivelAnterior === undefined) {
        nivelAnterior = (await repos.numberState.get(phoneNumberId).catch(() => null))?.nivel ?? null;
      }
      await repos.numberState.setRiesgo(phoneNumberId, patch);
      if (patch.nivel !== nivelAnterior) {
        bus.emitir('salud.nivel', { de: nivelAnterior, a: patch.nivel, puntos: patch.riesgo, motivos: patch.motivos, fecha: iso() });
        nivelAnterior = patch.nivel;
      }
    },
  };

  return { ...repos, messages, locations, contacts, rutas, numberState };
}
