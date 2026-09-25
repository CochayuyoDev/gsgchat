/**
 * Pantalla "Entrenar a la IA": ensenarle al asistente a gran escala.
 *
 * La pantalla resuelve cuatro cosas y en ese orden se leen:
 *  1. De un vistazo: cuanto sabe, que espera revision y como le fue el
 *     ultimo examen (las cuatro tarjetas de arriba, que ademas filtran).
 *  2. Ver y corregir lo que sabe (la lista, a la izquierda).
 *  3. Comprobar que responde como se le enseno (el examen y la prueba
 *     rapida, debajo de la lista).
 *  4. Ensenarle mas: una cosa a mano, muchas de golpe o de los chats
 *     reales (la columna de la derecha).
 *
 * Decisiones:
 *  - Los trabajos largos (aprender, pulir, examinar) corren en el servidor;
 *    la pantalla los pinta con una barra que se refresca sola. Mientras
 *    corren se refresca cada 3 s; si no, cada 15.
 *  - Nada tecnico: ni "indice", ni "prompt", ni "tokens". Se habla de
 *    lecciones, de lo que sabe y de si respondio como se le enseno.
 *  - El aspecto sale del sistema de diseno (tokens y clases del armazon:
 *    .btn, .tarjeta, .chip.tono-*, .vacio). Aqui solo va lo propio de esta
 *    pantalla, para que el modo oscuro y el tamano tactil salgan gratis.
 *  - El JS va en String.raw, con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';

/**
 * De donde puede venir una leccion. Una sola tabla para los dos filtros y
 * para la etiqueta de cada fila: antes estaban escritas tres veces y se
 * habian desincronizado (el filtro del examen se dejaba fuera "la IA").
 */
const ORIGENES = [
  { v: 'manual', opcion: 'A mano', fila: 'a mano' },
  { v: 'importado', opcion: 'Importadas', fila: 'importada' },
  { v: 'chat', opcion: 'Aprendidas de los chats', fila: 'de un chat' },
  { v: 'correccion', opcion: 'Correcciones', fila: 'corrección' },
  { v: 'ia', opcion: 'Puestas por la IA', fila: 'la IA' },
  { v: 'api', opcion: 'De otro sistema', fila: 'otro sistema' },
] as const;

const opcionesOrigen = (primera: string): string =>
  `<option value="">${primera}</option>` + ORIGENES.map((o) => `<option value="${o.v}">${o.opcion}</option>`).join('');

const CSS = `
  /* Solo lo propio de esta pantalla: los botones, los chips, las tarjetas y
     los estados vacios vienen del armazon, y los colores de los tokens. */
  .wrap { color: var(--texto); }
  .wrap :is(input, select, textarea) {
    width: 100%; font: inherit; color: var(--texto); background: var(--superficie);
    border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 11px;
  }
  .wrap textarea { min-height: 70px; resize: vertical; }
  .wrap label { display: block; font-size: var(--fs-small); color: var(--texto-suave); margin: var(--esp-3) 0 var(--esp-1); }
  .wrap label.linea { display: flex; align-items: center; gap: var(--esp-2); min-height: 32px; margin: var(--esp-2) 0 0; color: var(--texto); font-size: var(--fs-cuerpo); cursor: pointer; }
  .wrap label.linea input { width: auto; }
  .muted { color: var(--texto-suave); }
  .nota { font-size: var(--fs-small); color: var(--texto-suave); }
  .fila { display: flex; gap: var(--esp-2); align-items: flex-end; flex-wrap: wrap; }
  .fila > div { flex: 1; min-width: 150px; }
  .fila > div.fijo { flex: none; }
  .fila label { margin-top: 0; }
  .sep { flex: 1; }

  .aviso { background: var(--ambar-suave); color: var(--texto); border-radius: var(--radio); padding: var(--esp-3) var(--esp-4); margin-bottom: var(--esp-4); font-size: var(--fs-cuerpo); }
  .aviso b { color: var(--ambar); }
  .intro { display: flex; gap: var(--esp-3); align-items: center; flex-wrap: wrap; margin: 0 0 var(--esp-4); font-size: var(--fs-cuerpo); }

  /* --- las cuatro cifras de arriba: cada una lleva a lo que cuenta ------ */
  .tarjetas { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--esp-3); margin-bottom: var(--esp-4); }
  button.tarjeta { text-align: left; font: inherit; cursor: pointer; }
  button.tarjeta:hover { border-color: var(--primario); }
  .tarjeta .n { font-size: 24px; font-weight: 700; line-height: 1.15; }
  .tarjeta .q { font-size: var(--fs-small); color: var(--texto-suave); margin-top: 2px; }
  .tarjeta.verde .n { color: var(--verde); }
  .tarjeta.ambar .n { color: var(--ambar); }
  .tarjeta.rojo .n { color: var(--rojo); }

  /* --- las dos columnas: a la izquierda lo que sabe, a la derecha ensenar */
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: var(--esp-4); align-items: start; }
  @media (max-width: 1080px) { .cols { grid-template-columns: 1fr; } }
  .columna-titulo { margin: 0 0 var(--esp-3); font-size: var(--fs-h3); color: var(--texto-suave); text-transform: uppercase; letter-spacing: .04em; }

  .tarjeta.caja { padding: 0; overflow: hidden; margin-bottom: var(--esp-4); }
  .caja > h2 { margin: 0; font-size: var(--fs-h3); border-bottom: 1px solid var(--borde); }
  .caja > h2 .cab { display: flex; align-items: center; gap: var(--esp-2); width: 100%; padding: var(--esp-3) var(--esp-4); font: inherit; color: inherit; flex-wrap: wrap; }
  .caja > h2 button.cab { border: 0; background: transparent; text-align: left; cursor: pointer; }
  .caja > h2 button.cab:hover { color: var(--primario); }
  .caja > h2 .flecha { transition: transform .15s; }
  .caja.cerrada > h2 .flecha { transform: rotate(-90deg); }
  .caja.cerrada .cuerpo { display: none; }
  .caja .cuerpo { padding: var(--esp-4); }
  .caja .cuerpo > p { margin: 0 0 var(--esp-3); font-size: var(--fs-cuerpo); }
  .bloque { margin-top: var(--esp-4); padding-top: var(--esp-4); border-top: 1px solid var(--borde); }

  /* --- la lista de lecciones ------------------------------------------- */
  .filtros { display: flex; gap: var(--esp-2); flex-wrap: wrap; align-items: center; padding: var(--esp-3) var(--esp-4); border-bottom: 1px solid var(--borde); }
  .filtros select, .filtros input { width: auto; padding: 6px 9px; font-size: var(--fs-small); }
  .filtros input[type=search] { min-width: 210px; flex: 1; }
  .seleccion { display: flex; gap: var(--esp-2); flex-wrap: wrap; align-items: center; padding: var(--esp-2) var(--esp-4); background: var(--superficie-2); border-bottom: 1px solid var(--borde); font-size: var(--fs-small); }
  .paginas { display: flex; gap: var(--esp-2); align-items: center; justify-content: space-between; flex-wrap: wrap; padding: var(--esp-3) var(--esp-4); font-size: var(--fs-small); color: var(--texto-suave); }

  table { width: 100%; border-collapse: collapse; font-size: var(--fs-cuerpo); }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: var(--fs-small); text-transform: uppercase; letter-spacing: .03em; color: var(--texto-suave); font-weight: 600; }
  tbody tr:hover { background: var(--superficie-2); }
  td.texto { max-width: 360px; white-space: pre-wrap; word-break: break-word; }
  .tabla-scroll { max-height: 68vh; overflow: auto; }
  #filas .vacio { border: 0; background: transparent; }
  #filas td.marca { width: 28px; padding-right: 0; }
  #filas td.fin { width: 1%; white-space: nowrap; vertical-align: middle; }
  /* Cada leccion es una fila ancha: lo que dice el cliente, lo que responde
     y debajo sus etiquetas. Asi se lee igual con 900 px que con 1500. */
  .leccion .dice { font-weight: 600; white-space: pre-wrap; word-break: break-word; }
  .leccion .resp { margin-top: 3px; white-space: pre-wrap; word-break: break-word; }
  .leccion .resp::before { content: '→ '; color: var(--texto-suave); }
  .leccion .mala { display: block; color: var(--rojo); font-size: var(--fs-small); margin-top: 3px; }
  .leccion .etiquetas { display: flex; gap: var(--esp-2); flex-wrap: wrap; align-items: center; margin-top: var(--esp-2); font-size: var(--fs-small); color: var(--texto-suave); }
  .acciones { display: flex; gap: var(--esp-1); flex-wrap: nowrap; }
  /* El menu "Mas" de cada fila: un solo overlay compartido (no uno por fila,
     para no repetirlo mil veces), posicionado con JS junto al boton que lo
     abrio. position:fixed para que no lo recorte el scroll de la tabla. */
  .mas-menu { position: fixed; z-index: 40; min-width: 150px; display: flex; flex-direction: column; gap: 2px; padding: 4px; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); box-shadow: var(--sombra-2); }
  .mas-menu.hidden { display: none; }
  .mas-menu button { width: 100%; justify-content: flex-start; }

  /* --- trabajos largos: la barra dice siempre por donde va -------------- */
  .progreso { margin: var(--esp-2) 0; }
  .progreso .barra { height: 10px; background: var(--superficie-2); border: 1px solid var(--borde); border-radius: 999px; overflow: hidden; }
  .progreso .barra i { display: block; height: 100%; background: var(--primario); transition: width .4s; }
  .progreso .barra.mal i { background: var(--rojo); }
  .progreso .barra.indef i { width: 35%; animation: desliza 1.2s linear infinite; }
  @keyframes desliza { from { margin-left: -35%; } to { margin-left: 100%; } }
  @media (prefers-reduced-motion: reduce) { .progreso .barra.indef i { animation: none; width: 100%; } }
  .progreso .texto { display: flex; gap: var(--esp-2); align-items: center; flex-wrap: wrap; margin-top: var(--esp-1); font-size: var(--fs-small); color: var(--texto-suave); }

  .porcentaje { font-weight: 700; }
  .porcentaje.verde { color: var(--verde); }
  .porcentaje.ambar { color: var(--ambar); }
  .porcentaje.rojo { color: var(--rojo); }
  .examen-fila { cursor: pointer; }
  .examen-fila.elegida { background: var(--primario-suave); }
  .resultado { background: var(--superficie-2); border-radius: var(--radio-sm); padding: var(--esp-3); font-size: var(--fs-small); margin-top: var(--esp-2); }

  /* --- ensenar: tipos, vista previa y lo que usaria --------------------- */
  .tipos { display: flex; gap: var(--esp-2); flex-wrap: wrap; }
  .tipos label { margin: 0; }
  .tipos input { position: absolute; opacity: 0; pointer-events: none; }
  .tipos span { display: inline-block; padding: 8px 14px; border: 1px solid var(--borde); border-radius: 999px; font-size: var(--fs-cuerpo); color: var(--texto); cursor: pointer; }
  .tipos input:checked + span { background: var(--primario); border-color: var(--primario); color: var(--primario-texto); }
  .tipos input:focus-visible + span { outline: 2px solid var(--primario); outline-offset: 2px; }
  .drop { display: block; width: 100%; margin-top: var(--esp-2); padding: var(--esp-3); border: 2px dashed var(--borde); border-radius: var(--radio-sm); background: transparent; color: var(--texto-suave); font: inherit; font-size: var(--fs-small); text-align: center; cursor: pointer; }
  .drop:hover, .drop.sobre { border-color: var(--primario); color: var(--primario); }
  .previa { margin-top: var(--esp-3); padding: var(--esp-3); border: 1px dashed var(--borde); border-radius: var(--radio-sm); font-size: var(--fs-small); }
  .previa ul { margin: var(--esp-2) 0 0; padding-left: 18px; }
  .previa li { margin: 2px 0; }
  .elegidas h4 { margin: var(--esp-3) 0 var(--esp-1); font-size: var(--fs-small); color: var(--texto-suave); text-transform: uppercase; letter-spacing: .03em; }
  .elegidas .item { margin: var(--esp-1) 0; padding: var(--esp-2) var(--esp-3); border-left: 3px solid var(--primario); border-radius: 0 var(--radio-sm) var(--radio-sm) 0; background: var(--superficie-2); font-size: var(--fs-small); white-space: pre-wrap; }
  .elegidas .item .sub { display: block; color: var(--texto-suave); }

  .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); z-index: 50; max-width: 90vw; padding: 10px 16px; border-radius: var(--radio); background: var(--texto); color: var(--superficie); font-size: var(--fs-cuerpo); box-shadow: var(--sombra-2); }
`;

export interface EntrenamientoPageOpts {
  /** false = este arranque no tiene entrenamiento (demo vieja). */
  disponible: boolean;
  /** Si hay Puter (o clave) conectado: sin eso no hay examen ni pulido. */
  conIA: boolean;
  demo?: boolean;
  nombreNegocio: string;
}

/** La pantalla cuando el arranque no trae entrenamiento: antes se pintaba
 *  entera y todos los botones daban 404 sin explicar nada. */
function sinEntrenamiento(opts: EntrenamientoPageOpts): string {
  return appShell({
    titulo: 'Entrenar a la IA',
    subtitulo: 'Enséñale a gran escala: ejemplos, datos y reglas',
    contenido: `<div class="wrap"><div class="vacio"><div class="ico">🎓</div>
      <h3>El entrenamiento no está disponible</h3>
      <p>Esta instalación arrancó sin la parte que guarda las lecciones. Reinicia el sistema o pídelo en Soporte.</p>
      <div class="acciones"><a class="btn" href="/soporte">Ir a Soporte</a></div></div></div>`,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🎓',
  });
}

export function entrenamientoPage(opts: EntrenamientoPageOpts): string {
  if (!opts.disponible) return sinEntrenamiento(opts);
  const { demo, conIA } = opts;

  const avisoIA = conIA
    ? ''
    : `<div class="aviso"><b>La IA no está conectada.</b> Puedes enseñarle e importar igual; para examinarla o pulir con la IA, conecta Puter en <a href="/panel#ia">Mi asistente IA</a>.</div>`;

  const contenido = `
<div class="wrap">
${avisoIA}

<p class="intro">Cada cosa que aprende es una <b>lección</b>: un ejemplo, un dato o una regla. Pueden ser miles: en cada mensaje usa solo las que vienen al caso.
  <button class="btn sm" id="abrir-ia" type="button">🤖 Pedírselo a la IA</button>
</p>

<div class="tarjetas" id="tarjetas"></div>

<div class="cols">
  <div>
    <section class="tarjeta caja" id="caja-lecciones">
      <h2><span class="cab">Lo que sabe <span class="sep"></span><span class="muted nota" id="lecciones-total"></span></span></h2>
      <div class="filtros">
        <input type="search" id="f-q" aria-label="Buscar entre las lecciones" placeholder="Buscar en la pregunta, la respuesta o el tema">
        <select id="f-estado" aria-label="Filtrar por estado"><option value="">Todas</option><option value="activa">En uso</option><option value="pendiente">Por revisar</option><option value="descartada">Descartadas</option></select>
        <select id="f-tipo" aria-label="Filtrar por tipo"><option value="">Ejemplos, datos y reglas</option><option value="ejemplo">Solo ejemplos</option><option value="dato">Solo datos</option><option value="regla">Solo reglas</option></select>
        <select id="f-tema" aria-label="Filtrar por tema"><option value="">Cualquier tema</option></select>
        <select id="f-origen" aria-label="Filtrar por procedencia">${opcionesOrigen('De cualquier sitio')}</select>
        <select id="f-examen" aria-label="Filtrar por resultado del examen"><option value="">Examen: todos</option><option value="mal">Fallaron</option><option value="ok">Pasaron</option></select>
      </div>
      <div class="seleccion" id="seleccion">
        <label class="linea" style="margin:0"><input type="checkbox" id="sel-todas"> Marcar las de esta página</label>
        <span id="sel-cuantas" class="muted"></span>
        <span class="sep"></span>
        <button class="btn sm" id="sel-aprobar">Aprobar</button>
        <button class="btn sm" id="sel-descartar">Descartar</button>
        <button class="btn sm peligro" id="sel-borrar">Borrar</button>
        <button class="btn sm primario hidden" id="aprobar-pendientes">Aprobar todas las pendientes</button>
      </div>
      <div class="tabla-scroll">
        <table>
          <thead><tr><th style="width:28px"></th><th scope="col">Lección · tema · de dónde vino · examen</th><th scope="col">Acciones</th></tr></thead>
          <tbody id="filas"><tr><td colspan="3" class="muted" style="padding:var(--esp-5);text-align:center">Cargando…</td></tr></tbody>
        </table>
      </div>
      <div class="paginas"><span id="pag-texto"></span><span><button class="btn sm" id="pag-antes">← Anteriores</button> <button class="btn sm" id="pag-despues">Siguientes →</button></span></div>
    </section>
    <div id="mas-menu" class="mas-menu hidden" role="menu" aria-label="Más acciones de la lección"></div>

    <section class="tarjeta caja" id="caja-examen">
      <h2><button type="button" class="cab plegador" aria-expanded="true" aria-controls="examen-cuerpo">Examen de las lecciones enseñadas <span class="sep"></span><span class="flecha" aria-hidden="true">▾</span></button></h2>
      <div class="cuerpo" id="examen-cuerpo">
        <p class="muted">Se le hace a la IA la pregunta de cada lección y se comprueba que diga los mismos datos. Corre en el servidor: puedes seguir trabajando. <span id="ex-sin"></span></p>
        <div class="fila">
          <div><label for="ex-tema">Tema</label><select id="ex-tema"><option value="">Todos</option></select></div>
          <div><label for="ex-origen">De dónde</label><select id="ex-origen">${opcionesOrigen('De cualquier sitio')}</select></div>
          <div><label for="ex-muestra">Cuántas</label><select id="ex-muestra"><option value="">Todas</option><option value="50">Una muestra de 50</option><option value="200">Una muestra de 200</option><option value="500">Una muestra de 500</option><option value="1000">Una muestra de 1000</option></select></div>
          <div class="fijo"><button class="btn primario" id="ex-correr">Examinar</button></div>
        </div>
        <label class="linea"><input type="checkbox" id="ex-fallidas"> Solo las que fallaron la última vez</label>
        <div id="ex-progreso"></div>
        <div id="ex-historial" style="margin-top:var(--esp-3)"></div>
        <div id="ex-detalle" style="margin-top:var(--esp-3)"></div>
      </div>
    </section>

    <section class="tarjeta caja cerrada" id="caja-probar">
      <h2><button type="button" class="cab plegador" aria-expanded="false" aria-controls="probar-cuerpo">Prueba rápida: ¿qué usaría para responder? <span class="sep"></span><span class="flecha" aria-hidden="true">▾</span></button></h2>
      <div class="cuerpo" id="probar-cuerpo">
        <p class="muted">Escribe un mensaje como si fueras un cliente y verás qué lecciones elegiría. Es inmediato y no gasta IA.</p>
        <div class="fila"><div><input id="pr-texto" aria-label="Mensaje de prueba" placeholder="cuanto cuesta el envio a trujillo?"></div><div class="fijo"><button class="btn" id="pr-ver">Ver</button></div></div>
        <div id="pr-salida" class="elegidas"></div>
      </div>
    </section>
  </div>

  <div>
    <h2 class="columna-titulo">Tres formas de enseñarle</h2>

    <section class="tarjeta caja">
      <h2><span class="cab">Enséñale una cosa</span></h2>
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
        <div class="fila" style="margin-top:var(--esp-3)"><div class="fijo"><button class="btn primario" id="e-guardar">Enseñar</button></div><div class="muted" id="e-resultado" role="status"></div></div>
      </div>
    </section>

    <section class="tarjeta caja">
      <h2><span class="cab">Trae muchas de golpe</span></h2>
      <div class="cuerpo">
        <p class="muted">Un Excel o CSV con columnas <b>pregunta</b>, <b>respuesta</b> y <b>tema</b>; un chat exportado de WhatsApp; un JSON; o líneas sueltas. Las repetidas no entran dos veces.</p>
        <textarea id="i-texto" rows="5" aria-label="Texto a importar" placeholder="Pega aquí la tabla, el chat o las líneas…&#10;&#10;¿Hacen envíos a provincias? => Sí, a todo el Perú en 2 a 3 días.&#10;Envío gratis desde S/ 150 en Lima."></textarea>
        <input type="file" id="i-fichero" class="hidden" accept=".xlsx,.xlsm,.csv,.tsv,.txt,.json">
        <button type="button" class="drop" id="i-drop">Arrastra un fichero aquí o <u>elígelo</u> (xlsx, csv, txt, json)</button>
        <div id="i-fichero-nombre" class="nota" style="margin-top:var(--esp-1)"></div>
        <div class="fila" style="margin-top:var(--esp-2)">
          <div><label for="i-tema">Tema para todas (opcional)</label><input id="i-tema" list="temas-lista" placeholder="envíos"></div>
          <div><label for="i-yosoy">Si es un chat: tu nombre en él</label><input id="i-yosoy" placeholder="como aparece en el chat"></div>
        </div>
        <label class="linea"><input type="checkbox" id="i-revisar"> Dejarlas pendientes de revisar</label>
        <div class="fila" style="margin-top:var(--esp-3)"><div class="fijo"><button class="btn" id="i-previa">Ver qué entendió</button></div><div class="fijo"><button class="btn primario" id="i-importar">Importar</button></div><div class="muted" id="i-resultado" role="status"></div></div>
        <div id="i-vista" class="previa hidden"></div>
      </div>
    </section>

    <section class="tarjeta caja">
      <h2><span class="cab">Aprende de tus conversaciones</span></h2>
      <div class="cuerpo">
        <p class="muted">Recorre los chats y guarda cada pregunta de un cliente con lo que le contestó <b>una persona del negocio</b>. Teléfonos, DNI y correos se tapan.</p>
        <div class="fila">
          <div><label for="a-desde">Solo desde esta fecha (opcional)</label><input type="date" id="a-desde"></div>
          <div class="fijo"><button class="btn primario" id="a-correr">Aprender de los chats</button></div>
        </div>
        <label class="linea"><input type="checkbox" id="a-revisar" checked> Dejarlas pendientes de revisar (recomendado)</label>
        <div id="a-progreso"></div>
        <div class="bloque">
          <p class="muted">Después la IA puede <b>pulirlas</b>: quitar lo personal, quedarse con las que sirven y ponerles tema.</p>
          <div class="fila">
            <div><label for="p-limite">Cuántas pendientes pulir</label><select id="p-limite"><option value="100">Las 100 más antiguas</option><option value="500" selected>Hasta 500</option><option value="2000">Hasta 2000</option><option value="5000">Hasta 5000</option></select></div>
            <div class="fijo"><button class="btn" id="p-correr">Pulir con la IA</button></div>
          </div>
          <label class="linea"><input type="checkbox" id="p-activar"> Poner en uso las que la IA dé por buenas</label>
          <div id="p-progreso"></div>
        </div>
      </div>
    </section>
  </div>
</div>
</div>
`;

  /* La única tabla que el JS necesita del servidor: de dónde vino cada
     lección, con el mismo nombre que usan los dos filtros. */
  const tablas = `var ORIGEN = ${JSON.stringify(Object.fromEntries(ORIGENES.map((o) => [o.v, o.fila])))};\n`;

  const script =
    tablas +
    String.raw`
/* ------------------------------------------------------------- utilidades */

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
  if (!res.ok) {
    /* Cuando el fallo es "falta la IA", el servidor manda a donde se arregla. */
    var e = new Error((data.error || errorHttp(res.status)) + (data.ir === '/panel#ia' ? ' Conéctala en Mi asistente IA.' : ''));
    e.datos = data;
    throw e;
  }
  return data;
}
function esc(v) {
  return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
function lecciones(n) { return plural(n, 'lección', 'lecciones'); }
function cuando(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var hora = d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return 'hoy ' + hora;
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + hora;
}
function acortar(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
function el(id) { return document.getElementById(id); }
function val(id) { return (el(id).value || '').trim(); }
function ver(id, visible) { var x = el(id); if (x) x.classList.toggle('hidden', !visible); }
function marcado(id) { return el(id).checked; }
/* Un solo tono para las notas en toda la pantalla: tarjeta, historial y detalle. */
function tono(pct) { return pct >= 80 ? 'verde' : pct >= 50 ? 'ambar' : 'rojo'; }
function chip(tonoNombre, texto, extra) { return '<span class="chip tono-' + tonoNombre + (extra || '') + '">' + esc(texto) + '</span>'; }

/* Un solo aviso a la vez: antes se apilaban unos encima de otros. */
var avisoEl = null;
var avisoTimer = null;
function toast(texto) {
  if (!avisoEl) {
    avisoEl = document.createElement('div');
    avisoEl.className = 'toast';
    avisoEl.setAttribute('role', 'status');
    document.body.appendChild(avisoEl);
  }
  avisoEl.textContent = texto;
  avisoEl.classList.remove('hidden');
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(function () { avisoEl.classList.add('hidden'); }, 6000);
}
/* Todo lo que llama al servidor pasa por aquí: nunca un fallo en silencio. */
async function intentar(f) {
  try { await f(); } catch (e) { toast(e.message); }
}

var TIPO = { ejemplo: 'Ejemplo', dato: 'Dato', regla: 'Regla' };
var ESTADO = { activa: ['verde', 'en uso'], pendiente: ['ambar', 'por revisar'], descartada: ['gris', 'descartada'] };
var TRABAJO = { aprender: 'Aprendiendo de los chats', pulir: 'Puliendo con la IA', examen: 'Examinando' };
var FORMATO = { excel: 'una hoja de Excel', tabla: 'una tabla', json: 'un JSON', whatsapp: 'un chat exportado de WhatsApp', dialogo: 'un diálogo Cliente/Tú', lineas: 'líneas sueltas', vacio: 'nada' };

var resumen = null;
var pagina = 1;
var lista = { items: [], total: 0, pagina: 1, paginas: 1 };
var marcadas = {};
var examenElegido = null;

/* ---------------------------------------------------------- las cifras */

function ultimoExamen() {
  var hechos = (resumen.examenes || []).filter(function (e) { return e.estado !== 'corriendo'; });
  return hechos.length ? hechos[0] : null;
}
function notaDe(examen) {
  var d = examen && examen.detalle;
  return d && typeof d.porcentaje === 'number' ? d.porcentaje : null;
}
function repartoPorTipo(porTipo) {
  var partes = [];
  if (porTipo.ejemplo) partes.push(plural(porTipo.ejemplo, 'ejemplo', 'ejemplos'));
  if (porTipo.dato) partes.push(plural(porTipo.dato, 'dato', 'datos'));
  if (porTipo.regla) partes.push(plural(porTipo.regla, 'regla', 'reglas'));
  return partes.join(', ');
}

/* Las cuatro cifras de arriba. Cada una es un botón que lleva a lo que
   cuenta: así la cifra no es solo un número, es el camino. */
function pintarTarjetas() {
  var c = resumen.cifras;
  var activas = c.porEstado.activa || 0;
  var pendientes = c.porEstado.pendiente || 0;
  var ultimo = ultimoExamen();
  var nota = notaDe(ultimo);
  var cartas = [
    { n: lecciones(activas), q: activas ? repartoPorTipo(c.porTipo) : 'todavía no sabe nada', filtro: 'estado=activa' },
    { n: pendientes, q: 'por revisar', color: pendientes ? 'ambar' : '', filtro: 'estado=pendiente' },
    { n: nota === null ? '—' : nota + ' %', q: ultimo ? 'último examen · ' + ultimo.aprobados + ' bien de ' + (ultimo.aprobados + ultimo.fallados) : 'sin examen todavía', color: nota === null ? '' : tono(nota), ir: 'caja-examen' },
    { n: c.fallanExamen, q: 'en uso que fallaron', color: c.fallanExamen ? 'rojo' : '', filtro: 'estado=activa&examen=mal' }
  ];
  var html = cartas.map(function (t) {
    return '<button type="button" class="tarjeta ' + (t.color || '') + '" data-filtro="' + (t.filtro || '') + '" data-ir="' + (t.ir || '') + '">' +
      '<div class="n">' + esc(t.n) + '</div><div class="q">' + esc(t.q) + '</div></button>';
  }).join('');
  var caja = el('tarjetas');
  /* Se repinta cada pocos segundos: si no cambió nada, no se toca (para no
     robarle el foco del teclado a quien esté navegando con tabulador). */
  if (caja.innerHTML !== html) caja.innerHTML = html;

  var pend = el('aprobar-pendientes');
  pend.classList.toggle('hidden', !pendientes);
  pend.textContent = 'Aprobar ' + plural(pendientes, 'pendiente', 'pendientes');
  el('ex-sin').textContent = c.sinExaminar ? 'Quedan ' + lecciones(c.sinExaminar) + ' en uso sin examinar.' : '';
}

/* Los temas llenan los dos filtros y la lista de sugerencias; se rehacen
   solo si cambiaron, para no pisar lo que alguien esté eligiendo. */
var temasFirma = '';
function pintarTemas() {
  var temas = resumen.temas || [];
  var firma = temas.map(function (t) { return t.tema + ':' + t.total; }).join('|');
  if (firma === temasFirma) return;
  temasFirma = firma;
  var opciones = temas.map(function (t) { return '<option value="' + esc(t.tema) + '">' + esc(t.tema) + ' (' + t.total + ')</option>'; }).join('');
  [['f-tema', 'Cualquier tema'], ['ex-tema', 'Todos']].forEach(function (par) {
    var sel = el(par[0]);
    var antes = sel.value;
    sel.innerHTML = '<option value="">' + par[1] + '</option>' + opciones;
    sel.value = antes;
  });
  el('temas-lista').innerHTML = temas.map(function (t) { return '<option value="' + esc(t.tema) + '">'; }).join('');
}

function pintarResumen() {
  pintarTarjetas();
  pintarTemas();
  pintarTrabajos();
  pintarExamenes();
}

el('tarjetas').addEventListener('click', function (ev) {
  var t = ev.target.closest('.tarjeta');
  if (!t) return;
  if (t.getAttribute('data-ir')) { abrirCaja(t.getAttribute('data-ir')); return; }
  var f = new URLSearchParams(t.getAttribute('data-filtro') || '');
  ['f-estado', 'f-tipo', 'f-tema', 'f-origen', 'f-examen'].forEach(function (id) { el(id).value = ''; });
  el('f-q').value = '';
  el('f-estado').value = f.get('estado') || '';
  el('f-examen').value = f.get('examen') || '';
  pagina = 1;
  intentar(cargarLecciones);
  el('caja-lecciones').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function abrirCaja(id) {
  var caja = el(id);
  caja.classList.remove('cerrada');
  var b = caja.querySelector('.plegador');
  if (b) b.setAttribute('aria-expanded', 'true');
  caja.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ------------------------------------------------------ trabajos largos */

function trabajoDe(tipo) {
  return (resumen && resumen.trabajos || []).filter(function (x) { return x.tipo === tipo; })[0] || null;
}
function algoCorriendo() {
  return (resumen && resumen.trabajos || []).some(function (t) { return t.estado === 'corriendo'; });
}

/** La barra de un trabajo largo: siempre dice por dónde va y deja pararlo. */
function barra(t, detalle) {
  if (!t) return '';
  var corriendo = t.estado === 'corriendo';
  /* Al arrancar todavía no se sabe cuántas son: barra sin porcentaje en vez
     de un mentiroso "0 de 0". */
  var sinTotal = corriendo && !t.total;
  var pct = t.total ? Math.round(100 * t.hecho / t.total) : (corriendo ? 0 : 100);
  var clases = (t.estado === 'fallo' ? ' mal' : '') + (sinTotal ? ' indef' : '');
  var texto = corriendo
    ? (sinTotal ? TRABAJO[t.tipo] + '… preparando' : TRABAJO[t.tipo] + '… ' + pct + ' % (' + t.hecho + ' de ' + t.total + ')')
    : t.estado === 'terminado' ? 'Terminado ' + cuando(t.terminadoAt)
    : t.estado === 'cancelado' ? 'Parado ' + cuando(t.terminadoAt)
    : 'Falló: ' + (t.error || 'no se sabe por qué');
  return '<div class="progreso">' +
    '<div class="barra' + clases + '"><i style="width:' + (sinTotal ? 35 : pct) + '%"></i></div>' +
    '<div class="texto"><span aria-live="polite">' + esc(texto) + '</span><span class="sep"></span>' +
    (detalle ? '<span>' + esc(detalle) + '</span>' : '') +
    (corriendo ? '<button class="btn sm" data-cancelar="' + t.tipo + '">Parar</button>' : '') +
    '</div></div>';
}

/** Lo que va sumando cada trabajo, en palabras del negocio. */
function detalleTrabajo(t) {
  if (!t) return '';
  var r = t.resumen || {};
  var p = [];
  if (t.tipo === 'aprender') {
    p.push(plural(r.pares || 0, 'respuesta encontrada', 'respuestas encontradas'));
    p.push((r.nuevas || 0) + ' nuevas');
    if (r.repetidas) p.push(r.repetidas + ' ya estaban');
  } else if (t.tipo === 'pulir') {
    p.push((r.utiles || 0) + ' útiles');
    p.push((r.descartadas || 0) + ' descartadas');
    if (r.repetidas) p.push(r.repetidas + ' repetidas');
    if (r.sinRespuesta) p.push(r.sinRespuesta + ' sin respuesta de la IA');
  } else {
    p.push((r.aprobados || 0) + ' bien');
    p.push((r.fallados || 0) + ' mal');
    if (r.errores) p.push(r.errores + ' sin respuesta');
  }
  return p.join(' · ');
}

var corriendoAntes = false;
function pintarTrabajos() {
  [['aprender', 'a-progreso', 'a-correr'], ['pulir', 'p-progreso', 'p-correr'], ['examen', 'ex-progreso', 'ex-correr']].forEach(function (x) {
    var t = trabajoDe(x[0]);
    el(x[1]).innerHTML = barra(t, detalleTrabajo(t));
    el(x[2]).disabled = Boolean(t && t.estado === 'corriendo');
  });
  /* Al acabar un trabajo la lista cambió entera: se recarga sola. */
  var corriendo = algoCorriendo();
  if (corriendoAntes && !corriendo) intentar(cargarLecciones);
  corriendoAntes = corriendo;
}

document.addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-cancelar]');
  if (!b) return;
  b.disabled = true;
  intentar(async function () {
    try {
      await api('/admin/entrenamiento/trabajos/' + b.getAttribute('data-cancelar') + '/cancelar', { method: 'POST', body: {} });
      toast('Se está parando…');
    } catch (e) { b.disabled = false; throw e; }
  });
});

/* ------------------------------------------------------ lista de lecciones */

function filtroActual() {
  return { q: val('f-q'), estado: val('f-estado'), tipo: val('f-tipo'), tema: val('f-tema'), origen: val('f-origen'), examen: val('f-examen') };
}
function hayFiltros() {
  var f = filtroActual();
  return Object.keys(f).some(function (k) { return f[k]; });
}
function consulta(f, extra) {
  var partes = [];
  Object.keys(f).forEach(function (k) { if (f[k]) partes.push(k + '=' + encodeURIComponent(f[k])); });
  (extra || []).forEach(function (p) { partes.push(p); });
  return partes.length ? '?' + partes.join('&') : '';
}

async function cargarLecciones() {
  lista = await api('/admin/entrenamiento/lecciones' + consulta(filtroActual(), ['pagina=' + pagina, 'limite=50']));
  pintarLecciones();
}

function examenHtml(l) {
  if (l.examenOk === true) return '<span class="chip tono-verde" title="' + esc(cuando(l.examenAt)) + '">examen: bien</span>';
  if (l.examenOk !== false) return chip('gris', 'sin examinar');
  return '<span class="chip tono-rojo" title="' + esc(l.examenNota || '') + '">examen: mal</span><span>' + esc(acortar(l.examenNota || '', 90)) + '</span>';
}

function filaHtml(l) {
  var est = ESTADO[l.estado] || ['gris', l.estado];
  var dice = l.tipo === 'ejemplo'
    ? '<div class="dice">' + esc(l.pregunta || '') + '</div><div class="resp">' + esc(l.respuesta) + '</div>'
    : '<div class="dice">' + chip('azul', TIPO[l.tipo] || l.tipo, ' sin-punto') + ' ' + esc((l.pregunta ? l.pregunta + ': ' : '') + l.respuesta) + '</div>';
  var de = (ORIGEN[l.origen] || l.origen) + (l.origenDetalle ? ' · ' + acortar(l.origenDetalle, 40) : '');
  var etiquetas = chip(est[0], est[1]) +
    (l.tema ? chip('gris', l.tema, ' sin-punto') : '') +
    '<span title="De dónde vino">' + esc(de) + '</span>' +
    (l.tipo === 'ejemplo' ? examenHtml(l) : '') +
    (l.usos ? '<span>· usada ' + plural(l.usos, 'vez', 'veces') + '</span>' : '') +
    (l.nota ? '<span>· ' + esc(acortar(l.nota, 90)) + '</span>' : '');
  var corta = esc(acortar(l.pregunta || l.respuesta, 40));
  /* Solo Editar y Aprobar (las mas usadas) van sueltas; Descartar y Borrar se
     agrupan en un menu "Mas" para no apretar 4 botones de 34px en una celda. */
  var acciones = '<button class="btn sm" data-editar="' + l.id + '" aria-label="Editar: ' + corta + '">Editar</button>' +
    (l.estado !== 'activa' ? '<button class="btn sm" data-aprobar="' + l.id + '" aria-label="Poner en uso: ' + corta + '">Aprobar</button>' : '') +
    '<button class="btn sm" type="button" data-mas="' + l.id + '" aria-haspopup="true" aria-expanded="false" aria-label="Más acciones: ' + corta + '">⋯ Más</button>';
  return '<tr>' +
    '<td class="marca"><input type="checkbox" data-marcar="' + l.id + '" aria-label="Marcar: ' + corta + '"' + (marcadas[l.id] ? ' checked' : '') + '></td>' +
    '<td class="leccion">' + dice + (l.mala ? '<span class="mala">No debe decir: «' + esc(acortar(l.mala, 140)) + '»</span>' : '') + '<div class="etiquetas">' + etiquetas + '</div></td>' +
    '<td class="fin"><div class="acciones">' + acciones + '</div></td>' +
    '</tr>';
}

function vacioHtml() {
  if (hayFiltros()) {
    return '<div class="vacio"><h3>Nada con esos filtros</h3><p>Ninguna lección encaja con lo que has pedido.</p>' +
      '<div class="acciones"><button class="btn" id="limpiar-filtros">Quitar los filtros</button></div></div>';
  }
  return '<div class="vacio"><div class="ico">🎓</div><h3>Todavía no sabe nada</h3>' +
    '<p>Empieza por enseñarle una cosa: qué dice el cliente y qué hay que responderle. Después podrás traer un Excel entero o dejar que aprenda de tus chats.</p>' +
    '<div class="acciones"><button class="btn primario" id="ir-ensenar">Enseñarle lo primero</button></div></div>';
}

function pintarLecciones() {
  cerrarMasMenu(); /* las filas se van a reemplazar: el boton que lo abrio ya no existira */
  el('lecciones-total').textContent = lista.total ? lecciones(lista.total) : '';
  el('filas').innerHTML = lista.items.length
    ? lista.items.map(filaHtml).join('')
    : '<tr><td colspan="3">' + vacioHtml() + '</td></tr>';
  ver('seleccion', lista.items.length > 0);
  el('pag-texto').textContent = lista.paginas > 1 ? 'Página ' + lista.pagina + ' de ' + lista.paginas : '';
  el('pag-antes').disabled = lista.pagina <= 1;
  el('pag-despues').disabled = lista.pagina >= lista.paginas;
  /* La casilla de cabecera refleja lo que hay marcado de verdad en la página. */
  el('sel-todas').checked = lista.items.length > 0 && lista.items.every(function (l) { return marcadas[l.id]; });
  pintarSeleccion();
}

function idsMarcados() { return Object.keys(marcadas).filter(function (k) { return marcadas[k]; }).map(Number); }
function pintarSeleccion() {
  var n = idsMarcados().length;
  el('sel-cuantas').textContent = n ? plural(n, 'marcada', 'marcadas') : '';
  ['sel-aprobar', 'sel-descartar', 'sel-borrar'].forEach(function (id) { el(id).disabled = !n; });
}

el('filas').addEventListener('change', function (ev) {
  var c = ev.target.closest('[data-marcar]');
  if (!c) return;
  marcadas[c.getAttribute('data-marcar')] = c.checked;
  el('sel-todas').checked = lista.items.every(function (l) { return marcadas[l.id]; });
  pintarSeleccion();
});
el('sel-todas').onchange = function () {
  var on = this.checked;
  lista.items.forEach(function (l) { marcadas[l.id] = on; });
  pintarLecciones();
};

async function enMasa(accion, cuerpo, pregunta) {
  if (pregunta && !(await confirmarDialogo(pregunta))) return;
  await intentar(async function () {
    var r = await api('/admin/entrenamiento/lecciones/lote', { method: 'POST', body: Object.assign({ accion: accion }, cuerpo) });
    toast(r.mensaje);
    marcadas = {};
    await cargar();
  });
}
el('sel-aprobar').onclick = function () { enMasa('aprobar', { ids: idsMarcados() }); };
el('sel-descartar').onclick = function () { enMasa('descartar', { ids: idsMarcados() }); };
el('sel-borrar').onclick = function () {
  var n = idsMarcados().length;
  enMasa('borrar', { ids: idsMarcados() }, { titulo: 'Borrar ' + lecciones(n), texto: 'Se borran del todo. Si solo quieres que no se usen, descártalas.', boton: 'Borrar', peligro: true });
};
el('aprobar-pendientes').onclick = function () {
  var n = resumen.cifras.porEstado.pendiente || 0;
  enMasa('aprobar', { estado: 'pendiente' }, { titulo: 'Aprobar ' + lecciones(n), texto: 'Pasan a usarse desde ya en las respuestas del asistente. Puedes descartarlas o borrarlas después.', boton: 'Aprobar todas' });
};

/** Editar una lección: el ejemplo lleva pregunta y respuesta; el dato y la
 *  regla, un solo texto. */
async function editar(l) {
  if (l.tipo === 'ejemplo') {
    var v = await pedirLeccion({ titulo: 'Cambiar este ejemplo', pregunta: l.pregunta, respuesta: l.respuesta, tema: l.tema, mala: l.mala, boton: 'Guardar' });
    if (!v) return false;
    await api('/admin/entrenamiento/lecciones/' + l.id, { method: 'PATCH', body: { pregunta: v.pregunta, respuesta: v.respuesta, tema: v.tema || null } });
    return true;
  }
  var t = await pedirDato({ titulo: l.tipo === 'dato' ? 'Cambiar este dato' : 'Cambiar esta regla', valor: l.respuesta, boton: 'Guardar' });
  if (t === null) return false;
  await api('/admin/entrenamiento/lecciones/' + l.id, { method: 'PATCH', body: { respuesta: t } });
  return true;
}

/** Editar, aprobar, descartar o borrar una lección: lo llaman tanto el boton
 *  suelto de la fila como los del menu "Mas" (comparten los mismos data-*). */
function accionDeLeccion(b) {
  var id = b.getAttribute('data-editar') || b.getAttribute('data-aprobar') || b.getAttribute('data-descartar') || b.getAttribute('data-borrar');
  var l = lista.items.filter(function (x) { return String(x.id) === id; })[0];
  if (!l) return;
  intentar(async function () {
    if (b.hasAttribute('data-aprobar')) {
      await api('/admin/entrenamiento/lecciones/' + id, { method: 'PATCH', body: { estado: 'activa' } });
      toast('En uso desde ahora.');
    } else if (b.hasAttribute('data-descartar')) {
      await api('/admin/entrenamiento/lecciones/' + id, { method: 'PATCH', body: { estado: 'descartada' } });
      toast('Descartada: el asistente ya no la usa.');
    } else if (b.hasAttribute('data-borrar')) {
      if (!(await confirmarDialogo({ titulo: 'Borrar esta lección', texto: acortar(l.pregunta || l.respuesta, 140), boton: 'Borrar', peligro: true }))) return;
      await api('/admin/entrenamiento/lecciones/' + id, { method: 'DELETE' });
      toast('Borrada.');
    } else {
      if (!(await editar(l))) return;
      toast('Guardado.');
    }
    await cargar();
  });
}

/* El menu flotante "Mas" de cada fila: uno solo compartido (no uno por fila),
   con Descartar y Borrar; se posiciona junto al boton que lo abrio. */
function cerrarMasMenu() {
  var m = el('mas-menu');
  m.classList.add('hidden');
  m.innerHTML = '';
  document.removeEventListener('click', cerrarMasMenuSiFuera, true);
}
function cerrarMasMenuSiFuera(ev) {
  if (el('mas-menu').contains(ev.target) || (ev.target.closest && ev.target.closest('[data-mas]'))) return;
  cerrarMasMenu();
}
function abrirMasMenu(boton) {
  var id = boton.getAttribute('data-mas');
  var l = lista.items.filter(function (x) { return String(x.id) === id; })[0];
  if (!l) return;
  var corta = esc(acortar(l.pregunta || l.respuesta, 40));
  var m = el('mas-menu');
  m.innerHTML =
    (l.estado !== 'descartada' ? '<button class="btn sm" data-descartar="' + id + '" aria-label="Descartar: ' + corta + '">Descartar</button>' : '') +
    '<button class="btn sm peligro" data-borrar="' + id + '" aria-label="Borrar: ' + corta + '">Borrar</button>';
  var r = boton.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px';
  m.style.left = 'auto';
  m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  m.classList.remove('hidden');
  boton.setAttribute('aria-expanded', 'true');
  setTimeout(function () { document.addEventListener('click', cerrarMasMenuSiFuera, true); }, 0);
}
el('mas-menu').addEventListener('click', function (ev) {
  var b = ev.target.closest('button');
  if (!b) return;
  cerrarMasMenu();
  accionDeLeccion(b);
});

el('filas').addEventListener('click', function (ev) {
  var b = ev.target.closest('button');
  if (!b) return;
  if (b.id === 'limpiar-filtros') {
    ['f-q', 'f-estado', 'f-tipo', 'f-tema', 'f-origen', 'f-examen'].forEach(function (id) { el(id).value = ''; });
    pagina = 1;
    intentar(cargarLecciones);
    return;
  }
  if (b.id === 'ir-ensenar') { el('e-pregunta').focus(); el('e-pregunta').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  if (b.id === 'reintentar') { location.reload(); return; }
  if (b.hasAttribute('data-mas')) { abrirMasMenu(b); return; }
  accionDeLeccion(b);
});

['f-estado', 'f-tipo', 'f-tema', 'f-origen', 'f-examen'].forEach(function (id) {
  el(id).onchange = function () { pagina = 1; intentar(cargarLecciones); };
});
var buscando = null;
el('f-q').oninput = function () {
  clearTimeout(buscando);
  buscando = setTimeout(function () { pagina = 1; intentar(cargarLecciones); }, 300);
};
el('pag-antes').onclick = function () { if (pagina > 1) { pagina--; intentar(cargarLecciones); } };
el('pag-despues').onclick = function () { if (pagina < lista.paginas) { pagina++; intentar(cargarLecciones); } };

/* ------------------------------------------------------ enseñar una cosa */

function tipoElegido() { return document.querySelector('input[name=e-tipo]:checked').value; }
function pintarTipo() {
  var t = tipoElegido();
  ver('e-caja-pregunta', t === 'ejemplo');
  el('e-etiqueta-respuesta').textContent = t === 'ejemplo' ? '…responder' : t === 'dato' ? 'El dato (como se lo dirías a un empleado nuevo)' : 'La regla (qué hacer o qué no hacer)';
  el('e-respuesta').placeholder = t === 'ejemplo'
    ? 'Sí, enviamos a todo el Perú. A provincias llega en 2 a 3 días hábiles y cuesta S/ 15.'
    : t === 'dato' ? 'Los envíos a Trujillo tardan 2 días y cuestan S/ 15.'
    : 'Nunca prometas una fecha exacta de entrega: di "suele llegar en".';
}
document.querySelectorAll('input[name=e-tipo]').forEach(function (r) { r.onchange = pintarTipo; });
pintarTipo();

el('e-guardar').onclick = async function () {
  var tipo = tipoElegido();
  var salida = el('e-resultado');
  var body = { tipo: tipo, pregunta: tipo === 'ejemplo' ? val('e-pregunta') : null, respuesta: val('e-respuesta'), tema: val('e-tema') || null, origen: 'manual' };
  if (tipo === 'ejemplo' && !body.pregunta) { salida.textContent = 'Escribe lo que dice el cliente.'; el('e-pregunta').focus(); return; }
  if (body.respuesta.length < 2) { salida.textContent = tipo === 'ejemplo' ? 'Escribe lo que hay que responder.' : 'Escribe el texto.'; el('e-respuesta').focus(); return; }
  this.disabled = true;
  try {
    var r = await api('/admin/entrenamiento/lecciones', { method: 'POST', body: body });
    salida.textContent = r.mensaje;
    /* Si ya estaba, se dejan los campos: puede que quisiera cambiarla. */
    if (r.nueva) { el('e-pregunta').value = ''; el('e-respuesta').value = ''; }
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
function olvidarFichero() {
  fichero = null;
  /* Vaciar el input es lo que permite volver a elegir el mismo fichero:
     sin esto, el segundo intento no disparaba nada. */
  el('i-fichero').value = '';
  el('i-fichero-nombre').textContent = '';
}
function elegirFichero(f) {
  if (!f) return;
  if (f.size > 20 * 1024 * 1024) { toast('El fichero pesa más de 20 MB: pártelo en varios.'); olvidarFichero(); return; }
  fichero = f;
  el('i-fichero-nombre').innerHTML = esc(f.name) + ' (' + Math.round(f.size / 1024) + ' KB) <button type="button" class="btn sm" id="i-quitar">Quitar</button>';
  ver('i-vista', false);
}
el('i-fichero-nombre').addEventListener('click', function (ev) { if (ev.target.id === 'i-quitar') olvidarFichero(); });

var drop = el('i-drop');
drop.onclick = function () { el('i-fichero').click(); };
el('i-fichero').onchange = function () { elegirFichero(this.files[0]); };
drop.ondragover = function (ev) { ev.preventDefault(); drop.classList.add('sobre'); };
drop.ondragleave = function () { drop.classList.remove('sobre'); };
drop.ondrop = function (ev) { ev.preventDefault(); drop.classList.remove('sobre'); elegirFichero(ev.dataTransfer.files[0]); };

async function cuerpoImportacion() {
  var body = { texto: val('i-texto') || undefined, tema: val('i-tema') || undefined, yoSoy: val('i-yosoy') || undefined, revisar: marcado('i-revisar') };
  if (fichero) { body.base64 = await leerFichero(fichero); body.nombre = fichero.name; }
  if (!body.texto && !body.base64) throw new Error('Pega un texto o elige un fichero.');
  return body;
}

function pintarVista(v, importado) {
  var caja = el('i-vista');
  var html = '<b>' + (importado ? esc(v.mensaje) : 'Se entendió como ' + (FORMATO[v.formato] || v.formato) + ': ' + lecciones(v.total)) + '</b>';
  var tipos = Object.keys(v.porTipo || {}).map(function (t) {
    var nombre = (TIPO[t] || t).toLowerCase();
    return plural(v.porTipo[t], nombre, nombre + 's');
  });
  if (tipos.length) html += '<div class="nota">' + tipos.join(' · ') + (v.descartadas ? ' · ' + plural(v.descartadas, 'línea sin usar', 'líneas sin usar') : '') + '</div>';
  if (v.autores && v.autores.length) html += '<div class="nota">Hablan: ' + v.autores.map(esc).join(', ') + '. Se tomó como negocio a <b>' + esc(v.negocio) + '</b>.</div>';
  (v.avisos || []).forEach(function (a) { html += '<div class="nota" style="color:var(--ambar)">' + esc(a) + '</div>'; });
  if (v.muestra && v.muestra.length) {
    html += '<ul>' + v.muestra.slice(0, 8).map(function (f) {
      return '<li>' + (f.tipo !== 'ejemplo' ? chip('azul', TIPO[f.tipo] || f.tipo, ' sin-punto') + ' ' : '') +
        (f.pregunta ? '<b>' + esc(acortar(f.pregunta, 70)) + '</b> → ' : '') + esc(acortar(f.respuesta, 90)) +
        (f.tema ? ' <span class="muted">(' + esc(f.tema) + ')</span>' : '') + '</li>';
    }).join('') + (v.total > 8 ? '<li class="muted">… y ' + (v.total - 8) + ' más</li>' : '') + '</ul>';
  }
  if (v.descartadasMuestra && v.descartadasMuestra.length) {
    html += '<div class="nota" style="margin-top:6px">Sin usar: ' + v.descartadasMuestra.slice(0, 3).map(function (d) { return 'línea ' + d.linea + ' (' + esc(d.motivo) + ')'; }).join(', ') + '</div>';
  }
  caja.innerHTML = html;
  caja.classList.remove('hidden');
}

/** La previa y la importación se piden igual; solo cambia la ruta. */
async function pedirImportacion(boton, ruta, esperando, importado) {
  var salida = el('i-resultado');
  salida.textContent = esperando;
  boton.disabled = true;
  try {
    var r = await api(ruta, { method: 'POST', body: await cuerpoImportacion() });
    pintarVista(r, importado);
    salida.textContent = '';
    return r;
  } catch (e) {
    salida.textContent = e.message;
    return null;
  } finally {
    boton.disabled = false;
  }
}
el('i-previa').onclick = function () { pedirImportacion(this, '/admin/entrenamiento/importar/previa', 'Leyendo…', false); };
el('i-importar').onclick = async function () {
  var r = await pedirImportacion(this, '/admin/entrenamiento/importar', 'Importando…', true);
  if (!r) return;
  if (r.nuevas) { el('i-texto').value = ''; olvidarFichero(); }
  await intentar(cargar);
};

/* --------------------------------------------- aprender de los chats y pulir */

el('a-correr').onclick = async function () {
  var desde = val('a-desde');
  var ok = await confirmarDialogo({
    titulo: 'Aprender de las conversaciones',
    texto: 'Se recorren todos los chats' + (desde ? ' desde el ' + desde : '') + ' y se guarda cada respuesta que dio una persona del negocio' +
      (marcado('a-revisar') ? ', pendiente de que la revises.' : ' y se pone en uso desde ya.') + ' Tarda unos minutos si hay muchos chats.',
    boton: 'Empezar'
  });
  if (!ok) return;
  await intentar(async function () {
    await api('/admin/entrenamiento/aprender', { method: 'POST', body: { desde: desde || undefined, revisar: marcado('a-revisar') } });
    toast('Aprendiendo… la barra va avanzando.');
    await cargar();
  });
};

el('p-correr').onclick = async function () {
  /* Guarda temprana: sin pendientes no hay nada que pulir y la IA cobraría en balde. */
  if (!(resumen && resumen.cifras.porEstado.pendiente)) { toast('No hay lecciones pendientes que pulir.'); return; }
  await intentar(async function () {
    await api('/admin/entrenamiento/pulir', { method: 'POST', body: { limite: Number(val('p-limite') || 500), activar: marcado('p-activar') } });
    toast('Puliendo con la IA…');
    await cargar();
  });
};

/* ------------------------------------------------------------- examen */

function pintarExamenes() {
  var caja = el('ex-historial');
  var examenes = resumen.examenes || [];
  if (!examenes.length) { caja.innerHTML = '<div class="muted nota">Todavía no se ha hecho ningún examen.</div>'; return; }
  caja.innerHTML = '<table><thead><tr><th scope="col">Cuándo</th><th scope="col">Qué se examinó</th><th scope="col">Nota</th><th scope="col">Bien</th><th scope="col">Mal</th><th scope="col"></th></tr></thead><tbody>' +
    examenes.map(function (e) {
      var nota = notaDe(e);
      var marca = e.estado === 'corriendo' ? ' ' + chip('ambar', 'en marcha') : e.estado === 'cancelado' ? ' ' + chip('gris', 'parado') : '';
      return '<tr class="examen-fila' + (examenElegido === e.id ? ' elegida' : '') + '" data-examen="' + e.id + '">' +
        '<td>' + esc(cuando(e.empezadoAt)) + '</td>' +
        '<td>' + esc(e.nombre || '') + marca + '</td>' +
        '<td>' + (nota === null ? '<span class="muted">—</span>' : '<span class="porcentaje ' + tono(nota) + '">' + nota + ' %</span>') + '</td>' +
        '<td>' + e.aprobados + '</td>' +
        '<td>' + e.fallados + (e.errores ? ' <span class="muted">(+' + e.errores + ' sin respuesta)</span>' : '') + '</td>' +
        '<td><button class="btn sm" aria-label="Ver los fallos de este examen">Ver fallos</button></td></tr>';
    }).join('') + '</tbody></table>';
}

el('ex-historial').addEventListener('click', function (ev) {
  var fila = ev.target.closest('[data-examen]');
  if (!fila) return;
  examenElegido = Number(fila.getAttribute('data-examen'));
  pintarExamenes();
  var caja = el('ex-detalle');
  var enMarcha = (resumen.examenes || []).some(function (e) { return e.id === examenElegido && e.estado === 'corriendo'; });
  caja.innerHTML = '<div class="muted nota">Cargando…</div>';
  intentar(async function () {
    try {
      var r = await api('/admin/entrenamiento/examenes/' + examenElegido + '?fallos=1');
      if (!r.casos.length) {
        caja.innerHTML = '<div class="resultado">' + (enMarcha ? 'El examen sigue en marcha: todavía no ha fallado ninguna.' : 'Ninguna falló en este examen.') + '</div>';
        return;
      }
      caja.innerHTML = '<div class="nota" style="margin-bottom:6px">' + plural(r.casos.length, 'lección falló', 'lecciones fallaron') + '. Corrígelas o añade una regla, y vuelve a examinar «solo las que fallaron».</div>' +
        '<div class="tabla-scroll"><table><thead><tr><th scope="col">El cliente dice</th><th scope="col">Se le enseñó</th><th scope="col">Respondió</th><th scope="col">Por qué falló</th></tr></thead><tbody>' +
        r.casos.map(function (c) {
          return '<tr><td class="texto">' + esc(c.pregunta) + '</td><td class="texto">' + esc(c.esperada) + '</td><td class="texto">' + esc(c.respuesta || '(sin respuesta)') + '</td><td>' +
            (c.motivos || []).map(function (m) { return chip('rojo', m); }).join(' ') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } catch (e) {
      caja.innerHTML = '<div class="resultado">' + esc(e.message) + '</div>';
      throw e;
    }
  });
});

el('ex-correr').onclick = async function () {
  /* Guardas tempranas: mejor decirlo aquí que esperar un error del servidor. */
  if (marcado('ex-fallidas') && resumen && !resumen.cifras.fallanExamen) { toast('Ninguna lección en uso ha fallado el examen.'); return; }
  var muestra = val('ex-muestra');
  await intentar(async function () {
    await api('/admin/entrenamiento/examen', {
      method: 'POST',
      body: { tema: val('ex-tema') || undefined, origen: val('ex-origen') || undefined, muestra: muestra ? Number(muestra) : undefined, soloFallidas: marcado('ex-fallidas') }
    });
    toast('Examinando… cada pregunta tarda unos segundos.');
    await cargar();
  });
};

/* ------------------------------------------------------------ prueba rápida */

el('pr-ver').onclick = function () {
  var texto = val('pr-texto');
  var caja = el('pr-salida');
  if (!texto) { caja.innerHTML = '<div class="resultado">Escribe un mensaje de cliente.</div>'; return; }
  caja.innerHTML = '<div class="muted nota">Buscando…</div>';
  intentar(async function () {
    try {
      var r = await api('/admin/entrenamiento/probar', { method: 'POST', body: { texto: texto } });
      var bloques = [
        ['Ejemplos que imitaría', r.ejemplos, function (l) { return '<span class="sub">Cliente: ' + esc(l.pregunta) + '</span>' + esc(l.respuesta); }],
        ['Datos que tendría en cuenta', r.datos, function (l) { return esc((l.pregunta ? l.pregunta + ': ' : '') + l.respuesta); }],
        ['Reglas (van siempre)', r.reglas, function (l) { return esc(l.respuesta); }]
      ];
      var html = bloques.filter(function (b) { return b[1].length; }).map(function (b) {
        return '<h4>' + b[0] + '</h4>' + b[1].map(function (l) { return '<div class="item">' + b[2](l) + '</div>'; }).join('');
      }).join('');
      caja.innerHTML = html || '<div class="resultado">No encontró ninguna lección parecida: respondería solo con lo escrito en Mi asistente IA. Enséñale un ejemplo con esa pregunta.</div>';
    } catch (e) {
      caja.innerHTML = '<div class="resultado">' + esc(e.message) + '</div>';
      throw e;
    }
  });
};
el('pr-texto').onkeydown = function (e) { if (e.key === 'Enter') el('pr-ver').click(); };

/* ---------------------------------------------------------- arranque */

document.querySelectorAll('.plegador').forEach(function (b) {
  b.onclick = function () {
    var caja = b.closest('.caja');
    var cerrada = caja.classList.toggle('cerrada');
    b.setAttribute('aria-expanded', cerrada ? 'false' : 'true');
  };
});
el('abrir-ia').onclick = function () {
  if (window.abrirOperadorIA) window.abrirOperadorIA('Enséñale al asistente que ');
  else location.href = '/manual#preguntar';
};
document.addEventListener('ia:cambio', function () { intentar(cargar); });

async function cargar() {
  resumen = await api('/admin/entrenamiento');
  pintarResumen();
  await cargarLecciones();
}

if (location.hash === '#pendientes') el('f-estado').value = 'pendiente';

cargar().then(function () {
  if (location.hash === '#examen') abrirCaja('caja-examen');
}).catch(function (e) {
  /* Si la primera carga falla, la tabla no puede quedarse en "Cargando…". */
  el('filas').innerHTML = '<tr><td colspan="3"><div class="vacio"><h3>No se pudo cargar</h3><p>' + esc(e.message) + '</p>' +
    '<div class="acciones"><button class="btn" id="reintentar">Reintentar</button></div></div></td></tr>';
  toast(e.message);
});

/* Mientras corre un trabajo se refresca cada 3 s; si no, cada 15. */
var tic = 0;
var fallosSeguidos = 0;
setInterval(function () {
  tic++;
  if (!resumen) return;
  /* Los dos desplegables de temas se rehacen al refrescar: si uno está en
     uso, se espera al siguiente turno. El resto de campos no estorba, y por
     eso la barra de un trabajo largo ya no se congela al escribir. */
  var foco = document.activeElement;
  if (foco && (foco.id === 'f-tema' || foco.id === 'ex-tema')) return;
  if (!algoCorriendo() && tic % 5 !== 0) return;
  api('/admin/entrenamiento').then(function (r) {
    fallosSeguidos = 0;
    resumen = r;
    pintarResumen();
  }).catch(function (e) {
    /* Un fallo suelto suele ser la red; si se repite, se dice en vez de
       dejar la pantalla mintiendo con cifras viejas. */
    fallosSeguidos++;
    if (fallosSeguidos === 3) toast('No se puede hablar con el servidor: ' + e.message);
  });
}, 3000);
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
