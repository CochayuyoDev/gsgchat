import { afterEach, describe, expect, it } from 'vitest';
import { CATALOGO_POR_DEFECTO } from '../src/archive/clasificar.js';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG } from './escenario-entregas.js';
import { setFakeClock } from './fakes.js';

/**
 * «cambiar ubicación» (regla del dueño, 28/10), con el bot callado de «Solo lo
 * de GSG» (como en produccion): tras «Ubicación registrada» se le dice cómo
 * cambiarla; al decir «cambiar ubicación» el bot le pide la nueva (y mientras
 * se queda la que tenía); la nueva se registra y se le dice cómo volver a
 * cambiarla. Como mucho 2 cambios al día: al tercero se le dice que no. Se ven
 * todas las ubicaciones guardadas y la nota del chat sigue como va el cambio:
 * «ubicacion_cambiada» al registrarse la nueva, «quiere_cambiar_ubicacion»
 * mientras pide otra o cuando ya no se le acepta. Con un catalogo de antes
 * (solo «cambiar_ubicacion»), la de siempre.
 */
const telefono = '987601377';
const phone = '51' + telefono;
const pedido = { ...OBLIGATORIOS_GSG, tracking: 'GSG-CAMBIO-2', cliente: 'Rosa', telefono, distrito: 'Lima' };
const A = { lat: -12.0464, lng: -77.0428 };
const B = { lat: -12.1211, lng: -77.0301 };
const C = { lat: -12.0911, lng: -77.0501 };
const D = { lat: -12.0711, lng: -77.0601 };
// 10:00 en Lima (antes de la hora límite de las 3:00 PM).
const MANANA = new Date('2026-10-28T15:00:00Z');
// 4:00 PM en Lima (pasada la hora límite).
const TARDE = new Date('2026-10-28T21:00:00Z');
afterEach(() => setFakeClock(null));

/** La nota del chat que GSG lee en el historial. */
const notaDe = async (e: Awaited<ReturnType<typeof crearEscenarioEntregas>>) => (await e.repos.chatEtiquetas!.ultimas([phone])).get(phone);

/** El cuerpo de cada mensaje que salió (texto o el de la petición de ubicación). */
const cuerpos = (ms: Array<Record<string, unknown>>): string[] => ms.map((m) => String(m.text ?? m.body ?? (m.interactive as { body?: string } | undefined)?.body ?? ''));

describe('cambiar la ubicación: hasta 2 veces, lo atiende el bot', () => {
  it('registrada → «cambiar ubicación» → nueva → otra vez → nueva → ya no más', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: MANANA });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      expect(e.mensajesA(telefono)).toHaveLength(1);

      // 1. La primera: «Ubicación registrada» y cómo cambiarla.
      await e.contesta(telefono, { pin: A });
      let ultimo = cuerpos(e.mensajesA(telefono)).at(-1)!;
      expect(ultimo).toMatch(/Ubicación registrada correctamente/);
      expect(ultimo).toMatch(/Si desea cambiar su ubicación, diga "Cambio de Ubicación"/);
      expect(ultimo).not.toMatch(/avísanos antes de la/);

      // 2. «cambiar ubicación»: el bot pide la nueva, con el botón; mientras, se queda la que tenía.
      e.avanzar(5);
      await e.contesta(telefono, { texto: 'cambiar ubicación' });
      const pedidaLaNueva = e.mensajesA(telefono).at(-1)!;
      expect(cuerpos([pedidaLaNueva])[0]).toBe('Por favor, comparta su nueva ubicación 📍');
      let ent = (await e.entrega('GSG-CAMBIO-2'))!;
      expect(ent).toMatchObject({ ubicacionEstado: 'recibida', lat: A.lat, lng: A.lng });
      expect(ent.estado).not.toBe('incidencia');
      // Pedirlo la primera vez no pone nota: la etiqueta la pone la IA al leer el chat.
      expect(await notaDe(e)).toBeUndefined();

      // 3. La nueva: se registra como cambio 1 y se le dice cómo volver a cambiarla.
      e.avanzar(5);
      await e.contesta(telefono, { pin: B });
      ultimo = cuerpos(e.mensajesA(telefono)).at(-1)!;
      expect(ultimo).toMatch(/Su nueva ubicación se registró correctamente/);
      expect(ultimo).toMatch(/Si quiere volver a cambiar su ubicación, diga "Cambio de Ubicación"\. Le queda 1 cambio más/);
      ent = (await e.entrega('GSG-CAMBIO-2'))!;
      expect(ent).toMatchObject({ ubicacionEstado: 'recibida', lat: B.lat, lng: B.lng, ubicacionCambios: 1 });
      // La nota del chat: cambió su ubicación, puesta por el bot.
      expect(await notaDe(e)).toMatchObject({ etiqueta: 'ubicacion_cambiada', origen: 'reglas' });

      // 4. Otra vez: segundo y último cambio; ya no se le ofrece otro.
      e.avanzar(5);
      await e.contesta(telefono, { texto: 'cambiar ubicacion' });
      expect(cuerpos(e.mensajesA(telefono)).at(-1)).toBe('Por favor, comparta su nueva ubicación 📍');
      // Mientras no manda la nueva, «cambió» ya no es cierto: quiere cambiarla.
      expect(await notaDe(e)).toMatchObject({ etiqueta: 'quiere_cambiar_ubicacion', origen: 'reglas' });
      e.avanzar(5);
      await e.contesta(telefono, { pin: C });
      ultimo = cuerpos(e.mensajesA(telefono)).at(-1)!;
      expect(ultimo).toMatch(/Su nueva ubicación se registró correctamente/);
      expect(ultimo).not.toMatch(/cambiar ubicación/);
      ent = (await e.entrega('GSG-CAMBIO-2'))!;
      expect(ent).toMatchObject({ lat: C.lat, lng: C.lng, ubicacionCambios: 2 });
      expect(ent.cambioUbicacion).toMatch(/cambió su ubicación 2 veces/);
      expect(await notaDe(e)).toMatchObject({ etiqueta: 'ubicacion_cambiada', origen: 'reglas' });

      // 5. Un tercero: no. Con el último cambio registrado el bot ya se calla
      // (regla del dueño, 29/10): ni a «cambiar ubicación» ni a otro pin. Lo ve soporte por la nota.
      const antes = e.mensajesA(telefono).length;
      e.avanzar(5);
      await e.contesta(telefono, { texto: 'cambiar ubicación' });
      e.avanzar(1);
      await e.contesta(telefono, { pin: D });
      expect(e.mensajesA(telefono)).toHaveLength(antes);
      ent = (await e.entrega('GSG-CAMBIO-2'))!;
      expect(ent).toMatchObject({ lat: C.lat, lng: C.lng, ubicacionCambios: 2 });
      expect(ent.estado).not.toBe('incidencia');

      // En el sistema: todas las ubicaciones guardadas, la vigente marcada.
      const detalle = (await e.entregas.entrega(ent.id))!;
      expect(detalle.ubicaciones.map((u) => [u.lat, u.vigente])).toEqual([
        [A.lat, false],
        [B.lat, false],
        [C.lat, true],
      ]);
      expect(detalle.ubicaciones.slice(1).every((u) => u.cambio)).toBe(true);

      // La nota del chat, que GSG lee en el historial: el tercer cambio no se aceptó,
      // así que queda «quiere_cambiar_ubicacion», puesta por el bot.
      expect(await notaDe(e)).toMatchObject({ etiqueta: 'quiere_cambiar_ubicacion', origen: 'reglas' });
      const registro = await e.repos.chatEtiquetas!.eventos({ phone, limite: 20 });
      expect(registro.filter((r) => r.codigo === 'etiqueta_bot').map((r) => r.detalle)).toEqual(expect.arrayContaining([expect.stringMatching(/ubicacion_cambiada/), expect.stringMatching(/quiere_cambiar_ubicacion/)]));

      // A GSG le llegaron las tres ubicaciones; las dos últimas como cambio.
      await e.despacharAGsg();
      const aGsg = (await e.repos.rutas.reportesRecientes(100, 'ubicacion')).map((r) => r.payload as Record<string, unknown>).filter((p) => p.tracking === 'GSG-CAMBIO-2');
      expect(aGsg.map((p) => p.lat).sort()).toEqual([A.lat, B.lat, C.lat].sort());
      expect(aGsg.filter((p) => p.cambioUbicacion === true)).toHaveLength(2);
    } finally {
      await e.cerrar();
    }
  });

  it('mandar otro pin sin decir «cambiar ubicación» también cuenta como cambio (si le quedan)', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: MANANA });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { pin: A });
      e.avanzar(3);
      await e.contesta(telefono, { pin: B });
      const ent = (await e.entrega('GSG-CAMBIO-2'))!;
      expect(ent).toMatchObject({ ubicacionEstado: 'recibida', lat: B.lat, ubicacionCambios: 1 });
      expect(cuerpos(e.mensajesA(telefono)).at(-1)).toMatch(/Su nueva ubicación se registró correctamente[\s\S]*Le queda 1 cambio más/);
      expect(await notaDe(e)).toMatchObject({ etiqueta: 'ubicacion_cambiada', origen: 'reglas' });
    } finally {
      await e.cerrar();
    }
  });

  it('con un catálogo de antes (solo «cambiar_ubicacion») el bot pone la general y no la cambia al negarse', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: MANANA });
    try {
      const deAntes = CATALOGO_POR_DEFECTO.filter((x) => x.codigo !== 'ubicacion_cambiada' && x.codigo !== 'quiere_cambiar_ubicacion');
      await e.repos.chatEtiquetas!.guardarCatalogo(deAntes);
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { pin: A });
      e.avanzar(3);
      await e.contesta(telefono, { pin: B });
      expect(await notaDe(e)).toMatchObject({ etiqueta: 'cambiar_ubicacion', origen: 'reglas' });
      // Otro pedido de cambio: con la general no hay nada que corregir.
      e.avanzar(3);
      await e.contesta(telefono, { texto: 'cambiar ubicación' });
      expect(await notaDe(e)).toMatchObject({ etiqueta: 'cambiar_ubicacion', origen: 'reglas' });
      // El catálogo guardado del negocio no se tocó.
      expect((await e.repos.chatEtiquetas!.catalogo())!.map((x) => x.codigo)).toEqual(deAntes.map((x) => x.codigo));
    } finally {
      await e.cerrar();
    }
  });

  it('una etiqueta puesta a mano no la cambia el bot, ni al cambiar ni al negarse', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: MANANA });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { pin: A });
      const dia = '2026-10-28';
      await e.repos.chatEtiquetas!.guardar({ phone, dia, etiqueta: 'reclamo', origen: 'manual', huella: 'manual-1', mensajes: 1, motivo: null, loteId: null });
      e.avanzar(3);
      await e.contesta(telefono, { pin: B });
      e.avanzar(3);
      await e.contesta(telefono, { texto: 'cambiar ubicación' });
      expect(await notaDe(e)).toMatchObject({ etiqueta: 'reclamo', origen: 'manual' });
      expect((await e.repos.chatEtiquetas!.delDia(dia, [phone]))[0]).toMatchObject({ etiqueta: 'reclamo', origen: 'manual' });
      expect((await e.repos.chatEtiquetas!.eventos({ phone, limite: 20 })).some((r) => r.codigo === 'etiqueta_bot')).toBe(false);
    } finally {
      await e.cerrar();
    }
  });

  it('después de la hora límite no se ofrece cambiarla y «cambiar ubicación» recibe la respuesta de siempre', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { pin: A });
      expect(cuerpos(e.mensajesA(telefono)).at(-1)).not.toMatch(/cambiar ubicación/);
      await e.contesta(telefono, { texto: 'cambiar ubicación' });
      expect(cuerpos(e.mensajesA(telefono)).at(-1)).toMatch(/después de la 3:00/);
      // Sin una nota del bot que corregir, no pone ninguna: la etiqueta («quiere cambiar») la pone la IA.
      expect(await notaDe(e)).toBeUndefined();
    } finally {
      await e.cerrar();
    }
  });
});
