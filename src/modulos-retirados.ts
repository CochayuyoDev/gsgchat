/** Módulos retirados de la aplicación. También protege enlaces antiguos y llamadas internas de IA. */
const RAICES = [
  '/procesos', '/personas', '/respuestas', '/pagar', '/conectores', '/embed', '/widget', '/visitantes',
  '/tracking', '/track', '/desarrollador', '/simulador', '/motorizados', '/motorizado',
  '/admin/envio-automatico', '/admin/procesos', '/admin/grupos', '/admin/campaigns', '/admin/tracking', '/admin/conectores',
  '/admin/stoky', '/admin/embed', '/admin/web-visitantes', '/admin/membresia', '/admin/plan', '/admin/tiendas',
  '/admin/desarrollador', '/admin/entregas/motorizados', '/admin/entregas/simulador',
  '/admin/fiabilidad/vigilante/simular', '/api/v1/procesos', '/api/v1/embed', '/api/v1/stoky', '/api/v1/conectores', '/api/plan',
];

export function moduloRetirado(url: string): boolean {
  const ruta = url.split('?')[0] ?? '/';
  return RAICES.some((p) => ruta === p || ruta.startsWith(p + '/')) || /^\/(?:embed|widget)\.(?:js|css)$/.test(ruta);
}
