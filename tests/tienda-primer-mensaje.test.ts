/**
 * {tienda} en los textos del flujo GSG (la tienda que manda GSG en el pedido,
 * distinta de {negocio}) y la espera configurable del primer mensaje.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { SendJob, SendOutcome, Sender } from '../src/outbound/sender.js';
import { crearMotor, OPCIONES_POR_DEFECTO, type OpcionesMotor } from '../src/rutas/motor.js';
import { crearPuertoEnEspera } from '../src/rutas/gsg.js';
import { ajustesPorDefecto, ajustesSchema, rellenarTexto } from '../src/rutas/ajustes.js';
import { rellenar } from '../src/entregas/textos.js';
import { datosEnvioDeCrudo } from '../src/entregas/datos-envio.js';
import { createFakeRutas } from './fakes-rutas.js';
import { createFakeRepos, type FakeRepos } from './fakes.js';

const HORA_BUENA = new Date('2026-03-10T15:00:00Z'); // martes 10:00 en Lima
const opciones: OpcionesMotor = { ...OPCIONES_POR_DEFECTO, timezone: 'America/Lima' };

function senderFalso() {
  const enviados: SendJob[] = [];
  const sender: Sender = {
    async send(job) {
      enviados.push(job);
      return { ok: true, wamid: `wamid.${enviados.length}`, deliveryId: enviados.length } as SendOutcome;
    },
  };
  return { sender, enviados };
}

async function loteListo(repos: FakeRepos, telefono: string, referencia: string) {
  const lote = await repos.rutas.crearLote({ nombre: 'Reparto de prueba' });
  await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: telefono, phone: telefono, nombre: 'Ana Ruiz', referencia }]);
  await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
  return lote;
}

describe('{tienda}', () => {
  it('rellenarTexto pone la tienda del pedido y deja {negocio} como está', () => {
    expect(rellenarTexto('Somos {negocio}, tu pedido de {tienda}.', { nombre: 'Ana', negocio: 'GSG', tienda: 'Mass' })).toBe('Somos GSG, tu pedido de Mass.');
  });

  it('sin tienda dice «la tienda», nunca deja la variable', () => {
    for (const tienda of [undefined, null, '', '  ']) {
      expect(rellenarTexto('Tu pedido de {tienda}.', { nombre: 'Ana', negocio: 'GSG', tienda })).toBe('Tu pedido de la tienda.');
    }
  });

  it('los textos de entregas (primer mensaje de GSG) también la entienden', () => {
    const base = { nombre: 'Ana Ruiz', negocio: 'GSG', pedido: 'P-1' };
    expect(rellenar('{negocio} lleva tu pedido de {tienda}.', { ...base, envio: { empresaCodigo: '516', empresaNombre: 'Mass' } })).toBe('GSG lleva tu pedido de Mass.');
    expect(rellenar('{negocio} lleva tu pedido de {tienda}.', { ...base, envio: null })).toBe('GSG lleva tu pedido de la tienda.');
  });

  it('la Empresa que manda GSG es {tienda}, venga como texto o como {codigo, nombre}', () => {
    const base = { nombre: 'Ana Ruiz', negocio: 'GSG', pedido: 'P-1' };
    expect(rellenar('{tienda}', { ...base, envio: datosEnvioDeCrudo({ empresa: 'Mass' }) })).toBe('Mass');
    expect(rellenar('{tienda}', { ...base, envio: datosEnvioDeCrudo({ empresa: { codigo: '516', nombre: 'Mass' } }) })).toBe('Mass');
  });
});

describe('{producto}', () => {
  it('pone el producto de GSG; sin producto no queda la variable', () => {
    expect(rellenarTexto('Tu {producto} de {tienda}.', { nombre: 'Ana', negocio: 'GSG', tienda: 'Mass', producto: 'Zapatillas' })).toBe('Tu Zapatillas de Mass.');
    expect(rellenarTexto('Tu pedido {producto} de {tienda}.', { nombre: 'Ana', negocio: 'GSG', tienda: 'Mass' })).toBe('Tu pedido de Mass.');
  });
});

describe('el motor: {tienda} del pedido de GSG', () => {
  let repos: FakeRepos;
  beforeEach(() => {
    repos = createFakeRepos();
  });

  it('sale la tienda del pedido vinculado; sin pedido, «la tienda»', async () => {
    const lote = await loteListo(repos, '51987654321', 'GSG-1');
    const { entrega } = await repos.entregas.crearEntrega({
      dia: '2026-03-10', referencia: 'GSG-1', phone: '51987654321', nombre: 'Ana Ruiz',
      datosEnvio: { empresaCodigo: '516', empresaNombre: 'Mass', producto: 'Zapatillas' },
      ubicacionEstado: 'pendiente', confirmacionEstado: 'no_requerida', estado: 'pendiente',
    } as never);
    await repos.entregas.actualizar(entrega.id, { loteId: lote.id } as never);
    await repos.rutas.ajustes.set({ textos: { solicitud: ['Hola {nombre}, {negocio}: tu pedido {producto} de {tienda}.'], recordatorio: [], insistencia: [] } }, ajustesPorDefecto(opciones));
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones: { ...opciones, negocio: 'GSG Courier' }, usarPlantilla: () => false, ahora: () => HORA_BUENA, azar: () => 0 });

    expect((await motor.tick()).accion).toBe('envio');
    expect(enviados[0]?.interactive?.body).toBe('Hola Ana, GSG Courier: tu pedido Zapatillas de Mass.');

    await loteListo(repos, '51987654322', 'GSG-2');
    const motor2 = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones: { ...opciones, negocio: 'GSG Courier' }, usarPlantilla: () => false, ahora: () => new Date(HORA_BUENA.getTime() + 60_000), azar: () => 0 });
    expect((await motor2.tick()).accion).toBe('envio');
    expect(enviados[1]?.interactive?.body).toBe('Hola Ana, GSG Courier: tu pedido de la tienda.');
  });
});

describe('la espera del primer mensaje', () => {
  it('se guarda (0 a 1440) y sin guardar es de inmediato', () => {
    expect(ajustesSchema.partial().parse({ esperaPrimerMensajeMinutos: 15 }).esperaPrimerMensajeMinutos).toBe(15);
    expect(() => ajustesSchema.partial().parse({ esperaPrimerMensajeMinutos: -1 })).toThrow();
    expect(ajustesPorDefecto(opciones).esperaPrimerMensajeMinutos ?? 0).toBe(0);
  });

  it('el primer mensaje sale a los minutos configurados desde que llegó el pedido', async () => {
    const repos = createFakeRepos();
    repos.rutas = createFakeRutas(() => HORA_BUENA);
    await loteListo(repos, '51987654321', 'GSG-1');
    await repos.rutas.ajustes.set({ esperaPrimerMensajeMinutos: 10 }, ajustesPorDefecto(opciones));
    const { sender, enviados } = senderFalso();
    let momento = new Date(HORA_BUENA.getTime() + 5 * 60_000);
    const motor = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones, usarPlantilla: () => false, ahora: () => momento, azar: () => 0 });

    expect((await motor.tick()).accion).toBe('nada');
    expect(enviados).toHaveLength(0);
    const [sol] = await repos.rutas.listarSolicitudes({ limit: 1, offset: 0 });
    expect(sol!.proximoIntentoAt!.getTime()).toBe(HORA_BUENA.getTime() + 10 * 60_000);

    momento = new Date(HORA_BUENA.getTime() + 10 * 60_000);
    expect((await motor.tick()).accion).toBe('envio');
    expect(enviados).toHaveLength(1);
  });

  it('con 0 sale de inmediato, como siempre', async () => {
    const repos = createFakeRepos();
    repos.rutas = createFakeRutas(() => HORA_BUENA);
    await loteListo(repos, '51987654321', 'GSG-1');
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones, usarPlantilla: () => false, ahora: () => HORA_BUENA, azar: () => 0 });
    expect((await motor.tick()).accion).toBe('envio');
    expect(enviados).toHaveLength(1);
  });
});
