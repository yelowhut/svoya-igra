# 2b-ext — Экспорт/импорт шаблона игры — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать перенос компоновки игры между установками одним файлом `*.game.json` — кнопки «Скачать шаблон» (редактор) и «Импортировать шаблон» (список игр).

**Architecture:** Чистый модуль `templatePortable.ts` (zod-схема портативного формата + `toPortable`/`fromPortable`) питает два роута в существующем `src/http/templates.ts`. Экспорт = документ минус `lastPublishedPackId` плюс маркер формата; импорт = новый top-level `id`, без резолва ссылок (висящие UID ловит уже работающая лайв-валидация при открытии). Медиа в шаблоне нет — оно едет отдельной веткой (банк, 2a).

**Tech Stack:** Node 20 ESM, Fastify (`@fastify/multipart` уже подключён), zod, better-sqlite3 (JSON-blob `game_templates`), Svelte+Vite (admin-shell), Vitest, Playwright.

## Global Constraints

- Формат файла: простой JSON, расширение `.game.json`, маркер `format: "svoya-game-template@1"`.
- Шаблон несёт **только** компоновку + UID-ссылки на банк (`categoryId`/`questionId`). **Без** медиа и без контента вопросов.
- Экспорт **выкидывает** `lastPublishedPackId` (указатель публикации конкретной установки).
- Импорт **не** резолвит и **не** валидирует ссылки на банк (мягкая инвалидация — на стороне лайв-валидации при открытии).
- Все роуты за `requireAdmin` (preHandler из 2-shell).
- Без новых зависимостей. Нативный fetch/FormData на клиенте; `form-data` (dev) в серверных тестах.
- Серверные тесты: `npm test` (vitest, из корня). Web-сборка: `npm --prefix web run build`. E2E: `npm run test:e2e`.
- Русские пользовательские строки; тех. идентификаторы — латиницей.

---

### Task 1: Чистый модуль `templatePortable.ts`

**Files:**
- Create: `src/packs/templatePortable.ts`
- Test: `src/packs/templatePortable.test.ts`

**Interfaces:**
- Consumes: `GameTemplate`, `makeDefaultTemplate` из `src/packs/templateTypes.ts`.
- Produces:
  - `PORTABLE_FORMAT = 'svoya-game-template@1'` (const)
  - `type Portable` (zod-инференс)
  - `toPortable(doc: GameTemplate): Portable`
  - `fromPortable(json: unknown, idGen?: () => string): GameTemplate` — бросает `Error` с понятным русским текстом на неверном формате/структуре.

- [ ] **Step 1: Написать падающий тест**

```ts
// src/packs/templatePortable.test.ts
import { describe, it, expect } from 'vitest';
import { makeDefaultTemplate } from './templateTypes.js';
import { PORTABLE_FORMAT, toPortable, fromPortable } from './templatePortable.js';

describe('toPortable', () => {
  it('ставит маркер формата и выкидывает id/lastPublishedPackId', () => {
    const doc = makeDefaultTemplate({ template: '5x5' });
    doc.lastPublishedPackId = 'pack-xyz';
    const p = toPortable(doc);
    expect(p.format).toBe(PORTABLE_FORMAT);
    expect(p.title).toBe(doc.title);
    expect((p as Record<string, unknown>).id).toBeUndefined();
    expect((p as Record<string, unknown>).lastPublishedPackId).toBeUndefined();
    expect(p.rounds[0].columns).toHaveLength(5);
  });
});

describe('fromPortable', () => {
  it('присваивает новый id, не несёт lastPublishedPackId', () => {
    const doc = makeDefaultTemplate({ template: '5x5' });
    const restored = fromPortable(toPortable(doc), () => 'new-id');
    expect(restored.id).toBe('new-id');
    expect(restored.lastPublishedPackId).toBeUndefined();
  });

  it('round-trip структурно эквивалентен (кроме id)', () => {
    const doc = makeDefaultTemplate({ template: '5x5' });
    doc.rounds[0].rows[0].categoryId = 'cat-1';
    doc.rounds[0].rows[0].cells[0].questionId = 'q-1';
    doc.rounds[0].rows[0].cells[0].special = 'cat';
    const restored = fromPortable(toPortable(doc), () => 'new-id');
    expect(restored.rounds).toEqual(doc.rounds);
    expect(restored.title).toBe(doc.title);
  });

  it('бросает на чужом формате', () => {
    expect(() => fromPortable({ format: 'bank@1', title: 'x', rounds: [] }))
      .toThrow(/формат/i);
  });

  it('бросает на сломанной структуре', () => {
    expect(() => fromPortable({ format: PORTABLE_FORMAT, title: 'x' }))
      .toThrow(/структур/i);
  });

  it('не бросает на ссылках, которых нет в банке (резолв отложен)', () => {
    const doc = makeDefaultTemplate({ template: '5x5' });
    doc.rounds[0].rows[0].categoryId = 'нет-такой';
    doc.rounds[0].rows[0].cells[0].questionId = 'нет-такого';
    expect(() => fromPortable(toPortable(doc))).not.toThrow();
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run src/packs/templatePortable.test.ts`
Expected: FAIL — `Cannot find module './templatePortable.js'`.

- [ ] **Step 3: Реализовать модуль**

```ts
// src/packs/templatePortable.ts
import { z } from 'zod';
import type { GameTemplate } from './templateTypes.js';

export const PORTABLE_FORMAT = 'svoya-game-template@1';

const portableSchema = z.object({
  format: z.literal(PORTABLE_FORMAT),
  title: z.string(),
  rounds: z.array(z.object({
    id: z.string(),
    name: z.string(),
    columns: z.array(z.object({ id: z.string(), value: z.number().int() })),
    rows: z.array(z.object({
      id: z.string(),
      categoryId: z.string().nullable(),
      cells: z.array(z.object({
        columnId: z.string(),
        questionId: z.string().nullable(),
        special: z.enum(['none', 'auction', 'cat']),
      })),
    })),
  })),
});

export type Portable = z.infer<typeof portableSchema>;

export function toPortable(doc: GameTemplate): Portable {
  return {
    format: PORTABLE_FORMAT,
    title: doc.title,
    rounds: doc.rounds.map(r => ({
      id: r.id,
      name: r.name,
      columns: r.columns.map(c => ({ id: c.id, value: c.value })),
      rows: r.rows.map(row => ({
        id: row.id,
        categoryId: row.categoryId,
        cells: row.cells.map(cell => ({
          columnId: cell.columnId,
          questionId: cell.questionId,
          special: cell.special,
        })),
      })),
    })),
  };
}

export function fromPortable(
  json: unknown,
  idGen: () => string = () => crypto.randomUUID(),
): GameTemplate {
  const parsed = portableSchema.safeParse(json);
  if (!parsed.success) {
    const wrongFormat = (json as { format?: unknown } | null)?.format !== PORTABLE_FORMAT;
    throw new Error(wrongFormat
      ? 'Не похоже на файл шаблона игры (неверный формат)'
      : 'Структура файла шаблона повреждена');
  }
  const p = parsed.data;
  return { id: idGen(), title: p.title, rounds: p.rounds };
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npx vitest run src/packs/templatePortable.test.ts`
Expected: PASS (6 тестов).

- [ ] **Step 5: Коммит**

```bash
git add src/packs/templatePortable.ts src/packs/templatePortable.test.ts
git commit -m "feat(2b-ext): чистый templatePortable — toPortable/fromPortable + zod"
```

---

### Task 2: Серверные роуты export/import + `insertTemplate`

**Files:**
- Modify: `src/persistence/templateRepo.ts` (добавить `insertTemplate`, `createTemplate` поверх него)
- Modify: `src/http/templates.ts` (два роута + `contentDisposition`-хелпер)
- Test: `src/http/templates.test.ts` (дописать describe `game-templates export/import`)

**Interfaces:**
- Consumes: `toPortable`/`fromPortable`/`PORTABLE_FORMAT` (Task 1); `getTemplate` (есть); `requireAdmin` (есть); `(req as any).file()` (multipart, как в `src/http/bank.ts`).
- Produces:
  - `insertTemplate(db: Db, doc: GameTemplate): { id: string }` в `templateRepo.ts`
  - `GET /api/game-templates/:id/export` → JSON-attachment
  - `POST /api/game-templates/import` → `{ id }`

- [ ] **Step 1: Написать падающие тесты роутов**

Дописать в конец `src/http/templates.test.ts` (файл уже импортирует `buildServer`, `openDb`, `EventStore`, `config`, имеет хелперы `makeDeps`/`authed`). Добавить наверх файла рядом с прочими импортами: `import FormData from 'form-data';`.

```ts
// --- 2b-ext: export/import ---
describe('game-templates export/import', () => {
  it('export выкидывает lastPublishedPackId и ставит Content-Disposition', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const id = (await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: { template: '5x5' } })).json().id;
    // вручную «опубликуем» — просто положим lastPublishedPackId в документ
    const doc = (await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).json();
    doc.lastPublishedPackId = 'pack-1';
    await app.inject({ method: 'PUT', url: `/api/game-templates/${id}`, headers: { cookie }, payload: doc });

    const exp = await app.inject({ method: 'GET', url: `/api/game-templates/${id}/export`, headers: { cookie } });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-disposition']).toMatch(/attachment/);
    const body = JSON.parse(exp.body);
    expect(body.format).toBe('svoya-game-template@1');
    expect(body.lastPublishedPackId).toBeUndefined();
    expect(body.rounds[0].columns).toHaveLength(5);
    await app.close();
  });

  it('export несуществующего → 404', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    expect((await app.inject({ method: 'GET', url: '/api/game-templates/нет/export', headers: { cookie } })).statusCode).toBe(404);
    await app.close();
  });

  it('import валидного файла создаёт документ с новым id', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const id = (await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: { template: '5x5' } })).json().id;
    const exported = (await app.inject({ method: 'GET', url: `/api/game-templates/${id}/export`, headers: { cookie } })).body;

    const form = new FormData();
    form.append('file', Buffer.from(exported, 'utf-8'), { filename: 'game.game.json', contentType: 'application/json' });
    const imp = await app.inject({ method: 'POST', url: '/api/game-templates/import', payload: form, headers: { ...form.getHeaders(), cookie } });
    expect(imp.statusCode).toBe(200);
    const newId = imp.json().id as string;
    expect(newId).not.toBe(id);
    const got = (await app.inject({ method: 'GET', url: `/api/game-templates/${newId}`, headers: { cookie } })).json();
    expect(got.rounds[0].columns).toHaveLength(5);
    await app.close();
  });

  it('import шаблона со ссылкой на отсутствующий в банке UID всё равно создаёт документ', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const payload = JSON.stringify({
      format: 'svoya-game-template@1', title: 'Сирота',
      rounds: [{ id: 'r1', name: 'Раунд 1', columns: [{ id: 'c1', value: 100 }],
        rows: [{ id: 'row1', categoryId: 'нет-в-банке',
          cells: [{ columnId: 'c1', questionId: 'тоже-нет', special: 'none' }] }] }],
    });
    const form = new FormData();
    form.append('file', Buffer.from(payload, 'utf-8'), { filename: 'x.game.json', contentType: 'application/json' });
    const imp = await app.inject({ method: 'POST', url: '/api/game-templates/import', payload: form, headers: { ...form.getHeaders(), cookie } });
    expect(imp.statusCode).toBe(200);
    await app.close();
  });

  it('import битого/чужого файла → 400', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const bad = new FormData();
    bad.append('file', Buffer.from('не json', 'utf-8'), { filename: 'bad.json', contentType: 'application/json' });
    expect((await app.inject({ method: 'POST', url: '/api/game-templates/import', payload: bad, headers: { ...bad.getHeaders(), cookie } })).statusCode).toBe(400);

    const wrong = new FormData();
    wrong.append('file', Buffer.from(JSON.stringify({ format: 'bank@1' }), 'utf-8'), { filename: 'w.json', contentType: 'application/json' });
    expect((await app.inject({ method: 'POST', url: '/api/game-templates/import', payload: wrong, headers: { ...wrong.getHeaders(), cookie } })).statusCode).toBe(400);
    await app.close();
  });

  it('export/import за requireAdmin (401 без куки)', async () => {
    const app = buildServer(makeDeps());
    expect((await app.inject({ method: 'GET', url: '/api/game-templates/любой/export' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/game-templates/import' })).statusCode).toBe(401);
    await app.close();
  });
});
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `npx vitest run src/http/templates.test.ts -t "export/import"`
Expected: FAIL — роутов нет (404/нет хедера/неверные коды).

- [ ] **Step 3: Добавить `insertTemplate` в `templateRepo.ts`**

Заменить текущую `createTemplate` (строки 5–10) на:

```ts
export function insertTemplate(db: Db, doc: GameTemplate): { id: string } {
  db.prepare('INSERT INTO game_templates (id,data,updated_at) VALUES (?,?,?)')
    .run(doc.id, JSON.stringify(doc), Date.now());
  return { id: doc.id };
}

export function createTemplate(db: Db, opts: { template?: '5x5' }): { id: string } {
  return insertTemplate(db, makeDefaultTemplate({ template: opts.template }));
}
```

(`makeDefaultTemplate` уже импортирован в файле.)

- [ ] **Step 4: Добавить роуты в `src/http/templates.ts`**

В импорты сверху добавить:

```ts
import { createTemplate, getTemplate, listTemplates, saveTemplate, deleteTemplate, loadBankView, insertTemplate } from '../persistence/templateRepo.js';
import { toPortable, fromPortable } from '../packs/templatePortable.js';
```

(первая строка заменяет существующий импорт из `templateRepo.js`, добавляя `insertTemplate`.)

Перед закрывающей `}` функции `registerTemplates` (после роута `unpublish`) добавить:

```ts
  app.get('/api/game-templates/:id/export', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = getTemplate(db, id);
    if (!doc) return reply.code(404).send({ error: 'шаблон не найден' });
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', contentDisposition(doc.title));
    return reply.send(JSON.stringify(toPortable(doc), null, 2));
  });

  app.post('/api/game-templates/import', guard, async (req, reply) => {
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: 'нет файла' });
    const buf = await file.toBuffer();
    let json: unknown;
    try {
      json = JSON.parse(buf.toString('utf-8'));
    } catch {
      return reply.code(400).send({ error: 'файл не является корректным JSON' });
    }
    try {
      return insertTemplate(db, fromPortable(json));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
```

Над `registerTemplates` (рядом с `findActiveGameIds`) добавить хелпер имени файла:

```ts
/** Content-Disposition с ASCII-фолбэком и RFC 5987 для кириллицы. */
function contentDisposition(title: string): string {
  const ascii = (title.replace(/[^A-Za-z0-9._ -]+/g, '_').trim() || 'template') + '.game.json';
  const utf8 = encodeURIComponent(title + '.game.json');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
```

- [ ] **Step 5: Запустить тесты — убедиться, что проходят**

Run: `npx vitest run src/http/templates.test.ts`
Expected: PASS (старые CRUD/preflight/publish + 6 новых export/import).

- [ ] **Step 6: Прогнать весь серверный набор (регрессия `createTemplate`)**

Run: `npm test`
Expected: PASS — все серверные тесты зелёные (рефактор `createTemplate` ничего не сломал).

- [ ] **Step 7: Коммит**

```bash
git add src/persistence/templateRepo.ts src/http/templates.ts src/http/templates.test.ts
git commit -m "feat(2b-ext): роуты export/import шаблона + insertTemplate"
```

---

### Task 3: Клиентский API + UI (кнопки «Скачать»/«Импортировать»)

**Files:**
- Modify: `web/src/admin/templateApi.ts` (добавить `templateExportUrl`, `importTemplate`)
- Modify: `web/src/admin/sections/builder/GameEditor.svelte` (кнопка «Скачать шаблон» + flush)
- Modify: `web/src/admin/sections/Builder.svelte` (кнопка «Импортировать шаблон» + инлайн-ошибка + открыть импортированный)

**Interfaces:**
- Consumes: роуты из Task 2; существующие `draft.flush()`, `api.listTemplates`, `open(id)` в `Builder.svelte`.
- Produces:
  - `templateExportUrl(id: string): string`
  - `importTemplate(file: File): Promise<{ id: string }>`

- [ ] **Step 1: Добавить клиентские хелперы в `web/src/admin/templateApi.ts`**

Перед строкой `// Re-export types ...` добавить:

```ts
export const templateExportUrl = (id: string): string =>
  `/api/game-templates/${id}/export`;

export const importTemplate = (file: File): Promise<{ id: string }> => {
  const fd = new FormData();
  fd.append('file', file);
  return fetch('/api/game-templates/import', { method: 'POST', body: fd }).then(jsonOf);
};
```

- [ ] **Step 2: Кнопка «Скачать шаблон» в `GameEditor.svelte`**

Добавить функцию в `<script>` (рядом с `playTest`):

```ts
  async function downloadTemplate() {
    if (!draft) return;
    await draft.flush();                 // не экспортнуть устаревший черновик
    const a = document.createElement('a');
    a.href = api.templateExportUrl(id);  // Content-Disposition: attachment → скачивание, не навигация
    a.click();
  }
```

В шапке `<header class="bar">` добавить кнопку перед «Сыграть тестовую» (строка 158):

```svelte
  <button class="ghost" on:click={downloadTemplate} disabled={!docVal}>Скачать шаблон</button>
```

- [ ] **Step 3: Кнопка «Импортировать шаблон» в `Builder.svelte`**

В `<script>` добавить состояние и обработчик (после `let deleting = ...`):

```ts
  let importError: string | null = null;
  let fileInput: HTMLInputElement;

  async function onImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';                    // позволить повторный выбор того же файла
    if (!file) return;
    importError = null;
    try {
      const { id } = await api.importTemplate(file);
      open(id);
    } catch (err) {
      importError = `Не удалось импортировать: ${(err as Error).message ?? 'неизвестная ошибка'}`;
    }
  }
```

В блоке `.actions` (строки 35–38) добавить кнопку и скрытый input:

```svelte
      <div class="actions">
        <button class="ghost" on:click={() => fileInput.click()}>Импортировать шаблон</button>
        <button class="ghost" on:click={() => create()}>Пустая игра</button>
        <button class="primary" on:click={() => create('5x5')}>Новая 5×5</button>
        <input type="file" accept=".json,application/json" bind:this={fileInput}
               on:change={onImportFile} style="display:none" />
      </div>
```

Под `<header class="head">…</header>` (после строки 39) добавить баннер ошибки:

```svelte
    {#if importError}
      <div class="banner err">{importError}</div>
    {/if}
```

В `<style>` добавить стиль баннера:

```css
  .banner { margin-bottom: 16px; padding: 10px 14px; border-radius: var(--r-control); font-family: var(--font-display); }
  .banner.err { background: rgba(255,77,79,.12); color: var(--err); border: 1px solid var(--err); }
```

- [ ] **Step 4: Проверка типов и сборки web**

Run: `npm --prefix web run build`
Expected: сборка без ошибок (Svelte + tsc через vite). Если в проекте используется `svelte-check` — дополнительно `cd web && npx svelte-check` (0 ошибок).

- [ ] **Step 5: Коммит**

```bash
git add web/src/admin/templateApi.ts web/src/admin/sections/builder/GameEditor.svelte web/src/admin/sections/Builder.svelte
git commit -m "feat(2b-ext): UI — Скачать шаблон / Импортировать шаблон"
```

---

### Task 4: E2E Playwright + документация

**Files:**
- Create/Modify: `tests/e2e/template-export-import.spec.ts` (новый spec; следовать стилю существующих `tests/e2e/*.spec.ts`)
- Modify: `docs/run.md` (абзац про перенос шаблона)

**Interfaces:**
- Consumes: живой сервер на :3100 (webServer из `playwright.config.ts`), admin-логин (пароль из дев-дефолта `admin`), маршрут конструктора.

- [ ] **Step 1: Написать E2E-сценарий (round-trip через UI)**

```ts
// tests/e2e/template-export-import.spec.ts
import { test, expect } from '@playwright/test';

// Логин в админку (повторяет паттерн существующих spec'ов; при необходимости
// свериться с tests/e2e/smoke.spec.ts на точные селекторы формы логина).
async function login(page) {
  await page.goto('/admin');
  await page.getByPlaceholder('Пароль').fill('admin');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Конструктор' })).toBeVisible();
}

test('экспорт шаблона отдаёт .game.json', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Новая 5×5' }).click();
  await expect(page.getByRole('button', { name: 'Скачать шаблон' })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Скачать шаблон' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.game\.json$/);
});

test('импорт файла поднимает игру и открывает редактор', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Новая 5×5' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Скачать шаблон' }).click(),
  ]);
  const path = await download.path();

  await page.getByRole('button', { name: '← Список игр' }).click();
  await page.getByRole('button', { name: 'Импортировать шаблон' }).setInputFiles(path!);
  // после импорта редактор открывается на новом документе
  await expect(page.getByRole('button', { name: 'Скачать шаблон' })).toBeVisible();
});
```

> Примечание исполнителю: точные селекторы формы логина и кнопки «Импортировать шаблон» (она открывает скрытый input — для Playwright используйте `setInputFiles` прямо на этом `input[type=file]`, найдя его, либо повесьте `data-testid`). Сверьтесь с `tests/e2e/smoke.spec.ts` и `tests/e2e/constructor-fixes.spec.ts` на принятые в проекте приёмы; при расхождении селекторов — поправьте под фактический DOM.

- [ ] **Step 2: Запустить E2E**

Run: `npm run test:e2e -- template-export-import`
Expected: PASS (2 сценария). Если `npx playwright install` не выполнен — выполнить один раз.

- [ ] **Step 3: Обновить `docs/run.md`**

Добавить абзац в раздел про конструктор:

```markdown
### Перенос игры между установками

«Скачать шаблон» в редакторе игры сохраняет файл `<название>.game.json` — это **только
компоновка** (сетка, цены, теги, ссылки на вопросы банка по UID), без медиа. «Импортировать
шаблон» в списке игр поднимает игру из такого файла.

Медиа и контент вопросов едут **отдельной веткой** — через «Экспорт банка» (`bank.zip`).
Чтобы перенести игру целиком на другую машину: сначала импортируйте банк (`bank.zip`),
потом шаблон (`*.game.json`). Если на целевой машине нужных вопросов в банке нет, ячейки
с висящими ссылками подсветятся как невалидные и публикация заблокируется до пере-привязки.
```

- [ ] **Step 4: Финальная проверка всего набора**

Run: `npm test && npm --prefix web run build`
Expected: серверные тесты зелёные, web собирается.

- [ ] **Step 5: Коммит**

```bash
git add tests/e2e/template-export-import.spec.ts docs/run.md
git commit -m "test(2b-ext): E2E экспорт/импорт шаблона + docs/run.md"
```

---

## Self-Review (выполнено при написании плана)

**Spec coverage:**
- Формат `.game.json` + маркер → Task 1 (схема/константа), Task 2 (export тело).
- Экспорт выкидывает `lastPublishedPackId` → Task 1 `toPortable`, Task 2 тест.
- Импорт = новый id, без резолва ссылок → Task 1 `fromPortable`, Task 2 тест «сирота».
- Роуты за `requireAdmin` → Task 2, тест 401.
- `insertTemplate` + рефактор `createTemplate` → Task 2 Step 3 (+ регресс `npm test` Step 6).
- Multipart-импорт → Task 2 (переиспользует `req.file()` как банк).
- UI «Скачать»/«Импортировать» + flush + инлайн-ошибка + открыть импортированный → Task 3.
- Санитайз имени файла (ASCII + RFC 5987) → Task 2 `contentDisposition`.
- E2E + docs/run.md → Task 4.

**Placeholder scan:** код приведён полностью во всех шагах; единственные «по месту» уточнения — точные Playwright-селекторы (вынесены в явное примечание исполнителю, т.к. зависят от фактического DOM admin-формы).

**Type consistency:** `toPortable`/`fromPortable`/`PORTABLE_FORMAT`/`insertTemplate`/`templateExportUrl`/`importTemplate` именованы одинаково во всех задачах. `special` enum `none|auction|cat` совпадает с `SpecialTag` из `templateTypes.ts`. `Db`/`GameTemplate` берутся из существующих модулей.
