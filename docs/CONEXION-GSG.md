# Conexión con GSG

Hay dos conexiones y dos claves distintas. No se mezclan.

| | Saliente: GSGchat → GSG | Entrante: GSG → GSGchat |
|---|---|---|
| Para qué | GSGchat le manda a GSG cada ubicación (y el resto de reportes) | GSG nos manda los pedidos del día |
| Quién genera la clave | **GSG** | **GSGchat** (Conexión → «Crear la clave para GSG») |
| Dónde se guarda | En GSGchat: pantalla Conexión (cifrada) o `GSG_API_KEY` en el `.env` de GSGchat | En el `.env` **de GSG**, no en el de GSGchat |
| Cabecera | `X-API-Key: <clave de GSG>` | `X-API-Key: <clave de GSGchat>` |

En las dos, la clave va en la cabecera `X-API-Key`. Nunca va en la URL ni en el cuerpo.

GSGchat **nunca le pide nada a GSG**: ni la lista del día (no existe `GET /reparto/pendientes`), ni de forma automática cada pocos minutos, ni con un botón, ni al probar la conexión, ni para verificar el contrato o cerrar el día. Los pedidos entran solo cuando GSG los manda a `POST /api/v1/entregas`. El primer mensaje a cada cliente es la plantilla de solicitud de ubicación rellenada con los datos que mandó GSG.

## Conexión saliente (GSGchat → GSG)

Tres campos, en Conexión (o en el `.env`):

| Pantalla | `.env` | Ejemplo |
|---|---|---|
| URL base de GSG | `GSG_URL` | `https://backend.developer.gsgcorp.pe/api/` |
| Ruta para enviar la ubicación | `GSG_LOCATION_PATH` | `v1/gsgchat/location` |
| API Key de GSG | `GSG_API_KEY` | (la da GSG) |

La URL final es la base + la ruta: `https://backend.developer.gsgcorp.pe/api/v1/gsgchat/location`.
La pantalla la enseña en vivo antes de guardar. Reglas (`unirUrlGsg` en `src/rutas/gsg.ts`):

- La base tiene que ser `http(s)://dominio...`, sin usuario ni clave, sin `?` ni `#`, sin segmentos `..`.
  Se conserva su camino (`/api/`) y se le pone barra final.
- La ruta es relativa: se quitan las barras del principio y del final y se juntan las dobles.
  Se rechaza una ruta absoluta (`http://…`, cualquier `esquema:`, `//host`), con `..` o `.`, con `?` o `#`, con espacios o con `\`.
- Si la configuración no vale, no se envía nada: los reportes se quedan pendientes con el error a la vista.

Tras guardar, la clave solo se ve enmascarada (`••••` y los últimos 4).

### Prueba de conexión

«Probar» no hace ninguna llamada a GSG. Revisa sin red que la URL base y la ruta sean válidas (las mismas
reglas de arriba) y que la API Key tenga buena forma (sin espacios, al menos 8 caracteres), y explica el
modelo: GSG manda los pedidos a `POST /api/v1/entregas` y GSGchat le manda la ubicación (`POST` a base + ruta,
con `X-API-Key`) y los demás reportes. Si GSG rechaza la clave (401/403), se ve en la cola de reportes.

### Cola de reportes

| Respuesta de GSG | Qué pasa |
|---|---|
| 2xx | `enviado` (solo con 2xx) |
| 401 / 403 | `fallido` con el motivo; la cola se para y no se reintenta sola hasta que cambie la configuración (URL, ruta o clave) o alguien pulse «Enviar ahora» / «Enviar a GSG» |
| 429, 408, 5xx, timeout, sin red | sigue `pendiente` y se reintenta en la siguiente pasada (cada minuto) |
| otro 4xx | `fallido` (las ubicaciones las vuelve a poner en cola el reenvío automático, hasta 10 intentos) |
| configuración no válida | sigue `pendiente` con el error; no sale nada |

Ningún error guardado contiene la clave.

### Las rutas de GSG (12/10)

GSG renombró su endpoint de ubicaciones: ahora es `send-location`, el viejo `sendLocation` ya no existe.
Los problemas van a `reported`. De los otros tres tipos (resumen, confirmación, entrega) GSG no tiene
endpoint todavía: no se mandan y no se reintentan, para no acumular 404 en la cola 24 horas.

### Compatibilidad con lo configurado antes

- La clave: si no hay `GSG_API_KEY` se lee `GSG_TOKEN`; si no hay `gsg.apiKey` guardada se lee `gsg.token`
  (cifrada). Al guardar una nueva desde la pantalla, `gsg.token` se borra.
- La URL completa de antes (`urlUbicacion` guardada o `GSG_SEND_LOCATION_URL`) se convierte a base + ruta
  solo si es inequívoco (`migrarUbicacionAntigua`):
  1. Sin URL antigua: base = la dirección (sin `/send-location` ni el viejo `/sendLocation` si lo tenía), ruta = `send-location`.
  2. La URL antigua empieza por la dirección + `/`: base = la dirección, ruta = el resto.
  3. Si no, se parte por `/api/` cuando aparece una sola vez y la dirección no apunta a otro sitio.
  En otro caso, la pantalla y el estado muestran el error y no se envía nada hasta escribir la base y la ruta.

## Números reportados (para GSG)

Cuando un pedido que manda GSG trae un teléfono o un tracking que no sirve, GSGchat lo guarda con su error
concreto en su bandeja de números reportados. Se guarda **una sola vez por tracking + error**: no en cada reintento
ni en cada pasada del motor. Si GSG lo corrige y el mismo error vuelve después, se guarda otra vez.

Además, GSGchat **se lo manda a GSG** (desde el 12/10), junto con las incidencias del reparto (número sin
WhatsApp, inválido, «no soy yo», rechaza, sin respuesta…): POST a la «Ruta para reportar problemas» de Conexión
con GSG (por ejemplo `v1/gsgchat/reported`; vacía = `incidencias`), con la API Key de GSG en `X-API-Key` y el
contrato del plan de GSG:

```json
{ "tracking": "GSG-E-240268", "tipo": "PROBLEMA", "motivo": "TELEFONO_MAL",
  "codigo": "numero_invalido", "queHacer": "Corrige el número del cliente y vuelve a mandar el pedido.",
  "comentario": "Número inválido: no tiene WhatsApp: el número 999999999 no tiene una cuenta de WhatsApp",
  "telefonoOrigen": "51999999999", "fechaMensaje": "2026-10-12T18:40:00.000Z",
  "eventoId": "gsgchat-GSG-E-240268-sin_whatsapp-2026-10-12" }
```

`motivo` es el catálogo de GSG (`TELEFONO_MAL`, `NO_RECONOCE_PEDIDO`, `RECHAZA`, `DIRECCION_MAL`, `REPROGRAMA`,
`OTRO`), y `codigo` el de GSGchat (los de la tabla de abajo): el motivo sirve para agrupar, el código dice qué
hacer, porque `TELEFONO_MAL` no distingue un número sin WhatsApp (pedir otro) de un fijo (pedir un celular).
El `eventoId` va también en `Idempotency-Key` y es uno por tracking + error + día: el mismo problema que
llega por el reparto y por la bandeja sale una sola vez. Lo enviado se ve en Conexión con GSG → «Lo que enviamos a GSG».

La bandeja sigue disponible: Luis (GSG) la lee con `GET /api/v1/reportados` y corrige con
`POST /api/v1/reportados/{tracking}/correccion` (o `PATCH`). Además, cada respuesta de `POST /api/v1/entregas` y
`GET /api/v1/trackings` trae los avisos `reportado` / `corregido`.

### Errores

| `error` | Cuándo |
|---|---|
| `telefono_invalido` | El teléfono no es un número (vacío, letras). El pedido no se guarda. |
| `numero_corto` | Al número le faltan dígitos (un celular tiene 9). El pedido no se guarda. |
| `numero_largo` | Al número le sobran dígitos. El pedido no se guarda. |
| `numero_fijo` | Es un teléfono fijo, sin WhatsApp. El pedido no se guarda. |
| `sin_whatsapp` | El número no tiene WhatsApp. A GSG le llega como `codigo: "numero_invalido"`, para que pueda editar el número. |
| `envio_fallido` | WhatsApp rechazó el mensaje y ya no se reintenta solo. |
| `tracking_falta` | El pedido llegó sin tracking (la llamada da 400). |
| `tracking_invalido` | El tracking tiene más de 60 caracteres o caracteres de control (la llamada da 400). |
| `tracking_duplicado` | El mismo tracking vino dos veces en la misma llamada con teléfonos distintos. Se guarda solo el primero. |
| `tracking_de_otro_pedido` | El tracking es de un pedido de hoy que ya está cerrado y viene con otro teléfono. Este no se guarda. Si el pedido sigue abierto, el otro teléfono es una corrección: se cambia y se le escribe al número nuevo (`telefonosCorregidos` en la respuesta). |
| `telefono_de_motorizado` | El teléfono es de un motorizado registrado, no de un cliente. No se guarda. |
| `no_soy_yo` | No es la persona: el cliente contestó que no hizo el pedido o que el número no es suyo. |

### Leer y corregir desde GSG

GSG lee la bandeja con `GET /api/v1/reportados` y corrige con `POST /api/v1/reportados/{tracking}/correccion`
(o `PATCH /api/v1/entregas/{referencia}` con el teléfono nuevo). Al corregir, lo pendiente de ese tracking pasa
a `corregido` y, si aún falta la ubicación, se le pide al número nuevo por el flujo normal.

Cada respuesta de `POST /api/v1/entregas`, del `PATCH` y de la corrección trae `whatsapp`: lo que **ya** se hizo
**hoy** con ese tracking o ese teléfono. Al cliente ya contactado no se le manda otro mensaje. Solo cuenta el
mismo día: el mismo cliente otro día es un intento de entrega nuevo y se le vuelve a escribir. `GET /api/v1/trackings`
da lo mismo para todos los trackings de un día; GSG lo lee cuando quiere y GSGchat nunca se lo empuja.

## Etiquetas de los chats (GSGchat → GSG)

En Chats, el botón de la etiqueta clasifica con la IA las conversaciones del día (catálogo en
`src/archive/clasificar.ts`) y le manda a GSG la etiqueta de cada una. **El identificador es el número de
WhatsApp, no un tracking**: un mismo cliente puede tener varios pedidos o ninguno ese día. Si el cliente está
guardado con dos formatos (`987654321` y `51987654321`) es una sola conversación.

POST a la «Ruta para etiquetas de chats» de Conexión con GSG (por ejemplo `v1/gsgchat/labels`; vacía = no se
mandan), con la API Key de GSG en `X-API-Key` y el `eventoId` también en `Idempotency-Key`:

```json
{ "telefono": "51987654321", "telefonoNacional": "987654321", "dia": "2026-10-27",
  "etiqueta": "reagendar_entrega", "etiquetaNombre": "Reagendar entrega", "origen": "ia",
  "mensajes": 4, "clasificadoEn": "2026-10-27T15:20:00.000Z",
  "eventoId": "gsgchat-etiqueta-51987654321-2026-10-27-ab12cd34ef56" }
```

`origen` es `ia`, o `reglas` cuando la IA falló o el cliente no escribió ese día. El `eventoId` es el mismo
mientras la conversación no cambie: un reintento no duplica nada, y una conversación que cambió (y se volvió a
clasificar) llega con otro. Una conversación que no se pudo clasificar no se manda.

| Respuesta de GSG | Qué pasa |
|---|---|
| 2xx | `enviado`; no se vuelve a mandar mientras la conversación siga igual |
| 401 / 403 | `fallido`; las demás del lote no se intentan (quedan `fallido` «No se intentó…», sin contar intento) |
| 429, 408, 5xx, sin red | `fallido` |
| otro 4xx, o 2xx con `{ "ok": false }` | `fallido` |
| sin ruta, sin clave o sin GSG conectado | nada sale; todas `fallido` con el motivo, sin contar intento |

Nada se reintenta solo. «Reintentar envíos» (en Chats, o `POST /admin/chat/etiquetar/reintentar`) manda
**solo** las `fallido` de ese día, con la etiqueta ya guardada: no vuelve a leer los mensajes ni a llamar a la IA.
El siguiente «Etiquetar» también recoge las que quedaron fallidas.

Cada pulsación es un lote (`completo` o `reintento`) con su estado (`en_curso`, `completado`,
`completado_con_errores`, `fallido`) y sus cifras, y lo que pasa en él queda en un registro (inicio y fin del
lote, fallos de la IA, cada envío y cada rechazo de GSG). Ni la API Key ni el texto de los mensajes van al registro.

| Ruta (sesión del panel) | Para qué |
|---|---|
| `POST /admin/chat/etiquetar` | Empieza un lote completo (análisis + envío); 202 |
| `GET /admin/chat/etiquetar` | El lote en marcha o el último, con el avance |
| `POST /admin/chat/etiquetar/reintentar` | `{ dia? }`: reintenta los envíos fallidos; 202, o 200 `{ nada: true }` |
| `GET /admin/chat/etiquetar/lotes` | Los últimos lotes |
| `GET /admin/chat/etiquetar/lotes/{id}` | Un lote, su registro y el estado del envío de cada conversación del día |
| `GET /admin/chat/etiquetar/eventos` | El registro, filtrable por `loteId`, `nivel`, `fase` y `telefono` |

Las pruebas de punta a punta con Postman están en `docs/postman/etiquetas/`.

## Dónde está cada cosa

Para no contar lo mismo en varios sitios:

| Qué | Dónde |
|---|---|
| El contrato: rutas, campos, códigos de error, ejemplos | `src/api/v1/openapi.ts`, servido en `/api/v1/openapi.json` |
| Llamadas listas para importar, con ejemplos de éxito y de error | `docs/postman/` (colección y entorno; se generan con `npx tsx scripts/generar-postman.ts`) |
| Cómo se usa, paso a paso, para quien opera | El Manual del panel (`/manual`): Nuestra API, API 1, API 2, Postman y Conexión con GSG |
| Los conceptos de la conexión y la cola de reportes | Este documento |

La colección sale de los mismos ejemplos que enseñan Nuestra API y el Manual. `tests/postman-coleccion.test.ts`
comprueba que cada llamada existe en el OpenAPI, que sus ejemplos usan sus códigos y campos, que el archivo de
`docs/postman/` está al día y que, lanzadas en orden contra el servidor, responden lo que dicen sus ejemplos.
La API Key no va en la colección: es la variable secreta `apiKey` del entorno, vacía.
