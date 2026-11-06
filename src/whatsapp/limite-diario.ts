/**
 * El maximo de mensajes por dia de cada linea de WhatsApp.
 *
 * El dia es SIEMPRE el de America/Lima (sin horario de verano, UTC-5): el
 * contador de cada linea vuelve a cero a las 00:00 de Lima, ponga la zona que
 * ponga la politica de envio.
 */

export const ZONA_LIMITE = 'America/Lima';
export const MAX_LIMITE_DIARIO = 1_000_000;

const formato = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_LIMITE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** El dia de Lima de ese instante, como AAAA-MM-DD. */
export function diaLima(at: Date): string {
  return formato.format(at);
}

/** Milisegundos hasta las 00:00 de Lima (cuando vuelve a haber cupo). */
export function msHastaMedianocheLima(at: Date): number {
  // Lima es UTC-5 todo el año: la medianoche local son las 05:00 UTC.
  const desplazado = at.getTime() - 5 * 3600_000;
  const inicioDia = Math.floor(desplazado / 86_400_000) * 86_400_000;
  return inicioDia + 86_400_000 + 5 * 3600_000 - at.getTime();
}

export class LimiteInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'LimiteInvalido';
  }
}

/**
 * Lo que llega del formulario o de la API: vacio, null o 0 = sin limite;
 * un entero positivo = ese maximo. Todo lo demas (negativos, decimales,
 * texto) se rechaza con un mensaje que dice que se esperaba.
 */
export function validarLimiteDiario(valor: unknown): number {
  if (valor === undefined || valor === null) return 0;
  if (typeof valor === 'string') {
    const t = valor.trim();
    if (t === '') return 0;
    if (!/^[+-]?\d+$/.test(t)) throw new LimiteInvalido('El máximo de mensajes por día tiene que ser un número entero, sin decimales ni letras. Déjalo vacío o en 0 para no poner límite.');
    valor = Number(t);
  }
  if (typeof valor !== 'number' || !Number.isFinite(valor) || !Number.isInteger(valor)) {
    throw new LimiteInvalido('El máximo de mensajes por día tiene que ser un número entero, sin decimales. Déjalo vacío o en 0 para no poner límite.');
  }
  if (valor < 0) throw new LimiteInvalido('El máximo de mensajes por día no puede ser negativo. Déjalo vacío o en 0 para no poner límite.');
  if (valor > MAX_LIMITE_DIARIO) throw new LimiteInvalido(`El máximo de mensajes por día no puede pasar de ${MAX_LIMITE_DIARIO.toLocaleString('es-PE')}.`);
  return valor;
}

/** Por que sale un mensaje por la linea que sale. */
export type MotivoSeleccion = 'asignacion_original' | 'limite_alcanzado' | 'original_no_disponible';

export const MOTIVO_SIN_LINEAS = 'No hay números vinculados habilitados con cupo disponible';
