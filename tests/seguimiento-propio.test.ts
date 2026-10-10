/**
 * El seguimiento con los datos de GSGchat (src/entregas/seguimiento-propio.ts):
 * la ruta del motorizado sale de sus pedidos de hoy en el orden en que se le
 * asignaron; la posicion, de lo mas fresco que haya. Nunca se le pide nada a GSG.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Entrega, Motorizado } from '../src/entregas/repo.js';
import { crearFuentePropia, type DepsFuentePropia } from '../src/entregas/seguimiento-propio.js';
import { crearConsultaSeguimiento, textoSeguimiento, type CalcularRuta } from '../src/entregas/seguimiento-gsg.js';
import { crearFuenteCombinada, crearSeguimientosRecibidosMemoria } from '../src/entregas/seguimiento-recibido.js';

const AHORA = new Date('2026-10-10T16:00:00.000Z');
const minutos = (n: number) => new Date(AHORA.getTime() + n * 60_000);

function entrega(i: number, extra: Partial<Entrega> = {}): Entrega {
  return {
    id: i,
    dia: '2026-10-10',
    referencia: `P-${i}`,
    phone: `5198700${String(i).padStart(4, '0')}`,
    datosEnvio: { tracking: `TRK-${i}` },
    lat: -12 - i / 1000,
    lng: -77 - i / 1000,
    motorizadoId: 7,
    motorizadoEnviadoAt: minutos(-300 + i),
    estado: 'avisada',
    entregadaAt: null,
    createdAt: minutos(-400),
    ...extra,
  } as Entrega;
}

const MOTO: Motorizado = { id: 7, phone: '51911111111', nombre: 'Luis', ultimaLat: -12.002, ultimaLng: -77.002, ultimaPosicionAt: minutos(-3) } as Motorizado;

/** 20 paradas del motorizado 7; las dos primeras ya entregadas. */
function ruta20(): Entrega[] {
  return Array.from({ length: 20 }, (_, k) => entrega(k + 1, k < 2 ? { estado: 'entregada', entregadaAt: minutos(-10 + k) } : {}));
}

function deps(entregas: Entrega[], extra: Partial<DepsFuentePropia> = {}): DepsFuentePropia {
  return {
    entregasDelDia: async () => entregas,
    motorizado: async (id) => (id === MOTO.id ? MOTO : null),
    motorizadoPorTelefono: async (phone) => (phone === MOTO.phone ? MOTO : null),
    ahora: () => AHORA,
    ...extra,
  };
}

describe('seguimiento con datos propios', () => {
  it('20 paradas, el motorizado en la 2 y el cliente en la 10: quedan 8 paradas y Google da km y minutos', async () => {
    const calcular = vi.fn<CalcularRuta>(async () => ({ km: 6.4, minutos: 31 }));
    // Desordenadas a proposito: el orden es el de asignacion.
    const consulta = crearConsultaSeguimiento(crearFuentePropia(deps(ruta20().reverse())), calcular, () => AHORA);
    const r = await consulta.consultar('TRK-10');
    expect(r).not.toBeNull();
    expect(r!.ruta.puntoActual).toBe(2);
    expect(r!.ruta.puntoCliente).toBe(10);
    expect(r!.ruta.paradas).toHaveLength(8);
    expect(r!.ruta.paradas.map((p) => p.orden)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r!.ruta.paradas.at(-1)).toMatchObject({ lat: -12.01, lng: -77.01 });
    expect(r!.ruta.posicion).toMatchObject({ lat: -12.002, lng: -77.002, fuente: 'reporte' });
    expect(calcular).toHaveBeenCalledTimes(1);
    const texto = textoSeguimiento('TRK-10', r!);
    expect(texto).toContain('el motorizado está en el punto 2');
    expect(texto).toContain('tu entrega corresponde al punto 10');
    expect(texto).toContain('Quedan 8 paradas');
    expect(texto).toContain('6.4 km y 31 minutos');
  });

  it('sin clave de Google: solo las paradas, sin km', async () => {
    const r = await crearConsultaSeguimiento(crearFuentePropia(deps(ruta20())), undefined, () => AHORA).consultar('TRK-10');
    const texto = textoSeguimiento('TRK-10', r!);
    expect(texto).toContain('Quedan 8 paradas');
    expect(texto).not.toMatch(/\bkm\b/);
  });

  it('una parada entregada fuera de orden cuenta como hecha: quedan las pendientes', async () => {
    const lista = ruta20();
    lista[5] = { ...lista[5]!, estado: 'entregada', entregadaAt: minutos(-1) };
    lista[3] = { ...lista[3]!, estado: 'cancelada' };
    const r = await crearConsultaSeguimiento(crearFuentePropia(deps(lista)), undefined, () => AHORA).consultar('TRK-10');
    // Sin la cancelada el cliente es el punto 9; hechas: 1, 2 y la 6 de antes (ahora 5).
    expect(r!.ruta.puntoCliente).toBe(9);
    expect(r!.ruta.puntoActual).toBe(3);
    expect(r!.ruta.paradas).toHaveLength(6);
  });

  it('la posicion mas fresca manda: el GPS en vivo gana a la ultima reportada', async () => {
    const vivo = { lat: -12.0045, lng: -77.0045, at: minutos(-1) };
    const fuente = crearFuentePropia(deps(ruta20(), { posicionEnVivo: async (phone) => (phone === MOTO.phone ? vivo : null) }));
    const r = await crearConsultaSeguimiento(fuente, undefined, () => AHORA).consultar('TRK-10');
    expect(r!.ruta.posicion).toMatchObject({ lat: -12.0045, fuente: 'gps' });
  });

  it('sin posicion reciente no se inventa: se cuentan paradas y no se llama a Google', async () => {
    const viejo = { ...MOTO, ultimaPosicionAt: minutos(-180) };
    const lista = ruta20().map((x) => (x.entregadaAt ? { ...x, entregadaAt: minutos(-200) } : x));
    const calcular = vi.fn<CalcularRuta>(async () => ({ km: 1, minutos: 1 }));
    const fuente = crearFuentePropia({ ...deps(lista), motorizado: async () => viejo });
    const r = await crearConsultaSeguimiento(fuente, calcular, () => AHORA).consultar('TRK-10');
    expect(r!.ruta.posicion).toBeUndefined();
    expect(calcular).not.toHaveBeenCalled();
    expect(textoSeguimiento('TRK-10', r!)).toContain('Aún no tenemos una posición reciente del motorizado');
  });

  it('se usa la ultima entrega como posicion si es lo mas fresco', async () => {
    const fuente = crearFuentePropia({ ...deps(ruta20()), motorizado: async () => ({ ...MOTO, ultimaLat: null, ultimaLng: null, ultimaPosicionAt: null }) });
    const r = await crearConsultaSeguimiento(fuente, async () => ({ km: 3, minutos: 12 }), () => AHORA).consultar('TRK-10');
    expect(r!.ruta.posicion).toMatchObject({ fuente: 'ultima_entrega', lat: -12.002 });
    expect(textoSeguimiento('TRK-10', r!)).toContain('desde su última entrega registrada');
  });

  it('sin motorizado, sin pin en una parada o con el pedido ya entregado: null (texto fijo de siempre)', async () => {
    const sinMoto = ruta20().map((x) => ({ ...x, motorizadoId: null }));
    expect(await crearFuentePropia(deps(sinMoto))('TRK-10')).toBeNull();
    const sinPin = ruta20();
    sinPin[4] = { ...sinPin[4]!, lat: null, lng: null };
    expect(await crearFuentePropia(deps(sinPin))('TRK-10')).toBeNull();
    expect(await crearFuentePropia(deps(ruta20()))('TRK-1')).toBeNull();
    expect(await crearFuentePropia(deps(ruta20()))('NO-EXISTE')).toBeNull();
  });

  it('el motorizado que mando GSG (su telefono) arma la ruta igual', async () => {
    const lista = ruta20().map((x) => ({ ...x, motorizadoId: null, motorizadoEnviadoAt: null, createdAt: minutos(-300 + x.id), datosEnvio: { ...x.datosEnvio, telefonoMotorizado: '911 111 111' } }));
    const r = await crearConsultaSeguimiento(crearFuentePropia(deps(lista)), undefined, () => AHORA).consultar('TRK-10');
    expect(r!.ruta).toMatchObject({ puntoActual: 2, puntoCliente: 10 });
    expect(r!.ruta.posicion?.fuente).toBe('reporte');
  });

  it('preguntas repetidas sin datos nuevos no vuelven a llamar a Google; con posicion nueva, si', async () => {
    let reloj = AHORA;
    let moto = MOTO;
    const calcular = vi.fn<CalcularRuta>(async () => ({ km: 6.4, minutos: 31 }));
    const fuente = crearFuentePropia({ ...deps(ruta20()), motorizado: async () => moto, ahora: () => reloj });
    const consulta = crearConsultaSeguimiento(fuente, calcular, () => reloj);
    for (let i = 0; i < 5; i++) {
      expect(await consulta.consultar('TRK-10')).not.toBeNull();
      reloj = new Date(reloj.getTime() + 60_000);
    }
    expect(calcular).toHaveBeenCalledTimes(1);
    moto = { ...MOTO, ultimaLat: -12.003, ultimaPosicionAt: reloj };
    await consulta.consultar('TRK-10');
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('lo que GSG empujo y es reciente manda sobre los datos propios', async () => {
    const recibidos = crearSeguimientosRecibidosMemoria();
    await recibidos.guardar({ tracking: 'TRK-10', recibidoAt: minutos(-2), cuerpo: { tracking: 'TRK-10', posicion: { lat: -12.1, lng: -77.1, actualizadaAt: minutos(-2).toISOString() }, puntoActual: 5, puntoCliente: 7, paradas: [{ lat: -12.11, lng: -77.11, orden: 6 }, { lat: -12.12, lng: -77.12, orden: 7 }] } });
    const fuente = crearFuenteCombinada(recibidos, crearFuentePropia(deps(ruta20())), () => AHORA);
    const r = await crearConsultaSeguimiento(fuente, undefined, () => AHORA).consultar('TRK-10');
    expect(r!.ruta).toMatchObject({ puntoActual: 5, puntoCliente: 7, origen: 'gsg' });
    // Viejo (mas de 30 min): vuelve a los datos propios.
    const tarde = new Date(AHORA.getTime() + 40 * 60_000);
    const otra = crearConsultaSeguimiento(crearFuenteCombinada(recibidos, crearFuentePropia({ ...deps(ruta20()), ahora: () => tarde }), () => tarde), undefined, () => tarde);
    expect((await otra.consultar('TRK-10'))!.ruta).toMatchObject({ puntoActual: 2, puntoCliente: 10, origen: 'propio' });
  });
});
