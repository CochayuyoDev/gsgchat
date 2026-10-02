/**
 * GSG empuja: en vez de esperar a que se le pregunte cada cinco minutos,
 * el sistema de GSG (o cualquiera con una clave `entregas:gestionar`) manda
 * los pedidos del dia en cuanto los tiene, y pregunta o cancela por
 * referencia. Mismo contrato que `GET /reparto/pendientes` (ClienteGsg),
 * con dos banderas por pedido: `faltaUbicacion` y `faltaConfirmar`.
 *
 *  POST   /api/v1/entregas                 uno o varios pedidos (entregas:gestionar)
 *  GET    /api/v1/entregas/:referencia     como va ese pedido hoy (entregas:leer)
 *  PATCH  /api/v1/entregas/:referencia     cambiar nombre, direccion, distrito, notas, urgente, los datos del envio o el motorizado (entregas:gestionar)
 *
 * Cada pedido puede traer los datos del envio que salen en el primer mensaje
 * al cliente: producto, empresa {codigo, nombre}, tracking, nroPedido,
 * metodoPago, monto y remitente (ver src/entregas/datos-envio.ts).
 *  DELETE /api/v1/entregas/:referencia     cancelarlo (entregas:gestionar)
 *
 * Cada clave tiene un tope de LIMITE_POR_MINUTO peticiones por minuto a estas
 * rutas: pasado, 429 con cuanto esperar (un bucle mal hecho en GSG no puede
 * tumbar el reparto).
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
import { datosEnvioDeCrudo, empresaEnTexto, fusionarDatosEnvio } from '../../entregas/datos-envio.js';

export interface ApiEntregasGsgDeps {
  entregas: ServicioEntregas;
  /** El repo, para marcar la prioridad sin pasar por la pantalla. */
  repo?: EntregasRepo;
  /** Peticiones por minuto y por clave (por defecto LIMITE_POR_MINUTO). */
  limitePorMinuto?: number;
  ahora?: () => number;
}

/** Tope por clave y minuto en /api/v1/entregas*. GSG manda en tandas (hasta 500 por llamada): 120 sobra. */
export const LIMITE_POR_MINUTO = 120;

const textoOpc = z.union([z.string().max(200), z.number()]).nullable().optional();

/**
 * Los datos del envio que salen en el primer mensaje al cliente. Todos
 * opcionales; la empresa (tienda que vende) va como {codigo, nombre} o en
 * campos sueltos. Ver datosEnvioDeCrudo.
 */
export const CAMPOS_DATOS_ENVIO = {
  costServ: textoOpc,
  referenciaDireccion: textoOpc,
  fecRegistro: textoOpc,
  fecRuta: textoOpc,
  observacionCliente: textoOpc,
  detalleProducto: textoOpc,
  telefono2: textoOpc,
  tamano: textoOpc,
  cantBultos: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).nullable().optional(),
  clientePagaDelivery: z.union([z.boolean().transform(v => v ? 'si' : 'no'), z.string().max(200)]).nullable().optional(),
  sede: textoOpc,
  tipoRuta: textoOpc,
  nroDocumento: textoOpc,
  agenciaNombre: textoOpc,
  agenciaDestino: textoOpc,
  pagoEnDestino: z.union([z.boolean().transform(v => v ? 'si' : 'no'), z.string().max(200)]).nullable().optional(),
  producto: textoOpc,
  empresa: z.union([z.object({ codigo: textoOpc, nombre: textoOpc }).passthrough(), z.string().max(200)]).nullable().optional(),
  empresaCodigo: textoOpc,
  empresaNombre: textoOpc,
  tiendaCodigo: textoOpc,
  tiendaNombre: textoOpc,
  tracking: textoOpc,
  nroPedido: textoOpc,
  metodoPago: textoOpc,
  monto: textoOpc,
  remitente: textoOpc,
  // El motorizado que GSG ya asigno a ese pedido: su numero es el que se le da
  // al cliente en el cierre y en UBI REGISTRADA (si no, el de soporte).
  motorizado: z.union([z.object({ nombre: textoOpc, telefono: textoOpc }).passthrough(), z.string().max(200)]).nullable().optional(),
  telefonoMotorizado: textoOpc,
};

/** Lo que se puede cambiar de un pedido ya mandado. El telefono no: eso es otro pedido. */
export const cambioPedidoSchema = z
  .object({
    nombre: z.string().trim().max(120).optional(),
    direccion: z.string().trim().max(300).optional(),
    distrito: z.string().trim().max(120).optional(),
    notas: z.string().trim().max(500).optional(),
    urgente: z.boolean().optional(),
    telefono: z.unknown().optional(),
    // Los datos del envio (ver src/entregas/datos-envio.ts): texto, o el monto como numero.
    ...CAMPOS_DATOS_ENVIO,
  })
  .strict();

const normalizarPedidoGsg = (body: unknown): unknown => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const p = body as Record<string, unknown>;
  return { ...p, referencia: p.referencia ?? p.tracking ?? p.codigoTracking,
    tracking: p.tracking ?? p.codigoTracking, nombre: p.nombre ?? p.cliente,
    motorizado: p.motorizado ?? p.driver, monto: p.monto ?? p.montoCobrar };
};

export const pedidoSchema = z.object({
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
  ...CAMPOS_DATOS_ENVIO,
});

type Pedido = z.infer<typeof pedidoSchema>;

/** Uno, una lista, o { pedidos: [...] }. */
export function leerCuerpo(body: unknown): Pedido[] | { error: string } {
  const esObjeto = Boolean(body) && typeof body === 'object' && !Array.isArray(body);
  const lista = Array.isArray(body) ? body : esObjeto && Array.isArray((body as { pedidos?: unknown }).pedidos) ? (body as { pedidos: unknown[] }).pedidos : esObjeto && Object.keys(body as object).length ? [body] : [];
  if (!lista.length) return { error: 'Manda un pedido ({referencia, telefono, ...}), una lista de pedidos, o {pedidos: [...]}.' };
  if (lista.length > 500) return { error: 'Como mucho 500 pedidos por llamada.' };
  const pedidos: Pedido[] = [];
  for (const [i, p] of lista.entries()) {
    const r = pedidoSchema.safeParse(normalizarPedidoGsg(p));
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
    costServ: e.datosEnvio?.costServ ?? null,
    referenciaDireccion: e.datosEnvio?.referenciaDireccion ?? null,
    fecRegistro: e.datosEnvio?.fecRegistro ?? null,
    fecRuta: e.datosEnvio?.fecRuta ?? null,
    observacionCliente: e.datosEnvio?.observacionCliente ?? null,
    detalleProducto: e.datosEnvio?.detalleProducto ?? null,
    telefono2: e.datosEnvio?.telefono2 ?? null,
    tamano: e.datosEnvio?.tamano ?? null,
    cantBultos: e.datosEnvio?.cantBultos ?? null,
    clientePagaDelivery: e.datosEnvio?.clientePagaDelivery ?? null,
    sede: e.datosEnvio?.sede ?? null,
    tipoRuta: e.datosEnvio?.tipoRuta ?? null,
    nroDocumento: e.datosEnvio?.nroDocumento ?? null,
    agenciaNombre: e.datosEnvio?.agenciaNombre ?? null,
    agenciaDestino: e.datosEnvio?.agenciaDestino ?? null,
    pagoEnDestino: e.datosEnvio?.pagoEnDestino ?? null,
    producto: e.datosEnvio?.producto ?? null,
    empresa: e.datosEnvio?.empresaCodigo || e.datosEnvio?.empresaNombre ? { codigo: e.datosEnvio?.empresaCodigo ?? null, nombre: e.datosEnvio?.empresaNombre ?? null, texto: empresaEnTexto(e.datosEnvio) } : null,
    tracking: e.datosEnvio?.tracking ?? null,
    nroPedido: e.datosEnvio?.nroPedido ?? null,
    metodoPago: e.datosEnvio?.metodoPago ?? null,
    monto: e.datosEnvio?.monto ?? null,
    remitente: e.datosEnvio?.remitente ?? null,
    estado: e.estado,
    situacion: e.situacion,
    prioridad: e.prioridad ?? 'normal',
    ubicacion: { estado: e.ubicacionEstado, lat: e.lat, lng: e.lng, mapa: e.mapsUrl, recibidaEn: e.ubicacionAt ? e.ubicacionAt.toISOString() : null },
    confirmacion: { estado: e.confirmacionEstado, intentos: e.confirmacionIntentos, respuesta: e.confirmacionRespuesta, como: e.confirmacionComo, en: e.confirmacionAt ? e.confirmacionAt.toISOString() : null },
    motorizado: e.motorizado
      ? { nombre: e.motorizado.nombre, telefono: e.motorizado.phone, placa: e.motorizado.placa }
      : e.datosEnvio?.telefonoMotorizado || e.datosEnvio?.motorizadoNombre
        ? { nombre: e.datosEnvio?.motorizadoNombre ?? null, telefono: e.datosEnvio?.telefonoMotorizado ?? null, placa: null }
        : null,
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
  const ahora = deps.ahora ?? (() => Date.now());
  const tope = deps.limitePorMinuto ?? LIMITE_POR_MINUTO;
  const usos = new Map<string, number[]>();

  // El tope por clave: se mira antes que nada (tras la autorizacion).
  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/entregas')) return;
    const quien = request.usuario?.id ?? request.ip;
    const t = ahora();
    const lista = (usos.get(quien) ?? []).filter((x) => x > t - 60_000);
    if (lista.length >= tope) {
      const espera = Math.max(1, Math.ceil((lista[0]! + 60_000 - t) / 1000));
      return reply.code(429).header('retry-after', String(espera)).send({ error: `Demasiadas peticiones con esta clave: como mucho ${tope} por minuto. Espera ${espera} s y vuelve a intentarlo.` });
    }
    lista.push(t);
    usos.set(quien, lista);
  });

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
      const filas = sinPin.map((p) => ({ telefono: p.telefono, nombre: p.nombre ?? undefined, referencia: p.referencia, direccion: p.direccion ?? undefined, distrito: p.distrito ?? undefined, notas: p.notas ?? undefined, faltaUbicacion: p.faltaUbicacion ?? true, faltaConfirmacion: p.faltaConfirmar ?? true, datosEnvio: datosEnvioDeCrudo(p) }));
      // La lista de GSG espera que una persona confirme el envío (ajuste de Hoy).
      const r = await entregas.crearVarias(filas, quien, { retener: true });
      for (const d of r.descartadas) descartadas.push({ referencia: sinPin[d.linea - 1]?.referencia ?? d.texto, motivo: d.motivo });
      for (const rep of r.repetidas) if (!repetidas.includes(rep)) repetidas.push(rep);
      for (const e of r.creadas) creadas.push({ referencia: e.referencia, id: e.id });
    }
    for (const p of conPin) {
      const r = await entregas.crearAMano({ referencia: p.referencia, telefono: p.telefono, nombre: p.nombre ?? undefined, direccion: p.direccion ?? undefined, distrito: p.distrito ?? undefined, notas: p.notas ?? undefined, faltaUbicacion: false, faltaConfirmacion: p.faltaConfirmar ?? true, lat: p.lat!, lng: p.lng!, datosEnvio: datosEnvioDeCrudo(p), retener: true }, quien);
      if (r.ok) creadas.push({ referencia: r.entrega.referencia, id: r.entrega.id });
      else if (/ya existe/i.test(r.motivo)) {
        if (!repetidas.includes(p.referencia)) repetidas.push(p.referencia);
        // Espejo: los datos del envio nuevos de un pedido que ya estaba se guardan.
        const ya = deps.repo ? await porReferencia(p.referencia) : undefined;
        const datos = ya ? fusionarDatosEnvio(ya.datosEnvio, datosEnvioDeCrudo(p)) : null;
        if (ya && datos && deps.repo) await deps.repo.actualizar(ya.id, { datosEnvio: datos });
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

  // GSG cambia datos de un pedido ya mandado: lo mismo que el espejo de la
  // sincronizacion (src/entregas/servicio.ts), pero empujado. Queda apuntado en
  // la bitacora del pedido. El telefono no se cambia aqui: es otro pedido
  // (cancelar y crear), porque al numero viejo ya se le pudo escribir.
  app.patch<{ Params: { referencia: string } }>('/api/v1/entregas/:referencia', { config: { permiso: 'entregas:gestionar' } }, async (request, reply) => {
    const leido = cambioPedidoSchema.safeParse(request.body ?? {});
    if (!leido.success) {
      const i = leido.error.issues[0];
      return reply.code(400).send({ error: `El cambio no se entiende: ${i ? `${i.path.join('.') || 'cuerpo'}: ${i.message}` : 'revisa los campos'}. Se puede cambiar nombre, direccion, distrito, notas, urgente, los datos del envío (producto, empresa, tracking, nroPedido, metodoPago, monto, remitente) y el motorizado (motorizado, telefonoMotorizado).` });
    }
    const b = leido.data;
    if (b.telefono !== undefined) return reply.code(400).send({ error: 'El teléfono no se cambia en un pedido ya mandado: cancélalo (DELETE) y créalo de nuevo con el número bueno.' });
    const e = await porReferencia(request.params.referencia);
    if (!e) return noExiste(reply, request.params.referencia);
    if (e.estado === 'cancelada' || e.estado === 'entregada' || e.estado === 'terminada') {
      return reply.code(409).send({ error: `El pedido ${e.referencia} ya está ${e.estado === 'cancelada' ? 'cancelado' : e.estado === 'entregada' ? 'entregado' : 'terminado'}: ya no se cambia.` });
    }
    if (!deps.repo) return reply.code(409).send({ error: 'En este arranque los pedidos no se pueden cambiar por la API.' });
    const patch: Record<string, unknown> = {};
    const cambios: string[] = [];
    for (const campo of ['nombre', 'direccion', 'distrito', 'notas'] as const) {
      const nuevo = b[campo];
      if (nuevo !== undefined && nuevo !== ((e as unknown as Record<string, unknown>)[campo] ?? '')) {
        patch[campo] = nuevo || null;
        cambios.push(`${campo} «${(e as unknown as Record<string, unknown>)[campo] ?? '—'}» → «${nuevo || '—'}»`);
      }
    }
    if (b.urgente !== undefined && (b.urgente ? 'urgente' : 'normal') !== (e.prioridad ?? 'normal')) {
      patch.prioridad = b.urgente ? 'urgente' : 'normal';
      cambios.push(b.urgente ? 'ahora es urgente' : 'ya no es urgente');
    }
    const datos = fusionarDatosEnvio(e.datosEnvio, datosEnvioDeCrudo(b));
    if (datos) {
      patch.datosEnvio = datos;
      cambios.push('datos del envío (producto, empresa, código, monto…) actualizados');
    }
    if (!cambios.length) return { ok: true, cambios: [], entrega: entregaParaApi(e), detalle: 'No había nada distinto: el pedido queda como estaba.' };
    await deps.repo.actualizar(e.id, patch as Parameters<EntregasRepo['actualizar']>[1]);
    const quien = request.usuario?.nombre ? `${request.usuario.nombre} (API)` : 'GSG (API)';
    await deps.repo.registrarEvento(e.id, 'sincronizada', `GSG cambió (${quien}): ${cambios.join('; ')}`, null, new Date());
    const fila = await porReferencia(request.params.referencia);
    return { ok: true, cambios, entrega: fila ? entregaParaApi(fila) : null, detalle: `Pedido ${e.referencia} cambiado: ${cambios.join('; ')}.` };
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
