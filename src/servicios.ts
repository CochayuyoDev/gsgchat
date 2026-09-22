/**
 * Los procesos de fondo que hacen que el sistema trabaje solo.
 *
 * Existe porque habia dos arranques -`npm run dev` y `npm run quick`- y solo
 * el primero levantaba los tickers. Con el arranque corto (el que usa
 * Baileys) las secuencias, el motor de rutas y los avisos no corrian: se
 * podia cargar un lote y no salia nada. Ahora los dos arranques llaman aqui.
 *
 * Que se levanta, y cada cuanto:
 *
 *  - el monitor de salud (cada minuto): riesgo, factor, pausa y rampa;
 *  - el ticker de secuencias y programados (cada 10 s);
 *  - el goteo de campanas (cada 10 s, cinco como mucho por pasada);
 *  - el motor de rutas (cada 5 s, pero con su pausa de 15-30 s entre envios);
 *  - el motor de la lista de envio automatico (igual: cada 5 s, con la misma
 *    pausa y un mensaje por numero cada pocas horas);
 *  - los avisos de rutas (resumen a GSG y WhatsApp al coordinador);
 *  - el despacho de reportes a GSG (cada minuto; sin API no hace nada);
 *  - los webhooks salientes: cada evento del bus se encola por suscriptor y
 *    se entrega cada 10 s, con reintentos (ver src/webhooks);
 *  - el barrido de conversaciones inactivas;
 *  - con la API oficial, la sincronizacion de plantillas cada media hora.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';
import type { Repos } from './db/repos.js';
import type { Sender } from './outbound/sender.js';
import type { WhatsAppClient } from './whatsapp/client.js';
import type { SettingsService } from './settings/service.js';
import { providerOf } from './settings/service.js';
import type { Monitor } from './salud/monitor.js';
import { startMonitorSalud } from './salud/monitor.js';
import type { Politica } from './salud/politica.js';
import type { ServicioAjustes } from './ajustes/generales.js';
import type { ServicioStickers } from './stickers/stickers.js';
import { startScheduler } from './automation/engine.js';
import { startGoteo } from './campanas/goteo.js';
import { startArchiveSweeper } from './archive/service.js';
import { opcionesDesdeConfig, startMotorRutas } from './rutas/motor.js';
import { crearPuertoGsg, despacharReportes } from './rutas/gsg.js';
import { startAlertas } from './rutas/alertas.js';
import { startMotorLista } from './envio-automatico/motor.js';
import type { ServicioEnvioAutomatico } from './envio-automatico/servicio.js';
import { syncTemplates } from './templates/registry.js';
import type { Bus } from './eventos/bus.js';
import { encolarEventos, startDespachadorWebhooks } from './webhooks/despachador.js';
import type { PuertoGsg } from './rutas/gsg.js';
import type { ServicioEntregas } from './entregas/servicio.js';
import { startMotorEntregas } from './entregas/motor.js';
import type { ServicioFiabilidad } from './salud/fiabilidad.js';
import { startResumenes, type ServicioResumenes } from './resumenes/servicio.js';

export interface ServiciosDeps {
  config: Config;
  repos: Repos;
  settings: SettingsService;
  wa: WhatsAppClient;
  sender: Sender;
  salud: Monitor;
  politica: () => Politica;
  /** Los ajustes generales editables desde la pantalla. */
  ajustes?: ServicioAjustes;
  /** Los stickers automaticos del reparto. */
  stickers?: ServicioStickers;
  /** El bus de eventos. Sin el, no hay webhooks salientes (arranques de prueba). */
  bus?: Bus;
  /** La lista de envio automatico. Sin ella, su motor no arranca. */
  lista?: ServicioEnvioAutomatico;
  /** La puerta a GSG (la configurable desde la pantalla). Sin ella, la del .env. */
  gsg?: PuertoGsg;
  /** Las entregas del dia. Sin ellas, su motor no arranca. */
  entregas?: ServicioEntregas;
  /** El asistente de IA: resume las conversaciones guardadas. */
  ia?: import('./ia/servicio.js').ServicioIA;
  /** "Que todo funcione": vigilante del WhatsApp, pruebas de la manana y copia diaria. Sin el, no arrancan. */
  fiabilidad?: ServicioFiabilidad;
  /** El resumen de la mañana y de la tarde al supervisor. Sin el, no se manda. */
  resumenes?: ServicioResumenes;
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>;
}

/** Arranca todo y devuelve la funcion que lo para. */
export function arrancarServicios(deps: ServiciosDeps): () => void {
  const { config, repos, settings, wa, sender, salud, politica, ajustes, stickers, bus, lista, entregas, log } = deps;
  const warn = (mensaje: string, detalle?: Record<string, unknown>) => log.warn(detalle ?? {}, mensaje);
  const info = (mensaje: string, detalle?: Record<string, unknown>) => log.info(detalle ?? {}, mensaje);

  // El monitor de salud evalua cada minuto (y una vez ahora).
  const stopMonitor = startMonitorSalud(salud, warn);

  // Seguimientos y mensajes programados: se procesan cada 10 s.
  const stopScheduler = startScheduler({ repos, sender, log: warn });

  // Campanas por goteo: cada 10 s salen como mucho cinco, y solo si el
  // marcapasos lo permite. Ver src/campanas/goteo.ts.
  const stopGoteo = startGoteo({ repos, sender, salud, politica, log: warn });

  // Con la API oficial, el estado de las plantillas se refresca cada media
  // hora: del final de una pausa Meta no avisa por webhook, y una plantilla
  // que sigue marcada como pausada cuando ya no lo esta es trabajo parado.
  const sincronizadorPlantillas = setInterval(() => {
    if (providerOf(settings.current()) !== 'cloud' || !settings.isConfigured()) return;
    void syncTemplates(wa, repos).catch((error) =>
      warn('fallo la sincronizacion de plantillas', { detalle: error instanceof Error ? error.message : String(error) }),
    );
  }, 30 * 60_000);
  sincronizadorPlantillas.unref?.();

  // Conversaciones sin movimiento: se respaldan y se limpian solas.
  const stopSweeper = startArchiveSweeper(
    {
      repos,
      dir: config.ARCHIVE_DIR,
      ia: () => (deps.ia?.estado().tieneToken ? { completar: (m, o) => deps.ia!.completar(m, o) } : null),
      pedidoDe: entregas ? (phone) => entregas.pedidoDe(phone) : undefined,
      nombreNegocio: () => ajustes?.nombreNegocio() ?? config.businessName,
      log: info,
    },
    () => ajustes?.guardadosDias() ?? config.ARCHIVE_INACTIVE_DAYS,
  );

  // Solicitud de ubicacion por lotes: un mensaje cada 15-30 s, en horario y
  // con tres intentos como maximo. Ver src/rutas/motor.ts.
  const gsg = deps.gsg ?? crearPuertoGsg(config);
  const stopMotorRutas = startMotorRutas({
    repos,
    sender,
    wa,
    gsg,
    opciones: opcionesDesdeConfig(config),
    nombreNegocio: () => ajustes?.nombreNegocio() ?? config.businessName,
    stickers,
    usarPlantilla: () => providerOf(settings.current()) === 'cloud',
    // Boton nativo de ubicacion: la Cloud API lo tiene; el cliente no oficial
    // solo si se pidio expresamente (llegan rotos a una cuenta personal).
    conBoton: () => providerOf(settings.current()) === 'cloud' || config.WHATSAPP_NATIVE_BUTTONS,
    salud,
    politica,
    log: info,
  });

  // La lista de envio automatico: un mensaje a cada numero cada pocas horas,
  // con la misma pausa y el mismo marcapasos que el reparto. Ver src/envio-automatico.
  const stopMotorLista = lista
    ? startMotorLista({
        repos,
        lista,
        sender,
        opciones: opcionesDesdeConfig(config),
        nombreNegocio: () => ajustes?.nombreNegocio() ?? config.businessName,
        usarPlantilla: () => providerOf(settings.current()) === 'cloud',
        conBoton: () => providerOf(settings.current()) === 'cloud' || config.WHATSAPP_NATIVE_BUTTONS,
        supervisor: () => ajustes?.supervisor() ?? config.RUTAS_SUPERVISOR,
        salud,
        politica,
        log: info,
        horarioExtra: () => (entregas ? { desde: entregas.ajustes().horarioEntregas.desde, hasta: entregas.ajustes().horarioEntregas.extendidoHasta } : null),
      })
    : () => undefined;

  // Las entregas del dia: sincronizar con GSG, pedir confirmaciones, mandar
  // los pines a los motorizados y avisar la hora de llegada. Ver src/entregas.
  // El vigilante del WhatsApp (cada 30 s), la prueba de la manana y la copia de la noche. Ver src/salud/fiabilidad.ts.
  const stopFiabilidad = deps.fiabilidad ? deps.fiabilidad.arrancar() : () => undefined;

  const stopMotorEntregas = entregas
    ? startMotorEntregas({ repos, entregas, opciones: opcionesDesdeConfig(config), salud, politica, log: info })
    : () => undefined;

  // Avisos: el avance del lote hacia GSG, y un WhatsApp al coordinador cuando
  // hay casos que solo puede resolver una persona.
  const stopAlertas = startAlertas({
    repos,
    sender,
    gsg,
    opciones: {
      resumenCadaMin: config.RUTAS_RESUMEN_CADA_MIN,
      supervisor: () => ajustes?.supervisor() ?? config.RUTAS_SUPERVISOR,
      minimoCasos: config.RUTAS_ALERTA_MIN_CASOS,
      avisoCadaMin: config.RUTAS_ALERTA_CADA_MIN,
    },
    log: info,
  });

  // La cola hacia GSG. Sin API configurada no hace nada y los reportes se
  // quedan esperando; en cuanto haya URL, sale todo lo acumulado.
  const despachador = setInterval(() => {
    void despacharReportes({ rutas: repos.rutas }, gsg, 50).catch((error) =>
      warn('fallo el despacho de reportes a GSG', { detalle: error instanceof Error ? error.message : String(error) }),
    );
  }, 60_000);
  despachador.unref?.();

  // El resumen del dia al supervisor: mira cada minuto si es la hora. Ver src/resumenes.
  const stopResumenes = deps.resumenes ? startResumenes(deps.resumenes, { log: info }) : () => undefined;

  // Webhooks salientes: lo que pasa aqui, contado a los sistemas suscritos.
  const desconectarBus = bus ? encolarEventos(bus, repos.webhooks, warn) : () => undefined;
  const stopWebhooks = bus ? startDespachadorWebhooks({ repo: repos.webhooks, log: warn }) : () => undefined;

  return () => {
    desconectarBus();
    stopWebhooks();
    stopMonitor();
    stopScheduler();
    stopGoteo();
    clearInterval(sincronizadorPlantillas);
    stopSweeper();
    stopMotorRutas();
    stopMotorLista();
    stopMotorEntregas();
    stopAlertas();
    stopFiabilidad();
    stopResumenes();
    clearInterval(despachador);
  };
}

/** Lo que se imprime al arrancar sobre el ritmo vigente. */
export function resumenPolitica(politica: Politica): string {
  return (
    `perfil ${politica.perfil}: ${politica.maxPorMinuto}/min, ${politica.maxPorHora}/h, ` +
    `${politica.horaInicio}:00-${politica.horaFin}:00, warm-up desde ${politica.warmup.startPerDay}/dia` +
    (politica.humanizar ? ', escritura simulada' : '')
  );
}
