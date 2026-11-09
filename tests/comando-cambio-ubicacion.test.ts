import { afterEach, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import { setFakeClock } from './fakes.js';
import { COMANDOS_CHAT, esComandoCambioUbicacion } from '../src/entregas/comando-cambio-ubicacion.js';
import { comandoDesdeTelefono } from '../src/web/local-routes.js';

/**
 * «proceder cambio de ubicación» (pedido del dueño, 08/11): un motorizado de
 * GSG, el dueño o quien use el chat -NUNCA el cliente- lo escribe y el sistema
 * toma la última ubicación que el cliente mandó por WhatsApp. Es la salida al
 * cambio que el bot no registra solo (después de la hora límite o sin cambios
 * que le queden): ya lo coordinó una persona.
 */
const telefono = '987601455';
const phone = '51' + telefono;
const TRACKING = 'GSG-COMANDO-1';
const pedido = { ...OBLIGATORIOS_GSG, tracking: TRACKING, cliente: 'Lucía', telefono, distrito: 'Lima' };
const A = { lat: -12.0464, lng: -77.0428 };
const B = { lat: -12.1211, lng: -77.0301 };
// 4:00 PM en Lima: pasada la hora límite (3:00 PM), el bot ya no registra otro pin solo.
const TARDE = new Date('2026-10-28T21:00:00Z');
// 10:00 AM en Lima.
const MANANA = new Date('2026-10-28T15:00:00Z');
afterEach(() => setFakeClock(null));

const cuerpos = (ms: Array<Record<string, unknown>>): string[] => ms.map((m) => String(m.text ?? m.body ?? (m.interactive as { body?: string } | undefined)?.body ?? ''));

/** Pedido con la ubicación A registrada y, pasada la hora, el cliente manda B: no se registra sola. */
async function clienteMandoOtraTarde(e: EscenarioEntregas): Promise<void> {
  await e.api.post('/api/v1/entregas', pedido);
  await e.trabajar();
  await e.contesta(telefono, { pin: A });
  expect(await e.entrega(TRACKING)).toMatchObject({ ubicacionEstado: 'recibida', lat: A.lat });
  e.avanzar(10);
  await e.contesta(telefono, { pin: B });
  const ent = (await e.entrega(TRACKING))!;
  expect(ent.lat).not.toBe(B.lat);
  e.avanzar(10);
}

async function reportesUbicacion(e: EscenarioEntregas): Promise<Array<Record<string, unknown>>> {
  await e.despacharAGsg();
  return (await e.repos.rutas.reportesRecientes(100, 'ubicacion')).map((r) => r.payload as Record<string, unknown>).filter((p) => p.tracking === TRACKING);
}

describe('reconocer el comando', () => {
  it('vale el mensaje entero, con o sin tildes, «a», «al» o mayúsculas', () => {
    for (const t of ['proceder cambio de ubicación', 'Proceder a cambio de ubicación', 'PROCEDER CAMBIO DE UBICACION', 'proceder al cambio de ubicacion.', 'Proceder cambio', ' proceder  cambio de ubicación ✅', '/cambio']) {
      expect(esComandoCambioUbicacion(t), t).toBe(true);
    }
  });
  it('dentro de una frase, u otras palabras, no', () => {
    for (const t of ['quiero cambio de ubicación', 'cambio de ubicación', 'cambiar ubicación', 'puedes proceder cambio de ubicación por favor', 'proceder', 'no proceder cambio', '', null, undefined]) {
      expect(esComandoCambioUbicacion(t as string), String(t)).toBe(false);
    }
  });
  it('el atajo de comando /cambio escribe exactamente el comando', () => {
    const c = COMANDOS_CHAT.find((x) => x.atajo === 'cambio')!;
    expect(esComandoCambioUbicacion(c.texto)).toBe(true);
  });
});

describe('«proceder cambio de ubicación»', () => {
  it('desde el chat del panel: toma el último pin del cliente, no le manda el comando y le confirma', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await clienteMandoOtraTarde(e);
      const antes = e.mensajesA(telefono).length;

      const r = await e.api.post<{ ok: boolean; comando?: { ok: boolean; resultado: string; mensaje: string; lat: number } }>('/admin/chat/send', { phone, text: 'Proceder cambio de ubicación', atiendePersona: true, autorNombre: 'Kevin' });
      expect(r.status).toBe(200);
      expect(r.body.comando).toMatchObject({ ok: true, resultado: 'cambiada', lat: B.lat });
      expect(r.body.comando!.mensaje).toMatch(/Ubicación cambiada/);

      // Al cliente: solo la confirmación, nunca el texto del comando.
      const nuevos = cuerpos(e.mensajesA(telefono).slice(antes));
      expect(nuevos).toHaveLength(1);
      expect(nuevos[0]).toMatch(/Su nueva ubicación se registró correctamente/);
      expect(cuerpos(e.mensajesA(telefono)).some((t) => /proceder/i.test(t))).toBe(false);

      // El pedido: con B, como cambio, ya sin incidencia.
      const ent = (await e.entrega(TRACKING))!;
      expect(ent).toMatchObject({ ubicacionEstado: 'recibida', lat: B.lat, lng: B.lng });
      expect(ent.estado).not.toBe('incidencia');
      expect(ent.ubicacionCambios).toBeGreaterThanOrEqual(1);
      const detalle = (await e.entregas.entrega(ent.id))!;
      expect(detalle.eventos.some((x) => /proceder cambio de ubicación» de Kevin \(chat del panel\)/.test(x.detalle ?? ''))).toBe(true);

      // GSG recibe la ubicación nueva como cambio, con la anterior.
      const aGsg = await reportesUbicacion(e);
      const ultimo = aGsg.find((p) => p.lat === B.lat)!;
      expect(ultimo).toMatchObject({ cambioUbicacion: true, anterior: { lat: A.lat, lng: A.lng } });
    } finally {
      await e.cerrar();
    }
  });

  it('desde el chat de GSG (un motorizado de GSG): igual, y la API devuelve lo que hizo', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await clienteMandoOtraTarde(e);
      const r = await e.api.post<{ ok: boolean; estado: string; comando?: { resultado: string } }>('/api/v1/chat', {
        tracking: TRACKING,
        texto: 'proceder a cambio de ubicacion',
        idExterno: 'gsg-msg-1',
        usuario: { id: 77, nombre: 'Moto Juan', rol: 'motorizado' },
      });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true, estado: 'comando', comando: { resultado: 'cambiada' } });
      const ent = (await e.entrega(TRACKING))!;
      expect(ent).toMatchObject({ lat: B.lat, lng: B.lng });
      const detalle = (await e.entregas.entrega(ent.id))!;
      expect(detalle.eventos.some((x) => /Moto Juan \(chat de GSG, motorizado\)/.test(x.detalle ?? ''))).toBe(true);
      expect(cuerpos(e.mensajesA(telefono)).some((t) => /proceder/i.test(t))).toBe(false);
    } finally {
      await e.cerrar();
    }
  });

  it('desde el teléfono conectado: el sistema toma el último pin (el texto ya salió del teléfono)', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await clienteMandoOtraTarde(e);
      const r = await comandoDesdeTelefono(e.entregas, phone, 'Proceder cambio de ubicación', 'una persona desde el teléfono (línea principal)');
      expect(r).toMatchObject({ ok: true, resultado: 'cambiada' });
      expect(await e.entrega(TRACKING)).toMatchObject({ lat: B.lat });
      // Otro texto desde el teléfono no hace nada.
      expect(await comandoDesdeTelefono(e.entregas, phone, 'hola, ya voy', 'x')).toBeNull();
    } finally {
      await e.cerrar();
    }
  });

  it('el CLIENTE escribiendo el comando no cambia nada', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await clienteMandoOtraTarde(e);
      await e.contesta(telefono, { texto: 'proceder cambio de ubicación' });
      const ent = (await e.entrega(TRACKING))!;
      expect(ent.lat).not.toBe(B.lat);
    } finally {
      await e.cerrar();
    }
  });

  it('el cliente pidió el cambio por texto tarde y no mandó otro pin: se vuelve a poner el último que mandó', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { pin: A });
      e.avanzar(5);
      await e.contesta(telefono, { texto: 'cambiar ubicación' });
      let ent = (await e.entrega(TRACKING))!;
      expect(ent.lat).toBeNull();
      e.avanzar(5);
      const r = await e.api.post<{ comando?: { resultado: string } }>('/admin/chat/send', { phone, text: 'proceder cambio', atiendePersona: true });
      expect(r.body.comando).toMatchObject({ resultado: 'cambiada' });
      ent = (await e.entrega(TRACKING))!;
      expect(ent).toMatchObject({ ubicacionEstado: 'recibida', lat: A.lat });
      expect(ent.estado).not.toBe('incidencia');
    } finally {
      await e.cerrar();
    }
  });

  it('antes de la hora límite y con los cambios agotados también vale', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: MANANA });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.entregas.guardarAjustes({ cambiosUbicacionMax: 0 });
      await e.contesta(telefono, { pin: A });
      e.avanzar(5);
      await e.contesta(telefono, { pin: B });
      expect((await e.entrega(TRACKING))!.lat).not.toBe(B.lat);
      e.avanzar(5);
      const r = await e.api.post<{ comando?: { resultado: string } }>('/admin/chat/send', { phone, text: 'Proceder cambio de ubicación', atiendePersona: true });
      expect(r.body.comando).toMatchObject({ resultado: 'cambiada' });
      expect(await e.entrega(TRACKING)).toMatchObject({ lat: B.lat });
    } finally {
      await e.cerrar();
    }
  });

  it('sin nada que cambiar: lo dice y no toca el pedido ni le escribe al cliente', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      // Sin pedidos.
      let r = await e.api.post<{ comando?: { ok: boolean; resultado: string } }>('/admin/chat/send', { phone: '51987600000', text: 'proceder cambio de ubicación', atiendePersona: true });
      expect(r.body.comando).toMatchObject({ ok: false, resultado: 'sin_pedidos' });
      expect(e.mensajesA('987600000')).toHaveLength(0);

      // Con pedido pero sin ninguna ubicación del cliente.
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      let antes = e.mensajesA(telefono).length;
      r = await e.api.post('/admin/chat/send', { phone, text: 'proceder cambio de ubicación', atiendePersona: true });
      expect(r.body.comando).toMatchObject({ ok: false, resultado: 'sin_ubicacion' });
      expect(e.mensajesA(telefono)).toHaveLength(antes);

      // La última que mandó ya es la registrada.
      await e.contesta(telefono, { pin: A });
      antes = e.mensajesA(telefono).length;
      r = await e.api.post('/admin/chat/send', { phone, text: 'proceder cambio de ubicación', atiendePersona: true });
      expect(r.body.comando).toMatchObject({ ok: false, resultado: 'sin_cambio' });
      expect(e.mensajesA(telefono)).toHaveLength(antes);
      expect(await e.entrega(TRACKING)).toMatchObject({ lat: A.lat });
    } finally {
      await e.cerrar();
    }
  });

  it('solo una persona: sin «atiendePersona» (la IA del panel, un envío automático) sale como texto normal', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await clienteMandoOtraTarde(e);
      const r = await e.api.post<{ comando?: unknown }>('/admin/chat/send', { phone, text: 'proceder cambio de ubicación', autor: 'ia' });
      expect(r.body.comando).toBeUndefined();
      expect((await e.entrega(TRACKING))!.lat).not.toBe(B.lat);
    } finally {
      await e.cerrar();
    }
  });

  it('el chat recibe el atajo de comando /cambio', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      const r = await e.api.get<{ comandos: Array<{ atajo: string; texto: string }> }>('/admin/chat/atajos');
      expect(r.body.comandos).toEqual([expect.objectContaining({ atajo: 'cambio', texto: 'proceder cambio de ubicación' })]);
    } finally {
      await e.cerrar();
    }
  });
});
