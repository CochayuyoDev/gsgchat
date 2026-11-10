/**
 * Lo que el equipo hace con los pedidos de privacidad de los clientes.
 *
 *   GET  /admin/privacidad           las solicitudes pendientes (BAJA y borrar datos)
 *   POST /admin/privacidad/descartar una persona vio que no era eso: se cierra y el bot vuelve
 *   POST /admin/privacidad/borrar    elimina TODOS los datos del cliente (solo administrador)
 *
 * La baja se da con POST /admin/contacts/opt-out (el boton «Dar de baja» de
 * Chats), que ademas cierra la solicitud. Nada de esto lo hace el sistema solo.
 */

import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizePhone, type Repos } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import { idDeMedia } from '../whatsapp/local/media.js';
import { NOMBRE_PRIVACIDAD } from '../privacidad/detectar.js';

export interface PrivacidadDeps {
  repos: Repos;
  mediaDir?: string;
  /** Para avisarle al cliente, antes de borrar, que sus datos se eliminan. */
  sender?: Pick<Sender, 'send'>;
}

/** Cuanto se espera al aviso antes de borrar igual. */
const ESPERA_AVISO_MS = 10_000;

/** Lo ultimo que se le escribe: sale antes de borrar y se borra junto con lo demas. */
export const AVISO_DATOS_BORRADOS = 'Listo: eliminamos tus datos de nuestro sistema, como pediste. Si más adelante tienes otro pedido, empezaremos de cero.';

const phoneSchema = z.string().trim().min(6).max(40);

/** Los adjuntos (fotos, audios, videos) de esos mensajes: se guardan con el wamid en el nombre. */
async function borrarAdjuntos(dir: string | undefined, wamids: string[]): Promise<number> {
  if (!dir || !wamids.length) return 0;
  const prefijos = new Set(wamids.map((w) => idDeMedia(w, '')));
  let ficheros: string[];
  try {
    ficheros = await readdir(dir);
  } catch {
    return 0;
  }
  let n = 0;
  for (const f of ficheros) {
    if (!prefijos.has(f.slice(0, 24))) continue;
    await unlink(path.join(dir, f)).then(() => n++).catch(() => undefined);
  }
  return n;
}

export async function registerPrivacidadRoutes(app: FastifyInstance, deps: PrivacidadDeps): Promise<void> {
  const { repos } = deps;
  const quien = (request: { usuario?: { nombre?: string | null; usuario?: string | null } | null }): string | null =>
    request.usuario?.nombre || request.usuario?.usuario || null;
  const sinTabla = { error: 'Esta instalación todavía no tiene la tabla de solicitudes de privacidad: reinicia el sistema para que se cree.' };

  app.get('/admin/privacidad', async (_request, reply) => {
    if (!repos.privacidad) return reply.code(503).send(sinTabla);
    const pendientes = await repos.privacidad.pendientes(200);
    const contactos = await Promise.all(pendientes.map((s) => repos.contacts.getByPhone(s.phone).catch(() => null)));
    return {
      pendientes: pendientes.map((s, i) => ({
        id: s.id,
        phone: s.phone,
        nombre: contactos[i]?.name ?? null,
        contactId: contactos[i]?.id ?? s.contactId,
        tipo: s.tipo,
        tipoTexto: NOMBRE_PRIVACIDAD[s.tipo],
        texto: s.texto,
        como: s.como,
        dadoDeBaja: Boolean(contactos[i]?.optOutAt),
        createdAt: s.createdAt,
      })),
      total: pendientes.length,
    };
  });

  app.post('/admin/privacidad/descartar', async (request, reply) => {
    if (!repos.privacidad) return reply.code(503).send(sinTabla);
    const body = z.object({ phone: phoneSchema, reanudarBot: z.boolean().default(true) }).parse(request.body ?? {});
    const phone = normalizePhone(body.phone);
    const cerradas = await repos.privacidad.atender(phone, 'descartada', quien(request));
    if (body.reanudarBot) {
      const c = await repos.contacts.getByPhone(phone).catch(() => null);
      if (c) await repos.contacts.pausarBot(c.id, false, new Date()).catch(() => undefined);
    }
    return { ok: true, cerradas };
  });

  app.post('/admin/privacidad/borrar', async (request, reply) => {
    if (!repos.privacidad) return reply.code(503).send(sinTabla);
    if (request.usuario && (request.usuario.rol !== 'admin' || request.usuario.porToken)) {
      return reply.code(403).send({ error: 'Solo un administrador elimina los datos de un cliente.' });
    }
    // Se escribe el numero otra vez para confirmar: no hay vuelta atras.
    const body = z.object({ phone: phoneSchema, confirmar: z.string().trim().min(1), avisar: z.boolean().default(false) }).parse(request.body ?? {});
    const phone = normalizePhone(body.phone);
    if (normalizePhone(body.confirmar).slice(-9) !== phone.slice(-9)) {
      return reply.code(400).send({ error: 'Para confirmar, escribe el mismo número del cliente.' });
    }
    // El aviso sale primero (despues ya no hay chat al que escribir) y se borra con todo lo demas.
    let avisado = false;
    if (body.avisar && deps.sender) {
      // Con el WhatsApp caido el envio puede quedarse esperando: a los 10 s se borra igual (sin aviso).
      const r = await Promise.race([
        deps.sender.send({ phone, kind: 'freeform', category: 'UTILITY', manual: true, textoFijo: true, text: AVISO_DATOS_BORRADOS }).catch(() => null),
        new Promise<null>((resolver) => setTimeout(() => resolver(null), ESPERA_AVISO_MS)),
      ]);
      avisado = Boolean(r && r.ok);
    }
    const r = await repos.privacidad.borrarDatosDelCliente(phone, quien(request));
    // La bitacora anota la accion sola, con el numero oculto (src/auth/actividad.ts).
    const adjuntos = await borrarAdjuntos(deps.mediaDir, r.wamids);
    return {
      ok: true,
      contacto: r.contacto,
      mensajes: r.mensajes,
      pedidos: r.pedidos,
      solicitudesUbicacion: r.solicitudesUbicacion,
      otros: r.otros,
      adjuntos,
      avisado,
    };
  });
}
