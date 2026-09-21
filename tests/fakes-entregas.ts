/** Doble en memoria de las entregas del dia y los motorizados. */

import {
  ESTADOS_ENTREGA_VIVOS,
  type Entrega,
  type EntregasRepo,
  type EventoEntrega,
  type Motorizado,
} from '../src/entregas/repo.js';

export interface FakeEntregas extends EntregasRepo {
  _entregas: Entrega[];
  _motorizados: Motorizado[];
  _eventos: EventoEntrega[];
}

let seqE = 1;
let seqM = 1;
let seqEv = 1;

export function createFakeEntregas(): FakeEntregas {
  const entregas: Entrega[] = [];
  const motorizados: Motorizado[] = [];
  const eventos: EventoEntrega[] = [];
  const copiaE = (e: Entrega): Entrega => ({ ...e, motorizadosDescartados: [...e.motorizadosDescartados] });
  const copiaM = (m: Motorizado): Motorizado => ({ ...m });

  const repo: FakeEntregas = {
    _entregas: entregas,
    _motorizados: motorizados,
    _eventos: eventos,

    async crearMotorizado(input) {
      const existente = motorizados.find((m) => m.phone === input.phone);
      if (existente) return { motorizado: copiaM(existente), nuevo: false };
      const ahora = new Date();
      const m: Motorizado = { id: seqM++, phone: input.phone, nombre: input.nombre, placa: input.placa ?? null, zona: input.zona ?? null, estado: input.estado ?? 'activo', entregasHoy: 0, entregasHoyDia: null, ultimoEncargoAt: null, ultimaLat: null, ultimaLng: null, ultimaPosicionAt: null, createdAt: ahora, updatedAt: ahora };
      motorizados.push(m);
      return { motorizado: copiaM(m), nuevo: true };
    },
    async motorizado(id) {
      const m = motorizados.find((x) => x.id === id);
      return m ? copiaM(m) : null;
    },
    async motorizadoPorTelefono(phone) {
      const m = motorizados.find((x) => x.phone === phone);
      return m ? copiaM(m) : null;
    },
    async listarMotorizados() {
      const peso = (m: Motorizado) => (m.estado === 'baja' ? 2 : m.estado === 'descanso' ? 1 : 0);
      return [...motorizados].sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre) || a.id - b.id).map(copiaM);
    },
    async actualizarMotorizado(id, patch) {
      const m = motorizados.find((x) => x.id === id);
      if (!m) return null;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (m as unknown as Record<string, unknown>)[k] = v;
      m.updatedAt = new Date();
      return copiaM(m);
    },
    async quitarMotorizado(id) {
      const i = motorizados.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const [m] = motorizados.splice(i, 1);
      for (const e of entregas) if (e.motorizadoId === id) e.motorizadoId = null;
      return copiaM(m!);
    },

    async crearEntrega(input) {
      const existente = entregas.find((e) => e.dia === input.dia && e.referencia === input.referencia);
      if (existente) return { entrega: copiaE(existente), nueva: false };
      const ahora = new Date();
      const e: Entrega = {
        id: seqE++,
        dia: input.dia,
        referencia: input.referencia,
        externoId: input.externoId ?? null,
        phone: input.phone,
        nombre: input.nombre ?? null,
        direccion: input.direccion ?? null,
        distrito: input.distrito ?? null,
        notas: input.notas ?? null,
        ubicacionEstado: input.ubicacionEstado,
        loteId: null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        mapsUrl: null,
        ubicacionFuente: null,
        ubicacionAt: null,
        confirmacionEstado: input.confirmacionEstado,
        confirmacionIntentos: 0,
        confirmacionPedidaAt: null,
        confirmacionProximoAt: null,
        confirmacionAt: null,
        confirmacionRespuesta: null,
        confirmacionComo: null,
        motorizadoId: null,
        motorizadoEstado: 'sin_asignar',
        motorizadoIntentos: 0,
        motorizadoEnviadoAt: null,
        motorizadoProximoAt: null,
        motorizadoRespuesta: null,
        motorizadoRespondioAt: null,
        minutosMotorizado: null,
        minutosAviso: null,
        llegaAproxAt: null,
        avisoEnviadoAt: null,
        motorizadosDescartados: [],
        entregadaAt: null,
        entregadaComo: null,
        entregadaRespuesta: null,
        cerradaPorDia: false,
        prioridad: input.prioridad ?? 'normal',
        visitas: 0,
        segundaVisita: false,
        segundaVisitaPedidaAt: null,
        segundaVisitaVenceAt: null,
        cercaAvisadoAt: null,
        estado: input.estado,
        incidencia: null,
        incidenciaDetalle: null,
        requiereHumano: false,
        terminadaGsgAt: null,
        createdAt: ahora,
        updatedAt: ahora,
      };
      entregas.push(e);
      return { entrega: copiaE(e), nueva: true };
    },
    async entrega(id) {
      const e = entregas.find((x) => x.id === id);
      return e ? copiaE(e) : null;
    },
    async porDiaYReferencia(dia, referencia) {
      const e = entregas.find((x) => x.dia === dia && x.referencia === referencia);
      return e ? copiaE(e) : null;
    },
    async vivaPorTelefono(phone) {
      const vivas = entregas.filter((x) => x.phone === phone && ESTADOS_ENTREGA_VIVOS.includes(x.estado)).sort((a, b) => b.dia.localeCompare(a.dia) || b.id - a.id);
      return vivas[0] ? copiaE(vivas[0]) : null;
    },
    async listar(filtro) {
      let lista = filtro.dia ? entregas.filter((e) => e.dia === filtro.dia) : entregas.filter((e) => ESTADOS_ENTREGA_VIVOS.includes(e.estado));
      if (filtro.estado) lista = lista.filter((e) => e.estado === filtro.estado);
      if (filtro.estados?.length) lista = lista.filter((e) => filtro.estados!.includes(e.estado));
      if (filtro.q?.trim()) {
        const q = filtro.q.trim().toLowerCase();
        lista = lista.filter((e) => (e.nombre ?? '').toLowerCase().includes(q) || e.phone.includes(q) || e.referencia.toLowerCase().includes(q));
      }
      return lista.sort((a, b) => a.id - b.id).slice(0, filtro.limit ?? 500).map(copiaE);
    },
    async actualizar(id, patch) {
      const e = entregas.find((x) => x.id === id);
      if (!e) return null;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (e as unknown as Record<string, unknown>)[k] = k === 'motorizadosDescartados' ? [...(v as number[])] : v;
      e.updatedAt = new Date();
      return copiaE(e);
    },
    async quitar(id) {
      const i = entregas.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const [e] = entregas.splice(i, 1);
      return copiaE(e!);
    },
    async cifras(dia) {
      const cifras: Record<string, number> = {};
      for (const e of entregas) if (e.dia === dia) cifras[e.estado] = (cifras[e.estado] ?? 0) + 1;
      return cifras;
    },
    async tocaPedirConfirmacion(ahora, limite) {
      return entregas
        .filter((e) => (e.estado === 'pendiente' || e.estado === 'esperando_confirmacion') && (e.confirmacionEstado === 'pendiente' || e.confirmacionEstado === 'pedida') && e.ubicacionEstado !== 'pendiente' && (!e.confirmacionProximoAt || e.confirmacionProximoAt.getTime() <= ahora.getTime()))
        .sort((a, b) => (a.confirmacionProximoAt ?? a.createdAt).getTime() - (b.confirmacionProximoAt ?? b.createdAt).getTime() || a.id - b.id)
        .slice(0, limite)
        .map(copiaE);
    },
    async tocaMotorizado(ahora, limite) {
      return entregas
        .filter((e) => e.estado === 'lista' || (e.estado === 'esperando_motorizado' && (e.motorizadoEstado === 'enviado' || (e.motorizadoEstado === 'respondio' && !e.avisoEnviadoAt)) && e.motorizadoProximoAt !== null && e.motorizadoProximoAt.getTime() <= ahora.getTime()))
        .sort((a, b) => Number(b.prioridad === 'urgente') - Number(a.prioridad === 'urgente') || (a.motorizadoProximoAt ?? a.updatedAt).getTime() - (b.motorizadoProximoAt ?? b.updatedAt).getTime() || a.id - b.id)
        .slice(0, limite)
        .map(copiaE);
    },
    async enManosDeMotorizado(motorizadoId) {
      return entregas
        .filter((e) => e.motorizadoId === motorizadoId && e.estado === 'esperando_motorizado' && e.motorizadoEstado === 'enviado')
        .sort((a, b) => (b.motorizadoEnviadoAt?.getTime() ?? 0) - (a.motorizadoEnviadoAt?.getTime() ?? 0) || b.id - a.id)
        .map(copiaE);
    },
    async avisadasDeMotorizado(motorizadoId) {
      return entregas
        .filter((e) => e.motorizadoId === motorizadoId && e.estado === 'avisada')
        .sort((a, b) => (b.avisoEnviadoAt?.getTime() ?? 0) - (a.avisoEnviadoAt?.getTime() ?? 0) || b.id - a.id)
        .map(copiaE);
    },
    async vivasDeMotorizado(motorizadoId) {
      return entregas
        .filter((e) => e.motorizadoId === motorizadoId && (e.estado === 'esperando_motorizado' || e.estado === 'avisada'))
        .sort((a, b) => Number(b.prioridad === 'urgente') - Number(a.prioridad === 'urgente') || (a.motorizadoEnviadoAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.motorizadoEnviadoAt?.getTime() ?? Number.MAX_SAFE_INTEGER) || a.id - b.id)
        .map(copiaE);
    },
    async vivasDeDiasAnteriores(diaHoy, limite) {
      return entregas
        .filter((e) => e.dia < diaHoy && ESTADOS_ENTREGA_VIVOS.includes(e.estado))
        .sort((a, b) => a.dia.localeCompare(b.dia) || a.id - b.id)
        .slice(0, limite)
        .map(copiaE);
    },
    async registrarEvento(entregaId, tipo, detalle, payload, at) {
      eventos.push({ id: seqEv++, entregaId, tipo, detalle: detalle ?? null, payload: payload ?? null, createdAt: at ?? new Date() });
    },
    async eventos(entregaId, limite = 100) {
      return eventos.filter((ev) => ev.entregaId === entregaId).slice(0, limite).map((ev) => ({ ...ev }));
    },
    async eventosRecientes(limite) {
      return [...eventos]
        .reverse()
        .slice(0, limite)
        .map((ev) => {
          const e = entregas.find((x) => x.id === ev.entregaId);
          return { ...ev, referencia: e?.referencia ?? '', phone: e?.phone ?? '', nombre: e?.nombre ?? null };
        });
    },
  };
  return repo;
}
