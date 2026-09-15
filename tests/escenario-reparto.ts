/**
 * Un día de reparto de mentira, con todo lo de fuera mockeado.
 *
 * Las pruebas que se apoyan en esto hacen preguntas de operación ("¿cuántos
 * no han dado su ubicación?", "¿qué números faltan?", "¿le llegó a GSG?") a
 * la API real, con el servidor real, y lo único falso es lo que no está en
 * nuestra mano:
 *
 *  - **WhatsApp**: el cliente falso apunta lo que le mandan en vez de
 *    enviarlo. Además se le puede decir qué números no tienen WhatsApp
 *    (lo que consulta el motor antes del primer mensaje) y qué números
 *    rechaza Meta con un código de error, como pasa en la calle.
 *  - **La API de GSG**: hoy no existe. Aquí se levanta una de mentira sobre
 *    `fetch` que recibe cada reporte, guarda lo que le llega y se puede poner
 *    a fallar (caída, rechazo, sin red) para ver qué hace la cola.
 *  - **El reloj**: las pausas y las esperas se recorren avanzando `ahora`,
 *    no esperando de verdad.
 *  - **Los clientes**: contestan con un pin, con un enlace de mapa, con
 *    texto, con "no soy yo", con BAJA... o no contestan nunca.
 *
 * Nada de esto toca Postgres, Redis ni la red.
 */

import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { crearMotor, OPCIONES_POR_DEFECTO, type Motor, type ResultadoTick } from '../src/rutas/motor.js';
import { crearPuertoGsg, despacharReportes, RUTAS_GSG, type DespachoResumen } from '../src/rutas/gsg.js';
import { ALERTAS_POR_DEFECTO, revisarAlertas, type ResultadoAlertas } from '../src/rutas/alertas.js';
import { crearMonitor, type Monitor } from '../src/salud/monitor.js';
import { politicaDesdeConfig, type Politica } from '../src/salud/politica.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';
import type { Solicitud, TipoReporte } from '../src/db/rutas.js';
import {
  createFakeRepos,
  createFakeSettings,
  createFakeWhatsApp,
  type FakeRepos,
  type FakeWhatsApp,
  CLAVE_API_PRUEBA,
} from './fakes.js';

// ------------------------------------------------------------- tipos

export interface ClienteDeLote {
  /** Como viene en la lista de GSG: nueve dígitos, o lo que hayan escrito. */
  telefono: string;
  nombre?: string;
  referencia?: string;
  distrito?: string;
  direccion?: string;
}

/** Lo que puede contestar un cliente cuando se le pide la ubicación. */
export type RespuestaCliente =
  | { pin: { lat: number; lng: number } }
  | { enlace: string }
  | { texto: string }
  /** Una foto de la fachada, un audio con la dirección, un documento... sin texto. */
  | { adjunto: 'image' | 'audio' | 'video' | 'document' | 'sticker' }
  | { baja: true }
  | { noSoyYo: true };

export interface RechazoDeMeta {
  /** Código de la Cloud API (131026 = no tiene WhatsApp, 131021 = número inválido, 130429 = rate limit). */
  code: number;
  message: string;
  /** Si Meta lo considera pasajero. */
  retryable?: boolean;
}

export interface OpcionesEscenario {
  /** Números (con 51) que el proveedor dice que no tienen WhatsApp. */
  sinWhatsApp?: string[];
  /** Números (con 51) a los que Meta rechaza el envío, y con qué. */
  rechazos?: Record<string, RechazoDeMeta>;
  /** Con URL de GSG configurada (por defecto sí: es lo que se quiere probar). */
  gsgConectado?: boolean;
  /** Teléfono del coordinador al que avisar por WhatsApp. Vacío = a nadie. */
  supervisor?: string;
  /**
   * Hora de arranque del reloj de la prueba. Por defecto, el ahora real:
   * las respuestas de los clientes entran por el webhook de verdad, que
   * fecha con la hora real, y un reloj falso lejos de ella deja esas
   * respuestas "en el futuro" para el motor.
   */
  arranque?: Date;
  /** Franja de envío del motor. Por defecto todo el día, para que la hora real no importe. */
  horario?: [inicio: number, fin: number];
  /** Cómo se presenta el negocio. */
  negocio?: string;
  /** Modo prueba: solo se escribe a estos números (con 51). La lista se puede cambiar desde la prueba. */
  soloNumeros?: string[];
  /**
   * Con el monitor de salud (anti-baneo) enchufado al sender, al motor y al
   * servidor, con la política del perfil no oficial pero sin sus cupos de
   * volumen, para que lo que se pruebe sea el riesgo y no el ritmo.
   */
  conSalud?: boolean;
}

/** Lo que recibió la API de GSG de mentira. */
export interface ReporteRecibido {
  ruta: string;
  tipo: TipoReporte;
  cuerpo: Record<string, unknown>;
  token: string | null;
  /** Cuándo llegó, según el reloj de la prueba. */
  en: Date;
}

export type ModoGsg = 'ok' | 'caido' | 'rechaza' | 'sin_red';

export interface GsgFalso {
  /** Cómo contesta ahora mismo. Se cambia a mitad de prueba. */
  modo: ModoGsg;
  recibido: ReporteRecibido[];
  llamadas: number;
  ubicaciones(): Record<string, unknown>[];
  incidencias(): Record<string, unknown>[];
  resumenes(): Record<string, unknown>[];
  /** Los teléfonos de los que GSG ya tiene ubicación. */
  telefonosConUbicacion(): string[];
  limpiar(): void;
}

export interface RespuestaApi<T = Record<string, unknown>> {
  status: number;
  body: T;
}

export interface CifrasLote {
  lote: Record<string, unknown>;
  total: number;
  conUbicacion: number;
  sinUbicacion: number;
  cifras: Record<string, number>;
  incidencias: Record<string, number>;
}

export interface SinUbicacion {
  total: number;
  telefonos: string[];
  items: Solicitud[];
}

export interface Escenario {
  app: FastifyInstance;
  repos: FakeRepos;
  wa: FakeWhatsApp;
  motor: Motor;
  gsg: GsgFalso;
  auth: Record<string, string>;

  ahora(): Date;
  /** Cuándo arrancó el reloj de la prueba. */
  inicio: Date;
  avanzar(minutos: number): void;
  avanzarSegundos(segundos: number): void;

  /** Lo que "sabe" el proveedor, editable a mitad de prueba. */
  sinWhatsApp: Set<string>;
  rechazos: Record<string, RechazoDeMeta>;
  /** La lista blanca del modo prueba (vacía = se escribe a todos). */
  soloNumeros: string[];
  /** El monitor de salud, si se pidió `conSalud`. */
  salud: Monitor | null;

  /** La API real, como la llamaría un programa con su clave. */
  api: {
    get<T = Record<string, unknown>>(url: string): Promise<RespuestaApi<T>>;
    post<T = Record<string, unknown>>(url: string, body?: unknown): Promise<RespuestaApi<T>>;
    patch<T = Record<string, unknown>>(url: string, body?: unknown): Promise<RespuestaApi<T>>;
    delete<T = Record<string, unknown>>(url: string): Promise<RespuestaApi<T>>;
  };

  /** Carga un lote por la API (como lo hará GSG) y lo arranca. */
  cargarLote(
    nombre: string,
    clientes: ClienteDeLote[],
    opciones?: { arrancar?: boolean; externoId?: string },
  ): Promise<{ loteId: string; cuerpo: Record<string, unknown> }>;

  /**
   * Deja trabajar al motor hasta que no tenga nada que hacer ahora mismo,
   * avanzando el reloj para saltar las pausas entre mensajes. Devuelve lo
   * que hizo en cada pasada que hizo algo.
   */
  trabajar(opciones?: { maxPasadas?: number }): Promise<ResultadoTick[]>;

  /** Vence la espera de respuesta y vuelve a trabajar: es una vuelta de insistencias. */
  insistir(esperaMinutos?: number): Promise<ResultadoTick[]>;

  /** El cliente contesta por WhatsApp (entra por el webhook real). */
  contesta(telefono: string, respuesta: RespuestaCliente): Promise<RespuestaApi>;

  // --- las preguntas de operación, contra la API ---------------------------
  vistas(loteId?: string): Promise<Record<string, number>>;
  sinUbicacion(loteId?: string): Promise<SinUbicacion>;
  cifrasLote(loteId: string): Promise<CifrasLote>;
  solicitudes(params: Record<string, string | number | undefined>): Promise<{ items: Solicitud[]; total: number }>;
  buscar(q: string, loteId?: string): Promise<Solicitud[]>;

  /** Vacía la cola contra la API de GSG (de mentira) por el endpoint real. */
  despacharAGsg(): Promise<DespachoResumen>;
  /** Una pasada de avisos: resumen a GSG y aviso al coordinador. */
  revisarAlertas(): Promise<ResultadoAlertas>;

  /** Los mensajes que salieron hacia un número. */
  mensajesA(telefono: string): Array<Record<string, unknown>>;

  cerrar(): Promise<void>;
}

// ------------------------------------------------------------ constantes

export const GSG_URL_FALSA = 'https://gsg.example/api/v1';
export const GSG_TOKEN_FALSO = 'token-gsg-de-prueba';

/**
 * Pausa entre mensajes del motor de prueba. Corta a propósito: con la de
 * producción (15-30 s) una lista de 120 tarda tanto en escribirse que a los
 * primeros ya les toca el recordatorio antes de acabar la primera vuelta, y
 * eso mezcla las cifras que estas pruebas quieren ver limpias.
 */
export const PAUSA_SEGUNDOS = 5;

/** Un punto en Miraflores: dentro de la cobertura de Lima. */
export const PIN_LIMA = { lat: -12.1211, lng: -77.0301 };
/** Un punto en Arequipa: fuera de la cobertura. */
export const PIN_FUERA = { lat: -16.409, lng: -71.5375 };

const cola: OutboundQueue = {
  async enqueue() {},
  async enqueueMany(jobs) {
    return jobs.length;
  },
  async pause() {},
  async resume() {},
  async counts() {
    return {};
  },
  async close() {},
};

// -------------------------------------------------------------- GSG falso

type MetodoHttp = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** La URL de una llamada a fetch, venga como string, URL o Request. */
function urlDe(entrada: Parameters<typeof fetch>[0]): string {
  if (typeof entrada === 'string') return entrada;
  if (entrada instanceof URL) return entrada.href;
  return (entrada as { url: string }).url;
}

interface GsgFalsoInterno extends GsgFalso {
  /** Lo que se cuelga de `fetch`. */
  atender: typeof fetch;
  /** De dónde saca la hora de llegada de cada reporte. */
  reloj(f: () => Date): void;
}

function crearGsgFalso(): GsgFalsoInterno {
  const recibido: ReporteRecibido[] = [];
  let ahora = () => new Date();

  const gsg: GsgFalsoInterno = {
    modo: 'ok',
    recibido,
    llamadas: 0,
    ubicaciones: () => recibido.filter((r) => r.tipo === 'ubicacion').map((r) => r.cuerpo),
    incidencias: () => recibido.filter((r) => r.tipo === 'incidencia').map((r) => r.cuerpo),
    resumenes: () => recibido.filter((r) => r.tipo === 'resumen').map((r) => r.cuerpo),
    telefonosConUbicacion: () => gsg.ubicaciones().map((u) => String(u.telefono)),
    limpiar: () => {
      recibido.length = 0;
      gsg.llamadas = 0;
    },
    reloj: (f) => {
      ahora = f;
    },

    atender: (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = urlDe(entrada);
      gsg.llamadas++;

      if (gsg.modo === 'sin_red') throw new TypeError('fetch failed: getaddrinfo ENOTFOUND gsg.example');
      if (gsg.modo === 'caido') return new Response('<html>502 Bad Gateway</html>', { status: 502 });

      const camino = url.slice(GSG_URL_FALSA.length);
      const tipo = (Object.entries(RUTAS_GSG) as Array<[TipoReporte, string]>).find(([, ruta]) => ruta === camino)?.[0];
      if (!tipo) return new Response(JSON.stringify({ error: `ruta desconocida ${camino}` }), { status: 404 });

      const headers = new Headers(init?.headers);
      const autorizacion = headers.get('authorization');
      const token = autorizacion?.startsWith('Bearer ') ? autorizacion.slice(7) : null;
      if (token !== GSG_TOKEN_FALSO) return new Response(JSON.stringify({ error: 'token inválido' }), { status: 401 });

      if (gsg.modo === 'rechaza') {
        return new Response(JSON.stringify({ error: 'payload no válido: falta el campo pedido' }), { status: 422 });
      }

      const cuerpo = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      recibido.push({ ruta: camino, tipo, cuerpo, token, en: ahora() });
      return new Response(JSON.stringify({ id: `GSG-${tipo.toUpperCase()}-${recibido.length}` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  };

  return gsg;
}

// ---------------------------------------------------------------- armado

export async function crearEscenario(opciones: OpcionesEscenario = {}): Promise<Escenario> {
  const conGsg = opciones.gsgConectado ?? true;
  const config = loadConfig({
    PUBLIC_BASE_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgres://x/y',
    WHATSAPP_TOKEN: 't',
    WHATSAPP_PHONE_NUMBER_ID: 'PNID',
    WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
    WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
    WHATSAPP_VERIFY_TOKEN: 'verify-me',
    TRACKING_SECRET: 'x'.repeat(40),
    GEO_BBOX: 'lima',
    RUTAS_PAIS: 'peru',
    RUTAS_SUPERVISOR: opciones.supervisor ?? '',
    DEV_SIMULATE_INBOUND: 'true',
    BUSINESS_NAME: opciones.negocio ?? 'Tienda de prueba',
    GSG_URL: conGsg ? GSG_URL_FALSA : '',
    GSG_TOKEN: conGsg ? GSG_TOKEN_FALSO : '',
  } as NodeJS.ProcessEnv);

  const inicio = opciones.arranque ?? new Date();
  let ahora = inicio;
  const reloj = () => ahora;
  const [horaInicio, horaFin] = opciones.horario ?? [0, 24];

  // La API de GSG de mentira se cuelga de `fetch` ANTES de armar el servidor:
  // el puerto real captura el fetch global al crearse.
  const gsg = crearGsgFalso();
  gsg.reloj(reloj);
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (urlDe(entrada).startsWith(GSG_URL_FALSA)) return gsg.atender(entrada, init);
    return fetchOriginal(entrada, init);
  }) as typeof fetch;

  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();

  // Lo que el proveedor sabe de cada número: si tiene WhatsApp y si Meta lo
  // rechaza. Se envuelve el cliente falso para que falle como fallaría el real.
  const sinWhatsApp = new Set(opciones.sinWhatsApp ?? []);
  const rechazos = opciones.rechazos ?? {};
  const soloNumeros = opciones.soloNumeros ?? [];
  wa.tieneWhatsApp = async (phone) => !sinWhatsApp.has(phone);
  const conRechazo = <A extends unknown[], R>(f: (to: string, ...resto: A) => Promise<R>) =>
    async (to: string, ...resto: A): Promise<R> => {
      const rechazo = rechazos[to];
      if (rechazo) {
        throw new WhatsAppApiError(rechazo.message, 400, rechazo.code, 'rechazado por Meta', rechazo.retryable ?? false);
      }
      return f(to, ...resto);
    };
  wa.sendText = conRechazo(wa.sendText.bind(wa));
  wa.sendLocationRequest = conRechazo(wa.sendLocationRequest.bind(wa));
  wa.sendButtons = conRechazo(wa.sendButtons.bind(wa));

  const settings = await createFakeSettings(config);

  // El monitor de salud, solo si se pide: con él, cada "no soy yo", cada BAJA
  // y cada rechazo de Meta pesan, y el número se frena solo.
  const politicaBase: Politica = {
    ...politicaDesdeConfig(config, 'no_oficial'),
    maxPorMinuto: 100,
    maxPorHora: 1000,
    nuevosContactosPorDia: 1000,
    pausaMinMs: 1000,
    pausaMaxMs: 1000,
    horaInicio: 0,
    horaFin: 24,
    diasPermitidos: [0, 1, 2, 3, 4, 5, 6],
    humanizar: false,
    warmup: { startPerDay: 5000, growth: 2, hardCap: 10000, reinicioTrasDiasInactivo: 30 },
  };
  const politica = () => politicaBase;
  const salud = opciones.conSalud
    ? crearMonitor({ repos, politica, phoneNumberId: () => 'PNID', ahora: reloj, azar: () => 0 })
    : null;

  const sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 5000, growth: 2, hardCap: 10000 },
    maxMarketingPerContact7d: 2,
    // Cliente no oficial: la ventana de 24 h no aplica.
    serviceWindowApplies: false,
    now: reloj,
    soloNumeros: () => soloNumeros,
    ...(salud ? { salud, politica } : {}),
  });

  const app = await buildServer({
    config,
    repos,
    settings,
    wa,
    sender,
    queue: cola,
    logger: false,
    ...(salud ? { salud, politica } : {}),
  });
  await app.ready();

  const puertoGsg = crearPuertoGsg(config);
  const motor = crearMotor({
    repos,
    sender,
    wa,
    gsg: puertoGsg,
    opciones: {
      ...OPCIONES_POR_DEFECTO,
      pausaMinSegundos: PAUSA_SEGUNDOS,
      pausaMaxSegundos: PAUSA_SEGUNDOS,
      horaInicio,
      horaFin,
      negocio: config.businessName,
    },
    usarPlantilla: () => false,
    ahora: reloj,
    // Pausa mínima siempre: la prueba controla el reloj.
    azar: () => 0,
    ...(salud ? { salud, politica } : {}),
  });

  const auth = { authorization: `Bearer ${CLAVE_API_PRUEBA}` };
  const memoriaAlertas = { ultimoResumen: new Map<string, number>(), ultimoAviso: new Map<string, number>() };

  async function llamar<T>(method: MetodoHttp, url: string, body?: unknown): Promise<RespuestaApi<T>> {
    const res = await app.inject({
      method,
      url,
      headers: auth,
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
    let parsed: unknown;
    try {
      parsed = res.json();
    } catch {
      parsed = { raw: res.body };
    }
    return { status: res.statusCode, body: parsed as T };
  }

  const api: Escenario['api'] = {
    get: (url) => llamar('GET', url),
    post: (url, body) => llamar('POST', url, body ?? {}),
    patch: (url, body) => llamar('PATCH', url, body ?? {}),
    delete: (url) => llamar('DELETE', url),
  };

  const conLote = (url: string, loteId?: string) =>
    loteId ? `${url}${url.includes('?') ? '&' : '?'}loteId=${encodeURIComponent(loteId)}` : url;

  const escenario: Escenario = {
    app,
    repos,
    wa,
    motor,
    gsg,
    auth,
    ahora: reloj,
    inicio,
    sinWhatsApp,
    rechazos,
    soloNumeros,
    salud,
    avanzar(minutos) {
      ahora = new Date(ahora.getTime() + minutos * 60_000);
    },
    avanzarSegundos(segundos) {
      ahora = new Date(ahora.getTime() + segundos * 1000);
    },
    api,

    async cargarLote(nombre, clientes, opts = {}) {
      const { status, body } = await api.post('/admin/rutas/lotes', {
        nombre,
        arrancar: opts.arrancar ?? true,
        externoId: opts.externoId,
        filas: clientes.map((c) => ({
          telefono: c.telefono,
          nombre: c.nombre,
          referencia: c.referencia,
          distrito: c.distrito,
          direccion: c.direccion,
        })),
      });
      if (status !== 200) throw new Error(`no se pudo cargar el lote: ${status} ${JSON.stringify(body)}`);
      return { loteId: (body.lote as { id: string }).id, cuerpo: body };
    },

    async trabajar(opts = {}) {
      const hecho: ResultadoTick[] = [];
      const maxPasadas = opts.maxPasadas ?? 500;
      for (let pasada = 0; pasada < maxPasadas; pasada++) {
        const salida = await motor.tick();
        if (salida.accion !== 'nada') {
          hecho.push(salida);
          continue;
        }
        if (salida.motivo?.includes('pausa')) {
          escenario.avanzarSegundos(PAUSA_SEGUNDOS);
          continue;
        }
        // "No hay nada pendiente", fuera de horario o parado: se acabó por ahora.
        if (salida.lotesCerrados?.length) hecho.push(salida);
        return hecho;
      }
      throw new Error(`el motor no paró en ${maxPasadas} pasadas`);
    },

    async insistir(esperaMinutos = OPCIONES_POR_DEFECTO.esperaRespuestaMinutos) {
      escenario.avanzar(esperaMinutos + 1);
      return escenario.trabajar();
    },

    async contesta(telefono, respuesta) {
      const phone = telefono.startsWith('51') ? telefono : `51${telefono}`;
      const carga: Record<string, unknown> = { phone };
      if ('pin' in respuesta) carga.location = { latitude: respuesta.pin.lat, longitude: respuesta.pin.lng };
      else if ('enlace' in respuesta) carga.text = respuesta.enlace;
      else if ('texto' in respuesta) carga.text = respuesta.texto;
      else if ('adjunto' in respuesta) carga.adjunto = respuesta.adjunto;
      else if ('baja' in respuesta) carga.text = 'BAJA';
      else carga.text = 'no soy yo, se equivocaron de número';
      return api.post('/admin/dev/inbound', carga);
    },

    async vistas(loteId) {
      const { body } = await api.get<{ cifras: Record<string, number> }>(conLote('/admin/rutas/vistas', loteId));
      return body.cifras;
    },

    async sinUbicacion(loteId) {
      const { items, total } = await escenario.solicitudes({ vista: 'sin_ubicacion', loteId, limit: 500 });
      return { total, items, telefonos: items.map((s) => s.phone ?? s.telefonoCrudo) };
    },

    async cifrasLote(loteId) {
      const { status, body } = await api.get<CifrasLote>(`/admin/rutas/lotes/${loteId}`);
      if (status !== 200) throw new Error(`lote ${loteId}: ${status}`);
      return body;
    },

    async solicitudes(params) {
      const query = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
      const { body } = await api.get<{ items: Solicitud[]; total: number }>(`/admin/rutas/solicitudes?${query}`);
      return body;
    },

    async buscar(q, loteId) {
      return (await escenario.solicitudes({ q, loteId, limit: 100 })).items;
    },

    async despacharAGsg() {
      const { body } = await api.post<DespachoResumen>('/admin/rutas/cola/despachar');
      return body;
    },

    revisarAlertas() {
      return revisarAlertas(
        {
          repos,
          sender,
          gsg: puertoGsg,
          opciones: { ...ALERTAS_POR_DEFECTO, supervisor: opciones.supervisor ?? '' },
          ahora: reloj,
        },
        memoriaAlertas,
      );
    },

    mensajesA(telefono) {
      const phone = telefono.startsWith('51') ? telefono : `51${telefono}`;
      return wa.sent.filter((m) => String(m.to ?? '') === phone);
    },

    async cerrar() {
      globalThis.fetch = fetchOriginal;
      await app.close();
    },
  };

  return escenario;
}

// --------------------------------------------------------------- ayudas

/** N clientes con números correlativos, para no escribirlos a mano. */
export function clientesDePrueba(cuantos: number, desde = 987000001): ClienteDeLote[] {
  const distritos = ['Miraflores', 'Surco', 'San Borja', 'Lince', 'Breña', 'Jesús María', 'San Isidro', 'Pueblo Libre'];
  return Array.from({ length: cuantos }, (_, i) => ({
    telefono: String(desde + i),
    nombre: `Cliente ${i + 1}`,
    referencia: `P-${1000 + i + 1}`,
    distrito: distritos[i % distritos.length],
  }));
}

/** El número tal como lo guarda el sistema (con el 51 delante). */
export const conPais = (telefono: string): string => (telefono.startsWith('51') ? telefono : `51${telefono}`);

/** Vacía la cola directamente contra un puerto, sin pasar por la API. */
export { despacharReportes };
