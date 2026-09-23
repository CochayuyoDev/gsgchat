/**
 * El que reparte los eventos a los sistemas suscritos.
 *
 * Dos mitades:
 *
 *  1. Escucha el bus y, por cada evento, deja una entrega pendiente por cada
 *     webhook activo que lo quiera. Encolar es una fila: si el otro sistema
 *     esta caido, no se pierde nada y no se frena a quien emitio.
 *  2. Cada pocos segundos toma lo pendiente y lo manda: POST con el cuerpo en
 *     JSON y la firma en `X-Firma`. Un 2xx cierra la entrega; un 5xx, un
 *     timeout o una caida la reintentan con espera creciente (1 min, 5, 30,
 *     2 h, 12 h) y a la sexta se da por perdida; un 4xx es que el otro lado
 *     la rechaza a proposito y no se insiste.
 *
 * Un webhook que lleva un dia entero sin una sola entrega buena se apaga
 * solo, con su motivo escrito, para no estar golpeando una URL muerta.
 * Se vuelve a activar desde el panel y lo fallido se puede reencolar.
 */

import type { Bus, NombreEvento } from '../eventos/bus.js';
import { firmar } from './firma.js';
import type { Entrega, WebhookConSecreto, WebhooksRepo } from './repo.js';

/**
 * Cuanto se espera antes de cada reintento, por numero de intento ya hecho.
 * El primero es corto: un receptor lento (un Stoky con `artisan serve`
 * procesando el mensaje anterior) no puede dejar el chat un minuto atras.
 */
export const ESPERAS_MS = [15_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 12 * 3600_000];
export const MAX_INTENTOS = ESPERAS_MS.length + 1;

/** Sin una entrega buena en este tiempo (y con fallos), el webhook se apaga. */
export const APAGAR_TRAS_MS = 24 * 3600_000;
const MIN_FALLOS_PARA_APAGAR = 5;

/** Se guarda solo el principio de lo que contesto: es para diagnosticar, no para archivar. */
const MAX_RESPUESTA = 500;

export interface DespachadorDeps {
  repo: WebhooksRepo;
  fetchImpl?: typeof fetch;
  ahora?: () => Date;
  timeoutMs?: number;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
  /** Version del sistema que va en la cabecera User-Agent. */
  version?: string;
}

export interface ResultadoEntrega {
  ok: boolean;
  codigo: number | null;
  respuesta: string | null;
  error?: string;
  /** true si tiene sentido volver a intentarlo mas tarde. */
  reintentable: boolean;
}

/** Lo que viaja en el cuerpo de cada entrega. */
export function cuerpoDeEntrega(entrega: Pick<Entrega, 'id' | 'evento' | 'payload' | 'createdAt' | 'intentos'>): string {
  return JSON.stringify({
    id: String(entrega.id),
    evento: entrega.evento,
    fecha: entrega.createdAt.toISOString(),
    intento: entrega.intentos + 1,
    datos: entrega.payload,
  });
}

/** Un POST firmado, y que paso. No toca la base: eso lo hace quien llama. */
export async function entregarUna(
  webhook: WebhookConSecreto,
  entrega: Pick<Entrega, 'id' | 'evento' | 'payload' | 'createdAt' | 'intentos'>,
  deps: Pick<DespachadorDeps, 'fetchImpl' | 'ahora' | 'timeoutMs' | 'version'>,
): Promise<ResultadoEntrega> {
  const doFetch = deps.fetchImpl ?? fetch;
  const ahora = deps.ahora?.() ?? new Date();
  const cuerpo = cuerpoDeEntrega(entrega);
  const control = new AbortController();
  // 40 s: un receptor que procesa el mensaje antes de contestar (Stoky baja
  // el adjunto, encola la IA) tarda mas de 15 s en una maquina lenta, y darlo
  // por caido solo retrasaba el chat.
  const corte = setTimeout(() => control.abort(), deps.timeoutMs ?? 40_000);
  try {
    const respuesta = await doFetch(webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': `GSGchat/${deps.version ?? '1'} (webhooks)`,
        'x-firma': firmar(webhook.secreto, cuerpo, Math.floor(ahora.getTime() / 1000)),
        'x-evento': entrega.evento,
        'x-entrega': String(entrega.id),
      },
      body: cuerpo,
      signal: control.signal,
    });
    const texto = (await respuesta.text().catch(() => '')).slice(0, MAX_RESPUESTA) || null;
    if (respuesta.ok) return { ok: true, codigo: respuesta.status, respuesta: texto, reintentable: false };
    // 408 y 429 son "ahora no": se vuelve. El resto de 4xx es un "no" que
    // insistir no cambia (URL mal, firma rechazada, cuerpo que no entiende).
    const reintentable = respuesta.status >= 500 || respuesta.status === 408 || respuesta.status === 429;
    return { ok: false, codigo: respuesta.status, respuesta: texto, error: `HTTP ${respuesta.status}`, reintentable };
  } catch (error) {
    const detalle = control.signal.aborted ? 'sin respuesta a tiempo' : error instanceof Error ? error.message : String(error);
    return { ok: false, codigo: null, respuesta: null, error: detalle, reintentable: true };
  } finally {
    clearTimeout(corte);
  }
}

export interface DespachoResumen {
  intentadas: number;
  enviadas: number;
  reintentar: number;
  fallidas: number;
  apagados: string[];
}

/** Una pasada por lo pendiente. La llama el ticker; tambien se puede llamar a mano. */
export async function despacharEntregas(deps: DespachadorDeps, limite = 25): Promise<DespachoResumen> {
  const { repo } = deps;
  const ahora = deps.ahora?.() ?? new Date();
  const pendientes = await repo.pendientes(ahora, limite);
  const resumen: DespachoResumen = { intentadas: pendientes.length, enviadas: 0, reintentar: 0, fallidas: 0, apagados: [] };
  // El mismo webhook suele tener varias entregas en la pasada: se lee una vez.
  const webhooks = new Map<string, WebhookConSecreto | null>();

  for (const entrega of pendientes) {
    if (!webhooks.has(entrega.webhookId)) webhooks.set(entrega.webhookId, await repo.conSecreto(entrega.webhookId));
    const webhook = webhooks.get(entrega.webhookId);
    if (!webhook || !webhook.activo) continue;

    const salida = await entregarUna(webhook, entrega, deps);
    const momento = deps.ahora?.() ?? new Date();

    if (salida.ok) {
      await repo.marcarEntrega(entrega.id, { estado: 'enviada', codigo: salida.codigo ?? 200, respuesta: salida.respuesta, at: momento });
      await repo.anotarResultado(webhook.id, true, momento);
      resumen.enviadas++;
      continue;
    }

    const intentosHechos = entrega.intentos + 1;
    if (salida.reintentable && intentosHechos < MAX_INTENTOS) {
      const espera = ESPERAS_MS[Math.min(intentosHechos - 1, ESPERAS_MS.length - 1)]!;
      await repo.marcarEntrega(entrega.id, {
        estado: 'pendiente',
        codigo: salida.codigo,
        respuesta: salida.respuesta,
        error: salida.error ?? 'fallo',
        proximoIntentoAt: new Date(momento.getTime() + espera),
      });
      resumen.reintentar++;
    } else {
      await repo.marcarEntrega(entrega.id, { estado: 'fallida', codigo: salida.codigo, respuesta: salida.respuesta, error: salida.error ?? 'fallo' });
      resumen.fallidas++;
    }

    const { fallosSeguidos, ultimoOkAt } = await repo.anotarResultado(webhook.id, false, momento);
    const desde = ultimoOkAt ?? webhook.createdAt;
    if (fallosSeguidos >= MIN_FALLOS_PARA_APAGAR && momento.getTime() - desde.getTime() >= APAGAR_TRAS_MS) {
      const motivo = `sin una entrega buena desde ${desde.toISOString()} (${fallosSeguidos} fallos seguidos; ultimo: ${salida.error ?? 'fallo'})`;
      await repo.pausar(webhook.id, motivo);
      webhooks.set(webhook.id, { ...webhook, activo: false });
      resumen.apagados.push(webhook.id);
      deps.log?.('webhook apagado por fallos', { webhook: webhook.id, url: webhook.url, motivo });
    }
  }

  return resumen;
}

/**
 * Conecta el bus con la cola: cada evento deja una entrega por suscriptor.
 * Devuelve la funcion que desconecta.
 */
/**
 * Si un evento es de algo del Modulo desarrollador (un cliente o motorizado
 * de prueba, un pedido PRUEBA-…). Esos no salen a los webhooks de verdad
 * (Stoky, GSG): lo de prueba no puede aparecer en otro sistema.
 */
export function esEventoDePrueba(payload: unknown): boolean {
  let texto = '';
  try {
    texto = JSON.stringify(payload ?? {});
  } catch {
    return false;
  }
  return /"(telefono|phone|to|from|wa_id)":"(?:\+?51)?900[01]\d{5}"/.test(texto) || /"referencia":"PRUEBA-/.test(texto);
}

export function encolarEventos(bus: Bus, repo: WebhooksRepo, log?: DespachadorDeps['log']): () => void {
  return bus.escucharTodo(async (evento: NombreEvento, payload) => {
    if (esEventoDePrueba(payload)) return;
    const suscritos = await repo.activosPara(evento);
    for (const w of suscritos) {
      try {
        await repo.encolar(w.id, evento, payload as Record<string, unknown>);
      } catch (error) {
        log?.('no se pudo encolar un webhook', { webhook: w.id, evento, detalle: error instanceof Error ? error.message : String(error) });
      }
    }
  });
}

/** Arranca el ticker de despacho. Devuelve la funcion que lo para. */
export function startDespachadorWebhooks(deps: DespachadorDeps, cadaMs = 10_000): () => void {
  let enCurso = false;
  const tick = async () => {
    if (enCurso) return;
    enCurso = true;
    try {
      await despacharEntregas(deps);
    } catch (error) {
      deps.log?.('fallo el despacho de webhooks', { detalle: error instanceof Error ? error.message : String(error) });
    } finally {
      enCurso = false;
    }
  };
  const timer = setInterval(() => void tick(), cadaMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
