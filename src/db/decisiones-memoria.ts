/**
 * Las decisiones del bot en memoria: lo mismo que la tabla `decisiones_bot`
 * (ver repos.ts), sin base de datos. Lo usan las pruebas (`tests/fakes.ts` la
 * deja puesta en `repos.decisiones`). Se comporta igual que el SQL en lo que
 * importa: los textos se recortan al largo de su columna y la lista sale de
 * la mas reciente a la mas vieja.
 */

import type { DecisionBot } from '../ia/decision.js';
import { recortarDecision, TOPE_DECISIONES, type DecisionesRepo } from './repos.js';

/** El repo en memoria, con `_todas` a la vista para que una prueba mire lo guardado. */
export type DecisionesEnMemoria = DecisionesRepo & { _todas: DecisionBot[] };

export function crearDecisionesEnMemoria(reloj: () => Date = () => new Date()): DecisionesEnMemoria {
  const todas: DecisionBot[] = [];
  let seq = 1;
  // Dos turnos en el mismo milisegundo tienen que quedar ordenados igual que
  // con el autoincremental: el desempate es el id.
  return {
    _todas: todas,
    async registrar(entrada) {
      todas.push({ ...recortarDecision(entrada), id: seq++, createdAt: new Date(reloj().getTime()) });
    },
    async listarPorContacto(contactId, limit = 50) {
      const tope = Math.max(1, Math.min(TOPE_DECISIONES, Math.trunc(Number(limit) || 50)));
      return todas
        .filter((d) => d.contactId === contactId)
        .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime() || b.id! - a.id!)
        .slice(0, tope)
        .map((d) => ({ ...d, createdAt: new Date(d.createdAt!.getTime()) }));
    },
  };
}
