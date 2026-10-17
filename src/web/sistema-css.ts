/**
 * Las piezas comunes de todas las pantallas del armazon: titulos, enlaces,
 * campos, botones, tablas, desplegables, avisos, cargas y estados vacios.
 *
 * Todo va dentro de `.s-base` (el hueco de contenido, salvo el chat, que
 * lleva su propia paleta de WhatsApp) y con `:where(...)`, que no suma
 * especificidad: una regla suelta de una pagina (`button {...}`) pierde
 * contra esta base, y una regla con clase de la pagina (`.pp-cerrar {...}`)
 * le sigue ganando. Asi todas las pantallas se ven igual sin tocar la forma
 * en que cada una arma su HTML.
 *
 * Los colores, radios y tamaños salen de tokens.ts.
 */

/** Iconos de trazo (los mismos del menu) como mascara CSS, para avisos y vacios. */
function mascara(svg: string): string {
  const fuente = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>${svg}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(fuente)}")`;
}
const ICO_OK = mascara('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>');
const ICO_INFO = mascara('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.5h.01"/>');
const ICO_AVISO = mascara('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/>');
const ICO_ERROR = mascara('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>');
const ICO_VACIO = mascara('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>');

export const SISTEMA_CSS = `
  /* ==== Piezas comunes (ver sistema-css.ts) ================================ */
  .s-base { color: var(--texto); }

  /* --- textos ------------------------------------------------------------ */
  .s-base :where(h2) { font-size: var(--fs-h2); font-weight: 700; line-height: 1.3; letter-spacing: -.01em; margin: 0 0 var(--esp-3); color: var(--texto); }
  .s-base :where(h3) { font-size: var(--fs-h3); font-weight: 700; line-height: 1.35; margin: var(--esp-5) 0 var(--esp-2); color: var(--texto); }
  .s-base :where(h4) { font-size: var(--fs-cuerpo); font-weight: 600; line-height: 1.4; margin: var(--esp-4) 0 var(--esp-2); }
  .s-base :where(h2, h3, h4):first-child { margin-top: 0; }
  .s-base :where(.muted, small.muted) { color: var(--texto-suave); }
  .s-base :where(small) { font-size: var(--fs-small); }
  .s-base :where(a:not([class])) { color: var(--primario); font-weight: 500; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--primario) 35%, transparent); text-underline-offset: 3px; transition: text-decoration-color var(--dur) ease, color var(--dur) ease; }
  .s-base :where(a:not([class])):hover { text-decoration-color: currentColor; color: var(--primario-hover); }
  .s-base :where(code, kbd) { font-family: var(--mono); font-size: .88em; background: var(--superficie-2); border: 1px solid var(--borde); border-radius: var(--radio-xs); padding: 1px 5px; overflow-wrap: anywhere; }
  .s-base :where(pre) { font-family: var(--mono); font-size: 12.5px; line-height: 1.55; background: var(--superficie-2); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: var(--esp-3); white-space: pre-wrap; overflow-wrap: anywhere; }
  .s-base :where(pre code) { background: none; border: 0; padding: 0; font-size: inherit; }
  .s-base :where(hr) { border: 0; border-top: 1px solid var(--borde); margin: var(--esp-5) 0; }

  /* --- campos ------------------------------------------------------------- */
  .s-base :where(label:not(:has(input[type=checkbox], input[type=radio]))) { font-weight: 600; font-size: 13.5px; color: var(--texto); }
  .s-base :where(input:not([type=checkbox], [type=radio], [type=range], [type=file], [type=color], [type=hidden]), select, textarea) {
    font: inherit; font-size: var(--fs-cuerpo); color: var(--texto); background: var(--superficie);
    border: 1px solid var(--borde-fuerte); border-radius: var(--radio-sm); min-height: var(--alto-control);
    padding: 8px 12px; box-sizing: border-box; max-width: 100%;
    transition: border-color var(--dur) ease, box-shadow var(--dur) ease, background-color var(--dur) ease;
  }
  .s-base :where(textarea) { line-height: 1.5; resize: vertical; }
  .s-base :where(input, select, textarea):hover:not(:disabled):not(:focus) { border-color: var(--gris-claro); }
  .s-base :where(input, select, textarea):focus { outline: none; border-color: var(--primario); box-shadow: var(--anillo); }
  .s-base :where(input, select, textarea):disabled { background: var(--superficie-2); color: var(--texto-suave); cursor: not-allowed; }
  .s-base :where(input, textarea)::placeholder { color: var(--placeholder); opacity: 1; }
  .s-base :where(input[type=checkbox], input[type=radio]) { accent-color: var(--primario); width: 16px; height: 16px; min-height: 0; margin: 0 2px 0 0; vertical-align: -3px; cursor: pointer; }
  .s-base :where(fieldset) { border: 1px solid var(--borde); border-radius: var(--radio); padding: var(--esp-2) var(--esp-5) var(--esp-4); margin: 0 0 var(--esp-4); min-width: 0; }
  .s-base :where(legend) { padding: 0 var(--esp-2); font-weight: 700; font-size: var(--fs-h3); }

  /* --- botones -------------------------------------------------------------
     Tres clases que se reconocen a simple vista:
       principal  (.btn.primario o un submit sin clase): verde lleno, uno por bloque;
       secundario (.btn o un boton sin clase): blanco con borde;
       destructivo (.btn.peligro): rojo, siempre aparte de los demas.
     Y uno discreto (.btn.fantasma) para acciones de poco peso. */
  .btn, .s-base :where(button:not([class])) {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-height: var(--alto-control); padding: 8px 16px; border: 1px solid var(--borde-fuerte); border-radius: var(--radio-sm);
    background: var(--superficie); color: var(--texto); font: inherit; font-size: 14px; font-weight: 600; line-height: 1.2;
    cursor: pointer; text-decoration: none; box-shadow: var(--sombra); white-space: nowrap;
    transition: background-color var(--dur) ease, border-color var(--dur) ease, color var(--dur) ease, box-shadow var(--dur) ease, transform .08s ease;
  }
  .btn:hover, .s-base :where(button:not([class])):hover { border-color: var(--primario); color: var(--primario); }
  .btn:active:not(:disabled), .s-base :where(button:not([class])):active:not(:disabled) { transform: translateY(1px); }
  .s-base :where(button[type=submit]:not([class])), .btn.primario { background: var(--primario); border-color: var(--primario); color: var(--primario-texto); }
  .s-base :where(button[type=submit]:not([class])):hover, .btn.primario:hover { background: var(--primario-hover); border-color: var(--primario-hover); color: var(--primario-texto); box-shadow: var(--sombra-hover); }
  .btn.secundario { background: var(--primario-suave); border-color: transparent; color: var(--primario); box-shadow: none; }
  .btn.secundario:hover { border-color: var(--primario); }
  .btn.fantasma { background: transparent; border-color: transparent; color: var(--texto-suave); box-shadow: none; }
  .btn.fantasma:hover { background: var(--superficie-2); color: var(--texto); border-color: transparent; }
  .btn.peligro { background: var(--superficie); border-color: color-mix(in srgb, var(--rojo) 35%, transparent); color: var(--rojo); }
  .btn.peligro:hover { background: var(--rojo); border-color: var(--rojo); color: #fff; }
  .btn.sm { min-height: var(--alto-control-sm); padding: 6px 12px; font-size: 13px; }
  .btn:disabled, .s-base :where(button:disabled) { opacity: .5; cursor: not-allowed; box-shadow: none; transform: none; }
  .s-base :where(.actions, .acciones) { display: flex; flex-wrap: wrap; gap: var(--esp-2); align-items: center; }
  /* Fila de guardar: la accion principal a la derecha del bloque, separada por una linea. */
  .barra-guardar { display: flex; flex-wrap: wrap; gap: var(--esp-2); align-items: center; justify-content: flex-end; margin-top: var(--esp-5); padding-top: var(--esp-4); border-top: 1px solid var(--borde); }
  .barra-guardar .izq { margin-right: auto; }

  /* --- tarjetas ----------------------------------------------------------- */
  .s-base :where(.card) { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra); }
  .s-base :where(.tarjeta) { border-radius: var(--radio); }
  a.tarjeta-enlace, .s-base :where(.tarjeta-enlace) { display: grid; gap: 4px; padding: 14px 16px; border: 1px solid var(--borde); border-radius: var(--radio); background: var(--superficie); color: var(--texto); text-decoration: none; transition: border-color var(--dur) ease, box-shadow var(--dur) ease, transform var(--dur) var(--curva); }
  a.tarjeta-enlace:hover { border-color: var(--primario); box-shadow: var(--sombra-hover); transform: translateY(-1px); }

  /* --- tablas ------------------------------------------------------------- */
  .s-base :where(table) { width: 100%; border-collapse: collapse; font-size: 13.5px; font-variant-numeric: tabular-nums; }
  .s-base :where(th) { text-align: left; padding: 10px 12px; font-size: var(--fs-micro); font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--texto-suave); background: var(--superficie-2); border-bottom: 1px solid var(--borde); white-space: nowrap; vertical-align: bottom; }
  .s-base :where(td) { padding: 11px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; line-height: 1.45; }
  .s-base :where(tbody tr) { transition: background-color var(--dur) ease; }
  .s-base :where(tbody tr:hover) { background: var(--fila-hover); }
  .s-base :where(tbody tr:last-child > td) { border-bottom: 0; }
  .s-base :where(.tablewrap, .tabla-marco) { overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid var(--borde); border-radius: var(--radio); background: var(--superficie); }
  .s-base :where(.tablewrap:has(> p, > .vacio)) { border: 0; background: none; }
  .s-base :where(.tablewrap) > :where(table th:first-child, table td:first-child) { padding-left: 16px; }

  /* --- desplegables (details) ------------------------------------------- */
  .s-base :where(summary) { cursor: pointer; font-weight: 600; list-style: none; display: flex; align-items: center; gap: 10px; min-height: 36px; border-radius: var(--radio-xs); transition: color var(--dur) ease; }
  .s-base :where(summary)::-webkit-details-marker { display: none; }
  .s-base :where(summary)::before { content: ''; flex: none; width: 7px; height: 7px; margin: 0 2px 0 3px; border-right: 2px solid var(--texto-suave); border-bottom: 2px solid var(--texto-suave); transform: rotate(-45deg); transition: transform var(--dur) var(--curva); }
  .s-base :where(details[open] > summary)::before { transform: rotate(45deg) translate(-2px, -1px); }
  .s-base :where(summary):hover { color: var(--primario); }
  .s-base :where(details[open] > :not(summary)) { animation: s-aparecer .2s var(--curva); }

  /* --- avisos: exito, informacion, advertencia y error ------------------
     Siempre con icono y texto: el estado no depende solo del color. */
  .s-alerta { display: flex; align-items: flex-start; gap: 10px; padding: 11px 14px; border-radius: var(--radio-sm); border: 1px solid var(--borde); background: var(--superficie-2); color: var(--texto); font-size: var(--fs-cuerpo); line-height: 1.45; animation: s-aparecer .2s var(--curva); }
  .s-alerta:empty { display: none; }
  .s-alerta::before { content: ''; flex: none; width: 18px; height: 18px; margin-top: 1px; background: currentColor; -webkit-mask: ${ICO_INFO} center / contain no-repeat; mask: ${ICO_INFO} center / contain no-repeat; color: var(--azul); }
  .s-alerta > .txt, .s-alerta > span:not(.chip) { flex: 1; min-width: 0; }
  .s-alerta.ok { background: var(--verde-suave); border-color: color-mix(in srgb, var(--verde) 25%, transparent); }
  .s-alerta.ok::before { -webkit-mask-image: ${ICO_OK}; mask-image: ${ICO_OK}; color: var(--verde); }
  .s-alerta.info { background: var(--azul-suave); border-color: color-mix(in srgb, var(--azul) 22%, transparent); }
  .s-alerta.warn { background: var(--ambar-suave); border-color: color-mix(in srgb, var(--ambar) 30%, transparent); }
  .s-alerta.warn::before { -webkit-mask-image: ${ICO_AVISO}; mask-image: ${ICO_AVISO}; color: var(--ambar); }
  .s-alerta.bad { background: var(--rojo-suave); border-color: color-mix(in srgb, var(--rojo) 30%, transparent); }
  .s-alerta.bad::before { -webkit-mask-image: ${ICO_ERROR}; mask-image: ${ICO_ERROR}; color: var(--rojo); }
  .s-alerta .cerrar { margin-left: auto; flex: none; border: 0; background: transparent; color: var(--texto-suave); cursor: pointer; border-radius: var(--radio-xs); width: 26px; height: 26px; min-height: 0; padding: 0; font-size: 18px; line-height: 1; box-shadow: none; }
  .s-alerta .cerrar:hover { background: color-mix(in srgb, var(--texto) 8%, transparent); color: var(--texto); }
  /* El aviso flotante de las pantallas (window.toast / .toast). */
  .toast { display: flex; align-items: center; gap: 10px; border-radius: var(--radio-sm) !important; padding: 11px 16px !important; box-shadow: var(--sombra-2) !important; font-weight: 500; animation: s-subir .22s var(--curva); }
  .toast::before { content: ''; flex: none; width: 18px; height: 18px; background: currentColor; -webkit-mask: ${ICO_INFO} center / contain no-repeat; mask: ${ICO_INFO} center / contain no-repeat; opacity: .9; }
  .toast.ok::before, .toast.exito::before { -webkit-mask-image: ${ICO_OK}; mask-image: ${ICO_OK}; }
  .toast.error::before, .toast.bad::before, .toast.mal::before { -webkit-mask-image: ${ICO_ERROR}; mask-image: ${ICO_ERROR}; }

  /* --- cargas: esqueletos mientras llegan los datos --------------------- */
  .esqueleto { display: block; border-radius: var(--radio-xs); background: linear-gradient(90deg, var(--superficie-2) 25%, color-mix(in srgb, var(--superficie-2) 40%, var(--superficie)) 50%, var(--superficie-2) 75%); background-size: 200% 100%; animation: s-brillo 1.3s ease-in-out infinite; color: transparent !important; user-select: none; }
  .esqueleto.linea { height: 12px; margin: 8px 0; }
  .esqueleto.linea.corta { width: 40%; } .esqueleto.linea.media { width: 65%; }
  .esqueleto.titulo { height: 22px; width: 50%; margin: 4px 0 12px; }
  .esqueleto.bloque { height: 96px; border-radius: var(--radio); }
  .esqueleto-fila { display: grid; gap: var(--esp-3); grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }

  /* --- estados vacios --------------------------------------------------- */
  .vacio::before { content: ''; display: block; width: 40px; height: 40px; margin: 0 auto var(--esp-3); border-radius: 50%; background: var(--superficie-2); }
  .vacio { position: relative; }
  .vacio::after { content: ''; position: absolute; top: calc(var(--esp-6) + 10px); left: 50%; width: 20px; height: 20px; margin-left: -10px; background: var(--texto-suave); -webkit-mask: ${ICO_VACIO} center / contain no-repeat; mask: ${ICO_VACIO} center / contain no-repeat; }
  .vacio.sin-ico::before, .vacio.sin-ico::after, .vacio:has(.ico)::before, .vacio:has(.ico)::after { display: none; }
  .vacio.compacto { padding: var(--esp-5) var(--esp-4); }
  .vacio.compacto::after { top: calc(var(--esp-5) + 10px); }

  /* --- pestañas (las de Pedidos GSG, Nuestra API...) -------------------- */
  .s-base :where([role=tabpanel]:not([hidden]):not(.hidden)) { animation: s-aparecer .2s var(--curva); }

  @keyframes s-aparecer { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  @keyframes s-subir { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
  @keyframes s-brillo { from { background-position: 100% 0; } to { background-position: -100% 0; } }
`;
