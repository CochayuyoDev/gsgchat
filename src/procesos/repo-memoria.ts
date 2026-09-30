/**
 * Los procesos en memoria: lo mismo que repo.ts, sin base de datos. Lo usan
 * la demo (scripts/demo.ts) y las pruebas. Se comporta igual que el SQL en
 * lo que importa: el orden, los filtros y quien esta «viva».
 */

import { ESTADOS_VIVOS, type Corrida, type PersonaProceso, type Proceso } from './modelo.js';
import type { EventoPersona, ProcesosRepo } from './repo.js';

const copia = <T>(v: T): T => structuredClone(v);

export function crearProcesosEnMemoria(): ProcesosRepo & { _personas: PersonaProceso[] } {
  const procesos: Proceso[] = [];
  const corridas: Corrida[] = [];
  const personas: PersonaProceso[] = [];
  const eventos: EventoPersona[] = [];
  let seq = 1;
  // Dos cambios en el mismo milisegundo tienen que quedar ordenados igual.
  let ultimoReloj = 0;
  const ahora = () => {
    const t = Math.max(Date.now(), ultimoReloj + 1);
    ultimoReloj = t;
    return new Date(t);
  };

  const vivaCorrida = (id: number) => corridas.find((c) => c.id === id);
  const vivoProceso = (id: number) => procesos.find((p) => p.id === id);

  return {
    _personas: personas,

    async crearProceso(p) {
      const t = ahora();
      const nuevo: Proceso = { id: seq++, nombre: p.nombre, plantilla: p.plantilla ?? null, descripcion: p.descripcion ?? '', pasos: copia(p.pasos), ritmo: copia(p.ritmo), cierre: copia(p.cierre), estado: p.estado ?? 'activo', createdAt: t, updatedAt: t };
      procesos.push(nuevo);
      return copia(nuevo);
    },
    async actualizarProceso(id, patch) {
      const p = vivoProceso(id);
      if (!p) return null;
      Object.assign(p, copia(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))), { updatedAt: ahora() });
      return copia(p);
    },
    async proceso(id) {
      const p = vivoProceso(id);
      return p ? copia(p) : null;
    },
    async procesos() {
      return copia([...procesos].sort((a, b) => Number(a.estado === 'archivado') - Number(b.estado === 'archivado') || a.id - b.id));
    },
    async borrarProceso(id) {
      const i = procesos.findIndex((p) => p.id === id);
      if (i < 0) return false;
      procesos.splice(i, 1);
      for (let j = corridas.length - 1; j >= 0; j--) if (corridas[j]!.procesoId === id) corridas.splice(j, 1);
      for (let j = personas.length - 1; j >= 0; j--) if (personas[j]!.procesoId === id) personas.splice(j, 1);
      return true;
    },

    async crearCorrida(c) {
      const t = ahora();
      const nueva: Corrida = { id: seq++, procesoId: c.procesoId, nombre: c.nombre, estado: 'activa', origen: c.origen, createdAt: t, updatedAt: t };
      corridas.push(nueva);
      return copia(nueva);
    },
    async corrida(id) {
      const c = vivaCorrida(id);
      return c ? copia(c) : null;
    },
    async corridas(filtro = {}) {
      return copia(corridas.filter((c) => filtro.procesoId === undefined || c.procesoId === filtro.procesoId).sort((a, b) => b.id - a.id).slice(0, filtro.limit ?? 50));
    },
    async actualizarCorrida(id, patch) {
      const c = vivaCorrida(id);
      if (!c) return null;
      if (patch.estado !== undefined) c.estado = patch.estado;
      if (patch.nombre !== undefined) c.nombre = patch.nombre;
      c.updatedAt = ahora();
      return copia(c);
    },

    async agregarPersonas(corridaId, procesoId, nuevas) {
      const creadas: PersonaProceso[] = [];
      for (const n of nuevas) {
        const t = ahora();
        const estado = n.estado ?? 'pendiente';
        const p: PersonaProceso = {
          id: seq++,
          corridaId,
          procesoId,
          phone: n.phone,
          telefonoCrudo: n.telefonoCrudo,
          nombre: n.nombre,
          datos: copia(n.datos ?? {}),
          estado,
          paso: 0,
          intentos: 0,
          fallos: 0,
          sub: null,
          // Sin hora: al motor le toca en su proxima pasada (null = ya).
          proximoAt: null,
          ultimoEnvioAt: null,
          respuestas: {},
          ultimo: null,
          motivo: n.motivo ?? null,
          pausada: false,
          createdAt: t,
          updatedAt: t,
          terminadaAt: null,
        };
        personas.push(p);
        creadas.push(copia(p));
      }
      return creadas;
    },
    async persona(id) {
      const p = personas.find((x) => x.id === id);
      return p ? copia(p) : null;
    },
    async personas(f) {
      return copia(
        personas
          .filter((p) => (f.corridaId === undefined || p.corridaId === f.corridaId) && (f.procesoId === undefined || p.procesoId === f.procesoId) && (!f.phone || p.phone === f.phone) && (!f.estados?.length || f.estados.includes(p.estado)) && (!f.conRespuestas || Object.keys(p.respuestas).length > 0))
          .sort((a, b) => b.id - a.id)
          .slice(0, f.limit ?? 2000),
      );
    },
    async actualizarPersona(id, patch) {
      const p = personas.find((x) => x.id === id);
      if (!p) return null;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (p as unknown as Record<string, unknown>)[k] = copia(v);
      p.updatedAt = ahora();
      return copia(p);
    },
    async vivaPorTelefono(phone) {
      const candidatas = personas.filter((p) => p.phone === phone && (p.estado === 'esperando' || p.estado === 'programada') && vivaCorrida(p.corridaId)?.estado !== 'terminada');
      candidatas.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id);
      return candidatas[0] ? copia(candidatas[0]) : null;
    },
    async ultimaPorTelefono(phone) {
      const candidatas = personas.filter((p) => p.phone === phone).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id);
      return candidatas[0] ? copia(candidatas[0]) : null;
    },
    async tocaEnviar(momento, limit) {
      return copia(
        personas
          .filter((p) => ESTADOS_VIVOS.includes(p.estado) && !p.pausada && p.phone && vivaCorrida(p.corridaId)?.estado === 'activa' && vivoProceso(p.procesoId)?.estado === 'activo' && (!p.proximoAt || p.proximoAt.getTime() <= momento.getTime()))
          .sort((a, b) => (a.proximoAt?.getTime() ?? 0) - (b.proximoAt?.getTime() ?? 0) || a.id - b.id)
          .slice(0, limit),
      );
    },
    async cifras(f = {}) {
      const salida: Record<string, number> = {};
      for (const p of personas) {
        if (f.corridaId !== undefined && p.corridaId !== f.corridaId) continue;
        if (f.procesoId !== undefined && p.procesoId !== f.procesoId) continue;
        salida[p.estado] = (salida[p.estado] ?? 0) + 1;
      }
      return salida;
    },
    async registrarEvento(personaId, tipo, detalle) {
      eventos.push({ id: seq++, personaId, tipo, detalle: detalle ?? null, en: ahora() });
    },
    async eventos(personaId, limit = 100) {
      return copia(eventos.filter((e) => e.personaId === personaId).sort((a, b) => b.id - a.id).slice(0, limit));
    },
  };
}
