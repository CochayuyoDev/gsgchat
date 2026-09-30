/**
 * El correo de emergencia: por donde se avisa cuando el WhatsApp propio no
 * puede avisar de nada.
 *
 * Va por la API de Brevo (plan gratis, sin servidor de correo propio): una
 * llamada HTTPS con la clave que el dueno pega en la pantalla. No hay
 * nodemailer ni SMTP en el proyecto y no hace falta.
 *
 * Nunca lanza: devuelve `{ ok, detalle }` en cristiano, que es lo que se
 * ensena en la pantalla y lo que se apunta en la bitacora.
 */

export const URL_BREVO = 'https://api.brevo.com/v3/smtp/email';

export interface AjustesCorreo {
  correoAviso: string;
  remitente: string;
  nombreRemitente: string;
}

export interface DepsCorreo {
  fetchImpl?: typeof fetch;
  clave: () => string;
  ajustes: () => AjustesCorreo;
  timeoutMs?: number;
}

export interface ResultadoCorreo {
  ok: boolean;
  detalle: string;
  at: string;
}

export interface ServicioCorreo {
  /** Si hay clave y correo de destino: sin eso no se puede mandar nada. */
  configurado(): { ok: boolean; falta: string | null };
  enviar(asunto: string, texto: string): Promise<ResultadoCorreo>;
  /** Manda un correo de prueba al correo de aviso. */
  probar(): Promise<ResultadoCorreo>;
  ultimo(): ResultadoCorreo | null;
}

export function crearCorreo(deps: DepsCorreo): ServicioCorreo {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  let ultimo: ResultadoCorreo | null = null;

  function configurado(): { ok: boolean; falta: string | null } {
    const a = deps.ajustes();
    if (!deps.clave()) return { ok: false, falta: 'Falta la clave de Brevo: pégala en Que todo funcione → WhatsApp → Correo de aviso.' };
    if (!a.correoAviso) return { ok: false, falta: 'Falta el correo que recibe el aviso: escríbelo en Que todo funcione → WhatsApp → Correo de aviso.' };
    return { ok: true, falta: null };
  }

  async function enviar(asunto: string, texto: string): Promise<ResultadoCorreo> {
    const at = new Date().toISOString();
    const c = configurado();
    if (!c.ok) {
      ultimo = { ok: false, detalle: c.falta!, at };
      return ultimo;
    }
    const a = deps.ajustes();
    const remitente = a.remitente || a.correoAviso;
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    try {
      const res = await fetchImpl(URL_BREVO, {
        method: 'POST',
        headers: { 'api-key': deps.clave(), 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: remitente, name: a.nombreRemitente || 'GSGchat' },
          to: [{ email: a.correoAviso }],
          subject: asunto,
          textContent: texto,
        }),
        signal: controlador.signal,
      });
      if (res.ok) {
        ultimo = { ok: true, detalle: `Correo enviado a ${a.correoAviso}.`, at };
        return ultimo;
      }
      let cuerpo = '';
      try {
        const j = (await res.json()) as { message?: string; code?: string };
        cuerpo = j.message ?? j.code ?? '';
      } catch {
        cuerpo = '';
      }
      ultimo = { ok: false, detalle: explicarFalloBrevo(res.status, cuerpo), at };
      return ultimo;
    } catch (error) {
      const m = error instanceof Error ? error.message : String(error);
      ultimo = { ok: false, detalle: /abort/i.test(m) ? 'Brevo no contestó en 15 segundos: revisa la conexión a internet del servidor.' : `No se pudo llegar a Brevo: ${m}.`, at };
      return ultimo;
    } finally {
      clearTimeout(temporizador);
    }
  }

  return {
    configurado,
    enviar,
    probar: () =>
      enviar(
        'Prueba del correo de aviso de GSGchat',
        'Este es el correo que recibirás si el WhatsApp del sistema se cae y no puede avisar por sí mismo. Si lo lees, el correo de aviso está bien configurado.',
      ),
    ultimo: () => ultimo,
  };
}

/** Lo que Brevo contesta, contado para quien no sabe que es Brevo. */
export function explicarFalloBrevo(status: number, mensaje: string): string {
  if (status === 401 || status === 403) return 'Brevo rechazó la clave: revisa que sea una clave de API (SMTP & API → API keys) y que esté completa.';
  if (status === 400 && /sender/i.test(mensaje)) return 'Brevo no acepta el remitente: en Brevo hay que verificar ese correo (Senders & IP) o usar uno ya verificado.';
  if (status === 400) return `Brevo no aceptó el correo: ${mensaje || 'revisa el correo de destino'}.`;
  if (status === 402) return 'Brevo dice que se acabó el cupo de correos del plan: espera a mañana o amplía el plan.';
  if (status === 429) return 'Brevo pide esperar (demasiados correos seguidos): se reintenta en la próxima vuelta.';
  return `Brevo respondió ${status}${mensaje ? `: ${mensaje}` : ''}.`;
}
