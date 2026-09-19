/**
 * Pantalla "Entrenar a la IA": ensenarle al asistente a gran escala.
 *
 * Responde de un vistazo que sabe el asistente (cuantas lecciones, de que
 * tipo, cuantas esperan revision, como le fue en el ultimo examen) y ofrece
 * las cuatro formas de ensenarle: una cosa a mano, muchas de golpe (Excel,
 * CSV, JSON, un chat exportado), aprender de las conversaciones reales, y
 * corregirla desde el chat. Y el examen en masa para saber si aprendio.
 *
 * Decisiones:
 *  - Los trabajos largos (aprender, pulir, examinar) corren en el servidor;
 *    la pantalla los pinta con una barra y se refresca sola mientras corren.
 *  - Nada tecnico: ni "indice", ni "prompt", ni "tokens". Se habla de
 *    lecciones, de lo que sabe y de si respondio como se le enseno.
 *  - El JS va en String.raw, con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';

const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #f0f2f5; --panel: #fff; --line: #e3e5e9; --text: #111b21;
    --muted: #667781; --accent: #128c7e; --ok: #128c7e; --warn: #d97706;
    --bad: #dc2626; --info: #2563eb; --chip: #f6f7f9;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0b141a; --panel: #111b21; --line: #222d34; --text: #e9edef; --muted: #8696a0; --chip: #1c262c; }
  }
  * { box-sizing: border-box; }
  .wrap { color: var(--text); font: 15px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 1500px; }
  .wrap a { color: var(--accent); }
  .muted { color: var(--muted); }
  .hidden { display: none !important; }
  .demo { background: #d97706; color: #fff; padding: 9px 14px; font-size: 13.5px; text-align: center; }
  .aviso { background: rgba(217,119,6,.12); border: 1px solid rgba(217,119,6,.35); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; font-size: 14px; }
  .aviso b { color: var(--warn); }

  select, input, textarea, button { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 11px; }
  input, select, textarea { width: 100%; }
  textarea { min-height: 70px; resize: vertical; }
  button { cursor: pointer; width: auto; white-space: nowrap; }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover { filter: brightness(1.08); }
  button.sm { padding: 5px 9px; font-size: 13px; }
  button.peligro { color: var(--bad); }
  button:disabled { opacity: .55; cursor: default; }
  label { display: block; font-size: 12.5px; color: var(--muted); margin: 10px 0 4px; }
  label.linea { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; color: var(--text); font-size: 14px; cursor: pointer; }
  label.linea input { width: auto; }
  .fila { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
  .fila > div { flex: 1; min-width: 120px; }
  .fila > div.fijo { flex: none; }
  .fila label { margin-top: 0; }

  .explica { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
  .explica .texto { flex: 1; min-width: 260px; font-size: 14px; }
  .explica .texto p { margin: 0 0 6px; }
  .explica .sabe { background: var(--chip); border-radius: 10px; padding: 10px 14px; min-width: 260px; font-size: 13.5px; }
  .explica .sabe b { display: block; font-size: 15px; margin-bottom: 4px; }
  .explica .sabe .n { font-size: 26px; font-weight: 700; line-height: 1.1; color: var(--accent); }

  .tarjetas { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  .tarjeta { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; min-width: 150px; cursor: default; }
  .tarjeta.pulsable { cursor: pointer; }
  .tarjeta.pulsable:hover { border-color: var(--accent); }
  .tarjeta .n { font-size: 22px; font-weight: 700; line-height: 1.1; }
  .tarjeta .q { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
  .tarjeta.ok .n { color: var(--ok); }
  .tarjeta.warn .n { color: var(--warn); }
  .tarjeta.bad .n { color: var(--bad); }

  .cols { display: grid; grid-template-columns: 1fr 430px; gap: 14px; align-items: start; }
  @media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }
  .caja { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; margin-bottom: 14px; }
  .caja > h2 { font-size: 14.5px; margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .caja > h2 .sep { flex: 1; }
  .caja > h2 .paso { background: var(--accent); color: #fff; border-radius: 999px; width: 22px; height: 22px; display: inline-grid; place-items: center; font-size: 12.5px; flex: none; }
  .caja .cuerpo { padding: 14px; }
  .caja .cuerpo p { margin: 0 0 8px; font-size: 14px; }
  .caja.plegable > h2 { cursor: pointer; }
  .caja.plegable.cerrada .cuerpo { display: none; }
  .caja.plegable > h2 .flecha { transition: transform .15s; }
  .caja.plegable.cerrada > h2 .flecha { transform: rotate(-90deg); }

  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); font-weight: 600; }
  tbody tr:hover { background: var(--chip); }
  td .sub { color: var(--muted); font-size: 12.5px; display: block; }
  td.texto { max-width: 380px; white-space: pre-wrap; word-break: break-word; }
  td .mala { display: block; color: var(--bad); font-size: 12.5px; margin-top: 3px; }
  .tabla-scroll { max-height: 70vh; overflow: auto; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .pill.ok { background: rgba(18,140,126,.16); color: var(--ok); }
  .pill.warn { background: rgba(217,119,6,.16); color: var(--warn); }
  .pill.bad { background: rgba(220,38,38,.14); color: var(--bad); }
  .pill.info { background: rgba(37,99,235,.14); color: var(--info); }
  .pill.gris { background: var(--chip); color: var(--muted); }
  .acciones { display: flex; gap: 4px; flex-wrap: nowrap; }
  .acciones button.sm { padding: 4px 7px; font-size: 12.5px; }
  /* Cada leccion es una fila ancha: lo que dice el cliente, lo que responde y
     debajo sus etiquetas. Asi se lee igual con 900 px que con 1500. */
  .leccion { padding: 10px 12px; }
  .leccion .dice { font-weight: 600; white-space: pre-wrap; word-break: break-word; }
  .leccion .dice .tipo { font-weight: 600; }
  .leccion .resp { margin-top: 3px; white-space: pre-wrap; word-break: break-word; color: var(--text); }
  .leccion .resp::before { content: '→ '; color: var(--muted); }
  .leccion .mala { display: block; color: var(--bad); font-size: 12.5px; margin-top: 3px; }
  .leccion .etiquetas { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 6px; font-size: 12.5px; color: var(--muted); }
  .leccion .etiquetas .pill { font-weight: 600; }
  #caja-lecciones td:first-child { width: 28px; padding-right: 0; }
  #caja-lecciones td:last-child { white-space: nowrap; width: 1%; vertical-align: middle; }
  .vacio { padding: 26px 14px; text-align: center; color: var(--muted); }
  .filtros { display: flex; gap: 8px; flex-wrap: wrap; padding: 10px 14px; border-bottom: 1px solid var(--line); align-items: center; }
  .filtros select, .filtros input { width: auto; padding: 6px 9px; font-size: 13.5px; }
  .filtros input[type=search] { min-width: 200px; flex: 1; }
  .seleccion { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 8px 14px; background: var(--chip); border-bottom: 1px solid var(--line); font-size: 13.5px; }
  .paginas { display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 10px 14px; font-size: 13.5px; color: var(--muted); flex-wrap: wrap; }

  .progreso { margin: 8px 0; }
  .progreso .barra { height: 10px; background: var(--chip); border-radius: 999px; overflow: hidden; border: 1px solid var(--line); }
  .progreso .barra i { display: block; height: 100%; background: var(--accent); transition: width .4s; }
  .progreso .barra.mal i { background: var(--bad); }
  .progreso .texto { font-size: 13px; color: var(--muted); margin-top: 4px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .resultado { background: var(--chip); border-radius: 10px; padding: 10px 12px; font-size: 13.5px; margin-top: 8px; }
  .resultado b.grande { font-size: 22px; display: block; }
  .examen-fila { cursor: pointer; }
  .examen-fila.elegida { background: rgba(18,140,126,.08); }
  .nota { font-size: 12.5px; color: var(--muted); }
  .porcentaje { font-weight: 700; font-size: 15px; }
  .porcentaje.ok { color: var(--ok); }
  .porcentaje.warn { color: var(--warn); }
  .porcentaje.bad { color: var(--bad); }

  .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: #111b21; color: #fff; padding: 10px 16px; border-radius: 10px; font-size: 14px; z-index: 50; box-shadow: 0 8px 24px rgba(0,0,0,.25); max-width: 90vw; }
  .tipos { display: flex; gap: 6px; flex-wrap: wrap; }
  .tipos label { margin: 0; }
  .tipos input { display: none; }
  .tipos span { display: inline-block; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); font-size: 13.5px; cursor: pointer; color: var(--text); }
  .tipos input:checked + span { background: var(--accent); border-color: var(--accent); color: #fff; }
  .previa { border: 1px dashed var(--line); border-radius: 10px; padding: 10px 12px; margin-top: 10px; font-size: 13.5px; }
  .previa ul { margin: 6px 0 0; padding-left: 18px; }
  .previa li { margin: 2px 0; }
  .elegidas { font-size: 13.5px; }
  .elegidas h4 { margin: 10px 0 4px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }
  .elegidas .item { padding: 6px 10px; border-left: 3px solid var(--accent); background: var(--chip); border-radius: 0 8px 8px 0; margin: 4px 0; white-space: pre-wrap; }
  .elegidas .item .sub { color: var(--muted); font-size: 12.5px; display: block; }
  .ia-atajo { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13.5px; }
  .ia-atajo .ej { color: var(--muted); font-style: italic; }
  .drop { border: 2px dashed var(--line); border-radius: 10px; padding: 12px; text-align: center; color: var(--muted); font-size: 13.5px; margin-top: 8px; cursor: pointer; }
  .drop.sobre { border-color: var(--accent); color: var(--accent); }
  .drop input { display: none; }
`;

export interface EntrenamientoPageOpts {
  /** false = este arranque no tiene entrenamiento (demo vieja). */
  disponible: boolean;
  /** Si hay Puter (o clave) conectado: sin eso no hay examen ni pulido. */
  conIA: boolean;
  demo?: boolean;
  nombreNegocio: string;
}

export function entrenamientoPage(opts: EntrenamientoPageOpts): string {
  const { demo, conIA } = opts;
  const avisoIA = conIA
    ? ''
    : `<div class="aviso" id="aviso-ia"><b>La IA no está conectada.</b> Enseñarle, importar y aprender de los chats funcionan igual (queda guardado); pero para <b>examinarla</b> o <b>pulir con la IA</b> hace falta conectar Puter en <a href="/panel#ia">Mi asistente IA</a>.</div>`;

  const contenido = `
<div class="wrap">
${demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
${avisoIA}

<div class="explica">
  <div class="texto">
    <p><b>Aquí le enseñas al asistente a gran escala.</b> Cada cosa que aprende es una <b>lección</b>: un ejemplo (cuando el cliente diga esto, responde esto), un dato del negocio o una regla. Pueden ser miles: en cada mensaje el asistente usa solo las que vienen al caso.</p>
    <p>Tres formas de enseñarle: <b>una cosa</b> a mano, <b>muchas de golpe</b> (un Excel, un CSV o un chat exportado) o dejar que <b>aprenda de tus conversaciones</b> reales. Desde <a href="/chat">Chats</a> también puedes corregirla mensaje a mensaje. Y el <b>examen</b> te dice si responde como se le enseñó.</p>
    <div class="ia-atajo">También con palabras: <button class="sm" id="abrir-ia" type="button">🤖 Pedírselo a la IA</button> <span class="ej">«enséñale que los envíos a Trujillo tardan 2 días» · «¿cuántas lecciones sabe?»</span></div>
  </div>
  <div class="sabe" id="sabe">
    <b>Lo que sabe ahora</b>
    <div class="n" id="sabe-n">…</div>
    <div id="sabe-texto" class="muted">Cargando…</div>
  </div>
</div>

<div class="tarjetas" id="tarjetas"></div>

<div class="cols">
  <div>
    <div class="caja" id="caja-lecciones">
      <h2>Lo que sabe <span class="sep"></span><span class="muted" style="font-weight:400;font-size:12.5px" id="lecciones-total"></span></h2>
      <div class="filtros">
        <input type="search" id="f-q" placeholder="Buscar en lo que dice el cliente, la respuesta o el tema">
        <select id="f-estado"><option value="">Todas</option><option value="activa">En uso</option><option value="pendiente">Pendientes de revisar</option><option value="descartada">Descartadas</option></select>
        <select id="f-tipo"><option value="">Ejemplos, datos y reglas</option><option value="ejemplo">Solo ejemplos</option><option value="dato">Solo datos</option><option value="regla">Solo reglas</option></select>
        <select id="f-tema"><option value="">Cualquier tema</option></select>
        <select id="f-origen"><option value="">De cualquier sitio</option><option value="manual">A mano</option><option value="importado">Importadas</option><option value="chat">Aprendidas de los chats</option><option value="correccion">Correcciones</option><option value="ia">Puestas por la IA</option><option value="api">De otro sistema</option></select>
        <select id="f-examen"><option value="">Examen: cualquiera</option><option value="mal">Fallaron el examen</option><option value="ok">Pasaron el examen</option></select>
      </div>
      <div class="seleccion" id="seleccion">
        <label class="linea" style="margin:0"><input type="checkbox" id="sel-todas"> Marcar las de esta página</label>
        <span id="sel-cuantas" class="muted"></span>
        <span class="sep" style="flex:1"></span>
        <button class="sm" id="sel-aprobar">Aprobar marcadas</button>
        <button class="sm" id="sel-descartar">Descartar marcadas</button>
        <button class="sm peligro" id="sel-borrar">Borrar marcadas</button>
        <button class="sm primary hidden" id="aprobar-pendientes">Aprobar todas las pendientes</button>
      </div>
      <div class="tabla-scroll">
        <table>
          <thead><tr><th style="width:28px"></th><th>Lo que dice el cliente → lo que responde · tema · de dónde vino · examen</th><th></th></tr></thead>
          <tbody id="filas"><tr><td colspan="3" class="vacio">Cargando…</td></tr></tbody>
        </table>
      </div>
      <div class="paginas"><span id="pag-texto"></span><span><button class="sm" id="pag-antes">← Anteriores</button> <button class="sm" id="pag-despues">Siguientes →</button></span></div>
    </div>

    <div class="caja plegable" id="caja-examen">
      <h2>Examen: ¿responde como se le enseñó? <span class="sep"></span><span class="flecha">▾</span></h2>
      <div class="cuerpo">
        <p class="muted">A cada lección se le hace su pregunta al asistente de verdad y se comprueba que diga los mismos datos (precios, plazos, condiciones) y hable de lo mismo. Con miles de lecciones tarda: corre en el servidor y puedes seguir trabajando.</p>
        <div class="fila">
          <div><label for="ex-tema">Tema</label><select id="ex-tema"><option value="">Todos</option></select></div>
          <div><label for="ex-origen">De dónde</label><select id="ex-origen"><option value="">De cualquier sitio</option><option value="manual">A mano</option><option value="importado">Importadas</option><option value="chat">Aprendidas de los chats</option><option value="correccion">Correcciones</option><option value="api">De otro sistema</option></select></div>
          <div><label for="ex-muestra">Cuántas</label><select id="ex-muestra"><option value="">Todas</option><option value="50">Una muestra de 50</option><option value="200">Una muestra de 200</option><option value="500">Una muestra de 500</option><option value="1000">Una muestra de 1000</option></select></div>
          <div class="fijo"><label>&nbsp;</label><label class="linea" style="margin:0"><input type="checkbox" id="ex-fallidas"> Solo las que fallaron</label></div>
          <div class="fijo"><label>&nbsp;</label><button class="primary" id="ex-correr">Examinar</button></div>
        </div>
        <div id="ex-progreso"></div>
        <div id="ex-historial" style="margin-top:12px"></div>
        <div id="ex-detalle" style="margin-top:12px"></div>
      </div>
    </div>
  </div>

  <div>
    <div class="caja">
      <h2><span class="paso">1</span> Enséñale una cosa</h2>
      <div class="cuerpo">
        <div class="tipos">
          <label><input type="radio" name="e-tipo" value="ejemplo" checked><span>Un ejemplo</span></label>
          <label><input type="radio" name="e-tipo" value="dato"><span>Un dato</span></label>
          <label><input type="radio" name="e-tipo" value="regla"><span>Una regla</span></label>
        </div>
        <div id="e-caja-pregunta"><label for="e-pregunta">Cuando el cliente diga…</label><textarea id="e-pregunta" rows="2" placeholder="¿Hacen envíos a provincias?"></textarea></div>
        <label for="e-respuesta" id="e-etiqueta-respuesta">…responder</label>
        <textarea id="e-respuesta" rows="3" placeholder="Sí, enviamos a todo el Perú. A provincias llega en 2 a 3 días hábiles y cuesta S/ 15."></textarea>
        <label for="e-tema">Tema (opcional)</label>
        <input id="e-tema" list="temas-lista" placeholder="envíos, pagos, precios…">
        <datalist id="temas-lista"></datalist>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center"><button class="primary" id="e-guardar">Enseñar</button><span class="muted" id="e-resultado"></span></div>
      </div>
    </div>

    <div class="caja">
      <h2><span class="paso">2</span> Trae muchas de golpe</h2>
      <div class="cuerpo">
        <p class="muted">Un Excel o CSV con las columnas <b>pregunta</b>, <b>respuesta</b> y <b>tema</b> (o sin cabecera: primera columna la pregunta, segunda la respuesta). También un chat exportado de WhatsApp, un JSON, o líneas «Cliente: …» / «Tú: …». Las repetidas no entran dos veces.</p>
        <textarea id="i-texto" rows="5" placeholder="Pega aquí la tabla, el chat o las líneas…&#10;&#10;¿Hacen envíos a provincias? => Sí, a todo el Perú en 2 a 3 días.&#10;Envío gratis desde S/ 150 en Lima."></textarea>
        <div class="drop" id="i-drop">Arrastra un fichero aquí o <u>elígelo</u> (xlsx, csv, txt, json)<input type="file" id="i-fichero" accept=".xlsx,.xlsm,.csv,.tsv,.txt,.json"></div>
        <div id="i-fichero-nombre" class="nota" style="margin-top:6px"></div>
        <div class="fila" style="margin-top:8px">
          <div><label for="i-tema">Tema para todas (opcional)</label><input id="i-tema" list="temas-lista" placeholder="envíos"></div>
          <div><label for="i-yosoy">En un chat exportado: tu nombre en el chat</label><input id="i-yosoy" placeholder="como aparece en el chat"></div>
        </div>
        <label class="linea"><input type="checkbox" id="i-revisar"> Revisar antes de usarlas (quedan pendientes hasta que las apruebes)</label>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button id="i-previa">Ver qué entendió</button><button class="primary" id="i-importar">Importar</button><span class="muted" id="i-resultado"></span></div>
        <div id="i-vista" class="previa hidden"></div>
      </div>
    </div>

    <div class="caja">
      <h2><span class="paso">3</span> Que aprenda de tus conversaciones</h2>
      <div class="cuerpo">
        <p class="muted">Recorre todos los chats y saca cada pregunta de un cliente con lo que <b>una persona del negocio</b> le contestó (lo que mandó el propio asistente o el sistema no cuenta). Teléfonos, DNI y correos se tapan. Después la IA puede <b>pulirlas</b>: quitar lo personal, quedarse con las que sirven y ponerles tema.</p>
        <div class="fila">
          <div><label for="a-desde">Solo desde esta fecha (opcional)</label><input type="date" id="a-desde"></div>
          <div class="fijo"><label>&nbsp;</label><button class="primary" id="a-correr">Aprender de los chats</button></div>
        </div>
        <label class="linea"><input type="checkbox" id="a-revisar" checked> Revisar antes de usarlas (recomendado: quedan pendientes)</label>
        <div id="a-progreso"></div>
        <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
          <div class="fila">
            <div><label for="p-limite">Pulir con la IA las pendientes</label><select id="p-limite"><option value="100">Las 100 más antiguas</option><option value="500" selected>Hasta 500</option><option value="2000">Hasta 2000</option><option value="5000">Hasta 5000</option></select></div>
            <div class="fijo"><label>&nbsp;</label><button id="p-correr">Pulir con la IA</button></div>
          </div>
          <label class="linea"><input type="checkbox" id="p-activar"> Poner en uso las que la IA dé por buenas (sin revisarlas yo)</label>
          <div id="p-progreso"></div>
        </div>
      </div>
    </div>

    <div class="caja plegable cerrada" id="caja-probar">
      <h2>¿Qué usaría para responder? <span class="sep"></span><span class="flecha">▾</span></h2>
      <div class="cuerpo">
        <p class="muted">Escribe un mensaje como si fueras un cliente y verás qué lecciones elegiría el asistente para contestarlo (sin preguntarle a la IA).</p>
        <div class="fila"><div><input id="pr-texto" placeholder="cuanto cuesta el envio a trujillo?"></div><div class="fijo"><button id="pr-ver">Ver</button></div></div>
        <div id="pr-salida" class="elegidas"></div>
      </div>
    </div>
  </div>
</div>
</div>
`;

  const script = String.raw`
async function api(path, options) {
  options = options || {};
  var res = await fetch(path, {
    method: options.method || 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) { var e = new Error(data.error || errorHttp(res.status)); e.datos = data; throw e; }
  return data;
}
function esc(v) {
  return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function toast(texto) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = texto;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 5000);
}
function cuando(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var hoy = new Date();
  var misma = d.toDateString() === hoy.toDateString();
  var hora = d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  return misma ? 'hoy ' + hora : d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + hora;
}
function acortar(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
function val(id) { return (document.getElementById(id).value || '').trim(); }
function ver(id, visible) { var el = document.getElementById(id); if (el) el.classList.toggle('hidden', !visible); }
function marcado(id) { return document.getElementById(id).checked; }
function lecciones(n) { return n + (n === 1 ? ' lección' : ' lecciones'); }

var TIPO = { ejemplo: 'Ejemplo', dato: 'Dato', regla: 'Regla' };
var ORIGEN = { manual: 'a mano', importado: 'importada', chat: 'de un chat', correccion: 'corrección', ia: 'la IA', api: 'otro sistema' };
var ESTADO = { activa: ['ok', 'en uso'], pendiente: ['warn', 'por revisar'], descartada: ['gris', 'descartada'] };
var TRABAJO = { aprender: 'Aprendiendo de los chats', pulir: 'Puliendo con la IA', examen: 'Examinando' };

var resumen = null;
var pagina = 1;
var lista = { items: [], total: 0, paginas: 1 };
var marcadas = {};
var examenElegido = null;
var haciaTrabajo = false;

/* ---------------------------------------------------------- resumen */

function pintarResumen() {
  var c = resumen.cifras;
  var activas = c.porEstado.activa || 0;
  document.getElementById('sabe-n').textContent = lecciones(activas);
  var partes = [];
  if (c.porTipo.ejemplo) partes.push(c.porTipo.ejemplo + ' ejemplo' + (c.porTipo.ejemplo === 1 ? '' : 's'));
  if (c.porTipo.dato) partes.push(c.porTipo.dato + ' dato' + (c.porTipo.dato === 1 ? '' : 's'));
  if (c.porTipo.regla) partes.push(c.porTipo.regla + ' regla' + (c.porTipo.regla === 1 ? '' : 's'));
  document.getElementById('sabe-texto').textContent = activas ? 'en uso: ' + partes.join(', ') + '.' : 'Todavía no le has enseñado nada: empieza por la derecha.';

  var ultimo = null;
  for (var i = 0; i < resumen.examenes.length; i++) if (resumen.examenes[i].estado !== 'corriendo') { ultimo = resumen.examenes[i]; break; }
  var pct = ultimo && ultimo.detalle && typeof ultimo.detalle.porcentaje === 'number' ? ultimo.detalle.porcentaje : null;
  var pendientes = c.porEstado.pendiente || 0;
  var html =
    '<div class="tarjeta ' + (pendientes ? 'warn pulsable' : '') + '" data-filtro="pendiente"><div class="n">' + pendientes + '</div><div class="q">pendientes de revisar' + (pendientes ? ' · pulsa para verlas' : '') + '</div></div>' +
    '<div class="tarjeta ' + (pct === null ? '' : pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'bad') + '"><div class="n">' + (pct === null ? '—' : pct + ' %') + '</div><div class="q">' + (ultimo ? 'último examen: ' + ultimo.aprobados + ' bien de ' + (ultimo.aprobados + ultimo.fallados) + ' · ' + cuando(ultimo.terminadoAt || ultimo.empezadoAt) : 'sin examen todavía') + '</div></div>' +
    '<div class="tarjeta ' + (c.fallanExamen ? 'bad pulsable' : '') + '" data-filtro="mal"><div class="n">' + c.fallanExamen + '</div><div class="q">en uso que fallaron su examen' + (c.fallanExamen ? ' · pulsa para verlas' : '') + '</div></div>' +
    '<div class="tarjeta"><div class="n">' + c.sinExaminar + '</div><div class="q">en uso sin examinar aún</div></div>';
  document.getElementById('tarjetas').innerHTML = html;
  var pend = document.getElementById('aprobar-pendientes');
  pend.classList.toggle('hidden', !pendientes);
  pend.textContent = 'Aprobar todas las pendientes (' + pendientes + ')';

  var temas = resumen.temas || [];
  var opciones = '<option value="">Cualquier tema</option>' + temas.map(function (t) { return '<option value="' + esc(t.tema) + '">' + esc(t.tema) + ' (' + t.total + ')</option>'; }).join('');
  ['f-tema', 'ex-tema'].forEach(function (id) {
    var sel = document.getElementById(id);
    var antes = sel.value;
    sel.innerHTML = id === 'ex-tema' ? opciones.replace('Cualquier tema', 'Todos') : opciones;
    sel.value = antes;
  });
  document.getElementById('temas-lista').innerHTML = temas.map(function (t) { return '<option value="' + esc(t.tema) + '">'; }).join('');

  pintarTrabajos();
  pintarExamenes();
}

/* ---------------------------------------------------------- trabajos */

function trabajoDe(tipo) {
  var t = (resumen && resumen.trabajos || []).filter(function (x) { return x.tipo === tipo; })[0];
  return t || null;
}

function barra(t, textoHecho) {
  if (!t) return '';
  var pct = t.total ? Math.round(100 * t.hecho / t.total) : (t.estado === 'corriendo' ? 0 : 100);
  var clase = t.estado === 'fallo' ? ' mal' : '';
  var estado = t.estado === 'corriendo' ? TRABAJO[t.tipo] + '… ' + t.hecho + ' de ' + t.total
    : t.estado === 'terminado' ? 'Terminado ' + cuando(t.terminadoAt)
    : t.estado === 'cancelado' ? 'Cancelado ' + cuando(t.terminadoAt)
    : 'Falló: ' + (t.error || '');
  return '<div class="progreso"><div class="barra' + clase + '"><i style="width:' + pct + '%"></i></div>' +
    '<div class="texto"><span>' + esc(estado) + '</span><span class="sep" style="flex:1"></span>' + (textoHecho ? '<span>' + textoHecho + '</span>' : '') +
    (t.estado === 'corriendo' ? '<button class="sm" data-cancelar="' + t.tipo + '">Cancelar</button>' : '') + '</div></div>';
}

function pintarTrabajos() {
  var a = trabajoDe('aprender');
  var r = a ? a.resumen : {};
  document.getElementById('a-progreso').innerHTML = barra(a, a ? (r.pares || 0) + ' respuestas encontradas · ' + (r.nuevas || 0) + ' nuevas' + (r.repetidas ? ' · ' + r.repetidas + ' ya estaban' : '') : '');
  var p = trabajoDe('pulir');
  var rp = p ? p.resumen : {};
  document.getElementById('p-progreso').innerHTML = barra(p, p ? (rp.utiles || 0) + ' útiles · ' + (rp.descartadas || 0) + ' descartadas' + (rp.repetidas ? ' · ' + rp.repetidas + ' repetidas' : '') + (rp.sinRespuesta ? ' · ' + rp.sinRespuesta + ' sin respuesta de la IA' : '') : '');
  var e = trabajoDe('examen');
  var re = e ? e.resumen : {};
  document.getElementById('ex-progreso').innerHTML = barra(e, e ? (re.aprobados || 0) + ' bien · ' + (re.fallados || 0) + ' mal' + (re.errores ? ' · ' + re.errores + ' sin respuesta' : '') : '');
  var corriendo = (resumen.trabajos || []).some(function (t) { return t.estado === 'corriendo'; });
  document.getElementById('a-correr').disabled = Boolean(a && a.estado === 'corriendo');
  document.getElementById('p-correr').disabled = Boolean(p && p.estado === 'corriendo');
  document.getElementById('ex-correr').disabled = Boolean(e && e.estado === 'corriendo');
  if (haciaTrabajo && !corriendo) { haciaTrabajo = false; cargarLecciones().catch(function () {}); }
  haciaTrabajo = corriendo;
}

document.addEventListener('click', async function (ev) {
  var b = ev.target.closest('[data-cancelar]');
  if (!b) return;
  b.disabled = true;
  try { await api('/admin/entrenamiento/trabajos/' + b.getAttribute('data-cancelar') + '/cancelar', { method: 'POST', body: {} }); toast('Se está parando…'); }
  catch (e) { toast(e.message); }
});

/* ---------------------------------------------------------- lecciones */

function filtroActual() {
  return {
    q: val('f-q'), estado: val('f-estado'), tipo: val('f-tipo'), tema: val('f-tema'), origen: val('f-origen'), examen: val('f-examen')
  };
}

function consulta(f, extra) {
  var partes = [];
  Object.keys(f).forEach(function (k) { if (f[k]) partes.push(k + '=' + encodeURIComponent(f[k])); });
  (extra || []).forEach(function (p) { partes.push(p); });
  return partes.length ? '?' + partes.join('&') : '';
}

async function cargarLecciones() {
  var f = filtroActual();
  lista = await api('/admin/entrenamiento/lecciones' + consulta(f, ['pagina=' + pagina, 'limite=50']));
  pintarLecciones();
}

function examenHtml(l) {
  if (l.examenOk === true) return '<span class="pill ok" title="' + esc(cuando(l.examenAt)) + '">examen: bien</span>';
  if (l.examenOk === false) return '<span class="pill bad" title="' + esc(l.examenNota || '') + '">examen: mal</span><span title="' + esc(l.examenNota || '') + '">' + esc(acortar(l.examenNota || '', 90)) + '</span>';
  return '<span class="pill gris">sin examinar</span>';
}

function pintarLecciones() {
  var cuerpo = document.getElementById('filas');
  document.getElementById('lecciones-total').textContent = lista.total ? lecciones(lista.total) : '';
  if (!lista.items.length) {
    cuerpo.innerHTML = '<tr><td colspan="3" class="vacio">' + (lista.total === 0 && !val('f-q') && !val('f-estado') && !val('f-tipo') && !val('f-tema') && !val('f-origen') && !val('f-examen') ? 'Todavía no hay lecciones. Enséñale algo a la derecha.' : 'Nada con esos filtros.') + '</td></tr>';
  } else {
    cuerpo.innerHTML = lista.items.map(function (l) {
      var est = ESTADO[l.estado] || ['gris', l.estado];
      var dice = l.tipo === 'ejemplo'
        ? '<div class="dice">' + esc(l.pregunta || '') + '</div><div class="resp">' + esc(l.respuesta) + '</div>'
        : '<div class="dice"><span class="pill info">' + TIPO[l.tipo] + '</span> ' + esc(l.pregunta ? l.pregunta + ': ' : '') + esc(l.respuesta) + '</div>';
      var de = (ORIGEN[l.origen] || l.origen) + (l.origenDetalle ? ' · ' + acortar(l.origenDetalle, 40) : '');
      var etiquetas = '<span class="pill ' + est[0] + '">' + est[1] + '</span>' +
        (l.tema ? '<span class="pill gris">' + esc(l.tema) + '</span>' : '') +
        '<span title="De dónde vino">' + esc(de) + '</span>' +
        (l.tipo === 'ejemplo' ? examenHtml(l) : '') +
        (l.usos ? '<span>· usada ' + l.usos + ' ' + (l.usos === 1 ? 'vez' : 'veces') + '</span>' : '') +
        (l.nota ? '<span>· ' + esc(acortar(l.nota, 90)) + '</span>' : '');
      var acciones = '<button class="sm" data-editar="' + l.id + '">Editar</button>';
      if (l.estado !== 'activa') acciones += '<button class="sm" data-aprobar="' + l.id + '">Aprobar</button>';
      if (l.estado !== 'descartada') acciones += '<button class="sm" data-descartar="' + l.id + '">Descartar</button>';
      acciones += '<button class="sm peligro" data-borrar="' + l.id + '">Borrar</button>';
      return '<tr>' +
        '<td><input type="checkbox" data-marcar="' + l.id + '"' + (marcadas[l.id] ? ' checked' : '') + '></td>' +
        '<td class="leccion">' + dice + (l.mala ? '<span class="mala">No debe decir: «' + esc(acortar(l.mala, 140)) + '»</span>' : '') + '<div class="etiquetas">' + etiquetas + '</div></td>' +
        '<td><div class="acciones">' + acciones + '</div></td>' +
        '</tr>';
    }).join('');
  }
  document.getElementById('pag-texto').textContent = lista.total ? 'Página ' + lista.pagina + ' de ' + lista.paginas : '';
  document.getElementById('pag-antes').disabled = lista.pagina <= 1;
  document.getElementById('pag-despues').disabled = lista.pagina >= lista.paginas;
  pintarSeleccion();
}

function idsMarcados() { return Object.keys(marcadas).filter(function (k) { return marcadas[k]; }).map(Number); }
function pintarSeleccion() {
  var n = idsMarcados().length;
  document.getElementById('sel-cuantas').textContent = n ? n + ' marcada' + (n === 1 ? '' : 's') : '';
  ['sel-aprobar', 'sel-descartar', 'sel-borrar'].forEach(function (id) { document.getElementById(id).disabled = !n; });
}

document.getElementById('filas').addEventListener('change', function (ev) {
  var c = ev.target.closest('[data-marcar]');
  if (!c) return;
  marcadas[c.getAttribute('data-marcar')] = c.checked;
  pintarSeleccion();
});
document.getElementById('sel-todas').onchange = function () {
  var on = this.checked;
  lista.items.forEach(function (l) { marcadas[l.id] = on; });
  pintarLecciones();
};

async function enMasa(accion, cuerpo, pregunta) {
  if (pregunta && !(await confirmarDialogo(pregunta))) return;
  try {
    var r = await api('/admin/entrenamiento/lecciones/lote', { method: 'POST', body: Object.assign({ accion: accion }, cuerpo) });
    toast(r.mensaje);
    marcadas = {};
    document.getElementById('sel-todas').checked = false;
    await cargar();
  } catch (e) { toast(e.message); }
}
document.getElementById('sel-aprobar').onclick = function () { enMasa('aprobar', { ids: idsMarcados() }); };
document.getElementById('sel-descartar').onclick = function () { enMasa('descartar', { ids: idsMarcados() }); };
document.getElementById('sel-borrar').onclick = function () { enMasa('borrar', { ids: idsMarcados() }, { titulo: 'Borrar ' + idsMarcados().length + ' lecciones', texto: 'Se borran del todo. Si solo quieres que no se usen, descártalas.', boton: 'Borrar', peligro: true }); };
document.getElementById('aprobar-pendientes').onclick = function () {
  var n = resumen.cifras.porEstado.pendiente || 0;
  enMasa('aprobar', { estado: 'pendiente' }, { titulo: 'Aprobar ' + n + ' lecciones pendientes', texto: 'Pasan a usarse desde ya en las respuestas del asistente. Puedes descartar o borrar cualquiera después.', boton: 'Aprobar todas' });
};

document.getElementById('filas').addEventListener('click', async function (ev) {
  var b = ev.target.closest('button');
  if (!b) return;
  var id = b.getAttribute('data-editar') || b.getAttribute('data-aprobar') || b.getAttribute('data-descartar') || b.getAttribute('data-borrar');
  var l = lista.items.filter(function (x) { return String(x.id) === id; })[0];
  if (!l) return;
  try {
    if (b.hasAttribute('data-aprobar')) { await api('/admin/entrenamiento/lecciones/' + id, { method: 'PATCH', body: { estado: 'activa' } }); toast('En uso.'); }
    else if (b.hasAttribute('data-descartar')) { await api('/admin/entrenamiento/lecciones/' + id, { method: 'PATCH', body: { estado: 'descartada' } }); toast('Descartada: el asistente ya no la usa.'); }
    else if (b.hasAttribute('data-borrar')) {
      if (!(await confirmarDialogo({ titulo: 'Borrar esta lección', texto: acortar(l.pregunta || l.respuesta, 140), boton: 'Borrar', peligro: true }))) return;
      await api('/admin/entrenamiento/lecciones/' + id, { method: 'DELETE' });
      toast('Borrada.');
    } else if (b.hasAttribute('data-editar')) {
      if (l.tipo === 'ejemplo') {
        var v = await pedirLeccion({ titulo: 'Cambiar este ejemplo', pregunta: l.pregunta, respuesta: l.respuesta, tema: l.tema, mala: l.mala, boton: 'Guardar' });
        if (!v) return;
        await api('/admin/entrenamiento/lecciones/' + id, { method: 'PATCH', body: { pregunta: v.pregunta, respuesta: v.respuesta, tema: v.tema || null } });
      } else {
        var t = await pedirDato({ titulo: l.tipo === 'dato' ? 'Cambiar este dato' : 'Cambiar esta regla', valor: l.respuesta, boton: 'Guardar' });
        if (t === null) return;
        await api('/admin/entrenamiento/lecciones/' + id, { method: 'PATCH', body: { respuesta: t } });
      }
      toast('Guardado.');
    }
    await cargar();
  } catch (e) { toast(e.message); }
});

['f-estado', 'f-tipo', 'f-tema', 'f-origen', 'f-examen'].forEach(function (id) {
  document.getElementById(id).onchange = function () { pagina = 1; cargarLecciones().catch(function (e) { toast(e.message); }); };
});
var buscando = null;
document.getElementById('f-q').oninput = function () {
  clearTimeout(buscando);
  buscando = setTimeout(function () { pagina = 1; cargarLecciones().catch(function (e) { toast(e.message); }); }, 300);
};
document.getElementById('pag-antes').onclick = function () { if (pagina > 1) { pagina--; cargarLecciones(); } };
document.getElementById('pag-despues').onclick = function () { if (pagina < lista.paginas) { pagina++; cargarLecciones(); } };
document.getElementById('tarjetas').addEventListener('click', function (ev) {
  var t = ev.target.closest('.tarjeta.pulsable');
  if (!t) return;
  var f = t.getAttribute('data-filtro');
  document.getElementById('f-estado').value = f === 'pendiente' ? 'pendiente' : 'activa';
  document.getElementById('f-examen').value = f === 'mal' ? 'mal' : '';
  pagina = 1;
  cargarLecciones().catch(function (e) { toast(e.message); });
  document.getElementById('caja-lecciones').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------------------------------------------------------- ensenar */

function tipoElegido() { return document.querySelector('input[name=e-tipo]:checked').value; }
function pintarTipo() {
  var t = tipoElegido();
  ver('e-caja-pregunta', t === 'ejemplo');
  document.getElementById('e-etiqueta-respuesta').textContent = t === 'ejemplo' ? '…responder' : t === 'dato' ? 'El dato (como se lo dirías a un empleado nuevo)' : 'La regla (qué hacer o qué no hacer)';
  document.getElementById('e-respuesta').placeholder = t === 'ejemplo' ? 'Sí, enviamos a todo el Perú. A provincias llega en 2 a 3 días hábiles y cuesta S/ 15.' : t === 'dato' ? 'Los envíos a Trujillo tardan 2 días y cuestan S/ 15.' : 'Nunca prometas una fecha exacta de entrega: di "suele llegar en".';
}
document.querySelectorAll('input[name=e-tipo]').forEach(function (r) { r.onchange = pintarTipo; });
pintarTipo();

document.getElementById('e-guardar').onclick = async function () {
  var tipo = tipoElegido();
  var salida = document.getElementById('e-resultado');
  var body = { tipo: tipo, pregunta: tipo === 'ejemplo' ? val('e-pregunta') : null, respuesta: val('e-respuesta'), tema: val('e-tema') || null, origen: 'manual' };
  if (tipo === 'ejemplo' && !body.pregunta) { salida.textContent = 'Escribe lo que dice el cliente.'; return; }
  if (body.respuesta.length < 2) { salida.textContent = tipo === 'ejemplo' ? 'Escribe lo que hay que responder.' : 'Escribe el texto.'; return; }
  this.disabled = true;
  try {
    var r = await api('/admin/entrenamiento/lecciones', { method: 'POST', body: body });
    salida.textContent = r.mensaje;
    document.getElementById('e-pregunta').value = '';
    document.getElementById('e-respuesta').value = '';
    await cargar();
  } catch (e) { salida.textContent = e.message; }
  this.disabled = false;
};

/* ---------------------------------------------------------- importar */

var fichero = null;
function leerFichero(f) {
  return new Promise(function (resolver, rechazar) {
    var lector = new FileReader();
    lector.onload = function () { resolver(String(lector.result).split(',')[1] || ''); };
    lector.onerror = function () { rechazar(new Error('No se pudo leer el fichero.')); };
    lector.readAsDataURL(f);
  });
}
function elegirFichero(f) {
  if (!f) return;
  if (f.size > 20 * 1024 * 1024) { toast('El fichero pesa más de 20 MB: pártelo.'); return; }
  fichero = f;
  document.getElementById('i-fichero-nombre').textContent = 'Fichero: ' + f.name + ' (' + Math.round(f.size / 1024) + ' KB)';
  ver('i-vista', false);
}
var drop = document.getElementById('i-drop');
drop.onclick = function () { document.getElementById('i-fichero').click(); };
document.getElementById('i-fichero').onchange = function () { elegirFichero(this.files[0]); };
drop.ondragover = function (ev) { ev.preventDefault(); drop.classList.add('sobre'); };
drop.ondragleave = function () { drop.classList.remove('sobre'); };
drop.ondrop = function (ev) { ev.preventDefault(); drop.classList.remove('sobre'); elegirFichero(ev.dataTransfer.files[0]); };

async function cuerpoImportacion() {
  var body = { texto: val('i-texto') || undefined, tema: val('i-tema') || undefined, yoSoy: val('i-yosoy') || undefined, revisar: marcado('i-revisar') };
  if (fichero) { body.base64 = await leerFichero(fichero); body.nombre = fichero.name; }
  if (!body.texto && !body.base64) throw new Error('Pega un texto o elige un fichero.');
  return body;
}

var FORMATO = { excel: 'una hoja de Excel', tabla: 'una tabla', json: 'un JSON', whatsapp: 'un chat exportado de WhatsApp', dialogo: 'un diálogo Cliente/Tú', lineas: 'líneas sueltas', vacio: 'nada' };
function pintarVista(v, importado) {
  var caja = document.getElementById('i-vista');
  var html = '<b>' + (importado ? esc(v.mensaje) : 'Se entendió como ' + FORMATO[v.formato] + ': ' + lecciones(v.total)) + '</b>';
  var tipos = Object.keys(v.porTipo || {}).map(function (t) { return v.porTipo[t] + ' ' + TIPO[t].toLowerCase() + (v.porTipo[t] === 1 ? '' : 's'); });
  if (tipos.length) html += '<div class="nota">' + tipos.join(' · ') + (v.descartadas ? ' · ' + v.descartadas + ' línea' + (v.descartadas === 1 ? '' : 's') + ' sin usar' : '') + '</div>';
  if (v.autores && v.autores.length) html += '<div class="nota">Hablan: ' + v.autores.map(esc).join(', ') + '. Se tomó como negocio a <b>' + esc(v.negocio) + '</b>.</div>';
  (v.avisos || []).forEach(function (a) { html += '<div class="nota" style="color:var(--warn)">' + esc(a) + '</div>'; });
  if (v.muestra && v.muestra.length) {
    html += '<ul>' + v.muestra.slice(0, 8).map(function (f) {
      return '<li>' + (f.tipo !== 'ejemplo' ? '<span class="pill info">' + TIPO[f.tipo] + '</span> ' : '') + (f.pregunta ? '<b>' + esc(acortar(f.pregunta, 70)) + '</b> → ' : '') + esc(acortar(f.respuesta, 90)) + (f.tema ? ' <span class="muted">(' + esc(f.tema) + ')</span>' : '') + '</li>';
    }).join('') + (v.total > 8 ? '<li class="muted">… y ' + (v.total - 8) + ' más</li>' : '') + '</ul>';
  }
  if (v.descartadasMuestra && v.descartadasMuestra.length) {
    html += '<div class="nota" style="margin-top:6px">Sin usar: ' + v.descartadasMuestra.slice(0, 3).map(function (d) { return 'línea ' + d.linea + ' (' + esc(d.motivo) + ')'; }).join(', ') + '</div>';
  }
  caja.innerHTML = html;
  caja.classList.remove('hidden');
}
document.getElementById('i-previa').onclick = async function () {
  var salida = document.getElementById('i-resultado');
  salida.textContent = 'Leyendo…';
  this.disabled = true;
  try { pintarVista(await api('/admin/entrenamiento/importar/previa', { method: 'POST', body: await cuerpoImportacion() }), false); salida.textContent = ''; }
  catch (e) { salida.textContent = e.message; }
  this.disabled = false;
};
document.getElementById('i-importar').onclick = async function () {
  var salida = document.getElementById('i-resultado');
  salida.textContent = 'Importando…';
  this.disabled = true;
  try {
    var r = await api('/admin/entrenamiento/importar', { method: 'POST', body: await cuerpoImportacion() });
    pintarVista(r, true);
    salida.textContent = '';
    if (r.nuevas) { document.getElementById('i-texto').value = ''; fichero = null; document.getElementById('i-fichero-nombre').textContent = ''; }
    await cargar();
  } catch (e) { salida.textContent = e.message; }
  this.disabled = false;
};

/* ---------------------------------------------------------- aprender y pulir */

document.getElementById('a-correr').onclick = async function () {
  var desde = val('a-desde');
  var ok = await confirmarDialogo({ titulo: 'Aprender de las conversaciones', texto: 'Se recorren todos los chats' + (desde ? ' desde el ' + desde : '') + ' y se guarda cada respuesta que dio una persona del negocio' + (marcado('a-revisar') ? ' como pendiente de revisar.' : ' y se pone en uso desde ya.') + ' Tarda unos minutos si hay muchos chats.', boton: 'Empezar' });
  if (!ok) return;
  try {
    await api('/admin/entrenamiento/aprender', { method: 'POST', body: { desde: desde || undefined, revisar: marcado('a-revisar') } });
    toast('Aprendiendo… la barra va avanzando.');
    await cargar();
  } catch (e) { toast(e.message); }
};
document.getElementById('p-correr').onclick = async function () {
  try {
    await api('/admin/entrenamiento/pulir', { method: 'POST', body: { limite: Number(val('p-limite') || 500), activar: marcado('p-activar') } });
    toast('Puliendo con la IA…');
    await cargar();
  } catch (e) { toast(e.message + (e.datos && e.datos.ir ? ' → ' + e.datos.ir : '')); }
};

/* ---------------------------------------------------------- examen */

function pctHtml(e) {
  var pct = e.detalle && typeof e.detalle.porcentaje === 'number' ? e.detalle.porcentaje : null;
  if (pct === null) return '<span class="muted">—</span>';
  return '<span class="porcentaje ' + (pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'bad') + '">' + pct + ' %</span>';
}
function pintarExamenes() {
  var caja = document.getElementById('ex-historial');
  var lista = resumen.examenes || [];
  if (!lista.length) { caja.innerHTML = '<div class="muted">Todavía no se ha hecho ningún examen.</div>'; return; }
  caja.innerHTML = '<table><thead><tr><th>Cuándo</th><th>Qué se examinó</th><th>Nota</th><th>Bien</th><th>Mal</th><th></th></tr></thead><tbody>' + lista.map(function (e) {
    return '<tr class="examen-fila' + (examenElegido === e.id ? ' elegida' : '') + '" data-examen="' + e.id + '"><td>' + esc(cuando(e.empezadoAt)) + '</td><td>' + esc(e.nombre || '') + (e.estado === 'corriendo' ? ' <span class="pill warn">en marcha</span>' : e.estado === 'cancelado' ? ' <span class="pill gris">cancelado</span>' : '') + '</td><td>' + pctHtml(e) + '</td><td>' + e.aprobados + '</td><td>' + e.fallados + (e.errores ? ' <span class="muted">(+' + e.errores + ' sin respuesta)</span>' : '') + '</td><td><button class="sm">Ver fallos</button></td></tr>';
  }).join('') + '</tbody></table>';
}
document.getElementById('ex-historial').addEventListener('click', async function (ev) {
  var fila = ev.target.closest('[data-examen]');
  if (!fila) return;
  examenElegido = Number(fila.getAttribute('data-examen'));
  pintarExamenes();
  var caja = document.getElementById('ex-detalle');
  caja.innerHTML = '<div class="muted">Cargando…</div>';
  try {
    var r = await api('/admin/entrenamiento/examenes/' + examenElegido + '?fallos=1');
    if (!r.casos.length) { caja.innerHTML = '<div class="resultado">Ninguna falló en este examen.</div>'; return; }
    caja.innerHTML = '<div class="nota" style="margin-bottom:6px">' + r.casos.length + ' que fallaron. Corrige la lección o añade una regla, y vuelve a examinar «solo las que fallaron».</div>' +
      '<div class="tabla-scroll"><table><thead><tr><th>El cliente dice</th><th>Se le enseñó</th><th>Respondió</th><th>Por qué falló</th></tr></thead><tbody>' + r.casos.map(function (c) {
        return '<tr><td class="texto">' + esc(c.pregunta) + '</td><td class="texto">' + esc(c.esperada) + '</td><td class="texto">' + esc(c.respuesta || '(sin respuesta)') + '</td><td>' + (c.motivos || []).map(function (m) { return '<span class="pill bad">' + esc(m) + '</span>'; }).join(' ') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  } catch (e) { caja.innerHTML = '<div class="muted">' + esc(e.message) + '</div>'; }
});
document.getElementById('ex-correr').onclick = async function () {
  try {
    var muestra = val('ex-muestra');
    await api('/admin/entrenamiento/examen', { method: 'POST', body: { tema: val('ex-tema') || undefined, origen: val('ex-origen') || undefined, muestra: muestra ? Number(muestra) : undefined, soloFallidas: marcado('ex-fallidas') } });
    toast('Examinando… cada pregunta tarda unos segundos.');
    document.getElementById('caja-examen').classList.remove('cerrada');
    await cargar();
  } catch (e) { toast(e.message + (e.datos && e.datos.ir ? ' → ' + e.datos.ir : '')); }
};

/* ---------------------------------------------------------- probar */

document.getElementById('pr-ver').onclick = async function () {
  var texto = val('pr-texto');
  if (!texto) return;
  var caja = document.getElementById('pr-salida');
  caja.innerHTML = '<div class="muted">Buscando…</div>';
  try {
    var r = await api('/admin/entrenamiento/probar', { method: 'POST', body: { texto: texto } });
    var html = '';
    if (r.ejemplos.length) html += '<h4>Ejemplos que imitaría</h4>' + r.ejemplos.map(function (l) { return '<div class="item"><span class="sub">Cliente: ' + esc(l.pregunta) + '</span>' + esc(l.respuesta) + '</div>'; }).join('');
    if (r.datos.length) html += '<h4>Datos que tendría en cuenta</h4>' + r.datos.map(function (l) { return '<div class="item">' + esc((l.pregunta ? l.pregunta + ': ' : '') + l.respuesta) + '</div>'; }).join('');
    if (r.reglas.length) html += '<h4>Reglas (van siempre)</h4>' + r.reglas.map(function (l) { return '<div class="item">' + esc(l.respuesta) + '</div>'; }).join('');
    caja.innerHTML = html || '<div class="resultado">No encontró ninguna lección parecida: respondería solo con lo escrito en Mi asistente IA. Enséñale un ejemplo con esa pregunta.</div>';
  } catch (e) { caja.innerHTML = '<div class="muted">' + esc(e.message) + '</div>'; }
};
document.getElementById('pr-texto').onkeydown = function (e) { if (e.key === 'Enter') document.getElementById('pr-ver').click(); };

/* ---------------------------------------------------------- arranque */

document.querySelectorAll('.caja.plegable > h2').forEach(function (h) { h.onclick = function () { h.parentElement.classList.toggle('cerrada'); }; });
document.getElementById('abrir-ia').onclick = function () {
  if (window.abrirOperadorIA) window.abrirOperadorIA('Enséñale al asistente que ');
  else location.href = '/manual#preguntar';
};
document.addEventListener('ia:cambio', function () { cargar().catch(function () {}); });

async function cargar() {
  resumen = await api('/admin/entrenamiento');
  pintarResumen();
  await cargarLecciones();
}

if (location.hash === '#pendientes') document.getElementById('f-estado').value = 'pendiente';
if (location.hash === '#examen') document.getElementById('caja-examen').scrollIntoView();

/* Mientras corre un trabajo se refresca cada 3 s; si no, cada 15. */
var tic = 0;
setInterval(function () {
  tic++;
  var activo = document.activeElement;
  if (activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA')) return;
  var corriendo = resumen && (resumen.trabajos || []).some(function (t) { return t.estado === 'corriendo'; });
  if (!corriendo && tic % 5 !== 0) return;
  api('/admin/entrenamiento').then(function (r) { resumen = r; pintarResumen(); }).catch(function () {});
}, 3000);
cargar().catch(function (e) { toast(e.message); });
`;

  return appShell({
    titulo: 'Entrenar a la IA',
    subtitulo: 'Enséñale a gran escala: ejemplos, datos y reglas; aprende de tus chats; examínala',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo,
    icono: '🎓',
  });
}
