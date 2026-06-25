import { test, expect, type Page } from '@playwright/test';

// Повторяет паттерн login из constructor-fixes.spec.ts: тот же селектор,
// тот же пароль 'test' (ADMIN_PASSWORD из playwright.config.ts).
async function login(page: Page) {
  await page.goto('/admin');
  await page.locator('input[type=password]').fill('test');
  await page.getByRole('button', { name: 'Войти' }).click();
  // После логина видна кнопка-таб «Конструктор» (не heading).
  await expect(page.getByRole('button', { name: 'Конструктор' })).toBeVisible();
}

test('экспорт шаблона отдаёт .game.json', async ({ page }) => {
  await login(page);
  // Переходим в Конструктор, создаём 5×5 — как в smoke.spec.ts.
  await page.getByRole('button', { name: 'Конструктор' }).click();
  await page.getByRole('button', { name: 'Новая 5×5' }).click();

  // Ждём, пока GameEditor загрузит шаблон (docVal != null → кнопка включается).
  const downloadBtn = page.getByRole('button', { name: 'Скачать шаблон' });
  await expect(downloadBtn).toBeEnabled();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.game\.json$/);
});

test('импорт файла поднимает игру и открывает редактор', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Конструктор' }).click();
  await page.getByRole('button', { name: 'Новая 5×5' }).click();

  // Ждём готовности редактора.
  const downloadBtn = page.getByRole('button', { name: 'Скачать шаблон' });
  await expect(downloadBtn).toBeEnabled();

  // Скачиваем шаблон для round-trip.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadBtn.click(),
  ]);
  const filePath = await download.path();

  // Возвращаемся в список игр.
  await page.getByRole('button', { name: '← Список игр' }).click();

  // Ждём, пока список отрисуется (кнопка «Импортировать шаблон» видна).
  await expect(page.getByRole('button', { name: 'Импортировать шаблон' })).toBeVisible();

  // Импорт: «Импортировать шаблон» нажимает fileInput.click() программно.
  // Для Playwright нельзя setInputFiles на <button> — идём напрямую на hidden input.
  await page.locator('input[type=file]').setInputFiles(filePath!);

  // После импорта Builder открывает GameEditor для нового шаблона.
  // Ждём, пока редактор загрузится (кнопка «Скачать шаблон» включается).
  await expect(page.getByRole('button', { name: 'Скачать шаблон' })).toBeEnabled();
});
