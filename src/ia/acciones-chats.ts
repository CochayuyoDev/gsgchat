/**
 * Lo que la IA operadora hace con la conversacion entera de un numero:
 * exportarla (el enlace para descargarla en HTML o texto) y mandarla a la
 * papelera. Guardarla ya lo hace `chat.cerrar` (acciones-panel.ts).
 *
 * Todo pasa por las rutas de Conversaciones guardadas (archive-routes.ts):
 *  - exportar sale de lo guardado; si el chat sigue vivo con mensajes, al
 *    pulsar «Hacerlo» primero se guarda (igual que el boton «Cerrar chat») y
 *    luego se da el enlace.
 *  - eliminar usa «Borrar todo de este cliente»: lo vivo se guarda y todo va
 *    a la papelera 30 dias (se recupera desde Guardados). El borrado
 *    definitivo NO se ofrece aqui: solo a mano, en su pantalla.
 */

import { z } from 'zod';
import { def, errorDe, ok, prepararConContacto, telefonoBonito, unContacto, type Accion, type ContactoVista, type ContextoAccion } from './acciones-base.js';

interface GuardadaVista {
  id: number;
  createdAt: string;
  messageCount?: number;
}

/** Cuantos mensajes tiene el chat vivo (null si no se pudo leer). */
async function mensajesVivos(ctx: ContextoAccion, c: ContactoVista): Promise<number | null> {
  const r = await ctx.llamar({ method: 'GET', url: `/admin/chat/${encodeURIComponent(c.id)}?limit=200` });
  return ok(r) ? ((r.json as { messages?: unknown[] }).messages ?? []).length : null;
}

/** Las conversaciones guardadas de ese numero, la mas reciente primero. */
async function guardadasDe(ctx: ContextoAccion, c: ContactoVista): Promise<{ items: GuardadaVista[]; total: number } | null> {
  const r = await ctx.llamar({ method: 'GET', url: `/admin/archives?q=${encodeURIComponent(c.phone)}&limit=20` });
  if (!ok(r)) return null;
  const j = r.json as { items?: GuardadaVista[]; total?: number };
  return { items: j.items ?? [], total: j.total ?? (j.items ?? []).length };
}

const cuantosMensajes = (n: number | null) => (n === null ? 'con mensajes' : `con ${n >= 200 ? '200 o más' : n} mensaje(s)`);

const chatExportar = def({
  nombre: 'chat.exportar',
  tipo: 'cambio',
  descripcion: 'Exportar la conversación de un número para descargarla (HTML para leer o imprimir, o texto). Si el chat sigue abierto con mensajes, primero se guarda en Conversaciones guardadas y se vacía de Chats.',
  parametros: 'telefono (o nombre), formato (opcional: html | texto; html por defecto), anonimo (opcional: true para tapar teléfonos y nombres)',
  ejemplo: { orden: 'exporta el chat de Luis', accion: { accion: 'chat.exportar', telefono: 'Luis' } },
  schema: z.object({ telefono: z.string().trim().min(2).max(120), contactId: z.string().max(80).optional(), formato: z.enum(['html', 'texto']).default('html'), anonimo: z.boolean().default(false) }),
  async preparar(p, ctx) {
    return prepararConContacto(ctx, p, p.telefono, '¿Qué chat exporto?', async (c) => {
      const [vivos, guardadas] = await Promise.all([mensajesVivos(ctx, c), guardadasDe(ctx, c)]);
      const hayGuardadas = Boolean(guardadas?.items.length);
      if (vivos === 0 && !hayGuardadas) return { tipo: 'no', resumen: `${c.name ?? telefonoBonito(c.phone)} no tiene mensajes ni conversaciones guardadas: no hay nada que exportar.`, ir: '/chat' };
      const quien = `${c.name ?? 'sin nombre'} (${telefonoBonito(c.phone)})`;
      const como = `${p.formato === 'texto' ? 'texto (.txt)' : 'HTML'}${p.anonimo ? ', sin teléfonos ni nombres' : ''}`;
      const avisos: string[] = [];
      if (vivos && hayGuardadas) avisos.push(`Además tiene ${guardadas!.total} conversación(es) guardada(s) de antes: se exporta la de ahora; las otras siguen en Guardados.`);
      return {
        tipo: 'listo',
        params: { ...p, contactId: c.id },
        tarjeta: vivos
          ? { que: `Guardar el chat de ${c.name ?? telefonoBonito(c.phone)} y darte el enlace para descargarlo en ${como}`, aQuien: quien, cuantos: vivos ?? undefined, antes: `en Chats ${cuantosMensajes(vivos)}`, despues: 'guardado en Conversaciones guardadas, vacío en Chats, y el enlace de descarga', avisos }
          : { que: `Darte el enlace para descargar la última conversación guardada de ${c.name ?? telefonoBonito(c.phone)} en ${como}`, aQuien: quien, antes: `${guardadas!.total} conversación(es) guardada(s); el chat está vacío`, despues: 'el enlace de descarga (no cambia nada)', avisos },
      };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unContacto(ctx, p.telefono, p.contactId);
    if ('error' in u) return u.error;
    let id: number | null = null;
    if ((await mensajesVivos(ctx, u.c)) !== 0) {
      const r = await ctx.llamar({ method: 'POST', url: `/admin/chat/${encodeURIComponent(u.c.id)}/archive`, body: {} });
      // 409 = sin mensajes que guardar: se sigue con lo ya guardado.
      if (!ok(r) && r.status !== 409) return errorDe(r, 'No se pudo guardar el chat antes de exportarlo.');
      if (ok(r)) id = (r.json as { archive?: { id?: number } }).archive?.id ?? null;
    }
    if (!id) {
      const g = await guardadasDe(ctx, u.c);
      id = g?.items[0]?.id ?? null;
    }
    if (!id) return { ok: false, resumen: `${u.c.name ?? u.c.phone} no tiene nada guardado que exportar.`, ir: '/guardados' };
    const enlace = `/admin/archives/${id}/export.${p.formato === 'texto' ? 'txt' : 'html'}${p.anonimo ? '?anonimo=si' : ''}`;
    return { ok: true, resumen: `Listo: la conversación de ${u.c.name ?? u.c.phone} se descarga desde ${enlace}.`, datos: { id, enlace }, ir: enlace };
  },
});

const chatEliminar = def({
  nombre: 'chat.eliminar',
  tipo: 'cambio',
  peligrosa: true,
  descripcion: 'Eliminar la conversación de un número: lo del chat y lo guardado va a la papelera 30 días (se puede recuperar desde Guardados; pasado ese plazo se borra para siempre). No borra nada del teléfono del cliente.',
  parametros: 'telefono (o nombre)',
  ejemplo: { orden: 'elimina la conversación del 912426667', accion: { accion: 'chat.eliminar', telefono: '912426667' } },
  schema: z.object({ telefono: z.string().trim().min(2).max(120), contactId: z.string().max(80).optional() }),
  async preparar(p, ctx) {
    return prepararConContacto(ctx, p, p.telefono, '¿Qué conversación elimino?', async (c) => {
      const [vivos, guardadas] = await Promise.all([mensajesVivos(ctx, c), guardadasDe(ctx, c)]);
      const nGuardadas = guardadas?.total ?? 0;
      if (vivos === 0 && nGuardadas === 0) return { tipo: 'no', resumen: `${c.name ?? telefonoBonito(c.phone)} no tiene mensajes ni conversaciones guardadas: no hay nada que eliminar.`, ir: '/chat' };
      const antes = [vivos ? `en Chats ${cuantosMensajes(vivos)}` : null, nGuardadas ? `${nGuardadas} conversación(es) guardada(s)` : null].filter(Boolean).join(' y ');
      return {
        tipo: 'listo',
        params: { ...p, contactId: c.id },
        tarjeta: {
          que: `Eliminar la conversación de ${c.name ?? telefonoBonito(c.phone)}`,
          aQuien: `${c.name ?? 'sin nombre'} (${telefonoBonito(c.phone)})`,
          antes,
          despues: 'todo en la papelera de Guardados durante 30 días; Chats vacío',
          avisos: ['Pasados 30 días se borra para siempre. Hasta entonces se recupera desde Guardados → Papelera.', 'Al cliente no le llega nada ni se borra nada de su WhatsApp.'],
        },
      };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unContacto(ctx, p.telefono, p.contactId);
    if ('error' in u) return u.error;
    // La ruta exige la palabra que escribiria la persona en el cuadro; aqui la pone el «Hacerlo» de la tarjeta.
    const r = await ctx.llamar({ method: 'POST', url: '/admin/archives/borrar-cliente', body: { contactId: u.c.id, confirmar: 'BORRAR' } });
    if (!ok(r)) return errorDe(r, 'No se pudo eliminar la conversación.');
    const j = r.json as { guardadas?: number; aPapelera?: number; papeleraDias?: number };
    return { ok: true, resumen: `Conversación de ${u.c.name ?? u.c.phone} en la papelera${j.aPapelera !== undefined ? ` (${j.aPapelera} guardada(s))` : ''}: se recupera desde Guardados durante ${j.papeleraDias ?? 30} días.`, ir: '/guardados' };
  },
});

export const ACCIONES_CHATS: Accion[] = [chatExportar, chatEliminar];
