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
import { DIALOGO_ELEGIR_CSS, DIALOGO_ELEGIR_JS } from './dialogo-elegir.js';
import { TOKENS_CSS } from './tokens.js';
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
    return proveedorModo();
  } catch {
    return 'gsg';
  }
}

/**
 * El menu de GSG: solo lo que se usa cada dia, sin grupos y sin jerga.
 *
 * Es el que se ve por defecto. Todo lo demas (campañas, grupos, rastreo,
 * ritmo, integraciones...) sigue existiendo en el modo completo, que se
 * enciende desde Ajustes.
 */
export const MENU_GSG: ItemMenu[] = [
  { id: 'hoy', etiqueta: 'Hoy', href: '/hoy', icono: 'moto', descripcion: 'Las entregas de hoy: a quién falta la ubicación o confirmar, quién las lleva, a qué hora llegan y qué necesita a alguien.' },
  { id: 'chats', etiqueta: 'Chats', href: '/chat', icono: 'chat', descripcion: 'Las conversaciones como en WhatsApp: leer, responder, mandar o pedir ubicación.' },
  { id: 'guardados', etiqueta: 'Conversaciones guardadas', href: '/guardados', icono: 'historial', descripcion: 'Las conversaciones ya cerradas: buscarlas, leerlas, exportarlas y devolverlas al chat.' },
  { id: 'ia', etiqueta: 'Asistente IA', href: '/panel#ia', icono: 'rayo', descripcion: 'Con qué IA contesta, qué sabe del negocio y si está encendido.' },
  { id: 'motorizados', etiqueta: 'Motorizados', href: '/motorizados', icono: 'contactos', descripcion: 'Quiénes reparten hoy: alta, zona, descanso y qué lleva cada uno.' },
  { id: 'mapa', etiqueta: 'Mapa del día', href: '/mapa', icono: 'mapa', descripcion: 'Dónde está cada pedido de hoy y cada motorizado, sobre el mapa.' },
  { id: 'equipo', etiqueta: 'Equipo', href: '/panel#usuarios', icono: 'usuario', descripcion: 'Las cuentas de quienes entran al sistema.', soloAdmin: true },
  { id: 'conexion', etiqueta: 'Conexión', href: '/setup', icono: 'enchufe', descripcion: 'El WhatsApp (QR o API de Meta) y el sistema de GSG.' },
  { id: 'fiabilidad', etiqueta: 'Que todo funcione', href: '/fiabilidad', icono: 'salud', descripcion: 'El WhatsApp vigilado, la prueba de cada mañana, el cupo de hoy y la copia de seguridad.', soloAdmin: true },
  { id: 'ajustes', etiqueta: 'Ajustes', href: '/panel#configuracion', icono: 'ajustes', descripcion: 'Nombre, horario, avisos, modo prueba y qué se enseña.', soloAdmin: true },
  { id: 'manual', etiqueta: 'Manual de uso', href: '/manual', icono: 'libro', descripcion: 'Qué hace cada pantalla y cómo se usa.' },
  { id: 'soporte', etiqueta: 'Soporte', href: '/soporte', icono: 'soporte', descripcion: 'Si algo falla: qué mirar y qué datos mandar.' },
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

/** Lo de arriba del menu, fuera de los grupos (modo completo). */
export const MENU_ARRIBA: ItemMenu[] = [
  { id: 'inicio', etiqueta: 'Inicio', href: '/panel#inicio', icono: 'inicio', descripcion: 'Un vistazo a todo: cifras de hoy, la semana, el numero y lo que espera a una persona.' },
  { id: 'manual', etiqueta: 'Manual de uso', href: '/manual', icono: 'libro', descripcion: 'Que hace cada modulo y como se usa.' },
  { id: 'soporte', etiqueta: 'Soporte', href: '/soporte', icono: 'soporte', descripcion: 'Si algo falla: que mirar y que datos mandar.' },
];

export const MENU_GRUPOS: GrupoMenu[] = [
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
      { id: 'plantillas', etiqueta: 'Mensajes aprobados (plantillas)', href: '/panel#plantillas', icono: 'plantilla', descripcion: 'Las plantillas de Meta y las propias: crear, sincronizar y ver su estado.', avanzado: true },
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
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 7px 14px; border: 1px solid var(--borde); border-radius: var(--radio-sm); background: var(--superficie); color: var(--texto); font: inherit; font-weight: 600; line-height: 1.2; cursor: pointer; text-decoration: none; box-shadow: none; }
  .btn:hover { border-color: var(--primario); color: var(--primario); }
  .btn.primario { background: var(--primario); border-color: var(--primario); color: var(--primario-texto); }
  .btn.primario:hover { filter: brightness(1.06); color: var(--primario-texto); }
  .btn.secundario { background: var(--primario-suave); border-color: transparent; color: var(--primario); }
  .btn.peligro { color: var(--rojo); border-color: var(--rojo-suave); background: var(--rojo-suave); }
  .btn.peligro:hover { background: var(--rojo); border-color: var(--rojo); color: #fff; }
  .btn.sm { min-height: 30px; padding: 4px 10px; font-size: 13px; font-weight: 500; }
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
  .s-item.activo { background: var(--s-accent-soft); color: var(--s-accent); font-weight: 600; }
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
  .s-grupo-cab { box-shadow: none; display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 9px 10px 7px; border: 0; background: transparent; color: var(--s-muted); font: 700 11.5px/1 inherit; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; border-radius: 8px; font-family: inherit; }
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
  .s-boton { position: relative; width: 36px; height: 36px; padding: 0; border: 1px solid var(--s-line); background: var(--s-top); color: var(--s-muted); border-radius: 9px; cursor: pointer; display: grid; place-items: center; font: inherit; line-height: 1; box-shadow: none; text-decoration: none; }
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
  .s-content > .wrap { max-width: 1180px; margin: 0 auto; padding: 0; }
  .s-backdrop { display: none; }

  /* --- la IA operadora: un cajon a la derecha, en todas las pantallas ---- */
  .s-ia-boton { width: auto; padding: 0 12px 0 10px; gap: 7px; font-weight: 700; font-size: 13.5px; color: var(--s-accent); border-color: var(--s-accent-soft); background: var(--s-accent-soft); }
  .s-ia-boton:hover { color: var(--primario-texto); background: var(--s-accent); }
  .s-ia { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); background: var(--s-top); border-left: 1px solid var(--s-line); box-shadow: -18px 0 48px rgba(0,0,0,.16); z-index: 80; display: none; flex-direction: column; }
  .s-ia.abierto { display: flex; }
  .s-ia-cab { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--s-line); }
  .s-ia-cab b { font-size: 15px; }
  .s-ia-cab .s-ia-sub { color: var(--s-muted); font-size: 12px; display: block; }
  .s-ia-cab .sep { flex: 1; }
  .s-ia-cerrar, .s-ia-limpiar { border: 0; background: transparent; color: var(--s-muted); cursor: pointer; font: inherit; font-size: 13px; min-width: 36px; min-height: 36px; padding: 6px 8px; border-radius: 8px; box-shadow: none; }
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
  .s-ia-pend { border-color: var(--ambar); background: var(--ambar-suave); }
  .s-ia-pend .botones { display: flex; gap: 6px; margin-top: 6px; }
  .s-ia-pend button { font: inherit; font-size: 12.5px; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--s-line); background: var(--s-top); color: var(--s-text); cursor: pointer; box-shadow: none; }
  .s-ia-pend button.si { background: var(--s-accent); border-color: var(--s-accent); color: var(--primario-texto); }
  .s-ia-pie { border-top: 1px solid var(--s-line); padding: 10px 14px 12px; }
  .s-ia-entrada { display: flex; gap: 8px; align-items: flex-end; }
  .s-ia-entrada textarea { flex: 1; min-height: 42px; max-height: 140px; resize: none; font: inherit; font-size: 14px; padding: 9px 11px; border: 1px solid var(--s-line); border-radius: 10px; background: var(--s-bg); color: var(--s-text); }
  .s-ia-enviar { height: 42px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--s-accent); background: var(--s-accent); color: var(--primario-texto); font: inherit; font-weight: 700; cursor: pointer; box-shadow: none; }
  .s-ia-enviar:disabled { opacity: .55; cursor: default; }
  .s-ia-opc { display: flex; gap: 12px; align-items: center; margin-top: 8px; font-size: 12.5px; color: var(--s-muted); flex-wrap: wrap; }
  .s-ia-opc label { display: flex; gap: 5px; align-items: center; cursor: pointer; }
  .s-ia-opc a { color: var(--s-accent); cursor: pointer; }
  .s-ia-cat { display: none; font-size: 12.5px; max-height: 40vh; overflow: auto; padding: 0 14px 10px; }
  .s-ia.con-catalogo .s-ia-cat { display: block; }
  .s-ia-cat div { padding: 5px 0; border-bottom: 1px solid var(--s-line); }
  .s-ia-cat b { display: block; }
  .s-ia-cat i { color: var(--s-muted); }
  .s-ia-vacio { color: var(--s-muted); font-size: 13.5px; line-height: 1.5; }
  .s-ia-vacio ul { margin: 6px 0 0; padding-left: 18px; }
  .s-ia-vacio li { cursor: pointer; color: var(--s-accent); }
  @media (max-width: 960px) { .s-ia-boton span { display: none; } .s-ia-boton { padding: 0; width: 36px; } }

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
  .s-ayuda-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); background: var(--s-top); border-left: 1px solid var(--s-line); box-shadow: -18px 0 48px rgba(0,0,0,.16); z-index: 80; display: none; flex-direction: column; }
  .s-ayuda-panel.abierto { display: flex; }
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
  @media (max-width: 960px) { .s-ayuda-boton span { display: none; } .s-ayuda-boton { padding: 0; width: 36px; } .s-buscar-boton { min-width: 0; width: 36px; padding: 0; justify-content: center; } .s-buscar-boton span, .s-buscar-boton kbd { display: none; } }

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
      var activo = p === ruta || (p === '/hoy' && ruta === '/entregas') || (p === '/entregas' && ruta === '/hoy');
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
    if (leer('s-grupo-' + id) === 'cerrado') g.classList.add('cerrado');
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
    if (u.rol !== 'admin') document.querySelectorAll('.s-item[data-solo-admin]').forEach(function (a) { a.classList.add('hidden'); });
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
  function apuntarAyuda() { if (ayudaPanel.classList.contains('abierto')) pintarAyuda(); }
  function abrirAyuda() {
    pintarAyuda();
    ayudaPanel.classList.add('abierto');
    var ia = document.getElementById('s-ia'); if (ia) ia.classList.remove('abierto');
  }
  window.abrirAyudaPantalla = abrirAyuda;
  document.getElementById('s-ayuda').onclick = function () { if (ayudaPanel.classList.contains('abierto')) ayudaPanel.classList.remove('abierto'); else abrirAyuda(); };
  document.getElementById('s-ayuda-cerrar').onclick = function () { ayudaPanel.classList.remove('abierto'); };
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
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && ayudaPanel.classList.contains('abierto')) ayudaPanel.classList.remove('abierto'); });
  window.addEventListener('hashchange', apuntarAyuda);

  /* --- la IA operadora ------------------------------------------------- */
  var iaCaja = document.getElementById('s-ia');
  var iaHilo = document.getElementById('s-ia-hilo');
  var iaTexto = document.getElementById('s-ia-texto');
  var iaEnviar = document.getElementById('s-ia-enviar');
  var iaHistorial = [];
  try { iaHistorial = JSON.parse(sessionStorage.getItem('wa_ia_hilo') || '[]'); } catch (e) { iaHistorial = []; }
  function iaGuardar() { try { sessionStorage.setItem('wa_ia_hilo', JSON.stringify(iaHistorial.slice(-30))); } catch (e) {} }
  var EJEMPLOS_IA = ['¿cómo va el reparto de hoy?', 'pon a Juan, el 987 654 321, para pedirle su ubicación', 'quita a María de la lista de envío automático', '¿quién nos escribió hoy?', 'escríbele a Rosa que su pedido sale mañana', '¿por qué no salen mensajes?'];
  function iaPintar() {
    if (!iaHistorial.length) {
      iaHilo.innerHTML = '<div class="s-ia-vacio">Dile con palabras qué hacer o qué mirar. Ejecuta con tu misma cuenta y tus mismos permisos; lo delicado te lo deja para confirmar.<ul>' + EJEMPLOS_IA.map(function (e) { return '<li data-ej="' + escapar(e) + '">' + escapar(e) + '</li>'; }).join('') + '</ul></div>';
      return;
    }
    iaHilo.innerHTML = iaHistorial.map(function (m, i) {
      if (m.role === 'user') return '<div class="s-ia-b yo">' + escapar(m.content) + '</div>';
      var html = '<div class="s-ia-b' + (m.error ? ' mal' : '') + '">' + escapar(m.content) + '</div>';
      var hechas = (m.hechas || []).map(function (h) {
        return '<div class="s-ia-hecha"><span class="ic">' + (h.ok ? (h.tipo === 'consulta' ? '🔎' : '✅') : '⚠') + '</span><span class="q">' + escapar(h.resumen) + '<small>' + escapar(h.accion) + '</small></span>' + (h.ir ? '<a href="' + escapar(h.ir) + '">ver →</a>' : '') + '</div>';
      });
      var pend = (m.pendientes || []).map(function (p, j) {
        return '<div class="s-ia-hecha s-ia-pend" data-msg="' + i + '" data-pend="' + j + '"><span class="ic">⏸</span><span class="q">' + escapar(p.descripcion) + '<small>' + escapar(p.motivo) + '</small><div class="botones"><button class="si" type="button" data-confirmar="1">Sí, hazlo</button><button type="button" data-descartar="1">No</button></div></span></div>';
      });
      if (hechas.length || pend.length) html += '<div class="s-ia-hechas">' + hechas.join('') + pend.join('') + '</div>';
      return html;
    }).join('');
    iaHilo.scrollTop = iaHilo.scrollHeight;
  }
  function iaAbrir(textoInicial) {
    iaCaja.classList.add('abierto');
    iaPintar();
    if (textoInicial) iaTexto.value = textoInicial;
    setTimeout(function () { iaTexto.focus(); var n = iaTexto.value.length; try { iaTexto.setSelectionRange(n, n); } catch (e) {} }, 30);
  }
  window.abrirOperadorIA = iaAbrir;
  document.getElementById('s-ia-boton').onclick = function () { if (iaCaja.classList.contains('abierto')) iaCaja.classList.remove('abierto'); else iaAbrir(); };
  document.getElementById('s-ia-cerrar').onclick = function () { iaCaja.classList.remove('abierto'); };
  document.getElementById('s-ia-limpiar').onclick = function () { iaHistorial = []; iaGuardar(); iaPintar(); };
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && iaCaja.classList.contains('abierto') && document.activeElement !== iaTexto) iaCaja.classList.remove('abierto'); });
  iaHilo.addEventListener('click', function (ev) {
    var ej = ev.target.closest('[data-ej]');
    if (ej) { iaTexto.value = ej.getAttribute('data-ej'); iaTexto.focus(); return; }
    var b = ev.target.closest('button');
    if (!b) return;
    var caja = b.closest('.s-ia-pend');
    if (!caja) return;
    var msg = iaHistorial[Number(caja.getAttribute('data-msg'))];
    var pend = msg && msg.pendientes ? msg.pendientes[Number(caja.getAttribute('data-pend'))] : null;
    if (!pend) return;
    if (b.hasAttribute('data-descartar')) { msg.pendientes = msg.pendientes.filter(function (p) { return p !== pend; }); iaGuardar(); iaPintar(); return; }
    b.disabled = true;
    var accion = Object.assign({ accion: pend.accion }, pend.parametros);
    fetch('/admin/ia/ordenes/confirmar', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acciones: [accion] }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        msg.pendientes = msg.pendientes.filter(function (p) { return p !== pend; });
        msg.hechas = (msg.hechas || []).concat(x.ok ? x.d.hechas : [{ accion: pend.accion, ok: false, resumen: x.d.error || 'No se pudo.', tipo: 'cambio' }]);
        iaGuardar(); iaPintar();
        if (x.ok && x.d.hechas.some(function (h) { return h.ok; })) document.dispatchEvent(new CustomEvent('ia:cambio'));
      })
      .catch(function (e) { msg.hechas = (msg.hechas || []).concat([{ accion: pend.accion, ok: false, resumen: e.message, tipo: 'cambio' }]); iaGuardar(); iaPintar(); });
  });
  function iaOrdenar() {
    var texto = iaTexto.value.trim();
    if (!texto || iaEnviar.disabled) return;
    iaEnviar.disabled = true;
    iaTexto.value = '';
    var historial = iaHistorial.filter(function (m) { return !m.error; }).map(function (m) { return { role: m.role, content: m.content }; }).slice(-10);
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
          iaHistorial.push({ role: 'assistant', content: x.d.texto || '(sin respuesta)', hechas: x.d.hechas || [], pendientes: x.d.pendientes || [], simulado: x.d.simulado });
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
      document.getElementById('s-ia-cat').innerHTML = d.acciones.map(function (a) { return '<div><b>' + escapar(a.descripcion) + (a.peligrosa ? ' <i>(pide confirmación)</i>' : '') + (a.soloAdmin ? ' <i>(solo administrador)</i>' : '') + '</b><i>Ej.: «' + escapar(a.ejemplo) + '»</i></div>'; }).join('');
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
  const arriba = MENU_ARRIBA.map((i) => itemHtml(i, false)).join('\n      ');
  const menuGsg = MENU_GSG.map((i) => itemHtml(i, false)).join('\n      ');
  const dueno = `<div class="s-grupo" data-grupo="${MENU_GSG_DUENO.id}" data-solo-super-grupo="1">
        <button class="s-grupo-cab" type="button"><span>${escapeHtml(MENU_GSG_DUENO.etiqueta)}</span>${icono('chevron')}</button>
        <div class="s-grupo-items">
          ${MENU_GSG_DUENO.items.map((i) => itemHtml(i, true)).join('\n          ')}
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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f766e">
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
<div class="s-app modo-${modo}" id="s-app" data-negocio="${negocio}" data-modo="${modo}">
  <div class="s-backdrop" id="s-backdrop"></div>
  <aside class="s-side">
    <div class="s-brand">
      <button class="s-plegar" id="s-plegar" type="button" title="Plegar el menú" aria-label="Plegar o desplegar el menú">${icono('plegar')}</button>
      <a class="s-logo" href="/panel#inicio" title="${NOMBRE_SISTEMA}"><span class="s-logo-mark">${INICIAL_SISTEMA}</span><span class="s-logo-text">${negocio}</span></a>
    </div>
    <nav class="s-nav">
      <div class="s-menu-gsg">
      ${menuGsg}
      ${dueno}
      </div>
      <div class="s-menu-completo">
      ${arriba}
      <div class="s-buscar">${icono('buscar')}<input id="s-q" placeholder="Buscar módulo…" autocomplete="off"><kbd>Ctrl K</kbd></div>
      ${grupos}
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
        <div class="s-avisos" id="s-avisos">
          <button class="s-boton" id="s-avisos-boton" type="button" title="Avisos" aria-label="Avisos">${icono('campana')}<span class="s-num" id="s-avisos-num"></span></button>
          <div class="s-avisos-caja" id="s-avisos-caja"><h4>Avisos</h4><div id="s-avisos-lista"><div class="s-aviso-nada">Cargando…</div></div></div>
        </div>
        <button class="s-boton s-buscar-boton" id="s-buscar-boton" type="button" title="Buscar un cliente, un pedido o una conversación (Ctrl K)" aria-label="Buscar (Ctrl K)">${icono('buscar')}<span>Buscar…</span><kbd>Ctrl K</kbd></button>
        <button class="s-boton s-ia-boton" id="s-ia-boton" type="button" title="Pídeselo a la IA: órdenes con palabras" aria-label="Pídeselo a la IA">${icono('robot')}<span>IA</span></button>
        <button class="s-boton s-ayuda-boton" id="s-ayuda" type="button" title="Ayuda de esta pantalla" aria-label="Ayuda de esta pantalla">${icono('ayuda')}<span>¿Qué hago si…?</span></button>
        <a class="s-chip" href="/panel#mi-cuenta" title="Mi cuenta"><div class="s-avatar">?</div><b id="s-chip-nombre"></b></a>
      </div>
    </header>
    <div class="s-content${opts.lleno ? ' lleno' : ''}" id="s-content">
${opts.contenido}
    </div>
    <nav class="s-nav-movil" id="s-nav-movil" aria-label="Ir a">
      <a class="s-nav-gsg" href="/hoy" data-ir="/hoy">${icono('moto')}<span>Hoy</span></a>
      <a class="s-nav-completo" href="/panel#inicio" data-ir="/panel#inicio">${icono('inicio')}<span>Inicio</span></a>
      <a href="/chat" data-ir="/chat">${icono('chat')}<span>Chats</span></a>
      <a class="s-nav-gsg" href="/motorizados" data-ir="/motorizados">${icono('contactos')}<span>Motorizados</span></a>
      <a class="s-nav-completo" href="/entregas" data-ir="/entregas">${icono('moto')}<span>Entregas</span></a>
      <a href="/mapa" data-ir="/mapa">${icono('mapa')}<span>Mapa</span></a>
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
    <div class="s-ia-cab">${icono('robot')}<div><b>Pídeselo a la IA</b><span class="s-ia-sub">Órdenes con palabras; todo queda en la bitácora</span></div><span class="sep"></span><button class="s-ia-limpiar" id="s-ia-limpiar" type="button" title="Empezar de cero">Limpiar</button><button class="s-ia-cerrar" id="s-ia-cerrar" type="button" title="Cerrar" aria-label="Cerrar el cajón de la IA">✕</button></div>
    <div class="s-ia-hilo" id="s-ia-hilo"></div>
    <div class="s-ia-cat" id="s-ia-cat"></div>
    <div class="s-ia-pie">
      <div class="s-ia-entrada"><textarea id="s-ia-texto" rows="1" placeholder="Ej.: pon a Juan, el 987 654 321, para pedirle su ubicación"></textarea><button class="s-ia-enviar" id="s-ia-enviar" type="button">Enviar</button></div>
      <div class="s-ia-opc"><label><input type="checkbox" id="s-ia-simular"> Solo decir qué haría (no ejecutar)</label><a id="s-ia-ver-cat">¿Qué le puedo pedir?</a></div>
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
  if (modo === 'gsg') return [{ grupo: 'Cada día', items: MENU_GSG }, { grupo: MENU_GSG_DUENO.etiqueta, items: MENU_GSG_DUENO.items }];
  return [{ grupo: 'General', items: MENU_ARRIBA }, ...MENU_GRUPOS.map((g) => ({ grupo: g.etiqueta, items: g.items }))];
}
