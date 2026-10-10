/**
 * La ruta de cada peticion, en su forma canonica.
 *
 * Los ganchos de autorizacion miran `request.url` con `startsWith('/admin')`
 * o `startsWith('/api/')`, pero el enrutador de Fastify decodifica los
 * escapes antes de buscar la ruta: `/%61dmin/usuarios` llegaba a la ruta
 * `/admin/usuarios` sin pasar por el gancho, que veia `/%61dmin`. Era entrar
 * al panel sin sesion.
 *
 * Se decodifican solo los caracteres "no reservados" (letras, digitos y
 * `-._~`): segun el RFC 3986 escribirlos con escape o sin el es la misma URL,
 * asi que no cambia nada para nadie y el gancho y el enrutador ven lo mismo.
 * Lo reservado (`%2F`, `%3F`, `%25`...) se queda como viene: decodificarlo si
 * cambiaria el significado.
 */

const NO_RESERVADO = /^[A-Za-z0-9\-._~]$/;

export function normalizarRuta(url: string): string {
  const corte = url.indexOf('?');
  const ruta = corte === -1 ? url : url.slice(0, corte);
  if (!ruta.includes('%')) return url;
  const limpia = ruta.replace(/%([0-9A-Fa-f]{2})/g, (escape, hex: string) => {
    const c = String.fromCharCode(Number.parseInt(hex, 16));
    return NO_RESERVADO.test(c) ? c : escape;
  });
  return corte === -1 ? limpia : limpia + url.slice(corte);
}
