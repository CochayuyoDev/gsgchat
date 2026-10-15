import { describe, expect, it, vi } from 'vitest';
import { connectPage } from '../src/web/connect-page.js';

function control(proveedor: 'local' | 'waha', confirmar: boolean, fallo = false) {
  const pagina = connectPage({ labels: {}, nombreNegocio: 'Prueba' });
  const desde = pagina.indexOf("$('desconectar').onclick = async function () {");
  const hasta = pagina.indexOf('\n};', desde) + 3;
  const boton = { disabled: false, onclick: null as unknown as () => Promise<void> };
  const qr = { conectado: true, parado: false };
  const api = vi.fn(async () => { if (fallo) throw new Error('No se pudo desvincular'); return { ok: true }; });
  const estado = vi.fn(), cargar = vi.fn(async () => undefined), pintarQr = vi.fn();
  new Function('$', 'confirmarDialogo', 'api', 'prefijo', 'qr', 'pintarQr', 'estado', 'cargar', 'MODOS', 'modo', pagina.slice(desde, hasta))(
    () => boton, async () => confirmar, api, () => '/admin/' + proveedor, qr, pintarQr, estado, cargar, { [proveedor]: { boton: 'Conectar' } }, proveedor,
  );
  return { boton, qr, api, estado, cargar, pintarQr, pagina };
}

describe('desvincular WhatsApp desde su tarjeta principal', () => {
  it.each(['local', 'waha'] as const)('desvincula %s y muestra que hace falta un QR nuevo', async (proveedor) => {
    const c = control(proveedor, true);
    const tarjeta = c.pagina.slice(c.pagina.indexOf('id="card-wa"'), c.pagina.indexOf('id="con-avanzado"'));
    expect(tarjeta).toContain('Desvincular cuenta');
    expect(c.pagina.match(/id="desconectar"/g)).toHaveLength(1);
    await c.boton.onclick();
    expect(c.api).toHaveBeenCalledWith('/admin/' + proveedor + '/logout', { method: 'POST', body: {} });
    expect(c.qr).toEqual({ conectado: false, parado: true });
    expect(c.pintarQr).toHaveBeenCalledWith('');
    expect(c.estado).toHaveBeenCalledWith('fb-state', expect.stringContaining('QR nuevo'), 'ambar');
    expect(c.cargar).toHaveBeenCalledOnce();
    expect(c.boton.disabled).toBe(false);
  });
  it('cancelar no desconecta y un fallo no afirma que la cuenta esté desvinculada', async () => {
    const cancelado = control('local', false);
    await cancelado.boton.onclick();
    expect(cancelado.api).not.toHaveBeenCalled();
    expect(cancelado.qr.conectado).toBe(true);
    const fallo = control('local', true, true);
    await fallo.boton.onclick();
    expect(fallo.qr.conectado).toBe(true);
    expect(fallo.estado).toHaveBeenCalledWith('fb-state', 'No se pudo desvincular', 'rojo');
    expect(fallo.boton.disabled).toBe(false);
  });
});
