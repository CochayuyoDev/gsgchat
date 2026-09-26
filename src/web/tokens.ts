/**
 * El sistema visual de GSGchat: una sola paleta, una sola escala.
 *
 * Todas las pantallas (las del armazon y las sueltas, como el login) pintan
 * con estas variables. Los nombres viejos que ya usaban las paginas
 * (--accent, --panel, --line, --s-*) siguen existiendo como alias, asi nada
 * se rompe mientras cada pantalla se pasa a los nombres nuevos.
 *
 * Paleta verde (26/09): un esmeralda suave en vez del verde azulado de antes,
 * con fondos apenas teñidos de verde. El primario (#0a7f55) pasa AA con texto
 * blanco encima; los cinco tonos de estado (verde, ambar, rojo, azul, gris)
 * pasan AA como texto sobre su fondo "suave" y sobre blanco.
 *
 * Modo noche: por defecto sigue al sistema (prefers-color-scheme), y se puede
 * fijar a mano con el boton de la barra de arriba: `data-tema="oscuro"` o
 * `"claro"` en <html>, guardado en localStorage ('gsg-tema'). `TEMA_SCRIPT` lo
 * aplica en el <head>, antes de pintar, para que no parpadee.
 */

/** Los valores del modo noche: se usan en el automatico y en el forzado. */
const OSCURO = `
    color-scheme: dark;
    --bg: #0b1210; --superficie: #111a17; --superficie-2: #18231f;
    --texto: #e6efe9; --texto-suave: #9db0a7; --borde: #243129;
    --primario: #3ecf8e; --primario-texto: #04241a; --primario-suave: rgba(62,207,142,.15);
    --primario-hover: #5ad9a1;
    --verde: #4ade80; --verde-suave: rgba(74,222,128,.14);
    --ambar: #fbbf24; --ambar-suave: rgba(251,191,36,.16);
    --rojo: #f87171; --rojo-suave: rgba(248,113,113,.16);
    --azul: #60a5fa; --azul-suave: rgba(96,165,250,.16);
    --gris: #b3bdb8; --gris-suave: rgba(255,255,255,.07); --gris-claro: #6b7a73;
    --sombra: 0 1px 2px rgba(0,0,0,.45); --sombra-2: 0 12px 32px rgba(0,0,0,.55);
`;

export const TOKENS_CSS = `
  /* ==== El sistema visual: una sola paleta, una sola escala ==================
     Todas las pantallas usan estas variables. Los nombres viejos (--accent,
     --panel, --line, --s-*) siguen existiendo como alias para no romper nada. */
  :root {
    color-scheme: light;
    --bg: #f3f7f5; --superficie: #ffffff; --superficie-2: #eef4f1;
    --texto: #13201b; --texto-suave: #5a6b64; --borde: #dde7e2;
    --primario: #0a7f55; --primario-texto: #ffffff; --primario-suave: #e2f4ea;
    --primario-hover: #086a47;
    --verde: #15803d; --verde-suave: #e3f5e9;
    --ambar: #b45309; --ambar-suave: #fdf1df;
    --rojo: #b91c1c; --rojo-suave: #fde8e8;
    --azul: #1d4ed8; --azul-suave: #e4ecfd;
    --gris: #4b5563; --gris-suave: #edf1ef; --gris-claro: #9aa8a1;
    --radio: 14px; --radio-sm: 9px;
    --sombra: 0 1px 2px rgba(16,40,30,.05), 0 1px 3px rgba(16,40,30,.04);
    --sombra-2: 0 12px 32px rgba(16,40,30,.12);
    --esp-1: 4px; --esp-2: 8px; --esp-3: 12px; --esp-4: 16px; --esp-5: 24px; --esp-6: 32px;
    --fuente: "Inter", "Segoe UI Variable Text", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --fs-h1: 22px; --fs-h2: 17px; --fs-h3: 14.5px; --fs-cuerpo: 14.5px; --fs-small: 12.5px;
    /* alias de los nombres que ya usaban las paginas */
    --accent: var(--primario); --accent-ink: var(--primario-texto); --accent-soft: var(--primario-suave);
    --ok: var(--verde); --warn: var(--ambar); --bad: var(--rojo); --info: var(--azul);
    --panel: var(--superficie); --card: var(--superficie); --chip: var(--superficie-2);
    --line: var(--borde); --text: var(--texto); --muted: var(--texto-suave);
    --s-side: var(--superficie); --s-line: var(--borde); --s-bg: var(--bg); --s-text: var(--texto); --s-muted: var(--texto-suave);
    --s-accent: var(--primario); --s-accent-soft: var(--primario-suave); --s-top: var(--superficie); --s-hover: var(--superficie-2);
    --s-kbd: var(--superficie-2); --s-sombra: var(--sombra);
  }
  /* Automatico: sigue al sistema, salvo que el usuario haya fijado el claro. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-tema="claro"]) {${OSCURO}}
  }
  /* Fijado a mano con el boton de la barra de arriba. */
  :root[data-tema="oscuro"] {${OSCURO}}
  /* El cambio de tema no da un salto: los colores pasan suave. */
  body, .card, .tarjeta, .s-side, .s-top { transition: background-color .2s ease, border-color .2s ease, color .2s ease; }
`;

/**
 * Va en el <head> de cada pagina, antes de pintar: aplica el tema guardado
 * para que una pagina en modo noche no se vea blanca un instante.
 */
export const TEMA_SCRIPT = `<script>try{var t=localStorage.getItem('gsg-tema');if(t==='oscuro'||t==='claro')document.documentElement.setAttribute('data-tema',t);}catch(e){}</script>`;
