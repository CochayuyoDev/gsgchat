/**
 * Lo que solo se ve dentro de GSGchat y no sale: ni al cliente, ni a GSG por el
 * historial, la API o los webhooks (`datos`). Hoy es la nota de quien mando cada
 * mensaje desde aqui (su rol): GSG ya tiene su propia distincion.
 */
const CAMPOS_INTERNOS = ['autorRol'] as const;

export function payloadExterno<T extends Record<string, unknown> | null | undefined>(payload: T): T {
  if (!payload || typeof payload !== 'object') return payload;
  if (!CAMPOS_INTERNOS.some((k) => k in payload)) return payload;
  const copia: Record<string, unknown> = { ...payload };
  for (const k of CAMPOS_INTERNOS) delete copia[k];
  return copia as T;
}
