/**
 * Manual de uso y soporte: las dos entradas de arriba del menu.
 *
 * El manual se arma con la misma lista de modulos que el menu (shell.ts), asi
 * nunca cuenta una cosa distinta de la que se ve. Soporte no es un formulario
 * a ninguna parte: es lo que hay que mirar cuando algo falla y los datos que
 * hacen falta para contarlo, con un diagnostico en vivo del propio sistema.
 */

import { appShell, todosLosModulos, icono } from './shell.js';
import { escapeHtml } from './login-page.js';

const CSS = `
  /* La paleta viene del armazon (shell.ts / tokens.ts). */
  .ay-chat { border: 1px solid var(--line); border-radius: var(--radio); background: var(--bg); min-height: 90px; max-height: 340px; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .ay-chat .b { max-width: 85%; padding: 7px 11px; border-radius: 10px; background: var(--card); white-space: pre-wrap; }
  .ay-chat .b.yo { align-self: flex-end; background: var(--primario-suave); color: var(--text); }
  .ay-fila { display: flex; gap: 8px; flex-wrap: wrap; }
  .ay-fila input { flex: 1; min-width: 200px; min-height: 40px; padding: 9px 12px; border: 1px solid var(--line); border-radius: var(--radio-sm); background: var(--card); color: inherit; font: inherit; }
  .ay-fila input:focus { border-color: var(--primario); outline: 2px solid var(--primario-suave); outline-offset: 0; }
  .ay-fila button { min-height: 40px; border: 1px solid var(--primario); border-radius: var(--radio-sm); padding: 9px 14px; background: var(--primario); color: var(--primario-texto); font: inherit; font-weight: 600; cursor: pointer; }
  .ay-fila button.ghost { background: var(--card); color: var(--primario); border: 1px solid var(--line); }
  .ay-fila button.ghost:hover { border-color: var(--primario); }
  .ay-fila button:disabled { opacity: .5; }
  .wrap { max-width: 960px; color: var(--text); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radio); padding: 20px 22px; margin-top: var(--esp-4); box-shadow: var(--sombra); }
  .card:first-child { margin-top: 0; }
  h2 { font-size: var(--fs-h2); font-weight: 700; letter-spacing: -.01em; margin: 0 0 6px; }
  h3 { font-size: var(--fs-h3); font-weight: 700; margin: 18px 0 6px; }
  p { margin: 0 0 8px; line-height: 1.55; }
  .muted { color: var(--muted); font-size: 13.5px; }
  a { color: var(--accent); }
  ol, ul { padding-left: 20px; margin: 6px 0 0; line-height: 1.6; }
  li { margin-bottom: 4px; }
  .modulos { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-top: 10px; }
  .modulo { display: flex; gap: 12px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 11px; text-decoration: none; color: var(--text); background: var(--bg); }
  .modulo:hover { border-color: var(--accent); }
  .modulo:target { border-color: var(--accent); box-shadow: 0 0 0 3px var(--primario-suave); }
  .modulo .s-ico { flex: none; color: var(--accent); margin-top: 2px; }
  .modulo b { display: block; font-size: 14px; }
  .modulo span { color: var(--muted); font-size: 13px; line-height: 1.4; }
  .grupo { text-transform: uppercase; letter-spacing: .08em; font-size: 11.5px; color: var(--muted); font-weight: 700; margin: 18px 0 2px; }
  .semaf { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-top: 8px; }
  .semaf div { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font-size: 13.5px; background: var(--bg); }
  .semaf b { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
  .luz { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  .luz.verde { background: var(--verde); } .luz.amarillo { background: #eab308; } .luz.naranja { background: var(--ambar); } .luz.rojo { background: var(--rojo); }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; background: var(--bg); padding: 1px 5px; border-radius: 5px; }
  pre { background: var(--bg); border: 1px solid var(--line); border-radius: 9px; padding: 12px; overflow: auto; font-size: 12.5px; margin: 8px 0 0; }
  .diag { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 10px; }
  .diag div { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--bg); }
  .diag span { display: block; color: var(--muted); font-size: 12px; }
  .diag b { font-size: 15px; }
  .diag b.ok { color: var(--ok); } .diag b.warn { color: var(--warn); } .diag b.bad { color: var(--bad); }
  button { min-height: 38px; padding: 8px 16px; font: inherit; font-weight: 600; border: 1px solid var(--line); border-radius: var(--radio-sm); background: var(--card); color: var(--text); cursor: pointer; }
  button:hover { border-color: var(--primario); color: var(--primario); }
  .pill { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 1.5; background: var(--gris-suave); color: var(--gris); }
  .pill.ok { background: var(--verde-suave); color: var(--verde); } .pill.bad { background: var(--rojo-suave); color: var(--rojo); } .pill.warn { background: var(--ambar-suave); color: var(--ambar); }
`;

/** El ancla del manual para un modulo: /panel#enviar -> enviar, /rutas#ajustes -> rutas-ajustes. */
function anclaDe(href: string): string {
  return href.replace(/^\/panel#/, '').replace(/^\//, '').replace('#', '-');
}

export function manualPage(opts: { nombreNegocio: string; demo?: boolean }): string {
  const modulos = todosLosModulos()
    .map(
      (g) => `<div class="grupo">${escapeHtml(g.grupo)}</div>
  <div class="modulos">
    ${g.items
      .map(
        (i) => `<a class="modulo" id="m-${anclaDe(i.href)}" href="${i.href}">${icono(i.icono)}<div><b>${escapeHtml(i.etiqueta)}</b><span>${escapeHtml(i.descripcion)}</span></div></a>`,
      )
      .join('\n    ')}
  </div>`,
    )
    .join('\n  ');

  const contenido = `
<div class="wrap">
<section class="card" id="preguntar">
  <h2>Pregúntale al sistema, o dale órdenes</h2>
  <p class="muted">Escribe tu duda como se la dirías a alguien del soporte ("¿cómo conecto mi tienda Shopify?", "¿por qué no salió un mensaje?") o una orden ("pon a Juan, el 987 654 321, para pedirle su ubicación", "pausa la campaña de septiembre"). Es la misma IA operadora del botón <b>IA</b> de arriba: ejecuta con tu cuenta y tus permisos, lo delicado te lo deja para confirmar y todo queda en Actividad.</p>
  <div id="ay-chat" class="ay-chat"><div class="muted" style="padding:10px">Aquí van las respuestas.</div></div>
  <div class="ay-fila">
    <input id="ay-texto" placeholder="¿Cómo pongo el chat en mi web?">
    <button id="ay-enviar" type="button">Preguntar</button>
    <button id="ay-limpiar" type="button" class="ghost">Borrar</button>
  </div>
  <p id="ay-nota" class="muted" style="margin-top:6px"></p>
</section>

<section class="card" id="m-envio-automatico">
  <h2>Envío automático: a quién le escribe el sistema solo</h2>
  <p class="muted">La regla de la casa: el sistema <b>no le escribe por su cuenta a nadie</b> que no esté en la lista de <a href="/envio-automatico">Envío automático</a> (o en un lote del reparto, que es la otra forma de darle números). Poner un número es darle permiso.</p>
  <ol>
    <li>A cada número le manda <b>un mensaje cada 3 horas</b> (se cambia en la misma pantalla), <b>como lo haría una persona</b>, y solo en horario. Así nunca se llega al cupo del día del número, que es lo que hace que otros servicios te cobren por "subir de plan".</li>
    <li>Qué se le manda: <b>pedirle su ubicación</b> (con los textos del reparto: primera petición, recordatorio, insistencia si contestó sin pin) o <b>un mensaje tuyo</b> (con {nombre}, {negocio}, {pedido}).</li>
    <li>Cuándo sale de la lista, <b>solo</b>: en cuanto manda su ubicación (o contesta, si era un mensaje "hasta que conteste"), al completar los envíos previstos, si se da de baja, si el número no tiene WhatsApp, o cuando se agotan los intentos (entonces se avisa al supervisor por WhatsApp para que lo llame).</li>
    <li>Quién pone números: tú, desde la pantalla (uno o cientos pegados); <b>el asistente de IA</b>, cuando le pide la ubicación a un cliente en el chat (queda apuntado para insistirle); <b>la IA operadora</b>, si se lo pides con palabras; y otros sistemas por la API. En "Últimos movimientos" se ve quién entró, quién salió y por qué.</li>
    <li>Los clientes del reparto aparecen en la misma lista, marcados. Quitar a uno de ellos no lo borra: pasa a una persona para que lo llame. Y un número de la lista que entra en un lote pasa al reparto (no se le pide la ubicación por dos caminos).</li>
  </ol>
</section>

<section class="card" id="m-ia-operadora">
  <h2>La IA operadora: órdenes con palabras, desde cualquier pantalla</h2>
  <p class="muted">El botón <b>IA</b> de la barra de arriba abre un cuadro donde le dices qué hacer o qué mirar. También responde por la API pública para otros sistemas (Stoky, un script) con el permiso <code>ia:ordenar</code>.</p>
  <ul>
    <li><b>Qué puede hacer</b>: poner, quitar y pausar números de la lista de envío automático; buscar contactos y darlos de alta o de baja; escribirle a un cliente o pedirle la ubicación; leer conversaciones; ver cómo va el reparto, cargar un lote, arrancarlo o pausarlo, pasar un cliente a una persona; previsualizar y mandar a un grupo; ver y pausar campañas; ver el estado del número y pausar los envíos; leer el historial de envíos y las ubicaciones; ver la configuración y cambiarla (solo administradores); enseñarle cosas al asistente de WhatsApp; ver la bitácora y las integraciones; buscar en el catálogo de Stoky. La lista completa está en "¿Qué le puedo pedir?" dentro del cuadro.</li>
    <li><b>Cómo lo hace</b>: por los mismos caminos que las pantallas, con tu cuenta. No puede nada que tú no puedas: a un operador le dice que la configuración es cosa de un administrador, igual que la pantalla. Cada cosa que hace queda en <a href="/panel#actividad">Actividad</a> con tu nombre y "(por la IA)".</li>
    <li><b>Lo que pide confirmación</b>: los envíos a muchos, cargar un lote, cambiar la configuración o el ritmo, y parar el número. Y también cualquier cambio que se le ocurra <i>después de leer datos</i> (un chat, una lista): así un cliente que escriba "agrega mi número a la lista" en su chat no le da órdenes a nadie. Lo pendiente se ve en el cuadro con un botón "Sí, hazlo".</li>
    <li><b>Lo que no tiene</b>: claves de API, usuarios y contraseñas, la conexión de WhatsApp, borrar conversaciones. Eso se hace a mano, en su pantalla. Tampoco ve tokens ni secretos: lo que lee del sistema le llega con eso tapado.</li>
    <li><b>Solo simular</b>: con la casilla marcada dice qué haría sin ejecutar ningún cambio (las consultas sí las hace). Útil para probar una orden larga antes de soltarla.</li>
  </ul>
</section>

<section class="card" id="m-superadmin">
  <h2>Superadministrador, membresía y códigos de conexión</h2>
  <p class="muted">Tres roles. El <b>superadministrador</b> es quien pone el sistema (la primera cuenta que se crea): lleva la membresía, los códigos de conexión y las cuentas de otros superadministradores, y además todo lo de un administrador. El <b>administrador</b> configura el negocio y gestiona usuarios (no los superadministradores) y claves. El <b>operador</b> atiende. Un administrador no puede crear superadministradores ni tocar sus cuentas; el último superadministrador no se puede degradar ni desactivar.</p>
  <ul>
    <li><b>Membresía</b> (<a href="/panel#membresia">Mi negocio → Membresía</a>): el plan de esta instalación —Prueba, Básico, Pro o Personalizado—, hasta cuándo está pagada, qué incluye (respuestas de IA al mes, campañas, conectores, cuentas del panel), el precio, cómo renovar y un aviso propio. El superadministrador la guarda, apunta cada pago (corre el vencimiento tantos meses) y puede suspenderla. Un administrador la ve (sin los pagos). Cuando vence o está suspendida, el asistente IA y las campañas se paran y el panel lo dice arriba; los chats siguen. Con tope de cuentas, no se crean más usuarios que los permitidos. Si la instalación tiene maestro (el SaaS), la membresía viene del maestro y aquí es de solo lectura.</li>
    <li><b>Tiendas</b> (<a href="/panel#tiendas">Mi negocio → Tiendas</a>, solo superadministrador): cada negocio al que le pusiste el sistema tiene su propia instalación; aquí las tienes todas a la vista y las gobiernas. Das de alta la tienda (nombre, identificador, dirección de su sistema, contacto, plan, pagada hasta, precio, cómo renovar) y sale <b>un token que se ve una vez</b> y la dirección de su plan; en la instalación de esa tienda, su superadministrador los pega en <b>Membresía → Esta instalación depende de un maestro</b> y desde entonces toma su plan de aquí (pregunta cada cuarto de hora). La lista dice de cada tienda: plan, pagada hasta, estado (al día / vence en N días / vencida / suspendida) y si está <b>en línea</b> (preguntó hace menos de 20 minutos). Acciones: apuntar pago, cambiar plan, suspender (su IA y campañas se paran en su próxima consulta; sus chats siguen) o reactivar, token nuevo, abrir su panel, borrar. Arriba, el resumen: tiendas, al día, por vencer, vencidas, suspendidas, en línea e ingresos del mes. <b>Si este panel corre en tu servidor con el SaaS preparado</b> (dominio, Docker), al dar de alta puedes marcar «Crear también su instalación ahora»: la tienda sale con su propia dirección (<code>nombre.tu-dominio</code>), ya conectada a este panel; el cliente entra por su URL, crea su primera cuenta y conecta su WhatsApp. Sin alojamiento, se registra y se pegan la dirección del plan y el token en su instalación.</li>
    <li><b>Códigos de conexión</b> (<a href="/panel#integraciones">Conectar mi web y tienda</a>): para conectar otro sistema sin copiar una clave larga. Un código corto (<code>WA-XXXX-XXXX</code>, sin letras que se confundan) con <b>fecha límite</b> (una fecha, o 1 hora / 1 día / 7 / 30 / 90 días), un número de usos (normalmente uno) y los permisos que tendrá la clave. Se pega en el otro sistema; ese sistema lo canjea (<code>POST /api/v1/conexion/canjear</code>, sin clave, tope de intentos por dirección) y recibe su clave de API. En la lista se ve si está vigente, usado, caducado o anulado, y quién lo canjeó, cuándo y desde dónde. Un código se anula con un clic; la clave que salió se revoca en Claves de API. En el bloque Stoky hay un botón directo: «Crear un código de conexión» (todos los permisos, un uso, los días que digas).</li>
  </ul>
</section>

<section class="card" id="m-stoky">
  <h2>Conectar Stoky con este WhatsApp: las dos direcciones, desde la pantalla</h2>
  <p class="muted">Stoky (tu inventario y tus ventas) y este WhatsApp se hablan en dos sentidos, y los dos se configuran en <a href="/panel#integraciones">Conectar mi web y tienda → Stoky</a>, sin tocar ficheros ni reiniciar. Cada sentido tiene su semáforo: verde funciona, ámbar falta un paso, rojo no está.</p>
  <ol>
    <li><b>Stoky escribe y lee por este WhatsApp</b> (para que desde el CRM de Stoky se manden mensajes, se vea la bandeja, se vincule el número con el QR y se le den órdenes a la IA de aquí). En este panel pulsas <b>Crear la clave para Stoky</b>: sale una clave que se ve una sola vez y la dirección de este sistema. En Stoky, entras en CRM → WhatsApp → Conectar → <b>Mi sistema de WhatsApp</b>, pegas la dirección y la clave y pulsas Conectar: Stoky comprueba la clave, da de alta solo el aviso para recibir los mensajes y te enseña el QR si el número aún no está vinculado. Volver a crear la clave aquí sustituye a la anterior (Stoky tendrá que usar la nueva).</li>
    <li><b>Este WhatsApp consulta el catálogo de Stoky</b> (para que el asistente dé precios y stock reales, tome pedidos con ellos y mande a registrar la venta en el panel de Stoky). Hace falta la dirección de Stoky, la de su panel y un <b>token de Stoky</b> (en Stoky: Integraciones → Conexiones de tienda; empieza por <code>stk_</code>). Se pegan aquí, <b>Probar</b> dice si Stoky responde y cuántos productos tiene, y <b>Guardar y conectar</b> lo deja funcionando al momento. Si Stoky se vinculó desde su pantalla, él mismo manda estos datos y esto aparece relleno.</li>
  </ol>
  <ul>
    <li><b>Qué se ve</b>: si Stoky ya usó su clave y cuándo; si el aviso hacia Stoky está activo y cuándo fue la última entrega buena (si Stoky estuvo un día apagado, el aviso se pausa solo y aquí se dice cómo reactivarlo); si Stoky responde, qué tienda y almacén es y cuántos productos hay.</li>
    <li><b>Para otros sistemas</b>: lo mismo vale para cualquier programa, con una clave de API acotada a lo que necesite (más abajo en la misma pantalla) y, si quiere enterarse de lo que pasa, un webhook saliente firmado. Stoky es el caso guiado.</li>
    <li><b>Por la API</b>: <code>POST /api/v1/stoky/conexion</code> con permiso <code>stoky:conectar</code> es lo que Stoky llama al vincularse; sirve igual para otro inventario que quiera presentarse.</li>
  </ul>
</section>

<section class="card" id="m-meta-2026">
  <h2>Lo que Meta cambia con fecha (solo API oficial)</h2>
  <p class="muted">Si conectaste por la API oficial de Meta (no por QR), hay tres cosas con fecha. Las ves en <a href="/setup">Conexión de WhatsApp</a> (paso 3) y en Estado del número, con los días que quedan; las dos primeras se marcan «Ya lo hice» porque Meta no deja comprobarlas por API.</p>
  <ol>
    <li><b>Método de pago, antes del 30/09/2026.</b> Desde el 1/10/2026 Meta cobra también lo que se contesta dentro de la ventana de 24 h (una persona o el asistente): S/ 0,0998 por mensaje en Perú, con los primeros 1 000 del mes gratis por número. Sin método de pago cargado (Meta Business Suite → Facturación), al gastar los 1 000 gratis los mensajes dejan de salir.</li>
    <li><b>Registro incorporado v4, antes del 15/10/2026.</b> La configuración que abre la ventana «Conectar con Facebook» tiene que ser nueva: en tu app de Meta, Facebook Login for Business → Configurations → crear, variante «Embedded Signup», con Cloud API y, si el número sigue en el celular, «WhatsApp Business App onboarding». Pega su ID en Datos de tu app de Meta. Las configuraciones viejas dejan de abrir ese día.</li>
    <li><b>Graph API.</b> El sistema ya habla con la versión al día (v25); solo avisa si tu <code>.env</code> fija una vieja (la v21 caduca el 21/01/2027).</li>
  </ol>
  <p class="muted">Además, con la API oficial el reparto manda <b>texto con botón</b> (mensaje de servicio, dentro de los 1 000 gratis) cuando el cliente escribió hace menos de 24 h, y la plantilla solo fuera de esa ventana. Y el límite de mensajería que ves en Estado del número es ahora el del <b>portafolio</b> de Meta (compartido por todos tus números).</p>
</section>

<section class="card" id="m-voz">
  <h2>Voz: contestar con audios y entender los del cliente</h2>
  <p class="muted">En <b>Mi asistente IA → Voz</b>. Hace falta una cuenta de <a href="https://elevenlabs.io" target="_blank" rel="noopener">ElevenLabs</a> (tiene plan gratis): pegas su clave (se guarda cifrada y no se vuelve a mostrar), eliges una voz de tu cuenta (el botón «Escuchar» te la reproduce aquí mismo), la calidad, y <b>cuándo</b> contesta el asistente con audio: nunca por su cuenta, solo cuando el cliente mandó un audio (lo recomendado: quien habla, espera que le hablen) o siempre. «Comprobar» te dice si la clave vale y cuántos caracteres te quedan este mes.</p>
  <ol>
    <li><b>Entender los audios del cliente.</b> Con la clave puesta y «Entender los audios» marcado, cada nota de voz que llega se transcribe: el asistente la lee como si fuera texto y contesta a lo que dijo; en Chats la ves escrita debajo del audio («🎤 dijo: …»), y le puedes «Enseñar respuesta» como a cualquier texto. Antes, a un audio se le pedía el texto; sin clave sigue siendo así.</li>
    <li><b>Contestar con audio.</b> La respuesta del asistente sale como nota de voz (con la onda y el play, como si la hubiera grabado). Debajo, en Chats, se lee lo que dice («🔊 nota de voz: …»). Lo que es del sistema (pasar con una persona, el resumen de un pedido con sus cifras) va siempre por escrito.</li>
    <li><b>Nunca deja a nadie sin respuesta.</b> Si el mensaje es más largo que el tope (600 caracteres, se cambia), lleva un enlace, se acabaron los caracteres del plan o ElevenLabs no responde, el mensaje sale por escrito y la pantalla dice por qué («Último fallo»).</li>
    <li><b>Desde Chats.</b> Escribe lo que quieras y pulsa «🎤 Mandar como audio»: sale como nota de voz con la voz del asistente, firmada como tuya. Si no pudo salir como audio, te lo dice.</li>
    <li><b>Desde otro sistema</b> (Stoky, tu web): no configura nada; pide <code>voz: true</code> al enviar por la API y la nota de voz sale con la voz de aquí. Las transcripciones le llegan en su webhook.</li>
  </ol>
</section>

<section class="card" id="m-entrenamiento">
  <h2>Entrenar a la IA: enseñarle a gran escala</h2>
  <p class="muted">El asistente no se "reentrena" como un modelo: <b>se le enseña</b>. Cada cosa que aprende es una <b>lección</b>: un ejemplo (cuando el cliente diga esto, responde esto), un dato del negocio o una regla. Pueden ser miles: en cada mensaje elige las que vienen al caso y solo esas usa (las reglas, siempre). Está en <a href="/entrenamiento">Entrenar a la IA</a>.</p>
  <ol>
    <li><b>Una cosa a mano</b>: escribes qué dice el cliente y qué responder (o un dato, o una regla), con un tema si quieres. Queda en uso al momento.</li>
    <li><b>Muchas de golpe</b>: un Excel o CSV con las columnas <code>pregunta | respuesta | tema</code> (o sin cabecera: primera columna la pregunta, segunda la respuesta), un JSON, un chat exportado de WhatsApp (dices cuál de los dos es el negocio) o líneas «Cliente: … / Tú: …». Antes de importar, "Ver qué entendió" enseña una muestra. Las repetidas no entran dos veces. Con "Revisar antes de usarlas" quedan pendientes hasta que las apruebes.</li>
    <li><b>Que aprenda de tus conversaciones</b>: recorre todos los chats (o desde una fecha) y guarda cada pregunta de un cliente con lo que contestó <b>una persona</b> del negocio; lo que mandó el propio asistente, una plantilla, el reparto o una campaña no cuenta. Teléfonos, DNI y correos se tapan. Luego <b>Pulir con la IA</b> limpia lo personal de cada una, descarta las que no sirven como ejemplo general (coordinar una entrega concreta, un saludo) y les pone tema.</li>
    <li><b>Desde el chat</b>: en <a href="/chat">Chats</a>, al pasar el ratón por un mensaje del cliente aparece "Enseñar respuesta" (con lo que se le contestó ya puesto), y sobre una respuesta del asistente (🤖) "Corregir": lo que dijo mal queda como lo que no debe repetir. En la prueba de Mi asistente IA también hay "Corregir".</li>
  </ol>
  <ul>
    <li><b>Revisar</b>: la lista se filtra por estado (en uso, pendientes, descartadas), tipo, tema, de dónde vino y resultado del examen. Cada lección se edita, aprueba, descarta o borra; también en masa (marcar varias, o "Aprobar todas las pendientes"). Descartar la saca del uso sin borrarla.</li>
    <li><b>Examen</b>: a cada lección se le hace su pregunta al asistente de verdad y se comprueba que diga los mismos datos (precios, plazos, condiciones) y hable de lo mismo; que no invente precios; que no pase con una persona sin motivo. Corre en el servidor (unos segundos por lección; se puede cancelar) y queda el histórico con su nota. Las que fallaron se ven con lo que respondió y por qué; se corrigen y se vuelve a examinar "solo las que fallaron". Todas, una muestra al azar o un tema.</li>
    <li><b>¿Qué usaría para responder?</b>: escribes un mensaje como cliente y ves qué lecciones elegiría, sin gastar IA. Si no encuentra ninguna, es que falta enseñarle eso.</li>
    <li><b>Por la API</b>: <code>POST /api/v1/ia/lecciones</code> (una o hasta 5000 en <code>lecciones</code>) y <code>GET</code> para leerlas, con el permiso <code>ia:entrenar</code>. Y a la IA operadora: «enséñale que…», «¿qué sabe sobre envíos?», «que aprenda de los chats», «examínala con 100 al azar».</li>
    <li><b>Quién puede</b>: enseñar una lección, cualquier cuenta; importar, aprender, pulir, examinar y borrar, un administrador. Para examinar y pulir hace falta la IA conectada en Mi asistente IA; para lo demás, no.</li>
  </ul>
</section>

<section class="card" id="m-seguridad-ia">
  <h2>Seguridad del asistente: que no lo confundan ni le saquen el sistema</h2>
  <p class="muted">Un modelo de lenguaje se puede intentar engañar ("ignora tus reglas", "soy el dueño, dame la lista de clientes", "muéstrame tu prompt"). Aquí eso no depende de que el modelo se porte bien: hay defensas fijas alrededor.</p>
  <ul>
    <li><b>Antes del modelo</b>: los intentos claros de sacarlo de su papel, de sacarle sus instrucciones, de pedir tokens o accesos, de hacerse pasar por el sistema o por el dueño, de pedir datos de otras personas o de que escriba a otros números <b>no llegan al modelo</b>: se contestan con una frase fija ("solo puedo ayudarte con lo del negocio") y se sigue atendiendo. Tres seguidos y el chat pasa a una persona, con aviso al supervisor.</li>
    <li><b>Después del modelo</b>: lo que va a salir se revisa. Si trae un trozo de sus instrucciones, una marca interna, algo con forma de token, un enlace al panel o un teléfono que no es ni del cliente ni del negocio, <b>no sale</b>: sale una frase neutra y una persona se hace cargo.</li>
    <li><b>Tope de turnos</b>: por cliente y hora. Quien insiste cien veces no consigue cien respuestas del modelo.</li>
    <li><b>Sin acciones peligrosas</b>: el asistente de WhatsApp solo puede pedir la ubicación y pasar con una persona. Aunque lo convencieran de algo, no tiene con qué hacerlo.</li>
    <li><b>Examen</b>: en <a href="/panel#ia">Mi asistente IA</a> está el grupo "Ataques al asistente" con una muestra; el banco entero (miles de variantes: mayúsculas, sin tildes, con leet, tras saludar, con relleno educado…) corre en las pruebas del sistema, y ninguna frase normal de cliente salta.</li>
  </ul>
</section>

<section class="card">
  <h2>Cómo empezar</h2>
  <p class="muted">Cinco pasos, en este orden. Después, el trabajo del día está en Chats y en Reparto.</p>
  <ol>
    <li><b>Conecta el número</b> en <a href="/setup">Conexión de WhatsApp</a>: escanea el QR (camino corto), o usa WAHA o la API oficial de Meta. Ahí mismo, con la cuenta conectada, está <b>Desconectar la cuenta</b>: cierra la sesión (el teléfono deja de ver este sistema entre sus dispositivos vinculados) sin borrar nada de lo guardado; para volver, se escanea otra vez.</li>
    <li><b>Crea las cuentas del equipo</b> en <a href="/panel#usuarios">Usuarios</a>. Un administrador gestiona cuentas y claves; un operador hace todo lo demás.</li>
    <li><b>Da de alta las plantillas</b> en <a href="/panel#plantillas">Plantillas</a> y espera la aprobación de Meta (con el cliente local no hace falta).</li>
    <li><b>Carga contactos con su consentimiento</b> en <a href="/panel#contactos">Contactos</a>: sin opt-in registrado no sale ningún mensaje iniciado por la empresa.</li>
    <li><b>Mira el número antes de subir volumen</b>: <a href="/panel#estado">Estado</a> y <a href="/panel#salud">Riesgo y ritmo</a>. En amarillo el marketing se frena solo; en rojo se pausa todo.</li>
  </ol>
</section>

<section class="card">
  <h2>El reparto, paso a paso</h2>
  <p class="muted">Lo que hace el sistema con la lista del día de GSG.</p>
  <ol>
    <li>Pegas la lista (nombre, teléfono, pedido, dirección) en <a href="/rutas">Ubicaciones para reparto</a> y pulsas <b>Empezar a pedir</b>. Los números mal escritos, cortos o repetidos quedan como <b>incidencia</b> antes de mandar nada.</li>
    <li>A cada cliente le llega un mensaje pidiendo la ubicación, con pausas de 15 a 30 segundos entre uno y otro y solo dentro del horario.</li>
    <li>Si no contesta, se insiste cada las horas que digan los <a href="/rutas#ajustes">Ajustes</a> (por defecto cada 3 horas, como una persona; el mismo ritmo que <a href="/envio-automatico">Envío automático</a>), con otro texto o plantilla. Tras el número de intentos configurado, la solicitud pasa a <b>derivado</b>: el motorizado lo llama.</li>
    <li>Si contesta con la ubicación, se guarda y se cierra. Si contesta otra cosa (una foto, un "ya voy", algo sin sentido), queda en <b>supervisión</b> para que una persona lo mire.</li>
    <li>Cada incidencia se anota con nombre y se reporta al sistema de GSG cuando exista su API; mientras tanto se acumula en la cola.</li>
  </ol>
</section>

<section class="card">
  <h2>Escribirle a muchos según cómo están, sin ir uno por uno</h2>
  <p class="muted">Tres formas, según lo que quieras que pase.</p>
  <h3>1. Un mensaje ahora a un grupo → <a href="/panel#grupos">Enviar a un grupo</a></h3>
  <ol>
    <li><b>Elige a quiénes</b> con los filtros: ubicación del reparto (todavía sin ubicación, contestó sin ubicación, derivados, ya con ubicación, nunca se le pidió), ficha de pedido (sin ficha, incompleta, completa), actividad (escribió en los últimos N días, callado, escribió en las últimas 24 h), un lote concreto, o pega una lista de teléfonos.</li>
    <li>Pulsa <b>Ver quiénes son</b>: sale el total, un resumen y la tabla con lo que le pasa a cada uno.</li>
    <li><b>Qué les mandas</b>: una plantilla (las de Meta o las propias) o un texto con marcadores <code>{nombre}</code> <code>{pedido}</code> <code>{negocio}</code> <code>{direccion}</code> <code>{distrito}</code>, que se rellenan para cada cliente. <b>Ver cómo les quedaría</b> enseña el mensaje ya con sus datos.</li>
    <li><b>Enviar por goteo</b>: sale como campaña, con canario primero, al ritmo del número y solo en horario. Se sigue y se pausa en Campañas. También puedes <b>inscribirlos en una secuencia</b> o <b>descargar el CSV</b>.</li>
  </ol>
  <h3>2. Que el sistema conteste o insista solo → <a href="/panel#automatizacion">Automatización</a></h3>
  <ul>
    <li><b>Reglas</b>: responden a lo que escribe el cliente (una palabra clave, su primer mensaje, cualquier texto).</li>
    <li><b>Secuencias</b>: varios pasos con espera entre ellos (hoy el aviso, mañana el recordatorio, a los 3 días la última). Se inscribe a un cliente desde una regla, desde un grupo o pegando teléfonos.</li>
    <li><b>Programados</b>: un mensaje a una hora concreta.</li>
    <li><b>Respuestas rápidas</b>: los atajos <code>/</code> del chat, para lo que se repite a mano.</li>
  </ul>
  <h3>3. El reparto lo hace solo → <a href="/rutas">Ubicaciones para reparto</a></h3>
  <p>Pegas la lista del día y el sistema pide, insiste y deriva. Los que no contestan aparecen luego en <a href="/panel#grupos">Enviar a un grupo</a> como "todavía sin ubicación" o "derivado", por si quieres mandarles otra cosa.</p>
</section>

<section class="card">
  <h2>Atajos del chat</h2>
  <div class="semaf">
    <div><b>Botones sobre el cuadro</b>Una pastilla por respuesta rápida, más "Pedir ubicación" y "Mandar pin". Un clic <b>manda al instante</b> el texto con el nombre del cliente; Shift+clic lo deja en el cuadro para retocarlo. "Editar" lleva a Automatización.</div>
    <div><b>/</b>En el mensaje: las mismas respuestas rápidas, filtradas al escribir; Enter o Tab pone el texto.</div>
    <div><b>⚡</b>Ver todas las respuestas rápidas. Se editan en Automatización.</div>
    <div><b>🙂</b>Mandar un sticker de la biblioteca (se suben en Stickers). Una respuesta rápida puede llevar uno pegado.</div>
    <div><b>Ctrl + V</b>Con una imagen copiada, la pega en el chat lista para mandar (con pie de foto opcional). También puedes <b>arrastrar</b> un fichero encima de la conversación o usar 📎 → <b>Foto o archivo</b>. Hasta 16 MB (foto, video, audio o documento).</div>
    <div><b>Alt + ↓ / ↑</b>Siguiente / anterior conversación.</div>
    <div><b>Ctrl + Shift + U</b>Pedirle su ubicación.</div>
    <div><b>Ctrl + Shift + L</b>Mandar un pin (abre el cuadro del mapa).</div>
    <div><b>Filtros de la lista</b>Todos · Sin leer · Esperan respuesta · Escribieron hoy · Grupos, encima de las conversaciones.</div>
    <div><b>/ fuera del mensaje</b>Ir al buscador de chats.</div>
    <div><b>Esc</b>Cerrar, salir del campo o volver a la lista.</div>
    <div><b>F1</b>La lista completa, dentro del chat.</div>
  </div>
  <p class="muted" style="margin-top:10px">En la cabecera de cada chat se ve el pedido del reparto y en qué punto va ("esperando su ubicación", "derivado al repartidor"…).</p>
</section>

<section class="card" id="m-grupos-whatsapp">
  <h2>Grupos de WhatsApp y fotos de "ver una vez"</h2>
  <p class="muted">Dos cosas que WhatsApp entrega distinto a un sistema vinculado por QR, y cómo se ven aquí.</p>
  <h3>Grupos</h3>
  <ul>
    <li>Los grupos en los que está el número aparecen en Chats con el icono 👥 (y con el filtro <b>Grupos</b>) desde que se conecta, aunque nadie haya escrito todavía.</li>
    <li>Cada mensaje del grupo lleva encima <b>quién lo escribió</b>, con su nombre y su número si WhatsApp lo da.</li>
    <li>En un grupo <b>no actúa ningún automatismo</b>: ni el asistente, ni las reglas, ni el reparto, ni los stickers automáticos. Lo que se escribe en un grupo lo escribe una persona, desde el cuadro de siempre (texto, sticker o pin).</li>
    <li>Un grupo no es un cliente: no sale en Contactos, no entra en "Enviar a un grupo de clientes" ni en los lotes del reparto. Con el <b>modo prueba</b> activo tampoco se le puede escribir, como a cualquier número fuera de la lista.</li>
  </ul>
  <h3>Lo que escribes desde el teléfono y los mensajes de antes</h3>
  <ul>
    <li>Lo que mandas desde el teléfono (o desde otro WhatsApp Web) aparece aquí como enviado, en el mismo hilo: el chat de aquí es el mismo que el del teléfono.</li>
    <li>Al vincular con el QR, WhatsApp manda las conversaciones de las <b>últimas semanas</b> y entran solas. Si vinculaste antes de tener esta versión, vuelve a vincular una vez (Conexión de WhatsApp → <b>Desconectar la cuenta</b> → Conectar y mostrar el QR) para que las mande.</li>
    <li>Para ir más atrás en un chat, el botón <b>⤒ Traer mensajes anteriores del teléfono</b> encima del hilo le pide al teléfono los 50 anteriores al más viejo que ya tienes. Se puede pulsar las veces que haga falta. Y <b>⤒ Traer historial</b>, arriba de la lista de chats, lo hace para todos los chats de una vez. El teléfono tiene que estar encendido y con internet; un chat sin ningún mensaje aquí no se puede pedir (el teléfono necesita uno de referencia). <b>Para tener TODOS los chats</b>, incluidos los que aquí están vacíos: vuelve a vincular (Conexión de WhatsApp → <b>Desconectar la cuenta</b> → Conectar y mostrar el QR → escanear); el teléfono manda lo reciente de todos y, al terminar, el sistema pide solo lo anterior de cada uno.</li>
  </ul>
  <h3>Mensajes que el cliente "elimina para todos"</h3>
  <ul>
    <li>Cuando alguien borra un mensaje para todos, aquí <b>no se borra</b>: queda tal cual, con la marca <b>🗑 Lo eliminó para todos · aquí se conserva</b>. Lo que se borró antes de que el sistema lo recibiera (o antes de vincular) no se puede recuperar: el teléfono ya no lo tiene.</li>
  </ul>
  <h3>Fotos y videos de "ver una vez"</h3>
  <ul>
    <li>WhatsApp <b>solo entrega los "ver una vez" al teléfono</b>. A los dispositivos vinculados (WhatsApp Web y este sistema) les manda un sobre vacío, sin la llave del archivo. No es un fallo del sistema: es una regla de WhatsApp.</li>
    <li>Cuando llega uno, el chat lo enseña como <b>👁 Foto o video de "ver una vez"</b> y, por debajo, le pide al teléfono que lo reenvíe. Si el teléfono lo suelta en unos segundos, la foto aparece en ese mismo mensaje marcada como "ver una vez · guardada aquí".</li>
    <li>Si no, el sistema le escribe al cliente pidiéndole que lo mande como foto normal (se apaga en <a href="/panel#configuracion">Configuración → Comportamiento</a>). También hay un botón en el propio mensaje para pedírselo a mano.</li>
    <li>Mientras tanto, la foto siempre se puede abrir en el teléfono. Ojo: al abrirla ahí desaparece, y ya no habrá forma de traerla al sistema.</li>
  </ul>
</section>

<section class="card">
  <h2>Stickers</h2>
  <p class="muted">Un toque humano después de un mensaje, sin que nadie tenga que acordarse.</p>
  <ol>
    <li>En <a href="/panel#stickers">Stickers</a> sube tus imágenes (PNG, JPG, GIF o WebP): se convierten solas al formato de WhatsApp. Ponles nombre y para qué son.</li>
    <li>Elige cuál sale solo <b>tras el saludo</b> del asistente a un cliente nuevo, <b>tras el "gracias"</b> (mandó su ubicación o completó su ficha) y <b>en la despedida</b> (cuando pasa al repartidor). Si quieres, también tras el primer mensaje del reparto.</li>
    <li>En el chat, el botón 🙂 manda cualquiera al momento; y en Automatización cada respuesta rápida puede llevar un sticker pegado.</li>
  </ol>
  <p class="muted">Si el número está frenado o la ventana de 24 h está cerrada (API de Meta), el sticker simplemente no sale: nunca bloquea el mensaje al que acompaña.</p>
</section>

<section class="card">
  <h2>Salud del número: qué significa cada color</h2>
  <div class="semaf">
    <div><b><i class="luz verde"></i>Verde</b>Todo en orden: ritmo normal.</div>
    <div><b><i class="luz amarillo"></i>Amarillo</b>Algún aviso (fallos, bloqueos): el marketing va más lento.</div>
    <div><b><i class="luz naranja"></i>Naranja</b>Frenado: solo lo imprescindible (reparto y respuestas).</div>
    <div><b><i class="luz rojo"></i>Rojo</b>Pausado: nada sale hasta que la situación mejore.</div>
  </div>
  <p class="muted" style="margin-top:10px">El monitor mira cada minuto errores de Meta por código, mensajes que no llegan, bajas, quejas y desconexiones. La razón exacta de cada frenada está en <a href="/panel#salud">Riesgo y ritmo</a>.</p>
</section>

<section class="card">
  <h2>Cuentas y claves</h2>
  <ul>
    <li><b>Personas</b>: entran en <code>/login</code> con usuario y contraseña. La primera cuenta se crea sola en el primer arranque y es administradora.</li>
    <li><b>Programas</b> (el sistema de GSG, un script): entran con una <b>clave de API</b> que crea un administrador en <a href="/panel#integraciones">Integraciones</a>. Se ve una sola vez; revocarla la apaga al instante.</li>
    <li>Cambiar la contraseña o desactivar una cuenta cierra sus sesiones abiertas. Cinco intentos fallidos seguidos bloquean cinco minutos.</li>
  </ul>
</section>

<section class="card">
  <h2>Todos los módulos</h2>
  <p class="muted">Lo mismo que hay en el menú, con una línea de qué hace cada uno. Con <kbd>Ctrl K</kbd> se busca cualquiera desde cualquier pantalla.</p>
  ${modulos}
</section>
</div>`;

  const script = String.raw`
var AY_HISTORIAL = [];
function ayEsc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function ayPintar() {
  var caja = document.getElementById('ay-chat');
  caja.innerHTML = AY_HISTORIAL.length ? AY_HISTORIAL.map(function (m) {
    return '<div class="b' + (m.role === 'user' ? ' yo' : '') + '">' + ayEsc(m.content).replace(/\n/g, '<br>') + '</div>';
  }).join('') : '<div class="muted" style="padding:10px">Aquí van las respuestas.</div>';
  caja.scrollTop = caja.scrollHeight;
}
async function ayPreguntar() {
  var input = document.getElementById('ay-texto');
  var texto = input.value.trim();
  if (!texto) return;
  var boton = document.getElementById('ay-enviar');
  boton.disabled = true;
  AY_HISTORIAL.push({ role: 'user', content: texto });
  input.value = '';
  ayPintar();
  try {
    var res = await fetch('/admin/ia/ordenes', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: texto, historial: AY_HISTORIAL.slice(0, -1).slice(-10).map(function (m) { return { role: m.role, content: m.content }; }) }) });
    var d = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(d.error || ('Error ' + res.status));
    var extra = (d.hechas || []).map(function (h) { return (h.ok ? '✅ ' : '⚠ ') + h.resumen; }).concat((d.pendientes || []).map(function (p) { return '⏸ Pendiente de confirmar (ábrelo en el botón IA de arriba): ' + p.descripcion; }));
    AY_HISTORIAL.push({ role: 'assistant', content: (d.texto || '(sin respuesta)') + (extra.length ? '\n' + extra.join('\n') : '') });
    if ((d.hechas || []).some(function (h) { return h.ok && h.tipo === 'cambio'; })) document.dispatchEvent(new CustomEvent('ia:cambio'));
  } catch (e) {
    AY_HISTORIAL.push({ role: 'assistant', content: '⚠ ' + e.message });
    if (/Puter|conecta/i.test(e.message)) document.getElementById('ay-nota').innerHTML = 'El ayudante usa la misma IA que el asistente: conéctala en <a href="/panel#ia">Mi asistente IA</a>.';
  }
  boton.disabled = false;
  ayPintar();
}
document.getElementById('ay-enviar').onclick = ayPreguntar;
document.getElementById('ay-texto').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); ayPreguntar(); } };
document.getElementById('ay-limpiar').onclick = function () { AY_HISTORIAL = []; ayPintar(); };
`;

  return appShell({
    titulo: 'Manual de uso',
    subtitulo: 'Qué hace cada módulo y cómo se usa',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '📘',
  });
}

export function soportePage(opts: { nombreNegocio: string; demo?: boolean; version: string }): string {
  const contenido = `
<div class="wrap">
<section class="card">
  <h2>Diagnóstico en vivo</h2>
  <p class="muted">Lo que el propio sistema dice de sí mismo ahora mismo. Si algo sale en rojo, empieza por ahí.</p>
  <div class="diag" id="diag"><div><span>Cargando…</span><b>…</b></div></div>
  <div style="margin-top:12px"><button id="diag-refrescar">Actualizar</button> <span id="diag-hora" class="muted"></span></div>
</section>

<section class="card">
  <h2>Si algo falla</h2>
  <h3>No sale ningún mensaje</h3>
  <ul>
    <li>Mira <a href="/panel#estado">Estado</a>: ¿el número está conectado y los envíos no están pausados a mano?</li>
    <li>Mira <a href="/panel#salud">Riesgo y ritmo</a>: en rojo el monitor pausa todo, y dice por qué.</li>
    <li>¿Es horario de envío? Fuera del horario configurado nada sale; se queda esperando a mañana.</li>
    <li>¿El contacto tiene consentimiento y no se dio de baja? Sin opt-in, un mensaje iniciado por la empresa no sale nunca.</li>
  </ul>
  <h3>El cliente escribió y nadie ve el mensaje</h3>
  <ul>
    <li>El globo de <a href="/chat">Chats</a> cuenta lo no leído. Si el mensaje no aparece, revisa la conexión en <a href="/setup">Conexión</a>: un WhatsApp Web desvinculado deja de recibir.</li>
  </ul>
  <h3>No le escribe a alguien de la lista de envío automático</h3>
  <ul>
    <li>En <a href="/envio-automatico">Envío automático</a> mira la columna <b>Situación</b>: dice si espera turno, si le tocan sus horas, si está en pausa, si una persona atiende ese chat o si ya agotó los mensajes.</li>
    <li>Fuera del horario (arriba a la derecha de esa pantalla) no sale nada; sigue solo a la hora de inicio.</li>
    <li>Si el número está en rojo o pausado (<a href="/panel#estado">Estado</a>), la lista espera igual que el reparto.</li>
  </ul>
  <h3>El reparto no avanza</h3>
  <ul>
    <li>En <a href="/rutas">Ubicaciones para reparto</a> el lote tiene que estar <b>en marcha</b> y dentro del horario de los <a href="/rutas#ajustes">Ajustes</a>.</li>
    <li>Las solicitudes en supervisión o derivadas esperan a una persona: no avanzan solas, por diseño.</li>
  </ul>
  <h3>No puedo entrar</h3>
  <ul>
    <li>Cinco fallos seguidos bloquean cinco minutos. Si olvidaste la contraseña, un administrador te pone una nueva en <a href="/panel#usuarios">Usuarios</a>.</li>
    <li>Si no queda ningún administrador que pueda entrar, hay que hacerlo desde el servidor (ver README, "Entrar: usuarios y sesiones").</li>
  </ul>
</section>

<section class="card">
  <h2>Qué mandar al reportar un problema</h2>
  <p class="muted">Con esto se puede reproducir casi todo. Sin esto, casi nada.</p>
  <ul>
    <li>La <b>hora exacta</b> y el <b>número del cliente</b> (si aplica).</li>
    <li>Qué pantalla y qué botón: una captura ayuda.</li>
    <li>Lo que dice el diagnóstico de arriba (cópialo con el botón).</li>
    <li>Las últimas líneas del registro del servidor (<code>quick.log</code> o la consola donde corre).</li>
  </ul>
  <pre id="diag-texto">…</pre>
  <div style="margin-top:8px"><button id="diag-copiar">Copiar el diagnóstico</button></div>
</section>
</div>`;

  const script = String.raw`
var VERSION = ${JSON.stringify(opts.version)};
function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function caja(etiqueta, valor, clase) { return '<div><span>' + esc(etiqueta) + '</span><b class="' + (clase || '') + '">' + esc(valor) + '</b></div>'; }
var ultimo = null;
async function diag() {
  var out = '', datos = { version: VERSION, hora: new Date().toISOString(), pagina: location.href };
  try {
    var r = await fetch('/admin/health', { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) { irAlLogin(); return; }
    var h = await r.json();
    datos.salud = h;
    var n = h.number || {};
    out += caja('Servidor', 'responde', 'ok');
    out += caja('Número', h.configured ? 'configurado' : 'sin configurar', h.configured ? 'ok' : 'bad');
    out += caja('Envíos', n.paused ? 'pausados' : 'activos', n.paused ? 'bad' : 'ok');
    out += caja('Calidad (Meta)', n.quality || '-', n.quality === 'GREEN' ? 'ok' : n.quality === 'YELLOW' ? 'warn' : n.quality ? 'bad' : '');
    out += caja('Riesgo', h.salud ? h.salud.nivel : '-', h.salud && h.salud.nivel === 'verde' ? 'ok' : h.salud && h.salud.nivel === 'amarillo' ? 'warn' : h.salud ? 'bad' : '');
    out += caja('Enviados hoy', (h.sentToday || 0) + ' / ' + (h.dailyCap || 0), '');
    var cola = h.queue || {};
    out += caja('Cola', (cola.waiting || 0) + ' esperando · ' + (cola.failed || 0) + ' fallidos', cola.failed ? 'warn' : '');
    if (h.missing && h.missing.length) out += caja('Falta', h.missing.join(', '), 'warn');
  } catch (e) {
    out += caja('Servidor', 'no responde: ' + e.message, 'bad');
    datos.error = String(e && e.message);
  }
  out += caja('Versión', VERSION, '');
  document.getElementById('diag').innerHTML = out;
  document.getElementById('diag-hora').textContent = 'a las ' + new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
  ultimo = datos;
  document.getElementById('diag-texto').textContent = JSON.stringify(datos, null, 2);
}
document.getElementById('diag-refrescar').onclick = diag;
document.getElementById('diag-copiar').onclick = function () {
  navigator.clipboard.writeText(document.getElementById('diag-texto').textContent).then(function () {
    document.getElementById('diag-copiar').textContent = 'Copiado';
    setTimeout(function () { document.getElementById('diag-copiar').textContent = 'Copiar el diagnóstico'; }, 1500);
  });
};
diag();
`;

  return appShell({
    titulo: 'Soporte',
    subtitulo: 'Si algo falla: qué mirar y qué datos mandar',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🛟',
  });
}
