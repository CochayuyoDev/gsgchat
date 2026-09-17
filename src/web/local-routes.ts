/**
 * Conexion local: el camino corto de /setup.
 *
 * Ni contenedor ni app de Meta. Se pulsa conectar, sale el QR (o un codigo de
 * ocho caracteres si se prefiere teclearlo) y ya esta. Es el equivalente de
 * `waha-routes.ts` para el proveedor que corre dentro de este proceso, y habla
 * el mismo vocabulario de estados para que la pantalla sirva para los dos.
 */

import type { ServicioAjustes } from '../ajustes/generales.js';
import type { ServicioStickers } from '../stickers/stickers.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { providerOf } from '../settings/service.js';
import type { Monitor } from '../salud/monitor.js';
import type { ServicioIA } from '../ia/servicio.js';
import type { ServicioEnvioAutomatico } from '../envio-automatico/servicio.js';
import type { Repos } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import type { SettingsService } from '../settings/service.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import { createSeenCache, processChange, type WebhookDeps } from '../whatsapp/webhook.js';
import type { StokyClient } from '../stoky/client.js';
import { leerMedia, mediaDirectory } from '../whatsapp/local/media.js';
import { readInbound } from '../handlers/inbound.js';
import {
  defaultAuthDir,
  getLocalState,
  hayVinculacion,
  logoutLocal,
  pedirHistorial,
  proximoHistorial,
  requestLocalPairingCode,
  startLocal,
  toJid,
} from '../whatsapp/local/session.js';

/** El progreso del trabajo de traer todo el historial (uno a la vez). */
interface ProgresoHistorial {
  enMarcha: boolean;
  empezoEn: string | null;
  terminoEn: string | null;
  chats: number;
  hechos: number;
  chatActual: string | null;
  mensajes: number;
  sinReferencia: number;
  detalle: string;
}
const progresoHistorial: ProgresoHistorial = { enMarcha: false, empezoEn: null, terminoEn: null, chats: 0, hechos: 0, chatActual: null, mensajes: 0, sinReferencia: 0, detalle: '' };
/** Tope por chat: 40 lotes de 50 = 2000 mensajes por vuelta. */
const LOTES_POR_CHAT = 40;

export interface LocalRoutesDeps {
  config: Config;
  catalogo?: StokyClient;
  repos: Repos;
  sender: Sender;
  wa: WhatsAppClient;
  settings: SettingsService;
  /** El monitor de salud: cuenta las desconexiones y para todo con un 403. */
  salud?: Monitor;
  /** El asistente de IA, para que los entrantes del socket lo usen igual. */
  ia?: ServicioIA;
  lista?: ServicioEnvioAutomatico;
  /**
   * Volver a abrir la sesion al arrancar si ya hay una vinculacion guardada.
   *
   * Sin esto, tras cada reinicio alguien tenia que entrar a /setup y pulsar
   * conectar; mientras tanto el motor de rutas y las secuencias intentaban
   * enviar contra un socket cerrado. Solo lo encienden los arranques reales
   * (dev y quick): en las pruebas el directorio de trabajo es el del proyecto
   * y ahi vive la vinculacion de verdad, que no se puede tocar.
   */
  autoConectar?: boolean;
  /** Los ajustes generales (modo prueba, nombre) cambiados desde la pantalla. */
  ajustes?: ServicioAjustes;
  stickers?: ServicioStickers;
}

/** El navegador necesita saber que es para decidir si lo pinta o lo baja. */
function tipoMime(id: string): string {
  const porExtension: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.3gp': 'video/3gpp',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.pdf': 'application/pdf',
  };
  const ext = id.slice(id.lastIndexOf('.'));
  return porExtension[ext] ?? 'application/octet-stream';
}

const codeSchema = z.object({
  phone: z.string().trim().min(6, 'hace falta el numero con codigo de pais'),
});

export async function registerLocalRoutes(
  app: FastifyInstance,
  deps: LocalRoutesDeps,
): Promise<void> {
  const { config, repos, sender, wa, settings, catalogo, salud } = deps;
  const authDir = defaultAuthDir();
  const mediaDir = mediaDirectory();

  // Si el proveedor es el local y hay vinculacion guardada, se reconecta
  // sola en cuanto el servidor este escuchando (por eso el onReady).
  if (deps.autoConectar) {
    app.addHook('onReady', async () => {
      if (providerOf(settings.current()) !== 'local') return;
      if (!hayVinculacion(authDir)) return;
      console.log('[wa] vinculacion guardada: reconectando la sesion local...');
      void arrancar().catch((error) => console.error('[wa] no se pudo reconectar la sesion local:', error));
    });
  }

  // Los entrantes van por el mismo sitio que los de Meta y los de WAHA: aqui
  // no hay webhook que firmar, pero si la misma deduplicacion por id.
  const webhookDeps: WebhookDeps = { repos, config, sender, wa, settings, catalogo, salud, ajustes: deps.ajustes, stickers: deps.stickers, ia: deps.ia, lista: deps.lista, seen: createSeenCache() };

  async function arrancar() {
    return startLocal({
      authDir,
      mediaDir,
      // console y no app.log a proposito: los arranques cortos corren con el
      // logger apagado, y con el se perdian justo las lineas que explican por
      // que un mensaje no aparece.
      log: (mensaje) => console.log(`[wa] ${mensaje}`),
      // Cada corte con su codigo: tres en una hora frenan; un 403 para todo.
      onDisconnect: (code, detail) => {
        void salud?.registrarDesconexion(code, detail).catch(() => undefined);
      },
      onChange: async (value) => {
        try {
          await processChange('messages', value, webhookDeps);
        } catch (error) {
          // Sin esto un entrante que revienta aguas abajo es indistinguible de
          // un entrante que no llego: el sintoma es el mismo, "no me llegan".
          console.error('[wa] fallo procesando un entrante:', error);
        }
      },
      // Los grupos del numero aparecen en el chat con su nombre desde que se
      // conecta, sin esperar a que alguien escriba en ellos.
      onGrupos: async (grupos) => {
        for (const g of grupos) {
          await repos.contacts.upsertGrupo(g.jid, g.nombre).catch((error: unknown) => console.error('[wa] no se pudo apuntar el grupo', g.jid, error));
        }
      },
      // Lo que se mando desde el telefono (en vivo o del historial) se guarda
      // como saliente: el hilo de aqui es el mismo que el del telefono.
      // Al vincular, en cuanto el telefono termina de mandar lo reciente de
      // todos los chats, se le pide lo anterior de cada uno, sin que nadie
      // tenga que pulsar nada.
      onSincronizacionInicial: async () => {
        if (progresoHistorial.enMarcha) return;
        console.log('[wa] arrancando la traida completa del historial tras vincular');
        // Un respiro: el telefono acaba de mandar miles de mensajes. Y la
        // conexion suele caerse y volver justo despues de vincular: se espera
        // a que este de verdad conectada (hasta 3 minutos), si no cada chat
        // se saltaba "sin conexion" y el trabajo acababa en cero.
        await new Promise((r) => setTimeout(r, 10_000));
        for (let i = 0; i < 36 && getLocalState().status !== 'WORKING'; i++) await new Promise((r) => setTimeout(r, 5_000));
        await traerTodoElHistorial();
      },
      onPropio: async ({ mensaje, status }) => {
        try {
          const contacto = mensaje.grupo
            ? await repos.contacts.upsertGrupo(mensaje.grupo.jid, mensaje.grupo.nombre ?? null)
            : await repos.contacts.upsertFromInbound(mensaje.from);
          const leido = readInbound(mensaje);
          await repos.messages.add({
            contactId: contacto.id,
            direction: 'out',
            wamid: mensaje.id,
            kind: leido.kind,
            body: leido.body,
            // El autor no va en lo propio: lo mande yo.
            payload: leido.payload && 'autor' in leido.payload ? (({ autor: _autor, ...resto }) => (Object.keys(resto).length ? resto : null))(leido.payload) : leido.payload,
            status,
            createdAt: new Date(Number(mensaje.timestamp) * 1000 || Date.now()),
          });
        } catch (error) {
          console.error('[wa] fallo guardando un mensaje propio:', error);
        }
      },
    });
  }

  /**
   * Deja la sesion abierta y devuelve el estado.
   *
   * Guarda `provider: 'local'` primero para que el resto del sistema deje de
   * pedir credenciales de Meta en cuanto se pulsa el boton: el modo local no
   * necesita ninguna.
   */
  app.post('/admin/local/connect', async () => {
    await settings.save({ provider: 'local' });
    await settings.reload();
    let estado = await arrancar();
    // La vinculacion guardada ya no valia (el telefono la habia cerrado): la
    // sesion la acaba de borrar y se ha quedado parada. Se vuelve a abrir en
    // el acto para que salga el QR, en vez de devolver un "parado" que
    // obligaba a pulsar dos veces sin saber por que.
    if (estado.status === 'STOPPED' && !hayVinculacion(authDir)) estado = await arrancar();
    return { ok: true, ...estado };
  });

  /**
   * Pide al telefono los mensajes anteriores de un chat.
   *
   * WhatsApp solo manda el historial reciente al vincular; lo de antes hay
   * que pedirlo chat por chat, anclado en el mensaje mas viejo que se tiene.
   * Lo que llega entra por el mismo camino que todo lo demas, asi que la
   * pantalla solo tiene que refrescar.
   */
  app.post('/admin/local/historial/:contactId', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const contacto = await repos.contacts.getById(contactId);
    if (!contacto) return reply.code(404).send({ error: 'contacto no encontrado' });
    if (getLocalState().status !== 'WORKING') {
      return reply.code(400).send({ error: 'WhatsApp no está conectado: conéctalo en Conexión de WhatsApp y vuelve a intentarlo.' });
    }
    const masViejo = await repos.messages.masAntiguo(contacto.id);
    try {
      // Sin ningun mensaje guardado no hay referencia: se le pide al telefono
      // desde "ahora", a ver si suelta los ultimos. Si no contesta, la
      // pantalla lo dice.
      const ancla = masViejo?.wamid
        ? { id: masViejo.wamid, fromMe: masViejo.direction === 'out', timestampMs: masViejo.createdAt.getTime() }
        : { id: '', fromMe: false, timestampMs: Date.now() };
      const peticion = await pedirHistorial(toJid(contacto.phone), ancla, 50);
      return { ok: true, peticion, desde: masViejo?.createdAt ?? null, sinReferencia: !masViejo?.wamid };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'no se pudo pedir el historial' });
    }
  });

  /**
   * Pide al telefono lo ULTIMO de un chat: los 20 mensajes anteriores al mas
   * reciente que se tiene aqui.
   *
   * Es el camino para lo que WhatsApp no le entrega a un dispositivo
   * vinculado (un "ver una vez"): el telefono si lo tiene, y por el historial
   * bajo demanda lo manda tal como lo guarda. Lo que ya estaba se ignora por
   * su id; lo que faltaba aparece.
   */
  app.post('/admin/local/sincronizar/:contactId', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const contacto = await repos.contacts.getById(contactId);
    if (!contacto) return reply.code(404).send({ error: 'contacto no encontrado' });
    if (getLocalState().status !== 'WORKING') {
      return reply.code(400).send({ error: 'WhatsApp no está conectado: conéctalo en Conexión de WhatsApp y vuelve a intentarlo.' });
    }
    // El mas reciente con id de WhatsApp: los del canal web o sin id no sirven de ancla.
    const recientes = await repos.messages.listMessages(contacto.id, 20);
    const ancla = [...recientes].reverse().find((m) => m.wamid && !m.wamid.startsWith('local:') && !m.wamid.startsWith('web:'));
    if (!ancla?.wamid) {
      return reply.code(400).send({ error: 'Este chat no tiene ningún mensaje de referencia todavía. Manda o recibe uno y vuelve a intentarlo.' });
    }
    try {
      const peticion = await pedirHistorial(
        toJid(contacto.phone),
        { id: ancla.wamid, fromMe: ancla.direction === 'out', timestampMs: ancla.createdAt.getTime() },
        20,
      );
      return { ok: true, peticion, hasta: ancla.createdAt };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'no se pudo pedir al telefono' });
    }
  });

  /**
   * Lo mismo, para todos los chats de una vez.
   *
   * Se piden espaciados (uno cada pocos segundos) para no aturdir al
   * telefono con ochenta peticiones de golpe; la respuesta devuelve cuantos
   * se van a pedir y el resto pasa en segundo plano. Los chats sin ningun
   * mensaje aqui no tienen referencia y se saltan.
   */
  app.post('/admin/local/historial-todos', async (_request, reply) => {
    if (getLocalState().status !== 'WORKING') {
      return reply.code(400).send({ error: 'WhatsApp no está conectado: conéctalo en Conexión de WhatsApp y vuelve a intentarlo.' });
    }
    if (progresoHistorial.enMarcha) return { ok: true, yaEnMarcha: true, ...progresoHistorial };
    await traerTodoElHistorial();
    return { ok: true, ...progresoHistorial };
  });

  /**
   * Trae todo el historial de todos los chats con referencia, chat por chat
   * y lote a lote, dejando el progreso en `progresoHistorial`.
   *
   * Lo lanza el boton de la pantalla y, solo, el final de la sincronizacion
   * inicial al vincular: asi con escanear el QR una vez entra todo.
   */
  async function traerTodoElHistorial(): Promise<void> {
    const chats = await repos.messages.listConversations({ limit: 500, offset: 0 });
    const conReferencia: Array<{ contactId: string; nombre: string; jid: string }> = [];
    for (const c of chats) {
      if (!(await repos.messages.masAntiguo(c.contactId))) continue;
      conReferencia.push({ contactId: c.contactId, nombre: c.name || c.phone, jid: toJid(c.phone) });
    }
    Object.assign(progresoHistorial, {
      enMarcha: true,
      empezoEn: new Date().toISOString(),
      terminoEn: null,
      chats: conReferencia.length,
      hechos: 0,
      chatActual: null,
      mensajes: 0,
      sinReferencia: chats.length - conReferencia.length,
      detalle: 'Empezando...',
    });

    // En segundo plano, chat por chat: se pide un lote, se espera a que el
    // telefono lo mande y se guarde, y se vuelve a pedir desde el mas
    // antiguo hasta que el telefono no tenga mas (o se llegue al tope).
    void (async () => {
      for (const chat of conReferencia) {
        progresoHistorial.chatActual = chat.nombre;
        for (let lote = 0; lote < LOTES_POR_CHAT; lote++) {
          // Un corte de conexion no cancela el trabajo: se espera a que vuelva
          // (hasta 2 minutos) y se sigue por donde iba.
          for (let i = 0; i < 24 && getLocalState().status !== 'WORKING'; i++) await new Promise((r) => setTimeout(r, 5_000));
          if (getLocalState().status !== 'WORKING') {
            progresoHistorial.detalle = `${chat.nombre}: sin conexión con WhatsApp; se sigue con el siguiente`;
            break;
          }
          const ancla = await repos.messages.masAntiguo(chat.contactId);
          if (!ancla?.wamid) break;
          try {
            const llegada = proximoHistorial(25_000);
            await pedirHistorial(chat.jid, { id: ancla.wamid, fromMe: ancla.direction === 'out', timestampMs: ancla.createdAt.getTime() }, 50);
            const n = await llegada;
            if (n === null) {
              progresoHistorial.detalle = `${chat.nombre}: el teléfono no contestó`;
              break;
            }
            progresoHistorial.mensajes += n;
            progresoHistorial.detalle = `${chat.nombre}: ${n} mensajes más`;
            // Si no hay nada mas atras, el ancla no se mueve.
            const nueva = await repos.messages.masAntiguo(chat.contactId);
            if (n < 5 || !nueva || nueva.wamid === ancla.wamid) break;
          } catch (error) {
            console.log(`[wa] no se pudo pedir el historial de ${chat.jid}: ${String(error)}`);
            break;
          }
          await new Promise((r) => setTimeout(r, 1200));
        }
        progresoHistorial.hechos += 1;
      }
      progresoHistorial.enMarcha = false;
      progresoHistorial.chatActual = null;
      progresoHistorial.terminoEn = new Date().toISOString();
      progresoHistorial.detalle = `Listo: ${progresoHistorial.mensajes} mensajes traídos de ${progresoHistorial.hechos} chats.`;
      console.log(`[wa] historial completo: ${progresoHistorial.mensajes} mensajes de ${progresoHistorial.hechos} chats`);
    })();
  }

  /** Como va el trabajo de traer todo el historial. */
  app.get('/admin/local/historial-todos', async () => progresoHistorial);

  /** Estado y, si toca escanear, el QR en base64. La pantalla lo sondea. */
  app.get('/admin/local/status', async () => {
    const estado = getLocalState();
    return {
      ok: true,
      configured: true,
      connected: estado.status === 'WORKING',
      ...estado,
    };
  });

  /** Vincular con el numero en vez de con la camara. */
  app.post('/admin/local/request-code', async (request, reply) => {
    const body = codeSchema.parse(request.body ?? {});
    try {
      // Pedir el codigo exige la sesion ya abierta: si el usuario llega aqui
      // sin haber pulsado conectar, se abre sola en vez de darle un error.
      if (getLocalState().status === 'STOPPED') {
        const estado = await arrancar();
        // Misma vuelta que en /connect: vinculacion muerta recien borrada.
        if (estado.status === 'STOPPED' && !hayVinculacion(authDir)) await arrancar();
      }
      const code = await requestLocalPairingCode(body.phone);
      return { ok: true, code };
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'no se pudo pedir el codigo' });
    }
  });

  /**
   * Sirve una foto, un audio o un documento que llego por el chat.
   *
   * Va detras del token como todo /admin, y el id se valida contra la forma
   * que genera el propio sistema, asi que no hay forma de pedir un fichero de
   * fuera de la carpeta.
   */
  app.get('/admin/local/media/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const datos = await leerMedia(mediaDir, id);
    if (!datos) return reply.code(404).send({ error: 'ese adjunto no existe' });

    return reply
      .type(tipoMime(id))
      // El contenido de un id nunca cambia -sale del wamid-, asi que se puede
      // cachear para siempre y no volver a pedirlo en cada scroll del chat.
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(datos);
  });

  /** Desvincula y borra las credenciales: obliga a escanear otra vez. */
  app.post('/admin/local/logout', async () => {
    await logoutLocal(authDir);
    return { ok: true };
  });
}
