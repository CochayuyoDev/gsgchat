import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG } from './escenario-entregas.js';
const tel='987601888';
const pedido=(tracking:string)=>({...OBLIGATORIOS_GSG,tracking,cliente:'Cliente de prueba',telefono:tel});
describe('pedido nuevo con una solicitud en otro lote',()=>{
  it.each(['pausado','terminado'] as const)('un lote anterior %s no retiene ni cancela el tracking nuevo',async estado=>{
    const e=await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas',pedido('ANTERIOR'));
      const antigua=e.repos.rutas._solicitudes[0]!;
      await e.repos.rutas.cambiarEstadoLote(antigua.loteId,estado);
      await e.api.post('/api/v1/entregas',pedido('NUEVO'));
      const nuevo=(await e.entrega('NUEVO'))!;
      expect(nuevo.loteId).not.toBe(antigua.loteId);
      const s=e.repos.rutas._solicitudes.find(x=>x.referencia==='NUEVO')!;
      expect(s.estado).toBe('pendiente');expect(s.incidencia).toBeNull();
      await e.trabajar();
      expect(e.textosA(tel).some(t=>t.includes('NUEVO'))).toBe(true);
      expect((await e.entrega('NUEVO'))!.mensajeEstado).toBe('enviado');
    } finally {await e.cerrar();}
  });
  it.each(['incidencia','cancelado'] as const)('recupera un tracking que quedó %s por otro lote en una versión anterior',async estado=>{
    const e=await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas',pedido('ANTERIOR'));
      const antigua=e.repos.rutas._solicitudes[0]!;
      await e.repos.rutas.cambiarEstadoLote(antigua.loteId,'pausado');
      await e.api.post('/api/v1/entregas',pedido('RECUPERAR'));
      const bloqueada=e.repos.rutas._solicitudes.find(x=>x.referencia==='RECUPERAR')!;
      await e.repos.rutas.actualizarSolicitud(bloqueada.id,{estado,incidencia:'ya_en_curso',requiereHumano:true});
      await e.trabajar();
      expect(e.textosA(tel).some(t=>t.includes('RECUPERAR'))).toBe(true);
      expect((await e.entrega('RECUPERAR'))!.mensajeEstado).toBe('enviado');
      expect((await e.repos.rutas.lote(antigua.loteId))!.estado).toBe('pausado');
    } finally {await e.cerrar();}
  });
  it('un pedido de otro día no reutiliza el lote antiguo ni queda esperando en él',async()=>{
    const e=await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas',pedido('AYER'));
      const antigua=e.repos.rutas._solicitudes[0]!;
      e.avanzar(24*60);
      await e.api.post('/api/v1/entregas',pedido('HOY'));
      expect((await e.entrega('HOY'))!.loteId).not.toBe(antigua.loteId);
      await e.trabajar();
      expect(e.textosA(tel).some(t=>t.includes('HOY'))).toBe(true);
      expect((await e.entrega('HOY'))!.mensajeEstado).toBe('enviado');
    } finally {await e.cerrar();}
  });
});
