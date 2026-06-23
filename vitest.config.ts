import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // E2E-спеки Playwright живут в tests/e2e и запускаются через `npm run test:e2e`.
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
