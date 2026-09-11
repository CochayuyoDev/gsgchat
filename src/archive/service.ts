/**
 * Cerrar una conversacion: guardarla entera y vaciarla de la base.
 *
 * El orden no es negociable y es lo unico delicado de este modulo: primero se
 * escribe el fichero, luego se comprueba, luego se apunta en el indice y solo
 * entonces se borran los mensajes. Si algo falla por el camino, lo que queda
 * es un respaldo de mas -que no molesta a nadie- y nunca un hilo borrado sin
 * copia.
 *
 * Lo que se borra es el hilo, no el contacto: el numero, el nombre, el opt-in
 * y la ficha de preventa siguen en su sitio. Cerrar un chat no es olvidar a un
 * cliente, es dejar de arrastrar su historial en la base viva.
 */

import type { ArchiveReason, ChatArchive } from '../db/archives.js';
import type { Message } from '../db/messages.js';
import type { Repos } from '../db/repos.js';
import {
  FORMATO,
  borrarArchivo,
  comprobar,
  escribirArchivo,
  leerArchivo,
  nombreDeArchivo,
  type ArchiveHeader,
} from './store.js';

/** Cuantos mensajes se leen de golpe al respaldar. */
const PAGINA = 500;

export interface ArchiveDeps {
  repos: Repos;
  /** Directorio donde viven los ficheros de respaldo. */
  dir: string;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
}

export interface ArchiveOutcome {
  ok: boolean;
  /** Por que no se hizo, cuando no se hizo. */
  motivo?: string;
  archive?: ChatArchive;
  /** Mensajes borrados de la base. */
  borrados?: number;
}

const NADA_QUE_GUARDAR = 'Esta conversación no tiene mensajes que guardar.';

/**
 * Respalda el hilo del contacto y lo borra de la base.
 *
 * Devuelve `ok: false` con motivo cuando no habia nada que respaldar: eso no
 * es un fallo, es el caso normal de un contacto que nunca escribio.
 */
export async function archivarConversacion(
  deps: ArchiveDeps,
  contactId: string,
  motivo: ArchiveReason = 'manual',
): Promise<ArchiveOutcome> {
  const { repos, dir } = deps;

  const contacto = await repos.contacts.getById(contactId);
  if (!contacto) return { ok: false, motivo: 'Ese contacto ya no existe.' };

  const resumen = await repos.messages.summaryByContact(contactId);
  if (!resumen.count) return { ok: false, motivo: NADA_QUE_GUARDAR };

  const ahora = new Date();
  const file = nombreDeArchivo(contacto.phone, ahora);

  const header: ArchiveHeader = {
    tipo: 'wa-locator/chat',
    version: FORMATO,
    exportadoEn: ahora.toISOString(),
    contacto: { id: contacto.id, phone: contacto.phone, name: contacto.name },
    motivo,
    mensajes: resumen.count,
    desde: resumen.firstAt?.toISOString() ?? null,
    hasta: resumen.lastAt?.toISOString() ?? null,
  };

  // El hilo se lee por paginas y se escribe segun se lee: un cliente con
  // cincuenta mil mensajes no cabe en memoria de una sola vez.
  let escritos = 0;
  const lineas = (async function* () {
    yield JSON.stringify(header);
    let desde = 0;
    for (;;) {
      const pagina = await repos.messages.pageForArchive(contactId, desde, PAGINA);
      if (!pagina.length) break;
      for (const mensaje of pagina) {
        if (mensaje.id > resumen.lastId) break;
        yield JSON.stringify(mensaje);
        escritos++;
      }
      desde = pagina[pagina.length - 1]!.id;
      if (desde >= resumen.lastId) break;
    }
  })();

  const escrito = await escribirArchivo(dir, file, lineas);

  // Releerlo antes de borrar nada. Es la unica forma de saber que el fichero
  // se puede abrir de verdad, y no solo que la escritura no dio error.
  try {
    const control = await leerArchivo(dir, file);
    if (control.messages.length !== escritos) {
      throw new Error(
        `el respaldo tiene ${control.messages.length} mensajes y se escribieron ${escritos}`,
      );
    }
  } catch (error) {
    await borrarArchivo(dir, file);
    throw new Error(
      `no se pudo verificar el respaldo, no se borro nada: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const archive = await repos.archives.add({
    contactId,
    phone: contacto.phone,
    name: contacto.name,
    file: escrito.file,
    bytes: escrito.bytes,
    messageCount: escritos,
    firstMessageAt: resumen.firstAt,
    lastMessageAt: resumen.lastAt,
    reason: motivo,
    sha256: escrito.sha256,
  });

  const borrados = await repos.messages.deleteByContact(contactId, resumen.lastId);
  // El chat vuelve a estar "leido": no quedan mensajes que leer.
  await repos.messages.markRead(contactId, new Date());

  deps.log?.('conversacion respaldada y limpiada', {
    phone: contacto.phone,
    mensajes: borrados,
    motivo,
    fichero: escrito.file,
  });

  return { ok: true, archive, borrados };
}

/** El hilo guardado, para verlo en el panel sin restaurarlo. */
export async function leerRespaldo(
  deps: ArchiveDeps,
  id: number,
): Promise<{ archive: ChatArchive; header: ArchiveHeader; messages: Message[] } | null> {
  const archive = await deps.repos.archives.get(id);
  if (!archive) return null;
  const { header, messages } = await leerArchivo(deps.dir, archive.file);
  return { archive, header, messages };
}

/**
 * Devuelve el hilo a la base.
 *
 * Para cuando hay que volver a hablar con ese cliente y se quiere el
 * historial delante. El respaldo NO se borra al restaurar: si algo sale mal a
 * media restauracion, el fichero sigue siendo la copia buena.
 */
export async function restaurarRespaldo(
  deps: ArchiveDeps,
  id: number,
): Promise<{ ok: boolean; motivo?: string; restaurados: number }> {
  const leido = await leerRespaldo(deps, id);
  if (!leido) return { ok: false, motivo: 'Ese respaldo ya no existe.', restaurados: 0 };

  const contacto = await deps.repos.contacts.getById(leido.archive.contactId);
  if (!contacto) return { ok: false, motivo: 'Ese contacto ya no existe.', restaurados: 0 };

  let restaurados = 0;
  for (const mensaje of leido.messages) {
    await deps.repos.messages.add({
      contactId: leido.archive.contactId,
      direction: mensaje.direction,
      wamid: mensaje.wamid,
      kind: mensaje.kind,
      body: mensaje.body,
      payload: mensaje.payload,
      status: mensaje.status,
      // El id de entrega apuntaba a una fila que puede haberse ido; el hilo
      // se lee igual sin el, y dejarlo colgando rompe la clave ajena.
      deliveryId: null,
      createdAt: mensaje.createdAt,
    });
    restaurados++;
  }

  deps.log?.('respaldo restaurado', { phone: leido.archive.phone, mensajes: restaurados });
  return { ok: true, restaurados };
}

export interface BarridoResumen {
  revisados: number;
  archivados: number;
  mensajes: number;
  fallos: Array<{ contactId: string; error: string }>;
}

/**
 * Cierra sola toda conversacion sin movimiento desde hace `dias`.
 *
 * `limite` acota cuanto se hace en una pasada: el barrido corre dentro del
 * mismo proceso que atiende el chat, y un primer arranque con diez mil
 * conversaciones viejas no puede monopolizarlo.
 */
export async function barrerInactivas(
  deps: ArchiveDeps,
  dias: number,
  limite = 25,
): Promise<BarridoResumen> {
  const resumen: BarridoResumen = { revisados: 0, archivados: 0, mensajes: 0, fallos: [] };
  if (dias <= 0) return resumen;

  const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  const candidatos = await deps.repos.messages.staleContacts(corte, limite);

  for (const { contactId } of candidatos) {
    resumen.revisados++;
    try {
      const salida = await archivarConversacion(deps, contactId, 'inactividad');
      if (salida.ok) {
        resumen.archivados++;
        resumen.mensajes += salida.borrados ?? 0;
      }
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      resumen.fallos.push({ contactId, error: detalle });
      deps.log?.('no se pudo archivar una conversacion inactiva', { contactId, detalle });
    }
  }

  return resumen;
}

/** Comprueba que los ficheros de los respaldos siguen ahi y sin tocar. */
export async function revisarRespaldos(
  deps: ArchiveDeps,
  limite = 200,
): Promise<Array<{ id: number; phone: string; file: string; ok: boolean; detalle: string }>> {
  const lista = await deps.repos.archives.list({ limit: limite, offset: 0 });
  const salida = [];
  for (const archive of lista) {
    const estado = await comprobar(deps.dir, archive.file, archive.sha256).catch((error) => ({
      ok: false,
      detalle: error instanceof Error ? error.message : String(error),
    }));
    salida.push({ id: archive.id, phone: archive.phone, file: archive.file, ...estado });
  }
  return salida;
}

/**
 * Ticker del barrido. Devuelve la funcion para pararlo.
 *
 * Cada hora y no cada diez segundos como el de automatizacion: aqui no hay
 * nada urgente que atender, y cada pasada lee y escribe ficheros.
 */
export function startArchiveSweeper(
  deps: ArchiveDeps,
  dias: number,
  intervalMs = 60 * 60 * 1000,
): () => void {
  if (dias <= 0) return () => undefined;

  let corriendo = false;
  const tick = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      const resumen = await barrerInactivas(deps, dias);
      if (resumen.archivados) {
        deps.log?.('barrido de conversaciones inactivas', {
          archivadas: resumen.archivados,
          mensajes: resumen.mensajes,
          dias,
        });
      }
    } catch (error) {
      deps.log?.('fallo el barrido de conversaciones', {
        detalle: error instanceof Error ? error.message : String(error),
      });
    } finally {
      corriendo = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
