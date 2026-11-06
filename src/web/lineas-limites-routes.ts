/**
 * Salud / Fiabilidad: el maximo de mensajes por dia de cada numero de WhatsApp y
 * la salud de cada conexion.
 *
 *  GET /admin/fiabilidad/limites         cada numero con su maximo y lo que lleva hoy (dia de Lima)
 *  PUT /admin/fiabilidad/limites/:id     (solo admin) { limiteDiario } vacio o 0 = sin limite; entero >= 0
 *  GET /admin/fiabilidad/whatsapp        cada numero y su estado: operativo, con problemas, desconectado, no verificado
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { UsoLineasRepo } from '../db/uso-lineas.js';
import { diaLima, LimiteInvalido, ZONA_LIMITE } from '../whatsapp/limite-diario.js';
import type { ServicioLineas } from '../whatsapp/lineas.js';
import type { SaludDeLineas } from '../whatsapp/salud-lineas.js';

export interface LineasLimitesRoutesDeps {
  lineas: Pick<ServicioLineas, 'listar' | 'obtener' | 'fijarLimite'>;
  uso: Pick<UsoLineasRepo, 'usoDelDia'>;
  salud: SaludDeLineas;
  ahora?: () => Date;
}

/** «342 / 500», o «Sin límite». */
export const textoDeConsumo = (usados: number, limite: number): string => (limite > 0 ? `${usados} / ${limite}` : 'Sin límite');

export async function registerLineasLimitesRoutes(app: FastifyInstance, deps: LineasLimitesRoutesDeps): Promise<void> {
  const ahora = deps.ahora ?? (() => new Date());
  const soloAdmin = (request: { usuario?: { rol?: string; porToken?: boolean } | null }) => request.usuario?.rol === 'admin' && !request.usuario.porToken;

  async function vistaLimites() {
    const dia = diaLima(ahora());
    const [todas, usoHoy] = await Promise.all([deps.lineas.listar(), deps.uso.usoDelDia(dia)]);
    return {
      zona: ZONA_LIMITE,
      dia,
      lineas: todas.map((l) => {
        const usadosHoy = usoHoy.get(l.id) ?? 0;
        return {
          id: l.id,
          etiqueta: l.etiqueta,
          numero: l.telefono,
          principal: l.principal,
          habilitada: l.habilitada,
          limiteDiario: l.limiteDiario,
          usadosHoy,
          consumo: textoDeConsumo(usadosHoy, l.limiteDiario),
        };
      }),
    };
  }

  app.get('/admin/fiabilidad/limites', async () => vistaLimites());

  app.put<{ Params: { id: string } }>('/admin/fiabilidad/limites/:id', async (request, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador cambia el máximo de mensajes por día.' });
    const body = z.object({ limiteDiario: z.unknown().optional() }).parse(request.body ?? {});
    if (!(await deps.lineas.obtener(request.params.id))) return reply.code(404).send({ error: 'Ese número no existe.', codigo: 'no_existe' });
    try {
      const limiteDiario = await deps.lineas.fijarLimite(request.params.id, body.limiteDiario);
      return { ok: true, limiteDiario, ...(await vistaLimites()) };
    } catch (error) {
      if (error instanceof LimiteInvalido) return reply.code(400).send({ error: error.message, codigo: 'limite_invalido' });
      throw error;
    }
  });

  app.get('/admin/fiabilidad/whatsapp', async () => ({ lineas: await deps.salud.consultar(), comprobadoEn: ahora().toISOString() }));
}
