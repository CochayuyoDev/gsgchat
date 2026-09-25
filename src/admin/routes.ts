/**
 * API de operacion: campanas, estado del numero, contactos, ubicaciones,
 * entregas, plantillas y enlaces de rastreo. Protegida con un token de
 * administracion; no esta pensada para quedar expuesta a internet sin un
 * proxy delante.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { normalizePhone, type Repos, type TemplateCategory } from '../db/repos.js';
import type { OutboundQueue } from '../outbound/queue.js';
import { dailyCapFor } from '../outbound/throttle.js';
import type { ServicioIA } from '../ia/servicio.js';
import type { ServicioEnvioAutomatico } from '../envio-automatico/servicio.js';
import type { ServicioPlan } from '../plan/servicio.js';
import { createTrackingSession } from '../tracking/routes.js';
import { buildTrackingUrls } from '../tracking/tokens.js';
import type { TrackingHub } from '../tracking/realtime.js';
import type { Sender } from '../outbound/sender.js';
import { extractLocation } from '../geo/extract.js';
import type { SettingsService } from '../settings/service.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import { CATALOG, type CatalogTemplate } from '../templates/catalog.js';
import { hasErrors, lintTemplate } from '../templates/lint.js';
import { countVariables } from '../templates/render.js';
import { syncTemplates } from '../templates/registry.js';
import { pushTemplates } from '../templates/push.js';
import { registerAutomationRoutes } from './automation-routes.js';
import { registerChatRoutes } from './chat-routes.js';
import { registerLeadsRoutes } from './leads-routes.js';
import { registerArchiveRoutes } from './archive-routes.js';
import { archivarConversacion } from '../archive/service.js';
import { registerRutasRoutes } from './rutas-routes.js';
import { crearPuertoGsg } from '../rutas/gsg.js';
import { conexionGsgVigente } from '../rutas/conexion-gsg.js';
import { opcionesDesdeConfig } from '../rutas/motor.js';
import type { Monitor } from '../salud/monitor.js';
import { politicaDesdeConfig, type Politica } from '../salud/politica.js';
import { ZONAS_HORARIAS, ajustesGeneralesPatchSchema, ATAJOS_POR_DEFECTO, type ServicioAjustes } from '../ajustes/generales.js';
import type { ServicioStickers } from '../stickers/stickers.js';
import { aCsvCon } from './csv.js';
import { providerOf } from '../settings/service.js';
import { avisosDeMeta } from '../whatsapp/avisos-meta.js';
import { correrGoteo } from '../campanas/goteo.js';
import { crearCampana } from '../campanas/crear.js';
import { registerGruposRoutes } from './grupos-routes.js';
import { registerBuscarRoutes } from './buscar-routes.js';

export interface AdminDeps {
  /** La conexion con Stoky configurable desde la pantalla (para el enlace al panel). */
  conexionStoky?: import('../stoky/conexion.js').ServicioConexionStoky;
  /** El entrenamiento del asistente (para la lista de primeros pasos del inicio). */
  entrenamiento?: import('../entrenamiento/servicio.js').ServicioEntrenamiento;
  /** La voz del asistente: desde el chat, un texto puede salir como nota de voz. */
  voz?: import('../voz/servicio.js').ServicioVoz;
  /** La puerta a GSG (la configurable desde la pantalla). Sin ella, la del .env. */
  gsg?: import('../rutas/gsg.js').PuertoGsg;
  /** Las entregas del dia: ligan cada conversacion guardada a su pedido. Ver src/entregas. */
  entregas?: import('../entregas/servicio.js').ServicioEntregas;
  /** La conexion con GSG de ESTA tienda (sus descartes y su cuadre). */
  conexionGsg?: import('../rutas/conexion-gsg.js').ServicioConexionGsg;
  repos: Repos;
  config: Config;
  settings: SettingsService;
  queue: OutboundQueue;
  sender: Sender;
  wa: WhatsAppClient;
  hub: TrackingHub;
  /** Los ajustes generales editables desde la pantalla. Ver src/ajustes. */
  ajustes?: ServicioAjustes;
  /** Los stickers, para las respuestas rapidas con sticker. */
  stickers?: ServicioStickers;
  /** El monitor de salud y la politica de ritmo. Ver src/salud. */
  salud?: Monitor;
  politica?: () => Politica;
  /** El asistente de IA, para saber si esta listo (primeros pasos). */
  ia?: ServicioIA;
  /** La lista de envio automatico: el reparto se queda con los numeros que ya estaban en ella. */
  lista?: ServicioEnvioAutomatico;
  /** Donde se guardan los adjuntos; por defecto, .wa-media. */
  mediaDir?: string;
  plan?: ServicioPlan;
  /** "Que todo funcione": la campana avisa del cupo que no alcanza, la prueba de la manana fallida y la copia fallida. */
  fiabilidad?: import('../salud/fiabilidad.js').ServicioFiabilidad;
}

const phoneSchema = z
  .string()
  .min(6)
  .transform((value) => normalizePhone(value))
  .refine((value) => value.length >= 6, 'telefono demasiado corto');

const campaignSchema = z.object({
  name: z.string().min(1),
  templateName: z.string().min(1),
  templateLanguage: z.string().default('es'),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).default('MARKETING'),
  /** Destinatarios explicitos; si se omite, va a todos los que tienen opt-in. */
  recipients: z
    .array(z.object({ phone: phoneSchema, variables: z.array(z.string()).default([]) }))
    .optional(),
  /** Goteo: como mucho tantos por hora. Vacio = el ritmo general del marcapasos. */
  ritmoPorHora: z.coerce.number().int().positive().optional(),
  /** Cuantos salen primero para mirar como cae. Vacio = 10 % (5-20); 0 = sin canario. */
  canario: z.coerce.number().int().nonnegative().optional(),
  canarioEsperaMin: z.coerce.number().int().positive().default(60),
});

const trackingSchema = z.object({
  phone: phoneSchema.optional(),
  label: z.string().max(120).optional(),
  ttlMinutes: z.number().int().positive().max(24 * 60).optional(),
  /** Manda el enlace de seguimiento al contacto por WhatsApp. */
  notify: z.boolean().default(false),
});

const pageSchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const importSchema = z.object({
  source: z.string().min(1).max(120),
  contacts: z
    .array(z.object({ phone: z.string().min(1), name: z.string().max(200).optional() }))
    .max(20_000)
    .optional(),
  /** Alternativa: una linea por contacto, "telefono,nombre". */
  text: z.string().max(2_000_000).optional(),
});

/** "51987654321, Ana Perez" -> { phone, name }. Ignora lineas vacias y cabeceras. */
export function parseContactLines(text: string): Array<{ phone: string; name?: string }> {
  const out: Array<{ phone: string; name?: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const [first, ...rest] = line.split(/[,;\t]/).map((cell) => cell.trim());
    const phone = normalizePhone(first ?? '');
    if (phone.length < 6) continue;
    const name = rest.filter(Boolean).join(' ').trim();
    out.push(name ? { phone, name } : { phone });
  }
  return out;
}

export async function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): Promise<void> {
  const { repos, config, queue, sender, settings, wa, hub } = deps;
  // Sin Meta (cliente local o WAHA) no hay id de numero: se usa una clave fija
  // para que el estado, la pausa y el monitor hablen de la misma fila.
  const phoneNumberId = () => settings.current().phoneNumberId || 'local';

  // Quien entra lo decide registerAuth (cookie de sesion o clave de API).

  await registerAutomationRoutes(app, { repos, sender });
  await registerChatRoutes(app, { repos, sender, config, settings, mediaDir: deps.mediaDir, voz: deps.voz });
  await registerLeadsRoutes(app, {
    repos,
    // Lo que se conecto desde la pantalla manda; el .env es el valor inicial.
    panelStoky: () => deps.conexionStoky?.estado().panelUrl || config.STOKY_PANEL_URL,
    // Cerrar la ficha cierra tambien la conversacion: se respalda y se limpia.
    alCerrarFicha: config.ARCHIVE_ON_LEAD_CLOSE
      ? async (contactId) => {
          try {
            await archivarConversacion(
              { repos, dir: config.ARCHIVE_DIR, log: (m, d) => app.log.info(d ?? {}, m) },
              contactId,
              'lead',
            );
          } catch (error) {
            // Que falle el respaldo no puede tumbar el guardado de la ficha:
            // el operador acaba de cerrar una venta, no un backup.
            app.log.warn(
              { contactId, detalle: error instanceof Error ? error.message : String(error) },
              'no se pudo respaldar la conversacion al cerrar la ficha',
            );
          }
        }
      : undefined,
  });
  await registerArchiveRoutes(app, {
    repos,
    dir: config.ARCHIVE_DIR,
    dias: () => deps.ajustes?.guardadosDias() ?? config.ARCHIVE_INACTIVE_DAYS,
    ia: () => (deps.ia?.estado().tieneToken ? { completar: (m, o) => deps.ia!.completar(m, o) } : null),
    pedidoDe: deps.entregas ? (phone) => deps.entregas!.pedidoDe(phone) : undefined,
    nombreNegocio: () => deps.ajustes?.nombreNegocio() ?? config.businessName,
    telefonosTerminadosHoy: deps.entregas ? () => deps.entregas!.telefonosTerminadosHoy() : undefined,
    mediaDir: deps.mediaDir,
    secreto: config.TRACKING_SECRET,
    entrenamiento: deps.entrenamiento,
    publicBase: config.PUBLIC_BASE_URL,
  });
  await registerGruposRoutes(app, { repos, config, settings, ajustes: deps.ajustes });
  // El buscador global (Ctrl K) y "que paso con este mensaje". Ver buscar-routes.ts.
  await registerBuscarRoutes(app, { repos, entregas: deps.entregas });
  await registerRutasRoutes(app, {
    repos,
    config,
    gsg: deps.gsg ?? crearPuertoGsg(config),
    opciones: opcionesDesdeConfig(config),
    salud: deps.salud,
    supervisor: () => deps.ajustes?.supervisor() ?? config.RUTAS_SUPERVISOR,
    usaPlantillas: () => providerOf(settings.current()) === 'cloud',
    conBoton: () => providerOf(settings.current()) === 'cloud' || config.WHATSAPP_NATIVE_BUTTONS,
    nombreNegocio: () => deps.ajustes?.nombreNegocio() ?? config.businessName,
    lista: deps.lista,
  });

  // --- ajustes generales: lo que se cambia desde la pantalla ----------------

  /** Lo guardado, lo del servidor debajo, y lo efectivo (lo que manda ahora). */
  app.get('/admin/ajustes', async (_request, reply) => {
    if (!deps.ajustes) return reply.code(404).send({ error: 'los ajustes generales no estan activos en este arranque' });
    const p = politicaVigente();
    return {
      guardado: deps.ajustes.actual(),
      servidor: deps.ajustes.servidor(),
      zonasHorarias: ZONAS_HORARIAS,
      modoPruebaFijado: deps.ajustes.modoPruebaFijado(),
      efectivo: {
        nombreNegocio: deps.ajustes.nombreNegocio(),
        soloNumeros: deps.ajustes.soloNumeros(),
        supervisor: p.avisarA,
        horario: { inicio: p.horaInicio, fin: p.horaFin, dias: p.diasPermitidos, timezone: p.timezone },
        ritmo: {
          perfil: p.perfil,
          maxPorMinuto: p.maxPorMinuto,
          maxPorHora: p.maxPorHora,
          pausaMinSeg: Math.round(p.pausaMinMs / 1000),
          pausaMaxSeg: Math.round(p.pausaMaxMs / 1000),
          nuevosContactosPorDia: p.nuevosContactosPorDia,
          maxPorContactoDia: p.maxPorContactoDia,
          separacionContactoMin: Math.round(p.separacionContactoMs / 60_000),
        },
        humanizar: p.humanizar,
        autoPausa: p.autoPausa,
      },
    };
  });

  app.post('/admin/ajustes', async (request, reply) => {
    if (!deps.ajustes) return reply.code(404).send({ error: 'los ajustes generales no estan activos en este arranque' });
    if (request.usuario?.rol !== 'admin' || request.usuario.porToken) {
      return reply.code(403).send({ error: 'solo un administrador cambia los ajustes generales' });
    }
    const patch = ajustesGeneralesPatchSchema.parse(request.body ?? {});
    const guardado = await deps.ajustes.guardar(patch);
    return { ok: true, guardado };
  });

  app.delete('/admin/ajustes', async (request, reply) => {
    if (!deps.ajustes) return reply.code(404).send({ error: 'los ajustes generales no estan activos en este arranque' });
    if (request.usuario?.rol !== 'admin' || request.usuario.porToken) {
      return reply.code(403).send({ error: 'solo un administrador cambia los ajustes generales' });
    }
    return { ok: true, guardado: await deps.ajustes.restablecer() };
  });

  // --- respuestas rapidas del chat ("/atajo") --------------------------------

  app.get('/admin/chat/atajos', async () => ({ atajos: deps.ajustes?.atajos() ?? ATAJOS_POR_DEFECTO, deFabrica: !deps.ajustes || deps.ajustes.actual().atajos === null }));

  app.post('/admin/chat/atajos', async (request, reply) => {
    if (!deps.ajustes) return reply.code(404).send({ error: 'los ajustes generales no estan activos en este arranque' });
    if (request.usuario?.rol !== 'admin' || request.usuario.porToken) return reply.code(403).send({ error: 'solo un administrador cambia las respuestas rapidas' });
    const body = z.object({ atajos: z.array(z.object({ atajo: z.string(), texto: z.string(), sticker: z.string().nullable().optional() })).max(50).nullable() }).parse(request.body ?? {});
    const guardado = await deps.ajustes.guardar({ atajos: body.atajos });
    return { ok: true, atajos: guardado.atajos ?? ATAJOS_POR_DEFECTO, deFabrica: guardado.atajos === null };
  });

  // --- avisos: lo que espera a una persona, para la campana de arriba -----

  /** Ligero a proposito: se consulta cada medio minuto desde todas las pantallas. */
  app.get('/admin/avisos', async () => {
    const [esperando, requierenPersona, estado] = await Promise.all([
      repos.messages.contarEsperandoRespuesta(),
      repos.rutas.contarSolicitudes({ requiereHumano: true }),
      repos.numberState.get(phoneNumberId()),
    ]);
    const avisos: Array<{ tipo: string; nivel: 'info' | 'warn' | 'bad'; texto: string; href: string; n?: number }> = [];
    // El plan va el primero: si esta vencido, explica por que lo demas esta parado.
    const avisoPlan = deps.plan?.estado().aviso ?? null;
    if (avisoPlan) avisos.push({ tipo: 'plan', nivel: avisoPlan.nivel, texto: avisoPlan.texto, href: '/panel#configuracion' });
    const configurado = settings.isConfigured();
    const conectado = configurado && (wa.conectado?.() ?? true);
    if (!configurado) avisos.push({ tipo: 'sin_configurar', nivel: 'bad', texto: 'WhatsApp sin conectar: no sale ni entra nada', href: '/setup' });
    else if (!conectado) avisos.push({ tipo: 'desconectado', nivel: 'bad', texto: 'WhatsApp desconectado: vuelve a vincular el telefono', href: '/setup' });
    if (estado.paused) avisos.push({ tipo: 'pausado', nivel: 'warn', texto: `Envios pausados${estado.pausedReason ? ': ' + estado.pausedReason : ''}`, href: '/panel#estado' });
    const nivel = estado.nivel ?? 'verde';
    if (nivel === 'rojo') avisos.push({ tipo: 'riesgo', nivel: 'bad', texto: 'El numero esta en rojo: todo pausado hasta que mejore', href: '/panel#salud' });
    else if (nivel === 'naranja') avisos.push({ tipo: 'riesgo', nivel: 'warn', texto: 'El numero esta en naranja: solo sale lo imprescindible', href: '/panel#salud' });
    else if (nivel === 'amarillo') avisos.push({ tipo: 'riesgo', nivel: 'info', texto: 'El numero esta en amarillo: el marketing va mas lento', href: '/panel#salud' });
    if (esperando > 0) avisos.push({ tipo: 'chats', nivel: 'info', texto: `${esperando} conversacion${esperando === 1 ? '' : 'es'} espera${esperando === 1 ? '' : 'n'} respuesta`, href: '/chat', n: esperando });
    // Las entregas del dia: lo que necesita a alguien, GSG sin conectar, ningun motorizado.
    const modoGsg = (deps.ajustes?.modo() ?? 'gsg') === 'gsg';
    if (deps.entregas) {
      const r = await deps.entregas.resumen().catch(() => null);
      if (r) {
        // «Revisar y confirmar antes de enviar»: lo que llegó de GSG no sale hasta que alguien lo confirma.
        const pc = r.porConfirmarEnvio;
        if (pc && pc.total > 0) avisos.push({ tipo: 'por_confirmar_envio', nivel: 'warn', texto: `${pc.aviso}. Confírmalos para enviar`, href: '/numeros', n: pc.total });
        const n = r.cifras.incidencia;
        if (n > 0) avisos.push({ tipo: 'entregas', nivel: 'warn', texto: `${n} pedido${n === 1 ? '' : 's'} de hoy necesita${n === 1 ? '' : 'n'} a alguien`, href: '/hoy', n });
        if (r.cierrePendiente > 0) avisos.push({ tipo: 'cierre', nivel: 'info', texto: `${r.cierrePendiente} pedido${r.cierrePendiente === 1 ? '' : 's'} de ayer sigue${r.cierrePendiente === 1 ? '' : 'n'} sin cerrar`, href: '/hoy', n: r.cierrePendiente });
        if (r.gsg && !r.gsg.conectada) avisos.push({ tipo: 'gsg', nivel: 'info', texto: 'GSG no está conectado: los pedidos del día no entran solos', href: '/hoy' });
        if (r.cifras.total > 0 && !r.motorizados.some((m) => m.estado === 'activo')) avisos.push({ tipo: 'motorizados', nivel: 'bad', texto: 'No hay ningún motorizado activo: los pedidos listos no pueden salir', href: '/motorizados' });
        if (r.gsgCola && r.gsgCola.fallido > 0) avisos.push({ tipo: 'gsg_cola', nivel: 'warn', texto: `${r.gsgCola.fallido} reporte${r.gsgCola.fallido === 1 ? '' : 's'} que GSG no aceptó`, href: '/hoy', n: r.gsgCola.fallido });
      }
    }
    // Lo que GSG mando y no se pudo leer, y el cuadre de fin de dia con GSG
    // (src/rutas/gsg-extras.ts): un 422 silencioso es un pedido perdido.
    try {
      const extras = (deps.conexionGsg ?? conexionGsgVigente())?.extras;
      if (extras) {
        const descartes = extras.descartesDeHoy().lista.length;
        if (descartes > 0) avisos.push({ tipo: 'gsg_descartes', nivel: 'warn', texto: `${descartes} pedido${descartes === 1 ? '' : 's'} de GSG no se pudo${descartes === 1 ? '' : 'ieron'} leer`, href: '/setup#gsg', n: descartes });
        const cuadre = extras.ultimoCuadre();
        if (cuadre && !cuadre.ok) {
          const diferencias = cuadre.faltanEnGsg.length + cuadre.sobranEnGsg.length;
          avisos.push({ tipo: 'gsg_cuadre', nivel: 'warn', texto: diferencias ? `El día no cuadra con GSG: ${diferencias} diferencia${diferencias === 1 ? '' : 's'}` : 'El día no cuadra con GSG', href: '/setup#gsg', ...(diferencias ? { n: diferencias } : {}) });
        }
      }
    } catch {
      // sin conexion con GSG no hay nada que avisar
    }
    // Los procesos: quien necesita a una persona (una captura por validar, una consulta ajena, alguien que no pudo).
    if (repos.procesos) {
      const cifras = await repos.procesos.cifras().catch(() => ({}) as Record<string, number>);
      const n = cifras.persona ?? 0;
      if (n > 0) avisos.push({ tipo: 'procesos', nivel: 'warn', texto: `${n} persona${n === 1 ? '' : 's'} de tus procesos necesita${n === 1 ? '' : 'n'} a alguien`, href: '/personas?filtro=persona', n });
    }
    if (requierenPersona > 0) avisos.push({ tipo: 'reparto', nivel: 'warn', texto: `${requierenPersona} caso${requierenPersona === 1 ? '' : 's'} del reparto necesita${requierenPersona === 1 ? '' : 'n'} una persona`, href: modoGsg ? '/hoy' : '/rutas', n: requierenPersona });
    // La IA que falla tres veces seguidas es una clave vencida o un proveedor caido: el asistente se queda callado sin que se note.
    if (deps.ia?.activa()) {
      const usoIa = deps.ia.uso();
      if (usoIa.fallosSeguidos >= 3) avisos.push({ tipo: 'ia_fallos', nivel: 'bad', texto: `El asistente IA falló ${usoIa.fallosSeguidos} veces seguidas${usoIa.ultimoFallo ? ` (${usoIa.ultimoFallo.detalle.slice(0, 80)})` : ''}: revisa la clave o el servicio`, href: '/panel#ia', n: usoIa.fallosSeguidos });
    }
    // Lo que vigila "Que todo funcione": se avisa aqui para que no haga falta abrir esa pantalla.
    if (deps.fiabilidad) {
      const f = await deps.fiabilidad.estado().catch(() => null);
      if (f) {
        if (f.vigilante.necesitaQr) avisos.push({ tipo: 'qr', nivel: 'bad', texto: 'El teléfono cerró la sesión de WhatsApp: hay que escanear el QR otra vez', href: '/setup' });
        if (!f.cupo.alcanza) avisos.push({ tipo: 'cupo', nivel: 'warn', texto: `El número no alcanza para los pedidos de hoy: hacen falta ${f.cupo.necesitan} mensajes y pueden salir ${f.cupo.puedenSalir}`, href: '/fiabilidad', n: f.cupo.necesitan - f.cupo.puedenSalir });
        if (f.humo.ultima && !f.humo.ultima.ok) avisos.push({ tipo: 'humo', nivel: 'warn', texto: `La prueba de la mañana falló: ${f.humo.ultima.pasos.filter((p) => !p.ok && !p.omitido).map((p) => p.nombre).join(', ') || 'revisa el detalle'}`, href: '/fiabilidad' });
        if (f.copia.ultima && !f.copia.ultima.ok) avisos.push({ tipo: 'copia', nivel: 'warn', texto: 'La última copia de seguridad falló', href: '/fiabilidad' });
      }
    }
    const pedidosNuevos = (await repos.pedidos.contarPorEstado().catch(() => ({}) as Record<string, number>)).nuevo ?? 0;
    if (pedidosNuevos > 0) avisos.push({ tipo: 'pedidos', nivel: 'warn', texto: `${pedidosNuevos} pedido${pedidosNuevos === 1 ? '' : 's'} del chat espera${pedidosNuevos === 1 ? '' : 'n'} confirmación`, href: '/panel#pedidos', n: pedidosNuevos });
    // Un webhook que se apago solo es un sistema que dejo de enterarse de lo que pasa.
    const apagados = (await repos.webhooks.listar().catch(() => [])).filter((w) => !w.activo && w.motivoPausa);
    if (apagados.length) avisos.push({ tipo: 'webhooks', nivel: 'warn', texto: `${apagados.length} webhook${apagados.length === 1 ? '' : 's'} apagado${apagados.length === 1 ? '' : 's'} por fallos: ${apagados.map((w) => w.descripcion || w.url).join(', ')}`, href: '/panel#integraciones', n: apagados.length });
    return { total: avisos.length, avisos, generadoEn: new Date(), plan: avisoPlan };
  });

  /** El plan de esta tienda, para la pantalla de configuracion. */
  app.get('/admin/plan', async () => deps.plan?.estado() ?? { origen: 'libre', plan: null, iaTurnosMes: 0, mes: '', consultadoEn: null, error: null, aviso: null });
  app.post('/admin/plan/refrescar', async () => (deps.plan ? deps.plan.refrescar() : { origen: 'libre', plan: null, iaTurnosMes: 0, mes: '', consultadoEn: null, error: null, aviso: null }));

  // --- el inicio del panel: un vistazo a todo -----------------------------

  /**
   * Lo que se ve nada mas entrar: cifras de hoy, la semana, el semaforo del
   * numero, lo que espera a una persona. Cada pieza sale de un repo que ya
   * existe; aqui solo se juntan para que la pantalla haga una peticion.
   */
  app.get('/admin/resumen', async () => {
    const ahora = new Date();
    const inicioHoy = new Date(ahora);
    inicioHoy.setHours(0, 0, 0, 0);
    const hace7 = new Date(inicioHoy.getTime() - 6 * 24 * 60 * 60 * 1000);

    const [hoy, entrantesHoy, actividad, esperando, sinLeer, estado, cifrasReparto, requierenPersona, lotes, campanas, contactos, usuarios, plantillas] =
      await Promise.all([
        repos.deliveries.resumenDesde(inicioHoy),
        repos.messages.contarEntrantesDesde(inicioHoy),
        repos.messages.actividadPorDia(hace7),
        repos.messages.contarEsperandoRespuesta(),
        repos.messages.unreadTotal(),
        repos.numberState.get(phoneNumberId()),
        repos.rutas.cifrasPorEstado(),
        repos.rutas.contarSolicitudes({ requiereHumano: true }),
        repos.rutas.listarLotes(20, 0),
        repos.campaigns.list(),
        repos.contacts.list({ limit: 1, offset: 0 }),
        repos.usuarios.contar(),
        repos.templates.list(),
      ]);

    // Siete dias seguidos, con ceros donde no hubo nada.
    const semana: Array<{ dia: string; entrantes: number; salientes: number }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(hace7.getTime() + i * 24 * 60 * 60 * 1000);
      const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const fila = actividad.find((a) => a.dia === clave);
      semana.push({ dia: clave, entrantes: fila?.entrantes ?? 0, salientes: fila?.salientes ?? 0 });
    }

    const politica = politicaVigente();
    // Las entregas del dia (GSG): en modo gsg es lo primero que se ve.
    const resumenEntregas = deps.entregas ? await deps.entregas.resumen().catch(() => null) : null;
    const entregasHoy = resumenEntregas
      ? {
          dia: resumenEntregas.dia,
          total: resumenEntregas.cifras.total,
          faltaUbicacion: resumenEntregas.cifras.faltaUbicacion,
          faltaConfirmacion: resumenEntregas.cifras.faltaConfirmacion,
          enCamino: resumenEntregas.cifras.enCamino,
          entregadas: resumenEntregas.cifras.entregada,
          incidencia: resumenEntregas.cifras.incidencia,
          canceladas: resumenEntregas.cifras.cancelada,
          motorizadosActivos: resumenEntregas.motorizados.filter((m) => m.estado === 'activo').length,
          gsgConectada: resumenEntregas.gsg?.conectada ?? false,
          gsgDescripcion: resumenEntregas.gsg?.descripcion ?? 'sin conexión',
          ultimoCierre: resumenEntregas.ultimoCierre,
          cierrePendiente: resumenEntregas.cierrePendiente,
        }
      : null;
    return {
      generadoEn: ahora,
      entregas: entregasHoy,
      hoy: {
        enviados: hoy.enviados,
        entregados: hoy.entregados,
        leidos: hoy.leidos,
        fallidos: hoy.fallidos,
        entrantes: entrantesHoy,
        cupo: dailyCapFor(estado.warmupStartedOn, ahora, politica.warmup),
        usados: await repos.counters.totalForDay(phoneNumberId(), ahora),
      },
      semana,
      numero: {
        conectado: settings.isConfigured() && (wa.conectado?.() ?? true),
        configurado: settings.isConfigured(),
        calidad: estado.quality,
        pausado: estado.paused,
        motivoPausa: estado.pausedReason,
        nivel: estado.nivel ?? 'verde',
        motivos: estado.motivos ?? [],
        factor: deps.salud?.factor() ?? 1,
      },
      chats: { sinLeer, esperandoRespuesta: esperando },
      reparto: {
        cifras: cifrasReparto,
        requierenPersona,
        lotesEnMarcha: lotes.filter((l) => l.estado === 'enviando').length,
        lotesRecientes: lotes.slice(0, 5).map((l) => ({ id: l.id, nombre: l.nombre, estado: l.estado, total: l.total, cifras: l.cifras, createdAt: l.createdAt })),
      },
      campanas: {
        activas: campanas.filter((c) => c.status === 'running' || c.status === 'canary').length,
        pausadas: campanas.filter((c) => c.status === 'paused').length,
      },
      contactos: contactos.total,
      // Para la lista de "primeros pasos" del inicio: que esta hecho y que no.
      primerosPasos: {
        proveedor: providerOf(settings.current()),
        conectado: settings.isConfigured() && (wa.conectado?.() ?? true),
        usuarios,
        plantillas: plantillas.length,
        contactos: contactos.total,
        lotes: lotes.length,
        // El asistente de IA: null si este arranque no lo tiene.
        ia: deps.ia ? deps.ia.activa() : null,
        iaDisponible: Boolean(deps.ia),
        // Cuantas lecciones tiene en uso (null si este arranque no tiene entrenamiento).
        lecciones: deps.entrenamiento ? deps.entrenamiento.cargadas() : null,
        // Lo que GSGchat necesita para arrancar (modo gsg): motorizados, y de donde salen los pedidos.
        modo: deps.ajustes?.modo() ?? 'gsg',
        // Sin las entregas de courier, los pasos son los de los procesos: crear uno y cargarle personas.
        procesos: repos.procesos ? (await repos.procesos.procesos().catch(() => [])).filter((x) => x.plantilla !== 'gsg').length : null,
        personasEnProcesos: repos.procesos ? Object.values(await repos.procesos.cifras().catch(() => ({}) as Record<string, number>)).reduce((s, n) => s + n, 0) : null,
        motorizadosActivos: resumenEntregas ? resumenEntregas.motorizados.filter((m) => m.estado === 'activo').length : null,
        gsg: resumenEntregas?.gsg ? (resumenEntregas.gsg.conectada ? (resumenEntregas.gsg.modo === 'simulador' ? 'simulador' : 'real') : 'ninguna') : null,
        entregasHoy: resumenEntregas ? resumenEntregas.cifras.total : null,
        supervisor: Boolean(deps.ajustes?.supervisor() || config.RUTAS_SUPERVISOR),
        // Stoky en las dos direcciones: si este sistema consulta su catalogo y si Stoky ya usa su clave.
        stoky: deps.conexionStoky
          ? {
              configurada: deps.conexionStoky.estado().configurada,
              claveUsada: (await repos.claves.listar()).some((c) => !c.revocadaAt && /stoky/i.test(c.nombre) && Boolean(c.ultimoUsoAt)),
            }
          : null,
      },
    };
  });

  // --- salud del numero: lo primero que hay que mirar cada dia ----------
  const politicaVigente = (): Politica =>
    deps.politica?.() ??
    politicaDesdeConfig(config, providerOf(settings.current()) === 'cloud' ? 'cloud' : 'no_oficial');

  app.get('/admin/health', async () => {
    const state = await repos.numberState.get(phoneNumberId());
    const now = new Date();
    const politica = politicaVigente();
    const cap = dailyCapFor(state.warmupStartedOn, now, politica.warmup);
    return {
      number: state,
      dailyCap: cap,
      sentToday: await repos.counters.totalForDay(phoneNumberId(), now),
      queue: await queue.counts(),
      configured: settings.isConfigured(),
      missing: settings.missing(),
      salud: deps.salud
        ? { nivel: state.nivel ?? 'verde', factor: deps.salud.factor(), motivos: state.motivos ?? [] }
        : null,
      // Lo que Meta cambia con fecha (solo con la API oficial). Ver src/whatsapp/avisos-meta.ts.
      avisosMeta: avisosDeMeta({ ahora: now, proveedor: providerOf(settings.current()), graphVersion: settings.current().graphVersion, hechos: deps.ajustes?.actual().meta ?? {} }),
    };
  });

  // --- salud del numero: lo que mira el monitor y por que frena ---------
  app.get('/admin/salud', async (_request, reply) => {
    if (!deps.salud) return reply.code(404).send({ error: 'el monitor de salud no esta activo en este arranque' });
    return deps.salud.snapshot();
  });

  /** Recalcular ahora, sin esperar al minuto. */
  app.post('/admin/salud/evaluar', async (_request, reply) => {
    if (!deps.salud) return reply.code(404).send({ error: 'el monitor de salud no esta activo en este arranque' });
    const riesgo = await deps.salud.evaluar();
    return { ok: true, riesgo };
  });

  /** Una persona levanta la pausa automatica; se vuelve despacio (rampa). */
  app.post('/admin/salud/reanudar', async (request, reply) => {
    if (!deps.salud) return reply.code(404).send({ error: 'el monitor de salud no esta activo en este arranque' });
    const body = z.object({ motivo: z.string().max(200).optional() }).parse(request.body ?? {});
    await deps.salud.reanudar(body.motivo?.trim() || 'desde el panel');
    await queue.resume();
    return { ok: true, snapshot: await deps.salud.snapshot() };
  });

  /** Levantar la supresion de un contacto a mano (p. ej. ya instalo WhatsApp). */
  app.post('/admin/salud/contactos/levantar', async (request) => {
    const body = z.object({ phone: phoneSchema }).parse(request.body);
    await repos.contacts.levantarSupresion(body.phone);
    await deps.salud?.registrarEvento('supresion', 'LEVANTADA', `${body.phone}: a mano desde el panel`);
    return { ok: true };
  });

  /**
   * Pide a Meta la calidad y el tier reales del numero. Los webhooks solo
   * avisan de cambios: si el numero ya estaba en amarillo antes de suscribir
   * el webhook, esta es la unica forma de enterarse.
   */
  app.post('/admin/number/sync', async () => {
    const info = await wa.getPhoneNumber();
    const id = phoneNumberId();
    const quality = info.qualityRating;
    if (quality === 'GREEN' || quality === 'YELLOW' || quality === 'RED') {
      await repos.numberState.setQuality(id, quality);
    }
    await repos.numberState.setTier(id, info.messagingLimitTier || null);
    return { number: await repos.numberState.get(id), info };
  });

  app.post('/admin/pause', async (request) => {
    const body = z.object({ paused: z.boolean(), reason: z.string().optional() }).parse(request.body);
    await repos.numberState.setPaused(phoneNumberId(), body.paused, body.reason);
    if (body.paused) await queue.pause();
    else await queue.resume();
    return { ok: true };
  });

  // --- plantillas -------------------------------------------------------
  app.get('/admin/templates', async () => repos.templates.list());

  /** El catalogo local con su lint y, si ya esta en Meta, su estado. */
  /** Una plantilla del registro como la ve el linter y el push a Meta. */
  const comoCatalogo = (t: Awaited<ReturnType<typeof repos.templates.list>>[number]): CatalogTemplate => ({
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body ?? '',
    variables: t.variablesDoc?.length ? t.variablesDoc : Array.from({ length: t.variables }, (_, i) => `variable ${i + 1}`),
    footer: t.footer ?? undefined,
  });

  app.get('/admin/templates/catalog', async () => {
    const local = await repos.templates.list();
    const delCatalogo = CATALOG.map((template) => ({
      ...template,
      propia: false,
      issues: lintTemplate(template),
      registry:
        local.find((t) => t.name === template.name && t.language === template.language) ?? null,
    }));
    // Las propias, creadas desde el panel, se listan igual: con su lint y su estado.
    const propias = local
      .filter((t) => t.propia)
      .map((t) => ({ ...comoCatalogo(t), propia: true, issues: lintTemplate(comoCatalogo(t)), registry: t }));
    return [...delCatalogo, ...propias];
  });

  /**
   * Crear o editar una plantilla propia desde el panel.
   *
   * Con la API oficial queda PENDING hasta que se suba y Meta la apruebe;
   * con un cliente no oficial no hay a quien pedir permiso y queda APPROVED
   * en el acto (se manda como texto con las variables sustituidas). Nunca
   * se guarda con errores de lint: una plantilla rechazada es tiempo perdido.
   */
  const propiaSchema = z.object({
    name: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .regex(/^[a-z0-9_]+$/, 'solo minusculas, numeros y guion bajo (asi lo exige Meta)'),
    language: z.string().trim().min(2).max(10).default('es'),
    category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).default('UTILITY'),
    body: z.string().trim().min(10).max(1024),
    /** Que significa cada {{n}}, en orden. */
    variables: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
    footer: z.string().trim().max(60).optional(),
  });

  app.post('/admin/templates', async (request, reply) => {
    const body = propiaSchema.parse(request.body ?? {});
    const cuantas = countVariables(body.body);
    if (body.variables.length !== cuantas) {
      return reply.code(400).send({
        error: `El cuerpo tiene ${cuantas} variable(s) y se describieron ${body.variables.length}: describe cada {{n}} en orden.`,
      });
    }
    if (CATALOG.some((t) => t.name === body.name && t.language === body.language)) {
      return reply.code(400).send({ error: 'Ese nombre es de una plantilla del catalogo: elige otro.' });
    }
    const existente = await repos.templates.get(body.name, body.language);
    if (existente && !existente.propia) {
      return reply.code(400).send({ error: 'Esa plantilla vino de Meta, no se edita desde aqui.' });
    }
    const catalogo: CatalogTemplate = {
      name: body.name,
      language: body.language,
      category: body.category,
      body: body.body,
      variables: body.variables,
      footer: body.footer,
    };
    const issues = lintTemplate(catalogo);
    if (hasErrors(issues)) {
      return reply.code(400).send({ error: 'La plantilla tiene errores que Meta rechazaria.', issues });
    }
    const esCloud = providerOf(settings.current()) === 'cloud';
    await repos.templates.upsert({
      name: body.name,
      language: body.language,
      category: body.category,
      // Editar una plantilla ya aprobada por Meta la deja pendiente otra vez:
      // lo aprobado fue el texto anterior.
      status: esCloud ? 'PENDING' : 'APPROVED',
      quality: existente?.quality ?? null,
      variables: cuantas,
      body: body.body,
      propia: true,
      variablesDoc: body.variables,
      footer: body.footer ?? null,
    });
    return { ok: true, template: await repos.templates.get(body.name, body.language), issues, subirAMeta: esCloud };
  });

  app.delete<{ Params: { name: string; language: string } }>('/admin/templates/:name/:language', async (request, reply) => {
    const borrada = await repos.templates.remove(request.params.name, request.params.language);
    if (!borrada) return reply.code(400).send({ error: 'Solo se borran las plantillas propias, y esa no lo es (o no existe).' });
    return { ok: true };
  });

  app.post('/admin/templates/sync', async () => {
    const templates = await syncTemplates(wa, repos);
    return { synced: templates.length, templates };
  });

  app.post('/admin/templates/push', async (request, reply) => {
    const body = z.object({ names: z.array(z.string()).optional() }).parse(request.body ?? {});
    // Las propias se suben igual que las del catalogo.
    const propias = (await repos.templates.list()).filter((t) => t.propia).map(comoCatalogo);
    const todas = [...CATALOG, ...propias];
    const selected = body.names?.length ? todas.filter((t) => body.names!.includes(t.name)) : todas;
    if (!selected.length) {
      return reply.code(400).send({ error: 'ninguna de esas plantillas esta en el catalogo' });
    }
    const results = await pushTemplates(wa, repos, selected);
    return { results, ok: results.every((r) => r.ok) };
  });

  // --- campanas: por goteo y con canario. Ver src/campanas/goteo.ts -----
  app.post('/admin/campaigns', async (request, reply) => {
    const body = campaignSchema.parse(request.body);
    const sinPlan = deps.plan?.motivo('campanas');
    if (sinPlan) return reply.code(402).send({ error: sinPlan });
    const resultado = await crearCampana(repos, {
      name: body.name,
      templateName: body.templateName,
      templateLanguage: body.templateLanguage,
      category: body.category as TemplateCategory,
      recipients: body.recipients,
      ritmoPorHora: body.ritmoPorHora ?? null,
      canario: body.canario,
      canarioEsperaMin: body.canarioEsperaMin,
    });
    if (!resultado.ok) return reply.code(400).send({ error: resultado.error });
    const { ok: _ok, ...resto } = resultado;
    return resto;
  });

  /** Lista con conteo por estado de entrega y de destinatarios. */
  app.get('/admin/campaigns', async () => repos.campaigns.list());

  /** Pausar, reanudar o parar del todo una campana. */
  app.post<{ Params: { id: string } }>('/admin/campaigns/:id/estado', async (request, reply) => {
    const body = z.object({ accion: z.enum(['pausar', 'reanudar', 'parar']), motivo: z.string().max(200).optional() }).parse(request.body);
    const campaign = await repos.campaigns.get(request.params.id);
    if (!campaign) return reply.code(404).send({ error: 'campana no encontrada' });

    if (body.accion === 'pausar') {
      if (!['running', 'canary'].includes(campaign.status)) {
        return reply.code(400).send({ error: `la campana esta ${campaign.status}: no se puede pausar` });
      }
      await repos.campaigns.setStatus(campaign.id, 'paused', body.motivo?.trim() || 'pausa manual');
    } else if (body.accion === 'reanudar') {
      if (campaign.status !== 'paused') {
        return reply.code(400).send({ error: `la campana esta ${campaign.status}: no hay nada que reanudar` });
      }
      // Reanudar a mano tras el canario es decir "vi las cifras y sigo".
      await repos.campaigns.setStatus(campaign.id, 'running');
      await deps.salud?.registrarEvento('campana', 'REANUDADA', `${campaign.name}: a mano (${body.motivo ?? 'sin motivo'})`, {
        campaignId: campaign.id,
      });
    } else {
      const cancelados = await repos.campaigns.cancelarPendientes(campaign.id, body.motivo?.trim() || 'campana parada');
      await repos.campaigns.setStatus(campaign.id, 'stopped', body.motivo?.trim() || 'parada a mano');
      return { ok: true, cancelados, campaign: await repos.campaigns.get(campaign.id) };
    }
    return { ok: true, campaign: await repos.campaigns.get(campaign.id) };
  });

  /** Un tick del goteo ahora mismo, sin esperar al ticker. */
  app.post('/admin/campaigns/goteo', async () => {
    const resultado = await correrGoteo({ repos, sender, salud: deps.salud, politica: deps.politica });
    return { ok: true, ...resultado };
  });

  app.get<{ Params: { id: string } }>('/admin/campaigns/:id', async (request, reply) => {
    const campaign = await repos.campaigns.get(request.params.id);
    if (!campaign) return reply.code(404).send({ error: 'campana no encontrada' });
    return {
      ...campaign,
      stats: await repos.deliveries.campaignStats(campaign.id),
      destinatarios: await repos.campaigns.cifrasDestinatarios(campaign.id),
      canarioCifras: campaign.canario ? await repos.campaigns.resumenCanario(campaign.id) : null,
    };
  });

  app.get<{ Params: { id: string } }>('/admin/campaigns/:id/stats', async (request) => {
    return repos.deliveries.campaignStats(request.params.id);
  });

  // --- entregas: cada intento, salga o no ---------------------------------
  app.get('/admin/deliveries', async (request) => {
    const query = pageSchema
      .extend({
        status: z
          .enum(['queued', 'sent', 'delivered', 'read', 'failed', 'blocked_by_gate'])
          .optional(),
        campaignId: z.string().optional(),
        phone: z.string().optional(),
      })
      .parse(request.query ?? {});
    return repos.deliveries.listRecent({
      ...query,
      phone: query.phone ? normalizePhone(query.phone) : undefined,
    });
  });

  /** El historial entero (con los mismos filtros) para Excel. */
  app.get('/admin/deliveries.csv', async (request, reply) => {
    const query = z
      .object({
        status: z.enum(['queued', 'sent', 'delivered', 'read', 'failed', 'blocked_by_gate']).optional(),
        campaignId: z.string().optional(),
        phone: z.string().optional(),
      })
      .parse(request.query ?? {});
    const items = await repos.deliveries.listRecent({ ...query, phone: query.phone ? normalizePhone(query.phone) : undefined, limit: 5000, offset: 0 });
    const csv = aCsvCon(
      [
        ['fecha', (d) => d.sentAt ?? d.queuedAt],
        ['telefono', (d) => d.phone],
        ['nombre', (d) => d.name],
        ['tipo', (d) => d.kind],
        ['plantilla', (d) => d.templateName],
        ['categoria', (d) => d.category],
        ['estado', (d) => d.status],
        ['error', (d) => (d.errorCode ? `${d.errorCode} ${d.errorTitle ?? ''}`.trim() : '')],
        ['campana', (d) => d.campaignName],
        ['entregado', (d) => d.deliveredAt],
      ],
      items,
    );
    return reply.type('text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="historial-envios.csv"').send(csv);
  });

  // --- ubicaciones recibidas --------------------------------------------
  app.get('/admin/locations', async (request) => {
    const query = pageSchema.extend({ phone: z.string().optional() }).parse(request.query ?? {});
    return repos.locations.listRecent({
      ...query,
      phone: query.phone ? normalizePhone(query.phone) : undefined,
    });
  });

  // --- rastreo en vivo --------------------------------------------------
  app.post('/admin/tracking', async (request, reply) => {
    const body = trackingSchema.parse(request.body);

    const contact = body.phone ? await repos.contacts.getByPhone(body.phone) : null;
    if (body.phone && !contact) return reply.code(404).send({ error: 'contacto no encontrado' });

    const session = await createTrackingSession(
      { repos, config },
      { contactId: contact?.id ?? null, label: body.label, ttlMinutes: body.ttlMinutes },
    );

    let notified: Awaited<ReturnType<Sender['send']>> | null = null;
    if (body.notify && contact) {
      notified = await sender.send({
        phone: contact.phone,
        kind: 'freeform',
        category: 'UTILITY',
        text: `Sigue la entrega en vivo aqui:\n${session.viewUrl}\n\nEl enlace caduca el ${session.expiresAt.toLocaleString('es-PE')}.`,
      });
    }

    return { ...session, notified };
  });

  /** Sesiones vigentes con sus enlaces regenerados y cuantos las miran. */
  app.get('/admin/tracking', async () => {
    const active = await repos.tracking.listActive(new Date());
    return active.map((link) => {
      const urls = buildTrackingUrls(
        link.id,
        link.expiresAt,
        config.TRACKING_SECRET,
        config.PUBLIC_BASE_URL,
      );
      return {
        ...link,
        publishUrl: urls.publishUrl,
        viewUrl: urls.viewUrl,
        viewers: hub.viewerCount(link.id),
      };
    });
  });

  app.delete<{ Params: { id: string } }>('/admin/tracking/:id', async (request) => {
    await repos.tracking.revoke(request.params.id);
    hub.close(request.params.id, 'revocada desde el panel');
    return { ok: true };
  });

  // --- envios sueltos desde el panel ------------------------------------
  app.post('/admin/messages/text', async (request) => {
    const body = z.object({ phone: phoneSchema, text: z.string().min(1) }).parse(request.body);
    const outcome = await sender.send({
      phone: body.phone,
      kind: 'freeform',
      category: 'UTILITY',
      text: body.text,
    });
    return outcome;
  });

  /**
   * Acepta un link de mapa o unas coordenadas: el geo core saca lat/lng y se
   * manda el pin. Es la misma extraccion que corre sobre los mensajes
   * entrantes, asi que lo que se ve aqui es lo que hara el bot.
   */
  app.post('/admin/messages/location', async (request, reply) => {
    const body = z
      .object({ phone: phoneSchema, input: z.string().min(1), name: z.string().optional() })
      .parse(request.body);

    const result = await extractLocation(body.input, { bbox: config.bbox });
    if (!result.ok) {
      return reply.code(400).send({ error: `no se encontraron coordenadas: ${result.reason}`, result });
    }

    const outcome = await sender.send({
      phone: body.phone,
      kind: 'location',
      category: 'UTILITY',
      location: { latitude: result.lat, longitude: result.lng, name: body.name },
    });

    return { ...outcome, location: result };
  });

  /**
   * Un mensaje con botones de respuesta rapida.
   *
   * Es lo que usa la preventa para no obligar al cliente a escribir: pulsa y
   * la respuesta vuelve como si la hubiera tecleado. Donde WhatsApp no los
   * pinte, el cliente ve una lista numerada y responde con el numero.
   */
  app.post('/admin/messages/buttons', async (request) => {
    const body = z
      .object({
        phone: phoneSchema,
        body: z.string().min(1).max(1024),
        // WhatsApp no pinta mas de tres; pedir mas es pedir que se corten.
        buttons: z
          .array(z.object({ id: z.string().min(1).max(256), title: z.string().min(1).max(20) }))
          .min(1)
          .max(3),
      })
      .parse(request.body);

    return sender.send({
      phone: body.phone,
      kind: 'interactive',
      category: 'UTILITY',
      interactive: { body: body.body, buttons: body.buttons },
    });
  });

  app.post('/admin/messages/ask-location', async (request) => {
    const body = z
      .object({ phone: phoneSchema, text: z.string().optional() })
      .parse(request.body);

    return sender.send({
      phone: body.phone,
      kind: 'interactive',
      category: 'UTILITY',
      interactive: {
        body:
          body.text ??
          (providerOf(settings.current()) === 'cloud' || config.WHATSAPP_NATIVE_BUTTONS
            ? 'Comparte tu ubicación con el botón de aquí abajo, por favor.'
            : '¿Nos compartes tu ubicación, por favor? Desde el clip 📎 → Ubicación → Enviar tu ubicación actual.'),
        locationRequest: true,
      },
    });
  });

  /** Extractor de coordenadas expuesto tal cual; no envia nada. */
  app.post('/admin/geo/extract', async (request) => {
    const body = z.object({ input: z.string().min(1) }).parse(request.body);
    return extractLocation(body.input, { bbox: config.bbox });
  });

  // --- contactos --------------------------------------------------------
  app.get('/admin/contacts', async (request) => {
    const query = pageSchema
      .extend({
        q: z.string().max(120).optional(),
        state: z.enum(['all', 'opted_in', 'opted_out', 'pending']).default('all'),
        /**
         * ?sinUbicacion=1 : solo los que nunca mandaron el pin.
         *
         * Es la lista a la que hay que insistirle. En cuanto uno manda su
         * ubicacion desaparece de aqui solo.
         */
        sinUbicacion: z.coerce.boolean().optional(),
      })
      .parse(request.query ?? {});
    return repos.contacts.list(query);
  });

  /** Alta masiva con consentimiento: es el paso 6 de la puesta en marcha. */
  app.post('/admin/contacts/import', async (request, reply) => {
    const body = importSchema.parse(request.body);
    const entries = [...(body.contacts ?? []), ...(body.text ? parseContactLines(body.text) : [])];
    if (!entries.length) {
      return reply.code(400).send({ error: 'no llego ningun contacto valido' });
    }
    const imported = await repos.contacts.bulkOptIn(entries, body.source);
    return { imported, received: entries.length };
  });

  app.post('/admin/contacts/opt-in', async (request) => {
    const body = z
      .object({ phone: phoneSchema, source: z.string().min(1), name: z.string().optional() })
      .parse(request.body);
    await repos.contacts.upsertFromInbound(body.phone, body.name);
    await repos.contacts.setOptIn(body.phone, body.source);
    return { ok: true, contact: await repos.contacts.getByPhone(body.phone) };
  });

  app.post('/admin/contacts/opt-out', async (request) => {
    const body = z.object({ phone: phoneSchema }).parse(request.body);
    await repos.contacts.upsertFromInbound(body.phone);
    await repos.contacts.setOptOut(body.phone);
    return { ok: true, contact: await repos.contacts.getByPhone(body.phone) };
  });
}
