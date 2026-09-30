/**
 * De lo que exporta GSG a un lote de solicitudes listo para trabajar.
 *
 * Mientras GSG no tenga API, el trabajo del dia llega como una tabla: un
 * Excel guardado como CSV, o directamente pegado en la pantalla. Este fichero
 * lo lee sin pedirle a nadie que ordene las columnas, revisa cada telefono y
 * deja marcado -antes de escribirle a nadie- que numeros no van a llegar y
 * por que.
 *
 * Cuando GSG publique su API, lo que entra por ahi pasa por `prepararFilas`
 * igual que esto: la revision de numeros y la deteccion de duplicados es la
 * misma, venga de un fichero o de un JSON.
 */

import type { CodigoIncidencia } from './incidencias.js';
import type { NuevaSolicitud } from '../db/rutas.js';
import { PERU, parecidos, revisarTelefono, soloDigitos, type PlanNumeracion } from './telefono.js';

export interface FilaLote {
  telefono: string;
  nombre?: string;
  referencia?: string;
  direccion?: string;
  distrito?: string;
  notas?: string;
}

/** Como se puede llamar cada columna. Todo en minusculas y sin tildes. */
const ALIAS: Record<keyof FilaLote, string[]> = {
  telefono: ['telefono', 'telefono1', 'celular', 'numero', 'movil', 'whatsapp', 'phone', 'contacto', 'tel'],
  nombre: ['nombre', 'cliente', 'destinatario', 'nombres', 'razon social', 'contacto nombre'],
  referencia: ['referencia', 'pedido', 'guia', 'orden', 'codigo', 'nro pedido', 'numero de pedido', 'id'],
  direccion: ['direccion', 'domicilio', 'destino', 'direccion de entrega', 'entrega'],
  distrito: ['distrito', 'zona', 'localidad', 'ciudad'],
  notas: ['notas', 'observacion', 'observaciones', 'comentario', 'detalle'],
};

const sinTildes = (texto: string): string =>
  texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Palabras que delatan una columna cuando el nombre no es exactamente uno
 * de los alias: "N° Pedido", "Teléfono 1", "Nro. de guía", "Dirección de
 * entrega (completa)"... Se mira palabra a palabra sobre el nombre limpio
 * (sin tildes, sin signos), y en este orden: primero lo que identifica al
 * pedido, porque "numero de pedido" lleva "numero" y no es el telefono.
 */
const PISTAS: Array<[keyof FilaLote, string[]]> = [
  ['referencia', ['pedido', 'guia', 'orden', 'referencia', 'codigo', 'tracking', 'ticket', 'boleta', 'factura']],
  ['telefono', ['telefono', 'celular', 'movil', 'whatsapp', 'phone', 'cel', 'tel', 'numero', 'fono']],
  ['nombre', ['nombre', 'cliente', 'destinatario', 'razon']],
  ['direccion', ['direccion', 'domicilio', 'destino']],
  ['distrito', ['distrito', 'zona', 'localidad', 'ciudad', 'urbanizacion']],
  ['notas', ['nota', 'notas', 'observacion', 'observaciones', 'comentario', 'comentarios', 'detalle']],
];

/** El nombre de una columna reducido a palabras: "N° Pedido" -> ["n", "pedido"]. */
const palabrasDe = (celda: string): string[] =>
  sinTildes(celda)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);

/** El separador que mas columnas produce en la cabecera: ; , o tabulador. */
function separadorDe(linea: string): string {
  const candidatos = [';', ',', '\t', '|'];
  let mejor = ';';
  let mejorCuenta = 0;
  for (const sep of candidatos) {
    const cuenta = linea.split(sep).length;
    if (cuenta > mejorCuenta) {
      mejor = sep;
      mejorCuenta = cuenta;
    }
  }
  return mejor;
}

/** Parte una linea respetando las comillas dobles de CSV. */
function partir(linea: string, sep: string): string[] {
  const celdas: string[] = [];
  let actual = '';
  let entreComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      // Dos comillas seguidas dentro de un campo son una comilla literal.
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        entreComillas = !entreComillas;
      }
      continue;
    }
    if (c === sep && !entreComillas) {
      celdas.push(actual);
      actual = '';
      continue;
    }
    actual += c;
  }
  celdas.push(actual);
  return celdas.map((c) => c.trim());
}

export interface LecturaLote {
  filas: FilaLote[];
  /** Lineas que no se pudieron leer, con el motivo y el texto original. */
  descartadas: Array<{ linea: number; texto: string; motivo: string }>;
  /** Que columna se entendio para cada campo, para poder ensenarlo. */
  columnas: Partial<Record<keyof FilaLote, string>>;
  /** true si la primera linea eran nombres de columna. */
  conCabecera: boolean;
}

/**
 * Lee la tabla pegada o el fichero.
 *
 * Con cabecera, cada columna se busca por su nombre (en cualquier orden). Sin
 * cabecera, se asume el orden mas comun: telefono, nombre, referencia,
 * direccion, distrito. El telefono se busca ademas por contenido, asi que una
 * lista de numeros a secas tambien entra.
 */
export function leerLote(texto: string): LecturaLote {
  const lineas = (texto ?? '')
    // El BOM que mete Excel se cuela en el nombre de la primera columna.
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    // Solo espacios por delante y lo que sobre por detras: un tabulador al
    // principio es una primera celda vacia (el telefono que falta), y
    // quitarlo corria todas las columnas una posicion.
    .map((l) => l.replace(/^ +/, '').replace(/\s+$/, ''))
    .filter(Boolean);

  const salida: LecturaLote = { filas: [], descartadas: [], columnas: {}, conCabecera: false };
  if (!lineas.length) return salida;

  const sep = separadorDe(lineas[0]!);
  const primera = partir(lineas[0]!, sep);
  const primeraNormalizada = primera.map(sinTildes);

  // Es cabecera si alguna celda coincide con un alias conocido y ninguna
  // parece un telefono.
  const pareceTelefono = (v: string) => /\d{6,}/.test(v.replace(/\D+/g, ''));
  const indice: Partial<Record<keyof FilaLote, number>> = {};

  for (const campo of Object.keys(ALIAS) as Array<keyof FilaLote>) {
    const i = primeraNormalizada.findIndex((celda) => ALIAS[campo]!.includes(celda));
    if (i >= 0) indice[campo] = i;
  }

  // Segunda pasada, por pistas, para las columnas que no se llamaban
  // exactamente como en la lista de alias. Una columna ya asignada no se
  // vuelve a repartir.
  const ocupadas = new Set(Object.values(indice));
  for (const [campo, pistas] of PISTAS) {
    if (indice[campo] !== undefined) continue;
    const i = primera.findIndex((celda, pos) => !ocupadas.has(pos) && palabrasDe(celda).some((p) => pistas.includes(p)));
    if (i >= 0) {
      indice[campo] = i;
      ocupadas.add(i);
    }
  }

  const conCabecera = indice.telefono !== undefined && !primera.some(pareceTelefono);
  salida.conCabecera = conCabecera;

  if (!conCabecera) {
    // Sin cabecera: el orden de siempre, y si solo hay una columna es el
    // telefono.
    indice.telefono = 0;
    if (primera.length > 1) indice.nombre = 1;
    if (primera.length > 2) indice.referencia = 2;
    if (primera.length > 3) indice.direccion = 3;
    if (primera.length > 4) indice.distrito = 4;
  }

  for (const campo of Object.keys(indice) as Array<keyof FilaLote>) {
    const i = indice[campo]!;
    salida.columnas[campo] = conCabecera ? primera[i] ?? `columna ${i + 1}` : `columna ${i + 1}`;
  }

  const cuerpo = conCabecera ? lineas.slice(1) : lineas;
  const desplazamiento = conCabecera ? 2 : 1;

  cuerpo.forEach((linea, i) => {
    const celdas = partir(linea, sep);
    const leer = (campo: keyof FilaLote): string | undefined => {
      const pos = indice[campo];
      if (pos === undefined) return undefined;
      const valor = celdas[pos]?.trim();
      return valor ? valor : undefined;
    };

    const telefono = leer('telefono');
    if (!telefono) {
      // Una fila con pedido o nombre pero sin telefono es un caso que GSG
      // tiene que ver ("el pedido X vino sin telefono"), no una linea que
      // se tira: entra con su incidencia. Una linea sin nada, si se tira.
      if (leer('nombre') || leer('referencia')) {
        salida.filas.push({
          telefono: '',
          nombre: leer('nombre'),
          referencia: leer('referencia'),
          direccion: leer('direccion'),
          distrito: leer('distrito'),
          notas: leer('notas'),
        });
        return;
      }
      salida.descartadas.push({
        linea: i + desplazamiento,
        texto: linea.slice(0, 120),
        motivo: 'la fila no trae teléfono',
      });
      return;
    }

    salida.filas.push({
      telefono,
      nombre: leer('nombre'),
      referencia: leer('referencia'),
      direccion: leer('direccion'),
      distrito: leer('distrito'),
      notas: leer('notas'),
    });
  });

  /**
   * Si NINGUNA fila trae algo que parezca un telefono, la columna elegida no
   * era la de los telefonos.
   *
   * Pasa con una tabla sin cabecera reconocible: se toma la primera columna,
   * que puede ser el nombre, y saldria un lote entero de nombres marcados
   * como "numero invalido". Es mejor decir que no se encontro la columna.
   */
  if (salida.filas.length && !salida.filas.some((f) => pareceTelefono(f.telefono))) {
    salida.descartadas = salida.filas.map((f, i) => ({
      linea: i + desplazamiento,
      texto: f.telefono.slice(0, 120),
      motivo: 'no se encontró ninguna columna con teléfonos',
    }));
    salida.filas = [];
  }

  return salida;
}

export interface PreparacionLote {
  solicitudes: NuevaSolicitud[];
  /** Cuantas quedaron listas para escribir y cuantas con incidencia. */
  listas: number;
  conIncidencia: number;
  duplicadas: number;
  /** Resumen por codigo de incidencia, para ensenarlo antes de arrancar. */
  incidencias: Record<string, number>;
}

/**
 * Revisa las filas y las convierte en solicitudes.
 *
 * Aqui es donde un lote deja de ser una lista de texto: cada telefono queda
 * marcado como marcable o con su incidencia exacta, los repetidos se quedan
 * en uno solo -escribirle dos veces al mismo cliente por dos pedidos suyos es
 * la forma mas rapida de que te reporte- y los que se parecen a otro por un
 * digito se anotan como posible error de tipeo.
 */
export function prepararFilas(filas: FilaLote[], plan: PlanNumeracion = PERU): PreparacionLote {
  const salida: PreparacionLote = {
    solicitudes: [],
    listas: 0,
    conIncidencia: 0,
    duplicadas: 0,
    incidencias: {},
  };

  const revisiones = filas.map((fila) => ({ fila, revision: revisarTelefono(fila.telefono, plan) }));
  // Se comparan los numeros NACIONALES entre si: un "51987654321" y un
  // "987654321" son el mismo telefono, y con el prefijo delante no se
  // parecerian en nada.
  const nacionalesValidos = revisiones
    .map(({ revision }) => (revision.ok ? revision.nacional : null))
    .filter((n): n is string => Boolean(n));

  const vistos = new Map<string, number>();

  for (const { fila, revision } of revisiones) {
    const base = {
      telefonoCrudo: fila.telefono,
      nombre: fila.nombre ?? null,
      referencia: fila.referencia ?? null,
      direccion: fila.direccion ?? null,
      distrito: fila.distrito ?? null,
      notas: fila.notas ?? null,
    };

    if (!revision.ok) {
      const codigo: CodigoIncidencia = revision.incidencia;
      // Un numero corto o raro suele ser un digito mal copiado: si se parece
      // a otro del mismo lote, se dice, que es lo que ahorra el trabajo de
      // adivinar cual era.
      const sospecha = parecidos(soloDigitos(fila.telefono), nacionalesValidos);
      const detalle = sospecha.length
        ? `${revision.detalle}; se parece a ${sospecha.slice(0, 3).join(', ')} del mismo lote`
        : revision.detalle;

      salida.solicitudes.push({
        ...base,
        phone: null,
        estado: 'incidencia',
        incidencia: codigo,
        incidenciaDetalle: detalle,
        requiereHumano: true,
      });
      salida.conIncidencia++;
      salida.incidencias[codigo] = (salida.incidencias[codigo] ?? 0) + 1;
      continue;
    }

    const repetidas = vistos.get(revision.phone);
    if (repetidas !== undefined) {
      salida.duplicadas++;
      // No se crea otra solicitud: se anota en la que ya existe, para que el
      // operador vea que ese telefono venia en dos pedidos.
      const previa = salida.solicitudes[repetidas]!;
      const anterior = previa.notas ? `${previa.notas} · ` : '';
      previa.notas = `${anterior}también en: ${[fila.referencia, fila.nombre].filter(Boolean).join(' ') || 'otra fila del lote'}`;
      continue;
    }

    vistos.set(revision.phone, salida.solicitudes.length);
    salida.solicitudes.push({ ...base, phone: revision.phone, estado: 'pendiente' });
    salida.listas++;
  }

  return salida;
}
