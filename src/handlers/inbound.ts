/**
 * Logica de conversacion sobre los mensajes entrantes.
 *
 * Aqui se conecta el geo core con WhatsApp y con la automatizacion. El
 * orden de preferencia importa:
 *
 *  1. ubicacion nativa: no hay nada que parsear y la coordenada es exacta;
 *  2. botones de confirmacion de una ubicacion dudosa;
 *  3. palabras de baja y alta (no admiten excepciones);
 *  4. reglas de respuesta automatica por palabra clave;
 *  5. coordenadas dentro del texto (links de mapas, DMS, plus codes...);
 *  6. bienvenida o comodin, si hay regla; si no, el boton nativo para pedir
 *     la ubicacion (configurable).
 *
 * Ademas, cualquier mensaje del cliente cuenta como respuesta: las
 * secuencias de seguimiento con `stopOnReply` se cancelan.
 */

import { esperarRafaga } from './rafaga.js';
import { TEXTO_VER_UNA_VEZ } from './textos.js';
import { extractLocation, fromWhatsAppLocation } from '../geo/extract.js';
import type { Config } from '../config.js';
import type { Monitor } from '../salud/monitor.js';
import type { ServicioAjustes } from '../ajustes/generales.js';
import type { ServicioStickers } from '../stickers/stickers.js';
import type { ServicioIA } from '../ia/servicio.js';
import type { ServicioVoz } from '../voz/servicio.js';
import type { ServicioEnvioAutomatico } from '../envio-automatico/servicio.js';
import { numeroPermitido } from '../salud/lista-blanca.js';
import type { Contact, Repos } from '../db/repos.js';
import type { AutoReply } from '../db/automation.js';
import type { Sender } from '../outbound/sender.js';
import type { AnuncioEntrada, InboundMessage } from '../whatsapp/types.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { ExtractionSuccess, FailureReason } from '../types.js';
import {
  intencionDe,
  responder,
  textoDePregunta,
  type Contexto as ContextoPreventa,
  type Entrada as EntradaPreventa,
} from '../preventa/flow.js';
import { saludoPorHora } from '../automation/engine.js';
import { mensajesVigentes, render } from '../preventa/mensajes.js';
import {
  coincideDelTodo,
  etiquetaVariante,
  pareceConsultaDeProducto,
  pareceVarianteSuelta,
  type ProductoStoky,
  type StokyClient,
} from '../stoky/client.js';
import type { MessageKind } from '../db/messages.js';
import { enrollContact, matchRule, onInboundReply, renderPlaceholders } from '../automation/engine.js';

import { atenderRespuestaDeRuta, type RespuestaRuta } from '../rutas/inbound.js';
import { crearPuertoEnEspera, type PuertoGsg } from '../rutas/gsg.js';
import { textoFueraDeZona, textoGracias } from '../rutas/mensajes.js';
import { hayCatalogo } from '../stoky/conexion.js';

export interface InboundDeps {
  repos: Repos;
  sender: Sender;
  wa: WhatsAppClient;
  config: Config;
  /**
   * El catalogo de Stoky, si esta conectado.
   *
   * Opcional a proposito: sin el, el asistente hace todo lo demas y
   * simplemente no cotiza precios. Una integracion caida no puede dejar sin
   * atender a quien escribe.
   */
  catalogo?: StokyClient;
  /**
   * La puerta al sistema de GSG, para el modulo de rutas.
   *
   * Opcional: sin ella el sistema atiende igual y los reportes se quedan en
   * la cola, que es como funciona mientras GSG no publique su API.
   */
  gsg?: PuertoGsg;
  /**
   * El monitor de salud del numero. Opcional: sin el, las senales que salen
   * de la conversacion (quejas, "no soy yo") simplemente no se apuntan.
   */
  salud?: Monitor;
  /** Los ajustes generales (modo prueba, nombre del negocio) cambiados desde la pantalla. */
  ajustes?: ServicioAjustes;
  /** Los stickers automaticos. Ver src/stickers. */
  stickers?: ServicioStickers;
  /**
   * El asistente de IA de la tienda. Ver src/ia.
   *
   * Cuando esta activo contesta el texto libre en lugar del flujo de
   * preventa y de las reglas genericas; lo que es de ubicacion, baja/alta y
   * el reparto sigue igual, porque eso no es conversacion.
   */
  ia?: ServicioIA;
  /**
   * La lista de envio automatico. Ver src/envio-automatico.
   *
   * Un mensaje del cliente puede ser justo lo que la lista esperaba de el
   * (su ubicacion, una respuesta): entonces sale de la lista y no se le
   * insiste mas.
   */
  lista?: ServicioEnvioAutomatico;
  /**
   * La voz (ver src/voz): una nota de voz del cliente se transcribe al
   * llegar y se atiende como texto; sin ella, a un audio se le pide el
   * texto, como siempre.
   */
  voz?: ServicioVoz;
  /**
   * Cuanto se espera a que el cliente termine de escribir, en ms.
   *
   * Quien escribe por WhatsApp lo hace en trozos, y contestar a cada trozo
   * le manda dos o tres mensajes seguidos sin que el haya dicho nada en
   * medio. Ver src/handlers/rafaga.ts.
   *
   * Sin valor no se espera nada: es lo que quieren las pruebas.
   */
  rafagaMs?: number;
  /**
   * Cuanto se espera a que el telefono reenvie un "ver una vez" antes de
   * darlo por imposible y pedirle al cliente que lo mande normal, en ms.
   * Baileys tarda 2 s en pedirlo y le da 8 s al telefono para contestar.
   */
  verUnaVezEsperaMs?: number;
  /** Inyectable para que las pruebas no esperen de verdad. */
  dormir?: (ms: number) => Promise<void>;
}

const dormirDeVerdad = (ms: number) => new Promise<void>((listo) => setTimeout(listo, ms));

export const CONFIRM_PREFIX = 'loc_ok:';
export const REJECT_ID = 'loc_no';

const normalize = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    // Quita los diacriticos combinantes: "BAJA", "bajá" y "Bajá" son la misma baja.
    .replace(/[̀-ͯ]/g, '');

function matchesKeyword(text: string, keywords: string[]): boolean {
  const clean = normalize(text);
  return keywords.some((k) => clean === k || clean.startsWith(`${k} `));
}

function describe(result: ExtractionSuccess): string {
  return `${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`;
}

/**
 * Como se guarda un entrante en la conversacion.
 *
 * Los tipos que el bot no sabe atender (una foto, un audio, un contacto
 * compartido) igual se anotan: en el chat el operador tiene que VER que el
 * cliente mando algo, aunque el sistema no pueda responderlo solo.
 */
export function readInbound(message: InboundMessage): { kind: MessageKind; body: string; payload: Record<string, unknown> | null } {
  const leido = leerContenido(message);
  // En un grupo importa quien lo dijo: va en el payload para que el chat lo
  // pinte encima del globo, y el cuerpo queda limpio para la lista y la IA.
  if (message.grupo) {
    const autor = { telefono: message.grupo.autor, nombre: message.grupo.autorNombre?.trim() || null };
    return { ...leido, payload: { ...(leido.payload ?? {}), autor } };
  }
  return leido;
}

function leerContenido(message: InboundMessage): { kind: MessageKind; body: string; payload: Record<string, unknown> | null } {
  if (message.type === 'location' && message.location) {
    const { latitude, longitude, name } = message.location;
    return {
      kind: 'location',
      body: `Ubicacion: ${name ? `${name} — ` : ''}${latitude}, ${longitude}`,
      payload: { location: message.location },
    };
  }
  if (message.type === 'interactive' && message.interactive) {
    const reply = message.interactive.button_reply ?? message.interactive.list_reply;
    return {
      kind: 'interactive',
      body: reply?.title ?? '(respuesta a un boton)',
      payload: { interactive: message.interactive },
    };
  }
  if (message.button?.text) {
    return { kind: 'interactive', body: message.button.text, payload: { button: message.button } };
  }
  if (message.text?.body) {
    const anuncio = anuncioDelMensaje(message);
    return { kind: 'text', body: message.text.body, payload: anuncio ? { anuncio } : null };
  }
  if (message.type === 'reaction' && message.reaction) {
    return { kind: 'unknown', body: `${message.reaction.emoji} (reacción a un mensaje)`, payload: { reaction: message.reaction } };
  }
  if (message.type === 'view_once' && message.viewOnce) {
    const nombres: Record<string, string> = { image: 'Foto', video: 'Video', audio: 'Audio', document: 'Archivo' };
    const que = nombres[message.viewOnce.kind] ?? 'Foto o video';
    return {
      kind: 'unknown',
      body:
        `👁 ${que} de "ver una vez": WhatsApp solo la entrega al teléfono, no a los dispositivos vinculados como este. ` +
        'Ábrela en el teléfono o pídele al cliente que la mande como foto normal.',
      payload: { viewOnce: message.viewOnce },
    };
  }
  const known: MessageKind[] = ['image', 'audio', 'video', 'document', 'sticker'];
  const kind = (known as string[]).includes(message.type) ? (message.type as MessageKind) : 'unknown';
  const etiquetas: Record<string, string> = {
    image: '(foto)',
    audio: '(audio)',
    video: '(video)',
    document: '(documento)',
    sticker: '(sticker)',
  };

  // Con el fichero ya bajado, el cuerpo es el pie de foto (o el nombre del
  // documento) y la referencia va al payload para que el chat lo pinte.
  if (message.media) {
    // Un audio transcrito se lee: el cuerpo es lo que dijo, y queda aparte
    // en el payload para que el chat, la API y el webhook lo distingan.
    const transcripcion = message.media.transcripcion?.trim();
    const cuerpo = transcripcion || message.media.caption?.trim() || message.media.filename || etiquetas[kind] || '(adjunto)';
    const anuncio = anuncioDelMensaje(message);
    return {
      kind,
      // Que se lea tambien en la lista de chats y en los respaldos, donde
      // no se pinta la foto.
      body: message.media.verUnaVez ? `${cuerpo} · ver una vez` : cuerpo,
      payload: { media: message.media, ...(transcripcion ? { transcripcion } : {}), ...(anuncio ? { anuncio } : {}) },
    };
  }

  return { kind, body: etiquetas[kind] ?? `(mensaje de tipo ${message.type})`, payload: null };
}

/**
 * El anuncio del que viene el mensaje, con la misma forma venga de donde
 * venga: el cliente local ya lo trae como `anuncio`; Meta lo manda como
 * `referral` y aqui se traduce.
 */
export function anuncioDelMensaje(message: InboundMessage): AnuncioEntrada | null {
  if (message.anuncio) return message.anuncio;
  const r = message.referral;
  if (!r) return null;
  return {
    id: r.source_id || null,
    titulo: r.headline || null,
    texto: r.body || null,
    url: r.source_url || null,
    imagen: r.image_url || r.thumbnail_url || null,
    clid: r.ctwa_clid || null,
    origen: r.source_type ? r.source_type.toLowerCase() : 'ad',
  };
}

/**
 * Un turno de la conversacion de preventa.
 *
 * El flujo decide (funcion pura, `src/preventa/flow.ts`); aqui solo se guarda
 * lo que dijo y se manda lo que contesto. Como mucho un mensaje de salida:
 * esa es la regla que evita que el cliente reciba tres cosas seguidas.
 */
export async function turnoDePreventa(
  contact: Contact,
  entrada: EntradaPreventa,
  deps: InboundDeps,
): Promise<void> {
  const { repos, sender, config } = deps;

  const [lead, prefs] = await Promise.all([
    repos.leads.ensure(contact.id, contact.name),
    repos.automation.getPrefs(),
  ]);

  // Una consulta de precio se contesta con el catalogo y NO sigue al flujo:
  // dos respuestas por un mensaje es justo lo que no puede pasar.
  if (await contestarPrecio(contact, entrada, lead, prefs, deps)) return;

  const { patch, respuesta } = responder(lead, entrada, {
    negocio: nombreNegocio(deps),
    cobertura: config.coverageName || 'tu zona',
    saludo: saludoPorHora(new Date(), config.timezone),
    horario: config.businessHours,
    servicios: prefs.serviciosPreventa,
    mensajes: prefs.mensajesPreventa,
    distritos: config.distritos,
  });

  if (Object.keys(patch).length) await repos.leads.update(contact.id, patch);
  if (!respuesta) return;

  // El sticker que acompaña: al saludo la primera vez, y al cerrar la ficha.
  const adorno = async (salida: { ok: boolean }) => {
    if (!salida.ok || !deps.stickers) return;
    if (entrada.esPrimerMensaje) await deps.stickers.automatico('inicio', contact.phone);
    else if (patch.estado === 'calificado') await deps.stickers.automatico('gracias', contact.phone);
  };

  if (respuesta.pedirUbicacion) {
    await adorno(
      await sender.send({
        phone: contact.phone,
        kind: 'interactive',
        category: 'UTILITY',
        interactive: { body: respuesta.texto, locationRequest: true },
      }),
    );
    return;
  }

  if (respuesta.botones?.length) {
    await adorno(
      await sender.send({
        phone: contact.phone,
        kind: 'interactive',
        category: 'UTILITY',
        interactive: { body: respuesta.texto, buttons: respuesta.botones },
      }),
    );
    return;
  }

  await adorno(
    await sender.send({
      phone: contact.phone,
      kind: 'freeform',
      category: 'UTILITY',
      text: respuesta.texto,
    }),
  );
}

/**
 * Contesta una consulta de precio con el catalogo de Stoky.
 *
 * Devuelve true si contesto, para que el flujo no anada una segunda respuesta.
 *
 * Lo que decide si la pregunta es de producto es el propio catalogo: "cuanto
 * cuesta el zapato negro" encuentra algo y se contesta con precios; "cuanto
 * cuesta mandar un paquete" no encuentra nada y sigue al flujo, que lo trata
 * como una peticion de cotizacion. Adivinar la intencion con palabras sueltas
 * confundiria las dos.
 */
async function contestarPrecio(
  contact: Contact,
  entrada: EntradaPreventa,
  lead: {
    estado: string;
    preguntaPendiente: string | null;
    ultimasOpciones: string[] | null;
    ultimoProducto: string | null;
  },
  prefs: { mensajesPreventa?: Record<string, string>; serviciosPreventa?: string[] },
  deps: InboundDeps,
): Promise<boolean> {
  const { sender, config, catalogo } = deps;
  const overrides = prefs.mensajesPreventa;
  const texto = entrada.texto.trim();

  if (!texto || !hayCatalogo(catalogo)) return false;
  // En manos de una persona el bot no se mete, ni para dar un precio.
  if (lead.estado === 'calificado' || lead.estado === 'enviado') return false;

  // A "¿que vas a enviar?" un nombre de producto ES la respuesta, no una
  // consulta de precio: ahi el catalogo tiene que callarse. En las demas
  // preguntas -de que distrito, a nombre de quien- un producto no es una
  // respuesta posible, asi que preguntar el precio a mitad vale.
  //
  // Sin esta distincion pasa una de dos, y las dos son malas: o el cliente no
  // puede preguntar un precio en cuanto empieza a cotizar, o "cuanto cuesta el
  // arroz" acaba guardado como su distrito de recojo.
  if (lead.preguntaPendiente === 'contenido') return false;

  // Y lo que el flujo ya reconoce manda sobre el catalogo. "Quiero cotizar"
  // lleva "quiero", pero no esta preguntando por ningun producto: sin esta
  // guarda, pedir una cotizacion contestaba "ese producto no esta disponible".
  if (intencionDe(entrada, lead.ultimasOpciones)) return false;

  const vigentes = mensajesVigentes(overrides ?? {});
  const decir = async (clave: string): Promise<boolean> => {
    await sender.send({
      phone: contact.phone,
      kind: 'freeform',
      category: 'UTILITY',
      manual: false,
      text: render(vigentes[clave] ?? '', {
        saludo: saludoPorHora(new Date(), config.timezone),
        negocio: nombreNegocio(deps),
        cobertura: config.coverageName || 'tu zona',
        horario: config.businessHours,
      }),
    });
    return true;
  };

  // Si TIENE SENTIDO contestarle que no lo hay. "hola" no pregunta por nada;
  // "cuanto cuesta mandar un paquete" pregunta por un envio, no por un
  // producto. Sin esta distincion, cualquier mensaje suelto recibiria un "ese
  // producto no esta disponible" y el bot pareceria sordo.
  // "talla 41" a secas pregunta por el producto del que se acaba de hablar.
  // Sin esta memoria, el cliente que afina su pregunta despues de ver el
  // precio se llevaba un "de que distrito recogemos el envio".
  const seguimiento = !!lead.ultimoProducto && pareceVarianteSuelta(texto);
  const consultado = seguimiento ? `${lead.ultimoProducto} ${texto}` : texto;

  const preguntaPorProducto = seguimiento || pareceConsultaDeProducto(texto);

  let consulta: {
    disponibles: ProductoStoky[];
    agotados: ProductoStoky[];
    similares: ProductoStoky[];
    otrasVariantes: ProductoStoky[];
  };
  try {
    consulta = await catalogo.consultar(consultado);
  } catch {
    // Stoky caido: callarse deja al cliente esperando una respuesta que no va
    // a llegar, asi que se le pasa a una persona.
    return preguntaPorProducto ? decir('precioSinCatalogo') : false;
  }

  const { disponibles, agotados, similares, otrasVariantes } = consulta;
  if (!disponibles.length && !agotados.length) {
    return preguntaPorProducto ? decir('precioSinResultado') : false;
  }

  const sustituciones = {
    saludo: saludoPorHora(new Date(), config.timezone),
    negocio: nombreNegocio(deps),
    cobertura: config.coverageName || 'tu zona',
    horario: config.businessHours,
    // Lo que pidio, para poder decirle "en talla 41 no lo tengo" con sus
    // propias palabras en vez de un "no tengo exactamente eso".
    variante: texto,
  };

  // El precio se dice SIEMPRE, tambien de lo agotado: el cliente pregunto
  // cuanto cuesta y saberlo le sirve igual para decidir si espera. Lo que no
  // se dice nunca es cuantas unidades quedan: invita a regatear y a dudar.
  const precioDe = (p: ProductoStoky) =>
    p.price == null ? 'consultar' : `S/ ${p.price.toFixed(2)}`;

  /**
   * Un grupo de productos, agrupando las variantes bajo su producto.
   *
   * Cuatro lineas repitiendo "Zapato de vestir clasico" y cambiando solo el
   * color se leen fatal en un chat. Se dice el producto una vez, con su
   * precio, y debajo en que presentaciones lo hay; si todas cuestan lo mismo
   * el precio va una sola vez, y si no, cada una lleva el suyo.
   */
  const bloque = (productos: ProductoStoky[], hay = true): string => {
    // Lo agotado se nombra entero, sin agrupar: decir "Hay en: NEGRO / 40"
    // debajo de "estamos sin stock" es exactamente lo contrario de lo que
    // pasa. Ahi el cliente necesita leer QUE es lo que no hay.
    if (!hay) {
      return productos.map((p) => `• ${p.name} — ${precioDe(p)}`).join('\n');
    }

    const familias = new Map<string, ProductoStoky[]>();
    for (const p of productos) {
      const clave = p.product?.trim() || p.name;
      familias.set(clave, [...(familias.get(clave) ?? []), p]);
    }

    return [...familias.entries()]
      .map(([base, items]) => {
        const variantes = items.map((p) => etiquetaVariante(p)).filter((v): v is string => !!v);

        if (!variantes.length) {
          // Sin variantes: el producto, su precio, y ya.
          return items.map((p) => `• ${p.name} — ${precioDe(p)}`).join('\n');
        }

        const precios = new Set(items.map((p) => precioDe(p)));
        if (precios.size === 1) {
          return `• ${base} — ${[...precios][0]}\n  Hay en: ${variantes.join(', ')}`;
        }

        // Precios distintos por variante: cada una con el suyo, o el cliente
        // se queda con el primero que leyo y luego no cuadra.
        return `• ${base}\n${items
          .map((p) => `  ${etiquetaVariante(p) ?? p.name}: ${precioDe(p)}`)
          .join('\n')}`;
      })
      .join('\n');
  };

  // Contestar "Casaca de cuero" a quien preguntó por una casaca impermeable
  // con el mismo aplomo que si fuera esa es el fallo caro: el cliente cree que
  // le cotizaron lo que pidió. Si no coincide del todo, se dice.
  const mostrados = disponibles.length ? disponibles : agotados;
  const exacto = mostrados.some((p) => coincideDelTodo(p, consultado));

  const partes: string[] = [];

  if (disponibles.length) {
    // Al que pregunto "talla 41" hay que decirle que en talla 41 no hay, no
    // un "no tengo exactamente eso" que le deja sin saber si la 41 entra o
    // no en la lista que viene debajo.
    const encabezado = exacto
      ? vigentes.precioEncontrado
      : seguimiento
        ? vigentes.precioVarianteNoHay
        : vigentes.precioAproximado;

    partes.push(render(encabezado ?? '', sustituciones));
    partes.push(bloque(disponibles));
  } else {
    // Agotado: se dice con su precio, y se ofrece algo parecido SOLO si
    // existe. Recomendar cuando no hay nada que se le parezca hace perder el
    // tiempo al cliente mirando algo que no queria.
    partes.push(render(vigentes.precioAgotado ?? '', sustituciones));
    partes.push(bloque(agotados, false));

    if (otrasVariantes.length) {
      // Otra talla o otro color del MISMO producto: es lo que suele cerrar la
      // venta, y por eso va antes que cualquier otra recomendacion.
      partes.push(render(vigentes.precioOtrasVariantes ?? '', sustituciones));
      partes.push(bloque(otrasVariantes));
    } else if (similares.length) {
      partes.push(render(vigentes.precioSimilares ?? '', sustituciones));
      partes.push(bloque(similares));
    } else {
      partes.push(render(vigentes.precioSinAlternativas ?? '', sustituciones));
    }
  }

  // Si estaba a mitad de una pregunta, se repite al pie: contestar el precio
  // y dejar la conversacion colgada obliga al cliente a adivinar por donde
  // iban. Y va en el MISMO mensaje, que dos seguidos son dos mensajes por uno.
  const pendiente = lead.preguntaPendiente
    ? preguntaPendienteTexto(lead.preguntaPendiente, {
        negocio: nombreNegocio(deps),
        cobertura: config.coverageName || 'tu zona',
        saludo: sustituciones.saludo,
        horario: config.businessHours,
        servicios: prefs.serviciosPreventa,
        mensajes: overrides,
      })
    : '';

  if (pendiente) partes.push(pendiente);

  await sender.send({
    phone: contact.phone,
    kind: 'freeform',
    category: 'UTILITY',
    manual: false,
    text: partes.filter(Boolean).join('\n\n'),
  });

  // De que producto se hablo, para poder leer el "talla 41" que venga
  // despues. Se guarda el nombre base y no la variante: la pregunta de
  // seguimiento suele ser justo para cambiar de variante.
  const hablado = (mostrados[0]?.product || mostrados[0]?.name || '').trim();
  if (hablado && hablado !== lead.ultimoProducto) {
    await deps.repos.leads.update(contact.id, { ultimoProducto: hablado });
  }

  return true;
}

/**
 * El texto de la pregunta que estaba esperando respuesta.
 *
 * Se saca del propio flujo para no tener los mismos textos escritos en dos
 * sitios: si la tienda reescribe "¿de que distrito recogemos?", tiene que
 * cambiar tambien aqui.
 */
function preguntaPendienteTexto(campo: string, ctx: ContextoPreventa): string {
  return textoDePregunta(campo, ctx);
}

/** Aplica una regla: responde si tiene texto e inscribe si apunta a una secuencia. */
async function applyRule(rule: AutoReply, contact: Contact, deps: InboundDeps): Promise<void> {
  const { repos, sender } = deps;
  if (rule.reply?.trim()) {
    await sender.send({
      phone: contact.phone,
      kind: 'freeform',
      category: 'UTILITY',
      text: renderPlaceholders(rule.reply, contact, new Date(), deps.config.timezone),
    });
  }
  if (rule.sequenceId) {
    const sequence = await repos.automation.getSequence(rule.sequenceId);
    if (sequence?.enabled) {
      await enrollContact({ repos, sender }, sequence, contact, `regla: ${rule.name}`);
    }
  }
}

export async function handleInboundMessage(
  message: InboundMessage,
  profileName: string | undefined,
  deps: InboundDeps,
): Promise<void> {
  const { repos, sender, wa, config } = deps;
  const phone = message.from;
  const receivedAt = new Date(Number(message.timestamp) * 1000 || Date.now());

  // Un grupo de WhatsApp: se guarda y se ensena, y nada mas. Ni el asistente,
  // ni las reglas, ni el reparto, ni el acuse de lectura: un automatismo que
  // contesta en un grupo le escribe a todos los que estan dentro.
  if (message.grupo) {
    if (message.type === 'revoke' && message.revoca) {
      await repos.messages.marcarBorradoPorRemitente(message.revoca, receivedAt);
      return;
    }
    const grupo = await repos.contacts.upsertGrupo(message.grupo.jid, message.grupo.nombre ?? profileName ?? null);
    const leidoGrupo = readInbound(message);
    if (message.reenvio) {
      await repos.messages.completarPorWamid(message.id, leidoGrupo);
      if (await repos.messages.existsByWamid(message.id)) return;
    }
    await repos.messages.add({
      contactId: grupo.id,
      direction: 'in',
      wamid: message.id,
      kind: leidoGrupo.kind,
      body: leidoGrupo.body,
      payload: leidoGrupo.payload,
      createdAt: receivedAt,
    });
    if (!message.viejo) await repos.contacts.touchInbound(grupo.phone, receivedAt);
    return;
  }

  // "Eliminar para todos": no se borra nada, se marca el original y se acaba.
  // No es un mensaje del cliente: no abre ventana, no se contesta.
  if (message.type === 'revoke' && message.revoca) {
    await repos.messages.marcarBorradoPorRemitente(message.revoca, receivedAt);
    return;
  }

  const contact = await repos.contacts.upsertFromInbound(phone, profileName);
  // Antes de anotar el entrante: asi se sabe si es el primer mensaje.
  const isFirstMessage = !contact.lastInboundAt;
  let leido = readInbound(message);

  // La segunda entrega de un mensaje que llego vacio (el telefono reenvio un
  // "ver una vez"): se completa la fila que ya existe con la foto y se acaba.
  // El primer paso ya decidio que contestar; este solo trae el fichero.
  if (message.reenvio) {
    const completado = await repos.messages.completarPorWamid(message.id, leido);
    if (completado || (await repos.messages.existsByWamid(message.id))) return;
    // Nunca llego el sobre (se perdio, o el sistema arranco despues): se
    // guarda como un adjunto normal, sin contestar nada.
    await repos.messages.add({ contactId: contact.id, direction: 'in', wamid: message.id, kind: leido.kind, body: leido.body, payload: leido.payload, createdAt: receivedAt });
    return;
  }

  // Lo que ya se atendio (WhatsApp Web lo reentrega tras un reinicio) y lo
  // que llega del historial se guarda en el hilo y nada mas: contestar a un
  // mensaje de hace horas, y a veinte de golpe, es escribirle a media
  // libreta sin que nadie lo pidiera.
  const yaVisto = message.id ? await repos.messages.existsByWamid(message.id) : false;
  if (message.viejo || yaVisto) {
    await repos.messages.add({
      contactId: contact.id,
      direction: 'in',
      wamid: message.id,
      kind: leido.kind,
      body: leido.body,
      payload: message.historial ? { ...(leido.payload ?? {}), historial: true } : leido.payload,
      createdAt: receivedAt,
    });
    return;
  }

  // Una nota de voz se transcribe ANTES de guardarla: asi el hilo, la API y
  // el webhook llevan lo que dijo, y el asistente la atiende como texto. Lo
  // viejo y lo reentregado (arriba) no se transcribe: no se gasta cuota en
  // audios que nadie va a contestar.
  if (message.type === 'audio' && message.media?.id && !message.media.transcripcion && deps.voz?.puedeTranscribir()) {
    const transcripcion = await deps.voz.transcribirGuardado(message.media.id, message.media.mimeType).catch(() => null);
    if (transcripcion) {
      message.media.transcripcion = transcripcion;
      leido = readInbound(message);
    }
  }

  // El entrante abre la ventana de servicio de 24 h: sin esto el sender
  // creeria que toda respuesta necesita plantilla.
  await repos.contacts.touchInbound(phone, receivedAt);
  contact.lastInboundAt = receivedAt;

  // La conversacion se guarda ANTES de decidir que hacer con el mensaje: si
  // el bot no sabe atenderlo, el operador tiene que verlo igual en el chat.
  await repos.messages.add({
    contactId: contact.id,
    direction: 'in',
    wamid: message.id,
    kind: leido.kind,
    body: leido.body,
    payload: leido.payload,
    createdAt: receivedAt,
  });

  // La lista de envio automatico se entera de que contesto: si era lo que
  // se buscaba (su ubicacion, una respuesta), sale de la lista aqui mismo.
  // Va antes de la rafaga y de la pausa del bot a proposito: contestar es
  // contestar, aunque el sistema despues se calle.
  if (deps.lista) {
    await deps.lista.alRecibir(contact, { ubicacion: message.type === 'location' && Boolean(message.location) }).catch(() => undefined);
  }

  // Si sigue escribiendo, se espera: una rafaga se contesta UNA vez, a lo
  // ultimo que dijo. Va despues de guardar el mensaje -el hilo los tiene
  // todos- y antes de cualquier automatismo.
  if (!(await esperarRafaga(contact.id, deps.rafagaMs ?? 0))) return;

  // El operador paro el bot en ESTE chat: se atiende a mano.
  //
  // Va aqui, despues de guardar el mensaje y antes de cualquier automatismo,
  // porque "parar el bot" son TODAS las respuestas automaticas: el asistente
  // de preventa, las reglas por palabra clave, el fallback de ubicacion, el
  // motor de rutas y los stickers. Callar solo una deja al operador creyendo
  // que tiene la conversacion para el mientras el sistema sigue hablando.
  if (contact.botPausadoAt) return;

  // Modo prueba (SOLO_NUMEROS): a quien no este en la lista no se le contesta
  // nada, ni siquiera desde el asistente. El sender lo bloquea igual, pero
  // aqui se corta antes para no dejar rastro de "intentos" en la ficha.
  if (!numeroPermitido({ soloNumeros: deps.ajustes ? deps.ajustes.soloNumeros() : config.soloNumeros }, phone)) return;

  // Acuse de lectura: mejora la percepcion y no cuesta cuota.
  await wa.markAsRead(message.id).catch(() => undefined);

  // Cualquier mensaje del cliente es una respuesta: corta los seguimientos
  // que estaban esperando precisamente eso.
  await onInboundReply(repos, contact);

  /**
   * Lo que el cliente contesta cuando se le pidio la ubicacion para un
   * reparto.
   *
   * Va por delante de todo lo demas -preventa, reglas- porque es lo que ese
   * cliente esta respondiendo: tiene un mensaje nuestro de hace un rato
   * pidiendole exactamente esto. Si no tiene ninguna solicitud abierta,
   * devuelve `atendida: false` y el mensaje sigue su camino de siempre.
   */
  const rutasDeps = { repos, gsg: deps.gsg ?? crearPuertoEnEspera(), salud: deps.salud };
  const contestarRuta = async (respuesta: RespuestaRuta): Promise<boolean> => {
    if (!respuesta.atendida) return false;
    if (respuesta.resultado === 'resuelta') {
      await reply(
        textoGracias({
          negocio: nombreNegocio(deps),
          referencia: respuesta.solicitud?.referencia,
        }),
      );
      if (deps.stickers) await deps.stickers.automatico('gracias', phone);
      return true;
    }
    if (respuesta.resultado === 'fuera_de_zona') {
      await reply(textoFueraDeZona(config.coverageName));
      return true;
    }
    if (respuesta.responder) await reply(respuesta.responder);
    // Sin texto que contestar: el siguiente mensaje lo manda el motor con su
    // ritmo. Contestar aqui seria escribir tan rapido como llegan las
    // respuestas, que es justo lo que dispara los bloqueos.
    return true;
  };

  /**
   * Por que no se pudo usar una ubicacion, en cristiano.
   *
   * Todos los fallos daban el mismo "no pude leer esa ubicacion", y el mas
   * comun de todos -la caja geografica- no tiene nada que ver con leerla: la
   * ubicacion se leyo perfectamente, lo que pasa es que cae fuera de la zona
   * configurada. Con el mensaje generico, el operador ve a un cliente
   * mandando su pin una y otra vez sin saber que el problema es GEO_BBOX.
   */
  const explicarFallo = (reason: FailureReason): string => {
    switch (reason) {
      case 'outside_bbox':
        return config.coverageName
          ? `Esa ubicación queda fuera de nuestra cobertura. Atendemos ${config.coverageName}.`
          : 'Esa ubicacion queda fuera de la zona que atendemos.';
      case 'null_island':
      case 'out_of_range':
        return 'Esas coordenadas no son válidas. Inténtala enviar de nuevo, por favor.';
      case 'short_link_unresolved':
        return 'No pude abrir ese link de mapa. Mándame el pin de ubicación, por favor.';
      default:
        return 'No pude leer esa ubicación. Intenta enviarla de nuevo, por favor.';
    }
  };

  const reply = (text: string) =>
    sender.send({ phone, kind: 'freeform', category: 'UTILITY', text });

  const askForLocation = (body: string) =>
    sender.send({
      phone,
      kind: 'interactive',
      category: 'UTILITY',
      interactive: { body, locationRequest: true },
    });

  // --- ubicacion nativa: el camino bueno -------------------------------
  if (message.type === 'location' && message.location) {
    const result = fromWhatsAppLocation(message.location, { bbox: config.bbox });
    if (!result.ok) {
      // Fuera de cobertura con una solicitud abierta: la ubicacion llego, lo
      // que falla es la zona. Es una incidencia para GSG, no un "no te
      // entendi".
      if (result.reason === 'outside_bbox') {
        if (deps.lista) await deps.lista.alRecibir(contact, { ubicacion: true, fueraDeZona: true }).catch(() => undefined);
        const enRuta = await atenderRespuestaDeRuta(rutasDeps, contact, {
          ubicacion: {
            lat: message.location.latitude,
            lng: message.location.longitude,
            fuente: 'pin de whatsapp',
          },
          fueraDeZona: true,
        });
        if (await contestarRuta(enRuta)) return;
      }
      // Explicar y seguir: dejar la conversacion muerta en un "no puedo
      // atenderte ahi" hace que el cliente se vaya sin saber que puede
      // escribir el distrito a mano, o que hay una persona detras.
      const seguir = (await repos.automation.getPrefs()).preventaActiva
        ? ' Si crees que me equivoco, escríbeme el distrito, o responde ASESOR y te atiende una persona.'
        : '';
      await reply(explicarFallo(result.reason) + seguir);
      return;
    }
    const id = await repos.locations.save(contact.id, result, JSON.stringify(message.location));
    await repos.locations.confirm(id);

    const enRuta = await atenderRespuestaDeRuta(rutasDeps, contact, {
      ubicacion: {
        lat: result.lat,
        lng: result.lng,
        mapsUrl: result.mapsUrl,
        precisionM: result.precisionMeters,
        fuente: 'pin de whatsapp',
      },
    });
    if (await contestarRuta(enRuta)) return;

    // Con la preventa activa, la ubicacion es la respuesta a "¿de donde?" y el
    // flujo sigue desde ahi. Contestar ademas un "ubicacion recibida" seria el
    // segundo mensaje por el mismo entrante, que es lo que hay que evitar.
    if ((await repos.automation.getPrefs()).preventaActiva) {
      await turnoDePreventa(
        contact,
        { texto: '', esPrimerMensaje: isFirstMessage, ubicacion: { lat: result.lat, lng: result.lng } },
        deps,
      );
      return;
    }

    await reply(`Ubicación recibida: ${describe(result)}\n${result.mapsUrl}`);
    return;
  }

  // --- respuesta a la confirmacion -------------------------------------
  if (message.type === 'interactive' && message.interactive?.button_reply) {
    const buttonId = message.interactive.button_reply.id;
    if (buttonId.startsWith(CONFIRM_PREFIX)) {
      const locationId = Number.parseInt(buttonId.slice(CONFIRM_PREFIX.length), 10);
      if (Number.isFinite(locationId)) await repos.locations.confirm(locationId);
      await reply('Listo, confirmada la ubicación.');
      return;
    }
    if (buttonId === REJECT_ID) {
      await askForLocation('Sin problema. Compárteme tu ubicación, por favor.');
      return;
    }
  }

  // Una nota de voz transcrita ES texto: sigue el mismo camino que si lo
  // hubiera escrito (baja/alta, reparto, reglas, asistente).
  const text = message.text?.body ?? message.button?.text ?? message.media?.transcripcion ?? '';

  if (!text.trim()) {
    // Un "ver una vez" llego vacio y se le pidio al telefono que lo reenvie
    // (ver session.ts). Se le da su margen: si la foto llega, el mensaje ya
    // esta completo y no hay nada que pedirle al cliente.
    if (message.type === 'view_once') {
      await (deps.dormir ?? dormirDeVerdad)(deps.verUnaVezEsperaMs ?? 12_000);
      if (await repos.messages.tieneAdjunto(message.id)) return;
      // El telefono no lo solto: se le pide al cliente que lo mande normal,
      // que es lo unico que lo trae hasta aqui. Va ANTES del reparto a
      // proposito: una foto que nadie puede ver no sirve como respuesta al
      // reparto; la que reenvie normal si entrara por ese camino. Se puede
      // apagar desde Configuracion.
      if (deps.ajustes?.pedirVerUnaVezNormal() ?? true) await reply(TEXTO_VER_UNA_VEZ);
      return;
    }
    // Un audio o una foto no son texto, pero SI son una respuesta: el cliente
    // esta contestando y callarse le hace creer que nadie le lee.
    const esAdjunto = ['image', 'audio', 'video', 'document', 'sticker', 'view_once'].includes(message.type);
    // Con una solicitud de ubicacion abierta, la foto de la fachada o el
    // audio con la direccion son LA respuesta del cliente: se aparta para
    // que una persona lo mire. Tratarlo como silencio -que es lo que pasaba-
    // hacia que el bot le insistiera a alguien que ya habia contestado. Un
    // sticker no: eso es charla, no una direccion.
    if (esAdjunto && message.type !== 'sticker') {
      const enRuta = await atenderRespuestaDeRuta(rutasDeps, contact, { texto: '' });
      if (enRuta.atendida) {
        await contestarRuta(enRuta);
        return;
      }
    }
    // Con la IA activa, un adjunto se reconoce y se pide el texto: el modelo
    // no ve fotos ni oye audios, y callarse deja al cliente hablando solo.
    if (esAdjunto && message.type !== 'sticker' && deps.ia?.activa()) {
      const que = message.type === 'audio' ? 'tu audio' : message.type === 'image' ? 'tu foto' : message.type === 'video' ? 'tu video' : 'tu archivo';
      await reply(`Recibí ${que}. ¿Me cuentas por escrito qué necesitas? Así te ayudo más rápido.`);
      return;
    }
    if (esAdjunto && (await repos.automation.getPrefs()).preventaActiva) {
      await turnoDePreventa(contact, { texto: '', esPrimerMensaje: isFirstMessage, adjunto: true }, deps);
    }
    return;
  }

  // --- baja y alta ------------------------------------------------------
  if (matchesKeyword(text, config.optOutKeywords)) {
    await repos.contacts.setOptOut(phone);
    // Si estaba en un lote, deja de estarlo: la entrega se coordina por
    // telefono y GSG tiene que enterarse.
    await atenderRespuestaDeRuta(rutasDeps, contact, { baja: true });
    // Se responde dentro de la ventana, asi que el gate de opt-out no aplica
    // a esta confirmacion: es la ultima cortesia antes de dejar de escribir.
    if (numeroPermitido({ soloNumeros: deps.ajustes ? deps.ajustes.soloNumeros() : config.soloNumeros }, phone)) {
      await wa
        .sendText(phone, 'Listo, no volverás a recibir mensajes nuestros. Responde ALTA si cambias de idea.')
        .catch(() => undefined);
    }
    return;
  }

  if (matchesKeyword(text, config.optInKeywords)) {
    await repos.contacts.setOptIn(phone, 'whatsapp_keyword');
    await reply('Gracias, quedaste suscrito. Responde BAJA cuando quieras dejar de recibirlos.');
    return;
  }

  // --- reglas y coordenadas --------------------------------------------
  const [rules, prefs, result] = await Promise.all([
    repos.automation.listRules(),
    repos.automation.getPrefs(),
    extractLocation(text, { bbox: config.bbox }),
  ]);

  // Con una solicitud de ubicacion abierta, esto es su respuesta: un enlace
  // de mapa la resuelve, y cualquier otra cosa la aparta para que la mire una
  // persona. En los dos casos el mensaje no sigue al flujo de preventa.
  const enRutaTexto = await atenderRespuestaDeRuta(rutasDeps, contact, {
    texto: text,
    ubicacion: result.ok
      ? {
          lat: result.lat,
          lng: result.lng,
          mapsUrl: result.mapsUrl,
          precisionM: result.precisionMeters,
          fuente: `enlace de mapa (${result.source})`,
        }
      : undefined,
  });
  // Un enlace de mapa dentro del texto es su ubicacion: la lista lo cuenta igual que un pin.
  if (result.ok && deps.lista) await deps.lista.alRecibir(contact, { ubicacion: true }).catch(() => undefined);

  if (enRutaTexto.atendida) {
    // La ubicacion se guarda tambien en el historial de ubicaciones, que es
    // de donde salen la pagina de rastreo y el listado del panel.
    if (result.ok) {
      const guardada = await repos.locations.save(contact.id, result, text);
      await repos.locations.confirm(guardada);
    }
    await contestarRuta(enRutaTexto);
    return;
  }

  const rule = matchRule(rules, text, { isFirstMessage, hasCoordinates: result.ok });
  if (rule) await applyRule(rule, contact, deps);

  if (!result.ok) {
    // Una regla de la tienda manda sobre el flujo: es lo que la tienda escribio
    // a mano para ese caso concreto, y encadenar las dos respuestas es
    // exactamente el "dos mensajes por uno" que hay que evitar.
    if (rule) return;

    // El asistente de IA de la tienda: con lo que sabe del negocio (y el
    // catalogo, si esta), contesta; si no puede, deriva a una persona.
    if (deps.ia?.activa()) {
      await deps.ia.turno(contact, text, { esAudio: message.type === 'audio' });
      return;
    }

    if (prefs.preventaActiva) {
      await turnoDePreventa(contact, { texto: text, esPrimerMensaje: isFirstMessage }, deps);
      return;
    }

    if (prefs.askLocationFallback) {
      await askForLocation(
        'No encontré coordenadas en ese mensaje. Compárteme tu ubicación, por favor.',
      );
    }
    return;
  }

  const locationId = await repos.locations.save(contact.id, result, text);

  if (result.needsConfirmation) {
    // Confianza baja (tipico de un link con solo @lat,lng): se pregunta antes
    // de que alguien salga a repartir a la coordenada equivocada.
    await sender.send({
      phone,
      kind: 'interactive',
      category: 'UTILITY',
      interactive: {
        body: `Entendí esta ubicación: ${describe(result)}\n${result.mapsUrl}\n\n¿Es correcta?`,
        buttons: [
          { id: `${CONFIRM_PREFIX}${locationId}`, title: 'Sí, es esa' },
          { id: REJECT_ID, title: 'No, corregir' },
        ],
      },
    });
    return;
  }

  await repos.locations.confirm(locationId);
  await reply(`Ubicación registrada: ${describe(result)}\n${result.mapsUrl}`);
}

/** Como se presenta el negocio: lo de la pantalla si se cambio, si no lo del servidor. */
function nombreNegocio(deps: Pick<InboundDeps, 'config' | 'ajustes'>): string {
  return deps.ajustes?.nombreNegocio() ?? deps.config.businessName;
}
