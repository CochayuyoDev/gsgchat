/**
 * Siembra en una tienda los chats de HOY para probar el etiquetado.
 *
 * Sin un WhatsApp conectado no hay conversaciones que el sistema haya
 * empezado, asi que se crean con los repos de verdad: un mensaje del sistema
 * (con wamid, como los que salen por WhatsApp) y lo que contesta el cliente.
 *
 *   npx tsx docs/postman/etiquetas/sembrar.ts <slug> [DATABASE_URL]          los 4 contactos de la coleccion de Postman
 *   npx tsx docs/postman/etiquetas/sembrar.ts <slug> [DATABASE_URL] --demo   24 clientes: todo el catalogo y los casos dificiles
 *
 * Borra antes los mensajes y etiquetas de esos numeros, asi se puede repetir.
 * Las frases estan pensadas para el mock de IA de al lado (mock-externos.mjs),
 * que etiqueta por palabras clave.
 */

import { createPool } from '../../../src/db/pool.js';
import { createRepos } from '../../../src/db/repos.js';
import { basesDeLaPlataforma } from '../../../src/plataforma/plataforma.js';
import { numeroNormalizado } from '../../../src/chat/etiquetar.js';

const args = process.argv.slice(2);
const demo = args.includes('--demo');
const [slug, urlArg] = args.filter((a) => !a.startsWith('--'));
const url = urlArg ?? process.env.DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/gsgnotas';
if (!slug) {
  console.error('Uso: npx tsx docs/postman/etiquetas/sembrar.ts <slug-de-la-tienda> [DATABASE_URL] [--demo]');
  process.exit(1);
}

/** 'in'/'out' con texto, o 'pin' = el cliente manda su ubicacion. */
type Linea = ['in' | 'out', string] | ['pin', number, number];
interface Chat {
  phone: string;
  nombre: string;
  lineas: Linea[];
}

const HOLA = (n: string) => `¡Hola ${n}! Somos GSG, la empresa de entregas: ¿nos mandas tu ubicación para llevarte tu pedido hoy?`;

/** Los de la coleccion de Postman: Luis esta guardado DOS veces y tiene que salir una sola conversacion. */
const POSTMAN: Chat[] = [
  { phone: '51987650001', nombre: 'Rosa Quispe', lineas: [['out', '¡Hola Rosa! Somos GSG: ¿nos mandas tu ubicación para entregar tu pedido?'], ['in', 'mejor mañana por favor']] },
  { phone: '51987650002', nombre: 'Luis Ramos', lineas: [['out', '¡Hola Luis! Somos GSG: ¿nos mandas tu ubicación?']] },
  { phone: '987650002', nombre: 'Luis Ramos', lineas: [['out', 'Luis, ¿a qué hora te queda bien?'], ['in', 'tráiganlo a las 3']] },
  { phone: '51987650003', nombre: 'Ana Torres', lineas: [['out', '¡Hola Ana! Tu pedido sale hoy.'], ['in', '¿dónde está el motorizado?']] },
];

/** La demostracion: una por cada etiqueta del catalogo y los casos que hay que ver. */
const DEMO: Chat[] = [
  { phone: '51987651001', nombre: 'Rosa Quispe', lineas: [['out', HOLA('Rosa')], ['in', 'Hoy no voy a estar en casa, ¿pueden traerlo mañana?']] },
  { phone: '51987651002', nombre: 'Jorge Huamán', lineas: [['out', HOLA('Jorge')], ['pin', -12.0931, -77.0465], ['out', '¡Gracias! Ubicación registrada.'], ['in', 'Tráiganlo a las 4 en punto por favor']] },
  { phone: '51987651003', nombre: 'Carmen Flores', lineas: [['out', HOLA('Carmen')], ['in', 'Puedo recibir entre las 2 y las 5 de la tarde']] },
  { phone: '51987651004', nombre: 'Pedro Castillo', lineas: [['out', HOLA('Pedro')], ['in', 'Tiene que llegar antes de las 12, después salgo a trabajar']] },
  { phone: '51987651005', nombre: 'Lucía Vargas', lineas: [['out', HOLA('Lucía')], ['in', '¿Pueden venir a las 10 de la noche? Antes no estoy']] },
  { phone: '51987651006', nombre: 'Miguel Torres', lineas: [['out', HOLA('Miguel')], ['pin', -12.1211, -77.0301], ['in', 'Perdón, cambié de dirección: ahora es Av. Arequipa 1234, Lince'], ['pin', -12.0849, -77.0347]] },
  { phone: '51987651007', nombre: 'Sofía Mendoza', lineas: [['out', HOLA('Sofía')], ['pin', -12.0464, -77.0428], ['pin', -12.1391, -77.0221], ['out', 'Sofía, nos llegaron dos ubicaciones: ¿cuál usamos?']] },
  { phone: '51987651008', nombre: 'Andrés Rojas', lineas: [['out', HOLA('Andrés')], ['pin', -12.1105, -76.9987], ['out', 'El motorizado llega entre 3 y 4 pm.'], ['in', 'Sí, ahí estaré toda la tarde']] },
  { phone: '51987651009', nombre: 'Valeria Díaz', lineas: [['out', HOLA('Valeria')], ['pin', -12.0712, -77.0503], ['in', '¿Por dónde viene el motorizado? Ya es tarde']] },
  { phone: '51987651010', nombre: 'Diego Chávez', lineas: [['out', 'Diego, el motorizado está en tu puerta.'], ['in', 'Espéreme unos minutos que ya bajo']] },
  { phone: '51987651011', nombre: 'Patricia Ruiz', lineas: [['out', HOLA('Patricia')], ['pin', -12.0989, -77.0362], ['in', 'Lo va a recibir mi esposa, se llama Carmen']] },
  { phone: '51987651012', nombre: 'Raúl Salazar', lineas: [['out', HOLA('Raúl')], ['in', 'Solo tengo billete de 200, ¿el motorizado tiene vuelto?']] },
  { phone: '51987651013', nombre: 'Elena Paredes', lineas: [['out', HOLA('Elena')], ['in', 'Ya no lo quiero, cancelen el pedido por favor']] },
  { phone: '51987651014', nombre: 'Óscar Medina', lineas: [['out', HOLA('Óscar')], ['in', 'Yo no hice ningún pedido, es un número equivocado']] },
  { phone: '51987651015', nombre: 'Gabriela Ríos', lineas: [['out', HOLA('Gabriela')], ['pin', -12.1502, -77.0201], ['in', 'Llevo 3 horas esperando, pésimo servicio']] },
  { phone: '51987651016', nombre: 'Fernando León', lineas: [['out', HOLA('Fernando')], ['in', 'Hola, ¿venden polos de algodón?']] },
  // Varias peticiones: la de mañana ya se resolvio; lo pendiente es saber a que hora llega.
  { phone: '51987651017', nombre: 'Natalia Cruz', lineas: [['out', HOLA('Natalia')], ['in', 'mejor mañana'], ['out', 'Listo, Natalia: te lo llevamos mañana.'], ['in', '¿Y a qué hora llega más o menos?']] },
  // El mismo cliente guardado dos veces: una sola conversacion.
  { phone: '51987651018', nombre: 'Luis Ramos', lineas: [['out', HOLA('Luis')]] },
  { phone: '987651018', nombre: 'Luis Ramos', lineas: [['out', 'Luis, ¿a qué hora te queda bien?'], ['in', 'tráiganlo a las 3']] },
  // No contesto: se etiqueta sin gastar IA.
  { phone: '51987651019', nombre: 'Martín Soto', lineas: [['out', HOLA('Martín')]] },
  // La IA contesta algo que no vale: «Sin clasificar».
  { phone: '51987651020', nombre: 'Prueba Fallo IA', lineas: [['out', HOLA('cliente')], ['in', 'zzz mensaje raro']] },
  // GSG falla UNA vez al recibir estas dos: para probar «Reintentar envíos».
  { phone: '51987651021', nombre: 'Karina Vega', lineas: [['out', HOLA('Karina')], ['in', 'El pedido llegó roto, quiero hacer un reclamo']] },
  { phone: '51987651022', nombre: 'Hugo Navarro', lineas: [['out', HOLA('Hugo')], ['in', 'Mejor el sábado, hoy no puedo']] },
  // Ya lo recibio: no queda nada pendiente.
  { phone: '51987651023', nombre: 'Silvia Campos', lineas: [['out', 'Silvia, tu pedido fue entregado.'], ['in', 'Ya recibí, gracias']] },
];

const CHATS = demo ? DEMO : POSTMAN;
const nombres = basesDeLaPlataforma(url);
const directorio = createPool(url, nombres.directorio);
const { rows } = await directorio.query<{ id: string | number }>('select id from pl_tiendas where slug = $1', [slug]);
await directorio.end();
if (!rows[0]) {
  console.error(`No hay ninguna tienda «${slug}» en ${nombres.directorio}.`);
  process.exit(1);
}
const base = nombres.tienda(String(rows[0].id));
const pool = createPool(url, base);
const repos = createRepos(pool);

const telefonos = CHATS.map((c) => c.phone);
await pool.query('delete m from messages m join contacts c on c.id = m.contact_id where c.phone in ($1)', [telefonos]);
await pool.query('delete from chat_etiquetas where phone in ($1)', [[...new Set(telefonos.map(numeroNormalizado))]]);

const lineas = CHATS.reduce((n, c) => n + c.lineas.length, 0);
const ahora = Date.now();
let n = 0;
for (const chat of CHATS) {
  const contacto = await repos.contacts.upsertFromInbound(chat.phone, chat.nombre);
  for (const linea of chat.lineas) {
    n++;
    // Todo en la ultima hora y media, en orden.
    const createdAt = new Date(ahora - (lineas - n + 1) * Math.max(10_000, Math.floor(90 * 60_000 / lineas)));
    const wamid = `semilla.etiquetas.${chat.phone}.${n}.${ahora}`;
    if (linea[0] === 'pin') {
      await repos.messages.add({ contactId: contacto.id, direction: 'in', wamid, kind: 'location', body: null, payload: { location: { latitude: linea[1], longitude: linea[2] } }, createdAt });
      continue;
    }
    const [direction, body] = linea;
    await repos.messages.add({ contactId: contacto.id, direction, wamid, kind: 'text', body, status: direction === 'out' ? 'read' : null, payload: direction === 'out' ? { origen: 'sistema' } : null, createdAt });
  }
}
await pool.end();
console.log(`Listo: ${CHATS.length} contactos y ${n} mensajes de hoy en ${base} (tienda ${slug}).`);
