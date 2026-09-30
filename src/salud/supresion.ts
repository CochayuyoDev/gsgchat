/**
 * Que hacer con un contacto cuando un envio le falla, segun el codigo.
 *
 * Insistir contra un numero que no tiene WhatsApp (131026), o contra una
 * persona a la que Meta ya no le entrega marketing (131049), no consigue
 * nada y si cuesta: cada intento fallido baja la reputacion del numero, y
 * Meta lo dice explicito para el 131049 ("wait at least 24 hours"). Por eso
 * cada codigo tiene una regla: cuanto tiempo se aparta al contacto y para
 * que (todo, o solo marketing).
 *
 * Los codigos de Meta salen de su tabla de errores; los del cliente no
 * oficial son texto y se reconocen por lo que dicen.
 */

export type AmbitoSupresion = 'todo' | 'marketing';

export interface ReglaSupresion {
  /** Codigo normalizado (131026, 403...) para la bitacora. */
  codigo: string;
  /** Hasta cuando no se le escribe. 0 = no se suprime. */
  duracionMs: number;
  ambito: AmbitoSupresion;
  /** Por que, para la ficha del contacto y la pantalla. */
  motivo: string;
  /**
   * Que le hace al numero entero, no solo al contacto:
   *  - `rojo`: pausar todo y descansar (131048, cuenta restringida, 403).
   *  - `lento`: frenar un rato (130429, 131056 repetido).
   *  - null: nada global.
   */
  global: 'rojo' | 'lento' | null;
  /** Incidencia de rutas equivalente, si aplica. */
  incidencia?: 'sin_whatsapp' | 'numero_invalido' | 'envio_bloqueado' | 'error_envio';
}

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

const REGLAS: Record<string, Omit<ReglaSupresion, 'codigo'>> = {
  // El numero no tiene WhatsApp (o no acepto los terminos nuevos). Un mes:
  // si el cliente instala WhatsApp manana, un mes despues se vuelve a
  // intentar; mientras, cada intento es un fallo mas en la estadistica.
  '131026': {
    duracionMs: 30 * DIA,
    ambito: 'todo',
    motivo: 'Meta dice que el numero no tiene WhatsApp (131026)',
    global: null,
    incidencia: 'sin_whatsapp',
  },
  // Meta limita cuanto marketing recibe una persona de TODAS las empresas.
  // Pide esperar 24 h; reintentar antes solo devuelve el mismo error y
  // "puede dejar al usuario inalcanzable hasta 24 h".
  '131049': {
    duracionMs: 26 * HORA,
    ambito: 'marketing',
    motivo: 'la persona ya recibio demasiado marketing esta semana (131049)',
    global: null,
  },
  // La persona pidio no recibir marketing de esta empresa (boton de WhatsApp).
  // Es una baja de marketing: para siempre salvo que la levante ella.
  '131050': {
    duracionMs: 365 * DIA,
    ambito: 'marketing',
    motivo: 'la persona pidio no recibir marketing de este negocio (131050)',
    global: null,
  },
  // Demasiados mensajes a la misma persona en poco tiempo.
  '131056': {
    duracionMs: 2 * HORA,
    ambito: 'todo',
    motivo: 'demasiados mensajes a esta persona en poco tiempo (131056)',
    global: 'lento',
  },
  // La empresa tiene bloqueado a este usuario: no va a salir nada.
  '130403': {
    duracionMs: 7 * DIA,
    ambito: 'todo',
    motivo: 'este numero esta bloqueado desde la cuenta (130403)',
    global: null,
  },
  // Restricciones de calidad sobre el numero: aqui el problema no es el
  // contacto, es el numero. Rojo.
  '131048': {
    duracionMs: 0,
    ambito: 'todo',
    motivo: 'Meta restringe los envios de este numero por calidad (131048)',
    global: 'rojo',
  },
  '131031': {
    duracionMs: 0,
    ambito: 'todo',
    motivo: 'la cuenta de WhatsApp Business esta restringida (131031)',
    global: 'rojo',
  },
  '368': {
    duracionMs: 0,
    ambito: 'todo',
    motivo: 'la cuenta esta bloqueada temporalmente por politicas (368)',
    global: 'rojo',
  },
  // Velocidad: se frena un rato, sin apartar a nadie.
  '130429': { duracionMs: 0, ambito: 'todo', motivo: 'limite de velocidad (130429)', global: 'lento' },
  '4': { duracionMs: 0, ambito: 'todo', motivo: 'limite de llamadas de la app (4)', global: 'lento' },
  '80007': { duracionMs: 0, ambito: 'todo', motivo: 'limite de la cuenta de negocio (80007)', global: 'lento' },
  // Numero invalido: no hay a quien escribir. Un ano es "nunca" sin decir nunca.
  '131021': {
    duracionMs: 365 * DIA,
    ambito: 'todo',
    motivo: 'el remitente y el destinatario son el mismo numero (131021)',
    global: null,
    incidencia: 'numero_invalido',
  },
  '131009': {
    duracionMs: 30 * DIA,
    ambito: 'todo',
    motivo: 'Meta rechaza el numero como parametro invalido (131009)',
    global: null,
    incidencia: 'numero_invalido',
  },
  // Cliente no oficial: el socket dice que no.
  '403': {
    duracionMs: 0,
    ambito: 'todo',
    motivo: 'WhatsApp rechazo la sesion (403): huele a baneo',
    global: 'rojo',
  },
  '429': { duracionMs: 0, ambito: 'todo', motivo: 'rate-overlimit del cliente', global: 'lento' },
};

/**
 * Saca el codigo de un error de envio.
 *
 * Con la Cloud API viene como numero; con Baileys o WAHA viene texto, y se
 * reconoce por lo que dice. `null` = no hay regla, es un error cualquiera.
 */
export function codigoDeError(codigo: string | number | null | undefined, mensaje: string): string | null {
  if (codigo !== null && codigo !== undefined && String(codigo) in REGLAS) return String(codigo);
  const texto = mensaje.toLowerCase();
  for (const c of Object.keys(REGLAS)) {
    if (new RegExp(`(^|[^0-9])${c}([^0-9]|$)`).test(texto)) return c;
  }
  if (/not.*on.*whatsapp|no.*tiene.*whatsapp|undeliverable|not_on_whatsapp|not-authorized|item-not-found/.test(texto)) {
    return '131026';
  }
  if (/rate-?overlimit|too many requests/.test(texto)) return '429';
  if (/forbidden/.test(texto)) return '403';
  return null;
}

export function reglaDeSupresion(codigo: string | number | null | undefined, mensaje = ''): ReglaSupresion | null {
  const c = codigoDeError(codigo, mensaje);
  if (!c) return null;
  const regla = REGLAS[c];
  return regla ? { codigo: c, ...regla } : null;
}

/** Si el contacto esta apartado para este envio. */
export function contactoSuprimido(
  contacto: { suprimidoHasta?: Date | null; suprimidoAmbito?: AmbitoSupresion | null },
  categoria: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION',
  ahora: Date,
): boolean {
  if (!contacto.suprimidoHasta || contacto.suprimidoHasta.getTime() <= ahora.getTime()) return false;
  if (contacto.suprimidoAmbito === 'marketing') return categoria === 'MARKETING';
  return true;
}
