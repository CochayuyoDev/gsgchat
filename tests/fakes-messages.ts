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

  const repo: FakeMessages = {
    _all: all,

    async add(message: NewMessage) {
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
      };
      all.push(row);
      return row.id;
    },

    async setStatusByWamid(wamid, status) {
      const row = all.find((m) => m.wamid === wamid);
      if (row) row.status = status;
    },

    async listConversations(query) {
      const q = query.q?.trim().toLowerCase();
      const now = Date.now();
      const lastId = new Map<string, number>();
      for (const m of all) lastId.set(m.contactId, Math.max(lastId.get(m.contactId) ?? 0, m.id));
      const rows = contacts()
        .filter((c) => !q || c.phone.includes(q) || (c.name ?? '').toLowerCase().includes(q))
        .map((c) => {
          const mine = all
            .filter((m) => m.contactId === c.id)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
          const last = mine.at(-1);
          const readAt = c.chatReadAt ?? null;
          return {
            contactId: c.id,
            phone: c.phone,
            name: c.name,
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
          } satisfies Conversation;
        })
        .sort((a, b) => {
          const ta = (a.lastMessage?.createdAt ?? a.lastInboundAt)?.getTime() ?? 0;
          const tb = (b.lastMessage?.createdAt ?? b.lastInboundAt)?.getTime() ?? 0;
          // Mismo desempate que el SQL: la hora de WhatsApp viene en segundos.
          return tb - ta || (lastId.get(b.contactId) ?? 0) - (lastId.get(a.contactId) ?? 0);
        });
      return rows.slice(query.offset, query.offset + query.limit);
    },

    async listMessages(contactId, limit, beforeId) {
      return all
        .filter((m) => m.contactId === contactId && (!beforeId || m.id < beforeId))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
        .slice(-limit);
    },

    async markRead(contactId, at) {
      const contact = contacts().find((c) => c.id === contactId);
      if (contact) contact.chatReadAt = at;
    },

    async unreadTotal() {
      let total = 0;
      for (const c of contacts()) {
        const readAt = c.chatReadAt ?? null;
        total += all.filter(
          (m) =>
            m.contactId === c.id &&
            m.direction === 'in' &&
            (!readAt || m.createdAt.getTime() > readAt.getTime()),
        ).length;
      }
      return total;
    },
  };

  return repo;
}
