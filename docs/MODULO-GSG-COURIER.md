# Modulo de conexion de GSG Courier

Abrir http://localhost:3000/conexion-gsg (o la misma ruta en el dominio del servidor). En la plataforma, conservar el prefijo /tienda/<nombre>. Entrar con una cuenta de administrador. El menu muestra GSG Courier y Conexion de WhatsApp incluye un acceso al modulo.

Funciones:
- Copiar el endpoint POST /api/v1/entregas.
- Crear una clave exclusiva GSG Courier con permiso entregas:gestionar. Se muestra una sola vez; la base conserva su hash.
- Ver y revocar las claves de Courier (tambien las claves anteriores llamadas GSG).
- Descargar un JSON con los 27 campos de Courier y consultar el contrato.
- Validar cuerpos JSON con las reglas reales de recepcion, detectar telefonos invalidos y referencias duplicadas dentro del lote. Esta prueba no guarda pedidos ni envia mensajes. No comprueba duplicados contra la base: eso lo hace la recepcion real.
- Ver las ultimas llamadas POST de recepcion registradas en la bitacora de GSG.

La recepcion real usa POST /api/v1/entregas con Authorization: Bearer <clave> y Content-Type: application/json. Hasta 500 pedidos por llamada. Para 600: 500 + 100. El modulo muestra preparacion de claves y evidencia de recepcion; no afirma que Courier este conectado solo por crear una clave.

La configuracion de reportes hacia Courier sigue en /setup#gsg. El envio de mensajes queda en el motor existente y respeta el ajuste Confirmar la lista de GSG. El modulo no cambia ese ajuste.

Validacion: TypeScript sin errores y 61 pruebas en los archivos de modulo, recepcion de campos, API, autenticacion y extras de GSG. La comprobacion visual en navegador no pudo completarse porque la herramienta de navegador no respondio.

Cambios locales: no desplegados ni subidos a GitHub en esta tarea. Reiniciar npm run dev si el proceso no recargo los cambios.


## Endpoint global de recepcion

Courier envia exclusivamente a POST https://<dominio>/api/v1/entregas, sin /tienda/<nombre>. Authorization: Bearer <clave> identifica la tienda por la clave vigente guardada en su base, y exige entregas:gestionar. Cookies, Referer y campos del cuerpo no eligen la tienda. Las claves existentes siguen sirviendo. Si no hay clave valida, falta permiso, la tienda esta suspendida o una clave esta asignada a dos tiendas, se devuelve HTTP 404 con {"error":"No tiene permiso"}. La recepcion con prefijo de tienda tambien devuelve ese error. No se guardan pedidos rechazados. Las demas rutas del panel y APIs mantienen su comportamiento.
