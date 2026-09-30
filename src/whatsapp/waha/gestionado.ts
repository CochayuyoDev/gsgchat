/**
 * El WAHA que levanta el propio sistema.
 *
 * Antes, conectar por WAHA daba por hecho que alguien ya habia arrancado el
 * contenedor a mano; si no, la pantalla se quedaba en "Falta la direccion del
 * contenedor de WAHA" y no habia forma de salir de ahi sin saber Docker. Ahora,
 * si no aparece ningun WAHA, el sistema lo pone el mismo con Docker:
 *
 *   sin contenedor → descargar la imagen → docker run → esperar a que conteste
 *   contenedor parado → docker start → esperar a que conteste
 *
 * La clave de API vive en el propio contenedor (su WAHA_API_KEY) y se lee de
 * ahi cada vez: asi da igual que la base se haya borrado (la demo guarda todo
 * en memoria) o que el contenedor lo haya creado otra instalacion.
 *
 * En docker compose no se usa: ahi WAHA es un servicio mas y WAHA_URL ya
 * apunta a el, asi que nunca se llega a buscarlo.
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { sondearWaha } from './session.js';

export const CONTENEDOR_WAHA = 'gsgchat-waha';
export const IMAGEN_WAHA = 'devlikeapro/waha';
/** Las sesiones vinculadas: sin esto, recrear el contenedor pide otro QR. */
export const VOLUMEN_WAHA = 'gsgchat-waha-sesiones';

export type Ejecutor = (programa: string, args: string[], timeoutMs: number) => Promise<string>;

export type FaseWaha = 'parado' | 'sin-docker' | 'descargando' | 'arrancando' | 'listo' | 'error';

export interface EstadoWaha {
  fase: FaseWaha;
  /** Donde contesta, cuando ya contesta. */
  url: string;
  apiKey: string;
  /** Lo que se le enseña al usuario mientras espera o cuando algo falla. */
  detalle: string;
}

export interface OpcionesWahaGestionado {
  /** Puerto de esta maquina en el que se publica el 3000 del contenedor. */
  puerto: number;
  /** WEBJS | NOWEB | GOWS | WPP. Vacio = el que traiga la imagen. */
  motor?: string;
  ejecutar?: Ejecutor;
  fetchImpl?: typeof fetch;
  /** Cuanto se espera a que el contenedor conteste despues de arrancarlo. */
  esperaMs?: number;
  pausaMs?: number;
}

export interface WahaGestionado {
  /**
   * Pone el contenedor en marcha si hace falta y devuelve como va. No espera
   * a que termine: la descarga de la imagen tarda minutos la primera vez y la
   * pantalla pregunta otra vez hasta que la fase sea `listo`.
   */
  asegurar(): Promise<EstadoWaha>;
  estado(): EstadoWaha;
  /** La clave del contenedor si ya existe, sin arrancar nada. */
  claveExistente(): Promise<string>;
}

const ejecutarDeVerdad: Ejecutor = (programa, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(programa, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detalle = String(stderr || '').trim() || error.message;
        reject(new Error(detalle));
        return;
      }
      resolve(String(stdout));
    });
  });

interface Inspeccion {
  corriendo: boolean;
  apiKey: string;
}

export function crearWahaGestionado(opciones: OpcionesWahaGestionado): WahaGestionado {
  const ejecutar = opciones.ejecutar ?? ejecutarDeVerdad;
  const fetchImpl = opciones.fetchImpl ?? fetch;
  const esperaMs = opciones.esperaMs ?? 120_000;
  const pausaMs = opciones.pausaMs ?? 2_000;
  const url = `http://127.0.0.1:${opciones.puerto}`;

  let actual: EstadoWaha = { fase: 'parado', url: '', apiKey: '', detalle: '' };
  let tarea: Promise<void> | null = null;

  const poner = (fase: FaseWaha, detalle: string, extra: Partial<EstadoWaha> = {}) => {
    actual = { ...actual, ...extra, fase, detalle };
  };

  async function hayDocker(): Promise<boolean> {
    try {
      await ejecutar('docker', ['version', '--format', '{{.Server.Version}}'], 15_000);
      return true;
    } catch {
      return false;
    }
  }

  async function inspeccionar(): Promise<Inspeccion | null> {
    let salida: string;
    try {
      salida = await ejecutar('docker', ['inspect', '--format', '{{json .}}', CONTENEDOR_WAHA], 15_000);
    } catch {
      return null; // "No such object": todavia no existe.
    }
    const info = JSON.parse(salida) as { State?: { Running?: boolean }; Config?: { Env?: string[] } };
    const env = info.Config?.Env ?? [];
    const clave = env.find((linea) => linea.startsWith('WAHA_API_KEY='))?.slice('WAHA_API_KEY='.length) ?? '';
    return { corriendo: Boolean(info.State?.Running), apiKey: clave };
  }

  async function esperarQueConteste(apiKey: string): Promise<boolean> {
    const limite = Date.now() + esperaMs;
    for (;;) {
      if ((await sondearWaha(url, apiKey, fetchImpl, 2_000)) === 'listo') return true;
      if (Date.now() >= limite) return false;
      await new Promise((r) => setTimeout(r, pausaMs));
    }
  }

  async function arrancar(): Promise<void> {
    if (!(await hayDocker())) {
      poner(
        'sin-docker',
        'Para conectar por WAHA hace falta Docker y no está funcionando en esta máquina. ' +
          'Instala Docker Desktop (https://www.docker.com/products/docker-desktop/), ábrelo y vuelve a pulsar el botón.',
      );
      return;
    }

    const existente = await inspeccionar();
    let apiKey = existente?.apiKey ?? '';

    if (existente && !existente.corriendo) {
      poner('arrancando', 'Arrancando el contenedor de WAHA…');
      await ejecutar('docker', ['start', CONTENEDOR_WAHA], 60_000);
    } else if (!existente) {
      apiKey = randomBytes(24).toString('base64url');
      poner('descargando', 'Descargando WAHA. La primera vez tarda unos minutos, según tu conexión…');
      await ejecutar('docker', ['pull', IMAGEN_WAHA], 30 * 60_000);
      poner('arrancando', 'Arrancando el contenedor de WAHA…');
      await ejecutar(
        'docker',
        [
          'run',
          '-d',
          '--name',
          CONTENEDOR_WAHA,
          '--restart',
          'unless-stopped',
          // Solo desde esta maquina: la API de WAHA manda mensajes en tu nombre.
          '-p',
          `127.0.0.1:${opciones.puerto}:3000`,
          // Para que WAHA pueda devolver los mensajes a este servidor, que corre
          // fuera del contenedor (en Docker Desktop ya existe; en Linux no).
          '--add-host',
          'host.docker.internal:host-gateway',
          '-v',
          `${VOLUMEN_WAHA}:/app/.sessions`,
          '-e',
          `WAHA_API_KEY=${apiKey}`,
          ...(opciones.motor ? ['-e', `WHATSAPP_DEFAULT_ENGINE=${opciones.motor}`] : []),
          IMAGEN_WAHA,
        ],
        120_000,
      );
    }

    poner('arrancando', 'Esperando a que WAHA conteste…', { apiKey });
    if (!(await esperarQueConteste(apiKey))) {
      poner(
        'error',
        `El contenedor ${CONTENEDOR_WAHA} está arrancado pero WAHA no contesta en ${url}. ` +
          `Mira qué dice con "docker logs ${CONTENEDOR_WAHA}".`,
      );
      return;
    }
    poner('listo', `WAHA funcionando en ${url}.`, { url, apiKey });
  }

  return {
    async asegurar() {
      // Estaba listo: se comprueba que siga vivo (lo pueden haber parado desde
      // Docker Desktop) antes de darlo por bueno.
      if (actual.fase === 'listo' && (await sondearWaha(url, actual.apiKey, fetchImpl, 2_000)) === 'listo') {
        return actual;
      }
      if (!tarea) {
        tarea = arrancar()
          .catch((error: unknown) => {
            poner('error', `No se pudo levantar WAHA: ${error instanceof Error ? error.message : String(error)}`);
          })
          .finally(() => {
            tarea = null;
          });
      }
      // Un momento para que un contenedor que ya existia conteste en esta misma
      // llamada, sin esperar al siguiente intento de la pantalla.
      await Promise.race([tarea, new Promise((r) => setTimeout(r, 1_500))]);
      return actual;
    },
    estado: () => actual,
    async claveExistente() {
      try {
        return (await inspeccionar())?.apiKey ?? '';
      } catch {
        return '';
      }
    },
  };
}

/**
 * La direccion de este servidor tal y como la ve un contenedor.
 *
 * Dentro de Docker, `localhost` es el propio contenedor: si WAHA recibe
 * http://localhost:3300/webhooks/waha, los mensajes nunca llegan y nadie se
 * entera. Cuando este servidor solo escucha en esta maquina, se cambia el
 * host por host.docker.internal, que es como el contenedor llega a ella.
 */
export function vistaDesdeContenedor(base: string): string {
  try {
    const url = new URL(base);
    if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname)) {
      url.hostname = 'host.docker.internal';
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return base;
  }
}

/** Si una direccion es de esta misma maquina. */
export function esLocal(base: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(new URL(base).hostname);
  } catch {
    return false;
  }
}
