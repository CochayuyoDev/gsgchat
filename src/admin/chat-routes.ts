/**
 * API del chat: conversaciones, hilo y envio.
 *
 * Es la misma tuberia que el resto del sistema (todo sale por `sender`, que
 * pasa por los gates), pero con la forma que necesita una pantalla de chat:
 * lista ordenada por lo mas reciente, hilo paginado hacia atras y no leidos.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { normalizePhone, type Repos } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import { providerOf, type SettingsService } from '../settings/service.js';
import { extractLocation } from '../geo/extract.js';
import { responderLectura } from '../web/cache-lectura.js';
import { alcanceChat } from '../web/alcance-chat.js';
import { esperaDeEnvio } from '../rutas/espera-envio.js';
import { createHash } from 'node:crypto';
import { despacharReportes, encolarProblemaGsg } from '../rutas/gsg.js';
import { ERRORES_MANUALES_GSG } from '../rutas/errores-manuales.js';
import type { ServicioAjustes } from '../ajustes/generales.js';
import { RETENCION_CHAT_MS } from '../whatsapp/retencion-chat.js';
import { archivoDeMensaje } from '../api/v1/archivos-gsg.js';
import type { ServicioIA } from '../ia/servicio.js';
import { CATALOGO_POR_DEFECTO, CODIGO_OTRO, TOPE_CATALOGO, clasificarConIA, nombreDeEtiqueta, validarCatalogo, type Catalogo } from '../archive/clasificar.js';
import { casosParaCatalogo, evaluarClasificador, leerConversacionEscrita, type InformeEvaluacion } from '../archive/evaluacion.js';
import { agregarEjemplo, correccionesRecientes, ejemplosParaIA, quitarEjemplo, TOPE_TEXTO_EJEMPLO } from '../chat/ejemplos-etiquetado.js';
import { TOPE_EJEMPLOS_NEGOCIO } from '../archive/clasificar.js';
import { catalogoVigente, crearEtiquetador, numeroNormalizado, type Etiquetador } from '../chat/etiquetar.js';
import { fechaDelNegocio } from '../ajustes/generales.js';
import type { EtiquetaChat } from '../db/chat-etiquetas.js';

export interface ChatDeps {
  repos: Repos;
  ajustes?: ServicioAjustes;
  sender: Sender;
  config: Config;
  settings: SettingsService;
  /** Donde se guardan los ficheros que se mandan desde el chat (y los que llegan). */
  mediaDir?: string;
  /** Envío opcional de voz solicitado por la IA; los medios entrantes se ignoran. */
  voz?: import('../voz/servicio.js').ServicioVoz;
  /** El puerto hacia GSG: por aqui sale la incidencia manual. Sin el, queda en la cola. */
  gsg?: import('../rutas/gsg.js').PuertoGsg;
  /** La IA del asistente: la usa el boton «Etiquetar los chats de hoy». */
  ia?: ServicioIA;
}

/** La etiqueta como la pinta la pantalla, junto al nombre del cliente. */
export function etiquetaParaPantalla(e: EtiquetaChat | undefined, hoy: string, catalogo?: Catalogo) {
  if (!e) return null;
  if (!e.etiqueta) return { id: null, nombre: 'Sin clasificar', dia: e.dia, hoy: e.dia === hoy, motivo: e.motivo, origen: e.origen };
  return { id: e.etiqueta, nombre: nombreDeEtiqueta(e.etiqueta, catalogo), dia: e.dia, hoy: e.dia === hoy, motivo: null, origen: e.origen };
}

/** Lo maximo que se acepta desde el chat: el limite de video/documento de WhatsApp. */
export const MAX_BYTES_ADJUNTO = 16 * 1024 * 1024;

/**
 * Lo que la pantalla puede ofrecer con el proveedor que hay puesto.
 *
 * La regla es simple y vale la pena repetirla: es mejor una accion que no
 * esta que una que esta y falla. La pantalla se dibuja a partir de esto, asi
 * que un boton solo aparece donde de verdad hace algo.
 *
 *  - eliminar para todos: la Cloud API de Meta NO lo permite; un mensaje
 *    enviado por ahi no se puede retirar, punto. Con WAHA depende del motor
 *    del contenedor, y "depende" no es suficiente para pintar un boton.
 *  - editar: idem. Solo el cliente local (Baileys) lo tiene.
 *  - presencia ("escribiendo...", "ult. vez"): solo el que tiene sesion
 *    propia y puede suscribirse al contacto.
 */
export function capacidadesDelChat(proveedor: string): {
  citar: boolean;
  reaccionar: boolean;
  eliminarParaTodos: boolean;
  editar: boolean;
  presencia: boolean;
} {
  const local = proveedor === 'local';
  return {
    citar: true,
    reaccionar: true,
    eliminarParaTodos: local,
    editar: local,
    presencia: local,
  };
}

/** Un wamid inventado por nosotros (no vino de WhatsApp): no sirve para actuar sobre el mensaje. */
export function esWamidPropio(wamid: string | null): boolean {
  return !wamid || /^(local:|web:|waha:local:)/.test(wamid);
}

/** Clasificador compartido por el endpoint de integración GSG. */
export function tipoDeAdjuntoSaliente(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  const limpio = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (['image/jpeg', 'image/png', 'image/webp'].includes(limpio)) return 'image';
  if (limpio.startsWith('video/')) return 'video';
  if (limpio.startsWith('audio/')) return 'audio';
  return 'document';
}

const sendSchema = z.object({
  phone: z.string().min(6).optional(),
  contactId: z.string().optional(),
  text: z.string().min(1).max(4000).optional(),
  /** Link de mapa o coordenadas: se manda como pin de ubicacion. */
  location: z.string().min(1).optional(),
  /** Boton nativo para pedirle la ubicacion al cliente. */
  askLocation: z.boolean().optional(),
  /** Acción explícita de la IA para sintetizar texto como audio saliente. */
  voz: z.boolean().optional(),
  /** Quien lo manda, si no es quien esta en sesion (el chat embebido de otro sistema lo dice). */
  autor: z.enum(['persona', 'ia', 'sistema']).optional(),
  autorNombre: z.string().trim().max(80).optional(),
  /** Lo escribio una persona en el chat (no la IA del panel ni una regla): el bot se calla en ese chat. */
  atiendePersona: z.boolean().optional(),
  /** Responder citando un mensaje del hilo (su id de fila, no el wamid). */
  citaId: z.coerce.number().int().positive().optional(),
  /** Fuera de la ventana de 24 h solo sale una plantilla aprobada. */
  templateName: z.string().optional(),
  templateLanguage: z.string().default('es'),
  variables: z.array(z.string()).default([]),
});

/**
 * Las entidades HTML de una etiqueta <meta> o <title> ya como texto.
 *
 * Google Maps manda el titulo como `12°04&#39;39.0"S`: la pagina del chat lo
 * escapa otra vez al pintarlo y se veia `&#39;` tal cual (30/09). Se decodifica
 * aqui, una sola vez; el que pinta sigue escapando como siempre.
 */
export function decodificarEntidades(texto: string): string {
  const nombradas: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entera, cuerpo: string) => {
    if (cuerpo[0] === '#') {
      const n = cuerpo[1] === 'x' || cuerpo[1] === 'X' ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entera;
    }
    return nombradas[cuerpo.toLowerCase()] ?? entera;
  });
}

export async function registerChatRoutes(app: FastifyInstance, deps: ChatDeps): Promise<void> {
  const { repos, sender, config, settings } = deps;
  const zonaHoraria = () => deps.ajustes?.zonaHoraria() ?? config.timezone;
  // Se crea al primer uso: hay arranques (y pruebas) que registran el chat sin base.
  let etiquetadorCreado: Etiquetador | null | undefined;
  const etiquetadorDe = (): Etiquetador | null => {
    if (etiquetadorCreado !== undefined) return etiquetadorCreado;
    const repo = repos?.chatEtiquetas;
    etiquetadorCreado = repo
      ? crearEtiquetador({
          repo,
          ia: () => (deps.ia?.estado().tieneToken ? { completar: (m, o) => deps.ia!.completar(m, o) } : null),
          zonaHoraria,
          nombreNegocio: () => deps.ajustes?.nombreNegocio() ?? config.businessName,
          log: (mensaje, detalle) => app.log.warn({ ...detalle }, mensaje),
        })
      : null;
    return etiquetadorCreado;
  };
  /** Las etiquetas de esos chats (por su numero normalizado), listas para la pantalla. */
  const etiquetasDe = async (phones: string[]) => {
    const hoy = fechaDelNegocio(new Date(), zonaHoraria());
    const ultimas = repos.chatEtiquetas ? await repos.chatEtiquetas.ultimas([...new Set(phones.map(numeroNormalizado))]).catch(() => new Map<string, EtiquetaChat>()) : new Map<string, EtiquetaChat>();
    const catalogo = repos.chatEtiquetas && ultimas.size ? await catalogoVigente(repos.chatEtiquetas).catch(() => CATALOGO_POR_DEFECTO) : CATALOGO_POR_DEFECTO;
    return (phone: string) => etiquetaParaPantalla(ultimas.get(numeroNormalizado(phone)), hoy, catalogo);
  };

  const SIN_ETIQUETAS = 'Esta instalación no guarda etiquetas de chats.';
  const quienEs = (u: { nombre?: string; usuario?: string } | null | undefined): string | null => u?.nombre || u?.usuario || null;

  /**
   * «Etiquetar los chats de hoy»: arranca el lote en segundo plano, o devuelve
   * el que ya corre. La pantalla pregunta por el avance. GSG ve cada etiqueta
   * como la nota del chat en GET /api/v1/historial.
   */
  app.post('/admin/chat/etiquetar', async (request, reply) => {
    const etiquetador = etiquetadorDe();
    if (!etiquetador) return reply.code(409).send({ error: SIN_ETIQUETAS });
    const alcance = alcanceChat(request.usuario);
    // releer: tambien los ya etiquetados (por ejemplo tras cambiar el catalogo). Por defecto, solo lo que falta.
    const { releer } = z.object({ releer: z.boolean().optional() }).parse(request.body ?? {});
    try {
      return reply.code(202).send(etiquetador.iniciar(alcance, { iniciadoPor: quienEs(request.usuario), releer }));
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error), ir: '/panel#ia' });
    }
  });

  /** El lote en marcha, o el ultimo (aunque el servidor se haya reiniciado). */
  app.get('/admin/chat/etiquetar', async (_request, reply) => {
    const etiquetador = etiquetadorDe();
    if (!etiquetador) return reply.code(409).send({ error: SIN_ETIQUETAS });
    return { ...(await etiquetador.estado()), hayIA: etiquetador.hayIA() };
  });

  /**
   * Poner o quitar a mano la etiqueta de hoy de un chat (`etiqueta: null` la
   * quita). Queda como manual: la IA no la pisa. GSG la ve al momento en el
   * historial del chat. No se le escribe nada al cliente.
   */
  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/etiqueta', async (request, reply) => {
    const etiquetador = etiquetadorDe();
    if (!etiquetador) return reply.code(409).send({ error: SIN_ETIQUETAS });
    alcanceChat(request.usuario);
    const body = z.object({ etiqueta: z.string().trim().regex(/^[a-z][a-z0-9_]{1,59}$/, 'etiqueta no válida').nullable() }).parse(request.body ?? {});
    const contacto = await repos.contacts.getById(request.params.contactId);
    if (!contacto) return reply.code(404).send({ error: 'Ese chat no existe.' });
    if (contacto.tipo === 'grupo') return reply.code(400).send({ error: 'Los grupos no se etiquetan.' });
    try {
      await etiquetador.etiquetarAMano({ phone: contacto.phone, etiqueta: body.etiqueta, quien: quienEs(request.usuario) });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
    return { ok: true, etiqueta: (await etiquetasDe([contacto.phone]))(contacto.phone) };
  });

  /**
   * El embudo de chats de un dia (hoy por defecto): cuantos hay de cada
   * etiqueta, cuantos los puso la IA y cuantos una persona y los que faltan;
   * y la lista de chats con su etiqueta.
   */
  app.get('/admin/chat/etiquetas/embudo', async (request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    const alcance = alcanceChat(request.usuario);
    const q = z.object({ dia: z.string().regex(/^(hoy|ayer|\d{4}-\d{2}-\d{2})$/, 'El día va como hoy, ayer o AAAA-MM-DD.').default('hoy') }).parse(request.query ?? {});
    const zona = zonaHoraria();
    const hoy = fechaDelNegocio(new Date(), zona);
    const dia = q.dia === 'hoy' ? hoy : q.dia === 'ayer' ? fechaDelNegocio(new Date(Date.now() - 86_400_000), zona) : q.dia;
    const [filas, catalogo, bandeja] = await Promise.all([
      repos.chatEtiquetas.delDia(dia),
      catalogoVigente(repos.chatEtiquetas),
      conversacionesConEtiqueta({ incluirApartados: true }, alcance),
    ]);
    const deBandeja = new Map(bandeja.map((c) => [numeroNormalizado(c.phone), c]));
    const conEtiqueta = new Set(filas.map((f) => f.phone));
    const chats = filas.map((f) => {
      const c = deBandeja.get(f.phone);
      return {
        phone: f.phone,
        contactId: c?.contactId ?? null,
        nombre: c?.name ?? null,
        ultimoMensaje: c?.lastMessage ? { body: c.lastMessage.body, direction: c.lastMessage.direction, at: c.lastMessage.createdAt } : null,
        etiqueta: f.etiqueta,
        nombreEtiqueta: f.etiqueta ? nombreDeEtiqueta(f.etiqueta, catalogo) : 'Sin clasificar',
        origen: f.origen,
        motivo: f.motivo,
        en: f.updatedAt,
      };
    });
    // Los chats de ese dia que aun no tienen etiqueta (los de la bandeja cuyo ultimo mensaje es de ese dia).
    const sinEtiquetar = bandeja
      .filter((c) => c.lastMessage && fechaDelNegocio(new Date(c.lastMessage.createdAt), zona) === dia && !conEtiqueta.has(numeroNormalizado(c.phone)))
      .map((c) => ({ phone: numeroNormalizado(c.phone), contactId: c.contactId, nombre: c.name, ultimoMensaje: c.lastMessage ? { body: c.lastMessage.body, direction: c.lastMessage.direction, at: c.lastMessage.createdAt } : null }));
    const etapas = new Map(catalogo.map((e) => [e.codigo, { codigo: e.codigo, nombre: e.nombre, ia: 0, manual: 0 }]));
    for (const f of filas) {
      if (!f.etiqueta) continue;
      const e = etapas.get(f.etiqueta) ?? { codigo: f.etiqueta, nombre: nombreDeEtiqueta(f.etiqueta, catalogo), ia: 0, manual: 0 };
      if (f.origen === 'manual') e.manual++;
      else e.ia++;
      etapas.set(f.etiqueta, e);
    }
    const etiquetadas = filas.filter((f) => f.etiqueta);
    return {
      dia,
      hoy: dia === hoy,
      resumen: {
        chats: filas.length + sinEtiquetar.length,
        etiquetados: etiquetadas.length,
        porIA: etiquetadas.filter((f) => f.origen !== 'manual').length,
        manual: etiquetadas.filter((f) => f.origen === 'manual').length,
        sinClasificar: filas.length - etiquetadas.length,
        sinEtiquetar: sinEtiquetar.length,
      },
      etapas: [...etapas.values()].map((e) => ({ ...e, total: e.ia + e.manual })).sort((a, b) => b.total - a.total),
      chats,
      sinEtiquetar,
    };
  });

  /** Los ultimos lotes, el mas reciente primero. */
  app.get('/admin/chat/etiquetar/lotes', async (request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    const q = z.object({ limit: z.coerce.number().int().positive().max(100).default(20) }).parse(request.query ?? {});
    return { items: await repos.chatEtiquetas.lotes(q.limit) };
  });

  /** Un lote con su registro de eventos, sus chats y las conversaciones de ese dia. */
  app.get<{ Params: { id: string } }>('/admin/chat/etiquetar/lotes/:id', async (request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    const lote = await repos.chatEtiquetas.lote(request.params.id);
    if (!lote) return reply.code(404).send({ error: 'Ese lote no existe.' });
    const [eventos, filas, chats, catalogo] = await Promise.all([
      repos.chatEtiquetas.eventos({ loteId: lote.id, limite: 500 }),
      repos.chatEtiquetas.delDia(lote.dia),
      repos.chatEtiquetas.chatsDelLote(lote.id),
      catalogoVigente(repos.chatEtiquetas),
    ]);
    return {
      lote,
      eventos,
      // Los chats de ESTE lote: como le fue a cada uno.
      chats: chats.map((c) => ({
        phone: c.phone,
        nombre: c.nombre,
        mensajes: c.totalMensajes,
        estado: c.estado,
        etiqueta: c.etiqueta,
        nombreEtiqueta: c.etiqueta ? nombreDeEtiqueta(c.etiqueta, catalogo) : null,
        error: c.error,
        procesadoAt: c.procesadoAt,
      })),
      // Todas las conversaciones de ese dia, con su etiqueta vigente.
      conversaciones: filas.map((f) => ({
        phone: f.phone,
        etiqueta: f.etiqueta,
        nombre: f.etiqueta ? nombreDeEtiqueta(f.etiqueta, catalogo) : 'Sin clasificar',
        origen: f.origen,
        motivo: f.motivo,
        loteId: f.loteId,
      })),
    };
  });

  /** La copia de los mensajes que el lote le mando a la IA de un chat (mientras no pase la retencion). */
  app.get<{ Params: { id: string; telefono: string } }>('/admin/chat/etiquetar/lotes/:id/chats/:telefono', async (request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    const chat = await repos.chatEtiquetas.chatDelLote(request.params.id, numeroNormalizado(request.params.telefono));
    if (!chat) return reply.code(404).send({ error: 'Ese chat no está en ese lote.' });
    return {
      chat: { ...chat, nombreEtiqueta: chat.etiqueta ? nombreDeEtiqueta(chat.etiqueta, await catalogoVigente(repos.chatEtiquetas)) : null },
      ...(chat.mensajes === null && chat.estado !== 'solo_envio' ? { aviso: 'La copia de los mensajes ya no se guarda: pasaron las 72 horas de retención del chat.' } : {}),
    };
  });

  /** El catalogo de etiquetas del negocio: codigos, nombres y lo que lee la IA de cada una. */
  app.get('/admin/chat/etiquetas/catalogo', async (_request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    const propio = await repos.chatEtiquetas.catalogo();
    return { items: propio ?? CATALOGO_POR_DEFECTO, propio: Boolean(propio), codigoOtro: CODIGO_OTRO, tope: TOPE_CATALOGO };
  });

  /** Guarda el catalogo entero. Solo un administrador. Lo ya etiquetado con otro catalogo se vuelve a mirar en el siguiente lote. */
  app.put('/admin/chat/etiquetas/catalogo', async (request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    if (request.usuario?.rol !== 'admin' || request.usuario.porToken) return reply.code(403).send({ error: 'Solo un administrador cambia el catálogo de etiquetas.' });
    const body = z.object({ items: z.array(z.object({ codigo: z.string().max(80), nombre: z.string().max(200), descripcion: z.string().max(400) })).max(100) }).parse(request.body ?? {});
    const r = validarCatalogo(body.items);
    if (!r.ok) return reply.code(400).send({ error: r.error });
    await repos.chatEtiquetas.guardarCatalogo(r.catalogo);
    return { ok: true, items: r.catalogo, propio: true };
  });

  /** Vuelve al catalogo de fabrica. Solo un administrador. */
  app.delete('/admin/chat/etiquetas/catalogo', async (request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    if (request.usuario?.rol !== 'admin' || request.usuario.porToken) return reply.code(403).send({ error: 'Solo un administrador cambia el catálogo de etiquetas.' });
    await repos.chatEtiquetas.borrarCatalogo();
    return { ok: true, items: CATALOGO_POR_DEFECTO, propio: false };
  });

  // ------------------------------------------------------- «Probar la IA»
  // El banco de conversaciones de src/archive/evaluacion.ts, por la IA del
  // negocio y con su catalogo: el mismo clasificador del boton. Una prueba a la
  // vez; lo ultimo queda en memoria del proceso (no toca ningun chat ni GSG).
  const iaQueCompleta = () => (deps.ia?.estado().tieneToken ? { completar: deps.ia.completar.bind(deps.ia) } : null);
  const modeloDeIA = () => {
    const e = deps.ia?.estado();
    return e ? `${e.modeloEfectivo || e.modelo}` : null;
  };
  const NO_HAY_IA_PRUEBA = 'Para probar la IA hace falta su clave: guárdala en Avanzado → Asistente IA. No hace falta activar el asistente.';
  let evaluacion: {
    enCurso: boolean;
    hechos: number;
    total: number;
    modelo: string | null;
    empezo: string;
    termino: string | null;
    error: string | null;
    informe: InformeEvaluacion | null;
  } | null = null;

  /** Empieza a pasar el banco por la IA (o devuelve la prueba que ya corre). */
  app.post('/admin/chat/etiquetas/evaluar', async (_request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    const ia = iaQueCompleta();
    if (!ia) return reply.code(409).send({ error: NO_HAY_IA_PRUEBA, ir: '/panel#ia' });
    if (evaluacion?.enCurso) return reply.code(202).send(evaluacion);
    const catalogo = await catalogoVigente(repos.chatEtiquetas);
    const ejemplos = await ejemplosParaIA(repos.chatEtiquetas, catalogo);
    const actual = (evaluacion = { enCurso: true, hechos: 0, total: casosParaCatalogo(catalogo).usar.length, modelo: modeloDeIA(), empezo: new Date().toISOString(), termino: null, error: null, informe: null });
    void evaluarClasificador(ia, catalogo, deps.ajustes?.nombreNegocio() ?? config.businessName, {
      alAvanzar: (hechos, total) => Object.assign(actual, { hechos, total }),
      ejemplos,
    })
      .then((informe) => Object.assign(actual, { informe }))
      .catch((error) => Object.assign(actual, { error: error instanceof Error ? error.message : String(error) }))
      .finally(() => Object.assign(actual, { enCurso: false, termino: new Date().toISOString() }));
    return reply.code(202).send(actual);
  });

  /** La prueba en marcha o la ultima de este proceso (null si no hubo). */
  app.get('/admin/chat/etiquetas/evaluar', async (_request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    return { evaluacion, hayIA: Boolean(iaQueCompleta()), modelo: modeloDeIA() };
  });

  /**
   * Una conversacion escrita a mano («cliente: ...» / «negocio: ...» por
   * linea): que etiqueta le pone la IA. No se guarda nada ni sale nada a GSG.
   */
  app.post('/admin/chat/etiquetas/probar', async (request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    const ia = iaQueCompleta();
    if (!ia) return reply.code(409).send({ error: NO_HAY_IA_PRUEBA, ir: '/panel#ia' });
    const { texto } = z.object({ texto: z.string().max(8000) }).parse(request.body ?? {});
    const mensajes = leerConversacionEscrita(texto);
    if (!mensajes.some((m) => m.direction === 'in')) return reply.code(400).send({ error: 'Escribe al menos un mensaje del cliente (una línea que empiece por «cliente:»).' });
    const catalogo = await catalogoVigente(repos.chatEtiquetas);
    const ejemplos = await ejemplosParaIA(repos.chatEtiquetas, catalogo);
    const r = await clasificarConIA(ia, mensajes, null, deps.ajustes?.nombreNegocio() ?? config.businessName, { catalogo, conReglas: false, ejemplos, uso: 'pruebas' });
    if (r.estado !== 'clasificada') return { etiqueta: null, nombre: null, motivo: r.motivo, mensajes: mensajes.length, modelo: modeloDeIA() };
    const e = catalogo.find((x) => x.codigo === r.etiqueta);
    return { etiqueta: r.etiqueta, nombre: nombreDeEtiqueta(r.etiqueta, catalogo), descripcion: e?.descripcion ?? null, motivo: null, mensajes: mensajes.length, modelo: modeloDeIA() };
  });

  // ------------------------------------------ «Enséñale a etiquetar» (Entrenamiento IA)

  /** Los ejemplos de etiquetado del negocio (van en cada llamada del clasificador). */
  app.get('/admin/chat/etiquetas/ejemplos', async (_request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    const catalogo = await catalogoVigente(repos.chatEtiquetas);
    const items = (await repos.chatEtiquetas.ejemplos()).map((e) => ({ ...e, nombreEtiqueta: nombreDeEtiqueta(e.etiqueta, catalogo), enCatalogo: catalogo.some((c) => c.codigo === e.etiqueta) }));
    return { items, tope: TOPE_EJEMPLOS_NEGOCIO, topeTexto: TOPE_TEXTO_EJEMPLO };
  });

  /** Enseña un ejemplo: `{ texto, etiqueta, fuente? }` (fuente = la corrección de la que sale). Lo personal se tapa. */
  app.post('/admin/chat/etiquetas/ejemplos', async (request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    const body = z.object({ texto: z.string().max(4000), etiqueta: z.string().trim().max(60), fuente: z.string().trim().max(200).nullable().optional() }).parse(request.body ?? {});
    const r = await agregarEjemplo(repos.chatEtiquetas, await catalogoVigente(repos.chatEtiquetas), { ...body, quien: quienEs(request.usuario) });
    if (!r.ok) return reply.code(400).send({ error: r.error });
    return { ok: true, ejemplo: r.ejemplo };
  });

  /** Quita un ejemplo. */
  app.delete<{ Params: { id: string } }>('/admin/chat/etiquetas/ejemplos/:id', async (request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    if (!(await quitarEjemplo(repos.chatEtiquetas, request.params.id))) return reply.code(404).send({ error: 'Ese ejemplo ya no existe.' });
    return { ok: true };
  });

  /** Las correcciones de la etiqueta de la IA que hizo el equipo y aún no son ejemplo, con la conversación que leyó la IA. */
  app.get('/admin/chat/etiquetas/correcciones', async (_request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    return { items: await correccionesRecientes(repos.chatEtiquetas, await catalogoVigente(repos.chatEtiquetas)) };
  });

  /** El registro de lo que paso al etiquetar y al mandar a GSG, filtrable. */
  app.get('/admin/chat/etiquetar/eventos', async (request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    const q = z
      .object({
        loteId: z.string().uuid().optional(),
        nivel: z.enum(['info', 'aviso', 'error']).optional(),
        fase: z.enum(['lote', 'analisis', 'sincronizacion']).optional(),
        telefono: z.string().trim().max(40).optional(),
        limit: z.coerce.number().int().positive().max(500).default(100),
      })
      .parse(request.query ?? {});
    return {
      items: await repos.chatEtiquetas.eventos({ loteId: q.loteId, nivel: q.nivel, fase: q.fase, phone: q.telefono ? numeroNormalizado(q.telefono) : undefined, limite: q.limit }),
    };
  });

  /**
   * Si la ventana de 24 h impide escribir texto libre.
   *
   * Es una regla de Meta, no nuestra: la Cloud API rechaza el mensaje. Con un
   * cliente no oficial no existe tal cosa, y aplicarla igual seria inventarse
   * una limitacion que el propio WhatsApp Web no tiene.
   */
  const ventanaObliga = () => providerOf(settings.current()) === 'cloud';

  /**
   * Si un envio escrito a mano puede saltarse las guardas de consentimiento y
   * volumen.
   *
   * Solo fuera de la Cloud API. Con Meta detras no es una decision nuestra:
   * la API rechaza el texto libre fuera de la ventana y exige el opt-in, asi
   * que saltarselo aqui solo serviria para mandar peticiones condenadas y
   * apuntar como enviado algo que no salio. Con un cliente no oficial no hay
   * tal regla, y el chat se comporta como el WhatsApp Web de siempre.
   */
  const aMano = () => !ventanaObliga();

  /**
   * Un grupo solo existe con el WhatsApp conectado por QR (Baileys): la
   * Cloud API de Meta no tiene grupos y WAHA no los trae por este camino.
   */
  const gruposDisponibles = () => providerOf(settings.current()) === 'local';
  const SIN_GRUPOS = 'Los grupos solo se pueden atender con el WhatsApp conectado por QR.';
  // Con la API de Meta hay boton nativo; con el QR no (llegan rotos a una
  // cuenta personal), asi que el texto explica el clip en vez de un boton
  // que no existe.
  const textoPedirUbicacion = () =>
    providerOf(settings.current()) === 'cloud' || config.WHATSAPP_NATIVE_BUTTONS
      ? 'Comparte tu ubicación con el botón de aquí abajo, por favor.'
      : '¿Nos compartes tu ubicación, por favor? Desde el clip 📎 → Ubicación → Enviar tu ubicación actual.';

  /**
   * El mensaje del hilo, listo para citarlo, reaccionarlo, borrarlo o editarlo.
   *
   * Se busca SIEMPRE dentro de la conversacion, no por id suelto: asi un id
   * inventado no deja actuar sobre el mensaje de otro cliente. Y se comprueba
   * que tenga identificador de WhatsApp de verdad: sobre un mensaje que solo
   * existe aqui (los importados, los de la web) WhatsApp no sabe actuar.
   */
  const citaDelHilo = async (
    contactId: string,
    mensajeId: number,
  ): Promise<{ id: string; fromMe: boolean; texto: string; participant?: string; autor?: string } | { error: string }> => {
    const m = await repos.messages.porId(contactId, mensajeId);
    if (!m) return { error: 'ese mensaje no está en esta conversación' };
    if (esWamidPropio(m.wamid)) {
      return { error: 'ese mensaje no tiene identificador de WhatsApp (llegó importado): no se puede responder ni actuar sobre él' };
    }
    // En un grupo, quien lo escribio: sin esto la cita sale sin autor.
    const autor = (m.payload as { autor?: { telefono?: string | null; nombre?: string | null } } | null)?.autor;
    return {
      id: m.wamid!,
      fromMe: m.direction === 'out',
      texto: (m.body ?? '').slice(0, 300),
      ...(autor?.telefono ? { participant: `${autor.telefono}@s.whatsapp.net` } : {}),
      ...(autor?.nombre ? { autor: autor.nombre } : {}),
    };
  };

  /**
   * Todas las conversaciones de la bandeja (sin grupos) con su etiqueta, para
   * filtrar y contar por etiqueta. La bandeja es la de las ultimas 72 horas:
   * se leen de a 100 hasta un tope, que de sobra cubre un dia de reparto.
   */
  const TOPE_FILTRO_ETIQUETA = 3000;
  const conversacionesConEtiqueta = async (filtro: { q?: string; incluirApartados?: boolean }, alcance: ReturnType<typeof alcanceChat>) => {
    const todas: Awaited<ReturnType<typeof repos.messages.listConversations>> = [];
    for (let offset = 0; offset < TOPE_FILTRO_ETIQUETA; offset += 100) {
      const tanda = await repos.messages.listConversations({ ...filtro, limit: 100, offset, alcance });
      todas.push(...tanda);
      if (tanda.length < 100) break;
    }
    const personas = todas.filter((c) => c.tipo !== 'grupo');
    const etiqueta = await etiquetasDe(personas.map((c) => c.phone));
    return personas.map((c) => ({ ...c, etiqueta: etiqueta(c.phone) }));
  };
  /**
   * Si una conversacion pasa el filtro de etiqueta: un codigo del catalogo,
   * `sin_clasificar` (la IA no pudo) o `sin_etiquetar` (aun no se etiqueto).
   */
  const pasaEtiqueta = (e: ReturnType<typeof etiquetaParaPantalla>, filtro: string): boolean => {
    if (filtro === 'sin_etiquetar') return !e;
    if (filtro === 'sin_clasificar') return Boolean(e && !e.id);
    return Boolean(e && e.id === filtro);
  };

  app.get('/admin/chat/conversations', async (request, reply) => {
    const query = z
      .object({
        q: z.string().max(120).optional(),
        limit: z.coerce.number().int().positive().max(100).default(30),
        offset: z.coerce.number().int().nonnegative().default(0),
        /** Los chats apartados solo salen cuando se piden. */
        incluirApartados: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
        /** Solo los de esa etiqueta (codigo del catalogo, sin_clasificar o sin_etiquetar). */
        etiqueta: z.string().trim().regex(/^[a-z][a-z0-9_]{1,59}$/, 'etiqueta no válida').optional(),
      })
      .parse(request.query ?? {});
    const alcance = alcanceChat(request.usuario);
    const comun = {
      unread: await repos.messages.unreadTotal(undefined, alcance),
      scopeId: request.usuario?.chatSesion?.sid ?? 'api',
      vistaDesde: request.usuario?.chatSesion?.desde.toISOString() ?? null,
    };
    if (query.etiqueta) {
      // Se filtra en el servidor sobre TODA la bandeja, no sobre la pagina cargada.
      const filtradas = (await conversacionesConEtiqueta(query, alcance)).filter((c) => pasaEtiqueta(c.etiqueta, query.etiqueta!));
      const pagina = filtradas.slice(query.offset, query.offset + query.limit);
      const hay = filtradas.length > query.offset + query.limit;
      return responderLectura(request, reply, { items: pagina, hasMore: hay, siguienteOffset: hay ? query.offset + query.limit : null, total: filtradas.length, ...comun });
    }
    const items = await repos.messages.listConversations({ ...query, limit: query.limit + 1, alcance });
    const pagina = items.slice(0, query.limit);
    const etiqueta = await etiquetasDe(pagina.filter((c) => c.tipo !== 'grupo').map((c) => c.phone));
    return responderLectura(request, reply, {
      items: pagina.map((c) => ({ ...c, etiqueta: c.tipo === 'grupo' ? null : etiqueta(c.phone) })),
      hasMore: items.length > query.limit,
      siguienteOffset: items.length > query.limit ? query.offset + query.limit : null,
      ...comun,
    });
  });

  /**
   * Cuantas conversaciones de la bandeja hay con cada etiqueta, para el
   * filtro: las del catalogo vigente (aunque tengan 0) y las de antes que aun
   * se vean, mas sin clasificar y sin etiquetar.
   */
  app.get('/admin/chat/etiquetas/conteo', async (request, reply) => {
    if (!repos?.chatEtiquetas) return reply.code(409).send({ error: SIN_ETIQUETAS });
    const alcance = alcanceChat(request.usuario);
    const [todas, catalogo] = await Promise.all([conversacionesConEtiqueta({ incluirApartados: true }, alcance), catalogoVigente(repos.chatEtiquetas)]);
    const porCodigo = new Map<string, { codigo: string; nombre: string; n: number }>(catalogo.map((e) => [e.codigo, { codigo: e.codigo, nombre: e.nombre, n: 0 }]));
    let sinClasificar = 0;
    let sinEtiquetar = 0;
    for (const c of todas) {
      const e = c.etiqueta;
      if (!e) sinEtiquetar++;
      else if (!e.id) sinClasificar++;
      else {
        const fila = porCodigo.get(e.id) ?? { codigo: e.id, nombre: e.nombre, n: 0 };
        fila.n++;
        porCodigo.set(e.id, fila);
      }
    }
    return { total: todas.length, etiquetas: [...porCodigo.values()], sinClasificar, sinEtiquetar };
  });

  /**
   * La ficha del cliente para el panel lateral de Chats: quien es, si se le
   * puede escribir, su pedido de hoy (si lo hay), su ultima ubicacion y
   * cuantas conversaciones guardadas tiene. Solo lectura.
   */
  app.get<{ Params: { contactId: string } }>('/admin/chat/:contactId/ficha', async (request, reply) => {
    const alcance = alcanceChat(request.usuario);
    if (!(await repos.messages.iniciadaEnAlcance(request.params.contactId, alcance))) return reply.code(404).send({ error: 'contacto no encontrado' });
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    const ubicacion = await repos.locations.latestFor(contact.id).catch(() => null);
    let entrega: Record<string, unknown> | null = null;
    try {
      const viva = await repos.entregas.vivaPorTelefono(contact.phone);
      const e = viva ?? (await repos.entregas.listar({ estados: ['entregada'], limit: 500 })).filter((x) => x.phone === contact.phone).pop() ?? null;
      if (e) {
        const m = e.motorizadoId ? await repos.entregas.motorizado(e.motorizadoId).catch(() => null) : null;
        entrega = { id: e.id, referencia: e.referencia, estado: e.estado, direccion: e.direccion, distrito: e.distrito, ubicacionEstado: e.ubicacionEstado, confirmacionEstado: e.confirmacionEstado, motorizado: m ? { nombre: m.nombre, phone: m.phone } : null, llegaAproxAt: e.llegaAproxAt, entregadaAt: e.entregadaAt, incidencia: e.incidencia, prioridad: e.prioridad };
      }
    } catch {
      entrega = null;
    }
    const guardadas = 0;
    return {
      contacto: { id: contact.id, phone: contact.phone, name: contact.name, tipo: contact.tipo ?? 'persona', optInAt: contact.optInAt, optOutAt: contact.optOutAt, lastInboundAt: contact.lastInboundAt, botPausadoAt: contact.botPausadoAt ?? null, iaCerradaAt: contact.iaCerradaAt ?? null },
      ubicacion: ubicacion ? { lat: ubicacion.lat, lng: ubicacion.lng, mapa: `https://www.google.com/maps/search/?api=1&query=${ubicacion.lat},${ubicacion.lng}` } : null,
      entrega,
      guardadas,
    };
  });

  app.get<{ Params: { contactId: string } }>('/admin/chat/:contactId', async (request, reply) => {
    const query = z
      .object({
        limit: z.coerce.number().int().positive().max(100).default(30),
        before: z.coerce.number().int().positive().optional(),
        /** Abrir el chat marca lo entrante como leido; refrescar en segundo plano no. */
        read: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
      })
      .parse(request.query ?? {});

    const alcance = alcanceChat(request.usuario);
    // El chat existe cuando el sistema le escribio (ver iniciadaEnAlcance): antes no hay nada que abrir.
    if (!(await repos.messages.iniciadaEnAlcance(request.params.contactId, alcance))) return reply.code(404).send({ error: 'Todavía no hay chat con este cliente: el sistema aún no le ha escrito. El chat aparece cuando sale el primer mensaje.' });
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });

    const messages = await repos.messages.listMessages(contact.id, query.limit + 1, query.before, undefined, alcance);
    const hasMore = messages.length > query.limit;
    // Foto, audio o video del cliente: el mismo enlace firmado que recibe GSG en el historial
    // (relativo, para que valga con el prefijo de la tienda), para verlo o escucharlo aquí.
    const pagina = messages.slice(-query.limit).map(m => ({
      ...m,
      expiresAt: new Date((m.storedAt ?? m.createdAt).getTime() + RETENCION_CHAT_MS).toISOString(),
      archivo: archivoDeMensaje(m, { publicBase: '.', secreto: config.TRACKING_SECRET }),
    }));
    if (query.read) await repos.messages.markRead(contact.id, new Date());
    // La solicitud de reparto abierta, si la hay: el pedido y en que punto va,
    // para que quien atiende lo vea sin cambiar de pantalla (y para {pedido}).
    const abierta = await repos.rutas.abiertaPorTelefono(contact.phone).catch(() => null);
    const reparto = abierta ? { id: abierta.id, referencia: abierta.referencia, estado: abierta.estado, direccion: abierta.direccion, distrito: abierta.distrito, intentos: abierta.intentos, proximoIntentoAt: abierta.proximoIntentoAt, esperaEnvio: esperaDeEnvio(repos.rutas, abierta) } : null;

    const now = Date.now();
    const windowOpen = Boolean(
      contact.lastInboundAt && now - contact.lastInboundAt.getTime() < 24 * 60 * 60 * 1000,
    );

    // En un grupo no hay ventana de 24 h ni consentimiento: se escribe como
    // en el telefono, siempre que el proveedor tenga grupos.
    // Lo que este proveedor sabe hacer, para que la pantalla no pinte botones
    // que no funcionan. Se manda con el hilo porque cambia al cambiar de
    // proveedor, y la pantalla no tiene por que saber cual hay puesto.
    const puede = capacidadesDelChat(providerOf(settings.current()));

    if (contact.tipo === 'grupo') {
      return responderLectura(request, reply, {
        contact,
        reparto: null,
        windowOpen: true,
        canWrite: gruposDisponibles(),
        blockedReason: gruposDisponibles() ? null : SIN_GRUPOS,
        messages: pagina,
        scopeId: request.usuario?.chatSesion?.sid ?? 'api',
        vistaDesde: request.usuario?.chatSesion?.desde.toISOString() ?? null,
        hasMore,
        beforeCursor: pagina[0]?.id ?? null,
        puede,
      });
    }

    const etiqueta = (await etiquetasDe([contact.phone]))(contact.phone);
    return responderLectura(request, reply, {
      contact,
      etiqueta,
      reparto,
      windowOpen,
      // Lo que el operador puede escribir ahora mismo, y por que.
      canWrite: (windowOpen || !ventanaObliga()) && !contact.optOutAt,
      blockedReason: contact.optOutAt
        ? 'el contacto se dio de baja'
        : windowOpen || !ventanaObliga()
          ? null
          : 'la ventana de 24 h esta cerrada: solo se puede enviar una plantilla',
      messages: pagina,
      scopeId: request.usuario?.chatSesion?.sid ?? 'api',
      vistaDesde: request.usuario?.chatSesion?.desde.toISOString() ?? null,
      hasMore,
      beforeCursor: pagina[0]?.id ?? null,
      puede,
    });
  });

  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/sync', async (request, reply) => {
    const body = z.object({
      afterId: z.string().regex(/^\d{1,20}$/),
      knownIds: z.array(z.string().regex(/^\d{1,20}$/)).max(300).default([]),
    }).parse(request.body ?? {});
    const alcance = alcanceChat(request.usuario);
    if (!(await repos.messages.iniciadaEnAlcance(request.params.contactId, alcance))) return reply.code(404).send({ error: 'contacto no encontrado' });
    const limite = 30;
    const filas = await repos.messages.syncMessages(request.params.contactId, body.afterId, body.knownIds, limite + 1 + body.knownIds.length, alcance);
    const conocidos = new Set(body.knownIds);
    const nuevos = filas.filter(m => BigInt(m.id) > BigInt(body.afterId) && !conocidos.has(String(m.id)));
    const visiblesNuevos = nuevos.slice(0, limite);
    const conocidasActualizadas = filas.filter(m => conocidos.has(String(m.id)));
    const visibles = [...visiblesNuevos, ...conocidasActualizadas].sort((a,b) => a.id-b.id);
    const goneIds = body.knownIds.filter(id => !conocidasActualizadas.some(m => String(m.id) === id));
    const nextAfterId = visiblesNuevos.length ? String(visiblesNuevos.at(-1)!.id) : body.afterId;
    return responderLectura(request, reply, {
      // Con el mismo `archivo` que el hilo completo: si faltara, la pantalla sustituye el mensaje
      // que ya pintaba por esta version y la foto, el audio o el video desaparecen hasta recargar.
      messages: visibles.map(m => ({
        ...m,
        expiresAt: new Date((m.storedAt ?? m.createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
        archivo: archivoDeMensaje(m, { publicBase: '.', secreto: config.TRACKING_SECRET }),
      })),
      goneIds,
      hasMoreNew: nuevos.length > limite,
      nextAfterId,
      scopeId: request.usuario?.chatSesion?.sid ?? 'api',
    });
  });

  app.post('/admin/chat/:contactId/read', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    await repos.messages.markRead(contact.id, new Date());
    return { ok: true };
  });

  /**
   * Parar o soltar el bot en ESTE chat.
   *
   * Es la forma de decir "de esta conversacion me encargo yo": los mensajes
   * del cliente siguen entrando y guardandose, y se le puede escribir a mano
   * como siempre; lo unico que se calla es la respuesta automatica.
   *
   * No caduca. Un bot que vuelve a hablar solo al dia siguiente, en medio de
   * un reclamo que alguien estaba atendiendo, es peor que no haberlo parado.
   */
  app.post('/admin/chat/:contactId/bot', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const body = z.object({ pausado: z.boolean() }).parse(request.body ?? {});

    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });

    await repos.contacts.pausarBot(contact.id, body.pausado, new Date());
    return { ok: true, pausado: body.pausado };
  });

  /**
   * Incidencia manual a GSG: una persona reporta un error del pedido con el
   * tipo que elige y un resumen propio. Sale por la misma cola y el mismo
   * conector que el resto de incidencias (`problemaParaGsg`): el tipo viaja
   * como `codigo` y el resumen como `comentario`.
   */
  const TIPO_MANUAL = 'incidencia-manual';
  const tiposManuales = () => ERRORES_MANUALES_GSG.map(e => ({ codigo: e.codigo, titulo: e.titulo }));
  const trackingDe = (e: { referencia: string; datosEnvio?: { tracking?: string | null } | null }) => e.datosEnvio?.tracking || e.referencia;

  /** Los trackings que el cliente tiene GUARDADOS (pedidos vivos y solicitud abierta): la unica fuente de lo que se manda a GSG. */
  const trackingsGuardados = async (phone: string) => {
    const vistos = new Map<string, { tracking: string; referencia: string; cliente: string | null; dia: string | null; entregaId: number | null }>();
    for (const e of await repos.entregas.vivasPorTelefono(phone).catch(() => [])) {
      vistos.set(trackingDe(e), { tracking: trackingDe(e), referencia: e.referencia, cliente: e.nombre, dia: e.dia, entregaId: e.id });
    }
    const sol = await repos.rutas.abiertaPorTelefono(phone).catch(() => null);
    if (sol?.referencia && !vistos.has(sol.referencia) && ![...vistos.values()].some((v) => v.referencia === sol.referencia)) {
      vistos.set(sol.referencia, { tracking: sol.referencia, referencia: sol.referencia, cliente: sol.nombre, dia: null, entregaId: null });
    }
    // Los que ya se reportaron a mano siguen siendo suyos (el pedido pasa a «incidencia» y deja de estar vivo):
    // asi reintentar o repetir el mismo reporte se reconoce y no se duplica.
    for (const r of await repos.rutas.reportesRecientes(500, 'incidencia').catch(() => [])) {
      const t = r.payload.origen === 'incidencia_manual' && r.payload.telefono === phone ? String(r.payload.tracking ?? '') : '';
      if (t && !vistos.has(t)) vistos.set(t, { tracking: t, referencia: t, cliente: null, dia: null, entregaId: null });
    }
    return [...vistos.values()];
  };

  const opcionesDe = async (contact: { id: string; phone: string }) => {
    const pedidos = await trackingsGuardados(contact.phone);
    const enviadas = (await repos.rutas.reportesRecientes(500, 'incidencia').catch(() => []))
      .filter((r) => r.payload.origen === 'incidencia_manual' && r.payload.contactId === contact.id)
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        tracking: r.payload.tracking,
        tipo: r.payload.tipoSeleccionado,
        resumen: r.payload.comentario,
        usuario: r.payload.usuario,
        fecha: r.createdAt,
        estado: r.estado === 'enviado' ? 'Enviada' : r.estado === 'fallido' ? 'Fallida' : 'Pendiente de reintento',
        respuesta: r.estado === 'enviado' ? (r.externoId ?? 'GSG la recibió') : r.ultimoError,
      }));
    return { tipos: tiposManuales(), pedidos, enviadas, botPausadoAt: (await repos.contacts.getById(contact.id))?.botPausadoAt ?? null };
  };

  const datosManuales = z.object({
    tipo: z.string().trim().min(1, 'Elige el tipo de error.'),
    resumen: z.string().trim().min(5, 'Cuéntale a GSG por qué reportas el error.').max(500),
    // Opcional: solo sirve para elegir entre los pedidos guardados; nunca se escribe a mano.
    tracking: z.string().trim().max(80).optional(),
  });

  /** Valida, calla al bot de ese cliente y manda el reporte a GSG por la cola de siempre. */
  const reportarManual = async (contact: { id: string; phone: string }, cuerpo: unknown, request: { usuario?: { nombre?: string | null; usuario?: string } | null }) => {
    const body = datosManuales.safeParse(cuerpo ?? {});
    if (!body.success) return { status: 400, error: body.error.issues[0]?.message ?? 'Datos incompletos.' } as const;
    const errorManual = tiposManuales().find(t => t.codigo === body.data.tipo);
    if (!errorManual) return { status: 400, error: 'Ese tipo de error no existe.' } as const;
    const { tipo, resumen } = body.data;
    // El tracking sale SIEMPRE de lo guardado del cliente, tal cual esta guardado.
    const guardados = await trackingsGuardados(contact.phone);
    const pedido = body.data.tracking
      ? guardados.find((g) => g.tracking === body.data.tracking || g.referencia === body.data.tracking)
      : guardados.length === 1 ? guardados[0] : undefined;
    if (!pedido) {
      return { status: 400, error: guardados.length === 0
        ? 'Este cliente no tiene un pedido con tracking guardado: no hay nada que reportar.'
        : 'Elige uno de los pedidos guardados de este cliente.' } as const;
    }
    const tracking = pedido.tracking;
    const en = new Date();
    const usuario = (request.usuario?.nombre || request.usuario?.usuario || 'operador') as string;
    // Mismo pedido, tipo y resumen el mismo dia = el mismo reporte (doble clic, reintento).
    const huella = createHash('sha1').update(`${tipo}|${resumen.toLowerCase()}`).digest('hex').slice(0, 8);
    const eventoId = `gsgchat-${tracking}-${TIPO_MANUAL}-${huella}-${en.toISOString().slice(0, 10)}`;
    const nuevo = await encolarProblemaGsg(repos.rutas, {
      tracking,
      codigo: errorManual.titulo,
      motivo: 'OTRO',
      nombreError: errorManual.titulo,
      telefono: contact.phone,
      comentario: resumen,
      tipoSeleccionado: errorManual.titulo,
      errorManualId: tipo,
      usuario,
      contactId: contact.id,
      origen: 'incidencia_manual',
    }, { en, eventoId });
    // El pedido y la solicitud pasan a «reportada a GSG»: se ven asi en Hoy y en Automatizacion GSG.
    const detalleEstado = resumen.slice(0, 300);
    const entregas = await repos.entregas.vivasPorTelefono(contact.phone).catch(() => []);
    for (const e of entregas.filter((x) => trackingDe(x) === tracking || x.referencia === tracking)) {
      await repos.entregas.actualizar(e.id, { estado: 'incidencia', incidencia: 'incidencia_manual', incidenciaDetalle: detalleEstado, requiereHumano: true }).catch(() => undefined);
      await repos.entregas.registrarEvento(e.id, 'incidencia', `reportada a GSG (${tipo}): ${detalleEstado}`, { tipo, usuario }).catch(() => undefined);
    }
    const solicitud = await repos.rutas.abiertaPorTelefono(contact.phone).catch(() => null);
    if (solicitud) {
      await repos.rutas.actualizarSolicitud(solicitud.id, { estado: 'incidencia', incidencia: 'incidencia_manual', incidenciaDetalle: detalleEstado, requiereHumano: true, proximoIntentoAt: null }).catch(() => undefined);
      await repos.rutas.registrarEvento(solicitud.id, 'incidencia', `Reportada a GSG (${tipo}): ${detalleEstado}`, { codigo: 'incidencia_manual', tipo, usuario }).catch(() => undefined);
    }
    // Reportar a mano es tomar el caso: el bot se calla en ese chat hasta que alguien lo reactive.
    await repos.contacts.pausarBot(contact.id, true, en);
    if (deps.gsg) await despacharReportes({ rutas: repos.rutas }, deps.gsg, 25, ['incidencia'], { manual: true }).catch(() => undefined);
    return { status: 200, ok: true, duplicada: !nuevo, botPausado: true } as const;
  };

  const responderManual = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, r: Awaited<ReturnType<typeof reportarManual>>) =>
    r.status === 200 ? r : reply.code(r.status).send({ error: r.error });

  app.get('/admin/chat/:contactId/incidencia-manual', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'Ese chat ya no existe.' });
    return opcionesDe(contact);
  });

  app.post('/admin/chat/:contactId/incidencia-manual', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'Ese chat ya no existe.' });
    return responderManual(reply, await reportarManual(contact, request.body, request));
  });

  // Lo mismo desde Automatizacion GSG, donde se elige al cliente por su telefono.
  app.get('/admin/incidencia-manual', async (request, reply) => {
    const telefono = normalizePhone(String((request.query as { phone?: string }).phone ?? ''));
    if (!telefono) return reply.code(400).send({ error: 'Falta el teléfono del cliente.' });
    return opcionesDe(await repos.contacts.upsertFromInbound(telefono));
  });

  app.post('/admin/incidencia-manual', async (request, reply) => {
    const { phone, ...resto } = (request.body ?? {}) as { phone?: string };
    const telefono = normalizePhone(String(phone ?? ''));
    if (!telefono) return reply.code(400).send({ error: 'Falta el teléfono del cliente.' });
    return responderManual(reply, await reportarManual(await repos.contacts.upsertFromInbound(telefono), resto, request));
  });

  /**
   * El agente operativo cerro este chat (mando su cierre): una persona lo
   * atiende. `cerrado: false` se lo devuelve al asistente; `true` lo cierra a mano.
   */
  app.post('/admin/chat/:contactId/asistente', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const body = z.object({ cerrado: z.boolean() }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Falta decir si el asistente atiende o no este chat.' });
    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'Ese chat ya no existe.' });
    await repos.contacts.cerrarIA(contact.id, body.data.cerrado, new Date(), body.data.cerrado ? 'lo cerró una persona desde Chats' : null);
    return { ok: true, cerrado: body.data.cerrado };
  });

  /**
   * Volver a empezar con un cliente con el que ya se termino: el asistente
   * vuelve a atenderlo, el bot deja de estar callado y se levanta cualquier
   * freno, para que su siguiente pedido corra desde el principio. Sus
   * mensajes y sus pedidos se quedan como estan.
   */
  app.post('/admin/chat/:contactId/volver-a-empezar', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'Ese chat ya no existe.' });
    if (contact.tipo === 'grupo') return reply.code(400).send({ error: 'Un grupo no tiene flujo que reiniciar.' });
    const ahora = new Date();
    await repos.contacts.cerrarIA(contact.id, false, ahora, null);
    await repos.contacts.pausarBot(contact.id, false, ahora);
    await repos.contacts.levantarSupresion(contact.phone);
    return { ok: true };
  });

  /**
   * Envio desde el chat. Acepta texto, un link de mapa, el boton de ubicacion
   * o una plantilla; todo pasa por el sender, asi que las guardas siguen
   * puestas y el bloqueo se devuelve explicado.
   */
  /**
   * Quien manda desde el chat: la persona en sesion, con su nombre de pila,
   * salvo que el cuerpo diga otra cosa (el chat embebido de otro sistema
   * manda en nombre de su asesor). Va al hilo y al webhook (`autorNombre`).
   */
  const quien = (request: { usuario?: { nombre?: string | null; usuario?: string } | null }, body: { autor?: 'persona' | 'ia' | 'sistema'; autorNombre?: string; atiendePersona?: boolean }) => ({
    // Sin decir nada, quien escribe desde el chat es una persona: que el
    // hilo no lo apunte como 'sistema' solo porque la ventana de Meta obligue.
    origen: body.autor ?? 'persona',
    atiendePersona: body.atiendePersona === true && (body.autor ?? 'persona') === 'persona',
    autorNombre: body.autorNombre?.trim() || (request.usuario?.nombre || request.usuario?.usuario || '').split(' ')[0] || undefined,
  });

  app.post('/admin/chat/send', async (request, reply) => {
    const body = sendSchema.parse(request.body);
    const firma = quien(request, body);

    let phone = body.phone ? normalizePhone(body.phone) : undefined;
    let esGrupo = false;
    if (!phone && body.contactId) {
      const contact = await repos.contacts.getById(body.contactId);
      if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
      phone = contact.phone;
      esGrupo = contact.tipo === 'grupo';
    }
    if (!phone) return reply.code(400).send({ error: 'falta el telefono' });

    // La cita: se resuelve aqui, contra el hilo, para que nadie pueda citar
    // un mensaje de otra conversacion pasando un id a mano.
    let cita;
    if (body.citaId) {
      if (!body.contactId) return reply.code(400).send({ error: 'para citar hace falta la conversación' });
      cita = await citaDelHilo(body.contactId, body.citaId);
      if ('error' in cita) return reply.code(400).send({ error: cita.error });
    }

    if (esGrupo) {
      if (!gruposDisponibles()) return reply.code(400).send({ error: SIN_GRUPOS });
      // Pedir la ubicacion o mandar una plantilla es cosa de un cliente, no
      // de un grupo: ahi solo tiene sentido escribir, un sticker o un pin.
      if (body.askLocation || body.templateName) {
        return reply.code(400).send({ error: 'En un grupo solo se puede escribir un mensaje, un sticker o mandar un pin.' });
      }
    }

    if (body.askLocation) {
      return sender.send({
        phone,
        kind: 'interactive',
        category: 'UTILITY',
        manual: aMano(),
        ...firma,
        interactive: {
          body: body.text?.trim() || textoPedirUbicacion(),
          locationRequest: true,
        },
      });
    }

    if (body.location) {
      const result = await extractLocation(body.location, { bbox: config.bbox });
      if (!result.ok) {
        return reply.code(400).send({ error: `no se encontraron coordenadas: ${result.reason}` });
      }
      const outcome = await sender.send({
        phone,
        kind: 'location',
        category: 'UTILITY',
        manual: aMano(),
        ...firma,
        location: { latitude: result.lat, longitude: result.lng },
      });
      return { ...outcome, location: result };
    }

    if (body.templateName) {
      /**
       * Se busca por nombre e idioma y, si no aparece, por nombre a secas.
       *
       * El catalogo del sistema esta en "es", pero una cuenta que venia de
       * antes puede tener la misma plantilla aprobada como "es_MX". Sin este
       * respaldo, el envio fallaba con un "no existe" que era mentira: existia,
       * con otra etiqueta de idioma.
       */
      const template =
        (await repos.templates.get(body.templateName, body.templateLanguage)) ??
        (await repos.templates.list()).find((t) => t.name === body.templateName) ??
        null;
      if (!template) {
        return reply.code(400).send({
          error: `La plantilla "${body.templateName}" no está dada de alta todavía. Sincronízala en el panel.`,
        });
      }
      return sender.send({
        phone,
        kind: 'template',
        category: template.category,
        manual: aMano(),
        ...firma,
        templateName: template.name,
        templateLanguage: template.language,
        variables: body.variables,
      });
    }

    if (!body.text?.trim()) return reply.code(400).send({ error: 'el mensaje va vacio' });

    if (body.voz) {
      if (!deps.voz) return reply.code(409).send({ error: 'La voz no está configurada: Mi asistente IA → Voz.' });
      const r = await deps.voz.enviar({ phone, texto: body.text, origen: firma.origen, autorNombre: firma.autorNombre, manual: aMano() });
      return { ...r.outcome, voz: { enviada: r.enviadoComo === 'audio', motivo: r.motivo } };
    }

    return sender.send({ phone, kind: 'freeform', category: 'UTILITY', text: body.text, manual: aMano(), ...firma, ...(cita && !('error' in cita) ? { cita } : {}) });
  });

  app.post('/admin/chat/adjunto', async (_request, reply) => reply.code(410).send({
    ok: false,
    codigo: 'MODULO_RETIRADO',
    error: 'El envío de adjuntos desde el chat está retirado; el chat solo permite texto y ubicación.',
  }));

  /** Abrir un chat con alguien que todavia no existe en la libreta. */
  app.post('/admin/chat/start', async (request) => {
    const body = z
      .object({ phone: z.string().min(6), name: z.string().max(200).optional() })
      .parse(request.body);
    const contact = await repos.contacts.upsertFromInbound(normalizePhone(body.phone), body.name);
    return { contact };
  });

  // --------------------------------------------- acciones sobre un mensaje

  /**
   * Reaccionar con un emoji, o quitar la propia reaccion (emoji vacio).
   *
   * Sale por el proveedor y ADEMAS se cuelga del mensaje aqui: si solo se
   * mandara, la reaccion propia no se veria hasta que WhatsApp la devolviera,
   * y con la Cloud API no la devuelve nunca.
   */
  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/reaccion', async (request, reply) => {
    const body = z.object({ mensajeId: z.coerce.number().int().positive(), emoji: z.string().max(16) }).parse(request.body ?? {});
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    if (!capacidadesDelChat(providerOf(settings.current())).reaccionar || !sender.accion) {
      return reply.code(400).send({ error: 'este WhatsApp no puede mandar reacciones' });
    }

    const mensaje = await citaDelHilo(contact.id, body.mensajeId);
    if ('error' in mensaje) return reply.code(400).send({ error: mensaje.error });

    const emoji = body.emoji.trim();
    await sender.accion({ phone: contact.phone, mensaje, tipo: 'reaccion', emoji });
    await repos.messages.reaccionar(mensaje.id, 'yo', emoji, new Date());
    return { ok: true, emoji };
  });

  /**
   * Quitar mensajes: "para mi" siempre, "para todos" solo donde el proveedor
   * lo permite (ver `capacidadesDelChat`).
   *
   * Ni un caso ni el otro borran la fila: se marcan y el hilo deja de
   * pintarlas. El respaldo y la traza siguen completos, que es lo que hace
   * falta el dia que alguien pregunta que se dijo.
   */
  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/eliminar', async (request, reply) => {
    const body = z
      .object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(50), paraTodos: z.boolean().default(false) })
      .parse(request.body ?? {});
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });

    const fallos: string[] = [];
    if (body.paraTodos) {
      if (!capacidadesDelChat(providerOf(settings.current())).eliminarParaTodos || !sender.accion) {
        return reply.code(400).send({ error: 'este WhatsApp no puede eliminar un mensaje para todos: solo se puede quitar de aquí' });
      }
      for (const id of body.ids) {
        const mensaje = await citaDelHilo(contact.id, id);
        if ('error' in mensaje) { fallos.push(mensaje.error); continue; }
        try {
          await sender.accion({ phone: contact.phone, mensaje, tipo: 'eliminar' });
          await repos.messages.marcarBorradoPorRemitente(mensaje.id, new Date());
        } catch (error) {
          fallos.push(error instanceof Error ? error.message : 'no se pudo eliminar');
        }
      }
    }

    const quitados = await repos.messages.ocultar(contact.id, body.ids, new Date());
    return { ok: true, quitados, paraTodos: body.paraTodos, fallos };
  });

  /** Cambiar el texto de un mensaje ya enviado, donde el proveedor lo permita. */
  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/editar', async (request, reply) => {
    const body = z.object({ mensajeId: z.coerce.number().int().positive(), texto: z.string().trim().min(1).max(4000) }).parse(request.body ?? {});
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    if (!capacidadesDelChat(providerOf(settings.current())).editar || !sender.accion) {
      return reply.code(400).send({ error: 'este WhatsApp no puede editar un mensaje ya enviado' });
    }

    const mensaje = await citaDelHilo(contact.id, body.mensajeId);
    if ('error' in mensaje) return reply.code(400).send({ error: mensaje.error });
    if (!mensaje.fromMe) return reply.code(400).send({ error: 'solo se pueden editar los mensajes que mandaste tú' });

    await sender.accion({ phone: contact.phone, mensaje, tipo: 'editar', texto: body.texto });
    await repos.messages.editarCuerpo(contact.id, body.mensajeId, body.texto, new Date());
    return { ok: true };
  });

  /** La estrella: marcar o desmarcar mensajes para encontrarlos luego. */
  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/destacar', async (request, reply) => {
    const body = z
      .object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(100), destacado: z.boolean().default(true) })
      .parse(request.body ?? {});
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    const cambiados = await repos.messages.destacar(contact.id, body.ids, body.destacado, new Date());
    return { ok: true, cambiados };
  });

  /** Los mensajes destacados: de este chat o de todos. */
  app.get('/admin/chat/destacados', async (request) => {
    const query = z
      .object({ contactId: z.string().optional(), limit: z.coerce.number().int().positive().max(200).default(60) })
      .parse(request.query ?? {});
    return { items: await repos.messages.destacados({ ...query, desde: settings.vistaChatDesde?.() }) };
  });

  /** Buscar dentro de una conversacion. Devuelve los mensajes que coinciden. */
  app.get<{ Params: { contactId: string } }>('/admin/chat/:contactId/buscar', async (request, reply) => {
    const query = z
      .object({ q: z.string().trim().min(1).max(120), limit: z.coerce.number().int().positive().max(200).default(100) })
      .parse(request.query ?? {});
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    return { items: await repos.messages.buscar({ contactId: contact.id, q: query.q, limit: query.limit, desde: settings.vistaChatDesde?.() }) };
  });

  /**
   * Reenviar mensajes a otras conversaciones.
   *
   * Se reenvia el CONTENIDO, no el mensaje: WhatsApp no tiene "reenviar" en
   * ninguna de las tres APIs, asi que se vuelve a mandar. Por eso el globo
   * lleva la marca "Reenviado": para que quien lo lee sepa que no se escribio
   * para el.
   */
  app.post('/admin/chat/reenviar', async (request, reply) => {
    const body = z
      .object({
        origenId: z.string().min(1),
        ids: z.array(z.coerce.number().int().positive()).min(1).max(20),
        destinos: z.array(z.string().min(1)).min(1).max(20),
      })
      .parse(request.body ?? {});

    const origen = await repos.contacts.getById(body.origenId);
    if (!origen) return reply.code(404).send({ error: 'conversación de origen no encontrada' });
    const mensajes = await repos.messages.porIds(origen.id, body.ids);
    if (!mensajes.length) return reply.code(400).send({ error: 'no hay nada que reenviar' });

    const firma = quien(request, {});
    let enviados = 0;
    const fallos: string[] = [];

    for (const destinoId of body.destinos) {
      const destino = await repos.contacts.getById(destinoId);
      if (!destino) { fallos.push('una conversación ya no existe'); continue; }
      if (destino.tipo === 'grupo' && !gruposDisponibles()) { fallos.push(SIN_GRUPOS); continue; }

      for (const m of mensajes) {
        try {
          const location = (m.payload as { location?: { latitude?: number; longitude?: number; name?: string; address?: string } } | null)?.location;
          if (m.kind === 'location' && location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
            const outcome = await sender.send({ phone: destino.phone, kind: 'location', category: 'UTILITY', manual: aMano(), reenviado: true, ...firma, location: { latitude: location.latitude!, longitude: location.longitude!, name: location.name, address: location.address } });
            if (outcome.ok) enviados++;
            else fallos.push('reason' in outcome ? outcome.reason : outcome.error);
            continue;
          }

          const texto = (m.body ?? '').trim();
          if (!texto) { fallos.push('un mensaje sin texto no se puede reenviar'); continue; }
          const outcome = await sender.send({
            phone: destino.phone,
            kind: 'freeform',
            category: 'UTILITY',
            manual: aMano(),
            reenviado: true,
            ...firma,
            text: texto,
          });
          if (outcome.ok) enviados++;
          else fallos.push('reason' in outcome ? outcome.reason : outcome.error);
        } catch (error) {
          fallos.push(error instanceof Error ? error.message : 'no se pudo reenviar');
        }
      }
    }

    return { ok: enviados > 0, enviados, fallos };
  });

  /**
   * Como se ve el chat en la lista: fijado, silenciado, apartado, o de vuelta
   * a "sin leer". Lo que no venga en el cuerpo no se toca.
   */
  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/lista', async (request, reply) => {
    const body = z
      .object({
        fijado: z.boolean().optional(),
        silenciado: z.boolean().optional(),
        apartado: z.boolean().optional(),
        noLeido: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });

    await repos.contacts.ajustesChat(contact.id, body, new Date());
    if (body.noLeido === true) {
      // "Sin leer" es mover el puntero de lectura ANTES del ultimo entrante:
      // no hay marca por mensaje (ver `marcarNoLeido`).
      await repos.contacts.marcarNoLeido(contact.id, null);
    } else if (body.noLeido === false) {
      await repos.messages.markRead(contact.id, new Date());
    }
    return { ok: true };
  });

  /**
   * Si el otro lado esta escribiendo o en linea.
   *
   * Solo con el proveedor que puede saberlo. `null` es "no se sabe", y la
   * pantalla lo respeta: no inventa un "en línea" que no existe.
   */
  app.get<{ Params: { contactId: string } }>('/admin/chat/:contactId/presencia', async (request, reply) => {
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    if (!capacidadesDelChat(providerOf(settings.current())).presencia || !sender.presencia) return { presencia: null };
    return { presencia: await sender.presencia(contact.phone) };
  });

  /**
   * La previa de un enlace: titulo, descripcion e imagen.
   *
   * Se pide desde el servidor porque el navegador no puede (el otro sitio no
   * deja). Con candado: solo http/https, solo hacia fuera (nada de la red
   * interna, que seria un agujero para leer servicios privados), un tope de
   * tamano y un plazo corto. Lo que no se pueda leer, no se pinta.
   */
  const previas = new Map<string, { titulo: string | null; descripcion: string | null; imagen: string | null; sitio: string }>();
  app.get('/admin/chat/previa', async (request, reply) => {
    const query = z.object({ url: z.string().url().max(600) }).parse(request.query ?? {});
    const cacheada = previas.get(query.url);
    if (cacheada) return cacheada;

    let destino: URL;
    try {
      destino = new URL(query.url);
    } catch {
      return reply.code(400).send({ error: 'ese enlace no se entiende' });
    }
    if (destino.protocol !== 'http:' && destino.protocol !== 'https:') {
      return reply.code(400).send({ error: 'solo se pueden previsualizar enlaces web' });
    }
    // La red de casa no se toca desde aqui: un enlace pegado por un cliente
    // no puede servir para leer un servicio interno.
    if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1)/i.test(destino.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(destino.hostname)) {
      return reply.code(400).send({ error: 'ese enlace apunta a la red interna' });
    }

    try {
      const corte = AbortSignal.timeout(4000);
      const res = await fetch(destino, { signal: corte, redirect: 'follow', headers: { 'user-agent': 'WhatsApp/2.0' } });
      if (!res.ok) return reply.code(404).send({ error: 'el enlace no respondió' });
      const tipo = res.headers.get('content-type') ?? '';
      if (!tipo.includes('text/html')) return reply.code(415).send({ error: 'el enlace no es una página' });
      // 200 KB de cabecera bastan: las etiquetas og: van siempre arriba.
      const html = (await res.text()).slice(0, 200_000);
      const meta = (nombre: string) => {
        const re = new RegExp(`<meta[^>]+(?:property|name)=["']${nombre}["'][^>]*content=["']([^"']+)["']`, 'i');
        const alReves = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${nombre}["']`, 'i');
        return decodificarEntidades(html.match(re)?.[1] ?? html.match(alReves)?.[1] ?? '').trim() || null;
      };
      const previa = {
        titulo: meta('og:title') ?? (decodificarEntidades(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim() || null),
        descripcion: meta('og:description') ?? meta('description'),
        imagen: meta('og:image'),
        sitio: destino.hostname.replace(/^www\./, ''),
      };
      previas.set(query.url, previa);
      // La memoria no es infinita: con mil enlaces cacheados se suelta el mas viejo.
      if (previas.size > 1000) previas.delete(previas.keys().next().value!);
      return previa;
    } catch (error) {
      return reply.code(504).send({ error: 'no se pudo leer el enlace: ' + (error instanceof Error ? error.message : 'sin respuesta') });
    }
  });
}
