/**
 * La nota «Mensaje no llegó al cliente» (pedido del dueño, 12/11) viaja por el
 * MISMO camino que las notas de la IA: la nota del chat que GSG lee en el
 * historial (`nota`), con origen «reglas». Texto:
 *   «Mensaje no llegó al cliente, por favor comunícate con tu número personal
 *    por mensaje o llamada de saldo.»
 */
import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import { CATALOGO_POR_DEFECTO } from '../src/archive/clasificar.js';
import { anotarMensajeNoLlego, CODIGO_NO_LLEGO, TEXTO_NO_LLEGO, vigilarNotaNoLlego } from '../src/chat/nota-no-llego.js';
import { huellaSecreto } from '../src/rutas-gsg/servicio.js';
import { observarRepos } from '../src/eventos/observar.js';
import { processChange } from '../src/whatsapp/webhook.js';

const tel = '987601999';
const pedido = { ...OBLIGATORIOS_GSG, tracking: 'NOTA-1', cliente: 'Juan Pérez', telefono: tel };

const historial = async (e: EscenarioEntregas) => (await e.api.get<{ nota: Record<string, unknown> | null; mensajes: Array<Record<string, unknown>> }>('/api/v1/historial?tracking=NOTA-1')).body;

/** Lo que escribe el motorizado desde GSG (API 4). */
const escribe = (e: EscenarioEntregas, id: string) =>
  e.api.post<{ ok: boolean; llegoAWhatsapp: boolean | null }>('/api/v1/chat', { tracking: 'NOTA-1', texto: 'Hola, soy tu motorizado', idExterno: id, usuario: { id: 77, nombre: 'Juan', rol: 'motorizado' } });

describe('la nota «Mensaje no llegó al cliente»', () => {
  it('es del sistema: la IA no la tiene en su catálogo (no puede ponerla por su cuenta)', () => {
    expect(CATALOGO_POR_DEFECTO.map((c) => c.codigo)).not.toContain(CODIGO_NO_LLEGO);
  });

  it('el motorizado escribe y el mensaje no sale: GSG la ve en la nota del historial, como las de la IA', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      // La ruta del pedido está inactiva (webhook de rutas): el mensaje no sale.
      await e.repos.rutasGsg.guardarSecreto(huellaSecreto('whr_x'), 'x', e.ahora());
      await e.app.inject({ method: 'POST', url: '/api/v1/rutas/estado', headers: { 'x-webhook-secret': 'whr_x' }, payload: { ruta: 'NOTA-1', estado: 'INACTIVA' } });
      for (let i = 0; i < 100 && !e.repos.rutasGsg._eventos.every((x) => x.resultado !== 'recibido'); i++) await new Promise((r) => setTimeout(r, 5));

      const r = await escribe(e, 'nota-1');
      expect(r.body).toMatchObject({ ok: false, llegoAWhatsapp: false });
      // La respuesta trae empujada la misma nota del chat (con la forma de la del historial).
      expect((r.body as unknown as { nota: Record<string, unknown> }).nota).toMatchObject({ codigo: CODIGO_NO_LLEGO, nombre: 'Mensaje no llegó al cliente', descripcion: TEXTO_NO_LLEGO, origen: 'reglas' });
      const h = await historial(e);
      expect(h.nota).toMatchObject({ codigo: CODIGO_NO_LLEGO, nombre: 'Mensaje no llegó al cliente', descripcion: TEXTO_NO_LLEGO, origen: 'reglas' });
      expect(TEXTO_NO_LLEGO).toBe('Mensaje no llegó al cliente, por favor comunícate con tu número personal por mensaje o llamada de saldo.');
      expect(h.mensajes.every((m) => !('nota' in m))).toBe(true);
    } finally {
      await e.cerrar();
    }
  });

  it('WhatsApp avisa después que no lo entregó: también deja la nota', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const dejar = vigilarNotaNoLlego(e.bus, { repos: e.repos });
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      const salio = e.repos.messages._all.find((m) => m.direction === 'out' && m.wamid)!;
      expect((await historial(e)).nota).toBeNull();
      const repos = observarRepos(e.repos, e.bus);
      const avisos: Array<Record<string, unknown>> = [];
      const dejarAvisos = e.bus.escuchar('mensaje.estado', (ev) => { avisos.push(ev as unknown as Record<string, unknown>); });
      await processChange('messages', { statuses: [{ id: salio.wamid!, status: 'failed', timestamp: '1', recipient_id: `51${tel}`, errors: [{ code: 131049, title: 'healthy ecosystem' }] }] }, { repos, settings: e.settings } as never);
      for (let i = 0; i < 100 && !(await historial(e)).nota; i++) await new Promise((r) => setTimeout(r, 10));
      expect((await historial(e)).nota).toMatchObject({ codigo: CODIGO_NO_LLEGO, descripcion: TEXTO_NO_LLEGO, origen: 'reglas' });
      // Y el webhook mensaje.estado la empuja al momento, con la misma forma.
      expect(avisos.find((a) => a.mensajeId === salio.wamid)).toMatchObject({ llegoAWhatsapp: false, nota: { codigo: CODIGO_NO_LLEGO, descripcion: TEXTO_NO_LLEGO, origen: 'reglas' } });
      dejarAvisos();
      dejar();
    } finally {
      await e.cerrar();
    }
  });

  it('no pisa una nota puesta a mano por una persona', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      const numero = `51${tel}`;
      const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
      await e.repos.chatEtiquetas!.guardar({ phone: numero, dia, etiqueta: 'reagendar_entrega', origen: 'manual', huella: 'a-mano', mensajes: 1, motivo: null, loteId: null });
      expect(await anotarMensajeNoLlego({ repos: e.repos }, numero, 'prueba')).toBe(false);
      expect((await historial(e)).nota).toMatchObject({ codigo: 'reagendar_entrega', origen: 'manual' });
    } finally {
      await e.cerrar();
    }
  });
});
