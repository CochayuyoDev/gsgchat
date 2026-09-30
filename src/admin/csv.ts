/**
 * CSV para Excel en español: separador ";", BOM para que abra con tildes y
 * comillas dobladas donde hace falta. Lo usan las exportaciones del reparto,
 * del historial y de los contactos.
 */

export type Columnas<T> = Array<[nombre: string, leer: (fila: T) => unknown]>;

export function celdaCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const texto = valor instanceof Date ? valor.toISOString() : String(valor);
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function aCsvCon<T>(columnas: Columnas<T>, filas: T[]): string {
  const cabecera = columnas.map(([nombre]) => nombre).join(';');
  const cuerpo = filas.map((f) => columnas.map(([, leer]) => celdaCsv(leer(f))).join(';'));
  return `\ufeff${[cabecera, ...cuerpo].join('\r\n')}\r\n`;
}
