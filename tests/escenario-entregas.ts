/**
 * Un día de entregas de mentira, con todo lo de fuera mockeado.
 *
 * Lo que se prueba es el flujo entero con el servidor real:
 *
 *   GSG (simulado) dice quién falta ubicación y quién falta confirmar
 *     → el reparto pide la ubicación, este módulo pide la confirmación
 *     → los clientes contestan (pin, "sí", "no", "mañana", cosas raras)
 *     → con las dos cosas, el pin va a un motorizado (otros diez números)
 *     → el motorizado dice en cuánto entrega ("40", "media hora", "no puedo")
 *     → al cliente se le avisa con una hora de margen
 *     → GSG recibe la confirmación y la entrega, y pasa al cliente a terminados.
 *
 * Lo único falso: WhatsApp (apunta lo que se manda), el sistema de GSG (el
 * simulador de src/entregas/gsg-simulado.ts colgado de `fetch`, como si
 * fuera su API), la IA (un lector que devuelve lo que la prueba diga) y el
 * reloj. Nada toca Postgres, Redis ni la red.
 */

import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import { conReglaGsg } from '../src/entregas/regla-gsg.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { crearMotor, OPCIONES_POR_DEFECTO, type Motor, type ResultadoTick } from '../src/rutas/motor.js';
import { despacharReportes, type DespachoResumen } from '../src/rutas/gsg.js';
import { crearConexionGsg, type ServicioConexionGsg } from '../src/rutas/conexion-gsg.js';
import { cargarLote } from '../src/rutas/cargar.js';
import { PLANES } from '../src/rutas/telefono.js';
import { crearGsgSimulado, type GsgSimulado } from '../src/entregas/gsg-simulado.js';
import { crearServicioEntregas, type ServicioEntregas, type FilaEntrega, type ResumenEntregas } from '../src/entregas/servicio.js';
import { crearMotorEntregas, type MotorEntregas, type ResultadoTickEntregas } from '../src/entregas/motor.js';
import type { LectorIA } from '../src/entregas/interpretar.js';
import type { Geocodificador } from '../src/entregas/geocodificar.js';
import type { MensajeIA } from '../src/ia/proveedores.js';
import { crearBus, type Bus, type NombreEvento } from '../src/eventos/bus.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { crearServicioIA, type ServicioIA } from '../src/ia/servicio.js';
import { createFakeRutas } from './fakes-rutas.js';
import { createFakeEntregas } from './fakes-entregas.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos, type FakeWhatsApp, CLAVE_API_PRUEBA } from './fakes.js';

export const GSG_URL_FALSA = 'https://gsg.example/api/v1';
export const GSG_TOKEN_FALSO = 'token-gsg-de-prueba';
export const PAUSA_SEGUNDOS = 5;

/** Un punto en Miraflores: dentro de la cobertura de Lima. */
export const PIN_LIMA = { lat: -12.1211, lng: -77.0301 };

export type RespuestaCliente = { pin: { lat: number; lng: number } } | { enlace: string } | { texto: string } | { baja: true } | { adjunto: 'image' | 'audio' | 'video' | 'document' | 'sticker' } | { audio: string } | { boton: { id: string; title: string } };

export interface RespuestaApi<T = Record<string, unknown>> {
  status: number;
  body: T;
}

/** La IA de mentira: la prueba decide qué contesta a cada consulta. */
export interface IAFalsa extends LectorIA {
  /** Lo que devuelve el modelo, por orden de llamada (se consume). Vacío = falla. */
  respuestas: string[];
  llamadas: Array<{ sistema: string; usuario: string }>;
  /** Si está "conectada" (con clave). */
  disponible: boolean;
}

export interface EscenarioEntregas {
  app: FastifyInstance;
  repos: FakeRepos;
  /** Los ajustes guardados (settings) del escenario: para dejar frases propias, ajustes, etc. */
  settingsRepo: ReturnType<typeof createMemorySettingsRepo>;
  wa: FakeWhatsApp;
  simulador: GsgSimulado;
  conexionGsg: ServicioConexionGsg;
  entregas: ServicioEntregas;
  motorReparto: Motor;
  motorEntregas: MotorEntregas;
  ia: IAFalsa;
  /** El asistente real (solo con `agente: true`). */
  asistente?: ServicioIA;
  /** El bus de eventos y todo lo que se emitió por él (nombre + payload). */
  bus: Bus;
  eventos: Array<{ nombre: NombreEvento; payload: unknown }>;
  ahora(): Date;
  inicio: Date;
  avanzar(minutos: number): void;
  avanzarSegundos(segundos: number): void;
  api: {
    get<T = Record<string, unknown>>(url: string): Promise<RespuestaApi<T>>;
    post<T = Record<string, unknown>>(url: string, body?: unknown): Promise<RespuestaApi<T>>;
    delete<T = Record<string, unknown>>(url: string): Promise<RespuestaApi<T>>;
  };
  /** Deja trabajar a los dos motores (reparto y entregas) hasta que no tengan nada que hacer ahora. */
  trabajar(opciones?: { maxPasadas?: number }): Promise<Array<ResultadoTick | ResultadoTickEntregas>>;
  /** Alguien escribe por WhatsApp (entra por el webhook real). */
  contesta(telefono: string, respuesta: RespuestaCliente): Promise<RespuestaApi>;
  /** Lo que salió hacia un número (solo textos, pins y peticiones de ubicación). */
  mensajesA(telefono: string): Array<Record<string, unknown>>;
  /** Solo los textos que salieron hacia un número. */
  textosA(telefono: string): string[];
  /** Los mensajes con botones que salieron hacia un número (con sus botones). */
  botonesA(telefono: string): Array<{ kind: 'buttons'; to: string; body: string; buttons: Array<{ id: string; title: string }> }>;
  /** La entrega de hoy de un cliente (por teléfono o referencia), tal como la ve la pantalla. */
  entrega(quien: string): Promise<FilaEntrega | undefined>;
  resumen(): Promise<ResumenEntregas>;
  /** Vacía la cola de reportes contra el simulador. */
  despacharAGsg(): Promise<DespachoResumen>;
  cerrar(): Promise<void>;
}

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

function urlDe(entrada: Parameters<typeof fetch>[0]): string {
  if (typeof entrada === 'string') return entrada;
  if (entrada instanceof URL) return entrada.href;
  return (entrada as { url: string }).url;
}

export const conPais = (telefono: string): string => (telefono.startsWith('51') ? telefono : `51${telefono}`);

export async function crearEscenarioEntregas(opciones: {
  supervisor?: string;
  ia?: boolean;
  horario?: [number, number];
  margenMinutos?: number;
  /** El reloj arranca aquí (por defecto, ahora). */ arranque?: Date;
  /** La zona horaria «de Ajustes» (se puede cambiar en la prueba). */ zonaHoraria?: () => string;
  /**
   * Con el agente operativo (modo "Solo lo de GSG"): el asistente de verdad,
   * con su proveedor de mentira que contesta lo que haya en `ia.respuestas`
   * (solo lo usa para clasificar si se enciende con clave).
   */
  agente?: boolean;
  /**
   * «Confirmar la lista de GSG antes de enviar» (encendido de fabrica). Las
   * pruebas de siempre esperan que la lista salga sola: aqui va apagado salvo
   * que la prueba lo pida.
   */
  confirmarLista?: boolean;
  /** El buscador de direcciones escritas (uno de mentira en las pruebas: nunca la red). */
  geocodificador?: Geocodificador | null;
  /** Cuánto espera el cierre a que se asigne motorizado (0 en las pruebas salvo que se pida). */
  esperaMotorizadoMs?: number;
} = {}): Promise<EscenarioEntregas> {
  const [horaInicio, horaFin] = opciones.horario ?? [0, 24];
  const config = loadConfig({
    RUTAS_HORA_INICIO: String(horaInicio),
    RUTAS_HORA_FIN: String(horaFin),
    RUTAS_PAUSA_MIN_SEG: String(PAUSA_SEGUNDOS),
    RUTAS_PAUSA_MAX_SEG: String(PAUSA_SEGUNDOS),
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
    BUSINESS_NAME: 'Tienda de prueba',
    GSG_URL: GSG_URL_FALSA,
    GSG_TOKEN: GSG_TOKEN_FALSO,
  } as NodeJS.ProcessEnv);

  const inicio = opciones.arranque ?? new Date();
  let ahora = inicio;
  const reloj = () => ahora;
  const bus = crearBus();
  const eventos: Array<{ nombre: NombreEvento; payload: unknown }> = [];
  bus.escucharTodo((nombre, payload) => {
    eventos.push({ nombre, payload });
  });

  // El simulador de GSG, colgado de fetch como si fuera su API.
  const simulador = crearGsgSimulado({ token: GSG_TOKEN_FALSO, ahora: reloj });
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = urlDe(entrada);
    if (!url.startsWith(GSG_URL_FALSA)) return fetchOriginal(entrada, init);
    const headers = new Headers(init?.headers);
    const auth = headers.get('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    let cuerpo: unknown = undefined;
    if (init?.body) {
      try {
        cuerpo = JSON.parse(String(init.body));
      } catch {
        cuerpo = {};
      }
    }
    const r = simulador.atender((init?.method ?? 'GET').toUpperCase(), url.slice(GSG_URL_FALSA.length), token, cuerpo);
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status, headers: { 'content-type': typeof r.body === 'string' ? 'text/html' : 'application/json' } });
  }) as typeof fetch;

  const repos = createFakeRepos();
  // Las solicitudes del reparto y las entregas con el mismo reloj que los
  // mensajes y que el agente (si no, «desde que se abrió la solicitud» o «el
  // pedido llegó después del cierre» comparan fechas de dos relojes).
  repos.rutas = createFakeRutas(reloj);
  repos.entregas = createFakeEntregas(reloj);
  const wa = createFakeWhatsApp();
  wa.tieneWhatsApp = async () => true;
  const settings = await createFakeSettings(config);
  const settingsRepo = createMemorySettingsRepo();

  // Como en produccion: la regla del dueño en la puerta hacia el cliente.
  let entregasDeLaRegla: ServicioEntregas | null = null;
  const sender = conReglaGsg(
    createSender({
      repos,
      wa,
      phoneNumberId: 'PNID',
      warmup: { startPerDay: 5000, growth: 2, hardCap: 10000 },
      maxMarketingPerContact7d: 2,
      serviceWindowApplies: false,
      now: reloj,
      soloNumeros: () => [],
    }),
    { entregas: () => entregasDeLaRegla },
  );

  const conexionGsg = await crearConexionGsg({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, config });

  const ia: IAFalsa = {
    respuestas: [],
    llamadas: [],
    disponible: opciones.ia ?? false,
    async completar(mensajes: MensajeIA[]) {
      ia.llamadas.push({ sistema: mensajes[0]?.content ?? '', usuario: mensajes[mensajes.length - 1]?.content ?? '' });
      const r = ia.respuestas.shift();
      if (r === undefined) throw new Error('la IA de prueba no tiene respuesta preparada');
      return r;
    },
  };

  // El agente operativo: el asistente real en modo "Solo lo de GSG".
  const ajustes = opciones.agente ? await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 }) : undefined;
  const entregas = await crearServicioEntregas({
    ...(ajustes ? { modo: () => ajustes.modo() } : {}),
    repos,
    repo: repos.entregas,
    sender,
    settingsRepo,
    gsg: conexionGsg.puerto(),
    conexionGsg,
    cargarLote: (body) => cargarLote({ repos, plan: PLANES.peru!, timezone: config.timezone, ahora: reloj }, body),
    nombreNegocio: () => config.businessName,
    supervisor: () => opciones.supervisor ?? '',
    ia: () => (ia.disponible ? ia : null),
    timezone: config.timezone,
    zonaHoraria: opciones.zonaHoraria,
    publicBaseUrl: config.PUBLIC_BASE_URL,
    bus,
    geo: { bbox: config.bbox, cobertura: config.coverageName },
    geocodificador: opciones.geocodificador ?? null,
    ahora: reloj,
    ...(opciones.esperaMotorizadoMs !== undefined ? { esperaMotorizadoMs: opciones.esperaMotorizadoMs } : {}),
  });
  entregasDeLaRegla = entregas;
  if (opciones.margenMinutos !== undefined) await entregas.guardarAjustes({ margenMinutos: opciones.margenMinutos });
  if (!opciones.confirmarLista) await entregas.guardarAjustes({ confirmarListaGsg: false });
  const asistente = opciones.agente
    ? await crearServicioIA({
        settingsRepo,
        settingsKeyBase64: TEST_SETTINGS_KEY,
        repos,
        sender,
        config,
        nombreNegocio: () => config.businessName,
        entregas,
        modo: () => ajustes!.modo(),
        modelosGratis: ['google/gemma-4-31b-it'],
        examenAutomatico: false,
        proveedor: {
          nombre: 'prueba',
          async chat(mensajes) {
            return ia.completar(mensajes);
          },
        },
      })
    : undefined;

  const app = await buildServer({
    config,
    repos,
    settings,
    wa,
    sender,
    queue: cola,
    logger: false,
    entregas,
    conexionGsg,
    simuladorGsg: simulador,
    gsg: conexionGsg.puerto(),
    ...(asistente ? { ia: asistente, ajustes } : {}),
  });
  await app.ready();

  const opcionesMotor = { ...OPCIONES_POR_DEFECTO, pausaMinSegundos: PAUSA_SEGUNDOS, pausaMaxSegundos: PAUSA_SEGUNDOS, horaInicio, horaFin, negocio: config.businessName };
  // Como en produccion (src/servicios.ts): la primera solicitud de una entrega sale con la plantilla de GSG.
  const motorReparto = crearMotor({ repos, sender, wa, gsg: conexionGsg.puerto(), opciones: opcionesMotor, usarPlantilla: () => false, ahora: reloj, azar: () => 0, textoSolicitud: (s) => entregas.textoSolicitudUbicacion({ phone: s.phone, referencia: s.referencia, loteId: s.loteId }) });
  const motorEntregas = crearMotorEntregas({ repos, entregas, opciones: opcionesMotor, ahora: reloj, azar: () => 0 });

  const auth = { authorization: `Bearer ${CLAVE_API_PRUEBA}` };
  async function llamar<T>(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown): Promise<RespuestaApi<T>> {
    const res = await app.inject({ method, url, headers: auth, ...(body === undefined ? {} : { payload: body as Record<string, unknown> }) });
    let parsed: unknown;
    try {
      parsed = res.json();
    } catch {
      parsed = { raw: res.body };
    }
    return { status: res.statusCode, body: parsed as T };
  }
  const api: EscenarioEntregas['api'] = {
    get: (url) => llamar('GET', url),
    post: (url, body) => llamar('POST', url, body ?? {}),
    delete: (url) => llamar('DELETE', url),
  };

  const escenario: EscenarioEntregas = {
    app,
    repos,
    settingsRepo,
    wa,
    simulador,
    conexionGsg,
    entregas,
    motorReparto,
    motorEntregas,
    ia,
    asistente,
    bus,
    eventos,
    ahora: reloj,
    inicio,
    avanzar(minutos) {
      ahora = new Date(ahora.getTime() + minutos * 60_000);
    },
    avanzarSegundos(segundos) {
      ahora = new Date(ahora.getTime() + segundos * 1000);
    },
    api,

    async trabajar(opts = {}) {
      const hecho: Array<ResultadoTick | ResultadoTickEntregas> = [];
      const maxPasadas = opts.maxPasadas ?? 400;
      let quietas = 0;
      for (let pasada = 0; pasada < maxPasadas; pasada++) {
        const a = await motorReparto.tick();
        const b = await motorEntregas.tick();
        const hizoAlgo = a.accion !== 'nada' || b.accion !== 'nada';
        if (a.accion !== 'nada') hecho.push(a);
        if (b.accion !== 'nada') hecho.push(b);
        if (hizoAlgo) {
          quietas = 0;
          continue;
        }
        const enPausa = (a.motivo ?? '').includes('pausa') || (b.motivo ?? '').includes('pausa');
        if (enPausa) {
          escenario.avanzarSegundos(PAUSA_SEGUNDOS);
          continue;
        }
        // Los dos sin nada que hacer dos veces seguidas: se acabó por ahora.
        if (++quietas >= 2) return hecho;
      }
      throw new Error(`los motores no pararon en ${maxPasadas} pasadas`);
    },

    async contesta(telefono, respuesta) {
      const phone = conPais(telefono);
      const carga: Record<string, unknown> = { phone };
      if ('pin' in respuesta) carga.location = { latitude: respuesta.pin.lat, longitude: respuesta.pin.lng };
      else if ('enlace' in respuesta) carga.text = respuesta.enlace;
      else if ('texto' in respuesta) carga.text = respuesta.texto;
      else if ('adjunto' in respuesta) carga.adjunto = respuesta.adjunto;
      else if ('audio' in respuesta) {
        carga.adjunto = 'audio';
        carga.transcripcion = respuesta.audio;
      }
      else if ('boton' in respuesta) carga.boton = respuesta.boton;
      else carga.text = 'BAJA';
      return api.post('/admin/dev/inbound', carga);
    },

    mensajesA(telefono) {
      const phone = conPais(telefono);
      return wa.sent.filter((m) => String(m.to ?? '') === phone && m.kind !== 'read');
    },
    botonesA(telefono) {
      return escenario.mensajesA(telefono).filter((m) => m.kind === 'buttons') as Array<{ kind: 'buttons'; to: string; body: string; buttons: Array<{ id: string; title: string }> }>;
    },
    textosA(telefono) {
      return escenario.mensajesA(telefono).map((m) => String(m.body ?? '')).filter(Boolean);
    },
    async entrega(quien) {
      const r = await entregas.resumen();
      const phone = /^\d+$/.test(quien) ? conPais(quien) : null;
      return r.entregas.find((e) => (phone ? e.phone === phone : e.referencia === quien));
    },
    resumen: () => entregas.resumen(),
    despacharAGsg: () => despacharReportes({ rutas: repos.rutas }, conexionGsg.puerto(), 100),
    async cerrar() {
      globalThis.fetch = fetchOriginal;
      await app.close();
    },
  };

  return escenario;
}
