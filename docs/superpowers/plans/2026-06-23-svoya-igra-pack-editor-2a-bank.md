# Редактор паков — Стадия 2a (База вопросов) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Менеджер базы вопросов под `/admin/base`: серверное хранилище категорий→вопросов с UID (тип/текст/ответ/медиа, без цен/мини-игр), CRUD-API за гардом, загрузка/превью медиа, экспорт/импорт `bank.zip` (слияние по UID), и UI-менеджер контента.

**Architecture:** Нормализованные таблицы `bank_categories`/`bank_questions` (better-sqlite3) за слоем-репозиторием `src/persistence/bankRepo.ts`; HTTP-роуты `/api/bank/*` (`src/http/bank.ts`) за preHandler-гардом `requireAdmin` из стадии 2-shell; медиа банка лежит в `{mediaDir}/bank/media/<name>`, хранится в БД как `bank/media/<name>`, отдаётся существующим `GET /media/:packId/*` через namespace `packId="bank"`; перенос между установками — `bank.zip` (`src/packs/bankZip.ts`, слияние по UID). Веб: секция `web/src/admin/sections/Base.svelte` + под-компоненты, клиент `web/src/admin/bankApi.ts`.

**Tech Stack:** Node 20 ESM, Fastify 4 (`@fastify/multipart` уже зарегистрирован), better-sqlite3, `adm-zip`, zod, Svelte 4 + Vite 5, vitest.

## Global Constraints

- **ESM `.js` import extensions** в серверном и клиентском TS (`from '../config.js'`, `from './route.js'`).
- **Все `/api/bank/*` роуты — за `requireAdmin`** (preHandler), импортируется из `src/http/auth.js` (стадия 2-shell). Игровые роуты/движок не трогаем.
- **Вопрос банка НЕ имеет** `value`/`special` — это поля только опубликованного пака. Тип ∈ `text|image|audio`. В банке вопрос может быть НЕполным (image/audio без media) — strict-проверка media только на публикации (стадия 2b).
- **Перенос вопроса между категориями ЗАПРЕЩЁН**: `PUT /api/bank/questions/:id` НЕ принимает `category_id` — при наличии поля в теле → `400`.
- **Удаление НЕпустой категории — КАСКАД**: удаляет её вопросы (+ GC их медиа). UI подтверждает («удалить категорию и N вопросов?»).
- **Медиа банка**: хранимое значение в БД — `bank/media/<name>`; физический путь — `join(mediaDir, value)`; отдача — `GET /media/bank/<name>` (существующий роут `/media/:packId/*`); URL для клиента — `'/media/bank/' + value.replace(/^bank\/media\//,'')` (зеркало приёма `toPublicState` для паков, `src/realtime/protocol.ts:42`).
- **Загрузка медиа**: per-request лимит `25 МБ` через `req.file({ limits: { fileSize } })` (НЕ глобально — не ломать upload пака); MIME-whitelist `image/jpeg|image/png|image/webp|audio/mpeg|audio/ogg|audio/mp4`, проверка ДО `toBuffer()`; имя `<questionId>-<sanitized>` с обрезкой длины; защита от path traversal.
- **`bank.zip`**: `bank.json` (`{categories:[{id,name,position}], questions:[{id,categoryId,type,prompt,answer,media,position}]}`) + медиа под `bank/media/<name>`. Импорт сливает по UID (совпал id → `INSERT OR REPLACE`, нет → вставка); позиции из файла не пере-компактим.
- **Дизайн**: токены `web/src/lib/theme.css`. Чип типа по цвету: **Текст — `--accent`**, **Картинка — `--ok`**, **Аудио — `--gold`**. Индикатор автосейва «Сохранение… → Сохранено ✓». Эмодзи нет; русский, кнопки активным глаголом.
- **Веб-тесты** — из `web/` (`cd web && npx vitest run …`). Тестируемые веб-модули без DOM на верхнем уровне.

---

### Task 1: Миграции БД + репозиторий банка

**Files:**
- Modify: `src/persistence/db.ts`
- Create: `src/persistence/bankRepo.ts`
- Test: `src/persistence/bankRepo.test.ts`

**Interfaces:**
- Consumes: `Db` из `src/persistence/db.ts`.
- Produces (для Task 2/4):
  - Типы `BankCategory = { id, name, position, questionCount }`, `BankQuestion = { id, categoryId, type, prompt, answer, media, position }` (`type: 'text'|'image'|'audio'`, `media: string | null`).
  - `createCategory(db, name): { id: string }`
  - `listCategories(db): BankCategory[]` (по `position` ASC, с `questionCount`)
  - `renameCategory(db, id, name): boolean`
  - `moveCategory(db, id, direction: 'up'|'down'): boolean`
  - `deleteCategory(db, id): { found: boolean, mediaPaths: string[] }` (каскад: удаляет вопросы категории, возвращает их media-пути для GC)
  - `createQuestion(db, categoryId): { id: string } | null` (null если категории нет; дефолты `type='text'`, `prompt=''`, `answer=''`, `media=null`)
  - `listQuestions(db, categoryId): BankQuestion[]` (по `position` ASC)
  - `getQuestion(db, id): BankQuestion | null`
  - `updateQuestion(db, id, fields: { type?, prompt?, answer?, media? }): boolean` (`media` можно выставить в `null`)
  - `moveQuestion(db, id, direction: 'up'|'down'): boolean` (в пределах своей категории)
  - `deleteQuestion(db, id): { found: boolean, media: string | null }`

- [ ] **Step 1: Добавить миграции**

Modify `src/persistence/db.ts` — добавить в существующий `db.exec(\`…\`)` блок (после таблицы `packs`):
```sql
    CREATE TABLE IF NOT EXISTS bank_categories (
      id       TEXT PRIMARY KEY,
      name     TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bank_questions (
      id          TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES bank_categories(id),
      type        TEXT NOT NULL,
      prompt      TEXT NOT NULL DEFAULT '',
      answer      TEXT NOT NULL DEFAULT '',
      media       TEXT,
      position    INTEGER NOT NULL
    );
```

- [ ] **Step 2: Написать падающий тест**

Create `src/persistence/bankRepo.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from './db.js';
import {
  createCategory, listCategories, renameCategory, moveCategory, deleteCategory,
  createQuestion, listQuestions, getQuestion, updateQuestion, moveQuestion, deleteQuestion,
} from './bankRepo.js';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });

describe('bankRepo categories', () => {
  it('create → list с questionCount=0, position по возрастанию', () => {
    const a = createCategory(db, 'Кино');
    const b = createCategory(db, 'Космос');
    const list = listCategories(db);
    expect(list.map(c => c.name)).toEqual(['Кино', 'Космос']);
    expect(list[0]).toMatchObject({ id: a.id, name: 'Кино', position: 1, questionCount: 0 });
    expect(list[1].id).toBe(b.id);
  });

  it('questionCount считает вопросы', () => {
    const a = createCategory(db, 'Кино');
    createQuestion(db, a.id); createQuestion(db, a.id);
    expect(listCategories(db)[0].questionCount).toBe(2);
  });

  it('rename', () => {
    const a = createCategory(db, 'Кино');
    expect(renameCategory(db, a.id, 'Фильмы')).toBe(true);
    expect(listCategories(db)[0].name).toBe('Фильмы');
    expect(renameCategory(db, 'нет', 'X')).toBe(false);
  });

  it('move up/down меняет порядок', () => {
    const a = createCategory(db, 'A');
    const b = createCategory(db, 'B');
    expect(moveCategory(db, b.id, 'up')).toBe(true);
    expect(listCategories(db).map(c => c.name)).toEqual(['B', 'A']);
    expect(moveCategory(db, b.id, 'up')).toBe(false); // уже первый
    expect(moveCategory(db, a.id, 'down')).toBe(false); // уже последний (a сейчас второй)
  });

  it('delete каскадно удаляет вопросы и возвращает их media', () => {
    const a = createCategory(db, 'Кино');
    const q1 = createQuestion(db, a.id)!;
    updateQuestion(db, q1.id, { media: 'bank/media/x.png' });
    createQuestion(db, a.id);
    const res = deleteCategory(db, a.id);
    expect(res.found).toBe(true);
    expect(res.mediaPaths).toEqual(['bank/media/x.png']);
    expect(listCategories(db)).toHaveLength(0);
    expect(listQuestions(db, a.id)).toHaveLength(0);
    expect(deleteCategory(db, a.id)).toEqual({ found: false, mediaPaths: [] });
  });
});

describe('bankRepo questions', () => {
  it('create с дефолтами; null если категории нет', () => {
    const a = createCategory(db, 'Кино');
    const q = createQuestion(db, a.id)!;
    expect(getQuestion(db, q.id)).toMatchObject({
      id: q.id, categoryId: a.id, type: 'text', prompt: '', answer: '', media: null, position: 1,
    });
    expect(createQuestion(db, 'нет-такой')).toBeNull();
  });

  it('update полей; media в null', () => {
    const a = createCategory(db, 'Кино');
    const q = createQuestion(db, a.id)!;
    expect(updateQuestion(db, q.id, { type: 'image', prompt: 'Кто?', answer: 'X', media: 'bank/media/a.jpg' })).toBe(true);
    expect(getQuestion(db, q.id)).toMatchObject({ type: 'image', prompt: 'Кто?', answer: 'X', media: 'bank/media/a.jpg' });
    updateQuestion(db, q.id, { media: null });
    expect(getQuestion(db, q.id)!.media).toBeNull();
    expect(updateQuestion(db, 'нет', { prompt: 'x' })).toBe(false);
  });

  it('move вопроса в пределах категории', () => {
    const a = createCategory(db, 'Кино');
    const q1 = createQuestion(db, a.id)!;
    const q2 = createQuestion(db, a.id)!;
    expect(moveQuestion(db, q2.id, 'up')).toBe(true);
    expect(listQuestions(db, a.id).map(q => q.id)).toEqual([q2.id, q1.id]);
  });

  it('delete возвращает media', () => {
    const a = createCategory(db, 'Кино');
    const q = createQuestion(db, a.id)!;
    updateQuestion(db, q.id, { media: 'bank/media/a.jpg' });
    expect(deleteQuestion(db, q.id)).toEqual({ found: true, media: 'bank/media/a.jpg' });
    expect(getQuestion(db, q.id)).toBeNull();
    expect(deleteQuestion(db, q.id)).toEqual({ found: false, media: null });
  });
});
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `npx vitest run src/persistence/bankRepo.test.ts`
Expected: FAIL — модуль `./bankRepo.js` не найден.

- [ ] **Step 4: Реализовать репозиторий**

Create `src/persistence/bankRepo.ts`:
```ts
import type { Db } from './db.js';

export type QType = 'text' | 'image' | 'audio';
export interface BankCategory { id: string; name: string; position: number; questionCount: number }
export interface BankQuestion {
  id: string; categoryId: string; type: QType;
  prompt: string; answer: string; media: string | null; position: number;
}

export function createCategory(db: Db, name: string): { id: string } {
  const id = crypto.randomUUID();
  const pos = (db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM bank_categories').get() as { p: number }).p;
  db.prepare('INSERT INTO bank_categories (id,name,position) VALUES (?,?,?)').run(id, name, pos);
  return { id };
}

export function listCategories(db: Db): BankCategory[] {
  return db.prepare(`
    SELECT c.id, c.name, c.position, COUNT(q.id) AS questionCount
    FROM bank_categories c
    LEFT JOIN bank_questions q ON q.category_id = c.id
    GROUP BY c.id ORDER BY c.position ASC
  `).all() as BankCategory[];
}

export function renameCategory(db: Db, id: string, name: string): boolean {
  return db.prepare('UPDATE bank_categories SET name=? WHERE id=?').run(name, id).changes > 0;
}

export function moveCategory(db: Db, id: string, direction: 'up' | 'down'): boolean {
  const cur = db.prepare('SELECT position FROM bank_categories WHERE id=?').get(id) as { position: number } | undefined;
  if (!cur) return false;
  const op = direction === 'up' ? '<' : '>';
  const order = direction === 'up' ? 'DESC' : 'ASC';
  const nb = db.prepare(`SELECT id, position FROM bank_categories WHERE position ${op} ? ORDER BY position ${order} LIMIT 1`)
    .get(cur.position) as { id: string; position: number } | undefined;
  if (!nb) return false;
  db.transaction(() => {
    db.prepare('UPDATE bank_categories SET position=? WHERE id=?').run(nb.position, id);
    db.prepare('UPDATE bank_categories SET position=? WHERE id=?').run(cur.position, nb.id);
  })();
  return true;
}

export function deleteCategory(db: Db, id: string): { found: boolean; mediaPaths: string[] } {
  const cat = db.prepare('SELECT id FROM bank_categories WHERE id=?').get(id);
  if (!cat) return { found: false, mediaPaths: [] };
  const media = (db.prepare('SELECT media FROM bank_questions WHERE category_id=? AND media IS NOT NULL').all(id) as Array<{ media: string }>)
    .map(r => r.media);
  db.transaction(() => {
    db.prepare('DELETE FROM bank_questions WHERE category_id=?').run(id);
    db.prepare('DELETE FROM bank_categories WHERE id=?').run(id);
  })();
  return { found: true, mediaPaths: media };
}

function rowToQuestion(r: any): BankQuestion {
  return { id: r.id, categoryId: r.category_id, type: r.type, prompt: r.prompt, answer: r.answer, media: r.media ?? null, position: r.position };
}

export function createQuestion(db: Db, categoryId: string): { id: string } | null {
  const cat = db.prepare('SELECT id FROM bank_categories WHERE id=?').get(categoryId);
  if (!cat) return null;
  const id = crypto.randomUUID();
  const pos = (db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM bank_questions WHERE category_id=?').get(categoryId) as { p: number }).p;
  db.prepare("INSERT INTO bank_questions (id,category_id,type,prompt,answer,media,position) VALUES (?,?,'text','','',NULL,?)")
    .run(id, categoryId, pos);
  return { id };
}

export function listQuestions(db: Db, categoryId: string): BankQuestion[] {
  return (db.prepare('SELECT * FROM bank_questions WHERE category_id=? ORDER BY position ASC').all(categoryId) as any[]).map(rowToQuestion);
}

export function getQuestion(db: Db, id: string): BankQuestion | null {
  const r = db.prepare('SELECT * FROM bank_questions WHERE id=?').get(id);
  return r ? rowToQuestion(r) : null;
}

export function updateQuestion(
  db: Db, id: string,
  fields: { type?: QType; prompt?: string; answer?: string; media?: string | null },
): boolean {
  const cur = db.prepare('SELECT * FROM bank_questions WHERE id=?').get(id) as any;
  if (!cur) return false;
  const type = fields.type ?? cur.type;
  const prompt = fields.prompt ?? cur.prompt;
  const answer = fields.answer ?? cur.answer;
  const media = 'media' in fields ? fields.media ?? null : (cur.media ?? null);
  db.prepare('UPDATE bank_questions SET type=?,prompt=?,answer=?,media=? WHERE id=?').run(type, prompt, answer, media, id);
  return true;
}

export function moveQuestion(db: Db, id: string, direction: 'up' | 'down'): boolean {
  const cur = db.prepare('SELECT category_id, position FROM bank_questions WHERE id=?').get(id) as { category_id: string; position: number } | undefined;
  if (!cur) return false;
  const op = direction === 'up' ? '<' : '>';
  const order = direction === 'up' ? 'DESC' : 'ASC';
  const nb = db.prepare(`SELECT id, position FROM bank_questions WHERE category_id=? AND position ${op} ? ORDER BY position ${order} LIMIT 1`)
    .get(cur.category_id, cur.position) as { id: string; position: number } | undefined;
  if (!nb) return false;
  db.transaction(() => {
    db.prepare('UPDATE bank_questions SET position=? WHERE id=?').run(nb.position, id);
    db.prepare('UPDATE bank_questions SET position=? WHERE id=?').run(cur.position, nb.id);
  })();
  return true;
}

export function deleteQuestion(db: Db, id: string): { found: boolean; media: string | null } {
  const q = db.prepare('SELECT media FROM bank_questions WHERE id=?').get(id) as { media: string | null } | undefined;
  if (!q) return { found: false, media: null };
  db.prepare('DELETE FROM bank_questions WHERE id=?').run(id);
  return { found: true, media: q.media ?? null };
}
```

- [ ] **Step 5: Запустить — убедиться, что зелёный**

Run: `npx vitest run src/persistence/bankRepo.test.ts`
Expected: PASS (все кейсы).

- [ ] **Step 6: Коммит**

```bash
git add src/persistence/db.ts src/persistence/bankRepo.ts src/persistence/bankRepo.test.ts
git commit -m "feat(bank): таблицы bank_categories/bank_questions + репозиторий с CRUD/move/cascade"
```

---

### Task 2: CRUD-роуты банка + GC-хелпер медиа

**Files:**
- Create: `src/http/bankMedia.ts`
- Create: `src/http/bank.ts`
- Modify: `src/http/server.ts`
- Test: `src/http/bank.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` из `src/http/auth.js`; весь `bankRepo`; `ServerDeps` из `server.ts`.
- Produces:
  - `gcMedia(mediaDir: string, paths: Array<string | null | undefined>): void` (в `bankMedia.ts`) — удаляет файлы `join(mediaDir, p)`, молча игнорирует отсутствующие.
  - `registerBank(app: FastifyInstance, deps: ServerDeps): void` (в `bank.ts`) — регистрирует все `/api/bank/*` за `requireAdmin`.
  - Роуты: `GET /api/bank/categories`; `POST /api/bank/categories`; `PUT /api/bank/categories/:id`; `POST /api/bank/categories/:id/move`; `DELETE /api/bank/categories/:id`; `GET /api/bank/categories/:id/questions`; `POST /api/bank/categories/:id/questions`; `PUT /api/bank/questions/:id`; `POST /api/bank/questions/:id/move`; `DELETE /api/bank/questions/:id`.

- [ ] **Step 1: Написать падающий тест**

Create `src/http/bank.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildServer } from './server.js';
import { openDb } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { config } from '../config.js';

function makeDeps() {
  const db = openDb(':memory:');
  return { store: new EventStore(db, 25), db, config: { ...config, mediaDir: 'data/test-bank-media', adminPassword: 'secret', cookieSecret: 'test-secret' } };
}
async function authed(app: ReturnType<typeof buildServer>) {
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
  const c = login.cookies.find(x => x.name === 'svoya_admin')!;
  return `${c.name}=${c.value}`;
}

describe('bank API', () => {
  it('гард: 401 без куки', async () => {
    const app = buildServer(makeDeps());
    const res = await app.inject({ method: 'GET', url: '/api/bank/categories' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('CRUD категорий', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const create = await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'Кино' } });
    expect(create.statusCode).toBe(200);
    const id = create.json().id as string;

    const list = await app.inject({ method: 'GET', url: '/api/bank/categories', headers: { cookie } });
    expect(list.json()).toEqual([{ id, name: 'Кино', position: 1, questionCount: 0 }]);

    const ren = await app.inject({ method: 'PUT', url: `/api/bank/categories/${id}`, headers: { cookie }, payload: { name: 'Фильмы' } });
    expect(ren.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/bank/categories', headers: { cookie } })).json()[0].name).toBe('Фильмы');

    expect((await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/bank/categories/нет', headers: { cookie }, payload: { name: 'X' } })).statusCode).toBe(404);
    await app.close();
  });

  it('move категорий', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const a = (await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'A' } })).json().id;
    const b = (await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'B' } })).json().id;
    await app.inject({ method: 'POST', url: `/api/bank/categories/${b}/move`, headers: { cookie }, payload: { direction: 'up' } });
    expect((await app.inject({ method: 'GET', url: '/api/bank/categories', headers: { cookie } })).json().map((c: any) => c.id)).toEqual([b, a]);
    await app.close();
  });

  it('CRUD вопросов; PUT не принимает category_id', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const cat = (await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'Кино' } })).json().id;

    const cq = await app.inject({ method: 'POST', url: `/api/bank/categories/${cat}/questions`, headers: { cookie }, payload: {} });
    expect(cq.statusCode).toBe(200);
    const qid = cq.json().id;

    const upd = await app.inject({ method: 'PUT', url: `/api/bank/questions/${qid}`, headers: { cookie }, payload: { type: 'text', prompt: 'Кто?', answer: 'X' } });
    expect(upd.statusCode).toBe(200);
    const qs = await app.inject({ method: 'GET', url: `/api/bank/categories/${cat}/questions`, headers: { cookie } });
    expect(qs.json()[0]).toMatchObject({ id: qid, categoryId: cat, type: 'text', prompt: 'Кто?', answer: 'X', media: null });

    // перенос между категориями запрещён
    const bad = await app.inject({ method: 'PUT', url: `/api/bank/questions/${qid}`, headers: { cookie }, payload: { category_id: 'другая' } });
    expect(bad.statusCode).toBe(400);
    // неизвестный тип
    expect((await app.inject({ method: 'PUT', url: `/api/bank/questions/${qid}`, headers: { cookie }, payload: { type: 'video' } })).statusCode).toBe(400);
    // вопрос в несуществующую категорию
    expect((await app.inject({ method: 'POST', url: '/api/bank/categories/нет/questions', headers: { cookie }, payload: {} })).statusCode).toBe(404);

    const del = await app.inject({ method: 'DELETE', url: `/api/bank/questions/${qid}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/bank/categories/${cat}/questions`, headers: { cookie } })).json()).toEqual([]);
    await app.close();
  });

  it('DELETE категории каскадно удаляет вопросы', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const cat = (await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'Кино' } })).json().id;
    await app.inject({ method: 'POST', url: `/api/bank/categories/${cat}/questions`, headers: { cookie }, payload: {} });
    const del = await app.inject({ method: 'DELETE', url: `/api/bank/categories/${cat}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/bank/categories', headers: { cookie } })).json()).toEqual([]);
    await app.close();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/http/bank.test.ts`
Expected: FAIL — `/api/bank/*` отдают 404 (роуты не зарегистрированы) / модуль не найден.

- [ ] **Step 3: Создать GC-хелпер медиа**

Create `src/http/bankMedia.ts`:
```ts
import { rmSync } from 'node:fs';
import { join } from 'node:path';

export function gcMedia(mediaDir: string, paths: Array<string | null | undefined>): void {
  for (const p of paths) {
    if (!p) continue;
    try { rmSync(join(mediaDir, p), { force: true }); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: Создать роуты банка**

Create `src/http/bank.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './auth.js';
import { gcMedia } from './bankMedia.js';
import type { ServerDeps } from './server.js';
import {
  createCategory, listCategories, renameCategory, moveCategory, deleteCategory,
  createQuestion, listQuestions, getQuestion, updateQuestion, moveQuestion, deleteQuestion,
} from '../persistence/bankRepo.js';

const TYPES = new Set(['text', 'image', 'audio']);
const DIRS = new Set(['up', 'down']);

export function registerBank(app: FastifyInstance, deps: ServerDeps): void {
  const { db, config } = deps;
  const guard = { preHandler: requireAdmin };

  app.get('/api/bank/categories', guard, async () => listCategories(db));

  app.post('/api/bank/categories', guard, async (req, reply) => {
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name || !name.trim()) return reply.code(400).send({ error: 'имя категории обязательно' });
    return createCategory(db, name.trim());
  });

  app.put('/api/bank/categories/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name || !name.trim()) return reply.code(400).send({ error: 'имя категории обязательно' });
    if (!renameCategory(db, id, name.trim())) return reply.code(404).send({ error: 'категория не найдена' });
    return { ok: true };
  });

  app.post('/api/bank/categories/:id/move', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { direction } = (req.body ?? {}) as { direction?: string };
    if (!DIRS.has(direction as string)) return reply.code(400).send({ error: 'direction должен быть up|down' });
    return { moved: moveCategory(db, id, direction as 'up' | 'down') };
  });

  app.delete('/api/bank/categories/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = deleteCategory(db, id);
    if (!res.found) return reply.code(404).send({ error: 'категория не найдена' });
    gcMedia(config.mediaDir, res.mediaPaths);
    return { ok: true };
  });

  app.get('/api/bank/categories/:id/questions', guard, async (req) => {
    const { id } = req.params as { id: string };
    return listQuestions(db, id);
  });

  app.post('/api/bank/categories/:id/questions', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const created = createQuestion(db, id);
    if (!created) return reply.code(404).send({ error: 'категория не найдена' });
    return created;
  });

  app.put('/api/bank/questions/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    if ('category_id' in body || 'categoryId' in body) {
      return reply.code(400).send({ error: 'перенос вопроса между категориями запрещён' });
    }
    if (body.type !== undefined && !TYPES.has(body.type as string)) {
      return reply.code(400).send({ error: 'тип должен быть text|image|audio' });
    }
    const before = getQuestion(db, id);
    if (!before) return reply.code(404).send({ error: 'вопрос не найден' });
    const fields: { type?: 'text' | 'image' | 'audio'; prompt?: string; answer?: string; media?: string | null } = {};
    if (body.type !== undefined) fields.type = body.type as 'text' | 'image' | 'audio';
    if (body.prompt !== undefined) fields.prompt = String(body.prompt);
    if (body.answer !== undefined) fields.answer = String(body.answer);
    if ('media' in body) fields.media = body.media === null ? null : String(body.media);
    updateQuestion(db, id, fields);
    if ('media' in fields && before.media && before.media !== fields.media) {
      gcMedia(config.mediaDir, [before.media]);
    }
    return { ok: true };
  });

  app.post('/api/bank/questions/:id/move', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { direction } = (req.body ?? {}) as { direction?: string };
    if (!DIRS.has(direction as string)) return reply.code(400).send({ error: 'direction должен быть up|down' });
    return { moved: moveQuestion(db, id, direction as 'up' | 'down') };
  });

  app.delete('/api/bank/questions/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = deleteQuestion(db, id);
    if (!res.found) return reply.code(404).send({ error: 'вопрос не найден' });
    gcMedia(config.mediaDir, [res.media]);
    return { ok: true };
  });
}
```

- [ ] **Step 5: Подключить в сервере**

Modify `src/http/server.ts`:

5a. Добавить импорт после `import { registerAuth } from './auth.js';`:
```ts
import { registerBank } from './bank.js';
```

5b. Зарегистрировать сразу после `registerAuth(app, deps.config);`:
```ts
  registerAuth(app, deps.config);
  registerBank(app, deps);
```

- [ ] **Step 6: Запустить — убедиться, что зелёный + регрессия**

Run: `npx vitest run src/http/bank.test.ts` → PASS.
Run: `npm test` → все тесты зелёные (включая 2-shell и движок).

- [ ] **Step 7: Коммит**

```bash
git add src/http/bankMedia.ts src/http/bank.ts src/http/server.ts src/http/bank.test.ts
git commit -m "feat(bank): /api/bank/* CRUD категорий и вопросов за гардом + GC-хелпер медиа"
```

---

### Task 3: Загрузка и превью медиа банка

**Files:**
- Modify: `src/http/bankMedia.ts`
- Modify: `src/http/bank.ts`
- Test: `src/http/bankMedia.test.ts` (юнит) + `src/http/bank.test.ts` (интеграция загрузки)

**Interfaces:**
- Consumes: `gcMedia`, `getQuestion`, `updateQuestion`, `requireAdmin`.
- Produces (в `bankMedia.ts`):
  - `ALLOWED_MIME: Record<string,true>`, `MAX_BANK_MEDIA_BYTES = 26214400`
  - `isAllowedMime(m: string): boolean`
  - `sanitizeBankFilename(questionId: string, original: string): string` → `<questionId>-<base>.<ext>` (base lower-case, `[^a-z0-9._-]`→`-`, обрезка base до 80)
  - `saveBankMedia(mediaDir: string, name: string, data: Buffer): string` → пишет в `{mediaDir}/bank/media/<name>`, возвращает `bank/media/<name>` (с защитой от traversal)
  - Роут `POST /api/bank/questions/:id/media` (multipart) → `{ path: 'bank/media/<name>' }`.

- [ ] **Step 1: Написать падающий юнит-тест**

Create `src/http/bankMedia.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isAllowedMime, sanitizeBankFilename, saveBankMedia } from './bankMedia.js';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('bankMedia', () => {
  it('isAllowedMime', () => {
    expect(isAllowedMime('image/png')).toBe(true);
    expect(isAllowedMime('audio/mpeg')).toBe(true);
    expect(isAllowedMime('text/plain')).toBe(false);
    expect(isAllowedMime('application/zip')).toBe(false);
  });

  it('sanitizeBankFilename: префикс UID, безопасные символы, расширение', () => {
    expect(sanitizeBankFilename('Q1', 'Мой Файл!!.PNG')).toBe('Q1-.png'.replace('-.', '-file.')); // кириллица вычищается → base пустой → 'file'
    expect(sanitizeBankFilename('Q1', 'cat_pic.JPG')).toBe('Q1-cat_pic.jpg');
    expect(sanitizeBankFilename('Q1', '../../evil.png')).toBe('Q1-evil.png');
    const long = 'a'.repeat(200) + '.webp';
    const out = sanitizeBankFilename('Q1', long);
    expect(out.startsWith('Q1-' + 'a'.repeat(80) + '.webp')).toBe(true);
  });

  it('saveBankMedia пишет файл и возвращает bank/media-путь', () => {
    const dir = 'data/test-savemedia';
    rmSync(dir, { recursive: true, force: true });
    const path = saveBankMedia(dir, 'Q1-pic.png', Buffer.from([1, 2, 3]));
    expect(path).toBe('bank/media/Q1-pic.png');
    expect(existsSync(join(dir, 'bank', 'media', 'Q1-pic.png'))).toBe(true);
    expect([...readFileSync(join(dir, path))]).toEqual([1, 2, 3]);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/http/bankMedia.test.ts`
Expected: FAIL — `isAllowedMime`/`sanitizeBankFilename`/`saveBankMedia` не экспортированы.

- [ ] **Step 3: Расширить bankMedia.ts**

Modify `src/http/bankMedia.ts` — добавить импорты и функции (оставив существующий `gcMedia`):
```ts
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep, extname, basename } from 'node:path';

export const ALLOWED_MIME: Record<string, true> = {
  'image/jpeg': true, 'image/png': true, 'image/webp': true,
  'audio/mpeg': true, 'audio/ogg': true, 'audio/mp4': true,
};
export const MAX_BANK_MEDIA_BYTES = 26214400; // 25 МБ

export function isAllowedMime(m: string): boolean { return ALLOWED_MIME[m] === true; }

export function sanitizeBankFilename(questionId: string, original: string): string {
  const rawExt = extname(original).toLowerCase();
  const ext = rawExt.replace(/[^.a-z0-9]/g, '').slice(0, 10);
  let base = basename(original, extname(original)).toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  if (base.length > 80) base = base.slice(0, 80);
  if (!base) base = 'file';
  return `${questionId}-${base}${ext}`;
}

export function saveBankMedia(mediaDir: string, name: string, data: Buffer): string {
  const dir = join(mediaDir, 'bank', 'media');
  const target = join(dir, name);
  const resolved = resolve(target);
  if (resolved !== resolve(dir) && !resolved.startsWith(resolve(dir) + sep)) {
    throw new Error('небезопасное имя файла');
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, data);
  return `bank/media/${name}`;
}
```
(существующий `gcMedia` не удалять; импорт `rmSync` уже есть — объедини строки импорта, не дублируй.)

- [ ] **Step 4: Добавить роут загрузки в bank.ts**

Modify `src/http/bank.ts`:

4a. Расширить импорт `bankMedia`:
```ts
import { gcMedia, isAllowedMime, sanitizeBankFilename, saveBankMedia, MAX_BANK_MEDIA_BYTES } from './bankMedia.js';
```

4b. Внутри `registerBank`, перед закрывающей `}`, добавить роут:
```ts
  app.post('/api/bank/questions/:id/media', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = getQuestion(db, id);
    if (!q) return reply.code(404).send({ error: 'вопрос не найден' });

    const file = await (req as any).file({ limits: { fileSize: MAX_BANK_MEDIA_BYTES } });
    if (!file) return reply.code(400).send({ error: 'нет файла' });
    if (!isAllowedMime(file.mimetype)) {
      file.file.resume(); // слить поток, чтобы запрос не завис
      return reply.code(415).send({ error: 'недопустимый тип файла' });
    }
    const buf = await file.toBuffer();
    if (file.file.truncated) return reply.code(413).send({ error: 'файл слишком большой (макс 25 МБ)' });

    const name = sanitizeBankFilename(id, file.filename ?? 'file');
    const path = saveBankMedia(config.mediaDir, name, buf);
    const oldMedia = q.media;
    updateQuestion(db, id, { media: path });
    if (oldMedia && oldMedia !== path) gcMedia(config.mediaDir, [oldMedia]);
    return { path };
  });
```

- [ ] **Step 5: Добавить интеграционные тесты загрузки**

Modify `src/http/bank.test.ts` — добавить импорт вверху:
```ts
import FormData from 'form-data';
```
и новый блок в конец файла (перед закрывающей `});` describe — или отдельным `describe`):
```ts
describe('bank media upload', () => {
  function makeDeps2() {
    const db = openDb(':memory:');
    return { store: new EventStore(db, 25), db, config: { ...config, mediaDir: 'data/test-bank-media', adminPassword: 'secret', cookieSecret: 'test-secret' } };
  }
  async function authed2(app: ReturnType<typeof buildServer>) {
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    const c = login.cookies.find(x => x.name === 'svoya_admin')!;
    return `${c.name}=${c.value}`;
  }
  async function makeQuestion(app: ReturnType<typeof buildServer>, cookie: string) {
    const cat = (await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'Кино' } })).json().id;
    const q = (await app.inject({ method: 'POST', url: `/api/bank/categories/${cat}/questions`, headers: { cookie }, payload: {} })).json().id;
    return { cat, q };
  }

  it('успешная загрузка PNG → путь bank/media/<id>-…', async () => {
    const app = buildServer(makeDeps2());
    const cookie = await authed2(app);
    const { cat, q } = await makeQuestion(app, cookie);
    const form = new FormData();
    form.append('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'pic.png', contentType: 'image/png' });
    const up = await app.inject({ method: 'POST', url: `/api/bank/questions/${q}/media`, payload: form, headers: { ...form.getHeaders(), cookie } });
    expect(up.statusCode).toBe(200);
    expect(up.json().path).toBe(`bank/media/${q}-pic.png`);
    const qs = (await app.inject({ method: 'GET', url: `/api/bank/categories/${cat}/questions`, headers: { cookie } })).json();
    expect(qs[0].media).toBe(`bank/media/${q}-pic.png`);
    await app.close();
  });

  it('отклоняет недопустимый MIME (415)', async () => {
    const app = buildServer(makeDeps2());
    const cookie = await authed2(app);
    const { q } = await makeQuestion(app, cookie);
    const form = new FormData();
    form.append('file', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' });
    const up = await app.inject({ method: 'POST', url: `/api/bank/questions/${q}/media`, payload: form, headers: { ...form.getHeaders(), cookie } });
    expect(up.statusCode).toBe(415);
    await app.close();
  });

  it('загрузка нового медиа удаляет старый файл (GC)', async () => {
    const app = buildServer(makeDeps2());
    const cookie = await authed2(app);
    const { q } = await makeQuestion(app, cookie);
    const f1 = new FormData(); f1.append('file', Buffer.from([1]), { filename: 'a.png', contentType: 'image/png' });
    await app.inject({ method: 'POST', url: `/api/bank/questions/${q}/media`, payload: f1, headers: { ...f1.getHeaders(), cookie } });
    const f2 = new FormData(); f2.append('file', Buffer.from([2]), { filename: 'b.png', contentType: 'image/png' });
    const up2 = await app.inject({ method: 'POST', url: `/api/bank/questions/${q}/media`, payload: f2, headers: { ...f2.getHeaders(), cookie } });
    expect(up2.json().path).toBe(`bank/media/${q}-b.png`);
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    expect(existsSync(join('data/test-bank-media', 'bank', 'media', `${q}-a.png`))).toBe(false);
    expect(existsSync(join('data/test-bank-media', 'bank', 'media', `${q}-b.png`))).toBe(true);
    await app.close();
  });
});
```

- [ ] **Step 6: Запустить — убедиться, что зелёный**

Run: `npx vitest run src/http/bankMedia.test.ts src/http/bank.test.ts`
Expected: PASS (юнит + интеграция загрузки/MIME/GC).

- [ ] **Step 7: Коммит**

```bash
git add src/http/bankMedia.ts src/http/bank.ts src/http/bank.test.ts
git commit -m "feat(bank): загрузка медиа (MIME-whitelist, лимит 25МБ, санитайз, GC старого)"
```

---

### Task 4: Экспорт/импорт банка (bank.zip)

**Files:**
- Modify: `src/persistence/bankRepo.ts`
- Create: `src/packs/bankZip.ts`
- Modify: `src/http/bank.ts`
- Test: `src/packs/bankZip.test.ts` + `src/http/bank.test.ts` (интеграция export/import)

**Interfaces:**
- Consumes: `Db`; `adm-zip`; `zod`; репозиторий.
- Produces:
  - В `bankRepo.ts`: `allCategoriesForExport(db): Array<{id,name,position}>`, `allQuestionsForExport(db): Array<{id,categoryId,type,prompt,answer,media,position}>`.
  - В `bankZip.ts`: `exportBank(db: Db, mediaDir: string): Buffer`; `importBank(db: Db, mediaDir: string, zipBuffer: Buffer): { categories: number; questions: number }` (слияние по UID, идемпотентно).
  - Роуты `GET /api/bank/export` (`application/zip`, attachment `bank.zip`); `POST /api/bank/import` (multipart) → `{ categories, questions }`.

- [ ] **Step 1: Написать падающий тест экспорт/импорт**

Create `src/packs/bankZip.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../persistence/db.js';
import { createCategory, createQuestion, updateQuestion, listCategories, listQuestions } from '../persistence/bankRepo.js';
import { saveBankMedia } from '../http/bankMedia.js';
import { exportBank, importBank } from './bankZip.js';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'data/test-bankzip-src';
const DST = 'data/test-bankzip-dst';

describe('bankZip', () => {
  it('round-trip: export → import в чистую БД сохраняет данные и медиа', () => {
    rmSync(SRC, { recursive: true, force: true });
    rmSync(DST, { recursive: true, force: true });
    const src = openDb(':memory:');
    const cat = createCategory(src, 'Кино');
    const q1 = createQuestion(src, cat.id)!;
    updateQuestion(src, q1.id, { type: 'image', prompt: 'Кто?', answer: 'X', media: saveBankMedia(SRC, `${q1.id}-a.png`, Buffer.from([1, 2, 3])) });
    const q2 = createQuestion(src, cat.id)!;
    updateQuestion(src, q2.id, { prompt: 'Год?', answer: '2001' });

    const buf = exportBank(src, SRC);

    const dst = openDb(':memory:');
    const res = importBank(dst, DST, buf);
    expect(res).toEqual({ categories: 1, questions: 2 });
    expect(listCategories(dst).map(c => ({ id: c.id, name: c.name }))).toEqual([{ id: cat.id, name: 'Кино' }]);
    const qs = listQuestions(dst, cat.id);
    expect(qs.map(q => q.id)).toEqual([q1.id, q2.id]);
    expect(qs[0]).toMatchObject({ type: 'image', prompt: 'Кто?', answer: 'X', media: `bank/media/${q1.id}-a.png` });
    expect(existsSync(join(DST, 'bank', 'media', `${q1.id}-a.png`))).toBe(true);

    rmSync(SRC, { recursive: true, force: true });
    rmSync(DST, { recursive: true, force: true });
  });

  it('импорт идемпотентен и сливает по UID (обновляет)', () => {
    const src = openDb(':memory:');
    const cat = createCategory(src, 'Кино');
    const q = createQuestion(src, cat.id)!;
    updateQuestion(src, q.id, { prompt: 'V1', answer: 'A' });
    const buf1 = exportBank(src, 'data/test-bankzip-noop');

    const dst = openDb(':memory:');
    importBank(dst, 'data/test-bankzip-noop', buf1);
    importBank(dst, 'data/test-bankzip-noop', buf1); // повтор — без дублей
    expect(listCategories(dst)).toHaveLength(1);
    expect(listQuestions(dst, cat.id)).toHaveLength(1);

    // меняем в источнике и переэкспортируем → импорт обновляет тот же UID
    updateQuestion(src, q.id, { prompt: 'V2' });
    importBank(dst, 'data/test-bankzip-noop', exportBank(src, 'data/test-bankzip-noop'));
    expect(listQuestions(dst, cat.id)[0].prompt).toBe('V2');
    expect(listQuestions(dst, cat.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/packs/bankZip.test.ts`
Expected: FAIL — модуль `./bankZip.js` / функции экспорта репозитория не найдены.

- [ ] **Step 3: Добавить export-функции в репозиторий**

Modify `src/persistence/bankRepo.ts` — добавить в конец файла:
```ts
export function allCategoriesForExport(db: Db): Array<{ id: string; name: string; position: number }> {
  return db.prepare('SELECT id, name, position FROM bank_categories ORDER BY position ASC').all() as Array<{ id: string; name: string; position: number }>;
}

export function allQuestionsForExport(db: Db): BankQuestion[] {
  return (db.prepare('SELECT * FROM bank_questions ORDER BY category_id, position ASC').all() as any[]).map(r => ({
    id: r.id, categoryId: r.category_id, type: r.type, prompt: r.prompt, answer: r.answer, media: r.media ?? null, position: r.position,
  }));
}
```

- [ ] **Step 4: Реализовать bankZip.ts**

Create `src/packs/bankZip.ts`:
```ts
import AdmZip from 'adm-zip';
import { z } from 'zod';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import type { Db } from '../persistence/db.js';
import { allCategoriesForExport, allQuestionsForExport } from '../persistence/bankRepo.js';

const bankJsonSchema = z.object({
  categories: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), position: z.number().int() })),
  questions: z.array(z.object({
    id: z.string().min(1), categoryId: z.string().min(1),
    type: z.enum(['text', 'image', 'audio']),
    prompt: z.string(), answer: z.string(),
    media: z.string().nullable(), position: z.number().int(),
  })),
});

export function exportBank(db: Db, mediaDir: string): Buffer {
  const categories = allCategoriesForExport(db);
  const questions = allQuestionsForExport(db);
  const zip = new AdmZip();
  zip.addFile('bank.json', Buffer.from(JSON.stringify({ categories, questions }, null, 2)));
  for (const q of questions) {
    if (!q.media) continue;
    const file = join(mediaDir, q.media);
    if (existsSync(file)) zip.addFile(q.media, readFileSync(file)); // entryName = bank/media/<name>
  }
  return zip.toBuffer();
}

export function importBank(db: Db, mediaDir: string, zipBuffer: Buffer): { categories: number; questions: number } {
  const zip = new AdmZip(zipBuffer);
  const entry = zip.getEntry('bank.json');
  if (!entry) throw new Error('В архиве нет bank.json');
  const data = bankJsonSchema.parse(JSON.parse(zip.readAsText(entry)));

  // распаковка медиа (защита от traversal)
  const mediaRoot = join(mediaDir, 'bank', 'media');
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith('bank/media/')) continue;
    const target = join(mediaDir, e.entryName);
    const resolved = resolve(target);
    if (resolved !== resolve(mediaRoot) && !resolved.startsWith(resolve(mediaRoot) + sep)) {
      throw new Error(`Небезопасный путь в архиве: ${e.entryName}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, e.getData());
  }

  const upCat = db.prepare('INSERT OR REPLACE INTO bank_categories (id,name,position) VALUES (?,?,?)');
  const upQ = db.prepare('INSERT OR REPLACE INTO bank_questions (id,category_id,type,prompt,answer,media,position) VALUES (?,?,?,?,?,?,?)');
  db.transaction(() => {
    for (const c of data.categories) upCat.run(c.id, c.name, c.position);
    for (const q of data.questions) upQ.run(q.id, q.categoryId, q.type, q.prompt, q.answer, q.media, q.position);
  })();
  return { categories: data.categories.length, questions: data.questions.length };
}
```

- [ ] **Step 5: Запустить юнит — зелёный**

Run: `npx vitest run src/packs/bankZip.test.ts`
Expected: PASS (round-trip + идемпотентность).

- [ ] **Step 6: Добавить роуты export/import**

Modify `src/http/bank.ts`:

6a. Добавить импорт:
```ts
import { exportBank, importBank } from '../packs/bankZip.js';
```

6b. Внутри `registerBank`, перед закрывающей `}`, добавить:
```ts
  app.get('/api/bank/export', guard, async (_req, reply) => {
    const buf = exportBank(db, config.mediaDir);
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', 'attachment; filename="bank.zip"');
    return reply.send(buf);
  });

  app.post('/api/bank/import', guard, async (req, reply) => {
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: 'нет файла' });
    const buf = await file.toBuffer();
    try {
      return importBank(db, config.mediaDir, buf);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
```

- [ ] **Step 7: Интеграционный тест export/import**

Modify `src/http/bank.test.ts` — добавить блок:
```ts
describe('bank export/import', () => {
  function makeDeps3() {
    const db = openDb(':memory:');
    return { store: new EventStore(db, 25), db, config: { ...config, mediaDir: 'data/test-bank-media', adminPassword: 'secret', cookieSecret: 'test-secret' } };
  }
  async function authed3(app: ReturnType<typeof buildServer>) {
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    const c = login.cookies.find(x => x.name === 'svoya_admin')!;
    return `${c.name}=${c.value}`;
  }

  it('export отдаёт zip; import втягивает в другой сервер', async () => {
    const app1 = buildServer(makeDeps3());
    const cookie1 = await authed3(app1);
    const cat = (await app1.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie: cookie1 }, payload: { name: 'Кино' } })).json().id;
    await app1.inject({ method: 'POST', url: `/api/bank/categories/${cat}/questions`, headers: { cookie: cookie1 }, payload: {} });

    const exp = await app1.inject({ method: 'GET', url: '/api/bank/export', headers: { cookie: cookie1 } });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-type']).toContain('application/zip');
    const zipBuf = exp.rawPayload;

    const app2 = buildServer(makeDeps3());
    const cookie2 = await authed3(app2);
    const FormDataMod = (await import('form-data')).default;
    const form = new FormDataMod();
    form.append('file', zipBuf, { filename: 'bank.zip', contentType: 'application/zip' });
    const imp = await app2.inject({ method: 'POST', url: '/api/bank/import', payload: form, headers: { ...form.getHeaders(), cookie: cookie2 } });
    expect(imp.statusCode).toBe(200);
    expect(imp.json()).toEqual({ categories: 1, questions: 1 });
    expect((await app2.inject({ method: 'GET', url: '/api/bank/categories', headers: { cookie: cookie2 } })).json()[0].name).toBe('Кино');
    await app1.close(); await app2.close();
  });
});
```

- [ ] **Step 8: Запустить — зелёный + регрессия**

Run: `npx vitest run src/packs/bankZip.test.ts src/http/bank.test.ts` → PASS.
Run: `npm test` → всё зелёное.

- [ ] **Step 9: Коммит**

```bash
git add src/persistence/bankRepo.ts src/packs/bankZip.ts src/http/bank.ts src/packs/bankZip.test.ts src/http/bank.test.ts
git commit -m "feat(bank): экспорт/импорт bank.zip (слияние по UID, идемпотентно) + роуты"
```

---

### Task 5: Клиентский API банка + хелпер mediaUrl

**Files:**
- Create: `web/src/admin/bankApi.ts`
- Test: `web/src/admin/bankApi.test.ts`

**Interfaces:**
- Produces (для Task 6/7):
  - Типы `QType = 'text'|'image'|'audio'`, `Category = { id, name, position, questionCount }`, `Question = { id, categoryId, type, prompt, answer, media, position }`.
  - `bankMediaUrl(path: string): string` — `'bank/media/x.png'` → `'/media/bank/x.png'`.
  - Функции: `listCategories()`, `createCategory(name)`, `renameCategory(id,name)`, `moveCategory(id,direction)`, `deleteCategory(id)`, `listQuestions(categoryId)`, `createQuestion(categoryId)`, `updateQuestion(id, fields)`, `moveQuestion(id,direction)`, `deleteQuestion(id)`, `uploadMedia(id, file)`, `importBank(file)`, и константа `EXPORT_URL = '/api/bank/export'`.

- [ ] **Step 1: Написать падающий тест (чистый хелпер)**

Create `web/src/admin/bankApi.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { bankMediaUrl } from './bankApi.js';

describe('bankMediaUrl', () => {
  it('срезает префикс bank/media/ и даёт URL отдачи', () => {
    expect(bankMediaUrl('bank/media/Q1-pic.png')).toBe('/media/bank/Q1-pic.png');
  });
  it('терпит уже-чистое имя', () => {
    expect(bankMediaUrl('pic.png')).toBe('/media/bank/pic.png');
  });
});
```

- [ ] **Step 2: Запустить из web/ — убедиться, что падает**

Run: `cd web && npx vitest run src/admin/bankApi.test.ts`
Expected: FAIL — модуль `./bankApi.js` не найден.

- [ ] **Step 3: Реализовать bankApi.ts**

Create `web/src/admin/bankApi.ts`:
```ts
export type QType = 'text' | 'image' | 'audio';
export interface Category { id: string; name: string; position: number; questionCount: number }
export interface Question { id: string; categoryId: string; type: QType; prompt: string; answer: string; media: string | null; position: number }

export const EXPORT_URL = '/api/bank/export';

export function bankMediaUrl(path: string): string {
  return '/media/bank/' + path.replace(/^bank\/media\//, '');
}

async function jsonOf(r: Response): Promise<any> {
  if (!r.ok) {
    const msg = await r.json().then(b => (b as { error?: string }).error).catch(() => undefined);
    throw new Error(msg ?? `HTTP ${r.status}`);
  }
  return r.json();
}
const jsonHeaders = { 'content-type': 'application/json' };

export const listCategories = (): Promise<Category[]> => fetch('/api/bank/categories').then(jsonOf);
export const createCategory = (name: string): Promise<{ id: string }> =>
  fetch('/api/bank/categories', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name }) }).then(jsonOf);
export const renameCategory = (id: string, name: string): Promise<unknown> =>
  fetch(`/api/bank/categories/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ name }) }).then(jsonOf);
export const moveCategory = (id: string, direction: 'up' | 'down'): Promise<unknown> =>
  fetch(`/api/bank/categories/${id}/move`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ direction }) }).then(jsonOf);
export const deleteCategory = (id: string): Promise<unknown> =>
  fetch(`/api/bank/categories/${id}`, { method: 'DELETE' }).then(jsonOf);

export const listQuestions = (categoryId: string): Promise<Question[]> =>
  fetch(`/api/bank/categories/${categoryId}/questions`).then(jsonOf);
export const createQuestion = (categoryId: string): Promise<{ id: string }> =>
  fetch(`/api/bank/categories/${categoryId}/questions`, { method: 'POST', headers: jsonHeaders, body: '{}' }).then(jsonOf);
export const updateQuestion = (id: string, fields: Partial<Pick<Question, 'type' | 'prompt' | 'answer' | 'media'>>): Promise<unknown> =>
  fetch(`/api/bank/questions/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(fields) }).then(jsonOf);
export const moveQuestion = (id: string, direction: 'up' | 'down'): Promise<unknown> =>
  fetch(`/api/bank/questions/${id}/move`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ direction }) }).then(jsonOf);
export const deleteQuestion = (id: string): Promise<unknown> =>
  fetch(`/api/bank/questions/${id}`, { method: 'DELETE' }).then(jsonOf);

export const uploadMedia = (id: string, file: File): Promise<{ path: string }> => {
  const fd = new FormData();
  fd.append('file', file);
  return fetch(`/api/bank/questions/${id}/media`, { method: 'POST', body: fd }).then(jsonOf);
};
export const importBank = (file: File): Promise<{ categories: number; questions: number }> => {
  const fd = new FormData();
  fd.append('file', file);
  return fetch('/api/bank/import', { method: 'POST', body: fd }).then(jsonOf);
};
```

- [ ] **Step 4: Запустить — зелёный**

Run: `cd web && npx vitest run src/admin/bankApi.test.ts`
Expected: PASS (2 теста).

- [ ] **Step 5: Коммит**

```bash
git add web/src/admin/bankApi.ts web/src/admin/bankApi.test.ts
git commit -m "feat(web): клиент bankApi + хелпер bankMediaUrl"
```

---

### Task 6: UI — списки категорий и вопросов

**Files:**
- Create: `web/src/admin/sections/CategoryList.svelte`
- Create: `web/src/admin/sections/QuestionList.svelte`
- Modify: `web/src/admin/sections/Base.svelte`

**Interfaces:**
- Consumes: `bankApi` (Task 5).
- Produces (для Task 7): `Base.svelte` держит `categories`, `selectedCategoryId`, `questions`, `selectedQuestionId`, функции `reloadCategories()`, `reloadQuestions()`; рендерит `<CategoryList>` и `<QuestionList>`. `QuestionList` эмитит `select` (id вопроса) — Task 7 повесит на это редактор.

- [ ] **Step 1: Создать CategoryList.svelte**

Create `web/src/admin/sections/CategoryList.svelte`:
```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Category } from '../bankApi.js';
  export let categories: Category[] = [];
  export let selectedId: string | null = null;
  const dispatch = createEventDispatcher<{
    select: string; create: string; rename: { id: string; name: string };
    move: { id: string; direction: 'up' | 'down' }; delete: Category;
  }>();

  let newName = '';
  function add() { const n = newName.trim(); if (!n) return; dispatch('create', n); newName = ''; }
  function rename(c: Category) {
    const name = prompt('Новое имя категории', c.name)?.trim();
    if (name && name !== c.name) dispatch('rename', { id: c.id, name });
  }
</script>

<div class="pane">
  <div class="head">
    <span class="title">Категории</span>
  </div>
  <form class="add" on:submit|preventDefault={add}>
    <input bind:value={newName} placeholder="Новая категория" />
    <button type="submit">+ Категория</button>
  </form>
  <ul>
    {#each categories as c (c.id)}
      <li class:active={c.id === selectedId}>
        <button class="name" on:click={() => dispatch('select', c.id)}>
          <span>{c.name}</span><span class="count">{c.questionCount}</span>
        </button>
        <div class="ops">
          <button class="sq" title="Вверх" on:click={() => dispatch('move', { id: c.id, direction: 'up' })}>↑</button>
          <button class="sq" title="Вниз" on:click={() => dispatch('move', { id: c.id, direction: 'down' })}>↓</button>
          <button title="Переименовать" on:click={() => rename(c)}>Имя</button>
          <button class="del" title="Удалить" on:click={() => dispatch('delete', c)}>Удалить</button>
        </div>
      </li>
    {/each}
  </ul>
</div>

<style>
  .pane { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .04em; color: var(--text-2); font-size: 12px; }
  .add { display: flex; gap: 8px; margin-bottom: 12px; }
  .add input { flex: 1; height: 36px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 0 10px; font: inherit; }
  .add button { height: 36px; padding: 0 12px; border: none; border-radius: var(--r-control); background: var(--accent); color: #fff; font: inherit; cursor: pointer; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  li { display: flex; align-items: center; gap: 6px; border-radius: var(--r-control); padding: 4px; }
  li.active { background: var(--cell-hover); border: 1px solid var(--border-accent); }
  .name { flex: 1; display: flex; justify-content: space-between; align-items: center; background: transparent; border: none; color: var(--text); font: inherit; cursor: pointer; padding: 6px 8px; text-align: left; }
  .count { color: var(--text-3); font-size: 12px; }
  .ops { display: flex; gap: 2px; }
  .ops button { height: 28px; padding: 0 8px; border: 1px solid var(--border); background: transparent; color: var(--text-2); border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px; }
  .ops button.sq { width: 28px; padding: 0; }
  .ops button:hover { background: var(--cell); color: var(--text); }
  .ops .del:hover { color: var(--err); }
</style>
```

- [ ] **Step 2: Создать QuestionList.svelte**

Create `web/src/admin/sections/QuestionList.svelte`:
```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Question } from '../bankApi.js';
  export let questions: Question[] = [];
  export let selectedId: string | null = null;
  export let categorySelected = false;
  const dispatch = createEventDispatcher<{
    select: string; create: void;
    move: { id: string; direction: 'up' | 'down' }; delete: string;
  }>();
  const TYPE_LABEL: Record<Question['type'], string> = { text: 'Текст', image: 'Картинка', audio: 'Аудио' };
</script>

<div class="pane">
  <div class="head">
    <span class="title">Вопросы</span>
    {#if categorySelected}<button class="add" on:click={() => dispatch('create')}>+ Вопрос</button>{/if}
  </div>

  {#if !categorySelected}
    <p class="empty">Выберите категорию слева.</p>
  {:else if questions.length === 0}
    <p class="empty">В категории пока нет вопросов.</p>
  {:else}
    <ul>
      {#each questions as q (q.id)}
        <li class:active={q.id === selectedId}>
          <button class="card" on:click={() => dispatch('select', q.id)}>
            <span class="chip {q.type}">{TYPE_LABEL[q.type]}</span>
            <span class="prompt">{q.prompt || '— пустой вопрос —'}</span>
            <span class="answer">Ответ: {q.answer || '—'}</span>
          </button>
          <div class="ops">
            <button class="sq" title="Вверх" on:click={() => dispatch('move', { id: q.id, direction: 'up' })}>↑</button>
            <button class="sq" title="Вниз" on:click={() => dispatch('move', { id: q.id, direction: 'down' })}>↓</button>
            <button class="del" title="Удалить" on:click={() => dispatch('delete', q.id)}>Удалить</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .pane { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .04em; color: var(--text-2); font-size: 12px; }
  .add { height: 32px; padding: 0 12px; border: none; border-radius: var(--r-control); background: var(--accent); color: #fff; font: inherit; cursor: pointer; }
  .empty { color: var(--text-3); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  li { display: flex; gap: 6px; align-items: stretch; }
  .card { flex: 1; display: flex; flex-direction: column; gap: 4px; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control); padding: 10px 12px; color: var(--text); font: inherit; cursor: pointer; }
  li.active .card { border-color: var(--border-accent); background: var(--cell-hover); }
  .chip { align-self: flex-start; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 2px 8px; border-radius: var(--r-pill); color: #0b0a12; font-weight: 700; }
  .chip.text { background: var(--accent); color: #fff; }
  .chip.image { background: var(--ok); }
  .chip.audio { background: var(--gold); }
  .prompt { font-weight: 600; }
  .answer { color: var(--text-3); font-size: 13px; }
  .ops { display: flex; flex-direction: column; gap: 2px; }
  .ops button { height: 28px; padding: 0 8px; border: 1px solid var(--border); background: transparent; color: var(--text-2); border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px; }
  .ops button.sq { width: 28px; padding: 0; }
  .ops button:hover { background: var(--cell); color: var(--text); }
  .ops .del:hover { color: var(--err); }
</style>
```

- [ ] **Step 3: Переписать Base.svelte (списки)**

Replace the entire contents of `web/src/admin/sections/Base.svelte`:
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import * as api from '../bankApi.js';
  import type { Category, Question } from '../bankApi.js';
  import CategoryList from './CategoryList.svelte';
  import QuestionList from './QuestionList.svelte';

  let categories: Category[] = [];
  let selectedCategoryId: string | null = null;
  let questions: Question[] = [];
  let selectedQuestionId: string | null = null;
  let error = '';

  async function reloadCategories() {
    try { categories = await api.listCategories(); } catch (e) { error = (e as Error).message; }
  }
  async function reloadQuestions() {
    if (!selectedCategoryId) { questions = []; return; }
    try { questions = await api.listQuestions(selectedCategoryId); } catch (e) { error = (e as Error).message; }
  }

  onMount(reloadCategories);

  async function selectCategory(id: string) {
    selectedCategoryId = id; selectedQuestionId = null;
    await reloadQuestions();
  }
  async function createCategory(name: string) { await api.createCategory(name); await reloadCategories(); }
  async function renameCategory(id: string, name: string) { await api.renameCategory(id, name); await reloadCategories(); }
  async function moveCategory(id: string, direction: 'up' | 'down') { await api.moveCategory(id, direction); await reloadCategories(); }
  async function deleteCategory(c: Category) {
    if (!confirm(`Удалить категорию «${c.name}» и ${c.questionCount} вопросов?`)) return;
    await api.deleteCategory(c.id);
    if (selectedCategoryId === c.id) { selectedCategoryId = null; questions = []; selectedQuestionId = null; }
    await reloadCategories();
  }

  async function createQuestion() {
    if (!selectedCategoryId) return;
    const { id } = await api.createQuestion(selectedCategoryId);
    await reloadQuestions(); await reloadCategories();
    selectedQuestionId = id;
  }
  async function moveQuestion(id: string, direction: 'up' | 'down') { await api.moveQuestion(id, direction); await reloadQuestions(); }
  async function deleteQuestion(id: string) {
    if (!confirm('Удалить вопрос?')) return;
    await api.deleteQuestion(id);
    if (selectedQuestionId === id) selectedQuestionId = null;
    await reloadQuestions(); await reloadCategories();
  }
</script>

<section class="base">
  <header class="bar">
    <h1>База вопросов</h1>
  </header>
  {#if error}<p class="err">{error}</p>{/if}

  <div class="cols">
    <CategoryList
      {categories} selectedId={selectedCategoryId}
      on:select={(e) => selectCategory(e.detail)}
      on:create={(e) => createCategory(e.detail)}
      on:rename={(e) => renameCategory(e.detail.id, e.detail.name)}
      on:move={(e) => moveCategory(e.detail.id, e.detail.direction)}
      on:delete={(e) => deleteCategory(e.detail)}
    />
    <QuestionList
      {questions} selectedId={selectedQuestionId} categorySelected={!!selectedCategoryId}
      on:select={(e) => selectedQuestionId = e.detail}
      on:create={createQuestion}
      on:move={(e) => moveQuestion(e.detail.id, e.detail.direction)}
      on:delete={(e) => deleteQuestion(e.detail)}
    />
  </div>
</section>

<style>
  .base { display: flex; flex-direction: column; gap: 16px; }
  .bar { display: flex; justify-content: space-between; align-items: center; }
  h1 { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .02em; margin: 0; }
  .err { color: var(--err); margin: 0; }
  .cols { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
</style>
```

- [ ] **Step 4: Проверка типов и сборка**

Run: `cd web && npx svelte-check --tsconfig ./tsconfig.json && npm run build`
Expected: svelte-check 0 ошибок; сборка успешна (`dist/admin.html`).

- [ ] **Step 5: Живая проверка (ручная, для человека)**

Из корня (web собран): `$env:ADMIN_PASSWORD='secret'; $env:COOKIE_SECRET='xyz'; npm run dev`, открыть `http://localhost:3000/admin/base`, войти. Проверить: создать категорию; она появляется слева со счётчиком 0; переименовать (✎); создать вторую и подвигать ↑/↓; выбрать категорию → справа панель вопросов; «+ Вопрос» создаёт карточку (чип «Текст», пустой вопрос), счётчик категории растёт; ↑/↓ переставляют вопросы; 🗑 на вопросе (с подтверждением) удаляет; 🗑 на категории с вопросами спрашивает «удалить категорию и N вопросов?» и каскадно удаляет.
(Чип цвета: Текст — фиолет, Картинка — зелёный, Аудио — золото; правка содержимого вопроса появится в Task 7.)

- [ ] **Step 6: Коммит**

```bash
git add web/src/admin/sections/
git commit -m "feat(web): менеджер базы — списки категорий и вопросов (CRUD, move, каскад-удаление)"
```

---

### Task 7: UI — редактор вопроса, медиа, импорт/экспорт

**Files:**
- Create: `web/src/admin/sections/QuestionEditor.svelte`
- Modify: `web/src/admin/sections/Base.svelte`

**Interfaces:**
- Consumes: `bankApi` (Task 5); `Base.svelte` state (Task 6).
- Produces: полностью функциональный менеджер контента под `/admin/base`.

- [ ] **Step 1: Создать QuestionEditor.svelte**

Create `web/src/admin/sections/QuestionEditor.svelte`:
```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import * as api from '../bankApi.js';
  import { bankMediaUrl, type Question, type QType } from '../bankApi.js';
  export let question: Question;
  const dispatch = createEventDispatcher<{ saved: void }>();

  let save: 'idle' | 'saving' | 'saved' = 'idle';
  let timer: ReturnType<typeof setTimeout> | undefined;

  // локальные поля редактирования (инициализируются при смене вопроса)
  let type: QType = question.type;
  let prompt = question.prompt;
  let answer = question.answer;
  let media: string | null = question.media;
  let lastId = question.id;
  $: if (question.id !== lastId) { lastId = question.id; type = question.type; prompt = question.prompt; answer = question.answer; media = question.media; save = 'idle'; }

  async function persist(fields: Partial<Pick<Question, 'type' | 'prompt' | 'answer' | 'media'>>) {
    save = 'saving';
    try { await api.updateQuestion(question.id, fields); save = 'saved'; dispatch('saved'); }
    catch { save = 'idle'; }
  }
  function scheduleSave() {
    save = 'saving';
    clearTimeout(timer);
    timer = setTimeout(() => persist({ type, prompt, answer }), 400);
  }
  async function setType(t: QType) { type = t; await persist({ type: t, prompt, answer }); }

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    save = 'saving';
    try { const { path } = await api.uploadMedia(question.id, file); media = path; save = 'saved'; dispatch('saved'); }
    catch (err) { alert((err as Error).message); save = 'idle'; }
    input.value = '';
  }
  async function clearMedia() { media = null; await persist({ media: null }); }
</script>

<div class="editor">
  <div class="bar">
    <span class="title">Редактор вопроса</span>
    <span class="save save-{save}">{save === 'saving' ? 'Сохранение…' : save === 'saved' ? 'Сохранено ✓' : ''}</span>
  </div>

  <div class="seg">
    {#each (['text', 'image', 'audio'] as QType[]) as t}
      <button class:active={type === t} on:click={() => setType(t)}>
        {t === 'text' ? 'Текст' : t === 'image' ? 'Картинка' : 'Аудио'}
      </button>
    {/each}
  </div>

  {#if type !== 'text'}
    <div class="media">
      {#if media}
        {#if type === 'image'}<img src={bankMediaUrl(media)} alt="" />{/if}
        {#if type === 'audio'}<audio controls src={bankMediaUrl(media)}></audio>{/if}
        <button class="link" on:click={clearMedia}>Убрать файл</button>
      {:else}
        <label class="upload">
          {type === 'image' ? 'Загрузить картинку' : 'Загрузить аудио'}
          <input type="file" accept={type === 'image' ? 'image/*' : 'audio/*'} on:change={onFile} hidden />
        </label>
      {/if}
    </div>
  {/if}

  <label class="field">Текст вопроса
    <textarea rows="3" bind:value={prompt} on:input={scheduleSave}></textarea>
  </label>
  <label class="field">Ответ (видит только ведущий)
    <input class="answer" bind:value={answer} on:input={scheduleSave} />
  </label>
</div>

<style>
  .editor { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .bar { display: flex; justify-content: space-between; align-items: center; }
  .title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .04em; color: var(--text-2); font-size: 12px; }
  .save { font-size: 12px; color: var(--text-3); min-height: 16px; }
  .save-saved { color: var(--ok); }
  .seg { display: inline-flex; gap: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control); padding: 4px; width: fit-content; }
  .seg button { border: none; background: transparent; color: var(--text-2); font: inherit; padding: 6px 14px; border-radius: 8px; cursor: pointer; }
  .seg button.active { background: var(--accent); color: #fff; }
  .media { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .media img { max-width: 320px; max-height: 200px; border-radius: var(--r-control); border: 1px solid var(--border); }
  .upload { display: inline-block; padding: 10px 14px; border: 1px dashed var(--border-accent); border-radius: var(--r-control); color: var(--text-accent); cursor: pointer; }
  .link { background: none; border: none; color: var(--text-3); cursor: pointer; text-decoration: underline; font: inherit; padding: 0; }
  .field { display: flex; flex-direction: column; gap: 6px; color: var(--text-2); font-size: 13px; }
  textarea, .answer { border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 10px 12px; font: inherit; resize: vertical; }
  .answer { color: var(--gold); }
</style>
```

- [ ] **Step 2: Дополнить Base.svelte (редактор + импорт/экспорт)**

Modify `web/src/admin/sections/Base.svelte`:

2a. В блоке `<script>` добавить импорт после `import QuestionList from './QuestionList.svelte';`:
```ts
  import QuestionEditor from './QuestionEditor.svelte';
```

2b. В том же `<script>` добавить реактивную ссылку на выбранный вопрос (после объявления `let selectedQuestionId`):
```ts
  $: selectedQuestion = questions.find(q => q.id === selectedQuestionId) ?? null;
```

2c. В том же `<script>` добавить обработчики импорта/экспорта и автообновление после правки (в конец секции скрипта):
```ts
  async function onImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try { await api.importBank(file); await reloadCategories(); await reloadQuestions(); }
    catch (err) { error = (err as Error).message; }
    input.value = '';
  }
  async function onSaved() { await reloadQuestions(); await reloadCategories(); }
```

2d. В разметке заменить `<header class="bar"> … </header>` на версию с кнопками:
```svelte
  <header class="bar">
    <h1>База вопросов</h1>
    <div class="actions">
      <label class="btn">Импорт<input type="file" accept=".zip,application/zip" on:change={onImport} hidden /></label>
      <a class="btn" href={api.EXPORT_URL}>Экспорт</a>
    </div>
  </header>
```

2e. В разметке внутри `<div class="cols">` сделать три колонки — после `<QuestionList … />` добавить:
```svelte
    {#if selectedQuestion}
      <QuestionEditor question={selectedQuestion} on:saved={onSaved} />
    {/if}
```
и поменять grid на три колонки в стилях: заменить `.cols { … grid-template-columns: 300px 1fr; … }` на:
```css
  .cols { display: grid; grid-template-columns: 280px minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
```

2f. Добавить стили кнопок в `<style>`:
```css
  .actions { display: flex; gap: 8px; }
  .btn { height: 36px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; cursor: pointer; text-decoration: none; }
  .btn:hover { background: var(--cell); }
```

- [ ] **Step 3: Проверка типов и сборка**

Run: `cd web && npx svelte-check --tsconfig ./tsconfig.json && npm run build`
Expected: svelte-check 0 ошибок; сборка успешна.

- [ ] **Step 4: Живая проверка (ручная, для человека)**

Из корня (web собран): `$env:ADMIN_PASSWORD='secret'; $env:COOKIE_SECRET='xyz'; npm run dev`, открыть `http://localhost:3000/admin/base`, войти. Проверить:
1. Выбрать вопрос → справа редактор; ввод текста/ответа → индикатор «Сохранение… → Сохранено ✓»; перезагрузка страницы сохраняет значения.
2. Переключатель типа Текст/Картинка/Аудио; для «Картинка» — загрузка изображения → превью; для «Аудио» — загрузка mp3/ogg → плеер; «Убрать файл» очищает.
3. Загрузка не-картинки в image (напр. .txt) → ошибка (alert), файл не принят.
4. Чип типа на карточке вопроса меняет цвет при смене типа (Текст фиол / Картинка зелёный / Аудио золото).
5. «Экспорт» скачивает `bank.zip`; «Импорт» этого же файла на пустой базе (или другой машине) восстанавливает категории/вопросы/медиа.

- [ ] **Step 5: Коммит**

```bash
git add web/src/admin/sections/
git commit -m "feat(web): редактор вопроса (тип/текст/ответ/медиа, автосейв) + импорт/экспорт банка"
```

---

## Самопроверка плана

**Покрытие спеки (стадия 2a):**
- Таблицы `bank_categories`/`bank_questions` → Task 1.
- `/api/bank/*` CRUD (категории, вопросы, move, cascade-delete) → Task 2.
- Медиа: загрузка (MIME/лимит/санитайз/traversal), отдача (`/media/bank/*`), GC (delete + смена media) → Task 2 (GC) + Task 3 (upload).
- Экспорт/импорт `bank.zip`, слияние по UID, идемпотентность → Task 4.
- Стабильные UID (`crypto.randomUUID()`) на категории и вопросы → Task 1.
- Запрет переноса вопроса между категориями (PUT без `category_id`) → Task 2.
- UI менеджера контента (дерево категорий, карточки вопросов, инлайн-редактор, чипы по типу, превью медиа, импорт/экспорт, автосейв) → Task 6 + Task 7.
- Клиент + `bankMediaUrl` → Task 5.

**Вне стадии (план 2b):** strict-валидация публикации, `game_templates`, сетка/цены, drag&drop, flatten, preflight удаления по ссылающимся играм (в 2a нет игр — удаление вопроса/категории не имеет ссылающихся ячеек; 2b добавит preflight поверх). Заглушка `Builder.svelte` остаётся до 2b.

**Согласованность типов:** серверные `BankCategory`/`BankQuestion` (camelCase в JSON: `categoryId`, `questionCount`) ↔ клиентские `Category`/`Question` (Task 5) совпадают по полям. `gcMedia`/`saveBankMedia`/`isAllowedMime`/`sanitizeBankFilename` определены в `bankMedia.ts` (Task 2/3) и потребляются в `bank.ts`. `exportBank`/`importBank` (Task 4) ↔ репозиторные `allCategoriesForExport`/`allQuestionsForExport`. `bankMediaUrl` (Task 5) ↔ хранимый формат `bank/media/<name>` (Task 3) ↔ роут отдачи `/media/bank/<name>` (стадия движка). `direction: 'up'|'down'` единообразно в repo/routes/api.

**Плейсхолдеры:** отсутствуют — каждый шаг содержит конкретный код/команды/ожидаемый результат.

**Заметка для имплементеров (Task 6/7):** кнопки операций — текстовые («Имя», «Удалить») плюс геометрические стрелки `↑`/`↓` (U+2191/U+2193 — это глифы, НЕ эмодзи, без variation selector). Эмодзи в UI не используются (Global Constraint / хэндофф §9). При желании стрелки и подписи можно заменить инлайн-SVG (хэндофф §9 — Phosphor-эквиваленты), не меняя логику и события компонентов.
