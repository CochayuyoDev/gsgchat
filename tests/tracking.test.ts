import { describe, expect, it, vi } from 'vitest';
import { buildTrackingUrls, signTrackToken, verifyTrackToken } from '../src/tracking/tokens.js';
import { metersBetween, TrackingHub, type Socket } from '../src/tracking/realtime.js';
import { expiredPage, publisherPage, usesGoogleMaps, viewerPage } from '../src/tracking/page.js';
import { createFakeRepos } from './fakes.js';

const SECRET = 's'.repeat(40);
const future = () => Math.floor(Date.now() / 1000) + 3600;

describe('tokens de rastreo', () => {
  it('firma y verifica', () => {
    const token = signTrackToken({ linkId: 'l1', role: 'view', exp: future() }, SECRET);
    expect(verifyTrackToken(token, SECRET)).toMatchObject({ linkId: 'l1', role: 'view' });
  });

  it('rechaza firma con otro secreto', () => {
    const token = signTrackToken({ linkId: 'l1', role: 'view', exp: future() }, SECRET);
    expect(verifyTrackToken(token, 'otro'.repeat(10))).toBeNull();
  });

  it('rechaza un payload manipulado', () => {
    const token = signTrackToken({ linkId: 'l1', role: 'view', exp: future() }, SECRET);
    const forged = Buffer.from(JSON.stringify({ linkId: 'l1', role: 'publish', exp: future() })).toString(
      'base64url',
    );
    expect(verifyTrackToken(`${forged}.${token.split('.')[1]}`, SECRET)).toBeNull();
  });

  it('rechaza un token caducado', () => {
    const token = signTrackToken(
      { linkId: 'l1', role: 'view', exp: Math.floor(Date.now() / 1000) - 10 },
      SECRET,
    );
    expect(verifyTrackToken(token, SECRET)).toBeNull();
  });

  it('rechaza basura', () => {
    expect(verifyTrackToken('nada', SECRET)).toBeNull();
    expect(verifyTrackToken('a.b.c', SECRET)).toBeNull();
  });

  it('emite dos enlaces distintos por sesion', () => {
    const urls = buildTrackingUrls('l1', new Date(Date.now() + 3600_000), SECRET, 'https://x.test/');
    expect(urls.publishUrl).not.toBe(urls.viewUrl);
    expect(verifyTrackToken(urls.publishUrl.split('/t/')[1]!, SECRET)?.role).toBe('publish');
    expect(verifyTrackToken(urls.viewUrl.split('/t/')[1]!, SECRET)?.role).toBe('view');
  });
});

describe('hub de posiciones', () => {
  function socket(): Socket & { messages: string[] } {
    const messages: string[] = [];
    return { messages, send: (data: string) => messages.push(data) };
  }

  it('reparte la posicion a los espectadores', async () => {
    const repos = createFakeRepos();
    const hub = new TrackingHub({ tracking: repos.tracking });
    const viewer = socket();
    hub.addViewer('l1', viewer);

    await hub.publish('l1', { lat: 19.4326, lng: -99.1332 });

    expect(viewer.messages).toHaveLength(1);
    expect(JSON.parse(viewer.messages[0]!)).toMatchObject({ type: 'position', lat: 19.4326 });
  });

  it('no persiste puntos que no aportan, pero si los reparte', async () => {
    const repos = createFakeRepos();
    const now = vi.fn(() => new Date('2026-03-10T12:00:00Z'));
    const hub = new TrackingHub({ tracking: repos.tracking, now, minDistanceMeters: 15 });
    const viewer = socket();
    hub.addViewer('l1', viewer);

    await hub.publish('l1', { lat: 19.4326, lng: -99.1332 });
    await hub.publish('l1', { lat: 19.43261, lng: -99.13321 }); // ~1 m

    expect(repos._points.get('l1')).toHaveLength(1);
    expect(viewer.messages).toHaveLength(2);
  });

  it('persiste cuando el movimiento supera el umbral', async () => {
    const repos = createFakeRepos();
    const hub = new TrackingHub({
      tracking: repos.tracking,
      minDistanceMeters: 15,
      now: () => new Date('2026-03-10T12:00:00Z'),
    });

    await hub.publish('l1', { lat: 19.4326, lng: -99.1332 });
    await hub.publish('l1', { lat: 19.4336, lng: -99.1332 }); // ~111 m

    expect(repos._points.get('l1')).toHaveLength(2);
  });

  it('un espectador que se va deja de recibir', async () => {
    const repos = createFakeRepos();
    const hub = new TrackingHub({ tracking: repos.tracking });
    const viewer = socket();
    hub.addViewer('l1', viewer);
    hub.removeViewer('l1', viewer);

    await hub.publish('l1', { lat: 19.4326, lng: -99.1332 });
    expect(viewer.messages).toHaveLength(0);
  });

  it('cerrar la sesion avisa a los espectadores', () => {
    const repos = createFakeRepos();
    const hub = new TrackingHub({ tracking: repos.tracking });
    const viewer = socket();
    hub.addViewer('l1', viewer);

    hub.close('l1', 'fin del reparto');

    expect(JSON.parse(viewer.messages[0]!)).toMatchObject({ type: 'closed' });
    expect(hub.viewerCount('l1')).toBe(0);
  });

  it('calcula distancias razonables', () => {
    const d = metersBetween({ lat: 19.4326, lng: -99.1332 }, { lat: 19.4336, lng: -99.1332 });
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

describe('paginas de rastreo', () => {
  it('la del publicador pide geolocalizacion y la del espectador no', () => {
    const pub = publisherPage('tok', 'KEY', 'Reparto 12');
    const view = viewerPage('tok', 'KEY', 'Reparto 12');

    expect(pub).toContain('watchPosition');
    expect(view).not.toContain('watchPosition');
    expect(view).toContain('pushPath');
  });

  it('inyecta la clave de Maps escapada en la URL', () => {
    expect(publisherPage('tok', 'a b&c', 'x')).toContain('key=a%20b%26c');
  });

  it('con clave usa Google Maps', () => {
    const html = viewerPage('tok', 'KEY', 'x');
    expect(usesGoogleMaps('KEY')).toBe(true);
    expect(html).toContain('maps.googleapis.com');
    expect(html).toContain('new google.maps.Map');
    expect(html).not.toContain('leaflet');
  });

  // Sin clave, Google solo pinta un error gris: el respaldo permite ver el
  // mapa en desarrollo y en cualquier entorno sin credenciales.
  it('sin clave cae a Leaflet + OpenStreetMap', () => {
    const html = viewerPage('tok', '', 'x');
    expect(usesGoogleMaps('')).toBe(false);
    expect(html).not.toContain('maps.googleapis.com');
    expect(html).toContain('leaflet.min.js');
    expect(html).toContain('tile.openstreetmap.org');
    expect(html).toContain('colaboradores de OpenStreetMap');
  });

  it('los dos proveedores exponen el mismo adaptador', () => {
    for (const key of ['KEY', '']) {
      const html = viewerPage('tok', key, 'x');
      for (const method of ['init:', 'mark:', 'center:', 'panTo:', 'pushPath:']) {
        expect(html, `${key || 'sin clave'} / ${method}`).toContain(method);
      }
    }
  });

  it('el token viaja como literal JSON, no interpolado en crudo', () => {
    const html = viewerPage('tok"</script>', 'KEY', 'x');
    expect(html).not.toContain('var TOKEN = "tok"</script>');
  });

  it('la pagina de caducado no carga Maps', () => {
    expect(expiredPage()).not.toContain('maps.googleapis.com');
  });
});
