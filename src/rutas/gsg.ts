/**
 * La puerta al sistema de GSG.
 *
 * Hoy GSG no tiene API que llamar, y ese es exactamente el motivo de que este
 * fichero exista. Todo lo que hay que contarle -una ubicacion conseguida, una
 * incidencia, el resumen de un lote- se arma con su forma definitiva y se
 * encola en `rutas_reportes`. Sin credenciales, la cola simplemente se queda
 * llena y se puede mirar, exportar y contar desde el panel.
 *
 * El dia que GSG publique su endpoint: se pone la URL base, la ruta de la
 * ubicacion y la API Key de GSG en Conexion (o GSG_URL, GSG_LOCATION_PATH y
 * GSG_API_KEY en el .env), se pulsa "reenviar pendientes" y sale TODO lo
 * acumulado, incluido lo de las semanas anteriores. No hay que tocar el
 * motor, ni la pantalla, ni volver a pedirle nada al cliente.
 *
 * La clave de GSG sale SOLO en la cabecera `X-API-Key` (nunca Bearer, nunca
 * en la URL ni en el cuerpo) y nunca aparece en un error guardado.
 *
 * Lo que se manda va documentado abajo, en `PAYLOADS`: es el contrato que hay
 * que ensenarle a quien haga la API del otro lado.
 *
 * Esta puerta solo MANDA (POST de reportes). GSGchat nunca le pide nada a
 * GSG: ni la lista del dia, ni para probar la conexion, ni para verificar el
 * contrato, ni para cerrar el dia. Los pedidos llegan solo cuando GSG los
 * empuja (POST /api/v1/entregas y la recepcion global de GSG). GSG nunca tuvo
 * un GET de pendientes y preguntarle cada pocos minutos solo daba 404.
 */

import { createHash } from 'node:crypto';
import type { Lote, Reporte, RutasRepo, Solicitud, TipoReporte } from '../db/rutas.js';
import type { Repos } from '../db/repos.js';
import { INCIDENCIAS, type CodigoIncidencia } from './incidencias.js';
import { esNumeroDePrueba, PREFIJO_REFERENCIA_PRUEBA } from '../desarrollador/numeros.js';

export interface ResultadoEnvio {
  ok: boolean;
  /** Id que devuelve GSG al aceptarlo, si lo devuelve. */
  id?: string | null;
  error?: string;
  /** true si tiene sentido reintentarlo (caida, timeout). */
  reintentable?: boolean;
  /**
   * GSG rechazo la clave: 401 (clave incorrecta) o 403 (sin permisos). No se
   * reintenta solo: insistir con la misma clave solo repite el rechazo.
   */
  autenticacion?: 401 | 403;
  /** La configuracion (URL base, ruta) no es valida: no se llego a mandar nada. */
  configuracion?: boolean;
}

export interface PuertoGsg {
  /** Si hay a donde mandar. Falso = todo queda en la cola. */
  conectado(): boolean;
  /** Como describirlo en pantalla. */
  descripcion(): string;
  enviar(tipo: TipoReporte, payload: Record<string, unknown>): Promise<ResultadoEnvio>;
  /**
   * true si lo vigente es el simulador de GSG de este servidor. Lo de prueba
   * (Modulo desarrollador) solo sale hacia el simulador, nunca a la API real.
   */
  esSimulador?(): boolean;
  /** A donde sale la ubicacion (URL base + ruta), o null sin conexion o con la configuracion mal. */
  urlUbicacion?(): string | null;
  /** Por que la configuracion no vale (en palabras), o null si vale. Con error no se envia nada. */
  errorConfiguracion?(): string | null;
  /**
   * Una huella de la configuracion (base, ruta y clave, la clave solo como
   * hash). Si cambia, la cola vuelve a intentar lo que GSG rechazo por la clave.
   */
  firma?(): string;
}

export interface OpcionesGsg {
  idempotenciaUbicacion?: boolean;
  /** La URL base de la API de GSG (p. ej. https://backend.gsg.pe/api/). */
  url: string;
  /** La ruta, relativa a la base, a la que se hace POST con la ubicacion (p. ej. v1/gsgchat/location). */
  rutaUbicacion?: string;
  /** La ruta, relativa a la base, a la que se hace POST con cada numero reportado (por defecto `numeros-reportados`). */
  rutaReportados?: string;
  /**
   * Compatibilidad: la URL completa de la ubicacion como se guardaba antes.
   * Solo se usa si no hay `rutaUbicacion`, y se convierte a base + ruta con
   * `migrarUbicacionAntigua` (si no se puede sin adivinar, no se envia nada).
   */
  ubicacionUrl?: string;
  /** La API Key que da GSG. Sale SOLO en la cabecera X-API-Key. */
  token: string;
  fetchImpl?: typeof fetch;
  /** Segundos antes de darse por vencido en una llamada. */
  timeoutSegundos?: number;
}

/** El camino de cada tipo dentro de la API de GSG. */
export const RUTAS_GSG: Record<TipoReporte, string> = {
  ubicacion: '/sendLocation',
  incidencia: '/incidencias',
  resumen: '/resumenes',
  confirmacion: '/confirmaciones',
  entrega: '/entregas',
  numero_reportado: '/numeros-reportados',
};

/** La ruta de la ubicacion cuando no se dio otra: la de siempre (`<base>/sendLocation`). */
export const RUTA_UBICACION_POR_DEFECTO = 'sendLocation';

/** La ruta de los numeros reportados cuando no se dio otra (`<base>/numeros-reportados`). */
export const RUTA_REPORTADOS_POR_DEFECTO = 'numeros-reportados';

// ------------------------------------------------------- URL base + ruta

export type ResultadoUrlGsg = { ok: true; url: string } | { ok: false; error: string };

/**
 * Valida y normaliza la URL base de GSG: http(s), sin usuario ni clave, sin
 * query (`?`) ni fragmento (`#`), sin segmentos `..`, barras dobles juntadas
 * y SIEMPRE con la barra final (para que `/api/` se conserve al unir).
 */
export function normalizarBaseGsg(base: string): ResultadoUrlGsg {
  const crudo = (base ?? '').trim();
  if (!crudo) return { ok: false, error: 'Falta la URL base de GSG.' };
  if (!/^https?:\/\/[^/\\?#]/i.test(crudo)) return { ok: false, error: 'La URL base de GSG tiene que empezar por https:// (o http://) seguido del dominio.' };
  if (/[?#]/.test(crudo)) return { ok: false, error: 'La URL base de GSG no puede llevar «?» ni «#»: pon solo la dirección, sin parámetros.' };
  if (/[\s\\]/.test(crudo)) return { ok: false, error: 'La URL base de GSG no puede llevar espacios ni barras invertidas.' };
  let u: URL;
  try {
    u = new URL(crudo);
  } catch {
    return { ok: false, error: 'La URL base de GSG no es una dirección válida.' };
  }
  if (u.username || u.password) return { ok: false, error: 'La URL base de GSG no puede llevar usuario ni clave: la API Key va en su propio campo.' };
  // Los segmentos se miran sobre el texto original: URL() ya resolveria los `..`.
  const caminoCrudo = crudo.replace(/^https?:\/\/[^/]*/i, '');
  const segmentos = caminoCrudo.split('/').filter(Boolean);
  if (segmentos.some((s) => s === '..' || s === '.' || /^(%2e|\.){1,2}$/i.test(s))) return { ok: false, error: 'La URL base de GSG no puede llevar segmentos «..».' };
  const camino = segmentos.length ? `/${segmentos.join('/')}/` : '/';
  return { ok: true, url: `${u.protocol}//${u.host}${camino}` };
}

/**
 * Une la URL base de GSG con una ruta relativa: la unica forma de armar una
 * URL hacia GSG (envio, consulta y la vista previa de la pantalla, que la
 * reimplementa en el navegador con los mismos casos: ver tests).
 *
 *  - Conserva el prefijo de la base (`https://x/api/` + `v1/a` = `https://x/api/v1/a`).
 *  - Normaliza barras: iniciales y finales de la ruta, y dobles en ambas.
 *  - Rechaza rutas absolutas (`http://…`, `//host`, cualquier `esquema:`),
 *    segmentos `..`/`.`, query (`?`) y fragmento (`#`), y una base no http(s).
 */
export function unirUrlGsg(base: string, ruta: string): ResultadoUrlGsg {
  const b = normalizarBaseGsg(base);
  if (!b.ok) return b;
  const r = (ruta ?? '').trim();
  if (!r) return { ok: false, error: 'Falta la ruta para enviar la ubicación (por ejemplo v1/gsgchat/location).' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(r)) return { ok: false, error: 'La ruta no puede ser una dirección completa (http://…): pon solo la parte que va después de la URL base.' };
  if (/^\/\//.test(r) || r.includes('\\')) return { ok: false, error: 'La ruta no puede empezar por «//» ni llevar barras invertidas: pon solo la parte que va después de la URL base.' };
  if (/[?#]/.test(r)) return { ok: false, error: 'La ruta no puede llevar «?» ni «#».' };
  if (/\s/.test(r)) return { ok: false, error: 'La ruta no puede llevar espacios.' };
  const segmentos = r.split('/').filter(Boolean);
  if (!segmentos.length) return { ok: false, error: 'Falta la ruta para enviar la ubicación (por ejemplo v1/gsgchat/location).' };
  if (segmentos.some((s) => /^(%2e|\.){1,2}$/i.test(s))) return { ok: false, error: 'La ruta no puede llevar segmentos «..» ni «.».' };
  return { ok: true, url: `${b.url}${segmentos.join('/')}` };
}

export type ResultadoMigracionGsg = { ok: true; base: string; ruta: string; regla: 'sin_url_antigua' | 'prefijo' | 'api' } | { ok: false; error: string };

/**
 * Convierte la configuracion ANTIGUA (una direccion + la URL completa de la
 * ubicacion, o solo la direccion) a URL base + ruta, SOLO si es inequivoco:
 *
 *  1. Sin URL antigua de ubicacion: antes se mandaba a `<direccion>/sendLocation`
 *     (o a la direccion tal cual si ya acababa en /sendLocation). Se queda
 *     exactamente igual: base = la direccion (sin /sendLocation), ruta = `sendLocation`.
 *  2. La URL antigua empieza por la direccion + `/`: base = la direccion,
 *     ruta = lo que sigue. Sale a la misma URL y las consultas a la misma base.
 *  3. Si no, se parte por `/api/` cuando la URL antigua lo tiene UNA sola vez
 *     (base = hasta `/api/` incluido, ruta = lo de despues), siempre que la
 *     direccion antigua no diga otra cosa (vacia, igual a la URL antigua o
 *     igual a esa base). Con dos `/api/`, sin `/api/` o con una direccion que
 *     apunta a otro sitio, no se adivina: error y no se envia nada.
 */
export function migrarUbicacionAntigua(direccion: string, urlUbicacionAntigua: string): ResultadoMigracionGsg {
  const dir = (direccion ?? '').trim();
  const antigua = (urlUbicacionAntigua ?? '').trim();
  const sinFinal = (x: string) => x.replace(/\/+$/, '');

  if (!antigua) {
    const limpia = sinFinal(dir);
    const pegaronUbicacion = limpia.toLowerCase().endsWith(RUTAS_GSG.ubicacion.toLowerCase());
    const base = normalizarBaseGsg(pegaronUbicacion ? limpia.slice(0, -RUTAS_GSG.ubicacion.length) : limpia);
    if (!base.ok) return base;
    return { ok: true, base: base.url, ruta: RUTA_UBICACION_POR_DEFECTO, regla: 'sin_url_antigua' };
  }

  const url = normalizarBaseGsg(antigua);
  if (!url.ok) return { ok: false, error: `La URL antigua para enviar la ubicación no es válida (${url.error}) Escribe la URL base y la ruta por separado.` };
  const completa = sinFinal(url.url);
  const baseDir = dir ? normalizarBaseGsg(dir) : null;

  // Regla 2: la URL antigua cuelga de la direccion.
  if (baseDir?.ok && completa.toLowerCase().startsWith(baseDir.url.toLowerCase()) && completa.length > baseDir.url.length) {
    const ruta = completa.slice(baseDir.url.length);
    if (unirUrlGsg(baseDir.url, ruta).ok) return { ok: true, base: baseDir.url, ruta, regla: 'prefijo' };
  }

  // Regla 3: se parte por el unico /api/.
  const camino = completa.replace(/^https?:\/\/[^/]*/i, '');
  const veces = camino.toLowerCase().split('/api/').length - 1;
  if (veces === 1) {
    const corte = completa.toLowerCase().indexOf('/api/', completa.indexOf('//') + 2) + '/api/'.length;
    const base = completa.slice(0, corte);
    const ruta = completa.slice(corte);
    const dirCoincide = !dir || !baseDir?.ok || sinFinal(baseDir.url).toLowerCase() === completa.toLowerCase() || baseDir.url.toLowerCase() === base.toLowerCase();
    if (ruta && dirCoincide && unirUrlGsg(base, ruta).ok) return { ok: true, base, ruta, regla: 'api' };
  }

  return {
    ok: false,
    error: `No se puede convertir sin adivinar la URL antigua de ubicación (${completa}) a URL base + ruta${dir ? ` con la dirección ${sinFinal(dir)}` : ''}. Escribe la URL base de GSG y la ruta para enviar la ubicación por separado en Conexión; mientras tanto no se envía nada a GSG.`,
  };
}

/** Lo que el puerto necesita: base valida + URL de la ubicacion, o el error en palabras. */
export function resolverDestinoGsg(opts: { url: string; rutaUbicacion?: string; ubicacionUrl?: string }): { ok: true; base: string; ruta: string; urlUbicacion: string } | { ok: false; error: string } {
  const ruta = (opts.rutaUbicacion ?? '').trim();
  if (ruta) {
    const base = normalizarBaseGsg(opts.url);
    if (!base.ok) return base;
    const u = unirUrlGsg(base.url, ruta);
    if (!u.ok) return u;
    return { ok: true, base: base.url, ruta, urlUbicacion: u.url };
  }
  const m = migrarUbicacionAntigua(opts.url, opts.ubicacionUrl ?? '');
  if (!m.ok) return m;
  const u = unirUrlGsg(m.base, m.ruta);
  if (!u.ok) return u;
  return { ok: true, base: m.base, ruta: m.ruta, urlUbicacion: u.url };
}

/** La clave enmascarada para mostrarla: solo los ultimos 4 (y nada si es corta). */
export function enmascararClave(clave: string): string | null {
  const c = (clave ?? '').trim();
  if (!c) return null;
  return c.length >= 12 ? `••••${c.slice(-4)}` : '••••';
}

/** Quita la clave de cualquier texto que se vaya a guardar o mostrar (por si GSG la devuelve en su respuesta). */
export function sinClave(texto: string, clave: string): string {
  const c = (clave ?? '').trim();
  return c ? texto.split(c).join('••••') : texto;
}

/**
 * La clave de GSG va SOLO como `X-API-Key`. Nunca como Bearer, nunca en la
 * URL ni en el cuerpo.
 */
function cabecerasDeClave(token: string): Record<string, string> {
  const t = token.trim();
  return t ? { 'x-api-key': t } : {};
}

function huella(texto: string): string {
  return createHash('sha256').update(texto).digest('hex').slice(0, 16);
}

/** El mensaje de un rechazo por la clave, sin la clave. */
export function motivoAutenticacion(status: 401 | 403): string {
  return status === 401
    ? 'GSG rechazó la clave: la API Key de GSG es incorrecta. Corrígela en Conexión; no se reintenta sola'
    : 'GSG rechazó la clave: la API Key de GSG no tiene permisos para esta ruta. Pide a GSG que le dé permiso; no se reintenta sola';
}

/**
 * Puerto real. Manda un POST con el payload tal cual y espera un JSON con
 * `id` o `referencia`; solo un 2xx se da por aceptado.
 */
export function crearPuertoHttp(opts: OpcionesGsg): PuertoGsg {
  const destino = resolverDestinoGsg(opts);
  const crudo = opts.url.trim();
  const base = destino.ok ? destino.base : crudo;
  const doFetch = opts.fetchImpl ?? fetch;
  const clave = opts.token ?? '';
  const errorConfig = !destino.ok ? destino.error : !clave.trim() ? 'Falta la API Key de GSG.' : null;
  const firma = huella(`${base}|${destino.ok ? destino.urlUbicacion : errorConfig}|${huella(clave)}`);
  const limpio = (t: string) => sinClave(t, clave);

  return {
    conectado: () => Boolean(crudo && clave.trim()),
    descripcion: () => `API de GSG en ${base}`,
    urlUbicacion: () => (crudo && destino.ok ? destino.urlUbicacion : null),
    errorConfiguracion: () => errorConfig,
    firma: () => firma,

    async enviar(tipo, payload) {
      if (!destino.ok) {
        return { ok: false, error: `Configuración de GSG no válida: ${destino.error} No se envía nada hasta corregirla.`, reintentable: true, configuracion: true };
      }
      if (!clave.trim()) return { ok: false, error: 'Falta la API Key de GSG. Configúrala antes de enviar.', configuracion: true, reintentable: true };
      let url: string;
      if (tipo === 'ubicacion') url = destino.urlUbicacion;
      else {
        const ruta = tipo === 'numero_reportado' ? (opts.rutaReportados ?? '').trim() || RUTA_REPORTADOS_POR_DEFECTO : RUTAS_GSG[tipo];
        const u = unirUrlGsg(destino.base, ruta);
        if (!u.ok) return { ok: false, error: `Configuración de GSG no válida: ${u.error}`, reintentable: true, configuracion: true };
        url = u.url;
      }
      // Un numero reportado lleva SIEMPRE su clave idempotente (`idReporte`):
      // si GSG lo recibe dos veces tras un corte, es el mismo reporte.
      const claveIdempotente = tipo === 'numero_reportado' && typeof payload.idReporte === 'string'
        ? payload.idReporte.trim()
        : tipo === 'ubicacion' && opts.idempotenciaUbicacion && typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey.trim() : '';
      const idempotente = Boolean(claveIdempotente);
      const cuerpo = tipo === 'ubicacion'
        ? { tracking: payload.tracking ?? payload.referencia, lat: payload.lat ?? payload.latitud, lng: payload.lng ?? payload.longitud }
        : tipo === 'numero_reportado'
          ? (({ idempotencyKey: _clave, ...resto }) => resto)(payload)
          : payload;
      const control = new AbortController();
      const corte = setTimeout(() => control.abort(), (opts.timeoutSegundos ?? 20) * 1000);
      try {
        const respuesta = await doFetch(url, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            ...cabecerasDeClave(clave),
            ...(idempotente ? { 'Idempotency-Key': claveIdempotente } : {}),
          },
          body: JSON.stringify(cuerpo),
          signal: control.signal,
        });

        const texto = await respuesta.text();
        if (!respuesta.ok) {
          const auth = respuesta.status === 401 || respuesta.status === 403 ? (respuesta.status as 401 | 403) : undefined;
          const causa = auth
            ? motivoAutenticacion(auth)
            : respuesta.status === 404
              ? `GSG no tiene esa ruta (${url}): revisa la URL base y la ruta`
              : respuesta.status === 400 || respuesta.status === 422
                ? 'GSG no aceptó los datos enviados'
                : respuesta.status === 429
                  ? 'GSG pidió esperar (demasiadas llamadas)'
                  : respuesta.status >= 500
                    ? 'GSG tuvo un error en su servidor'
                    : 'GSG no aceptó el envío';
          return {
            ok: false,
            error: limpio(`Error ${respuesta.status}: ${causa}.${tipo === 'ubicacion' && !idempotente && (respuesta.status >= 500 || respuesta.status === 408) ? ' Resultado incierto: verifica en GSG si registró la ubicación antes de reintentar.' : ''}${texto.trim() ? ` Respuesta de GSG: ${limpio(texto.trim()).slice(0, 200)}` : ''}`),
            // 5xx, 429 y 408 son del otro lado y pasan solos; un 4xx es culpa
            // del payload (o de la clave) y reintentarlo solo repite el error.
            reintentable: (respuesta.status >= 500 || respuesta.status === 408) && tipo === 'ubicacion' && !idempotente ? false : respuesta.status >= 500 || respuesta.status === 429 || respuesta.status === 408,
            ...(auth ? { autenticacion: auth } : {}),
          };
        }

        let id: string | null = null;
        try {
          const cuerpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
          id = (cuerpo.id ?? cuerpo.referencia ?? cuerpo.codigo ?? null) as string | null;
        } catch {
          // Una API que contesta 2xx con texto plano tambien vale.
        }
        return { ok: true, id };
      } catch (error) {
        const motivo = control.signal.aborted
          ? `GSG no respondió a tiempo (${opts.timeoutSegundos ?? 20} s)`
          : `No se pudo conectar con GSG en ${url}: ${error instanceof Error ? ((error.cause as { code?: string } | undefined)?.code ?? error.message) : String(error)}`;
        return {
          ok: false,
          error: limpio(`${motivo}. ${tipo === 'ubicacion' && !idempotente ? 'Resultado incierto: verifica en GSG si registró la ubicación antes de reintentar; no se reintenta automáticamente.' : 'Se reintenta solo con la misma clave idempotente cuando está habilitada.'}`),
          reintentable: tipo !== 'ubicacion' || idempotente,
        };
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
    descripcion: () => 'falta GSG_URL (la URL base de GSG): lo reportable se guarda y saldra entero al conectarla',
    async enviar() {
      return { ok: false, error: 'la API de GSG todavia no esta conectada', reintentable: true };
    },
  };
}

/** El puerto desde el .env (sin pantalla). GSG_API_KEY; GSG_TOKEN se lee por compatibilidad. */
export function crearPuertoGsg(config: { GSG_URL: string; GSG_TOKEN: string; GSG_API_KEY?: string; GSG_LOCATION_PATH?: string; GSG_REPORTADOS_PATH?: string; GSG_SEND_LOCATION_URL?: string; GSG_IDEMPOTENCY_SUPPORTED?: string }): PuertoGsg {
  return config.GSG_URL.trim()
    ? crearPuertoHttp({
        url: config.GSG_URL,
        token: (config.GSG_API_KEY ?? '').trim() || config.GSG_TOKEN,
        rutaUbicacion: config.GSG_LOCATION_PATH || undefined,
        rutaReportados: config.GSG_REPORTADOS_PATH || undefined,
        idempotenciaUbicacion: config.GSG_IDEMPOTENCY_SUPPORTED === 'true',
        ubicacionUrl: config.GSG_SEND_LOCATION_URL || undefined,
      })
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
  numero_reportado:
    'tipo (numero_reportado), tracking, referencia, telefono (tal como llego), error (telefono_invalido | sin_whatsapp | envio_fallido | tracking_falta |' +
    ' tracking_invalido | tracking_duplicado | tracking_de_otro_pedido | telefono_de_motorizado | no_soy_yo), mensaje (en palabras), detalle, reportadoAt, dia,' +
    ' idReporte (va tambien en la cabecera Idempotency-Key). Un reporte por tracking + error: se corrige con POST /api/v1/reportados/{tracking}/correccion',
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

export async function payloadUbicacionDelPedido(repos: Pick<Repos, 'entregas'>, solicitud: Solicitud, lote: Lote): Promise<Record<string, unknown>> {
  const vinculadas = solicitud.phone ? await repos.entregas.vivasDeLoteYTelefono(lote.id, solicitud.phone) : [];
  const pedido = vinculadas.find(e => e.referencia === solicitud.referencia);
  return { ...payloadUbicacion(solicitud, lote), tracking: pedido?.datosEnvio?.tracking ?? solicitud.referencia };
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
  /** El error de cada envio que no salio (sin repetir), para mostrarlo tal cual. */
  errores?: string[];
}

/**
 * Los despachos en marcha, por cola (una por tienda). Se hacen UNO DETRAS DE
 * OTRO: la ubicacion sale en cuanto llega (ver rutas/inbound.ts) y ademas hay
 * una pasada cada minuto y el boton "reenviar"; si dos coincidieran leyendo
 * los mismos pendientes, GSG recibiria la misma ubicacion dos veces.
 */
const despachosEnMarcha = new WeakMap<object, Promise<unknown>>();

/**
 * Las colas paradas porque GSG rechazo la clave (401/403), con la huella de
 * la configuracion con la que se rechazo. Mientras la configuracion sea la
 * misma, las pasadas automaticas no vuelven a llamar (insistir con la misma
 * clave solo repite el rechazo). Se levanta sola al cambiar la URL, la ruta o
 * la clave, o a mano con «Enviar ahora» / «Enviar a GSG» (`manual`). Vive en
 * memoria: un reinicio da como mucho UN intento mas.
 */
const paradasPorClave = new WeakMap<object, { firma: string; error: string }>();

const firmaDe = (puerto: PuertoGsg): string => puerto.firma?.() ?? puerto.descripcion();

/** Si la cola esta parada por un rechazo de la clave con esta misma configuracion: el motivo, o null. */
export function paradaPorClave(repos: { rutas: RutasRepo }, puerto: PuertoGsg): string | null {
  const p = paradasPorClave.get(repos.rutas);
  return p && p.firma === firmaDe(puerto) ? p.error : null;
}

/**
 * Vacia la cola contra GSG.
 *
 * Con el puerto sin conectar no se toca nada: los reportes se quedan
 * 'pendiente' y se mandaran enteros el dia que haya API. Con la
 * configuracion mal (URL base o ruta invalidas) no sale nada: cada reporte
 * se queda 'pendiente' con el error a la vista. Solo un 2xx lo marca
 * 'enviado'. Por codigo:
 *  - 401/403: 'fallido' con el motivo (clave incorrecta / sin permisos) y la
 *    cola se para hasta que cambie la configuracion o alguien reintente a mano.
 *  - 429, 5xx, 408, timeout o sin red: se queda 'pendiente' y se reintenta en
 *    la siguiente pasada.
 *  - Otro 4xx: 'fallido' para que no atasque la cola detras.
 */
export function despacharReportes(
  repos: { rutas: RutasRepo },
  puerto: PuertoGsg,
  limite = 25,
  /** Solo estos tipos (el envio al momento solo manda ubicaciones). Sin esto, todo. */
  soloTipos?: TipoReporte[],
  /** manual = lo pidio una persona («Enviar ahora»): intenta aunque la cola este parada por la clave. */
  opciones?: { manual?: boolean },
): Promise<DespachoResumen> {
  const anterior = despachosEnMarcha.get(repos.rutas) ?? Promise.resolve();
  const este = anterior.catch(() => undefined).then(() => despacharAhora(repos, puerto, limite, soloTipos, opciones?.manual ?? false));
  despachosEnMarcha.set(repos.rutas, este);
  return este;
}

async function despacharAhora(
  repos: { rutas: RutasRepo },
  puerto: PuertoGsg,
  limite: number,
  soloTipos: TipoReporte[] | undefined,
  manual: boolean,
): Promise<DespachoResumen> {
  if (!puerto.conectado() && !puerto.errorConfiguracion?.()) {
    return { intentados: 0, enviados: 0, fallidos: 0, motivo: puerto.descripcion() };
  }
  if (manual) paradasPorClave.delete(repos.rutas);
  const parada = paradaPorClave(repos, puerto);
  if (parada) return { intentados: 0, enviados: 0, fallidos: 0, motivo: parada, errores: [parada] };
  paradasPorClave.delete(repos.rutas);

  // Se leen DENTRO de la fila de despachos: lo que otro despacho ya mando
  // no vuelve a salir.
  const pendientes = soloTipos
    ? (await repos.rutas.reportesPendientes(Math.max(limite, 200))).filter((r) => soloTipos.includes(r.tipo)).slice(0, limite)
    : await repos.rutas.reportesPendientes(limite);
  const resumen: DespachoResumen = { intentados: pendientes.length, enviados: 0, fallidos: 0 };

  for (const reporte of pendientes) {
    // Lo del Modulo desarrollador (numeros 51 000 0/1…, referencias PRUEBA-)
    // solo va al simulador. Contra la API real de GSG no sale NUNCA: se
    // aparta con el motivo a la vista en vez de quedarse esperando a salir.
    if (esReporteDePrueba(reporte.payload) && !puerto.esSimulador?.()) {
      await repos.rutas.marcarReporte(reporte.id, 'fallido', { error: 'Reporte de prueba (Módulo desarrollador): solo se manda al simulador de GSG, nunca a la API real.' });
      resumen.fallidos++;
      continue;
    }
    if (!(await repos.rutas.reservarReporte(reporte.id))) continue;
    const salida = await puerto.enviar(reporte.tipo, { ...reporte.payload, idempotencyKey: 'gsgchat-ubicacion-' + reporte.id });
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
    if (salida.error && !(resumen.errores ??= []).includes(salida.error)) resumen.errores.push(salida.error);
    // La clave no vale: los de detras fallarian igual. Se para la cola (los
    // demas siguen 'pendiente', sin tocar) hasta que cambie la configuracion.
    if (salida.autenticacion) {
      paradasPorClave.set(repos.rutas, { firma: firmaDe(puerto), error: salida.error ?? motivoAutenticacion(salida.autenticacion) });
      resumen.intentados = pendientes.indexOf(reporte) + 1;
      break;
    }
  }

  return resumen;
}

/** Si un reporte es de datos de prueba del Modulo desarrollador. */
export function esReporteDePrueba(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload) return false;
  const ref = String(payload.referencia ?? '');
  return ref.toUpperCase().startsWith(PREFIJO_REFERENCIA_PRUEBA) || esNumeroDePrueba(String(payload.telefono ?? ''));
}

/** Lo que hay en la cola, en JSON, para llevarselo a mano mientras no hay API. */
export function exportarCola(reportes: Reporte[]): string {
  return reportes.map((r) => JSON.stringify({ ...r.payload, encoladoEn: r.createdAt })).join('\n');
}
