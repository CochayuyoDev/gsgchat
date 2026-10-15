import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, PIN_LIMA } from './escenario-entregas.js';
import { ajustesPorDefecto } from '../src/rutas/ajustes.js';
import { OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';

const tel = '987603777';
const pedido = { ...OBLIGATORIOS_GSG, tracking: 'SILENCIO-1', cliente: 'Cliente de prueba', telefono: tel };

describe('solo la ubicación recibe respuesta mientras se espera el pin', () => {
  it('un número equivocado se reporta a GSG sin enviar ninguna respuesta al cliente', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      const antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'No soy yo, número equivocado' });
      await e.contesta(tel, { texto: 'hola' });
      e.avanzar(60);
      await e.trabajar();
      expect(e.mensajesA(tel)).toHaveLength(antes);
      expect(e.repos.rutas._solicitudes[0]?.incidencia).toBe('numero_equivocado');
      expect(e.repos.decisiones._todas).toHaveLength(0);
    } finally { await e.cerrar(); }
  });
  it.each([true, false])('ignora todo texto y respeta 15 minutos y el tope (agente: %s)', async (agente) => {
    const e = await crearEscenarioEntregas({ agente, arranque: new Date('2026-10-14T15:00:00Z') });
    try {
      await e.repos.rutas.ajustes.set({ esperaRespuestaMinutos: 15, maxIntentos: 3 }, ajustesPorDefecto(OPCIONES_POR_DEFECTO));
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      const s = e.repos.rutas._solicitudes[0]!;
      const siguiente = s.proximoIntentoAt!.getTime();
      const inicial = e.mensajesA(tel).length;
      expect(inicial).toBe(1);
      e.avanzar(1);
      for (const texto of ['Hola', 'Está bien enviaré mi ubicación', 'Pero a qué hora llegan Masomenos ?', '¿Por qué necesitan mi ubicación? ¿A qué hora llegan?', '¿quién eres?', 'quiero hablar con un asesor', 'sí', 'Av. Prueba 123, Miraflores']) {
        await e.contesta(tel, { texto });
        await e.trabajar();
        expect(e.mensajesA(tel), texto).toHaveLength(inicial);
        expect(s.intentos, texto).toBe(1);
        expect(s.proximoIntentoAt!.getTime(), texto).toBe(siguiente);
        expect(s.requiereHumano, texto).toBeFalsy();
        expect(e.repos.decisiones._todas, texto).toHaveLength(0);
      }
      e.avanzar(13);
      await e.trabajar();
      expect(e.mensajesA(tel)).toHaveLength(1);
      e.avanzar(1);
      await e.trabajar();
      expect(e.mensajesA(tel)).toHaveLength(2);
      e.avanzar(15);
      await e.trabajar();
      expect(e.mensajesA(tel)).toHaveLength(3);
      e.avanzar(15);
      await e.trabajar();
      await e.contesta(tel, { texto: 'hola otra vez' });
      e.avanzar(60);
      await e.trabajar();
      expect(e.mensajesA(tel)).toHaveLength(3);
      expect(s.intentos).toBe(3);
      expect(e.ia.llamadas).toHaveLength(0);
    } finally { await e.cerrar(); }
  });

  it.each(['pin', 'mapa'] as const)('sigue registrando y confirmando la ubicación por %s', async (tipo) => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(tel, { texto: '¿A qué hora llega?' });
      const antes = e.mensajesA(tel).length;
      await e.contesta(tel, tipo === 'pin' ? { pin: PIN_LIMA } : { enlace: `https://www.google.com/maps?q=${PIN_LIMA.lat},${PIN_LIMA.lng}` });
      if (tipo === 'mapa') {
        expect(e.textosA(tel).at(-1)).toMatch(/ubicación de tu enlace/);
        const antesDeOtroTexto = e.mensajesA(tel).length;
        await e.contesta(tel, { texto: '¿a qué hora llegan?' });
        expect(e.mensajesA(tel)).toHaveLength(antesDeOtroTexto);
        await e.contesta(tel, { texto: 'sí' });
      }
      expect((await e.entrega('SILENCIO-1'))?.ubicacionEstado).toBe('recibida');
      expect(e.mensajesA(tel)).toHaveLength(antes + (tipo === 'mapa' ? 2 : 1));
      expect(e.repos.decisiones._todas).toHaveLength(0);
      e.avanzar(60);
      await e.trabajar();
      expect(e.mensajesA(tel)).toHaveLength(antes + (tipo === 'mapa' ? 2 : 1));
    } finally { await e.cerrar(); }
  });
});
