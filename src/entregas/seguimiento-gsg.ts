import { z } from 'zod';
import type { PuertoGsg } from '../rutas/gsg.js';

const punto = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(f => { const d = new Date(f); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === f; });
export const horarioGsgSchema = z.object({
  desde: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), hasta: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  fechaDesde: fecha.optional(), fechaHasta: fecha.optional(),
  zonaHoraria: z.string().max(80).refine(zona => { try { new Intl.DateTimeFormat('es', { timeZone: zona }); return true; } catch { return false; } }).optional(),
}).refine(h => h.fechaDesde || h.fechaHasta ? Boolean(h.fechaDesde && h.fechaHasta && h.zonaHoraria && `${h.fechaDesde}T${h.desde}` < `${h.fechaHasta}T${h.hasta}`) : h.desde < h.hasta, 'el horario debe terminar después de su inicio; un horario fechado necesita ambas fechas y zona horaria');
export const seguimientoGsgSchema = z.object({
  tracking: z.string().min(1),
  distrito: z.string().max(120).optional(),
  horario: horarioGsgSchema.optional(),
  estado: z.enum(['pendiente', 'en_reparto', 'llegando', 'entregado', 'cancelado', 'incidencia']).default('en_reparto'),
  versionRuta: z.string().min(1).optional(),
  secuenciaCompleta: z.boolean().default(false),
  posicion: punto.extend({ actualizadaAt: z.string().datetime() }).optional(),
  puntoActual: z.number().int().nonnegative().optional(),
  puntoCliente: z.number().int().positive().optional(),
  // Solo las paradas que faltan, en el orden definido por GSG, hasta el cliente.
  paradas: z.array(punto.extend({ orden: z.number().int().positive(), servicioMinutos: z.number().min(0).max(120).optional() })).max(100).default([]),
});
export type SeguimientoGsg = z.infer<typeof seguimientoGsgSchema>;
export interface DistanciaRuta { km: number; minutos: number; soloConduccion?: boolean }
export type CalcularRuta = (ruta: SeguimientoGsg) => Promise<DistanciaRuta | null>;
export interface FalloSeguimiento { proveedor: 'gsg' | 'google'; codigo: string; detalle: string }

export async function consultarSeguimiento(gsg: PuertoGsg, tracking: string, calcular?: CalcularRuta, ahora = new Date(), diagnosticar?: (fallo: FalloSeguimiento) => void): Promise<{ ruta: SeguimientoGsg; distancia: DistanciaRuta | null } | null> {
  const fallo = (codigo: string, detalle: string): null => { diagnosticar?.({ proveedor: 'gsg', codigo, detalle }); return null; };
  if (!gsg.conectado()) return fallo('sin_configurar', 'Falta configurar la conexión de GSG.');
  try {
    const r = await gsg.consultar(`/reparto/seguimiento/${encodeURIComponent(tracking)}`);
    const leido = seguimientoGsgSchema.safeParse(r.cuerpo);
    if (!r.ok) return fallo(r.status === 401 || r.status === 403 ? 'autenticacion' : r.status === 404 ? 'sin_tracking' : r.status === 429 ? 'cuota' : r.status ? 'http_' + r.status : 'red_o_timeout', `Consulta de GSG fallida${r.status ? ` (HTTP ${r.status})` : ' por red o tiempo de espera'}.`);
    if (!leido.success) return fallo('contrato', 'La respuesta de GSG no cumple el contrato de seguimiento.');
    const ruta = leido.data;
    if (ruta.tracking !== tracking) return fallo('tracking_incorrecto', 'GSG respondió con otro tracking.');
    if (ruta.estado !== 'en_reparto') return { ruta, distancia: null };
    if (!ruta.posicion || ruta.puntoActual == null || ruta.puntoCliente == null) return fallo('ruta_incompleta', 'Faltan posición o puntos de reparto.');
    const edad = ahora.getTime() - new Date(ruta.posicion.actualizadaAt).getTime();
    if (edad > 10 * 60_000 || edad < -60_000) return fallo('gps_antiguo', 'La posición no es reciente o tiene una fecha futura inválida.');
    if (ruta.puntoActual > ruta.puntoCliente) return fallo('ruta_incoherente', 'El punto del cliente ya quedó atrás sin un estado de entrega coherente.');
    if (ruta.puntoActual === ruta.puntoCliente) return { ruta: { ...ruta, estado: 'llegando' }, distancia: null };
    const ordenes = ruta.paradas.map(p => p.orden);
    const actual = ruta.puntoActual;
    if (!ordenes.length || ordenes.at(-1) !== ruta.puntoCliente || ordenes.some((p,i) => p <= (i ? ordenes[i-1]! : actual))) return fallo('ruta_incoherente', 'Las paradas están fuera de orden o falta el destino.');
    if (!ruta.secuenciaCompleta && (ordenes.length !== ruta.puntoCliente - actual || ordenes.some((p,i) => p !== actual + i + 1))) return fallo('ruta_incompleta', 'Hay huecos sin declaración de secuencia completa.');
    const distancia = calcular ? await calcular(ruta).catch(() => null) : null;
    if (calcular && !distancia) diagnosticar?.({ proveedor: 'google', codigo: 'ruta_no_disponible', detalle: 'Google no devolvió un cálculo válido. Revisa clave, cuota, red y cobertura de ruta.' });
    return { ruta, distancia };
  } catch { return fallo('red_o_timeout', 'No se pudo consultar GSG por red o tiempo de espera.'); }
}

/** Una instancia por tienda: no comparte resultados entre claves o negocios. */
export function crearConsultaSeguimiento(gsg: PuertoGsg, calcular?: CalcularRuta, reloj: () => Date = () => new Date()) {
  type Resultado = Awaited<ReturnType<typeof consultarSeguimiento>>;
  const cache = new Map<string, { hasta: number; resultado: Resultado }>();
  const enCurso = new Map<string, Promise<Resultado>>();
  let ultimoIntento: string | null = null;
  let ultimoExito: string | null = null;
  let ultimoError: string | null = null;
  let generacion = 0;
  const pedidos = new Map<string, { tracking: string; consultadoAt: string; versionRuta?: string; gpsAt?: string; fallo: FalloSeguimiento | null }>();
  return {
    estado: () => ({ conectado: gsg.conectado(), googleConfigurado: Boolean(calcular), ultimoIntento, ultimoExito, ultimoError, cacheSegundos: 30, pedidos: [...pedidos.values()].reverse() }),
    invalidar() { generacion++; cache.clear(); enCurso.clear(); },
    async consultar(tracking: string): Promise<Resultado> {
      if (!gsg.conectado()) { cache.clear(); return null; }
      const ahora = reloj();
      const entrada = cache.get(tracking);
      const posicion = entrada?.resultado?.ruta.posicion;
      const vigente = !posicion || ahora.getTime() - new Date(posicion.actualizadaAt).getTime() <= 10 * 60_000;
      if (entrada && vigente && entrada.hasta > ahora.getTime()) return entrada.resultado;
      const pendiente = enCurso.get(tracking);
      if (pendiente) return pendiente;
      const revision = generacion;
      ultimoIntento = ahora.toISOString();
      let errorConsulta: FalloSeguimiento | null = null;
      const promesa = consultarSeguimiento(gsg, tracking, calcular, ahora, fallo => { errorConsulta = fallo; }).then(resultado => {
        if (revision !== generacion) return null;
        if (resultado) ultimoExito = reloj().toISOString();
        ultimoError = errorConsulta?.detalle ?? null;
        if (pedidos.size >= 50 && !pedidos.has(tracking)) pedidos.delete(pedidos.keys().next().value!);
        pedidos.set(tracking, { tracking, consultadoAt: ahora.toISOString(), versionRuta: resultado?.ruta.versionRuta, gpsAt: resultado?.ruta.posicion?.actualizadaAt, fallo: errorConsulta });
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        cache.set(tracking, { hasta: reloj().getTime() + (resultado ? 30_000 : 5_000), resultado });
        return resultado;
      }).finally(() => { if (enCurso.get(tracking) === promesa) enCurso.delete(tracking); });
      enCurso.set(tracking, promesa);
      return promesa;
    },
  };
}

/** Google calcula el recorrido completo, conservando el orden de GSG. */
export function crearCalculadorGoogle(apiKey: string, pedir: typeof fetch = fetch, reloj: () => Date = () => new Date()): CalcularRuta {
  return async ruta => {
    if (!apiKey.trim() || !ruta.posicion || !ruta.paradas.length) return null;
    const waypoint = (p: { lat: number; lng: number }) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
    try {
      let origen = ruta.posicion;
      let metros = 0, segundosTotales = 0, serviciosPrevios = 0;
      const salida = reloj().getTime();
      const presupuesto = AbortSignal.timeout(15_000);
      for (let inicio = 0; inicio < ruta.paradas.length; inicio += 26) {
      const tramo = ruta.paradas.slice(inicio, inicio + 26);
      const r = await pedir('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST', signal: AbortSignal.any([presupuesto, AbortSignal.timeout(5000)]),
        headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
        body: JSON.stringify({ origin: waypoint(origen), destination: waypoint(tramo.at(-1)!), intermediates: tramo.slice(0,-1).map(waypoint), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', optimizeWaypointOrder: false, ...(inicio ? { departureTime: new Date(salida + segundosTotales * 1000 + serviciosPrevios * 60_000).toISOString() } : {}) }),
      });
      if (!r.ok) return null;
      const body = await r.json() as { routes?: Array<{ distanceMeters?: number; duration?: string }> };
      const a = body.routes?.[0];
      const segundos = Number(a?.duration?.match(/^(\d+(?:\.\d+)?)s$/)?.[1]);
      if (typeof a?.distanceMeters !== 'number' || !Number.isFinite(a.distanceMeters) || a.distanceMeters < 0 || !Number.isFinite(segundos) || segundos <= 0) return null;
      metros += a.distanceMeters; segundosTotales += segundos;
      serviciosPrevios += tramo.filter(p => p.orden !== ruta.puntoCliente).reduce((s,p) => s + (p.servicioMinutos ?? 0), 0);
      origen = { ...tramo.at(-1)!, actualizadaAt: ruta.posicion.actualizadaAt };
      }
      const previas = ruta.paradas.slice(0,-1);
      const incompleta = previas.some(p => p.servicioMinutos == null);
      return { km: Math.round(metros / 100) / 10, minutos: Math.ceil(segundosTotales / 60 + (incompleta ? 0 : serviciosPrevios)), ...(incompleta ? { soloConduccion: true } : {}) };
    } catch { return null; }
  };
}

export function textoSeguimiento(tracking: string, r: { ruta: SeguimientoGsg; distancia: DistanciaRuta | null }): string {
  const { ruta, distancia } = r;
  const estados = { pendiente: 'GSG informa que tu pedido está pendiente de reparto.', llegando: 'GSG informa que el motorizado está llegando a tu punto de entrega.', entregado: 'GSG informa que tu pedido fue entregado.', cancelado: 'GSG informa que tu pedido está cancelado.', incidencia: 'GSG informa una incidencia en tu pedido. Una persona debe revisar el caso.' };
  if (ruta.estado !== 'en_reparto') return `Pedido ${tracking}: ${estados[ruta.estado]}`;
  return `Pedido ${tracking}: el motorizado está en el punto ${ruta.puntoActual} y tu entrega corresponde al punto ${ruta.puntoCliente}. Quedan ${ruta.paradas.length - 1} paradas antes de llegar a ti.`
    + (distancia ? ` Según Google Maps, faltan aproximadamente ${distancia.km} km y ${distancia.minutos} minutos${distancia.soloConduccion ? ' de conducción. Falta el tiempo de atención en las paradas; todavía no podemos estimar la llegada completa.' : ', incluyendo la atención en las paradas.'} El tráfico puede cambiar esta estimación.` : ' Aún no podemos calcular la distancia y el tiempo de llegada.')
    + (ruta.horario ? ` Horario aproximado para ${ruta.distrito || 'tu distrito'}: ${textoHorario(ruta.horario)}.` : '');
}

export function textoHorario(h: z.infer<typeof horarioGsgSchema>): string {
  return `de ${h.desde}${h.fechaDesde ? ` del ${h.fechaDesde}` : ''} a ${h.hasta}${h.fechaHasta ? ` del ${h.fechaHasta} (${h.zonaHoraria})` : ''}`;
}
