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
 *  - el motor de rutas (despierta al entrar trabajo y duerme hasta el siguiente vencimiento);
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
import type { Politica } from './salud/politica.js';
import type { ServicioAjustes } from './ajustes/generales.js';
import type { ServicioStickers } from './stickers/stickers.js';
import { startScheduler } from './automation/engine.js';
import { ventanaDeEntrega } from './entregas/horario-distrito.js';

import { startArchiveSweeper } from './archive/service.js';
import { catalogoVigente } from './chat/etiquetar.js';
import { opcionesDesdeConfig, startMotorRutas } from './rutas/motor.js';
import { vigilarMensajesNoEntregados } from './rutas/no-llego.js';
import { crearPuertoGsg, despacharReportes, paradaPorClave } from './rutas/gsg.js';
import { startAlertas } from './rutas/alertas.js';

import type { ServicioEnvioAutomatico } from './envio-automatico/servicio.js';
import { syncTemplates } from './templates/registry.js';
import { clienteDeMeta, hayApiEnUso } from './templates/cliente-meta.js';
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
  /** Con varias lineas de WhatsApp: si queda alguna conectada (ver `MotorDeps.hayLineaConectada`). */
  hayLineaConectada?: () => boolean;
  /** Las lineas y sus clientes: con una linea de WhatsApp API, las plantillas se traen por ella. */
  lineas?: import('./whatsapp/lineas.js').ServicioLineas;
  registro?: import('./whatsapp/registro.js').RegistroClientes;
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
  /** Los procesos: su motor escribe a cada persona lo que le toca. Sin ellos, no arranca. */
  procesos?: import('./procesos/servicio.js').ServicioProcesos;
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>;
}

/** Arranca todo y devuelve la funcion que lo para. */
export function arrancarServicios(deps: ServiciosDeps): () => void {
  const { config, repos, settings, wa, sender, salud, politica, ajustes, stickers, bus, lista, entregas, log } = deps;
  const warn = (mensaje: string, detalle?: Record<string, unknown>) => log.warn(detalle ?? {}, mensaje);
  const info = (mensaje: string, detalle?: Record<string, unknown>) => log.info(detalle ?? {}, mensaje);


  // Seguimientos y mensajes programados: se procesan cada 10 s.
  const stopScheduler = startScheduler({ repos, sender, log: warn });

  // Campanas por goteo: cada 10 s salen como mucho cinco, y solo si el
  // marcapasos lo permite. Ver src/campanas/goteo.ts.
  const stopGoteo = () => undefined;

  // Con la API oficial, el estado de las plantillas se refresca cada media
  // hora: del final de una pausa Meta no avisa por webhook, y una plantilla
  // que sigue marcada como pausada cuando ya no lo esta es trabajo parado.
  // Con la principal por QR y una linea de API aparte, se traen por esa linea.
  const fuentesMeta = { settings, wa, lineas: deps.lineas, registro: deps.registro };
  const traerPlantillas = async () => {
    const cliente = await clienteDeMeta(fuentesMeta).catch(() => null);
    if (!cliente) return;
    if (cliente === wa && !settings.isConfigured()) return;
    await syncTemplates(cliente, repos, { marcarAusentes: true }).catch((error) =>
      warn('fallo la sincronizacion de plantillas', { detalle: error instanceof Error ? error.message : String(error) }),
    );
  };
  const sincronizadorPlantillas = setInterval(() => void traerPlantillas(), 30 * 60_000);
  sincronizadorPlantillas.unref?.();
  // Y una vez al arrancar: una plantilla aprobada mientras el sistema estaba apagado vale ya.
  const primeraSincronizacion = setTimeout(() => void traerPlantillas(), 20_000);
  primeraSincronizacion.unref?.();

  // Conversaciones sin movimiento: se respaldan y se limpian solas.
  const stopSweeper = startArchiveSweeper(
    {
      repos,
      dir: config.ARCHIVE_DIR,
      ia: () => (deps.ia?.estado().tieneToken ? { completar: (m, o) => deps.ia!.completar(m, o) } : null),
      // El mismo catalogo de etiquetas que Chats (el de fabrica si el negocio no guardo uno).
      catalogo: repos.chatEtiquetas ? () => catalogoVigente(repos.chatEtiquetas!) : undefined,
      pedidoDe: entregas ? (phone) => entregas.pedidoDe(phone) : undefined,
      nombreNegocio: () => ajustes?.nombreNegocio() ?? config.businessName,
      log: info,
    },
    () => ajustes?.guardadosDias() ?? config.ARCHIVE_INACTIVE_DAYS,
  );

  // Solicitud de ubicacion por lotes: un mensaje cada 15-30 s, en horario y
  // con tres intentos como maximo. Solo consulta al entrar trabajo o al vencer
  // un seguimiento; con la cola vacia queda dormido. Ver src/rutas/motor.ts.
  const gsg = deps.gsg ?? crearPuertoGsg(config);
  const stopMotorRutas = startMotorRutas({
    esperaCambiada: (s) => deps.bus?.emitir('reparto.solicitud.actualizada', {
      solicitud: { id: s.id, loteId: s.loteId, telefono: s.phone ?? '', referencia: s.referencia, estado: s.estado, incidencia: s.incidencia },
      ubicacion: null, fecha: new Date().toISOString(),
    }),
    repos,
    sender,
    wa,
    hayLineaConectada: deps.hayLineaConectada,
    gsg,
    opciones: opcionesDesdeConfig(config),
    nombreNegocio: () => ajustes?.nombreNegocio() ?? config.businessName,
    horarioExtra: () => (entregas ? { desde: entregas.ajustes().horarioEntregas.desde, hasta: entregas.ajustes().horarioEntregas.extendidoHasta } : null),
    horarioMensaje: (pedido) => {
      if (!entregas) return null;
      const ajustesEntrega = entregas.ajustes();
      const ventana = ventanaDeEntrega(pedido, ajustesEntrega);
      return { desde: ventana.desde, hasta: ventana.hasta, extendidoHasta: ventana.extendidoHasta };
    },
    stickers,
    usarPlantilla: () => providerOf(settings.current()) === 'cloud',
    // Boton nativo de ubicacion: la Cloud API lo tiene; el cliente no oficial
    // solo si se pidio expresamente (llegan rotos a una cuenta personal).
    conBoton: () => providerOf(settings.current()) === 'cloud' || config.WHATSAPP_NATIVE_BUTTONS,
    // El primer mensaje de una entrega de GSG: la plantilla con producto, empresa, codigo, monto...
    textoSolicitud: entregas ? (s) => entregas.textoSolicitudUbicacion({ phone: s.phone, referencia: s.referencia, loteId: s.loteId }) : undefined,
    plantillaSolicitud: entregas ? (s) => entregas.plantillaSolicitudUbicacion(s) : undefined,
    datosPedido: entregas ? (s) => entregas.datosPlantillaPedido(s) : undefined,
    // Principal por QR y una línea de API en uso: la plantilla aprobada de Ajustes de chat.
    plantillaMeta: entregas ? async () => (await entregas.usaPlantillaMeta()) && (await hayApiEnUso(fuentesMeta)) : undefined,
    primerMensaje: entregas?.primerMensajeReparto,
    // Antes de escribirle, GSG dice si ese envio sigue (si hay ruta de consulta configurada).
    antesDeEscribir: entregas ? (s) => entregas.antesDeEscribirReparto(s) : undefined,
    salud,
    politica,
    log: info,
  });

  // La lista de envio automatico: un mensaje a cada numero cada pocas horas,
  // con la misma pausa y el mismo marcapasos que el reparto. Ver src/envio-automatico.
  const stopMotorLista = () => undefined;

  // Las entregas del dia (GSG las empuja; a GSG no se le pide nada): pedir confirmaciones, mandar
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
  // Las ubicaciones que GSG rechazo se reintentan solas en cada pasada (hasta
  // diez intentos): una direccion o clave corregida no deja nada atascado.
  // Si la cola esta parada porque GSG rechazo la clave (401/403) con esta
  // misma configuracion, no se reencola nada: se espera a que la cambien.
  const despachador = setInterval(() => {
    void (gsg.conectado() && !paradaPorClave({ rutas: repos.rutas }, gsg) ? repos.rutas.reencolarFallidos('ubicacion', 10) : Promise.resolve(0))
      .then(() => despacharReportes({ rutas: repos.rutas }, gsg, 50))
      .catch((error) =>
      warn('fallo el despacho de reportes a GSG', { detalle: error instanceof Error ? error.message : String(error) }),
    );
  }, 60_000);
  despachador.unref?.();

  // Los procesos (pedir datos, confirmar, avisos al personal, cobranza): un
  // mensaje por pasada, con la pausa del reparto y en la franja de cada proceso.
  const stopProcesos = () => undefined;

  // El resumen del dia al supervisor: mira cada minuto si es la hora. Ver src/resumenes.
  const stopResumenes = deps.resumenes ? startResumenes(deps.resumenes, { log: info }) : () => undefined;

  // Webhooks salientes: lo que pasa aqui, contado a los sistemas suscritos.
  const desconectarBus = bus ? encolarEventos(bus, repos.webhooks, warn) : () => undefined;
  const stopWebhooks = bus ? startDespachadorWebhooks({ repo: repos.webhooks, log: warn }) : () => undefined;

  // Un mensaje del pedido que WhatsApp avisa DESPUES que no entrego: deja de
  // contar como intento y el pedido pasa a incidencia con el motivo. Ver src/rutas/no-llego.ts.
  const entregasVivas = deps.entregas;
  const stopNoLlego = bus
    ? vigilarMensajesNoEntregados(bus, { repos, log: warn, ...(entregasVivas ? { segundoNumero: (phone: string, codigo: string, motivo: string) => entregasVivas.segundoNumeroTrasRechazo(phone, codigo, motivo) } : {}) })
    : () => undefined;

  return () => {
    stopNoLlego();
    desconectarBus();
    stopWebhooks();
    stopScheduler();
    stopGoteo();
    clearInterval(sincronizadorPlantillas);
    clearTimeout(primeraSincronizacion);
    stopSweeper();
    stopMotorRutas();
    stopMotorLista();
    stopMotorEntregas();
    stopAlertas();
    stopFiabilidad();
    stopResumenes();
    stopProcesos();
    clearInterval(despachador);
  };
}

/** Lo que se imprime al arrancar sobre el ritmo vigente. */
export function resumenPolitica(politica: Politica): string {
  if (politica.soloRitmo) return `horario ${politica.horaInicio}:00-${politica.horaFin}:00, pausa ${politica.pausaMinMs / 1000}-${politica.pausaMaxMs / 1000} s; sin control de salud de cuenta`;
  return (
    `perfil ${politica.perfil}: ${politica.maxPorMinuto}/min, ${politica.maxPorHora}/h, ` +
    `${politica.horaInicio}:00-${politica.horaFin}:00, warm-up desde ${politica.warmup.startPerDay}/dia` +
    (politica.humanizar ? ', escritura simulada' : '')
  );
}
