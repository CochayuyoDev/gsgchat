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
import type { FailureReason } from '../types.js';
import { esNumeroDePrueba } from '../desarrollador/numeros.js';
import {
  intencionDe,
  responder,
  textoDePregunta,
  type Contexto as ContextoPreventa,
  type Entrada as EntradaPreventa,
} from '../preventa/flow.js';
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
import { enrollContact, matchRule, onInboundReply, renderPlaceholders, saludoPorHora } from '../automation/engine.js';

import { atenderRespuestaDeRuta, type RespuestaRuta } from '../rutas/inbound.js';
import { crearPuertoEnEspera, type PuertoGsg } from '../rutas/gsg.js';
import { textoFueraDeZona, textoGracias } from '../rutas/mensajes.js';
import { hayCatalogo } from '../stoky/conexion.js';
import type { ServicioEntregas } from '../entregas/servicio.js';
import { atenderComoAgente, atenderConReglaGsg, cerrarChat, pideAsesor, type DepsAgente } from '../ia/agente-operativo.js';
import { atenderEntrante as atenderEntranteDeProceso } from '../procesos/nucleo.js';
import type { EntradaProceso } from '../procesos/validar.js';
import { leerPreguntaPorPedido } from '../entregas/interpretar.js';
import { horaEnPalabras } from '../entregas/textos.js';

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
   * Las entregas del dia (ver src/entregas): la confirmacion del pedido, las
   * respuestas de los motorizados y el aviso de la hora de llegada. Un pin
   * que resuelve el reparto tambien se le cuenta, y un "si" o un "40 min" se
   * atienden aqui antes que en el asistente.
   */
  entregas?: ServicioEntregas;
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

/**
 * Como se guarda un entrante en la conversacion.
 *
 * Los tipos que el bot no sabe atender (una foto, un audio, un contacto
 * compartido) igual se anotan: en el chat el operador tiene que VER que el
 * cliente mando algo, aunque el sistema no pueda responderlo solo.
 */
export function readInbound(message: InboundMessage): { kind: MessageKind; body: string; payload: Record<string, unknown> | null } {
  const leido = leerContenido(message);
  // A que mensaje esta respondiendo, si responde a alguno. Se guarda solo el
  // id: el chat busca el original en el hilo y de ahi saca de quien era y que
  // decia, que es siempre mas fiel que una copia congelada.
  const cita = message.context?.id ? { cita: { id: message.context.id } } : null;
  // En un grupo importa quien lo dijo: va en el payload para que el chat lo
  // pinte encima del globo, y el cuerpo queda limpio para la lista y la IA.
  const autor = message.grupo
    ? { autor: { telefono: message.grupo.autor, nombre: message.grupo.autorNombre?.trim() || null } }
    : null;
  if (!cita && !autor) return leido;
  return { ...leido, payload: { ...(leido.payload ?? {}), ...(cita ?? {}), ...(autor ?? {}) } };
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

  // Un cliente con una entrega en curso (se le está llevando un paquete) no
  // es un cliente de la preventa: nada de «Cotizar envío» ni de precios. Su
  // menú de respaldo es «Horarios y zona» y «Hablar con asesor», y el horario
  // que se le da es el de las entregas (30/09).
  const conEntrega = deps.entregas ? await deps.entregas.tieneEntregaEnCurso(contact.phone).catch(() => false) : false;
  const horarioEntregas = (): string | null => {
    const h = deps.entregas?.ajustes().horarioEntregas;
    return h ? `de ${horaEnPalabras(h.desde)} a ${horaEnPalabras(h.hasta)}` : null;
  };

  // Una consulta de precio se contesta con el catalogo y NO sigue al flujo:
  // dos respuestas por un mensaje es justo lo que no puede pasar.
  if (!conEntrega && (await contestarPrecio(contact, entrada, lead, prefs, deps))) return;

  const { patch, respuesta } = responder(lead, entrada, {
    negocio: nombreNegocio(deps),
    cobertura: config.coverageName || 'tu zona',
    saludo: saludoPorHora(new Date(), config.timezone),
    horario: (conEntrega ? horarioEntregas() : null) ?? config.businessHours,
    servicios: prefs.serviciosPreventa,
    mensajes: prefs.mensajesPreventa,
    distritos: config.distritos,
    conEntrega,
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

/**
 * «2» a una pregunta con opciones es pulsar la opción 2.
 *
 * Por QR (local y WAHA) los botones salen como lista numerada («1. Sí, es
 * ahí / 2. No — Responde con el número»), y el número llegaba como un texto
 * suelto que nadie entendía: el 26/09 un cliente contestó «2» (No) a «¿es
 * ahí?», se le repitió la pregunta y al final el pin se dio por bueno. Si el
 * último mensaje del sistema en ese chat traía opciones, el número se
 * convierte en la respuesta de ese botón y todo lo de después lo lee igual
 * que si se hubiera pulsado.
 */
export async function respuestaNumeradaComoBoton(message: InboundMessage, deps: Pick<InboundDeps, 'repos'>): Promise<InboundMessage> {
  if (message.type !== 'text') return message;
  const numero = /^\s*([1-9])\s*[.)️⃣]*\s*$/u.exec(message.text?.body ?? '');
  if (!numero) return message;
  const contacto = await deps.repos.contacts.getByPhone(message.from).catch(() => null);
  if (!contacto) return message;
  const recientes = await deps.repos.messages.listMessages(contacto.id, 15).catch(() => []);
  const ultimo = [...recientes].reverse().find((m) => m.direction === 'out' && (m.payload as { origen?: string } | null)?.origen !== 'persona');
  const botones = (ultimo?.payload as { interactive?: { buttons?: Array<{ id?: string; title?: string }> } } | null)?.interactive?.buttons ?? [];
  const elegido = botones[Number(numero[1]) - 1];
  if (!elegido?.id) return message;
  const hace = Date.now() - new Date(ultimo!.createdAt as unknown as string).getTime();
  if (hace > 24 * 60 * 60_000) return message;
  return { ...message, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: elegido.id, title: elegido.title ?? numero[1] } } } as InboundMessage;
}

/**
 * Lo que manda un mismo cliente se atiende de uno en uno, en el orden en que
 * llegó. Antes el pin y el texto de al lado se atendían a la vez: mientras la
 * IA leía «Yaya», el pin ya estaba registrado y la insistencia «necesitamos tu
 * ubicación» le llegaba DESPUÉS de mandarla (26/09).
 *
 * Y el mismo texto repetido en pocos segundos («2», «2», «2»…) se guarda pero
 * se contesta una sola vez: cada copia gastaba una insistencia.
 */
const REPETIDO_MS = 30_000;
// Por instancia (una por tienda, y una por escenario en las pruebas): colgado
// de sus repos para que dos sistemas en el mismo proceso no se mezclen.
const estadoPorSistema = new WeakMap<object, { cola: Map<string, Promise<unknown>>; ultimo: Map<string, { firma: string; escritoMs: number; respuestaMs: number | null; salidaId: string | null }> }>();
function estadoDe(deps: InboundDeps) {
  let e = estadoPorSistema.get(deps.repos);
  if (!e) estadoPorSistema.set(deps.repos, (e = { cola: new Map(), ultimo: new Map() }));
  return e;
}

/**
 * Qué acción dispara un mensaje, para reconocer las copias: el mismo texto
 * (sin tildes ni mayúsculas), la misma ubicación, el mismo botón o un
 * sticker. Null = no se compara nunca (preguntas por el pedido, que siempre
 * se contestan, y lo que no es del cliente).
 */
export function firmaDeAccion(message: InboundMessage): string | null {
  if (message.type === 'text') {
    const t = (message.text?.body ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s.!¡?¿,]+/g, ' ').trim();
    if (!t || leerPreguntaPorPedido(message.text?.body ?? '').pregunta) return null;
    return `t:${t}`;
  }
  if (message.type === 'location' && message.location) return `l:${Number(message.location.latitude).toFixed(4)},${Number(message.location.longitude).toFixed(4)}`;
  if (message.type === 'interactive') return `b:${message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? ''}`;
  if (message.type === 'button') return `b:${message.button?.payload ?? message.button?.text ?? ''}`;
  if (message.type === 'sticker') return 'sticker';
  return null;
}

export async function handleInboundMessage(
  message: InboundMessage,
  profileName: string | undefined,
  deps: InboundDeps,
): Promise<void> {
  // Los grupos y los reenvios del telefono (la foto de un «ver una vez» que
  // espera el mensaje original) no hacen fila: la fila los bloquearia.
  if (message.grupo || message.reenvio) return handleInboundMessageEnFila(message, profileName, deps);
  const clave = message.from;
  const { cola: colaPorCliente, ultimo: ultimoTexto } = estadoDe(deps);
  // Regla del dueño (26/09): la MISMA acción repetida seguida (la misma
  // ubicación, varios «sí»/«no», varios «1»/«2», el mismo botón, stickers)
  // se atiende una vez. Una copia es la que el cliente ESCRIBIÓ antes de que
  // le llegara la respuesta a la primera (la hora la pone WhatsApp): los cinco
  // «2» seguidos. Lo que escribe DESPUÉS de leer la respuesta es una acción
  // nueva (mandar otra vez el mismo pin tras «¿es ahí?» es decir que sí). Lo
  // distinto no se pierde (va en fila, en orden), y preguntar por el pedido
  // («¿dónde va mi pedido?») no tiene firma: se contesta siempre.
  const firma = firmaDeAccion(message);
  const turno = (colaPorCliente.get(clave) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const escrito = Number(message.timestamp) * 1000 || Date.now();
      const antes = ultimoTexto.get(clave);
      // La última respuesta del sistema a este cliente, antes y después.
      const ultimaSalida = async (): Promise<{ id: string; at: number } | null> => {
        const contacto = await deps.repos.contacts.getByPhone(clave).catch(() => null);
        const ultimos = contacto ? await deps.repos.messages.listMessages(contacto.id, 10).catch(() => []) : [];
        const m = [...ultimos].reverse().find((x) => x.direction === 'out');
        return m ? { id: String(m.id ?? m.wamid ?? ''), at: new Date(m.createdAt as unknown as string).getTime() } : null;
      };
      let repetido = false;
      if (firma && antes && antes.firma === firma && !message.viejo) {
        repetido = antes.respuestaMs != null ? escrito <= antes.respuestaMs : escrito - antes.escritoMs < REPETIDO_MS;
        // Si desde el primero el sistema le escribió algo (la pregunta que le
        // tocaba en su turno), lo de ahora contesta a ESO: no es una copia.
        // Pasó con un «Sí» escrito antes de que se le preguntara (sin
        // respuesta) y el «Sí» de verdad, segundos después de la pregunta,
        // se tomaba por copia y se perdía (30/09).
        if (repetido && ((await ultimaSalida())?.id ?? null) !== antes.salidaId) repetido = false;
        // Solo con clientes de un pedido de GSG en curso: un motorizado que
        // repite su tiempo, o un proceso que recibe dos «sí», sigue como siempre.
        if (repetido) {
          const e = deps.entregas;
          const cliente = e && !(await e.esMotorizado(clave).catch(() => false))
            ? await e.situacionGsg(clave).catch(() => null)
            : null;
          repetido = Boolean(cliente && (cliente.ubicacion !== 'sin_entrega' || cliente.confirmar));
        }
      }
      if (repetido) return handleInboundMessageEnFila({ ...message, viejo: true }, profileName, deps);
      const antesDe = firma && !message.viejo ? await ultimaSalida() : null;
      await handleInboundMessageEnFila(message, profileName, deps);
      if (!firma || message.viejo) return;
      const despues = await ultimaSalida();
      // La hora real en que salió la respuesta: el mismo reloj que el de WhatsApp.
      const contesto = despues && despues.id !== antesDe?.id ? Date.now() : null;
      ultimoTexto.set(clave, { firma, escritoMs: escrito, respuestaMs: contesto, salidaId: despues?.id ?? null });
    });
  colaPorCliente.set(clave, turno);
  try {
    await turno;
  } finally {
    if (colaPorCliente.get(clave) === turno) colaPorCliente.delete(clave);
  }
}

async function handleInboundMessageEnFila(
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

  message = await respuestaNumeradaComoBoton(message, deps);

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
  // Excepcion (regla del dueño, 25/09): una UBICACION (pin o enlace de mapa)
  // de alguien a quien el sistema le pidio la ubicacion se registra y se
  // contesta SIEMPRE, aunque el bot este en pausa. Si no, el cliente manda su
  // pin y nadie le dice nada (paso con un numero real: el recordatorio salio,
  // el pin se perdio). Todo lo demas sigue callado mientras dure la pausa.
  if (contact.botPausadoAt) {
    const texto = message.type === 'text' ? String(message.text?.body ?? '') : '';
    const esUbicacion = (message.type === 'location' && Boolean(message.location)) || /(maps\.google\.|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|waze\.com)/i.test(texto);
    // Los botones «Sí, recibo hoy» / «No» que mandó el sistema tambien: son la respuesta a lo que él preguntó.
    const esBotonDeEntrega = message.type === 'interactive' && String(message.interactive?.button_reply?.id ?? '').startsWith('entrega:');
    if (esBotonDeEntrega) request_log(deps, 'bot en pausa, pero el cliente pulsó el botón que mandó el sistema: se atiende', null);
    else if (!esUbicacion) return;
    const pideUbicacion =
      Boolean(await repos.rutas.abiertaPorContacto(contact.id).catch(() => null)) ||
      Boolean(await repos.rutas.abiertaPorTelefono(contact.phone).catch(() => null)) ||
      (deps.entregas ? (await deps.entregas.estadoUbicacionDe(contact.phone).catch(() => 'sin_entrega')) === 'pendiente' : false);
    if (!esBotonDeEntrega && !pideUbicacion) return;
    if (!esBotonDeEntrega) request_log(deps, 'bot en pausa, pero llegó la ubicación que el sistema pidió: se registra y se contesta', null);
  }

  // Modo prueba (SOLO_NUMEROS): a quien no este en la lista no se le contesta
  // nada, ni siquiera desde el asistente. El sender lo bloquea igual, pero
  // aqui se corta antes para no dejar rastro de "intentos" en la ficha.
  // Los numeros de prueba del Modulo desarrollador pasan siempre: nunca salen al
  // WhatsApp real (el sender los simula), y sin esto el modo prueba de la tienda
  // dejaba sin respuesta toda simulacion.
  if (!esNumeroDePrueba(phone) && !numeroPermitido({ soloNumeros: deps.ajustes ? deps.ajustes.soloNumeros() : config.soloNumeros }, phone)) return;

  // Acuse de lectura: mejora la percepcion y no cuesta cuota.
  await wa.markAsRead(message.id).catch(() => undefined);

  // Cualquier mensaje del cliente es una respuesta: corta los seguimientos
  // que estaban esperando precisamente eso.
  await onInboundReply(repos, contact);

  // Los procesos (src/procesos): si esta persona tiene una corrida viva, lo
  // que manda es su respuesta a ese proceso (un DNI, un SI, «llegué», la
  // captura del pago) y se atiende ahi. Si no tiene ninguna, el mensaje sigue
  // su camino de siempre, sin cambiar nada.
  if (repos.procesos && (await atenderEnProceso(message, contact, deps).catch((error) => {
    request_log(deps, 'fallo el modulo de procesos al leer un mensaje', error);
    return false;
  }))) {
    return;
  }

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
      // Las entregas del dia se enteran: si ademas falta confirmar, la
      // pregunta va pegada al gracias (un solo mensaje, no dos).
      const s = respuesta.solicitud;
      const enEntrega =
        deps.entregas && s && s.lat !== null && s.lng !== null
          ? await deps.entregas.alUbicacion(contact, { lat: s.lat, lng: s.lng, mapsUrl: s.mapsUrl, fuente: s.ubicacionFuente ?? 'whatsapp', yaReportada: true }).catch(() => ({ atendida: false as const }))
          : { atendida: false as const };
      if (enEntrega.atendida && enEntrega.responder) await responderEntrega(enEntrega);
      else if (deps.entregas && (deps.ajustes ? deps.ajustes.modo() : 'completo') === 'gsg') {
        await reply(deps.entregas.textoUbicacionRegistrada({ nombre: contact.name, mapa: s?.mapsUrl ?? null }), { traspasaSilencio: ubiTraspasaSilencio() });
      } else await reply(textoGracias({ negocio: nombreNegocio(deps), referencia: respuesta.solicitud?.referencia }));
      // Primero se cierra (con la regla del dueño, desde aqui silencio: ni el sticker sale).
      await cerrarTrasUbicacion();
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

  const reply = (text: string, opts: { traspasaSilencio?: boolean } = {}) =>
    sender.send({ phone, kind: 'freeform', category: 'UTILITY', text, ...(opts.traspasaSilencio ? { cierreTrasGracias: true } : {}) });

  /**
   * UBI REGISTRADA sale SIEMPRE que llega su ubicacion, aunque el chat
   * estuviera callado por el cierre (decision del dueño, 25/09: mandar la
   * ubicacion es justo lo que se le pedia y no puede quedarse sin respuesta).
   * No sale dos veces (un pin repetido) ni a quien dijo «no soy yo».
   */
  const motivoAntes = String(contact.iaCerradaMotivo ?? '');
  const ubiTraspasaSilencio = (): boolean => !motivoAntes.startsWith('ubicación registrada') && !motivoAntes.startsWith('no soy yo');

  /**
   * Una respuesta del modulo de entregas: con botones (SI / NO) si los trae
   * y el WhatsApp puede pintarlos; si no, el texto. El proveedor local cae
   * solo a texto cuando no puede con los botones.
   */
  const responderEntrega = (r: { responder?: string; botones?: Array<{ id: string; title: string }>; resultado?: string }) =>
    r.botones?.length
      ? sender.send({ phone, kind: 'interactive', category: 'UTILITY', interactive: { body: r.responder ?? '', buttons: r.botones } })
      : reply(r.responder ?? '', {
          // La ubicación nueva (el cliente la cambió antes de la hora límite) se
          // le confirma aunque el chat esté en silencio tras UBI REGISTRADA,
          // igual que el «después de la 1:00 PM»: es la respuesta a su cambio.
          traspasaSilencio:
            (r.resultado === 'ubicacion' && ubiTraspasaSilencio()) ||
            (r.resultado === 'ubicacion_corregida' && !motivoAntes.startsWith('no soy yo')) ||
            r.resultado === 'ubicacion_tardia' ||
            // «Me equivoqué de ubicación»: la respuesta a su pedido de cambio.
            r.resultado === 'pide_cambio_ubicacion' ||
            r.resultado === 'pide_cambio_ubicacion_tarde',
        });

  /**
   * La preventa del courier (cotizar envio, distritos, asesor) solo trabaja
   * con "Todo el sistema". En modo "Solo lo de GSG" su pantalla esta
   * escondida y nadie podria apagarla: un cliente sin entrega que escribe
   * "mi pedido llego tardisimo" no puede recibir un menu de cotizaciones.
   * Sin ajustes (las pruebas viejas), como siempre.
   */
  const preventaActiva = async (): Promise<boolean> => {
    if ((deps.ajustes ? deps.ajustes.modo() : 'completo') === 'gsg') return false;
    return (await repos.automation.getPrefs()).preventaActiva;
  };

  /**
   * El agente operativo (ver src/ia/agente-operativo.ts): con "Solo lo de GSG"
   * la IA solo pide, valida y registra la ubicacion; ante otra consulta manda
   * el cierre una vez y se calla. El sistema sigue con lo automatico.
   */
  /** «Solo lo de GSG»: la IA nunca conversa con un cliente (solo clasifica), este encendido o no el agente. */
  const modoGsg = (): boolean => (deps.ajustes ? deps.ajustes.modo() : 'completo') === 'gsg';
  const agenteActivo = (): boolean => Boolean(deps.ia?.agenteOperativoActivo?.()) || (modoGsg() && Boolean(deps.ia));
  /** La regla del dueño (ajuste «Después de UBI REGISTRADA, no escribirle más al cliente»). */
  const reglaGsg = (): boolean => Boolean(deps.entregas && modoGsg() && deps.entregas.reglaGsgActiva());
  const depsAgente = (): DepsAgente => ({
    repos,
    sender,
    entregas: deps.entregas,
    clasificar: deps.ia?.activa() ? (m) => deps.ia!.clasificarOperativo(m) : undefined,
    nombreNegocio: () => nombreNegocio(deps),
    log: (m, d) => console.warn(`[agente] ${m}`, d ?? ''),
    ...(deps.entregas?.ahora ? { ahora: () => deps.entregas!.ahora!() } : {}),
  });
  /** Tras registrar la ubicacion, la IA se calla en este chat (su mensaje ya lleva el cierre). */
  const cerrarTrasUbicacion = async (): Promise<void> => {
    if (!agenteActivo() && !reglaGsg()) return;
    // Tras «no soy yo» el chat sigue con una persona tal cual. Si ya habia
    // recibido el cierre, se apunta: tras el agradecimiento no le toca otro.
    if (motivoAntes.startsWith('no soy yo')) return;
    const yaTuvoCierre = /^(escribió otra cosa|preguntó después|consulta ajena)/.test(motivoAntes) || motivoAntes === 'ubicación registrada (tras el cierre)';
    await cerrarChat({ repos, entregas: deps.entregas, ...(deps.entregas?.ahora ? { ahora: () => deps.entregas!.ahora!() } : {}) }, contact, yaTuvoCierre ? 'ubicación registrada (tras el cierre)' : 'ubicación registrada').catch(() => undefined);
  };

  /**
   * Con la regla del dueño, un pin (o enlace) que cae lejos del distrito de su
   * pedido no se registra a ciegas: queda propuesto y se le pregunta UNA vez si
   * es ahí, con botones SÍ / NO (ver entregas.revisarPin). true = ya se atendió.
   */
  const pinLejano = async (lat: number, lng: number, mapsUrl: string | null | undefined, fuente: string): Promise<boolean> => {
    if (!deps.entregas || !reglaGsg()) return false;
    const r = await deps.entregas.revisarPin(contact, { lat, lng, mapsUrl: mapsUrl ?? null, fuente }).catch((error) => {
      request_log(deps, 'no se pudo revisar si el pin tiene sentido', error);
      return { atendida: false as const };
    });
    if (!r.atendida) return false;
    if (r.responder) await responderEntrega(r);
    return true;
  };

  const askForLocation = (body: string) =>
    sender.send({
      phone,
      kind: 'interactive',
      category: 'UTILITY',
      interactive: { body, locationRequest: true },
    });

  // --- la regla del dueño («Solo lo de GSG») -----------------------------
  // «El único proceso de GSGchat es disparar mensajes. Una vez que la IA manda
  // el mensaje de UBI REGISTRADA, ahí llega la IA: ya no vuelve a responder.»
  // A un cliente (no a un motorizado) solo le pueden llegar tres cosas: la
  // explicación de por qué se le pide la ubicación, UBI REGISTRADA al mandar
  // su pin (lo registra el camino de siempre, abajo) o el cierre UNA vez con el
  // número del motorizado. Todo lo demás, silencio. Ver src/ia/agente-operativo.ts.
  if (reglaGsg() && !(await deps.entregas!.esMotorizado(phone).catch(() => false))) {
    const esPin = message.type === 'location' && Boolean(message.location);
    const cuerpo = message.text?.body ?? '';
    const escrito = cuerpo || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || message.media?.transcripcion || '';
    // Un enlace de mapa (o coordenadas) es su ubicación: la registra el camino de siempre.
    const enlace = !esPin && cuerpo && /https?:\/\/|-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/.test(cuerpo) ? await extractLocation(cuerpo, {}).catch(() => null) : null;
    const esBaja = Boolean(escrito) && matchesKeyword(escrito, config.optOutKeywords);
    if (!esPin && !enlace?.ok && !esBaja) {
      await atenderConReglaGsg(depsAgente(), contact, { texto: escrito, tipo: message.type, boton: message.interactive?.button_reply?.id ?? message.button?.payload ?? null }).catch((error) => request_log(deps, 'fallo la regla del dueño al atender un mensaje', error));
      return;
    }
  }

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
        // Las entregas del dia se enteran ya: el pedido pasa a una persona y al
        // cliente se le explica con el texto editable (no se registra el pin).
        if (deps.entregas) {
          const enEntrega = await deps.entregas.alUbicacionFueraDeZona(contact, { lat: message.location.latitude, lng: message.location.longitude, fuente: 'pin de whatsapp' }).catch(() => ({ atendida: false as const }));
          if (enEntrega.atendida) {
            if (enEntrega.responder) await reply(enEntrega.responder);
            return;
          }
        }
        if (await contestarRuta(enRuta)) return;
      }
      // Explicar y seguir: dejar la conversacion muerta en un "no puedo
      // atenderte ahi" hace que el cliente se vaya sin saber que puede
      // escribir el distrito a mano, o que hay una persona detras.
      const seguir = (await preventaActiva())
        ? ' Si crees que me equivoco, escríbeme el distrito, o responde ASESOR y te atiende una persona.'
        : '';
      await reply(explicarFallo(result.reason) + seguir);
      return;
    }
    // El pin tiene que tener sentido (regla del dueño, 25/09): si cae lejos del
    // distrito de su pedido, no se registra a ciegas; se le pregunta si es ahí.
    if (await pinLejano(result.lat, result.lng, result.mapsUrl, 'pin de whatsapp')) return;
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

    // Sin solicitud del reparto de por medio, el pin puede ser de una
    // entrega del dia (GSG ya tenia una ubicacion vieja y el cliente manda la
    // buena, o la pidio una persona): se guarda y se sigue el flujo.
    if (deps.entregas) {
      const enEntrega = await deps.entregas.alUbicacion(contact, { lat: result.lat, lng: result.lng, mapsUrl: result.mapsUrl, fuente: 'pin de whatsapp' }).catch(() => ({ atendida: false as const }));
      if (enEntrega.atendida) {
        if (enEntrega.responder) await responderEntrega(enEntrega);
        else await reply(textoGracias({ negocio: nombreNegocio(deps), referencia: enEntrega.entrega?.referencia }));
        await cerrarTrasUbicacion();
        return;
      }
    }

    // Con la preventa activa, la ubicacion es la respuesta a "¿de donde?" y el
    // flujo sigue desde ahi. Contestar ademas un "ubicacion recibida" seria el
    // segundo mensaje por el mismo entrante, que es lo que hay que evitar.
    if (await preventaActiva()) {
      await turnoDePreventa(
        contact,
        { texto: '', esPrimerMensaje: isFirstMessage, ubicacion: { lat: result.lat, lng: result.lng } },
        deps,
      );
      return;
    }

    // Sin coordenadas a la vista: el enlace basta. En modo GSG, con el texto
    // editable de las entregas (motorizado, horario, soporte).
    if (deps.entregas && (deps.ajustes ? deps.ajustes.modo() : 'completo') === 'gsg') {
      await reply(deps.entregas.textoUbicacionRegistrada({ nombre: contact.name, mapa: result.mapsUrl }));
      await cerrarTrasUbicacion();
      return;
    }
    await reply(`Ubicación registrada.\n${result.mapsUrl}`);
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
    // Los botones de las entregas del dia ("Sí, recibo hoy" / "No"): lo que
    // dice el boton es la respuesta del cliente, y entra por el mismo camino
    // que si lo hubiera escrito, con el id del boton para que quede como tal.
    if (buttonId.startsWith('entrega:') && deps.entregas) {
      const titulo = message.interactive.button_reply.title || (buttonId.includes(':si') ? 'sí' : 'no');
      const enEntrega = await deps.entregas.alTexto(contact, titulo, { boton: buttonId }).catch((error) => {
        request_log(deps, 'fallo el modulo de entregas al leer un boton', error);
        return { atendida: false as const };
      });
      if (enEntrega.atendida) {
        if (enEntrega.responder) await responderEntrega(enEntrega);
        return;
      }
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
    // Un motorizado con un pedido avisado que manda una foto: es la prueba
    // de entrega. Va antes que el reparto y que la IA: ese numero es de la
    // casa y esa foto tiene un significado claro.
    if (esAdjunto && message.type !== 'sticker' && deps.entregas) {
      const enEntrega = await deps.entregas.alAdjuntoDeMotorizado(contact, message.type, message.media?.caption ?? null).catch((error) => {
        request_log(deps, 'fallo el modulo de entregas al leer un adjunto', error);
        return { atendida: false as const };
      });
      if (enEntrega.atendida) {
        if (enEntrega.responder) await reply(enEntrega.responder);
        return;
      }
    }
    if (esAdjunto && message.type !== 'sticker') {
      const enRuta = await atenderRespuestaDeRuta(rutasDeps, contact, { texto: '' });
      if (enRuta.atendida) {
        await contestarRuta(enRuta);
        return;
      }
    }
    // Con el agente operativo: si le falta su ubicacion, el reparto sigue a su
    // ritmo; si ya la mando, nada que decir; si no tiene entrega, el cierre.
    if (esAdjunto && message.type !== 'sticker' && agenteActivo()) {
      await atenderComoAgente(depsAgente(), contact, '').catch((error) => request_log(deps, 'fallo el agente operativo', error));
      return;
    }
    // Con la IA activa, un adjunto se reconoce y se pide el texto: el modelo
    // no ve fotos ni oye audios, y callarse deja al cliente hablando solo.
    if (esAdjunto && message.type !== 'sticker' && deps.ia?.activa()) {
      const que = message.type === 'audio' ? 'tu audio' : message.type === 'image' ? 'tu foto' : message.type === 'video' ? 'tu video' : 'tu archivo';
      await reply(`Recibí ${que}. ¿Me cuentas por escrito qué necesitas? Así te ayudo más rápido.`);
      return;
    }
    if (esAdjunto && (await preventaActiva())) {
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

  // Las entregas del dia: la respuesta a "¿confirmas tu pedido?" y lo que
  // contesta un motorizado ("40 min"). Van antes que el reparto y que el
  // asistente: es a lo que ese numero esta contestando. Un enlace de mapa
  // no es una confirmacion: ese sigue por el camino de la ubicacion.
  // Un enlace de mapa que cae fuera de la zona: la entrega del dia lo aparta
  // para una persona y al cliente se le explica; no se registra.
  if (deps.entregas && !result.ok && result.reason === 'outside_bbox') {
    const sinZona = await extractLocation(text, {}).catch(() => null);
    if (sinZona?.ok) {
      const enEntrega = await deps.entregas.alUbicacionFueraDeZona(contact, { lat: sinZona.lat, lng: sinZona.lng, fuente: `enlace de mapa (${sinZona.source})` }).catch(() => ({ atendida: false as const }));
      if (enEntrega.atendida) {
        if (enEntrega.responder) await reply(enEntrega.responder);
        return;
      }
    }
  }

  if (deps.entregas && !result.ok) {
    const enEntrega = await deps.entregas.alTexto(contact, text, { citaId: message.context?.id ?? null }).catch((error) => {
      request_log(deps, 'fallo el modulo de entregas al leer un mensaje', error);
      return { atendida: false as const };
    });
    if (enEntrega.atendida) {
      if (enEntrega.responder) await responderEntrega(enEntrega);
      return;
    }
  }

  // Con «Todo el sistema», quien tiene una entrega en curso y pide una persona
  // («quiero hablar con alguien», «ASESOR», «operador»): se le dice que lo
  // atiende una persona, el bot se para en su chat y su pedido (o su pedido de
  // ubicación) pasa a «Necesita a alguien», sin más insistencias. Antes, el
  // reparto lo apartaba EN SILENCIO y un minuto después le volvía a pedir la
  // ubicación (batería del 30/09). Con «Solo lo de GSG» lo atiende la regla
  // del dueño (arriba), con su cierre.
  if (!result.ok && !modoGsg() && deps.entregas && pideAsesor(text) && (await deps.entregas.tieneEntregaEnCurso(phone).catch(() => false))) {
    await reply(`Te paso con una persona del equipo de ${nombreNegocio(deps)}; en un momento te atiende por aquí.`);
    await repos.contacts.pausarBot(contact.id, true, new Date()).catch(() => undefined);
    const abiertaAsesor = (await repos.rutas.abiertaPorContacto(contact.id).catch(() => null)) ?? (await repos.rutas.abiertaPorTelefono(phone).catch(() => null));
    if (abiertaAsesor) {
      await repos.rutas
        .actualizarSolicitud(abiertaAsesor.id, { estado: abiertaAsesor.estado === 'pendiente' ? 'pendiente' : 'supervision', requiereHumano: true, proximoIntentoAt: null, incidencia: 'respondio_sin_ubicacion', incidenciaDetalle: `pidió hablar con una persona: ${text.slice(0, 240)}` })
        .catch(() => undefined);
      await repos.rutas.registrarEvento(abiertaAsesor.id, 'respuesta', `pidió hablar con una persona («${text.slice(0, 160)}»): pasa a una persona y no se le insiste`).catch(() => undefined);
    }
    await deps.entregas.pasarAPersona(phone, 'consulta_ajena', `pidió hablar con una persona: ${text.slice(0, 200)}`).catch(() => 0);
    await deps.entregas.anotarAgente(phone, `pidió hablar con una persona («${text.slice(0, 120)}»): el bot se paró en su chat`).catch(() => undefined);
    return;
  }

  // El agente operativo: «¿por qué?» se explica y se vuelve a pedir; una
  // consulta ajena recibe el cierre una vez y el chat pasa a una persona; lo
  // que es la respuesta al pedido de ubicacion sigue al reparto. Un
  // motorizado no pasa por aqui (lo suyo lo atienden las entregas).
  if (!result.ok && agenteActivo() && !(deps.entregas && (await deps.entregas.esMotorizado(phone).catch(() => false)))) {
    const hecho = await atenderComoAgente(depsAgente(), contact, text).catch((error) => {
      request_log(deps, 'fallo el agente operativo', error);
      return 'seguir' as const;
    });
    if (hecho !== 'seguir') return;
  }

  // Un enlace de mapa lejos del distrito de su pedido: como con el pin, se le pregunta si es ahí.
  if (result.ok && (await pinLejano(result.lat, result.lng, result.mapsUrl, `enlace de mapa (${result.source})`))) return;

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

  // Un enlace de mapa sin solicitud del reparto: puede ser la ubicacion de
  // una entrega del dia.
  if (result.ok && deps.entregas) {
    const enEntrega = await deps.entregas.alUbicacion(contact, { lat: result.lat, lng: result.lng, mapsUrl: result.mapsUrl, fuente: `enlace de mapa (${result.source})` }).catch(() => ({ atendida: false as const }));
    if (enEntrega.atendida) {
      const guardada = await repos.locations.save(contact.id, result, text);
      await repos.locations.confirm(guardada);
      if (enEntrega.responder) await responderEntrega(enEntrega);
      else await reply(textoGracias({ negocio: nombreNegocio(deps), referencia: enEntrega.entrega?.referencia }));
      await cerrarTrasUbicacion();
      return;
    }
  }

  const rule = matchRule(rules, text, { isFirstMessage, hasCoordinates: result.ok });
  if (rule) await applyRule(rule, contact, deps);

  if (!result.ok) {
    // Una regla de la tienda manda sobre el flujo: es lo que la tienda escribio
    // a mano para ese caso concreto, y encadenar las dos respuestas es
    // exactamente el "dos mensajes por uno" que hay que evitar.
    if (rule) return;

    // Con el agente operativo no hay conversacion libre: lo suyo ya se
    // atendio arriba (o lo esta pidiendo el reparto).
    if (agenteActivo()) return;

    // El asistente de IA de la tienda: con lo que sabe del negocio (y el
    // catalogo, si esta), contesta; si no puede, deriva a una persona.
    if (deps.ia?.activa()) {
      await deps.ia.turno(contact, text, { esAudio: message.type === 'audio' });
      return;
    }

    if (prefs.preventaActiva && (await preventaActiva())) {
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
        body: `Entendí esta ubicación:\n${result.mapsUrl}\n\n¿Es correcta?`,
        buttons: [
          { id: `${CONFIRM_PREFIX}${locationId}`, title: 'Sí, es esa' },
          { id: REJECT_ID, title: 'No, corregir' },
        ],
      },
    });
    return;
  }

  await repos.locations.confirm(locationId);
  // Sin coordenadas a la vista: el enlace del mapa basta. En modo GSG, ademas,
  // lo que sigue (motorizado, horario, soporte) con el texto editable de las
  // entregas, aunque este cliente no tenga pedido de hoy en la lista.
  if (deps.entregas && (deps.ajustes ? deps.ajustes.modo() : 'completo') === 'gsg') {
    await reply(deps.entregas.textoUbicacionRegistrada({ nombre: contact.name, mapa: result.mapsUrl }));
    await cerrarTrasUbicacion();
    return;
  }
  await reply(`Ubicación registrada.\n${result.mapsUrl}`);
}

/**
 * El gancho de los procesos: arma lo que trajo el mensaje con las mismas
 * piezas que usa el resto de este fichero (pin nativo, enlace de mapa, boton,
 * adjunto) y se lo pasa al nucleo de procesos. true = el proceso se quedo con
 * el mensaje. Solo mira la ubicacion si esa persona tiene algo vivo: nadie mas
 * paga la lectura de un enlace de mapa.
 */
async function atenderEnProceso(message: InboundMessage, contact: Contact, deps: InboundDeps): Promise<boolean> {
  const repo = deps.repos.procesos;
  if (!repo) return false;
  const viva = await repo.vivaPorTelefono(contact.phone);
  const reciente = viva ? null : await repo.ultimaPorTelefono(contact.phone);
  if (!viva && !(reciente && reciente.estado === 'persona')) return false;
  if (!viva) {
    // Pasado a una persona hace poco: el proceso calla su chat... salvo que ese
    // numero tenga algo vivo en las entregas o el reparto, que siguen como siempre.
    const conEntrega = deps.entregas ? (await deps.entregas.estadoUbicacionDe(contact.phone).catch(() => 'sin_entrega' as const)) !== 'sin_entrega' : false;
    const conRuta = await deps.repos.rutas.abiertaPorTelefono(contact.phone).catch(() => null);
    if (conEntrega || conRuta) return false;
  }

  const bbox = { bbox: deps.config.bbox };
  let ubicacion: EntradaProceso['ubicacion'] = null;
  let fueraDeZona = false;
  let guardar: { result: Awaited<ReturnType<typeof extractLocation>>; crudo: string } | null = null;
  const texto = message.text?.body ?? message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? message.button?.text ?? message.media?.transcripcion ?? message.media?.caption ?? '';
  if (message.type === 'location' && message.location) {
    const r = fromWhatsAppLocation(message.location, bbox);
    if (r.ok) {
      ubicacion = { lat: r.lat, lng: r.lng, mapsUrl: r.mapsUrl, fuente: 'pin de whatsapp' };
      guardar = { result: r, crudo: JSON.stringify(message.location) };
    } else if (r.reason === 'outside_bbox') fueraDeZona = true;
  } else if (message.text?.body) {
    const r = await extractLocation(message.text.body, bbox).catch(() => null);
    if (r?.ok && !r.needsConfirmation) {
      ubicacion = { lat: r.lat, lng: r.lng, mapsUrl: r.mapsUrl, fuente: `enlace de mapa (${r.source})` };
      guardar = { result: r, crudo: message.text.body };
    } else if (r && !r.ok && r.reason === 'outside_bbox') fueraDeZona = true;
  }
  const esAdjunto = ['image', 'video', 'audio', 'document', 'sticker'].includes(message.type);
  const entrada: EntradaProceso = {
    texto,
    ubicacion,
    fueraDeZona,
    adjunto: esAdjunto ? { tipo: message.type, mediaId: message.media?.id ?? null, mimeType: message.media?.mimeType ?? null, nombre: message.media?.filename ?? null } : null,
    boton: message.interactive?.button_reply?.id?.startsWith('proc:') ? message.interactive.button_reply.id : null,
  };
  const r = await atenderEntranteDeProceso(
    {
      repos: deps.repos,
      sender: deps.sender,
      nombreNegocio: () => nombreNegocio(deps),
      timezone: deps.config.timezone,
      distritos: deps.config.distritos,
      clasificar: deps.ia?.activa() ? (m) => deps.ia!.clasificarOperativo(m) : undefined,
      log: (m, d) => console.warn(`[procesos] ${m}`, d ?? ''),
    },
    contact.phone,
    entrada,
  );
  // La ubicacion que sirvio para el proceso queda tambien en el historial de ubicaciones.
  if (r.atendida && guardar?.result.ok && ubicacion) {
    const id = await deps.repos.locations.save(contact.id, guardar.result, guardar.crudo).catch(() => null);
    if (id !== null) await deps.repos.locations.confirm(id).catch(() => undefined);
  }
  return r.atendida;
}

/** Como se presenta el negocio: lo de la pantalla si se cambio, si no lo del servidor. */
function nombreNegocio(deps: Pick<InboundDeps, 'config' | 'ajustes'>): string {
  return deps.ajustes?.nombreNegocio() ?? deps.config.businessName;
}

/** Un fallo del modulo de entregas no puede dejar sin atender al cliente: se apunta y se sigue. */
function request_log(deps: Pick<InboundDeps, 'config'>, mensaje: string, error: unknown): void {
  void deps;
  console.warn(`[entregas] ${mensaje}:`, error instanceof Error ? error.message : String(error));
}
