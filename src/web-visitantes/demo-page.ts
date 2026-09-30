/**
 * Una pagina de tienda de mentira con el widget puesto: para ver el canal
 * web funcionando antes de tocar la web de verdad, y para copiar el trozo
 * exacto que hay que pegar en ella.
 */

export function paginaDemo(opts: { origen: string; negocio: string }): string {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const trozo = `<script src="${opts.origen}/web/widget.js"></script>\n<script>\n  WAChat.montar({\n    texto: '¿Te ayudamos?',        // lo que dice el botón\n    color: '#25d366',\n    lado: 'derecha',\n    bienvenida: 'Hola 👋 Escríbenos y te respondemos al momento.',\n    pedirNombre: true,             // pregunta el nombre antes de empezar\n    whatsapp: '51987654321'        // opcional: botón "seguir por WhatsApp"\n  });\n</script>`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo del chat web · ${esc(opts.negocio)}</title>
<style>
  body { margin:0; font: 15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:#1c1f24; background:#fafafa; }
  header { background:#111; color:#fff; padding:18px 24px; display:flex; justify-content:space-between; align-items:center; }
  main { max-width:960px; margin:0 auto; padding:28px 20px 120px; }
  .hero { background:linear-gradient(135deg,#1f2937,#111827); color:#fff; border-radius:16px; padding:36px 28px; margin-bottom:24px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:14px; }
  .p { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px; }
  .p .img { height:120px; border-radius:8px; background:#e5e7eb; margin-bottom:10px; }
  .p b { display:block; } .p span { color:#6b7280; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:18px 20px; margin-top:28px; }
  pre { background:#f3f4f6; border-radius:8px; padding:12px; overflow:auto; font-size:13px; }
  .muted { color:#6b7280; }
</style></head><body>
<header><b>${esc(opts.negocio)}</b><span class="muted" style="color:#9ca3af">Página de demostración: así se ve el chat en una web cualquiera</span></header>
<main>
  <div class="hero"><h1 style="margin:0 0 6px">Bienvenido a ${esc(opts.negocio)}</h1><p style="margin:0;opacity:.85">Esta página no es real: sirve para probar la burbuja de chat de abajo a la derecha. Escribe como si fueras un cliente.</p></div>
  <div class="grid">
    <div class="p"><div class="img"></div><b>Producto 1</b><span>S/ 120</span></div>
    <div class="p"><div class="img"></div><b>Producto 2</b><span>S/ 90</span></div>
    <div class="p"><div class="img"></div><b>Producto 3</b><span>S/ 150</span></div>
    <div class="p"><div class="img"></div><b>Producto 4</b><span>S/ 60</span></div>
  </div>
  <div class="card">
    <h2 style="margin-top:0">Cómo ponerlo en tu web</h2>
    <p class="muted">1. En el panel, <b>Conectar mi web y tienda → Chat embebido</b>, escribe el origen de tu web (por ejemplo <code>https://tu-tienda.com</code>) y guarda. 2. Pega esto antes de <code>&lt;/body&gt;</code> (en WordPress: un bloque HTML personalizado o el pie de página del tema; en Next.js: en <code>app/layout.tsx</code> con <code>next/script</code>; en Shopify: <code>theme.liquid</code>).</p>
    <pre>${esc(trozo)}</pre>
    <p class="muted">Lo que escriban tus visitantes entra al sistema como cualquier mensaje: lo contesta tu asistente de IA y lo ves en <b>Chats</b>. No necesitan WhatsApp ni cuenta.</p>
  </div>
</main>
<script src="${esc(opts.origen)}/web/widget.js"></script>
<script>
  WAChat.montar({ texto: '¿Te ayudamos?', color: '#25d366', bienvenida: 'Hola 👋 Escríbenos y te respondemos al momento.', pedirNombre: true });
</script>
</body></html>`;
}
