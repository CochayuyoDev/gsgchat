/**
 * Que pasa cuando un cliente pide la baja o que borren sus datos.
 *
 * Regla del dueño (09/11): el sistema NO lo da de baja ni borra nada solo.
 *   1. Lo apunta (solicitudes_privacidad) con lo que escribio.
 *   2. Para el bot en ese chat: nada automatico le vuelve a escribir.
 *   3. Su pedido de hoy y su solicitud de ubicacion quedan «para una persona»
 *      con su estado propio («Pidió la baja» / «Pidió borrar sus datos»).
 *   4. Le contesta UNA vez que se recibio y que lo ve una persona.
 *   5. Sale el aviso en la campana y en Chats; una persona lo atiende desde la
 *      web: dar de baja, eliminar los datos o descartarlo.
 */

import type { Contact, Repos } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import { NOMBRE_PRIVACIDAD, RESPUESTA_PRIVACIDAD } from './detectar.js';
import type { ComoSeReconocio, TipoPrivacidad } from './repo.js';

/** El codigo de incidencia de cada caso (Pedidos GSG, Hoy y el reporte a GSG). */
export const INCIDENCIA_PRIVACIDAD: Record<TipoPrivacidad, 'pide_baja' | 'pide_borrar_datos'> = {
  baja: 'pide_baja',
  borrar_datos: 'pide_borrar_datos',
};

export interface DepsPrivacidad {
  repos: Pick<Repos, 'contacts' | 'rutas' | 'privacidad'>;
  sender: Pick<Sender, 'send'>;
  entregas?: {
    pasarAPersona(phone: string, codigo: string, detalle: string): Promise<number>;
    anotarAgente(phone: string, detalle: string): Promise<void>;
  };
  ahora?: () => Date;
  log?: (mensaje: string, datos?: unknown) => void;
}

export async function atenderPedidoDePrivacidad(
  deps: DepsPrivacidad,
  contact: Pick<Contact, 'id' | 'phone'>,
  texto: string,
  deteccion: { tipo: TipoPrivacidad; como: ComoSeReconocio },
): Promise<{ registrada: boolean; nueva: boolean }> {
  const { repos } = deps;
  if (!repos.privacidad) return { registrada: false, nueva: false };
  const ahora = deps.ahora?.() ?? new Date();
  const { nueva } = await repos.privacidad.registrar({ phone: contact.phone, contactId: contact.id, tipo: deteccion.tipo, texto: texto.slice(0, 500) || null, como: deteccion.como });
  const nombre = NOMBRE_PRIVACIDAD[deteccion.tipo];
  const codigo = INCIDENCIA_PRIVACIDAD[deteccion.tipo];
  const detalle = `${nombre} (${deteccion.como === 'ia' ? 'lo reconoció la IA' : 'lo reconocieron las reglas'}): «${texto.slice(0, 200)}». Lo atiende una persona desde Chats.`;

  // Nada automatico le vuelve a escribir mientras una persona no lo atienda.
  await repos.contacts.pausarBot(contact.id, true, ahora).catch(() => undefined);

  const abierta = (await repos.rutas.abiertaPorContacto(contact.id).catch(() => null)) ?? (await repos.rutas.abiertaPorTelefono(contact.phone).catch(() => null));
  if (abierta) {
    await repos.rutas
      .actualizarSolicitud(abierta.id, {
        ...(abierta.primeraRespuestaAt ? {} : { primeraRespuestaAt: ahora }),
        estado: abierta.estado === 'pendiente' ? 'pendiente' : 'supervision',
        requiereHumano: true,
        proximoIntentoAt: null,
        incidencia: codigo,
        incidenciaDetalle: detalle.slice(0, 300),
      })
      .catch(() => undefined);
    await repos.rutas.registrarEvento(abierta.id, 'respuesta', `${detalle} No se le insiste más.`).catch(() => undefined);
  }
  await deps.entregas?.pasarAPersona(contact.phone, codigo, detalle).catch(() => 0);
  await deps.entregas?.anotarAgente(contact.phone, `${detalle} El bot se paró en su chat.`).catch(() => undefined);

  // Una sola vez: si ya lo habia pedido y sigue pendiente, no se le repite.
  if (nueva) {
    await deps.sender
      // traspasaPausa: el bot se acaba de callar en su chat, pero esto es la respuesta a lo que él pidió.
      .send({ phone: contact.phone, kind: 'freeform', category: 'UTILITY', origen: 'ia', textoFijo: true, traspasaPausa: true, text: RESPUESTA_PRIVACIDAD[deteccion.tipo] })
      .catch((error) => deps.log?.('no se pudo contestar el pedido de privacidad', { detalle: error instanceof Error ? error.message : String(error) }));
  }
  deps.log?.(`${nombre}: apuntado y pasado a una persona`, { phone: contact.phone, como: deteccion.como, nueva });
  return { registrada: true, nueva };
}
