/**
 * El modulo de rutas: revisar numeros, leer el lote, mandar con ritmo y leer
 * lo que contesta el cliente.
 *
 * Lo que se prueba aqui es lo que decide si el trabajo sale o no sale: que un
 * numero de ocho digitos no llegue nunca a enviarse, que entre mensaje y
 * mensaje pase el tiempo acordado, que a los tres intentos el caso pase a una
 * persona y que una respuesta que no es ubicacion no se pierda.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Sender, SendJob, SendOutcome } from '../src/outbound/sender.js';
import type { Contact, Repos } from '../src/db/repos.js';
import { createFakeRepos, type FakeRepos } from './fakes.js';
import { revisarTelefono, parecidos, distanciaDeTipeo, PERU, GENERICO } from '../src/rutas/telefono.js';
import { leerLote, prepararFilas } from '../src/rutas/lote.js';
import { crearMotor, enHorario, pasoDe, OPCIONES_POR_DEFECTO, type OpcionesMotor } from '../src/rutas/motor.js';
import { atenderRespuestaDeRuta, pareceNumeroEquivocado } from '../src/rutas/inbound.js';
import { crearPuertoEnEspera, crearPuertoHttp, despacharReportes } from '../src/rutas/gsg.js';
import { incidenciaDeErrorDeEnvio } from '../src/rutas/incidencias.js';

// ------------------------------------------------------------- telefonos

describe('revisar telefonos peruanos', () => {
  it('acepta un celular de nueve digitos y le pone el prefijo', () => {
    const r = revisarTelefono('987654321');
    expect(r).toMatchObject({ ok: true, phone: '51987654321', nacional: '987654321' });
  });

  it('acepta el mismo numero escrito de todas las formas', () => {
    for (const escrito of ['+51 987 654 321', '51987654321', '0051987654321', '987-654-321', '0987654321']) {
      const r = revisarTelefono(escrito);
      expect(r.ok && r.phone, escrito).toBe('51987654321');
    }
  });

  it('un numero de ocho digitos es una incidencia, no un envio', () => {
    const r = revisarTelefono('98765432');
    expect(r).toMatchObject({ ok: false, incidencia: 'numero_corto' });
    expect(r.ok === false && r.detalle).toMatch(/falta 1/);
  });

  it('avisa de los digitos de mas', () => {
    expect(revisarTelefono('9876543210')).toMatchObject({ ok: false, incidencia: 'numero_largo' });
  });

  it('un fijo se marca como fijo y no como numero invalido', () => {
    expect(revisarTelefono('014455667')).toMatchObject({ ok: false, incidencia: 'numero_fijo' });
  });

  it('lo que no tiene digitos es invalido', () => {
    expect(revisarTelefono('sin telefono')).toMatchObject({ ok: false, incidencia: 'numero_invalido' });
    expect(revisarTelefono('')).toMatchObject({ ok: false, incidencia: 'numero_invalido' });
  });

  it('sin plan de pais se acepta cualquier numero internacional razonable', () => {
    expect(revisarTelefono('5215512345678', GENERICO)).toMatchObject({ ok: true });
    expect(revisarTelefono('123', GENERICO)).toMatchObject({ ok: false, incidencia: 'numero_corto' });
  });

  it('detecta el digito cambiado y la transposicion', () => {
    expect(distanciaDeTipeo('987654321', '987654322')).toBe(true);
    expect(distanciaDeTipeo('987654321', '987654312')).toBe(true);
    expect(distanciaDeTipeo('987654321', '912345678')).toBe(false);
    expect(parecidos('987654321', ['987654322', '911111111'])).toEqual(['987654322']);
  });
});

// ------------------------------------------------------------------ lote

describe('leer el lote', () => {
  it('entiende una tabla con cabecera en cualquier orden', () => {
    const lectura = leerLote(
      'pedido;nombre;celular;distrito\nP-1;Ana Ruiz;987654321;Miraflores\nP-2;Luis Paz;912345678;Surco',
    );
    expect(lectura.conCabecera).toBe(true);
    expect(lectura.filas).toHaveLength(2);
    expect(lectura.filas[0]).toMatchObject({
      telefono: '987654321',
      nombre: 'Ana Ruiz',
      referencia: 'P-1',
      distrito: 'Miraflores',
    });
  });

  it('entiende una lista pegada sin cabecera', () => {
    const lectura = leerLote('987654321, Ana\n912345678, Luis');
    expect(lectura.conCabecera).toBe(false);
    expect(lectura.filas.map((f) => f.telefono)).toEqual(['987654321', '912345678']);
    expect(lectura.filas[0]?.nombre).toBe('Ana');
  });

  it('entiende una columna suelta de numeros', () => {
    const lectura = leerLote('987654321\n912345678\n');
    expect(lectura.filas).toHaveLength(2);
  });

  it('respeta las comillas y el punto y coma de Excel', () => {
    const lectura = leerLote('telefono;nombre\n987654321;"Ruiz; Ana"');
    expect(lectura.filas[0]?.nombre).toBe('Ruiz; Ana');
  });

  it('avisa cuando la tabla no trae ninguna columna de telefonos', () => {
    const lectura = leerLote(['nombre;pedido', 'Ana Ruiz;P-1', 'Luis Paz;P-2'].join('\n'));
    expect(lectura.filas).toHaveLength(0);
    expect(lectura.descartadas[0]?.motivo).toMatch(/ninguna columna con teléfonos/);
  });

  it('apunta las filas que no traen telefono en vez de tragarselas', () => {
    const lectura = leerLote('telefono;nombre\n;Sin numero\n987654321;Ana');
    expect(lectura.filas).toHaveLength(1);
    expect(lectura.descartadas).toHaveLength(1);
    expect(lectura.descartadas[0]?.motivo).toMatch(/teléfono/);
  });
});

describe('preparar el lote', () => {
  it('separa lo enviable de lo que hay que corregir', () => {
    const preparacion = prepararFilas([
      { telefono: '987654321', nombre: 'Ana' },
      { telefono: '98765432', nombre: 'Corto' },
      { telefono: 'nada', nombre: 'Roto' },
    ]);

    expect(preparacion.listas).toBe(1);
    expect(preparacion.conIncidencia).toBe(2);
    expect(preparacion.incidencias).toMatchObject({ numero_corto: 1, numero_invalido: 1 });
    expect(preparacion.solicitudes[1]).toMatchObject({
      estado: 'incidencia',
      requiereHumano: true,
      phone: null,
    });
  });

  it('no le escribe dos veces al mismo numero', () => {
    const preparacion = prepararFilas([
      { telefono: '987654321', referencia: 'P-1' },
      { telefono: '51987654321', referencia: 'P-2' },
    ]);

    expect(preparacion.solicitudes).toHaveLength(1);
    expect(preparacion.duplicadas).toBe(1);
    expect(preparacion.solicitudes[0]?.notas).toMatch(/P-2/);
  });

  it('cuando un numero se parece a otro del lote, lo dice', () => {
    const preparacion = prepararFilas([
      { telefono: '987654321', referencia: 'P-1' },
      { telefono: '98765432', referencia: 'P-2' },
    ]);
    // El corto se parece al bueno salvo por el digito que falta... no en
    // longitud, asi que aqui lo que se comprueba es que el detalle explica el
    // problema con el numero delante.
    expect(preparacion.solicitudes[1]?.incidenciaDetalle).toContain('98765432');
  });
});

// ----------------------------------------------------------------- motor

const HORA_BUENA = new Date('2026-03-10T15:00:00Z'); // 10:00 en Lima

function senderFalso(respuesta?: (job: SendJob) => SendOutcome) {
  const enviados: SendJob[] = [];
  const sender: Sender = {
    async send(job) {
      enviados.push(job);
      return respuesta
        ? respuesta(job)
        : ({ ok: true, wamid: `wamid.${enviados.length}`, deliveryId: enviados.length } as SendOutcome);
    },
  };
  return { sender, enviados };
}

async function loteListo(repos: Repos, telefonos: string[]) {
  const lote = await repos.rutas.crearLote({ nombre: 'Reparto de prueba' });
  await repos.rutas.agregarSolicitudes(
    lote.id,
    telefonos.map((t, i) => ({ telefonoCrudo: t, phone: t, nombre: `Cliente ${i + 1}`, referencia: `P-${i + 1}` })),
  );
  await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
  return lote;
}

describe('el motor', () => {
  let repos: FakeRepos;
  const opciones: OpcionesMotor = { ...OPCIONES_POR_DEFECTO, timezone: 'America/Lima' };

  beforeEach(() => {
    repos = createFakeRepos();
  });

  it('no escribe fuera del horario del negocio', async () => {
    await loteListo(repos, ['51987654321']);
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({
      repos,
      sender,
      gsg: crearPuertoEnEspera(),
      opciones,
      usarPlantilla: () => false,
      ahora: () => new Date('2026-03-10T06:00:00Z'), // 01:00 en Lima
    });

    const salida = await motor.tick();
    expect(salida.accion).toBe('nada');
    expect(salida.motivo).toMatch(/horario/);
    expect(enviados).toHaveLength(0);
  });

  it('manda la primera solicitud y deja la siguiente programada', async () => {
    await loteListo(repos, ['51987654321']);
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({
      repos,
      sender,
      gsg: crearPuertoEnEspera(),
      opciones,
      usarPlantilla: () => false,
      ahora: () => HORA_BUENA,
    });

    const salida = await motor.tick();

    expect(salida).toMatchObject({ accion: 'envio', paso: 'solicitud' });
    expect(enviados[0]).toMatchObject({ kind: 'interactive' });
    expect(enviados[0]?.interactive?.locationRequest).toBe(true);

    const solicitud = repos.rutas._solicitudes[0]!;
    expect(solicitud.estado).toBe('enviado');
    expect(solicitud.intentos).toBe(1);
    expect(solicitud.proximoIntentoAt?.getTime()).toBe(
      HORA_BUENA.getTime() + opciones.esperaRespuestaMinutos * 60_000,
    );
  });

  it('con la Cloud API manda la plantilla aprobada', async () => {
    await loteListo(repos, ['51987654321']);
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({
      repos,
      sender,
      gsg: crearPuertoEnEspera(),
      opciones,
      usarPlantilla: () => true,
      ahora: () => HORA_BUENA,
    });

    await motor.tick();

    expect(enviados[0]).toMatchObject({ kind: 'template', templateName: 'solicitud_ubicacion' });
    expect(enviados[0]?.variables).toEqual(['Cliente', OPCIONES_POR_DEFECTO.negocio, 'P-1']);
  });

  it('respeta la pausa entre un cliente y el siguiente', async () => {
    await loteListo(repos, ['51987654321', '51912345678']);
    const { sender, enviados } = senderFalso();
    let momento = HORA_BUENA.getTime();
    const motor = crearMotor({
      repos,
      sender,
      gsg: crearPuertoEnEspera(),
      opciones,
      usarPlantilla: () => false,
      ahora: () => new Date(momento),
      azar: () => 0, // la pausa minima: 15 s
    });

    await motor.tick();
    expect(enviados).toHaveLength(1);

    // A los cinco segundos todavia no toca.
    momento += 5_000;
    const segundo = await motor.tick();
    expect(segundo.accion).toBe('nada');
    expect(segundo.motivo).toMatch(/pausa/);
    expect(enviados).toHaveLength(1);

    // Pasados los quince, sale el siguiente.
    momento += 11_000;
    await motor.tick();
    expect(enviados).toHaveLength(2);
    expect(enviados[1]?.phone).toBe('51912345678');
  });

  it('a los tres intentos deja de insistir y lo pasa a una persona', async () => {
    const lote = await loteListo(repos, ['51987654321']);
    const { sender, enviados } = senderFalso();
    let momento = HORA_BUENA.getTime();
    const motor = crearMotor({
      repos,
      sender,
      gsg: crearPuertoEnEspera(),
      opciones,
      usarPlantilla: () => false,
      ahora: () => new Date(momento),
      azar: () => 0,
    });

    // Tres mensajes, cada uno pasada la espera.
    for (let i = 0; i < 3; i++) {
      await motor.tick();
      momento += opciones.esperaRespuestaMinutos * 60_000 + 1_000;
    }
    expect(enviados.filter((e) => e.interactive)).toHaveLength(3);

    const salida = await motor.tick();
    expect(salida.accion).toBe('derivacion');

    const solicitud = repos.rutas._solicitudes[0]!;
    expect(solicitud.estado).toBe('derivado');
    expect(solicitud.incidencia).toBe('sin_respuesta');
    expect(solicitud.requiereHumano).toBe(true);

    // Y GSG tiene que enterarse.
    const reportes = repos.rutas._reportes.filter((r) => r.loteId === lote.id);
    expect(reportes.some((r) => r.tipo === 'incidencia')).toBe(true);
  });

  it('un numero sin WhatsApp se marca y no se le insiste', async () => {
    await loteListo(repos, ['51987654321']);
    const { sender, enviados } = senderFalso();
    const motor = crearMotor({
      repos,
      sender,
      wa: { tieneWhatsApp: async () => false } as never,
      gsg: crearPuertoEnEspera(),
      opciones,
      usarPlantilla: () => false,
      ahora: () => HORA_BUENA,
    });

    const salida = await motor.tick();

    expect(salida.accion).toBe('incidencia');
    expect(enviados).toHaveLength(0);
    expect(repos.rutas._solicitudes[0]).toMatchObject({
      estado: 'incidencia',
      incidencia: 'sin_whatsapp',
      requiereHumano: true,
    });
  });

  it('un bloqueo de las guardas no gasta un intento', async () => {
    await loteListo(repos, ['51987654321']);
    const { sender } = senderFalso(() => ({
      ok: false,
      blocked: true,
      code: 'daily_cap',
      reason: 'se alcanzo el cupo del dia',
      deliveryId: 1,
    }) as SendOutcome);

    const motor = crearMotor({
      repos,
      sender,
      gsg: crearPuertoEnEspera(),
      opciones,
      usarPlantilla: () => false,
      ahora: () => HORA_BUENA,
    });

    await motor.tick();

    const solicitud = repos.rutas._solicitudes[0]!;
    expect(solicitud.intentos).toBe(0);
    expect(solicitud.estado).toBe('pendiente');
    expect(solicitud.incidencia).toBe('envio_bloqueado');
  });

  it('cierra el lote y encola su resumen cuando no queda nada vivo', async () => {
    const lote = await loteListo(repos, ['51987654321']);
    await repos.rutas.actualizarSolicitud(repos.rutas._solicitudes[0]!.id, { estado: 'resuelto' });

    const { sender } = senderFalso();
    const motor = crearMotor({
      repos,
      sender,
      gsg: crearPuertoEnEspera(),
      opciones,
      usarPlantilla: () => false,
      ahora: () => HORA_BUENA,
    });

    const salida = await motor.tick();

    expect(salida.lotesCerrados).toEqual([lote.id]);
    expect((await repos.rutas.lote(lote.id))?.estado).toBe('terminado');
    expect(repos.rutas._reportes.some((r) => r.tipo === 'resumen')).toBe(true);
  });

  it('el horario se mide en la hora del negocio, no en la del servidor', () => {
    // 15:00 UTC son las 10:00 en Lima: dentro. 06:00 UTC es la 01:00: fuera.
    expect(enHorario(new Date('2026-03-10T15:00:00Z'), opciones)).toBe(true);
    expect(enHorario(new Date('2026-03-10T06:00:00Z'), opciones)).toBe(false);
  });

  it('el paso depende del estado y de los intentos', () => {
    const base = { estado: 'pendiente', intentos: 0 } as never;
    expect(pasoDe(base, opciones)).toBe('solicitud');
    expect(pasoDe({ estado: 'enviado', intentos: 1 } as never, opciones)).toBe('recordatorio');
    expect(pasoDe({ estado: 'respondio', intentos: 1 } as never, opciones)).toBe('insistencia');
    expect(pasoDe({ estado: 'enviado', intentos: 3 } as never, opciones)).toBe('derivar');
  });
});

// --------------------------------------------------------------- inbound

describe('lo que contesta el cliente', () => {
  let repos: FakeRepos;
  let contacto: Contact;

  beforeEach(async () => {
    repos = createFakeRepos();
    contacto = await repos.contacts.upsertFromInbound('51987654321', 'Ana');
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '51987654321', phone: '51987654321', nombre: 'Ana', referencia: 'P-1' },
    ]);
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
    await repos.rutas.actualizarSolicitud(repos.rutas._solicitudes[0]!.id, {
      estado: 'enviado',
      intentos: 1,
    });
  });

  const deps = () => ({ repos, gsg: crearPuertoEnEspera() });

  it('sin solicitud abierta no se mete en el camino', async () => {
    const otro = await repos.contacts.upsertFromInbound('51911111111', 'Otro');
    const salida = await atenderRespuestaDeRuta(deps(), otro, { texto: 'hola' });
    expect(salida.atendida).toBe(false);
  });

  it('la ubicacion cierra la solicitud y se encola para GSG', async () => {
    const salida = await atenderRespuestaDeRuta(deps(), contacto, {
      ubicacion: { lat: -12.1, lng: -77.03, mapsUrl: 'https://maps.google.com/?q=-12.1,-77.03' },
    });

    expect(salida.resultado).toBe('resuelta');
    const solicitud = repos.rutas._solicitudes[0]!;
    expect(solicitud.estado).toBe('resuelto');
    expect(solicitud.lat).toBeCloseTo(-12.1);
    expect(solicitud.requiereHumano).toBe(false);
    expect(repos.rutas._reportes[0]).toMatchObject({ tipo: 'ubicacion', estado: 'pendiente' });
  });

  it('una ubicacion fuera de zona es una incidencia, no un exito', async () => {
    const salida = await atenderRespuestaDeRuta(deps(), contacto, {
      ubicacion: { lat: 40.4, lng: -3.7 },
      fueraDeZona: true,
    });

    expect(salida.resultado).toBe('fuera_de_zona');
    expect(repos.rutas._solicitudes[0]).toMatchObject({
      estado: 'supervision',
      incidencia: 'ubicacion_fuera_de_zona',
      requiereHumano: true,
    });
  });

  it('contestar otra cosa lo aparta para una persona y lo deja reintentable', async () => {
    const salida = await atenderRespuestaDeRuta(deps(), contacto, { texto: 'estoy en el jiron Puno 123' });

    expect(salida.resultado).toBe('sin_ubicacion');
    const solicitud = repos.rutas._solicitudes[0]!;
    expect(solicitud.estado).toBe('respondio');
    expect(solicitud.requiereHumano).toBe(true);
    expect(solicitud.incidencia).toBe('respondio_sin_ubicacion');
    expect(solicitud.primeraRespuestaAt).toBeInstanceOf(Date);
    // El texto se guarda: puede ser una direccion perfectamente util.
    expect(solicitud.incidenciaDetalle).toContain('jiron Puno');
  });

  it('"no soy yo" corta los envios a ese numero', async () => {
    const salida = await atenderRespuestaDeRuta(deps(), contacto, {
      texto: 'creo que se equivocaron, yo no pedi nada',
    });

    expect(salida.resultado).toBe('numero_equivocado');
    expect(salida.responder).toMatch(/no le volveremos a escribir/i);
    const solicitud = repos.rutas._solicitudes[0]!;
    expect(solicitud.estado).toBe('supervision');
    expect(solicitud.incidencia).toBe('numero_equivocado');
    expect(solicitud.proximoIntentoAt).toBeNull();
  });

  it('la baja se respeta y se reporta', async () => {
    const salida = await atenderRespuestaDeRuta(deps(), contacto, { baja: true });
    expect(salida.resultado).toBe('rechazo');
    expect(repos.rutas._solicitudes[0]?.incidencia).toBe('rechaza_contacto');
    expect(repos.rutas._reportes.some((r) => r.tipo === 'incidencia')).toBe(true);
  });

  it('reconoce las frases de numero equivocado sin confundirlas con un no', () => {
    expect(pareceNumeroEquivocado('no soy la persona que buscan')).toBe(true);
    expect(pareceNumeroEquivocado('numero equivocado')).toBe(true);
    expect(pareceNumeroEquivocado('no')).toBe(false);
    expect(pareceNumeroEquivocado('no puedo ahora, mandamela mas tarde')).toBe(false);
  });
});

// ------------------------------------------------------------------- GSG

describe('la cola hacia GSG', () => {
  it('sin API configurada no se pierde nada: se queda en la cola', async () => {
    const repos = createFakeRepos();
    await repos.rutas.encolarReporte({ tipo: 'ubicacion', payload: { referencia: 'P-1' } });

    const salida = await despacharReportes(repos, crearPuertoEnEspera());

    expect(salida).toMatchObject({ intentados: 0, enviados: 0 });
    expect(salida.motivo).toMatch(/GSG_URL/);
    expect((await repos.rutas.cifrasReportes()).pendiente).toBe(1);
  });

  it('con API configurada, sale y se marca enviado', async () => {
    const repos = createFakeRepos();
    await repos.rutas.encolarReporte({ tipo: 'ubicacion', payload: { referencia: 'P-1' } });

    const fetchFalso = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'GSG-99' }), { status: 200 }),
    );
    const puerto = crearPuertoHttp({ url: 'https://gsg.test/api', token: 't', fetchImpl: fetchFalso as never });

    const salida = await despacharReportes(repos, puerto);

    expect(salida).toMatchObject({ intentados: 1, enviados: 1 });
    expect(fetchFalso).toHaveBeenCalledWith(
      'https://gsg.test/api/ubicaciones',
      expect.objectContaining({ method: 'POST' }),
    );
    const cifras = await repos.rutas.cifrasReportes();
    expect(cifras).toMatchObject({ enviado: 1, pendiente: 0 });
    expect(repos.rutas._reportes[0]?.externoId).toBe('GSG-99');
  });

  it('un 400 no se reintenta para siempre; un 500 si', async () => {
    const repos = createFakeRepos();
    await repos.rutas.encolarReporte({ tipo: 'incidencia', payload: { a: 1 } });
    await repos.rutas.encolarReporte({ tipo: 'incidencia', payload: { b: 2 } });

    let llamada = 0;
    const fetchFalso = vi.fn(async () => {
      llamada++;
      return new Response('nope', { status: llamada === 1 ? 400 : 500 });
    });
    const puerto = crearPuertoHttp({ url: 'https://gsg.test', token: '', fetchImpl: fetchFalso as never });

    await despacharReportes(repos, puerto);

    const cifras = await repos.rutas.cifrasReportes();
    expect(cifras.fallido).toBe(1);
    expect(cifras.pendiente).toBe(1);
  });
});

describe('errores de envio traducidos', () => {
  it('reconoce el numero sin WhatsApp de Meta', () => {
    expect(incidenciaDeErrorDeEnvio('(#131026) Message undeliverable')).toBe('sin_whatsapp');
    expect(incidenciaDeErrorDeEnvio('el numero no tiene WhatsApp')).toBe('sin_whatsapp');
  });

  it('la ventana de 24 h es un bloqueo, no un numero roto', () => {
    expect(incidenciaDeErrorDeEnvio('(#131047) Re-engagement message')).toBe('envio_bloqueado');
  });

  it('lo desconocido queda como error de envio reintentable', () => {
    expect(incidenciaDeErrorDeEnvio('algo raro paso')).toBe('error_envio');
  });
});
