/**
 * «Números del día»: la lista de GSG vista número por número, con en qué
 * punto va cada uno y acciones sobre varios a la vez.
 *
 *  GET  /admin/entregas/numeros   los números de hoy con su etapa y las cifras de cada filtro
 *  POST /admin/entregas/masa      { accion, ids } una accion sobre varios; contesta en palabras
 *
 * La etapa NO es una marca que alguien pone: sale del estado de la entrega
 * (ubicacion, confirmacion, estado) y de la solicitud del reparto que le pide
 * el pin, y cambia sola con cada mensaje que llega. Lo unico manual es la
 * marca «ya contactado» y la pausa de los mensajes (migracion 038).
 *
 * Las acciones son las de una sola entrega (servicio.ts) repetidas en bucle:
 * nada se manda desde aqui. Pedir la ubicacion o la confirmacion pone al
 * numero primero en la cola de su motor, que la manda por el sender de
 * siempre (ritmo, horario, salud del numero y modo prueba).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { grupoDe, type FilaEntrega, type MotivoNumero, type ResultadoNumero, type ServicioEntregas } from './servicio.js';

export type EtapaNumero = 'por_confirmar_envio' | 'falta_pedir' | 'falta_ubicacion' | 'falta_confirmar' | 'contactados' | 'necesita' | 'cancelada';

export const ETAPAS: Array<{ id: EtapaNumero; etiqueta: string }> = [
  { id: 'por_confirmar_envio', etiqueta: 'Por confirmar el envío' },
  { id: 'falta_pedir', etiqueta: 'Falta pedir ubicación' },
  { id: 'falta_ubicacion', etiqueta: 'Falta su ubicación' },
  { id: 'falta_confirmar', etiqueta: 'Falta confirmar' },
  { id: 'contactados', etiqueta: 'Ya contactados' },
  { id: 'necesita', etiqueta: 'Necesitan a alguien' },
  { id: 'cancelada', etiqueta: 'Cancelados' },
];

/** Si ya se le escribio para pedirle la ubicacion (el reparto o la propuesta de la direccion de la ultima vez). */
function yaSeLePidioUbicacion(f: FilaEntrega): boolean {
  if (f.ubicacionPropuestaAt) return true;
  const s = f.solicitud;
  if (!s) return false;
  return s.intentos > 0 || s.estado === 'enviado' || s.estado === 'respondio';
}

/**
 * En que punto va un numero. El orden importa:
 *  1. cancelado (por el cliente, por GSG o a mano): solo sale en «Todos»;
 *  1b. llegó de GSG y espera que una persona confirme su envío → «Por confirmar el envío»;
 *  2. necesita a alguien: la entrega esta apartada (incidencia) o el reparto
 *     la dejo para una persona. Una segunda visita esperando la respuesta
 *     del cliente NO: ese cliente ya esta contactado;
 *  3. marcado a mano como contactado;
 *  4. sin ubicacion: ¿ya se le pidio? → «Falta su ubicación»; si no → «Falta pedir ubicación»;
 *  5. con ubicacion y la confirmacion pendiente o pedida → «Falta confirmar»;
 *  6. lo demas (confirmado, con motorizado, avisado, entregado) → «Ya contactados».
 */
export function etapaDe(f: FilaEntrega): EtapaNumero {
  if (f.estado === 'cancelada') return 'cancelada';
  if (f.envioRetenidoAt && f.estado !== 'terminada' && f.estado !== 'entregada') return 'por_confirmar_envio';
  const esperandoSegundaVisita = f.estado === 'incidencia' && Boolean(f.segundaVisitaPedidaAt) && !f.requiereHumano;
  if (!esperandoSegundaVisita && (f.estado === 'incidencia' || f.requiereHumano)) return 'necesita';
  if (f.ubicacionEstado === 'pendiente' && f.solicitud && ['supervision', 'derivado', 'incidencia', 'cancelado'].includes(f.solicitud.estado)) return 'necesita';
  if (f.contactadoAt) return 'contactados';
  if (esperandoSegundaVisita) return 'contactados';
  if (f.ubicacionEstado === 'pendiente') return yaSeLePidioUbicacion(f) ? 'falta_ubicacion' : 'falta_pedir';
  if (f.confirmacionEstado === 'pendiente' || f.confirmacionEstado === 'pedida') return 'falta_confirmar';
  return 'contactados';
}

const plural = (n: number, una: string, varias: string): string => `${n} ${n === 1 ? una : varias}`;

/** En qué punto va, en una línea corta (lo largo ya lo dice `situacion`). */
export function puntoDe(f: FilaEntrega, etapa: EtapaNumero, maxConfirmacion: number): string {
  switch (etapa) {
    case 'por_confirmar_envio':
      return grupoDe(f) === 'confirmar'
        ? 'Por confirmar el envío: todavía no se le escribe. Al confirmar se le pregunta SÍ o NO (GSG ya tiene su dirección).'
        : 'Por confirmar el envío: todavía no se le escribe. Al confirmar se le pide la ubicación.';
    case 'falta_pedir':
      if (f.ubicacionPropuestaLat != null) return 'Todavía no se le escribió: se le va a proponer la dirección de la última vez.';
      return 'Todavía no se le escribió: se le pide la ubicación en cuanto le toque.';
    case 'falta_ubicacion':
      if (f.ubicacionPropuestaAt) return 'Se le propuso la dirección de la última vez; falta que diga si es la misma o mande su pin.';
      if (f.solicitud?.estado === 'respondio') return 'Contestó, pero todavía no manda su ubicación.';
      return `Se le pidió la ubicación (${plural(Math.max(1, f.solicitud?.intentos ?? 1), 'mensaje', 'mensajes')}); todavía no la manda.`;
    case 'falta_confirmar':
      if (grupoDe(f) === 'confirmar') {
        if (f.confirmacionEstado === 'pedida') return `GSG ya tiene su dirección. Se le preguntó SÍ o NO (${f.confirmacionIntentos} de ${maxConfirmacion}); falta su respuesta.`;
        return 'GSG ya tiene su dirección: se le pregunta SÍ o NO en cuanto le toque.';
      }
      if (f.confirmacionEstado === 'pedida') return `UBI REGISTRADA. Se le pidió confirmar (${f.confirmacionIntentos} de ${maxConfirmacion}); falta su SÍ.`;
      return 'UBI REGISTRADA; falta pedirle que confirme.';
    default:
      return f.situacion;
  }
}

export interface FilaNumero {
  id: number;
  referencia: string;
  nombre: string | null;
  telefono: string;
  direccion: string | null;
  distrito: string | null;
  etapa: EtapaNumero;
  /** Qué se le manda: pedirle la ubicación, o solo preguntarle SÍ/NO (GSG ya tiene su dirección). */
  grupo: 'ubicacion' | 'confirmar';
  /** Espera que una persona confirme su envío. */
  porConfirmar: boolean;
  punto: string;
  urgente: boolean;
  pausado: boolean;
  contactadoAt: Date | null;
  contactadoPor: string | null;
  mismoCliente: string[];
  mapa: string | null;
  /** Las coordenadas del pin, para enseñarlas junto al enlace del mapa. */
  lat: number | null;
  lng: number | null;
  /** Quién lo lleva, si ya tiene motorizado. */
  motorizado: string | null;
  /** El cliente ya mandó su ubicación: en pantalla sale como «UBI REGISTRADA». */
  ubiRegistrada: boolean;
}

export function filaNumero(f: FilaEntrega, maxConfirmacion: number): FilaNumero {
  const etapa = etapaDe(f);
  return {
    id: f.id,
    referencia: f.referencia,
    nombre: f.nombre,
    telefono: f.phone,
    direccion: f.direccion,
    distrito: f.distrito,
    etapa,
    grupo: grupoDe(f),
    porConfirmar: etapa === 'por_confirmar_envio',
    punto: puntoDe(f, etapa, maxConfirmacion),
    urgente: f.prioridad === 'urgente',
    pausado: Boolean(f.mensajesPausadosAt),
    contactadoAt: f.contactadoAt ?? null,
    contactadoPor: f.contactadoPor ?? null,
    mismoCliente: f.mismoCliente,
    mapa: f.lat != null && f.lng != null ? `https://maps.google.com/?q=${f.lat.toFixed(6)},${f.lng.toFixed(6)}` : null,
    lat: f.lat ?? null,
    lng: f.lng ?? null,
    motorizado: f.motorizado?.nombre ?? null,
    // Solo si la mandó el cliente: a los de «falta confirmar» GSG ya les tenía la dirección.
    ubiRegistrada: f.ubicacionEstado === 'recibida' && grupoDe(f) === 'ubicacion',
  };
}

// ------------------------------------------------------------- en masa

export const ACCIONES_EN_MASA = ['confirmar_envio', 'pedir_ubicacion', 'pedir_confirmacion', 'marcar_contactado', 'quitar_marca', 'pausar', 'reanudar'] as const;
export type AccionEnMasa = (typeof ACCIONES_EN_MASA)[number];

/** Lo hecho, dicho en palabras: «Se pidió la ubicación a 12». */
const HECHO: Record<AccionEnMasa, (n: number) => string> = {
  confirmar_envio: (n) => `Envío confirmado a ${n}`,
  pedir_ubicacion: (n) => `Se pidió la ubicación a ${n}`,
  pedir_confirmacion: (n) => `Se pidió la confirmación a ${n}`,
  marcar_contactado: (n) => (n === 1 ? '1 quedó marcado como contactado' : `${n} quedaron marcados como contactados`),
  quitar_marca: (n) => `Se quitó la marca de contactado a ${n}`,
  pausar: (n) => `Se detuvieron los mensajes automáticos a ${n}`,
  reanudar: (n) => `Se reanudaron los mensajes automáticos a ${n}`,
};
const NADA: Record<AccionEnMasa, string> = {
  confirmar_envio: 'No se confirmó el envío a ninguno',
  pedir_ubicacion: 'No se pidió la ubicación a ninguno',
  pedir_confirmacion: 'No se pidió la confirmación a ninguno',
  marcar_contactado: 'No se marcó ninguno',
  quitar_marca: 'No se quitó la marca a ninguno',
  pausar: 'No se detuvo ninguno',
  reanudar: 'No se reanudó ninguno',
};

/** Por qué se saltó, en singular y en plural. */
const SALTADO: Record<Exclude<MotivoNumero, 'hecho'>, [string, string]> = {
  no_existe: ['ya no existía', 'ya no existían'],
  cerrada: ['ya estaba cerrado (entregado o cancelado)', 'ya estaban cerrados (entregados o cancelados)'],
  ya_tiene_ubicacion: ['ya la había mandado', 'ya la habían mandado'],
  ya_confirmo: ['ya había confirmado', 'ya habían confirmado'],
  no_hace_falta: ['no necesita confirmar', 'no necesitan confirmar'],
  falta_ubicacion: ['todavía no manda su ubicación (la confirmación se le pide justo después)', 'todavía no mandan su ubicación (la confirmación se les pide justo después)'],
  pausado: ['tiene los mensajes en pausa (reanúdalo primero)', 'tienen los mensajes en pausa (reanúdalos primero)'],
  ya_marcado: ['ya estaba marcado', 'ya estaban marcados'],
  sin_marca: ['no tenía la marca', 'no tenían la marca'],
  ya_pausado: ['ya estaba en pausa', 'ya estaban en pausa'],
  no_pausado: ['no estaba en pausa', 'no estaban en pausa'],
  no_retenido: ['ya estaba enviado (no esperaba confirmación)', 'ya estaban enviados (no esperaban confirmación)'],
  fallo: ['no se pudo poner en la cola (inténtalo otra vez en un momento)', 'no se pudieron poner en la cola (inténtalo otra vez en un momento)'],
};

export function avisoEnPalabras(accion: AccionEnMasa, hechos: number, saltados: Partial<Record<MotivoNumero, number>>): string {
  const partes = [hechos > 0 ? HECHO[accion](hechos) : NADA[accion]];
  for (const [motivo, n] of Object.entries(saltados) as Array<[Exclude<MotivoNumero, 'hecho'>, number]>) {
    if (!n || !SALTADO[motivo]) continue;
    const [una, varias] = SALTADO[motivo];
    partes.push(`${n} ${n === 1 ? una : varias} y ${n === 1 ? 'se saltó' : 'se saltaron'}`);
  }
  let texto = partes.join('; ') + '.';
  if (hechos > 0 && (accion === 'pedir_ubicacion' || accion === 'pedir_confirmacion' || accion === 'confirmar_envio')) texto += ' Salen de uno en uno, con la pausa de siempre entre mensaje y mensaje.';
  return texto;
}

export interface ResultadoEnMasa {
  ok: true;
  accion: AccionEnMasa;
  hechos: number;
  saltados: Partial<Record<MotivoNumero, number>>;
  aviso: string;
  resultados: Array<{ id: number; hecho: boolean; motivo: MotivoNumero }>;
}

/** La accion de una entrega, repetida en bucle sobre todas. Una que falla no para a las demas. */
export async function accionEnMasa(entregas: ServicioEntregas, accion: AccionEnMasa, ids: number[], quien: string): Promise<ResultadoEnMasa> {
  const una = async (id: number): Promise<ResultadoNumero> => {
    switch (accion) {
      case 'confirmar_envio': {
        const r = await entregas.liberarEnvio([id], quien);
        return { hecho: r.liberadas > 0, motivo: r.liberadas > 0 ? 'hecho' : 'no_retenido', entrega: null };
      }
      case 'pedir_ubicacion':
        return entregas.pedirUbicacionAhora(id, quien);
      case 'pedir_confirmacion':
        return entregas.pedirConfirmacionAhora(id, quien);
      case 'marcar_contactado':
        return entregas.marcarContactado(id, true, quien);
      case 'quitar_marca':
        return entregas.marcarContactado(id, false, quien);
      case 'pausar':
        return entregas.pausarMensajes(id, true, quien);
      case 'reanudar':
        return entregas.pausarMensajes(id, false, quien);
    }
  };
  const resultados: ResultadoEnMasa['resultados'] = [];
  const saltados: Partial<Record<MotivoNumero, number>> = {};
  let hechos = 0;
  for (const id of [...new Set(ids)]) {
    let r: ResultadoNumero;
    try {
      r = await una(id);
    } catch {
      r = { hecho: false, motivo: 'fallo', entrega: null };
    }
    resultados.push({ id, hecho: r.hecho, motivo: r.motivo });
    if (r.hecho) hechos++;
    else saltados[r.motivo] = (saltados[r.motivo] ?? 0) + 1;
  }
  return { ok: true, accion, hechos, saltados, aviso: avisoEnPalabras(accion, hechos, saltados), resultados };
}

const quienEs = (u: { nombre?: string; usuario?: string } | null | undefined): string => u?.nombre || u?.usuario || 'alguien del panel';

export async function registerNumerosRoutes(app: FastifyInstance, deps: { entregas: ServicioEntregas }): Promise<void> {
  const { entregas } = deps;

  app.get('/admin/entregas/numeros', async () => {
    const r = await entregas.resumen();
    const max = r.ajustes.confirmacionMaxIntentos;
    const numeros = r.entregas.map((f) => filaNumero(f, max));
    const cifras: Record<EtapaNumero | 'todos', number> = { todos: numeros.length, por_confirmar_envio: 0, falta_pedir: 0, falta_ubicacion: 0, falta_confirmar: 0, contactados: 0, necesita: 0, cancelada: 0 };
    for (const n of numeros) cifras[n.etapa]++;
    return { dia: r.dia, numeros, cifras, etapas: ETAPAS, porConfirmar: r.porConfirmarEnvio, confirmarListaGsg: r.ajustes.confirmarListaGsg !== false, motor: r.motor, gsg: r.gsg ? { conectada: r.gsg.conectada, modo: r.gsg.modo } : null };
  });

  /** «Confirmar y enviar a todos (N)» (o solo esos ids): lo que llegó de GSG pasa al reparto con el ritmo de siempre. */
  app.post('/admin/entregas/confirmar-envio', async (request, reply) => {
    const cuerpo = z
      .object({ todos: z.boolean().optional(), ids: z.array(z.coerce.number().int().positive()).max(2000, 'Son demasiados de golpe: como mucho 2000.').optional() })
      .safeParse(request.body ?? {});
    if (!cuerpo.success) return reply.code(400).send({ error: cuerpo.error.issues[0]?.message ?? 'Faltan datos para confirmar el envío.' });
    if (!cuerpo.data.todos && !cuerpo.data.ids?.length) return reply.code(400).send({ error: 'No hay ningún número seleccionado: marca al menos uno, o usa «Confirmar y enviar a todos».' });
    return entregas.liberarEnvio(cuerpo.data.todos ? 'todos' : cuerpo.data.ids!, quienEs(request.usuario));
  });

  app.post('/admin/entregas/masa', async (request, reply) => {
    const cuerpo = z
      .object({
        accion: z.enum(ACCIONES_EN_MASA, { errorMap: () => ({ message: 'Esa acción no existe: elige una de los botones.' }) }),
        ids: z.array(z.coerce.number().int().positive()).max(2000, 'Son demasiados de golpe: como mucho 2000.'),
      })
      .safeParse(request.body ?? {});
    if (!cuerpo.success) return reply.code(400).send({ error: cuerpo.error.issues[0]?.message ?? 'Faltan datos para hacer la acción.' });
    if (!cuerpo.data.ids.length) return reply.code(400).send({ error: 'No hay ningún número seleccionado: marca al menos uno.' });
    return accionEnMasa(entregas, cuerpo.data.accion, cuerpo.data.ids, quienEs(request.usuario));
  });
}
