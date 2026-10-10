/**
 * Las plantillas: procesos listos que se crean en un clic y se editan.
 *
 * Cada una trae sus pasos, sus textos (con variables), su ritmo y su cierre,
 * y las columnas que conviene que traiga la lista de personas (para que el
 * editor avise si un texto usa {fecha} y la lista no la trae).
 *
 * «Entregas de courier (GSG)» no trae pasos: activa el modulo de entregas que
 * ya existe (Hoy, Números del día, Mapa, Motorizados), sin reescribirlo.
 */

import type { Cierre, Paso, PlantillaId, Ritmo } from './modelo.js';

export interface Plantilla {
  id: PlantillaId;
  nombre: string;
  /** Una linea para la tarjeta de «Crear desde una plantilla». */
  resumen: string;
  /** Para qué sirve, con ejemplos, en dos o tres frases. */
  descripcion: string;
  icono: string;
  /** Las columnas que la lista de personas deberia traer, ademas de telefono y nombre. */
  columnas: string[];
  /** Un ejemplo de lista para pegar (con cabecera). */
  ejemplo: string;
  pasos: Paso[];
  ritmo: Ritmo;
  cierre: Cierre;
}

const CIERRE_AJENA = 'Por este medio solo atendemos este trámite, {nombre}. Tu consulta la ve una persona de {negocio} y te escribe por aquí.';
const CIERRE_PERSONA = 'Gracias, {nombre}. Una persona de {negocio} continúa contigo por este mismo chat.';

export const PLANTILLAS: Plantilla[] = [
  {
    id: 'datos',
    nombre: 'Pedir y validar datos',
    resumen: 'Ubicación, DNI, dirección, fotos o documentos: se piden, se validan y quedan registrados.',
    descripcion: 'Para completar fichas de clientes, afiliaciones, registros o expedientes. Cada dato se valida al llegar (un DNI de 8 dígitos, un RUC con su dígito de control, un pin dentro de la zona) y lo que no vale se vuelve a pedir explicando por qué.',
    icono: '🪪',
    columnas: [],
    ejemplo: 'telefono;nombre\n987654321;Ana Ruiz\n912345678;Luis Paz',
    pasos: [
      {
        id: 'ubicacion',
        tipo: 'pedir',
        titulo: 'Pedir la ubicación',
        dato: 'ubicacion',
        texto: 'Hola {nombre}, te escribimos de {negocio} para completar tu registro. Compártenos tu ubicación: toca el clip 📎, elige «Ubicación» y envía tu ubicación actual.',
        porQue: 'La necesitamos solo para ubicar tu domicilio y completar tu registro. No la compartimos con nadie.',
        siNoEntiende: 'No pude leer una ubicación en tu mensaje. Toca el clip 📎, elige «Ubicación» y envía tu ubicación actual, o pega el enlace de Google Maps.',
        gracias: 'Ubicación registrada, gracias.',
        alResponder: 'siguiente',
        insistir: { veces: 2, cadaMin: 180 },
        sinRespuesta: 'persona',
      },
      {
        id: 'dni',
        tipo: 'pedir',
        titulo: 'Pedir el DNI',
        dato: 'documento_identidad',
        texto: 'Ahora escríbenos tu número de DNI (8 dígitos), carné de extranjería o RUC.',
        porQue: 'Tu documento nos permite verificar tu identidad y dejar tu registro a tu nombre.',
        siNoEntiende: 'Ese número no parece un documento válido. El DNI tiene 8 dígitos, el carné de extranjería 9 y el RUC 11. ¿Nos lo escribes de nuevo?',
        gracias: 'Documento registrado.',
        alResponder: 'siguiente',
        insistir: { veces: 2, cadaMin: 180 },
        sinRespuesta: 'persona',
      },
      {
        id: 'direccion',
        tipo: 'pedir',
        titulo: 'Pedir la dirección escrita',
        dato: 'direccion',
        texto: 'Escríbenos tu dirección completa: calle o avenida, número, distrito y una referencia.',
        porQue: 'La dirección escrita complementa la ubicación del mapa y evita confusiones.',
        siNoEntiende: 'Necesitamos la dirección con la calle y el número (por ejemplo: Av. Arequipa 1234, Lince, frente al parque).',
        gracias: 'Dirección registrada.',
        alResponder: 'siguiente',
        insistir: { veces: 2, cadaMin: 180 },
        sinRespuesta: 'persona',
      },
      {
        id: 'documento',
        tipo: 'pedir',
        titulo: 'Pedir la foto del documento',
        dato: 'documento',
        texto: 'Por último, envíanos una foto de tu documento por ambos lados (o el archivo en PDF).',
        porQue: 'La foto del documento es el respaldo de tu registro.',
        siNoEntiende: 'Necesitamos la foto o el archivo del documento: toca el clip 📎 y elige «Cámara», «Galería» o «Documento».',
        alResponder: 'fin',
        insistir: { veces: 2, cadaMin: 240 },
        sinRespuesta: 'persona',
      },
    ],
    ritmo: { desde: '08:00', hasta: '20:00' },
    cierre: { fin: '¡Listo, {nombre}! Ya tenemos todos tus datos. Gracias por tu tiempo.', ajena: CIERRE_AJENA, persona: CIERRE_PERSONA },
  },
  {
    id: 'confirmaciones',
    nombre: 'Confirmaciones y recordatorios',
    resumen: 'Citas, visitas, turnos o asistencia: SÍ o NO, recordatorio antes de la hora y reprogramar.',
    descripcion: 'Para confirmar citas médicas, visitas técnicas, turnos o asistencia a una capacitación. Se pide SÍ o NO con botones, quien no puede elige otra fecha y hora, y a los que confirman se les recuerda antes de la hora.',
    icono: '📅',
    columnas: ['fecha', 'hora'],
    ejemplo: 'telefono;nombre;fecha;hora\n987654321;Ana Ruiz;25/09/2026;10:30\n912345678;Luis Paz;25/09/2026;15:00',
    pasos: [
      {
        id: 'confirmar',
        tipo: 'confirmar',
        titulo: 'Confirmar la cita',
        texto: 'Hola {nombre}, te escribimos de {negocio} para confirmar tu cita del {fecha} a las {hora}. ¿Asistirás? Responde SÍ o NO.',
        porQue: 'Te lo preguntamos para reservar tu espacio y avisar a quien está en lista de espera si no puedes venir.',
        siNoEntiende: 'Disculpa, no entendí. ¿Asistirás a tu cita del {fecha} a las {hora}? Responde SÍ, NO o REPROGRAMAR.',
        gracias: '¡Gracias, {nombre}! Tu cita queda confirmada.',
        si: 'siguiente',
        no: 'fin',
        textoNo: 'Entendido, liberamos tu cita. Si quieres otra fecha, escríbenos REPROGRAMAR.',
        reprogramar: 'pedir_fecha',
        textoReprogramar: 'Claro. ¿Qué día y a qué hora te acomoda? Escríbelo así: 26/09 a las 10:00.',
        insistir: { veces: 2, cadaMin: 180 },
        sinRespuesta: 'persona',
      },
      {
        id: 'esperar',
        tipo: 'esperar',
        titulo: 'Esperar hasta 2 horas antes',
        texto: '',
        esperar: { como: 'antes_de_la_cita', minutos: 120 },
        insistir: { veces: 0, cadaMin: 60 },
        sinRespuesta: 'siguiente',
      },
      {
        id: 'recordatorio',
        tipo: 'aviso',
        titulo: 'Recordar la cita',
        texto: 'Te recordamos, {nombre}: hoy a las {hora} es tu cita con {negocio}. ¡Te esperamos!',
        insistir: { veces: 0, cadaMin: 60 },
        sinRespuesta: 'siguiente',
      },
    ],
    ritmo: { desde: '08:00', hasta: '20:00' },
    cierre: { fin: '', ajena: CIERRE_AJENA, persona: CIERRE_PERSONA },
  },
  {
    id: 'campo',
    nombre: 'Avisos al personal de campo',
    resumen: 'Tareas a técnicos o personal: responden «llegué», «terminé» o «no pude» y el avance se ve en vivo.',
    descripcion: 'Para asignar visitas técnicas, instalaciones, inspecciones o rondas. Cada persona recibe su tarea con la dirección y la hora; con un botón avisa que llegó, que terminó o que no pudo, y en la corrida se ve el avance de todos en vivo.',
    icono: '🧰',
    columnas: ['tarea', 'direccion', 'hora'],
    ejemplo: 'telefono;nombre;tarea;direccion;hora\n987654321;Carlos Técnico;Instalación de router;Av. Arequipa 1234, Lince;10:00\n912345678;Rosa Inspectora;Inspección de local;Jr. Puno 340, Cercado;15:30',
    pasos: [
      {
        id: 'tarea',
        tipo: 'avance',
        titulo: 'Asignar la tarea',
        texto: 'Hola {nombre}, tienes una tarea de {negocio}: {tarea} en {direccion}, a las {hora}. Cuando llegues responde LLEGUÉ; al terminar, TERMINÉ; y si no puedes hacerla, NO PUDE.',
        porQue: 'Con tu aviso el equipo sabe en qué va cada tarea sin tener que llamarte.',
        siNoEntiende: 'No entendí, {nombre}. Responde LLEGUÉ cuando estés en el lugar, TERMINÉ al acabar o NO PUDE si no puedes hacerla.',
        gracias: 'Anotado. ¡Gracias!',
        noPudo: 'persona',
        insistir: { veces: 2, cadaMin: 60 },
        sinRespuesta: 'persona',
      },
    ],
    ritmo: { desde: '07:00', hasta: '21:00' },
    cierre: { fin: 'Gracias, {nombre}. La tarea queda cerrada.', ajena: 'Por este chat solo registramos el avance de tus tareas, {nombre}. Tu consulta la ve el coordinador y te escribe.', persona: 'Anotado, {nombre}. El coordinador te escribe para ver cómo seguimos.' },
  },
  {
    id: 'cobranza',
    nombre: 'Cobranza y trámites',
    resumen: 'Recordar pagos o vencimientos, recibir la captura y pasarla a una persona para validarla.',
    descripcion: 'Para recordar cuotas, pensiones, vencimientos o trámites pendientes. El recordatorio sale el día antes del vencimiento, se recibe la captura o foto del comprobante y una persona la valida. No vende nada: solo recuerda y recibe.',
    icono: '🧾',
    columnas: ['monto', 'vencimiento'],
    ejemplo: 'telefono;nombre;monto;vencimiento\n987654321;Ana Ruiz;S/ 150.00;30/09/2026\n912345678;Luis Paz;S/ 89.90;30/09/2026',
    pasos: [
      {
        id: 'esperar',
        tipo: 'esperar',
        titulo: 'Esperar hasta 1 día antes del vencimiento',
        texto: '',
        esperar: { como: 'antes_de_la_cita', minutos: 24 * 60 },
        insistir: { veces: 0, cadaMin: 60 },
        sinRespuesta: 'siguiente',
      },
      {
        id: 'captura',
        tipo: 'pedir',
        titulo: 'Recordar y pedir la captura',
        dato: 'captura_pago',
        texto: 'Hola {nombre}, te recordamos de {negocio} que tu pago de {monto} vence el {vencimiento}. Cuando lo hagas, envíanos por aquí la captura o la foto del comprobante.',
        porQue: 'Con la captura registramos tu pago sin que tengas que acercarte a ninguna oficina.',
        siNoEntiende: 'Para registrar tu pago necesitamos la captura o la foto del comprobante: toca el clip 📎 y elige la imagen.',
        alResponder: 'persona',
        insistir: { veces: 2, cadaMin: 24 * 60 },
        sinRespuesta: 'persona',
      },
    ],
    ritmo: { desde: '09:00', hasta: '19:00' },
    cierre: { fin: '', ajena: CIERRE_AJENA, persona: 'Gracias, {nombre}. Recibimos tu comprobante: una persona de {negocio} lo revisa y te confirma por aquí.' },
  },
  {
    id: 'gsg',
    nombre: 'Entregas de courier (GSG)',
    resumen: 'Pedidos, ubicación y confirmación: el flujo de GSG Courier con Hoy, Números del día y Mapa.',
    descripcion: 'El flujo completo de un courier: el sistema de GSG manda los pedidos del día, se le pide la ubicación y la confirmación a cada cliente, la ubicación y la confirmación quedan disponibles para GSG. Al activarlo aparecen en el menú Hoy, Números del día y Mapa.',
    icono: '🛵',
    columnas: [],
    ejemplo: '',
    pasos: [],
    ritmo: { desde: '08:00', hasta: '22:00' },
    cierre: { fin: '', ajena: '', persona: '' },
  },
];

export function plantillaPorId(id: string): Plantilla | null {
  return PLANTILLAS.find((p) => p.id === id) ?? null;
}
