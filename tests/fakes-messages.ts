/** Doble en memoria del repositorio de mensajes. */

import type { Contact } from '../src/db/repos.js';
import type { Conversation, Message, MessagesRepo, NewMessage } from '../src/db/messages.js';

let seq = 1;

export interface FakeMessages extends MessagesRepo {
  _all: Message[];
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function createFakeMessages(
  contacts: () => Array<Contact & { chatReadAt?: Date | null }>,
): FakeMessages {
  const all: Message[] = [];
  const receipts = new Map<string, { expiresAt: Date; estado: 'procesando' | 'aceptado' | 'incierto' }>();
  const controls = new Map<string, { expiresAt: Date; estado: 'procesando' | 'aceptado' | 'fallido' | 'incierto'; wamid: string | null }>();
  const visible = (m: Message, desde?: Date | null) => !desde || (m.createdAt >= desde && !m.payload?.historial && m.payload?.autorNombre !== 'Teléfono');
  const visibleScope = (m: Message, scope?: { afterId: string; retenidosDesde: Date }) => !scope || (BigInt(m.id) > BigInt(scope.afterId) && Boolean(m.storedAt && m.storedAt > scope.retenidosDesde) && visible(m));
  const iniciadoScope = (contactId: string, scope?: { afterId: string; retenidosDesde: Date }) => !scope || all.some(m => m.contactId === contactId && m.direction === 'out' && Boolean(m.wamid) && !['failed', 'blocked_by_gate'].includes(m.status ?? '') && visibleScope(m, scope));
  const inicio = (contactId: string, desde: Date) => all.filter(m => m.contactId === contactId && m.direction === 'out' && m.wamid && visible(m, desde)).sort((a,b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.createdAt ?? null;

  const repo: FakeMessages = {
    _all: all,

    async reservarEntrada(provider, wamid, recibidoAt, expiresAt) {
      const key = `${provider}:${wamid}`;
      const old = receipts.get(key);
      if (old && old.expiresAt > recibidoAt) return false;
      receipts.set(key, { expiresAt, estado: 'procesando' });
      return true;
    },
    async finalizarEntrada(provider, wamid, estado) {
      const old = receipts.get(`${provider}:${wamid}`);
      if (old && old.estado === 'procesando') old.estado = estado;
    },
    async limpiarEntradasAntes(ahora) {
      let removed = 0;
      for (const [key, receipt] of receipts) if (receipt.expiresAt <= ahora && removed < 1000) { receipts.delete(key); removed++; }
      return removed;
    },
    async reservarAccionWhatsapp(input) {
      const old = controls.get(input.key);
      if (old && old.expiresAt > input.ahora && old.estado !== 'fallido') return false;
      controls.set(input.key, { expiresAt: input.expira, estado: 'procesando', wamid: null });
      return true;
    },
    async finalizarAccionWhatsapp(key, estado, wamidSaliente = null) {
      const old = controls.get(key);
      if (old?.estado === 'procesando') { old.estado = estado; old.wamid = wamidSaliente; }
    },
    async limpiarAccionesWhatsappAntes(ahora) {
      let removed = 0;
      for (const [key, control] of controls) if (control.expiresAt <= ahora && removed < 1000) { controls.delete(key); removed++; }
      return removed;
    },

    async ultimoId() { return String(all.reduce((max,m) => Math.max(max,m.id), 0)); },

    async existsByWamid(wamid: string) {
      return all.some((m) => m.wamid === wamid);
    },

    async tieneAdjunto(wamid: string) {
      return all.some((m) => m.wamid === wamid && Boolean(m.payload && 'media' in m.payload));
    },

    async marcarBorradoPorRemitente(wamid, at) {
      const fila = all.find((m) => m.wamid === wamid);
      if (!fila) return false;
      fila.payload = { ...(fila.payload ?? {}), borradoPorRemitente: at.toISOString() };
      return true;
    },
    async completarPorWamid(wamid, datos) {
      const fila = all.find((m) => m.wamid === wamid);
      if (!fila || (fila.payload && 'media' in fila.payload)) return false;
      fila.kind = datos.kind;
      fila.body = datos.body;
      fila.payload = datos.payload;
      return true;
    },

    async contarEntrantesDesde(since: Date) {
      return all.filter((m) => m.direction === 'in' && m.createdAt >= since).length;
    },

    async actividadPorDia(since: Date) {
      const porDia = new Map<string, { dia: string; entrantes: number; salientes: number }>();
      for (const m of all) {
        if (m.createdAt < since) continue;
        const dia = m.createdAt.toISOString().slice(0, 10);
        const fila = porDia.get(dia) ?? { dia, entrantes: 0, salientes: 0 };
        if (m.direction === 'in') fila.entrantes += 1;
        else fila.salientes += 1;
        porDia.set(dia, fila);
      }
      return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
    },

    async contarEsperandoRespuesta() {
      let total = 0;
      for (const c of contacts()) {
        const ultimo = all.filter((m) => m.contactId === c.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)[0];
        if (!ultimo || ultimo.direction !== 'in') continue;
        const leido = (c as { chatReadAt?: Date | null }).chatReadAt ?? null;
        if (!leido || ultimo.createdAt > leido) total += 1;
      }
      return total;
    },

    async add(message: NewMessage) {
      // Igual que el repo de verdad: una reaccion no es un mensaje, se cuelga
      // del mensaje reaccionado (ver `createMessagesRepo`).
      const reaction = (message.payload as { reaction?: { emoji?: string; message_id?: string } } | null)?.reaction;
      if (reaction?.message_id) {
        const autor = (message.payload as { autor?: { telefono?: string | null } } | null)?.autor;
        const quien = autor?.telefono || (message.direction === 'in' ? 'cliente' : 'yo');
        await repo.reaccionar(reaction.message_id, quien, String(reaction.emoji ?? ''), message.createdAt ?? new Date());
        return 0;
      }
      if (message.wamid) {
        const existing = all.find((m) => m.wamid === message.wamid);
        if (existing) {
          if (message.status) existing.status = message.status;
          return existing.id;
        }
      }
      const row: Message = {
        id: seq++,
        contactId: message.contactId,
        direction: message.direction,
        wamid: message.wamid ?? null,
        kind: message.kind,
        body: message.body ?? null,
        payload: message.payload ?? null,
        status: message.status ?? null,
        deliveryId: message.deliveryId ?? null,
        createdAt: message.createdAt ?? new Date(),
        storedAt: new Date(),
      };
      all.push(row);
      return row.id;
    },

    async setStatusByWamid(wamid, status) {
      const row = all.find((m) => m.wamid === wamid);
      if (!row) return;
      const rango = (s: unknown) => ({ read: 3, delivered: 2, sent: 1 })[String(s)] ?? 0;
      if (status === 'failed' || rango(status) > rango(row.status)) row.status = status;
    },

    async listConversations(query) {
      const q = query.q?.trim().toLowerCase();
      const now = Date.now();
      const lastId = new Map<string, number>();
      for (const m of all) lastId.set(m.contactId, Math.max(lastId.get(m.contactId) ?? 0, m.id));
      const rows = contacts()
        .filter(c => query.alcance ? iniciadoScope(c.id, query.alcance) : !query.desde || Boolean(inicio(c.id, query.desde)))
        .filter((c) => !q || c.phone.includes(q) || (c.name ?? '').toLowerCase().includes(q))
        .map((c) => {
          const mine = all
            .filter((m) => m.contactId === c.id && visible(m, query.desde) && visibleScope(m, query.alcance))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
          const last = mine.at(-1);
          const readAt = c.chatReadAt ?? null;
          return {
            contactId: c.id,
            phone: c.phone,
            name: c.name,
            tipo: c.tipo ?? 'persona',
            optInAt: c.optInAt,
            optOutAt: c.optOutAt,
            lastInboundAt: c.lastInboundAt,
            lastMessage: last
              ? {
                  direction: last.direction,
                  kind: last.kind,
                  body: last.body,
                  status: last.status,
                  createdAt: last.createdAt,
                }
              : null,
            unread: mine.filter(
              (m) => m.direction === 'in' && (!readAt || m.createdAt.getTime() > readAt.getTime()),
            ).length,
            windowOpen: Boolean(c.lastInboundAt && now - c.lastInboundAt.getTime() < WINDOW_MS),
            fijadoAt: c.chatFijadoAt ?? null,
            silenciadoAt: c.chatSilenciadoAt ?? null,
            apartadoAt: c.chatApartadoAt ?? null,
          } satisfies Conversation;
        })
        .filter((c) => query.incluirApartados || !c.apartadoAt)
        .sort((a, b) => {
          // Lo fijado manda sobre la hora, igual que en el SQL.
          const fa = a.fijadoAt?.getTime() ?? 0;
          const fb = b.fijadoAt?.getTime() ?? 0;
          if (fa !== fb) return fb - fa;
          const ta = (a.lastMessage?.createdAt ?? a.lastInboundAt)?.getTime() ?? 0;
          const tb = (b.lastMessage?.createdAt ?? b.lastInboundAt)?.getTime() ?? 0;
          // Mismo desempate que el SQL: la hora de WhatsApp viene en segundos.
          return tb - ta || (lastId.get(b.contactId) ?? 0) - (lastId.get(a.contactId) ?? 0);
        });
      return rows.slice(query.offset, query.offset + query.limit);
    },

    async inicioSistemaDesde(contactId, desde) { return inicio(contactId, desde); },
    async iniciadaEnAlcance(contactId, alcance) { return iniciadoScope(contactId, alcance); },
    async referenciaVisiblePorWamid(wamid, retenidosDesde) {
      const m = all.find(x => x.wamid === wamid && x.storedAt && x.storedAt > retenidosDesde && visible(x));
      return m ? { contactId: m.contactId, id: String(m.id) } : null;
    },
    async limpiarAntes(desde) {
      const ids = new Set(all.filter(m => !m.storedAt || m.storedAt <= desde).slice(0,1000).map(m => m.id));
      for (let i = all.length - 1; i >= 0; i--) if (ids.has(all[i]!.id)) all.splice(i,1);
      return ids.size;
    },
    async listMessages(contactId, limit, beforeId, desde, alcance) {
      if (desde && !inicio(contactId, desde)) return [];
      if (alcance && !iniciadoScope(contactId, alcance)) return [];
      return all
        .filter(m => visible(m, desde))
        .filter((m) => m.contactId === contactId && (!beforeId || m.id < beforeId) && visibleScope(m, alcance))
        .filter((m) => !(m.payload && 'eliminadoAqui' in m.payload))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
        .slice(-limit);
    },
    async syncMessages(contactId, afterId, knownIds, limit, alcance) {
      const conocidos = new Set(knownIds.slice(0, 300));
      if (!iniciadoScope(contactId, alcance)) return [];
      return all.filter(m => m.contactId === contactId && (BigInt(m.id) > BigInt(afterId) || conocidos.has(String(m.id))) && visibleScope(m, alcance) && !(m.payload && 'eliminadoAqui' in m.payload))
        .sort((a,b) => a.id-b.id).slice(0,limit);
    },

    // --- citar, reaccionar, destacar, buscar ---

    async reaccionar(wamid, quien, emoji, at) {
      const fila = all.find((m) => m.wamid === wamid);
      if (!fila) return false;
      const reacciones = { ...((fila.payload?.reacciones as Record<string, unknown>) ?? {}) };
      if (emoji.trim()) reacciones[quien] = { emoji: emoji.trim(), at: at.toISOString() };
      else delete reacciones[quien];
      fila.payload = { ...(fila.payload ?? {}), reacciones };
      return true;
    },

    async porId(contactId, id) {
      return all.find((m) => m.contactId === contactId && m.id === id) ?? null;
    },

    async porIds(contactId, ids) {
      return all
        .filter((m) => m.contactId === contactId && ids.includes(m.id))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
    },

    async destacar(contactId, ids, destacado, at) {
      let n = 0;
      for (const m of all) {
        if (m.contactId !== contactId || !ids.includes(m.id)) continue;
        const payload = { ...(m.payload ?? {}) } as Record<string, unknown>;
        if (destacado) payload.destacado = at.toISOString();
        else delete payload.destacado;
        m.payload = payload;
        n++;
      }
      return n;
    },

    async ocultar(contactId, ids, at) {
      let n = 0;
      for (const m of all) {
        if (m.contactId !== contactId || !ids.includes(m.id)) continue;
        m.payload = { ...(m.payload ?? {}), eliminadoAqui: at.toISOString() };
        n++;
      }
      return n;
    },

    async editarCuerpo(contactId, id, texto, at) {
      const fila = all.find((m) => m.contactId === contactId && m.id === id);
      if (!fila) return false;
      fila.body = texto;
      fila.payload = { ...(fila.payload ?? {}), editadoAt: at.toISOString() };
      return true;
    },

    async buscar(query) {
      const q = query.q.trim().toLowerCase();
      if (!q) return [];
      return all
        .filter((m) => m.contactId === query.contactId && (m.body ?? '').toLowerCase().includes(q))
        .filter(m => visible(m, query.desde) && (!query.desde || Boolean(inicio(m.contactId, query.desde))))
        .filter((m) => !(m.payload && 'eliminadoAqui' in m.payload))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
        .slice(-query.limit);
    },

    async destacados(query) {
      const porId = new Map(contacts().map((c) => [c.id, c]));
      return all
        .filter((m) => m.payload && 'destacado' in m.payload && !('eliminadoAqui' in m.payload))
        .filter(m => visible(m, query.desde) && (!query.desde || Boolean(inicio(m.contactId, query.desde))))
        .filter((m) => !query.contactId || m.contactId === query.contactId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
        .slice(0, query.limit)
        .map((m) => ({ ...m, phone: porId.get(m.contactId)?.phone ?? '', name: porId.get(m.contactId)?.name ?? null }));
    },

    async markRead(contactId, at) {
      const contact = contacts().find((c) => c.id === contactId);
      if (contact) contact.chatReadAt = at;
    },

    async unreadTotal(desde, alcance) {
      let total = 0;
      for (const c of contacts()) {
        if (alcance && !iniciadoScope(c.id, alcance)) continue;
        if (!alcance && desde && !inicio(c.id, desde)) continue;
        const readAt = c.chatReadAt ?? null;
        total += all.filter(
          (m) =>
            m.contactId === c.id &&
            visible(m, desde) && visibleScope(m, alcance) &&
            m.direction === 'in' &&
            (!readAt || m.createdAt.getTime() > readAt.getTime()),
        ).length;
      }
      return total;
    },

    async masAntiguo(contactId) {
      return (
        all
          .filter((m) => m.contactId === contactId && m.wamid && !m.wamid.startsWith('local:') && !m.wamid.startsWith('web:'))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)[0] ?? null
      );
    },

    async pageForArchive(contactId, afterId, limit) {
      return all
        .filter((m) => m.contactId === contactId && m.id > afterId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
    },

    async deleteByContact(contactId, upToId) {
      let borrados = 0;
      for (let i = all.length - 1; i >= 0; i--) {
        const m = all[i]!;
        if (m.contactId === contactId && m.id <= upToId) {
          all.splice(i, 1);
          borrados++;
        }
      }
      return borrados;
    },

    async summaryByContact(contactId) {
      const mine = all.filter((m) => m.contactId === contactId).sort((a, b) => a.id - b.id);
      const fechas = mine.map((m) => m.createdAt.getTime());
      return {
        count: mine.length,
        firstAt: fechas.length ? new Date(Math.min(...fechas)) : null,
        lastAt: fechas.length ? new Date(Math.max(...fechas)) : null,
        lastId: mine.at(-1)?.id ?? 0,
      };
    },

    async staleContacts(before, limit) {
      const ultimo = new Map<string, Date>();
      for (const m of all) {
        const previo = ultimo.get(m.contactId);
        if (!previo || m.createdAt > previo) ultimo.set(m.contactId, m.createdAt);
      }
      return [...ultimo.entries()]
        .filter(([, at]) => at < before)
        .sort((a, b) => a[1].getTime() - b[1].getTime())
        .slice(0, limit)
        .map(([contactId, lastAt]) => ({ contactId, lastAt }));
    },
  };

  return repo;
}
