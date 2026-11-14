# Plan de ejecución: chat temporal y menor carga de GSGchat

Fecha: 14/10/2026. Este documento es una especificación para implementar después de la aprobación del usuario. Su creación no autoriza desplegar ni publicar cambios.

## 0. Instrucciones para el modelo ejecutor

Trabaja en `work/gsgchat`, rama `developer`, dentro del workspace entregado. Lee este documento completo antes de modificar código. Comprueba `git status`, instrucciones AGENTS aplicables y las versiones reales de los archivos. Hay cambios locales anteriores, incluidos archivos nuevos sin seguimiento: debes conservarlos y continuar desde ellos. No hagas reset, checkout de archivos ni pull que los sobrescriba. No tomes HEAD como representación de la implementación local.

Implementa por las fases numeradas. Al terminar cada fase, ejecuta sus pruebas; resuelve sus fallos antes de avanzar. No sustituyas pruebas de comportamiento por comprobaciones de cadenas de texto. Actualiza contratos de repositorios, implementaciones SQL, repositorios en memoria, fakes y llamadas conjuntamente. No declares terminado un cambio que solo oculta controles y mantiene su carga automática.

No envíes mensajes a clientes reales, no llames a GSG real y no muestres claves. No cambies la identidad Git. No hagas commit, push, PR ni despliegue sin instrucción posterior. Si luego se autoriza publicar, usar Aliprogramator y ningún trailer Co-authored-by.

## 1. Resultado obligatorio

1. Una sesión web nueva empieza sin mensajes anteriores a ese login; una recarga conserva su alcance.
2. El navegador muestra únicamente conversaciones iniciadas por GSGchat dentro de esa sesión y sus respuestas visibles. Nunca importa el WhatsApp personal.
3. La base conserva mensajes de trabajo temporalmente, hasta 72 horas desde su incorporación al sistema. No se archivan ni se generan resúmenes de conversaciones.
4. Chat inicial: últimos 30 mensajes. Más mensajes: páginas de 30 al subir, siempre dentro del alcance de la sesión y de la retención.
5. Chat y errores se actualizan por eventos, sin polling normal de conversaciones completas. Los eventos no reemplazan ni duplican el envío real.
6. Un mensaje nuevo no reconstruye el hilo, no mueve al operador que está leyendo arriba y no sobrescribe el texto que está escribiendo.
7. Solo se procesan mensajes de texto, ubicaciones y controles necesarios para esos flujos. Se ignoran audio, foto, video, documento, sticker y contenido de una sola visualización antes de descargar, transcribir, registrar o llamar a IA.
   **Cambio del dueño (28/10):** las fotos, los audios y los videos SÍ se reciben y se guardan en el chat (con su archivo, 72 h como los mensajes) para que GSG los vea y los escuche desde el historial. No se transcriben, no se contestan y no mueven el pedido. Documentos y stickers se siguen ignorando antes de descargar. Ver `src/whatsapp/entradas-admitidas.ts` y `docs/CONEXION-GSG.md`.
8. No hay generación, escritura, consulta ni renderizado de notas internas por turno.
9. Se retiran de la web Plantillas, Ubicaciones, Chats guardados e Historial de mensajes. Se conserva Historial y errores como diagnóstico operativo, sin cuerpos de conversaciones y con incidencias agrupadas.
10. Se controla la concurrencia de operaciones costosas y se conservan las garantías de entrega, idempotencia y confirmación de ubicación.

### 1.1 Definiciones que no se deben confundir

- Sesión web: cookie de autenticación emitida por un login correcto. No es escanear QR, abrir `/chat`, recargar, recuperar una conexión SSE ni reiniciar el servidor.
- Alcance visual: particular de esa cookie. El login de un operador NO reinicia la vista de otros ni borra mensajes globales.
- Sesión de WhatsApp: vínculo del proveedor con una tienda. Mantiene su exclusión del historial personal, independientemente de los operadores conectados.
- Retención: 72 horas móviles por mensaje, no medianoche de Lima y no 72 horas desde el último login.
- Estado operativo: pedidos, trackings, coordenadas, intentos, vencimientos, aceptación del proveedor e idempotencia. Puede sobrevivir al mensaje temporal porque hace funcionar el servicio.
- Sin historial: no se crean archivos/exportaciones/copias específicas de chat ni se ofrece consulta de conversaciones vencidas. Los backups generales de base ya existentes no se borran silenciosamente; documentar su retención aparte.

Ejemplo obligatorio: login 14/10 10:00; mensaje 09:59 invisible; salida GSGchat 10:01 y respuesta 10:02 visibles. F5 a las 10:03 conserva ambos. Logout/login 10:04 vuelve a vista vacía. El bot sigue procesando una ubicación recibida a las 10:05 para un pedido previo, aunque ese pedido no pertenezca a la nueva vista. Una nueva salida del sistema a las 10:06 habilita ese chat en la vista nueva. El mensaje 10:01 vence el 15/10 10:01, no a medianoche.

## 2. Estado local verificado y componentes a reutilizar

No reimplementar estos componentes desde cero:

| Componente actual | Archivo | Situación / acción |
|---|---|---|
| Alcance persistido desde QR | `src/settings/service.ts`, `src/whatsapp/alcance-chat.ts` | `chat.vistaDesde`, `iniciarVistaChat`, `vistaChatDesde` existen. Separar corte de conexión del filtro visual por login. |
| Limpieza por cambio de día | `src/whatsapp/limpieza-chat.ts` | Ya elimina lotes de 1000 cada minuto. Cambiar a retención móvil y separar de los logins. |
| Índice por fecha | `db/migrations/008_chat_diario.sql` | Existe localmente. No editar una migración que pudiera estar aplicada; añadir la siguiente disponible. |
| Filtros SQL de chat | `src/db/messages.ts` | Excluyen `payload.historial` y autor `Teléfono`; conservar y centralizar. |
| Lecturas protegidas | `src/web/consultas.ts`, `src/web/cache-lectura.ts` | Deduplicación, AbortController, backoff, pausa oculta, ETag. Conservar para lecturas puntuales y fallback. |
| Chat actual | `src/admin/chat-routes.ts`, `src/web/chat-page.ts` | GET de hilo + notas usa `limit=80&decisiones=true`; cambiar. Hay paginación con `before`. |
| Bus por tienda | `src/eventos/bus.ts`, `src/eventos/observar.ts` | Ya existen eventos de mensajes, estado, ubicación y solicitudes. Reutilizar. |
| SSE público de integración | `src/api/v1/routes.ts` | `/api/v1/eventos/stream` existe; preservar contrato externo. Extraer utilidades seguras para el stream del panel. |
| Construcción por tienda | `src/plataforma/tienda.ts`, `src/server.ts` | Bus, repos observados, cola y provider por tienda. No crear un bus global compartido entre tiendas. |
| Colas de salida | `src/outbound/queue.ts`, `src/outbound/memory-queue.ts` | BullMQ ya tiene concurrencia 5 y límite 10/s; fallback en memoria serial. Auditar envíos directos que no pasan por worker. |
| Serialización por cliente / ráfagas | `src/handlers/inbound.ts`, `src/handlers/rafaga.ts` | Preservar orden y agrupación de 10 segundos. Un pin se atiende inmediatamente. |
| Filtro multimedia | `src/whatsapp/entradas-admitidas.ts` | Ya creado y aplicado localmente; verificar las tres entradas reales. |
| Sin importar historial local | `src/web/local-routes.ts`, `src/whatsapp/local/session.ts` | `importarHistorial:false`, `soloTextoUbicacion:true`, filtro previo a descarga. Conservar. |
| Desvincular WhatsApp | `src/web/connect-page.ts` | Ya en tarjeta principal; conservar. |
| Confirmación real | `src/entregas/confirmacion-ubicacion.ts` | Comprueba wamid y outcome; un reintento temporal explícito, sin repetir resultado incierto. Preservar. |

Base de validación anterior: 773 pruebas del perfil `test:release` aprobadas; compilación correcta; 12 pruebas SQL de chat/flujo GSG aprobadas en instancia privada. Esos resultados son antecedentes, no validación de los cambios futuros. Existen expectativas históricas obsoletas en `panel.test.ts`; reproducir y documentar la línea base, sin esconder fallos nuevos.

## 3. Fase A: alcance por login y retención de datos

### A1. Cookie firmada y marca de sesión

Modificar `src/auth/sesion.ts` y `src/auth/routes.ts`:

- Incorporar a la carga firmada `sid` aleatorio, `iat` en milisegundos y `chatAfterId` como cadena decimal no negativa. Conservar `u`, `v`, `exp`, HMAC, HttpOnly, SameSite y Secure actuales.
- `iat` es la hora del login exitoso. `chatAfterId` es `MAX(messages.id)` de ESA base/tienda, leído inmediatamente antes de firmar la cookie; si no hay mensajes, `0`.
- El watermark por ID evita perder mensajes del mismo segundo del login por la precisión del timestamp de WhatsApp. No usar exclusivamente `created_at >= iat`.
- Añadir a `MessagesRepo` una lectura `ultimoId(): Promise<string>`. No convertir IDs SQL bigint a un número inseguro de JavaScript. Si los contratos actuales usan números, validar el rango y mantener una representación consistente.
- Hacer `abrirSesion` asíncrono y esperarlo tanto en `/login` como en `/login/primera-cuenta`. Una contraseña incorrecta no cambia marcas ni sesión.
- Propagar un objeto `chatSesion: {sid, desde, afterId}` a `UsuarioSesion` al resolver la cookie. El cliente NO puede elegir el corte por query/body.
- Una cookie antigua sin estos campos no debe cargar historial sin filtro: para endpoints del chat del panel devolver 409 con `codigo: SESION_CHAT_REQUIERE_LOGIN` y `ir: /login`. El resto de la autenticación conserva su contrato. Después de actualizar, el operador entra otra vez.
- Las claves API y tokens embebidos NO se convierten artificialmente en una sesión web. Preservar sus permisos/alcance existentes, aplicando la retención temporal global a lo que pueda leerse de mensajes.
- En logout cerrar el stream de ese `sid` y limpiar el estado/caché del navegador. No borrar pedidos, mensajes de otros operadores ni vínculo de WhatsApp.

### A2. Un contrato de alcance centralizado

Crear `src/web/alcance-chat.ts` con un helper de alcance para el PANEL, separado del archivo homónimo de `whatsapp`.

Contrato propuesto:

```ts
type AlcanceChatPanel = {
  afterId: string;          // watermark firmado del login
  retenidosDesde: Date;     // ahora - 72 horas
  conexionDesde: Date | null; // corte de WhatsApp, sin redondear a medianoche
};
```

Condiciones obligatorias en SQL ANTES de ordenar/paginar:

1. ID del mensaje mayor que `afterId` para lectores del panel.
2. Fecha de incorporación del mensaje mayor que `ahora - 72h`.
3. No es historial importado ni mensaje propio del teléfono.
4. La conversación tiene una salida real de GSGchat con wamid válido dentro del mismo alcance; excluir marcadores `silencio:`/`regla-gsg:` y estados `failed`/`blocked_by_gate` para habilitar un chat nuevo.
5. La pertenencia a la tienda procede del contexto servidor, nunca de un parámetro libre.

Aplicar a lista, hilo, paginación, búsquedas, destacados, no leídos y lectura por ID usada por acciones del panel. Un ID conocido o un enlace directo no permite recuperar mensajes anteriores al login. Los datos operativos del pedido pueden seguir consultándose por sus permisos.

No pasar este alcance al handler del bot: las ubicaciones pendientes se procesan aunque todos los operadores hayan cerrado sesión. La admisión del contacto por WhatsApp debe basarse en solicitudes operativas activas o en un contacto iniciado por el sistema, no exclusivamente en que aún exista su primer mensaje en la tabla temporal.

En `settings/service.ts`, separar un getter puro del corte de conexión del getter actual que combina medianoche. Actualizar `whatsapp/alcance-chat.ts` para que no cambie su elegibilidad a medianoche ni al purgar mensajes. Mantener la prohibición de importar el historial personal desde la próxima vinculación.

### A3. Incorporación y expiración de mensajes

Agregar en una migración NUEVA, previsiblemente `009_chat_temporal.sql` si sigue libre:

- Columna `stored_at DATETIME(3)` en `messages`, usando la hora del servidor de base para inserciones nuevas. Backfill de filas existentes con `created_at`. Conservar `created_at` para el contrato de fecha original.
- Índice `messages_stored_idx(stored_at,id)` para la limpieza.
- Revisar con EXPLAIN si basta el índice actual por contacto; añadir `(contact_id,id)` solamente si las consultas con watermark lo requieren.
- No duplicar el índice ya añadido por 008 ni reescribir 001/008.
- Exponer `storedAt` en el modelo interno. Utilizarlo para retención y `expiresAt`, sin cambiar el significado de la fecha del proveedor.

El motor de limpieza:

- Corre cada 60 segundos y al arrancar, sin superponerse.
- En cada ejecución calcula un corte NUEVO `ahora - 72h`; retirar la optimización `terminadoHasta === desde` que asume un corte fijo por día.
- Ejecuta un lote de hasta 1000 filas ordenado por `(stored_at,id)`. Una pasada por minuto, sin bucles ilimitados que vacíen toda la tabla bloqueando el servicio.
- El API excluye el mensaje exactamente al vencer aunque la limpieza física ocurra en la siguiente pasada. Sin backlog, la eliminación física demora como máximo aproximadamente un intervalo de limpieza.
- Emitir una invalidación liviana si eliminó filas. El navegador tiene además un temporizador para la próxima expiración de los mensajes que mantiene visibles.
- No eliminar contactos, consentimiento, pedidos, coordenadas, próximos intentos ni estados de GSG. Actualizar no leídos y tarjetas a partir de mensajes aún visibles.
- Parar el timer y esperar la operación activa en `onClose`.

### A4. Idempotencia independiente del cuerpo del mensaje

Antes de activar el borrado físico, auditar TODAS las referencias a `messages.existsByWamid`, `payload.confirmacionUbicacion`, `listMessages` utilizadas para deduplicación y cierres. Hoy la confirmación mira hasta 100 mensajes previos; dejarla así sería una dependencia frágil de la tabla temporal.

Crear un repositorio de controles operativos mínimos, por ejemplo `src/db/controles-whatsapp.ts`, respaldado por tabla propia:

- Clave única por tienda implícita/base, proveedor y wamid para recepción.
- Clave única para confirmación: solicitud o conjunto estable de solicitudes/trackings, tipo de confirmación y alcance de negocio que ya usa el flujo actual. No deduplicar solo por teléfono: bloquearía pedidos nuevos.
- Campos mínimos: clave/hash, tipo, referencia operativa, estado `procesando|aceptado|fallido|incierto`, wamid saliente si existe, fechas y vencimiento. Sin cuerpo del mensaje, transcripción ni explicación por turno.
- Reservar de forma atómica antes de ejecutar una acción duplicable. Confirmar `aceptado` solo con outcome real; no convertir un resultado incierto en un fallo reintentable.
- Mantener el comportamiento actual de un reintento temporal explícito de confirmación y silencio tras resultado incierto.
- Conservación inicial de controles: 7 días, con limpieza por índice; justificar que cubre la ventana de reentregas/reintentos configurada. Si una cola puede reintentar después, ampliar esa retención o acortar esa cola de forma coherente.
- Estado de pertenencia al flujo/solicitud activa y confirmación pendiente vive con el pedido, no expira porque se borró un texto.

Antes de limpiar mensajes existentes, inicializar los controles necesarios desde estados/payloads actuales para solicitudes abiertas. Hacerlo por lotes e idempotentemente. Probar pin tardío, reinicio y tracking nuevo después de purgar el mensaje original.

## 4. Fase B: eliminar notas y módulos solicitados

### B1. Notas internas

Buscar `repos.decisiones`, `DecisionBot`, `resumenDecision`, `decisiones=true` y todos los renderizadores de notas. Revisar como mínimo `handlers/inbound.ts`, `ia/servicio.ts`, `ia/agente-operativo.ts`, `admin/chat-routes.ts`, `web/chat-page.ts` y `db/repos.ts`.

- Retirar la construcción y escritura del diagnóstico por turno. No reemplazarlo por otro insert/log informativo para cada mensaje.
- Retirar consultas, serialización y renderizado de decisiones. El chat no solicita `decisiones=true`.
- Si hay consumidores internos incompatibles con borrar inmediatamente la interfaz, mantener temporalmente un repositorio no-op claramente documentado, sin SQL y sin memoria creciente. No dejarlo como solución final si ya no hay consumidores.
- Mantener clasificación y reglas del bot: eliminar el registro no debe eliminar `decidir`, extracción de ubicación ni selección de respuesta.
- Mantener la comprobación real de envío y fallos; que desaparezca la nota no significa que se pueda cerrar un chat tras un envío rechazado.
- Datos antiguos de `decisiones_bot`: dejar de exponerlos desde el primer despliegue y limpiarlos por lotes. No hacer un DROP/TRUNCATE masivo en la migración de arranque.

### B2. Retirada de módulos, incluidos accesos secundarios

| Retirar de la web | Archivos/puntos mínimos | Mantener internamente |
|---|---|---|
| Plantillas | `web/shell.ts` (menús y buscador), `web/pages.ts` (`tab-plantillas`, función y cargas), enlaces de ayuda y chat | Repositorio/selección de textos y plantillas de Meta que necesite el sender. No sustituir por texto libre fuera de la ventana permitida. |
| Ubicaciones | `/mapa` en `web/routes.ts`, navegación lateral y móvil en `shell.ts`, enlaces/acciones IA hacia el módulo | Recepción de pin/link, validación, coordenadas por tracking y callback de GSG. Un enlace de mapa de un pin en el chat puede seguir funcionando. |
| Chats guardados | `/guardados`, `admin/archive-routes.ts`, archivos `web/*archive*`/`archive/*`, búsqueda, ficha y acciones de IA | Ningún archivador automático ni resumen de chat. No cargar archivos antiguos. |
| Historial de mensajes | Exportación/búsqueda de conversaciones antiguas y acciones de IA que lean archivos | Historial y errores operativo, sin texto conversacional. |

Rutas de página antiguas: `/mapa` redirige a `/hoy`, `/guardados` a `/chat`; hash `#plantillas` se normaliza a `#inicio`. APIs exclusivas de archivo del panel: devolver 410 `MODULO_RETIRADO` o no registrarlas y aceptar 404, escogiendo una política uniforme y probándola. No retirar por accidente `/api/v1/entregas`, coordenadas, webhooks ni plantillas internas de integración.

Auditar `src/ia/acciones-chats.ts`, `acciones-mensajes.ts`, `acciones-panel.ts`, `acciones-informes.ts`, ayudas y catálogo de acciones: el asistente del panel no debe recuperar archivos, abrir módulos retirados ni crear un resumen alternativo permanente. Revisar también cómo se construye el contexto/memoria de IA: únicamente mensajes temporales válidos, sin archivos antiguos.

No borrar automáticamente copias/adjuntos antiguos del disco. Inventariar referencias y proponer una limpieza separada de datos legados; retirar desde ya sus lecturas/importación. Documentar que datos antiguos inaccesibles aún pueden existir hasta esa limpieza.

Revisar `src/respaldo/servicio.ts`: los NUEVOS respaldos/exportaciones automáticos no deben convertir `messages`, `decisiones_bot` o payloads temporales del inbox en un historial permanente. Excluir esos datos efímeros del respaldo lógico generado por la aplicación, conservando esquema, pedidos, coordenadas y controles operativos. Si el respaldo actual copia físicamente toda la base y no admite exclusiones, documentar y resolver ese punto antes de afirmar «sin historial»; no desactivar el respaldo de pedidos. Las copias antiguas requieren una decisión de limpieza independiente, sin borrado silencioso.

### B3. Multimedia

Verificar filtro en webhook Meta, webhook WAHA, socket local y entrada central `handleInboundMessage`. Debe estar antes de upsert de contacto, carga de mensajes, descarga, marcado de ráfaga e IA.

- Admitir texto y pin/location/live-location. Botones/listas necesarios para texto/ubicación, recibos de estado, revocaciones y reacciones siguen como controles, sin crear llamadas a IA por sí solos.
- Rechazar audio/image/video/document/sticker/view-once. Ninguna descarga de medio ni transcripción. Ignorar un audio no consume un intento, no cambia `nextAttemptAt` y no genera respuesta.
- `soloTextoUbicacion:true` e `importarHistorial:false` deben estar activos en las llamadas reales de producción, no solo en tests.
- No renderizar ni precargar medios antiguos, vistas previas de URLs, stickers o micrófono. Los servicios multimedia explícitos de integración externa no se eliminan en este alcance; no deben ser invocados por el chat/bot automáticamente.
- En WAHA verificar la configuración real del motor: evitar descargas de medios del propio proveedor si permite desactivarlas. No inventar opciones de WAHA; inspeccionar el contrato/versión disponible y dejar documentada cualquier limitación del proveedor.

## 5. Fase C: lectura incremental y DOM estable

### C1. Contratos HTTP del panel

Conservar los campos existentes que aún usa la interfaz y agregar datos de paginación/alcance. Validar con Zod, usando enums para booleanos; no `z.coerce.boolean()` para la cadena `false`.

| Ruta | Contrato nuevo |
|---|---|
| `GET /admin/chat/conversations?limit=30&offset=0&q=...` | Página de contactos visibles y no leídos del alcance; máximo 100. No cargar de golpe los mil clientes. Agregar `hasMore`/siguiente página. Reiniciar paginación al buscar/cambiar filtro. |
| `GET /admin/chat/:id?limit=30&before=<id>&read=false` | Últimos 30 o anteriores al cursor; máximo 100. Responder `messages`, `hasMore`, cursor previo y `scopeId`. Aplicar alcance antes del limit. Consultar 31 y devolver 30 para calcular `hasMore` sin COUNT completo. |
| `POST /admin/chat/:id/sync` | Lectura sin efectos de envío. Body `{afterId:string, knownIds:string[]}`; máximo 300 conocidos. Devuelve nuevos mensajes `id>afterId` (hasta 30), filas actuales de conocidos, IDs ya no visibles, `hasMoreNew` y cursor. Permite recuperar estados/revocaciones/ediciones tras desconexión. |
| `POST /admin/chat/:id/read` | Reutilizar ruta existente equivalente si la hay; marcar lectura solo al abrir o recibir visibles en el chat activo. Un evento de estado/heartbeat no escribe lectura. |

`sync` debe consultar solo IDs del contacto y del alcance autenticado, con parámetros SQL y límites. No confiar en IDs suministrados. Si llegan más de 30 nuevos, continuar por cursor, secuencialmente, sin saltar al máximo global antes de terminar. El cursor de nuevos IDs no cambia por una página antigua cargada al subir.

Exponer `expiresAt = storedAt + 72h` para retirar mensajes vencidos sin esperar un evento nuevo. Reconciliar también metadatos del contacto/reparto que realmente cambien. Conservar ETag para lecturas puntuales y fallback, sin presentarlo como ahorro de consultas SQL.

### C2. Actualización del navegador

Modificar `web/chat-page.ts`, `chat-menu.ts`, `chat-compositor.ts`:

- Estado por `scopeId` y contacto: mapa por ID, cursor de nuevos, cursor de anteriores, `hasMore`, petición activa y generación de vista.
- `renderMessages` deja de asignar todo `box.innerHTML` ante cada cambio. Crear/update/remove de nodos por `data-message-id`; un recibo actualiza solo el estado del nodo.
- Al cambiar de contacto/filtro, abortar o invalidar respuestas antiguas. No permitir que una respuesta del contacto anterior pinte el actual.
- Al subir: una petición, página de 30; conservar el primer mensaje visible y su offset. Tras prepend restaurar el ancla, usando la diferencia de altura como respaldo.
- Si el operador está cerca del final (umbral actual de aproximadamente 120 px), seguir al final al llegar un mensaje. Si está arriba, conservar posición y mostrar contador «N nuevos».
- No tocar input, selección, menús ni foco por una actualización. Al enviar, reconciliar burbuja optimista con ID real sin duplicarla cuando llegue el evento.
- Mantener un máximo inicial de 300 nodos por hilo en memoria/DOM. Al cargar más, evacuar páginas del extremo opuesto y conservar cursores/ancla; permitir volver a pedirlas dentro del alcance. No retener mapas ilimitados por mil contactos.
- Ocultar/expirar por ID sin volver a cargar todo el hilo. Si el mensaje ancla vence, usar el siguiente visible.
- Limpiar mapas, ETags y peticiones al logout o cambio de `scopeId`. No persistir cuerpos en localStorage, IndexedDB o service worker.

## 6. Fase D: eventos del panel y eliminación del polling normal

### D1. Stream autenticado del panel

Crear `src/web/eventos-panel-routes.ts` y registrar `GET /admin/panel/eventos` desde `server.ts`. Reutilizar el bus de la tienda y utilidades del SSE existente; NO ampliar el stream público para transmitir incidencias administrativas a clientes embebidos.

- Autenticación por cookie de misma procedencia, rol/permisos del panel y `chatSesion`. No poner API keys en URL. Rechazar 401/403 antes de hijack/headers de stream.
- Cabeceras `text/event-stream`, `no-store`, `X-Accel-Buffering:no`. Latido comentario cada 25 segundos: no consulta DB, no emite actualización de interfaz.
- Un hub por tienda se suscribe al bus una vez. Cada conexión SSE se suscribe al hub; no añadir varios listeners al bus por cada cliente hasta superar el límite actual de 50.
- Eventos del panel: `panel.ready`, `chat.changed`, `chat.status`, `incidents.changed`, `whatsapp.changed`, `chat.expired`, `panel.resync`. Campos mínimos: versión, epoch del proceso/hub, secuencia, contactId/messageId/wamid cuando exista y fecha. Sin payload completo de conversación ni claves.
- El bus actual de integración no siempre lleva ID interno ni contacto en `mensaje.estado`. Resolver esa asociación UNA vez por cambio, fuera del bucle de conexiones. No hacer una consulta por cada navegador suscrito. Mantener el contrato externo actual de los eventos existentes.
- Emitir después de confirmar la escritura. Un fallo SSE nunca revierte un mensaje guardado ni cambia la respuesta de WhatsApp.
- Mensajes con alcance visual anterior: no mandar contenido. El endpoint de lectura vuelve a autorizar. Filtrar identidad/tienda en el hub; nunca mezclar tiendas.
- Si `raw.write()` indica backpressure, no acumular sin límite: buffer máximo por conexión 64 KiB; cerrar y solicitar resync al reconectar. Gestionar drain/close/error y retirar listeners/timers exactamente una vez.
- Expiración de cookie: cerrar al llegar `exp`. Revisar usuario activo/version de sesión cada 60 s como máximo una vez por usuario en el hub, no una consulta por latido/conexión. Logout del mismo sid cierra sus streams. Password/desactivación invalida como máximo al siguiente chequeo.
- En el proxy de plataforma comprobar que el stream llega en tiempo real: sin buffering ni timeout corto. Probar el recorrido completo, no solo Fastify aislado.

No ofrecer replay duradero de contenido de chat. `id` SSE usa `epoch:sequence`; `Last-Event-ID` sirve para detectar huecos, no para prometer recuperación desde memoria después de reiniciar. En cada conexión/reconexión, emitir `panel.resync`; el cliente reconcilia su página visible y sus mensajes conocidos. Con esto no se necesita una tabla permanente de eventos.

### D2. Cliente único y coalescencia

Crear `src/web/eventos-panel.ts` con un cliente compartido por la página, instalado desde `shell.ts`. Una EventSource por documento; chat y errores reutilizan esa conexión. No crear una conexión por burbuja/contacto.

- Abrir al entrar en una pantalla interesada. Cerrar al ocultarse la pestaña y al logout. Al volver, reconectar y hacer una sola reconciliación.
- Inicialización sin huecos: conectar stream, esperar ready, cargar snapshot mientras se acumulan invalidaciones y reconciliar lo ocurrido durante la carga.
- Agrupar eventos durante 250 ms por contacto/sección. Una sincronización activa como máximo; si llega otro cambio durante ella, marcar dirty y hacer una continuación al terminar. No Promise.all sin límite.
- Un cambio de otro chat actualiza la lista, no vuelve a cargar el hilo seleccionado.
- El cliente combina IDs de nuevas burbujas con `knownIds` sin comparar cadenas lexicográficamente: usar comparación decimal segura/BigInt internamente. Nunca ordenar `"100"` antes de `"99"` por comparación de texto.
- Una recepción de API/error invalida solo la sección interesada. Si Historial y errores no está visible, marcar dirty y consultar al entrar.
- Durante conexión SSE sana: cero polling periódico de conversations/hilo/deliveries/recepciones. Retirar el sondeo de chat de 15 s y evitar duplicación con globos/avisos del shell.
- Los estados IA/salud sin eventos propios pueden consultarse espaciadamente y solo en su pantalla. Inventariar los sondeos de 60 s de `shell.ts`; no conservar avisos/no-leídos duplicados si el hub ya los actualiza. El QR puede mantener su consulta temporal mientras espera vinculación; detener al conectar/salir de setup.
- Al fallar SSE: backoff con jitter 2, 5, 10, 30 y máximo 60 s para reconectar. Sin dos reconexiones simultáneas.
- Fallback de lecturas: solo si el stream sigue caído, pantalla visible, una actualización por minuto como máximo, usando `leerPanel`. Detenerlo al recuperarse SSE. Los errores siguen el backoff existente hasta 120 s y Retry-After. Con 401/409 de sesión: cerrar y pedir login; no bucle de reintentos.

## 7. Fase E: errores agrupados sin perder auditoría de pedidos

El historial actual lee `GET /admin/deliveries` y `GET /admin/gsg/recepciones`. Las recepciones se registran como `gsg.api.recepcion` en actividad desde `api/v1/entregas-gsg.ts`. No agrupar indiscriminadamente pedidos diferentes ni cambiar los códigos HTTP del endpoint.

Crear repositorio/tabla `incidencias_operativas`, en migración siguiente, con:

```text
id, fingerprint UNIQUE, origen, codigo, referencia_operativa,
estado(abierta|resuelta), cantidad, first_at, last_at,
detalle_resumido, resuelta_at
```

- Fingerprint SHA256 de dimensiones estables: origen + código + proveedor + endpoint normalizado + tipo/id de entidad + ciclo/operación. La tienda está aislada por base. No usar el texto libre, timestamp ni error stack como clave.
- Error genérico de conexión: agrupar por conexión/proveedor. Error de un pedido/track diferente: grupo diferente. Nueva operación después de resolver: reabrir explícitamente el grupo y actualizar sus fechas, o usar ciclo nuevo; escoger la primera opción y probarla.
- UPSERT atómico: contador +1, last_at actualizado, detalle recortado (máximo 500 caracteres, sin secretos ni cuerpo de mensajes). No SELECT seguido de INSERT vulnerable a carrera.
- Índices para `(estado,last_at,id)` y fecha de limpieza. Retención operativa inicial: 30 días para grupos resueltos; abiertos permanecen hasta atenderlos. No convertir esta tabla en historial conversacional.
- Persistir una incidencia real; no registrar fallos por cada lectura del navegador ni por cada heartbeat. El contador cuenta ocurrencias de la operación de backend, no visitas de operadores.
- Emitir `incidents.changed` con ID/grupo, después de la escritura; el hub agrupa notificaciones durante ráfagas.
- Conservar ledger de entregas/resultados por tracking necesario para reintentos y reporte GSG. La tabla agrupada es la vista de incidencias, no sustituye esa auditoría.
- Las recepciones exitosas muestran metadatos paginados, sin cuerpos ni texto de WhatsApp. Errores repetidos de validación pueden agruparse por contrato/campo y referencia cuando corresponda; nunca sumar dos pedidos distintos como una sola operación reintentable.

HTTP del panel: añadir `GET /admin/incidencias?estado=abierta&limit=30&before=<cursor>` y una acción de resolver si hace falta. Cursor `(last_at,id)`, 31 filas para hasMore. Historial y errores carga incidencias y metadatos de recepciones solo al entrar, cambiar filtro, pulsar Actualizar o recibir invalidación relevante. Conservar filas por ID sin sustituir toda la tabla mientras se usa.

No registrar dos veces el mismo fallo desde wrapper + handler + worker. Definir un propietario por origen y probar que un intento fallido incrementa exactamente una vez.

## 8. Fase F: colas y concurrencia limitada

Primero inventariar qué llamadas pasan por `OutboundQueue` y cuáles llaman directamente a `sender.send`. Ya hay cola; añadir otra sin integrar las llamadas directas no resolvería el problema.

### F1. Límites iniciales configurables por tienda

- Envíos efectivos al proveedor: 2 simultáneos y como máximo 2 comienzos por segundo.
- Consultas IA: 2 simultáneas.
- Callbacks a GSG: 4 simultáneos.
- Pool SQL: respetar el límite existente y medirlo; no abrir una conexión nueva por mensaje/evento/navegador.

Estos son valores de arranque para pruebas, no una afirmación de la capacidad real del servidor. Añadir validación de enteros positivos y límites razonables en `config.ts`; pasar los valores en `plataforma/tienda.ts`.

Usar una utilidad de semáforo/rate limiter compartida por los caminos reales de cada tienda. En el sender aplicar el límite al envío externo efectivo para cubrir worker y llamadas directas; no adquirir el mismo semáforo dos veces en una llamada. En BullMQ configurar la concurrencia/ritmo coherentemente; nunca hacer que un worker espere un trabajo encolado en su propia cola.

La ráfaga de 10 segundos y las esperas hasta el siguiente recordatorio NO ocupan un permiso de envío/IA. Adquirir justo antes del trabajo costoso y liberar en finally. Conservar la serialización por teléfono para que dos respuestas/ubicaciones no corran a la vez sobre el mismo pedido.

### F2. Trabajo recibido y recuperación

No limitarse a poner mil promesas esperando en memoria. Para entrada admitida de Meta/WAHA crear una bandeja persistente de trabajo en SQL, o reutilizar un mecanismo duradero equivalente ya presente si el inventario demuestra que lo hay:

- Clave única proveedor+wamid, payload normalizado mínimo texto/ubicación, estado pendiente/procesando/hecho/fallido, intentos, disponible_at, lease_until, fechas. Sin blobs/base64.
- Confirmar el webhook después de validar autenticidad y persistir/encontrar el trabajo. Si falla la persistencia, responder 503 para que el proveedor reentregue. No responder 200 antes de almacenar y depender exclusivamente de `setImmediate`.
- Socket local: persistir desde su callback antes de devolverlo. No incorporar medios ni historial al inbox.
- Worker por tienda, orden por teléfono y claim atómico. Para compatibilidad MySQL/MariaDB usar transacción/CAS `UPDATE ... WHERE estado=pendiente` y comprobar affectedRows; no asumir soporte de SKIP LOCKED sin comprobar versión.
- Límite inicial de trabajos inbound activos: 20 por tienda, configurable. Los restantes permanecen en SQL. Los límites efectivos IA/envío/GSG siguen siendo los definidos en F1. No crear un timer/closure individual por cada fila pendiente.
- Lease recuperable al reiniciar; un trabajo repetido consulta el control de idempotencia antes de mandar. No hacer que la reserva duplicada impida recuperar un lease propio abandonado.
- No tener un timer que recorra todo el inbox muchas veces por segundo: despertar al insertar, y barrido de recuperación por índice cada 30 s. Un solo drenador por tienda, con límite de trabajos activos.
- Borrar payload al completarse; conservar únicamente dedup/control mínimo. Payload pendiente vence en 24 h; si no se procesa, generar una incidencia operativa, eliminarlo y no reprogramar silenciosamente un mensaje viejo.
- La cola normal de pendientes vive en SQL, no en un array de miles de closures. Métricas mínimas: pendientes, activos, más antiguo y duración, sin contenido del cliente.

La forma de agrupar texto en ráfagas debe mantenerse: un worker serial que espera 10 s con el primer mensaje no debe impedir que los siguientes se registren/marquen como llegados. Registrar llegadas antes de esperar y probar cuatro textos seguidos con una respuesta única. No envolver ciegamente todo el handler actual en un semáforo que se quede ocupado durante el debounce.

Precisar la integración del inbox con `marcarLlegada`/`juntarRafaga`: las entradas todavía no procesadas deben participar en el cálculo del último texto del teléfono. Al reiniciar reconstruir esa marca desde las entradas pendientes de ese teléfono antes de drenar su grupo. Un texto omitido por debounce se incorpora una sola vez al hilo/contexto temporal y queda finalizado; no se pierde ni se convierte después en una segunda respuesta. Pins y recibos de estado no esperan a completar una ráfaga textual. Probar este comportamiento tanto con el proceso vivo como reiniciando a mitad de los cuatro mensajes.

Reintentos de una misma operación: conservar la política explícita del flujo. No sumar los cinco intentos de BullMQ a un helper que ya hizo su reintento. Revisar `attempts:5` y `maxAttempts:5` actuales y parametrizar por tipo de operación si es necesario. Confirmación: máximo un reintento adicional tras fallo temporal definitivo del intento; resultado incierto no provoca reenvío automático. Límite de recordatorios es el configurado por el usuario, nunca ilimitado.

La cola en memoria sigue disponible en desarrollo, pero no declarar durabilidad de salida con ella. Documentar la necesidad de Redis para trabajos de salida que no tengan otro respaldo persistente. No introducir un fallo silencioso si Redis no está disponible.

### F3. Límite de la arquitectura

Actualmente cada tienda construye su bus y servicios en el proceso que la atiende. Esta entrega se valida con UN propietario de WhatsApp/workers por tienda. Si el despliegue ejecuta varios procesos para la misma tienda, no usar buses/semáforos locales como si fueran globales: resolver antes la propiedad única o incorporar fanout y límites distribuidos con Redis. No desplegar varias réplicas con eventos incompletos o doble conexión WhatsApp.

## 9. Orden de implementación y puertas de validación

1. Inventario y baseline, sin modificar producción. Guardar informe de tests existentes y contratos tocados.
2. Contratos de alcance/retención, nuevas migraciones y controles de idempotencia. Probar SQL antes de habilitar limpieza.
3. Login y filtros de sesión. Tests de dos operadores, mismo segundo, recarga y login nuevo.
4. Limpieza móvil de 72 h y supervivencia de controles operativos. Tests con reloj controlado y reinicio.
5. Retirar notas/módulos/multimedia. Tests de que no existe escritura/consulta ni descargas, y confirmación real intacta.
6. Lectura de 30, paginación, sync y DOM incremental. Mantener polling antiguo solo hasta validar esta etapa; luego retirarlo con SSE.
7. Hub/SSE y cliente compartido, recuperación y fallback. Probar por el proxy de plataforma.
8. Incidencias agrupadas y actualización por evento. Verificar conteo de ocurrencias y separación por pedido.
9. Límites de concurrencia e inbox recuperable. Probar caída/reinicio y ráfagas.
10. Integración, carga, revisión y documentación final. No desplegar con una fase incompleta.

## 10. Pruebas obligatorias y criterios de aceptación

Crear o ampliar suites por comportamiento, incluyendo `tests/fakes-messages.ts`, fakes de repos y fixtures reales de entregas. No desactivar globalmente tests de módulos retirados: actualizar expectativas al nuevo contrato y registrar los históricos ajenos al alcance.

### Sesión y retención

- Mensaje anterior al login invisible en lista/hilo/búsqueda/destacados/acceso por ID; uno insertado después, en el mismo segundo, visible si corresponde al flujo.
- F5, otra pestaña con la misma cookie y reinicio conservan el corte; nuevo login lo renueva. Otro operador no cambia su vista.
- Cookie legacy recibe 409 del chat; cookie falsa/expirada recibe 401. La query no puede ampliar el corte.
- A las 71:59:59.999 de edad el mensaje es visible; al cumplir 72 h deja de serlo. Medianoche no es una frontera especial.
- Limpieza de 2500 mensajes: lotes 1000/1000/500 en pasadas, sin solapamiento. Sobreviven mensajes recientes y todos los pedidos/coords/estados necesarios.
- Eliminar el primer mensaje no bloquea ubicación tardía ni provoca otra confirmación. Reentrega del mismo wamid después de la purga y de reiniciar no vuelve a actuar.

### Funcionalidad que debe sobrevivir

- Pedido único y pedidos agrupados de importes 0 y 200 con distinto tracking al mismo número.
- Tracking nuevo en otro lote recibe su primera solicitud; no lo bloquea un pedido anterior.
- Ubicación recibida tras el máximo de intentos se guarda, se reporta y se confirma realmente.
- Fallo temporal de confirmación: un reintento. Resultado incierto: sin duplicado. Una respuesta vacía nunca se envía.
- Cualquier texto sin ubicación mientras se espera pin guarda silencio; no cambia intervalo, intentos ni máximo. Pin y enlaces válidos siguen funcionando.
- Cuatro textos seguidos: agrupación de 10 s después del último, una sola respuesta cuando corresponda al flujo IA.
- Un audio no crea contacto/mensaje/nota, no descarga, no transcribe, no llama IA, no responde y no altera el recordatorio.
- Desvincular WhatsApp funciona con cancelación, fallo y cierre real; login/logout web no desvinculan WhatsApp.

### HTTP, SSE y navegador

- 30 iniciales y páginas anteriores de 30, orden estable, sin duplicados ni salto de cursores.
- Evento de mensaje: una sincronización coalescida; estado: actualiza el nodo existente. Evento duplicado: sin burbuja repetida.
- Durante carga inicial y durante desconexión entran mensajes y estados: al reconectar aparecen todos y se actualizan los conocidos.
- Evento de otra tienda/contacto fuera de alcance no filtra datos; todos los endpoint reautorizan.
- Stream cerrado libera timers/listeners; simular decenas de aperturas/cierres sin crecimiento permanente.
- Stream lento no acumula memoria sin límite. Heartbeat no hace SQL ni vuelve a pintar.
- En 10 minutos sin actividad y con SSE sano: CERO lecturas periódicas de hilo/lista/deliveries/recepciones después de la carga inicial. Se permiten latidos y chequeo de autenticación limitado descrito arriba.
- Ocultar pestaña detiene stream/fallback; volver produce una sola reconciliación. SSE sano y fallback nunca trabajan a la vez.
- Subir y mantener un mensaje ancla, recibir mensajes/estados y comprobar que sigue visible en la misma posición. Input, selección y foco permanecen.
- Ejecutar JavaScript generado de chat/panel/conexión y verificar comportamiento en navegador real; TypeScript no valida el JS dentro de String.raw.
- Navegación lateral/móvil, buscador, ayuda y acciones IA sin módulos retirados. Requests manuales a sus rutas siguen la política definida.

### Incidencias, cola y carga

- 100 fallos de una operación: una incidencia con cantidad 100; dos trackings distintos: dos grupos. Dos escrituras simultáneas no crean dos grupos.
- Un fallo registrado por el worker no se vuelve a contar en el wrapper. Consultar la página no incrementa el contador.
- Durante 100 envíos/llamadas simuladas: máximo 2 envíos simultáneos, 2 IA y 4 callbacks GSG; rate de comienzos de envío <=2/s. Liberación correcta tras timeout/error.
- Repetir webhook: un trabajo y una acción efectiva. Reiniciar entre persistencia y ejecución recupera el pendiente. Reiniciar con resultado incierto no reenvía a ciegas.
- Firma inválida se rechaza sin persistir. DB caída devuelve 503 antes del ACK, sin perder trabajo aceptado.
- Carga controlada: 1000 contactos, 3000 mensajes (2000 texto/1000 ubicación) distribuidos entre ellos, mezcla de recibos, 10 clientes de panel, y un escenario adicional de ráfaga de 1000 pedidos. WhatsApp, IA y GSG simulados con latencias configuradas y fallos temporales; cero servicios reales.
- La prueba no tiene que esperar un día real: reloj inyectable para retención; usar reloj real para medir rendimiento/event loop. No presentar el tiempo de un fake instantáneo como capacidad productiva.
- Registrar CPU, RSS, event-loop delay, número/tiempo de SQL, conexiones, bytes HTTP, consultas de panel y cola antes/después en el mismo entorno. Criterios funcionales duros: sin pérdidas/duplicados, límites cumplidos, cero polling normal. Umbrales de latencia/RAM se fijan a partir del hardware y baseline; no inventar capacidad garantizada para un servidor desconocido.
- Objetivo de actualización con mocks de baja latencia: cambio visible p95 <=2 s sin contar debounce de IA ni demoras externas. Si no se cumple, adjuntar medición y causa; no ocultarlo.

### Comandos finales

Desde `work/gsgchat`:

```powershell
npm run build
npm run test:release
npm run test:release:sql
git diff --check
```

Añadir suites nuevas al perfil activo. SQL requiere una base de pruebas aislada y migrada; no usar la base real ni borrar XAMPP/servicios del usuario. Revisar los resultados: un test SQL saltado por falta de DB no cuenta como aprobado. Ejecutar además las suites nuevas de sesión, eventos, inbox, incidencias y carga. Guardar informes en `outputs/`, fuera de datos productivos.

## 11. Archivos previstos y entregables

Modificar como mínimo: `src/auth/sesion.ts`, `auth/routes.ts`, `db/messages.ts`, `db/repos.ts`, `settings/service.ts`, `whatsapp/alcance-chat.ts`, `whatsapp/limpieza-chat.ts`, `whatsapp/webhook.ts`, `whatsapp/waha/webhook.ts`, `web/local-routes.ts`, `whatsapp/local/session.ts`, `handlers/inbound.ts`, `ia/servicio.ts`, `ia/agente-operativo.ts`, `admin/chat-routes.ts`, `web/chat-page.ts`, `web/chat-menu.ts`, `web/chat-compositor.ts`, `web/shell.ts`, `web/pages.ts`, `web/routes.ts`, `api/v1/entregas-gsg.ts`, `eventos/observar.ts`, `entregas/confirmacion-ubicacion.ts`, `outbound/sender.ts`, `outbound/queue.ts`, `outbound/memory-queue.ts`, `plataforma/tienda.ts`, `server.ts`, `config.ts`, `package.json` y fakes/tests asociados. Revisar acciones IA/archive/backup según referencias encontradas.

Archivos nuevos propuestos: alcance del panel, hub/route SSE, cliente SSE, controles WhatsApp, inbox persistente, incidencias operativas, limitador y migraciones/tests. Los nombres propuestos no sustituyen el inventario: adaptar si ya existe un componente equivalente.

La estimación anterior de 20–35 archivos era preliminar: con auth, idempotencia persistente, recuperación de colas y pruebas, esta especificación puede superar ese rango. No recortar garantías para cumplir un conteo de archivos.

Al finalizar entregar:

1. Relación de cambios y rutas retiradas; lista de migraciones en orden.
2. Resultados exactos de build, pruebas activas, SQL y navegador; separar fallos históricos de regresiones nuevas.
3. Informe de carga antes/después con entorno y límites usados.
4. Confirmación de que no se llamó a WhatsApp/GSG reales.
5. Datos temporales/control conservados, sus retenciones y datos legados pendientes de limpieza.
6. Instrucciones de despliegue: copia operativa previa, migraciones, un propietario por tienda, proxy SSE, login nuevo y verificación de exclusión del historial personal. QR nuevo solo si falta activar el corte de conexión; no pedir QR por cada login web.
7. Limitaciones: sin Redis no prometer persistencia de la cola en memoria; sin acceso a GSG no certificar su interfaz; sin prueba real autorizada no certificar entrega en teléfonos.

No marcar terminado mientras haya polling normal oculto, notas todavía insertándose, mensajes anteriores recuperables por una ruta secundaria, confirmaciones dependientes de cuerpos ya purgados o una cola que pueda repetir un resultado incierto.
