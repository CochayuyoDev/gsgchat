/** Doble en memoria del indice de respaldos de conversacion. */

import { lunesRecientes, type ArchiveQuery, type ArchivesRepo, type ChatArchive, type NewChatArchive } from '../src/db/archives.js';

let seq = 1;

export interface FakeArchives extends ArchivesRepo {
  _all: Array<ChatArchive & { textoBusqueda: string | null }>;
}

/** El lunes (en Lima) de la semana de una fecha, como lo escribe la base. */
function lunesDe(d: Date): string {
  const local = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  const dia = (local.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dia)).toISOString().slice(0, 10);
}

export function createFakeArchives(): FakeArchives {
  const all: Array<ChatArchive & { textoBusqueda: string | null }> = [];

  const cumple = (a: ChatArchive & { textoBusqueda: string | null }, query: Omit<ArchiveQuery, 'limit' | 'offset'>): boolean => {
    if (query.papelera ? !a.deletedAt : Boolean(a.deletedAt)) return false;
    if (query.contactId && a.contactId !== query.contactId) return false;
    const q = query.q?.trim().toLowerCase();
    if (q && !(a.phone.includes(q) || (a.name ?? '').toLowerCase().includes(q))) return false;
    const t = query.texto?.trim().toLowerCase();
    if (t && !((a.textoBusqueda ?? '').toLowerCase().includes(t) || (a.resumen ?? '').toLowerCase().includes(t) || (a.notas ?? '').toLowerCase().includes(t))) return false;
    if (query.etiqueta && !a.etiquetas.includes(query.etiqueta.trim())) return false;
    if (query.pedido && a.pedido !== query.pedido.trim()) return false;
    if (query.reason && a.reason !== query.reason) return false;
    if (query.desde && a.createdAt < query.desde) return false;
    if (query.hasta && a.createdAt >= query.hasta) return false;
    return true;
  };
  const orden = (a: ChatArchive, b: ChatArchive) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id;

  return {
    _all: all,

    async add(archive: NewChatArchive) {
      const { textoBusqueda, pedido, cerradoPor, adjuntos, primeraRespuestaSeg, origen, ...resto } = archive;
      const row = {
        ...resto,
        id: seq++,
        createdAt: new Date(),
        resumen: null,
        etiquetas: [],
        pedido: pedido ?? null,
        notas: null,
        cerradoPor: cerradoPor ?? null,
        deletedAt: null,
        adjuntos: (adjuntos ?? []).map((x) => ({ ...x })),
        primeraRespuestaSeg: primeraRespuestaSeg ?? null,
        origen: origen ?? null,
        textoBusqueda: textoBusqueda ?? null,
      };
      all.push(row);
      return { ...row };
    },

    async get(id) {
      return all.find((a) => a.id === id) ?? null;
    },

    async list(query) {
      return all.filter((a) => cumple(a, query)).sort(orden).slice(query.offset, query.offset + query.limit);
    },

    async count(query) {
      return all.filter((a) => cumple(a, query)).length;
    },

    async byContact(contactId) {
      return all.filter((a) => a.contactId === contactId && !a.deletedAt).sort(orden);
    },

    async update(id, patch) {
      const a = all.find((x) => x.id === id);
      if (!a) return null;
      if (patch.resumen !== undefined) a.resumen = patch.resumen;
      if (patch.etiquetas !== undefined) a.etiquetas = [...patch.etiquetas];
      if (patch.pedido !== undefined) a.pedido = patch.pedido;
      if (patch.notas !== undefined) a.notas = patch.notas;
      if (patch.deletedAt !== undefined) a.deletedAt = patch.deletedAt;
      if (patch.adjuntos !== undefined) a.adjuntos = patch.adjuntos.map((x) => ({ ...x }));
      return { ...a };
    },

    async ponerResumenSiFalta(id, resumen, etiquetas) {
      const a = all.find((x) => x.id === id);
      if (!a) return null;
      if (a.resumen === null) {
        a.resumen = resumen;
        a.etiquetas = [...etiquetas];
      }
      return { ...a };
    },

    async remove(id) {
      const i = all.findIndex((a) => a.id === id);
      if (i >= 0) all.splice(i, 1);
    },

    async papeleraVencida(dias, limite) {
      const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
      return all.filter((a) => a.deletedAt && a.deletedAt.getTime() < corte).slice(0, limite);
    },

    async sinResumen(limite) {
      return all.filter((a) => !a.deletedAt && a.resumen === null && a.messageCount > 0).sort(orden).slice(0, limite);
    },

    async stats() {
      const vivos = all.filter((a) => !a.deletedAt);
      const porMotivo: Record<string, number> = {};
      const porEtiqueta: Record<string, number> = {};
      const porSemanaMapa = new Map<string, number>();
      for (const a of vivos) {
        porMotivo[a.reason] = (porMotivo[a.reason] ?? 0) + 1;
        for (const e of a.etiquetas) porEtiqueta[e] = (porEtiqueta[e] ?? 0) + 1;
        const l = lunesDe(a.createdAt);
        porSemanaMapa.set(l, (porSemanaMapa.get(l) ?? 0) + 1);
      }
      const conTiempo = vivos.filter((a) => a.primeraRespuestaSeg !== null);
      return {
        total: vivos.length,
        bytes: vivos.reduce((suma, a) => suma + a.bytes, 0),
        messages: vivos.reduce((suma, a) => suma + a.messageCount, 0),
        enPapelera: all.length - vivos.length,
        porMotivo,
        porEtiqueta,
        porSemana: lunesRecientes(8).map((semana) => ({ semana, n: porSemanaMapa.get(semana) ?? 0 })),
        primeraRespuestaMedioSeg: conTiempo.length ? Math.round(conTiempo.reduce((s, a) => s + (a.primeraRespuestaSeg ?? 0), 0) / conTiempo.length) : null,
        pctReclamo: vivos.length ? Math.round((vivos.filter((a) => a.etiquetas.includes('reclamo')).length * 100) / vivos.length) : 0,
        conAdjuntos: vivos.filter((a) => a.adjuntos.length > 0).length,
      };
    },
  };
}
