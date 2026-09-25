/**
 * Que es un proceso, en datos.
 *
 * Un PROCESO es un nombre, unos pasos, un ritmo y un cierre: «pedirle a cada
 * persona su DNI y su ubicacion», «confirmar las citas de mañana y recordarlas
 * dos horas antes», «avisarle a cada tecnico su tarea y saber cuando llego y
 * cuando termino», «recordar un pago y recibir la captura».
 *
 * Una CORRIDA es un proceso aplicado a una lista de personas (subida por Excel
 * o CSV, pegada, o por la API). Cada persona de la corrida va por los pasos a
 * su ritmo: en que paso esta, cuantas veces se le escribio, que respondio.
 *
 * Tipos de paso:
 *  - pedir: un dato (ubicacion, texto, direccion, numero, DNI/CE/RUC, fecha u
 *    hora, foto, documento, captura de pago), validado al llegar;
 *  - confirmar: SI o NO, con «reprogramar» como tercera salida;
 *  - avance: lo del personal de campo, «llegué», «terminé», «no pude»;
 *  - aviso: un mensaje que no espera respuesta;
 *  - esperar: hasta una fecha u hora (antes de la cita, o unos minutos);
 *  - persona: pasar la conversacion a una persona.
 *
 * Los textos que se le mandan a la gente son SIEMPRE los del proceso: la IA
 * solo clasifica lo que llega (ver src/ia/agente-operativo.ts).
 */

import { z } from 'zod';

export type TipoPaso = 'pedir' | 'confirmar' | 'avance' | 'aviso' | 'esperar' | 'persona';
export type TipoDato = 'ubicacion' | 'texto' | 'direccion' | 'numero' | 'documento_identidad' | 'fecha_hora' | 'foto' | 'documento' | 'captura_pago';
/** Que pasa despues: seguir con el paso siguiente, terminar, o pasarlo a una persona. */
export type Salida = 'siguiente' | 'fin' | 'persona';

export const TIPOS_PASO: TipoPaso[] = ['pedir', 'confirmar', 'avance', 'aviso', 'esperar', 'persona'];
export const TIPOS_DATO: TipoDato[] = ['ubicacion', 'texto', 'direccion', 'numero', 'documento_identidad', 'fecha_hora', 'foto', 'documento', 'captura_pago'];

/** Como se llama cada cosa en la pantalla (nada de nombres internos). */
export const NOMBRE_TIPO_PASO: Record<TipoPaso, string> = {
  pedir: 'Pedir un dato',
  confirmar: 'Confirmar SÍ o NO',
  avance: 'Avance del personal (llegué, terminé, no pude)',
  aviso: 'Aviso sin respuesta',
  esperar: 'Esperar hasta una fecha u hora',
  persona: 'Pasar a una persona',
};

export const NOMBRE_TIPO_DATO: Record<TipoDato, string> = {
  ubicacion: 'Ubicación (pin o enlace de mapa)',
  texto: 'Texto libre',
  direccion: 'Dirección escrita',
  numero: 'Número o monto',
  documento_identidad: 'DNI, carné de extranjería o RUC',
  fecha_hora: 'Fecha u hora',
  foto: 'Foto',
  documento: 'Documento o foto (PDF, Word, imagen)',
  captura_pago: 'Captura o foto del pago',
};

export const NOMBRE_SALIDA: Record<Salida, string> = {
  siguiente: 'Seguir con el paso siguiente',
  fin: 'Terminar el proceso',
  persona: 'Pasar a una persona',
};

export interface Insistir {
  /** Cuantas veces se vuelve a escribir si no responde (0 = ninguna). */
  veces: number;
  /** Cada cuantos minutos. */
  cadaMin: number;
}

export interface Paso {
  id: string;
  tipo: TipoPaso;
  /** Como se llama el paso en la pantalla ("Pedir el DNI"). */
  titulo: string;
  /** Lo que se le manda, con variables: {nombre}, {negocio}, {fecha}... */
  texto: string;
  /** pedir: que dato. */
  dato?: TipoDato;
  /** Lo que se contesta si pregunta «¿por qué?» o «¿para qué?». */
  porQue?: string;
  /** Lo que se contesta si lo que mando no vale (un DNI de 6 digitos, un texto en vez del pin). */
  siNoEntiende?: string;
  /** Lo que se dice al recibir una respuesta valida (va pegado a lo que sigue: un solo mensaje). */
  gracias?: string;
  /** pedir: que pasa al recibirlo. */
  alResponder?: Salida;
  /** confirmar: que pasa con un SI y con un NO. */
  si?: Salida;
  no?: Salida;
  /** confirmar: lo que se contesta al NO (antes de lo que sigue). */
  textoNo?: string;
  /** confirmar: la tercera salida. pedir_fecha = se le pide la nueva fecha y hora y se sigue. */
  reprogramar?: 'pedir_fecha' | 'persona' | 'no';
  textoReprogramar?: string;
  /** avance: que pasa con un «no pude». */
  noPudo?: Salida;
  /** esperar: antes de la fecha y hora de la persona (sus columnas fecha y hora) o unos minutos sin mas. */
  esperar?: { como: 'antes_de_la_cita' | 'minutos'; minutos: number };
  insistir: Insistir;
  /** Que pasa si no responde despues de todas las insistencias. */
  sinRespuesta: Salida;
}

export interface Ritmo {
  /** Franja del dia en la que este proceso escribe, "HH:MM" (dentro del horario general del numero). */
  desde: string;
  hasta: string;
}

export interface Cierre {
  /** Al terminar todos los pasos (vacio = nada). */
  fin: string;
  /** Ante una consulta que no es de este proceso: se manda UNA vez y pasa a una persona. */
  ajena: string;
  /** Al pasar la conversacion a una persona. */
  persona: string;
}

export type EstadoProceso = 'activo' | 'pausado' | 'archivado';
/** La plantilla de la que salio (null = hecho a mano). */
export type PlantillaId = 'datos' | 'confirmaciones' | 'campo' | 'cobranza' | 'gsg';

export interface Proceso {
  id: number;
  nombre: string;
  plantilla: PlantillaId | null;
  descripcion: string;
  pasos: Paso[];
  ritmo: Ritmo;
  cierre: Cierre;
  estado: EstadoProceso;
  createdAt: Date;
  updatedAt: Date;
}

export type EstadoCorrida = 'activa' | 'pausada' | 'terminada';

export interface Corrida {
  id: number;
  procesoId: number;
  nombre: string;
  estado: EstadoCorrida;
  /** De donde vino la lista: excel, csv, pegada, api, prueba. */
  origen: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * En que punto esta cada persona. Las tres primeras son «vivas»: todavia le
 * toca algo. `persona` = la atiende alguien del equipo.
 */
export type EstadoPersona = 'pendiente' | 'esperando' | 'programada' | 'persona' | 'completada' | 'sin_respuesta' | 'rechazo' | 'cancelada' | 'error';

export const ESTADOS_PERSONA: EstadoPersona[] = ['pendiente', 'esperando', 'programada', 'persona', 'completada', 'sin_respuesta', 'rechazo', 'cancelada', 'error'];
export const ESTADOS_VIVOS: EstadoPersona[] = ['pendiente', 'esperando', 'programada'];

/** Lo que respondio en un paso. */
export interface Respuesta {
  /** El valor ya leido: "12345678", "si", "llego", "-12.1,-77.0"... */
  valor: string;
  /** Lo que escribio tal cual (o "(foto)"). */
  texto: string;
  en: string;
  /** Como se leyo: reglas, ia, boton, persona. */
  como: string;
  /** Lo que no cabe en el valor: coordenadas, enlace del mapa, id del adjunto, tipo de documento. */
  extra?: Record<string, string | number | null>;
}

export interface PersonaProceso {
  id: number;
  corridaId: number;
  procesoId: number;
  phone: string | null;
  telefonoCrudo: string;
  nombre: string | null;
  /** Las demas columnas de la lista (fecha, hora, monto, tarea...), por nombre limpio. */
  datos: Record<string, string>;
  estado: EstadoPersona;
  /** El indice del paso en el que esta. */
  paso: number;
  /** Mensajes mandados en este paso (el primero y las insistencias). */
  intentos: number;
  /** Respuestas que no se entendieron en este paso (a la tercera, a una persona). */
  fallos: number;
  /** Un matiz del paso: 'reprogramando' (se le pidio la nueva fecha), 'llego' (el tecnico ya llego). */
  sub: string | null;
  proximoAt: Date | null;
  ultimoEnvioAt: Date | null;
  respuestas: Record<string, Respuesta>;
  /** Lo ultimo que paso, en palabras ("respondió su DNI", "no contestó a 3 mensajes"). */
  ultimo: string | null;
  /** Por que necesita a una persona, o por que no se le puede escribir. */
  motivo: string | null;
  pausada: boolean;
  createdAt: Date;
  updatedAt: Date;
  terminadaAt: Date | null;
}

export interface NuevaPersona {
  phone: string | null;
  telefonoCrudo: string;
  nombre: string | null;
  datos: Record<string, string>;
  estado?: EstadoPersona;
  motivo?: string | null;
}

export type PatchPersona = Partial<Pick<PersonaProceso, 'estado' | 'paso' | 'intentos' | 'fallos' | 'sub' | 'proximoAt' | 'ultimoEnvioAt' | 'respuestas' | 'ultimo' | 'motivo' | 'pausada' | 'terminadaAt' | 'datos' | 'nombre'>>;

// ------------------------------------------------------------ validacion

const salida = z.enum(['siguiente', 'fin', 'persona']);
const hora = z.string().trim().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'La hora va como 08:00 o 19:30.');

export const pasoSchema = z.object({
  id: z.string().trim().min(1).max(40),
  tipo: z.enum(['pedir', 'confirmar', 'avance', 'aviso', 'esperar', 'persona']),
  titulo: z.string().trim().max(120).default(''),
  texto: z.string().max(1500).default(''),
  dato: z.enum(['ubicacion', 'texto', 'direccion', 'numero', 'documento_identidad', 'fecha_hora', 'foto', 'documento', 'captura_pago']).optional(),
  porQue: z.string().max(800).optional(),
  siNoEntiende: z.string().max(800).optional(),
  gracias: z.string().max(800).optional(),
  alResponder: salida.optional(),
  si: salida.optional(),
  no: salida.optional(),
  textoNo: z.string().max(800).optional(),
  reprogramar: z.enum(['pedir_fecha', 'persona', 'no']).optional(),
  textoReprogramar: z.string().max(800).optional(),
  noPudo: salida.optional(),
  esperar: z.object({ como: z.enum(['antes_de_la_cita', 'minutos']), minutos: z.coerce.number().int().min(0).max(60 * 24 * 30) }).optional(),
  insistir: z.object({ veces: z.coerce.number().int().min(0).max(5), cadaMin: z.coerce.number().int().min(5).max(60 * 24 * 7) }).default({ veces: 2, cadaMin: 180 }),
  sinRespuesta: salida.default('persona'),
});

export const ritmoSchema = z.object({ desde: hora.default('08:00'), hasta: hora.default('20:00') });
export const cierreSchema = z.object({ fin: z.string().max(1000).default(''), ajena: z.string().max(1000).default(''), persona: z.string().max(1000).default('') });

export const procesoSchema = z.object({
  nombre: z.string().trim().min(2, 'Ponle un nombre al proceso.').max(120),
  descripcion: z.string().trim().max(500).default(''),
  pasos: z.array(pasoSchema).max(20, 'Como mucho 20 pasos por proceso.'),
  ritmo: ritmoSchema.default({ desde: '08:00', hasta: '20:00' }),
  cierre: cierreSchema.default({ fin: '', ajena: '', persona: '' }),
});

/** Lo que falta o no cuadra en los pasos, dicho para una persona. Vacio = esta bien. */
export function problemasDePasos(pasos: Paso[]): string[] {
  const problemas: string[] = [];
  const ids = new Set<string>();
  pasos.forEach((p, i) => {
    const n = `Paso ${i + 1}${p.titulo ? ` («${p.titulo}»)` : ''}`;
    if (ids.has(p.id)) problemas.push(`${n}: está repetido.`);
    ids.add(p.id);
    const conMensaje = p.tipo === 'pedir' || p.tipo === 'confirmar' || p.tipo === 'avance' || p.tipo === 'aviso';
    if (conMensaje && !p.texto.trim()) problemas.push(`${n}: falta el mensaje que se le manda.`);
    if (p.tipo === 'pedir' && !p.dato) problemas.push(`${n}: elige qué dato se pide.`);
    if (p.tipo === 'esperar' && !p.esperar) problemas.push(`${n}: di hasta cuándo se espera.`);
  });
  return problemas;
}

/** Los valores por defecto de un paso nuevo del tipo dado (lo que pone el editor al añadirlo). */
export function pasoNuevo(tipo: TipoPaso, id: string): Paso {
  const base: Paso = { id, tipo, titulo: NOMBRE_TIPO_PASO[tipo], texto: '', insistir: { veces: 2, cadaMin: 180 }, sinRespuesta: 'persona' };
  if (tipo === 'pedir') return { ...base, titulo: 'Pedir un dato', dato: 'texto', alResponder: 'siguiente' };
  if (tipo === 'confirmar') return { ...base, si: 'siguiente', no: 'fin', reprogramar: 'pedir_fecha' };
  if (tipo === 'avance') return { ...base, noPudo: 'persona', insistir: { veces: 2, cadaMin: 60 } };
  if (tipo === 'aviso') return { ...base, insistir: { veces: 0, cadaMin: 60 } };
  if (tipo === 'esperar') return { ...base, esperar: { como: 'antes_de_la_cita', minutos: 120 }, insistir: { veces: 0, cadaMin: 60 } };
  return { ...base, insistir: { veces: 0, cadaMin: 60 } };
}

// ------------------------------------------------------------ variables

const sinTildes = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** El nombre de una columna como variable: "Fecha de la cita" -> fecha_de_la_cita. */
export function claveDeColumna(nombre: string): string {
  return sinTildes(nombre)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** Las variables que se pueden usar siempre. Las columnas de la lista se suman. */
export const VARIABLES_BASE = ['{nombre}', '{negocio}'];

/**
 * Rellena un texto con los datos de la persona. Una variable que no existe
 * se quita (mejor «tu cita del  a las» que «{fecha}» en el WhatsApp de alguien):
 * por eso el editor avisa de las variables que la lista no trae.
 */
export function rellenarTexto(texto: string, ctx: { nombre?: string | null; negocio: string; datos?: Record<string, string>; extra?: Record<string, string> }): string {
  const primerNombre = (ctx.nombre ?? '').trim().split(/\s+/)[0] ?? '';
  const valores: Record<string, string> = { ...(ctx.datos ?? {}), ...(ctx.extra ?? {}), nombre: primerNombre, nombre_completo: (ctx.nombre ?? '').trim(), negocio: ctx.negocio };
  return texto
    .replace(/\{([^{}\n]{1,40})\}/g, (_, crudo: string) => valores[claveDeColumna(crudo)] ?? '')
    // Lo que quedo feo al quitar una variable vacia: dobles espacios y ", ," sueltos.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.;:!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .trim();
}

/** Las variables que usa un texto, sin llaves y limpias. */
export function variablesDe(texto: string): string[] {
  return [...new Set([...texto.matchAll(/\{([^{}\n]{1,40})\}/g)].map((m) => claveDeColumna(m[1]!)))];
}

// ------------------------------------------------------------ estados en pantalla

/** Un nombre y un color por estado de persona (los tonos del armazon). */
export const ESTADOS_PERSONA_VISUALES: Record<EstadoPersona, { nombre: string; tono: 'verde' | 'ambar' | 'rojo' | 'azul' | 'gris' }> = {
  pendiente: { nombre: 'Por escribirle', tono: 'gris' },
  esperando: { nombre: 'Esperando su respuesta', tono: 'ambar' },
  programada: { nombre: 'Programada', tono: 'azul' },
  persona: { nombre: 'Necesita a alguien', tono: 'rojo' },
  completada: { nombre: 'Completada', tono: 'verde' },
  sin_respuesta: { nombre: 'No respondió', tono: 'gris' },
  rechazo: { nombre: 'Dijo que no', tono: 'gris' },
  cancelada: { nombre: 'Cancelada', tono: 'gris' },
  error: { nombre: 'No se le puede escribir', tono: 'rojo' },
};
