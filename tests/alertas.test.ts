/**
 * Los avisos: a GSG cómo va el lote, y al coordinador lo que está parado.
 *
 * Lo que hay que demostrar es que avisan **mientras** el lote está en marcha
 * -no cuando ya terminó, que es tarde- y que no se convierten en spam: un
 * aviso que llega cada dos minutos deja de leerse el primer día.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Sender, SendJob, SendOutcome } from '../src/outbound/sender.js';
import { createFakeRepos, type FakeRepos } from './fakes.js';
import { crearPuertoEnEspera } from '../src/rutas/gsg.js';
import {
  ALERTAS_POR_DEFECTO,
  avanceDelLote,
  revisarAlertas,
  textoAviso,
  type OpcionesAlertas,
} from '../src/rutas/alertas.js';

const SUPERVISOR = '51999888777';

function senderFalso() {
  const enviados: SendJob[] = [];
  const sender: Sender = {
    async send(job) {
      enviados.push(job);
      return { ok: true, wamid: `w${enviados.length}`, deliveryId: enviados.length } as SendOutcome;
    },
  };
  return { sender, enviados };
}

let repos: FakeRepos;
let ahora = new Date('2026-03-10T15:00:00Z');
const memoriaNueva = () => ({ ultimoResumen: new Map<string, number>(), ultimoAviso: new Map<string, number>() });

const opciones = (extra: Partial<OpcionesAlertas> = {}): OpcionesAlertas => ({
  ...ALERTAS_POR_DEFECTO,
  supervisor: SUPERVISOR,
  ...extra,
});

/** Un lote en marcha con un caso de cada tipo. */
async function loteConDeTodo() {
  const lote = await repos.rutas.crearLote({ nombre: 'Reparto del jueves' });
  const solicitudes = await repos.rutas.agregarSolicitudes(lote.id, [
    { telefonoCrudo: '987000001', phone: '51987000001', referencia: 'P-1' },
    { telefonoCrudo: '987000002', phone: '51987000002', referencia: 'P-2' },
    { telefonoCrudo: '987000003', phone: '51987000003', referencia: 'P-3' },
    {
      telefonoCrudo: '98700000',
      phone: null,
      referencia: 'P-4',
      estado: 'incidencia',
      incidencia: 'numero_corto',
      requiereHumano: true,
    },
  ]);
  await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');

  // P-1 mandó su ubicación; P-2 contestó otra cosa; P-3 sigue esperando.
  await repos.rutas.actualizarSolicitud(solicitudes[0]!.id, { estado: 'resuelto' });
  await repos.rutas.actualizarSolicitud(solicitudes[1]!.id, {
    estado: 'respondio',
    requiereHumano: true,
    incidencia: 'respondio_sin_ubicacion',
  });
  await repos.rutas.actualizarSolicitud(solicitudes[2]!.id, { estado: 'enviado', intentos: 1 });
  return lote;
}

beforeEach(() => {
  repos = createFakeRepos();
  ahora = new Date('2026-03-10T15:00:00Z');
});

describe('cómo va el lote', () => {
  it('cuenta lo que la operación pregunta', async () => {
    const lote = await loteConDeTodo();
    const avance = await avanceDelLote(repos, lote);

    expect(avance).toMatchObject({
      total: 4,
      conUbicacion: 1,
      contestaron: 2, // el que mandó ubicación y el que contestó otra cosa
      sinContestar: 1,
      necesitanPersona: 2, // el número corto y el que contestó sin ubicación
    });
  });

  it('el aviso se lee de un vistazo en el móvil', async () => {
    const lote = await loteConDeTodo();
    const texto = textoAviso(await avanceDelLote(repos, lote));

    expect(texto).toContain('Reparto del jueves');
    expect(texto).toContain('1 de 4 con ubicación');
    expect(texto).toContain('1 sin contestar');
    expect(texto).toMatch(/2 casos necesitan/);
    expect(texto).toMatch(/número incompleto/i);
    expect(texto.length).toBeLessThan(320);
  });
});

describe('avisos', () => {
  it('manda el avance a GSG mientras el lote está en marcha', async () => {
    await loteConDeTodo();
    const { sender } = senderFalso();

    const salida = await revisarAlertas(
      { repos, sender, gsg: crearPuertoEnEspera(), opciones: opciones({ supervisor: '' }), ahora: () => ahora },
      memoriaNueva(),
    );

    expect(salida.resumenes).toBe(1);
    const reporte = repos.rutas._reportes.find((r) => r.tipo === 'resumen');
    expect(reporte?.payload).toMatchObject({
      enCurso: true,
      conUbicacion: 1,
      contestaron: 2,
      sinContestar: 1,
      necesitanPersona: 2,
    });
  });

  it('avisa al coordinador por WhatsApp de lo que está parado', async () => {
    await loteConDeTodo();
    const { sender, enviados } = senderFalso();

    const salida = await revisarAlertas(
      { repos, sender, gsg: crearPuertoEnEspera(), opciones: opciones(), ahora: () => ahora },
      memoriaNueva(),
    );

    expect(salida.avisos).toBe(1);
    expect(enviados[0]).toMatchObject({ phone: SUPERVISOR, kind: 'freeform', manual: true });
    expect(enviados[0]?.text).toMatch(/necesitan que alguien los vea/);
  });

  it('no repite el aviso cada pocos minutos', async () => {
    await loteConDeTodo();
    const { sender, enviados } = senderFalso();
    const memoria = memoriaNueva();
    const deps = { repos, sender, gsg: crearPuertoEnEspera(), opciones: opciones(), ahora: () => ahora };

    await revisarAlertas(deps, memoria);
    ahora = new Date(ahora.getTime() + 10 * 60_000);
    await revisarAlertas(deps, memoria);

    expect(enviados).toHaveLength(1);

    // Pasada la hora, sí vuelve a avisar.
    ahora = new Date(ahora.getTime() + 60 * 60_000);
    await revisarAlertas(deps, memoria);
    expect(enviados).toHaveLength(2);
  });

  it('sin casos parados no molesta a nadie', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Todo en orden' });
    const [solicitud] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '987000009', phone: '51987000009', referencia: 'P-9' },
    ]);
    await repos.rutas.actualizarSolicitud(solicitud!.id, { estado: 'resuelto' });
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');

    const { sender, enviados } = senderFalso();
    const salida = await revisarAlertas(
      { repos, sender, gsg: crearPuertoEnEspera(), opciones: opciones(), ahora: () => ahora },
      memoriaNueva(),
    );

    expect(enviados).toHaveLength(0);
    // El resumen a GSG sí sale: eso no molesta a nadie.
    expect(salida.resumenes).toBe(1);
  });

  it('sin coordinador configurado, solo se reporta a GSG', async () => {
    await loteConDeTodo();
    const { sender, enviados } = senderFalso();

    const salida = await revisarAlertas(
      { repos, sender, gsg: crearPuertoEnEspera(), opciones: opciones({ supervisor: '' }), ahora: () => ahora },
      memoriaNueva(),
    );

    expect(enviados).toHaveLength(0);
    expect(salida.resumenes).toBe(1);
  });

  it('con los lotes parados no hay nada que avisar', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Preparado, sin arrancar' });
    await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '987000001', phone: '51987000001' },
    ]);

    const { sender, enviados } = senderFalso();
    const salida = await revisarAlertas(
      { repos, sender, gsg: crearPuertoEnEspera(), opciones: opciones(), ahora: () => ahora },
      memoriaNueva(),
    );

    expect(salida).toMatchObject({ resumenes: 0, avisos: 0 });
    expect(salida.motivo).toMatch(/ningun lote en marcha/);
    expect(enviados).toHaveLength(0);
  });

  it('si el aviso al coordinador no sale, no se queda reintentando en bucle', async () => {
    await loteConDeTodo();
    const enviados: SendJob[] = [];
    const sender: Sender = {
      async send(job) {
        enviados.push(job);
        return { ok: false, blocked: false, error: 'sin conexion', retryable: true, deliveryId: null };
      },
    };
    const memoria = memoriaNueva();
    const deps = { repos, sender, gsg: crearPuertoEnEspera(), opciones: opciones(), ahora: () => ahora };

    await revisarAlertas(deps, memoria);
    ahora = new Date(ahora.getTime() + 5 * 60_000);
    await revisarAlertas(deps, memoria);

    expect(enviados).toHaveLength(1);
  });
});
