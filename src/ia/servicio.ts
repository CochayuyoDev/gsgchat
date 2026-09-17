/**
 * El asistente de IA de la tienda: su configuracion y su turno.
 *
 * Lo que sabe es lo que la tienda escribe en "Mi asistente IA": que vende,
 * horario, como responder, que no prometer. Con eso y las ultimas lineas de
 * la conversacion contesta a cada mensaje del cliente; si el cliente pide
 * hablar con una persona, o el modelo no puede ayudar, se para el bot en
 * ese chat y se avisa a quien atiende. Es la misma "pausa del bot" que
 * tiene el operador desde /chat, asi que a partir de ahi el sistema calla.
 *
 * La configuracion vive en la tabla settings (`ia.config` en claro,
 * `ia.token` cifrado con la clave de la instancia). Es por instancia: en el
 * SaaS cada tienda tiene su conocimiento y su token.
 */

import { z } from 'zod';
import type { Config } from '../config.js';
import type { Repos, Contact } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import type { SettingsRepo } from '../settings/service.js';
import { decrypt, encrypt, keyFromBase64 } from '../settings/crypto.js';
import type { StokyClient } from '../stoky/client.js';
import { crearCatalogoTienda, lineaDeProducto, type CatalogoTienda } from '../catalogo/tienda.js';
import { crearProveedorOpenAI, crearProveedorPuter, ErrorIA, type MensajeIA, type ProveedorIA } from './proveedores.js';
import { MODELO_GRATIS_POR_DEFECTO, modeloGratisEfectivo, modelosGratisEnVivo } from './modelos-gratis.js';
import { ACCIONES_IA, COMO_TOMAR_PEDIDO, manualDelSistema, SISTEMA_PARA_CLIENTES } from './conocimiento-sistema.js';
import { extraerPedido, registrarPedido, type PedidoDelModelo } from '../pedidos/servicio.js';
import type { Bus } from '../eventos/bus.js';
import type { ServicioPlan } from '../plan/servicio.js';
import { calificar, EJEMPLOS_DE_RESPUESTA, ESCENARIOS, resumenDeCalificaciones, type Calificacion, type Grupo } from './escenarios.js';

export const configIASchema = z.object({
  activa: z.boolean().default(false),
  proveedor: z.enum(['puter', 'openai']).default('puter'),
  /**
   * Con Puter solo se usan modelos gratuitos de verdad (ver modelos-gratis.ts):
   * si el guardado deja de serlo, se usa el gratuito por defecto.
   */
  modelo: z.string().trim().max(80).default(MODELO_GRATIS_POR_DEFECTO),
  /** Solo para openai: la URL base (OpenAI, Groq, Ollama...). */
  baseUrl: z.string().trim().max(300).default(''),
  nombreAsistente: z.string().trim().max(60).default('Asistente'),
  /** Lo que el asistente sabe del negocio: productos, precios, horario, politicas. */
  conocimiento: z.string().max(20_000).default(''),
  /** Como hablar: tono, largo, que no hacer. */
  instrucciones: z.string().max(4_000).default(''),
  /** Palabras del cliente que pasan la conversacion a una persona sin preguntarle al modelo. */
  derivarSi: z.string().max(500).default('asesor, humano, persona, hablar con alguien, reclamo'),
  /** Avisar por WhatsApp al supervisor cuando se deriva. */
  avisarDerivacion: z.boolean().default(true),
  /** Cuantos mensajes anteriores se le dan al modelo. */
  memoria: z.number().int().min(0).max(40).default(12),
  /**
   * La API de productos de la tienda (ver src/catalogo/tienda.ts). Con ella el
   * asistente habla de productos reales, con precio y stock de ahora mismo, y
   * puede tomar pedidos. Vacio = solo lo que la tienda escribio (o Stoky).
   */
  catalogoUrl: z.string().trim().max(500).default(''),
  catalogoFormato: z.enum(['auto', 'elysian', 'simple', 'woocommerce']).default('auto'),
});

export type ConfigIA = z.infer<typeof configIASchema>;
export const CONFIG_IA_VACIA: ConfigIA = configIASchema.parse({});

/** Lo que devuelve la pantalla: la configuracion y si hay token guardado, nunca el token. */
export interface EstadoIA extends ConfigIA {
  tieneToken: boolean;
  /** El modelo que de verdad se usa (con Puter, siempre uno gratuito). */
  modeloEfectivo: string;
  /** Los modelos gratuitos de Puter ahora mismo, y de donde salio la lista. */
  modelosGratis: string[];
  modelosGratisOrigen: 'catalogo' | 'fijo';
}

export interface TurnoIA {
  /** Que se hizo: se contesto, se derivo a una persona, o fallo (y se dijo algo neutro). */
  resultado: 'respondio' | 'derivo' | 'error' | 'inactiva';
  texto: string | null;
  detalle?: string;
}

export interface ServicioIA {
  estado(): EstadoIA;
  /** Si la URL del catalogo responde y cuantos productos trae. */
  probarCatalogo(): Promise<{ ok: boolean; total: number; detalle?: string; ejemplo?: string | null }>;
  /** El catalogo vigente (tienda por URL o Stoky), si hay. */
  catalogo(): CatalogoTienda | StokyClient | undefined;
  /** Vuelve a mirar el catalogo de Puter (cada hora solo) y devuelve el estado. */
  refrescarModelos(): Promise<EstadoIA>;
  activa(): boolean;
  guardar(patch: Partial<ConfigIA> & { token?: string | null }): Promise<EstadoIA>;
  recargar(): Promise<void>;
  /** Un mensaje del cliente: que contestar. No envia nada. */
  responder(entrada: { contact: Contact; texto: string; historial?: MensajeIA[] }): Promise<RespuestaIA>;
  /** El turno completo: contestar por WhatsApp y, si toca, derivar y avisar. */
  turno(contact: Contact, texto: string): Promise<TurnoIA>;
  /** Una prueba desde la pantalla, con un historial que trae el navegador. */
  probar(historial: MensajeIA[], texto: string): Promise<RespuestaIA>;
  /** El ayudante del panel: responde al dueño con el manual del sistema. */
  ayuda(historial: MensajeIA[], texto: string): Promise<{ texto: string }>;
  /**
   * El examen: corre los escenarios (o un grupo) con el modelo real y
   * califica cada respuesta. Tarda: un turno por caso.
   */
  simularEscenarios(opts?: { grupo?: Grupo; claves?: string[]; limite?: number }): Promise<{ resultados: Calificacion[]; resumen: ReturnType<typeof resumenDeCalificaciones> }>;
}

export interface RespuestaIA {
  texto: string;
  derivar: boolean;
  /** El modelo pidio mandarle al cliente el boton de ubicacion. */
  pedirUbicacion: boolean;
  /** El modelo cerro un pedido: lo que dijo, todavia sin comprobar contra el catalogo. */
  pedido?: PedidoDelModelo | null;
}

export interface DepsIA {
  settingsRepo: SettingsRepo;
  settingsKeyBase64: string;
  repos: Repos;
  sender: Sender;
  config: Config;
  nombreNegocio: () => string;
  /** A quien avisar cuando se deriva (el supervisor). Vacio = a nadie. */
  supervisor?: () => string;
  catalogo?: StokyClient;
  /**
   * Si hay boton nativo de ubicacion (API de Meta, o el cliente local con
   * WHATSAPP_NATIVE_BUTTONS). Sin el, se pide por texto con el camino del clip.
   */
  conBoton?: () => boolean;
  /** El bus, para anunciar los pedidos tomados. */
  bus?: Bus;
  /** El plan de la tienda: si esta vencido o con el tope de turnos, la IA calla. */
  plan?: ServicioPlan;
  /** Para pruebas: el proveedor ya hecho. */
  proveedor?: ProveedorIA;
  fetchImpl?: typeof fetch;
  /** Para pruebas: la lista de modelos gratuitos ya resuelta. */
  modelosGratis?: string[];
  log?: (m: string, d?: Record<string, unknown>) => void;
}

const CLAVE_CONFIG = 'ia.config';
const CLAVE_TOKEN = 'ia.token';

/** La marca con la que el modelo dice "esto lo tiene que ver una persona". */
export const MARCA_DERIVAR = ACCIONES_IA.DERIVAR;
export const MARCA_PEDIR_UBICACION = ACCIONES_IA.PEDIR_UBICACION;

export function textoDeDespedida(nombreNegocio: string): string {
  return `Te paso con una persona del equipo de ${nombreNegocio}; en un momento te atiende por aquí.`;
}

export function textoDeFallo(): string {
  return 'Disculpa, ahora mismo no puedo responderte; en un momento te atiende una persona.';
}

/** El prompt de sistema: quien es, que sabe, como habla, cuando deriva. */
export function construirSistema(cfg: ConfigIA, ctx: { negocio: string; horario: string; ahora: Date; catalogo?: string | null; tomaPedidos?: boolean }): string {
  const partes = [
    `Eres ${cfg.nombreAsistente}, el asistente de WhatsApp de "${ctx.negocio}". Atiendes a clientes por WhatsApp.`,
    `Hoy es ${ctx.ahora.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })}, ${ctx.ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}. Horario de atención: ${ctx.horario}.`,
    'Reglas:',
    '- Responde en español, de forma breve y natural, como en un chat de WhatsApp (máximo 3 o 4 frases; sin listas largas ni formato Markdown). Escribe directamente el mensaje, sin razonamiento previo ni etiquetas como <thought>.',
    '- Usa SOLO la información de "Lo que sabes del negocio". Si no sabes algo (un precio, un stock, una fecha), dilo y ofrece que una persona lo confirme; nunca lo inventes.',
    `- Si el cliente pide hablar con una persona, quiere reclamar, o pide algo que no puedes resolver con lo que sabes, responde brevemente y termina tu mensaje con la marca ${MARCA_DERIVAR} (exactamente así). No expliques la marca.`,
    `- Si necesitas que el cliente te mande su ubicación (entrega a domicilio, saber dónde está), termina tu mensaje con la marca ${MARCA_PEDIR_UBICACION}: el sistema le manda el botón. Úsala como mucho una vez por conversación, y nunca junto con ${MARCA_DERIVAR}.`,
    '- No pidas datos sensibles (tarjetas, contraseñas). No prometas descuentos ni plazos que no estén escritos abajo.',
    '',
    SISTEMA_PARA_CLIENTES,
    ...(ctx.tomaPedidos ? ['', COMO_TOMAR_PEDIDO] : []),
    '',
    EJEMPLOS_DE_RESPUESTA,
  ];
  if (cfg.instrucciones.trim()) partes.push('', 'Cómo debes hablar y qué tener en cuenta:', cfg.instrucciones.trim());
  partes.push('', 'Lo que sabes del negocio:', cfg.conocimiento.trim() || '(La tienda no ha escrito nada todavía: sé amable y pasa con una persona cualquier pregunta concreta.)');
  if (ctx.catalogo) partes.push('', 'Productos encontrados en el catálogo de la tienda para esta consulta (precio y stock reales ahora mismo; [código] es el SKU). Usa estos precios tal cual, di si está agotado, y si hay enlace mándalo para que lo vea:', ctx.catalogo);
  return partes.join('\n');
}

export function palabrasDeDerivar(lista: string): string[] {
  return lista
    .split(/[,\n]/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length >= 3);
}

export function pideUnaPersona(texto: string, palabras: string[]): boolean {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return palabras.some((p) => t.includes(p.normalize('NFD').replace(/[̀-ͯ]/g, '')));
}

/** Separa la marca de derivacion del texto que se manda al cliente. */
export function leerRespuesta(cruda: string): RespuestaIA {
  const { texto: sinPedido, pedido } = extraerPedido(cruda);
  const derivar = sinPedido.includes(MARCA_DERIVAR);
  // Derivar manda: si va a atender una persona, el boton lo manda ella.
  const pedirUbicacion = !derivar && sinPedido.includes(MARCA_PEDIR_UBICACION);
  const texto = sinPedido.replaceAll(MARCA_DERIVAR, '').replaceAll(MARCA_PEDIR_UBICACION, '').replace(/\s+$/g, '').trim();
  return { texto, derivar, pedirUbicacion, pedido: pedido ?? null };
}

/** El texto con el que se pide la ubicacion, segun haya boton nativo o no. */
export function textoPedirUbicacion(conBoton: boolean): string {
  return conBoton
    ? 'Comparte tu ubicación con el botón de aquí abajo, por favor.'
    : '¿Me compartes tu ubicación, por favor? Desde el clip 📎 → Ubicación → Enviar tu ubicación actual.';
}

export async function crearServicioIA(deps: DepsIA): Promise<ServicioIA> {
  const { settingsRepo, repos, sender, config } = deps;
  const key = keyFromBase64(deps.settingsKeyBase64);
  const log = deps.log ?? (() => undefined);

  let cfg: ConfigIA = CONFIG_IA_VACIA;
  let token = '';
  let proveedor: ProveedorIA | null = deps.proveedor ?? null;
  // El catalogo de la tienda por URL, si lo hay; si no, el de Stoky (env).
  let catalogoTienda: CatalogoTienda | null = null;
  let catalogoUrlCargada = '';
  const catalogo = (): CatalogoTienda | StokyClient | undefined => {
    if (cfg.catalogoUrl) {
      if (!catalogoTienda || catalogoUrlCargada !== `${cfg.catalogoUrl}|${cfg.catalogoFormato}`) {
        catalogoTienda = crearCatalogoTienda({ url: cfg.catalogoUrl, formato: cfg.catalogoFormato, fetchImpl: deps.fetchImpl });
        catalogoUrlCargada = `${cfg.catalogoUrl}|${cfg.catalogoFormato}`;
      }
      return catalogoTienda;
    }
    return deps.catalogo;
  };
  let gratis: { modelos: string[]; origen: 'catalogo' | 'fijo' } = deps.modelosGratis ? { modelos: deps.modelosGratis, origen: 'fijo' } : { modelos: [MODELO_GRATIS_POR_DEFECTO], origen: 'fijo' };

  async function refrescarModelos(): Promise<void> {
    if (deps.modelosGratis) return;
    const r = await modelosGratisEnVivo({ fetchImpl: deps.fetchImpl });
    gratis = { modelos: r.modelos, origen: r.origen };
  }

  /** Con Puter, nunca un modelo que cueste: si el elegido no es gratis, el gratuito por defecto. */
  const modeloEfectivo = (): string => (cfg.proveedor === 'puter' ? modeloGratisEfectivo(cfg.modelo, gratis.modelos) : cfg.modelo);

  async function recargar(): Promise<void> {
    cfg = CONFIG_IA_VACIA;
    token = '';
    for (const row of await settingsRepo.getAll()) {
      if (row.key === CLAVE_CONFIG) {
        const parsed = configIASchema.safeParse(JSON.parse(row.value));
        if (parsed.success) cfg = parsed.data;
      } else if (row.key === CLAVE_TOKEN) {
        try {
          token = row.encrypted ? decrypt(row.value, key) : row.value;
        } catch {
          log('no se pudo descifrar el token de la IA: se ignora');
        }
      }
    }
    if (!deps.proveedor) proveedor = null;
  }
  await recargar();

  const elProveedor = (): ProveedorIA => {
    if (proveedor) return proveedor;
    proveedor = cfg.proveedor === 'openai' ? crearProveedorOpenAI({ baseUrl: cfg.baseUrl, clave: token, fetchImpl: deps.fetchImpl }) : crearProveedorPuter(token);
    return proveedor;
  };

  const estado = (): EstadoIA => ({ ...cfg, tieneToken: Boolean(token), modeloEfectivo: modeloEfectivo(), modelosGratis: gratis.modelos, modelosGratisOrigen: gratis.origen });

  async function responder(entrada: { contact: Contact; texto: string; historial?: MensajeIA[] }): Promise<RespuestaIA> {
    const { contact, texto } = entrada;
    if (pideUnaPersona(texto, palabrasDeDerivar(cfg.derivarSi))) {
      return { texto: textoDeDespedida(deps.nombreNegocio()), derivar: true, pedirUbicacion: false };
    }

    // El catalogo real (el de la tienda por URL, o el de Stoky): precios y
    // stock de ahora mismo, no lo que la tienda escribio hace un mes.
    let catalogoTexto: string | null = null;
    const cat = catalogo();
    if (cat) {
      if ('contextoPara' in cat) catalogoTexto = await cat.contextoPara(texto, 6).catch(() => null);
      else {
        const encontrados = await cat.buscar(texto, 5).catch(() => []);
        if (encontrados.length) {
          catalogoTexto = encontrados.map((p) => `- ${p.name} [${p.sku}]${p.price != null ? `: ${p.price}` : ''}${p.stock > 0 ? ` (stock ${p.stock})` : ' (agotado)'}`).join('\n');
        }
      }
    }

    const historial =
      entrada.historial ??
      (cfg.memoria > 0
        ? (await repos.messages.listMessages(contact.id, cfg.memoria))
            .filter((m) => m.body && (m.kind === 'text' || m.kind === 'template'))
            .map<MensajeIA>((m) => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.body! }))
        : []);
    // El ultimo entrante ya esta en el hilo: se evita mandarlo dos veces.
    if (historial.length && historial[historial.length - 1]!.role === 'user' && historial[historial.length - 1]!.content === texto) historial.pop();

    const mensajes: MensajeIA[] = [
      { role: 'system', content: construirSistema(cfg, { negocio: deps.nombreNegocio(), horario: config.BUSINESS_HOURS, ahora: new Date(), catalogo: catalogoTexto, tomaPedidos: Boolean(cat) }) },
      ...historial,
      { role: 'user', content: texto },
    ];
    const cruda = await elProveedor().chat(mensajes, { modelo: modeloEfectivo() });
    return leerRespuesta(cruda);
  }

  async function turno(contact: Contact, entrante: string): Promise<TurnoIA> {
    if (!cfg.activa) return { resultado: 'inactiva', texto: null };
    const sinPlan = deps.plan?.motivo('ia');
    if (sinPlan) return { resultado: 'inactiva', texto: null, detalle: sinPlan };
    const phone = contact.phone;
    const enviar = (t: string) => sender.send({ phone, kind: 'freeform', category: 'UTILITY', text: t });

    let respuesta: RespuestaIA;
    try {
      respuesta = await responder({ contact, texto: entrante });
    } catch (error) {
      const detalle = error instanceof ErrorIA ? `${error.message}${error.detalle ? ` (${error.detalle})` : ''}` : error instanceof Error ? error.message : String(error);
      log('fallo el asistente de IA', { phone, detalle });
      await enviar(textoDeFallo());
      // Sin respuesta posible, que lo vea una persona: se para el bot y se avisa.
      await derivar(contact, `la IA fallo: ${detalle}`);
      return { resultado: 'error', texto: textoDeFallo(), detalle };
    }

    await deps.plan?.anotarTurnoIA();
    const texto = respuesta.texto || (respuesta.derivar ? textoDeDespedida(deps.nombreNegocio()) : '');
    if (texto) await enviar(texto);
    if (respuesta.pedido) {
      // El pedido se comprueba contra el catalogo real y se guarda; al cliente
      // le llega el resumen con el total del sistema, y a la tienda el evento.
      const r = await registrarPedido(contact, respuesta.pedido, { repos, bus: deps.bus, catalogo, moneda: 'PEN' }, 'ia');
      await enviar(r.resumen);
      if (r.ok) await avisar(contact, `tomo un pedido (#${r.pedido!.id}, ${r.pedido!.moneda} ${r.pedido!.total.toFixed(2)})`);
      return { resultado: 'respondio', texto: `${texto}\n${r.resumen}`, detalle: r.ok ? `pedido ${r.pedido!.id}` : `pedido no registrado: ${r.noEncontrados.join(', ')}` };
    }
    if (respuesta.pedirUbicacion) {
      // La accion del sistema que el modelo pidio: el boton nativo (o el
      // camino del clip si el proveedor no lo tiene).
      const conBoton = deps.conBoton?.() ?? true;
      await sender.send({
        phone,
        kind: 'interactive',
        category: 'UTILITY',
        interactive: { body: textoPedirUbicacion(conBoton), locationRequest: true },
      });
    }
    if (respuesta.derivar) {
      await derivar(contact, 'el cliente pidio una persona o la IA no pudo ayudar');
      return { resultado: 'derivo', texto };
    }
    return { resultado: 'respondio', texto };
  }

  async function avisar(contact: Contact, que: string): Promise<void> {
    const destino = deps.supervisor?.();
    if (!cfg.avisarDerivacion || !destino) return;
    const quien = contact.name ? `${contact.name} (${contact.phone})` : contact.phone;
    await sender
      .send({ phone: destino, kind: 'freeform', category: 'UTILITY', manual: true, text: `${quien}: ${que}. Abre el chat: ${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/chat` })
      .catch(() => undefined);
  }

  async function derivar(contact: Contact, motivo: string): Promise<void> {
    await repos.contacts.pausarBot(contact.id, true, new Date());
    await avisar(contact, `necesita que alguien le conteste por WhatsApp: ${motivo}`);
  }

  await refrescarModelos().catch(() => undefined);

  return {
    estado,
    activa: () => cfg.activa && Boolean(token),
    recargar,
    catalogo,
    async probarCatalogo() {
      const cat = catalogo();
      if (!cat) return { ok: false, total: 0, detalle: 'no hay catalogo configurado' };
      const r = await cat.precargar();
      const primero = 'productosTienda' in cat ? (await cat.productosTienda().catch(() => []))[0] : (await cat.productos().catch(() => []))[0];
      return { ...r, ejemplo: primero ? `${primero.name}: ${primero.price ?? 'sin precio'} (stock ${primero.stock})` : null };
    },
    async refrescarModelos() {
      await refrescarModelos().catch(() => undefined);
      return estado();
    },
    async guardar(patch) {
      const { token: nuevoToken, ...resto } = patch;
      const siguiente = configIASchema.parse({ ...cfg, ...resto });
      await settingsRepo.put(CLAVE_CONFIG, JSON.stringify(siguiente), false);
      if (nuevoToken !== undefined) {
        if (nuevoToken === null || nuevoToken === '') await settingsRepo.remove(CLAVE_TOKEN);
        else await settingsRepo.put(CLAVE_TOKEN, encrypt(nuevoToken.trim(), key), true);
      }
      await recargar();
      return estado();
    },
    responder,
    turno,
    async probar(historial, texto) {
      const contact: Contact = { id: 'prueba', phone: '000', name: 'Cliente de prueba', optInAt: null, optInSource: null, optOutAt: null, lastInboundAt: null };
      return responder({ contact, texto, historial });
    },
    async simularEscenarios(opts = {}) {
      const casos = ESCENARIOS.filter((e) => (!opts.grupo || e.grupo === opts.grupo) && (!opts.claves?.length || opts.claves.includes(e.clave))).slice(0, opts.limite ?? ESCENARIOS.length);
      const contact: Contact = { id: 'escenario', phone: '000', name: 'Cliente de prueba', optInAt: null, optInSource: null, optOutAt: null, lastInboundAt: null };
      const resultados: Calificacion[] = [];
      // Con catalogo real, los precios que diga el modelo pueden venir de ahi.
      const cat = catalogo();
      const catalogoDelCaso = cat && 'productosTienda' in cat ? (await cat.productosTienda().catch(() => [])).map(lineaDeProducto).join('\n') : '';
      for (const caso of casos) {
        // Los mensajes previos del caso van como historial; se juzga la ultima respuesta.
        const historial: MensajeIA[] = [];
        let ultima: RespuestaIA = { texto: '', derivar: false, pedirUbicacion: false };
        let error: string | undefined;
        try {
          for (let i = 0; i < caso.mensajes.length; i++) {
            const texto = caso.mensajes[i]!;
            ultima = await responder({ contact, texto, historial: [...historial] });
            historial.push({ role: 'user', content: texto }, { role: 'assistant', content: ultima.texto });
          }
        } catch (e) {
          error = e instanceof ErrorIA ? `${e.message}${e.detalle ? ` (${e.detalle})` : ''}` : e instanceof Error ? e.message : String(e);
        }
        resultados.push({
          clave: caso.clave,
          grupo: caso.grupo,
          mensajes: caso.mensajes,
          respuesta: ultima.texto,
          derivo: ultima.derivar,
          pidioUbicacion: ultima.pedirUbicacion,
          alertas: error ? [] : calificar(ultima, caso.espera, { conocimiento: `${cfg.conocimiento}\n${cfg.instrucciones}\n${catalogoDelCaso}` }),
          error,
        });
      }
      return { resultados, resumen: resumenDeCalificaciones(resultados) };
    },
    async ayuda(historial, texto) {
      const sistema = [
        `Eres el ayudante del panel del sistema de WhatsApp de "${deps.nombreNegocio()}". Quien te escribe es el dueño o un operador del negocio, no un cliente.`,
        'Responde en español, claro y corto, para alguien que no sabe de tecnología. Di siempre en qué pantalla se hace cada cosa (con su nombre del menú y su ruta, por ejemplo "Mi asistente IA (/panel#ia)").',
        'Usa SOLO el manual de abajo. Si algo no está en el manual, dilo y sugiere mirar Soporte (/soporte) o el manual (/manual). No inventes funciones.',
        'Si la pregunta es sobre por qué no salió un mensaje, explica los motivos más probables y dónde verlo (Historial de envíos).',
        '',
        manualDelSistema(),
      ].join('\n');
      const cruda = await elProveedor().chat([{ role: 'system', content: sistema }, ...historial, { role: 'user', content: texto }], { modelo: modeloEfectivo(), maxTokens: 700 });
      return { texto: leerRespuesta(cruda).texto };
    },
  };
}
