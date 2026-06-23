# Конструктор игр (2b-core + корректировки) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заполнить заглушку `Builder.svelte` полноценным конструктором игр: сборка из вопросов банка (сетка категории×цены, DnD, теги мини-игр), лайв-валидация, публикация во flatten-формат пака и «Сыграть тестовую» — с корректировками сессии 2026-06-23.

**Architecture:** Серверная часть — новая таблица `game_templates` (JSON-документ), репозиторий-CRUD, чистый слой `templateSchema` (валидация + flatten в формат пака), HTTP-роуты `/api/game-templates/*` за `requireAdmin`. Публикация прогоняет strict-валидацию против банка (включая физическое наличие медиа), делает flatten в существующий формат пака (`gameJsonSchema` не меняется), пишет в `packs`, копирует медиа и **принудительно завершает** активные игры на этом packId. Веб-часть — экран «Список игр» + редактор-сетка (визуальное эхо `Matrix.svelte`) с нативным HTML5 DnD по паттернам 2a, draft-store с debounced-автосейвом, клиентский валидатор-зеркало.

**Tech Stack:** TypeScript (ESM, `.js`-импорты), better-sqlite3, Fastify 4, socket.io, Zod, Svelte 4 (без runes), Vite 5, Vitest.

## Global Constraints

- Язык кода/комментов/UI — русский; идентификаторы латиницей. Орфография корректная.
- ESM: импорты внутренних модулей — с расширением `.js` (напр. `from './db.js'`).
- id везде — `crypto.randomUUID()`.
- Репозитории — чистые функции, принимающие `db: Db` первым аргументом (паттерн `bankRepo.ts`).
- HTTP-роуты — `registerX(app, deps: ServerDeps)`, guard `{ preHandler: requireAdmin }`, ошибки `reply.code(N).send({ error: '...' })` (400 валидация, 401 авторизация, 404 не найдено).
- Тесты — Vitest, БД `openDb(':memory:')` в `beforeEach`, HTTP через `app.inject()`. Запуск: `npm test` (корень) и `npm test` в `web/`.
- **Движок и `gameJsonSchema` НЕ меняются** — flatten обязан давать валидный для существующей `gameJsonSchema` объект.
- Корректировки 2026-06-23 (вшиты в задачи): форс-завершение игр при перезаписи (Task 9), «Сыграть тестовую» в тот же packId (Task 18), физическая проверка медиа (Task 5), ручная цена кратно 100 + авто на 6-й+ (Task 15), дубль цен/вопросов — предупреждения (Task 5/12), тег только на заполненной ячейке (Task 17), снапшот title/имени раунда (Task 6), flush автосейва перед публикацией/тестом (Task 13/18), `teamCount`=3 (Task 18), превью медиа в ячейке (Task 17).
- Тип раунда `type` (`final`) и конструктор финала — **НЕ в этом плане** (спек 2c).

---

## Структура файлов

Сервер:
- `src/persistence/db.ts` — +миграция `game_templates` (Task 1).
- `src/packs/templateTypes.ts` (новый) — типы документа шаблона + `makeDefaultTemplate` (Task 2).
- `src/persistence/templateRepo.ts` (новый) — CRUD + `loadBankView` (Task 3, 4).
- `src/packs/templateValidate.ts` (новый) — `validateForPublish` (Task 5).
- `src/packs/templateFlatten.ts` (новый) — `flattenTemplate` (Task 6).
- `src/http/templates.ts` (новый) — роуты `/api/game-templates/*` (Task 7, 8, 9).
- `src/http/server.ts` — `ServerDeps.broadcaster`, регистрация роутов (Task 7, 9).
- `src/index.ts` — обвязка broadcast-хука (Task 9).

Веб (`web/src/admin/`):
- `templateApi.ts` (новый) — клиент `/api/game-templates/*` (Task 11).
- `lib/templateValidate.ts` (новый) — клиентский валидатор-зеркало (Task 12).
- `lib/templateDraft.ts` (новый) — draft-store + debounced save + flush (Task 13).
- `sections/Builder.svelte` — список игр + переключение в редактор (Task 14).
- `sections/builder/GameEditor.svelte` (новый) — обёртка редактора игры (Task 14, 18).
- `sections/builder/RoundGrid.svelte` (новый) — сетка раунда (Task 15, 16, 17).
- `sections/builder/SourceSidebar.svelte` (новый) — сайдбар «База · источник» (Task 16).

---

## Канонические типы документа шаблона

Эти типы создаются в Task 2 и импортируются всеми последующими задачами. Точные имена:

```ts
export type SpecialTag = 'none' | 'auction' | 'cat';

export interface TemplateColumn { id: string; value: number }
export interface TemplateCell { columnId: string; questionId: string | null; special: SpecialTag }
export interface TemplateRow { id: string; categoryId: string | null; cells: TemplateCell[] }
export interface TemplateRound { id: string; name: string; columns: TemplateColumn[]; rows: TemplateRow[] }
export interface GameTemplate {
  id: string;
  title: string;
  lastPublishedPackId?: string;
  rounds: TemplateRound[];
}
```

---

### Task 1: Миграция таблицы `game_templates`

**Files:**
- Modify: `src/persistence/db.ts` (блок `db.exec` в `openDb`)
- Test: `src/persistence/db.test.ts` (создать, если нет — иначе добавить `it`)

**Interfaces:**
- Produces: таблица `game_templates(id TEXT PK, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`.

- [ ] **Step 1: Failing test** — добавь в `src/persistence/db.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDb } from './db.js';

describe('миграция game_templates', () => {
  it('таблица существует и принимает вставку', () => {
    const db = openDb(':memory:');
    db.prepare('INSERT INTO game_templates (id,data,updated_at) VALUES (?,?,?)').run('t1', '{}', 1);
    const row = db.prepare('SELECT id,data,updated_at FROM game_templates WHERE id=?').get('t1');
    expect(row).toEqual({ id: 't1', data: '{}', updated_at: 1 });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm test -- db.test` → FAIL `no such table: game_templates`.

- [ ] **Step 3: Add migration** — внутри `db.exec(\`...\`)` в `openDb` добавь:

```sql
CREATE TABLE IF NOT EXISTS game_templates (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- [ ] **Step 4: Run, verify PASS** — `npm test -- db.test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/db.ts src/persistence/db.test.ts
git commit -m "feat(2b): миграция таблицы game_templates"
```

---

### Task 2: Типы документа шаблона + дефолтный 5×5

**Files:**
- Create: `src/packs/templateTypes.ts`
- Test: `src/packs/templateTypes.test.ts`

**Interfaces:**
- Produces: типы из раздела «Канонические типы»; `makeDefaultTemplate(opts: { template?: '5x5'; title?: string }, idGen?: () => string): GameTemplate`.
  - `template: '5x5'` → один раунд «Раунд 1», 5 столбцов (value 100..500), 5 строк (`categoryId: null`), каждая строка — 5 ячеек (`questionId: null`, `special: 'none'`).
  - иначе (пустой) → один раунд «Раунд 1», 0 столбцов, 0 строк.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeDefaultTemplate } from './templateTypes.js';

let n = 0; const id = () => `id${n++}`;
beforeEach(() => { n = 0; });

describe('makeDefaultTemplate', () => {
  it('5x5: 1 раунд, 5 столбцов 100..500, 5 строк по 5 пустых ячеек', () => {
    const t = makeDefaultTemplate({ template: '5x5', title: 'Игра' }, id);
    expect(t.title).toBe('Игра');
    expect(t.rounds).toHaveLength(1);
    const r = t.rounds[0];
    expect(r.name).toBe('Раунд 1');
    expect(r.columns.map(c => c.value)).toEqual([100, 200, 300, 400, 500]);
    expect(r.rows).toHaveLength(5);
    expect(r.rows[0].categoryId).toBeNull();
    expect(r.rows[0].cells).toHaveLength(5);
    expect(r.rows[0].cells[0]).toMatchObject({ questionId: null, special: 'none' });
    expect(r.rows[0].cells[0].columnId).toBe(r.columns[0].id);
  });
  it('пустой: 1 раунд без столбцов и строк', () => {
    const t = makeDefaultTemplate({}, id);
    expect(t.rounds[0].columns).toEqual([]);
    expect(t.rounds[0].rows).toEqual([]);
  });
});
```

(добавь `import { beforeEach } from 'vitest';`)

- [ ] **Step 2: Run, verify FAIL** — `npm test -- templateTypes` → FAIL (модуль не найден).

- [ ] **Step 3: Implement** — `src/packs/templateTypes.ts`:

```ts
export type SpecialTag = 'none' | 'auction' | 'cat';

export interface TemplateColumn { id: string; value: number }
export interface TemplateCell { columnId: string; questionId: string | null; special: SpecialTag }
export interface TemplateRow { id: string; categoryId: string | null; cells: TemplateCell[] }
export interface TemplateRound { id: string; name: string; columns: TemplateColumn[]; rows: TemplateRow[] }
export interface GameTemplate {
  id: string;
  title: string;
  lastPublishedPackId?: string;
  rounds: TemplateRound[];
}

export function makeDefaultTemplate(
  opts: { template?: '5x5'; title?: string } = {},
  idGen: () => string = () => crypto.randomUUID(),
): GameTemplate {
  const round: TemplateRound = { id: idGen(), name: 'Раунд 1', columns: [], rows: [] };
  if (opts.template === '5x5') {
    round.columns = [100, 200, 300, 400, 500].map(value => ({ id: idGen(), value }));
    round.rows = Array.from({ length: 5 }, () => ({
      id: idGen(),
      categoryId: null,
      cells: round.columns.map(col => ({ columnId: col.id, questionId: null, special: 'none' as const })),
    }));
  }
  return { id: idGen(), title: opts.title ?? 'Новая игра', rounds: [round] };
}
```

- [ ] **Step 4: Run, verify PASS** — `npm test -- templateTypes` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/packs/templateTypes.ts src/packs/templateTypes.test.ts
git commit -m "feat(2b): типы документа шаблона и дефолтный 5x5"
```

---

### Task 3: Репозиторий CRUD шаблонов

**Files:**
- Create: `src/persistence/templateRepo.ts`
- Test: `src/persistence/templateRepo.test.ts`

**Interfaces:**
- Consumes: `Db` из `./db.js`; типы из `../packs/templateTypes.js`; `makeDefaultTemplate`.
- Produces:
  - `createTemplate(db, opts: { template?: '5x5' }): { id: string }`
  - `getTemplate(db, id: string): GameTemplate | null`
  - `listTemplates(db): { id: string; title: string; updatedAt: number }[]` (по убыванию `updated_at`)
  - `saveTemplate(db, id: string, doc: GameTemplate): boolean` (обновляет `data` + `updated_at = Date.now()`; false если строки нет)
  - `deleteTemplate(db, id: string): boolean`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from './db.js';
import { createTemplate, getTemplate, listTemplates, saveTemplate, deleteTemplate } from './templateRepo.js';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });

describe('templateRepo', () => {
  it('create 5x5 → get возвращает документ с 1 раундом 5x5', () => {
    const { id } = createTemplate(db, { template: '5x5' });
    const doc = getTemplate(db, id)!;
    expect(doc.id).toBe(id);
    expect(doc.rounds[0].columns).toHaveLength(5);
  });
  it('get несуществующего → null', () => {
    expect(getTemplate(db, 'nope')).toBeNull();
  });
  it('save обновляет документ и возвращает true', () => {
    const { id } = createTemplate(db, {});
    const doc = getTemplate(db, id)!;
    doc.title = 'Переименовано';
    expect(saveTemplate(db, id, doc)).toBe(true);
    expect(getTemplate(db, id)!.title).toBe('Переименовано');
  });
  it('save несуществующего → false', () => {
    const { id } = createTemplate(db, {});
    const doc = getTemplate(db, id)!;
    expect(saveTemplate(db, 'nope', doc)).toBe(false);
  });
  it('list отдаёт {id,title,updatedAt}', () => {
    const a = createTemplate(db, {});
    const list = listTemplates(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: a.id, title: 'Новая игра' });
    expect(typeof list[0].updatedAt).toBe('number');
  });
  it('delete удаляет', () => {
    const { id } = createTemplate(db, {});
    expect(deleteTemplate(db, id)).toBe(true);
    expect(getTemplate(db, id)).toBeNull();
    expect(deleteTemplate(db, id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm test -- templateRepo` → FAIL.

- [ ] **Step 3: Implement** — `src/persistence/templateRepo.ts`:

```ts
import type { Db } from './db.js';
import type { GameTemplate } from '../packs/templateTypes.js';
import { makeDefaultTemplate } from '../packs/templateTypes.js';

export function createTemplate(db: Db, opts: { template?: '5x5' }): { id: string } {
  const doc = makeDefaultTemplate({ template: opts.template });
  db.prepare('INSERT INTO game_templates (id,data,updated_at) VALUES (?,?,?)')
    .run(doc.id, JSON.stringify(doc), Date.now());
  return { id: doc.id };
}

export function getTemplate(db: Db, id: string): GameTemplate | null {
  const row = db.prepare('SELECT data FROM game_templates WHERE id=?').get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as GameTemplate) : null;
}

export function listTemplates(db: Db): { id: string; title: string; updatedAt: number }[] {
  const rows = db.prepare('SELECT id,data,updated_at FROM game_templates ORDER BY updated_at DESC')
    .all() as Array<{ id: string; data: string; updated_at: number }>;
  return rows.map(r => ({ id: r.id, title: (JSON.parse(r.data) as GameTemplate).title, updatedAt: r.updated_at }));
}

export function saveTemplate(db: Db, id: string, doc: GameTemplate): boolean {
  return db.prepare('UPDATE game_templates SET data=?, updated_at=? WHERE id=?')
    .run(JSON.stringify({ ...doc, id }), Date.now(), id).changes > 0;
}

export function deleteTemplate(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM game_templates WHERE id=?').run(id).changes > 0;
}
```

- [ ] **Step 4: Run, verify PASS** — `npm test -- templateRepo` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/templateRepo.ts src/persistence/templateRepo.test.ts
git commit -m "feat(2b): CRUD-репозиторий шаблонов игр"
```

---

### Task 4: Чтение «среза банка» (`loadBankView`)

**Files:**
- Modify: `src/persistence/templateRepo.ts`
- Test: `src/persistence/templateRepo.test.ts`

**Interfaces:**
- Produces:
  - `interface BankView { categories: Map<string, { id: string; name: string }>; questions: Map<string, BankQ> }`
  - `interface BankQ { id: string; categoryId: string; type: 'text'|'image'|'audio'; prompt: string; answer: string; media: string | null }`
  - `loadBankView(db): BankView`

- [ ] **Step 1: Failing test** — добавь в `templateRepo.test.ts`:

```ts
import { loadBankView } from './templateRepo.js';

describe('loadBankView', () => {
  it('собирает категории и вопросы в Map по id', () => {
    db.prepare('INSERT INTO bank_categories (id,name,position) VALUES (?,?,?)').run('c1', 'Кино', 1);
    db.prepare('INSERT INTO bank_questions (id,category_id,type,prompt,answer,media,position) VALUES (?,?,?,?,?,?,?)')
      .run('q1', 'c1', 'image', 'Кадр', 'Ответ', 'bank/media/x.png', 1);
    const view = loadBankView(db);
    expect(view.categories.get('c1')).toEqual({ id: 'c1', name: 'Кино' });
    expect(view.questions.get('q1')).toMatchObject({ categoryId: 'c1', type: 'image', media: 'bank/media/x.png' });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm test -- templateRepo` → FAIL (нет `loadBankView`).

- [ ] **Step 3: Implement** — добавь в `templateRepo.ts`:

```ts
export interface BankQ {
  id: string; categoryId: string;
  type: 'text' | 'image' | 'audio';
  prompt: string; answer: string; media: string | null;
}
export interface BankView {
  categories: Map<string, { id: string; name: string }>;
  questions: Map<string, BankQ>;
}

export function loadBankView(db: Db): BankView {
  const cats = db.prepare('SELECT id,name FROM bank_categories').all() as Array<{ id: string; name: string }>;
  const qs = db.prepare('SELECT id,category_id,type,prompt,answer,media FROM bank_questions')
    .all() as Array<{ id: string; category_id: string; type: BankQ['type']; prompt: string; answer: string; media: string | null }>;
  return {
    categories: new Map(cats.map(c => [c.id, { id: c.id, name: c.name }])),
    questions: new Map(qs.map(q => [q.id, {
      id: q.id, categoryId: q.category_id, type: q.type, prompt: q.prompt, answer: q.answer, media: q.media ?? null,
    }])),
  };
}
```

- [ ] **Step 4: Run, verify PASS** — `npm test -- templateRepo` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/templateRepo.ts src/persistence/templateRepo.test.ts
git commit -m "feat(2b): срез банка для валидации/flatten"
```

---

### Task 5: Strict-валидация публикации

**Files:**
- Create: `src/packs/templateValidate.ts`
- Test: `src/packs/templateValidate.test.ts`

**Interfaces:**
- Consumes: `GameTemplate` из `./templateTypes.js`; `BankView` из `../persistence/templateRepo.js`.
- Produces:
  - тип `Problem` (дискриминированный, поле `kind`) — точные варианты ниже.
  - `validateForPublish(doc: GameTemplate, bank: BankView, mediaExists: (relPath: string) => boolean): { errors: Problem[]; warnings: Problem[] }`
  - errors блокируют публикацию; warnings — нет.

Точные `kind`:
```
errors:  'no-title' | 'round-no-name' | 'round-no-columns' | 'round-no-rows'
       | 'bad-value' | 'row-no-category' | 'row-bad-category'
       | 'cell-empty' | 'cell-bad-question' | 'cell-wrong-category' | 'cell-missing-media'
warnings:'dup-value' | 'dup-question'
```
Каждый кроме `no-title`/`dup-question` несёт `roundId`; cell-* несут `rowId`+`columnId`; `row-*` несут `rowId`; `bad-value`/`dup-value` несут `columnId`/`value`; `dup-question` несёт `questionId`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateForPublish } from './templateValidate.js';
import type { GameTemplate } from './templateTypes.js';
import type { BankView } from '../persistence/templateRepo.js';

function bankWith(): BankView {
  return {
    categories: new Map([['c1', { id: 'c1', name: 'Кино' }]]),
    questions: new Map([
      ['q1', { id: 'q1', categoryId: 'c1', type: 'text', prompt: 'p', answer: 'a', media: null }],
      ['qimg', { id: 'qimg', categoryId: 'c1', type: 'image', prompt: 'p', answer: 'a', media: 'bank/media/x.png' }],
      ['qother', { id: 'qother', categoryId: 'cX', type: 'text', prompt: 'p', answer: 'a', media: null }],
    ]),
  };
}
const always = () => true;

function validDoc(): GameTemplate {
  return {
    id: 't', title: 'Игра',
    rounds: [{
      id: 'r1', name: 'Раунд 1',
      columns: [{ id: 'k1', value: 100 }],
      rows: [{ id: 'row1', categoryId: 'c1', cells: [{ columnId: 'k1', questionId: 'q1', special: 'none' }] }],
    }],
  };
}

describe('validateForPublish', () => {
  it('валидный документ → нет ошибок', () => {
    expect(validateForPublish(validDoc(), bankWith(), always).errors).toEqual([]);
  });
  it('пустой title → error no-title', () => {
    const d = validDoc(); d.title = '  ';
    expect(validateForPublish(d, bankWith(), always).errors.some(e => e.kind === 'no-title')).toBe(true);
  });
  it('value не целое >0 → error bad-value', () => {
    const d = validDoc(); d.rounds[0].columns[0].value = 0;
    expect(validateForPublish(d, bankWith(), always).errors.some(e => e.kind === 'bad-value')).toBe(true);
  });
  it('строка без категории → error row-no-category', () => {
    const d = validDoc(); d.rounds[0].rows[0].categoryId = null;
    expect(validateForPublish(d, bankWith(), always).errors.some(e => e.kind === 'row-no-category')).toBe(true);
  });
  it('пустая ячейка → error cell-empty', () => {
    const d = validDoc(); d.rounds[0].rows[0].cells[0].questionId = null;
    expect(validateForPublish(d, bankWith(), always).errors.some(e => e.kind === 'cell-empty')).toBe(true);
  });
  it('вопрос из чужой категории → error cell-wrong-category', () => {
    const d = validDoc(); d.rounds[0].rows[0].cells[0].questionId = 'qother';
    expect(validateForPublish(d, bankWith(), always).errors.some(e => e.kind === 'cell-wrong-category')).toBe(true);
  });
  it('image без файла → error cell-missing-media', () => {
    const d = validDoc(); d.rounds[0].rows[0].cells[0].questionId = 'qimg';
    const res = validateForPublish(d, bankWith(), () => false);
    expect(res.errors.some(e => e.kind === 'cell-missing-media')).toBe(true);
  });
  it('image с файлом → нет ошибки', () => {
    const d = validDoc(); d.rounds[0].rows[0].cells[0].questionId = 'qimg';
    expect(validateForPublish(d, bankWith(), always).errors).toEqual([]);
  });
  it('дубль цены → warning dup-value', () => {
    const d = validDoc();
    d.rounds[0].columns = [{ id: 'k1', value: 100 }, { id: 'k2', value: 100 }];
    d.rounds[0].rows[0].cells = [
      { columnId: 'k1', questionId: 'q1', special: 'none' },
      { columnId: 'k2', questionId: 'q1', special: 'none' },
    ];
    const res = validateForPublish(d, bankWith(), always);
    expect(res.warnings.some(w => w.kind === 'dup-value')).toBe(true);
    expect(res.warnings.some(w => w.kind === 'dup-question')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm test -- templateValidate` → FAIL.

- [ ] **Step 3: Implement** — `src/packs/templateValidate.ts`:

```ts
import type { GameTemplate } from './templateTypes.js';
import type { BankView } from '../persistence/templateRepo.js';

export type Problem =
  | { kind: 'no-title' }
  | { kind: 'round-no-name'; roundId: string }
  | { kind: 'round-no-columns'; roundId: string }
  | { kind: 'round-no-rows'; roundId: string }
  | { kind: 'bad-value'; roundId: string; columnId: string }
  | { kind: 'row-no-category'; roundId: string; rowId: string }
  | { kind: 'row-bad-category'; roundId: string; rowId: string }
  | { kind: 'cell-empty'; roundId: string; rowId: string; columnId: string }
  | { kind: 'cell-bad-question'; roundId: string; rowId: string; columnId: string }
  | { kind: 'cell-wrong-category'; roundId: string; rowId: string; columnId: string }
  | { kind: 'cell-missing-media'; roundId: string; rowId: string; columnId: string }
  | { kind: 'dup-value'; roundId: string; value: number }
  | { kind: 'dup-question'; questionId: string };

export function validateForPublish(
  doc: GameTemplate,
  bank: BankView,
  mediaExists: (relPath: string) => boolean,
): { errors: Problem[]; warnings: Problem[] } {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  if (!doc.title.trim()) errors.push({ kind: 'no-title' });
  if (doc.rounds.length === 0) return { errors, warnings };

  const questionUses = new Map<string, number>();

  for (const r of doc.rounds) {
    if (!r.name.trim()) errors.push({ kind: 'round-no-name', roundId: r.id });
    if (r.columns.length === 0) errors.push({ kind: 'round-no-columns', roundId: r.id });
    if (r.rows.length === 0) errors.push({ kind: 'round-no-rows', roundId: r.id });

    for (const col of r.columns) {
      if (!Number.isInteger(col.value) || col.value <= 0) errors.push({ kind: 'bad-value', roundId: r.id, columnId: col.id });
    }
    const seenValues = new Set<number>();
    for (const col of r.columns) {
      if (seenValues.has(col.value)) warnings.push({ kind: 'dup-value', roundId: r.id, value: col.value });
      seenValues.add(col.value);
    }

    for (const row of r.rows) {
      if (!row.categoryId) { errors.push({ kind: 'row-no-category', roundId: r.id, rowId: row.id }); }
      else if (!bank.categories.has(row.categoryId)) { errors.push({ kind: 'row-bad-category', roundId: r.id, rowId: row.id }); }

      for (const cell of row.cells) {
        if (!cell.questionId) { errors.push({ kind: 'cell-empty', roundId: r.id, rowId: row.id, columnId: cell.columnId }); continue; }
        questionUses.set(cell.questionId, (questionUses.get(cell.questionId) ?? 0) + 1);
        const q = bank.questions.get(cell.questionId);
        if (!q) { errors.push({ kind: 'cell-bad-question', roundId: r.id, rowId: row.id, columnId: cell.columnId }); continue; }
        if (row.categoryId && q.categoryId !== row.categoryId) errors.push({ kind: 'cell-wrong-category', roundId: r.id, rowId: row.id, columnId: cell.columnId });
        if (q.type !== 'text' && (!q.media || !mediaExists(q.media))) errors.push({ kind: 'cell-missing-media', roundId: r.id, rowId: row.id, columnId: cell.columnId });
      }
    }
  }
  for (const [questionId, count] of questionUses) {
    if (count > 1) warnings.push({ kind: 'dup-question', questionId });
  }
  return { errors, warnings };
}
```

- [ ] **Step 4: Run, verify PASS** — `npm test -- templateValidate` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/packs/templateValidate.ts src/packs/templateValidate.test.ts
git commit -m "feat(2b): strict-валидация публикации (вкл. наличие медиа)"
```

---

### Task 6: Flatten шаблона в формат пака

**Files:**
- Create: `src/packs/templateFlatten.ts`
- Test: `src/packs/templateFlatten.test.ts`

**Interfaces:**
- Consumes: `GameTemplate`; `BankView`; `gameJsonSchema` из `./schema.js` (для проверки в тесте).
- Produces:
  - `interface MediaCopy { from: string; to: string }` (относительные пути от `mediaDir`)
  - `flattenTemplate(doc, bank): { game: unknown; mediaCopies: MediaCopy[] }`
  - `game` — объект формы `gameJsonSchema` (title/rounds/categories/questions). Вопросы в категории — по возрастанию `column.value`. `name` категории = `bank.categories.get(row.categoryId).name` (snapshot). `name` раунда и `title` — из документа (snapshot). Медиа-путь `bank/media/<f>` → `media/<f>`; для каждого медиа — запись в `mediaCopies` (`from: 'bank/media/<f>'`, `to: 'media/<f>'`).
- Бросает `Error`, если встретит строку без категории или ячейку без валидного вопроса (предполагается предварительный `validateForPublish`).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { flattenTemplate } from './templateFlatten.js';
import { gameJsonSchema } from './schema.js';
import type { GameTemplate } from './templateTypes.js';
import type { BankView } from '../persistence/templateRepo.js';

function bank(): BankView {
  return {
    categories: new Map([['c1', { id: 'c1', name: 'Кино' }]]),
    questions: new Map([
      ['q1', { id: 'q1', categoryId: 'c1', type: 'text', prompt: 'дешёвый', answer: 'a1', media: null }],
      ['q2', { id: 'q2', categoryId: 'c1', type: 'image', prompt: 'дорогой', answer: 'a2', media: 'bank/media/x.png' }],
    ]),
  };
}
function doc(): GameTemplate {
  return {
    id: 't', title: 'Игра',
    rounds: [{
      id: 'r1', name: 'Раунд 1',
      columns: [{ id: 'k2', value: 300 }, { id: 'k1', value: 100 }],
      rows: [{ id: 'row1', categoryId: 'c1', cells: [
        { columnId: 'k2', questionId: 'q2', special: 'auction' },
        { columnId: 'k1', questionId: 'q1', special: 'none' },
      ] }],
    }],
  };
}

describe('flattenTemplate', () => {
  it('строит валидный для gameJsonSchema объект, вопросы по возрастанию цены', () => {
    const { game } = flattenTemplate(doc(), bank());
    expect(() => gameJsonSchema.parse(game)).not.toThrow();
    const cat = (game as any).rounds[0].categories[0];
    expect(cat.name).toBe('Кино');
    expect(cat.questions.map((q: any) => q.value)).toEqual([100, 300]);
    expect(cat.questions[0]).toMatchObject({ prompt: 'дешёвый', answer: 'a1', value: 100, special: 'none' });
    expect(cat.questions[1]).toMatchObject({ value: 300, special: 'auction', media: 'media/x.png' });
  });
  it('возвращает mediaCopies с переписанными путями', () => {
    const { mediaCopies } = flattenTemplate(doc(), bank());
    expect(mediaCopies).toEqual([{ from: 'bank/media/x.png', to: 'media/x.png' }]);
  });
  it('строка без категории → бросает', () => {
    const d = doc(); d.rounds[0].rows[0].categoryId = null;
    expect(() => flattenTemplate(d, bank())).toThrow();
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm test -- templateFlatten` → FAIL.

- [ ] **Step 3: Implement** — `src/packs/templateFlatten.ts`:

```ts
import type { GameTemplate } from './templateTypes.js';
import type { BankView } from '../persistence/templateRepo.js';

export interface MediaCopy { from: string; to: string }

export function flattenTemplate(doc: GameTemplate, bank: BankView): { game: unknown; mediaCopies: MediaCopy[] } {
  const mediaCopies: MediaCopy[] = [];
  const seenMedia = new Set<string>();

  const rounds = doc.rounds.map(r => {
    const valueByColumn = new Map(r.columns.map(c => [c.id, c.value]));
    const categories = r.rows.map(row => {
      if (!row.categoryId) throw new Error('строка без категории');
      const cat = bank.categories.get(row.categoryId);
      if (!cat) throw new Error(`категория не найдена: ${row.categoryId}`);
      const questions = row.cells
        .map(cell => {
          if (!cell.questionId) throw new Error('пустая ячейка');
          const q = bank.questions.get(cell.questionId);
          if (!q) throw new Error(`вопрос не найден: ${cell.questionId}`);
          const value = valueByColumn.get(cell.columnId);
          if (value === undefined) throw new Error(`столбец не найден: ${cell.columnId}`);
          let media: string | undefined;
          if (q.media) {
            media = q.media.replace(/^bank\/media\//, 'media/');
            if (!seenMedia.has(q.media)) { seenMedia.add(q.media); mediaCopies.push({ from: q.media, to: media }); }
          }
          return { type: q.type, prompt: q.prompt, answer: q.answer, value, special: cell.special, ...(media ? { media } : {}) };
        })
        .sort((a, b) => a.value - b.value);
      return { name: cat.name, questions };
    });
    return { name: r.name, categories };
  });

  return { game: { title: doc.title, rounds }, mediaCopies };
}
```

- [ ] **Step 4: Run, verify PASS** — `npm test -- templateFlatten` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/packs/templateFlatten.ts src/packs/templateFlatten.test.ts
git commit -m "feat(2b): flatten шаблона в формат пака"
```

---

### Task 7: HTTP CRUD-роуты + регистрация

**Files:**
- Create: `src/http/templates.ts`
- Modify: `src/http/server.ts` (добавить `broadcaster?` в `ServerDeps`, вызвать `registerTemplates`)
- Test: `src/http/templates.test.ts`

**Interfaces:**
- Consumes: `ServerDeps`, `requireAdmin`, репозиторий шаблонов.
- Produces: `registerTemplates(app, deps: ServerDeps): void`. Роуты (все за guard):
  - `GET /api/game-templates` → `listTemplates`
  - `POST /api/game-templates` body `{ template?: '5x5' }` → `{ id }`
  - `GET /api/game-templates/:id` → документ или 404
  - `PUT /api/game-templates/:id` body = документ → `{ ok: true }` или 404
  - `DELETE /api/game-templates/:id` → `{ ok: true }` или 404
- В `ServerDeps` добавить `broadcaster?: { broadcast: (gameId: string) => void }` (используется в Task 9).

- [ ] **Step 1: Failing test** — `src/http/templates.test.ts` (хелперы `makeDeps`/`authed` — как в `bank.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { buildServer } from './server.js';
import { openDb } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { config } from '../config.js';

function makeDeps() {
  const db = openDb(':memory:');
  return { store: new EventStore(db, 25), db, config: { ...config, mediaDir: 'data/test-tpl-media', adminPassword: 'secret' } };
}
async function authed(app: ReturnType<typeof buildServer>) {
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
  const c = login.cookies.find(x => x.name === 'svoya_admin')!;
  return `${c.name}=${c.value}`;
}

describe('game-templates CRUD', () => {
  it('401 без куки', async () => {
    const app = buildServer(makeDeps());
    expect((await app.inject({ method: 'GET', url: '/api/game-templates' })).statusCode).toBe(401);
    await app.close();
  });
  it('create → get → list → delete', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const create = await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: { template: '5x5' } });
    expect(create.statusCode).toBe(200);
    const id = create.json().id as string;

    const get = await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } });
    expect(get.json().rounds[0].columns).toHaveLength(5);

    const list = await app.inject({ method: 'GET', url: '/api/game-templates', headers: { cookie } });
    expect(list.json()[0].id).toBe(id);

    const del = await app.inject({ method: 'DELETE', url: `/api/game-templates/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).statusCode).toBe(404);
    await app.close();
  });
  it('PUT сохраняет документ', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const id = (await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: {} })).json().id;
    const doc = (await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).json();
    doc.title = 'Новое имя';
    const put = await app.inject({ method: 'PUT', url: `/api/game-templates/${id}`, headers: { cookie }, payload: doc });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).json().title).toBe('Новое имя');
    await app.close();
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm test -- templates.test` → FAIL.

- [ ] **Step 3: Implement** — `src/http/templates.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from './server.js';
import { requireAdmin } from './auth.js';
import { createTemplate, getTemplate, listTemplates, saveTemplate, deleteTemplate } from '../persistence/templateRepo.js';
import type { GameTemplate } from '../packs/templateTypes.js';

export function registerTemplates(app: FastifyInstance, deps: ServerDeps): void {
  const { db } = deps;
  const guard = { preHandler: requireAdmin };

  app.get('/api/game-templates', guard, async () => listTemplates(db));

  app.post('/api/game-templates', guard, async (req) => {
    const { template } = (req.body ?? {}) as { template?: '5x5' };
    return createTemplate(db, { template: template === '5x5' ? '5x5' : undefined });
  });

  app.get('/api/game-templates/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = getTemplate(db, id);
    if (!doc) return reply.code(404).send({ error: 'шаблон не найден' });
    return doc;
  });

  app.put('/api/game-templates/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = req.body as GameTemplate;
    if (!saveTemplate(db, id, doc)) return reply.code(404).send({ error: 'шаблон не найден' });
    return { ok: true };
  });

  app.delete('/api/game-templates/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteTemplate(db, id)) return reply.code(404).send({ error: 'шаблон не найден' });
    return { ok: true };
  });
}
```

- [ ] **Step 4: Wire** — в `src/http/server.ts`: расширь `ServerDeps` и зарегистрируй роуты:

```ts
// в интерфейсе ServerDeps добавь:
broadcaster?: { broadcast: (gameId: string) => void };

// импорт сверху:
import { registerTemplates } from './templates.js';
// в buildServer, рядом с registerBank(app, deps):
registerTemplates(app, deps);
```

- [ ] **Step 5: Run, verify PASS** — `npm test -- templates.test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/http/templates.ts src/http/server.ts src/http/templates.test.ts
git commit -m "feat(2b): HTTP CRUD-роуты шаблонов игр"
```

---

### Task 8: Роут preflight

**Files:**
- Modify: `src/http/templates.ts`
- Test: `src/http/templates.test.ts`

**Interfaces:**
- Produces: `GET /api/game-templates/:id/publish/preflight` → `{ published: boolean; referencingGames: number }`.
  - `published` = задан ли `lastPublishedPackId`.
  - `referencingGames` = число игр, у которых событие `GAME_CREATED` с этим packId и текущая фаза ≠ `GAME_END`.
- Хелпер `findActiveGameIds(deps, packId): string[]` экспортируется (используется в Task 9).

- [ ] **Step 1: Failing test** — добавь в `templates.test.ts`:

```ts
import { makeEvent } from '../domain/events.js';

it('preflight: published=false без публикации, 0 игр', async () => {
  const deps = makeDeps();
  const app = buildServer(deps);
  const cookie = await authed(app);
  const id = (await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: {} })).json().id;
  const pf = await app.inject({ method: 'GET', url: `/api/game-templates/${id}/publish/preflight`, headers: { cookie } });
  expect(pf.json()).toEqual({ published: false, referencingGames: 0 });
  await app.close();
});

it('preflight считает только активные игры на packId', async () => {
  const deps = makeDeps();
  const app = buildServer(deps);
  const cookie = await authed(app);
  // шаблон с уже опубликованным packId
  const id = (await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: {} })).json().id;
  const doc = (await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).json();
  doc.lastPublishedPackId = 'pack1';
  await app.inject({ method: 'PUT', url: `/api/game-templates/${id}`, headers: { cookie }, payload: doc });
  // активная игра на pack1
  deps.store.append('g1', makeEvent('GAME_CREATED', { gameId: 'g1', packId: 'pack1', title: 'T', teamCount: 3 }));
  // завершённая игра на pack1
  deps.store.append('g2', makeEvent('GAME_CREATED', { gameId: 'g2', packId: 'pack1', title: 'T', teamCount: 3 }));
  deps.store.append('g2', makeEvent('GAME_ENDED', {}));
  const pf = await app.inject({ method: 'GET', url: `/api/game-templates/${id}/publish/preflight`, headers: { cookie } });
  expect(pf.json()).toEqual({ published: true, referencingGames: 1 });
  await app.close();
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm test -- templates.test` → FAIL (404 на preflight).

- [ ] **Step 3: Implement** — добавь в `templates.ts`:

```ts
export function findActiveGameIds(deps: ServerDeps, packId: string): string[] {
  const rows = deps.db.prepare("SELECT game_id, payload FROM events WHERE type = 'GAME_CREATED'")
    .all() as Array<{ game_id: string; payload: string }>;
  const ids: string[] = [];
  for (const row of rows) {
    const payload = JSON.parse(row.payload) as { packId: string };
    if (payload.packId !== packId) continue;
    if (deps.store.loadState(row.game_id).phase !== 'GAME_END') ids.push(row.game_id);
  }
  return ids;
}
```

и роут внутри `registerTemplates` (используй замыкание на `deps`):

```ts
app.get('/api/game-templates/:id/publish/preflight', guard, async (req, reply) => {
  const { id } = req.params as { id: string };
  const doc = getTemplate(db, id);
  if (!doc) return reply.code(404).send({ error: 'шаблон не найден' });
  const packId = doc.lastPublishedPackId;
  return {
    published: !!packId,
    referencingGames: packId ? findActiveGameIds(deps, packId).length : 0,
  };
});
```

- [ ] **Step 4: Run, verify PASS** — `npm test -- templates.test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/http/templates.ts src/http/templates.test.ts
git commit -m "feat(2b): preflight публикации (счёт активных игр)"
```

---

### Task 9: Роут publish (валидация → flatten → пак → копия медиа → форс-завершение)

**Files:**
- Modify: `src/http/templates.ts`
- Modify: `src/index.ts` (обвязка broadcaster)
- Test: `src/http/templates.test.ts`

**Interfaces:**
- Consumes: `validateForPublish`, `flattenTemplate`, `loadBankView`, `parseGameJson`, `findActiveGameIds`, `makeEvent`.
- Produces: `POST /api/game-templates/:id/publish` body `{ mode: 'new' | 'overwrite' }` →
  - валидация: ошибки → `400 { error, problems }`;
  - packId: `new` → `crypto.randomUUID()`; `overwrite` → `doc.lastPublishedPackId` (400 если не задан);
  - flatten → `parseGameJson(game)` → `pack.id = packId` → `INSERT OR REPLACE INTO packs`;
  - копирование медиа: `{mediaDir}/{from}` → `{mediaDir}/{packId}/{to}`;
  - форс-завершение всех активных игр на этом packId: append `GAME_ENDED`, затем `deps.broadcaster?.broadcast(gameId)`;
  - `doc.lastPublishedPackId = packId`, `saveTemplate`;
  - ответ `{ packId }`.

- [ ] **Step 1: Failing test** — добавь в `templates.test.ts`:

```ts
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

async function makeValidTemplate(app: ReturnType<typeof buildServer>, cookie: string, db: any) {
  // банк: категория + текстовый вопрос
  db.prepare('INSERT INTO bank_categories (id,name,position) VALUES (?,?,?)').run('c1', 'Кино', 1);
  db.prepare('INSERT INTO bank_questions (id,category_id,type,prompt,answer,media,position) VALUES (?,?,?,?,?,?,?)')
    .run('q1', 'c1', 'text', 'вопрос', 'ответ', null, 1);
  const id = (await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: {} })).json().id;
  const doc = (await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).json();
  doc.title = 'Игра';
  doc.rounds[0].columns = [{ id: 'k1', value: 100 }];
  doc.rounds[0].rows = [{ id: 'row1', categoryId: 'c1', cells: [{ columnId: 'k1', questionId: 'q1', special: 'none' }] }];
  await app.inject({ method: 'PUT', url: `/api/game-templates/${id}`, headers: { cookie }, payload: doc });
  return id;
}

it('publish невалидного → 400 с problems', async () => {
  const deps = makeDeps();
  const app = buildServer(deps);
  const cookie = await authed(app);
  const id = (await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: { template: '5x5' } })).json().id;
  const res = await app.inject({ method: 'POST', url: `/api/game-templates/${id}/publish`, headers: { cookie }, payload: { mode: 'new' } });
  expect(res.statusCode).toBe(400);
  expect(res.json().problems.length).toBeGreaterThan(0);
  await app.close();
});

it('publish валидного (new) пишет пак и возвращает packId', async () => {
  const deps = makeDeps();
  const app = buildServer(deps);
  const cookie = await authed(app);
  const id = await makeValidTemplate(app, cookie, deps.db);
  const res = await app.inject({ method: 'POST', url: `/api/game-templates/${id}/publish`, headers: { cookie }, payload: { mode: 'new' } });
  expect(res.statusCode).toBe(200);
  const packId = res.json().packId as string;
  expect(deps.db.prepare('SELECT id FROM packs WHERE id=?').get(packId)).toBeTruthy();
  // lastPublishedPackId сохранён
  expect((await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).json().lastPublishedPackId).toBe(packId);
  await app.close();
});

it('publish (overwrite) форс-завершает активную игру', async () => {
  const deps = makeDeps();
  const ended: string[] = [];
  deps.broadcaster = { broadcast: (g: string) => ended.push(g) };
  const app = buildServer(deps);
  const cookie = await authed(app);
  const id = await makeValidTemplate(app, cookie, deps.db);
  const packId = (await app.inject({ method: 'POST', url: `/api/game-templates/${id}/publish`, headers: { cookie }, payload: { mode: 'new' } })).json().packId;
  deps.store.append('gLive', makeEvent('GAME_CREATED', { gameId: 'gLive', packId, title: 'T', teamCount: 3 }));
  const res = await app.inject({ method: 'POST', url: `/api/game-templates/${id}/publish`, headers: { cookie }, payload: { mode: 'overwrite' } });
  expect(res.statusCode).toBe(200);
  expect(deps.store.loadState('gLive').phase).toBe('GAME_END');
  expect(ended).toContain('gLive');
  await app.close();
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm test -- templates.test` → FAIL.

- [ ] **Step 3: Implement** — добавь импорты и роут в `templates.ts`:

```ts
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { loadBankView } from '../persistence/templateRepo.js';
import { validateForPublish } from '../packs/templateValidate.js';
import { flattenTemplate } from '../packs/templateFlatten.js';
import { parseGameJson } from '../packs/schema.js';
import { makeEvent } from '../domain/events.js';
```

```ts
app.post('/api/game-templates/:id/publish', guard, async (req, reply) => {
  const { id } = req.params as { id: string };
  const { mode } = (req.body ?? {}) as { mode?: 'new' | 'overwrite' };
  const doc = getTemplate(db, id);
  if (!doc) return reply.code(404).send({ error: 'шаблон не найден' });

  const bank = loadBankView(db);
  const mediaRoot = resolve(deps.config.mediaDir);
  const mediaExists = (rel: string) => existsSync(join(mediaRoot, rel));
  const { errors } = validateForPublish(doc, bank, mediaExists);
  if (errors.length) return reply.code(400).send({ error: 'есть незаполненные/невалидные поля', problems: errors });

  if (mode === 'overwrite' && !doc.lastPublishedPackId) return reply.code(400).send({ error: 'нет ранее опубликованного пака' });
  const packId = mode === 'overwrite' ? doc.lastPublishedPackId! : crypto.randomUUID();

  const { game, mediaCopies } = flattenTemplate(doc, bank);
  const pack = parseGameJson(game);
  pack.id = packId;
  db.prepare('INSERT OR REPLACE INTO packs (id,data) VALUES (?,?)').run(packId, JSON.stringify(pack));

  for (const { from, to } of mediaCopies) {
    const dest = join(mediaRoot, packId, to);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(mediaRoot, from), dest);
  }

  for (const gameId of findActiveGameIds(deps, packId)) {
    deps.store.append(gameId, makeEvent('GAME_ENDED', {}));
    deps.broadcaster?.broadcast(gameId);
  }

  doc.lastPublishedPackId = packId;
  saveTemplate(db, id, doc);
  return { packId };
});
```

- [ ] **Step 4: Wire broadcaster** — в `src/index.ts` замени блок построения сервера на:

```ts
const gatewayDeps = { store, db, sessions, config };
const broadcaster = { broadcast: (_gameId: string) => {} };
const app = buildServer({ store, db, config, broadcaster });

await app.ready();
const io = new Server(app.server, { cors: { origin: true } });
attachGateway(io, gatewayDeps);
broadcaster.broadcast = (gameId: string) => broadcastState(io, gatewayDeps, gameId);
```

и добавь импорт `broadcastState`:

```ts
import { attachGateway, broadcastState } from './realtime/gateway.js';
```

- [ ] **Step 5: Run, verify PASS** — `npm test -- templates.test` → PASS. Затем `npm test` (весь сервер) → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/http/templates.ts src/index.ts src/http/templates.test.ts
git commit -m "feat(2b): публикация шаблона + форс-завершение активных игр"
```

---

### Task 10: Сборка сервера + типчек

**Files:** — без новых; проверка целостности.

- [ ] **Step 1: Build** — `npm run build`. Expected: tsc без ошибок. Если `ServerDeps` не экспортируется — добавь `export` к интерфейсу.
- [ ] **Step 2: Full test** — `npm test`. Expected: все серверные тесты PASS.
- [ ] **Step 3: Commit** (если были правки типов)

```bash
git add -A && git commit -m "chore(2b): типчек и сборка серверной части"
```

---

### Task 11: Веб — API-клиент шаблонов

**Files:**
- Create: `web/src/admin/templateApi.ts`
- Test: `web/src/admin/templateApi.test.ts`

**Interfaces:**
- Consumes: паттерн `bankApi.ts` (`jsonOf`, `jsonHeaders`).
- Produces (типы зеркалят серверные `GameTemplate`/`Problem`):
  - `listTemplates(): Promise<{id;title;updatedAt}[]>`
  - `createTemplate(template?: '5x5'): Promise<{id}>`
  - `getTemplate(id): Promise<GameTemplate>`
  - `saveTemplate(id, doc): Promise<unknown>`
  - `deleteTemplate(id): Promise<unknown>`
  - `preflight(id): Promise<{published;referencingGames}>`
  - `publish(id, mode): Promise<{packId}>` (бросает с `problems` при 400 — через `jsonOf`-расширение)
  - `createGame(packId, title, teamCount): Promise<{gameId}>` (POST `/api/games`)
  - реэкспорт типов `GameTemplate`, `Problem` из локального `lib/templateTypes` (см. Task 12).

- [ ] **Step 1: Failing test** — `templateApi.test.ts` (smoke на URL-сборку через мок fetch):

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as api from './templateApi.js';

afterEach(() => vi.restoreAllMocks());

describe('templateApi', () => {
  it('createGame шлёт POST /api/games с телом', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ gameId: 'g1' }), { status: 200 }));
    const r = await api.createGame('pack1', 'Игра', 3);
    expect(r).toEqual({ gameId: 'g1' });
    expect(spy.mock.calls[0][0]).toBe('/api/games');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `cd web && npm test -- templateApi` → FAIL.

- [ ] **Step 3: Implement** — `web/src/admin/templateApi.ts`:

```ts
import type { GameTemplate } from './lib/templateTypes.js';

async function jsonOf(r: Response): Promise<any> {
  if (!r.ok) {
    const body = await r.json().catch(() => undefined) as { error?: string; problems?: unknown } | undefined;
    const err = new Error(body?.error ?? `HTTP ${r.status}`) as Error & { problems?: unknown };
    err.problems = body?.problems;
    throw err;
  }
  return r.json();
}
const jsonHeaders = { 'content-type': 'application/json' };

export const listTemplates = (): Promise<{ id: string; title: string; updatedAt: number }[]> =>
  fetch('/api/game-templates').then(jsonOf);
export const createTemplate = (template?: '5x5'): Promise<{ id: string }> =>
  fetch('/api/game-templates', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ template }) }).then(jsonOf);
export const getTemplate = (id: string): Promise<GameTemplate> =>
  fetch(`/api/game-templates/${id}`).then(jsonOf);
export const saveTemplate = (id: string, doc: GameTemplate): Promise<unknown> =>
  fetch(`/api/game-templates/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(doc) }).then(jsonOf);
export const deleteTemplate = (id: string): Promise<unknown> =>
  fetch(`/api/game-templates/${id}`, { method: 'DELETE' }).then(jsonOf);
export const preflight = (id: string): Promise<{ published: boolean; referencingGames: number }> =>
  fetch(`/api/game-templates/${id}/publish/preflight`).then(jsonOf);
export const publish = (id: string, mode: 'new' | 'overwrite'): Promise<{ packId: string }> =>
  fetch(`/api/game-templates/${id}/publish`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ mode }) }).then(jsonOf);
export const createGame = (packId: string, title: string, teamCount: number): Promise<{ gameId: string }> =>
  fetch('/api/games', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ packId, title, teamCount }) }).then(jsonOf);
```

- [ ] **Step 4: Run, verify PASS** — `cd web && npm test -- templateApi` → PASS (Task 12 создаст `lib/templateTypes`; если типчек ругается раньше — выполни Task 12 первым, порядок 11/12 взаимозаменяем).

- [ ] **Step 5: Commit**

```bash
git add web/src/admin/templateApi.ts web/src/admin/templateApi.test.ts
git commit -m "feat(2b/web): API-клиент шаблонов"
```

---

### Task 12: Веб — типы + клиентский валидатор-зеркало

**Files:**
- Create: `web/src/admin/lib/templateTypes.ts` (копия серверных типов документа + `Problem`)
- Create: `web/src/admin/lib/templateValidate.ts`
- Test: `web/src/admin/lib/templateValidate.test.ts`

**Interfaces:**
- Produces:
  - `lib/templateTypes.ts` — те же `SpecialTag/TemplateColumn/TemplateCell/TemplateRow/TemplateRound/GameTemplate` и `Problem`, что на сервере (без серверных зависимостей).
  - `lib/templateValidate.ts`:
    - `interface BankClientView { categories: Set<string>; questionCategory: Map<string, string> }` (id категорий + categoryId каждого вопроса).
    - `validateClient(doc: GameTemplate, bank: BankClientView): { errors: Problem[]; warnings: Problem[] }` — зеркало серверной структуры/предупреждений **без** проверки наличия медиа-файла (её делает сервер при публикации).
    - `summarize(errors: Problem[]): { rowsNoCategory: number; emptyCells: number }` — для плашки «Что мешает опубликовать».

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateClient, summarize, type BankClientView } from './templateValidate.js';
import type { GameTemplate } from './templateTypes.js';

const bank: BankClientView = { categories: new Set(['c1']), questionCategory: new Map([['q1', 'c1'], ['qX', 'cX']]) };
function doc(): GameTemplate {
  return { id: 't', title: 'Игра', rounds: [{ id: 'r', name: 'Раунд 1',
    columns: [{ id: 'k1', value: 100 }],
    rows: [{ id: 'row1', categoryId: 'c1', cells: [{ columnId: 'k1', questionId: 'q1', special: 'none' }] }] }] };
}

describe('validateClient', () => {
  it('валидный → нет ошибок', () => { expect(validateClient(doc(), bank).errors).toEqual([]); });
  it('пустая ячейка и строка без категории учитываются в summarize', () => {
    const d = doc(); d.rounds[0].rows[0].categoryId = null; d.rounds[0].rows[0].cells[0].questionId = null;
    const { errors } = validateClient(d, bank);
    const s = summarize(errors);
    expect(s.rowsNoCategory).toBe(1);
    expect(s.emptyCells).toBe(1);
  });
  it('чужая категория → cell-wrong-category', () => {
    const d = doc(); d.rounds[0].rows[0].cells[0].questionId = 'qX';
    expect(validateClient(d, bank).errors.some(e => e.kind === 'cell-wrong-category')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `cd web && npm test -- templateValidate` → FAIL.

- [ ] **Step 3: Implement** — `lib/templateTypes.ts` (типы — копия из «Канонические типы» + `Problem` из Task 5, без серверных импортов), затем `lib/templateValidate.ts`:

```ts
import type { GameTemplate, Problem } from './templateTypes.js';

export interface BankClientView { categories: Set<string>; questionCategory: Map<string, string> }

export function validateClient(doc: GameTemplate, bank: BankClientView): { errors: Problem[]; warnings: Problem[] } {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  if (!doc.title.trim()) errors.push({ kind: 'no-title' });
  const uses = new Map<string, number>();
  for (const r of doc.rounds) {
    if (!r.name.trim()) errors.push({ kind: 'round-no-name', roundId: r.id });
    if (r.columns.length === 0) errors.push({ kind: 'round-no-columns', roundId: r.id });
    if (r.rows.length === 0) errors.push({ kind: 'round-no-rows', roundId: r.id });
    for (const col of r.columns) if (!Number.isInteger(col.value) || col.value <= 0) errors.push({ kind: 'bad-value', roundId: r.id, columnId: col.id });
    const seen = new Set<number>();
    for (const col of r.columns) { if (seen.has(col.value)) warnings.push({ kind: 'dup-value', roundId: r.id, value: col.value }); seen.add(col.value); }
    for (const row of r.rows) {
      if (!row.categoryId) errors.push({ kind: 'row-no-category', roundId: r.id, rowId: row.id });
      else if (!bank.categories.has(row.categoryId)) errors.push({ kind: 'row-bad-category', roundId: r.id, rowId: row.id });
      for (const cell of row.cells) {
        if (!cell.questionId) { errors.push({ kind: 'cell-empty', roundId: r.id, rowId: row.id, columnId: cell.columnId }); continue; }
        uses.set(cell.questionId, (uses.get(cell.questionId) ?? 0) + 1);
        const cat = bank.questionCategory.get(cell.questionId);
        if (cat === undefined) errors.push({ kind: 'cell-bad-question', roundId: r.id, rowId: row.id, columnId: cell.columnId });
        else if (row.categoryId && cat !== row.categoryId) errors.push({ kind: 'cell-wrong-category', roundId: r.id, rowId: row.id, columnId: cell.columnId });
      }
    }
  }
  for (const [questionId, c] of uses) if (c > 1) warnings.push({ kind: 'dup-question', questionId });
  return { errors, warnings };
}

export function summarize(errors: Problem[]): { rowsNoCategory: number; emptyCells: number } {
  return {
    rowsNoCategory: errors.filter(e => e.kind === 'row-no-category').length,
    emptyCells: errors.filter(e => e.kind === 'cell-empty').length,
  };
}
```

- [ ] **Step 4: Run, verify PASS** — `cd web && npm test -- templateValidate` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/admin/lib/templateTypes.ts web/src/admin/lib/templateValidate.ts web/src/admin/lib/templateValidate.test.ts
git commit -m "feat(2b/web): типы и клиентский валидатор-зеркало"
```

---

### Task 13: Веб — draft-store с debounced-автосейвом и flush

**Files:**
- Create: `web/src/admin/lib/templateDraft.ts`
- Test: `web/src/admin/lib/templateDraft.test.ts`

**Interfaces:**
- Produces: `createDraft(id, initial: GameTemplate, save: (doc) => Promise<unknown>, delayMs = 400)` →
  - `doc: Writable<GameTemplate>` (svelte store)
  - `status: Writable<'idle'|'saving'|'saved'>`
  - `touch(): void` — пометить изменение, запланировать debounced-сохранение
  - `flush(): Promise<void>` — немедленно сохранить (для публикации/теста), отменив таймер
- Использует `setTimeout`/`clearTimeout`. `save` инъектируется (тестируемо без сети).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { createDraft } from './templateDraft.js';
import type { GameTemplate } from './templateTypes.js';

const tpl: GameTemplate = { id: 't', title: 'Игра', rounds: [] };

describe('templateDraft', () => {
  it('flush сохраняет немедленно и ставит saved', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const d = createDraft('t', tpl, save, 400);
    d.touch();
    await d.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(get(d.status)).toBe('saved');
  });
  it('debounced touch вызывает save один раз', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const d = createDraft('t', tpl, save, 400);
    d.touch(); d.touch(); d.touch();
    await vi.advanceTimersByTimeAsync(400);
    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `cd web && npm test -- templateDraft` → FAIL.

- [ ] **Step 3: Implement** — `web/src/admin/lib/templateDraft.ts`:

```ts
import { writable, get, type Writable } from 'svelte/store';
import type { GameTemplate } from './templateTypes.js';

export function createDraft(
  id: string,
  initial: GameTemplate,
  save: (doc: GameTemplate) => Promise<unknown>,
  delayMs = 400,
) {
  const doc: Writable<GameTemplate> = writable(initial);
  const status = writable<'idle' | 'saving' | 'saved'>('idle');
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function persist() {
    status.set('saving');
    try { await save(get(doc)); status.set('saved'); }
    catch { status.set('idle'); }
  }
  function touch() {
    status.set('saving');
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, delayMs);
  }
  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    await persist();
  }
  return { doc, status, touch, flush };
}
```

- [ ] **Step 4: Run, verify PASS** — `cd web && npm test -- templateDraft` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/admin/lib/templateDraft.ts web/src/admin/lib/templateDraft.test.ts
git commit -m "feat(2b/web): draft-store с debounced-автосейвом и flush"
```

---

### Task 14: Веб — экран «Список игр»

**Files:**
- Modify: `web/src/admin/sections/Builder.svelte`
- Create: `web/src/admin/sections/builder/GameEditor.svelte` (пока заглушка-обёртка; наполняется в Task 15–18)

**Interfaces:**
- `Builder.svelte`: локальное состояние `view: 'list' | 'edit'`, `editingId: string | null`. Список через `templateApi.listTemplates`. Кнопки: «Пустая», «5×5», открыть (клик по карточке), удалить (иконка-мусорка из паттерна 2a, через `Modal` подтверждение). Открытие → `view='edit'`.
- `GameEditor.svelte` props: `export let id: string;`, событие `back`.

- [ ] **Step 1: Implement GameEditor.svelte (заглушка)**:

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let id: string;
  const dispatch = createEventDispatcher<{ back: void }>();
</script>

<header class="bar">
  <button class="ghost" on:click={() => dispatch('back')}>← Список игр</button>
  <span class="muted">Редактор игры {id}</span>
</header>

<style>
  .bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .muted { color: var(--text-2); }
</style>
```

- [ ] **Step 2: Implement Builder.svelte**:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import * as api from '../templateApi.js';
  import Modal from './Modal.svelte';
  import GameEditor from './builder/GameEditor.svelte';

  let view: 'list' | 'edit' = 'list';
  let editingId: string | null = null;
  let games: { id: string; title: string; updatedAt: number }[] = [];
  let deleting: { id: string; title: string } | null = null;

  async function reload() { games = await api.listTemplates(); }
  onMount(reload);

  async function create(template?: '5x5') {
    const { id } = await api.createTemplate(template);
    open(id);
  }
  function open(id: string) { editingId = id; view = 'edit'; }
  async function confirmDelete() {
    if (!deleting) return;
    await api.deleteTemplate(deleting.id);
    deleting = null;
    await reload();
  }
  async function back() { view = 'list'; editingId = null; await reload(); }
</script>

{#if view === 'edit' && editingId}
  <GameEditor id={editingId} on:back={back} />
{:else}
  <section>
    <header class="head">
      <h1>Конструктор</h1>
      <div class="actions">
        <button class="ghost" on:click={() => create()}>Пустая игра</button>
        <button class="primary" on:click={() => create('5x5')}>Новая 5×5</button>
      </div>
    </header>

    {#if games.length === 0}
      <p class="muted">Пока нет игр. Создайте пустую или 5×5.</p>
    {:else}
      <ul class="games">
        {#each games as g (g.id)}
          <li>
            <button class="card" on:click={() => open(g.id)}>{g.title}</button>
            <button class="icon del" title="Удалить" on:click={() => (deleting = { id: g.id, title: g.title })}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor">
                <path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>
              </svg>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if deleting}
    <Modal title="Удалить игру?" on:close={() => (deleting = null)}>
      <p>«{deleting.title}» будет удалена безвозвратно.</p>
      <div class="modal-actions">
        <button class="ghost" on:click={() => (deleting = null)}>Отмена</button>
        <button class="primary" on:click={confirmDelete}>Удалить</button>
      </div>
    </Modal>
  {/if}
{/if}

<style>
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  h1 { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .02em; margin: 0; }
  .actions { display: flex; gap: 8px; }
  .muted { color: var(--text-2); }
  .games { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .games li { display: flex; gap: 8px; align-items: center; }
  .card { flex: 1; text-align: left; padding: 14px 16px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-card); color: var(--text); font-family: var(--font-display); font-size: 16px; cursor: pointer; }
  .card:hover { background: var(--cell-hover); }
  .icon.del { background: none; border: none; color: var(--text-2); cursor: pointer; padding: 8px; }
  .icon.del:hover { color: var(--err); }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
</style>
```

- [ ] **Step 3: Verify** — `cd web && npx svelte-check` → без новых ошибок. `npm run build` → успех.

- [ ] **Step 4: Commit**

```bash
git add web/src/admin/sections/Builder.svelte web/src/admin/sections/builder/GameEditor.svelte
git commit -m "feat(2b/web): экран «Список игр»"
```

---

### Task 15: Веб — редактор-сетка (эхо Matrix): столбцы, цены, +/−

**Files:**
- Create: `web/src/admin/sections/builder/RoundGrid.svelte`
- Modify: `web/src/admin/sections/builder/GameEditor.svelte` (загрузка документа, draft-store, вкладки раундов, монтирование RoundGrid)

**Interfaces:**
- `GameEditor` загружает документ (`api.getTemplate`), создаёт draft (`createDraft(id, doc, d => api.saveTemplate(id, d))`), показывает инлайн-инпут названия + индикатор автосейва + вкладки раундов («+ Раунд»). Любая мутация документа → `draft.touch()`.
- `RoundGrid` props: `export let round: TemplateRound;` + событие `change` (вызывается после любой мутации, чтобы GameEditor сделал `touch`). Рендер: заголовки-столбцы с золотым числовым инпутом цены + кнопка «−» на столбец, кнопка «+ столбец»; строки (левая ячейка-категория + ячейки); «+ Строка». Цена: ввод кратно 100 (`step=100 min=100`), при изменении — обновить `column.value`.
- Авто-цена нового столбца: `(maxValueInRound) + 100` либо `100*(index+1)` если пусто (формула «шаг × номер»; для простоты — следующий кратный 100 после максимума). При добавлении столбца — добавить ячейку (`questionId:null, special:'none'`) в каждую строку (сетка прямоугольная). При удалении столбца — удалить соответствующие ячейки во всех строках.

- [ ] **Step 1: Implement RoundGrid.svelte**:

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { TemplateRound, TemplateRow } from '../../lib/templateTypes.js';
  export let round: TemplateRound;
  const dispatch = createEventDispatcher<{ change: void }>();
  const uid = () => crypto.randomUUID();
  const changed = () => { round = round; dispatch('change'); };

  function addColumn() {
    const max = round.columns.reduce((m, c) => Math.max(m, c.value), 0);
    const col = { id: uid(), value: max + 100 || 100 };
    round.columns = [...round.columns, col];
    round.rows = round.rows.map(r => ({ ...r, cells: [...r.cells, { columnId: col.id, questionId: null, special: 'none' as const }] }));
    changed();
  }
  function removeColumn(colId: string) {
    round.columns = round.columns.filter(c => c.id !== colId);
    round.rows = round.rows.map(r => ({ ...r, cells: r.cells.filter(c => c.columnId !== colId) }));
    changed();
  }
  function setValue(colId: string, v: number) {
    const col = round.columns.find(c => c.id === colId);
    if (col) { col.value = v; changed(); }
  }
  function addRow() {
    const row: TemplateRow = { id: uid(), categoryId: null, cells: round.columns.map(c => ({ columnId: c.id, questionId: null, special: 'none' })) };
    round.rows = [...round.rows, row];
    changed();
  }
  function removeRow(rowId: string) { round.rows = round.rows.filter(r => r.id !== rowId); changed(); }
</script>

<div class="grid">
  <div class="row header" style="grid-template-columns:10rem repeat({round.columns.length}, 1fr) 2.5rem">
    <div class="corner">Категория</div>
    {#each round.columns as col (col.id)}
      <div class="colhead">
        <input class="price" type="number" min="100" step="100" value={col.value}
          on:input={(e) => setValue(col.id, Number((e.target as HTMLInputElement).value))} />
        <button class="mini" title="Убрать столбец" on:click={() => removeColumn(col.id)}>−</button>
      </div>
    {/each}
    <button class="mini add" title="Добавить столбец" on:click={addColumn}>+</button>
  </div>

  {#each round.rows as row (row.id)}
    <div class="row" style="grid-template-columns:10rem repeat({round.columns.length}, 1fr) 2.5rem">
      <div class="cat">
        {#if row.categoryId}<span>{row.categoryId}</span>{:else}<span class="dashed">Перетащите категорию</span>{/if}
        <button class="mini" title="Убрать строку" on:click={() => removeRow(row.id)}>−</button>
      </div>
      {#each row.cells as cell (cell.columnId)}
        <div class="cell">{cell.questionId ? '•' : ''}</div>
      {/each}
      <div></div>
    </div>
  {/each}

  <button class="addrow" on:click={addRow}>+ Строка</button>
</div>

<style>
  .grid { display: grid; gap: 8px; }
  .row { display: grid; gap: 8px; align-items: center; }
  .corner, .cat { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .03em;
    background: var(--grad-rowlabel); border: 1px solid var(--border); border-radius: var(--r-control);
    padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .dashed { color: var(--text-3); font-size: 13px; }
  .colhead { display: flex; gap: 4px; align-items: center; }
  .price { width: 100%; background: var(--cell); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--gold); font-family: var(--font-display); font-size: 20px; font-weight: 700; text-align: center; padding: 8px; }
  .cell { padding: 16px; background: var(--cell); border: 1px solid var(--border); border-radius: var(--r-control);
    min-height: 48px; color: var(--text-2); text-align: center; }
  .mini { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--text); width: 2.2rem; height: 2.2rem; cursor: pointer; font-size: 18px; }
  .mini:hover { background: var(--cell-hover); }
  .addrow { justify-self: start; background: var(--surface); border: 1px dashed var(--border);
    border-radius: var(--r-control); color: var(--text); padding: 10px 16px; cursor: pointer; }
</style>
```

- [ ] **Step 2: Implement GameEditor.svelte** (заменяет заглушку Task 14):

```svelte
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import * as api from '../../templateApi.js';
  import { createDraft } from '../../lib/templateDraft.js';
  import type { GameTemplate } from '../../lib/templateTypes.js';
  import RoundGrid from './RoundGrid.svelte';

  export let id: string;
  const dispatch = createEventDispatcher<{ back: void }>();
  const uid = () => crypto.randomUUID();

  let draft: ReturnType<typeof createDraft> | null = null;
  let docVal: GameTemplate | null = null;
  let status: 'idle' | 'saving' | 'saved' = 'idle';
  let activeRound = 0;

  onMount(async () => {
    const loaded = await api.getTemplate(id);
    draft = createDraft(id, loaded, d => api.saveTemplate(id, d));
    draft.doc.subscribe(v => (docVal = v));
    draft.status.subscribe(s => (status = s));
  });

  function touch() { draft?.doc.update(d => d); draft?.touch(); }
  function addRound() {
    draft?.doc.update(d => { d.rounds = [...d.rounds, { id: uid(), name: `Раунд ${d.rounds.length + 1}`, columns: [], rows: [] }]; return d; });
    activeRound = (docVal?.rounds.length ?? 1) - 1;
    draft?.touch();
  }
</script>

<header class="bar">
  <button class="ghost" on:click={() => dispatch('back')}>← Список игр</button>
  {#if docVal}
    <input class="title" bind:value={docVal.title} on:input={touch} />
    <span class="save save-{status}">{status === 'saving' ? 'Сохранение…' : status === 'saved' ? 'Сохранено ✓' : ''}</span>
  {/if}
</header>

{#if docVal}
  <nav class="tabs">
    {#each docVal.rounds as r, i (r.id)}
      <button class:active={i === activeRound} on:click={() => (activeRound = i)}>{r.name}</button>
    {/each}
    <button class="add" on:click={addRound}>+ Раунд</button>
  </nav>

  {#if docVal.rounds[activeRound]}
    <RoundGrid round={docVal.rounds[activeRound]} on:change={touch} />
  {/if}
{/if}

<style>
  .bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .title { flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--text); font-family: var(--font-display); font-size: 20px; padding: 8px 12px; }
  .save { color: var(--text-2); font-size: 13px; min-width: 9rem; }
  .save-saved { color: var(--ok); }
  .tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
  .tabs button { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--text); padding: 8px 14px; cursor: pointer; font-family: var(--font-display); }
  .tabs button.active { border-color: var(--accent); color: var(--accent); }
</style>
```

- [ ] **Step 3: Verify** — `cd web && npx svelte-check` без новых ошибок; `npm run build` успех.

- [ ] **Step 4: Commit**

```bash
git add web/src/admin/sections/builder/
git commit -m "feat(2b/web): редактор-сетка раунда (цены, +/− столбцов и строк)"
```

---

### Task 16: Веб — сайдбар «База · источник» + DnD категории/вопроса

**Files:**
- Create: `web/src/admin/sections/builder/SourceSidebar.svelte`
- Modify: `web/src/admin/sections/builder/GameEditor.svelte` (двухколоночный layout: сетка + сайдбар; прокидка bank-данных), `RoundGrid.svelte` (drop-зоны: категория → строка, вопрос → ячейка с ограничением по категории)

**Interfaces:**
- DnD через нативный HTML5 (паттерн 2a). Передача данных — через модульный стор `dragState` в `SourceSidebar.svelte`:
  - `export const drag = writable<{ kind: 'category'; id: string } | { kind: 'question'; id: string; categoryId: string } | null>(null);`
- `SourceSidebar` props: `export let bank: { categories: {id;name}[]; questions: {id;categoryId;type;prompt}[] };`. Рендер дерева: категория — draggable-карточка с грип-иконкой; под ней её вопросы — draggable-чипы с иконкой типа. `dragstart` пишет в `drag`, `dragend` чистит.
- `RoundGrid`:
  - левая ячейка строки: `on:dragover|preventDefault`, `on:drop` — если `drag.kind==='category'` → `row.categoryId = drag.id` и **очистка ячеек строки** (`questionId=null`), `changed()`.
  - ячейка: `on:dragover` — если `drag.kind==='question'` и `drag.categoryId===row.categoryId` → подсветка зелёная (класс `ok`), иначе красная (`bad`); `on:drop` — принять только своей категории (`cell.questionId = drag.id`), иначе игнор. `changed()`.
- `GameEditor` грузит банк: `bankApi.listCategories()` + вопросы по всем категориям (или новый агрегат). Для простоты — `listCategories` + `listQuestions(categoryId)` по каждой (или, если есть, единый endpoint). Построить плоский массив вопросов с `categoryId/type/prompt`.

- [ ] **Step 1: Implement SourceSidebar.svelte** (с экспортом `drag`):

```svelte
<script context="module" lang="ts">
  import { writable } from 'svelte/store';
  export type DragPayload =
    | { kind: 'category'; id: string }
    | { kind: 'question'; id: string; categoryId: string };
  export const drag = writable<DragPayload | null>(null);
</script>

<script lang="ts">
  export let bank: { categories: { id: string; name: string }[]; questions: { id: string; categoryId: string; type: string; prompt: string }[] };
  function qOf(catId: string) { return bank.questions.filter(q => q.categoryId === catId); }
</script>

<aside class="src">
  <h2>База · источник</h2>
  {#each bank.categories as c (c.id)}
    <div class="cat" draggable="true"
      on:dragstart={() => drag.set({ kind: 'category', id: c.id })}
      on:dragend={() => drag.set(null)}>
      <span class="grip" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/>
          <circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
        </svg>
      </span>
      {c.name}
    </div>
    <ul class="qs">
      {#each qOf(c.id) as q (q.id)}
        <li class="q" draggable="true"
          on:dragstart={() => drag.set({ kind: 'question', id: q.id, categoryId: c.id })}
          on:dragend={() => drag.set(null)}>
          <span class="type">{q.type === 'image' ? '🖼' : q.type === 'audio' ? '🔊' : 'A'}</span>
          {q.prompt.slice(0, 32) || '(без текста)'}
        </li>
      {/each}
    </ul>
  {/each}
</aside>

<style>
  .src { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 12px; overflow-y: auto; }
  h2 { font-family: var(--font-display); text-transform: uppercase; font-size: 14px; margin: 0 0 10px; color: var(--text-2); }
  .cat { display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: var(--grad-rowlabel);
    border: 1px solid var(--border); border-radius: var(--r-control); cursor: grab; font-family: var(--font-display); }
  .grip { color: var(--text-3); }
  .qs { list-style: none; margin: 4px 0 12px; padding: 0 0 0 12px; display: grid; gap: 4px; }
  .q { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: var(--cell); border: 1px solid var(--border);
    border-radius: var(--r-control); cursor: grab; font-size: 13px; }
  .type { color: var(--accent); font-weight: 700; }
</style>
```

- [ ] **Step 2: Wire RoundGrid drop-зоны** — в `RoundGrid.svelte` импортируй `drag` и добавь обработчики. Замени блок `.cat` и `.cell`:

```svelte
<script lang="ts">
  // ...существующее...
  import { drag } from './SourceSidebar.svelte';
  import { get } from 'svelte/store';

  let hover: { rowId: string; columnId: string; ok: boolean } | null = null;

  function dropCategory(row: TemplateRow) {
    const d = get(drag);
    if (d?.kind !== 'category') return;
    row.categoryId = d.id;
    row.cells = row.cells.map(c => ({ ...c, questionId: null, special: 'none' }));
    changed();
  }
  function overCell(row: TemplateRow, columnId: string) {
    const d = get(drag);
    if (d?.kind !== 'question') { hover = null; return; }
    hover = { rowId: row.id, columnId, ok: d.categoryId === row.categoryId };
  }
  function dropCell(row: TemplateRow, columnId: string) {
    const d = get(drag);
    if (d?.kind !== 'question' || d.categoryId !== row.categoryId) { hover = null; return; }
    const cell = row.cells.find(c => c.columnId === columnId);
    if (cell) cell.questionId = d.id;
    hover = null; changed();
  }
</script>
```

И в разметке строки:

```svelte
<div class="cat" on:dragover|preventDefault on:drop|preventDefault={() => dropCategory(row)}>
  {#if row.categoryId}<span>{row.categoryId}</span>{:else}<span class="dashed">Перетащите категорию</span>{/if}
  <button class="mini" title="Убрать строку" on:click={() => removeRow(row.id)}>−</button>
</div>
{#each row.cells as cell (cell.columnId)}
  <div class="cell"
    class:ok={hover?.rowId === row.id && hover?.columnId === cell.columnId && hover?.ok}
    class:bad={hover?.rowId === row.id && hover?.columnId === cell.columnId && !hover?.ok}
    on:dragover|preventDefault={() => overCell(row, cell.columnId)}
    on:dragleave={() => (hover = null)}
    on:drop|preventDefault={() => dropCell(row, cell.columnId)}>
    {cell.questionId ? '•' : ''}
  </div>
{/each}
```

Добавь в `<style>`: `.cell.ok { border-color: var(--ok); box-shadow: 0 0 0 2px var(--ok); } .cell.bad { border-color: var(--err); box-shadow: 0 0 0 2px var(--err); }`

- [ ] **Step 3: Wire GameEditor двухколоночный layout + загрузка банка** — в `GameEditor.svelte` добавь импорт `SourceSidebar` и `bankApi`, загрузи банк в `onMount`, оберни сетку и сайдбар в `.editor` grid (`grid-template-columns: 1fr 18rem`). Замени отображение `row.categoryId` на имя категории через map.

```ts
import * as bankApi from '../../bankApi.js';
import SourceSidebar from './SourceSidebar.svelte';
let bank = { categories: [] as {id:string;name:string}[], questions: [] as {id:string;categoryId:string;type:string;prompt:string}[] };
// в onMount после загрузки документа:
const cats = await bankApi.listCategories();
const qs = (await Promise.all(cats.map(c => bankApi.listQuestions(c.id)))).flat();
bank = { categories: cats.map(c => ({ id: c.id, name: c.name })),
  questions: qs.map(q => ({ id: q.id, categoryId: q.categoryId, type: q.type, prompt: q.prompt })) };
```

(Проверь точное имя `bankApi.listQuestions` — если иное, используй существующее; если массив вопросов отдаётся иначе, адаптируй маппинг.)

Прокинь `categoryName` в RoundGrid: добавь `export let categoryName: (id: string | null) => string;` и в `GameEditor` передай `categoryName={(cid) => bank.categories.find(c => c.id === cid)?.name ?? cid ?? ''}`; в RoundGrid замени `<span>{row.categoryId}</span>` на `<span>{categoryName(row.categoryId)}</span>`.

- [ ] **Step 4: Verify** — `cd web && npx svelte-check` без новых ошибок; `npm run build` успех.

- [ ] **Step 5: Commit**

```bash
git add web/src/admin/sections/builder/
git commit -m "feat(2b/web): сайдбар-источник и DnD категории/вопроса с ограничением по категории"
```

---

### Task 17: Веб — превью вопроса в ячейке, тег мини-игры, очистка

**Files:**
- Modify: `web/src/admin/sections/builder/RoundGrid.svelte`
- Modify: `web/src/admin/sections/builder/GameEditor.svelte` (прокинуть карту вопросов банка с media/type)

**Interfaces:**
- В ячейку с назначенным вопросом: превью — текст промпта (обрезка), для `image` — `<img>` тумба, для `audio` — `<audio controls>`. URL медиа — `bankApi.bankMediaUrl(media)`.
- Тег мини-игры по клику-циклу `none → cat → auction → none` — **только на ячейке с вопросом** (если `questionId` пуст — клик игнор). Метка: «Кот»/«Аукцион»/нет. Крестик очищает ячейку (`questionId=null, special='none'`).
- `GameEditor` прокидывает `questionInfo: (id: string) => { type: string; prompt: string; media: string | null } | undefined` (из bank.questions). Для media нужен `media` — добавь его в маппинг банка (Task 16 расширь `questions` полем `media`).

- [ ] **Step 1: Extend bank mapping** — в `GameEditor.svelte` добавь `media` в маппинг вопросов и проброс:

```ts
questions: qs.map(q => ({ id: q.id, categoryId: q.categoryId, type: q.type, prompt: q.prompt, media: q.media ?? null }))
// проброс:
// <RoundGrid ... questionInfo={(qid) => bank.questions.find(q => q.id === qid)} />
```

(добавь `media: string | null` в тип `bank.questions`)

- [ ] **Step 2: Implement cell content в RoundGrid.svelte** — добавь проп и логику:

```ts
import { bankMediaUrl } from '../../bankApi.js';
export let questionInfo: (id: string) => { type: string; prompt: string; media: string | null } | undefined;

const TAGS = ['none', 'cat', 'auction'] as const;
function cycleTag(cell: import('../../lib/templateTypes.js').TemplateCell) {
  if (!cell.questionId) return;
  cell.special = TAGS[(TAGS.indexOf(cell.special) + 1) % TAGS.length];
  changed();
}
function clearCell(row: TemplateRow, cell: import('../../lib/templateTypes.js').TemplateCell) {
  cell.questionId = null; cell.special = 'none'; changed();
}
const tagLabel = (s: string) => s === 'cat' ? 'Кот' : s === 'auction' ? 'Аукцион' : '';
```

Замени содержимое `.cell` (для заполненной ячейки):

```svelte
<div class="cell" ...>
  {#if cell.questionId}
    {@const info = questionInfo(cell.questionId)}
    <div class="filled">
      {#if info?.type === 'image' && info.media}<img src={bankMediaUrl(info.media)} alt="" />
      {:else if info?.type === 'audio' && info.media}<audio controls src={bankMediaUrl(info.media)}></audio>
      {:else}<span class="prompt">{info?.prompt?.slice(0, 40) ?? '—'}</span>{/if}
      <div class="cellbar">
        <button class="tag" on:click={() => cycleTag(cell)}>{tagLabel(cell.special) || 'тег'}</button>
        <button class="x" title="Очистить" on:click={() => clearCell(row, cell)}>×</button>
      </div>
    </div>
  {/if}
</div>
```

Стили: `.filled { display: grid; gap: 6px; } .filled img { max-width: 100%; max-height: 64px; border-radius: 6px; } .cellbar { display: flex; justify-content: space-between; } .tag { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-pill); color: var(--accent); font-size: 12px; padding: 2px 8px; cursor: pointer; } .x { background: none; border: none; color: var(--text-2); cursor: pointer; font-size: 16px; } .x:hover { color: var(--err); }`

- [ ] **Step 3: Verify** — `cd web && npx svelte-check`; `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add web/src/admin/sections/builder/
git commit -m "feat(2b/web): превью вопроса, тег мини-игры по клику, очистка ячейки"
```

---

### Task 18: Веб — лайв-валидация, панель действий, публикация, «Сыграть тестовую»

**Files:**
- Modify: `web/src/admin/sections/builder/GameEditor.svelte`

**Interfaces:**
- Лайв-валидация: реактивно `validateClient(docVal, bankClientView)`; подсветка проблемных ячеек/строк (прокинуть set «проблемных» id в RoundGrid — опционально через проп `problems`); плашка снизу: при ошибках — «Что мешает опубликовать: строк без категории N · пустых ячеек M» (через `summarize`), иначе зелёная «Всё заполнено — можно публиковать».
- Панель действий (шапка): «Сыграть тестовую», «Опубликовать». «Опубликовать» disabled при `errors.length>0`.
- **Опубликовать**: `await draft.flush()` → `preflight` → если `referencingGames>0` показать `Modal` «N активных игр будут завершены. Продолжить?» с выбором «Новый пак»/«Перезаписать»/«Отмена» → `publish(id, mode)`; при 400 — показать `err.problems` (подсветить). По умолчанию — «Новый пак».
- **Сыграть тестовую**: `await draft.flush()` → `publish(id, 'overwrite' if lastPublishedPackId else 'new')` (переиспользуем packId черновика — корректировка #2) → `createGame(packId, docVal.title, 3)` → `window.open('/host?game='+gameId)` и `window.open('/board?game='+gameId)`.

- [ ] **Step 1: Implement** — добавь в `GameEditor.svelte`:

```ts
import { validateClient, summarize, type BankClientView } from '../../lib/templateValidate.js';
import Modal from '../Modal.svelte';

let publishModal: { referencingGames: number } | null = null;
let bankView: BankClientView = { categories: new Set(), questionCategory: new Map() };
// после загрузки банка:
bankView = { categories: new Set(bank.categories.map(c => c.id)),
  questionCategory: new Map(bank.questions.map(q => [q.id, q.categoryId])) };

$: validation = docVal ? validateClient(docVal, bankView) : { errors: [], warnings: [] };
$: summary = summarize(validation.errors);
$: canPublish = !!docVal && validation.errors.length === 0;

async function playTest() {
  if (!draft || !docVal) return;
  await draft.flush();
  const mode = docVal.lastPublishedPackId ? 'overwrite' : 'new';
  const { packId } = await api.publish(id, mode);
  const { gameId } = await api.createGame(packId, docVal.title, 3);
  window.open(`/host?game=${gameId}`, '_blank');
  window.open(`/board?game=${gameId}`, '_blank');
}
async function startPublish() {
  if (!draft) return;
  await draft.flush();
  const pf = await api.preflight(id);
  publishModal = { referencingGames: pf.referencingGames };
}
async function doPublish(mode: 'new' | 'overwrite') {
  try { await api.publish(id, mode); publishModal = null; }
  catch (e) { publishModal = null; /* проблемы в (e as any).problems — подсветить */ }
}
```

Разметка — в шапку добавь кнопки:

```svelte
<button class="ghost" on:click={playTest} disabled={!docVal}>Сыграть тестовую</button>
<button class="primary" on:click={startPublish} disabled={!canPublish}>Опубликовать</button>
```

Плашка под сеткой:

```svelte
{#if docVal}
  {#if validation.errors.length}
    <div class="banner warn">Что мешает опубликовать: строк без категории {summary.rowsNoCategory} · пустых ячеек {summary.emptyCells}</div>
  {:else}
    <div class="banner ok">Всё заполнено — можно публиковать</div>
  {/if}
{/if}

{#if publishModal}
  <Modal title="Публикация" on:close={() => (publishModal = null)}>
    {#if publishModal.referencingGames > 0}
      <p>{publishModal.referencingGames} активных игр на этом паке будут завершены.</p>
    {/if}
    <div class="modal-actions">
      <button class="ghost" on:click={() => (publishModal = null)}>Отмена</button>
      <button class="ghost" on:click={() => doPublish('overwrite')} disabled={!docVal?.lastPublishedPackId}>Перезаписать текущую</button>
      <button class="primary" on:click={() => doPublish('new')}>Новый пак</button>
    </div>
  </Modal>
{/if}
```

Стили: `.banner { margin-top: 16px; padding: 10px 14px; border-radius: var(--r-control); font-family: var(--font-display); } .banner.warn { background: rgba(245,197,24,.12); color: var(--gold); border: 1px solid var(--gold); } .banner.ok { background: rgba(31,209,142,.12); color: var(--ok); border: 1px solid var(--ok); } .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }`

- [ ] **Step 2: Verify** — `cd web && npx svelte-check` без новых ошибок; `npm run build` успех; `npm test` (web) PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/admin/sections/builder/GameEditor.svelte
git commit -m "feat(2b/web): лайв-валидация, публикация с предупреждением, «Сыграть тестовую»"
```

---

### Task 19: Визуальная проверка через Playwright + docs

**Files:**
- Modify: `docs/run.md` (раздел про конструктор)

**Interfaces:** ручная/скриптовая проверка на живом контейнере (проектное правило: UI верифицируется скриншотами, не только svelte-check/build).

- [ ] **Step 1: Поднять приложение** — собрать веб (`cd web && npm run build`), запустить сервер (`npm run dev` в корне или собранный), залогиниться в `/admin`.
- [ ] **Step 2: Playwright-сценарий** — снять скриншоты и проверить:
  - «Список игр»: создать 5×5, открыть.
  - Сетка: видны 5 столбцов с золотыми ценами, 5 строк-«Перетащите категорию».
  - DnD: перетащить категорию на строку (имя появилось), перетащить свой вопрос в ячейку (превью), чужой — отклонён (красная рамка).
  - Тег: клик по «тег» циклит Кот/Аукцион.
  - Плашка: при пустых ячейках — жёлтая с числами; при заполнении всех — зелёная.
  - «Опубликовать» активна только при зелёной плашке; модалка публикации.
  - «Сыграть тестовую»: открываются `/host` и `/board`, доска показывает собранные категории/цены.
- [ ] **Step 3: Документация** — добавь в `docs/run.md` раздел «Конструктор игр»: как создать игру, собрать сетку из банка, опубликовать, сыграть тестовую; отметь, что перезапись пака завершает активные игры.
- [ ] **Step 4: Commit**

```bash
git add docs/run.md
git commit -m "docs(2b): раздел про конструктор игр в run.md"
```

---

## Self-Review

**Spec coverage (2b-core + корректировки):**
- Модель + CRUD `game_templates` → Task 1, 3. ✓
- Сетка-редактор с ценами, +/− → Task 15. ✓
- DnD категорий и вопросов (ограничение по категории) → Task 16. ✓
- Теги мини-игр (клик-цикл, только на заполненной) → Task 17. ✓ (корректировка 5б)
- Лайв-валидация + плашка → Task 12, 18. ✓
- Публикация + flatten → Task 6, 9. ✓
- «Сыграть тестовую» (один packId, teamCount=3) → Task 18. ✓ (корректировки 2)
- Форс-завершение активных игр при перезаписи → Task 9. ✓ (корректировка 1)
- Физическая проверка медиа → Task 5, 9. ✓ (корректировка 3)
- Ручная цена кратно 100 + авто на 6-й+ → Task 15 (`step=100`, `max+100`). ✓ (корректировка 4)
- Дубль цен/вопросов — предупреждения → Task 5, 12. ✓ (корректировка 4/5)
- Снапшот title/имени раунда → Task 6 (берутся из документа). ✓ (корректировка 5в)
- Flush автосейва перед публикацией/тестом → Task 13, 18. ✓ (корректировка 6)
- Превью медиа в ячейке → Task 17. ✓ (корректировка 3)
- preflight по `events` → Task 8. ✓

**Открытые места для исполнителя (проверить при реализации, не плейсхолдеры):**
- `bankApi.listQuestions(categoryId): Promise<Question[]>`, `listCategories()`, `bankMediaUrl()` — подтверждены в `web/src/admin/bankApi.ts`. Проверить точные имена полей типа `Question` (ожидается `categoryId/type/prompt/media`) и при расхождении выровнять маппинг в Task 16/17.
- Имена CSS-токенов `--text-3`, `--text-4`, `--border-accent` — использованы по факту из `theme.css`; если какого-то нет, заменить ближайшим существующим.
- Точное имя cookie/login-роута в тестах (`/api/admin/login`, cookie `svoya_admin`) — выровнять по `bank.test.ts`.

**Вне области (2b-ext, спек 2c)** — экспорт/импорт шаблона, override имени категории, DnD-переупорядочивание раундов/столбцов, финальный раунд — НЕ в этом плане.
