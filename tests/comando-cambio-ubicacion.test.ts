import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerEntregasRoutes } from '../src/entregas/routes.js';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import { setFakeClock } from './fakes.js';
import { COMANDOS_CHAT, esComandoCambioUbicacion, leerComandoDeMotorizado } from '../src/entregas/comando-cambio-ubicacion.js';
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

/**
 * El motorizado de GSG (el `telefonoMotorizado` que GSG manda en el pedido)
 * escribe el comando por WhatsApp a la línea de GSGchat (pedido del dueño,
 * 11/11): pasada la hora límite el cliente ya no puede cambiar su ubicación
 * solo, pero si el motorizado lo ordena vale la última que mandó el cliente.
 */
describe('leer el comando del motorizado', () => {
  it('con o sin tilde, y con el pedido delante o detrás', () => {
    expect(leerComandoDeMotorizado('proceder cambio de ubicación')).toEqual({ senas: [] });
    expect(leerComandoDeMotorizado('Proceder cambio de ubicacion')).toEqual({ senas: [] });
    expect(leerComandoDeMotorizado('PROCEDER CAMBIO DE UBICACIÓN 👍')).toEqual({ senas: [] });
    expect(leerComandoDeMotorizado('proceder cambio de ubicación GSG-COMANDO-1')).toEqual({ senas: ['gsg-comando-1'] });
    expect(leerComandoDeMotorizado('P-1001 proceder al cambio de ubicacion')).toEqual({ senas: ['p-1001'] });
    expect(leerComandoDeMotorizado('proceder cambio de ubicación del pedido 987601455')).toEqual({ senas: ['987601455'] });
    expect(leerComandoDeMotorizado('proceder cambio de ubicación: GSG-1, GSG-2')).toEqual({ senas: ['gsg-1', 'gsg-2'] });
  });
  it('otras palabras, una negación o una frase cualquiera, no', () => {
    for (const t of ['puedes proceder cambio de ubicación?', 'no proceder cambio de ubicación', 'proceder cambio de ubicación mañana', 'quiero cambiar la ubicación', 'proceder', 'cambio de ubicación GSG-1', '', null]) {
      expect(leerComandoDeMotorizado(t as string), String(t)).toBeNull();
    }
  });
});

describe('«proceder cambio de ubicación» escrito por el motorizado por WhatsApp', () => {
  const MOTO = '999555111';
  const conMoto = (extra: Record<string, unknown> = {}) => ({ ...pedido, motorizado: { nombre: 'Juan Pérez', telefono: MOTO }, ...extra });

  it('pasada la hora el cliente ya no puede; el motorizado lo ordena y vale la última ubicación del cliente', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await e.api.post('/api/v1/entregas', conMoto());
      await e.trabajar();
      await e.contesta(telefono, { pin: A });
      e.avanzar(10);
      // Pasada la hora límite el cliente pide cambiarla: el sistema le dice que ya no puede.
      await e.contesta(telefono, { texto: 'quiero cambiar mi ubicación' });
      expect(e.textosA(telefono).at(-1)).toMatch(/al ser después de la/);
      e.avanzar(2);
      // Y aunque mande la nueva, no se registra sola.
      await e.contesta(telefono, { pin: B });
      expect((await e.entrega(TRACKING))!.lat).not.toBe(B.lat);
      e.avanzar(10);
      const antesCliente = e.mensajesA(telefono).length;

      // El motorizado, sin tilde, desde su WhatsApp.
      await e.contesta(MOTO, { texto: 'proceder cambio de ubicacion' });

      const ent = (await e.entrega(TRACKING))!;
      expect(ent).toMatchObject({ ubicacionEstado: 'recibida', lat: B.lat, lng: B.lng });
      // Al cliente: el mensaje automático de ubicación registrada, nunca el comando.
      const alCliente = cuerpos(e.mensajesA(telefono).slice(antesCliente));
      expect(alCliente).toHaveLength(1);
      expect(alCliente[0]).toMatch(/nueva ubicación se registró correctamente/);
      // Al motorizado: lo que se hizo, con el enlace nuevo.
      const alMoto = e.textosA(MOTO).at(-1)!;
      expect(alMoto).toMatch(/✅ GSG-COMANDO-1 \(Lucía/);
      expect(alMoto).toMatch(/ubicación cambiada a la última que mandó el cliente/);
      expect(alMoto).toContain(String(B.lat));
      // En el historial del pedido queda quién lo ordenó.
      const detalle = (await e.entregas.entrega(ent.id))!;
      expect(detalle.eventos.some((x) => /proceder cambio de ubicación» de Juan Pérez \(motorizado, por WhatsApp desde el 999555111\)/.test(x.detalle ?? ''))).toBe(true);
      // GSG la recibe como cambio, con la anterior.
      const aGsg = await reportesUbicacion(e);
      expect(aGsg.find((p) => p.lat === B.lat)).toMatchObject({ cambioUbicacion: true, anterior: { lat: A.lat, lng: A.lng } });
    } finally {
      await e.cerrar();
    }
  });

  it('el mismo texto desde un número que no es motorizado de ningún pedido no cambia nada', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await e.api.post('/api/v1/entregas', conMoto());
      await e.trabajar();
      await e.contesta(telefono, { pin: A });
      e.avanzar(10);
      await e.contesta(telefono, { pin: B });
      e.avanzar(10);
      await e.contesta('999555222', { texto: `proceder cambio de ubicación ${TRACKING}` });
      expect((await e.entrega(TRACKING))!.lat).not.toBe(B.lat);
      // Ni el propio cliente, aunque nombre su pedido.
      await e.contesta(telefono, { texto: `proceder cambio de ubicación ${TRACKING}` });
      expect((await e.entrega(TRACKING))!.lat).not.toBe(B.lat);
      expect(e.textosA('999555222').some((t) => /ubicación cambiada/.test(t))).toBe(false);
    } finally {
      await e.cerrar();
    }
  });

  it('con dos clientes: vale el único que mandó una ubicación nueva; si hay dudas, pregunta; nombrando el tracking, ese', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    const OTRO = '987601466';
    const T2 = 'GSG-COMANDO-2';
    const C = { lat: -12.0911, lng: -77.0501 };
    const D = { lat: -12.0712, lng: -77.0612 };
    try {
      await e.api.post('/api/v1/entregas', conMoto());
      await e.api.post('/api/v1/entregas', conMoto({ tracking: T2, cliente: 'Mario', telefono: OTRO }));
      await e.trabajar();
      await e.contesta(telefono, { pin: A });
      await e.contesta(OTRO, { pin: C });
      e.avanzar(10);

      // Ninguno mandó otra: se le pregunta cuál, con sus pedidos.
      await e.contesta(MOTO, { texto: 'proceder cambio de ubicación' });
      expect(e.textosA(MOTO).at(-1)).toMatch(/ninguno de tus clientes de hoy ha mandado una ubicación nueva/);
      expect(e.textosA(MOTO).at(-1)).toMatch(/GSG-COMANDO-1/);
      expect(e.textosA(MOTO).at(-1)).toMatch(/GSG-COMANDO-2/);

      // Solo Lucía mandó otra: sin decir cuál, es ella.
      await e.contesta(telefono, { pin: B });
      e.avanzar(5);
      await e.contesta(MOTO, { texto: 'Proceder cambio de ubicación' });
      expect((await e.entrega(TRACKING))!.lat).toBe(B.lat);
      expect((await e.entrega(T2))!.lat).toBe(C.lat);

      // Mario manda otra y Lucía otra más: dos con ubicación nueva, se pregunta.
      await e.contesta(OTRO, { pin: D });
      await e.contesta(telefono, { pin: A });
      e.avanzar(5);
      await e.contesta(MOTO, { texto: 'proceder cambio de ubicación' });
      expect(e.textosA(MOTO).at(-1)).toMatch(/tienes 2 clientes que mandaron una ubicación nueva/);
      expect((await e.entrega(T2))!.lat).not.toBe(D.lat);
      expect((await e.entrega(TRACKING))!.lat).not.toBe(A.lat);

      // Nombrando el tracking (en minúsculas y sin tilde), solo ese.
      await e.contesta(MOTO, { texto: 'proceder cambio de ubicacion gsg-comando-2' });
      expect((await e.entrega(T2))!.lat).toBe(D.lat);
      expect((await e.entrega(TRACKING))!.lat).not.toBe(A.lat);
      expect(e.textosA(MOTO).at(-1)).toMatch(/✅ GSG-COMANDO-2 \(Mario/);
      // Y el de Lucía con su teléfono como seña.
      await e.contesta(MOTO, { texto: `proceder cambio de ubicación ${telefono}` });
      expect((await e.entrega(TRACKING))!.lat).toBe(A.lat);
    } finally {
      await e.cerrar();
    }
  });

  it('un pedido que no es suyo no se toca: se le dice y se le enseñan los suyos', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await e.api.post('/api/v1/entregas', conMoto());
      // Otro pedido de otro motorizado.
      await e.api.post('/api/v1/entregas', { ...OBLIGATORIOS_GSG, tracking: 'GSG-AJENO-1', cliente: 'Rosa', telefono: '987601477', distrito: 'Lima', motorizado: { nombre: 'Pedro', telefono: '999555333' } });
      await e.trabajar();
      await e.contesta('987601477', { pin: A });
      e.avanzar(10);
      await e.contesta('987601477', { pin: B });
      e.avanzar(10);
      await e.contesta(MOTO, { texto: 'proceder cambio de ubicación GSG-AJENO-1' });
      expect((await e.entrega('GSG-AJENO-1'))!.lat).not.toBe(B.lat);
      expect(e.textosA(MOTO).at(-1)).toMatch(/no encuentro GSG-AJENO-1 entre tus pedidos de hoy/);
      expect(e.textosA(MOTO).at(-1)).toMatch(/GSG-COMANDO-1/);
    } finally {
      await e.cerrar();
    }
  });

  it('si el cliente nunca mandó ubicación por WhatsApp, se le dice al motorizado y no se toca nada', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await e.api.post('/api/v1/entregas', conMoto());
      await e.trabajar();
      const antes = e.mensajesA(telefono).length;
      await e.contesta(MOTO, { texto: 'proceder cambio de ubicación' });
      expect(e.textosA(MOTO).at(-1)).toMatch(/todavía no ha mandado ninguna ubicación/);
      expect(e.mensajesA(telefono)).toHaveLength(antes);
      expect((await e.entrega(TRACKING))!.ubicacionEstado).toBe('pendiente');
    } finally {
      await e.cerrar();
    }
  });
});

/**
 * Los números de GSG autorizados en Pedidos GSG → ajustes: motorizados que
 * GSG no manda en el pedido, supervisores. Pueden ordenar el cambio de
 * cualquier pedido de hoy nombrando el tracking (o sin nombrarlo si solo un
 * cliente espera un cambio).
 */
describe('«proceder cambio de ubicación» desde un número de GSG autorizado', () => {
  const GSG_SUPERVISOR = '999777888';

  it('se guarda desde la pantalla y vale con el tracking; sin estar en la lista, no', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await clienteMandoOtraTarde(e);
      // Sin autorizar: es un mensaje cualquiera.
      await e.contesta(GSG_SUPERVISOR, { texto: `proceder cambio de ubicación ${TRACKING}` });
      expect((await e.entrega(TRACKING))!.lat).not.toBe(B.lat);
      expect(e.textosA(GSG_SUPERVISOR).some((t) => /ubicación cambiada/.test(t))).toBe(false);

      // Lo autoriza un administrador por la ruta de la pantalla (con el 51 y espacios, como lo pegaría una persona).
      const admin = Fastify();
      admin.decorateRequest('usuario', null);
      admin.addHook('onRequest', async (request) => {
        (request as unknown as { usuario: unknown }).usuario = { rol: 'admin', nombre: 'Ali' };
      });
      await registerEntregasRoutes(admin, { entregas: e.entregas, config: { bbox: null } as never });
      try {
        const g = await admin.inject({ method: 'POST', url: '/admin/entregas/ajustes', payload: { autorizadosCambioUbicacion: ['51 999 777 888'] } });
        expect(g.statusCode).toBe(200);
        expect((g.json() as { ajustes: { autorizadosCambioUbicacion: string[] } }).ajustes.autorizadosCambioUbicacion).toEqual(['51 999 777 888']);
        // La pantalla lo vuelve a leer del resumen.
        const resumen = (await admin.inject({ method: 'GET', url: '/admin/entregas' })).json() as { ajustes?: { autorizadosCambioUbicacion?: string[] } };
        expect(resumen.ajustes?.autorizadosCambioUbicacion).toEqual(['51 999 777 888']);
      } finally {
        await admin.close();
      }

      const antes = e.mensajesA(telefono).length;
      await e.contesta(GSG_SUPERVISOR, { texto: `Proceder cambio de ubicacion ${TRACKING}` });
      expect(await e.entrega(TRACKING)).toMatchObject({ ubicacionEstado: 'recibida', lat: B.lat, lng: B.lng });
      expect(cuerpos(e.mensajesA(telefono).slice(antes))).toEqual([expect.stringMatching(/nueva ubicación se registró correctamente/)]);
      expect(e.textosA(GSG_SUPERVISOR).at(-1)).toMatch(/^✅ GSG-COMANDO-1 \(Lucía/);
      const ent = (await e.entrega(TRACKING))!;
      const detalle = (await e.entregas.entrega(ent.id))!;
      expect(detalle.eventos.some((x) => /de el 999777888 \(número de GSG autorizado, por WhatsApp\)/.test(x.detalle ?? ''))).toBe(true);
    } finally {
      await e.cerrar();
    }
  });

  it('sin tracking: vale si solo un cliente espera un cambio; si no, pregunta cuál', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await e.entregas.guardarAjustes({ autorizadosCambioUbicacion: [GSG_SUPERVISOR] });
      // Nadie espera un cambio todavía.
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { pin: A });
      e.avanzar(5);
      await e.contesta(GSG_SUPERVISOR, { texto: 'proceder cambio de ubicación' });
      expect(e.textosA(GSG_SUPERVISOR).at(-1)).toMatch(/^Ningún pedido de hoy está esperando un cambio de ubicación/);

      // Uno espera: sin tracking, ese.
      await e.contesta(telefono, { pin: B });
      e.avanzar(5);
      await e.contesta(GSG_SUPERVISOR, { texto: 'proceder cambio de ubicación' });
      expect((await e.entrega(TRACKING))!.lat).toBe(B.lat);

      // Dos esperando: se pregunta.
      const OTRO = '987601488';
      await e.api.post('/api/v1/entregas', { ...pedido, tracking: 'GSG-COMANDO-3', cliente: 'Ana', telefono: OTRO });
      await e.trabajar();
      await e.contesta(OTRO, { pin: A });
      e.avanzar(5);
      await e.contesta(OTRO, { pin: B });
      await e.contesta(telefono, { pin: A });
      e.avanzar(5);
      await e.contesta(GSG_SUPERVISOR, { texto: 'proceder cambio de ubicación' });
      expect(e.textosA(GSG_SUPERVISOR).at(-1)).toMatch(/^Hay 2 clientes esperando un cambio de ubicación/);
    } finally {
      await e.cerrar();
    }
  });
});
