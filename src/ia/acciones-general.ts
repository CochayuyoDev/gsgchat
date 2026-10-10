import { moduloRetirado } from '../modulos-retirados.js';
/**
 * La via general de la IA operadora: todo lo que se puede hacer en el panel
 * y NO tiene una accion con nombre propio (acciones.ts, acciones-panel.ts).
 *
 *  - `panel.mapa` (consulta): el mapa curado de lo que se puede hacer, por
 *    secciones (entregas, chat, contactos...): para cada ruta,
 *    metodo, url, para que sirve en palabras y la forma del body. Con filtro
 *    por seccion o por palabra para no mandarlo todo de golpe.
 *  - `panel.consultar` (consulta): un GET a una ruta del mapa. Devuelve el
 *    JSON recortado y sin secretos.
 *  - `panel.hacer` (cambio, delicado): POST/PUT/PATCH/DELETE a una ruta del
 *    mapa. `preparar` solo lee (ver acciones-base.ts): comprueba la ruta y el
 *    metodo contra el mapa, lee el «antes» si hay de donde, y arma la tarjeta
 *    en palabras. `ejecutar` vuelve a comprobarlo TODO (los parametros llegan
 *    de vuelta del navegador) y llama a la MISMA ruta que la pantalla con la
 *    identidad de quien ordena: la ruta valida, mira el rol y apunta en la
 *    bitacora.
 *
 * La lista negra manda sobre el mapa: cuentas, claves, codigos de conexion,
 * membresia, tiendas, la conexion de WhatsApp, credenciales, datos de prueba
 * masivos y cualquier cosa con token/secret/password no se consulta ni se hace
 * nunca por aqui, ni fuera de /admin. Lo que no esta en el mapa tampoco.
 */

import { z } from 'zod';
import { acortar, def, errorDe, normal, ok, type Accion, type ContextoAccion, type Preparado, type ResultadoAccion, type Tarjeta } from './acciones-base.js';

type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RutaDelMapa {
  metodo: Metodo;
  /** Con `:id`, `:contactId`... para lo que cambia: '/admin/entregas/:id'. */
  ruta: string;
  /** Para que sirve, en palabras. */
  para: string;
  /** La forma del body (o de la query en un GET). */
  body?: string;
  /** Lo que el body tiene que traer si o si. */
  obligatorios?: string[];
  soloAdmin?: boolean;
  /** De donde se lee el «antes» (un GET, con los mismos `:param`). */
  leer?: string;
  /** Lo que conviene saber antes de pulsar. */
  aviso?: string;
}

export interface SeccionDelMapa {
  id: string;
  nombre: string;
  /** La pantalla donde se ve. */
  ir: string;
  /** Lo comercial: con «Solo lo de GSG» no se ofrece ni se hace. */
  ventas?: boolean;
  rutas: RutaDelMapa[];
}

const MANDA_WHATSAPP = 'Sale un WhatsApp de verdad (pasa por el ritmo, el horario y el modo prueba de siempre).';

// ======================================================================= EL MAPA

export const MAPA_PANEL: SeccionDelMapa[] = ([
  {
    id: 'entregas',
    nombre: 'Entregas de hoy y Números del día',
    ir: '/hoy',
    rutas: [
      { metodo: 'GET', ruta: '/admin/entregas', para: 'ver todo lo de hoy: cifras, entregas, ajustes' },
      { metodo: 'GET', ruta: '/admin/entregas/:id', para: 'ver una entrega con su bitácora' },
      { metodo: 'GET', ruta: '/admin/entregas/numeros', para: 'ver los números del día con su etapa (falta ubicación, falta confirmar...)' },
      { metodo: 'POST', ruta: '/admin/entregas/crear', para: 'crear un pedido a mano', body: '{ telefono: "51987654321", nombre?, referencia?, direccion?, distrito?, notas?, faltaUbicacion?: true, faltaConfirmacion?: true, lat?, lng?, urgente? }', obligatorios: ['telefono'] },
      { metodo: 'POST', ruta: '/admin/entregas/cargar-lista', para: 'cargar la lista del día pegada (Excel, CSV o líneas)', body: '{ texto: "…", faltaUbicacion?: true, faltaConfirmacion?: true }', obligatorios: ['texto'] },
      { metodo: 'POST', ruta: '/admin/entregas/:id/confirmar', para: 'dar la entrega por confirmada (o no) a mano', body: '{ confirmada: true|false }', leer: '/admin/entregas/:id' },
      { metodo: 'POST', ruta: '/admin/entregas/:id/cancelar', para: 'cancelar una entrega', body: '{ motivo?: "…" }', leer: '/admin/entregas/:id' },
      { metodo: 'POST', ruta: '/admin/entregas/:id/ubicacion', para: 'ponerle la ubicación a una entrega', body: '{ lat: -12.05, lng: -77.03 } o { texto: "enlace de Google Maps" }', leer: '/admin/entregas/:id' },
      { metodo: 'POST', ruta: '/admin/entregas/:id/entregada', para: 'marcar la entrega como entregada', leer: '/admin/entregas/:id' },
      { metodo: 'POST', ruta: '/admin/entregas/:id/reintentar', para: 'volver a intentar una entrega que se quedó parada', leer: '/admin/entregas/:id' },
      { metodo: 'POST', ruta: '/admin/entregas/:id/prioridad', para: 'marcar o desmarcar la entrega como urgente', body: '{ urgente: true|false }', obligatorios: ['urgente'], leer: '/admin/entregas/:id' },
      { metodo: 'POST', ruta: '/admin/entregas/confirmar-envio', para: 'confirmar el envío de los números que llegaron de GSG', body: '{ todos: true } o { ids: [12, 13] }', aviso: MANDA_WHATSAPP },
      { metodo: 'POST', ruta: '/admin/entregas/masa', para: 'una acción sobre varios números del día', body: '{ accion: "confirmar_envio"|"pedir_ubicacion"|"pedir_confirmacion"|"marcar_contactado"|"quitar_marca"|"pausar"|"reanudar", ids: [12, 13] }', obligatorios: ['accion', 'ids'] },
      { metodo: 'POST', ruta: '/admin/entregas/ajustes', para: 'cambiar los ajustes de las entregas (margen, esperas, intentos, textos)', body: '{ margenMinutos?, confirmacionEsperaMin?, confirmacionMaxIntentos?, motorizadoEsperaMin?, motorizadoMaxIntentos?, alertaSinUbicacionHora?: "12:00", avisarEntregado?, textos?: {…} } (solo lo que cambia)', soloAdmin: true, leer: '/admin/entregas' },
      { metodo: 'POST', ruta: '/admin/entregas/cerrar-dia', para: 'cerrar el día a mano (lo vivo pasa a incidencia, lo avisado a entregado)', body: '{ forzar?: true }', soloAdmin: true, aviso: 'Cierra el día de todas las entregas vivas.' },
    ],
  },
  {
    id: 'chat',
    nombre: 'Chats y mensajes',
    ir: '/chat',
    rutas: [
      { metodo: 'GET', ruta: '/admin/chat/conversations', para: 'buscar chats (lista de conversaciones)', body: 'query: ?q=Ana&limit=20' },
      { metodo: 'GET', ruta: '/admin/chat/:contactId', para: 'leer los mensajes de un chat', body: 'query: ?limit=30' },
      { metodo: 'GET', ruta: '/admin/chat/:contactId/ficha', para: 'ver la ficha de un contacto (datos, pedidos)' },
      { metodo: 'GET', ruta: '/admin/chat/:contactId/buscar', para: 'buscar un texto dentro de un chat', body: 'query: ?q=dirección' },
      { metodo: 'GET', ruta: '/admin/chat/destacados', para: 'ver los mensajes destacados' },
      { metodo: 'GET', ruta: '/admin/buscar', para: 'buscar en todo el panel (chats, pedidos, contactos)', body: 'query: ?q=Ana' },
      { metodo: 'POST', ruta: '/admin/chat/send', para: 'mandar un mensaje en un chat', body: '{ phone: "51987654321" o contactId: "…", text: "…", location?: "enlace o lat,lng", askLocation?: true }', aviso: MANDA_WHATSAPP },
      { metodo: 'POST', ruta: '/admin/chat/start', para: 'abrir un chat nuevo con un número', body: '{ phone: "51987654321", name?: "Ana" }', obligatorios: ['phone'] },
      { metodo: 'POST', ruta: '/admin/chat/:contactId/read', para: 'marcar el chat como leído' },
      { metodo: 'POST', ruta: '/admin/chat/:contactId/bot', para: 'pausar o reanudar el bot en ese chat', body: '{ pausado: true|false }', obligatorios: ['pausado'] },
      { metodo: 'POST', ruta: '/admin/chat/:contactId/asistente', para: 'cerrar o abrir el asistente IA en ese chat', body: '{ cerrado: true|false }', obligatorios: ['cerrado'] },
      { metodo: 'POST', ruta: '/admin/chat/:contactId/lista', para: 'fijar, silenciar, apartar o dejar sin leer un chat', body: '{ fijado?, silenciado?, apartado?, noLeido? } (true|false)' },
      { metodo: 'POST', ruta: '/admin/chat/:contactId/destacar', para: 'destacar mensajes', body: '{ ids: [123], destacado?: true }', obligatorios: ['ids'] },
      { metodo: 'POST', ruta: '/admin/chat/:contactId/reaccion', para: 'reaccionar a un mensaje', body: '{ mensajeId: 123, emoji: "👍" }', obligatorios: ['mensajeId', 'emoji'] },
      { metodo: 'POST', ruta: '/admin/chat/:contactId/editar', para: 'editar un mensaje enviado', body: '{ mensajeId: 123, texto: "…" }', obligatorios: ['mensajeId', 'texto'] },
      { metodo: 'POST', ruta: '/admin/chat/:contactId/eliminar', para: 'borrar mensajes', body: '{ ids: [123], paraTodos?: false }', obligatorios: ['ids'], aviso: 'Con paraTodos: true se borra también en el teléfono del cliente.' },
      { metodo: 'POST', ruta: '/admin/chat/reenviar', para: 'reenviar mensajes a otros chats', body: '{ origenId: "contactId", ids: [123], destinos: ["contactId o teléfono"] }', obligatorios: ['origenId', 'ids', 'destinos'], aviso: MANDA_WHATSAPP },
      { metodo: 'POST', ruta: '/admin/chat/:contactId/archive', para: 'cerrar y guardar la conversación (pasa a Guardados)' },
      { metodo: 'POST', ruta: '/admin/messages/location', para: 'mandar un pin de ubicación', body: '{ phone: "51987654321", input: "enlace o lat,lng", name?: "Tienda" }', obligatorios: ['phone', 'input'], aviso: MANDA_WHATSAPP },
      { metodo: 'POST', ruta: '/admin/messages/ask-location', para: 'pedirle la ubicación a un número con el botón', body: '{ phone: "51987654321", text?: "…" }', obligatorios: ['phone'], aviso: MANDA_WHATSAPP },
    ],
  },
  {
    id: 'contactos',
    nombre: 'Contactos y guardados',
    ir: '/guardados',
    rutas: [
      { metodo: 'GET', ruta: '/admin/contacts', para: 'buscar contactos', body: 'query: ?q=Ana&state=all|opted_in|opted_out|pending' },
      { metodo: 'POST', ruta: '/admin/contacts/import', para: 'importar contactos', body: '{ source: "feria", text: "51987654321, Ana\\n…" }', obligatorios: ['source'] },
      { metodo: 'POST', ruta: '/admin/contacts/opt-in', para: 'apuntar que un número aceptó recibir mensajes', body: '{ phone, source: "…", name? }', obligatorios: ['phone', 'source'] },
      { metodo: 'POST', ruta: '/admin/contacts/opt-out', para: 'dar de baja un número (no se le escribe más)', body: '{ phone }', obligatorios: ['phone'] },
      { metodo: 'POST', ruta: '/admin/salud/contactos/levantar', para: 'quitar el bloqueo de un número que el anti-baneo frenó', body: '{ phone }', obligatorios: ['phone'] },
      { metodo: 'GET', ruta: '/admin/archives', para: 'buscar conversaciones guardadas', body: 'query: ?q=Ana&pedido=GSG-1' },
      { metodo: 'GET', ruta: '/admin/archives/:id', para: 'leer una conversación guardada' },
      { metodo: 'POST', ruta: '/admin/archives/cerrar', para: 'guardar varios chats de golpe', body: '{ contactIds?: ["…"], pedidosDeHoy?: true }' },
      { metodo: 'POST', ruta: '/admin/archives/:id/notas', para: 'poner notas, etiquetas o pedido a una conversación guardada', body: '{ notas?, etiquetas?: [..], pedido? }', leer: '/admin/archives/:id' },
      { metodo: 'POST', ruta: '/admin/archives/:id/restore', para: 'devolver una conversación guardada al chat', leer: '/admin/archives/:id' },
      { metodo: 'DELETE', ruta: '/admin/archives/:id', para: 'borrar una conversación guardada', leer: '/admin/archives/:id' },
    ],
  },
  {
    id: 'campanas',
    nombre: 'Campañas y grupos de clientes',
    ir: '/panel#campanas',
    ventas: true,
    rutas: [
      { metodo: 'GET', ruta: '/admin/campaigns', para: 'ver las campañas' },
      { metodo: 'GET', ruta: '/admin/campaigns/:id', para: 'ver una campaña' },
      { metodo: 'GET', ruta: '/admin/campaigns/:id/stats', para: 'ver las cifras de una campaña' },
      { metodo: 'POST', ruta: '/admin/campaigns', para: 'crear y lanzar una campaña con una plantilla', body: '{ name, templateName, templateLanguage?: "es", recipients?: [{ phone, variables: [] }], ritmoPorHora?, canario? }', obligatorios: ['name', 'templateName'], aviso: 'Sin recipients va a TODOS los que aceptaron mensajes.' },
      { metodo: 'POST', ruta: '/admin/campaigns/:id/estado', para: 'pausar, reanudar o parar una campaña', body: '{ accion: "pausar"|"reanudar"|"parar", motivo? }', obligatorios: ['accion'], leer: '/admin/campaigns/:id' },
      { metodo: 'GET', ruta: '/admin/grupos/opciones', para: 'ver los filtros para armar grupos de clientes' },
      { metodo: 'POST', ruta: '/admin/grupos/enviar', para: 'mandar a un grupo de clientes (por goteo)', body: '{ criterio: { consentimiento?, reparto?, ficha?, actividad?, dias?, q?, telefonos? }, texto?: "…" o plantilla?: { name, language }, ritmoPorHora? }', obligatorios: ['criterio'], aviso: MANDA_WHATSAPP },
    ],
  },
  {
    id: 'plantillas',
    nombre: 'Plantillas de WhatsApp',
    ir: '/panel#plantillas',
    rutas: [
      { metodo: 'GET', ruta: '/admin/templates', para: 'ver las plantillas registradas' },
      { metodo: 'GET', ruta: '/admin/templates/catalog', para: 'ver el catálogo de plantillas listas para usar' },
      { metodo: 'POST', ruta: '/admin/templates', para: 'crear una plantilla propia', body: '{ name: "aviso_llegada" (minúsculas y _), language?: "es", category?: "UTILITY"|"MARKETING", body: "Hola {{1}}…", variables: ["nombre"], footer? }', obligatorios: ['name', 'body'] },
      { metodo: 'DELETE', ruta: '/admin/templates/:name/:language', para: 'borrar una plantilla' },
      { metodo: 'POST', ruta: '/admin/templates/sync', para: 'traer de Meta el estado de las plantillas' },
      { metodo: 'POST', ruta: '/admin/templates/push', para: 'mandar plantillas a Meta para aprobarlas', body: '{ names?: ["aviso_llegada"] }' },
    ],
  },
  {
    id: 'automatizacion',
    nombre: 'Respuestas automáticas, secuencias, mensajes programados y respuestas rápidas',
    ir: '/panel#automatizacion',
    rutas: [
      { metodo: 'GET', ruta: '/admin/automation/rules', para: 'ver las respuestas automáticas (reglas por palabra)' },
      { metodo: 'POST', ruta: '/admin/automation/rules', para: 'crear una respuesta automática', body: '{ name: "precio", trigger?: "keyword"|"first_message"|"any", keyword?: "precio", match?: "contains"|"equals"|"starts", reply?: "…", sequenceId?, enabled?: true, priority?: 100 }', obligatorios: ['name'] },
      { metodo: 'PUT', ruta: '/admin/automation/rules/:id', para: 'cambiar una respuesta automática (manda la regla entera)', body: 'igual que al crearla', obligatorios: ['name'], leer: '/admin/automation/rules' },
      { metodo: 'DELETE', ruta: '/admin/automation/rules/:id', para: 'borrar una respuesta automática', leer: '/admin/automation/rules' },
      { metodo: 'GET', ruta: '/admin/automation/sequences', para: 'ver las secuencias de mensajes' },
      { metodo: 'POST', ruta: '/admin/automation/sequences', para: 'crear una secuencia', body: '{ name, description?, stopOnReply?: true, enabled?: true, steps: [{ delayMinutes: 60, kind: "text"|"template", text?: "…", templateName? }] }', obligatorios: ['name', 'steps'] },
      { metodo: 'PUT', ruta: '/admin/automation/sequences/:id', para: 'cambiar una secuencia (entera)', body: 'igual que al crearla', obligatorios: ['name', 'steps'], leer: '/admin/automation/sequences' },
      { metodo: 'DELETE', ruta: '/admin/automation/sequences/:id', para: 'borrar una secuencia', leer: '/admin/automation/sequences' },
      { metodo: 'POST', ruta: '/admin/automation/sequences/:id/enroll', para: 'meter números en una secuencia', body: '{ phones: ["51987654321"], source? }', obligatorios: ['phones'], aviso: MANDA_WHATSAPP },
      { metodo: 'GET', ruta: '/admin/automation/enrollments', para: 'ver quién está en cada secuencia', body: 'query: ?sequenceId=…&status=active' },
      { metodo: 'POST', ruta: '/admin/automation/enrollments/:id/cancel', para: 'sacar a alguien de una secuencia' },
      { metodo: 'GET', ruta: '/admin/automation/scheduled', para: 'ver los mensajes programados', body: 'query: ?status=pending' },
      { metodo: 'POST', ruta: '/admin/automation/scheduled', para: 'programar un mensaje para una fecha y hora', body: '{ phone, dueAt: "2026-10-01T15:00:00-05:00", kind: "freeform"|"template", text?: "…", templateName? }', obligatorios: ['phone', 'dueAt', 'kind'], aviso: MANDA_WHATSAPP },
      { metodo: 'POST', ruta: '/admin/automation/scheduled/:id/cancel', para: 'cancelar un mensaje programado' },
      { metodo: 'GET', ruta: '/admin/automation/prefs', para: 'ver las preferencias (pedir ubicación de respaldo, preventa)' },
      { metodo: 'POST', ruta: '/admin/automation/prefs', para: 'cambiar las preferencias de la automatización', body: '{ askLocationFallback?, preventaActiva?, serviciosPreventa?: ["Olva", "Shalom"], mensajesPreventa?: {…} }', leer: '/admin/automation/prefs' },
      { metodo: 'GET', ruta: '/admin/preventa/mensajes', para: 'ver los textos del asistente de preventa' },
      { metodo: 'PUT', ruta: '/admin/preventa/mensajes', para: 'cambiar los textos del asistente de preventa', body: '{ mensajes: { clave: "texto" } }', obligatorios: ['mensajes'], leer: '/admin/preventa/mensajes' },
      { metodo: 'GET', ruta: '/admin/chat/atajos', para: 'ver las respuestas rápidas (/ubi, /camino...)' },
      { metodo: 'POST', ruta: '/admin/chat/atajos', para: 'guardar la lista de respuestas rápidas', body: '{ atajos: [{ atajo: "envio", texto: "…", sticker?: null }] } (la lista ENTERA; null = las de fábrica)', obligatorios: ['atajos'], soloAdmin: true, leer: '/admin/chat/atajos', aviso: 'Reemplaza la lista entera: incluye también las que ya había.' },
    ],
  },
  {
    id: 'stickers',
    nombre: 'Stickers',
    ir: '/panel#stickers',
    rutas: [
      { metodo: 'GET', ruta: '/admin/stickers', para: 'ver los stickers y cuál sale solo en cada momento' },
      { metodo: 'POST', ruta: '/admin/stickers/desde-chat', para: 'guardar un sticker que llegó en un chat', body: '{ mediaId: "…", nombre?: "gracias", uso?: "inicio"|"gracias"|"despedida"|"otro" }', obligatorios: ['mediaId'] },
      { metodo: 'DELETE', ruta: '/admin/stickers/:id', para: 'borrar un sticker', leer: '/admin/stickers' },
      { metodo: 'POST', ruta: '/admin/stickers/configuracion', para: 'elegir qué sticker sale solo al empezar, al dar las gracias o al despedirse', body: '{ inicio?: "id"|null, inicioEnReparto?: false, gracias?: "id"|null, despedida?: "id"|null }', soloAdmin: true, leer: '/admin/stickers' },
      { metodo: 'POST', ruta: '/admin/stickers/:id/enviar', para: 'mandar un sticker a un número', body: '{ phone: "51987654321" }', obligatorios: ['phone'], aviso: MANDA_WHATSAPP },
    ],
  },
  {
    id: 'procesos',
    nombre: 'Procesos (flujos con varias personas)',
    ir: '/procesos',
    rutas: [
      { metodo: 'GET', ruta: '/admin/procesos', para: 'ver los procesos y las plantillas de procesos' },
      { metodo: 'GET', ruta: '/admin/procesos/resumen', para: 'ver el resumen de los procesos' },
      { metodo: 'GET', ruta: '/admin/procesos/:id', para: 'ver un proceso con sus pasos' },
      { metodo: 'GET', ruta: '/admin/procesos/corridas', para: 'ver las corridas (tandas de personas)', body: 'query: ?procesoId=3' },
      { metodo: 'GET', ruta: '/admin/procesos/corridas/:id', para: 'ver una corrida' },
      { metodo: 'GET', ruta: '/admin/procesos/personas', para: 'ver las personas en procesos', body: 'query: ?procesoId=3&estado=…' },
      { metodo: 'GET', ruta: '/admin/procesos/personas/:id', para: 'ver una persona de un proceso' },
      { metodo: 'POST', ruta: '/admin/procesos/desde-plantilla', para: 'crear un proceso desde una plantilla', body: '{ plantilla: "id de la plantilla", nombre? }', obligatorios: ['plantilla'], soloAdmin: true },
      { metodo: 'POST', ruta: '/admin/procesos/:id/estado', para: 'activar, pausar o archivar un proceso', body: '{ estado: "activo"|"pausado"|"archivado" }', obligatorios: ['estado'], soloAdmin: true, leer: '/admin/procesos/:id' },
      { metodo: 'DELETE', ruta: '/admin/procesos/:id', para: 'borrar un proceso', soloAdmin: true, leer: '/admin/procesos/:id' },
      { metodo: 'POST', ruta: '/admin/procesos/:id/personas', para: 'cargar personas a un proceso (una corrida nueva)', body: '{ nombre?, texto: "tabla pegada" } o { personas: [{ telefono, nombre, … }] }', leer: '/admin/procesos/:id', aviso: MANDA_WHATSAPP },
      { metodo: 'POST', ruta: '/admin/procesos/corridas/:id/estado', para: 'pausar, reanudar o terminar una corrida', body: '{ estado: "activa"|"pausada"|"terminada" }', obligatorios: ['estado'], leer: '/admin/procesos/corridas/:id' },
      { metodo: 'POST', ruta: '/admin/procesos/personas/masa', para: 'una acción sobre varias personas de un proceso', body: '{ accion: "pedir_ahora"|"pausar"|"reanudar"|"persona"|"cancelar", ids: [1, 2] }', obligatorios: ['accion', 'ids'] },
    ],
  },
  {
    id: 'envio-automatico',
    nombre: 'Envío automático (pedir ubicación o un mensaje cada X horas)',
    ir: '/envio-automatico',
    rutas: [
      { metodo: 'GET', ruta: '/admin/envio-automatico', para: 'ver los números en la lista, cifras y ajustes (cada uno trae idRuta "e:12" o "s:5")' },
      { metodo: 'POST', ruta: '/admin/envio-automatico', para: 'poner uno o varios números en la lista', body: '{ telefonos: "987654321, 912345678", nombre?, que?: "ubicacion"|"mensaje", texto?, hasta?: "ubicacion"|"respuesta"|"envios", referencia?, maxEnvios? }', obligatorios: ['telefonos'], aviso: MANDA_WHATSAPP },
      { metodo: 'POST', ruta: '/admin/envio-automatico/:clave/pausar', para: 'pausar un número de la lista (:clave = su idRuta, p. ej. e:12)' },
      { metodo: 'POST', ruta: '/admin/envio-automatico/:clave/reanudar', para: 'reanudar un número de la lista' },
      { metodo: 'POST', ruta: '/admin/envio-automatico/:clave/editar', para: 'cambiar un número de la lista', body: '{ nombre?, que?, texto?, hasta?, referencia?, maxEnvios? }' },
      { metodo: 'DELETE', ruta: '/admin/envio-automatico/:clave', para: 'quitar un número de la lista' },
      { metodo: 'POST', ruta: '/admin/envio-automatico/ajustes', para: 'cambiar cada cuántas horas, el máximo y el horario', body: '{ cadaHoras?: 3, maxEnvios?: 4, horaInicio?: 9, horaFin?: 20 }', leer: '/admin/envio-automatico' },
    ],
  },
  {
    id: 'reparto',
    nombre: 'Reparto / rutas (pedir ubicaciones por lotes)',
    ir: '/rutas',
    rutas: [
      { metodo: 'GET', ruta: '/admin/rutas', para: 'ver el reparto: lotes, cifras y estado del motor' },
      { metodo: 'GET', ruta: '/admin/rutas/solicitudes', para: 'ver los clientes del reparto', body: 'query: ?vista=sin_ubicacion|esperando|respondieron|numero_malo|requieren_persona&q=Ana' },
      { metodo: 'GET', ruta: '/admin/rutas/solicitudes/:id', para: 'ver un cliente del reparto' },
      { metodo: 'GET', ruta: '/admin/rutas/vistas', para: 'ver cuántos hay en cada vista' },
      { metodo: 'GET', ruta: '/admin/rutas/lotes/:id', para: 'ver un lote' },
      { metodo: 'GET', ruta: '/admin/rutas/cola', para: 'ver lo que falta por reportar a GSG' },
      { metodo: 'GET', ruta: '/admin/rutas/ajustes', para: 'ver los ajustes del reparto (pausas, esperas, horario, textos)' },
      { metodo: 'POST', ruta: '/admin/rutas/ajustes', para: 'cambiar los ajustes del reparto', body: '{ pausaMinSegundos?, pausaMaxSegundos?, esperaRespuestaMinutos?, maxIntentos?, pedirUbicacionCadaMinutos?, horaInicio?, horaFin?, textos?: { solicitud: [..], recordatorio: [..], insistencia: [..] } }', leer: '/admin/rutas/ajustes' },
      { metodo: 'POST', ruta: '/admin/rutas/lotes', para: 'cargar un lote de clientes para pedirles la ubicación', body: '{ nombre?, texto: "tabla pegada" o filas: [{ telefono, nombre?, referencia?, direccion?, distrito? }], arrancar?: false }', aviso: 'Con arrancar: true empieza a escribirles ya.' },
      { metodo: 'POST', ruta: '/admin/rutas/lotes/:id/estado', para: 'arrancar, pausar o terminar un lote', body: '{ estado: "enviando"|"pausado"|"terminado"|"preparado" }', obligatorios: ['estado'], leer: '/admin/rutas/lotes/:id' },
      { metodo: 'DELETE', ruta: '/admin/rutas/lotes/:id', para: 'borrar un lote', leer: '/admin/rutas/lotes/:id' },
      { metodo: 'PATCH', ruta: '/admin/rutas/solicitudes/:id', para: 'corregir los datos de un cliente del reparto', body: '{ telefono?, nombre?, referencia?, direccion?, distrito? }', leer: '/admin/rutas/solicitudes/:id' },
      { metodo: 'POST', ruta: '/admin/rutas/solicitudes/:id/resolver', para: 'ponerle la ubicación a mano a un cliente del reparto', body: '{ lat, lng } o { enlace: "Google Maps" }, nota?', leer: '/admin/rutas/solicitudes/:id' },
      { metodo: 'POST', ruta: '/admin/rutas/solicitudes/:id/derivar', para: 'pasar un cliente del reparto a una persona', body: '{ motivo?, asignadoA? }', leer: '/admin/rutas/solicitudes/:id' },
      { metodo: 'POST', ruta: '/admin/rutas/solicitudes/:id/reintentar', para: 'volver a escribirle a un cliente del reparto', leer: '/admin/rutas/solicitudes/:id', aviso: MANDA_WHATSAPP },
      { metodo: 'POST', ruta: '/admin/rutas/cola/despachar', para: 'mandar ya a GSG lo que falta por reportar' },
    ],
  },
  {
    id: 'leads',
    nombre: 'Fichas de pedidos (leads)',
    ir: '/panel#leads',
    rutas: [
      { metodo: 'GET', ruta: '/admin/leads', para: 'ver las fichas', body: 'query: ?estado=nuevo|en_conversacion|calificado|enviado|descartado' },
      { metodo: 'GET', ruta: '/admin/leads/:contactId', para: 'ver la ficha de un contacto' },
      { metodo: 'PUT', ruta: '/admin/leads/:contactId', para: 'cambiar la ficha (datos o estado)', body: '{ nombre?, entregaDireccion?, entregaDistrito?, contenido?, cuando?, documentoTipo?, documentoNumero?, estado?: "calificado"|"descartado"…, notas? }', leer: '/admin/leads/:contactId' },
    ],
  },
  {
    id: 'ajustes',
    nombre: 'Ajustes, salud del número y avisos',
    ir: '/panel#configuracion',
    rutas: [
      { metodo: 'GET', ruta: '/admin/ajustes', para: 'ver los ajustes generales (negocio, modo prueba, horario, ritmo, supervisor)' },
      { metodo: 'POST', ruta: '/admin/ajustes', para: 'cambiar ajustes generales', body: '{ nombreNegocio?, tono?, zonaHoraria?, horario?: { inicio: "09:00", fin: "20:00", dias }, ritmo?: { maxPorMinuto, maxPorHora, … }, avisos?: { supervisor: "51…" }, resumenes? } (solo lo que cambia)', soloAdmin: true, leer: '/admin/ajustes' },
      { metodo: 'DELETE', ruta: '/admin/ajustes', para: 'volver TODOS los ajustes generales a los de fábrica', soloAdmin: true, leer: '/admin/ajustes' },
      { metodo: 'GET', ruta: '/admin/perfil', para: 'ver el perfil de la instalación (reparto, tienda o chat)' },
      { metodo: 'POST', ruta: '/admin/perfil', para: 'cambiar el perfil de la instalación', body: '{ perfil: "reparto"|"tienda"|"chat" }', obligatorios: ['perfil'], soloAdmin: true, leer: '/admin/perfil' },
      { metodo: 'GET', ruta: '/admin/salud', para: 'ver la salud del número (nivel, ritmo, pausas)' },
      { metodo: 'POST', ruta: '/admin/salud/evaluar', para: 'volver a evaluar la salud del número ahora' },
      { metodo: 'POST', ruta: '/admin/salud/reanudar', para: 'reanudar los envíos tras una pausa del anti-baneo', body: '{ motivo? }' },
      { metodo: 'POST', ruta: '/admin/pause', para: 'pausar o reanudar TODOS los envíos', body: '{ paused: true|false, reason? }', obligatorios: ['paused'] },
      { metodo: 'GET', ruta: '/admin/avisos', para: 'ver los avisos del panel' },
      { metodo: 'GET', ruta: '/admin/resumen', para: 'ver el resumen general' },
      { metodo: 'GET', ruta: '/admin/health', para: 'ver el estado técnico del sistema' },
      { metodo: 'GET', ruta: '/admin/plan', para: 'ver el plan (límites y uso)' },
      { metodo: 'GET', ruta: '/admin/fiabilidad', para: 'ver la fiabilidad: vigilante, copias, prueba de humo' },
      { metodo: 'POST', ruta: '/admin/fiabilidad/ajustes', para: 'cambiar los ajustes de fiabilidad (aviso por correo, copias)', body: '{ vigilante?: { minutosAntesDeAvisar?, correoAviso? }, humo?: { activo?, hora? }, copia?: {…} }', soloAdmin: true, leer: '/admin/fiabilidad' },
      { metodo: 'POST', ruta: '/admin/fiabilidad/copia/ahora', para: 'hacer una copia de seguridad ahora', soloAdmin: true },
      { metodo: 'GET', ruta: '/admin/voz', para: 'ver la configuración de la voz del asistente' },
      { metodo: 'POST', ruta: '/admin/voz', para: 'cambiar la voz del asistente (sin la clave)', body: '{ activa?, vozId?, vozNombre?, cuando?: "nunca"|"si-manda-audio"|"siempre", transcribir?, maxCaracteres?, idioma? }', soloAdmin: true, leer: '/admin/voz' },
    ],
  },
  {
    id: 'integraciones',
    nombre: 'Integraciones (solo ver)',
    ir: '/panel#integraciones',
    rutas: [
      { metodo: 'GET', ruta: '/admin/integraciones/stoky', para: 'ver la conexión con Stoky' },
      { metodo: 'GET', ruta: '/admin/gsg/cuadre', para: 'ver el cierre del día con lo de aquí (pedidos sin cerrar; a GSG no se le pregunta)', body: 'query: ?dia=2026-09-29' },
      { metodo: 'GET', ruta: '/admin/ia', para: 'ver la configuración de la IA (sin el token)' },
      { metodo: 'GET', ruta: '/admin/ia/uso', para: 'ver cuánto se usó la IA' },
    ],
  },
  {
    id: 'entrenamiento',
    nombre: 'Entrenamiento de la IA',
    ir: '/entrenamiento',
    rutas: [
      { metodo: 'GET', ruta: '/admin/entrenamiento', para: 'ver el resumen del entrenamiento' },
      { metodo: 'GET', ruta: '/admin/entrenamiento/lecciones', para: 'buscar lecciones', body: 'query: ?q=envío&estado=activa|pendiente|descartada' },
      { metodo: 'POST', ruta: '/admin/entrenamiento/lecciones', para: 'enseñarle una lección a la IA', body: '{ tipo?: "ejemplo"|"dato"|"regla", pregunta?: "¿hacen envíos a Callao?", respuesta: "Sí, …", tema? }', obligatorios: ['respuesta'] },
      { metodo: 'PATCH', ruta: '/admin/entrenamiento/lecciones/:id', para: 'cambiar una lección', body: '{ pregunta?, respuesta?, tema?, estado?: "activa"|"pendiente"|"descartada" }' },
      { metodo: 'DELETE', ruta: '/admin/entrenamiento/lecciones/:id', para: 'borrar una lección', soloAdmin: true },
      { metodo: 'POST', ruta: '/admin/entrenamiento/lecciones/lote', para: 'aprobar, descartar, activar o borrar lecciones en masa', body: '{ accion: "aprobar"|"descartar"|"activar"|"borrar", ids?: [1, 2], estado?, tema? }', obligatorios: ['accion'], soloAdmin: true },
      { metodo: 'GET', ruta: '/admin/ia/no-entendido', para: 'ver lo que la IA no entendió', body: 'query: ?dias=7' },
      { metodo: 'POST', ruta: '/admin/ia/no-entendido/corregir', para: 'decir qué quería decir un mensaje que no se entendió', body: '{ id: 5, era: "si"|"no"|"duda"|"minutos"|"entregado"|"no_entregado"|"ignorar", minutos?, leccion?: true }', obligatorios: ['id', 'era'] },
    ],
  },
  {
    id: 'resumenes',
    nombre: 'Resúmenes al supervisor',
    ir: '/panel#configuracion',
    rutas: [
      { metodo: 'GET', ruta: '/admin/resumenes', para: 'ver los resúmenes del día al supervisor' },
      { metodo: 'POST', ruta: '/admin/resumenes/mandar', para: 'mandar ya el resumen de la mañana o de la tarde', body: '{ franja: "manana"|"tarde" }', obligatorios: ['franja'], aviso: MANDA_WHATSAPP },
    ],
  },
  {
    id: 'seguimiento',
    nombre: 'Enlaces de seguimiento y ubicaciones',
    ir: '/panel',
    rutas: [
      { metodo: 'GET', ruta: '/admin/tracking', para: 'ver los enlaces de seguimiento activos' },
      { metodo: 'POST', ruta: '/admin/tracking', para: 'crear un enlace de seguimiento', body: '{ phone?, label?, ttlMinutes?: 120, notify?: true (se lo manda) }' },
      { metodo: 'DELETE', ruta: '/admin/tracking/:id', para: 'anular un enlace de seguimiento' },
      { metodo: 'GET', ruta: '/admin/locations', para: 'ver las ubicaciones recibidas', body: 'query: ?phone=51987654321' },
      { metodo: 'GET', ruta: '/admin/deliveries', para: 'ver el estado de los mensajes enviados' },
    ],
  },
] satisfies SeccionDelMapa[]).map((seccion) => ({ ...seccion, rutas: seccion.rutas.filter((ruta) => !moduloRetirado(ruta.ruta)) })).filter((seccion) => seccion.rutas.length > 0);


// ================================================================ LISTA NEGRA

/** Nunca por aqui: ni leer ni cambiar (tampoco lo que cuelga de ellas). */
export const LISTA_NEGRA = [
  '/admin/usuarios',
  '/admin/claves-api',
  '/admin/mi-clave',
  '/admin/actividad',
  '/admin/codigos-conexion',
  '/admin/membresia',
  '/admin/tiendas',
  '/admin/connect',
  '/admin/setup',
  '/admin/local',
  '/admin/waha',
  '/admin/settings',
  '/admin/dev',
  '/admin/desarrollador',
  '/admin/entregas/gsg',
  '/admin/entregas/simulador',
  '/admin/gsg/tokens-simulador',
  '/admin/integraciones/stoky/clave',
  '/admin/ia/ordenes',
  '/admin/ia/modelos',
  '/admin/ia/probar-conexion',
  '/admin/voz/probar',
  '/admin/fiabilidad/copia/descargar',
  '/admin/entregas/de-prueba',
];

/** Cualquier cosa que huela a credencial, en la ruta, la query o un campo del body. */
const PALABRAS_PROHIBIDAS = /token|secret|password|passwd|contrase|clave|api[-_]?key|hash|credencial|cookie|authorization|webhook/i;

export interface RutaResuelta {
  /** El path sin query: '/admin/entregas/5'. */
  path: string;
  /** La url tal cual se llama (con su query). */
  url: string;
  seccion: SeccionDelMapa;
  entrada: RutaDelMapa;
  params: Record<string, string>;
}

/**
 * Comprueba la url: dentro de /admin, sin trucos (.., //, %, url absoluta,
 * \), fuera de la lista negra. Devuelve el path y la query, o el motivo.
 */
export function revisarUrl(cruda: unknown): { path: string; query: string } | { motivo: string } {
  if (typeof cruda !== 'string') return { motivo: 'Falta la ruta (p. ej. "/admin/entregas").' };
  const url = cruda.trim();
  if (!url) return { motivo: 'Falta la ruta (p. ej. "/admin/entregas").' };
  if (url.length > 600) return { motivo: 'Esa ruta es demasiado larga.' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || url.includes('\\')) return { motivo: 'Solo rutas del panel que empiecen por /admin/ (nada de direcciones de fuera).' };
  if (/[\s\u0000-\u001f#]/.test(url)) return { motivo: 'Esa ruta trae caracteres que no valen.' };
  const i = url.indexOf('?');
  const path = i >= 0 ? url.slice(0, i) : url;
  const query = i >= 0 ? url.slice(i + 1) : '';
  if (path.includes('%')) return { motivo: 'La ruta va sin codificar (sin %): escribe los números o ids tal cual.' };
  if (path.includes('//')) return { motivo: 'Esa ruta tiene barras dobles: escríbela bien (p. ej. "/admin/entregas").' };
  const segmentos = path.split('/');
  if (segmentos.some((s) => s === '.' || s === '..')) return { motivo: 'Esa ruta no vale (lleva "." o "..").' };
  const bajo = path.toLowerCase();
  if (!bajo.startsWith('/admin/')) return { motivo: 'Por aquí solo se llega a las pantallas del panel (/admin/...).' };
  const negra = LISTA_NEGRA.find((p) => bajo === p || bajo.startsWith(`${p}/`) || bajo.startsWith(`${p}.`) || bajo.startsWith(`${p}-`));
  if (negra) return { motivo: `Eso no se puede tocar desde la IA (${negra}: cuentas, claves, conexión o membresía). Hazlo tú desde su pantalla.` };
  if (PALABRAS_PROHIBIDAS.test(bajo) || PALABRAS_PROHIBIDAS.test(query)) return { motivo: 'Eso tiene que ver con claves o credenciales: no se toca desde la IA.' };
  return { path: path.length > 7 && path.endsWith('/') ? path.slice(0, -1) : path, query };
}

const SEGMENTO_PARAM = /^[A-Za-z0-9_:.@+-]{1,120}$/;

/** Las entradas del mapa que encajan con este path (de todos los metodos), la mas concreta primero. */
function encajes(path: string): Array<{ seccion: SeccionDelMapa; entrada: RutaDelMapa; params: Record<string, string>; literales: number }> {
  const trozos = path.split('/');
  const salida: Array<{ seccion: SeccionDelMapa; entrada: RutaDelMapa; params: Record<string, string>; literales: number }> = [];
  for (const seccion of MAPA_PANEL) {
    for (const entrada of seccion.rutas) {
      const patron = entrada.ruta.split('/');
      if (patron.length !== trozos.length) continue;
      const params: Record<string, string> = {};
      let literales = 0;
      let va = true;
      for (let k = 0; k < patron.length && va; k++) {
        const p = patron[k]!;
        const t = trozos[k]!;
        if (p.startsWith(':')) {
          if (!SEGMENTO_PARAM.test(t)) va = false;
          else params[p.slice(1)] = t;
        } else if (p === t) literales++;
        else va = false;
      }
      if (va) salida.push({ seccion, entrada, params, literales });
    }
  }
  // '/admin/entregas/numeros' gana a '/admin/entregas/:id'.
  const max = Math.max(-1, ...salida.map((s) => s.literales));
  return salida.filter((s) => s.literales === max);
}

/** Las rutas del mapa que mas se parecen a lo que se pidio (para decirlo en el «no»). */
export function parecidas(path: string, n = 5): string[] {
  const palabras = normal(path)
    .split(/[/?=&_\-.]+/)
    .filter((w) => w && w !== 'admin' && !/^\d+$/.test(w));
  const puntuadas = MAPA_PANEL.flatMap((s) => s.rutas.map((r) => ({ r, p: palabras.filter((w) => normal(`${r.ruta} ${r.para} ${s.id}`).includes(w)).length })));
  return puntuadas
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p)
    .slice(0, n)
    .map((x) => `${x.r.metodo} ${x.r.ruta} (${x.r.para})`);
}

/**
 * La ruta, comprobada contra la lista negra y el mapa, para ese metodo.
 * Tambien mira el rol y el modo «Solo lo de GSG».
 */
export function resolverRuta(metodo: Metodo, url: unknown, ctx: Pick<ContextoAccion, 'esAdmin' | 'sinVentas'>): RutaResuelta | { motivo: string; ir?: string } {
  const r = revisarUrl(url);
  if ('motivo' in r) return r;
  const todos = encajes(r.path);
  if (!todos.length) {
    const p = parecidas(r.path);
    return { motivo: `La ruta ${r.path} no está en el mapa del panel.${p.length ? ` Las parecidas: ${p.join('; ')}.` : ' Pide panel.mapa para ver lo que hay.'}` };
  }
  const del = todos.find((t) => t.entrada.metodo === metodo);
  if (!del) return { motivo: `${r.path} no se usa con ${metodo}. Con esa ruta: ${todos.map((t) => `${t.entrada.metodo} (${t.entrada.para})`).join('; ')}.` };
  if (del.seccion.ventas && ctx.sinVentas) return { motivo: 'Con «Solo lo de GSG» no hay campañas ni grupos de venta: eso está apagado en este modo.' };
  if (del.entrada.soloAdmin && !ctx.esAdmin) return { motivo: `Eso (${del.entrada.para}) solo lo puede hacer un administrador de la tienda. Pídeselo a un administrador.`, ir: del.seccion.ir };
  return { path: r.path, url: r.query ? `${r.path}?${r.query}` : r.path, seccion: del.seccion, entrada: del.entrada, params: del.params };
}

// ============================================================== LO QUE SE DEVUELVE

const MAX_JSON = 5000;

/** Sin secretos (por nombre de campo, a cualquier profundidad) y recortado: cadenas, listas y profundidad. */
export function limpiarDatos(valor: unknown, largoTexto = 200, largoLista = 25, profundidad = 0): unknown {
  if (profundidad > 6) return '…';
  if (typeof valor === 'string') return acortar(valor, largoTexto);
  if (Array.isArray(valor)) {
    const lista = valor.slice(0, largoLista).map((v) => limpiarDatos(v, largoTexto, largoLista, profundidad + 1));
    return valor.length > largoLista ? [...lista, `… y ${valor.length - largoLista} más`] : lista;
  }
  if (valor && typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      // La clave de la lista de envio automatico ("e:12") no es un secreto: se
      // pasa como idRuta (el modelo tapa cualquier campo que se llame "clave").
      if (k === 'clave' && typeof v === 'string' && /^[es]:\d+$/.test(v)) {
        salida.idRuta = v;
        continue;
      }
      if (PALABRAS_PROHIBIDAS.test(k) || /^(pin|pass|pwd)$/i.test(k)) continue;
      salida[k] = limpiarDatos(v, largoTexto, largoLista, profundidad + 1);
    }
    return salida;
  }
  return valor;
}

/** Lo mismo, apretando hasta que quepa. */
export function recortar(valor: unknown, max = MAX_JSON): unknown {
  for (const [texto, lista] of [
    [200, 25],
    [120, 12],
    [80, 6],
    [60, 3],
  ] as const) {
    const d = limpiarDatos(valor, texto, lista);
    if (JSON.stringify(d ?? null).length <= max) return d;
  }
  const s = JSON.stringify(limpiarDatos(valor, 60, 3) ?? null);
  return `${s.slice(0, max)}… (recortado)`;
}

/** Cuantos elementos trae una respuesta (para el resumen). */
function cuantosHay(json: unknown): string {
  if (Array.isArray(json)) return `${json.length} elemento(s)`;
  if (json && typeof json === 'object') {
    const listas = Object.entries(json as Record<string, unknown>).filter(([, v]) => Array.isArray(v)) as Array<[string, unknown[]]>;
    if (listas.length) return listas.slice(0, 3).map(([k, v]) => `${k}: ${v.length}`).join(', ');
  }
  return 'listo';
}

/** El body en palabras: «nombre: Ana · estado: descanso». */
export function bodyLegible(body: unknown): string {
  if (body === undefined || body === null) return '';
  if (typeof body !== 'object') return acortar(String(body), 200);
  const partes: string[] = [];
  const recorrer = (v: unknown, pre: string) => {
    if (partes.length >= 14) return;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) recorrer(x, pre ? `${pre}.${k}` : k);
      return;
    }
    const texto = Array.isArray(v) ? (v.length > 6 ? `${v.length} elementos` : v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')) : String(v);
    partes.push(`${pre}: ${acortar(texto, 120)}`);
  };
  recorrer(body, '');
  return partes.join(' · ');
}

/** Si algun campo del body huele a credencial. */
function campoProhibido(body: unknown, profundidad = 0): string | null {
  if (profundidad > 6 || !body || typeof body !== 'object') return null;
  if (Array.isArray(body)) {
    for (const v of body) {
      const c = campoProhibido(v, profundidad + 1);
      if (c) return c;
    }
    return null;
  }
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (PALABRAS_PROHIBIDAS.test(k) || /^(pin|pass|pwd)$/i.test(k)) return k;
    const c = campoProhibido(v, profundidad + 1);
    if (c) return c;
  }
  return null;
}

/** El objeto de la lista cuyo id es este (reglas...), o el json tal cual. */
function elDeLaLista(json: unknown, params: Record<string, string>): { obj: unknown; encontrado: boolean } {
  const id = params.id ?? params.contactId ?? params.clave;
  if (!id) return { obj: json, encontrado: true };
  const buscar = (v: unknown, prof: number): Record<string, unknown> | null => {
    if (prof > 3 || !v || typeof v !== 'object') return null;
    if (Array.isArray(v)) {
      for (const x of v) {
        if (x && typeof x === 'object' && !Array.isArray(x)) {
          const o = x as Record<string, unknown>;
          if (String(o.id ?? '') === id || String(o.clave ?? '') === id || String(o.contactId ?? '') === id) return o;
        }
      }
      return null;
    }
    const o = v as Record<string, unknown>;
    if (String(o.id ?? '') === id) return o;
    for (const x of Object.values(o)) {
      const r = buscar(x, prof + 1);
      if (r) return r;
    }
    return null;
  };
  const o = buscar(json, 0);
  return o ? { obj: o, encontrado: true } : { obj: json, encontrado: false };
}

/** Como se llama la cosa: nombre, referencia, telefono... */
function nombreDe(o: unknown): string | undefined {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
  const r = o as Record<string, unknown>;
  const n = r.nombre ?? r.name ?? r.referencia ?? r.label ?? r.atajo ?? r.phone ?? r.telefono;
  if (typeof n !== 'string' && typeof n !== 'number') {
    const dentro = r.entrega ?? r.proceso ?? r.solicitud ?? r.contacto ?? r.lead;
    return dentro && dentro !== o ? nombreDe(dentro) : undefined;
  }
  return acortar(String(n), 80);
}

/** «Antes»: los mismos campos que se van a cambiar, leidos de como estan ahora. */
function antesDe(obj: unknown, body: unknown): string | undefined {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  const o = obj as Record<string, unknown>;
  const base = (o.entrega ?? o.proceso ?? o.solicitud ?? o.lead ?? o.efectivo ?? o.ajustes ?? o) as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const partes: string[] = [];
  for (const k of Object.keys(body as Record<string, unknown>)) {
    const v = k in base ? base[k] : o[k];
    if (v === undefined) continue;
    partes.push(`${k}: ${bodyLegible({ x: v }).replace(/^x: /, '').replace(/ · x\./g, ', ')}`);
  }
  if (!partes.length && typeof o.estado === 'string') partes.push(`estado: ${o.estado}`);
  return partes.length ? acortar(partes.join(' · '), 400) : undefined;
}

// ================================================================ LAS ACCIONES

const panelMapa = def({
  nombre: 'panel.mapa',
  tipo: 'consulta',
  descripcion:
    'El mapa de TODO lo que se puede hacer en el panel (rutas /admin por secciones: entregas, chat, contactos, campanas, plantillas, automatizacion, stickers, procesos, envio-automatico, reparto, leads, ajustes, integraciones, entrenamiento, resumenes, seguimiento). Úsalo SOLO si no hay una acción con nombre propio para lo que te piden; luego usa panel.consultar o panel.hacer con la ruta exacta del mapa.',
  parametros: 'seccion (opcional: una de las de arriba), buscar (opcional: una palabra, p. ej. "sticker" o "placa"). Sin nada, da la lista de secciones',
  ejemplo: { orden: 'guarda el sticker que me mandó Ana', accion: { accion: 'panel.mapa', buscar: 'sticker' } },
  schema: z.object({ seccion: z.string().trim().max(60).optional(), buscar: z.string().trim().max(60).optional() }),
  async ejecutar(p, ctx): Promise<ResultadoAccion> {
    const visibles = MAPA_PANEL.filter((s) => !(s.ventas && ctx.sinVentas));
    const linea = (r: RutaDelMapa) => ({ metodo: r.metodo, ruta: r.ruta, para: r.para, ...(r.body ? { body: r.body } : {}), ...(r.soloAdmin ? { soloAdmin: true } : {}), ...(r.soloAdmin && !ctx.esAdmin ? { puedes: false } : {}) });
    if (!p.seccion && !p.buscar) {
      return {
        ok: true,
        resumen: `El panel tiene ${visibles.length} secciones. Pide panel.mapa con "seccion" (o "buscar") para ver sus rutas.`,
        datos: visibles.map((s) => ({ seccion: s.id, nombre: s.nombre, rutas: s.rutas.length })),
      };
    }
    const q = normal(p.seccion ?? '');
    const b = normal(p.buscar ?? '');
    let secciones = q ? visibles.filter((s) => normal(s.id) === q || normal(s.nombre).includes(q) || normal(s.id).includes(q)) : visibles;
    if (q && !secciones.length) secciones = visibles.filter((s) => s.rutas.some((r) => normal(`${r.ruta} ${r.para}`).includes(q)));
    const datos = secciones
      .map((s) => ({ seccion: s.id, nombre: s.nombre, pantalla: s.ir, rutas: s.rutas.filter((r) => !b || b.split(' ').every((w) => normal(`${r.ruta} ${r.para} ${r.body ?? ''} ${s.nombre}`).includes(w))).map(linea) }))
      .filter((s) => s.rutas.length);
    if (!datos.length) return { ok: false, resumen: `No hay nada en el mapa para "${[p.seccion, p.buscar].filter(Boolean).join(' ')}". Secciones: ${visibles.map((s) => s.id).join(', ')}.` };
    const total = datos.reduce((n, s) => n + s.rutas.length, 0);
    return { ok: true, resumen: `${total} ruta(s) en ${datos.map((s) => s.nombre).join(', ')}.`, datos: recortar(datos, 5500) };
  },
});

const panelConsultar = def({
  nombre: 'panel.consultar',
  tipo: 'consulta',
  descripcion: 'Leer cualquier pantalla del panel por su ruta GET del mapa (panel.mapa) y ver el JSON (recortado y sin secretos). Úsalo SOLO si no hay una acción de consulta con nombre propio para eso.',
  parametros: 'ruta (la ruta GET del mapa con los ids ya puestos y, si quieres, la query: "/admin/entregas", "/admin/chat/conversations?q=Ana")',
  ejemplo: { orden: '¿qué stickers tenemos?', accion: { accion: 'panel.consultar', ruta: '/admin/stickers' } },
  schema: z.object({ ruta: z.string().trim().min(1).max(600) }),
  async ejecutar(p, ctx): Promise<ResultadoAccion> {
    const r = resolverRuta('GET', p.ruta, ctx);
    if ('motivo' in r) return { ok: false, resumen: r.motivo, ir: r.ir };
    const res = await ctx.llamar({ method: 'GET', url: r.url });
    if (!ok(res)) return errorDe(res, `No se pudo leer ${r.path}.`);
    return { ok: true, resumen: `Leído (${r.entrada.para}): ${cuantosHay(res.json)}.`, datos: recortar(res.json), ir: r.seccion.ir };
  },
});

const METODOS_DE_CAMBIO = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
type MetodoCambio = (typeof METODOS_DE_CAMBIO)[number];

interface ParamsHacer {
  metodo?: MetodoCambio;
  ruta: string;
  datos?: Record<string, unknown>;
}

const hacerSchema = z
  .object({
    metodo: z
      .string()
      .trim()
      .transform((m) => m.toUpperCase())
      .pipe(z.enum(METODOS_DE_CAMBIO))
      .optional(),
    ruta: z.string().trim().min(1).max(600),
    datos: z.record(z.string(), z.unknown()).optional(),
    /** Por si el modelo lo llama "body". */
    body: z.record(z.string(), z.unknown()).optional(),
  })
  .transform(({ body, datos, ...resto }): ParamsHacer => ({ ...resto, ...((datos ?? body) ? { datos: datos ?? body } : {}) }));

/** El metodo que se pidio, o el unico de cambio que tiene esa ruta. */
function metodoDe(p: ParamsHacer): MetodoCambio | { motivo: string } {
  if (p.metodo) return p.metodo;
  const r = revisarUrl(p.ruta);
  if ('motivo' in r) return r;
  const de = encajes(r.path)
    .map((e) => e.entrada.metodo)
    .filter((m): m is MetodoCambio => m !== 'GET');
  const unicos = [...new Set(de)];
  if (unicos.length === 1) return unicos[0]!;
  if (!unicos.length) return { motivo: `${r.path} no cambia nada (o no está en el mapa): para leerla usa panel.consultar.` };
  return { motivo: `Dime el metodo: ${r.path} se usa con ${unicos.join(' o ')}.` };
}

/** Todo lo que se comprueba antes de preparar y otra vez antes de hacer. */
function comprobarCambio(p: ParamsHacer, ctx: ContextoAccion): { r: RutaResuelta; metodo: MetodoCambio } | { motivo: string; ir?: string } {
  const metodo = metodoDe(p);
  if (typeof metodo !== 'string') return metodo;
  const r = resolverRuta(metodo, p.ruta, ctx);
  if ('motivo' in r) return r;
  const prohibido = campoProhibido(p.datos);
  if (prohibido) return { motivo: `El campo "${prohibido}" tiene que ver con claves o credenciales: eso no se cambia desde la IA.` };
  if (metodo === 'DELETE' && p.datos && Object.keys(p.datos).length) return { motivo: 'Un DELETE va sin datos: solo la ruta con el id.' };
  const faltan = (r.entrada.obligatorios ?? []).filter((k) => {
    const v = p.datos?.[k];
    return v === undefined || v === null || v === '';
  });
  // "texto" o "filas"/"personas": con uno basta (lo dice el body del mapa con "o").
  if (faltan.length) return { motivo: `Para ${r.entrada.para} falta: ${faltan.join(', ')}. Forma: ${r.entrada.body ?? '(sin datos)'}.`, ir: r.seccion.ir };
  return { r, metodo };
}

const panelHacer = def({
  nombre: 'panel.hacer',
  tipo: 'cambio',
  peligrosa: true,
  descripcion:
    'Hacer en el panel cualquier cambio del mapa (panel.mapa) que NO tenga una acción con nombre propio: POST/PUT/PATCH/DELETE a su ruta con sus datos, igual que el botón de la pantalla. Primero mira la ruta y la forma del body en panel.mapa; si hace falta un id, sácalo con panel.consultar. Nunca cuentas, claves ni conexión de WhatsApp.',
  parametros: 'metodo ("POST", "PUT", "PATCH" o "DELETE"; si la ruta solo tiene uno, se puede omitir), ruta (la del mapa con los ids puestos: "/admin/entregas/7/prioridad"), datos (el body como objeto, con la forma que dice el mapa; en DELETE va sin datos)',
  ejemplo: { orden: 'marca el pedido 7 como urgente', accion: { accion: 'panel.hacer', metodo: 'POST', ruta: '/admin/entregas/7/prioridad', datos: { urgente: true } } },
  schema: hacerSchema as unknown as z.ZodType<ParamsHacer>,
  async preparar(p: ParamsHacer, ctx): Promise<Preparado<ParamsHacer>> {
    const c = comprobarCambio(p, ctx);
    if ('motivo' in c) return { tipo: 'no', resumen: c.motivo, ir: c.ir };
    const { r, metodo } = c;
    const avisos: string[] = [];
    let antes: string | undefined;
    let aQuien: string | undefined;
    if (r.entrada.leer) {
      const urlLeer = r.entrada.leer.replace(/:([A-Za-z]+)/g, (_m, k: string) => r.params[k] ?? `:${k}`);
      const leido = await ctx.llamar({ method: 'GET', url: urlLeer }).catch(() => null);
      if (leido && leido.status === 404) return { tipo: 'no', resumen: `No existe (o ya no): ${r.path}. Mira el id con panel.consultar.`, ir: r.seccion.ir };
      if (leido && ok(leido)) {
        const { obj, encontrado } = elDeLaLista(leido.json, r.params);
        if (!encontrado && r.entrada.leer !== r.entrada.ruta && !r.entrada.leer.includes(':')) return { tipo: 'no', resumen: `No encuentro ese id (${Object.values(r.params).join(', ')}) en ${r.seccion.nombre}. Míralo con panel.consultar ${r.entrada.leer}.`, ir: r.seccion.ir };
        const limpio = limpiarDatos(obj);
        aQuien = nombreDe(limpio);
        antes = metodo === 'DELETE' ? (aQuien ? `existe: ${aQuien}` : 'existe') : antesDe(limpio, p.datos);
      }
    }
    if (metodo === 'DELETE') avisos.push('Es un BORRADO: no se puede deshacer desde aquí.');
    if (r.entrada.aviso) avisos.push(r.entrada.aviso);
    if (r.entrada.soloAdmin) avisos.push('Lo hace un administrador (tú lo eres).');
    avisos.push(`Por la misma ruta que la pantalla: ${metodo} ${r.url}`);
    const legible = bodyLegible(p.datos);
    const tarjeta: Tarjeta = {
      que: `${r.seccion.nombre}: ${r.entrada.para}`,
      ...(aQuien ? { aQuien } : Object.keys(r.params).length ? { aQuien: Object.values(r.params).join(' / ') } : {}),
      ...(antes ? { antes } : {}),
      despues: metodo === 'DELETE' ? 'borrado' : legible || 'se hace tal cual (sin datos)',
      avisos,
    };
    return { tipo: 'listo', params: { ...p, metodo }, tarjeta };
  },
  async ejecutar(p: ParamsHacer, ctx): Promise<ResultadoAccion> {
    // Los parametros vuelven del navegador: se comprueba todo otra vez.
    const c = comprobarCambio(p, ctx);
    if ('motivo' in c) return { ok: false, resumen: c.motivo, ir: c.ir };
    const { r, metodo } = c;
    const res = await ctx.llamar({ method: metodo, url: r.url, ...(metodo === 'DELETE' ? {} : { body: p.datos ?? {} }) });
    if (!ok(res)) return errorDe(res, `No se pudo: ${r.entrada.para}.`);
    return { ok: true, resumen: `Hecho: ${r.entrada.para}.`, datos: recortar(res.json, 2000), ir: r.seccion.ir };
  },
});

export const ACCIONES_GENERAL: Accion[] = [panelMapa, panelConsultar, panelHacer];
