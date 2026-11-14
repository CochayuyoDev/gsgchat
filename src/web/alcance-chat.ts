import type { UsuarioSesion } from '../auth/routes.js';
import { RETENCION_CHAT_MS } from '../whatsapp/retencion-chat.js';

export interface AlcanceChat {
  /** Filtro de mensajes de sesiones web; la retención de 72 h fija el límite temporal. */
  afterId: string;
  /** Retención global móvil de mensajes, se calcula por petición. */
  retenidosDesde: Date;
}

export function alcanceChat(usuario: UsuarioSesion | null, ahora = Date.now()): AlcanceChat {
  const retenidosDesde = new Date(ahora - RETENCION_CHAT_MS);
  if (!usuario) {
    const error = new Error('Inicia sesión para acceder al chat.');
    Object.assign(error, { statusCode: 401, codigo: 'SESION_REQUERIDA', ir: '/login' });
    throw error;
  }
  // Las sesiones firmadas anteriores a chatSesion también son válidas: ese
  // cursor ya no delimita el chat. Las rutas ya verifican la autenticación.
  // El chat permanece disponible durante toda su ventana de retención aunque
  // la cookie expire o el usuario vuelva a iniciar sesión. El límite de 72 h
  // evita recuperar historiales más antiguos.
  return { afterId: '0', retenidosDesde };
}
