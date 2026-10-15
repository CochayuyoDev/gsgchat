import type { UsuarioSesion } from '../auth/routes.js';

export interface AlcanceChat {
  /** MAX(id) de la tienda al iniciar el login web, decimal bigint firmado. */
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
  return { afterId: usuario.chatSesion.afterId, retenidosDesde };
}
