import type { UsuarioSesion } from '../auth/routes.js';

export interface AlcanceChat {
  /** Filtro de mensajes de sesiones web; la retención de 24 h fija el límite temporal. */
  afterId: string;
  /** Retención global móvil de mensajes, se calcula por petición. */
  retenidosDesde: Date;
}

export function alcanceChat(usuario: UsuarioSesion | null, ahora = Date.now()): AlcanceChat {
  const retenidosDesde = new Date(ahora - 24 * 60 * 60 * 1000);
  if (usuario?.porToken) return { afterId: '0', retenidosDesde };
  if (!usuario?.chatSesion) {
    const error = new Error('Tu sesión no tiene un inicio de chat válido. Vuelve a iniciar sesión.');
    Object.assign(error, { statusCode: 409, codigo: 'SESION_CHAT_REQUIERE_LOGIN', ir: '/login' });
    throw error;
  }
  // El chat permanece disponible durante toda su ventana de retención aunque
  // la cookie expire o el usuario vuelva a iniciar sesión. El límite de 24 h
  // evita recuperar historiales más antiguos.
  return { afterId: '0', retenidosDesde };
}
