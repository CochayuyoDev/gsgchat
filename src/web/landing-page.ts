/**
 * La portada: que es esto y por donde se entra.
 *
 * Es la unica pagina publica: la ve quien todavia no tiene sesion, asi que
 * cuenta el sistema como un producto (que hace, como funciona, por que no
 * quema el numero) y lleva a /login. Con sesion abierta, los botones llevan
 * al panel.
 *
 * No lleva armazon, asi que no tiene las clases compartidas (`.btn`,
 * `.tarjeta`...): las define aqui. Lo que si usa son los mismos tokens que el
 * resto (tokens.ts), para que el color de marca, los radios y el modo oscuro
 * sean los del sistema y no una segunda paleta que se va separando.
 *
 * El titular y la bajada se importan de `login-page.ts` (PROMESA): la portada
 * y el login son la misma primera impresion y se escriben una sola vez.
 */

import { INICIAL_SISTEMA, LEMA_SISTEMA, NOMBRE_SISTEMA } from '../marca.js';
import { PROMESA, escapeHtml } from './login-page.js';
import { TOKENS_CSS } from './tokens.js';

const CSS = `
  ${TOKENS_CSS}
  /* La franja oscura de "salud del numero" es marca: oscura con los dos
     temas, como el lado del login. Por eso lleva sus propios tonos. */
  :root { --marca-fondo: #0f1a17; --marca-texto: #e8f1ee; --marca-suave: #a9bbb5; --marca-acento: #25d366; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--texto); font: 16px/1.6 var(--fuente); }
  a { color: var(--primario); }
  .ancho { max-width: 1120px; margin: 0 auto; padding: 0 22px; }

  /* --- cabecera --- */
  header { position: sticky; top: 0; z-index: 10; background: var(--bg); border-bottom: 1px solid var(--borde); }
  header .ancho { display: flex; align-items: center; gap: 18px; min-height: 64px; }
  .logotipo { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 18px; text-decoration: none; color: var(--texto); letter-spacing: -.01em; }
  .logotipo .sello { width: 34px; height: 34px; flex: none; border-radius: 9px; background: var(--primario); color: var(--primario-texto); display: grid; place-items: center; }
  nav { display: flex; gap: 22px; margin-left: 26px; font-size: 14.5px; }
  nav a { color: var(--texto-suave); text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; }
  nav a:hover { color: var(--texto); }
  .derecha { margin-left: auto; display: flex; gap: 10px; align-items: center; }

  /* --- botones (la portada no lleva armazon: aqui esta su .btn) --- */
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 11px 20px; border: 1px solid var(--primario); border-radius: var(--radio-sm); background: var(--primario); color: var(--primario-texto); font-weight: 600; text-decoration: none; font-size: 15px; }
  .btn:hover { filter: brightness(1.06); }
  .btn.secundario { background: transparent; color: var(--texto); border-color: var(--borde); }
  .btn.secundario:hover { border-color: var(--primario); color: var(--primario); filter: none; }
  .btn.grande { min-height: 52px; padding: 14px 26px; font-size: 16px; }
  .btn:focus-visible { outline: 2px solid var(--primario); outline-offset: 2px; }

  /* --- lo primero que se ve --- */
  .hero { padding: 76px 0 40px; display: grid; gap: 40px; grid-template-columns: 1.05fr 1fr; align-items: center; }
  .hero h1 { font-size: 50px; line-height: 1.08; letter-spacing: -.03em; margin: 0 0 18px; }
  .hero h1 span { color: var(--primario); }
  .hero .bajada { font-size: 18px; color: var(--texto-suave); margin: 0 0 28px; max-width: 520px; }
  .etiqueta { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--primario); background: var(--primario-suave); padding: 5px 12px; border-radius: 999px; margin-bottom: 18px; }
  .acciones { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .acciones small { color: var(--texto-suave); font-size: 13px; }

  /* La "captura" del panel, dibujada con CSS: ni imagenes ni peticiones. */
  .captura { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra-2); padding: 16px; }
  .captura .cifras { display: grid; gap: 8px; grid-template-columns: repeat(3, 1fr); }
  .captura .cifra { background: var(--superficie-2); border-radius: var(--radio-sm); padding: 10px 12px; }
  .captura .cifra span { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); font-weight: 700; }
  .captura .cifra b { font-size: 22px; letter-spacing: -.02em; }
  .captura .cifra b.bien { color: var(--verde); }
  .captura .barras { margin-top: 10px; background: var(--superficie-2); border-radius: var(--radio-sm); padding: 12px; display: flex; align-items: flex-end; gap: 6px; height: 140px; }
  .captura .barras i { flex: 1; background: var(--primario); border-radius: 3px 3px 0 0; opacity: .85; }
  .captura .barras i:nth-child(even) { background: var(--gris-claro); }
  .captura .marcas { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
  .captura .marca { background: var(--superficie-2); border-radius: 999px; padding: 4px 11px; font-size: 12px; color: var(--texto-suave); }
  .captura .marca.bien { background: var(--verde-suave); color: var(--verde); font-weight: 600; }

  .compatible { display: flex; gap: 20px; align-items: center; color: var(--texto-suave); font-size: 13.5px; padding: 8px 0 50px; flex-wrap: wrap; }
  .compatible b { font-weight: 600; color: var(--texto); }

  /* --- secciones --- */
  section.bloque { padding: 56px 0; }
  .titulo { max-width: 620px; margin-bottom: 30px; }
  .titulo h2 { font-size: 32px; letter-spacing: -.02em; line-height: 1.15; margin: 0 0 10px; }
  .titulo p { color: var(--texto-suave); margin: 0; font-size: 17px; }
  .rejilla { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); }
  .tarjeta { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 22px; }
  .tarjeta .ico { width: 40px; height: 40px; border-radius: 10px; background: var(--primario-suave); color: var(--primario); display: grid; place-items: center; margin-bottom: 14px; }
  .tarjeta b { display: block; font-size: 16.5px; margin-bottom: 6px; }
  .tarjeta p { margin: 0; color: var(--texto-suave); font-size: 14.5px; }
  .rejilla.pasos { counter-reset: paso; }
  .pasos .tarjeta::before { counter-increment: paso; content: counter(paso); display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--primario); color: var(--primario-texto); font-weight: 800; margin-bottom: 12px; }

  .franja { background: var(--marca-fondo); color: var(--marca-texto); border-radius: 22px; padding: 46px 40px; display: grid; gap: 30px; grid-template-columns: 1.1fr 1fr; align-items: center; }
  .franja h2 { font-size: 30px; margin: 0 0 10px; letter-spacing: -.02em; line-height: 1.15; }
  .franja p { color: var(--marca-suave); margin: 0; font-size: 16px; }
  .franja ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  .franja li { display: flex; gap: 10px; align-items: flex-start; font-size: 15px; }
  .franja li::before { content: '✓'; flex: none; width: 22px; height: 22px; border-radius: 50%; background: rgba(37,211,102,.18); color: var(--marca-acento); display: grid; place-items: center; font-size: 13px; font-weight: 800; margin-top: 1px; }

  .cierre { text-align: center; padding: 64px 0 56px; }
  .cierre h2 { font-size: 34px; letter-spacing: -.02em; margin: 0 0 10px; }
  .cierre p { color: var(--texto-suave); margin: 0 0 24px; }
  footer { border-top: 1px solid var(--borde); padding: 26px 0 40px; color: var(--texto-suave); font-size: 13.5px; display: flex; gap: 16px; flex-wrap: wrap; justify-content: space-between; }

  @media (max-width: 900px) {
    .hero { grid-template-columns: 1fr; padding-top: 44px; }
    .hero h1 { font-size: 38px; }
    nav { display: none; }
    .franja { grid-template-columns: 1fr; padding: 32px 24px; }
  }
`;

const ICO = {
  pin: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z"/></svg>',
  salud: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 4 12 2.5-6h5"/></svg>',
  megafono: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v4h3l7 4V6l-7 4z"/><path d="M17 9a4 4 0 0 1 0 6"/></svg>',
  rayo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  llave: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="14" r="4"/><path d="m11 11 9-9M17 5l2 2M14 8l2 2"/></svg>',
};

/** Lo que hace el sistema: una tarjeta por modulo grande. */
const QUE_HACE: Array<{ ico: string; titulo: string; texto: string }> = [
  { ico: ICO.pin, titulo: 'Pedir y validar datos', texto: 'Ubicación, DNI o RUC, dirección, fotos y documentos. Cada dato se valida al llegar y lo que no vale se vuelve a pedir explicando por qué.' },
  { ico: ICO.rayo, titulo: 'Confirmaciones y recordatorios', texto: 'Citas, visitas, turnos o asistencia: SÍ o NO con botones, reprogramar en el mismo chat y el recordatorio antes de la hora.' },
  { ico: ICO.megafono, titulo: 'Avisos al personal de campo', texto: 'Cada técnico recibe su tarea y responde «llegué», «terminé» o «no pude». El avance de todos se ve en vivo.' },
  { ico: ICO.llave, titulo: 'Cobranza y trámites', texto: 'Recordatorios de pago o vencimiento, la captura del comprobante recibida en el chat y derivada a una persona para validarla. Sin vender nada.' },
  { ico: ICO.chat, titulo: 'Una persona cuando hace falta', texto: 'Lo que el sistema no puede resolver solo -una consulta que no es del trámite, alguien que no responde- pasa a tu equipo con todo lo que se respondió.' },
  { ico: ICO.salud, titulo: 'Salud del número', texto: 'Ritmo humano, avisos de riesgo y freno automático antes de que Meta o WhatsApp bloqueen el número. Un semáforo que se explica.' },
];

/** El recorrido de un proceso, de la lista a las respuestas. */
const PASOS: Array<{ titulo: string; texto: string }> = [
  { titulo: 'Eliges una plantilla', texto: 'Pedir datos, confirmar citas, avisar tareas o cobrar: se crea en un clic y ajustas sus mensajes paso a paso, sin programar.' },
  { titulo: 'Cargas la lista', texto: 'Un Excel, un CSV o una tabla pegada; o la manda tu sistema por la API. Los números mal escritos o repetidos se apartan antes de escribir.' },
  { titulo: 'El sistema escribe a cada uno', texto: 'Un mensaje a cada persona, con pausas entre uno y otro y solo en horario. Si no contesta, insiste con criterio.' },
  { titulo: 'Las respuestas quedan ordenadas', texto: 'Cada respuesta validada, en una tabla lista para Excel; y lo que necesita a una persona, marcado para tu equipo.' },
];

/** Las guardas del numero: lo que separa a este sistema de un envio masivo. */
const GUARDAS: string[] = [
  'Ritmo humano: pausas al azar, escritura simulada, cupos por hora y por día que crecen con el calentamiento.',
  'Nada sale sin consentimiento, a quien se dio de baja, o fuera del horario.',
  'Un monitor mira errores, bloqueos, bajas y quejas cada minuto y frena solo: amarillo, naranja, rojo.',
  'Plantillas pausadas por Meta se detectan y se cambian por otra; las variantes evitan repetir el mismo texto.',
  'Un modo prueba para trabajar solo con los números que tú digas.',
];

/** Las alturas de las barras de la "captura": solo decoración. */
const BARRAS = [35, 22, 55, 30, 70, 38, 62, 44, 88, 52, 76, 40, 58, 33];

export function landingPage(opts: { nombreNegocio: string; conSesion: boolean }): string {
  const negocio = escapeHtml(opts.nombreNegocio);
  // Con sesion abierta la portada deja de vender y pasa a ser un atajo al panel.
  const entrar = opts.conSesion
    ? '<a class="btn" href="/panel#inicio">Ir al panel</a>'
    : '<a class="btn" href="/login">Entrar</a>';
  const llamada = opts.conSesion
    ? '<a class="btn grande" href="/panel#inicio">Abrir el panel</a>'
    : '<a class="btn grande" href="/login">Entrar al sistema</a>';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${negocio} - ${NOMBRE_SISTEMA}: ${LEMA_SISTEMA}</title>
<meta name="description" content="${PROMESA.bajada}">
<style>${CSS}</style></head>
<body>
<header><div class="ancho">
  <a class="logotipo" href="/"><span class="sello">${INICIAL_SISTEMA}</span>${NOMBRE_SISTEMA}</a>
  <nav aria-label="Secciones de esta página"><a href="#que-hace">Qué hace</a><a href="#como-funciona">Cómo funciona</a><a href="#numero">Salud del número</a></nav>
  <div class="derecha">${opts.conSesion ? '<a class="btn secundario" href="/chat">Chats</a>' : ''}${entrar}</div>
</div></header>

<main class="ancho">
  <section class="hero">
    <div>
      <span class="etiqueta">${NOMBRE_SISTEMA} · Procesos por WhatsApp para empresas</span>
      <h1>${PROMESA.titular} <span>${PROMESA.remate}</span>.</h1>
      <p class="bajada">${PROMESA.bajada} Con las guardas para que el número siga vivo mañana.</p>
      <div class="acciones">${llamada}<small>Acceso solo para el equipo · usuario y contraseña</small></div>
    </div>
    <div class="captura" aria-hidden="true">
      <div class="cifras">
        <div class="cifra"><span>Enviados hoy</span><b>184</b></div>
        <div class="cifra"><span>Recibidos hoy</span><b>96</b></div>
        <div class="cifra"><span>Fallidos hoy</span><b class="bien">0</b></div>
      </div>
      <div class="barras">${BARRAS.map((alto) => `<i style="height:${alto}%"></i>`).join('')}</div>
      <div class="marcas"><span class="marca bien">Número en verde</span><span class="marca">Procesos: 42 de 60 respondieron</span><span class="marca">3 esperan respuesta</span></div>
    </div>
  </section>

  <p class="compatible"><span>Funciona con</span> <b>WhatsApp Business (API oficial de Meta)</b> · <b>WAHA</b> · <b>WhatsApp Web (QR)</b> · <b>Excel y CSV</b> · <b>API para tus sistemas</b></p>

  <section class="bloque" id="que-hace">
    <div class="titulo"><h2>Todo lo del día, en un solo sitio</h2><p>Cada módulo hace una cosa y la hace bien. Y todos comparten el mismo número, el mismo ritmo y las mismas guardas.</p></div>
    <div class="rejilla">
      ${QUE_HACE.map((m) => `<div class="tarjeta"><div class="ico">${m.ico}</div><b>${m.titulo}</b><p>${m.texto}</p></div>`).join('\n      ')}
    </div>
  </section>

  <section class="bloque" id="como-funciona">
    <div class="titulo"><h2>Cómo funciona un proceso</h2><p>De tu lista a las respuestas ordenadas, sin que nadie escriba un mensaje a mano.</p></div>
    <div class="rejilla pasos">
      ${PASOS.map((p) => `<div class="tarjeta"><b>${p.titulo}</b><p>${p.texto}</p></div>`).join('\n      ')}
    </div>
  </section>

  <section class="bloque" id="numero">
    <div class="franja">
      <div>
        <h2>Las guardas para que el número siga vivo mañana</h2>
        <p>Un número baneado es un día sin trabajar. Por eso el sistema no manda todo lo que puede, sino todo lo que WhatsApp tolera.</p>
      </div>
      <ul>${GUARDAS.map((g) => `<li>${g}</li>`).join('')}</ul>
    </div>
  </section>

  <section class="cierre">
    <h2>Entra y mira cómo va el día</h2>
    <p>Procesos, personas, respuestas, chats y la salud del número, en una sola pantalla.</p>
    ${llamada}
  </section>
</main>

<footer class="ancho">
  <span>${negocio} · Acceso solo para el equipo.</span>
  <span>${opts.conSesion ? '<a href="/panel#inicio">Panel</a> · <a href="/manual">Manual de uso</a>' : '¿Tienes cuenta? <a href="/login">Entra aquí</a>.'}</span>
</footer>
</body></html>`;
}
