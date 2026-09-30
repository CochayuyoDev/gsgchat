/**
 * Prueba de punta a punta del SaaS con tiendas de verdad (Docker).
 *
 *   npm run saas:prueba            crea las tiendas si faltan y prueba todo
 *   npm run saas:prueba -- --limpiar   al terminar, da de baja las tiendas de prueba
 *
 * Lo que hace, tienda por tienda:
 *  1. la da de alta (contenedor, base, subdominio) con el simulador de
 *     entrantes encendido;
 *  2. crea la primera cuenta y entra;
 *  3. crea una clave de API acotada y comprueba que NO abre otra tienda;
 *  4. registra un webhook hacia un receptor que corre aqui, en el host;
 *  5. crea un conector WooCommerce y le manda un pedido firmado;
 *  6. simula clientes escribiendo por WhatsApp y comprueba que aparecen en
 *     la API, que el webhook llego firmado, y que la tienda de al lado no
 *     ve nada de esto;
 *  7. pide un token del chat embebido y abre la pagina.
 *
 * Sin WhatsApp vinculado los envios salientes no pueden salir: se comprueba
 * que el sistema lo diga (bloqueado/error con motivo), no que llegue.
 */

import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { altaInstancia, bajaInstancia, listarInstancias, leerConfigSaas, prepararBase, urlDe } from './instancias.js';
import { verificarFirma } from '../src/webhooks/firma.js';

const cfg = leerConfigSaas();
const limpiar = process.argv.includes('--limpiar');
const PUERTO_RECEPTOR = 3777;

const TIENDAS = [
  { slug: 'prueba-zapateria', nombre: 'Zapateria Lima', proveedor: 'local' as const, pais: 'peru' as const },
  { slug: 'prueba-ferreteria', nombre: 'Ferreteria del Sur', proveedor: 'cloud' as const, pais: 'peru' as const },
  { slug: 'prueba-boutique', nombre: 'Boutique CDMX', proveedor: 'waha' as const, pais: 'mexico' as const },
];

// ---------------------------------------------------------------- utilidades

let fallos = 0;
const ok = (que: string) => console.log(`  ✓ ${que}`);
const mal = (que: string, detalle?: unknown) => {
  fallos++;
  console.log(`  ✗ ${que}${detalle !== undefined ? `\n      ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle).slice(0, 300)}` : ''}`);
};
const comprobar = (cond: unknown, que: string, detalle?: unknown) => (cond ? ok(que) : mal(que, detalle));

async function pedir(url: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; json: Record<string, unknown>; headers: Headers; texto: string }> {
  const r = await fetch(url, {
    ...init,
    headers: { ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const texto = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    /* html o vacio */
  }
  return { status: r.status, json, headers: r.headers, texto };
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function esperarSalud(url: string): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch {
      /* todavia no */
    }
    await espera(2000);
  }
  return false;
}

// ------------------------------------------------- el receptor de webhooks

interface Recibido {
  slug: string;
  evento: string;
  cuerpo: string;
  firma: string | undefined;
  at: number;
}
const recibidos: Recibido[] = [];
const receptor = createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (d) => (cuerpo += d));
  req.on('end', () => {
    const slug = (req.url ?? '').split('/').pop() ?? '';
    recibidos.push({ slug, evento: String(req.headers['x-evento'] ?? ''), cuerpo, firma: req.headers['x-firma'] as string | undefined, at: Date.now() });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise<void>((r) => receptor.listen(PUERTO_RECEPTOR, '0.0.0.0', r));
const URL_RECEPTOR = `http://host.docker.internal:${PUERTO_RECEPTOR}/webhook`;

async function esperarWebhook(slug: string, evento: string, desde: number, acepta: (r: Recibido) => boolean = () => true, ms = 40_000): Promise<Recibido | null> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    // En una segunda corrida la tienda tiene tambien el webhook de la corrida
    // anterior (otro secreto): se busca la entrega que firma el de ahora.
    const r = recibidos.find((x) => x.slug === slug && x.evento === evento && x.at >= desde && acepta(x));
    if (r) return r;
    await espera(1000);
  }
  return null;
}

// ------------------------------------------------------------ las pruebas

interface Contexto {
  slug: string;
  nombre: string;
  url: string;
  cookie: string;
  clave: string;
  secretoWebhook: string;
  telefonoCliente: string;
}

async function prepararTienda(t: (typeof TIENDAS)[number]): Promise<Contexto | null> {
  console.log(`\n== ${t.nombre} (${t.slug}, ${t.proveedor}, ${t.pais})`);
  const url = urlDe(t.slug, cfg);

  if (!listarInstancias().some((i) => i.slug === t.slug)) {
    await altaInstancia(t.slug, { nombre: t.nombre, proveedor: t.proveedor, pais: t.pais, extra: { DEV_SIMULATE_INBOUND: 'true', SOLO_NUMEROS: '' } }, { cfg, log: (l) => console.log(`    ${l}`) });
  }
  if (!(await esperarSalud(url))) {
    mal(`la tienda responde en ${url}`);
    return null;
  }
  ok(`responde en ${url}`);

  // Cuenta propia (usuario distinto por tienda, para que se note el aislamiento).
  const usuario = `admin-${t.slug.replace('prueba-', '')}`;
  let alta = await pedir(`${url}/login/primera-cuenta`, { method: 'POST', json: { nombre: 'Admin', usuario, clave: 'clave-de-prueba-123' } });
  if (alta.status === 409) alta = await pedir(`${url}/login`, { method: 'POST', json: { usuario, clave: 'clave-de-prueba-123' } });
  const cookie = (alta.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  comprobar(alta.status === 200 && cookie.startsWith('wa_sesion='), 'primera cuenta creada y sesion abierta', alta.json);

  // Clave de API acotada.
  const clave = await pedir(`${url}/admin/claves-api`, { method: 'POST', headers: { cookie }, json: { nombre: 'Prueba', permisos: ['mensajes:enviar', 'conversaciones:leer', 'contactos:leer', 'contactos:escribir', 'webhooks:gestionar', 'conectores:gestionar', 'embed:emitir', 'estado:leer', 'plantillas:leer'] } });
  comprobar(clave.status === 200 && String(clave.json.clave).startsWith('wak_'), 'clave de API acotada creada', clave.json);
  const wak = String(clave.json.clave);
  const auth = { authorization: `Bearer ${wak}` };

  const estado = await pedir(`${url}/api/v1/estado`, { headers: auth });
  comprobar(estado.status === 200 && estado.json.proveedor === t.proveedor, `GET /api/v1/estado dice proveedor ${t.proveedor}`, estado.json);
  const admin = await pedir(`${url}/admin/health`, { headers: auth });
  comprobar(admin.status === 403, 'la clave acotada no entra por /admin (403)', admin.status);

  // Webhook hacia el receptor del host.
  const wh = await pedir(`${url}/api/v1/webhooks`, { method: 'POST', headers: auth, json: { url: `${URL_RECEPTOR}/${t.slug}`, descripcion: 'Receptor de prueba', eventos: ['mensaje.recibido', 'contacto.alta', 'mensaje.enviado', 'mensaje.estado'] } });
  comprobar(wh.status === 201 && String(wh.json.secreto).startsWith('whsec_'), 'webhook registrado', wh.json);
  const whId = String((wh.json.webhook as { id: string }).id);
  const prueba = await pedir(`${url}/api/v1/webhooks/${whId}/probar`, { method: 'POST', headers: auth });
  comprobar(prueba.json.ok === true && prueba.json.codigo === 200, 'el webhook de prueba (prueba.ping) llega al receptor con 200', prueba.json);

  return { slug: t.slug, nombre: t.nombre, url, cookie, clave: wak, secretoWebhook: String(wh.json.secreto), telefonoCliente: t.pais === 'mexico' ? '5215512345678' : '51987654321' };
}

async function probarTienda(c: Contexto, otras: Contexto[]): Promise<void> {
  console.log(`\n-- Pruebas en ${c.nombre}`);
  const auth = { authorization: `Bearer ${c.clave}` };

  // 1. Un cliente escribe por WhatsApp (simulado): aparece en la API y llega el webhook firmado.
  const desde = Date.now();
  const entrante = await pedir(`${c.url}/admin/dev/inbound`, { method: 'POST', headers: { cookie: c.cookie }, json: { phone: c.telefonoCliente, name: 'Cliente Prueba', text: `hola, escribo a ${c.nombre}` } });
  comprobar(entrante.status === 200, 'entrante simulado aceptado', entrante.json);
  const conv = await pedir(`${c.url}/api/v1/conversaciones/${c.telefonoCliente}`, { headers: auth });
  const mensajes = (conv.json.mensajes as Array<{ direccion: string; texto: string }> | undefined) ?? [];
  comprobar(conv.status === 200 && mensajes.some((m) => m.direccion === 'entrante' && m.texto.includes(c.nombre)), 'el mensaje esta en /api/v1/conversaciones/:telefono', conv.json);
  const hook = await esperarWebhook(c.slug, 'mensaje.recibido', desde, (r) => verificarFirma(c.secretoWebhook, r.cuerpo, r.firma));
  comprobar(hook !== null, 'llego el webhook mensaje.recibido al receptor, firmado con el secreto de esta corrida');
  if (hook) {
    comprobar(verificarFirma(c.secretoWebhook, hook.cuerpo, hook.firma), 'la firma X-Firma del webhook es valida con el secreto de ESTA tienda');
    const datos = (JSON.parse(hook.cuerpo) as { datos: { contacto: { telefono: string }; mensaje: { texto: string } } }).datos;
    comprobar(datos.contacto.telefono === c.telefonoCliente && datos.mensaje.texto.includes(c.nombre), 'el webhook trae el telefono y el texto correctos', datos);
    for (const o of otras) comprobar(!verificarFirma(o.secretoWebhook, hook.cuerpo, hook.firma), `la firma NO vale con el secreto de ${o.nombre}`);
  }

  // 2. Alta de contacto con consentimiento y envio: sin WhatsApp vinculado, el sistema lo dice.
  const contacto = await pedir(`${c.url}/api/v1/contactos`, { method: 'POST', headers: auth, json: { telefono: c.telefonoCliente, nombre: 'Cliente Prueba', consentimiento: { origen: 'prueba de punta a punta' } } });
  comprobar(contacto.status === 200 || contacto.status === 201, 'contacto con consentimiento registrado por la API', contacto.json);
  const envio = await pedir(`${c.url}/api/v1/mensajes`, { method: 'POST', headers: auth, json: { telefono: c.telefonoCliente, texto: 'Gracias por escribir' } });
  comprobar([200, 202, 502].includes(envio.status) && typeof envio.json.estado === 'string', `POST /api/v1/mensajes responde con estado claro (${envio.status}: ${String(envio.json.estado)}${envio.json.motivo ? ' · ' + String(envio.json.motivo) : ''}${envio.json.error ? ' · ' + String(envio.json.error) : ''})`, envio.json);

  // 3. Conector WooCommerce con un pedido firmado.
  const conector = await pedir(`${c.url}/api/v1/conectores`, { method: 'POST', headers: auth, json: { tipo: 'woocommerce', nombre: `Tienda web de ${c.nombre}`, reglas: [{ evento: 'pedido.creado', texto: 'Hola {nombre}, tu pedido {numero} de {tienda} ({total} {moneda}) esta confirmado.' }] } });
  comprobar(conector.status === 201 && String(conector.json.secreto).startsWith('wcs_'), 'conector WooCommerce creado', conector.json);
  const conId = String((conector.json.conector as { id: string }).id);
  const pedido = JSON.stringify({ id: 1024, number: '1024', status: 'pending', currency: 'PEN', total: '150.00', billing: { first_name: 'Cliente', last_name: 'Prueba', phone: c.telefonoCliente }, line_items: [{ name: 'Articulo', quantity: 1 }] });
  const firma = createHmac('sha256', String(conector.json.secreto)).update(pedido).digest('base64');
  const woo = await pedir(`${c.url}/conectores/${conId}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wc-webhook-topic': 'order.created', 'x-wc-webhook-signature': firma }, body: pedido });
  comprobar(woo.status === 200 && woo.json.evento === 'pedido.creado' && ['enviado', 'bloqueado', 'error'].includes(String(woo.json.resultado)), `el pedido de WooCommerce entro y se proceso (resultado: ${String(woo.json.resultado)})`, woo.json);
  const mala = await pedir(`${c.url}/conectores/${conId}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wc-webhook-topic': 'order.created', 'x-wc-webhook-signature': 'firma-falsa' }, body: pedido });
  comprobar(mala.status === 401, 'un pedido con firma mala se rechaza (401)', mala.status);
  const entradas = await pedir(`${c.url}/api/v1/conectores/${conId}/entradas`, { headers: auth });
  comprobar(Array.isArray(entradas.json.entradas) && (entradas.json.entradas as unknown[]).length === 1, 'el pedido quedo apuntado en las entradas del conector', entradas.json);

  // 4. Chat embebido: token acotado a ese telefono y pagina con su CSP.
  const emb = await pedir(`${c.url}/api/v1/embed/token`, { method: 'POST', headers: auth, json: { operador: 'prueba', telefono: c.telefonoCliente } });
  comprobar(emb.status === 200 && String(emb.json.token).startsWith('emb_'), 'token del chat embebido emitido', emb.json);
  const tokenEmb = String(emb.json.token);
  const lista = await pedir(`${c.url}/api/v1/conversaciones`, { headers: { authorization: `Bearer ${tokenEmb}` } });
  const telefonos = ((lista.json.conversaciones as Array<{ telefono: string }> | undefined) ?? []).map((x) => x.telefono);
  comprobar(lista.status === 200 && telefonos.length === 1 && telefonos[0] === c.telefonoCliente, 'el token embebido ve solo su conversacion', telefonos);
  const pagina = await pedir(`${c.url}/embed/chat?telefono=${c.telefonoCliente}`);
  comprobar(pagina.status === 200 && (pagina.headers.get('content-security-policy') ?? '').startsWith("frame-ancestors 'self'"), 'la pagina embebida sale con frame-ancestors', pagina.headers.get('content-security-policy'));
  const script = await pedir(`${c.url}/embed.js`);
  comprobar(script.status === 200 && script.texto.includes(`var ORIGEN = "${c.url}"`), 'embed.js apunta al origen de ESTA tienda');

  // 5. El chat de los visitantes de la web: solo desde la web de la tienda.
  const webTienda = 'https://holamellamobroaster.nom.pe';
  const dominios = await pedir(`${c.url}/admin/ajustes`, { method: 'POST', headers: { cookie: c.cookie }, json: { embebido: { dominios: [webTienda] } } });
  comprobar(dominios.status === 200, 'se autoriza la web de la tienda para el chat', dominios.json);
  const ajena = await pedir(`${c.url}/web/sesion`, { method: 'POST', headers: { origin: 'https://otra-web.com' }, json: {} });
  comprobar(ajena.status === 403, 'otra web no puede abrir el chat (403)', ajena.status);
  const sesion = await pedir(`${c.url}/web/sesion`, { method: 'POST', headers: { origin: webTienda }, json: { nombre: 'Visitante Prueba', pagina: webTienda + '/' } });
  comprobar(sesion.status === 200 && String(sesion.json.sesion).startsWith('wvs_') && sesion.headers.get('access-control-allow-origin') === webTienda, 'un visitante abre sesion desde la web (con CORS)', sesion.json);
  const msgWeb = await pedir(`${c.url}/web/mensajes`, { method: 'POST', headers: { origin: webTienda }, json: { sesion: sesion.json.sesion, texto: 'hola desde la web' } });
  comprobar(msgWeb.status === 200, 'el visitante escribe', msgWeb.json);
  await espera(1500);
  const hist = await pedir(`${c.url}/web/historial?sesion=${encodeURIComponent(String(sesion.json.sesion))}`, { headers: { origin: webTienda } });
  const delVisitante = (hist.json.mensajes as Array<{ direccion: string; texto: string }> | undefined) ?? [];
  comprobar(hist.status === 200 && delVisitante.some((m) => m.direccion === 'yo' && m.texto === 'hola desde la web'), 'su mensaje esta en su historial', hist.json);
  const enChats = await pedir(`${c.url}/api/v1/conversaciones?q=Visitante`, { headers: auth });
  comprobar(((enChats.json.conversaciones as Array<{ nombre: string }> | undefined) ?? []).some((x) => x.nombre === 'Visitante Prueba'), 'el equipo ve al visitante en las conversaciones', enChats.json);
  const respuestaOp = await pedir(`${c.url}/admin/chat/send`, { method: 'POST', headers: { cookie: c.cookie }, json: { contactId: sesion.json.contactoId, text: 'Hola, te atiendo por aqui' } });
  comprobar(respuestaOp.status === 200 && String(respuestaOp.json.wamid ?? '').startsWith('web.out.'), 'el operador le contesta y sale por el canal web, no por WhatsApp', respuestaOp.json);
  const widget = await pedir(`${c.url}/web/widget.js`);
  comprobar(widget.status === 200 && widget.texto.includes(`var ORIGEN = "${c.url}"`), 'widget.js apunta al origen de ESTA tienda');
  const demo = await pedir(`${c.url}/web/demo`);
  comprobar(demo.status === 200 && demo.texto.includes('/web/widget.js'), 'la pagina de demostracion del chat web se sirve');

  // 6. Aislamiento: nada de esta tienda vale en las otras.
  for (const o of otras) {
    const cruzada = await pedir(`${o.url}/api/v1/estado`, { headers: auth });
    comprobar(cruzada.status === 401, `la clave de ${c.nombre} NO entra en ${o.nombre} (401)`, cruzada.status);
    const tokenCruzado = await pedir(`${o.url}/api/v1/conversaciones`, { headers: { authorization: `Bearer ${tokenEmb}` } });
    comprobar(tokenCruzado.status === 401, `el token embebido de ${c.nombre} NO entra en ${o.nombre} (401)`, tokenCruzado.status);
    const sesion = await pedir(`${o.url}/admin/yo`, { headers: { cookie: c.cookie } });
    comprobar(sesion.status === 401, `la cookie de ${c.nombre} NO entra en ${o.nombre} (401)`, sesion.status);
    const ajena = await pedir(`${o.url}/api/v1/conversaciones/${c.telefonoCliente}`, { headers: { authorization: `Bearer ${o.clave}` } });
    comprobar(ajena.status === 404 || (ajena.status === 200 && !((ajena.json.mensajes as Array<{ texto: string }>) ?? []).some((m) => m.texto.includes(c.nombre))), `${o.nombre} no tiene la conversacion de ${c.nombre}`, ajena.status);
  }
}

// -------------------------------------------------------------------- main

console.log(`SaaS en ${cfg.dominioBase}: se preparan ${TIENDAS.length} tiendas de prueba y el receptor de webhooks en el host (:${PUERTO_RECEPTOR}).`);
await prepararBase({ cfg, log: (l) => console.log(`  ${l}`) });

const contextos: Contexto[] = [];
for (const t of TIENDAS) {
  const c = await prepararTienda(t);
  if (c) contextos.push(c);
}
for (const c of contextos) {
  await probarTienda(c, contextos.filter((o) => o.slug !== c.slug));
}

console.log('\n== Estado final');
for (const i of listarInstancias().filter((x) => x.slug.startsWith('prueba-'))) console.log(`  ${i.slug.padEnd(20)} ${i.url}`);

if (limpiar) {
  console.log('\n== Limpieza');
  for (const c of contextos) await bajaInstancia(c.slug, { borrarDatos: true }, { cfg, log: (l) => console.log(`  ${l}`) });
}

receptor.close();
console.log(fallos ? `\n${fallos} comprobacion(es) fallaron.` : '\nTodo en orden.');
process.exit(fallos ? 1 : 0);
