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
export const ULTIMA_ACTUALIZACION = '10/11/2026';

/**
 * Los datos publicos de GSG, tal como los publica GSG en
 * business.gsgcorp.pe (terminos v2 vigentes desde 06/10/2026 y politica de
 * privacidad, seccion 6). Sirven si el entorno no trae LEGAL_*; lo que venga
 * del entorno manda.
 */
export const DATOS_LEGALES_GSG: Readonly<Record<string, string>> = {
  LEGAL_RAZON_SOCIAL: 'GESTIÓN DE SERVICIOS GENERALES M & A S.A.C.',
  LEGAL_RUC: '20605545158',
  LEGAL_DIRECCION: 'Pj. J Mza. K Lote 4, A.H. Las Vegas, Los Olivos, Lima',
  LEGAL_CORREO: 'asuntos-legales@gsgcorppe.com',
  LEGAL_TELEFONO: '+51 926 260 767',
};

export function datosLegalesDelEntorno(
  env: NodeJS.ProcessEnv = process.env,
  porDefecto: Readonly<Record<string, string>> = DATOS_LEGALES_GSG,
): DatosLegales {
  const v = (k: string) => (env[k] ?? '').trim() || (porDefecto[k] ?? '').trim();
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

export function pagina(titulo: string, d: DatosLegales, cuerpo: string, actual: string, extraHead = ''): string {
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
  h3 { font-size: 16px; margin: 18px 0 4px; }
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
${extraHead}
</head>
<body>
<header>
  <a class="marca" href="/legal"><img src="${RUTA_LOGO}" alt="" width="30" height="30">${esc(d.nombreComercial)}</a>
  <nav aria-label="Páginas legales">
    ${enlace('/privacidad', 'Privacidad')}
    ${enlace('/terminos', 'Términos y condiciones')}
    ${enlace('/eliminacion-de-datos', 'Eliminar mis datos')}
    ${enlace('/libro-de-reclamaciones', 'Libro de Reclamaciones')}
  </nav>
</header>
<main>
${cuerpo}
</main>
<footer>${quienSomos(d)}. Escríbenos ${contacto(d)}.</footer>
</body>
</html>`;
}

/** Los datos del titular, uno por línea, solo los que existen. */
function fichaTitular(d: DatosLegales): string {
  const filas = [
    ['Razón social', d.razonSocial || d.nombreComercial],
    ['Nombre comercial', d.razonSocial && d.nombreComercial !== d.razonSocial ? d.nombreComercial : ''],
    ['RUC', d.ruc],
    ['Domicilio', d.direccion],
    ['Correo', d.correo ? `<a href="mailto:${esc(d.correo)}">${esc(d.correo)}</a>` : ''],
    ['WhatsApp / teléfono', d.telefono ? esc(d.telefono) : ''],
  ].filter(([, v]) => v);
  return `<table>${filas.map(([k, v]) => `<tr><th>${k}</th><td>${k === 'Correo' || k === 'WhatsApp / teléfono' ? v : esc(v!)}</td></tr>`).join('')}</table>`;
}

export function privacidadPage(d: DatosLegales): string {
  return pagina('Política de privacidad', d, `
<h1>Política de privacidad</h1>
<p class="fecha">Fecha de última actualización: ${esc(d.actualizado)}</p>

<h2>1. Información general</h2>
<p>${esc(d.nombreComercial)} (en adelante, «la Plataforma», «nosotros») es un servicio en la nube para que empresas de venta y reparto atiendan a sus clientes por WhatsApp —con WhatsApp vinculado por QR o con WhatsApp Business API de Meta— y, si la empresa lo activa, con ayuda de inteligencia artificial: pedir y confirmar la ubicación de entrega, avisar el estado del pedido y responder consultas.</p>
<p>Esta política explica qué datos personales tratamos, para qué, con quién los compartimos y cómo puedes ejercer tus derechos. Cumple la Ley N.º 29733, Ley de Protección de Datos Personales del Perú, y su Reglamento.</p>
<p><b>Titular del banco de datos personales y proveedor del servicio:</b> ${quienSomos(d)}.</p>
${fichaTitular(d)}

<h2>2. Datos personales que tratamos</h2>
<h3>2.1 Datos de las empresas y su equipo (usuarios de la Plataforma)</h3>
<ul>
  <li>Datos de registro: nombre, usuario, correo o teléfono de contacto.</li>
  <li>Datos de la empresa: nombre comercial, razón social, RUC y dirección.</li>
  <li>Contraseñas (guardadas cifradas, nunca en texto) y el rol de cada persona.</li>
  <li>Credenciales de conexión que la empresa entrega (token de WhatsApp Business API, clave secreta de la app de Meta, claves de API de proveedores de IA), guardadas cifradas.</li>
  <li>Registro de las acciones hechas en el panel.</li>
</ul>
<h3>2.2 Datos de los clientes finales (las personas que reciben y envían mensajes)</h3>
<p>Estos datos los aporta la empresa que te vendió o que te lleva el pedido, que actúa como responsable de su tratamiento.</p>
<ul>
  <li><b>Tu número de WhatsApp y tu nombre de perfil</b>, tal como los muestra WhatsApp.</li>
  <li><b>Los mensajes que intercambiamos</b>: textos, notas de voz, fotos, videos, documentos y stickers.</li>
  <li><b>La ubicación que compartes</b> (el pin de WhatsApp o un enlace de mapa) para entregarte tu pedido.</li>
  <li><b>Los datos del pedido</b>: código o tracking, producto, empresa, dirección, distrito, referencia, método de pago, monto a cobrar y horario de entrega.</li>
  <li><b>Metadatos</b> de cada mensaje: fecha, hora y estado (enviado, entregado, leído).</li>
</ul>
<p><b>Advertencia:</b> no pedimos datos sensibles (salud, religión, opiniones políticas, datos de tarjetas). Te pedimos que no los envíes por el chat. Si un mensaje los trae, solo se usan para atender tu pedido.</p>
<h3>2.3 Datos técnicos</h3>
<ul>
  <li>Dirección IP, navegador y sistema operativo de quien entra al panel o a estas páginas.</li>
  <li>Cookies necesarias para la sesión (ver punto 9).</li>
  <li>Registros de seguridad y de funcionamiento del servicio.</li>
</ul>

<h2>3. Finalidades y bases legales del tratamiento</h2>
<p>Tratamos los datos conforme a los principios y condiciones de la Ley N.º 29733.</p>
<h3>3.1 Consentimiento</h3>
<p>Cuando nos escribes o aceptas recibir mensajes por WhatsApp sobre tu pedido, y cuando la empresa crea su cuenta, se otorga el consentimiento para: gestionar la cuenta, enviar y recibir mensajes por WhatsApp, analizar las conversaciones con inteligencia artificial (si la empresa lo activa) y guardar el historial necesario para atender el pedido. Puedes retirarlo cuando quieras (punto 7).</p>
<h3>3.2 Ejecución de la relación contractual</h3>
<ul>
  <li>Coordinar la entrega de tu pedido: pedirte y confirmar tu ubicación, avisarte la hora de llegada y que se entregó.</li>
  <li>Prestar el servicio a la empresa y darle soporte técnico.</li>
  <li>Facturación y avisos operativos del servicio.</li>
</ul>
<h3>3.3 Interés legítimo</h3>
<ul>
  <li>Seguridad y continuidad de la Plataforma.</li>
  <li>Prevención de fraude, spam y usos indebidos (por ejemplo, cuidar que un número de WhatsApp no sea bloqueado).</li>
  <li>Mejorar el funcionamiento del sistema.</li>
</ul>
<p><b>No usamos tus datos para publicidad</b> sin tu consentimiento expreso, <b>no los vendemos</b> y no tomamos decisiones que te afecten de forma automática sin que una persona pueda intervenir.</p>

<h2>4. Tratamiento de datos de terceros (clientes finales)</h2>
<h3>4.1 La empresa usuaria: responsable del tratamiento</h3>
<p>La empresa que usa ${esc(d.nombreComercial)} para escribir a sus clientes es responsable de esos datos y se compromete a:</p>
<ul>
  <li>Tener el consentimiento válido de sus clientes para escribirles por WhatsApp.</li>
  <li>Informarles para qué usa sus datos.</li>
  <li>Cumplir la Ley N.º 29733, su Reglamento y las políticas de WhatsApp.</li>
  <li>No usar los datos para fines distintos de los informados.</li>
</ul>
<p>${esc(d.nombreComercial)} no responde por incumplimientos de la empresa usuaria al obtener esos consentimientos o al informar a sus clientes.</p>
<h3>4.2 Nuestro rol: encargado del tratamiento</h3>
<p>Respecto de los datos de los clientes finales, actuamos por encargo de la empresa usuaria y nos comprometemos a:</p>
<ul>
  <li>Tratarlos solo según sus instrucciones y para prestar el servicio.</li>
  <li>Aplicar medidas técnicas y organizativas adecuadas.</li>
  <li>No usarlos para fines propios.</li>
  <li>Avisar a la empresa de incidentes de seguridad relevantes.</li>
</ul>

<h2>5. Con quién compartimos los datos y transferencias</h2>
<h3>5.1 Destinatarios y proveedores necesarios</h3>
<table>
  <tr><th>Destinatario</th><td><b>País · para qué</b></td></tr>
  <tr><th>La empresa que te atiende (por ejemplo, GSG)</th><td>Perú · recibe tu ubicación y el estado de tu entrega.</td></tr>
  <tr><th>El motorizado o repartidor asignado</th><td>Perú · recibe tu nombre, dirección, ubicación y número, solo para llevarte el pedido.</td></tr>
  <tr><th>Meta Platforms (WhatsApp)</th><td>EE.UU. · el canal por el que viajan los mensajes (WhatsApp Business Platform). Meta trata esos datos según su <a href="https://www.whatsapp.com/legal/privacy-policy" rel="noopener">política de privacidad</a>.</td></tr>
  <tr><th>Proveedores de inteligencia artificial</th><td>EE.UU. · solo si la empresa activa el asistente: el texto del mensaje se envía al proveedor elegido para leerlo o redactar la respuesta.</td></tr>
  <tr><th>Proveedor de voz (ElevenLabs)</th><td>EE.UU. · solo si la empresa activa las respuestas por audio o la transcripción de notas de voz.</td></tr>
  <tr><th>Proveedores de servidores</th><td>Donde se aloja el sistema · obligados a guardar confidencialidad.</td></tr>
  <tr><th>Autoridades</th><td>Cuando una ley o una orden judicial lo exijan.</td></tr>
</table>
<h3>5.2 Transferencias internacionales</h3>
<p>Algunos proveedores están en países que pueden no tener un nivel de protección equivalente al peruano (por ejemplo, Estados Unidos). Esas transferencias se hacen con las garantías que exigen la Ley N.º 29733 y su Reglamento: contratos de encargo y cláusulas de protección de datos.</p>
<h3>5.3 No compartimos tus datos para</h3>
<ul>
  <li>Venderlos, alquilarlos o cederlos comercialmente.</li>
  <li>Publicidad de terceros.</li>
  <li>Cualquier fin que no esté descrito en esta política.</li>
</ul>

<h2>6. Medidas de seguridad</h2>
<ul>
  <li>Conexión cifrada (HTTPS) entre tu navegador o WhatsApp y el sistema.</li>
  <li>Contraseñas, tokens y claves guardados cifrados.</li>
  <li>Acceso al panel solo para el equipo autorizado, con usuario y contraseña, y cada persona ve lo que su rol le permite.</li>
  <li>Comprobación de la firma de Meta en cada aviso que llega de WhatsApp.</li>
  <li>Registro de las acciones importantes y copias de seguridad.</li>
</ul>

<h2>7. Tus derechos (ARCO)</h2>
<p>Como titular de tus datos puedes ejercer en cualquier momento tus derechos de:</p>
<ul>
  <li><b>Acceso</b>: saber qué datos tuyos tratamos.</li>
  <li><b>Rectificación</b>: corregir los que estén mal.</li>
  <li><b>Cancelación</b>: pedir que los eliminemos (<a href="/eliminacion-de-datos">cómo hacerlo</a>).</li>
  <li><b>Oposición</b>: oponerte a un uso que no sea necesario.</li>
</ul>
<h3>7.1 Copia de tus datos</h3>
<p>Puedes pedirnos una copia de tus datos en un formato ordenado.</p>
<h3>7.2 Revocar tu consentimiento</h3>
<p>Puedes retirarlo en cualquier momento. Si no quieres recibir más mensajes, responde <b>BAJA</b> en el chat o pídelo con tus palabras: una persona del equipo te quitará de la lista y no te volveremos a escribir. También puedes bloquear el número desde WhatsApp.</p>
<h3>7.3 Cómo ejercerlos</h3>
<p>Escríbenos ${contacto(d)}${d.direccion ? ` o envía una carta a ${esc(d.direccion)}` : ''}, indicando tu número de WhatsApp y lo que pides. Te responderemos en un plazo máximo de 10 días hábiles, o el que fije la ley para cada derecho.</p>

<h2>8. Plazos de conservación</h2>
<table>
  <tr><th>Mensajes del chat</th><td>Se borran del chat a las ${horasDelChat} horas.</td></tr>
  <tr><th>Conversaciones guardadas por el equipo (por ejemplo, ante un reclamo)</th><td>Hasta que dejen de ser necesarias; al borrarlas pasan 30 días en una papelera y después se eliminan.</td></tr>
  <tr><th>Datos del pedido y ubicación</th><td>Mientras dure la entrega y el plazo necesario para atender reclamos.</td></tr>
  <tr><th>Datos de la cuenta de la empresa y su equipo</th><td>Mientras la cuenta esté activa.</td></tr>
  <tr><th>Datos de facturación</th><td>El plazo que exijan las normas tributarias.</td></tr>
  <tr><th>Registros técnicos</th><td>El tiempo necesario para la seguridad y el buen funcionamiento del servicio.</td></tr>
</table>
<p>Pasados esos plazos, los datos se eliminan de forma segura o se anonimizan.</p>

<h2>9. Cookies</h2>
<p>Usamos solo las cookies necesarias para que funcionen la sesión del panel y tus preferencias (por ejemplo, el tema claro u oscuro). No usamos cookies de publicidad ni de analítica de terceros. Puedes borrarlas o bloquearlas desde tu navegador; sin ellas no podrás entrar al panel.</p>

<h2>10. Menores de edad</h2>
<p>El panel es para personas mayores de 18 años que actúan por una empresa. A los clientes finales no les pedimos la edad; si eres padre, madre o tutor y crees que un menor de 14 años nos dio sus datos sin tu consentimiento, escríbenos y los eliminaremos.</p>

<h2>11. Cambios a esta política</h2>
<p>Si cambiamos esta política, publicaremos la nueva versión en esta página con su fecha. Los cambios relevantes se avisarán a las empresas usuarias con anticipación razonable.</p>

<h2>12. Autoridad de protección de datos</h2>
<p>Si consideras que no atendimos tu pedido, puedes presentar un reclamo ante la Autoridad Nacional de Protección de Datos Personales del Ministerio de Justicia y Derechos Humanos.</p>

<h2>13. Contacto</h2>
<p>Para consultas o para ejercer tus derechos, escríbenos ${contacto(d)}.</p>
${fichaTitular(d)}
`, '/privacidad');
}

export function terminosPage(d: DatosLegales): string {
  const nombre = esc(d.nombreComercial);
  return pagina('Términos y condiciones', d, `
<h1>Términos y condiciones de uso</h1>
<p class="fecha">Fecha de última actualización: ${esc(d.actualizado)}</p>

<h2>1. Aceptación</h2>
<p>Al registrarte, entrar o usar ${nombre} (en adelante, «la Plataforma», «el Servicio», «nosotros»), ofrecido por ${quienSomos(d)}, declaras haber leído, entendido y aceptado estos Términos y Condiciones y nuestra <a href="/privacidad">Política de privacidad</a>.</p>
<p>Este documento es un contrato electrónico válido conforme al Código Civil del Perú. <b>Si no aceptas estos términos, no uses el Servicio.</b></p>

<h2>2. Definiciones</h2>
<ul>
  <li><b>Usuario o empresa:</b> la persona natural o jurídica que usa el Servicio para atender a sus clientes.</li>
  <li><b>Plataforma:</b> el software en la nube ${nombre}.</li>
  <li><b>Servicio:</b> las funciones de la Plataforma: mensajería por WhatsApp, pedido y confirmación de ubicación, etiquetas, reportes, automatizaciones e integraciones.</li>
  <li><b>Contenido del usuario:</b> la información, mensajes, archivos y datos que la empresa aporta.</li>
  <li><b>Cliente final:</b> la persona que recibe y envía mensajes por WhatsApp sobre su pedido.</li>
  <li><b>Credenciales:</b> los tokens, claves secretas y claves de API que la empresa entrega para conectar WhatsApp, Meta u otros servicios.</li>
  <li><b>Encargado del tratamiento:</b> ${nombre}, respecto de los datos de los clientes finales.</li>
  <li><b>Responsable del tratamiento:</b> la empresa usuaria, respecto de los datos de sus clientes.</li>
</ul>

<h2>3. Alcance y descripción del servicio</h2>
<h3>3.1 Funciones incluidas</h3>
<ul>
  <li>Conexión con WhatsApp vinculado por QR y con WhatsApp Business API de Meta.</li>
  <li>Bandeja de chats con etiquetas, ficha del cliente y varias líneas.</li>
  <li>Pedido de ubicación y confirmación de entrega, con recordatorios.</li>
  <li>Plantillas de mensajes aprobadas por Meta (Message Templates).</li>
  <li>Reportes, avisos y estado del servicio.</li>
  <li>Integraciones con otros sistemas por API (por ejemplo, el de la empresa de reparto).</li>
  <li>Uso opcional de inteligencia artificial y de voz, si la empresa los configura.</li>
</ul>
<h3>3.2 Dependencia de terceros</h3>
<p>El Servicio funciona con proveedores externos: Meta / WhatsApp Business Platform, proveedores de servidores y, según la configuración de la empresa, proveedores de inteligencia artificial y de voz. No respondemos por fallas, suspensiones o cambios que hagan esos terceros.</p>
<h3>3.3 Disponibilidad internacional</h3>
<p>El Servicio está disponible solo donde lo permitan las políticas de WhatsApp.</p>

<h2>4. Requisitos para usar el servicio</h2>
<h3>4.1 Capacidad legal</h3>
<p>Quien usa el Servicio garantiza que tiene 18 años o más, capacidad legal para contratar y, si actúa por una empresa, autoridad para hacerlo.</p>
<h3>4.2 Requisitos técnicos</h3>
<ul>
  <li>Con WhatsApp Business API: una cuenta de Meta Business, un número de WhatsApp Business verificado y una app de Meta con sus credenciales.</li>
  <li>Con WhatsApp por QR: un celular con WhatsApp para vincular.</li>
  <li>Un navegador actualizado.</li>
</ul>

<h2>5. Creación, gestión y seguridad de la cuenta</h2>
<h3>5.1 Registro</h3>
<p>La empresa debe dar información veraz y actualizada, y crear credenciales seguras y personales para cada miembro de su equipo.</p>
<h3>5.2 Responsabilidad del usuario</h3>
<ul>
  <li>Responde por toda la actividad hecha desde su cuenta.</li>
  <li>Debe avisarnos de cualquier acceso no autorizado.</li>
  <li>Debe mantener seguros sus dispositivos y credenciales.</li>
</ul>
<h3>5.3 Prohibiciones</h3>
<ul>
  <li>Crear varias cuentas para evadir límites.</li>
  <li>Compartir accesos con terceros no autorizados.</li>
  <li>Entrar a cuentas ajenas sin autorización.</li>
</ul>

<h2>6. Planes, precios, facturación y pagos</h2>
<h3>6.1 Planes</h3>
<p>Los planes pueden tener límites por número de líneas de WhatsApp, mensajes o funciones. El plan contratado se informa al contratar y en el panel.</p>
<h3>6.2 Precios</h3>
<p>Los precios se informan al contratar o en el panel. Pueden cambiar con un aviso previo de 30 días.</p>
<h3>6.3 Facturación e impuestos</h3>
<p>El cobro es por ciclos (mensual o anual) en la fecha de renovación. Los comprobantes se emiten conforme a las normas de la SUNAT. Salvo que se indique otra cosa, los precios no incluyen el IGV ni otros impuestos aplicables.</p>
<h3>6.4 Suspensión por falta de pago</h3>
<p>Si un pago no se procesa, el acceso puede suspenderse hasta regularizarlo.</p>
<h3>6.5 Reembolsos</h3>
<p>Los reembolsos se evalúan solo si se piden dentro de las primeras veinticuatro (24) horas siguientes al cobro de la renovación. Pasado ese plazo, el período se considera facturado y no se devuelve, aunque el servicio no se haya usado total o parcialmente. No hay reembolso cuando la suspensión o el término se deben a un uso indebido o a un incumplimiento de estos términos. Si se aprueba un reembolso, se pueden descontar las comisiones de las plataformas de pago y entidades financieras que no sean recuperables.</p>

<h2>7. Costos de terceros</h2>
<h3>7.1 WhatsApp Business API</h3>
<p>La empresa reconoce que Meta cobra sus propias tarifas por los mensajes de WhatsApp Business API (por ejemplo, por cada plantilla entregada), que esos cargos son independientes de los nuestros y que los cobra Meta directamente a la cuenta de la empresa, que es responsable de ellos.</p>
<h3>7.2 Inteligencia artificial y otras APIs</h3>
<p>Si la empresa conecta claves de API de proveedores externos, es responsable de sus pagos, su configuración, su seguridad y su buen uso. No administramos ni cobramos esos servicios.</p>

<h2>8. Uso aceptable</h2>
<h3>8.1 Uso permitido</h3>
<ul>
  <li>Atención al cliente y coordinación de pedidos y entregas.</li>
  <li>Confirmaciones de pedidos, de ubicación y de entrega por WhatsApp.</li>
  <li>Automatización de procesos de la empresa.</li>
  <li>Comunicación legítima con contactos que dieron su consentimiento.</li>
</ul>
<h3>8.2 Uso prohibido</h3>
<ul>
  <li>Enviar spam, mensajes no autorizados o publicidad no consentida.</li>
  <li>Contenido ilegal, fraudulento, engañoso, sexual, violento, ofensivo o difamatorio.</li>
  <li>Suplantar a otras personas o empresas.</li>
  <li>Pedir o enviar información sensible sin consentimiento expreso.</li>
  <li>Seguir escribiendo a quien pidió la baja.</li>
</ul>
<h3>8.3 Consecuencias</h3>
<p>Incumplir el uso aceptable puede llevar a la suspensión inmediata, al término de la cuenta sin reembolso, al bloqueo definitivo del acceso y, si corresponde, a avisar a las autoridades.</p>

<h2>9. Responsabilidades de la empresa usuaria</h2>
<h3>9.1 Cumplimiento legal</h3>
<p>La empresa se compromete a cumplir la Ley N.º 29733 (Protección de Datos Personales), la Ley N.º 29571 (Código de Protección y Defensa del Consumidor), las <a href="https://www.whatsapp.com/legal/business-policy" rel="noopener">Políticas de WhatsApp Business</a>, las <a href="https://www.whatsapp.com/legal/business-terms" rel="noopener">Condiciones de WhatsApp Business</a>, las políticas de Meta y las normas tributarias y comerciales.</p>
<h3>9.2 Sus contactos</h3>
<p>La empresa garantiza que tiene el consentimiento de sus clientes para escribirles, que les informó del tratamiento de sus datos, que respeta la baja (cualquier cliente puede responder <b>BAJA</b>) y que lo que comunica es verdadero.</p>
<h3>9.3 Credenciales</h3>
<p>Las credenciales y claves de API que entrega la empresa son de su exclusiva responsabilidad.</p>
<h3>9.4 WhatsApp vinculado por QR</h3>
<p>Una línea vinculada por QR no es una vía oficial de Meta: WhatsApp puede restringir o bloquear ese número. La empresa que la usa lo acepta.</p>

<h2>10. Para las personas que reciben mensajes</h2>
<ul>
  <li>Te escribimos por encargo de la empresa a la que le compraste, sobre tu pedido.</li>
  <li>Puedes dejar de recibir mensajes cuando quieras respondiendo <b>BAJA</b> o pidiéndolo en el chat.</li>
  <li>Algunas respuestas pueden ser automáticas. Siempre puedes pedir hablar con una persona.</li>
  <li>Tus datos se tratan como explica la <a href="/privacidad">Política de privacidad</a>, y puedes pedir que se borren en <a href="/eliminacion-de-datos">Eliminar mis datos</a>.</li>
</ul>

<h2>11. Limitaciones del servicio</h2>
<h3>11.1 Disponibilidad</h3>
<p>Hacemos lo razonable para que el Servicio funcione sin interrupciones, pero no lo garantizamos de forma absoluta: hay mantenimientos, fallas de terceros y cambios de WhatsApp Business API. Tampoco garantizamos que cada mensaje llegue, por ejemplo si WhatsApp lo rechaza o el número del cliente no existe.</p>
<h3>11.2 Límites técnicos</h3>
<p>Según el plan y las reglas de Meta, puede haber límites de mensajes, de almacenamiento y de velocidad. El sistema también regula el ritmo de envío para cuidar que el número no sea bloqueado.</p>
<h3>11.3 Funciones en prueba</h3>
<p>Las funciones marcadas como de prueba pueden tener errores, cambiar o retirarse sin aviso.</p>

<h2>12. Propiedad intelectual</h2>
<p>El código, la marca, el diseño y los procesos de la Plataforma son de sus titulares. Se otorga a la empresa una licencia de uso no exclusiva, no transferible y revocable mientras dure el servicio. La empresa conserva la propiedad de su contenido y de los datos de sus clientes. Se prohíbe la ingeniería inversa, la copia del software y el uso de la marca sin autorización previa.</p>

<h2>13. Limitación de responsabilidad</h2>
<p>En la medida que lo permita la ley peruana, no respondemos por daños indirectos, especiales o consecuenciales, ni por lucro cesante; por pérdidas de datos causadas por fallas externas; por problemas causados por Meta, WhatsApp o proveedores de inteligencia artificial; ni por el uso indebido del Servicio por parte de la empresa. El Servicio es una herramienta: las decisiones sobre los pedidos, las entregas y lo que se le dice a cada cliente son de la empresa que lo usa.</p>
<p>Nuestra responsabilidad máxima equivale al monto que la empresa pagó en los últimos 3 meses. Estas limitaciones no se aplican en casos de dolo, culpa grave o cuando la ley peruana lo prohíba.</p>

<h2>14. Indemnización</h2>
<p>La empresa nos indemnizará por los daños que resulten de su incumplimiento de estos términos, de la violación de derechos de terceros o de su uso de la Plataforma.</p>

<h2>15. Datos personales y privacidad</h2>
<p>El tratamiento de datos se rige por la <a href="/privacidad">Política de privacidad</a> vigente. La empresa usuaria es responsable del tratamiento de los datos de sus contactos.</p>

<h2>16. Terminación</h2>
<h3>16.1 Por la empresa</h3>
<p>Puede dejar de usar el Servicio y pedir el cierre de su cuenta en cualquier momento.</p>
<h3>16.2 Por nosotros</h3>
<p>Podemos suspender o terminar el acceso por incumplimiento de estos términos o de las políticas de WhatsApp, por falta de pago, por actividad sospechosa que ponga en riesgo el Servicio o a terceros, o por orden de una autoridad.</p>
<h3>16.3 Consecuencias</h3>
<p>El acceso termina y los datos se eliminan según los plazos de la Política de privacidad. No hay reembolso por períodos no usados.</p>

<h2>17. Modificaciones</h2>
<p>Podemos actualizar estos términos. La versión vigente es la publicada en esta página, con su fecha; los cambios relevantes se avisarán a las empresas con 15 días de anticipación. También podemos cambiar o retirar funciones con un aviso razonable.</p>

<h2>18. Ley aplicable y solución de controversias</h2>
<p>Estos términos se rigen por las leyes de la República del Perú. Antes de acudir a un juez, las partes intentarán una negociación directa durante 30 días y, si no hay acuerdo, una conciliación. Cualquier controversia se someterá a los jueces y tribunales del Distrito Judicial de Lima Norte, salvo los derechos irrenunciables del consumidor, que puede reclamar en su propia jurisdicción.</p>

<h2>19. Disposiciones generales</h2>
<ul>
  <li>Este documento es el acuerdo completo entre las partes sobre el Servicio.</li>
  <li>Si una cláusula es nula, las demás siguen vigentes.</li>
  <li>No existe relación laboral, de agencia ni de sociedad entre las partes.</li>
  <li>La empresa no puede ceder su cuenta sin autorización.</li>
  <li>El caso fortuito y la fuerza mayor eximen temporalmente de responsabilidad.</li>
</ul>

<h2>20. Libro de Reclamaciones</h2>
<p>Ponemos a disposición nuestro <a href="/libro-de-reclamaciones">Libro de Reclamaciones virtual</a>, conforme al Código de Protección y Defensa del Consumidor y su reglamento.</p>

<h2>21. Notificaciones y contacto</h2>
<p>A la empresa le escribimos al correo o al teléfono que registró. A nosotros nos escribes ${contacto(d)}.</p>
${fichaTitular(d)}
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
