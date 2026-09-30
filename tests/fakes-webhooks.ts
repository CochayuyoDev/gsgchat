/** Doble en memoria de los webhooks salientes y su cola de entregas. */

import type { Entrega, Webhook, WebhookConSecreto, WebhooksRepo } from '../src/webhooks/repo.js';
import { sinSecreto } from '../src/webhooks/repo.js';


export interface FakeWebhooks extends WebhooksRepo {
  _webhooks: WebhookConSecreto[];
  _entregas: Entrega[];
}

let seq = 1;

// Sin importar fakes.ts (que importa este fichero): la hora la pone quien llama
// o, si no, el reloj real.
const fakeNow = () => new Date();

export function createFakeWebhooks(): FakeWebhooks {
  const webhooks: WebhookConSecreto[] = [];
  const entregas: Entrega[] = [];
  const buscar = (id: string) => webhooks.find((w) => w.id === id) ?? null;

  return {
    _webhooks: webhooks,
    _entregas: entregas,

    async crear(input) {
      const w: WebhookConSecreto = {
        id: `wh-${seq++}`,
        url: input.url,
        descripcion: input.descripcion,
        secreto: input.secreto,
        eventos: input.eventos.length ? input.eventos : ['*'],
        activo: true,
        motivoPausa: null,
        creadoPor: input.creadoPor,
        createdAt: fakeNow(),
        ultimoOkAt: null,
        ultimoFalloAt: null,
        fallosSeguidos: 0,
      };
      webhooks.push(w);
      return sinSecreto(w);
    },
    async listar() {
      return [...webhooks].reverse().map(sinSecreto);
    },
    async obtener(id) {
      const w = buscar(id);
      return w ? sinSecreto(w) : null;
    },
    async conSecreto(id) {
      const w = buscar(id);
      return w ? { ...w } : null;
    },
    async activosPara(evento) {
      return webhooks.filter((w) => w.activo && (w.eventos.includes('*') || w.eventos.includes(evento))).map((w) => ({ ...w }));
    },
    async actualizar(id, patch) {
      const w = buscar(id);
      if (!w) return null;
      if (patch.url !== undefined) w.url = patch.url;
      if (patch.descripcion !== undefined) w.descripcion = patch.descripcion;
      if (patch.eventos !== undefined) w.eventos = patch.eventos;
      if (patch.activo !== undefined) {
        w.activo = patch.activo;
        if (patch.activo) {
          w.motivoPausa = null;
          w.fallosSeguidos = 0;
        }
      }
      return sinSecreto(w);
    },
    async rotarSecreto(id, secreto) {
      const w = buscar(id);
      if (!w) return false;
      w.secreto = secreto;
      return true;
    },
    async borrar(id) {
      const i = webhooks.findIndex((w) => w.id === id);
      if (i < 0) return false;
      webhooks.splice(i, 1);
      for (let j = entregas.length - 1; j >= 0; j--) if (entregas[j]!.webhookId === id) entregas.splice(j, 1);
      return true;
    },

    async encolar(webhookId, evento, payload, at) {
      const e: Entrega = {
        id: seq++,
        webhookId,
        evento,
        payload,
        estado: 'pendiente',
        intentos: 0,
        proximoIntentoAt: at ?? fakeNow(),
        respuestaCodigo: null,
        respuesta: null,
        error: null,
        createdAt: at ?? fakeNow(),
        enviadaAt: null,
      };
      entregas.push(e);
      return e.id;
    },
    async pendientes(ahora, limite) {
      return entregas
        .filter((e) => e.estado === 'pendiente' && e.proximoIntentoAt <= ahora && buscar(e.webhookId)?.activo)
        .sort((a, b) => a.proximoIntentoAt.getTime() - b.proximoIntentoAt.getTime() || a.id - b.id)
        .slice(0, limite)
        .map((e) => ({ ...e }));
    },
    async marcarEntrega(id, resultado) {
      const e = entregas.find((x) => x.id === id);
      if (!e) return;
      e.intentos += 1;
      e.respuestaCodigo = resultado.codigo;
      e.respuesta = resultado.respuesta;
      if (resultado.estado === 'enviada') {
        e.estado = 'enviada';
        e.error = null;
        e.enviadaAt = resultado.at;
      } else if (resultado.estado === 'pendiente') {
        e.error = resultado.error;
        e.proximoIntentoAt = resultado.proximoIntentoAt;
      } else {
        e.estado = 'fallida';
        e.error = resultado.error;
      }
    },
    async anotarResultado(webhookId, ok, at) {
      const w = buscar(webhookId);
      if (!w) return { fallosSeguidos: 0, ultimoOkAt: null };
      if (ok) {
        w.ultimoOkAt = at;
        w.fallosSeguidos = 0;
      } else {
        w.ultimoFalloAt = at;
        w.fallosSeguidos += 1;
      }
      return { fallosSeguidos: w.fallosSeguidos, ultimoOkAt: w.ultimoOkAt };
    },
    async pausar(webhookId, motivo) {
      const w = buscar(webhookId);
      if (w) {
        w.activo = false;
        w.motivoPausa = motivo;
      }
    },
    async entregas(webhookId, limite) {
      return entregas
        .filter((e) => e.webhookId === webhookId)
        .sort((a, b) => b.id - a.id)
        .slice(0, limite)
        .map((e) => ({ ...e }));
    },
    async reencolarFallidas(webhookId, at) {
      let n = 0;
      for (const e of entregas) {
        if (e.webhookId !== webhookId || e.estado !== 'fallida') continue;
        e.estado = 'pendiente';
        e.proximoIntentoAt = at;
        e.error = null;
        n++;
      }
      return n;
    },
    async contarPendientes() {
      return entregas.filter((e) => e.estado === 'pendiente').length;
    },
  };
}

export type { Webhook };
