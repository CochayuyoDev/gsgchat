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

export const ajustesEntregasSchema = z.object({
  /** Minutos que se suman a lo que dice el motorizado antes de avisar al cliente. */
  margenMinutos: z.number().int().min(0).max(240).default(60),
  /** Cada cuantos minutos se vuelve a pedir la confirmacion si no contestan. */
  confirmacionEsperaMin: z.number().int().min(5).max(24 * 60).default(120),
  /** Cuantas veces se pide la confirmacion antes de darla por perdida. */
  confirmacionMaxIntentos: z.number().int().min(1).max(6).default(3),
  /** Cuantos minutos se espera a que el motorizado conteste antes de insistir o pasar a otro. */
  motorizadoEsperaMin: z.number().int().min(1).max(180).default(10),
  /** Cuantas veces se le escribe a un mismo motorizado antes de pasar el pedido a otro. */
  motorizadoMaxIntentos: z.number().int().min(1).max(5).default(2),
  /** Cada cuantos minutos se le piden a GSG los pendientes del dia. */
  sincronizarCadaMin: z.number().int().min(1).max(24 * 60).default(5),
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
      pedirConfirmacion: z.string().max(1000).default(''),
      insistirConfirmacion: z.string().max(1000).default(''),
      preguntarOtraVez: z.string().max(1000).default(''),
      graciasYConfirmar: z.string().max(1000).default(''),
      confirmada: z.string().max(1000).default(''),
      cancelada: z.string().max(1000).default(''),
      cambio: z.string().max(1000).default(''),
      motorizadoNuevo: z.string().max(1500).default(''),
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
      dondeEstaEntregada: z.string().max(1000).default(''),
      dondeEstaNoLlego: z.string().max(1000).default(''),
      segundaVisitaPreguntar: z.string().max(1000).default(''),
      segundaVisitaSi: z.string().max(1000).default(''),
      segundaVisitaNo: z.string().max(1000).default(''),
      motorizadoSegundaVisita: z.string().max(1500).default(''),
      clienteCerca: z.string().max(1000).default(''),
      motorizadoCerca: z.string().max(1000).default(''),
      motorizadoRuta: z.string().max(1000).default(''),
      clienteCambioMotorizado: z.string().max(1000).default(''),
      motorizadoTraspaso: z.string().max(1000).default(''),
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
    motorizado: ctx.motorizado ?? '',
    placa: ctx.placa ?? '',
    minutosMotorizado: ctx.minutosMotorizado != null ? minutosEnPalabras(ctx.minutosMotorizado) : '',
    notas: ctx.notas?.trim() || '',
    horaEntregada: ctx.horaEntregada ?? '',
    situacion: ctx.situacion ?? '',
    urgente: ctx.urgente ? '🔴 URGENTE · ' : '',
    paradas: ctx.paradas != null ? String(ctx.paradas) : '',
    pedidos: ctx.pedidos ?? '',
  };
  return texto
    .replace(/\{(\w+)\}/g, (_m, clave: string) => valores[clave] ?? '')
    // "Hola , " cuando no hay nombre.
    .replace(/Hola\s*,/g, 'Hola,')
    .replace(/\s+,/g, ',')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Los textos de siempre. Se usan cuando la pantalla no guardo otros. */
export const TEXTOS_POR_DEFECTO: Record<keyof AjustesEntregas['textos'], string> = {
  pedirConfirmacion:
    'Hola {nombre}, le escribimos de {negocio}. Hoy le llevamos {pedido}. ¿Nos confirma que va a poder recibirlo? Responda SÍ para confirmar o NO si prefiere cancelarlo.',
  insistirConfirmacion:
    'Hola {nombre}, seguimos pendientes de {pedido} de {negocio}. ¿Lo recibe hoy? Responda SÍ o NO, por favor.',
  preguntarOtraVez:
    'Disculpe, no me quedó claro. ¿Recibe hoy {pedido}? Responda SÍ para confirmar, NO para cancelar, o cuéntenos si prefiere otro día u otra dirección.',
  graciasYConfirmar:
    'Gracias, recibimos su ubicación para {pedido}. Una cosa más: ¿nos confirma que va a poder recibirlo hoy? Responda SÍ o NO.',
  confirmada:
    'Perfecto, {pedido} queda confirmado para hoy. En cuanto salga el motorizado le avisamos por aquí a qué hora llega aproximadamente.',
  cancelada:
    'Entendido, dejamos {pedido} sin entregar por hoy. Si cambia de opinión, escríbanos por aquí. Gracias.',
  cambio:
    'Entendido, tomamos nota. Un compañero de {negocio} se comunicará con usted para coordinar {pedido}. Gracias.',
  motorizadoNuevo:
    '🛵 {urgente}Nuevo pedido: {pedido}\nCliente: {nombreCompleto}{distrito}\n📍 {mapa}\n{notas}\n¿En cuántos minutos lo entregas? Responde solo con los minutos (ej. 40).',
  motorizadoInsistir:
    'Hola {motorizado}, sigo esperando tu tiempo para {pedido} ({nombre}). ¿En cuántos minutos lo entregas?',
  motorizadoPreguntarOtraVez:
    'No te entendí. Para {pedido}: responde solo los minutos (ej. 40), o "no puedo" si no lo vas a llevar.',
  motorizadoGracias: 'Anotado: {pedido} en {minutosMotorizado}. Al cliente le avisamos que llega en {minutos} aprox. Gracias.',
  motorizadoCancelado: 'Ojo: {pedido} ({nombre}) ya no lo llevas tú. Gracias.',
  avisoLlegada:
    '¡{pedido} ya está en camino! 🛵 Le llega aproximadamente en {minutos}, alrededor de las {hora}. Cualquier cosa, escríbanos por aquí.',
  motorizadoEntregado: 'Perfecto, {pedido} entregado. ¡Gracias!',
  motorizadoNoEntregado: 'Anotado: {pedido} ({nombre}) no se pudo entregar. Una persona de {negocio} lo verá y te avisa qué hacer.',
  motorizadoNoEntregadoPreguntamos: 'Anotado: {pedido} ({nombre}) no se pudo entregar. Le estamos preguntando al cliente si volvemos hoy: si dice que sí, te mando el pin otra vez.',
  clienteEntregado: '¡Listo! {pedido} quedó entregado. Gracias por su compra en {negocio}. Cualquier cosa, escríbanos por aquí.',
  dondeEstaUbicacion:
    'Hola {nombre}, para poder mandarle {pedido} nos falta su ubicación. Compártanos el pin desde WhatsApp (el clip 📎 → Ubicación) o un enlace de Google Maps.',
  dondeEstaConfirmacion:
    'Hola {nombre}, {pedido} está listo para salir; solo falta que nos confirme que lo recibe hoy. Responda SÍ para confirmar o NO si prefiere cancelarlo.',
  dondeEstaMotorizado:
    'Hola {nombre}, {pedido} ya está con un motorizado. En cuanto nos diga su tiempo le avisamos por aquí a qué hora le llega.',
  dondeEstaAvisada: 'Hola {nombre}, {pedido} va en camino con {motorizado}: le llega alrededor de las {hora}. Gracias por su paciencia.',
  dondeEstaEntregada: 'Hola {nombre}, según nuestro registro {pedido} quedó entregado a las {horaEntregada}. Si no es así, escríbanos y lo revisamos enseguida.',
  dondeEstaNoLlego:
    'Disculpe la demora, {nombre}. Ya avisamos a una persona de {negocio} para que revise {pedido} y se comunique con usted por aquí.',
  segundaVisitaPreguntar:
    'Hola {nombre}, el motorizado de {negocio} pasó con {pedido} y no encontró a nadie. ¿Se lo llevamos de nuevo hoy? Responda SÍ para que vuelva a pasar, o NO si prefiere coordinar otro día.',
  segundaVisitaSi: 'Perfecto, {nombre}: el motorizado vuelve a pasar hoy con {pedido}. En cuanto nos diga su tiempo le avisamos por aquí la hora aproximada.',
  segundaVisitaNo: 'Entendido, {nombre}. Una persona de {negocio} se comunicará con usted para coordinar {pedido} otro día. Gracias.',
  motorizadoSegundaVisita:
    '🔁 {urgente}Segunda visita: {pedido}\nCliente: {nombreCompleto}{distrito} (ya está en casa)\n📍 {mapa}\n{notas}\n¿En cuántos minutos vuelves a pasar? Responde solo con los minutos (ej. 20).',
  clienteCerca: 'Hola {nombre}, {motorizado} está a unos minutos de su dirección con {pedido}. Por favor esté atento al timbre o al teléfono. ¡Gracias!',
  motorizadoCerca: 'Listo: a {nombre} le avisamos que estás por llegar con {pedido}.',
  motorizadoRuta: '🗺️ Tu ruta de hoy ({paradas} paradas), en este orden:',
  clienteCambioMotorizado: 'Hola {nombre}, hubo un cambio de motorizado para {pedido}. En un momento le confirmamos por aquí la nueva hora de llegada. Disculpe la molestia.',
  motorizadoTraspaso: 'Entendido, {motorizado}: te quitamos {pedidos} y los repartimos entre los demás. Avísanos cuando puedas volver.',
};

/** El texto que toca: el guardado desde la pantalla si lo hay, si no el de siempre. */
export function textoDe(clave: keyof AjustesEntregas['textos'], ajustes: AjustesEntregas, ctx: ContextoTexto): string {
  const propio = ajustes.textos[clave]?.trim();
  return rellenar(propio || TEXTOS_POR_DEFECTO[clave], ctx);
}

/** El texto para el motorizado, con el distrito entre paréntesis si lo hay. */
export function contextoMotorizado(ctx: ContextoTexto): ContextoTexto {
  return { ...ctx, distrito: ctx.distrito ? ` (${ctx.distrito})` : '', distritoTalCual: true, notas: ctx.notas ? `Nota: ${ctx.notas}` : '' };
}

/** Las claves cuyo texto va al motorizado (llevan el distrito entre parentesis y la nota con etiqueta). */
export const TEXTOS_PARA_MOTORIZADO: ReadonlySet<keyof AjustesEntregas['textos']> = new Set<keyof AjustesEntregas['textos']>([
  'motorizadoNuevo',
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
]);

/** Las variables que la pantalla enseña junto a cada texto. */
export const VARIABLES_TEXTOS: Record<keyof AjustesEntregas['textos'], string[]> = {
  pedirConfirmacion: ['{nombre}', '{pedido}', '{negocio}', '{direccion}', '{distrito}'],
  insistirConfirmacion: ['{nombre}', '{pedido}', '{negocio}'],
  preguntarOtraVez: ['{nombre}', '{pedido}', '{negocio}'],
  graciasYConfirmar: ['{nombre}', '{pedido}', '{negocio}'],
  confirmada: ['{nombre}', '{pedido}', '{negocio}'],
  cancelada: ['{nombre}', '{pedido}', '{negocio}'],
  cambio: ['{nombre}', '{pedido}', '{negocio}'],
  motorizadoNuevo: ['{pedido}', '{nombreCompleto}', '{nombre}', '{distrito}', '{direccion}', '{mapa}', '{lat}', '{lng}', '{notas}', '{motorizado}', '{urgente}'],
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
  dondeEstaAvisada: ['{nombre}', '{pedido}', '{negocio}', '{motorizado}', '{hora}', '{minutos}'],
  dondeEstaEntregada: ['{nombre}', '{pedido}', '{negocio}', '{horaEntregada}', '{motorizado}'],
  dondeEstaNoLlego: ['{nombre}', '{pedido}', '{negocio}', '{hora}'],
  segundaVisitaPreguntar: ['{nombre}', '{pedido}', '{negocio}', '{direccion}', '{motorizado}'],
  segundaVisitaSi: ['{nombre}', '{pedido}', '{negocio}', '{motorizado}'],
  segundaVisitaNo: ['{nombre}', '{pedido}', '{negocio}'],
  motorizadoSegundaVisita: ['{pedido}', '{nombreCompleto}', '{nombre}', '{distrito}', '{direccion}', '{mapa}', '{notas}', '{urgente}'],
  clienteCerca: ['{nombre}', '{pedido}', '{negocio}', '{motorizado}', '{placa}'],
  motorizadoCerca: ['{pedido}', '{nombre}', '{motorizado}'],
  motorizadoRuta: ['{motorizado}', '{paradas}', '{negocio}'],
  clienteCambioMotorizado: ['{nombre}', '{pedido}', '{negocio}'],
  motorizadoTraspaso: ['{motorizado}', '{pedidos}', '{negocio}'],
};

export const DESCRIPCION_TEXTOS: Record<keyof AjustesEntregas['textos'], string> = {
  pedirConfirmacion: 'Al cliente, la primera vez que se le pide confirmar el pedido de hoy',
  insistirConfirmacion: 'Al cliente, cuando no contestó y se vuelve a pedir',
  preguntarOtraVez: 'Al cliente, cuando contestó algo que no se entendió',
  graciasYConfirmar: 'Al cliente, justo después de mandar su ubicación, cuando además falta confirmar',
  confirmada: 'Al cliente, cuando confirma',
  cancelada: 'Al cliente, cuando dice que no lo quiere',
  cambio: 'Al cliente, cuando pide otro día, otra hora u otra dirección (lo sigue una persona)',
  motorizadoNuevo: 'Al motorizado, con el pin del cliente, para que diga en cuánto entrega',
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
  dondeEstaEntregada: 'Al cliente que pregunta por su pedido cuando ya figura como entregado',
  dondeEstaNoLlego: 'Al cliente que dice que no le llegó pasada la hora (se avisa a una persona)',
  segundaVisitaPreguntar: 'Al cliente, cuando el motorizado pasó y no había nadie: ¿volvemos hoy?',
  segundaVisitaSi: 'Al cliente, cuando dice que sí volvamos hoy',
  segundaVisitaNo: 'Al cliente, cuando dice que no (u otro día): lo coordina una persona',
  motorizadoSegundaVisita: 'Al motorizado, para que vuelva a pasar por un pedido (segunda visita)',
  clienteCerca: 'Al cliente, cuando el motorizado escribe "cerca" o "llegando"',
  motorizadoCerca: 'Al motorizado, cuando avisa que está cerca',
  motorizadoRuta: 'Al motorizado, la cabecera de su ruta del día (debajo van las paradas en orden)',
  clienteCambioMotorizado: 'Al cliente que ya tenía hora, cuando su pedido pasa a otro motorizado',
  motorizadoTraspaso: 'Al motorizado que no puede seguir, cuando se le quitan sus pedidos',
};
