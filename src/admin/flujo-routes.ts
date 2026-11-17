/**
 * El flujo de GSGchat completo, visto de un golpe (el lienzo de arriba del Inicio).
 *
 * Cada paso del recorrido de un pedido, con cuántos clientes de hoy hay en él:
 *
 *   GSG manda pedidos → Revisar número y tracking → Confirmar y enviar → Cola de envío (líneas de WhatsApp)
 *     → 1.er mensaje (plantilla GSG) → Estado en WhatsApp → ¿Qué responde el cliente?
 *        Ubicación      → Ubicación recibida → ¿Es ahí? → 2.º mensaje «Ubicación registrada» → Ubicación a GSG (y si la cambia, otra vez)
 *        Otra cosa      → Responde sin ubicación (la IA lo lee) → Conversación directa → 2.º mensaje desde el chat
 *        Nada           → Insiste solo → Pasa a una persona → Reporte a GSG
 *        No es la persona / número con problema → Número reportado → Reporte a GSG
 *
 * Aquí no se inventa ningún estado: todo sale de lo que ya guarda el pedido
 * (`mensajeEstado`, `ubicacionEstado`, la solicitud del reparto), de los
 * números reportados, de los mensajes de hoy y de las líneas de WhatsApp. La
 * cuenta (`contarFlujo`) es pura para poder probarla sin servidor.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Repos } from '../db/repos.js';
import type { EstadoSolicitud } from '../db/rutas.js';
import type { EstadoEntrega, EstadoMensaje, EstadoUbicacion } from '../entregas/repo.js';
import type { ServicioEntregas } from '../entregas/servicio.js';
import { providerOf, type Provider, type SettingsService } from '../settings/service.js';
import { algunaLineaConectada, type FuentesConexion } from '../whatsapp/estado-conexion.js';
import type { ServicioLineas } from '../whatsapp/lineas.js';
import { nombreDeEtiqueta } from '../archive/clasificar.js';
import { catalogoVigente } from '../chat/etiquetar.js';
import { esQuejaDePedido } from '../ia/consulta-pedido.js';
import type { RegistroClientes } from '../whatsapp/registro.js';
import type { DisposicionFlujo } from '../db/flujo-disposicion.js';

/** Lo mínimo de un pedido de hoy que hace falta para contarlo en el flujo. */
export interface PedidoEnFlujo {
  estado: EstadoEntrega;
  ubicacionEstado: EstadoUbicacion;
  mensajeEstado?: EstadoMensaje;
  incidencia?: string | null;
  requiereHumano?: boolean;
  datosEnvio?: { firstMessage?: string | null } | null;
  ubicacionFuente?: string | null;
  /** Veces que el cliente cambió su ubicación después de mandarla. */
  ubicacionCambios?: number;
  /** Se le preguntó «¿es ahí?» por una dirección escrita o un pin dudoso y aún no dice que sí. */
  pinPropuestoAt?: Date | string | null;
  /** La solicitud del reparto (solo mientras falta la ubicación). primeraRespuestaAt = el cliente ya escribió algo. */
  solicitud?: { estado: EstadoSolicitud; incidencia?: string | null; intentos?: number; primeraRespuestaAt?: Date | string | null } | null;
  /**
   * El cliente escribió en su chat después del primer mensaje (lo pone
   * `marcarQuienEscribio`). Hace falta porque un texto sin ubicación no
   * siempre cambia la solicitud: el bot solo le vuelve a pedir el pin.
   */
  escribioTrasElMensaje?: boolean;
}

export interface CifrasFlujo {
  /** Pedidos de hoy que mandó GSG (todos, también los cancelados). */
  recibidos: number;
  cancelados: number;
  /** Los que necesitan que el cliente mande su ubicación (el resto ya la trae de GSG). */
  pidenUbicacion: number;
  /** Los que ya traían la ubicación de GSG: no se les pide. */
  yaConUbicacion: number;
  primerMensaje: {
    enviados: number;
    /** Esperan «Confirmar y enviar» en Pedidos GSG: no salen solos. */
    retenidos: number;
    /** En cola o saliendo ahora (con el ritmo de siempre). */
    enCola: number;
    /** No salió (número sin WhatsApp, sin plantilla...) o no se sabe si llegó. */
    fallidos: number;
    /** Llevan el texto que GSG redactó (firstMessage) en vez del del sistema. */
    conTextoDeGsg: number;
  };
  respuesta: {
    /** SÍ: mandó su ubicación. */
    si: number;
    /** NO: contestó, pero sin ubicación. */
    respondioSinUbicacion: number;
    /** No contestó tras todos los intentos: lo sigue una persona. */
    noContesto: number;
    /** Ya tiene el mensaje y todavía no contesta (se le vuelve a escribir solo). */
    esperando: number;
    /** Dijo que no es esa persona: se reporta a GSG y no se le insiste. */
    noEsLaPersona: number;
  };
  /** Los que aún no contestan, por el mensaje en que van (1.º, 2.º, 3.º o más). */
  esperandoPorIntento: { uno: number; dos: number; tresOMas: number };
  /** Mandó una dirección escrita o un pin dudoso y se le preguntó «¿es ahí?». */
  porConfirmarUbicacion: number;
  /** Cambiaron su ubicación después de mandarla (se le vuelve a mandar a GSG). */
  cambiaronUbicacion: number;
  /** Pedidos que esperan a una persona. */
  requierenPersona: number;
  /** Los que pasaron a la conversación directa (respondió sin ubicación + no contestó). */
  conversacionDirecta: number;
}

const EN_COLA: ReadonlySet<EstadoMensaje> = new Set(['pendiente', 'encolado', 'enviando', 'reintentando']);
const FALLIDOS: ReadonlySet<EstadoMensaje> = new Set(['fallido', 'incierto']);
/** Estados de la solicitud del reparto en los que el cliente ya contestó algo que no era su ubicación. */
const RESPONDIO: ReadonlySet<EstadoSolicitud> = new Set(['respondio', 'supervision']);
const NO_CONTESTO = new Set(['sin_respuesta', 'no_contesta']);
const NO_ES_LA_PERSONA = new Set(['numero_equivocado', 'no_soy_yo']);

export function contarFlujo(pedidos: readonly PedidoEnFlujo[]): CifrasFlujo {
  const c: CifrasFlujo = {
    recibidos: pedidos.length,
    cancelados: 0,
    pidenUbicacion: 0,
    yaConUbicacion: 0,
    primerMensaje: { enviados: 0, retenidos: 0, enCola: 0, fallidos: 0, conTextoDeGsg: 0 },
    respuesta: { si: 0, respondioSinUbicacion: 0, noContesto: 0, esperando: 0, noEsLaPersona: 0 },
    esperandoPorIntento: { uno: 0, dos: 0, tresOMas: 0 },
    porConfirmarUbicacion: 0,
    cambiaronUbicacion: 0,
    requierenPersona: 0,
    conversacionDirecta: 0,
  };
  for (const p of pedidos) {
    if (p.estado === 'cancelada') {
      c.cancelados++;
      continue;
    }
    const msg = p.mensajeEstado ?? 'no_aplica';
    if (msg === 'enviado') c.primerMensaje.enviados++;
    else if (msg === 'retenido') c.primerMensaje.retenidos++;
    else if (EN_COLA.has(msg)) c.primerMensaje.enCola++;
    else if (FALLIDOS.has(msg)) c.primerMensaje.fallidos++;
    if (p.datosEnvio?.firstMessage?.trim()) c.primerMensaje.conTextoDeGsg++;
    if (p.requiereHumano) c.requierenPersona++;
    if ((p.ubicacionCambios ?? 0) > 0) c.cambiaronUbicacion++;

    if (p.ubicacionEstado === 'no_hace_falta') {
      c.yaConUbicacion++;
      continue;
    }
    c.pidenUbicacion++;
    if (p.ubicacionEstado === 'recibida') {
      c.respuesta.si++;
      continue;
    }
    // Si su primer mensaje no salió, todavía no se le pidió nada: no cuenta como «no contestó».
    if (FALLIDOS.has(msg)) continue;
    if (p.pinPropuestoAt) c.porConfirmarUbicacion++;
    // Sigue sin ubicación: ¿no es la persona, contestó otra cosa, no contestó nunca, o aún se espera?
    const incidencia = p.solicitud?.incidencia ?? p.incidencia ?? null;
    const estadoSol = p.solicitud?.estado ?? null;
    if (incidencia && NO_ES_LA_PERSONA.has(incidencia)) c.respuesta.noEsLaPersona++;
    // Contestó algo que no era su ubicación: el bot se la vuelve a pedir, pero ya es una conversación.
    else if (incidencia === 'respondio_sin_ubicacion' || (estadoSol && RESPONDIO.has(estadoSol)) || p.solicitud?.primeraRespuestaAt || p.escribioTrasElMensaje || p.pinPropuestoAt) c.respuesta.respondioSinUbicacion++;
    else if ((incidencia && NO_CONTESTO.has(incidencia)) || estadoSol === 'derivado' || estadoSol === 'incidencia' || (p.requiereHumano && msg === 'enviado')) c.respuesta.noContesto++;
    else if (msg === 'enviado') {
      c.respuesta.esperando++;
      const n = p.solicitud?.intentos ?? 1;
      if (n <= 1) c.esperandoPorIntento.uno++;
      else if (n === 2) c.esperandoPorIntento.dos++;
      else c.esperandoPorIntento.tresOMas++;
    }
  }
  c.conversacionDirecta = c.respuesta.respondioSinUbicacion + c.respuesta.noContesto;
  return c;
}

/**
 * Marca los pedidos cuyo cliente escribió después del primer mensaje y aún no
 * mandó su ubicación. Solo se consulta a esos (los que aún esperan), un
 * teléfono una vez, de 25 en 25 para no ahogar la base con cientos de pedidos.
 */
export async function marcarQuienEscribio<T extends PedidoEnFlujo & { phone: string; mensajeEnviadoAt?: Date | string | null }>(
  pedidos: T[],
  ultimoEntrante: (phone: string) => Promise<Date | string | null | undefined>,
): Promise<T[]> {
  const candidatos = pedidos.filter((p) => p.estado !== 'cancelada' && p.ubicacionEstado === 'pendiente' && p.mensajeEstado === 'enviado' && p.phone);
  const telefonos = [...new Set(candidatos.map((p) => p.phone))].slice(0, 5000);
  const ultimo = new Map<string, number>();
  for (let i = 0; i < telefonos.length; i += 25) {
    await Promise.all(
      telefonos.slice(i, i + 25).map(async (t) => {
        const en = await ultimoEntrante(t).catch(() => null);
        const ms = en ? new Date(en).getTime() : NaN;
        if (Number.isFinite(ms)) ultimo.set(t, ms);
      }),
    );
  }
  for (const p of candidatos) {
    const escribio = ultimo.get(p.phone);
    const enviado = p.mensajeEnviadoAt ? new Date(p.mensajeEnviadoAt).getTime() : NaN;
    // WhatsApp da la hora del mensaje en segundos: una respuesta en el mismo segundo del envío queda «antes».
    if (escribio !== undefined && Number.isFinite(enviado) && escribio + 1000 > enviado) p.escribioTrasElMensaje = true;
  }
  return pedidos;
}

/** Los números reportados a GSG de ese día, por motivo (solo los que siguen sin corregir cuentan como pendientes). */
export function contarReportados(filas: ReadonlyArray<{ dia: string; error: string; estado: string }>, dia: string | null) {
  const deHoy = dia ? filas.filter((f) => f.dia === dia) : [...filas];
  const porMotivo: Record<string, number> = {};
  let pendientes = 0;
  for (const f of deHoy) {
    porMotivo[f.error] = (porMotivo[f.error] ?? 0) + 1;
    if (f.estado === 'pendiente') pendientes++;
  }
  return { total: deHoy.length, pendientes, corregidos: deHoy.length - pendientes, porMotivo };
}

// ------------------------------------------------------------- casos de hoy

/** Un cliente concreto en un paso del flujo: quién es, cuándo y qué le pasó. */
export interface CasoFlujo {
  nombre: string | null;
  tracking: string | null;
  telefono: string | null;
  /** ISO; null si no se sabe la hora. */
  hora: string | null;
  detalle: string;
}

/** Una lista de casos: los primeros `TOPE_CASOS` y cuántos hay en total. */
export interface ListaCasos {
  total: number;
  casos: CasoFlujo[];
}

export const TOPE_CASOS = 60;

/** Lo que el flujo lee de cada pedido para contar sus casos (una FilaEntrega cumple). */
export interface PedidoConCaso extends PedidoEnFlujo {
  phone: string;
  nombre?: string | null;
  referencia?: string;
  datosEnvio?: { firstMessage?: string | null; tracking?: string | null } | null;
  ubicacionAt?: Date | string | null;
  mensajeError?: string | null;
  mensajeErrorCodigo?: string | null;
  mensajeUltimoIntentoAt?: Date | string | null;
  mensajeProximoAt?: Date | string | null;
  mensajeEnviadoAt?: Date | string | null;
  incidenciaDetalle?: string | null;
  cambioUbicacion?: string | null;
  ubicacionCambiadaAt?: Date | string | null;
  situacion?: string;
  updatedAt?: Date | string | null;
}

/** Un mensaje que un cliente escribió hoy y que el detector de quejas marcó como queja. */
export interface QuejaEscrita {
  phone: string;
  nombre: string | null;
  texto: string;
  en: Date | string;
}

/**
 * Las quejas escritas hoy en los chats. Mientras se espera el pin el bot no
 * contesta nada que no sea la ubicación, así que una queja puede quedar solo
 * en el chat: aquí se leen los mensajes del día de cada conversación con
 * actividad hoy y se pasan por el mismo detector que usa el bot
 * (`esQuejaDePedido`). Una queja por cliente (la última), de 25 en 25 chats.
 */
export async function quejasEscritasHoy(
  messages: Pick<Repos['messages'], 'listConversations' | 'listMessages'>,
  desde: Date,
  esQueja: (texto: string) => boolean,
  tope = 300,
): Promise<QuejaEscrita[]> {
  const convs = (await messages.listConversations({ limit: tope, offset: 0, incluirApartados: true, desde }).catch(() => []))
    .filter((c) => c.tipo !== 'grupo' && c.lastInboundAt && new Date(c.lastInboundAt).getTime() >= desde.getTime());
  const salida: QuejaEscrita[] = [];
  for (let i = 0; i < convs.length; i += 25) {
    await Promise.all(
      convs.slice(i, i + 25).map(async (c) => {
        const msgs = await messages.listMessages(c.contactId, 40, undefined, desde).catch(() => []);
        const queja = msgs
          .filter((m) => m.direction === 'in' && m.body && new Date(m.createdAt).getTime() >= desde.getTime() && esQueja(m.body))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        if (queja) salida.push({ phone: c.phone, nombre: c.name, texto: queja.body!.replace(/\s+/g, ' ').trim().slice(0, 220), en: queja.createdAt });
      }),
    );
  }
  return salida;
}

/** Una nota que la IA (o el equipo) le puso a un chat del día. */
export interface NotaDelDia {
  phone: string;
  etiqueta: string | null;
  nombreEtiqueta: string;
  motivo: string | null;
  en: Date | string | null;
}

/** Un número reportado a GSG (lo que hace falta para listarlo). */
export interface ReportadoDelDia {
  dia: string;
  error: string;
  estado: string;
  tracking: string | null;
  telefono: string | null;
  mensaje: string;
  detalle: string | null;
  reportadoAt: Date | string;
  /** El pedido tal como lo mandó GSG (de ahí sale el nombre si el pedido no se guardó). */
  pedido?: Record<string, unknown> | null;
}

export interface CasosFlujo {
  ubicacionRecibida: ListaCasos;
  porConfirmarUbicacion: ListaCasos;
  cambiaronUbicacion: ListaCasos;
  erroresEnvio: ListaCasos;
  sinEnviar: ListaCasos;
  respondioSinUbicacion: ListaCasos;
  noContesto: ListaCasos;
  noEsLaPersona: ListaCasos;
  esperando: ListaCasos;
  requierenPersona: ListaCasos;
  quejas: ListaCasos;
  reportados: ListaCasos;
  /** Las notas del día por etiqueta (reclamo, cancelar, reagendar...), cada una con sus chats. */
  notas: Array<{ codigo: string; nombre: string } & ListaCasos>;
}

const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
};
/** Los 9 últimos dígitos: así casa un teléfono con o sin el 51 delante. */
const cola9 = (t: string | null | undefined) => String(t ?? '').replace(/\D/g, '').slice(-9);
const QUEJA_EN_TEXTO = /\b(queja|quej[oó]|reclamo|reclam[oó]|p[eé]simo|estafa|indecopi)\b/i;
const FUENTE: Record<string, string> = { whatsapp: 'Pin de WhatsApp', pin: 'Pin de WhatsApp', enlace: 'Enlace de Google Maps', maps: 'Enlace de Google Maps', direccion: 'Dirección escrita (confirmada)', gsg: 'Vino de GSG', propuesta: 'Su dirección de antes (confirmada)' };

function lista(casos: CasoFlujo[]): ListaCasos {
  // Lo más reciente primero; lo que no tiene hora, al final.
  const orden = [...casos].sort((a, b) => (b.hora ?? '').localeCompare(a.hora ?? ''));
  return { total: casos.length, casos: orden.slice(0, TOPE_CASOS) };
}

/**
 * Los casos concretos de hoy en cada paso del flujo: quién cambió su
 * ubicación, qué mensaje falló y por qué, cuál no salió, quién se quejó...
 * Usa las mismas reglas que `contarFlujo`, así las listas cuadran con las cifras.
 */
export function armarCasos(pedidos: readonly PedidoConCaso[], notas: readonly NotaDelDia[], reportados: readonly ReportadoDelDia[], dia: string | null, quejasEscritas: readonly QuejaEscrita[] = []): CasosFlujo {
  const L: Record<Exclude<keyof CasosFlujo, 'notas'>, CasoFlujo[]> = {
    ubicacionRecibida: [], porConfirmarUbicacion: [], cambiaronUbicacion: [], erroresEnvio: [], sinEnviar: [], respondioSinUbicacion: [],
    noContesto: [], noEsLaPersona: [], esperando: [], requierenPersona: [], quejas: [], reportados: [],
  };
  const porTelefono = new Map<string, PedidoConCaso>();
  for (const p of pedidos) {
    if (p.estado === 'cancelada') continue;
    porTelefono.set(cola9(p.phone), p);
    const base = { nombre: p.nombre ?? null, tracking: p.datosEnvio?.tracking || p.referencia || null, telefono: p.phone };
    const caso = (detalle: string, hora: Date | string | null | undefined): CasoFlujo => ({ ...base, hora: iso(hora), detalle });
    const msg = p.mensajeEstado ?? 'no_aplica';
    if (msg === 'fallido' || msg === 'incierto') {
      L.erroresEnvio.push(caso((msg === 'incierto' ? 'No se sabe si llegó: ' : '') + (p.mensajeError || p.mensajeErrorCodigo || 'El mensaje no salió'), p.mensajeUltimoIntentoAt ?? p.updatedAt));
    } else if (msg === 'retenido') {
      L.sinEnviar.push(caso('Espera «Confirmar y enviar» en Pedidos GSG', p.updatedAt));
    } else if (msg === 'reintentando') {
      L.sinEnviar.push(caso(`Falló y se reintenta solo${p.mensajeError ? ': ' + p.mensajeError : ''}`, p.mensajeUltimoIntentoAt ?? p.updatedAt));
    } else if (EN_COLA.has(msg)) {
      L.sinEnviar.push(caso(msg === 'enviando' ? 'Saliendo ahora mismo' : 'En la cola de envío, sale con el ritmo de siempre', p.updatedAt));
    }
    if ((p.ubicacionCambios ?? 0) > 0) L.cambiaronUbicacion.push(caso(p.cambioUbicacion || `Cambió su ubicación ${p.ubicacionCambios} ${p.ubicacionCambios === 1 ? 'vez' : 'veces'}`, p.ubicacionCambiadaAt ?? p.ubicacionAt));
    if (p.requiereHumano) L.requierenPersona.push(caso(p.incidenciaDetalle || p.situacion || 'Espera a una persona', p.updatedAt));
    if (p.incidenciaDetalle && QUEJA_EN_TEXTO.test(p.incidenciaDetalle)) L.quejas.push(caso(p.incidenciaDetalle, p.updatedAt));
    if (p.ubicacionEstado === 'no_hace_falta') continue;
    if (p.ubicacionEstado === 'recibida') {
      L.ubicacionRecibida.push(caso(FUENTE[p.ubicacionFuente ?? ''] ?? 'Mandó su ubicación', p.ubicacionAt));
      continue;
    }
    if (FALLIDOS.has(msg)) continue;
    if (p.pinPropuestoAt) L.porConfirmarUbicacion.push(caso('Se le preguntó «¿es ahí?» y aún no dice que sí', p.pinPropuestoAt));
    const incidencia = p.solicitud?.incidencia ?? p.incidencia ?? null;
    const estadoSol = p.solicitud?.estado ?? null;
    const intentos = p.solicitud?.intentos ?? 0;
    if (incidencia && NO_ES_LA_PERSONA.has(incidencia)) L.noEsLaPersona.push(caso(p.incidenciaDetalle || 'Dice que no es esa persona', p.updatedAt));
    else if (incidencia === 'respondio_sin_ubicacion' || (estadoSol && RESPONDIO.has(estadoSol)) || p.solicitud?.primeraRespuestaAt || p.escribioTrasElMensaje || p.pinPropuestoAt)
      L.respondioSinUbicacion.push(caso(p.incidenciaDetalle || (p.pinPropuestoAt ? 'Escribió una dirección: falta que confirme' : 'Escribió sin mandar su ubicación; se le vuelve a pedir'), p.solicitud?.primeraRespuestaAt ?? p.updatedAt));
    else if ((incidencia && NO_CONTESTO.has(incidencia)) || estadoSol === 'derivado' || estadoSol === 'incidencia' || (p.requiereHumano && msg === 'enviado'))
      L.noContesto.push(caso(p.incidenciaDetalle || `${intentos || 'Varios'} mensajes sin respuesta`, p.updatedAt));
    else if (msg === 'enviado') L.esperando.push(caso(`Va en el ${Math.max(1, intentos)}.º mensaje, aún no contesta`, p.mensajeEnviadoAt ?? p.updatedAt));
  }
  // Las notas del día: las quejas (reclamo) se suman a la lista de quejas; todas van por etiqueta.
  const porEtiqueta = new Map<string, { codigo: string; nombre: string; casos: CasoFlujo[] }>();
  const yaQueja = new Set(L.quejas.map((q) => cola9(q.telefono)));
  for (const n of notas) {
    if (!n.etiqueta) continue;
    const p = porTelefono.get(cola9(n.phone));
    const c: CasoFlujo = { nombre: p?.nombre ?? null, tracking: p ? p.datosEnvio?.tracking || p.referencia || null : null, telefono: n.phone, hora: iso(n.en), detalle: n.motivo || n.nombreEtiqueta };
    const g = porEtiqueta.get(n.etiqueta) ?? { codigo: n.etiqueta, nombre: n.nombreEtiqueta, casos: [] };
    g.casos.push(c);
    porEtiqueta.set(n.etiqueta, g);
    if (n.etiqueta === 'reclamo' && !yaQueja.has(cola9(n.phone))) {
      yaQueja.add(cola9(n.phone));
      L.quejas.push(c);
    }
  }
  // Lo que escribieron hoy y suena a queja (aunque el bot no lo haya contestado).
  for (const q of quejasEscritas) {
    if (yaQueja.has(cola9(q.phone))) continue;
    yaQueja.add(cola9(q.phone));
    const p = porTelefono.get(cola9(q.phone));
    L.quejas.push({ nombre: p?.nombre ?? q.nombre, tracking: p ? p.datosEnvio?.tracking || p.referencia || null : null, telefono: q.phone, hora: iso(q.en), detalle: `Escribió: «${q.texto}»` });
  }
  for (const r of reportados) {
    if (dia && r.dia !== dia) continue;
    const p = porTelefono.get(cola9(r.telefono));
    const delPedido = r.pedido ? String(r.pedido.cliente ?? r.pedido.nombre ?? '').trim() || null : null;
    L.reportados.push({ nombre: p?.nombre ?? delPedido, tracking: r.tracking, telefono: r.telefono, hora: iso(r.reportadoAt), detalle: `${r.error}|${r.estado === 'corregido' ? 'Corregido' : 'Sin corregir'}${r.detalle ? ' · ' + r.detalle : ''}` });
  }
  const salida = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, lista(v)])) as Omit<CasosFlujo, 'notas'>;
  return {
    ...salida,
    notas: [...porEtiqueta.values()].map((g) => ({ codigo: g.codigo, nombre: g.nombre, ...lista(g.casos) })).sort((a, b) => b.total - a.total),
  };
}

/** Una línea de WhatsApp tal como la enseña el flujo. */
export interface LineaEnFlujo {
  etiqueta: string;
  numero: string;
  /** api = WhatsApp API oficial (Meta); business = WhatsApp Business por QR (o WAHA). */
  tipo: 'api' | 'business';
  conectada: boolean;
  principal: boolean;
}

export const tipoDeLinea = (p: Provider): LineaEnFlujo['tipo'] => (p === 'cloud' ? 'api' : 'business');

/**
 * Los cuadros del flujo que el administrador puede mover (los ids de
 * `nodo({id:…})` en src/web/flujo-inicio.ts; una prueba comprueba que coinciden).
 */
export const NODOS_DEL_FLUJO = [
  'gsg', 'revisar', 'confirmar', 'cola', 'primero', 'estado', 'responde',
  'empresa', 'reportado', 'reporte1', 'lineas', 'ia', 'errorEnvio',
  'ubicacion', 'esahi', 'segundo', 'agsg', 'listo', 'cambia',
  'otra', 'chat', 'chat2', 'queja',
  'insiste', 'agoto', 'persona', 'reporte2',
] as const;
const NODOS_CONOCIDOS = new Set<string>(NODOS_DEL_FLUJO);
/** Hasta dónde se puede llevar un cuadro (el lienzo mide 1600 × 1430). */
export const LIMITES_DISPOSICION = { min: -400, maxX: 3200, maxY: 3200 };

export class DisposicionInvalida extends Error {}

/**
 * Valida lo que manda el panel: un objeto `{ id: [x, y] }` con ids conocidos y
 * números finitos dentro del lienzo. Devuelve las posiciones redondeadas a
 * la rejilla de 10 px. Lanza DisposicionInvalida si algo no cuadra.
 */
export function limpiarDisposicion(entrada: unknown): DisposicionFlujo {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) throw new DisposicionInvalida('Falta la posición de los cuadros.');
  const pares = Object.entries(entrada as Record<string, unknown>);
  if (pares.length > NODOS_DEL_FLUJO.length) throw new DisposicionInvalida('Hay más cuadros de los que tiene el flujo.');
  const salida: DisposicionFlujo = {};
  for (const [id, pos] of pares) {
    if (!NODOS_CONOCIDOS.has(id)) throw new DisposicionInvalida(`El flujo no tiene un cuadro «${id.slice(0, 40)}».`);
    if (!Array.isArray(pos) || pos.length !== 2) throw new DisposicionInvalida(`La posición de «${id}» no es válida.`);
    const [x, y] = pos;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) throw new DisposicionInvalida(`La posición de «${id}» no es válida.`);
    const { min, maxX, maxY } = LIMITES_DISPOSICION;
    if (x < min || x > maxX || y < min || y > maxY) throw new DisposicionInvalida(`«${id}» quedó fuera del lienzo.`);
    salida[id] = [Math.round(x / 10) * 10, Math.round(y / 10) * 10];
  }
  return salida;
}

/** Lo guardado, sin los cuadros que ya no existen ni posiciones raras (por si cambió el flujo). */
function disposicionLegible(d: DisposicionFlujo | null): DisposicionFlujo {
  const salida: DisposicionFlujo = {};
  for (const [id, pos] of Object.entries(d ?? {})) {
    if (!NODOS_CONOCIDOS.has(id) || !Array.isArray(pos)) continue;
    try {
      Object.assign(salida, limpiarDisposicion({ [id]: pos }));
    } catch {
      // Una posición que ya no vale se ignora: el cuadro vuelve a su sitio de fábrica.
    }
  }
  return salida;
}

export interface FlujoDeps {
  repos: Pick<Repos, 'usuarios' | 'contacts' | 'deliveries' | 'messages' | 'reportados' | 'chatEtiquetas' | 'flujoDisposicion'>;
  settings: SettingsService;
  fuentes: FuentesConexion;
  nombreNegocio: () => string;
  entregas?: Pick<ServicioEntregas, 'resumen'>;
  lineas?: Pick<ServicioLineas, 'preferida'>;
  registroClientes?: Pick<RegistroClientes, 'estados' | 'transporte'>;
  /** El asistente de IA (lee las respuestas y pone las notas); null si este arranque no lo tiene. */
  ia?: { activa(): boolean } | null;
}

async function lineasDelFlujo(deps: FlujoDeps): Promise<LineaEnFlujo[]> {
  const provPrincipal = providerOf(deps.settings.current());
  if (deps.registroClientes) {
    try {
      const preferida = deps.lineas?.preferida ? await deps.lineas.preferida().catch(() => null) : null;
      const estados = await deps.registroClientes.estados();
      const salida: LineaEnFlujo[] = [];
      for (const e of estados) {
        if (!e.linea.habilitada && !e.linea.principal) continue;
        let numero = e.linea.telefono || '';
        if (!numero) {
          // El número del QR se sabe por la sesión viva, no por la base.
          try {
            const t = await deps.registroClientes.transporte(e.linea.id);
            numero = t?.sesion?.getLocalState?.()?.phone ?? '';
          } catch {
            numero = '';
          }
        }
        salida.push({
          etiqueta: e.linea.etiqueta,
          numero,
          tipo: tipoDeLinea(e.linea.principal ? provPrincipal : e.linea.proveedor),
          conectada: e.linea.principal ? algunaLineaConectada({ ...deps.fuentes, registro: null }) : e.conectada,
          principal: preferida ? e.linea.id === preferida : e.linea.principal,
        });
      }
      if (salida.length) return salida;
    } catch {
      // Sin registro legible: se enseña la conexión de /setup, como antes.
    }
  }
  return [{ etiqueta: 'WhatsApp', numero: '', tipo: tipoDeLinea(provPrincipal), conectada: algunaLineaConectada(deps.fuentes), principal: true }];
}

export async function registerFlujoRoutes(app: FastifyInstance, deps: FlujoDeps): Promise<void> {
  // El orden de los cuadros lo decide un administrador de la tienda y lo ve todo su equipo.
  const puedeOrdenar = (request: FastifyRequest) => request.usuario?.rol === 'admin' && !request.usuario.porToken;
  const sinAlmacen = { error: 'Esta instalación no puede guardar el orden del flujo.' };
  app.put('/admin/flujo/disposicion', { bodyLimit: 8 * 1024 }, async (request, reply) => {
    const almacen = deps.repos.flujoDisposicion;
    if (!almacen) return reply.code(404).send(sinAlmacen);
    if (!puedeOrdenar(request)) return reply.code(403).send({ error: 'Solo un administrador puede ordenar el flujo.' });
    let nodos: DisposicionFlujo;
    try {
      nodos = limpiarDisposicion((request.body as { nodos?: unknown } | undefined)?.nodos);
    } catch (e) {
      if (e instanceof DisposicionInvalida) return reply.code(400).send({ error: e.message });
      throw e;
    }
    if (Object.keys(nodos).length) await almacen.guardar(nodos);
    else await almacen.borrar();
    return { disposicion: nodos };
  });
  app.delete('/admin/flujo/disposicion', async (request, reply) => {
    const almacen = deps.repos.flujoDisposicion;
    if (!almacen) return reply.code(404).send(sinAlmacen);
    if (!puedeOrdenar(request)) return reply.code(403).send({ error: 'Solo un administrador puede ordenar el flujo.' });
    await almacen.borrar();
    return { disposicion: {} };
  });

  app.get('/admin/flujo', async (request) => {
    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);
    const [usuarios, lineas, resumen, mensajes, sinLeer, reportados] = await Promise.all([
      deps.repos.usuarios.contar().catch(() => 0),
      lineasDelFlujo(deps),
      deps.entregas ? deps.entregas.resumen().catch(() => null) : Promise.resolve(null),
      deps.repos.deliveries.resumenDesde(inicioHoy).catch(() => null),
      deps.repos.messages.unreadTotal().catch(() => 0),
      deps.repos.reportados ? deps.repos.reportados.listar({ limit: 2000 }).catch(() => []) : Promise.resolve([]),
    ]);
    const dia = resumen?.dia ?? null;
    // Las notas del día (la IA o el equipo): de ahí salen las quejas y el desglose por tema.
    let notas: NotaDelDia[] = [];
    const etiquetas = deps.repos.chatEtiquetas;
    if (etiquetas && dia) {
      try {
        const [filas, catalogo] = await Promise.all([etiquetas.delDia(dia), catalogoVigente(etiquetas)]);
        notas = filas.map((f) => ({ phone: f.phone, etiqueta: f.etiqueta, nombreEtiqueta: f.etiqueta ? nombreDeEtiqueta(f.etiqueta, catalogo) : 'Sin clasificar', motivo: f.motivo ?? null, en: f.updatedAt ?? null }));
      } catch {
        notas = [];
      }
    }
    const pedidos = await marcarQuienEscribio(
      (resumen?.entregas ?? []).map((e) => ({ ...e })),
      async (phone) => (await deps.repos.contacts.getByPhone(phone))?.lastInboundAt ?? null,
    );
    return {
      generadoEn: new Date(),
      casos: armarCasos(pedidos, notas, reportados, dia, await quejasEscritasHoy(deps.repos.messages, inicioHoy, esQuejaDePedido)),
      empresa: { nombre: deps.nombreNegocio(), usuarios },
      whatsapp: { conectado: lineas.some((l) => l.conectada), lineas },
      gsg: resumen?.gsg ? { conectada: resumen.gsg.conectada, modo: resumen.gsg.modo ?? null } : null,
      dia: resumen?.dia ?? null,
      // Con la API de Meta, fuera de las 24 h solo sale una plantilla aprobada.
      plantillas: resumen?.plantillas ?? { hacenFalta: false, aprobadas: [] },
      // Si lo que llega de GSG espera «Confirmar y enviar» o sale solo.
      confirmarLista: resumen ? resumen.ajustes.confirmarListaGsg !== false : false,
      motor: resumen?.motor ?? null,
      cifras: contarFlujo(pedidos),
      // Lo que WhatsApp dice de los mensajes de hoy (todos, no solo el primero).
      mensajes: mensajes ? { enviados: mensajes.enviados, entregados: mensajes.entregados, leidos: mensajes.leidos, fallidos: mensajes.fallidos } : null,
      chatsSinLeer: sinLeer,
      reportados: contarReportados(reportados.map((r) => ({ dia: r.dia, error: r.error, estado: r.estado })), resumen?.dia ?? null),
      // Las ubicaciones e incidencias que van a GSG: lo que aceptó, lo que espera y lo que falló.
      reportes: resumen?.gsgCola ?? null,
      ia: deps.ia ? { activa: deps.ia.activa() } : null,
      disponible: Boolean(deps.entregas),
      // Dónde dejó el administrador cada cuadro (vacío = el orden de fábrica).
      disposicion: disposicionLegible(deps.repos.flujoDisposicion ? await deps.repos.flujoDisposicion.leer().catch(() => null) : null),
      puedeOrdenar: Boolean(deps.repos.flujoDisposicion) && puedeOrdenar(request),
    };
  });
}
