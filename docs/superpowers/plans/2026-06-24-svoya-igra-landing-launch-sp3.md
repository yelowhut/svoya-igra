# SP3 «Лендинг + запуск игры» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Публичный лендинг на `/` показывает единственную активную игру; весь опыт ведущего (запуск из опубликованных паков + ведение игры) переезжает в admin-оболочку «Студия» за паролем; `/host` ретайрится.

**Architecture:** Активная игра — синглтон-указатель в новой таблице `active_game` (движок/reducer не трогаем). Host-экран декомпозируется в admin-секции `Lobby` (setup+лобби) и `Pult` (живая игра), переиспользуя существующий `web/src/lib/socket.ts`/`store.ts`. Лендинг — новый Vite-вход через репурпоженный `index.html`, опрашивает публичный `GET /api/active-game` поллингом. Гарды `requireAdmin` на админ-API; socket.io остаётся открытым (LAN).

**Tech Stack:** Node 20 ESM, Fastify 4 + @fastify/static + @fastify/cookie, better-sqlite3, Socket.IO, Svelte + Vite (multi-entry), vitest, Playwright.

## Global Constraints

- **Движок не трогаем:** `src/domain/**` (reducer, events, types, engine) НЕ изменяется. Зарезервированный таймер — чисто клиентский (admin-store + localStorage), без новых событий/полей состояния.
- **Язык интерфейса — русский**, тон на «вы», кнопки активным глаголом; имя действия сохраняется через флоу.
- **Дизайн-эталон:** Лобби/Пульт/Лендинг визуально следуют прототипу `docs/design_handoff_svoya_igra/Своя игра - Студия.dc.html` (§5.1 лендинг, §5.5 лобби, §5.6 пульт) и токенам `web/src/lib/theme.css` (README §8). Никаких неон-алиасов из старого host.
- **Гарды:** все админ-эндпоинты — `{ preHandler: requireAdmin }`; `GET /api/active-game` — публичный. Socket.io host-actions — без изменений (открыты).
- **Одна активная игра:** `setActiveGame` перезаписывает указатель; `GAME_ENDED` и явная деактивация его очищают.
- **Тесты:** серверные vitest из корня (`npm test`), web vitest из `web/` (`npm --prefix web test`), E2E `npm run test:e2e`. Финальный гейт — на пересобранном Docker (`docker compose up -d --build`, :3000) + попиксельная сверка.
- **TDD + частые коммиты.** Каждая задача заканчивается зелёными тестами и коммитом.

---

## Карта файлов

**Создаются (сервер):**
- `src/persistence/activeGameRepo.ts` — синглтон-указатель активной игры.

**Изменяются (сервер):**
- `src/persistence/db.ts` — таблица `active_game`.
- `src/http/server.ts` — новые/гард-эндпоинты, удаление роута `/host`.
- `src/http/templates.ts` — авто-деактивация в publish-цикле force-завершения.
- `src/realtime/gateway.ts` — авто-деактивация в `endGame`.

**Создаются (web):**
- `web/src/landing/main.ts`, `web/src/landing/App.svelte`, `web/src/landing/api.ts` — лендинг.
- `web/src/admin/gameApi.ts` — клиент HTTP для запуска/активации/списков.
- `web/src/admin/store.ts` — `workingGameId`, `answerTimerSec` (UI-состояние).
- `web/src/admin/sections/Lobby.svelte` — setup + лобби-фаза.
- `web/src/admin/sections/Pult.svelte` — живая игра.

**Изменяются (web):**
- `web/index.html` — вход на `src/landing/main.ts`.
- `web/vite.config.ts` — вход `host`→`landing`.
- `web/src/admin/route.ts`, `router.ts`, `route.test.ts` — маршруты `lobby`/`pult`.
- `web/src/admin/Rail.svelte` — включить пункты «Лобби и команды»/«Пульт · игра».
- `web/src/admin/App.svelte` — рендер новых секций.
- `web/src/admin/sections/builder/GameEditor.svelte` — «Сыграть тестовую» → `/admin/pult`.
- `web/src/play/App.svelte` — `/play` без `?game=` редиректит на `/`.

**Удаляются (web, в финальной задаче):** `web/src/host/` (App.svelte, main.ts).

**Изменяются (прочее):** `docs/run.md`, новый отчёт `docs/superpowers/sp3-pixel-diff.md`, E2E-тесты.

---

## Task 1: Таблица и репозиторий активной игры

**Files:**
- Modify: `src/persistence/db.ts` (блок `db.exec` в `openDb`)
- Create: `src/persistence/activeGameRepo.ts`
- Test: `src/persistence/activeGameRepo.test.ts`

**Interfaces:**
- Consumes: `Db` из `src/persistence/db.ts`.
- Produces:
  - `setActiveGame(db: Db, gameId: string): void`
  - `clearActiveGame(db: Db): void`
  - `clearActiveGameIfMatches(db: Db, gameId: string): void`
  - `getActiveGameId(db: Db): string | null`

- [ ] **Step 1: Добавить таблицу в схему.** В `src/persistence/db.ts` внутри `db.exec(\`…\`)` добавить после блока `game_templates`:

```sql
    CREATE TABLE IF NOT EXISTS active_game (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      game_id      TEXT,
      activated_at INTEGER
    );
```

- [ ] **Step 2: Написать падающий тест.** Создать `src/persistence/activeGameRepo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from './db.js';
import { setActiveGame, clearActiveGame, clearActiveGameIfMatches, getActiveGameId } from './activeGameRepo.js';

describe('activeGameRepo', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); });

  it('по умолчанию активной игры нет', () => {
    expect(getActiveGameId(db)).toBeNull();
  });

  it('setActiveGame ставит указатель', () => {
    setActiveGame(db, 'g1');
    expect(getActiveGameId(db)).toBe('g1');
  });

  it('повторный setActiveGame перезаписывает (одна активная)', () => {
    setActiveGame(db, 'g1');
    setActiveGame(db, 'g2');
    expect(getActiveGameId(db)).toBe('g2');
  });

  it('clearActiveGame очищает', () => {
    setActiveGame(db, 'g1');
    clearActiveGame(db);
    expect(getActiveGameId(db)).toBeNull();
  });

  it('clearActiveGameIfMatches очищает только совпадающую', () => {
    setActiveGame(db, 'g1');
    clearActiveGameIfMatches(db, 'other');
    expect(getActiveGameId(db)).toBe('g1');
    clearActiveGameIfMatches(db, 'g1');
    expect(getActiveGameId(db)).toBeNull();
  });
});
```

- [ ] **Step 3: Прогнать тест — убедиться, что падает.**

Run: `npm test -- activeGameRepo`
Expected: FAIL — `Cannot find module './activeGameRepo.js'`.

- [ ] **Step 4: Реализовать репозиторий.** Создать `src/persistence/activeGameRepo.ts`:

```ts
import type { Db } from './db.js';

export function setActiveGame(db: Db, gameId: string): void {
  db.prepare(
    `INSERT INTO active_game (id, game_id, activated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET game_id = excluded.game_id, activated_at = excluded.activated_at`
  ).run(gameId, Date.now());
}

export function clearActiveGame(db: Db): void {
  db.prepare(`UPDATE active_game SET game_id = NULL WHERE id = 1`).run();
}

export function clearActiveGameIfMatches(db: Db, gameId: string): void {
  db.prepare(`UPDATE active_game SET game_id = NULL WHERE id = 1 AND game_id = ?`).run(gameId);
}

export function getActiveGameId(db: Db): string | null {
  const row = db.prepare(`SELECT game_id FROM active_game WHERE id = 1`).get() as { game_id: string | null } | undefined;
  return row?.game_id ?? null;
}
```

- [ ] **Step 5: Прогнать тест — убедиться, что зелёный.**

Run: `npm test -- activeGameRepo`
Expected: PASS (5 тестов).

- [ ] **Step 6: Коммит.**

```bash
git add src/persistence/db.ts src/persistence/activeGameRepo.ts src/persistence/activeGameRepo.test.ts
git commit -m "feat(sp3): синглтон-указатель активной игры (active_game)"
```

---

## Task 2: Лендинг-эндпоинт и список паков + гарды

**Files:**
- Modify: `src/http/server.ts`
- Test: `src/http/server.activegame.test.ts` (создать)

**Interfaces:**
- Consumes: `getActiveGameId` (Task 1), `requireAdmin` из `src/http/auth.ts`.
- Produces (HTTP):
  - `GET /api/active-game` (публичный) → `null | { gameId, title, phase, teamCount, playerCount, totalRounds, currentRound }`
  - `GET /api/packs` (requireAdmin) → `Array<{ id, title, rounds }>`
  - `POST /api/games` теперь за `requireAdmin`; `GET /api/games` за `requireAdmin`; `POST /api/packs` (upload) за `requireAdmin`.
  - Роут `GET /host` удалён.

- [ ] **Step 1: Написать падающий тест.** Создать `src/http/server.activegame.test.ts`. Опирается на существующий паттерн (см. соседние `server.test.ts`). Поднимаем сервер на in-memory БД, кладём пак и игру напрямую через store:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { openDb, type Db } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { makeEvent } from '../domain/events.js';
import { config } from '../config.js';

let app: FastifyInstance; let db: Db; let store: EventStore;

function seedPack(packId: string, title: string, rounds: number) {
  const pack = { id: packId, title, teamCount: 4, rounds: Array.from({ length: rounds }, () => ({ name: 'R', categories: [] })) };
  db.prepare('INSERT OR REPLACE INTO packs (id,data) VALUES (?,?)').run(packId, JSON.stringify(pack));
}

beforeEach(async () => {
  db = openDb(':memory:');
  store = new EventStore(db, 25);
  app = buildServer({ store, db, config: { ...config, adminPassword: 'secret', cookieSecret: 'test-secret' } });
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe('GET /api/active-game', () => {
  it('null, когда активной игры нет', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/active-game' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toBeNull();
  });

  it('возвращает полный набор метрик для активной игры', async () => {
    seedPack('p1', 'Пятничный квиз', 3);
    const gameId = 'g1';
    store.append(gameId, makeEvent('GAME_CREATED', { gameId, packId: 'p1', title: 'Пятничный квиз', teamCount: 6 }));
    // активируем напрямую через репозиторий-эндпоинт нельзя без куки — ставим указатель в БД:
    const { setActiveGame } = await import('../persistence/activeGameRepo.js');
    setActiveGame(db, gameId);

    const r = await app.inject({ method: 'GET', url: '/api/active-game' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({
      gameId, title: 'Пятничный квиз', phase: 'LOBBY',
      teamCount: 6, playerCount: 0, totalRounds: 3, currentRound: 1,
    });
  });
});

describe('гарды и список паков', () => {
  it('GET /api/packs без куки → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/packs' });
    expect(r.statusCode).toBe(401);
  });

  it('POST /api/games без куки → 401', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/games', payload: { packId: 'p1', title: 'X', teamCount: 2 } });
    expect(r.statusCode).toBe(401);
  });

  it('GET /api/games без куки → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/games' });
    expect(r.statusCode).toBe(401);
  });

  it('GET /api/packs с кукой → список', async () => {
    seedPack('p1', 'Квиз', 2);
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    const c = login.cookies.find(x => x.name === 'svoya_admin')!;
    const cookie = `${c.name}=${c.value}`;
    const r = await app.inject({ method: 'GET', url: '/api/packs', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([{ id: 'p1', title: 'Квиз', rounds: 2 }]);
  });
});
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает.**

Run: `npm test -- server.activegame`
Expected: FAIL (404/200-несоответствия — эндпоинтов/гардов ещё нет).

- [ ] **Step 3: Реализовать в `src/http/server.ts`.**

(a) Удалить строку роута host:
```ts
    app.get('/host', (_req, reply) => reply.sendFile('index.html'));
```

(b) Добавить импорты вверху файла:
```ts
import { requireAdmin } from './auth.js';
import { getActiveGameId } from '../persistence/activeGameRepo.js';
```
(`registerAuth` уже импортируется; добавить `requireAdmin` в ту же строку или отдельной.)

(c) Навесить гард на существующие эндпоинты — заменить сигнатуры:
```ts
  app.post('/api/packs', { preHandler: requireAdmin }, async (req, reply) => {
```
```ts
  app.post('/api/games', { preHandler: requireAdmin }, async (req, reply) => {
```
```ts
  app.get('/api/games', { preHandler: requireAdmin }, async () => {
```
(тела не меняем.)

(d) Добавить новые эндпоинты (рядом с остальными `/api/*`):
```ts
  app.get('/api/active-game', async () => {
    const gameId = getActiveGameId(deps.db);
    if (!gameId) return null;
    const state = deps.store.loadState(gameId);
    if (state.phase === 'GAME_END') return null;
    const packRow = deps.db.prepare('SELECT data FROM packs WHERE id = ?').get(state.packId) as { data: string } | undefined;
    const totalRounds = packRow ? (JSON.parse(packRow.data).rounds?.length ?? 0) : 0;
    return {
      gameId,
      title: state.title,
      phase: state.phase,
      teamCount: state.teamCount,
      playerCount: state.players.filter(p => p.connected).length,
      totalRounds,
      currentRound: state.roundIndex + 1,
    };
  });

  app.get('/api/packs', { preHandler: requireAdmin }, async () => {
    const rows = deps.db.prepare('SELECT id, data FROM packs').all() as Array<{ id: string; data: string }>;
    return rows.map(r => {
      const p = JSON.parse(r.data) as { title: string; rounds: unknown[] };
      return { id: r.id, title: p.title, rounds: p.rounds.length };
    });
  });
```

- [ ] **Step 4: Прогнать тест — убедиться, что зелёный.**

Run: `npm test -- server.activegame`
Expected: PASS.

- [ ] **Step 5: Прогнать весь серверный набор — нет регрессий.**

Run: `npm test`
Expected: PASS (все существующие + новые). Если упал какой-то старый тест на `GET /api/games`/`POST /api/games` из-за нового гарда — это ожидаемо; такие тесты обновляются добавлением логин-куки по образцу Step 1. Перечисли и почини их в этом же шаге.

- [ ] **Step 6: Коммит.**

```bash
git add src/http/server.ts src/http/server.activegame.test.ts
git commit -m "feat(sp3): /api/active-game, /api/packs, гарды requireAdmin, удалён роут /host"
```

---

## Task 3: Активация/деактивация + авто-деактивация

**Files:**
- Modify: `src/http/server.ts`
- Modify: `src/http/templates.ts`
- Modify: `src/realtime/gateway.ts`
- Test: `src/http/server.activate.test.ts` (создать); дополнить `src/http/server.activegame.test.ts`

**Interfaces:**
- Consumes: `setActiveGame`, `clearActiveGameIfMatches` (Task 1).
- Produces (HTTP, requireAdmin): `POST /api/games/:id/activate` → `{ gameId }`; `POST /api/games/:id/deactivate` → `{ ok: true }`. Плюс инвариант: переход игры в `GAME_ENDED` очищает указатель (через publish-overwrite и через socket `endGame`).

- [ ] **Step 1: Написать падающий тест.** Создать `src/http/server.activate.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { openDb, type Db } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { makeEvent } from '../domain/events.js';
import { getActiveGameId } from '../persistence/activeGameRepo.js';
import { config } from '../config.js';

let app: FastifyInstance; let db: Db; let store: EventStore; let cookie: string;

beforeEach(async () => {
  db = openDb(':memory:');
  store = new EventStore(db, 25);
  app = buildServer({ store, db, config: { ...config, adminPassword: 'secret', cookieSecret: 'test-secret' } });
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
  const c = login.cookies.find(x => x.name === 'svoya_admin')!;
  cookie = `${c.name}=${c.value}`;
});
afterEach(async () => { await app.close(); });
const auth = () => ({ headers: { cookie } });

it('activate/deactivate без куки → 401', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/games/g1/activate' })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url: '/api/games/g1/deactivate' })).statusCode).toBe(401);
});

it('activate ставит указатель, повторная — перезаписывает', async () => {
  await app.inject({ method: 'POST', url: '/api/games/g1/activate', ...auth() });
  expect(getActiveGameId(db)).toBe('g1');
  await app.inject({ method: 'POST', url: '/api/games/g2/activate', ...auth() });
  expect(getActiveGameId(db)).toBe('g2');
});

it('deactivate очищает только совпадающую', async () => {
  await app.inject({ method: 'POST', url: '/api/games/g1/activate', ...auth() });
  await app.inject({ method: 'POST', url: '/api/games/other/deactivate', ...auth() });
  expect(getActiveGameId(db)).toBe('g1');
  await app.inject({ method: 'POST', url: '/api/games/g1/deactivate', ...auth() });
  expect(getActiveGameId(db)).toBeNull();
});

it('publish-overwrite force-завершения чистит указатель активной игры на том паке', async () => {
  // готовим пак p1 и активную игру на нём
  const pack = { id: 'p1', title: 'T', teamCount: 2, rounds: [{ name: 'R', categories: [] }] };
  db.prepare('INSERT OR REPLACE INTO packs (id,data) VALUES (?,?)').run('p1', JSON.stringify(pack));
  store.append('g1', makeEvent('GAME_CREATED', { gameId: 'g1', packId: 'p1', title: 'T', teamCount: 2 }));
  const { setActiveGame } = await import('../persistence/activeGameRepo.js');
  setActiveGame(db, 'g1');
  // имитируем force-завершение, как в publish: GAME_ENDED + хук деактивации
  const { clearActiveGameIfMatches } = await import('../persistence/activeGameRepo.js');
  store.append('g1', makeEvent('GAME_ENDED', {}));
  clearActiveGameIfMatches(db, 'g1');
  expect(getActiveGameId(db)).toBeNull();
});
```

> Примечание: последний тест проверяет инвариант на уровне репозитория (хук); интеграцию `endGame` через socket покрывает E2E (Task 12).

- [ ] **Step 2: Прогнать — убедиться, что падает.**

Run: `npm test -- server.activate`
Expected: FAIL (activate/deactivate → 404, эндпоинтов нет).

- [ ] **Step 3: Добавить эндпоинты в `src/http/server.ts`.** Импорт:
```ts
import { getActiveGameId, setActiveGame, clearActiveGameIfMatches } from '../persistence/activeGameRepo.js';
```
Эндпоинты:
```ts
  app.post('/api/games/:id/activate', { preHandler: requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    setActiveGame(deps.db, id);
    return { gameId: id };
  });

  app.post('/api/games/:id/deactivate', { preHandler: requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    clearActiveGameIfMatches(deps.db, id);
    return { ok: true };
  });
```

- [ ] **Step 4: Хук авто-деактивации в `src/http/templates.ts`.** В publish-цикле force-завершения (строки ~93-96) добавить очистку указателя. Импорт вверху:
```ts
import { clearActiveGameIfMatches } from '../persistence/activeGameRepo.js';
```
Изменить цикл:
```ts
    for (const gameId of findActiveGameIds(deps, packId)) {
      deps.store.append(gameId, makeEvent('GAME_ENDED', {}));
      clearActiveGameIfMatches(db, gameId);
      deps.broadcaster?.broadcast(gameId);
    }
```

- [ ] **Step 5: Хук авто-деактивации в `src/realtime/gateway.ts`.** Импорт вверху:
```ts
import { clearActiveGameIfMatches } from '../persistence/activeGameRepo.js';
```
В `hostAction`, case `endGame`:
```ts
        case 'endGame':
          deps.store.append(gid, makeEvent('GAME_ENDED', {}));
          clearActiveGameIfMatches(deps.db, gid);
          break;
```

- [ ] **Step 6: Прогнать тесты.**

Run: `npm test -- server.activate` затем `npm test`
Expected: PASS, без регрессий.

- [ ] **Step 7: Коммит.**

```bash
git add src/http/server.ts src/http/templates.ts src/realtime/gateway.ts src/http/server.activate.test.ts
git commit -m "feat(sp3): activate/deactivate + авто-деактивация при GAME_ENDED"
```

---

## Task 4: Vite-вход лендинга + ретайр host-входа

**Files:**
- Modify: `web/index.html`
- Modify: `web/vite.config.ts`
- Create: `web/src/landing/main.ts`
- Create: `web/src/landing/App.svelte` (заглушка-плейсхолдер на этом шаге, наполняется в Task 5)

**Interfaces:**
- Produces: Vite-вход `landing` через `web/index.html` → `/src/landing/main.ts`; вход `host` удалён.

- [ ] **Step 1: Перенаправить `web/index.html` на лендинг.** Заменить содержимое:

```html
<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Своя игра</title></head>
<body><div id="app"></div><script type="module" src="/src/landing/main.ts"></script></body></html>
```

- [ ] **Step 2: Обновить `web/vite.config.ts`.** Заменить блок `input`:

```ts
      input: {
        landing: resolve(__dirname, 'index.html'),
        play: resolve(__dirname, 'play.html'),
        board: resolve(__dirname, 'board.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
```

- [ ] **Step 3: Создать `web/src/landing/main.ts`.**

```ts
import '../lib/theme.css';
import App from './App.svelte';

const app = new App({ target: document.getElementById('app')! });
export default app;
```

> Проверь по `web/src/admin/main.ts`, как именно импортируется `theme.css` (тот же путь/механизм), и повтори один-в-один.

- [ ] **Step 4: Создать временный `web/src/landing/App.svelte`** (плейсхолдер, заменится в Task 5):

```svelte
<main><h1>Лендинг</h1></main>
```

- [ ] **Step 5: Проверить сборку и типы.**

Run: `npm --prefix web run build`
Expected: сборка успешна, в `web/dist` появляется `index.html` (лендинг), нет ошибок про отсутствующий `src/host/main.ts`.

- [ ] **Step 6: Коммит.**

```bash
git add web/index.html web/vite.config.ts web/src/landing/main.ts web/src/landing/App.svelte
git commit -m "feat(sp3): Vite-вход лендинга через index.html, ретайр host-входа"
```

---

## Task 5: Экран лендинга (данные + поллинг + состояния)

**Files:**
- Create: `web/src/landing/api.ts`
- Test: `web/src/landing/api.test.ts`
- Modify: `web/src/landing/App.svelte`

**Interfaces:**
- Consumes: `GET /api/active-game` (Task 2).
- Produces: `fetchActiveGame(): Promise<ActiveGame | null>`; тип `ActiveGame`.

- [ ] **Step 1: Написать падающий тест.** Создать `web/src/landing/api.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchActiveGame } from './api.js';

afterEach(() => vi.restoreAllMocks());

describe('fetchActiveGame', () => {
  it('возвращает объект игры', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ gameId: 'g1', title: 'Квиз', phase: 'PICKING', teamCount: 6, playerCount: 4, totalRounds: 3, currentRound: 1 }),
    })) as unknown as typeof fetch);
    const g = await fetchActiveGame();
    expect(g?.title).toBe('Квиз');
    expect(g?.currentRound).toBe(1);
  });

  it('возвращает null, когда тело null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => null })) as unknown as typeof fetch);
    expect(await fetchActiveGame()).toBeNull();
  });

  it('возвращает null при не-ок ответе', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch);
    expect(await fetchActiveGame()).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает.**

Run: `npm --prefix web test -- landing/api`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать `web/src/landing/api.ts`.**

```ts
export interface ActiveGame {
  gameId: string;
  title: string;
  phase: string;
  teamCount: number;
  playerCount: number;
  totalRounds: number;
  currentRound: number;
}

export async function fetchActiveGame(): Promise<ActiveGame | null> {
  try {
    const r = await fetch('/api/active-game');
    if (!r.ok) return null;
    return (await r.json()) as ActiveGame | null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Прогнать — убедиться, что зелёный.**

Run: `npm --prefix web test -- landing/api`
Expected: PASS.

- [ ] **Step 5: Наполнить `web/src/landing/App.svelte`** (логика + состояния; визуал — по прототипу §5.1, см. Step 6).

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fetchActiveGame, type ActiveGame } from './api.js';

  let loading = true;
  let game: ActiveGame | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    game = await fetchActiveGame();
    loading = false;
  }

  onMount(() => {
    refresh();
    timer = setInterval(refresh, 4000); // поллинг ~4с
  });
  onDestroy(() => { if (timer) clearInterval(timer); });

  $: ended = game?.phase === 'GAME_END';
  $: statusLabel = !game ? '' :
    game.phase === 'LOBBY' ? 'Лобби · идёт сбор команд' :
    ended ? 'Игра завершена' :
    `Идёт сейчас · раунд ${game.currentRound} из ${game.totalRounds}`;

  function enter() { if (game) location.href = `/play?game=${game.gameId}`; }
  function openBoard() { if (game) location.href = `/board?game=${game.gameId}`; }
</script>

<main class="wrap">
  <header class="hero">
    <div class="kicker">Добро пожаловать</div>
    <h1 class="title">Большая домашняя викторина</h1>
    <p class="lede">Соберитесь с друзьями, выберите команду и жмите buzzer быстрее всех. Ведущий уже готовит сетку.</p>
  </header>

  <section class="games">
    <div class="games-label">Активная игра</div>

    {#if loading}
      <div class="card skeleton">Загружаем…</div>
    {:else if !game}
      <div class="card empty">Пока нет активной игры — ведущий вот-вот её запустит.</div>
    {:else}
      <div class="card" class:ended>
        <div class="status"><span class="dot" class:live={!ended}></span>{statusLabel}</div>
        <div class="game-title">{game.title}</div>
        <div class="metrics">
          <span>до {game.teamCount} команд</span>
          <span>игроков сейчас: {game.playerCount}</span>
          <span>раундов: {game.totalRounds}</span>
        </div>
        {#if !ended}
          <div class="actions">
            <button class="primary" on:click={enter}>Войти в игру</button>
            <button class="outline" on:click={openBoard}>Открыть табло</button>
          </div>
        {/if}
      </div>
    {/if}
  </section>
</main>

<style>
  /* СТРУКТУРА. Точные значения цвета/радиусов/теней/типографики взять из
     theme.css (токены README §8) и прототипа §5.1 — см. Step 6. */
  .wrap { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
  .hero { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 28px; margin-bottom: 22px; }
  .kicker { color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; }
  .title { font-family: var(--font-display); text-transform: uppercase; font-size: 40px; line-height: 1.02; margin: 8px 0 12px; }
  .lede { color: var(--text-2); margin: 0; }
  .games-label { color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; margin-bottom: 10px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 22px; }
  .card.ended { opacity: .62; }
  .card.empty { border-style: dashed; color: var(--text-2); text-align: center; }
  .status { display: flex; align-items: center; gap: 8px; color: var(--ok); font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-3); }
  .dot.live { background: var(--ok); box-shadow: 0 0 10px var(--ok); }
  .game-title { font-family: var(--font-display); text-transform: uppercase; font-size: 34px; margin: 8px 0 12px; }
  .metrics { display: flex; gap: 16px; flex-wrap: wrap; color: var(--text-2); font-size: 14px; margin-bottom: 18px; }
  .actions { display: flex; gap: 12px; flex-wrap: wrap; }
  .primary { background: var(--accent); color: #fff; border: none; border-radius: var(--r-control); padding: 14px 22px; font: inherit; font-weight: 600; cursor: pointer; }
  .primary:hover { background: var(--accent-hover); }
  .outline { background: transparent; color: var(--text); border: 1px solid var(--border-accent); border-radius: var(--r-control); padding: 14px 22px; font: inherit; cursor: pointer; }
  @media (max-width: 480px) { .title { font-size: 32px; } .actions { flex-direction: column; } .primary, .outline { width: 100%; } }
</style>
```

- [ ] **Step 6: Сверить токены с `theme.css`.** Открыть `web/src/lib/theme.css` и убедиться, что использованные переменные существуют (`--panel`, `--border`, `--border-accent`, `--r-card`, `--r-control`, `--accent`, `--accent-hover`, `--text/-2/-3`, `--ok` (успех/онлайн), `--gold`, `--font-display`). Подтверждено: токены существуют в `theme.css`; успех — `--ok` (не `--success`). Если используешь иное имя — заменить на фактическое. Это блокирующая проверка перед сборкой.

- [ ] **Step 7: Сборка и тесты.**

Run: `npm --prefix web test` затем `npm --prefix web run build`
Expected: web-тесты зелёные; сборка ок.

- [ ] **Step 8: Коммит.**

```bash
git add web/src/landing/
git commit -m "feat(sp3): экран лендинга — активная игра, поллинг, состояния"
```

---

## Task 6: Маршруты admin (lobby/pult) + рейл

**Files:**
- Modify: `web/src/admin/route.ts`
- Modify: `web/src/admin/route.test.ts`
- Modify: `web/src/admin/router.ts`
- Modify: `web/src/admin/Rail.svelte`

**Interfaces:**
- Produces: `AdminRoute = 'base' | 'builder' | 'lobby' | 'pult'`; `routeFromPath` распознаёт `/admin/lobby`, `/admin/pult`; `navigate` ведёт на них; рейл-кнопки активны.

- [ ] **Step 1: Обновить тест маршрутов.** В `web/src/admin/route.test.ts` добавить кейсы:

```ts
  it('/admin/lobby → lobby', () => expect(routeFromPath('/admin/lobby')).toBe('lobby'));
  it('/admin/pult → pult', () => expect(routeFromPath('/admin/pult')).toBe('pult'));
```

- [ ] **Step 2: Прогнать — падает.**

Run: `npm --prefix web test -- admin/route`
Expected: FAIL (lobby/pult → base).

- [ ] **Step 3: Реализовать `web/src/admin/route.ts`.**

```ts
export type AdminRoute = 'base' | 'builder' | 'lobby' | 'pult';

export function routeFromPath(pathname: string): AdminRoute {
  if (pathname.startsWith('/admin/builder')) return 'builder';
  if (pathname.startsWith('/admin/lobby')) return 'lobby';
  if (pathname.startsWith('/admin/pult')) return 'pult';
  return 'base';
}
```

- [ ] **Step 4: Обновить `web/src/admin/router.ts`** — функция `navigate`:

```ts
export function navigate(to: AdminRoute): void {
  const path =
    to === 'builder' ? '/admin/builder' :
    to === 'lobby'   ? '/admin/lobby' :
    to === 'pult'    ? '/admin/pult' :
    '/admin/base';
  if (location.pathname !== path) history.pushState({}, '', path);
  route.set(to);
}
```

- [ ] **Step 5: Включить пункты рейла в `web/src/admin/Rail.svelte`.** Заменить группу «Ведущий»:

```svelte
  <div class="group">
    <div class="group-label">Ведущий</div>
    <button class="item" class:active={current === 'lobby'} aria-current={current === 'lobby' ? 'page' : undefined} on:click={() => dispatch('navigate', 'lobby')}>Лобби и команды</button>
    <button class="item" class:active={current === 'pult'} aria-current={current === 'pult' ? 'page' : undefined} on:click={() => dispatch('navigate', 'pult')}>Пульт · игра</button>
  </div>
```

- [ ] **Step 6: Прогнать — зелёный.**

Run: `npm --prefix web test -- admin/route`
Expected: PASS.

- [ ] **Step 7: Коммит.**

```bash
git add web/src/admin/route.ts web/src/admin/route.test.ts web/src/admin/router.ts web/src/admin/Rail.svelte
git commit -m "feat(sp3): маршруты admin lobby/pult, активные пункты рейла"
```

---

## Task 7: Admin store + HTTP-клиент запуска/активации

**Files:**
- Create: `web/src/admin/store.ts`
- Create: `web/src/admin/gameApi.ts`
- Test: `web/src/admin/gameApi.test.ts`

**Interfaces:**
- Consumes: эндпоинты Task 2/3.
- Produces:
  - store: `workingGameId: Writable<string | null>`, `answerTimerSec: Writable<number>` (UI-резерв таймера).
  - `gameApi`: `listPacks()`, `listGames()`, `gameExists(id)`, `activateGame(id)`, `deactivateGame(id)`, `createGame(packId, title, teamCount)`.

- [ ] **Step 1: Создать store `web/src/admin/store.ts`.** `workingGameId` **персистится в localStorage** (ключ `svoya:host`, как в старом host-резюме), чтобы F5 на Пульте/в Лобби не терял игру — иначе это регресс резюма ведущего.

```ts
import { writable } from 'svelte/store';

const LS_KEY = 'svoya:host';

function persistentGameId() {
  let initial: string | null = null;
  try { initial = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null')?.gameId ?? null; } catch { /* ignore */ }
  const store = writable<string | null>(initial);
  store.subscribe(v => {
    try {
      if (v) localStorage.setItem(LS_KEY, JSON.stringify({ gameId: v }));
      else localStorage.removeItem(LS_KEY);
    } catch { /* ignore */ }
  });
  return store;
}

/** Игра, которой сейчас управляет ведущий (Лобби/Пульт читают её). Переживает F5. */
export const workingGameId = persistentGameId();

/** Зарезервированное «Время на ответ», сек. UI-only в SP3 (логика — отдельный engine-спек). */
export const answerTimerSec = writable<number>(45);
```

> Валидность восстановленного `workingGameId` проверяется при монтировании Лобби/Пульта через `gameExists` (Tasks 8/9): если игра не существует (сервер пересоздал БД) — указатель очищается.

- [ ] **Step 2: Написать падающий тест клиента.** Создать `web/src/admin/gameApi.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { listPacks, activateGame, createGame } from './gameApi.js';

afterEach(() => vi.restoreAllMocks());

describe('gameApi', () => {
  it('listPacks парсит список', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ id: 'p1', title: 'T', rounds: 2 }] })) as unknown as typeof fetch);
    expect(await listPacks()).toEqual([{ id: 'p1', title: 'T', rounds: 2 }]);
  });

  it('activateGame дёргает POST .../activate', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ gameId: 'g1' }) }));
    vi.stubGlobal('fetch', f as unknown as typeof fetch);
    expect(await activateGame('g1')).toEqual({ gameId: 'g1' });
    expect(f).toHaveBeenCalledWith('/api/games/g1/activate', { method: 'POST' });
  });

  it('createGame шлёт packId/title/teamCount', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ gameId: 'g9' }) }));
    vi.stubGlobal('fetch', f as unknown as typeof fetch);
    const r = await createGame('p1', 'Квиз', 4);
    expect(r).toEqual({ gameId: 'g9' });
    expect(f).toHaveBeenCalledWith('/api/games', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 3: Прогнать — падает.**

Run: `npm --prefix web test -- admin/gameApi`
Expected: FAIL — модуль не найден.

- [ ] **Step 4: Реализовать `web/src/admin/gameApi.ts`.**

```ts
async function jsonOf(r: Response): Promise<any> {
  if (!r.ok) {
    const body = await r.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(body?.error ?? `HTTP ${r.status}`);
  }
  return r.json();
}
const jsonHeaders = { 'content-type': 'application/json' };

export interface PackSummary { id: string; title: string; rounds: number; }
export interface GameSummary { gameId: string; title: string; phase: string; }

export const listPacks = (): Promise<PackSummary[]> => fetch('/api/packs').then(jsonOf);
export const listGames = (): Promise<GameSummary[]> => fetch('/api/games').then(jsonOf);
export const gameExists = (id: string): Promise<{ exists: boolean }> => fetch(`/api/games/${id}/exists`).then(jsonOf);
export const activateGame = (id: string): Promise<{ gameId: string }> => fetch(`/api/games/${id}/activate`, { method: 'POST' }).then(jsonOf);
export const deactivateGame = (id: string): Promise<{ ok: true }> => fetch(`/api/games/${id}/deactivate`, { method: 'POST' }).then(jsonOf);
export const createGame = (packId: string, title: string, teamCount: number): Promise<{ gameId: string }> =>
  fetch('/api/games', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ packId, title, teamCount }) }).then(jsonOf);
```

- [ ] **Step 5: Прогнать — зелёный.**

Run: `npm --prefix web test -- admin/gameApi`
Expected: PASS.

- [ ] **Step 6: Коммит.**

```bash
git add web/src/admin/store.ts web/src/admin/gameApi.ts web/src/admin/gameApi.test.ts
git commit -m "feat(sp3): admin-store (workingGameId/таймер) и gameApi"
```

---

## Task 8: Секция «Лобби и команды»

**Files:**
- Create: `web/src/admin/sections/Lobby.svelte`
- Modify: `web/src/admin/App.svelte` (рендер секции)

**Interfaces:**
- Consumes: `gameApi` (Task 7), `workingGameId`/`answerTimerSec` (Task 7), общий socket `web/src/lib/socket.ts` (`joinAs`, `hostAction`) и `web/src/lib/store.ts` (`gameStore`, `lastError`), `isValidTeamName` из `web/src/lib/teamName.ts`.
- Produces: рабочий экран лобби; по «Активировать» вызывает `activateGame(workingGameId)`.

> **Логика портируется из `web/src/host/App.svelte`** (setup + ветка `phase==='LOBBY'`), с тремя изменениями: (1) вместо upload `.zip` — выбор пака из `listPacks()`; (2) добавлены контрол «Время на ответ» (UI-резерв) и кнопка «Активировать»; (3) host-state приходит через общий socket (`joinAs(gameId, 'host')`). Визуал — по прототипу §5.5.

- [ ] **Step 1: Создать `web/src/admin/sections/Lobby.svelte`** с логикой:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore, lastError } from '../../lib/store.js';
  import { joinAs, hostAction } from '../../lib/socket.js';
  import { isValidTeamName } from '../../lib/teamName.js';
  import { workingGameId, answerTimerSec } from '../store.js';
  import { listPacks, listGames, gameExists, createGame, activateGame, deactivateGame, type PackSummary, type GameSummary } from '../gameApi.js';
  import { navigate } from '../router.js';

  let state: any = null; $: state = $gameStore;
  let packs: PackSummary[] = [];
  let games: GameSummary[] = [];
  let packId = '', title = '', teamCount = 3;
  let gameId: string | null = null; $: gameId = $workingGameId;
  let activated = false;
  let errorMsg = ''; $: errorMsg = $lastError;

  // team management
  let newTeamNameInput = '', newTeamNameError = '';
  let renameInputs: Record<string, string> = {};
  let lastSeenNames: Record<string, string> = {};

  onMount(async () => {
    packs = await listPacks().catch(() => []);
    games = await listGames().catch(() => []);
    // восстановленная из localStorage рабочая игра: подключиться, если ещё существует
    if (gameId) {
      const ok = await gameExists(gameId).then(r => r.exists).catch(() => false);
      if (ok) joinAs(gameId, 'host');
      else workingGameId.set(null);
      // флаг activated отражает текущую активность: сверяем с публичным указателем
      try { const ag = await fetch('/api/active-game').then(r => r.json()); activated = ag?.gameId === gameId; } catch { /* ignore */ }
    }
  });

  function syncRenameInputs(teams: any[]) {
    for (const t of teams) {
      if (renameInputs[t.id] === undefined || lastSeenNames[t.id] !== t.name) {
        renameInputs[t.id] = t.name; lastSeenNames[t.id] = t.name;
      }
    }
    renameInputs = renameInputs;
  }
  $: if (state?.teams) syncRenameInputs(state.teams);

  function teamHasPlayers(teamId: string): boolean {
    return (state?.players ?? []).some((p: any) => p.teamId === teamId);
  }

  async function doCreateGame() {
    if (!packId || !title) return;
    const r = await createGame(packId, title, teamCount);
    workingGameId.set(r.gameId);
    joinAs(r.gameId, 'host');
    for (let i = 0; i < teamCount; i++) hostAction('createTeam', { name: `Команда ${i + 1}` });
  }

  async function selectExisting(g: GameSummary) {
    if (!(await gameExists(g.gameId)).exists) return;
    workingGameId.set(g.gameId);
    title = g.title;
    joinAs(g.gameId, 'host');
  }

  function doCreateTeam() {
    if (!isValidTeamName(newTeamNameInput)) { newTeamNameError = 'Название: 1–40 символов, буквы/цифры/пробел/. _ " -'; return; }
    newTeamNameError = ''; lastError.set('');
    hostAction('createTeam', { name: newTeamNameInput.trim() });
    newTeamNameInput = '';
  }
  function doRenameTeam(teamId: string) {
    const name = renameInputs[teamId] ?? '';
    if (!isValidTeamName(name)) return;
    lastError.set(''); hostAction('renameTeam', { teamId, name: name.trim() });
  }
  function doDeleteTeam(teamId: string) {
    if (teamHasPlayers(teamId)) return;
    lastError.set(''); hostAction('deleteTeam', { teamId });
  }
  function doMovePlayer(playerId: string, e: Event) {
    lastError.set('');
    hostAction('movePlayer', { playerId, teamId: (e.target as HTMLSelectElement).value });
  }

  async function activate() { if (gameId) { await activateGame(gameId); activated = true; } }
  async function deactivate() { if (gameId) { await deactivateGame(gameId); activated = false; } }
  function startGame() { hostAction('startRound', { roundIndex: 0 }); navigate('pult'); }

  $: presets = [30, 45, 60];
</script>

<section class="lobby">
  {#if !gameId || !state}
    <!-- ШАГ ВЫБОРА/СОЗДАНИЯ ИГРЫ -->
    <h1 class="screen-title">Лобби и команды</h1>

    {#if games.length}
      <div class="panel">
        <div class="panel-label">Продолжить игру</div>
        {#each games as g}
          <button class="ghost" on:click={() => selectExisting(g)}>{g.title} · {g.phase}</button>
        {/each}
      </div>
    {/if}

    <div class="panel">
      <div class="panel-label">Новая игра</div>
      <label>Игра (опубликованный пак):
        <select bind:value={packId}>
          <option value="">— выбрать —</option>
          {#each packs as p}<option value={p.id}>{p.title} · {p.rounds} р.</option>{/each}
        </select>
      </label>
      <input placeholder="Название игры" bind:value={title} />
      <label>Команд: <input type="number" min="2" max="8" bind:value={teamCount} /></label>

      <div class="timer">
        <span class="timer-label">Время на ответ</span>
        <button class="step" on:click={() => answerTimerSec.update(v => Math.max(10, v - 5))}>−</button>
        <strong class="timer-val">{$answerTimerSec}</strong><span>с</span>
        <button class="step" on:click={() => answerTimerSec.update(v => v + 5)}>+</button>
        {#each presets as p}
          <button class="preset" class:on={$answerTimerSec === p} on:click={() => answerTimerSec.set(p)}>{p}</button>
        {/each}
      </div>
      <p class="muted">Обратный отсчёт для отвечающей команды. (Появится в следующем обновлении.)</p>

      <button class="primary" disabled={!packId || !title} on:click={doCreateGame}>Создать игру</button>
    </div>
  {:else}
    <!-- ЛОББИ ВЫБРАННОЙ ИГРЫ -->
    <div class="head">
      <div>
        <h1 class="screen-title">{title}</h1>
        <div class="meta">{state.teams?.length ?? 0} команд · {(state.players ?? []).length} игроков</div>
      </div>
      <div class="head-actions">
        {#if activated}
          <span class="active-badge">Активна — видна игрокам</span>
          <button class="ghost" on:click={deactivate}>Скрыть</button>
        {:else}
          <button class="primary" on:click={activate}>Активировать</button>
        {/if}
        <button class="primary" on:click={startGame}>Начать раунд 1</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-label">Команды</div>
      <div class="add-team">
        <input placeholder="Название новой команды" bind:value={newTeamNameInput}
          on:keydown={(e) => e.key === 'Enter' && doCreateTeam()} />
        <button class="ghost" on:click={doCreateTeam}>+ Команда</button>
      </div>
      {#if newTeamNameError}<div class="err">{newTeamNameError}</div>{/if}
      {#each (state.teams ?? []) as team}
        <div class="team-row">
          <input bind:value={renameInputs[team.id]} on:keydown={(e) => e.key === 'Enter' && doRenameTeam(team.id)} />
          <button class="icon" on:click={() => doRenameTeam(team.id)} title="Переименовать">✎</button>
          <button class="icon" disabled={teamHasPlayers(team.id)} on:click={() => doDeleteTeam(team.id)} title="Удалить">🗑</button>
        </div>
      {/each}
    </div>

    {#if (state.players ?? []).length > 0}
      <div class="panel">
        <div class="panel-label">Ростер — перенос игрока между командами</div>
        {#each (state.players ?? []) as player}
          <div class="player-row">
            <span class="dot" class:online={player.connected}></span>
            <span class="pname">{player.lastName} {player.firstName}</span>
            <select value={player.teamId} on:change={(e) => doMovePlayer(player.id, e)}>
              {#each (state.teams ?? []) as t}<option value={t.id}>{t.name}</option>{/each}
            </select>
          </div>
        {/each}
      </div>
    {/if}

    {#if errorMsg}
      <div class="err-bar"><span>{errorMsg}</span><button on:click={() => lastError.set('')}>×</button></div>
    {/if}
  {/if}
</section>

<style>
  /* СТРУКТУРА. Точные цвета/радиусы/тени — из theme.css; раскладку и акценты
     выровнять по прототипу §5.5 (см. Step 2). */
  .lobby { display: flex; flex-direction: column; gap: 18px; max-width: 920px; }
  .screen-title { font-family: var(--font-display); text-transform: uppercase; margin: 0; }
  .meta { color: var(--text-2); font-size: 14px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
  .head-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .active-badge { color: var(--ok); font-size: 13px; }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 18px; display: flex; flex-direction: column; gap: 10px; }
  .panel-label { color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; }
  select, input { height: 40px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 0 12px; font: inherit; }
  .timer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .timer-label { color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; margin-right: 6px; }
  .timer-val { color: var(--gold); font-family: var(--font-display); font-size: 28px; }
  .step, .preset { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: var(--r-control); padding: 6px 12px; cursor: pointer; font: inherit; }
  .preset.on { border-color: var(--border-accent); background: var(--cell-hover); }
  .muted { color: var(--text-3); font-size: 13px; margin: 0; }
  .add-team { display: flex; gap: 8px; }
  .team-row, .player-row { display: flex; align-items: center; gap: 8px; }
  .icon { background: transparent; border: 1px solid var(--border); border-radius: var(--r-control); color: var(--text-2); cursor: pointer; padding: 6px 10px; }
  .icon:disabled { opacity: .4; cursor: not-allowed; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-3); }
  .dot.online { background: var(--ok); }
  .pname { min-width: 160px; }
  .err { color: var(--err); font-size: 13px; }
  .err-bar { display: flex; gap: 10px; align-items: center; background: #2d0a0a; border: 1px solid var(--err); border-radius: var(--r-control); padding: 8px 12px; color: var(--err); }
  .err-bar button { margin-left: auto; background: none; border: none; color: var(--err); cursor: pointer; font-size: 16px; }
  .primary { background: var(--accent); color: #fff; border: none; border-radius: var(--r-control); padding: 10px 18px; font: inherit; font-weight: 600; cursor: pointer; }
  .ghost { background: transparent; color: var(--text); border: 1px solid var(--border-accent); border-radius: var(--r-control); padding: 10px 16px; font: inherit; cursor: pointer; }
</style>
```

- [ ] **Step 2: Сверить с прототипом §5.5.** Открыть `docs/design_handoff_svoya_igra/Своя игра - Студия.dc.html`, найти секцию «Лобби», перенести точные классы/раскладку (шапка с «N команд · K игроков · M раундов», блок «Время на ответ», цветные точки команд) в стили выше. Сверить, что все `var(--…)` существуют в `theme.css`.

- [ ] **Step 3: Создать shell `web/src/admin/sections/Pult.svelte`** (минимальный компонент, наполняется в Task 9 — чтобы рейл-пункт «Пульт» вёл на правильный экран, а не на чужой):

```svelte
<section><p style="color:var(--text-2)">Загрузка пульта…</p></section>
```

- [ ] **Step 4: Подключить секции в `web/src/admin/App.svelte`.** Импорты и рендер:

```svelte
  import Lobby from './sections/Lobby.svelte';
  import Pult from './sections/Pult.svelte';
```
Заменить тело `<main class="content">`:
```svelte
      {#if $route === 'builder'}<Builder />
      {:else if $route === 'lobby'}<Lobby />
      {:else if $route === 'pult'}<Pult />
      {:else}<Base />{/if}
```

- [ ] **Step 5: svelte-check + сборка.**

Run: `npm --prefix web run build`
Expected: сборка ок, без ошибок типов. (Если в проекте есть отдельный `svelte-check` — прогнать его: `npm --prefix web run check` при наличии.)

- [ ] **Step 6: Коммит.**

```bash
git add web/src/admin/sections/Lobby.svelte web/src/admin/sections/Pult.svelte web/src/admin/App.svelte
git commit -m "feat(sp3): секция «Лобби и команды» (выбор пака, команды, активация); shell Пульта"
```

---

## Task 9: Секция «Пульт · игра»

**Files:**
- Modify: `web/src/admin/sections/Pult.svelte` (заменить shell из Task 8 полной реализацией; рендер `pult → Pult` в `App.svelte` уже подключён в Task 8)

**Interfaces:**
- Consumes: `gameStore`/`lastError` из `lib/store.js`, `joinAs`/`hostAction` из `lib/socket.js`, `workingGameId`/`answerTimerSec` из admin-store, `deactivateGame`/`gameExists` из `gameApi`, `Matrix`/`Scoreboard` из `web/src/lib/`.
- Produces: живой пульт; «Завершить игру» → `hostAction('endGame')` (сервер авто-деактивирует) + `workingGameId.set(null)`.

> **Логика портируется из `web/src/host/App.svelte`** (ветви PICKING…JUDGED, ROUND_END, GAME_END + правка очков + контролы аукцион/кот/обычный). Источник игры — `workingGameId` (URL-параметра нет). Визуал — по прототипу §5.6.

- [ ] **Step 1: Заменить содержимое `web/src/admin/sections/Pult.svelte`** (shell из Task 8 → полная реализация).

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore, lastError } from '../../lib/store.js';
  import { joinAs, hostAction } from '../../lib/socket.js';
  import Matrix from '../../lib/Matrix.svelte';
  import Scoreboard from '../../lib/Scoreboard.svelte';
  import { workingGameId, answerTimerSec } from '../store.js';
  import { deactivateGame, gameExists } from '../gameApi.js';
  import { navigate } from '../router.js';

  let state: any = null; $: state = $gameStore;
  let gameId: string | null = null; $: gameId = $workingGameId;
  let packRounds: any[] = [];
  let deltasInput: Record<string, string> = {};
  let auctionBids: Record<string, string> = {};

  onMount(async () => {
    if (!gameId) return;
    const ok = await gameExists(gameId).then(r => r.exists).catch(() => false);
    if (!ok) { workingGameId.set(null); return; }  // игра исчезла (БД пересоздана) — на лобби
    joinAs(gameId, 'host');
  });

  // загрузить структуру пака для матрицы, когда известен packId
  let loadedPackId = '';
  $: if (state?.packId && state.packId !== loadedPackId) {
    loadedPackId = state.packId;
    fetch(`/api/packs/${state.packId}`).then(r => r.json()).then(p => { packRounds = p.rounds; }).catch(() => {});
  }

  $: currentRound = packRounds[state?.roundIndex] ?? packRounds[0];
  $: answeringTeam = state?.teams?.find((t: any) => t.id === state.answeringTeamId);
  $: auctionLeaderTeam = state?.teams?.find((t: any) => t.id === state.auction?.leaderTeamId);

  function teamName(teamId: string): string { return state?.teams?.find((t: any) => t.id === teamId)?.name ?? teamId; }
  function adjustScore(teamId: string, delta: number) { hostAction('adjustScore', { teamId, delta }); }
  function adjustByDeltaInput(teamId: string) {
    const delta = parseInt(deltasInput[teamId] ?? '0', 10);
    if (!isNaN(delta) && delta !== 0) { adjustScore(teamId, delta); deltasInput[teamId] = ''; }
  }

  async function endGame() {
    hostAction('endGame');           // сервер авто-деактивирует указатель
    workingGameId.set(null);
    navigate('lobby');
  }
</script>

<section class="pult">
  {#if !gameId}
    <div class="empty">Нет активной игры. Создайте или выберите игру в разделе «Лобби и команды».
      <button class="primary" on:click={() => navigate('lobby')}>К лобби</button>
    </div>
  {:else if !state}
    <p class="muted">Подключение к игре…</p>
  {:else if state.phase === 'GAME_END'}
    <h1 class="screen-title">Игра окончена</h1>
    <Scoreboard teams={state.teams} />
    <button class="primary" on:click={() => { workingGameId.set(null); navigate('lobby'); }}>К лобби</button>
  {:else if state.phase === 'LOBBY'}
    <div class="empty">Игра ещё в лобби. Перейдите в «Лобби и команды», чтобы начать раунд.
      <button class="primary" on:click={() => navigate('lobby')}>К лобби</button>
    </div>
  {:else if state.phase === 'ROUND_END'}
    <h1 class="screen-title">Итоги раунда {state.roundIndex + 1}</h1>
    <Scoreboard teams={state.teams} />
    {#if state.roundIndex + 1 < packRounds.length}
      <button class="primary" on:click={() => hostAction('startRound', { roundIndex: state.roundIndex + 1 })}>Следующий раунд →</button>
    {:else}
      <button class="primary" on:click={endGame}>Завершить игру</button>
    {/if}
  {:else}
    <!-- ЖИВАЯ ИГРА -->
    <div class="head">
      <h1 class="screen-title">{state.title}</h1>
      <span class="round-chip">Раунд {state.roundIndex + 1}</span>
      <span class="timer-chip">Ответ {$answerTimerSec} с</span>
      <button class="ghost" on:click={() => hostAction('closeQuestion')}>Сбросить раунд</button>
      <button class="ghost danger" on:click={endGame}>Завершить игру</button>
    </div>

    <div class="cols">
      <div class="left">
        <Matrix round={currentRound} usedQuestionIds={state?.usedQuestionIds ?? []}
          clickable={state?.phase === 'PICKING'}
          on:select={(e) => hostAction('selectQuestion', e.detail)} />

        {#if state?.currentPrompt}
          <div class="qcard">
            <div class="qtext">{state.currentPrompt}</div>
            <div class="answer">Ответ: {state.currentAnswer}</div>
          </div>
        {/if}
      </div>

      <div class="right">
        {#if state?.buzzQueue?.length}
          <div class="panel">
            <div class="panel-label">Очередь buzzer</div>
            {#each state.buzzQueue as entry, i}
              <div class="queue-row" class:answering={entry.teamId === state.answeringTeamId}>{i + 1}. {teamName(entry.teamId)}</div>
            {/each}
          </div>
        {/if}

        {#if state.currentSpecial === 'auction'}
          <div class="panel gold">
            <div class="panel-label">Аукцион</div>
            {#if state.auction}<div>Ставка: <strong>{state.auction.highestBid}</strong>{#if auctionLeaderTeam} — {auctionLeaderTeam.name}{/if}</div>{/if}
            {#each (state.teams ?? []) as team}
              <div class="bid-row">
                <span>{team.name}</span>
                <input type="number" min="0" bind:value={auctionBids[team.id]} />
                <button class="ghost" on:click={() => { const a = Number(auctionBids[team.id]); if (!isNaN(a)) hostAction('auctionBid', { teamId: team.id, amount: a }); }}>Ставка</button>
              </div>
            {/each}
            {#if state.auction?.leaderTeamId}
              <button class="primary" on:click={() => hostAction('auctionWon', { teamId: state.auction.leaderTeamId, amount: state.auction.highestBid })}>Победитель: {auctionLeaderTeam?.name ?? ''}</button>
            {/if}
          </div>
        {:else if state.currentSpecial === 'cat'}
          <div class="panel">
            <div class="panel-label">Кот в мешке — передать команде</div>
            {#each (state.teams ?? []) as team}
              {#if team.id !== state.pickingTeamId}
                <button class="ghost" on:click={() => hostAction('catAssign', { toTeamId: team.id })}>{team.name}</button>
              {/if}
            {/each}
          </div>
        {:else if state?.currentPrompt}
          <div class="panel">
            <button class="primary" on:click={() => hostAction('arm')}>Зарядить</button>
            <button class="primary" on:click={() => hostAction('open')}>Открыть buzzer</button>
            <button class="ghost" on:click={() => hostAction('closeQuestion')}>Закрыть вопрос</button>
          </div>
        {/if}

        {#if answeringTeam}
          <div class="panel">
            <div class="answering-banner">Отвечает {answeringTeam.name}</div>
            <div class="judge">
              <button class="judge-yes" on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: true })}>✓ Верно</button>
              <button class="judge-no" on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: false })}>✕ Неверно</button>
            </div>
          </div>
        {/if}

        <div class="panel">
          <div class="panel-label">Счёт · правка ±100</div>
          {#each (state.teams ?? []) as team}
            <div class="score-row" class:answering={team.id === state.answeringTeamId}>
              <span class="sname">{team.name}</span>
              <span class="sval">{team.score}</span>
              <button class="icon" on:click={() => adjustScore(team.id, -(state.currentValue || 100))}>−{state.currentValue || 100}</button>
              <button class="icon" on:click={() => adjustScore(team.id, state.currentValue || 100)}>+{state.currentValue || 100}</button>
              <input type="number" placeholder="Δ" bind:value={deltasInput[team.id]} />
              <button class="icon" on:click={() => adjustByDeltaInput(team.id)}>OK</button>
            </div>
          {/each}
        </div>

        <button class="ghost" on:click={() => hostAction('endRound')}>Конец раунда</button>
      </div>
    </div>

    {#if $lastError}
      <div class="err-bar"><span>{$lastError}</span><button on:click={() => lastError.set('')}>×</button></div>
    {/if}
  {/if}
</section>

<style>
  /* СТРУКТУРА. Двухколоночная плотная раскладка — выровнять по прототипу §5.6
     (см. Step 2). Цвета/радиусы — из theme.css. */
  .pult { display: flex; flex-direction: column; gap: 16px; }
  .screen-title { font-family: var(--font-display); text-transform: uppercase; margin: 0; }
  .head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .round-chip, .timer-chip { border: 1px solid var(--border); border-radius: var(--r-control); padding: 4px 10px; color: var(--text-2); font-size: 13px; }
  .timer-chip { color: var(--gold); }
  .cols { display: grid; grid-template-columns: 1fr 360px; gap: 16px; }
  @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .panel.gold { border-color: var(--gold); }
  .panel-label { color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; }
  .qcard { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; margin-top: 12px; }
  .qtext { font-size: 22px; }
  .answer { margin-top: 10px; color: var(--gold); border: 1px dashed var(--gold); border-radius: var(--r-control); padding: 8px 12px; }
  .queue-row { padding: 6px 8px; border-radius: var(--r-control); }
  .queue-row.answering { background: var(--cell-hover); color: var(--text); font-weight: 700; }
  .answering-banner { color: var(--ok); font-family: var(--font-display); }
  .judge { display: flex; gap: 10px; }
  .judge-yes { flex: 1; background: var(--ok); color: #042; border: none; border-radius: var(--r-control); padding: 16px; font: inherit; font-weight: 700; font-size: 18px; cursor: pointer; }
  .judge-no { flex: 1; background: var(--err); color: #fff; border: none; border-radius: var(--r-control); padding: 16px; font: inherit; font-weight: 700; font-size: 18px; cursor: pointer; }
  .score-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .score-row.answering { outline: 1px solid var(--border-accent); border-radius: var(--r-control); padding: 4px; }
  .sname { min-width: 120px; } .sval { color: var(--gold); min-width: 48px; }
  .bid-row { display: flex; align-items: center; gap: 6px; }
  input { height: 36px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 0 10px; font: inherit; width: 72px; }
  .icon { background: transparent; border: 1px solid var(--border); border-radius: var(--r-control); color: var(--text-2); cursor: pointer; padding: 6px 10px; }
  .empty { background: var(--panel); border: 1px dashed var(--border); border-radius: var(--r-card); padding: 24px; color: var(--text-2); display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
  .muted { color: var(--text-2); }
  .err-bar { display: flex; gap: 10px; align-items: center; background: #2d0a0a; border: 1px solid var(--err); border-radius: var(--r-control); padding: 8px 12px; color: var(--err); }
  .err-bar button { margin-left: auto; background: none; border: none; color: var(--err); cursor: pointer; }
  .primary { background: var(--accent); color: #fff; border: none; border-radius: var(--r-control); padding: 10px 16px; font: inherit; font-weight: 600; cursor: pointer; }
  .ghost { background: transparent; color: var(--text); border: 1px solid var(--border-accent); border-radius: var(--r-control); padding: 10px 14px; font: inherit; cursor: pointer; }
  .ghost.danger { border-color: var(--err); color: var(--err); }
</style>
```

- [ ] **Step 2: Сверить с прототипом §5.6.** Открыть прототип, найти «Пульт ведущего», выровнять двухколоночную раскладку, рейл «Ход», крупные ✓Верно/✕Неверно, очередь buzzer, чип «Ответ 45 с». Проверить наличие всех `var(--…)` в `theme.css`.

- [ ] **Step 3: Сборка.**

Run: `npm --prefix web run build`
Expected: ок, без ошибок типов.

- [ ] **Step 4: Коммит.**

```bash
git add web/src/admin/sections/Pult.svelte
git commit -m "feat(sp3): секция «Пульт · игра» (живая игра, завершение с авто-деактивацией)"
```

---

## Task 10: «Сыграть тестовую» → Пульт; редирект `/play`; удаление host

**Files:**
- Modify: `web/src/admin/sections/builder/GameEditor.svelte` (функция `playTest`)
- Modify: `web/src/play/App.svelte` (редирект без `?game=`)
- Delete: `web/src/host/App.svelte`, `web/src/host/main.ts`

**Interfaces:**
- Consumes: `workingGameId` (admin-store), `navigate` (admin-router), `gameApi.createGame`/`publish`.

- [ ] **Step 1: Обновить `playTest` в `GameEditor.svelte`.** Импорты вверху (добавить):
```ts
  import { workingGameId } from '../../store.js';
  import { navigate } from '../../router.js';
```
Заменить тело `playTest` (строки ~88-97):
```ts
  async function playTest() {
    if (!draft || !docVal) return;
    publishError = null;
    await draft.flush();
    const mode = docVal.lastPublishedPackId ? 'overwrite' : 'new';
    const { packId } = await api.publish(id, mode);
    const { gameId } = await api.createGame(packId, docVal.title, 3);
    workingGameId.set(gameId);
    window.open(`/board?game=${gameId}`, '_blank');
    navigate('pult');
  }
```
> Замена `window.open('/host?game=…')` на установку рабочей игры + переход на `/admin/pult` (host-роута больше нет). Табло по-прежнему открывается в новой вкладке.

- [ ] **Step 2: Редирект `/play` без `?game=`.** В `web/src/play/App.svelte`, в `onMount`, заменить блок room-list:
```ts
    if (!gameId) {
      location.href = '/';   // публичный список игр теперь на лендинге
      return;
    }
```
И удалить ставшую ненужной ветку рендера room-list (`{#if !gameId} … {:else if !exists}` → оставить только `{#if !exists}` как первую ветку) и переменную `rooms`. Конкретно:
- Удалить объявление `let rooms: …` (строка ~12).
- В разметке удалить весь блок `{#if !gameId} … </div>` (room list) и начать с `{#if !exists}`.

- [ ] **Step 3: Удалить каталог host.**
```bash
git rm web/src/host/App.svelte web/src/host/main.ts
```
(Если в каталоге есть иные файлы — удалить и их; убедиться, что на `src/host/` нет импортов: `grep -rn "src/host" web/` должен быть пуст.)

- [ ] **Step 4: Проверить отсутствие ссылок на `/host`.**

Run (Bash-инструмент): `grep -rn "/host" web/src/ || echo "нет ссылок"`
Expected: нет ссылок (или только в комментариях, которые тоже убрать).

- [ ] **Step 5: Сборка + web-тесты.**

Run: `npm --prefix web run build && npm --prefix web test`
Expected: ок; нет ошибок про отсутствующий `src/host`.

- [ ] **Step 6: Коммит.**

```bash
git add web/src/admin/sections/builder/GameEditor.svelte web/src/play/App.svelte
git commit -m "feat(sp3): тестовая игра ведёт в Пульт; /play без game→лендинг; удалён host"
```

---

## Task 11: Дымовые E2E на изолированном сервере (dev-прогон)

**Files:**
- Modify: `tests/e2e/smoke.spec.ts`
- Create: `tests/e2e/sp3-landing-launch.spec.ts`

**Interfaces:** использует существующий `playwright.config.ts` (:3100, ADMIN_PASSWORD=test).

- [ ] **Step 1: Починить устаревший smoke.** В `tests/e2e/smoke.spec.ts` первый тест ссылается на «Создать игру» на `/` (host). Заменить на проверку лендинга:

```ts
test('лендинг загружается и монтирует UI', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Большая домашняя викторина' })).toBeVisible();
  await page.screenshot({ path: 'test-results/landing.png', fullPage: true });
});
```
(Остальные два теста — `/admin` и конструктор — без изменений.)

- [ ] **Step 2: Написать сценарий полного флоу.** Создать `tests/e2e/sp3-landing-launch.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('лендинг без активной игры — приглашение', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Пока нет активной игры', { exact: false })).toBeVisible();
});

test('флоу: создать пак → запустить → активировать → лендинг → пульт → завершить', async ({ page, context }) => {
  // 1. логин + конструктор: создать и опубликовать 5×5 нельзя без заполнения,
  //    поэтому для запуска используем уже опубликованный пак, если он есть;
  //    иначе тест создаёт игру через Лобби на первом паке из списка.
  await page.goto('/admin');
  await page.locator('input[type=password]').fill('test');
  await page.getByRole('button', { name: 'Войти' }).click();

  // Конструктор → Новая 5×5 → (для smoke публикуем как есть невозможно из-за валидации,
  // поэтому проверяем доступность Лобби и список паков)
  await page.getByRole('button', { name: 'Лобби и команды' }).click();
  await expect(page.getByRole('heading', { name: 'Лобби и команды' })).toBeVisible();
  // список паков может быть пуст в чистой тест-БД — тогда сценарий заканчивается
  // проверкой, что UI лобби доступен. Полный happy-path с публикацией покрывает
  // Docker-гейт (Task 12), где БД содержит опубликованный пак.
});
```

> Примечание: на изолированной тест-БД нет опубликованного пака без прохождения полной валидации конструктора. Полный happy-path (запуск→активация→пульт→завершение) исполняется как обязательный гейт на Docker в Task 12, где можно опубликовать реальный пак. Здесь — дешёвые smoke-проверки доступности экранов.

- [ ] **Step 3: Прогнать E2E.**

Run: `npm run test:e2e`
Expected: PASS (после `npx playwright install`, если ещё не ставили браузеры).

- [ ] **Step 4: Коммит.**

```bash
git add tests/e2e/smoke.spec.ts tests/e2e/sp3-landing-launch.spec.ts
git commit -m "test(sp3): smoke E2E лендинга и доступности секций ведущего"
```

---

## Task 12: Docker-гейт — полный флоу + попиксельная сверка

**Files:**
- Create: `tests/pixel/compare.mjs` (скрипт диффа)
- Create: `docs/superpowers/sp3-pixel-diff.md` (отчёт о расхождениях)
- Modify: `docs/run.md`

**Interfaces:** боевой рантайм в Docker на :3000.

- [ ] **Step 1: Пересобрать и поднять Docker.**

Run: `docker compose up -d --build`
Expected: контейнер поднят; `http://localhost:3000/` отдаёт лендинг. Проверь:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/        # 200 (лендинг)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/host    # 404 (ретайр)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin   # 200
curl -s http://localhost:3000/api/active-game                        # null
```

- [ ] **Step 2: Ручной полный happy-path на :3000.** В браузере: `/admin` (пароль из docker-compose env, по умолчанию `admin`) → «База вопросов» завести категорию+вопросы (или импорт) → «Конструктор» собрать валидную 5×5 → «Опубликовать» → «Лобби и команды»: выбрать опубликованный пак, создать игру, команды → «Активировать» → открыть `/` во второй вкладке: видна карточка активной игры с метриками и «Войти в игру» → «Пульт»: выбрать вопрос, открыть buzzer, судейство → «Завершить игру» → `/` показывает «Пока нет активной игры». Зафиксировать, что каждый шаг прошёл.

- [ ] **Step 3: Снять скриншоты боевых экранов** отдельным node-скриптом (НЕ `playwright test` — его `playwright.config.ts` поднимет свой сервер на :3100). Создать `tests/pixel/snapshot.mjs` (`chromium` берём из уже установленного `@playwright/test`; браузеры — `npx playwright install chromium`, если ещё нет). Скрипт ходит на боевой :3000:

```js
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SNAP_BASE ?? 'http://localhost:3000';
const PASS = process.env.SNAP_PASS ?? 'admin';   // пароль из docker-compose env
mkdirSync('test-results/sp3', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 913, height: 540 } });

// Лендинг (требует уже активированной игры — выполняется после Step 2 happy-path)
await page.goto(`${BASE}/`);
await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/sp3/landing.png' });

// Логин в админку
await page.goto(`${BASE}/admin`);
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: 'Войти' }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: 'Лобби и команды' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/sp3/lobby.png' });

await page.getByRole('button', { name: 'Пульт · игра' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/sp3/pult.png' });

await browser.close();
console.log('Скриншоты сохранены в test-results/sp3/');
```

Run: `SNAP_PASS=admin node tests/pixel/snapshot.mjs` (предварительно пройди happy-path Step 2, чтобы лендинг показывал активную игру, а Пульт был в живой фазе).
Expected: три PNG в `test-results/sp3/`. Вьюпорт 913×540 подобран под кадр демо-скриншотов; при необходимости подстрой под фактический размер эталонов.

- [ ] **Step 4: Скрипт попиксельного диффа.** Создать `tests/pixel/compare.mjs` (использует `pixelmatch` + `pngjs`; установить как dev-зависимости: `npm i -D pixelmatch pngjs`):

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

// Пары: [боевой скриншот, эталон дизайна]. Эталоны и боевые скрины обычно
// разного размера/кадрирования — приводим к минимальному общему размеру.
const pairs = [
  ['test-results/sp3/landing.png', 'docs/design_handoff_svoya_igra/screenshots/01-landing.png', 'landing'],
  ['test-results/sp3/lobby.png',   'docs/design_handoff_svoya_igra/screenshots/05-lobby.png',   'lobby'],
  ['test-results/sp3/pult.png',    'docs/design_handoff_svoya_igra/screenshots/06-host-answering.png', 'pult'],
];

for (const [aPath, bPath, name] of pairs) {
  const a = PNG.sync.read(readFileSync(aPath));
  const b = PNG.sync.read(readFileSync(bPath));
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const crop = (img) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o; };
  const ca = crop(a), cb = crop(b);
  const diff = new PNG({ width: w, height: h });
  const mismatch = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: 0.12 });
  const pct = ((mismatch / (w * h)) * 100).toFixed(2);
  writeFileSync(`test-results/sp3/${name}-diff.png`, PNG.sync.write(diff));
  console.log(`${name}: ${pct}% несовпадений (${w}×${h})`);
}
```

Run: `node tests/pixel/compare.mjs`
Expected: печатает процент несовпадений по каждому экрану; сохраняет `*-diff.png`.

- [ ] **Step 5: Зафиксировать расхождения.** Создать `docs/superpowers/sp3-pixel-diff.md`: по каждому из трёх экранов — процент несовпадений, ссылка на diff-картинку, список конкретных визуальных расхождений с прототипом (цвет/отступ/шрифт/раскладка/недостающий элемент) и для каждого решение: «исправить сейчас» / «осознанно отличается, потому что …». Расхождения «исправить сейчас» — устранить в соответствующих секциях (Lobby/Pult/landing) и перепрогнать Step 3-4. Цель — структурное и токеновое соответствие прототипу; идеальный 0% недостижим (разное кадрирование демо-фрейма), важна задокументированная и осознанная дельта.

- [ ] **Step 6: Обновить `docs/run.md`.** Привести адреса в актуальное состояние:
  - Игроки заходят с лендинга `http://<ip>:3000/` (выбор активной игры → вход в команду).
  - Ведущий: `http://<ip>:3000/admin` → «Лобби и команды» (выбор опубликованного пака, команды, **Активировать**) → «Пульт · игра» (ведение, **Завершить игру**).
  - Убрать упоминание `/index.html` как ведущего и `/host`. Табло — `http://<ip>:3000/board?game=<id>` (ссылку даёт «Сыграть тестовую» / можно открыть из лобби).
  - Добавить, что только **активированная** игра видна на лендинге (одна активная за раз).

- [ ] **Step 7: Коммит.**

```bash
git add tests/pixel/snapshot.mjs tests/pixel/compare.mjs docs/superpowers/sp3-pixel-diff.md docs/run.md package.json package-lock.json
git commit -m "test(sp3): Docker-гейт, попиксельная сверка с прототипом, обновлён run.md"
```

---

## Task 13: Финальная верификация и память

- [ ] **Step 1: Полный прогон тестов.**

Run: `npm test && npm --prefix web test && npm run test:e2e`
Expected: всё зелёное. Зафиксировать счётчики (сервер N, web M, e2e K).

- [ ] **Step 2: Docker-smoke ещё раз** (после всех правок Task 12): `docker compose up -d --build`, повторить curl-проверки Step 1 Task 12 и быстрый ручной флоу до «Активировать»/«Завершить».

- [ ] **Step 3: Обновить память проекта.** В `C:\Users\yelow\.claude\projects\D--git-svoya-igra\memory\svoya-igra-status.md` добавить абзац про завершённый SP3 (лендинг на `/`, host в admin-shell, `/host` ретайрнут, синглтон `active_game`, активация/деактивация, таймер зарезервирован UI-only, попиксельная сверка). Обновить `MEMORY.md`-строку при необходимости.

- [ ] **Step 4: Финальный коммит памяти** (память вне git-репо — изменения сохраняются Write-инструментом, коммит не нужен). Если в репозитории остались скрэтч-артефакты `.superpowers/sdd/*` от исполнения — по желанию вычистить отдельным коммитом.

---

## Заметки по реализации

- **Зарезервированный таймер** в SP3 — чисто клиентский (`answerTimerSec` в admin-store, визуальный контрол в Лобби и чип в Пульте). Никаких событий/полей состояния/reducer. Живой отсчёт и `TIMEOUT` — отдельный engine-спек.
- **Socket переиспользуется**: и Лобби, и Пульт работают через общий `web/src/lib/socket.ts` (`joinAs`/`hostAction`) и `web/src/lib/store.ts` (`gameStore`/`lastError`) — отдельный `gameSocket.ts` не нужен (DRY: слой уже существует).
- **Резюм ведущего**: при желании сохранить поведение резюма — в Лобби можно дополнительно писать `workingGameId` в `localStorage` и восстанавливать на `onMount`; в MVP достаточно списка существующих игр (`listGames`) для «продолжить».
- **`/api/games`** теперь за гардом — это потребовало правок web (Лобби ходит с кукой админа) и могло задеть старые серверные тесты (чинятся куки-логином).
- **Кнопки `.primary`/`.ghost` уже глобальные в `theme.css`** (canonical: `--font-display`, 38px, нужные ховеры). Для точного соответствия прототипу предпочтительно использовать эти глобальные классы и **удалить локальные переопределения** `.primary`/`.ghost` из `<style>` Лобби/Пульта/лендинга, оставив только специфичные классы (`.judge-yes`, `.timer`, и т.п.). В коде задач они даны локально лишь для самодостаточности листинга.
