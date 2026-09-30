/**
 * El armazon de todas las pantallas: menu lateral, barra superior y el hueco
 * donde va cada pagina.
 *
 * Es lo que hace que el sistema se sienta como un solo producto y no como
 * cuatro paginas sueltas: el mismo menu en todas partes, agrupado por lo que
 * hace cada cosa (conversaciones, reparto, campanas...), con buscador de
 * modulos (Ctrl K), plegable, y con quien esta dentro abajo del todo.
 *
 * Las paginas traen su contenido, su CSS y su JS; el armazon pone lo comun.
 * Las variables CSS del armazon van con prefijo `--s-` para no pisar las de
 * cada pagina (el chat, por ejemplo, tiene su propia paleta de WhatsApp).
 *
 * El JS va en String.raw y sin backticks ni "${", como el resto de paginas.
 */

import { DIALOGO_CSS, DIALOGO_JS } from './dialogo.js';
import { tiendaActual } from '../plataforma/contexto.js';
import { DIALOGO_ELEGIR_CSS, DIALOGO_ELEGIR_JS } from './dialogo-elegir.js';
import { TEMA_SCRIPT, TOKENS_CSS } from './tokens.js';
import { escapeHtml } from './login-page.js';
import { INICIAL_SISTEMA, NOMBRE_SISTEMA } from '../marca.js';
import { AYUDA_PANTALLAS } from './ayuda-pantallas.js';

export interface ItemMenu {
  id: string;
  etiqueta: string;
  href: string;
  icono: keyof typeof ICONOS;
  /** Una linea para el buscador y el manual. */
  descripcion: string;
  /** Solo lo ven los administradores (el servidor lo exige igual). */
  soloAdmin?: boolean;
  /** Solo lo ve un superadministrador (el servidor lo exige igual). */
  soloSuper?: boolean;
  /**
   * Solo en el modo avanzado. Por defecto el menu es sencillo: lo que una
   * tienda necesita para atender su WhatsApp con la IA; lo demas (reparto,
   * campanas, ritmo, rastreo) se ensena con "Ver todo".
   */
  avanzado?: boolean;
  /** Solo si la tienda usa la plantilla de entregas de courier (GSG): Hoy, Números del día, Motorizados, Mapa. */
  soloGsg?: boolean;
  /** En modo gsg: la seccion plegada donde va (sin seccion = a la vista, arriba). */
  seccion?: string;
}

export interface GrupoMenu {
  id: string;
  etiqueta: string;
  items: ItemMenu[];
}

export type ModoSistema = 'gsg' | 'completo';

/**
 * Quien dice en que modo esta el sistema. Lo fija el arranque (con los
 * ajustes generales) y lo leen todas las paginas al pintar el armazon: asi
 * ninguna pagina tiene que pasarlo a mano.
 */
let proveedorModo: () => ModoSistema = () => 'gsg';
export function fijarModoVigente(f: () => ModoSistema): void {
  proveedorModo = f;
}
export function modoVigente(): ModoSistema {
  try {
    // En la plataforma cada tienda tiene su modo: manda el de la tienda de
    // esta peticion (ver src/plataforma/contexto.ts).
    const tienda = tiendaActual();
    if (tienda?.modo) return tienda.modo();
    return proveedorModo();
  } catch {
    return 'gsg';
  }
}

/**
 * Si la tienda usa la plantilla de entregas de courier (GSG). Lo fija el
 * arranque (con el servicio de procesos) y lo leen todas las paginas al pintar
 * el menu; en la plataforma manda el de la tienda de la peticion.
 */
let proveedorGsg: () => boolean = () => true;
export function fijarGsgVigente(f: () => boolean): void {
  proveedorGsg = f;
}
export function gsgVigente(): boolean {
  try {
    const tienda = tiendaActual();
    if (tienda?.gsg) return tienda.gsg();
    return proveedorGsg();
  } catch {
    return true;
  }
}

/**
 * El menu de cada dia: procesos administrativos y operativos, sin grupos y sin
 * jerga. Inicio, Procesos, Personas y Respuestas van primero; las pantallas de
 * las entregas de courier (Hoy, Números del día, Motorizados, Mapa) solo se ven
 * en las tiendas que usan esa plantilla.
 *
 * Es el que se ve por defecto. Todo lo demas (campañas, grupos, rastreo,
 * ritmo, integraciones...) sigue existiendo en el modo completo, que se
 * enciende desde Ajustes.
 */
export const MENU_GSG: ItemMenu[] = [
  { id: 'inicio', etiqueta: 'Inicio', href: '/panel#inicio', icono: 'inicio', descripcion: 'Un vistazo: tus procesos en curso, quién necesita a alguien, los mensajes de hoy y el número.' },
  { id: 'hoy', etiqueta: 'Hoy', href: '/hoy', icono: 'reloj', descripcion: 'Las entregas de hoy: a quién falta la ubicación o confirmar, quién las lleva, a qué hora llegan y qué necesita a alguien.', soloGsg: true },
  { id: 'chats', etiqueta: 'Chats', href: '/chat', icono: 'chat', descripcion: 'Las conversaciones como en WhatsApp: leer, responder, mandar o pedir ubicación.' },
  { id: 'ubicaciones', etiqueta: 'Ubicaciones registradas', href: '/numeros?etapa=contactados', icono: 'mapa', descripcion: 'Los clientes que ya mandaron su ubicación (o confirmaron): con su pin, su pedido y a qué motorizado va.', soloGsg: true },
  { id: 'motorizados', etiqueta: 'Motorizados', href: '/motorizados', icono: 'moto', descripcion: 'Quiénes reparten hoy: alta, zona, descanso y qué lleva cada uno.', soloGsg: true },
  { id: 'conexion', etiqueta: 'Conexión', href: '/setup', icono: 'enchufe', descripcion: 'El WhatsApp (QR o API de Meta) y el sistema de GSG.' },
  { id: 'plantillas', etiqueta: 'Plantillas', href: '/panel#plantillas', icono: 'plantilla', descripcion: 'Los mensajes con los que el sistema abre y cierra las conversaciones (la solicitud de ubicación, el cierre...): crearlos, ver si Meta los aprobó y sincronizarlos.' },
  { id: 'ajustes', etiqueta: 'Ajustes', href: '/panel#configuracion', icono: 'ajustes', descripcion: 'Nombre, horario, avisos, modo prueba y qué se enseña.', soloAdmin: true },
  { id: 'numeros', seccion: 'Seguimiento', etiqueta: 'Números del día', href: '/numeros', icono: 'plantilla', descripcion: 'Todos los números que pasó GSG hoy: a quién falta pedirle la ubicación, quién no la manda, quién falta confirmar y quién ya está contactado; marcar uno, varios o todos y pedirles lo que falte.', soloGsg: true },
  { id: 'procesos', seccion: 'Procesos', etiqueta: 'Procesos', href: '/procesos', icono: 'flujo', descripcion: 'Lo que el sistema hace solo por WhatsApp con tus listas: pedir y validar datos, confirmar y recordar citas, avisar tareas al personal, recordar pagos. Crear desde una plantilla, editar los pasos y cargar personas.' },
  { id: 'personas', seccion: 'Procesos', etiqueta: 'Personas', href: '/personas', icono: 'contactos', descripcion: 'Todas las personas de tus procesos: en qué paso va cada una, quién necesita a alguien; pedir ahora, pausar o pasar a una persona.' },
  { id: 'respuestas', seccion: 'Procesos', etiqueta: 'Respuestas', href: '/respuestas', icono: 'lista', descripcion: 'Lo que respondió cada persona, paso por paso (DNI, ubicación, SÍ o NO, capturas), para revisar o exportar a Excel.' },
  { id: 'mapa', seccion: 'Seguimiento', etiqueta: 'Mapa del día', href: '/mapa', icono: 'mapa', descripcion: 'Dónde está cada pedido de hoy y cada motorizado, sobre el mapa.', soloGsg: true },
  { id: 'guardados', seccion: 'Seguimiento', etiqueta: 'Conversaciones guardadas', href: '/guardados', icono: 'historial', descripcion: 'Las conversaciones ya cerradas: buscarlas, leerlas, exportarlas y devolverlas al chat.' },
  { id: 'ia', seccion: 'Configuración', etiqueta: 'Asistente IA', href: '/panel#ia', icono: 'rayo', descripcion: 'El agente operativo: explica por qué se pide cada dato, reconoce lo que no es del trámite y lo pasa a una persona (nada de ventas); con qué IA trabaja y si está encendido.' },
  { id: 'equipo', seccion: 'Configuración', etiqueta: 'Equipo', href: '/panel#usuarios', icono: 'usuario', descripcion: 'Las cuentas de quienes entran al sistema.', soloAdmin: true },
  { id: 'fiabilidad', seccion: 'Configuración', etiqueta: 'Que todo funcione', href: '/fiabilidad', icono: 'salud', descripcion: 'El WhatsApp vigilado, la prueba de cada mañana, el cupo de hoy y la copia de seguridad.', soloAdmin: true },
  { id: 'manual', seccion: 'Ayuda', etiqueta: 'Manual de uso', href: '/manual', icono: 'libro', descripcion: 'Qué hace cada pantalla y cómo se usa.' },
  { id: 'soporte', seccion: 'Ayuda', etiqueta: 'Soporte', href: '/soporte', icono: 'soporte', descripcion: 'Si algo falla: qué mirar y qué datos mandar.' },
];

/** Lo que solo ve el dueño del sistema (superadministrador), en el modo GSG. */
export const MENU_GSG_DUENO: GrupoMenu = {
  id: 'dueno',
  etiqueta: 'Dueño del sistema',
  items: [
    { id: 'tiendas', etiqueta: 'Tiendas', href: '/tiendas', icono: 'inicio', descripcion: 'Los negocios que controlas: cada uno con su instalación, su plan, su salud, hasta cuándo está pagado y los pagos por revisar.', soloAdmin: true, soloSuper: true },
    { id: 'membresia', etiqueta: 'Membresía', href: '/panel#membresia', icono: 'campana', descripcion: 'El plan de esta instalación: hasta cuándo está pagada, sus topes y los pagos.', soloAdmin: true, soloSuper: true },
    { id: 'pagar', etiqueta: 'Pagar', href: '/pagar', icono: 'reloj', descripcion: 'Cómo pagar la membresía y mandar la captura del pago.', soloAdmin: true, soloSuper: true },
    { id: 'actividad', etiqueta: 'Actividad', href: '/panel#actividad', icono: 'historial', descripcion: 'Quién hizo qué y cuándo.', soloAdmin: true, soloSuper: true },
  ],
};

/**
 * El Modulo desarrollador: probar todo de punta a punta sin WhatsApp real y
 * comprobar que esta listo para GSG. Solo admin y superadmin; va al final, en
 * su propio grupo, en los dos modos. Ver src/desarrollador.
 */
export const MENU_DESARROLLADOR: GrupoMenu = {
  id: 'desarrollador',
  etiqueta: 'Módulo desarrollador',
  items: [
    { id: 'dev-generar', etiqueta: 'Clientes de prueba', href: '/desarrollador#generar', icono: 'usuario', descripcion: 'Crea clientes y motorizados de prueba (entran por la API, como los de GSG) y bórralos con un clic. Nada sale al WhatsApp real.', soloAdmin: true },
    { id: 'dev-vivo', etiqueta: 'Ver el flujo en vivo', href: '/desarrollador#vivo', icono: 'chat', descripcion: 'Escribe como si fueras el cliente o el motorizado y mira, paso a paso, qué entendió el sistema, qué respondió y qué le mandó a GSG.', soloAdmin: true },
    { id: 'dev-listo', etiqueta: '¿Está listo para GSG?', href: '/desarrollador#listo', icono: 'salud', descripcion: 'Recorre con un clic todo el contrato con GSG contra el simulador y dice qué funciona y qué falta.', soloAdmin: true },
    { id: 'dev-procesos', etiqueta: 'Probar un proceso', href: '/desarrollador#procesos', icono: 'flujo', descripcion: 'Simula una corrida de cada plantilla con números de prueba: respuestas buenas, malas, sin respuesta y consultas ajenas, persona por persona.', soloAdmin: true },
  ],
};

/** Lo de arriba del menu, fuera de los grupos (modo completo). */
export const MENU_ARRIBA: ItemMenu[] = [
  { id: 'inicio', etiqueta: 'Inicio', href: '/panel#inicio', icono: 'inicio', descripcion: 'Un vistazo a todo: cifras de hoy, la semana, el numero y lo que espera a una persona.' },
  { id: 'manual', etiqueta: 'Manual de uso', href: '/manual', icono: 'libro', descripcion: 'Que hace cada modulo y como se usa.' },
  { id: 'soporte', etiqueta: 'Soporte', href: '/soporte', icono: 'soporte', descripcion: 'Si algo falla: que mirar y que datos mandar.' },
];

export const MENU_GRUPOS: GrupoMenu[] = [
  {
    id: 'procesos',
    etiqueta: 'Procesos',
    items: [
      { id: 'procesos', etiqueta: 'Procesos', href: '/procesos', icono: 'flujo', descripcion: 'Lo que el sistema hace solo por WhatsApp con tus listas: pedir y validar datos, confirmar y recordar citas, avisar tareas al personal, recordar pagos.' },
      { id: 'personas', etiqueta: 'Personas', href: '/personas', icono: 'contactos', descripcion: 'Todas las personas de tus procesos y en qué paso va cada una.' },
      { id: 'respuestas', etiqueta: 'Respuestas', href: '/respuestas', icono: 'lista', descripcion: 'Lo que respondió cada persona, paso por paso, para revisar o exportar.' },
    ],
  },
  {
    id: 'atencion',
    etiqueta: 'Atención',
    items: [
      { id: 'chats', etiqueta: 'Chats', href: '/chat', icono: 'chat', descripcion: 'Las conversaciones como en WhatsApp: leer, responder, mandar o pedir ubicacion.' },
      { id: 'ia', etiqueta: 'Mi asistente IA', href: '/panel#ia', icono: 'rayo', descripcion: 'Lo que sabe de tu negocio y como contesta solo. Cuando no puede, te pasa la conversacion.' },
      { id: 'entrenamiento', etiqueta: 'Entrenar a la IA', href: '/entrenamiento', icono: 'robot', descripcion: 'Ensenarle a gran escala: miles de ejemplos, datos y reglas; importar un Excel o un chat; aprender de tus conversaciones reales; examinarla en masa y corregirla.' },
      { id: 'pedidos', etiqueta: 'Pedidos del chat', href: '/panel#pedidos', icono: 'plantilla', descripcion: 'Lo que el asistente (o una persona) cerro en la conversacion: confirmar, cancelar o pasarlo a la tienda.' },
      { id: 'contactos', etiqueta: 'Contactos', href: '/panel#contactos', icono: 'contactos', descripcion: 'Importar, buscar y ver el consentimiento de cada numero.' },
      { id: 'envio-automatico', etiqueta: 'Envío automático', href: '/envio-automatico', icono: 'reloj', descripcion: 'Los numeros a los que el sistema escribe solo: un mensaje cada pocas horas, como una persona, hasta conseguir su ubicacion o una respuesta. Se ponen y se quitan a mano o pidiendoselo a la IA.' },
      { id: 'enviar', etiqueta: 'Enviar mensaje', href: '/panel#enviar', icono: 'enviar', descripcion: 'Un texto, un pin o una plantilla a un numero concreto.', avanzado: true },
      { id: 'historial', etiqueta: 'Historial de envios', href: '/panel#historial', icono: 'historial', descripcion: 'Todo lo que salio, con su estado y su error si lo hubo.', avanzado: true },
      { id: 'stickers', etiqueta: 'Stickers', href: '/panel#stickers', icono: 'sticker', descripcion: 'Los stickers que se mandan tras el saludo, el gracias o la despedida, y a mano desde el chat.', avanzado: true },
    ],
  },
  {
    id: 'reparto',
    etiqueta: 'Reparto',
    items: [
      { id: 'entregas', etiqueta: 'Entregas del día', href: '/entregas', icono: 'moto', descripcion: 'Cada pedido de hoy: ubicacion, confirmacion, motorizado y hora de llegada. Se sincroniza con GSG (o con su simulador), lee las respuestas con reglas y con la IA, y avisa a quien hace falta.' },
      { id: 'rutas', etiqueta: 'Ubicaciones para reparto', href: '/rutas', icono: 'pin', descripcion: 'Cargar la lista del dia, pedir la ubicacion a cada cliente y resolver lo que necesita una persona.', avanzado: true },
      { id: 'rutas-ajustes', etiqueta: 'Ajustes del reparto', href: '/rutas#ajustes', icono: 'ajustes', descripcion: 'Horario, espera entre mensajes, intentos, textos y plantillas del reparto.', avanzado: true },
      { id: 'mapa', etiqueta: 'Mapa del día', href: '/mapa', icono: 'mapa', descripcion: 'Dónde está cada pedido de hoy y cada motorizado, sobre el mapa.' },
    ],
  },
  {
    id: 'campanas',
    etiqueta: 'Campañas',
    items: [
      { id: 'grupos', etiqueta: 'Enviar a un grupo', href: '/panel#grupos', icono: 'contactos', descripcion: 'Elegir clientes por como estan (sin ubicacion, ficha incompleta, callados...) y mandarles a todos un mensaje personalizado.', avanzado: true },
      { id: 'campanas', etiqueta: 'Campañas', href: '/panel#campanas', icono: 'megafono', descripcion: 'Envios masivos por goteo, con canario y al ritmo que el numero tolera.', avanzado: true },
      { id: 'automatizacion', etiqueta: 'Respuestas automáticas', href: '/panel#automatizacion', icono: 'rayo', descripcion: 'Reglas por palabra clave y secuencias: que se manda solo y cuando (sin IA).', avanzado: true },
      { id: 'plantillas', etiqueta: 'Plantillas', href: '/panel#plantillas', icono: 'plantilla', descripcion: 'Las plantillas de Meta y las propias: crear, sincronizar y ver su estado.' },
    ],
  },
  {
    id: 'ubicaciones',
    etiqueta: 'Ubicaciones',
    items: [
      { id: 'ubicaciones', etiqueta: 'Ubicaciones recibidas', href: '/panel#ubicaciones', icono: 'mapa', descripcion: 'Los pines que mandaron los clientes.', avanzado: true },
      { id: 'vivo', etiqueta: 'Rastreo en vivo', href: '/panel#vivo', icono: 'radar', descripcion: 'Enlaces para compartir y ver una posicion en tiempo real.', avanzado: true },
      { id: 'extraer', etiqueta: 'Extraer coordenadas', href: '/panel#extraer', icono: 'mira', descripcion: 'Pega un link de mapa o un texto y saca las coordenadas.', avanzado: true },
    ],
  },
  {
    id: 'salud',
    etiqueta: '¿Va todo bien?',
    items: [
      { id: 'estado', etiqueta: 'Estado del número', href: '/panel#estado', icono: 'actividad', descripcion: 'Calidad, cupo del dia, cola y pausa manual.', avanzado: true },
      { id: 'salud', etiqueta: 'Riesgo y ritmo', href: '/panel#salud', icono: 'salud', descripcion: 'Lo que mira el monitor: errores, bloqueos, bajas; por que frena y cuando.', avanzado: true },
      { id: 'fiabilidad', etiqueta: 'Que todo funcione', href: '/fiabilidad', icono: 'salud', descripcion: 'El WhatsApp vigilado, la prueba de cada mañana, el cupo de hoy y la copia de seguridad.', soloAdmin: true },
    ],
  },
  {
    id: 'administracion',
    etiqueta: 'Mi negocio',
    items: [
      { id: 'setup', etiqueta: 'Conexión de WhatsApp', href: '/setup', icono: 'enchufe', descripcion: 'Conectar el numero: QR, WAHA o la API oficial de Meta.' },
      { id: 'integraciones', etiqueta: 'Conectar mi web y tienda', href: '/panel#integraciones', icono: 'llave', descripcion: 'Stoky (en las dos direcciones, con su estado), el chat dentro de tu web, tu tienda WooCommerce o Shopify, y las claves para otros programas.', soloAdmin: true },
      { id: 'configuracion', etiqueta: 'Configuración', href: '/panel#configuracion', icono: 'ajustes', descripcion: 'Nombre del negocio, horario, avisos, modo prueba y ritmo.', soloAdmin: true },
      { id: 'usuarios', etiqueta: 'Usuarios', href: '/panel#usuarios', icono: 'usuario', descripcion: 'Cuentas del equipo, roles y contrasenas. Un superadministrador crea administradores; un administrador crea operadores.', soloAdmin: true, avanzado: true },
      { id: 'membresia', etiqueta: 'Membresía', href: '/panel#membresia', icono: 'campana', descripcion: 'El plan de esta instalacion: hasta cuando esta pagada, sus topes y los pagos apuntados. La cambia el superadministrador; un administrador la ve.', soloAdmin: true },
      { id: 'pagar', etiqueta: 'Pagar', href: '/pagar', icono: 'reloj', descripcion: 'Como pagar la membresia y mandar la captura del pago.', soloAdmin: true, soloSuper: true },
      { id: 'tiendas', etiqueta: 'Tiendas', href: '/tiendas', icono: 'inicio', descripcion: 'Las tiendas que controla el superadministrador: cada negocio con su instalacion, su plan, hasta cuando esta pagada, si esta en linea; dar de alta, apuntar pagos, suspender.', soloAdmin: true, soloSuper: true },
      { id: 'actividad', etiqueta: 'Actividad', href: '/panel#actividad', icono: 'historial', descripcion: 'Bitacora: quien hizo que y cuando.', soloAdmin: true, avanzado: true },
    ],
  },
];

/** Iconos de trazo, 24x24, sin dependencias. */
const ICONOS = {
  luna: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
  inicio: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  libro: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5V5.5"/><path d="M8 7h8M8 11h6"/>',
  soporte: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z"/>',
  enviar: '<path d="M21 3 10.5 13.5"/><path d="M21 3 14 21l-3.5-7.5L3 10z"/>',
  historial: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.5"/>',
  moto: '<circle cx="5.5" cy="17" r="3"/><circle cx="18.5" cy="17" r="3"/><path d="M5.5 17h6l2.5-6h4.5"/><path d="M13 11l-1.5-4H9"/><path d="M16 11l2.5 6"/>',
  ajustes: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  megafono: '<path d="M3 10v4h3l7 4V6l-7 4z"/><path d="M17 9a4 4 0 0 1 0 6"/><path d="M19.5 6.5a8 8 0 0 1 0 11"/>',
  rayo: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  plantilla: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
  contactos: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M17.5 14a5.5 5.5 0 0 1 4 6"/>',
  mapa: '<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  radar: '<circle cx="12" cy="12" r="2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14"/>',
  mira: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.5"/>',
  actividad: '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>',
  salud: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M6 12h3l1.5-3 2.5 6 1.5-3h3.5"/>',
  usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  llave: '<circle cx="8" cy="14" r="4"/><path d="m11 11 9-9M17 5l2 2M14 8l2 2"/>',
  enchufe: '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  plegar: '<path d="m11 6-6 6 6 6M19 6l-6 6 6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  salir: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="m15 8 5 4-5 4M20 12H9"/>',
  sticker: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8l-6 6H6a2 2 0 0 1-2-2z"/><path d="M14 20v-4a2 2 0 0 1 2-2h4"/><path d="M9 10h.01M14 10h.01"/><path d="M9 13.5c1 .8 2.2 1 3 1s2-.2 3-1"/>',
  campana: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  robot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M8 4h8"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/><path d="M9 16.5h6"/>',
  ayuda: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><path d="M12 17h.01"/>',
  flujo: '<rect x="3" y="3" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/><path d="M6.5 9v4a2 2 0 0 0 2 2H14"/><path d="m12 13 2 2-2 2"/>',
  lista: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
} as const;

export function icono(nombre: keyof typeof ICONOS, clase = 's-ico'): string {
  return `<svg class="${clase}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre]}</svg>`;
}

const CSS = `
  ${TOKENS_CSS}
  html, body { height: 100%; }
  body { margin: 0; overflow: hidden; }
  .s-app { display: flex; height: 100dvh; font: var(--fs-cuerpo)/1.5 var(--fuente); color: var(--s-text); }
  /* Los cuadros de dialogo cuelgan del body, fuera del armazon: la misma letra, no la del navegador. */
  .dlg-fondo { font: var(--fs-cuerpo)/1.5 var(--fuente); }
  .hidden { display: none !important; }
  /* Lo que solo tiene sentido con «Todo el sistema» (tiendas online, catálogos, campañas) se esconde en modo GSG. */
  .s-app.modo-gsg .solo-completo { display: none !important; }

  /* --- piezas comunes a todas las pantallas ----------------------------- */
  :focus-visible { outline: 2px solid var(--primario); outline-offset: 2px; border-radius: var(--radio-sm); }
  .s-app :focus:not(:focus-visible) { outline: none; }
  .chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 1.5; white-space: nowrap; background: var(--gris-suave); color: var(--gris); vertical-align: middle; }
  .chip::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; opacity: .9; }
  .chip.sin-punto::before { display: none; }
  .chip.tono-verde { background: var(--verde-suave); color: var(--verde); }
  .chip.tono-ambar { background: var(--ambar-suave); color: var(--ambar); }
  .chip.tono-rojo { background: var(--rojo-suave); color: var(--rojo); }
  .chip.tono-azul { background: var(--azul-suave); color: var(--azul); }
  .chip.tono-gris { background: var(--gris-suave); color: var(--gris); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 8px 16px; border: 1px solid var(--borde); border-radius: var(--radio-sm); background: var(--superficie); color: var(--texto); font: inherit; font-weight: 600; line-height: 1.2; cursor: pointer; text-decoration: none; box-shadow: none; }
  .btn:hover { border-color: var(--primario); color: var(--primario); }
  .btn.primario { background: var(--primario); border-color: var(--primario); color: var(--primario-texto); }
  .btn.primario:hover { background: var(--primario-hover, var(--primario)); border-color: var(--primario-hover, var(--primario)); color: var(--primario-texto); }
  .btn.secundario { background: var(--primario-suave); border-color: transparent; color: var(--primario); }
  .btn.peligro { color: var(--rojo); border-color: var(--rojo-suave); background: var(--rojo-suave); }
  .btn.peligro:hover { background: var(--rojo); border-color: var(--rojo); color: #fff; }
  .btn.sm { min-height: 34px; padding: 6px 12px; font-size: 13.5px; font-weight: 500; }
  .btn:disabled { opacity: .55; cursor: default; }
  .tarjeta { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: var(--esp-4); box-shadow: var(--sombra); }
  .vacio { text-align: center; padding: var(--esp-6) var(--esp-4); color: var(--texto-suave); border: 1px dashed var(--borde); border-radius: var(--radio); background: var(--superficie); }
  .vacio h3 { margin: 0 0 6px; font-size: var(--fs-h3); font-weight: 700; color: var(--texto); }
  .vacio p { margin: 0; font-size: var(--fs-cuerpo); line-height: 1.5; max-width: 48ch; margin-inline: auto; }
  .vacio .acciones { display: flex; gap: var(--esp-2); justify-content: center; flex-wrap: wrap; margin-top: var(--esp-4); }
  .vacio .ico { font-size: 28px; line-height: 1; margin-bottom: var(--esp-2); }
  /* En pantallas táctiles, todo lo que se pulsa mide al menos 44 px. */
  @media (max-width: 960px), (pointer: coarse) {
    .btn, .s-boton, .s-menu, .s-salir, .s-plegar, .s-item, .s-content button, .s-content .btn, .s-content select, .s-content input:not([type=checkbox]):not([type=radio]) { min-height: 44px; }
    .s-content button.sm, .s-content .btn.sm { min-height: 44px; padding-top: 8px; padding-bottom: 8px; }
    .s-content a.btn { display: inline-flex; align-items: center; }
  }

  /* --- menu lateral ---------------------------------------------------- */
  .s-side { width: 262px; flex: none; background: var(--s-side); border-right: 1px solid var(--s-line);
    display: flex; flex-direction: column; min-height: 0; transition: width .18s ease; }
  .s-brand { display: flex; align-items: center; gap: 8px; padding: 14px 12px 10px 14px; }
  .s-plegar, .s-menu, .s-salir { padding: 0; font: inherit; line-height: 1; box-shadow: none; }
  .s-plegar { width: 30px; height: 30px; border: 0; background: transparent; color: var(--s-muted); border-radius: 8px; cursor: pointer; display: grid; place-items: center; flex: none; }
  .s-plegar:hover { background: var(--s-hover); color: var(--s-text); }
  .s-logo { display: flex; align-items: center; gap: 9px; text-decoration: none; color: var(--s-text); min-width: 0; }
  .s-logo-mark { width: 32px; height: 32px; border-radius: 9px; background: var(--s-accent); color: var(--primario-texto); display: grid; place-items: center; font-weight: 800; flex: none; }
  .s-logo-text { font-weight: 800; font-size: 17px; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s-logo-text small { color: var(--s-accent); font-weight: 700; font-size: 17px; }
  .s-nav { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 4px 10px 12px; }
  .s-item { display: flex; align-items: center; gap: 11px; padding: 9px 10px; border-radius: 9px; color: var(--s-text); text-decoration: none; font-weight: 500; white-space: nowrap; }
  .s-item:hover { background: var(--s-hover); }
  .s-item.activo { background: var(--s-accent-soft); color: var(--s-accent); font-weight: 600; box-shadow: inset 3px 0 0 var(--s-accent); }
  .s-item .s-ico { flex: none; color: var(--s-muted); }
  .s-item.activo .s-ico { color: var(--s-accent); }
  .s-item .s-txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .s-item.sub { padding: 7px 10px 7px 12px; font-size: 14px; }
  .s-badge { font-size: 11.5px; font-weight: 700; background: var(--s-accent); color: var(--primario-texto); border-radius: 999px; padding: 1px 7px; min-width: 20px; text-align: center; }
  .s-badge:empty { display: none; }
  .s-buscar { display: flex; align-items: center; gap: 8px; margin: 10px 2px 8px; padding: 0 10px; height: 38px; border: 1px solid var(--s-line); border-radius: 9px; background: var(--s-bg); color: var(--s-muted); }
  .s-buscar input { flex: 1; min-width: 0; width: auto; padding: 0; border: 0; border-radius: 0; box-shadow: none; background: transparent; color: var(--s-text); font: inherit; font-size: 13.5px; outline: 0; }
  .s-buscar input:focus, .s-buscar input:focus-visible { border: 0; outline: 0; box-shadow: none; }
  .s-buscar kbd { font: 600 11px/1 ui-monospace, Consolas, monospace; background: var(--s-kbd); border: 1px solid var(--s-line); border-radius: 5px; padding: 3px 5px; white-space: nowrap; }
  .s-grupo { margin-top: 2px; }
  .s-grupo-cab { box-shadow: none; display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 9px 10px 7px; border: 0; background: transparent; color: var(--s-muted); font-family: inherit; font-weight: 700; font-size: 11.5px !important; line-height: 1; min-height: 0; white-space: nowrap; text-align: left; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; border-radius: 8px; font-family: inherit; }
  .s-grupo-cab:hover { background: var(--s-hover); color: var(--s-text); }
  .s-grupo-cab .s-ico { width: 16px; height: 16px; transition: transform .15s; }
  .s-grupo-cab .s-ico { transform: rotate(90deg); }
  .s-grupo-items { display: block; padding: 0 0 4px 4px; }
  .s-grupo.cerrado .s-grupo-items { display: none; }
  .s-grupo.cerrado .s-grupo-cab .s-ico { transform: none; }
  .s-sin { display: none; padding: 14px 10px; color: var(--s-muted); font-size: 13px; text-align: center; }
  .s-nav.vacio .s-sin { display: block; }
  .s-modo { display: block; width: calc(100% - 16px); margin: 10px 8px 4px; padding: 7px 10px; border: 1px dashed var(--s-line); border-radius: 8px; background: transparent; color: var(--s-muted); font: inherit; font-size: 12px; cursor: pointer; }
  .s-modo:hover { color: var(--s-text); border-style: solid; }
  .s-app.sencillo .s-item[data-avanzado], .s-app.sencillo .s-grupo-avanzado { display: none; }
  .s-app.plegado .s-modo { display: none; }
  .s-app.modo-gsg .s-menu-completo, .s-app.modo-gsg .s-modo, .s-app.modo-completo .s-menu-gsg { display: none; }
  .s-user { border-top: 1px solid var(--s-line); padding: 12px 12px; display: flex; align-items: center; gap: 10px; }
  .s-avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--s-accent-soft); color: var(--s-accent); display: grid; place-items: center; font-weight: 800; font-size: 13px; flex: none; }
  .s-user-txt { flex: 1; min-width: 0; line-height: 1.25; }
  .s-user-txt b { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13.5px; }
  .s-user-txt span { color: var(--s-muted); font-size: 12px; }
  .s-salir { width: 32px; height: 32px; border: 0; background: transparent; color: var(--s-muted); border-radius: 8px; cursor: pointer; display: grid; place-items: center; flex: none; }
  .s-salir:hover { background: var(--s-hover); color: var(--rojo); }

  /* plegado: solo iconos */
  .s-app.plegado .s-side { width: 68px; }
  .s-app.plegado .s-logo-text, .s-app.plegado .s-item .s-txt, .s-app.plegado .s-badge, .s-app.plegado .s-buscar input,
  .s-app.plegado .s-buscar kbd, .s-app.plegado .s-grupo-cab span, .s-app.plegado .s-user-txt, .s-app.plegado .s-grupo-cab .s-ico { display: none; }
  .s-app.plegado .s-brand { flex-direction: column-reverse; gap: 6px; padding: 12px 0 8px; }
  .s-app.plegado .s-item { justify-content: center; padding: 10px 0; }
  .s-app.plegado .s-buscar { justify-content: center; padding: 0; margin: 10px 8px 8px; cursor: pointer; }
  .s-app.plegado .s-grupo-cab { justify-content: center; padding: 8px 0 4px; }
  .s-app.plegado .s-grupo-cab::before { content: ''; display: block; width: 24px; height: 1px; background: var(--s-line); }
  .s-app.plegado .s-grupo-items { display: block !important; padding: 0; }
  .s-app.plegado .s-user { justify-content: center; flex-direction: column; gap: 6px; }
  .s-app.plegado .s-nav { padding: 4px 8px 12px; }
  .s-app.plegado .s-plegar .s-ico { transform: rotate(180deg); }

  /* --- zona principal -------------------------------------------------- */
  .s-main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--s-bg); min-height: 0; }
  .s-top { height: 62px; flex: none; display: flex; align-items: center; gap: 14px; padding: 0 22px; background: var(--s-top); border-bottom: 1px solid var(--s-line); }
  .s-menu { display: none; width: 34px; height: 34px; border: 0; background: transparent; color: var(--s-text); border-radius: 8px; cursor: pointer; place-items: center; flex: none; }
  .s-titulo { min-width: 0; display: flex; flex-direction: column; justify-content: center; line-height: 1.2; }
  .s-miga { color: var(--s-muted); font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s-miga:empty { display: none; }
  .s-titulo h1 { margin: 0; font-size: 16.5px; font-weight: 700; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.25; }
  .s-titulo p { margin: 0; color: var(--s-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s-top-der { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .s-demo { font-size: 12px; font-weight: 700; color: var(--ambar); background: var(--ambar-suave); border: 1px solid transparent; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
  .s-top-link { color: var(--s-muted); text-decoration: none; font-size: 13.5px; padding: 6px 10px; border-radius: 8px; }
  .s-top-link:hover { background: var(--s-hover); color: var(--s-text); }
  .s-boton { position: relative; width: 38px; height: 38px; padding: 0; border: 1px solid var(--s-line); background: var(--s-top); color: var(--s-muted); border-radius: 9px; cursor: pointer; display: grid; place-items: center; font: inherit; line-height: 1; box-shadow: none; text-decoration: none; }
  .s-boton:hover { background: var(--s-hover); color: var(--s-text); }
  .s-boton .s-num { position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--rojo); color: #fff; font-size: 11px; font-weight: 800; display: grid; place-items: center; }
  .s-boton .s-num:empty { display: none; }
  .s-plan { flex: none; padding: 9px 22px; font-size: 13.5px; font-weight: 600; color: #fff; background: var(--ambar); }
  .s-plan.bad { background: var(--rojo); }
  .s-plan a { color: #fff; text-decoration: underline; margin-left: 8px; }
  .s-avisos { position: relative; }
  .s-avisos-caja { display: none; position: absolute; right: 0; top: 44px; width: 340px; max-width: calc(100vw - 32px); background: var(--s-top); border: 1px solid var(--s-line); border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.18); z-index: 70; overflow: hidden; }
  .s-avisos.abierto .s-avisos-caja { display: block; }
  .s-avisos-caja h4 { margin: 0; padding: 12px 14px; font-size: 13px; border-bottom: 1px solid var(--s-line); color: var(--s-muted); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .s-aviso { display: flex; gap: 10px; align-items: flex-start; padding: 11px 14px; border-bottom: 1px solid var(--s-line); color: var(--s-text); text-decoration: none; font-size: 13.5px; line-height: 1.4; }
  .s-aviso:last-child { border-bottom: 0; }
  .s-aviso:hover { background: var(--s-hover); }
  .s-aviso i { flex: none; width: 9px; height: 9px; border-radius: 50%; margin-top: 6px; background: var(--s-accent); }
  .s-aviso.warn i { background: var(--ambar); } .s-aviso.bad i { background: var(--rojo); }
  .s-aviso-nada { padding: 18px 14px; color: var(--s-muted); font-size: 13.5px; text-align: center; }
  .s-chip { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; cursor: pointer; text-decoration: none; color: var(--s-text); padding: 4px 8px 4px 4px; border-radius: 999px; }
  .s-chip:hover { background: var(--s-hover); }
  .s-user-txt { cursor: pointer; }
  .s-chip .s-avatar { width: 30px; height: 30px; font-size: 12px; }
  .s-content { flex: 1; min-height: 0; overflow: auto; padding: 22px 24px 60px; }
  .s-nav-movil { display: none; }
  /* Chips de variables bajo un texto editable: se tocan y se insertan donde esta el cursor (window.chipsDeVariables). */
  .s-chips-var { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0 2px; }
  .s-chips-var-eti { font-size: 12px; color: var(--s-muted); margin-right: 2px; }
  .s-chip-var { font: inherit; font-size: 12.5px; font-family: ui-monospace, Consolas, monospace; padding: 4px 9px; min-height: 30px; border-radius: 999px; border: 1px solid var(--s-line); background: var(--s-top); color: var(--s-accent); cursor: pointer; }
  .s-chip-var:hover { background: var(--s-accent-soft); }
  @media (max-width: 960px), (pointer: coarse) { .s-chip-var { min-height: 40px; } }
  .s-content.lleno { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
  /* Un solo ancho para todas las pantallas de trabajo: con 1180 px quedaban
     franjas vacias a los lados en cualquier monitor de 1600 px o mas. */
  .s-content { --ancho-max: 1600px; }
  .s-content > .wrap { max-width: var(--ancho-max); margin: 0 auto; padding: 0; }
  .s-backdrop { display: none; }
  /* Fondo compartido de los cajones "a la derecha" (IA y Ayuda): antes se superponian
     sin avisar y tapaban texto; ahora oscurecen el resto y se cierran al tocar fuera. */
  .s-panel-fondo { position: fixed; inset: 0; z-index: 79; background: rgba(10,16,20,.4); opacity: 0; visibility: hidden; transition: opacity .18s ease; }
  .s-panel-fondo.visible { opacity: 1; visibility: visible; }

  /* --- la IA operadora: un cajon a la derecha, en todas las pantallas ---- */
  .s-ia-boton { width: auto; padding: 0 12px 0 10px; gap: 7px; font-weight: 700; font-size: 13.5px; color: var(--s-accent); border-color: var(--s-accent-soft); background: var(--s-accent-soft); }
  .s-ia-boton:hover { color: var(--primario-texto); background: var(--s-accent); }
  .s-ia { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); background: var(--s-top); border-left: 1px solid var(--s-line); box-shadow: -18px 0 48px rgba(0,0,0,.16); z-index: 80; display: flex; flex-direction: column; transform: translateX(105%); transition: transform .2s ease, visibility 0s linear .2s; visibility: hidden; pointer-events: none; }
  .s-ia.abierto { transform: translateX(0); transition: transform .2s ease; visibility: visible; pointer-events: auto; }
  .s-ia-cab { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--s-line); }
  .s-ia-cab b { font-size: 15px; }
  .s-ia-cab .s-ia-sub { color: var(--s-muted); font-size: 12px; display: block; }
  .s-ia-cab .sep { flex: 1; }
  .s-ia-cerrar, .s-ia-limpiar { border: 0; background: transparent; color: var(--s-muted); cursor: pointer; font: inherit; font-size: 13px; min-width: 38px; min-height: 38px; padding: 6px 8px; border-radius: 8px; box-shadow: none; }
  .s-ia-cerrar:hover, .s-ia-limpiar:hover { background: var(--s-hover); color: var(--s-text); }
  .s-ia-hilo { flex: 1; min-height: 0; overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
  .s-ia-b { max-width: 92%; padding: 9px 12px; border-radius: 12px; background: var(--s-hover); white-space: pre-wrap; line-height: 1.45; }
  .s-ia-b.yo { align-self: flex-end; background: var(--s-accent-soft); }
  .s-ia-b.mal { border: 1px solid var(--rojo); }
  .s-ia-hechas { display: flex; flex-direction: column; gap: 6px; }
  .s-ia-hecha { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; padding: 7px 10px; border: 1px solid var(--s-line); border-radius: 10px; background: var(--s-top); }
  .s-ia-hecha .ic { flex: none; }
  .s-ia-hecha .q { flex: 1; min-width: 0; }
  .s-ia-hecha .q small { display: block; color: var(--s-muted); }
  .s-ia-hecha a { color: var(--s-accent); font-size: 12.5px; white-space: nowrap; }
  /* La tarjeta de «Hacerlo»: lo que va a pasar, paso a paso, antes de hacerlo. */
  .s-ia-tarjeta { border: 1px solid var(--ambar); background: var(--ambar-suave); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
  .s-ia-tarjeta.apagada { opacity: .6; border-color: var(--s-line); background: var(--s-top); }
  .s-ia-tarjeta .cab { font-weight: 700; font-size: 13.5px; }
  .s-ia-tarjeta .pasos { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
  .s-ia-paso { line-height: 1.4; overflow-wrap: anywhere; }
  .s-ia-paso b { display: block; }
  .s-ia-paso .l { display: block; color: var(--s-text); }
  .s-ia-paso .l i { font-style: normal; color: var(--s-muted); }
  .s-ia-paso .msj { white-space: pre-wrap; background: var(--s-top); border: 1px solid var(--s-line); border-radius: 8px; padding: 6px 8px; margin-top: 3px; }
  .s-ia-paso .avisos { color: var(--s-text); font-size: 12.5px; margin-top: 3px; }
  .s-ia-paso.delicado > b::after { content: ' · delicado'; color: var(--rojo); font-weight: 600; font-size: 12px; }
  .s-ia-paso .res { margin-top: 3px; font-weight: 600; }
  .s-ia-paso.mal .res { color: var(--rojo); }
  .s-ia-paso .res a { color: var(--s-accent); font-weight: 400; }
  .s-ia-paso .quitar { margin-top: 3px; font: inherit; font-size: 12px; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--s-line); background: var(--s-top); color: var(--s-muted); cursor: pointer; box-shadow: none; }
  .s-ia-elegir { display: flex; flex-direction: column; gap: 6px; }
  .s-ia-elegir .ops { display: flex; flex-direction: column; gap: 5px; }
  .s-ia-elegir .ops button { text-align: left; font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--s-accent); background: var(--s-top); color: var(--s-text); cursor: pointer; box-shadow: none; overflow-wrap: anywhere; }
  .s-ia-elegir .ops button:hover { background: var(--s-accent-soft); }
  .s-ia-tarjeta .botones { display: flex; gap: 8px; flex-wrap: wrap; }
  .s-ia-tarjeta .botones button { font: inherit; font-size: 13.5px; font-weight: 600; min-height: 38px; padding: 6px 16px; border-radius: 9px; border: 1px solid var(--s-line); background: var(--s-top); color: var(--s-text); cursor: pointer; box-shadow: none; }
  .s-ia-tarjeta .botones button.si { background: var(--s-accent); border-color: var(--s-accent); color: var(--primario-texto); }
  .s-ia-tarjeta button:disabled { opacity: .5; cursor: default; }
  .s-ia-tarjeta .nota { color: var(--s-muted); font-size: 12.5px; }
  .s-ia-tarjeta .err { color: var(--rojo); font-size: 12.5px; }
  .s-ia-pie { border-top: 1px solid var(--s-line); padding: 10px 14px 12px; }
  .s-ia-entrada { display: flex; gap: 8px; align-items: flex-end; }
  .s-ia-entrada textarea { flex: 1; min-height: 42px; max-height: 140px; resize: none; font: inherit; font-size: 14px; padding: 9px 11px; border: 1px solid var(--s-line); border-radius: 10px; background: var(--s-bg); color: var(--s-text); }
  .s-ia-enviar { height: 42px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--s-accent); background: var(--s-accent); color: var(--primario-texto); font: inherit; font-weight: 700; cursor: pointer; box-shadow: none; }
  .s-ia-enviar:disabled { opacity: .55; cursor: default; }
  .s-ia-opc { display: flex; gap: 12px; align-items: center; margin-top: 8px; font-size: 12.5px; color: var(--s-muted); flex-wrap: wrap; }
  .s-ia-opc label { display: flex; gap: 6px; align-items: center; cursor: pointer; }
  .s-ia-opc label input[type="checkbox"] { width: auto; min-width: 0; min-height: 0; flex: none; margin: 0; }
  .s-ia-opc a { color: var(--s-accent); cursor: pointer; }
  .s-ia-cat { display: none; font-size: 12.5px; max-height: 40vh; overflow: auto; padding: 0 14px 10px; }
  .s-ia.con-catalogo .s-ia-cat { display: block; }
  .s-ia-cat div { padding: 5px 0; border-bottom: 1px solid var(--s-line); }
  .s-ia-cat b { display: block; }
  .s-ia-cat i { color: var(--s-muted); }
  .s-ia-vacio { color: var(--s-muted); font-size: 13.5px; line-height: 1.5; }
  .s-ia-vacio ul { margin: 6px 0 0; padding-left: 18px; }
  .s-ia-vacio li { cursor: pointer; color: var(--s-accent); }
  @media (max-width: 960px) { .s-ia-boton span { display: none; } .s-ia-boton { padding: 0; width: 38px; } }

  /* --- el buscador global (Ctrl K): clientes, pedidos de hoy, guardados y modulos --- */
  .s-boton.s-buscar-boton, .s-boton.s-ia-boton, .s-boton.s-ayuda-boton { display: flex; align-items: center; }
  .s-buscar-boton { width: auto; padding: 0 10px; gap: 8px; color: var(--s-muted); font-size: 13.5px; min-width: 190px; justify-content: flex-start; }
  .s-buscar-boton kbd { margin-left: auto; font: 600 11px/1 ui-monospace, Consolas, monospace; background: var(--s-kbd); border: 1px solid var(--s-line); border-radius: 5px; padding: 3px 5px; }
  .s-pal-fondo { display: none; position: fixed; inset: 0; z-index: 90; background: rgba(11,20,26,.45); backdrop-filter: blur(2px); padding: 8vh 16px 16px; }
  .s-pal-fondo.abierto { display: block; }
  .s-pal { max-width: 640px; margin: 0 auto; background: var(--s-top); color: var(--s-text); border: 1px solid var(--s-line); border-radius: 14px; box-shadow: 0 24px 70px rgba(0,0,0,.3); overflow: hidden; display: flex; flex-direction: column; max-height: 80vh; }
  .s-pal-cab { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--s-line); }
  .s-pal-cab input { flex: 1; min-width: 0; min-height: 0; border: 0; background: transparent; color: var(--s-text); font: inherit; font-size: 16px; outline: 0; padding: 4px 0; }
  .s-pal-cab input:focus, .s-pal-cab input:focus-visible { border: 0; outline: 0; box-shadow: none; }
  .s-pal-cab kbd { font: 600 11px/1 ui-monospace, Consolas, monospace; background: var(--s-kbd); border: 1px solid var(--s-line); border-radius: 5px; padding: 3px 5px; color: var(--s-muted); }
  .s-pal-lista { overflow: auto; padding: 6px 0 8px; min-height: 0; }
  .s-pal-grupo { padding: 8px 14px 3px; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--s-muted); }
  .s-pal-item { display: flex; gap: 10px; align-items: center; padding: 8px 14px; text-decoration: none; color: var(--s-text); cursor: pointer; }
  .s-pal-item .s-ico { flex: none; color: var(--s-muted); }
  .s-pal-item .t { flex: 1; min-width: 0; line-height: 1.3; }
  .s-pal-item .t b { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s-pal-item .t small { color: var(--s-muted); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s-pal-item .ir { color: var(--s-muted); font-size: 12px; white-space: nowrap; }
  .s-pal-item.activo, .s-pal-item:hover { background: var(--s-accent-soft); }
  .s-pal-item.activo .s-ico, .s-pal-item.activo .ir { color: var(--s-accent); }
  .s-pal-nada { padding: 22px 14px; color: var(--s-muted); text-align: center; font-size: 13.5px; }
  .s-pal-pie { border-top: 1px solid var(--s-line); padding: 8px 14px; color: var(--s-muted); font-size: 12px; display: flex; gap: 14px; flex-wrap: wrap; }
  .s-pal-pie kbd { font: 600 10.5px/1 ui-monospace, Consolas, monospace; background: var(--s-kbd); border: 1px solid var(--s-line); border-radius: 4px; padding: 2px 4px; }

  /* --- la ayuda de cada pantalla: un cajon a la derecha, como la IA --- */
  .s-ayuda-boton { width: auto; padding: 0 12px 0 10px; gap: 7px; font-size: 13.5px; white-space: nowrap; flex: none; }
  .s-top-der { flex: none; }
  .s-ayuda-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); background: var(--s-top); border-left: 1px solid var(--s-line); box-shadow: -18px 0 48px rgba(0,0,0,.16); z-index: 80; display: flex; flex-direction: column; transform: translateX(105%); transition: transform .2s ease, visibility 0s linear .2s; visibility: hidden; pointer-events: none; }
  .s-ayuda-panel.abierto { transform: translateX(0); transition: transform .2s ease; visibility: visible; pointer-events: auto; }
  .s-ayuda-cuerpo { flex: 1; min-height: 0; overflow: auto; padding: 6px 14px 14px; }
  .s-ayuda-que { color: var(--s-muted); font-size: 13px; line-height: 1.45; margin: 8px 0 12px; }
  .s-ayuda-barra { display: none; color: var(--s-muted); font-size: 12.5px; line-height: 1.45; margin: -4px 0 12px; padding: 8px 10px; border-radius: var(--radio-sm); background: var(--superficie-2); }
  @media (max-width: 960px) { .s-ayuda-barra { display: block; } }
  .s-ayuda-p { border: 1px solid var(--s-line); border-radius: 10px; margin-bottom: 8px; overflow: hidden; }
  .s-ayuda-p > button { display: flex; width: 100%; min-height: 44px; align-items: center; justify-content: flex-start; gap: 8px; text-align: left; padding: 10px 12px; border: 0; border-radius: 0; background: transparent; color: var(--s-text); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: none; filter: none; }
  .s-ayuda-p > button .s-ico { flex: none; color: var(--s-muted); width: 16px; height: 16px; transition: transform .15s; }
  .s-ayuda-p.abierto > button .s-ico { transform: rotate(90deg); }
  .s-ayuda-r { display: none; padding: 0 12px 12px; font-size: 13.5px; line-height: 1.5; color: var(--s-text); }
  .s-ayuda-p.abierto .s-ayuda-r { display: block; }
  .s-ayuda-r .acciones { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; font-size: 12.5px; }
  .s-ayuda-r .acciones a { color: var(--s-accent); text-decoration: none; cursor: pointer; }
  .s-ayuda-pie { border-top: 1px solid var(--s-line); padding: 10px 14px 12px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; font-size: 13px; }
  .s-ayuda-pie a, .s-ayuda-pie button { color: var(--s-accent); text-decoration: none; cursor: pointer; border: 1px solid var(--s-accent-soft); background: var(--s-accent-soft); border-radius: 9px; padding: 7px 11px; font: inherit; font-size: 13px; font-weight: 600; box-shadow: none; }
  .s-ayuda-pie a.ghost { background: transparent; border-color: var(--s-line); color: var(--s-muted); font-weight: 500; }
  @media (max-width: 960px) { .s-ayuda-boton span { display: none; } .s-ayuda-boton { padding: 0; width: 38px; } .s-buscar-boton { min-width: 0; width: 38px; padding: 0; justify-content: center; } .s-buscar-boton span, .s-buscar-boton kbd { display: none; } }

  @media (max-width: 960px) {
    .s-side { position: fixed; left: 0; top: 0; bottom: 0; z-index: 60; transform: translateX(-105%); transition: transform .18s ease; box-shadow: 0 10px 40px rgba(0,0,0,.25); }
    .s-app.abierto .s-side { transform: none; }
    .s-app.plegado .s-side { width: 262px; }
    .s-app.plegado .s-logo-text, .s-app.plegado .s-item .s-txt, .s-app.plegado .s-badge, .s-app.plegado .s-buscar input,
    .s-app.plegado .s-buscar kbd, .s-app.plegado .s-grupo-cab span, .s-app.plegado .s-user-txt, .s-app.plegado .s-grupo-cab .s-ico { display: initial; }
    .s-app.plegado .s-item { justify-content: flex-start; padding: 9px 10px; }
    .s-app.plegado .s-grupo-items { display: block !important; } .s-app.plegado .s-grupo.cerrado .s-grupo-items { display: none !important; }
    .s-plegar { display: none; }
    .s-menu { display: grid; }
    .s-top { padding: 0 10px; gap: 8px; }
    /* En el movil la barra no puede empujar el ancho: la demo y la ayuda se esconden, el resto se aprieta. */
    .s-top-der { gap: 6px; }
    .s-demo, .s-top .s-chip { display: none; }
    .s-top #state.pill { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
    .s-content { padding: 16px 16px 24px; }
    /* El pie de navegacion del celular: las cuatro pantallas del dia a un pulgar y "Mas" abre el menu.
       Va en el flujo (no flotando): la pantalla se encoge y nada queda tapado, tampoco el cajon de escribir del chat. */
    .s-nav-movil { display: flex; flex: none; height: calc(58px + env(safe-area-inset-bottom, 0px)); padding-bottom: env(safe-area-inset-bottom, 0px); border-top: 1px solid var(--s-line); background: var(--s-top); }
    .s-nav-movil a, .s-nav-movil button { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 58px; padding: 6px 2px; font: inherit; font-size: 11px; line-height: 1.1; color: var(--s-muted); text-decoration: none; border: 0; background: transparent; cursor: pointer; position: relative; }
    .s-nav-movil .s-ico { width: 22px; height: 22px; }
    .s-nav-movil a.activo { color: var(--s-accent); font-weight: 700; }
    .s-nav-movil a.activo::before { content: ''; position: absolute; top: 0; left: 22%; right: 22%; height: 3px; border-radius: 0 0 3px 3px; background: var(--s-accent); }
    .s-app.modo-gsg .s-nav-completo, .s-app.modo-completo .s-nav-gsg { display: none; }
    .s-app.sin-nav-movil .s-nav-movil { display: none; }
    .s-backdrop { display: block; position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 50; opacity: 0; pointer-events: none; transition: opacity .18s; }
    .s-app.abierto .s-backdrop { opacity: 1; pointer-events: auto; }
    .s-chip b { display: none; }
  }
`;

const JS = String.raw`
(function () {
  var app = document.getElementById('s-app');
  var guardar = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  var leer = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };

  /* plegar / desplegar */
  if (leer('s-plegado') === '1') app.classList.add('plegado');
  document.getElementById('s-plegar').onclick = function () {
    app.classList.toggle('plegado');
    guardar('s-plegado', app.classList.contains('plegado') ? '1' : '0');
  };
  document.getElementById('s-menu').onclick = function () { app.classList.toggle('abierto'); };
  /* Chips de variables: chipsDeVariables(textarea, ['{nombre}', '{pedido}'], { etiqueta: 'Tocar para insertar:' })
     pinta una fila de botones bajo el textarea; al tocar uno, la variable entra donde esta el cursor
     (con un espacio delante si hace falta) y se dispara "input" para que la pagina se entere.
     Si ya habia una fila, la sustituye. Vale para cualquier pagina del armazon. */
  window.chipsDeVariables = function (textarea, variables, opciones) {
    if (!textarea || !variables || !variables.length) return null;
    var sig = textarea.nextElementSibling;
    if (sig && sig.classList && sig.classList.contains('s-chips-var')) sig.parentNode.removeChild(sig);
    var fila = document.createElement('div'); fila.className = 's-chips-var';
    var eti = document.createElement('span'); eti.className = 's-chips-var-eti'; eti.textContent = (opciones && opciones.etiqueta) || 'Tocar para insertar:'; fila.appendChild(eti);
    variables.forEach(function (v) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 's-chip-var'; b.textContent = v; b.setAttribute('aria-label', 'Insertar ' + v + ' en el texto');
      b.onclick = function () {
        var ini = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : textarea.value.length;
        var fin = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : ini;
        var antes = textarea.value.slice(0, ini), despues = textarea.value.slice(fin);
        var sep = antes && !/\s$/.test(antes) ? ' ' : '';
        textarea.value = antes + sep + v + despues;
        var pos = (antes + sep + v).length;
        try { textarea.focus(); textarea.setSelectionRange(pos, pos); } catch (e) {}
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      };
      fila.appendChild(b);
    });
    textarea.insertAdjacentElement('afterend', fila);
    return fila;
  };
  var navMas = document.getElementById('s-nav-mas');
  if (navMas) navMas.onclick = function () { app.classList.add('abierto'); };
  function marcarNavMovil() {
    var ruta = location.pathname;
    document.querySelectorAll('#s-nav-movil a[data-ir]').forEach(function (a) {
      var p = a.getAttribute('data-ir').split('#')[0];
      var activo = p === ruta || (p === '/hoy' && ruta === '/entregas') || (p === '/entregas' && ruta === '/hoy') || (p === '/procesos' && ruta.indexOf('/procesos/') === 0);
      a.classList.toggle('activo', activo);
    });
  }
  marcarNavMovil();

  /* modo sencillo (por defecto) o ver todo: se recuerda en este navegador */
  var botonModo = document.getElementById('s-modo');
  function aplicarModo(avanzado) {
    app.classList.toggle('sencillo', !avanzado);
    window.__modoAvanzado = avanzado;
    botonModo.textContent = avanzado ? 'Modo sencillo' : 'Ver todo';
    if (window.__alCambiarModo) window.__alCambiarModo(avanzado);
  }
  aplicarModo(leer('s-modo') === 'avanzado');
  botonModo.onclick = function () {
    var avanzado = !app.classList.contains('sencillo');
    guardar('s-modo', avanzado ? 'sencillo' : 'avanzado');
    aplicarModo(!avanzado);
  };
  document.getElementById('s-backdrop').onclick = function () { app.classList.remove('abierto'); };

  /* grupos: todos abiertos; el que se cierre a mano queda cerrado hasta que se vuelva a abrir */
  document.querySelectorAll('.s-grupo').forEach(function (g) {
    var id = g.getAttribute('data-grupo');
    var guardado = leer('s-grupo-' + id);
    if (guardado === 'cerrado' || (!guardado && g.hasAttribute('data-cerrado'))) g.classList.add('cerrado');
    g.querySelector('.s-grupo-cab').onclick = function () {
      g.classList.toggle('cerrado');
      guardar('s-grupo-' + id, g.classList.contains('cerrado') ? 'cerrado' : 'abierto');
    };
  });

  /* el activo: por ruta y ancla; si no hay ancla que coincida, por ruta */
  function menuVisible() {
    return app.classList.contains('modo-completo') ? '.s-menu-completo' : '.s-menu-gsg';
  }
  function marcarActivo() {
    var ruta = location.pathname;
    var hash = location.hash;
    var items = Array.prototype.slice.call(document.querySelectorAll(menuVisible() + ' .s-item[data-ir]'));
    var exacto = null, porRuta = null;
    items.forEach(function (a) {
      var ir = a.getAttribute('data-ir');
      var p = ir.split('#')[0], h = ir.indexOf('#') >= 0 ? '#' + ir.split('#')[1] : '';
      if (p === ruta && h === hash) exacto = a;
      if (p === ruta && !h && !porRuta) porRuta = a;
    });
    var activo = exacto || porRuta;
    if (!activo && ruta === '/panel' && !hash) activo = document.querySelector(menuVisible() + ' .s-item[data-ir="/panel#inicio"]');
    /* el editor y las corridas son parte de Procesos */
    if (!activo && ruta.indexOf('/procesos/') === 0) activo = document.querySelector(menuVisible() + ' .s-item[data-ir="/procesos"]');
    /* /entregas y /hoy son la misma pantalla */
    if (!activo && (ruta === '/entregas' || ruta === '/hoy')) activo = document.querySelector(menuVisible() + ' .s-item[data-ir="/hoy"], ' + menuVisible() + ' .s-item[data-ir="/entregas"]');
    items.forEach(function (a) { a.classList.toggle('activo', a === activo); });
    var miga = document.getElementById('s-miga');
    if (activo) {
      var g = activo.closest('.s-grupo');
      /* el grupo del modulo abierto siempre se ve, aunque estuviera cerrado */
      if (g) g.classList.remove('cerrado');
      if (miga) miga.textContent = g ? g.querySelector('.s-grupo-cab span').textContent : '';
    } else if (miga) miga.textContent = '';
  }
  marcarActivo();
  window.addEventListener('hashchange', marcarActivo);
  window.shellMarcarActivo = marcarActivo;

  /* navegar dentro de la misma pagina: solo cambia el ancla, sin recargar.
     Y al elegir un modulo, el buscador se limpia: que no queden los demas escondidos. */
  document.querySelectorAll('.s-item[data-ir]').forEach(function (a) {
    a.setAttribute('href', a.getAttribute('data-ir'));
    a.addEventListener('click', function (ev) {
      var ir = a.getAttribute('data-ir');
      var p = ir.split('#')[0];
      limpiarBusqueda();
      if (p === location.pathname && ir.indexOf('#') >= 0) {
        ev.preventDefault();
        if (location.hash === '#' + ir.split('#')[1]) window.dispatchEvent(new HashChangeEvent('hashchange'));
        else location.hash = ir.split('#')[1];
        app.classList.remove('abierto');
      }
    });
  });

  /* buscador de modulos: esconde lo que no encaja mientras se escribe, y lo
     devuelve todo en cuanto se borra, se pulsa Escape o se elige un modulo */
  var q = document.getElementById('s-q');
  var nav = document.querySelector('.s-nav');
  function quitarAcentos(v) { return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function filtrar() {
    var t = quitarAcentos(q.value.trim());
    var grupos = document.querySelectorAll('.s-grupo');
    var visibles = 0;
    if (!t) {
      document.querySelectorAll('.s-item[data-buscar]').forEach(function (a) { a.classList.remove('hidden'); });
      grupos.forEach(function (g) { g.classList.remove('hidden'); if (g.classList.contains('abierto-por-busqueda')) g.classList.remove('abierto-por-busqueda'); if (g.getAttribute('data-estaba') === 'cerrado') { g.classList.add('cerrado'); g.removeAttribute('data-estaba'); } });
      nav.classList.remove('vacio');
      marcarActivo();
      return;
    }
    grupos.forEach(function (g) {
      var alguno = false;
      g.querySelectorAll('.s-item[data-buscar]').forEach(function (a) {
        var ok = quitarAcentos(a.getAttribute('data-buscar')).indexOf(t) >= 0;
        a.classList.toggle('hidden', !ok);
        if (ok) { alguno = true; visibles++; }
      });
      g.classList.toggle('hidden', !alguno);
      if (alguno && g.classList.contains('cerrado')) { g.setAttribute('data-estaba', 'cerrado'); g.classList.remove('cerrado'); g.classList.add('abierto-por-busqueda'); }
    });
    document.querySelectorAll('.s-menu-completo > .s-item[data-buscar]').forEach(function (a) {
      var ok = quitarAcentos(a.getAttribute('data-buscar')).indexOf(t) >= 0;
      a.classList.toggle('hidden', !ok);
      if (ok) visibles++;
    });
    nav.classList.toggle('vacio', visibles === 0);
  }
  function limpiarBusqueda() { if (q.value) { q.value = ''; filtrar(); } }
  q.addEventListener('input', filtrar);
  q.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { limpiarBusqueda(); q.blur(); }
    if (ev.key === 'Enter') {
      /* Primero el que lo lleva en el nombre; si no, el primero que lo menciona. */
      var t = quitarAcentos(q.value.trim());
      var candidatos = Array.prototype.slice.call(document.querySelectorAll('.s-item[data-buscar]:not(.hidden)'));
      var primero = candidatos.filter(function (a) { return quitarAcentos(a.querySelector('.s-txt').textContent).indexOf(t) >= 0; })[0] || candidatos[0];
      if (primero) { limpiarBusqueda(); primero.click(); if (primero.getAttribute('data-ir').split('#')[0] !== location.pathname) location.href = primero.getAttribute('data-ir'); }
    }
  });
  document.querySelector('.s-buscar').addEventListener('click', function () {
    if (app.classList.contains('plegado')) { app.classList.remove('plegado'); guardar('s-plegado', '0'); q.focus(); }
  });

  /* --- el buscador global (Ctrl K): pedidos de hoy, clientes, conversaciones guardadas y modulos --- */
  var palFondo = document.getElementById('s-pal-fondo');
  var palInput = document.getElementById('s-pal-q');
  var palLista = document.getElementById('s-pal-lista');
  var palItems = [];
  var palActivo = 0;
  var palPeticion = 0;
  var palTimer = null;
  function modulosQueCasan(t) {
    var vistos = {};
    return Array.prototype.slice.call(document.querySelectorAll(menuVisible() + ' .s-item[data-ir]')).filter(function (a) {
      if (a.classList.contains('hidden')) return false;
      var g = a.closest('[data-solo-super-grupo]'); if (g && g.classList.contains('hidden')) return false;
      if (a.hasAttribute('data-avanzado') && app.classList.contains('sencillo') && app.classList.contains('modo-completo')) return false;
      var ir = a.getAttribute('data-ir'); if (vistos[ir]) return false; vistos[ir] = 1;
      return !t || quitarAcentos(a.getAttribute('data-buscar') || '').indexOf(t) >= 0;
    }).slice(0, t ? 6 : 8).map(function (a) {
      return { grupo: 'Pantallas', href: a.getAttribute('data-ir'), titulo: a.querySelector('.s-txt').textContent, detalle: a.getAttribute('title') || '', ir: 'Abrir', icono: 'menu' };
    });
  }
  function palPintar(datos, t) {
    palItems = [];
    var html = '';
    function grupo(nombre, lista) {
      if (!lista.length) return;
      html += '<div class="s-pal-grupo">' + escapar(nombre) + '</div>';
      lista.forEach(function (x) {
        var i = palItems.length; palItems.push(x);
        html += '<a class="s-pal-item' + (i === palActivo ? ' activo' : '') + '" data-i="' + i + '" href="' + escapar(x.href) + '">' + iconoPal(x.icono) + '<span class="t"><b>' + escapar(x.titulo) + '</b>' + (x.detalle ? '<small>' + escapar(x.detalle) + '</small>' : '') + '</span><span class="ir">' + escapar(x.ir) + '</span></a>';
      });
    }
    if (datos) {
      grupo('Pedidos de hoy', datos.pedidos.map(function (p) { return { href: p.href, titulo: p.referencia + (p.nombre ? ' · ' + p.nombre : ''), detalle: p.situacion, ir: 'Ver en Hoy', icono: 'moto' }; }));
      grupo('Clientes', datos.clientes.map(function (c) { return { href: c.href, titulo: c.nombre || telefonoBonito(c.telefono), detalle: (c.nombre ? telefonoBonito(c.telefono) + ' · ' : '') + 'abrir el chat', ir: 'Chat', icono: 'chat', extra: c.guardadosHref }; }));
      grupo('Conversaciones guardadas', datos.guardados.map(function (g) { return { href: g.href, titulo: (g.nombre || telefonoBonito(g.telefono)) + (g.pedido ? ' · ' + g.pedido : ''), detalle: (g.resumen || 'sin resumen') + ' · ' + new Date(g.cerradoEn).toLocaleDateString('es-PE'), ir: 'Leer', icono: 'historial' }; }));
    }
    grupo('Pantallas', modulosQueCasan(t));
    if (!palItems.length) html = '<div class="s-pal-nada">' + (t ? 'Nada con «' + escapar(t) + '». Prueba con el nombre, el número o la referencia del pedido.' : 'Escribe un nombre, un número, una referencia (P-1001) o una pantalla.') + '</div>';
    palLista.innerHTML = html;
  }
  function iconoPal(nombre) {
    var svg = { moto: '<circle cx="5.5" cy="17" r="3"/><circle cx="18.5" cy="17" r="3"/><path d="M5.5 17h6l2.5-6h4.5"/><path d="M13 11l-1.5-4H9"/><path d="M16 11l2.5 6"/>', chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z"/>', historial: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>' }[nombre] || '';
    return '<svg class="s-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + svg + '</svg>';
  }
  function palBuscar() {
    var texto = palInput.value.trim();
    var t = quitarAcentos(texto);
    palActivo = 0;
    if (texto.length < 2) { palPintar(null, t); return; }
    var mia = ++palPeticion;
    fetch('/admin/buscar?q=' + encodeURIComponent(texto), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (mia !== palPeticion) return;
      palPintar(d || { pedidos: [], clientes: [], guardados: [] }, t);
    }).catch(function () { if (mia === palPeticion) palPintar({ pedidos: [], clientes: [], guardados: [] }, t); });
  }
  function palAbrir() {
    palFondo.classList.add('abierto');
    palInput.value = '';
    palPintar(null, '');
    setTimeout(function () { palInput.focus(); }, 20);
  }
  function palCerrar() { palFondo.classList.remove('abierto'); }
  function palIr(i) {
    var x = palItems[i];
    if (!x) return;
    palCerrar();
    var p = x.href.split('#')[0];
    if (p === location.pathname && x.href.indexOf('#') >= 0) {
      if (location.hash === '#' + x.href.split('#')[1]) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = x.href.split('#')[1];
      return;
    }
    location.href = x.href;
  }
  window.abrirBuscador = palAbrir;
  document.getElementById('s-buscar-boton').onclick = palAbrir;
  palFondo.addEventListener('click', function (ev) { if (ev.target === palFondo) palCerrar(); });
  palInput.addEventListener('input', function () { clearTimeout(palTimer); palTimer = setTimeout(palBuscar, 160); });
  palInput.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); palCerrar(); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!palItems.length) return;
      palActivo = (palActivo + (ev.key === 'ArrowDown' ? 1 : palItems.length - 1)) % palItems.length;
      Array.prototype.forEach.call(palLista.querySelectorAll('.s-pal-item'), function (a, i) { a.classList.toggle('activo', i === palActivo); if (i === palActivo) a.scrollIntoView({ block: 'nearest' }); });
      return;
    }
    if (ev.key === 'Enter') { ev.preventDefault(); palIr(palActivo); }
  });
  palLista.addEventListener('click', function (ev) {
    var a = ev.target.closest('.s-pal-item');
    if (!a) return;
    ev.preventDefault();
    palIr(Number(a.getAttribute('data-i')));
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')) {
      ev.preventDefault();
      if (palFondo.classList.contains('abierto')) palCerrar(); else palAbrir();
    }
  });
  /* Llegar a Hoy con ?buscar=P-1001 (desde el buscador) deja escrita la busqueda de la tabla. */
  try {
    if (location.pathname === '/hoy' || location.pathname === '/entregas') {
      var buscarHoy = new URLSearchParams(location.search).get('buscar');
      var cajaHoy = document.getElementById('buscar');
      if (buscarHoy && cajaHoy) { cajaHoy.value = buscarHoy; setTimeout(function () { cajaHoy.dispatchEvent(new Event('input')); }, 600); }
    }
  } catch (e) { /* sin busqueda */ }

  /* quien esta dentro */
  function iniciales(n) {
    var p = String(n || '').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }
  fetch('/admin/yo', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (u) {
    if (!u) return;
    window.__yo = u;
    document.querySelectorAll('.s-avatar').forEach(function (a) { a.textContent = iniciales(u.nombre); });
    document.getElementById('s-nombre').textContent = u.nombre;
    document.getElementById('s-rol').textContent = u.super ? 'Superadministrador' : u.rol === 'admin' ? 'Administrador' : 'Operador';
    var chip = document.getElementById('s-chip-nombre'); if (chip) chip.textContent = u.nombre;
    if (u.rol !== 'admin') document.querySelectorAll('.s-item[data-solo-admin], [data-solo-admin-grupo]').forEach(function (a) { a.classList.add('hidden'); });
    if (!u.super) document.querySelectorAll('.s-item[data-solo-super], [data-solo-super-grupo]').forEach(function (a) { a.classList.add('hidden'); });
    /* Pagar solo tiene sentido cuando esta instalacion depende de un maestro (hay a quien mandarle la captura). */
    if (!u.conMaestro) document.querySelectorAll('.s-item[data-ir="/pagar"]').forEach(function (a) { a.classList.add('hidden'); });
    if (u.modo && app.getAttribute('data-modo') !== u.modo) {
      app.classList.remove('modo-gsg', 'modo-completo');
      app.classList.add('modo-' + u.modo);
      app.setAttribute('data-modo', u.modo);
      marcarActivo();
    }
    window.__modoSistema = u.modo || app.getAttribute('data-modo');
    document.dispatchEvent(new CustomEvent('yo', { detail: u }));
  }).catch(function () {});

  /* el globo de chats sin leer */
  function globoChats() {
    fetch('/admin/chat/conversations?limit=1', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var b = document.getElementById('s-badge-chats');
      if (b && d) b.textContent = d.unread > 0 ? String(d.unread) : '';
    }).catch(function () {});
  }
  globoChats();
  setInterval(globoChats, 30000);

  /* avisos: lo que espera a una persona, en todas las pantallas */
  var avisosBox = document.getElementById('s-avisos');
  document.getElementById('s-avisos-boton').onclick = function (ev) { ev.stopPropagation(); avisosBox.classList.toggle('abierto'); };
  /* Modo noche: automatico (el del sistema), noche o claro, en ese orden.
     Se guarda en este navegador; TEMA_SCRIPT lo aplica antes de pintar. */
  (function () {
    var ICO = { auto: ${JSON.stringify(icono('auto'))}, oscuro: ${JSON.stringify(icono('luna'))}, claro: ${JSON.stringify(icono('sol'))} };
    var NOMBRE = { auto: 'automático (el del sistema)', oscuro: 'modo noche', claro: 'modo claro' };
    var boton = document.getElementById('s-tema');
    function actual() { try { var t = localStorage.getItem('gsg-tema'); return t === 'oscuro' || t === 'claro' ? t : 'auto'; } catch (e) { return 'auto'; } }
    function pintar(t) {
      if (t === 'auto') document.documentElement.removeAttribute('data-tema'); else document.documentElement.setAttribute('data-tema', t);
      document.getElementById('s-tema-ico').innerHTML = ICO[t];
      boton.title = 'Tema: ' + NOMBRE[t] + '. Pulsa para cambiar.';
    }
    pintar(actual());
    boton.onclick = function () {
      var sig = { auto: 'oscuro', oscuro: 'claro', claro: 'auto' }[actual()];
      try { if (sig === 'auto') localStorage.removeItem('gsg-tema'); else localStorage.setItem('gsg-tema', sig); } catch (e) {}
      pintar(sig);
    };
  })();
  document.addEventListener('click', function (ev) { if (!avisosBox.contains(ev.target)) avisosBox.classList.remove('abierto'); });
  function escapar(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /* Un numero como lo leeria una persona: +51 987 000 001. */
  function telefonoBonito(p) { p = String(p || ''); if (!p) return ''; if (p.length === 11 && p.indexOf('51') === 0) return '+51 ' + p.slice(2, 5) + ' ' + p.slice(5, 8) + ' ' + p.slice(8); return '+' + p; }
  window.telefonoBonito = telefonoBonito;
  function cargarAvisos() {
    fetch('/admin/avisos', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      var num = document.getElementById('s-avisos-num');
      var urgentes = d.avisos.filter(function (a) { return a.nivel !== 'info'; }).length;
      num.textContent = d.total ? String(d.total) : '';
      num.style.background = urgentes ? '#dc2626' : '#128c7e';
      var lista = document.getElementById('s-avisos-lista');
      lista.innerHTML = d.avisos.length
        ? d.avisos.map(function (a) { return '<a class="s-aviso ' + a.nivel + '" href="' + escapar(a.href) + '"><i></i><span>' + escapar(a.texto) + '</span></a>'; }).join('')
        : '<div class="s-aviso-nada">Nada pendiente. Todo al día.</div>';
      document.title = (d.total ? '(' + d.total + ') ' : '') + document.title.replace(/^\(\d+\) /, '');
      var franja = document.getElementById('s-plan');
      if (d.plan) { franja.className = 's-plan ' + d.plan.nivel; franja.innerHTML = escapar(d.plan.texto) + '<a href="/panel#configuracion">Ver mi plan</a>'; } else { franja.className = 's-plan hidden'; }
    }).catch(function () {});
  }
  cargarAvisos();
  setInterval(function () { if (!document.hidden) cargarAvisos(); }, 30000);

  /* --- la ayuda de esta pantalla: "¿Qué hago si…?" --- */
  var ayudaDatos = {};
  try { ayudaDatos = window.__ayudaPantallas || {}; } catch (e) { ayudaDatos = {}; }
  var ayudaPanel = document.getElementById('s-ayuda-panel');
  function claveAyuda() {
    var ruta = location.pathname.replace(/\/+$/, '') || '/';
    var ancla = location.hash.replace(/^#/, '');
    if (ruta === '/panel') return ancla || 'inicio';
    if (ruta === '/entregas') return 'hoy';
    return ruta.replace(/^\//, '').split('/')[0] || 'inicio';
  }
  function pintarAyuda() {
    var clave = claveAyuda();
    var a = ayudaDatos[clave];
    var titulo = document.getElementById('s-ayuda-titulo');
    var cuerpo = document.getElementById('s-ayuda-cuerpo');
    document.getElementById('s-ayuda-manual').setAttribute('href', '/manual#m-' + clave);
    if (!a) {
      titulo.textContent = 'Ayuda';
      cuerpo.innerHTML = '<p class="s-ayuda-que">Para esta pantalla no hay preguntas preparadas. El manual y la IA operadora te ayudan con lo que sea.</p>';
      return;
    }
    titulo.textContent = a.titulo;
    cuerpo.innerHTML = '<p class="s-ayuda-que">' + escapar(a.que) + '</p><p class="s-ayuda-barra">Los botones de arriba: la campana son los avisos, la lupa busca clientes y pedidos, «IA» recibe órdenes con palabras y «?» es esta ayuda.</p>' + a.preguntas.map(function (p, i) {
      return '<div class="s-ayuda-p" data-i="' + i + '"><button type="button">' + iconoPalChevron() + '<span>' + escapar(p.p) + '</span></button><div class="s-ayuda-r">' + escapar(p.r) + '<div class="acciones">' + (p.ir ? '<a href="' + escapar(p.ir) + '">' + escapar(p.irTexto || 'Ir') + ' →</a>' : '') + '<a data-preguntar-ia="' + i + '">Preguntar esto a la IA</a></div></div></div>';
    }).join('');
  }
  function iconoPalChevron() { return '<svg class="s-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>'; }
  var panelFondo = document.getElementById('s-panel-fondo');
  function actualizarFondoPaneles() {
    var iaCajaEl = document.getElementById('s-ia');
    var abierto = ayudaPanel.classList.contains('abierto') || (iaCajaEl && iaCajaEl.classList.contains('abierto'));
    panelFondo.classList.toggle('visible', Boolean(abierto));
  }
  panelFondo.onclick = function () {
    ayudaPanel.classList.remove('abierto');
    var iaCajaEl = document.getElementById('s-ia'); if (iaCajaEl) iaCajaEl.classList.remove('abierto');
    actualizarFondoPaneles();
  };
  function apuntarAyuda() { if (ayudaPanel.classList.contains('abierto')) pintarAyuda(); }
  function abrirAyuda() {
    pintarAyuda();
    ayudaPanel.classList.add('abierto');
    var ia = document.getElementById('s-ia'); if (ia) ia.classList.remove('abierto');
    actualizarFondoPaneles();
  }
  window.abrirAyudaPantalla = abrirAyuda;
  document.getElementById('s-ayuda').onclick = function () { if (ayudaPanel.classList.contains('abierto')) ayudaPanel.classList.remove('abierto'); else abrirAyuda(); actualizarFondoPaneles(); };
  document.getElementById('s-ayuda-cerrar').onclick = function () { ayudaPanel.classList.remove('abierto'); actualizarFondoPaneles(); };
  document.getElementById('s-ayuda-cuerpo').addEventListener('click', function (ev) {
    var pregunta = ev.target.closest('[data-preguntar-ia]');
    if (pregunta) {
      var a = ayudaDatos[claveAyuda()];
      var p = a ? a.preguntas[Number(pregunta.getAttribute('data-preguntar-ia'))] : null;
      ayudaPanel.classList.remove('abierto');
      if (window.abrirOperadorIA) window.abrirOperadorIA(p ? 'En ' + a.titulo + ': ' + p.p : '');
      return;
    }
    var b = ev.target.closest('.s-ayuda-p > button');
    if (b) b.parentNode.classList.toggle('abierto');
  });
  document.getElementById('s-ayuda-ia').onclick = function () {
    var a = ayudaDatos[claveAyuda()];
    ayudaPanel.classList.remove('abierto');
    if (window.abrirOperadorIA) window.abrirOperadorIA(a ? 'Sobre la pantalla ' + a.titulo + ': ' : '');
  };
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && ayudaPanel.classList.contains('abierto')) { ayudaPanel.classList.remove('abierto'); actualizarFondoPaneles(); } });
  window.addEventListener('hashchange', apuntarAyuda);

  /* --- la IA operadora ------------------------------------------------- */
  var iaCaja = document.getElementById('s-ia');
  var iaHilo = document.getElementById('s-ia-hilo');
  var iaTexto = document.getElementById('s-ia-texto');
  var iaEnviar = document.getElementById('s-ia-enviar');
  var iaHistorial = [];
  try { iaHistorial = JSON.parse(sessionStorage.getItem('wa_ia_hilo') || '[]'); } catch (e) { iaHistorial = []; }
  /* Una tarjeta que se estaba haciendo cuando se recargó la página no se vuelve a ofrecer: se mira en Actividad. */
  iaHistorial.forEach(function (m) { if (m && m.estadoTarjeta === 'haciendo') { m.estadoTarjeta = 'hecha'; m.resultados = []; m.errorTarjeta = 'Se estaba haciendo cuando se recargó la página: mira cómo salió en Actividad.'; } });
  function iaGuardar() { try { sessionStorage.setItem('wa_ia_hilo', JSON.stringify(iaHistorial.slice(-30))); } catch (e) {} }
  var EJEMPLOS_IA = ['¿cómo van las entregas de hoy?', 'dame los pedidos sin ubicación', 'asígnale el pedido GSG-IA-001 a Carlos', 'pasa a descanso al motorizado Ali', 'confirma el envío de todos los números del día', '¿cuántos entregó Carlos hoy?', 'apaga el bot en el chat de 912426667', '¿por qué no salen mensajes?'];
  /* Lo que cambia algo llega preparado en UNA tarjeta: exactamente lo que va a
     pasar (qué, a quién, cuántos, antes → después) y se hace al pulsar
     «Hacerlo». Varios candidatos = botones para elegir, nunca se adivina. */
  function iaPaso(p, j, m) {
    var t = p.tarjeta || { que: p.descripcion };
    var r = m.resultados ? m.resultados[j] : null;
    var h = '<li class="s-ia-paso' + (p.peligrosa ? ' delicado' : '') + (r ? (r.ok ? ' bien' : ' mal') : '') + '">';
    h += '<b>' + escapar(t.que) + '</b>';
    if (t.aQuien) h += '<span class="l"><i>A quién:</i> ' + escapar(t.aQuien) + '</span>';
    if (t.cuantos && t.cuantos > 1) h += '<span class="l"><i>Cuántos:</i> ' + escapar(t.cuantos) + '</span>';
    if (t.antes || t.despues) h += '<span class="l ad"><i>Antes:</i> ' + escapar(t.antes || '—') + '<br><i>Después:</i> ' + escapar(t.despues || '—') + '</span>';
    if (t.mensaje) h += '<span class="l msj">«' + escapar(t.mensaje) + '»</span>';
    if (t.avisos && t.avisos.length) h += '<span class="l avisos">' + t.avisos.map(function (a) { return '⚠ ' + escapar(a); }).join('<br>') + '</span>';
    if (p.peligrosa && !r) h += '<span class="l avisos">Es delicado: revísalo bien.</span>';
    if (r) h += '<span class="l res">' + (r.ok ? '✅ ' : '⚠ No: ') + escapar(r.resumen) + (r.ir ? ' <a href="' + escapar(r.ir) + '">ver →</a>' : '') + '</span>';
    else if (!m.estadoTarjeta && m.pendientes.length > 1 && !m.simulado) h += '<button type="button" class="quitar" data-quitar="' + j + '" title="Quitar este paso">Quitar</button>';
    return h + '</li>';
  }
  function iaTarjeta(m, i) {
    var pend = m.pendientes || [];
    var eleg = m.elegir || [];
    if (!pend.length && !eleg.length) return '';
    var estado = m.estadoTarjeta || '';
    var h = '<div class="s-ia-tarjeta' + (estado === 'cancelada' ? ' apagada' : '') + '" data-msg="' + i + '">';
    h += '<div class="cab">' + (m.simulado ? 'Solo simulado: esto es lo que haría (no se hará)' : estado === 'hecha' ? 'Hecho: así salió cada paso' : estado === 'cancelada' ? 'Cancelado: no se hizo nada' : estado === 'haciendo' ? 'Haciéndolo…' : 'Esto es lo que voy a hacer') + '</div>';
    if (pend.length) h += '<ol class="pasos">' + pend.map(function (p, j) { return iaPaso(p, j, m); }).join('') + '</ol>';
    eleg.forEach(function (e, k) {
      h += '<div class="s-ia-elegir"><span>' + escapar(e.pregunta) + '</span><div class="ops">' + e.opciones.map(function (o, n) { return '<button type="button" data-opcion="' + k + ':' + n + '"' + (estado ? ' disabled' : '') + '>' + escapar(o.etiqueta) + '</button>'; }).join('') + '</div>' + (e.error ? '<span class="err">' + escapar(e.error) + '</span>' : '') + '</div>';
    });
    if (!m.simulado && !estado) {
      var falta = eleg.length > 0;
      h += '<div class="botones"><button type="button" class="si" data-hacer="1"' + (falta || !pend.length ? ' disabled' : '') + '>Hacerlo' + (pend.length > 1 ? ' (' + pend.length + ')' : '') + '</button><button type="button" data-cancelar="1">Cancelar</button></div>';
      if (falta) h += '<div class="nota">Elige primero ' + (eleg.length > 1 ? 'las opciones' : 'la opción') + ' de arriba.</div>';
    }
    if (m.errorTarjeta) h += '<div class="err">' + escapar(m.errorTarjeta) + '</div>';
    return h + '</div>';
  }
  function iaPintar() {
    if (!iaHistorial.length) {
      iaHilo.innerHTML = '<div class="s-ia-vacio">Dile con palabras qué hacer o qué mirar. Lo que solo lee te lo contesta al momento; lo que cambia algo te lo enseña primero en una tarjeta (qué, a quién, antes → después) y lo hace cuando pulsas <b>Hacerlo</b>. Trabaja con tu cuenta y tus permisos.<ul>' + EJEMPLOS_IA.map(function (e) { return '<li data-ej="' + escapar(e) + '">' + escapar(e) + '</li>'; }).join('') + '</ul></div>';
      return;
    }
    iaHilo.innerHTML = iaHistorial.map(function (m, i) {
      if (m.role === 'user') return '<div class="s-ia-b yo">' + escapar(m.content) + '</div>';
      var html = '<div class="s-ia-b' + (m.error ? ' mal' : '') + '">' + escapar(m.content) + '</div>';
      var hechas = (m.hechas || []).map(function (h) {
        return '<div class="s-ia-hecha"><span class="ic">' + (h.ok ? (h.tipo === 'consulta' ? '🔎' : '✅') : '⚠') + '</span><span class="q">' + escapar(h.resumen) + '</span>' + (h.ir ? '<a href="' + escapar(h.ir) + '">ver →</a>' : '') + '</div>';
      });
      if (hechas.length) html += '<div class="s-ia-hechas">' + hechas.join('') + '</div>';
      return html + iaTarjeta(m, i);
    }).join('');
    iaHilo.scrollTop = iaHilo.scrollHeight;
  }
  function iaAbrir(textoInicial) {
    iaCaja.classList.add('abierto');
    ayudaPanel.classList.remove('abierto');
    actualizarFondoPaneles();
    iaPintar();
    if (textoInicial) iaTexto.value = textoInicial;
    setTimeout(function () { iaTexto.focus(); var n = iaTexto.value.length; try { iaTexto.setSelectionRange(n, n); } catch (e) {} }, 30);
  }
  window.abrirOperadorIA = iaAbrir;
  document.getElementById('s-ia-boton').onclick = function () { if (iaCaja.classList.contains('abierto')) { iaCaja.classList.remove('abierto'); actualizarFondoPaneles(); } else iaAbrir(); };
  document.getElementById('s-ia-cerrar').onclick = function () { iaCaja.classList.remove('abierto'); actualizarFondoPaneles(); };
  document.getElementById('s-ia-limpiar').onclick = function () { iaHistorial = []; iaGuardar(); iaPintar(); };
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && iaCaja.classList.contains('abierto') && document.activeElement !== iaTexto) { iaCaja.classList.remove('abierto'); actualizarFondoPaneles(); } });
  function iaPost(url, cuerpo) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
  }
  iaHilo.addEventListener('click', function (ev) {
    var ej = ev.target.closest('[data-ej]');
    if (ej) { iaTexto.value = ej.getAttribute('data-ej'); iaTexto.focus(); return; }
    var b = ev.target.closest('button');
    if (!b || b.disabled) return;
    var caja = b.closest('.s-ia-tarjeta');
    if (!caja) return;
    var m = iaHistorial[Number(caja.getAttribute('data-msg'))];
    if (!m || m.estadoTarjeta) return;
    m.pendientes = m.pendientes || [];
    m.elegir = m.elegir || [];
    if (b.hasAttribute('data-cancelar')) { m.estadoTarjeta = 'cancelada'; iaGuardar(); iaPintar(); return; }
    if (b.hasAttribute('data-quitar')) { m.pendientes.splice(Number(b.getAttribute('data-quitar')), 1); iaGuardar(); iaPintar(); return; }
    if (b.hasAttribute('data-opcion')) {
      var par = b.getAttribute('data-opcion').split(':');
      var el = m.elegir[Number(par[0])];
      var op = el ? el.opciones[Number(par[1])] : null;
      if (!op) return;
      b.disabled = true;
      iaPost('/admin/ia/ordenes/preparar', { accion: Object.assign({ accion: el.accion }, op.parametros) }).then(function (x) {
        if (!x.ok) { el.error = x.d.error || 'No se pudo preparar.'; }
        else {
          var k = m.elegir.indexOf(el);
          if (x.d.elegir) m.elegir.splice(k, 1, x.d.elegir);
          else { m.elegir.splice(k, 1); if (x.d.pendiente) m.pendientes.push(x.d.pendiente); }
        }
        iaGuardar(); iaPintar();
      }).catch(function (e) { el.error = e.message; iaGuardar(); iaPintar(); });
      return;
    }
    if (b.hasAttribute('data-hacer')) {
      if (!m.pendientes.length || m.elegir.length) return;
      m.estadoTarjeta = 'haciendo';
      iaPintar();
      var acciones = m.pendientes.map(function (p) { return Object.assign({ accion: p.accion }, p.parametros); });
      iaPost('/admin/ia/ordenes/confirmar', { acciones: acciones, orden: m.orden || '' }).then(function (x) {
        if (!x.ok) { m.estadoTarjeta = ''; m.errorTarjeta = x.d.error || ('No se pudo (' + x.status + ').'); }
        else {
          m.estadoTarjeta = 'hecha';
          m.errorTarjeta = '';
          m.resultados = x.d.hechas || [];
          if (m.resultados.some(function (h) { return h.ok; })) document.dispatchEvent(new CustomEvent('ia:cambio'));
        }
        iaGuardar(); iaPintar();
      }).catch(function (e) { m.estadoTarjeta = ''; m.errorTarjeta = 'No se pudo hablar con el servidor: ' + e.message; iaGuardar(); iaPintar(); });
    }
  });
  // Lo que paso con cada respuesta (consultas, tarjeta hecha, cancelada o sin
  // pulsar): va con el hilo para que la IA entienda «ese», «lo mismo con Rosa»
  // o «no, a Carlos» (ver historialParaElModelo en src/ia/ordenes.ts).
  function iaContextoDe(m) {
    if (m.role !== 'assistant') return [];
    var c = [];
    (m.hechas || []).forEach(function (h) { c.push({ accion: h.accion, estado: h.tipo === 'consulta' ? 'consultada' : (h.ok ? 'hecha' : 'fallo'), parametros: h.parametros, resumen: String(h.resumen || '').slice(0, 500) }); });
    (m.pendientes || []).forEach(function (p, i) {
      var r = (m.resultados || [])[i];
      var estado = m.estadoTarjeta === 'hecha' ? (r && !r.ok ? 'fallo' : 'hecha') : m.estadoTarjeta === 'cancelada' ? 'cancelada' : 'preparada';
      c.push({ accion: p.accion, estado: estado, parametros: p.parametros, resumen: String((r && r.resumen) || p.descripcion || '').slice(0, 500) });
    });
    (m.elegir || []).forEach(function (e) { c.push({ accion: e.accion, estado: 'por_elegir', resumen: String(e.pregunta || '').slice(0, 500) }); });
    return c.slice(0, 20);
  }
  function iaOrdenar() {
    var texto = iaTexto.value.trim();
    if (!texto || iaEnviar.disabled) return;
    iaEnviar.disabled = true;
    iaTexto.value = '';
    var historial = iaHistorial.filter(function (m) { return !m.error; }).map(function (m) { var c = iaContextoDe(m); return c.length ? { role: m.role, content: m.content, contexto: c } : { role: m.role, content: m.content }; }).slice(-10);
    iaHistorial.push({ role: 'user', content: texto });
    iaHistorial.push({ role: 'assistant', content: 'Un momento…', pensando: true });
    iaPintar();
    fetch('/admin/ia/ordenes', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: texto, historial: historial, simular: document.getElementById('s-ia-simular').checked }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
      .then(function (x) {
        iaHistorial.pop();
        if (!x.ok) {
          var msg = x.d.error || ('No se pudo (' + x.status + ').');
          if (/Puter|conecta/i.test(msg)) msg += ' → Mi asistente IA (/panel#ia).';
          iaHistorial.push({ role: 'assistant', content: msg, error: true });
        } else {
          iaHistorial.push({ role: 'assistant', content: x.d.texto || '(sin respuesta)', hechas: x.d.hechas || [], pendientes: x.d.pendientes || [], elegir: x.d.elegir || [], simulado: x.d.simulado, orden: texto });
          if ((x.d.hechas || []).some(function (h) { return h.ok && h.tipo === 'cambio'; })) document.dispatchEvent(new CustomEvent('ia:cambio'));
        }
        iaGuardar(); iaPintar(); iaEnviar.disabled = false; iaTexto.focus();
      })
      .catch(function (e) { iaHistorial.pop(); iaHistorial.push({ role: 'assistant', content: 'No se pudo hablar con el servidor: ' + e.message, error: true }); iaGuardar(); iaPintar(); iaEnviar.disabled = false; });
  }
  iaEnviar.onclick = iaOrdenar;
  iaTexto.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); iaOrdenar(); } });
  iaTexto.addEventListener('input', function () { iaTexto.style.height = 'auto'; iaTexto.style.height = Math.min(140, iaTexto.scrollHeight) + 'px'; });
  var catCargado = false;
  document.getElementById('s-ia-ver-cat').onclick = function () {
    iaCaja.classList.toggle('con-catalogo');
    if (catCargado || !iaCaja.classList.contains('con-catalogo')) return;
    catCargado = true;
    fetch('/admin/ia/ordenes/catalogo', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      document.getElementById('s-ia-cat').innerHTML = d.acciones.map(function (a) { return '<div><b>' + escapar(a.descripcion) + (a.tipo === 'cambio' ? ' <i>(con «Hacerlo»' + (a.peligrosa ? ', delicado' : '') + ')</i>' : ' <i>(al momento)</i>') + (a.soloAdmin ? ' <i>(solo administrador)</i>' : '') + '</b><i>Ej.: «' + escapar(a.ejemplo) + '»</i></div>'; }).join('');
    }).catch(function () {});
  };

  window.shellTitulo = function (titulo, sub) {
    document.getElementById('s-h1').textContent = titulo;
    document.getElementById('s-sub').textContent = sub || '';
    document.title = titulo + ' - ' + document.getElementById('s-app').getAttribute('data-negocio');
    apuntarAyuda();
  };
})();
`;

export interface ShellOpts {
  titulo: string;
  subtitulo?: string;
  contenido: string;
  script?: string;
  css?: string;
  nombreNegocio: string;
  demo?: boolean;
  /** El contenido ocupa todo el alto, sin margenes (el chat). */
  lleno?: boolean;
  /** Emoji del icono de la pestaña. */
  icono?: string;
  /** El modo del sistema; si no se pasa, el vigente. */
  modo?: ModoSistema;
}

function itemHtml(item: ItemMenu, sub: boolean): string {
  const buscar = escapeHtml(`${item.etiqueta} ${item.descripcion}`.toLowerCase());
  const badge = item.id === 'chats' ? '<span class="s-badge" id="s-badge-chats"></span>' : '';
  return `<a class="s-item${sub ? ' sub' : ''}" data-ir="${item.href}" data-buscar="${buscar}"${item.soloAdmin ? ' data-solo-admin="1"' : ''}${item.soloSuper ? ' data-solo-super="1"' : ''}${item.avanzado ? ' data-avanzado="1"' : ''} title="${escapeHtml(item.descripcion)}">${icono(item.icono)}<span class="s-txt">${escapeHtml(item.etiqueta)}</span>${badge}</a>`;
}

export function appShell(opts: ShellOpts): string {
  const negocio = escapeHtml(opts.nombreNegocio || 'WhatsApp');
  const modo = opts.modo ?? modoVigente();
  const conGsg = gsgVigente();
  const arriba = MENU_ARRIBA.map((i) => itemHtml(i, false)).join('\n      ');
  // Sin la plantilla de GSG, los procesos son lo del día a día: van a la vista, justo después de Inicio.
  const visiblesGsg = MENU_GSG.filter((i) => conGsg || !i.soloGsg)
    .map((i) => (!conGsg && i.seccion === 'Procesos' ? { ...i, seccion: undefined } : i))
    .sort((a, b) => (!conGsg ? Number(a.id !== 'inicio' && !['procesos', 'personas', 'respuestas'].includes(a.id)) - Number(b.id !== 'inicio' && !['procesos', 'personas', 'respuestas'].includes(b.id)) : 0));
  // Lo del dia a dia a la vista (el chat, el envio automatico y los motorizados); lo demas, en secciones plegadas.
  const secciones: string[] = [];
  for (const i of visiblesGsg) if (i.seccion && !secciones.includes(i.seccion)) secciones.push(i.seccion);
  const menuGsg = [
    ...visiblesGsg.filter((i) => !i.seccion).map((i) => itemHtml(i, false)),
    ...secciones.map((sec) => {
      const items = visiblesGsg.filter((i) => i.seccion === sec);
      // Sin la plantilla de GSG, los procesos son lo del dia a dia: esa seccion nace abierta.
      const cerrada = !(sec === 'Procesos' && !conGsg);
      return `<div class="s-grupo" data-grupo="gsg-${escapeHtml(sec.toLowerCase())}"${cerrada ? ' data-cerrado="1"' : ''}>
        <button class="s-grupo-cab" type="button"><span>${escapeHtml(sec)}</span>${icono('chevron')}</button>
        <div class="s-grupo-items">
          ${items.map((i) => itemHtml(i, true)).join('\n          ')}
        </div>
      </div>`;
    }),
  ].join('\n      ');
  // El pie del celular: las cuatro pantallas del dia. Con las entregas de courier, las de siempre; si no, las de los procesos.
  const pieGsg = conGsg
    ? `<a class="s-nav-gsg" href="/hoy" data-ir="/hoy">${icono('moto')}<span>Hoy</span></a>
      <a class="s-nav-completo" href="/panel#inicio" data-ir="/panel#inicio">${icono('inicio')}<span>Inicio</span></a>
      <a href="/chat" data-ir="/chat">${icono('chat')}<span>Chats</span></a>
      <a class="s-nav-gsg" href="/motorizados" data-ir="/motorizados">${icono('contactos')}<span>Motorizados</span></a>
      <a class="s-nav-completo" href="/entregas" data-ir="/entregas">${icono('moto')}<span>Entregas</span></a>
      <a href="/mapa" data-ir="/mapa">${icono('mapa')}<span>Mapa</span></a>`
    : `<a href="/procesos" data-ir="/procesos">${icono('flujo')}<span>Procesos</span></a>
      <a href="/chat" data-ir="/chat">${icono('chat')}<span>Chats</span></a>
      <a href="/personas" data-ir="/personas">${icono('contactos')}<span>Personas</span></a>
      <a href="/respuestas" data-ir="/respuestas">${icono('lista')}<span>Respuestas</span></a>`;
  const dueno = `<div class="s-grupo" data-grupo="${MENU_GSG_DUENO.id}" data-solo-super-grupo="1" data-cerrado="1">
        <button class="s-grupo-cab" type="button"><span>${escapeHtml(MENU_GSG_DUENO.etiqueta)}</span>${icono('chevron')}</button>
        <div class="s-grupo-items">
          ${MENU_GSG_DUENO.items.map((i) => itemHtml(i, true)).join('\n          ')}
        </div>
      </div>`;
  const desarrollador = `<div class="s-grupo" data-grupo="${MENU_DESARROLLADOR.id}" data-solo-admin-grupo="1" data-cerrado="1">
        <button class="s-grupo-cab" type="button"><span>${escapeHtml(MENU_DESARROLLADOR.etiqueta)}</span>${icono('chevron')}</button>
        <div class="s-grupo-items">
          ${MENU_DESARROLLADOR.items.map((i) => itemHtml(i, true)).join('\n          ')}
        </div>
      </div>`;
  const grupos = MENU_GRUPOS.map(
    (g) => `<div class="s-grupo${g.items.every((i) => i.avanzado) ? ' s-grupo-avanzado' : ''}" data-grupo="${g.id}">
        <button class="s-grupo-cab" type="button"><span>${escapeHtml(g.etiqueta)}</span>${icono('chevron')}</button>
        <div class="s-grupo-items">
          ${g.items.map((i) => itemHtml(i, true)).join('\n          ')}
        </div>
      </div>`,
  ).join('\n      ');
  const demo = opts.demo ? '<span class="s-demo" title="Los mensajes no salen a WhatsApp">Demostración</span>' : '';
  const favicon = opts.icono ?? '💬';
  // La ayuda de todas las pantallas va en la pagina (JSON); el navegador elige la de la ruta.
  const ayudaJson = JSON.stringify(AYUDA_PANTALLAS).replace(/<\//g, '<\\/');

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
${TEMA_SCRIPT}
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a7f55">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${NOMBRE_SISTEMA}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icono-192.png">
<title>${escapeHtml(opts.titulo)} - ${negocio} · ${NOMBRE_SISTEMA}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='13'>${favicon}</text></svg>">
<style>${CSS}${DIALOGO_CSS}${DIALOGO_ELEGIR_CSS}${opts.css ?? ''}</style>
</head><body>
<div class="s-app modo-${modo}" id="s-app" data-negocio="${negocio}" data-modo="${modo}" data-gsg="${conGsg ? '1' : '0'}">
  <div class="s-backdrop" id="s-backdrop"></div>
  <div class="s-panel-fondo" id="s-panel-fondo"></div>
  <aside class="s-side">
    <div class="s-brand">
      <button class="s-plegar" id="s-plegar" type="button" title="Plegar el menú" aria-label="Plegar o desplegar el menú">${icono('plegar')}</button>
      <a class="s-logo" href="/panel#inicio" title="${NOMBRE_SISTEMA}"><span class="s-logo-mark">${INICIAL_SISTEMA}</span><span class="s-logo-text">${negocio}</span></a>
    </div>
    <nav class="s-nav">
      <div class="s-menu-gsg">
      ${menuGsg}
      ${dueno}
      ${desarrollador}
      </div>
      <div class="s-menu-completo">
      ${arriba}
      <div class="s-buscar">${icono('buscar')}<input id="s-q" placeholder="Buscar módulo…" autocomplete="off"><kbd>Ctrl K</kbd></div>
      ${grupos}
      ${desarrollador}
      <div class="s-sin">No hay ningún módulo con ese nombre.</div>
      </div>
      <button class="s-modo" id="s-modo" type="button" title="Enseñar u ocultar las funciones avanzadas (reparto, campañas, ritmo, rastreo)">Ver todo</button>
    </nav>
    <div class="s-user">
      <div class="s-avatar">?</div>
      <a class="s-user-txt" href="/panel#mi-cuenta" style="text-decoration:none;color:inherit" title="Mi cuenta"><b id="s-nombre">…</b><span id="s-rol"></span></a>
      <button class="s-salir" id="logout" type="button" title="Cerrar sesión" aria-label="Cerrar sesión">${icono('salir')}</button>
    </div>
  </aside>
  <div class="s-main">
    <div id="s-plan" class="s-plan hidden"></div>
    <header class="s-top">
      <button class="s-menu" id="s-menu" type="button" title="Menú" aria-label="Abrir el menú">${icono('menu')}</button>
      <div class="s-titulo"><div class="s-miga" id="s-miga"></div><h1 id="s-h1">${escapeHtml(opts.titulo)}</h1><p id="s-sub">${escapeHtml(opts.subtitulo ?? '')}</p></div>
      <span id="state" class="pill hidden"></span>
      <div class="s-top-der">${demo}
        <button class="s-boton" id="s-tema" type="button" title="Tema: automático" aria-label="Cambiar entre modo claro, noche o automático"><span id="s-tema-ico">${icono('auto')}</span></button>
        <div class="s-avisos" id="s-avisos">
          <button class="s-boton" id="s-avisos-boton" type="button" title="Avisos" aria-label="Avisos">${icono('campana')}<span class="s-num" id="s-avisos-num"></span></button>
          <div class="s-avisos-caja" id="s-avisos-caja"><h4>Avisos</h4><div id="s-avisos-lista"><div class="s-aviso-nada">Cargando…</div></div></div>
        </div>
        <button class="s-boton s-buscar-boton" id="s-buscar-boton" type="button" title="Buscar un cliente, un pedido o una conversación (Ctrl K)" aria-label="Buscar (Ctrl K)">${icono('buscar')}<span>Buscar…</span><kbd>Ctrl K</kbd></button>
        <button class="s-boton s-ia-boton" id="s-ia-boton" type="button" title="Dale órdenes al sistema con palabras (buscar, avisar, revisar pedidos…)" aria-label="Dar órdenes al sistema con palabras">${icono('rayo')}<span>Órdenes</span></button>
        <button class="s-boton s-ayuda-boton" id="s-ayuda" type="button" title="Ayuda de esta pantalla" aria-label="Ayuda de esta pantalla">${icono('ayuda')}<span>¿Qué hago si…?</span></button>
        <a class="s-chip" href="/panel#mi-cuenta" title="Mi cuenta"><div class="s-avatar">?</div><b id="s-chip-nombre"></b></a>
      </div>
    </header>
    <div class="s-content${opts.lleno ? ' lleno' : ''}" id="s-content">
${opts.contenido}
    </div>
    <nav class="s-nav-movil" id="s-nav-movil" aria-label="Ir a">
      ${pieGsg}
      <button type="button" id="s-nav-mas" aria-label="Abrir el menú con todas las pantallas">${icono('menu')}<span>Más</span></button>
    </nav>
  </div>
  <div class="s-pal-fondo" id="s-pal-fondo">
    <div class="s-pal" role="dialog" aria-label="Buscar">
      <div class="s-pal-cab">${icono('buscar')}<input id="s-pal-q" placeholder="Cliente, número, pedido (P-1001) o pantalla…" autocomplete="off"><kbd>Esc</kbd></div>
      <div class="s-pal-lista" id="s-pal-lista"></div>
      <div class="s-pal-pie"><span><kbd>↑</kbd> <kbd>↓</kbd> moverse</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> cerrar</span></div>
    </div>
  </div>
  <aside class="s-ayuda-panel" id="s-ayuda-panel" aria-label="Ayuda de esta pantalla">
    <div class="s-ia-cab">${icono('ayuda')}<div><b id="s-ayuda-titulo">Ayuda</b><span class="s-ia-sub">¿Qué hago si…? Lo propio de esta pantalla</span></div><span class="sep"></span><button class="s-ia-cerrar" id="s-ayuda-cerrar" type="button" title="Cerrar" aria-label="Cerrar la ayuda">✕</button></div>
    <div class="s-ayuda-cuerpo" id="s-ayuda-cuerpo"></div>
    <div class="s-ayuda-pie"><button type="button" id="s-ayuda-ia">Preguntarle a la IA</button><a class="ghost" id="s-ayuda-manual" href="/manual">Abrir el manual</a></div>
  </aside>
  <script>window.__ayudaPantallas = ${ayudaJson};</script>
  <aside class="s-ia" id="s-ia" aria-label="IA operadora">
    <div class="s-ia-cab">${icono('robot')}<div><b>Pídeselo a la IA</b><span class="s-ia-sub">Órdenes con palabras; nada cambia sin tu «Hacerlo»</span></div><span class="sep"></span><button class="s-ia-limpiar" id="s-ia-limpiar" type="button" title="Empezar de cero">Limpiar</button><button class="s-ia-cerrar" id="s-ia-cerrar" type="button" title="Cerrar" aria-label="Cerrar el cajón de la IA">✕</button></div>
    <div class="s-ia-hilo" id="s-ia-hilo"></div>
    <div class="s-ia-cat" id="s-ia-cat"></div>
    <div class="s-ia-pie">
      <div class="s-ia-entrada"><textarea id="s-ia-texto" rows="1" placeholder="Ej.: pon a Juan, el 987 654 321, para pedirle su ubicación"></textarea><button class="s-ia-enviar" id="s-ia-enviar" type="button">Enviar</button></div>
      <div class="s-ia-opc"><label><input type="checkbox" id="s-ia-simular"> Solo decir qué haría (sin botón «Hacerlo»)</label><a id="s-ia-ver-cat">¿Qué le puedo pedir?</a></div>
    </div>
  </aside>
</div>
<script>
${DIALOGO_JS}
${DIALOGO_ELEGIR_JS}
${JS}
${opts.script ?? ''}
</script>
</body></html>`;
}

/** Para el manual: los modulos que se ven en este modo, con su descripcion, en orden. */
export function todosLosModulos(modo: ModoSistema = modoVigente()): Array<{ grupo: string; items: ItemMenu[] }> {
  if (modo === 'gsg') return [{ grupo: 'Cada día', items: MENU_GSG.filter((i) => !i.soloGsg || gsgVigente()) },{ grupo: MENU_GSG_DUENO.etiqueta, items: MENU_GSG_DUENO.items }, { grupo: MENU_DESARROLLADOR.etiqueta, items: MENU_DESARROLLADOR.items }];
  return [{ grupo: 'General', items: MENU_ARRIBA }, ...MENU_GRUPOS.map((g) => ({ grupo: g.etiqueta, items: g.items })), { grupo: MENU_DESARROLLADOR.etiqueta, items: MENU_DESARROLLADOR.items }];
}
