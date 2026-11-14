# Administración de claves API

En **API y endpoint GSG** (`/conexion-gsg`) se crean claves con nombre obligatorio y vencimiento seleccionable: **No se acaba nunca**, 7, 30, 90 o 365 días, o fecha manual `DD/MM/AAAA HH:mm`. Si solo se escribe la fecha, vence a las 23:59, según la hora local del navegador. La pantalla solo ofrece los cuatro permisos que usan las APIs de GSG (`PERMISOS_GSG` en `src/auth/permisos.ts`): `entregas:gestionar` (API 1 y API 2), `entregas:leer` (consultar pedidos), `conversaciones:leer` (API 3) y `mensajes:enviar` (API 4). Al crear vienen todos marcados. Al editar se marcan o desmarcan sobre **la misma clave**: no cambia el secreto y vale en la siguiente petición, así que GSG no tiene que cambiar nada. Los permisos que la clave tenga fuera de ese paquete se conservan (los retirados se descartan); una clave con acceso total (`*`) no se cambia desde aquí.

**Permisos nuevos sin cambiar la clave:** cuando una API nueva pide otro permiso, se añade a `PERMISOS_GSG`. La tabla marca «Le falta: …» en cada clave que no lo tenga, y **Poner al día** (`POST /admin/claves-api/:id/poner-al-dia`) se lo añade conservando los que ya tenía. Antes, para darle `mensajes:enviar` (API 4) a una clave de antes, había que crear una nueva. La clave completa aparece únicamente al crearla o renovarla. Copiarla no la oculta automáticamente; **Ocultar clave**, recargar o salir elimina el secreto de la pantalla. No se guarda en el almacenamiento del navegador. Las respuestas administrativas usan `Cache-Control: no-store`.

El servidor almacena SHA-256 de un secreto aleatorio de 48 caracteres generado mediante `crypto.randomInt`, sin sesgo modular. La tabla muestra el identificador público, nombre, permisos, fechas, último uso y estado. Las claves anteriores conservan sus permisos; las nuevas sin permisos explícitos reciben solo `entregas:leer`.

- **Desactivar / activar:** bloquea o restablece las nuevas peticiones. No reactiva claves revocadas, eliminadas ni vencidas.
- **Editar:** cambia nombre, permisos y vencimiento; no devuelve el secreto.
- **Renovar:** sustituye la huella en una operación de base de datos. La clave anterior deja de autenticar. Mantiene el estado y vencimiento; no reactiva una clave desactivada.
- **Eliminar:** requiere el nombre exacto; invalida definitivamente y oculta el registro. Se sustituye la huella por un valor aleatorio descartado. Queda una marca mínima histórica; no hay recuperación desde el panel.
- **Revocar:** el endpoint DELETE anterior permanece compatible e irreversible.

Solo administradores humanos de la cuenta pueden gestionarlas. Las acciones rechazan orígenes ajenos y peticiones cross-site. La autenticación se verifica por petición y la recepción global también comprueba estado y vencimiento. La base de cada tienda mantiene el aislamiento. Las operaciones se registran en la bitácora existente, sin secretos. Una petición ya autorizada puede finalizar después de desactivar la clave.

Endpoints: `GET/POST /admin/claves-api`, `PATCH /admin/claves-api/:id`, `POST /admin/claves-api/:id/poner-al-dia`, `POST /admin/claves-api/:id/renovar`, `POST /admin/claves-api/:id/eliminar`, `DELETE /admin/claves-api/:id` (revocación histórica).

Se limitan a 120 intentos de autenticación por IP y minuto en cada instancia de tienda, con `Retry-After`. El estado de este límite está en memoria y se reinicia con el proceso; para múltiples réplicas debe acompañarse de un límite compartido o en el proxy. La recepción global conserva su control de tráfico existente.

La migración `004_claves_api_ciclo.sql` agrega campos anulables de estado y vencimiento de forma repetible, compatible con MySQL/MariaDB.
