/**
 * El seguimiento armado con los datos de GSGchat, sin preguntarle nada a GSG
 * («para eso es el sistema»).
 *
 * Con el tracking guardado del pedido (el que GSG mando en su primer envio)
 * se busca el pedido de hoy, su motorizado y la ruta de ese motorizado:
 * todos sus pedidos de hoy, en el orden en que se le asignaron (no hay otra
 * secuencia guardada). Lo entregado cuenta como hecho; lo cancelado no es
 * parada. De ahi salen:
 *  - `puntoCliente`: el lugar del pedido del cliente en esa ruta (1, 2, ...).
 *  - `puntoActual`: las paradas ya atendidas antes que la suya (el motorizado
 *    «está en el punto 2» si ya atendió dos).
 *  - `paradas`: las que faltan hasta la del cliente, incluida, con su pin.
 *  - `posicion`: la mas fresca que haya del motorizado: el GPS en vivo de una
 *    sesion de rastreo, la ultima que dejo al mandar un pin o entregar, o el
 *    pin de su ultima entrega. Si no hay ninguna reciente, no va: se cuentan
 *    paradas y no se calculan km (nunca se inventa una posicion).
 *
 * Sin motorizado, sin la ruta o con una parada sin pin: null, y el cliente
 * recibe el texto fijo de siempre.
 */
import type { Entrega, Motorizado } from './repo.js';
import { EDAD_MAXIMA_POSICION_MIN, type FuenteSeguimiento, type SeguimientoGsg } from './seguimiento-gsg.js';

export interface PosicionEnVivo {
  lat: number;
  lng: number;
  at: Date;
}

export interface DepsFuentePropia {
  /** Los pedidos de hoy de la tienda (todos los estados). */
  entregasDelDia(): Promise<Entrega[]>;
  motorizado(id: number): Promise<Motorizado | null>;
  motorizadoPorTelefono(phone: string): Promise<Motorizado | null>;
  /** El ultimo punto de GPS en vivo de ese telefono (sesion de rastreo), si lo hay. */
  posicionEnVivo?(phone: string): Promise<PosicionEnVivo | null>;
  ahora(): Date;
}

/** El tracking con el que se busca un pedido: el que mando GSG o, si no hay, su referencia. */
export const trackingDe = (e: Pick<Entrega, 'datosEnvio' | 'referencia'>): string => e.datosEnvio?.tracking ?? e.referencia;

/** Ya atendidas: cuentan como paradas hechas. */
const HECHAS = new Set<Entrega['estado']>(['entregada', 'terminada']);
/** No son parada de la ruta. */
const FUERA = new Set<Entrega['estado']>(['cancelada']);

/** Los ultimos 9 digitos: el mismo numero con o sin codigo de pais. */
const nueveDigitos = (t: string | null | undefined): string | null => {
  const d = String(t ?? '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
};

/** De que ruta es un pedido: la del motorizado asignado aqui o, si no, la del que mando GSG. */
function claveRuta(e: Entrega): string | null {
  if (e.motorizadoId != null) return `id:${e.motorizadoId}`;
  const tel = nueveDigitos(e.datosEnvio?.telefonoMotorizado);
  return tel ? `tel:${tel}` : null;
}

/** El orden de la ruta: cuando se le asigno al motorizado (o, si no consta, cuando llego el pedido). */
function momentoDeAsignacion(e: Entrega): number {
  return (e.motorizadoEnviadoAt ?? e.createdAt).getTime();
}

type Posicion = NonNullable<SeguimientoGsg['posicion']>;

/** La posicion mas fresca que siga vigente para su fuente; null si no hay ninguna. */
function posicionMasFresca(candidatas: Array<{ lat: number; lng: number; at: Date; fuente: NonNullable<Posicion['fuente']> }>, ahora: Date): Posicion | null {
  const vigentes = candidatas.filter((c) => {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng) || !Number.isFinite(c.at.getTime())) return false;
    const edad = ahora.getTime() - c.at.getTime();
    return edad >= -60_000 && edad <= EDAD_MAXIMA_POSICION_MIN[c.fuente] * 60_000;
  });
  // Mas reciente primero; a igual hora, el orden de la lista (GPS, reporte, ultima entrega).
  const mejor = vigentes.map((c, i) => ({ c, i })).sort((a, b) => b.c.at.getTime() - a.c.at.getTime() || a.i - b.i)[0]?.c;
  return mejor ? { lat: mejor.lat, lng: mejor.lng, actualizadaAt: mejor.at.toISOString(), fuente: mejor.fuente } : null;
}

export function crearFuentePropia(deps: DepsFuentePropia): FuenteSeguimiento {
  return async (tracking: string) => {
    const delDia = await deps.entregasDelDia();
    const e = delDia.find((x) => trackingDe(x) === tracking && !HECHAS.has(x.estado) && !FUERA.has(x.estado));
    if (!e) return null;
    const clave = claveRuta(e);
    if (!clave) return null;

    const ruta = delDia
      .filter((x) => !FUERA.has(x.estado) && claveRuta(x) === clave)
      .sort((a, b) => momentoDeAsignacion(a) - momentoDeAsignacion(b) || a.id - b.id);
    const indice = ruta.findIndex((x) => x.id === e.id);
    if (indice < 0) return null;
    const pendientesAntes = ruta.slice(0, indice).filter((x) => !HECHAS.has(x.estado));
    const puntoActual = indice - pendientesAntes.length;
    const tramo = [...pendientesAntes, e];
    // Sin el pin de alguna parada no hay ruta que calcular ni que contar con honestidad.
    if (tramo.some((x) => x.lat == null || x.lng == null)) return null;

    const telefonoGsg = nueveDigitos(e.datosEnvio?.telefonoMotorizado);
    const m = e.motorizadoId != null
      ? await deps.motorizado(e.motorizadoId)
      : telefonoGsg
        ? (await deps.motorizadoPorTelefono(`51${telefonoGsg}`)) ?? (await deps.motorizadoPorTelefono(telefonoGsg))
        : null;
    const ahora = deps.ahora();
    const candidatas: Parameters<typeof posicionMasFresca>[0] = [];
    const telefonoVivo = m?.phone ?? (telefonoGsg ? `51${telefonoGsg}` : null);
    if (telefonoVivo && deps.posicionEnVivo) {
      const vivo = await deps.posicionEnVivo(telefonoVivo).catch(() => null);
      if (vivo) candidatas.push({ ...vivo, fuente: 'gps' });
    }
    if (m && m.ultimaLat != null && m.ultimaLng != null && m.ultimaPosicionAt) candidatas.push({ lat: m.ultimaLat, lng: m.ultimaLng, at: m.ultimaPosicionAt, fuente: 'reporte' });
    const ultimaEntrega = ruta
      .filter((x) => HECHAS.has(x.estado) && x.entregadaAt && x.lat != null && x.lng != null)
      .sort((a, b) => b.entregadaAt!.getTime() - a.entregadaAt!.getTime())[0];
    if (ultimaEntrega) candidatas.push({ lat: ultimaEntrega.lat!, lng: ultimaEntrega.lng!, at: ultimaEntrega.entregadaAt!, fuente: 'ultima_entrega' });
    const posicion = posicionMasFresca(candidatas, ahora);

    const seguimiento: SeguimientoGsg = {
      tracking,
      origen: 'propio',
      estado: 'en_reparto',
      secuenciaCompleta: true,
      versionRuta: `propio:${clave}:${ruta.length}:${puntoActual}`,
      puntoActual,
      puntoCliente: indice + 1,
      paradas: tramo.map((x, k) => ({ lat: x.lat!, lng: x.lng!, orden: puntoActual + 1 + k })),
      ...(posicion ? { posicion } : {}),
    };
    return seguimiento;
  };
}
