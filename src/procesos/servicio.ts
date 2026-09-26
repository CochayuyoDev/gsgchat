/**
 * El servicio de procesos: lo que usan las pantallas, la API, la IA operadora
 * y el Modulo desarrollador. Y el motor que los mueve.
 *
 * El motor es hermano de los del reparto, la lista y las entregas, y sigue
 * sus reglas porque el numero es uno solo:
 *  1. Un envio por pasada, con la pausa sorteada del reparto (Ajustes del
 *     reparto) entre uno y el siguiente, estirada por el monitor de salud.
 *  2. En horario: la franja del proceso (su «ritmo») y la del numero (la
 *     politica de salud: `decidirRitmo`).
 *  3. Con final: cada paso tiene sus insistencias y que pasa si no responde.
 * Lo de prueba (51 000 0…) no gasta el ritmo del numero real.
 */

import type { Repos } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import type { Monitor } from '../salud/monitor.js';
import type { Politica } from '../salud/politica.js';
import { decidirRitmo } from '../salud/ritmo.js';
import type { MensajeIA } from '../ia/proveedores.js';
import { esNumeroDePrueba } from '../desarrollador/numeros.js';
import { ajustesPorDefecto, aplicarAjustes } from '../rutas/ajustes.js';
import { OPCIONES_POR_DEFECTO, type OpcionesMotor } from '../rutas/motor.js';
import { PERU, type PlanNumeracion } from '../rutas/telefono.js';
import {
  ESTADOS_PERSONA_VISUALES,
  ESTADOS_VIVOS,
  NOMBRE_TIPO_DATO,
  NOMBRE_TIPO_PASO,
  problemasDePasos,
  procesoSchema,
  type Corrida,
  type EstadoPersona,
  type EstadoProceso,
  type NuevaPersona,
  type PersonaProceso,
  type Proceso,
} from './modelo.js';
import { PLANTILLAS, plantillaPorId, type Plantilla } from './plantillas.js';
import { leerLista, type EntradaLista } from './personas.js';
import { enviarLoQueToca, type DepsNucleo } from './nucleo.js';
import type { ProcesosRepo } from './repo.js';

export class ErrorProcesos extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly ir?: string,
  ) {
    super(message);
  }
}

export interface DepsServicioProcesos {
  repos: Repos;
  sender: Sender;
  nombreNegocio: () => string;
  timezone?: string;
  plan?: PlanNumeracion;
  distritos?: string[];
  /** La plantilla GSG (entregas de courier) viene activa si no hay nada guardado: la tienda principal. */
  gsgPorDefecto?: boolean;
  /** Pausa y horario base del reparto (los Ajustes del reparto mandan encima). */
  opciones?: OpcionesMotor;
  salud?: Monitor;
  politica?: () => Politica;
  /** El modelo (si esta activo), solo para clasificar. Se pide cada vez: se enciende y apaga desde la pantalla. */
  clasificar?: () => ((mensajes: MensajeIA[]) => Promise<string>) | undefined;
  ahora?: () => Date;
  azar?: () => number;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

export interface ResumenProceso extends Proceso {
  cifras: Record<string, number>;
  corridas: number;
  vivas: number;
  necesitan: number;
}

export interface ResultadoCarga {
  corrida: Corrida;
  total: number;
  listas: number;
  conError: number;
  duplicadas: number;
  yaEnCurso: number;
  bajas: number;
  descartadas: Array<{ linea: number; texto: string; motivo: string }>;
  columnas: string[];
  /** Variables que usan los textos del proceso y que la lista no trae. */
  faltan: string[];
}

export type AccionMasa = 'pedir_ahora' | 'pausar' | 'reanudar' | 'persona' | 'cancelar';

export interface ResultadoTickProcesos {
  accion: 'nada' | 'envio' | 'cambio' | 'frenado';
  personaId?: number;
  motivo?: string;
  dePrueba?: boolean;
}

export interface ServicioProcesos {
  /** Lee lo guardado (y siembra la plantilla GSG en la tienda que la trae por defecto). */
  cargar(): Promise<void>;
  /** Si la plantilla de entregas de courier (GSG) esta activa: el menu enseña Hoy, Números del día, Mapa y Motorizados. */
  gsgActivo(): boolean;
  plantillas(): Plantilla[];
  listar(): Promise<ResumenProceso[]>;
  proceso(id: number): Promise<Proceso>;
  crearDesdePlantilla(plantilla: string, nombre?: string): Promise<Proceso>;
  crear(datos: unknown): Promise<Proceso>;
  guardar(id: number, datos: unknown): Promise<Proceso>;
  cambiarEstado(id: number, estado: EstadoProceso): Promise<Proceso>;
  borrar(id: number): Promise<void>;
  cargarPersonas(procesoId: number, entrada: EntradaLista & { nombre?: string; origen?: string }): Promise<ResultadoCarga>;
  corridas(procesoId?: number): Promise<Array<Corrida & { cifras: Record<string, number>; proceso: string }>>;
  corrida(id: number): Promise<{ corrida: Corrida; proceso: Proceso; personas: PersonaProceso[]; cifras: Record<string, number> }>;
  cambiarCorrida(id: number, estado: 'activa' | 'pausada' | 'terminada'): Promise<Corrida>;
  personas(filtro: { procesoId?: number; corridaId?: number; estados?: EstadoPersona[]; conRespuestas?: boolean; limit?: number }): Promise<PersonaProceso[]>;
  masa(accion: AccionMasa, ids: number[], quien?: string): Promise<{ hechos: number; aviso: string }>;
  exportarCsv(filtro: { corridaId?: number; procesoId?: number }): Promise<{ nombre: string; csv: string }>;
  resumen(): Promise<{ procesosActivos: number; vivas: number; esperando: number; necesitan: number; completadas: number; gsgActivo: boolean; motor: { enHorario: boolean; parado: string | null } }>;
  /** Una pasada del motor: manda, como mucho, un mensaje. */
  tick(): Promise<ResultadoTickProcesos>;
  /** El motor: pasadas cada `intervalMs` hasta que se pare. */
  arrancar(intervalMs?: number): () => void;
  /** Las piezas del nucleo (para el manejador de entrantes y el Modulo desarrollador). */
  depsNucleo(): DepsNucleo;
}

const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

function minutosDelDia(fecha: Date, tz: string): number {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(fecha);
    return (Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0);
  } catch {
    return fecha.getHours() * 60 + fecha.getMinutes();
  }
}

/** Si ahora cae en la franja del proceso. */
export function enFranja(proceso: Pick<Proceso, 'ritmo'>, ahora: Date, tz: string): boolean {
  const m = minutosDelDia(ahora, tz);
  const desde = hhmm(proceso.ritmo.desde || '00:00');
  const hasta = hhmm(proceso.ritmo.hasta || '23:59');
  return desde <= hasta ? m >= desde && m < hasta : m >= desde || m < hasta;
}

const csvCelda = (v: unknown) => {
  const t = String(v ?? '').replace(/\r?\n/g, ' ');
  return /[;"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export async function crearServicioProcesos(deps: DepsServicioProcesos): Promise<ServicioProcesos> {
  const { repos } = deps;
  const repo: ProcesosRepo | undefined = repos.procesos;
  const tz = deps.timezone ?? 'America/Lima';
  const ahora = deps.ahora ?? (() => new Date());
  const azar = deps.azar ?? Math.random;
  const log = deps.log ?? (() => undefined);
  let gsg = deps.gsgPorDefecto ?? false;

  const necesitaRepo = (): ProcesosRepo => {
    if (!repo) throw new ErrorProcesos('Los procesos no están disponibles en este arranque del sistema.', 503);
    return repo;
  };

  const depsNucleo = (): DepsNucleo => ({
    repos,
    sender: deps.sender,
    nombreNegocio: deps.nombreNegocio,
    timezone: tz,
    distritos: deps.distritos,
    clasificar: deps.clasificar?.(),
    ahora,
    log,
  });

  async function refrescarGsg(): Promise<void> {
    if (!repo) return;
    const g = (await repo.procesos()).find((p) => p.plantilla === 'gsg');
    gsg = g ? g.estado === 'activo' : (deps.gsgPorDefecto ?? false);
  }

  async function procesoOError(id: number): Promise<Proceso> {
    const p = await necesitaRepo().proceso(id);
    if (!p) throw new ErrorProcesos('Ese proceso ya no existe: vuelve a la lista de procesos.', 404, '/procesos');
    return p;
  }

  function validarDatos(datos: unknown): { nombre: string; descripcion: string; pasos: Proceso['pasos']; ritmo: Proceso['ritmo']; cierre: Proceso['cierre'] } {
    const r = procesoSchema.safeParse(datos);
    if (!r.success) {
      const primero = r.error.issues[0];
      const donde = primero?.path?.length ? primero.path.join(' › ') : '';
      throw new ErrorProcesos(`No se pudo guardar: ${primero?.message ?? 'revisa los datos'}${donde && primero?.path[0] === 'pasos' ? ` (paso ${Number(primero.path[1]) + 1})` : ''}.`);
    }
    const problemas = problemasDePasos(r.data.pasos as Proceso['pasos']);
    if (problemas.length) throw new ErrorProcesos(`No se pudo guardar: ${problemas.join(' ')}`);
    return r.data as ReturnType<typeof validarDatos>;
  }

  // --- el motor: la pausa entre mensajes, como los otros motores ------------------
  let opciones: OpcionesMotor = deps.opciones ?? OPCIONES_POR_DEFECTO;
  let ultimoEnvio = 0;
  let pausaActual = opciones.pausaMinSegundos * 1000;
  let ultimoMotivo: string | null = null;
  const sortearPausa = () => {
    const min = Math.max(1, opciones.pausaMinSegundos);
    const max = Math.max(min, opciones.pausaMaxSegundos);
    return Math.round((min + azar() * (max - min)) * 1000);
  };
  const pausaEfectiva = () => pausaActual / Math.max(deps.salud?.factor() ?? 1, 0.05);
  async function refrescarOpciones(): Promise<void> {
    try {
      const base = deps.opciones ?? OPCIONES_POR_DEFECTO;
      opciones = aplicarAjustes(base, await repos.rutas.ajustes.get(ajustesPorDefecto(base)));
    } catch {
      // sin ajustes legibles, los de la configuracion
    }
  }

  /** Personas frenadas por el sender (cupo, ritmo): no se miran hasta que pase su espera. */
  const frenadas = new Map<number, number>();

  /** Una pasada del motor (la llama `tick`, de una en una). */
  async function pasada(): Promise<ResultadoTickProcesos> {
    if (!repo) return { accion: 'nada', motivo: 'sin procesos en este arranque' };
    const momento = ahora();
    await refrescarOpciones();
    const candidatas = await repo.tocaEnviar(momento, 25);
    if (!candidatas.length) {
      ultimoMotivo = null;
      return { accion: 'nada', motivo: 'no hay nada pendiente' };
    }
    const procesos = new Map<number, Proceso | null>();
    const procesoDe = async (id: number) => {
      if (!procesos.has(id)) procesos.set(id, await repo.proceso(id));
      return procesos.get(id)!;
    };
    for (const persona of candidatas) {
      if ((frenadas.get(persona.id) ?? 0) > momento.getTime()) continue;
      const proceso = await procesoDe(persona.procesoId);
      if (!proceso) continue;
      const dePrueba = esNumeroDePrueba(persona.phone);
      // Una espera que termina (o una salida sin mensaje) no escribe a nadie: no pide turno.
      if (!dePrueba) {
        if (!enFranja(proceso, momento, tz)) {
          ultimoMotivo = `fuera de la franja del proceso (${proceso.ritmo.desde} a ${proceso.ritmo.hasta})`;
          continue;
        }
        if (ultimoEnvio && momento.getTime() - ultimoEnvio < pausaEfectiva()) return { accion: 'nada', motivo: 'esperando la pausa entre mensajes' };
        if (deps.salud && deps.salud.factor() <= 0) {
          ultimoMotivo = 'el monitor de salud tiene el número parado';
          return { accion: 'nada', motivo: ultimoMotivo };
        }
        if (deps.salud && deps.politica && persona.phone) {
          const contacto = await repos.contacts.upsertFromInbound(persona.phone);
          const decision = decidirRitmo(await deps.salud.fotoRitmo(contacto, momento), deps.politica());
          if (!decision.ok) {
            ultimoMotivo = `${decision.codigo}: ${decision.motivo}`;
            return { accion: 'nada', motivo: ultimoMotivo };
          }
        }
      }
      const r = await enviarLoQueToca(depsNucleo(), persona, proceso);
      if (r.accion === 'envio') {
        if (!dePrueba) {
          ultimoEnvio = momento.getTime();
          pausaActual = sortearPausa();
        }
        ultimoMotivo = null;
        return { accion: 'envio', personaId: persona.id, dePrueba };
      }
      if (r.accion === 'frenado') {
        frenadas.set(persona.id, momento.getTime() + Math.max(15_000, r.retryAfterMs ?? 60_000));
        ultimoMotivo = r.motivo ?? null;
        continue;
      }
      if (r.accion === 'cambio') return { accion: 'cambio', personaId: persona.id, dePrueba: true, motivo: r.motivo };
    }
    return { accion: 'nada', motivo: ultimoMotivo ?? 'nada que mandar ahora' };
  }

  let cola: Promise<unknown> = Promise.resolve();

  const servicio: ServicioProcesos = {
    async cargar() {
      if (!repo) return;
      const todos = await repo.procesos();
      if (deps.gsgPorDefecto && !todos.some((p) => p.plantilla === 'gsg')) {
        const pl = plantillaPorId('gsg')!;
        await repo.crearProceso({ nombre: pl.nombre, plantilla: 'gsg', descripcion: pl.descripcion, pasos: [], ritmo: pl.ritmo, cierre: pl.cierre, estado: 'activo' });
      }
      await refrescarGsg();
    },

    gsgActivo: () => gsg,

    plantillas: () => PLANTILLAS,

    async listar() {
      const r = necesitaRepo();
      const procesos = await r.procesos();
      const salida: ResumenProceso[] = [];
      for (const p of procesos) {
        const cifras = await r.cifras({ procesoId: p.id });
        const corridas = (await r.corridas({ procesoId: p.id, limit: 500 })).length;
        salida.push({ ...p, cifras, corridas, vivas: ESTADOS_VIVOS.reduce((s, e) => s + (cifras[e] ?? 0), 0), necesitan: cifras.persona ?? 0 });
      }
      return salida;
    },

    proceso: (id) => procesoOError(id),

    async crearDesdePlantilla(id, nombre) {
      const r = necesitaRepo();
      const pl = plantillaPorId(id);
      if (!pl) throw new ErrorProcesos(`No hay ninguna plantilla «${id}». Elige una de la lista de plantillas.`);
      if (pl.id === 'gsg') {
        // Una sola: si ya estaba, se activa.
        const ya = (await r.procesos()).find((p) => p.plantilla === 'gsg');
        const g = ya ? await r.actualizarProceso(ya.id, { estado: 'activo' }) : await r.crearProceso({ nombre: pl.nombre, plantilla: 'gsg', descripcion: pl.descripcion, pasos: [], ritmo: pl.ritmo, cierre: pl.cierre });
        await refrescarGsg();
        return g!;
      }
      const p = await r.crearProceso({ nombre: (nombre ?? '').trim() || pl.nombre, plantilla: pl.id, descripcion: pl.descripcion, pasos: pl.pasos, ritmo: pl.ritmo, cierre: pl.cierre });
      return p;
    },

    async crear(datos) {
      const d = validarDatos(datos);
      return necesitaRepo().crearProceso({ ...d, plantilla: null });
    },

    async guardar(id, datos) {
      const actual = await procesoOError(id);
      if (actual.plantilla === 'gsg') {
        const nombre = (datos as { nombre?: unknown })?.nombre;
        const p = await necesitaRepo().actualizarProceso(id, { nombre: typeof nombre === 'string' && nombre.trim() ? nombre.trim().slice(0, 120) : actual.nombre });
        return p!;
      }
      const d = validarDatos(datos);
      return (await necesitaRepo().actualizarProceso(id, d))!;
    },

    async cambiarEstado(id, estado) {
      await procesoOError(id);
      const p = (await necesitaRepo().actualizarProceso(id, { estado }))!;
      if (p.plantilla === 'gsg') await refrescarGsg();
      return p;
    },

    async borrar(id) {
      const p = await procesoOError(id);
      if (p.plantilla === 'gsg') throw new ErrorProcesos('Las entregas de courier no se borran: se desactivan (el historial de entregas se conserva).');
      const cifras = await necesitaRepo().cifras({ procesoId: id });
      const vivas = ESTADOS_VIVOS.reduce((s, e) => s + (cifras[e] ?? 0), 0);
      if (vivas > 0) throw new ErrorProcesos('Este proceso tiene personas en curso. Termina o cancela sus corridas antes de borrarlo, o archívalo.');
      await necesitaRepo().borrarProceso(id);
    },

    async cargarPersonas(procesoId, entrada) {
      const r = necesitaRepo();
      const proceso = await procesoOError(procesoId);
      if (proceso.plantilla === 'gsg') throw new ErrorProcesos('Las entregas de courier reciben sus pedidos desde GSG o desde Hoy, no desde aquí.', 400, '/hoy');
      if (!proceso.pasos.length) throw new ErrorProcesos('Este proceso todavía no tiene pasos: añádelos en el editor antes de cargar personas.', 400, `/procesos/editor?id=${procesoId}`);
      if (proceso.estado === 'archivado') throw new ErrorProcesos('Este proceso está archivado: reactívalo para cargarle personas.');
      let lectura;
      try {
        lectura = leerLista(entrada, deps.plan ?? PERU);
      } catch (error) {
        throw new ErrorProcesos(`No se pudo leer el archivo: ${error instanceof Error ? error.message : String(error)}. Guárdalo como Excel (.xlsx) o CSV y vuelve a subirlo.`);
      }
      if (!lectura.personas.length) throw new ErrorProcesos(lectura.descartadas.length ? `Ninguna fila trae un teléfono (${lectura.descartadas.length} descartadas). Revisa que la lista tenga una columna de teléfonos.` : 'No se entendió ninguna fila con teléfono. Revisa que la lista tenga una columna de teléfonos.');

      // Quien se dio de baja no entra; quien ya esta en otra corrida viva, tampoco (no dos conversaciones a la vez).
      let yaEnCurso = 0;
      let bajas = 0;
      const personas: NuevaPersona[] = [];
      for (const p of lectura.personas) {
        if (!p.phone) {
          personas.push(p);
          continue;
        }
        const previo = await repos.contacts.getByPhone(p.phone);
        if (previo?.optOutAt) {
          bajas++;
          personas.push({ ...p, estado: 'error', motivo: 'Se dio de baja antes: no se le escribe. Si quiere seguir, que escriba ALTA.' });
          continue;
        }
        const viva = (await r.personas({ phone: p.phone, estados: ESTADOS_VIVOS, limit: 1 }))[0];
        if (viva) {
          yaEnCurso++;
          personas.push({ ...p, estado: 'error', motivo: 'Ya está en otra corrida en curso: no se le abren dos conversaciones a la vez.' });
          continue;
        }
        personas.push(p);
      }

      const nombre = (entrada.nombre ?? '').trim() || `${proceso.nombre} · ${new Date().toLocaleDateString('es-PE', { timeZone: tz })}`;
      const corrida = await r.crearCorrida({ procesoId, nombre: nombre.slice(0, 120), origen: entrada.origen ?? (entrada.xlsxBase64 ? 'excel' : entrada.filas ? 'api' : 'pegada') });
      const creadas = await r.agregarPersonas(corrida.id, procesoId, personas);
      // El consentimiento: la empresa sube a gente que le dio su numero para esto; se deja constancia de donde salio.
      for (const c of creadas) {
        if (!c.phone || c.estado !== 'pendiente') {
          await r.registrarEvento(c.id, 'incidencia', `entró en la corrida «${corrida.nombre}», pero no se le puede escribir: ${c.motivo ?? 'el teléfono no sirve'}`);
          continue;
        }
        await repos.contacts.upsertFromInbound(c.phone, c.nombre ?? undefined);
        await repos.contacts.setOptIn(c.phone, `proceso: ${proceso.nombre} (${corrida.nombre})`);
        await r.registrarEvento(c.id, 'carga', `entró en la corrida «${corrida.nombre}»`);
      }
      const usadas = new Set(proceso.pasos.flatMap((p) => [p.texto, p.porQue ?? '', p.siNoEntiende ?? '', p.gracias ?? '', p.textoNo ?? '']).flatMap((t) => [...t.matchAll(/\{([^{}\n]{1,40})\}/g)].map((m) => m[1]!.trim().toLowerCase())));
      const conocidas = new Set(['nombre', 'nombre_completo', 'negocio', 'proceso', ...lectura.columnas]);
      const faltan = [...usadas].filter((v) => !conocidas.has(v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_')));
      const listas = creadas.filter((c) => c.estado === 'pendiente').length;
      // Que empiece ya (con el ritmo de siempre): una pasada del motor.
      void servicio.tick().catch(() => undefined);
      return { corrida, total: creadas.length, listas, conError: creadas.length - listas, duplicadas: lectura.duplicadas, yaEnCurso, bajas, descartadas: lectura.descartadas, columnas: lectura.columnas, faltan };
    },

    async corridas(procesoId) {
      const r = necesitaRepo();
      const lista = await r.corridas({ procesoId, limit: 100 });
      const nombres = new Map((await r.procesos()).map((p) => [p.id, p.nombre]));
      return Promise.all(lista.map(async (c) => ({ ...c, cifras: await r.cifras({ corridaId: c.id }), proceso: nombres.get(c.procesoId) ?? '' })));
    },

    async corrida(id) {
      const r = necesitaRepo();
      const corrida = await r.corrida(id);
      if (!corrida) throw new ErrorProcesos('Esa corrida ya no existe: vuelve a Procesos.', 404, '/procesos');
      const proceso = await procesoOError(corrida.procesoId);
      return { corrida, proceso, personas: await r.personas({ corridaId: id, limit: 5000 }), cifras: await r.cifras({ corridaId: id }) };
    },

    async cambiarCorrida(id, estado) {
      const r = necesitaRepo();
      const c = await r.actualizarCorrida(id, { estado });
      if (!c) throw new ErrorProcesos('Esa corrida ya no existe.', 404, '/procesos');
      if (estado === 'terminada') {
        for (const p of await r.personas({ corridaId: id, estados: ESTADOS_VIVOS, limit: 5000 })) {
          await r.actualizarPersona(p.id, { estado: 'cancelada', proximoAt: null, terminadaAt: ahora(), ultimo: 'se terminó la corrida' });
        }
      }
      if (estado === 'activa') void servicio.tick().catch(() => undefined);
      return c;
    },

    personas: (filtro) => necesitaRepo().personas(filtro),

    async masa(accion, ids, quien) {
      const r = necesitaRepo();
      let hechos = 0;
      let saltadas = 0;
      const momento = ahora();
      for (const id of [...new Set(ids)].slice(0, 5000)) {
        const p = await r.persona(id);
        if (!p) continue;
        if (accion === 'pedir_ahora') {
          if (!p.phone || p.estado === 'error' || p.estado === 'completada' || p.estado === 'cancelada' || p.estado === 'rechazo') {
            saltadas++;
            continue;
          }
          // Viva: que le toque ya. En manos de una persona o sin respuesta: vuelve a su paso.
          const reabrir = p.estado === 'persona' || p.estado === 'sin_respuesta';
          await r.actualizarPersona(p.id, { pausada: false, proximoAt: momento, ...(reabrir || p.estado === 'esperando' ? { estado: 'pendiente', intentos: 0, fallos: 0, sub: null, motivo: null, terminadaAt: null } : {}), ultimo: `${quien ?? 'alguien del equipo'} pidió escribirle ahora` });
          await r.registrarEvento(p.id, 'manual', `${quien ?? 'alguien del equipo'} pidió escribirle ahora`);
          hechos++;
        } else if (accion === 'pausar' || accion === 'reanudar') {
          await r.actualizarPersona(p.id, { pausada: accion === 'pausar', ultimo: accion === 'pausar' ? 'mensajes en pausa' : 'mensajes reanudados' });
          hechos++;
        } else if (accion === 'persona') {
          if (p.estado === 'completada' || p.estado === 'cancelada') {
            saltadas++;
            continue;
          }
          await r.actualizarPersona(p.id, { estado: 'persona', proximoAt: null, motivo: `Lo pasó a una persona ${quien ?? 'alguien del equipo'}.`, ultimo: 'pasó a una persona' });
          await r.registrarEvento(p.id, 'manual', `${quien ?? 'alguien del equipo'} lo pasó a una persona`);
          hechos++;
        } else if (accion === 'cancelar') {
          if (!ESTADOS_VIVOS.includes(p.estado) && p.estado !== 'persona') {
            saltadas++;
            continue;
          }
          await r.actualizarPersona(p.id, { estado: 'cancelada', proximoAt: null, terminadaAt: momento, ultimo: 'cancelada a mano' });
          await r.registrarEvento(p.id, 'manual', `${quien ?? 'alguien del equipo'} la canceló`);
          hechos++;
        }
      }
      if (accion === 'pedir_ahora' && hechos) void servicio.tick().catch(() => undefined);
      const n = (x: number) => (x === 1 ? '1 persona' : `${x} personas`);
      const avisos: Record<AccionMasa, string> = {
        pedir_ahora: `Listo: a ${n(hechos)} se le escribe ahora, de una en una y con la pausa de siempre.`,
        pausar: `Mensajes en pausa para ${n(hechos)}. Lo que respondan se sigue leyendo.`,
        reanudar: `Mensajes reanudados para ${n(hechos)}.`,
        persona: `${n(hechos)} pasa${hechos === 1 ? '' : 'n'} a una persona: el sistema ya no les escribe; atiéndelas desde Chats.`,
        cancelar: `${n(hechos)} cancelada${hechos === 1 ? '' : 's'}: no se les vuelve a escribir.`,
      };
      const extra = saltadas ? (saltadas === 1 ? ' 1 persona no se tocó porque ya había terminado o no se le puede escribir.' : ` ${saltadas} personas no se tocaron porque ya habían terminado o no se les puede escribir.`) : '';
      return { hechos, aviso: (hechos ? avisos[accion] : 'No se hizo nada con las marcadas.') + extra };
    },

    async exportarCsv(filtro) {
      const r = necesitaRepo();
      let personas: PersonaProceso[] = [];
      let procesos: Proceso[] = [];
      let nombre = 'procesos';
      if (filtro.corridaId !== undefined) {
        const c = await servicio.corrida(filtro.corridaId);
        personas = c.personas;
        procesos = [c.proceso];
        nombre = c.corrida.nombre;
      } else {
        personas = await r.personas({ procesoId: filtro.procesoId, limit: 20000 });
        procesos = filtro.procesoId !== undefined ? [await procesoOError(filtro.procesoId)] : await r.procesos();
        nombre = filtro.procesoId !== undefined ? procesos[0]!.nombre : 'respuestas';
      }
      const porId = new Map(procesos.map((p) => [p.id, p]));
      const columnasDatos = [...new Set(personas.flatMap((p) => Object.keys(p.datos)))];
      const pasosConRespuesta = procesos.flatMap((p) => p.pasos.filter((x) => x.tipo === 'pedir' || x.tipo === 'confirmar' || x.tipo === 'avance').map((x) => ({ procesoId: p.id, id: x.id, titulo: procesos.length > 1 ? `${p.nombre}: ${x.titulo}` : x.titulo || x.id, dato: x.dato })));
      const cab = ['Teléfono', 'Nombre', ...(procesos.length > 1 ? ['Proceso'] : []), ...columnasDatos, 'Estado', 'Paso actual', 'Lo último', 'Necesita a alguien porque', ...pasosConRespuesta.map((x) => x.titulo)];
      const filas = personas
        .sort((a, b) => a.id - b.id)
        .map((p) => {
          const proc = porId.get(p.procesoId);
          const pasoActual = proc?.pasos[p.paso];
          return [
            p.phone ?? p.telefonoCrudo,
            p.nombre ?? '',
            ...(procesos.length > 1 ? [proc?.nombre ?? ''] : []),
            ...columnasDatos.map((c) => p.datos[c] ?? ''),
            ESTADOS_PERSONA_VISUALES[p.estado]?.nombre ?? p.estado,
            pasoActual?.titulo ?? (p.estado === 'completada' ? 'Terminó' : ''),
            p.ultimo ?? '',
            p.motivo ?? '',
            ...pasosConRespuesta.map((x) => {
              if (x.procesoId !== p.procesoId) return '';
              const resp = p.respuestas[x.id];
              if (!resp) return '';
              if (x.dato === 'ubicacion' && resp.extra?.mapa) return String(resp.extra.mapa);
              return resp.valor === 'si' ? 'Sí' : resp.valor === 'no' ? 'No' : resp.valor;
            }),
          ];
        });
      const csv = '﻿' + [cab, ...filas].map((f) => f.map(csvCelda).join(';')).join('\r\n');
      return { nombre: nombre.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'procesos', csv };
    },

    async resumen() {
      const r = necesitaRepo();
      const procesos = await r.procesos();
      const cifras = await r.cifras();
      const hoy = ahora().toISOString().slice(0, 10);
      const completadas = (await r.personas({ estados: ['completada'], limit: 5000 })).filter((p) => p.terminadaAt?.toISOString().slice(0, 10) === hoy).length;
      return {
        procesosActivos: procesos.filter((p) => p.estado === 'activo' && p.plantilla !== 'gsg').length,
        vivas: ESTADOS_VIVOS.reduce((s, e) => s + (cifras[e] ?? 0), 0),
        esperando: cifras.esperando ?? 0,
        necesitan: cifras.persona ?? 0,
        completadas,
        gsgActivo: gsg,
        motor: { enHorario: true, parado: ultimoMotivo },
      };
    },

    tick() {
      // De una en una: el motor, «Pedir ahora» y una carga nueva pueden pedir una
      // pasada a la vez, y dos pasadas simultaneas le escribirian dos veces a la misma persona.
      const turno = cola.then(pasada);
      cola = turno.then(
        () => undefined,
        () => undefined,
      );
      return turno;
    },

    arrancar(intervalMs = 5_000) {
      let corriendo = false;
      const vuelta = async () => {
        if (corriendo) return;
        corriendo = true;
        try {
          // Lo de prueba y los cambios sin mensaje no gastan el ritmo: se sigue en la misma pasada (con tope).
          for (let i = 0; i < 25; i++) {
            const r = await servicio.tick();
            if (!r.dePrueba) break;
          }
        } catch (error) {
          log('falló el motor de procesos', { detalle: error instanceof Error ? error.message : String(error) });
        } finally {
          corriendo = false;
        }
      };
      const timer = setInterval(() => void vuelta(), intervalMs);
      timer.unref?.();
      return () => clearInterval(timer);
    },

    depsNucleo,
  };

  return servicio;
}

/** Lo que se pide en cada paso, en palabras (para la IA operadora y el manual). */
export function describirPasos(p: Proceso): string {
  if (p.plantilla === 'gsg') return 'Usa el módulo de entregas (Hoy, Números del día, Mapa y Motorizados).';
  return p.pasos.map((x, i) => `${i + 1}. ${x.titulo || (x.tipo === 'pedir' && x.dato ? `Pedir: ${NOMBRE_TIPO_DATO[x.dato]}` : NOMBRE_TIPO_PASO[x.tipo])}`).join(' · ');
}
