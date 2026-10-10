# Paso a producción: GSGchat pidiendo ubicaciones para GSG Courier

Lo que falta para que GSGchat atienda a los clientes de verdad de GSG
Courier. Cada punto dice **qué hacer** y **dónde**. En el panel, el
Módulo desarrollador → «¿Está listo para GSG?» → **«Para salir a
producción»** marca cada cosa en verde o en rojo: cuando todo esté en verde,
se puede empezar.

Lo que ya hace el sistema (no hay que tocar nada):

- Le escribe al cliente el primer mensaje con los datos del envío que manda
  GSG (producto, empresa, código, número de pedido, forma de pago, monto,
  dirección) y le pide su ubicación. Lo que GSG no mande, no sale.
- El agente operativo solo pide y registra la ubicación. Si le preguntan otra
  cosa, manda una vez el mensaje de cierre con el número de soporte y deja el
  chat para una persona.
- Al recibir el pin: «UBI REGISTRADA» en Hoy y en Números del día, GSG se
  entera al momento, y al cliente le llega un solo mensaje con su enlace del
  mapa, el horario (2 a 8 p. m., hasta 10 p. m.) y el soporte.
- Nunca manda una ubicación a nadie: solo el cliente manda la suya.
- La hora de llegada es lo que dice el motorizado + 60 minutos de margen.

---

## 1. El dominio: `stoky360.gsgcorp.pe`

El dominio de producción **está confirmado: `stoky360.gsgcorp.pe`**, pero
**todavía no existe**. Hay que:

1. **Crear el subdominio.** En el panel donde se administra `gsgcorp.pe`
   (el proveedor del dominio o Cloudflare), crear un registro **A** llamado
   `stoky360` que apunte a la IP del servidor donde corre GSGchat. Tarda de
   minutos a unas horas en verse en todo el mundo.
2. **Poner el certificado https.** Lo más simple: instalar **Caddy** en el
   servidor con esto (Caddy saca y renueva el certificado solo):

   ```
   stoky360.gsgcorp.pe {
     reverse_proxy 127.0.0.1:3000
   }
   ```

3. **Decirle al sistema su dirección.** En el archivo `.env` del servidor,
   poner esta línea y reiniciar GSGchat:

   ```
   PUBLIC_BASE_URL=https://stoky360.gsgcorp.pe
   ```

   Sin esto, los enlaces que salen por WhatsApp (la página del motorizado,
   las evidencias) y los avisos a GSG apuntan a «localhost» y no abren fuera
   de la computadora. Al arrancar, la consola lo avisa si falta.

> ¿Sigue corriendo en esta PC con `npm run quick`? También vale: pon la misma
> línea `PUBLIC_BASE_URL=...` en el `.env` (ahora `npm run quick` la respeta)
> y haz que el dominio llegue a esta PC (con Caddy aquí y el router abriendo
> los puertos 80 y 443, o con un túnel como Cloudflare Tunnel). Para algo que
> tiene que estar prendido todo el día, mejor un servidor (VPS).

## 2. Conectar con el sistema real de GSG

Hoy está conectado al **simulador** (números ficticios). GSGchat **nunca le
pide nada a GSG**: los pedidos llegan solo cuando GSG los manda, y GSGchat le
cuenta a GSG lo que pasa. Son dos cosas:

1. **Que GSG mande los pedidos.** En **Conexión → «Crear la clave para GSG»**
   sale una clave (se ve una sola vez). Se la pasas a los programadores de GSG
   junto con el contrato, `docs/CONTRATO-GSG.md` (en Conexión se descarga con
   un botón). Con ella mandan cada pedido a `POST /api/v1/entregas` en cuanto
   lo tienen, con los datos del envío: producto, empresa, código, número de
   pedido, forma de pago, monto y remitente. Si un día no llegan, se puede
   pegar la lista del día en Hoy («Pegar la lista del día»).
2. **Adónde le contamos lo que pasa.** Hay que pedirle a GSG la **dirección de
   su API** (con **https**, por ejemplo `https://api.gsg.pe/v1`) y el
   **token**: ahí GSGchat le manda las ubicaciones, confirmaciones, entregas,
   incidencias y resúmenes (los cinco `POST` del contrato). En **Conexión →
   GSG**: pegar la dirección y el token y **Guardar**. No hay que tocar código
   ni reiniciar. Si GSG prefiere enterarse por webhook, lo registra él con su
   clave (también está en el contrato).

Lo que GSG manda se ve en Conexión → «Para los programadores de GSG» → «Lo que
GSG nos mandó», con lo que se le contestó a cada llamada.

## 3. Número de soporte

**Hoy → Ajustes → «Horario y número de soporte»**: el WhatsApp y el teléfono
de soporte de GSG Courier. Es el número que recibe el cliente en el mensaje de
cierre y al registrar su ubicación. Sin él, el cliente lee «este mismo
número».

## 4. Supervisor (a quién se avisa)

**Ajustes → Avisos**: el WhatsApp del supervisor. Ahí llegan los chats que
pasan a una persona, las incidencias, el resumen del día y la prueba de cada
mañana.

## 5. La IA: clave de OpenAI con `gpt-4o-mini`

**Asistente IA → «Vincular clave a esta tienda»**: pegar la clave de OpenAI
(se saca en platform.openai.com → API keys; se paga por uso). La lista de
modelos se llena sola: elegir **gpt-4o-mini** («Recomendado · consumo muy
bajo»). Dejar el **agente operativo encendido**.

Sin clave el agente funciona igual con sus reglas fijas; con clave entiende
mejor las respuestas raras de los clientes.

## 6. Salir del modo prueba

Mientras esté en modo prueba, **solo** se le escribe a los números de la
lista: los clientes de GSG no reciben nada.

- Si en Hoy hay un cartel de «Modo prueba»: pulsar **«Salir del modo prueba»**.
- Si el modo prueba viene del servidor (la línea `SOLO_NUMEROS=` del `.env`),
  hay que **vaciar esa línea** y reiniciar. Al arrancar, la consola dice en
  grande si sigue puesto.

Recomendado: una última prueba con tu propio número antes de salir.

## 7. Revisar los textos guardados

Los textos por defecto cambiaron (primer mensaje con los datos del envío,
«Ubicación registrada» con el mensaje de cierre). **Si alguna vez se editó y
guardó** un texto en Hoy → Ajustes → textos, ese texto guardado **manda sobre
el nuevo**. Revisar sobre todo:

- **«Ubicación registrada»** (y «Gracias y confirmar»).
- **El primer mensaje (pedir la ubicación)** y los textos del reparto en
  Ajustes → textos del reparto, si se habían cambiado.

Con **«Ver cómo queda»** se ve el mensaje con datos de ejemplo. Para volver al
de fábrica, borrar el texto guardado y guardar.

## 8. Motorizados

**Motorizados**: dar de alta a los de hoy con su WhatsApp (o «Pegar la lista
de motorizados»). Sin ninguno activo, los pedidos con ubicación se quedan
esperando.

## 9. Copias de seguridad

**Que todo funcione → Copia diaria**: elegir una carpeta que se sincronice
(OneDrive, Google Drive) o esté en otro disco, y pulsar «Hacer copia ahora»
una vez. También poner el correo de Brevo para que avise si se cae el
WhatsApp.

## 10. Meta (solo si se usa la API oficial de WhatsApp)

Con el QR (cliente local) no aplica nada de esto. Con la API oficial de Meta:

- Método de pago cargado en Meta **antes del 30/09/2026** (desde el 1/10/2026
  cobran también los mensajes de servicio).
- La configuración nueva del registro incorporado **antes del 15/10/2026**.
- Las plantillas de ubicación aprobadas (para escribir fuera de las 24 h).
  Ojo: fuera de las 24 h Meta solo deja mandar la plantilla aprobada tal
  cual, así que ahí el primer mensaje NO lleva los datos del envío (producto,
  monto...). Si se quieren, hay que pedir a Meta una plantilla con esas
  variables. Con el QR sale siempre el mensaje completo.

## 11. Al reiniciar con esta versión

La base se actualiza sola al arrancar (se añaden los datos del envío y la
marca de «chat para una persona»); no se borra nada. Conviene hacer
«Hacer copia ahora» antes de reiniciar.

---

## La última comprobación

1. Módulo desarrollador → «¿Está listo para GSG?» → «Para salir a producción»:
   todo en verde.
2. «Comprobar la conexión con GSG»: verde entero.
3. Con la API real conectada, «Probar contra la API real de GSG» (solo lee la
   lista del día).
4. Un pedido de prueba con tu número: te llega el primer mensaje con los
   datos, mandas tu ubicación, ves «UBI REGISTRADA» en Hoy.
