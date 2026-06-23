import { test, expect, type Page } from '@playwright/test';

// Проверка правок по разделу КОНСТРУКТОР и БАЗА ВОПРОСОВ.
// Данные банка и шаблона сидируем через API (после UI-логина cookie доступна
// в page.request), чтобы не зависеть от флейки drag&drop при назначении категории.

async function login(page: Page) {
  await page.goto('/admin');
  await page.locator('input[type=password]').fill('test');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Конструктор' })).toBeVisible();
}

async function seed(page: Page, catName: string, prompt: string) {
  const cat = await page.request.post('/api/bank/categories', { data: { name: catName } });
  const { id: categoryId } = await cat.json();
  const q = await page.request.post(`/api/bank/categories/${categoryId}/questions`, { data: {} });
  const { id: questionId } = await q.json();
  await page.request.put(`/api/bank/questions/${questionId}`, { data: { type: 'text', prompt, answer: 'ответ' } });

  const tpl = await page.request.post('/api/game-templates', { data: { template: '5x5' } });
  const { id: templateId } = await tpl.json();
  const docRes = await page.request.get(`/api/game-templates/${templateId}`);
  const doc = await docRes.json();
  doc.title = catName + ' игра';
  doc.rounds[0].rows[0].categoryId = categoryId; // назначаем категорию первой строке
  await page.request.put(`/api/game-templates/${templateId}`, { data: doc });
  return { categoryId, questionId, templateId, title: doc.title };
}

test('кнопки конструктора оформлены по дизайну (.primary/.ghost)', async ({ page }) => {
  await login(page);
  const { title } = await seed(page, 'Стиль-' + Date.now(), 'Вопрос стиля');
  await page.getByRole('button', { name: 'Конструктор' }).click();
  await page.getByRole('button', { name: title }).click();

  const publish = page.getByRole('button', { name: 'Опубликовать' });
  await expect(publish).toHaveCSS('background-color', 'rgb(124, 92, 255)'); // --accent
  const back = page.getByRole('button', { name: '← Список игр' });
  await expect(back).toHaveCSS('background-color', 'rgb(21, 19, 31)'); // --surface
  await page.screenshot({ path: 'test-results/fix-buttons.png', fullPage: true });
});

test('категория рендерится названием, а не UUID, после открытия редактора', async ({ page }) => {
  await login(page);
  const cat = 'НеЮУИД-' + Date.now();
  const { title } = await seed(page, cat, 'Вопрос про UUID');
  await page.getByRole('button', { name: 'Конструктор' }).click();
  await page.getByRole('button', { name: title }).click();

  const rowCat = page.locator('.grid .row:not(.header)').first().locator('.cat');
  await expect(rowCat).toContainText(cat);
  // Не должно быть похожего на UUID текста (8-4-4-4-12 hex).
  await expect(rowCat).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);
});

test('пикер вопросов: выбор по клику, пометка «занят», смена шестерёнкой', async ({ page }) => {
  await login(page);
  const cat = 'Пикер-' + Date.now();
  const prompt = 'Столица Франции?';
  const { title } = await seed(page, cat, prompt);
  await page.getByRole('button', { name: 'Конструктор' }).click();
  await page.getByRole('button', { name: title }).click();

  const row = page.locator('.grid .row:not(.header)').first();
  // Клик по первой пустой ячейке → модалка пикера с категорией и вопросом.
  await row.locator('.cell .empty').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Категория: ' + cat);
  await expect(dialog).toContainText(prompt);
  await page.screenshot({ path: 'test-results/fix-picker.png', fullPage: true });

  // Выбираем вопрос → ячейка заполняется, появляется шестерёнка.
  await dialog.getByText(prompt).click();
  await expect(dialog).toBeHidden();
  const firstCell = row.locator('.cell').first();
  await expect(firstCell.locator('.gear')).toBeVisible();
  await expect(firstCell).toContainText(prompt.slice(0, 10));

  // Во второй пустой ячейке тот же вопрос помечен «занят» и недоступен.
  await row.locator('.cell .empty').first().click();
  const usedRow = page.getByRole('dialog').locator('.row.used', { hasText: prompt });
  await expect(usedRow).toBeVisible();
  await expect(usedRow).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).click();

  // Шестерёнка открывает пикер с пометкой «текущий».
  await firstCell.locator('.gear').click();
  await expect(page.getByRole('dialog').locator('.badge.cur')).toHaveText('текущий');
});

test('удаление раунда — через модалку подтверждения', async ({ page }) => {
  await login(page);
  const { title } = await seed(page, 'Раунд-' + Date.now(), 'Вопрос раунда');
  await page.getByRole('button', { name: 'Конструктор' }).click();
  await page.getByRole('button', { name: title }).click();

  await expect(page.locator('.tabs .tab')).toHaveCount(1);
  await page.getByRole('button', { name: '+ Раунд' }).click();
  await expect(page.locator('.tabs .tab')).toHaveCount(2);

  await page.locator('.tabs .tab').first().locator('.tabdel').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Удалить раунд?');
  await dialog.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.locator('.tabs .tab')).toHaveCount(1);
});

test('база вопросов: удаление категории через модалку, а не браузерный confirm', async ({ page }) => {
  await login(page);
  const cat = 'Удалить-' + Date.now();
  await seed(page, cat, 'Вопрос на удаление');
  // Дефолтный роут /admin — это «База», и Base монтируется до сидирования.
  // Переключаемся через Конструктор, чтобы при возврате Base перемонтировался
  // и подтянул свежий список категорий.
  await page.getByRole('button', { name: 'Конструктор' }).click();
  await page.getByRole('button', { name: 'База вопросов' }).click();

  const catRow = page.locator('.pane li', { hasText: cat });
  await catRow.getByTitle('Удалить').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Удалить категорию?');
  await expect(dialog).toContainText(cat);
  await dialog.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.locator('.pane li', { hasText: cat })).toHaveCount(0);
});

test('база вопросов: удаление вопроса через модалку', async ({ page }) => {
  await login(page);
  const cat = 'УдВопр-' + Date.now();
  const prompt = 'Вопрос-кандидат на удаление';
  await seed(page, cat, prompt);
  await page.getByRole('button', { name: 'Конструктор' }).click();
  await page.getByRole('button', { name: 'База вопросов' }).click();

  await page.locator('.pane li', { hasText: cat }).first().click(); // выбрать категорию
  await page.locator('.pane li', { hasText: prompt }).getByTitle('Удалить').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Удалить вопрос?');
  await dialog.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.locator('.pane li', { hasText: prompt })).toHaveCount(0);
});

test('список игр: кнопки «Пустая игра» и «Новая 5×5» оформлены по дизайну', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Конструктор' }).click();
  await expect(page.getByRole('button', { name: 'Новая 5×5' })).toHaveCSS('background-color', 'rgb(124, 92, 255)');
  await expect(page.getByRole('button', { name: 'Пустая игра' })).toHaveCSS('background-color', 'rgb(21, 19, 31)');
  await page.screenshot({ path: 'test-results/fix-list-buttons.png', fullPage: true });
});
