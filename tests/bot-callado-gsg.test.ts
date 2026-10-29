import { afterEach, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG } from './escenario-entregas.js';
import { setFakeClock } from './fakes.js';

/**
 * El bot callado (regla del dueño, 16/10): con «Solo lo de GSG» y la IA
 * apagada, al cliente solo le llegan la solicitud de ubicacion, los
 * recordatorios y el agradecimiento tras su ubicacion actual. Lo demas que
 * escriba no recibe respuesta, pero se procesa igual.
 */
const telefono = '987601316';
const phone = '51' + telefono;
const fijo = { lat: -12.0464, lng: -77.0428 };
const pedido = { ...OBLIGATORIOS_GSG, tracking: 'GSG-CALLADO-1', cliente: 'Rosa', telefono, distrito: 'Lima' };
// 10:00 y 2:00 PM en Lima: antes y después de la hora límite para cambiar la ubicación (1:00 PM).
const MANANA = new Date('2026-10-28T15:00:00Z');
const TARDE = new Date('2026-10-28T19:00:00Z');
afterEach(() => setFakeClock(null));

describe('bot callado en «Solo lo de GSG» sin IA', () => {
  it('no contesta textos ni la ubicación en tiempo real; agradece la ubicación actual; «cambiar ubicación» sí lo atiende', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: MANANA });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      const inicio = e.mensajesA(telefono).length;
      expect(inicio).toBe(1);

      await e.contesta(telefono, { texto: '¿Por qué me piden la ubicación?' });
      await e.contesta(telefono, { texto: 'hola, quién es?' });
      await e.api.post('/admin/dev/inbound', { from: phone, location: { latitude: fijo.lat, longitude: fijo.lng }, enVivo: true });
      expect(e.mensajesA(telefono)).toHaveLength(inicio);
      expect((await e.entrega('GSG-CALLADO-1'))!.ubicacionEstado).toBe('pendiente');

      await e.contesta(telefono, { pin: fijo });
      expect((await e.entrega('GSG-CALLADO-1'))!.ubicacionEstado).toBe('recibida');
      expect(e.mensajesA(telefono)).toHaveLength(inicio + 1);
      expect(e.textosA(telefono).at(-1)).toMatch(/ubicación registrada/i);

      await e.contesta(telefono, { texto: '¿A qué hora llega mi pedido?' });
      expect(e.mensajesA(telefono)).toHaveLength(inicio + 1);
      // «cambiar ubicación» lo atiende el bot aunque esté callado (regla del dueño, 28/10):
      // le pide la nueva y, mientras, se queda la que tenía. No es un error para GSG.
      await e.contesta(telefono, { texto: 'quiero cambiar mi ubicación' });
      expect(e.mensajesA(telefono)).toHaveLength(inicio + 2);
      expect(String(e.mensajesA(telefono).at(-1)!.body)).toBe('Por favor, comparta su nueva ubicación 📍');
      await e.contesta(telefono, { texto: 'gracias' });
      expect(e.mensajesA(telefono)).toHaveLength(inicio + 2);
      const incidencias = (await e.repos.rutas.reportesRecientes(100, 'incidencia')).map((r) => r.payload as Record<string, unknown>);
      expect(incidencias.filter((p) => p.tracking === 'GSG-CALLADO-1' && p.codigo === 'cambio_ubicacion')).toHaveLength(0);
      expect(await e.entrega('GSG-CALLADO-1')).toMatchObject({ ubicacionEstado: 'recibida', lat: fijo.lat });
      expect((await e.entrega('GSG-CALLADO-1'))!.estado).not.toBe('incidencia');
      // Es un texto fijo del negocio, no lo escribió la IA: queda marcado así en el hilo
      // (el chat no le pone el 🤖 y GSG lo ve con autor «sistema»).
      const contacto = (await e.repos.contacts.getByPhone(phone))!;
      const pide = (await e.repos.messages.listMessages(contacto.id, 50)).find((m) => m.direction === 'out' && m.body?.startsWith('Por favor, comparta su nueva ubicación'));
      expect(pide?.payload).toMatchObject({ origen: 'ia', textoFijo: true });
    } finally {
      await e.cerrar();
    }
  });

  it('«no soy yo» no recibe respuesta, pero el pedido pasa a incidencia y GSG se entera', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      const inicio = e.mensajesA(telefono).length;

      await e.contesta(telefono, { texto: 'Número equivocado, ese no es mi pedido' });
      expect(e.mensajesA(telefono)).toHaveLength(inicio);
      expect((await e.entrega('GSG-CALLADO-1'))!.incidencia).toBe('no_soy_yo');

      // GSG lo recibe por los números reportados (error «no_soy_yo»).
      const reportados = (e.repos.reportados as unknown as { _filas: Array<{ clave: string; error: string }> })._filas;
      expect(reportados.filter((f) => f.clave === 'GSG-CALLADO-1' && f.error === 'no_soy_yo')).toHaveLength(1);

      // Y no se le vuelve a escribir: ni recordatorios.
      e.avanzar(120);
      await e.trabajar();
      expect(e.mensajesA(telefono)).toHaveLength(inicio);
    } finally {
      await e.cerrar();
    }
  });

  it('«falta confirmar» no recibe la pregunta SÍ/NO: se le pide la ubicación como a todos', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', { ...pedido, faltaUbicacion: false, faltaConfirmar: true });
      await e.trabajar();
      expect(await e.entrega('GSG-CALLADO-1')).toMatchObject({ confirmacionEstado: 'no_hace_falta', ubicacionEstado: 'pendiente' });
      const textos = e.textosA(telefono);
      expect(textos).toHaveLength(1);
      expect(textos[0]).toMatch(/^¡Hola Rosa! Somos GSG Courier[\s\S]*ubicación/);
      expect(textos.join('\n')).not.toMatch(/SÍ o NO|confirmas que lo recibes/i);
      await e.contesta(telefono, { pin: fijo });
      expect(e.textosA(telefono).at(-1)).toMatch(/Ubicación registrada/);
      expect(e.textosA(telefono).at(-1)).not.toMatch(/SÍ o NO/);
    } finally {
      await e.cerrar();
    }
  });

  it('el cliente que vuelve otro día recibe el mensaje de siempre, no «¿la misma dirección?»', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { pin: fijo });
      e.avanzar(24 * 60);
      const antes = e.textosA(telefono).length;
      await e.api.post('/api/v1/entregas', { ...pedido, tracking: 'GSG-CALLADO-2' });
      await e.trabajar();
      const nuevos = e.textosA(telefono).slice(antes);
      expect(nuevos).toHaveLength(1);
      expect(nuevos[0]).toMatch(/^¡Hola Rosa! Somos GSG Courier[\s\S]*ubicación/);
      expect(nuevos[0]).not.toMatch(/misma dirección/i);
    } finally {
      await e.cerrar();
    }
  });

  it('un pedido nuevo el mismo día vuelve a pedir la ubicación, aunque ya la haya mandado', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { pin: fijo });
      e.avanzar(30);
      const antes = e.textosA(telefono).length;
      await e.api.post('/api/v1/entregas', { ...pedido, tracking: 'GSG-CALLADO-3' });
      await e.trabajar();
      expect((await e.entrega('GSG-CALLADO-3'))!.ubicacionEstado).toBe('pendiente');
      const nuevos = e.textosA(telefono).slice(antes);
      expect(nuevos).toHaveLength(1);
      expect(nuevos[0]).toMatch(/^¡Hola Rosa! Somos GSG Courier[\s\S]*GSG-CALLADO-3[\s\S]*ubicación/);
      await e.contesta(telefono, { pin: fijo });
      expect((await e.entrega('GSG-CALLADO-3'))!.ubicacionEstado).toBe('recibida');
      expect(e.textosA(telefono).at(-1)).toMatch(/Ubicación registrada/);
    } finally {
      await e.cerrar();
    }
  });

  it('mande la ubicación que mande se acepta: un pin en Cusco se registra y se agradece', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      const cusco = { lat: -13.5319, lng: -71.9675 };
      await e.contesta(telefono, { pin: cusco });
      expect(await e.entrega('GSG-CALLADO-1')).toMatchObject({ ubicacionEstado: 'recibida', lat: cusco.lat, lng: cusco.lng });
      expect((await e.entrega('GSG-CALLADO-1'))!.incidencia).not.toBe('ubicacion_fuera_de_zona');
      expect(e.textosA(telefono).at(-1)).toMatch(/Ubicación registrada/);
      await e.contesta(telefono, { enlace: `https://www.google.com/maps?q=${cusco.lat},${cusco.lng}` });
      expect((await e.entrega('GSG-CALLADO-1'))!.ubicacionEstado).toBe('recibida');
    } finally {
      await e.cerrar();
    }
  });

  it('la espera tras el último mensaje se ajusta en Automatización GSG antes de reportar «sin respuesta»', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      const r = await e.api.post('/admin/rutas/ajustes', { esperasMensajesMinutos: [5], esperaFinalMinutos: 40 });
      expect(r.status).toBe(200);
      expect((r.body as { vigente: { esperaFinalMinutos: number; maxIntentos: number } }).vigente).toMatchObject({ esperaFinalMinutos: 40, maxIntentos: 2 });
      const sinRespuesta = async () => (await e.repos.rutas.reportesRecientes(100, 'incidencia'))
        .map((x) => x.payload as Record<string, unknown>)
        .filter((p) => p.tracking === 'GSG-CALLADO-1' && p.codigo === 'sin_respuesta').length;

      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      e.avanzar(6);
      await e.trabajar();
      expect(e.mensajesA(telefono)).toHaveLength(2);
      e.avanzar(38);
      await e.trabajar();
      expect(await sinRespuesta()).toBe(0);
      e.avanzar(3);
      await e.trabajar();
      expect(await sinRespuesta()).toBe(1);
      expect(e.mensajesA(telefono)).toHaveLength(2);
    } finally {
      await e.cerrar();
    }
  });

  it('otra ubicación con la suya ya registrada, antes de la hora límite: es su cambio, se registra y se le confirma', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: MANANA });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { pin: fijo });
      const tras = e.mensajesA(telefono).length;
      const otro = { lat: -12.1211, lng: -77.0301 };
      await e.contesta(telefono, { pin: otro });
      expect(e.mensajesA(telefono)).toHaveLength(tras + 1);
      expect(String(e.mensajesA(telefono).at(-1)!.text ?? e.mensajesA(telefono).at(-1)!.body)).toMatch(/Su nueva ubicación se registró correctamente/);
      expect(await e.entrega('GSG-CALLADO-1')).toMatchObject({ ubicacionEstado: 'recibida', lat: otro.lat, lng: otro.lng, ubicacionCambios: 1, ubicacionAnteriorLat: fijo.lat });
      const incidencias = (await e.repos.rutas.reportesRecientes(100, 'incidencia')).map((r) => r.payload as Record<string, unknown>);
      expect(incidencias.filter((p) => p.tracking === 'GSG-CALLADO-1' && p.codigo === 'cambio_ubicacion')).toHaveLength(0);
    } finally {
      await e.cerrar();
    }
  });

  it('otra ubicación con la suya ya registrada, DESPUÉS de la hora límite: silencio, se quita la ubicación, queda en error y GSG recibe solo «cambio_ubicacion»', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: TARDE });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { pin: fijo });
      const tras = e.mensajesA(telefono).length;
      const otro = { lat: -12.1211, lng: -77.0301 };
      await e.contesta(telefono, { pin: otro });
      await e.contesta(telefono, { enlace: `https://www.google.com/maps?q=${otro.lat},${otro.lng}` });
      expect(e.mensajesA(telefono)).toHaveLength(tras);
      expect(await e.entrega('GSG-CALLADO-1')).toMatchObject({ estado: 'incidencia', incidencia: 'cambio_ubicacion', ubicacionEstado: 'pendiente', lat: null, lng: null, ubicacionAnteriorLat: fijo.lat });
      const incidencias = (await e.repos.rutas.reportesRecientes(100, 'incidencia')).map((r) => r.payload as Record<string, unknown>);
      expect(incidencias.filter((p) => p.tracking === 'GSG-CALLADO-1' && p.codigo === 'cambio_ubicacion')).toHaveLength(1);
      const ubicaciones = (await e.repos.rutas.reportesRecientes(100, 'ubicacion')).map((r) => r.payload as Record<string, unknown>);
      expect(ubicaciones.some((p) => p.lat === otro.lat)).toBe(false);
    } finally {
      await e.cerrar();
    }
  });

  it('dos pedidos esperando a la vez: un solo pin registra los dos y se agradece una vez', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.api.post('/api/v1/entregas', { ...pedido, tracking: 'GSG-CALLADO-4' });
      await e.trabajar();
      await e.trabajar();
      const antes = e.mensajesA(telefono).length;
      await e.contesta(telefono, { pin: fijo });
      expect((await e.entrega('GSG-CALLADO-1'))!.ubicacionEstado).toBe('recibida');
      expect((await e.entrega('GSG-CALLADO-4'))!.ubicacionEstado).toBe('recibida');
      const nuevos = e.textosA(telefono).slice(antes);
      expect(nuevos).toHaveLength(1);
      expect(nuevos[0]).toMatch(/Ubicación registrada/);
      expect(nuevos.join('\n')).not.toMatch(/Responde SÍ junto con el código/);
    } finally {
      await e.cerrar();
    }
  });

  it('si nunca manda su ubicación, al agotar los mensajes se le reporta a GSG', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      for (let i = 0; i < 20; i++) {
        await e.trabajar();
        e.avanzar(60);
      }
      await e.trabajar();
      const incidencias = (await e.repos.rutas.reportesRecientes(100, 'incidencia')).map((r) => r.payload as Record<string, unknown>);
      expect(incidencias.filter((p) => p.tracking === 'GSG-CALLADO-1' && p.codigo === 'sin_respuesta')).toHaveLength(1);
    } finally {
      await e.cerrar();
    }
  });

  it('después de «no soy yo» registrado (ubicación ya dada), tampoco contesta', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { pin: fijo });
      const tras = e.mensajesA(telefono).length;
      await e.contesta(telefono, { texto: 'yo no he pedido eso disculpa' });
      expect(e.mensajesA(telefono)).toHaveLength(tras);
      expect((await e.entrega('GSG-CALLADO-1'))!.incidencia).toBe('no_soy_yo');
      const reportados = (e.repos.reportados as unknown as { _filas: Array<{ clave: string; error: string }> })._filas;
      expect(reportados.filter((f) => f.clave === 'GSG-CALLADO-1' && f.error === 'no_soy_yo')).toHaveLength(1);
    } finally {
      await e.cerrar();
    }
  });
});
