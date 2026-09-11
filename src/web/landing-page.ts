/**
 * La portada: que es esto y por donde se entra.
 *
 * Es la unica pagina publica. Presenta el sistema como un producto (que hace,
 * como funciona, por que no quema el numero) y lleva a /login. Si ya hay
 * sesion, el boton lleva al panel. Todo es HTML y CSS propio: sin imagenes ni
 * librerias, para que cargue igual en cualquier red.
 */

import { escapeHtml } from './login-page.js';

const CSS = `
  :root { color-scheme: light; --bg: #f7f8fa; --card: #fff; --line: #e6e8ec; --text: #14171c; --muted: #667085; --accent: #128c7e; --accent-2: #25d366; --dark: #0f1a17; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  a { color: var(--accent); }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 22px; }
  header { position: sticky; top: 0; z-index: 10; background: rgba(247,248,250,.85); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
  header .wrap { display: flex; align-items: center; gap: 18px; height: 64px; }
  .marca { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 18px; text-decoration: none; color: var(--text); letter-spacing: -.01em; }
  .marca .logo { width: 34px; height: 34px; border-radius: 9px; background: var(--accent); color: #fff; display: grid; place-items: center; }
  nav.menu { display: flex; gap: 22px; margin-left: 26px; font-size: 14.5px; }
  nav.menu a { color: var(--muted); text-decoration: none; }
  nav.menu a:hover { color: var(--text); }
  .der { margin-left: auto; display: flex; gap: 10px; align-items: center; }
  .btn { display: inline-flex; align-items: center; gap: 8px; padding: 11px 20px; border-radius: 10px; background: var(--accent); color: #fff; font-weight: 600; text-decoration: none; font-size: 15px; border: 1px solid transparent; }
  .btn:hover { filter: brightness(1.05); }
  .btn.ghost { background: transparent; color: var(--text); border-color: var(--line); }
  .btn.grande { padding: 14px 26px; font-size: 16px; }

  .hero { padding: 84px 0 40px; display: grid; gap: 40px; grid-template-columns: 1.05fr 1fr; align-items: center; }
  .hero h1 { font-size: 50px; line-height: 1.08; letter-spacing: -.03em; margin: 0 0 18px; }
  .hero h1 span { color: var(--accent); }
  .hero p { font-size: 18px; color: var(--muted); margin: 0 0 28px; max-width: 520px; }
  .eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--accent); background: rgba(18,140,126,.1); padding: 5px 12px; border-radius: 999px; margin-bottom: 18px; }
  .acciones { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .acciones small { color: var(--muted); font-size: 13px; }

  /* la "captura" del panel, hecha con CSS */
  .mock { background: var(--card); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 30px 80px -30px rgba(15,26,23,.35), 0 2px 6px rgba(0,0,0,.05); overflow: hidden; display: grid; grid-template-columns: 150px 1fr; min-height: 380px; }
  .mock .lado { border-right: 1px solid var(--line); padding: 14px 10px; font-size: 11.5px; color: var(--muted); }
  .mock .lado b { display: flex; align-items: center; gap: 6px; color: var(--text); font-size: 12.5px; margin-bottom: 12px; }
  .mock .lado b i { width: 18px; height: 18px; border-radius: 5px; background: var(--accent); display: inline-block; }
  .mock .lado div { padding: 6px 8px; border-radius: 6px; margin-bottom: 2px; }
  .mock .lado div.on { background: rgba(18,140,126,.12); color: var(--accent); font-weight: 600; }
  .mock .lado .g { text-transform: uppercase; letter-spacing: .08em; font-size: 9.5px; margin-top: 10px; padding-left: 8px; }
  .mock .cuerpo { padding: 14px; background: #f4f6f8; }
  .mock .kpis { display: grid; gap: 8px; grid-template-columns: repeat(3, 1fr); }
  .mock .kpi { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  .mock .kpi span { display: block; font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 700; }
  .mock .kpi b { font-size: 20px; letter-spacing: -.02em; }
  .mock .kpi b.ok { color: #16a34a; }
  .mock .graf { margin-top: 10px; background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 12px; display: flex; align-items: flex-end; gap: 6px; height: 120px; }
  .mock .graf i { flex: 1; background: var(--accent); border-radius: 3px 3px 0 0; opacity: .85; }
  .mock .graf i:nth-child(even) { background: #94a3b8; }
  .mock .fila { margin-top: 10px; display: flex; gap: 8px; }
  .mock .chip { background: #fff; border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; font-size: 11px; display: flex; align-items: center; gap: 6px; }
  .mock .chip i { width: 8px; height: 8px; border-radius: 50%; background: #16a34a; }

  .logos { display: flex; gap: 26px; align-items: center; color: var(--muted); font-size: 13.5px; padding: 8px 0 50px; flex-wrap: wrap; }
  .logos b { font-weight: 600; color: var(--text); }

  section.bloque { padding: 60px 0; }
  .titulo-sec { max-width: 620px; margin-bottom: 30px; }
  .titulo-sec h2 { font-size: 32px; letter-spacing: -.02em; line-height: 1.15; margin: 0 0 10px; }
  .titulo-sec p { color: var(--muted); margin: 0; font-size: 17px; }
  .tarjetas { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .tarjeta { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 22px 22px 20px; }
  .tarjeta .ico { width: 40px; height: 40px; border-radius: 10px; background: rgba(18,140,126,.1); color: var(--accent); display: grid; place-items: center; margin-bottom: 14px; }
  .tarjeta b { display: block; font-size: 16.5px; margin-bottom: 6px; }
  .tarjeta p { margin: 0; color: var(--muted); font-size: 14.5px; }

  .pasos { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); counter-reset: paso; }
  .paso { position: relative; padding: 22px 22px 20px 22px; border: 1px solid var(--line); border-radius: 16px; background: var(--card); }
  .paso::before { counter-increment: paso; content: counter(paso); display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--accent); color: #fff; font-weight: 800; margin-bottom: 12px; }
  .paso b { display: block; margin-bottom: 6px; }
  .paso p { margin: 0; color: var(--muted); font-size: 14.5px; }

  .oscuro { background: var(--dark); color: #e8f1ee; border-radius: 22px; padding: 46px 40px; display: grid; gap: 30px; grid-template-columns: 1.1fr 1fr; align-items: center; }
  .oscuro h2 { font-size: 30px; margin: 0 0 10px; letter-spacing: -.02em; line-height: 1.15; }
  .oscuro p { color: #a9bbb5; margin: 0; font-size: 16px; }
  .oscuro ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  .oscuro li { display: flex; gap: 10px; align-items: flex-start; font-size: 15px; }
  .oscuro li i { flex: none; width: 22px; height: 22px; border-radius: 50%; background: rgba(37,211,102,.18); color: var(--accent-2); display: grid; place-items: center; font-style: normal; font-size: 13px; font-weight: 800; margin-top: 1px; }

  .cta { text-align: center; padding: 70px 0 60px; }
  .cta h2 { font-size: 34px; letter-spacing: -.02em; margin: 0 0 10px; }
  .cta p { color: var(--muted); margin: 0 0 24px; }
  footer { border-top: 1px solid var(--line); padding: 26px 0 40px; color: var(--muted); font-size: 13.5px; display: flex; gap: 16px; flex-wrap: wrap; justify-content: space-between; }

  @media (max-width: 900px) {
    .hero { grid-template-columns: 1fr; padding-top: 50px; }
    .hero h1 { font-size: 38px; }
    nav.menu { display: none; }
    .oscuro { grid-template-columns: 1fr; padding: 32px 24px; }
    .mock { grid-template-columns: 1fr; }
    .mock .lado { display: none; }
  }
`;

const ICO = {
  pin: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z"/></svg>',
  salud: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 4 12 2.5-6h5"/></svg>',
  megafono: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v4h3l7 4V6l-7 4z"/><path d="M17 9a4 4 0 0 1 0 6"/></svg>',
  rayo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  llave: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="14" r="4"/><path d="m11 11 9-9M17 5l2 2M14 8l2 2"/></svg>',
};

export function landingPage(opts: { nombreNegocio: string; conSesion: boolean }): string {
  const negocio = escapeHtml(opts.nombreNegocio);
  const entrar = opts.conSesion
    ? '<a class="btn" href="/panel#inicio">Ir al panel</a>'
    : '<a class="btn" href="/login">Entrar</a>';
  const cta = opts.conSesion
    ? '<a class="btn grande" href="/panel#inicio">Abrir el panel</a>'
    : '<a class="btn grande" href="/login">Entrar al sistema</a>';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${negocio} - WhatsApp para reparto y ventas</title>
<meta name="description" content="Ubicaciones para el reparto, un chat para todo el equipo y campañas al ritmo que WhatsApp tolera, con guardas para que el número siga vivo.">
<style>${CSS}</style></head>
<body>
<header><div class="wrap">
  <a class="marca" href="/"><span class="logo">W</span>${negocio}</a>
  <nav class="menu"><a href="#que-hace">Qué hace</a><a href="#como-funciona">Cómo funciona</a><a href="#numero">Salud del número</a></nav>
  <div class="der">${opts.conSesion ? '<a class="btn ghost" href="/chat">Chats</a>' : ''}${entrar}</div>
</div></header>

<main class="wrap">
  <section class="hero">
    <div>
      <span class="eyebrow">WhatsApp para reparto y ventas</span>
      <h1>Tu WhatsApp trabajando por ti, <span>sin quemar el número</span>.</h1>
      <p>Pide la ubicación a cada cliente del reparto, atiende y cotiza desde un solo chat, y manda campañas al ritmo que WhatsApp tolera. Con las guardas para que el número siga vivo mañana.</p>
      <div class="acciones">${cta}<small>Acceso solo para el equipo · usuario y contraseña</small></div>
    </div>
    <div class="mock" aria-hidden="true">
      <div class="lado">
        <b><i></i>${negocio}</b>
        <div class="on">Inicio</div><div>Manual de uso</div><div>Soporte</div>
        <div class="g">Conversaciones</div><div>Chats</div><div>Enviar mensaje</div>
        <div class="g">Reparto</div><div>Ubicaciones</div><div>Ajustes</div>
        <div class="g">Campañas</div><div>Campañas</div><div>Plantillas</div>
        <div class="g">Salud del número</div><div>Estado</div>
      </div>
      <div class="cuerpo">
        <div class="kpis">
          <div class="kpi"><span>Enviados hoy</span><b>184</b></div>
          <div class="kpi"><span>Recibidos hoy</span><b>96</b></div>
          <div class="kpi"><span>Fallidos hoy</span><b class="ok">0</b></div>
        </div>
        <div class="graf"><i style="height:35%"></i><i style="height:22%"></i><i style="height:55%"></i><i style="height:30%"></i><i style="height:70%"></i><i style="height:38%"></i><i style="height:62%"></i><i style="height:44%"></i><i style="height:88%"></i><i style="height:52%"></i><i style="height:76%"></i><i style="height:40%"></i><i style="height:58%"></i><i style="height:33%"></i></div>
        <div class="fila"><span class="chip"><i></i>Número en verde</span><span class="chip">Reparto: 42 de 60</span><span class="chip">3 esperan respuesta</span></div>
      </div>
    </div>
  </section>

  <div class="logos"><span>Funciona con</span><b>WhatsApp Business (API oficial de Meta)</b><span>·</span><b>WAHA</b><span>·</span><b>WhatsApp Web (QR)</b><span>·</span><b>GSG</b></div>

  <section class="bloque" id="que-hace">
    <div class="titulo-sec"><h2>Todo lo del día, en un solo sitio</h2><p>Cada módulo hace una cosa y la hace bien. Y todos comparten el mismo número, el mismo ritmo y las mismas guardas.</p></div>
    <div class="tarjetas">
      <div class="tarjeta"><div class="ico">${ICO.pin}</div><b>Ubicaciones para el reparto</b><p>Pega la lista del día y el sistema le pide la ubicación a cada cliente, insiste con criterio y aparta lo que necesita una persona. Las incidencias, con nombre.</p></div>
      <div class="tarjeta"><div class="ico">${ICO.chat}</div><b>Un chat para todo el equipo</b><p>Las conversaciones como en WhatsApp, con el asistente contestando lo rutinario y tú entrando cuando hace falta. Nada se pierde y todo se respalda.</p></div>
      <div class="tarjeta"><div class="ico">${ICO.megafono}</div><b>Campañas por goteo</b><p>Un canario primero, luego el resto a cuentagotas, con variantes de texto y pausas humanas. Si algo va mal, se frena solo.</p></div>
      <div class="tarjeta"><div class="ico">${ICO.salud}</div><b>Salud del número</b><p>Ritmo humano, avisos de riesgo y freno automático antes de que Meta o WhatsApp bloqueen el número. Un semáforo que se explica.</p></div>
      <div class="tarjeta"><div class="ico">${ICO.rayo}</div><b>Automatización con control</b><p>Reglas, secuencias y plantillas propias. Tú decides cuándo sale cada mensaje, de qué tipo y con qué plantilla.</p></div>
      <div class="tarjeta"><div class="ico">${ICO.llave}</div><b>Cuentas e integraciones</b><p>Cada persona con su usuario y su rol. Los programas, como el sistema de GSG, con una clave de API que se revoca en un clic.</p></div>
    </div>
  </section>

  <section class="bloque" id="como-funciona">
    <div class="titulo-sec"><h2>Cómo funciona el reparto</h2><p>Del Excel de la mañana a las ubicaciones en el mapa, sin que nadie escriba un mensaje a mano.</p></div>
    <div class="pasos">
      <div class="paso"><b>Cargas la lista</b><p>Nombre, teléfono, pedido y dirección. Los números mal escritos o repetidos se apartan antes de mandar nada.</p></div>
      <div class="paso"><b>El sistema pide la ubicación</b><p>Un mensaje a cada cliente, con pausas entre uno y otro y solo en horario. Si no contesta, insiste con otro texto.</p></div>
      <div class="paso"><b>Lo que llega, se ordena</b><p>Ubicación: resuelto. Otra cosa: supervisión. Sin respuesta tras varios intentos: al motorizado, que lo llama.</p></div>
      <div class="paso"><b>Todo queda reportado</b><p>Cada incidencia con su nombre, lista para el sistema de GSG. Y el avance, en vivo, en el panel.</p></div>
    </div>
  </section>

  <section class="bloque" id="numero">
    <div class="oscuro">
      <div>
        <h2>Las guardas para que el número siga vivo mañana</h2>
        <p>Un número baneado es un día sin reparto. Por eso el sistema no manda todo lo que puede, sino todo lo que WhatsApp tolera.</p>
      </div>
      <ul>
        <li><i>✓</i>Ritmo humano: pausas al azar, escritura simulada, cupos por hora y por día que crecen con el calentamiento.</li>
        <li><i>✓</i>Nada sale sin consentimiento, a quien se dio de baja, o fuera del horario.</li>
        <li><i>✓</i>Un monitor mira errores, bloqueos, bajas y quejas cada minuto y frena solo: amarillo, naranja, rojo.</li>
        <li><i>✓</i>Plantillas pausadas por Meta se detectan y se cambian por otra; las variantes evitan repetir el mismo texto.</li>
        <li><i>✓</i>Un modo prueba para trabajar solo con los números que tú digas.</li>
      </ul>
    </div>
  </section>

  <section class="cta">
    <h2>Entra y mira cómo va el día</h2>
    <p>Chats, reparto, campañas y la salud del número, en una sola pantalla.</p>
    ${cta}
  </section>
</main>

<footer class="wrap">
  <span>${negocio} · Acceso solo para el equipo.</span>
  <span>${opts.conSesion ? '<a href="/panel#inicio">Panel</a> · <a href="/manual">Manual de uso</a>' : '¿Tienes cuenta? <a href="/login">Entra aquí</a>.'}</span>
</footer>
</body></html>`;
}
