/**
 * API del modulo de rutas: cargar el trabajo del dia, verlo avanzar y
 * resolver a mano lo que el bot no puede.
 *
 * La pantalla /rutas se apoya entera en esto, y tambien es por donde entrara
 * GSG cuando tenga con que: `POST /admin/rutas/lotes` acepta ya las filas en
 * JSON, no solo el CSV pegado.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Repos } from '../db/repos.js';
import {
  ESTADOS_SIN_UBICACION,
  ESTADOS_SOLICITUD,
  type ConsultaSolicitudes,
  type EstadoSolicitud,
  type Solicitud,
} from '../db/rutas.js';
import { CODIGOS, INCIDENCIAS, type CodigoIncidencia } from '../rutas/incidencias.js';
import {
  despacharReportes,
  exportarCola,
  payloadIncidencia,
  payloadUbicacion,
  type PuertoGsg,
} from '../rutas/gsg.js';
import { extractLocation } from '../geo/extract.js';
import { leerLote, prepararFilas, type FilaLote } from '../rutas/lote.js';
import { PLANES, revisarTelefono } from '../rutas/telefono.js';
import { enHorario, type OpcionesMotor } from '../rutas/motor.js';
import type { ServicioEnvioAutomatico } from '../envio-automatico/servicio.js';
import { ajustesPorDefecto, ajustesSchema, aplicarAjustes, PASOS } from '../rutas/ajustes.js';
import { PLANTILLAS, textoLibre, type PasoUbicacion } from '../rutas/mensajes.js';
import type { Monitor } from '../salud/monitor.js';

export interface RutasRoutesDeps {
  repos: Repos;
  config: Config;
  gsg: PuertoGsg;
  opciones: OpcionesMotor;
  /** El monitor de salud: la pantalla dice si el numero esta frenado y por que. */
  salud?: Monitor;
  /** A quien se avisa ahora mismo (se cambia desde la pantalla). */
  supervisor?: () => string;
  /** Si el reparto manda plantillas de Meta (API oficial) o texto libre (QR/WAHA). */
  usaPlantillas?: () => boolean;
  /** Si el mensaje puede llevar el boton nativo de ubicacion. */
  conBoton?: () => boolean;
  /** Como se llama el negocio ahora mismo. */
  nombreNegocio?: () => string;
  /** La lista de envio automatico: un numero que entra en un lote sale de ella (el reparto se lo queda). */
  lista?: ServicioEnvioAutomatico;
}

const filaSchema = z.object({
  telefono: z.string().min(1),
  nombre: z.string().max(200).optional(),
  referencia: z.string().max(120).optional(),
  direccion: z.string().max(300).optional(),
  distrito: z.string().max(120).optional(),
  notas: z.string().max(500).optional(),
});

const nuevoLoteSchema = z.object({
  nombre: z.string().min(1).max(160).optional(),
  /** La tabla pegada o el contenido del CSV. */
  texto: z.string().max(2_000_000).optional(),
  /** Las filas ya estructuradas: por aqui entrara GSG. */
  filas: z.array(filaSchema).max(5000).optional(),
  notas: z.string().max(500).optional(),
  externoId: z.string().max(120).optional(),
  /** Arrancar el envio nada mas cargarlo. */
  arrancar: z.boolean().default(false),
});

/**
 * Las vistas de la bandeja, tal como las pide la operacion.
 *
 * No son estados internos: son las preguntas que se hace quien mira la
 * pantalla. "Numero mal escrito" son cuatro codigos distintos y a nadie le
 * importa cual de los cuatro cuando esta corrigiendo la lista.
 */
const VISTAS: Record<string, Partial<ConsultaSolicitudes>> = {
  todos: {},
  resueltos: { estado: 'resuelto' },
  // La contraria de "con ubicacion": lo que GSG pregunta cada manana. No es
  // un estado, son todos los que faltan, sea cual sea el motivo.
  sin_ubicacion: { estados: ESTADOS_SIN_UBICACION },
  esperando: { estado: 'enviado' },
  respondieron: { estado: 'respondio' },
  pendientes: { estado: 'pendiente' },
  sin_whatsapp: { incidencia: 'sin_whatsapp' },
  numero_malo: { incidencias: ['numero_corto', 'numero_largo', 'numero_invalido', 'numero_fijo'] },
  derivados: { estado: 'derivado' },
  supervision: { estado: 'supervision' },
  requieren_persona: { requiereHumano: true },
};

export const NOMBRES_VISTA: Record<keyof typeof VISTAS | string, string> = {
  todos: 'Todos',
  resueltos: 'Con ubicación',
  sin_ubicacion: 'Sin ubicación todavía',
  esperando: 'Escritos, sin respuesta',
  respondieron: 'Contestaron sin ubicación',
  pendientes: 'Sin escribir todavía',
  sin_whatsapp: 'Sin WhatsApp',
  numero_malo: 'Número mal escrito',
  derivados: 'Para el repartidor',
  supervision: 'Necesitan revisión',
  requieren_persona: 'Esperan a una persona',
};

const listaSchema = z.object({
  loteId: z.string().optional(),
  vista: z.string().optional(),
  estado: z.enum(ESTADOS_SOLICITUD as [EstadoSolicitud, ...EstadoSolicitud[]]).optional(),
  incidencia: z.enum(CODIGOS as [CodigoIncidencia, ...CodigoIncidencia[]]).optional(),
  requiereHumano: z.coerce.boolean().optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/** Las columnas del CSV que se lleva GSG mientras no haya API. */
const COLUMNAS: Array<[string, (s: Solicitud) => unknown]> = [
  ['referencia', (s) => s.referencia],
  ['telefono', (s) => s.phone ?? s.telefonoCrudo],
  ['telefono_original', (s) => s.telefonoCrudo],
  ['nombre', (s) => s.nombre],
  ['estado', (s) => s.estado],
  ['lat', (s) => s.lat],
  ['lng', (s) => s.lng],
  ['maps', (s) => s.mapsUrl],
  ['incidencia', (s) => s.incidencia],
  ['detalle', (s) => s.incidenciaDetalle],
  ['intentos', (s) => s.intentos],
  ['requiere_persona', (s) => (s.requiereHumano ? 'si' : 'no')],
  ['ultimo_envio', (s) => s.ultimoEnvioAt?.toISOString() ?? ''],
  ['resuelto', (s) => s.resueltoAt?.toISOString() ?? ''],
];

function celda(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function aCsv(solicitudes: Solicitud[]): string {
  const cabecera = COLUMNAS.map(([nombre]) => nombre).join(';');
  const filas = solicitudes.map((s) => COLUMNAS.map(([, leer]) => celda(leer(s))).join(';'));
  return `﻿${[cabecera, ...filas].join('\r\n')}\r\n`;
}

export async function registerRutasRoutes(
  app: FastifyInstance,
  deps: RutasRoutesDeps,
): Promise<void> {
  const { repos, config, gsg, opciones } = deps;
  const plan = PLANES[config.RUTAS_PAIS] ?? PLANES.peru!;

  /** El estado de todo, que es lo primero que pinta la pantalla. */
  app.get('/admin/rutas', async () => {
    const [lotes, cifras, incidencias, cola] = await Promise.all([
      repos.rutas.listarLotes(50, 0),
      repos.rutas.cifrasPorEstado(),
      repos.rutas.cifrasPorIncidencia(),
      repos.rutas.cifrasReportes(),
    ]);

    const pendientesDePersona = await repos.rutas.contarSolicitudes({ requiereHumano: true });
    // Lo que manda de verdad: la configuracion con los ajustes guardados encima.
    const vigente = aplicarAjustes(opciones, await repos.rutas.ajustes.get(ajustesPorDefecto(opciones)));

    return {
      lotes,
      cifras,
      incidencias,
      gsg: { conectado: gsg.conectado(), descripcion: gsg.descripcion(), cola },
      motor: {
        pausa: [vigente.pausaMinSegundos, vigente.pausaMaxSegundos],
        espera: vigente.esperaRespuestaMinutos,
        maxIntentos: vigente.maxIntentos,
        horario: [vigente.horaInicio, vigente.horaFin],
        timezone: vigente.timezone,
        // Si ahora mismo puede salir un mensaje. Sin esto, un lote "en
        // marcha" a las once de la noche parece averiado.
        enHorario: enHorario(new Date(), vigente),
        trabajando: lotes.some((l) => l.estado === 'enviando'),
        // Lo que dice el monitor de salud: si esta frenado, cuanto y por que.
        salud: deps.salud ? await deps.salud.resumen() : null,
      },
      alertas: {
        requierenPersona: pendientesDePersona,
        // A quien se avisa por WhatsApp, si es que se avisa a alguien.
        coordinador: Boolean(deps.supervisor ? deps.supervisor() : config.RUTAS_SUPERVISOR),
        resumenCadaMin: config.RUTAS_RESUMEN_CADA_MIN,
      },
      // El catalogo de incidencias viaja con el resumen: asi la pantalla
      // explica cada caso sin tener que repetir los textos.
      catalogo: INCIDENCIAS,
    };
  });

  /** Lee la tabla y dice que entendio, sin guardar nada. */
  // --- ajustes: lo que se cambia desde la pantalla ------------------------

  /** Los ajustes vigentes, los de la configuracion y las plantillas entre las que elegir. */
  app.get('/admin/rutas/ajustes', async () => {
    const porDefecto = ajustesPorDefecto(opciones);
    const ajustes = await repos.rutas.ajustes.get(porDefecto);
    const plantillas = (await repos.templates.list())
      .filter((t) => t.category === 'UTILITY' || t.propia)
      .map((t) => ({
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        variables: t.variables,
        propia: t.propia ?? false,
        body: t.body,
        pausadaHasta: t.pausadaHasta ?? null,
      }));
    // Un cliente de ejemplo, para enseñar como queda cada mensaje tal cual saldria.
    const usaPlantillas = deps.usaPlantillas?.() ?? false;
    const conBoton = deps.conBoton?.() ?? usaPlantillas;
    const negocio = deps.nombreNegocio?.() ?? opciones.negocio;
    const ejemplo = { nombre: 'Ana Ruiz', pedido: 'P-1024', negocio, direccion: 'Av. Larco 123', distrito: 'Miraflores', como: conBoton ? 'con el botón de aquí abajo' : 'desde el clip 📎 → Ubicación → Enviar tu ubicación actual' };
    const ctx = { nombre: ejemplo.nombre, referencia: ejemplo.pedido, negocio, direccion: ejemplo.direccion, distrito: ejemplo.distrito, conBoton };
    const textosDeSiempre = Object.fromEntries(PASOS.map((p) => [p, textoLibre(p as PasoUbicacion, ctx)]));
    return {
      ajustes,
      porDefecto,
      usaPlantillas,
      conBoton,
      ejemplo,
      textosDeSiempre,
      catalogo: Object.fromEntries(PASOS.map((p) => [p, PLANTILLAS[p].variantes])),
      plantillas,
      // Como se rellenan las plantillas propias: en orden, y solo las que tenga.
      variablesPropias: ['{{1}} nombre del cliente', '{{2}} pedido o guia', '{{3}} nombre del negocio'],
      placeholders: ['{nombre}', '{pedido}', '{negocio}', '{direccion}', '{distrito}', '{como} (= "con el botón de aquí abajo" o "desde el clip 📎 → Ubicación...", según haya botón)'],
    };
  });

  app.post('/admin/rutas/ajustes', async (request, reply) => {
    const body = ajustesSchema.partial().parse(request.body ?? {});
    // Una plantilla elegida tiene que existir en el registro: si no, el
    // motor se pasaria el dia mandando contra un nombre que Meta no conoce.
    if (body.plantillas) {
      const registro = new Set((await repos.templates.list()).map((t) => t.name));
      for (const paso of PASOS) {
        const falta = (body.plantillas[paso] ?? []).find((n) => !registro.has(n));
        if (falta) return reply.code(400).send({ error: `La plantilla "${falta}" no esta en el registro.` });
      }
    }
    const porDefecto = ajustesPorDefecto(opciones);
    const ajustes = await repos.rutas.ajustes.set(body, porDefecto);
    return { ok: true, ajustes, vigente: aplicarAjustes(opciones, ajustes) };
  });

  /** Volver a lo que diga la configuracion. */
  app.delete('/admin/rutas/ajustes', async () => {
    await repos.rutas.ajustes.reset();
    return { ok: true, ajustes: ajustesPorDefecto(opciones) };
  });

  app.post('/admin/rutas/previsualizar', async (request) => {
    const body = z.object({ texto: z.string().max(2_000_000) }).parse(request.body ?? {});
    const lectura = leerLote(body.texto);
    const preparacion = prepararFilas(lectura.filas, plan);
    return {
      columnas: lectura.columnas,
      conCabecera: lectura.conCabecera,
      descartadas: lectura.descartadas,
      total: lectura.filas.length,
      listas: preparacion.listas,
      conIncidencia: preparacion.conIncidencia,
      duplicadas: preparacion.duplicadas,
      incidencias: preparacion.incidencias,
      // Una muestra, para que se vea que columna cayo donde.
      muestra: preparacion.solicitudes.slice(0, 10),
    };
  });

  /** Crea el lote. Acepta la tabla pegada o las filas ya estructuradas. */
  app.post('/admin/rutas/lotes', async (request, reply) => {
    const body = nuevoLoteSchema.parse(request.body ?? {});

    let filas: FilaLote[] = [];
    let descartadas: Array<{ linea: number; texto: string; motivo: string }> = [];

    if (body.filas?.length) {
      filas = body.filas;
    } else if (body.texto?.trim()) {
      const lectura = leerLote(body.texto);
      filas = lectura.filas;
      descartadas = lectura.descartadas;
    }

    if (!filas.length) {
      return reply.code(400).send({
        error: 'No se entendió ninguna fila con teléfono. Revisa que la tabla tenga una columna de teléfonos.',
      });
    }

    const preparacion = prepararFilas(filas, plan);
    const nombre =
      body.nombre?.trim() ||
      `Lote del ${new Date().toLocaleDateString('es-PE', { timeZone: opciones.timezone })}`;

    const lote = await repos.rutas.crearLote({
      nombre,
      origen: body.filas?.length ? 'api' : 'csv',
      notas: body.notas ?? null,
      externoId: body.externoId ?? null,
    });
    const creadas = await repos.rutas.agregarSolicitudes(lote.id, preparacion.solicitudes);

    /**
     * El consentimiento de cada cliente del lote.
     *
     * El sistema no deja escribirle a nadie que no haya dado su
     * consentimiento, y eso es lo correcto... salvo que aqui SI lo hay: son
     * clientes que acaban de hacer un pedido y dejaron su telefono para
     * coordinar la entrega. Ese es el consentimiento, y lo que exige la
     * politica es dejar constancia de DONDE salio, no inventarlo.
     *
     * Asi que se registra con el lote y el pedido dentro del origen. Sin este
     * paso el motor no enviaba absolutamente nada: cada intento moria en la
     * guarda de opt-in, que es justo lo que hay que evitar en un sistema que
     * tiene que salir a la calle esta manana.
     *
     * Quien se dio de baja antes NO entra: esa baja manda sobre el pedido, y
     * la solicitud se marca para que la coordine una persona por telefono.
     */
    for (const solicitud of creadas) {
      if (!solicitud.phone) continue;

      const previo = await repos.contacts.getByPhone(solicitud.phone);
      if (previo?.optOutAt) {
        await repos.rutas.actualizarSolicitud(solicitud.id, {
          contactId: previo.id,
          estado: 'incidencia',
          incidencia: 'rechaza_contacto',
          incidenciaDetalle: 'el cliente se dio de baja antes: no se le escribe',
          requiereHumano: true,
        });
        await repos.rutas.registrarEvento(
          solicitud.id,
          'incidencia',
          'está dado de baja: la entrega se coordina por teléfono',
        );
        continue;
      }

      // Si ya se le esta pidiendo la ubicacion en otro lote que no termino,
      // no se abre una segunda conversacion por lo mismo: se aparta para
      // que una persona decida (reintentar desde la ficha la vuelve a la cola).
      const abierta = await repos.rutas.abiertaPorTelefono(solicitud.phone, lote.id);
      if (abierta && ['pendiente', 'enviado', 'respondio', 'supervision'].includes(abierta.estado)) {
        await repos.rutas.actualizarSolicitud(solicitud.id, {
          estado: 'incidencia',
          incidencia: 'ya_en_curso',
          incidenciaDetalle: `ya tiene una solicitud abierta (${abierta.referencia ? `pedido ${abierta.referencia}` : 'sin pedido'}) en otro lote`,
          requiereHumano: true,
        });
        await repos.rutas.registrarEvento(solicitud.id, 'incidencia', 'ya se le está pidiendo la ubicación en otro lote: no se le escribe dos veces');
        continue;
      }

      const contacto = await repos.contacts.upsertFromInbound(
        solicitud.phone,
        solicitud.nombre ?? undefined,
      );
      const detalle = solicitud.referencia ? `pedido ${solicitud.referencia}` : 'pedido sin numero';
      await repos.contacts.setOptIn(solicitud.phone, `reparto: ${detalle} (${lote.nombre})`);
      await repos.rutas.actualizarSolicitud(solicitud.id, { contactId: contacto.id });
      // Si ya estaba en la lista de envio automatico, el reparto se lo queda:
      // no se le pide la ubicacion por dos caminos a la vez.
      if (deps.lista) await deps.lista.alCargarLote(solicitud.phone, { id: lote.id, nombre: lote.nombre }).catch(() => undefined);
    }

    // Las incidencias detectadas al leer el fichero se reportan ya: que un
    // numero venga con ocho digitos es informacion para GSG desde el minuto
    // cero, no cuando termine el lote.
    for (const solicitud of creadas) {
      if (!solicitud.incidencia) continue;
      await repos.rutas.registrarEvento(
        solicitud.id,
        'incidencia',
        `al cargar el lote: ${solicitud.incidenciaDetalle ?? solicitud.incidencia}`,
      );
      if (INCIDENCIAS[solicitud.incidencia].reportable) {
        await repos.rutas.encolarReporte({
          solicitudId: solicitud.id,
          loteId: lote.id,
          tipo: 'incidencia',
          payload: payloadIncidencia(solicitud, lote),
        });
      }
    }

    if (body.arrancar) await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');

    return {
      lote: (await repos.rutas.lote(lote.id))!,
      total: creadas.length,
      listas: preparacion.listas,
      conIncidencia: preparacion.conIncidencia,
      duplicadas: preparacion.duplicadas,
      incidencias: preparacion.incidencias,
      descartadas,
    };
  });

  app.get<{ Params: { id: string } }>('/admin/rutas/lotes/:id', async (request, reply) => {
    const lote = await repos.rutas.lote(request.params.id);
    if (!lote) return reply.code(404).send({ error: 'Ese lote ya no existe.' });
    const cifras = await repos.rutas.cifrasPorEstado(lote.id);
    const total = Object.values(cifras).reduce((suma, n) => suma + n, 0);
    return {
      lote,
      cifras,
      incidencias: await repos.rutas.cifrasPorIncidencia(lote.id),
      // Las dos cifras que se preguntan de un lote, ya sumadas: quien mira
      // esto no tiene por que saber que "sin ubicacion" son seis estados.
      total,
      conUbicacion: cifras.resuelto ?? 0,
      sinUbicacion: await repos.rutas.contarSolicitudes({ loteId: lote.id, estados: ESTADOS_SIN_UBICACION }),
    };
  });

  app.post<{ Params: { id: string } }>('/admin/rutas/lotes/:id/estado', async (request, reply) => {
    const body = z
      .object({ estado: z.enum(['preparado', 'enviando', 'pausado', 'terminado']) })
      .parse(request.body ?? {});
    const lote = await repos.rutas.cambiarEstadoLote(request.params.id, body.estado);
    if (!lote) return reply.code(404).send({ error: 'Ese lote ya no existe.' });
    return { lote };
  });

  app.delete<{ Params: { id: string } }>('/admin/rutas/lotes/:id', async (request, reply) => {
    const lote = await repos.rutas.lote(request.params.id);
    if (!lote) return reply.code(404).send({ error: 'Ese lote ya no existe.' });
    await repos.rutas.borrarLote(lote.id);
    return { ok: true };
  });

  /** El resultado del lote en CSV: es lo que hoy se le pasa a GSG a mano. */
  app.get<{ Params: { id: string } }>('/admin/rutas/lotes/:id.csv', async (request, reply) => {
    const lote = await repos.rutas.lote(request.params.id);
    if (!lote) return reply.code(404).send({ error: 'Ese lote ya no existe.' });
    const items = await repos.rutas.listarSolicitudes({ loteId: lote.id, limit: 5000, offset: 0 });
    const nombre = lote.nombre.replace(/[^\w-]+/g, '_').slice(0, 40);
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="ubicaciones-${nombre}.csv"`)
      .send(aCsv(items));
  });

  app.get('/admin/rutas/solicitudes', async (request) => {
    const { vista, ...resto } = listaSchema.parse(request.query ?? {});
    const consulta = { ...resto, ...(vista ? VISTAS[vista] ?? {} : {}) };
    return {
      items: await repos.rutas.listarSolicitudes(consulta),
      total: await repos.rutas.contarSolicitudes(consulta),
      vista: vista ?? 'todos',
    };
  });

  /** Cuantos hay en cada vista: son las tarjetas de arriba de la pantalla. */
  app.get('/admin/rutas/vistas', async (request) => {
    const query = z.object({ loteId: z.string().optional() }).parse(request.query ?? {});
    const cifras: Record<string, number> = {};
    for (const [nombre, filtro] of Object.entries(VISTAS)) {
      cifras[nombre] = await repos.rutas.contarSolicitudes({ ...filtro, loteId: query.loteId });
    }
    return { cifras, nombres: NOMBRES_VISTA };
  });

  app.get<{ Params: { id: string } }>('/admin/rutas/solicitudes/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const solicitud = Number.isInteger(id) ? await repos.rutas.solicitud(id) : null;
    if (!solicitud) return reply.code(404).send({ error: 'Ese cliente ya no está en la lista.' });
    return {
      solicitud,
      eventos: await repos.rutas.eventos(solicitud.id),
      lote: await repos.rutas.lote(solicitud.loteId),
      contacto: solicitud.contactId ? await repos.contacts.getById(solicitud.contactId) : null,
      incidencia: solicitud.incidencia ? INCIDENCIAS[solicitud.incidencia] : null,
    };
  });

  /**
   * Correcciones a mano.
   *
   * Lo que mas se usa: arreglar el telefono que venia mal. Al cambiarlo se
   * vuelve a revisar, y si ahora si es marcable la solicitud vuelve a la cola
   * automaticamente; sin eso, corregir el numero no serviria de nada.
   */
  app.patch<{ Params: { id: string } }>('/admin/rutas/solicitudes/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const solicitud = Number.isInteger(id) ? await repos.rutas.solicitud(id) : null;
    if (!solicitud) return reply.code(404).send({ error: 'Ese cliente ya no está en la lista.' });

    const body = z
      .object({
        telefono: z.string().max(40).optional(),
        nombre: z.string().max(200).nullish(),
        referencia: z.string().max(120).nullish(),
        direccion: z.string().max(300).nullish(),
        distrito: z.string().max(120).nullish(),
        notas: z.string().max(500).nullish(),
        asignadoA: z.string().max(120).nullish(),
        requiereHumano: z.boolean().optional(),
      })
      .parse(request.body ?? {});

    const patch: Record<string, unknown> = {};
    if (body.nombre !== undefined) patch.nombre = body.nombre;
    if (body.referencia !== undefined) patch.referencia = body.referencia;
    if (body.direccion !== undefined) patch.direccion = body.direccion;
    if (body.distrito !== undefined) patch.distrito = body.distrito;
    if (body.notas !== undefined) patch.notas = body.notas;
    if (body.asignadoA !== undefined) patch.asignadoA = body.asignadoA;
    if (body.requiereHumano !== undefined) patch.requiereHumano = body.requiereHumano;

    if (body.telefono?.trim()) {
      const revision = revisarTelefono(body.telefono, plan);
      if (!revision.ok) {
        return reply.code(400).send({
          error: `Ese número tampoco sirve: ${revision.detalle}`,
          incidencia: revision.incidencia,
        });
      }
      patch.phone = revision.phone;
      patch.telefonoCrudo = body.telefono.trim();
      // Un numero corregido arranca de cero: ni intentos ni incidencia ni el
      // contacto anterior, que era el del numero equivocado.
      // Numero nuevo, historia nueva: vuelve a la cola desde cero.
      patch.estado = 'pendiente';
      patch.intentos = 0;
      patch.incidencia = null;
      patch.incidenciaDetalle = null;
      patch.requiereHumano = false;
      patch.contactId = null;
      patch.proximoIntentoAt = null;
      await repos.rutas.registrarEvento(
        solicitud.id,
        'nota',
        `teléfono corregido a mano: ${solicitud.telefonoCrudo} a ${revision.phone}`,
      );
    }

    const actualizada = await repos.rutas.actualizarSolicitud(solicitud.id, patch);
    return { solicitud: actualizada };
  });

  /** La ubicacion conseguida por telefono, escrita a mano. */
  app.post<{ Params: { id: string } }>('/admin/rutas/solicitudes/:id/resolver', async (request, reply) => {
    const id = Number(request.params.id);
    const solicitud = Number.isInteger(id) ? await repos.rutas.solicitud(id) : null;
    if (!solicitud) return reply.code(404).send({ error: 'Ese cliente ya no está en la lista.' });

    const body = z
      .object({
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        /** Un enlace de mapa pegado, si es mas comodo que las coordenadas. */
        enlace: z.string().max(500).optional(),
        nota: z.string().max(300).optional(),
      })
      .parse(request.body ?? {});

    let lat = body.lat;
    let lng = body.lng;
    if ((lat === undefined || lng === undefined) && body.enlace) {
      const leido = await extractLocation(body.enlace, { bbox: config.bbox });
      if (!leido.ok) {
        return reply.code(400).send({
          error: `No se pudieron leer las coordenadas de ese enlace (${leido.reason}).`,
        });
      }
      lat = leido.lat;
      lng = leido.lng;
    }
    if (lat === undefined || lng === undefined) {
      return reply.code(400).send({ error: 'Faltan las coordenadas o el enlace del mapa.' });
    }

    const actualizada = await repos.rutas.actualizarSolicitud(solicitud.id, {
      estado: 'resuelto',
      lat,
      lng,
      mapsUrl: `https://www.google.com/maps?q=${lat},${lng}`,
      ubicacionFuente: 'cargada a mano',
      resueltoAt: new Date(),
      requiereHumano: false,
      incidencia: null,
      incidenciaDetalle: null,
      proximoIntentoAt: null,
    });
    await repos.rutas.registrarEvento(
      solicitud.id,
      'ubicacion',
      body.nota?.trim() || 'ubicación cargada a mano por el operador',
      { lat, lng },
    );

    const lote = await repos.rutas.lote(solicitud.loteId);
    if (lote) {
      await repos.rutas.encolarReporte({
        solicitudId: solicitud.id,
        loteId: lote.id,
        tipo: 'ubicacion',
        payload: payloadUbicacion(actualizada, lote),
      });
    }

    return { solicitud: actualizada };
  });

  /** Pasarla al repartidor sin esperar a que se agoten los intentos. */
  app.post<{ Params: { id: string } }>('/admin/rutas/solicitudes/:id/derivar', async (request, reply) => {
    const id = Number(request.params.id);
    const solicitud = Number.isInteger(id) ? await repos.rutas.solicitud(id) : null;
    if (!solicitud) return reply.code(404).send({ error: 'Ese cliente ya no está en la lista.' });

    const body = z.object({ motivo: z.string().max(300).optional(), asignadoA: z.string().max(120).optional() })
      .parse(request.body ?? {});

    const actualizada = await repos.rutas.actualizarSolicitud(solicitud.id, {
      estado: 'derivado',
      requiereHumano: true,
      asignadoA: body.asignadoA ?? solicitud.asignadoA,
      incidencia: solicitud.incidencia ?? (solicitud.primeraRespuestaAt ? 'respondio_sin_ubicacion' : 'sin_respuesta'),
      incidenciaDetalle: body.motivo ?? solicitud.incidenciaDetalle ?? 'derivada a mano por el operador',
      proximoIntentoAt: null,
    });
    await repos.rutas.registrarEvento(
      solicitud.id,
      'derivacion',
      body.motivo?.trim() || 'derivada a mano por el operador',
    );

    const lote = await repos.rutas.lote(solicitud.loteId);
    if (lote) {
      await repos.rutas.encolarReporte({
        solicitudId: solicitud.id,
        loteId: lote.id,
        tipo: 'incidencia',
        payload: payloadIncidencia(actualizada, lote),
      });
    }

    return { solicitud: actualizada };
  });

  /** Devolverla a la cola: para cuando se corrigio algo fuera del sistema. */
  app.post<{ Params: { id: string } }>('/admin/rutas/solicitudes/:id/reintentar', async (request, reply) => {
    const id = Number(request.params.id);
    const solicitud = Number.isInteger(id) ? await repos.rutas.solicitud(id) : null;
    if (!solicitud) return reply.code(404).send({ error: 'Ese cliente ya no está en la lista.' });
    if (!solicitud.phone) {
      return reply.code(409).send({
        error: 'Este cliente no tiene un teléfono al que se pueda escribir: corrígelo primero.',
      });
    }

    const actualizada = await repos.rutas.actualizarSolicitud(solicitud.id, {
      estado: 'pendiente',
      intentos: 0,
      requiereHumano: false,
      incidencia: null,
      incidenciaDetalle: null,
      proximoIntentoAt: null,
    });
    await repos.rutas.registrarEvento(solicitud.id, 'nota', 'devuelta a la cola por el operador');
    return { solicitud: actualizada };
  });

  // ------------------------------------------------------------- cola GSG

  app.get('/admin/rutas/cola', async (request) => {
    const query = z
      .object({ limit: z.coerce.number().int().positive().max(500).default(100) })
      .parse(request.query ?? {});
    return {
      conectado: gsg.conectado(),
      descripcion: gsg.descripcion(),
      cifras: await repos.rutas.cifrasReportes(),
      items: await repos.rutas.reportesPendientes(query.limit),
    };
  });

  /** Lo que hay en la cola, en NDJSON: se lleva a GSG a mano si hace falta. */
  app.get('/admin/rutas/cola.ndjson', async (_request, reply) => {
    const pendientes = await repos.rutas.reportesPendientes(5000);
    return reply
      .type('application/x-ndjson; charset=utf-8')
      .header('content-disposition', 'attachment; filename="reportes-gsg.ndjson"')
      .send(exportarCola(pendientes));
  });

  app.post('/admin/rutas/cola/despachar', async () => despacharReportes(repos, gsg, 200));
}
