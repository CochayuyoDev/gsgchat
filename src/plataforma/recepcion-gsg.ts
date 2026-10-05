import { hashClaveApi, pareceClaveApi } from '../auth/claves-api.js';
import { tienePermiso } from '../auth/permisos.js';
import { cuerpoError, esBaseNoDisponible, ESPERA_BASE_SEGUNDOS, type CuerpoError } from '../api/errores.js';
import type { Plataforma } from './plataforma.js';
import type { TiendaViva } from './tienda.js';

export function esRecepcionGsg(metodo: string | undefined, url: string): boolean {
  return metodo === 'POST' && url.split('?')[0] === '/api/v1/entregas';
}

/** Por que no entra una peticion de recepcion: su codigo HTTP y el cuerpo JSON. */
export interface RechazoRecepcion {
  status: 401 | 403 | 404 | 405 | 409 | 503;
  cuerpo: CuerpoError;
  /** Cabeceras extra (WWW-Authenticate en el 401, Retry-After en el 503). */
  cabeceras?: Record<string, string>;
}

const BEARER = { 'www-authenticate': 'Bearer realm="gsgchat", charset="UTF-8"' };

export const RECHAZOS = {
  metodo: (): RechazoRecepcion => ({
    status: 405,
    cabeceras: { allow: 'GET, HEAD, POST' },
    cuerpo: cuerpoError('METODO_NO_PERMITIDO', 'Ese método no está permitido en /api/v1/entregas: usa POST para recibir pedidos o GET para consultar la lista.'),
  }),
  ausente: (): RechazoRecepcion => ({
    status: 401,
    cabeceras: BEARER,
    cuerpo: cuerpoError('CLAVE_AUSENTE', 'Falta la clave de API: manda la cabecera «Authorization: Bearer <clave>».'),
  }),
  invalida: (): RechazoRecepcion => ({
    status: 401,
    cabeceras: { 'www-authenticate': 'Bearer realm="gsgchat", error="invalid_token"' },
    cuerpo: cuerpoError('CLAVE_INVALIDA', 'La clave de API no es válida: revisa que la copiaste entera.'),
  }),
  revocada: (): RechazoRecepcion => ({
    status: 401,
    cabeceras: { 'www-authenticate': 'Bearer realm="gsgchat", error="invalid_token"' },
    cuerpo: cuerpoError('CLAVE_REVOCADA', 'Esa clave de API fue revocada: pide una nueva en el módulo GSG Courier.'),
  }),
  sinPermiso: (): RechazoRecepcion => ({
    status: 403,
    cuerpo: cuerpoError('SIN_PERMISO', 'La clave es válida pero no tiene el permiso «entregas:gestionar» para crear pedidos.'),
  }),
  suspendida: (): RechazoRecepcion => ({
    status: 403,
    cuerpo: cuerpoError('TIENDA_SUSPENDIDA', 'La tienda de esta clave está suspendida: no recibe pedidos.'),
  }),
  ambigua: (): RechazoRecepcion => ({
    status: 409,
    cuerpo: cuerpoError('CLAVE_AMBIGUA', 'Esta clave está registrada en más de una tienda y no se sabe a cuál va el pedido: revócala y crea una nueva en la tienda correcta.'),
  }),
  conPrefijo: (): RechazoRecepcion => ({
    status: 404,
    cuerpo: cuerpoError('RUTA_NO_EXISTE', 'La recepción de pedidos no lleva nombre de tienda: usa POST /api/v1/entregas (la clave decide la tienda).'),
  }),
  baseCaida: (): RechazoRecepcion => ({
    status: 503,
    cabeceras: { 'retry-after': String(ESPERA_BASE_SEGUNDOS) },
    cuerpo: cuerpoError('BASE_NO_DISPONIBLE', 'La base de datos no responde ahora mismo: no se guardó nada. Vuelve a intentarlo en unos segundos.'),
  }),
};

/** El token Bearer de la cabecera, o null si no hay (ausente o vacio). */
export function tokenBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.*)$/i.exec(authorization.trim());
  if (!m) return null;
  return m[1]!.trim() || null;
}

/**
 * La tienda de la clave, o por que no entra. Las claves existentes siguen en
 * la base de su tienda. Nunca se usa cookie, Referer, slug ni una tienda
 * enviada en el cuerpo para decidir el destino.
 */
export async function tiendaDeClaveGsg(
  plataforma: Pick<Plataforma, 'directorio' | 'tiendaPorSlug' | 'consultarClaveGsg'>,
  authorization: string | undefined,
  permiso: 'entregas:gestionar' | 'entregas:leer' = 'entregas:gestionar',
): Promise<{ tienda: TiendaViva } | { rechazo: RechazoRecepcion }> {
  const clave = tokenBearer(authorization);
  if (!clave) return { rechazo: RECHAZOS.ausente() };
  if (!pareceClaveApi(clave)) return { rechazo: RECHAZOS.invalida() };
  const hash = hashClaveApi(clave);
  try {
    const vigentes: Array<{ tienda: TiendaViva | null; permisos: readonly string[]; activa: boolean }> = [];
    let revocada = false;
    for (const registrada of await plataforma.directorio.tiendas()) {
      // Una suspendida no se arranca para reconocer su clave: solo se lee
      // su base. Su clave vigente sigue siendo válida, pero responde 403.
      const tienda = await plataforma.tiendaPorSlug(registrada.slug);
      const registro = tienda
        ? (await tienda.repos.claves.porHashConRevocadas?.(hash)) ?? (await tienda.repos.claves.porHash(hash))
        : registrada.estado === 'suspendida' ? await plataforma.consultarClaveGsg?.(registrada, hash) : null;
      if (!registro) continue;
      if (registro.revocadaAt) {
        revocada = true;
        continue;
      }
      vigentes.push({ tienda, permisos: registro.permisos, activa: registrada.estado === 'activa' });
    }
    // Una clave copiada a dos tiendas es ambigua: no se entrega a ninguna.
    if (vigentes.length > 1) return { rechazo: RECHAZOS.ambigua() };
    const una = vigentes[0];
    if (!una) return { rechazo: revocada ? RECHAZOS.revocada() : RECHAZOS.invalida() };
    if (!una.activa) return { rechazo: RECHAZOS.suspendida() };
    if (!una.tienda) return { rechazo: RECHAZOS.invalida() };
    if (!tienePermiso(una.permisos, permiso)) {
      const rechazo = RECHAZOS.sinPermiso();
      rechazo.cuerpo = cuerpoError('SIN_PERMISO', `La clave es válida pero no tiene el permiso «${permiso}» para esta operación.`);
      return { rechazo };
    }
    return { tienda: una.tienda };
  } catch (error) {
    if (esBaseNoDisponible(error)) return { rechazo: RECHAZOS.baseCaida() };
    throw error;
  }
}
