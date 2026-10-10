import { describe, it, expect, vi } from 'vitest';
import { leerSeguimiento, crearCalculadorGoogle, horarioGsgSchema, crearConsultaSeguimiento } from '../src/entregas/seguimiento-gsg.js';
import { crearPuertoHttp } from '../src/rutas/gsg.js';
import { datosEnvioDeCrudo, fusionarDatosEnvio } from '../src/entregas/datos-envio.js';
import { crearEscenarioEntregas } from './escenario-entregas.js';
import { ubicacionYaRegistrada } from '../src/entregas/ubicacion-unica.js';
const ahora = new Date('2026-10-07T17:00:00Z');
const posicion = { lat: -12.12, lng: -77.03, actualizadaAt: ahora.toISOString() };

describe('cierre de pendientes', () => {
  it('PATCH con horario null borra la ventana y cambiarla elimina las fechas antiguas', () => {
    const anterior = datosEnvioDeCrudo({horarioEntrega:{desde:'22:00',hasta:'02:00',fechaDesde:'2026-10-07',fechaHasta:'2026-10-08',zonaHoraria:'America/Lima'}})!;
    expect(fusionarDatosEnvio(anterior,datosEnvioDeCrudo({horarioEntrega:null}))).toEqual({});
    const normal=fusionarDatosEnvio(anterior,datosEnvioDeCrudo({horarioEntrega:{desde:'15:00',hasta:'17:00'}}));
    expect(normal?.horarioEntregaFechaDesde).toBeUndefined();
    expect(normal?.horarioEntregaHasta).toBe('17:00');
  });
  it('confirmar un pedido no cierra la solicitud ni reutiliza el pin del otro pedido', async () => {
    const e=await crearEscenarioEntregas();
    try {
      const c=await e.repos.contacts.upsertFromInbound('51987777555','Rosa');
      for(const referencia of ['A-1','B-2']) await e.entregas.crearAMano({referencia,telefono:c.phone,faltaUbicacion:true,faltaConfirmacion:false},'prueba');
      const lote=await e.repos.rutas.crearLote({nombre:'Aislamiento'});
      const solicitudes=await e.repos.rutas.agregarSolicitudes(lote.id,['A-1','B-2'].map(referencia=>({telefonoCrudo:c.phone,phone:c.phone,referencia,estado:'enviado'})));
      expect((await e.entregas.alUbicacion(c,{lat:-12.12,lng:-77.03,fuente:'whatsapp'})).resultado).toBe('seleccionar_pedido');
      await e.entregas.responderPinLejos(c.phone,'si','sí A-1','reglas');
      expect((await e.repos.rutas.solicitud(solicitudes[0]!.id))?.estado).toBe('resuelto');
      expect((await e.repos.rutas.solicitud(solicitudes[1]!.id))?.estado).toBe('enviado');
      expect(await ubicacionYaRegistrada(e.repos,c.phone,(await e.entrega('B-2'))!.dia,'B-2')).toBeNull();
    } finally {await e.cerrar();}
  });
  it('calcula todos los tramos sin truncar y usa salida futura en el segundo tramo', async () => {
    const paradas = Array.from({length:30}, (_,i) => ({orden:i+1,lat:-12.12-i/1000,lng:-77.03,servicioMinutos:2}));
    const pedir=vi.fn(async () => new Response(JSON.stringify({routes:[{distanceMeters:10000,duration:'600s'}]}))) as unknown as typeof fetch;
    const r = await leerSeguimiento({tracking:'LARGA',posicion,puntoActual:0,puntoCliente:30,paradas}, 'LARGA', crearCalculadorGoogle('key',pedir,()=>ahora), ahora);
    expect(r?.distancia).toEqual({km:20,minutos:78});
    const cuerpos=vi.mocked(pedir).mock.calls.map(c=>JSON.parse(String(c[1]?.body)));
    expect(cuerpos).toHaveLength(2);
    expect(cuerpos[0].intermediates).toHaveLength(25);
    expect(cuerpos[1].origin.location.latLng.latitude).toBe(paradas[25]!.lat);
    expect(cuerpos[1].destination.location.latLng.latitude).toBe(paradas[29]!.lat);
    expect(cuerpos[1].departureTime).toBe('2026-10-07T18:02:00.000Z');
  });
  it('acepta índices no consecutivos solo cuando GSG declara la secuencia completa', async () => {
    const ruta={tracking:'GAPS',posicion,puntoActual:2,puntoCliente:10,paradas:[{orden:5,lat:-12.1,lng:-77.1},{orden:10,lat:-12.2,lng:-77.2}]};
    expect(await leerSeguimiento(ruta,'GAPS',undefined,ahora)).toBeNull();
    expect(await leerSeguimiento({...ruta,secuenciaCompleta:true,versionRuta:'v2'},'GAPS',undefined,ahora)).not.toBeNull();
  });
  it('conserva un horario nocturno con fechas y zona y rechaza fechas imposibles', () => {
    const h={desde:'22:00',hasta:'02:00',fechaDesde:'2026-10-07',fechaHasta:'2026-10-08',zonaHoraria:'America/Lima'};
    expect(horarioGsgSchema.safeParse(h).success).toBe(true);
    expect(datosEnvioDeCrudo({horarioEntrega:h})).toMatchObject({horarioEntregaFechaHasta:'2026-10-08',horarioEntregaZonaHoraria:'America/Lima'});
    expect(horarioGsgSchema.safeParse({...h,fechaHasta:'2026-02-30'}).success).toBe(false);
    expect(horarioGsgSchema.safeParse({...h,zonaHoraria:'inventada'}).success).toBe(false);
  });
  it('distingue seguimiento ausente, contrato y GPS en el diagnóstico (sin llamar a GSG)', async () => {
    for (const [datos,codigo] of [[undefined,'sin_tracking'],[{},'contrato'],[{tracking:'P',posicion:{...posicion,actualizadaAt:'2026-10-06T17:00:00Z'},puntoActual:0,puntoCliente:1,paradas:[]},'gps_antiguo']] as const) {
      const c=crearConsultaSeguimiento(()=>datos,undefined,()=>ahora);
      await c.consultar('P');
      expect(c.estado().pedidos[0]?.fallo?.codigo).toBe(codigo);
    }
  });
  it('no reintenta un POST incierto sin idempotencia y conserva la clave cuando está habilitada', async () => {
    const pedir=vi.fn(async()=>{throw new TypeError('red');}) as unknown as typeof fetch;
    const opts={url:'https://gsg.example',token:'key',fetchImpl:pedir};
    expect(await crearPuertoHttp(opts).enviar('ubicacion',{tracking:'P',lat:-12,lng:-77})).toMatchObject({ok:false,reintentable:false});
    const p=crearPuertoHttp({...opts,idempotenciaUbicacion:true});
    for(let i=0;i<2;i++) expect(await p.enviar('ubicacion',{tracking:'P',lat:-12,lng:-77,idempotencyKey:'estable'})).toMatchObject({reintentable:true});
    const headers=vi.mocked(pedir).mock.calls.slice(1).map(c=>new Headers(c[1]?.headers).get('Idempotency-Key'));
    expect(headers).toEqual(['estable','estable']);
  });
  it('una cita antigua no confirma otra propuesta y una cita vigente sí', async () => {
    const e=await crearEscenarioEntregas();
    try {
      const c=await e.repos.contacts.upsertFromInbound('51987777666','Rosa');
      await e.entregas.crearAMano({referencia:'CITA',telefono:c.phone,faltaUbicacion:true,faltaConfirmacion:false},'prueba');
      await e.entregas.revisarPin(c,{lat:-12.12,lng:-77.03,fuente:'enlace de mapa'});
      await e.entregas.vincularPropuesta((await e.entrega('CITA'))!,'viejo');
      e.avanzarSegundos(1);
      await e.entregas.revisarPin(c,{lat:-12.13,lng:-77.04,fuente:'enlace de mapa'});
      await e.entregas.vincularPropuesta((await e.entrega('CITA'))!,'vigente');
      expect((await e.entregas.responderPinLejos(c.phone,'si','sí','reglas',undefined,'viejo'))?.tipo).toBe('repregunta');
      expect((await e.entregas.responderPinLejos(c.phone,'si','sí','reglas'))?.tipo).toBe('repregunta');
      await e.entregas.responderPinLejos(c.phone,'si','sí','reglas',undefined,'vigente');
      expect((await e.entrega('CITA'))?.lat).toBe(-12.13);
      expect(await e.repos.rutas.reportesRecientes(50,'ubicacion')).toHaveLength(1);
    } finally {await e.cerrar();}
  });
});
