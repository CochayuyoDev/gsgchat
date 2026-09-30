/**
 * ElevenLabs: la voz del asistente y el oido para los audios del cliente.
 *
 * Tres llamadas y nada mas:
 *  - texto → nota de voz (text-to-speech). Se pide en Opus dentro de Ogg,
 *    que es lo que WhatsApp entiende como "nota de voz" (con el dibujo de la
 *    onda y el play). Si la cuenta no tiene ese formato, se cae a MP3: llega
 *    como un audio normal, pero llega.
 *  - audio → texto (speech-to-text, "scribe"): lo que dijo el cliente en su
 *    nota de voz, para que el asistente lo lea y una persona lo vea escrito.
 *  - la cuenta: si la clave vale y cuantos caracteres quedan este mes.
 *
 * Los errores vuelven en palabras, con lo que hay que hacer, porque acaban
 * en la pantalla del negocio y no en un log.
 */

export interface VozElevenLabs {
  id: string;
  nombre: string;
  /** premade, cloned, generated, professional... */
  categoria: string;
  /** Lo que ElevenLabs sabe de la voz: idioma, genero, acento, edad, uso. */
  etiquetas: Record<string, string>;
  muestraUrl: string | null;
}

export interface AudioGenerado {
  datos: Buffer;
  /** audio/ogg; codecs=opus (nota de voz) o audio/mpeg (fichero de audio). */
  mimeType: string;
  formato: 'opus' | 'mp3';
}

export interface CuentaElevenLabs {
  plan: string;
  caracteresUsados: number;
  caracteresLimite: number;
  /** Cuando vuelve a empezar la cuenta de caracteres. */
  renuevaEl: Date | null;
}

export interface ClienteVoz {
  voces(): Promise<VozElevenLabs[]>;
  hablar(texto: string, opts: { vozId: string; modelo: string; idioma?: string }): Promise<AudioGenerado>;
  transcribir(audio: Buffer, mimeType: string, opts?: { idioma?: string }): Promise<{ texto: string; idioma: string | null }>;
  cuenta(): Promise<CuentaElevenLabs>;
}

export class ErrorVoz extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
    /** clave | cuota | saturado | formato | red | otro */
    readonly codigo: string = 'otro',
  ) {
    super(message);
    this.name = 'ErrorVoz';
  }
}

export interface OpcionesElevenLabs {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Cuanto se espera a ElevenLabs (por defecto 45 s: un audio largo tarda). */
  timeoutMs?: number;
}

/** Los modelos que se ofrecen en la pantalla, con lo que hay que saber de cada uno. */
export const MODELOS_VOZ: Array<{ id: string; nombre: string; nota: string }> = [
  { id: 'eleven_multilingual_v2', nombre: 'Multilingüe v2 (la mejor calidad)', nota: 'Suena más natural; tarda un poco más.' },
  { id: 'eleven_flash_v2_5', nombre: 'Flash v2.5 (rápido y barato)', nota: 'Responde en menos de un segundo y gasta la mitad de caracteres.' },
  { id: 'eleven_turbo_v2_5', nombre: 'Turbo v2.5 (equilibrado)', nota: 'Entre los dos: buena calidad y rápido.' },
];

export const MODELO_VOZ_POR_DEFECTO = 'eleven_multilingual_v2';

const FORMATO_OPUS = 'opus_48000_64';
const FORMATO_MP3 = 'mp3_44100_64';

/** Lee el detalle de un error de ElevenLabs, que viene de varias formas. */
function detalleDe(cuerpo: unknown): { estado: string; mensaje: string } {
  const c = (cuerpo ?? {}) as { detail?: unknown; message?: string; error?: string };
  const d = c.detail;
  if (typeof d === 'string') return { estado: '', mensaje: d };
  if (d && typeof d === 'object') {
    const o = d as { status?: string; message?: string };
    return { estado: o.status ?? '', mensaje: o.message ?? JSON.stringify(d) };
  }
  return { estado: '', mensaje: c.message ?? c.error ?? '' };
}

/** El error en palabras, con lo que hay que hacer. */
export function explicarError(status: number, cuerpo: unknown): ErrorVoz {
  const { estado, mensaje } = detalleDe(cuerpo);
  // La cuota agotada llega tambien como 401: se mira antes que la clave.
  if (status === 402 || /quota_exceeded|exceeds your quota|character limit|insufficient/i.test(`${estado} ${mensaje}`)) {
    return new ErrorVoz('Se acabaron los caracteres del plan de ElevenLabs por este mes: mientras se renueva, el asistente contesta por escrito.', status, 'cuota');
  }
  if (status === 401 || /invalid_api_key|api key|xi-api-key/i.test(`${estado} ${mensaje}`)) {
    return new ErrorVoz('ElevenLabs no acepta la clave: cópiala de nuevo desde elevenlabs.io (tu perfil → API Keys) y pégala aquí.', status, 'clave');
  }
  if (status === 429 || /too_many|rate limit|system_busy/i.test(`${estado} ${mensaje}`)) {
    return new ErrorVoz('ElevenLabs está saturado ahora mismo: este mensaje sale por escrito y el siguiente se vuelve a intentar con voz.', status, 'saturado');
  }
  if (/output_format|format|not available|permission|tier|upgrade/i.test(`${estado} ${mensaje}`)) {
    return new ErrorVoz(`Tu plan de ElevenLabs no permite ese formato de audio (${mensaje || estado}).`, status, 'formato');
  }
  if (/voice_not_found|voice not found|invalid voice/i.test(`${estado} ${mensaje}`)) {
    return new ErrorVoz('Esa voz ya no existe en tu cuenta de ElevenLabs: elige otra en la lista.', status, 'voz');
  }
  return new ErrorVoz(`ElevenLabs respondió ${status}${mensaje ? `: ${mensaje}` : ''}.`, status, 'otro');
}

export function crearClienteElevenLabs(opts: OpcionesElevenLabs): ClienteVoz {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl ?? 'https://api.elevenlabs.io').replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 45_000;

  async function llamar(ruta: string, init: RequestInit & { esperaBinario?: boolean }): Promise<{ status: number; ok: boolean; cuerpo: unknown; bytes: Buffer | null }> {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${base}${ruta}`, {
        ...init,
        signal: controlador.signal,
        headers: { 'xi-api-key': opts.apiKey, ...(init.headers ?? {}) },
      });
    } catch (error) {
      clearTimeout(temporizador);
      const abortado = error instanceof Error && error.name === 'AbortError';
      throw new ErrorVoz(abortado ? 'ElevenLabs tardó demasiado en responder: este mensaje sale por escrito.' : 'No se pudo llegar a ElevenLabs (sin internet o bloqueado desde este servidor).', undefined, 'red');
    }
    clearTimeout(temporizador);
    const tipo = response.headers.get('content-type') ?? '';
    if (response.ok && init.esperaBinario && !/json/i.test(tipo)) {
      return { status: response.status, ok: true, cuerpo: null, bytes: Buffer.from(await response.arrayBuffer()) };
    }
    const texto = await response.text();
    let cuerpo: unknown = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      cuerpo = { message: texto.slice(0, 300) };
    }
    return { status: response.status, ok: response.ok, cuerpo, bytes: null };
  }

  async function generar(texto: string, vozId: string, modelo: string, formato: string, idioma?: string): Promise<Buffer> {
    const cuerpo: Record<string, unknown> = {
      text: texto,
      model_id: modelo,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
    };
    // Solo los modelos rapidos aceptan el idioma; el multilingue lo detecta solo.
    if (idioma && /flash|turbo/.test(modelo)) cuerpo.language_code = idioma;
    const r = await llamar(`/v1/text-to-speech/${encodeURIComponent(vozId)}?output_format=${formato}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: formato.startsWith('opus') ? 'audio/ogg' : 'audio/mpeg' },
      body: JSON.stringify(cuerpo),
      esperaBinario: true,
    });
    if (!r.ok || !r.bytes) throw explicarError(r.status, r.cuerpo);
    if (!r.bytes.length) throw new ErrorVoz('ElevenLabs devolvió un audio vacío.', r.status, 'otro');
    return r.bytes;
  }

  return {
    async voces() {
      const r = await llamar('/v1/voices', { method: 'GET' });
      if (!r.ok) throw explicarError(r.status, r.cuerpo);
      const lista = ((r.cuerpo as { voices?: unknown[] })?.voices ?? []) as Array<{ voice_id: string; name: string; category?: string; labels?: Record<string, string>; preview_url?: string }>;
      return lista.map((v) => ({
        id: v.voice_id,
        nombre: v.name,
        categoria: v.category ?? '',
        etiquetas: v.labels ?? {},
        muestraUrl: v.preview_url ?? null,
      }));
    },

    async hablar(texto, o) {
      try {
        const datos = await generar(texto, o.vozId, o.modelo, FORMATO_OPUS, o.idioma);
        // Lo que vuelve tiene que ser Ogg de verdad ("OggS" al principio):
        // si no, WhatsApp no lo reproduce como nota de voz.
        if (datos.subarray(0, 4).toString('latin1') === 'OggS') return { datos, mimeType: 'audio/ogg; codecs=opus', formato: 'opus' };
        return { datos, mimeType: 'audio/mpeg', formato: 'mp3' };
      } catch (error) {
        // Un plan sin Opus, o un formato que ElevenLabs cambio: MP3 vale
        // igual. Lo que no se reintenta es una clave mala o la cuota agotada,
        // que fallarian exactamente igual.
        if (error instanceof ErrorVoz && (error.codigo === 'formato' || error.codigo === 'otro')) {
          const datos = await generar(texto, o.vozId, o.modelo, FORMATO_MP3, o.idioma);
          return { datos, mimeType: 'audio/mpeg', formato: 'mp3' };
        }
        throw error;
      }
    },

    async transcribir(audio, mimeType, o = {}) {
      const form = new FormData();
      form.append('model_id', 'scribe_v1');
      if (o.idioma) form.append('language_code', o.idioma);
      form.append('tag_audio_events', 'false');
      const extension = /ogg|opus/i.test(mimeType) ? 'ogg' : /mpeg|mp3/i.test(mimeType) ? 'mp3' : /mp4|m4a|aac/i.test(mimeType) ? 'm4a' : /wav/i.test(mimeType) ? 'wav' : 'bin';
      form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType.split(';')[0]!.trim() }), `audio.${extension}`);
      const r = await llamar('/v1/speech-to-text', { method: 'POST', body: form });
      if (!r.ok) throw explicarError(r.status, r.cuerpo);
      const c = (r.cuerpo ?? {}) as { text?: string; language_code?: string };
      return { texto: (c.text ?? '').trim(), idioma: c.language_code ?? null };
    },

    async cuenta() {
      const r = await llamar('/v1/user/subscription', { method: 'GET' });
      if (!r.ok) throw explicarError(r.status, r.cuerpo);
      const c = (r.cuerpo ?? {}) as { tier?: string; character_count?: number; character_limit?: number; next_character_count_reset_unix?: number };
      return {
        plan: c.tier ?? '',
        caracteresUsados: c.character_count ?? 0,
        caracteresLimite: c.character_limit ?? 0,
        renuevaEl: c.next_character_count_reset_unix ? new Date(c.next_character_count_reset_unix * 1000) : null,
      };
    },
  };
}
