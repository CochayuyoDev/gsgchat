# Contrato entre GSG y GSGchat

Para los programadores de GSG. Es todo lo que hay que saber para que el sistema
de GSG y GSGchat (el WhatsApp del reparto) hablen entre sí. Son dos caminos,
y se puede usar uno o los dos:

- **A. GSG expone su lista del día y acepta los reportes** (GSGchat pregunta
  cada 5 minutos y le cuenta lo que pasa). Es lo que ya funciona hoy con el
  simulador.
- **B. GSG empuja cada pedido en cuanto lo tiene** (una llamada a la API de
  GSGchat) y se entera de lo que pasa por webhook.

Todo en JSON, con `Content-Type: application/json`. Las horas van en ISO 8601
con zona (`2026-09-21T14:05:00.000Z`). Los teléfonos son de Perú: `987654321`
o `51987654321`, da igual (GSGchat los normaliza a `51987654321`).

---

## A. GSG expone su lista del día

GSGchat necesita saber de GSG una sola cosa: **a quién le falta mandar su
ubicación y a quién le falta confirmar que recibe hoy**. Son dos listas
distintas (un cliente puede estar en las dos). Cuando un cliente tiene las dos
cosas, GSGchat manda el pin a un motorizado, le pregunta en cuántos minutos
entrega, le suma el margen (60 min) y avisa al cliente la hora aproximada.
GSG se entera de cada paso por los reportes de más abajo.

Se configura en GSGchat en **Conexión → El sistema de GSG → Conectar la API
real**: la dirección base (`GSG_URL`, por ejemplo `https://api.gsg.pe/v1`) y
un token. Todas las llamadas llevan `Authorization: Bearer <token>`.

### A.1 Lo que GSG expone: `GET <GSG_URL>/reparto/pendientes`

GSGchat lo pide cada 5 minutos (y cuando alguien pulsa «Sincronizar ahora»).

```bash
curl -H "Authorization: Bearer <token>" https://api.gsg.pe/v1/reparto/pendientes
```

Respuesta (200):

```json
{
  "dia": "2026-09-21",
  "faltaUbicacion": [
    { "id": "gsg-P-1001", "referencia": "P-1001", "telefono": "987000001", "nombre": "María Pérez",
      "direccion": "Av. La Marina 1234", "distrito": "San Miguel", "notas": "Dpto. 402", "urgente": false,
      "producto": "Zapatillas talla 40", "empresa": { "codigo": "516", "nombre": "Zapatería Lima" },
      "tracking": "GSG-A-102345", "nroPedido": "#1042", "metodoPago": "YAPE", "monto": "85.00",
      "remitente": "Juan Quispe" }
  ],
  "faltaConfirmacion": [
    { "id": "gsg-P-1007", "referencia": "P-1007", "telefono": "987000007", "nombre": "Luis Rojas",
      "direccion": "Jr. Unión 55", "distrito": "Lima", "lat": -12.0464, "lng": -77.0308 }
  ],
  "terminados": [
    { "referencia": "P-1003" }
  ]
}
```

| Campo | Obligatorio | Qué es |
|---|---|---|
| `dia` | no | El día al que se refiere la lista (`AAAA-MM-DD`). Sin él, hoy. |
| `referencia` | **sí** (o `tracking`) | El número de pedido en GSG. Es la llave de todo: los reportes vuelven con ella. Si no viene, se usa el `tracking`: el pedido queda identificado por su WhatsApp + su código de tracking. |
| `telefono` | **sí** | El WhatsApp del cliente. |
| `nombre`, `direccion`, `distrito`, `notas` | no | Lo que se le dice al cliente y al motorizado. |
| `lat`, `lng` | no | Si GSG ya tiene la ubicación, van aquí: entonces el cliente solo aparece en `faltaConfirmacion` y no se le pide el pin. |
| `id` | no | El id del pedido en GSG si es distinto de la referencia. Vuelve en los reportes como `referencia` igualmente. |
| `urgente` | no | `true` = va primero hacia el motorizado. |
| `cancelado` | no | `true` = GSG canceló este pedido por su cuenta (el cliente llamó, se anuló la venta…). GSGchat lo cancela aquí, deja de escribirle al cliente y, si ya tenía hora de llegada, le avisa. Puede venir en `cancelados` o en la lista donde estaba. |
| `motivoCancelacion` | no | Con `cancelado: true`, por qué (en palabras; se apunta en la bitácora del pedido). |
| `producto` | no | Lo que se entrega («Zapatillas talla 40»). Sale en el primer mensaje al cliente (ver E). |
| `empresa` | no | La tienda que vende, como `{ "codigo": "516", "nombre": "Zapatería Lima" }`. Sale como «516 - Zapatería Lima». |
| `empresaCodigo`, `empresaNombre`, `tiendaCodigo`, `tiendaNombre` | no | Lo mismo que `empresa`, en campos sueltos (se acepta cualquiera de las dos formas). |
| `tracking` | no (sí si no hay `referencia`) | El código de seguimiento de GSG («GSG-A-102345»). Sin `referencia`, es la llave del pedido y vuelve como `referencia` en los reportes. |
| `nroPedido` | no | El número de pedido de la tienda («#1042»). |
| `metodoPago` | no | Cómo paga el cliente («YAPE», «Efectivo», «Pagado»…). |
| `monto` | no | Lo que el motorizado cobra: número (`85`) o texto (`"85.00"`). Un número sale con dos decimales. |
| `remitente` | no | Quién firma el mensaje («Juan Quispe»). Sin él, el mensaje dice «Te escribimos de la empresa de entregas GSG». |

Los datos del envío (`producto` … `remitente`) son **todos opcionales**: el que
no viene simplemente no sale en el mensaje (nunca «Monto: undefined» ni una
línea vacía). Si GSG los vuelve a mandar distintos para un pedido que ya
estaba, GSGchat guarda los nuevos; uno que no viene no borra el que había.

**Cambios después de mandar un pedido.** Si un pedido que GSGchat ya tiene
vuelve a venir con otro `telefono`, `direccion`, `distrito`, `nombre` o `notas`,
GSGchat lo actualiza y lo apunta («GSG cambió la dirección»); si ya iba con un
motorizado, se le manda el dato nuevo. **Salvaguarda:** una lista vacía, un
pedido que simplemente desaparece o un fallo de GSG (500, sin red) **nunca**
cancela nada; solo `cancelado: true`, pedido a pedido.

- `faltaUbicacion`: a estos GSGchat les pide la ubicación por WhatsApp (con
  sus insistencias). En cuanto la manda, GSG recibe `POST /ubicaciones`.
- `faltaConfirmacion`: a estos les pregunta si reciben hoy. En cuanto contesta,
  GSG recibe `POST /confirmaciones`.
- `terminados`: los que GSG ya dio por cerrados. Basta la `referencia`. Un
  pedido que simplemente desaparece de las listas **no** se cancela solo:
  GSGchat sigue con lo que ya tenía de él. Para cancelarlo, GSG usa
  `DELETE /api/v1/entregas/{referencia}` (B.4) o lo pasa a `terminados`.

Un mismo pedido puede estar en `faltaUbicacion` y en `faltaConfirmacion`: se
le pide primero la ubicación y, al recibirla, la pregunta de confirmar va
pegada al «gracias» (un solo mensaje).

### A.2 Lo que GSG acepta: cinco `POST`

Todos con `Authorization: Bearer <token>` y un JSON. **Qué responder**: un `2xx`
(cualquier cuerpo) cierra el reporte. Un `4xx` significa «GSG lo rechaza a
propósito»: el reporte queda como **no aceptado** y se ve en GSGchat, en Hoy
(«N reportes que GSG no aceptó», con Reintentar). Un `5xx`, un timeout o
sin red: se **reintenta** solo, con espera creciente, hasta que entre. Nada se
pierde: mientras GSG esté caído la cola espera.

Cada JSON lleva `tipo` (`ubicacion` | `confirmacion` | `entrega` |
`incidencia` | `resumen`) por si GSG prefiere recibir todo en un solo endpoint.

#### `POST <GSG_URL>/ubicaciones` — el cliente mandó su pin

```json
{
  "tipo": "ubicacion",
  "solicitudId": 17,
  "referencia": "P-1001",
  "telefono": "51987000001",
  "nombre": "Ana Quispe",
  "lat": -12.1211, "lng": -77.0301,
  "mapsUrl": "https://maps.google.com/?q=-12.1211,-77.0301",
  "precisionMetros": 20,
  "fuente": "pin",
  "recibidoEn": "2026-09-21T14:05:00.000Z",
  "intentos": 1,
  "lote": { "id": "…", "nombre": "Entregas GSG 2026-09-21", "externoId": null }
}
```

Si el cliente manda un segundo pin, llega otra vez con `"corregida": true`:
sustituye al anterior de la misma referencia. `solicitudId` es el número
interno de GSGchat para esa petición de ubicación (sirve para cruzar dos
reportes de la misma petición; GSG puede ignorarlo).

#### `POST <GSG_URL>/confirmaciones` — el cliente confirmó (o no)

```json
{
  "tipo": "confirmacion",
  "referencia": "P-1007",
  "telefono": "51987000007",
  "nombre": "Luis Rojas",
  "confirmada": true,
  "respuesta": "si, dale",
  "como": "reglas",
  "motivo": null,
  "confirmadoEn": "2026-09-21T14:20:00.000Z"
}
```

- `como`: `boton` (tocó el botón SÍ/NO) | `reglas` (se entendió lo que escribió) | `ia` | `persona` (lo confirmó alguien desde la pantalla).
- Cuando `confirmada` es `false`, `motivo` dice por qué: `cancela` (dijo que no), `cambio` (otro día u otra dirección: pasa a una persona), `sin_respuesta` (se le preguntó tres veces), `sin_plantilla`, `error_envio`, `baja` (pidió no recibir mensajes), `dia_cerrado` (quedó sin resolver al cerrar el día), `reprogramar`.

#### `POST <GSG_URL>/entregas` — el motorizado lo tiene, y después «entregado»

Llega **dos veces**: la primera cuando el motorizado dio su tiempo y al cliente
se le avisó la hora; la segunda, con los mismos campos, cuando el motorizado
dijo «entregado» (`entregadoEn` deja de ser `null`).

```json
{
  "tipo": "entrega",
  "referencia": "P-1007",
  "telefono": "51987000007",
  "nombre": "Luis Rojas",
  "lat": -12.0464, "lng": -77.0308,
  "motorizado": { "telefono": "51999000003", "nombre": "Carlos Huamán", "placa": "M3C-303" },
  "minutosMotorizado": 35,
  "margenMinutos": 60,
  "minutosAviso": 95,
  "llegaAproxEn": "2026-09-21T16:00:00.000Z",
  "avisadoEn": "2026-09-21T14:25:00.000Z",
  "entregadoEn": null,
  "entregadaComo": null,
  "incidencia": null,
  "prioridad": "normal",
  "visitas": 0,
  "segundaVisita": false
}
```

- `minutosAviso` = `minutosMotorizado` + `margenMinutos`: es lo que se le dijo al cliente.
- Segundo reporte: `entregadoEn` con la hora y `entregadaComo` = `reglas` (escribió «entregado») | `ia` | `foto` (mandó la foto) | `persona` (lo marcó alguien en la pantalla) | `cierre` (lo dio por entregado el cierre del día).
- `incidencia: "no_entregado"` cuando el motorizado fue y no había nadie; `visitas` cuenta esas veces y `segundaVisita: true` cuando el cliente pidió que volviera hoy.

Cuando GSG recibe una confirmación **y** una entrega de la misma referencia
ya puede darla por **terminada** (el simulador lo hace solo).

#### `POST <GSG_URL>/incidencias` — algo que necesita a una persona

```json
{
  "tipo": "incidencia",
  "solicitudId": 21,
  "referencia": "P-1004",
  "telefono": "51987000004",
  "telefonoOriginal": "987000004",
  "nombre": "Rosa Díaz",
  "codigo": "sin_respuesta",
  "titulo": "No contesta",
  "detalle": "3 intentos sin respuesta",
  "queHacer": "Llamarla o confirmar la dirección por otro medio.",
  "requiereHumano": true,
  "intentos": 3,
  "ultimoEnvio": "2026-09-21T13:00:00.000Z",
  "primeraRespuesta": null,
  "detectadoEn": "2026-09-21T14:30:00.000Z",
  "lote": { "id": "…", "nombre": "Entregas GSG 2026-09-21", "externoId": null }
}
```

Códigos posibles (son los del pedido de ubicación): `numero_corto`,
`numero_largo`, `numero_invalido`, `numero_fijo`, `sin_whatsapp`,
`numero_equivocado` («no soy yo»), `sin_respuesta`, `respondio_sin_ubicacion`,
`ubicacion_fuera_de_zona`, `ya_en_curso`, `rechaza_contacto`,
`envio_bloqueado`, `error_envio`.

Lo que sale mal **después** del pin no viene por aquí sino en los otros dos
reportes: en `/confirmaciones` con `confirmada: false` y su `motivo`
(`sin_respuesta`, `cancela`, `cambio`, `dia_cerrado`, `sin_plantilla`…), y en
`/entregas` con `incidencia: "no_entregado"` cuando el motorizado fue y no
pudo entregar.

#### `POST <GSG_URL>/resumenes` — cómo va el lote del día

```json
{
  "tipo": "resumen",
  "lote": { "id": "…", "nombre": "Entregas GSG 2026-09-21", "externoId": null },
  "total": 10,
  "porEstado": { "resuelta": 6, "pendiente": 2, "derivada": 2 },
  "porIncidencia": { "sin_respuesta": 1, "numero_invalido": 1 },
  "generadoEn": "2026-09-21T18:00:00.000Z"
}
```

Cada cierto tiempo (ajustable en GSGchat) y al terminar el lote.

---

## B. GSG empuja sus pedidos a GSGchat

Si GSG prefiere no exponer nada, puede **mandar cada pedido en cuanto lo
tiene** a la API pública de GSGchat y enterarse de lo que pasa por webhook.
Hace falta una clave de API: en GSGchat, **Conexión → El sistema de GSG →
Crear la clave para GSG** (sale una sola vez; lleva los permisos
`entregas:gestionar`, `entregas:leer` y `webhooks:gestionar`). Va en
`Authorization: Bearer wak_...`.

La base es `https://<gsgchat>/api/v1`. El contrato entero, en OpenAPI 3:
`https://<gsgchat>/api/v1/openapi.json`.

**Límite de peticiones.** Cada clave puede hacer como mucho **120 peticiones
por minuto** a `/api/v1/entregas…`. Pasado eso, `429` con la cabecera
`Retry-After` (segundos) y el motivo en `error`. Como un `POST` lleva hasta
500 pedidos, sobra para cualquier reparto; el tope existe para que un bucle
mal hecho no tumbe el sistema.

**Errores.** Todo error viene como `{ "error": "<qué pasó, en palabras>" }`:
`401` sin clave o con una clave revocada, `403` si a la clave le falta el
permiso, `400` si el cuerpo no se entiende (JSON roto, falta `referencia`,
lista vacía), `404` si la referencia no es de hoy, `409` si el pedido ya está
cerrado, `429` si se pasó el límite.

### B.1 `POST /api/v1/entregas` — uno o varios pedidos

Acepta un pedido suelto, una lista `[...]` o `{ "pedidos": [...] }` (hasta 500
por llamada). Mismos campos que en `pendientes`, más dos banderas:

```bash
curl -X POST https://<gsgchat>/api/v1/entregas \
  -H "Authorization: Bearer wak_..." -H "Content-Type: application/json" \
  -d '{
    "pedidos": [
      { "referencia": "P-1001", "telefono": "987000001", "nombre": "María Pérez",
        "direccion": "Av. La Marina 1234", "distrito": "San Miguel",
        "faltaUbicacion": true, "faltaConfirmar": true,
        "producto": "Zapatillas talla 40", "empresa": { "codigo": "516", "nombre": "Zapatería Lima" },
        "tracking": "GSG-A-102345", "nroPedido": "#1042", "metodoPago": "YAPE", "monto": 85,
        "remitente": "Juan Quispe" },
      { "referencia": "P-1007", "telefono": "987000007", "nombre": "Luis Rojas",
        "lat": -12.0464, "lng": -77.0308, "faltaConfirmar": true, "urgente": true }
    ]
  }'
```

| Campo | Obligatorio | Qué es |
|---|---|---|
| `referencia` | **sí** | El número de pedido en GSG. La misma referencia el mismo día no se duplica. |
| `telefono` | **sí** | El WhatsApp del cliente (`987654321` o `51987654321`). Uno inválido descarta ese pedido, no la llamada entera. |
| `nombre`, `direccion`, `distrito`, `notas` | no | Lo que se le dice al cliente y al motorizado. |
| `lat`, `lng` | no | Si GSG ya tiene el pin: entonces no se le pide la ubicación. |
| `id` | no | El id del pedido en GSG si es distinto de la referencia. |
| `faltaUbicacion` | no | Por defecto `true`: pedirle el pin al cliente. Con `lat`/`lng` no se le pide. |
| `faltaConfirmar` | no | Por defecto `true`: preguntarle si recibe hoy. |
| `urgente` | no | `true` = va primero hacia el motorizado. |
| `producto` | no | Lo que se entrega. Sale en el primer mensaje al cliente (ver E). |
| `empresa` | no | La tienda que vende: `{ "codigo": "516", "nombre": "Zapatería Lima" }` (o texto). |
| `empresaCodigo`, `empresaNombre`, `tiendaCodigo`, `tiendaNombre` | no | La empresa en campos sueltos. |
| `tracking` | no | El código de seguimiento de GSG. |
| `nroPedido` | no | El número de pedido de la tienda. |
| `metodoPago` | no | Cómo paga el cliente. |
| `monto` | no | Lo que se cobra: número o texto (`85` → «85.00»). |
| `remitente` | no | Quién firma el mensaje. |
| `motorizado` | no | El motorizado que GSG ya asignó a ese pedido: `{ "nombre": "Carlos", "telefono": "999000003" }` (o solo el nombre). Su número es el que se le da al cliente en el cierre y en UBI REGISTRADA. |
| `telefonoMotorizado` | no | El teléfono de ese motorizado, suelto. Si no llega ninguno (ni hay motorizado asignado en GSGchat), al cliente se le da el número de soporte. |
| `costServ` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `referenciaDireccion` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `fecRegistro` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `fecRuta` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `observacionCliente` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `detalleProducto` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `telefono2` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `tamano` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `cantBultos` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `clientePagaDelivery` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `sede` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `tipoRuta` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `nroDocumento` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `agenciaNombre` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `agenciaDestino` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `pagoEnDestino` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |

Los datos del envío son opcionales: lo que falta no sale en el mensaje. Si el
pedido ya estaba (va en `repetidas`) y trae datos del envío nuevos, se guardan.

Para cancelar no se usa `cancelado` aquí: se usa `DELETE` (B.4).

Respuesta `201` (o `200` si no entró nada nuevo):

```json
{
  "ok": true,
  "creadas": [ { "referencia": "P-1001", "estado": "esperando_ubicacion", "situacion": "…", "…": "…" } ],
  "repetidas": ["P-1003"],
  "descartadas": [ { "referencia": "P-1009", "motivo": "teléfono inválido: tiene 2 dígitos" } ],
  "detalle": "1 pedido nuevo, 1 ya estaba, 1 descartado."
}
```

Un pedido con la misma referencia que uno de hoy **no se duplica** (va en
`repetidas`). Un cuerpo que no se entiende responde `400` con el motivo; sin
permiso, `404` con `{ "error": "No tiene permiso" }`.

### B.2 `GET /api/v1/entregas/{referencia}` — cómo va

```bash
curl -H "Authorization: Bearer wak_..." https://<gsgchat>/api/v1/entregas/P-1007
```

```json
{
  "ok": true,
  "entrega": {
    "referencia": "P-1007", "estado": "avisada", "situacion": "En camino: le llega alrededor de las 16:00",
    "prioridad": "urgente",
    "producto": "Licuadora 1.5 L", "empresa": { "codigo": "408", "nombre": "TecnoPerú", "texto": "408 - TecnoPerú" },
    "tracking": "GSG-A-102351", "nroPedido": "#3302", "metodoPago": "Pagado", "monto": null, "remitente": "Juan Quispe",
    "ubicacion": { "estado": "recibida", "lat": -12.0464, "lng": -77.0308, "mapa": "https://…", "recibidaEn": "…" },
    "confirmacion": { "estado": "confirmada", "intentos": 1, "respuesta": "si", "como": "boton", "en": "…" },
    "motorizado": { "nombre": "Carlos Huamán", "telefono": "51999000003", "placa": "M3C-303" },
    "minutosMotorizado": 35, "minutosAviso": 95, "llegaAproxEn": "…", "avisadaEn": "…",
    "entregadaEn": null, "entregadaComo": null, "incidencia": null
  },
  "eventos": [ { "en": "…", "tipo": "confirmada", "detalle": "el cliente tocó SÍ" } ]
}
```

Estados: `pendiente` → `esperando_ubicacion` → `esperando_confirmacion` →
`lista` → `esperando_motorizado` → `avisada` → `entregada`; y `cancelada`,
`incidencia`, `terminada`. `GET /api/v1/entregas` (sin referencia) devuelve
el día entero, con las cifras y los motorizados.

### B.3 `PATCH /api/v1/entregas/{referencia}` — GSG cambió datos del pedido

```bash
curl -X PATCH https://<gsgchat>/api/v1/entregas/P-1004 \
  -H "Authorization: Bearer wak_..." -H "Content-Type: application/json" \
  -d '{ "direccion": "Av. Nueva 100", "distrito": "San Isidro" }'
```

| Campo | Qué cambia |
|---|---|
| `nombre`, `direccion`, `distrito`, `notas` | Los datos que ven el cliente y el motorizado. Vacío = se borra ese dato. |
| `urgente` | `true` lo pasa delante hacia el motorizado; `false` lo devuelve a normal. |
| `producto`, `empresa`, `empresaCodigo`, `empresaNombre`, `tiendaCodigo`, `tiendaNombre`, `tracking`, `nroPedido`, `metodoPago`, `monto`, `remitente` | Los datos del envío (ver B.1). Lo que llega manda; lo que no llega se queda como estaba. |
| `motorizado`, `telefonoMotorizado` | El motorizado que GSG asignó (ver B.1): desde ahí el cierre le da al cliente ese número. |
| `costServ` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `referenciaDireccion` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `fecRegistro` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `fecRuta` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `observacionCliente` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `detalleProducto` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `telefono2` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `tamano` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `cantBultos` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `clientePagaDelivery` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `sede` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `tipoRuta` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `nroDocumento` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `agenciaNombre` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `agenciaDestino` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |
| `pagoEnDestino` | no | Dato de Courier; ver [contrato de recepcion](RECEPCION-GSG.md). |

`200` con `cambios` (en palabras) y el pedido como queda; queda apuntado en su
bitácora («GSG cambió: dirección … → …»). El **teléfono no se cambia**
(`400`): al número viejo ya se le pudo escribir, así que es otro pedido
(cancelar con B.4 y crear con B.1). `404` si no existe hoy; `409` si ya está
entregado, cancelado o terminado.

### B.4 `DELETE /api/v1/entregas/{referencia}` — GSG lo canceló

```bash
curl -X DELETE "https://<gsgchat>/api/v1/entregas/P-1007?motivo=el%20cliente%20anul%C3%B3" -H "Authorization: Bearer wak_..."
```

`200` con el pedido ya cancelado; `404` si no existe hoy; `409` si ya estaba
entregado o cancelado. Al cliente no se le vuelve a escribir.

### B.5 Enterarse de lo que pasa: webhooks

GSG registra una URL suya y GSGchat le manda cada evento con un `POST`
firmado:

```bash
curl -X POST https://<gsgchat>/api/v1/webhooks \
  -H "Authorization: Bearer wak_..." -H "Content-Type: application/json" \
  -d '{ "url": "https://api.gsg.pe/gsgchat/avisos",
        "eventos": ["entrega.confirmada", "entrega.avisada", "entrega.entregada", "entrega.incidencia"] }'
```

La respuesta trae el `secreto` (una sola vez). Cada entrega llega así:

```json
{
  "id": "…",
  "evento": "entrega.avisada",
  "fecha": "2026-09-21T14:25:00.000Z",
  "intento": 1,
  "datos": { "referencia": "P-1007", "telefono": "51987000007", "…": "…" }
}
```

con la cabecera `X-Firma: t=<segundos>,v1=<hmac sha256 hex de "<t>.<cuerpo>"
con el secreto>` (y, de ayuda, `X-Evento` y `X-Entrega`). Se comprueba
calculando el HMAC del cuerpo crudo. Un `2xx` de GSG cierra la entrega; un
`5xx`, un `408`, un `429`, un timeout o sin red se reintenta a los 15 s, 1 min, 5 min, 30 min, 2 h y 12 h
(siete intentos en total); cualquier otro `4xx` no se insiste. `intento`
dice qué intento es (1 el primero). Los cuatro eventos de las entregas: `entrega.confirmada`,
`entrega.avisada` (hora dada al cliente), `entrega.entregada`,
`entrega.incidencia`. También existen `mensaje.recibido`, `ubicacion.recibida`
y el resto (lista en `GET /api/v1/eventos`).

---

### A.3 Probar cancelaciones y cambios contra el simulador

El simulador de este servidor (§ C) admite dos llamadas que hacen lo que haría
GSG con un pedido ya mandado, para probar el espejo de cambios desde fuera:

```
POST <GSGCHAT_URL>/simulador/gsg/reparto/cancelar   { "referencia": "P-1003", "motivo": "el cliente anuló" }
POST <GSGCHAT_URL>/simulador/gsg/reparto/cambiar    { "referencia": "P-1004", "direccion": "Av. Nueva 100", "distrito": "San Isidro" }
```

`cambiar` también acepta los datos del envío (`producto`, `empresa`, `tracking`,
`nroPedido`, `metodoPago`, `monto`, `remitente`).
`404` si el pedido no existe en el simulador, `409` si ya estaba cerrado. A
partir de ahí, `GET /reparto/pendientes` lo devuelve en `cancelados` con
`cancelado: true` y `motivoCancelacion`, o con los datos nuevos. En Conexión →
«Para los programadores de GSG» hay dos botones que hacen lo mismo con un clic.

## C. Probar desde fuera, sin tocar nada real

GSGchat trae un **simulador del sistema de GSG**: una copia de mentira con
sus tres listas. Sirve para que GSG pruebe **su lado del contrato A** contra
algo que ya se comporta como GSGchat espera, y para ver en la pantalla Hoy
cómo se mueve cada pedido.

1. En GSGchat, **Conexión → El sistema de GSG → Usar el simulador**. La API
   queda en `https://<gsgchat>/simulador/gsg`.
2. **El token para probar desde fuera.** Quien opera GSGchat lo crea en
   Conexión → *Para los programadores de GSG* → «Crear un token del
   simulador»: empieza por `gsgsim_`, se ve una sola vez, caduca a los 30 días
   y se puede anular. Se manda igual que en producción,
   `Authorization: Bearer gsgsim_…`. (Si la prueba corre dentro del propio
   servidor de GSGchat, vale también el token interno `simulador-gsg-local`.)
   Con un token caducado o anulado el simulador responde `401` con
   `{ "error": "El token del simulador caducó o fue anulado…" }`.
3. Cargar la lista del día de GSG (la misma forma que `pendientes`):

   ```bash
   curl -X POST https://<gsgchat>/simulador/gsg/reparto/cargar \
     -H "Authorization: Bearer gsgsim_…" -H "Content-Type: application/json" \
     -d '{ "clientes": [
       { "referencia": "P-1001", "telefono": "987000001", "nombre": "Ana Quispe", "faltaUbicacion": true, "faltaConfirmacion": true },
       { "referencia": "P-1007", "telefono": "987000007", "nombre": "Luis Rojas", "lat": -12.0464, "lng": -77.0308, "faltaUbicacion": false, "faltaConfirmacion": true }
     ] }'
   ```

4. Ver la lista tal como GSGchat la lee: `GET /simulador/gsg/reparto/pendientes`;
   y todo lo que GSGchat le fue reportando (cada `POST` de A.2, con su cuerpo):
   `GET /simulador/gsg/reparto/estado`.
5. `DELETE /simulador/gsg/reparto` vacía el simulador.
6. **Lo que GSG nos mandó.** Cada llamada al simulador y a `/api/v1/entregas`
   queda en Conexión → *Para los programadores de GSG* → «Lo que GSG nos
   mandó»: hora, ruta, con qué token entró y qué se contestó (en palabras: por
   ejemplo «rechazada: token inválido» o «creados 3, repetidos 1, descartados
   0»). Sirve para depurar a dos manos sin pasarse logs.
7. **Verificar el contrato A.** Cuando GSG ya exponga su `pendientes` de
   verdad, en Conexión → «Verificar el contrato» GSGchat lo consulta y dice,
   campo por campo, qué falta (`faltaUbicacion` ausente, pedido sin
   `referencia`…), qué viene con formato raro (`dia` que no es AAAA-MM-DD,
   `urgente` que no es true/false, teléfono inválido, `lat`/`lng` que no son
   números) y qué sobra (campos que no se usan: no molestan). No crea nada.
   Los pedidos que llegan mal en la sincronización de cada 5 minutos se
   enseñan en esa misma pantalla («N pedidos de hoy no se pudieron leer», con
   la referencia y el motivo) para que GSG los corrija.
8. **Cuadre de fin de día.** «Cuadrar el día con GSG» compara lo que GSG tiene
   en `terminados` con lo que en GSGchat figura entregado o cancelado, y lista
   las diferencias en los dos sentidos.

Con eso los programadores de GSG ven **exactamente** qué JSON les va a llegar
en cada `POST` (los cuerpos quedan guardados en `/reparto/estado`), y pueden
probar su `pendientes` respondiendo lo mismo que responde el simulador. En
Hoy hay además «Cargar 10 clientes de prueba» y «Cargar 10 motorizados de
prueba» con números ficticios, y un simulador de mensajes entrantes para
recorrer el flujo entero sin WhatsApp de verdad.

Para probar el contrato B basta la clave de API y `POST /api/v1/entregas`
contra la misma instalación: los pedidos aparecen en Hoy al instante.

---

## D. Resumen de una página

| Quién | Qué | Dónde |
|---|---|---|
| GSG expone | la lista del día | `GET <GSG_URL>/reparto/pendientes` |
| GSG acepta | ubicaciones, confirmaciones, entregas, incidencias, resúmenes | `POST <GSG_URL>/ubicaciones` … `/resumenes` |
| GSG empuja (opcional) | pedidos nuevos, consulta, cambios, cancelación | `POST/GET/PATCH/DELETE https://<gsgchat>/api/v1/entregas[/{referencia}]` (120 por minuto y clave) |
| GSG se entera (opcional) | eventos `entrega.*` firmados | su propia URL, registrada en `POST /api/v1/webhooks` |
| Para probar | el simulador | `https://<gsgchat>/simulador/gsg`, con un token `gsgsim_…` (Conexión → Para los programadores de GSG) |
| Contrato formal | OpenAPI 3 | `https://<gsgchat>/api/v1/openapi.json` |

---

## E. Lo que recibe el cliente por WhatsApp (GSG Courier)

Para que GSG sepa qué ve su cliente con los datos que manda. Todos los textos
son editables en GSGchat (Hoy → Ajustes de las entregas → textos); aquí van
los de fábrica.

**1. El primer mensaje (pedir la ubicación).** Con los datos del envío de A.1 /
B.1. Ejemplo real, con todos los campos:

```
¡Hola María Pérez! Soy Juan Quispe de la empresa de entregas GSG. Tengo una entrega para ti:
📦 Producto: Zapatillas talla 40
🏢 Empresa: 516 - Zapatería Lima
📝 Código: GSG-A-102345
🧾 Nro. de pedido: #1042
💳 Método de Pago: YAPE
💰 Monto a Cobrar: 85.00
🏠 Dirección: San Miguel - Av. La Marina 1234

Por favor, ¿podrías compartir tu ubicación por WhatsApp para poder llegar sin problemas? ¡Gracias!
```

Si falta un dato, su línea no sale. Sin `remitente`, la presentación dice
«Te escribimos de la empresa de entregas GSG». Los recordatorios (si no
contesta) son cortos y no repiten la ficha.

**2. La regla del dueño.** «El único proceso de GSGchat es disparar
mensajes. Una vez que la IA manda el mensaje de UBI REGISTRADA, ahí llega la
IA: ya no vuelve a responder.» Mientras se espera el pin, el cliente solo puede
recibir tres respuestas:

- Si pregunta **por qué** se la piden (o para qué, «¿es seguro?», «¿quién
  eres?»): «Es necesaria para calcular la ruta exacta de entrega y coordinar
  con el motorizado.» y se la vuelve a pedir. Sin límite, pero nunca el mismo
  texto dos veces seguidas.
- Si manda el **pin** o un enlace de mapa: UBI REGISTRADA (punto 3).
- **Cualquier otra cosa** (una consulta, un precio, «¿a qué hora llega?», un
  saludo, un audio, un sticker, algo personal): **una sola vez por pedido** el
  cierre «Por este canal no se reciben consultas. Te derivamos con un asesor
  humano. Número del motorizado: <número>.» y el chat pasa a una persona
  («Para una persona» en Chats). Desde ahí, silencio.

El número es el del motorizado de ese pedido si ya hay uno (asignado en
GSGchat, o el que GSG manda en `motorizado` / `telefonoMotorizado`, B.1); si
no, el de soporte; si tampoco hay, el del WhatsApp de la tienda. La IA **solo
clasifica** (por qué / otra cosa): nunca redacta nada para el cliente; lo que
sale son siempre los textos fijos (editables en Hoy → Ajustes → Textos). El
sistema **nunca** manda una ubicación, un pin ni un mapa a nadie: solo el
cliente manda la suya.

**3. Al recibir el pin.** El pedido queda como **UBI REGISTRADA** (así se ve en
Hoy y en Números del día) y GSG recibe `POST /ubicaciones` (A.2) al momento. Al
cliente le llega **un solo mensaje**: «Ubicación registrada correctamente», el
enlace del mapa de su propio pin, el cierre con el número (arriba), el aviso de
que un motorizado lo contactará y el horario de entrega (de 2 a 8 p. m., que
puede extenderse hasta las 10 p. m.). **A partir de ahí no se le escribe nada
más**: ni pregunta SÍ/NO, ni hora de llegada, ni «cerca», ni «entregado», ni
recordatorios. Por dentro todo sigue igual: el pedido va a un motorizado, se le
piden los minutos y GSG recibe la hora aproximada y la entrega (A.3). Es el
ajuste «Después de UBI REGISTRADA, no escribirle más al cliente» (Hoy →
Ajustes), encendido de fábrica; apagado, vuelve lo de antes (pregunta de
confirmar, hora de llegada y aviso de entregado). Los mensajes al cliente se
presentan como «GSG Courier».


La recepcion de Courier acepta tambien los alias cliente, driver, codigoTracking y montoCobrar. Si se omite referencia, se utiliza tracking (o codigoTracking). Detalle y ejemplo completos en [RECEPCION-GSG.md](RECEPCION-GSG.md).


## Endpoint global de recepcion

Courier envia exclusivamente a POST https://<dominio>/api/v1/entregas, sin /tienda/<nombre>. Authorization: Bearer <clave> identifica la tienda por la clave vigente guardada en su base, y exige entregas:gestionar. Cookies, Referer y campos del cuerpo no eligen la tienda. Las claves existentes siguen sirviendo. Si no hay clave valida, falta permiso, la tienda esta suspendida o una clave esta asignada a dos tiendas, se devuelve HTTP 404 con {"error":"No tiene permiso"}. La recepcion con prefijo de tienda tambien devuelve ese error. No se guardan pedidos rechazados. Las demas rutas del panel y APIs mantienen su comportamiento.
