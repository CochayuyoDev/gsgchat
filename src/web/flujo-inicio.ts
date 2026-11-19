/**
 * El flujo completo de GSGchat dibujado arriba del Inicio, al estilo de un
 * editor de flujos: lienzo oscuro punteado, nodos con su icono, el nombre
 * debajo, líneas curvas entre puertos, nodos auxiliares en círculo unidos
 * con línea punteada, se arrastra, se acerca/aleja y va a pantalla completa.
 * Lee /admin/flujo (src/admin/flujo-routes.ts) y los ajustes del reparto.
 *
 * Plegado se ve la línea principal y sus auxiliares:
 *   GSG manda pedidos → Revisar número y tracking → Confirmar y enviar → Cola de envío
 *     → 1.er mensaje → Estado en WhatsApp → ¿Qué responde?
 *   (Tu empresa, Líneas de WhatsApp, IA, Número reportado → Reporte a GSG)
 * Con «Desplegar todo» aparecen las ramas:
 *   Ubicación: Ubicación recibida → (¿Es ahí?) → 2.º mensaje → Ubicación a GSG → GSG la tiene; Cambia su ubicación
 *   Otra cosa: Responde sin ubicación → Conversación directa → 2.º mensaje desde el chat (vuelve a Ubicación)
 *   Nada:      Insiste solo → ¿Agotó los intentos? → Pasa a una persona → Reporte a GSG
 * Tocar un nodo abre su detalle (qué hace, cifras de hoy y a qué pantalla ir).
 */

const SVG: Record<string, string> = {
  empresa: '<path d="M3 21h18"/><path d="M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16"/><path d="M15 9h3a1 1 0 0 1 1 1v11"/><path d="M8 8h1M11 8h1M8 12h1M11 12h1M8 16h1M11 16h1"/>',
  whatsapp: '<path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2.2-1-1 .8a4.5 4.5 0 0 1-2.5-2.5l.8-1-1-2.2z"/>',
  caja: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  escudo: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  manita: '<path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M10 10V4.5a1.5 1.5 0 0 1 3 0V10"/><path d="M13 10V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a7 7 0 0 1-5.6-2.8L3.4 15a1.6 1.6 0 0 1 2.4-2.1L7 14"/>',
  cola: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2"/>',
  mensaje: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4"/>',
  doble: '<path d="M2 13l4 4 8-9"/><path d="M10 15.5l1.5 1.5 8.5-9"/>',
  si_no: '<path d="M4 6h6l4 6-4 6H4"/><path d="M14 12h6"/><path d="M17 9l3 3-3 3"/>',
  switch: '<path d="M4 12h5"/><path d="M9 12c3 0 3-6 6-6h5"/><path d="M9 12h11"/><path d="M9 12c3 0 3 6 6 6h5"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  pregunta: '<path d="M12 2.8l9.2 9.2-9.2 9.2L2.8 12z"/><path d="M10 10a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5"/><path d="M12 16.2v.1"/>',
  envio: '<path d="M4 12h12"/><path d="M12 6l6 6-6 6"/><path d="M20 4v16"/>',
  bandera: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  cambio: '<path d="M17 3l3 3-3 3"/><path d="M20 6H9a5 5 0 0 0-5 5"/><path d="M7 21l-3-3 3-3"/><path d="M4 18h11a5 5 0 0 0 5-5"/>',
  sinpin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 11.9-5"/><path d="M19 9.5c0 1.4-.4 2.8-1.1 4.1"/><path d="M15 3l6 6M21 3l-6 6"/>',
  persona: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 11.5h5M16 15h3.5"/><path d="M16 8h5"/>',
  responder: '<path d="M9 8L4 12l5 4"/><path d="M4 12h9a7 7 0 0 1 7 7"/>',
  reloj: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alerta_t: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5v.1"/>',
  telefono: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/><path d="M16 3l5 5M21 3l-5 5"/>',
  robot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4"/><circle cx="12" cy="3.5" r="1"/><path d="M9 13h.01M15 13h.01"/><path d="M9.5 16.5h5"/>',
  rayo: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  queja: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M12 8v4.5"/><path d="M12 15.5v.1"/>',
  novedades: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alerta: '<path d="M12 8v5"/><path d="M12 16.5v.1"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  menos: '<path d="M5 12h14"/>',
  encajar: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  completa: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  cerrar: '<path d="M6 6l12 12M18 6L6 18"/>',
  ir: '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>',
};
const ico = (n: string, ancho = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${ancho}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[n]}</svg>`;

export const FLUJO_CSS = `
/* ---------- El flujo de GSGchat (arriba del Inicio), estilo editor de flujos ---------- */
.fl{--fl-lienzo:#2a2b2e;--fl-punto:#46484d;--fl-nodo:#3f4044;--fl-borde:#76787e;--fl-txt:#ececec;--fl-sub:#a3a5ab;--fl-linea:#8d9096;--fl-ok:#3ecf8e;--fl-mal:#ff6d5a;--fl-ambar:#f5b84a;--fl-barra:#252629;--fl-filo:#1c1d20;
  position:relative;border-radius:var(--radio);overflow:hidden;border:1px solid var(--fl-filo);background:var(--fl-lienzo);box-shadow:var(--sombra);color:var(--fl-txt)}
.fl:fullscreen{border-radius:0;display:flex;flex-direction:column}
.fl:fullscreen .fl-marco{flex:1;height:auto!important}
.fl-cab{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid var(--fl-filo);background:var(--fl-barra)}
.fl-cab h2{margin:0;font-size:16px;color:var(--fl-txt)}.fl-cab p{margin:1px 0 0;font-size:12.5px;color:var(--fl-sub)}
.fl-cab-ico{flex:none;width:34px;height:34px;border-radius:8px;display:grid;place-items:center;background:#ff6d5a22;color:var(--fl-mal)}
.fl-cab-ico svg{width:18px;height:18px}
.fl-acciones{margin-left:auto;display:flex;align-items:center;gap:12px}
.fl-hora{font-size:12px;color:var(--fl-sub);white-space:nowrap}
.fl-boton{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;border:1px solid var(--fl-borde);background:var(--fl-nodo);color:var(--fl-txt);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.fl-boton:hover{border-color:var(--fl-txt)}.fl-boton:focus-visible,.fl-herr button:focus-visible,.fl-nodo:focus-visible{outline:2px solid var(--fl-ok);outline-offset:2px}
.fl-boton svg{width:16px;height:16px;transition:transform .2s}.fl[data-abierto="1"] #flujo-boton svg{transform:rotate(180deg)}
.fl-nov b{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;box-sizing:border-box;border-radius:999px;background:var(--fl-mal);color:#fff;font-size:11.5px}
.fl-nov.sin b{background:#ffffff1f;color:var(--fl-sub)}
/* Los casos concretos: un cliente por fila, abre su chat. */
.fl-casos{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.fl-caso{display:grid;gap:3px;padding:9px 11px;border:1px solid #3a3b3f;border-radius:8px;background:#26272a;color:#d6d7db;text-decoration:none}
.fl-caso:hover{border-color:var(--fl-borde);background:#2c2d31}.fl-caso:focus-visible{outline:2px solid var(--fl-ok);outline-offset:1px}
.fl-caso-cab{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:13px}.fl-caso-cab b{color:var(--fl-txt)}
.fl-trk{font-family:var(--mono,monospace);font-size:11.5px;padding:0 6px;border-radius:4px;background:#ffffff12;color:var(--fl-sub)}
.fl-caso-cab time{margin-left:auto;font-size:12px;color:var(--fl-sub);font-variant-numeric:tabular-nums}
.fl-caso-det{font-size:12.5px;line-height:1.45;color:#b9bbc1}
.fl-tipo{font-style:normal;font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px}.fl-tipo.mal{background:#ff6d5a26;color:var(--fl-mal)}.fl-tipo.ambar{background:#f5b84a26;color:var(--fl-ambar)}
.fl-n{display:inline-block;margin-left:4px;padding:0 6px;border-radius:999px;background:#ffffff14;color:var(--fl-txt);letter-spacing:0}
.fl-vacio{margin:0 0 8px!important;font-size:12.5px!important;color:var(--fl-sub)!important}
.fl-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}.fl-chips button{padding:4px 10px;border-radius:999px;border:1px solid #3a3b3f;background:#26272a;color:#d6d7db;font:inherit;font-size:12px;cursor:pointer}
.fl-chips button[aria-pressed=true]{border-color:var(--fl-txt);color:var(--fl-txt);background:#34353a}.fl-chips button.mal{color:var(--fl-mal)}.fl-chips button.ambar{color:var(--fl-ambar)}
/* El lienzo: puntos como el de un editor de flujos; se arrastra para moverlo. */
.fl-marco{position:relative;overflow:hidden;background-color:var(--fl-lienzo);background-image:radial-gradient(var(--fl-punto) 1.1px,transparent 1.2px);background-size:22px 22px;cursor:grab;touch-action:pan-y;transition:height .3s ease;user-select:none}
.fl-marco.arrastrando{cursor:grabbing}
.fl-lienzo{position:absolute;top:0;left:0;transform-origin:0 0}
.fl-lineas{position:absolute;top:0;left:0;overflow:visible;pointer-events:none}
.fl-lineas path{fill:none;stroke:var(--fl-linea);stroke-width:2}
.fl-lineas path.ok{stroke:var(--fl-ok)}.fl-lineas path.ambar{stroke:var(--fl-ambar)}.fl-lineas path.mal{stroke:var(--fl-mal)}
.fl-lineas path.anda{stroke-dasharray:7 7;animation:fl-corre 1.2s linear infinite}
.fl-lineas path.sub{stroke:#8d909699;stroke-dasharray:5 5;stroke-width:1.6}
.fl-lineas path.vuelta{stroke-dasharray:3 6}
.fl-lineas .punta{fill:var(--fl-linea);stroke:none}.fl-lineas .punta.ok{fill:var(--fl-ok)}.fl-lineas .punta.ambar{fill:var(--fl-ambar)}.fl-lineas .punta.mal{fill:var(--fl-mal)}
.fl-lineas .puerto{fill:#c9cbd0;stroke:none}.fl-lineas .rombo{fill:#8d9096;stroke:none}
.fl-lineas text{fill:var(--fl-sub);font-size:11px;font-family:inherit}.fl-lineas text.ok{fill:var(--fl-ok)}.fl-lineas text.ambar{fill:var(--fl-ambar)}.fl-lineas text.mal{fill:var(--fl-mal)}
@keyframes fl-corre{to{stroke-dashoffset:-14}}
/* La cantidad sobre una línea, como «3 items». */
.fl-cuenta{position:absolute;transform:translate(-50%,-50%);padding:1px 7px;border-radius:999px;background:#1f2023;border:1px solid #3a3b3f;font-size:11.5px;font-weight:600;color:var(--fl-txt);white-space:nowrap;pointer-events:none}
.fl-cuenta.ok{color:var(--fl-ok)}.fl-cuenta.ambar{color:var(--fl-ambar)}.fl-cuenta.mal{color:var(--fl-mal)}
/* Un nodo: el cuadro con su icono y, debajo, el nombre y un detalle. */
.fl-nodo{position:absolute;width:var(--t);height:var(--h,var(--t));padding:0;border:0;background:none;color:var(--fl-txt);font:inherit;cursor:pointer;text-align:center}
.fl-caja{position:relative;display:grid;place-items:center;width:var(--t);height:var(--h,var(--t));box-sizing:border-box;border:2px solid var(--fl-borde);border-radius:10px;background:var(--fl-nodo);transition:border-color .15s,box-shadow .15s}
.fl-caja>svg{width:44%;height:44%;color:var(--c,#cfd1d6)}
.fl-nodo.disparo .fl-caja{border-radius:42px 10px 10px 42px}
.fl-nodo.circulo .fl-caja{border-radius:50%;background:#1f2023}
.fl-nodo.ancho{width:var(--a)}.fl-nodo.ancho .fl-caja{width:var(--a);grid-template-columns:auto 1fr;gap:12px;justify-items:start;padding:0 16px;text-align:left}
.fl-nodo.ancho .fl-caja>svg{width:30px;height:30px}
.fl-nodo:hover .fl-caja,.fl-nodo.elegido .fl-caja{border-color:var(--fl-txt);box-shadow:0 0 0 4px #ffffff14}
.fl-nodo[data-tono=ok] .fl-caja{border-color:var(--fl-ok)}.fl-nodo[data-tono=mal] .fl-caja{border-color:var(--fl-mal)}.fl-nodo[data-tono=ambar] .fl-caja{border-color:var(--fl-ambar)}
.fl-nodo.elegido .fl-caja{box-shadow:0 0 0 4px #ffffff26}
.fl-marca{position:absolute;right:-9px;bottom:-9px;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:var(--fl-lienzo);color:var(--fl-ok)}
.fl-marca svg{width:16px;height:16px}
.fl-nodo[data-tono=mal] .fl-marca{background:var(--fl-mal);color:#fff}.fl-nodo[data-tono=ambar] .fl-marca{background:var(--fl-ambar);color:#1f2023}
.fl-nodo[data-tono=mal] .fl-marca svg,.fl-nodo[data-tono=ambar] .fl-marca svg{width:14px;height:14px}
.fl-rayo{position:absolute;left:-30px;top:50%;width:20px;height:20px;margin-top:-10px;color:var(--fl-mal)}
.fl-nombre{position:absolute;top:calc(100% + 8px);left:50%;width:180px;margin-left:-90px;font-size:13.5px;font-weight:600;line-height:1.25;color:var(--fl-txt)}
.fl-sub{display:block;margin-top:3px;font-size:11.5px;font-weight:400;color:var(--fl-sub);line-height:1.35}
.fl-sub b{color:var(--fl-txt);font-weight:600}.fl-sub .mal{color:var(--fl-mal)}.fl-sub .ok{color:var(--fl-ok)}.fl-sub .ambar{color:var(--fl-ambar)}
/* La etiqueta de cada rama a la izquierda. */
.fl-rama{position:absolute;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700;letter-spacing:.02em;white-space:nowrap;transform:translateY(-50%)}
.fl-rama.ok{background:#3ecf8e26;color:var(--fl-ok)}.fl-rama.ambar{background:#f5b84a26;color:var(--fl-ambar)}.fl-rama.gris{background:#ffffff14;color:var(--fl-sub)}.fl-rama.mal{background:#ff6d5a26;color:var(--fl-mal)}
.fl-mas{position:absolute;width:18px;height:18px;margin:-9px 0 0 0;border:1.5px solid var(--fl-linea);border-radius:4px;display:grid;place-items:center;color:var(--fl-sub);font-size:14px;line-height:1;background:var(--fl-lienzo)}
.fl-oculto{opacity:0;visibility:hidden;pointer-events:none}
.fl-anima{transition:opacity .3s ease,visibility .3s}
/* Las herramientas del lienzo: abajo a la izquierda. */
.fl-herr{position:absolute;left:12px;bottom:12px;display:flex;gap:6px;z-index:2}
.fl-herr button{width:34px;height:34px;display:grid;place-items:center;border-radius:8px;border:1px solid var(--fl-borde);background:var(--fl-nodo);color:var(--fl-txt);cursor:pointer;padding:0}
.fl-herr button:hover{border-color:var(--fl-txt)}.fl-herr svg{width:17px;height:17px}
.fl-herr button.fl-texto{width:auto;padding:0 11px;font:inherit;font-size:12.5px;font-weight:600}.fl-herr button[hidden]{display:none}
.fl-guardado{align-self:center;font-size:12px;color:var(--fl-sub);padding:0 4px;white-space:nowrap}.fl-guardado.mal{color:var(--fl-mal)}
/* Ordenar a gusto: el administrador toma un cuadro y lo suelta donde quiera. */
.fl[data-ordenar="1"] .fl-nodo{touch-action:none;cursor:grab}
.fl-marco.moviendo,.fl-marco.moviendo .fl-nodo{cursor:grabbing}
.fl-nodo.levantado{z-index:2}.fl-nodo.levantado .fl-caja{border-color:var(--fl-txt);box-shadow:0 12px 26px #0009,0 0 0 4px #ffffff26}
.fl-zoom{position:absolute;right:12px;bottom:12px;z-index:2;font-size:11.5px;color:var(--fl-sub);background:#1f2023cc;padding:3px 8px;border-radius:6px}
/* El detalle de un nodo: un panel a la derecha, como al abrir un nodo. */
.fl-panel{position:absolute;top:0;right:0;bottom:0;width:min(360px,92%);z-index:3;background:#1f2023;border-left:1px solid #3a3b3f;box-shadow:-12px 0 30px #0006;display:flex;flex-direction:column;transform:translateX(105%);visibility:hidden;transition:transform .25s ease,visibility .25s;cursor:auto;user-select:text}
.fl-panel.abierto{transform:none;visibility:visible}
.fl-panel-cab{display:flex;align-items:center;gap:12px;padding:16px;border-bottom:1px solid #3a3b3f}
.fl-panel-ico{flex:none;width:42px;height:42px;border-radius:10px;display:grid;place-items:center;background:var(--fl-nodo);border:2px solid var(--fl-borde);color:var(--c,#cfd1d6)}
.fl-panel-ico svg{width:22px;height:22px}
.fl-panel-cab h3{margin:0;font-size:15px;color:var(--fl-txt)}.fl-panel-cab small{display:block;color:var(--fl-sub);font-size:12px;margin-top:2px}
.fl-panel-cerrar{margin-left:auto;flex:none;width:32px;height:32px;display:grid;place-items:center;border-radius:8px;border:0;background:transparent;color:var(--fl-sub);cursor:pointer}
.fl-panel-cerrar:hover{background:#ffffff14;color:var(--fl-txt)}.fl-panel-cerrar svg{width:18px;height:18px}
.fl-panel-cuerpo{flex:1;overflow:auto;padding:14px 16px 18px}
.fl-panel-cuerpo p{margin:0 0 14px;font-size:13.5px;line-height:1.55;color:#d6d7db}
.fl-panel-cuerpo h4{margin:16px 0 8px;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fl-sub)}
.fl-filas{list-style:none;margin:0;padding:0;border:1px solid #3a3b3f;border-radius:8px;overflow:hidden}
.fl-filas li{display:flex;justify-content:space-between;gap:12px;padding:9px 12px;font-size:13px;color:#d6d7db;border-top:1px solid #2f3034}
.fl-filas li:first-child{border-top:0}.fl-filas b{color:var(--fl-txt);font-variant-numeric:tabular-nums;text-align:right}
.fl-filas b.ok{color:var(--fl-ok)}.fl-filas b.mal{color:var(--fl-mal)}.fl-filas b.ambar{color:var(--fl-ambar)}
.fl-panel-ir{display:flex;align-items:center;justify-content:center;gap:8px;margin:16px;padding:11px 14px;border-radius:8px;background:var(--fl-ok);color:#10261b;font-weight:700;font-size:13.5px;text-decoration:none}
.fl-panel-ir:hover{filter:brightness(1.08)}.fl-panel-ir svg{width:16px;height:16px}
.fl-pie{margin:0;padding:10px 18px 12px;font-size:12px;color:var(--fl-sub);border-top:1px solid var(--fl-filo);background:var(--fl-barra)}
.fl-pie kbd{font:inherit;padding:0 5px;border:1px solid #3a3b3f;border-radius:4px;background:#1f2023}
.fl-error{margin:16px;padding:12px 14px;border-radius:8px;background:#ff6d5a22;color:var(--fl-mal)}
@media(max-width:640px){.fl-cab{padding:12px 14px}.fl-hora{display:none}.fl-acciones{margin-left:0;width:100%}.fl-boton{flex:1;justify-content:center}.fl-panel{width:100%}}
@media(prefers-reduced-motion:reduce){.fl-lineas path.anda{animation:none}.fl-marco,.fl-anima,.fl-boton svg,.fl-panel{transition:none}}
`;

export const FLUJO_HTML = `<section class="fl" id="flujo-gsg" data-abierto="0" aria-labelledby="flujo-titulo">
<div class="fl-cab"><span class="fl-cab-ico" aria-hidden="true">${ico('rayo')}</span><div><h2 id="flujo-titulo">Flujo de GSGchat</h2><p>El recorrido completo de cada pedido: de GSG a tu WhatsApp, la respuesta del cliente y lo que vuelve a GSG.</p></div><div class="fl-acciones"><span class="fl-hora" id="flujo-hora"></span><button type="button" class="fl-boton fl-nov" id="flujo-novedades" aria-controls="flujo-panel">${ico('novedades')}<span id="flujo-novedades-txt">Novedades de hoy</span></button><button type="button" class="fl-boton" id="flujo-boton" aria-expanded="false" aria-controls="flujo-marco"><span id="flujo-boton-txt">Desplegar todo</span>${ico('chevron')}</button></div></div>
<div class="fl-marco" id="flujo-marco"><div class="fl-lienzo" id="flujo-lienzo" aria-live="polite"><p style="margin:24px;color:#a3a5ab">Dibujando el flujo…</p></div>
<div class="fl-herr" role="toolbar" aria-label="Mover el flujo"><button type="button" id="flujo-encajar" title="Encajar todo" aria-label="Encajar todo">${ico('encajar')}</button><button type="button" id="flujo-acercar" title="Acercar" aria-label="Acercar">${ico('mas')}</button><button type="button" id="flujo-alejar" title="Alejar" aria-label="Alejar">${ico('menos')}</button><button type="button" id="flujo-completa" title="Pantalla completa" aria-label="Pantalla completa">${ico('completa')}</button><button type="button" class="fl-texto" id="flujo-restablecer" title="Devolver cada cuadro a su sitio de fábrica" hidden>Restablecer orden</button><span class="fl-guardado" id="flujo-guardado" role="status" aria-live="polite"></span></div>
<span class="fl-zoom" id="flujo-zoom" aria-hidden="true"></span>
<aside class="fl-panel" id="flujo-panel" aria-label="Detalle del paso" aria-hidden="true"></aside></div>
<p class="fl-pie" id="flujo-pie">Toca un paso para ver su detalle. Arrastra para mover; <kbd>Ctrl</kbd> + rueda para acercar.</p>
</section>`;

/**
 * El script del diagrama. Se ejecuta dentro del IIFE del panel (usa sus `api`,
 * `esc` y `$`) y deja `cargarFlujo()` para que Inicio lo llame.
 */
export const FLUJO_SCRIPT = String.raw`
var FL_ICO=${JSON.stringify(Object.fromEntries(Object.keys(SVG).map((k) => [k, ico(k)])))};
/* --- El lienzo: medidas fijas, con su vista (posición y zoom) --- */
var FL={ancho:1600,altoPlegado:440,altoAbierto:1430,t:84,c:72,vista:{x:0,y:0,k:1},nodos:{},datos:null,elegido:null,
 /* pos: dónde dejó el administrador cada cuadro movido (se guarda en la tienda); fabrica: el sitio de fábrica. */
 pos:{},fabrica:{},modelo:null,aj:null,puedeOrdenar:false,arrastrando:false,guardando:null,pendiente:false};
function flX(i){return 80+i*205;}
var FL_Y={a:70,sub:290,b:520,b2:640,c:850,c2:1020,d:1240};
var flAbierto=false;try{flAbierto=localStorage.getItem('gsgchat:flujo-desplegado')==='1';}catch(e){}
function flNumero(n){n=String(n||'').replace(/\D/g,'');if(!n)return '';if(n.length===11&&n.indexOf('51')===0)return '+51 '+n.slice(2,5)+' '+n.slice(5,8)+' '+n.slice(8);return '+'+n.replace(/(\d{3})(?=\d)/g,'$1 ').trim();}
function flPlural(n,uno,varios){n=n||0;return n+' '+(n===1?uno:varios);}
var FL_MOTIVOS={telefono_invalido:'Teléfono inválido',numero_corto:'Le faltan dígitos',numero_largo:'Le sobran dígitos',numero_fijo:'Teléfono fijo',sin_whatsapp:'Sin WhatsApp',numero_inaccesible:'Número inaccesible',envio_fallido:'No se pudo enviar',tracking_falta:'Falta el tracking',tracking_invalido:'Tracking inválido',tracking_duplicado:'Tracking repetido',tracking_de_otro_pedido:'Tracking de otro pedido',telefono_de_motorizado:'Es de un motorizado',no_soy_yo:'No es la persona'};
/* --- Geometría: puertos y caminos --- */
function flTam(n){return n.forma==='circulo'?FL.c:FL.t;}
function flAncho(n){return n.ancho||flTam(n);}
function flAlto(n){return n.alto||flTam(n);}
function flSalida(n,i){var k=(n.salidas&&n.salidas.length)||1;return {x:n.x+flAncho(n),y:n.y+flAlto(n)*(i+1)/(k+1)};}
function flEntrada(n){return {x:n.x,y:n.y+flAlto(n)/2};}
function flCurva(a,b){var dx=Math.max(40,Math.abs(b.x-a.x)/2);return 'M'+a.x+' '+a.y+' C'+(a.x+dx)+' '+a.y+' '+(b.x-dx)+' '+b.y+' '+b.x+' '+b.y;}
/* Un camino de tramos rectos con esquinas redondeadas (para las vueltas). */
function flTramos(p){var r=12,d='M'+p[0][0]+' '+p[0][1];for(var i=1;i<p.length-1;i++){var a=p[i-1],b=p[i],c=p[i+1];var l1=Math.hypot(b[0]-a[0],b[1]-a[1]),l2=Math.hypot(c[0]-b[0],c[1]-b[1]);var rr=Math.min(r,l1/2,l2/2);if(!rr){d+=' L'+b[0]+' '+b[1];continue;}var p1=[b[0]+(a[0]-b[0])*rr/l1,b[1]+(a[1]-b[1])*rr/l1],p2=[b[0]+(c[0]-b[0])*rr/l2,b[1]+(c[1]-b[1])*rr/l2];d+=' L'+p1[0]+' '+p1[1]+' Q'+b[0]+' '+b[1]+' '+p2[0]+' '+p2[1];}var u=p[p.length-1];return d+' L'+u[0]+' '+u[1];}
/* --- El modelo: qué nodos y qué líneas hay, con las cifras de hoy --- */
function flModelo(d,aj){
var c=d.cifras||{},pm=c.primerMensaje||{},r=c.respuesta||{},pi=c.esperandoPorIntento||{},wa=d.whatsapp||{lineas:[]},lineas=wa.lineas||[],emp=d.empresa||{},rep=d.reportes||null,plant=d.plantillas||{},msj=d.mensajes||{},rpt=d.reportados||{total:0,pendientes:0,corregidos:0,porMotivo:{}},motor=d.motor||{};
aj=aj||{};var esperas=aj.esperasMensajesMinutos||[],maxInt=aj.maxIntentos||0,horaI=aj.horaInicio,horaF=aj.horaFin,pausa=aj.pausaMinSegundos;
var Y=FL_Y,N=[],E=[];
function nodo(o){FL.nodos[o.id]=o;N.push(o);return o;}
function linea(o){E.push(o);}
var principal=lineas.filter(function(l){return l.principal;})[0]||lineas[0]||{tipo:'business',numero:'',conectada:false};
var hayApi=lineas.some(function(l){return l.tipo==='api';}),hayBiz=lineas.some(function(l){return l.tipo==='business';});
var nombreWa=hayApi&&hayBiz?'WhatsApp API y Business':principal.tipo==='api'?'WhatsApp API':'WhatsApp Business';
var gsgOk=d.gsg&&d.gsg.conectada,directa=c.conversacionDirecta||0,motivos=Object.keys(rpt.porMotivo||{});
var enviadasGsg=rep?rep.enviado||0:0,pendGsg=rep?(rep.pendiente||0)+(rep.atascado||0):0,fallGsg=rep?rep.fallido||0:0;
var faltaPlant=plant.hacenFalta&&!(plant.aprobadas||[]).length;
var cs=d.casos||{},nq=(cs.quejas||{}).total||0;
/* Fila principal */
nodo({id:'gsg',x:flX(0),y:Y.a,forma:'disparo',ico:'caja',color:'#f5b84a',tono:!d.disponible?'':gsgOk?'ok':'ambar',nombre:'GSG manda pedidos',sub:'<b>'+esc(c.recibidos||0)+'</b> hoy'+(c.cancelados?' · '+esc(c.cancelados)+' cancelados':''),
 info:{tipo:'Disparador',texto:'GSG envía los pedidos del día a GSGchat por la API (POST /api/v1/entregas). Cada pedido trae su tracking, el cliente y su teléfono. Con eso arranca todo el flujo.',filas:[['Pedidos de hoy',c.recibidos||0],['Ya traían la ubicación',c.yaConUbicacion||0],['Cancelados',c.cancelados||0],['GSG',gsgOk?'Conectado':'Sin conectar',gsgOk?'ok':'ambar']],href:'/api-gsgchat',ir:'Nuestra API'}});
nodo({id:'revisar',x:flX(1),y:Y.a,ico:'escudo',color:'#7c8cff',tono:rpt.pendientes?'ambar':'ok',nombre:'Revisar número y tracking',sub:rpt.total?'<span class="ambar">'+esc(flPlural(rpt.total,'reportado','reportados'))+'</span>':'Todo en orden',salidas:['bien','con problema'],
 info:{tipo:'Revisión',texto:'Antes de escribirle a nadie se revisa cada pedido: que el teléfono sea un celular con WhatsApp y que el tracking venga bien y no esté repetido. Lo que no pasa la revisión no se le escribe: se reporta a GSG con su motivo.',filas:[['Reportados hoy',rpt.total,rpt.total?'ambar':''],['Pendientes de corregir',rpt.pendientes,rpt.pendientes?'ambar':''],['Ya corregidos',rpt.corregidos,'ok']],href:'/hoy',ir:'Pedidos GSG'}});
nodo({id:'confirmar',x:flX(2),y:Y.a,ico:'manita',color:'#c48bff',tono:pm.retenidos?'ambar':'ok',nombre:'Confirmar y enviar',sub:d.confirmarLista?(pm.retenidos?'<span class="ambar"><b>'+esc(pm.retenidos)+'</b> por confirmar</span>':'Nada por confirmar'):'Automático',
 info:{tipo:'Aprobación',texto:d.confirmarLista?'Lo que llega de GSG espera a que alguien del equipo pulse «Confirmar y enviar» en Pedidos GSG. Hasta entonces no sale ningún mensaje.':'Está en automático: cada pedido revisado pasa solo a la cola de envío, sin esperar a nadie.',filas:[['Modo',d.confirmarLista?'Se confirma a mano':'Automático'],['Esperan confirmación',pm.retenidos||0,pm.retenidos?'ambar':'']],href:'/hoy',ir:'Pedidos GSG'}});
nodo({id:'cola',x:flX(3),y:Y.a,ico:'cola',color:'#5ab0ff',tono:motor.parado?'mal':pm.enCola?'ambar':'ok',nombre:'Cola de envío',sub:(pm.enCola?'<b>'+esc(pm.enCola)+'</b> en cola':'Vacía')+(horaI!=null?'<br>de '+esc(horaI)+':00 a '+esc(horaF)+':00':''),
 info:{tipo:'Ritmo',texto:'Los mensajes salen de uno en uno, dentro del horario de envío y con una pausa entre cada uno para cuidar el número. Fuera del horario esperan en la cola y salen solos al abrir.',filas:[['En cola ahora',pm.enCola||0,pm.enCola?'ambar':''],['Horario',horaI!=null?horaI+':00 a '+horaF+':00':'—'],['Pausa entre mensajes',pausa!=null?pausa+' s':'—'],['Ahora',motor.parado?'Parado: '+motor.parado:motor.enHorario===false?'Fuera de horario':'Enviando',motor.parado?'mal':'ok']],href:'/automatizacion-gsg#ajustes',ir:'Ajustes de envío'}});
nodo({id:'primero',x:flX(4),y:Y.a,ico:'mensaje',color:'#5ab0ff',tono:pm.fallidos||faltaPlant?'mal':pm.enviados?'ok':'',nombre:'1.er mensaje',sub:'plantilla GSG · <b>'+esc(pm.enviados||0)+'</b> enviados'+(pm.fallidos?'<br><span class="mal">'+esc(pm.fallidos)+' no salieron</span>':''),salidas:['enviado','no salió'],
 info:{tipo:'Mensaje',texto:'El primer mensaje al cliente: la plantilla de GSG con los datos de su envío, que le pide su ubicación con un botón.'+(plant.hacenFalta?' Con la API de Meta solo puede salir una plantilla aprobada.':'')+(pm.conTextoDeGsg?' Algunos pedidos traen el texto ya redactado por GSG y sale tal cual.':''),filas:[['Enviados',pm.enviados||0,'ok'],['En cola',pm.enCola||0],['No salieron',pm.fallidos||0,pm.fallidos?'mal':''],['Con el texto de GSG',pm.conTextoDeGsg||0],['Plantilla',plant.hacenFalta?((plant.aprobadas||[])[0]||'Falta una aprobada'):'La del sistema',faltaPlant?'mal':'']],href:'/automatizacion-gsg',ir:'Mensajes y plantillas'}});
nodo({id:'estado',x:flX(5),y:Y.a,ico:'doble',color:'#3ecf8e',tono:msj.fallidos?'ambar':msj.enviados?'ok':'',nombre:'Estado en WhatsApp',sub:'<b>'+esc(msj.entregados||0)+'</b> entregados · <b>'+esc(msj.leidos||0)+'</b> leídos',
 info:{tipo:'Seguimiento',texto:'WhatsApp avisa de cada mensaje: si salió, si llegó al teléfono y si el cliente lo leyó. Las cifras son de todos los mensajes de hoy.',filas:[['Enviados',msj.enviados||0],['Entregados',msj.entregados||0,'ok'],['Leídos',msj.leidos||0,'ok'],['Fallidos',msj.fallidos||0,msj.fallidos?'mal':'']],href:'/chat',ir:'Chats'}});
nodo({id:'responde',x:flX(6),y:Y.a-28,alto:140,ico:'switch',color:'#c48bff',tono:'',nombre:'¿Qué responde?',sub:'<b>'+esc(r.esperando||0)+'</b> aún no contestan',salidas:['ubicación','otra cosa','nada','no es la persona'],
 info:{tipo:'Decisión',texto:'Cada respuesta del cliente se lee y va por su camino: si manda su ubicación (pin, enlace de Maps o dirección escrita), si escribe otra cosa, si no contesta o si dice que no es esa persona.',filas:[['Mandaron su ubicación',r.si||0,'ok'],['Escribieron otra cosa',r.respondioSinUbicacion||0,'ambar'],['Aún no contestan',r.esperando||0],['No contestaron (se acabaron los intentos)',r.noContesto||0,r.noContesto?'ambar':''],['No es la persona',r.noEsLaPersona||0,r.noEsLaPersona?'mal':'']],href:'/hoy',ir:'Pedidos GSG'}});
/* Auxiliares (círculos) y la vía de los reportes */
nodo({id:'empresa',x:flX(0)+6,y:Y.sub,forma:'circulo',ico:'empresa',color:'#7c8cff',tono:'ok',nombre:emp.nombre||'Tu empresa',sub:'Cuenta'+(emp.usuarios?' · '+esc(flPlural(emp.usuarios,'usuario','usuarios')):''),
 info:{tipo:'Cuenta',texto:'Tu empresa en GSGchat: su nombre, su equipo y su propio WhatsApp. Cada tienda ve solo sus pedidos y sus chats.',filas:[['Nombre',emp.nombre||'—'],['Usuarios del equipo',emp.usuarios||0]],href:'/panel#usuarios',ir:'Usuarios'}});
nodo({id:'reportado',x:flX(1),y:Y.sub,ico:'telefono',color:'#ff6d5a',tono:rpt.pendientes?'mal':rpt.total?'ok':'',nombre:'Número reportado',sub:rpt.total?esc(motivos.slice(0,2).map(function(m){return (FL_MOTIVOS[m]||m)+' '+rpt.porMotivo[m];}).join(' · ')):'Ninguno hoy',
 info:{tipo:'Problema',texto:'Los pedidos que no se pueden atender por WhatsApp: teléfono inválido, fijo o sin WhatsApp, tracking que falta o se repite, el mensaje que no salió o el cliente que dice que no es él. Se reporta una sola vez y se marca corregido cuando GSG manda el dato bueno.',filas:motivos.length?motivos.map(function(m){return [FL_MOTIVOS[m]||m,rpt.porMotivo[m],'ambar'];}):[['Hoy','Sin números reportados','ok']],href:'/hoy',ir:'Pedidos GSG'}});
nodo({id:'reporte1',x:flX(2),y:Y.sub,ico:'bandera',color:'#ff8a65',tono:rpt.pendientes?'ambar':rpt.total?'ok':'',nombre:'Reporte a GSG',sub:rpt.total?'<b>'+esc(rpt.pendientes)+'</b> sin corregir':'Nada que reportar',
 info:{tipo:'Aviso a GSG',texto:'GSG recibe cada número con problema con su tracking y el motivo, para que corrija el contacto y vuelva a mandar el pedido.',filas:[['Reportados',rpt.total],['Sin corregir',rpt.pendientes,rpt.pendientes?'ambar':''],['Corregidos',rpt.corregidos,'ok']],href:'/conexion-gsg',ir:'Conexión con GSG'}});
nodo({id:'lineas',x:flX(3)+6,y:Y.sub,forma:'circulo',ico:'whatsapp',color:'#3ecf8e',tono:wa.conectado?'ok':'mal',nombre:nombreWa,sub:(principal.numero?esc(flNumero(principal.numero)):'Sin número todavía')+'<br>'+(wa.conectado?'<span class="ok">Conectado</span>':'<span class="mal">Sin conexión</span>')+(lineas.length>1?' · '+esc(flPlural(lineas.length,'línea','líneas')):''),
 info:{tipo:'Conexión',texto:'Las líneas de WhatsApp por las que salen los mensajes: la API oficial de Meta o WhatsApp Business vinculado con QR. Con varias líneas, cada cliente sigue siempre por la misma.',filas:lineas.map(function(l){return [(l.etiqueta||'WhatsApp')+' · '+(l.tipo==='api'?'API':'Business'),(l.numero?flNumero(l.numero):'sin número')+(l.conectada?' · conectada':' · sin conexión'),l.conectada?'ok':'mal'];}),href:'/setup',ir:'Conexión de WhatsApp'}});
nodo({id:'ia',x:flX(6)+6,y:Y.sub,forma:'circulo',ico:'robot',color:'#c48bff',tono:d.ia&&d.ia.activa?'ok':'',nombre:'Asistente IA',sub:d.ia?(d.ia.activa?'<span class="ok">Activa</span>':'Apagada'):'No disponible',
 info:{tipo:'Auxiliar',texto:'La IA ayuda a entender lo que escribe el cliente (por ejemplo, «quiero cambiar mi ubicación» o una consulta de su pedido) y le pone una nota a cada chat. No inventa nada ni le contesta por su cuenta.',filas:[['Estado',d.ia?(d.ia.activa?'Activa':'Apagada'):'No disponible',d.ia&&d.ia.activa?'ok':'']],href:'/panel#ia',ir:'Asistente IA'}});
nodo({id:'errorEnvio',x:flX(4),y:Y.sub,ico:'alerta_t',color:'#ff6d5a',tono:pm.fallidos?'mal':'',nombre:'Error al enviar',sub:pm.fallidos?'<span class="mal"><b>'+esc(pm.fallidos)+'</b> con error</span>':'Sin errores hoy',
 info:{tipo:'Error',texto:'Los mensajes que WhatsApp no aceptó o de los que no se sabe si llegaron, con su motivo exacto (número sin WhatsApp, plantilla sin aprobar, se cortó la red…). Los que no se arreglan insistiendo se reportan a GSG; los dudosos los revisa una persona en el chat antes de reenviar.',filas:[['Mensajes con error',pm.fallidos||0,pm.fallidos?'mal':'ok']],href:'/hoy',ir:'Pedidos GSG'}});
/* Rama: ubicación */
nodo({id:'ubicacion',x:flX(1),y:Y.b,ico:'pin',color:'#3ecf8e',tono:r.si?'ok':'',grupo:'abierto',nombre:'Ubicación recibida',sub:'<b>'+esc(r.si||0)+'</b> clientes',salidas:['pin o enlace','dirección escrita'],
 info:{tipo:'Ubicación',texto:'El cliente manda su pin de WhatsApp o un enlace de Google Maps (se toman las coordenadas exactas). Si escribe una dirección, se busca en el mapa y se le pregunta antes de registrarla.',filas:[['Mandaron su ubicación',r.si||0,'ok'],['Ya la traían de GSG',c.yaConUbicacion||0]],href:'/hoy',ir:'Pedidos GSG'}});
nodo({id:'esahi',x:flX(2),y:Y.b2,ico:'pregunta',color:'#f5b84a',tono:c.porConfirmarUbicacion?'ambar':'',grupo:'abierto',nombre:'¿Es ahí?',sub:c.porConfirmarUbicacion?'<b>'+esc(c.porConfirmarUbicacion)+'</b> esperan su sí':'Nadie esperando',salidas:['sí'],
 info:{tipo:'Confirmación',texto:'Con una dirección escrita o un pin dudoso se le muestra el punto del mapa y se le pregunta «¿es ahí?». Solo con su sí se registra; con un no, se le pide otra vez la ubicación.',filas:[['Esperan su respuesta',c.porConfirmarUbicacion||0,c.porConfirmarUbicacion?'ambar':'']],href:'/hoy',ir:'Pedidos GSG'}});
nodo({id:'segundo',x:flX(3),y:Y.b,ico:'doble',color:'#3ecf8e',tono:r.si?'ok':'',grupo:'abierto',nombre:'2.º mensaje',sub:'«Ubicación registrada»',
 info:{tipo:'Mensaje',texto:'Le confirma que su ubicación quedó registrada, con el mapa y el horario de entrega. Después el chat queda en silencio: solo se le contesta si pregunta por su pedido.',filas:[['Enviados hoy',r.si||0,'ok']],href:'/automatizacion-gsg#ajustes',ir:'Textos de los mensajes'}});
nodo({id:'agsg',x:flX(4),y:Y.b,ico:'envio',color:'#ff8a65',tono:!rep?'':fallGsg?'mal':pendGsg?'ambar':enviadasGsg?'ok':'',grupo:'abierto',nombre:'Ubicación a GSG',sub:rep?'<b>'+esc(enviadasGsg)+'</b> enviadas'+(pendGsg?' · <span class="ambar">'+esc(pendGsg)+' por enviar</span>':'')+(fallGsg?' · <span class="mal">'+esc(fallGsg)+' fallaron</span>':''):'Sin conexión con GSG',
 info:{tipo:'Envío a GSG',texto:'La ubicación sale hacia GSG con el tracking y las coordenadas. Si GSG no responde, se guarda y se reintenta sola; nada se pierde.',filas:rep?[['Enviadas',enviadasGsg,'ok'],['Por enviar',pendGsg,pendGsg?'ambar':''],['Fallaron',fallGsg,fallGsg?'mal':'']]:[['GSG','Sin conexión','ambar']],href:'/conexion-gsg',ir:'Conexión con GSG'}});
nodo({id:'listo',x:flX(5),y:Y.b,ico:'ok',color:'#3ecf8e',tono:enviadasGsg?'ok':'',grupo:'abierto',nombre:'GSG la tiene',sub:'Lista para el reparto',
 info:{tipo:'Fin',texto:'GSG ya tiene la ubicación del cliente para su reparto. Aquí termina el trabajo de GSGchat con ese pedido.',filas:[['Ubicaciones en GSG',enviadasGsg,'ok']],href:'/hoy',ir:'Pedidos GSG'}});
nodo({id:'cambia',x:flX(6),y:Y.b,ico:'cambio',color:'#f5b84a',tono:c.cambiaronUbicacion?'ambar':'',grupo:'abierto',nombre:'Cambia su ubicación',sub:'<b>'+esc(c.cambiaronUbicacion||0)+'</b> hoy',
 info:{tipo:'Corrección',texto:'Si el cliente escribe «quiero cambiar mi ubicación», se le pide el pin nuevo y se le manda a GSG como corrección. Las pantallas lo marcan como «cambió su ubicación».',filas:[['Cambiaron hoy',c.cambiaronUbicacion||0,c.cambiaronUbicacion?'ambar':'']],href:'/hoy',ir:'Pedidos GSG'}});
/* Rama: otra cosa */
nodo({id:'otra',x:flX(1),y:Y.c,ico:'sinpin',color:'#f5b84a',tono:r.respondioSinUbicacion?'ambar':'',grupo:'abierto',nombre:'Responde sin ubicación',sub:'<b>'+esc(r.respondioSinUbicacion||0)+'</b> escribieron otra cosa',salidas:['otra cosa','se queja'],
 info:{tipo:'Respuesta',texto:'El cliente escribe, manda una foto o un audio, pero no su ubicación. El bot se la vuelve a pedir y la IA le pone una nota al chat para que el equipo sepa qué pasó.',filas:[['Escribieron sin ubicación',r.respondioSinUbicacion||0,'ambar']],href:'/chat',ir:'Chats'}});
nodo({id:'chat',x:flX(2),y:Y.c,ico:'persona',color:'#f5b84a',tono:directa?'ambar':'',grupo:'abierto',nombre:'Conversación directa',sub:'<b>'+esc(d.chatsSinLeer||0)+'</b> chats sin leer',
 info:{tipo:'Persona',texto:'Una persona del equipo sigue el chat con el cliente desde Chats (GSG también puede verlo y escribir). Ahí se resuelve lo que el bot no puede.',filas:[['En conversación directa',directa,directa?'ambar':''],['Chats sin leer',d.chatsSinLeer||0,d.chatsSinLeer?'ambar':''],['Pedidos esperando a una persona',c.requierenPersona||0]],href:'/chat',ir:'Chats'}});
nodo({id:'chat2',x:flX(3),y:Y.c,ico:'responder',color:'#5ab0ff',tono:'',grupo:'abierto',nombre:'2.º mensaje desde el chat',sub:'Se le pide otra vez',
 info:{tipo:'Mensaje',texto:'Desde el chat se le escribe para pedirle otra vez la ubicación. En cuanto la manda, vuelve a la rama «ubicación» y sigue solo.',filas:[['Pendientes en chat',directa,directa?'ambar':'']],href:'/chat',ir:'Chats'}});
nodo({id:'queja',x:flX(2),y:Y.c2,ico:'queja',color:'#ff6d5a',tono:nq?'mal':'',grupo:'abierto',nombre:'Queja o reclamo',sub:nq?'<span class="mal"><b>'+esc(nq)+'</b> hoy</span>':'Ninguna hoy',
 info:{tipo:'Queja',texto:'Cuando el cliente se queja («pésimo servicio», «nunca llega», «quiero mi dinero»…), el bot no le contesta: se pausa en ese chat y pasa a una persona. También cuentan las notas «reclamo» que la IA o el equipo pusieron hoy.',filas:[['Quejas y reclamos hoy',nq,nq?'mal':'ok']],href:'/chat',ir:'Chats'}});
/* Rama: no contesta */
var cada=esperas.length?esperas.join(', ')+' min':'—';
nodo({id:'insiste',x:flX(1),y:Y.d,ico:'reloj',color:'#5ab0ff',tono:'',grupo:'abierto',nombre:'Insiste solo',sub:maxInt?'hasta '+esc(maxInt)+' mensajes':'Espera su respuesta',
 info:{tipo:'Espera',texto:'Si no contesta, se le vuelve a escribir solo, con la espera configurada entre un mensaje y el siguiente, hasta el máximo de mensajes.',filas:[['Esperas entre mensajes',cada],['Máximo de mensajes',maxInt||'—'],['Van en el 1.er mensaje',pi.uno||0],['Van en el 2.º',pi.dos||0],['Van en el 3.º o más',pi.tresOMas||0]],href:'/automatizacion-gsg#ajustes',ir:'Ajustes de envío'}});
nodo({id:'agoto',x:flX(2),y:Y.d,ico:'si_no',color:'#c48bff',tono:'',grupo:'abierto',nombre:'¿Agotó los intentos?',sub:'<b>'+esc(r.esperando||0)+'</b> todavía no',salidas:['sí','todavía no'],
 info:{tipo:'Decisión',texto:'Mientras le queden mensajes, se sigue esperando. Al agotarse, deja de escribirle y el pedido pasa a una persona.',filas:[['Todavía con intentos',r.esperando||0],['Agotaron los intentos',r.noContesto||0,r.noContesto?'ambar':'']],href:'/hoy',ir:'Pedidos GSG'}});
nodo({id:'persona',x:flX(3),y:Y.d,ico:'alerta_t',color:'#ff6d5a',tono:r.noContesto?'ambar':'',grupo:'abierto',nombre:'Pasa a una persona',sub:'<b>'+esc(r.noContesto||0)+'</b> no contestaron',
 info:{tipo:'Persona',texto:'El pedido queda marcado «No contestó» y aparece en «necesitan atención» para que alguien lo llame o lo revise.',filas:[['No contestaron',r.noContesto||0,r.noContesto?'ambar':'']],href:'/hoy?filtro=incidencia',ir:'Pedidos con incidencia'}});
nodo({id:'reporte2',x:flX(4),y:Y.d,ico:'bandera',color:'#ff8a65',tono:!rep?'':fallGsg?'mal':pendGsg?'ambar':'',grupo:'abierto',nombre:'Reporte a GSG',sub:'«No contestó»',
 info:{tipo:'Aviso a GSG',texto:'GSG recibe la incidencia con el tracking para decidir qué hacer con el pedido. Si después el cliente manda su ubicación fuera de plazo, ya no se registra.',filas:rep?[['Reportes enviados (todos)',enviadasGsg,'ok'],['Por enviar',pendGsg,pendGsg?'ambar':''],['Fallaron',fallGsg,fallGsg?'mal':'']]:[['GSG','Sin conexión','ambar']],href:'/conexion-gsg',ir:'Conexión con GSG'}});
/* Los casos concretos que enseña el detalle de cada paso. */
var CASOS={revisar:[['reportados','Números reportados']],confirmar:[['sinEnviar','Sin enviar todavía']],cola:[['sinEnviar','Sin enviar todavía']],primero:[['erroresEnvio','Con error'],['sinEnviar','Sin enviar todavía']],responde:[['noEsLaPersona','Dicen que no son la persona']],reportado:[['reportados','Reportados hoy']],reporte1:[['reportados','Reportados hoy']],errorEnvio:[['erroresEnvio','Con error'],['sinEnviar','Se reintentan o esperan']],ubicacion:[['ubicacionRecibida','Mandaron su ubicación']],esahi:[['porConfirmarUbicacion','Esperan su sí']],segundo:[['ubicacionRecibida','Recibieron «Ubicación registrada»']],cambia:[['cambiaronUbicacion','Cambiaron su ubicación']],otra:[['respondioSinUbicacion','Escribieron sin ubicación']],queja:[['quejas','Quejas y reclamos']],chat:[['requierenPersona','Esperan a una persona'],['quejas','Quejas']],chat2:[['respondioSinUbicacion','Pendientes de su ubicación']],insiste:[['esperando','Aún no contestan']],agoto:[['esperando','Aún no contestan']],persona:[['noContesto','No contestaron'],['quejas','Quejas']],reporte2:[['noContesto','Reportados «no contestó»']]};
N.forEach(function(n){if(CASOS[n.id]&&n.info)n.info.casos=CASOS[n.id];if(n.id==='ia'&&n.info)n.info.notas=true;});
/* --- Líneas --- */
function tono(n,t){return n?t:'';}
linea({de:'gsg',a:'revisar',cuenta:flPlural(c.recibidos,'pedido','pedidos'),tono:tono(c.recibidos,'ok')});
linea({de:'revisar',a:'confirmar',tono:tono(c.recibidos,'ok')});
linea({de:'revisar',s:1,a:'reportado',ruta:function(a,b){return [[a.x,a.y],[a.x+18,a.y],[a.x+18,255],[b.x-26,255],[b.x-26,b.y],[b.x,b.y]];},tono:tono(rpt.total,'mal')});
linea({de:'confirmar',a:'cola',cuenta:pm.retenidos?pm.retenidos+' esperan':'',tono:tono(pm.enCola||pm.enviados,'ok')});
linea({de:'cola',a:'primero',cuenta:pm.enCola?pm.enCola+' en cola':'',tono:tono(pm.enCola,'ambar')||tono(pm.enviados,'ok'),anda:pm.enCola});
linea({de:'primero',a:'estado',cuenta:flPlural(pm.enviados,'enviado','enviados'),tono:tono(pm.enviados,'ok'),anda:pm.enviados});
linea({de:'primero',s:1,a:'errorEnvio',cuenta:pm.fallidos?String(pm.fallidos):'',tono:tono(pm.fallidos,'mal')});
linea({de:'errorEnvio',a:'reportado',ruta:function(a,b){return [[a.x,a.y],[a.x+20,a.y],[a.x+20,249],[b.x-26,249],[b.x-26,b.y],[b.x,b.y]];},tono:tono(pm.fallidos,'mal')});
linea({de:'estado',a:'responde',cuenta:msj.leidos?msj.leidos+' leídos':'',tono:tono(msj.entregados,'ok')});
linea({de:'reportado',a:'reporte1',cuenta:rpt.total?String(rpt.total):'',tono:tono(rpt.total,'ambar')});
linea({de:'empresa',a:'gsg',sub:true});linea({de:'lineas',a:'cola',sub:true});linea({de:'ia',a:'responde',sub:true});
var xr=flX(6)+FL.t;
/* Salidas de «¿Qué responde?»: plegado, un cabo con su cifra; desplegado, la vuelta hasta su rama. */
var cabos=[[r.si,'ok','ubicación'],[r.respondioSinUbicacion,'ambar','otra cosa'],[(r.esperando||0)+(r.noContesto||0),'','nada'],[r.noEsLaPersona,'mal','no es la persona']];
cabos.forEach(function(cb,i){linea({de:'responde',s:i,cabo:true,grupo:'plegado',cuenta:String(cb[0]||0),tono:tono(cb[0],cb[1])});});
linea({de:'responde',s:0,a:'ubicacion',grupo:'abierto',ruta:function(a,b){return [[a.x,a.y],[xr+40,a.y],[xr+40,470],[b.x-44,470],[b.x-44,b.y],[b.x,b.y]];},cuentaEn:[flX(4),470],cuenta:'ubicación · '+(r.si||0),tono:tono(r.si,'ok'),anda:r.si});
linea({de:'responde',s:1,a:'otra',grupo:'abierto',ruta:function(a,b){return [[a.x,a.y],[xr+58,a.y],[xr+58,812],[b.x-60,812],[b.x-60,b.y],[b.x,b.y]];},cuentaEn:[flX(4),812],cuenta:'otra cosa · '+(r.respondioSinUbicacion||0),tono:tono(r.respondioSinUbicacion,'ambar'),anda:r.respondioSinUbicacion});
linea({de:'responde',s:2,a:'insiste',grupo:'abierto',ruta:function(a,b){return [[a.x,a.y],[xr+76,a.y],[xr+76,1190],[b.x-76,1190],[b.x-76,b.y],[b.x,b.y]];},cuentaEn:[flX(4),1190],cuenta:'nada · '+((r.esperando||0)+(r.noContesto||0)),tono:''});
linea({de:'responde',s:3,a:'reportado',ruta:function(a,b){return [[a.x,a.y],[xr+22,a.y],[xr+22,243],[b.x-26,243],[b.x-26,b.y],[b.x,b.y]];},tono:tono(r.noEsLaPersona,'mal'),grupo:'abierto'});
/* Rama ubicación */
linea({de:'ubicacion',a:'segundo',cuenta:String(Math.max(0,(r.si||0))),tono:tono(r.si,'ok'),grupo:'abierto'});
linea({de:'ubicacion',s:1,a:'esahi',tono:tono(c.porConfirmarUbicacion,'ambar'),grupo:'abierto'});
linea({de:'esahi',a:'segundo',tono:'',grupo:'abierto'});
linea({de:'segundo',a:'agsg',cuenta:String(r.si||0),tono:tono(r.si,'ok'),grupo:'abierto'});
linea({de:'agsg',a:'listo',cuenta:enviadasGsg?String(enviadasGsg):'',tono:tono(enviadasGsg,'ok'),grupo:'abierto',anda:pendGsg});
linea({de:'cambia',a:'agsg',grupo:'abierto',vuelta:true,ruta:function(a,b){return [[a.x,a.y],[a.x+24,a.y],[a.x+24,672],[b.x-30,672],[b.x-30,b.y],[b.x,b.y]];},tono:tono(c.cambiaronUbicacion,'ambar')});
/* Rama otra cosa */
linea({de:'otra',a:'chat',cuenta:String(r.respondioSinUbicacion||0),tono:tono(r.respondioSinUbicacion,'ambar'),grupo:'abierto'});
linea({de:'otra',s:1,a:'queja',cuenta:nq?String(nq):'',tono:tono(nq,'mal'),grupo:'abierto'});
linea({de:'queja',a:'persona',tono:tono(nq,'mal'),grupo:'abierto'});
linea({de:'chat',a:'chat2',tono:tono(directa,'ambar'),grupo:'abierto'});
linea({de:'chat2',a:'ubicacion',grupo:'abierto',vuelta:true,ruta:function(a,b){return [[a.x,a.y],[a.x+28,a.y],[a.x+28,790],[b.x-28,790],[b.x-28,b.y],[b.x,b.y]];},cuentaEn:[flX(3)+FL.t+28,700],cuenta:'si la manda',tono:'ok'});
/* Rama no contesta */
linea({de:'insiste',a:'agoto',cuenta:r.esperando?String(r.esperando):'',tono:'',grupo:'abierto',anda:r.esperando});
linea({de:'agoto',s:0,a:'persona',cuenta:r.noContesto?String(r.noContesto):'',tono:tono(r.noContesto,'ambar'),grupo:'abierto'});
linea({de:'agoto',s:1,a:'insiste',grupo:'abierto',vuelta:true,ruta:function(a,b){return [[a.x,a.y],[a.x+26,a.y],[a.x+26,1395],[b.x-28,1395],[b.x-28,b.y],[b.x,b.y]];},cuentaEn:[flX(2),1395],cuenta:'vuelve a escribirle',tono:''});
linea({de:'persona',a:'reporte2',tono:tono(r.noContesto,'ambar'),grupo:'abierto'});
/* El orden que dejó el administrador: cada cuadro movido va a su sitio; el resto, al de fábrica. */
N.forEach(function(n){FL.fabrica[n.id]=[n.x,n.y];var p=FL.pos[n.id];if(p&&isFinite(p[0])&&isFinite(p[1])){n.x=p[0];n.y=p[1];}});
return {N:N,E:E};}
/* --- Cuadros movidos: las líneas buscan su propio camino --- */
function flMovido(n){var f=FL.fabrica[n.id];return !!f&&(f[0]!==n.x||f[1]!==n.y);}
/* Si el destino queda detrás (o casi encima) del origen, se rodea por debajo de los dos cuadros. */
function flRutaAuto(A,B,a,b){if(b.x-a.x>=60)return null;var lejos=Math.abs(a.y-b.y)>Math.max(flAlto(A),flAlto(B))+90;var my=lejos?Math.round((a.y+b.y)/2):Math.max(A.y+flAlto(A),B.y+flAlto(B))+70;var x1=a.x+24,x2=b.x-30;return {pts:[[a.x,a.y],[x1,a.y],[x1,my],[x2,my],[x2,b.y],[b.x,b.y]],cuenta:[(x1+x2)/2,my]};}
/* --- Dibujo --- */
function flClaseGrupo(g){return g?' fl-anima fl-g-'+g+((g==='abierto'&&!flAbierto)||(g==='plegado'&&flAbierto)?' fl-oculto':''):'';}
function flPintar(d,aj){FL.nodos={};FL.fabrica={};var m=flModelo(d,aj),html=[];FL.modelo=m;
m.N.forEach(function(n){var marca=n.tono==='ok'?FL_ICO.ok:n.tono==='mal'||n.tono==='ambar'?FL_ICO.alerta:'';var cls=(n.forma==='disparo'?' disparo':'')+(n.forma==='circulo'?' circulo':'')+flClaseGrupo(n.grupo);
 html.push('<button type="button" class="fl-nodo'+cls+'" data-nodo="'+n.id+'" data-tono="'+(n.tono||'')+'" style="left:'+n.x+'px;top:'+n.y+'px;--t:'+flTam(n)+'px;--h:'+flAlto(n)+'px;--c:'+n.color+'" aria-label="'+esc(n.nombre+'. '+String(n.sub||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' '))+'. Ver detalle">'+(n.forma==='disparo'?'<span class="fl-rayo">'+FL_ICO.rayo+'</span>':'')+'<span class="fl-caja">'+FL_ICO[n.ico]+(marca?'<span class="fl-marca">'+marca+'</span>':'')+'</span><span class="fl-nombre">'+esc(n.nombre)+(n.sub?'<span class="fl-sub">'+n.sub+'</span>':'')+'</span></button>');});
/* Las etiquetas de cada rama, a la izquierda. */
[['Ubicación',FL_Y.b,'ok'],['Otra cosa',FL_Y.c,'ambar'],['No contesta',FL_Y.d,'gris']].forEach(function(r){html.push('<span class="fl-rama '+r[2]+flClaseGrupo('abierto')+'" style="left:'+(flX(0)-10)+'px;top:'+(r[1]+FL.t/2)+'px">'+r[0]+'</span>');});
$('flujo-lienzo').innerHTML='<svg class="fl-lineas" id="flujo-svg" width="'+FL.ancho+'" height="'+FL.altoAbierto+'" aria-hidden="true"></svg>'+html.join('')+'<div id="flujo-extras"></div>';
$('flujo-lienzo').style.width=FL.ancho+'px';$('flujo-lienzo').style.height=FL.altoAbierto+'px';flLineas();}
/* Las líneas, sus puertos y sus cifras: se vuelven a dibujar cada vez que se mueve un cuadro. */
function flLineas(){var m=FL.modelo;if(!m||!$('flujo-svg'))return;var svg=[],html=[],cuentas=[];
m.E.forEach(function(e){var A=FL.nodos[e.de],B=e.a?FL.nodos[e.a]:null,g=e.grupo||(B&&B.grupo)||A.grupo||'';var cls=flClaseGrupo(g);
 if(e.sub){var p1={x:A.x+FL.c/2,y:A.y},p2={x:B.x+(B.ancho||FL.t)/2,y:B.y+flAlto(B)};svg.push('<path class="sub'+cls+'" d="M'+p1.x+' '+p1.y+' L'+p2.x+' '+(p2.y+8)+'"/><path class="rombo'+cls+'" d="M'+p2.x+' '+(p2.y+1)+' l5 6 -5 6 -5 -6z"/>');return;}
 var a=flSalida(A,e.s||0),t=e.tono||'';svg.push('<circle class="puerto'+cls+'" cx="'+a.x+'" cy="'+a.y+'" r="5.5"/>');
 if(A.salidas&&A.salidas.length>1)svg.push('<text class="'+(e.cabo?t:'')+cls+'" x="'+(a.x+9)+'" y="'+(a.y-4)+'">'+esc(A.salidas[e.s||0])+(e.cabo&&e.cuenta?' · '+esc(e.cuenta):'')+'</text>');
 if(e.cabo){var fin=a.x+86;svg.push('<path class="'+t+cls+'" d="M'+a.x+' '+a.y+' L'+fin+' '+a.y+'"/>');html.push('<span class="fl-mas'+cls+'" style="left:'+fin+'px;top:'+a.y+'px" aria-hidden="true">+</span>');return;}
 var b=flEntrada(B),mov=flMovido(A)||flMovido(B),pts=e.ruta&&!mov?e.ruta(a,b):null,cuentaEn=mov?null:e.cuentaEn;
 if(mov&&!pts){var au=flRutaAuto(A,B,a,b);if(au){pts=au.pts;cuentaEn=au.cuenta;}}
 var dd=pts?flTramos(pts):flCurva(a,{x:b.x-2,y:b.y});
 svg.push('<path class="'+t+(e.anda?' anda':'')+(e.vuelta?' vuelta':'')+cls+'" d="'+dd+'"/><path class="punta '+t+cls+'" d="M'+(b.x-9)+' '+(b.y-5)+' L'+b.x+' '+b.y+' L'+(b.x-9)+' '+(b.y+5)+' Z"/>');
 if(e.cuenta){var cx=cuentaEn?cuentaEn[0]:(a.x+b.x)/2,cy=cuentaEn?cuentaEn[1]:(a.y+b.y)/2;cuentas.push('<span class="fl-cuenta '+t+cls+'" style="left:'+cx+'px;top:'+cy+'px">'+esc(e.cuenta)+'</span>');}});
$('flujo-svg').innerHTML=svg.join('');$('flujo-extras').innerHTML=html.join('')+cuentas.join('');}
/* --- Vista: encajar, zoom y arrastre --- */
/* Lo que ocupa lo visible: si un cuadro se llevó más abajo o más a la derecha, el lienzo crece con él. */
function flVisibles(){var l=[];Object.keys(FL.nodos).forEach(function(id){var n=FL.nodos[id];if(flAbierto||n.grupo!=='abierto')l.push(n);});return l;}
function flAltoContenido(){var base=flAbierto?FL.altoAbierto:FL.altoPlegado;return flVisibles().reduce(function(h,n){return Math.max(h,n.y+flAlto(n)+90);},base);}
function flAnchoContenido(){return flVisibles().reduce(function(w,n){return Math.max(w,n.x+flAncho(n)+150);},FL.ancho);}
function flKEncaje(){var marco=$('flujo-marco'),w=marco.clientWidth||FL.ancho;return Math.max(0.5,Math.min(1,(w-24)/flAnchoContenido()));}
function flAltoMarco(){var sec=$('flujo-gsg');if(document.fullscreenElement===sec)return;$('flujo-marco').style.height=Math.round(flAltoContenido()*flKEncaje()+64)+'px';}
function flVer(){var v=FL.vista;$('flujo-lienzo').style.transform='translate('+v.x+'px,'+v.y+'px) scale('+v.k+')';var z=$('flujo-zoom');if(z)z.textContent=Math.round(v.k*100)+'%';}
function flEncajar(){var marco=$('flujo-marco'),w=marco.clientWidth||FL.ancho,h=marco.clientHeight||400,k=flKEncaje();if(document.fullscreenElement===$('flujo-gsg'))k=Math.max(0.3,Math.min(1.2,(w-24)/flAnchoContenido(),(h-24)/flAltoContenido()));FL.vista={k:k,x:Math.max(12,(w-flAnchoContenido()*k)/2),y:10};flVer();}
function flZoom(f,cx,cy){var v=FL.vista,marco=$('flujo-marco');if(cx==null){cx=marco.clientWidth/2;cy=marco.clientHeight/2;}var k=Math.max(0.3,Math.min(2,v.k*f));v.x=cx-(cx-v.x)*k/v.k;v.y=cy-(cy-v.y)*k/v.k;v.k=k;flVer();}
function flAplicar(){var sec=$('flujo-gsg');if(!sec)return;sec.setAttribute('data-abierto',flAbierto?'1':'0');$('flujo-boton').setAttribute('aria-expanded',String(flAbierto));$('flujo-boton-txt').textContent=flAbierto?'Plegar':'Desplegar todo';
sec.querySelectorAll('.fl-g-abierto').forEach(function(e){e.classList.toggle('fl-oculto',!flAbierto);});sec.querySelectorAll('.fl-g-plegado').forEach(function(e){e.classList.toggle('fl-oculto',flAbierto);});
if(!flAbierto&&FL.elegido&&FL.nodos[FL.elegido]&&FL.nodos[FL.elegido].grupo==='abierto')flCerrarPanel();flAltoMarco();flEncajar();}
/* --- Detalle de un nodo --- */
function flAbrirPanel(id){var n=FL.nodos[id];if(!n)return;FL.elegido=id;FL.verNov=false;var i=n.info||{};document.querySelectorAll('#flujo-lienzo .fl-nodo').forEach(function(b){b.classList.toggle('elegido',b.getAttribute('data-nodo')===id);});
var filas=(i.filas||[]).map(function(f){return '<li><span>'+esc(f[0])+'</span><b class="'+(f[2]||'')+'">'+esc(f[1])+'</b></li>';}).join('');
var cs=(FL.datos&&FL.datos.casos)||{};
var casos=(i.casos||[]).map(function(k){var l=cs[k[0]];return flSeccionCasos(k[1],l);}).join('');
if(i.notas){var grupos=cs.notas||[];casos+=grupos.length?grupos.map(function(g){return flSeccionCasos(g.nombre,g);}).join(''):'<h4>Notas de hoy</h4><p class="fl-vacio">Todavía no hay chats con nota hoy.</p>';}
flMostrarPanel('<span class="fl-panel-ico" style="--c:'+n.color+'">'+FL_ICO[n.ico]+'</span><div><h3>'+esc(n.nombre)+'</h3><small>'+esc(i.tipo||'Paso')+'</small></div>','<p>'+esc(i.texto||'')+'</p>'+(filas?'<h4>Hoy</h4><ul class="fl-filas">'+filas+'</ul>':'')+casos,i.href?'<a class="fl-panel-ir" href="'+esc(i.href)+'">'+FL_ICO.ir+'Ir a '+esc(i.ir||'su pantalla')+'</a>':'');
/* Si el panel tapa el paso elegido, el lienzo se corre para dejarlo a la vista. */
var marco=$('flujo-marco'),pn=$('flujo-panel'),v=FL.vista,libre=marco.clientWidth-pn.offsetWidth-32,der=v.x+(n.x+flAncho(n)+40)*v.k;if(pn.offsetWidth<marco.clientWidth*0.9&&der>libre){v.x-=der-libre;flVer();}}
/* El panel de la derecha: cabecera, cuerpo y pie. Lo usan el detalle de un paso y las novedades. */
function flMostrarPanel(cab,cuerpo,pie){var p=$('flujo-panel');p.innerHTML='<div class="fl-panel-cab">'+cab+'<button type="button" class="fl-panel-cerrar" id="flujo-panel-cerrar" aria-label="Cerrar">'+FL_ICO.cerrar+'</button></div><div class="fl-panel-cuerpo">'+cuerpo+'</div>'+(pie||'');
p.classList.add('abierto');p.setAttribute('aria-hidden','false');$('flujo-panel-cerrar').addEventListener('click',flCerrarPanel);$('flujo-panel-cerrar').focus({preventScroll:true});}
function flHora(h){if(!h)return '';try{var d=new Date(h);return d.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});}catch(e){return '';}}
/* Un cliente concreto: nombre, tracking, hora y qué pasó; abre su chat. */
function flCaso(c,tipo){var det=String(c.detalle||''),extra='';if(det.indexOf('|')>0){var partes=det.split('|');det=(FL_MOTIVOS[partes[0]]||partes[0]);extra=partes.slice(1).join('|');}
var tel=String(c.telefono||'').replace(/\D/g,'');var quien=c.nombre||(tel.length>=9?flNumero(tel):tel?'Teléfono '+tel:'Cliente');
return '<li><a class="fl-caso" href="'+(tel.length>=9?'/chat?phone='+encodeURIComponent(tel):'/hoy'+(c.tracking?'?buscar='+encodeURIComponent(c.tracking):''))+'" title="Abrir su chat"><span class="fl-caso-cab">'+(tipo?'<i class="fl-tipo '+tipo[1]+'">'+esc(tipo[0])+'</i>':'')+'<b>'+esc(quien)+'</b>'+(c.tracking?'<span class="fl-trk">'+esc(c.tracking)+'</span>':'')+(c.hora?'<time>'+esc(flHora(c.hora))+'</time>':'')+'</span><span class="fl-caso-det">'+esc(det)+(extra?' · '+esc(extra):'')+'</span></a></li>';}
function flSeccionCasos(titulo,l){l=l||{total:0,casos:[]};return '<h4>'+esc(titulo)+' <span class="fl-n">'+esc(l.total||0)+'</span></h4>'+((l.casos||[]).length?'<ul class="fl-casos">'+l.casos.map(function(c){return flCaso(c);}).join('')+'</ul>'+(l.total>l.casos.length?'<p class="fl-vacio">Y '+esc(l.total-l.casos.length)+' más: míralos en su pantalla.</p>':''):'<p class="fl-vacio">Nadie hoy.</p>');}
/* Novedades de hoy: todo lo que pasó, lo más reciente primero, con filtro por tipo. */
var FL_NOVEDADES=[['cambiaronUbicacion','Cambió su ubicación','ambar'],['erroresEnvio','Error de mensaje','mal'],['sinEnviar','Sin enviar','ambar'],['quejas','Queja','mal'],['noEsLaPersona','No es la persona','mal'],['reportados','Número reportado','mal'],['noContesto','No contestó','ambar'],['respondioSinUbicacion','Escribió sin ubicación','ambar'],['porConfirmarUbicacion','Dirección por confirmar','ambar']];
var flFiltroNov='';
function flNovedades(){FL.verNov=true;var cs=(FL.datos&&FL.datos.casos)||{},todas=[];FL_NOVEDADES.forEach(function(t){((cs[t[0]]||{}).casos||[]).forEach(function(c){todas.push({c:c,t:t});});});
todas.sort(function(a,b){return String(b.c.hora||'').localeCompare(String(a.c.hora||''));});
var chips='<div class="fl-chips" role="group" aria-label="Filtrar novedades"><button type="button" data-nov="" aria-pressed="'+(!flFiltroNov)+'">Todas · '+todas.length+'</button>'+FL_NOVEDADES.map(function(t){var n=(cs[t[0]]||{}).total||0;return n?'<button type="button" data-nov="'+t[0]+'" class="'+t[2]+'" aria-pressed="'+(flFiltroNov===t[0])+'">'+esc(t[1])+' · '+n+'</button>':'';}).join('')+'</div>';
var vis=todas.filter(function(x){return !flFiltroNov||x.t[0]===flFiltroNov;});
FL.elegido=null;document.querySelectorAll('#flujo-lienzo .fl-nodo.elegido').forEach(function(b){b.classList.remove('elegido');});
flMostrarPanel('<span class="fl-panel-ico" style="--c:#f5b84a">'+FL_ICO.novedades+'</span><div><h3>Novedades de hoy</h3><small>Lo que pasó con cada cliente, lo más reciente primero</small></div>',chips+(vis.length?'<ul class="fl-casos">'+vis.map(function(x){return flCaso(x.c,[x.t[1],x.t[2]]);}).join('')+'</ul>':'<p class="fl-vacio">Sin novedades: todo va por su camino.</p>'),'');
$('flujo-panel').querySelectorAll('[data-nov]').forEach(function(b){b.addEventListener('click',function(){flFiltroNov=b.getAttribute('data-nov');flNovedades();});});}
function flTotalNovedades(){var cs=(FL.datos&&FL.datos.casos)||{};return FL_NOVEDADES.reduce(function(s,t){return s+((cs[t[0]]||{}).total||0);},0);}
function flCerrarPanel(){var p=$('flujo-panel');if(!p)return;FL.verNov=false;var antes=FL.elegido;p.classList.remove('abierto');p.setAttribute('aria-hidden','true');FL.elegido=null;document.querySelectorAll('#flujo-lienzo .fl-nodo.elegido').forEach(function(b){b.classList.remove('elegido');});var b=antes&&document.querySelector('#flujo-lienzo [data-nodo="'+antes+'"]');if(b)b.focus({preventScroll:true});}
/* --- El orden de los cuadros: se guarda en la tienda un momento después de soltar --- */
function flAnotarPosiciones(){var pos={};Object.keys(FL.nodos).forEach(function(id){var n=FL.nodos[id];if(flMovido(n))pos[id]=[n.x,n.y];});FL.pos=pos;flBotonRestablecer();}
function flBotonRestablecer(){var b=$('flujo-restablecer');if(b)b.hidden=!(FL.puedeOrdenar&&Object.keys(FL.pos).length);}
function flEstadoOrden(t,mal){var s=$('flujo-guardado');if(!s)return;clearTimeout(FL.tEstado);s.textContent=t;s.classList.toggle('mal',!!mal);if(t&&!mal&&t!=='Guardando…')FL.tEstado=setTimeout(function(){s.textContent='';},2500);}
function flGuardarOrden(){clearTimeout(FL.tGuardar);FL.pendiente=true;flEstadoOrden('Guardando…');FL.tGuardar=setTimeout(function(){FL.pendiente=false;var envio=FL.pos;
 FL.guardando=api('/admin/flujo/disposicion','PUT',{nodos:envio}).then(function(){FL.guardando=null;if(!FL.pendiente)flEstadoOrden('Guardado');}).catch(function(e){FL.guardando=null;flEstadoOrden('No se guardó: '+e.message,true);});},600);}
async function flRestablecerOrden(){clearTimeout(FL.tGuardar);FL.pendiente=false;try{await api('/admin/flujo/disposicion','DELETE');}catch(e){flEstadoOrden('No se pudo restablecer: '+e.message,true);return;}
 FL.pos={};flPintar(FL.datos,FL.aj);flBotonRestablecer();flAltoMarco();flEncajar();if(FL.elegido&&FL.nodos[FL.elegido])flAbrirPanel(FL.elegido);flEstadoOrden('Orden de fábrica');}
var flListo=false;
function flPreparar(){if(flListo)return;flListo=true;var marco=$('flujo-marco'),arr=null;
$('flujo-boton').addEventListener('click',function(){flAbierto=!flAbierto;try{localStorage.setItem('gsgchat:flujo-desplegado',flAbierto?'1':'0');}catch(e){}flAplicar();});
$('flujo-novedades').addEventListener('click',function(){if(FL.verNov){flCerrarPanel();return;}flFiltroNov='';flNovedades();});$('flujo-encajar').addEventListener('click',flEncajar);$('flujo-acercar').addEventListener('click',function(){flZoom(1.2);});$('flujo-alejar').addEventListener('click',function(){flZoom(1/1.2);});
$('flujo-completa').addEventListener('click',function(){var sec=$('flujo-gsg');if(document.fullscreenElement)document.exitFullscreen();else if(sec.requestFullscreen)sec.requestFullscreen().catch(function(){});});
document.addEventListener('fullscreenchange',function(){if(document.fullscreenElement!==$('flujo-gsg'))flAltoMarco();setTimeout(flEncajar,60);});
/* Arrastrar el lienzo (no sobre un nodo ni las herramientas); un toque sin arrastre sobre un nodo abre su detalle. */
/* Un administrador, además, arrastra cada cuadro a donde quiera (se ajusta a una rejilla de 10 px y se guarda en la tienda). */
marco.addEventListener('pointerdown',function(ev){if(ev.button!==0||ev.target.closest('.fl-herr,.fl-panel'))return;var nodo=ev.target.closest('.fl-nodo'),n=nodo&&FL.nodos[nodo.getAttribute('data-nodo')];arr={x:ev.clientX,y:ev.clientY,vx:FL.vista.x,vy:FL.vista.y,movio:false,nodo:nodo,n:FL.puedeOrdenar&&n?n:null,nx:n?n.x:0,ny:n?n.y:0,id:ev.pointerId};});
marco.addEventListener('pointermove',function(ev){if(!arr||ev.pointerId!==arr.id)return;var dx=ev.clientX-arr.x,dy=ev.clientY-arr.y;if(!arr.movio&&Math.hypot(dx,dy)<4)return;if(!arr.movio){arr.movio=true;FL.arrastrando=true;marco.classList.add(arr.n?'moviendo':'arrastrando');if(arr.nodo&&arr.n)arr.nodo.classList.add('levantado');try{marco.setPointerCapture(ev.pointerId);}catch(e){}}
 if(arr.n){var k=FL.vista.k||1,x=Math.max(0,Math.min(3000,Math.round((arr.nx+dx/k)/10)*10)),y=Math.max(0,Math.min(3000,Math.round((arr.ny+dy/k)/10)*10));if(x!==arr.n.x||y!==arr.n.y){arr.n.x=x;arr.n.y=y;arr.nodo.style.left=x+'px';arr.nodo.style.top=y+'px';flLineas();}return;}
 FL.vista.x=arr.vx+dx;FL.vista.y=arr.vy+dy;flVer();});
function soltar(ev){if(!arr)return;var a=arr;arr=null;FL.arrastrando=false;marco.classList.remove('arrastrando','moviendo');if(a.nodo)a.nodo.classList.remove('levantado');
 if(a.movio&&a.n){if(a.n.x!==a.nx||a.n.y!==a.ny){flAnotarPosiciones();flGuardarOrden();flAltoMarco();}return;}
 if(!a.movio&&a.nodo)flAbrirPanel(a.nodo.getAttribute('data-nodo'));}
marco.addEventListener('pointerup',soltar);marco.addEventListener('pointercancel',function(){if(arr&&arr.n&&arr.movio){arr.n.x=arr.nx;arr.n.y=arr.ny;arr.nodo.style.left=arr.nx+'px';arr.nodo.style.top=arr.ny+'px';arr.nodo.classList.remove('levantado');flLineas();}arr=null;FL.arrastrando=false;marco.classList.remove('arrastrando','moviendo');});
$('flujo-restablecer').addEventListener('click',flRestablecerOrden);
/* Con teclado: Enter o espacio sobre un nodo abre su detalle. */
marco.addEventListener('keydown',function(ev){var n=ev.target.closest&&ev.target.closest('.fl-nodo');if(n&&(ev.key==='Enter'||ev.key===' ')){ev.preventDefault();flAbrirPanel(n.getAttribute('data-nodo'));}if(ev.key==='Escape')flCerrarPanel();});
marco.addEventListener('click',function(ev){if(ev.target.closest('.fl-nodo'))ev.preventDefault();});
/* Ctrl + rueda acerca o aleja donde está el puntero; la rueda sola sigue bajando la página. */
marco.addEventListener('wheel',function(ev){if(!ev.ctrlKey&&!ev.metaKey)return;ev.preventDefault();var r=marco.getBoundingClientRect();flZoom(ev.deltaY<0?1.1:1/1.1,ev.clientX-r.left,ev.clientY-r.top);},{passive:false});
var ancho=marco.clientWidth;window.addEventListener('resize',function(){if(marco.clientWidth===ancho)return;ancho=marco.clientWidth;flAltoMarco();flEncajar();});}
async function cargarFlujo(){var lienzo=$('flujo-lienzo');if(!lienzo)return;flPreparar();var d,aj=null;
try{var r=await Promise.all([api('/admin/flujo'),api('/admin/rutas/ajustes').catch(function(){return null;})]);d=r[0];aj=r[1]&&(r[1].ajustes||r[1]);}catch(e){lienzo.innerHTML='<p class="fl-error">No se pudo dibujar el flujo: '+esc(e.message)+'</p>';return;}
var primera=!FL.datos;FL.datos=d;FL.aj=aj;FL.puedeOrdenar=!!d.puedeOrdenar;$('flujo-gsg').setAttribute('data-ordenar',FL.puedeOrdenar?'1':'0');
/* Mientras alguien arrastra o queda un guardado en camino, manda lo de esta pantalla; si no, lo guardado en la tienda. */
if(FL.arrastrando)return;if(!FL.pendiente&&!FL.guardando)FL.pos=d.disposicion||{};
var elegido=FL.elegido;flPintar(d,aj);flBotonRestablecer();if(!primera)flAltoMarco();
var sec=$('flujo-gsg');sec.querySelectorAll('.fl-g-abierto').forEach(function(e){e.classList.toggle('fl-oculto',!flAbierto);});sec.querySelectorAll('.fl-g-plegado').forEach(function(e){e.classList.toggle('fl-oculto',flAbierto);});
if(primera)flAplicar();else flVer();
if(elegido&&FL.nodos[elegido])flAbrirPanel(elegido);else if(FL.verNov)flNovedades();
var tn=flTotalNovedades(),bn=$('flujo-novedades');bn.classList.toggle('sin',!tn);$('flujo-novedades-txt').innerHTML='Novedades de hoy <b>'+esc(tn)+'</b>';
$('flujo-pie').innerHTML=(d.dia?'Pedidos del '+esc(String(d.dia).split('-').reverse().join('/'))+'. ':'')+'Toca un paso para ver su detalle. '+(FL.puedeOrdenar?'Arrastra un cuadro para ordenarlo a tu gusto (lo ve todo tu equipo) o el fondo para mover el lienzo':'Arrastra para mover')+'; <kbd>Ctrl</kbd> + rueda para acercar.';
var hora=$('flujo-hora');if(hora)hora.textContent='Actualizado a las '+new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});}
`;
