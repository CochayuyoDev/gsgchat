/**
 * La portada: que es GSGchat y por donde se entra.
 *
 * La ve quien todavia no tiene sesion (en la plataforma, `/` sin sesion), asi
 * que cuenta el sistema por lo que hace en el dia de un courier: pedir la
 * ubicacion de cada pedido, confirmar, mandar al motorizado con su hora y
 * atender los chats, con WhatsApp normal o con la API oficial de Meta. Con la
 * sesion abierta, los botones llevan al panel. Sin precios.
 *
 * Su lenguaje visual sale del mundo del reparto: la pieza central es una
 * ETIQUETA DE ENVIO (tracking, distrito, monto a cobrar, codigo de barras) con
 * la conversacion de WhatsApp encima, y el recorrido de un pedido es una linea
 * de ruta con sus paradas. Todo dibujado con HTML y CSS: sin imagenes.
 *
 * No lleva armazon: define su CSS aqui, con su propia paleta (el verde del logo
 * para las franjas, un menta suave para botones y resaltados, papel) en claro y
 * en oscuro. Los nombres de los tonos (asfalto, senal) vienen de la version
 * anterior; lo que cuenta es su papel, no el nombre. Respeta el tema elegido en el sistema
 * (`data-tema`) y `prefers-reduced-motion`.
 */

import { NOMBRE_SISTEMA } from '../marca.js';
import { ICONOS_HEAD, RUTA_LOGO } from './marca-routes.js';
import { escapeHtml, FUENTES_MARCA } from './login-page.js';
import { TEMA_SCRIPT } from './tokens.js';

const CLARO = `
    --fondo: #F1F6F2; --papel: #FFFFFF; --tinta: #0F1B15; --tinta-suave: #4B5E54; --linea: #D4E2D9;
    --asfalto: #0B5A3C; --asfalto-2: #126A49; --sobre-asfalto: #EAF6EF; --sobre-asfalto-suave: #AFD3BF;
    --senal: #8DDDB0; --senal-tinta: #063321; --wa: #1FA855; --wa-suave: #DCF5E5; --burbuja: #FFFFFF; --burbuja-mia: #D9FDD3; --chat-fondo: #EFE7DC;`;
const OSCURO = `
    --fondo: #0A120E; --papel: #111C17; --tinta: #E6F0EA; --tinta-suave: #9AB3A6; --linea: #233B2F;
    --asfalto: #0E3626; --asfalto-2: #164532; --sobre-asfalto: #E6F0EA; --sobre-asfalto-suave: #A0C4B2;
    --senal: #74D69E; --senal-tinta: #04261A; --wa: #3DD47A; --wa-suave: #123222; --burbuja: #1F2C38; --burbuja-mia: #144D37; --chat-fondo: #0E161E;`;

const CSS = `
  :root {${CLARO}
    --display: "Archivo", "Arial Narrow", system-ui, sans-serif;
    --texto: "Public Sans", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, Consolas, monospace;
    --radio: 14px;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-tema="claro"]) {${OSCURO}} }
  :root[data-tema="oscuro"] {${OSCURO}}
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--fondo); color: var(--tinta); font: 16px/1.6 var(--texto); -webkit-font-smoothing: antialiased; }
  a { color: inherit; }
  :focus-visible { outline: 3px solid var(--senal); outline-offset: 2px; border-radius: 6px; }
  .ancho { max-width: 1160px; margin: 0 auto; padding: 0 20px; }
  .mono { font-family: var(--mono); }

  /* --- cabecera --- */
  .cab { position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--fondo) 88%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--linea); }
  .cab .ancho { display: flex; align-items: center; gap: 16px; min-height: 66px; }
  .logo { display: flex; align-items: center; gap: 10px; text-decoration: none; font: 800 19px/1 var(--display); font-stretch: 125%; letter-spacing: -.01em; }
  .logo .sello { width: 34px; height: 34px; object-fit: contain; flex: none; }
  .cab nav { display: flex; gap: 22px; margin-left: 22px; font-size: 14.5px; }
  .cab nav a { text-decoration: none; color: var(--tinta-suave); min-height: 44px; display: inline-flex; align-items: center; }
  .cab nav a:hover { color: var(--tinta); }
  .cab .derecha { margin-left: auto; display: flex; gap: 10px; }

  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 11px 20px; border-radius: 10px; border: 2px solid var(--asfalto); background: var(--asfalto); color: var(--sobre-asfalto); font-weight: 700; font-size: 15px; text-decoration: none; white-space: nowrap; transition: transform .15s ease, box-shadow .15s ease; }
  .btn:hover { transform: translateY(-1px); box-shadow: 0 6px 0 -2px var(--senal); }
  .btn.senal { background: var(--senal); border-color: var(--senal); color: var(--senal-tinta); }
  .btn.senal:hover { box-shadow: 0 6px 0 -2px var(--asfalto); }
  .btn.borde { background: transparent; color: var(--tinta); border-color: var(--linea); }
  .btn.borde:hover { border-color: var(--tinta); box-shadow: none; }
  :root[data-tema="oscuro"] .btn:not(.senal):not(.borde) { border-color: var(--sobre-asfalto); }

  /* --- lo primero que se ve --- */
  .hero { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr); gap: 56px; align-items: center; padding-top: 72px; padding-bottom: 64px; }
  .cinta { display: inline-flex; align-items: center; gap: 10px; font: 600 12.5px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--tinta-suave); margin-bottom: 20px; }
  .cinta::before { content: ""; width: 34px; height: 10px; background: repeating-linear-gradient(-45deg, var(--senal) 0 6px, var(--asfalto) 6px 12px); border-radius: 2px; }
  h1 { font: 800 clamp(34px, 4.4vw, 56px)/1.03 var(--display); font-stretch: 125%; letter-spacing: -.035em; margin: 0 0 22px; text-wrap: balance; }
  h1 em { font-style: normal; background: linear-gradient(transparent 62%, var(--senal) 62% 92%, transparent 92%); padding: 0 .06em; }
  .bajada { font-size: 18.5px; color: var(--tinta-suave); max-width: 530px; margin: 0 0 30px; }
  .acciones { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .canales { margin-top: 26px; display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 13.5px; color: var(--tinta-suave); }
  .canales span { display: inline-flex; align-items: center; gap: 7px; }
  .canales span::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--wa); }

  /* --- la etiqueta de envio (la firma de la pagina) --- */
  .escena { position: relative; padding: 10px 0 40px 0; min-height: 540px; }
  .etiqueta { position: relative; background: var(--papel); color: var(--tinta); border: 2px solid var(--tinta); border-radius: 6px; box-shadow: 10px 10px 0 var(--asfalto); transform: rotate(-1.6deg); max-width: 430px; }
  .etiqueta .fila { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 2px solid var(--tinta); }
  .etiqueta .celda { padding: 10px 14px; min-width: 0; }
  .etiqueta .celda + .celda { border-left: 2px solid var(--tinta); }
  .etiqueta .rot { display: block; font: 600 10.5px/1.2 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--tinta-suave); margin-bottom: 3px; }
  .etiqueta .val { font: 800 17px/1.2 var(--display); font-stretch: 125%; overflow-wrap: anywhere; }
  .etiqueta .cabeza { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 14px; background: var(--asfalto); color: var(--sobre-asfalto); border-bottom: 2px solid var(--tinta); }
  .etiqueta .cabeza b { font: 800 15px/1 var(--display); font-stretch: 125%; letter-spacing: .02em; }
  .etiqueta .cabeza .mono { font-size: 12px; color: var(--senal); }
  .etiqueta .tracking { font: 600 26px/1.1 var(--mono); letter-spacing: .02em; }
  .barras { display: flex; align-items: stretch; gap: 0; height: 54px; padding: 12px 14px 4px; }
  .barras i { display: block; background: var(--tinta); }
  .barras-num { padding: 0 14px 12px; font: 500 11px/1 var(--mono); letter-spacing: .32em; color: var(--tinta-suave); }
  .sello-ok { position: absolute; right: 14px; top: 52px; transform: rotate(-11deg); border: 3px solid var(--wa); color: var(--wa); border-radius: 8px; padding: 6px 12px; font: 800 14px/1.15 var(--display); font-stretch: 125%; text-transform: uppercase; letter-spacing: .03em; background: color-mix(in srgb, var(--papel) 82%, transparent); text-align: center; }
  .sello-ok small { display: block; font: 600 11px/1.3 var(--mono); letter-spacing: .04em; text-transform: none; }

  /* El chat, apoyado sobre la etiqueta */
  .chat { position: absolute; right: 0; top: 232px; width: min(300px, 66%); background: var(--chat-fondo); border-radius: var(--radio); padding: 12px; box-shadow: 0 24px 50px -18px rgba(13,20,28,.45); border: 1px solid var(--linea); display: grid; gap: 8px; transform: rotate(1.2deg); }
  .chat .quien { font: 600 11px/1 var(--mono); color: var(--tinta-suave); padding: 0 2px 4px; display: flex; justify-content: space-between; }
  .burbuja { max-width: 92%; padding: 8px 10px 6px; border-radius: 10px; font-size: 13.5px; line-height: 1.4; background: var(--burbuja); box-shadow: 0 1px 0 rgba(0,0,0,.08); }
  .burbuja.mia { justify-self: end; background: var(--burbuja-mia); }
  .burbuja .hora { display: block; text-align: right; font: 500 10px/1 var(--mono); color: var(--tinta-suave); margin-top: 3px; }
  .pin { display: grid; gap: 6px; }
  .mapita { height: 74px; border-radius: 7px; position: relative; overflow: hidden; background:
      linear-gradient(90deg, transparent 47%, color-mix(in srgb, var(--senal) 70%, #fff) 47% 53%, transparent 53%),
      linear-gradient(0deg, transparent 30%, rgba(255,255,255,.75) 30% 36%, transparent 36%),
      linear-gradient(125deg, transparent 60%, rgba(255,255,255,.7) 60% 64%, transparent 64%),
      #CFE3D2; }
  :root[data-tema="oscuro"] .mapita { filter: brightness(.7); }
  .mapita::after { content: ""; position: absolute; left: 50%; top: 42%; width: 16px; height: 16px; margin: -16px 0 0 -8px; background: #E5484D; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); box-shadow: 0 2px 4px rgba(0,0,0,.3); }

  /* Entrada: la conversacion se arma sola, una vez */
  @media (prefers-reduced-motion: no-preference) {
    .anima { opacity: 0; transform: translateY(8px); animation: entra .45s ease forwards; }
    .chat .anima:nth-of-type(2) { animation-delay: .35s; }
    .chat .anima:nth-of-type(3) { animation-delay: 1.1s; }
    .chat .anima:nth-of-type(4) { animation-delay: 1.8s; }
    .sello-ok { opacity: 0; animation: sella .35s cubic-bezier(.2,1.6,.4,1) 2.4s forwards; }
    @keyframes entra { to { opacity: 1; transform: none; } }
    @keyframes sella { from { opacity: 0; transform: rotate(-11deg) scale(1.6); } to { opacity: 1; transform: rotate(-11deg) scale(1); } }
  }

  /* --- secciones --- */
  .bloque { padding: 72px 0; }
  .bloque > .ancho > .tit { max-width: 640px; margin-bottom: 36px; }
  h2 { font: 800 clamp(26px, 3.2vw, 38px)/1.08 var(--display); font-stretch: 125%; letter-spacing: -.025em; margin: 0 0 12px; text-wrap: balance; }
  .tit p { margin: 0; color: var(--tinta-suave); font-size: 17px; }

  /* El recorrido de un pedido: una ruta con paradas, en orden */
  .ruta { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 18px; position: relative; }
  .ruta::before { content: ""; position: absolute; left: 22px; right: 22px; top: 21px; border-top: 4px dashed var(--asfalto); opacity: .35; }
  .parada { position: relative; }
  .parada .num { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; background: var(--papel); border: 3px solid var(--asfalto); font: 800 17px/1 var(--display); font-stretch: 125%; position: relative; }
  .parada:last-child .num { background: var(--senal); border-color: var(--senal); color: var(--senal-tinta); }
  .parada b { display: block; margin: 16px 0 6px; font-size: 16.5px; }
  .parada p { margin: 0; color: var(--tinta-suave); font-size: 14.5px; }
  .parada .quien { display: inline-block; margin-top: 10px; font: 600 11px/1 var(--mono); letter-spacing: .05em; text-transform: uppercase; color: var(--tinta-suave); border: 1px solid var(--linea); border-radius: 999px; padding: 5px 9px; }

  /* Dos WhatsApp */
  .dos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .modo { background: var(--papel); border: 1px solid var(--linea); border-radius: var(--radio); padding: 24px; display: flex; flex-direction: column; gap: 10px; }
  .modo .ico { width: 42px; height: 42px; border-radius: 11px; display: grid; place-items: center; background: var(--fondo); }
  .modo h3 { margin: 0; font: 800 19px/1.2 var(--display); font-stretch: 125%; }
  .modo p { margin: 0; color: var(--tinta-suave); font-size: 15px; }
  .modo ul { margin: 4px 0 0; padding-left: 18px; color: var(--tinta-suave); font-size: 14.5px; }
  .modo.juntos { background: var(--asfalto); border-color: var(--asfalto); color: var(--sobre-asfalto); }
  .modo.juntos p, .modo.juntos ul { color: var(--sobre-asfalto-suave); }
  .modo.juntos .ico { background: var(--senal); color: var(--senal-tinta); }

  /* Las pantallas del equipo */
  .pantallas { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; border: 2px solid var(--tinta); border-radius: 8px; overflow: hidden; background: var(--papel); }
  .pantalla { padding: 22px 20px; min-width: 0; }
  .pantalla + .pantalla { border-left: 2px solid var(--tinta); }
  .pantalla .rot { font: 600 11px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--tinta-suave); }
  .pantalla b { display: block; font: 800 22px/1.15 var(--display); font-stretch: 125%; margin: 8px 0 8px; }
  .pantalla p { margin: 0; color: var(--tinta-suave); font-size: 14.5px; }

  /* Salud del numero */
  .franja { background: var(--asfalto); color: var(--sobre-asfalto); border-radius: 18px; padding: 48px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 40px; align-items: center; position: relative; overflow: hidden; }
  .franja::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: repeating-linear-gradient(-45deg, var(--senal) 0 14px, var(--asfalto) 14px 28px); }
  .franja p { color: var(--sobre-asfalto-suave); margin: 0; }
  .semaforo { display: grid; gap: 10px; }
  .luz { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 12px; align-items: start; padding: 12px 14px; border-radius: 10px; background: var(--asfalto-2); font-size: 14.5px; }
  .luz i { width: 14px; height: 14px; border-radius: 50%; margin-top: 4px; }
  .luz b { color: var(--sobre-asfalto); }
  .luz span { color: var(--sobre-asfalto-suave); }

  .cierre { text-align: center; padding-top: 80px; padding-bottom: 72px; }
  .cierre p { color: var(--tinta-suave); margin: 0 auto 26px; max-width: 520px; }
  .cierre .acciones { justify-content: center; }

  .pie { border-top: 1px solid var(--linea); }
  .pie .ancho { display: flex; flex-wrap: wrap; gap: 10px 22px; justify-content: space-between; padding-top: 24px; padding-bottom: 36px; font-size: 13.5px; color: var(--tinta-suave); }
  .pie a { color: var(--tinta-suave); }
  .pie a:hover { color: var(--tinta); }

  @media (max-width: 980px) {
    .hero { grid-template-columns: minmax(0, 1fr); gap: 40px; padding-top: 44px; }
    .sello-ok { font-size: 12px; top: 46px; }
    .escena { max-width: 520px; }
    .ruta { grid-template-columns: minmax(0, 1fr); gap: 22px; }
    .ruta::before { left: 21px; right: auto; top: 22px; bottom: 22px; border-top: 0; border-left: 4px dashed var(--asfalto); }
    .parada { display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 0 16px; }
    .parada b { margin-top: 10px; }
    .parada > :not(.num) { grid-column: 2; }
    .parada .num { grid-row: span 3; }
    .dos { grid-template-columns: minmax(0, 1fr); }
    .pantallas { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .pantalla:nth-child(3) { border-left: 0; }
    .pantalla:nth-child(n+3) { border-top: 2px solid var(--tinta); }
    .franja { grid-template-columns: minmax(0, 1fr); padding: 32px 22px 40px; }
    .cab nav { display: none; }
  }
  @media (max-width: 560px) {
    .escena { min-height: 0; }
    .chat { position: relative; top: auto; right: auto; width: 100%; margin-top: -26px; transform: none; }
    .etiqueta { transform: none; box-shadow: 6px 6px 0 var(--asfalto); }
    .pantallas { grid-template-columns: minmax(0, 1fr); }
    .pantalla + .pantalla { border-left: 0; border-top: 2px solid var(--tinta); }
    .cab .derecha .btn.borde { display: none; }
    .bloque { padding: 52px 0; }
  }
`;

/** Un codigo de barras dibujado: anchos fijos sacados del propio tracking (siempre igual, sin azar). */
function barras(codigo: string): string {
  const anchos: number[] = [];
  for (const c of codigo) {
    const n = c.charCodeAt(0);
    anchos.push((n % 3) + 1, ((n >> 2) % 2) + 1, ((n >> 1) % 3) + 1, (n % 2) + 1);
  }
  return anchos.map((w, i) => `<i style="width:${w * 2}px;${i % 2 ? 'background:transparent;' : ''}"></i>`).join('');
}

/** El recorrido de un pedido, en el orden en que pasa. */
const RUTA: Array<{ titulo: string; texto: string; quien: string }> = [
  { titulo: 'Llega el pedido', texto: 'La empresa de reparto lo manda por la API, o el equipo pega la lista del día.', quien: 'API o lista' },
  { titulo: 'Se pide la ubicación', texto: 'Cada cliente recibe un WhatsApp con su pedido y un botón para mandar su pin.', quien: 'Automático' },
  { titulo: 'El cliente confirma', texto: 'Manda su ubicación y confirma que estará. Si no contesta, se le insiste con calma.', quien: 'Cliente' },
  { titulo: 'Sale el motorizado', texto: 'Recibe la ruta con el pin exacto; al cliente le llega la hora estimada de llegada.', quien: 'Motorizado' },
  { titulo: 'Entregado', texto: 'El motorizado avisa desde su WhatsApp y el estado vuelve solo a la empresa de reparto.', quien: 'Listo' },
];

const ICO = {
  qr: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>',
  api: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  juntos: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10M7 7l3-3M7 7l3 3M17 17H7M17 17l-3-3M17 17l-3 3"/></svg>',
};

export function landingPage(opts: { nombreNegocio: string; conSesion: boolean }): string {
  const negocio = escapeHtml(opts.nombreNegocio);
  const tracking = 'GSG-E-205';
  const principal = opts.conSesion
    ? '<a class="btn senal" href="/panel#inicio">Abrir el panel</a>'
    : '<a class="btn senal" href="/registro">Crear mi cuenta</a><a class="btn borde" href="/login">Ya tengo cuenta</a>';

  return `<!doctype html>
<html lang="es-PE"><head><meta charset="utf-8">${TEMA_SCRIPT}<meta name="viewport" content="width=device-width, initial-scale=1">${ICONOS_HEAD}
<title>${NOMBRE_SISTEMA} · Entregas coordinadas por WhatsApp</title>
<meta name="description" content="${NOMBRE_SISTEMA} pide la ubicación de cada pedido por WhatsApp, confirma con el cliente y manda al motorizado con la hora de llegada. Con WhatsApp normal o con la API oficial de Meta.">
${FUENTES_MARCA}
<style>${CSS}</style></head>
<body>
<header class="cab"><div class="ancho">
  <a class="logo" href="/"><img class="sello" src="${RUTA_LOGO}" alt="" width="34" height="34">${NOMBRE_SISTEMA}</a>
  <nav aria-label="Secciones"><a href="#recorrido">Cómo funciona</a><a href="#whatsapp">WhatsApp normal y API</a><a href="#numero">Cuidado del número</a></nav>
  <div class="derecha">${opts.conSesion ? '<a class="btn" href="/panel#inicio">Ir al panel</a>' : '<a class="btn borde" href="/login">Entrar</a><a class="btn" href="/registro">Crear cuenta</a>'}</div>
</div></header>

<main>
  <section class="ancho hero">
    <div>
      <span class="cinta">Para couriers y tiendas con reparto · Lima, Perú</span>
      <h1>Cada pedido sale con la <em>ubicación exacta</em> del cliente.</h1>
      <p class="bajada">${NOMBRE_SISTEMA} le escribe a cada cliente por WhatsApp, recibe su pin, confirma la entrega y le pasa la ruta al motorizado con la hora de llegada. Tu equipo solo atiende lo que de verdad necesita a una persona.</p>
      <div class="acciones">${principal}</div>
      <div class="canales"><span>WhatsApp con QR</span><span>WhatsApp Business API de Meta</span><span>API para tu sistema</span></div>
    </div>

    <div class="escena" aria-label="Ejemplo: la etiqueta de un pedido y la conversación con el cliente">
      <div class="etiqueta" aria-hidden="true">
        <div class="cabeza"><b>GSG COURIER</b><span class="mono">ENTREGA HOY · 2:00–6:00 PM</span></div>
        <div class="fila"><div class="celda" style="grid-column:1/-1"><span class="rot">Tracking</span><span class="tracking">${tracking}</span></div></div>
        <div class="fila"><div class="celda"><span class="rot">Cliente</span><span class="val">Rosa Q.</span></div><div class="celda"><span class="rot">Distrito</span><span class="val">Surco</span></div></div>
        <div class="fila"><div class="celda"><span class="rot">Cobrar</span><span class="val">S/ 89.90</span></div><div class="celda"><span class="rot">Pago</span><span class="val">Yape</span></div></div>
        <div class="barras">${barras(tracking)}</div>
        <div class="barras-num">7 750412 020500</div>
        <div class="sello-ok">Ubicación<br>registrada<small>10:42 · Surco</small></div>
      </div>
      <div class="chat" aria-hidden="true">
        <div class="quien"><span>Rosa · +51 9•• ••• 321</span><span>hoy</span></div>
        <div class="burbuja anima">Hola Rosa 👋 Tenemos tu pedido <b class="mono">${tracking}</b> para hoy. ¿Nos compartes tu ubicación para armar la ruta?<span class="hora">10:41</span></div>
        <div class="burbuja mia anima pin"><div class="mapita"></div>Mi ubicación 📍<span class="hora">10:42 ✓✓</span></div>
        <div class="burbuja anima">¡Gracias! Tu motorizado llega entre <b>3:10 y 4:10 PM</b>.<span class="hora">10:42</span></div>
      </div>
    </div>
  </section>

  <section class="bloque" id="recorrido"><div class="ancho">
    <div class="tit"><h2>El recorrido de un pedido</h2><p>De la lista del día a «entregado», sin que nadie tenga que escribir mensaje por mensaje.</p></div>
    <ol class="ruta">
      ${RUTA.map((p, i) => `<li class="parada"><span class="num">${i + 1}</span><b>${p.titulo}</b><p>${p.texto}</p><span class="quien">${p.quien}</span></li>`).join('\n      ')}
    </ol>
  </div></section>

  <section class="bloque" id="whatsapp"><div class="ancho">
    <div class="tit"><h2>Tu WhatsApp de siempre, la API oficial, o los dos</h2><p>Tú decides qué números atienden. Cambiar no desconecta ninguno y ningún chat se corta a la mitad.</p></div>
    <div class="dos">
      <article class="modo"><span class="ico">${ICO.qr}</span><h3>WhatsApp normal</h3><p>Vinculas tus celulares escaneando un QR, como WhatsApp Web. Hasta ocho números en la misma bandeja.</p><ul><li>Empieza hoy, sin trámites.</li><li>Cada cliente siempre con el mismo número.</li></ul></article>
      <article class="modo"><span class="ico">${ICO.api}</span><h3>WhatsApp Business API</h3><p>El camino oficial de Meta: plantillas aprobadas, botones nativos y sin riesgo de bloqueo por usar un dispositivo vinculado.</p><ul><li>Pedido de ubicación con un toque.</li><li>Avisos de calidad del número en vivo.</li></ul></article>
      <article class="modo juntos"><span class="ico">${ICO.juntos}</span><h3>Los dos juntos</h3><p>Los clientes se reparten entre todos tus números. Si alguien no escribió en 24 horas y la API pediría plantilla, el mensaje sale por un número normal.</p><ul><li>Nada se queda sin enviar.</li><li>Lo cambias con un clic en Conexión.</li></ul></article>
    </div>
  </div></section>

  <section class="bloque"><div class="ancho">
    <div class="tit"><h2>Lo que ve tu equipo cada mañana</h2><p>Pocas pantallas, cada una con un solo trabajo.</p></div>
    <div class="pantallas">
      <div class="pantalla"><span class="rot">Hoy</span><b>Quién falta</b><p>Los pedidos del día: quién ya mandó su ubicación, quién no contesta y qué necesita a una persona.</p></div>
      <div class="pantalla"><span class="rot">Mapa</span><b>Dónde está cada uno</b><p>Los pines de los clientes y de los motorizados, con su zona y su carga del día.</p></div>
      <div class="pantalla"><span class="rot">Chats</span><b>Una bandeja</b><p>Todos los números en un solo lugar, con la etiqueta de la línea y la ficha del pedido al lado.</p></div>
      <div class="pantalla"><span class="rot">Asistente</span><b>Responde con criterio</b><p>Contesta «¿dónde está mi pedido?» con datos reales y pasa a tu equipo lo que no entiende.</p></div>
    </div>
  </div></section>

  <section class="bloque" id="numero"><div class="ancho">
    <div class="franja">
      <div><h2>Un número bloqueado es un día sin repartir</h2><p>Por eso ${NOMBRE_SISTEMA} no manda todo lo que puede, sino lo que WhatsApp tolera: pausas de persona, solo en horario y solo a quien espera el mensaje.</p></div>
      <div class="semaforo">
        <div class="luz"><i style="background:#3DD47A"></i><div><b>Verde.</b> <span>Todo en orden: sale al ritmo de siempre.</span></div></div>
        <div class="luz"><i style="background:#FFC21A"></i><div><b>Ámbar.</b> <span>Más rechazos o bajas de lo normal: baja el ritmo solo y te avisa.</span></div></div>
        <div class="luz"><i style="background:#F2555A"></i><div><b>Rojo.</b> <span>Se detiene antes de que Meta o WhatsApp lo bloqueen, y te dice por qué.</span></div></div>
      </div>
    </div>
  </div></section>

  <section class="cierre ancho">
    <h2>Arranca con los pedidos de mañana</h2>
    <p>Crea tu cuenta, conecta tu WhatsApp y carga la primera lista. Tus datos y tu número son solo tuyos.</p>
    <div class="acciones">${principal}</div>
  </section>
</main>

<footer class="pie"><div class="ancho">
  <span>${negocio === NOMBRE_SISTEMA ? NOMBRE_SISTEMA : `${negocio} · ${NOMBRE_SISTEMA}`}</span>
  <span><a href="/privacidad">Privacidad</a> · <a href="/terminos">Términos y condiciones</a> · <a href="/eliminacion-de-datos">Eliminar mis datos</a> · <a href="/libro-de-reclamaciones">Libro de Reclamaciones</a></span>
  <span>${opts.conSesion ? '<a href="/panel#inicio">Panel</a> · <a href="/manual">Manual de uso</a>' : '¿Tienes cuenta? <a href="/login">Entra aquí</a>'}</span>
</div></footer>
</body></html>`;
}
