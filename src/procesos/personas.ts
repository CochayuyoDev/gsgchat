/**
 * De la lista que sube la empresa a las personas de una corrida.
 *
 * Entra de tres formas y las tres acaban igual:
 *  - un Excel (.xlsx), leido con el lector sin dependencias del entrenamiento;
 *  - un CSV o una tabla pegada desde Excel (punto y coma, coma o tabulador);
 *  - filas ya armadas por la API (POST /api/v1/procesos/:id/personas).
 *
 * El telefono se revisa con el mismo plan de numeracion del reparto
 * (src/rutas/telefono.ts). Las columnas que no son telefono ni nombre quedan
 * como datos de la persona ({fecha}, {hora}, {monto}...) y se pueden usar en
 * los textos del proceso.
 */

import { leerXlsx } from '../entrenamiento/xlsx.js';
import { PERU, revisarTelefono, type PlanNumeracion } from '../rutas/telefono.js';
import { claveDeColumna, type NuevaPersona } from './modelo.js';

const ALIAS_TELEFONO = ['telefono', 'telefono1', 'celular', 'numero', 'movil', 'whatsapp', 'phone', 'tel', 'cel', 'numero_de_celular', 'numero_de_telefono', 'nro_celular'];
const ALIAS_NOMBRE = ['nombre', 'nombres', 'cliente', 'nombre_completo', 'contacto', 'persona', 'destinatario', 'razon_social', 'tecnico', 'trabajador', 'alumno', 'paciente'];

export interface Descartada {
  linea: number;
  texto: string;
  motivo: string;
}

export interface LecturaLista {
  personas: NuevaPersona[];
  descartadas: Descartada[];
  duplicadas: number;
  /** Las columnas de datos que trajo la lista, ya como variables (fecha, hora, monto...). */
  columnas: string[];
}

function separadorDe(linea: string): string {
  let mejor = ';';
  let cuenta = 0;
  for (const sep of [';', ',', '\t', '|']) {
    const n = linea.split(sep).length;
    if (n > cuenta) {
      mejor = sep;
      cuenta = n;
    }
  }
  return mejor;
}

function partir(linea: string, sep: string): string[] {
  const celdas: string[] = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (comillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else comillas = !comillas;
      continue;
    }
    if (c === sep && !comillas) {
      celdas.push(actual.trim());
      actual = '';
      continue;
    }
    actual += c;
  }
  celdas.push(actual.trim());
  return celdas;
}

const pareceTelefono = (v: string) => /\d{6,}/.test(String(v ?? '').replace(/\D+/g, ''));

/** Una tabla (filas de celdas) a filas con nombre de columna. */
function filasDeTabla(tabla: string[][]): { filas: Array<Record<string, string>>; lineaBase: number } {
  if (!tabla.length) return { filas: [], lineaBase: 1 };
  const primera = tabla[0]!.map((c) => claveDeColumna(c));
  const conCabecera = primera.some((c) => ALIAS_TELEFONO.includes(c) || c.includes('telefono') || c.includes('celular') || c.includes('whatsapp')) && !tabla[0]!.some(pareceTelefono);
  if (conCabecera) {
    const nombres = primera.map((c, i) => c || `columna_${i + 1}`);
    return { filas: tabla.slice(1).map((fila) => Object.fromEntries(nombres.map((n, i) => [n, (fila[i] ?? '').trim()]))), lineaBase: 2 };
  }
  // Sin cabecera: telefono, nombre y lo demas como columna_3, columna_4...
  return {
    filas: tabla.map((fila) => {
      const o: Record<string, string> = { telefono: (fila[0] ?? '').trim() };
      if (fila.length > 1) o.nombre = (fila[1] ?? '').trim();
      for (let i = 2; i < fila.length; i++) o[`columna_${i + 1}`] = (fila[i] ?? '').trim();
      return o;
    }),
    lineaBase: 1,
  };
}

function tablaDeTexto(texto: string): string[][] {
  const lineas = (texto ?? '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim());
  if (!lineas.length) return [];
  const sep = separadorDe(lineas[0]!);
  return lineas.map((l) => partir(l, sep));
}

export interface EntradaLista {
  /** Tabla pegada o contenido de un CSV. */
  texto?: string;
  /** Un .xlsx en base64. */
  xlsxBase64?: string;
  /** Filas ya armadas (API): { telefono, nombre, ...otras columnas }. */
  filas?: Array<Record<string, unknown>>;
}

/**
 * Lee la lista y revisa cada telefono. Un numero repetido se queda en uno; un
 * numero que no sirve entra igual, marcado «no se le puede escribir» con el
 * motivo, para que se vea en la corrida y alguien lo corrija.
 */
export function leerLista(entrada: EntradaLista, plan: PlanNumeracion = PERU): LecturaLista {
  let filas: Array<Record<string, string>> = [];
  let lineaBase = 1;
  if (entrada.filas?.length) {
    filas = entrada.filas.map((f) => Object.fromEntries(Object.entries(f ?? {}).map(([k, v]) => [claveDeColumna(k), v === null || v === undefined ? '' : String(v).trim()])));
  } else if (entrada.xlsxBase64) {
    const r = filasDeTabla(leerXlsx(Buffer.from(entrada.xlsxBase64, 'base64')));
    filas = r.filas;
    lineaBase = r.lineaBase;
  } else if (entrada.texto?.trim()) {
    const r = filasDeTabla(tablaDeTexto(entrada.texto));
    filas = r.filas;
    lineaBase = r.lineaBase;
  }

  const salida: LecturaLista = { personas: [], descartadas: [], duplicadas: 0, columnas: [] };
  const columnas = new Set<string>();
  const vistos = new Set<string>();

  filas.forEach((fila, i) => {
    const claveTel = Object.keys(fila).find((k) => ALIAS_TELEFONO.includes(k)) ?? Object.keys(fila).find((k) => k.includes('telefono') || k.includes('celular') || k.includes('whatsapp')) ?? Object.keys(fila).find((k) => pareceTelefono(fila[k] ?? ''));
    const claveNombre = Object.keys(fila).find((k) => ALIAS_NOMBRE.includes(k));
    const crudo = claveTel ? fila[claveTel] ?? '' : '';
    const nombre = claveNombre ? fila[claveNombre] || null : null;
    const datos: Record<string, string> = {};
    for (const [k, v] of Object.entries(fila)) {
      if (k === claveTel || k === claveNombre || !k || !v) continue;
      datos[k] = v.slice(0, 300);
      columnas.add(k);
    }
    if (!crudo && !nombre && !Object.keys(datos).length) return;
    if (!crudo) {
      salida.descartadas.push({ linea: i + lineaBase, texto: Object.values(fila).join(' · ').slice(0, 120), motivo: 'la fila no trae teléfono' });
      return;
    }
    const revision = revisarTelefono(crudo, plan);
    if (!revision.ok) {
      salida.personas.push({ phone: null, telefonoCrudo: crudo, nombre, datos, estado: 'error', motivo: `El teléfono «${crudo}» no sirve: ${revision.detalle}. Corrígelo en la lista y vuelve a cargarlo.` });
      return;
    }
    if (vistos.has(revision.phone)) {
      salida.duplicadas++;
      return;
    }
    vistos.add(revision.phone);
    salida.personas.push({ phone: revision.phone, telefonoCrudo: crudo, nombre, datos });
  });
  salida.columnas = [...columnas];
  return salida;
}
