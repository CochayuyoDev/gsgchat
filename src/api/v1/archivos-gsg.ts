/**
 * Los archivos del chat (fotos, videos, audios, documentos) para GSG.
 *
 * GSG ve el chat con el historial que ya pide (`GET /api/v1/historial`). Cada
 * mensaje con un archivo trae `archivo.url`: un enlace firmado que abre el
 * fichero tal cual, sin clave de API ni sesion, para que GSG lo ponga directo
 * en un <img>, un <video> o un <audio>. Como los enlaces de evidencia (ver
 * src/archive/enlace.ts): dentro del token va el mensaje y hasta cuando vale;
 * no se guarda nada en la base porque la firma ya dice si el enlace es nuestro.
 * Caduca a los 7 dias: GSG pide el historial cada vez que abre el chat y
 * recibe enlaces nuevos.
 *
 * El fichero sale del disco (lo que llega por QR ya se guarda al recibirlo).
 * Con la API oficial de Meta el mensaje solo trae el id de Meta: la primera
 * vez que se pide se baja de Meta y se deja en el disco.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Repos } from '../../db/repos.js';
import type { Message } from '../../db/messages.js';
import type { WhatsAppClient } from '../../whatsapp/client.js';
import { extensionDe, idDeMedia, leerMedia, mediaDirectory } from '../../whatsapp/local/media.js';

/** Lo que vale un enlace: GSG recibe uno nuevo cada vez que pide el historial. */
export const DIAS_ENLACE_ARCHIVO = 7;

export interface ArchivoPayload {
  /** El contacto del chat. */
  c: string;
  /** El id del mensaje (su `cursor` en el historial). */
  m: number;
  /** Epoch en segundos. */
  exp: number;
}

/** Lo que viaja en cada mensaje del historial que lleva un archivo. */
export interface ArchivoDeMensaje {
  url: string;
  tipo: 'imagen' | 'video' | 'audio' | 'documento' | 'sticker';
  mimeType: string;
  nombre: string | null;
  /** Lo que dura un audio o un video. */
  segundos: number | null;
  bytes: number | null;
  /** Un audio grabado como nota de voz. */
  voz: boolean;
  /** Llego como «ver una vez»: en el telefono desaparece, aqui queda. */
  verUnaVez: boolean;
  caducaEn: string;
}

interface MediaGuardada {
  id?: unknown;
  mimeType?: unknown;
  filename?: unknown;
  seconds?: unknown;
  voice?: unknown;
  voz?: unknown;
  bytes?: unknown;
  verUnaVez?: unknown;
}

const TIPOS: Record<string, ArchivoDeMensaje['tipo']> = { image: 'imagen', video: 'video', audio: 'audio', document: 'documento', sticker: 'sticker' };

const firma = (cuerpo: string, secreto: string) => createHmac('sha256', `archivo-chat:${secreto}`).update(cuerpo).digest('base64url');

export function firmarArchivo(payload: ArchivoPayload, secreto: string): string {
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${cuerpo}.${firma(cuerpo, secreto)}`;
}

export function verificarArchivo(token: string, secreto: string, ahora: Date = new Date()): { ok: true; payload: ArchivoPayload } | { ok: false; motivo: 'caducado' | 'no_valido' } {
  const partes = token.split('.');
  if (partes.length !== 2) return { ok: false, motivo: 'no_valido' };
  const [cuerpo, recibida] = partes as [string, string];
  const esperada = Buffer.from(firma(cuerpo, secreto));
  const dada = Buffer.from(recibida);
  if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return { ok: false, motivo: 'no_valido' };
  let payload: ArchivoPayload;
  try {
    payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as ArchivoPayload;
  } catch {
    return { ok: false, motivo: 'no_valido' };
  }
  if (!payload || typeof payload.c !== 'string' || !Number.isInteger(payload.m) || typeof payload.exp !== 'number') return { ok: false, motivo: 'no_valido' };
  if (payload.exp * 1000 <= ahora.getTime()) return { ok: false, motivo: 'caducado' };
  return { ok: true, payload };
}

const mediaDe = (m: Pick<Message, 'payload'>): MediaGuardada | null => {
  const media = (m.payload as { media?: unknown } | null)?.media;
  return media && typeof media === 'object' && typeof (media as MediaGuardada).id === 'string' ? (media as MediaGuardada) : null;
};

/**
 * El `archivo` de un mensaje del historial, o null si no lleva ninguno. El
 * enlace va con la direccion publica de la tienda (con su prefijo).
 */
export function archivoDeMensaje(m: Message, opts: { publicBase: string; secreto: string; ahora?: Date }): ArchivoDeMensaje | null {
  const media = mediaDe(m);
  const tipo = TIPOS[m.kind];
  if (!media || !tipo) return null;
  const ahora = opts.ahora ?? new Date();
  const caduca = new Date(ahora.getTime() + DIAS_ENLACE_ARCHIVO * 24 * 60 * 60 * 1000);
  const token = firmarArchivo({ c: m.contactId, m: m.id, exp: Math.floor(caduca.getTime() / 1000) }, opts.secreto);
  return {
    url: `${opts.publicBase.replace(/\/$/, '')}/archivos/${token}`,
    tipo,
    mimeType: typeof media.mimeType === 'string' ? media.mimeType : 'application/octet-stream',
    nombre: typeof media.filename === 'string' ? media.filename : null,
    segundos: typeof media.seconds === 'number' ? media.seconds : null,
    bytes: typeof media.bytes === 'number' ? media.bytes : null,
    voz: media.voice === true || media.voz === true,
    verUnaVez: media.verUnaVez === true,
    caducaEn: caduca.toISOString(),
  };
}

export interface ArchivosGsgDeps {
  repos: Repos;
  secreto: string;
  mediaDir?: string;
  /** Para bajar de Meta lo que llego por la API oficial (solo trae el id). */
  wa?: Pick<WhatsAppClient, 'downloadMedia'>;
}

/** `GET /archivos/:token`: el fichero de un mensaje, con el enlace firmado del historial. */
export async function registerArchivosGsg(app: FastifyInstance, deps: ArchivosGsgDeps): Promise<void> {
  const dir = deps.mediaDir ?? mediaDirectory();

  app.get<{ Params: { token: string } }>('/archivos/:token', async (request, reply) => {
    const v = verificarArchivo(request.params.token, deps.secreto);
    if (!v.ok) {
      return reply.code(v.motivo === 'caducado' ? 410 : 404).send({ error: v.motivo === 'caducado' ? 'el enlace caducó: vuelve a pedir el historial' : 'ese archivo no existe' });
    }
    const mensaje = await deps.repos.messages.porId(v.payload.c, v.payload.m).catch(() => null);
    const media = mensaje ? mediaDe(mensaje) : null;
    if (!mensaje || !media) return reply.code(404).send({ error: 'ese archivo no existe' });
    const mimeType = typeof media.mimeType === 'string' ? media.mimeType : 'application/octet-stream';

    // Lo guardado al recibirlo (QR o lo que se mando desde aqui) o una copia ya bajada de Meta.
    const copia = idDeMedia(`meta:${String(media.id)}`, extensionDe(mimeType, mensaje.kind as Parameters<typeof extensionDe>[1]));
    let datos = (await leerMedia(dir, String(media.id))) ?? (await leerMedia(dir, copia));
    if (!datos && deps.wa?.downloadMedia) {
      const bajado = await deps.wa.downloadMedia(String(media.id)).catch((error: unknown) => {
        request.log.warn({ err: error }, 'no se pudo bajar el archivo de Meta');
        return null;
      });
      if (bajado) {
        datos = bajado.datos;
        await writeFile(path.join(dir, copia), bajado.datos).catch(() => undefined);
      }
    }
    if (!datos) return reply.code(404).send({ error: 'el archivo ya no está guardado' });

    const nombre = typeof media.filename === 'string' ? media.filename.replace(/["\r\n]/g, '') : '';
    // Se abre en la pagina solo lo que no puede ejecutar nada (fotos, video, audio, PDF).
    // Un documento cualquiera (un HTML, un SVG) que mando el cliente se descarga.
    const seVe = /^(image\/(jpeg|png|webp|gif)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf)$/i.test(mimeType.split(';')[0]!.trim());
    const disposicion = seVe ? 'inline' : 'attachment';
    return reply
      .type(seVe ? mimeType : 'application/octet-stream')
      .header('content-disposition', nombre ? `${disposicion}; filename="${encodeURIComponent(nombre)}"` : disposicion)
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .send(datos);
  });
}
