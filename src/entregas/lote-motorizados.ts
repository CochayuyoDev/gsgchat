/**
 * Alta de motorizados en lote: un texto pegado (de Excel, de un chat, de una
 * hoja), una linea por motorizado, y de cada linea se saca el nombre, el
 * WhatsApp, la placa y la zona.
 *
 * Con cabecera se entiende cualquier orden ("nombre; whatsapp; placa; zona").
 * Sin cabecera no se exige orden: el telefono es la celda que parece un
 * telefono, la placa la que parece una placa (ABC-123, M0J-010), el nombre la
 * primera celda de texto que queda y la zona lo demas. Es el mismo espiritu
 * que `leerLote` del reparto (src/rutas/lote.ts), pero para motorizados.
 */

export interface FilaMotorizado {
  nombre: string;
  telefono: string;
  placa?: string;
  zona?: string;
}

export interface LecturaMotorizados {
  filas: FilaMotorizado[];
  descartadas: Array<{ linea: number; texto: string; motivo: string }>;
  conCabecera: boolean;
}

const ALIAS: Record<keyof FilaMotorizado, string[]> = {
  nombre: ['nombre', 'motorizado', 'nombres', 'conductor', 'repartidor'],
  telefono: ['telefono', 'whatsapp', 'celular', 'numero', 'movil', 'phone', 'tel', 'contacto'],
  placa: ['placa', 'moto', 'matricula', 'vehiculo'],
  zona: ['zona', 'zonas', 'distrito', 'distritos', 'sector', 'cobertura'],
};

const limpiar = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** El separador que mas columnas produce en la primera linea: ; tabulador o coma. */
function separadorDe(linea: string): string {
  return [';', '\t', ','].sort((a, b) => linea.split(b).length - linea.split(a).length)[0]!;
}

const pareceTelefono = (c: string) => /^\+?\s*(51\s?)?9\d{2}\s?\d{3}\s?\d{3}$/.test(c.trim()) || /^\+?\d{9,15}$/.test(c.replace(/[\s-]/g, ''));
const pareceRegla = (c: string) => /^[A-Z0-9]{2,3}-[A-Z0-9]{3,4}$/i.test(c.trim());

function celdasDe(linea: string, sep: string): string[] {
  return linea.split(sep).map((c) => c.replace(/^﻿/, '').trim()).filter((c, i, arr) => c !== '' || i < arr.length - 1);
}

export function leerListaMotorizados(texto: string): LecturaMotorizados {
  const salida: LecturaMotorizados = { filas: [], descartadas: [], conCabecera: false };
  const lineas = (texto ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lineas.length) return salida;
  const sep = separadorDe(lineas[0]!);
  const primera = celdasDe(lineas[0]!, sep).map(limpiar);
  const columnas: Partial<Record<keyof FilaMotorizado, number>> = {};
  for (const campo of Object.keys(ALIAS) as Array<keyof FilaMotorizado>) {
    const i = primera.findIndex((c) => ALIAS[campo].includes(c));
    if (i >= 0) columnas[campo] = i;
  }
  salida.conCabecera = columnas.telefono !== undefined || (columnas.nombre !== undefined && !primera.some(pareceTelefono));
  const cuerpo = salida.conCabecera ? lineas.slice(1) : lineas;
  const desde = salida.conCabecera ? 2 : 1;

  cuerpo.forEach((linea, i) => {
    const numero = i + desde;
    const celdas = celdasDe(linea, sep);
    let fila: FilaMotorizado | null = null;
    if (salida.conCabecera && columnas.telefono !== undefined) {
      fila = {
        nombre: (celdas[columnas.nombre ?? -1] ?? '').trim(),
        telefono: (celdas[columnas.telefono] ?? '').trim(),
        placa: columnas.placa !== undefined ? (celdas[columnas.placa] ?? '').trim() || undefined : undefined,
        zona: columnas.zona !== undefined ? (celdas[columnas.zona] ?? '').trim() || undefined : undefined,
      };
      // Sin columna de nombre en la cabecera: la primera celda de texto que no sea el telefono ni la placa.
      if (!fila.nombre) fila.nombre = celdas.find((c, k) => k !== columnas.telefono && k !== columnas.placa && k !== columnas.zona && c && !pareceTelefono(c) && !pareceRegla(c)) ?? '';
    } else {
      const iTel = celdas.findIndex(pareceTelefono);
      if (iTel < 0) {
        salida.descartadas.push({ linea: numero, texto: linea.slice(0, 120), motivo: 'no se ve ningún número de WhatsApp (9 cifras que empiecen por 9)' });
        return;
      }
      const resto = celdas.filter((_, k) => k !== iTel);
      const iPlaca = resto.findIndex(pareceRegla);
      const placa = iPlaca >= 0 ? resto[iPlaca] : undefined;
      const sinPlaca = resto.filter((_, k) => k !== iPlaca);
      const nombre = sinPlaca.shift() ?? '';
      fila = { nombre, telefono: celdas[iTel]!, placa, zona: sinPlaca.filter(Boolean).join(', ') || undefined };
    }
    if (!fila.telefono) {
      salida.descartadas.push({ linea: numero, texto: linea.slice(0, 120), motivo: 'falta el número de WhatsApp' });
      return;
    }
    if (!fila.nombre) {
      salida.descartadas.push({ linea: numero, texto: linea.slice(0, 120), motivo: 'falta el nombre' });
      return;
    }
    salida.filas.push(fila);
  });
  return salida;
}
