/** Doble en memoria del indice de respaldos de conversacion. */

import type { ArchivesRepo, ChatArchive, NewChatArchive } from '../src/db/archives.js';

let seq = 1;

export interface FakeArchives extends ArchivesRepo {
  _all: ChatArchive[];
}

export function createFakeArchives(): FakeArchives {
  const all: ChatArchive[] = [];

  return {
    _all: all,

    async add(archive: NewChatArchive) {
      const row: ChatArchive = { ...archive, id: seq++, createdAt: new Date() };
      all.push(row);
      return row;
    },

    async get(id) {
      return all.find((a) => a.id === id) ?? null;
    },

    async list(query) {
      const q = query.q?.trim().toLowerCase();
      return all
        .filter((a) => !query.contactId || a.contactId === query.contactId)
        .filter((a) => !q || a.phone.includes(q) || (a.name ?? '').toLowerCase().includes(q))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
        .slice(query.offset, query.offset + query.limit);
    },

    async byContact(contactId) {
      return all
        .filter((a) => a.contactId === contactId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
    },

    async remove(id) {
      const i = all.findIndex((a) => a.id === id);
      if (i >= 0) all.splice(i, 1);
    },

    async stats() {
      return {
        total: all.length,
        bytes: all.reduce((suma, a) => suma + a.bytes, 0),
        messages: all.reduce((suma, a) => suma + a.messageCount, 0),
      };
    },
  };
}
