/**
 * Los numeros ficticios con los que se prueba el flujo entero: diez clientes
 * y diez motorizados. Son inventados a proposito (prefijo 987 000 0xx y
 * 999 000 0xx) y viven en Lima, como todo lo demas.
 *
 * Los usa el simulador de GSG ("Cargar 10 clientes de prueba"), el boton
 * "Cargar 10 motorizados de prueba" y las pruebas automaticas.
 */

export interface ClienteDePrueba {
  referencia: string;
  telefono: string;
  nombre: string;
  direccion: string;
  distrito: string;
  notas?: string;
  /** Un punto real de Lima, por si GSG ya lo tenia. */
  lat: number;
  lng: number;
  /** Que le falta segun GSG. */
  faltaUbicacion: boolean;
  faltaConfirmacion: boolean;
  /** GSG lo marca urgente: sale primero hacia el motorizado. */
  urgente?: boolean;
  /** Lo que GSG cuenta del envio (sale en el primer mensaje): producto, empresa, codigo, pedido, pago, monto y quien firma. */
  producto?: string;
  empresa?: { codigo: string; nombre: string };
  tracking?: string;
  nroPedido?: string;
  metodoPago?: string;
  monto?: string;
  remitente?: string;
}

// Los datos del envio son como los de GSG de verdad; a dos les falta el
// monto o el remitente a proposito: esa linea simplemente no sale.
export const CLIENTES_DE_PRUEBA: ClienteDePrueba[] = [
  { referencia: 'P-1001', telefono: '987000001', nombre: 'Ana Quispe', direccion: 'Av. Larco 345', distrito: 'Miraflores', lat: -12.1211, lng: -77.0301, faltaUbicacion: true, faltaConfirmacion: true, producto: 'Zapatillas talla 40', empresa: { codigo: '516', nombre: 'Zapatería Lima' }, tracking: 'GSG-A-102345', nroPedido: '#1042', metodoPago: 'YAPE', monto: '85.00', remitente: 'Juan Quispe' },
  { referencia: 'P-1002', telefono: '987000002', nombre: 'Luis Huamán', direccion: 'Jr. Monterrey 120', distrito: 'Surco', lat: -12.1087, lng: -76.9975, faltaUbicacion: true, faltaConfirmacion: true, producto: 'Polo de algodón talla M (2 unid.)', empresa: { codigo: '231', nombre: 'Moda Gamarra' }, tracking: 'GSG-A-102346', nroPedido: '#8817', metodoPago: 'Efectivo', monto: '59.90', remitente: 'Juan Quispe' },
  { referencia: 'P-1003', telefono: '987000003', nombre: 'María Torres', direccion: 'Av. Aviación 2800', distrito: 'San Borja', lat: -12.0983, lng: -77.0012, faltaUbicacion: true, faltaConfirmacion: true, urgente: true, producto: 'Audífonos inalámbricos', empresa: { codigo: '408', nombre: 'TecnoPerú' }, tracking: 'GSG-A-102347', nroPedido: '#3301', metodoPago: 'PLIN', monto: '129.00', remitente: 'Rocío Salas' },
  { referencia: 'P-1004', telefono: '987000004', nombre: 'Jorge Ramos', direccion: 'Av. Arequipa 1500', distrito: 'Lince', lat: -12.0839, lng: -77.0364, faltaUbicacion: true, faltaConfirmacion: true, notas: 'Tocar el timbre 2 veces', producto: 'Juego de sábanas 2 plazas', empresa: { codigo: '112', nombre: 'Casa Bonita' }, tracking: 'GSG-A-102348', nroPedido: '#5520', metodoPago: 'Pagado', remitente: 'Rocío Salas' },
  { referencia: 'P-1005', telefono: '987000005', nombre: 'Carla Flores', direccion: 'Jr. Huaraz 900', distrito: 'Breña', lat: -12.0592, lng: -77.0521, faltaUbicacion: true, faltaConfirmacion: true, producto: 'Mochila escolar', empresa: { codigo: '516', nombre: 'Zapatería Lima' }, tracking: 'GSG-A-102349', nroPedido: '#1043', metodoPago: 'YAPE', monto: '75.50' },
  // Dos de los diez vienen marcados como urgentes por GSG: salen primero hacia el motorizado.
  { referencia: 'P-1006', telefono: '987000006', nombre: 'Pedro Castillo', direccion: 'Av. Salaverry 2100', distrito: 'Jesús María', lat: -12.0781, lng: -77.0486, faltaUbicacion: true, faltaConfirmacion: true, urgente: true, producto: 'Perfume 100 ml', empresa: { codigo: '307', nombre: 'Aromas del Sur' }, tracking: 'GSG-A-102350', nroPedido: '#2290', metodoPago: 'Efectivo', monto: '149.00', remitente: 'Juan Quispe' },
  // Estos tres ya dieron su ubicacion en un pedido anterior: GSG la tiene y solo falta que confirmen.
  { referencia: 'P-1007', telefono: '987000007', nombre: 'Rosa Chávez', direccion: 'Calle Los Pinos 210', distrito: 'San Isidro', lat: -12.0977, lng: -77.0365, faltaUbicacion: false, faltaConfirmacion: true, producto: 'Licuadora 1.5 L', empresa: { codigo: '408', nombre: 'TecnoPerú' }, tracking: 'GSG-A-102351', nroPedido: '#3302', metodoPago: 'Pagado', remitente: 'Juan Quispe' },
  { referencia: 'P-1008', telefono: '987000008', nombre: 'Miguel Vargas', direccion: 'Av. Bolívar 780', distrito: 'Pueblo Libre', lat: -12.0754, lng: -77.0629, faltaUbicacion: false, faltaConfirmacion: true, producto: 'Casaca impermeable talla L', empresa: { codigo: '231', nombre: 'Moda Gamarra' }, tracking: 'GSG-A-102352', nroPedido: '#8818', metodoPago: 'YAPE', monto: '99.00', remitente: 'Rocío Salas' },
  { referencia: 'P-1009', telefono: '987000009', nombre: 'Lucía Mendoza', direccion: 'Av. Benavides 1900', distrito: 'Miraflores', lat: -12.1269, lng: -77.0163, faltaUbicacion: false, faltaConfirmacion: true, notas: 'Dejar en recepción', producto: 'Set de maquillaje', empresa: { codigo: '307', nombre: 'Aromas del Sur' }, tracking: 'GSG-A-102353', nroPedido: '#2291', metodoPago: 'PLIN', monto: '65.00' },
  // Este ya confirmo por telefono: solo falta su ubicacion.
  { referencia: 'P-1010', telefono: '987000010', nombre: 'Diego Paredes', direccion: 'Jr. Cusco 450', distrito: 'Cercado de Lima', lat: -12.0464, lng: -77.0308, faltaUbicacion: true, faltaConfirmacion: false, producto: 'Libro «Cien años de soledad»', empresa: { codigo: '145', nombre: 'Librería El Inca' }, tracking: 'GSG-A-102354', nroPedido: '#0719', metodoPago: 'Efectivo', monto: '42.00', remitente: 'Juan Quispe' },
];

export interface MotorizadoDePrueba {
  telefono: string;
  nombre: string;
  placa: string;
  zona: string;
}

export const MOTORIZADOS_DE_PRUEBA: MotorizadoDePrueba[] = [
  { telefono: '999000001', nombre: 'Carlos Rojas', placa: 'M1A-101', zona: 'Miraflores, San Isidro, Barranco' },
  { telefono: '999000002', nombre: 'Julio Espinoza', placa: 'M2B-202', zona: 'Surco, San Borja, La Molina' },
  { telefono: '999000003', nombre: 'Renzo Salazar', placa: 'M3C-303', zona: 'Lince, Jesús María, Pueblo Libre' },
  { telefono: '999000004', nombre: 'Kevin Aguilar', placa: 'M4D-404', zona: 'Breña, Cercado de Lima, Rímac' },
  { telefono: '999000005', nombre: 'Álvaro Díaz', placa: 'M5E-505', zona: 'San Miguel, Magdalena, Pueblo Libre' },
  { telefono: '999000006', nombre: 'Bruno Cárdenas', placa: 'M6F-606', zona: 'Miraflores, Surco' },
  { telefono: '999000007', nombre: 'Fabián Gutiérrez', placa: 'M7G-707', zona: 'Los Olivos, Independencia, SMP' },
  { telefono: '999000008', nombre: 'Héctor Navarro', placa: 'M8H-808', zona: 'Callao, La Perla, Bellavista' },
  { telefono: '999000009', nombre: 'Iván Ponce', placa: 'M9I-909', zona: 'Ate, Santa Anita, El Agustino' },
  { telefono: '999000010', nombre: 'Jonathan Ríos', placa: 'M0J-010', zona: 'Chorrillos, Villa El Salvador, SJM' },
];
