import { hashClaveApi, pareceClaveApi } from '../auth/claves-api.js';
import { tienePermiso } from '../auth/permisos.js';
import type { Plataforma } from './plataforma.js';
import type { TiendaViva } from './tienda.js';

export function esRecepcionGsg(metodo: string | undefined, url: string): boolean {
  return metodo === 'POST' && url.split('?')[0] === '/api/v1/entregas';
}

/** Las claves existentes siguen en la base de su tienda. Nunca se usa cookie,
 * Referer, slug ni una tienda enviada en el cuerpo para decidir el destino. */
export async function tiendaDeClaveGsg(plataforma: Pick<Plataforma, 'directorio' | 'tiendaPorSlug'>, authorization: string | undefined): Promise<TiendaViva | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  const clave = authorization.slice(7).trim();
  if (!pareceClaveApi(clave)) return null;
  const hash = hashClaveApi(clave);
  let destino: TiendaViva | null = null;
  for (const registrada of await plataforma.directorio.tiendas()) {
    if (registrada.estado !== 'activa') continue;
    const tienda = await plataforma.tiendaPorSlug(registrada.slug);
    if (!tienda) continue;
    const registro = await tienda.repos.claves.porHash(hash);
    if (!registro || registro.revocadaAt) continue;
    // Una clave copiada a dos tiendas es ambigua: no se entrega a ninguna.
    if (destino || !tienePermiso(registro.permisos, 'entregas:gestionar')) return null;
    destino = tienda;
  }
  return destino;
}
