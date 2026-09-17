# wa-locator

Conecta tu cuenta de WhatsApp Business (API oficial de Meta), habla con tus
clientes desde una pantalla igual que WhatsApp y automatiza el resto: respuestas
por palabra clave, seguimientos de varios pasos, envios programados, campanas
con plantilla, ubicacion en vivo y extraccion de coordenadas de cualquier link
de mapa. Con las guardas anti-bloqueo cableadas para no quemar el numero.

```bash
docker compose up -d          # app + postgres + redis, todo junto
```

O sin Docker:

```bash
docker compose up -d postgres redis
npm install
npm run dev                   # aplica migraciones y arranca
```

Abre `http://localhost:3000` y entra en `/login`: la primera vez te pide crear
tu cuenta (sera la administradora); despues, usuario y contrasena. No hay
ningun token que pegar.

**El camino corto, sin montar nada:**

```bash
npm run quick                 # servidor real + WhatsApp real, base embebida
```

Abre `/setup`, elige "Escanear el QR y ya", escanea desde el telefono y estas
dentro. Ni Postgres, ni Redis, ni Docker, ni cuenta de Meta. La vinculacion se
guarda en `.wa-auth` y se reutiliza al reiniciar; los datos no, que para eso
esta el arranque de verdad.

Sin credenciales de Meta se puede ver todo funcionando con datos de ejemplo:

```bash
npm run demo                  # servidor real, capa de datos en memoria
```

Y el geo core corre sin nada montado:

```bash
npm test
npm run extract -- "https://maps.app.goo.gl/AbCdEf"
npm run templates:lint
```

---

## Como se conecta tu cuenta

Todo desde `/setup`, un asistente de cuatro pasos. El unico que hay que pensar
es el primero, y no pregunta por tecnologia sino por algo que el usuario si sabe
contestar: **si quiere seguir usando WhatsApp en el movil**.

**Si (coexistencia): se conecta con un codigo QR.** El numero se queda en la app
de WhatsApp Business del telefono *y ademas* habla por la API. La ventana de
Meta enseña un QR, se escanea desde esa app, el historial se sincroniza y se
puede seguir contestando a mano desde el movil. Es lo que casi todo el mundo
quiere cuando pide "el QR". Por dentro es Embedded Signup con
`featureType: whatsapp_business_app_onboarding`.

**No (numero dedicado): "Conectar con Facebook".** Registro incorporado clasico.
El numero pasa a ser solo de la API y deja de funcionar en la app del telefono.

Los dos necesitan activar el registro incorporado una vez en la app de Meta
(WhatsApp, Configuracion, Registro incorporado) y pegar su ID de configuracion;
la pantalla lo pide en el paso 2 y no vuelve a preguntarlo.

**El tercer camino, manual: pega el token.** El token permanente, el ID de la app
y su clave secreta. Con eso el sistema:

1. averigua a que cuentas de negocio llega el token (`debug_token`) y que
   numeros tiene cada una;
2. si hay varios, pregunta cual;
3. guarda las credenciales cifradas y se inventa el token de verificacion;
4. **registra el webhook en Meta por API**, sin que copies nada a mano;
5. suscribe la app a la cuenta de negocio;
6. comprueba que el numero responde y dice su calidad y su tier.

Antes eran seis campos y un viaje al panel de Meta a pegar la URL del webhook.

**Por la via oficial, el QR solo existe para WhatsApp Business.** Para el
WhatsApp verde de consumidor no hay forma oficial: el paso previo es migrarlo a
WhatsApp Business, que es gratis y conserva numero e historial.

Quien no quiera pasar por Meta tiene el **cuarto camino, WAHA**, mas abajo.

Dos cosas mas que la pantalla resuelve sola:

- **Numero nuevo:** se activa con su PIN de seis digitos desde ahi. En
  coexistencia no hace falta: el numero ya estaba dado de alta en la app.
- **Mensaje de prueba:** manda `hello_world` a tu propio telefono para
  comprobarlo de punta a punta.

En local Meta necesita una URL publica:
`npx cloudflared tunnel --url http://localhost:3000`, y esa URL en el campo
correspondiente (o en `PUBLIC_BASE_URL`).

---

## El camino corto: cliente local (no oficial)

Ni contenedor ni app de Meta: el cliente corre **dentro de este mismo proceso**.
Se pulsa conectar, sale el QR en la pantalla, se escanea y ya. Funciona con
cualquier WhatsApp, tambien el verde.

Por dentro es [Baileys](https://github.com/WhiskeySockets/Baileys), que habla el
protocolo de WhatsApp Web por WebSocket sin abrir ningun navegador. Se elige con
`WHATSAPP_PROVIDER=local` (o desde la pantalla) y **no pide ninguna credencial**:
la vinculacion vive en `.wa-auth` y sobrevive a los reinicios.

**El precio es el mismo que el de WAHA:** esto emula WhatsApp Web, esta fuera de
los terminos de Meta, los baneos son permanentes y sin apelacion. Usa un numero
secundario.

Tambien se puede vincular **sin camara**: escribes tu numero y sale un codigo de
ocho caracteres que se teclea en el movil (WhatsApp, Dispositivos vinculados,
Vincular con el numero de telefono).

Las degradaciones son las de WAHA, por el mismo motivo (no hay Meta detras):
plantilla mandada como texto ya sustituido, boton de ubicacion pedido por texto,
botones como lista numerada y calidad del numero `NA`, con lo que ese gate se
queda ciego. Los entrantes no llegan por webhook sino por el socket, y entran
por el mismo `processChange` con la misma deduplicacion por id.

Como aqui no hay tier ni calidad que consultar, el sistema se cuida de otra
forma: el perfil de ritmo `no_oficial` (4 por minuto, 80 por hora, pausas de
15 a 45 s, 80 contactos nuevos al dia, warm-up desde 20), **escritura
simulada** antes de cada mensaje (WhatsApp ve "escribiendo..." el tiempo que
tardaria una persona en teclear ese texto), tres redacciones por mensaje para
que no salgan doscientos iguales, y el monitor de salud mirando lo que si se
puede ver: mensajes que no llegan, desconexiones seguidas, gente que no
contesta. Un `403` del socket es un baneo: se para todo y no se reintenta.
Ver "Que evita realmente que bloqueen el numero".

`npm run quick` levanta ademas todo lo que trabaja solo (secuencias, motor de
rutas, goteo de campanas, avisos, monitor): antes solo lo hacia `npm run dev`,
y un lote de rutas cargado en el arranque corto no salia nunca.

---

## El cuarto camino: WAHA (no oficial)

[WAHA](https://waha.devlike.pro) es un contenedor que expone WhatsApp como API
REST y se conecta escaneando el **QR de WhatsApp Web**. Funciona con cualquier
WhatsApp, tambien el verde, y no necesita ninguna app de Meta.

**El precio:** WAHA emula el cliente de WhatsApp Web. Eso esta fuera de los
terminos de Meta, los baneos son permanentes y sin apelacion, y el riesgo sube
con el volumen a numeros que no te tienen agendado. Usa un numero secundario.

```bash
docker run -it -p 3001:3000 devlikeapro/waha   # el contenedor, en otro puerto
```

Luego en `/setup`, opcion "Conectar con WAHA". La direccion no hay ni que
pegarla: la pantalla busca el contenedor en `localhost:3000` y `localhost:3001`
y rellena el campo sola. Se comprueba que `GET /api/sessions` devuelva una
lista, no solo que el puerto responda, porque en el 3000 suele estar este mismo
servidor. Le das a conectar y sale el QR ahi mismo.

**Sin camara: vincular con el numero.** Debajo del QR se puede escribir el
telefono y pedir un codigo de ocho caracteres, que se teclea en el movil
(WhatsApp, Dispositivos vinculados, Vincular con el numero de telefono). Es el
mismo emparejamiento, escrito en vez de fotografiado; sirve cuando el telefono
no puede enfocar la pantalla o se monta en remoto. Lo soportan los motores
NOWEB y WEBJS: con otro, WAHA responde un error y la pantalla se queda con el
QR, que siempre funciona.

Se elige con `WHATSAPP_PROVIDER=waha` (o desde la pantalla) y entra por el mismo
sitio que todo lo demas: implementa la misma interfaz `WhatsAppClient`, asi que
los gates, la cola, las secuencias, el chat y el geo core no se enteran del
cambio. Lo que WAHA no tiene se degrada a proposito y esta cubierto por tests:

| Cloud API | Con WAHA |
|---|---|
| Plantilla aprobada | el cuerpo guardado, mandado como texto ya sustituido |
| Boton nativo de ubicacion | se pide por texto, con la instruccion del clip |
| Botones interactivos | lista numerada |
| Calidad y tier del numero | **no existen**: el gate de calidad se queda ciego |
| Activar numero con PIN | no aplica, lo sustituye el QR |
| Revision de plantillas por Meta | no hay: el catalogo local es la verdad |

Los demas gates (opt-in, ventana de 24 h, cupo diario, warm-up) siguen
aplicando. Con un cliente no oficial importan mas, no menos: son lo unico que
queda entre tu numero y el baneo.

El webhook de WAHA entra por `/webhooks/waha` y firma con `X-Webhook-Hmac`
(sha512), no con el `X-Hub-Signature-256` de Meta. La clave se la inventa el
sistema al conectar, igual que el verify token. Aqui no hace falta tunel: WAHA
suele correr en la misma maquina y solo tiene que poder llegar a este servidor.

---

## El chat

`/chat` es la pantalla principal: lista de conversaciones a la izquierda, hilo a
la derecha, burbujas verdes y blancas, hora y doble check. Escribes y se manda.

Lo que la separa de un chat cualquiera:

- **Sabe cuando NO se puede escribir.** Pasadas 24 h desde el ultimo mensaje del
  cliente, el cuadro de texto se cambia por el selector de plantillas aprobadas,
  con la razon escrita. A un contacto dado de baja no se le puede escribir, y lo
  dice.
- **Guarda todo lo que llega**, incluido lo que el bot no sabe atender: una foto,
  un audio o un documento aparecen en el hilo para que lo vea una persona.
- **Trae lo que se hablo antes** (solo con WAHA, boton ⭳): el webhook solo
  entrega lo que pasa desde que se conecta, asi que las conversaciones que ya
  tenian los bots se importan del propio WhatsApp. Se puede pulsar las veces
  que haga falta: cada mensaje se guarda con su id y no se duplica.
- **Cierra y respalda** una conversacion terminada (boton 🗄): ver mas abajo.
- **Manda ubicaciones**: pegas un link de mapa y sale el pin, o pides la
  ubicacion del cliente con el boton nativo.
- Todo pasa por las mismas guardas que el resto del sistema.

---

## Ubicaciones para reparto (el trabajo de GSG)

`/rutas` es la pantalla del reparto: se pega la lista del dia, se le da a
empezar y el sistema le pide la ubicacion a cada cliente, uno por uno.

**El circuito completo:**

1. **Entra el lote.** Una tabla pegada, un CSV de Excel o —cuando GSG tenga
   API— un POST con las filas en JSON a `/admin/rutas/lotes`. Las columnas se
   reconocen por su nombre en cualquier orden (`telefono`, `nombre`, `pedido`,
   `direccion`, `distrito`), y una lista de numeros a secas tambien entra.
2. **Se revisa antes de escribir a nadie.** Cada telefono pasa por el plan de
   numeracion (Peru por defecto). Los de ocho digitos, los fijos, los que
   traen letras y los repetidos se apartan con su codigo de incidencia y su
   explicacion. **No se les manda nada**: cada envio contra un numero que no
   existe le baja la reputacion al numero propio.
3. **Se pide la ubicacion.** Un mensaje cada 15-30 segundos (sorteado dentro
   de ese rango), solo dentro del horario del negocio. Con la Cloud API sale
   la plantilla aprobada; con un cliente no oficial, texto con el boton nativo
   de ubicacion, que al cliente le cuesta un toque.
4. **Se lee lo que contesta.** El pin cierra el caso. Un enlace de mapa,
   tambien. "No soy yo" corta los envios a ese numero para siempre. Cualquier
   otra respuesta aparta al cliente para que lo mire una persona —puede ser
   una direccion perfectamente util— y el bot vuelve a pedirselo reconociendo
   que contesto, que no es el mismo mensaje de antes.
5. **Tres intentos y se acabo.** El caso pasa al repartidor para que llame.
   Insistir mas no consigue ubicaciones, consigue bloqueos. Si el cliente
   manda la ubicacion despues de derivado, se resuelve igual y la bitacora
   dice que ya no hace falta llamar; si escribe antes de que se le pidiera
   nada, se apunta y el primer mensaje sale cuando le toque. Un socket caido
   o un error pasajero de WhatsApp no gastan intento: se reintenta en unos
   minutos. La cadencia por cliente la fija el reparto (espera e intentos),
   no la separacion general del marcapasos.
6. **Todo queda documentado.** Cada envio, cada respuesta y cada incidencia se
   apunta con su hora en la bitacora de esa solicitud.

**Las incidencias tienen nombre propio**, que es lo que hace que se puedan
arreglar: `numero_corto`, `numero_largo`, `numero_invalido`, `numero_fijo`,
`sin_whatsapp`, `numero_equivocado`, `sin_respuesta`, `respondio_sin_ubicacion`,
`ubicacion_fuera_de_zona`, `rechaza_contacto`, `ya_en_curso` (el mismo numero
en un lote anterior que no termino: no se le escribe dos veces),
`envio_bloqueado`, `error_envio`. Cada una lleva su explicacion y su "que hacer" en
`src/rutas/incidencias.ts`, y viajan asi a GSG.

**Si el numero tiene WhatsApp** se comprueba antes del primer mensaje cuando el
proveedor lo permite (cliente local y WAHA). La Cloud API no ofrece esa
consulta: ahi se descubre al enviar, y el error 131026 de Meta se traduce a
`sin_whatsapp` en vez de quedarse en un "fallo desconocido".

**La pantalla** tiene una tarjeta por pregunta de la operacion, y cada tarjeta
filtra la tabla: con ubicacion, escritos sin respuesta, contestaron sin
ubicacion, sin escribir todavia, sin WhatsApp, numero mal escrito, para el
repartidor. Arriba, un aviso con cuantos casos esperan a una persona. Al abrir
un cliente se ve su historial y se puede corregir el telefono (vuelve a la cola
solo), cargar la ubicacion a mano si se consiguio por telefono, pasarlo al
repartidor o abrir su chat.

### Los avisos

Un tablero que nadie mira no avisa de nada, asi que hay dos avisos que salen
solos mientras el lote esta en marcha:

- **A GSG, cada 30 minutos** (`RUTAS_RESUMEN_CADA_MIN`): el avance del lote
  -cuantos con ubicacion, cuantos contestaron, cuantos no, cuantos esperan a
  una persona- por la misma cola que todo lo demas. No hay que esperar a que
  el lote termine para saber como va.
- **Al coordinador, por WhatsApp** (`RUTAS_SUPERVISOR`): "Reparto del jueves:
  12 de 40 con ubicacion. 5 sin contestar todavia. 3 casos necesitan que
  alguien los vea (2 numero incompleto, 1 el numero no tiene WhatsApp)". Como
  mucho uno por hora y por lote (`RUTAS_ALERTA_CADA_MIN`), y solo si de verdad
  hay casos parados (`RUTAS_ALERTA_MIN_CASOS`). Sin numero configurado, no se
  molesta a nadie y todo queda en la pantalla.

En la pantalla, la barra de progreso dice cuantas ubicaciones van y el punto
de color dice que esta haciendo el motor ahora mismo: enviando, esperando al
horario o parado.

### Conectar el sistema de GSG

Hoy **no hay API que llamar**, y el modulo esta construido contando con eso.
Cada ubicacion conseguida, cada incidencia y el resumen de cada lote se arman
con su forma definitiva y se guardan en la cola (`rutas_reportes`). Se pueden
mirar y descargar en NDJSON desde la pantalla.

El dia que exista la API, esto es **todo** lo que hay que hacer:

```bash
GSG_URL=https://api.gsg.example/v1
GSG_TOKEN=el-token-que-den
```

Se reinicia y la cola entera sale sola —incluido lo acumulado de semanas
anteriores— contra tres endpoints: `POST /ubicaciones`, `POST /incidencias` y
`POST /resumenes`. El contrato de lo que se manda esta en `PAYLOADS`, en
`src/rutas/gsg.ts`. No hay que tocar el motor, ni la pantalla, ni volver a
pedirle nada a ningun cliente.

Mientras tanto, el resultado del lote se baja en CSV (`Descargar CSV`) con
telefono, pedido, estado, coordenadas, incidencia y detalle.

### Las plantillas de ubicacion

Seis, todas UTILITY y ya en el catalogo (`npm run templates:lint` las da por
buenas): dos por paso, que dicen lo mismo con otras palabras.

| Paso | Plantillas | Cuando sale |
|---|---|---|
| solicitud | `solicitud_ubicacion`, `solicitud_ubicacion_b` | primer mensaje |
| recordatorio | `recordatorio_ubicacion`, `recordatorio_ubicacion_b` | no contesto en 30 minutos |
| insistencia | `ubicacion_pendiente`, `ubicacion_pendiente_b` | contesto, pero no mando la ubicacion |

Dos por paso por una razon concreta: Meta **pausa** una plantilla en cuanto
recibe quejas (3 h la primera vez, 6 h la segunda, la tercera la deshabilita
para siempre). Con una sola plantilla, esa pausa es el reparto entero parado.
El motor alterna entre las aprobadas de cada paso —la de mejor calidad y
menos usada en 24 h— y deja fuera las pausadas hasta que Meta las suelte
(`src/salud/variantes.ts`). Con el cliente no oficial no hay plantillas: cada
paso tiene tres redacciones y a cada cliente le toca una segun su telefono e
intento, para que no salgan doscientos mensajes identicos seguidos.

Se dan de alta con `npm run templates:push` y las aprueba Meta (suele tardar
minutos, a veces horas). **Meta no tiene una plantilla de "pedir ubicacion"**:
lo que se aprueba es el texto, y el boton nativo de ubicacion solo existe
dentro de la ventana de 24 h o con cliente no oficial. Por eso el texto de la
plantilla explica el camino del clip, que funciona siempre.

### Ajustes

Todo esto se cambia tambien **desde la pantalla** (`/rutas`, boton Ajustes),
sin reiniciar: pausas, espera antes de insistir, mensajes por cliente,
horario y -lo que importa- **que se le dice al cliente en cada paso**: con
que plantillas de Meta (el motor alterna entre las marcadas y deja fuera las
pausadas) y con que redacciones cuando se escribe libre (una por linea,
admiten `{nombre}`, `{pedido}` y `{negocio}`; el sistema las alterna). Lo
guardado manda sobre las variables de abajo; "Volver a la configuracion" lo
borra.

Las plantillas propias se crean en el panel (Plantillas): nombre, cuerpo con
`{{1}}`, `{{2}}`..., y que es cada variable. Pasan por el linter, con la API
oficial quedan pendientes hasta subirlas y que Meta las apruebe, y con el
cliente no oficial se usan en el acto. En una plantilla propia el orden de
las variables es fijo: `{{1}}` nombre del cliente, `{{2}}` pedido, `{{3}}`
negocio.

```bash
RUTAS_PAUSA_MIN_SEG=15     # pausa entre mensajes, se sortea entre los dos
RUTAS_PAUSA_MAX_SEG=30
RUTAS_ESPERA_MIN=30        # cuanto se espera una respuesta antes de insistir
RUTAS_MAX_INTENTOS=3       # mensajes por cliente antes de pasarlo a una persona
RUTAS_HORA_INICIO=9        # franja horaria de envio, hora del negocio
RUTAS_HORA_FIN=19
RUTAS_PAIS=peru            # peru | mexico | generico
```

La pausa de rutas es la propia del reparto; por encima manda el marcapasos
del numero (cupos por minuto y hora, tier de Meta, factor de riesgo): si el
monitor tiene el numero en amarillo, los 15-30 s pasan a ser 30-60. Ver
"Que evita realmente que bloqueen el numero".

```bash
RUTAS_SUPERVISOR=          # a quien se avisa por WhatsApp; vacio = a nadie
RUTAS_ALERTA_MIN_CASOS=1   # casos parados a partir de los cuales se avisa
RUTAS_ALERTA_CADA_MIN=60   # como mucho, un aviso por hora y por lote
RUTAS_RESUMEN_CADA_MIN=30  # cada cuanto se le manda el avance a GSG
```

### Consentimiento

Al cargar el lote, cada cliente con telefono valido queda con su opt-in
registrado y con el origen escrito: `reparto: pedido P-1024 (Reparto del
jueves)`. No es un tramite: es lo que permite escribirle, y la prueba de por
que se le escribio. **Quien se dio de baja antes no entra**: esa baja manda
sobre el pedido, la solicitud se marca para coordinarla por telefono y no se
le manda nada.

---

## Respaldo de conversaciones

El historial de WhatsApp vive en el telefono, y el telefono se pierde: si Meta
borra el numero, si alguien reinstala, si la cuenta cae. Lo hablado con cada
cliente es la prueba de lo que se acordo.

Cerrar un chat (boton 🗄 en la cabecera del hilo) escribe la conversacion
entera en un fichero `.ndjson.gz` y la vacia de la base. El orden es el que
importa: **primero se escribe el respaldo, se vuelve a leer entero para
comprobar que se abre, y solo entonces se borra**. Si algo falla, lo que queda
es un respaldo de mas, nunca un hilo borrado sin copia.

- Lo que se borra es el hilo, no el contacto: el numero, el opt-in y la ficha
  de preventa siguen donde estaban.
- Los respaldos se leen, se descargan y se devuelven al chat desde el mismo
  boton 🗄 de la barra lateral.
- Se cierran solos los chats sin movimiento (`ARCHIVE_INACTIVE_DAYS`, 60 dias
  por defecto; 0 lo desactiva) y al cerrar la ficha de preventa como enviada o
  descartada (`ARCHIVE_ON_LEAD_CLOSE`).
- `GET /admin/archives-revision` comprueba que los ficheros siguen en disco y
  con el mismo sha256.

```bash
ARCHIVE_DIR=respaldos      # donde van los ficheros
ARCHIVE_INACTIVE_DAYS=60   # 0 = no cerrar nada solo
ARCHIVE_ON_LEAD_CLOSE=true
```

---

## Lo que se puede y lo que no

| | |
|---|---|
| Recibir ubicacion nativa | ✅ el webhook trae lat/lng exactas |
| Recibir un link de mapa | ✅ 11 formatos, ver abajo |
| Enviar un pin de ubicacion | ✅ `type: location` |
| Enviar **live location** | ❌ **la Cloud API no lo soporta**: es una funcion de la app de consumidor |
| Pedir la ubicacion con un boton | ✅ `location_request_message` |
| Envio masivo | ✅ con plantilla aprobada + opt-in |
| Responder texto libre | ✅ solo dentro de las 24 h desde el ultimo mensaje del cliente |

El "tiempo real" se resuelve con una pagina propia: WhatsApp solo transporta el
link. A cambio se gana caducidad controlada, varios espectadores e historico.

---

## Automatizacion

Tres piezas, todas configurables desde `/panel` sin tocar codigo.

**Reglas de respuesta.** Se evaluan sobre lo que escribe el cliente, despues de
BAJA/ALTA y antes de buscar coordenadas:

| Disparador | Cuando |
|---|---|
| `keyword` | el texto contiene, empieza por o es exactamente una palabra |
| `first_message` | el primer mensaje que manda ese contacto (bienvenida) |
| `any` | cualquier texto sin coordenadas que no caso con nada |

Una regla responde, inscribe en una secuencia, o las dos cosas. En los textos
valen `{nombre}`, `{telefono}` y `{fecha}`.

**Secuencias de seguimiento.** Una lista ordenada de pasos con retardo (minutos,
horas o dias desde el paso anterior). Cada paso es una plantilla aprobada o un
texto libre. Al inscribir a un contacto se programa el primer paso; cuando ese
sale, se programa el siguiente.

Si el contacto responde, la secuencia se cancela (configurable por secuencia).
Es lo que evita mandar "no hemos sabido de ti" a quien acaba de contestar.

**Mensajes programados.** Un envio suelto a una fecha y hora. Los pasos de las
secuencias viven en la misma tabla, asi que se ven y se cancelan igual.

Un ticker procesa lo vencido cada 10 segundos. Ningun camino se salta las
guardas: un paso bloqueado con espera (cupo diario, calidad en amarillo) se
reprograma sin avanzar la secuencia; uno bloqueado en firme (baja, sin opt-in)
la cierra, porque insistir solo suma bloqueos.

---

## Arquitectura

```
WhatsApp Cloud API
      │  webhook (firma X-Hub-256, responde 200, procesa despues, deduplica)
      ▼
 handlers/inbound ──▶ geo core (extract)   ──▶ locations
      │            └─▶ automation (reglas) ──▶ enrollments
      ▼
 outbound/sender ◀── gates (opt-in · ventana 24 h · calidad · frecuencia · cupo)
      │                       ▲
      │                       │
      ├─▶ outbound/queue      └── automation/engine (ticker de programados)
      └─▶ whatsapp/client (API oficial)

 tracking/ ── token firmado ─▶ /t/:token ─▶ WebSocket ─▶ Google Maps o Leaflet
```

| Modulo | Que hace |
|---|---|
| `src/geo/` | extraccion de lat/lng, sin dependencias externas |
| `src/whatsapp/` | firma del webhook, cliente de la Graph API, router de eventos |
| `src/whatsapp/local/` | proveedor local: socket de Baileys, QR, codigo de vinculacion y traductor |
| `src/whatsapp/waha/` | proveedor no oficial: cliente, sesion con QR y traductor del webhook |
| `src/handlers/` | conversacion: ubicacion, confirmacion, alta, baja y reglas |
| `src/automation/` | reglas, secuencias, programados y su ticker |
| `src/templates/` | catalogo, linter, registro local y sincronizacion con Meta |
| `src/outbound/` | gates, warm-up, sender y cola |
| `src/salud/` | politica de ritmo, marcapasos, riesgo, monitor, supresion por contacto, variantes y escritura simulada |
| `src/campanas/` | campanas por goteo con canario |
| `src/servicios.ts` | los procesos de fondo (monitor, secuencias, goteo, rutas, avisos, GSG), que arrancan igual en `dev` y en `quick` |
| `src/tracking/` | tokens, hub de posiciones y paginas de rastreo |
| `src/rutas/` | solicitud de ubicacion por lotes: revision de numeros, motor, incidencias y puerta a GSG |
| `src/archive/` | respaldo de conversaciones cerradas: fichero, verificacion y barrido |
| `src/admin/` | API de operacion y del chat |
| `src/api/v1/` | la API publica para otros sistemas: rutas con permiso y contrato OpenAPI |
| `src/eventos/` | el bus de eventos y el envoltorio de repositorios que los emite |
| `src/webhooks/` | webhooks salientes: suscripciones, firma, cola de entregas y reintentos |
| `src/embed/` | el chat embebido en otras webs: token, pagina, `embed.js` y cabeceras |
| `src/conectores/` | conectores de tiendas (WooCommerce, Shopify): firma, lectura del pedido, reglas y registro |
| `saas/` | una instancia por tienda: alta, baja, estado, Caddy y el panel maestro |
| `src/ia/` | el asistente de IA de la tienda: proveedores (Puter, OpenAI-compatible), conocimiento del sistema, escenarios, turno y derivacion |
| `src/web-visitantes/` | el chat para los visitantes de la web del negocio: sesion, mensajes, SSE y `widget.js` |
| `src/web/` | `/chat`, `/rutas`, `/setup` y `/panel` |
| `src/runtime.ts` | arranque comun del servidor y de los CLIs |

---

## Geo core: formatos soportados

| Fuente | Ejemplo |
|---|---|
| `whatsapp_native` | mensaje de ubicacion del webhook |
| `data_3d4d` | `/data=!8m2!3d-12.04!4d-77.04` |
| `path_coords` | `/maps/place/-12.04,-77.04` |
| `query_param` | `?q=` `?query=` `?destination=` `?daddr=` |
| `ll_param` | `?ll=` `?center=` `?mlat=&mlon=` (Waze, Apple, OSM) |
| `geo_uri` | `geo:-12.04,-77.04` |
| `osm_hash` | `#map=17/-12.04/-77.04` |
| `dms` | `19°25'57.4"N 99°07'59.5"W` |
| `plus_code` | `8FVC2222+22` (solo codigos completos) |
| `at_viewport` | `@-12.04,-77.04,17z` — **baja confianza** |
| `bare_text` | `-12.0464, -77.0428` pegado en el chat |

Acortadores (`maps.app.goo.gl`, `goo.gl`) se resuelven siguiendo redirects.

**Dos decisiones que conviene no tocar sin querer:**

1. **`!3d/!4d` gana sobre `@lat,lng`.** El `@` es el centro de la camara, no el
   lugar: si el usuario arrastro el mapa antes de compartir, apunta a cientos de
   metros. Cuando solo hay `@`, el resultado sale con `needsConfirmation: true`
   y el bot pregunta antes de que alguien salga a repartir. Orden en `PARSERS`
   (`src/geo/parsers.ts`).
2. **Los acortadores se resuelven con allowlist.** Abrir una URL que llego de
   fuera es un SSRF: bastaria un link que redirija a `169.254.169.254`.
   `src/util/net-guard.ts` limita hosts, exige IP publica en cada salto y corta
   a 5 redirecciones.

---

## Que evita realmente que bloqueen el numero

Meta no mide el volumen: mide **cuanta gente te bloquea y te reporta** en los
ultimos 7 dias, con mas peso a lo reciente. Una plantilla aprobada mandada a
una lista comprada tumba el numero igual. Y con un cliente no oficial
(Baileys, WAHA) el criterio es parecido -patron de robot, numeros que no te
tienen agendado, nadie contesta- pero sin aviso previo: el baneo llega y ya.

Por eso hay tres capas, y ninguna se puede apagar.

### 1. Las guardas: lo que no sale nunca

Van cableadas en `outbound/gates.ts` y no hay forma de saltarselas:

| Guarda | Regla |
|---|---|
| `opt_out` | una baja bloquea todo, sin excepciones ni override |
| `no_opt_in` | sin `opt_in_at` no sale nada iniciado por la empresa |
| `window_closed` | fuera de las 24 h solo se puede mandar plantilla |
| `template_not_approved` | solo plantillas APPROVED en el registro local |
| `template_paused` | Meta la pauso (3 h / 6 h): se respeta la pausa aunque el webhook del final no llegue nunca |
| `template_quality` | plantilla en rojo (o amarillo si es marketing) se frena |
| `number_quality` | numero en rojo corta todo; en amarillo corta marketing |
| `contact_suppressed` | contacto apartado: sin WhatsApp (131026, un mes), saturado de marketing (131049, un dia), pidio no recibirlo (131050) |
| `risk_marketing_paused` | el monitor tiene el marketing parado (naranja/rojo) |
| `frequency_cap` | maximo N mensajes de marketing por contacto cada 7 dias |
| `fatigue` | N mensajes de negocio seguidos sin respuesta: nada de marketing hasta que escriba |
| `contact_daily_cap` · `contact_spacing` | como mucho 3 al mismo contacto por dia, y 10 min entre dos (el `131056` de Meta, evitado antes de que pase) |
| `daily_cap` | warm-up: arranca en 50/dia (20 en no oficial) y crece cada dia, con techo duro |
| `rhythm` | el marcapasos dijo "todavia no": horario, tier, cupos, contactos nuevos o la pausa entre envios |

Un rechazo con espera (cupo, horario, separacion) se reprograma; uno
definitivo (baja, sin opt-in, fatiga) se descarta. Todo intento -salga o no-
deja fila en `deliveries`, y un fallo del proveedor queda como `failed` con su
codigo: eso es lo que mira la segunda capa.

Escribir a mano desde `/chat` se salta el ritmo, el horario y los cupos -es
una persona escribiendo a otra-, pero no la baja ni el freno de emergencia.

### 2. El marcapasos: un solo ritmo para todo el numero

Antes cada modulo llevaba el suyo (rutas 15-30 s; campanas diez por segundo;
secuencias lo que venciera). WhatsApp mira el numero entero, asi que el ritmo
es uno (`src/salud/ritmo.ts`) y todo lo iniciado por la empresa pasa por el.
Responder a un cliente dentro de su ventana no: eso es una conversacion.

Mira, en orden: horario y dia del negocio; el **tier de Meta** (destinatarios
unicos en 24 h moviles, que es exactamente lo que Meta cuenta; se para al
90 %); cupos por minuto y por hora; contactos nuevos por dia (no oficial); y
una pausa sorteada entre envios con forma de campana, no plana. Todos los
cupos se escalan por el **factor de riesgo**: en amarillo la mitad, en naranja
un quinto, en rojo nada.

Dos perfiles, elegidos por el proveedor (`RITMO_PERFIL=auto`):

| | `cloud` (API oficial) | `no_oficial` (Baileys / WAHA) |
|---|---|---|
| por minuto / por hora | 20 / 400 | 4 / 80 |
| pausa entre envios | 2-6 s | 15-45 s |
| warm-up | 50/dia x1.5, tope 1000 | 20/dia x1.6, tope 400 |
| contactos nuevos por dia | sin limite (el tier manda) | 80 |
| escritura simulada | no aplica | si: `composing`, espera lo que tardaria en teclearse, `paused`, envio |
| tier de Meta | se respeta al 90 % | no existe |

Todo se ajusta por variable (`RITMO_*`, `HORARIO_ENVIO_*`, `SALUD_*`; ver
`.env.example`) y se ve en el panel, seccion **Riesgo y ritmo** (`/panel#salud`).

### 3. El monitor: el que mira y reacciona

`src/salud/monitor.ts` corre cada minuto. Junta las senales, las convierte en
puntos (`src/salud/riesgo.ts`) y actua:

| Senal | Puntos |
|---|---|
| Meta pone el numero en rojo (`FLAGGED`), `131048`, cuenta restringida (`131031`, `368`), `403` del socket | 100: rojo |
| Meta en amarillo | 40 |
| mas del 20 % de fallos en los ultimos 50 envios (40 % → 70) | 40 |
| mas del 15 % de "no tiene WhatsApp" (`131026`): lista sucia | 30 |
| bajas en 24 h por encima del 2 % (5 % → 60) | 30 |
| menos del 60 % entregado de lo enviado hace mas de una hora | 40 |
| gente contestando "no soy yo" / "no me escriban" | 20 |
| rechazos por velocidad (`130429`) en 10 min, `131056` repetido, tres desconexiones en una hora | 15-20 |
| no oficial: mas de 15 salientes por cada entrante en 24 h (parece un robot) | 15 |

0-29 verde (ritmo normal) · 30-59 amarillo (mitad) · 60-84 naranja (un quinto
y sin marketing) · 85+ rojo: **el numero se pausa solo**, con hora de vuelta
(4 h; 24 h con `131048`; sin hora si es un baneo o una cuenta restringida, que
no se arreglan esperando). Cuando vence, reanuda **despacio**: rampa del 10 %
al 100 % en dos horas, y las ventanas de senales empiezan de cero para no
volver a disparar por lo mismo. Cada cambio de nivel avisa por WhatsApp al
coordinador (`RUTAS_SUPERVISOR` / `SALUD_AVISAR_A`), una vez por nivel y por
media hora, y queda en `salud_eventos` con su motivo.

Ademas, en caliente, cada error de envio aplica su regla (`src/salud/supresion.ts`):
`131026` aparta al contacto un mes; `131049` un dia, solo de marketing;
`131050` para siempre, solo de marketing; `131056` dos horas; `130429` frena;
`131048` / `131031` / `403` paran todo. Un contacto apartado no vuelve a
intentarse: cada intento contra un numero que no recibe le baja la reputacion
al numero propio.

Y un numero que estuvo dias sin enviar nada (7 oficial, 4 no oficial) vuelve a
empezar el warm-up de abajo.

Los webhooks que alimentan esto, ademas de los tres de siempre
(`message_template_status_update` con sus pausas `FIRST_PAUSE` / `SECOND_PAUSE`,
`message_template_quality_update`, `phone_number_quality_update` con `FLAGGED`
/ `UNFLAGGED`): los `statuses` con `failed` y su codigo (el `131049` llega
asi, nunca en la respuesta del POST), `account_update` (restriccion o baneo de
la cuenta: pausa; `REINSTATE`: suelta), `user_preferences` (la persona pulso
"dejar de recibir marketing"), `business_capability_update` (el limite exacto
del tier) y `template_category_update`. Con la API oficial, el estado de las
plantillas se sincroniza ademas cada media hora, porque del final de una pausa
Meta no avisa.

### Modo prueba: `SOLO_NUMEROS`

Para probar contra un WhatsApp de verdad sin escribirle a un cliente por
error: con `SOLO_NUMEROS=51902464984,51912426667` **nada** sale a otro
numero, venga de una campana, una secuencia, el motor de rutas, el chat a
mano o el asistente. Cada intento queda anotado como `allowlist`. Vacio es
produccion.

### Lo que WhatsApp Web reentrega al reconectar

Al abrir la sesion, WhatsApp Web vuelve a entregar los ultimos mensajes de
cada chat (`messages.upsert` de tipo `append`) y lo que se acumulo mientras
el sistema estaba apagado. Antes eso se trataba como mensajes nuevos y el
asistente contestaba a media libreta de golpe. Ahora lo que no llega en
vivo -o llega con mas de diez minutos- se **guarda en el hilo sin
contestar**, y un mensaje ya atendido (mismo id) no se atiende dos veces
aunque se reciba otra vez. Ver `esMensajeViejo` en `src/whatsapp/local/session.ts`.

### Campanas por goteo, con canario

Una campana ya no se vuelca en la cola. Los destinatarios se guardan
ordenados por compromiso (quien escribio hace poco primero: Meta mira como
cae una plantilla en sus primeras horas), sale primero un **canario** (el
10 %, entre 5 y 20), se espera una hora y se mira que paso: fallos, `131049`,
numeros sin WhatsApp, bajas, entrega. Si algo huele mal, el resto se queda
parado y la campana dice por que; si no, sigue al ritmo del marcapasos (y,
si se quiere, con un tope propio por hora). Se pausa, reanuda y para desde
la pestana Campanas. `src/campanas/goteo.ts`.

**Lo que este proyecto no hace:** rotacion de numeros para evadir limites,
proxies ni envio sin opt-in. Ademas de estar fuera de los terminos, es lo que
provoca el baneo permanente. Los clientes no oficiales existen como camino
corto, con su perfil lento y su aviso: el riesgo es real.

---

## Plantillas

El catalogo (`src/templates/catalog.ts`) es lo que se manda a aprobar; el estado
real lo mantienen la sincronizacion y los webhooks. Desde el panel se hace lo
mismo sin terminal.

```bash
npm run templates:lint    # revisa sin tocar nada
npm run templates:push    # revisa y da de alta en Meta (se niega si hay errores)
npm run templates:sync    # trae estado y calidad desde Meta
```

Los tres usan las credenciales vigentes, incluidas las que pegaste en `/setup`.

Las plantillas propias se crean desde el panel y se listan junto al
catalogo, con el mismo linter y el mismo boton de alta en Meta.

El linter (`src/templates/lint.ts`) implementa las reglas de aprobacion como
codigo: opt-out obligatorio en marketing, deteccion de marketing disfrazado de
utility, lexico que dispara los filtros de spam, mayusculas sostenidas, y las
reglas de variables de Meta (numeracion sin saltos, no empezar ni terminar con
variable, no dos seguidas).

Vienen cuatro listas y sin errores: `confirmacion_pedido`,
`seguimiento_entrega`, `recuperacion_carrito` (marketing, con BAJA) y
`recordatorio_cita`.

---

## Rastreo en vivo

Cada sesion emite **dos** tokens firmados: uno para quien publica su posicion y
otro para quien la mira. Que sean distintos es lo que impide que quien recibe el
link pueda falsear la posicion.

```bash
curl -X POST localhost:3000/admin/tracking \
  -H "authorization: Bearer wak_..." \
  -H 'content-type: application/json' \
  -d '{"phone":"51987654321","label":"Pedido A-1024","notify":true}'
```

Devuelve `publishUrl` (para el repartidor) y `viewUrl` (para el cliente). Los
puntos se persisten filtrados: solo si hubo 15 m de movimiento o 10 s desde el
ultimo guardado, aunque al mapa se reparten todos. El panel lista las sesiones
vigentes, cuanta gente las mira y permite revocarlas.

Rastrear a una persona requiere su consentimiento explicito y registrado (en
Peru, Ley 29733 de proteccion de datos personales). El token con caducidad y revocacion cubre parte de eso por
diseno.

---

## La web

Nada de esto necesita editar ficheros ni usar la terminal. Todas las pantallas
comparten el mismo armazon (`src/web/shell.ts`): menu lateral agrupado por lo
que hace cada cosa, buscador de modulos con `Ctrl K`, barra superior con el
titulo de la pantalla y quien esta dentro, y plegable a solo iconos. En el
movil el menu se esconde y sale con el boton de arriba.

| Ruta | Que es |
|---|---|
| `/` | portada publica: que hace el sistema y el boton de entrar |
| `/login` | entrar con usuario y contrasena (la primera vez, crear la primera cuenta) |
| `/panel#inicio` | **inicio**: cifras de hoy, la semana, el semaforo del numero, el reparto y lo que espera a una persona |
| `/chat` | conversaciones, como WhatsApp: leer, responder, mandar pin, pedir ubicacion, cerrar y respaldar |
| `/rutas` | ubicaciones para reparto: cargar el lote del dia, verlo avanzar y resolver lo que necesita una persona (`#ajustes` abre los ajustes) |
| `/panel#...` | las demas secciones: estado, salud, enviar, contactos, ubicaciones, en vivo, campanas, automatizacion, plantillas, historial, extraer, **configuracion**, usuarios, **integraciones**, **actividad** y **mi cuenta** |
| `/setup` | conectar la cuenta (QR, WAHA o la API de Meta), activar el numero y mandarse una prueba |
| `/manual` | manual de uso: como empezar, el reparto paso a paso, los colores del semaforo y todos los modulos |
| `/soporte` | que mirar si algo falla y un diagnostico en vivo para copiar al reportar |
| `/t/<token>` | pagina de rastreo (Google Maps si hay clave; si no, OpenStreetMap) |

El menu:

```
Inicio · Manual de uso · Soporte · [Buscar modulo… Ctrl K]
ATENCIÓN           Chats · Mi asistente IA · Contactos · [Enviar mensaje · Historial de envios · Stickers]
REPARTO            [Ubicaciones para reparto · Ajustes del reparto]
CAMPAÑAS           [Enviar a un grupo · Campañas · Respuestas automáticas · Mensajes aprobados (plantillas)]
UBICACIONES        [Ubicaciones recibidas · Rastreo en vivo · Extraer coordenadas]
¿VA TODO BIEN?     [Estado del número · Riesgo y ritmo]
MI NEGOCIO         Conexión de WhatsApp · Conectar mi web y tienda · Configuración · [Usuarios · Actividad]
                   (entre corchetes: solo con "Ver todo", el modo avanzado)
```

Arriba a la derecha, en todas las pantallas: la **campana** (lo que espera a
una persona: chats sin responder, casos del reparto, el numero en naranja o
rojo, envios pausados, WhatsApp desconectado; se refresca cada medio minuto y
el numero sale tambien en el titulo de la pestaña), el boton de **ayuda** (abre
el manual en la parte de esa pantalla) y tu nombre (abre **Mi cuenta**).

### Configuracion general (`/panel#configuracion`)

Lo que antes solo se cambiaba en el `.env` y reiniciando, ahora se cambia desde
la pantalla y se aplica en el siguiente envio: nombre del negocio, **horario de
envio** (horas y dias), **ritmo** (mensajes por minuto y por hora, pausas,
contactos nuevos por dia, mensajes por contacto), **modo prueba** (a que
numeros se escribe y se contesta), **avisos** (el WhatsApp del supervisor) y
escritura simulada / pausa automatica. Un campo vacio significa "lo que diga el
servidor" y el valor efectivo se ve en gris. "Volver a lo del servidor" borra
todo lo guardado. Solo un administrador lo cambia; un operador lo ve.

Una excepcion a proposito: si el servidor arranco con `SOLO_NUMEROS`, desde la
pantalla solo se puede **recortar** esa lista, nunca ampliarla ni apagar el
modo prueba. Es el freno de mano de quien despliega.

### Enviar a un grupo (`/panel#grupos`)

Elegir clientes por como estan y escribirles a todos, personalizado, sin ir
uno por uno. Los filtros cruzan lo que el sistema ya sabe: consentimiento,
**ubicacion del reparto** (todavia sin ubicacion, contesto sin ubicacion,
derivado, ya con ubicacion, con incidencia, nunca se le pidio), un lote,
**ficha de pedido** (sin ficha, incompleta, completa, enviada a ventas),
**actividad** (escribio en los ultimos N dias, callado, ventana de 24 h
abierta, nunca escribio), busqueda y una lista pegada. "Ver quienes son" da
el total, cifras y la tabla. Lo que se manda es una plantilla (Meta o propia)
o, sin la API oficial, un texto con `{nombre}` `{pedido}` `{negocio}`
`{direccion}` `{distrito}` que se convierte en plantilla propia al vuelo; la
vista previa enseña el mensaje de cada cliente con sus datos. Sale como
campaña por goteo (canario, ritmo, horario); tambien se puede inscribir al
grupo en una secuencia o exportarlo. Codigo en `src/segmentos/`.

### Atajos del chat

Una barra de **botones** sobre el cuadro de escribir: "Pedir ubicacion",
"Mandar pin" y una pastilla por respuesta rapida (clic la manda al instante con
el nombre del cliente; Shift+clic la deja en el cuadro para retocarla). Lo que
se escribe a mano desde el chat no espera la escritura simulada: sale con un
parpadeo de "escribiendo..." y ya. Tambien con `/` en el mensaje (se filtran al escribir, Enter o Tab
las pone con `{nombre}`, `{pedido}` y `{negocio}` rellenos; se editan en
Automatizacion → Respuestas rapidas), `⚡` para verlas todas, `Alt+↓/↑` para
cambiar de conversacion, `Ctrl+Shift+U` pide la ubicacion, `Ctrl+Shift+L` abre
el pin, `/` fuera del mensaje va al buscador, `F1` la lista. La cabecera del
chat dice el pedido del reparto y en que punto va.

La lista de chats tiene filtros: **Todos · Sin leer · Esperan respuesta ·
Escribieron hoy**. La cabecera de cada chat dice el pedido del reparto y en que
punto va.

### Stickers (`/panel#stickers`)

Un toque humano despues de un mensaje. Se suben PNG, JPG, GIF o WebP y el
sistema los convierte a lo que WhatsApp pide (WebP 512x512 con fondo
transparente, con `sharp`); los ficheros van a `.wa-media/stickers/` y se
sirven en publico en `/stickers/<archivo>` (la API de Meta se lo baja de ahi).
Se elige cual sale **solo** en cada momento: tras el saludo del asistente a un
cliente nuevo (y, si se marca, tras el primer mensaje del reparto), tras el
"gracias" (mando su ubicacion o completo la ficha) y en la despedida (pasa al
repartidor). Desde el chat se manda cualquiera con el boton 🙂, y una respuesta
rapida puede llevar uno pegado (Automatizacion → Respuestas rapidas). Un
sticker nunca frena nada: si las guardas lo bloquean, no sale y ya. Con el QR
(Baileys) sale como sticker de verdad; con la API de Meta, dentro de las 24 h;
con WAHA, como imagen. Codigo en `src/stickers/`.

### Actividad (`/panel#actividad`)

La bitacora: cada accion que cambia algo deja una fila con quien, que, cuando,
el detalle (sin contraseñas ni claves) y la IP. Se apunta sola desde un hook
del servidor (`src/auth/actividad.ts`), asi que no depende de acordarse en cada
ruta: entrar (y los intentos fallidos), crear o cambiar usuarios, crear o
revocar claves, guardar configuracion, pausar envios, cargar lotes, cambiar
plantillas, lanzar campañas... Solo la leen los administradores.

### Exportar

**Historial de envios** y **Contactos** tienen "Descargar CSV" con los mismos
filtros de la pantalla (`/admin/deliveries.csv`, `/admin/contacts.csv`); el
reparto ya tenia el suyo por lote. Separador `;` y BOM: abren en Excel en
español sin tocar nada.

### Entrar: usuarios y sesiones

No hay ningun token de administracion. Se entra por `/login` con usuario y
contrasena, y la sesion queda en una cookie firmada (`wa_sesion`, siete dias,
`HttpOnly`). Sin sesion, las pantallas mandan al login y `/admin/*` responde
401.

- **La primera cuenta.** Mientras la tabla `usuarios` este vacia, `/login`
  ofrece crear la primera cuenta, que nace administradora. En cuanto existe,
  esa puerta se cierra y solo queda entrar.
- **Dos roles.** `admin` hace todo, incluido crear y gestionar usuarios
  (seccion **Usuarios** del panel: crear, cambiar contrasena, cambiar rol,
  desactivar). `operador` usa el sistema entero pero no toca usuarios. Nadie
  puede desactivarse ni quitarse el rol de admin a si mismo.
- **Contrasenas.** Ocho caracteres o mas, guardadas con scrypt y sal; nunca en
  claro. Cada uno se cambia la suya desde la seccion Usuarios. Cambiar la
  contrasena o desactivar la cuenta cierra las sesiones abiertas de ese usuario.
- **Fuerza bruta.** Cinco fallos seguidos desde una IP y cinco minutos de
  espera.
- **Si no queda ningun administrador que pueda entrar**, se arregla desde el
  servidor: `delete from usuarios where usuario = 'x'` deja la tabla como
  estaba y, si queda vacia, `/login` vuelve a ofrecer crear la primera cuenta.
  O se pone una contrasena nueva con `hashClave` (`src/auth/usuarios.ts`).

### Claves de API: como entran los programas

Un programa (el sistema de GSG, un script, un `curl`) no tiene usuario ni
contrasena: manda `Authorization: Bearer wak_...` con una **clave de API** que
un administrador creo en `/panel#integraciones`, con nombre. La clave completa
se ve **una sola vez**, al crearla; en la base solo queda su sha256, asi que ni
un volcado de la tabla sirve para entrar. Revocarla es inmediato. Una clave no
puede crear usuarios ni otras claves: eso lo hacen solo las personas con rol
admin.

```bash
curl -H "authorization: Bearer wak_..." localhost:3000/admin/health
```

---

## Mi asistente IA

Lo que vende el sistema a una tienda: **que su WhatsApp conteste solo** con
lo que la tienda sabe, y que pase la conversacion a una persona cuando no
pueda. Todo desde `/panel#ia`, sin tocar nada mas:

1. **Cuentale de tu negocio.** Un cuadro de texto, escrito como se lo
   contarias a un empleado nuevo: que vendes, precios, envios, cambios,
   pagos, horario. Y, si quieres, como debe hablar (tutear, ser breve...).
2. **Con que IA.** Por defecto [Puter](https://puter.com), como en Stoky:
   sin llaves ni tarjeta. Se pulsa **"Conectar con Puter"**, se entra con
   Google, Microsoft, Apple o correo (gratis), y la sesion queda guardada
   **cifrada** en el servidor, que es quien contesta por WhatsApp aunque
   nadie tenga el panel abierto. Con Puter **solo se usan modelos
   completamente gratuitos**: en su catalogo en vivo
   (`api.puter.com/puterai/chat/models/details`, 1009 modelos) unicamente los
   dos Gemma 4 de Google tienen costo cero por token; GPT, Claude o Gemini
   "sin llave" descuentan de la asignacion de la cuenta de quien los usa. El
   catalogo se vuelve a mirar cada hora y, si el modelo guardado deja de ser
   gratis, se usa `google/gemma-4-31b-it` (`src/ia/modelos-gratis.ts`). Tambien se puede pegar
   un token a mano (puter.com → Dashboard → *Create token*), o usar cualquier
   API compatible con OpenAI (OpenAI, Groq, DeepSeek, Ollama en local).

   Lo que Stoky aprendio con Gemma viene puesto: se le pide que no razone en
   voz alta (`reasoning: {enabled: false}`, con reintento si el proveedor no
   lo acepta), se limpian los `<thought>…</thought>` que a veces devuelve, y
   los errores de Puter (sesion cerrada, sin saldo, modelo retirado) se
   explican en cristiano.
3. **Cuando pasar con una persona.** Si el cliente escribe "asesor",
   "reclamo" o lo que la tienda decida, o si el modelo no puede ayudar, el
   asistente se despide, **se calla en ese chat** (la misma pausa del bot
   que tiene el operador en `/chat`) y avisa por WhatsApp al supervisor.
4. **Pruebalo ahi mismo**: un chat de prueba en la pantalla, sin mandar nada
   por WhatsApp.

**Sabe como funciona el sistema por el que habla.** Ademas de lo que la
tienda escribe, el asistente lleva puesto lo que el sistema hace y no hace
(`src/ia/conocimiento-sistema.ts`): que puede pedir la ubicacion con el
boton de WhatsApp, que BAJA corta los mensajes, que el reparto pide el pin,
que los avisos de pedido de la tienda online salen solos, y que no puede
cobrar ni confirmar pagos (para eso pasa con una persona). Y puede
**ejecutar acciones** del sistema con dos marcas al final de su mensaje:
`[PEDIR_UBICACION]` manda el boton nativo de ubicacion (o el camino del clip
si el proveedor no lo tiene) y `[DERIVAR]` pasa con una persona. Derivar
manda sobre pedir ubicacion.


**Entrenado por escenarios.** El prompt lleva ejemplos de como responder
(saludo, precio que no sabe, envio, descuento, pedir la ubicacion, pago,
reclamo, "eres un bot", insulto, "ignora tus instrucciones") y el asistente
los imita. Y en la misma pantalla esta el **examen**: mas de sesenta
clientes de prueba por grupos (entrada, catalogo, stock, negociacion,
cierre, pago, envio, postventa, canal, mala intencion), escritos como en la
vida real. Se corren con el modelo real y cada respuesta se califica sola:
que no diga un precio que no esta en lo que sabe, que no prometa
descuentos ni cosas gratis, que no confirme pagos, que derive cuando toca
(reclamo, devolucion, cambio de direccion) y no cuando no toca, que pida la
ubicacion en un delivery, que no revele el modelo, que no se vaya de largo.
`src/ia/escenarios.ts`; `POST /admin/ia/escenarios`.
**El ayudante del panel.** En el manual (`/manual`, "Preguntale al
sistema") el dueño o un operador pregunta en su idioma ("¿como conecto
Shopify?", "¿por que no salio un mensaje?") y la misma IA responde con el
manual completo del sistema, diciendo en que pantalla se hace cada cosa.
Ruta `POST /admin/ia/ayuda`; usa la sesion de Puter del asistente.

Con el asistente encendido, el texto libre de los clientes lo contesta el
(en lugar del flujo de preventa y de la regla generica); lo que no es
conversacion sigue igual: BAJA/ALTA, ubicaciones, el reparto, las reglas
por palabra clave que la tienda escribio. Una foto o un audio se reconocen
("recibi tu foto, ¿me cuentas por escrito?") sin llamar al modelo. Si Stoky
esta conectado, el asistente ve precio y stock reales de lo que el cliente
pregunta. Si el modelo falla, el cliente recibe un "en un momento te atiende
una persona" y se avisa: nunca se queda sin respuesta ni ve un error.

En el SaaS cada tienda tiene su conocimiento y su token: es por instancia.
Codigo en `src/ia/`.

### El catalogo real de la tienda

En "Mi asistente IA" → *Catalogo de la tienda* se pega la URL de productos
de la web y el asistente deja de hablar de memoria: ve nombre, precio (y
el de oferta), stock y enlace de cada producto **de ahora mismo**, y manda
el enlace cuando toca. Formatos que entiende solos (`src/catalogo/tienda.ts`):

- **elysian**: la API de la tienda Elysian (`/api/products`, paginada, una
  linea por variante con su SKU).
- **woocommerce**: la Store API publica de WooCommerce
  (`/wp-json/wc/store/v1/products`).
- **simple**: cualquier lista JSON con `sku`, `nombre`/`name`,
  `precio`/`price`, `stock`, `url` (lo que un script de la tienda pueda
  publicar en cinco minutos).

Se cachea cinco minutos; si la tienda deja de responder se sigue con lo
ultimo bueno. "Probar" dice cuantos productos lee y ensena uno. Con Stoky
conectado y sin URL, se usa Stoky. Al modelo solo se le dan los productos
que casan con lo que pregunto el cliente (seis como mucho), asi que un
catalogo de mil productos no cuesta tokens de mas.

### Pedidos desde el chat

Con catalogo, el asistente **toma pedidos**: consigue en la conversacion
que producto y variante, cuantos, nombre, direccion (o recojo) y medio de
pago; cuando lo tiene todo, resume y cierra con una marca interna
(`[PEDIDO]{...}`) que el sistema comprueba contra el catalogo: los
precios y el total los pone el sistema, nunca el modelo. Lo que no existe
en el catalogo no entra. El cliente recibe el resumen con el total; la
tienda:

- lo ve en **Pedidos del chat** (`/panel#pedidos`): lineas, total,
  direccion, pago, estado (nuevo → confirmado / enviado a la tienda /
  cancelado); la campana avisa de los nuevos;
- se entera por el webhook `pedido.creado` (con el pedido completo y el
  contacto) y puede leerlos o cambiarles el estado por la API:
  `GET /api/v1/pedidos`, `GET /api/v1/pedidos/:id`,
  `PATCH /api/v1/pedidos/:id { estado, externoId }` con el permiso
  `pedidos:gestionar` (el `externoId` es el numero de pedido de la tienda).

El sistema no cobra ni confirma pagos: eso lo hace una persona o la tienda.
El bot no se pausa al tomar el pedido: el cliente puede seguir preguntando.
Codigo en `src/pedidos/`; tabla `pedidos_chat`.

## Modo sencillo

El menu arranca en **modo sencillo**: Inicio, Chats, Mi asistente IA,
Contactos, Conexion de WhatsApp, Conectar mi web y tienda, Configuracion.
Es lo que una tienda necesita para atender su WhatsApp con la IA. "Ver todo"
(abajo del menu) ensena lo demas: reparto, campañas, plantillas, rastreo,
ritmo y salud del numero, usuarios, actividad. Se recuerda en el navegador.

La tarjeta "Para empezar" del inicio son tres pasos: conectar el WhatsApp,
enseñarle al asistente y poner el chat en la web (o conectar la tienda).
Los pasos del modo avanzado (equipo, plantillas, contactos, reparto) solo
aparecen con "Ver todo".

---

## Integrar otro sistema (Stoky, GSG, lo que venga)

Cualquier sistema, en cualquier lenguaje, puede **enviar** por WhatsApp desde
aqui y **enterarse** de lo que llega, sin ver el panel ni el resto del
sistema. Son tres piezas, y las tres se manejan desde `/panel#integraciones`:

1. **Una clave de API con permisos.** Al crearla se marca que puede hacer
   (`mensajes:enviar`, `conversaciones:leer`, `contactos:escribir`...). Con
   permisos marcados, la clave entra **solo** por la API publica `/api/v1`;
   sin marcar nada, lo puede todo, como las claves de antes (que siguen igual).
2. **La API publica, `/api/v1`.** Pocos caminos, nombres que no cambian con
   la pantalla y un contrato en OpenAPI: `GET /api/v1/openapi.json`. Con el,
   PHP, Python o Java generan su cliente sin leer este codigo.
3. **Webhooks salientes.** El otro sistema registra su URL y a partir de ahi
   recibe un POST firmado por cada evento que pidio.

Nada de esto se salta las guardas: `POST /api/v1/mensajes` pasa por los
mismos gates que el chat, y un envio frenado responde `202` con
`estado: "bloqueado"` y el motivo, nunca `200`.

### La API publica

Todas con `Authorization: Bearer wak_...`. Cada ruta exige el permiso que se
indica; sin el, `403` diciendo cual falta.

| Metodo | Ruta | Permiso | |
|---|---|---|---|
| GET | `/api/v1` · `/openapi.json` · `/eventos` | ninguno | que hay, el contrato y la lista de eventos |
| GET | `/api/v1/estado` | `estado:leer` | proveedor, conexion, semaforo, cupo de hoy, cola |
| POST | `/api/v1/mensajes` | `mensajes:enviar` | `{telefono, texto \| plantilla \| ubicacion \| pedirUbicacion, consentimiento?}` |
| GET | `/api/v1/conversaciones` · `/conversaciones/:telefono` | `conversaciones:leer` | la lista y el hilo, con `puedeEscribir` y por que no |
| GET/POST | `/api/v1/contactos` · `/contactos/:telefono` · `/contactos/:telefono/baja` | `contactos:leer` / `contactos:escribir` | alta con `consentimiento.origen`, consulta y baja |
| GET | `/api/v1/plantillas` | `plantillas:leer` | solo las aprobadas |
| GET/POST/PATCH/DELETE | `/api/v1/webhooks` · `/webhooks/:id` | `webhooks:gestionar` | registrar (devuelve el secreto una vez), cambiar, pausar, borrar |
| GET/POST | `/api/v1/webhooks/:id/entregas` · `/probar` · `/reencolar` · `/secreto` | `webhooks:gestionar` | ver que se entrego, mandar un `prueba.ping` ahora, reintentar lo fallido, rotar el secreto |
| POST | `/api/v1/embed/token` | `embed:emitir` | un token corto para el chat embebido (ver mas abajo) |
| GET | `/api/v1/eventos/stream` | `conversaciones:leer` | lo que pasa, en vivo (SSE) |
| POST | `/api/v1/conversaciones/:telefono/leido` | `conversaciones:leer` | marcar como leido |
| GET/POST/PATCH/DELETE | `/api/v1/conectores` · `/conectores/:id` · `/opciones` · `/:id/entradas` · `/:id/probar` · `/:id/secreto` | `conectores:gestionar` | conectores de tiendas (ver mas abajo) |

```bash
# Stoky confirma un pedido (y deja registrado el consentimiento en la misma llamada)
curl -X POST http://localhost:3000/api/v1/mensajes \
  -H "authorization: Bearer wak_..." -H "content-type: application/json" \
  -d '{"telefono":"51987654321","nombre":"Maria","consentimiento":{"origen":"pedido P-1024 en la tienda web"},
       "plantilla":{"nombre":"confirmacion_pedido","variables":["P-1024"]}}'
# → 200 {"ok":true,"estado":"enviado","mensajeId":"wamid...","entregaId":88}
# → 202 {"ok":false,"estado":"bloqueado","codigo":"window_closed","motivo":"..."}   si una guarda lo freno
```

El reparto (GSG) sigue entrando por `/admin/rutas/*` con una clave sin
permisos acotados, como hasta ahora.

### Los webhooks

Se registra la URL (desde el panel o con `POST /api/v1/webhooks`) y se
eligen los eventos; sin elegir, llegan todos:

| Evento | Cuando |
|---|---|
| `mensaje.recibido` | el cliente escribio: texto, ubicacion, foto, audio... con `ventanaAbierta` |
| `mensaje.enviado` | salio un mensaje hacia el cliente, lo mandara quien lo mandara |
| `mensaje.estado` | `sent`, `delivered`, `read` o `failed` de un mensaje enviado |
| `ubicacion.recibida` | se consiguio la ubicacion de un cliente (pin o link de mapa) |
| `contacto.alta` · `contacto.baja` | consentimiento registrado / pidio no recibir mas |
| `reparto.solicitud.actualizada` | una solicitud del reparto cambio de estado o de incidencia |
| `salud.nivel` | el semaforo del numero cambio |

Cada entrega es un `POST` con este cuerpo y tres cabeceras:

```
POST https://stoky.app/webhooks/whatsapp
X-Firma: t=1726400000,v1=3f2a…      X-Evento: mensaje.recibido      X-Entrega: 8812
{
  "id": "8812", "evento": "mensaje.recibido", "fecha": "2026-09-15T14:02:11.000Z", "intento": 1,
  "datos": {
    "contacto": { "id": "…", "telefono": "51987654321", "nombre": "Maria" },
    "mensaje": { "id": "wamid.HBg…", "tipo": "text", "texto": "tienen la 40 en negro?", "datos": null, "fecha": "…" },
    "ventanaAbierta": true
  }
}
```

**La firma** es un HMAC sha256 del cuerpo exacto con el secreto del webhook,
con la marca de tiempo dentro (`t.cuerpo`) para que una entrega capturada
no se pueda reenviar horas despues. Se comprueba asi:

```php
// PHP (Stoky)
[$t, $v1] = sscanf($_SERVER['HTTP_X_FIRMA'], 't=%d,v1=%s');
$cuerpo = file_get_contents('php://input');
$esperada = hash_hmac('sha256', $t . '.' . $cuerpo, $secreto);
if (!hash_equals($esperada, $v1) || abs(time() - $t) > 300) { http_response_code(401); exit; }
http_response_code(200);          // contestar enseguida; procesar despues, en cola
```

```ts
// Node
import { verificarFirma } from 'wa-locator/src/webhooks/firma.js';
verificarFirma(secreto, cuerpoCrudo, req.headers['x-firma']); // true | false
```

**Que pasa si el otro lado no contesta.** Un `2xx` cierra la entrega. Un
`5xx`, un timeout (15 s) o una caida la reintentan con espera creciente:
1 min, 5, 30, 2 h, 12 h; a la sexta se da por perdida. Un `4xx` (salvo 408
y 429) es un "no" que insistir no cambia y se marca fallida en el acto.
Tras **un dia entero sin una sola entrega buena** el webhook se apaga solo,
con su motivo escrito, y sale en la campana del panel. Se reactiva desde ahi
mismo y lo fallido se puede devolver a la cola con "Reintentar fallidas".

Todo queda en `webhook_entregas`: que se mando, cuantas veces, que contesto
el otro lado. Se ve en el panel (boton "Entregas") o por la API.

### El chat embebido en otra web

Para atender WhatsApp **sin salir de Stoky** (o de cualquier web): la
pantalla de chat, dentro de un iframe, hablando solo con `/api/v1` y con un
token corto que decide que ve.

1. En `/panel#integraciones`, "Chat embebido": se escriben las webs que
   pueden enmarcarlo (`https://stoky.app`). Sin ninguna, nadie puede: la
   pagina sale con `Content-Security-Policy: frame-ancestors 'self'`.
2. El **servidor** de la otra web pide un token con una clave que tenga
   `embed:emitir` (la clave nunca llega al navegador; el token si, y caduca
   a la hora, 12 h como mucho):

   ```
   POST /api/v1/embed/token   {"operador":"ana","telefono":"51987654321"}
   → {"token":"emb_...","caduca":"...","url":"https://wa.negocio.com/embed/chat"}
   ```

   Con `telefono`, el token abre **solo ese hilo** (lo que quiere una ficha
   de cliente); sin el, la bandeja completa (lo que quiere un panel de
   atencion). Los permisos del token se acotan a los del chat y a los de la
   propia clave.
3. En su pagina:

   ```html
   <div id="chat-wa" style="height:600px"></div>
   <script src="https://wa.negocio.com/embed.js"></script>
   <script>
     var chat = WA.montar('#chat-wa', {
       token: 'emb_...',
       telefono: '51987654321',                 // opcional
       onNoLeidos: function (n) { /* poner el numerito */ },
       onMensaje: function (m) { /* llego o salio */ },
       onTokenCaducado: function () { /* pedir otro y chat.actualizarToken(nuevo) */ }
     });
     chat.abrir('51911111111');                 // cambiar de hilo desde fuera
   </script>
   ```

`embed.js` crea el iframe, le pasa el token por `postMessage` (no por la
URL: no queda en logs) y reexpone lo que el iframe cuenta. No hace falta
CORS: el iframe habla con su propio origen. La pantalla se mantiene al dia
por el flujo de eventos (`GET /api/v1/eventos/stream`, Server-Sent Events,
filtrado al telefono del token) y, si eso falla, refrescando cada 10 s.
Codigo en `src/embed/`.

En WordPress esto es un bloque "HTML personalizado"; en Shopify, una
seccion "Custom Liquid". En produccion hace falta HTTPS: sin el, Safari y
Chrome pueden bloquear el iframe.

### Varias tiendas: el SaaS

Para dar el sistema a muchos negocios, cada uno con **su propio WhatsApp y
sus propios datos**, no se comparte nada: una instancia por tienda, con su
contenedor, su base y su subdominio, y Caddy delante sacando el HTTPS.

```bash
cp saas/.env.example saas/.env          # DOMINIO_BASE=wa.tuservicio.com, POSTGRES_PASSWORD, MAESTRO_CLAVE
npm run saas:base                       # imagen + Caddy + Postgres
npm run saas:alta -- tienda1 --nombre "Zapateria Lima"
# → https://tienda1.wa.tuservicio.com/login
```

`npm run saas:maestro` levanta tu panel (`maestro.wa.tuservicio.com`) para
dar de alta y de baja desde la pantalla, ver que instancias responden y
llevar los **planes**: cada tienda nace con 14 dias de prueba; tu cobras
como quieras (Yape, transferencia, factura) y apuntas el pago en el
maestro, que corre el vencimiento. Vencido, la IA y las campañas de esa
tienda se paran (los chats siguen) y su panel lo dice arriba de todo.
Cada proyecto se conecta a *su* tienda igual que a una instalacion suelta,
contra su subdominio. Todo el detalle en `saas/README.md`.

### El chat flotante en cualquier web

Ademas de `WA.montar` (el chat dentro de un contenedor de la pagina),
`WA.flotante` pone una burbuja abajo a la derecha que abre el chat encima
de la web, sin tocar su diseno. Sirve para WordPress, Shopify o cualquier
HTML: una linea y ya.

```html
<script src="https://tienda1.wa.tuservicio.com/embed.js"></script>
<script>WA.flotante({ token: 'emb_...', texto: 'Atender WhatsApp', lado: 'derecha', color: '#25d366' });</script>
```

### El chat para los visitantes de la web

Distinto del embebido (que es para el equipo): esto es la burbuja que ven
los **clientes** en la pagina del negocio. Escriben sin cuenta ni WhatsApp,
su mensaje entra al sistema como cualquier otro (lo contesta el asistente
de IA o las reglas, lo ve el equipo en Chats, el operador les responde
desde ahi) y la respuesta les llega en vivo a su navegador.

```html
<script src="https://tienda1.wa.tuservicio.com/web/widget.js"></script>
<script>
  WAChat.montar({ texto: '¿Te ayudamos?', color: '#25d366', bienvenida: 'Hola 👋', pedirNombre: true, whatsapp: '51987654321' });
</script>
```

- Solo desde las webs escritas en "Conectar mi web y tienda → Chat
  embebido" (CORS por origen): otra web recibe 403.
- El visitante es un contacto mas (`web-…`), con consentimiento implicito
  ("chat web en <pagina>"). Sin gates de WhatsApp: no hay numero que
  proteger. `BAJA` lo respeta igual.
- Su sesion es un token firmado de 30 dias en su navegador: si vuelve,
  sigue su conversacion. Tope de 20 mensajes por minuto por sesion.
- `GET /web/demo`: una tienda de mentira con el widget puesto, para verlo
  funcionando y copiar el trozo.

Rutas: `POST /web/sesion`, `POST /web/mensajes`, `GET /web/historial`,
`GET /web/eventos` (SSE), `GET /web/widget.js`, `GET /web/demo`. Codigo en
`src/web-visitantes/`.

### Conectores de tiendas: WooCommerce y Shopify sin tocar su codigo

Esas tiendas ya avisan solas de cada pedido por webhook. Un **conector** es
la URL que se les pega y las reglas de que WhatsApp sale con cada evento.
Todo desde `/panel#integraciones`, "Conectores de tiendas":

1. Crear el conector (tipo, nombre). Sale la URL `https://wa.negocio.com/conectores/<id>`
   y el secreto: en WooCommerce se genera aqui y se pega alla (WooCommerce →
   Ajustes → Avanzado → Webhooks, tema "Pedido creado" y otro "Pedido
   actualizado"); en Shopify el secreto lo da su panel (Configuracion →
   Notificaciones → Webhooks) y se pega aqui al crear el conector.
2. Las reglas: por cada evento, si esta activo, que plantilla (con la API de
   Meta) o que texto (QR/WAHA) sale, con `{nombre}`, `{numero}`, `{total}`,
   `{moneda}`, `{estado}`, `{tienda}`, `{seguimiento}` e `{items}`.
3. "Mandar prueba": simula un pedido y manda el mensaje a un telefono real,
   para verlo antes de pegar nada.

| Evento | WooCommerce | Shopify |
|---|---|---|
| `pedido.creado` | `order.created` | `orders/create` |
| `pedido.pagado` | `order.updated` con estado `processing` | `orders/paid` |
| `pedido.enviado` | (no lo distingue) | `orders/fulfilled` |
| `pedido.completado` | `order.updated` con `completed` | — |
| `pedido.cancelado` | `cancelled`, `refunded`, `failed` | `orders/cancelled` |
| `pedido.actualizado` | cualquier otro cambio | `orders/updated` |

Cada webhook se comprueba con su firma (`X-WC-Webhook-Signature` /
`X-Shopify-Hmac-Sha256`, HMAC sha256 del cuerpo en base64) antes de mirar
nada. El telefono del pedido pasa por el plan de numeracion del pais
(`RUTAS_PAIS`): un `987 654 321` peruano sale como `51987654321`. El
cliente queda con su consentimiento escrito (`pedido 1024 en Tienda Woo`) y
el mensaje sale por el sender de siempre, con sus guardas. **Todo lo que
llega queda apuntado** con su resultado (`enviado`, `bloqueado`,
`sin_regla`, `sin_telefono`, `ignorado`, `error`): boton "Pedidos" del
conector, o `GET /api/v1/conectores/:id/entradas`. Se contesta `200` en
cuanto la firma cuadra, salga o no el mensaje: las tiendas desactivan los
webhooks que fallan. Codigo en `src/conectores/`.

Para lo que no sea WooCommerce ni Shopify (un CRM, una hoja de calculo, un
ERP sin API): la API publica y los webhooks salientes son exactamente lo que
consumen Zapier o Make, y con eso se conecta a miles de apps sin programar.

Los eventos nacen envolviendo los repositorios (`src/eventos/observar.ts`):
asi los emiten igual la Cloud API, el cliente local y WAHA, y la importacion
de historial, porque todos escriben en la misma tabla. El bus
(`src/eventos/bus.ts`) es el unico sitio donde se anuncia; los webhooks
(`src/webhooks/`) son el primer suscriptor, y el chat embebido sera el
siguiente.

---

## API de operacion

Todas bajo `Authorization: Bearer wak_...` (una clave de API creada en
`/panel#integraciones`) o con la cookie de sesion del navegador.

| Metodo | Ruta | |
|---|---|---|
| GET | `/admin/health` | calidad, tier, cupo, enviados hoy, estado de la cola |
| GET | `/admin/resumen` | el inicio del panel: cifras de hoy, la semana, el numero, el reparto, primeros pasos |
| GET | `/admin/avisos` | lo que espera a una persona (la campana) |
| GET/POST/DELETE | `/admin/ajustes` | configuracion general: leer, guardar (admin), volver a lo del servidor (admin) |
| GET | `/admin/actividad` | la bitacora (admin), con `accion`, `usuario`, `limit`, `offset` |
| GET | `/admin/deliveries.csv`, `/admin/contacts.csv` | exportaciones para Excel |
| GET | `/admin/grupos/opciones` | filtros, lotes, plantillas aprobadas y secuencias para armar un grupo |
| POST | `/admin/grupos/previsualizar` | `{criterio}` → total, cifras, muestra y telefonos |
| POST | `/admin/grupos/enviar` | `{criterio, plantilla | texto, nombre?, canario?, ritmoPorHora?, soloVistaPrevia?}` → campaña por goteo |
| POST | `/admin/grupos/exportar` | el grupo en CSV |
| GET/POST | `/admin/chat/atajos` | respuestas rapidas del chat (POST solo admin; `atajos: null` vuelve a las de fabrica) |
| GET/POST/DELETE | `/admin/stickers`, `/admin/stickers/:id` | la biblioteca de stickers (POST: `{nombre, uso, datos}` con la imagen en base64) |
| POST | `/admin/stickers/configuracion` | que sticker sale solo en cada momento (admin) |
| POST | `/admin/stickers/:id/enviar` | `{phone}` → manda ese sticker |
| GET | `/stickers/:archivo` | el fichero WebP, publico |
| POST | `/admin/number/sync` | pregunta a Meta la calidad y el tier reales |
| POST | `/admin/pause` | freno de emergencia (pausa numero y cola) |
| GET | `/admin/contacts` | lista con busqueda, filtro y ultima ubicacion |
| POST | `/admin/contacts/import` | alta masiva con opt-in y su origen |
| POST | `/admin/contacts/opt-in` · `/opt-out` | consentimiento individual |
| GET | `/admin/locations` | ubicaciones recibidas |
| GET | `/admin/deliveries` | historial de envios con el motivo de cada bloqueo |
| POST | `/admin/campaigns` · GET `/admin/campaigns` | lanzar (por goteo, con canario y ritmo por hora) y listar con conteos |
| GET | `/admin/campaigns/:id` · `/stats` | detalle con destinatarios y cifras del canario / conteo por estado |
| POST | `/admin/campaigns/:id/estado` | pausar, reanudar o parar |
| POST | `/admin/campaigns/goteo` | una pasada del goteo ahora |
| GET | `/admin/salud` | nivel, factor, motivos, ventanas, ritmo vigente, plantillas y ultimas senales |
| POST | `/admin/salud/evaluar` · `/reanudar` | recalcular ahora / levantar la pausa automatica (con rampa) |
| POST | `/admin/salud/contactos/levantar` | quitar la supresion de un contacto a mano |
| GET | `/admin/templates` · `/templates/catalog` | registro local y catalogo con lint |
| POST | `/admin/templates/sync` · `/templates/push` | sincronizar y dar de alta |
| GET/POST/DELETE | `/admin/automation/rules` | reglas de respuesta |
| GET/POST/PUT/DELETE | `/admin/automation/sequences` | secuencias y sus pasos |
| POST | `/admin/automation/sequences/:id/enroll` | inscribir telefonos |
| GET | `/admin/automation/enrollments` | inscripciones y su proximo envio |
| GET/POST | `/admin/automation/scheduled` | mensajes programados |
| POST | `/admin/automation/run` | procesar ahora lo vencido |
| GET/POST | `/admin/automation/prefs` | preferencias del bot |
| GET/POST/DELETE | `/admin/tracking` | sesiones de rastreo |
| POST | `/admin/local/connect` · `/status` · `/logout` | sesion local: QR y estado |
| POST | `/admin/local/request-code` | codigo de vinculacion por numero, sin QR |
| GET | `/admin/waha/detect` | busca el contenedor de WAHA en los puertos de siempre |
| POST | `/admin/waha/connect` · `/status` · `/logout` | sesion de WAHA, QR y estado |
| POST | `/admin/waha/request-code` | codigo de vinculacion por numero, sin QR |
| POST | `/admin/waha/importar` | trae al sistema las conversaciones que ya existen en WAHA |
| POST | `/admin/messages/text` · `/location` · `/ask-location` | envios sueltos |
| POST | `/admin/geo/extract` | extrae lat/lng sin enviar nada |
| GET | `/admin/chat/conversations` | lista de chats con su ultimo mensaje y no leidos |
| GET | `/admin/chat/:contactId` | el hilo, con si se puede escribir y por que |
| POST | `/admin/chat/send` | texto, pin de ubicacion, boton de ubicacion o plantilla |
| POST | `/admin/chat/start` | abrir chat con un numero nuevo |
| POST | `/admin/chat/:contactId/archive` | cerrar el chat: respaldarlo entero y vaciarlo |
| GET | `/admin/archives` | respaldos guardados, con cuanto ocupan |
| GET | `/admin/archives/:id` · `/download` | leer el hilo guardado / bajarse el fichero |
| POST | `/admin/archives/:id/restore` | devolver el hilo al chat |
| POST | `/admin/archives/barrer` | cerrar ahora las conversaciones inactivas |
| GET | `/admin/archives-revision` | comprobar que los ficheros siguen intactos |
| GET | `/admin/rutas` | estado del modulo: lotes, cifras, alertas y cola de GSG |
| POST | `/admin/rutas/previsualizar` | que se entiende de la tabla, sin guardar nada |
| POST | `/admin/rutas/lotes` | crear el lote (tabla pegada o filas en JSON: por aqui entra GSG) |
| GET | `/admin/rutas/lotes/:id` · `/lotes/:id.csv` | estado del lote (con `conUbicacion` y `sinUbicacion` ya sumados) / resultado en CSV |
| POST | `/admin/rutas/lotes/:id/estado` | empezar, pausar o dar por terminado |
| GET | `/admin/rutas/solicitudes` · `/vistas` | la bandeja con sus filtros y las cifras de cada vista; `?vista=sin_ubicacion&loteId=…` lista los numeros que todavia no la dieron |
| GET | `/admin/rutas/solicitudes/:id` | un caso con su bitacora completa |
| PATCH | `/admin/rutas/solicitudes/:id` | corregir el telefono (vuelve solo a la cola) y demas datos |
| POST | `/admin/rutas/solicitudes/:id/resolver` | cargar la ubicacion conseguida por telefono |
| POST | `/admin/rutas/solicitudes/:id/derivar` · `/reintentar` | pasar al repartidor / devolver a la cola |
| GET | `/admin/rutas/cola` · `/cola.ndjson` | lo pendiente de reportar a GSG |
| POST | `/admin/rutas/cola/despachar` | vaciar la cola contra la API de GSG |
| GET/POST/DELETE | `/admin/rutas/ajustes` | los ajustes del reparto desde la pantalla: pausas, espera, intentos, horario, plantillas y textos por paso |
| POST/DELETE | `/admin/templates` · `/admin/templates/:name/:language` | crear o editar una plantilla propia (con lint) / borrarla |
| POST | `/admin/connect` | conexion completa a partir de token, app y clave |
| POST | `/admin/connect/signup` | vuelta de la ventana de Meta (registro incorporado) |
| GET/POST | `/admin/settings` | credenciales: leer enmascaradas / guardar y probar |
| GET | `/admin/settings/status` | radiografia de la conexion |
| POST | `/admin/settings/subscribe` · `/register` · `/test-message` | activar la cuenta |

Publicas: `GET /webhooks/whatsapp` (verificacion), `POST /webhooks/whatsapp`,
`GET /t/:token`, `WS /ws/track/:token`, `GET /health`, `GET /embed.js`, `GET /embed/chat`
(la pagina embebible; sin token no ensena nada) y `POST /conectores/:id` (el
webhook que pegan WooCommerce y Shopify, con su firma).

---

## Puesta en marcha

1. `docker compose up -d`. Arranca aunque no haya credenciales y aplica las
   migraciones solo.
2. Abre `/login` y crea la primera cuenta (la administradora). Las demas
   cuentas se crean desde la seccion Usuarios del panel.
3. Conecta la cuenta en `/setup`: el boton de Facebook, o pegando los tres datos.
4. `npm run templates:push` (o el boton del panel) y esperar aprobacion.
5. `npm run templates:sync`.
6. Cargar contactos **con su opt-in y su origen** desde la pestana Contactos.
7. Crear las reglas y secuencias que hagan falta en Automatizacion.
8. Primera campana pequena. Mirar el estado del numero antes de subir volumen.

Para el reparto: `npm run templates:push` da de alta tambien las tres
plantillas de ubicacion; con ellas aprobadas se pega la lista en `/rutas` y se
pulsa **Empezar a pedir**. Sin `GSG_URL` funciona igual y los reportes se
acumulan hasta que esa API exista.

Restringir la key de Google Maps por referrer HTTP: viaja al navegador dentro de
la pagina de rastreo.

## Tests

1055 tests. La mayoria no necesita nada montado: los repositorios tienen dobles
en memoria (`tests/fakes.ts`). Los de `tests/postgres.test.ts` corren el SQL de
verdad —migraciones incluidas— sobre PGlite, que es Postgres compilado a
WebAssembly, asi que tampoco hacen falta Docker ni un servidor.

```bash
npm test
npm run typecheck
```

Los de salud (`tests/salud.test.ts`, `monitor.test.ts`, `goteo.test.ts`,
`humano.test.ts`, `salud-sql.test.ts`) corren con un reloj propio: los dobles
en memoria escriben sus fechas con ese reloj (`setFakeClock`) para que una
ventana de "ultimas 24 h" signifique lo mismo dentro y fuera de la prueba.

## Envío automático: a quién le escribe el sistema solo

La regla: el sistema no le escribe por su cuenta a nadie que no esté en la
lista de **Envío automático** (`/envio-automatico`) o en un lote del reparto.
A cada número le manda un mensaje cada 3 horas (ajustable; vale también para
el reparto), como una persona y solo en horario, hasta conseguir su ubicación
o una respuesta; entonces lo saca solo. Entran números a mano, por el
asistente de WhatsApp (cuando pide la ubicación en un chat), por la IA
operadora o por la API. Código en `src/envio-automatico/` (repo, servicio,
motor, rutas) y pantalla en `src/web/envio-automatico-page.ts`.

## La IA operadora

El botón **IA** del armazón (todas las pantallas) y `POST /api/v1/ia/ordenes`
(permiso `ia:ordenar`) reciben órdenes con palabras. El modelo elige acciones
del catálogo (`src/ia/acciones.ts`) y el sistema las ejecuta por los mismos
endpoints del panel, con la identidad de quien ordena (`app.inject` con un
secreto interno por proceso; en la bitácora sale "(por la IA)"). Consultas y
cambios directos se hacen; lo delicado y cualquier cambio decidido tras leer
datos queda pendiente de confirmar. Ver `src/ia/ordenes.ts`.

## Seguridad de la IA

`src/ia/seguridad.ts`: filtro determinista antes del modelo (extracción del
prompt, cambio de papel, secretos, suplantación del sistema, datos ajenos,
acciones sobre otros), revisión de la salida (huellas del prompt, tokens,
rutas internas, teléfonos ajenos), tope de turnos por contacto y secretos
tapados en lo que lee la IA operadora. El banco de ataques generado
(`src/ia/seguridad-escenarios.ts`, miles de variantes) corre entero en
`tests/ia-seguridad.test.ts`; una muestra es el grupo "seguridad" del examen
de Mi asistente IA.
