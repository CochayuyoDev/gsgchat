/**
 * El webhook de WhatsApp Business API (Cloud API de Meta), configurable desde
 * «Nuestra API».
 *
 * Meta llama a `GET/POST /webhooks/whatsapp` (ver webhook.ts): el GET es el
 * apreton de manos con el verify token y cada POST viene firmado con el app
 * secret de la app de Meta. Quien lo configura en Meta (GSG) necesita la URL,
 * el verify token y saber si Meta ya verifico y si estan llegando avisos.
 *
 * Por que un verify token y un app secret PROPIOS y no los de /setup: con WAHA
 * el campo `verifyToken` de /setup es la clave con la que WAHA firma su
 * webhook. Cambiarlo desde aqui cortaria WAHA en produccion. Los de /setup se
 * siguen aceptando (ver `secretosDeMeta` en webhook.ts).
 *
 * Lo que se ve en la pantalla (verificado, ultimo aviso, ultimos eventos) se
 * guarda: el ultimo apreton de manos y el ultimo aviso en la base (sobreviven
 * a un reinicio); la lista de eventos, en memoria (los ultimos 50).
 */

import { randomBytes } from 'node:crypto';
import type { SettingsRepo } from '../settings/service.js';
import { decrypt, encrypt, keyFromBase64 } from '../settings/crypto.js';

/** No empiezan por `whatsapp.`: esas claves las lee el servicio de ajustes como credenciales. */
const CLAVE_VERIFY = 'metawebhook.verify_token';
const CLAVE_SECRET = 'metawebhook.app_secret';
const CLAVE_ESTADO = 'metawebhook.estado';

/** Los campos que hay que suscribir en Meta (los que GSGchat usa). */
export const CAMPOS_WEBHOOK_META = [
  { campo: 'messages', para: 'Mensajes que entran y estados de entrega (enviado, entregado, leído, fallido).', obligatorio: true },
  { campo: 'message_template_status_update', para: 'Aprobación, rechazo o pausa de las plantillas.', obligatorio: true },
  { campo: 'phone_number_quality_update', para: 'Calidad del número y cambios de límite.', obligatorio: true },
  { campo: 'account_update', para: 'Restricciones o bloqueo de la cuenta (recomendado).', obligatorio: false },
  { campo: 'message_template_quality_update', para: 'Calidad de cada plantilla (recomendado).', obligatorio: false },
] as const;

export type ResultadoEvento =
  | 'verificado'          // GET de Meta con el verify token correcto
  | 'verificacion_fallida' // GET con un token que no es
  | 'recibido'            // POST con firma valida
  | 'firma_invalida'      // POST con firma que no cuadra
  | 'sin_secreto';        // POST sin ningun app secret guardado

export interface EventoWebhook {
  en: string;
  resultado: ResultadoEvento;
  /** Campos del aviso (messages, statuses...) o el detalle del rechazo. */
  detalle: string;
  /** Si lo mando la prueba de la pantalla. */
  prueba?: boolean;
}

interface EstadoGuardado {
  verificadoEn?: string;
  ultimoAvisoEn?: string;
  ultimoAvisoCampos?: string;
  ultimoRechazoEn?: string;
  ultimoRechazo?: string;
}

export interface ConfigWebhookMeta {
  /** Verify token propio de este webhook ('' = sin poner). */
  verifyToken: string;
  /** App secret propio de este webhook ('' = sin poner). */
  appSecret: string;
}

export interface ServicioWebhookMeta {
  config(): ConfigWebhookMeta;
  /** Guarda lo que venga; un campo vacio se conserva, `null` lo borra. */
  guardar(cambios: { verifyToken?: string | null; appSecret?: string | null }): Promise<ConfigWebhookMeta>;
  /** Un verify token nuevo, largo y sin caracteres raros (no se guarda solo). */
  generarVerifyToken(): string;
  anotar(evento: Omit<EventoWebhook, 'en'>): void;
  eventos(): EventoWebhook[];
  estado(): EstadoGuardado;
}

/** Un token facil de copiar: letras y numeros, 40 caracteres. */
export function nuevoVerifyToken(): string {
  return `gsg_${randomBytes(27).toString('base64url').replace(/[-_]/g, '').slice(0, 36)}`;
}

export async function crearServicioWebhookMeta(repo: SettingsRepo, settingsKeyBase64: string): Promise<ServicioWebhookMeta> {
  const key = keyFromBase64(settingsKeyBase64);
  const filas = new Map((await repo.getAll().catch(() => [])).map((f) => [f.key, f]));
  const leer = (clave: string): string => {
    const f = filas.get(clave);
    if (!f) return '';
    try {
      return f.encrypted ? decrypt(f.value, key) : f.value;
    } catch {
      return '';
    }
  };
  let actual: ConfigWebhookMeta = { verifyToken: leer(CLAVE_VERIFY), appSecret: leer(CLAVE_SECRET) };
  let estado: EstadoGuardado = (() => {
    try {
      return JSON.parse(leer(CLAVE_ESTADO) || '{}') as EstadoGuardado;
    } catch {
      return {};
    }
  })();
  const recientes: EventoWebhook[] = [];
  // El ultimo aviso se guarda como mucho una vez por minuto: Meta puede mandar muchos seguidos.
  let guardadoEn = 0;
  const guardarEstado = (forzar: boolean) => {
    if (!forzar && Date.now() - guardadoEn < 60_000) return;
    guardadoEn = Date.now();
    void repo.put(CLAVE_ESTADO, JSON.stringify(estado), false).catch(() => undefined);
  };

  return {
    config: () => ({ ...actual }),

    async guardar(cambios) {
      const siguiente = { ...actual };
      for (const campo of ['verifyToken', 'appSecret'] as const) {
        const v = cambios[campo];
        if (v === undefined) continue;
        const clave = campo === 'verifyToken' ? CLAVE_VERIFY : CLAVE_SECRET;
        if (v === null) {
          await repo.remove(clave);
          siguiente[campo] = '';
          continue;
        }
        const limpio = v.trim();
        if (!limpio) continue;
        await repo.put(clave, encrypt(limpio, key), true);
        siguiente[campo] = limpio;
      }
      // Con otro verify token, Meta tiene que volver a verificar.
      if (siguiente.verifyToken !== actual.verifyToken && estado.verificadoEn) {
        estado = { ...estado, verificadoEn: undefined };
        guardarEstado(true);
      }
      actual = siguiente;
      return { ...actual };
    },

    generarVerifyToken: nuevoVerifyToken,

    anotar(evento) {
      const completo: EventoWebhook = { ...evento, en: new Date().toISOString() };
      recientes.unshift(completo);
      recientes.length = Math.min(recientes.length, 50);
      if (evento.prueba) return;
      if (evento.resultado === 'verificado') {
        estado = { ...estado, verificadoEn: completo.en };
        guardarEstado(true);
      } else if (evento.resultado === 'recibido') {
        estado = { ...estado, ultimoAvisoEn: completo.en, ultimoAvisoCampos: evento.detalle };
        guardarEstado(false);
      } else {
        estado = { ...estado, ultimoRechazoEn: completo.en, ultimoRechazo: evento.detalle };
        guardarEstado(true);
      }
    },

    eventos: () => recientes.map((e) => ({ ...e })),
    estado: () => ({ ...estado }),
  };
}

/** Los campos de un aviso de Meta, para la bitacora: «messages (2 mensajes, 1 estado)». */
export function resumenDelAviso(payload: unknown): string {
  const p = payload as { entry?: Array<{ changes?: Array<{ field?: string; value?: { messages?: unknown[]; statuses?: unknown[] } }> }> };
  const partes: string[] = [];
  for (const entry of p?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const m = change.value?.messages?.length ?? 0;
      const s = change.value?.statuses?.length ?? 0;
      const extra = [m && `${m} mensaje${m === 1 ? '' : 's'}`, s && `${s} estado${s === 1 ? '' : 's'}`].filter(Boolean).join(', ');
      partes.push(`${change.field ?? 'sin campo'}${extra ? ` (${extra})` : ''}`);
    }
  }
  return partes.join(' · ') || 'aviso vacío';
}
