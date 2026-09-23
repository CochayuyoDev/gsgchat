/**
 * Escribir como si fuera un cliente (o un motorizado) de prueba.
 *
 * Entra por el MISMO camino que /admin/dev/inbound y que un mensaje de
 * WhatsApp de verdad (`processChange`), pero:
 *  - funciona aunque DEV_SIMULATE_INBOUND este apagado, porque
 *  - SOLO acepta numeros del rango de prueba (src/desarrollador/numeros.ts).
 *    Cualquier otro numero se rechaza: fingir un mensaje de un cliente real
 *    moveria su pedido de verdad y le escribiria a su WhatsApp.
 * Lo que el sistema contesta a un numero de prueba no sale nunca al WhatsApp
 * real: el sender lo guarda en el hilo como enviado (ver src/outbound/sender.ts).
 */

import { z } from 'zod';
import { normalizePhone } from '../db/repos.js';
import { entranteSimulado, simularSchema } from '../web/dev-routes.js';
import { processChange, type WebhookDeps } from '../whatsapp/webhook.js';
import { esNumeroDePrueba } from './numeros.js';
import type { DepsDesarrollador } from './seccion.js';

export type EntranteDePrueba = z.infer<typeof simularSchema>;

export class NoEsDePrueba extends Error {
  readonly statusCode = 400;
  constructor(telefono: string) {
    super(`El ${telefono} no es un número de prueba: aquí solo se escribe como los clientes y motorizados de prueba (51 900 0… y 51 900 1…), nunca como un cliente real.`);
  }
}

export function crearSimulador(deps: DepsDesarrollador) {
  const webhookDeps: WebhookDeps = {
    repos: deps.repos,
    config: deps.config,
    sender: deps.sender,
    wa: deps.wa,
    settings: deps.settings,
    catalogo: deps.catalogo,
    salud: deps.salud,
    ajustes: deps.ajustes,
    stickers: deps.stickers,
    ia: deps.ia,
    lista: deps.lista,
    voz: deps.voz,
    entregas: deps.entregas,
    gsg: deps.gsg,
  };

  return {
    /** Mete el entrante y espera a que el sistema lo haya atendido. */
    async escribir(entrada: EntranteDePrueba): Promise<{ telefono: string }> {
      const body = simularSchema.parse(entrada);
      const telefono = normalizePhone(body.phone);
      if (!esNumeroDePrueba(telefono)) throw new NoEsDePrueba(body.phone);
      const id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await processChange('messages', entranteSimulado(body, telefono, id), webhookDeps);
      return { telefono };
    },
  };
}

export type Simulador = ReturnType<typeof crearSimulador>;
