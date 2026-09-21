/**
 * El sistema visual de GSGchat: una sola paleta, una sola escala.
 *
 * Todas las pantallas (las del armazon y las sueltas, como el login) pintan
 * con estas variables. Los nombres viejos que ya usaban las paginas
 * (--accent, --panel, --line, --s-*) siguen existiendo como alias, asi nada
 * se rompe mientras cada pantalla se pasa a los nombres nuevos.
 *
 * Contraste: los cinco tonos (verde, ambar, rojo, azul, gris) estan elegidos
 * para pasar AA como texto sobre su fondo "suave" y sobre blanco.
 */
export const TOKENS_CSS = `
  /* ==== El sistema visual: una sola paleta, una sola escala ==================
     Todas las pantallas usan estas variables. Los nombres viejos (--accent,
     --panel, --line, --s-*) siguen existiendo como alias para no romper nada. */
  :root {
    color-scheme: light dark;
    --bg: #f4f6f8; --superficie: #ffffff; --superficie-2: #f2f4f7;
    --texto: #16181d; --texto-suave: #5b6472; --borde: #e2e5ea;
    --primario: #0f766e; --primario-texto: #ffffff; --primario-suave: #e3f3f0;
    --verde: #15803d; --verde-suave: #e3f5e9;
    --ambar: #b45309; --ambar-suave: #fdf1df;
    --rojo: #b91c1c; --rojo-suave: #fde8e8;
    --azul: #1d4ed8; --azul-suave: #e4ecfd;
    --gris: #4b5563; --gris-suave: #edf0f3; --gris-claro: #9aa3b2;
    --radio: 12px; --radio-sm: 8px;
    --sombra: 0 1px 2px rgba(16,24,40,.06); --sombra-2: 0 10px 28px rgba(16,24,40,.12);
    --esp-1: 4px; --esp-2: 8px; --esp-3: 12px; --esp-4: 16px; --esp-5: 24px; --esp-6: 32px;
    --fuente: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
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
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1114; --superficie: #161a1f; --superficie-2: #1f242b;
      --texto: #eef0f3; --texto-suave: #a4abb6; --borde: #2a3038;
      --primario: #2dbba5; --primario-texto: #06201c; --primario-suave: rgba(45,187,165,.16);
      --verde: #4ade80; --verde-suave: rgba(74,222,128,.14);
      --ambar: #fbbf24; --ambar-suave: rgba(251,191,36,.16);
      --rojo: #f87171; --rojo-suave: rgba(248,113,113,.16);
      --azul: #60a5fa; --azul-suave: rgba(96,165,250,.16);
      --gris: #b3bac5; --gris-suave: rgba(255,255,255,.08); --gris-claro: #6b7280;
      --sombra: 0 1px 2px rgba(0,0,0,.4); --sombra-2: 0 10px 28px rgba(0,0,0,.5);
    }
  }
`;
