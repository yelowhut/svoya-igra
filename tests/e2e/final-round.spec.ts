import { test, expect, type Page } from '@playwright/test';

// E2E round-trip для финального раунда.
//
// Сокращённый сценарий (см. комментарий ниже):
//   API-seed шаблона (1 обычный раунд + финал с 2 темами)
//   → публикация → создание игры → старт раунда 1 → конец раунда
//   → «Начать финал» → проверяем FINAL_INTRO на pult и board.
//
// Полный round-trip (вычёркивание → ставки → ответы → вскрытие → GAME_END)
// НЕ реализован здесь, т.к. требует настоящих socket-клиентов с заходом
// игроков в роли «player» и синхронного ожидания событий финала.
// Эти механики покрыты unit-тестами reducer.final.test.ts и gateway.test.ts.

async function login(page: Page) {
  await page.goto('/admin');
  await page.locator('input[type=password]').fill('test');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Конструктор' })).toBeVisible();
}

interface SeedResult {
  packId: string;
  gameId: string;
}

/** Создаёт минимально валидный шаблон (1×1 обычный + финал с 2 темами) через API,
 *  публикует пак, создаёт игру с 2 командами и возвращает {packId, gameId, teamIds}. */
async function seedFinalGame(page: Page, tag: string): Promise<SeedResult> {
  // ── 1. Банк: одна категория, 3 вопроса ──────────────────────────────────
  const catRes = await page.request.post('/api/bank/categories', { data: { name: `Кат-${tag}` } });
  const { id: categoryId } = await catRes.json();

  const makeQ = async (prompt: string, answer: string): Promise<string> => {
    const q = await page.request.post(`/api/bank/categories/${categoryId}/questions`, { data: {} });
    const { id: qid } = await q.json();
    await page.request.put(`/api/bank/questions/${qid}`, { data: { type: 'text', prompt, answer } });
    return qid;
  };

  const normalQId = await makeQ(`Нормальный вопрос ${tag}`, 'ответ 1');
  const finalQ1Id = await makeQ(`Финал тема 1 ${tag}`, 'ответ 2');
  const finalQ2Id = await makeQ(`Финал тема 2 ${tag}`, 'ответ 3');

  // ── 2. Шаблон: создаём пустой, затем PUT полный doc ─────────────────────
  const tplRes = await page.request.post('/api/game-templates', { data: {} });
  const { id: templateId } = await tplRes.json();

  const docRes = await page.request.get(`/api/game-templates/${templateId}`);
  const doc = await docRes.json();

  const uid = () => crypto.randomUUID();
  const colId = uid();
  const rowId = uid();
  const theme1Id = uid();
  const theme2Id = uid();
  const finalRoundId = uid();
  const normalRoundId = uid();

  // Переписываем структуру полностью: 1 нормальный раунд (1 колонка × 1 строка) + финал
  doc.title = `Финал-игра-${tag}`;
  doc.rounds = [
    {
      id: normalRoundId,
      type: 'normal',
      name: 'Раунд 1',
      columns: [{ id: colId, value: 100 }],
      rows: [
        {
          id: rowId,
          categoryId,
          cells: [{ columnId: colId, questionId: normalQId, special: 'none' }],
        },
      ],
    },
    {
      id: finalRoundId,
      type: 'final',
      name: 'Финал',
      themes: [
        { id: theme1Id, name: `Тема А ${tag}`, questionId: finalQ1Id },
        { id: theme2Id, name: `Тема Б ${tag}`, questionId: finalQ2Id },
      ],
    },
  ];

  const saveRes = await page.request.put(`/api/game-templates/${templateId}`, { data: doc });
  expect(saveRes.ok()).toBeTruthy();

  // ── 3. Публикация ────────────────────────────────────────────────────────
  const pubRes = await page.request.post(`/api/game-templates/${templateId}/publish`, {
    data: { mode: 'new' },
  });
  const pubBody = await pubRes.json();
  if (!pubRes.ok()) {
    throw new Error(`Publish failed: ${JSON.stringify(pubBody)}`);
  }
  const { packId } = pubBody as { packId: string };

  // ── 4. Создание игры ─────────────────────────────────────────────────────
  const gameRes = await page.request.post('/api/games', {
    data: { packId, title: `Игра-${tag}`, teamCount: 2, answerTimerSec: 45, finalAnswerTimerSec: 60 },
  });
  expect(gameRes.ok()).toBeTruthy();
  const { gameId } = await gameRes.json() as { gameId: string };

  return { packId, gameId };
}

// ────────────────────────────────────────────────────────────────────────────
test('конструктор: публикация шаблона с финал-раундом не даёт ошибок валидации', async ({ page }) => {
  await login(page);
  const tag = String(Date.now());

  // Создаём через API — уже проверено в seedFinalGame
  const { packId } = await seedFinalGame(page, tag);
  expect(packId).toBeTruthy();

  // Открываем конструктор и убеждаемся, что игра появилась в списке
  await page.getByRole('button', { name: 'Конструктор' }).click();
  await expect(page.getByRole('button', { name: new RegExp(`Финал-игра-${tag}`) })).toBeVisible();

  // Открываем редактор шаблона
  await page.getByRole('button', { name: new RegExp(`Финал-игра-${tag}`) }).click();

  // Баннер ошибок валидации должен отсутствовать (.banner.warn появляется при errors.length > 0)
  await expect(page.locator('.banner.warn')).toHaveCount(0);

  // Кнопка «Опубликовать» активна (нет disabled)
  const publishBtn = page.getByRole('button', { name: 'Опубликовать' });
  await expect(publishBtn).toBeEnabled();

  await page.screenshot({ path: 'test-results/final-constructor.png', fullPage: true });
});

// ────────────────────────────────────────────────────────────────────────────
test('финал достижим: board показывает FINAL_INTRO с темами после startFinal', async ({ page, context }) => {
  await login(page);
  const tag = String(Date.now());

  const { gameId } = await seedFinalGame(page, tag);

  // Заходим в Лобби, выбираем созданную через API игру — joinAs подключит host-сокет.
  await page.getByRole('button', { name: 'Лобби и команды' }).click();

  // Ждём кнопку «Продолжить» для нашей игры (в списке появляется Игра-<tag>)
  const gameTitle = `Игра-${tag}`;
  const gameBtn = page.locator('button.game-pick', { hasText: gameTitle });
  await expect(gameBtn).toBeVisible({ timeout: 5000 });
  await gameBtn.click();

  // Теперь мы в лобби с выбранной игрой. Создаём 2 команды через UI.
  // (Хост уже подключён через joinAs внутри Lobby.onMount)
  // Команд у нас 0 — doCreateGame не вызывался. Нужно добавить команды вручную.
  const teamInput = page.locator('input[placeholder="Название новой команды"]');
  await expect(teamInput).toBeVisible({ timeout: 5000 });

  // Названия команд отображаются через input.bind:value — hasText не работает для input.value.
  // Ждём появления .team-row (любого) как сигнала что первая команда создана.
  await teamInput.fill('Команда 1');
  await teamInput.press('Enter');
  await expect(page.locator('.team-row')).toHaveCount(1, { timeout: 8000 });

  await teamInput.fill('Команда 2');
  await teamInput.press('Enter');
  await expect(page.locator('.team-row')).toHaveCount(2, { timeout: 8000 });

  // Нажимаем «Начать раунд 1»
  await page.getByRole('button', { name: 'Начать раунд 1' }).click();

  // Теперь попадаем в Pult (navigate('pult') из Lobby.startGame())
  // Ждём появления заголовка Pult — он показывается как h1.screen-title с названием игры
  await expect(page.locator('h1.screen-title', { hasText: gameTitle })).toBeVisible({ timeout: 5000 });

  // Открываем board в отдельной вкладке
  const boardPage = await context.newPage();
  await boardPage.goto(`/board?game=${encodeURIComponent(gameId)}`);

  // Поднимаем счёт командам чтобы они попали в eliminationOrder
  // (startFinal требует teams с score>0 для eliminationOrder, но FINAL_INTRO наступает в любом случае)
  // Используем кнопки ±100 на Pult
  const plus100Btns = page.locator('button', { hasText: '+100' });
  // +100 для каждой команды (нажимаем 2 раза — по одному для каждой команды)
  const count = await plus100Btns.count();
  for (let i = 0; i < count; i++) {
    await plus100Btns.nth(i).click();
  }

  // Завершаем раунд 1
  await page.getByRole('button', { name: 'Конец раунда' }).click();

  // Теперь Pult должен показать «Итоги раунда 1» с кнопкой «Начать финал →»
  await expect(page.locator('h1.screen-title', { hasText: 'Итоги раунда' })).toBeVisible({ timeout: 5000 });
  const startFinalBtn = page.getByRole('button', { name: 'Начать финал →' });
  await expect(startFinalBtn).toBeVisible({ timeout: 5000 });

  await page.screenshot({ path: 'test-results/final-round-end.png', fullPage: true });

  // Запускаем финал
  await startFinalBtn.click();

  // Pult должен перейти в FINAL_INTRO и показать заголовок «ФИНАЛ»
  await expect(page.locator('h1.screen-title', { hasText: 'ФИНАЛ' })).toBeVisible({ timeout: 5000 });

  // Темы должны быть видны на Pult
  await expect(page.locator('.final-theme-chip', { hasText: new RegExp(`Тема А ${tag}`) })).toBeVisible();
  await expect(page.locator('.final-theme-chip', { hasText: new RegExp(`Тема Б ${tag}`) })).toBeVisible();

  await page.screenshot({ path: 'test-results/final-pult-intro.png', fullPage: true });

  // Board должен показать «ФИНАЛ» и карточки тем
  await expect(boardPage.locator('h1.neon.final-title', { hasText: 'ФИНАЛ' })).toBeVisible({ timeout: 8000 });
  await expect(boardPage.locator('.theme-card', { hasText: new RegExp(`Тема А ${tag}`) })).toBeVisible();
  await expect(boardPage.locator('.theme-card', { hasText: new RegExp(`Тема Б ${tag}`) })).toBeVisible();

  const themeCards = boardPage.locator('.theme-card');
  await expect(themeCards).toHaveCount(2);

  await boardPage.screenshot({ path: 'test-results/final-board-intro.png', fullPage: true });

  await boardPage.close();
});
