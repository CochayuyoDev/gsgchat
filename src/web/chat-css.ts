/**
 * El estilo de la pantalla de chat.
 *
 * Vive aparte de `chat-page.ts` porque son dos cosas distintas: aqui esta como
 * se ve, alli como funciona. Nadie mas lo importa.
 *
 * Regla que no se rompe: aqui no se escribe ni un color a pelo. Todo sale de
 * los tokens del armazon (`tokens.ts`), y por eso el modo oscuro funciona sin
 * que este fichero se entere. Las cuatro excepciones -los colores de avatar y
 * de autor de grupo- son paletas de identidad, no de tema: tienen que
 * distinguir personas en los dos modos, y por eso son fijas y a proposito.
 * Lo mismo con el negro translucido de los velos (visor, ayuda) y el blanco
 * del texto sobre una banda de color: no son tema, son contraste.
 */

export const CHAT_CSS = `
  /* Los cuatro colores propios del chat (globo mio, globo del cliente,
     cabeceras y fondo del hilo) salen de los tokens del armazon: asi cambian
     con la paleta y con el modo oscuro sin tocar nada aqui. */
  .app, .toast, .visor, .flotante {
    --mine: var(--primario-suave); --theirs: var(--superficie); --header: var(--superficie-2);
    --badge: var(--primario); --wallpaper: var(--bg); --wallpaper-dot: var(--borde);
  }
  * { box-sizing: border-box; }
  /* El alto lo da el armazon (s-content lleno): los avisos van encima y el
     chat se queda con el resto. */
  .app { display: grid; grid-template-columns: 340px 1fr; flex: 1; min-height: 0; overflow: hidden;
    background: var(--bg); color: var(--text); font-family: var(--fuente); font-size: var(--fs-cuerpo); line-height: 1.45; }

  /* ------------------------------------------------------------- avisos
     Uno solo a la vez. Antes podian salir tres a la vez (demo, conexion y el
     bloque de "no se puede escribir") diciendo casi lo mismo. */
  .aviso { padding: 9px 14px; font-size: 13.5px; text-align: center; line-height: 1.35; flex: none; color: #fff; }
  .aviso a { color: inherit; text-decoration: underline; }
  .aviso.demo { background: var(--ambar); }
  .aviso.roto { background: var(--rojo); }

  /* -------------------------------------------------------- lista de chats */
  .side { background: var(--panel); border-right: 1px solid var(--line);
    display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .side header, .thread header {
    background: var(--header); padding: 10px 14px; display: flex; align-items: center; gap: 8px;
    border-bottom: 1px solid var(--line); min-height: 58px; flex: none;
  }
  .side header h1 { font-size: 17px; margin: 0; flex: 1; }
  .search { padding: 8px 12px; border-bottom: 1px solid var(--line); }
  .search input { width: 100%; padding: 9px 12px; border: 0; border-radius: var(--radio-sm);
    background: var(--bg); color: var(--text); font: inherit; font-size: 14px; }
  .search input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  .chats { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .chat { display: flex; gap: 13px; padding: 10px 14px; cursor: pointer;
    border-bottom: 1px solid var(--line);  position: relative; }
  .chat:hover { background: var(--header); }
  .chat.active { background: var(--header); box-shadow: inset 4px 0 0 var(--accent); }
  .chat.active .name { color: var(--accent); }
  /* El menu de la fila solo asoma al pasar por encima; en el movil, siempre. */
  .chat .fila-menu { position: absolute; right: 8px; bottom: 8px; opacity: 0;  }
  .chat:hover .fila-menu, .chat .fila-menu:focus-visible { opacity: 1; }
  @media (hover: none) { .chat .fila-menu { opacity: .7; } }
  .avatar { width: 46px; height: 46px; border-radius: 50%; background: var(--accent); color: #fff; flex: none;
    display: grid; place-items: center; font-weight: 600; font-size: 17px; }
  /* Un color por contacto: con todos del mismo verde la lista es un muro.
     Fijos a proposito: distinguen personas, no temas. */
  .avatar.c0 { background: #6bcbef; } .avatar.c1 { background: #e542a3; }
  .avatar.c2 { background: #f2a63c; } .avatar.c3 { background: #7a7dd8; }
  .avatar.c4 { background: #26a69a; } .avatar.c5 { background: #ef6b6b; }
  .avatar.c6 { background: #8bc34a; } .avatar.c7 { background: #a1887f; }
  .avatar.grupo { background: var(--gris); font-size: 20px; }
  .chat .body { flex: 1; min-width: 0; }
  .chat .top { display: flex; align-items: baseline; gap: 8px; }
  .chat .name { font-weight: 600; font-size: 15px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chat .when { font-size: 11.5px; color: var(--muted); flex: none; }
  /* Segunda linea: el ultimo mensaje (cede sitio), la etiqueta y los no leidos. El nombre se queda entero arriba. */
  .chat .last { display: flex; align-items: center; gap: 6px; font-size: 13.5px; color: var(--muted); margin-top: 2px; padding-right: 34px; min-width: 0; }
  .chat .last .texto { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* La etiqueta no se encoge (se lee entera); el que cede sitio es el texto del mensaje. */
  .chat .last .etq { flex: 0 0 auto; max-width: 58%; font-size: 11px; padding: 0 7px; }
  .chat .last .badge { flex: none; }
  .chat .marcas { display: inline-flex; gap: 4px; align-items: center; color: var(--muted); font-size: 12px; }
  .badge { background: var(--badge); color: var(--primario-texto); border-radius: 999px; font-size: 11.5px;
    font-weight: 700; padding: 1px 7px; margin-left: 6px; }
  /* Silenciado: el globo sigue contando, pero deja de gritar. */
  .chat.silenciado .badge { background: var(--gris); color: var(--texto); }

  /* ------------------------------------------------------------------ hilo
     min-height: 0 es lo que deja que el hilo se encoja y sea .messages quien
     haga scroll, en vez de estirar la pagina entera. */
  .thread { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg); position: relative; }
  .thread header .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .thread header .sub { font-size: 12.5px; color: var(--muted); }
  .thread header .sub .escribiendo { color: var(--verde); font-weight: 600; }
  /* La linea de debajo del nombre: el telefono y, como mucho, dos marcas (su pedido y «Para una persona»). */
  .thread header .sub { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; }
  .thread header .sub .t-pedido { display: inline-flex; align-items: center; gap: 4px; padding: 1px 9px; border-radius: 999px; background: var(--primario-suave); color: var(--primario); font-weight: 600; font-size: 12px; text-decoration: none; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .thread header .sub .t-pedido:hover { text-decoration: underline; }
  .thread header .sub .t-marca { font-size: 12px; }

  /* La etiqueta que puso la IA, junto al nombre (bandeja y cabecera del hilo). */
  .etq { flex: none; display: inline-block; max-width: 46%; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; background: var(--gris-suave); color: var(--gris); }
  .etq.rojo { background: var(--rojo-suave); color: var(--rojo); }
  .etq.ambar { background: var(--ambar-suave); color: var(--ambar); }
  .etq.azul { background: var(--azul-suave); color: var(--azul); }
  .etq.verde { background: var(--verde-suave); color: var(--verde); }
  /* De otro dia o sin clasificar: se ve, pero no compite con la de hoy. */
  .etq.vieja, .etq.sin { opacity: .7; font-weight: 500; }
  .etq.sin { border: 1px dashed currentColor; background: transparent; }
  /* Nombre y etiqueta en la misma linea; si no caben (telefono, nombre largo) la etiqueta baja, el nombre nunca desaparece. */
  .thread header .t-nombre { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 8px; min-width: 0; }
  .thread header .t-nombre .name { flex: 0 1 auto; min-width: 0; max-width: 100%; }
  .thread header .t-nombre #t-etiqueta { display: flex; min-width: 0; max-width: 100%; }
  .thread header .t-nombre #t-etiqueta:empty { display: none; }
  .thread header .t-nombre .etq { max-width: 100%; }
  /* La etiqueta de la cabecera se cambia a mano: es un boton. */
  .etq-boton, .etq-poner { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-height: 0; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
  .etq-boton .sel-flecha { font-size: 11px; color: var(--muted); }
  .etq-boton:hover .etq, .etq-boton:focus-visible .etq { box-shadow: 0 0 0 2px var(--primario-suave); }
  .etq-poner { padding: 1px 9px; border-radius: 999px; border: 1px dashed var(--line); color: var(--muted); font-size: 11.5px; }
  .etq-poner:hover, .etq-poner:focus-visible { border-color: var(--accent); color: var(--accent); }
  .etq .etq-mano { margin-right: 3px; font-size: 10px; opacity: .85; }

  /* El avance del etiquetado, bajo los filtros. */
  .etiquetado { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
  /* El texto ocupa su fila entera; los botones van debajo. */
  .etiquetado { flex-wrap: wrap; flex-shrink: 0; }
  .etiquetado .que { flex: 1 1 100%; min-width: 0; }
  .etiquetado.error { color: var(--rojo); }
  .etiquetado .barra { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; margin-top: 4px; }
  .etiquetado .barra i { display: block; height: 100%; background: var(--accent); transition: width .3s; }
  .etiquetado .reintentar { border: 1px solid currentColor !important; border-radius: 999px; padding: 3px 10px !important; font-size: 12px; font-weight: 600; }
  .etiquetado button { flex: none; border: 0; background: none; color: inherit; cursor: pointer; font: inherit; padding: 2px 6px; }

  /* Lo de arriba de la lista no se encoge: la que cede sitio es la lista. */
  .side .search, .side .filtros { flex-shrink: 0; }
  /* El boton del lote, en la cabecera de la lista. */
  .etiquetar-boton { flex: none; min-height: 30px; padding: 4px 11px; border-radius: 999px; border: 1px solid var(--accent); background: transparent; color: var(--accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }

  /* Los dos desplegables de filtro, uno al lado del otro. */
  .selectores { display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); flex-shrink: 0; }
  .selector { flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 4px 10px 4px 12px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: inherit; font: inherit; cursor: pointer; text-align: left; }
  .selector:hover { border-color: var(--muted); }
  .selector[aria-expanded="true"], .selector:focus-visible { border-color: var(--accent); outline: none; box-shadow: 0 0 0 3px var(--primario-suave); }
  .selector.activo { border-color: var(--accent); }
  .selector .sel-que { flex: none; font-size: 11.5px; color: var(--muted); }
  .selector .sel-valor { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .selector.activo .sel-valor { color: var(--accent); }
  .selector .sel-flecha { flex: none; color: var(--muted); font-size: 12px; }

  /* La lista que se abre: todas las opciones a la vista, con color y cuantos chats. */
  .lista-filtro { position: fixed; z-index: 60; overflow-y: auto; padding: 6px; border-radius: 12px; border: 1px solid var(--line); background: var(--panel); box-shadow: 0 12px 32px rgba(0, 0, 0, .35); }
  .lista-filtro .lf-titulo { padding: 8px 10px 4px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
  .lista-filtro .lf-op { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 6px 10px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; }
  .lista-filtro .lf-op:hover, .lista-filtro .lf-op:focus-visible { background: var(--primario-suave); outline: none; }
  .lista-filtro .lf-op.activo { color: var(--accent); font-weight: 600; }
  .lista-filtro .lf-marca { flex: none; width: 14px; font-size: 12px; color: var(--accent); }
  .lista-filtro .lf-texto { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lista-filtro .lf-n { flex: none; min-width: 26px; padding: 1px 8px; border-radius: 999px; background: var(--gris-suave); color: inherit; font-size: 12px; font-weight: 600; text-align: center; }
  .punto { flex: none; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--gris); }
  .punto.rojo { background: var(--rojo); }
  .punto.ambar { background: var(--ambar); }
  .punto.azul { background: var(--azul); }
  .punto.verde { background: var(--verde); }
  .punto.sin { background: transparent; border: 1px dashed currentColor; }
  .punto.vacio { background: transparent; border: 1px solid currentColor; }
  .etiquetar-boton:hover:not(:disabled) { background: var(--accent); color: var(--primario-texto); }
  .etiquetar-boton:disabled { opacity: .6; cursor: progress; }
  #etiquetar.girando { animation: etiquetando 1.2s linear infinite; }
  @keyframes etiquetando { 50% { opacity: .55; } }
  @media (prefers-reduced-motion: reduce) { #etiquetar.girando { animation: none; } }
  .etiquetado .ver-chats { border: 1px solid currentColor !important; border-radius: 999px; padding: 3px 10px !important; font-size: 12px; }

  /* Los chats del lote, uno por fila, con su estado de analisis y de envio a GSG. */
  .etiquetado-chats { flex: 0 1 auto; min-height: 0; max-height: 40vh; overflow-y: auto; border-bottom: 1px solid var(--line); background: var(--superficie, transparent); }
  .etiquetado-chats .nada { padding: 10px 12px; font-size: 12.5px; color: var(--muted); }
  .etiquetado-chats .nada.error { color: var(--rojo); }
  .chat-lote { display: flex; flex-direction: column; align-items: stretch; gap: 3px; width: 100%; text-align: left; padding: 8px 12px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: inherit; font: inherit; font-size: 12.5px; cursor: pointer; }
  .chat-lote:hover { background: var(--primario-suave); }
  .chat-lote .quien { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chat-lote .tel { color: var(--muted); font-size: 11.5px; }
  .chat-lote .estados { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; }
  .chat-lote .est, .chat-lote .gsg { font-size: 11.5px; padding: 1px 7px; border-radius: 999px; background: var(--gris-suave); color: var(--gris); white-space: nowrap; }
  .chat-lote .est-clasificada, .chat-lote .gsg-enviado { background: var(--verde-suave); color: var(--verde); }
  .chat-lote .est-error, .chat-lote .gsg-fallido { background: var(--rojo-suave); color: var(--rojo); }
  .chat-lote .gsg-sin_intentar, .chat-lote .est-reutilizada { background: var(--gris-suave); color: var(--gris); }
  .chat-lote .est-pendiente, .chat-lote .gsg-pendiente { background: var(--ambar-suave); color: var(--ambar); }
  .chat-lote .detalle { color: var(--rojo); font-size: 11.5px; overflow-wrap: anywhere; }

  /* El editor del catalogo: una tabla de tres campos por etiqueta. */
  .catalogo-dlg { width: min(920px, 96vw); max-height: 90vh; overflow-y: auto; }
  .catalogo-dlg h3 { margin: 0 0 6px; }
  .catalogo-dlg .cat-tabla { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
  .catalogo-dlg .cat-fila { display: grid; grid-template-columns: minmax(120px, 1.1fr) minmax(110px, 1fr) minmax(160px, 2.4fr) 32px; gap: 6px; align-items: center; }
  .catalogo-dlg .cat-cab { font-size: 12px; font-weight: 600; color: var(--muted); }
  .catalogo-dlg .cat-fila input { width: 100%; min-width: 0; font: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; }
  .catalogo-dlg .cat-fila input[readonly] { opacity: .7; }
  .catalogo-dlg .quitar { border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 15px; }
  @media (max-width: 640px) {
    /* En el telefono, cada etiqueta es una tarjeta: codigo, nombre y descripcion uno bajo otro, con su ✕ arriba. */
    .catalogo-dlg .cat-fila { grid-template-columns: 1fr 32px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
    .catalogo-dlg .cat-fila input { grid-column: 1; }
    .catalogo-dlg .cat-fila > :last-child { grid-column: 2; grid-row: 1; }
    .catalogo-dlg .cat-cab { display: none; }
  }

  .ficha { position: absolute; top: 58px; right: 8px; width: min(360px, calc(100% - 16px)); max-height: calc(100% - 70px); overflow: auto; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra-2); z-index: 6; }
  .ficha-cab { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--borde); }
  .ficha-cuerpo { padding: 10px 12px; font-size: 13.5px; display: flex; flex-direction: column; gap: 10px; }
  .ficha-cuerpo h4 { margin: 0 0 4px; font-size: 12.5px; color: var(--texto-suave); text-transform: uppercase; letter-spacing: .02em; }
  .ficha-cuerpo .fila { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
  .ficha-cuerpo .pin-coords { font-family: ui-monospace, Consolas, monospace; user-select: all; }
  .ficha-cuerpo a.sm, .ficha-cuerpo button.sm { min-height: 34px; padding: 4px 10px; border: 1px solid var(--borde); border-radius: var(--radio-sm); background: var(--superficie-2); font: inherit; font-size: 12.5px; cursor: pointer; text-decoration: none; color: var(--texto); display: inline-flex; align-items: center; }
  .ficha-acciones { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .ficha-acciones a { flex: 1 1 140px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 8px 12px; border-radius: var(--radio-sm); text-decoration: none; font-weight: 600; border: 1px solid var(--borde); background: var(--superficie-2); color: var(--texto); }
  .ficha-acciones a.principal { background: var(--primario); color: var(--primario-texto); border-color: var(--primario); }

  .messages {
    flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
    padding: 14px 6%; display: flex; flex-direction: column; gap: 2px;
    background-color: var(--wallpaper);
    background-image:
      radial-gradient(circle at 20% 30%, var(--wallpaper-dot) 1px, transparent 1px),
      radial-gradient(circle at 70% 65%, var(--wallpaper-dot) 1px, transparent 1px);
    background-size: 42px 42px, 58px 58px;
  }
  .messages::-webkit-scrollbar, .chats::-webkit-scrollbar { width: 7px; }
  .messages::-webkit-scrollbar-thumb, .chats::-webkit-scrollbar-thumb { background: var(--borde); border-radius: 4px; }
  .messages::-webkit-scrollbar-track, .chats::-webkit-scrollbar-track { background: transparent; }

  /* ------------------------------------------------------------- burbujas */
  .msg {
    max-width: min(65%, 520px); padding: 6px 9px 8px; border-radius: 7.5px; position: relative;
    box-shadow: var(--sombra); white-space: pre-wrap; word-wrap: break-word;
    font-size: 14.2px; line-height: 1.4; margin-bottom: 2px;
  }
  .msg.pendiente { opacity: .7; }
  .msg.out { align-self: flex-end; background: var(--mine); }
  .msg.in { align-self: flex-start; background: var(--theirs); }
  /* Mensajes seguidos del mismo lado: se juntan y solo el primero lleva pico,
     que es como los agrupa WhatsApp y lo que hace legible una rafaga. */
  .msg + .msg.out, .msg + .msg.in { margin-top: 1px; }
  .msg.primero { margin-top: 10px; }
  .msg.primero.out { border-top-right-radius: 0; }
  .msg.primero.in { border-top-left-radius: 0; }
  .msg.primero::before { content: ''; position: absolute; top: 0; width: 8px; height: 13px; }
  .msg.primero.out::before { right: -8px; background: var(--mine); clip-path: polygon(0 0, 100% 0, 0 100%); }
  .msg.primero.in::before { left: -8px; background: var(--theirs); clip-path: polygon(0 0, 100% 0, 100% 100%); }
  .msg a { color: var(--accent); }
  .msg .meta { float: right; margin: 8px -2px -4px 10px; font-size: 11px; color: var(--muted);
    white-space: nowrap; position: relative; top: 3px; display: inline-flex; align-items: center; gap: 4px; }
  .msg .tick { color: var(--muted); }
  .msg .tick.read { color: var(--azul); }
  .msg .de-ia { font-size: 10.5px; color: var(--muted); }
  .msg .editado { font-size: 10.5px; color: var(--muted); font-style: italic; }
  .msg .transcrito { display: inline-block; font-size: 11px; color: var(--muted); }
  /* Lo que el remitente "elimino para todos": aqui se conserva, y se dice. */
  .msg .borrado { display: block; font-size: 11px; color: var(--ambar); margin-top: 3px; }
  /* En un grupo, quien lo dijo va encima del globo, con su color. */
  .msg .autor { display: block; font-size: 12.5px; font-weight: 600; margin: -1px 0 2px; }
  .msg .autor .tel { font-weight: 400; color: var(--muted); font-size: 11.5px; margin-left: 6px; }
  .autor.c0 { color: #1e88c9; } .autor.c1 { color: #c2185b; } .autor.c2 { color: #d17f0b; } .autor.c3 { color: #5c5fbf; }
  .autor.c4 { color: #1b8f84; } .autor.c5 { color: #d84a4a; } .autor.c6 { color: #5f9a1e; } .autor.c7 { color: #8d6e63; }
  /* Reenviado y destacado: dos marcas pequenas, arriba del globo. */
  .msg .reenviado { display: block; font-size: 11.5px; color: var(--muted); font-style: italic; margin-bottom: 2px; }
  .msg .estrella { position: absolute; left: -16px; top: 4px; font-size: 11px; color: var(--ambar); }
  .msg.out .estrella { left: auto; right: -16px; }
  /* El mensaje al que se salto desde una cita o desde la busqueda. */
  .msg.resaltado {  }

  .msg mark { background: var(--ambar-suave); color: var(--ambar); border-radius: 3px; padding: 0 1px; }

  /* --------------------------------------------------------------- citas */
  .cita {
    display: block; margin: 0 0 4px; padding: 5px 8px; border-radius: 5px; cursor: pointer;
    background: var(--superficie-2); border-left: 4px solid var(--accent);
    font-size: 13px; line-height: 1.35; text-align: left; width: 100%; border-top: 0; border-right: 0; border-bottom: 0;
    font-family: inherit; color: inherit;
  }
  .cita .quien { display: block; font-weight: 600; color: var(--accent); font-size: 12.5px; }
  .cita .que { display: block; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cita.perdida { border-left-color: var(--borde); cursor: default; }

  /* --------------------------------------------------------- reacciones */
  .reacciones { display: flex; gap: 4px; flex-wrap: wrap; margin: 4px 0 -4px; }
  .reacciones .r {
    display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 999px;
    background: var(--superficie-2); border: 1px solid var(--borde); font-size: 12.5px; cursor: pointer;
    line-height: 1.5; min-height: 22px; color: var(--texto);
  }
  .reacciones .r.mia { border-color: var(--primario); background: var(--primario-suave); }
  .reacciones .r b { font-weight: 600; font-size: 11px; color: var(--muted); }
  /* La barra de reacciones rapidas: aparece al pasar por el globo. */
  .reac-rapidas {
    position: fixed; z-index: 40; display: flex; gap: 2px; padding: 4px 6px; border-radius: 999px;
    background: var(--superficie); border: 1px solid var(--borde); box-shadow: var(--sombra-2);
  }
  .reac-rapidas button { border: 0; background: none; font-size: 20px; cursor: pointer; padding: 2px 4px; border-radius: 999px; line-height: 1; min-width: 32px; min-height: 32px; }
  .reac-rapidas button:hover { background: var(--superficie-2); }

  /* ------------------------------------------------ el boton del menu del globo */
  .msg .abrir-menu {
    position: absolute; top: 2px; right: 2px; width: 26px; height: 26px; border: 0; cursor: pointer;
    background: none; color: var(--muted); font-size: 15px; line-height: 1; border-radius: 50%;
    opacity: 0;
  }
  .msg:hover .abrir-menu, .msg .abrir-menu:focus-visible { opacity: 1; background: var(--superficie-2); }
  @media (hover: none) { .msg .abrir-menu { opacity: .75; } }

  /* ------------------------------------------------- menus flotantes (uno solo)
     Mismo componente para el menu del globo, el de la fila de la lista, el de
     la cabecera y el del "+": un solo sitio donde arreglar el foco, el Esc y
     el tamano del objetivo tactil. */
  .flotante {
    position: fixed; z-index: 60; min-width: 210px; max-width: 280px; padding: 6px;
    background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio);
    box-shadow: var(--sombra-2); max-height: 70vh; overflow: auto;
  }
  .flotante button, .flotante a {
    display: flex; align-items: center; gap: 10px; width: 100%; min-height: 40px; padding: 7px 10px;
    border: 0; background: none; font: inherit; font-size: 13.5px; color: var(--texto); cursor: pointer;
    text-align: left; border-radius: var(--radio-sm); text-decoration: none;
  }
  .flotante button:hover, .flotante a:hover, .flotante button:focus-visible { background: var(--superficie-2); }
  .flotante button.peligro { color: var(--rojo); }
  .flotante .sep { height: 1px; background: var(--borde); margin: 4px 2px; }
  .flotante .icono { width: 20px; text-align: center; flex: none; font-size: 15px; }

  /* ------------------------------------------------------------- adjuntos */
  .msg .adjunto { display: block; margin: 2px 0 4px; max-width: 100%; }
  .msg img.adjunto, .msg video.adjunto { border-radius: 6px; cursor: pointer; max-height: 340px; }
  .msg audio.adjunto { width: 260px; max-width: 100%; }
  .msg img.sticker { width: 150px; height: 150px; object-fit: contain; display: block; background: transparent; }
  .msg.solo-sticker { background: transparent; box-shadow: none; padding: 2px; }
  .msg .fichero { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
                  background: var(--superficie-2); border-radius: 6px; text-decoration: none; color: inherit; }
  .msg .fichero b { font-weight: 600; }
  .msg .cargando { color: var(--muted); font-size: 12px; }
  .msg .una-vez { display: inline-block; font-size: 11.5px; margin: 2px 0 3px;
    padding: 2px 8px; border-radius: 999px; background: var(--ambar-suave); color: var(--ambar); }
  .msg .solo-telefono { display: block; margin-top: 6px; }
  .msg .solo-telefono button { font-size: 12px; padding: 6px 10px; min-height: 32px; border-radius: 999px; border: 1px solid var(--line);
    background: var(--superficie); cursor: pointer; color: var(--texto); }
  .msg .solo-telefono button:hover { background: var(--superficie-2); }

  /* previa de enlace dentro del globo */
  .enlace-previa { display: block; margin: 2px 0 6px; border-radius: 6px; overflow: hidden;
    background: var(--superficie-2); border-left: 4px solid var(--accent); text-decoration: none; color: inherit; }
  .enlace-previa img { width: 100%; max-height: 150px; object-fit: cover; display: block; }
  .enlace-previa .txt { padding: 6px 8px; }
  .enlace-previa .t { display: block; font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .enlace-previa .d { display: block; font-size: 12px; color: var(--muted); max-height: 2.6em; overflow: hidden; }
  .enlace-previa .s { display: block; font-size: 11.5px; color: var(--muted); margin-top: 2px; }

  /* ubicacion que mando el cliente */
  .pin-cliente { display: flex; flex-direction: column; gap: 4px; margin: 2px 0 6px; padding: 8px 10px; border: 1px solid var(--borde); border-radius: var(--radio-sm); background: var(--superficie-2); }
  .pin-cliente .pin-titulo { font-weight: 600; font-size: 13px; }
  .pin-cliente .pin-coords { font-family: ui-monospace, Consolas, monospace; font-size: 13px; user-select: all; }
  .pin-cliente .pin-acciones { display: flex; gap: 10px; align-items: center; font-size: 13px; }
  .pin-cliente .pin-copiar { border: 1px solid var(--borde); background: var(--superficie); border-radius: var(--radio-sm); padding: 4px 10px; font: inherit; font-size: 12.5px; cursor: pointer; min-height: 32px; color: var(--texto); }
  .pin-cliente .pin-nota { font-size: 11.5px; color: var(--texto-suave); }

  .day {
    align-self: center; background: var(--panel); color: var(--muted); font-size: 12.5px;
    padding: 5px 12px; border-radius: 8px; margin: 14px 0 8px; position: sticky; top: 4px;
    z-index: 2; box-shadow: var(--sombra); text-transform: uppercase;
    letter-spacing: .3px; font-weight: 500;
  }
  /* por que respondio el bot: nota interna, discreta, que el cliente no ve */
  .decision-bot {
    align-self: center; max-width: min(560px, 92%); margin: 4px 0 6px; padding: 4px 10px;
    border: 1px dashed var(--line); border-radius: 8px; background: transparent;
    color: var(--muted); font-size: 11.5px; line-height: 1.35; text-align: center;
    display: flex; flex-wrap: wrap; justify-content: center; gap: 2px 8px; overflow-wrap: anywhere;
  }
  .decision-bot .decision-etq { font-weight: 600; text-transform: uppercase; letter-spacing: .3px; font-size: 10.5px; }
  .decision-bot .decision-txt { flex-basis: 100%; }
  .decision-bot .decision-extra { flex-basis: 100%; font-style: italic; }
  .decision-bot .decision-hora { font-size: 10.5px; opacity: .8; }
  .mas-antiguos { text-align: center; padding: 6px 0 2px; }
  .mas-antiguos button { font-size: 12px; padding: 6px 12px; min-height: 32px; border-radius: 999px; border: 1px solid var(--line); background: var(--superficie); cursor: pointer; color: var(--muted); }
  .mas-antiguos button:disabled { opacity: .6; }

  /* --------------------------------------------------- bajar al final */
  .bajar {
    position: absolute; right: 18px; bottom: 90px; z-index: 5; width: 42px; height: 42px; border-radius: 50%;
    border: 1px solid var(--borde); background: var(--superficie); color: var(--texto); cursor: pointer;
    box-shadow: var(--sombra-2); font-size: 17px; display: grid; place-items: center;
  }
  .bajar .nuevos { position: absolute; top: -6px; right: -4px; background: var(--primario); color: var(--primario-texto);
    border-radius: 999px; font-size: 11px; font-weight: 700; padding: 1px 6px; }

  /* ------------------------------------------------- buscar en el hilo */
  .buscar-hilo { display: flex; gap: 8px; align-items: center; padding: 8px 14px; background: var(--header);
    border-bottom: 1px solid var(--line); flex: none; }
  .buscar-hilo input { flex: 1; min-width: 80px; padding: 8px 12px; border: 1px solid var(--borde); border-radius: var(--radio-sm);
    background: var(--panel); color: var(--text); font: inherit; font-size: 13.5px; }
  .buscar-hilo .cuenta { font-size: 12.5px; color: var(--muted); white-space: nowrap; }

  /* --------------------------------------------- seleccion de mensajes */
  .seleccion { display: flex; gap: 6px; align-items: center; padding: 8px 14px; background: var(--primario-suave);
    border-bottom: 1px solid var(--line); flex: none; }
  .seleccion .cuantos { flex: 1; font-size: 13.5px; font-weight: 600; color: var(--accent); }
  .msg.elegido { outline: 2px solid var(--primario); outline-offset: 2px; }
  .app.seleccionando .msg { cursor: pointer; }
  .app.seleccionando .msg .abrir-menu { display: none; }

  /* ---------------------------------------------------- previa de cita */
  .cita-previa { display: flex; gap: 10px; align-items: center; padding: 8px 14px; background: var(--header);
    border-top: 1px solid var(--line); flex: none; }
  .cita-previa .bloque { flex: 1; min-width: 0; border-left: 4px solid var(--accent); padding: 4px 8px;
    background: var(--superficie-2); border-radius: 0 var(--radio-sm) var(--radio-sm) 0; }
  .cita-previa .quien { display: block; font-size: 12.5px; font-weight: 600; color: var(--accent); }
  .cita-previa .que { display: block; font-size: 12.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ---------------------------------------------------------- compositor */
  .composer { background: var(--header); padding: 9px 14px; border-top: 1px solid var(--line);
    display: flex; gap: 8px; align-items: flex-end; flex: none; }
  .composer textarea {
    flex: 1; resize: none; border: 0; border-radius: 22px; padding: 11px 16px;
    background: var(--panel); color: var(--text); font: inherit; font-size: 14.5px;
    max-height: 140px; outline: none;
  }
  .composer textarea:focus { box-shadow: 0 0 0 1px var(--line); }
  .composer button { border: 0; border-radius: 50%; width: 44px; height: 44px; background: var(--accent);
    color: var(--primario-texto); cursor: pointer; font-size: 17px; flex: none; display: grid; place-items: center; }
  .composer button.ghost { background: transparent; color: var(--muted); font-size: 20px; }
  .composer button.ghost:hover { color: var(--accent); background: var(--superficie); }
  .composer button:disabled { opacity: .45; cursor: default; }

  /* grabando una nota de voz */
  .grabando { display: flex; gap: 12px; align-items: center; padding: 10px 14px; background: var(--header);
    border-top: 1px solid var(--line); flex: none; }
  .grabando .punto { width: 11px; height: 11px; border-radius: 50%; background: var(--rojo);  flex: none; }

  .grabando .tiempo { font-variant-numeric: tabular-nums; font-weight: 600; font-size: 14px; flex: none; }
  .grabando .onda { flex: 1; display: flex; gap: 2px; align-items: center; height: 26px; overflow: hidden; }
  .grabando .onda i { width: 3px; background: var(--accent); border-radius: 2px; min-height: 3px; }
  .grabando audio { flex: 1; min-width: 0; height: 34px; }

  /* ------------------------------------------- paneles de abajo (uno a la vez) */
  .panel-bajo { background: var(--panel); border-top: 1px solid var(--line); max-height: 280px; overflow: auto;
    flex: none; box-shadow: var(--sombra-2); }
  .atajos .op { display: flex; gap: 12px; align-items: baseline; padding: 9px 16px; cursor: pointer; border-bottom: 1px solid var(--line); font-size: 13.5px; }
  .atajos .op:last-child { border-bottom: 0; }
  .atajos .op.sel, .atajos .op:hover { background: var(--header); }
  .atajos .op b { font-family: ui-monospace, Consolas, monospace; color: var(--accent); flex: none; min-width: 90px; }
  .atajos .op span { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .panel-bajo .pie { padding: 8px 16px; font-size: 12px; color: var(--muted); }
  .stickers { display: flex; gap: 10px; flex-wrap: wrap; padding: 10px 14px; }
  .stickers img { width: 84px; height: 84px; object-fit: contain; border-radius: 10px; cursor: pointer; border: 1px solid transparent; background: var(--header); }
  .stickers img:hover { border-color: var(--accent); }

  /* selector de emoji */
  .emojis { padding: 8px 12px 12px; }
  .emojis .buscador { width: 100%; padding: 8px 12px; border: 1px solid var(--borde); border-radius: var(--radio-sm);
    background: var(--superficie); color: var(--texto); font: inherit; font-size: 13.5px; margin-bottom: 8px; }
  .emojis h5 { margin: 6px 0 4px; font-size: 11.5px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); font-weight: 600; }
  .emojis .rejilla { display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr)); gap: 2px; }
  .emojis .rejilla button { border: 0; background: none; font-size: 22px; cursor: pointer; border-radius: var(--radio-sm);
    min-height: 38px; line-height: 1; }
  .emojis .rejilla button:hover { background: var(--superficie-2); }

  /* barra de respuestas rapidas */
  /* Discreta: texto suave, sin borde, que no compita con los mensajes. */
  .rapidas-barra { display: flex; gap: 4px; padding: 6px 12px 0; background: var(--header); flex: none; overflow-x: auto; scrollbar-width: none; }
  .rapidas-barra::-webkit-scrollbar { display: none; }
  .rapidas-barra .chip { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; border: 1px solid transparent; background: transparent; color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; white-space: nowrap; min-height: 28px; }
  .rapidas-barra .chip:hover { background: var(--panel); border-color: var(--line); color: var(--accent); }
  /* Son botones con forma de pildora, no chips de estado: sin el punto del armazon. */
  .rapidas-barra .chip::before { display: none; }
  .rapidas-barra .chip.editar { color: var(--muted); border-style: dashed; text-decoration: none; }
  .rapidas-barra.ocupada .chip { opacity: .5; pointer-events: none; }

  /* previa del adjunto que se va a mandar */
  .previa { display: flex; gap: 12px; align-items: center; padding: 10px 14px; background: var(--header);
            border-top: 1px solid var(--line); flex: none; }
  .previa img, .previa video { max-height: 110px; max-width: 180px; border-radius: 6px; background: var(--superficie); }
  .previa .icono { width: 64px; height: 64px; border-radius: 8px; background: var(--superficie); display: grid; place-items: center; font-size: 28px; }
  .previa .datos { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .previa .nombre { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .previa input { padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font: inherit; background: var(--panel); color: var(--text); }
  .previa .acciones { display: flex; gap: 6px; }
  .previa .acciones button { padding: 8px 12px; min-height: 38px; border-radius: 8px; border: 1px solid var(--line); background: var(--superficie); cursor: pointer; color: var(--texto); font: inherit; }
  .previa .acciones button.primary { background: var(--accent); color: var(--primario-texto); border-color: var(--accent); }
  .thread.arrastrando::after { content: 'Suelta aquí para mandarlo'; position: absolute; inset: 0; display: grid; place-items: center;
    background: var(--primario-suave); border: 3px dashed var(--accent); font-weight: 600; color: var(--accent); z-index: 5; pointer-events: none; }

  /* ----------------------------------------------------- estados y avisos */
  .locked { background: var(--header); border-top: 1px solid var(--line); padding: 14px;
    color: var(--muted); font-size: 13.5px; text-align: center; flex: none; }
  .locked b { color: var(--text); }
  .locked .actions { margin-top: 10px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .locked select, .locked button, .locked input {
    font: inherit; font-size: 13px; padding: 8px 12px; min-height: 38px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer;
  }
  .locked button.primary { background: var(--accent); color: var(--primario-texto); border-color: var(--accent); }
  .empty { flex: 1; display: grid; place-items: center; color: var(--muted); text-align: center; padding: 40px; font-size: 15px; line-height: 1.6; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; }
  .pill.ok { background: var(--verde-suave); color: var(--verde); }
  .pill.bad { background: var(--rojo-suave); color: var(--rojo); }
  .pill.warn { background: var(--ambar-suave); color: var(--ambar); }
  .link { color: var(--accent); text-decoration: none; font-size: 13px; background: none; border: 0; font-family: inherit; cursor: pointer; }
  .icon { background: none; border: 0; color: var(--muted); cursor: pointer; font-size: 18px; padding: 4px 6px; min-width: 40px; min-height: 40px; border-radius: var(--radio-sm); display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
  .icon:hover { color: var(--accent); background: var(--superficie); }
  .icon[aria-expanded="true"] { color: var(--accent); background: var(--superficie); }
  .hidden { display: none !important; }
  /* El foco se ve siempre: se navega con teclado mas de lo que parece. */
  .icon:focus-visible, .composer button:focus-visible, .filtros .f:focus-visible,
  .flotante button:focus-visible, .msg .abrir-menu:focus-visible, .reacciones .r:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }

  /* ------------------------------------------------------------ visor y avisos */
  .visor { position: fixed; inset: 0; background: rgba(0,0,0,.85); display: flex;
           align-items: center; justify-content: center; z-index: 70; cursor: zoom-out; }
  .visor img, .visor video { max-width: 92vw; max-height: 92vh; border-radius: 6px; }
  .toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 26px; z-index: 80;
    background: var(--texto); color: var(--bg); padding: 10px 18px; border-radius: 10px; font-size: 13.5px;
    box-shadow: var(--sombra-2); max-width: 80vw; }

  /* traza "¿qué pasó?" */
  .traza { list-style: none; margin: 0; padding: 0; }
  .traza li { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13.5px; }
  .traza li:last-child { border-bottom: 0; }
  .traza li i { flex: none; width: 10px; height: 10px; border-radius: 50%; margin-top: 5px; background: var(--muted); }
  .traza li.ok i { background: var(--verde); } .traza li.warn i { background: var(--ambar); } .traza li.bad i { background: var(--rojo); }
  .traza li span { flex: 1; }
  .traza li small { display: block; color: var(--muted); font-size: 11.5px; }
  .traza-cab { font-size: 13px; color: var(--muted); margin: 0 0 10px; line-height: 1.5; padding: 8px 10px; background: var(--superficie-2); border-radius: var(--radio-sm); }
  .traza-cab b { color: var(--text); }

  /* ayuda de teclas */
  .ayuda-teclas { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 75; display: grid; place-items: center; padding: 20px; }
  .ayuda-teclas .caja { background: var(--panel); color: var(--text); border-radius: 14px; padding: 20px 22px; max-width: 560px; width: 100%; box-shadow: var(--sombra-2); max-height: 85vh; overflow: auto; }
  .ayuda-teclas h3 { margin: 0 0 10px; font-size: 16px; }
  .ayuda-teclas table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .ayuda-teclas td { padding: 6px 4px; border-bottom: 1px solid var(--line); }
  .ayuda-teclas kbd { font: 600 12px ui-monospace, Consolas, monospace; background: var(--header); border: 1px solid var(--line); border-radius: 5px; padding: 2px 6px; white-space: nowrap; }

  /* Confirmacion en la propia pantalla: un confirm() del navegador bloquea
     la pestana entera y deja el chat sin refrescar. */
  .confirmar { background: var(--header); border-top: 1px solid var(--line); padding: 14px 16px; flex: none; }
  .confirmar p { margin: 0 0 10px; font-size: 13.5px; color: var(--muted); }
  .confirmar b { color: var(--text); }
  .confirmar .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .confirmar button, .buscar-hilo button, .seleccion button {
    font: inherit; font-size: 13px; padding: 8px 12px; min-height: 38px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer;
  }
  .confirmar button.primary { background: var(--accent); color: var(--primario-texto); border-color: var(--accent); }
  .confirmar button.peligro { background: var(--rojo); color: #fff; border-color: var(--rojo); }

  /* lista de mensajes destacados */
  .destacado-fila { padding: 10px 14px; border-bottom: 1px solid var(--line); cursor: pointer; }
  .destacado-fila:hover { background: var(--header); }
  .destacado-fila .top { display: flex; gap: 8px; align-items: baseline; }
  .destacado-fila .quien { font-weight: 600; font-size: 13.5px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .destacado-fila .when { font-size: 11.5px; color: var(--muted); }
  .destacado-fila .que { font-size: 13px; color: var(--muted); margin-top: 3px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  /* elegir a quien reenviar */
  .reenviar-lista { max-height: 320px; overflow: auto; margin: 8px 0; border: 1px solid var(--borde); border-radius: var(--radio-sm); }
  .reenviar-lista label { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-bottom: 1px solid var(--line); cursor: pointer; font-size: 13.5px; min-height: 44px; }
  .reenviar-lista label:last-child { border-bottom: 0; }
  .reenviar-lista label:hover { background: var(--superficie-2); }
  .reenviar-lista input { width: 18px; height: 18px; flex: none; }

  @media (max-width: 820px) {
    .app { grid-template-columns: 1fr; }
    .side { display: none; }
    .app.open-thread .side { display: none; }
    .app:not(.open-thread) .thread { display: none; }
    .app:not(.open-thread) .side { display: flex; }
    .messages { padding: 14px 12px; }
    .msg { max-width: 85%; }
    .msg .estrella { left: 2px; top: -2px; }
    .msg.out .estrella { right: 2px; left: auto; }
      .rapidas-barra .chip { min-height: 36px; }
    .thread header { padding: 8px 10px; }
    .thread header .sub { white-space: normal; }
    .icon, .composer button, .filtros .f, .flotante button, .flotante a { min-height: 44px; }
    .icon, .composer button { min-width: 44px; }
    .bajar { bottom: 80px; right: 12px; }
    .flotante { min-width: 200px; max-width: calc(100vw - 24px); }
  }
`;
