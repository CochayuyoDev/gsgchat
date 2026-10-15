import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Bus, NombreEvento } from '../eventos/bus.js';
import type { Repos } from '../db/repos.js';

/** Stream liviano de invalidaciones para el panel; nunca transporta cuerpos de chat. */
export function registrarEventosPanel(app: FastifyInstance, bus?: Bus, repos?: Repos): void {
  if (!bus) {
    app.get('/admin/panel/eventos', async (_request, reply) => reply.code(503).send({ error: 'eventos no disponibles' }));
    return;
  }

  const epoch = randomUUID();
  let secuencia = 0;
  type Conexion = { sid: string; afterId: string; raw: NodeJS.WritableStream & { writableLength?: number; destroyed?: boolean }; cerrar: () => void };
  const conexiones = new Set<Conexion>();
  const mandar = (evento: string, payload: Record<string, unknown>, conexion?: Conexion) => {
    const destino = conexion ? [conexion] : [...conexiones];
    for (const c of destino) {
      if (c.raw.destroyed) { c.cerrar(); continue; }
      const n = ++secuencia;
      const data = JSON.stringify({ ...payload, epoch, seq: n, at: new Date().toISOString() });
      const frame = `id: ${epoch}:${n}\nevent: ${evento}\ndata: ${data}\n\n`;
      const ok = c.raw.write(frame);
      if (!ok && Number(c.raw.writableLength ?? 0) > 64 * 1024) c.cerrar();
    }
  };

  const traducir = async (nombre: NombreEvento, payload: unknown) => {
    if (!repos) return;
    let wamid: string | null = null;
    let estado: string | null = null;
    let tipo = 'chat.changed';
    if (nombre === 'mensaje.estado') {
      const p = payload as { mensajeId?: string; estado?: string };
      wamid = p?.mensajeId ?? null; estado = p?.estado ?? null; tipo = 'chat.status';
    } else if (nombre === 'mensaje.recibido' || nombre === 'mensaje.enviado') {
      wamid = (payload as { mensaje?: { id?: string | null } })?.mensaje?.id ?? null;
    } else return;
    if (!wamid) return;
    const ref = await repos.messages.referenciaVisiblePorWamid(wamid, new Date(Date.now() - 24 * 60 * 60 * 1000)).catch(() => null);
    if (!ref) return;
    for (const c of conexiones) {
      if (BigInt(ref.id) <= BigInt(c.afterId)) continue;
      mandar(tipo, tipo === 'chat.status'
        ? { contactId: ref.contactId, messageId: ref.id, wamid, estado }
        : { contactId: ref.contactId, messageId: ref.id }, c);
    }
  };
  const dejarBus = bus.escucharTodo(traducir);

  app.get('/admin/panel/eventos', async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario || usuario.porToken) return reply.code(401).send({ error: 'Inicia sesión para abrir los eventos del panel.' });
    if (!usuario.chatSesion?.sid) return reply.code(409).send({ codigo: 'SESION_CHAT_REQUIERE_LOGIN', ir: '/login', error: 'Vuelve a iniciar sesión para actualizar el chat.' });
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const raw = reply.raw as unknown as Conexion['raw'];
    let timer: ReturnType<typeof setInterval> | null = null;
    let cerrado = false;
    const conexion: Conexion = {
      sid: usuario.chatSesion.sid,
      afterId: usuario.chatSesion.afterId,
      raw,
      cerrar() {
        if (cerrado) return;
        cerrado = true;
        if (timer) clearInterval(timer);
        conexiones.delete(conexion);
        try { raw.end(); } catch { /* socket cerrada */ }
      },
    };
    conexiones.add(conexion);
    raw.write(': conectado\n\n');
    mandar('panel.ready', { scopeId: conexion.sid }, conexion);
    mandar('panel.resync', { motivo: 'conexion' }, conexion);
    timer = setInterval(() => { if (!cerrado) raw.write(': latido\n\n'); }, 25_000);
    timer.unref();
    raw.on('close', conexion.cerrar);
    raw.on('error', conexion.cerrar);
  });

  app.addHook('onClose', async () => {
    dejarBus();
    for (const c of [...conexiones]) c.cerrar();
  });
}
