/**
 * Los datos del envio que GSG manda con cada pedido (producto, empresa,
 * codigo de seguimiento, numero de pedido, metodo de pago, monto y quien
 * firma), leidos de cualquiera de las formas que acepta el contrato:
 *
 *   producto, tracking, nroPedido, metodoPago, monto, remitente
 *   motorizado: { nombre, telefono } (o telefonoMotorizado suelto): el
 *               motorizado que GSG ya asigno; su numero es el que se le da
 *               al cliente en el cierre y en UBI REGISTRADA
 *   empresa: { codigo, nombre }   (o empresaCodigo / empresaNombre,
 *                                  o tiendaCodigo / tiendaNombre,
 *                                  o empresa: "516 - Zapatería Lima")
 *
 * El monto puede venir como numero (85 → "85.00") o como texto. Lo que no
 * viene no se inventa: el primer mensaje al cliente simplemente no lleva esa
 * linea. Ver /api/v1/openapi.json.
 */

import { datosEnvioLimpios, type DatosEnvio } from './repo.js';

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return null;
  const t = String(v).trim();
  return t ? t : null;
};

/** 85 → "85.00"; "85" → "85.00"; "S/ 85,5" se deja tal cual. */
export function montoEnTexto(v: unknown): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2) : null;
  const t = texto(v);
  if (!t) return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t).toFixed(2) : t;
}

/** Saca los datos del envio de un pedido crudo (API o lista de GSG). null si no trae ninguno. */
export function datosEnvioDeCrudo(crudo: unknown): DatosEnvio | null {
  if (!crudo || typeof crudo !== 'object') return null;
  const c = crudo as Record<string, unknown>;
  let empresaCodigo = texto(c.empresaCodigo) ?? texto(c.tiendaCodigo);
  let empresaNombre = texto(c.empresaNombre) ?? texto(c.tiendaNombre);
  const empresa = c.empresa ?? c.tienda;
  if (empresa && typeof empresa === 'object') {
    const e = empresa as Record<string, unknown>;
    empresaCodigo ??= texto(e.codigo) ?? texto(e.id);
    empresaNombre ??= texto(e.nombre);
  } else if (texto(empresa)) {
    empresaNombre ??= texto(empresa);
  }
  // El motorizado que GSG ya asigno: {nombre, telefono}, o el nombre suelto,
  // o telefonoMotorizado / motorizadoTelefono sueltos.
  let motorizadoNombre: string | null = null;
  let telefonoMotorizado = texto(c.telefonoMotorizado) ?? texto(c.motorizadoTelefono);
  const moto = c.motorizado;
  if (moto && typeof moto === 'object') {
    const m = moto as Record<string, unknown>;
    motorizadoNombre = texto(m.nombre);
    telefonoMotorizado ??= texto(m.telefono) ?? texto(m.phone);
  } else motorizadoNombre = texto(moto) ?? texto(c.motorizadoNombre);
  if (telefonoMotorizado && telefonoMotorizado.replace(/\D/g, '').length < 6) telefonoMotorizado = null;
  return datosEnvioLimpios({
    costServ: montoEnTexto(c.costServ),
    referenciaDireccion: texto(c.referenciaDireccion),
    fecRegistro: texto(c.fecRegistro),
    fecRuta: texto(c.fecRuta),
    observacionCliente: texto(c.observacionCliente),
    detalleProducto: texto(c.detalleProducto),
    telefono2: texto(c.telefono2),
    tamano: texto(c.tamano),
    cantBultos: texto(c.cantBultos),
    clientePagaDelivery: texto(c.clientePagaDelivery),
    sede: texto(c.sede),
    tipoRuta: texto(c.tipoRuta),
    nroDocumento: texto(c.nroDocumento),
    agenciaNombre: texto(c.agenciaNombre),
    agenciaDestino: texto(c.agenciaDestino),
    pagoEnDestino: texto(c.pagoEnDestino),
    motorizadoNombre,
    telefonoMotorizado,
    producto: texto(c.producto),
    empresaCodigo,
    empresaNombre,
    tracking: texto(c.tracking) ?? texto(c.codigoSeguimiento),
    nroPedido: texto(c.nroPedido) ?? texto(c.numeroPedido),
    metodoPago: texto(c.metodoPago),
    monto: montoEnTexto(c.monto),
    remitente: texto(c.remitente),
  });
}

/** "516 - Zapatería Lima", "516" o "Zapatería Lima", segun lo que haya. */
export function empresaEnTexto(d: DatosEnvio | null | undefined): string {
  if (!d) return '';
  const partes = [d.empresaCodigo, d.empresaNombre].map((p) => (p ?? '').trim()).filter(Boolean);
  // Si el nombre ya empieza por el codigo ("516 - Zapatería Lima"), no se repite.
  if (partes.length === 2 && partes[1]!.startsWith(partes[0]!)) return partes[1]!;
  return partes.join(' - ');
}

/**
 * Junta lo que ya habia con lo nuevo: un campo que llega manda; uno que no
 * llega no borra lo que habia. Devuelve null si no cambia nada.
 */
export function fusionarDatosEnvio(antes: DatosEnvio | null | undefined, nuevos: DatosEnvio | null | undefined): DatosEnvio | null {
  if (!nuevos) return null;
  const junto = datosEnvioLimpios({ ...(antes ?? {}), ...nuevos });
  if (!junto) return null;
  const a = JSON.stringify(datosEnvioLimpios(antes ?? null) ?? {});
  return JSON.stringify(junto) === a ? null : junto;
}
