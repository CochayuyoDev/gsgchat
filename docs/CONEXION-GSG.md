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

## Las notas de los chats (etiquetas) y cómo las ve GSG

En Chats, el botón «Etiquetar chats con IA» clasifica con la IA las conversaciones del día: cada chat queda con
**una nota**, la etiqueta del catálogo que dice qué necesita el cliente (reagendar, cambiar la ubicación, recibe
otra persona, sin novedad…). **El identificador es el número de WhatsApp, no un tracking**: un mismo cliente puede
tener varios pedidos o ninguno ese día. Si el cliente está guardado con dos formatos (`987654321` y
`51987654321`) es una sola conversación.

### Cómo la recibe GSG: en el historial que ya pide

GSG no recibe nada aparte. La nota viaja en la respuesta del **historial del chat**, la misma llamada que GSG ya
hace al abrir un chat (`GET /api/v1/historial?tracking=…`, o su alias `GET /api/v1/messages?chat_id=…`, con la
clave de permiso `conversaciones:leer`). Junto a `tracking`, `contacto` y `mensajes` llega:

```json
"nota": { "codigo": "reagendar_entrega", "nombre": "Reagendar entrega",
          "descripcion": "solicita entregar otro día.", "dia": "2026-10-28",
          "origen": "ia", "actualizadaEn": "2026-10-28T15:20:00.000Z" }
```

`codigo` y `nombre` son los del catálogo del negocio; `origen` es `ia` (la puso la IA), `manual` (una persona) o
`reglas` (el bot, p. ej. al cambiar el cliente su ubicación). Es la **última** nota de ese WhatsApp: si se vuelve a
etiquetar, cambia. `null` si el chat aún no tiene ninguna (o la IA no pudo clasificarlo). En cuanto se guarda,
GSG la ve en la siguiente llamada: no hay envíos que fallen ni reintentos. Ver `src/api/v1/conversaciones-gsg.ts`
y la documentación de la API (`/api/v1/openapi.json`).

(Hasta el 28/10 hubo además un envío aparte, un POST a una «Ruta para etiquetas de chats» de GSG con reintentos.
Se quitó: GSG lee la nota en el historial. Las columnas `sync_*` de la migración 014 quedan sin uso.)

### Cómo va un lote

1. **Captura.** Se reúnen los chats con actividad de hoy (zona del negocio), se agrupan por número normalizado
   y se guarda una copia de sus mensajes. El lote procesa esa copia: lo que entre mientras corre no cambia lo
   que se está clasificando. La copia se vacía a las 72 horas, como el chat.
2. **IA.** En segundo plano, cada número va a la IA con sus mensajes del día y el catálogo del negocio. La IA
   solo clasifica (no contesta al cliente) y devuelve el código de una etiqueta; si ninguna corresponde, `otro`.
3. **Validación.** El código tiene que estar en el catálogo. Se guarda con el número, el día, el lote y los
   mensajes procesados. Al volver a pulsar el botón **solo se leen los chats que aún no tienen etiqueta** (nuevos,
   o que la IA no pudo clasificar): un chat ya etiquetado se queda con su etiqueta aunque le lleguen mensajes.
   Solo se relee si su etiqueta ya no está en el catálogo del negocio. Si mientras la IA leía un chat una persona
   le puso la etiqueta a mano, se queda la de la persona.
4. **Error de IA.** Si la IA contesta un código que no está en el catálogo, algo que no es JSON o dos respuestas
   pegadas («No, espera…»), se le da **una** segunda oportunidad recordándole la lista exacta de códigos. Si
   tampoco, o si la IA falla, ese chat queda «Sin clasificar», sin nota. No se adivina por palabras clave: `otro`
   es solo lo que la IA asigna cuando ninguna etiqueta corresponde. El siguiente lote lo vuelve a intentar. Se le
   pide con temperatura 0: la misma conversación da la misma etiqueta.

**La IA solo lee y etiqueta: no responde ni manda mensajes.** Quien habla con el cliente es el bot. El
etiquetado solo necesita la clave de la IA guardada en Avanzado → Asistente IA; **no** hace falta activar el
asistente (activarlo es lo que hace que el bot conteste con IA, y es otra decisión). El módulo de etiquetado no
tiene acceso al envío de mensajes. En «Uso de la IA» el etiquetado se cuenta aparte (`etiquetas`).

El **catálogo** es del negocio: en Chats → ⋮ → «Catálogo de etiquetas…» (solo un administrador) se editan los
códigos, los nombres y la descripción que lee la IA de cada una. `otro` está siempre. Mientras el negocio no
guarde uno, vale el de fábrica (17 etiquetas, en `src/archive/clasificar.ts`; `sin_novedad` es el flujo feliz: el
cliente manda una ubicación, agradece, avisa que ya pagó o que ya recibió, y no pide nada más (decir que estará
para recibir es `confirmar_recepcion`); `otro` queda para lo que no tiene que ver con la entrega). Tras cambiar
el catálogo, ⋮ → «Volver a etiquetar todo» relee también los chats ya etiquetados. Las conversaciones guardadas
(Guardados) usan el mismo catálogo.

Cada pulsación es un lote con su estado (`en_curso`, `completado`, `completado_con_errores` si alguno quedó sin
clasificar, `fallido`) y sus cifras, y lo que pasa en él queda en un registro (inicio y fin del lote, fallos de la
IA, cambios a mano). El texto de los mensajes no va al registro.

| Ruta (sesión del panel) | Para qué |
|---|---|
| `POST /admin/chat/etiquetar` | Empieza un lote; 202 |
| `GET /admin/chat/etiquetar` | El lote en marcha o el último, con el avance |
| `GET /admin/chat/etiquetar/lotes` | Los últimos lotes |
| `GET /admin/chat/etiquetar/lotes/{id}` | Un lote, su registro y cada chat con su estado en el lote (`pendiente`, `reutilizada`, `clasificada`, `error`) |
| `GET /admin/chat/etiquetar/lotes/{id}/chats/{telefono}` | La copia de los mensajes de ese chat que el lote le mandó a la IA |
| `GET /admin/chat/etiquetar/eventos` | El registro, filtrable por `loteId`, `nivel`, `fase` y `telefono` |
| `GET /admin/chat/conversations?etiqueta=…` | La bandeja filtrada: un código del catálogo, `sin_etiquetar` o `sin_clasificar` |
| `GET /admin/chat/etiquetas/conteo` | Cuántos chats de la bandeja hay con cada etiqueta |
| `POST /admin/chat/{contactId}/etiqueta` | `{ etiqueta: "codigo" }` la pone a mano hoy; `{ etiqueta: null }` la quita. 400 si no está en el catálogo o es un grupo |
| `GET /admin/chat/etiquetas/embudo?dia=hoy\|ayer\|AAAA-MM-DD` | El embudo del día: resumen (IA, a mano, sin etiquetar, sin clasificar), cuántos chats por etiqueta y la lista |
| `GET /admin/chat/etiquetas/catalogo` | El catálogo vigente (`propio: false` = el de fábrica) |
| `PUT /admin/chat/etiquetas/catalogo` | `{ items: [{ codigo, nombre, descripcion }] }`: guarda el del negocio (solo administrador); 400 si no vale |
| `DELETE /admin/chat/etiquetas/catalogo` | Vuelve al de fábrica (solo administrador) |
| `POST /admin/chat/etiquetas/evaluar` | «Probar la IA»: pasa el banco de conversaciones de prueba por la IA del negocio; 202 |
| `GET /admin/chat/etiquetas/evaluar` | La prueba en marcha o la última de este proceso, con el informe |
| `POST /admin/chat/etiquetas/probar` | `{ texto }` (una línea por mensaje, `cliente:` / `negocio:`): qué etiqueta le pondría la IA. No guarda nada |

En la pantalla, el aviso del lote muestra el avance y «Ver chats del lote» abre la lista con el estado de cada
chat. Encima de la lista, el filtro de etiquetas (con cuántos chats tiene cada una, más «Sin etiquetar» y «Sin
clasificar») filtra toda la bandeja.

### Probar la IA

Chats → ⋮ → «Probar la IA…» (también desde el catálogo). Mide, antes de fiarse de ella, si la IA del negocio pone
bien las etiquetas, con su catálogo y el mismo clasificador que el botón. No toca ningún chat ni cambia ninguna nota.

- **Prueba completa**: 50 conversaciones típicas del reparto con la etiqueta que les toca (`src/archive/evaluacion.ts`):
  todas las etiquetas, chats donde todo va bien que suenan a otra cosa («ya pagué por Yape»), temas ajenos a la
  entrega (los únicos que van a `otro`), peticiones resueltas seguidas de otra pendiente y mensajes que intentan
  manipular a la IA. El informe dice el % de aciertos, cuántas veces puso `otro` de más o de menos, los aciertos
  por etiqueta y cada fallo con su conversación. Los casos cuya etiqueta no está en el catálogo se saltan.
- **Probar una conversación**: se escribe o pega una conversación y dice qué etiqueta le pondría.

Con ese banco se afinaron las instrucciones del clasificador (28/10): con un modelo capaz (Claude Sonnet) acierta
50 de 50 y usa `otro` solo cuando corresponde; con uno pequeño (Claude Haiku) ronda el 93 %. Si un negocio ve
menos del 90 %, lo primero es un modelo más capaz en Asistente IA y luego mejorar la descripción de las etiquetas
que fallan.

### Etiquetar a mano

En la cabecera de un chat, la etiqueta es un botón (o «+ Etiqueta» si no tiene): abre el catálogo para ponerla o
cambiarla, o «Quitar la etiqueta». También desde Pedidos GSG → Embudo de chats, con «Etiquetar ▾» en cada fila.
Solo vale para el día de hoy y no le escribe nada al cliente.

- Queda con `origen: manual` (en la pantalla, con ✎). **La IA no la pisa**: ningún lote la vuelve a leer, ni
  «Volver a etiquetar todo». GSG la ve al momento en el historial.
- Quitarla deja el chat «sin etiquetar» (en el historial, `nota: null`): el siguiente lote lo vuelve a leer con la IA.
- Cada cambio queda en el registro (`etiqueta_manual`, `etiqueta_quitada`) con quién lo hizo. Si cambia una que
  puso la IA, queda además `correccion_ia` (antes>ahora), para enseñarle a la IA con esos casos.

### Embudo de chats (Pedidos GSG)

Una pestaña de Pedidos GSG (`/embudo-chats`). Hoy o ayer: arriba, cuántos chats hubo, cuántos etiquetó la IA y
cuántos una persona, los que faltan por etiquetar y los que la IA no pudo clasificar. En medio, una barra por
etiqueta partida en «puesta por la IA» y «puesta a mano»; al pulsarla, la lista de abajo se queda con esos chats.
Abajo, cada chat con su etiqueta y quién la puso, con «Etiquetar ▾» (solo hoy) y «Abrir chat».

## Cambiar la ubicación (regla del dueño, 28/10)

El cliente puede cambiar su ubicación **hasta 2 veces al día** (ajuste `cambiosUbicacionMax`), antes de la hora
límite (`cambioUbicacionHasta`, 1:00 PM por defecto). Lo atiende el bot, también con el bot callado de «Solo lo de
GSG»:

1. Debajo de «Ubicación registrada» va: *📍 Si desea cambiar su ubicación, solo diga: cambiar ubicación (hasta la
   1:00 PM).*
2. «cambiar ubicación» (o «me equivoqué de dirección», «te mando otra»…) → *Por favor, comparta su nueva ubicación
   📍*, con el botón de ubicación. **Mientras, se queda la que tenía**: el pedido no pasa a «Necesitan a alguien».
3. La nueva → *✅ Su nueva ubicación se registró correctamente… 📍 Si quiere volver a cambiar su ubicación, solo
   diga: cambiar ubicación. Le queda 1 cambio más.* A GSG le llega la nueva con `cambioUbicacion: true`, `cambios`
   y `anterior`. Mandar otro pin sin decir nada también cuenta como cambio, si le quedan.
4. Al tercero → *Ya cambió su ubicación 2 veces, que es el máximo…* con el contacto de soporte; se queda la última
   y GSG recibe la incidencia `cambio_ubicacion`.
5. Después de la hora límite, como siempre: se le da el número del motorizado y GSG recibe la incidencia.

En el sistema: la marca «Cambió su ubicación (hora)» en Hoy y Números del día; en el detalle del pedido,
**todas las ubicaciones guardadas** (la primera y cada cambio, con su hora y su mapa, y la que vale marcada); y la
nota del chat `cambiar_ubicacion` (origen `reglas`), que GSG ve en el historial. Los textos se editan en Pedidos
GSG → Horarios de entrega y textos de entrega (`invitarCambioUbicacion`, `invitarOtroCambioUbicacion`,
`cambioUbicacionAntes`, `ubicacionCambiada`, `cambiosUbicacionAgotados`).

## El primer mensaje al cliente

En Automatización GSG → Ajustes de chat → «Primer mensaje que recibe el cliente» se ve y se edita el texto real
(`textos.solicitudUbicacion`), con la vista previa de un pedido de ejemplo. El de fábrica termina en *Por favor,
¿podrías compartir tu ubicación por WhatsApp para que el motorizado pueda armar su ruta? ¡Gracias!* Si se guarda
igual al de fábrica, se guarda vacío (y el de fábrica sigue avisando cuando la dirección no trae número de puerta).
La plantilla de Meta para varios pedidos (`templates/catalog.ts`) no se cambió: cambiarla exige volver a aprobarla.

Lo que hay que hacer en la base al desplegarlo: `docs/MIGRACIONES-ETIQUETAS.md`.

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
