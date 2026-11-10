/**
 * Las paginas publicas que Meta pide para aprobar una app de WhatsApp:
 *
 *   /privacidad              Politica de privacidad (Privacy Policy URL)
 *   /terminos                Terminos y condiciones (Terms of Service URL)
 *   /eliminacion-de-datos    Como pedir que se borren tus datos (User data deletion → Data deletion instructions URL)
 *   /legal                   Las tres juntas, con lo que va en cada casilla de Meta
 *
 * Son de la PLATAFORMA (no de una tienda): se ven sin entrar, desde cualquier
 * navegador, y el robot de revision de Meta las tiene que poder abrir.
 *
 * Lo que dicen sale de lo que el sistema hace de verdad (cuanto vive un
 * mensaje en el chat, que se comparte con quien, que proveedores intervienen).
 * Los datos del responsable (razon social, RUC, direccion, correo) vienen del
 * entorno: LEGAL_RAZON_SOCIAL, LEGAL_RUC, LEGAL_DIRECCION, LEGAL_CORREO,
 * LEGAL_TELEFONO y LEGAL_NOMBRE_COMERCIAL. Lo que falte no se inventa: la
 * frase que lo usaria simplemente no aparece.
 *
 * Marco legal: Peru, Ley 29733 de Proteccion de Datos Personales y su
 * Reglamento (D.S. 016-2024-JUS); la autoridad es la ANPD del MINJUSDH.
 */

import { NOMBRE_SISTEMA } from '../marca.js';
import { RETENCION_CHAT_MS } from '../whatsapp/retencion-chat.js';
import { ICONOS_HEAD, RUTA_LOGO } from './marca-routes.js';

export interface DatosLegales {
  nombreComercial: string;
  razonSocial: string;
  ruc: string;
  direccion: string;
  correo: string;
  telefono: string;
  /** Fecha de la ultima actualizacion de los textos (dd/mm/aaaa). */
  actualizado: string;
}

/** Cuando cambie el texto de estas paginas, se cambia esta fecha. */
export const ULTIMA_ACTUALIZACION = '09/11/2026';

export function datosLegalesDelEntorno(env: NodeJS.ProcessEnv = process.env): DatosLegales {
  const v = (k: string) => (env[k] ?? '').trim();
  return {
    nombreComercial: v('LEGAL_NOMBRE_COMERCIAL') || NOMBRE_SISTEMA,
    razonSocial: v('LEGAL_RAZON_SOCIAL'),
    ruc: v('LEGAL_RUC').replace(/\D+/g, ''),
    direccion: v('LEGAL_DIRECCION'),
    correo: v('LEGAL_CORREO'),
    telefono: v('LEGAL_TELEFONO').replace(/[^\d+ ]+/g, ''),
    actualizado: ULTIMA_ACTUALIZACION,
  };
}

/** Lo que aun falta para que Meta acepte las paginas (vacio = completas). */
export function faltanDatosLegales(d: DatosLegales): string[] {
  return [
    !d.razonSocial && 'la razón social',
    !d.ruc && 'el RUC',
    !d.direccion && 'la dirección',
    !d.correo && 'el correo de contacto',
  ].filter((x): x is string => Boolean(x));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const horasDelChat = Math.round(RETENCION_CHAT_MS / 3_600_000);

/** «Razón Social S.A.C. (RUC 20…), con domicilio en …» o lo que haya. */
function quienSomos(d: DatosLegales): string {
  const partes = [`<b>${esc(d.razonSocial || d.nombreComercial)}</b>`];
  if (d.razonSocial && d.nombreComercial && d.nombreComercial !== d.razonSocial) partes.push(`(nombre comercial: ${esc(d.nombreComercial)})`);
  if (d.ruc) partes.push(`con RUC ${esc(d.ruc)}`);
  if (d.direccion) partes.push(`y domicilio en ${esc(d.direccion)}`);
  return partes.join(' ');
}

/** Como contactarnos, con los canales que existan. */
function contacto(d: DatosLegales): string {
  const canales: string[] = [];
  if (d.correo) canales.push(`al correo <a href="mailto:${esc(d.correo)}">${esc(d.correo)}</a>`);
  if (d.telefono) canales.push(`por WhatsApp o llamada al ${esc(d.telefono)}`);
  return canales.length ? canales.join(' o ') : 'por el mismo chat de WhatsApp por el que te escribimos';
}

function pagina(titulo: string, d: DatosLegales, cuerpo: string, actual: string): string {
  const enlace = (href: string, texto: string) => `<a href="${href}"${href === actual ? ' aria-current="page"' : ''}>${texto}</a>`;
  return `<!doctype html>
<html lang="es-PE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${ICONOS_HEAD}
<title>${esc(titulo)} · ${esc(d.nombreComercial)}</title>
<meta name="description" content="${esc(titulo)} de ${esc(d.nombreComercial)}">
<style>
  :root { --fondo: #f6f7f9; --papel: #fff; --texto: #1d2433; --suave: #5b6476; --borde: #dfe3ea; --primario: #0f7a5a; }
  @media (prefers-color-scheme: dark) { :root { --fondo: #12161d; --papel: #1a2029; --texto: #e7eaf0; --suave: #a3abba; --borde: #2c3442; --primario: #4fd1a1; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--fondo); color: var(--texto); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header, main, footer { max-width: 820px; margin: 0 auto; padding: 0 16px; }
  header { padding-top: 24px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; justify-content: space-between; }
  header .marca { display: inline-flex; align-items: center; gap: 10px; font-weight: 700; font-size: 18px; color: var(--texto); text-decoration: none; }
  header .marca img { width: 30px; height: 30px; }
  nav { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 14px; }
  nav a { color: var(--suave); }
  nav a[aria-current] { color: var(--primario); font-weight: 600; }
  main { background: var(--papel); border: 1px solid var(--borde); border-radius: 12px; padding: 24px 20px; margin-top: 16px; }
  h1 { font-size: 26px; line-height: 1.25; margin: 0 0 4px; }
  h2 { font-size: 19px; margin: 28px 0 6px; }
  .fecha { color: var(--suave); font-size: 14px; margin: 0 0 16px; }
  a { color: var(--primario); overflow-wrap: anywhere; }
  ul { padding-left: 22px; }
  li { margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  td, th { text-align: left; vertical-align: top; padding: 8px; border-bottom: 1px solid var(--borde); }
  th { width: 38%; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 14px; overflow-wrap: anywhere; }
  footer { color: var(--suave); font-size: 13px; padding-top: 16px; padding-bottom: 32px; }
</style>
</head>
<body>
<header>
  <a class="marca" href="/legal"><img src="${RUTA_LOGO}" alt="" width="30" height="30">${esc(d.nombreComercial)}</a>
  <nav aria-label="Páginas legales">
    ${enlace('/privacidad', 'Privacidad')}
    ${enlace('/terminos', 'Términos y condiciones')}
    ${enlace('/eliminacion-de-datos', 'Eliminar mis datos')}
  </nav>
</header>
<main>
${cuerpo}
</main>
<footer>${quienSomos(d)}. Escríbenos ${contacto(d)}.</footer>
</body>
</html>`;
}

export function privacidadPage(d: DatosLegales): string {
  return pagina('Política de privacidad', d, `
<h1>Política de privacidad</h1>
<p class="fecha">Última actualización: ${esc(d.actualizado)}</p>

<p>Esta política explica qué datos personales tratamos cuando te escribimos o nos escribes por WhatsApp a través de ${esc(d.nombreComercial)}, para qué los usamos, con quién los compartimos y cómo puedes ejercer tus derechos. Cumple la Ley N.º 29733, Ley de Protección de Datos Personales del Perú, y su Reglamento.</p>

<h2>1. Quién es el responsable</h2>
<p>El responsable del tratamiento es ${quienSomos(d)}. Para cualquier consulta sobre tus datos, escríbenos ${contacto(d)}.</p>
<p>${esc(d.nombreComercial)} es un sistema de atención por WhatsApp que usan empresas de venta y reparto (por ejemplo, para coordinar la entrega de un pedido). Cuando una empresa te atiende con ${esc(d.nombreComercial)}, esa empresa decide para qué te escribe y nosotros tratamos tus datos por su encargo y según esta política.</p>

<h2>2. Qué datos tratamos</h2>
<ul>
  <li><b>Tu número de WhatsApp y tu nombre de perfil</b>, tal como los muestra WhatsApp.</li>
  <li><b>Los mensajes que intercambiamos</b>: textos, notas de voz, fotos, videos, documentos y stickers.</li>
  <li><b>La ubicación que compartes</b> (el pin de WhatsApp o un enlace de mapa) para entregarte tu pedido.</li>
  <li><b>Los datos del pedido</b> que nos pasa la empresa que te vendió o que te lo lleva: número de pedido, dirección, distrito, referencia, producto y horario de entrega.</li>
  <li><b>Datos técnicos</b> del envío de cada mensaje (fecha, hora, si se entregó o se leyó).</li>
  <li>De las personas que usan el panel (el equipo de la empresa): nombre, usuario, contraseña cifrada y un registro de las acciones que hacen.</li>
</ul>
<p>No pedimos datos sensibles (salud, religión, opiniones políticas, datos de tarjetas). Te pedimos que no los envíes por el chat.</p>

<h2>3. Para qué los usamos</h2>
<ul>
  <li>Coordinar la entrega de tu pedido: pedirte y confirmar tu ubicación, avisarte la hora de llegada y avisarte cuando se entregó.</li>
  <li>Responder tus consultas sobre tu pedido.</li>
  <li>Avisos del servicio que tú esperas recibir (por ejemplo, un cambio en tu entrega).</li>
  <li>Mantener la seguridad del servicio, evitar abusos y cumplir obligaciones legales.</li>
</ul>
<p><b>No usamos tus datos para publicidad</b> sin tu consentimiento expreso, <b>no los vendemos</b> y no los usamos para tomar decisiones que te afecten de forma automática sin intervención de una persona.</p>

<h2>4. Base legal</h2>
<p>Tratamos tus datos porque son necesarios para entregarte el pedido que compraste (la relación que tienes con la empresa que te atiende) y, cuando corresponde, por tu consentimiento: al escribirnos o al aceptar recibir mensajes por WhatsApp. Puedes retirar tu consentimiento cuando quieras (ver punto 8).</p>

<h2>5. Con quién los compartimos</h2>
<ul>
  <li><b>La empresa que te atiende</b> (la tienda o la empresa de reparto, por ejemplo GSG): recibe tu ubicación y el estado de tu entrega.</li>
  <li><b>El motorizado o repartidor</b> asignado: recibe tu nombre, tu dirección, tu ubicación y tu número, solo para llevarte el pedido.</li>
  <li><b>Meta Platforms (WhatsApp)</b>: es el canal por el que viajan los mensajes. Meta trata esos datos según sus propias políticas: <a href="https://www.whatsapp.com/legal/privacy-policy" rel="noopener">política de privacidad de WhatsApp</a>.</li>
  <li><b>Proveedores de inteligencia artificial</b>, solo si la empresa activa el asistente automático: el texto de tu mensaje se envía al proveedor elegido para redactar la respuesta. No se usa para entrenar modelos de terceros con tus datos cuando el proveedor lo permite configurar así.</li>
  <li><b>Proveedor de voz</b> (ElevenLabs), solo si la empresa activa las respuestas por audio o la transcripción de notas de voz.</li>
  <li><b>Proveedores de servidores</b> donde se aloja el sistema, obligados a guardar confidencialidad.</li>
  <li><b>Autoridades</b>, cuando una ley o una orden judicial lo exijan.</li>
</ul>

<h2>6. Transferencias fuera del Perú</h2>
<p>Algunos de estos proveedores (Meta, proveedores de inteligencia artificial y de voz) procesan datos fuera del Perú, principalmente en Estados Unidos. Solo trabajamos con proveedores que ofrecen niveles adecuados de protección, conforme a la Ley N.º 29733.</p>

<h2>7. Cuánto tiempo los guardamos</h2>
<ul>
  <li><b>Mensajes del chat</b>: se borran del chat a las ${horasDelChat} horas.</li>
  <li><b>Conversaciones guardadas</b> por el equipo (por ejemplo, ante un reclamo): hasta que dejen de ser necesarias; al borrarlas pasan 30 días en una papelera y después se eliminan.</li>
  <li><b>Datos del pedido y ubicación</b>: mientras dure la entrega y el plazo necesario para atender reclamos y cumplir obligaciones legales y tributarias.</li>
  <li><b>Registros técnicos</b> de envío: el tiempo necesario para la seguridad y el buen funcionamiento del servicio.</li>
</ul>

<h2>8. Tus derechos</h2>
<p>Puedes ejercer en cualquier momento tus derechos de <b>acceso, rectificación, cancelación (eliminación) y oposición</b>, así como <b>revocar tu consentimiento</b>. Escríbenos ${contacto(d)} indicando tu número de WhatsApp y lo que pides. Te responderemos dentro de los plazos de la ley.</p>
<p>Si no quieres recibir más mensajes, responde <b>BAJA</b> en el chat o pídelo con tus palabras: una persona del equipo te quitará de la lista y no te volveremos a escribir. También puedes bloquear el número desde WhatsApp.</p>
<p>Para borrar tus datos, sigue los pasos de <a href="/eliminacion-de-datos">Eliminar mis datos</a>.</p>
<p>Si consideras que no atendimos tu pedido, puedes reclamar ante la Autoridad Nacional de Protección de Datos Personales del Ministerio de Justicia y Derechos Humanos.</p>

<h2>9. Cómo protegemos tus datos</h2>
<ul>
  <li>Las credenciales y claves del sistema se guardan cifradas.</li>
  <li>Al panel solo entra el equipo autorizado, con usuario y contraseña, y cada persona ve lo que su rol le permite.</li>
  <li>Las acciones importantes quedan registradas.</li>
  <li>La conexión con el sistema va cifrada (HTTPS).</li>
</ul>

<h2>10. Menores de edad</h2>
<p>El servicio no está dirigido a menores de 14 años. Si eres padre, madre o tutor y crees que un menor nos dio datos, escríbenos y los eliminaremos.</p>

<h2>11. Cambios a esta política</h2>
<p>Si cambiamos esta política, publicaremos la nueva versión en esta misma página con su fecha de actualización.</p>
`, '/privacidad');
}

export function terminosPage(d: DatosLegales): string {
  return pagina('Términos y condiciones', d, `
<h1>Términos y condiciones</h1>
<p class="fecha">Última actualización: ${esc(d.actualizado)}</p>

<p>Estos términos regulan el uso de ${esc(d.nombreComercial)}, ofrecido por ${quienSomos(d)}. Al usar el sistema (como empresa que atiende a sus clientes o como persona que recibe mensajes) aceptas estos términos.</p>

<h2>1. Qué es el servicio</h2>
<p>${esc(d.nombreComercial)} es un sistema para que empresas de venta y reparto atiendan a sus clientes por WhatsApp: pedir y confirmar la ubicación de entrega, avisar el estado del pedido, coordinar a los repartidores y responder consultas, con ayuda opcional de un asistente automático.</p>

<h2>2. Para las personas que reciben mensajes</h2>
<ul>
  <li>Te escribimos por encargo de la empresa a la que le compraste, sobre tu pedido.</li>
  <li>Puedes dejar de recibir mensajes cuando quieras respondiendo <b>BAJA</b> o pidiéndolo en el chat.</li>
  <li>Algunas respuestas pueden ser automáticas. Siempre puedes pedir hablar con una persona.</li>
  <li>Tus datos se tratan como explica la <a href="/privacidad">Política de privacidad</a>.</li>
</ul>

<h2>3. Para las empresas que usan el sistema</h2>
<ul>
  <li>Eres responsable de tener el consentimiento de tus clientes para escribirles por WhatsApp y de que la información que cargas (pedidos, teléfonos, direcciones) sea correcta y lícita.</li>
  <li>Debes cumplir las <a href="https://www.whatsapp.com/legal/business-policy" rel="noopener">Políticas de WhatsApp Business</a>, las <a href="https://www.whatsapp.com/legal/business-terms" rel="noopener">Condiciones de WhatsApp Business</a> y la Ley N.º 29733.</li>
  <li>No puedes usar el sistema para enviar spam, publicidad no solicitada, contenido ilegal, engañoso, ofensivo o que infrinja derechos de terceros, ni para suplantar a otras personas o empresas.</li>
  <li>Cuidas tus usuarios y contraseñas y respondes por lo que se haga con ellos.</li>
  <li>Si usas una línea vinculada con QR (WhatsApp normal), sabes que no es una vía oficial de Meta y que WhatsApp puede restringir o bloquear ese número. Con la API oficial de WhatsApp Business, los cargos por conversación los cobra Meta directamente a tu cuenta.</li>
</ul>

<h2>4. Disponibilidad</h2>
<p>Hacemos lo razonable para que el servicio funcione sin interrupciones, pero depende de terceros (WhatsApp, Meta, proveedores de internet, de inteligencia artificial y de servidores). No garantizamos que funcione sin cortes ni que cada mensaje llegue, por ejemplo si WhatsApp lo rechaza o el número del cliente no existe.</p>

<h2>5. Responsabilidad</h2>
<p>El sistema es una herramienta: las decisiones sobre los pedidos, las entregas y lo que se le dice a cada cliente son de la empresa que lo usa. En la medida que la ley lo permita, no respondemos por daños indirectos, lucro cesante ni por fallas de servicios de terceros.</p>

<h2>6. Suspensión</h2>
<p>Podemos suspender una cuenta que incumpla estos términos o las políticas de WhatsApp, o que ponga en riesgo el servicio o a terceros.</p>

<h2>7. Propiedad intelectual</h2>
<p>El sistema, su diseño y su código son de su titular. La empresa conserva la propiedad de sus datos y de los de sus clientes.</p>

<h2>8. Cambios</h2>
<p>Podemos actualizar estos términos. La versión vigente es la publicada en esta página, con su fecha.</p>

<h2>9. Ley y jurisdicción</h2>
<p>Estos términos se rigen por las leyes de la República del Perú. Cualquier controversia se someterá a los jueces y tribunales de Lima, salvo que la ley de protección al consumidor disponga otra cosa.</p>

<h2>10. Contacto</h2>
<p>Escríbenos ${contacto(d)}.</p>
`, '/terminos');
}

export function eliminacionPage(d: DatosLegales): string {
  return pagina('Eliminar mis datos', d, `
<h1>Cómo pedir que se eliminen tus datos</h1>
<p class="fecha">Última actualización: ${esc(d.actualizado)}</p>

<p>Puedes pedir en cualquier momento que borremos los datos que tenemos de ti (tu número, tus mensajes, tus ubicaciones y los datos de tus pedidos).</p>

<h2>La forma más rápida: por el mismo WhatsApp</h2>
<p>Escríbenos desde tu número, en el mismo chat, algo como <b>«Borren mis datos»</b>. Queda registrado al instante, el sistema deja de escribirte y una persona del equipo lo atiende. Como escribes desde tu propio número, no hace falta comprobar nada más.</p>

<h2>Por correo</h2>
<ol>
  <li>Escríbenos ${contacto(d)} con el asunto <b>«Eliminar mis datos»</b>.</li>
  <li>Indica el <b>número de WhatsApp</b> con el que hablaste con nosotros (con el código del país, por ejemplo +51 9xx xxx xxx).</li>
  <li>Para confirmar que el número es tuyo, te escribiremos a ese WhatsApp y te pediremos que respondas <b>SÍ</b>.</li>
</ol>

<h2>Qué borramos</h2>
<p>Tus mensajes, tus conversaciones guardadas, tus fotos y audios, tus ubicaciones, los datos de tus pedidos y tu ficha de contacto. Te avisamos cuando esté hecho. Solo guardamos una constancia de que lo pediste y de que se cumplió, sin tu número completo ni lo que escribiste.</p>
<p>Si más adelante haces un pedido nuevo con una tienda que trabaja con nosotros, empezamos de cero: solo usaremos los datos de ese pedido.</p>

<h2>Plazos y excepciones</h2>
<ul>
  <li>Atendemos el pedido dentro de los plazos de la Ley N.º 29733 y su Reglamento.</li>
  <li>Podemos conservar, bloqueados y solo el tiempo que la ley exija, los datos de un pedido necesarios para obligaciones tributarias o para atender un reclamo en curso.</li>
  <li>Lo que ya está en tu propio teléfono y en los servidores de WhatsApp lo administra WhatsApp; para eso, consulta la <a href="https://faq.whatsapp.com/" rel="noopener">ayuda de WhatsApp</a>.</li>
</ul>

<h2>Si solo quieres que no te escribamos</h2>
<p>Responde <b>BAJA</b> en el chat o pídelo con tus palabras: dejamos de escribirte sin borrar el historial de tu pedido.</p>
`, '/eliminacion-de-datos');
}

/** El indice: las tres paginas y lo que va en cada casilla de la app de Meta. */
export function legalIndicePage(d: DatosLegales, base: string): string {
  const url = (ruta: string) => `${base.replace(/\/+$/, '')}${ruta}`;
  return pagina('Información legal', d, `
<h1>Información legal</h1>
<p class="fecha">Última actualización: ${esc(d.actualizado)}</p>
<ul>
  <li><a href="/privacidad">Política de privacidad</a></li>
  <li><a href="/terminos">Términos y condiciones</a></li>
  <li><a href="/eliminacion-de-datos">Cómo pedir que se eliminen tus datos</a></li>
</ul>

<h2>Para la configuración de la app en Meta</h2>
<p>En <b>developers.facebook.com</b> → tu app → <b>Configuración de la app → Básica</b>, pega estas direcciones:</p>
<table>
  <tr><th>URL de la política de privacidad</th><td><code>${esc(url('/privacidad'))}</code></td></tr>
  <tr><th>URL de las condiciones del servicio</th><td><code>${esc(url('/terminos'))}</code></td></tr>
  <tr><th>Eliminación de datos de usuario → URL de instrucciones</th><td><code>${esc(url('/eliminacion-de-datos'))}</code></td></tr>
  <tr><th>Correo de contacto</th><td>${d.correo ? esc(d.correo) : '—'}</td></tr>
  <tr><th>Categoría</th><td>Empresa y páginas (Business and pages)</td></tr>
</table>
`, '/legal');
}
