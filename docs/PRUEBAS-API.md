# Pruebas con API simulada

Ejecutar `npm run test:api-mock` para verificar recepción de 600 pedidos, duplicados, campos obligatorios, claves, permisos, aislamiento entre cuentas y módulos retirados.

El backend GSG se simula con un servidor HTTP local en un puerto libre. Registra el token y el JSON recibido por `POST /sendLocation`; las pruebas verifican exactamente `tracking`, `latitud` y `longitud`. También devuelve 503 para comprobar que el reporte permanece pendiente y se reenvía tras recuperar el servicio. WhatsApp se sustituye por un adaptador que registra los envíos. Los mocks no habilitan un modo de prueba en la web.

Las pruebas `tests/gsg-produccion.test.ts` y `tests/recepcion-plataforma-sql.test.ts` verifican además la persistencia en MySQL/MariaDB, el reinicio, las claves por cuenta y la concurrencia. Requieren un servidor SQL de pruebas; `GSG_TEST_MYSQL_URL` debe apuntar a ese servidor. Crean bases con el prefijo `gsgchat_prueba_`.

La simulación comprueba el contrato y el funcionamiento interno. La conexión efectiva con GSG, Meta y el proveedor de IA se verifica con los servicios y las credenciales reales.

## Validación del flujo actual

`npm run test:release` ejecuta 25 archivos con 476 pruebas de API, chats, IA, WhatsApp, plantillas, salud, permisos y módulos retirados. `npm run test:release:sql` añade las pruebas de persistencia e integración con MySQL. Primero configura `GSG_TEST_MYSQL_URL` para ese comando.

`npm test` conserva la suite histórica. Incluye escenarios que esperaban módulos eliminados (membresías, campañas, rastreo y motorizados) y actualmente falla en esas expectativas; no es una suite completa aprobada. El perfil de publicación comprueba el flujo actual y verifica que los endpoints retirados respondan 404, sin restaurar los módulos eliminados.

Validación del 4 de octubre de 2026: compilación TypeScript correcta; 476 pruebas del perfil actual aprobadas, 11 de integración GSG con SQL aprobadas y 5 de recepción/aislamiento/concurrencia SQL aprobadas (492 en total, en ejecuciones separadas). Para la integración se usan el reloj real de la base, todos los días abiertos y pausas cortas del fixture; las restricciones de producción no se modifican.
