/**
 * «Enséñale a etiquetar» (Entrenamiento IA): los ejemplos de etiquetado del
 * negocio y las correcciones de su equipo.
 *
 * Un ejemplo es una conversacion corta («cliente: …» / «negocio: …» por
 * linea) con la etiqueta que le toca. Van en las instrucciones del
 * clasificador cada vez que etiqueta (src/archive/clasificar.ts →
 * `ejemplos`), asi la IA sigue el criterio del negocio en sus casos propios.
 * Como mucho TOPE_EJEMPLOS_NEGOCIO: cada uno gasta un poco en cada llamada.
 *
 * Una correccion es un chat donde una persona cambio a mano la etiqueta que
 * habia puesto la IA (evento `correccion_ia`, ver etiquetarAMano). Se ofrece
 * con la conversacion que leyo la IA (la copia del lote, mientras dure la
 * retencion de 72 h) para convertirla en ejemplo. Telefonos, DNI y correos
 * se tapan: el ejemplo dura mas que el chat.
 */

import { randomUUID } from 'node:crypto';
import { CATALOGO_POR_DEFECTO, TOPE_EJEMPLOS_NEGOCIO, nombreDeEtiqueta, type Catalogo, type EjemploNegocio } from '../archive/clasificar.js';
import { leerConversacionEscrita } from '../archive/evaluacion.js';
import type { ChatEtiquetasRepo, EjemploEtiquetado, MensajeCapturado } from '../db/chat-etiquetas.js';
import { taparDatosPersonales } from '../entrenamiento/texto.js';

/** El evento de cuando una persona cambia la etiqueta que puso la IA (lo apunta etiquetarAMano). */
export const CODIGO_CORRECCION = 'correccion_ia';

/** Lo mas largo que se guarda de un ejemplo (cada uno va en cada llamada a la IA). */
export const TOPE_TEXTO_EJEMPLO = 1_500;
/** Cuantos mensajes de una conversacion se ofrecen al convertir una correccion. */
const MENSAJES_DE_CORRECCION = 12;

/** Los ejemplos tal como los usa el clasificador (los que tienen una etiqueta del catalogo). */
export async function ejemplosParaIA(repo: ChatEtiquetasRepo, catalogo: Catalogo = CATALOGO_POR_DEFECTO): Promise<EjemploNegocio[]> {
  const todos = await repo.ejemplos().catch(() => [] as EjemploEtiquetado[]);
  return todos
    .filter((e) => catalogo.some((c) => c.codigo === e.etiqueta))
    .map((e) => ({ mensajes: leerConversacionEscrita(e.texto), etiqueta: e.etiqueta }))
    .filter((e) => e.mensajes.some((m) => m.direction === 'in'))
    .slice(0, TOPE_EJEMPLOS_NEGOCIO);
}

/** La conversacion copiada en un lote, escrita como un ejemplo y con lo personal tapado. */
export function textoDeConversacion(mensajes: MensajeCapturado[]): string {
  return mensajes
    .slice(-MENSAJES_DE_CORRECCION)
    .map((m) => {
      const quien = m.direction === 'in' ? 'cliente' : 'negocio';
      const cuerpo = m.body?.trim()
        ? taparDatosPersonales(m.body.replace(/\s+/g, ' ').trim()).slice(0, 200)
        : m.kind === 'location'
          ? '[ubicación]'
          : m.kind === 'image'
            ? '[foto]'
            : m.kind === 'audio'
              ? '[audio]'
              : `[${m.kind}]`;
      return `${quien}: ${cuerpo}`;
    })
    .join('\n');
}

export type ResultadoEjemplo = { ok: true; ejemplo: EjemploEtiquetado } | { ok: false; error: string };

/**
 * Añade un ejemplo (a mano o desde una correccion). Se valida: una etiqueta
 * del catalogo, al menos un mensaje del cliente, no pasarse del tope, y lo
 * personal se tapa. La misma correccion no entra dos veces.
 */
export async function agregarEjemplo(
  repo: ChatEtiquetasRepo,
  catalogo: Catalogo,
  entrada: { texto: string; etiqueta: string; fuente?: string | null; quien?: string | null },
  ahora: Date = new Date(),
): Promise<ResultadoEjemplo> {
  if (!catalogo.some((c) => c.codigo === entrada.etiqueta)) return { ok: false, error: 'Esa etiqueta no está en el catálogo del negocio.' };
  const texto = entrada.texto
    .split(/\r?\n/)
    .map((l) => taparDatosPersonales(l.trim()))
    .filter(Boolean)
    .join('\n')
    .slice(0, TOPE_TEXTO_EJEMPLO);
  if (!leerConversacionEscrita(texto).some((m) => m.direction === 'in')) {
    return { ok: false, error: 'Escribe al menos un mensaje del cliente (una línea que empiece por «cliente:»).' };
  }
  const todos = await repo.ejemplos();
  if (todos.length >= TOPE_EJEMPLOS_NEGOCIO) return { ok: false, error: `Ya tiene ${TOPE_EJEMPLOS_NEGOCIO} ejemplos, el máximo: quita alguno antes de añadir otro.` };
  if (entrada.fuente && todos.some((e) => e.fuente === entrada.fuente)) return { ok: false, error: 'Esa corrección ya es un ejemplo.' };
  const ejemplo: EjemploEtiquetado = {
    id: randomUUID(),
    texto,
    etiqueta: entrada.etiqueta,
    origen: entrada.fuente ? 'correccion' : 'manual',
    fuente: entrada.fuente ?? null,
    creadoEn: ahora.toISOString(),
    creadoPor: entrada.quien?.trim() || null,
  };
  await repo.guardarEjemplos([...todos, ejemplo]);
  await repo
    .registrar({ loteId: null, phone: null, fase: 'analisis', nivel: 'info', codigo: 'ejemplo_nuevo', detalle: `${ejemplo.creadoPor ?? 'Una persona'} enseñó un ejemplo de «${nombreDeEtiqueta(ejemplo.etiqueta, catalogo)}»${ejemplo.origen === 'correccion' ? ' (de una corrección)' : ''}.` })
    .catch(() => undefined);
  return { ok: true, ejemplo };
}

/** Quita un ejemplo. false si no existia. */
export async function quitarEjemplo(repo: ChatEtiquetasRepo, id: string): Promise<boolean> {
  const todos = await repo.ejemplos();
  const quedan = todos.filter((e) => e.id !== id);
  if (quedan.length === todos.length) return false;
  await repo.guardarEjemplos(quedan);
  return true;
}

export interface CorreccionEtiqueta {
  /** «telefono|lote»: identifica la correccion (y el ejemplo que salga de ella). */
  fuente: string;
  phone: string;
  dia: string | null;
  /** Lo que puso la IA y lo que puso la persona (codigos y nombres). */
  antes: string;
  antesNombre: string;
  ahora: string;
  ahoraNombre: string;
  en: string;
  /** La conversacion que leyo la IA, lista para el ejemplo; null si la copia ya se vacio (72 h). */
  texto: string | null;
}

/**
 * Las correcciones recientes que aun no son ejemplo, la mas nueva primero:
 * una por chat y lote (si la cambiaron dos veces, vale la ultima).
 */
export async function correccionesRecientes(repo: ChatEtiquetasRepo, catalogo: Catalogo, limite = 20): Promise<CorreccionEtiqueta[]> {
  const [eventos, ejemplos] = await Promise.all([repo.eventos({ fase: 'analisis', limite: 500 }), repo.ejemplos().catch(() => [] as EjemploEtiquetado[])]);
  const usadas = new Set(ejemplos.map((e) => e.fuente).filter(Boolean));
  const vistas = new Set<string>();
  const salida: CorreccionEtiqueta[] = [];
  for (const ev of eventos) {
    if (ev.codigo !== CODIGO_CORRECCION || !ev.phone || !ev.loteId || !ev.detalle) continue;
    const fuente = `${ev.phone}|${ev.loteId}`;
    if (vistas.has(fuente) || usadas.has(fuente)) continue;
    vistas.add(fuente);
    const [antes, ahora] = ev.detalle.split('>');
    if (!antes || !ahora) continue;
    const chat = await repo.chatDelLote(ev.loteId, ev.phone).catch(() => null);
    salida.push({
      fuente,
      phone: ev.phone,
      dia: chat?.dia ?? null,
      antes,
      antesNombre: nombreDeEtiqueta(antes, catalogo),
      ahora,
      ahoraNombre: nombreDeEtiqueta(ahora, catalogo),
      en: ev.createdAt.toISOString(),
      texto: chat?.mensajes?.length ? textoDeConversacion(chat.mensajes) : null,
    });
    if (salida.length >= limite) break;
  }
  return salida;
}
