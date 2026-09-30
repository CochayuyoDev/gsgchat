-- «Esperando ubicación · con motorizado» (pedido del dueño, 25/09): al cliente
-- que no manda su ubicación y recibe el cierre («Número del motorizado: …»)
-- se le asigna un motorizado DE VERDAD, sin pin. El motorizado coordina con el
-- cliente por teléfono; si después llega el pin, sigue con el mismo.
--
-- motorizado_sin_ubicacion_at: desde cuándo el pedido va (o debe ir) con un
-- motorizado aunque falte la ubicación. Mientras falte el pin, el motor le
-- busca uno (el primero, o el siguiente si uno dice «no puedo») sin exigir
-- coordenadas, y ni el reparto ni el envío automático le recuerdan nada.
alter table entregas add column if not exists motorizado_sin_ubicacion_at timestamptz;
