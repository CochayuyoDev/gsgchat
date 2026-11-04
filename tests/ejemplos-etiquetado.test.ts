/**
 * «Enséñale a etiquetar» (src/chat/ejemplos-etiquetado.ts): las correcciones
 * del equipo se convierten en ejemplos, lo personal se tapa, los ejemplos
 * van en las instrucciones del clasificador cada vez que etiqueta, y las
 * rutas que usa Entrenamiento IA.
 */

import { describe, expect, it } from 'vitest';
import type { MensajeIA } from '../src/ia/proveedores.js';
import { CATALOGO_POR_DEFECTO, TOPE_EJEMPLOS_NEGOCIO } from '../src/archive/clasificar.js';
import { crearChatEtiquetasEnMemoria, type MensajeDelDia } from '../src/db/chat-etiquetas.js';
import { etiquetarAMano, etiquetarDelDia, type EtiquetadoDeps } from '../src/chat/etiquetar.js';
import { agregarEjemplo, correccionesRecientes, ejemplosParaIA, quitarEjemplo, textoDeConversacion } from '../src/chat/ejemplos-etiquetado.js';
import { crearEscenarioEntregas } from './escenario-entregas.js';
import { hashClave } from '../src/auth/usuarios.js';

const AHORA = new Date('2026-10-28T15:00:00Z');
const ALCANCE = { afterId: '0', retenidosDesde: new Date('2026-10-20T00:00:00Z') };
const msg = (id: number, phone: string, direction: 'in' | 'out', body: string | null, kind: MensajeDelDia['kind'] = 'text'): MensajeDelDia => ({
  id, contactId: `c-${phone}`, phone, name: 'Rosa', direction, kind, body, createdAt: new Date(AHORA.getTime() - (100 - id) * 60_000),
});

/** Una IA que contesta siempre lo mismo y guarda lo que le llegó. */
function ia(respuesta: string) {
  const sistemas: string[] = [];
  return { sistemas, ia: { async completar(m: MensajeIA[]) { sistemas.push(String(m[0]!.content)); return respuesta; } } };
}
const deps = (repo: ReturnType<typeof crearChatEtiquetasEnMemoria>, i: EtiquetadoDeps['ia']): EtiquetadoDeps => ({ repo, ia: i, zonaHoraria: () => 'America/Lima', nombreNegocio: () => 'GSG', ahora: () => AHORA });

describe('las correcciones del equipo se vuelven ejemplos', () => {
  it('corregir a mano la de la IA deja una corrección con la conversación (lo personal tapado), y se puede usar como ejemplo', async () => {
    const mensajes = [
      msg(1, '51911000001', 'out', '¿Nos manda su ubicación?'),
      msg(2, '51911000001', 'in', null, 'location'),
      msg(3, '51911000001', 'in', 'déjelo con la señora del puesto 14, mi cel es 987654321'),
    ];
    const repo = crearChatEtiquetasEnMemoria(() => mensajes);
    // La IA se equivoca: «ubicaciones_multiples».
    const lote = await etiquetarDelDia(deps(repo, () => ia('{"etiqueta":"ubicaciones_multiples"}').ia), ALCANCE);
    expect(lote.clasificadas).toBe(1);
    // Una persona la corrige.
    await etiquetarAMano(deps(repo, () => null), { phone: '51911000001', etiqueta: 'coordinar_con_tercero', quien: 'Ali' });

    const [c] = await correccionesRecientes(repo, CATALOGO_POR_DEFECTO);
    expect(c).toMatchObject({ phone: '51911000001', antes: 'ubicaciones_multiples', ahora: 'coordinar_con_tercero', ahoraNombre: 'Recibe otra persona' });
    expect(c!.texto).toContain('negocio: ¿Nos manda su ubicación?');
    expect(c!.texto).toContain('cliente: [ubicación]');
    expect(c!.texto).not.toContain('987654321');

    const r = await agregarEjemplo(repo, CATALOGO_POR_DEFECTO, { texto: c!.texto!, etiqueta: c!.ahora, fuente: c!.fuente, quien: 'Ali' });
    expect(r).toMatchObject({ ok: true, ejemplo: { origen: 'correccion', etiqueta: 'coordinar_con_tercero', creadoPor: 'Ali' } });
    // Ya no se ofrece, y la misma corrección no entra dos veces.
    expect(await correccionesRecientes(repo, CATALOGO_POR_DEFECTO)).toEqual([]);
    expect(await agregarEjemplo(repo, CATALOGO_POR_DEFECTO, { texto: c!.texto!, etiqueta: c!.ahora, fuente: c!.fuente })).toMatchObject({ ok: false, error: expect.stringMatching(/ya es un ejemplo/) });

    // El siguiente lote se lo pasa a la IA en sus instrucciones.
    mensajes.push(msg(4, '51911000002', 'in', 'hola'));
    const otra = ia('{"etiqueta":"otro"}');
    await etiquetarDelDia(deps(repo, () => otra.ia), ALCANCE);
    expect(otra.sistemas[0]).toContain('Ejemplos de este negocio');
    expect(otra.sistemas[0]).toMatch(/déjelo con la señora del puesto 14.* → coordinar_con_tercero/);
  });

  it('cambiar a mano una que ya era manual no es una corrección de la IA', async () => {
    const repo = crearChatEtiquetasEnMemoria(() => []);
    const d = deps(repo, () => null);
    await etiquetarAMano(d, { phone: '51911000003', etiqueta: 'reclamo' });
    await etiquetarAMano(d, { phone: '51911000003', etiqueta: 'reagendar_entrega' });
    expect(await correccionesRecientes(repo, CATALOGO_POR_DEFECTO)).toEqual([]);
  });
});

describe('los ejemplos', () => {
  it('se validan, tapan lo personal, tienen tope y se quitan', async () => {
    const repo = crearChatEtiquetasEnMemoria(() => []);
    expect(await agregarEjemplo(repo, CATALOGO_POR_DEFECTO, { texto: 'cliente: hola', etiqueta: 'inventada' })).toMatchObject({ ok: false, error: expect.stringMatching(/catálogo/) });
    expect(await agregarEjemplo(repo, CATALOGO_POR_DEFECTO, { texto: 'negocio: ¿su ubicación?', etiqueta: 'otro' })).toMatchObject({ ok: false, error: expect.stringMatching(/cliente/) });
    const bien = await agregarEjemplo(repo, CATALOGO_POR_DEFECTO, { texto: 'cliente: llámenme al 987654321, mi correo es ana@correo.pe\ncliente: mañana mejor', etiqueta: 'reagendar_entrega' });
    expect(bien.ok).toBe(true);
    const guardado = (await repo.ejemplos())[0]!;
    expect(guardado.texto).not.toMatch(/987654321|ana@correo\.pe/);
    expect(guardado.origen).toBe('manual');

    for (let i = 1; i < TOPE_EJEMPLOS_NEGOCIO; i++) expect((await agregarEjemplo(repo, CATALOGO_POR_DEFECTO, { texto: `cliente: caso ${i}`, etiqueta: 'otro' })).ok).toBe(true);
    expect(await agregarEjemplo(repo, CATALOGO_POR_DEFECTO, { texto: 'cliente: uno más', etiqueta: 'otro' })).toMatchObject({ ok: false, error: expect.stringMatching(/máximo/) });
    expect(await quitarEjemplo(repo, guardado.id)).toBe(true);
    expect(await quitarEjemplo(repo, guardado.id)).toBe(false);
    expect(await repo.ejemplos()).toHaveLength(TOPE_EJEMPLOS_NEGOCIO - 1);
  });

  it('al clasificador solo van los de etiquetas que siguen en el catálogo', async () => {
    const repo = crearChatEtiquetasEnMemoria(() => []);
    await agregarEjemplo(repo, CATALOGO_POR_DEFECTO, { texto: 'cliente: mañana mejor', etiqueta: 'reagendar_entrega' });
    await agregarEjemplo(repo, CATALOGO_POR_DEFECTO, { texto: 'cliente: me cobraron doble', etiqueta: 'problema_de_pago' });
    const propio = [{ codigo: 'reagendar_entrega', nombre: 'Otro día', descripcion: 'pide otro día' }, { codigo: 'otro', nombre: 'Otro', descripcion: 'ninguna' }];
    const usados = await ejemplosParaIA(repo, propio);
    expect(usados.map((e) => e.etiqueta)).toEqual(['reagendar_entrega']);
    expect(usados[0]!.mensajes).toEqual([{ direction: 'in', kind: 'text', body: 'mañana mejor' }]);
  });

  it('la conversación de una corrección se escribe como un ejemplo', () => {
    expect(textoDeConversacion([
      { id: 1, direction: 'out', kind: 'text', body: 'Hola,\n¿su ubicación?', createdAt: '' },
      { id: 2, direction: 'in', kind: 'location', body: null, createdAt: '' },
      { id: 3, direction: 'in', kind: 'audio', body: null, createdAt: '' },
    ])).toBe('negocio: Hola, ¿su ubicación?\ncliente: [ubicación]\ncliente: [audio]');
  });
});

describe('las rutas de Entrenamiento IA', () => {
  it('enseñar, listar y quitar un ejemplo; las correcciones salen vacías sin cambios a mano', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.repos.usuarios.crear({ usuario: 'adminej', nombre: 'Ali', rol: 'admin', clave: hashClave('Clave-123-segura') });
      const login = await e.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'adminej', clave: 'Clave-123-segura' } });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const pedir = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
        payload === undefined ? e.app.inject({ method, url, headers: { cookie } }) : e.app.inject({ method, url, headers: { cookie }, payload });

      expect((await pedir('GET', '/admin/chat/etiquetas/ejemplos')).json()).toMatchObject({ items: [], tope: TOPE_EJEMPLOS_NEGOCIO });
      const mal = await pedir('POST', '/admin/chat/etiquetas/ejemplos', { texto: 'negocio: hola', etiqueta: 'otro' });
      expect(mal.statusCode).toBe(400);
      const ok = await pedir('POST', '/admin/chat/etiquetas/ejemplos', { texto: 'cliente: que lo reciba mi vecina', etiqueta: 'coordinar_con_tercero' });
      expect(ok.statusCode).toBe(200);
      const lista = (await pedir('GET', '/admin/chat/etiquetas/ejemplos')).json();
      expect(lista.items).toEqual([expect.objectContaining({ etiqueta: 'coordinar_con_tercero', nombreEtiqueta: 'Recibe otra persona', enCatalogo: true, creadoPor: 'Ali' })]);
      expect((await pedir('GET', '/admin/chat/etiquetas/correcciones')).json()).toEqual({ items: [] });
      expect((await pedir('DELETE', `/admin/chat/etiquetas/ejemplos/${lista.items[0].id}`)).statusCode).toBe(200);
      expect((await pedir('DELETE', `/admin/chat/etiquetas/ejemplos/${lista.items[0].id}`)).statusCode).toBe(404);
    } finally {
      await e.cerrar();
    }
  });
});
