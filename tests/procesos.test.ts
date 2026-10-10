/**
 * Los procesos (src/procesos): el lector de datos, las cuatro plantillas de
 * punta a punta por el MISMO camino que un WhatsApp de verdad (processChange →
 * handlers/inbound.ts → el gancho de procesos) y el motor, con respuestas
 * validas, invalidas, sin respuesta, consultas ajenas y el cierre.
 *
 * Se usan numeros de prueba (51 000 0…): el sender los guarda en el hilo sin
 * mandarlos y no gastan el ritmo, asi el motor no espera la pausa entre uno y
 * otro. Lo que se mando se lee del hilo de cada contacto.
 */

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import { processChange } from '../src/whatsapp/webhook.js';
import type { ChangeValue } from '../src/whatsapp/types.js';
import { crearServicioProcesos, enFranja } from '../src/procesos/servicio.js';
import { leerAvance, leerDato, leerDecision, leerDocumentoIdentidad, leerFecha, leerHora, leerNumero, rucValido } from '../src/procesos/validar.js';
import { leerLista } from '../src/procesos/personas.js';
import { componer, objetivoEspera } from '../src/procesos/nucleo.js';
import { rellenarTexto, problemasDePasos, pasoNuevo } from '../src/procesos/modelo.js';
import { PLANTILLAS } from '../src/procesos/plantillas.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp } from './fakes.js';

const config = loadConfig({
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
  TIMEZONE: 'America/Lima',
  BUSINESS_NAME: 'La Tienda',
} as NodeJS.ProcessEnv);

const TZ = 'America/Lima';
let seq = 0;

function mensaje(phone: string, m: Record<string, unknown>): ChangeValue {
  return {
    contacts: [{ wa_id: phone, profile: { name: 'Persona' } }],
    messages: [{ id: `wamid.proc.${++seq}.${Math.random()}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), ...m }],
  } as unknown as ChangeValue;
}
const texto = (phone: string, body: string) => mensaje(phone, { type: 'text', text: { body } });
const pin = (phone: string, lat = -12.1211, lng = -77.0297) => mensaje(phone, { type: 'location', location: { latitude: lat, longitude: lng } });
const boton = (phone: string, id: string, title: string) => mensaje(phone, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const foto = (phone: string) => mensaje(phone, { type: 'image', image: { id: `media-${++seq}`, mime_type: 'image/jpeg' } });

const hoyLima = () => new Date().toLocaleDateString('es-PE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const enMinutos = (m: number) => new Date(Date.now() + m * 60_000).toLocaleTimeString('es-PE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

async function armar() {
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  const settings = await createFakeSettings(config);
  await repos.automation.setPrefs({ askLocationFallback: false, preventaActiva: false });
  const procesos = await crearServicioProcesos({ repos, sender, nombreNegocio: () => 'La Tienda', timezone: TZ, distritos: config.distritos });
  const deps = { repos, wa, sender, config, settings };
  const repo = repos.procesos!;

  /** Un proceso de la plantilla, abierto todo el dia (las pruebas corren a cualquier hora). */
  const desde = async (plantilla: string) => {
    const p = await procesos.crearDesdePlantilla(plantilla);
    await repo.actualizarProceso(p.id, { ritmo: { desde: '00:00', hasta: '23:59' } });
    return p;
  };
  /** El motor hasta que no quede nada que mandar. */
  const motor = async () => {
    for (let i = 0; i < 100; i++) if ((await procesos.tick()).accion === 'nada') return;
  };
  /** Lo que se le mando a ese telefono, en orden. */
  const salidas = async (phone: string) => {
    const c = await repos.contacts.getByPhone(phone);
    if (!c) return [] as string[];
    return (await repos.messages.listMessages(c.id, 500)).filter((m) => m.direction === 'out').sort((a, b) => Number(a.id) - Number(b.id)).map((m) => String(m.body ?? ''));
  };
  const persona = async (phone: string) => (await repo.personas({ phone, limit: 1 }))[0]!;
  const recibir = (v: ChangeValue) => processChange('messages', v, deps);
  return { repos, wa, sender, procesos, repo, deps, desde, motor, salidas, persona, recibir };
}

// ------------------------------------------------------------------ lectores

describe('lo que se valida de cada dato', () => {
  it('DNI de 8, carné de extranjería de 9 y RUC de 11 con su dígito de control', () => {
    expect(leerDocumentoIdentidad('mi dni es 45678912')).toMatchObject({ ok: true, valor: '45678912', extra: { tipo: 'DNI' } });
    expect(leerDocumentoIdentidad('001234567')).toMatchObject({ ok: true, extra: { tipo: 'Carné de extranjería' } });
    expect(rucValido('20100070970')).toBe(true);
    expect(leerDocumentoIdentidad('RUC 20100070970')).toMatchObject({ ok: true, valor: '20100070970', extra: { tipo: 'RUC' } });
    expect(leerDocumentoIdentidad('20100070971')).toMatchObject({ ok: false });
    const corto = leerDocumentoIdentidad('1234567');
    expect(corto.ok).toBe(false);
    if (!corto.ok) expect(corto.motivo).toMatch(/7 dígitos/);
  });

  it('números, fechas y horas como los escribe la gente', () => {
    expect(leerNumero('S/ 1,250.50')).toMatchObject({ ok: true, valor: '1250.5' });
    expect(leerNumero('150 soles')).toMatchObject({ ok: true, valor: '150' });
    const ahora = new Date('2026-09-24T15:00:00Z');
    expect(leerFecha('25/09/2026', ahora, TZ)).toBe('2026-09-25');
    expect(leerFecha('mañana', ahora, TZ)).toBe('2026-09-25');
    expect(leerFecha('26 de setiembre', ahora, TZ)).toBe('2026-09-26');
    expect(leerFecha('en la mañana', ahora, TZ)).toBeNull();
    expect(leerHora('a las 4')).toBe('16:00');
    expect(leerHora('10:30')).toBe('10:30');
    expect(leerHora('3 pm')).toBe('15:00');
  });

  it('una ubicación solo vale como ubicación, una foto solo como foto o documento', () => {
    expect(leerDato('ubicacion', { texto: '', ubicacion: { lat: -12, lng: -77, mapsUrl: null, fuente: 'pin' } }).ok).toBe(true);
    expect(leerDato('ubicacion', { texto: '', fueraDeZona: true })).toMatchObject({ ok: false, motivo: expect.stringMatching(/fuera de la zona/) });
    expect(leerDato('foto', { texto: 'ya te la mandé' }).ok).toBe(false);
    expect(leerDato('captura_pago', { texto: '', adjunto: { tipo: 'image' } }).ok).toBe(true);
    expect(leerDato('direccion', { texto: 'Av. Arequipa 1234, Lince' }, { distritos: config.distritos })).toMatchObject({ ok: true, extra: { distrito: 'Lince' } });
    expect(leerDato('direccion', { texto: 'por ahí' }).ok).toBe(false);
  });

  it('SÍ, NO y reprogramar; llegué, terminé y no pude', () => {
    expect(leerDecision({ texto: 'sí, ahí estaré' }).decision).toBe('si');
    expect(leerDecision({ texto: 'no puedo ir' }).decision).toBe('no');
    expect(leerDecision({ texto: 'quisiera otro día' }).decision).toBe('reprogramar');
    expect(leerDecision({ texto: '', boton: 'proc:3:reprogramar' })).toMatchObject({ decision: 'reprogramar', como: 'boton' });
    expect(leerAvance({ texto: 'ya llegué' }).avance).toBe('llego');
    expect(leerAvance({ texto: 'terminé' }).avance).toBe('termino');
    expect(leerAvance({ texto: 'no pude, no había nadie' }).avance).toBe('no_pudo');
  });

  it('la lista: cabecera en cualquier orden, repetidos fuera, un número que no sirve queda con su motivo', () => {
    const l = leerLista({ texto: 'Nombre;Celular;Fecha;Hora\nAna;987654321;25/09;10:00\nLuis;987654321;25/09;11:00\nRosa;98765;25/09;12:00' });
    expect(l.personas).toHaveLength(2);
    expect(l.duplicadas).toBe(1);
    expect(l.personas[0]).toMatchObject({ phone: '51987654321', nombre: 'Ana', datos: { fecha: '25/09', hora: '10:00' } });
    expect(l.personas[1]).toMatchObject({ phone: null, estado: 'error' });
    expect(l.columnas).toEqual(['fecha', 'hora']);
    const sin = leerLista({ filas: [{ telefono: '912345678', nombre: 'Luis', monto: 'S/ 20' }] });
    expect(sin.personas[0]).toMatchObject({ phone: '51912345678', datos: { monto: 'S/ 20' } });
  });

  it('las variables: {nombre} es el primer nombre y lo que no existe se quita sin dejar huecos raros', () => {
    expect(rellenarTexto('Hola {nombre}, tu cita del {fecha} en {negocio}{lugar}.', { nombre: 'Ana Ruiz', negocio: 'La Clínica', datos: { fecha: '25/09' } })).toBe('Hola Ana, tu cita del 25/09 en La Clínica.');
  });

  it('el editor no deja guardar un paso sin mensaje o sin dato', () => {
    const p = pasoNuevo('pedir', 'x');
    expect(problemasDePasos([{ ...p, texto: '' }])[0]).toMatch(/falta el mensaje/);
    expect(problemasDePasos([{ ...p, texto: 'hola', dato: undefined }])[0]).toMatch(/qué dato/);
  });

  it('la espera «antes de la cita» sale de las columnas fecha y hora', () => {
    const paso = PLANTILLAS.find((p) => p.id === 'confirmaciones')!.pasos[1]!;
    const ahora = new Date('2026-09-24T15:00:00Z');
    const hasta = objetivoEspera(paso, { datos: { fecha: '25/09/2026', hora: '10:30' } }, ahora, TZ)!;
    // 10:30 de Lima (-05:00) menos 2 horas = 13:30 UTC.
    expect(hasta.toISOString()).toBe('2026-09-25T13:30:00.000Z');
    expect(objetivoEspera(paso, { datos: {} }, ahora, TZ)).toBeNull();
  });

  it('la franja del proceso manda: fuera de ella no se escribe', () => {
    const p = { ritmo: { desde: '08:00', hasta: '20:00' } };
    expect(enFranja(p, new Date('2026-09-24T15:00:00Z'), TZ)).toBe(true); // 10:00 en Lima
    expect(enFranja(p, new Date('2026-09-25T03:00:00Z'), TZ)).toBe(false); // 22:00 en Lima
  });

  it('un aviso se junta con la pregunta siguiente: un solo mensaje', () => {
    const proceso = { id: 1, nombre: 'X', plantilla: null, descripcion: '', estado: 'activo' as const, createdAt: new Date(), updatedAt: new Date(), ritmo: { desde: '00:00', hasta: '23:59' }, cierre: { fin: 'Fin.', ajena: '', persona: '' }, pasos: [{ ...pasoNuevo('aviso', 'a'), texto: 'Aviso para {nombre}.' }, { ...pasoNuevo('pedir', 'b'), texto: '¿Tu DNI?', dato: 'documento_identidad' as const }] };
    const persona = { id: 9, corridaId: 1, procesoId: 1, phone: '51000000001', telefonoCrudo: '', nombre: 'Ana', datos: {}, estado: 'pendiente' as const, paso: 0, intentos: 0, fallos: 0, sub: null, proximoAt: null, ultimoEnvioAt: null, respuestas: {}, ultimo: null, motivo: null, pausada: false, createdAt: new Date(), updatedAt: new Date(), terminadaAt: null };
    const c = componer(proceso, persona, 0, '', { negocio: 'N', ahora: new Date(), timezone: TZ });
    expect(c.mensaje!.body).toBe('Aviso para Ana.\n\n¿Tu DNI?');
    expect(c.patch).toMatchObject({ estado: 'esperando', paso: 1, intentos: 1 });
  });
});

// ------------------------------------------------------------------ plantillas de punta a punta

describe('Pedir y validar datos', () => {
  it('flujo completo: ubicación, un DNI que no vale, el bueno, la dirección y la foto; cierre al final', async () => {
    const t = await armar();
    const p = await t.desde('datos');
    const r = await t.procesos.cargarPersonas(p.id, { texto: 'telefono;nombre\n000000201;Ana Ruiz' });
    expect(r.listas).toBe(1);
    await t.motor();
    const tel = '51000000201';
    expect((await t.salidas(tel))[0]).toMatch(/Hola Ana, te escribimos de La Tienda.*ubicación/s);
    expect((await t.persona(tel)).estado).toBe('esperando');

    await t.recibir(pin(tel));
    let s = await t.salidas(tel);
    // Un solo mensaje: el gracias pegado a la pregunta siguiente.
    expect(s).toHaveLength(2);
    expect(s[1]).toMatch(/Ubicación registrada, gracias\.\s+Ahora escríbenos tu número de DNI/);

    await t.recibir(texto(tel, '1234567'));
    s = await t.salidas(tel);
    expect(s.at(-1)).toMatch(/no parece un documento válido/);
    expect((await t.persona(tel)).fallos).toBe(1);

    await t.recibir(texto(tel, 'es 45678912'));
    expect((await t.salidas(tel)).at(-1)).toMatch(/Documento registrado\.\s+Escríbenos tu dirección completa/);
    await t.recibir(texto(tel, 'Jr. Puno 340, Cercado de Lima'));
    expect((await t.salidas(tel)).at(-1)).toMatch(/foto de tu documento/);
    await t.recibir(foto(tel));
    const fin = await t.persona(tel);
    expect(fin.estado).toBe('completada');
    expect((await t.salidas(tel)).at(-1)).toMatch(/Listo, Ana! Ya tenemos todos tus datos/);
    expect(fin.respuestas.ubicacion!.extra).toMatchObject({ lat: -12.1211, lng: -77.0297 });
    expect(fin.respuestas.dni).toMatchObject({ valor: '45678912', extra: { tipo: 'DNI' } });
    expect(fin.respuestas.direccion!.valor).toBe('Jr. Puno 340, Cercado de Lima');
    expect(fin.respuestas.documento!.valor).toBe('foto');

    // Terminado: lo que escriba despues ya no es del proceso (sigue su camino de siempre).
    const antes = (await t.salidas(tel)).length;
    await t.recibir(texto(tel, 'gracias!'));
    expect((await t.salidas(tel)).length).toBe(antes);
    expect(await t.repo.vivaPorTelefono(tel)).toBeNull();
  });

  it('«¿para qué?» se explica con el texto del paso y se vuelve a pedir; una consulta ajena recibe el cierre y pasa a una persona', async () => {
    const t = await armar();
    const p = await t.desde('datos');
    await t.procesos.cargarPersonas(p.id, { texto: 'telefono;nombre\n000000202;Luis Paz\n000000203;Rosa Díaz' });
    await t.motor();
    await t.recibir(texto('51000000202', '¿para qué quieren mi ubicación?'));
    const s = await t.salidas('51000000202');
    expect(s.at(-1)).toMatch(/solo para ubicar tu domicilio.*Compártenos tu ubicación/s);
    expect((await t.persona('51000000202')).estado).toBe('esperando');

    await t.recibir(texto('51000000203', '¿cuánto cuesta el envío a provincia?'));
    const r = await t.persona('51000000203');
    expect(r.estado).toBe('persona');
    expect(r.motivo).toMatch(/no es de este proceso/);
    expect((await t.salidas('51000000203')).at(-1)).toMatch(/solo atendemos este trámite, Rosa/);
    // En manos de una persona: el sistema no contesta nada mas.
    const n = (await t.salidas('51000000203')).length;
    await t.recibir(texto('51000000203', 'hola? me responden?'));
    expect((await t.salidas('51000000203')).length).toBe(n);
  });

  it('sin respuesta: se insiste las veces del paso y al final pasa a una persona', async () => {
    const t = await armar();
    const p = await t.desde('datos');
    await t.procesos.cargarPersonas(p.id, { texto: '000000204;Mario' });
    await t.motor();
    const tel = '51000000204';
    for (let i = 0; i < 3; i++) {
      await t.repo.actualizarPersona((await t.persona(tel)).id, { proximoAt: new Date(Date.now() - 1000) });
      await t.motor();
    }
    const s = await t.salidas(tel);
    expect(s).toHaveLength(3); // el primero y dos insistencias
    expect(s[1]).toMatch(/Te escribimos de nuevo/);
    const fin = await t.persona(tel);
    expect(fin.estado).toBe('persona');
    expect(fin.motivo).toMatch(/No respondió a 3 mensajes/);
  });

  it('a la tercera respuesta que no vale pasa a una persona', async () => {
    const t = await armar();
    const p = await t.desde('datos');
    await t.procesos.cargarPersonas(p.id, { texto: '000000205;Elena' });
    await t.motor();
    const tel = '51000000205';
    for (const x of ['estoy por la iglesia', 'cerca del mercado', 'al costado del colegio']) await t.recibir(texto(tel, x));
    const fin = await t.persona(tel);
    expect(fin.estado).toBe('persona');
    expect(fin.motivo).toMatch(/No se pudo leer su respuesta 3 veces/);
  });
});

describe('Confirmaciones y recordatorios', () => {
  it('SÍ con el botón: confirma y, con la cita dentro de una hora, el recordatorio sale en el mismo mensaje', async () => {
    const t = await armar();
    const p = await t.desde('confirmaciones');
    await t.procesos.cargarPersonas(p.id, { texto: `telefono;nombre;fecha;hora\n000000301;Ana;${hoyLima()};${enMinutos(60)}` });
    await t.motor();
    const tel = '51000000301';
    expect((await t.salidas(tel))[0]).toMatch(/confirmar tu cita del .* a las .*¿Asistirás\?/s);
    const id = (await t.persona(tel)).id;
    await t.recibir(boton(tel, `proc:${id}:si`, 'Sí'));
    const fin = await t.persona(tel);
    expect(fin.estado).toBe('completada');
    expect(fin.respuestas.confirmar).toMatchObject({ valor: 'si', como: 'boton' });
    expect((await t.salidas(tel)).at(-1)).toMatch(/Tu cita queda confirmada\.\s+Te recordamos, Ana: hoy a las/);
  });

  it('SÍ con la cita lejos: queda programada hasta 2 horas antes', async () => {
    const t = await armar();
    const p = await t.desde('confirmaciones');
    const pasado = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString('es-PE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
    await t.procesos.cargarPersonas(p.id, { texto: `telefono;nombre;fecha;hora\n000000302;Luis;${pasado};10:00` });
    await t.motor();
    await t.recibir(texto('51000000302', 'sí, confirmo'));
    const x = await t.persona('51000000302');
    expect(x.estado).toBe('programada');
    expect(x.proximoAt!.getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
    // Mientras espera, un «gracias» no se contesta; un cambio de planes pasa a una persona.
    const n = (await t.salidas('51000000302')).length;
    await t.recibir(texto('51000000302', 'gracias'));
    expect((await t.salidas('51000000302')).length).toBe(n);
    await t.recibir(texto('51000000302', 'al final no voy a poder ir, se me cruzó un viaje'));
    expect((await t.persona('51000000302')).estado).toBe('persona');
  });

  it('NO: se libera con el texto del paso y termina como «dijo que no»', async () => {
    const t = await armar();
    const p = await t.desde('confirmaciones');
    await t.procesos.cargarPersonas(p.id, { texto: `telefono;nombre;fecha;hora\n000000303;Rosa;${hoyLima()};${enMinutos(90)}` });
    await t.motor();
    await t.recibir(texto('51000000303', 'no'));
    const x = await t.persona('51000000303');
    expect(x.estado).toBe('rechazo');
    expect((await t.salidas('51000000303')).at(-1)).toMatch(/liberamos tu cita/);
  });

  it('REPROGRAMAR: pide la nueva fecha, la guarda y sigue con ella', async () => {
    const t = await armar();
    const p = await t.desde('confirmaciones');
    await t.procesos.cargarPersonas(p.id, { texto: `telefono;nombre;fecha;hora\n000000304;Jorge;${hoyLima()};${enMinutos(90)}` });
    await t.motor();
    const tel = '51000000304';
    const id = (await t.persona(tel)).id;
    await t.recibir(boton(tel, `proc:${id}:reprogramar`, 'Reprogramar'));
    expect((await t.persona(tel)).sub).toBe('reprogramando');
    expect((await t.salidas(tel)).at(-1)).toMatch(/Qué día y a qué hora te acomoda/);
    await t.recibir(texto(tel, 'cuando pueda'));
    expect((await t.salidas(tel)).at(-1)).toMatch(/No pude leer la fecha/);
    await t.recibir(texto(tel, 'el 28/12 a las 10:00'));
    const x = await t.persona(tel);
    expect(x.datos).toMatchObject({ hora: '10:00' });
    expect(x.datos.fecha).toMatch(/^28\/12\/\d{4}$/);
    expect(x.estado).toBe('programada');
    expect((await t.salidas(tel)).at(-1)).toMatch(/Listo, Jorge: queda para el 28\/12\/\d{4} a las 10:00\./);
  });
});

describe('Avisos al personal de campo', () => {
  it('llegué, terminé: el avance queda con sus horas y la tarea se cierra', async () => {
    const t = await armar();
    const p = await t.desde('campo');
    await t.procesos.cargarPersonas(p.id, { texto: 'telefono;nombre;tarea;direccion;hora\n000000401;Carlos;Instalación de router;Av. Arequipa 1234;10:00' });
    await t.motor();
    const tel = '51000000401';
    expect((await t.salidas(tel))[0]).toMatch(/Instalación de router en Av\. Arequipa 1234, a las 10:00/);
    await t.recibir(texto(tel, 'ya llegué'));
    expect((await t.persona(tel)).sub).toBe('llego');
    expect((await t.salidas(tel)).at(-1)).toMatch(/Llegaste a las/);
    await t.recibir(texto(tel, 'hay mucho tráfico por aquí'));
    expect((await t.salidas(tel)).at(-1)).toMatch(/No entendí, Carlos/);
    await t.recibir(texto(tel, 'terminé'));
    const x = await t.persona(tel);
    expect(x.estado).toBe('completada');
    expect(x.respuestas.tarea).toMatchObject({ valor: 'termino' });
    expect(x.respuestas.tarea!.extra?.llego).toBeTruthy();
    expect((await t.salidas(tel)).at(-1)).toMatch(/La tarea queda cerrada/);
  });

  it('no pude: pasa al coordinador', async () => {
    const t = await armar();
    const p = await t.desde('campo');
    await t.procesos.cargarPersonas(p.id, { texto: 'telefono;nombre;tarea;direccion;hora\n000000402;Rosa;Inspección;Jr. Puno 340;15:00' });
    await t.motor();
    const id = (await t.persona('51000000402')).id;
    await t.recibir(boton('51000000402', `proc:${id}:no_pudo`, 'No pude'));
    const x = await t.persona('51000000402');
    expect(x.estado).toBe('persona');
    expect((await t.salidas('51000000402')).at(-1)).toMatch(/El coordinador te escribe/);
  });
});

describe('Cobranza y trámites', () => {
  it('con el vencimiento cerca pide la captura; un texto no vale; la captura pasa a una persona para validarla', async () => {
    const t = await armar();
    const p = await t.desde('cobranza');
    await t.procesos.cargarPersonas(p.id, { texto: `telefono;nombre;monto;vencimiento\n000000501;Ana;S/ 150.00;${hoyLima()}` });
    await t.motor();
    const tel = '51000000501';
    expect((await t.salidas(tel))[0]).toMatch(/tu pago de S\/ 150\.00 vence el/);
    await t.recibir(texto(tel, 'ya pagué ayer'));
    expect((await t.salidas(tel)).at(-1)).toMatch(/necesitamos la captura/);
    await t.recibir(foto(tel));
    const x = await t.persona(tel);
    expect(x.estado).toBe('persona');
    expect(x.respuestas.captura!.valor).toBe('captura');
    const ultimo = (await t.salidas(tel)).at(-1) ?? '';
    expect(ultimo, JSON.stringify(ultimo)).toContain('Recibimos tu comprobante: una persona de La Tienda lo revisa');
  });

  it('con el vencimiento lejos espera hasta el día antes', async () => {
    const t = await armar();
    const p = await t.desde('cobranza');
    const lejos = new Date(Date.now() + 10 * 86_400_000).toLocaleDateString('es-PE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
    await t.procesos.cargarPersonas(p.id, { texto: `telefono;nombre;monto;vencimiento\n000000502;Luis;S/ 80;${lejos}` });
    await t.motor();
    const x = await t.persona('51000000502');
    expect(x.estado).toBe('programada');
    expect(await t.salidas('51000000502')).toHaveLength(0);
  });
});

describe('lo que no es de un proceso sigue su camino', () => {
  it('sin corrida viva el gancho no se queda con el mensaje', async () => {
    const t = await armar();
    const { atenderEntrante } = await import('../src/procesos/nucleo.js');
    const r = await atenderEntrante(t.procesos.depsNucleo(), '51000000999', { texto: 'hola' });
    expect(r.atendida).toBe(false);
  });

  it('un chat pasado a una persona no le quita sus mensajes al reparto: si tiene una solicitud de ubicación abierta, la atiende el reparto', async () => {
    const t = await armar();
    const p = await t.desde('datos');
    await t.procesos.cargarPersonas(p.id, { texto: '000000801;Ana' });
    await t.motor();
    const tel = '51000000801';
    await t.recibir(texto(tel, '¿cuánto cuesta el envío a provincia?'));
    expect((await t.persona(tel)).estado).toBe('persona');
    // Ahora le llega un pedido del reparto a ese mismo numero.
    const lote = await t.repos.rutas.crearLote({ nombre: 'Reparto' });
    const [s] = await t.repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '000000801', phone: tel, nombre: 'Ana', referencia: 'P-1' }]);
    await t.repos.rutas.actualizarSolicitud(s!.id, { estado: 'enviado', intentos: 1, ultimoEnvioAt: new Date() });
    await t.recibir(pin(tel));
    const despues = await t.repos.rutas.solicitud(s!.id);
    expect(despues!.estado).toBe('resuelto');
  });

  it('una persona en otra corrida viva no entra dos veces; quien se dio de baja no recibe nada', async () => {
    const t = await armar();
    const p = await t.desde('datos');
    await t.repos.contacts.upsertFromInbound('51000000602');
    await t.repos.contacts.setOptOut('51000000602');
    await t.procesos.cargarPersonas(p.id, { texto: '000000601;Ana\n000000602;Baja' });
    const r = await t.procesos.cargarPersonas(p.id, { texto: '000000601;Ana otra vez' });
    expect(r.conError).toBe(1);
    const baja = (await t.repo.personas({ phone: '51000000602', limit: 1 }))[0]!;
    expect(baja).toMatchObject({ estado: 'error' });
    expect(baja.motivo).toMatch(/Se dio de baja/);
  });

  it('acciones en masa: pausar, pedir ahora, pasar a una persona; y el CSV con las respuestas', async () => {
    const t = await armar();
    const p = await t.desde('datos');
    const c = await t.procesos.cargarPersonas(p.id, { texto: '000000701;Ana\n000000702;Luis' });
    await t.motor();
    await t.recibir(pin('51000000701'));
    const ids = (await t.repo.personas({ corridaId: c.corrida.id })).map((x) => x.id);
    expect((await t.procesos.masa('pausar', ids)).hechos).toBe(2);
    expect((await t.repo.personas({ corridaId: c.corrida.id })).every((x) => x.pausada)).toBe(true);
    expect((await t.procesos.masa('persona', [ids[0]!], 'Ali')).aviso).toMatch(/pasa a una persona/);
    const reabrir = await t.procesos.masa('pedir_ahora', [ids[0]!], 'Ali');
    expect(reabrir.hechos).toBe(1);
    expect((await t.repo.persona(ids[0]!))!).toMatchObject({ estado: 'pendiente', pausada: false });
    const csv = await t.procesos.exportarCsv({ corridaId: c.corrida.id });
    expect(csv.csv.split('\r\n')[0]).toContain('Pedir la ubicación');
    expect(csv.csv).toContain('https://www.google.com/maps');
  });
});

describe('la plantilla GSG', () => {
  it('sin nada guardado, manda el valor por defecto; activarla y desactivarla la cambia', async () => {
    const repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    const nueva = await crearServicioProcesos({ repos, sender, nombreNegocio: () => 'X', gsgPorDefecto: false });
    await nueva.cargar();
    expect(nueva.gsgActivo()).toBe(false);
    const g = await nueva.crearDesdePlantilla('gsg');
    expect(nueva.gsgActivo()).toBe(true);
    await nueva.cambiarEstado(g.id, 'pausado');
    expect(nueva.gsgActivo()).toBe(false);
    await expect(nueva.borrar(g.id)).rejects.toThrow(/no se borran/);

    const principal = await crearServicioProcesos({ repos: createFakeRepos(), sender, nombreNegocio: () => 'GSG', gsgPorDefecto: true });
    await principal.cargar();
    expect(principal.gsgActivo()).toBe(true);
    expect((await principal.listar()).some((p) => p.plantilla === 'gsg' && p.estado === 'activo')).toBe(true);
  });
});
