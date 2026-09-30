/**
 * Los distritos que existen, para no guardar cualquier cosa como destino.
 *
 * Un caso real: alguien contestó "No viejo" a "¿de qué distrito recogemos?" y
 * quedó guardado como el distrito de recojo. La ficha llegó al repartidor
 * diciendo que recogiera en "No viejo". Nada de lo que se valida en general
 * —longitud, signos, tecleo al azar— lo detecta: son dos palabras normales.
 *
 * La única forma de cazarlo es saber qué distritos hay. En Lima y Callao son
 * cincuenta, y es una lista que no cambia: la aritmética es a favor.
 *
 * Para una tienda que opere en otra parte, la lista se deja vacía y el campo
 * vuelve a aceptar texto libre. Es preferible a inventarse una validación
 * genérica que rechace nombres legítimos.
 */

/** Los 43 distritos de Lima Metropolitana. */
export const DISTRITOS_LIMA = [
  'Ancón', 'Ate', 'Barranco', 'Breña', 'Carabayllo', 'Chaclacayo', 'Chorrillos',
  'Cieneguilla', 'Comas', 'El Agustino', 'Independencia', 'Jesús María', 'La Molina',
  'La Victoria', 'Lima', 'Lince', 'Los Olivos', 'Lurigancho', 'Lurín',
  'Magdalena del Mar', 'Miraflores', 'Pachacámac', 'Pucusana', 'Pueblo Libre',
  'Puente Piedra', 'Punta Hermosa', 'Punta Negra', 'Rímac', 'San Bartolo',
  'San Borja', 'San Isidro', 'San Juan de Lurigancho', 'San Juan de Miraflores',
  'San Luis', 'San Martín de Porres', 'San Miguel', 'Santa Anita',
  'Santa María del Mar', 'Santa Rosa', 'Santiago de Surco', 'Surquillo',
  'Villa El Salvador', 'Villa María del Triunfo',
];

/** Los 7 de la Provincia Constitucional del Callao. */
export const DISTRITOS_CALLAO = [
  'Bellavista', 'Callao', 'Carmen de la Legua Reynoso', 'La Perla', 'La Punta',
  'Mi Perú', 'Ventanilla',
];

/**
 * Como los llama la gente.
 *
 * Nadie escribe "Santiago de Surco" ni "San Martín de Porres": escriben
 * "Surco" y "SMP". Sin estos alias, el asistente rechazaría la respuesta
 * correcta de la mitad de los clientes.
 */
export const ALIAS: Record<string, string> = {
  surco: 'Santiago de Surco',
  smp: 'San Martín de Porres',
  'san martin': 'San Martín de Porres',
  sjl: 'San Juan de Lurigancho',
  'san juan lurigancho': 'San Juan de Lurigancho',
  sjm: 'San Juan de Miraflores',
  'san juan miraflores': 'San Juan de Miraflores',
  vmt: 'Villa María del Triunfo',
  ves: 'Villa El Salvador',
  villa: 'Villa El Salvador',
  magdalena: 'Magdalena del Mar',
  'pueblo libre': 'Pueblo Libre',
  cercado: 'Lima',
  'cercado de lima': 'Lima',
  centro: 'Lima',
  'jesus maria': 'Jesús María',
  chosica: 'Lurigancho',
  'santa clara': 'Ate',
  vitarte: 'Ate',
  'ate vitarte': 'Ate',
  'santa anita': 'Santa Anita',
  carmen: 'Carmen de la Legua Reynoso',
  'mi peru': 'Mi Perú',
};

export const DISTRITOS_LIMA_CALLAO = [...DISTRITOS_LIMA, ...DISTRITOS_CALLAO];

export const normalizaFrase = (texto: string): string =>
  texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normaliza = normalizaFrase;

/** Palabras que sobran al decir un distrito: "vivo en Surco", "distrito Ate". */
const RELLENO = new Set([
  'el', 'la', 'los', 'las', 'de', 'del', 'en', 'es', 'soy', 'vivo', 'estoy',
  'distrito', 'zona', 'por', 'aca', 'aqui', 'desde', 'hasta', 'un', 'una',
]);

const sinRelleno = (texto: string): string =>
  normaliza(texto)
    .split(' ')
    .filter((p) => !RELLENO.has(p))
    .join(' ');

/** Lo que en un nombre podría leerse como patrón: "Mi Perú" no, pero por si acaso. */
const escapaRegex = (texto: string): string =>
  texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Distancia de edición, para tolerar una errata sin abrir la puerta a todo. */
export function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);

  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      const coste = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(actual[j - 1]! + 1, previa[j]! + 1, previa[j - 1]! + coste);
    }
    previa = actual;
  }

  return previa[b.length]!;
}

/**
 * Los distritos que aparecen en una frase, en el orden en que aparecen.
 *
 * Se busca por posición y no con un patrón: en "una caja de documentos de
 * Surco a Miraflores" el primer "de" es el de la caja, y cualquier patrón de
 * "de X a Y" se lleva media frase por delante.
 */
export function distritosEnTexto(
  texto: string,
  catalogo: string[] = DISTRITOS_LIMA_CALLAO,
): Array<{ nombre: string; posicion: number }> {
  if (!catalogo.length) return [];

  const limpio = normaliza(texto);
  const tomado = new Array<boolean>(limpio.length).fill(false);
  const encontrados = new Map<string, number>();

  // Los nombres largos antes que los cortos, y lo que ya se llevó uno no lo
  // vuelve a leer otro: en "san juan de lurigancho" está "Lurigancho" dentro,
  // y contarlo dos veces convierte una ruta de dos distritos en una de tres.
  const candidatos: Array<[string, string]> = [
    ...Object.entries(ALIAS).map(([alias, nombre]) => [alias, nombre] as [string, string]),
    ...catalogo.map((d) => [normaliza(d), d] as [string, string]),
  ].sort((a, b) => b[0].length - a[0].length);

  for (const [clave, nombre] of candidatos) {
    if (!catalogo.includes(nombre)) continue;

    // Palabra entera: "lima" no puede casar dentro de "limatambo".
    const patron = new RegExp(`\\b${escapaRegex(clave)}\\b`, 'g');

    let encontrado: RegExpExecArray | null;
    while ((encontrado = patron.exec(limpio)) !== null) {
      const fin = encontrado.index + encontrado[0].length;
      let libre = true;
      for (let i = encontrado.index; i < fin; i++) if (tomado[i]) libre = false;
      if (!libre) continue;

      for (let i = encontrado.index; i < fin; i++) tomado[i] = true;
      if (!encontrados.has(nombre)) encontrados.set(nombre, encontrado.index);
    }
  }

  return [...encontrados.entries()]
    .map(([nombre, posicion]) => ({ nombre, posicion }))
    .sort((a, b) => a.posicion - b.posicion);
}

/** Si `trozo` aparece en `texto` como palabra entera, no dentro de otra. */
function contienePalabra(texto: string, trozo: string): boolean {
  const escapado = escapaRegex(trozo);
  return new RegExp(`(^|\\s)${escapado}(\\s|$)`).test(texto);
}

/**
 * El distrito que quiso decir, o null si no se parece a ninguno.
 *
 * Devuelve el nombre CANÓNICO: quien escribe "surco" o "sanborja" queda
 * guardado como "Santiago de Surco" y "San Borja", que es lo que hace que la
 * ficha se pueda filtrar y contar después.
 *
 * Con `catalogo` vacío no se valida nada y se devuelve lo que escribió: es lo
 * que corresponde a una tienda que no opera en Lima.
 */
export function reconocerDistrito(
  texto: string,
  catalogo: string[] = DISTRITOS_LIMA_CALLAO,
): string | null {
  const limpio = texto.trim();
  if (!limpio) return null;
  if (!catalogo.length) return limpio;

  const buscado = sinRelleno(limpio);
  if (!buscado) return null;

  // Alias primero: "surco" es Santiago de Surco y no hay que adivinarlo.
  if (ALIAS[buscado] && catalogo.includes(ALIAS[buscado]!)) return ALIAS[buscado]!;

  // Los alias entran tambien en la busqueda por parecido: quien escribe
  // "magdalna" quiere decir Magdalena, y comparandolo solo con el nombre
  // oficial -"magdalena del mar"- la distancia se dispara y se rechaza.
  const candidatos = [
    ...catalogo.map((d) => ({ nombre: d, clave: sinRelleno(d) })),
    ...Object.entries(ALIAS)
      .filter(([, nombre]) => catalogo.includes(nombre))
      .map(([alias, nombre]) => ({ nombre, clave: sinRelleno(alias) })),
  ];

  const exacto = candidatos.find((c) => c.clave === buscado);
  if (exacto) return exacto.nombre;

  // Contenido: "vivo en san borja ahora mismo" trae el distrito dentro.
  //
  // Por PALABRA ENTERA y con cuatro letras minimo por los dos lados. Suelto,
  // esto contestaba San Isidro a un "si" y El Agustino a un "no" -porque
  // "isidro" lleva un "si" dentro y "agustino" un "no"-, y el repartidor se
  // encontraba un distrito donde el cliente solo habia dicho que si.
  const dentro =
    buscado.length >= 4
      ? candidatos.find(
          (c) =>
            c.clave.length >= 4 &&
            (contienePalabra(buscado, c.clave) || contienePalabra(c.clave, buscado)),
        )
      : undefined;
  if (dentro) return dentro.nombre;

  // Y una errata: "mirafores", "surkillo". Se tolera una por cada cuatro
  // letras, con techo de dos: mas que eso ya no es una errata, es otra
  // palabra. Con una cada cinco, "surkillo" -que se escribe asi media
  // Lima- se quedaba fuera por un solo caracter.
  const margen = Math.min(2, Math.floor(buscado.length / 4));
  if (margen < 1) return null;

  let mejor: { nombre: string; d: number } | null = null;
  for (const c of candidatos) {
    const d = distancia(buscado, c.clave);
    if (d > margen) continue;

    // La primera letra tiene que coincidir, salvo en palabras largas con
    // UN solo fallo. Sin esta condicion, "aqui nomas" -que no es una
    // respuesta- se guardaba como Comas: quitado el relleno queda "nomas",
    // y de "comas" lo separa una letra. Es el mismo fallo que "No viejo",
    // y en la ficha del repartidor se lee igual de bien.
    const mismaInicial = buscado[0] === c.clave[0];
    if (!mismaInicial && !(buscado.length >= 6 && d === 1)) continue;

    if (!mejor || d < mejor.d) mejor = { nombre: c.nombre, d };
  }

  return mejor?.nombre ?? null;
}
