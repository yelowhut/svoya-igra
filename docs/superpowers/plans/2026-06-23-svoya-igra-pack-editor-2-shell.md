# Редактор паков — Стадия 2-shell (админ-оболочка) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять защищённую паролем админ-оболочку `/admin` с левым рейлом «Студия» и клиентским роутингом (`/admin/base`, `/admin/builder` → секции-заглушки; Лобби/Пульт неактивны), на которой далее строятся стадии 2a и 2b.

**Architecture:** Сервер (Fastify v4) получает cookie-сессию: `POST /api/admin/login` сверяет пароль с env и ставит подписанную httpOnly-куку; гард `requireAdmin` (preHandler) защищает будущие админ-API; страница `/admin` и `/admin/*` отдаются всегда (это лишь JS-оболочка), а реальный доступ решается на API — SPA при старте спрашивает `GET /api/admin/session` и показывает либо форму логина, либо рейл. Веб — четвёртый Vite-вход `admin.html` + `web/src/admin/` (Svelte 4), переиспользует токены «Студия» из `web/src/lib/theme.css`.

**Tech Stack:** Node 20 ESM, Fastify 4 + `@fastify/cookie` v9, better-sqlite3 (не трогаем в этой стадии), Svelte 4 + Vite 5, vitest. Сервер-тесты — `app.inject` (light-my-request). Веб-тесты запускаются из `web/`.

## Global Constraints

- **ESM везде**: импорты с расширением `.js` в серверном TS (`from './auth.js'`), как во всей кодовой базе.
- **Fastify 4** → `@fastify/cookie` строго мажор **9** (v10+ требует Fastify 5). Ставить `@fastify/cookie@^9`.
- **Пароль и секрет — из env** (`ADMIN_PASSWORD`, `COOKIE_SECRET`), плейн-текст; дефолты только для дев-режима.
- **Кука**: имя `svoya_admin`, `httpOnly`, `sameSite:'lax'`, **подписанная** (`signed:true`), `path:'/'`.
- **Дизайн**: только токены из `web/src/lib/theme.css` (CSS-переменные `--accent`, `--panel`, `--text`, `--border`, `--r-card`, `--r-control`, `--shadow-card`, `--font-display`, `--font-ui` и т.д.). Левый рейл — 252px. Эмодзи в UI не используются. Текст — русский, кнопки активным глаголом.
- **Веб-тесты** живут в `web/src/**/*.test.ts` и запускаются `cd web && npm test` (корневой `vitest.config.ts` их НЕ включает — он `src/**`, `tests/**`). Тестируемые веб-модули не должны трогать `window`/`location`/`history` на верхнем уровне (нет jsdom).
- **Игровые роуты без auth** (`/host`, `/play`, `/board`, `/api/games`, `/api/packs`, `/media/*`, сокет) — НЕ трогаем.

---

### Task 1: Серверный auth-модуль (cookie-сессия + гард)

**Files:**
- Modify: `package.json` (корень — добавить зависимость `@fastify/cookie`)
- Modify: `src/config.ts`
- Create: `src/http/auth.ts`
- Test: `src/http/auth.test.ts`

**Interfaces:**
- Consumes: `Config` из `src/config.ts` (поля `adminPassword`, `cookieSecret`).
- Produces:
  - `registerAuth(app: FastifyInstance, config: Config): void` — регистрирует `@fastify/cookie` и роуты `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/session`.
  - `requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void>` — preHandler-гард: при отсутствии валидной куки отвечает `401`.
  - Имя куки: `svoya_admin`. Тело логина: `{ password: string }`. Ответы login/session/logout: `{ authenticated: boolean }`; ошибки: `{ error: string }`.

- [ ] **Step 1: Установить зависимость**

Run (из корня репозитория):
```bash
npm install @fastify/cookie@^9
```
Expected: в `package.json` (корень) в `dependencies` появляется `"@fastify/cookie": "^9.x.x"`; установка без ошибок.

- [ ] **Step 2: Добавить env-поля в конфиг**

Modify `src/config.ts` — добавить две строки в объект `config` после `mediaDir`:
```ts
export const config = {
  port: Number(process.env.PORT ?? 3000),
  minReactionMs: Number(process.env.MIN_REACTION_MS ?? 100),
  blockMinMs: Number(process.env.BLOCK_MIN_MS ?? 500),
  blockMaxMs: Number(process.env.BLOCK_MAX_MS ?? 700),
  snapshotEvery: Number(process.env.SNAPSHOT_EVERY ?? 25),
  dbPath: process.env.DB_PATH ?? 'data/game.db',
  mediaDir: process.env.MEDIA_DIR ?? 'data/media',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin',
  cookieSecret: process.env.COOKIE_SECRET ?? 'dev-insecure-cookie-secret-change-me',
};
export type Config = typeof config;
```

- [ ] **Step 3: Написать падающий тест**

Create `src/http/auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerAuth, requireAdmin } from './auth.js';
import { config } from '../config.js';

function makeApp() {
  const app = Fastify({ logger: false });
  registerAuth(app, { ...config, adminPassword: 'secret', cookieSecret: 'test-secret' });
  app.get('/api/_guarded', { preHandler: requireAdmin }, async () => ({ ok: true }));
  return app;
}

function authCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const c = res.cookies.find(x => x.name === 'svoya_admin')!;
  return `${c.name}=${c.value}`;
}

describe('admin auth', () => {
  it('session=false без куки', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/session' });
    expect(res.json()).toEqual({ authenticated: false });
    await app.close();
  });

  it('неверный пароль → 401', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'nope' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('логин ставит куку, session=true с кукой', async () => {
    const app = makeApp();
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    expect(login.statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/api/admin/session', headers: { cookie: authCookie(login) } });
    expect(res.json()).toEqual({ authenticated: true });
    await app.close();
  });

  it('гард: 401 без куки, 200 с кукой', async () => {
    const app = makeApp();
    const noAuth = await app.inject({ method: 'GET', url: '/api/_guarded' });
    expect(noAuth.statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    const ok = await app.inject({ method: 'GET', url: '/api/_guarded', headers: { cookie: authCookie(login) } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    await app.close();
  });

  it('logout присылает куку с пустым значением (сброс)', async () => {
    const app = makeApp();
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    const logout = await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie: authCookie(login) } });
    const cleared = logout.cookies.find(c => c.name === 'svoya_admin');
    expect(cleared?.value).toBe('');
    await app.close();
  });
});
```

- [ ] **Step 4: Запустить тест — убедиться, что падает**

Run: `npx vitest run src/http/auth.test.ts`
Expected: FAIL — модуль `./auth.js` не найден / `registerAuth` не определён.

- [ ] **Step 5: Реализовать auth-модуль**

Create `src/http/auth.ts`:
```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { Config } from '../config.js';

const COOKIE_NAME = 'svoya_admin';

export function registerAuth(app: FastifyInstance, config: Config): void {
  app.register(fastifyCookie, { secret: config.cookieSecret });

  app.post('/api/admin/login', async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (!password || password !== config.adminPassword) {
      return reply.code(401).send({ error: 'неверный пароль' });
    }
    reply.setCookie(COOKIE_NAME, '1', {
      path: '/', httpOnly: true, sameSite: 'lax', signed: true,
    });
    return { authenticated: true };
  });

  app.post('/api/admin/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { authenticated: false };
  });

  app.get('/api/admin/session', async (req) => ({ authenticated: isAuthed(req) }));
}

function isAuthed(req: FastifyRequest): boolean {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return false;
  const r = req.unsignCookie(raw);
  return r.valid && r.value === '1';
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAuthed(req)) {
    reply.code(401).send({ error: 'требуется вход администратора' });
  }
}
```

- [ ] **Step 6: Запустить тест — убедиться, что зелёный**

Run: `npx vitest run src/http/auth.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 7: Коммит**

```bash
git add package.json package-lock.json src/config.ts src/http/auth.ts src/http/auth.test.ts
git commit -m "feat(http): cookie-сессия админа (login/logout/session + гард requireAdmin)"
```

---

### Task 2: Подключить auth в сервер и отдавать `/admin`

**Files:**
- Modify: `src/http/server.ts`
- Test: `src/http/server.test.ts`

**Interfaces:**
- Consumes: `registerAuth` из `src/http/auth.ts`; `deps.config` (уже есть в `ServerDeps`).
- Produces: в `buildServer` зарегистрированы админ-роуты; `GET /admin` и `GET /admin/*` отдают `admin.html` (когда собран `web/dist`). Контракт API не меняется.

- [ ] **Step 1: Написать падающий тест (интеграция через buildServer)**

Modify `src/http/server.test.ts` — добавить в конец файла (внутри верхнего уровня, рядом с существующим `describe`) новый блок:
```ts
describe('admin auth через buildServer', () => {
  function makeAuthedDeps() {
    const db = openDb(':memory:');
    return {
      store: new EventStore(db, 25),
      db,
      config: { ...config, mediaDir: 'data/test-http-media', adminPassword: 'secret', cookieSecret: 'test-secret' },
    };
  }

  it('session=false без куки; после login — session=true', async () => {
    const app = buildServer(makeAuthedDeps());
    const s0 = await app.inject({ method: 'GET', url: '/api/admin/session' });
    expect(s0.json()).toEqual({ authenticated: false });

    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    expect(login.statusCode).toBe(200);
    const c = login.cookies.find(x => x.name === 'svoya_admin')!;

    const s1 = await app.inject({ method: 'GET', url: '/api/admin/session', headers: { cookie: `${c.name}=${c.value}` } });
    expect(s1.json()).toEqual({ authenticated: true });
    await app.close();
  });
});
```
(`openDb`, `EventStore`, `config`, `buildServer` уже импортированы в начале файла — новых импортов не требуется.)

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run src/http/server.test.ts`
Expected: FAIL — `GET /api/admin/session` возвращает 404 (роут ещё не подключён в `buildServer`).

- [ ] **Step 3: Подключить auth и роуты страницы**

Modify `src/http/server.ts`:

3a. Добавить импорт после строки `import { makeEvent } from '../domain/events.js';`:
```ts
import { registerAuth } from './auth.js';
```

3b. Зарегистрировать auth сразу после `app.register(multipart);`:
```ts
  const app = Fastify({ logger: false });
  app.register(multipart);
  registerAuth(app, deps.config);
```

3c. Внутри блока `if (existsSync(webDist)) { ... }`, после строк с `/host`, `/play`, `/board`, добавить:
```ts
    app.get('/admin', (_req, reply) => reply.sendFile('admin.html'));
    app.get('/admin/*', (_req, reply) => reply.sendFile('admin.html'));
```

- [ ] **Step 4: Запустить тест — убедиться, что зелёный**

Run: `npx vitest run src/http/server.test.ts`
Expected: PASS (включая новый блок и все ранее существовавшие тесты).

- [ ] **Step 5: Прогнать весь серверный набор (регрессия)**

Run: `npm test`
Expected: PASS — все тесты (auth + существующие) зелёные.

- [ ] **Step 6: Коммит**

```bash
git add src/http/server.ts src/http/server.test.ts
git commit -m "feat(http): подключить admin-auth в buildServer и отдачу /admin(/*) → admin.html"
```

---

### Task 3: Клиентская утилита маршрута (чистая функция)

**Files:**
- Create: `web/src/admin/route.ts`
- Test: `web/src/admin/route.test.ts`

**Interfaces:**
- Produces:
  - `type AdminRoute = 'base' | 'builder'`
  - `routeFromPath(pathname: string): AdminRoute` — `/admin/builder*` → `'builder'`, всё прочее (включая `/admin`, `/admin/base`) → `'base'`.

Чистый модуль без обращений к `window`/`location` — чтобы тестироваться в node-окружении vitest.

- [ ] **Step 1: Написать падающий тест**

Create `web/src/admin/route.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { routeFromPath } from './route.js';

describe('routeFromPath', () => {
  it('/admin/builder → builder', () => expect(routeFromPath('/admin/builder')).toBe('builder'));
  it('/admin/base → base', () => expect(routeFromPath('/admin/base')).toBe('base'));
  it('/admin → base (по умолчанию)', () => expect(routeFromPath('/admin')).toBe('base'));
  it('неизвестный путь → base', () => expect(routeFromPath('/admin/whatever')).toBe('base'));
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd web && npx vitest run src/admin/route.test.ts`
Expected: FAIL — модуль `./route.js` не найден.

- [ ] **Step 3: Реализовать утилиту**

Create `web/src/admin/route.ts`:
```ts
export type AdminRoute = 'base' | 'builder';

export function routeFromPath(pathname: string): AdminRoute {
  return pathname.startsWith('/admin/builder') ? 'builder' : 'base';
}
```

- [ ] **Step 4: Запустить тест — убедиться, что зелёный**

Run: `cd web && npx vitest run src/admin/route.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Коммит**

```bash
git add web/src/admin/route.ts web/src/admin/route.test.ts
git commit -m "feat(web): чистая утилита routeFromPath для админ-роутинга"
```

---

### Task 4: Admin SPA — вход, левый рейл «Студия», секции-заглушки

**Files:**
- Create: `web/admin.html`
- Modify: `web/vite.config.ts`
- Create: `web/src/admin/main.ts`
- Create: `web/src/admin/api.ts`
- Create: `web/src/admin/router.ts`
- Create: `web/src/admin/Rail.svelte`
- Create: `web/src/admin/sections/Base.svelte`
- Create: `web/src/admin/sections/Builder.svelte`
- Create: `web/src/admin/App.svelte`
- Modify: `docs/run.md`

**Interfaces:**
- Consumes: `routeFromPath`, `AdminRoute` из `web/src/admin/route.ts`.
- Produces (используется стадиями 2a/2b):
  - `web/src/admin/api.ts`: `getSession(): Promise<boolean>`, `login(password: string): Promise<boolean>`, `logout(): Promise<void>`.
  - `web/src/admin/router.ts`: стор `route` (readable `AdminRoute`), `navigate(to: AdminRoute): void`, `initRouter(): void`.
  - `web/src/admin/sections/Base.svelte`, `Builder.svelte` — точки расширения для 2a/2b (сейчас заглушки).

- [ ] **Step 1: Добавить Vite-вход `admin`**

Modify `web/vite.config.ts` — добавить строку в `rollupOptions.input`:
```ts
      input: {
        host: resolve(__dirname, 'index.html'),
        play: resolve(__dirname, 'play.html'),
        board: resolve(__dirname, 'board.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
```
(блок `server.proxy` не трогаем — он уже проксирует `/api` на `http://localhost:3000`.)

- [ ] **Step 2: Создать HTML-вход**

Create `web/admin.html`:
```html
<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Своя игра — Администратор</title></head>
<body><div id="app"></div><script type="module" src="/src/admin/main.ts"></script></body></html>
```

- [ ] **Step 3: Создать точку входа**

Create `web/src/admin/main.ts`:
```ts
import './../lib/theme.css';
import App from './App.svelte';
export default new App({ target: document.getElementById('app')! });
```

- [ ] **Step 4: Создать API-клиент**

Create `web/src/admin/api.ts`:
```ts
interface SessionResponse { authenticated: boolean }

export async function getSession(): Promise<boolean> {
  const r = await fetch('/api/admin/session');
  if (!r.ok) return false;
  return (await r.json() as SessionResponse).authenticated;
}

export async function login(password: string): Promise<boolean> {
  const r = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return r.ok;
}

export async function logout(): Promise<void> {
  await fetch('/api/admin/logout', { method: 'POST' });
}
```

- [ ] **Step 5: Создать роутер (стор + History API)**

Create `web/src/admin/router.ts`:
```ts
import { writable } from 'svelte/store';
import { routeFromPath, type AdminRoute } from './route.js';

export const route = writable<AdminRoute>(routeFromPath(location.pathname));

export function navigate(to: AdminRoute): void {
  const path = to === 'builder' ? '/admin/builder' : '/admin/base';
  if (location.pathname !== path) history.pushState({}, '', path);
  route.set(to);
}

export function initRouter(): void {
  window.addEventListener('popstate', () => route.set(routeFromPath(location.pathname)));
}
```

- [ ] **Step 6: Создать левый рейл**

Create `web/src/admin/Rail.svelte`:
```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { AdminRoute } from './route.js';
  export let current: AdminRoute;
  const dispatch = createEventDispatcher<{ navigate: AdminRoute; logout: void }>();
</script>

<nav class="rail">
  <div class="brand">
    <div class="logo">С</div>
    <div>
      <div class="brand-title">Своя игра</div>
      <div class="brand-sub">Студия · админ</div>
    </div>
  </div>

  <div class="group">
    <div class="group-label">Инструменты</div>
    <button class="item" class:active={current === 'builder'} on:click={() => dispatch('navigate', 'builder')}>Конструктор</button>
    <button class="item" class:active={current === 'base'} on:click={() => dispatch('navigate', 'base')}>База вопросов</button>
  </div>

  <div class="group">
    <div class="group-label">Ведущий</div>
    <button class="item" disabled title="Появится в Sub-project 3">Лобби и команды</button>
    <button class="item" disabled title="Появится в Sub-project 3">Пульт · игра</button>
  </div>

  <button class="logout" on:click={() => dispatch('logout')}>Выйти</button>
</nav>

<style>
  .rail {
    width: 252px; min-height: 100vh; box-sizing: border-box;
    background: var(--panel); border-right: 1px solid var(--border);
    padding: 20px 14px; display: flex; flex-direction: column; gap: 22px;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo {
    width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center;
    font-family: var(--font-display); font-weight: 700; color: #fff;
    background: linear-gradient(135deg, var(--accent), var(--buzzer));
  }
  .brand-title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .04em; }
  .brand-sub { color: var(--text-3); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  .group { display: flex; flex-direction: column; gap: 4px; }
  .group-label { color: var(--text-3); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; padding: 0 8px 4px; }
  .item {
    text-align: left; padding: 10px 12px; border-radius: var(--r-control);
    border: 1px solid transparent; background: transparent; color: var(--text-2);
    font: inherit; cursor: pointer;
  }
  .item:hover:not(:disabled) { background: var(--cell); color: var(--text); }
  .item.active { background: var(--cell-hover); color: var(--text); border-color: var(--border-accent); }
  .item:disabled { color: var(--text-4); cursor: not-allowed; }
  .logout {
    margin-top: auto; padding: 10px 12px; border-radius: var(--r-control);
    border: 1px solid var(--border); background: transparent; color: var(--text-2);
    font: inherit; cursor: pointer;
  }
  .logout:hover { background: var(--cell); color: var(--text); }
</style>
```

- [ ] **Step 7: Создать секции-заглушки**

Create `web/src/admin/sections/Base.svelte`:
```svelte
<section>
  <h1>База вопросов</h1>
  <p class="muted">Здесь появится менеджер базы вопросов (стадия 2a).</p>
</section>

<style>
  h1 { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .02em; margin: 0 0 8px; }
  .muted { color: var(--text-2); }
</style>
```

Create `web/src/admin/sections/Builder.svelte`:
```svelte
<section>
  <h1>Конструктор</h1>
  <p class="muted">Здесь появится конструктор игр (стадия 2b).</p>
</section>

<style>
  h1 { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .02em; margin: 0 0 8px; }
  .muted { color: var(--text-2); }
</style>
```

- [ ] **Step 8: Создать оболочку App**

Create `web/src/admin/App.svelte`:
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { route, navigate, initRouter } from './router.js';
  import { getSession, login, logout } from './api.js';
  import type { AdminRoute } from './route.js';
  import Rail from './Rail.svelte';
  import Base from './sections/Base.svelte';
  import Builder from './sections/Builder.svelte';

  let status: 'loading' | 'login' | 'ready' = 'loading';
  let password = '';
  let loginError = '';

  onMount(async () => {
    initRouter();
    status = (await getSession()) ? 'ready' : 'login';
  });

  async function submitLogin() {
    loginError = '';
    if (await login(password)) {
      password = '';
      status = 'ready';
    } else {
      loginError = 'Неверный пароль';
    }
  }

  async function doLogout() {
    await logout();
    status = 'login';
  }

  function onNavigate(e: CustomEvent<AdminRoute>) { navigate(e.detail); }
</script>

{#if status === 'loading'}
  <div class="center"><p class="muted">Загрузка…</p></div>
{:else if status === 'login'}
  <div class="center">
    <form class="login" on:submit|preventDefault={submitLogin}>
      <h1>Своя игра</h1>
      <p class="muted">Вход администратора</p>
      <input type="password" bind:value={password} placeholder="Пароль" autocomplete="current-password" />
      {#if loginError}<p class="err">{loginError}</p>{/if}
      <button type="submit">Войти</button>
    </form>
  </div>
{:else}
  <div class="shell">
    <Rail current={$route} on:navigate={onNavigate} on:logout={doLogout} />
    <main class="content">
      {#if $route === 'builder'}<Builder />{:else}<Base />{/if}
    </main>
  </div>
{/if}

<style>
  .center { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .muted { color: var(--text-2); }
  .err { color: var(--err); margin: 0; }
  .login {
    display: flex; flex-direction: column; gap: 14px; width: 320px;
    background: var(--panel); padding: 28px; border-radius: var(--r-card);
    border: 1px solid var(--border); box-shadow: var(--shadow-card);
  }
  .login h1 { margin: 0; font-family: var(--font-display); text-transform: uppercase; letter-spacing: .02em; }
  input {
    height: 44px; border-radius: var(--r-control); border: 1px solid var(--border);
    background: var(--surface); color: var(--text); padding: 0 12px; font: inherit;
  }
  .login button {
    height: 44px; border-radius: var(--r-control); border: none; cursor: pointer;
    background: var(--accent); color: #fff; font: inherit; font-weight: 600;
  }
  .login button:hover { background: var(--accent-hover); }
  .shell { display: grid; grid-template-columns: 252px 1fr; min-height: 100vh; }
  .content { padding: 28px; overflow: auto; }
</style>
```

- [ ] **Step 9: Проверка типов и сборка**

Run:
```bash
cd web && npx svelte-check --tsconfig ./tsconfig.json && npm run build
```
Expected: svelte-check без ошибок; `vite build` собирает в т.ч. `dist/admin.html` (увидеть `admin.html` в выводе сборки/в `web/dist`).

- [ ] **Step 10: Живая проверка вручную (e2e)**

Собрать веб (Step 9 уже собрал), затем поднять сервер с заданным паролем и открыть `/admin`:
```powershell
# PowerShell (Windows). Из корня репозитория, web уже собран.
$env:ADMIN_PASSWORD='secret'; $env:COOKIE_SECRET='xyz'; npm run dev
```
Открыть `http://localhost:3000/admin` и проверить:
1. Показана форма входа.
2. Неверный пароль → «Неверный пароль», вход не происходит.
3. Пароль `secret` → появляется левый рейл (Конструктор, База вопросов активны; Лобби/Пульт неактивны) и секция «База вопросов».
4. Клик «Конструктор» → URL становится `/admin/builder`, контент — секция «Конструктор»; «Назад» в браузере → возврат к «База вопросов».
5. Перезагрузка `/admin/builder` → остаётся на «Конструктор» (сервер отдал `admin.html`, сессия валидна).
6. «Выйти» → снова форма входа.

Expected: все 6 пунктов выполняются.

> **Сигнал по пункту 5:** он же проверяет, что роут `/admin/*` перебивает собственный
> wildcard `@fastify/static` (`/*`). Если после reload `/admin/builder` страница вернулась
> к «База вопросов» **или** пришёл 404 — значит `/admin/*` не перехватывает. Фикс:
> вместо `app.get('/admin/*', …)` добавить `app.setNotFoundHandler` в `buildServer`,
> отдающий `admin.html` для `req.url.startsWith('/admin/')`, иначе `reply.code(404)`.

- [ ] **Step 11: Обновить docs/run.md**

Modify `docs/run.md` — добавить в конец файла:
```markdown

## Админ-панель (редактор паков)

Админка живёт на `/admin` (за паролем):
- `http://<ip-сервера>:3000/admin`

Перед запуском задайте переменные окружения:
- `ADMIN_PASSWORD` — пароль администратора (плейн-текст).
- `COOKIE_SECRET` — секрет для подписи сессионной куки (любая длинная случайная строка).

В `docker-compose` пробросьте их через `environment:`. Без переопределения пароль
по умолчанию = `admin`, а секрет куки — фиксированная дев-строка: для прод/LAN
**обязательно задайте свои** значения.
```

- [ ] **Step 12: Коммит**

```bash
git add web/admin.html web/vite.config.ts web/src/admin/ docs/run.md
git commit -m "feat(web): админ-оболочка /admin — вход, левый рейл «Студия», роутинг, секции-заглушки"
```

---

## Самопроверка плана

**Покрытие спеки (стадия 2-shell):**
- `/admin` за паролем, cookie-сессия `@fastify/cookie`, подписанная httpOnly-кука → Task 1.
- `POST /api/admin/login` / `logout` / `GET /api/admin/session` + preHandler-гард → Task 1, подключение в `buildServer` → Task 2.
- Отдача `GET /admin` и `/admin/*` → `admin.html` → Task 2.
- Четвёртый Vite-вход `admin.html` + `web/src/admin/` → Task 4.
- Левый рейл «Студия» (группы Инструменты/Ведущий; Конструктор/База активны, Лобби/Пульт заглушки) → Task 4.
- Клиентский роутинг `/admin/base`, `/admin/builder` → Task 3 (утилита) + Task 4 (стор/навигация/секции).
- Переиспользование `theme.css` (токены) → Task 4 (стили на CSS-переменных).
- env `ADMIN_PASSWORD`, `COOKIE_SECRET` + документация → Task 1 (config) + Task 4 (run.md).

**Вне стадии (будущие планы):** таблицы банка и `/api/bank/*` + UI (2a); `game_templates`, сетка, drag&drop, публикация/flatten (2b). Эти стадии получают отдельные планы и заполняют секции-заглушки `Base.svelte` / `Builder.svelte`.

**Согласованность типов:** `AdminRoute` (`'base'|'builder'`) определён в `route.ts` (Task 3) и используется в `router.ts`, `Rail.svelte`, `App.svelte` (Task 4). API-функции `getSession/login/logout` определены в `api.ts` (Task 4) и там же потребляются. Имя куки `svoya_admin` едино в `auth.ts` и тестах. Сигнатуры `registerAuth`/`requireAdmin` совпадают между Task 1 (определение, тест), Task 2 (использование).

**Плейсхолдеры:** отсутствуют — все шаги содержат конкретный код/команды/ожидаемый результат.
