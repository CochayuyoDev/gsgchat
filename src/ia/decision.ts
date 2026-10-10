/**
 * Por qué respondió (o se calló) el bot en cada turno.
 *
 * Cada turno de un cliente de GSG deja UNA decisión: cuántos mensajes juntó
 * la ráfaga, qué intención se leyó, qué dato útil traía, cómo se decidió
 * (reglas o IA) y qué salió (una plantilla, o silencio). Así, si una regla se
 * equivoca, se ve en el chat por qué y se corrige sin volver a escribirle al
 * cliente.
 *
 *   turno de 3 mensajes; intención: confirmar entrega; dato detectado: sí;
 *   respuesta: plantilla de confirmación
 */

/** La lista cerrada de lo que el bot atiende con GSG, más lo que calla. */
export type IntencionGsg =
  | 'enviar_ubicacion'
  | 'corregir_ubicacion'
  | 'confirmar_entrega'
  | 'por_que'
  | 'pedir_persona'
  | 'estado_pedido'
  | 'direccion_escrita'
  | 'no_soy_yo'
  | 'acuse'
  | 'ajena'
  | 'sin_texto'
  /** Con el asistente de la tienda («Todo el sistema»): una consulta del negocio o un pedido. */
  | 'consulta'
  | 'pedido_tienda';

export const NOMBRE_INTENCION: Record<IntencionGsg, string> = {
  enviar_ubicacion: 'enviar ubicación',
  corregir_ubicacion: 'corregir ubicación',
  confirmar_entrega: 'confirmar entrega',
  por_que: 'por qué se pide la ubicación',
  pedir_persona: 'hablar con una persona',
  estado_pedido: 'estado u hora del pedido',
  direccion_escrita: 'dirección escrita',
  no_soy_yo: 'no es la persona del pedido',
  acuse: 'acuse (ok, gracias)',
  ajena: 'fuera del servicio',
  sin_texto: 'sticker, reacción o archivo sin texto',
  consulta: 'consulta del negocio',
  pedido_tienda: 'pedido en el chat',
};

export type ComoSeDecidio = 'reglas' | 'ia' | 'boton' | 'contexto';

export interface DecisionBot {
  id?: number;
  contactId: string;
  phone: string;
  /** Mensajes del cliente que juntó la ráfaga (1 si llegó solo). */
  mensajes: number;
  intencion: IntencionGsg;
  /** El dato útil que se leyó: «sí», «no», «pin», «Av. Brasil 1234»… null si nada. */
  dato: string | null;
  /** Lo que salió: «plantilla de confirmación», «silencio», «derivado a una persona»… */
  respuesta: string;
  como: ComoSeDecidio;
  /** Lo que el bot esperaba antes del turno: «ubicación», «sí o no», «¿es ahí?», «nada». */
  esperaba: string | null;
  detalle: string | null;
  createdAt?: Date;
}

export type NuevaDecision = Omit<DecisionBot, 'id' | 'createdAt'>;

/** La línea que se lee en el chat y en la bitácora. */
export function resumenDecision(d: Pick<DecisionBot, 'mensajes' | 'intencion' | 'dato' | 'respuesta' | 'como'>): string {
  const partes = [
    `turno de ${d.mensajes} ${d.mensajes === 1 ? 'mensaje' : 'mensajes'}`,
    `intención: ${NOMBRE_INTENCION[d.intencion] ?? d.intencion}`,
    `dato detectado: ${d.dato?.trim() ? d.dato.trim().slice(0, 80) : 'ninguno'}`,
    `respuesta: ${d.respuesta}`,
    `decidido por: ${d.como === 'ia' ? 'IA' : d.como === 'boton' ? 'botón' : d.como === 'contexto' ? 'contexto' : 'reglas'}`,
  ];
  return partes.join('; ');
}
