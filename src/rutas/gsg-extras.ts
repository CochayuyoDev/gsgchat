/**
 * Lo que rodea a la conexión con GSG y que antes no se veía:
 *
 *  - **Descartes**: cada pedido que GSG manda en `/reparto/pendientes` y que
 *    no se puede usar (sin referencia, teléfono inválido, pin con formato
 *    raro). Antes solo quedaba en el log del servidor; ahora se guarda por día
 *    y se enseña en Conexión → GSG y en la campana.
 *  - **Verificador del contrato**: consulta la API real de GSG y dice, campo
 *    por campo, qué falta o sobra respecto a lo que este sistema espera. No
 *    crea nada.
 *  - **Tokens del simulador**: para que los programadores de GSG prueben
 *    desde fuera contra `/simulador/gsg` sin conocer el token interno. Se ven
 *    una vez, caducan y se anulan. Se guardan solo como hash.
 *  - **Bitácora**: las últimas 50 llamadas que GSG (o quien tenga un token)
 *    hizo al simulador y a `/api/v1/entregas`: hora, ruta, resultado, motivo.
 *  - **Cuadre de fin de día**: lo que GSG tiene en «terminados» frente a lo
 *    que aquí figura entregado o cancelado.
 *
 * Todo vive en `settings` (claves `gsg.*`) y se lee al arrancar.
 */

import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { SettingsRepo } from '../settings/service.js';
import { PERU, revisarTelefono } from './telefono.js';
import { RUTA_GSG_PENDIENTES, type PuertoGsg } from './gsg.js';

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

/** Lo que se lee de cada pedido de GSG (lo documenta el OpenAPI, /api/v1/openapi.json). */
export const CAMPOS_PEDIDO = new Set([
  'referencia', 'telefono', 'nombre', 'direccion', 'distrito', 'notas', 'lat', 'lng', 'id', 'urgente', 'cancelado', 'motivoCancelacion',
  // Los datos del envio del primer mensaje al cliente (todos opcionales). Ver src/entregas/datos-envio.ts.
  'producto', 'empresa', 'empresaCodigo', 'empresaNombre', 'tiendaCodigo', 'tiendaNombre', 'tracking', 'nroPedido', 'metodoPago', 'monto', 'remitente',
]);
const LISTAS = ['faltaUbicacion', 'faltaConfirmacion', 'terminados'] as const;

/** Revisa el cuerpo de `/reparto/pendientes` campo por campo, sin crear nada. */
export function verificarCuerpoPendientes(cuerpo: unknown): Omit<VerificacionContrato, 'at'> {
  const h: HallazgoContrato[] = [];
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    return { ok: false, resumen: 'La respuesta no es un objeto JSON con las listas del día.', hallazgos: [{ tipo: 'falta', donde: 'respuesta', detalle: 'Se esperaba { dia, faltaUbicacion: [...], faltaConfirmacion: [...], terminados: [...] }.' }] };
  }
  const c = cuerpo as Record<string, unknown>;
  if (typeof c.dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.dia)) {
    h.push({ tipo: c.dia === undefined ? 'aviso' : 'formato', donde: 'dia', detalle: c.dia === undefined ? 'No viene "dia": se usa la fecha de hoy. Mejor mandarla como "2026-09-21".' : `"dia" tiene que ser AAAA-MM-DD (vino ${JSON.stringify(c.dia)}).` });
  } else h.push({ tipo: 'ok', donde: 'dia', detalle: c.dia });
  for (const lista of LISTAS) {
    const v = c[lista];
    if (v === undefined) {
      h.push({ tipo: lista === 'terminados' ? 'aviso' : 'falta', donde: lista, detalle: lista === 'terminados' ? 'No viene "terminados": vale, pero sin ella no se puede cuadrar el día.' : `Falta la lista "${lista}" (puede venir vacía: []).` });
      continue;
    }
    if (!Array.isArray(v)) {
      h.push({ tipo: 'formato', donde: lista, detalle: `"${lista}" tiene que ser una lista (vino ${typeof v}).` });
      continue;
    }
    h.push({ tipo: 'ok', donde: lista, detalle: `${v.length} pedido(s)` });
    v.forEach((p, i) => {
      const donde = `${lista}[${i}]`;
      if (!p || typeof p !== 'object') {
        h.push({ tipo: 'formato', donde, detalle: 'no es un objeto' });
        return;
      }
      const o = p as Record<string, unknown>;
      const ref = String(o.referencia ?? '').trim() || `#${i + 1}`;
      if (lista === 'terminados') {
        if (!String(o.referencia ?? '').trim()) h.push({ tipo: 'falta', donde, detalle: 'sin "referencia": no se sabe qué pedido terminó.' });
        return;
      }
      const r = revisarPedidoGsg(o as PedidoCrudo);
      if (!r.ok) h.push({ tipo: r.motivo.startsWith('sin ') ? 'falta' : 'formato', donde: `${donde} (${ref})`, detalle: r.motivo });
      if (lista === 'faltaConfirmacion' && (o.lat === undefined || o.lng === undefined)) {
        h.push({ tipo: 'aviso', donde: `${donde} (${ref})`, detalle: 'está en "faltaConfirmacion" sin pin: se le pedirá la ubicación primero.' });
      }
      if (o.urgente !== undefined && typeof o.urgente !== 'boolean') h.push({ tipo: 'formato', donde: `${donde} (${ref}).urgente`, detalle: `tiene que ser true/false (vino ${JSON.stringify(o.urgente)}).` });
      for (const k of Object.keys(o)) if (!CAMPOS_PEDIDO.has(k)) h.push({ tipo: 'sobra', donde: `${donde} (${ref}).${k}`, detalle: 'este campo no se usa: no pasa nada, pero no hace falta mandarlo.' });
    });
  }
  const faltan = h.filter((x) => x.tipo === 'falta').length;
  const formato = h.filter((x) => x.tipo === 'formato').length;
  const sobran = h.filter((x) => x.tipo === 'sobra').length;
  const ok = faltan === 0 && formato === 0;
  const partes: string[] = [];
  if (ok) partes.push('El contrato se cumple');
  else partes.push(`Hay ${faltan + formato} problema(s)`);
  if (faltan) partes.push(`${faltan} obligatorio(s) que faltan`);
  if (formato) partes.push(`${formato} con formato raro`);
  if (sobran) partes.push(`${sobran} campo(s) que sobran (no molestan)`);
  return { ok, resumen: partes.join(' · ') + '.', hallazgos: h };
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
  /** "GET /simulador/gsg/reparto/pendientes", "POST /api/v1/entregas"... */
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

export interface CuadreGsg {
  dia: string;
  /** Referencias que GSG tiene en terminados. */
  terminadosGsg: number;
  /** Lo que aquí figura entregado o cancelado ese día. */
  cerradasAqui: number;
  /** Entregadas aquí que GSG no tiene en terminados. */
  faltanEnGsg: string[];
  /** Terminados en GSG que aquí no figuran entregados ni cancelados. */
  sobranEnGsg: string[];
  /** Entregadas aquí y en GSG: coincide. */
  coinciden: number;
  ok: boolean;
  resumen: string;
  at: string;
}

// ------------------------------------------------------------ el servicio

export interface DepsGsgExtras {
  settingsRepo: SettingsRepo;
  /** El puerto vigente (real o simulador) para el verificador y el cuadre. */
  puerto: () => PuertoGsg;
  /** Para el cuadre: lo que aquí figura ese día. Solo lectura. */
  entregasDelDia?: (dia: string) => Promise<Array<{ referencia: string; estado: string }>>;
  ahora?: () => Date;
  timezone?: string;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

export interface ServicioGsgExtras {
  /** Revisa las listas que llegaron y apunta lo que no se puede usar. Devuelve cuántos descartó. */
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

    descartesDeHoy() {
      const dia = hoy();
      return descartes.dia === dia ? descartes : { dia, lista: [] };
    },

    async verificarContrato() {
      const at = ahora().toISOString();
      const puerto = deps.puerto();
      if (!puerto.conectado()) {
        ultimaVerificacion = { ok: false, resumen: 'No hay conexión con GSG: configura la dirección de su API.', hallazgos: [], at };
        return ultimaVerificacion;
      }
      const r = await puerto.consultar<unknown>(RUTA_GSG_PENDIENTES);
      if (!r.ok) {
        const detalle =
          r.status === 401
            ? 'GSG rechazó la clave (error 401): la API Key de GSG es incorrecta. Revisa que sea la que te dio GSG.'
            : r.status === 403
              ? 'GSG rechazó la clave (error 403): la API Key de GSG no tiene permisos. Pide a GSG que le dé acceso.'
            : r.status === 404
              ? `GSG respondió con error 404: no tiene la ruta ${RUTA_GSG_PENDIENTES}. Revisa la dirección (tiene que ser la base de su API).`
              : `No se pudo consultar a GSG: ${r.error ?? 'sin respuesta'}.`;
        ultimaVerificacion = { ok: false, resumen: detalle, hallazgos: [{ tipo: 'falta', donde: RUTA_GSG_PENDIENTES, detalle }], at };
        return ultimaVerificacion;
      }
      ultimaVerificacion = { ...verificarCuerpoPendientes(r.cuerpo), at };
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
      const d = dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : hoy();
      const at = ahora().toISOString();
      const puerto = deps.puerto();
      const base: CuadreGsg = { dia: d, terminadosGsg: 0, cerradasAqui: 0, faltanEnGsg: [], sobranEnGsg: [], coinciden: 0, ok: false, resumen: '', at };
      if (!puerto.conectado()) {
        ultimoCuadre = { ...base, resumen: 'No hay conexión con GSG: no se puede cuadrar.' };
        return ultimoCuadre;
      }
      const r = await puerto.consultar<{ dia?: string; terminados?: Array<{ referencia?: unknown }> }>(RUTA_GSG_PENDIENTES);
      if (!r.ok || !r.cuerpo) {
        ultimoCuadre = { ...base, resumen: `GSG no respondió: ${r.error ?? 'sin cuerpo'}.` };
        return ultimoCuadre;
      }
      const terminados = new Set((Array.isArray(r.cuerpo.terminados) ? r.cuerpo.terminados : []).map((t) => String(t?.referencia ?? '').trim()).filter(Boolean));
      const aqui = entregasDelDia ? await entregasDelDia(d) : [];
      const cerradas = aqui.filter((e) => e.estado === 'entregada' || e.estado === 'terminada' || e.estado === 'cancelada');
      const refsAqui = new Set(cerradas.map((e) => e.referencia));
      const faltanEnGsg = [...refsAqui].filter((ref) => !terminados.has(ref)).sort();
      const sobranEnGsg = [...terminados].filter((ref) => !refsAqui.has(ref)).sort();
      const coinciden = [...refsAqui].filter((ref) => terminados.has(ref)).length;
      const ok = faltanEnGsg.length === 0 && sobranEnGsg.length === 0;
      const resumen = ok
        ? `Cuadra: ${coinciden} pedido(s) cerrados aquí y terminados en GSG.`
        : `No cuadra: ${faltanEnGsg.length} cerrado(s) aquí que GSG no tiene como terminados` + (faltanEnGsg.length ? ` (${faltanEnGsg.slice(0, 8).join(', ')}${faltanEnGsg.length > 8 ? '…' : ''})` : '') + `; ${sobranEnGsg.length} terminado(s) en GSG que aquí siguen abiertos` + (sobranEnGsg.length ? ` (${sobranEnGsg.slice(0, 8).join(', ')}${sobranEnGsg.length > 8 ? '…' : ''})` : '') + '.';
      ultimoCuadre = { dia: d, terminadosGsg: terminados.size, cerradasAqui: cerradas.length, faltanEnGsg, sobranEnGsg, coinciden, ok, resumen, at };
      return ultimoCuadre;
    },
    ultimoCuadre: () => ultimoCuadre,
    usarEntregas(fn) {
      entregasDelDia = fn;
    },
  };
}
