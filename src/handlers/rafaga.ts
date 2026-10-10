/**
 * Una ráfaga de mensajes se contesta UNA vez.
 *
 * Un caso real, sacado de una conversación de verdad:
 *
 *   14:39:36  cliente   Huevon se ríe de huevon
 *   14:39:42  cliente   XD
 *   14:39:42  bot       ¿De qué distrito recogemos el envío?
 *   14:39:48  bot       No reconocí ese mensaje, por favor inténtalo de nuevo.
 *
 * Cada entrante llevaba su respuesta, así que la regla de "un mensaje dentro,
 * como mucho uno fuera" se cumplía… y aun así al cliente le llegaron dos
 * seguidos sin haber escrito nada en medio. Es lo que pasa cuando alguien
 * escribe como se escribe por WhatsApp: en trozos.
 *
 * La solución es la que usaría una persona: esperar un momento a ver si
 * termina de escribir, y contestar a lo último. El mensaje anterior no se
 * pierde —queda guardado en el hilo y el operador lo lee entero—; lo único
 * que se descarta es la RESPUESTA a un mensaje que ya quedó viejo.
 */

const ultimo = new Map<string, number>();
let contador = 0;

const dormir = (ms: number) => new Promise((listo) => setTimeout(listo, ms));

/**
 * Espera a que el cliente termine de escribir.
 *
 * Devuelve `false` si mientras tanto llegó otro mensaje suyo: ese otro es el
 * que contesta, y este turno se queda callado.
 *
 * Con `ms` en 0 no espera ni acumula nada, que es lo que quieren las pruebas
 * y cualquier sitio donde la ráfaga no importe.
 */
export async function esperarRafaga(contactId: string, ms: number): Promise<boolean> {
  if (!ms || ms <= 0) return true;

  const sello = ++contador;
  ultimo.set(contactId, sello);

  await dormir(ms);

  // Otro mensaje suyo entró mientras esperábamos: manda el nuevo.
  if (ultimo.get(contactId) !== sello) return false;

  ultimo.delete(contactId);
  return true;
}

/** Solo para las pruebas: olvida lo que estaba esperando. */
export function olvidarRafagas(): void {
  ultimo.clear();
}
