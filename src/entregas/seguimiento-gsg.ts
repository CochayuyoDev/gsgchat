/**
 * El seguimiento de un pedido en la ruta de GSG (posicion del motorizado,
 * paradas que faltan) y el recorrido que calcula Google.
 *
 * GSGchat nunca le pide nada a GSG: aqui no hay ningun GET a su API. Lo que
 * hay es la lectura y la validacion de un seguimiento ya recibido
 * (`leerSeguimiento`) y una consulta con cache que solo mira una fuente local
 * (`crearConsultaSeguimiento`). Las fuentes son dos y las dos son locales:
 * el seguimiento que GSG empuja (POST /api/v1/seguimiento, ver
 * seguimiento-recibido.ts) y el que arma GSGchat con sus propios datos
 * (ver seguimiento-propio.ts, `origen: 'propio'`).
 */
import { z } from 'zod';

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
  /** Quien armo el seguimiento: GSG (lo empujo) o GSGchat con sus datos. */
  origen: z.enum(['gsg', 'propio']).default('gsg'),
  // `fuente` dice de donde sale la posicion y cuanto tiempo vale (ver EDAD_MAXIMA_POSICION_MIN).
  posicion: punto.extend({ actualizadaAt: z.string().datetime(), fuente: z.enum(['gps', 'reporte', 'ultima_entrega']).optional() }).optional(),
  puntoActual: z.number().int().nonnegative().optional(),
  puntoCliente: z.number().int().positive().optional(),
  // Solo las paradas que faltan, en el orden definido por GSG, hasta el cliente.
  paradas: z.array(punto.extend({ orden: z.number().int().positive(), servicioMinutos: z.number().min(0).max(120).optional() })).max(100).default([]),
});
export type SeguimientoGsg = z.infer<typeof seguimientoGsgSchema>;
export interface DistanciaRuta { km: number; minutos: number; soloConduccion?: boolean }
export type CalcularRuta = (ruta: SeguimientoGsg) => Promise<DistanciaRuta | null>;
export interface FalloSeguimiento { proveedor: 'gsg' | 'gsgchat' | 'google'; codigo: string; detalle: string }

/**
 * Cuantos minutos vale una posicion segun de donde salga: el GPS en vivo (o
 * la que manda GSG, sin fuente) 10; la ultima que dejo el motorizado al
 * mandar un pin o entregar, 30; la de su ultima entrega registrada, 45.
 */
export const EDAD_MAXIMA_POSICION_MIN = { gps: 10, reporte: 30, ultima_entrega: 45 } as const;
export function edadMaximaPosicionMs(posicion: { fuente?: keyof typeof EDAD_MAXIMA_POSICION_MIN }): number {
  return EDAD_MAXIMA_POSICION_MIN[posicion.fuente ?? 'gps'] * 60_000;
}

/**
 * Lee y valida un seguimiento YA RECIBIDO (no llama a GSG) y, si el pedido va
 * en reparto, le pide a Google el recorrido que falta.
 */
export async function leerSeguimiento(cuerpo: unknown, tracking: string, calcular?: CalcularRuta, ahora = new Date(), diagnosticar?: (fallo: FalloSeguimiento) => void): Promise<{ ruta: SeguimientoGsg; distancia: DistanciaRuta | null } | null> {
  let proveedor: FalloSeguimiento['proveedor'] = 'gsg';
  const fallo = (codigo: string, detalle: string): null => { diagnosticar?.({ proveedor, codigo, detalle }); return null; };
  if (cuerpo === undefined || cuerpo === null) return fallo('sin_tracking', 'No hay seguimiento recibido para este tracking.');
  try {
    const leido = seguimientoGsgSchema.safeParse(cuerpo);
    if (!leido.success) return fallo('contrato', 'La respuesta de GSG no cumple el contrato de seguimiento.');
    let ruta = leido.data;
    const propio = ruta.origen === 'propio';
    if (propio) proveedor = 'gsgchat';
    if (ruta.tracking !== tracking) return fallo('tracking_incorrecto', 'GSG respondió con otro tracking.');
    if (ruta.estado !== 'en_reparto') return { ruta, distancia: null };
    // Con datos propios las paradas valen aunque no haya una posicion reciente:
    // se cuentan las paradas y no se calculan km ni minutos (nunca se inventa la posicion).
    if ((!ruta.posicion && !propio) || ruta.puntoActual == null || ruta.puntoCliente == null) return fallo('ruta_incompleta', 'Faltan posición o puntos de reparto.');
    const actual = ruta.puntoActual, cliente = ruta.puntoCliente;
    if (ruta.posicion) {
      const edad = ahora.getTime() - new Date(ruta.posicion.actualizadaAt).getTime();
      if (edad > edadMaximaPosicionMs(ruta.posicion) || edad < -60_000) {
        if (!propio) return fallo('gps_antiguo', 'La posición no es reciente o tiene una fecha futura inválida.');
        diagnosticar?.({ proveedor, codigo: 'gps_antiguo', detalle: 'La última posición del motorizado no es reciente: se cuentan las paradas sin calcular distancia ni tiempo.' });
        ruta = { ...ruta, posicion: undefined };
      }
    }
    if (actual > cliente) return fallo('ruta_incoherente', 'El punto del cliente ya quedó atrás sin un estado de entrega coherente.');
    if (actual === cliente) return { ruta: { ...ruta, estado: 'llegando' }, distancia: null };
    const ordenes = ruta.paradas.map(p => p.orden);
    if (!ordenes.length || ordenes.at(-1) !== cliente || ordenes.some((p,i) => p <= (i ? ordenes[i-1]! : actual))) return fallo('ruta_incoherente', 'Las paradas están fuera de orden o falta el destino.');
    if (!ruta.secuenciaCompleta && (ordenes.length !== cliente - actual || ordenes.some((p,i) => p !== actual + i + 1))) return fallo('ruta_incompleta', 'Hay huecos sin declaración de secuencia completa.');
    const distancia = calcular && ruta.posicion ? await calcular(ruta).catch(() => null) : null;
    if (calcular && ruta.posicion && !distancia) diagnosticar?.({ proveedor: 'google', codigo: 'ruta_no_disponible', detalle: 'Google no devolvió un cálculo válido. Revisa clave, cuota, red y cobertura de ruta.' });
    return { ruta, distancia };
  } catch { return fallo('lectura', 'No se pudo leer el seguimiento recibido.'); }
}

/** De donde sale el seguimiento de un tracking: algo local, nunca una llamada a GSG. */
export type FuenteSeguimiento = (tracking: string) => Promise<unknown> | unknown;

/** Cuanto se guarda un calculo de Google para la misma ruta y la misma posicion. */
export const CACHE_GOOGLE_MS = 10 * 60_000;

/**
 * Una instancia por tienda: no comparte resultados entre claves o negocios.
 * Sin `fuente` no hay seguimiento (siempre null): GSGchat no se lo pide a GSG.
 * Google solo se llama cuando el cliente pregunta, y una sola vez por tracking
 * y version de los datos (ruta, posicion y paradas) durante CACHE_GOOGLE_MS:
 * si el cliente vuelve a preguntar sin datos nuevos, no sale ninguna llamada.
 */
export function crearConsultaSeguimiento(fuente: FuenteSeguimiento | null, calcular?: CalcularRuta, reloj: () => Date = () => new Date()) {
  type Resultado = Awaited<ReturnType<typeof leerSeguimiento>>;
  const cache = new Map<string, { hasta: number; resultado: Resultado }>();
  const rutasCalculadas = new Map<string, { hasta: number; distancia: DistanciaRuta | null }>();
  const calcularGuardado: CalcularRuta | undefined = calcular
    ? async (ruta) => {
        const clave = JSON.stringify([ruta.tracking, ruta.versionRuta ?? '', ruta.posicion?.lat, ruta.posicion?.lng, ruta.posicion?.actualizadaAt, ruta.paradas.map((p) => [p.orden, p.lat, p.lng, p.servicioMinutos ?? null])]);
        const t = reloj().getTime();
        const guardada = rutasCalculadas.get(clave);
        if (guardada && guardada.hasta > t) return guardada.distancia;
        const distancia = await calcular(ruta).catch(() => null);
        if (rutasCalculadas.size >= 500 && !rutasCalculadas.has(clave)) rutasCalculadas.delete(rutasCalculadas.keys().next().value!);
        // Un fallo se recuerda poco (un minuto) para no insistirle a Google en cada mensaje.
        rutasCalculadas.set(clave, { hasta: t + (distancia ? CACHE_GOOGLE_MS : 60_000), distancia });
        return distancia;
      }
    : undefined;
  const enCurso = new Map<string, Promise<Resultado>>();
  let ultimoIntento: string | null = null;
  let ultimoExito: string | null = null;
  let ultimoError: string | null = null;
  let generacion = 0;
  const pedidos = new Map<string, { tracking: string; consultadoAt: string; versionRuta?: string; gpsAt?: string; fallo: FalloSeguimiento | null }>();
  return {
    estado: () => ({ conectado: Boolean(fuente), googleConfigurado: Boolean(calcular), ultimoIntento, ultimoExito, ultimoError, cacheSegundos: 30, pedidos: [...pedidos.values()].reverse() }),
    invalidar() { generacion++; cache.clear(); enCurso.clear(); },
    async consultar(tracking: string): Promise<Resultado> {
      if (!fuente) { cache.clear(); return null; }
      const ahora = reloj();
      const entrada = cache.get(tracking);
      const posicion = entrada?.resultado?.ruta.posicion;
      const vigente = !posicion || ahora.getTime() - new Date(posicion.actualizadaAt).getTime() <= edadMaximaPosicionMs(posicion);
      if (entrada && vigente && entrada.hasta > ahora.getTime()) return entrada.resultado;
      const pendiente = enCurso.get(tracking);
      if (pendiente) return pendiente;
      const revision = generacion;
      ultimoIntento = ahora.toISOString();
      let errorConsulta: FalloSeguimiento | null = null;
      const promesa = Promise.resolve().then(() => fuente(tracking)).then(cuerpo => leerSeguimiento(cuerpo, tracking, calcularGuardado, ahora, fallo => { errorConsulta = fallo; })).catch(() => { errorConsulta = { proveedor: 'gsg', codigo: 'lectura', detalle: 'No se pudo leer el seguimiento recibido.' }; return null; }).then(resultado => {
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
  const quedan = ruta.paradas.length;
  const antes = Math.max(0, quedan - 1);
  const donde = ruta.puntoActual === 0
    ? `el motorizado aún no completa la primera parada de su ruta y tu entrega corresponde al punto ${ruta.puntoCliente}.`
    : `el motorizado está en el punto ${ruta.puntoActual} y tu entrega corresponde al punto ${ruta.puntoCliente}.`;
  const cuantas = quedan <= 1 ? ' Tu entrega es su siguiente parada.' : ` Quedan ${quedan} paradas contando la tuya (${antes} antes de llegar a ti).`;
  const sinPosicion = ruta.origen === 'propio' && !ruta.posicion;
  const desde = ruta.posicion?.fuente === 'ultima_entrega' ? ' Se calcula desde su última entrega registrada.' : '';
  return `Pedido ${tracking}: ${donde}${cuantas}`
    + (sinPosicion ? ' Aún no tenemos una posición reciente del motorizado, así que no podemos calcular la distancia ni el tiempo de llegada.' : distancia ? `${desde} Según Google Maps, faltan aproximadamente ${distancia.km} km y ${distancia.minutos} minutos${distancia.soloConduccion ? ' de conducción. Falta el tiempo de atención en las paradas; todavía no podemos estimar la llegada completa.' : ', incluyendo la atención en las paradas.'} El tráfico puede cambiar esta estimación.` : ' Aún no podemos calcular la distancia y el tiempo de llegada.')
    + (ruta.horario ? ` Horario aproximado para ${ruta.distrito || 'tu distrito'}: ${textoHorario(ruta.horario)}.` : '');
}

export function textoHorario(h: z.infer<typeof horarioGsgSchema>): string {
  return `de ${h.desde}${h.fechaDesde ? ` del ${h.fechaDesde}` : ''} a ${h.hasta}${h.fechaHasta ? ` del ${h.fechaHasta} (${h.zonaHoraria})` : ''}`;
}
