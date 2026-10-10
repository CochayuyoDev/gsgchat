/**
 * GSG empuja: GSGchat nunca le pide nada a GSG. El sistema de GSG (o
 * cualquiera con una clave `entregas:gestionar`) manda los pedidos del dia
 * en cuanto los tiene, y pregunta o cancela por referencia. Cada pedido es
 * un ClienteGsg con dos banderas: `faltaUbicacion` y `faltaConfirmar`.
 *
 *  POST   /api/v1/entregas                 uno o varios pedidos (entregas:gestionar)
 *  GET    /api/v1/entregas/:referencia     como va ese pedido hoy (entregas:leer)
 *  PATCH  /api/v1/entregas/:referencia     cambiar nombre, direccion, distrito, notas, urgente, los datos del envio o corregir el telefono (entregas:gestionar)
 *  GET    /api/v1/reportados               los numeros y trackings malos que se le reportaron a GSG (entregas:leer)
 *  POST   /api/v1/reportados/:tracking/correccion   GSG corrige { telefono?, tracking? } (entregas:gestionar)
 *  GET    /api/v1/trackings?dia=AAAA-MM-DD  lo que ya se hizo por WhatsApp con cada tracking del dia (entregas:leer)
 *
 * Cada respuesta a POST/PATCH/correccion trae, por pedido, lo que ya se hizo
 * HOY por WhatsApp (`whatsapp`: ya_contactado, agrupado_con, ubicacion_pedida...).
 * Solo cuenta el mismo dia: el mismo cliente otro dia es un intento nuevo.
 *
 * Cada pedido puede traer los datos del envio que salen en el primer mensaje
 * al cliente: producto, empresa {codigo, nombre}, tracking, nroPedido,
 * metodoPago, monto y remitente (ver src/entregas/datos-envio.ts).
 *  DELETE /api/v1/entregas/:referencia     cancelarlo (entregas:gestionar)
 *  POST   /api/v1/seguimiento              GSG empuja el seguimiento de un tracking (entregas:gestionar)
 *
 * Cada clave tiene un tope de LIMITE_POR_MINUTO peticiones por minuto a estas
 * rutas: pasado, 429 con cuanto esperar (un bucle mal hecho en GSG no puede
 * tumbar el reparto).
 *
 * Lo que pasa despues lo cuentan los webhooks `entrega.confirmada`,
 * `entrega.avisada`, `entrega.entregada` y `entrega.incidencia` (ver
 * src/eventos/bus.ts) y la cola de reportes hacia GSG. El contrato entero,
 * en `/api/v1/openapi.json`.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ServicioEntregas, FilaEntrega } from '../../entregas/servicio.js';
import type { EntregasRepo } from '../../entregas/repo.js';
import type { ActividadRepo } from '../../auth/actividad.js';
import { datosEnvioDeCrudo, empresaEnTexto, fusionarDatosEnvio } from '../../entregas/datos-envio.js';
import { horarioGsgSchema } from '../../entregas/seguimiento-gsg.js';
import { vistaMensaje, type VistaMensaje } from '../../entregas/primer-mensaje.js';
import { enviarError, esBaseNoDisponible, ESPERA_BASE_SEGUNDOS, type CodigoError, type DetalleCampo } from '../errores.js';
import { avisosParaApi, reportadoParaApi, TEXTOS_REPORTADOS, type ErrorReportado, type ReportadosRepo } from '../../entregas/reportados.js';
import type { Entrega } from '../../entregas/repo.js';

export interface ApiEntregasGsgDeps {
  entregas: ServicioEntregas;
  /** Bitácora de peticiones entrantes desde GSG/Postman. */
  actividad?: ActividadRepo;
  /** El repo, para marcar la prioridad sin pasar por la pantalla. */
  repo?: EntregasRepo;
  /** La bandeja de numeros reportados a GSG (ver src/entregas/reportados.ts). */
  reportados?: ReportadosRepo;
  /** Peticiones por minuto y por clave (por defecto LIMITE_POR_MINUTO). */
  limitePorMinuto?: number;
  ahora?: () => number;
}

/** Tope por clave y minuto en /api/v1/entregas*. GSG manda en tandas de hasta 600 por llamada. */
export const LIMITE_POR_MINUTO = 120;

function referenciasDeEntrada(body: unknown): { total: number; referencias: string[] } {
  const pedidos = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { pedidos?: unknown }).pedidos)
      ? (body as { pedidos: unknown[] }).pedidos
      : body && typeof body === 'object' ? [body] : [];
  const referencias = pedidos.slice(0, 100).flatMap((pedido) => {
    if (!pedido || typeof pedido !== 'object') return [];
    const p = pedido as Record<string, unknown>;
    const valor = p.referencia ?? p.tracking ?? p.codigoTracking ?? p.id;
    return typeof valor === 'string' || typeof valor === 'number' ? [String(valor).slice(0, 120)] : [];
  });
  return { total: pedidos.length, referencias };
}

const textoOpc = z.union([z.string().max(200), z.number()]).nullable().optional();

/**
 * Los datos del envio que salen en el primer mensaje al cliente. Todos
 * opcionales; la empresa (tienda que vende) va como {codigo, nombre} o en
 * campos sueltos. Ver datosEnvioDeCrudo.
 */
export const CAMPOS_DATOS_ENVIO = {
  horarioEntrega: horarioGsgSchema.nullable().optional(),
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
  const tracking = p.tracking ?? p.codigoTracking ?? p.referencia;
  return { ...p, referencia: p.referencia ?? tracking, tracking,
    nombre: p.nombre ?? p.cliente, monto: p.monto ?? p.montoCobrar };
};

/** Texto obligatorio: no vale vacio ni solo espacios. */
const obligatorio = (max: number) => z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(z.string().min(1, 'no puede ir vacío').max(max));

/** Caracteres de control (saltos de linea, tabuladores...): un tracking con ellos no vale. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Por que un tracking no vale, o null si vale. */
export function trackingNoValido(valor: unknown): 'tracking_falta' | 'tracking_invalido' | null {
  if (valor === undefined || valor === null || (typeof valor === 'string' && !valor.trim())) return 'tracking_falta';
  if (typeof valor !== 'string' && typeof valor !== 'number') return 'tracking_invalido';
  const t = String(valor).trim();
  return t.length > 60 || CONTROL.test(t) ? 'tracking_invalido' : null;
}

/**
 * Un pedido de GSG Courier. Lo que GSG manda siempre (obligatorio): tracking,
 * cliente, telefono, empresa, metodoPago y montoCobrar. Opcionales: distrito,
 * direccion, fecRuta, telefono2, producto y cantBultos. Los demas campos de
 * antes (costServ, sede, agencia...) se siguen aceptando para no romper a
 * quien ya los manda, pero no son parte del contrato. Ver /api/v1/openapi.json.
 */
export const pedidoSchema = z.object({
  ...CAMPOS_DATOS_ENVIO,
  referencia: z.string().trim().min(1).max(60),
  tracking: obligatorio(60).refine((t) => !CONTROL.test(t), 'tiene caracteres no válidos'),
  nombre: obligatorio(120),
  // Un telefono malo no tumba la llamada entera: se descarta ese pedido con su motivo.
  telefono: obligatorio(30),
  empresa: z.union([
    z.object({ codigo: textoOpc, nombre: textoOpc }).passthrough().refine((e) => String(e.codigo ?? '').trim() || String(e.nombre ?? '').trim(), 'lleva al menos el código o el nombre'),
    obligatorio(200),
  ]),
  metodoPago: obligatorio(200),
  monto: z.union([z.number().nonnegative('no puede ser negativo'), z.string().trim().regex(/^\d+(?:[.,]\d{1,2})?$/, 'tiene que ser un número (por ejemplo 45.50)')]),
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

/** El nombre del campo tal como lo manda GSG (para que el error diga lo que ellos escriben). */
const CAMPO_GSG: Record<string, string> = { nombre: 'cliente', monto: 'montoCobrar' };

/** Uno, una lista, o { pedidos: [...] }. Con todos los fallos de todos los pedidos, campo por campo. */
export function leerCuerpo(body: unknown): Pedido[] | { error: string; detalles: DetalleCampo[] } {
  const esObjeto = Boolean(body) && typeof body === 'object' && !Array.isArray(body);
  const envuelto = esObjeto && Array.isArray((body as { pedidos?: unknown }).pedidos);
  const lista = Array.isArray(body) ? body : envuelto ? (body as { pedidos: unknown[] }).pedidos : esObjeto ? [body] : [];
  if (!lista.length) return { error: 'Manda un pedido ({tracking, cliente, telefono, empresa, metodoPago, montoCobrar, ...}), una lista de pedidos, o {pedidos: [...]}.', detalles: [{ campo: 'cuerpo', mensaje: 'vacío' }] };
  if (lista.length > 600) return { error: 'Como mucho 600 pedidos por llamada.', detalles: [{ campo: 'pedidos', mensaje: `llegaron ${lista.length}` }] };
  const pedidos: Pedido[] = [];
  const detalles: DetalleCampo[] = [];
  for (const [i, p] of lista.entries()) {
    const prefijo = lista.length > 1 || envuelto || Array.isArray(body) ? `pedidos[${i}].` : '';
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      detalles.push({ campo: prefijo.replace(/\.$/, '') || 'cuerpo', mensaje: 'tiene que ser un objeto' });
      continue;
    }
    const normalizado = normalizarPedidoGsg(p) as Record<string, unknown>;
    const identificador = (valor: unknown, max: number) => typeof valor === 'string' || typeof valor === 'number' ? String(valor).trim().slice(0, max) || null : null;
    const identidad = { pedido: i + 1, cliente: identificador(normalizado.nombre, 120), tracking: identificador(normalizado.tracking, 60) };
    const r = pedidoSchema.safeParse(normalizado);
    if (!r.success) {
      for (const issue of r.error.issues) {
        const [primero, ...resto] = issue.path.map(String);
        const campo = primero === 'referencia' ? 'tracking' : CAMPO_GSG[primero ?? ''] ?? primero ?? 'cuerpo';
        const valor = primero ? normalizado[primero] : undefined;
        const falta = !resto.length && (valor === undefined || valor === null || (typeof valor === 'string' && !valor.trim()));
        const mensaje = falta ? 'falta (es obligatorio)' : issue.code === 'invalid_union' ? 'no tiene el formato esperado' : issue.message;
        if (!detalles.some((d) => d.campo === `${prefijo}${[campo, ...resto].join('.')}`)) detalles.push({ campo: `${prefijo}${[campo, ...resto].join('.')}`, mensaje, ...identidad });
      }
      continue;
    }
    pedidos.push(r.data);
  }
  if (detalles.length) {
    const grupos = new Map<number, DetalleCampo[]>();
    for (const d of detalles) {
      const numero = d.pedido ?? Number(d.campo.match(/^pedidos\[(\d+)\]/)?.[1] ?? 0) + 1;
      grupos.set(numero, [...(grupos.get(numero) ?? []), d]);
    }
    const resumen = [...grupos.entries()].slice(0, 3).map(([numero, fallos]) => {
      const primero = fallos[0]!;
      const quien = [primero.cliente && `cliente "${primero.cliente}"`, primero.tracking && `tracking "${primero.tracking}"`].filter(Boolean).join(', ') || `pedido ${numero}`;
      return `${quien}: ${fallos.map((d) => `${d.campo.replace(/^pedidos\[\d+\]\./, '')} ${d.mensaje}`).join('; ')}`;
    }).join(' | ');
    return { error: `${resumen}${grupos.size > 3 ? ' | Consulta los demás pedidos en detalles' : ''}. No se guardó ninguno.`, detalles };
  }
  return pedidos;
}

/** Los pedidos tal como llegaron (uno, lista o { pedidos }), ya con los nombres de GSG normalizados. */
function pedidosCrudos(body: unknown): Record<string, unknown>[] {
  const esObjeto = Boolean(body) && typeof body === 'object' && !Array.isArray(body);
  const lista = Array.isArray(body) ? body : esObjeto && Array.isArray((body as { pedidos?: unknown }).pedidos) ? (body as { pedidos: unknown[] }).pedidos : esObjeto ? [body] : [];
  return lista.slice(0, 600).filter((p) => p && typeof p === 'object' && !Array.isArray(p)).map((p) => normalizarPedidoGsg(p) as Record<string, unknown>);
}

const textoDe = (v: unknown): string | null => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, 191) || null : null);

/** Como va un pedido, para otro sistema: sin ids internos de mas, con la situacion en palabras. */
export function entregaParaApi(e: FilaEntrega): Record<string, unknown> {
  return {
    referencia: e.referencia,
    // El id de este sistema (el de la base). El de GSG, si lo mandaron, va en idExterno.
    id: e.id,
    idExterno: e.externoId ?? null,
    dia: e.dia,
    telefono: e.phone,
    nombre: e.nombre,
    direccion: e.direccion,
    distrito: e.distrito,
    horarioEntrega: e.datosEnvio?.horarioEntregaDesde && e.datosEnvio?.horarioEntregaHasta ? { desde: e.datosEnvio.horarioEntregaDesde, hasta: e.datosEnvio.horarioEntregaHasta, ...(e.datosEnvio.horarioEntregaFechaDesde ? { fechaDesde: e.datosEnvio.horarioEntregaFechaDesde, fechaHasta: e.datosEnvio.horarioEntregaFechaHasta, zonaHoraria: e.datosEnvio.horarioEntregaZonaHoraria } : {}) } : null,
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
    ubicacion: {
      estado: e.ubicacionEstado,
      lat: e.lat,
      lng: e.lng,
      mapa: e.mapsUrl,
      recibidaEn: e.ubicacionAt ? e.ubicacionAt.toISOString() : null,
      // El cliente la cambió (pidió cambiarla y mandó otra): cuándo, cuántas veces y la de antes.
      cambiada: Boolean(e.ubicacionCambiadaAt),
      cambiadaEn: e.ubicacionCambiadaAt ? e.ubicacionCambiadaAt.toISOString() : null,
      cambios: e.ubicacionCambios ?? 0,
      anterior: e.ubicacionAnteriorLat != null && e.ubicacionAnteriorLng != null ? { lat: e.ubicacionAnteriorLat, lng: e.ubicacionAnteriorLng } : null,
    },
    confirmacion: { estado: e.confirmacionEstado, intentos: e.confirmacionIntentos, respuesta: e.confirmacionRespuesta, como: e.confirmacionComo, en: e.confirmacionAt ? e.confirmacionAt.toISOString() : null },

    entregadaEn: e.entregadaAt ? e.entregadaAt.toISOString() : null,
    entregadaComo: e.entregadaComo,
    incidencia: e.incidencia ? { codigo: e.incidencia, detalle: e.incidenciaDetalle } : null,
    // El primer mensaje al cliente, aparte del pedido: si falló, el pedido sigue guardado.
    mensaje: vistaMensaje(e),
  };
}

export async function registerApiEntregasGsg(app: FastifyInstance, deps: ApiEntregasGsgDeps): Promise<void> {
  const { entregas } = deps;
  const ahora = deps.ahora ?? (() => Date.now());
  const tope = deps.limitePorMinuto ?? LIMITE_POR_MINUTO;
  const usos = new Map<string, number[]>();

  // Historial de recepción: /panel#historial muestra tanto intentos de
  // WhatsApp como las llamadas entrantes a esta API. Solo se guardan códigos,
  // cantidades, referencias y errores; nunca teléfonos, tokens ni el JSON entero.
  const actividad = deps.actividad;
  if (actividad) {
    app.addHook('onSend', async (request, reply, payload) => {
      if (request.method !== 'POST' || (request.url.split('?')[0] ?? '') !== '/api/v1/entregas') return payload;
      try {
        const entrada = referenciasDeEntrada(request.body);
        const texto = typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('utf8') : '';
        let salida: Record<string, unknown> = {};
        try { salida = JSON.parse(texto) as Record<string, unknown>; } catch { /* respuesta no JSON */ }
        const creadas = Array.isArray(salida.creadas) ? salida.creadas : [];
        const repetidas = Array.isArray(salida.repetidas) ? salida.repetidas : [];
        const descartadas = Array.isArray(salida.descartadas) ? salida.descartadas : [];
        const error = typeof salida.error === 'string' ? salida.error.slice(0, 800) : null;
        const usuario = request.usuario;
        await actividad.anotar({
          usuarioId: usuario?.id ?? null,
          usuario: usuario?.nombre ?? 'API/Postman',
          accion: 'gsg.api.recepcion',
          ip: request.ip || null,
          detalle: {
            metodo: request.method,
            ruta: '/api/v1/entregas',
            http: reply.statusCode,
            estado: reply.statusCode >= 400 ? 'error' : reply.statusCode === 200 ? 'repetido' : 'recibido',
            recibidas: entrada.total,
            referencias: entrada.referencias,
            referenciasRestantes: Math.max(0, entrada.total - entrada.referencias.length),
            creadas: creadas.length,
            repetidas: repetidas.length,
            descartadas: descartadas.length,
            error,
            detalles: Array.isArray(salida.detalles) ? salida.detalles.slice(0, 12) : undefined,
          },
        });
      } catch (error) {
        request.log.warn({ err: error }, 'no se pudo guardar la recepción de GSG en el historial');
      }
      return payload;
    });
  }

  app.get('/admin/gsg/recepciones', async () => {
    if (!deps.actividad) return { items: [] };
    return deps.actividad.listar({ accion: 'gsg.api.recepcion', limit: 100, offset: 0 });
  });

  // El tope por clave: se mira antes que nada (tras la autorizacion).
  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/entregas')) return;
    const quien = request.usuario?.id ?? request.ip;
    const t = ahora();
    const lista = (usos.get(quien) ?? []).filter((x) => x > t - 60_000);
    if (lista.length >= tope) {
      const espera = Math.max(1, Math.ceil((lista[0]! + 60_000 - t) / 1000));
      reply.header('retry-after', String(espera));
      return enviarError(reply, 429, 'DEMASIADAS_PETICIONES', `Demasiadas peticiones con esta clave: como mucho ${tope} por minuto. Espera ${espera} s y vuelve a intentarlo.`, { limitePorMinuto: tope, esperaSegundos: espera });
    }
    lista.push(t);
    usos.set(quien, lista);
  });

  // Directo a la base (no por el resumen de Hoy, que tiene tope): un pedido de
  // hoy por su referencia o por el id de GSG.
  const porReferencia = async (referencia: string): Promise<FilaEntrega | undefined> => {
    const ref = referencia.trim().toLowerCase();
    if (!ref) return undefined;
    if (deps.repo) {
      const dia = entregas.diaDeHoy();
      const e = (await deps.repo.listar({ dia, q: ref, limit: 50 })).find((x) => x.referencia.toLowerCase() === ref)
        ?? (await deps.repo.listar({ dia, limit: 5000 })).find((x) => String(x.externoId ?? '').toLowerCase() === ref);
      return e ? (await entregas.entrega(e.id))?.entrega : undefined;
    }
    const r = await entregas.resumen();
    return r.entregas.find((e) => e.referencia.toLowerCase() === ref || String(e.externoId ?? '').toLowerCase() === ref);
  };

  const noExiste = (reply: FastifyReply, referencia: string) => enviarError(reply, 404, 'NO_EXISTE', `No hay ningún pedido de hoy con la referencia "${referencia}".`);

  type Descartada = { referencia: string; motivo: string; indice: number; error?: ErrorReportado };
  type Salida = { status: number; body: Record<string, unknown>; headers?: Record<string, string> } | { status: number; error: { codigo: CodigoError; mensaje: string; detalles?: unknown }; headers?: Record<string, string> };

  /** Reporta a GSG un numero o tracking malo de un pedido que mando (una vez por tracking + error). */
  const reportar = async (error: ErrorReportado, p: Record<string, unknown>, detalle?: string | null, entregaId?: number | null): Promise<void> => {
    await entregas.reportarNumero({ error, tracking: textoDe(p.tracking), referencia: textoDe(p.referencia), telefono: textoDe(p.telefono), detalle: detalle ?? null, entregaId: entregaId ?? null, pedido: p }).catch(() => undefined);
  };

  /** Lo que ya se hizo hoy por WhatsApp con esos pedidos (por id). */
  const whatsappDe = async (ids: number[]): Promise<Record<string, unknown>[]> => {
    if (!ids.length) return [];
    try {
      return (await entregas.fichasTrackings(entregas.diaDeHoy(), ids)).map(avisosParaApi);
    } catch {
      return [];
    }
  };

  /**
   * Una llamada de GSG con sus pedidos ya validados: los guarda (o reconoce
   * los que ya estaban) y reporta los numeros y trackings malos. Es lo mismo
   * para POST /api/v1/entregas y para la correccion de un reportado que no se
   * llego a guardar.
   */
  async function recibirPedidos(lectura: Pedido[], quien: string, log: { error(o: unknown, m: string): void }): Promise<Salida> {
    const creadas: Array<{ referencia: string; id: number; urgente?: boolean }> = [];
    const repetidas: string[] = [];
    const descartadas: Descartada[] = [];
    const indiceDe = new Map(lectura.map((p, i) => [p, i]));

    // Antes de guardar: el tracking repetido en la llamada con otro telefono,
    // el tracking que ya es de otro pedido de hoy y el telefono de un
    // motorizado. No se guardan y se le reportan a GSG.
    const aceptados: Pedido[] = [];
    const vistos = new Map<string, string>();
    const delDia: Entrega[] = deps.repo ? await deps.repo.listar({ dia: entregas.diaDeHoy(), limit: 5000 }).catch(() => [] as Entrega[]) : [];
    for (const p of lectura) {
      const crudo = p as unknown as Record<string, unknown>;
      const phone = entregas.normalizarTelefono(String(p.telefono));
      const tracking = String(p.tracking).trim();
      const k = tracking.toLowerCase();
      const descartar = async (error: ErrorReportado, detalle: string) => {
        descartadas.push({ referencia: p.referencia, motivo: `${TEXTOS_REPORTADOS[error].titulo}: ${detalle}`, indice: indiceDe.get(p) ?? 0, error });
        await reportar(error, crudo, detalle);
      };
      if (vistos.has(k)) {
        if (phone && vistos.get(k) && vistos.get(k) !== phone) {
          await descartar('tracking_duplicado', `el tracking ${tracking} vino dos veces en la misma llamada con teléfonos distintos`);
          continue;
        }
        aceptados.push(p);
        continue;
      }
      vistos.set(k, phone ?? '');
      if (!phone) {
        aceptados.push(p);
        continue;
      }
      const otro = delDia.find((e) => e.estado !== 'cancelada' && e.phone !== phone && (e.referencia.toLowerCase() === p.referencia.toLowerCase() || String(e.datosEnvio?.tracking ?? '').toLowerCase() === k));
      if (otro) {
        await descartar('tracking_de_otro_pedido', `el tracking ${tracking} ya es del pedido ${otro.referencia} de hoy, con otro teléfono`);
        continue;
      }
      if (deps.repo && (await deps.repo.motorizadoPorTelefono(phone).catch(() => null))) {
        await descartar('telefono_de_motorizado', `el ${phone} está registrado como motorizado`);
        continue;
      }
      aceptados.push(p);
    }

    // Sin pin: todos juntos en un solo lote del reparto (le pide la ubicacion a
    // cada uno con su ritmo). Con pin: uno a uno, ya con su ubicacion puesta.
    const sinPin = aceptados.filter((p) => !(typeof p.lat === 'number' && typeof p.lng === 'number'));
    const conPin = aceptados.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
    const urgentes = new Set(aceptados.filter((p) => p.urgente).map((p) => p.referencia.trim().toLowerCase()));
    const externo = (p: Pedido) => (p.id === null || p.id === undefined || p.id === '' ? null : String(p.id));
    const telefonoMalo = async (p: Pedido, motivo: string) => {
      if (/tel[eé]fono inv[aá]lido/i.test(motivo)) await reportar('telefono_invalido', p as unknown as Record<string, unknown>, motivo);
    };

    try {
      if (sinPin.length) {
        const filas = sinPin.map((p) => ({ telefono: p.telefono, nombre: p.nombre ?? undefined, referencia: p.referencia, direccion: p.direccion ?? undefined, distrito: p.distrito ?? undefined, notas: p.notas ?? undefined, faltaUbicacion: p.faltaUbicacion ?? true, faltaConfirmacion: p.faltaConfirmar ?? false, datosEnvio: datosEnvioDeCrudo(p), externoId: externo(p) }));
        // La lista de GSG espera que una persona confirme el envío (ajuste de Hoy).
        const r = await entregas.crearVarias(filas, quien, { retener: true });
        for (const d of r.descartadas) {
          const p = sinPin[d.linea - 1];
          const malo = /tel[eé]fono inv[aá]lido/i.test(d.motivo);
          descartadas.push({ referencia: p?.referencia ?? d.texto, motivo: d.motivo, indice: p ? (indiceDe.get(p) ?? d.linea - 1) : d.linea - 1, ...(malo ? { error: 'telefono_invalido' as const } : {}) });
          if (p) await telefonoMalo(p, d.motivo);
        }
        for (const rep of r.repetidas) if (!repetidas.includes(rep)) repetidas.push(rep);
        for (const e of r.creadas) creadas.push({ referencia: e.referencia, id: e.id });
      }
      for (const p of conPin) {
        const r = await entregas.crearAMano({ referencia: p.referencia, telefono: p.telefono, nombre: p.nombre ?? undefined, direccion: p.direccion ?? undefined, distrito: p.distrito ?? undefined, notas: p.notas ?? undefined, faltaUbicacion: false, faltaConfirmacion: p.faltaConfirmar ?? false, lat: p.lat!, lng: p.lng!, datosEnvio: datosEnvioDeCrudo(p), retener: true, externoId: externo(p) }, quien);
        if (r.ok) creadas.push({ referencia: r.entrega.referencia, id: r.entrega.id });
        else if (/ya existe/i.test(r.motivo)) {
          if (!repetidas.includes(p.referencia)) repetidas.push(p.referencia);
          // Espejo: los datos del envio nuevos de un pedido que ya estaba se guardan.
          const ya = deps.repo ? await porReferencia(p.referencia) : undefined;
          const datos = ya ? fusionarDatosEnvio(ya.datosEnvio, datosEnvioDeCrudo(p)) : null;
          if (ya && datos && deps.repo) await deps.repo.actualizar(ya.id, { datosEnvio: datos });
        } else {
          descartadas.push({ referencia: p.referencia, motivo: r.motivo, indice: indiceDe.get(p) ?? 0, ...(/tel[eé]fono/i.test(r.motivo) ? { error: 'telefono_invalido' as const } : {}) });
          await telefonoMalo(p, r.motivo);
        }
      }
      // Los urgentes van primero hacia el motorizado.
      if (deps.repo && urgentes.size) {
        for (const c of creadas) {
          if (urgentes.has(c.referencia.toLowerCase())) {
            await deps.repo.actualizar(c.id, { prioridad: 'urgente' } as Parameters<EntregasRepo['actualizar']>[1]);
            c.urgente = true;
          }
        }
      }

      // Lo creado, leido otra vez de la base: si no esta, NO se contesta 201.
      const salida: Record<string, unknown>[] = [];
      for (const c of creadas) {
        const leida = await entregas.entrega(c.id);
        if (!leida) throw new Error(`el pedido ${c.referencia} (id ${c.id}) no aparece guardado tras crearlo`);
        salida.push(entregaParaApi(leida.entrega));
      }
      // Los que ya estaban: con su id, para que quien reintenta sepa que ya quedaron.
      const existentes: Array<{ referencia: string; id: number | null }> = [];
      for (const ref of repetidas) existentes.push({ referencia: ref, id: (await porReferencia(ref))?.id ?? null });

      if (!creadas.length && !repetidas.length) {
        return { status: 400, error: { codigo: 'VALIDACION', mensaje: `Ningún pedido se pudo guardar: ${descartadas.map((d) => `${d.referencia} (${d.motivo})`).join('; ')}.`,
          detalles: descartadas.map((d) => ({ campo: lectura.length > 1 ? `pedidos[${d.indice}].${d.error?.startsWith('tracking') ? 'tracking' : 'telefono'}` : d.error?.startsWith('tracking') ? 'tracking' : 'telefono', mensaje: d.motivo, ...(d.error ? { error: d.error } : {}) })) } };
      }
      // Lo que ya se hizo hoy por WhatsApp con cada uno (para no volver a escribirle).
      const whatsapp = await whatsappDe([...creadas.map((c) => c.id), ...existentes.flatMap((x) => (x.id ? [x.id] : []))]);
      // El pedido se guardo aunque su primer mensaje no haya salido: eso va aparte.
      const conAviso = salida.filter((e) => {
        const m = e.mensaje as VistaMensaje;
        return m.estado === 'reintentando' || m.estado === 'fallido' || m.estado === 'incierto';
      });
      return { status: creadas.length ? 201 : 200, body: {
        ok: true,
        creadas: salida,
        repetidas,
        existentes,
        descartadas: descartadas.map(({ referencia, motivo, error }) => ({ referencia, motivo, ...(error ? { error } : {}) })),
        whatsapp,
        ...(conAviso.length ? { avisosMensaje: conAviso.map((e) => ({ referencia: e.referencia, id: e.id, estado: (e.mensaje as VistaMensaje).estado, motivo: (e.mensaje as VistaMensaje).motivo })) } : {}),
        detalle: `${creadas.length} pedido${creadas.length === 1 ? '' : 's'} nuevo${creadas.length === 1 ? '' : 's'}${repetidas.length ? `, ${repetidas.length} ya estaba${repetidas.length === 1 ? '' : 'n'}` : ''}${descartadas.length ? `, ${descartadas.length} descartado${descartadas.length === 1 ? '' : 's'}` : ''}.${conAviso.length ? ` ${conAviso.length} quedaron guardados pero su primer mensaje no salió (se reintenta o está en la bandeja de errores).` : ''}`,
      } };
    } catch (error) {
      log.error({ err: error }, 'no se pudieron guardar los pedidos de GSG');
      const yaGuardados = creadas.map((c) => c.referencia);
      if (esBaseNoDisponible(error)) {
        return { status: 503, headers: { 'retry-after': String(ESPERA_BASE_SEGUNDOS) }, error: { codigo: 'BASE_NO_DISPONIBLE', mensaje: 'La base de datos no responde ahora mismo. Repite la MISMA llamada en unos segundos: lo que ya se hubiera guardado se reconoce por su tracking y no se duplica.', detalles: { guardados: yaGuardados } } };
      }
      return { status: 500, error: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno al guardar los pedidos (quedó en el registro del servidor). Repite la MISMA llamada: lo ya guardado se reconoce por su tracking y no se duplica.', detalles: { guardados: yaGuardados } } };
    }
  }

  const responder = (reply: FastifyReply, r: Salida) => {
    for (const [k, v] of Object.entries(r.headers ?? {})) reply.header(k, v);
    if ('error' in r) return enviarError(reply, r.status, r.error.codigo, r.error.mensaje, r.error.detalles as DetalleCampo[] | undefined);
    return reply.code(r.status).send(r.body);
  };

  /** La llamada no paso la validacion: los trackings y telefonos malos igual se le reportan a GSG. */
  const reportarDeValidacion = async (body: unknown): Promise<void> => {
    for (const p of pedidosCrudos(body)) {
      const t = trackingNoValido(p.tracking);
      if (t) await reportar(t, p, t === 'tracking_falta' ? 'el pedido llegó sin tracking' : `tracking recibido: ${JSON.stringify(p.tracking).slice(0, 120)}`);
      const tel = p.telefono;
      if (tel === undefined || tel === null || !entregas.normalizarTelefono(String(tel))) await reportar('telefono_invalido', p, tel === undefined || tel === null || !String(tel).trim() ? 'el pedido llegó sin teléfono' : `teléfono recibido: ${String(tel).slice(0, 40)}`);
    }
  };

  app.post('/api/v1/entregas', { config: { permiso: 'entregas:gestionar' } }, async (request, reply) => {
    const lectura = leerCuerpo(request.body);
    if ('error' in lectura) {
      await reportarDeValidacion(request.body);
      return enviarError(reply, 400, 'VALIDACION', lectura.error, lectura.detalles);
    }
    const quien = request.usuario?.nombre ? `${request.usuario.nombre} (API)` : 'GSG (API)';
    return responder(reply, await recibirPedidos(lectura, quien, request.log));
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

  // GSG cambia datos de un pedido ya mandado: lo mismo que hace
  // `recibirListaGsg` (src/entregas/servicio.ts) con una lista, pero empujado. Queda apuntado en
  // la bitacora del pedido. El telefono no se cambia aqui: es otro pedido
  // (cancelar y crear), porque al numero viejo ya se le pudo escribir.
  app.patch<{ Params: { referencia: string } }>('/api/v1/entregas/:referencia', { config: { permiso: 'entregas:gestionar' } }, async (request, reply) => {
    const leido = cambioPedidoSchema.safeParse(request.body ?? {});
    if (!leido.success) {
      const i = leido.error.issues[0];
      return enviarError(reply, 400, 'VALIDACION', `El cambio no se entiende: ${i ? `${i.path.join('.') || 'cuerpo'}: ${i.message}` : 'revisa los campos'}. Se puede cambiar nombre, direccion, distrito, notas, urgente, los datos del envío (producto, empresa, tracking, nroPedido, metodoPago, monto, remitente).`, leido.error.issues.map((x) => ({ campo: x.path.join('.') || 'cuerpo', mensaje: x.message })));
    }
    const b = leido.data;
    if (b.telefono !== undefined && typeof b.telefono !== 'string' && typeof b.telefono !== 'number') return enviarError(reply, 400, 'VALIDACION', 'El teléfono corregido tiene que ser un texto (por ejemplo "987654321").', [{ campo: 'telefono', mensaje: 'no tiene el formato esperado' }]);
    let e = await porReferencia(request.params.referencia);
    if (!e) return noExiste(reply, request.params.referencia);
    if (e.estado === 'cancelada' || e.estado === 'entregada' || e.estado === 'terminada') {
      return enviarError(reply, 409, 'CONFLICTO', `El pedido ${e.referencia} ya está ${e.estado === 'cancelada' ? 'cancelado' : e.estado === 'entregada' ? 'entregado' : 'terminado'}: ya no se cambia.`);
    }
    if (!deps.repo) return enviarError(reply, 409, 'CONFLICTO', 'En este arranque los pedidos no se pueden cambiar por la API.');
    const quien = request.usuario?.nombre ? `${request.usuario.nombre} (API)` : 'GSG (API)';
    const trackingAntes = e.datosEnvio?.tracking ?? e.referencia;
    const cambios: string[] = [];
    // GSG corrige el telefono (un numero reportado): se cambia y, si falta la
    // ubicacion, se le pide al numero nuevo por el flujo normal.
    let telefonoCorregido: string | null = null;
    if (b.telefono !== undefined) {
      const r = await entregas.corregirTelefono(e.id, String(b.telefono), quien);
      if (!r.ok) {
        if (r.codigo === 'telefono_invalido' || r.codigo === 'telefono_de_motorizado') await reportar(r.codigo, { tracking: trackingAntes, referencia: e.referencia, telefono: String(b.telefono) }, r.motivo, e.id);
        return enviarError(reply, r.codigo === 'cerrada' ? 409 : 400, r.codigo === 'cerrada' ? 'CONFLICTO' : 'VALIDACION', `No se corrigió el teléfono: ${r.motivo}.`, [{ campo: 'telefono', mensaje: r.motivo }]);
      }
      if (r.cambiado) {
        telefonoCorregido = r.entrega.phone;
        cambios.push(`teléfono corregido → ${r.entrega.phone}`);
        e = (await porReferencia(request.params.referencia)) ?? e;
      }
    }
    const patch: Record<string, unknown> = {};
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
    if (!cambios.length) return { ok: true, cambios: [], entrega: entregaParaApi(e), whatsapp: await whatsappDe([e.id]), detalle: 'No había nada distinto: el pedido queda como estaba.' };
    if (Object.keys(patch).length) await deps.repo.actualizar(e.id, patch as Parameters<EntregasRepo['actualizar']>[1]);
    const otrosCambios = cambios.filter((c) => !c.startsWith('teléfono corregido'));
    if (otrosCambios.length) await deps.repo.registrarEvento(e.id, 'sincronizada', `GSG cambió (${quien}): ${otrosCambios.join('; ')}`, null, new Date());
    const fila = await porReferencia(request.params.referencia);
    // Lo reportado de este tracking queda corregido si cambio el telefono o el tracking.
    const trackingDespues = fila?.datosEnvio?.tracking ?? fila?.referencia ?? trackingAntes;
    const corregidos = deps.reportados && (telefonoCorregido || trackingDespues !== trackingAntes)
      ? await deps.reportados.marcarCorregidos(trackingAntes, { telefono: telefonoCorregido, tracking: trackingDespues !== trackingAntes ? trackingDespues : null, por: quien, via: 'PATCH /api/v1/entregas' }, new Date()).catch(() => [])
      : [];
    return { ok: true, cambios, entrega: fila ? entregaParaApi(fila) : null, corregidos: corregidos.map(reportadoParaApi), whatsapp: await whatsappDe([e.id]), detalle: `Pedido ${e.referencia} cambiado: ${cambios.join('; ')}.` };
  });

  // ------------------------------------------------ numeros reportados

  // La bandeja de GSG: lo que se le reporto y si ya lo corrigio. Sale de la
  // base (GSGchat no le pregunta nada a GSG).
  app.get('/api/v1/reportados', { config: { permiso: 'entregas:leer' } }, async (request, reply) => {
    const q = z.object({ estado: z.enum(['pendiente', 'corregido']).optional(), tracking: z.string().trim().max(191).optional(), limit: z.coerce.number().int().min(1).max(2000).optional() }).safeParse(request.query ?? {});
    if (!q.success) return enviarError(reply, 400, 'VALIDACION', '`estado` tiene que ser pendiente o corregido.', [{ campo: 'estado', mensaje: 'pendiente | corregido' }]);
    if (!deps.reportados) return { ok: true, total: 0, items: [] };
    const items = await deps.reportados.listar({ estado: q.data.estado, clave: q.data.tracking || undefined, limit: q.data.limit ?? 500 });
    return { ok: true, total: items.length, items: items.map(reportadoParaApi) };
  });

  // GSG corrige un reportado: el telefono, el tracking o los dos.
  const corregirReportado = async (request: FastifyRequest<{ Params: { tracking: string } }>, reply: FastifyReply) => {
    const leido = z.object({
      telefono: z.union([z.string().trim().min(1).max(30), z.number()]).transform(String).optional(),
      tracking: z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(z.string().min(1).max(60).refine((t) => !CONTROL.test(t), 'tiene caracteres no válidos')).optional(),
    }).strict().safeParse(request.body ?? {});
    if (!leido.success || (!leido.data.telefono && !leido.data.tracking)) {
      return enviarError(reply, 400, 'VALIDACION', 'Manda el teléfono corregido, el tracking corregido o los dos: { "telefono": "987654321", "tracking": "GSG-123" }.', leido.success ? [{ campo: 'cuerpo', mensaje: 'falta telefono o tracking' }] : leido.error.issues.map((i) => ({ campo: i.path.join('.') || 'cuerpo', mensaje: i.message })));
    }
    if (!deps.reportados) return enviarError(reply, 409, 'CONFLICTO', 'En este arranque no hay bandeja de números reportados.');
    const clave = request.params.tracking.trim();
    const b = leido.data;
    const pendientes = await deps.reportados.listar({ estado: 'pendiente', clave });
    if (!pendientes.length) {
      const todos = await deps.reportados.listar({ clave, limit: 1 });
      return todos.length
        ? enviarError(reply, 409, 'CONFLICTO', `Lo reportado del tracking "${clave}" ya está corregido.`)
        : enviarError(reply, 404, 'NO_EXISTE', `No hay nada reportado con el tracking "${clave}".`);
    }
    const quien = request.usuario?.nombre ? `${request.usuario.nombre} (API)` : 'GSG (API)';
    const ref = pendientes.find((x) => x.referencia)?.referencia ?? clave;
    let e = (await porReferencia(ref)) ?? (await porReferencia(clave));
    let trackingFinal = b.tracking ?? pendientes[0]!.tracking ?? clave;
    if (e && !['cancelada', 'entregada', 'terminada'].includes(e.estado)) {
      if (b.tracking && b.tracking.toLowerCase() !== String(e.datosEnvio?.tracking ?? e.referencia).toLowerCase()) {
        const delDia = deps.repo ? await deps.repo.listar({ dia: entregas.diaDeHoy(), limit: 5000 }) : [];
        const otro = delDia.find((x) => x.id !== e!.id && x.estado !== 'cancelada' && (x.referencia.toLowerCase() === b.tracking!.toLowerCase() || String(x.datosEnvio?.tracking ?? '').toLowerCase() === b.tracking!.toLowerCase()));
        if (otro) return enviarError(reply, 409, 'CONFLICTO', `El tracking "${b.tracking}" ya es del pedido ${otro.referencia} de hoy.`);
        if (deps.repo) {
          await deps.repo.actualizar(e.id, { datosEnvio: fusionarDatosEnvio(e.datosEnvio, datosEnvioDeCrudo({ tracking: b.tracking })) ?? e.datosEnvio });
          await deps.repo.registrarEvento(e.id, 'sincronizada', `${quien} corrigió el tracking: ${e.datosEnvio?.tracking ?? e.referencia} → ${b.tracking}`, null, new Date());
        }
      }
      if (b.telefono) {
        const r = await entregas.corregirTelefono(e.id, b.telefono, quien);
        if (!r.ok) {
          if (r.codigo === 'telefono_invalido' || r.codigo === 'telefono_de_motorizado') await reportar(r.codigo, { tracking: trackingFinal, referencia: e.referencia, telefono: b.telefono }, r.motivo, e.id);
          return enviarError(reply, 400, 'VALIDACION', `No se corrigió: ${r.motivo}.`, [{ campo: 'telefono', mensaje: r.motivo }]);
        }
      }
      e = (await porReferencia(e.referencia)) ?? e;
    } else {
      // No se llego a guardar (telefono invalido, de un motorizado, tracking
      // malo...): se crea ahora con lo corregido, por el camino de siempre.
      const pedido = pendientes.find((x) => x.pedido)?.pedido;
      if (!pedido) return enviarError(reply, 409, 'CONFLICTO', `No hay un pedido guardado para "${clave}": mándalo de nuevo con POST /api/v1/entregas.`);
      const original = pedido as Record<string, unknown>;
      const corregido: Record<string, unknown> = { ...original };
      if (b.telefono) corregido.telefono = b.telefono;
      if (b.tracking) {
        const refEraTracking = !original.referencia || String(original.referencia) === String(original.tracking ?? '');
        corregido.tracking = b.tracking;
        if (refEraTracking) corregido.referencia = b.tracking;
      }
      const lectura = leerCuerpo(corregido);
      if ('error' in lectura) return enviarError(reply, 400, 'VALIDACION', `La corrección no basta: ${lectura.error}`, lectura.detalles);
      const r = await recibirPedidos(lectura, quien, request.log);
      if ('error' in r) return responder(reply, r);
      const creadas = (r.body.creadas as Array<{ id: number }>) ?? [];
      const existentes = (r.body.existentes as Array<{ id: number | null }>) ?? [];
      if (!creadas.length && !existentes.some((x) => x.id)) {
        const d = (r.body.descartadas as Array<{ motivo: string }>)?.[0];
        return enviarError(reply, 400, 'VALIDACION', `No se corrigió: ${d?.motivo ?? 'el pedido no se pudo guardar'}.`);
      }
      trackingFinal = String(lectura[0]!.tracking);
      e = await porReferencia(lectura[0]!.referencia);
    }
    const corregidos = await deps.reportados.marcarCorregidos(clave, { telefono: b.telefono ?? null, tracking: b.tracking ?? null, por: quien, via: 'POST /api/v1/reportados/correccion' }, new Date());
    return {
      ok: true,
      tracking: trackingFinal,
      corregidos: corregidos.map(reportadoParaApi),
      entrega: e ? entregaParaApi(e) : null,
      whatsapp: e ? await whatsappDe([e.id]) : [],
      detalle: `Corregido: ${[b.telefono ? `teléfono ${b.telefono}` : '', b.tracking ? `tracking ${b.tracking}` : ''].filter(Boolean).join(' y ')}. ${e?.envioRetenidoAt ? 'Espera «Confirmar y enviar» en Pedidos GSG.' : e?.ubicacionEstado === 'pendiente' ? 'Se le pide la ubicación al número corregido.' : ''}`.trim(),
    };
  };
  app.post<{ Params: { tracking: string } }>('/api/v1/reportados/:tracking/correccion', { config: { permiso: 'entregas:gestionar' } }, corregirReportado);

  // Lo mismo para la pantalla (Pedidos GSG → Números reportados), con la sesión del panel.
  app.get('/admin/entregas/reportados', async (request, reply) => {
    const q = z.object({ estado: z.enum(['pendiente', 'corregido']).optional() }).safeParse(request.query ?? {});
    if (!q.success) return enviarError(reply, 400, 'VALIDACION', '`estado` tiene que ser pendiente o corregido.');
    const items = deps.reportados ? await deps.reportados.listar({ estado: q.data.estado, limit: 500 }) : [];
    return { ok: true, total: items.length, items: items.map(reportadoParaApi) };
  });
  app.post<{ Params: { tracking: string } }>('/admin/entregas/reportados/:tracking/correccion', corregirReportado);

  // El mapa de trackings de un dia: lo que ya se hizo por WhatsApp con cada
  // uno. GSG lo lee cuando quiere; GSGchat nunca se lo empuja.
  app.get('/api/v1/trackings', { config: { permiso: 'entregas:leer' } }, async (request, reply) => {
    const q = z.object({ dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).safeParse(request.query ?? {});
    if (!q.success) return enviarError(reply, 400, 'VALIDACION', '`dia` va como AAAA-MM-DD (por ejemplo 2026-10-10).', [{ campo: 'dia', mensaje: 'AAAA-MM-DD' }]);
    const dia = q.data.dia ?? entregas.diaDeHoy();
    const fichas = await entregas.fichasTrackings(dia);
    return { ok: true, dia, total: fichas.length, trackings: fichas };
  });

  app.delete<{ Params: { referencia: string } }>('/api/v1/entregas/:referencia', { config: { permiso: 'entregas:gestionar' } }, async (request, reply) => {
    const e = await porReferencia(request.params.referencia);
    if (!e) return noExiste(reply, request.params.referencia);
    if (e.estado === 'cancelada' || e.estado === 'entregada' || e.estado === 'terminada') {
      return enviarError(reply, 409, 'CONFLICTO', `El pedido ${e.referencia} ya está ${e.estado === 'cancelada' ? 'cancelado' : e.estado === 'entregada' ? 'entregado' : 'terminado'}: no se puede cancelar.`);
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

  // GSG empuja el seguimiento de un pedido (posicion del motorizado, punto
  // actual, punto del cliente y paradas). GSGchat nunca se lo pide: guarda el
  // ultimo de cada tracking y con el contesta al cliente mientras sea reciente.
  app.post('/api/v1/seguimiento', { config: { permiso: 'entregas:gestionar' } }, async (request, reply) => {
    const r = await entregas.recibirSeguimiento(request.body);
    if (!r.ok) return enviarError(reply, r.status, r.codigo, r.detalle, r.motivo ? { motivo: r.motivo } : undefined);
    return reply.code(201).send(r);
  });
}
