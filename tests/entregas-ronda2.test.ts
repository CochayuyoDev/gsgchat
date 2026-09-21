/**
 * Lo que pasa en la calle de verdad, segunda ronda: la pregunta de confirmar
 * con botones SÍ / NO, la segunda visita cuando no había nadie, el "cerca"
 * del motorizado, el "me quedo sin moto" (traspaso de todo lo suyo), los
 * pedidos urgentes y la ruta del día de cada motorizado.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, conPais, type EscenarioEntregas } from './escenario-entregas.js';
import { MOTORIZADOS_DE_PRUEBA } from '../src/entregas/datos-de-prueba.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';

const SUPERVISOR = '51912426667';
const pinDe = (i: number) => ({ lat: PIN_LIMA.lat + i * 0.001, lng: PIN_LIMA.lng - i * 0.001 });

/** Crea un pedido con pin (solo falta confirmar), el motor pide confirmar y el cliente dice que sí: queda "lista". */
async function hastaLista(e: EscenarioEntregas, referencia: string, telefono: string, pin: { lat: number; lng: number }, extra: Record<string, unknown> = {}): Promise<void> {
  const r = await e.api.post('/admin/entregas/crear', { referencia, telefono, nombre: `Cliente ${referencia}`, distrito: 'Miraflores', faltaUbicacion: false, faltaConfirmacion: true, lat: pin.lat, lng: pin.lng, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  await e.trabajar();
  expect((await e.entrega(referencia))?.confirmacionEstado).toBe('pedida');
  await e.contesta(telefono, { texto: 'sí' });
  expect((await e.entrega(referencia))?.estado).toBe('lista');
}

/** Lo lleva ESE motorizado (reasignar a mano) y, si se pide, el motorizado da su tiempo: queda "avisada". */
async function conMotorizado(e: EscenarioEntregas, referencia: string, motorizadoId: number, minutos?: string): Promise<void> {
  const entrega = await e.entrega(referencia);
  const r = await e.api.post<{ entrega: { estado: string; motorizadoId: number | null } }>(`/admin/entregas/${entrega!.id}/reasignar`, { motorizadoId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.entrega.estado, `${referencia} debía quedar esperando al motorizado`).toBe('esperando_motorizado');
  expect(r.body.entrega.motorizadoId).toBe(motorizadoId);
  if (minutos) {
    const m = (await e.resumen()).motorizados.find((x) => x.id === motorizadoId)!;
    await e.contesta(m.phone, { texto: `${referencia} ${minutos}` });
    expect((await e.entrega(referencia))?.estado).toBe('avisada');
  }
}

describe('botones, segunda visita, cerca, sin moto, urgentes y ruta', () => {
  let e: EscenarioEntregas;
  let riders: Array<{ id: number; phone: string; nombre: string }>;

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ supervisor: SUPERVISOR });
    await e.api.post('/admin/motorizados/de-prueba');
    riders = (await e.resumen()).motorizados.map((m) => ({ id: m.id, phone: m.phone, nombre: m.nombre }));
    expect(riders).toHaveLength(10);
  });
  afterAll(() => e.cerrar());

  const rider = (nombre: string) => riders.find((r) => r.nombre === nombre)!;

  it('(b2) la pregunta de confirmar sale con dos botones y el botón "Sí, recibo hoy" confirma como botón', async () => {
    await e.api.post('/admin/entregas/crear', { referencia: 'R-3001', telefono: '987300001', nombre: 'Cliente R-3001', faltaUbicacion: false, faltaConfirmacion: true, lat: pinDe(1).lat, lng: pinDe(1).lng });
    await e.trabajar();
    const botones = e.botonesA('987300001');
    expect(botones).toHaveLength(1);
    expect(botones[0]!.body).toMatch(/confirma/i);
    const entrega = await e.entrega('R-3001');
    expect(botones[0]!.buttons.map((b) => b.id)).toEqual([`entrega:si:${entrega!.id}`, `entrega:no:${entrega!.id}`]);
    expect(botones[0]!.buttons.map((b) => b.title)).toEqual(['Sí, recibo hoy', 'No']);

    await e.contesta('987300001', { boton: { id: `entrega:si:${entrega!.id}`, title: 'Sí, recibo hoy' } });
    const despues = await e.entrega('R-3001');
    expect(despues?.confirmacionEstado).toBe('confirmada');
    expect(despues?.confirmacionComo).toBe('boton');
    expect(despues?.estado).toBe('lista');
    const textos = e.textosA('987300001');
    expect(textos[textos.length - 1]).toMatch(/queda confirmado/i);
    await e.despacharAGsg();
    expect(e.simulador.recibido.find((r) => r.tipo === 'confirmacion' && r.cuerpo.referencia === 'R-3001')?.cuerpo).toMatchObject({ confirmada: true, como: 'boton' });
  });

  it('(b2) el botón "No" cancela; y con el pin recién mandado, el gracias con la pregunta también lleva botones', async () => {
    await e.api.post('/admin/entregas/crear', { referencia: 'R-3002', telefono: '987300002', nombre: 'Cliente R-3002', faltaUbicacion: false, faltaConfirmacion: true, lat: pinDe(2).lat, lng: pinDe(2).lng });
    await e.trabajar();
    const entrega = await e.entrega('R-3002');
    await e.contesta('987300002', { boton: { id: `entrega:no:${entrega!.id}`, title: 'No' } });
    const despues = await e.entrega('R-3002');
    expect(despues?.estado).toBe('cancelada');
    expect(despues?.confirmacionComo).toBe('boton');

    // Pin primero: el "gracias + ¿confirma?" sale como un solo mensaje con botones.
    await e.api.post('/admin/entregas/crear', { referencia: 'R-3003', telefono: '987300003', nombre: 'Cliente R-3003', distrito: 'Miraflores', faltaUbicacion: true, faltaConfirmacion: true });
    await e.trabajar();
    await e.contesta('987300003', { pin: pinDe(3) });
    const conPin = e.botonesA('987300003');
    expect(conPin).toHaveLength(1);
    expect(conPin[0]!.body).toMatch(/recibimos su ubicación/i);
    expect(conPin[0]!.buttons[0]!.title).toBe('Sí, recibo hoy');
    await e.contesta('987300003', { boton: { id: `entrega:si:${(await e.entrega('R-3003'))!.id}`, title: 'Sí, recibo hoy' } });
    expect((await e.entrega('R-3003'))?.estado).toBe('lista');
  });

  it('(b2) con el ajuste apagado la pregunta sale como texto de siempre, sin botones', async () => {
    await e.entregas.guardarAjustes({ usarBotones: false });
    await e.api.post('/admin/entregas/crear', { referencia: 'R-3004', telefono: '987300004', nombre: 'Cliente R-3004', faltaUbicacion: false, faltaConfirmacion: true, lat: pinDe(4).lat, lng: pinDe(4).lng });
    await e.trabajar();
    expect(e.botonesA('987300004')).toHaveLength(0);
    expect(e.textosA('987300004')[0]).toMatch(/confirma/i);
    await e.entregas.guardarAjustes({ usarBotones: true });
    await e.contesta('987300004', { texto: 'sí' });
    expect((await e.entrega('R-3004'))?.estado).toBe('lista');
  });

  it('(a3) "no estaba nadie": al cliente se le pregunta si volvemos hoy (con botones), nadie molesta al supervisor todavía y GSG se entera', async () => {
    const carlos = rider('Carlos Rojas');
    await conMotorizado(e, 'R-3003', carlos.id, '30');
    const alSupervisorAntes = e.textosA(SUPERVISOR).length;
    await e.contesta(carlos.phone, { texto: 'no estaba nadie, toqué y nada' });

    const entrega = await e.entrega('R-3003');
    expect(entrega?.estado).toBe('incidencia');
    expect(entrega?.incidencia).toBe('no_entregado');
    expect(entrega?.requiereHumano).toBe(false);
    expect(entrega?.visitas).toBe(1);
    expect(entrega?.segundaVisita).toBe(false);
    expect(entrega?.segundaVisitaPedidaAt).not.toBeNull();
    expect(entrega?.situacion).toMatch(/se le preguntó al cliente si volvemos hoy/);
    expect(entrega?.acciones).toContain('segunda_visita');
    // El cliente recibe la pregunta con sus dos botones; el motorizado, el "estamos preguntando".
    const botones = e.botonesA('987300003');
    const pregunta = botones[botones.length - 1]!;
    expect(pregunta.body).toMatch(/no encontró a nadie/i);
    expect(pregunta.buttons.map((b) => b.title)).toEqual(['Sí, vuelvan hoy', 'No, otro día']);
    const alRider = e.textosA(carlos.phone);
    expect(alRider[alRider.length - 1]).toMatch(/preguntando al cliente si volvemos hoy/i);
    // Al supervisor no se le escribe: el cliente tiene la palabra.
    expect(e.textosA(SUPERVISOR)).toHaveLength(alSupervisorAntes);
    // La pantalla lo cuenta aparte de "necesitan una persona".
    const r = await e.resumen();
    expect(r.cifras.esperandoSegundaVisita).toBe(1);
    expect(r.entregas.filter((x) => x.estado === 'incidencia' && x.requiereHumano)).toHaveLength(0);
    // GSG recibe la entrega con la incidencia y el número de visitas.
    await e.despacharAGsg();
    const reporte = e.simulador.recibido.filter((x) => x.tipo === 'entrega' && x.cuerpo.referencia === 'R-3003').pop();
    expect(reporte?.cuerpo).toMatchObject({ incidencia: 'no_entregado', visitas: 1, segundaVisita: false });
  });

  it('(a3) el cliente pulsa "Sí, vuelvan hoy": el mismo motorizado recibe otra vez el pin, da su tiempo y entrega', async () => {
    const carlos = rider('Carlos Rojas');
    const antes = e.textosA(carlos.phone).length;
    const entrega = await e.entrega('R-3003');
    await e.contesta('987300003', { boton: { id: `entrega:si2:${entrega!.id}`, title: 'Sí, vuelvan hoy' } });

    let act = await e.entrega('R-3003');
    expect(act?.estado).toBe('esperando_motorizado');
    expect(act?.segundaVisita).toBe(true);
    expect(act?.motorizado?.id).toBe(carlos.id);
    expect(act?.incidencia).toBeNull();
    expect(act?.llegaAproxAt).toBeNull();
    expect(act?.situacion).toMatch(/^Segunda visita/);
    const alRider = e.textosA(carlos.phone);
    expect(alRider.length).toBeGreaterThan(antes);
    expect(alRider[alRider.length - 1]).toMatch(/Segunda visita: R-3003/);
    expect(alRider[alRider.length - 1]).toMatch(/ya está en casa/);
    const alCliente = e.textosA('987300003');
    expect(alCliente[alCliente.length - 1]).toMatch(/vuelve a pasar hoy/i);

    await e.contesta(carlos.phone, { texto: '20' });
    act = await e.entrega('R-3003');
    expect(act?.estado).toBe('avisada');
    expect(act?.minutosAviso).toBe(80);
    await e.despacharAGsg();
    const reporte = e.simulador.recibido.filter((x) => x.tipo === 'entrega' && x.cuerpo.referencia === 'R-3003').pop();
    expect(reporte?.cuerpo).toMatchObject({ segundaVisita: true, visitas: 1, incidencia: null });

    await e.contesta(carlos.phone, { texto: 'entregado' });
    act = await e.entrega('R-3003');
    expect(act?.estado).toBe('entregada');
    expect(act?.segundaVisita).toBe(true);
  });

  it('(a3) solo hay una segunda visita: si tampoco estaba, pasa a una persona con el motivo claro', async () => {
    const julio = rider('Julio Espinoza');
    await conMotorizado(e, 'R-3004', julio.id, '25');
    await e.contesta(julio.phone, { texto: 'no me abrieron' });
    const primera = await e.entrega('R-3004');
    expect(primera?.requiereHumano).toBe(false);
    // Una persona fuerza la segunda visita desde el panel (el cliente llamó).
    const forzada = await e.api.post<{ ok: boolean; entrega: { estado: string; segundaVisita: boolean } }>(`/admin/entregas/${primera!.id}/segunda-visita`);
    expect(forzada.status).toBe(200);
    expect(forzada.body.entrega.estado).toBe('esperando_motorizado');
    expect(forzada.body.entrega.segundaVisita).toBe(true);
    await e.contesta(julio.phone, { texto: '15' });
    const alSupervisorAntes = e.textosA(SUPERVISOR).length;
    await e.contesta(julio.phone, { texto: 'no estaba nadie otra vez' });
    const act = await e.entrega('R-3004');
    expect(act?.estado).toBe('incidencia');
    expect(act?.incidencia).toBe('no_entregado');
    expect(act?.requiereHumano).toBe(true);
    expect(act?.visitas).toBe(2);
    expect(act?.incidenciaDetalle).toMatch(/tampoco en la segunda visita/);
    expect(act?.acciones).not.toContain('segunda_visita');
    expect(e.textosA(SUPERVISOR).length).toBe(alSupervisorAntes + 1);
    // Y no se puede pedir otra desde el panel.
    const otra = await e.api.post<{ error: string }>(`/admin/entregas/${act!.id}/segunda-visita`);
    expect(otra.status).toBe(400);
    expect(otra.body.error).toMatch(/solo hay una/i);
  });

  it('(a3) "No, otro día" (o "mañana") pasa a una persona con "reprogramar"; "ya no lo quiero" cancela del todo', async () => {
    const renzo = rider('Renzo Salazar');
    await hastaLista(e, 'R-3005', '987300005', pinDe(5));
    await conMotorizado(e, 'R-3005', renzo.id, '30');
    await e.contesta(renzo.phone, { texto: 'no había nadie' });
    const alSupervisorAntes = e.textosA(SUPERVISOR).length;
    await e.contesta('987300005', { boton: { id: `entrega:no2:${(await e.entrega('R-3005'))!.id}`, title: 'No, otro día' } });
    const act = await e.entrega('R-3005');
    expect(act?.estado).toBe('incidencia');
    expect(act?.incidencia).toBe('reprogramar');
    expect(act?.requiereHumano).toBe(true);
    expect(e.textosA(SUPERVISOR).length).toBe(alSupervisorAntes + 1);
    const alCliente = e.textosA('987300005');
    expect(alCliente[alCliente.length - 1]).toMatch(/coordinar R-3005 otro día/i);
    await e.despacharAGsg();
    const conf = e.simulador.recibido.filter((x) => x.tipo === 'confirmacion' && x.cuerpo.referencia === 'R-3005').pop();
    expect(conf?.cuerpo).toMatchObject({ confirmada: false, motivo: 'reprogramar', como: 'boton' });
    // GSG NO lo cancela: lo coordina una persona.
    expect(e.simulador.pendientes().cancelados.map((c) => c.referencia)).not.toContain('R-3005');

    const kevin = rider('Kevin Aguilar');
    await hastaLista(e, 'R-3006', '987300006', pinDe(6));
    await conMotorizado(e, 'R-3006', kevin.id, '30');
    await e.contesta(kevin.phone, { texto: 'no estaba' });
    await e.contesta('987300006', { texto: 'ya no lo quiero, cancelen' });
    const cancelada = await e.entrega('R-3006');
    expect(cancelada?.estado).toBe('cancelada');
    const alCliente6 = e.textosA('987300006');
    expect(alCliente6[alCliente6.length - 1]).toMatch(/sin entregar por hoy/i);
  });

  it('(a3) sin respuesta del cliente en el plazo, pasa a una persona; la respuesta tardía ya no cuenta', async () => {
    const alvaro = rider('Álvaro Díaz');
    await hastaLista(e, 'R-3007', '987300007', pinDe(7));
    await conMotorizado(e, 'R-3007', alvaro.id, '30');
    await e.contesta(alvaro.phone, { texto: 'no atienden' });
    const alSupervisorAntes = e.textosA(SUPERVISOR).length;
    e.avanzar(31);
    await e.trabajar();
    const act = await e.entrega('R-3007');
    expect(act?.estado).toBe('incidencia');
    expect(act?.requiereHumano).toBe(true);
    expect(act?.incidenciaDetalle).toMatch(/no contestó si volvemos hoy/);
    expect(e.textosA(SUPERVISOR).length).toBe(alSupervisorAntes + 1);
    // El "sí" tardío no arranca nada: sigue para una persona.
    await e.contesta('987300007', { texto: 'sí' });
    expect((await e.entrega('R-3007'))?.estado).toBe('incidencia');
  });

  it('(a7) "estoy cerca": al cliente se le avisa una sola vez; con el ajuste apagado, no', async () => {
    const bruno = rider('Bruno Cárdenas');
    await hastaLista(e, 'R-3008', '987300008', pinDe(8));
    await conMotorizado(e, 'R-3008', bruno.id, '40');
    const antes = e.textosA('987300008').length;
    await e.contesta(bruno.phone, { texto: 'ya estoy cerca R-3008' });
    const alCliente = e.textosA('987300008');
    expect(alCliente).toHaveLength(antes + 1);
    expect(alCliente[alCliente.length - 1]).toMatch(/a unos minutos/i);
    expect(alCliente[alCliente.length - 1]).toContain('Bruno Cárdenas');
    let act = await e.entrega('R-3008');
    expect(act?.cercaAvisadoAt).not.toBeNull();
    expect(act?.estado).toBe('avisada');
    expect(act?.situacion).toMatch(/ya está cerca/);
    let alRider = e.textosA(bruno.phone);
    expect(alRider[alRider.length - 1]).toMatch(/le avisamos que estás por llegar/i);
    // Otra vez "llegando": no se le vuelve a escribir al cliente.
    await e.contesta(bruno.phone, { texto: 'llegando R-3008' });
    expect(e.textosA('987300008')).toHaveLength(antes + 1);
    alRider = e.textosA(bruno.phone);
    expect(alRider[alRider.length - 1]).toMatch(/Ya le avisé/);
    // Un "no estoy cerca todavía" no es cerca (ni un tiempo): se le pide el tiempo... no, con la avisada no hay tiempo que pedir.
    await e.contesta(bruno.phone, { texto: 'entregado' });
    act = await e.entrega('R-3008');
    expect(act?.estado).toBe('entregada');

    await e.entregas.guardarAjustes({ avisarCerca: false });
    const fabian = rider('Fabián Gutiérrez');
    await hastaLista(e, 'R-3009', '987300009', pinDe(9));
    await conMotorizado(e, 'R-3009', fabian.id, '40');
    const antes9 = e.textosA('987300009').length;
    await e.contesta(fabian.phone, { texto: 'estoy afuera R-3009' });
    expect(e.textosA('987300009')).toHaveLength(antes9);
    expect((await e.entrega('R-3009'))?.cercaAvisadoAt).toBeNull();
    await e.entregas.guardarAjustes({ avisarCerca: true });
  });

  it('(a10) "se me malogró la moto": pasa a descanso, todos sus pedidos van a otros, el cliente con hora se entera y el supervisor también', async () => {
    const hector = rider('Héctor Navarro');
    await hastaLista(e, 'R-3010', '987300010', pinDe(10));
    await conMotorizado(e, 'R-3010', hector.id, '30'); // con hora avisada
    await hastaLista(e, 'R-3011', '987300011', pinDe(11));
    await conMotorizado(e, 'R-3011', hector.id); // esperando su tiempo
    const antesCliente10 = e.textosA('987300010').length;
    const antesCliente11 = e.textosA('987300011').length;
    const alSupervisorAntes = e.textosA(SUPERVISOR).length;

    await e.contesta(hector.phone, { texto: 'se me malogró la moto, no puedo seguir' });
    const alRider = e.textosA(hector.phone);
    expect(alRider[alRider.length - 1]).toMatch(/te quitamos R-3010, R-3011/);
    const m = (await e.resumen()).motorizados.find((x) => x.id === hector.id)!;
    expect(m.estado).toBe('descanso');
    let r10 = await e.entrega('R-3010');
    let r11 = await e.entrega('R-3011');
    expect(r10?.estado).toBe('lista');
    expect(r11?.estado).toBe('lista');
    expect(r10?.motorizado).toBeNull();
    expect(r10?.llegaAproxAt).toBeNull();
    expect(r10?.motorizadosDescartados).toContain(hector.id);
    // El cliente que ya tenía hora se entera; el que no, no recibe nada.
    const alCliente10 = e.textosA('987300010');
    expect(alCliente10).toHaveLength(antesCliente10 + 1);
    expect(alCliente10[alCliente10.length - 1]).toMatch(/cambio de motorizado/i);
    expect(e.textosA('987300011')).toHaveLength(antesCliente11);
    const alSupervisor = e.textosA(SUPERVISOR);
    expect(alSupervisor).toHaveLength(alSupervisorAntes + 1);
    expect(alSupervisor[alSupervisor.length - 1]).toMatch(/Héctor Navarro .*no puede seguir/);
    expect(alSupervisor[alSupervisor.length - 1]).toMatch(/pasa a descanso/);

    // El motor los reparte entre los demás (nunca a Héctor).
    await e.trabajar();
    r10 = await e.entrega('R-3010');
    r11 = await e.entrega('R-3011');
    expect(r10?.estado).toBe('esperando_motorizado');
    expect(r11?.estado).toBe('esperando_motorizado');
    expect(r10?.motorizado?.id).not.toBe(hector.id);
    expect(r11?.motorizado?.id).not.toBe(hector.id);
  });

  it('(a10) "Traspasar sus pedidos" desde la pantalla, a uno concreto, sin mandarlo a descanso; y "no puedo" con un solo pedido sigue igual', async () => {
    const ivan = rider('Iván Ponce');
    const jonathan = rider('Jonathan Ríos');
    await hastaLista(e, 'R-3012', '987300012', pinDe(12));
    await conMotorizado(e, 'R-3012', ivan.id);
    const r = await e.api.post<{ ok: boolean; traspasadas: Array<{ referencia: string; estado: string; motorizadoId: number }>; destino: { id: number } | null; motorizado: { estado: string } }>(`/admin/motorizados/${ivan.id}/traspasar`, { motorizadoId: jonathan.id, descanso: false });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.traspasadas.map((x) => x.referencia)).toEqual(['R-3012']);
    expect(r.body.destino?.id).toBe(jonathan.id);
    expect(r.body.motorizado.estado).toBe('activo');
    const act = await e.entrega('R-3012');
    expect(act?.estado).toBe('esperando_motorizado');
    expect(act?.motorizado?.id).toBe(jonathan.id);
    const alIvan = e.textosA(ivan.phone);
    expect(alIvan[alIvan.length - 1]).toMatch(/te quitamos R-3012/);
    // A uno en descanso no se le puede pasar.
    const hector = rider('Héctor Navarro');
    const mal = await e.api.post<{ error: string }>(`/admin/motorizados/${jonathan.id}/traspasar`, { motorizadoId: hector.id });
    expect(mal.status).toBe(400);
    expect(mal.body.error).toMatch(/no está activo/);

    // "no puedo" a secas: solo ese pedido pasa a otro, y él sigue activo.
    await e.contesta(jonathan.phone, { texto: 'no puedo, estoy lejos' });
    expect((await e.entrega('R-3012'))?.estado).toBe('lista');
    expect((await e.resumen()).motorizados.find((x) => x.id === jonathan.id)?.estado).toBe('activo');
    // Se cancela para que no se lo lleve nadie en las pruebas que siguen.
    await e.api.post(`/admin/entregas/${(await e.entrega('R-3012'))!.id}/cancelar`, { motivo: 'fin de la prueba' });
  });

  it('(a8) GSG marca un pedido urgente: sale primero hacia el motorizado, con la marca en el mensaje; una persona lo marca o lo quita', async () => {
    // Dos pedidos listos a la vez: el urgente va primero aunque llegó después.
    await e.api.post('/admin/entregas/crear', { referencia: 'R-3013', telefono: '987300013', nombre: 'Cliente R-3013', distrito: 'Miraflores', faltaUbicacion: false, faltaConfirmacion: true, lat: pinDe(13).lat, lng: pinDe(13).lng });
    await e.api.post('/admin/entregas/crear', { referencia: 'R-3014', telefono: '987300014', nombre: 'Cliente R-3014', distrito: 'Miraflores', faltaUbicacion: false, faltaConfirmacion: true, lat: pinDe(14).lat, lng: pinDe(14).lng, urgente: true });
    await e.trabajar();
    await e.contesta('987300013', { texto: 'sí' });
    await e.contesta('987300014', { texto: 'sí' });
    expect((await e.entrega('R-3013'))?.estado).toBe('lista');
    expect((await e.entrega('R-3014'))?.estado).toBe('lista');
    expect((await e.entrega('R-3014'))?.prioridad).toBe('urgente');
    expect((await e.resumen()).cifras.urgente).toBe(1);
    const hecho = await e.trabajar();
    const enviados = hecho.filter((h) => h.accion === 'motorizado').map((h) => (h as { entregaId: number }).entregaId);
    const urgenteId = (await e.entrega('R-3014'))!.id;
    const normalId = (await e.entrega('R-3013'))!.id;
    expect(enviados.indexOf(urgenteId)).toBeLessThan(enviados.indexOf(normalId));
    const r14 = await e.entrega('R-3014');
    const textoRider = e.textosA(r14!.motorizado!.phone).filter((t) => t.includes('R-3014')).pop();
    expect(textoRider).toMatch(/URGENTE/);
    expect(e.textosA((await e.entrega('R-3013'))!.motorizado!.phone).filter((t) => t.includes('R-3013')).pop()).not.toMatch(/URGENTE/);

    // Una persona sube R-3013 a urgente: el motorizado que ya la lleva se entera.
    const antes = e.textosA((await e.entrega('R-3013'))!.motorizado!.phone).length;
    const marcada = await e.api.post<{ entrega: { prioridad: string } }>(`/admin/entregas/${normalId}/prioridad`, { urgente: true });
    expect(marcada.body.entrega.prioridad).toBe('urgente');
    const alRider = e.textosA((await e.entrega('R-3013'))!.motorizado!.phone);
    expect(alRider).toHaveLength(antes + 1);
    expect(alRider[alRider.length - 1]).toMatch(/ahora es URGENTE/);
    expect((await e.entrega('R-3013'))?.acciones).toContain('prioridad');
    const quitada = await e.api.post<{ entrega: { prioridad: string } }>(`/admin/entregas/${normalId}/prioridad`, { urgente: false });
    expect(quitada.body.entrega.prioridad).toBe('normal');

    // Lo que viene de GSG con urgente: true entra urgente.
    e.simulador.cargar([{ referencia: 'U-3015', telefono: '987300015', nombre: 'Urgente GSG', faltaUbicacion: false, faltaConfirmacion: true, lat: pinDe(15).lat, lng: pinDe(15).lng, urgente: true }]);
    await e.api.post('/admin/entregas/sincronizar');
    expect((await e.entrega('U-3015'))?.prioridad).toBe('urgente');
    expect(e.simulador.pendientes().faltaConfirmacion.find((c) => c.referencia === 'U-3015')?.urgente).toBe(true);
  });

  it('(a1) la ruta del motorizado: urgentes primero y después el vecino más próximo; se le manda y él la pide con "ruta"', async () => {
    // Un motorizado limpio, con tres paradas: dos normales y una urgente lejos.
    const nuevo = await e.api.post<{ motorizado: { id: number; phone: string } }>('/admin/motorizados', { telefono: '999000099', nombre: 'Walter Prueba', zona: 'Miraflores' });
    const w = nuevo.body.motorizado;
    const a = { lat: PIN_LIMA.lat + 0.01, lng: PIN_LIMA.lng };
    const b = { lat: PIN_LIMA.lat + 0.002, lng: PIN_LIMA.lng };
    const c = { lat: PIN_LIMA.lat + 0.02, lng: PIN_LIMA.lng };
    await hastaLista(e, 'R-3020', '987300020', a);
    await conMotorizado(e, 'R-3020', w.id);
    await hastaLista(e, 'R-3021', '987300021', b);
    await conMotorizado(e, 'R-3021', w.id, '30'); // su última posición pasa a ser B
    await hastaLista(e, 'R-3022', '987300022', c, { urgente: true });
    await conMotorizado(e, 'R-3022', w.id);

    const r = await e.api.get<{ ruta: { paradas: Array<{ orden: number; entrega: { referencia: string }; distancia: string | null; situacion: string }>; desde: unknown; totalKm: number; texto: string } }>(`/admin/motorizados/${w.id}/ruta`);
    expect(r.status).toBe(200);
    const ruta = r.body.ruta;
    expect(ruta.desde).not.toBeNull();
    expect(ruta.paradas.map((p) => p.entrega.referencia)).toEqual(['R-3022', 'R-3020', 'R-3021']);
    expect(ruta.paradas[0]!.distancia).toMatch(/km|m$/);
    expect(ruta.paradas.map((p) => p.situacion)).toEqual(['esperando_tiempo', 'esperando_tiempo', 'con_hora']);
    expect(ruta.totalKm).toBeGreaterThan(2);
    expect(ruta.texto).toMatch(/Tu ruta de hoy \(3 paradas\)/);
    expect(ruta.texto).toMatch(/1\) 🔴 URGENTE · R-3022/);
    expect(ruta.texto).toMatch(/3\) R-3021 .*llega \d\d:\d\d/);
    expect(ruta.texto).toContain('maps.google.com/?q=');

    const antes = e.textosA(w.phone).length;
    const mandada = await e.api.post(`/admin/motorizados/${w.id}/ruta/mandar`);
    expect(mandada.status).toBe(200);
    let al = e.textosA(w.phone);
    expect(al).toHaveLength(antes + 1);
    expect(al[al.length - 1]).toBe(ruta.texto);

    await e.contesta(w.phone, { texto: 'mi ruta' });
    al = e.textosA(w.phone);
    expect(al[al.length - 1]).toMatch(/Tu ruta de hoy/);
    // Un motorizado sin nada, al pedirla, lo sabe.
    const libre = (await e.api.post<{ motorizado: { id: number; phone: string } }>('/admin/motorizados', { telefono: '999000098', nombre: 'Zoe Prueba' })).body.motorizado;
    await e.contesta(libre.phone, { texto: 'ruta' });
    const alLibre = e.textosA(libre.phone);
    expect(alLibre[alLibre.length - 1]).toMatch(/no tienes ningún pedido en camino/i);
    // Sin paradas no se manda nada desde el panel.
    const sin = await e.api.post<{ error: string }>(`/admin/motorizados/${libre.id}/ruta/mandar`);
    expect(sin.status).toBe(400);
    expect(MOTORIZADOS_DE_PRUEBA.some((m) => conPais(m.telefono) === libre.phone)).toBe(false);
  });

  it('el aviso de llegada frenado por WhatsApp (o por el ritmo del número) se reintenta solo: no es una incidencia', async () => {
    const zoe = riders.find((x) => x.nombre === 'Carlos Rojas')!;
    await hastaLista(e, 'R-3030', '987300030', pinDe(30));
    await conMotorizado(e, 'R-3030', zoe.id);
    // WhatsApp devuelve un fallo pasajero justo cuando sale el aviso al cliente.
    e.wa.failNext = new WhatsAppApiError('rate limit', 429, 130429, 'Rate limit', true);
    await e.contesta(zoe.phone, { texto: 'R-3030 25' });
    let act = await e.entrega('R-3030');
    expect(act?.estado).toBe('esperando_motorizado');
    expect(act?.motorizadoEstado).toBe('respondio');
    expect(act?.avisoEnviadoAt).toBeNull();
    expect(act?.incidencia).toBeNull();
    expect(act?.motorizadoProximoAt).not.toBeNull();
    expect(act?.situacion).toMatch(/sale en cuanto el ritmo del número lo permita/);
    expect(e.textosA('987300030').some((t) => /en camino/.test(t))).toBe(false);
    // Pasado el plazo, el motor lo vuelve a intentar y ahora sí sale.
    e.avanzar(2);
    const hecho = await e.trabajar();
    expect(hecho.some((h) => h.accion === 'aviso')).toBe(true);
    act = await e.entrega('R-3030');
    expect(act?.estado).toBe('avisada');
    expect(act?.avisoEnviadoAt).not.toBeNull();
    const alCliente = e.textosA('987300030');
    expect(alCliente[alCliente.length - 1]).toMatch(/en camino/);
  });

  it('la pregunta de la segunda visita frenada por el ritmo del número se reintenta sola: no pasa a una persona', async () => {
    const carlos = riders.find((x) => x.nombre === 'Carlos Rojas')!;
    await hastaLista(e, 'R-3031', '987300031', pinDe(31));
    await conMotorizado(e, 'R-3031', carlos.id, '25');
    const alSupervisorAntes = e.textosA(SUPERVISOR).length;
    // WhatsApp devuelve un fallo pasajero justo cuando sale la pregunta al cliente.
    e.wa.failNext = new WhatsAppApiError('rate limit', 429, 130429, 'Rate limit', true);
    await e.contesta(carlos.phone, { texto: 'no estaba nadie R-3031' });
    let act = await e.entrega('R-3031');
    expect(act?.estado).toBe('incidencia');
    expect(act?.requiereHumano).toBe(false);
    expect(act?.segundaVisitaPedidaAt).not.toBeNull();
    expect(act?.motorizadoProximoAt).not.toBeNull();
    expect(act?.situacion).toMatch(/en cuanto el ritmo del número lo permita/);
    expect(e.textosA('987300031').some((t) => /volvemos|vuelvan/i.test(t))).toBe(false);
    expect(e.textosA(SUPERVISOR).length).toBe(alSupervisorAntes);
    // Pasado el plazo, la revisión del motor la vuelve a mandar y ahora sí sale.
    e.avanzar(2);
    await e.entregas.revisarSegundasVisitas();
    act = await e.entrega('R-3031');
    expect(act?.motorizadoProximoAt).toBeNull();
    expect(act?.situacion).toMatch(/se le preguntó al cliente si volvemos hoy/);
    const alCliente = e.textosA('987300031');
    expect(alCliente[alCliente.length - 1]).toMatch(/no encontró a nadie/);
    // Y el cliente puede contestar: vuelve al mismo motorizado.
    await e.contesta('987300031', { texto: 'sí, vuelvan' });
    act = await e.entrega('R-3031');
    expect(act?.segundaVisita).toBe(true);
    expect(act?.motorizadoId).toBe(carlos.id);
  });

  it('si la pregunta de la segunda visita no puede salir en todo el plazo, pasa a una persona', async () => {
    const carlos = riders.find((x) => x.nombre === 'Carlos Rojas')!;
    await hastaLista(e, 'R-3032', '987300032', pinDe(32));
    await conMotorizado(e, 'R-3032', carlos.id, '25');
    e.wa.failNext = new WhatsAppApiError('rate limit', 429, 130429, 'Rate limit', true);
    await e.contesta(carlos.phone, { texto: 'no abren R-3032' });
    expect((await e.entrega('R-3032'))?.motorizadoProximoAt).not.toBeNull();
    const alSupervisorAntes = e.textosA(SUPERVISOR).length;
    e.avanzar(31);
    await e.entregas.revisarSegundasVisitas();
    const act = await e.entrega('R-3032');
    expect(act?.requiereHumano).toBe(true);
    expect(act?.incidenciaDetalle).toMatch(/no pudo salir/);
    expect(e.textosA(SUPERVISOR).slice(alSupervisorAntes).some((t) => t.includes('R-3032') && /no pudo salir/.test(t))).toBe(true);
  });

  it('reasignar a un motorizado que no existe o que está en descanso se rechaza en palabras (antes dejaba el pedido roto)', async () => {
    await hastaLista(e, 'R-3040', '987300040', pinDe(40));
    const entrega = await e.entrega('R-3040');
    const noExiste = await e.api.post<{ error: string }>(`/admin/entregas/${entrega!.id}/reasignar`, { motorizadoId: 999 });
    expect(noExiste.status).toBe(400);
    expect(noExiste.body.error).toMatch(/no existe/);
    expect((await e.entrega('R-3040'))?.motorizadoId).toBeNull();
    const enDescanso = riders.find((x) => x.nombre === 'Iván Ponce')!;
    await e.api.post(`/admin/motorizados/${enDescanso.id}`, { estado: 'descanso' });
    const dormido = await e.api.post<{ error: string }>(`/admin/entregas/${entrega!.id}/reasignar`, { motorizadoId: enDescanso.id });
    expect(dormido.status).toBe(400);
    expect(dormido.body.error).toMatch(/descanso/);
    await e.api.post(`/admin/motorizados/${enDescanso.id}`, { estado: 'activo' });
    expect((await e.entrega('R-3040'))?.estado).not.toBe('incidencia');
  });

  it('un pedido a mano sin referencia recibe una sola (M-HHMM-N) y no choca con las de hoy', async () => {
    const uno = await e.api.post<{ ok: boolean; entrega: { referencia: string } }>('/admin/entregas/crear', { telefono: '987300041', nombre: 'Sin Referencia', direccion: 'Av. Prueba 1' });
    expect(uno.status, JSON.stringify(uno.body)).toBe(200);
    expect(uno.body.entrega.referencia).toMatch(/^M-\d{4}-1$/);
    const dos = await e.api.post<{ ok: boolean; entrega: { referencia: string } }>('/admin/entregas/crear', { telefono: '987300042', nombre: 'Otro Sin Referencia' });
    expect(dos.status).toBe(200);
    expect(dos.body.entrega.referencia).toMatch(/^M-\d{4}-2$/);
    expect(dos.body.entrega.referencia).not.toBe(uno.body.entrega.referencia);
  });

  it('alta de motorizados en lote desde un texto pegado: con cabecera, sin cabecera, repetidos y descartados', async () => {
    const antes = (await e.resumen()).motorizados.length;
    const r = await e.api.post<{ creados: Array<{ nombre: string; phone: string; placa: string | null; zona: string | null }>; repetidos: unknown[]; descartados: Array<{ linea: number; motivo: string }>; detalle: string }>('/admin/motorizados/lote', {
      texto: [
        'Nombre; WhatsApp; Placa; Zona',
        'Tomás Lote; 999 300 001; ABC-123; Surco, Miraflores',
        'Sin Placa; 999300002; ; Lince',
        'Sin Teléfono; ; XYZ-999; Breña',
        'Tomás Lote; 999300001; ABC-123; Surco',
      ].join('\n'),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.creados.map((m) => m.nombre)).toEqual(['Tomás Lote', 'Sin Placa']);
    expect(r.body.creados[0]).toMatchObject({ phone: '51999300001', placa: 'ABC-123', zona: 'Surco, Miraflores' });
    expect(r.body.repetidos).toHaveLength(1);
    expect(r.body.descartados).toHaveLength(1);
    expect(r.body.descartados[0]!.motivo).toMatch(/WhatsApp/);
    expect(r.body.detalle).toMatch(/2 dados de alta, 1 ya estaba, 1 descartado/);
    // Sin cabecera y en cualquier orden: el teléfono y la placa se reconocen solos.
    const r2 = await e.api.post<{ creados: Array<{ nombre: string; placa: string | null; zona: string | null }>; descartados: unknown[] }>('/admin/motorizados/lote', { texto: 'M5E-777, Pedro Sin Orden, 999300003, San Borja\nsolo un nombre sin número' });
    expect(r2.status).toBe(200);
    expect(r2.body.creados).toHaveLength(1);
    expect(r2.body.creados[0]).toMatchObject({ nombre: 'Pedro Sin Orden', placa: 'M5E-777', zona: 'San Borja' });
    expect(r2.body.descartados).toHaveLength(1);
    expect((await e.resumen()).motorizados.length).toBe(antes + 3);
    const vacio = await e.api.post<{ error: string }>('/admin/motorizados/lote', { texto: '   ' });
    expect(vacio.status).toBe(400);
    expect(vacio.body.error).toMatch(/Pega la lista/);
  });

  it('la vista previa de los textos nuevos rellena {paradas}, {pedidos} y {urgente}', async () => {
    const ruta = await e.api.post<{ texto: string }>('/admin/entregas/previsualizar', { clave: 'motorizadoRuta', texto: '' });
    expect(ruta.body.texto).toMatch(/\(3 paradas\)/);
    const traspaso = await e.api.post<{ texto: string }>('/admin/entregas/previsualizar', { clave: 'motorizadoTraspaso', texto: '' });
    expect(traspaso.body.texto).toMatch(/te quitamos P-1001, P-1004, P-1009/);
    const segunda = await e.api.post<{ texto: string }>('/admin/entregas/previsualizar', { clave: 'motorizadoSegundaVisita', texto: '' });
    expect(segunda.body.texto).toMatch(/Segunda visita:/);
    expect(segunda.body.texto).not.toContain('{');
  });
});
