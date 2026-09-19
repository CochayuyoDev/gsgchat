/** Doble en memoria de las lecciones del asistente y sus examenes. */

import type { Contact } from '../src/db/repos.js';
import type { Message } from '../src/db/messages.js';
import type { CasoExamen, EntrenamientoRepo, Examen, FiltroLecciones, Leccion } from '../src/entrenamiento/repo.js';

export interface FakeEntrenamiento extends EntrenamientoRepo {
  _lecciones: Leccion[];
  _examenes: Examen[];
  _casos: CasoExamen[];
}

let seq = 1;

export function createFakeEntrenamiento(contactos: () => Contact[], mensajes: () => Message[]): FakeEntrenamiento {
  const lecciones: Leccion[] = [];
  const examenes: Examen[] = [];
  const casos: CasoExamen[] = [];
  const copia = (l: Leccion): Leccion => ({ ...l });

  const cumple = (l: Leccion, f: FiltroLecciones): boolean => {
    if (f.estado && l.estado !== f.estado) return false;
    if (f.tipo && l.tipo !== f.tipo) return false;
    if (f.tema && (l.tema ?? '').toLowerCase() !== f.tema.toLowerCase()) return false;
    if (f.origen && l.origen !== f.origen) return false;
    if (f.origenDetalle && l.origenDetalle !== f.origenDetalle) return false;
    if (f.examenOk !== undefined && l.examenOk !== f.examenOk) return false;
    if (f.ids?.length && !f.ids.includes(l.id)) return false;
    if (f.q?.trim()) {
      const q = f.q.trim().toLowerCase();
      if (!`${l.pregunta ?? ''} ${l.respuesta} ${l.tema ?? ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  };

  const repo: FakeEntrenamiento = {
    _lecciones: lecciones,
    _examenes: examenes,
    _casos: casos,

    async crear(input) {
      const r = await repo.crearVarias([input]);
      if (r.nuevas) return { leccion: copia(lecciones.find((l) => l.id === r.ids[0])!), nueva: true };
      return { leccion: copia(lecciones.find((l) => l.huella === input.huella)!), nueva: false };
    },

    async crearVarias(inputs) {
      const ids: number[] = [];
      let nuevas = 0;
      for (const i of inputs) {
        if (lecciones.some((l) => l.huella === i.huella)) continue;
        const ahora = new Date();
        const l: Leccion = {
          id: seq++,
          tipo: i.tipo,
          pregunta: i.pregunta ?? null,
          respuesta: i.respuesta,
          mala: i.mala ?? null,
          tema: i.tema ?? null,
          origen: i.origen,
          origenDetalle: i.origenDetalle ?? null,
          estado: i.estado ?? 'activa',
          huella: i.huella,
          usos: 0,
          ultimoUsoAt: null,
          examenOk: null,
          examenAt: null,
          examenNota: null,
          nota: i.nota ?? null,
          creadoPor: i.creadoPor ?? null,
          createdAt: ahora,
          updatedAt: ahora,
        };
        lecciones.push(l);
        ids.push(l.id);
        nuevas++;
      }
      return { nuevas, repetidas: inputs.length - nuevas, ids };
    },

    async porId(id) {
      const l = lecciones.find((x) => x.id === id);
      return l ? copia(l) : null;
    },

    async porHuella(huella) {
      const l = lecciones.find((x) => x.huella === huella);
      return l ? copia(l) : null;
    },

    async actualizar(id, patch) {
      const l = lecciones.find((x) => x.id === id);
      if (!l) return null;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (l as unknown as Record<string, unknown>)[k] = v;
      l.updatedAt = new Date();
      return copia(l);
    },

    async borrar(id) {
      const i = lecciones.findIndex((x) => x.id === id);
      if (i < 0) return false;
      lecciones.splice(i, 1);
      return true;
    },

    async listar(filtro, pagina) {
      const todas = lecciones.filter((l) => cumple(l, filtro)).sort((a, b) => b.id - a.id);
      return { items: todas.slice(pagina.offset, pagina.offset + pagina.limite).map(copia), total: todas.length };
    },

    async activas() {
      return lecciones.filter((l) => l.estado === 'activa').sort((a, b) => a.id - b.id).map(copia);
    },

    async cambiarEstadoEnMasa(filtro, estado) {
      let n = 0;
      for (const l of lecciones) {
        if (!cumple(l, filtro)) continue;
        l.estado = estado;
        n++;
      }
      return n;
    },

    async borrarEnMasa(filtro) {
      const antes = lecciones.length;
      for (let i = lecciones.length - 1; i >= 0; i--) if (cumple(lecciones[i]!, filtro)) lecciones.splice(i, 1);
      return antes - lecciones.length;
    },

    async cifras() {
      const c = { total: 0, porEstado: { activa: 0, pendiente: 0, descartada: 0 }, porTipo: { ejemplo: 0, dato: 0, regla: 0 }, porOrigen: {} as Record<string, number>, fallanExamen: 0, pasanExamen: 0, sinExaminar: 0 };
      for (const l of lecciones) {
        c.total++;
        c.porEstado[l.estado]++;
        if (l.estado !== 'activa') continue;
        c.porTipo[l.tipo]++;
        c.porOrigen[l.origen] = (c.porOrigen[l.origen] ?? 0) + 1;
        if (l.examenOk === true) c.pasanExamen++;
        else if (l.examenOk === false) c.fallanExamen++;
        else c.sinExaminar++;
      }
      return c;
    },

    async temas() {
      const m = new Map<string, number>();
      for (const l of lecciones) if (l.tema && l.estado !== 'descartada') m.set(l.tema, (m.get(l.tema) ?? 0) + 1);
      return [...m.entries()].map(([tema, total]) => ({ tema, total })).sort((a, b) => b.total - a.total || a.tema.localeCompare(b.tema));
    },

    async anotarUsos(ids, at) {
      for (const l of lecciones) {
        if (!ids.includes(l.id)) continue;
        l.usos++;
        l.ultimoUsoAt = at;
      }
    },

    async idsPara(filtro, limite, _alAzar) {
      return lecciones
        .filter((l) => cumple(l, filtro))
        .sort((a, b) => a.id - b.id)
        .slice(0, limite)
        .map((l) => l.id);
    },

    async contactosConTexto(desde) {
      const salida: Array<{ contactId: string; phone: string; nombre: string | null; mensajes: number }> = [];
      for (const c of contactos()) {
        if (c.tipo === 'grupo') continue;
        const n = mensajes().filter((m) => m.contactId === c.id && m.kind === 'text' && (!desde || m.createdAt >= desde)).length;
        if (n >= 2) salida.push({ contactId: c.id, phone: c.phone, nombre: c.name, mensajes: n });
      }
      return salida;
    },

    async mensajesDeTexto(contactId, desde) {
      return mensajes()
        .filter((m) => m.contactId === contactId && m.kind === 'text' && (!desde || m.createdAt >= desde))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
        .map((m) => ({ direction: m.direction, body: m.body, kind: m.kind, createdAt: m.createdAt, origen: (m.payload?.origen as string | undefined) ?? null }));
    },

    async crearExamen(input) {
      const e: Examen = { id: seq++, nombre: input.nombre, total: input.total, aprobados: 0, fallados: 0, errores: 0, estado: 'corriendo', detalle: input.detalle ?? null, creadoPor: input.creadoPor, empezadoAt: new Date(), terminadoAt: null };
      examenes.push(e);
      return { ...e };
    },

    async anotarCaso(c) {
      casos.push({ ...c, id: seq++, createdAt: new Date() });
    },

    async cerrarExamen(id, estado, cifras, detalle) {
      const e = examenes.find((x) => x.id === id);
      if (!e) return null;
      Object.assign(e, cifras, { estado, terminadoAt: new Date(), detalle: detalle ?? e.detalle });
      return { ...e };
    },

    async examenes(limite) {
      return [...examenes].sort((a, b) => b.id - a.id).slice(0, limite).map((e) => ({ ...e }));
    },

    async examen(id) {
      const e = examenes.find((x) => x.id === id);
      return e ? { ...e } : null;
    },

    async casosDeExamen(id, soloFallos, limite) {
      return casos
        .filter((c) => c.examenId === id && (!soloFallos || !c.ok))
        .sort((a, b) => Number(a.ok) - Number(b.ok) || a.id - b.id)
        .slice(0, limite)
        .map((c) => ({ ...c }));
    },
  };
  return repo;
}
