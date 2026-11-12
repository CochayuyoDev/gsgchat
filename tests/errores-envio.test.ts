/**
 * Por que no salio un mensaje, explicado: el catalogo que usan la API
 * (`error` en cada mensaje), el evento `mensaje.estado` y la traza del panel.
 */

import { describe, expect, it } from 'vitest';
import { catalogoDeErrores, errorDeEnvio, MOTIVOS_EN_PALABRAS } from '../src/whatsapp/errores-envio.js';
import { armarTraza } from '../src/admin/buscar-routes.js';
import type { Message } from '../src/db/messages.js';
import type { DeliveryListItem } from '../src/db/repos.js';

describe('errores de envio', () => {
  it('131047: el cliente nunca escribio (o hace mas de 24 h) y salio texto libre', () => {
    const e = errorDeEnvio('131047', 'Re-engagement message')!;
    expect(e).toMatchObject({ codigo: '131047', tipo: 'meta', titulo: 'Re-engagement message', reintentar: 'no' });
    expect(e.motivo).toMatch(/24 horas/);
    expect(e.queHacer).toMatch(/plantilla/);
  });

  it('131049: tope de marketing de Meta, esperar 24 h', () => {
    expect(errorDeEnvio('131049', 'This message was not delivered to maintain healthy ecosystem engagement.')).toMatchObject({ tipo: 'meta', reintentar: 'esperar' });
  });

  it('los bloqueos internos se reconocen por su codigo y llevan el mismo motivo que el panel', () => {
    const e = errorDeEnvio(null, 'window_closed: sin plantilla')!;
    expect(e).toMatchObject({ codigo: 'window_closed', tipo: 'interno', motivo: MOTIVOS_EN_PALABRAS.window_closed });
  });

  it('un codigo desconocido se entrega tal cual, sin inventar motivo', () => {
    expect(errorDeEnvio('999999', 'Something new')).toMatchObject({ codigo: '999999', tipo: 'meta', motivo: 'Something new', reintentar: 'no' });
    expect(errorDeEnvio(null, null)).toBeNull();
  });

  it('el catalogo trae todos los de Meta y todos los internos, cada uno con que hacer', () => {
    const cat = catalogoDeErrores();
    expect(cat.length).toBe(new Set(cat.map((e) => e.codigo)).size);
    expect(cat.filter((e) => e.tipo === 'interno').length).toBe(Object.keys(MOTIVOS_EN_PALABRAS).length);
    for (const e of cat) expect(e.queHacer.length).toBeGreaterThan(10);
  });

  it('la traza del panel lo explica en palabras y dice que hacer, con el texto de Meta al final', () => {
    const ahora = new Date('2026-11-11T16:33:23Z');
    const m = { id: 1, contactId: 'c', direction: 'out', wamid: 'w1', kind: 'text', body: 'por favor enviar ubicación', payload: { origen: 'persona', autorNombre: 'MARIO' }, status: 'failed', deliveryId: 7, createdAt: ahora } as unknown as Message;
    const d = { id: 7, kind: 'freeform', templateName: null, status: 'failed', errorCode: '131047', errorTitle: 'Re-engagement message', queuedAt: ahora, sentAt: ahora, deliveredAt: null, readAt: null, failedAt: ahora } as unknown as DeliveryListItem;
    const t = armarTraza(m, d, []);
    const rechazo = t.pasos.find((p) => p.tono === 'bad')!;
    expect(rechazo.que).toMatch(/^WhatsApp no se lo entregó al cliente\. Pasaron más de 24 horas/);
    expect(rechazo.que).toContain('(Re-engagement message, código 131047)');
    expect(t.pasos.at(-1)).toMatchObject({ cuando: null, tono: 'muted' });
    expect(t.pasos.at(-1)!.que).toMatch(/^Qué hacer: Mandar una plantilla aprobada/);
  });
});
