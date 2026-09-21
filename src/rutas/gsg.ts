/**
 * La puerta al sistema de GSG.
 *
 * Hoy GSG no tiene API que llamar, y ese es exactamente el motivo de que este
 * fichero exista. Todo lo que hay que contarle -una ubicacion conseguida, una
 * incidencia, el resumen de un lote- se arma con su forma definitiva y se
 * encola en `rutas_reportes`. Sin credenciales, la cola simplemente se queda
 * llena y se puede mirar, exportar y contar desde el panel.
 *
 * El dia que GSG publique su endpoint: se rellenan GSG_URL y GSG_TOKEN, se
 * pulsa "reenviar pendientes" y sale TODO lo acumulado, incluido lo de las
 * semanas anteriores. No hay que tocar el motor, ni la pantalla, ni volver a
 * pedirle nada al cliente. Es la unica pieza que cambia.
 *
 * Lo que se manda va documentado abajo, en `PAYLOADS`: es el contrato que hay
 * que ensenarle a quien haga la API del otro lado.
 */

import type { Lote, Reporte, RutasRepo, Solicitud, TipoReporte } from '../db/rutas.js';
import { INCIDENCIAS, type CodigoIncidencia } from './incidencias.js';

export interface ResultadoEnvio {
  ok: boolean;
  /** Id que devuelve GSG al aceptarlo, si lo devuelve. */
  id?: string | null;
  error?: string;
  /** true si tiene sentido reintentarlo (caida, timeout). */
  reintentable?: boolean;
}

export interface ResultadoConsulta<T = unknown> {
  ok: boolean;
  cuerpo?: T;
  error?: string;
  /** El codigo HTTP que devolvio GSG, si llego a contestar. */
  status?: number;
}

export interface PuertoGsg {
  /** Si hay a donde mandar. Falso = todo queda en la cola. */
  conectado(): boolean;
  /** Como describirlo en pantalla. */
  descripcion(): string;
  enviar(tipo: TipoReporte, payload: Record<string, unknown>): Promise<ResultadoEnvio>;
  /**
   * Una consulta (GET) a la API de GSG: lo que el modulo de entregas usa
   * para traerse a quien falta pedir la ubicacion y a quien falta que
   * confirme. `ruta` va relativa a la base (p. ej. `/reparto/pendientes`).
   */
  consultar<T = unknown>(ruta: string): Promise<ResultadoConsulta<T>>;
}

export interface OpcionesGsg {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Segundos antes de darse por vencido en una llamada. */
  timeoutSegundos?: number;
}

/** El camino de cada tipo dentro de la API de GSG. */
export const RUTAS_GSG: Record<TipoReporte, string> = {
  ubicacion: '/ubicaciones',
  incidencia: '/incidencias',
  resumen: '/resumenes',
  confirmacion: '/confirmaciones',
  entrega: '/entregas',
};

/** De donde se traen los pendientes del dia (quien falta ubicacion, quien falta confirmar). */
export const RUTA_GSG_PENDIENTES = '/reparto/pendientes';

/**
 * Puerto real. Manda un POST con el payload tal cual y espera un JSON con
 * `id` o `referencia`; cualquier 2xx se da por aceptado.
 */
export function crearPuertoHttp(opts: OpcionesGsg): PuertoGsg {
  const base = opts.url.replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    conectado: () => Boolean(base),
    descripcion: () => `API de GSG en ${base}`,

    async enviar(tipo, payload) {
      const control = new AbortController();
      const corte = setTimeout(() => control.abort(), (opts.timeoutSegundos ?? 20) * 1000);
      try {
        const respuesta = await doFetch(`${base}${RUTAS_GSG[tipo]}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          },
          body: JSON.stringify(payload),
          signal: control.signal,
        });

        const texto = await respuesta.text();
        if (!respuesta.ok) {
          return {
            ok: false,
            error: `GSG respondio ${respuesta.status}: ${texto.slice(0, 200)}`,
            // 5xx y 429 son del otro lado y pasan solos; un 4xx es culpa del
            // payload y reintentarlo solo repite el mismo error.
            reintentable: respuesta.status >= 500 || respuesta.status === 429,
          };
        }

        let id: string | null = null;
        try {
          const cuerpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
          id = (cuerpo.id ?? cuerpo.referencia ?? cuerpo.codigo ?? null) as string | null;
        } catch {
          // Una API que contesta 200 con texto plano tambien vale.
        }
        return { ok: true, id };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          reintentable: true,
        };
      } finally {
        clearTimeout(corte);
      }
    },

    async consultar(ruta) {
      const control = new AbortController();
      const corte = setTimeout(() => control.abort(), (opts.timeoutSegundos ?? 20) * 1000);
      try {
        const respuesta = await doFetch(`${base}${ruta}`, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          },
          signal: control.signal,
        });
        const texto = await respuesta.text();
        if (!respuesta.ok) {
          return { ok: false, status: respuesta.status, error: `GSG respondio ${respuesta.status}: ${texto.slice(0, 200)}` };
        }
        try {
          return { ok: true, status: respuesta.status, cuerpo: (texto ? JSON.parse(texto) : {}) as never };
        } catch {
          return { ok: false, status: respuesta.status, error: 'GSG contesto algo que no es JSON' };
        }
      } catch (error) {
        return { ok: false, error: control.signal.aborted ? 'GSG no respondio a tiempo' : error instanceof Error ? error.message : String(error) };
      } finally {
        clearTimeout(corte);
      }
    },
  };
}

/** Puerto sin API: no manda nada y lo dice. La cola se queda llena. */
export function crearPuertoEnEspera(): PuertoGsg {
  return {
    conectado: () => false,
    descripcion: () => 'falta GSG_URL: lo reportable se guarda y saldra entero al conectarla',
    async enviar() {
      return { ok: false, error: 'la API de GSG todavia no esta conectada', reintentable: true };
    },
    async consultar() {
      return { ok: false, error: 'la API de GSG todavia no esta conectada' };
    },
  };
}

export function crearPuertoGsg(config: { GSG_URL: string; GSG_TOKEN: string }): PuertoGsg {
  return config.GSG_URL.trim()
    ? crearPuertoHttp({ url: config.GSG_URL, token: config.GSG_TOKEN })
    : crearPuertoEnEspera();
}

// ------------------------------------------------------------- payloads

/**
 * La forma de lo que se le manda a GSG.
 *
 * Se documenta aqui porque es el contrato: quien escriba la API del otro lado
 * tiene que aceptar esto, y quien lo lea dentro de seis meses tiene que poder
 * saber que significa cada campo sin leer el motor.
 */
export const PAYLOADS = {
  ubicacion:
    'referencia, telefono, nombre, lat, lng, mapsUrl, precisionMetros, fuente, recibidoEn, lote' +
    ' (+ corregida: true cuando el cliente mando un segundo pin: sustituye al anterior de la misma referencia)',
  incidencia:
    'referencia, telefono, nombre, codigo, titulo, detalle, queHacer, intentos, ultimoEnvio, requiereHumano, lote',
  resumen: 'lote, nombre, total, porEstado, porIncidencia, generadoEn',
  confirmacion:
    'referencia, telefono, nombre, confirmada (true/false), respuesta (lo que escribio), como (boton|reglas|ia|persona), confirmadoEn' +
    ' (+ motivo cuando no confirma: cancela | cambio | sin_respuesta | sin_plantilla | error_envio | baja | dia_cerrado | reprogramar)',
  entrega:
    'referencia, telefono, nombre, lat, lng, motorizado {telefono, nombre, placa}, minutosMotorizado, margenMinutos, minutosAviso, llegaAproxEn, avisadoEn,' +
    ' entregadoEn (null hasta que el motorizado dice "entregado"), entregadaComo (reglas|ia|foto|persona|cierre), incidencia (no_entregado cuando no se pudo),' +
    ' prioridad (normal|urgente), visitas (veces que el motorizado fue sin poder entregar), segundaVisita (true cuando el cliente pidio que volviera hoy)',
} as const;

/** GSG dice que el cliente confirmo (o no) su pedido de hoy. Ver src/entregas. */
export function payloadConfirmacion(e: {
  referencia: string;
  phone: string;
  nombre: string | null;
  confirmada: boolean;
  respuesta: string | null;
  como: string | null;
  motivo?: string | null;
  en: Date;
}): Record<string, unknown> {
  return {
    tipo: 'confirmacion',
    referencia: e.referencia,
    telefono: e.phone,
    nombre: e.nombre,
    confirmada: e.confirmada,
    respuesta: e.respuesta,
    como: e.como,
    motivo: e.motivo ?? null,
    confirmadoEn: e.en.toISOString(),
  };
}

/** El motorizado ya tiene el pedido y el cliente sabe a que hora le llega. Ver src/entregas. */
export function payloadEntrega(e: {
  referencia: string;
  phone: string;
  nombre: string | null;
  lat: number | null;
  lng: number | null;
  motorizado: { phone: string; nombre: string; placa: string | null } | null;
  minutosMotorizado: number | null;
  margenMinutos: number;
  minutosAviso: number | null;
  llegaAproxAt: Date | null;
  avisadoAt: Date | null;
  /** Cuando el motorizado dijo "entregado" (o null si aun no). */
  entregadoAt?: Date | null;
  entregadaComo?: string | null;
  /** 'no_entregado' cuando el motorizado no pudo entregar. */
  incidencia?: string | null;
  prioridad?: string | null;
  /** Veces que el motorizado fue a la puerta sin poder entregar. */
  visitas?: number | null;
  /** true cuando el cliente pidio que el motorizado volviera hoy. */
  segundaVisita?: boolean | null;
}): Record<string, unknown> {
  return {
    tipo: 'entrega',
    referencia: e.referencia,
    telefono: e.phone,
    nombre: e.nombre,
    lat: e.lat,
    lng: e.lng,
    motorizado: e.motorizado ? { telefono: e.motorizado.phone, nombre: e.motorizado.nombre, placa: e.motorizado.placa } : null,
    minutosMotorizado: e.minutosMotorizado,
    margenMinutos: e.margenMinutos,
    minutosAviso: e.minutosAviso,
    llegaAproxEn: e.llegaAproxAt?.toISOString() ?? null,
    avisadoEn: e.avisadoAt?.toISOString() ?? null,
    entregadoEn: e.entregadoAt?.toISOString() ?? null,
    entregadaComo: e.entregadaComo ?? null,
    incidencia: e.incidencia ?? null,
    prioridad: e.prioridad ?? 'normal',
    visitas: e.visitas ?? 0,
    segundaVisita: e.segundaVisita ?? false,
  };
}

export function payloadUbicacion(solicitud: Solicitud, lote: Lote): Record<string, unknown> {
  return {
    tipo: 'ubicacion',
    solicitudId: solicitud.id,
    referencia: solicitud.referencia,
    telefono: solicitud.phone ?? solicitud.telefonoCrudo,
    nombre: solicitud.nombre,
    lat: solicitud.lat,
    lng: solicitud.lng,
    mapsUrl: solicitud.mapsUrl,
    precisionMetros: solicitud.precisionM,
    fuente: solicitud.ubicacionFuente,
    recibidoEn: (solicitud.resueltoAt ?? new Date()).toISOString(),
    intentos: solicitud.intentos,
    lote: { id: lote.id, nombre: lote.nombre, externoId: lote.externoId },
  };
}

export function payloadIncidencia(solicitud: Solicitud, lote: Lote): Record<string, unknown> {
  const codigo = solicitud.incidencia as CodigoIncidencia | null;
  const ficha = codigo ? INCIDENCIAS[codigo] : null;
  return {
    tipo: 'incidencia',
    solicitudId: solicitud.id,
    referencia: solicitud.referencia,
    telefono: solicitud.phone ?? solicitud.telefonoCrudo,
    telefonoOriginal: solicitud.telefonoCrudo,
    nombre: solicitud.nombre,
    codigo,
    titulo: ficha?.titulo ?? 'Incidencia',
    detalle: solicitud.incidenciaDetalle,
    queHacer: ficha?.queHacer ?? null,
    requiereHumano: solicitud.requiereHumano,
    intentos: solicitud.intentos,
    ultimoEnvio: solicitud.ultimoEnvioAt?.toISOString() ?? null,
    primeraRespuesta: solicitud.primeraRespuestaAt?.toISOString() ?? null,
    detectadoEn: new Date().toISOString(),
    lote: { id: lote.id, nombre: lote.nombre, externoId: lote.externoId },
  };
}

export function payloadResumen(
  lote: Lote,
  cifras: Record<string, number>,
  incidencias: Record<string, number>,
): Record<string, unknown> {
  const total = Object.values(cifras).reduce((suma, n) => suma + n, 0);
  return {
    tipo: 'resumen',
    lote: { id: lote.id, nombre: lote.nombre, externoId: lote.externoId },
    total,
    porEstado: cifras,
    porIncidencia: incidencias,
    generadoEn: new Date().toISOString(),
  };
}

// ------------------------------------------------------------ despacho

export interface DespachoResumen {
  intentados: number;
  enviados: number;
  fallidos: number;
  /** Por que no se intento nada, cuando no se intento nada. */
  motivo?: string;
}

/**
 * Vacia la cola contra GSG.
 *
 * Con el puerto sin conectar no se toca nada: los reportes se quedan
 * 'pendiente' y se mandaran enteros el dia que haya API. Un fallo no
 * reintentable pasa a 'fallido' para que no atasque la cola detras.
 */
export async function despacharReportes(
  repos: { rutas: RutasRepo },
  puerto: PuertoGsg,
  limite = 25,
): Promise<DespachoResumen> {
  if (!puerto.conectado()) {
    return { intentados: 0, enviados: 0, fallidos: 0, motivo: puerto.descripcion() };
  }

  const pendientes = await repos.rutas.reportesPendientes(limite);
  const resumen: DespachoResumen = { intentados: pendientes.length, enviados: 0, fallidos: 0 };

  for (const reporte of pendientes) {
    const salida = await puerto.enviar(reporte.tipo, reporte.payload);
    if (salida.ok) {
      await repos.rutas.marcarReporte(reporte.id, 'enviado', { externoId: salida.id ?? null });
      resumen.enviados++;
      continue;
    }
    // Reintentable: se deja pendiente y se vuelve en la siguiente pasada.
    await repos.rutas.marcarReporte(
      reporte.id,
      salida.reintentable ? 'pendiente' : 'fallido',
      { error: salida.error },
    );
    if (!salida.reintentable) resumen.fallidos++;
  }

  return resumen;
}

/** Lo que hay en la cola, en JSON, para llevarselo a mano mientras no hay API. */
export function exportarCola(reportes: Reporte[]): string {
  return reportes.map((r) => JSON.stringify({ ...r.payload, encoladoEn: r.createdAt })).join('\n');
}
