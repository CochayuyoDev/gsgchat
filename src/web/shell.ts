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
import { escapeHtml } from './login-page.js';

export interface ItemMenu {
  id: string;
  etiqueta: string;
  href: string;
  icono: keyof typeof ICONOS;
  /** Una linea para el buscador y el manual. */
  descripcion: string;
  /** Solo lo ven los administradores (el servidor lo exige igual). */
  soloAdmin?: boolean;
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

/** Lo de arriba del menu, fuera de los grupos. */
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
      { id: 'contactos', etiqueta: 'Contactos', href: '/panel#contactos', icono: 'contactos', descripcion: 'Importar, buscar y ver el consentimiento de cada numero.' },
      { id: 'enviar', etiqueta: 'Enviar mensaje', href: '/panel#enviar', icono: 'enviar', descripcion: 'Un texto, un pin o una plantilla a un numero concreto.', avanzado: true },
      { id: 'historial', etiqueta: 'Historial de envios', href: '/panel#historial', icono: 'historial', descripcion: 'Todo lo que salio, con su estado y su error si lo hubo.', avanzado: true },
      { id: 'stickers', etiqueta: 'Stickers', href: '/panel#stickers', icono: 'sticker', descripcion: 'Los stickers que se mandan tras el saludo, el gracias o la despedida, y a mano desde el chat.', avanzado: true },
    ],
  },
  {
    id: 'reparto',
    etiqueta: 'Reparto',
    items: [
      { id: 'rutas', etiqueta: 'Ubicaciones para reparto', href: '/rutas', icono: 'pin', descripcion: 'Cargar la lista del dia, pedir la ubicacion a cada cliente y resolver lo que necesita una persona.', avanzado: true },
      { id: 'rutas-ajustes', etiqueta: 'Ajustes del reparto', href: '/rutas#ajustes', icono: 'ajustes', descripcion: 'Horario, espera entre mensajes, intentos, textos y plantillas del reparto.', avanzado: true },
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
    ],
  },
  {
    id: 'administracion',
    etiqueta: 'Mi negocio',
    items: [
      { id: 'setup', etiqueta: 'Conexión de WhatsApp', href: '/setup', icono: 'enchufe', descripcion: 'Conectar el numero: QR, WAHA o la API oficial de Meta.' },
      { id: 'integraciones', etiqueta: 'Conectar mi web y tienda', href: '/panel#integraciones', icono: 'llave', descripcion: 'El chat dentro de tu web, tu tienda WooCommerce o Shopify, y las claves para otros programas.', soloAdmin: true },
      { id: 'configuracion', etiqueta: 'Configuración', href: '/panel#configuracion', icono: 'ajustes', descripcion: 'Nombre del negocio, horario, avisos, modo prueba y ritmo.', soloAdmin: true },
      { id: 'usuarios', etiqueta: 'Usuarios', href: '/panel#usuarios', icono: 'usuario', descripcion: 'Cuentas del equipo, roles y contrasenas.', soloAdmin: true, avanzado: true },
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
  ayuda: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><path d="M12 17h.01"/>',
} as const;

export function icono(nombre: keyof typeof ICONOS, clase = 's-ico'): string {
  return `<svg class="${clase}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre]}</svg>`;
}

const CSS = `
  :root {
    --s-side: #ffffff; --s-line: #e6e8ec; --s-bg: #f4f6f8; --s-text: #16181d; --s-muted: #6b7280;
    --s-accent: #128c7e; --s-accent-soft: rgba(18,140,126,.10); --s-top: #ffffff; --s-hover: #f3f4f6;
    --s-kbd: #f3f4f6; --s-sombra: 0 1px 2px rgba(16,24,40,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root { --s-side: #15181d; --s-line: #262a31; --s-bg: #0f1114; --s-text: #f2f3f5; --s-muted: #9aa0aa;
      --s-top: #15181d; --s-hover: #1d2127; --s-kbd: #1d2127; --s-accent-soft: rgba(18,140,126,.18); }
  }
  html, body { height: 100%; }
  body { margin: 0; overflow: hidden; }
  .s-app { display: flex; height: 100dvh; font: 14.5px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--s-text); }
  .hidden { display: none !important; }

  /* --- menu lateral ---------------------------------------------------- */
  .s-side { width: 262px; flex: none; background: var(--s-side); border-right: 1px solid var(--s-line);
    display: flex; flex-direction: column; min-height: 0; transition: width .18s ease; }
  .s-brand { display: flex; align-items: center; gap: 8px; padding: 14px 12px 10px 14px; }
  .s-plegar, .s-menu, .s-salir { padding: 0; font: inherit; line-height: 1; box-shadow: none; }
  .s-plegar { width: 30px; height: 30px; border: 0; background: transparent; color: var(--s-muted); border-radius: 8px; cursor: pointer; display: grid; place-items: center; flex: none; }
  .s-plegar:hover { background: var(--s-hover); color: var(--s-text); }
  .s-logo { display: flex; align-items: center; gap: 9px; text-decoration: none; color: var(--s-text); min-width: 0; }
  .s-logo-mark { width: 32px; height: 32px; border-radius: 9px; background: var(--s-accent); color: #fff; display: grid; place-items: center; font-weight: 800; flex: none; }
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
  .s-badge { font-size: 11.5px; font-weight: 700; background: var(--s-accent); color: #fff; border-radius: 999px; padding: 1px 7px; min-width: 20px; text-align: center; }
  .s-badge:empty { display: none; }
  .s-buscar { display: flex; align-items: center; gap: 8px; margin: 10px 2px 8px; padding: 0 10px; height: 38px; border: 1px solid var(--s-line); border-radius: 9px; background: var(--s-bg); color: var(--s-muted); }
  .s-buscar input { flex: 1; min-width: 0; width: auto; padding: 0; border: 0; border-radius: 0; box-shadow: none; background: transparent; color: var(--s-text); font: inherit; font-size: 13.5px; outline: 0; }
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
  .s-user { border-top: 1px solid var(--s-line); padding: 12px 12px; display: flex; align-items: center; gap: 10px; }
  .s-avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--s-accent-soft); color: var(--s-accent); display: grid; place-items: center; font-weight: 800; font-size: 13px; flex: none; }
  .s-user-txt { flex: 1; min-width: 0; line-height: 1.25; }
  .s-user-txt b { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13.5px; }
  .s-user-txt span { color: var(--s-muted); font-size: 12px; }
  .s-salir { width: 32px; height: 32px; border: 0; background: transparent; color: var(--s-muted); border-radius: 8px; cursor: pointer; display: grid; place-items: center; flex: none; }
  .s-salir:hover { background: var(--s-hover); color: #dc2626; }

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
  .s-demo { font-size: 12px; font-weight: 700; color: #92400e; background: #fef3c7; border: 1px solid #fcd34d; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
  .s-top-link { color: var(--s-muted); text-decoration: none; font-size: 13.5px; padding: 6px 10px; border-radius: 8px; }
  .s-top-link:hover { background: var(--s-hover); color: var(--s-text); }
  .s-boton { position: relative; width: 36px; height: 36px; padding: 0; border: 1px solid var(--s-line); background: var(--s-top); color: var(--s-muted); border-radius: 9px; cursor: pointer; display: grid; place-items: center; font: inherit; line-height: 1; box-shadow: none; text-decoration: none; }
  .s-boton:hover { background: var(--s-hover); color: var(--s-text); }
  .s-boton .s-num { position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: #dc2626; color: #fff; font-size: 11px; font-weight: 800; display: grid; place-items: center; }
  .s-boton .s-num:empty { display: none; }
  .s-avisos { position: relative; }
  .s-avisos-caja { display: none; position: absolute; right: 0; top: 44px; width: 340px; max-width: calc(100vw - 32px); background: var(--s-top); border: 1px solid var(--s-line); border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.18); z-index: 70; overflow: hidden; }
  .s-avisos.abierto .s-avisos-caja { display: block; }
  .s-avisos-caja h4 { margin: 0; padding: 12px 14px; font-size: 13px; border-bottom: 1px solid var(--s-line); color: var(--s-muted); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .s-aviso { display: flex; gap: 10px; align-items: flex-start; padding: 11px 14px; border-bottom: 1px solid var(--s-line); color: var(--s-text); text-decoration: none; font-size: 13.5px; line-height: 1.4; }
  .s-aviso:last-child { border-bottom: 0; }
  .s-aviso:hover { background: var(--s-hover); }
  .s-aviso i { flex: none; width: 9px; height: 9px; border-radius: 50%; margin-top: 6px; background: var(--s-accent); }
  .s-aviso.warn i { background: #d97706; } .s-aviso.bad i { background: #dc2626; }
  .s-aviso-nada { padding: 18px 14px; color: var(--s-muted); font-size: 13.5px; text-align: center; }
  .s-chip { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; cursor: pointer; text-decoration: none; color: var(--s-text); padding: 4px 8px 4px 4px; border-radius: 999px; }
  .s-chip:hover { background: var(--s-hover); }
  .s-user-txt { cursor: pointer; }
  .s-chip .s-avatar { width: 30px; height: 30px; font-size: 12px; }
  .s-content { flex: 1; min-height: 0; overflow: auto; padding: 22px 24px 60px; }
  .s-content.lleno { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
  .s-content > .wrap { max-width: 1180px; margin: 0 auto; padding: 0; }
  .s-backdrop { display: none; }

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
    .s-top { padding: 0 14px; }
    .s-content { padding: 16px 16px 60px; }
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
  function marcarActivo() {
    var ruta = location.pathname;
    var hash = location.hash;
    var items = Array.prototype.slice.call(document.querySelectorAll('.s-item[data-ir]'));
    var exacto = null, porRuta = null;
    items.forEach(function (a) {
      var ir = a.getAttribute('data-ir');
      var p = ir.split('#')[0], h = ir.indexOf('#') >= 0 ? '#' + ir.split('#')[1] : '';
      if (p === ruta && h === hash) exacto = a;
      if (p === ruta && !h && !porRuta) porRuta = a;
    });
    var activo = exacto || porRuta;
    if (!activo && ruta === '/panel' && !hash) activo = document.querySelector('.s-item[data-ir="/panel#inicio"]');
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
    document.querySelectorAll('.s-nav > .s-item[data-buscar]').forEach(function (a) {
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
  document.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')) {
      ev.preventDefault();
      if (app.classList.contains('plegado')) { app.classList.remove('plegado'); guardar('s-plegado', '0'); }
      if (window.innerWidth <= 960) app.classList.add('abierto');
      q.focus(); q.select();
    }
  });
  document.querySelector('.s-buscar').addEventListener('click', function () {
    if (app.classList.contains('plegado')) { app.classList.remove('plegado'); guardar('s-plegado', '0'); q.focus(); }
  });

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
    document.getElementById('s-rol').textContent = u.rol === 'admin' ? 'Administrador' : 'Operador';
    var chip = document.getElementById('s-chip-nombre'); if (chip) chip.textContent = u.nombre;
    if (u.rol !== 'admin') document.querySelectorAll('.s-item[data-solo-admin]').forEach(function (a) { a.classList.add('hidden'); });
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
    }).catch(function () {});
  }
  cargarAvisos();
  setInterval(function () { if (!document.hidden) cargarAvisos(); }, 30000);

  /* ayuda: el manual, en la parte de esta pantalla */
  function apuntarAyuda() {
    var activo = document.querySelector('.s-item.activo');
    var id = activo ? activo.getAttribute('data-ir').replace(/^\/panel#/, '').replace(/^\//, '').replace('#', '-') : '';
    document.getElementById('s-ayuda').setAttribute('href', '/manual' + (id ? '#m-' + id : ''));
  }
  apuntarAyuda();
  window.addEventListener('hashchange', apuntarAyuda);

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
}

function itemHtml(item: ItemMenu, sub: boolean): string {
  const buscar = escapeHtml(`${item.etiqueta} ${item.descripcion}`.toLowerCase());
  const badge = item.id === 'chats' ? '<span class="s-badge" id="s-badge-chats"></span>' : '';
  return `<a class="s-item${sub ? ' sub' : ''}" data-ir="${item.href}" data-buscar="${buscar}"${item.soloAdmin ? ' data-solo-admin="1"' : ''}${item.avanzado ? ' data-avanzado="1"' : ''} title="${escapeHtml(item.descripcion)}">${icono(item.icono)}<span class="s-txt">${escapeHtml(item.etiqueta)}</span>${badge}</a>`;
}

export function appShell(opts: ShellOpts): string {
  const negocio = escapeHtml(opts.nombreNegocio || 'WhatsApp');
  const arriba = MENU_ARRIBA.map((i) => itemHtml(i, false)).join('\n      ');
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

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.titulo)} - ${negocio}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='13'>${favicon}</text></svg>">
<style>${CSS}${DIALOGO_CSS}${opts.css ?? ''}</style>
</head><body>
<div class="s-app" id="s-app" data-negocio="${negocio}">
  <div class="s-backdrop" id="s-backdrop"></div>
  <aside class="s-side">
    <div class="s-brand">
      <button class="s-plegar" id="s-plegar" type="button" title="Plegar el menú">${icono('plegar')}</button>
      <a class="s-logo" href="/panel#inicio"><span class="s-logo-mark">W</span><span class="s-logo-text">${negocio}</span></a>
    </div>
    <nav class="s-nav">
      ${arriba}
      <div class="s-buscar">${icono('buscar')}<input id="s-q" placeholder="Buscar módulo…" autocomplete="off"><kbd>Ctrl K</kbd></div>
      ${grupos}
      <div class="s-sin">No hay ningún módulo con ese nombre.</div>
      <button class="s-modo" id="s-modo" type="button" title="Enseñar u ocultar las funciones avanzadas (reparto, campañas, ritmo, rastreo)">Ver todo</button>
    </nav>
    <div class="s-user">
      <div class="s-avatar">?</div>
      <a class="s-user-txt" href="/panel#mi-cuenta" style="text-decoration:none;color:inherit" title="Mi cuenta"><b id="s-nombre">…</b><span id="s-rol"></span></a>
      <button class="s-salir" id="logout" type="button" title="Cerrar sesión">${icono('salir')}</button>
    </div>
  </aside>
  <div class="s-main">
    <header class="s-top">
      <button class="s-menu" id="s-menu" type="button" title="Menú">${icono('menu')}</button>
      <div class="s-titulo"><div class="s-miga" id="s-miga"></div><h1 id="s-h1">${escapeHtml(opts.titulo)}</h1><p id="s-sub">${escapeHtml(opts.subtitulo ?? '')}</p></div>
      <span id="state" class="pill hidden"></span>
      <div class="s-top-der">${demo}
        <div class="s-avisos" id="s-avisos">
          <button class="s-boton" id="s-avisos-boton" type="button" title="Avisos">${icono('campana')}<span class="s-num" id="s-avisos-num"></span></button>
          <div class="s-avisos-caja" id="s-avisos-caja"><h4>Avisos</h4><div id="s-avisos-lista"><div class="s-aviso-nada">Cargando…</div></div></div>
        </div>
        <a class="s-boton" id="s-ayuda" href="/manual" title="Ayuda de esta pantalla">${icono('ayuda')}</a>
        <a class="s-chip" href="/panel#mi-cuenta" title="Mi cuenta"><div class="s-avatar">?</div><b id="s-chip-nombre"></b></a>
      </div>
    </header>
    <div class="s-content${opts.lleno ? ' lleno' : ''}" id="s-content">
${opts.contenido}
    </div>
  </div>
</div>
<script>
${DIALOGO_JS}
${JS}
${opts.script ?? ''}
</script>
</body></html>`;
}

/** Para el manual: todos los modulos con su descripcion, en orden. */
export function todosLosModulos(): Array<{ grupo: string; items: ItemMenu[] }> {
  return [{ grupo: 'General', items: MENU_ARRIBA }, ...MENU_GRUPOS.map((g) => ({ grupo: g.etiqueta, items: g.items }))];
}
