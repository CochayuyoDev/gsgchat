// Las dos dependencias externas del etiquetado, simuladas para la coleccion
// de Postman «GSGchat - Etiquetas de chats y GSG» y para la tienda de
// demostracion (ver README.md al lado).
//
//   POST /ia/v1/chat/completions        una IA compatible con OpenAI: etiqueta
//                                        por lo ultimo que pidio el cliente.
//   POST /gsg/api/v1/gsgchat/labels      el endpoint de GSG que recibe cada
//                                        etiqueta (exige X-API-Key).
//
// Y su panel de control, para forzar fallos y comprobar lo recibido:
//   GET  /control/estado                 lo que recibio GSG y cuantas veces se llamo a la IA
//   POST /control/reset                  vacia todo y quita los fallos
//   POST /control/gsg  { fallar: { "51987...": 503 }, todos: 401 | null, fallarUnaVez: ["51987..."] }
//
// No es una IA: reconoce frases por palabras clave. Una frase con «zzz»
// devuelve una respuesta que no es JSON (para ver un «Sin clasificar»).
//
// Sin dependencias: node docs/postman/etiquetas/mock-externos.mjs [puerto]

import http from 'node:http';

const PUERTO = Number(process.argv[2] ?? process.env.PUERTO_MOCK ?? 3999);
const CLAVE_GSG = process.env.CLAVE_GSG_MOCK ?? 'clave-gsg-de-prueba-123';

let estado;
function reiniciar() {
  estado = { recibidas: [], rechazadas: [], llamadasIA: 0, fallar: {}, todos: null, fallarUnaVez: [] };
}
reiniciar();

/** De lo mas concreto a lo mas general, sobre una frase del cliente. */
const REGLAS = [
  ['pedido_no_reconocido', /no hice ningún pedido|número equivocado|no pedí nada/],
  ['cancelar_entrega', /cancel|ya no lo quiero/],
  ['reclamo', /pésimo|reclamo|demora|horas esperando|llegó roto/],
  ['problema_de_pago', /vuelto|billete|yape|me cobraron/],
  ['cambiar_ubicacion', /cambié de dirección|otra dirección|nueva dirección|ya no vivo/],
  ['reagendar_entrega', /mañana|otro día|el lunes|el sábado|no voy a estar/],
  ['fuera_de_horario', /de la noche|madrugada/],
  ['hora_limite', /antes de las/],
  ['franja_horaria', /entre las/],
  ['horario_fijo', /a las \d|en punto/],
  ['coordinar_con_tercero', /mi esposa|mi hermano|mi mamá|lo va a recibir|el portero/],
  ['solicitar_espera', /espér|ya bajo|unos minutos/],
  ['consultar_entrega', /dónde|donde|a qué hora llega|cuánto falta/],
  ['confirmar_recepcion', /ahí estaré|aquí estaré|sí, estaré|sí estoy/],
];

/** La etiqueta segun lo que pidio el cliente al final (las lineas «[cliente ...]: »). */
function etiquetaPara(transcripcion) {
  const delCliente = String(transcripcion)
    .split('\n')
    .filter((l) => l.startsWith('[cliente'))
    .map((l) => l.slice(l.indexOf(']:') + 2).trim().toLowerCase());
  const pines = delCliente.filter((l) => l === '[ubicación]').length;
  const textos = delCliente.filter((l) => l !== '[ubicación]');
  // Termina con dos pines o mas: si dijo que cambia la direccion, es un cambio; si no, no se sabe cual usar.
  if (pines >= 2 && delCliente.slice(-2).every((l) => l === '[ubicación]')) {
    return textos.some((t) => /cambié de dirección|otra dirección|nueva dirección/.test(t)) ? 'cambiar_ubicacion' : 'ubicaciones_multiples';
  }
  for (let i = textos.length - 1; i >= 0; i--) {
    if (/^(gracias|ok|ya recibí.*|listo)[.! ]*$/.test(textos[i])) continue;
    for (const [etiqueta, patron] of REGLAS) if (patron.test(textos[i])) return etiqueta;
  }
  return 'otro';
}

function leer(req) {
  return new Promise((ok) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      try {
        ok(datos ? JSON.parse(datos) : {});
      } catch {
        ok({ __crudo: datos });
      }
    });
  });
}

function json(res, status, cuerpo) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

const servidor = http.createServer(async (req, res) => {
  const ruta = (req.url ?? '/').split('?')[0];
  const cuerpo = req.method === 'POST' ? await leer(req) : {};

  if (req.method === 'POST' && ruta === '/ia/v1/chat/completions') {
    estado.llamadasIA++;
    const mensajes = Array.isArray(cuerpo.messages) ? cuerpo.messages : [];
    const sistema = String(mensajes[0]?.content ?? '');
    const usuario = String(mensajes.at(-1)?.content ?? '');
    let contenido = 'Listo.';
    // Solo el clasificador pide {"etiqueta":...}; a cualquier otra cosa se le contesta corto.
    if (/\{"etiqueta":"una_sola_etiqueta"\}/.test(sistema)) contenido = /zzz/i.test(usuario) ? 'no sabría decirte' : JSON.stringify({ etiqueta: etiquetaPara(usuario) });
    return json(res, 200, { id: `chatcmpl-${estado.llamadasIA}`, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: contenido }, finish_reason: 'stop' }] });
  }

  if (req.method === 'POST' && ruta === '/gsg/api/v1/gsgchat/labels') {
    const llegada = { telefono: cuerpo.telefono, cuerpo, idempotencyKey: req.headers['idempotency-key'] ?? null, conClave: req.headers['x-api-key'] === CLAVE_GSG, en: new Date().toISOString() };
    if (req.headers['x-api-key'] !== CLAVE_GSG) {
      estado.rechazadas.push({ ...llegada, status: 401 });
      return json(res, 401, { ok: false, error: 'API Key incorrecta' });
    }
    let status = estado.todos ?? estado.fallar[cuerpo.telefono];
    if (!status && estado.fallarUnaVez.includes(cuerpo.telefono)) {
      estado.fallarUnaVez = estado.fallarUnaVez.filter((t) => t !== cuerpo.telefono);
      status = 503;
    }
    if (status) {
      estado.rechazadas.push({ ...llegada, status });
      return json(res, status, { ok: false, error: `fallo simulado ${status}` });
    }
    estado.recibidas.push(llegada);
    return json(res, 201, { ok: true, id: `LBL-${estado.recibidas.length}` });
  }

  if (req.method === 'GET' && ruta === '/control/estado') return json(res, 200, estado);
  if (req.method === 'POST' && ruta === '/control/reset') {
    reiniciar();
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && ruta === '/control/gsg') {
    estado.fallar = cuerpo.fallar ?? {};
    estado.todos = cuerpo.todos ?? null;
    estado.fallarUnaVez = Array.isArray(cuerpo.fallarUnaVez) ? cuerpo.fallarUnaVez : [];
    return json(res, 200, { ok: true, fallar: estado.fallar, todos: estado.todos, fallarUnaVez: estado.fallarUnaVez });
  }
  return json(res, 404, { error: `no existe ${req.method} ${ruta}` });
});

servidor.listen(PUERTO, '127.0.0.1', () => console.log(`mock de IA y GSG en http://127.0.0.1:${PUERTO}`));
