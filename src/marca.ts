/**
 * Como se llama el sistema.
 *
 * Por dentro nacio como "wa-locator" y ese nombre sigue en lo que otros
 * sistemas ya tienen apuntado (la ruta de los webhooks de Stoky,
 * `/webhooks/wa-locator/`, y el nombre de la imagen Docker): eso no se
 * cambia, porque cambiarlo rompe conexiones que ya funcionan. Todo lo que
 * ve una persona -pantallas, manual, API publica, arranques- usa esto.
 */

export const NOMBRE_SISTEMA = 'GSGchat';

/** La inicial del logo del armazon y de las paginas de entrada. */
export const INICIAL_SISTEMA = 'G';

/** Una linea para debajo del nombre. */
export const LEMA_SISTEMA = 'WhatsApp para reparto, entregas y ventas';

/** Como se presenta en cabeceras HTTP (webhooks salientes). */
export const USER_AGENT_SISTEMA = 'GSGchat';
