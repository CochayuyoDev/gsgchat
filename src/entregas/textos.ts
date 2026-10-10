/**
 * Lo que se le dice a cada uno en el flujo de entregas, y los ajustes del
 * modulo (margen, intentos, esperas), todo editable desde la pantalla.
 *
 * Los textos llevan variables entre llaves ({nombre}, {pedido}, {negocio},
 * {mapa}, {minutos}, {hora}...) y se rellenan aqui. Las cifras (minutos,
 * hora de llegada) las pone SIEMPRE el sistema: si se pide a la IA que
 * redacte, se le da el texto ya rellenado para que lo diga mas natural y se
 * comprueba que la hora siga dentro; si no, sale el texto de siempre.
 */
import { z } from 'zod';
import type { DatosEnvio } from './repo.js';
import { tieneNumeracion } from './direccion-escrita.js';
import { distritoEnDireccion } from './distritos-centro.js';
export const ajustesEntregasSchema = z.object({
  /** Minutos que se suman a lo que dice el motorizado antes de avisar al cliente. */
  margenMinutos: z.number().int().min(0).max(240).default(60),
  /** Cada cuantos minutos se vuelve a pedir la confirmacion si no contestan. */
  confirmacionEsperaMin: z.number().int().min(5).max(24 * 60).default(120),
  /** Cuantas veces se pide la confirmacion antes de darla por perdida. */
  confirmacionMaxIntentos: z.number().int().min(1).max(6).default(3),
  /**
   * El primer mensaje de un pedido que falla por algo pasajero (WhatsApp caido
   * un momento, el reparto que no cargo): cuantos reintentos automaticos, y
   * la espera antes del primero (cada siguiente espera el doble, hasta el
   * techo). Pasado el tope va a la bandeja de errores. Ver src/entregas/primer-mensaje.ts.
   */
  mensajeReintentosMax: z.number().int().min(0).max(20).default(5),
  mensajeReintentoBaseSeg: z.number().int().min(5).max(3600).default(60),
  mensajeReintentoMaxSeg: z.number().int().min(60).max(24 * 3600).default(1800),
  /** Cuantos minutos se espera a que el motorizado conteste antes de insistir o pasar a otro. */
  motorizadoEsperaMin: z.number().int().min(1).max(180).default(10),
  /** Cuantas veces se le escribe a un mismo motorizado antes de pasar el pedido a otro. */
  motorizadoMaxIntentos: z.number().int().min(1).max(5).default(2),
  /**
   * Hasta que hora del dia (de la tienda) el cliente puede cambiar la
   * ubicacion ya registrada (regla del dueño, 29/09). Despues, un pin nuevo no
   * se registra: se le pasa al motorizado y el cliente coordina con el.
   */
  cambioUbicacionHasta: z.string().regex(/^\d{2}:\d{2}$/).default('13:00'),
  /**
   * Ya no se usa: GSGchat nunca le pide nada a GSG (los pedidos llegan cuando
   * GSG los empuja). Se queda en el esquema para que un ajuste guardado de
   * antes se siga leyendo sin error.
   */
  sincronizarCadaMin: z.number().int().min(1).max(24 * 60).default(5),
  /**
   * El pin tiene que tener sentido: si cae a más de esto (km) del distrito del
   * pedido, no se da por bueno a ciegas y se le pregunta UNA vez al cliente si
   * es ahí (SÍ/NO). Sin distrito conocido, se acepta como siempre.
   */
  pinDistanciaMaxKm: z.number().min(0.5).max(100).default(3),
  /** Si la dirección escrita se busca en el mapa gratuito de OpenStreetMap (si falla, se sigue sin él). */
  buscarDireccionEnMapa: z.boolean().default(true),
  /** Minutos que se espera a que el motorizado dé sus minutos antes de pasar el pedido SOLO a otro activo. */
  reasignarMotorizadoMin: z.number().int().min(5).max(240).default(20),
  /** A esta hora ("HH:MM", reloj del negocio) los pedidos que siguen sin ubicación salen en «Hay que mirar». */
  alertaSinUbicacionHora: z.string().regex(/^\d{2}:\d{2}$/).default('12:00'),
  /** Minutos pasada la hora estimada sin «entregado» para que un pedido en camino salga en «Hay que mirar». */
  alertaEnCaminoMin: z.number().int().min(5).max(480).default(30),
  /** Si el aviso de llegada lo redacta la IA (con la hora puesta por el sistema). */
  redactarConIA: z.boolean().default(false),
  /** Si la IA lee las respuestas que las reglas no entienden. */
  leerConIA: z.boolean().default(true),
  /** Si el pin del cliente se manda al motorizado como ubicacion nativa ademas del enlace. */
  mandarPinAlMotorizado: z.boolean().default(true),
  /** Si al cliente se le escribe cuando el motorizado dice "entregado". */
  avisarEntregado: z.boolean().default(true),
  /** Si a un cliente que pregunta "donde esta mi pedido" se le contesta solo (sin IA), segun el estado. */
  responderDondeEsta: z.boolean().default(true),
  /**
   * Si la pregunta de confirmar (y la de la segunda visita) sale con dos
   * botones SI / NO cuando el WhatsApp lo permite. Si el proveedor no puede,
   * sale como texto de siempre: nunca se queda sin mandar.
   */
  usarBotones: z.boolean().default(true),
  /** Si al cliente se le avisa cuando el motorizado escribe "cerca" / "llegando". */
  avisarCerca: z.boolean().default(true),
  /**
   * Regla del dueño (modo «Solo lo de GSG»): «El único proceso de GSGchat es
   * disparar mensajes. Una vez que la IA manda el mensaje de UBI REGISTRADA,
   * ahí llega la IA: ya no vuelve a responder.» Encendido: tras UBI REGISTRADA
   * (o tras el cierre por una consulta) al cliente no se le escribe NADA más
   * por ese pedido: ni confirmación SÍ/NO, ni hora de llegada, ni «cerca», ni
   * «entregado», ni recordatorios, ni IA, ni stickers. Lo del motorizado y lo
   * que se reporta a GSG sigue igual por dentro. Apagado: como antes.
   */
  silencioTrasUbi: z.boolean().default(true),
  /**
   * «Revisar y confirmar antes de enviar» (decisión del dueño): la lista del
   * día que manda GSG (la API o el simulador) NO sale sola;
   * queda en «Números del día» como «Por confirmar el envío» hasta que una
   * persona pulsa «Confirmar y enviar». Apagado: sale sola, como antes. Lo
   * creado con «Pedido a mano» nunca espera.
   */
  confirmarListaGsg: z.boolean().default(false),
  /**
   * Cliente recurrente: si mando su ubicacion hace menos de `diasMaximo`
   * dias, en vez de pedirle el pin se le propone esa direccion ("¿la misma
   * de la ultima vez?"). Si en `esperaMin` minutos no contesta, el reparto
   * se la pide como siempre.
   */
  clienteRecurrente: z
    .object({
      activo: z.boolean().default(true),
      diasMaximo: z.number().int().min(1).max(365).default(60),
      esperaMin: z.number().int().min(5).max(24 * 60).default(60),
    })
    .default({}),
  /**
   * La segunda visita: cuando el motorizado dice que no habia nadie, se le
   * pregunta al cliente si volvemos hoy. Un si manda otra vez al motorizado;
   * un no (u otro dia) pasa a una persona; sin respuesta en `esperaMin`
   * minutos, tambien. Solo una segunda visita por pedido.
   */
  segundaVisita: z
    .object({
      activa: z.boolean().default(true),
      esperaMin: z.number().int().min(5).max(24 * 60).default(30),
    })
    .default({}),
  /**
   * El cierre del dia: a esa hora (reloj del negocio) lo que quedo vivo de
   * ayer se aparta con una incidencia y lo avisado sin "entregado" se da por
   * entregado. Asi la pantalla de hoy arranca limpia y GSG se entera.
   */
  cierreDelDia: z
    .object({
      activo: z.boolean().default(true),
      hora: z.number().int().min(0).max(23).default(0),
    })
    .default({}),
  /**
   * El horario en el que se entrega (reloj del negocio, "HH:MM"): sale en
   * los textos al cliente como {desde}, {hasta} y {hastaExtendido}.
   */
  horarioEntregas: z
    .object({
      desde: z.string().regex(/^\d{2}:\d{2}$/).default('14:00'),
      hasta: z.string().regex(/^\d{2}:\d{2}$/).default('20:00'),
      extendidoHasta: z.string().regex(/^\d{2}:\d{2}$/).default('22:00'),
    })
    .default({}),
  /**
   * El numero de soporte que se le da al cliente ({soporte}): uno para
   * WhatsApp y llamadas, o dos distintos. Vacio = "este mismo WhatsApp".
   */
  soporte: z
    .object({
      whatsapp: z.string().trim().max(20).default(''),
      llamadas: z.string().trim().max(20).default(''),
    })
    .default({}),
  /**
   * Solo con la API de Meta: fuera de la ventana de 24 h no se puede mandar
   * texto libre, hace falta una plantilla aprobada. Aqui va el nombre de la
   * plantilla para cada caso (idioma es). Vacio = sin plantilla: la entrega
   * se aparta con una incidencia clara en vez de reintentar a ciegas.
   * Variables, en orden: {{1}} nombre, {{2}} pedido, {{3}} negocio (confirmacion);
   * {{1}} nombre del cliente, {{2}} pedido, {{3}} enlace del mapa (motorizado);
   * {{1}} nombre, {{2}} pedido, {{3}} hora aproximada (aviso).
   */
  plantillas: z
    .object({
      confirmacion: z.string().trim().max(120).default(''),
      motorizado: z.string().trim().max(120).default(''),
      aviso: z.string().trim().max(120).default(''),
    })
    .default({}),
  textos: z
    .object({
      ubicacionRegistrada: z.string().max(1500).default(''),
      proponerUbicacion: z.string().max(1000).default(''),
      ubicacionOtra: z.string().max(1000).default(''),
      motorizadoTiempoDudoso: z.string().max(1000).default(''),
      motorizadoFueraDeFlujo: z.string().max(1000).default(''),
      pedirConfirmacion: z.string().max(1000).default(''),
      insistirConfirmacion: z.string().max(1000).default(''),
      preguntarOtraVez: z.string().max(1000).default(''),
      graciasYConfirmar: z.string().max(1000).default(''),
      graciasYConfirmarVarios: z.string().max(1000).default(''),
      confirmarOtroPedido: z.string().max(1000).default(''),
      confirmada: z.string().max(1000).default(''),
      confirmadaYaAvisado: z.string().max(1000).default(''),
      cancelada: z.string().max(1000).default(''),
      cambio: z.string().max(1000).default(''),
      motorizadoNuevo: z.string().max(1500).default(''),
      motorizadoSinUbicacion: z.string().max(1500).default(''),
      motorizadoInsistir: z.string().max(1000).default(''),
      motorizadoPreguntarOtraVez: z.string().max(1000).default(''),
      motorizadoGracias: z.string().max(1000).default(''),
      motorizadoCancelado: z.string().max(1000).default(''),
      avisoLlegada: z.string().max(1000).default(''),
      motorizadoEntregado: z.string().max(1000).default(''),
      motorizadoNoEntregado: z.string().max(1000).default(''),
      motorizadoNoEntregadoPreguntamos: z.string().max(1000).default(''),
      clienteEntregado: z.string().max(1000).default(''),
      dondeEstaUbicacion: z.string().max(1000).default(''),
      dondeEstaConfirmacion: z.string().max(1000).default(''),
      dondeEstaMotorizado: z.string().max(1000).default(''),
      dondeEstaAvisada: z.string().max(1000).default(''),
      dondeEstaCerca: z.string().max(1000).default(''),
      dondeEstaEntregada: z.string().max(1000).default(''),
      dondeEstaNoLlego: z.string().max(1000).default(''),
      horaEnSilencio: z.string().max(1000).default(''),
      horaEnSilencioPasada: z.string().max(1000).default(''),
      horaEnSilencioSinTiempo: z.string().max(1000).default(''),
      segundaVisitaPreguntar: z.string().max(1000).default(''),
      segundaVisitaSi: z.string().max(1000).default(''),
      segundaVisitaNo: z.string().max(1000).default(''),
      motorizadoSegundaVisita: z.string().max(1500).default(''),
      clienteCerca: z.string().max(1000).default(''),
      motorizadoCerca: z.string().max(1000).default(''),
      motorizadoRuta: z.string().max(1000).default(''),
      clienteCambioMotorizado: z.string().max(1000).default(''),
      motorizadoTraspaso: z.string().max(1000).default(''),
      motorizadoAudioSinTexto: z.string().max(1000).default(''),
      motorizadoEnlace: z.string().max(1000).default(''),
      ubicacionFueraDeZona: z.string().max(1000).default(''),
      ubicacionFueraDeLima: z.string().max(1000).default(''),
      cambioUbicacionAntes: z.string().max(1000).default(''),
      cambioUbicacionTarde: z.string().max(1000).default(''),
      ubicacionCambiada: z.string().max(1000).default(''),
      clienteCanceladoGsg: z.string().max(1000).default(''),
      solicitudUbicacion: z.string().max(2000).default(''),
      porQueUbicacion: z.string().max(1000).default(''),
      cierreAgente: z.string().max(1000).default(''),
      confirmarEntregaGsg: z.string().max(2000).default(''),
      recordarConfirmarGsg: z.string().max(1000).default(''),
      confirmadaGsg: z.string().max(1000).default(''),
      noConfirmaGsg: z.string().max(1000).default(''),
      porQueConfirmar: z.string().max(1000).default(''),
      pinLejos: z.string().max(1000).default(''),
      pinLejosNo: z.string().max(1000).default(''),
      ubicacionEnVivo: z.string().max(1000).default(''),
      direccionTomada: z.string().max(1000).default(''),
      direccionAnotada: z.string().max(1000).default(''),
    })
    .default({}),
});
export type AjustesEntregas = z.infer<typeof ajustesEntregasSchema>;
export const AJUSTES_ENTREGAS_POR_DEFECTO: AjustesEntregas = ajustesEntregasSchema.parse({});

export interface ContextoTexto {
  nombre?: string | null;
  pedido?: string | null;
  negocio: string;
  direccion?: string | null;
  distrito?: string | null;
  mapa?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Los minutos que se le dicen al cliente (ya con el margen). */
  minutos?: number | null;
  /** La hora aproximada de llegada, ya formateada ("15:40"). */
  hora?: string | null;
  /** Lo que falta para esa hora, ya en palabras y con su parentesis: " (faltan unos 25 min)". Vacio si ya paso o no se sabe. */
  faltan?: string | null;
  /** Lo que falta para la hora de llegada, recalculado al momento: "1 h 30 min". */
  enCuanto?: string | null;
  motorizado?: string | null;
  placa?: string | null;
  /** Los minutos que dijo el motorizado, sin margen. */
  minutosMotorizado?: number | null;
  notas?: string | null;
  /** La hora a la que se dio por entregada ("16:05"), si ya lo esta. */
  horaEntregada?: string | null;
  /** Lo que le pasa ahora mismo, en cristiano (lo arma el servicio). */
  situacion?: string | null;
  /** Ya viene con el formato que toca (" (Miraflores)"): no se toca. */
  distritoTalCual?: boolean;
  /** Si el pedido es urgente: {urgente} pone la marca delante. */
  urgente?: boolean;
  /** Cuantas paradas lleva la ruta del motorizado ({paradas}). */
  paradas?: number | null;
  /** Los pedidos que se le quitan a un motorizado, ya en lista ("P-1001, P-1002"). */
  pedidos?: string | null;
  /** El horario de entregas ya en palabras ("2:00 p. m."), del ajuste. */
  desde?: string | null;
  hasta?: string | null;
  hastaExtendido?: string | null;
  /** El numero de soporte ya en palabras, del ajuste. */
  soporte?: string | null;
  /**
   * El numero que se le da al cliente en el cierre y en UBI REGISTRADA: el del
   * motorizado de ese pedido si ya hay uno; si no, el de soporte; si tampoco,
   * el del WhatsApp de la tienda. Nunca vacio.
   */
  telefonoMotorizado?: string | null;
  /** El telefono del cliente, ya en palabras ("+51 987 654 321"): solo para el motorizado. */
  telefonoCliente?: string | null;
  /** Los kilometros hasta el pin, ya en palabras ("unos 14 km"). */
  km?: string | null;
  /** La zona que se cubre, en palabras ("todo Lima y Callao"). */
  cobertura?: string | null;
  /** La hora limite para cambiar la ubicacion («1:00 PM»). */
  horaLimite?: string | null;
  /** Un enlace propio del mensaje (la pagina del motorizado). */
  enlace?: string | null;
  /** Lo que GSG cuenta del envio (producto, empresa, codigo, monto, quien firma): lo que falta no sale. */
  envio?: DatosEnvio | null;
}

/**
 * Las variables de los datos del envio: si una viene vacia, se quita la LINEA
 * entera (nada de «Monto a Cobrar: » suelto ni «undefined»).
 */
const VARIABLES_DE_LINEA = ['producto', 'empresa', 'tracking', 'nroPedido', 'metodoPago', 'monto', 'remitente', 'direccionCompleta'] as const;

/** «516 - Zapatería Lima», o lo que haya de los dos. */
export function empresaEnPalabras(envio?: DatosEnvio | null): string {
  return [envio?.empresaCodigo, envio?.empresaNombre].map((p) => (p ?? '').trim()).filter(Boolean).join(' - ');
}

/** "14:00" → "2:00 p. m."; "09:30" → "9:30 a. m.". */
export function horaEnPalabras(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2];
  const sufijo = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${sufijo}`;
}
/**
 * Un telefono peruano como se lee: celular "+51 987 654 321"; fijo de Lima
 * "(01) 234 5678" (con o sin el 0); fijo de provincia "(044) 123 456".
 */
export function telefonoEnPalabras(crudo: string): string {
  const d = crudo.replace(/\D/g, '');
  if (!d) return '';
  const nacional = d.startsWith('51') && d.length === 11 ? d.slice(2) : d;
  if (nacional.length === 9 && nacional.startsWith('9')) return `+51 ${nacional.slice(0, 3)} ${nacional.slice(3, 6)} ${nacional.slice(6)}`;
  if (nacional.length === 9 && nacional.startsWith('01')) return `(01) ${nacional.slice(2, 5)} ${nacional.slice(5)}`;
  if (nacional.length === 9 && nacional.startsWith('0')) return `(${nacional.slice(0, 3)}) ${nacional.slice(3, 6)} ${nacional.slice(6)}`;
  if (nacional.length === 7) return `(01) ${nacional.slice(0, 3)} ${nacional.slice(3)}`;
  return `+${d}`;
}
/** Como se le dice al cliente a donde escribir o llamar. */
export function soporteEnPalabras(soporte: { whatsapp?: string; llamadas?: string }): string {
  const wa = telefonoEnPalabras(soporte.whatsapp ?? '');
  const tel = telefonoEnPalabras(soporte.llamadas ?? '');
  if (wa && tel && wa !== tel) return `WhatsApp ${wa} · Llamadas ${tel}`;
  if (wa || tel) return `${wa || tel} (WhatsApp y llamadas)`;
  return 'este mismo número, por WhatsApp o llamada';
}
/** "1 h 40 min", "45 min", "2 h". */
export function minutosEnPalabras(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  if (r === 0) return `${h} h`;
  return `${h} h ${r} min`;
}
/** La hora en el reloj del negocio: "15:40". */
export function horaEnReloj(fecha: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('es-PE', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(fecha);
  } catch {
    return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
  }
}
const nombreDePila = (nombre?: string | null): string => (nombre ?? '').trim().split(/\s+/)[0] || '';
/** Rellena {variables}; las que no hay se quitan sin dejar el hueco feo. */
export function rellenar(texto: string, ctx: ContextoTexto): string {
  const pila = nombreDePila(ctx.nombre);
  const valores: Record<string, string> = {
    nombre: pila,
    nombreCompleto: (ctx.nombre ?? '').trim() || pila,
    pedido: ctx.pedido?.trim() || 'tu pedido',
    negocio: ctx.negocio,
    direccion: ctx.direccion?.trim() || '',
    distrito: ctx.distritoTalCual ? (ctx.distrito ?? '') : ctx.distrito?.trim() || '',
    mapa: ctx.mapa ?? '',
    lat: ctx.lat != null ? String(ctx.lat) : '',
    lng: ctx.lng != null ? String(ctx.lng) : '',
    minutos: ctx.minutos != null ? minutosEnPalabras(ctx.minutos) : '',
    hora: ctx.hora ?? '',
    faltan: ctx.faltan ?? '',
    enCuanto: ctx.enCuanto ?? '',
    motorizado: ctx.motorizado ?? '',
    placa: ctx.placa ?? '',
    minutosMotorizado: ctx.minutosMotorizado != null ? minutosEnPalabras(ctx.minutosMotorizado) : '',
    notas: ctx.notas?.trim() || '',
    horaEntregada: ctx.horaEntregada ?? '',
    situacion: ctx.situacion ?? '',
    urgente: ctx.urgente ? '🔴 URGENTE · ' : '',
    paradas: ctx.paradas != null ? String(ctx.paradas) : '',
    pedidos: ctx.pedidos ?? '',
    desde: ctx.desde ?? '',
    hasta: ctx.hasta ?? '',
    hastaExtendido: ctx.hastaExtendido ?? '',
    soporte: ctx.soporte ?? '',
    telefonoMotorizado: ctx.telefonoMotorizado?.trim() || ctx.soporte?.trim() || '',
    telefonoCliente: ctx.telefonoCliente ?? '',
    km: ctx.km ?? '',
    cobertura: ctx.cobertura ?? '',
    horaLimite: ctx.horaLimite ?? '',
    enlace: ctx.enlace ?? '',
    producto: ctx.envio?.producto?.trim() || '',
    empresa: empresaEnPalabras(ctx.envio),
    tracking: ctx.envio?.tracking?.trim() || '',
    nroPedido: ctx.envio?.nroPedido?.trim() || '',
    metodoPago: ctx.envio?.metodoPago?.trim() || '',
    monto: ctx.envio?.monto?.trim() || '',
    remitente: ctx.envio?.remitente?.trim() || '',
    direccionCompleta: [ctx.distrito, ctx.direccion].map((p) => (p ?? '').trim()).filter(Boolean).join(' - '),
  };
  let base = texto;
  // Sin quien firma: «Soy {remitente} de la empresa…» pasa a «Te escribimos de la empresa…».
  if (!valores.remitente) base = base.replace(/Soy\s+\{remitente\}\s+de\b/g, 'Te escribimos de');
  // Sin número de motorizado ni de soporte: se quita la FRASE que lo daba
  // («Número del motorizado: …»), nunca se pone otro número en su lugar
  // (26/09: salía el del propio WhatsApp como si fuera el del motorizado).
  if (!valores.telefonoMotorizado) base = base.replace(/[ \t]*[^.!?\n]*\{telefonoMotorizado\}[^.!?\n]*[.!?]?/g, '');
  // Una linea con un dato del envio que no vino se quita entera.
  base = base
    .split('\n')
    .filter((linea) => !VARIABLES_DE_LINEA.some((v) => linea.includes(`{${v}}`) && !valores[v]))
    .join('\n');
  return base
    .replace(/\{(\w+)\}/g, (_m, clave: string) => valores[clave] ?? '')
    // «¡Hola !» cuando no hay nombre.
    .replace(/¡Hola\s+!/g, '¡Hola!')
    // "Hola , " cuando no hay nombre.
    .replace(/Hola\s*,/g, 'Hola,')
    .replace(/\s+,/g, ',')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    // "hasta las 10:00 p. m.." cuando la variable ya termina en punto.
    .replace(/\.\.(?!\.)/g, '.')
    .trim();
}
/**
 * El cierre (regla del dueño): «por este canal no se reciben consultas», se
 * deriva a un humano y se da el número del motorizado ({telefonoMotorizado}:
 * el del motorizado de ese pedido si ya hay uno; si no, el de soporte; si
 * tampoco, el del WhatsApp de la tienda). Va pegado a «Ubicación registrada
 * correctamente» y es también el mensaje de cierre ante cualquier consulta.
 */
export const TEXTO_CIERRE = 'Por este canal no se reciben consultas. Te derivamos con un asesor humano. Contacto de soporte: {soporte}.';
// En el agradecimiento no va el cierre: el numero del motorizado se da cuando el cliente pregunta algo (ya con motorizado asignado).
const CIERRE_UBICACION = '¡Muchas gracias!';

/** Los textos de siempre. Se usan cuando la pantalla no guardo otros. */
export const TEXTOS_POR_DEFECTO: Record<keyof AjustesEntregas['textos'], string> = {
  // Solo el enlace del mapa: nada de latitud y longitud a la vista del cliente.
  // Es a la vez el cierre del agente operativo: despues de esto la IA ya no
  // contesta en ese chat (el sistema sigue con la hora de llegada y el entregado).
  ubicacionRegistrada: `✅ Ubicación registrada correctamente.\n{mapa}\n\n${CIERRE_UBICACION}\n\nLa ubicación queda registrada para coordinar tu entrega. Para cualquier consulta, comunícate con soporte: {soporte}.\n\n🕑 Horario de entrega: de {desde} a {hasta}. Por algunas casuísticas, el horario se puede extender hasta las {hastaExtendido}.\n\n📍 Si por algún motivo deseas cambiar tu ubicación, avísanos antes de la {horaLimite} para tenerla en cuenta el mismo día.`,
  solicitudUbicacion: '¡Hola {nombreCompleto}! Somos GSG Courier, tengo una entrega para ti:\n📦 Producto: {producto}\n🏢 Empresa: {empresa}\n📝 Código: {tracking}\n🧾 Nro. de pedido: {nroPedido}\n💳 Método de Pago: {metodoPago}\n💰 Monto a Cobrar: {monto}\n🏠 Dirección: {direccionCompleta}\n\nPor favor, ¿podrías compartir tu ubicación por WhatsApp para poder llegar sin problemas? ¡Gracias!',
  porQueUbicacion: 'Es necesaria para registrar correctamente la dirección de entrega. ¿Podrías compartir tu ubicación por WhatsApp, por favor? (clip 📎 → Ubicación)',
  cierreAgente: TEXTO_CIERRE,
  proponerUbicacion: 'Hola {nombre}, somos {negocio}: hoy le llevamos {pedido}. ¿Se lo llevamos a la misma dirección de la última vez?\nResponda SÍ si es la misma; si es otra, mándenos su ubicación desde el clip 📎 → Ubicación.',
  ubicacionOtra: 'Perfecto, {nombre}. Mándenos su ubicación actual desde el clip 📎 → Ubicación → Enviar tu ubicación actual, y seguimos con {pedido}.',
  motorizadoTiempoDudoso: '¿Seguro? Hasta {pedido} son {km}. Responde otra vez solo con los minutos, por favor.',
  motorizadoFueraDeFlujo: 'Por aquí solo coordino los pedidos: tu ruta, los minutos, "cerca", "entregado" o "no puedo". Los datos de los clientes no se comparten por este chat; si necesitas algo más, habla con el coordinador.',
  pedirConfirmacion: 'Hola {nombre}, somos {negocio}. Hoy le llevamos {pedido}. ¿Nos confirma que va a poder recibirlo? Responda SÍ para confirmar o NO si prefiere cancelarlo.',
  insistirConfirmacion: 'Hola {nombre}, seguimos pendientes de {pedido} de {negocio}. ¿Lo recibe hoy? Responda SÍ o NO, por favor.',
  preguntarOtraVez: 'Disculpe, no me quedó claro. ¿Recibe hoy {pedido}? Responda SÍ para confirmar, NO para cancelar, o cuéntenos si prefiere otro día u otra dirección.',
  // El mismo aviso completo que «Ubicación registrada» y, al final, la pregunta.
  graciasYConfirmar: `✅ Ubicación registrada correctamente.\n{mapa}\n\n${CIERRE_UBICACION}\n\nLa ubicación queda registrada para coordinar tu entrega. Para cualquier consulta, comunícate con soporte: {soporte}.\n\n🕑 Horario de entrega: de {desde} a {hasta}. Por algunas casuísticas, el horario se puede extender hasta las {hastaExtendido}.\n\n📍 Si por algún motivo deseas cambiar tu ubicación, avísanos antes de la {horaLimite} para tenerla en cuenta el mismo día.\n\nUna cosa más: ¿nos confirma que va a poder recibirlo hoy? Responda SÍ o NO.`,
  graciasYConfirmarVarios: `✅ Ubicación registrada correctamente ({pedidos}).\n{mapa}\n\n${CIERRE_UBICACION}\n\nLa ubicación queda registrada para coordinar tu entrega. Para cualquier consulta, comunícate con soporte: {soporte}.\n\n🕑 Horario de entrega: de {desde} a {hasta}. Por algunas casuísticas, el horario se puede extender hasta las {hastaExtendido}.\n\n📍 Si por algún motivo deseas cambiar tu ubicación, avísanos antes de la {horaLimite} para tenerla en cuenta el mismo día.\n\nVamos uno por uno: ¿nos confirma que va a poder recibir {pedido} hoy? Responda SÍ o NO.`,
  confirmarOtroPedido: 'Y {pedido}, ¿también lo recibe hoy? Responda SÍ o NO.',
  // El mismo aviso del motorizado, horario y soporte que «Ubicación registrada».
  // Si ya recibio el aviso completo al mandar su ubicacion: solo el ok, sin repetirlo.
  confirmadaYaAvisado: 'Perfecto, {pedido} queda confirmado para hoy. ¡Gracias!',
  confirmada: 'Perfecto, {pedido} queda confirmado para hoy.\n\nLa ubicación queda registrada para coordinar tu entrega. Para cualquier consulta, comunícate con soporte: {soporte}.\n\n🕑 Horario de entrega: de {desde} a {hasta}. Por algunas casuísticas, el horario se puede extender hasta las {hastaExtendido}.\n\n📞 Para cualquier consulta, comunícate a nuestro número de soporte: {soporte}.',
  cancelada: 'Entendido, dejamos {pedido} sin entregar por hoy. Si cambia de opinión, escríbanos por aquí. Gracias.',
  cambio: 'Entendido, tomamos nota. Un compañero de {negocio} se comunicará con usted para coordinar {pedido}. Gracias.',
  motorizadoNuevo: '🛵 {urgente}Nuevo pedido: {pedido}\nCliente: {nombreCompleto}{distrito}\n{notas}\n¿En cuántos minutos lo entregas? Responde solo con los minutos (ej. 40).',
  // Sin ubicación: NUNCA se le manda un pin ni un mapa; coordina con el cliente por teléfono.
  motorizadoSinUbicacion: '🛵 {urgente}Nuevo pedido SIN ubicación: {pedido}\nCliente: {nombreCompleto} · {telefonoCliente}\nDirección: {direccion}{distrito}\nNo mandó su ubicación: coordina con el cliente por teléfono.\n¿En cuántos minutos lo entregas? Responde solo con los minutos (ej. 40).',
  motorizadoInsistir: 'Hola {motorizado}, sigo esperando tu tiempo para {pedido} ({nombre}). ¿En cuántos minutos lo entregas?',
  motorizadoPreguntarOtraVez: 'No te entendí. Para {pedido}: responde solo los minutos (ej. 40), o "no puedo" si no lo vas a llevar.',
  motorizadoGracias: 'Anotado: {pedido} en {minutosMotorizado}. Al cliente le avisamos que llega en {minutos} aprox. Gracias.',
  motorizadoCancelado: 'Ojo: {pedido} ({nombre}) ya no lo llevas tú. Gracias.',
  avisoLlegada: '🛵 {pedido}: ¡ya en camino! Le llega aproximadamente en {minutos}, alrededor de las {hora}. Cualquier cosa, escríbanos por aquí.',
  motorizadoEntregado: 'Perfecto, {pedido} entregado. ¡Gracias!',
  motorizadoNoEntregado: 'Anotado: {pedido} ({nombre}) no se pudo entregar. Una persona de {negocio} lo verá y te avisa qué hacer.',
  motorizadoNoEntregadoPreguntamos: 'Anotado: {pedido} ({nombre}) no se pudo entregar. Le estamos preguntando al cliente si volvemos hoy: si dice que sí, te mando el pin otra vez.',
  clienteEntregado: '¡Listo! {pedido} quedó entregado. Gracias por confiar en {negocio}. Cualquier cosa, escríbanos por aquí.',
  dondeEstaUbicacion: 'Hola {nombre}, para poder mandarle {pedido} nos falta su ubicación. Compártanos el pin desde WhatsApp (el clip 📎 → Ubicación) o un enlace de Google Maps.',
  dondeEstaConfirmacion: 'Hola {nombre}, {pedido} está listo para salir; solo falta que nos confirme que lo recibe hoy. Responda SÍ para confirmar o NO si prefiere cancelarlo.',
  dondeEstaMotorizado: 'Hola {nombre}, {pedido} ya está con un motorizado. En cuanto nos diga su tiempo le avisamos por aquí a qué hora le llega.',
  dondeEstaAvisada: 'Hola {nombre}, {pedido} va en camino con {motorizado}: le llega alrededor de las {hora}{faltan}. Le llamará minutos antes de llegar.',
  dondeEstaCerca: 'Hola {nombre}, {motorizado} ya está cerca de su dirección con {pedido}: le llega en unos minutos. Por favor, esté pendiente del teléfono: le llamará antes de llegar.',
  dondeEstaEntregada: 'Hola {nombre}, según nuestro registro {pedido} quedó entregado a las {horaEntregada}. Si no es así, escríbanos y lo revisamos enseguida.',
  dondeEstaNoLlego: 'Disculpe la demora, {nombre}. Ya avisamos a una persona de {negocio} para que revise {pedido} y se comunique con usted por aquí.',
  // La hora cuando el cliente la pide con el silencio tras UBI (pedido del
  // dueño, 28/09): sin «atento/atenta» ni nada con género.
  horaEnSilencio: 'Hola {nombre}, su pedido {pedido} llega aproximadamente a las {hora} (en aprox. {enCuanto}). El motorizado le llamará minutos antes de llegar.',
  horaEnSilencioPasada: 'Hola {nombre}, su pedido {pedido} debería estar por llegar (lo calculamos para las {hora}). El motorizado le llamará al llegar a su dirección.',
  horaEnSilencioSinTiempo: 'Hola {nombre}, su pedido {pedido} se entrega hoy entre las {desde} y las {hasta}. El motorizado le llamará antes de llegar a su dirección.',
  segundaVisitaPreguntar: 'Hola {nombre}, el motorizado de {negocio} pasó con {pedido} y no encontró a nadie. ¿Se lo llevamos de nuevo hoy? Responda SÍ para que vuelva a pasar, o NO si prefiere coordinar otro día.',
  segundaVisitaSi: 'Perfecto, {nombre}: el motorizado vuelve a pasar hoy con {pedido}. En cuanto nos diga su tiempo le avisamos por aquí la hora aproximada.',
  segundaVisitaNo: 'Entendido, {nombre}. Una persona de {negocio} se comunicará con usted para coordinar {pedido} otro día. Gracias.',
  motorizadoSegundaVisita: '🔁 {urgente}Segunda visita: {pedido}\nCliente: {nombreCompleto}{distrito} (ya está en casa)\n{notas}\n¿En cuántos minutos vuelves a pasar? Responde solo con los minutos (ej. 20).',
  clienteCerca: 'Hola {nombre}, {motorizado} está a unos minutos de su dirección con {pedido}. Por favor, esté pendiente del timbre o del teléfono. ¡Gracias!',
  motorizadoCerca: 'Listo: a {nombre} le avisamos que estás por llegar con {pedido}.',
  motorizadoRuta: '🗺️ Tu ruta de hoy ({paradas} paradas), en este orden:',
  clienteCambioMotorizado: 'Hola {nombre}, hubo un cambio de motorizado para {pedido}. En un momento le confirmamos por aquí la nueva hora de llegada. Disculpe la molestia.',
  motorizadoTraspaso: 'Entendido, {motorizado}: te quitamos {pedidos} y los repartimos entre los demás. Avísanos cuando puedas volver.',
  motorizadoAudioSinTexto: 'Recibí tu audio, {motorizado}, pero no pude entenderlo. Escríbelo por aquí (por ejemplo "40", "entregado", "no estaba nadie", "cerca") o manda otro audio más claro.',
  motorizadoEnlace: 'Hola {motorizado}, aquí tienes tus pedidos de hoy con botones grandes para avisar desde el celular: {enlace}\nVale por 7 días. Si lo pierdes, pide otro al coordinador.',
  cambioUbicacionAntes: '¡Claro! Entiendo. Mándame la nueva ubicación para tenerla en cuenta para el mismo día.',
  cambioUbicacionTarde: 'Entiendo que deseas cambiar tu ubicación, pero al ser después de la {horaLimite}, por favor comunícate directamente con el motorizado para coordinar la entrega. Contacto de soporte: {soporte}.',
  ubicacionCambiada: '✅ Tu nueva ubicación se ha registrado correctamente.\n{mapa}\n\nLa tendremos en cuenta para la entrega de hoy. Recuerda que los cambios de ubicación solo se toman en cuenta el mismo día si nos avisas antes de la {horaLimite}.',
  ubicacionFueraDeLima: 'Su ubicación está fuera de Lima y Callao: la entrega de {pedido} tiene un costo extra según la distancia, que le indicará el motorizado al llegar.',
  ubicacionFueraDeZona: 'Gracias, {nombre}, recibimos su ubicación, pero queda fuera de la zona que cubrimos{cobertura}. Una persona de {negocio} se comunicará con usted para coordinar {pedido}.',
  clienteCanceladoGsg: 'Hola {nombre}, {pedido} quedó cancelado por {negocio} y hoy ya no se lo llevamos. Si no fue usted quien lo canceló, escríbanos por aquí y lo revisamos.',
  // Los de «falta confirmar» (GSG ya tiene su dirección): solo SÍ o NO, nunca la ubicación.
  confirmarEntregaGsg: '¡Hola {nombre}! Somos GSG Courier, tengo una entrega para ti:\n📦 Producto: {producto}\n🏢 Empresa: {empresa}\n📝 Código: {tracking}\n🧾 Nro. de pedido: {nroPedido}\n💳 Método de Pago: {metodoPago}\n💰 Monto a Cobrar: {monto}\n🏠 Dirección: {direccionCompleta}\n\n¿Nos confirmas que lo recibes hoy en esa dirección? Responde SÍ o NO.',
  recordarConfirmarGsg: 'Hola {nombre}, te escribimos otra vez por tu entrega de GSG.\n📦 Producto: {producto}\n🏠 Dirección: {direccionCompleta}\n\n¿Nos confirmas que la recibes hoy? Responde SÍ o NO.',
  confirmadaGsg: 'Perfecto, tu pedido queda confirmado para hoy. ¡Muchas gracias!',
  noConfirmaGsg: 'Entendido, lo pasamos a un asesor. Por este canal no se reciben consultas. Número del motorizado: {telefonoMotorizado}.',
  porQueConfirmar: 'Te escribimos para confirmar la entrega de tu pedido de {empresa} antes de salir. Responde SÍ o NO.',
  // El pin tiene que tener sentido: si cae lejos de su distrito, se le pregunta UNA vez.
  pinLejos: 'Recibimos tu ubicación, pero queda lejos de {distrito}. ¿Es ahí donde recibes tu pedido? Responde SÍ o NO',
  pinLejosNo: 'Por favor, envíanos la ubicación correcta desde el clip 📎 → Ubicación → Enviar tu ubicación actual',
  // La ubicación en tiempo real no se registra: se pide la actual.
  ubicacionEnVivo: 'Esa es tu ubicación en tiempo real. Por favor, compártenos tu UBICACIÓN ACTUAL desde el clip 📎 → Ubicación → Enviar tu ubicación actual.',
  // La dirección escrita: va debajo de «Ubicación registrada» cuando se ubicó en el mapa.
  direccionTomada: 'Tomamos tu dirección: {direccion}. Si puedes, mándanos también el pin para llegar exacto.',
  direccionAnotada: 'Gracias, anotamos: {direccion}. Para llegar exacto, ¿nos mandas tu ubicación desde el clip 📎 → Ubicación?',
};
/** El texto que toca: el guardado desde la pantalla si lo hay, si no el de siempre. */
export function textoDe(clave: keyof AjustesEntregas['textos'], ajustes: AjustesEntregas, ctx: ContextoTexto): string {
  const propio = ajustes.textos[clave]?.trim();
  if (clave === 'solicitudUbicacion' && !propio) {
    const completa = tieneNumeracion(ctx.direccion ?? '') && Boolean(ctx.distrito?.trim() || distritoEnDireccion(ctx.direccion));
    const base = TEXTOS_POR_DEFECTO.solicitudUbicacion;
    const pedido = completa
      ? 'Por favor, confirma si la dirección indicada es correcta compartiendo tu ubicación actual por WhatsApp. También puedes escribir tu dirección completa con número y distrito para buscarla en el mapa y confirmarla contigo.'
      : 'La dirección todavía no permite ubicar una puerta exacta. Por favor, comparte tu ubicación actual por WhatsApp o completa la dirección con número de puerta (o manzana y lote) y distrito.';
    return rellenar(base.replace('Por favor, ¿podrías compartir tu ubicación por WhatsApp para poder llegar sin problemas? ¡Gracias!', pedido), ctx);
  }
  // La hora límite sale de los ajustes si quien llama no la trae (si no, quedaba «antes de la  para…»).
  return rellenar(propio || TEXTOS_POR_DEFECTO[clave], { ...ctx, horaLimite: ctx.horaLimite || horaEnPalabras(ajustes.cambioUbicacionHasta) });
}
/** El texto para el motorizado, con el distrito entre paréntesis si lo hay. */
export function contextoMotorizado(ctx: ContextoTexto): ContextoTexto {
  return { ...ctx, distrito: ctx.distrito ? ` (${ctx.distrito})` : '', distritoTalCual: true, notas: ctx.notas ? `Nota: ${ctx.notas}` : '' };
}
/** Las claves cuyo texto va al motorizado (llevan el distrito entre parentesis y la nota con etiqueta). */
export const TEXTOS_PARA_MOTORIZADO: ReadonlySet<keyof AjustesEntregas['textos']> = new Set<keyof AjustesEntregas['textos']>([
  'motorizadoNuevo',
  'motorizadoSinUbicacion',
  'motorizadoInsistir',
  'motorizadoPreguntarOtraVez',
  'motorizadoGracias',
  'motorizadoCancelado',
  'motorizadoEntregado',
  'motorizadoNoEntregado',
  'motorizadoNoEntregadoPreguntamos',
  'motorizadoSegundaVisita',
  'motorizadoCerca',
  'motorizadoRuta',
  'motorizadoTraspaso',
  'motorizadoAudioSinTexto',
  'motorizadoEnlace',
]);
/** Las variables que la pantalla enseña junto a cada texto. */
export const VARIABLES_TEXTOS: Record<keyof AjustesEntregas['textos'], string[]> = {
  ubicacionRegistrada: ['{nombre}', '{pedido}', '{negocio}', '{mapa}', '{desde}', '{hasta}', '{hastaExtendido}', '{soporte}', '{telefonoMotorizado}', '{horaLimite}'],
  proponerUbicacion: ['{nombre}', '{pedido}', '{negocio}', '{mapa}'],
  ubicacionOtra: ['{nombre}', '{pedido}', '{negocio}'],
  motorizadoTiempoDudoso: ['{pedido}', '{km}', '{motorizado}'],
  motorizadoFueraDeFlujo: ['{motorizado}', '{negocio}'],
  pedirConfirmacion: ['{nombre}', '{pedido}', '{negocio}', '{direccion}', '{distrito}'],
  insistirConfirmacion: ['{nombre}', '{pedido}', '{negocio}'],
  preguntarOtraVez: ['{nombre}', '{pedido}', '{negocio}'],
  graciasYConfirmar: ['{nombre}', '{pedido}', '{negocio}', '{mapa}', '{desde}', '{hasta}', '{hastaExtendido}', '{soporte}', '{telefonoMotorizado}', '{horaLimite}'],
  graciasYConfirmarVarios: ['{nombre}', '{pedido}', '{pedidos}', '{negocio}', '{mapa}', '{desde}', '{hasta}', '{hastaExtendido}', '{soporte}', '{telefonoMotorizado}', '{horaLimite}'],
  confirmarOtroPedido: ['{nombre}', '{pedido}', '{negocio}'],
  confirmada: ['{nombre}', '{pedido}', '{negocio}', '{desde}', '{hasta}', '{hastaExtendido}', '{soporte}'],
  confirmadaYaAvisado: ['{nombre}', '{pedido}', '{negocio}'],
  cancelada: ['{nombre}', '{pedido}', '{negocio}'],
  cambio: ['{nombre}', '{pedido}', '{negocio}'],
  motorizadoNuevo: ['{pedido}', '{nombreCompleto}', '{nombre}', '{distrito}', '{direccion}', '{mapa}', '{lat}', '{lng}', '{notas}', '{motorizado}', '{urgente}'],
  motorizadoSinUbicacion: ['{pedido}', '{nombreCompleto}', '{nombre}', '{telefonoCliente}', '{direccion}', '{distrito}', '{notas}', '{motorizado}', '{urgente}'],
  motorizadoInsistir: ['{pedido}', '{nombre}', '{motorizado}'],
  motorizadoPreguntarOtraVez: ['{pedido}', '{nombre}', '{motorizado}'],
  motorizadoGracias: ['{pedido}', '{minutosMotorizado}', '{minutos}', '{hora}'],
  motorizadoCancelado: ['{pedido}', '{nombre}'],
  avisoLlegada: ['{nombre}', '{pedido}', '{negocio}', '{minutos}', '{hora}', '{motorizado}', '{placa}'],
  motorizadoEntregado: ['{pedido}', '{nombre}', '{horaEntregada}'],
  motorizadoNoEntregado: ['{pedido}', '{nombre}', '{negocio}'],
  motorizadoNoEntregadoPreguntamos: ['{pedido}', '{nombre}', '{negocio}'],
  clienteEntregado: ['{nombre}', '{pedido}', '{negocio}', '{horaEntregada}', '{motorizado}'],
  dondeEstaUbicacion: ['{nombre}', '{pedido}', '{negocio}'],
  dondeEstaConfirmacion: ['{nombre}', '{pedido}', '{negocio}'],
  dondeEstaMotorizado: ['{nombre}', '{pedido}', '{negocio}', '{motorizado}'],
  dondeEstaAvisada: ['{nombre}', '{pedido}', '{negocio}', '{motorizado}', '{hora}', '{faltan}', '{minutos}'],
  dondeEstaCerca: ['{nombre}', '{pedido}', '{negocio}', '{motorizado}', '{hora}'],
  dondeEstaEntregada: ['{nombre}', '{pedido}', '{negocio}', '{horaEntregada}', '{motorizado}'],
  dondeEstaNoLlego: ['{nombre}', '{pedido}', '{negocio}', '{hora}'],
  horaEnSilencio: ['{nombre}', '{pedido}', '{negocio}', '{hora}', '{enCuanto}', '{motorizado}', '{telefonoMotorizado}'],
  horaEnSilencioPasada: ['{nombre}', '{pedido}', '{negocio}', '{hora}', '{motorizado}', '{telefonoMotorizado}'],
  horaEnSilencioSinTiempo: ['{nombre}', '{pedido}', '{negocio}', '{desde}', '{hasta}', '{hastaExtendido}', '{telefonoMotorizado}'],
  segundaVisitaPreguntar: ['{nombre}', '{pedido}', '{negocio}', '{direccion}', '{motorizado}'],
  segundaVisitaSi: ['{nombre}', '{pedido}', '{negocio}', '{motorizado}'],
  segundaVisitaNo: ['{nombre}', '{pedido}', '{negocio}'],
  motorizadoSegundaVisita: ['{pedido}', '{nombreCompleto}', '{nombre}', '{distrito}', '{direccion}', '{mapa}', '{notas}', '{urgente}'],
  clienteCerca: ['{nombre}', '{pedido}', '{negocio}', '{motorizado}', '{placa}'],
  motorizadoCerca: ['{pedido}', '{nombre}', '{motorizado}'],
  motorizadoRuta: ['{motorizado}', '{paradas}', '{negocio}'],
  clienteCambioMotorizado: ['{nombre}', '{pedido}', '{negocio}'],
  motorizadoTraspaso: ['{motorizado}', '{pedidos}', '{negocio}'],
  motorizadoAudioSinTexto: ['{motorizado}', '{negocio}'],
  motorizadoEnlace: ['{motorizado}', '{enlace}', '{negocio}'],
  ubicacionFueraDeZona: ['{nombre}', '{pedido}', '{negocio}', '{cobertura}'],
  ubicacionFueraDeLima: ['{nombre}', '{pedido}', '{negocio}'],
  cambioUbicacionAntes: ['{nombre}', '{pedido}', '{negocio}', '{horaLimite}'],
  cambioUbicacionTarde: ['{nombre}', '{pedido}', '{negocio}', '{horaLimite}', '{motorizado}', '{telefonoMotorizado}'],
  ubicacionCambiada: ['{nombre}', '{pedido}', '{negocio}', '{mapa}', '{horaLimite}'],
  clienteCanceladoGsg: ['{nombre}', '{pedido}', '{negocio}'],
  solicitudUbicacion: ['{nombreCompleto}', '{nombre}', '{remitente}', '{producto}', '{empresa}', '{tracking}', '{nroPedido}', '{metodoPago}', '{monto}', '{direccionCompleta}', '{direccion}', '{distrito}', '{pedido}', '{negocio}'],
  porQueUbicacion: ['{nombre}', '{pedido}', '{negocio}', '{soporte}', '{telefonoMotorizado}'],
  cierreAgente: ['{nombre}', '{pedido}', '{negocio}', '{soporte}', '{telefonoMotorizado}'],
  confirmarEntregaGsg: ['{nombreCompleto}', '{nombre}', '{remitente}', '{producto}', '{empresa}', '{tracking}', '{nroPedido}', '{metodoPago}', '{monto}', '{direccionCompleta}', '{direccion}', '{distrito}', '{pedido}', '{negocio}'],
  recordarConfirmarGsg: ['{nombre}', '{producto}', '{empresa}', '{direccionCompleta}', '{pedido}', '{negocio}'],
  confirmadaGsg: ['{nombre}', '{pedido}', '{negocio}', '{telefonoMotorizado}', '{soporte}'],
  noConfirmaGsg: ['{nombre}', '{pedido}', '{negocio}', '{telefonoMotorizado}', '{soporte}'],
  porQueConfirmar: ['{nombre}', '{pedido}', '{empresa}', '{negocio}'],
  pinLejos: ['{nombre}', '{pedido}', '{distrito}', '{negocio}'],
  pinLejosNo: ['{nombre}', '{pedido}', '{negocio}'],
  ubicacionEnVivo: ['{nombre}', '{pedido}', '{negocio}'],
  direccionTomada: ['{nombre}', '{pedido}', '{direccion}', '{negocio}'],
  direccionAnotada: ['{nombre}', '{pedido}', '{direccion}', '{negocio}'],
};
export const DESCRIPCION_TEXTOS: Record<keyof AjustesEntregas['textos'], string> = {
  ubicacionRegistrada: 'Al cliente, justo después de mandar su ubicación, cuando no falta nada más (con el enlace del mapa, el horario de entregas y el número de soporte)',
  proponerUbicacion: 'Al cliente que ya mandó su ubicación otro día: se le propone esa dirección en vez de pedirle el pin (con botones "Sí, la misma" / "Es otra")',
  ubicacionOtra: 'Al cliente que dice que hoy es otra dirección: se le pide el pin',
  motorizadoTiempoDudoso: 'Al motorizado, cuando su tiempo no cuadra con la distancia (se le pregunta una sola vez)',
  motorizadoFueraDeFlujo: 'Al motorizado que pide datos de clientes, manda enlaces o intenta otra cosa por este chat',
  pedirConfirmacion: 'Al cliente, la primera vez que se le pide confirmar el pedido de hoy',
  insistirConfirmacion: 'Al cliente, cuando no contestó y se vuelve a pedir',
  preguntarOtraVez: 'Al cliente, cuando contestó algo que no se entendió',
  graciasYConfirmar: 'Al cliente, justo después de mandar su ubicación, cuando además falta confirmar',
  graciasYConfirmarVarios: 'Al cliente con VARIOS pedidos hoy, justo después de mandar su ubicación: se le pregunta por el primero',
  confirmarOtroPedido: 'Al cliente con varios pedidos hoy, después de contestar por uno: se le pregunta por el siguiente',
  confirmada: 'Al cliente, cuando confirma (y todavía no recibió el aviso del motorizado, horario y soporte)',
  confirmadaYaAvisado: 'Al cliente, cuando confirma después de mandar su ubicación (ya recibió el aviso completo)',
  cancelada: 'Al cliente, cuando dice que no lo quiere',
  cambio: 'Al cliente, cuando pide otro día, otra hora u otra dirección (lo sigue una persona)',
  motorizadoNuevo: 'Al motorizado, con el pedido y el cliente, para que diga en cuánto entrega (debajo van solas la ubicación del cliente y el enlace del mapa)',
  motorizadoSinUbicacion: 'Al motorizado, cuando el cliente NO mandó su ubicación pero se le dio el número del motorizado: el pedido, el teléfono y la dirección escrita del cliente (nunca una ubicación), para que coordine por teléfono y diga en cuánto entrega',
  motorizadoInsistir: 'Al motorizado, cuando no contestó',
  motorizadoPreguntarOtraVez: 'Al motorizado, cuando contestó algo que no era un tiempo',
  motorizadoGracias: 'Al motorizado, cuando dio su tiempo',
  motorizadoCancelado: 'Al motorizado, cuando el pedido pasa a otro o se cancela',
  avisoLlegada: 'Al cliente, con la hora aproximada de llegada (los minutos del motorizado más el margen)',
  motorizadoEntregado: 'Al motorizado, cuando escribe "entregado" o manda la foto',
  motorizadoNoEntregado: 'Al motorizado, cuando dice que no pudo entregar y el pedido pasa a una persona',
  motorizadoNoEntregadoPreguntamos: 'Al motorizado, cuando dice que no pudo entregar y se le está preguntando al cliente si volvemos hoy',
  clienteEntregado: 'Al cliente, cuando el motorizado dice que ya entregó (se puede apagar en los ajustes)',
  dondeEstaUbicacion: 'Al cliente que pregunta por su pedido cuando todavía falta su ubicación',
  dondeEstaConfirmacion: 'Al cliente que pregunta por su pedido cuando todavía falta que confirme',
  dondeEstaMotorizado: 'Al cliente que pregunta por su pedido cuando ya lo tiene un motorizado pero no hay hora',
  dondeEstaAvisada: 'Al cliente que pregunta por su pedido cuando ya se le dio la hora de llegada',
  dondeEstaCerca: 'Al cliente que pregunta por su pedido cuando el motorizado ya dijo que está cerca',
  dondeEstaEntregada: 'Al cliente que pregunta por su pedido cuando ya figura como entregado',
  dondeEstaNoLlego: 'Al cliente que dice que no le llegó pasada la hora (se avisa a una persona)',
  horaEnSilencio: 'Al cliente que ya recibió «Ubicación registrada» (silencio activado) y pregunta cuándo llega su pedido, cuando el motorizado ya dio sus minutos: la hora con el margen y cuánto falta, recalculado al momento. Es lo único que se le contesta; la misma pregunta no se repite antes de 10 min',
  horaEnSilencioPasada: 'Al cliente que ya recibió «Ubicación registrada» (silencio activado) y pregunta cuándo llega, cuando la hora calculada ya pasó',
  horaEnSilencioSinTiempo: 'Al cliente que ya recibió «Ubicación registrada» (silencio activado) y pregunta cuándo llega, cuando el motorizado todavía no dio sus minutos: el horario de entrega',
  segundaVisitaPreguntar: 'Al cliente, cuando el motorizado pasó y no había nadie: ¿volvemos hoy?',
  segundaVisitaSi: 'Al cliente, cuando dice que sí volvamos hoy',
  segundaVisitaNo: 'Al cliente, cuando dice que no (u otro día): lo coordina una persona',
  motorizadoSegundaVisita: 'Al motorizado, para que vuelva a pasar por un pedido (segunda visita)',
  clienteCerca: 'Al cliente, cuando el motorizado escribe "cerca" o "llegando"',
  motorizadoCerca: 'Al motorizado, cuando avisa que está cerca',
  motorizadoRuta: 'Al motorizado, la cabecera de su ruta del día (debajo van las paradas en orden)',
  clienteCambioMotorizado: 'Al cliente que ya tenía hora, cuando su pedido pasa a otro motorizado',
  motorizadoTraspaso: 'Al motorizado que no puede seguir, cuando se le quitan sus pedidos',
  motorizadoAudioSinTexto: 'Al motorizado que manda un audio que no se pudo transcribir',
  motorizadoEnlace: 'Al motorizado, con el enlace a su página de pedidos del día (botones grandes, sin instalar nada)',
  cambioUbicacionAntes: 'Al cliente que ya dio su ubicación y pide cambiarla ANTES de la hora límite (1:00 PM por defecto): se le pide la nueva',
  cambioUbicacionTarde: 'Al cliente que pide cambiar su ubicación (o manda otro pin) DESPUÉS de la hora límite: comunícate con soporte, con su número',
  ubicacionCambiada: 'Al cliente que ya había dado su ubicación y manda una NUEVA antes de la hora límite: se registró la nueva',
  ubicacionFueraDeLima: 'Al cliente cuyo pin cae fuera de Lima y Callao pero cerca (se registra y va al motorizado): va debajo de «Ubicación registrada», avisando del costo extra que le dirá el motorizado',
  ubicacionFueraDeZona: 'Al cliente cuyo pin cae muy lejos, a más de 100 km de Lima y Callao (no se registra: pasa a una persona)',
  clienteCanceladoGsg: 'Al cliente que ya tenía hora, cuando GSG cancela su pedido',
  solicitudUbicacion: 'Al cliente, el PRIMER mensaje que le pide la ubicación, con los datos del envío que manda GSG («¡Hola {nombre}! Somos GSG Courier, tengo una entrega para ti:»; la línea de un dato que no vino no sale)',
  porQueUbicacion: 'Al cliente que pregunta por qué le pedimos la ubicación (se le explica y se le vuelve a pedir)',
  cierreAgente: 'Al cliente que escribe una consulta que no es mandar su ubicación: se le manda UNA vez y el chat pasa a una persona (el asistente deja de contestar)',
  confirmarEntregaGsg: 'Al cliente de «falta confirmar» (GSG ya tiene su dirección): la pregunta SÍ/NO con los datos del envío (la línea de un dato que no vino no sale). Nunca se le pide la ubicación',
  recordarConfirmarGsg: 'Al cliente de «falta confirmar» que todavía no contestó: el recordatorio SÍ/NO',
  confirmadaGsg: 'Al cliente de «falta confirmar» que dice SÍ: queda confirmado, se le da el número y desde ahí no se le escribe más',
  noConfirmaGsg: 'Al cliente de «falta confirmar» que dice NO, otro día u otra dirección: pasa a un asesor y desde ahí no se le escribe más',
  porQueConfirmar: 'Al cliente de «falta confirmar» que pregunta por qué le escriben o desconfía (se le vuelve a pedir SÍ o NO)',
  pinLejos: 'Al cliente cuyo pin cae lejos del distrito de su pedido: se le pregunta UNA vez si es ahí (responde SÍ o NO, sin lista de opciones). La distancia se cambia en Tiempos',
  pinLejosNo: 'Al cliente que dice que NO es ahí: se le pide la ubicación correcta',
  ubicacionEnVivo: 'Al cliente que manda su ubicación en tiempo real: no se registra, se le pide la ubicación actual',
  direccionTomada: 'Al cliente que escribió su dirección y se ubicó en el mapa: va debajo de «Ubicación registrada»',
  direccionAnotada: 'Al cliente que escribió su dirección y no se pudo ubicar bien en el mapa: se guarda y se le pide el pin con amabilidad (no cuenta como insistencia)',
};
