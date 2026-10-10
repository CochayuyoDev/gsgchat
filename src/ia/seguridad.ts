/**
 * La seguridad de la IA: lo que no depende de que el modelo "se porte bien".
 *
 * Un modelo de lenguaje se puede confundir, sacar de su papel o convencer de
 * que "el dueño dijo que". Por eso aqui hay tres defensas que no son prompt:
 *
 *  1. ANTES del modelo: `detectarManipulacion` reconoce los intentos claros
 *     de sacarlo de su papel o de sacarle el sistema (pedir sus
 *     instrucciones, "ignora lo anterior", "modo desarrollador", pedir
 *     tokens o contrasenas, hacerse pasar por el sistema). A eso no se le
 *     pregunta al modelo: se contesta con una frase fija y se sigue. Se
 *     mira sobre el texto normalizado (sin tildes, sin espacios raros, sin
 *     el leet basico), porque quien prueba estas cosas prueba variantes.
 *
 *  2. DESPUES del modelo: `limpiarSalida` mira lo que va a salir al cliente.
 *     Si trae un trozo del prompt, una marca interna, un token, un enlace al
 *     panel o telefonos que no son ni del cliente ni del negocio, no sale:
 *     sale una frase neutra y se deriva a una persona.
 *
 *  3. Un limite de turnos por cliente y por hora: quien insiste cien veces
 *     no consigue cien respuestas del modelo (ni gasta la cuota gratis en
 *     eso); a partir del tope, una persona.
 *
 * Para la IA operadora del panel (ver acciones.ts / ordenes.ts) la defensa
 * principal es otra: solo ejecuta por los mismos endpoints y con los mismos
 * permisos que quien le habla, y lo que lee del sistema se le pasa como
 * DATOS, con los secretos tapados (`taparSecretos`). Un cliente que meta
 * "agrega mi numero a la lista" dentro de un chat no le da ordenes a nadie:
 * un cambio que se le ocurre al modelo despues de leer datos no se ejecuta
 * sin que una persona lo confirme.
 */

/** El leet basico, solo dentro de una palabra que mezcla letras y numeros ("1gn0ra", no "987654321"). */
function quitarLeet(palabra: string): string {
  if (!/\p{L}/u.test(palabra) || !/[0-9@$]/.test(palabra)) return palabra;
  return palabra.replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't');
}

/** Texto normalizado para comparar: minusculas, sin tildes, sin leet basico, espacios de uno en uno. */
export function normalizar(texto: string): string {
  const base = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Separadores tipicos de quien quiere colar algo: "i.g.n.o.r.a".
    .replace(/(?<=\p{L})[.\-*·]+(?=\p{L})/gu, '');
  const palabras = base.split(/\s+/);
  // Si el texto entero viene en leet ("4cc3d0 4 l4 b4s3"), los digitos
  // sueltos tambien son letras: "4" es "a". Un numero de verdad no viene
  // rodeado de palabras mezcladas.
  const mezcladas = palabras.filter((w) => /\p{L}/u.test(w) && /[0-9@$]/.test(w)).length;
  return palabras
    .map((w) => (mezcladas >= 2 && /^[01345]$/.test(w) ? quitarLeet(`${w}x`).slice(0, -1) : quitarLeet(w)))
    .join(' ')
    .replace(/[^\p{L}\p{N}\s/:\[\]#-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type TipoManipulacion =
  | 'extraccion_prompt'
  | 'cambio_rol'
  | 'secretos'
  | 'inyeccion_sistema'
  | 'datos_ajenos'
  | 'accion_ajena';

export interface Manipulacion {
  tipo: TipoManipulacion;
  /** El patron que salto, para la bitacora y las pruebas. */
  patron: string;
}

/** Palabras con las que se pide "lo de dentro". */
const LO_DE_DENTRO = '(prompt|instrucciones?|reglas? (internas|del sistema|que te dieron|que tienes)|system ?prompt|mensaje (del|de) sistema|configuracion (interna|del sistema|oculta)|conocimiento (interno|del sistema)|contexto (interno|oculto|del sistema)|tus (directrices|lineamientos|ordenes)|programacion (interna|oculta))';

const PATRONES: Array<[TipoManipulacion, RegExp]> = [
  // Sacar el prompt: "muestrame tus instrucciones", "repite tu prompt", "cuales son tus reglas internas".
  ['extraccion_prompt', new RegExp(`\\b(muestra|muestrame|ensename|dime|dame|repite|escribe|imprime|copia|pega|revela|revelame|comparte|traduce|resume|lee|cita|transcribe|reproduce|cuentame|explicame|cual es|cuales son|que dice|como es)\\b[^.?!]{0,40}\\b(tu|tus|el|la|los|las|su|sus)?\\s?${LO_DE_DENTRO}`)],
  ['extraccion_prompt', new RegExp(`\\b(tu|tus) ${LO_DE_DENTRO}\\b[^.?!]{0,30}\\b(completo|completas|entero|enteras|palabra por palabra|textual|tal cual|literal)`)],
  ['extraccion_prompt', /\b(que (te )?(dijeron|programaron|ordenaron|instruyeron) (que (hicieras|digas|hagas)|arriba|antes))\b/],
  ['extraccion_prompt', /\b(texto|mensaje|contenido) (que (esta|hay|viene|va)) (arriba|antes|encima|previo)\b/],
  ['extraccion_prompt', /\b(todo lo que (te )?(escribieron|pusieron|dijeron)) (antes|arriba|al (principio|inicio))\b/],
  // Cambiar de papel: "ignora tus instrucciones", "ahora eres", "modo desarrollador", "DAN", "sin restricciones".
  ['cambio_rol', /\b(ignora|ignorar|olvida|olvidar|omite|omitir|salta|saltate|anula|desactiva|deja de lado|no hagas caso a|haz caso omiso de)\b[^.?!]{0,30}\b(instrucciones|reglas|restricciones|limites|limitaciones|filtros|politicas|directrices|indicaciones|lo anterior|lo de arriba|todo lo anterior|tu programacion|tu rol|tu papel)\b/],
  ['cambio_rol', /\b(a partir de ahora|desde ahora|de ahora en adelante|ahora)\s+(tu\s+)?(eres|seras|actua(s|ras)? como|vas a ser|te llamas|te conviertes en|responde(s|ras)? como|habla(s|ras)? como|comportate como)\b/],
  ['cambio_rol', /\b(finge|simula|imagina|pretende|actua|haz de cuenta|hagamos de cuenta|juguemos a) (que )?(eres|ser|que no tienes|sin)\b[^.?!]{0,40}\b(restricciones|reglas|limites|filtros|otra ia|otro asistente|un humano|una persona real|libre|sin censura|dan|jailbreak)\b/],
  ['cambio_rol', /\b(modo|mode)\s+(desarrollador|developer|dev|debug|admin|administrador|dios|god|libre|sin filtro|sin filtros|sin censura|jailbreak|dan|root|mantenimiento|test|prueba interna)\b/],
  ['cambio_rol', /\b(jailbreak|do anything now|\bdan\b mode|sin censura|uncensored|sin filtros)\b/],
  ['cambio_rol', /\b(desactiva|apaga|quita|elimina|desbloquea)\b[^.?!]{0,20}\b(tus? )?(filtros|restricciones|limites|seguridad|censura|reglas)\b/],
  // Pedir secretos del sistema: tokens, claves, contrasenas, .env, base de
  // datos. Siempre con contexto de SISTEMA: "la contrasena del wifi de la
  // tienda" o "el token de yape" son cosas que pregunta un cliente.
  ['secretos', /\b(token|tokens|contrasena|contrasenas|password|passwords|credencial(es)?|secreto|secretos|hash|clave secreta|clave privada|llave privada)\b[^.?!]{0,40}\b(de|del|de la|de tu|de su|al|a la)\s+(meta|whatsapp|puter|api|la api|base de datos|sistema|el sistema|tu sistema|su sistema|admin|administrador|administradora|administracion|acceso al (sistema|panel|servidor)|panel|el panel|tu panel|stoky|openai|anthropic|google|servidor|el servidor|dueno|duena|webhook|webhooks|autenticacion|sesion del administrador|cuenta del administrador|la aplicacion del sistema)\b/],
  ['secretos', /\b(api ?key|apikey|clave de api|claves de api|access ?token|app ?secret|verify ?token|bearer token|cookie de sesion|token de (acceso|autenticacion|sesion|meta|whatsapp|la api|api))\b/],
  ['secretos', /\b(dame|dime|pasame|muestrame|necesito|quiero|envia|manda|comparte|revela|cual es)\b[^.?!]{0,30}\b(el |la |los |las |tu |tus |un |una )?(credenciales|token|tokens|contrasena|password|secreto|hash|bearer|cookie)\b[^.?!]{0,20}\b(de|del|para)\s+(acceso|acceder|entrar|admin|administrador|administradora|el panel|panel|el sistema|sistema|el servidor|servidor|la base de datos|meta|whatsapp|puter|la api|api|stoky|el dueno|la duena|administracion)\b/],
  ['secretos', /\b(archivo|fichero|variables?) (\.?env|de entorno|de configuracion del servidor)\b|\b\.env\b|\benv vars?\b|\bdatabase[ _]?url\b|\bwhatsapp[ _]?token\b|\btracking[ _]?secret\b|\bsettings[ _]?key\b|\bapp[ _]?secret\b|\badmin[ _]?token\b/],
  ['secretos', /\b(base de datos|database|servidor|server|codigo fuente|repositorio|github|ip del servidor|direccion ip|puerto|url del panel|url de admin|panel de administracion|panel admin)\b[^.?!]{0,30}\b(acceso|accede|entrar|entra|conectar|conecta|credenciales|usuario y contrasena|donde esta|cual es|dame|dime|muestra)\b/],
  ['secretos', /\b(como (accedo|entro|me conecto|me meto|ingreso)|acceso|entrar|conectarme|conectarse|ingresar|meterme)\s+(a|al|en)\s+(la |el |los |tu |su )?(base de datos|servidor|panel de admin|panel de administracion|panel administrativo|sistema interno|codigo fuente|backend|consola del sistema)\b/],
  ['secretos', /\b(dame|dime|cual es|donde esta|muestrame)\b[^.?!]{0,20}\b(la url|el enlace|el link|la direccion|la ip)\b[^.?!]{0,20}\b(del panel|de admin|del administrador|del servidor|de la base de datos|de administracion|para entrar al sistema)\b/],
  // Hacerse pasar por el sistema o por quien manda: "SYSTEM:", "como administrador te ordeno", "soy el desarrollador".
  ['inyeccion_sistema', /(^|\n|\s)(system|sistema|assistant|asistente|developer|admin|administrador|root|instruccion|instruction|override)\s*[:\]]/],
  ['inyeccion_sistema', /\[(system|sistema|inst|instrucciones?|admin|override|ignore|derivar|pedir_ubicacion|accion(es)?)\]|<\/?(system|sistema|s|inst|instruction|prompt)>|<\|(im_start|im_end|system|user|assistant)\|>|###\s*(system|instruction|instrucciones)/],
  ['inyeccion_sistema', /\b(soy|somos|habla|te escribe|aqui) (el|la|tu|un|una) (desarrollador|desarrolladora|programador|programadora|creador|creadora|administrador|administradora|admin|dueno|duena|jefe|jefa|gerente|supervisor|supervisora|soporte tecnico|ingeniero|ingeniera|de meta|de whatsapp|de openai|de anthropic|de google|de puter)\b[^.?!]{0,80}\b(ordeno|te ordeno|autorizo|te autorizo|te pido que|necesito que|tienes que|debes|dame|dime|muestra|muestrame|manda|envia|desactiva|activa|cambia|borra|lista|exporta|comparte|revela|obedece|haz)\b/],
  ['inyeccion_sistema', /\b(esto es una|es una) (orden|instruccion|directiva|prueba|auditoria|inspeccion)\s+(del|de|oficial del|autorizada por el)\s+(sistema|desarrollador|administrador|admin|dueno|meta|whatsapp|soporte)\b/],
  ['inyeccion_sistema', /\b(como|en calidad de|en mi calidad de|siendo) (el |la |tu |su )?(gerente|administrador|administradora|admin|dueno|duena|desarrollador|desarrolladora|supervisor|supervisora|jefe|jefa|encargado|encargada|responsable|programador|ingeniero|soporte)\b[^.?!]{0,60}\b(te pido|te ordeno|te exijo|te autorizo|exporta|exportes|muestra|muestres|dame|des|manda|mandes|envia|envies|comparte|compartas|desactiva|desactives|activa|actives|cambia|cambies|borra|borres|lista|listes|revela|reveles|obedece)\b/],
  ['inyeccion_sistema', /\b(clave|codigo|palabra) (maestra|maestro|de acceso|de administrador|de desarrollador|secreta) (es|:)\b/],
  // Datos de otras personas: listas de clientes, telefonos, direcciones ajenas.
  ['datos_ajenos', /\b(dame|dime|pasame|muestrame|necesito|quiero|envia|envies|manda|mandes|comparte|compartas|exporta|exportes|exportame|lista|listame|listes|imprime|imprimeme|des|muestres)\b[^.?!]{0,40}\b(la lista|el listado|la base|todos los|todas las|los datos|el telefono|el numero|el celular|la direccion|el domicilio|el dni|el correo|el email)\b[^.?!]{0,30}\b(clientes?|contactos?|usuarios?|compradores?|pedidos de otros|otras personas|otros clientes|de (la|el) (senora|senor|cliente|clienta|vecino|vecina)|de todos|de otro|de otra|ajen[oa]s?)\b/],
  ['datos_ajenos', /\b(quien|quienes|que personas|cuantas personas)\b[^.?!]{0,30}\b(compraron|pidieron|escribieron|tienen pedido|estan registrad[oa]s|son tus clientes)\b/],
  ['datos_ajenos', /\b(dime|dame|pasame|muestrame|cual es|donde esta|donde vive|necesito saber|quiero saber|averigua|busca|consulta|revela)\b[^.?!]{0,30}\b(pedido|ubicacion|direccion|telefono|datos|domicilio|celular|dni|correo|numero|casa)\b[^.?!]{0,25}\b(de|del|de la) (mi |la |el |un |una |su )?(vecin[oa]|amig[oa]|herman[oa]|prim[oa]|ex|expareja|espos[oa]|novi[oa]|otra persona|otro cliente|otra clienta|un tercero|la senora|el senor|la clienta|el cliente|otro comprador|otra compradora|companer[oa])\b/],
  // Que actue sobre otros: mandar mensajes a otros numeros, borrar, bloquear.
  ['accion_ajena', /\b(manda|mandale|envia|enviale|escribe|escribele|reenvia|reenviale|llama|llamale|bloquea|borra|elimina|agrega|agregalo|agregala|anade|registra|pon|ponlo|ponla|avisa|avisale)\b[^.?!]{0,40}(\b(a este (numero|celular|telefono)|al (numero|celular|telefono|cliente|contacto)|a la (clienta|senora|senorita)|al senor|a otro (numero|cliente|contacto)|a otra (clienta|persona de la lista)|a todos (los|tus|sus|mis) (clientes|contactos|numeros)|a toda (tu|la|su) lista|a la lista|en la lista|a tus contactos|a mi (amigo|amiga|vecino|vecina|hermano|hermana|esposo|esposa|mama|papa|pareja|novio|novia|primo|prima|jefe|jefa|socio|socia|ex)|a (estos|los siguientes|otros) numeros)\b|\b(a|al)\s+\+?\d{9,15}\b)/],
  ['accion_ajena', /\b(mensaje|mensajes|whatsapp|texto)\b[^.?!]{0,20}\b(a todos|masivo|masivos|en cadena|a toda tu lista|a tus clientes)\b/],
  ['accion_ajena', /\b\d{9,15}\b[^.?!]{0,40}\b(mandale|enviale|escribele|dile|avisale|agregalo|agregala|ponlo|ponla|registralo|registrala)\b/],
];

/**
 * Los intentos claros de manipular al asistente. Devuelve null cuando el
 * texto parece un cliente normal (que es casi siempre).
 *
 * Es deliberadamente estrecho: "cual es la contrasena del wifi de la
 * tienda" no salta (eso lo contesta el modelo con lo que la tienda haya
 * escrito), pero "dame el token de la api de whatsapp" si.
 */
export function detectarManipulacion(texto: string): Manipulacion | null {
  const n = normalizar(texto);
  if (!n) return null;
  for (const [tipo, re] of PATRONES) {
    const m = re.exec(n);
    if (m) return { tipo, patron: m[0].slice(0, 80) };
  }
  // Las etiquetas de un prompt de chat ("<system>", "<|im_start|>", "###
  // instruction") se miran sobre el texto crudo: la normalizacion se lleva
  // los signos que las delatan.
  for (const re of PATRONES_CRUDOS) {
    const m = re.exec(texto.toLowerCase());
    if (m) return { tipo: 'inyeccion_sistema', patron: m[0].slice(0, 80) };
  }
  return null;
}

/** Marcas de prompt que solo se ven en el texto crudo. */
const PATRONES_CRUDOS: RegExp[] = [
  /<\/?\s*(syst[e3]m|sist[e3]ma|inst|instruction|instrucciones?|prompt|assistant|developer|admin)\s*>/,
  /<\|\s*(im_start|im_end|system|user|assistant)\s*\|>/,
  /(^|\n)\s*###\s*(system|instruction|instrucciones?|sistema)\b/,
  /\[\s*(system|sistema|inst|instrucciones?|admin|override|derivar|pedir_ubicacion|acciones)\s*\]/,
];

/** Lo que se le contesta a quien intenta manipular al asistente, sin preguntarle al modelo. */
export function respuestaAnteManipulacion(tipo: TipoManipulacion, nombreNegocio: string): string {
  switch (tipo) {
    case 'datos_ajenos':
      return `Por aquí solo puedo ayudarte con tus propias consultas y pedidos de ${nombreNegocio}; no puedo compartir datos de otras personas. ¿Qué necesitas?`;
    case 'accion_ajena':
      return `No puedo escribir a otros números ni actuar sobre otras cuentas desde este chat. Si necesitas algo de ${nombreNegocio} para ti, cuéntame y te ayudo.`;
    case 'secretos':
      return `Esa información no la tengo ni la puedo compartir. Si necesitas ayuda con un pedido o un producto de ${nombreNegocio}, cuéntame.`;
    default:
      return `Soy el asistente de ${nombreNegocio} y solo puedo ayudarte con lo del negocio: productos, precios, envíos y pedidos. ¿Qué necesitas?`;
  }
}

/** Trozos que delatan que se coló el prompt o algo interno en una respuesta al cliente. */
const HUELLAS_DEL_PROMPT: RegExp[] = [
  /lo que sabes del negocio/i,
  /\bReglas:\s*\n?\s*-/,
  /^eres [^.\n]{0,60}, el asistente de whatsapp de/im,
  /termina tu mensaje con la marca/i,
  /ejemplos de c[oó]mo responder/i,
  /c[oó]mo funciona el sistema por el que hablas/i,
  /\[(DERIVAR|PEDIR_UBICACION)\]/,
  /<\/?(thought|think|reasoning|system|inst)>/i,
  /\b(system prompt|prompt del sistema|mensaje de sistema|instrucciones internas)\b/i,
];

/** Tokens, claves y rutas internas que nunca deben salir hacia un cliente. */
const SECRETOS: RegExp[] = [
  /\bwak_[A-Za-z0-9]{10,}\b/,
  // Una API Key nueva: 48 caracteres al azar con mayúsculas, minúsculas y cifras.
  /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[A-Z])[A-Za-z0-9]{48}\b/,
  /\bEAA[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/i,
  /\b(mysql|mariadb|postgres(ql)?|redis):\/\/[^\s]+/i,
  /\/(admin|panel|setup|login)(\/|#|\b)/,
  /\b(WHATSAPP_TOKEN|WHATSAPP_APP_SECRET|TRACKING_SECRET|DATABASE_URL|SETTINGS_KEY|ADMIN_TOKEN)\b/,
  /\b[0-9a-f]{32,}\b/i,
];

/** Los telefonos (9 a 15 digitos, escritos como sea) que hay en un texto, solo digitos. */
export function telefonosEn(texto: string): string[] {
  const salida: string[] = [];
  for (const tel of texto.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? []) {
    const digitos = tel.replace(/\D+/g, '');
    if (digitos.length >= 9 && digitos.length <= 15) salida.push(digitos);
  }
  return salida;
}

export interface SalidaLimpia {
  texto: string;
  /** true si la respuesta original no podia salir tal cual. */
  bloqueada: boolean;
  motivo?: string;
}

export interface ContextoSalida {
  /** El telefono del cliente con el que se habla: puede aparecer. */
  telefonoCliente?: string | null;
  /** Lo que la tienda escribio (ahi puede haber un telefono de Yape, una direccion): puede aparecer. */
  conocimiento?: string;
  nombreNegocio: string;
}

/**
 * La ultima puerta antes de WhatsApp: lo que el modelo escribio, revisado.
 *
 * Devuelve el mismo texto si esta limpio; si trae algo que no debe salir,
 * devuelve una frase neutra y `bloqueada: true` para que quien llama derive
 * a una persona.
 */
export function limpiarSalida(texto: string, ctx: ContextoSalida): SalidaLimpia {
  const limpio = texto.trim();
  if (!limpio) return { texto: '', bloqueada: false };

  for (const re of HUELLAS_DEL_PROMPT) {
    if (re.test(limpio)) return { texto: respuestaAnteManipulacion('extraccion_prompt', ctx.nombreNegocio), bloqueada: true, motivo: `huella del prompt: ${re.source.slice(0, 40)}` };
  }
  for (const re of SECRETOS) {
    if (re.test(limpio)) return { texto: respuestaAnteManipulacion('secretos', ctx.nombreNegocio), bloqueada: true, motivo: `posible secreto: ${re.source.slice(0, 40)}` };
  }
  // Telefonos que no son del cliente ni estan en lo que la tienda escribio:
  // seran de otro cliente (o inventados). Ni una cosa ni la otra puede salir.
  const conocidos = new Set<string>();
  for (const tel of telefonosEn(`${ctx.telefonoCliente ?? ''} ${ctx.conocimiento ?? ''}`)) {
    conocidos.add(tel);
    conocidos.add(tel.replace(/^51/, ''));
    conocidos.add(`51${tel}`);
  }
  for (const digitos of telefonosEn(limpio)) {
    if (conocidos.has(digitos)) continue;
    return { texto: respuestaAnteManipulacion('datos_ajenos', ctx.nombreNegocio), bloqueada: true, motivo: `telefono ajeno o inventado (${digitos.slice(0, 4)}…)` };
  }
  // Un correo que no este en lo que sabe la tienda: lo mismo.
  for (const correo of limpio.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []) {
    if (!(ctx.conocimiento ?? '').toLowerCase().includes(correo.toLowerCase())) {
      return { texto: respuestaAnteManipulacion('datos_ajenos', ctx.nombreNegocio), bloqueada: true, motivo: 'correo ajeno o inventado' };
    }
  }
  return { texto: limpio, bloqueada: false };
}

/** Un contador por clave en ventana deslizante: cuantas veces en los ultimos N ms. */
export class Limitador {
  private readonly marcas = new Map<string, number[]>();
  constructor(private readonly maximo: number, private readonly ventanaMs: number) {}

  /** true si esta vez cabe (y la cuenta); false si ya se paso del tope. */
  permitir(clave: string, ahora = Date.now()): boolean {
    const desde = ahora - this.ventanaMs;
    const lista = (this.marcas.get(clave) ?? []).filter((t) => t > desde);
    if (lista.length >= this.maximo) {
      this.marcas.set(clave, lista);
      return false;
    }
    lista.push(ahora);
    this.marcas.set(clave, lista);
    // Que no crezca sin fin con claves que no vuelven.
    if (this.marcas.size > 5000) {
      for (const [k, v] of this.marcas) if (!v.some((t) => t > desde)) this.marcas.delete(k);
    }
    return true;
  }

  cuantas(clave: string, ahora = Date.now()): number {
    const desde = ahora - this.ventanaMs;
    return (this.marcas.get(clave) ?? []).filter((t) => t > desde).length;
  }
}

/** Nombres de campo que son secretos alli donde aparezcan. */
const CAMPOS_SECRETOS = /^(token|tokens|secret|secreto|secretos|clave|claves|password|contrasena|contraseña|hash|apikey|api_key|authorization|cookie|verifytoken|verify_token|appsecret|app_secret|accesstoken|access_token|refresh_token|private_key|privatekey|settingskey|settings_key|database_url|databaseurl|redis_url|redisurl)$/i;

/**
 * Lo que se le pasa al modelo operador como resultado de una consulta,
 * con los secretos tapados: por nombre de campo y por forma (tokens).
 */
export function taparSecretos<T>(valor: T, profundidad = 0): T {
  if (profundidad > 12) return '[…]' as unknown as T;
  if (typeof valor === 'string') {
    let s: string = valor;
    for (const re of SECRETOS.slice(0, 6)) s = s.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), '[oculto]');
    return s as unknown as T;
  }
  if (Array.isArray(valor)) return valor.map((v) => taparSecretos(v, profundidad + 1)) as unknown as T;
  if (valor && typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      salida[k] = CAMPOS_SECRETOS.test(k) ? (v === null || v === undefined || v === '' ? v : '[oculto]') : taparSecretos(v, profundidad + 1);
    }
    return salida as unknown as T;
  }
  return valor;
}

/** Si un texto trae algo con forma de token o clave (para no dejarlo pasar a ningun sitio). */
export function contieneSecreto(texto: string): boolean {
  return SECRETOS.slice(0, 6).some((re) => re.test(texto));
}
