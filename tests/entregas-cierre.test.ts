/**
 * El cierre del día: a la hora del ajuste, lo que quedó vivo de ayer pasa a
 * "necesita una persona" (y GSG se entera) y lo que ya tenía hora avisada se
 * da por entregado. Hoy no se toca, no se repite dos veces el mismo día y se
 * puede lanzar a mano.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, type EscenarioEntregas } from './escenario-entregas.js';

const SUPERVISOR = '51912426667';
const pinDe = (i: number) => ({ lat: PIN_LIMA.lat + i * 0.001, lng: PIN_LIMA.lng - i * 0.001 });

/** Ayer a las 10:00 de Lima (15:00 UTC). */
function ayerALas10(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(15, 0, 0, 0);
  return d;
}

describe('el cierre del día', () => {
  let e: EscenarioEntregas;
  /** Los ids de las de ayer: cuando cambia el día ya no salen en la pantalla de hoy. */
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ supervisor: SUPERVISOR, arranque: ayerALas10() });
    await e.api.post('/admin/motorizados/de-prueba');
  });
  afterAll(() => e.cerrar());

  it('ayer: unos quedan a medias y uno se avisa sin que nadie diga "entregado"', async () => {
    const diaAyer = e.entregas.hoy();
    // Cuatro pedidos: uno sin ubicación, uno sin confirmar, uno con motorizado sin tiempo, uno avisado.
    await e.api.post('/admin/entregas/crear', { referencia: 'Y-1', telefono: '987500001', nombre: 'Sin Ubicación', faltaUbicacion: true, faltaConfirmacion: true });
    await e.api.post('/admin/entregas/crear', { referencia: 'Y-2', telefono: '987500002', nombre: 'Sin Confirmar', faltaUbicacion: false, faltaConfirmacion: true, lat: pinDe(2).lat, lng: pinDe(2).lng });
    await e.api.post('/admin/entregas/crear', { referencia: 'Y-3', telefono: '987500003', nombre: 'Con Motorizado', faltaUbicacion: false, faltaConfirmacion: false, lat: pinDe(3).lat, lng: pinDe(3).lng });
    await e.api.post('/admin/entregas/crear', { referencia: 'Y-4', telefono: '987500004', nombre: 'Avisado', faltaUbicacion: false, faltaConfirmacion: false, lat: pinDe(4).lat, lng: pinDe(4).lng });
    await e.trabajar();
    expect((await e.entrega('Y-1'))?.estado).toBe('esperando_ubicacion');
    expect((await e.entrega('Y-2'))?.estado).toBe('esperando_confirmacion');
    expect((await e.entrega('Y-3'))?.estado).toBe('esperando_motorizado');
    const y4 = await e.entrega('Y-4');
    expect(y4?.estado).toBe('esperando_motorizado');
    await e.contesta(y4!.motorizado!.phone, { texto: 'Y-4 30' });
    expect((await e.entrega('Y-4'))?.estado).toBe('avisada');
    expect((await e.resumen()).cifras.total).toBe(4);
    for (const ref of ['Y-1', 'Y-2', 'Y-3', 'Y-4']) ids[ref] = (await e.entrega(ref))!.id;
    // El motor ya "cerró" al arrancar (no había nada de días anteriores) y no lo repite: todo es de hoy (ayer, en el reloj de la prueba).
    expect(await e.entregas.cerrarDiaSiToca()).toBe(false);
    expect(e.entregas.ultimoCierre()?.dia).toBe(diaAyer);
    expect(e.entregas.ultimoCierre()?.sinTerminar).toEqual([]);
    expect((await e.resumen()).dia).toBe(diaAyer);
    expect((await e.resumen()).cifras.total).toBe(4);
  });

  it('a la hora del cierre (hoy): lo vivo de ayer a incidencia, lo avisado a entregada, GSG se entera y el supervisor recibe UN resumen', async () => {
    const antesSupervisor = e.textosA(SUPERVISOR).length;
    // Hoy a las 00:30 de Lima: el cierre está a las 0.
    e.avanzar(14 * 60 + 30);
    const hoy = e.entregas.hoy();
    expect(hoy).not.toBe((await e.entregas.entrega(ids['Y-1']!))?.entrega.dia);
    const pendiente = await e.resumen();
    expect(pendiente.cierrePendiente).toBe(4);

    const hecho = await e.trabajar();
    expect(hecho.some((h) => h.accion === 'cierre')).toBe(true);
    const cierre = e.entregas.ultimoCierre();
    expect(cierre?.dia).toBe(hoy);
    expect(cierre?.sinTerminar.sort()).toEqual(['Y-1', 'Y-2', 'Y-3']);
    expect(cierre?.dadasPorEntregadas).toEqual(['Y-4']);
    expect(cierre?.quien).toBe('motor');

    const todas = await e.entregas.entrega(ids['Y-1']!);
    expect(todas?.entrega.estado).toBe('incidencia');
    expect(todas?.entrega.incidencia).toBe('dia_cerrado');
    expect(todas?.entrega.cerradaPorDia).toBe(true);
    expect(todas?.entrega.incidenciaDetalle).toMatch(/quedó sin terminar el \d{4}-\d{2}-\d{2}/);
    const y4 = await e.entregas.entrega(ids['Y-4']!);
    expect(y4?.entrega.estado).toBe('entregada');
    expect(y4?.entrega.entregadaComo).toBe('cierre');
    expect(y4?.entrega.cerradaPorDia).toBe(true);
    expect(y4?.entrega.situacion).toMatch(/dio por entregada al cerrar el día/);
    expect(y4?.eventos.some((ev) => ev.tipo === 'entregada')).toBe(true);
    // Al motorizado de Y-3 (con el pin sin contestar) se le avisa que ya no lo lleva.
    const y3 = (await e.entregas.entrega(ids['Y-3']!))!.entrega;
    const alRider = e.textosA(y3.motorizado!.phone);
    expect(alRider[alRider.length - 1]).toMatch(/ya no lo llevas/);
    // Al cliente de Y-4 no se le escribe nada por el cierre.
    expect(e.textosA('987500004').filter((t) => /entregado/i.test(t))).toHaveLength(0);

    // GSG: confirmaciones con motivo dia_cerrado (siguen pendientes, no canceladas) y la entrega por cierre.
    await e.despacharAGsg();
    const confs = e.simulador.recibido.filter((r) => r.tipo === 'confirmacion' && r.cuerpo.motivo === 'dia_cerrado').map((r) => r.cuerpo.referencia);
    expect(confs.sort()).toEqual(['Y-1', 'Y-2', 'Y-3']);
    const ent = e.simulador.recibido.filter((r) => r.tipo === 'entrega' && r.cuerpo.referencia === 'Y-4').pop();
    expect(ent?.cuerpo).toMatchObject({ entregadoEn: null, entregadaComo: 'cierre' });

    // Un solo mensaje al supervisor con el resumen.
    const alSupervisor = e.textosA(SUPERVISOR);
    expect(alSupervisor).toHaveLength(antesSupervisor + 1);
    expect(alSupervisor[alSupervisor.length - 1]).toMatch(/Cierre del día: 3 pedidos quedaron sin terminar \(Y-1, Y-2, Y-3\)/);
    expect(alSupervisor[alSupervisor.length - 1]).toMatch(/1 se dio por entregado \(Y-4\)/);

    // Hoy arranca limpio y ya no hay nada pendiente de cerrar.
    const r = await e.resumen();
    expect(r.cifras.total).toBe(0);
    expect(r.cierrePendiente).toBe(0);
    expect(r.ultimoCierre?.dia).toBe(hoy);
    // Las de ayer siguen consultables por id, y en la campana ya no aparece "de ayer sin cerrar".
    const avisos = await e.api.get<{ avisos: Array<{ tipo: string }> }>('/admin/avisos');
    expect(avisos.body.avisos.some((a) => a.tipo === 'cierre')).toBe(false);
  });

  it('no se repite el mismo día, ni toca lo de hoy; a mano se puede forzar', async () => {
    await e.api.post('/admin/entregas/crear', { referencia: 'H-1', telefono: '987500011', nombre: 'De Hoy', faltaUbicacion: true, faltaConfirmacion: true });
    await e.trabajar();
    expect((await e.entrega('H-1'))?.estado).toBe('esperando_ubicacion');
    e.avanzar(60);
    expect(await e.entregas.cerrarDiaSiToca()).toBe(false);
    expect((await e.entrega('H-1'))?.estado).toBe('esperando_ubicacion');
    const otra = await e.entregas.cerrarDia();
    expect(otra.ok).toBe(false);
    expect(otra.motivo).toMatch(/ya se cerró hoy/);
    // A mano (forzado): no hay nada de ayer, así que no cambia nada, pero queda apuntado quién lo hizo.
    const aMano = await e.api.post<{ ok: boolean; resultado: { sinTerminar: string[]; dadasPorEntregadas: string[]; quien: string } }>('/admin/entregas/cerrar-dia', { forzar: true });
    expect(aMano.status).toBe(200);
    expect(aMano.body.ok).toBe(true);
    expect(aMano.body.resultado.sinTerminar).toEqual([]);
    expect(aMano.body.resultado.quien).not.toBe('motor');
    expect((await e.entrega('H-1'))?.estado).toBe('esperando_ubicacion');
    // Con el cierre automático apagado, el motor no cierra aunque cambie el día.
    await e.entregas.guardarAjustes({ cierreDelDia: { activo: false, hora: 0 } });
    e.avanzar(24 * 60);
    expect(await e.entregas.cerrarDiaSiToca()).toBe(false);
    expect((await e.resumen()).cierrePendiente).toBe(1);
    // Encendido pero antes de la hora, tampoco.
    await e.entregas.guardarAjustes({ cierreDelDia: { activo: true, hora: 23 } });
    expect(await e.entregas.cerrarDiaSiToca()).toBe(false);
    await e.entregas.guardarAjustes({ cierreDelDia: { activo: true, hora: 0 } });
    expect(await e.entregas.cerrarDiaSiToca()).toBe(true);
    expect((await e.resumen()).cierrePendiente).toBe(0);
  });
});
