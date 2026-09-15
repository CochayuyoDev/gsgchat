/**
 * Con que modelo habla el asistente.
 *
 * Dos puertas, la misma interfaz:
 *  - Puter (https://puter.com): sin clave de cada proveedor. La tienda pulsa
 *    "Conectar con Puter" en el panel, entra con su cuenta (gratis) y ese
 *    token de sesion es lo que usa el servidor. Los modelos Gemma 4 son
 *    gratuitos; GPT/Claude descuentan de la asignacion de la cuenta. Es lo
 *    mismo que hace Stoky, con lo que ya se aprendio alli.
 *  - Cualquier API compatible con OpenAI (OpenAI, Groq, DeepSeek, Ollama en
 *    local...): una URL base y una clave.
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
}

export interface ProveedorIA {
  nombre: string;
  chat(mensajes: MensajeIA[], opts: OpcionesChat): Promise<string>;
}

export class ErrorIA extends Error {
  constructor(
    message: string,
    readonly proveedor: string,
    readonly detalle?: string,
  ) {
    super(message);
    this.name = 'ErrorIA';
  }
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
        throw new ErrorIA('Puter no pudo responder', 'puter', explicarErrorPuter(error));
      }
      const texto = limpiarRespuesta(typeof respuesta === 'string' ? respuesta : textoDeContenido(respuesta?.message?.content));
      if (!texto) throw new ErrorIA('Puter devolvio una respuesta vacia', 'puter');
      return texto;
    },
  };
}

export function crearProveedorOpenAI(opts: { baseUrl: string; clave: string; fetchImpl?: typeof fetch }): ProveedorIA {
  const base = (opts.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    nombre: 'openai',
    async chat(mensajes, o) {
      const control = new AbortController();
      const corte = setTimeout(() => control.abort(), o.timeoutMs ?? 45_000);
      try {
        const r = await doFetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(opts.clave ? { authorization: `Bearer ${opts.clave}` } : {}) },
          body: JSON.stringify({ model: o.modelo, messages: mensajes, temperature: o.temperatura ?? 0.4, max_tokens: o.maxTokens ?? 1000 }),
          signal: control.signal,
        });
        const cuerpo = (await r.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } };
        if (!r.ok) throw new ErrorIA(`la API respondio ${r.status}`, 'openai', cuerpo.error?.message);
        const texto = limpiarRespuesta(textoDeContenido(cuerpo.choices?.[0]?.message?.content));
        if (!texto) throw new ErrorIA('la API devolvio una respuesta vacia', 'openai');
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
