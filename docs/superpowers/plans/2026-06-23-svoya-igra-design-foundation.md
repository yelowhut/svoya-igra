# Дизайн-фундамент «Студия» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить плейсхолдер-тему web в системную токен-базу «Студия» (палитра, self-host шрифты Oswald/Manrope, движение, focus-ring) и перерисовать три общих компонента (Buzzer/Matrix/Scoreboard) под токены, не трогая движок и не редизайня layout экранов.

**Architecture:** Один `web/src/lib/theme.css` несёт все CSS-переменные, `@font-face` (через `@fontsource-variable`), keyframes и `prefers-reduced-motion`. Компоненты используют токены через `var(--…)` и локальные `<style>` вместо инлайн-стилей. Математика кольца фальстарта вынесена в чистый модуль `buzzerRing.ts` с юнит-тестами. Старые неон-переменные временно остаются алиасами и удаляются в финальной задаче миграции.

**Tech Stack:** Svelte 4, Vite 5, TypeScript, vitest 4 (web), `@fontsource-variable/oswald` + `@fontsource-variable/manrope`.

## Global Constraints

- Стек web — Svelte 4 + Vite 5; не вводить React и не менять структуру входов (`index.html`/`play.html`/`board.html`).
- **Движок и сервер не трогаем** — никакие файлы в `src/`, `tests/`, логика фальстарта (`gateway.ts`/`computeBlock`/`offenseCount`) и reducer не меняются.
- **Фальстарт-кольцо рисует фактический срок** из `blockedUntil` (абсолютное время), а НЕ зашитые в дизайне 3 с.
- Шрифты — **self-host** (бандлятся Vite), без обращения к Google Fonts CDN в рантайме.
- Язык UI — русский, на «вы», без канцелярита; имена действий — активным глаголом.
- **`prefers-reduced-motion: reduce` отключает все анимации/переходы** (обязательно).
- Токены — точные значения из `docs/design_handoff_svoya_igra/README.md` §8 (скопированы в Task 1 verbatim).
- К концу плана grep по `web/src` НЕ должен находить: `var(--neon)`, `var(--neon2)`, `#00e5ff`, `Segoe`.
- TDD там, где есть логика; чистая верстка/CSS проверяется сборкой + `svelte-check` + grep.
- Частые коммиты — по одному на задачу.

---

### Task 1: Токен-система и self-host шрифты в theme.css

**Files:**
- Modify: `web/package.json` (зависимости + test-скрипт)
- Modify: `web/src/lib/theme.css` (полный перезапись)

**Interfaces:**
- Consumes: ничего.
- Produces: CSS-переменные (`--bg`, `--panel`, `--surface`, `--surface-2`, `--cell`, `--cell-hover`, `--border`, `--border-accent`, `--text`, `--text-2`, `--text-3`, `--text-4`, `--text-accent`, `--accent`, `--accent-hover`, `--buzzer`, `--gold`, `--ok`, `--ok-light`, `--err`, `--err-light`, `--grad-buzzer`, `--grad-falsestart`, `--grad-rowlabel`, `--r-control`, `--r-card`, `--r-pill`, `--shadow-card`, `--shadow-board`, `--glow-focus`, `--font-display`, `--font-ui`); keyframes `popIn`/`pulseRing`/`spin`; класс `.neon` (акцентный текст); временные алиасы `--neon`/`--neon2`/`--font`. Скрипт `npm test` в `web/`.

- [ ] **Step 1: Установить self-host шрифты**

Run (из каталога `web/`):
```bash
npm install @fontsource-variable/oswald @fontsource-variable/manrope
```
Expected: пакеты добавлены в `dependencies`, `node_modules/@fontsource-variable/*` присутствуют.

- [ ] **Step 2: Добавить test-скрипт в web/package.json**

В `web/package.json` в блок `"scripts"` добавить строку `"test": "vitest run"` (рядом с `dev`/`build`/`preview`). Итог блока:
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest run"
},
```

- [ ] **Step 3: Перезаписать theme.css токен-системой «Студия»**

Полностью заменить содержимое `web/src/lib/theme.css` на:
```css
/* Шрифты — self-host (LAN-офлайн), вариативные, с кириллицей; бандлятся Vite */
@import '@fontsource-variable/oswald';
@import '@fontsource-variable/manrope';

:root {
  /* Поверхности */
  --bg: #08070e;
  --panel: #0e0d16;
  --surface: #15131f;
  --surface-2: #13111c;
  --cell: #16122a;
  --cell-hover: #211a3d;

  /* Бордеры */
  --border: rgba(255, 255, 255, .07);
  --border-strong: rgba(255, 255, 255, .08);
  --border-accent: rgba(124, 92, 255, .30);

  /* Текст */
  --text: #f4f1ff;
  --text-2: rgba(244, 241, 255, .55);
  --text-3: rgba(244, 241, 255, .45);
  --text-4: rgba(244, 241, 255, .30);
  --text-accent: #cdbcff;

  /* Акценты */
  --accent: #7c5cff;
  --accent-hover: #8b6bff;
  --buzzer: #ff2d78;
  --gold: #f5c518;
  --ok: #1fd18e;
  --ok-light: #43e9b0;
  --err: #ff4d4d;
  --err-light: #ff6b6b;

  /* Градиенты */
  --grad-buzzer: radial-gradient(circle at 50% 38%, #ff5a93, #ff2d78 55%, #d10f54);
  --grad-falsestart: radial-gradient(circle at 50% 38%, #ff6b6b, #ff2d2d 55%, #c81e2e);
  --grad-rowlabel: linear-gradient(#1a1530, #15111f);

  /* Радиусы */
  --r-control: 11px;
  --r-card: 16px;
  --r-pill: 999px;

  /* Тени / свечения */
  --shadow-card: 0 24px 60px -20px rgba(0, 0, 0, .5);
  --shadow-board: 0 30px 70px -30px rgba(0, 0, 0, .7);
  --glow-focus: 0 0 0 3px rgba(124, 92, 255, .2);

  /* Типографика */
  --font-display: 'Oswald Variable', 'Oswald', sans-serif;
  --font-ui: 'Manrope Variable', 'Manrope', system-ui, sans-serif;

  /* СОВМЕСТИМОСТЬ со старыми экранами — удаляется в Task 5 */
  --neon: var(--accent);
  --neon2: var(--buzzer);
  --font: var(--font-ui);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
}

h1, h2, h3 {
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: .02em;
}

button { font-family: inherit; }

/* Видимый фокус с клавиатуры */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: var(--glow-focus);
}

/* Акцентный текст (бывшая неон-подсветка) */
.neon { color: var(--accent); }

/* Движение */
@keyframes popIn {
  from { opacity: 0; transform: scale(.96); }
  to { opacity: 1; transform: none; }
}
@keyframes pulseRing {
  0% { box-shadow: 0 0 0 0 rgba(255, 45, 120, .5), 0 18px 50px -8px rgba(255, 45, 120, .7); }
  70% { box-shadow: 0 0 0 22px rgba(255, 45, 120, 0), 0 18px 50px -8px rgba(255, 45, 120, .7); }
  100% { box-shadow: 0 0 0 0 rgba(255, 45, 120, 0), 0 18px 50px -8px rgba(255, 45, 120, .7); }
}
@keyframes spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
}
```

- [ ] **Step 4: Проверить сборку (шрифты бандлятся, тема валидна)**

Run (из `web/`):
```bash
npm run build
```
Expected: сборка проходит без ошибок; в выводе/`dist/assets` присутствуют `.woff2` файлы (Oswald/Manrope бандлятся локально, без сетевых ссылок).

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/src/lib/theme.css
git commit -m "feat(web): токен-система «Студия» + self-host шрифты Oswald/Manrope"
```

---

### Task 2: Buzzer — кольцо фальстарта (TDD) + перерисовка под токены

**Files:**
- Create: `web/src/lib/buzzerRing.ts`
- Test: `web/src/lib/buzzerRing.test.ts`
- Modify: `web/src/lib/Buzzer.svelte` (полная перерисовка)

**Interfaces:**
- Consumes: токены из Task 1 (`--grad-buzzer`, `--grad-falsestart`, `--font-display`, `--font-ui`, `--text-2`).
- Produces: `ringFraction(now: number, start: number, until: number): number` (1→0, кламп [0,1]); `ringDashoffset(fraction: number, circumference: number): number`; `secondsLeft(now: number, until: number): number`. Компонент `Buzzer` со свойством `blockedUntil: number` и событием `press`.

- [ ] **Step 1: Написать падающий тест математики кольца**

Создать `web/src/lib/buzzerRing.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ringFraction, ringDashoffset, secondsLeft } from './buzzerRing.js';

describe('ringFraction', () => {
  it('1 в начале блокировки', () => expect(ringFraction(1000, 1000, 4000)).toBe(1));
  it('0 в конце', () => expect(ringFraction(4000, 1000, 4000)).toBe(0));
  it('0.5 на середине', () => expect(ringFraction(2500, 1000, 4000)).toBeCloseTo(0.5));
  it('клампится после истечения', () => expect(ringFraction(9999, 1000, 4000)).toBe(0));
  it('0 при нулевом/невалидном окне', () => expect(ringFraction(0, 4000, 4000)).toBe(0));
});

describe('ringDashoffset', () => {
  it('полное кольцо при fraction=1 → offset 0', () => expect(ringDashoffset(1, 691)).toBe(0));
  it('пустое кольцо при fraction=0 → offset = C', () => expect(ringDashoffset(0, 691)).toBe(691));
});

describe('secondsLeft', () => {
  it('округляет вверх', () => expect(secondsLeft(1000, 3200)).toBe(3));
  it('не отрицателен', () => expect(secondsLeft(5000, 3000)).toBe(0));
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run (из `web/`):
```bash
npm test -- buzzerRing
```
Expected: FAIL — `Failed to resolve import './buzzerRing.js'` (модуль ещё не создан).

- [ ] **Step 3: Реализовать buzzerRing.ts**

Создать `web/src/lib/buzzerRing.ts`:
```ts
/** Доля оставшегося времени блокировки: 1 в начале → 0 в конце, кламп [0,1]. */
export function ringFraction(now: number, start: number, until: number): number {
  if (until <= start) return 0;
  const f = (until - now) / (until - start);
  return Math.max(0, Math.min(1, f));
}

/** stroke-dashoffset для кольца длиной circumference: fraction=1 → 0 (полное), fraction=0 → C (пустое). */
export function ringDashoffset(fraction: number, circumference: number): number {
  return circumference * (1 - fraction);
}

/** Оставшиеся секунды (округление вверх), не отрицательны. */
export function secondsLeft(now: number, until: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run (из `web/`):
```bash
npm test -- buzzerRing
```
Expected: PASS (9 тестов зелёные).

- [ ] **Step 5: Перерисовать Buzzer.svelte под токены и кольцо**

Полностью заменить `web/src/lib/Buzzer.svelte` на:
```svelte
<script lang="ts">
  export let blockedUntil = 0;
  import { createEventDispatcher, onMount } from 'svelte';
  import { ringFraction, ringDashoffset, secondsLeft } from './buzzerRing.js';
  const dispatch = createEventDispatcher();

  let now = 0;
  onMount(() => {
    const t = setInterval(() => (now = performance.now()), 50);
    return () => clearInterval(t);
  });

  $: blocked = now < blockedUntil;

  // Зафиксировать момент начала блокировки, чтобы рисовать фактический срок (он эскалирующий).
  let blockStart = 0;
  let prevUntil = 0;
  $: if (blockedUntil > prevUntil && blockedUntil > now) {
    blockStart = now;
    prevUntil = blockedUntil;
  }

  const R = 110;
  const C = 2 * Math.PI * R;
  $: frac = ringFraction(now, blockStart, blockedUntil);
  $: dash = ringDashoffset(frac, C);
  $: secs = secondsLeft(now, blockedUntil);
</script>

<div class="wrap">
  <button
    class="buzzer {blocked ? 'is-blocked' : 'is-open'}"
    disabled={blocked}
    on:click={() => dispatch('press')}>
    {#if blocked}
      <svg class="ring" viewBox="0 0 240 240" aria-hidden="true">
        <circle cx="120" cy="120" r={R} fill="none" stroke="rgba(255,255,255,.18)" stroke-width="8" />
        <circle
          cx="120" cy="120" r={R} fill="none" stroke="#fff" stroke-width="8"
          stroke-linecap="round" stroke-dasharray={C} stroke-dashoffset={dash}
          transform="rotate(-90 120 120)" />
      </svg>
      <span class="num">{secs}</span>
    {:else}
      <span class="label">ЖМУ</span>
    {/if}
  </button>
  <div class="caption">{blocked ? 'Фальстарт!' : 'Нажмите, когда откроется'}</div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .buzzer {
    position: relative; width: 240px; height: 240px; border-radius: 50%;
    border: none; cursor: pointer; color: #fff; font-family: var(--font-display);
    display: grid; place-items: center;
  }
  .buzzer.is-open {
    background: var(--grad-buzzer);
    box-shadow: 0 0 0 10px rgba(255, 45, 120, .16), 0 18px 50px -8px rgba(255, 45, 120, .7);
    animation: pulseRing 1.4s infinite;
  }
  .buzzer.is-open:active { transform: scale(.96); }
  .buzzer.is-blocked { background: var(--grad-falsestart); cursor: not-allowed; }
  .label { font-size: 64px; font-weight: 700; letter-spacing: .04em; }
  .num { font-size: 86px; font-weight: 700; }
  .ring { position: absolute; inset: 0; width: 240px; height: 240px; }
  .ring circle { transition: stroke-dashoffset 1s linear; }
  .caption { font-family: var(--font-ui); font-size: 15px; color: var(--text-2); }
</style>
```

- [ ] **Step 6: Проверить сборку и тесты**

Run (из `web/`):
```bash
npm run build && npm test
```
Expected: build проходит; все web-тесты зелёные.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/buzzerRing.ts web/src/lib/buzzerRing.test.ts web/src/lib/Buzzer.svelte
git commit -m "feat(web): buzzer «Студия» — magenta-градиент, pulseRing, кольцо фальстарта на фактический срок"
```

---

### Task 3: Matrix — сетка цен под токены

**Files:**
- Modify: `web/src/lib/Matrix.svelte` (полная перерисовка)

**Interfaces:**
- Consumes: токены Task 1 (`--cell`, `--cell-hover`, `--border`, `--border-accent`, `--r-control`, `--grad-rowlabel`, `--font-display`, `--gold`, `--text`, `--text-4`); внешние свойства существующего компонента (`round`, `usedQuestionIds`, `clickable`) и событие `select` с `{ questionId, value, special }` сохраняются.
- Produces: новое необязательное свойство `selectedId: string | null` (по умолчанию `null` — без подсветки, обратно совместимо). Отыгранная ячейка показывает галочку.

- [ ] **Step 1: Перерисовать Matrix.svelte**

Полностью заменить `web/src/lib/Matrix.svelte` на:
```svelte
<script lang="ts">
  export let round: any;
  export let usedQuestionIds: string[] = [];
  export let selectedId: string | null = null;
  export let clickable = false;
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  const isUsed = (id: string) => usedQuestionIds.includes(id);
</script>

<div class="matrix">
  {#each round?.categories ?? [] as cat}
    <div class="row" style="grid-template-columns:10rem repeat({cat.questions.length}, 1fr)">
      <div class="cat">{cat.name}</div>
      {#each cat.questions as q}
        <button
          class="cell {isUsed(q.id) ? 'used' : ''} {selectedId === q.id ? 'selected' : ''}"
          disabled={!clickable || isUsed(q.id)}
          on:click={() => dispatch('select', { questionId: q.id, value: q.value, special: q.special })}>
          {#if isUsed(q.id)}
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor"
                stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          {:else}
            {q.value}
          {/if}
        </button>
      {/each}
    </div>
  {/each}
</div>

<style>
  .matrix { display: grid; gap: 8px; }
  .row { display: grid; gap: 8px; align-items: center; }
  .cat {
    font-family: var(--font-display); font-weight: 600; font-size: 15px;
    text-transform: uppercase; letter-spacing: .03em; color: var(--text);
    background: var(--grad-rowlabel); border: 1px solid var(--border);
    border-radius: var(--r-control); padding: 12px 14px;
  }
  .cell {
    padding: 16px; background: var(--cell); border: 1px solid var(--border);
    border-radius: var(--r-control); color: var(--gold);
    font-family: var(--font-display); font-size: 26px; font-weight: 700;
    cursor: pointer; transition: background .12s;
  }
  .cell:not(:disabled):hover { background: var(--cell-hover); }
  .cell.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--border-accent); }
  .cell.used { background: #100d1c; color: var(--text-4); cursor: default; }
</style>
```

- [ ] **Step 2: Проверить типы и сборку**

Run (из `web/`):
```bash
npx svelte-check --threshold error && npm run build
```
Expected: 0 ошибок типов; build проходит.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/Matrix.svelte
git commit -m "feat(web): сетка цен «Студия» — золото на ячейках, отыгранные гаснут с галочкой"
```

---

### Task 4: Scoreboard — командный счёт под токены

**Files:**
- Modify: `web/src/lib/Scoreboard.svelte` (полная перерисовка)

**Interfaces:**
- Consumes: токены Task 1 (`--panel`, `--border`, `--gold`, `--err`, `--text`, `--text-2`, `--r-card`, `--shadow-card`, `--font-display`, `--font-ui`); внешнее свойство `teams: { id; name; score }[]` сохраняется.
- Produces: лидер (макс. счёт) подсвечен золотом; отрицательный счёт — красным.

- [ ] **Step 1: Перерисовать Scoreboard.svelte**

Полностью заменить `web/src/lib/Scoreboard.svelte` на:
```svelte
<script lang="ts">
  export let teams: { id: string; name: string; score: number }[] = [];
  $: sorted = [...teams].sort((a, b) => b.score - a.score);
</script>

<div class="board">
  {#each sorted as t, i}
    <div class="team {i === 0 ? 'leader' : ''}">
      <div class="name">{t.name}</div>
      <div class="score" class:neg={t.score < 0}>{t.score}</div>
    </div>
  {/each}
</div>

<style>
  .board { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
  .team {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--r-card); padding: 14px 22px; text-align: center; min-width: 8rem;
  }
  .team.leader { border-color: var(--gold); box-shadow: 0 0 0 1px var(--gold), var(--shadow-card); }
  .name { font-family: var(--font-ui); font-size: 14px; color: var(--text-2); margin-bottom: 6px; }
  /* базовый счёт — золото; не-лидер белым; отрицательный красным (порядок важен для специфичности) */
  .score { font-family: var(--font-display); font-size: 26px; font-weight: 700; color: var(--gold); }
  .team:not(.leader) .score { color: var(--text); }
  .score.neg { color: var(--err); }
</style>
```

- [ ] **Step 2: Проверить типы и сборку**

Run (из `web/`):
```bash
npx svelte-check --threshold error && npm run build
```
Expected: 0 ошибок типов; build проходит.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/Scoreboard.svelte
git commit -m "feat(web): табло счёта «Студия» — лидер золотом, минус красным"
```

---

### Task 5: Миграция host/App.svelte и удаление неон-алиасов

**Files:**
- Modify: `web/src/host/App.svelte` (замена `var(--neon)` → `var(--accent)`)
- Modify: `web/src/lib/theme.css` (удаление алиасов `--neon`/`--neon2`/`--font`)

**Interfaces:**
- Consumes: токен `--accent` из Task 1.
- Produces: финальное состояние — в `web/src` нет `var(--neon)`/`var(--neon2)`/`#00e5ff`/`Segoe`.

- [ ] **Step 1: Заменить ссылки на старый неон-токен в host/App.svelte**

В `web/src/host/App.svelte` заменить **все** вхождения `var(--neon)` на `var(--accent)` (затрагивает строки ~175, 176, 227, 239, 253, 259, 293, 294, 295, 324, 353, 354, 408). Класс `class="neon"` НЕ трогать — он остаётся (определён в theme.css как акцентный текст). `play/App.svelte` и `board/App.svelte` менять не нужно (там только `class="neon"`).

- [ ] **Step 2: Удалить временные алиасы из theme.css**

В `web/src/lib/theme.css` удалить блок совместимости:
```css
  /* СОВМЕСТИМОСТЬ со старыми экранами — удаляется в Task 5 */
  --neon: var(--accent);
  --neon2: var(--buzzer);
  --font: var(--font-ui);
```

- [ ] **Step 3: Проверить, что старого неона не осталось**

Run (из корня репозитория):
```bash
grep -rn -e 'var(--neon)' -e 'var(--neon2)' -e '#00e5ff' -e 'Segoe' web/src
```
Expected: пустой вывод (нет совпадений).

- [ ] **Step 4: Проверить типы, сборку и серверные тесты**

Run:
```bash
cd web && npx svelte-check --threshold error && npm run build && npm test && cd .. && npm test
```
Expected: 0 ошибок типов; web build проходит; web-тесты зелёные; серверные тесты зелёные (без регрессий, движок не менялся).

- [ ] **Step 5: Commit**

```bash
git add web/src/host/App.svelte web/src/lib/theme.css
git commit -m "refactor(web): миграция пульта на токены «Студия», удаление неон-плейсхолдера"
```

---

### Task 6: Живая проверка трёх экранов

**Files:** нет изменений кода (только наблюдение; правки — обратно в соответствующие задачи при находках).

- [ ] **Step 1: Запустить приложение**

Запустить по `docs/run.md` (dev: сервер `npm run dev` в корне + `npm run dev` в `web/`, либо собранный режим). Открыть `/host`, `/play`, `/board`.

- [ ] **Step 2: Сверить визуал «Студии»**

Проверить:
- Фон тёмный `#08070e`, текст светлый; шрифты — Oswald (заголовки/цифры) + Manrope (текст), кириллица отрисована.
- `/board`: сетка цен — золото на ячейках, отыгранные гаснут с галочкой; табло счёта — лидер золотом, минус красным (сверка со `screenshots/04-board.png`).
- `/play`: buzzer открыт — magenta-градиент + пульсация «ЖМУ»; при фальстарте — красный круг, кольцо по ободу отсчитывает фактический срок, подпись «Фальстарт!» (сверка с прототипом `Своя игра - Студия.dc.html`).
- Старого неон-циан вида нигде нет.

- [ ] **Step 3: Проверить доступность и движение**

- Tab по интерактивным элементам — виден focus-ring.
- Включить «уменьшить движение» в ОС/DevTools (`prefers-reduced-motion`) — пульсация buzzer и переход кольца отключаются.

- [ ] **Step 4: Зафиксировать результат**

Если всё совпадает — задача выполнена (кода не меняли). Любое расхождение чинить в соответствующей задаче (1–5) и переснять сборку/тесты.

---

## Self-Review

**Spec coverage:**
- Токен-система (палитра/радиусы/отступы/тени) → Task 1. ✓
- Шрифты Oswald/Manrope self-host → Task 1 (`@fontsource-variable`). ✓
- Движение `popIn`/`pulseRing`/`spin` + `prefers-reduced-motion` → Task 1. ✓
- Глобальный focus-ring → Task 1 (`:focus-visible`). ✓
- Buzzer + кольцо фальстарта на фактический срок → Task 2. ✓
- Matrix (сетка, золото, гаснущие ячейки) → Task 3. ✓
- Scoreboard (лидер золото, минус красный) → Task 4. ✓
- Минимальная правка экранов без редизайна layout → Task 5 (только миграция токенов в host). ✓
- Критерий «нет старого неона» (grep по 4 паттернам) → Task 5 Step 3. ✓
- Живая проверка по run.md + скриншоты/прототип → Task 6. ✓
- Движок/сервер не трогаем → Global Constraints + проверка серверных тестов в Task 5 Step 4. ✓
- Открытый вопрос сабсета шрифтов → закрыт решением `@fontsource-variable` (включает кириллицу). ✓
- Открытый вопрос переменных размеров шрифтов → закрыт (размеры по месту в компонентах, переменными — только цвета/радиусы/тени). ✓

**Placeholder scan:** заглушек нет — каждый шаг содержит полный код/команду и ожидаемый результат.

**Type consistency:** `ringFraction`/`ringDashoffset`/`secondsLeft` определены в Task 2 и используются в Buzzer с теми же именами/сигнатурами. Свойство `selectedId` добавлено в Task 3 с дефолтом (обратная совместимость). Событие `select` Matrix сохраняет прежнюю полезную нагрузку.
