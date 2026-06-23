import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

// Отдельный порт от dev-сервера (3000), чтобы E2E не цеплялся за уже
// запущенный `npm run dev` и не путал reuseExistingServer.
const PORT = 3100;
// Изолированные данные теста: НЕ трогаем рабочие data/game.db и data/media.
const E2E_DIR = resolve('tests', '.e2e');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Сначала собираем фронт (server.ts раздаёт /host, /admin и т.д. только
    // при наличии web/dist), затем поднимаем сервер на тестовых данных.
    command: 'npm run e2e:serve',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      DB_PATH: resolve(E2E_DIR, 'game.db'),
      MEDIA_DIR: resolve(E2E_DIR, 'media'),
      ADMIN_PASSWORD: 'test',
      COOKIE_SECRET: 'e2e-cookie-secret',
    },
  },
});
