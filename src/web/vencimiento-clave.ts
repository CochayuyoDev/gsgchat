/** Fecha local escrita por el administrador; null significa sin vencimiento. */
export function calcularVencimientoClave(opcion: string, texto: string, ahora = new Date()): string | null {
  if (opcion === 'nunca') return null;
  let fecha: Date;
  if (opcion === 'fecha') {
    const partes = texto.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
    if (!partes) throw new Error('Escribe la fecha como DD/MM/AAAA, con hora opcional HH:mm.');
    const dia = Number(partes[1]), mes = Number(partes[2]), anio = Number(partes[3]);
    const hora = partes[4] === undefined ? 23 : Number(partes[4]);
    const minuto = partes[5] === undefined ? 59 : Number(partes[5]);
    fecha = new Date(anio, mes - 1, dia, hora, minuto);
    if (anio < 2000 || mes < 1 || mes > 12 || hora > 23 || minuto > 59 || fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia || fecha.getHours() !== hora || fecha.getMinutes() !== minuto) throw new Error('La fecha o la hora no es válida.');
  } else {
    if (!['7', '30', '90', '365'].includes(opcion)) throw new Error('Selecciona un vencimiento válido.');
    fecha = new Date(ahora);
    fecha.setDate(fecha.getDate() + Number(opcion));
  }
  if (fecha.getTime() <= ahora.getTime()) throw new Error('El vencimiento debe estar en el futuro.');
  return fecha.toISOString();
}
