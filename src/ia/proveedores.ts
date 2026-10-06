/**
 * Con que modelo habla el asistente.
 *
 * Dos puertas, la misma interfaz:
 *  - Puter (https://puter.com): sin clave de cada proveedor. La tienda pulsa
 *    "Conectar con Puter" en el panel, entra con su cuenta (gratis) y ese
 *    token de sesion es lo que usa el servidor. Los modelos Gemma 4 son
 *    gratuitos; GPT/Claude descuentan de la asignacion de la cuenta. Es lo
 *    mismo que hace Stoky, con lo que ya se aprendio alli.
 *  - Cualquier servicio compatible con OpenAI de la lista: una clave y el
 *    servicio; la URL se resuelve internamente y sus modelos se consultan a la API.
 *
 * Lo que hay detras no lo sabe el asistente: recibe la conversacion y
 * devuelve texto. Con un fallo, se lanza; quien llama decide que decirle al
 * cliente (nunca el error crudo).
 */

export interface MensajeIA {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpcionesChat {
  modelo: string;
  temperatura?: number;
  maxTokens?: number;
  /** Cuanto se espera como mucho, en ms. */
  timeoutMs?: number;
  /** Si la API dice cuantos tokens gasto (OpenAI y compatibles lo traen en `usage`), se avisa aqui. */
  alUso?: (uso: { tokensEntrada: number; tokensSalida: number }) => void;
}

export interface ProveedorIA {
  nombre: string;
  chat(mensajes: MensajeIA[], opts: OpcionesChat): Promise<string>;
}

/**
 * Un fallo de la CUENTA, no del momento: se acabó el saldo o la cuota
 * (OpenAI: 429 con `insufficient_quota`, o 402), o la clave ya no vale (401).
 * Reintentar no sirve: hay que recargar o poner otra clave, y se avisa.
 */
export type FalloCuentaIA = 'sin_saldo' | 'clave_invalida';

export class ErrorIA extends Error {
  constructor(
    message: string,
    readonly proveedor: string,
    readonly detalle?: string,
    readonly cuenta: FalloCuentaIA | null = null,
  ) {
    super(message);
    this.name = 'ErrorIA';
  }
}

const TEXTO_SIN_SALDO = /insufficient_quota|insufficient_funds|exceeded your current quota|quota exceeded|billing|credit balance|out of credits|insufficient (balance|credits?)|payment required/i;

/** Lo que dice una respuesta HTTP de una API compatible con OpenAI: ¿es un fallo de la cuenta? */
export function falloDeCuenta(status: number, cuerpo?: { error?: { code?: unknown; type?: unknown; message?: unknown } | string | null } | null): FalloCuentaIA | null {
  const err = cuerpo?.error;
  const code = typeof err === 'object' && err ? `${String(err.code ?? '')} ${String(err.type ?? '')}` : '';
  const mensaje = typeof err === 'string' ? err : typeof err === 'object' && err ? String(err.message ?? '') : '';
  if (status === 402) return 'sin_saldo';
  if (status === 401) return 'clave_invalida';
  if ((status === 429 || status === 403 || status === 400) && (TEXTO_SIN_SALDO.test(code) || TEXTO_SIN_SALDO.test(mensaje))) return 'sin_saldo';
  return null;
}

/** De cualquier error que haya lanzado un proveedor: ¿es un fallo de la cuenta? */
export function falloCuentaDe(error: unknown): FalloCuentaIA | null {
  if (error instanceof ErrorIA) {
    if (error.cuenta) return error.cuenta;
    return TEXTO_SIN_SALDO.test(`${error.message} ${error.detalle ?? ''}`) ? 'sin_saldo' : null;
  }
  return null;
}

/**
 * Puter devuelve `message.content` como texto o como bloques; se saca el
 * texto. Las partes de tipo "thinking"/"reasoning" se descartan: son el
 * razonamiento del modelo, no el mensaje para el cliente.
 */
export function textoDeContenido(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b;
        if (!b || typeof b !== 'object') return '';
        const parte = b as { type?: unknown; text?: unknown };
        if (typeof parte.type === 'string' && /think|reason/i.test(parte.type)) return '';
        return parte.text == null ? '' : String(parte.text);
      })
      .join('')
      .trim();
  }
  if (content && typeof content === 'object' && 'toString' in content) return String(content);
  return '';
}

/**
 * Deja solo el mensaje para el cliente.
 *
 * Gemma 4 "piensa" antes de contestar y, si se le deja, devuelve ese
 * razonamiento dentro de <thought>...</thought> delante del mensaje (a veces
 * sin cerrar, si la respuesta se corto). Fuera eso, las comillas que a veces
 * lo envuelven y el "Asistente:" con que se firma. Es lo mismo que aprendio
 * Stoky con el mismo modelo.
 */
export function limpiarRespuesta(texto: string): string {
  let s = String(texto ?? '');
  for (const e of ['thought', 'think', 'thinking', 'reasoning', 'analysis', 'scratchpad']) {
    s = s.replace(new RegExp('<' + e + '>[\\s\\S]*?</' + e + '>', 'gi'), '');
    // Abierta y nunca cerrada (respuesta cortada): se queda lo de antes.
    s = s.replace(new RegExp('<' + e + '>[\\s\\S]*$', 'i'), '');
    // Solo el cierre suelto: lo de antes era razonamiento.
    s = s.replace(new RegExp('^[\\s\\S]*?</' + e + '>', 'i'), '');
  }
  s = s.trim();
  if (s.length > 1 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('«') && s.endsWith('»')))) s = s.slice(1, -1).trim();
  return s.replace(/^(?:asistente|assistant|respuesta|mensaje)\s*:\s*/i, '').trim();
}

/** Los errores de Puter llegan en ingles y con tres formas; se dicen en cristiano. */
export function explicarErrorPuter(e: unknown): string {
  const o = (e && typeof e === 'object' ? e : {}) as { code?: unknown; error?: unknown; message?: unknown; msg?: unknown };
  const err = o.error && typeof o.error === 'object' ? (o.error as { code?: unknown; message?: unknown }) : null;
  const code = String(o.code ?? (typeof o.error === 'string' ? o.error : err?.code) ?? '');
  const msg = String(o.message ?? o.msg ?? err?.message ?? (typeof e === 'string' ? e : '') ?? '');
  if (/auth|unauthorized|token/i.test(code) || /unauthorized|invalid token|auth/i.test(msg)) return 'la sesion de Puter no vale: vuelve a pulsar "Conectar con Puter"';
  if (code === 'insufficient_funds' || /insufficient|quota|allowance/i.test(msg)) return 'la cuenta de Puter agoto su asignacion de este mes';
  if (/model/i.test(msg) && /not found|unknown|unsupported/i.test(msg)) return 'Puter ya no ofrece ese modelo: elige otro';
  return msg || code || 'Puter no respondio';
}

/** Con estos codigos no tiene sentido reintentar sin el parametro de razonamiento. */
const SIN_REINTENTO = /auth|popup|funds|quota|unauthorized/i;

type PuterCliente = { ai: { chat(mensajes: MensajeIA[], opts: Record<string, unknown>): Promise<{ message?: { content?: unknown } } | string> } };

/**
 * El cliente de Puter se carga solo cuando hace falta: el paquete trae medio
 * navegador y no tiene sentido pagarlo en un arranque que no usa IA.
 */
async function cargarPuter(token: string): Promise<PuterCliente> {
  const modulo = (await import('@heyputer/puter.js/src/init.cjs')) as { init?: (token: string) => PuterCliente; default?: { init?: (token: string) => PuterCliente } };
  const init = modulo.init ?? modulo.default?.init;
  if (!init) throw new ErrorIA('no se pudo cargar el cliente de Puter', 'puter');
  return init(token);
}

export function crearProveedorPuter(token: string, cargar: (token: string) => Promise<PuterCliente> = cargarPuter): ProveedorIA {
  let cliente: Promise<PuterCliente> | null = null;
  return {
    nombre: 'puter',
    async chat(mensajes, opts) {
      if (!token) throw new ErrorIA('falta la sesion de Puter: pulsa "Conectar con Puter"', 'puter');
      let respuesta: Awaited<ReturnType<PuterCliente['ai']['chat']>>;
      const base = { model: opts.modelo, temperature: opts.temperatura ?? 0.4, max_tokens: opts.maxTokens ?? 1000 };
      const ms = opts.timeoutMs ?? 45_000;
      try {
        cliente ??= cargar(token);
        const puter = await cliente;
        // Gemma razona en voz alta: se le pide que no (parametro que Puter
        // reenvia) y, si el proveedor no acepta el parametro, se reintenta
        // sin el. Sin sesion o sin saldo no se reintenta.
        try {
          respuesta = await conTiempo(puter.ai.chat(mensajes, { ...base, reasoning: { enabled: false, exclude: true } }), ms, 'puter');
        } catch (error) {
          if (error instanceof ErrorIA) throw error;
          const o = (error ?? {}) as { code?: unknown; error?: unknown };
          const code = String(o.code ?? (typeof o.error === 'string' ? o.error : (o.error as { code?: unknown } | undefined)?.code) ?? '');
          if (SIN_REINTENTO.test(code) || SIN_REINTENTO.test(explicarErrorPuter(error))) throw error;
          respuesta = await conTiempo(puter.ai.chat(mensajes, base), ms, 'puter');
        }
      } catch (error) {
        if (error instanceof ErrorIA) throw error;
        cliente = null;
        const explicado = explicarErrorPuter(error);
        const cuenta: FalloCuentaIA | null = /agoto su asignacion/.test(explicado) ? 'sin_saldo' : /no vale/.test(explicado) ? 'clave_invalida' : null;
        throw new ErrorIA('Puter no pudo responder', 'puter', explicado, cuenta);
      }
      const texto = limpiarRespuesta(typeof respuesta === 'string' ? respuesta : textoDeContenido(respuesta?.message?.content));
      if (!texto) throw new ErrorIA('Puter devolvio una respuesta vacia', 'puter');
      return texto;
    },
  };
}

/**
 * Lo que cada modelo NO acepta, aprendido de sus propios errores: los modelos
 * nuevos de OpenAI (gpt-5, o1, o3, o4…) rechazan `max_tokens` (piden
 * `max_completion_tokens`) y una `temperature` distinta de la de fábrica. Los
 * demás servicios compatibles (OpenRouter, Groq, DeepSeek…) siguen pidiendo
 * `max_tokens`, así que no se cambia para todos: se prueba, y si el modelo lo
 * rechaza se reintenta UNA vez sin eso y se recuerda para ese modelo.
 */
const ajustesDelModelo = new Map<string, { completion?: boolean; sinTemperatura?: boolean }>();

/** Solo para las pruebas: olvida lo aprendido. */
export function olvidarAjustesDeModelos(): void {
  ajustesDelModelo.clear();
}

/**
 * Los modelos de razonamiento gastan parte del tope en «pensar»: con el tope
 * corto de clasificar (8 tokens) no les quedaría nada para contestar.
 */
const MINIMO_CON_RAZONAMIENTO = 2000;

export function crearProveedorOpenAI(opts: { baseUrl: string; clave: string; fetchImpl?: typeof fetch }): ProveedorIA {
  const base = (opts.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    nombre: 'openai',
    async chat(mensajes, o) {
      const control = new AbortController();
      const corte = setTimeout(() => control.abort(), o.timeoutMs ?? 45_000);
      try {
        const clave = `${base}|${o.modelo}`;
        const cuerpoDe = (): string => {
          const aj = ajustesDelModelo.get(clave) ?? {};
          const tope = o.maxTokens ?? 1000;
          return JSON.stringify({
            model: o.modelo,
            messages: mensajes,
            ...(aj.sinTemperatura ? {} : { temperature: o.temperatura ?? 0.4 }),
            ...(aj.completion ? { max_completion_tokens: Math.max(tope, MINIMO_CON_RAZONAMIENTO) } : { max_tokens: tope }),
          });
        };
        type Cuerpo = { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string; code?: unknown; type?: unknown; param?: unknown }; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
        const pedir = async (): Promise<{ r: Response; cuerpo: Cuerpo }> => {
          const r = await doFetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(opts.clave ? { authorization: `Bearer ${opts.clave}` } : {}) },
            body: cuerpoDe(),
            signal: control.signal,
          });
          return { r, cuerpo: (await r.json().catch(() => ({}))) as Cuerpo };
        };
        let { r, cuerpo } = await pedir();
        // Como mucho dos ajustes (el tope y la temperatura), cada uno una vez.
        for (let intento = 0; intento < 2 && r.status === 400; intento++) {
          const que = `${String(cuerpo.error?.param ?? '')} ${cuerpo.error?.message ?? ''}`;
          const aj = { ...(ajustesDelModelo.get(clave) ?? {}) };
          if (!aj.completion && /max_tokens/.test(que) && /max_completion_tokens|not supported|unsupported/i.test(que)) aj.completion = true;
          else if (!aj.sinTemperatura && /temperature/i.test(que) && /unsupported|not supported|does not support|only the default/i.test(que)) aj.sinTemperatura = true;
          else break;
          ajustesDelModelo.set(clave, aj);
          ({ r, cuerpo } = await pedir());
        }
        if (!r.ok) throw new ErrorIA(`la API respondio ${r.status}`, 'openai', cuerpo.error?.message, falloDeCuenta(r.status, cuerpo));
        const texto = limpiarRespuesta(textoDeContenido(cuerpo.choices?.[0]?.message?.content));
        if (!texto) throw new ErrorIA('la API devolvio una respuesta vacia', 'openai');
        if (o.alUso && cuerpo.usage) {
          const entrada = Number(cuerpo.usage.prompt_tokens);
          const salida = Number(cuerpo.usage.completion_tokens);
          if (Number.isFinite(entrada) || Number.isFinite(salida)) o.alUso({ tokensEntrada: Number.isFinite(entrada) ? entrada : 0, tokensSalida: Number.isFinite(salida) ? salida : 0 });
        }
        return texto;
      } catch (error) {
        if (error instanceof ErrorIA) throw error;
        throw new ErrorIA(control.signal.aborted ? 'la API no respondio a tiempo' : 'no se pudo contactar con la API', 'openai', error instanceof Error ? error.message : String(error));
      } finally {
        clearTimeout(corte);
      }
    },
  };
}

async function conTiempo<T>(p: Promise<T>, ms: number, proveedor: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const reloj = new Promise<never>((_r, reject) => {
    t = setTimeout(() => reject(new ErrorIA('el modelo no respondio a tiempo', proveedor)), ms);
  });
  try {
    return await Promise.race([p, reloj]);
  } finally {
    clearTimeout(t);
  }
}

/** Modelos que se ofrecen en la pantalla; se puede escribir cualquier otro. */
export const MODELOS_SUGERIDOS: Record<'puter' | 'openai', string[]> = {
  // Con Puter solo los gratuitos de verdad (costo cero por token en su
  // catalogo). GPT, Claude o Gemini descuentan de la cuenta de quien los usa.
  puter: ['google/gemma-4-31b-it', 'google/gemma-4-26b-a4b-it'],
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'llama-3.3-70b-versatile', 'deepseek-chat'],
};

/**
 * Los servicios compatibles con la API de OpenAI que se ofrecen en la
 * pantalla: se elige uno y sus modelos se consultan con la clave; la URL base
 * del servicio se resuelve aquí y no se pide a la persona. Es lo mismo que tiene Stoky (Groq, Google,
 * OpenRouter, Together, Ollama, otro), para que quien ya lo configuro alli
 * lo reconozca aqui.
 */
export type ServicioOpenAI = 'openai' | 'groq' | 'openrouter' | 'together' | 'deepseek' | 'google' | 'mistral' | 'ollama' | 'otro';

export interface PresetServicio {
  id: ServicioOpenAI;
  nombre: string;
  baseUrl: string;
  modelos: string[];
  /** Donde se saca la clave, en una linea. */
  clave: string;
  /** Si no hace falta clave (Ollama en local). */
  sinClave?: boolean;
  nota?: string;
}

export const SERVICIOS_OPENAI: PresetServicio[] = [
  { id: 'openai', nombre: 'OpenAI (ChatGPT)', baseUrl: 'https://api.openai.com/v1', modelos: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'], clave: 'platform.openai.com → API keys (de pago, por uso)' },
  { id: 'groq', nombre: 'Groq (gratis, muy rápido)', baseUrl: 'https://api.groq.com/openai/v1', modelos: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'], clave: 'console.groq.com → API Keys (plan gratis con límites por minuto)' },
  { id: 'google', nombre: 'Google AI Studio (Gemini, gratis)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', modelos: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'], clave: 'aistudio.google.com → Get API key (plan gratis con límites)' },
  { id: 'openrouter', nombre: 'OpenRouter (muchos modelos, algunos gratis)', baseUrl: 'https://openrouter.ai/api/v1', modelos: ['openai/gpt-4o-mini', 'google/gemma-3-27b-it:free', 'meta-llama/llama-3.3-70b-instruct:free'], clave: 'openrouter.ai → Keys' },
  { id: 'together', nombre: 'Together AI', baseUrl: 'https://api.together.xyz/v1', modelos: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'], clave: 'api.together.xyz → API keys' },
  { id: 'deepseek', nombre: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', modelos: ['deepseek-chat'], clave: 'platform.deepseek.com → API keys' },
  { id: 'mistral', nombre: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', modelos: ['mistral-small-latest', 'mistral-large-latest'], clave: 'console.mistral.ai → API Keys' },
  { id: 'ollama', nombre: 'Ollama (en esta PC, sin clave)', baseUrl: 'http://localhost:11434/v1', modelos: ['llama3.1', 'gemma3', 'qwen2.5'], clave: 'no hace falta: instala Ollama y descarga un modelo (ollama pull llama3.1)', sinClave: true },
  { id: 'otro', nombre: 'Otro compatible con OpenAI', baseUrl: '', modelos: [], clave: 'la que te dé ese servicio' },
];

/** El modelo de OpenAI por defecto: el de consumo muy bajo. */
export const MODELO_OPENAI_POR_DEFECTO = 'gpt-4o-mini';

/** Los de consumo muy bajo que se recomiendan (si la cuenta los tiene). */
const MODELOS_MUY_BAJO = ['gpt-4o-mini', 'gpt-4.1-mini'];

export interface ModeloDeLaCuenta {
  id: string;
  /** "Recomendado · consumo muy bajo", "consumo bajo" o null. */
  etiqueta: string | null;
  recomendado: boolean;
}

export interface ListaModelosOpenAI {
  ok: boolean;
  /** Los modelos de chat de la cuenta, el recomendado primero. Sin lista: solo el de por defecto. */
  modelos: ModeloDeLaCuenta[];
  /** El que conviene dejar elegido. */
  elegido: string;
  /** En palabras, para la pantalla (por que no se pudo listar, o cuantos hay). */
  detalle: string;
}

/**
 * Lo que no es un modelo para conversar: embeddings, audio, imagen,
 * moderacion, busqueda... La cuenta de OpenAI los lista todos juntos.
 */
const NO_ES_CHAT = /embedding|whisper|tts|dall-?e|moderation|audio|realtime|transcribe|image|search|babbage|davinci|computer-use|codex|sora/i;

/** Que se le dice en la pantalla junto al modelo, sin inventar nada: solo mira el id. */
export function etiquetaDeModelo(id: string): string | null {
  if (MODELOS_MUY_BAJO.includes(id)) return 'Recomendado · consumo muy bajo';
  if (/5\.6|luna/i.test(id)) return 'consumo bajo';
  return null;
}

/** Ordena y etiqueta una lista de ids de modelos (los de chat): recomendados, luego consumo bajo, luego el resto. */
export function ordenarModelosOpenAI(ids: string[]): ModeloDeLaCuenta[] {
  const unicos = [...new Set(ids.map((i) => String(i).trim()).filter((i) => i && !NO_ES_CHAT.test(i)))];
  const peso = (id: string): number => {
    const i = MODELOS_MUY_BAJO.indexOf(id);
    if (i >= 0) return i;
    return etiquetaDeModelo(id) ? 10 : 20;
  };
  return unicos
    .sort((a, b) => peso(a) - peso(b) || a.localeCompare(b))
    .map((id) => ({ id, etiqueta: etiquetaDeModelo(id), recomendado: MODELOS_MUY_BAJO.includes(id) }));
}

const SIN_LISTA = (detalle: string): ListaModelosOpenAI => ({
  ok: false,
  modelos: [{ id: MODELO_OPENAI_POR_DEFECTO, etiqueta: 'Recomendado · consumo muy bajo', recomendado: true }],
  elegido: MODELO_OPENAI_POR_DEFECTO,
  detalle,
});

/**
 * Los modelos REALES de la cuenta de OpenAI de esa clave (GET /v1/models).
 * Nunca lanza: si no se puede listar, devuelve gpt-4o-mini y el motivo en
 * palabras.
 */
export async function listarModelosOpenAI(opts: { clave: string; fetchImpl?: typeof fetch; timeoutMs?: number; baseUrl?: string; servicio?: ServicioOpenAI }): Promise<ListaModelosOpenAI> {
  const clave = (opts.clave ?? '').trim();
  const servicio = opts.servicio ?? 'openai';
  const preset = presetDe(servicio);
  const nombre = preset?.nombre.split(' (')[0] ?? 'el servicio';
  const sinLista = (detalle: string): ListaModelosOpenAI => servicio === 'openai'
    ? SIN_LISTA(detalle)
    : { ok: false, modelos: [], elegido: '', detalle };
  if (!preset?.baseUrl) return sinLista('Ese servicio necesita una URL propia y no se puede detectar automáticamente. Elige un servicio de la lista.');
  if (!clave && !preset?.sinClave) return sinLista(`Pega la clave de ${nombre} para ver los modelos de tu cuenta.`);
  const doFetch = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl || preset?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), opts.timeoutMs ?? 15_000);
  try {
    const r = await doFetch(`${base}/models`, { headers: { authorization: `Bearer ${clave}` }, signal: control.signal });
    const cuerpo = (await r.json().catch(() => ({}))) as { data?: Array<{ id?: unknown }>; error?: { message?: string } };
    if (!r.ok) {
      const porQue = r.status === 401 ? `${nombre} dice que esa clave no vale (revisa que la pegaste entera).` : r.status === 429 ? `${nombre} dice que la cuenta llegó a su límite o no tiene saldo.` : `${nombre} no dejó ver los modelos de la cuenta.`;
      return sinLista(porQue);
    }
    const modelos = ordenarModelosOpenAI((cuerpo.data ?? []).map((m) => String(m?.id ?? '')));
    if (!modelos.length) return sinLista(`${nombre} no devolvió modelos compatibles con chat.`);
    const elegido = modelos.find((m) => m.id === MODELO_OPENAI_POR_DEFECTO)?.id ?? modelos[0]!.id;
    return { ok: true, modelos, elegido, detalle: `La API de ${nombre} ofrece ${modelos.length} modelos compatibles con chat.` };
  } catch {
    return sinLista(control.signal.aborted ? `${nombre} tardó demasiado en contestar.` : `No se pudo llegar a ${nombre} (revisa la conexión a internet).`);
  } finally {
    clearTimeout(corte);
  }
}

export function presetDe(id: string): PresetServicio | undefined {
  return SERVICIOS_OPENAI.find((s) => s.id === id);
}

export interface PruebaProveedor {
  ok: boolean;
  /** Que contesto el modelo a "di hola" (recortado), o el fallo en cristiano. */
  detalle: string;
  ms: number;
  modelo: string;
  proveedor: string;
  /** Si falló por la cuenta (sin saldo o clave que no vale). */
  cuenta?: FalloCuentaIA | null;
}

/** Le pide al proveedor una frase corta y mide cuanto tarda. Nunca lanza. */
export async function probarProveedor(proveedor: ProveedorIA, modelo: string, timeoutMs = 20_000): Promise<PruebaProveedor> {
  const inicio = Date.now();
  try {
    const texto = await proveedor.chat(
      [
        { role: 'system', content: 'Responde en español, en una sola frase corta.' },
        { role: 'user', content: 'Di "hola, estoy listo" y nada más.' },
      ],
      { modelo, maxTokens: 30, timeoutMs, temperatura: 0 },
    );
    return { ok: true, detalle: `El modelo respondió: "${texto.slice(0, 80)}"`, ms: Date.now() - inicio, modelo, proveedor: proveedor.nombre };
  } catch (error) {
    const e = error instanceof ErrorIA ? error : null;
    const detalle = e ? `${e.message}${e.detalle ? ` (${e.detalle})` : ''}` : error instanceof Error ? error.message : String(error);
    const cuenta = falloCuentaDe(error);
    return { ok: false, detalle: cuenta === 'sin_saldo' ? 'Se acabó el saldo de la cuenta de ese servicio: recárgalo en su página (en OpenAI: platform.openai.com → Billing) y vuelve a probar.' : explicarFalloConexion(detalle), ms: Date.now() - inicio, modelo, proveedor: proveedor.nombre, cuenta };
  }
}

/** Los fallos tipicos de una API, dichos para quien no programa. */
export function explicarFalloConexion(detalle: string): string {
  if (/401|invalid api key|incorrect api key|unauthorized|authentication/i.test(detalle)) return 'La clave no vale para ese servicio: revisa que la pegaste entera y que es de ese proveedor.';
  if (/403|forbidden|permission/i.test(detalle)) return 'El servicio rechazó la clave (sin permiso). Revisa el plan o el proyecto de la clave.';
  if (/404|not found|does not exist|unknown model|model_not_found/i.test(detalle)) return `Ese modelo no existe en el servicio elegido: ${detalle}`;
  if (/429|rate limit|quota|insufficient_quota|exceeded/i.test(detalle)) return 'El servicio dice que se agotó el cupo o el límite por minuto. Espera un momento o revisa el plan.';
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|no se pudo contactar/i.test(detalle)) return 'No se pudo llegar al servicio elegido: revisa la conexión a internet.';
  if (/no respondio a tiempo|timeout|abort/i.test(detalle)) return 'El servicio tardó demasiado en responder. Prueba otra vez o con un modelo más ligero.';
  return detalle;
}
