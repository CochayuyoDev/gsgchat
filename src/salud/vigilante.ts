/**
 * El vigilante del WhatsApp: se entera de que la sesion se cayo antes que
 * nadie, intenta volver a conectar y, si no puede, avisa por donde pueda.
 *
 * El problema que resuelve: cuando el WhatsApp propio esta caido, el sistema
 * no puede avisar de que esta caido POR WhatsApp. Asi que el aviso sale por
 * correo (Brevo, clave en la pantalla) y, cuando vuelve, se cuenta por los
 * dos canales cuanto estuvo caido.
 *
 * La reconexion sola ya la hace la sesion local a los pocos segundos; aqui
 * se anade la insistencia: si lleva mas de dos minutos en "fallo", se vuelve
 * a pedir la conexion (hasta cinco veces por hora). Si la sesion esta
 * PARADA porque el telefono la cerro (401) o WhatsApp no quiere el numero
 * (403), reintentar no sirve: se dice claro que hay que escanear el QR otra
 * vez, o que el numero esta bloqueado.
 */

import type { SettingsRepo } from '../settings/service.js';
import type { ServicioCorreo } from './correo.js';
import { haceCuanto, horaEn, minutosEnPalabras } from './fiabilidad.js';

export const CLAVE_ULTIMA_CAIDA = 'fiabilidad.vigilante.ultimaCaida';
/** Con la sesion en "fallo" mas de esto, se pide la conexion otra vez. */
const MS_ANTES_DE_RECONECTAR = 2 * 60_000;
const MAX_RECONEXIONES_POR_HORA = 5;

export type Seguimiento = 'sesion' | 'meta' | 'sin_configurar' | 'sin_conectar' | 'desconocido';

export interface AjustesVigilante {
  minutosAntesDeAvisar: number;
  correoAviso: string;
  remitente: string;
  nombreRemitente: string;
  avisarAlVolver: boolean;
}

export interface DepsVigilante {
  /** Lo que dice el cliente de WhatsApp: true conectado, false caido, undefined no se sabe. */
  conectado: () => boolean | undefined;
  /** Que proveedor hay: con la API de Meta no hay sesion que vigilar. */
  proveedor: () => 'local' | 'waha' | 'cloud' | null | undefined;
  /** El estado de la sesion local (STOPPED, FAILED, WORKING...), si el proveedor es el local. */
  estadoLocal?: () => { status: string; detail: string } | null;
  /** Vuelve a abrir la sesion (lo mismo que el boton Conectar). */
  reconectar?: () => Promise<unknown>;
  /** Un WhatsApp al supervisor, cuando el WhatsApp funciona. */
  avisarWhatsApp: (texto: string) => Promise<{ ok: boolean; detalle?: string }>;
  ajustes: () => AjustesVigilante;
  correo: ServicioCorreo;
  settingsRepo: SettingsRepo;
  ahora: () => Date;
  log: (m: string, d?: Record<string, unknown>) => void;
  timezone: string;
  /** En la demo se puede simular una caida desde la pantalla. */
  permitirSimulacion?: boolean;
  /** Cada cuanto mira (30 s). */
  cadaMs?: number;
  /** Como se lee en pantalla la direccion de Conexion. */
  rutaConexion?: string;
}

export interface UltimaCaida {
  desde: string;
  hasta: string;
  minutos: number;
  avisadoPor: 'correo' | 'nadie';
}

export interface EstadoVigilante {
  seguimiento: Seguimiento;
  /** true conectado, false caido, null no se sabe (Meta, sin configurar). */
  conectado: boolean | null;
  conectadoDesde: string | null;
  caidoDesde: string | null;
  /** Cuanto lleva caido, en minutos. */
  caidoMinutos: number;
  aviso: { at: string; por: 'correo' | 'nadie'; detalle: string } | null;
  /** Reconexiones pedidas en la ultima hora. */
  reintentos: number;
  ultimoReintento: string | null;
  /** La sesion esta parada y reintentar no sirve: hay que escanear el QR (o el numero esta bloqueado). */
  necesitaQr: boolean;
  ultimaCaida: UltimaCaida | null;
  /** Si el correo de aviso esta listo, y si no, que falta. */
  correo: { listo: boolean; falta: string | null; ultimo: { ok: boolean; detalle: string; at: string } | null };
  /** En cristiano: la frase que va en la pantalla. */
  frase: string;
  simulando: boolean;
}

export interface Vigilante {
  tick(): Promise<void>;
  estado(): EstadoVigilante;
  /** Avisa por el canal que quede: WhatsApp si funciona, si no correo. */
  avisar(texto: string): Promise<{ ok: boolean; por: 'whatsapp' | 'correo' | 'nadie'; detalle: string }>;
  /** Solo en la demo: fuerza "caido" (true), "conectado" (false) o vuelve a lo real (null). */
  simular(caido: boolean | null): void;
  arrancar(): () => void;
}

export function crearVigilante(deps: DepsVigilante): Vigilante {
  const { ahora, log } = deps;
  const cadaMs = deps.cadaMs ?? 30_000;
  const rutaConexion = deps.rutaConexion ?? '/setup';

  let conectadoDesde: Date | null = null;
  let caidoDesde: Date | null = null;
  let vistoConectado = false;
  let aviso: EstadoVigilante['aviso'] = null;
  let reintentos: Date[] = [];
  let ultimoReintento: Date | null = null;
  let necesitaQr = false;
  let motivoParado: string | null = null;
  let ultimaCaida: UltimaCaida | null = null;
  let simulacion: boolean | null = null;
  let ultimoSeguimiento: Seguimiento = 'desconocido';
  let ultimoConectado: boolean | null = null;
  let cargada = false;

  async function cargar(): Promise<void> {
    if (cargada) return;
    cargada = true;
    try {
      for (const row of await deps.settingsRepo.getAll()) {
        if (row.key === CLAVE_ULTIMA_CAIDA) ultimaCaida = JSON.parse(row.value) as UltimaCaida;
      }
    } catch {
      ultimaCaida = null;
    }
  }

  function seguimientoActual(): Seguimiento {
    const prov = deps.proveedor();
    if (!prov) return 'sin_configurar';
    if (prov === 'cloud') return 'meta';
    return 'sesion';
  }

  function leerConectado(): boolean | undefined {
    if (simulacion !== null) return !simulacion;
    return deps.conectado();
  }

  function podarReintentos(): void {
    const hace1h = ahora().getTime() - 60 * 60_000;
    reintentos = reintentos.filter((d) => d.getTime() > hace1h);
  }

  async function reconectarSiToca(): Promise<void> {
    if (!deps.reconectar || !caidoDesde) return;
    const t = ahora().getTime();
    const local = deps.estadoLocal?.() ?? null;
    // Parada por el telefono o por WhatsApp: reintentar no sirve.
    if (local && (local.status === 'STOPPED' || local.status === 'SCAN_QR_CODE')) return;
    if (local && (local.status === 'STARTING' || local.status === 'WORKING')) return;
    if (t - caidoDesde.getTime() < MS_ANTES_DE_RECONECTAR) return;
    if (ultimoReintento && t - ultimoReintento.getTime() < MS_ANTES_DE_RECONECTAR) return;
    podarReintentos();
    if (reintentos.length >= MAX_RECONEXIONES_POR_HORA) return;
    ultimoReintento = ahora();
    reintentos.push(ultimoReintento);
    log('vigilante: la sesión de WhatsApp sigue caída, se pide la conexión otra vez', { reintento: reintentos.length });
    try {
      await deps.reconectar();
    } catch (error) {
      log('vigilante: la reconexión falló', { detalle: error instanceof Error ? error.message : String(error) });
    }
  }

  async function avisarCaida(): Promise<void> {
    const a = deps.ajustes();
    const desde = horaEn(caidoDesde!, deps.timezone);
    const local = deps.estadoLocal?.() ?? null;
    const porQue = necesitaQr
      ? ` ${motivoParado}.`
      : local?.detail
        ? ` Lo último que dijo la sesión: ${local.detail}.`
        : '';
    const texto =
      `El WhatsApp de GSGchat está caído desde las ${desde} (más de ${minutosEnPalabras(a.minutosAntesDeAvisar)}).${porQue}` +
      ` Mientras esté caído no sale ni entra ningún mensaje. Qué hacer: entra en Conexión (${rutaConexion}) y pulsa Conectar; si pide el QR, escanéalo con el teléfono del número.`;
    const r = await deps.correo.enviar(`WhatsApp caído desde las ${desde} — GSGchat`, texto);
    aviso = { at: ahora().toISOString(), por: r.ok ? 'correo' : 'nadie', detalle: r.ok ? `Se avisó por correo a ${a.correoAviso}.` : `No se pudo avisar por correo: ${r.detalle}` };
    log(r.ok ? 'vigilante: aviso de caída enviado por correo' : 'vigilante: no se pudo avisar de la caída', { detalle: r.detalle });
  }

  async function registrarVuelta(): Promise<void> {
    const hasta = ahora();
    const minutos = Math.max(1, Math.round((hasta.getTime() - caidoDesde!.getTime()) / 60_000));
    ultimaCaida = { desde: caidoDesde!.toISOString(), hasta: hasta.toISOString(), minutos, avisadoPor: aviso?.por ?? 'nadie' };
    await deps.settingsRepo.put(CLAVE_ULTIMA_CAIDA, JSON.stringify(ultimaCaida), false).catch(() => undefined);
    const a = deps.ajustes();
    if (aviso && a.avisarAlVolver) {
      const texto = `WhatsApp volvió a las ${horaEn(hasta, deps.timezone)} (estuvo caído ${minutosEnPalabras(minutos)}). Lo que se quedó sin salir sale ahora solo.`;
      // Por WhatsApp ya se puede; y por correo, para cerrar el hilo del aviso.
      await deps.avisarWhatsApp(texto).catch(() => ({ ok: false }));
      if (aviso.por === 'correo') await deps.correo.enviar(`WhatsApp volvió — GSGchat`, texto);
    }
    log('vigilante: WhatsApp volvió', { minutos });
  }

  async function tick(): Promise<void> {
    await cargar();
    const seguimiento = seguimientoActual();
    ultimoSeguimiento = seguimiento;
    if (seguimiento !== 'sesion') {
      ultimoConectado = null;
      return;
    }
    const c = leerConectado();
    if (c === undefined) {
      ultimoSeguimiento = 'desconocido';
      ultimoConectado = null;
      return;
    }
    ultimoConectado = c;
    const local = deps.estadoLocal?.() ?? null;

    if (c) {
      if (!conectadoDesde) conectadoDesde = ahora();
      vistoConectado = true;
      necesitaQr = false;
      motivoParado = null;
      if (caidoDesde) {
        await registrarVuelta();
        caidoDesde = null;
        aviso = null;
        ultimoReintento = null;
      }
      return;
    }

    // Caido. Si nunca se conecto en este arranque y la sesion no ha fallado,
    // no es una caida: es que todavia no se ha conectado.
    const sesionFallo = local ? local.status === 'FAILED' || local.status === 'STOPPED' : false;
    if (!vistoConectado && !sesionFallo) {
      ultimoSeguimiento = 'sin_conectar';
      return;
    }
    conectadoDesde = null;
    if (!caidoDesde) {
      caidoDesde = ahora();
      log('vigilante: WhatsApp caído', { estado: local?.status ?? 'sin sesión' });
    }
    if (local?.status === 'STOPPED') {
      necesitaQr = true;
      motivoParado = /403|prohib|bane|bloque/i.test(local.detail) ? 'WhatsApp no quiere este número (lo bloqueó): hace falta otro número' : 'El teléfono cerró la sesión: hay que escanear el QR otra vez';
    } else if (local?.status === 'SCAN_QR_CODE') {
      necesitaQr = true;
      motivoParado = 'La sesión está esperando que alguien escanee el QR';
    } else {
      necesitaQr = false;
      motivoParado = null;
    }
    await reconectarSiToca();
    const a = deps.ajustes();
    if (!aviso && ahora().getTime() - caidoDesde.getTime() >= a.minutosAntesDeAvisar * 60_000) {
      await avisarCaida();
    }
  }

  function frase(): string {
    const t = ahora();
    switch (ultimoSeguimiento) {
      case 'sin_configurar':
        return `Todavía no hay WhatsApp conectado: conéctalo en Conexión (${rutaConexion}).`;
      case 'meta':
        return 'Con la API oficial de Meta no hay una sesión que vigilar: Meta entrega los mensajes por su cuenta. Si el token caduca, se ve en Conexión.';
      case 'sin_conectar':
        return `El número aún no se ha conectado en este arranque: entra en Conexión (${rutaConexion}) y escanea el QR.`;
      case 'desconocido':
        return 'No se puede saber si la sesión está conectada con este proveedor.';
      default:
        break;
    }
    if (ultimoConectado) {
      return conectadoDesde ? `Conectado desde las ${horaEn(conectadoDesde, deps.timezone)}${ultimaCaida ? ` · la última caída fue ${haceCuanto(new Date(ultimaCaida.hasta), t)} y duró ${minutosEnPalabras(ultimaCaida.minutos)}` : ''}.` : 'Conectado.';
    }
    if (!caidoDesde) return 'Comprobando…';
    const partes = [`Caído desde las ${horaEn(caidoDesde, deps.timezone)} (${minutosEnPalabras(Math.round((t.getTime() - caidoDesde.getTime()) / 60_000))})`];
    if (necesitaQr && motivoParado) partes.push(motivoParado.toLowerCase());
    else if (reintentos.length) partes.push(`se pidió la conexión ${reintentos.length} ${reintentos.length === 1 ? 'vez' : 'veces'} en la última hora`);
    if (aviso) partes.push(aviso.por === 'correo' ? `se avisó por correo a las ${horaEn(new Date(aviso.at), deps.timezone)}` : 'no se pudo avisar por correo');
    else partes.push(`se avisará por correo a los ${minutosEnPalabras(deps.ajustes().minutosAntesDeAvisar)}`);
    return `${partes.join(' · ')}.`;
  }

  return {
    tick,
    estado() {
      podarReintentos();
      const c = deps.correo.configurado();
      const t = ahora();
      return {
        seguimiento: ultimoSeguimiento,
        conectado: ultimoSeguimiento === 'sesion' ? ultimoConectado : null,
        conectadoDesde: conectadoDesde?.toISOString() ?? null,
        caidoDesde: caidoDesde?.toISOString() ?? null,
        caidoMinutos: caidoDesde ? Math.round((t.getTime() - caidoDesde.getTime()) / 60_000) : 0,
        aviso,
        reintentos: reintentos.length,
        ultimoReintento: ultimoReintento?.toISOString() ?? null,
        necesitaQr,
        ultimaCaida,
        correo: { listo: c.ok, falta: c.falta, ultimo: deps.correo.ultimo() },
        frase: frase(),
        simulando: simulacion !== null,
      };
    },
    async avisar(texto) {
      const caido = ultimoSeguimiento === 'sesion' && ultimoConectado === false;
      if (!caido) {
        const r = await deps.avisarWhatsApp(texto).catch((error) => ({ ok: false, detalle: error instanceof Error ? error.message : String(error) }));
        if (r.ok) return { ok: true, por: 'whatsapp', detalle: 'Aviso enviado por WhatsApp al supervisor.' };
      }
      const r = await deps.correo.enviar('Aviso de GSGchat', texto);
      if (r.ok) return { ok: true, por: 'correo', detalle: r.detalle };
      return { ok: false, por: 'nadie', detalle: caido ? `El WhatsApp está caído y el correo tampoco salió: ${r.detalle}` : `Ni WhatsApp ni correo: ${r.detalle}` };
    },
    simular(caido) {
      if (!deps.permitirSimulacion) return;
      simulacion = caido;
    },
    arrancar() {
      const timer = setInterval(() => {
        void tick().catch((error) => log('vigilante: fallo en la vuelta', { detalle: error instanceof Error ? error.message : String(error) }));
      }, cadaMs);
      timer.unref?.();
      void tick().catch(() => undefined);
      return () => clearInterval(timer);
    },
  };
}
