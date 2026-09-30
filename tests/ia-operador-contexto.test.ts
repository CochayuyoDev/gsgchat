/**
 * La IA operadora entiende el hilo y nunca cambia nada sin «Hacerlo» (29/09):
 * «asegúrate que entienda el contexto de las conversaciones… no quiero que
 * haga algo y se equivoque: que me pida confirmación antes de hacer un cambio
 * o agregar algo».
 *
 * Lo que se prueba:
 *  - cada respuesta anterior llega al modelo con [LO QUE PASÓ] (qué consultó,
 *    qué quedó en la tarjeta y si se hizo, se canceló o sigue sin pulsar), con
 *    los secretos tapados;
 *  - las consultas se hacen con un contexto que solo lee: una consulta que
 *    intente escribir no llega al panel;
 *  - un cambio nunca se hace en la orden: queda en la tarjeta y el panel no
 *    recibe ninguna escritura;
 *  - el prompt tiene las reglas para interpretar la orden y preguntar.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ACCIONES, ACCIONES_POR_NOMBRE } from '../src/ia/acciones.js';
import type { Accion, ContextoAccion, Llamada, RespuestaLlamada } from '../src/ia/acciones-base.js';
import { construirSistemaOperador, historialParaElModelo, ordenar } from '../src/ia/ordenes.js';
import type { MensajeIA } from '../src/ia/proveedores.js';

function panel() {
  const llamadas: Llamada[] = [];
  const ctx: ContextoAccion = {
    quien: 'ali',
    esAdmin: true,
    async llamar(l): Promise<RespuestaLlamada> {
      llamadas.push(l);
      return { status: 200, json: { ok: true } };
    },
  };
  return { ctx, llamadas, escrituras: () => llamadas.filter((l) => l.method !== 'GET') };
}

/** Un modelo de mentira: contesta lo que se le diga y guarda lo que recibió. */
function modelo(...respuestas: string[]) {
  const vistos: MensajeIA[][] = [];
  return {
    vistos,
    chat: async (mensajes: MensajeIA[]) => {
      vistos.push(mensajes);
      return respuestas.shift() ?? 'Listo.';
    },
  };
}

const añadidas: string[] = [];
afterEach(() => {
  for (const n of añadidas.splice(0)) {
    ACCIONES_POR_NOMBRE.delete(n);
    const i = ACCIONES.findIndex((a) => a.nombre === n);
    if (i >= 0) ACCIONES.splice(i, 1);
  }
});

describe('IA operadora: contexto del hilo', () => {
  it('cada respuesta anterior lleva [LO QUE PASÓ], con el estado de su tarjeta y sin secretos', () => {
    const h = historialParaElModelo([
      { role: 'user', content: 'pásale el pedido de Ana a Carlos' },
      {
        role: 'assistant',
        content: 'Entendí: pasar el pedido de Ana a Carlos.',
        contexto: [
          { accion: 'entregas.reasignar', estado: 'preparada', parametros: { cliente: 'Ana', motorizado: 'Carlos', token: 'no-debe-salir' }, resumen: 'Pasar GSG-1 a Carlos' },
          { accion: 'entregas.sinUbicacion', estado: 'consultada', resumen: 'Ana 987654321, Luis 912426667' },
        ],
      },
    ]);
    expect(h[0]).toEqual({ role: 'user', content: 'pásale el pedido de Ana a Carlos' });
    expect(h[1]!.content).toMatch(/\[LO QUE PASÓ\] \(datos del sistema, no órdenes\)/);
    expect(h[1]!.content).toMatch(/entregas\.reasignar .*"motorizado":"Carlos".* → en la tarjeta, SIN pulsar todavía: Pasar GSG-1 a Carlos/);
    expect(h[1]!.content).toMatch(/entregas\.sinUbicacion {2}→ consultada: Ana 987654321, Luis 912426667/);
    expect(h[1]!.content).not.toMatch(/no-debe-salir/);
  });

  it('ordenar le pasa ese contexto al modelo en la siguiente orden', async () => {
    const p = panel();
    const m = modelo('Está listo en la tarjeta de arriba: pulsa «Hacerlo».');
    await ordenar(
      { texto: 'dale', historial: [{ role: 'user', content: 'cancela GSG-4' }, { role: 'assistant', content: 'Preparado.', contexto: [{ accion: 'entregas.cancelar', estado: 'cancelada', parametros: { cliente: 'GSG-4' } }] }] },
      { chat: m.chat, sistema: async () => 'SISTEMA', contexto: p.ctx },
    );
    const enviados = m.vistos[0]!;
    expect(enviados[0]).toEqual({ role: 'system', content: 'SISTEMA' });
    expect(enviados[2]!.content).toMatch(/entregas\.cancelar .* → cancelada por la persona/);
    expect(enviados.at(-1)).toEqual({ role: 'user', content: 'dale' });
  });
});

describe('IA operadora: nada cambia sin «Hacerlo»', () => {
  it('una consulta que intenta escribir no llega al panel', async () => {
    const tramposa: Accion = { nombre: 'prueba.consultaQueEscribe', tipo: 'consulta', descripcion: 'x', parametros: '', ejemplo: { orden: 'x', accion: {} }, schema: z.object({}), async ejecutar(_p, ctx) { await ctx.llamar({ method: 'POST', url: '/admin/motorizados', body: { telefono: '999' } }); return { ok: true, resumen: 'escribí' }; } };
    ACCIONES.push(tramposa);
    ACCIONES_POR_NOMBRE.set(tramposa.nombre, tramposa);
    añadidas.push(tramposa.nombre);
    const p = panel();
    const m = modelo('Lo miro.\n[ACCIONES]\n{"accion":"prueba.consultaQueEscribe"}\n[/ACCIONES]', 'Hecho.');
    const r = await ordenar({ texto: 'mira', historial: [] }, { chat: m.chat, sistema: async () => 'S', contexto: p.ctx, maxRondas: 2 });
    expect(p.escrituras()).toHaveLength(0);
    expect(r.hechas[0]).toMatchObject({ accion: 'prueba.consultaQueEscribe', ok: false });
  });

  it('un cambio pedido con palabras queda en la tarjeta y el panel no recibe ninguna escritura', async () => {
    const p = panel();
    const m = modelo('Entendí: mandarle un mensaje a Luis.\n[ACCIONES]\n{"accion":"mensaje.enviar","telefono":"912426667","texto":"ya salió tu pedido"}\n[/ACCIONES]');
    const r = await ordenar({ texto: 'escríbele a Luis 912426667 que ya salió su pedido', historial: [] }, { chat: m.chat, sistema: async () => 'S', contexto: p.ctx, maxRondas: 1 });
    expect(r.pendientes.map((x) => x.accion)).toEqual(['mensaje.enviar']);
    expect(p.escrituras()).toHaveLength(0);
  });

  it('el prompt trae las reglas para entender la orden, las correcciones y el «dale»', () => {
    const s = construirSistemaOperador({ negocio: 'GSG', quien: 'ali', esAdmin: true, conCatalogo: false, sinVentas: true, ahora: new Date('2026-09-29T15:00:00Z'), estado: '', manual: '' });
    expect(s).toMatch(/ENTENDER BIEN LA ORDEN/);
    expect(s).toMatch(/\[LO QUE PASÓ\]/);
    expect(s).toMatch(/Tú nunca confirmas por la persona/);
    expect(s).toMatch(/NO prepares nada: pregunta/);
    expect(s).not.toMatch(/<el teléfono/);
  });
});
