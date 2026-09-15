/**
 * Doble en memoria del modulo de rutas.
 *
 * El motor y la lectura de respuestas se prueban contra esto; el SQL de
 * verdad tiene sus propias pruebas sobre PGlite en `rutas.test.ts`.
 */

import type { AjustesRutas } from '../src/rutas/ajustes.js';
import type {
  ConsultaSolicitudes,
  EstadoLote,
  EstadoReporte,
  EventoSolicitud,
  Lote,
  LoteConCifras,
  NuevaSolicitud,
  Reporte,
  RutasRepo,
  Solicitud,
  SolicitudPatch,
  TipoEvento,
  TipoReporte,
} from '../src/db/rutas.js';

let seqLote = 1;
let seqSolicitud = 1;
let seqEvento = 1;
let seqReporte = 1;

export interface FakeRutas extends RutasRepo {
  _lotes: Lote[];
  _solicitudes: Solicitud[];
  _eventos: EventoSolicitud[];
  _reportes: Reporte[];
}

const VIVOS = ['pendiente', 'enviado', 'respondio'];

export function createFakeRutas(): FakeRutas {
  const lotes: Lote[] = [];
  const solicitudes: Solicitud[] = [];
  const eventos: EventoSolicitud[] = [];
  const reportes: Reporte[] = [];

  const filtrar = (query: Omit<ConsultaSolicitudes, 'limit' | 'offset'>): Solicitud[] => {
    const q = query.q?.trim().toLowerCase();
    return solicitudes.filter((s) => {
      if (query.loteId && s.loteId !== query.loteId) return false;
      if (query.estado && s.estado !== query.estado) return false;
      if (query.estados?.length && !query.estados.includes(s.estado)) return false;
      if (query.incidencia && s.incidencia !== query.incidencia) return false;
      if (query.incidencias?.length && !query.incidencias.includes(s.incidencia as never)) return false;
      if (query.requiereHumano !== undefined && s.requiereHumano !== query.requiereHumano) return false;
      if (q) {
        const heno = [s.telefonoCrudo, s.phone, s.nombre, s.referencia].join(' ').toLowerCase();
        if (!heno.includes(q)) return false;
      }
      return true;
    });
  };

  // Ajustes en memoria: lo guardado por encima de lo que se pase por defecto.
  let ajustesGuardados: Record<string, unknown> = {};
  const fusionar = (base: AjustesRutas, g: Record<string, unknown>): AjustesRutas => ({
    ...base,
    ...(g as Partial<AjustesRutas>),
    plantillas: { ...base.plantillas, ...((g.plantillas as AjustesRutas['plantillas'] | undefined) ?? {}) },
    textos: { ...base.textos, ...((g.textos as AjustesRutas['textos'] | undefined) ?? {}) },
  });

  const repo: FakeRutas = {
    _lotes: lotes,
    _solicitudes: solicitudes,
    _eventos: eventos,
    _reportes: reportes,
    ajustes: {
      async get(porDefecto) {
        return fusionar(porDefecto, ajustesGuardados);
      },
      async set(patch, porDefecto) {
        const nuevo = fusionar(fusionar(porDefecto, ajustesGuardados), patch as Record<string, unknown>);
        ajustesGuardados = nuevo as unknown as Record<string, unknown>;
        return nuevo;
      },
      async reset() {
        ajustesGuardados = {};
      },
    },

    async crearLote(datos) {
      const ahora = new Date();
      const lote: Lote = {
        id: `lote-${seqLote++}`,
        nombre: datos.nombre,
        origen: datos.origen ?? 'csv',
        estado: 'preparado',
        notas: datos.notas ?? null,
        externoId: datos.externoId ?? null,
        createdAt: ahora,
        updatedAt: ahora,
      };
      lotes.push(lote);
      return lote;
    },

    async lote(id) {
      return lotes.find((l) => l.id === id) ?? null;
    },

    async listarLotes(limit, offset) {
      return lotes
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(offset, offset + limit)
        .map((l): LoteConCifras => {
          const suyas = solicitudes.filter((s) => s.loteId === l.id);
          const cifras: Record<string, number> = {};
          for (const s of suyas) cifras[s.estado] = (cifras[s.estado] ?? 0) + 1;
          return { ...l, total: suyas.length, cifras };
        });
    },

    async cambiarEstadoLote(id, estado: EstadoLote) {
      const lote = lotes.find((l) => l.id === id);
      if (!lote) return null;
      lote.estado = estado;
      lote.updatedAt = new Date();
      return lote;
    },

    async borrarLote(id) {
      const i = lotes.findIndex((l) => l.id === id);
      if (i >= 0) lotes.splice(i, 1);
      // Como el SQL (on delete cascade): se van sus solicitudes, sus eventos
      // y lo que tuviera en la cola hacia GSG.
      const suyas = new Set(solicitudes.filter((s) => s.loteId === id).map((s) => s.id));
      for (let j = solicitudes.length - 1; j >= 0; j--) {
        if (solicitudes[j]!.loteId === id) solicitudes.splice(j, 1);
      }
      for (let j = eventos.length - 1; j >= 0; j--) {
        if (suyas.has(eventos[j]!.solicitudId)) eventos.splice(j, 1);
      }
      for (let j = reportes.length - 1; j >= 0; j--) {
        if (reportes[j]!.loteId === id) reportes.splice(j, 1);
      }
    },

    async lotesActivos() {
      return lotes.filter((l) => l.estado === 'enviando');
    },

    async agregarSolicitudes(loteId, filas: NuevaSolicitud[]) {
      const creadas: Solicitud[] = [];
      for (const fila of filas) {
        const ahora = new Date();
        const solicitud: Solicitud = {
          id: seqSolicitud++,
          loteId,
          contactId: null,
          telefonoCrudo: fila.telefonoCrudo,
          phone: fila.phone ?? null,
          nombre: fila.nombre ?? null,
          referencia: fila.referencia ?? null,
          direccion: fila.direccion ?? null,
          distrito: fila.distrito ?? null,
          notas: fila.notas ?? null,
          estado: fila.estado ?? 'pendiente',
          intentos: 0,
          ultimoEnvioAt: null,
          proximoIntentoAt: fila.proximoIntentoAt ?? null,
          primeraRespuestaAt: null,
          resueltoAt: null,
          lat: null,
          lng: null,
          precisionM: null,
          ubicacionFuente: null,
          mapsUrl: null,
          incidencia: fila.incidencia ?? null,
          incidenciaDetalle: fila.incidenciaDetalle ?? null,
          requiereHumano: fila.requiereHumano ?? false,
          asignadoA: null,
          createdAt: ahora,
          updatedAt: ahora,
        };
        solicitudes.push(solicitud);
        creadas.push(solicitud);
      }
      return creadas;
    },

    async solicitud(id) {
      return solicitudes.find((s) => s.id === id) ?? null;
    },

    async listarSolicitudes(query) {
      return filtrar(query)
        .slice()
        .sort((a, b) => Number(b.requiereHumano) - Number(a.requiereHumano) || a.id - b.id)
        .slice(query.offset, query.offset + query.limit);
    },

    async contarSolicitudes(query) {
      return filtrar(query).length;
    },

    async actualizarSolicitud(id, patch: SolicitudPatch) {
      const solicitud = solicitudes.find((s) => s.id === id);
      if (!solicitud) throw new Error(`no existe la solicitud ${id}`);
      Object.assign(solicitud, patch, { updatedAt: new Date() });
      return { ...solicitud };
    },

    async cifrasPorEstado(loteId) {
      const cifras: Record<string, number> = {};
      for (const s of solicitudes) {
        if (loteId && s.loteId !== loteId) continue;
        cifras[s.estado] = (cifras[s.estado] ?? 0) + 1;
      }
      return cifras;
    },

    async cifrasPorIncidencia(loteId) {
      const cifras: Record<string, number> = {};
      for (const s of solicitudes) {
        if (loteId && s.loteId !== loteId) continue;
        if (!s.incidencia) continue;
        cifras[s.incidencia] = (cifras[s.incidencia] ?? 0) + 1;
      }
      return cifras;
    },

    async tocaIntentar(ahora, limite) {
      const activos = new Set(lotes.filter((l) => l.estado === 'enviando').map((l) => l.id));
      return solicitudes
        .filter(
          (s) =>
            activos.has(s.loteId) &&
            VIVOS.includes(s.estado) &&
            s.phone &&
            (!s.proximoIntentoAt || s.proximoIntentoAt.getTime() <= ahora.getTime()),
        )
        .sort(
          (a, b) =>
            (a.proximoIntentoAt ?? a.createdAt).getTime() -
              (b.proximoIntentoAt ?? b.createdAt).getTime() || a.id - b.id,
        )
        .slice(0, limite)
        .map((s) => ({ ...s }));
    },

    async abiertaPorContacto(contactId) {
      const abiertos = [...VIVOS, 'supervision', 'derivado'];
      return (
        solicitudes
          .slice()
          .reverse()
          .find((s) => s.contactId === contactId && abiertos.includes(s.estado)) ?? null
      );
    },

    async abiertaPorTelefono(phone, excluirLoteId) {
      const abiertos = [...VIVOS, 'supervision', 'derivado'];
      return (
        solicitudes
          .slice()
          .reverse()
          .find((s) => s.phone === phone && abiertos.includes(s.estado) && (!excluirLoteId || s.loteId !== excluirLoteId)) ?? null
      );
    },

    async resueltaRecientePorTelefono(phone) {
      const enMarcha = new Set(lotes.filter((l) => l.estado !== 'terminado').map((l) => l.id));
      return (
        solicitudes
          .slice()
          .reverse()
          .find((s) => s.phone === phone && s.estado === 'resuelto' && enMarcha.has(s.loteId)) ?? null
      );
    },

    async telefonosDelLote(loteId) {
      return solicitudes.filter((s) => s.loteId === loteId).map((s) => s.phone ?? s.telefonoCrudo);
    },

    async registrarEvento(
      solicitudId: number,
      tipo: TipoEvento,
      detalle?: string | null,
      payload?: Record<string, unknown> | null,
    ) {
      eventos.push({
        id: seqEvento++,
        solicitudId,
        tipo,
        detalle: detalle ?? null,
        payload: payload ?? null,
        createdAt: new Date(),
      });
    },

    async eventos(solicitudId, limite = 200) {
      return eventos.filter((e) => e.solicitudId === solicitudId).slice(0, limite);
    },

    async encolarReporte(reporte: {
      solicitudId?: number | null;
      loteId?: string | null;
      tipo: TipoReporte;
      payload: Record<string, unknown>;
    }) {
      const fila: Reporte = {
        id: seqReporte++,
        solicitudId: reporte.solicitudId ?? null,
        loteId: reporte.loteId ?? null,
        tipo: reporte.tipo,
        payload: reporte.payload,
        estado: 'pendiente',
        intentos: 0,
        ultimoError: null,
        externoId: null,
        enviadoAt: null,
        createdAt: new Date(),
      };
      reportes.push(fila);
      return fila;
    },

    async reportesPendientes(limite) {
      return reportes.filter((r) => r.estado === 'pendiente').slice(0, limite);
    },

    async marcarReporte(id, estado: EstadoReporte, extra) {
      const reporte = reportes.find((r) => r.id === id);
      if (!reporte) return;
      reporte.estado = estado;
      reporte.intentos++;
      if (extra?.externoId) reporte.externoId = extra.externoId;
      reporte.ultimoError = extra?.error ?? null;
      if (estado === 'enviado') reporte.enviadoAt = new Date();
    },

    async cifrasReportes() {
      const cifras: Record<EstadoReporte, number> = { pendiente: 0, enviado: 0, fallido: 0 };
      for (const r of reportes) cifras[r.estado]++;
      return cifras;
    },
  };

  return repo;
}
