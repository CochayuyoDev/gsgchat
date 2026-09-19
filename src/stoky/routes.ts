/**
 * Conectar Stoky y este WhatsApp desde la pantalla (Conectar mi web y tienda → Stoky).
 *
 * La vinculación tiene dos direcciones y la pantalla enseña las dos:
 *
 *  1. Stoky → este WhatsApp. Stoky escribe, lee el chat, ve el QR y da
 *     órdenes a la IA por la API de aquí, con una clave `wak_…`. Se crea con
 *     un botón ("Crear la clave para Stoky") y se pega en Stoky, en su
 *     pantalla de WhatsApp. Si Stoky ya se vinculó, aquí se ve: la clave con
 *     uso, el aviso (webhook) hacia Stoky y su última entrega.
 *  2. Este WhatsApp → Stoky. El asistente consulta precios y stock y manda a
 *     registrar la venta en el panel de Stoky. Hace falta la dirección de la
 *     API de Stoky y un token `stk_…` (Stoky → Integraciones → Conexiones de
 *     tienda). Se pega aquí y se prueba; o lo manda Stoky solo al vincularse,
 *     por `POST /api/v1/stoky/conexion`.
 *
 *  GET    /admin/integraciones/stoky           todo lo de arriba, en un JSON para la pantalla
 *  POST   /admin/integraciones/stoky           guardar dirección, panel y token (admin)
 *  DELETE /admin/integraciones/stoky           quitar la conexión (admin)
 *  POST   /admin/integraciones/stoky/probar    llamar a Stoky con lo guardado o con lo que hay en pantalla
 *  POST   /admin/integraciones/stoky/clave     la clave `wak_` para Stoky, con todos los permisos (admin)
 *
 *  GET    /api/v1/stoky/conexion               (permiso stoky:conectar) cómo está la conexión, sin el token
 *  POST   /api/v1/stoky/conexion               (permiso stoky:conectar) Stoky manda su dirección y su token
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Repos } from '../db/repos.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from '../auth/claves-api.js';
import type { ServicioConexionStoky } from './conexion.js';

export interface StokyRoutesDeps {
  conexion: ServicioConexionStoky;
  repos: Pick<Repos, 'claves' | 'webhooks'>;
  config: Pick<Config, 'PUBLIC_BASE_URL'>;
  /** Cuanto se espera a Stoky cuando el se presenta (por defecto 4 s) y cuando se reintenta por detras (6 s). Para pruebas. */
  esperaPruebaMs?: number;
  reintentoPruebaMs?: number;
}

/** El nombre con el que se crean las claves para Stoky: así la pantalla las reconoce. */
export const NOMBRE_CLAVE_STOKY = 'Stoky';

const guardarSchema = z.object({
  url: z.string().trim().min(1).max(300),
  panelUrl: z.string().trim().max(300).optional(),
  /** Vacío = conservar el que hay. */
  token: z.string().trim().max(500).optional(),
});

function soloAdmin(request: FastifyRequest, reply: FastifyReply, que: string): boolean {
  if (request.usuario?.rol === 'admin' && !request.usuario.porToken) return true;
  void reply.code(403).send({ error: `Solo un administrador puede ${que}.` });
  return false;
}

/** Un webhook que apunta a Stoky: el que crea Stoky al vincularse. */
const esWebhookDeStoky = (w: { url: string; descripcion: string }) => /\/webhooks\/wa-locator\//i.test(w.url) || /stoky/i.test(w.descripcion);

export async function registerStokyRoutes(app: FastifyInstance, deps: StokyRoutesDeps): Promise<void> {
  const { conexion, repos } = deps;
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/+$/, '');

  /** Lo que Stoky hizo de este lado: su clave y su aviso. */
  async function ladoDeStoky() {
    const claves = (await repos.claves.listar()).filter((c) => !c.revocadaAt && new RegExp(NOMBRE_CLAVE_STOKY, 'i').test(c.nombre));
    // Si Stoky se vinculo varias veces hay varios avisos: manda el mas nuevo
    // que este activo (cada Conectar da de alta uno con URL nueva).
    const webhooks = (await repos.webhooks.listar())
      .filter(esWebhookDeStoky)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const conUso = claves.filter((c) => c.ultimoUsoAt);
    const clave = [...conUso, ...claves.filter((c) => !c.ultimoUsoAt)][0] ?? null;
    const webhook = webhooks.find((w) => w.activo) ?? webhooks[0] ?? null;
    return {
      claves: claves.map((c) => ({ id: c.id, nombre: c.nombre, prefijo: c.prefijo, permisos: c.permisos, createdAt: c.createdAt, ultimoUsoAt: c.ultimoUsoAt })),
      claveUsada: Boolean(clave?.ultimoUsoAt),
      ultimoUsoClaveAt: clave?.ultimoUsoAt ?? null,
      webhook: webhook ? { id: webhook.id, url: webhook.url, activo: webhook.activo, motivoPausa: webhook.motivoPausa, ultimoOkAt: webhook.ultimoOkAt, ultimoFalloAt: webhook.ultimoFalloAt, fallosSeguidos: webhook.fallosSeguidos } : null,
      /** Stoky recibe los mensajes: hay aviso activo y alguna entrega buena. */
      recibeMensajes: Boolean(webhook && webhook.activo && webhook.ultimoOkAt),
    };
  }

  const resumen = async () => ({
    // Lo que hay que pegar en Stoky para que hable con este sistema.
    miDireccion: base,
    haciaAqui: await ladoDeStoky(),
    // Lo que este sistema sabe de Stoky.
    haciaStoky: conexion.estado(),
  });

  app.get('/admin/integraciones/stoky', async () => resumen());

  app.post('/admin/integraciones/stoky', async (request, reply) => {
    if (!soloAdmin(request, reply, 'cambiar la conexión con Stoky')) return;
    const body = guardarSchema.parse(request.body ?? {});
    try {
      await conexion.guardar({ url: body.url, panelUrl: body.panelUrl, token: body.token || undefined, origenAlta: 'pantalla' });
      const prueba = await conexion.probar();
      return { ok: true, prueba, ...(await resumen()), mensaje: prueba.ok ? `Conectado con Stoky${prueba.tienda ? ` (${prueba.tienda})` : ''}: ${prueba.productos ?? 0} productos en el catálogo.` : `Guardado, pero Stoky no respondió: ${prueba.detalle ?? ''}` };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/admin/integraciones/stoky', async (request, reply) => {
    if (!soloAdmin(request, reply, 'quitar la conexión con Stoky')) return;
    await conexion.quitar();
    return { ok: true, ...(await resumen()) };
  });

  app.post('/admin/integraciones/stoky/probar', async (request) => {
    const body = z.object({ url: z.string().trim().max(300).optional(), token: z.string().trim().max(500).optional() }).parse(request.body ?? {});
    // Con URL y token en pantalla se prueba eso, sin guardar; si no, lo guardado.
    const prueba = body.url && body.token ? await conexion.probar({ url: body.url, token: body.token }) : await conexion.probar();
    return { ...prueba, haciaStoky: conexion.estado() };
  });

  /**
   * La clave para Stoky, de un botón. Con TODOS los permisos: Stoky necesita
   * el QR (`/admin/local/status`), el chat, los avisos y la IA operadora, y
   * su cliente rechaza una clave recortada. Las claves "Stoky" anteriores se
   * revocan: la nueva sustituye a la vieja y no quedan copias sueltas.
   */
  app.post('/admin/integraciones/stoky/clave', async (request, reply) => {
    if (!soloAdmin(request, reply, 'crear la clave para Stoky')) return;
    const anteriores = (await repos.claves.listar()).filter((c) => !c.revocadaAt && new RegExp(`^${NOMBRE_CLAVE_STOKY}$`, 'i').test(c.nombre.trim()));
    for (const c of anteriores) await repos.claves.revocar(c.id);
    const clave = generarClaveApi();
    const registro = await repos.claves.crear({ nombre: NOMBRE_CLAVE_STOKY, prefijo: prefijoDeClave(clave), hash: hashClaveApi(clave), creadaPor: request.usuario?.id ?? null, permisos: ['*'] });
    return { ok: true, clave, registro, miDireccion: base, revocadas: anteriores.length, pasos: ['En Stoky, entra en CRM → WhatsApp → Conectar → «Mi sistema de WhatsApp».', `Pega la dirección de este sistema: ${base}`, 'Pega esta clave y pulsa Conectar. Stoky comprobará la clave, dará de alta el aviso para recibir los mensajes y te enseñará el QR si el número aún no está vinculado.'] };
  });

  // ---------------------------------------------------------------- API v1

  app.get('/api/v1/stoky/conexion', { config: { permiso: 'stoky:conectar' } }, async () => {
    const e = conexion.estado();
    return { configurada: e.configurada, url: e.url, panelUrl: e.panelUrl, origen: e.origen, tienda: e.tienda, almacen: e.almacen, ultimaPrueba: e.ultimaPrueba };
  });

  /**
   * Stoky se presenta: "esta es mi API, este es el token con el que puedes
   * consultar mi catálogo, este es mi panel". Es lo que hace que vincular sea
   * un solo botón del lado de Stoky. Se guarda y se prueba en el acto.
   */
  app.post('/api/v1/stoky/conexion', { config: { permiso: 'stoky:conectar' } }, async (request, reply) => {
    const body = z.object({ url: z.string().trim().min(1).max(300), token: z.string().trim().min(8).max(500), panelUrl: z.string().trim().max(300).optional() }).parse(request.body ?? {});
    try {
      await conexion.guardar({ url: body.url, token: body.token, panelUrl: body.panelUrl, origenAlta: 'stoky' });
      // Stoky llama aqui DESDE su propia peticion de "Conectar". Si su
      // servidor atiende una peticion a la vez (`artisan serve`), preguntarle
      // ahora por su catalogo se queda esperando a que esa peticion acabe: se
      // le dan unos segundos y, si no llega, se contesta "guardado, se
      // comprueba en un momento" y la prueba sigue sola por detras. El
      // semaforo de Conectar mi web y tienda ensena el resultado.
      const prueba = await Promise.race([conexion.probar(), new Promise<null>((r) => setTimeout(() => r(null), deps.esperaPruebaMs ?? 4000))]);
      if (!prueba) {
        setTimeout(() => void conexion.probar().catch(() => undefined), deps.reintentoPruebaMs ?? 6000);
        return { ok: true, configurada: conexion.estado().configurada, prueba: { ok: false, pendiente: true, detalle: 'Guardado. El catálogo se comprueba en unos segundos; el resultado se ve en Conectar mi web y tienda → Stoky.' } };
      }
      return { ok: prueba.ok, prueba, configurada: conexion.estado().configurada };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
