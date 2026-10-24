import { createSender } from '../src/outbound/sender.js';
import { POLITICA_CLOUD } from '../src/salud/politica.js';
import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, PIN_LIMA } from './escenario-entregas.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';
import { enviarConfirmacionUbicacion } from '../src/entregas/confirmacion-ubicacion.js';
import { createFakeRepos, createFakeWhatsApp } from './fakes.js';
import type { Sender } from '../src/outbound/sender.js';
const tel='987601777';
const pedido={...OBLIGATORIOS_GSG,tracking:'ACUSE-1',cliente:'Cliente de prueba',telefono:tel};

describe('confirmación real de ubicación',()=>{
  it('manda una burbuja después de tres intentos y su nota dice enviada solo con aceptación real',async()=>{
    const e=await crearEscenarioEntregas({agente:true});
    try {
      await e.api.post('/api/v1/entregas',pedido);await e.trabajar();
      const s=e.repos.rutas._solicitudes[0]!;
      // Tres intentos y todavia dentro de su plazo: pasado el plazo ya no se atiende (regla del dueño, 20/10).
      await e.repos.rutas.actualizarSolicitud(s.id,{estado:'enviado',intentos:3,proximoIntentoAt:new Date(e.ahora().getTime()+20*60_000)});
      const antes=e.mensajesA(tel).length;
      await e.contesta(tel,{pin:PIN_LIMA});
      expect(e.mensajesA(tel)).toHaveLength(antes+1);
      const c=(await e.repos.contacts.getByPhone('51'+tel))!;
      expect(c.iaCerradaMotivo).toMatch(/^ubicación registrada/);
      expect(e.repos.decisiones._todas).toHaveLength(0);
      expect(e.mensajesA(tel).at(-1)?.body).toMatch(/ubicación/i);
      await e.contesta(tel,{pin:PIN_LIMA});
      expect(e.mensajesA(tel)).toHaveLength(antes+1);
      expect(e.repos.decisiones._todas).toHaveLength(0);
    } finally {await e.cerrar();}
  });
  it('un rechazo de WhatsApp no cierra el chat ni afirma que salió; un pin posterior permite volver a confirmar',async()=>{
    const e=await crearEscenarioEntregas({agente:true});
    try {
      await e.api.post('/api/v1/entregas',pedido);await e.trabajar();
      e.wa.failNext=new WhatsAppApiError('rechazo del proveedor',400,131008,undefined,false);
      const antes=e.mensajesA(tel).length;
      await e.contesta(tel,{pin:PIN_LIMA});
      expect(e.mensajesA(tel)).toHaveLength(antes);
      const c=(await e.repos.contacts.getByPhone('51'+tel))!;
      expect(c.iaCerradaAt).toBeFalsy();
      expect(e.repos.decisiones._todas).toHaveLength(0);
      expect((await e.entrega('ACUSE-1'))?.ubicacionEstado).toBe('recibida');
      await e.contesta(tel,{pin:PIN_LIMA});
      expect(e.mensajesA(tel)).toHaveLength(antes+1);
      expect(e.repos.decisiones._todas).toHaveLength(0);
    } finally {await e.cerrar();}
  });
  it('reintenta una vez un fallo temporal explícito y no duplica la confirmación',async()=>{
    const e=await crearEscenarioEntregas({agente:true});
    try {
      await e.api.post('/api/v1/entregas',pedido);await e.trabajar();
      e.wa.failNext=new WhatsAppApiError('temporal',503,131000,undefined,true);
      const antes=e.mensajesA(tel).length;
      await e.contesta(tel,{pin:PIN_LIMA});
      expect(e.mensajesA(tel)).toHaveLength(antes+1);
      expect(e.repos.decisiones._todas).toHaveLength(0);
    } finally {await e.cerrar();}
  });
  it('el acuse dentro de la ventana no lo bloquean el cupo por contacto ni la separación de recordatorios',async()=>{
    const repos=createFakeRepos();const wa=createFakeWhatsApp();const c=await repos.contacts.upsertFromInbound('51987601777');
    const ahora=new Date();await repos.contacts.touchInbound(c.phone,ahora);
    const sender=createSender({repos,wa,phoneNumberId:'PNID',warmup:{startPerDay:50,growth:1.5,hardCap:1000},maxMarketingPerContact7d:2,
      now:()=>ahora,politica:()=>({...POLITICA_CLOUD,maxPorContactoDia:0,separacionContactoMs:60*60_000})});
    const r=await enviarConfirmacionUbicacion({repos,sender,contact:c,ahora,job:{phone:c.phone,kind:'freeform',category:'UTILITY',text:'Ubicación registrada'}});
    expect(r.enviada).toBe(true);expect(wa.sent).toHaveLength(1);
    expect((await repos.messages.listMessages(c.id,10))[0]?.payload).toMatchObject({confirmacionUbicacion:true});
  });
  it('un cierre antiguo sin salida real no impide confirmar el pin',async()=>{
    const e=await crearEscenarioEntregas({agente:true});
    try {
      await e.api.post('/api/v1/entregas',pedido);await e.trabajar();
      const c=(await e.repos.contacts.getByPhone('51'+tel))!;
      await e.repos.contacts.cerrarIA(c.id,true,e.ahora(),'ubicación registrada');
      const antes=e.mensajesA(tel).length;
      await e.contesta(tel,{pin:PIN_LIMA});
      expect(e.mensajesA(tel)).toHaveLength(antes+1);
      expect(e.repos.decisiones._todas).toHaveLength(0);
    } finally {await e.cerrar();}
  });
  it('la confirmación persistida no se duplica al cruzar medianoche UTC dentro del mismo día de Lima',async()=>{
    const repos=createFakeRepos();const wa=createFakeWhatsApp();const c=await repos.contacts.upsertFromInbound('51987601777');
    let ahora=new Date('2026-10-14T23:59:00Z');await repos.contacts.touchInbound(c.phone,ahora);
    const sender=createSender({repos,wa,phoneNumberId:'PNID',warmup:{startPerDay:50,growth:1.5,hardCap:1000},maxMarketingPerContact7d:2,now:()=>ahora});
    const job={phone:c.phone,kind:'freeform' as const,category:'UTILITY' as const,text:'Ubicación registrada'};
    expect((await enviarConfirmacionUbicacion({repos,sender,contact:c,ahora,job})).enviada).toBe(true);
    ahora=new Date('2026-10-15T00:01:00Z');
    const r=await enviarConfirmacionUbicacion({repos,sender,contact:c,ahora,job});
    expect(r.repetida).toBe(true);expect(r.enviada).toBe(false);expect(wa.sent).toHaveLength(1);
  });
  it.each([
    {ok:false,blocked:true,code:'contact_daily_cap',reason:'tope',deliveryId:1},
    {ok:false,blocked:false,error:'resultado incierto',retryable:true,incierto:true,deliveryId:1},
    {ok:true,wamid:'silencio:omitido',deliveryId:-1},
  ])('una guarda, un resultado incierto o un silencio no son un envío real',async salida=>{
    const repos=createFakeRepos();const c=await repos.contacts.upsertFromInbound('51987601777');let n=0;
    const r=await enviarConfirmacionUbicacion({repos,contact:c,sender:{async send(){n++;return salida as any;}} as Sender,job:{phone:c.phone,kind:'freeform',category:'UTILITY',text:'Ubicación registrada'}});
    expect(r.enviada).toBe(false);expect(n).toBe(1);expect(r.nota).not.toMatch(/^UBI REGISTRADA enviada:/);
  });
});
