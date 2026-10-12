/**
 * La pagina que ve una persona en el navegador cuando algo falla (404 de una
 * pantalla que no existe, 401, 402). La API sigue contestando JSON con la
 * forma de src/api/errores.ts; esto es solo para quien pide HTML.
 */

import { NOMBRE_SISTEMA } from '../marca.js';
import { escapeHtml } from './login-page.js';
import { TEMA_SCRIPT, TOKENS_CSS } from './tokens.js';

const TITULOS: Record<number, string> = {
  400: 'La solicitud no es válida',
  401: 'Tienes que entrar',
  402: 'Tu membresía no cubre esto',
  403: 'No tienes permiso',
  404: 'Esta página no existe',
};

const ENLACE: Record<number, { href: string; texto: string }> = {
  401: { href: '/login', texto: 'Entrar' },
  402: { href: '/panel#configuracion', texto: 'Ver la membresía' },
};

export function paginaError(status: number, mensaje: string, codigo?: string): string {
  const titulo = TITULOS[status] ?? 'Algo salió mal';
  const enlace = ENLACE[status] ?? { href: '/panel', texto: 'Volver al panel' };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${status} · ${escapeHtml(titulo)} · ${escapeHtml(NOMBRE_SISTEMA)}</title>${TEMA_SCRIPT}
<style>${TOKENS_CSS}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:var(--bg,#f6f7f6);color:var(--texto,#17201d)}main{max-width:440px;padding:24px;text-align:center}.status{font-size:56px;font-weight:700;margin:0;opacity:.35}h1{margin:.2em 0 .4em;font-size:22px}code{font-size:13px;opacity:.7}a{color:var(--primario,#0b7a4b);font-weight:600}</style></head>
<body><main data-status="${status}"><p class="status">${status}</p><h1>${escapeHtml(titulo)}</h1><p>${escapeHtml(mensaje)}</p>${codigo ? `<p><code>${escapeHtml(codigo)}</code></p>` : ''}<p><a href="${enlace.href}">${enlace.texto}</a></p></main></body></html>`;
}
