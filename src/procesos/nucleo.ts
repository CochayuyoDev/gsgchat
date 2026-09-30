/**
 * El corazon de los procesos: que se le manda a cada persona y que se hace
 * con lo que responde.
 *
 * Dos puertas, y las dos acaban en `componer` (lo que toca desde un paso):
 *
 *  - `enviarLoQueToca`: la llama el motor (motor.ts) cuando a una persona le
 *    toca algo -su primer mensaje, una insistencia, el fin de una espera-, al
 *    ritmo del numero y en horario, por el mismo `sender` de todo el sistema.
 *  - `atenderEntrante`: la llama el manejador de entrantes (handlers/inbound.ts)
 *    SOLO si esa persona tiene una corrida viva. Si no, el mensaje sigue su
 *    camino de siempre.
 *
 * Reglas que no se rompen:
 *  - Un entrante se contesta con UN mensaje como mucho: el «gracias» va pegado
 *    a la pregunta siguiente.
 *  - Los textos son los del proceso. El modelo (si hay) solo clasifica: si
 *    pregunta «¿por qué?» se le explica con el texto fijo del paso; si es una
 *    consulta ajena se manda el cierre una vez y pasa a una persona.
 *  - El sistema nunca manda ubicaciones: solo las pide y las recibe.
 */

import type { Repos } from '../db/repos.js';
import type { Sender, SendOutcome } from '../outbound/sender.js';
import type { MensajeIA } from '../ia/proveedores.js';
import { clasificarPorReglas, leerClase, promptClasificadorProceso, type ClaseOperativa } from '../ia/agente-operativo.js';
import { detectarManipulacion } from '../ia/seguridad.js';
import { esNumeroDePrueba } from '../desarrollador/numeros.js';
import { NOMBRE_TIPO_DATO, rellenarTexto, type Paso, type PatchPersona, type PersonaProceso, type Proceso, type Respuesta, type Salida, type TipoDato } from './modelo.js';
import { instanteEn, leerAvance, leerDato, leerDecision, leerFecha, leerHora, type EntradaProceso } from './validar.js';
import type { ProcesosRepo } from './repo.js';

export interface DepsNucleo {
  repos: Repos;
  sender: Sender;
  nombreNegocio: () => string;
  timezone?: string;
  /** Los distritos de la cobertura (config), para reconocer el distrito de una direccion escrita. */
  distritos?: string[];
  /** El modelo, solo para CLASIFICAR lo que las reglas no saben. */
  clasificar?: (mensajes: MensajeIA[]) => Promise<string>;
  ahora?: () => Date;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

export interface MensajeSalida {
  body: string;
  botones?: Array<{ id: string; title: string }>;
  pedirUbicacion?: boolean;
}

/** Cuanto dura en silencio el chat de una persona que se paso a alguien del equipo. */
export const PERSONA_VIGENTE_MS = 24 * 60 * 60_000;
/** Respuestas que no se entienden en un mismo paso antes de pasarlo a una persona. */
export const MAX_FALLOS = 3;

const unir = (...partes: Array<string | null | undefined>): string => partes.map((p) => (p ?? '').trim()).filter(Boolean).join('\n\n');

function repoDe(deps: DepsNucleo): ProcesosRepo {
  if (!deps.repos.procesos) throw new Error('los procesos no estan montados en este arranque');
  return deps.repos.procesos;
}

const horaCorta = (d: Date, tz: string) => {
  try {
    return new Intl.DateTimeFormat('es-PE', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  } catch {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
};

/** El texto de un paso (o del cierre) con los datos de la persona. */
export function rellenar(texto: string | undefined, persona: Pick<PersonaProceso, 'nombre' | 'datos'>, proceso: Pick<Proceso, 'nombre'>, negocio: string): string {
  return rellenarTexto(texto ?? '', { nombre: persona.nombre, negocio, datos: persona.datos, extra: { proceso: proceso.nombre } });
}

/** Los botones de un paso: SI / NO (/ Reprogramar) y Llegué / Terminé / No pude. */
export function botonesDe(paso: Paso, persona: Pick<PersonaProceso, 'id' | 'sub'>): Array<{ id: string; title: string }> | undefined {
  const id = (s: string) => `proc:${persona.id}:${s}`;
  if (paso.tipo === 'confirmar' && persona.sub !== 'reprogramando') {
    return [{ id: id('si'), title: 'Sí' }, { id: id('no'), title: 'No' }, ...(paso.reprogramar && paso.reprogramar !== 'no' ? [{ id: id('reprogramar'), title: 'Reprogramar' }] : [])];
  }
  if (paso.tipo === 'avance') {
    return persona.sub === 'llego' ? [{ id: id('termino'), title: 'Terminé' }, { id: id('no_pudo'), title: 'No pude' }] : [{ id: id('llego'), title: 'Llegué' }, { id: id('termino'), title: 'Terminé' }, { id: id('no_pudo'), title: 'No pude' }];
  }
  return undefined;
}

/** Por que se pide cada dato, si el proceso no lo dice. */
const POR_QUE_DEFECTO: Record<TipoDato, string> = {
  ubicacion: 'La ubicación la necesitamos solo para este trámite: ubicar tu domicilio con exactitud.',
  texto: 'Lo necesitamos para completar este trámite.',
  direccion: 'La dirección escrita evita confusiones al ubicarte.',
  numero: 'Lo necesitamos para registrar correctamente tu trámite.',
  documento_identidad: 'Tu documento nos permite verificar tu identidad y dejar el trámite a tu nombre.',
  fecha_hora: 'Con la fecha y la hora podemos agendarlo sin errores.',
  foto: 'La foto es el respaldo de este trámite.',
  documento: 'El documento es el respaldo de este trámite.',
  captura_pago: 'Con la captura registramos tu pago sin que tengas que acercarte a ninguna oficina.',
};

/** Lo que se contesta si no vale, si el proceso no lo dice. */
function noEntiendeDefecto(paso: Paso): string {
  if (paso.tipo === 'confirmar') return 'Disculpa, no entendí. Responde SÍ o NO, por favor.';
  if (paso.tipo === 'avance') return 'No entendí. Responde LLEGUÉ, TERMINÉ o NO PUDE.';
  const dato = paso.dato ?? 'texto';
  if (dato === 'ubicacion') return 'No pude leer una ubicación. Toca el clip 📎, elige «Ubicación» y envía tu ubicación actual.';
  if (dato === 'documento_identidad') return 'Ese número no parece un documento válido: el DNI tiene 8 dígitos, el carné de extranjería 9 y el RUC 11.';
  return `No pude leer tu respuesta. Necesitamos: ${NOMBRE_TIPO_DATO[dato].toLowerCase()}.`;
}

/** Lo que se pide en un paso, en palabras, para el clasificador. */
function quePide(paso: Paso | undefined): string {
  if (!paso) return 'un trámite';
  if (paso.tipo === 'pedir') return `se le pide ${NOMBRE_TIPO_DATO[paso.dato ?? 'texto'].toLowerCase()}`;
  if (paso.tipo === 'confirmar') return 'se le pide confirmar SÍ o NO (o reprogramar)';
  if (paso.tipo === 'avance') return 'el personal de campo avisa si llegó, si terminó o si no pudo hacer su tarea';
  return 'se le dio un aviso';
}

/** Cuando termina una espera: antes de la cita (sus columnas fecha y hora) o unos minutos. */
export function objetivoEspera(paso: Paso, persona: Pick<PersonaProceso, 'datos'>, ahora: Date, timezone: string): Date | null {
  const e = paso.esperar;
  if (!e) return null;
  if (e.como === 'minutos') return new Date(ahora.getTime() + e.minutos * 60_000);
  const d = persona.datos ?? {};
  const crudaFecha = d.fecha ?? d.vencimiento ?? d.fecha_de_vencimiento ?? d.fecha_cita ?? d.fecha_de_la_cita ?? d.cita ?? d.dia ?? '';
  const fecha = crudaFecha ? leerFecha(crudaFecha, ahora, timezone) : null;
  if (!fecha) return null;
  const crudaHora = d.hora ?? d.hora_cita ?? d.hora_de_la_cita ?? '';
  const hora = /^\d{1,2}:\d{2}$/.test(crudaHora.trim()) ? crudaHora.trim().padStart(5, '0') : crudaHora ? leerHora(crudaHora) : null;
  const instante = instanteEn(fecha, hora, timezone);
  return instante ? new Date(instante.getTime() - e.minutos * 60_000) : null;
}

export interface Composicion {
  mensaje: MensajeSalida | null;
  patch: PatchPersona;
  /** En palabras, para la bitacora y la pantalla. */
  que: string;
}

/**
 * Lo que toca desde el paso `desde`: los avisos se juntan al mensaje, una
 * espera ya cumplida se salta, y se para en la primera pregunta (o al final).
 * `prefijo` es lo que va delante (el «gracias» del paso anterior).
 */
export function componer(proceso: Proceso, persona: PersonaProceso, desde: number, prefijo: string, ctx: { negocio: string; ahora: Date; timezone: string; estadoFin?: 'completada' | 'rechazo' | 'sin_respuesta' }): Composicion {
  const r = (t?: string) => rellenar(t, persona, proceso, ctx.negocio);
  let cuerpo = prefijo;
  for (let i = desde; i < proceso.pasos.length; i++) {
    const paso = proceso.pasos[i]!;
    if (paso.tipo === 'aviso') {
      cuerpo = unir(cuerpo, r(paso.texto));
      continue;
    }
    if (paso.tipo === 'esperar') {
      const hasta = objetivoEspera(paso, persona, ctx.ahora, ctx.timezone);
      if (hasta && hasta.getTime() > ctx.ahora.getTime()) {
        return {
          mensaje: cuerpo ? { body: cuerpo } : null,
          patch: { estado: 'programada', paso: i, intentos: 0, fallos: 0, sub: null, proximoAt: hasta, ultimo: `programada: sigue el ${hasta.toLocaleDateString('es-PE', { timeZone: ctx.timezone })} a las ${horaCorta(hasta, ctx.timezone)}` },
          que: `espera hasta el ${hasta.toLocaleDateString('es-PE', { timeZone: ctx.timezone })} a las ${horaCorta(hasta, ctx.timezone)}`,
        };
      }
      continue;
    }
    if (paso.tipo === 'persona') {
      return {
        mensaje: { body: unir(cuerpo, r(paso.texto || proceso.cierre.persona)) },
        patch: { estado: 'persona', paso: i, proximoAt: null, sub: null, motivo: paso.titulo ? `el proceso lo pasa a una persona: ${paso.titulo}` : 'el proceso lo pasa a una persona', ultimo: 'pasó a una persona' },
        que: 'pasa a una persona',
      };
    }
    // pedir, confirmar, avance: la pregunta.
    const conSub = { ...persona, sub: null };
    return {
      mensaje: { body: unir(cuerpo, r(paso.texto)), botones: botonesDe(paso, conSub), pedirUbicacion: paso.tipo === 'pedir' && paso.dato === 'ubicacion' },
      patch: { estado: 'esperando', paso: i, intentos: 1, fallos: 0, sub: null, ultimoEnvioAt: ctx.ahora, proximoAt: new Date(ctx.ahora.getTime() + paso.insistir.cadaMin * 60_000), ultimo: `se le escribió: ${paso.titulo || 'paso ' + (i + 1)}` },
      que: `se le pide: ${paso.titulo || 'paso ' + (i + 1)}`,
    };
  }
  // Se acabaron los pasos.
  const estado = ctx.estadoFin ?? 'completada';
  const fin = estado === 'completada' ? r(proceso.cierre.fin) : '';
  const cuerpoFin = unir(cuerpo, fin);
  return {
    mensaje: cuerpoFin ? { body: cuerpoFin } : null,
    patch: { estado, paso: proceso.pasos.length, proximoAt: null, sub: null, terminadaAt: ctx.ahora, ultimo: estado === 'completada' ? 'completó el proceso' : estado === 'rechazo' ? 'dijo que no' : 'no respondió' },
    que: estado === 'completada' ? 'completó el proceso' : estado === 'rechazo' ? 'dijo que no' : 'no respondió',
  };
}

/** Aplica una salida (seguir, terminar, pasar a una persona) desde el paso actual. */
export function aplicarSalida(salida: Salida, proceso: Proceso, persona: PersonaProceso, prefijo: string, ctx: { negocio: string; ahora: Date; timezone: string; estadoFin?: 'completada' | 'rechazo' | 'sin_respuesta'; motivo?: string }): Composicion {
  if (salida === 'persona') {
    const texto = rellenar(proceso.cierre.persona, persona, proceso, ctx.negocio);
    const cuerpo = unir(prefijo, texto);
    return { mensaje: cuerpo ? { body: cuerpo } : null, patch: { estado: 'persona', proximoAt: null, sub: null, motivo: ctx.motivo ?? 'el proceso lo pasa a una persona', ultimo: 'pasó a una persona' }, que: 'pasa a una persona' };
  }
  const desde = salida === 'fin' ? proceso.pasos.length : persona.paso + 1;
  return componer(proceso, persona, desde, prefijo, ctx);
}

/** Manda un mensaje del proceso por el sender de siempre (con botones o boton de ubicacion si los lleva). */
export function mandar(sender: Sender, phone: string, m: MensajeSalida, origen: 'sistema' | 'ia' = 'sistema'): Promise<SendOutcome> {
  if (m.botones?.length) return sender.send({ phone, kind: 'interactive', category: 'UTILITY', origen, interactive: { body: m.body, buttons: m.botones } });
  if (m.pedirUbicacion) return sender.send({ phone, kind: 'interactive', category: 'UTILITY', origen, interactive: { body: m.body, locationRequest: true } });
  return sender.send({ phone, kind: 'freeform', category: 'UTILITY', origen, text: m.body });
}

// ------------------------------------------------------------ lo que manda el motor

export interface ResultadoEnvio {
  accion: 'envio' | 'cambio' | 'nada' | 'frenado';
  motivo?: string;
  /** Era un numero de prueba: no gasto el ritmo del numero real. */
  dePrueba?: boolean;
  retryAfterMs?: number;
}

/** Lo que dice un envio que no salio, para la persona que mira la corrida. */
function explicarBloqueo(code: string, reason: string): { estado: 'error' | 'persona' | null; motivo: string } {
  if (code === 'opt_out') return { estado: 'error', motivo: 'Se dio de baja: no se le vuelve a escribir. Si quiere seguir, que escriba ALTA.' };
  if (code === 'window_closed') return { estado: 'persona', motivo: 'Con la API oficial de Meta, a quien no escribió en las últimas 24 horas solo se le puede escribir con una plantilla aprobada. Escríbele desde Chats o pídele que te escriba primero.' };
  if (code === 'no_opt_in') return { estado: 'persona', motivo: 'No hay constancia de que aceptó recibir mensajes. Regístralo en su chat y pulsa «Pedir ahora».' };
  if (code === 'contact_suppressed') return { estado: 'error', motivo: `No se le puede escribir ahora: ${reason}` };
  return { estado: null, motivo: reason };
}

/**
 * Manda lo que le toca a una persona (la eligio el motor: su hora llego).
 * El ritmo, el horario y la salud del numero ya los miro el motor.
 */
export async function enviarLoQueToca(deps: DepsNucleo, persona: PersonaProceso, proceso: Proceso): Promise<ResultadoEnvio> {
  const repo = repoDe(deps);
  const ahora = deps.ahora?.() ?? new Date();
  const tz = deps.timezone ?? 'America/Lima';
  const negocio = deps.nombreNegocio();
  const ctx = { negocio, ahora, timezone: tz };
  const dePrueba = esNumeroDePrueba(persona.phone);
  const paso = proceso.pasos[persona.paso];

  let comp: Composicion;
  let tipo = 'envio';
  if (persona.estado === 'pendiente') {
    comp = componer(proceso, persona, persona.paso, '', ctx);
  } else if (persona.estado === 'programada') {
    comp = componer(proceso, persona, persona.paso + 1, '', ctx);
  } else if (persona.estado === 'esperando' && paso) {
    if (persona.intentos <= paso.insistir.veces) {
      tipo = 'insistencia';
      const cuerpo = unir('Te escribimos de nuevo por si no viste nuestro mensaje anterior.', rellenar(persona.sub === 'reprogramando' ? paso.textoReprogramar : paso.texto, persona, proceso, negocio));
      comp = {
        mensaje: { body: cuerpo, botones: botonesDe(paso, persona), pedirUbicacion: paso.tipo === 'pedir' && paso.dato === 'ubicacion' },
        patch: { intentos: persona.intentos + 1, ultimoEnvioAt: ahora, proximoAt: new Date(ahora.getTime() + paso.insistir.cadaMin * 60_000), ultimo: `se le insistió (${persona.intentos + 1} de ${paso.insistir.veces + 1})` },
        que: `insistencia ${persona.intentos} de ${paso.insistir.veces}`,
      };
    } else {
      // Sin respuesta despues de todas las insistencias.
      tipo = 'sin_respuesta';
      const n = persona.intentos;
      const motivo = `No respondió a ${n} mensaje${n === 1 ? '' : 's'} (${paso.titulo || 'paso ' + (persona.paso + 1)}).`;
      if (paso.sinRespuesta === 'persona') comp = { mensaje: null, patch: { estado: 'persona', proximoAt: null, motivo, ultimo: 'no respondió: pasa a una persona' }, que: 'no respondió: pasa a una persona' };
      else if (paso.sinRespuesta === 'fin') comp = { mensaje: null, patch: { estado: 'sin_respuesta', proximoAt: null, terminadaAt: ahora, motivo, ultimo: 'no respondió' }, que: 'no respondió: se cierra' };
      else comp = componer(proceso, persona, persona.paso + 1, '', ctx);
    }
  } else {
    return { accion: 'nada', motivo: 'no le toca nada' };
  }

  if (!comp.mensaje) {
    await repo.actualizarPersona(persona.id, comp.patch);
    await repo.registrarEvento(persona.id, tipo === 'sin_respuesta' ? 'sin_respuesta' : 'paso', comp.que);
    return { accion: 'cambio', dePrueba };
  }

  const salida = await mandar(deps.sender, persona.phone!, comp.mensaje).catch((error: unknown) => ({ ok: false as const, blocked: false as const, error: error instanceof Error ? error.message : String(error), retryable: true, deliveryId: null }));
  if (salida.ok) {
    await repo.actualizarPersona(persona.id, comp.patch);
    await repo.registrarEvento(persona.id, tipo === 'insistencia' ? 'insistencia' : 'envio', comp.que);
    return { accion: 'envio', dePrueba };
  }
  if (salida.blocked) {
    if (salida.code === 'sin_conexion' || salida.code === 'rhythm' || salida.code === 'daily_cap' || salida.code === 'contact_spacing' || salida.code === 'contact_daily_cap' || salida.code === 'number_paused') {
      const espera = salida.retryAfterMs ?? 5 * 60_000;
      await repo.actualizarPersona(persona.id, { proximoAt: new Date(ahora.getTime() + espera), ultimo: `esperando su turno: ${salida.reason}` });
      return { accion: 'frenado', motivo: salida.reason, retryAfterMs: espera };
    }
    const b = explicarBloqueo(salida.code, salida.reason);
    if (b.estado) {
      await repo.actualizarPersona(persona.id, { estado: b.estado, proximoAt: null, motivo: b.motivo, ultimo: b.estado === 'error' ? 'no se le puede escribir' : 'pasa a una persona' });
      await repo.registrarEvento(persona.id, 'incidencia', b.motivo);
      return { accion: 'cambio', motivo: b.motivo };
    }
    const espera = salida.retryAfterMs ?? 15 * 60_000;
    await repo.actualizarPersona(persona.id, { proximoAt: new Date(ahora.getTime() + espera), ultimo: `esperando su turno: ${salida.reason}` });
    return { accion: 'frenado', motivo: salida.reason, retryAfterMs: espera };
  }
  // Error de WhatsApp.
  if (salida.retryable) {
    await repo.actualizarPersona(persona.id, { proximoAt: new Date(ahora.getTime() + 3 * 60_000), ultimo: `WhatsApp no pudo enviar, se reintenta: ${salida.error.slice(0, 160)}` });
    return { accion: 'frenado', motivo: salida.error };
  }
  const sinWhatsapp = /131026|no tiene whatsapp|not a whatsapp|invalid.*(number|phone)/i.test(salida.error);
  const motivo = sinWhatsapp ? 'El número no tiene WhatsApp. Corrígelo en la lista.' : `WhatsApp rechazó el mensaje: ${salida.error.slice(0, 200)}`;
  await repo.actualizarPersona(persona.id, { estado: 'error', proximoAt: null, motivo, ultimo: 'no se le puede escribir' });
  await repo.registrarEvento(persona.id, 'incidencia', motivo);
  return { accion: 'cambio', motivo };
}

// ------------------------------------------------------------ lo que responde la persona

/** «ok», «gracias», «ahorita te la mando»: no es la respuesta, pero tampoco hay que contestarle nada. */
const CORTESIA = /^(ok|oka|okey|okay|ya|listo|dale|claro|bueno|va|vale|gracias|muchas gracias|ok gracias|ya gracias|perfecto|entendido|de acuerdo|hola|holi|buenas|buenos dias|buenas tardes|buenas noches|un momento|un ratito|ahorita|en un rato|mas tarde|ahora te (la|lo) (mando|envio|paso)|ahorita te (la|lo) (mando|envio|paso)|ya te (la|lo) (mando|envio|paso)|te (la|lo) (mando|envio|paso) (luego|ahorita|en un rato))[.!\s]*$/;

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!]/g, ' ').replace(/\s+/g, ' ').trim();

export interface ResultadoEntrante {
  /** El proceso se quedo con el mensaje: el manejador no sigue con nada mas. */
  atendida: boolean;
  /** Que se hizo, en palabras (pruebas y bitacora). */
  que?: string;
}

/**
 * Las palabras de lo que se esta pidiendo: «ya pagué» es una consulta ajena
 * para las entregas, pero es la respuesta misma en una cobranza. Si el mensaje
 * habla de lo que el paso pide, esta dentro del tramite.
 */
function hablaDelPaso(texto: string, paso: Paso | undefined): boolean {
  if (!paso) return false;
  const t = sinTildes(texto);
  const dato = paso.tipo === 'pedir' ? paso.dato : null;
  if (dato === 'captura_pago') return /\b(pag\w*|yape\w*|plin|transferi\w*|deposit\w*|comprobante|voucher|captura|boleta|recibo|abon\w*)\b/.test(t);
  if (dato === 'documento_identidad') return /\b(dni|ruc|carne|documento|identidad)\b/.test(t);
  if (dato === 'ubicacion' || dato === 'direccion') return /\b(ubicacion|direccion|pin|mapa|casa|domicilio)\b/.test(t);
  if (dato === 'foto' || dato === 'documento') return /\b(foto|documento|archivo|pdf|imagen)\b/.test(t);
  if (paso.tipo === 'confirmar' || dato === 'fecha_hora') return /\b(cita|fecha|hora|turno|dia|reprogram\w*|asistir|ir)\b/.test(t);
  if (paso.tipo === 'avance') return /\b(tarea|trabajo|visita|llegu\w*|termin\w*|direccion)\b/.test(t);
  return false;
}

async function clasificarMensaje(deps: DepsNucleo, texto: string, proceso: Proceso, paso: Paso | undefined): Promise<{ clase: ClaseOperativa | null; como: string }> {
  if (!texto.trim()) return { clase: null, como: 'reglas' };
  if (detectarManipulacion(texto)) return { clase: 'ajena', como: 'reglas' };
  const reglas = clasificarPorReglas(texto);
  if (reglas === 'ajena' && hablaDelPaso(texto, paso)) return { clase: 'flujo', como: 'reglas' };
  if (reglas) return { clase: reglas, como: 'reglas' };
  if (!deps.clasificar) return { clase: null, como: 'reglas' };
  try {
    const cruda = await deps.clasificar([
      { role: 'system', content: promptClasificadorProceso(proceso.nombre, quePide(paso), deps.nombreNegocio()) },
      { role: 'user', content: texto.slice(0, 600) },
    ]);
    return { clase: leerClase(cruda), como: 'ia' };
  } catch (error) {
    deps.log?.('el agente no pudo preguntarle al modelo: deciden las reglas', { detalle: error instanceof Error ? error.message : String(error) });
    return { clase: null, como: 'reglas' };
  }
}

/**
 * Lo que escribe una persona que tiene una corrida viva. Devuelve
 * `atendida: false` si no tiene ninguna (el mensaje sigue su camino).
 */
export async function atenderEntrante(deps: DepsNucleo, phone: string, entrada: EntradaProceso): Promise<ResultadoEntrante> {
  const repo = deps.repos.procesos;
  if (!repo) return { atendida: false };
  const ahora = deps.ahora?.() ?? new Date();
  const tz = deps.timezone ?? 'America/Lima';
  const negocio = deps.nombreNegocio();
  const textoCrudo = (entrada.texto ?? '').trim();
  const loQueMando = textoCrudo || (entrada.ubicacion ? 'ubicación' : entrada.adjunto ? `(${entrada.adjunto.tipo === 'image' ? 'foto' : entrada.adjunto.tipo === 'document' ? 'documento' : entrada.adjunto.tipo})` : '');

  const persona = await repo.vivaPorTelefono(phone);
  if (!persona) {
    // Se paso a una persona hace poco: el chat es suyo, el sistema no contesta.
    const ultima = await repo.ultimaPorTelefono(phone);
    if (ultima && ultima.estado === 'persona' && ahora.getTime() - ultima.updatedAt.getTime() < PERSONA_VIGENTE_MS && (await repo.corrida(ultima.corridaId))?.estado !== 'terminada') {
      await repo.registrarEvento(ultima.id, 'respuesta', `escribió con el chat en manos de una persona: "${loQueMando.slice(0, 200)}"`);
      return { atendida: true, que: 'en manos de una persona' };
    }
    return { atendida: false };
  }
  const proceso = await repo.proceso(persona.procesoId);
  if (!proceso) return { atendida: false };
  const paso = proceso.pasos[persona.paso];
  const ctx = { negocio, ahora, timezone: tz };
  const r = (t?: string) => rellenar(t, persona, proceso, negocio);

  await repo.registrarEvento(persona.id, 'respuesta', `respondió: "${loQueMando.slice(0, 300)}"`);

  /** Contesta (un mensaje) y guarda el cambio. */
  const terminar = async (comp: Composicion, origen: 'sistema' | 'ia' = 'sistema', extra: PatchPersona = {}): Promise<ResultadoEntrante> => {
    await repo.actualizarPersona(persona.id, { ...extra, ...comp.patch });
    if (comp.mensaje) await mandar(deps.sender, phone, comp.mensaje, origen).catch((error) => deps.log?.('no se pudo contestar en el proceso', { detalle: String(error) }));
    await repo.registrarEvento(persona.id, 'paso', comp.que);
    return { atendida: true, que: comp.que };
  };
  const guardar = (clave: string, valor: string, como: string, extraResp?: Respuesta['extra']): Record<string, Respuesta> => ({
    ...persona.respuestas,
    [clave]: { valor, texto: loQueMando.slice(0, 500), en: ahora.toISOString(), como, ...(extraResp ? { extra: extraResp } : {}) },
  });
  /** Consulta ajena: el cierre, una vez, y a una persona. */
  const ajena = (comoSeLeyo: string) =>
    terminar(
      { mensaje: { body: r(proceso.cierre.ajena) || r(proceso.cierre.persona) || 'Tu consulta la ve una persona del equipo y te escribe por aquí.' }, patch: { estado: 'persona', proximoAt: null, motivo: `Consulta que no es de este proceso: "${loQueMando.slice(0, 160)}"`, ultimo: 'consulta ajena: pasa a una persona' }, que: `consulta ajena (${comoSeLeyo}): pasa a una persona` },
      'ia',
    );

  // --- programada (o un paso que no espera respuesta): nada que leer --------
  if (persona.estado === 'programada' || !paso || (paso.tipo !== 'pedir' && paso.tipo !== 'confirmar' && paso.tipo !== 'avance')) {
    if (!textoCrudo || CORTESIA.test(sinTildes(textoCrudo))) return { atendida: true, que: 'cortesía: no se contesta' };
    const { clase, como } = await clasificarMensaje(deps, textoCrudo, proceso, paso);
    if (clase === 'ajena') return ajena(como);
    // Cambia de planes o pregunta algo del tramite: lo ve una persona.
    return terminar(aplicarSalida('persona', proceso, persona, '', { ...ctx, motivo: `Escribió mientras esperaba: "${loQueMando.slice(0, 160)}"` }));
  }

  /** No se entendio: se explica, se vuelve a pedir o, a la tercera, a una persona. */
  const noValida = async (motivo: string): Promise<ResultadoEntrante> => {
    const { clase, como } = await clasificarMensaje(deps, textoCrudo, proceso, paso);
    if (clase === 'ajena') return ajena(como);
    if (clase === 'por_que') {
      const porQue = r(paso.porQue) || (paso.tipo === 'pedir' ? POR_QUE_DEFECTO[paso.dato ?? 'texto'] : 'Lo necesitamos para completar este trámite.');
      const pregunta = persona.sub === 'reprogramando' ? r(paso.textoReprogramar) : r(paso.texto);
      return terminar(
        { mensaje: { body: unir(porQue, pregunta), botones: botonesDe(paso, persona), pedirUbicacion: paso.tipo === 'pedir' && paso.dato === 'ubicacion' }, patch: { proximoAt: new Date(ahora.getTime() + paso.insistir.cadaMin * 60_000), ultimo: 'preguntó por qué: se le explicó' }, que: `preguntó por qué (${como}): se le explicó y se le volvió a pedir` },
        'ia',
      );
    }
    if (!entrada.adjunto && !entrada.ubicacion && CORTESIA.test(sinTildes(textoCrudo))) return { atendida: true, que: 'cortesía: no se contesta' };
    const fallos = persona.fallos + 1;
    if (fallos >= MAX_FALLOS) {
      return terminar(aplicarSalida('persona', proceso, persona, '', { ...ctx, motivo: `No se pudo leer su respuesta ${fallos} veces (${motivo}).` }), 'sistema', { fallos });
    }
    const aviso = persona.sub === 'reprogramando' ? 'No pude leer la fecha. Escríbela así: 26/09 a las 10:00.' : r(paso.siNoEntiende) || noEntiendeDefecto(paso);
    return terminar({ mensaje: { body: aviso, botones: botonesDe(paso, persona), pedirUbicacion: paso.tipo === 'pedir' && paso.dato === 'ubicacion' }, patch: { fallos, proximoAt: new Date(ahora.getTime() + paso.insistir.cadaMin * 60_000), ultimo: `respuesta que no vale: ${motivo}` }, que: `no vale (${motivo}): se le volvió a pedir` });
  };

  // --- pedir un dato ----------------------------------------------------------
  if (paso.tipo === 'pedir') {
    const dato = paso.dato ?? 'texto';
    const lectura = leerDato(dato, entrada, { ahora, timezone: tz, distritos: deps.distritos });
    // Un texto libre acepta casi todo: antes, que no sea un «¿por qué?» ni otra consulta.
    if (lectura.ok && dato === 'texto' && !entrada.adjunto) {
      const reglas = detectarManipulacion(textoCrudo) ? 'ajena' : clasificarPorReglas(textoCrudo);
      if (reglas === 'ajena' || reglas === 'por_que') return noValida('no responde lo que se le pidió');
    }
    if (!lectura.ok) return noValida(lectura.motivo);
    const respuestas = guardar(paso.id, lectura.valor, 'reglas', lectura.extra);
    const actual = { ...persona, respuestas };
    const comp = aplicarSalida(paso.alResponder ?? 'siguiente', proceso, actual, r(paso.gracias), { ...ctx, motivo: `Respondió ${paso.titulo ? `«${paso.titulo}»` : 'el paso'}: revisarlo.` });
    return terminar(comp, 'sistema', { respuestas, fallos: 0 });
  }

  // --- confirmar SI / NO / reprogramar ----------------------------------------
  if (paso.tipo === 'confirmar') {
    if (persona.sub === 'reprogramando') {
      const lectura = leerDato('fecha_hora', entrada, { ahora, timezone: tz });
      if (!lectura.ok) {
        const d = leerDecision(entrada);
        if (d.decision === 'no') {
          const respuestas = guardar(paso.id, 'no', d.como);
          return terminar(aplicarSalida(paso.no ?? 'fin', proceso, { ...persona, respuestas }, r(paso.textoNo), { ...ctx, estadoFin: 'rechazo' }), 'sistema', { respuestas, sub: null });
        }
        return noValida(lectura.motivo);
      }
      const datos = { ...persona.datos };
      if (lectura.extra?.fecha) datos.fecha = String(lectura.extra.fecha).split('-').reverse().join('/');
      if (lectura.extra?.hora) datos.hora = String(lectura.extra.hora);
      const respuestas = guardar(paso.id, 'reprogramada', 'reglas', { nuevaFecha: lectura.valor });
      const actual = { ...persona, datos, respuestas, sub: null };
      const listo = rellenarTexto('Listo, {nombre}: queda para el {fecha} a las {hora}.', { nombre: persona.nombre, negocio, datos });
      return terminar(aplicarSalida('siguiente', proceso, actual, listo, ctx), 'sistema', { datos, respuestas, sub: null, fallos: 0 });
    }
    const d = leerDecision(entrada);
    if (d.decision === 'si') {
      const respuestas = guardar(paso.id, 'si', d.como);
      return terminar(aplicarSalida(paso.si ?? 'siguiente', proceso, { ...persona, respuestas }, r(paso.gracias), { ...ctx, motivo: 'Confirmó: revisarlo.' }), 'sistema', { respuestas, fallos: 0 });
    }
    if (d.decision === 'no') {
      const respuestas = guardar(paso.id, 'no', d.como);
      return terminar(aplicarSalida(paso.no ?? 'fin', proceso, { ...persona, respuestas }, r(paso.textoNo), { ...ctx, estadoFin: 'rechazo', motivo: 'Dijo que no: revisarlo.' }), 'sistema', { respuestas, fallos: 0 });
    }
    if (d.decision === 'reprogramar' && paso.reprogramar && paso.reprogramar !== 'no') {
      const respuestas = guardar(paso.id, 'reprogramar', d.como);
      if (paso.reprogramar === 'persona') {
        return terminar(aplicarSalida('persona', proceso, { ...persona, respuestas }, r(paso.textoReprogramar), { ...ctx, motivo: 'Quiere reprogramar: coordinar la nueva fecha.' }), 'sistema', { respuestas });
      }
      // Pide la fecha en el mismo mensaje en que la da: «reprogramar para el 26 a las 10».
      const fechaYa = leerDato('fecha_hora', entrada, { ahora, timezone: tz });
      if (fechaYa.ok && fechaYa.extra?.fecha) {
        const datos = { ...persona.datos, fecha: String(fechaYa.extra.fecha).split('-').reverse().join('/'), ...(fechaYa.extra.hora ? { hora: String(fechaYa.extra.hora) } : {}) };
        const actual = { ...persona, datos, respuestas };
        const listo = rellenarTexto('Listo, {nombre}: queda para el {fecha} a las {hora}.', { nombre: persona.nombre, negocio, datos });
        return terminar(aplicarSalida('siguiente', proceso, actual, listo, ctx), 'sistema', { datos, respuestas, sub: null, fallos: 0 });
      }
      return terminar({ mensaje: { body: r(paso.textoReprogramar) || '¿Qué día y a qué hora te acomoda? Escríbelo así: 26/09 a las 10:00.' }, patch: { sub: 'reprogramando', fallos: 0, proximoAt: new Date(ahora.getTime() + paso.insistir.cadaMin * 60_000), ultimo: 'quiere reprogramar: se le pidió la nueva fecha' }, que: 'quiere reprogramar: se le pide la nueva fecha' }, 'sistema', { respuestas });
    }
    return noValida('no dijo SÍ ni NO');
  }

  // --- avance del personal de campo -------------------------------------------
  const a = leerAvance(entrada);
  if (a.avance === 'llego') {
    const respuestas = guardar(paso.id, 'llego', a.como, { llego: ahora.toISOString() });
    return terminar(
      { mensaje: { body: unir(r(paso.gracias) || 'Anotado.', `Llegaste a las ${horaCorta(ahora, tz)}. Al terminar responde TERMINÉ (o NO PUDE si algo impide hacerla).`), botones: botonesDe(paso, { id: persona.id, sub: 'llego' }) }, patch: { sub: 'llego', intentos: 1, fallos: 0, proximoAt: new Date(ahora.getTime() + paso.insistir.cadaMin * 2 * 60_000), ultimo: `llegó a las ${horaCorta(ahora, tz)}` }, que: 'avisó que llegó' },
      'sistema',
      { respuestas },
    );
  }
  if (a.avance === 'termino') {
    const llego = persona.respuestas[paso.id]?.extra?.llego ?? null;
    const respuestas = guardar(paso.id, 'termino', a.como, { llego, termino: ahora.toISOString() });
    return terminar(aplicarSalida('siguiente', proceso, { ...persona, respuestas }, r(paso.gracias), ctx), 'sistema', { respuestas, fallos: 0 });
  }
  if (a.avance === 'no_pudo') {
    const respuestas = guardar(paso.id, 'no_pudo', a.como, { llego: persona.respuestas[paso.id]?.extra?.llego ?? null });
    return terminar(aplicarSalida(paso.noPudo ?? 'persona', proceso, { ...persona, respuestas }, '', { ...ctx, estadoFin: 'rechazo', motivo: `Dijo que no pudo: "${loQueMando.slice(0, 160)}"` }), 'sistema', { respuestas, fallos: 0 });
  }
  return noValida('no dijo si llegó, terminó o no pudo');
}
