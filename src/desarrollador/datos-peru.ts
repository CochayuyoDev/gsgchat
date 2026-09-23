/**
 * Datos creibles de Lima para los clientes de prueba del Modulo desarrollador:
 * nombres peruanos, calles y distritos con su centro real, y un monto en
 * soles. Nada de esto es de nadie: se combina al azar.
 */

const NOMBRES = ['Ana', 'Luis', 'María', 'Jorge', 'Carla', 'Pedro', 'Rosa', 'Miguel', 'Lucía', 'Diego', 'Sofía', 'Carlos', 'Valeria', 'José', 'Camila', 'Renzo', 'Milagros', 'Fabián', 'Karina', 'Óscar', 'Gabriela', 'Víctor', 'Patricia', 'Hugo', 'Daniela', 'César', 'Fiorella', 'Raúl', 'Andrea', 'Julio'];
const APELLIDOS = ['Quispe', 'Huamán', 'Flores', 'Mamani', 'Torres', 'Ramos', 'Castillo', 'Chávez', 'Vargas', 'Mendoza', 'Paredes', 'Rojas', 'Gutiérrez', 'Sánchez', 'Díaz', 'Cárdenas', 'Salazar', 'Condori', 'Espinoza', 'Ccori', 'Arana', 'Villanueva', 'Palacios', 'Zegarra', 'Loayza', 'Tello', 'Aguilar', 'Benites'];

/** Distrito, su centro aproximado y calles de verdad del distrito. */
export const DISTRITOS: Array<{ nombre: string; lat: number; lng: number; calles: string[] }> = [
  { nombre: 'Miraflores', lat: -12.1211, lng: -77.0297, calles: ['Av. Larco', 'Av. José Pardo', 'Calle Berlín', 'Av. Benavides'] },
  { nombre: 'Santiago de Surco', lat: -12.1391, lng: -76.9936, calles: ['Av. Caminos del Inca', 'Jr. Monterrey', 'Av. Primavera', 'Av. El Polo'] },
  { nombre: 'San Borja', lat: -12.1017, lng: -76.9987, calles: ['Av. Aviación', 'Av. San Luis', 'Calle Las Artes', 'Av. San Borja Norte'] },
  { nombre: 'Lince', lat: -12.0839, lng: -77.0364, calles: ['Av. Arequipa', 'Jr. Risso', 'Av. César Vallejo', 'Jr. Manuel Candamo'] },
  { nombre: 'Breña', lat: -12.0592, lng: -77.0521, calles: ['Jr. Huaraz', 'Av. Arica', 'Jr. Chamaya', 'Av. Tingo María'] },
  { nombre: 'Jesús María', lat: -12.0781, lng: -77.0486, calles: ['Av. Salaverry', 'Av. Brasil', 'Jr. Nazca', 'Av. Cuba'] },
  { nombre: 'San Isidro', lat: -12.0977, lng: -77.0365, calles: ['Av. Javier Prado Oeste', 'Calle Los Pinos', 'Av. Camino Real', 'Av. Dos de Mayo'] },
  { nombre: 'Pueblo Libre', lat: -12.0754, lng: -77.0629, calles: ['Av. Bolívar', 'Av. La Mar', 'Jr. Ayacucho', 'Av. Sucre'] },
  { nombre: 'Cercado de Lima', lat: -12.0464, lng: -77.0308, calles: ['Jr. Cusco', 'Jr. de la Unión', 'Av. Abancay', 'Jr. Lampa'] },
  { nombre: 'La Molina', lat: -12.0864, lng: -76.9360, calles: ['Av. La Molina', 'Av. Raúl Ferrero', 'Av. Los Fresnos', 'Calle Las Lomas'] },
  { nombre: 'San Miguel', lat: -12.0776, lng: -77.0907, calles: ['Av. La Marina', 'Av. Universitaria', 'Jr. Cusco', 'Av. Elmer Faucett'] },
  { nombre: 'Magdalena del Mar', lat: -12.0907, lng: -77.0712, calles: ['Av. Brasil', 'Jr. Castilla', 'Av. Javier Prado Oeste'] },
  { nombre: 'Barranco', lat: -12.1492, lng: -77.0212, calles: ['Av. Grau', 'Jr. Unión', 'Av. San Martín'] },
  { nombre: 'Chorrillos', lat: -12.1686, lng: -77.0150, calles: ['Av. Huaylas', 'Av. Defensores del Morro', 'Jr. Olaya'] },
  { nombre: 'San Juan de Lurigancho', lat: -12.0293, lng: -77.0100, calles: ['Av. Próceres de la Independencia', 'Av. Canto Grande', 'Jr. Las Flores'] },
  { nombre: 'Los Olivos', lat: -11.9921, lng: -77.0706, calles: ['Av. Carlos Izaguirre', 'Av. Antúnez de Mayolo', 'Av. Universitaria'] },
  { nombre: 'Ate', lat: -12.0258, lng: -76.9187, calles: ['Av. Nicolás Ayllón', 'Av. La Molina', 'Calle Los Tulipanes'] },
  { nombre: 'Surquillo', lat: -12.1126, lng: -77.0192, calles: ['Av. Angamos Este', 'Av. Paseo de la República', 'Jr. Dante'] },
];

const PRODUCTOS = ['zapatillas', 'polo y jean', 'mochila', 'licuadora', 'audífonos', 'set de ollas', 'casaca', 'perfume', 'cartera', 'lámpara', 'botines', 'vestido'];
const NOTAS = ['', '', '', 'Tocar el timbre 2 veces', 'Dejar en recepción', 'Llamar al llegar', 'Portón verde', 'Casa de dos pisos, rejas negras'];

const al = <T>(lista: readonly T[], azar: () => number): T => lista[Math.floor(azar() * lista.length)]!;

export interface ClienteInventado {
  nombre: string;
  direccion: string;
  distrito: string;
  lat: number;
  lng: number;
  /** "Cobrar S/ 89.90 · zapatillas" (el contrato no tiene campo de monto: va en las notas). */
  notas: string;
  monto: number;
}

/** Un cliente de Lima inventado. `azar` inyectable para pruebas repetibles. */
export function clienteInventado(azar: () => number = Math.random): ClienteInventado {
  const d = al(DISTRITOS, azar);
  const nombre = `${al(NOMBRES, azar)} ${al(APELLIDOS, azar)} ${al(APELLIDOS, azar)}`;
  const numero = 100 + Math.floor(azar() * 3800);
  // Dentro del distrito: unos cientos de metros alrededor de su centro.
  const lat = Number((d.lat + (azar() - 0.5) * 0.012).toFixed(6));
  const lng = Number((d.lng + (azar() - 0.5) * 0.012).toFixed(6));
  const monto = Math.round((29 + azar() * 460) * 10) / 10;
  const extra = al(NOTAS, azar);
  const notas = `Cobrar S/ ${monto.toFixed(2)} · ${al(PRODUCTOS, azar)}${extra ? ` · ${extra}` : ''}`;
  return { nombre, direccion: `${al(d.calles, azar)} ${numero}`, distrito: d.nombre, lat, lng, notas, monto };
}

const PLACAS_LETRAS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

/** Un motorizado inventado: nombre, placa de moto peruana (p. ej. 1234-AB) y zona. */
export function motorizadoInventado(azar: () => number = Math.random): { nombre: string; placa: string; zona: string } {
  const placa = `${1000 + Math.floor(azar() * 9000)}-${al(PLACAS_LETRAS.split(''), azar)}${al(PLACAS_LETRAS.split(''), azar)}`;
  return { nombre: `${al(NOMBRES, azar)} ${al(APELLIDOS, azar)}`, placa, zona: al(DISTRITOS, azar).nombre };
}
