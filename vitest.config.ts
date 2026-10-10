import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    /**
     * Arrancar Postgres embebido (PGlite) tarda.
     *
     * Varios ficheros levantan uno en su `beforeAll`, y con la mÃ¡quina cargada
     * â€”o con el asistente corriendo al ladoâ€” pasan de los 10 s de fÃ¡brica: el
     * fichero entero se salta con "Hook timed out" y parece un fallo del
     * cÃ³digo cuando suelto pasa en dos segundos.
     */
    hookTimeout: 900_000,
    testTimeout: 30_000,
  },
});
