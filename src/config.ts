/**
 * Configuracion del proceso. Se valida al arrancar y no despues: un token
 * de WhatsApp ausente debe reventar en el arranque, no a mitad de una
 * campana con la cola llena.
 */

import 'dotenv/config';
import { z } from 'zod';
import { LIMA_BBOX, LIMA_BBOX_AMPLIADA, MEXICO_BBOX } from './geo/validate.js';
import { DISTRITOS_LIMA_CALLAO } from './preventa/distritos.js';
import type { BoundingBox } from './types.js';

const csv = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url(),

  // MySQL 8 o MariaDB 10.4+: mysql://usuario:clave@host:3306/gsgchat
  // (mariadb:// vale igual). Cada tienda de la plataforma va en su propia
  // base del mismo servidor: gsgchat_t_<id>.
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => /^(mysql|mariadb):\/\//i.test(v.trim()), 'tiene que empezar por mysql:// (GSGchat guarda todo en MySQL o MariaDB)'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // Por donde sale y entra WhatsApp. `cloud` es la API oficial de Meta;
  // `waha` es un contenedor de WAHA, que se conecta con codigo QR y funciona
  // con cualquier WhatsApp, a cambio de emular WhatsApp Web (fuera de los
  // terminos de Meta, con riesgo real de baneo del numero).
  WHATSAPP_PROVIDER: z.enum(['cloud', 'waha', 'local']).default('cloud'),

  WAHA_URL: z.string().default(''),
  WAHA_API_KEY: z.string().default(''),
  WAHA_SESSION: z.string().default('default'),
  /** WEBJS | NOWEB | GOWS | WPP. Vacio = el que traiga el contenedor. */
  WAHA_ENGINE: z.string().default(''),
  /**
   * Si no aparece ningun WAHA, el sistema levanta el suyo con Docker
   * (src/whatsapp/waha/gestionado.ts). En false, hay que darle la direccion.
   */
  WAHA_AUTOARRANQUE: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  /** Puerto de esta maquina para el WAHA que levanta el sistema. */
  WAHA_PUERTO_LOCAL: z.coerce.number().int().positive().default(3001),
  /**
   * Donde manda WAHA los mensajes que llegan. Vacio = PUBLIC_BASE_URL, con
   * localhost cambiado por host.docker.internal si WAHA corre en Docker aqui
   * mismo. En docker compose es http://app:3000.
   */
  WAHA_WEBHOOK_BASE_URL: z.string().default(''),

  // Las credenciales de Meta son opcionales a proposito: el sistema arranca
  // sin ellas y las pide por pantalla en /setup. Lo que se guarde ahi tiene
  // precedencia sobre estas variables.
  /** La v21 caduca el 21/01/2027; desde la v24 el limite de mensajeria es por portafolio. */
  GRAPH_API_VERSION: z.string().default('v25.0'),
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().default(''),
  // Id de la app de Meta: hace falta para registrar el webhook por API.
  WHATSAPP_APP_ID: z.string().default(''),
  // Configuracion de registro incorporado: habilita conectar en una ventana.
  WHATSAPP_SIGNUP_CONFIG_ID: z.string().default(''),
  WHATSAPP_APP_SECRET: z.string().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().default(''),

  // Vacia = la pagina de rastreo cae a Leaflet + OpenStreetMap, sin clave.
  GOOGLE_MAPS_API_KEY: z.string().default(''),

  TRACKING_SECRET: z.string().min(32, 'TRACKING_SECRET necesita 32 caracteres o mas'),
  TRACKING_TTL_MINUTES: z.coerce.number().int().positive().default(120),

  // Warm-up del numero. Sin valor, manda el perfil de ritmo (ver
  // src/salud/politica.ts): la API oficial arranca en 50/dia y el cliente no
  // oficial en 20/dia, que es donde de verdad hay que ir con cuidado.
  WARMUP_START_PER_DAY: z.coerce.number().int().positive().optional(),
  WARMUP_GROWTH: z.coerce.number().positive().optional(),
  DAILY_SEND_CAP: z.coerce.number().int().positive().optional(),
  /** Dias sin enviar nada tras los que el warm-up vuelve a empezar. */
  WARMUP_REINICIO_DIAS: z.coerce.number().int().nonnegative().optional(),
  MAX_MARKETING_PER_CONTACT_7D: z.coerce.number().int().nonnegative().default(2),

  // --- ritmo y salud del numero (ver src/salud) --------------------------
  //
  // Todo esto tiene un valor por defecto segun el perfil (cloud / no oficial)
  // y solo hace falta tocarlo para afinar. Lo que NO se puede hacer es
  // apagarlo: no hay variable que quite las guardas.

  /** auto = segun el proveedor; cloud | no_oficial para forzarlo. */
  RITMO_PERFIL: z.enum(['auto', 'cloud', 'no_oficial']).default('auto'),
  /** Envios iniciados por la empresa por minuto y por hora. */
  RITMO_MAX_POR_MINUTO: z.coerce.number().int().positive().optional(),
  RITMO_MAX_POR_HORA: z.coerce.number().int().positive().optional(),
  /** Pausa entre dos envios iniciados por la empresa, en segundos; se sortea. */
  RITMO_PAUSA_MIN_SEG: z.coerce.number().nonnegative().optional(),
  RITMO_PAUSA_MAX_SEG: z.coerce.number().nonnegative().optional(),
  /** Contactos a los que se escribe por primera vez, por dia. 0 = sin limite. */
  RITMO_NUEVOS_CONTACTOS_DIA: z.coerce.number().int().nonnegative().optional(),
  /** Mensajes iniciados por la empresa al mismo contacto por dia. */
  RITMO_MAX_POR_CONTACTO_DIA: z.coerce.number().int().positive().optional(),
  /** Minutos minimos entre dos mensajes automaticos al mismo contacto. */
  RITMO_SEPARACION_CONTACTO_MIN: z.coerce.number().nonnegative().optional(),
  /** Fraccion del tier de Meta que se usa como techo propio (0.9 = 90 %). */
  RITMO_FRACCION_TIER: z.coerce.number().positive().max(1).optional(),

  /**
   * Horario en el que sale lo iniciado por la empresa (campanas, secuencias,
   * rutas). Responder a un cliente dentro de su ventana no tiene horario.
   */
  /**
   * Cuanto se espera a que el cliente termine de escribir, en milisegundos.
   *
   * Quien escribe por WhatsApp manda tres trozos seguidos, y contestar a cada
   * uno le deja tres respuestas encima sin haber dicho nada en medio.
   *
   * Antes el valor de fabrica era 0 -contestar a cada mensaje- porque esperar mete un
   * retraso en CADA respuesta, y eso lo tiene que decidir quien monta el
   * sistema. El arranque corto lo pone en 4 s, que es lo que se tarda en
   * escribir la segunda frase.
   */
  // 10 s de fabrica (decision del dueño, 05/10): se contesta la rafaga entera
  // de una vez. En las pruebas, 0, para no esperar en cada mensaje.
  RAFAGA_MS: z.coerce.number().int().min(0).max(60_000).default(process.env.VITEST ? 0 : 10_000),
  HORARIO_ENVIO_INICIO: z.coerce.number().int().min(0).max(23).optional(),
  HORARIO_ENVIO_FIN: z.coerce.number().int().min(1).max(24).optional(),
  /** Dias permitidos, 0 = domingo. Por defecto lunes a sabado. */
  HORARIO_ENVIO_DIAS: z.string().default(''),

  /** Simular escritura (typing) y pausas humanas con el cliente no oficial. */
  HUMANIZAR: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),

  /** El monitor puede pausar el numero solo cuando el riesgo llega a rojo. */
  SALUD_AUTO_PAUSA: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),
  SALUD_PAUSA_ROJA_MIN: z.coerce.number().int().positive().optional(),
  SALUD_RAMPA_MIN: z.coerce.number().int().positive().optional(),
  SALUD_MAX_FALLOS_PCT: z.coerce.number().nonnegative().max(100).optional(),
  SALUD_MAX_SIN_WHATSAPP_PCT: z.coerce.number().nonnegative().max(100).optional(),
  SALUD_MAX_BAJAS_PCT: z.coerce.number().nonnegative().max(100).optional(),
  SALUD_MIN_ENTREGA_PCT: z.coerce.number().nonnegative().max(100).optional(),
  SALUD_MAX_QUEJAS_PCT: z.coerce.number().nonnegative().max(100).optional(),
  SALUD_MIN_ENVIOS_JUZGAR: z.coerce.number().int().positive().optional(),
  /** Envios seguidos sin respuesta a partir de los cuales el contacto descansa de marketing. */
  SALUD_FATIGA_ENVIOS: z.coerce.number().int().positive().optional(),
  SALUD_FATIGA_DESCANSO_DIAS: z.coerce.number().int().positive().optional(),
  /** Plantilla recien aprobada: pacing propio durante sus primeros dias. */
  PLANTILLA_NUEVA_DIAS: z.coerce.number().int().nonnegative().optional(),
  PLANTILLA_NUEVA_POR_DIA: z.coerce.number().int().nonnegative().optional(),
  /** A quien avisar por WhatsApp cuando el numero cambia de nivel. Vacio = RUTAS_SUPERVISOR. */
  SALUD_AVISAR_A: z.string().default(''),

  /**
   * Modo prueba: solo se escribe a estos numeros, separados por coma.
   *
   * Vacio = a todos (produccion). Con lista, CUALQUIER envio a un numero que
   * no este -campana, secuencia, rutas, chat a mano, respuesta del
   * asistente- se bloquea y queda anotado como `allowlist`. Es la red para
   * probar contra WhatsApp de verdad sin escribirle a un cliente por error.
   */
  SOLO_NUMEROS: z.string().default(''),

  OPT_OUT_KEYWORDS: z.string().default('baja,stop,cancelar,unsubscribe'),
  OPT_IN_KEYWORDS: z.string().default('alta,acepto'),

  // El sistema se opera desde Peru: la caja por defecto es Lima y Callao.
  GEO_BBOX: z.enum(['lima', 'mexico', 'none']).default('lima'),

  /**
   * Como se llama la zona que se atiende, para decirselo al cliente.
   *
   * Un "queda fuera de la zona que atendemos" a secas obliga a preguntar cual
   * es. Con el nombre puesto, quien esta fuera lo sabe en el mismo mensaje y
   * quien esta dentro no vuelve a preguntar.
   */
  COVERAGE_NAME: z.string().default(''),

  /** Como se presenta la tienda al cliente. */
  BUSINESS_NAME: z.string().default('nuestra tienda'),

  /** Horario de atencion, tal cual se le dice al cliente. */
  BUSINESS_HOURS: z.string().default('lunes a sabado de 9:00 a 19:00'),

  /**
   * Zona horaria del negocio, para los saludos y las fechas.
   *
   * El servidor puede estar en cualquier parte; lo que importa es que hora es
   * para el cliente. Sin esto, un "buenos dias" sale de madrugada.
   */
  TIMEZONE: z.string().default('America/Lima'),

  /**
   * Intentar botones nativos (native flow) con el cliente local.
   *
   * Apagado, y con motivo: probado contra una cuenta personal de WhatsApp, el
   * mensaje interactivo llega como "No se pudo cargar este mensaje. Abre el
   * mensaje en tu telefono para verlo" en WhatsApp Web, y en el telefono no
   * aparece nada. Es peor que no tener botones: WhatsApp acepta el envio, asi
   * que se da por bueno y la degradacion a texto nunca llega a saltar; el
   * cliente recibe un mensaje roto y el operador ve un doble check.
   *
   * Se deja encendible por si con una cuenta de WhatsApp Business, u otra
   * version del cliente, si se pintan.
   */
  /**
   * Habilita /admin/dev/inbound, que finge un mensaje entrante.
   *
   * Solo para probar la conversacion de punta a punta. Apagado por defecto:
   * un endpoint que finge mensajes de cualquier numero no tiene por que
   * existir en produccion, aunque este detras del token de admin.
   */
  /**
   * Donde corre Stoky, y con que token se le pregunta.
   *
   * El catalogo -precios y stock- vive alli, no aqui: copiarlo significaria
   * cotizar con precios viejos el dia que alguien los suba. Vacio = el
   * asistente sigue funcionando y simplemente no cotiza.
   *
   * El token sale de `php scripts/conexion-whatsapp.php <tienda>` en Stoky.
   */
  STOKY_URL: z.string().default(''),
  /**
   * La direccion del panel de Stoky, para mandar a registrar la venta.
   *
   * Es distinta de STOKY_URL: aquella es la API que se consulta desde el
   * servidor, y esta la que abre el operador en su navegador. En una maquina
   * son la misma, pero en cuanto Stoky corra detras de un proxy dejan de
   * serlo, y mandar al operador a la URL interna le da una pantalla en blanco.
   */
  STOKY_PANEL_URL: z.string().default(''),
  STOKY_TOKEN: z.string().default(''),

  /**
   * Donde se guardan los respaldos de conversacion.
   *
   * Fuera de la base a proposito: cerrar un chat existe para que la base deje
   * de crecer, y ademas un fichero se copia a otro disco. Si Meta borra el
   * numero, lo hablado sigue estando aqui.
   */
  ARCHIVE_DIR: z.string().default('respaldos'),

  /**
   * Dias sin mensajes tras los que una conversacion se cierra sola.
   *
   * 0 = nunca; solo se cierra a mano o al cerrar la ficha. El valor por
   * defecto son 60 dias: dos meses sin hablar es una conversacion terminada
   * en cualquier negocio de atencion.
   */
  ARCHIVE_INACTIVE_DAYS: z.coerce.number().int().nonnegative().default(60),

  /** Respaldar y limpiar en cuanto la ficha pasa a enviada o descartada. */
  ARCHIVE_ON_LEAD_CLOSE: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),

  // --- rutas: solicitud de ubicacion por lotes -------------------------

  /**
   * Pausa entre un mensaje y el siguiente, en segundos.
   *
   * Se sortea entre los dos valores en cada envio. No es una precaucion
   * teorica: doscientos mensajes seguidos con el mismo texto es el patron que
   * WhatsApp usa para bloquear una cuenta, y un numero bloqueado se lleva por
   * delante el trabajo del dia entero.
   */
  RUTAS_PAUSA_MIN_SEG: z.coerce.number().int().positive().default(15),
  RUTAS_PAUSA_MAX_SEG: z.coerce.number().int().positive().default(30),

  /**
   * Cuanto se espera una respuesta antes de volver a escribir, en minutos.
   * Tres horas: es lo que hace que el sistema escriba como una persona y no
   * como un robot, y lo que evita llegar al cupo del dia (ver
   * src/envio-automatico).
   */
  RUTAS_ESPERA_MIN: z.coerce.number().int().positive().default(180),

  /**
   * Mientras el cliente no mande su ubicacion, se le vuelve a pedir cada
   * tantos minutos, sin tope de mensajes (solo dentro del horario), y lo que
   * escriba que no sea su ubicacion no se contesta. 0 = como antes: la espera
   * de RUTAS_ESPERA_MIN y RUTAS_MAX_INTENTOS mensajes.
   */
  RUTAS_PEDIR_UBI_CADA_MIN: z.coerce.number().int().min(0).max(24 * 60).default(15),

  /** Mensajes por cliente antes de pasarlo al repartidor. */
  RUTAS_MAX_INTENTOS: z.coerce.number().int().positive().max(3).default(3),

  /** Franja horaria en la que el motor puede escribir (hora del negocio). */
  RUTAS_HORA_INICIO: z.coerce.number().int().min(0).max(23).default(9),
  RUTAS_HORA_FIN: z.coerce.number().int().min(1).max(24).default(19),

  /** Plan de numeracion con el que se revisan los telefonos del lote. */
  RUTAS_PAIS: z.enum(['peru', 'mexico', 'generico']).default('peru'),

  /**
   * A quien se avisa por WhatsApp cuando hay casos parados.
   *
   * El coordinador del reparto, o quien vaya a resolverlos. Vacio = no se
   * avisa a nadie y todo queda en la pantalla; con numero, llega un mensaje
   * al movil, que es donde se entera de verdad quien esta en la calle.
   */
  RUTAS_SUPERVISOR: z.string().default(''),
  /** Casos parados a partir de los cuales se avisa. */
  RUTAS_ALERTA_MIN_CASOS: z.coerce.number().int().positive().default(1),
  /** Cada cuantos minutos, como mucho, se avisa al coordinador. */
  RUTAS_ALERTA_CADA_MIN: z.coerce.number().int().positive().default(60),
  /** Cada cuantos minutos se le manda a GSG el avance del lote. */
  RUTAS_RESUMEN_CADA_MIN: z.coerce.number().int().positive().default(30),

  /**
   * La conexion SALIENTE con GSG (GSGchat -> GSG). Vacia = todavia no esta
   * conectada (o se conecta desde la pantalla Conexion, que manda sobre esto).
   *
   * Sin ella el sistema funciona igual y todo lo reportable se acumula en la
   * cola (`rutas_reportes`). El dia que exista, se rellena esto y se vacia la
   * cola entera, incluido lo de atras. Ver src/rutas/gsg.ts.
   *
   *  - GSG_URL: la URL base de su API (p. ej. https://backend.gsg.pe/api/).
   *  - GSG_LOCATION_PATH: la ruta para enviar la ubicacion, relativa a la
   *    base (p. ej. v1/gsgchat/location). Vacia = sendLocation.
   *  - GSG_API_KEY: la clave que da GSG; sale solo en la cabecera X-API-Key.
   *  - GSG_TOKEN y GSG_SEND_LOCATION_URL: ANTIGUOS, se leen por compatibilidad
   *    (la clave si no hay GSG_API_KEY; la URL completa se convierte a base +
   *    ruta solo si es inequivoco).
   */
  GSG_URL: z.string().default(''),
  GSG_LOCATION_PATH: z.string().default(''),
  GSG_IDEMPOTENCY_SUPPORTED: z.enum(['true', 'false']).default('false'),
  GSG_API_KEY: z.string().default(''),
  GSG_TOKEN: z.string().default(''),
  GSG_SEND_LOCATION_URL: z.union([z.string().url(), z.literal('')]).default(''),

  /**
   * Modo demostracion: los mensajes NO salen a WhatsApp.
   *
   * Lo enciende `npm run demo`, que corre con un cliente de mentira y datos en
   * memoria. Existe para que las pantallas lo digan bien grande: un envio en
   * la demo se apunta como "enviado" igual que uno de verdad, y sin el aviso
   * es imposible distinguir una demostracion de un sistema que no entrega.
   */
  DEMO_MODE: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform(() => false),

  DEV_SIMULATE_INBOUND: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  WHATSAPP_NATIVE_BUTTONS: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  /**
   * En el SaaS: donde pregunta esta tienda por su plan (el maestro) y su
   * token. Sin PLAN_URL no hay plan y todo esta permitido. Ver src/plan.
   */
  PLAN_URL: z.string().default(''),
  PLAN_TOKEN: z.string().default(''),
  /**
   * Cuando este panel controla tiendas (src/tiendas) y las levanta en este
   * servidor: la direccion con la que esas instalaciones llegan a este panel
   * para preguntar por su plan, si no es la publica (dentro de la red de
   * Docker, por ejemplo http://host.docker.internal:3000). Vacio = la publica.
   */
  TIENDAS_URL_PLAN_BASE: z.string().default(''),
});

export type RawConfig = z.infer<typeof schema>;

export interface Config extends RawConfig {
  optOutKeywords: string[];
  optInKeywords: string[];
  bbox?: BoundingBox;
  /** Lima y Callao: dentro de `bbox` pero fuera de aqui, el pin se registra y lleva un costo extra. */
  zonaSinExtra?: BoundingBox;
  /** Nombre de la zona atendida, para los mensajes al cliente. */
  coverageName: string;
  /** Zona horaria del negocio: decide el saludo y las fechas. */
  timezone: string;
  /** Distritos aceptados como destino. Vacio = texto libre. */
  distritos: string[];
  /** Nombre con el que se presenta la tienda. */
  businessName: string;
  /** Horario de atencion, para contestarlo sin que lo pregunten dos veces. */
  businessHours: string;
  /** Dias de la semana en los que sale lo iniciado por la empresa (0 = domingo). */
  horarioEnvioDias: number[];
  /** Modo prueba: numeros a los que se puede escribir. Vacio = todos. */
  soloNumeros: string[];
}

/** Que es cada variable obligatoria, para que el error del arranque diga que poner. */
const QUE_ES: Record<string, string> = {
  PUBLIC_BASE_URL: 'la dirección pública de este servidor, con https, por ejemplo https://gsgchat.midominio.com (es la que ven WhatsApp y GSG)',
  DATABASE_URL: 'dónde guardar los datos: el servidor MySQL o MariaDB y la base, mysql://usuario:clave@host:3306/gsgchat (en esta PC, con XAMPP: mysql://root@127.0.0.1:3306/gsgchat)',
  TRACKING_SECRET: 'una clave larga y secreta cualquiera (firma los enlaces): por ejemplo, 32 letras y números al azar',
};

/**
 * Si la direccion publica sirve para produccion. Con ella salen los enlaces
 * que llegan por WhatsApp (la pagina del motorizado, la evidencia de una
 * conversacion) y la que se le da a GSG para sus avisos: con localhost o sin
 * https, nada de eso abre fuera de esta maquina. null = esta bien.
 */
export function avisoDireccionPublica(url: string): string | null {
  const limpia = (url ?? '').trim();
  if (!limpia) return 'no hay dirección pública (PUBLIC_BASE_URL): los enlaces que salen por WhatsApp y los avisos de GSG no tendrán a dónde apuntar.';
  let host = '';
  try {
    host = new URL(limpia).hostname.toLowerCase();
  } catch {
    return `la dirección pública «${limpia}» no es una dirección web válida.`;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host.endsWith('.local') || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host)) {
    return `la dirección pública es ${limpia}, que solo abre en esta máquina: los enlaces que llegan por WhatsApp (evidencias y seguimiento) y los avisos de GSG no funcionarán fuera de aquí. En producción pon PUBLIC_BASE_URL con el dominio https.`;
  }
  if (!limpia.toLowerCase().startsWith('https://')) return `la dirección pública ${limpia} no usa https: WhatsApp y GSG la verán como insegura. Pon el certificado y usa https://.`;
  return null;
}

function explicarVariable(nombre: string, mensaje: string): string {
  const que = QUE_ES[nombre];
  const falta = /required/i.test(mensaje) ? 'falta' : mensaje;
  return que ? `${falta} — ${que}` : mensaje;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${explicarVariable(i.path.join('.'), i.message)}`).join('\n');
    throw new Error(`Configuracion invalida (revisa el fichero .env o las variables del contenedor):\n${detail}`);
  }

  const raw = parsed.data;
  return {
    ...raw,
    optOutKeywords: csv(raw.OPT_OUT_KEYWORDS),
    optInKeywords: csv(raw.OPT_IN_KEYWORDS),
    // La zona en la que se acepta un pin. Con Lima, Lima y Callao mas unos
    // 100 km: lo de fuera de Lima y Callao se registra y lleva un extra
    // (`zonaSinExtra`), que cobra el motorizado.
    bbox: raw.GEO_BBOX === 'lima' ? LIMA_BBOX_AMPLIADA : raw.GEO_BBOX === 'mexico' ? MEXICO_BBOX : undefined,
    zonaSinExtra: raw.GEO_BBOX === 'lima' ? LIMA_BBOX : undefined,
    timezone: raw.TIMEZONE,
    // Con cobertura de Lima, los distritos se validan contra los que existen.
    // Fuera de ahi no hay lista que valga y el campo acepta texto libre.
    // Con cobertura de Lima, o simplemente operando en Peru (RUTAS_PAIS), los
    // distritos se validan contra los que existen. Sin lista, cualquier
    // frase se guardaba como distrito: "Q rico aprietas bb" salio en una
    // ficha de verdad.
    distritos: raw.GEO_BBOX === 'lima' || raw.RUTAS_PAIS === 'peru' ? DISTRITOS_LIMA_CALLAO : [],
    businessName: raw.BUSINESS_NAME,
    businessHours: raw.BUSINESS_HOURS,
    // Vacio = lo que diga el perfil (lunes a sabado). Sin el filter(Boolean),
    // ''.split(',') es [''] y Number('') es 0: el sistema solo enviaba los
    // domingos y todo lo demas salia como "fuera de horario".
    horarioEnvioDias: raw.HORARIO_ENVIO_DIAS.split(',')
      .map((d) => d.trim())
      .filter(Boolean)
      .map(Number)
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    soloNumeros: [],
    coverageName:
      raw.COVERAGE_NAME.trim() ||
      (raw.GEO_BBOX === 'lima' ? 'todo Lima y Callao' : raw.GEO_BBOX === 'mexico' ? 'Mexico' : ''),
  };
}
