/**
 * Leer lo que contesta el cliente cuando le pedimos la ubicacion.
 *
 * Cuatro cosas pueden llegar, y cada una lleva a un sitio distinto:
 *
 *  - El pin (o un enlace de mapa): el caso bueno. Se guarda, se le da las
 *    gracias, se cierra la solicitud y se encola para GSG.
 *  - "No soy yo", "se equivocaron": el numero esta mal en el pedido. No se
 *    insiste jamas a ese numero; eso es lo que hace que a uno lo reporten.
 *  - Cualquier otro texto: el cliente esta ahi, asi que se le vuelve a pedir
 *    -reconociendo que contesto- y ademas se aparta para que una persona lo
 *    mire, porque lo que escribio puede ser una direccion perfectamente util
 *    que ningun bot deberia descartar.
 *  - "Baja": se acabo. Se respeta y se avisa a GSG para que lo coordinen por
 *    telefono.
 *
 * Esto corre DENTRO del webhook, con el cliente esperando, asi que no manda
 * el siguiente mensaje aqui: solo deja la solicitud en su estado y el motor
 * lo recoge con su ritmo. Contestar en el acto seria mandar mensajes tan
 * seguidos como llegan las respuestas, que es justo lo que se evita.
 */

import type { Contact, Repos } from '../db/repos.js';
import type { Monitor } from '../salud/monitor.js';
import type { Solicitud } from '../db/rutas.js';
import { payloadIncidencia, payloadUbicacion, type PuertoGsg } from './gsg.js';
import { INCIDENCIAS, type CodigoIncidencia } from './incidencias.js';

export interface EntradaRuta {
  texto?: string;
  ubicacion?: {
    lat: number;
    lng: number;
    mapsUrl?: string | null;
    precisionM?: number | null;
    fuente?: string | null;
  };
  /** La ubicacion llego bien pero cae fuera de la cobertura. */
  fueraDeZona?: boolean;
  /** El cliente pidio no recibir mas mensajes. */
  baja?: boolean;
}

export type ResultadoRuta =
  | 'resuelta'
  | 'fuera_de_zona'
  | 'sin_ubicacion'
  | 'numero_equivocado'
  | 'rechazo';

export interface RespuestaRuta {
  /** false = este contacto no tiene ninguna solicitud abierta. */
  atendida: boolean;
  resultado?: ResultadoRuta;
  solicitud?: Solicitud;
  /** Lo que conviene contestarle ahora mismo, si algo. */
  responder?: string;
}

export interface RutaInboundDeps {
  repos: Repos;
  gsg: PuertoGsg;
  /** Para apuntar las respuestas negativas ("no soy yo", baja) como senal de riesgo. */
  salud?: Monitor;
  ahora?: () => Date;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
}

const sinTildes = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Frases con las que contesta quien no es el cliente.
 *
 * Se busca la frase entera, no palabras sueltas: "no" a secas es una
 * respuesta legitima a otra cosa, y "equivocado" puede venir en "me di cuenta
 * de que puse el numero equivocado", que es el propio cliente corrigiendose.
 */
const FRASES_NUMERO_EQUIVOCADO = [
  'no soy',
  'no es mi',
  'numero equivocado',
  'esta equivocado',
  'se equivoco',
  'se equivocaron',
  'equivocacion',
  'no pedi nada',
  'no pedi ningun',
  'no he pedido',
  'no compre nada',
  'no espero ningun',
  'no conozco',
  'quien es usted',
  'quienes son',
  'no tengo ningun pedido',
];

export function pareceNumeroEquivocado(texto: string): boolean {
  const limpio = sinTildes(texto);
  return FRASES_NUMERO_EQUIVOCADO.some((frase) => limpio.includes(frase));
}

/** Encola lo que GSG tiene que saber de esta solicitud. */
async function reportar(
  deps: RutaInboundDeps,
  solicitud: Solicitud,
  tipo: 'ubicacion' | 'incidencia',
): Promise<void> {
  const lote = await deps.repos.rutas.lote(solicitud.loteId);
  if (!lote) return;
  await deps.repos.rutas.encolarReporte({
    solicitudId: solicitud.id,
    loteId: lote.id,
    tipo,
    payload:
      tipo === 'ubicacion' ? payloadUbicacion(solicitud, lote) : payloadIncidencia(solicitud, lote),
  });
}

async function marcarIncidencia(
  deps: RutaInboundDeps,
  solicitud: Solicitud,
  codigo: CodigoIncidencia,
  detalle: string,
  estado: 'supervision' | 'incidencia' = 'supervision',
): Promise<Solicitud> {
  const actualizada = await deps.repos.rutas.actualizarSolicitud(solicitud.id, {
    estado,
    incidencia: codigo,
    incidenciaDetalle: detalle,
    requiereHumano: true,
    // No se le vuelve a escribir sola: aqui manda una persona.
    proximoIntentoAt: null,
  });
  await deps.repos.rutas.registrarEvento(
    solicitud.id,
    'incidencia',
    `${INCIDENCIAS[codigo].titulo}: ${detalle}`,
    { codigo },
  );
  await reportar(deps, actualizada, 'incidencia');
  // "No soy yo" y "no me escriban" son lo mas parecido a un bloqueo que se
  // puede ver desde aqui: cuentan para el riesgo del numero.
  if ((codigo === 'numero_equivocado' || codigo === 'rechaza_contacto') && deps.salud && solicitud.contactId) {
    const contacto = await deps.repos.contacts.getById(solicitud.contactId);
    if (contacto) await deps.salud.registrarQueja(contacto, `${codigo}: ${detalle}`).catch(() => undefined);
  }
  return actualizada;
}

/**
 * Atiende la respuesta del cliente en el contexto de su solicitud.
 *
 * Devuelve `atendida: false` cuando ese contacto no tiene ninguna solicitud
 * abierta, y entonces el mensaje sigue su camino normal (preventa, reglas).
 */
export async function atenderRespuestaDeRuta(
  deps: RutaInboundDeps,
  contact: Contact,
  entrada: EntradaRuta,
): Promise<RespuestaRuta> {
  const { repos } = deps;
  const momento = deps.ahora?.() ?? new Date();

  // Por contacto primero; por telefono despues, porque la solicitud pudo
  // crearse antes de que existiera el contacto.
  let solicitud =
    (await repos.rutas.abiertaPorContacto(contact.id)) ??
    (await repos.rutas.abiertaPorTelefono(contact.phone));
  if (!solicitud) return { atendida: false };

  if (!solicitud.contactId) {
    solicitud = await repos.rutas.actualizarSolicitud(solicitud.id, { contactId: contact.id });
  }

  const esPrimera = !solicitud.primeraRespuestaAt;
  if (esPrimera) {
    solicitud = await repos.rutas.actualizarSolicitud(solicitud.id, {
      primeraRespuestaAt: momento,
    });
  }

  // --- se dio de baja ---------------------------------------------------
  if (entrada.baja) {
    const actualizada = await marcarIncidencia(
      deps,
      solicitud,
      'rechaza_contacto',
      'el cliente pidió no recibir más mensajes',
    );
    return { atendida: true, resultado: 'rechazo', solicitud: actualizada };
  }

  // --- llego la ubicacion -----------------------------------------------
  if (entrada.ubicacion) {
    if (entrada.fueraDeZona) {
      const actualizada = await marcarIncidencia(
        deps,
        solicitud,
        'ubicacion_fuera_de_zona',
        `el pin cae en ${entrada.ubicacion.lat.toFixed(5)}, ${entrada.ubicacion.lng.toFixed(5)}`,
      );
      return { atendida: true, resultado: 'fuera_de_zona', solicitud: actualizada };
    }

    // Se mira antes de actualizar: el doble en memoria muta el mismo objeto.
    const estabaDerivado = solicitud.estado === 'derivado';
    const actualizada = await repos.rutas.actualizarSolicitud(solicitud.id, {
      estado: 'resuelto',
      lat: entrada.ubicacion.lat,
      lng: entrada.ubicacion.lng,
      mapsUrl: entrada.ubicacion.mapsUrl ?? null,
      precisionM: entrada.ubicacion.precisionM ?? null,
      ubicacionFuente: entrada.ubicacion.fuente ?? 'whatsapp',
      resueltoAt: momento,
      proximoIntentoAt: null,
      requiereHumano: false,
      incidencia: null,
      incidenciaDetalle: null,
    });

    await repos.rutas.registrarEvento(
      solicitud.id,
      'ubicacion',
      `ubicación recibida (${entrada.ubicacion.fuente ?? 'whatsapp'})${
        estabaDerivado ? ' después de pasar al repartidor: ya no hace falta llamar' : ''
      }`,
      { lat: entrada.ubicacion.lat, lng: entrada.ubicacion.lng },
    );
    await reportar(deps, actualizada, 'ubicacion');

    deps.log?.('ubicacion conseguida', {
      solicitud: solicitud.id,
      telefono: solicitud.phone,
      referencia: solicitud.referencia,
    });

    return { atendida: true, resultado: 'resuelta', solicitud: actualizada };
  }

  // --- contesto otra cosa -----------------------------------------------
  const texto = (entrada.texto ?? '').trim();

  // Todavia no se le habia escrito: lo que diga no es una respuesta a la
  // solicitud (escribio por otra cosa). Se apunta y el primer mensaje sale
  // igual cuando le toque; sin esto, el primer mensaje que recibia era
  // "gracias por responder, nos falta el punto", que no tiene sentido.
  if (solicitud.estado === 'pendiente') {
    await repos.rutas.registrarEvento(
      solicitud.id,
      'respuesta',
      texto ? `escribió antes de que le pidiéramos la ubicación: "${texto.slice(0, 200)}"` : 'escribió (adjunto) antes de que le pidiéramos la ubicación',
    );
    return { atendida: false };
  }

  // Ya paso al repartidor: lo que conteste se apunta para quien lo llame,
  // pero el bot no vuelve a insistir. (Una ubicacion si lo resuelve: eso va
  // arriba y llega aunque el caso este derivado.)
  if (solicitud.estado === 'derivado') {
    await repos.rutas.registrarEvento(
      solicitud.id,
      'respuesta',
      texto ? `contestó después de pasar al repartidor: "${texto.slice(0, 200)}"` : 'contestó (adjunto) después de pasar al repartidor',
    );
    await repos.rutas.actualizarSolicitud(solicitud.id, { requiereHumano: true });
    return { atendida: true, resultado: 'sin_ubicacion', solicitud };
  }

  if (texto && pareceNumeroEquivocado(texto)) {
    const actualizada = await marcarIncidencia(
      deps,
      solicitud,
      'numero_equivocado',
      `el cliente respondió: "${texto.slice(0, 160)}"`,
    );
    return {
      atendida: true,
      resultado: 'numero_equivocado',
      solicitud: actualizada,
      responder:
        'Disculpe la molestia, tomamos nota de que el número no corresponde. ' +
        'No le volveremos a escribir.',
    };
  }

  await repos.rutas.registrarEvento(
    solicitud.id,
    'respuesta',
    texto ? `contestó: "${texto.slice(0, 200)}"` : 'contestó sin texto (adjunto)',
  );

  // Se aparta para que lo mire una persona: lo que escribio puede ser una
  // direccion buena. El motor le insistira igual, con su ritmo.
  const actualizada = await repos.rutas.actualizarSolicitud(solicitud.id, {
    estado: 'respondio',
    requiereHumano: true,
    incidencia: 'respondio_sin_ubicacion',
    incidenciaDetalle: texto ? texto.slice(0, 300) : 'respondió con un adjunto',
    // Un minuto: lo justo para que no parezca una respuesta automatica
    // instantanea y siga entrando por la pausa general del motor.
    proximoIntentoAt: new Date(momento.getTime() + 60_000),
  });

  return { atendida: true, resultado: 'sin_ubicacion', solicitud: actualizada };
}
