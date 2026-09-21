/**
 * GSG empuja: en vez de esperar a que se le pregunte cada cinco minutos,
 * el sistema de GSG (o cualquiera con una clave `entregas:gestionar`) manda
 * los pedidos del dia en cuanto los tiene, y pregunta o cancela por
 * referencia. Mismo contrato que `GET /reparto/pendientes` (ClienteGsg),
 * con dos banderas por pedido: `faltaUbicacion` y `faltaConfirmar`.
 *
 *  POST   /api/v1/entregas                 uno o varios pedidos (entregas:gestionar)
 *  GET    /api/v1/entregas/:referencia     como va ese pedido hoy (entregas:leer)
 *  DELETE /api/v1/entregas/:referencia     cancelarlo (entregas:gestionar)
 *
 * Lo que pasa despues lo cuentan los webhooks `entrega.confirmada`,
 * `entrega.avisada`, `entrega.entregada` y `entrega.incidencia` (ver
 * src/eventos/bus.ts) y la cola de reportes hacia GSG. El contrato entero,
 * en `docs/CONTRATO-GSG.md` y en `/api/v1/openapi.json`.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ServicioEntregas, FilaEntrega } from '../../entregas/servicio.js';
import type { EntregasRepo } from '../../entregas/repo.js';

export interface ApiEntregasGsgDeps {
  entregas: ServicioEntregas;
  /** El repo, para marcar la prioridad sin pasar por la pantalla. */
  repo?: EntregasRepo;
}

const pedidoSchema = z.object({
  referencia: z.string().trim().min(1).max(60),
  // Un telefono malo no tumba la llamada entera: se descarta ese pedido con su motivo.
  telefono: z.coerce.string().trim().max(30).default(''),
  nombre: z.string().trim().max(120).nullable().optional(),
  direccion: z.string().trim().max(300).nullable().optional(),
  distrito: z.string().trim().max(120).nullable().optional(),
  notas: z.string().trim().max(500).nullable().optional(),
  lat: z.coerce.number().min(-90).max(90).nullable().optional(),
  lng: z.coerce.number().min(-180).max(180).nullable().optional(),
  id: z.union([z.string().max(60), z.number()]).nullable().optional(),
  faltaUbicacion: z.boolean().optional(),
  faltaConfirmar: z.boolean().optional(),
  urgente: z.boolean().optional(),
});

type Pedido = z.infer<typeof pedidoSchema>;

/** Uno, una lista, o { pedidos: [...] }. */
function leerCuerpo(body: unknown): Pedido[] | { error: string } {
  const esObjeto = Boolean(body) && typeof body === 'object' && !Array.isArray(body);
  const lista = Array.isArray(body) ? body : esObjeto && Array.isArray((body as { pedidos?: unknown }).pedidos) ? (body as { pedidos: unknown[] }).pedidos : esObjeto && Object.keys(body as object).length ? [body] : [];
  if (!lista.length) return { error: 'Manda un pedido ({referencia, telefono, ...}), una lista de pedidos, o {pedidos: [...]}.' };
  if (lista.length > 500) return { error: 'Como mucho 500 pedidos por llamada.' };
  const pedidos: Pedido[] = [];
  for (const [i, p] of lista.entries()) {
    const r = pedidoSchema.safeParse(p);
    if (!r.success) {
      const falta = r.error.issues[0];
      return { error: `El pedido ${i + 1} no se entiende: ${falta ? `${falta.path.join('.') || 'cuerpo'}: ${falta.message}` : 'revisa los campos'}.` };
    }
    pedidos.push(r.data);
  }
  return pedidos;
}

/** Como va un pedido, para otro sistema: sin ids internos de mas, con la situacion en palabras. */
export function entregaParaApi(e: FilaEntrega): Record<string, unknown> {
  return {
    referencia: e.referencia,
    id: e.externoId,
    dia: e.dia,
    telefono: e.phone,
    nombre: e.nombre,
    direccion: e.direccion,
    distrito: e.distrito,
    notas: e.notas,
    estado: e.estado,
    situacion: e.situacion,
    prioridad: e.prioridad ?? 'normal',
    ubicacion: { estado: e.ubicacionEstado, lat: e.lat, lng: e.lng, mapa: e.mapsUrl, recibidaEn: e.ubicacionAt ? e.ubicacionAt.toISOString() : null },
    confirmacion: { estado: e.confirmacionEstado, intentos: e.confirmacionIntentos, respuesta: e.confirmacionRespuesta, como: e.confirmacionComo, en: e.confirmacionAt ? e.confirmacionAt.toISOString() : null },
    motorizado: e.motorizado ? { nombre: e.motorizado.nombre, telefono: e.motorizado.phone, placa: e.motorizado.placa } : null,
    minutosMotorizado: e.minutosMotorizado,
    minutosAviso: e.minutosAviso,
    llegaAproxEn: e.llegaAproxAt ? e.llegaAproxAt.toISOString() : null,
    avisadaEn: e.avisoEnviadoAt ? e.avisoEnviadoAt.toISOString() : null,
    entregadaEn: e.entregadaAt ? e.entregadaAt.toISOString() : null,
    entregadaComo: e.entregadaComo,
    incidencia: e.incidencia ? { codigo: e.incidencia, detalle: e.incidenciaDetalle } : null,
  };
}

export async function registerApiEntregasGsg(app: FastifyInstance, deps: ApiEntregasGsgDeps): Promise<void> {
  const { entregas } = deps;

  const porReferencia = async (referencia: string): Promise<FilaEntrega | undefined> => {
    const r = await entregas.resumen();
    const ref = referencia.trim().toLowerCase();
    return r.entregas.find((e) => e.referencia.toLowerCase() === ref || String(e.externoId ?? '').toLowerCase() === ref);
  };

  const noExiste = (reply: FastifyReply, referencia: string) => reply.code(404).send({ error: `No hay ningún pedido de hoy con la referencia "${referencia}".` });

  app.post('/api/v1/entregas', { config: { permiso: 'entregas:gestionar' } }, async (request, reply) => {
    const lectura = leerCuerpo(request.body);
    if ('error' in lectura) return reply.code(400).send({ error: lectura.error });
    const quien = request.usuario?.nombre ? `${request.usuario.nombre} (API)` : 'GSG (API)';
    const creadas: Record<string, unknown>[] = [];
    const repetidas: string[] = [];
    const descartadas: Array<{ referencia: string; motivo: string }> = [];
    const vistas = new Set<string>();

    // Sin pin: todos juntos en un solo lote del reparto (le pide la ubicacion a
    // cada uno con su ritmo). Con pin: uno a uno, ya con su ubicacion puesta.
    const sinPin = lectura.filter((p) => !(typeof p.lat === 'number' && typeof p.lng === 'number'));
    const conPin = lectura.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
    const urgentes = new Set(lectura.filter((p) => p.urgente).map((p) => p.referencia.trim().toLowerCase()));

    for (const p of lectura) {
      const ref = p.referencia.trim().toLowerCase();
      if (vistas.has(ref)) repetidas.push(p.referencia);
      vistas.add(ref);
    }

    if (sinPin.length) {
      const filas = sinPin.map((p) => ({ telefono: p.telefono, nombre: p.nombre ?? undefined, referencia: p.referencia, direccion: p.direccion ?? undefined, distrito: p.distrito ?? undefined, notas: p.notas ?? undefined, faltaUbicacion: p.faltaUbicacion ?? true, faltaConfirmacion: p.faltaConfirmar ?? true }));
      const r = await entregas.crearVarias(filas, quien);
      for (const d of r.descartadas) descartadas.push({ referencia: sinPin[d.linea - 1]?.referencia ?? d.texto, motivo: d.motivo });
      for (const rep of r.repetidas) if (!repetidas.includes(rep)) repetidas.push(rep);
      for (const e of r.creadas) creadas.push({ referencia: e.referencia, id: e.id });
    }
    for (const p of conPin) {
      const r = await entregas.crearAMano({ referencia: p.referencia, telefono: p.telefono, nombre: p.nombre ?? undefined, direccion: p.direccion ?? undefined, distrito: p.distrito ?? undefined, notas: p.notas ?? undefined, faltaUbicacion: false, faltaConfirmacion: p.faltaConfirmar ?? true, lat: p.lat!, lng: p.lng! }, quien);
      if (r.ok) creadas.push({ referencia: r.entrega.referencia, id: r.entrega.id });
      else if (/ya existe/i.test(r.motivo)) {
        if (!repetidas.includes(p.referencia)) repetidas.push(p.referencia);
      } else descartadas.push({ referencia: p.referencia, motivo: r.motivo });
    }
    // Los urgentes van primero hacia el motorizado.
    if (deps.repo && urgentes.size) {
      for (const c of creadas) {
        if (urgentes.has(String(c.referencia).toLowerCase())) {
          await deps.repo.actualizar(Number(c.id), { prioridad: 'urgente' } as Parameters<EntregasRepo['actualizar']>[1]);
          c.urgente = true;
        }
      }
    }
    const resumen = await entregas.resumen();
    const salida = creadas.map((c) => resumen.entregas.find((e) => e.id === c.id)).filter((e): e is FilaEntrega => Boolean(e)).map(entregaParaApi);
    return reply.code(creadas.length ? 201 : 200).send({
      ok: true,
      creadas: salida,
      repetidas,
      descartadas,
      detalle: `${creadas.length} pedido${creadas.length === 1 ? '' : 's'} nuevo${creadas.length === 1 ? '' : 's'}${repetidas.length ? `, ${repetidas.length} ya estaba${repetidas.length === 1 ? '' : 'n'}` : ''}${descartadas.length ? `, ${descartadas.length} descartado${descartadas.length === 1 ? '' : 's'}` : ''}.`,
    });
  });

  app.get<{ Params: { referencia: string } }>('/api/v1/entregas/:referencia', { config: { permiso: 'entregas:leer' } }, async (request, reply) => {
    const e = await porReferencia(request.params.referencia);
    if (!e) return noExiste(reply, request.params.referencia);
    const detalle = await entregas.entrega(e.id);
    return {
      ok: true,
      entrega: entregaParaApi(e),
      eventos: (detalle?.eventos ?? []).map((ev) => ({ en: ev.createdAt instanceof Date ? ev.createdAt.toISOString() : String(ev.createdAt), tipo: ev.tipo, detalle: ev.detalle })),
    };
  });

  app.delete<{ Params: { referencia: string } }>('/api/v1/entregas/:referencia', { config: { permiso: 'entregas:gestionar' } }, async (request, reply) => {
    const e = await porReferencia(request.params.referencia);
    if (!e) return noExiste(reply, request.params.referencia);
    if (e.estado === 'cancelada' || e.estado === 'entregada' || e.estado === 'terminada') {
      return reply.code(409).send({ error: `El pedido ${e.referencia} ya está ${e.estado === 'cancelada' ? 'cancelado' : e.estado === 'entregada' ? 'entregado' : 'terminado'}: no se puede cancelar.` });
    }
    const q = z.object({ motivo: z.string().max(300).optional() }).parse(request.query ?? {});
    const b = z.object({ motivo: z.string().max(300).optional() }).safeParse(request.body ?? {});
    const motivo = (b.success ? b.data.motivo : undefined) ?? q.motivo ?? 'cancelado por GSG';
    const quien = request.usuario?.nombre ? `${request.usuario.nombre} (API)` : 'GSG (API)';
    const cancelada = await entregas.cancelar(e.id, motivo, quien);
    if (!cancelada) return noExiste(reply, request.params.referencia);
    const fila = await porReferencia(request.params.referencia);
    return { ok: true, entrega: fila ? entregaParaApi(fila) : null, detalle: `Pedido ${e.referencia} cancelado: ${motivo}.` };
  });
}
