import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    /**
     * Arrancar Postgres embebido (PGlite) tarda.
     *
     * Varios ficheros levantan uno en su `beforeAll`, y con la máquina cargada
     * —o con el asistente corriendo al lado— pasan de los 10 s de fábrica: el
     * fichero entero se salta con "Hook timed out" y parece un fallo del
     * código cuando suelto pasa en dos segundos.
     */
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
