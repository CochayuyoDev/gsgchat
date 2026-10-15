import { createHash } from 'node:crypto';
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
  const vivas = await repos.entregas.vivasPorTelefono(contact.phone).catch(() => []);
  const referencias = [...new Set(vivas.map((e) => e.datosEnvio?.tracking?.trim() || e.referencia || String(e.id)))].sort();
  // Un pedido nuevo del mismo número obtiene una clave diferente. Si no hay
  // pedido vinculado, se acota al ciclo diario del chat, nunca al cuerpo.
  const referenciaOperativa = referencias.length ? referencias.join(',').slice(0, 500) : 'sin-referencia-operativa';
  const alcanceCoordenadas = deps.job.confirmationScope?.trim().slice(0, 100) || 'ubicacion-sin-cambio';
  const dia = diaEnZona(ahora, deps.timezone ?? 'America/Lima');
  const actionKey = createHash('sha256').update(`confirmacion-ubicacion|${contact.id}|${dia}|${referenciaOperativa}|${alcanceCoordenadas}`).digest('hex');
  const reservado = await repos.messages.reservarAccionWhatsapp({
    key: actionKey,
    tipo: 'confirmacion_ubicacion',
    referencia: `${contact.id}|${dia}|${referenciaOperativa}|${alcanceCoordenadas}`,
    ahora,
    expira: new Date(ahora.getTime() + 7 * 24 * 60 * 60_000),
  });
  if (!reservado) return { enviada: false, repetida: true, nota: 'UBI REGISTRADA ya procesada para este pedido; no se repite', salida: null };
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
    await repos.messages.finalizarAccionWhatsapp(actionKey, 'incierto').catch(() => undefined);
    return { enviada: false, repetida: false, nota: `UBI REGISTRADA: envío sin confirmar (${String(error).slice(0, 200)})`, salida: null };
  }
  const enviada = salida.ok && salida.deliveryId >= 0 && Boolean(salida.wamid) && !/^(silencio:|regla-gsg:)/.test(salida.wamid);
  const estadoControl = enviada ? 'aceptado' : !salida.ok && !salida.blocked && salida.incierto ? 'incierto' : salida.ok ? 'incierto' : 'fallido';
  await repos.messages.finalizarAccionWhatsapp(actionKey, estadoControl, enviada && salida.ok ? salida.wamid : null);
  const nota = enviada ? 'UBI REGISTRADA enviada: aceptada por WhatsApp'
    : salida.ok ? 'UBI REGISTRADA no enviada: omitida por una regla del chat'
    : salida.blocked ? `UBI REGISTRADA no enviada: ${salida.code} (${salida.reason})`
    : salida.incierto ? `UBI REGISTRADA: envío sin confirmar (${salida.error})`
    : `UBI REGISTRADA no enviada: ${salida.error}`;
  return { enviada, repetida: false, nota: nota.slice(0, 500), salida };
}
