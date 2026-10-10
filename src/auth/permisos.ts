/**
 * Que puede hacer una clave de API.
 *
 * Antes una clave lo podia todo, y darle una a otro sistema era darle el
 * sistema entero: pausar el numero, borrar plantillas, tocar usuarios. Con
 * permisos, a Stoky se le da "enviar mensajes y leer conversaciones" y
 * nada mas. Las claves de antes conservan '*', que es lo que tenian.
 *
 * '*' es ademas lo unico que abre la API interna (/admin): una clave acotada
 * entra solo por /api/v1, que es la puerta pensada para otros sistemas.
 */

export const PERMISOS = {
  'mensajes:enviar': 'Enviar mensajes: texto, plantilla, pin o pedir la ubicacion',
  'conversaciones:leer': 'Leer la lista de chats y el hilo de cada uno',
  'contactos:leer': 'Consultar contactos y su consentimiento',
  'contactos:escribir': 'Crear contactos, registrar consentimiento o baja',
  'plantillas:leer': 'Ver las plantillas aprobadas',
  'estado:leer': 'Ver el estado del numero, la conexion y la salud',
  'webhooks:gestionar': 'Crear, cambiar y borrar webhooks salientes',
  'ia:ordenar': 'Darle ordenes con palabras a la IA operadora (POST /api/v1/ia/ordenes); ejecuta solo lo que los demas permisos de la clave dejan',
  'pedidos:gestionar': 'Ver y cambiar de estado los pedidos tomados en el chat',
  'ia:entrenar': 'Ensenarle lecciones al asistente de WhatsApp y leerlas (POST/GET /api/v1/ia/lecciones)',
  'entregas:leer': 'Ver los pedidos del día, sus ubicaciones y confirmaciones (GET /api/v1/entregas)',
  'entregas:gestionar': 'Recibir y gestionar los pedidos que manda GSG',
  '*': 'Todo, incluida la API interna /admin (como las claves de antes)',
} as const;

/** Los nombres retirados quedan solo como tipos para leer registros históricos. */
export type Permiso = keyof typeof PERMISOS | 'embed:emitir' | 'conectores:gestionar' | 'stoky:conectar' | 'procesos:gestionar';

export const NOMBRES_PERMISOS = Object.keys(PERMISOS) as Permiso[];

export function esPermiso(valor: string): valor is Permiso {
  return Object.prototype.hasOwnProperty.call(PERMISOS, valor);
}

export function tienePermiso(permisos: readonly string[] | undefined, permiso: Permiso): boolean {
  if (!permisos) return false;
  return permisos.includes('*') || permisos.includes(permiso);
}

/** Limpia y valida una lista que llega de fuera. Vacia = todo, como antes. */
export function permisosAceptables(lista: unknown): { permisos: Permiso[] } | { error: string } {
  if (lista === undefined || lista === null) return { permisos: ['*'] };
  if (!Array.isArray(lista)) return { error: 'Los permisos tienen que ser una lista.' };
  const limpios = [...new Set(lista.map((p) => String(p).trim()).filter(Boolean))];
  if (!limpios.length) return { permisos: ['*'] };
  const malos = limpios.filter((p) => !esPermiso(p));
  if (malos.length) return { error: `Permisos desconocidos: ${malos.join(', ')}. Validos: ${NOMBRES_PERMISOS.join(', ')}.` };
  return { permisos: limpios.includes('*') ? ['*'] : (limpios as Permiso[]) };
}
