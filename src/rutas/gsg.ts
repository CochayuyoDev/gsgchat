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
  /** A donde va la consulta del estado de un envio (base + ruta), o null si no esta configurada. */
  urlEstado?(): string | null;
  /** A donde salen las incidencias (base + ruta configurada, o la de siempre), o null sin conexion. */
  urlIncidencias?(): string | null;
  /**
   * El endpoint de GSG que dice si a un envio se le puede seguir escribiendo:
   * GET {base}/{rutaEstado}?{paramTracking}=…&{paramTelefono}=… con la API Key
   * en X-API-Key. Nunca lanza: un fallo vuelve como decision 'desconocido'.
   */
  consultarEstado?(consulta: { tracking: string; telefono: string }): Promise<ConsultaEstadoGsg>;
  /** A donde salen las etiquetas de los chats (base + ruta), o null si no esta configurada. */
  urlEtiquetas?(): string | null;
  /**
   * Manda a GSG la etiqueta de la conversacion de un dia, identificada por el
   * numero de WhatsApp (sin tracking). Nunca lanza: el fallo vuelve en el resultado.
   */
  enviarEtiqueta?(etiqueta: EtiquetaParaGsg): Promise<ResultadoEnvio>;
}

/**
 * Lo que GSG recibe por cada conversacion etiquetada en Chats (POST a la base
 * + la «Ruta para etiquetas de chats» de Conexion, con X-API-Key). El
 * identificador es el numero: una misma persona puede tener varios pedidos
 * (o ninguno) ese dia. `eventoId` va tambien en Idempotency-Key: es el mismo
 * mientras no cambie la conversacion, asi un reintento no duplica nada.
 */
export interface EtiquetaParaGsg {
  /** 51987654321 */
  telefono: string;
  /** Los 9 digitos (987654321), como los guarda GSG; null si no es un celular peruano. */
  telefonoNacional: string | null;
  /** AAAA-MM-DD en la zona del negocio. */
  dia: string;
  /** Del catalogo de src/archive/clasificar.ts. */
  etiqueta: string;
  etiquetaNombre: string;
  /** Quien la puso: la IA, o las reglas cuando la IA fallo o el cliente no escribio. */
  origen: 'ia' | 'reglas';
  /** Cuantos mensajes del dia se miraron. */
  mensajes: number;
  /** Cuando se clasifico. */
  clasificadoEn: string;
  eventoId: string;
}

/**
 * Lo que GSG dice de un envio, ya decidido para GSGchat:
 *  - activo: se sigue el flujo y se le pide la ubicacion.
 *  - cancelado / numero_incorrecto / tracking_incorrecto / no_contactable:
 *    no se le escribe mas por ESE tracking (sus otros envios siguen).
 *  - desconocido: no se entendio o fallo la consulta. NUNCA se toma como
 *    cancelado: se apunta y se sigue.
 */
export type DecisionGsg = 'activo' | 'cancelado' | 'numero_incorrecto' | 'tracking_incorrecto' | 'no_contactable' | 'desconocido';

export interface ConsultaEstadoGsg {
  decision: DecisionGsg;
  /** En palabras, para la actividad del pedido y la pantalla. */
  motivo: string;
  /** false = no hay ruta de consulta configurada (no se llamo a GSG). */
  configurada: boolean;
  /** El HTTP que contesto GSG (si llego a contestar). */
  http?: number;
  /** 401/403: la clave o los permisos (problema de conexion, no del envio). */
  autenticacion?: 401 | 403;
  /** Lo que mando GSG, recortado (para la pantalla de prueba). */
  respuesta?: unknown;
}

/** Las decisiones que paran los mensajes de un tracking. */
export const DECISIONES_QUE_PARAN: readonly DecisionGsg[] = ['cancelado', 'numero_incorrecto', 'tracking_incorrecto', 'no_contactable'];

const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * La respuesta de GSG convertida en decision. El contrato final lo da GSG;
 * mientras, se entienden las formas razonables: un campo de estado en texto
 * (`estado`, `status`, `state`, `situacion`, `codigo`, `motivo`… tambien
 * dentro de `data`) o banderas (`cancelado: true`, `numeroIncorrecto: true`,
 * `contactable: false`). Lo que no se entienda es 'desconocido'.
 */
export function interpretarEstadoGsg(cuerpo: unknown): { decision: DecisionGsg; motivo: string } {
  const raiz = cuerpo && typeof cuerpo === 'object' ? (cuerpo as Record<string, unknown>) : {};
  const capas = [raiz, ...['data', 'resultado', 'result', 'envio', 'shipment'].map((k) => raiz[k]).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x))];
  const banderas = (claves: string[], valor: boolean) => capas.some((c) => claves.some((k) => c[k] === valor));
  if (banderas(['cancelado', 'cancelada', 'cancelled', 'canceled', 'anulado'], true)) return { decision: 'cancelado', motivo: 'GSG indica que el envío fue cancelado' };
  if (banderas(['numeroIncorrecto', 'telefonoIncorrecto', 'wrongNumber', 'numeroMalo'], true)) return { decision: 'numero_incorrecto', motivo: 'GSG indica que el número es incorrecto' };
  if (banderas(['trackingIncorrecto', 'trackingInvalido', 'wrongTracking'], true)) return { decision: 'tracking_incorrecto', motivo: 'GSG indica que el código de tracking es incorrecto' };
  if (banderas(['contactable', 'puedeContactar'], false) || banderas(['noContactable', 'sinContacto'], true)) return { decision: 'no_contactable', motivo: 'GSG indica que no se puede contactar al cliente' };
  const textos: string[] = [];
  for (const c of capas) for (const k of ['estado', 'status', 'state', 'situacion', 'codigo', 'code', 'motivo', 'reason', 'detalle', 'mensaje', 'message']) if (typeof c[k] === 'string' && c[k]) textos.push(String(c[k]));
  if (typeof cuerpo === 'string') textos.push(cuerpo);
  const t = sinTildes(textos.join(' | '));
  const dicho = textos.join(' · ').slice(0, 160);
  if (!t.trim()) return { decision: 'desconocido', motivo: 'GSG no dijo en qué estado está el envío' };
  if (/cancel|anulad/.test(t)) return { decision: 'cancelado', motivo: `GSG: ${dicho}` };
  if (/(numero|telefono|celular|phone)\W*(es\W*|esta\W*)?(incorrect|mal\b|malo|invalid|erroneo|equivocad|wrong|no existe)|wrong.?number|numero_incorrecto|telefono_incorrecto/.test(t)) return { decision: 'numero_incorrecto', motivo: `GSG: ${dicho}` };
  if (/(tracking|codigo)\W*(de\W*tracking\W*)?(es\W*|esta\W*)?(incorrect|mal\b|malo|invalid|erroneo|no existe|no encontrado|not.?found)|tracking_incorrecto/.test(t)) return { decision: 'tracking_incorrecto', motivo: `GSG: ${dicho}` };
  if (/no.?(se.?puede.?)?(contact|comunic)|sin.?contacto|incontactable|ilocalizable|unreachable|no_contactable/.test(t)) return { decision: 'no_contactable', motivo: `GSG: ${dicho}` };
  if (/activ|pendient|pending|en.?ruta|en.?camino|entregable|programad|asignad|vigente|en.?proceso|\bok\b/.test(t)) return { decision: 'activo', motivo: `GSG: ${dicho}` };
  return { decision: 'desconocido', motivo: `GSG contestó un estado que no se reconoce: ${dicho}` };
}

export interface OpcionesGsg {
  idempotenciaUbicacion?: boolean;
  /** La URL base de la API de GSG (p. ej. https://backend.gsg.pe/api/). */
  url: string;
  /** La ruta, relativa a la base, a la que se hace POST con la ubicacion (p. ej. v1/gsgchat/location). */
  rutaUbicacion?: string;
  /**
   * Compatibilidad: la URL completa de la ubicacion como se guardaba antes.
   * Solo se usa si no hay `rutaUbicacion`, y se convierte a base + ruta con
   * `migrarUbicacionAntigua` (si no se puede sin adivinar, no se envia nada).
   */
  ubicacionUrl?: string;
  /** La API Key que da GSG. Sale SOLO en la cabecera X-API-Key. */
  token: string;
  /** La ruta, relativa a la base, del GET que dice el estado de un envio. Sin ella no se consulta. */
  rutaEstado?: string;
  /**
   * La ruta, relativa a la base, a la que se hace POST con cada incidencia
   * (p. ej. v1/gsgchat/reported). Sin ella, la de siempre: RUTAS_GSG.incidencia.
   */
  rutaIncidencias?: string;
  /**
   * La ruta, relativa a la base, a la que se hace POST con la etiqueta de cada
   * chat (p. ej. v1/gsgchat/labels). Sin ella no se manda ninguna: GSG no
   * tiene un endpoint de siempre para esto.
   */
  rutaEtiquetas?: string;
  /** Como llama GSG al parametro del tracking (por defecto trackingCode). */
  paramTracking?: string;
  /** Como llama GSG al parametro del telefono (por defecto phone). */
  paramTelefono?: string;
  fetchImpl?: typeof fetch;
  /** Segundos antes de darse por vencido en una llamada. */
  timeoutSegundos?: number;
}

/**
 * Los problemas que GSGchat le reporta a GSG (su endpoint de reportes, p. ej.
 * POST v1/gsgchat/reported), con el contrato del plan de GSG (seccion 4):
 * { tracking, tipo: 'PROBLEMA', motivo, codigo, queHacer, comentario, telefonoOrigen, fechaMensaje, eventoId }.
 * `motivo` es su catalogo cerrado; cada codigo de GSGchat cae en uno.
 */
export type MotivoGsg = 'DIRECCION_MAL' | 'TELEFONO_MAL' | 'NO_RECONOCE_PEDIDO' | 'RECHAZA' | 'REPROGRAMA' | 'OTRO';

const MOTIVOS_GSG: Record<string, MotivoGsg> = {
  numero_corto: 'TELEFONO_MAL', numero_largo: 'TELEFONO_MAL', numero_invalido: 'TELEFONO_MAL', numero_fijo: 'TELEFONO_MAL',
  sin_whatsapp: 'TELEFONO_MAL', telefono_invalido: 'TELEFONO_MAL', telefono_de_motorizado: 'TELEFONO_MAL',
  numero_equivocado: 'NO_RECONOCE_PEDIDO', no_soy_yo: 'NO_RECONOCE_PEDIDO',
  rechaza_contacto: 'RECHAZA',
  ubicacion_fuera_de_zona: 'DIRECCION_MAL',
  cambio_ubicacion: 'DIRECCION_MAL',
};

/** El motivo de GSG de un codigo de GSGchat (lo que no tiene uno propio es OTRO, con su comentario). */
export function motivoGsg(codigo: string | null | undefined): MotivoGsg {
  return MOTIVOS_GSG[String(codigo ?? '')] ?? 'OTRO';
}

/**
 * El codigo con el que GSG recibe algunos problemas, cuando no es el de
 * GSGchat. «Sin WhatsApp» le llega como `numero_invalido`: es el codigo con el
 * que GSG deja editar el numero desde su sistema (pedido del dueño, 17/10).
 * El eventoId sigue saliendo del codigo de GSGchat, para no duplicar.
 */
const CODIGOS_PARA_GSG: Record<string, { codigo: string; titulo: string; queHacer: string }> = {
  sin_whatsapp: { codigo: 'numero_invalido', titulo: 'Número inválido: no tiene WhatsApp', queHacer: 'Corrige el número del cliente y vuelve a mandar el pedido.' },
};

/** Un celular de Peru como lo maneja GSG: los 9 digitos, sin el 51 (ni el +51) delante. */
export function nueveDigitosGsg(telefono: string | null): string | null {
  if (!telefono) return telefono;
  const d = telefono.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('51') ? d.slice(2) : telefono;
}

/** Lo mismo dentro de un texto: «el número 51987654321 no…» → «el número 987654321 no…». */
const sinPrefijoPeru = (texto: string): string => texto.replace(/(?<!\d)\+?51[\s-]?(9\d{2})[\s-]?(\d{3})[\s-]?(\d{3})(?!\d)/g, '$1$2$3');

/** El eventoId de un problema: uno por tracking, codigo y dia (un reenvio no duplica). */
export function eventoIdProblema(tracking: string, codigo: string, en: Date): string {
  return `gsgchat-${tracking}-${codigo}-${en.toISOString().slice(0, 10)}`;
}

/**
 * Lo que sale hacia GSG por una incidencia o un numero reportado, en su
 * formato. Acepta lo que guarda la cola (el payload de GSGchat, con
 * `tracking`/`referencia`, `codigo`/`error`, `titulo`/`mensaje`, `detalle`).
 */
export function problemaParaGsg(p: Record<string, unknown>): Record<string, unknown> {
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const tracking = texto(p.tracking) ?? texto(p.referencia);
  const codigo = texto(p.codigo) ?? texto(p.error) ?? 'otro';
  const paraGsg = p.origen === 'incidencia_manual' ? undefined : CODIGOS_PARA_GSG[codigo];
  const en = new Date(texto(p.detectadoEn) ?? texto(p.reportadoAt) ?? texto(p.fechaMensaje) ?? Date.now());
  const titulo = texto(p.comentario) ?? paraGsg?.titulo ?? texto(p.titulo) ?? texto(p.mensaje);
  const detalle = texto(p.detalle);
  // Si el detalle ya empieza por el titulo («Al número le faltan dígitos: …»), no se repite.
  const partes = titulo && detalle?.startsWith(titulo) ? [detalle] : [titulo, detalle];
  const comentario = sinPrefijoPeru(partes.filter(Boolean).join(': ')).slice(0, 500) || null;
  const cuerpo: Record<string, unknown> = {
    tracking,
    tipo: 'PROBLEMA',
    motivo: texto(p.motivo) ?? motivoGsg(codigo),
    // El codigo fino del catalogo de GSGchat, ademas del motivo: TELEFONO_MAL
    // no distingue «numero invalido» (corregir el numero) de «es un fijo»
    // (pedir un celular), y en GSG la accion del operador no es la misma.
    codigo: paraGsg?.codigo ?? codigo,
    queHacer: paraGsg?.queHacer ?? texto(p.queHacer),
    comentario,
    // GSG maneja los 9 digitos: sin el 51 delante (pedido del dueño, 17/10).
    telefonoOrigen: nueveDigitosGsg(texto(p.telefonoOrigen) ?? texto(p.telefono)),
    fechaMensaje: Number.isNaN(en.getTime()) ? new Date().toISOString() : en.toISOString(),
    eventoId: texto(p.eventoId) ?? (tracking ? eventoIdProblema(tracking, codigo, Number.isNaN(en.getTime()) ? new Date() : en) : null),
  };
  // La incidencia manual la escribe una persona con su resumen: no lleva «queHacer».
  if (p.origen === 'incidencia_manual') delete cuerpo.queHacer;
  return cuerpo;
}

/**
 * Encola un problema para GSG, una vez: si ese mismo eventoId ya esta en la
 * cola (pendiente o enviado), no se repite. Asi «sin WhatsApp» que llega por
 * el reparto y por la bandeja de numeros reportados sale una sola vez.
 */
export async function encolarProblemaGsg(
  rutas: { encolarReporte: RutasRepo['encolarReporte']; reportesRecientes: RutasRepo['reportesRecientes'] },
  payload: Record<string, unknown> & { tracking: string; codigo: string },
  opts: { solicitudId?: number | null; loteId?: string | null; en: Date; eventoId?: string },
): Promise<boolean> {
  const eventoId = opts.eventoId ?? eventoIdProblema(payload.tracking, payload.codigo, opts.en);
  const recientes = await rutas.reportesRecientes(500, 'incidencia').catch(() => []);
  if (recientes.some((r) => (r.payload as Record<string, unknown>)?.eventoId === eventoId)) return false;
  await rutas.encolarReporte({ solicitudId: opts.solicitudId ?? null, loteId: opts.loteId ?? null, tipo: 'incidencia', payload: { ...payload, eventoId, detectadoEn: opts.en.toISOString() } });
  return true;
}

/**
 * El camino de cada tipo dentro de la API de GSG, con los endpoints que GSG
 * tiene de verdad (`src/routes/v1/gsgchat/gsgchat.routes.js` de su back).
 *
 * `null` = GSG no recibe ese tipo todavia: no se manda y no se reintenta, en vez
 * de pegarle a una ruta inexistente y acumular 404 en la cola 24 horas.
 */
export const RUTAS_GSG: Record<TipoReporte, string | null> = {
  ubicacion: '/send-location',
  incidencia: '/reported',
  resumen: null,
  confirmacion: null,
  entrega: null,
};

/** Como se llamaba la ruta de la ubicacion antes del 12/10 (GSG la borro). */
export const RUTA_UBICACION_ANTIGUA = '/sendLocation';

/** La ruta de la ubicacion cuando no se dio otra: la de siempre (`<base>/send-location`). */
export const RUTA_UBICACION_POR_DEFECTO = 'send-location';

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
    // Se reconoce la ruta nueva y la vieja: una URL guardada antes del 12/10
    // termina en `/sendLocation` y tambien hay que despegarla.
    const pegada = [RUTAS_GSG.ubicacion!, RUTA_UBICACION_ANTIGUA]
      .find((r) => limpia.toLowerCase().endsWith(r.toLowerCase()));
    const base = normalizarBaseGsg(pegada ? limpia.slice(0, -pegada.length) : limpia);
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
/** Errores de red en los que la peticion no llego a salir (no hay resultado incierto). */
const SIN_CONEXION = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL']);

export function crearPuertoHttp(opts: OpcionesGsg): PuertoGsg {
  const destino = resolverDestinoGsg(opts);
  const crudo = opts.url.trim();
  const base = destino.ok ? destino.base : crudo;
  const doFetch = opts.fetchImpl ?? fetch;
  const clave = opts.token ?? '';
  const errorConfig = !destino.ok ? destino.error : !clave.trim() ? 'Falta la API Key de GSG.' : null;
  const firma = huella(`${base}|${destino.ok ? destino.urlUbicacion : errorConfig}|${huella(clave)}|${opts.rutaEstado ?? ''}|${opts.rutaIncidencias ?? ''}|${opts.rutaEtiquetas ?? ''}`);
  const limpio = (t: string) => sinClave(t, clave);

  const rutaEstado = (opts.rutaEstado ?? '').trim();
  // `incidencia` siempre tiene ruta (GSG la recibe): el `!` es por el tipo, que
  // admite null para los tipos que GSG no recibe.
  const rutaIncidencias = (opts.rutaIncidencias ?? '').trim() || RUTAS_GSG.incidencia!;
  const destinoIncidencias = destino.ok ? unirUrlGsg(destino.base, rutaIncidencias) : null;
  const destinoEstado = destino.ok && rutaEstado ? unirUrlGsg(destino.base, rutaEstado) : null;
  const rutaEtiquetas = (opts.rutaEtiquetas ?? '').trim();
  const destinoEtiquetas = destino.ok && rutaEtiquetas ? unirUrlGsg(destino.base, rutaEtiquetas) : null;
  const paramTracking = (opts.paramTracking ?? '').trim() || 'trackingCode';
  const paramTelefono = (opts.paramTelefono ?? '').trim() || 'phone';

  return {
    conectado: () => Boolean(crudo && clave.trim()),
    descripcion: () => `API de GSG en ${base}`,
    urlUbicacion: () => (crudo && destino.ok ? destino.urlUbicacion : null),
    urlEstado: () => (crudo && destinoEstado?.ok ? destinoEstado.url : null),
    urlIncidencias: () => (crudo && destinoIncidencias?.ok ? destinoIncidencias.url : null),
    urlEtiquetas: () => (crudo && destinoEtiquetas?.ok ? destinoEtiquetas.url : null),

    async enviarEtiqueta(etiqueta) {
      if (!destino.ok) return { ok: false, error: `Configuración de GSG no válida: ${destino.error} No se envía nada hasta corregirla.`, reintentable: true, configuracion: true };
      if (!clave.trim()) return { ok: false, error: 'Falta la API Key de GSG. Configúrala antes de enviar.', reintentable: true, configuracion: true };
      if (!rutaEtiquetas) return { ok: false, error: 'Falta la «Ruta para etiquetas de chats» en Conexión con GSG: no hay a dónde mandarlas.', reintentable: true, configuracion: true };
      if (!destinoEtiquetas?.ok) return { ok: false, error: `La ruta de las etiquetas no vale${destinoEtiquetas && !destinoEtiquetas.ok ? `: ${destinoEtiquetas.error}` : ''}.`, reintentable: true, configuracion: true };
      if (!etiqueta.telefono) return { ok: false, error: 'La etiqueta no tiene número: GSG no podría saber de quién es. No se envía.', reintentable: false };
      const url = destinoEtiquetas.url;
      const control = new AbortController();
      const corte = setTimeout(() => control.abort(), (opts.timeoutSegundos ?? 20) * 1000);
      try {
        const r = await doFetch(url, {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json', ...cabecerasDeClave(clave), 'Idempotency-Key': etiqueta.eventoId },
          body: JSON.stringify(etiqueta),
          signal: control.signal,
        });
        const texto = await r.text();
        if (!r.ok) {
          const auth = r.status === 401 || r.status === 403 ? (r.status as 401 | 403) : undefined;
          const causa = auth
            ? motivoAutenticacion(auth)
            : r.status === 404
              ? `GSG no tiene esa ruta (${url}): revisa la ruta de etiquetas`
              : r.status === 400 || r.status === 422
                ? 'GSG no aceptó los datos de la etiqueta'
                : r.status === 429
                  ? 'GSG pidió esperar (demasiadas llamadas)'
                  : r.status >= 500
                    ? 'GSG tuvo un error en su servidor'
                    : 'GSG no aceptó el envío';
          return {
            ok: false,
            error: limpio(`Error ${r.status}: ${causa}.${texto.trim() ? ` Respuesta de GSG: ${limpio(texto.trim()).slice(0, 200)}` : ''}`),
            // Con Idempotency-Key, repetir un 5xx/429/408 no duplica nada.
            reintentable: r.status >= 500 || r.status === 429 || r.status === 408,
            ...(auth ? { autenticacion: auth } : {}),
          };
        }
        let id: string | null = null;
        try {
          const cuerpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
          if (cuerpo && typeof cuerpo === 'object' && (cuerpo.ok === false || cuerpo.success === false)) {
            const detalle = typeof cuerpo.error === 'string' ? cuerpo.error : typeof cuerpo.message === 'string' ? cuerpo.message : 'el backend indicó que no aceptó la etiqueta';
            return { ok: false, reintentable: false, error: limpio(`GSG respondió HTTP ${r.status}, pero rechazó la etiqueta: ${detalle}`).slice(0, 500) };
          }
          id = (cuerpo.id ?? null) as string | null;
        } catch {
          // Un 2xx con texto plano tambien vale.
        }
        return { ok: true, id };
      } catch (error) {
        const codigo = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined;
        const motivo = control.signal.aborted
          ? `GSG no respondió a tiempo (${opts.timeoutSegundos ?? 20} s)`
          : `No se pudo conectar con GSG en ${url}: ${error instanceof Error ? (codigo ?? (error.cause as { message?: string } | undefined)?.message ?? error.message) : String(error)}`;
        return { ok: false, error: limpio(`${motivo}.`), reintentable: true };
      } finally {
        clearTimeout(corte);
      }
    },

    async consultarEstado({ tracking, telefono }) {
      if (!rutaEstado) return { decision: 'desconocido', motivo: 'No hay ruta de consulta de estado configurada: no se le pregunta a GSG.', configurada: false };
      if (!destinoEstado || !destinoEstado.ok) return { decision: 'desconocido', motivo: `La ruta de consulta de estado no es válida${destinoEstado && !destinoEstado.ok ? `: ${destinoEstado.error}` : ''}.`, configurada: true };
      if (!clave.trim()) return { decision: 'desconocido', motivo: 'Falta la API Key de GSG: no se puede consultar el estado.', configurada: true };
      const url = new URL(destinoEstado.url);
      url.searchParams.set(paramTracking, tracking);
      if (telefono) url.searchParams.set(paramTelefono, telefono);
      const control = new AbortController();
      const corte = setTimeout(() => control.abort(), (opts.timeoutSegundos ?? 10) * 1000);
      try {
        const r = await doFetch(url.toString(), { method: 'GET', redirect: 'error', headers: { accept: 'application/json', ...cabecerasDeClave(clave) }, signal: control.signal });
        const texto = await r.text();
        let cuerpo: unknown = texto;
        try { cuerpo = texto ? JSON.parse(texto) : {}; } catch { /* texto plano */ }
        const respuesta = typeof cuerpo === 'string' ? limpio(cuerpo).slice(0, 500) : cuerpo;
        if (r.status === 401 || r.status === 403) return { decision: 'desconocido', motivo: `${motivoAutenticacion(r.status)}: no se pudo consultar el estado.`, configurada: true, http: r.status, autenticacion: r.status, respuesta };
        if (!r.ok) {
          // Un 404 puede ser «ese tracking no lo tengo»: solo se toma como tal si GSG lo dice en el cuerpo.
          const leida = interpretarEstadoGsg(cuerpo);
          if (r.status === 404 && leida.decision === 'tracking_incorrecto') return { ...leida, configurada: true, http: r.status, respuesta };
          return { decision: 'desconocido', motivo: limpio(`GSG respondió ${r.status} a la consulta de estado${r.status === 404 ? ' (¿la ruta es correcta?)' : r.status >= 500 ? ' (error en su servidor)' : ''}: se sigue y se reintenta en la próxima consulta.`), configurada: true, http: r.status, respuesta };
        }
        return { ...interpretarEstadoGsg(cuerpo), configurada: true, http: r.status, respuesta };
      } catch (error) {
        const motivo = control.signal.aborted ? `GSG no respondió a tiempo a la consulta de estado (${opts.timeoutSegundos ?? 10} s)` : `No se pudo consultar el estado en GSG: ${error instanceof Error ? ((error.cause as { code?: string; message?: string } | undefined)?.code ?? (error.cause as { message?: string } | undefined)?.message ?? error.message) : String(error)}`;
        return { decision: 'desconocido', motivo: limpio(`${motivo}. No se toma como cancelado: se sigue.`), configurada: true };
      } finally {
        clearTimeout(corte);
      }
    },
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
        // Las incidencias van a la ruta del panel (si la hay); lo demas, a la de siempre.
        const camino = tipo === 'incidencia' ? rutaIncidencias : RUTAS_GSG[tipo];
        // GSG no tiene endpoint para este tipo: no se manda y no se reintenta.
        // Reintentarlo solo acumula 404 en la cola durante 24 horas.
        if (!camino) return { ok: false, error: `GSG no recibe ${tipo} todavía: no hay a dónde mandarlo.`, reintentable: false };
        const u = unirUrlGsg(destino.base, camino);
        if (!u.ok) return { ok: false, error: `Configuración de GSG no válida: ${u.error}`, reintentable: true, configuracion: true };
        url = u.url;
      }
      // Un problema (incidencia o numero reportado) va en el formato de GSG y sin tracking no sirve.
      const problema = tipo === 'incidencia' ? problemaParaGsg(payload) : null;
      if (problema && !problema.tracking) return { ok: false, error: 'El reporte no tiene tracking: GSG no podría saber de qué envío es. No se envía.', reintentable: false };
      const claveIdempotente = problema && typeof problema.eventoId === 'string'
        ? problema.eventoId
        : tipo === 'ubicacion' && opts.idempotenciaUbicacion && typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey.trim() : '';
      const idempotente = Boolean(claveIdempotente);
      const cuerpo = tipo === 'ubicacion'
        ? { tracking: payload.tracking ?? payload.referencia, lat: payload.lat ?? payload.latitud, lng: payload.lng ?? payload.longitud }
        : problema ?? payload;
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
          if (cuerpo && typeof cuerpo === 'object' && (cuerpo.ok === false || cuerpo.success === false)) {
            const detalle = typeof cuerpo.error === 'string' ? cuerpo.error : typeof cuerpo.message === 'string' ? cuerpo.message : 'el backend indicó que no aceptó el reporte';
            return { ok: false, reintentable: false, error: limpio(`GSG respondió HTTP ${respuesta.status}, pero rechazó el reporte: ${detalle}`).slice(0, 500) };
          }
          id = (cuerpo.id ?? cuerpo.referencia ?? cuerpo.codigo ?? null) as string | null;
        } catch {
          // Una API que contesta 2xx con texto plano tambien vale.
        }
        return { ok: true, id };
      } catch (error) {
        const codigo = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined;
        const motivo = control.signal.aborted
          ? `GSG no respondió a tiempo (${opts.timeoutSegundos ?? 20} s)`
          : `No se pudo conectar con GSG en ${url}: ${error instanceof Error ? (codigo ?? (error.cause as { message?: string } | undefined)?.message ?? error.message) : String(error)}`;
        // Sin conexion (rechazada, sin DNS, sin ruta) el pedido nunca salio:
        // no hay nada incierto y se reintenta solo. Un corte a mitad o un
        // tiempo agotado si pueden haber llegado.
        const causa = error instanceof Error ? (error.cause as { message?: string } | undefined)?.message : undefined;
        const noSalio = !control.signal.aborted && (Boolean(codigo && SIN_CONEXION.has(codigo)) || causa === 'bad port');
        return {
          ok: false,
          error: limpio(`${motivo}. ${noSalio ? 'No llegó a GSG: se reintenta solo.' : tipo === 'ubicacion' && !idempotente ? 'Resultado incierto: verifica en GSG si registró la ubicación antes de reintentar; no se reintenta automáticamente.' : 'Se reintenta solo con la misma clave idempotente cuando está habilitada.'}`),
          reintentable: noSalio || tipo !== 'ubicacion' || idempotente,
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
export function crearPuertoGsg(config: { GSG_URL: string; GSG_TOKEN: string; GSG_API_KEY?: string; GSG_LOCATION_PATH?: string; GSG_SEND_LOCATION_URL?: string; GSG_IDEMPOTENCY_SUPPORTED?: string }): PuertoGsg {
  return config.GSG_URL.trim()
    ? crearPuertoHttp({
        url: config.GSG_URL,
        token: (config.GSG_API_KEY ?? '').trim() || config.GSG_TOKEN,
        rutaUbicacion: config.GSG_LOCATION_PATH || undefined,
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
  etiqueta:
    'telefono (51 + 9 digitos, el identificador: no hay tracking), telefonoNacional, dia (AAAA-MM-DD), etiqueta (catalogo de src/archive/clasificar.ts),' +
    ' etiquetaNombre, origen (ia | reglas), mensajes, clasificadoEn, eventoId (= Idempotency-Key; cambia solo si cambia la conversacion)',
  ubicacion:
    'referencia, telefono, nombre, lat, lng, mapsUrl, precisionMetros, fuente, recibidoEn, lote' +
    ' (+ corregida: true cuando el cliente mando un segundo pin: sustituye al anterior de la misma referencia)' +
    ' (+ cambioUbicacion: true, cambiadaEn, cambios y anterior {lat, lng} cuando el cliente cambio su ubicacion: pidio cambiarla o mando otra)',
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
/**
 * Tras un fallo reintentable (GSG pide esperar, sin conexion), el envio al
 * momento (`alMomento`) no vuelve a intentar ese reporte hasta pasado un rato:
 * el pin y el SI disparan cada uno su envio y, sin esto, el segundo insistia
 * al instante contra un GSG caido. La pasada de cada minuto y el boton
 * «Enviar ahora» no esperan.
 */
const ESPERA_REINTENTO_MS = 30_000;
const reintentoTras = new WeakMap<object, Map<number, number>>();

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
  /**
   * manual = lo pidio una persona («Enviar ahora»): intenta aunque la cola este parada por la clave.
   * alMomento = el envio inmediato tras registrar una ubicacion: respeta la espera tras un fallo reintentable.
   */
  opciones?: { manual?: boolean; alMomento?: boolean },
): Promise<DespachoResumen> {
  const anterior = despachosEnMarcha.get(repos.rutas) ?? Promise.resolve();
  const este = anterior.catch(() => undefined).then(() => despacharAhora(repos, puerto, limite, soloTipos, opciones?.manual ?? false, opciones?.alMomento ?? false));
  despachosEnMarcha.set(repos.rutas, este);
  return este;
}

async function despacharAhora(
  repos: { rutas: RutasRepo },
  puerto: PuertoGsg,
  limite: number,
  soloTipos: TipoReporte[] | undefined,
  manual: boolean,
  alMomento = false,
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
  // Un tipo que ya no existe (los `numero_reportado` que quedaron en la cola
  // de antes: ya no se le mandan a GSG) no sale nunca.
  const conocido = (r: { tipo: string }): boolean => r.tipo in RUTAS_GSG;
  const pendientes = soloTipos
    ? (await repos.rutas.reportesPendientes(Math.max(limite, 200))).filter((r) => soloTipos.includes(r.tipo)).slice(0, limite)
    : (await repos.rutas.reportesPendientes(Math.max(limite, 200))).filter(conocido).slice(0, limite);
  const resumen: DespachoResumen = { intentados: pendientes.length, enviados: 0, fallidos: 0 };

  for (const reporte of pendientes) {
    // Un pin tardío supera la falta de respuesta. No enviar el problema viejo
    // después de las coordenadas ni fingir que GSG recibió ese problema.
    const codigo = String(reporte.payload.codigo ?? reporte.payload.error ?? '');
    if (reporte.tipo === 'incidencia' && reporte.solicitudId && ['sin_respuesta', 'respondio_sin_ubicacion'].includes(codigo)) {
      const vigente = await repos.rutas.solicitud(reporte.solicitudId);
      if (vigente?.estado === 'resuelto' && vigente.lat != null && vigente.lng != null) {
        await repos.rutas.marcarReporte(reporte.id, 'superado');
        resumen.intentados--;
        continue;
      }
    }
    // Un tipo que GSGchat ya no manda (p. ej. filas viejas de los numeros
    // reportados, que ahora GSG lee de GET /api/v1/reportados): se aparta con
    // el motivo a la vista, sin llamar a GSG ni atascar la cola.
    if (!Object.hasOwn(RUTAS_GSG, reporte.tipo)) {
      await repos.rutas.marcarReporte(reporte.id, 'fallido', { error: `Tipo de reporte que ya no se envía a GSG (${String(reporte.tipo)}): se ignora.` });
      resumen.intentados--;
      continue;
    }
    // Lo del Modulo desarrollador (numeros 51 000 0/1…, referencias PRUEBA-)
    // solo va al simulador. Contra la API real de GSG no sale NUNCA: se
    // aparta con el motivo a la vista en vez de quedarse esperando a salir.
    if (esReporteDePrueba(reporte.payload) && !puerto.esSimulador?.()) {
      await repos.rutas.marcarReporte(reporte.id, 'fallido', { error: 'Reporte de prueba (Módulo desarrollador): solo se manda al simulador de GSG, nunca a la API real.' });
      resumen.fallidos++;
      continue;
    }
    const esperas = reintentoTras.get(repos.rutas) ?? new Map<number, number>();
    reintentoTras.set(repos.rutas, esperas);
    if (alMomento && !manual && (esperas.get(reporte.id) ?? 0) > Date.now()) {
      resumen.intentados--;
      continue;
    }
    if (!(await repos.rutas.reservarReporte(reporte.id))) continue;
    // La clave idempotente lleva el tipo, no 'ubicacion' siempre: una
    // incidencia ya trae la suya (`eventoId`), y asi la de la ubicacion no se
    // confunde con la de otro tipo que se anada manana.
    const salida = await puerto.enviar(reporte.tipo, { ...reporte.payload, idempotencyKey: `gsgchat-${reporte.tipo}-${reporte.id}` });
    if (salida.ok) {
      esperas.delete(reporte.id);
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
    if (salida.reintentable) esperas.set(reporte.id, Date.now() + ESPERA_REINTENTO_MS);
    else {
      esperas.delete(reporte.id);
      resumen.fallidos++;
    }
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
