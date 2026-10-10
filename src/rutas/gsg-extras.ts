/**
 * Lo que rodea a la conexión con GSG y que antes no se veía:
 *
 *  - **Descartes**: cada pedido que GSG nos manda (POST /api/v1/entregas, o
 *    la lista del simulador) y que no se puede usar (sin referencia, teléfono
 *    inválido, pin con formato raro). Antes solo quedaba en el log del
 *    servidor; ahora se guarda por día y se enseña en Conexión → GSG y en la
 *    campana.
 *  - **Verificador del contrato**: mira lo que GSG nos ha mandado (la
 *    bitácora de /api/v1/entregas y los descartes) y dice qué se aceptó y qué
 *    no. NO llama a GSG: GSGchat nunca le pide nada.
 *  - **Tokens del simulador**: para que los programadores de GSG prueben
 *    desde fuera contra `/simulador/gsg` sin conocer el token interno. Se ven
 *    una vez, caducan y se anulan. Se guardan solo como hash.
 *  - **Bitácora**: las últimas 50 llamadas que GSG (o quien tenga un token)
 *    hizo al simulador y a `/api/v1/entregas`: hora, ruta, resultado, motivo.
 *  - **Cuadre de fin de día**: solo con lo de aquí (a GSG no se le pregunta
 *    su lista de terminados): qué pedidos del día siguen sin cerrar.
 *
 * Todo vive en `settings` (claves `gsg.*`) y se lee al arrancar.
 */

import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { SettingsRepo } from '../settings/service.js';
import { PERU, revisarTelefono } from './telefono.js';

const CLAVE_DESCARTES = 'gsg.descartes';
const CLAVE_TOKENS = 'gsg.tokensSimulador';
const CLAVE_BITACORA = 'gsg.bitacora';

/** Cuántas llamadas se recuerdan. */
export const BITACORA_MAX = 50;

// ------------------------------------------------------------ descartes

export interface DescarteGsg {
  referencia: string;
  /** En palabras: "teléfono inválido: ...", "sin referencia", ... */
  motivo: string;
  /** De qué lista venía. */
  lista: 'faltaUbicacion' | 'faltaConfirmacion';
  en: string;
}

const descartesSchema = z.object({
  dia: z.string().default(''),
  lista: z
    .array(
      z.object({
        referencia: z.string().default(''),
        motivo: z.string().default(''),
        lista: z.enum(['faltaUbicacion', 'faltaConfirmacion']).default('faltaUbicacion'),
        en: z.string().default(''),
      }),
    )
    .default([]),
});

/** Un pedido tal como puede venir de GSG (sin garantías: es lo que hay que revisar). */
export interface PedidoCrudo {
  referencia?: unknown;
  telefono?: unknown;
  nombre?: unknown;
  direccion?: unknown;
  distrito?: unknown;
  notas?: unknown;
  lat?: unknown;
  lng?: unknown;
  id?: unknown;
  urgente?: unknown;
}

/**
 * Las mismas reglas con las que las entregas leen a cada cliente de GSG
 * (`leerCliente` en src/entregas/servicio.ts): referencia y teléfono válidos;
 * y además, si trae pin, que sea un pin de verdad.
 */
export function revisarPedidoGsg(c: PedidoCrudo): { ok: true } | { ok: false; motivo: string } {
  if (!c || typeof c !== 'object') return { ok: false, motivo: 'no es un pedido (no es un objeto)' };
  const referencia = String(c.referencia ?? '').trim();
  if (!referencia) return { ok: false, motivo: 'sin referencia' };
  const revision = revisarTelefono(String(c.telefono ?? ''), PERU);
  if (!revision.ok) return { ok: false, motivo: `teléfono inválido: ${revision.detalle}` };
  const tienePin = c.lat !== undefined && c.lat !== null && c.lng !== undefined && c.lng !== null;
  if (tienePin && !(typeof c.lat === 'number' && typeof c.lng === 'number' && Number.isFinite(c.lat) && Number.isFinite(c.lng))) {
    return { ok: false, motivo: 'el pin (lat, lng) no son números' };
  }
  if (tienePin && (Math.abs(c.lat as number) > 90 || Math.abs(c.lng as number) > 180)) {
    return { ok: false, motivo: 'el pin (lat, lng) está fuera del mapa' };
  }
  return { ok: true };
}

// ------------------------------------------------------------ contrato

export interface HallazgoContrato {
  /** ok = bien; falta = obligatorio ausente; formato = está pero mal; sobra = campo que no se usa. */
  tipo: 'ok' | 'falta' | 'formato' | 'sobra' | 'aviso';
  donde: string;
  detalle: string;
}

export interface VerificacionContrato {
  ok: boolean;
  resumen: string;
  hallazgos: HallazgoContrato[];
  at: string;
}

// ------------------------------------------------------------ tokens del simulador

export interface TokenSimulador {
  id: string;
  nombre: string;
  creadoAt: string;
  caducaAt: string;
  anuladoAt: string | null;
  ultimoUsoAt: string | null;
  usos: number;
  /** Los últimos 4 caracteres, para reconocerlo en la lista. */
  pista: string;
}

const tokensSchema = z.array(
  z.object({
    id: z.string(),
    nombre: z.string().default(''),
    hash: z.string(),
    creadoAt: z.string(),
    caducaAt: z.string(),
    anuladoAt: z.string().nullable().default(null),
    ultimoUsoAt: z.string().nullable().default(null),
    usos: z.number().int().nonnegative().default(0),
    pista: z.string().default(''),
  }),
);
type TokenGuardado = z.infer<typeof tokensSchema>[number];

const hashDe = (token: string): string => createHash('sha256').update(token).digest('hex');

export type EstadoToken = 'vigente' | 'caducado' | 'anulado';

export function estadoDeToken(t: Pick<TokenSimulador, 'caducaAt' | 'anuladoAt'>, ahora: Date): EstadoToken {
  if (t.anuladoAt) return 'anulado';
  if (new Date(t.caducaAt).getTime() <= ahora.getTime()) return 'caducado';
  return 'vigente';
}

// ------------------------------------------------------------ bitácora

export interface LlamadaGsg {
  en: string;
  /** "POST /api/v1/entregas", "POST /simulador/gsg/ubicaciones"... */
  que: string;
  /** El HTTP que se le devolvió. */
  status: number;
  /** Lo que pasó, en palabras (motivo si se rechazó). */
  resultado: string;
  /** Con qué entró: "token del simulador «Pruebas GSG»", "clave de API «GSG»", "sin token". */
  quien: string;
}

const bitacoraSchema = z.array(
  z.object({
    en: z.string(),
    que: z.string(),
    status: z.number().int(),
    resultado: z.string().default(''),
    quien: z.string().default(''),
  }),
);

// ------------------------------------------------------------ cuadre

/** El cierre de un día con lo de aquí. A GSG no se le pregunta nada. */
export interface CuadreGsg {
  dia: string;
  /** Los pedidos de ese día que hay aquí. */
  total: number;
  /** Lo que aquí figura entregado, terminado o cancelado ese día. */
  cerradasAqui: number;
  /** Referencias que siguen abiertas (ni entregadas ni canceladas). */
  abiertas: string[];
  /** true = no queda ninguno abierto. */
  ok: boolean;
  resumen: string;
  at: string;
}

// ------------------------------------------------------------ el servicio

export interface DepsGsgExtras {
  settingsRepo: SettingsRepo;
  /** Para el cuadre: lo que aquí figura ese día. Solo lectura. */
  entregasDelDia?: (dia: string) => Promise<Array<{ referencia: string; estado: string }>>;
  ahora?: () => Date;
  timezone?: string;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

export interface ServicioGsgExtras {
  /** Revisa los pedidos que llegaron (empujados por GSG o del simulador) y apunta lo que no se puede usar. Devuelve cuántos descartó. */
  observarPendientes(cuerpo: unknown): Promise<number>;
  descartesDeHoy(): { dia: string; lista: DescarteGsg[] };
  verificarContrato(): Promise<VerificacionContrato>;
  ultimaVerificacion(): VerificacionContrato | null;
  crearTokenSimulador(input: { nombre?: string; dias?: number }): Promise<{ token: string; registro: TokenSimulador }>;
  anularTokenSimulador(id: string): Promise<boolean>;
  tokensSimulador(): Array<TokenSimulador & { estado: EstadoToken }>;
  /** Si el token es uno de los caducables y sigue vigente, devuelve su registro (y anota el uso). */
  resolverTokenSimulador(token: string | null): Promise<TokenSimulador | null>;
  anotarLlamada(llamada: Omit<LlamadaGsg, 'en'>): Promise<void>;
  bitacora(): LlamadaGsg[];
  cuadrar(dia?: string): Promise<CuadreGsg>;
  ultimoCuadre(): CuadreGsg | null;
  /** De donde salen las entregas del dia para el cuadre (se engancha al registrar las rutas). */
  usarEntregas(fn: DepsGsgExtras['entregasDelDia']): void;
  recargar(): Promise<void>;
}

const diaDe = (fecha: Date, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
  } catch {
    return fecha.toISOString().slice(0, 10);
  }
};

export async function crearGsgExtras(deps: DepsGsgExtras): Promise<ServicioGsgExtras> {
  const ahora = deps.ahora ?? (() => new Date());
  const timezone = deps.timezone ?? 'America/Lima';
  const log = deps.log ?? (() => undefined);

  let descartes: { dia: string; lista: DescarteGsg[] } = { dia: '', lista: [] };
  let tokens: TokenGuardado[] = [];
  let llamadas: LlamadaGsg[] = [];
  let ultimaVerificacion: VerificacionContrato | null = null;
  let ultimoCuadre: CuadreGsg | null = null;
  let entregasDelDia = deps.entregasDelDia;

  async function recargar(): Promise<void> {
    descartes = { dia: '', lista: [] };
    tokens = [];
    llamadas = [];
    for (const row of await deps.settingsRepo.getAll()) {
      try {
        if (row.key === CLAVE_DESCARTES) descartes = descartesSchema.parse(JSON.parse(row.value));
        else if (row.key === CLAVE_TOKENS) tokens = tokensSchema.parse(JSON.parse(row.value));
        else if (row.key === CLAVE_BITACORA) llamadas = bitacoraSchema.parse(JSON.parse(row.value));
      } catch {
        log(`no se pudo leer ${row.key}: se ignora`);
      }
    }
  }
  await recargar();

  const guardarTokens = () => deps.settingsRepo.put(CLAVE_TOKENS, JSON.stringify(tokens), false);

  const hoy = () => diaDe(ahora(), timezone);
  const descartesDeHoy = () => {
    const dia = hoy();
    return descartes.dia === dia ? descartes : { dia, lista: [] };
  };

  return {
    recargar,

    async observarPendientes(cuerpo) {
      const dia = hoy();
      if (descartes.dia !== dia) descartes = { dia, lista: [] };
      if (!cuerpo || typeof cuerpo !== 'object') return 0;
      const c = cuerpo as Record<string, unknown>;
      const nuevos: DescarteGsg[] = [];
      for (const lista of ['faltaUbicacion', 'faltaConfirmacion'] as const) {
        const v = c[lista];
        if (!Array.isArray(v)) continue;
        v.forEach((p, i) => {
          const r = revisarPedidoGsg(p as PedidoCrudo);
          if (r.ok) return;
          const referencia = String((p as PedidoCrudo)?.referencia ?? '').trim() || `(sin referencia, el n.º ${i + 1} de ${lista})`;
          nuevos.push({ referencia, motivo: r.motivo, lista, en: ahora().toISOString() });
        });
      }
      // Lo mismo de hace cinco minutos no se apunta dos veces: se queda la ultima vez.
      const restantes = descartes.lista.filter((d) => !nuevos.some((n) => n.referencia === d.referencia && n.lista === d.lista));
      descartes = { dia, lista: [...restantes, ...nuevos].slice(-200) };
      await deps.settingsRepo.put(CLAVE_DESCARTES, JSON.stringify(descartes), false);
      return nuevos.length;
    },

    descartesDeHoy,

    async verificarContrato() {
      // Sin red: solo lo que GSG ya nos mandó (la bitácora) y lo que hoy no se pudo leer.
      const at = ahora().toISOString();
      const h: HallazgoContrato[] = [];
      const deGsg = llamadas.filter((l) => /^(POST|PATCH|DELETE) \/api\/v1\/entregas(\/|$)/.test(l.que));
      let aceptadas = 0;
      let problemas = 0;
      for (const l of deGsg.slice(0, 20)) {
        const donde = `${l.que} (${l.en.slice(0, 16).replace('T', ' ')})`;
        if (l.status >= 200 && l.status < 300) {
          aceptadas++;
          h.push({ tipo: 'ok', donde, detalle: l.resultado || 'aceptada' });
        } else if (l.status === 400 || l.status === 401 || l.status === 403) {
          problemas++;
          h.push({ tipo: l.status === 400 ? 'formato' : 'falta', donde, detalle: l.status === 400 ? l.resultado : `${l.resultado} (la clave de API que usa GSG no vale o no tiene el permiso entregas:gestionar)` });
        } else {
          h.push({ tipo: 'aviso', donde, detalle: l.resultado });
        }
      }
      const descartados = descartesDeHoy().lista;
      for (const d of descartados) {
        problemas++;
        h.push({ tipo: d.motivo.startsWith('sin ') ? 'falta' : 'formato', donde: `pedido ${d.referencia}`, detalle: `no se pudo usar: ${d.motivo}` });
      }
      if (!deGsg.length) {
        h.unshift({ tipo: 'aviso', donde: 'POST /api/v1/entregas', detalle: 'GSG todavía no nos ha mandado ningún pedido. GSGchat no le pide nada: cuando GSG los mande, aquí se verá si cumplen el contrato.' });
      }
      const ok = aceptadas > 0 && problemas === 0;
      const resumen = !deGsg.length && !problemas
        ? 'Todavía no hay nada que verificar: GSG no ha mandado ningún pedido a POST /api/v1/entregas.'
        : ok
          ? `El contrato se cumple: ${aceptadas} llamada(s) de GSG aceptadas y ningún pedido descartado hoy.`
          : `Hay ${problemas} problema(s) en lo que GSG nos mandó${aceptadas ? ` (y ${aceptadas} llamada(s) aceptadas)` : ''}.`;
      ultimaVerificacion = { ok, resumen, hallazgos: h, at };
      return ultimaVerificacion;
    },
    ultimaVerificacion: () => ultimaVerificacion,

    async crearTokenSimulador(input) {
      const token = `gsgsim_${randomBytes(24).toString('base64url')}`;
      const dias = Math.min(365, Math.max(1, Math.round(input.dias ?? 30)));
      const creado = ahora();
      const registro: TokenGuardado = {
        id: `ts_${randomBytes(6).toString('hex')}`,
        nombre: (input.nombre ?? '').trim().slice(0, 80) || 'Programadores de GSG',
        hash: hashDe(token),
        creadoAt: creado.toISOString(),
        caducaAt: new Date(creado.getTime() + dias * 24 * 60 * 60_000).toISOString(),
        anuladoAt: null,
        ultimoUsoAt: null,
        usos: 0,
        pista: token.slice(-4),
      };
      tokens = [...tokens, registro].slice(-20);
      await guardarTokens();
      const { hash: _h, ...publico } = registro;
      void _h;
      return { token, registro: publico };
    },

    async anularTokenSimulador(id) {
      const t = tokens.find((x) => x.id === id);
      if (!t || t.anuladoAt) return false;
      t.anuladoAt = ahora().toISOString();
      await guardarTokens();
      return true;
    },

    tokensSimulador() {
      const en = ahora();
      return tokens.map(({ hash: _h, ...t }) => {
        void _h;
        return { ...t, estado: estadoDeToken(t, en) };
      });
    },

    async resolverTokenSimulador(token) {
      if (!token || !token.startsWith('gsgsim_')) return null;
      const h = hashDe(token);
      const t = tokens.find((x) => x.hash === h);
      if (!t || estadoDeToken(t, ahora()) !== 'vigente') return null;
      t.usos += 1;
      t.ultimoUsoAt = ahora().toISOString();
      // No hace falta esperar: si se pierde un contador no pasa nada.
      void guardarTokens().catch(() => undefined);
      const { hash: _h, ...publico } = t;
      void _h;
      return publico;
    },

    async anotarLlamada(llamada) {
      llamadas = [{ en: ahora().toISOString(), ...llamada }, ...llamadas].slice(0, BITACORA_MAX);
      await deps.settingsRepo.put(CLAVE_BITACORA, JSON.stringify(llamadas), false).catch(() => undefined);
    },
    bitacora: () => llamadas,

    async cuadrar(dia) {
      // Solo con lo de aquí: GSGchat no le pide a GSG su lista de terminados.
      const d = dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : hoy();
      const at = ahora().toISOString();
      const aqui = entregasDelDia ? await entregasDelDia(d) : [];
      const cerradas = aqui.filter((e) => e.estado === 'entregada' || e.estado === 'terminada' || e.estado === 'cancelada');
      const abiertas = aqui.filter((e) => !cerradas.includes(e)).map((e) => e.referencia).sort();
      const ok = abiertas.length === 0;
      const resumen = !aqui.length
        ? `El ${d} no hay pedidos aquí.`
        : ok
          ? `Día cerrado: los ${aqui.length} pedido(s) están entregados o cancelados.`
          : `Quedan ${abiertas.length} de ${aqui.length} pedido(s) sin cerrar (${abiertas.slice(0, 8).join(', ')}${abiertas.length > 8 ? '…' : ''}).`;
      ultimoCuadre = { dia: d, total: aqui.length, cerradasAqui: cerradas.length, abiertas, ok, resumen, at };
      return ultimoCuadre;
    },
    ultimoCuadre: () => ultimoCuadre,
    usarEntregas(fn) {
      entregasDelDia = fn;
    },
  };
}
