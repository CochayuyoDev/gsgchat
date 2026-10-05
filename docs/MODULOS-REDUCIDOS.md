# Módulos de la aplicación

La navegación y los servicios activos se limitan a API GSG, WhatsApp, chats, IA, ficha de productos, entrenamiento, plantillas, pedidos, ubicaciones, historial de errores, salud, usuarios y ajustes.

Se retiraron Procesos, Personas, Respuestas, campañas, segmentación, tracking en vivo, chat embebido, conectores comerciales, membresías, pagos, hosting y sus endpoints. Las rutas retiradas responden 404 para todos los roles. La API documentada y las acciones de IA también excluyen estos módulos.

Hoy, Entregas y Números comparten Pedidos GSG; Ubicaciones y Mapa comparten Ubicaciones; estado, riesgo y fiabilidad comparten Salud; los ajustes del flujo GSG se concentran en Automatización GSG. El superadministrador conserva Cuentas con datos y accesos independientes, sin cobros ni Docker.

El motor GSG funciona directamente sin activar Procesos ni consultar un plan comercial. Se conservan los registros y tablas históricos para evitar borrar pedidos y conversaciones.

Esta revisión no equivale a verificar la conexión externa de GSG, Meta o el proveedor de IA. Esas conexiones necesitan sus servicios y credenciales reales.
