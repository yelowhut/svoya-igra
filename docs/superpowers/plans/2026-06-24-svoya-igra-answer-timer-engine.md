# Engine-таймер ответа — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Серверно-авторитетный обратный отсчёт на фазе `ANSWERING`; по истечении команде засчитывается неверный ответ (−цена), ход — следующей в очереди; с паузой/возобновлением/сбросом у ведущего и живым отображением у всех трёх ролей.

**Architecture:** Дедлайн живёт в `GameState`; wall-clock попадает в состояние только через payload событий (`ANSWER_TIMER_STARTED/PAUSED/RESUMED`, `ANSWER_TIMED_OUT`). Reducer чист. Чистая функция `answerTimerDecision(state, now)` решает «что делать с таймером»; gateway-эффект `syncAnswerTimer` интерпретирует решение (аппенд событий + `setTimeout`-карта). Старт отсчёта **state-driven** (инвариант `phase==='ANSWERING' && answerDeadline==null && answerPausedRemainingMs==null`), а не диффинг индекса — поэтому `ANSWER_TIMED_OUT` из колбэка корректно заводит таймер следующей команды.

**Tech Stack:** Node 20 ESM, TypeScript, Fastify + Socket.IO, better-sqlite3 (event sourcing, снэпшот+реплей), Svelte + Vite, vitest, Playwright.

Спека: `docs/superpowers/specs/2026-06-24-svoya-igra-answer-timer-engine-design.md`.

## Global Constraints

- **Reducer чистый** — без `Date.now()`/`Math.random()`/`setTimeout`. Wall-clock только в payload событий (как существующий `goSignal.serverTime`). Нондетерминизм инжектится параметром (паттерн `computeBlock(prev,min,max,Math.random)`).
- **Антифальстарт и дедуп «одно самое быстрое нажатие на команду»** (`validateBuzz`/`computeBlock` в `playerBuzz`, дедуп по `teamId` + min-реакция в `BUZZ_RECORDED`) — **НЕ изменять**.
- **Исход таймаута** — −`currentValue` (как «Неверно»). В UI на факте таймаута копирайт «Время вышло».
- **Номинал** `answerTimerSec`: дефолт **45**, кламп **10–120** на сервере (`POST /api/games`). В reducer `GAME_CREATED`: `payload.answerTimerSec ?? 45` (защита реплея старых событий).
- **Низкое время** на клиенте: `remainingMs <= 10000` → красный/крупный (Oswald gold `#f5c518` → red `#ff6b6b`).
- **Сервер-тесты** запускаются из корня (`npm test`), **web-тесты** — из `web/` (`cd web && npm test`). E2E — `npm run test:e2e`.
- **Скоуп визуала play/board** — только **ANSWERING-виды** по прототипу (зелёный круг игрока, «осталось N с» наблюдателю, «Вы в очереди #N», крупный отсчёт на табло). Прочие фазы play/board не трогаем.
- Каждый таск заканчивается коммитом. Сообщения коммитов — на русском, формат `feat(engine-timer): …` / `test(...)`.

---

## Структура файлов

**Создать:**
- `src/domain/engine/answerTimer.ts` — чистая `answerTimerDecision(state, now)`.
- `src/domain/engine/answerTimer.test.ts` — её тесты.
- `src/domain/engine/reducer.timer.test.ts` — тесты reducer'а по таймер-событиям.
- `web/src/lib/answerTimer.ts` — чистые хелперы отсчёта + ticking-стор.
- `web/src/lib/answerTimer.test.ts` — тесты хелперов.

**Изменить:**
- `src/domain/types.ts` — поля `GameState`.
- `src/domain/engine/state.ts` — инициализация полей.
- `src/persistence/eventStore.ts:37` — бэкфилл снэпшота.
- `src/domain/events.ts` — 4 события + payload `GAME_CREATED`.
- `src/domain/engine/reducer.ts` — `GAME_CREATED` default, helper `nextAttempt`, новые события, сбросы, гарды.
- `src/realtime/protocol.ts` — поля `PublicState` + `serverNow`.
- `src/realtime/gateway.ts` — `syncAnswerTimer`, карта таймеров, host-actions, интеграция.
- `src/index.ts` — восстановление таймера на старте.
- `src/http/server.ts:52-59` — приём+кламп `answerTimerSec`.
- `web/src/admin/gameApi.ts:18-19` — `createGame` шлёт `answerTimerSec`.
- `web/src/admin/sections/Lobby.svelte:56` — передать `$answerTimerSec`.
- `web/src/admin/sections/Pult.svelte` — бейдж отсчёта + пауза/возобновление/сброс + чип из `state`.
- `web/src/play/App.svelte` — ANSWERING-виды.
- `web/src/board/App.svelte` — отсчёт на табло.
- `tests/e2e/smoke.spec.ts` (или новый `tests/e2e/answer-timer.spec.ts`) — E2E таймаута.

---

## Task 1: Поля таймера в GameState + инициализация + бэкфилл снэпшота

**Files:**
- Modify: `src/domain/types.ts:40-59`
- Modify: `src/domain/engine/state.ts:3-13`
- Modify: `src/persistence/eventStore.ts:37`
- Test: `src/persistence/eventStore.test.ts`

**Interfaces:**
- Produces: `GameState.answerTimerSec: number`, `GameState.answerDeadline: number | null`, `GameState.answerPausedRemainingMs: number | null`.

- [ ] **Step 1: Написать падающий тест бэкфилла снэпшота**

Добавить в `src/persistence/eventStore.test.ts`:

```ts
it('loadState бэкфиллит новые поля на старом снэпшоте без них', () => {
  const db = openDb(':memory:');
  const store = new EventStore(db, 25);
  // снэпшот старого формата: state без таймер-полей
  db.prepare('INSERT INTO snapshots (game_id,seq,state) VALUES (?,?,?)')
    .run('g', 1, JSON.stringify({ gameId: 'g', phase: 'LOBBY', teams: [], players: [] }));
  const s = store.loadState('g');
  expect(s.answerTimerSec).toBe(45);
  expect(s.answerDeadline).toBeNull();
  expect(s.answerPausedRemainingMs).toBeNull();
});
```

(Проверить импорт `openDb` в шапке теста; он уже используется в файле.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- eventStore`
Expected: FAIL — `answerTimerSec` is `undefined` (бэкфилла ещё нет; `initialState` тоже ещё без полей).

- [ ] **Step 3: Добавить поля в GameState**

В `src/domain/types.ts`, в конец интерфейса `GameState` (после `blocks: ...;`, перед `}`):

```ts
  blocks: Record<string, number>; // playerId -> кол-во фальстартов (для эскалации)
  answerTimerSec: number;             // номинал отсчёта на ответ, сек
  answerDeadline: number | null;      // epoch-ms истечения текущего отсчёта, либо null
  answerPausedRemainingMs: number | null; // остаток на паузе, либо null
}
```

- [ ] **Step 4: Инициализировать поля**

В `src/domain/engine/state.ts`, в объекте `initialState()` после `lastJudgedTeamId: null, blocks: {},`:

```ts
    lastJudgedTeamId: null, blocks: {},
    answerTimerSec: 45, answerDeadline: null, answerPausedRemainingMs: null,
```

- [ ] **Step 5: Бэкфилл снэпшота в loadState**

В `src/persistence/eventStore.ts`, строка 37, заменить:

```ts
    let state = snap ? (JSON.parse(snap.state) as GameState) : initialState();
```

на:

```ts
    let state = snap
      ? ({ ...initialState(), ...(JSON.parse(snap.state) as Partial<GameState>) } as GameState)
      : initialState();
```

- [ ] **Step 6: Запустить тесты**

Run: `npm test -- eventStore`
Expected: PASS (все, включая новый).

- [ ] **Step 7: Коммит**

```bash
git add src/domain/types.ts src/domain/engine/state.ts src/persistence/eventStore.ts src/persistence/eventStore.test.ts
git commit -m "feat(engine-timer): поля таймера в GameState + бэкфилл снэпшота"
```

---

## Task 2: Объявление таймер-событий + payload GAME_CREATED

**Files:**
- Modify: `src/domain/events.ts:3-26`
- Test: `src/domain/events.test.ts`

**Interfaces:**
- Produces: события `ANSWER_TIMER_STARTED {deadline:number}`, `ANSWER_TIMER_PAUSED {remainingMs:number}`, `ANSWER_TIMER_RESUMED {deadline:number}`, `ANSWER_TIMED_OUT {teamId:string}`; `GAME_CREATED.payload` теперь содержит `answerTimerSec: number`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `src/domain/events.test.ts`:

```ts
it('makeEvent строит таймер-события с типизированным payload', () => {
  const started = makeEvent('ANSWER_TIMER_STARTED', { deadline: 1000 }, () => 'x');
  expect(started.payload.deadline).toBe(1000);
  const out = makeEvent('ANSWER_TIMED_OUT', { teamId: 'a' }, () => 'x');
  expect(out.payload.teamId).toBe('a');
  const created = makeEvent('GAME_CREATED',
    { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec: 60 }, () => 'x');
  expect(created.payload.answerTimerSec).toBe(60);
});
```

(Если в `events.test.ts` нет импорта `makeEvent` — добавить `import { makeEvent } from './events.js';`.)

- [ ] **Step 2: Запустить — убедиться, что падает (тип/компиляция)**

Run: `npm test -- events`
Expected: FAIL — TS-ошибка: типы событий не существуют / `answerTimerSec` не в payload.

- [ ] **Step 3: Добавить события и расширить payload**

В `src/domain/events.ts`. Заменить строку `GAME_CREATED`:

```ts
  | Ev<'GAME_CREATED', { gameId: string; packId: string; title: string; teamCount: number; answerTimerSec: number }>
```

И перед закрывающей `| Ev<'SCORE_ADJUSTED', ...>;` добавить четыре строки:

```ts
  | Ev<'ANSWER_TIMER_STARTED', { deadline: number }>
  | Ev<'ANSWER_TIMER_PAUSED', { remainingMs: number }>
  | Ev<'ANSWER_TIMER_RESUMED', { deadline: number }>
  | Ev<'ANSWER_TIMED_OUT', { teamId: string }>
  | Ev<'SCORE_ADJUSTED', { teamId: string; delta: number }>;
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test -- events`
Expected: PASS.

- [ ] **Step 5: Прогнать всю сборку типов (выявит места, где GAME_CREATED теперь требует поле)**

Run: `npx tsc --noEmit`
Expected: ошибки в местах, где `makeEvent('GAME_CREATED', …)` без `answerTimerSec` — это тесты и `server.ts`. Их чиним в Task 3/Task 10 и попутно в тестах. На этом шаге **только зафиксировать список**; не править чужие таски.

> **Замечание для исполнителя:** существующие тесты, вызывающие `GAME_CREATED` без `answerTimerSec`, начнут падать по типам. Точечно добавить `, answerTimerSec: 45` в эти вызовы в рамках того таска, что первым их затронет (Task 3 правит reducer-тесты, Task 10 — server-тест). Если до тех пор `tsc` мешает — добавить `answerTimerSec: 45` в эти вызовы сразу (механически), коммитом «test: добавлен answerTimerSec в фикстуры GAME_CREATED».

- [ ] **Step 6: Коммит**

```bash
git add src/domain/events.ts src/domain/events.test.ts
git commit -m "feat(engine-timer): 4 таймер-события + answerTimerSec в GAME_CREATED"
```

---

## Task 3: Reducer — GAME_CREATED default + события полей таймера + сбросы на выходах

**Files:**
- Modify: `src/domain/engine/reducer.ts`
- Test: `src/domain/engine/reducer.timer.test.ts` (создать)

**Interfaces:**
- Consumes: события из Task 2, поля из Task 1.
- Produces: reducer пишет `answerTimerSec` из `GAME_CREATED`; `ANSWER_TIMER_STARTED/PAUSED/RESUMED` мутируют поля; `QUESTION_CLOSED`/`ROUND_ENDED`/`GAME_ENDED`/`ANSWER_JUDGED(correct)` обнуляют таймер-поля.

- [ ] **Step 1: Написать падающий тест**

Создать `src/domain/engine/reducer.timer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0; const id = () => `id${n++}`;

function answering() {
  let s = initialState();
  s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec: 30 }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }, id));
  s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
  s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }, id));
  s = applyEvent(s, makeEvent('BUZZER_OPENED', {}, id));
  s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 100 }, id));
  s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'b', reaction: 200 }, id));
  return s; // ANSWERING, idx 0, отвечает a
}

describe('reducer — таймер-поля', () => {
  it('GAME_CREATED пишет answerTimerSec', () => {
    const s = applyEvent(initialState(), makeEvent('GAME_CREATED',
      { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec: 60 }, id));
    expect(s.answerTimerSec).toBe(60);
  });

  it('GAME_CREATED без answerTimerSec → дефолт 45 (защита реплея)', () => {
    const s = applyEvent(initialState(), makeEvent('GAME_CREATED',
      { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 } as any, id));
    expect(s.answerTimerSec).toBe(45);
  });

  it('ANSWER_TIMER_STARTED ставит дедлайн и сбрасывает паузу', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_TIMER_PAUSED', { remainingMs: 5000 }, id));
    s = applyEvent(s, makeEvent('ANSWER_TIMER_STARTED', { deadline: 123456 }, id));
    expect(s.answerDeadline).toBe(123456);
    expect(s.answerPausedRemainingMs).toBeNull();
  });

  it('ANSWER_TIMER_PAUSED замораживает остаток и гасит дедлайн', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_TIMER_STARTED', { deadline: 99999 }, id));
    s = applyEvent(s, makeEvent('ANSWER_TIMER_PAUSED', { remainingMs: 7000 }, id));
    expect(s.answerPausedRemainingMs).toBe(7000);
    expect(s.answerDeadline).toBeNull();
  });

  it('ANSWER_TIMER_RESUMED ставит дедлайн и снимает паузу', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_TIMER_PAUSED', { remainingMs: 7000 }, id));
    s = applyEvent(s, makeEvent('ANSWER_TIMER_RESUMED', { deadline: 222 }, id));
    expect(s.answerDeadline).toBe(222);
    expect(s.answerPausedRemainingMs).toBeNull();
  });

  it('QUESTION_CLOSED обнуляет таймер-поля', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_TIMER_STARTED', { deadline: 99999 }, id));
    s = applyEvent(s, makeEvent('QUESTION_CLOSED', {}, id));
    expect(s.answerDeadline).toBeNull();
    expect(s.answerPausedRemainingMs).toBeNull();
  });

  it('верный ответ обнуляет таймер-поля', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_TIMER_STARTED', { deadline: 99999 }, id));
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: true, value: 100 }, id));
    expect(s.answerDeadline).toBeNull();
  });

  it('PAUSED/RESUMED вне ANSWERING — no-op', () => {
    let s = initialState();
    s = applyEvent(s, makeEvent('ANSWER_TIMER_PAUSED', { remainingMs: 5000 }, id));
    expect(s.answerPausedRemainingMs).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- reducer.timer`
Expected: FAIL (события не обрабатываются; `answerTimerSec` не пишется).

- [ ] **Step 3: Реализовать в reducer**

В `src/domain/engine/reducer.ts`:

(а) В `case 'GAME_CREATED'` (строка 10) добавить запись номинала с дефолтом:

```ts
    case 'GAME_CREATED': {
      const p = event.payload;
      s.gameId = p.gameId; s.packId = p.packId; s.title = p.title; s.teamCount = p.teamCount;
      s.answerTimerSec = p.answerTimerSec ?? 45;
      return s;
    }
```

(б) В `case 'QUESTION_CLOSED'` добавить сброс таймер-полей (после `s.phase = 'PICKING';`):

```ts
      s.phase = 'PICKING';
      s.answerDeadline = null; s.answerPausedRemainingMs = null;
      return s;
```

(в) В `case 'ROUND_ENDED'` и `case 'GAME_ENDED'` — перед `return s;` добавить `s.answerDeadline = null; s.answerPausedRemainingMs = null;`.

(г) Добавить новые case-ветки перед `default:`:

```ts
    case 'ANSWER_TIMER_STARTED':
      if (s.phase !== 'ANSWERING') return s;
      s.answerDeadline = event.payload.deadline;
      s.answerPausedRemainingMs = null;
      return s;
    case 'ANSWER_TIMER_PAUSED':
      if (s.phase !== 'ANSWERING') return s;
      s.answerPausedRemainingMs = event.payload.remainingMs;
      s.answerDeadline = null;
      return s;
    case 'ANSWER_TIMER_RESUMED':
      if (s.phase !== 'ANSWERING') return s;
      s.answerDeadline = event.payload.deadline;
      s.answerPausedRemainingMs = null;
      return s;
```

(`ANSWER_TIMED_OUT` и обнуление в ветке `correct:false` — в Task 4.) Для прохождения теста «верный ответ обнуляет поля» добавить в `case 'ANSWER_JUDGED'` в ветке `if (correct)` сброс:

```ts
      if (correct) { s.phase = 'JUDGED'; s.pickingTeamId = teamId; s.answerDeadline = null; s.answerPausedRemainingMs = null; return s; }
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test -- reducer.timer`
Expected: PASS.

- [ ] **Step 5: Починить типы в существующих reducer-фикстурах**

Если `npx tsc --noEmit` ругается на `GAME_CREATED` без `answerTimerSec` в файлах `src/domain/engine/reducer.*.test.ts` — добавить `, answerTimerSec: 45` в эти вызовы.

Run: `npm test -- reducer`
Expected: PASS (все reducer-тесты).

- [ ] **Step 6: Коммит**

```bash
git add src/domain/engine/reducer.ts src/domain/engine/reducer.timer.test.ts src/domain/engine/reducer.*.test.ts
git commit -m "feat(engine-timer): reducer — answerTimerSec + STARTED/PAUSED/RESUMED + сбросы"
```

---

## Task 4: Reducer — helper nextAttempt + ANSWER_TIMED_OUT (рефактор ветки «Неверно»)

**Files:**
- Modify: `src/domain/engine/reducer.ts:72-82` (`ANSWER_JUDGED`)
- Test: `src/domain/engine/reducer.timer.test.ts`

**Interfaces:**
- Consumes: `nextAnsweringIndex` (`./rules.js`), поля Task 1.
- Produces: общий переход `nextAttempt(s, teamId)`; `ANSWER_TIMED_OUT` даёт −`currentValue` + переход к следующему/`JUDGED` + сброс таймер-полей; идентичность исхода ветке `correct:false`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `src/domain/engine/reducer.timer.test.ts` внутрь `describe`:

```ts
it('ANSWER_TIMED_OUT = −цена + ход следующему + сброс таймера', () => {
  let s = answering(); // a отвечает, очередь [a,b]
  s = applyEvent(s, makeEvent('ANSWER_TIMER_STARTED', { deadline: 99999 }, id));
  s = applyEvent(s, makeEvent('ANSWER_TIMED_OUT', { teamId: 'a' }, id));
  expect(s.teams.find(t => t.id === 'a')!.score).toBe(-100); // −currentValue
  expect(s.phase).toBe('ANSWERING');
  expect(s.answeringIndex).toBe(1);                          // ход b
  expect(s.answerDeadline).toBeNull();                       // сброшен (новый заведёт gateway)
  expect(s.answerPausedRemainingMs).toBeNull();
});

it('ANSWER_TIMED_OUT последней в очереди → JUDGED', () => {
  let s = answering();
  s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: false, value: 100 }, id)); // a мимо → b
  s = applyEvent(s, makeEvent('ANSWER_TIMER_STARTED', { deadline: 99999 }, id));
  s = applyEvent(s, makeEvent('ANSWER_TIMED_OUT', { teamId: 'b' }, id));
  expect(s.phase).toBe('JUDGED');
  expect(s.answerDeadline).toBeNull();
});

it('ANSWER_TIMED_OUT с чужим teamId или вне ANSWERING — no-op', () => {
  let s = answering(); // отвечает a
  const before = JSON.stringify(s);
  s = applyEvent(s, makeEvent('ANSWER_TIMED_OUT', { teamId: 'b' }, id)); // b не текущий
  expect(JSON.stringify(s)).toBe(before);
});

it('correct:false тоже обнуляет answerDeadline (общий helper)', () => {
  let s = answering();
  s = applyEvent(s, makeEvent('ANSWER_TIMER_STARTED', { deadline: 99999 }, id));
  s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: false, value: 100 }, id));
  expect(s.phase).toBe('ANSWERING');     // ход b
  expect(s.answerDeadline).toBeNull();   // протухший дедлайн снят
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- reducer.timer`
Expected: FAIL (`ANSWER_TIMED_OUT` не обработан; `correct:false` не обнуляет дедлайн).

- [ ] **Step 3: Реализовать helper + рефактор**

В `src/domain/engine/reducer.ts`, заменить `case 'ANSWER_JUDGED'` (строки 72-82) на использование общего helper'а. Сначала добавить helper над `applyEvent` (после импортов):

```ts
import { nextAnsweringIndex } from './rules.js';

/** Переход к следующей попытке (используется «Неверно» и таймаутом):
 *  штраф −currentValue, сдвиг очереди, безусловный сброс таймер-полей. */
function nextAttempt(s: GameState, teamId: string): GameState {
  const team = s.teams.find(t => t.id === teamId);
  if (team) team.score -= s.currentValue;
  s.lastJudgedTeamId = teamId;
  const next = nextAnsweringIndex(s.answeringIndex, s.buzzQueue.length);
  if (next === null) { s.phase = 'JUDGED'; }
  else { s.phase = 'ANSWERING'; s.answeringIndex = next; }
  s.answerDeadline = null; s.answerPausedRemainingMs = null;
  return s;
}
```

Заменить тело `case 'ANSWER_JUDGED'`:

```ts
    case 'ANSWER_JUDGED': {
      const { teamId, correct, value } = event.payload;
      if (correct) {
        const team = s.teams.find(t => t.id === teamId);
        if (team) team.score += value;
        s.lastJudgedTeamId = teamId;
        s.phase = 'JUDGED'; s.pickingTeamId = teamId;
        s.answerDeadline = null; s.answerPausedRemainingMs = null;
        return s;
      }
      return nextAttempt(s, teamId);
    }
```

> Примечание: верная ветка использует `value` из payload (как было), а `nextAttempt` штрафует на `s.currentValue`. Для обычного потока `value === s.currentValue`; таймаут не несёт `value`, поэтому штраф берётся из состояния — единый источник.

Добавить case `ANSWER_TIMED_OUT` рядом с другими таймер-событиями:

```ts
    case 'ANSWER_TIMED_OUT': {
      const current = s.buzzQueue[s.answeringIndex]?.teamId;
      if (s.phase !== 'ANSWERING' || event.payload.teamId !== current) return s; // no-op (гонка/идемпотентность)
      return nextAttempt(s, event.payload.teamId);
    }
```

Если в шапке файла уже есть `import { nextAnsweringIndex } from './rules.js';` (строка 3) — **не дублировать**, только переиспользовать в helper'е.

- [ ] **Step 4: Запустить тесты**

Run: `npm test -- reducer`
Expected: PASS (включая существующие judge-тесты — поведение «Неверно» неизменно).

- [ ] **Step 5: Коммит**

```bash
git add src/domain/engine/reducer.ts src/domain/engine/reducer.timer.test.ts
git commit -m "feat(engine-timer): nextAttempt helper + ANSWER_TIMED_OUT (−цена, идемпотентность)"
```

---

## Task 5: Чистая функция answerTimerDecision

**Files:**
- Create: `src/domain/engine/answerTimer.ts`
- Test: `src/domain/engine/answerTimer.test.ts`

**Interfaces:**
- Consumes: `GameState` (Task 1).
- Produces: `type TimerDecision = { kind:'start' } | { kind:'timeout'; teamId:string } | { kind:'arm'; delayMs:number } | { kind:'clear' } | { kind:'noop' }`; функция `answerTimerDecision(s: GameState, now: number): TimerDecision`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/domain/engine/answerTimer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { answerTimerDecision } from './answerTimer.js';
import type { GameState } from '../types.js';

function st(p: Partial<GameState>): GameState { return { ...initialState(), ...p }; }

describe('answerTimerDecision', () => {
  it('не ANSWERING → clear', () => {
    expect(answerTimerDecision(st({ phase: 'PICKING' }), 1000).kind).toBe('clear');
  });
  it('ANSWERING + пауза → clear', () => {
    expect(answerTimerDecision(st({ phase: 'ANSWERING', answerPausedRemainingMs: 5000 }), 1000).kind).toBe('clear');
  });
  it('ANSWERING без дедлайна → start', () => {
    expect(answerTimerDecision(st({ phase: 'ANSWERING', answerDeadline: null }), 1000).kind).toBe('start');
  });
  it('дедлайн в будущем → arm с delayMs', () => {
    const d = answerTimerDecision(st({ phase: 'ANSWERING', answerDeadline: 5000 }), 1000);
    expect(d).toEqual({ kind: 'arm', delayMs: 4000 });
  });
  it('дедлайн истёк + есть отвечающий → timeout с teamId', () => {
    const d = answerTimerDecision(st({
      phase: 'ANSWERING', answerDeadline: 900,
      buzzQueue: [{ teamId: 'a', reaction: 1 }], answeringIndex: 0,
    }), 1000);
    expect(d).toEqual({ kind: 'timeout', teamId: 'a' });
  });
  it('дедлайн истёк, но очередь пуста → noop', () => {
    const d = answerTimerDecision(st({ phase: 'ANSWERING', answerDeadline: 900, buzzQueue: [], answeringIndex: -1 }), 1000);
    expect(d.kind).toBe('noop');
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- answerTimer`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

Создать `src/domain/engine/answerTimer.ts`:

```ts
import type { GameState } from '../types.js';

export type TimerDecision =
  | { kind: 'start' }
  | { kind: 'timeout'; teamId: string }
  | { kind: 'arm'; delayMs: number }
  | { kind: 'clear' }
  | { kind: 'noop' };

/** Решение по таймеру для текущего состояния. Чистая: без Date.now/setTimeout. */
export function answerTimerDecision(s: GameState, now: number): TimerDecision {
  if (s.phase !== 'ANSWERING') return { kind: 'clear' };
  if (s.answerPausedRemainingMs != null) return { kind: 'clear' };
  if (s.answerDeadline == null) return { kind: 'start' };
  if (s.answerDeadline <= now) {
    const teamId = s.buzzQueue[s.answeringIndex]?.teamId;
    return teamId == null ? { kind: 'noop' } : { kind: 'timeout', teamId };
  }
  return { kind: 'arm', delayMs: s.answerDeadline - now };
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test -- answerTimer`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/domain/engine/answerTimer.ts src/domain/engine/answerTimer.test.ts
git commit -m "feat(engine-timer): чистая answerTimerDecision(state, now)"
```

---

## Task 6: Контракт состояния — поля таймера в protocol

**Files:**
- Modify: `src/realtime/protocol.ts:10-48`
- Test: `src/realtime/protocol.test.ts`

**Interfaces:**
- Produces: `PublicState` (и `HostState`) получают `answerTimerSec:number`, `answerDeadline:number|null`, `answerPausedRemainingMs:number|null`, `serverNow:number`. `toPublicState`/`toHostState` принимают `now: number = Date.now()`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `src/realtime/protocol.test.ts` (если файла нет — создать с импортами по образцу других тестов):

```ts
it('toPublicState проносит таймер-поля и serverNow', () => {
  const pack = { id: 'p', title: 'T', rounds: [] };
  const s = { ...initialState(), phase: 'ANSWERING', answerTimerSec: 30, answerDeadline: 5000, answerPausedRemainingMs: null } as any;
  const pub = toPublicState(s, pack as any, 1234);
  expect(pub.answerTimerSec).toBe(30);
  expect(pub.answerDeadline).toBe(5000);
  expect(pub.answerPausedRemainingMs).toBeNull();
  expect(pub.serverNow).toBe(1234);
});
```

(Добавить импорты `initialState`, `toPublicState`, если отсутствуют.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- protocol`
Expected: FAIL — поля/параметр отсутствуют.

- [ ] **Step 3: Реализовать**

В `src/realtime/protocol.ts`:

(а) В интерфейс `PublicState` добавить (после `assignedTeamId: string | null;`):

```ts
  answerTimerSec: number;
  answerDeadline: number | null;
  answerPausedRemainingMs: number | null;
  serverNow: number;
```

(б) `buildPublic` принимает `now` и проносит поля:

```ts
function buildPublic(s: GameState, pack: Pack, now: number): PublicState {
  const q = findQuestion(pack, s.currentQuestionId);
  return {
    // …существующие поля без изменений…
    auction: s.auction,
    assignedTeamId: s.assignedTeamId,
    answerTimerSec: s.answerTimerSec,
    answerDeadline: s.answerDeadline,
    answerPausedRemainingMs: s.answerPausedRemainingMs,
    serverNow: now,
  };
}
```

(в) Экспортируемые обёртки:

```ts
export function toPublicState(s: GameState, pack: Pack, now: number = Date.now()): PublicState {
  return buildPublic(s, pack, now);
}
export function toHostState(s: GameState, pack: Pack, now: number = Date.now()): HostState {
  const q = findQuestion(pack, s.currentQuestionId);
  return {
    ...buildPublic(s, pack, now),
    currentAnswer: q?.answer ?? null,
    players: s.players.map(({ id, firstName, lastName, teamId, connected }) => ({ id, firstName, lastName, teamId, connected })),
  };
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test -- protocol`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/realtime/protocol.ts src/realtime/protocol.test.ts
git commit -m "feat(engine-timer): protocol — таймер-поля + serverNow"
```

---

## Task 7: Gateway — syncAnswerTimer + авто-старт через playerBuzz/hostAction

**Files:**
- Modify: `src/realtime/gateway.ts`
- Test: `src/realtime/gateway.timer.test.ts` (создать)

**Interfaces:**
- Consumes: `answerTimerDecision` (Task 5), события (Task 2), `broadcastState`.
- Produces: внутренняя `syncAnswerTimer(io, deps, gameId)` + карта `Map<gameId,{timeout,deadline}>`; вызывается после `broadcastState` в `hostAction` и `playerBuzz`. Первый базз/судейство/аукцион/«Кот» заводят `ANSWER_TIMER_STARTED`.

- [ ] **Step 1: Написать падающий тест (с реальным коротким таймером)**

Создать `src/realtime/gateway.timer.test.ts` по образцу `gateway.test.ts` (тот же `setup()` с реальным socket.io). Использовать малый номинал, чтобы таймаут сработал быстро. Создавать игру с `answerTimerSec: 1` (1 секунда) или править дефолт через прямой append. Тест:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as Client, type Socket } from 'socket.io-client';
import { openDb } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { SessionRegistry } from './session.js';
import { attachGateway } from './gateway.js';
import { makeEvent } from '../domain/events.js';
import { config } from '../config.js';

let teardowns: Array<() => Promise<void>> = [];
let open: Socket[] = [];
afterEach(async () => { open.forEach(s => s.close()); open = []; await Promise.all(teardowns.map(f => f())); teardowns = []; });

function setup(answerTimerSec: number) {
  const db = openDb(':memory:');
  const store = new EventStore(db, 25);
  const pack = { id: 'p', title: 'T', rounds: [{ id: 'r', name: 'R', categories: [{ id: 'c', name: 'C',
    questions: [{ id: 'q1', type: 'text', prompt: 'Q?', answer: 'S', value: 100, special: 'none' }] }] }] };
  db.prepare('INSERT INTO packs (id,data) VALUES (?,?)').run('p', JSON.stringify(pack));
  store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec }));
  store.append('g', makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }));
  store.append('g', makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }));
  store.append('g', makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }));
  store.append('g', makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }));
  store.append('g', makeEvent('BUZZER_OPENED', {}));
  const httpServer = createServer(); const ioServer = new Server(httpServer);
  attachGateway(ioServer, { store, db, sessions: new SessionRegistry(), config });
  teardowns.push(() => new Promise<void>(res => { ioServer.close(); httpServer.close(() => res()); }));
  return new Promise<{ url: string; store: EventStore }>(res => {
    httpServer.listen(() => res({ url: `http://localhost:${(httpServer.address() as any).port}`, store }));
  });
}

function hostClient(url: string): Promise<Socket> {
  const c = Client(url, { transports: ['websocket'] }); open.push(c);
  return new Promise(res => c.on('connect', () => {
    c.emit('join', { gameId: 'g', firstName: '', lastName: '', clientToken: 'h', role: 'host' });
    res(c);
  }));
}
const states = (c: Socket) => { const buf: any[] = []; c.on('state', s => buf.push(s)); return buf; };

describe('gateway — таймер', () => {
  it('первый базз заводит ANSWER_TIMER_STARTED (answerDeadline в state)', async () => {
    const { url } = await setup(30);
    const h = await hostClient(url); const buf = states(h);
    const player = Client(url, { transports: ['websocket'] }); open.push(player);
    await new Promise<void>(res => player.on('connect', () => { player.emit('join', { gameId: 'g', firstName: 'X', lastName: 'Y', teamId: 'a', clientToken: 'p1', role: 'player' }); res(); }));
    player.emit('playerBuzz', { reaction: 200 });
    await new Promise(r => setTimeout(r, 150));
    const last = buf[buf.length - 1];
    expect(last.phase).toBe('ANSWERING');
    expect(last.answerDeadline).toBeGreaterThan(Date.now());
  });

  it('по истечении — ANSWER_TIMED_OUT, ход следующему, новый отсчёт', async () => {
    const { url } = await setup(1); // 1 секунда
    const h = await hostClient(url); const buf = states(h);
    const p = Client(url, { transports: ['websocket'] }); open.push(p);
    await new Promise<void>(res => p.on('connect', () => { p.emit('join', { gameId: 'g', firstName: 'X', lastName: 'Y', teamId: 'a', clientToken: 'p1', role: 'player' }); res(); }));
    // оба забаззили: очередь [a,b]
    p.emit('playerBuzz', { reaction: 100 });
    const p2 = Client(url, { transports: ['websocket'] }); open.push(p2);
    await new Promise<void>(res => p2.on('connect', () => { p2.emit('join', { gameId: 'g', firstName: 'Z', lastName: 'W', teamId: 'b', clientToken: 'p2', role: 'player' }); res(); }));
    p2.emit('playerBuzz', { reaction: 200 });
    await new Promise(r => setTimeout(r, 1300)); // ждём таймаут a
    const last = buf[buf.length - 1];
    expect(last.teams.find((t: any) => t.id === 'a').score).toBe(-100);
    expect(last.answeringTeamId).toBe('b');
    expect(last.answerDeadline).toBeGreaterThan(Date.now()); // новый отсчёт для b
  }, 4000);
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- gateway.timer`
Expected: FAIL — `answerDeadline` отсутствует/`null`; таймаут не происходит.

- [ ] **Step 3: Реализовать syncAnswerTimer и подключить**

В `src/realtime/gateway.ts`:

(а) Импорт вверху:

```ts
import { answerTimerDecision } from '../domain/engine/answerTimer.js';
```

(б) Внутри `attachGateway`, рядом с `const offenseCount = new Map<...>();`:

```ts
  const answerTimers = new Map<string, { timeout: ReturnType<typeof setTimeout>; deadline: number }>();

  function clearAnswerTimer(gameId: string): void {
    const t = answerTimers.get(gameId);
    if (t) { clearTimeout(t.timeout); answerTimers.delete(gameId); }
  }

  function syncAnswerTimer(gameId: string): void {
    const s = deps.store.loadState(gameId);
    const d = answerTimerDecision(s, Date.now());
    switch (d.kind) {
      case 'clear': clearAnswerTimer(gameId); return;
      case 'noop': return;
      case 'start':
        deps.store.append(gameId, makeEvent('ANSWER_TIMER_STARTED', { deadline: Date.now() + s.answerTimerSec * 1000 }));
        broadcastState(io, deps, gameId); syncAnswerTimer(gameId); return;
      case 'timeout':
        deps.store.append(gameId, makeEvent('ANSWER_TIMED_OUT', { teamId: d.teamId }));
        broadcastState(io, deps, gameId); syncAnswerTimer(gameId); return;
      case 'arm': {
        const existing = answerTimers.get(gameId);
        if (existing && existing.deadline === s.answerDeadline) return; // уже взведён под этот дедлайн
        if (existing) clearTimeout(existing.timeout);
        const timeout = setTimeout(() => { answerTimers.delete(gameId); syncAnswerTimer(gameId); }, d.delayMs);
        answerTimers.set(gameId, { timeout, deadline: s.answerDeadline! });
        return;
      }
    }
  }
```

(в) Подключить после доменных аппендов. В `hostAction` после строки `broadcastState(io, deps, gid);` (конец switch, ~строка 162) добавить:

```ts
      broadcastState(io, deps, gid);
      syncAnswerTimer(gid);
```

В `playerBuzz` после `broadcastState(io, deps, joinedGame);` (последняя строка обработчика) добавить:

```ts
      broadcastState(io, deps, joinedGame);
      syncAnswerTimer(joinedGame);
```

> Старт первого отсчёта возникает естественно: `playerBuzz` → `BUZZ_RECORDED` (фаза `ANSWERING`, дедлайн `null`) → `syncAnswerTimer` → `start`. Аукцион/«Кот»/судейство идут через `hostAction` → тот же путь.

- [ ] **Step 4: Запустить тесты**

Run: `npm test -- gateway.timer`
Expected: PASS (оба теста; второй ~1.3 с).

- [ ] **Step 5: Регрессия gateway**

Run: `npm test -- gateway`
Expected: PASS (существующие gateway-тесты не сломаны).

- [ ] **Step 6: Коммит**

```bash
git add src/realtime/gateway.ts src/realtime/gateway.timer.test.ts
git commit -m "feat(engine-timer): gateway syncAnswerTimer + авто-старт отсчёта"
```

---

## Task 8: Gateway — host-actions пауза / возобновление / сброс

**Files:**
- Modify: `src/realtime/gateway.ts` (switch в `hostAction`, ~строки 117-160)
- Test: `src/realtime/gateway.timer.test.ts`

**Interfaces:**
- Consumes: `syncAnswerTimer` (Task 7).
- Produces: host-actions `timerPause`, `timerResume`, `timerReset`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `src/realtime/gateway.timer.test.ts`:

```ts
it('timerPause замораживает остаток, timerResume возобновляет', async () => {
  const { url } = await setup(30);
  const h = await hostClient(url); const buf = states(h);
  const p = Client(url, { transports: ['websocket'] }); open.push(p);
  await new Promise<void>(res => p.on('connect', () => { p.emit('join', { gameId: 'g', firstName: 'X', lastName: 'Y', teamId: 'a', clientToken: 'p1', role: 'player' }); res(); }));
  p.emit('playerBuzz', { reaction: 100 });
  await new Promise(r => setTimeout(r, 150));
  h.emit('hostAction', { action: 'timerPause' });
  await new Promise(r => setTimeout(r, 100));
  let last = buf[buf.length - 1];
  expect(last.answerPausedRemainingMs).toBeGreaterThan(0);
  expect(last.answerDeadline).toBeNull();
  h.emit('hostAction', { action: 'timerResume' });
  await new Promise(r => setTimeout(r, 100));
  last = buf[buf.length - 1];
  expect(last.answerDeadline).toBeGreaterThan(Date.now());
  expect(last.answerPausedRemainingMs).toBeNull();
});

it('timerReset перезаводит отсчёт на полный номинал', async () => {
  const { url } = await setup(30);
  const h = await hostClient(url); const buf = states(h);
  const p = Client(url, { transports: ['websocket'] }); open.push(p);
  await new Promise<void>(res => p.on('connect', () => { p.emit('join', { gameId: 'g', firstName: 'X', lastName: 'Y', teamId: 'a', clientToken: 'p1', role: 'player' }); res(); }));
  p.emit('playerBuzz', { reaction: 100 });
  await new Promise(r => setTimeout(r, 1000)); // прошла ~1 с
  h.emit('hostAction', { action: 'timerReset' });
  await new Promise(r => setTimeout(r, 100));
  const last = buf[buf.length - 1];
  expect(last.answerDeadline - Date.now()).toBeGreaterThan(28000); // снова ~30 с
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- gateway.timer`
Expected: FAIL — действия неизвестны (`default: return`).

- [ ] **Step 3: Реализовать действия**

В `src/realtime/gateway.ts`, в switch `hostAction`, перед `default: return;` добавить три case:

```ts
        case 'timerPause':
          if (st.phase === 'ANSWERING' && st.answerDeadline != null) {
            deps.store.append(gid, makeEvent('ANSWER_TIMER_PAUSED', { remainingMs: Math.max(0, st.answerDeadline - Date.now()) }));
          }
          break;
        case 'timerResume':
          if (st.phase === 'ANSWERING' && st.answerPausedRemainingMs != null) {
            deps.store.append(gid, makeEvent('ANSWER_TIMER_RESUMED', { deadline: Date.now() + st.answerPausedRemainingMs }));
          }
          break;
        case 'timerReset':
          if (st.phase === 'ANSWERING') {
            deps.store.append(gid, makeEvent('ANSWER_TIMER_STARTED', { deadline: Date.now() + st.answerTimerSec * 1000 }));
          }
          break;
```

> `st` — это `deps.store.loadState(gid)` в начале `hostAction` (строка ~116). После switch уже стоит `broadcastState` + `syncAnswerTimer` (Task 7), которые перевзведут/снимут `setTimeout` по новому состоянию (`arm` с новым `deadline` ≠ старому → re-arm; пауза → `clear`).

- [ ] **Step 4: Запустить тесты**

Run: `npm test -- gateway.timer`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/realtime/gateway.ts src/realtime/gateway.timer.test.ts
git commit -m "feat(engine-timer): host-actions timerPause/Resume/Reset"
```

---

## Task 9: Восстановление таймера на старте сервера

**Files:**
- Modify: `src/realtime/gateway.ts` (экспортировать helper восстановления), `src/index.ts:18-19`
- Test: `src/realtime/gateway.timer.test.ts`

**Interfaces:**
- Produces: экспорт `recoverAnswerTimers(io, deps)` — для активной игры из `active_game` вызывает синхронизацию таймера; в `index.ts` вызывается после `attachGateway`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `src/realtime/gateway.timer.test.ts` (импортировать `recoverAnswerTimers`, `getActiveGameId`/`setActiveGame` из `../persistence/activeGameRepo.js`):

```ts
it('recoverAnswerTimers: истёкший дедлайн активной игры → немедленный таймаут', async () => {
  const { url, store } = await setup(30);
  // довести до ANSWERING с истёкшим дедлайном вручную через store
  store.append('g', makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 100 }));
  store.append('g', makeEvent('ANSWER_TIMER_STARTED', { deadline: Date.now() - 1000 })); // уже в прошлом
  // активная игра указывает на g
  // (импортировать setActiveGame; deps.db доступен через возвращаемый store? — см. ниже)
  // Подключаем хоста, чтобы видеть state:
  const h = await hostClient(url); const buf = states(h);
  // эмулировать рестарт: вызвать recoverAnswerTimers напрямую невозможно из теста без io/deps,
  // поэтому проверяем через повторный sync — см. примечание.
  await new Promise(r => setTimeout(r, 200));
  const last = buf[buf.length - 1];
  expect(last.phase).toBe('JUDGED'); // a был последним валидным → таймаут увёл в JUDGED
});
```

> **Примечание по тестируемости:** `recoverAnswerTimers` принимает `(io, deps)`. Чтобы тест мог его вызвать, `setup()` должен вернуть ещё и `{ io, deps }`. Расширить `setup` возвратом `ioServer` и `deps` (db/store/sessions/config), затем в тесте: `import { recoverAnswerTimers }`, выставить `setActiveGame(deps.db, 'g')`, вызвать `recoverAnswerTimers(ioServer, deps)` и проверить состояние. Скорректировать тело теста под этот возврат. Ключевая проверка — после восстановления истёкший таймер активной игры приводит к `ANSWER_TIMED_OUT`.

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- gateway.timer`
Expected: FAIL — `recoverAnswerTimers` не экспортирован.

- [ ] **Step 3: Реализовать**

В `src/realtime/gateway.ts`:

(а) Импорт:

```ts
import { clearActiveGameIfMatches, getActiveGameId } from '../persistence/activeGameRepo.js';
```

(`clearActiveGameIfMatches` уже импортирован — не дублировать; добавить только `getActiveGameId`.)

(б) Экспортировать функцию восстановления. Поскольку `syncAnswerTimer` живёт в замыкании `attachGateway`, вынести её доступность: проще всего сделать `attachGateway` возвращающим объект с `recover`. Но чтобы не менять сигнатуру существующих вызовов, добавить **отдельную экспортируемую** функцию, переиспользующую тот же алгоритм через новый замыкание-инстанс невозможно (карта таймеров приватна). Решение: `attachGateway` возвращает `{ recoverAnswerTimers: () => void }`:

```ts
export function attachGateway(io: Server, deps: GatewayDeps): { recoverAnswerTimers: () => void } {
  // …существующее тело…
  // в самом конце, перед закрытием функции:
  return {
    recoverAnswerTimers() {
      const gid = getActiveGameId(deps.db);
      if (gid) syncAnswerTimer(gid);
    },
  };
}
```

(существующий код, не использующий возврат, не ломается).

(в) В `src/index.ts` после `attachGateway(io, gatewayDeps);` (строка 18) заменить на:

```ts
const gateway = attachGateway(io, gatewayDeps);
broadcaster.broadcast = (gameId: string) => broadcastState(io, gatewayDeps, gameId);
gateway.recoverAnswerTimers();
```

> Проверить сигнатуру `getActiveGameId` в `src/persistence/activeGameRepo.ts` — он принимает `db` (по SP3). Если имя/сигнатура иные — подставить фактические.

- [ ] **Step 4: Запустить тесты**

Run: `npm test -- gateway.timer`
Expected: PASS.

- [ ] **Step 5: Сверить сборку**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (весь сервер-набор).

- [ ] **Step 6: Коммит**

```bash
git add src/realtime/gateway.ts src/index.ts src/realtime/gateway.timer.test.ts
git commit -m "feat(engine-timer): восстановление таймера активной игры на старте"
```

---

## Task 10: POST /api/games — приём и кламп answerTimerSec

**Files:**
- Modify: `src/http/server.ts:52-59`
- Test: `src/http/server.test.ts` (или `server.activegame.test.ts`)

**Interfaces:**
- Consumes: `GAME_CREATED.answerTimerSec` (Task 2).
- Produces: `POST /api/games` принимает необязательный `answerTimerSec` (дефолт 45, кламп 10–120) и проносит в `GAME_CREATED`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `src/http/server.test.ts` (в describe с авторизованным `cookie`; взять паттерн из существующего теста создания игры, строка ~49):

```ts
it('POST /api/games проносит answerTimerSec (кламп 10–120)', async () => {
  // …получить cookie и packId как в соседних тестах…
  const cr = await app.inject({ method: 'POST', url: '/api/games', payload: { packId, title: 'Игра', teamCount: 2, answerTimerSec: 999 }, headers: { cookie } });
  const { gameId } = cr.json();
  const state = store.loadState(gameId);
  expect(state.answerTimerSec).toBe(120); // заклампано
});

it('POST /api/games без answerTimerSec → дефолт 45', async () => {
  const cr = await app.inject({ method: 'POST', url: '/api/games', payload: { packId, title: 'Игра', teamCount: 2 }, headers: { cookie } });
  const state = store.loadState(cr.json().gameId);
  expect(state.answerTimerSec).toBe(45);
});
```

(Использовать уже доступные в тесте `store`/`packId`/`cookie`; если их нет в scope конкретного теста — продублировать setup как в соседних.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- server.test`
Expected: FAIL — `answerTimerSec` не пишется (сейчас `undefined`/дефолт reducer 45, но кламп 120 не сработает → первый тест FAIL).

- [ ] **Step 3: Реализовать**

В `src/http/server.ts`, заменить тело `POST /api/games` (строки 52-59):

```ts
  app.post('/api/games', { preHandler: requireAdmin }, async (req, reply) => {
    const { packId, title, teamCount, answerTimerSec } = req.body as
      { packId: string; title: string; teamCount: number; answerTimerSec?: number };
    const row = deps.db.prepare('SELECT id FROM packs WHERE id = ?').get(packId);
    if (!row) return reply.code(404).send({ error: 'пак не найден' });
    const sec = Math.min(120, Math.max(10, Math.round(Number(answerTimerSec ?? 45)) || 45));
    const gameId = crypto.randomUUID();
    deps.store.append(gameId, makeEvent('GAME_CREATED', { gameId, packId, title, teamCount, answerTimerSec: sec }));
    return { gameId };
  });
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test -- server`
Expected: PASS. Починить типы в `server.activate.test.ts`/`server.activegame.test.ts`/`templates.test.ts`, если `GAME_CREATED` там без `answerTimerSec` ломает `tsc` — добавить `, answerTimerSec: 45`.

- [ ] **Step 5: Полный сервер-прогон**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — весь набор зелёный.

- [ ] **Step 6: Коммит**

```bash
git add src/http/server.ts src/http/*.test.ts
git commit -m "feat(engine-timer): POST /api/games принимает answerTimerSec (кламп 10–120)"
```

---

## Task 11: Web — createGame шлёт answerTimerSec, Лобби его передаёт

**Files:**
- Modify: `web/src/admin/gameApi.ts:18-19`
- Modify: `web/src/admin/sections/Lobby.svelte:56`
- Test: `web/src/admin/gameApi.test.ts`

**Interfaces:**
- Produces: `createGame(packId, title, teamCount, answerTimerSec)` → body содержит `answerTimerSec`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `web/src/admin/gameApi.test.ts` (взять стиль мока `fetch` из существующих тестов файла):

```ts
it('createGame кладёт answerTimerSec в тело', async () => {
  const calls: any[] = [];
  globalThis.fetch = ((url: string, init: any) => { calls.push({ url, init }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameId: 'g' }) }); }) as any;
  await createGame('p', 'T', 3, 60);
  const body = JSON.parse(calls[0].init.body);
  expect(body.answerTimerSec).toBe(60);
});
```

(Импортировать `createGame`, если ещё не импортирован в тесте.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run (из `web/`): `cd web && npm test -- gameApi`
Expected: FAIL — `answerTimerSec` не в body / лишний аргумент.

- [ ] **Step 3: Реализовать**

В `web/src/admin/gameApi.ts` заменить `createGame` (строки 18-19):

```ts
export const createGame = (packId: string, title: string, teamCount: number, answerTimerSec: number): Promise<{ gameId: string }> =>
  fetch('/api/games', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ packId, title, teamCount, answerTimerSec }) }).then(jsonOf);
```

В `web/src/admin/sections/Lobby.svelte`, строка 56, передать значение стора. В начале `doCreateGame` прочитать текущее значение:

```ts
  import { get } from 'svelte/store';
  // …
  async function doCreateGame() {
    if (!packId || !title) return;
    try {
      const r = await createGame(packId, title, teamCount, get(answerTimerSec));
```

(`get` из `svelte/store`; `answerTimerSec` уже импортирован в Lobby строка 6.)

- [ ] **Step 4: Запустить тесты**

Run (из `web/`): `cd web && npm test -- gameApi`
Expected: PASS.

- [ ] **Step 5: Проверка типов web**

Run (из `web/`): `cd web && npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 ошибок (или прежний baseline).

- [ ] **Step 6: Коммит**

```bash
git add web/src/admin/gameApi.ts web/src/admin/sections/Lobby.svelte web/src/admin/gameApi.test.ts
git commit -m "feat(engine-timer): Лобби передаёт answerTimerSec в createGame"
```

---

## Task 12: Web — чистые хелперы отсчёта + ticking-стор

**Files:**
- Create: `web/src/lib/answerTimer.ts`
- Test: `web/src/lib/answerTimer.test.ts`

**Interfaces:**
- Consumes: `gameStore` (`./store.js`).
- Produces: чистые `computeBase(state): {baseMs:number, paused:boolean} | null`, `tickRemaining(baseMs, paused, elapsedMs): number`, `isLow(ms): boolean`, `displaySeconds(ms): number`; ticking-сторы `answerRemainingMs`, `answerSecondsLeft`, `answerLow` (Svelte readable).

- [ ] **Step 1: Написать падающий тест чистых хелперов**

Создать `web/src/lib/answerTimer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeBase, tickRemaining, isLow, displaySeconds } from './answerTimer.js';

describe('answerTimer helpers', () => {
  it('computeBase: нет таймера → null', () => {
    expect(computeBase({ answerDeadline: null, answerPausedRemainingMs: null, serverNow: 0 })).toBeNull();
  });
  it('computeBase: пауза → baseMs = остаток, paused=true', () => {
    expect(computeBase({ answerDeadline: null, answerPausedRemainingMs: 7000, serverNow: 100 }))
      .toEqual({ baseMs: 7000, paused: true });
  });
  it('computeBase: идёт → baseMs = deadline − serverNow', () => {
    expect(computeBase({ answerDeadline: 5000, answerPausedRemainingMs: null, serverNow: 1000 }))
      .toEqual({ baseMs: 4000, paused: false });
  });
  it('tickRemaining: идёт — вычитает elapsed, не ниже 0', () => {
    expect(tickRemaining(4000, false, 1500)).toBe(2500);
    expect(tickRemaining(1000, false, 5000)).toBe(0);
  });
  it('tickRemaining: пауза — статично', () => {
    expect(tickRemaining(4000, true, 9999)).toBe(4000);
  });
  it('isLow: ≤10000 мс', () => {
    expect(isLow(10000)).toBe(true);
    expect(isLow(10001)).toBe(false);
  });
  it('displaySeconds: округление вверх', () => {
    expect(displaySeconds(4001)).toBe(5);
    expect(displaySeconds(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run (из `web/`): `cd web && npm test -- answerTimer`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

Создать `web/src/lib/answerTimer.ts`:

```ts
import { readable, derived } from 'svelte/store';
import { gameStore } from './store.js';

interface TimerFields { answerDeadline: number | null; answerPausedRemainingMs: number | null; serverNow: number; }

export function computeBase(s: TimerFields | null): { baseMs: number; paused: boolean } | null {
  if (!s) return null;
  if (s.answerPausedRemainingMs != null) return { baseMs: s.answerPausedRemainingMs, paused: true };
  if (s.answerDeadline != null) return { baseMs: s.answerDeadline - s.serverNow, paused: false };
  return null;
}
export function tickRemaining(baseMs: number, paused: boolean, elapsedMs: number): number {
  return paused ? baseMs : Math.max(0, baseMs - elapsedMs);
}
export const isLow = (ms: number): boolean => ms <= 10000;
export const displaySeconds = (ms: number): number => Math.ceil(ms / 1000);

// ── ticking-стор для компонентов ──
let base: { baseMs: number; paused: boolean } | null = null;
let startedAt = 0;
gameStore.subscribe((s: any) => {
  base = computeBase(s);
  startedAt = performance.now();
});
const tick = readable(0, (set) => {
  const update = () => set(performance.now());
  const i = setInterval(update, 250);
  return () => clearInterval(i);
});
export const answerRemainingMs = derived(tick, () =>
  base == null ? null : tickRemaining(base.baseMs, base.paused, performance.now() - startedAt));
export const answerSecondsLeft = derived(answerRemainingMs, (ms) => ms == null ? null : displaySeconds(ms));
export const answerLow = derived(answerRemainingMs, (ms) => ms != null && isLow(ms));
```

- [ ] **Step 4: Запустить тесты**

Run (из `web/`): `cd web && npm test -- answerTimer`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add web/src/lib/answerTimer.ts web/src/lib/answerTimer.test.ts
git commit -m "feat(engine-timer): web хелперы отсчёта + ticking-стор"
```

---

## Task 13: Пульт — бейдж отсчёта + пауза/возобновление/сброс + чип из state

**Files:**
- Modify: `web/src/admin/sections/Pult.svelte`

**Interfaces:**
- Consumes: `answerSecondsLeft`, `answerLow` (Task 12); host-actions `timerPause`/`timerResume`/`timerReset` (Task 8); `state.answerTimerSec`/`answerPausedRemainingMs`.

- [ ] **Step 1: Подключить сторы и заменить чип на данные из state**

В `<script>` `Pult.svelte` добавить импорт:

```ts
  import { answerSecondsLeft, answerLow } from '../../lib/answerTimer.js';
```

Заменить чип (строка 77):

```svelte
      <span class="timer-chip">Ответ {state.answerTimerSec ?? 45} с</span>
```

`answerTimerSec` теперь читается из `state`, поэтому из импорта `../store.js` в **Pult.svelte** его убрать (оставить только `workingGameId`):

```ts
  import { workingGameId } from '../store.js';
```

(В `Lobby.svelte` импорт `answerTimerSec` остаётся — это другой файл. svelte-check всё равно подсветит неиспользуемый импорт в Pult.)

- [ ] **Step 2: Добавить бейдж отсчёта + контролы в блок отвечающей команды**

Заменить блок `{#if answeringTeam}` (строки 138-146) на:

```svelte
        {#if answeringTeam}
          <div class="panel">
            <div class="answering-banner">Отвечает {answeringTeam.name}</div>
            <div class="timer-row">
              <span class="timer-badge" class:low={$answerLow}>{$answerSecondsLeft ?? '—'}</span>
              <span class="timer-cap">секунд на ответ. На нуле ответ не засчитан — ход следующему в очереди.</span>
            </div>
            <div class="timer-ctl">
              {#if state.answerPausedRemainingMs != null}
                <button class="ghost" on:click={() => hostAction('timerResume')}>▶ Продолжить</button>
              {:else}
                <button class="ghost" on:click={() => hostAction('timerPause')}>⏸ Пауза</button>
              {/if}
              <button class="ghost" on:click={() => hostAction('timerReset')}>↻ Сброс</button>
            </div>
            <div class="judge">
              <button class="judge-yes" on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: true })}>✓ Верно</button>
              <button class="judge-no" on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: false })}>✕ Неверно</button>
            </div>
          </div>
        {/if}
```

- [ ] **Step 3: Стили бейджа**

В `<style>` `Pult.svelte` добавить:

```css
  .timer-row { display: flex; align-items: center; gap: 12px; }
  .timer-badge { flex: none; min-width: 52px; height: 52px; display: flex; align-items: center; justify-content: center;
    border-radius: 12px; background: rgba(245,197,24,.12); border: 1px solid rgba(245,197,24,.4);
    font-family: var(--font-display); font-weight: 700; font-size: 26px; color: var(--gold); }
  .timer-badge.low { background: rgba(255,77,77,.16); border-color: rgba(255,77,77,.55); color: var(--err); }
  .timer-cap { font-size: 12px; color: var(--text-2); line-height: 1.4; }
  .timer-ctl { display: flex; gap: 8px; }
```

- [ ] **Step 4: Проверка типов и live-проверка**

Run (из `web/`): `cd web && npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 ошибок.

(Полная визуальная проверка — на Docker в Task 16; здесь достаточно svelte-check.)

- [ ] **Step 5: Коммит**

```bash
git add web/src/admin/sections/Pult.svelte
git commit -m "feat(engine-timer): Пульт — живой отсчёт + пауза/возобновление/сброс"
```

---

## Task 14: Экран игрока — ANSWERING-виды по прототипу

**Files:**
- Modify: `web/src/play/App.svelte:169-182` (PLAY VIEW) + `<style>`

**Interfaces:**
- Consumes: `answerSecondsLeft`, `answerLow` (Task 12); `state.answeringTeamId`, `state.buzzQueue`, `resolvedTeamId`, `myTurn`.

- [ ] **Step 1: Подключить сторы + производное «моя позиция в очереди»**

В `<script>` `play/App.svelte` добавить:

```ts
  import { answerSecondsLeft, answerLow } from '../lib/answerTimer.js';
  // позиция в очереди (1-based), если забаззил и не отвечает сейчас
  $: myQueuePos = (() => {
    const i = (state?.buzzQueue ?? []).findIndex((b: any) => b.teamId === resolvedTeamId);
    return i >= 0 ? i + 1 : null;
  })();
  $: answeringName = state?.teams?.find((t: any) => t.id === state?.answeringTeamId)?.name ?? '';
```

- [ ] **Step 2: Заменить ветки PLAY VIEW**

Заменить блок (строки 170-181) на:

```svelte
    {#if state?.phase === 'BUZZER_OPEN' || (state?.phase === 'ANSWERING' && !myTurn && !state?.answeringTeamId)}
      <Buzzer blockedUntil={$blockedUntil} on:press={buzz} />
    {:else if myTurn}
      <div class="answer-circle">
        <div class="ac-title">ВЫ ОТВЕЧАЕТЕ!</div>
        <div class="ac-num" class:low={$answerLow}>{$answerSecondsLeft ?? '—'}</div>
        <div class="ac-cap">секунд на ответ — говорите вслух!</div>
      </div>
    {:else if state?.phase === 'ANSWERING' && state?.answeringTeamId}
      <div class="watch">
        <div class="w-lead">ОТВЕЧАЕТ</div>
        <div class="w-name">{answeringName}</div>
        <div class="w-time" class:low={$answerLow}>осталось {$answerSecondsLeft ?? '—'} с</div>
        {#if myQueuePos}<div class="w-queue">Вы в очереди · #{myQueuePos}</div>{/if}
      </div>
    {:else if myPick}
      <h1 class="neon">ВЫБИРАЙТЕ ВОПРОС</h1>
    {:else if state?.currentPrompt}
      <p style="font-size:1.5rem">{state.currentPrompt}</p>
    {:else}
      <p>Ждём ведущего…</p>
    {/if}
```

> Логика баззера: пока ещё никто не отвечает (`answeringTeamId` пуст) и фаза `BUZZER_OPEN`/начало `ANSWERING` — показываем кнопку забаззившим. Как только кто-то стал отвечающим, не-отвечающие видят «ОТВЕЧАЕТ …».
>
> **Заметка о смене поведения:** прежний UI показывал кнопку базза и в `ANSWERING && !myTurn` (поздний базз). Движок по-прежнему принимает поздние `BUZZ_RECORDED` и встраивает их в очередь (на этом держится reducer-тест «после неверного ответа новый buzz не сбивает текущую отвечающую команду»). Новый UI этот путь **не показывает** игроку — соответствует прототипу (наблюдатель видит «ОТВЕЧАЕТ X», без кнопки). Движковую логику позднего базза НЕ удаляем: она остаётся для обратной совместимости и возможного возврата фичи в UI позже. Это намеренное расхождение «движок умеет — UI не предлагает».

- [ ] **Step 3: Стили (зелёный круг + watch) по прототипу**

В `<style>` `play/App.svelte` добавить:

```css
  .answer-circle { display: grid; place-items: center; gap: 8px; width: 280px; height: 280px; border-radius: 50%;
    background: radial-gradient(circle at 50% 45%, #43e9b0 0%, #1fd18e 60%, #149f6c 100%);
    box-shadow: 0 0 60px rgba(31,209,142,.5); color: #042; }
  .ac-title { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 34px; line-height: 1; }
  .ac-num { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 64px; line-height: 1; color: #f5c518; }
  .ac-num.low { color: #ff4d4d; }
  .ac-cap { font-size: 13px; max-width: 220px; opacity: .8; }
  .watch { display: grid; place-items: center; gap: 8px; text-align: center; }
  .w-lead { letter-spacing: .1em; text-transform: uppercase; font-size: 13px; opacity: .5; }
  .w-name { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 44px; text-transform: uppercase; }
  .w-time { font-size: 18px; color: #f5c518; }
  .w-time.low { color: #ff4d4d; }
  .w-queue { margin-top: 8px; padding: 10px 16px; border-radius: 12px; background: rgba(124,92,255,.12);
    border: 1px solid rgba(124,92,255,.35); color: #cdbcff; font-weight: 600; }
```

(Если `theme.css` подключён в play-входе — `var(--font-display)` подхватится; фолбэк `'Oswald'` указан.)

- [ ] **Step 4: Проверка типов**

Run (из `web/`): `cd web && npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 ошибок.

- [ ] **Step 5: Коммит**

```bash
git add web/src/play/App.svelte
git commit -m "feat(engine-timer): экран игрока — ВЫ ОТВЕЧАЕТЕ / осталось N с / очередь"
```

---

## Task 15: Табло — крупный отсчёт при ANSWERING

**Files:**
- Modify: `web/src/board/App.svelte:28-40` + `<style>`

**Interfaces:**
- Consumes: `answerSecondsLeft`, `answerLow` (Task 12); `state.answeringTeamId`.

- [ ] **Step 1: Подключить сторы + имя отвечающего**

В `<script>` `board/App.svelte` добавить:

```ts
  import { answerSecondsLeft, answerLow } from '../lib/answerTimer.js';
  $: answeringName = state?.teams?.find((t: any) => t.id === state?.answeringTeamId)?.name ?? '';
```

- [ ] **Step 2: Добавить блок отсчёта**

В ветке `{:else}` (живая игра), сразу после блока `{#if state.currentPrompt}…{/if}` (строка 35), добавить:

```svelte
    {#if state.phase === 'ANSWERING' && state.answeringTeamId}
      <div class="board-answer">
        <div class="ba-lead">ОТВЕЧАЕТ</div>
        <div class="ba-name">{answeringName}</div>
        <div class="ba-time" class:low={$answerLow}>осталось <span>{$answerSecondsLeft ?? '—'}</span></div>
      </div>
    {/if}
```

- [ ] **Step 3: Стили**

В `<style>` (если в `board/App.svelte` нет блока `<style>` — добавить его) добавить:

```css
  .board-answer { display: grid; place-items: center; gap: 10px; text-align: center; }
  .ba-lead { letter-spacing: .1em; text-transform: uppercase; opacity: .5; }
  .ba-name { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 3rem; text-transform: uppercase; color: #43e9b0; }
  .ba-time { font-size: 1.4rem; color: #f5c518; }
  .ba-time span { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 3.5rem; }
  .ba-time.low, .ba-time.low span { color: #ff4d4d; }
```

- [ ] **Step 4: Проверка типов**

Run (из `web/`): `cd web && npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 ошибок.

- [ ] **Step 5: Сборка web**

Run (из `web/`): `cd web && npm run build`
Expected: успешная сборка.

- [ ] **Step 6: Коммит**

```bash
git add web/src/board/App.svelte
git commit -m "feat(engine-timer): табло — крупный отсчёт ответа"
```

---

## Task 16: E2E на Docker — таймаут, пауза, спец-вопрос + пиксель-сверка

**Files:**
- Create/Modify: `tests/e2e/answer-timer.spec.ts`
- Modify (при необходимости): `docs/run.md`

**Interfaces:**
- Consumes: весь стек. Прогон на пересобранном Docker (:3000).

- [ ] **Step 1: Пересобрать и поднять боевой контейнер**

Run: `docker compose up -d --build`
Expected: контейнер на :3000 поднят (`docker compose ps` — healthy/up). Проверка: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → 200.

- [ ] **Step 2: Написать E2E-сценарий таймаута**

Создать `tests/e2e/answer-timer.spec.ts` по образцу `tests/e2e/smoke.spec.ts` (admin-логин, создание игры с малым `answerTimerSec`, активация, заход игроком, базз, ожидание таймаута). Ключевые проверки:

```ts
// псевдоструктура — адаптировать под helpers smoke.spec.ts
test('таймаут уводит ход к следующей команде и штрафует', async ({ page, context }) => {
  // 1. admin login → Лобби: выбрать пак, answerTimerSec=10 (минимум), создать, добавить 2 команды, активировать
  // 2. два игрока (две вкладки) заходят в команды A и B
  // 3. ведущий: выбрать вопрос → Открыть buzzer
  // 4. оба игрока жмут (A быстрее) → отвечает A, виден отсчёт
  // 5. НЕ судить; подождать > answerTimerSec → ожидать: ход у B, у A счёт −value
  await expect(page.getByText('Отвечает')).toContainText('B'); // на пульте
});
```

> Для скорости теста использовать `answerTimerSec = 10` (минимальный кламп) и `test.setTimeout(30000)`.

- [ ] **Step 3: E2E пауза/возобновление + спец-вопрос «Кот»**

Добавить в тот же файл сценарии:
- пауза: после базза нажать «⏸ Пауза» на пульте → число замирает (снять два значения с интервалом, равны); «▶ Продолжить» → снова убывает;
- «Кот»: выбрать ячейку-кот, передать команде, дождаться таймаута → фаза `JUDGED` (на пульте — кнопка «Следующий вопрос»/закрытие; проверить отсутствие «Отвечает»).

- [ ] **Step 4: Прогнать E2E**

Run: `npm run test:e2e -- answer-timer`
Expected: PASS все сценарии.

> Если конфиг E2E поднимает изолированный :3100 — допустимо для прогона; **обязательный финальный гейт** — те же сценарии вручную/прогоном против боевого :3000 (Docker). Зафиксировать факт прогона на :3000.

- [ ] **Step 5: Пиксель-сверка ANSWERING-экранов**

Снять скриншоты живого ANSWERING на :3000 (Пульт, экран игрока-отвечающего, табло) Playwright'ом и сверить с прототипными `docs/design_handoff_svoya_igra/screenshots/Снимок экрана 2026-06-24 085235.png` (Пульт), `…090327.png` (игрок), а также `06-host-answering.png`. Расхождения (токены/раскладка/число) зафиксировать в `docs/superpowers/answer-timer-pixel-diff.md` (что отличается, насколько, план устранения) — по образцу `docs/superpowers/sp3-pixel-diff.md`.

- [ ] **Step 6: Обновить docs/run.md (если флоу изменился)**

Добавить в `docs/run.md` упоминание настройки «Время на ответ» при создании игры и поведения таймаута/паузы на пульте.

- [ ] **Step 7: Финальный полный прогон**

Run: `npx tsc --noEmit && npm test && cd web && npm test && cd .. && npm run test:e2e`
Expected: всё зелёное.

- [ ] **Step 8: Коммит**

```bash
git add tests/e2e/answer-timer.spec.ts docs/superpowers/answer-timer-pixel-diff.md docs/run.md
git commit -m "test(engine-timer): E2E таймаут/пауза/Кот + пиксель-сверка ANSWERING"
```

---

## Self-Review

**1. Spec coverage:**
- §1 скоуп: таймаут (T4/T7), −цена (T4), аукцион/Кот через ANSWERING (T4/T7 path), пауза/возобновление/сброс (T8/T13), восстановление (T9), отображение 3 ролям (T13/T14/T15), проводка номинала (T10/T11). ✓
- §2 рамки: чистый reducer (T3/T4 без Date.now), дедлайн в state (T1), триггер state-driven (T5/T7). ✓
- §3 события/поля/helper/гарды/дефолт: T1/T2/T3/T4. ✓
- §4 syncAnswerTimer/карта/колбэк/самостабилизация/восстановление/бэкфилл: T7/T9/T1. ✓
- §5 protocol+serverNow+порядок пауза→дедлайн: T6/T12 (`computeBase` проверяет паузу первой). ✓
- §6 host-actions: T8. ✓
- §7 экраны/копирайт/low-time: T13/T14/T15. ✓
- §8 настройка: T10/T11/T13. ✓
- §9 тесты + блокер-регрессия: T7 (тест «по истечении → следующий с новым отсчётом») покрывает блокер. ✓

**2. Placeholder scan:** код приведён в каждом шаге; «псевдоструктура» E2E (T16) намеренно описательна, т.к. зависит от helpers `smoke.spec.ts` — указано адаптировать. Прочих TODO нет.

**3. Type consistency:** `answerTimerDecision`/`TimerDecision` (T5) совпадают в T7; `computeBase/tickRemaining/isLow/displaySeconds` (T12) совпадают в T13/T14/T15; `createGame(..., answerTimerSec)` (T11) совпадает с сигнатурой; `toPublicState(s, pack, now?)` (T6) — `now` опционален, существующие вызовы в gateway не ломаются.

**Замечание для исполнителя:** существующие вызовы `toPublicState`/`toHostState` в `gateway.ts` (`broadcastState`, строки 29-31) остаются валидны (третий параметр опционален, дефолт `Date.now()`). Менять их не требуется.
