/**
 * Una tienda entera, armada con lo suyo y con nada de nadie mas.
 *
 * Es el mismo montaje que hacian `scripts/quick.ts` y `src/main.ts` para la
 * unica tienda de una instalacion, pero con todo lo que guarda o conecta
 * pasado por parametro:
 *
 *   - su BASE: una base propia del servidor MySQL/MariaDB (<raiz>_t_<id>)
 *     con la conexion apuntando a ella. Las consultas del proyecto no nombran
 *     base, asi que una tienda no puede leer las tablas de otra aunque
 *     quisiera;
 *   - su SESION DE WHATSAPP (`crearSesionLocal`) y su carpeta de vinculacion:
 *     cada tienda escanea su QR y su numero no lo ve nadie mas;
 *   - sus carpetas de adjuntos, respaldos y copias;
 *   - sus SECRETOS (.secrets.json): la clave que cifra sus credenciales y la
 *     que firma sus cookies y enlaces. Una cookie de una tienda no vale en
 *     otra: la firma no cuadra;
 *   - su CONFIGURACION: la plataforma le pasa un entorno filtrado, sin los
 *     tokens de Meta, GSG, Stoky ni el supervisor de otra tienda;
 *   - su COLA de envios (en Redis, con su nombre; si no, en memoria).
 *
 * Ver src/plataforma/plataforma.ts, que es quien las crea, las guarda y les
 * reparte las peticiones.
 */

import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type Config } from '../config.js';
import { buildServer } from '../server.js';
import { createSender, type SendJob, type SendOutcome } from '../outbound/sender.js';
import { createMemoryOutboundQueue } from '../outbound/memory-queue.js';
import { createOutboundQueue, createOutboundWorker, type OutboundQueue } from '../outbound/queue.js';
import { createRepos, createSettingsRepo, type Repos } from '../db/repos.js';
import { baseDeLaUrl, createPool, type Pool } from '../db/pool.js';
import { prepararBase, type OpcionesBanco } from '../db/bases.js';
import { crearCacheGeoSql, crearGeocodificadorNominatim, type Geocodificador } from '../entregas/geocodificar.js';
import { migrate } from '../db/migrate.js';
import type { LocalSecrets } from '../settings/crypto.js';
import { providerOf, createSettingsService } from '../settings/service.js';
import { createDynamicWhatsAppClient } from '../whatsapp/dynamic.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import { crearSesionLocal, type SesionLocal } from '../whatsapp/local/session.js';
import { crearConexionStoky } from '../stoky/conexion.js';
import { crearServicioPlan, type EstadoInstancia } from '../plan/servicio.js';
import { versionDelPaquete } from '../util/version.js';
import { CATALOG } from '../templates/catalog.js';
import { countVariables } from '../templates/render.js';
import { politicaDesdeConfig } from '../salud/politica.js';
import { crearMonitor } from '../salud/monitor.js';
import { arrancarServicios } from '../servicios.js';
import { crearServicioAjustes, type ServicioAjustes } from '../ajustes/generales.js';
import { crearServicioStickers } from '../stickers/stickers.js';
import { crearBus } from '../eventos/bus.js';
import { observarRepos } from '../eventos/observar.js';
import { crearServicioIA } from '../ia/servicio.js';
import { crearServicioEntrenamiento, iaParaEntrenar } from '../entrenamiento/servicio.js';
import { crearServicioVoz } from '../voz/servicio.js';
import { crearServicioEnvioAutomatico } from '../envio-automatico/servicio.js';
import { opcionesDesdeConfig } from '../rutas/motor.js';
import { PLANES } from '../rutas/telefono.js';
import { crearConexionGsg, TOKEN_SIMULADOR } from '../rutas/conexion-gsg.js';
import { crearGsgSimulado } from '../entregas/gsg-simulado.js';
import { crearServicioEntregas } from '../entregas/servicio.js';
import { crearServicioResumenes } from '../resumenes/servicio.js';
import { crearServicioProcesos } from '../procesos/servicio.js';
import { cargarLote } from '../rutas/cargar.js';
import { crearFiabilidad } from '../salud/fiabilidad.js';
import type { ServicioCorreo } from '../salud/correo.js';
import { CABECERA_INTERNA, CABECERA_USUARIO_INTERNO, type DirectorioUsuarios } from '../auth/routes.js';
import { enTienda, type ContextoTienda } from './contexto.js';
import { conReglaGsg } from '../entregas/regla-gsg.js';

/** Donde vive la base de una tienda. */
export interface BaseDeTienda {
  /** El servidor: mysql://usuario:clave@host:3306/<base>. */
  url: string;
  /** La base de ESTA tienda en ese servidor; sin ella, la de la URL (la tienda principal). */
  base?: string;
  /**
   * Bases listas de antemano (ver src/db/bases.ts): si la base de la tienda
   * aun no existe, se queda las tablas de una de ahi en vez de crearlas de
   * cero. Sin banco, se migra desde cero.
   */
  banco?: OpcionesBanco;
}

export interface OpcionesTienda {
  /** Identificador interno (no cambia nunca) y el trozo de la URL (/tienda/<slug>/). */
  id: string;
  slug: string;
  /** El entorno de ESTA tienda, ya filtrado por la plataforma (ver entornoDeTienda). */
  env: NodeJS.ProcessEnv;
  secretos: LocalSecrets;
  base: BaseDeTienda;
  authDir: string;
  mediaDir: string;
  /** Carpeta por defecto de las copias de seguridad de esta tienda. */
  carpetaCopias: string;
  /** Redis para la cola; null = cola en memoria. */
  redisUrl?: string | null;
  nombreCola?: string;
  /** Superadmin solo para la primera tienda de una plataforma vacia (o la instalacion de siempre). */
  primeraCuentaRol: 'superadmin' | 'admin';
  directorio?: DirectorioUsuarios;
  /** Reabrir su WhatsApp si ya estaba vinculado. */
  autoConectarLocal: boolean;
  /**
   * Con el cliente local (sin Meta) las plantillas del catalogo hacen de
   * catalogo aprobado: se siembran como APPROVED si no estaban.
   */
  sembrarPlantillasLocales: boolean;
  /** Logger de Fastify (el arranque corto lo apaga). */
  logger?: boolean;
  /**
   * El buscador de direcciones escritas (Nominatim de OpenStreetMap, gratis).
   * Sin pasarlo: el de verdad, salvo en las pruebas automáticas (VITEST) o con
   * GEOCODIFICAR=no. null = sin buscador (la dirección se guarda y se pide el pin).
   */
  geocodificador?: Geocodificador | null;
  /** Delante de cada linea de log de esta tienda. */
  prefijoLog: string;
  /**
   * Solo para las pruebas de punta a punta: un WhatsApp de mentira en vez del
   * de verdad (que necesita escanear un QR con un telefono). Todo lo demas es
   * lo de produccion.
   */
  waParaPruebas?: WhatsAppClient;
}

export interface TiendaViva {
  id: string;
  slug: string;
  app: FastifyInstance;
  config: Config;
  repos: Repos;
  ajustes: ServicioAjustes;
  sesion: SesionLocal;
  /** La base de esta tienda (para mirar dentro en las pruebas y en el Modulo desarrollador). */
  pool: Pool;
  /** El nombre de su base en el servidor. */
  base: string;
  /** Con esto se envuelve cada peticion que se le pasa (ver src/plataforma/contexto.ts). */
  contexto: ContextoTienda;
  /** Las entregas del dia de esta tienda (el Modulo desarrollador cierra su dia de prueba con esto). */
  entregas: import('../entregas/servicio.js').ServicioEntregas;
  /** Las cuentas de esta tienda (para el directorio de la plataforma). */
  usuarios(): Promise<string[]>;
  /** Para todo lo que trabaja solo, cierra el servidor y la base. */
  parar(): Promise<void>;
}

async function abrirBase(base: BaseDeTienda): Promise<{ pool: Pool; nombre: string; cerrar: () => Promise<void> }> {
  const nombre = base.base ?? baseDeLaUrl(base.url);
  if (!nombre) throw new Error('DATABASE_URL no dice qué base usar: termínala con /nombre_de_la_base (por ejemplo mysql://root@127.0.0.1:3306/gsgchat).');
  // Con banco: si la base no existe, sale de una ya lista; si existe, solo
  // se le pasan las migraciones pendientes (lo mismo que migrate).
  if (base.banco) await prepararBase(base.banco, nombre);
  else await migrate(base.url, nombre);
  const pool = createPool(base.url, nombre);
  return { pool, nombre, cerrar: () => pool.end() };
}

export async function armarTienda(o: OpcionesTienda): Promise<TiendaViva> {
  // Todo lo que nace aqui (timers, el socket de WhatsApp, sus eventos) sabe
  // de que tienda es. Ver src/plataforma/contexto.ts. El modo se engancha en
  // cuanto existen los ajustes.
  const contexto: ContextoTienda = { id: o.id, slug: o.slug };
  return enTienda(contexto, async () => {
    const log = (m: string, d?: unknown) => console.warn(`${o.prefijoLog}${m}`, d ?? '');
    const config = loadConfig(o.env);
    const { pool, nombre: nombreBase, cerrar } = await abrirBase(o.base);
    // Lo que ya se abrio, en orden: si algo falla a mitad de armar la tienda
    // (una migracion, un servicio), se cierra todo al reves en vez de dejar la
    // base abierta y temporizadores vivos de una tienda que no existe.
    const limpieza: Array<() => unknown> = [() => cerrar()];
    try {

      const bus = crearBus((m, d) => log(m, d));
      const repos = observarRepos(createRepos(pool), bus);
      const settingsRepo = createSettingsRepo(pool);
      const settings = await createSettingsService(settingsRepo, config, o.secretos.settingsKey);

      const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config });
      contexto.modo = () => ajustes.modo();
      const politica = () => ajustes.politica(politicaDesdeConfig(config, providerOf(settings.current()) === 'cloud' ? 'cloud' : 'no_oficial'));

      const sesion = crearSesionLocal();
      limpieza.push(() => sesion.detener());
      const wa = o.waParaPruebas ?? createDynamicWhatsAppClient(settings, {
        resolveTemplateBody: async (name, language) => (await repos.templates.get(name, language))?.body ?? undefined,
        nativeButtons: config.WHATSAPP_NATIVE_BUTTONS,
        humanizar: () => politica().humanizar,
        sesion,
      });

      const phoneNumberId = () => settings.current().phoneNumberId || 'local';
      let avisarSupervisor: ((texto: string) => Promise<void>) | undefined;
      // La cola se crea mas abajo; el monitor solo la toca al pausar o reanudar.
      let queue: OutboundQueue;
      const salud = crearMonitor({
        repos,
        politica,
        phoneNumberId,
        avisar: (texto) => (avisarSupervisor ? avisarSupervisor(texto) : Promise.resolve()),
        cola: { pause: () => queue.pause(), resume: () => queue.resume() },
        log: (mensaje, detalle) => console.log(`${o.prefijoLog}[salud] ${mensaje}`, detalle ?? ''),
      });

      // La regla del dueño en «Solo lo de GSG» va en la unica puerta hacia el
      // cliente (ver src/entregas/regla-gsg.ts). Las entregas se crean mas abajo.
      let entregasDeLaRegla: Awaited<ReturnType<typeof crearServicioEntregas>> | null = null;
      const sender = conReglaGsg(
        createSender({
          repos,
          wa,
          phoneNumberId,
          warmup: politica().warmup,
          maxMarketingPerContact7d: config.MAX_MARKETING_PER_CONTACT_7D,
          serviceWindowApplies: () => providerOf(settings.current()) === 'cloud',
          salud,
          politica,
          soloNumeros: () => ajustes.soloNumeros(),
        }),
        { entregas: () => entregasDeLaRegla, log: (m, d) => log(`[regla gsg] ${m}`, d) },
      );

      const stickers = crearServicioStickers({ repo: repos.stickers, mediaDir: o.mediaDir, sender, ajustes, publicBase: config.PUBLIC_BASE_URL });

      avisarSupervisor = async (texto) => {
        const destino = politica().avisarA;
        if (!destino) return;
        await sender.send({ phone: destino, kind: 'freeform', category: 'UTILITY', text: texto, manual: true });
      };

      let appRef: FastifyInstance | null = null;
      const onResult = (job: SendJob, outcome: SendOutcome): void => {
        if (outcome.ok) return;
        const detail = outcome.blocked ? `${outcome.code}: ${outcome.reason}` : outcome.error;
        appRef?.log.warn({ phone: job.phone, detail }, 'envio no realizado');
      };
      queue = o.redisUrl ? createOutboundQueue(o.redisUrl, o.nombreCola) : createMemoryOutboundQueue({ sender, onResult });
      const worker = o.redisUrl ? createOutboundWorker({ redisUrl: o.redisUrl, sender, queue, onResult, nombre: o.nombreCola }) : null;
      limpieza.push(() => queue.close(), () => worker?.close());

      const parteDeSalud: { dar: null | (() => Promise<EstadoInstancia>) } = { dar: null };
      const plan = await crearServicioPlan({
        settingsRepo,
        url: config.PLAN_URL,
        token: config.PLAN_TOKEN,
        baseUrl: config.PUBLIC_BASE_URL,
        log: (m, d) => log(m, d),
        estado: () => (parteDeSalud.dar ? parteDeSalud.dar() : { whatsapp: settings.isConfigured() ? 'conectado' : 'sin_conectar', mensajesHoy: 0, fallosIA: 0, entregasHoy: 0, version: versionDelPaquete() }),
      });
      const pararPlan = plan.arrancar();
      limpieza.push(() => pararPlan?.());

      const conexionStoky = await crearConexionStoky({ settingsRepo, settingsKeyBase64: o.secretos.settingsKey, config, log: (m, d) => log(`[stoky] ${m}`, d) });
      const catalogo = conexionStoky.cliente();

      const plantillaPais = PLANES[config.RUTAS_PAIS] ?? PLANES.peru!;
      const lista = crearServicioEnvioAutomatico({ repos, opcionesReparto: opcionesDesdeConfig(config), plan: plantillaPais, salud, log: (m, d) => console.log(`${o.prefijoLog}[wa] ${m}`, d ?? '') });

      const entrenamiento = await crearServicioEntrenamiento({ repo: repos.entrenamiento, nombreNegocio: () => ajustes.nombreNegocio(), log: (m, d) => log(`[entrenamiento] ${m}`, d) });
      await entrenamiento.cargar();

      const voz = await crearServicioVoz({ settingsRepo, settingsKeyBase64: o.secretos.settingsKey, sender, mediaDir: o.mediaDir, log: (m, d) => log(`[voz] ${m}`, d) });

      const conexionGsg = await crearConexionGsg({ settingsRepo, settingsKeyBase64: o.secretos.settingsKey, config, log: (m, d) => log(`[gsg] ${m}`, d) });
      const simuladorGsg = crearGsgSimulado({ token: TOKEN_SIMULADOR });

      // La IA se crea despues de las entregas y estas la piden por funcion.
      let ia!: Awaited<ReturnType<typeof crearServicioIA>>;
      let correoDeAviso: ServicioCorreo | undefined;
      const entregas = await crearServicioEntregas({
        zonaHoraria: () => ajustes.zonaHoraria(),
        repos,
        repo: repos.entregas,
        sender,
        settingsRepo,
        gsg: conexionGsg.puerto(),
        conexionGsg,
        cargarLote: (body) => cargarLote({ repos, plan: plantillaPais, timezone: config.timezone, lista }, body),
        ampliarHorario: (fn) => ajustes.ampliarHorario(fn),
        nombreNegocio: () => ajustes.nombreNegocio(),
        supervisor: () => politica().avisarA,
        ia: () => (ia.estado().tieneToken ? { completar: (mensajes, opts) => ia.completar(mensajes, opts) } : null),
        usarPlantilla: () => providerOf(settings.current()) === 'cloud',
        timezone: config.timezone,
        plan: plantillaPais,
        publicBaseUrl: config.PUBLIC_BASE_URL,
        bus,
        geo: { bbox: config.bbox, zonaSinExtra: config.zonaSinExtra, cobertura: config.coverageName },
        modo: () => ajustes.modo(),
        numeroPropio: () => sesion.getLocalState().phone || null,
        geocodificador:
          o.geocodificador !== undefined
            ? o.geocodificador
            : process.env.VITEST || (o.env.GEOCODIFICAR ?? process.env.GEOCODIFICAR) === 'no'
              ? null
              : crearGeocodificadorNominatim({ userAgent: `GSGchat/1.0 (entregas de ${ajustes.nombreNegocio() || 'una tienda'}; ${config.PUBLIC_BASE_URL})`, cache: crearCacheGeoSql(pool), log: (m, d) => log(`[mapa] ${m}`, d) }),
        log: (m, d) => log(`[entregas] ${m}`, d),
      });
      entregasDeLaRegla = entregas;

      ia = await crearServicioIA({
        settingsRepo,
        settingsKeyBase64: o.secretos.settingsKey,
        repos,
        sender,
        config,
        nombreNegocio: () => ajustes.nombreNegocio(),
        supervisor: () => politica().avisarA,
        catalogo,
        conBoton: () => providerOf(settings.current()) === 'cloud' || config.WHATSAPP_NATIVE_BUTTONS,
        lista,
        bus,
        entrenamiento,
        plan,
        voz,
        entregas,
        modo: () => ajustes.modo(),
        // El correo de aviso vive en «Que todo funcione», que se crea después.
        correo: () => correoDeAviso,
        log: (m, d) => log(m, d),
      });
      entrenamiento.conectarIA(iaParaEntrenar(ia));
      parteDeSalud.dar = async () => ({
        whatsapp: !settings.isConfigured() ? 'sin_conectar' : (wa.conectado?.() ?? true) ? 'conectado' : 'caido',
        mensajesHoy: (await salud.snapshot()).ritmo.hoy,
        fallosIA: ia.uso().hoy.fallos,
        entregasHoy: (await entregas.resumen()).cifras.total,
        version: versionDelPaquete(),
      });

      // Los procesos de esta tienda. La principal (GSG Courier) trae activas las
      // entregas de courier; una tienda nueva empieza sin ellas y las activa
      // desde Procesos si las usa. Ver src/procesos.
      const procesos = await crearServicioProcesos({
        repos,
        sender,
        nombreNegocio: () => ajustes.nombreNegocio(),
        timezone: config.timezone,
        plan: plantillaPais,
        distritos: config.distritos,
        gsgPorDefecto: o.id === 'principal',
        opciones: opcionesDesdeConfig(config),
        salud,
        politica,
        clasificar: () => (ia.activa() ? (m) => ia.clasificarOperativo(m) : undefined),
        log: (m, d) => log(`[procesos] ${m}`, d),
      });
      await procesos.cargar();
      contexto.gsg = () => procesos.gsgActivo();

      const resumenes = await crearServicioResumenes({
        settingsRepo,
        sender,
        ajustes: () => ajustes.resumenes(),
        supervisor: () => politica().avisarA,
        nombreNegocio: () => ajustes.nombreNegocio(),
        entregas,
        ia: () => (ia.estado().tieneToken ? { completar: (m, op) => ia.completar(m, op) } : null),
        whatsappConectado: () => settings.isConfigured() && (wa.conectado?.() ?? true),
        zonaHoraria: () => ajustes.zonaHoraria(),
        timezone: config.timezone,
        publicBaseUrl: config.PUBLIC_BASE_URL,
        // Los descartes y el cuadre de GSG de ESTA tienda, no los de la ultima creada.
        gsgExtras: () => conexionGsg.extras,
        log: (m, d) => log(`[resumenes] ${m}`, d),
      });

      if (o.sembrarPlantillasLocales) {
        for (const template of CATALOG) {
          if (await repos.templates.get(template.name, template.language)) continue;
          await repos.templates.upsert({
            name: template.name,
            language: template.language,
            category: template.category,
            body: template.body,
            variables: countVariables(template.body),
            status: 'APPROVED',
            quality: null,
          });
        }
      }

      const secretoInterno = randomBytes(24).toString('hex');
      let reconectarLocal: (() => Promise<unknown>) | undefined;
      const fiabilidad = await crearFiabilidad({
        settingsRepo,
        settingsKeyBase64: o.secretos.settingsKey,
        salud,
        timezone: () => ajustes.zonaHoraria(),
        log: (m, d) => log(`[fiabilidad] ${m}`, d),
        vigilante: {
          conectado: () => wa.conectado?.(),
          proveedor: () => (settings.isConfigured() ? providerOf(settings.current()) : null),
          estadoLocal: () => sesion.getLocalState(),
          reconectar: () => (reconectarLocal ? reconectarLocal() : Promise.resolve()),
          avisarWhatsApp: async (texto) => {
            const destino = politica().avisarA;
            if (!destino) return { ok: false, detalle: 'no hay número del supervisor' };
            const r = await sender.send({ phone: destino, kind: 'freeform', category: 'UTILITY', text: texto, manual: true, origen: 'sistema' });
            return { ok: r.ok, detalle: r.ok ? undefined : r.blocked ? r.reason : r.error };
          },
        },
        humo: {
          sender,
          supervisor: () => politica().avisarA,
          deliveries: repos.deliveries,
          conexionGsg,
          ia,
          entregas,
          carpetas: () => [o.mediaDir, path.resolve(config.ARCHIVE_DIR)],
        },
        cupo: { entregas, lista, reparto: () => lista.ajustesReparto() },
        respaldo: {
          baseDatos: () => ({ tipo: 'mysql', url: o.base.url, base: nombreBase }),
          archiveDir: config.ARCHIVE_DIR,
          carpetaPorDefecto: o.carpetaCopias,
          // Una tienda recien creada no se copia al nacer: su primera copia, la proxima noche.
          primeraCopiaLaProximaNoche: true,
        },
      });
      correoDeAviso = fiabilidad.correo;

      const app = await buildServer({
        config,
        repos,
        settings,
        settingsRepo,
        wa,
        sender,
        queue,
        catalogo,
        logger: o.logger ?? false,
        salud,
        politica,
        ajustes,
        stickers,
        bus,
        ia,
        entrenamiento,
        conexionStoky,
        plan,
        lista,
        voz,
        entregas,
        conexionGsg,
        simuladorGsg,
        resumenes,
        fiabilidad,
        procesos,
        secretoInterno,
        mediaDir: o.mediaDir,
        autoConectarLocal: o.autoConectarLocal,
        sesionLocal: sesion,
        authDir: o.authDir,
        prefijoLog: `${o.prefijoLog}[wa]`,
        primeraCuentaRol: o.primeraCuentaRol,
        directorio: o.directorio,
      });
      appRef = app;
      limpieza.push(() => app.close());
      reconectarLocal = () =>
        app.inject({
          method: 'POST',
          url: '/admin/local/connect',
          headers: { [CABECERA_INTERNA]: secretoInterno, [CABECERA_USUARIO_INTERNO]: JSON.stringify({ id: 'vigilante', usuario: 'vigilante', nombre: 'Vigilante del WhatsApp', rol: 'admin', permisos: [] }) },
        });

      const consola = {
        info: (detalle: unknown, mensaje?: string) => console.log(`${o.prefijoLog}[wa] ${mensaje ?? ''}`, resumir(detalle)),
        warn: (detalle: unknown, mensaje?: string) => console.warn(`${o.prefijoLog}[wa] ${mensaje ?? ''}`, resumir(detalle)),
      };
      const pararServicios = arrancarServicios({
        config,
        repos,
        settings,
        wa,
        sender,
        salud,
        politica,
        ajustes,
        stickers,
        bus,
        lista,
        gsg: conexionGsg.puerto(),
        entregas,
        ia,
        resumenes,
        fiabilidad,
        procesos,
        log: consola as never,
      });
      limpieza.push(() => pararServicios());

      // El catalogo de Stoky se trae antes de que escriba el primer cliente;
      // sin esperar: una tienda con Stoky caido no retrasa a las demas.
      if (conexionStoky.estado().configurada) {
        void Promise.all([catalogo.ping(), catalogo.precargar()])
          .then(([estado, precarga]) => log(estado.ok ? `Stoky conectado: ${estado.tenant} / ${estado.warehouse} (${precarga.total} productos)` : `Stoky NO responde: ${estado.detail}`))
          .catch((error: unknown) => log(`Stoky no se pudo precargar: ${String(error)}`));
      }

      // onReady reabre la sesion de WhatsApp guardada (registerLocalRoutes).
      await app.ready();

      let parada = false;
      return {
        id: o.id,
        slug: o.slug,
        app,
        config,
        repos,
        ajustes,
        sesion,
        pool,
        base: nombreBase,
        contexto,
        entregas,
        usuarios: async () => (await repos.usuarios.listar()).map((u) => u.usuario),
        parar: async () => {
          if (parada) return;
          parada = true;
          pararServicios();
          pararPlan?.();
          await worker?.close().catch(() => undefined);
          await queue.close().catch(() => undefined);
          await app.close().catch(() => undefined);
          // Sin socket vivo que siga guardando en una carpeta que quiza se borra.
          sesion.detener();
          await cerrar().catch(() => undefined);
        },
      };
    } catch (error) {
      for (const deshacer of limpieza.reverse()) {
        try {
          await deshacer();
        } catch {
          // lo demas se cierra igual
        }
      }
      throw error;
    }
  });
}

function resumir(detalle: unknown): string {
  if (!detalle || (typeof detalle === 'object' && !Object.keys(detalle as object).length)) return '';
  try {
    return JSON.stringify(detalle);
  } catch {
    return String(detalle);
  }
}
