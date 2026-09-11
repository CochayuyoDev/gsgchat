/**
 * HTML de las paginas de rastreo.
 *
 * Se sirven como strings en vez de ficheros estaticos porque cada una lleva
 * dentro su token y la clave de Maps: no hay nada que cachear ni que servir
 * a quien no traiga un token valido.
 *
 * El mapa se pinta detras de un adaptador (`MapAdapter`) con dos
 * implementaciones: Google Maps cuando hay clave, y Leaflet + OpenStreetMap
 * cuando no la hay. Sin ese respaldo, un entorno sin clave solo ve el error
 * gris de Google y no se puede probar nada.
 *
 * Nota: el JS de estas paginas usa concatenacion en vez de plantillas para
 * no pelearse con los backticks del literal que las envuelve.
 */

const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const LEAFLET_VERSION = '1.9.4';
const LEAFLET_BASE = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}`;

export function usesGoogleMaps(apiKey: string): boolean {
  return apiKey.trim().length > 0;
}

const SHARED_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  #map { position: absolute; inset: 0; background: #e8eaed; }
  .panel {
    position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 500;
    background: rgba(255,255,255,.96); border-radius: 14px; padding: 14px 16px;
    box-shadow: 0 6px 24px rgba(0,0,0,.18); max-width: 460px; margin: 0 auto;
  }
  @media (prefers-color-scheme: dark) {
    .panel { background: rgba(28,28,30,.96); color: #f2f2f7; }
  }
  .row { display: flex; align-items: center; gap: 10px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #8e8e93; flex: none; }
  .dot.on { background: #34c759; }
  .dot.off { background: #ff3b30; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .muted { color: #8e8e93; font-size: 13px; margin: 0; }
  button {
    margin-top: 12px; width: 100%; padding: 12px; font-size: 15px; font-weight: 600;
    border: 0; border-radius: 10px; background: #ff3b30; color: #fff; cursor: pointer;
  }
  button:disabled { background: #c7c7cc; cursor: default; }
`;

/** Adaptador sobre Google Maps. */
const GOOGLE_ADAPTER = `
window.MapAdapter = {
  init: function (id, lat, lng, zoom) {
    this.map = new google.maps.Map(document.getElementById(id), {
      center: { lat: lat, lng: lng }, zoom: zoom,
      disableDefaultUI: true, zoomControl: true
    });
    this.path = new google.maps.Polyline({
      map: this.map, strokeColor: '#007aff', strokeWeight: 4, strokeOpacity: .85
    });
  },
  mark: function (lat, lng, title) {
    var point = { lat: lat, lng: lng };
    if (!this.marker) this.marker = new google.maps.Marker({ map: this.map, position: point, title: title });
    else this.marker.setPosition(point);
  },
  center: function (lat, lng, zoom) {
    this.map.setCenter({ lat: lat, lng: lng });
    if (zoom) this.map.setZoom(zoom);
  },
  panTo: function (lat, lng) { this.map.panTo({ lat: lat, lng: lng }); },
  pushPath: function (lat, lng) { this.path.getPath().push(new google.maps.LatLng(lat, lng)); }
};
`;

/** Adaptador sobre Leaflet + OpenStreetMap: no necesita clave. */
const LEAFLET_ADAPTER = `
window.MapAdapter = {
  init: function (id, lat, lng, zoom) {
    this.map = L.map(id, { zoomControl: true, attributionControl: true }).setView([lat, lng], zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; colaboradores de OpenStreetMap'
    }).addTo(this.map);
    this.path = L.polyline([], { color: '#007aff', weight: 4, opacity: .85 }).addTo(this.map);
  },
  mark: function (lat, lng, title) {
    if (!this.marker) this.marker = L.marker([lat, lng], { title: title }).addTo(this.map);
    else this.marker.setLatLng([lat, lng]);
  },
  center: function (lat, lng, zoom) { this.map.setView([lat, lng], zoom || this.map.getZoom()); },
  panTo: function (lat, lng) { this.map.panTo([lat, lng]); },
  pushPath: function (lat, lng) { this.path.addLatLng([lat, lng]); }
};
`;

function shell(title: string, apiKey: string, body: string, script: string): string {
  const google = usesGoogleMaps(apiKey);

  const head = google
    ? ''
    : `<link rel="stylesheet" href="${LEAFLET_BASE}/leaflet.min.css">`;

  // Google llama a initMap por su parametro `callback`; con Leaflet hay que
  // dispararlo a mano cuando la libreria termina de cargar.
  const loader = google
    ? `<script async defer src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=initMap"></script>`
    : `<script src="${LEAFLET_BASE}/leaflet.min.js" onload="initMap()"></script>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
${head}
<style>${SHARED_CSS}</style>
</head>
<body>
${body}
<script>
${google ? GOOGLE_ADAPTER : LEAFLET_ADAPTER}
${script}
</script>
${loader}
</body>
</html>`;
}

const WS_URL_JS = `
  function wsUrl(token, role) {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws/track/' + encodeURIComponent(token) + '?role=' + role;
  }
`;

/** Pagina de quien comparte su posicion. */
export function publisherPage(token: string, apiKey: string, label: string): string {
  const body = `
<div id="map"></div>
<div class="panel">
  <div class="row">
    <span class="dot" id="dot"></span>
    <div>
      <h1>Compartiendo ubicacion</h1>
      <p class="muted" id="status">Pidiendo permiso de ubicacion...</p>
    </div>
  </div>
  <p class="muted" id="detail" style="margin-top:8px"></p>
  <button id="stop">Dejar de compartir</button>
</div>`;

  const script = `
var TOKEN = ${JSON.stringify(token)};
var LABEL = ${JSON.stringify(label)};
${WS_URL_JS}
var ws, watchId, sent = 0, closed = false;

function setStatus(text, state) {
  document.getElementById('status').textContent = text;
  document.getElementById('dot').className = 'dot' + (state ? ' ' + state : '');
}

function connect() {
  if (closed) return;
  ws = new WebSocket(wsUrl(TOKEN, 'publish'));
  ws.onopen = function () { setStatus('Conectado. ' + LABEL, 'on'); };
  ws.onclose = function () {
    if (closed) return;
    setStatus('Reconectando...', 'off');
    setTimeout(connect, 2000);
  };
}

function onPosition(pos) {
  var c = pos.coords;
  MapAdapter.mark(c.latitude, c.longitude, LABEL);
  MapAdapter.center(c.latitude, c.longitude);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'position', lat: c.latitude, lng: c.longitude,
      accuracy: c.accuracy, heading: c.heading, speed: c.speed
    }));
    sent++;
    document.getElementById('detail').textContent =
      'Precision ' + Math.round(c.accuracy) + ' m - ' + sent + ' actualizaciones enviadas';
  }
}

function onError(err) { setStatus('Sin ubicacion: ' + err.message, 'off'); }

function stop() {
  closed = true;
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ type: 'stop' })); ws.close(); }
  setStatus('Dejaste de compartir tu ubicacion.', 'off');
  document.getElementById('stop').disabled = true;
}

function initMap() {
  MapAdapter.init('map', -12.0464, -77.0428, 16);
  if (!navigator.geolocation) { onError({ message: 'el navegador no lo soporta' }); return; }
  connect();
  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true, maximumAge: 5000, timeout: 20000
  });
}

document.getElementById('stop').addEventListener('click', stop);
window.initMap = initMap;
`;

  return shell('Compartiendo ubicacion', apiKey, body, script);
}

/** Pagina de quien sigue la posicion. */
export function viewerPage(token: string, apiKey: string, label: string): string {
  const body = `
<div id="map"></div>
<div class="panel">
  <div class="row">
    <span class="dot" id="dot"></span>
    <div>
      <h1 id="title">Siguiendo ubicacion</h1>
      <p class="muted" id="status">Conectando...</p>
    </div>
  </div>
  <p class="muted" id="detail" style="margin-top:8px"></p>
</div>`;

  const script = `
var TOKEN = ${JSON.stringify(token)};
var LABEL = ${JSON.stringify(label)};
${WS_URL_JS}
var ws, lastAt = null, placed = false;

function setStatus(text, state) {
  document.getElementById('status').textContent = text;
  document.getElementById('dot').className = 'dot' + (state ? ' ' + state : '');
}

function tick() {
  if (!lastAt) return;
  var secs = Math.round((Date.now() - lastAt) / 1000);
  var text = secs < 60 ? 'hace ' + secs + ' s' : 'hace ' + Math.round(secs / 60) + ' min';
  document.getElementById('detail').textContent = 'Ultima posicion ' + text;
}

function draw(lat, lng) {
  MapAdapter.mark(lat, lng, LABEL);
  if (!placed) { MapAdapter.center(lat, lng, 16); placed = true; }
  else MapAdapter.panTo(lat, lng);
  MapAdapter.pushPath(lat, lng);
  lastAt = Date.now();
  tick();
}

function connect() {
  ws = new WebSocket(wsUrl(TOKEN, 'view'));
  ws.onopen = function () { setStatus('En vivo. ' + LABEL, 'on'); };
  ws.onmessage = function (event) {
    var msg = JSON.parse(event.data);
    if (msg.type === 'position') draw(msg.lat, msg.lng);
    else if (msg.type === 'history' && msg.points) {
      msg.points.forEach(function (p) { draw(p.lat, p.lng); });
    } else if (msg.type === 'closed') {
      setStatus('La sesion termino: ' + (msg.reason || ''), 'off');
      ws.onclose = null;
      ws.close();
    }
  };
  ws.onclose = function () { setStatus('Reconectando...', 'off'); setTimeout(connect, 2000); };
}

function initMap() {
  MapAdapter.init('map', -12.0464, -77.0428, 12);
  document.getElementById('title').textContent = LABEL || 'Siguiendo ubicacion';
  connect();
  setInterval(tick, 5000);
}

window.initMap = initMap;
`;

  return shell(label || 'Siguiendo ubicacion', apiKey, body, script);
}

/** Pagina para token caducado, revocado o invalido. */
export function expiredPage(): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Enlace no disponible</title>
<style>${SHARED_CSS}
  body { display: grid; place-items: center; min-height: 100vh; padding: 24px; text-align: center; }
</style></head>
<body><div>
  <h1>Este enlace ya no esta disponible</h1>
  <p class="muted">La sesion de rastreo caduco o fue revocada. Pide una nueva al remitente.</p>
</div></body></html>`;
}
