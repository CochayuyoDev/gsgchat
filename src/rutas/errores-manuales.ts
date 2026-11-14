/**
 * Los motivos de la incidencia manual: son los que maneja GSG (su desplegable
 * «Selecciona el motivo») y no se editan desde aquí. Al reportar, GSG recibe
 * el título tal cual como `codigo` y el resumen como `comentario`. Se ofrecen
 * en orden alfabético y nada más.
 */
const CATALOGO = [
  { codigo: 'manual-numero-sin-whatsapp', titulo: 'Número sin WhatsApp' },
  { codigo: 'manual-no-contesta', titulo: 'No contesta WSP ni llamadas' },
  { codigo: 'manual-llego-al-punto', titulo: 'Llegué al punto' },
  { codigo: 'manual-enviara-ubicacion-despues', titulo: 'Enviará ubicación después' },
  { codigo: 'manual-numeros-incorrectos', titulo: 'Números incorrectos' },
  { codigo: 'manual-no-conoce-pedido', titulo: 'No conoce el pedido' },
  { codigo: 'manual-otro', titulo: 'Otro' },
  { codigo: 'manual-asignar-otro-motorizado', titulo: 'Asignar a otro motorizado' },
  { codigo: 'manual-cliente-otro-distrito', titulo: 'Cliente en otro distrito' },
  { codigo: 'manual-zona-mayor-tarifa', titulo: 'Zona de mayor tarifa' },
] as const;

export const ERRORES_MANUALES_GSG = [...CATALOGO].sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
