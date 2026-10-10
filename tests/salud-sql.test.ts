/**
 * El SQL de la capa de salud, contra MySQL/MariaDB de verdad (ver
 * tests/mysql.ts): las ventanas de entregas (resumen por fecha y ultimos N),
 * la supresion por contacto, las pausas de plantilla, el estado de riesgo
 * del numero, los destinatarios de campana y la bitacora de senales.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { createRepos, type Repos } from '../src/db/repos.js';
import { correrGoteo } from '../src/campanas/goteo.js';
import type { Sender } from '../src/outbound/sender.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

let b: BaseDePrueba;
let pool: Pool;
let repos: Repos;

const HORA = 60 * 60 * 1000;

beforeAll(async () => {
  b = await baseDePrueba();
  pool = b.pool;
  repos = createRepos(pool);
});

afterAll(async () => {
  await b?.cerrar();
});

beforeEach(async () => {
  await b.vaciar();
});

async function entrega(phone: string, opts: { status: string; code?: string; bi?: boolean; sentAgoMs?: number; campaignId?: string | null; template?: string }) {
  const c = await repos.contacts.upsertFromInbound(phone);
  const id = await repos.deliveries.create({
    contactId: c.id,
    campaignId: opts.campaignId ?? null,
    kind: 'template',
    templateName: opts.template ?? 'promo',
    category: 'MARKETING',
    businessInitiated: opts.bi ?? true,
  });
  const sentAt = new Date(Date.now() - (opts.sentAgoMs ?? 0));
  if (opts.status === 'failed') {
    await repos.deliveries.markFailed(id, opts.code ?? null, 'fallo');
  } else if (opts.status !== 'queued') {
    await repos.deliveries.markSent(id, `wamid.${id}`);
    if (opts.status !== 'sent') await repos.deliveries.updateByWamid(`wamid.${id}`, opts.status as 'delivered', undefined);
  }
  await pool.query('update deliveries set sent_at = $2 where id = $1', [id, sentAt]);
  return { id, contactId: c.id };
}

describe('ventanas de entregas', () => {
  it('resume lo enviado desde una fecha: enviados, entregados, fallidos por codigo y destinatarios unicos', async () => {
    await entrega('51912000001', { status: 'delivered' });
    await entrega('51912000001', { status: 'read' });
    await entrega('51912000002', { status: 'failed', code: '131026' });
    await entrega('51912000003', { status: 'failed', code: '131049' });
    await entrega('51912000004', { status: 'sent', sentAgoMs: 2 * HORA });
    await entrega('51912000005', { status: 'sent', bi: false });

    const dia = await repos.deliveries.resumenDesde(new Date(Date.now() - 24 * HORA));
    expect(dia.enviados).toBe(6);
    expect(dia.entregados).toBe(2);
    expect(dia.leidos).toBe(1);
    expect(dia.fallidos).toBe(2);
    expect(dia.porCodigo).toEqual({ '131026': 1, '131049': 1 });
    // Unicos: solo iniciados por la empresa y que salieron: 51912000001 y 51912000004.
    expect(dia.destinatariosUnicos).toBe(2);

    const hora = await repos.deliveries.resumenDesde(new Date(Date.now() - HORA));
    expect(hora.enviados).toBe(5);
  });

  it('los ultimos N respetan el orden y el "desde" de la rampa', async () => {
    await entrega('51912000010', { status: 'failed', code: '131000', sentAgoMs: 3 * HORA });
    await entrega('51912000011', { status: 'failed', code: '131000', sentAgoMs: 2 * HORA });
    await entrega('51912000012', { status: 'sent', sentAgoMs: HORA });
    await entrega('51912000013', { status: 'sent' });

    const todos = await repos.deliveries.resumenUltimos(50);
    expect(todos).toMatchObject({ enviados: 4, fallidos: 2 });
    const ultimosDos = await repos.deliveries.resumenUltimos(2);
    expect(ultimosDos).toMatchObject({ enviados: 2, fallidos: 0 });
    const desdeRampa = await repos.deliveries.resumenUltimos(50, new Date(Date.now() - 90 * 60_000));
    expect(desdeRampa).toMatchObject({ enviados: 2, fallidos: 0 });
  });

  it('ultimo envio a un contacto, iniciados desde, por contacto y por plantilla', async () => {
    // Con un servidor cargado cada consulta tarda: las fechas se comprueban
    // dentro de la ventana en que corrio la prueba, no contra "ahora".
    const inicio = Date.now();
    const a = await entrega('51912000020', { status: 'sent', sentAgoMs: 2 * HORA, template: 'a' });
    await entrega('51912000020', { status: 'failed', code: '131000', sentAgoMs: HORA, template: 'a' });
    await entrega('51912000021', { status: 'sent', template: 'b' });

    const ultimo = await repos.deliveries.ultimoEnvioA(a.contactId);
    // El fallido no cuenta como "ultimo envio" para la separacion.
    expect(ultimo!.getTime()).toBeGreaterThanOrEqual(inicio - 2 * HORA - 1000);
    expect(ultimo!.getTime()).toBeLessThanOrEqual(Date.now() - 2 * HORA + 1000);
    expect(await repos.deliveries.contarIniciadosDesde(new Date(Date.now() - 3 * HORA))).toBe(3);
    expect(await repos.deliveries.contarIniciadosAContactoDesde(a.contactId, new Date(Date.now() - 3 * HORA))).toBe(2);
    expect(await repos.deliveries.contarPlantillaDesde('a', new Date(Date.now() - 3 * HORA))).toBe(1);
    const ultimoIniciado = await repos.deliveries.ultimoIniciadoAt();
    expect(ultimoIniciado!.getTime()).toBeGreaterThanOrEqual(inicio - 1000);
    expect(ultimoIniciado!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('acuses que no retroceden', () => {
  it('un "sent" tardio no pisa un "read" ni mueve sent_at; un "failed" si manda', async () => {
    const c = await repos.contacts.upsertFromInbound('51912000080');
    const id = await repos.deliveries.create({ contactId: c.id, kind: 'freeform', category: 'UTILITY', businessInitiated: true });
    await repos.deliveries.markSent(id, 'wamid.80');
    const hace2h = new Date(Date.now() - 2 * HORA);
    await pool.query('update deliveries set sent_at = $2 where id = $1', [id, hace2h]);
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'wamid.80', kind: 'text', body: 'x', status: 'sent' });

    await repos.deliveries.updateByWamid('wamid.80', 'read');
    await repos.messages.setStatusByWamid('wamid.80', 'read');
    // El acuse "sent" reenviado al reconectar:
    await repos.deliveries.updateByWamid('wamid.80', 'sent');
    await repos.messages.setStatusByWamid('wamid.80', 'sent');

    const [fila] = await repos.deliveries.listRecent({ phone: '51912000080', limit: 1, offset: 0 });
    expect(fila?.status).toBe('read');
    expect(Math.abs(fila!.sentAt!.getTime() - hace2h.getTime())).toBeLessThan(1000);
    const ultimo = await repos.deliveries.ultimoEnvioA(c.id);
    expect(Math.abs(ultimo!.getTime() - hace2h.getTime())).toBeLessThan(1000);
    const hilo = await repos.messages.listMessages(c.id, 5);
    expect(hilo[0]?.status).toBe('read');

    await repos.deliveries.updateByWamid('wamid.80', 'failed', { code: '131026', title: 'x' });
    const [tras] = await repos.deliveries.listRecent({ phone: '51912000080', limit: 1, offset: 0 });
    expect(tras?.status).toBe('failed');
    expect(tras?.errorCode).toBe('131026');
  });
});

describe('contactos: supresion, fatiga y bajas', () => {
  it('suprime, cuenta y levanta; anotar envio iniciado lleva la racha y el primer envio', async () => {
    await repos.contacts.upsertFromInbound('51912000030');
    const hasta = new Date(Date.now() + HORA);
    await repos.contacts.suprimir('51912000030', hasta, 'no tiene WhatsApp (131026)', 'todo');
    let c = (await repos.contacts.getByPhone('51912000030'))!;
    expect(c.suprimidoAmbito).toBe('todo');
    expect(c.suprimidoHasta!.getTime()).toBe(hasta.getTime());
    expect(await repos.contacts.contarSuprimidos(new Date())).toBe(1);
    expect(await repos.contacts.contarSuprimidos(new Date(Date.now() + 2 * HORA))).toBe(0);

    await repos.contacts.anotarEnvioIniciado(c.id, new Date());
    await repos.contacts.anotarEnvioIniciado(c.id, new Date());
    c = (await repos.contacts.getByPhone('51912000030'))!;
    expect(c.sinRespuestaSeguidas).toBe(2);
    expect(c.enviosIniciados).toBe(2);
    expect(c.primerEnvioAt).not.toBeNull();
    expect(await repos.contacts.contarNuevosEscritosDesde(new Date(Date.now() - HORA))).toBe(1);

    // Contestar corta la racha.
    await repos.contacts.touchInbound('51912000030', new Date());
    c = (await repos.contacts.getByPhone('51912000030'))!;
    expect(c.sinRespuestaSeguidas).toBe(0);

    await repos.contacts.levantarSupresion('51912000030');
    c = (await repos.contacts.getByPhone('51912000030'))!;
    expect(c.suprimidoHasta).toBeNull();
  });

  it('cuenta las bajas desde una fecha', async () => {
    await repos.contacts.upsertFromInbound('51912000040');
    await repos.contacts.setOptOut('51912000040');
    expect(await repos.contacts.contarBajasDesde(new Date(Date.now() - HORA))).toBe(1);
    expect(await repos.contacts.contarBajasDesde(new Date(Date.now() + HORA))).toBe(0);
  });
});

describe('plantillas: pausas y fecha de aprobacion', () => {
  it('guarda la pausa, la cuenta y la limpia al volver a APPROVED', async () => {
    await repos.templates.upsert({ name: 'p', language: 'es', category: 'UTILITY', status: 'PENDING', quality: null, variables: 0, body: 'x' });
    let t = (await repos.templates.get('p', 'es'))!;
    expect(t.aprobadaAt).toBeNull();

    await repos.templates.setStatus('p', 'es', 'APPROVED');
    t = (await repos.templates.get('p', 'es'))!;
    expect(t.aprobadaAt).not.toBeNull();
    const aprobada = t.aprobadaAt!.getTime();

    const hasta = new Date(Date.now() + 3 * HORA);
    await repos.templates.marcarPausa('p', 'es', hasta, 1, 'FIRST_PAUSE');
    t = (await repos.templates.get('p', 'es'))!;
    expect(t.pausas).toBe(1);
    expect(t.pausadaHasta!.getTime()).toBe(hasta.getTime());
    expect(t.motivo).toBe('FIRST_PAUSE');

    await repos.templates.setStatus('p', 'es', 'APPROVED', 'REINSTATED');
    t = (await repos.templates.get('p', 'es'))!;
    expect(t.pausadaHasta).toBeNull();
    // La fecha de aprobacion original no se mueve.
    expect(t.aprobadaAt!.getTime()).toBe(aprobada);
    expect((await repos.templates.list())[0]?.pausas).toBe(1);
  });
});

describe('estado del numero', () => {
  it('guarda riesgo, estado, limite y reinicio del warm-up', async () => {
    const ahora = new Date();
    await repos.numberState.setRiesgo('PN', {
      riesgo: 70,
      nivel: 'naranja',
      factor: 0.2,
      motivos: ['muchos fallos'],
      pausadaHasta: null,
      rampaDesde: ahora,
      ultimaEvaluacion: ahora,
    });
    await repos.numberState.setEstado('PN', 'FLAGGED');
    await repos.numberState.setLimite24h('PN', 2000);
    let s = await repos.numberState.get('PN');
    expect(s).toMatchObject({ riesgo: 70, nivel: 'naranja', factor: 0.2, motivos: ['muchos fallos'], estado: 'FLAGGED', limite24h: 2000 });
    expect(s.rampaDesde!.getTime()).toBe(ahora.getTime());

    const dia = new Date('2026-02-01T12:00:00Z');
    await repos.numberState.reiniciarWarmup('PN', dia);
    s = await repos.numberState.get('PN');
    expect(s.warmupStartedOn.toISOString().slice(0, 10)).toBe('2026-02-01');
  });
});

describe('campanas por goteo', () => {
  it('guarda los destinatarios en orden, los saca por tandas, los pospone y los cuenta', async () => {
    const id = await repos.campaigns.create({ name: 'Promo', templateName: 'promo', templateLanguage: 'es', category: 'MARKETING', canario: 2, canarioEsperaMin: 30, ritmoPorHora: 50 });
    const n = await repos.campaigns.agregarDestinatarios(id, [
      { phone: '51912000050', variables: ['a'], orden: 0, canario: true },
      { phone: '51912000051', variables: [], orden: 1, canario: true },
      { phone: '51912000052', variables: ['c'], orden: 2, canario: false },
      // Repetido: no se duplica.
      { phone: '51912000052', variables: ['c'], orden: 3, canario: false },
    ]);
    expect(n).toBe(3);

    const canario = await repos.campaigns.siguientesPendientes(id, 10, true);
    expect(canario.map((r) => r.phone)).toEqual(['51912000050', '51912000051']);
    expect(canario[0]?.variables).toEqual(['a']);

    await repos.campaigns.posponerDestinatario(canario[0]!.id, new Date(Date.now() + HORA), 'separacion');
    const ahora = await repos.campaigns.siguientesPendientes(id, 10, false);
    expect(ahora.map((r) => r.phone)).toEqual(['51912000051', '51912000052']);
    const luego = await repos.campaigns.siguientesPendientes(id, 10, false, new Date(Date.now() + 2 * HORA));
    expect(luego.map((r) => r.phone)).toEqual(['51912000050', '51912000051', '51912000052']);
    expect(luego[0]?.intentos).toBe(1);

    const d = await entrega('51912000051', { status: 'delivered', campaignId: id });
    await repos.campaigns.marcarDestinatario(canario[1]!.id, 'enviado', null, d.id);
    expect(await repos.campaigns.contarPendientes(id)).toBe(2);
    expect(await repos.campaigns.cifrasDestinatarios(id)).toEqual({ pendiente: 2, enviado: 1 });

    const resumen = await repos.campaigns.resumenCanario(id);
    expect(resumen).toMatchObject({ enviados: 1, entregados: 1 });
    expect(await repos.deliveries.contarCampanaDesde(id, new Date(Date.now() - HORA))).toBe(1);

    await repos.campaigns.setStatus(id, 'canary');
    await repos.campaigns.setCanarioEnviado(id, new Date());
    let c = (await repos.campaigns.get(id))!;
    expect(c.status).toBe('canary');
    expect(c.startedAt).not.toBeNull();
    expect(c.canarioEnviadoAt).not.toBeNull();
    expect((await repos.campaigns.listarActivas()).map((x) => x.id)).toEqual([id]);

    const lista = await repos.campaigns.list();
    expect(lista[0]?.destinatarios).toEqual({ pendiente: 2, enviado: 1 });

    expect(await repos.campaigns.cancelarPendientes(id, 'parada')).toBe(2);
    await repos.campaigns.setStatus(id, 'stopped', 'parada a mano');
    c = (await repos.campaigns.get(id))!;
    expect(c.motivoPausa).toBe('parada a mano');
    expect(c.finishedAt).not.toBeNull();
    expect(await repos.campaigns.listarActivas()).toEqual([]);
  });

  it('el canario entero pospuesto o bloqueado no tumba el tick del goteo', async () => {
    // Antes se preguntaba "quedan canarios" con una fecha infinita de JS
    // (8.64e15), que la base rechaza: el tick reventaba en cada vuelta y
    // ninguna campana avanzaba mientras existiera una asi.
    const id = await repos.campaigns.create({ name: 'Promo', templateName: 'promo', templateLanguage: 'es', category: 'MARKETING', canario: 1, canarioEsperaMin: 30, ritmoPorHora: null });
    await repos.campaigns.agregarDestinatarios(id, [
      { phone: '51912000060', variables: [], orden: 0, canario: true },
      { phone: '51912000061', variables: [], orden: 1, canario: false },
    ]);
    await repos.campaigns.setStatus(id, 'canary');
    const [canario] = await repos.campaigns.siguientesPendientes(id, 1, true);
    await repos.campaigns.posponerDestinatario(canario!.id, new Date(Date.now() + HORA), 'separacion');
    expect(await repos.campaigns.contarPendientes(id, true)).toBe(1);
    expect(await repos.campaigns.contarPendientes(id)).toBe(2);

    const sender = { send: async () => { throw new Error('no deberia mandar nada'); } } as unknown as Sender;
    // Pospuesto: todavia cuenta como canario por salir, la espera no arranca.
    let r = await correrGoteo({ repos, sender });
    expect(r.campanas).toBe(1);
    expect((await repos.campaigns.get(id))!.canarioEnviadoAt).toBeNull();

    // Bloqueado (modo prueba, baja...): el canario ya no tiene nada que
    // mandar y empieza a contar la espera.
    await repos.campaigns.marcarDestinatario(canario!.id, 'bloqueado', 'modo_prueba: fuera de la lista', null);
    expect(await repos.campaigns.contarPendientes(id, true)).toBe(0);
    r = await correrGoteo({ repos, sender });
    expect(r.campanas).toBe(1);
    expect((await repos.campaigns.get(id))!.canarioEnviadoAt).not.toBeNull();
  });
});

describe('ajustes del reparto y plantillas propias', () => {
  it('los ajustes se guardan encima de los valores por defecto y se pueden borrar', async () => {
    const porDefecto = {
      pausaMinSegundos: 15, pausaMaxSegundos: 30, esperaRespuestaMinutos: 30, maxIntentos: 3, pedirUbicacionCadaMinutos: 0, horaInicio: 9, horaFin: 19,
      plantillas: { solicitud: [], recordatorio: [], insistencia: [] },
      textos: { solicitud: [], recordatorio: [], insistencia: [] },
    };
    expect(await repos.rutas.ajustes.get(porDefecto)).toEqual(porDefecto);
    const guardado = await repos.rutas.ajustes.set({ esperaRespuestaMinutos: 45, textos: { solicitud: ['Hola {nombre}'], recordatorio: [], insistencia: [] } }, porDefecto);
    expect(guardado.esperaRespuestaMinutos).toBe(45);
    expect(guardado.textos.solicitud).toEqual(['Hola {nombre}']);
    // Un segundo patch no pisa lo que no toca.
    const otra = await repos.rutas.ajustes.set({ maxIntentos: 2 }, porDefecto);
    expect(otra).toMatchObject({ esperaRespuestaMinutos: 45, maxIntentos: 2 });
    expect(otra.textos.solicitud).toEqual(['Hola {nombre}']);
    await repos.rutas.ajustes.reset();
    expect(await repos.rutas.ajustes.get(porDefecto)).toEqual(porDefecto);
  });

  it('una plantilla propia guarda sus variables documentadas y solo ella se puede borrar', async () => {
    await repos.templates.upsert({ name: 'propia_1', language: 'es', category: 'UTILITY', status: 'PENDING', quality: null, variables: 2, body: 'Hola {{1}}, {{2}}.', propia: true, variablesDoc: ['nombre', 'pedido'], footer: null });
    await repos.templates.upsert({ name: 'de_meta', language: 'es', category: 'UTILITY', status: 'APPROVED', quality: null, variables: 0, body: 'x' });
    let t = (await repos.templates.get('propia_1', 'es'))!;
    expect(t.propia).toBe(true);
    expect(t.variablesDoc).toEqual(['nombre', 'pedido']);
    // Una sincronizacion con Meta (upsert sin `propia`) no le quita lo propio ni la documentacion.
    await repos.templates.upsert({ name: 'propia_1', language: 'es', category: 'UTILITY', status: 'APPROVED', quality: 'GREEN', variables: 2, body: 'Hola {{1}}, {{2}}.' });
    t = (await repos.templates.get('propia_1', 'es'))!;
    expect(t.propia).toBe(true);
    expect(t.variablesDoc).toEqual(['nombre', 'pedido']);
    expect(t.status).toBe('APPROVED');
    expect(await repos.templates.remove('de_meta', 'es')).toBe(false);
    expect(await repos.templates.remove('propia_1', 'es')).toBe(true);
    expect(await repos.templates.get('propia_1', 'es')).toBeNull();
  });
});

describe('bitacora de senales', () => {
  it('registra, cuenta por tipo y codigo, resume, lista y purga', async () => {
    const c = await repos.contacts.upsertFromInbound('51912000060');
    await repos.salud.registrar({ phoneNumberId: 'PN', tipo: 'error_envio', codigo: '131026', detalle: 'x', contactId: c.id });
    await repos.salud.registrar({ phoneNumberId: 'PN', tipo: 'error_envio', codigo: '131049' });
    await repos.salud.registrar({ phoneNumberId: 'PN', tipo: 'desconexion', codigo: '428', at: new Date(Date.now() - 2 * HORA) });
    await repos.salud.registrar({ phoneNumberId: 'PN', tipo: 'pausa_auto', payload: { motivos: ['a'] } });

    const hace1h = new Date(Date.now() - HORA);
    expect(await repos.salud.contar(hace1h)).toBe(3);
    expect(await repos.salud.contar(hace1h, 'error_envio')).toBe(2);
    expect(await repos.salud.contar(hace1h, 'error_envio', '131026')).toBe(1);
    expect(await repos.salud.contar(new Date(Date.now() - 3 * HORA), 'desconexion')).toBe(1);
    expect(await repos.salud.resumen(hace1h)).toEqual({ 'error_envio:131026': 1, 'error_envio:131049': 1, 'pausa_auto:': 1 });

    const ultimos = await repos.salud.ultimos(2);
    expect(ultimos.length).toBe(2);
    expect(ultimos[0]?.tipo).toBe('pausa_auto');
    expect(ultimos[0]?.payload).toEqual({ motivos: ['a'] });

    expect(await repos.salud.purgar(hace1h)).toBe(1);
    expect(await repos.salud.contar(new Date(0))).toBe(3);
  });

  it('cuenta los entrantes desde una fecha', async () => {
    const c = await repos.contacts.upsertFromInbound('51912000070');
    await repos.messages.add({ contactId: c.id, direction: 'in', kind: 'text', body: 'hola', createdAt: new Date() });
    await repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', body: 'buenas', createdAt: new Date() });
    expect(await repos.messages.contarEntrantesDesde(new Date(Date.now() - HORA))).toBe(1);
  });
});
