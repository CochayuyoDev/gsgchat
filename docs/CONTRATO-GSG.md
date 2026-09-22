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
    { "id": "gsg-P-1001", "referencia": "P-1001", "telefono": "987000001", "nombre": "Ana Quispe",
      "direccion": "Av. Larco 123", "distrito": "Miraflores", "notas": "Dpto. 402", "urgente": false }
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
| `referencia` | **sí** | El número de pedido en GSG. Es la llave de todo: los reportes vuelven con ella. |
| `telefono` | **sí** | El WhatsApp del cliente. |
| `nombre`, `direccion`, `distrito`, `notas` | no | Lo que se le dice al cliente y al motorizado. |
| `lat`, `lng` | no | Si GSG ya tiene la ubicación, van aquí: entonces el cliente solo aparece en `faltaConfirmacion` y no se le pide el pin. |
| `id` | no | El id del pedido en GSG si es distinto de la referencia. Vuelve en los reportes como `referencia` igualmente. |
| `urgente` | no | `true` = va primero hacia el motorizado. |
| `cancelado` | no | `true` = GSG canceló este pedido por su cuenta (el cliente llamó, se anuló la venta…). GSGchat lo cancela aquí, deja de escribirle al cliente y, si ya tenía hora de llegada, le avisa. Puede venir en `cancelados` o en la lista donde estaba. |
| `motivoCancelacion` | no | Con `cancelado: true`, por qué (en palabras; se apunta en la bitácora del pedido). |

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
  `DELETE /api/v1/entregas/{referencia}` (B.3) o lo pasa a `terminados`.

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
sustituye al anterior de la misma referencia.

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

### B.1 `POST /api/v1/entregas` — uno o varios pedidos

Acepta un pedido suelto, una lista `[...]` o `{ "pedidos": [...] }` (hasta 500
por llamada). Mismos campos que en `pendientes`, más dos banderas:

```bash
curl -X POST https://<gsgchat>/api/v1/entregas \
  -H "Authorization: Bearer wak_..." -H "Content-Type: application/json" \
  -d '{
    "pedidos": [
      { "referencia": "P-1001", "telefono": "987000001", "nombre": "Ana Quispe",
        "direccion": "Av. Larco 123", "distrito": "Miraflores",
        "faltaUbicacion": true, "faltaConfirmar": true },
      { "referencia": "P-1007", "telefono": "987000007", "nombre": "Luis Rojas",
        "lat": -12.0464, "lng": -77.0308, "faltaConfirmar": true, "urgente": true }
    ]
  }'
```

- `faltaUbicacion` (por defecto `true`): pedirle el pin al cliente. Con `lat`/`lng` no se le pide.
- `faltaConfirmar` (por defecto `true`): preguntarle si recibe hoy.
- `urgente`: primero hacia el motorizado.

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
permiso, `403`.

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

### B.3 `DELETE /api/v1/entregas/{referencia}` — GSG lo canceló

```bash
curl -X DELETE "https://<gsgchat>/api/v1/entregas/P-1007?motivo=el%20cliente%20anul%C3%B3" -H "Authorization: Bearer wak_..."
```

`200` con el pedido ya cancelado; `404` si no existe hoy; `409` si ya estaba
entregado o cancelado. Al cliente no se le vuelve a escribir.

### B.4 Enterarse de lo que pasa: webhooks

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
con el secreto>`. Se comprueba calculando el HMAC del cuerpo crudo. Un `2xx`
de GSG cierra la entrega; un `5xx` se reintenta (1 min, 5, 30, 2 h, 12 h); un
`4xx` no se insiste. Los cuatro eventos de las entregas: `entrega.confirmada`,
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
| GSG empuja (opcional) | pedidos nuevos, consulta, cancelación | `POST/GET/DELETE https://<gsgchat>/api/v1/entregas[/{referencia}]` |
| GSG se entera (opcional) | eventos `entrega.*` firmados | su propia URL, registrada en `POST /api/v1/webhooks` |
| Para probar | el simulador | `https://<gsgchat>/simulador/gsg`, con un token `gsgsim_…` (Conexión → Para los programadores de GSG) |
| Contrato formal | OpenAPI 3 | `https://<gsgchat>/api/v1/openapi.json` |
