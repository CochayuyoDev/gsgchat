/**
 * El contrato escrito (docs/CONTRATO-GSG.md) contra el codigo, campo por campo.
 *
 * El documento es lo que se le da a GSG; el codigo es lo que de verdad se
 * manda y se acepta. Si se separan, GSG programa contra algo que no existe.
 * Aqui se lee el documento tal cual (el mismo fichero que descarga el panel en
 * /docs/contrato-gsg.md) y se compara con:
 *
 *   - lo que GSGchat MANDA a GSG: las claves que producen payloadUbicacion,
 *     payloadConfirmacion, payloadEntrega, payloadIncidencia y payloadResumen
 *     (src/rutas/gsg.ts), contra el JSON de ejemplo de cada POST en A.2;
 *   - lo que GSGchat LEE de GSG en /reparto/pendientes (CAMPOS_PEDIDO del
 *     verificador, src/rutas/gsg-extras.ts), contra la tabla de A.1;
 *   - lo que ACEPTA POST /api/v1/entregas (pedidoSchema) y PATCH
 *     (cambioPedidoSchema), contra las tablas de B.1 y B.3;
 *   - las esperas de reintento de los webhooks (ESPERAS_MS), contra B.5.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { payloadConfirmacion, payloadEntrega, payloadIncidencia, payloadResumen, payloadUbicacion } from '../rutas/gsg.js';
import { CAMPOS_PEDIDO } from '../rutas/gsg-extras.js';
import { cambioPedidoSchema, pedidoSchema } from '../api/v1/entregas-gsg.js';
import { ESPERAS_MS } from '../webhooks/despachador.js';
import type { Lote, Solicitud } from '../db/rutas.js';

/** Donde esta el contrato: los mismos sitios que mira la descarga del panel. */
export function rutaDelContrato(): string | null {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const candidatos = [path.join(aqui, '..', '..', 'docs', 'CONTRATO-GSG.md'), path.join(aqui, '..', '..', '..', 'docs', 'CONTRATO-GSG.md'), path.resolve(process.cwd(), 'docs', 'CONTRATO-GSG.md')];
  return candidatos.find((c) => existsSync(c)) ?? null;
}

export async function leerContrato(): Promise<string | null> {
  const ruta = rutaDelContrato();
  return ruta ? readFile(ruta, 'utf8') : null;
}

/** La seccion que empieza en el primer titulo que contiene `titulo`, hasta el siguiente titulo de su nivel o superior. */
function seccion(md: string, titulo: string): string | null {
  const lineas = md.split(/\r?\n/);
  const i = lineas.findIndex((l) => /^#{2,4} /.test(l) && l.includes(titulo));
  if (i < 0) return null;
  const nivel = /^(#+)/.exec(lineas[i]!)![1]!.length;
  const fin = lineas.findIndex((l, j) => j > i && /^(#+) /.test(l) && /^(#+)/.exec(l)![1]!.length <= nivel);
  return lineas.slice(i + 1, fin < 0 ? undefined : fin).join('\n');
}

/** Las claves de primer nivel del primer bloque ```json de la seccion. */
function clavesDelEjemplo(md: string, titulo: string): Set<string> | null {
  const s = seccion(md, titulo);
  if (!s) return null;
  const m = /```json\s*\n([\s\S]*?)```/.exec(s);
  if (!m) return null;
  try {
    return new Set(Object.keys(JSON.parse(m[1]!) as Record<string, unknown>));
  } catch {
    return null;
  }
}

/** Los nombres entre comillas invertidas de la primera columna de la primera tabla de la seccion. */
function camposDeTabla(md: string, titulo: string): Set<string> | null {
  const s = seccion(md, titulo);
  if (!s) return null;
  const filas = s.split(/\r?\n/).filter((l) => l.trim().startsWith('|'));
  if (filas.length < 3) return null;
  const campos = new Set<string>();
  for (const fila of filas.slice(2)) {
    const primera = fila.split('|')[1] ?? '';
    for (const m of primera.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)) campos.add(m[1]!);
  }
  return campos;
}

/** Las esperas de reintento en palabras: "15 s, 1 min, 5 min, 30 min, 2 h y 12 h". */
export function esperasEnPalabras(esperas: number[] = ESPERAS_MS): string {
  const una = (ms: number) => (ms < 60_000 ? `${ms / 1000} s` : ms < 3_600_000 ? `${ms / 60_000} min` : `${ms / 3_600_000} h`);
  const partes = esperas.map(una);
  return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}` : (partes[0] ?? '');
}

export interface DiferenciaContrato {
  parte: string;
  ok: boolean;
  /** Lo que el codigo manda o acepta y el documento no cuenta. */
  faltanEnDocumento: string[];
  /** Lo que el documento promete y el codigo no manda o no acepta. */
  sobranEnDocumento: string[];
  explicacion: string;
}

// Ejemplos con todos los campos puestos: sirven para ver QUE claves produce el codigo.
const LOTE: Lote = { id: 'lote', nombre: 'Entregas', origen: 'gsg', estado: 'activo', notas: null, externoId: null, createdAt: new Date(), updatedAt: new Date(), total: 1, cifras: {} } as unknown as Lote;
const SOLICITUD = {
  id: 1, loteId: 'lote', contactId: null, telefonoCrudo: '987000001', phone: '51987000001', nombre: 'Ana', referencia: 'P-1', direccion: null, distrito: null, notas: null,
  estado: 'resuelto', intentos: 1, ultimoEnvioAt: new Date(), proximoIntentoAt: null, primeraRespuestaAt: new Date(), resueltoAt: new Date(), lat: -12.1, lng: -77.0,
  precisionM: 20, ubicacionFuente: 'pin', mapsUrl: 'https://maps.google.com/?q=-12.1,-77', incidencia: 'sin_respuesta', incidenciaDetalle: 'x', requiereHumano: true, asignadoA: null,
  createdAt: new Date(), updatedAt: new Date(),
} as unknown as Solicitud;

/** Lo que el codigo manda en cada POST a GSG (con los opcionales documentados que el codigo añade a veces). */
export function camposQueManda(): Record<'ubicaciones' | 'confirmaciones' | 'entregas' | 'incidencias' | 'resumenes', { siempre: string[]; aVeces: string[] }> {
  const ahora = new Date();
  return {
    ubicaciones: { siempre: Object.keys(payloadUbicacion(SOLICITUD, LOTE)), aVeces: ['corregida'] },
    confirmaciones: { siempre: Object.keys(payloadConfirmacion({ referencia: 'P', phone: '51987000001', nombre: 'A', confirmada: true, respuesta: 'si', como: 'reglas', en: ahora })), aVeces: [] },
    entregas: {
      siempre: Object.keys(payloadEntrega({ referencia: 'P', phone: '51987000001', nombre: 'A', lat: 1, lng: 1, motorizado: null, minutosMotorizado: 1, margenMinutos: 60, minutosAviso: 61, llegaAproxAt: ahora, avisadoAt: ahora })),
      aVeces: [],
    },
    incidencias: { siempre: Object.keys(payloadIncidencia(SOLICITUD, LOTE)), aVeces: [] },
    resumenes: { siempre: Object.keys(payloadResumen(LOTE, { resuelta: 1 }, { sin_respuesta: 1 })), aVeces: [] },
  };
}

function comparar(parte: string, codigo: Set<string>, documento: Set<string> | null, opcionales: string[] = [], queEs: string): DiferenciaContrato {
  if (!documento) return { parte, ok: false, faltanEnDocumento: [], sobranEnDocumento: [], explicacion: `El contrato no tiene ${queEs} (o no se pudo leer): hay que escribirlo.` };
  const faltan = [...codigo].filter((c) => !documento.has(c) && !opcionales.includes(c)).sort();
  const sobran = [...documento].filter((c) => !codigo.has(c) && !opcionales.includes(c)).sort();
  const ok = !faltan.length && !sobran.length;
  const trozos = [
    faltan.length ? `el código ${queEs.startsWith('lo que') ? 'lo usa' : 'lo manda'} y el contrato no lo cuenta: ${faltan.join(', ')}` : '',
    sobran.length ? `el contrato lo promete y el código no: ${sobran.join(', ')}` : '',
  ].filter(Boolean);
  return { parte, ok, faltanEnDocumento: faltan, sobranEnDocumento: sobran, explicacion: ok ? `Coincide campo por campo (${codigo.size} campos).` : `No coincide: ${trozos.join('; ')}.` };
}

/** Todas las comparaciones del contrato. `md` es el texto del contrato. */
export function compararContrato(md: string): DiferenciaContrato[] {
  const manda = camposQueManda();
  const salida: DiferenciaContrato[] = [];
  const posts: Array<[keyof typeof manda, string]> = [
    ['ubicaciones', 'POST <GSG_URL>/ubicaciones'],
    ['confirmaciones', 'POST <GSG_URL>/confirmaciones'],
    ['entregas', 'POST <GSG_URL>/entregas'],
    ['incidencias', 'POST <GSG_URL>/incidencias'],
    ['resumenes', 'POST <GSG_URL>/resumenes'],
  ];
  for (const [clave, titulo] of posts) {
    const doc = clavesDelEjemplo(md, titulo);
    const m = manda[clave];
    // Un opcional que el documento cuenta en el texto (como `corregida`) vale aunque no este en el ejemplo.
    const opcionales = m.aVeces.filter((c) => (seccion(md, titulo) ?? '').includes(`"${c}"`));
    salida.push(comparar(`Lo que GSG recibe en ${titulo.replace('<GSG_URL>', '')}`, new Set(m.siempre), doc, opcionales, 'el ejemplo de ese POST'));
  }
  const pendientes = camposDeTabla(md, 'GET <GSG_URL>/reparto/pendientes');
  pendientes?.delete('dia');
  salida.push(comparar('Lo que GSGchat lee de GET /reparto/pendientes', new Set(CAMPOS_PEDIDO), pendientes, [], 'lo que se lee de cada pedido (la tabla de A.1)'));
  salida.push(comparar('Lo que acepta POST /api/v1/entregas', new Set(Object.keys(pedidoSchema.shape)), camposDeTabla(md, 'POST /api/v1/entregas'), [], 'lo que se acepta de cada pedido (la tabla de B.1)'));
  const cambiables = new Set(Object.keys(cambioPedidoSchema.shape).filter((c) => c !== 'telefono'));
  salida.push(comparar('Lo que acepta PATCH /api/v1/entregas/{referencia}', cambiables, camposDeTabla(md, 'PATCH /api/v1/entregas/{referencia}'), [], 'lo que se puede cambiar (la tabla de B.3)'));
  const esperas = esperasEnPalabras();
  const conEsperas = md.includes(esperas);
  salida.push({
    parte: 'Reintentos de los webhooks',
    ok: conEsperas,
    faltanEnDocumento: conEsperas ? [] : [esperas],
    sobranEnDocumento: [],
    explicacion: conEsperas ? `El contrato dice las mismas esperas que el código (${esperas}).` : `El código reintenta a los ${esperas} y el contrato dice otra cosa.`,
  });
  return salida;
}
