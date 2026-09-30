/**
 * Blindaje de las peticiones que salen a resolver acortadores.
 *
 * Resolver `maps.app.goo.gl` obliga a hacer una peticion HTTP con una URL
 * que llego desde fuera. Sin control eso es un SSRF de manual: alguien manda
 * un link que redirige a 169.254.169.254 y el servidor consulta la metadata
 * del cloud por nosotros. Por eso: allowlist de hosts de entrada, https en
 * cada salto y verificacion de que la IP destino es publica.
 */

import { lookup } from 'node:dns/promises';
import net from 'node:net';

/** Hosts que aceptamos como punto de partida de una resolucion. */
const ALLOWED_HOST_PATTERNS: RegExp[] = [
  /^maps\.app\.goo\.gl$/i,
  /^goo\.gl$/i,
  /^g\.co$/i,
  /^(?:www\.)?google\.[a-z.]{2,6}$/i,
  /^maps\.google\.[a-z.]{2,6}$/i,
  /^(?:www\.)?waze\.com$/i,
  /^ul\.waze\.com$/i,
  /^maps\.apple\.com$/i,
  /^(?:www\.)?openstreetmap\.org$/i,
  /^osm\.org$/i,
  /^plus\.codes$/i,
];

export function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOST_PATTERNS.some((re) => re.test(hostname));
}

/** Hosts cuya URL no dice nada por si sola: hay que seguir el redirect. */
const SHORT_HOST_PATTERNS: RegExp[] = [/^maps\.app\.goo\.gl$/i, /^goo\.gl$/i, /^g\.co$/i];

export function isShortLinkHost(hostname: string): boolean {
  return SHORT_HOST_PATTERNS.some((re) => re.test(hostname));
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  const [a, b] = [parts[0]!, parts[1]!];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // metadata de cloud
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast y reservado
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique local
  if (v.startsWith('fe80')) return true; // link local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // si no sabemos que es, no salimos
}

/** Rechaza el destino si cualquiera de sus IPs es interna. */
export async function assertPublicHost(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error(`host interno bloqueado: ${hostname}`);
    return;
  }
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0) throw new Error(`host sin resolucion: ${hostname}`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`host interno bloqueado: ${hostname} -> ${address}`);
    }
  }
}
