/**
 * El indice en memoria con el que se eligen las lecciones que vienen al
 * caso en cada turno.
 *
 * Con diez lecciones se podrian meter todas en el prompt; con diez mil, no:
 * hay que elegir. Esto es un buscador lexico clasico (BM25 sobre las
 * palabras con raiz) mas un empujon por trigramas para las faltas de
 * ortografia. Es determinista, tarda un milisegundo y no depende de ningun
 * servicio: si la IA esta caida, esto sigue funcionando.
 *
 * Cada documento es una leccion: su texto indexable es la pregunta (en los
 * ejemplos) o el propio hecho (en los datos), mas el tema.
 */

import { dice, palabras, trigramas } from './texto.js';

interface Doc {
  terminos: Map<string, number>;
  largo: number;
  tri: Set<string>;
}

export interface Acierto {
  id: number;
  /** Puntuacion relativa (0..1 aprox.): 1 es la mejor del indice para esa consulta. */
  puntos: number;
  /** Que parte de las palabras de la consulta aparecen en la leccion. */
  cobertura: number;
}

const K1 = 1.2;
const B = 0.75;

export class Indice {
  private docs = new Map<number, Doc>();
  private postings = new Map<string, Map<number, number>>();
  private largoTotal = 0;

  get tamano(): number {
    return this.docs.size;
  }

  agregar(id: number, texto: string): void {
    if (this.docs.has(id)) this.quitar(id);
    const lista = palabras(texto);
    const terminos = new Map<string, number>();
    for (const t of lista) terminos.set(t, (terminos.get(t) ?? 0) + 1);
    const doc: Doc = { terminos, largo: lista.length, tri: trigramas(texto) };
    this.docs.set(id, doc);
    this.largoTotal += doc.largo;
    for (const [t, tf] of terminos) {
      let p = this.postings.get(t);
      if (!p) this.postings.set(t, (p = new Map()));
      p.set(id, tf);
    }
  }

  quitar(id: number): void {
    const doc = this.docs.get(id);
    if (!doc) return;
    this.docs.delete(id);
    this.largoTotal -= doc.largo;
    for (const t of doc.terminos.keys()) {
      const p = this.postings.get(t);
      if (!p) continue;
      p.delete(id);
      if (!p.size) this.postings.delete(t);
    }
  }

  vaciar(): void {
    this.docs.clear();
    this.postings.clear();
    this.largoTotal = 0;
  }

  /**
   * Las `n` lecciones que mas se parecen a la consulta, de mejor a peor.
   * `minimo` corta lo que no tiene casi nada que ver (0..1).
   */
  buscar(consulta: string, n = 8, minimo = 0.2): Acierto[] {
    if (!this.docs.size) return [];
    const q = palabras(consulta);
    const qTri = trigramas(consulta);
    const N = this.docs.size;
    const largoMedio = this.largoTotal / N || 1;
    const puntos = new Map<number, number>();
    const cubiertas = new Map<number, number>();
    const unicos = [...new Set(q)];

    // La puntuacion se mide contra la "ideal": lo que sumaria una leccion
    // que tuviera todas las palabras de la consulta. Asi 0.8 significa lo
    // mismo con cien lecciones que con diez mil, y una consulta de la que
    // no hay nada parecido no se cuela solo por ser "la mejor de las malas".
    let ideal = 0;
    for (const t of unicos) {
      const p = this.postings.get(t);
      const df = p?.size ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      ideal += idf;
      if (!p) continue;
      for (const [id, tf] of p) {
        const doc = this.docs.get(id)!;
        const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.largo) / largoMedio));
        puntos.set(id, (puntos.get(id) ?? 0) + idf * Math.min(tfNorm, 1.4));
        cubiertas.set(id, (cubiertas.get(id) ?? 0) + 1);
      }
    }

    // Las faltas de ortografia y las palabras que el stemmer no junto: se
    // miran los trigramas, pero solo en un subconjunto acotado para que
    // buscar siga costando casi nada con muchas lecciones.
    const porTri = new Map<number, number>();
    if (qTri.size) {
      let mirados = 0;
      for (const [id, doc] of this.docs) {
        if (puntos.has(id)) {
          porTri.set(id, dice(qTri, doc.tri));
          continue;
        }
        if (++mirados > 4000) continue;
        const d = dice(qTri, doc.tri);
        if (d >= 0.35) porTri.set(id, d);
      }
    }

    const ids = new Set<number>([...puntos.keys(), ...porTri.keys()]);
    const salida: Acierto[] = [];
    for (const id of ids) {
      const lexico = ideal > 0 ? Math.min((puntos.get(id) ?? 0) / ideal, 1.2) : 0;
      const tri = porTri.get(id) ?? 0;
      // Lo lexico manda; los trigramas rescatan lo mal escrito y desempatan.
      const total = Math.min(1, lexico * 0.8 + tri * 0.5);
      if (total < minimo) continue;
      salida.push({ id, puntos: Number(total.toFixed(4)), cobertura: unicos.length ? (cubiertas.get(id) ?? 0) / unicos.length : 0 });
    }
    return salida.sort((a, b) => b.puntos - a.puntos || a.id - b.id).slice(0, n);
  }
}
