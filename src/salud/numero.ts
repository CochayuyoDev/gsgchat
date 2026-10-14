/**
 * Quien es «el numero» para la salud.
 *
 * Todo lo que el monitor guarda (nivel de riesgo, factor que frena la pausa,
 * warm-up, pausas y la rampa de vuelta) vive en `number_state`, en una fila
 * por numero. La clave de esa fila es lo que devuelve esta funcion.
 *
 * Con la API de Meta hay un id de verdad por numero (`phoneNumberId`). Con
 * Baileys o WAHA no hay ninguno, y hasta el 13/10 se usaba la palabra
 * `local`: una sola fila para cualquier telefono que se vinculara. Eso hacia
 * que un numero nuevo HEREDARA el castigo del anterior (si el viejo estaba en
 * naranja, el nuevo salia tambien a un quinto de velocidad, con pausas de 150 s
 * en vez de 30). Ahora la clave lleva el telefono: `local:51987654321`, asi que
 * cambiar de numero es empezar limpio, y volver al de antes recupera su
 * historial en vez de pisarlo.
 *
 * Mientras no se sabe el telefono (la sesion arrancando, el QR sin escanear)
 * se usa `local` a secas: es lo mismo que habia y no se pierde nada.
 */

/** La clave de `number_state` para el numero vigente. */
export function identidadDeNumero(entrada: {
  /** 'cloud' = API de Meta; 'local' = Baileys; 'waha' = WAHA. */
  proveedor: 'cloud' | 'local' | 'waha';
  /** El id de Meta, solo con la Cloud API. */
  phoneNumberId?: string | null;
  /** El telefono vinculado (Baileys o WAHA), como venga. */
  telefono?: string | null;
}): string {
  if (entrada.proveedor === 'cloud') return (entrada.phoneNumberId ?? '').trim() || 'local';
  const digitos = String(entrada.telefono ?? '').replace(/\D+/g, '');
  return digitos ? `local:${digitos}` : 'local';
}

/** Si una clave de `number_state` es de un numero sin Cloud API. */
export const esIdentidadLocal = (id: string): boolean => id === 'local' || id.startsWith('local:');

/** El telefono dentro de una clave local, o null (`local` a secas, o una de Meta). */
export function telefonoDeIdentidad(id: string): string | null {
  return id.startsWith('local:') ? id.slice('local:'.length) || null : null;
}

/**
 * El telefono vinculado que los proveedores van anotando.
 *
 * Baileys lo tiene en su estado y se lee al momento; WAHA lo cuenta cuando la
 * pantalla de Conexion le pregunta por su sesion, asi que se guarda aqui en
 * cuanto se sabe. Es por tienda: cada una crea el suyo.
 */
export interface NumeroVigente {
  /** El ultimo telefono conocido, en digitos, o '' si todavia no se sabe. */
  actual(): string;
  /** Lo que acaba de contar un proveedor. Vacio = se desvinculo: se olvida. */
  anotar(telefono: string | null | undefined): void;
}

export function crearNumeroVigente(inicial = ''): NumeroVigente {
  let valor = String(inicial ?? '').replace(/\D+/g, '');
  return {
    actual: () => valor,
    anotar(telefono) {
      valor = String(telefono ?? '').replace(/\D+/g, '');
    },
  };
}
