import { diaEnZona } from './ubicacion-unica.js';
import { setTimeout as esperar } from 'node:timers/promises';
import type { Contact, Repos } from '../db/repos.js';
import type { Sender, SendJob, SendOutcome } from '../outbound/sender.js';

export interface ConfirmacionUbicacion {
  enviada: boolean;
  repetida: boolean;
  nota: string;
  salida: SendOutcome | null;
}

/** «Enviado» significa que el proveedor aceptó un envío real, no que lo entregó. */
export async function enviarConfirmacionUbicacion(deps: { repos: Repos; sender: Sender; contact: Contact; job: SendJob; ahora?: Date; timezone?: string }): Promise<ConfirmacionUbicacion> {
  const { contact, repos, sender } = deps;
  const texto = deps.job.text ?? deps.job.interactive?.body ?? '';
  if (!texto.trim()) return { enviada: false, repetida: false, nota: 'UBI REGISTRADA no enviada: texto vacío', salida: null };
  if (String(contact.iaCerradaMotivo ?? '').startsWith('no soy yo')) return { enviada: false, repetida: false, nota: 'UBI REGISTRADA no enviada: número derivado a una persona', salida: null };
  const ahora = deps.ahora ?? new Date();
  const previos = await repos.messages.listMessages(contact.id, 100);
  const yaEnviada = previos.some((m) => m.direction === 'out' && m.body === texto && m.wamid &&
    !['failed', 'blocked_by_gate'].includes(m.status ?? '') &&
    (m.payload as { confirmacionUbicacion?: boolean } | null)?.confirmacionUbicacion === true &&
    diaEnZona(m.createdAt, deps.timezone ?? 'America/Lima') === diaEnZona(ahora, deps.timezone ?? 'America/Lima'));
  if (yaEnviada) return { enviada: false, repetida: true, nota: 'UBI REGISTRADA ya enviada anteriormente; no se repite', salida: null };
  if (String(contact.iaCerradaMotivo ?? '').startsWith('ubicación registrada')) {
    // Reparar un cierre antiguo que no tiene una confirmación real en el historial.
    await repos.contacts.cerrarIA(contact.id, false, ahora);
    contact.iaCerradaAt = null;
    contact.iaCerradaMotivo = null;
  }
  const job: SendJob = { ...deps.job, category: 'UTILITY', confirmacionUbicacion: true, cierreTrasGracias: true,
    limitesContacto: { separacionMs: 0, maxPorDia: Number.MAX_SAFE_INTEGER } };
  let salida: SendOutcome;
  try {
    salida = await sender.send(job);
    // Un rechazo temporal explícito admite UN reintento; un envío incierto no.
    if (!salida.ok && !salida.blocked && salida.retryable && !salida.incierto) {
      await esperar(1000);
      salida = await sender.send(job);
    }
  } catch (error) {
    return { enviada: false, repetida: false, nota: `UBI REGISTRADA: envío sin confirmar (${String(error).slice(0, 200)})`, salida: null };
  }
  const enviada = salida.ok && salida.deliveryId >= 0 && Boolean(salida.wamid) && !/^(silencio:|regla-gsg:)/.test(salida.wamid);
  const nota = enviada ? 'UBI REGISTRADA enviada: aceptada por WhatsApp'
    : salida.ok ? 'UBI REGISTRADA no enviada: omitida por una regla del chat'
    : salida.blocked ? `UBI REGISTRADA no enviada: ${salida.code} (${salida.reason})`
    : salida.incierto ? `UBI REGISTRADA: envío sin confirmar (${salida.error})`
    : `UBI REGISTRADA no enviada: ${salida.error}`;
  return { enviada, repetida: false, nota: nota.slice(0, 500), salida };
}
