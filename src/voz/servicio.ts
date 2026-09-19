/**
 * La voz del asistente: contestar con audios y entender los del cliente.
 *
 * Se configura desde la pantalla (Mi asistente IA → Voz): la clave de
 * ElevenLabs (cifrada, como el token de la IA), la voz, el modelo y CUANDO
 * contesta con audio (nunca, solo si el cliente mandó un audio, siempre).
 * Otro sistema (Stoky) no configura nada: pide `voz: true` en
 * POST /api/v1/mensajes y la nota de voz sale de aquí con la voz de la
 * tienda.
 *
 * Lo que dice el cliente en un audio se transcribe al llegar: el asistente
 * lo lee como si fuera texto, en el chat se ve escrito y sale en el webhook
 * (`transcripcion`). Sin clave, nada de esto pasa y el sistema sigue como
 * antes: contesta por escrito y a un audio le pide el texto.
 *
 * La voz nunca es un motivo para no contestar: si ElevenLabs falla, se
 * acabó la cuota o el texto es muy largo, el mensaje sale por escrito.
 */

import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SettingsRepo } from '../settings/service.js';
import { decrypt, encrypt, keyFromBase64 } from '../settings/crypto.js';
import type { Sender, SendOutcome } from '../outbound/sender.js';
import { extensionDe, idDeMedia } from '../whatsapp/local/media.js';
import { crearClienteElevenLabs, ErrorVoz, MODELO_VOZ_POR_DEFECTO, MODELOS_VOZ, type ClienteVoz, type CuentaElevenLabs, type VozElevenLabs } from './elevenlabs.js';

const CLAVE_CONFIG = 'voz.config';
const CLAVE_API = 'voz.clave';

export type CuandoConVoz = 'nunca' | 'si-manda-audio' | 'siempre';

const configSchema = z.object({
  /** El interruptor general: apagado, el asistente no genera audios (la transcripción sigue si está marcada). */
  activa: z.boolean().default(false),
  vozId: z.string().trim().max(120).default(''),
  vozNombre: z.string().trim().max(120).default(''),
  modelo: z.string().trim().max(60).default(MODELO_VOZ_POR_DEFECTO),
  cuando: z.enum(['nunca', 'si-manda-audio', 'siempre']).default('si-manda-audio'),
  /** Entender los audios del cliente (transcribirlos). */
  transcribir: z.boolean().default(true),
  /** Por encima de esto, el mensaje va por escrito: un audio de tres minutos no lo escucha nadie. */
  maxCaracteres: z.number().int().min(50).max(5000).default(600),
  idioma: z.string().trim().min(2).max(5).default('es'),
});
export type ConfigVoz = z.infer<typeof configSchema>;
export const CONFIG_VOZ_VACIA: ConfigVoz = configSchema.parse({});

export interface EstadoVoz extends ConfigVoz {
  /** Hay clave guardada (nunca se devuelve la clave). */
  tieneClave: boolean;
  /** Los últimos 4 de la clave, para reconocerla. */
  claveTermina: string | null;
  /** Se pueden generar audios ahora mismo: clave + voz + activa. */
  lista: boolean;
  /** Por qué no está lista, en palabras. */
  motivo: string | null;
  modelos: typeof MODELOS_VOZ;
  cuenta: (CuentaElevenLabs & { at: string }) | null;
  ultimoError: { at: string; detalle: string } | null;
}

export interface EntradaVoz extends Partial<ConfigVoz> {
  /** Nueva clave; vacío o null = quitarla; ausente = conservar. */
  clave?: string | null;
}

export interface NotaDeVoz {
  datos: Buffer;
  mimeType: string;
  formato: 'opus' | 'mp3';
}

export interface ResultadoEnvioVoz {
  /** Cómo salió al final. */
  enviadoComo: 'audio' | 'texto';
  /** Por qué fue por escrito, si se pidió audio. */
  motivo: string | null;
  outcome: SendOutcome;
}

export interface ServicioVoz {
  estado(): EstadoVoz;
  recargar(): Promise<void>;
  guardar(input: EntradaVoz): Promise<EstadoVoz>;
  /** Comprueba la clave (la guardada o una candidata) contra ElevenLabs: plan y caracteres. */
  probar(candidata?: string): Promise<{ ok: boolean; detalle: string; cuenta: CuentaElevenLabs | null }>;
  voces(): Promise<VozElevenLabs[]>;
  /** Un audio corto para escuchar la voz en la pantalla (no sale por WhatsApp). */
  muestra(opts?: { texto?: string; vozId?: string; modelo?: string }): Promise<NotaDeVoz>;
  /** true = se puede generar audio ahora (clave, voz y encendida). */
  disponible(): boolean;
  /** Si el asistente debe contestar con audio a este entrante, según "cuándo". */
  contestarConAudio(entrante: { esAudio: boolean }): boolean;
  puedeTranscribir(): boolean;
  /** Convierte el texto en nota de voz; null si no toca (muy largo, sin clave, apagada) o si ElevenLabs falló (queda en ultimoError). */
  notaDeVoz(texto: string): Promise<{ nota: NotaDeVoz | null; motivo: string | null }>;
  /** Lo que dijo el cliente en su audio; null si no se pudo o no está activada la transcripción. */
  transcribir(audio: Buffer, mimeType: string): Promise<string | null>;
  /** Transcribe un adjunto ya guardado en .wa-media por su id. */
  transcribirGuardado(mediaId: string, mimeType: string): Promise<string | null>;
  /**
   * Manda el texto como nota de voz (y si no se puede, por escrito). El
   * fichero queda en .wa-media para que el chat lo reproduzca, y el texto
   * dicho va de pie de foto: en el hilo se lee lo que se dijo.
   */
  enviar(opts: { phone: string; texto: string; origen?: string; autorNombre?: string; manual?: boolean; categoria?: 'UTILITY' | 'MARKETING' }): Promise<ResultadoEnvioVoz>;
}

export interface DepsVoz {
  settingsRepo: SettingsRepo;
  settingsKeyBase64: string;
  sender: Sender;
  /** Donde viven los adjuntos (.wa-media). */
  mediaDir: string;
  fetchImpl?: typeof fetch;
  /** Para pruebas: quién fabrica el cliente de ElevenLabs. */
  fabrica?: (apiKey: string) => ClienteVoz;
  ahora?: () => Date;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

/** Los ultimos 4 de una clave, para la pantalla. */
const terminaEn = (clave: string): string | null => (clave.length >= 8 ? clave.slice(-4) : null);

export async function crearServicioVoz(deps: DepsVoz): Promise<ServicioVoz> {
  const key = keyFromBase64(deps.settingsKeyBase64);
  const log = deps.log ?? (() => undefined);
  const ahora = () => deps.ahora?.() ?? new Date();
  const fabrica = deps.fabrica ?? ((apiKey: string) => crearClienteElevenLabs({ apiKey, fetchImpl: deps.fetchImpl }));

  let cfg: ConfigVoz = CONFIG_VOZ_VACIA;
  let clave = '';
  let cliente: { clave: string; c: ClienteVoz } | null = null;
  let cuenta: EstadoVoz['cuenta'] = null;
  let ultimoError: EstadoVoz['ultimoError'] = null;

  const conCliente = (): ClienteVoz | null => {
    if (!clave) {
      cliente = null;
      return null;
    }
    if (!cliente || cliente.clave !== clave) cliente = { clave, c: fabrica(clave) };
    return cliente.c;
  };

  async function recargar(): Promise<void> {
    cfg = CONFIG_VOZ_VACIA;
    clave = '';
    for (const row of await deps.settingsRepo.getAll()) {
      if (row.key === CLAVE_CONFIG) {
        try {
          cfg = configSchema.parse(JSON.parse(row.value));
        } catch {
          log('la configuración de voz guardada no se pudo leer: se ignora');
        }
      } else if (row.key === CLAVE_API) {
        try {
          clave = row.encrypted ? decrypt(row.value, key) : row.value;
        } catch {
          log('no se pudo descifrar la clave de ElevenLabs: se ignora');
        }
      }
    }
  }
  await recargar();

  const motivoNoLista = (): string | null => {
    if (!clave) return 'Falta la clave de ElevenLabs.';
    if (!cfg.vozId) return 'Falta elegir una voz.';
    if (!cfg.activa) return 'La voz está apagada.';
    return null;
  };
  const disponible = () => motivoNoLista() === null;

  const anotarError = (error: unknown): string => {
    const detalle = error instanceof Error ? error.message : String(error);
    ultimoError = { at: ahora().toISOString(), detalle };
    log('la voz falló', { detalle });
    return detalle;
  };

  function estado(): EstadoVoz {
    return {
      ...cfg,
      tieneClave: Boolean(clave),
      claveTermina: clave ? terminaEn(clave) : null,
      lista: disponible(),
      motivo: motivoNoLista(),
      modelos: MODELOS_VOZ,
      cuenta,
      ultimoError,
    };
  }

  async function probarCon(c: ClienteVoz): Promise<{ ok: boolean; detalle: string; cuenta: CuentaElevenLabs | null }> {
    try {
      const cu = await c.cuenta();
      const quedan = Math.max(0, cu.caracteresLimite - cu.caracteresUsados);
      const renueva = cu.renuevaEl ? ` (se renuevan el ${cu.renuevaEl.toLocaleDateString('es-PE')})` : '';
      return { ok: true, detalle: `Clave correcta. Plan ${cu.plan || 'free'}: quedan ${quedan.toLocaleString('es-PE')} de ${cu.caracteresLimite.toLocaleString('es-PE')} caracteres este mes${renueva}.`, cuenta: cu };
    } catch (error) {
      return { ok: false, detalle: error instanceof Error ? error.message : String(error), cuenta: null };
    }
  }

  async function generar(texto: string, o: { vozId: string; modelo: string }): Promise<NotaDeVoz> {
    const c = conCliente();
    if (!c) throw new ErrorVoz('Falta la clave de ElevenLabs.', undefined, 'clave');
    const r = await c.hablar(texto, { vozId: o.vozId, modelo: o.modelo, idioma: cfg.idioma });
    return { datos: r.datos, mimeType: r.mimeType, formato: r.formato };
  }

  async function transcribir(audio: Buffer, mimeType: string): Promise<string | null> {
    if (!clave || !cfg.transcribir) return null;
    const c = conCliente();
    if (!c) return null;
    try {
      const r = await c.transcribir(audio, mimeType, { idioma: cfg.idioma });
      return r.texto || null;
    } catch (error) {
      anotarError(error);
      return null;
    }
  }

  async function notaDeVoz(texto: string): Promise<{ nota: NotaDeVoz | null; motivo: string | null }> {
    const motivo = motivoNoLista();
    if (motivo) return { nota: null, motivo };
    const limpio = texto.trim();
    if (!limpio) return { nota: null, motivo: 'El mensaje va vacío.' };
    if (limpio.length > cfg.maxCaracteres) return { nota: null, motivo: `El mensaje es más largo que el tope para audios (${cfg.maxCaracteres} caracteres): sale por escrito.` };
    // Un audio con una URL leida letra a letra no lo entiende nadie.
    if (/https?:\/\/\S{12,}/i.test(limpio)) return { nota: null, motivo: 'El mensaje lleva un enlace: sale por escrito para que se pueda tocar.' };
    try {
      return { nota: await generar(limpio, { vozId: cfg.vozId, modelo: cfg.modelo }), motivo: null };
    } catch (error) {
      return { nota: null, motivo: anotarError(error) };
    }
  }

  return {
    estado,
    recargar,

    async guardar(input) {
      const { clave: nuevaClave, ...resto } = input;
      const siguiente = configSchema.parse({ ...cfg, ...resto });
      await deps.settingsRepo.put(CLAVE_CONFIG, JSON.stringify(siguiente), false);
      cfg = siguiente;
      if (nuevaClave !== undefined) {
        if (nuevaClave === null || !nuevaClave.trim()) {
          await deps.settingsRepo.remove(CLAVE_API);
          clave = '';
          cuenta = null;
        } else {
          clave = nuevaClave.trim();
          await deps.settingsRepo.put(CLAVE_API, encrypt(clave, key), true);
          cuenta = null;
        }
      }
      ultimoError = null;
      return estado();
    },

    async probar(candidata) {
      const c = candidata?.trim() ? fabrica(candidata.trim()) : conCliente();
      if (!c) return { ok: false, detalle: 'Falta la clave de ElevenLabs: pégala y vuelve a probar.', cuenta: null };
      const r = await probarCon(c);
      if (r.ok && r.cuenta && !candidata?.trim()) cuenta = { ...r.cuenta, at: ahora().toISOString() };
      return r;
    },

    async voces() {
      const c = conCliente();
      if (!c) throw new ErrorVoz('Falta la clave de ElevenLabs: guárdala primero.', undefined, 'clave');
      return c.voces();
    },

    async muestra(o = {}) {
      const vozId = o.vozId?.trim() || cfg.vozId;
      if (!vozId) throw new ErrorVoz('Elige una voz primero.', undefined, 'voz');
      const texto = o.texto?.trim() || '¡Hola! Soy la voz de tu asistente. Así sonarán los audios que mande a tus clientes por WhatsApp.';
      return generar(texto.slice(0, 300), { vozId, modelo: o.modelo?.trim() || cfg.modelo });
    },

    disponible,

    contestarConAudio(entrante) {
      if (!disponible()) return false;
      if (cfg.cuando === 'siempre') return true;
      if (cfg.cuando === 'si-manda-audio') return entrante.esAudio;
      return false;
    },

    puedeTranscribir: () => Boolean(clave) && cfg.transcribir,

    notaDeVoz,
    transcribir,

    async transcribirGuardado(mediaId, mimeType) {
      if (!clave || !cfg.transcribir) return null;
      if (!/^[0-9a-f]{24}\.[a-z0-9]{1,5}$/.test(mediaId)) return null;
      let datos: Buffer;
      try {
        datos = await readFile(path.join(deps.mediaDir, mediaId));
      } catch {
        return null;
      }
      return transcribir(datos, mimeType);
    },

    async enviar(o) {
      const categoria = o.categoria ?? 'UTILITY';
      const { nota, motivo } = await notaDeVoz(o.texto);
      if (!nota) {
        const outcome = await deps.sender.send({ phone: o.phone, kind: 'freeform', category: categoria, text: o.texto, origen: o.origen, autorNombre: o.autorNombre, manual: o.manual });
        return { enviadoComo: 'texto', motivo, outcome };
      }
      const id = idDeMedia(`voz:${randomUUID()}`, extensionDe(nota.mimeType, 'audio'));
      await writeFile(path.join(deps.mediaDir, id), nota.datos);
      const outcome = await deps.sender.send({
        phone: o.phone,
        kind: 'media',
        category: categoria,
        origen: o.origen,
        autorNombre: o.autorNombre,
        manual: o.manual,
        media: { id, kind: 'audio', datos: nota.datos, mimeType: nota.mimeType, caption: o.texto.trim(), voz: true },
      });
      return { enviadoComo: 'audio', motivo: null, outcome };
    },
  };
}
