/**
 * Un empaquetador tar minimo (formato ustar) con gzip, escrito a mano.
 *
 * Existe porque el paquete `tar` no esta en node_modules y meter una
 * dependencia solo para la copia nocturna no merece la pena: el formato son
 * cabeceras de 512 bytes, el contenido rellenado a 512 y dos bloques de
 * ceros al final. Lo que sale se abre con cualquier 7-Zip, tar o WinRAR.
 */

import { createWriteStream } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import type { Writable } from 'node:stream';

const BLOQUE = 512;

function octal(n: number, ancho: number): string {
  return n.toString(8).padStart(ancho - 1, '0') + '\0';
}

function escribirCampo(cab: Buffer, desde: number, ancho: number, valor: string): void {
  const b = Buffer.from(valor, 'utf8');
  b.copy(cab, desde, 0, Math.min(ancho, b.length));
}

/** Parte un nombre largo en (prefijo, nombre) como manda ustar. */
function partirNombre(nombre: string): { nombre: string; prefijo: string } {
  if (Buffer.byteLength(nombre) <= 100) return { nombre, prefijo: '' };
  const trozos = nombre.split('/');
  for (let i = trozos.length - 1; i > 0; i--) {
    const prefijo = trozos.slice(0, i).join('/');
    const resto = trozos.slice(i).join('/');
    if (Buffer.byteLength(prefijo) <= 155 && Buffer.byteLength(resto) <= 100) return { nombre: resto, prefijo };
  }
  // No cabe ni partido: se recorta (raro; nombres de mas de 255 bytes).
  return { nombre: nombre.slice(-100), prefijo: '' };
}

export function cabeceraTar(entrada: { nombre: string; tamano: number; mtime: Date; directorio: boolean; modo?: number }): Buffer {
  const cab = Buffer.alloc(BLOQUE, 0);
  const { nombre, prefijo } = partirNombre(entrada.directorio && !entrada.nombre.endsWith('/') ? `${entrada.nombre}/` : entrada.nombre);
  escribirCampo(cab, 0, 100, nombre);
  escribirCampo(cab, 100, 8, octal(entrada.modo ?? (entrada.directorio ? 0o755 : 0o644), 8));
  escribirCampo(cab, 108, 8, octal(0, 8));
  escribirCampo(cab, 116, 8, octal(0, 8));
  escribirCampo(cab, 124, 12, octal(entrada.directorio ? 0 : entrada.tamano, 12));
  escribirCampo(cab, 136, 12, octal(Math.floor(entrada.mtime.getTime() / 1000), 12));
  escribirCampo(cab, 148, 8, '        ');
  escribirCampo(cab, 156, 1, entrada.directorio ? '5' : '0');
  escribirCampo(cab, 257, 6, 'ustar\0');
  escribirCampo(cab, 263, 2, '00');
  escribirCampo(cab, 265, 32, 'gsgchat');
  escribirCampo(cab, 297, 32, 'gsgchat');
  escribirCampo(cab, 329, 8, octal(0, 8));
  escribirCampo(cab, 337, 8, octal(0, 8));
  escribirCampo(cab, 345, 155, prefijo);
  let suma = 0;
  for (const b of cab) suma += b;
  escribirCampo(cab, 148, 8, `${suma.toString(8).padStart(6, '0')}\0 `);
  return cab;
}

function escribir(destino: Writable, trozo: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = destino.write(trozo, (error) => (error ? reject(error) : undefined));
    if (ok) resolve();
    else destino.once('drain', resolve);
  });
}

async function listar(raiz: string): Promise<Array<{ ruta: string; relativa: string; directorio: boolean; tamano: number; mtime: Date }>> {
  const salida: Array<{ ruta: string; relativa: string; directorio: boolean; tamano: number; mtime: Date }> = [];
  async function recorrer(dir: string, rel: string): Promise<void> {
    const entradas = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entradas) {
      const ruta = path.join(dir, e.name);
      const relativa = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const s = await stat(ruta);
        salida.push({ ruta, relativa, directorio: true, tamano: 0, mtime: s.mtime });
        await recorrer(ruta, relativa);
      } else if (e.isFile()) {
        const s = await stat(ruta);
        salida.push({ ruta, relativa, directorio: false, tamano: s.size, mtime: s.mtime });
      }
      // Enlaces y otros: se saltan (no hay en los respaldos).
    }
  }
  await recorrer(raiz, '');
  return salida;
}

/**
 * Empaqueta una carpeta entera en `destino` (.tar.gz). Devuelve cuantos
 * ficheros y cuantos bytes (sin comprimir) entraron.
 */
export async function empaquetarCarpeta(carpeta: string, destino: string, opciones: { raizDentro?: string } = {}): Promise<{ ficheros: number; bytes: number }> {
  const entradas = await listar(carpeta);
  const raiz = opciones.raizDentro ?? path.basename(carpeta);
  const gz = createGzip({ level: 6 });
  const fichero = createWriteStream(destino);
  const terminado = new Promise<void>((resolve, reject) => {
    fichero.on('finish', resolve);
    fichero.on('error', reject);
    gz.on('error', reject);
  });
  gz.pipe(fichero);

  let ficheros = 0;
  let bytes = 0;
  try {
    await escribir(gz, cabeceraTar({ nombre: raiz, tamano: 0, mtime: new Date(), directorio: true }));
    for (const e of entradas) {
      const nombre = `${raiz}/${e.relativa}`;
      await escribir(gz, cabeceraTar({ nombre, tamano: e.tamano, mtime: e.mtime, directorio: e.directorio }));
      if (e.directorio) continue;
      const fd = await open(e.ruta, 'r');
      try {
        const buf = Buffer.alloc(64 * 1024);
        let leidos = 0;
        while (leidos < e.tamano) {
          const { bytesRead } = await fd.read(buf, 0, Math.min(buf.length, e.tamano - leidos), null);
          if (!bytesRead) break;
          leidos += bytesRead;
          await escribir(gz, Buffer.from(buf.subarray(0, bytesRead)));
        }
        // Si el fichero cambio de tamano mientras se leia, se cuadra con la cabecera.
        if (leidos < e.tamano) await escribir(gz, Buffer.alloc(e.tamano - leidos, 0));
        const resto = e.tamano % BLOQUE;
        if (resto) await escribir(gz, Buffer.alloc(BLOQUE - resto, 0));
      } finally {
        await fd.close();
      }
      ficheros += 1;
      bytes += e.tamano;
    }
    await escribir(gz, Buffer.alloc(BLOQUE * 2, 0));
  } finally {
    gz.end();
  }
  await terminado;
  return { ficheros, bytes };
}
