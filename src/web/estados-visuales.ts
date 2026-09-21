/**
 * Un solo nombre y un solo color para cada estado, en todas las pantallas.
 *
 * Hoy, el mapa, Motorizados, Tiendas, la campana y los resumenes pintan
 * "chips" de estado. Antes cada pantalla elegia su palabra y su color; aqui
 * queda la tabla unica: el estado interno (el que guarda la base y usan las
 * pruebas) -> el nombre que ve la persona y el tono (verde, ambar, rojo,
 * azul, gris). El CSS de los tonos vive en el armazon (`.chip.tono-*`).
 *
 * Dos formas de usarlo:
 *  - en el servidor, `chipHtml(ESTADOS_ENTREGA, entrega.estado)`;
 *  - en el JS de una pagina, pegando `estadosVisualesJs()` en el script y
 *    llamando `chipEstado('entrega', estado)`.
 */

export type Tono = 'verde' | 'ambar' | 'rojo' | 'azul' | 'gris';

export interface EstadoVisual {
  nombre: string;
  tono: Tono;
}

/** Los estados de una entrega del dia, mas las tres marcas que la acompañan (urgente, segunda visita, reservada). */
export const ESTADOS_ENTREGA: Record<string, EstadoVisual> = {
  pendiente: { nombre: 'Pendiente', tono: 'gris' },
  esperando_ubicacion: { nombre: 'Falta ubicación', tono: 'ambar' },
  esperando_confirmacion: { nombre: 'Falta confirmar', tono: 'ambar' },
  lista: { nombre: 'Lista', tono: 'azul' },
  esperando_motorizado: { nombre: 'En camino', tono: 'azul' },
  avisada: { nombre: 'Avisada', tono: 'azul' },
  entregada: { nombre: 'Entregada', tono: 'verde' },
  terminada: { nombre: 'Terminada', tono: 'verde' },
  cancelada: { nombre: 'Cancelada', tono: 'gris' },
  incidencia: { nombre: 'Incidencia', tono: 'rojo' },
  segunda_visita: { nombre: 'Segunda visita', tono: 'azul' },
  urgente: { nombre: 'Urgente', tono: 'rojo' },
  reservada: { nombre: 'Reservada', tono: 'azul' },
};

/** El estado de un motorizado (alta/descanso/baja) y como va con su pin. */
export const ESTADOS_MOTORIZADO: Record<string, EstadoVisual> = {
  activo: { nombre: 'Activo', tono: 'verde' },
  descanso: { nombre: 'Descanso', tono: 'ambar' },
  baja: { nombre: 'Baja', tono: 'gris' },
  sin_asignar: { nombre: 'Libre', tono: 'gris' },
  enviado: { nombre: 'Esperando respuesta', tono: 'ambar' },
  respondio: { nombre: 'Respondió', tono: 'verde' },
  sin_respuesta: { nombre: 'Sin respuesta', tono: 'rojo' },
};

/** WhatsApp, GSG y el resto de conexiones. */
export const ESTADOS_CONEXION: Record<string, EstadoVisual> = {
  conectado: { nombre: 'Conectado', tono: 'verde' },
  caido: { nombre: 'Caído', tono: 'rojo' },
  sin_conectar: { nombre: 'Sin conectar', tono: 'gris' },
  simulador: { nombre: 'Simulador', tono: 'azul' },
};

/** La membresia de una tienda, vista por el dueño del sistema. */
export const ESTADOS_TIENDA: Record<string, EstadoVisual> = {
  al_dia: { nombre: 'Al día', tono: 'verde' },
  vence_pronto: { nombre: 'Vence pronto', tono: 'ambar' },
  vencida: { nombre: 'Vencida', tono: 'rojo' },
  suspendida: { nombre: 'Suspendida', tono: 'gris' },
};

export const GRUPOS_ESTADOS = {
  entrega: ESTADOS_ENTREGA,
  motorizado: ESTADOS_MOTORIZADO,
  conexion: ESTADOS_CONEXION,
  tienda: ESTADOS_TIENDA,
} as const;

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** El chip de un estado, para HTML armado en el servidor. Un estado desconocido sale en gris con su propio nombre. */
export function chipHtml(mapa: Record<string, EstadoVisual>, estado: string, extra = ''): string {
  const v = mapa[estado] ?? { nombre: estado.replace(/_/g, ' '), tono: 'gris' as Tono };
  return `<span class="chip tono-${v.tono}${extra ? ' ' + extra : ''}" data-estado="${escapar(estado)}">${escapar(v.nombre)}</span>`;
}

/**
 * El mismo catalogo, como JS para pegar dentro de un `String.raw` de pagina.
 * Sin backticks ni `${`, para que quepa en cualquier script de los nuestros.
 * Define `ESTADOS_VISUALES` y `chipEstado(grupo, estado)` -> HTML del chip.
 */
export function estadosVisualesJs(): string {
  const json = JSON.stringify(GRUPOS_ESTADOS);
  return [
    'var ESTADOS_VISUALES = ' + json + ';',
    'function chipEstado(grupo, estado, extra) {',
    "  var mapa = ESTADOS_VISUALES[grupo] || {};",
    "  var v = mapa[estado] || { nombre: String(estado || '').replace(/_/g, ' '), tono: 'gris' };",
    "  var texto = String(v.nombre).replace(/&/g, '&amp;').replace(/</g, '&lt;');",
    "  return '<span class=\"chip tono-' + v.tono + (extra ? ' ' + extra : '') + '\" data-estado=\"' + String(estado || '').replace(/\"/g, '') + '\">' + texto + '</span>';",
    '}',
  ].join('\n');
}
