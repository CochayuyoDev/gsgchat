/**
 * El monitor de salud: el que mira lo que pasa y reacciona.
 *
 * Cada minuto junta las senales (errores de Meta por codigo, entregas que no
 * llegan, bajas, quejas, desconexiones, lo que Meta dice del numero), las
 * pasa por `evaluarRiesgo` y aplica el resultado:
 *
 *  - guarda el nivel y el factor en `number_state`, de donde los lee el
 *    marcapasos para frenar;
 *  - en rojo pausa el numero solo (y la cola), con una hora de fin; cuando
 *    llega, reanuda DESPACIO: una rampa de 10 % a 100 % en dos horas;
 *  - avisa por WhatsApp al supervisor cuando cambia de nivel, sin repetirse;
 *  - reinicia el warm-up si el numero estuvo dias sin enviar;
 *  - limpia las senales viejas.
 *
 * Y en caliente, cuando un envio falla, aplica la regla del codigo: apartar
 * al contacto (131026: un mes; 131049: un dia), frenar (130429) o parar todo
 * (131048, 131031, 403).
 *
 * Todo lo que decide queda en `salud_eventos` con su motivo: cuando alguien
 * pregunte "por que no salio nada ayer a las cinco", la respuesta esta ahi.
 */

import type { Contact, NivelRiesgo, NumberState, Repos, TemplateCategory } from '../db/repos.js';
import { dailyCapFor, daysSince } from '../outbound/throttle.js';
import type { Politica } from './politica.js';
import { limiteDelTier } from './politica.js';
import { evaluarRiesgo, factorDeRampa, type Riesgo, type Senales } from './riesgo.js';
import { enHorario, Marcapasos, type FotoRitmo } from './ritmo.js';
import { reglaDeSupresion, type ReglaSupresion } from './supresion.js';

/** Con este prefijo en `pausedReason`, la pausa la puso el monitor y la puede levantar. */
export const PAUSA_SALUD = 'salud:';
/** El motivo con el que pausaba ya el webhook de calidad; se trata como automatico tambien. */
const PAUSA_WEBHOOK = 'calidad en ROJO reportada por Meta';

export const esPausaAutomatica = (motivo: string | null | undefined): boolean =>
  Boolean(motivo && (motivo.startsWith(PAUSA_SALUD) || motivo === PAUSA_WEBHOOK));

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

export interface MonitorDeps {
  repos: Repos;
  politica: () => Politica;
  phoneNumberId: () => string;
  ahora?: () => Date;
  azar?: () => number;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
  /** Avisar por WhatsApp; se inyecta para no depender del sender desde aqui. */
  avisar?: (texto: string) => Promise<void>;
  /** La cola de salida, para frenarla en seco y soltarla. */
  cola?: { pause(): Promise<void>; resume(): Promise<void> };
}

export interface SnapshotSalud {
  nivel: NivelRiesgo;
  puntos: number;
  /** Factor efectivo (riesgo x rampa). */
  factor: number;
  sinMarketing: boolean;
  motivos: string[];
  pausadaHasta: Date | null;
  rampaDesde: Date | null;
  rampaHasta: Date | null;
  numero: NumberState;
  politica: Politica;
  ritmo: {
    ultimoMinuto: number;
    ultimaHora: number;
    hoy: number;
    cupoHoy: number;
    proximoEnvioMs: number;
    destinatariosUnicos24h: number;
    limiteTier: number | null;
    nuevosContactosHoy: number;
    enHorario: boolean;
  };
  ventanas: {
    ultimos50: Senales['ultimos'];
    dia: Senales['dia'];
    hora: Senales['hora'];
  };
  contactosSuprimidos: number;
  plantillas: Array<{ name: string; status: string; quality: string | null; pausadaHasta: Date | null; pausas: number }>;
  eventos: Array<{ at: Date; tipo: string; codigo: string | null; detalle: string | null }>;
  ultimaEvaluacion: Date | null;
}

export interface Monitor {
  /** Recalcula el riesgo y aplica lo que toque. Devuelve el resultado. */
  evaluar(): Promise<Riesgo & { factorEfectivo: number }>;
  /** Factor efectivo vigente (riesgo x rampa), sin tocar la base. */
  factor(): number;
  sinMarketing(): boolean;
  marcapasos: Marcapasos;
  /** La foto que necesita el marcapasos para decidir este envio. */
  fotoRitmo(contact: Contact, ahora: Date): Promise<FotoRitmo>;
  /** Un envio fallo con ese codigo: aplica la regla y devuelve la que aplico. */
  registrarErrorEnvio(input: {
    codigo: string | number | null | undefined;
    mensaje: string;
    contact: Contact;
    category: TemplateCategory;
    campaignId?: string | null;
  }): Promise<ReglaSupresion | null>;
  /** El webhook trajo un `failed` con codigo para un envio ya salido. */
  registrarFalloWebhook(input: { codigo: string; titulo: string; phone: string }): Promise<void>;
  registrarDesconexion(codigo: string | number | null | undefined, detalle: string): Promise<void>;
  registrarBaja(contact: Contact, detalle: string): Promise<void>;
  registrarQueja(contact: Contact, detalle: string): Promise<void>;
  registrarEvento(tipo: string, codigo?: string | null, detalle?: string | null, extra?: { contactId?: string | null; campaignId?: string | null; payload?: Record<string, unknown> }): Promise<void>;
  /** Una persona levanta la pausa y el riesgo acumulado; se vuelve con rampa. */
  reanudar(motivo: string): Promise<void>;
  snapshot(): Promise<SnapshotSalud>;
  /** Lo justo para una cabecera: nivel, factor, motivos y hasta cuando esta pausado. */
  resumen(): Promise<{ nivel: NivelRiesgo; factor: number; motivos: string[]; pausadaHasta: Date | null }>;
}

export function crearMonitor(deps: MonitorDeps): Monitor {
  const { repos } = deps;
  const ahora = deps.ahora ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const marcapasos = new Marcapasos(deps.politica, deps.azar);

  // Lo ultimo evaluado, para que el sender no lea la base en cada envio.
  let vigente: { riesgo: Riesgo; factorEfectivo: number; en: number } | null = null;
  let ultimoAvisoNivel: { nivel: NivelRiesgo; en: number } | null = null;
  let ultimaPurga = 0;
  let sembrado = false;

  const registrar: Monitor['registrarEvento'] = async (tipo, codigo, detalle, extra) => {
    await repos.salud.registrar({
      phoneNumberId: deps.phoneNumberId(),
      at: ahora(),
      tipo,
      codigo: codigo ?? null,
      detalle: detalle ?? null,
      contactId: extra?.contactId ?? null,
      campaignId: extra?.campaignId ?? null,
      payload: extra?.payload ?? null,
    });
  };

  async function senales(estado: NumberState, momento: Date): Promise<Senales> {
    // Tras una pausa, el reloj de las ventanas empieza en la reanudacion: si
    // no, los fallos que provocaron la pausa la volverian a disparar en
    // cuanto saliera el primer mensaje.
    // (+1 ms: lo que paso en el mismo instante de la reanudacion es "antes".)
    const rampa = estado.rampaDesde ? estado.rampaDesde.getTime() + 1 : 0;
    const desde = (ms: number): Date => new Date(Math.max(momento.getTime() - ms, rampa));
    const [ultimos, dia, hora, reciente, bajas, entrantes, quejas, desconexiones, forbidden, loggedOut] =
      await Promise.all([
        repos.deliveries.resumenUltimos(50, rampa ? new Date(rampa) : null),
        repos.deliveries.resumenDesde(desde(DIA)),
        repos.deliveries.resumenDesde(desde(HORA)),
        repos.deliveries.resumenDesde(desde(10 * MINUTO)),
        repos.contacts.contarBajasDesde(desde(DIA)),
        repos.messages.contarEntrantesDesde(desde(DIA)),
        repos.salud.contar(desde(DIA), 'respuesta_negativa'),
        repos.salud.contar(desde(HORA), 'desconexion'),
        repos.salud.contar(desde(HORA), 'desconexion', '403'),
        repos.salud.contar(desde(HORA), 'desconexion', '401'),
      ]);

    return {
      ultimos: { enviados: ultimos.enviados, fallidos: ultimos.fallidos, porCodigo: ultimos.porCodigo },
      dia: {
        enviados: dia.enviados,
        entregados: dia.entregados,
        // Lo enviado hace mas de una hora ya tuvo tiempo de llegar.
        enviadosMaduros: Math.max(0, dia.enviados - hora.enviados),
        entregadosMaduros: Math.max(0, dia.entregados - hora.entregados),
        bajas,
        entrantes,
        quejas,
        porCodigo: dia.porCodigo,
      },
      hora: { fallidos: hora.fallidos, porCodigo: hora.porCodigo, desconexiones },
      reciente: { porCodigo: reciente.porCodigo },
      calidad: estado.quality,
      estado: estado.estado ?? 'CONNECTED',
      socket: { forbidden: forbidden > 0, loggedOut: loggedOut > 0 },
    };
  }

  async function avisarCambio(riesgo: Riesgo, momento: Date, extra?: string): Promise<void> {
    const politica = deps.politica();
    if (!deps.avisar || !politica.avisarA) return;
    // Un aviso por nivel y por media hora como mucho: el supervisor tiene
    // que enterarse, no recibir el mismo mensaje veinte veces.
    if (
      ultimoAvisoNivel &&
      ultimoAvisoNivel.nivel === riesgo.nivel &&
      momento.getTime() - ultimoAvisoNivel.en < 30 * MINUTO
    ) {
      return;
    }
    ultimoAvisoNivel = { nivel: riesgo.nivel, en: momento.getTime() };
    const cabecera: Record<NivelRiesgo, string> = {
      verde: 'Salud del numero: en VERDE, ritmo normal.',
      amarillo: 'Salud del numero: en AMARILLO, se envia a la mitad de velocidad.',
      naranja: 'Salud del numero: en NARANJA, un quinto de velocidad y sin marketing.',
      rojo: 'Salud del numero: en ROJO, envios en pausa.',
    };
    const motivos = riesgo.motivos.slice(0, 4).map((m) => `- ${m}`).join('\n');
    const texto = `${cabecera[riesgo.nivel]}${extra ? `\n${extra}` : ''}${motivos ? `\n${motivos}` : ''}`;
    await deps.avisar(texto).catch((error) =>
      log('no se pudo avisar del cambio de salud', { detalle: String(error) }),
    );
  }

  async function evaluar(): Promise<Riesgo & { factorEfectivo: number }> {
    const politica = deps.politica();
    const id = deps.phoneNumberId();
    const momento = ahora();
    let estado = await repos.numberState.get(id);

    // 1. Si una pausa automatica ya vencio, se levanta y empieza la rampa.
    if (estado.pausadaHasta && estado.pausadaHasta.getTime() <= momento.getTime()) {
      if (estado.paused && esPausaAutomatica(estado.pausedReason)) {
        await repos.numberState.setPaused(id, false);
        await deps.cola?.resume().catch(() => undefined);
      }
      await repos.numberState.setRiesgo(id, {
        riesgo: 0,
        nivel: 'verde',
        factor: 0.1,
        motivos: ['saliendo de una pausa: rampa de vuelta'],
        pausadaHasta: null,
        rampaDesde: momento,
        ultimaEvaluacion: momento,
      });
      await registrar('reanudacion', null, `pausa automatica cumplida; rampa de ${politica.rampaMin} min`);
      log('salud: pausa cumplida, empieza la rampa de vuelta');
      estado = await repos.numberState.get(id);
    }

    // 2. Las senales y el riesgo.
    const s = await senales(estado, momento);
    const riesgo = evaluarRiesgo(s, politica.umbrales, politica.perfil, politica.pausaRojaMin * MINUTO);

    // 3. Pausa automatica en rojo.
    let pausadaHasta = estado.pausadaHasta ?? null;
    let rampaDesde = estado.rampaDesde ?? null;
    const yaPausadoAuto = estado.paused && esPausaAutomatica(estado.pausedReason);

    if (riesgo.nivel === 'rojo' && politica.autoPausa && !estado.paused) {
      const motivo = `${PAUSA_SALUD} ${riesgo.motivos[0] ?? 'riesgo en rojo'}`;
      await repos.numberState.setPaused(id, true, motivo.slice(0, 300));
      await deps.cola?.pause().catch(() => undefined);
      pausadaHasta = riesgo.descansoMs === null ? null : new Date(momento.getTime() + riesgo.descansoMs);
      rampaDesde = null;
      await registrar(
        'pausa_auto',
        null,
        pausadaHasta
          ? `pausa automatica hasta ${pausadaHasta.toISOString()}: ${riesgo.motivos.join('; ')}`
          : `pausa automatica hasta que alguien la levante: ${riesgo.motivos.join('; ')}`,
        { payload: { motivos: riesgo.motivos, puntos: riesgo.puntos } },
      );
      log('salud: numero pausado solo', { motivos: riesgo.motivos, hasta: pausadaHasta });
      await avisarCambio(
        riesgo,
        momento,
        pausadaHasta
          ? `Se reanuda solo a las ${pausadaHasta.toLocaleTimeString('es-PE', { timeZone: politica.timezone, hour: '2-digit', minute: '2-digit' })}, despacio.`
          : 'Hace falta que alguien lo revise y lo reanude desde el panel.',
      );
    } else if (riesgo.nivel === 'rojo' && yaPausadoAuto && !pausadaHasta && riesgo.descansoMs !== null) {
      // Pausado por el webhook de calidad, sin hora de fin: se le pone la del riesgo.
      pausadaHasta = new Date(momento.getTime() + riesgo.descansoMs);
    }

    // 4. La rampa termina sola.
    if (rampaDesde && momento.getTime() - rampaDesde.getTime() >= politica.rampaMin * MINUTO) {
      rampaDesde = null;
    }

    // 5. Factor efectivo: el del riesgo, limitado por la rampa y por la pausa.
    let factorEfectivo = riesgo.factor;
    if (rampaDesde) factorEfectivo = Math.min(factorEfectivo, factorDeRampa(rampaDesde, momento, politica.rampaMin * MINUTO));
    if (estado.paused || (pausadaHasta && pausadaHasta.getTime() > momento.getTime())) factorEfectivo = 0;

    // 6. Cambio de nivel: se apunta y se avisa.
    const nivelAnterior = estado.nivel ?? 'verde';
    if (riesgo.nivel !== nivelAnterior) {
      await registrar('nivel', riesgo.nivel, `de ${nivelAnterior} a ${riesgo.nivel} (${riesgo.puntos} puntos): ${riesgo.motivos.join('; ') || 'sin senales'}`);
      log('salud: cambio de nivel', { de: nivelAnterior, a: riesgo.nivel, puntos: riesgo.puntos });
      if (riesgo.nivel !== 'rojo') await avisarCambio(riesgo, momento);
    }

    await repos.numberState.setRiesgo(id, {
      riesgo: riesgo.puntos,
      nivel: riesgo.nivel,
      factor: factorEfectivo,
      motivos: riesgo.motivos,
      pausadaHasta,
      rampaDesde,
      ultimaEvaluacion: momento,
    });

    // 7. Warm-up: un numero que estuvo dias parado vuelve a empezar de abajo.
    const inactivo = politica.warmup.reinicioTrasDiasInactivo;
    if (inactivo > 0 && daysSince(estado.warmupStartedOn, momento) > inactivo) {
      const enviados = await repos.deliveries.contarIniciadosDesde(new Date(momento.getTime() - inactivo * DIA));
      if (enviados === 0) {
        await repos.numberState.reiniciarWarmup(id, momento);
        await registrar('warmup', null, `${inactivo} dias sin enviar nada: el warm-up vuelve a empezar`);
        log('salud: warm-up reiniciado por inactividad');
      }
    }

    // 8. Limpieza, una vez al dia.
    if (momento.getTime() - ultimaPurga > DIA) {
      ultimaPurga = momento.getTime();
      await repos.salud.purgar(new Date(momento.getTime() - 30 * DIA)).catch(() => 0);
    }

    vigente = { riesgo, factorEfectivo, en: momento.getTime() };
    return { ...riesgo, factorEfectivo };
  }

  const factor = (): number => vigente?.factorEfectivo ?? 1;
  const sinMarketing = (): boolean => vigente?.riesgo.sinMarketing ?? false;

  async function fotoRitmo(contact: Contact, momento: Date): Promise<FotoRitmo> {
    const politica = deps.politica();
    const id = deps.phoneNumberId();
    // El factor se refresca cada minuto por el ticker; si nadie lo llamo aun,
    // se evalua aqui una vez para no salir a ciegas.
    if (!vigente || momento.getTime() - vigente.en > 2 * MINUTO) await evaluar();

    const [estado, dia, nuevos] = await Promise.all([
      repos.numberState.get(id),
      repos.deliveries.resumenDesde(new Date(momento.getTime() - DIA)),
      politica.nuevosContactosPorDia > 0
        ? repos.contacts.contarNuevosEscritosDesde(inicioDelDia(momento, politica.timezone))
        : Promise.resolve(0),
    ]);

    // La ultima hora se cuenta desde la base, no solo desde este proceso: un
    // reinicio no puede borrar lo enviado. Y el ultimo envio se recupera de
    // la base la primera vez, para que reiniciar no anule la pausa.
    const ultimaHoraBase = await repos.deliveries.contarIniciadosDesde(new Date(momento.getTime() - HORA));
    if (!marcapasos.ultimoEnvioAt() && !sembrado) {
      sembrado = true;
      const ultimo = await repos.deliveries.ultimoIniciadoAt();
      if (ultimo) marcapasos.sembrar(ultimo);
    }

    return {
      ahora: momento,
      factor: factor(),
      ultimoMinuto: marcapasos.enUltimoMinuto(momento),
      ultimaHora: Math.max(ultimaHoraBase, marcapasos.enUltimaHora(momento)),
      ultimoEnvioAt: marcapasos.ultimoEnvioAt(),
      pausaSorteadaMs: marcapasos.pausaSorteadaMs(),
      destinatariosUnicos24h: dia.destinatariosUnicos,
      limiteTier: politica.perfil === 'cloud' ? (estado.limite24h ?? limiteDelTier(estado.tier)) : null,
      nuevosContactosHoy: nuevos,
      esContactoNuevo: !contact.primerEnvioAt,
    };
  }

  async function aplicarGlobal(regla: ReglaSupresion, detalle: string): Promise<void> {
    if (regla.global === 'rojo') {
      // No se espera al siguiente minuto: un 131048 o un 403 se atienden ya.
      await registrar('error_envio', regla.codigo, detalle);
      if (regla.codigo === '403') await repos.numberState.setEstado(deps.phoneNumberId(), 'BANNED');
      await evaluar();
      return;
    }
    if (regla.global === 'lento') {
      await registrar('rate_limit', regla.codigo, detalle);
      // El factor baja ya, sin esperar al ticker; el ticker lo recalcula.
      if (vigente) vigente = { ...vigente, factorEfectivo: Math.min(vigente.factorEfectivo, 0.5) };
    }
  }

  return {
    evaluar,
    factor,
    sinMarketing,
    marcapasos,
    fotoRitmo,
    registrarEvento: registrar,

    async registrarErrorEnvio({ codigo, mensaje, contact, category, campaignId }) {
      const regla = reglaDeSupresion(codigo, mensaje);
      const detalle = `${mensaje.slice(0, 200)} (${contact.phone})`;
      if (!regla) {
        await registrar('error_envio', codigo === null || codigo === undefined ? null : String(codigo), detalle, {
          contactId: contact.id,
          campaignId,
        });
        return null;
      }

      if (regla.duracionMs > 0) {
        const hasta = new Date(ahora().getTime() + regla.duracionMs);
        await repos.contacts.suprimir(contact.phone, hasta, regla.motivo, regla.ambito);
        await registrar('supresion', regla.codigo, `${contact.phone} hasta ${hasta.toISOString()}: ${regla.motivo}`, {
          contactId: contact.id,
          campaignId,
        });
        log('salud: contacto apartado', { phone: contact.phone, hasta, motivo: regla.motivo });
      } else {
        await registrar('error_envio', regla.codigo, detalle, { contactId: contact.id, campaignId });
      }

      if (regla.global) await aplicarGlobal(regla, `${regla.motivo}: ${detalle}`);
      void category;
      return regla;
    },

    async registrarFalloWebhook({ codigo, titulo, phone }) {
      // El webhook trae fallos de envios que ya habian salido con exito
      // aparente: el 131049 (limite por usuario) llega asi, nunca en la
      // respuesta del POST. Se aplica la misma regla que en caliente.
      const contact = await repos.contacts.getByPhone(phone);
      const regla = reglaDeSupresion(codigo, titulo);
      const detalle = `${titulo.slice(0, 200)} (${phone})`;
      if (!regla) {
        await registrar('estado_fallido', codigo, detalle, { contactId: contact?.id ?? null });
        return;
      }
      if (regla.duracionMs > 0 && contact) {
        const hasta = new Date(ahora().getTime() + regla.duracionMs);
        await repos.contacts.suprimir(contact.phone, hasta, regla.motivo, regla.ambito);
        await registrar('supresion', regla.codigo, `${phone} hasta ${hasta.toISOString()}: ${regla.motivo}`, {
          contactId: contact.id,
        });
      } else {
        await registrar('estado_fallido', regla.codigo, detalle, { contactId: contact?.id ?? null });
      }
      if (regla.global) await aplicarGlobal(regla, `${regla.motivo}: ${detalle}`);
    },

    async registrarDesconexion(codigo, detalle) {
      const c = codigo === null || codigo === undefined ? null : String(codigo);
      await registrar('desconexion', c, detalle);
      if (c === '403') {
        await repos.numberState.setEstado(deps.phoneNumberId(), 'BANNED');
        await evaluar();
      } else if (c === '401') {
        await repos.numberState.setEstado(deps.phoneNumberId(), 'DISCONNECTED');
      }
    },

    async registrarBaja(contact, detalle) {
      await registrar('baja', null, `${contact.phone}: ${detalle}`, { contactId: contact.id });
    },

    async registrarQueja(contact, detalle) {
      await registrar('respuesta_negativa', null, `${contact.phone}: ${detalle}`, { contactId: contact.id });
    },

    async reanudar(motivo) {
      const id = deps.phoneNumberId();
      const momento = ahora();
      const estado = await repos.numberState.get(id);
      if (estado.paused) {
        await repos.numberState.setPaused(id, false);
        await deps.cola?.resume().catch(() => undefined);
      }
      // Reanudar a mano no borra lo que dijo Meta: si el numero sigue en rojo
      // segun Meta, el siguiente minuto lo volvera a parar. Lo que si se
      // reinicia es la ventana de senales propias y el estado del socket.
      if (estado.estado === 'BANNED' || estado.estado === 'DISCONNECTED') {
        await repos.numberState.setEstado(id, 'CONNECTED');
      }
      await repos.numberState.setRiesgo(id, {
        riesgo: 0,
        nivel: 'verde',
        factor: 0.1,
        motivos: [`reanudado a mano: ${motivo}`],
        pausadaHasta: null,
        rampaDesde: momento,
        ultimaEvaluacion: momento,
      });
      await registrar('reanudacion', null, `a mano: ${motivo}`);
      vigente = null;
      await evaluar();
    },

    async resumen() {
      const estado = await repos.numberState.get(deps.phoneNumberId());
      return {
        nivel: estado.nivel ?? 'verde',
        factor: factor(),
        motivos: estado.motivos ?? [],
        pausadaHasta: estado.pausadaHasta ?? null,
      };
    },

    async snapshot() {
      const politica = deps.politica();
      const id = deps.phoneNumberId();
      const momento = ahora();
      const estado = await repos.numberState.get(id);
      const s = await senales(estado, momento);
      const [dia, hoy, suprimidos, plantillas, eventos, nuevos] = await Promise.all([
        repos.deliveries.resumenDesde(new Date(momento.getTime() - DIA)),
        repos.counters.totalForDay(id, momento),
        repos.contacts.contarSuprimidos(momento),
        repos.templates.list(),
        repos.salud.ultimos(40),
        repos.contacts.contarNuevosEscritosDesde(inicioDelDia(momento, politica.timezone)),
      ]);
      const riesgo = vigente?.riesgo ?? evaluarRiesgo(s, politica.umbrales, politica.perfil, politica.pausaRojaMin * MINUTO);
      const factorEfectivo = vigente?.factorEfectivo ?? estado.factor ?? 1;

      return {
        nivel: riesgo.nivel,
        puntos: riesgo.puntos,
        factor: factorEfectivo,
        sinMarketing: riesgo.sinMarketing,
        motivos: riesgo.motivos,
        pausadaHasta: estado.pausadaHasta ?? null,
        rampaDesde: estado.rampaDesde ?? null,
        rampaHasta: estado.rampaDesde ? new Date(estado.rampaDesde.getTime() + politica.rampaMin * MINUTO) : null,
        numero: estado,
        politica,
        ritmo: {
          ultimoMinuto: marcapasos.enUltimoMinuto(momento),
          ultimaHora: await repos.deliveries.contarIniciadosDesde(new Date(momento.getTime() - HORA)),
          hoy,
          cupoHoy: dailyCapFor(estado.warmupStartedOn, momento, politica.warmup),
          proximoEnvioMs: marcapasos.proximoEnvioEn(momento, factorEfectivo),
          destinatariosUnicos24h: dia.destinatariosUnicos,
          limiteTier: politica.perfil === 'cloud' ? (estado.limite24h ?? limiteDelTier(estado.tier)) : null,
          nuevosContactosHoy: nuevos,
          enHorario: enHorario(momento, politica),
        },
        ventanas: { ultimos50: s.ultimos, dia: s.dia, hora: s.hora },
        contactosSuprimidos: suprimidos,
        plantillas: plantillas.map((t) => ({
          name: t.name,
          status: t.status,
          quality: t.quality,
          pausadaHasta: t.pausadaHasta ?? null,
          pausas: t.pausas ?? 0,
        })),
        eventos: eventos.map((e) => ({ at: e.at, tipo: e.tipo, codigo: e.codigo, detalle: e.detalle })),
        ultimaEvaluacion: estado.ultimaEvaluacion ?? null,
      };
    },
  };
}

/** Las 00:00 de hoy en la zona del negocio, como instante UTC. */
export function inicioDelDia(momento: Date, timezone: string): Date {
  try {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(momento);
    const v = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
    // Cuantos ms han pasado desde la medianoche local: se restan al instante.
    const desdeMedianoche = ((v('hour') % 24) * 3600 + v('minute') * 60 + v('second')) * 1000 + (momento.getTime() % 1000);
    return new Date(momento.getTime() - desdeMedianoche);
  } catch {
    const d = new Date(momento);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}

/**
 * Ticker del monitor. Evalua cada minuto; devuelve la funcion para pararlo.
 */
export function startMonitorSalud(monitor: Monitor, log?: MonitorDeps['log'], intervalMs = 60_000): () => void {
  let corriendo = false;
  const tick = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      await monitor.evaluar();
    } catch (error) {
      log?.('fallo el monitor de salud', { detalle: error instanceof Error ? error.message : String(error) });
    } finally {
      corriendo = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
