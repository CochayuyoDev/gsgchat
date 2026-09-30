/**
 * Doble en memoria de `repos.leads`.
 *
 * La ficha de preventa se toca en casi todos los caminos de la conversacion,
 * asi que sin esto no se puede probar ni un turno sin montar Postgres.
 */

import type { Lead, LeadConContacto, LeadPatch, LeadsRepo } from '../src/db/leads.js';

let siguienteId = 1;

export function nuevaFicha(contactId: string, overrides: Partial<Lead> = {}): Lead {
  const ahora = new Date();
  return {
    id: siguienteId++,
    contactId,
    nombre: null,
    origen: null,
    recojoDireccion: null,
    recojoDistrito: null,
    recojoReferencia: null,
    recojoLat: null,
    recojoLng: null,
    entregaDireccion: null,
    entregaDistrito: null,
    entregaReferencia: null,
    entregaLat: null,
    entregaLng: null,
    servicio: null,
    contenido: null,
    pesoKg: null,
    fragil: false,
    cuando: null,
    documentoTipo: null,
    documentoNumero: null,
    razonSocial: null,
    estado: 'nuevo',
    notas: null,
    ultimasOpciones: null,
    ultimoProducto: null,
    preguntaPendiente: null,
    intentosFallidos: 0,
    crmId: null,
    enviadoAt: null,
    ultimoError: null,
    createdAt: ahora,
    updatedAt: ahora,
    ...overrides,
  };
}

export interface FakeLeadsRepo extends LeadsRepo {
  _fichas: Map<string, Lead>;
}

export function createFakeLeads(
  telefonoDe: (contactId: string) => { phone: string; name: string | null } | undefined = () =>
    undefined,
): FakeLeadsRepo {
  const fichas = new Map<string, Lead>();

  const repo: FakeLeadsRepo = {
    _fichas: fichas,

    async ensure(contactId, nombre) {
      const existente = fichas.get(contactId);
      if (existente) {
        if (!existente.nombre && nombre) existente.nombre = nombre;
        return existente;
      }
      const ficha = nuevaFicha(contactId, { nombre: nombre ?? null });
      fichas.set(contactId, ficha);
      return ficha;
    },

    async get(contactId) {
      return fichas.get(contactId) ?? null;
    },

    async update(contactId, patch: LeadPatch) {
      const ficha = await repo.ensure(contactId);
      Object.assign(ficha, patch, { updatedAt: new Date() });
      return ficha;
    },

    async list(query) {
      const todas = [...fichas.values()]
        .filter((f) => !query.estado || f.estado === query.estado)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      return todas.slice(query.offset, query.offset + query.limit).map((f): LeadConContacto => {
        const contacto = telefonoDe(f.contactId);
        return { ...f, phone: contacto?.phone ?? '', contactName: contacto?.name ?? null };
      });
    },

    async marcarEnviada(contactId, crmId) {
      const ficha = await repo.ensure(contactId);
      Object.assign(ficha, {
        estado: 'enviado',
        crmId,
        enviadoAt: new Date(),
        ultimoError: null,
        updatedAt: new Date(),
      });
    },

    async marcarError(contactId, error) {
      const ficha = await repo.ensure(contactId);
      Object.assign(ficha, { ultimoError: error.slice(0, 500), updatedAt: new Date() });
    },

    async contarPorEstado() {
      const cuenta: Record<string, number> = {};
      for (const ficha of fichas.values()) {
        cuenta[ficha.estado] = (cuenta[ficha.estado] ?? 0) + 1;
      }
      return cuenta;
    },
  };

  return repo;
}
