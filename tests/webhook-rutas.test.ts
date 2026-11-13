/**
 * Webhook de estados de rutas (pedido de GSG, 12/11). Las preguntas de la
 * operacion: ¿una ruta inactiva cierra el chat y no sale nada (ni a mano)?
 * ¿se vuelve a abrir sola y lo pendiente sigue? ¿un aviso viejo no deshace uno
 * nuevo? ¿un pedido de una ruta ya inactiva entra con el chat cerrado?
 * ¿el secreto protege la entrada?
 */
import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import { efectoDeEstado, estadoCierra, huellaSecreto, leerAvisos } from '../src/rutas-gsg/servicio.js';
import { loadConfig } from '../src/config.js';
import { hashClave } from '../src/auth/usuarios.js';
import { COOKIE_SESION, firmarSesion } from '../src/auth/sesion.js';
import { secretoDeSesion } from '../src/auth/routes.js';

const SECRETO = 'whr_secreto-de-prueba-123456';
const tel = '987601555';
// El código de ruta es el tracking del pedido (pedido del dueño, 12/11).
const pedido = (extra: Record<string, unknown> = {}) => ({ ...OBLIGATORIOS_GSG, tracking: 'R-100', cliente: 'Cliente de prueba', telefono: tel, ...extra });

async function conSecreto(e: EscenarioEntregas) {
  await e.repos.rutasGsg.guardarSecreto(huellaSecreto(SECRETO), SECRETO.slice(-4), e.ahora());
}

/** Lo que haria el sistema de rutas de GSG. */
const avisar = (e: EscenarioEntregas, cuerpo: unknown, secreto: string | null = SECRETO) =>
  e.app.inject({ method: 'POST', url: '/api/v1/rutas/estado', headers: secreto ? { 'x-webhook-secret': secreto } : {}, payload: cuerpo as Record<string, unknown> });

/** Espera a que el ultimo aviso termine de procesarse (se contesta antes de procesar). */
async function procesado(e: EscenarioEntregas) {
  for (let i = 0; i < 200; i++) {
    if (e.repos.rutasGsg._eventos.length && e.repos.rutasGsg._eventos.every((x) => x.resultado !== 'recibido')) return e.repos.rutasGsg._eventos.at(-1)!;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('el aviso no se proceso');
}

const contactoDe = async (e: EscenarioEntregas, telefono: string) => (await e.repos.contacts.getByPhone(`51${telefono}`))!;

describe('estados que cierran', () => {
  it('solo INACTIVO cierra; RECHAZADO, ENTREGADO y CANCELADO no; cualquier otro es «volvió a estar activa»', () => {
    for (const x of ['INACTIVO', 'Inactivo', 'inactiva', 'INACTIVA']) {
      expect(estadoCierra(x)).toBe(true);
      expect(efectoDeEstado(x)).toBe('cierra');
    }
    for (const x of ['RECHAZADO', 'Entregado', 'CANCELADO', 'cancelada', 'entregada']) {
      expect(estadoCierra(x)).toBe(false);
      expect(efectoDeEstado(x)).toBe('final');
    }
    // Los de antes (finalizada, cerrada, completada…) ya no cierran: GSG solo manda los cuatro.
    for (const x of ['EN RUTA', 'En_Ruta', 'ACTIVA', 'PROGRAMADA', 'FINALIZADA', 'Cerrada', 'Completada', 'REACTIVADA A MANO (Ali)']) {
      expect(estadoCierra(x)).toBe(false);
      expect(efectoDeEstado(x)).toBe('activa');
    }
  });

  it('lee el aviso con sus alias y explica lo que falta', () => {
    const ahora = new Date('2026-11-12T15:00:00Z');
    const r = leerAvisos({ idRuta: 'R-9', status: 'Finalizada', changedAt: '2026-11-12T10:00:00-05:00' }, ahora);
    expect(r).toEqual({ avisos: [{ ruta: 'R-9', estado: 'Finalizada', fecha: new Date('2026-11-12T15:00:00Z') }] });
    expect(leerAvisos({ ruta: 'R-9' }, ahora)).toMatchObject({ campo: 'estado' });
    expect(leerAvisos({ estado: 'INACTIVA' }, ahora)).toMatchObject({ campo: 'ruta' });
    // Solo el código de ruta identifica la ruta: los trackings sueltos no bastan.
    expect(leerAvisos({ estado: 'INACTIVA', trackings: ['R-100'] }, ahora)).toMatchObject({ campo: 'ruta' });
    expect(leerAvisos({ ruta: 'R-9', estado: 'INACTIVA', fecha: 'ayer' }, ahora)).toMatchObject({ campo: 'fecha' });
  });
});

describe('POST /api/v1/rutas/estado', () => {
  it('sin secreto configurado contesta 503; con el secreto mal, 401; sin estado, 400', async () => {
    const e = await crearEscenarioEntregas();
    try {
      expect((await avisar(e, { ruta: 'R-100', estado: 'INACTIVA' })).statusCode).toBe(503);
      await conSecreto(e);
      const sinHeader = await avisar(e, { ruta: 'R-100', estado: 'INACTIVA' }, null);
      expect(sinHeader.statusCode).toBe(401);
      expect(sinHeader.json().codigo).toBe('SECRETO_INVALIDO');
      expect((await avisar(e, { ruta: 'R-100', estado: 'INACTIVA' }, 'otro')).statusCode).toBe(401);
      const malo = await avisar(e, { ruta: 'R-100' });
      expect(malo.statusCode).toBe(400);
      expect(malo.json().detalles[0].campo).toBe('estado');
      expect(e.repos.rutasGsg._eventos).toHaveLength(0);
    } finally {
      await e.cerrar();
    }
  });

  it('ruta inactiva: contesta 202 al momento, cierra el chat y no sale nada (ni lo automático ni a mano)', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await conSecreto(e);
      await e.api.post('/api/v1/entregas', pedido());
      const r = await avisar(e, { ruta: 'R-100', estado: 'INACTIVA', fecha: e.ahora().toISOString() });
      expect(r.statusCode).toBe(202);
      expect(r.json()).toMatchObject({ ok: true, recibidos: 1 });
      const ev = await procesado(e);
      expect(ev).toMatchObject({ resultado: 'aplicado', chats: 1 });

      const c = await contactoDe(e, tel);
      expect(await e.repos.rutasGsg.bloqueoDe(c.id)).toMatchObject({ ruta: 'R-100', estado: 'INACTIVA' });
      // El primer mensaje del pedido no sale.
      await e.trabajar();
      expect(e.mensajesA(tel)).toHaveLength(0);
      // Ni escrito a mano por GSG (API 4).
      const aMano = await e.api.post<{ ok?: boolean; codigo?: string; error?: string }>('/api/v1/chat', { tracking: 'R-100', texto: 'Hola, soy tu motorizado', idExterno: 'gsg-ruta-1', usuario: { id: 77, nombre: 'Juan', rol: 'motorizado' } });
      expect(aMano.body.ok).not.toBe(true);
      // Y el motivo es la ruta, no otro: el envío quedó frenado con su código.
      expect(JSON.stringify(aMano.body)).toMatch(/ruta R-100|ruta_inactiva|chat est[aá] cerrado/i);
      expect(e.mensajesA(tel)).toHaveLength(0);
      // La bitacora del pedido lo cuenta.
      const pedidoGuardado = (await e.repos.entregas.porTracking('R-100'))!;
      const eventos = await e.repos.entregas.eventos(pedidoGuardado.id);
      expect(eventos.some((x) => /Chat cerrado: la ruta R-100 pasó a «INACTIVA»/.test(x.detalle ?? ''))).toBe(true);
    } finally {
      await e.cerrar();
    }
  });

  it('al volver a «EN RUTA» el chat se abre solo y el mensaje pendiente sale', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await conSecreto(e);
      await e.api.post('/api/v1/entregas', pedido());
      await avisar(e, { ruta: 'R-100', estado: 'INACTIVA', fecha: e.ahora().toISOString() });
      await procesado(e);
      await e.trabajar();
      expect(e.mensajesA(tel)).toHaveLength(0);

      e.avanzar(1);
      await avisar(e, { ruta: 'R-100', estado: 'EN RUTA', fecha: e.ahora().toISOString() });
      const ev = await procesado(e);
      expect(ev).toMatchObject({ resultado: 'aplicado', chats: 1 });
      const c = await contactoDe(e, tel);
      expect(await e.repos.rutasGsg.bloqueoDe(c.id)).toBeNull();
      e.avanzar(11);
      await e.trabajar();
      expect(e.mensajesA(tel).length).toBeGreaterThan(0);
    } finally {
      await e.cerrar();
    }
  });

  for (const estado of ['RECHAZADO', 'ENTREGADO', 'CANCELADO']) {
    it(`«${estado}» no cierra el chat: sigue la regla de 24 horas y queda en la bitácora`, async () => {
      const e = await crearEscenarioEntregas();
      try {
        await conSecreto(e);
        await e.api.post('/api/v1/entregas', pedido());
        await avisar(e, { ruta: 'R-100', estado, fecha: e.ahora().toISOString() });
        const ev = await procesado(e);
        expect(ev).toMatchObject({ resultado: 'aplicado', chats: 0 });
        expect(ev.detalle).toMatch(/No cierra el chat \(regla de 24 h\)/);
        const c = await contactoDe(e, tel);
        expect(await e.repos.rutasGsg.bloqueoDe(c.id)).toBeNull();
        expect(await e.repos.rutasGsg.ruta('R-100')).toMatchObject({ estado, activa: true });
        const pedidoGuardado = (await e.repos.entregas.porTracking('R-100'))!;
        const eventos = await e.repos.entregas.eventos(pedidoGuardado.id);
        expect(eventos.some((x) => new RegExp(`La ruta R-100 pasó a «${estado}»: el chat no se cierra y sigue la regla de 24 horas`).test(x.detalle ?? ''))).toBe(true);
        // Un pedido que llega despues con esa ruta no entra cerrado.
        await e.api.post('/api/v1/entregas', pedido({ tracking: 'R-100', cliente: 'Otro' }));
        expect(await e.repos.rutasGsg.bloqueoDe(c.id)).toBeNull();
      } finally {
        await e.cerrar();
      }
    });
  }

  it('de INACTIVO a ENTREGADO el chat deja de estar cerrado (ninguno de los tres bloquea)', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await conSecreto(e);
      await e.api.post('/api/v1/entregas', pedido());
      await avisar(e, { ruta: 'R-100', estado: 'INACTIVO', fecha: e.ahora().toISOString() });
      await procesado(e);
      const c = await contactoDe(e, tel);
      expect(await e.repos.rutasGsg.bloqueoDe(c.id)).not.toBeNull();
      e.avanzar(1);
      await avisar(e, { ruta: 'R-100', estado: 'ENTREGADO', fecha: e.ahora().toISOString() });
      const ev = await procesado(e);
      expect(ev).toMatchObject({ resultado: 'aplicado', chats: 1 });
      expect(ev.detalle).toMatch(/Se quitó el cierre de 1 chat/);
      expect(await e.repos.rutasGsg.bloqueoDe(c.id)).toBeNull();
    } finally {
      await e.cerrar();
    }
  });

  it('el aviso de corrección (de INACTIVO a cualquier otro estado) reabre el chat como «la ruta volvió a estar activa»', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await conSecreto(e);
      await e.api.post('/api/v1/entregas', pedido());
      await avisar(e, { ruta: 'R-100', estado: 'INACTIVO', fecha: e.ahora().toISOString() });
      await procesado(e);
      e.avanzar(1);
      await avisar(e, { ruta: 'R-100', estado: 'PROGRAMADA', fecha: e.ahora().toISOString() });
      const ev = await procesado(e);
      expect(ev).toMatchObject({ resultado: 'aplicado', chats: 1 });
      expect(ev.detalle).toMatch(/La ruta volvió a estar activa/);
      expect(await e.repos.rutasGsg.bloqueoDe((await contactoDe(e, tel)).id)).toBeNull();
      const pedidoGuardado = (await e.repos.entregas.porTracking('R-100'))!;
      const eventos = await e.repos.entregas.eventos(pedidoGuardado.id);
      expect(eventos.some((x) => /Chat abierto de nuevo: la ruta R-100 volvió a estar activa \(«PROGRAMADA»\)/.test(x.detalle ?? ''))).toBe(true);
    } finally {
      await e.cerrar();
    }
  });

  it('un aviso más viejo que el último aplicado se ignora (llegaron desordenados)', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await conSecreto(e);
      await e.api.post('/api/v1/entregas', pedido());
      const t0 = e.ahora().getTime();
      await avisar(e, { ruta: 'R-100', estado: 'INACTIVA', fecha: new Date(t0).toISOString() });
      await procesado(e);
      // Llega tarde un «EN RUTA» de antes: no reabre.
      await avisar(e, { ruta: 'R-100', estado: 'EN RUTA', fecha: new Date(t0 - 60_000).toISOString() });
      expect(await procesado(e)).toMatchObject({ resultado: 'ignorado_viejo' });
      expect(await e.repos.rutasGsg.bloqueoDe((await contactoDe(e, tel)).id)).not.toBeNull();
    } finally {
      await e.cerrar();
    }
  });


  it('un pedido que llega de una ruta ya inactiva entra con el chat cerrado', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await conSecreto(e);
      await avisar(e, { ruta: 'R-100', estado: 'INACTIVA' });
      expect(await procesado(e)).toMatchObject({ resultado: 'sin_pedidos' });
      await e.api.post('/api/v1/entregas', pedido());
      expect(await e.repos.rutasGsg.bloqueoDe((await contactoDe(e, tel)).id)).toMatchObject({ ruta: 'R-100' });
      await e.trabajar();
      expect(e.mensajesA(tel)).toHaveLength(0);
    } finally {
      await e.cerrar();
    }
  });

  it('un chat cerrado por dos rutas sigue cerrado hasta que se abran las dos', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await conSecreto(e);
      await e.api.post('/api/v1/entregas', { pedidos: [pedido(), pedido({ tracking: 'R-200', telefono: tel })] });
      await avisar(e, [{ ruta: 'R-100', estado: 'INACTIVA' }, { ruta: 'R-200', estado: 'INACTIVA' }]);
      await procesado(e);
      e.avanzar(1);
      await avisar(e, { ruta: 'R-100', estado: 'ACTIVA', fecha: e.ahora().toISOString() });
      const ev = await procesado(e);
      expect(ev.chats).toBe(0);
      expect(ev.detalle).toMatch(/sigue cerrado por otra ruta/);
      expect(await e.repos.rutasGsg.bloqueoDe((await contactoDe(e, tel)).id)).toMatchObject({ ruta: 'R-200' });
    } finally {
      await e.cerrar();
    }
  });
});

describe('la pestaña «Webhook de rutas» (Nuestra API)', () => {
  async function cookieDeAdmin(e: EscenarioEntregas): Promise<string> {
    const config = loadConfig({ PUBLIC_BASE_URL: 'http://localhost:3000', DATABASE_URL: 'mysql://x/y', TIMEZONE: 'America/Lima', TRACKING_SECRET: 'x'.repeat(40) });
    const u = await e.repos.usuarios.crear({ usuario: 'adminrutas', nombre: 'Admin', rol: 'admin', clave: hashClave('Clave-123-segura') });
    return `${COOKIE_SESION}=${firmarSesion(secretoDeSesion(config), { u: u.id, v: u.sesionVersion })}`;
  }

  it('genera el secreto (una vez), prueba un aviso, lista la ruta y la reactiva a mano', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const cookie = await cookieDeAdmin(e);
      await e.api.post('/api/v1/entregas', pedido());
      const inicio = await e.app.inject({ url: '/admin/rutas-webhook', headers: { cookie } });
      expect(inicio.statusCode).toBe(200);
      expect(inicio.json()).toMatchObject({ header: 'x-webhook-secret', secreto: { configurado: false } });
      expect(inicio.json().url).toMatch(/\/api\/v1\/rutas\/estado$/);

      const gen = await e.app.inject({ method: 'POST', url: '/admin/rutas-webhook/secreto', headers: { cookie } });
      const secreto = gen.json().secreto as string;
      expect(secreto).toMatch(/^whr_/);
      // El secreto generado sirve en el webhook.
      expect((await avisar(e, { ruta: 'R-X', estado: 'ACTIVA' }, secreto)).statusCode).toBe(202);
      await procesado(e);

      const prueba = await e.app.inject({ method: 'POST', url: '/admin/rutas-webhook/probar', headers: { cookie }, payload: { ruta: 'R-100', estado: 'INACTIVA' } });
      expect(prueba.json().resultados[0]).toMatchObject({ resultado: 'aplicado', chats: 1 });
      const lista = (await e.app.inject({ url: '/admin/rutas-webhook', headers: { cookie } })).json();
      expect(lista.secreto).toMatchObject({ configurado: true, ultimos: secreto.slice(-4) });
      expect(lista.rutas[0]).toMatchObject({ ruta: 'R-100', activa: false, chatsCerrados: 1 });
      expect(lista.eventos[0]).toMatchObject({ prueba: true, resultado: 'aplicado' });

      const re = await e.app.inject({ method: 'POST', url: '/admin/rutas-webhook/reactivar', headers: { cookie }, payload: { ruta: 'R-100' } });
      expect(re.json()).toMatchObject({ ok: true, resultado: 'aplicado', chats: 1 });
      expect(await e.repos.rutasGsg.bloqueoDe((await contactoDe(e, tel)).id)).toBeNull();
    } finally {
      await e.cerrar();
    }
  });

  it('el chat del cliente dice que está cerrado por la ruta y no deja escribir', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const cookie = await cookieDeAdmin(e);
      await conSecreto(e);
      await e.api.post('/api/v1/entregas', pedido());
      const c = await contactoDe(e, tel);
      // El chat existe desde que el sistema le escribió (aquí, a mano en la base).
      await e.repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', wamid: 'ruta.primer-mensaje', body: '¿Nos comparte su ubicación?', payload: { origen: 'sistema' } });
      const antes = (await e.app.inject({ url: `/admin/chat/${c.id}?limit=30`, headers: { cookie } })).json();
      expect(antes).toMatchObject({ canWrite: true, rutaCerrada: null });
      await avisar(e, { ruta: 'R-100', estado: 'INACTIVO' });
      await procesado(e);
      const hilo = await e.app.inject({ url: `/admin/chat/${c.id}?limit=30`, headers: { cookie } });
      expect(hilo.statusCode).toBe(200);
      expect(hilo.json()).toMatchObject({ canWrite: false, blockedReason: 'chat cerrado: ruta inactiva', rutaCerrada: { ruta: 'R-100', estado: 'INACTIVO' } });
    } finally {
      await e.cerrar();
    }
  });

  it('un operador no ve ni toca el webhook de rutas', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await cookieDeAdmin(e);
      const config = loadConfig({ PUBLIC_BASE_URL: 'http://localhost:3000', DATABASE_URL: 'mysql://x/y', TIMEZONE: 'America/Lima', TRACKING_SECRET: 'x'.repeat(40) });
      const op = await e.repos.usuarios.crear({ usuario: 'operadorrutas', nombre: 'Op', rol: 'operador', clave: hashClave('Clave-123-segura') });
      const cookie = `${COOKIE_SESION}=${firmarSesion(secretoDeSesion(config), { u: op.id, v: op.sesionVersion })}`;
      expect((await e.app.inject({ url: '/admin/rutas-webhook', headers: { cookie } })).statusCode).toBe(403);
      expect((await e.app.inject({ method: 'POST', url: '/admin/rutas-webhook/secreto', headers: { cookie } })).statusCode).toBe(403);
    } finally {
      await e.cerrar();
    }
  });
});
