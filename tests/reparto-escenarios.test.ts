/**
 * Escenarios de reparto contra la API, con WhatsApp y GSG mockeados.
 *
 * Aquí las preguntas son las de la operación, no las del código: cargada la
 * lista del día, ¿cuántos han dado ya su ubicación?, ¿qué números faltan y
 * por qué?, ¿le llegó todo a GSG?, ¿y si su API está caída? Cada respuesta se
 * pide a la API real, tal como la pediría GSG o la pantalla.
 *
 * Ver `escenario-reparto.ts` para lo que se finge y cómo.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import {
  clientesDePrueba,
  conPais,
  crearEscenario,
  GSG_TOKEN_FALSO,
  PAUSA_SEGUNDOS,
  PIN_FUERA,
  PIN_LIMA,
  type Escenario,
} from './escenario-reparto.js';

const ENLACE_MAPA_1 = 'https://www.google.com/maps/@-12.0464,-77.0428,15z';
const ENLACE_MAPA_2 = 'https://www.google.com/maps/place/Parque+Kennedy/data=!8m2!3d-12.1211!4d-77.0297';

/** Un pin distinto por cliente, todos dentro de Lima. */
const pinDe = (i: number) => ({ lat: PIN_LIMA.lat + i * 0.001, lng: PIN_LIMA.lng - i * 0.001 });

// =====================================================================
// 1. Un reparto grande: quién dio su ubicación y quién no
// =====================================================================

describe('un reparto de 22 clientes: quién dio su ubicación y quién no', () => {
  const SUPERVISOR = '51999000000';
  const clientes = [
    ...clientesDePrueba(20), // 987000001 .. 987000020
    { telefono: '98700001', nombre: 'Pedro Corto', referencia: 'P-1021' }, // le falta un dígito
    { telefono: '145678901', nombre: 'Oficina Fija', referencia: 'P-1022' }, // un fijo de Lima
  ];
  const tel = (i: number) => conPais(String(987000000 + i));

  // Lo que va a pasar con cada uno, para que las cifras de abajo se lean.
  const DAN_PIN = [1, 2, 3, 4, 5, 6];
  const DAN_ENLACE = [7, 8];
  const CONTESTAN_TEXTO = [9, 10, 11];
  const NO_SOY_YO = 12;
  const BAJA = 13;
  const FUERA_DE_ZONA = 14;
  const CALLADOS = [15, 16, 17, 18];
  const SIN_WHATSAPP_PROVEEDOR = 19;
  const SIN_WHATSAPP_META = 20;

  let e: Escenario;
  let loteId = '';

  beforeAll(async () => {
    e = await crearEscenario({
      supervisor: SUPERVISOR,
      sinWhatsApp: [tel(SIN_WHATSAPP_PROVEEDOR)],
      rechazos: {
        [tel(SIN_WHATSAPP_META)]: { code: 131026, message: '(#131026) Message Undeliverable' },
      },
    });
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('1. se carga la lista: nadie ha dado su ubicación y los números rotos ya están marcados', async () => {
    const { loteId: id, cuerpo } = await e.cargarLote('Reparto del martes', clientes, { externoId: 'GSG-2026-03-10' });
    loteId = id;

    expect(cuerpo).toMatchObject({ total: 22, listas: 20, conIncidencia: 2 });

    const faltan = await e.sinUbicacion(loteId);
    expect(faltan.total).toBe(22);
    expect(faltan.telefonos).toHaveLength(22);

    const lote = await e.cifrasLote(loteId);
    expect(lote).toMatchObject({ total: 22, conUbicacion: 0, sinUbicacion: 22 });
    expect(lote.incidencias).toEqual({ numero_corto: 1, numero_fijo: 1 });
  });

  it('2. el motor escribe a los 20 números válidos; dos resultan no tener WhatsApp', async () => {
    const hecho = await e.trabajar();

    expect(hecho.filter((h) => h.accion === 'envio')).toHaveLength(18);
    expect(hecho.filter((h) => h.accion === 'incidencia')).toHaveLength(2);
    expect(e.wa.sent.filter((m) => m.kind === 'location_request')).toHaveLength(18);

    const vistas = await e.vistas(loteId);
    expect(vistas).toMatchObject({
      todos: 22,
      resueltos: 0,
      sin_ubicacion: 22,
      esperando: 18,
      sin_whatsapp: 2,
      numero_malo: 2,
      requieren_persona: 4,
    });

    // Los dos sin WhatsApp: uno lo dijo el proveedor antes de escribir, el
    // otro lo dijo Meta al rechazar el envío. Ninguno recibió nada.
    expect(e.mensajesA(tel(SIN_WHATSAPP_PROVEEDOR))).toHaveLength(0);
    expect(e.mensajesA(tel(SIN_WHATSAPP_META))).toHaveLength(0);
    const sinWa = await e.solicitudes({ loteId, vista: 'sin_whatsapp' });
    expect(sinWa.items.map((s) => s.phone).sort()).toEqual([tel(SIN_WHATSAPP_PROVEEDOR), tel(SIN_WHATSAPP_META)]);
  });

  it('3. contestan: seis con el pin, dos con enlace, tres con texto, uno "no soy yo", uno BAJA, uno fuera de zona', async () => {
    for (const i of DAN_PIN) expect((await e.contesta(tel(i), { pin: pinDe(i) })).status).toBe(200);
    await e.contesta(tel(DAN_ENLACE[0]!), { enlace: ENLACE_MAPA_1 });
    await e.contesta(tel(DAN_ENLACE[1]!), { enlace: ENLACE_MAPA_2 });
    for (const i of CONTESTAN_TEXTO) await e.contesta(tel(i), { texto: `estoy por el mercado, casa ${i} de reja verde` });
    await e.contesta(tel(NO_SOY_YO), { noSoyYo: true });
    await e.contesta(tel(BAJA), { baja: true });
    await e.contesta(tel(FUERA_DE_ZONA), { pin: PIN_FUERA });

    // A quien manda su ubicación se le da las gracias; al equivocado se le pide disculpas.
    expect(e.mensajesA(tel(1)).at(-1)?.body).toMatch(/ubicaci[oó]n/i);
    expect(e.mensajesA(tel(NO_SOY_YO)).at(-1)?.body).toMatch(/no corresponde/i);
    expect(e.mensajesA(tel(BAJA)).at(-1)?.body).toMatch(/no volver/i);
  });

  it('4. la lista de quienes SÍ dieron su ubicación: los ocho, con sus coordenadas y su fuente', async () => {
    const { items, total } = await e.solicitudes({ loteId, vista: 'resueltos', limit: 100 });

    expect(total).toBe(8);
    expect(items.map((s) => s.phone).sort()).toEqual([...DAN_PIN, ...DAN_ENLACE].map(tel).sort());
    for (const s of items) {
      expect(s.estado).toBe('resuelto');
      expect(s.lat).toBeCloseTo(-12.1, 0);
      expect(s.lng).toBeCloseTo(-77.0, 0);
      expect(s.resueltoAt).toBeTruthy();
      expect(s.requiereHumano).toBe(false);
    }
    expect(items.filter((s) => s.ubicacionFuente === 'pin de whatsapp')).toHaveLength(6);
    expect(items.filter((s) => (s.ubicacionFuente ?? '').startsWith('enlace de mapa'))).toHaveLength(2);
  });

  it('5. la lista de quienes NO la dieron: catorce, cada uno con su motivo', async () => {
    const faltan = await e.sinUbicacion(loteId);

    expect(faltan.total).toBe(14);
    expect(faltan.telefonos).toHaveLength(14);
    // Los diez con número bueno que no la han dado...
    for (const i of [...CONTESTAN_TEXTO, NO_SOY_YO, BAJA, FUERA_DE_ZONA, ...CALLADOS, SIN_WHATSAPP_PROVEEDOR, SIN_WHATSAPP_META]) {
      expect(faltan.telefonos).toContain(tel(i));
    }
    // ...y los dos rotos, con el teléfono tal como vino en la lista.
    expect(faltan.telefonos).toContain('98700001');
    expect(faltan.telefonos.some((t) => t.endsWith('145678901'))).toBe(true);
    // Y ninguno de los que sí la dieron.
    for (const i of [...DAN_PIN, ...DAN_ENLACE]) expect(faltan.telefonos).not.toContain(tel(i));

    // El motivo de cada uno, en los términos de la pantalla.
    const motivo = (i: number) => faltan.items.find((s) => s.phone === tel(i))!;
    expect(motivo(CONTESTAN_TEXTO[0]!)).toMatchObject({ estado: 'respondio', incidencia: 'respondio_sin_ubicacion', requiereHumano: true });
    expect(motivo(CONTESTAN_TEXTO[0]!).incidenciaDetalle).toContain('mercado');
    expect(motivo(NO_SOY_YO)).toMatchObject({ estado: 'supervision', incidencia: 'numero_equivocado' });
    expect(motivo(BAJA)).toMatchObject({ estado: 'supervision', incidencia: 'rechaza_contacto' });
    expect(motivo(FUERA_DE_ZONA)).toMatchObject({ estado: 'supervision', incidencia: 'ubicacion_fuera_de_zona' });
    expect(motivo(CALLADOS[0]!)).toMatchObject({ estado: 'enviado', intentos: 1, incidencia: null });
    expect(motivo(SIN_WHATSAPP_PROVEEDOR)).toMatchObject({ estado: 'incidencia', incidencia: 'sin_whatsapp' });
    expect(motivo(SIN_WHATSAPP_META)).toMatchObject({ estado: 'incidencia', incidencia: 'sin_whatsapp' });

    // Las mismas cifras, ya sumadas, en el detalle del lote y en las tarjetas.
    expect(await e.cifrasLote(loteId)).toMatchObject({
      total: 22,
      conUbicacion: 8,
      sinUbicacion: 14,
      cifras: { resuelto: 8, respondio: 3, supervision: 3, enviado: 4, incidencia: 4 },
    });
    expect(await e.vistas(loteId)).toMatchObject({
      resueltos: 8,
      sin_ubicacion: 14,
      respondieron: 3,
      supervision: 3,
      esperando: 4,
      sin_whatsapp: 2,
      numero_malo: 2,
      requieren_persona: 10,
    });
  });

  it('6. GSG recibe el avance a mitad de mañana y el coordinador su aviso por WhatsApp', async () => {
    const alertas = await e.revisarAlertas();
    expect(alertas).toMatchObject({ resumenes: 1, avisos: 1 });

    const aviso = e.mensajesA(SUPERVISOR).at(-1)?.body as string;
    expect(aviso).toContain('8 de 22 con ubicación');
    expect(aviso).toContain('4 sin contestar');
    expect(aviso).toMatch(/10 casos necesitan/);

    // El avance se encoló para GSG con las cifras ya contestadas.
    const despacho = await e.despacharAGsg();
    expect(despacho.enviados).toBeGreaterThan(0);
    expect(despacho.fallidos).toBe(0);
    const [resumen] = e.gsg.resumenes();
    expect(resumen).toMatchObject({
      enCurso: true,
      total: 22,
      conUbicacion: 8,
      contestaron: 14,
      sinContestar: 4,
      sinEscribir: 0,
      necesitanPersona: 10,
      lote: { externoId: 'GSG-2026-03-10' },
    });
    // Y las ocho ubicaciones ya están del otro lado, con su teléfono y su pedido.
    expect(e.gsg.telefonosConUbicacion().sort()).toEqual([...DAN_PIN, ...DAN_ENLACE].map(tel).sort());
    expect(e.gsg.ubicaciones().map((u) => u.referencia).sort()).toEqual(
      [...DAN_PIN, ...DAN_ENLACE].map((i) => `P-${1000 + i}`).sort(),
    );
    expect(e.gsg.recibido.every((r) => r.token === GSG_TOKEN_FALSO)).toBe(true);
  });

  it('7. se insiste a los siete que no han dado nada; uno de los callados manda el pin al segundo mensaje', async () => {
    const hecho = await e.insistir();

    // Los cuatro callados (recordatorio) y los tres que contestaron texto (insistencia).
    expect(hecho.filter((h) => h.accion === 'envio')).toHaveLength(7);
    expect(hecho.filter((h) => h.paso === 'recordatorio')).toHaveLength(4);
    expect(hecho.filter((h) => h.paso === 'insistencia')).toHaveLength(3);

    // A "no soy yo", a la BAJA y al de fuera de zona no se les vuelve a escribir.
    expect(e.mensajesA(tel(NO_SOY_YO))).toHaveLength(2);
    expect(e.mensajesA(tel(BAJA))).toHaveLength(2);
    expect(e.mensajesA(tel(FUERA_DE_ZONA))).toHaveLength(2);

    await e.contesta(tel(CALLADOS[0]!), { pin: pinDe(CALLADOS[0]!) });

    expect(await e.cifrasLote(loteId)).toMatchObject({ conUbicacion: 9, sinUbicacion: 13 });
    expect((await e.sinUbicacion(loteId)).telefonos).not.toContain(tel(CALLADOS[0]!));
  });

  it('8. tras tres mensajes sin ubicación, los seis restantes pasan al repartidor y el lote se cierra', async () => {
    await e.insistir();
    const ultima = await e.insistir();

    expect(ultima.filter((h) => h.accion === 'derivacion')).toHaveLength(6);
    expect(ultima.some((h) => h.lotesCerrados?.includes(loteId))).toBe(true);

    const vistas = await e.vistas(loteId);
    expect(vistas).toMatchObject({
      resueltos: 9,
      sin_ubicacion: 13,
      derivados: 6,
      esperando: 0,
      respondieron: 0,
      requieren_persona: 13,
    });

    const derivados = await e.solicitudes({ loteId, vista: 'derivados' });
    const callado = derivados.items.find((s) => s.phone === tel(CALLADOS[1]!))!;
    expect(callado).toMatchObject({ estado: 'derivado', intentos: 3, incidencia: 'sin_respuesta' });
    const conTexto = derivados.items.find((s) => s.phone === tel(CONTESTAN_TEXTO[0]!))!;
    expect(conTexto).toMatchObject({ estado: 'derivado', incidencia: 'respondio_sin_ubicacion' });
    // Al que contestó se le despide explicando que lo llamarán; al callado no.
    expect(e.mensajesA(tel(CONTESTAN_TEXTO[0]!)).length).toBeGreaterThan(e.mensajesA(tel(CALLADOS[1]!)).length);

    const lote = await e.cifrasLote(loteId);
    expect(lote.lote.estado).toBe('terminado');
  });

  it('9. una ubicación que llega tarde (ya derivado) también cuenta: la lista de faltantes baja', async () => {
    const tarde = CALLADOS[1]!;
    await e.contesta(tel(tarde), { pin: pinDe(tarde) });

    const { items } = await e.solicitudes({ loteId, vista: 'resueltos', q: String(987000000 + tarde) });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ estado: 'resuelto', requiereHumano: false });

    const ficha = await e.api.get<{ eventos: Array<{ tipo: string; detalle: string | null }> }>(`/admin/rutas/solicitudes/${items[0]!.id}`);
    expect(ficha.body.eventos.some((ev) => ev.tipo === 'ubicacion' && /después de pasar al repartidor/.test(ev.detalle ?? ''))).toBe(true);

    expect(await e.cifrasLote(loteId)).toMatchObject({ conUbicacion: 10, sinUbicacion: 12 });
  });

  it('10. lo que consigue una persona por teléfono se carga a mano y sale de la lista de faltantes', async () => {
    const porTelefono = CALLADOS[2]!;
    const [caso] = await e.buscar(String(987000000 + porTelefono), loteId);
    const res = await e.api.post(`/admin/rutas/solicitudes/${caso!.id}/resolver`, {
      lat: -12.09,
      lng: -77.03,
      nota: 'la dio por teléfono al repartidor',
    });
    expect(res.status).toBe(200);

    const faltan = await e.sinUbicacion(loteId);
    expect(faltan.total).toBe(11);
    expect(faltan.telefonos).not.toContain(tel(porTelefono));
    expect(await e.cifrasLote(loteId)).toMatchObject({ conUbicacion: 11, sinUbicacion: 11 });
  });

  it('11. corregir el número corto lo devuelve a la cola: sigue sin ubicación, pero ya no es "número malo"', async () => {
    // Por el pedido, no por el teléfono: "98700001" está dentro de "987000010".
    const [roto] = await e.buscar('P-1021', loteId);
    expect(roto).toMatchObject({ telefonoCrudo: '98700001', incidencia: 'numero_corto' });

    const res = await e.api.patch(`/admin/rutas/solicitudes/${roto!.id}`, { telefono: '987000021' });
    expect(res.status).toBe(200);

    const vistas = await e.vistas(loteId);
    expect(vistas).toMatchObject({ numero_malo: 1, pendientes: 1, sin_ubicacion: 11 });
    expect((await e.sinUbicacion(loteId)).telefonos).toContain('51987000021');
  });

  it('12. al final GSG tiene las once ubicaciones, cada incidencia con su código y el cierre del lote', async () => {
    const despacho = await e.despacharAGsg();
    expect(despacho.fallidos).toBe(0);

    const cola = await e.api.get<{ conectado: boolean; cifras: Record<string, number> }>('/admin/rutas/cola');
    expect(cola.body.conectado).toBe(true);
    expect(cola.body.cifras.pendiente ?? 0).toBe(0);
    expect(cola.body.cifras.fallido ?? 0).toBe(0);

    const conUbicacion = await e.solicitudes({ loteId, vista: 'resueltos', limit: 100 });
    expect(e.gsg.telefonosConUbicacion().sort()).toEqual(conUbicacion.items.map((s) => s.phone).sort());
    expect(e.gsg.ubicaciones()).toHaveLength(11);
    expect(e.gsg.ubicaciones().find((u) => u.telefono === tel(CALLADOS[2]!))).toMatchObject({ fuente: 'cargada a mano' });

    const codigos = e.gsg.incidencias().map((i) => i.codigo);
    expect(codigos).toContain('numero_corto');
    expect(codigos).toContain('numero_fijo');
    expect(codigos.filter((c) => c === 'sin_whatsapp')).toHaveLength(2);
    expect(codigos).toContain('numero_equivocado');
    expect(codigos).toContain('rechaza_contacto');
    expect(codigos).toContain('ubicacion_fuera_de_zona');
    expect(codigos.filter((c) => c === 'sin_respuesta')).toHaveLength(3);
    expect(codigos.filter((c) => c === 'respondio_sin_ubicacion')).toHaveLength(3);
    // Cada incidencia lleva qué hacer, para que del otro lado no tengan que adivinar.
    expect(e.gsg.incidencias().every((i) => typeof i.queHacer === 'string' && (i.queHacer as string).length > 0)).toBe(true);

    // El resumen del cierre: el lote entero, por estado.
    const cierre = e.gsg.resumenes().find((r) => !r.enCurso)!;
    expect(cierre).toMatchObject({ total: 22, porEstado: { resuelto: 9, derivado: 6, supervision: 3, incidencia: 4 } });

    // Y el CSV que se lleva GSG a mano dice lo mismo que la API.
    const csv = await e.app.inject({ method: 'GET', url: `/admin/rutas/lotes/${loteId}.csv`, headers: e.auth });
    const lineas = csv.body.trim().split('\r\n');
    expect(lineas).toHaveLength(23);
    expect(lineas.filter((l) => l.includes(';resuelto;'))).toHaveLength(11);
  });

  it('13. la lista global (sin filtrar por lote) coincide con la del lote, porque es el único', async () => {
    const global = await e.sinUbicacion();
    const delLote = await e.sinUbicacion(loteId);
    expect(global.total).toBe(delLote.total);
    expect(global.telefonos.sort()).toEqual(delLote.telefonos.sort());
  });
});

// =====================================================================
// 2. Dos lotes a la vez: las cifras no se mezclan
// =====================================================================

describe('dos lotes el mismo día: cada uno con su lista de faltantes', () => {
  let e: Escenario;
  let loteA = '';
  let loteB = '';
  const A = clientesDePrueba(5, 987200001).map((c, i) => ({ ...c, referencia: `A-${i + 1}` }));
  // El tercero de A se repite en B: no se le escribe dos veces por lo mismo.
  const B = [
    { telefono: '987200003', nombre: 'Repetido', referencia: 'B-1' },
    ...clientesDePrueba(3, 987200006).map((c, i) => ({ ...c, referencia: `B-${i + 2}` })),
  ];

  beforeAll(async () => {
    e = await crearEscenario();
    loteA = (await e.cargarLote('Lote A', A)).loteId;
    loteB = (await e.cargarLote('Lote B', B)).loteId;
    await e.trabajar();
    await e.contesta('987200001', { pin: pinDe(1) });
    await e.contesta('987200002', { pin: pinDe(2) });
    await e.contesta('987200006', { pin: pinDe(6) });
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('se escribe una vez a cada número; el repetido queda como "ya en curso" en el segundo lote', async () => {
    expect(e.wa.sent.filter((m) => m.kind === 'location_request')).toHaveLength(8);
    const [repetido] = await e.buscar('987200003', loteB);
    expect(repetido).toMatchObject({ estado: 'incidencia', incidencia: 'ya_en_curso' });
    expect(repetido!.incidenciaDetalle).toContain('A-3');
  });

  it('las cifras de cada lote son las suyas', async () => {
    expect(await e.cifrasLote(loteA)).toMatchObject({ total: 5, conUbicacion: 2, sinUbicacion: 3 });
    expect(await e.cifrasLote(loteB)).toMatchObject({ total: 4, conUbicacion: 1, sinUbicacion: 3 });

    expect((await e.sinUbicacion(loteA)).telefonos.sort()).toEqual(['51987200003', '51987200004', '51987200005']);
    expect((await e.sinUbicacion(loteB)).telefonos.sort()).toEqual(['51987200003', '51987200007', '51987200008']);

    expect(await e.vistas(loteA)).toMatchObject({ resueltos: 2, sin_ubicacion: 3, esperando: 3, todos: 5 });
    expect(await e.vistas(loteB)).toMatchObject({ resueltos: 1, sin_ubicacion: 3, esperando: 2, requieren_persona: 1, todos: 4 });
  });

  it('sin filtro, la API suma los dos lotes', async () => {
    expect(await e.vistas()).toMatchObject({ resueltos: 3, sin_ubicacion: 6, todos: 9 });
    expect((await e.sinUbicacion()).total).toBe(6);

    const resumen = await e.api.get<{ lotes: Array<{ id: string; total: number; cifras: Record<string, number> }> }>('/admin/rutas');
    const a = resumen.body.lotes.find((l) => l.id === loteA)!;
    const b = resumen.body.lotes.find((l) => l.id === loteB)!;
    expect(a).toMatchObject({ total: 5, cifras: { resuelto: 2, enviado: 3 } });
    expect(b).toMatchObject({ total: 4, cifras: { resuelto: 1, enviado: 2, incidencia: 1 } });
  });

  it('un número se busca por teléfono, por pedido o por nombre, y su ficha trae la bitácora', async () => {
    expect(await e.buscar('987200003')).toHaveLength(2); // está en los dos lotes
    expect(await e.buscar('B-2')).toHaveLength(1);
    expect((await e.buscar('Cliente 2', loteA))[0]).toMatchObject({ phone: '51987200002', estado: 'resuelto' });

    const [resuelta] = await e.buscar('987200001');
    const ficha = await e.api.get<{
      solicitud: { estado: string };
      lote: { id: string };
      eventos: Array<{ tipo: string }>;
      incidencia: unknown;
    }>(`/admin/rutas/solicitudes/${resuelta!.id}`);
    expect(ficha.body.solicitud.estado).toBe('resuelto');
    expect(ficha.body.lote.id).toBe(loteA);
    expect(ficha.body.eventos.map((ev) => ev.tipo)).toEqual(expect.arrayContaining(['envio', 'ubicacion']));
    expect(ficha.body.incidencia).toBeNull();
  });

  it('la lista del lote se pagina sin perder a nadie', async () => {
    const pagina1 = await e.solicitudes({ loteId: loteA, vista: 'sin_ubicacion', limit: 2, offset: 0 });
    const pagina2 = await e.solicitudes({ loteId: loteA, vista: 'sin_ubicacion', limit: 2, offset: 2 });
    expect(pagina1.total).toBe(3);
    expect(pagina1.items).toHaveLength(2);
    expect(pagina2.items).toHaveLength(1);
    const vistos = [...pagina1.items, ...pagina2.items].map((s) => s.phone).sort();
    expect(vistos).toEqual(['51987200003', '51987200004', '51987200005']);
  });
});

// =====================================================================
// 3. Una lista larga: 120 clientes, la mitad da su ubicación
// =====================================================================

describe('una lista larga de 120 clientes', () => {
  let e: Escenario;
  let loteId = '';
  const clientes = clientesDePrueba(120, 987300001);
  const DAN = clientes.filter((_, i) => i % 2 === 0); // los pares
  const NO_DAN = clientes.filter((_, i) => i % 2 === 1);

  beforeAll(async () => {
    e = await crearEscenario();
    loteId = (await e.cargarLote('Lote largo', clientes)).loteId;
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('recién cargada, los 120 están sin ubicación y la paginación los recorre enteros', async () => {
    expect(await e.cifrasLote(loteId)).toMatchObject({ total: 120, conUbicacion: 0, sinUbicacion: 120 });

    const vistos = new Set<string>();
    for (let offset = 0; offset < 120; offset += 25) {
      const pagina = await e.solicitudes({ loteId, vista: 'sin_ubicacion', limit: 25, offset });
      expect(pagina.total).toBe(120);
      for (const s of pagina.items) vistos.add(s.phone!);
    }
    expect(vistos.size).toBe(120);
  });

  it('el motor escribe a los 120 de uno en uno, respetando la pausa entre mensajes', async () => {
    const hecho = await e.trabajar({ maxPasadas: 1000 });
    expect(hecho.filter((h) => h.accion === 'envio')).toHaveLength(120);
    // Entre mensaje y mensaje pasó la pausa: 120 envíos no salen en un segundo.
    expect(e.ahora().getTime() - e.inicio.getTime()).toBeGreaterThanOrEqual(119 * PAUSA_SEGUNDOS * 1000);
    expect(await e.vistas(loteId)).toMatchObject({ esperando: 120, sin_ubicacion: 120 });
    // Y a nadie se le escribió dos veces.
    const destinos = e.wa.sent.filter((m) => m.kind === 'location_request').map((m) => m.to);
    expect(new Set(destinos).size).toBe(120);
  });

  it('60 mandan su pin: la lista de faltantes son exactamente los otros 60', async () => {
    for (const [i, c] of DAN.entries()) await e.contesta(c.telefono, { pin: pinDe(i) });

    const lote = await e.cifrasLote(loteId);
    expect(lote).toMatchObject({ conUbicacion: 60, sinUbicacion: 60 });

    const faltan = await e.sinUbicacion(loteId);
    expect(faltan.telefonos.sort()).toEqual(NO_DAN.map((c) => conPais(c.telefono)).sort());

    const tienen = await e.solicitudes({ loteId, vista: 'resueltos', limit: 500 });
    expect(tienen.items.map((s) => s.phone).sort()).toEqual(DAN.map((c) => conPais(c.telefono)).sort());
    // Sin solapes ni huecos entre las dos listas.
    const union = new Set([...faltan.telefonos, ...tienen.items.map((s) => s.phone!)]);
    expect(union.size).toBe(120);
  });

  it('GSG recibe las 60 ubicaciones de una sola pasada, y ninguna incidencia: a los otros 60 solo se les ha escrito una vez', async () => {
    const primera = await e.despacharAGsg();
    expect(primera.enviados).toBe(60);
    expect(e.gsg.ubicaciones()).toHaveLength(60);
    expect(e.gsg.telefonosConUbicacion().sort()).toEqual(DAN.map((c) => conPais(c.telefono)).sort());
    expect(e.gsg.incidencias()).toHaveLength(0);
    expect((await e.api.get<{ cifras: Record<string, number> }>('/admin/rutas/cola')).body.cifras.pendiente ?? 0).toBe(0);
  });

  it('tras tres vueltas de insistencia, los 60 que nunca contestaron pasan al repartidor y GSG recibe sus 60 incidencias', async () => {
    await e.insistir();
    await e.insistir();
    const ultima = await e.insistir();
    expect(ultima.filter((h) => h.accion === 'derivacion')).toHaveLength(60);

    expect(await e.vistas(loteId)).toMatchObject({ resueltos: 60, derivados: 60, sin_ubicacion: 60, esperando: 0 });
    const faltan = await e.sinUbicacion(loteId);
    expect(faltan.items.every((s) => s.estado === 'derivado' && s.intentos === 3 && s.incidencia === 'sin_respuesta')).toBe(true);
    // Cada callado recibió exactamente tres mensajes; cada uno con pin, uno más las gracias.
    for (const c of NO_DAN) expect(e.mensajesA(c.telefono)).toHaveLength(3);
    for (const c of DAN) expect(e.mensajesA(c.telefono)).toHaveLength(2);

    await e.despacharAGsg();
    expect(e.gsg.incidencias()).toHaveLength(60);
    expect(e.gsg.incidencias().map((i) => i.telefono).sort()).toEqual(NO_DAN.map((c) => conPais(c.telefono)).sort());
    expect(e.gsg.resumenes().at(-1)).toMatchObject({ total: 120, porEstado: { resuelto: 60, derivado: 60 } });
  });
});

// =====================================================================
// 4. La API de GSG se cae, rechaza o no existe
// =====================================================================

describe('cuando la API de GSG falla', () => {
  let e: Escenario;

  beforeAll(async () => {
    e = await crearEscenario();
    await e.cargarLote('Lote con GSG caída', clientesDePrueba(4, 987400001));
    await e.trabajar();
    await e.contesta('987400001', { pin: pinDe(1) });
    await e.contesta('987400002', { pin: pinDe(2) });
    await e.contesta('987400003', { pin: pinDe(3) });
  });

  afterAll(async () => {
    await e.cerrar();
  });

  const pendientes = async () => (await e.api.get<{ cifras: Record<string, number> }>('/admin/rutas/cola')).body.cifras;

  it('caída (502): nada se pierde, todo se queda pendiente para la siguiente pasada', async () => {
    e.gsg.modo = 'caido';
    const salida = await e.despacharAGsg();
    expect(salida).toMatchObject({ intentados: 3, enviados: 0, fallidos: 0 });
    expect(await pendientes()).toMatchObject({ pendiente: 3 });
    expect(e.gsg.recibido).toHaveLength(0);
    expect(e.gsg.llamadas).toBe(3);
  });

  it('sin red: igual, se reintenta después', async () => {
    e.gsg.modo = 'sin_red';
    const salida = await e.despacharAGsg();
    expect(salida).toMatchObject({ intentados: 3, enviados: 0, fallidos: 0 });
    expect(await pendientes()).toMatchObject({ pendiente: 3 });
  });

  it('cuando vuelve, sale todo lo acumulado y cada reporte guarda el id que devolvió GSG', async () => {
    e.gsg.modo = 'ok';
    const salida = await e.despacharAGsg();
    expect(salida).toMatchObject({ intentados: 3, enviados: 3, fallidos: 0 });
    expect(await pendientes()).toMatchObject({ pendiente: 0, enviado: 3 });
    expect(e.gsg.telefonosConUbicacion().sort()).toEqual(['51987400001', '51987400002', '51987400003']);
    expect(e.repos.rutas._reportes.map((r) => r.externoId).sort()).toEqual(['GSG-UBICACION-1', 'GSG-UBICACION-2', 'GSG-UBICACION-3']);
  });

  it('un rechazo del payload (422) se marca fallido y no se reintenta en bucle', async () => {
    await e.contesta('987400004', { noSoyYo: true });
    expect(await pendientes()).toMatchObject({ pendiente: 1 });

    e.gsg.modo = 'rechaza';
    expect(await e.despacharAGsg()).toMatchObject({ intentados: 1, enviados: 0, fallidos: 1 });
    expect(await pendientes()).toMatchObject({ pendiente: 0, fallido: 1 });
    const fallido = e.repos.rutas._reportes.find((r) => r.estado === 'fallido')!;
    expect(fallido.ultimoError).toMatch(/422/);

    e.gsg.modo = 'ok';
    expect(await e.despacharAGsg()).toMatchObject({ intentados: 0 });
    expect(e.gsg.incidencias()).toHaveLength(0);
  });
});

describe('mientras GSG no tiene API', () => {
  let e: Escenario;

  beforeAll(async () => {
    e = await crearEscenario({ gsgConectado: false });
    await e.cargarLote('Sin API', clientesDePrueba(2, 987500001));
    await e.trabajar();
    await e.contesta('987500001', { pin: pinDe(1) });
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('la cola se llena, no se llama a nadie, y se puede bajar a mano', async () => {
    const estado = await e.api.get<{ gsg: { conectado: boolean; descripcion: string } }>('/admin/rutas');
    expect(estado.body.gsg.conectado).toBe(false);
    expect(estado.body.gsg.descripcion).toMatch(/GSG_URL/);

    const despacho = await e.despacharAGsg();
    expect(despacho).toMatchObject({ enviados: 0, intentados: 0 });
    expect(despacho.motivo).toMatch(/GSG_URL/);
    expect(e.gsg.llamadas).toBe(0);

    const cola = await e.api.get<{ cifras: Record<string, number> }>('/admin/rutas/cola');
    expect(cola.body.cifras.pendiente).toBe(1);

    const fichero = await e.app.inject({ method: 'GET', url: '/admin/rutas/cola.ndjson', headers: e.auth });
    expect(fichero.body).toContain('51987500001');
    expect(JSON.parse(fichero.body.trim().split('\n')[0]!)).toMatchObject({ tipo: 'ubicacion', referencia: 'P-1001' });
  });
});

// =====================================================================
// 5. Lo que dice Meta al enviar: pasajero o definitivo
// =====================================================================

describe('los rechazos de Meta al enviar', () => {
  let e: Escenario;
  let loteId = '';
  const rechazos = {
    '51987600002': { code: 130429, message: '(#130429) Rate limit hit', retryable: true },
    '51987600003': { code: 131021, message: '(#131021) Recipient phone number not valid' },
  };

  beforeAll(async () => {
    e = await crearEscenario({ rechazos });
    loteId = (await e.cargarLote('Con rechazos', clientesDePrueba(4, 987600001))).loteId;
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('un rate limit no gasta intento: se vuelve en tres minutos; un número inválido se aparta', async () => {
    await e.trabajar();

    const vistas = await e.vistas(loteId);
    expect(vistas).toMatchObject({ esperando: 2, pendientes: 1, sin_ubicacion: 4, requieren_persona: 1 });

    const [limitado] = await e.buscar('987600002');
    expect(limitado).toMatchObject({ estado: 'pendiente', intentos: 0, incidencia: 'error_envio' });
    const [invalido] = await e.buscar('987600003');
    expect(invalido).toMatchObject({ estado: 'incidencia', incidencia: 'numero_invalido', requiereHumano: true });

    // Meta deja de limitar: al pasar los tres minutos, sale.
    delete (rechazos as Record<string, unknown>)['51987600002'];
    e.avanzar(4);
    const hecho = await e.trabajar();
    expect(hecho.filter((h) => h.accion === 'envio')).toHaveLength(1);
    expect((await e.buscar('987600002'))[0]).toMatchObject({ estado: 'enviado', intentos: 1, incidencia: null });
    expect(await e.vistas(loteId)).toMatchObject({ esperando: 3, pendientes: 0, sin_ubicacion: 4 });
  });

  it('el número inválido va a GSG con su código y qué hacer', async () => {
    await e.despacharAGsg();
    const [inc] = e.gsg.incidencias();
    expect(inc).toMatchObject({ codigo: 'numero_invalido', telefono: '51987600003', requiereHumano: true });
    expect(inc!.queHacer).toMatch(/./);
  });
});

// =====================================================================
// 6. Fuera de horario no sale nada, y a la mañana siguiente sí
// =====================================================================

describe('fuera del horario de envío', () => {
  let e: Escenario;
  let loteId = '';

  beforeAll(async () => {
    // Las 21:00 de Lima, con el horario de producción (9 a 19).
    e = await crearEscenario({ arranque: new Date('2026-03-11T02:00:00Z'), horario: [9, 19] });
    loteId = (await e.cargarLote('Cargado de noche', clientesDePrueba(3, 987700001))).loteId;
  });

  afterAll(async () => {
    await e.cerrar();
  });

  it('de noche el lote se queda cargado y sin escribir a nadie', async () => {
    expect(await e.trabajar()).toHaveLength(0);
    expect((await e.motor.tick()).motivo).toMatch(/fuera del horario/);
    expect(e.wa.sent).toHaveLength(0);
    expect(await e.vistas(loteId)).toMatchObject({ pendientes: 3, sin_ubicacion: 3, esperando: 0 });
  });

  it('a las 9 de la mañana empieza solo', async () => {
    e.avanzar(12 * 60); // 09:00 de Lima
    const hecho = await e.trabajar();
    expect(hecho.filter((h) => h.accion === 'envio')).toHaveLength(3);
    expect(await e.vistas(loteId)).toMatchObject({ pendientes: 0, esperando: 3, sin_ubicacion: 3 });
    expect(OPCIONES_POR_DEFECTO.horaInicio).toBe(9);
  });
});
