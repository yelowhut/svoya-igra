import { test, expect } from '@playwright/test';

// Дымовой тест: проверяем, что Svelte реально смонтировался (не пустой
// <div id="app">), а сервер раздаёт собранный фронт.
test('страница ведущего загружается и монтирует UI', async ({ page }) => {
  await page.goto('/');

  // Заголовок шага «setup» рендерится JS-ом после монтирования Svelte.
  await expect(page.getByRole('heading', { name: 'Создать игру' })).toBeVisible();

  await page.screenshot({ path: 'test-results/host-landing.png', fullPage: true });
});

test('роут /admin отдаёт админку', async ({ page }) => {
  await page.goto('/admin');
  // Без пароля админка показывает форму входа.
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
});

// Конструктор (стадия 2b): вход → вкладка «Конструктор» → создать 5×5 →
// сетка раунда с 5 столбцами-ценами рендерится.
test('конструктор создаёт игру 5×5 и рисует сетку цен', async ({ page }) => {
  await page.goto('/admin');
  await page.locator('input[type=password]').fill('test');
  await page.getByRole('button', { name: 'Войти' }).click();

  await page.getByRole('button', { name: 'Конструктор' }).click();
  await page.getByRole('button', { name: 'Новая 5×5' }).click();

  // В редакторе раунда — 5 золотых числовых полей цены (input.price).
  await expect(page.locator('input.price')).toHaveCount(5);
  await expect(page.locator('input.price').first()).toHaveValue('100');

  await page.screenshot({ path: 'test-results/builder-grid.png', fullPage: true });
});
