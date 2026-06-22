# «Своя игра» — движок — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реалтайм-движок «Своей игры» (ведущий + игроки + табло), потребляющий ZIP-пак, с честным антиснайп-buzzer и восстановлением состояния после сбоя.

**Architecture:** Модульный монолит в одном Docker-контейнере. Чистое доменное ядро (engine/buzzer/packs) — без I/O, полностью покрыто юнит-тестами. Состояние — event sourcing в SQLite (снэпшот + реплей). Транспорт — Socket.IO; устойчивость к закрытию страницы даёт слой сессии на `clientToken`. Три Svelte-фронта из одного Vite-проекта.

**Tech Stack:** Node 20 (ESM) + TypeScript, Vitest, Fastify + @fastify/static + @fastify/multipart, Socket.IO, better-sqlite3, zod, adm-zip; фронт — Svelte 4 + Vite + socket.io-client.

## Global Constraints

- Node 20, TypeScript, **ESM** (`"type": "module"`); расширения в импортах `.js`.
- TDD везде: тест → провал → реализация → проход → коммит.
- Доменные модули `domain/*` и `packs/schema` — **чистые** (без сети/БД/таймеров/`Date.now`/`Math.random` напрямую; рандом и время инжектятся параметром).
- `reaction` ранжируется по значению (мс), **не** по времени прихода на сервер.
- Анти-чит порог реакции — конфиг, дефолт **100 мс**. Фальстарт-блок: случайный база **500–700 мс**, эскалация ×2 за каждый повтор.
- Очки — у **команды**, не у игрока. Неверно → −стоимость; верно → +стоимость.
- Ответ **никогда** не уходит на `/board` и в события, видимые игрокам.
- ID — `crypto.randomUUID()`.
- Идемпотентность событий по `event.id`.

---

## Структура файлов

```
svoya-igra/
  package.json                      # серверный пакет (ESM)
  tsconfig.json
  vitest.config.ts
  Dockerfile
  docker-compose.yml
  src/
    domain/
      types.ts                      # доменные типы
      events.ts                     # типы событий + union GameEvent
      engine/
        state.ts                    # GameState, initialState()
        rules.ts                    # выбор команды, очки (чистые ф-ии)
        reducer.ts                  # applyEvent(state,event) -> state
      buzzer/
        buzzer.ts                   # validateBuzz, computeBlock, rankQueue
    packs/
      schema.ts                     # zod-схема game.json + типы
      import.ts                     # importPackZip(buffer,dir) -> Pack
    persistence/
      db.ts                         # открытие SQLite, миграции
      eventStore.ts                 # append, loadState (snapshot+replay)
    realtime/
      protocol.ts                   # типы сообщений client<->server
      session.ts                    # реестр сессий по clientToken
      gateway.ts                    # Socket.IO: комнаты, диспетчер
    http/
      server.ts                     # Fastify: static, upload, media
    config.ts                       # конфиг (порты, пороги, путь БД)
    index.ts                        # bootstrap
  web/
    package.json                    # клиентский пакет (Svelte+Vite)
    vite.config.ts
    index.html                      # /host, lazy
    play.html                       # /play
    board.html                      # /board
    src/
      lib/
        socket.ts                   # подключение + rejoin по token
        store.ts                    # реактивный стор состояния
        identity.ts                 # clientToken в localStorage
        protocol.ts                 # общие типы (импорт из ../../src)
        theme.css                   # неоновая тема
        Buzzer.svelte
        Matrix.svelte
        Scoreboard.svelte
      host/App.svelte
      play/App.svelte
      board/App.svelte
  packs/
    example/                        # пример-пак (исходники)
      game.json
      media/...
    example.zip                     # собранный пример
  docs/
    pack-format.md                  # дока по ручной сборке пака
    run.md                          # запуск + восстановление
  tests/
    integration/
      reconnect.test.ts
      recovery.test.ts
```

---

## Доменная модель (référence — типы, на которые ссылаются все задачи)

`src/domain/types.ts`:

```ts
export type QuestionType = 'text' | 'image' | 'audio';
export type SpecialType = 'none' | 'auction' | 'cat';

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  media?: string;        // путь внутри media/
  answer: string;        // только для ведущего
  value: number;
  special: SpecialType;
}
export interface Category { id: string; name: string; questions: Question[]; }
export interface Round { id: string; name: string; categories: Category[]; }
export interface Pack { id: string; title: string; rounds: Round[]; }

export interface Team { id: string; name: string; score: number; }
export interface Player {
  id: string;
  clientToken: string;
  firstName: string;
  lastName: string;
  teamId: string;
  connected: boolean;
}
export interface BuzzEntry { teamId: string; reaction: number; }

export type Phase =
  | 'LOBBY' | 'ROUND_INTRO' | 'PICKING' | 'QUESTION'
  | 'BUZZER_ARMED' | 'BUZZER_OPEN' | 'ANSWERING' | 'JUDGED'
  | 'ROUND_END' | 'GAME_END';

export interface AuctionState {
  baseValue: number;
  highestBid: number;
  leaderTeamId: string | null;
  passedTeamIds: string[];
}

export interface GameState {
  gameId: string;
  packId: string;
  title: string;
  teamCount: number;
  phase: Phase;
  teams: Team[];
  players: Player[];
  roundIndex: number;
  usedQuestionIds: string[];
  pickingTeamId: string | null;
  currentQuestionId: string | null;
  currentValue: number;          // стоимость текущего вопроса (с учётом аукциона)
  buzzQueue: BuzzEntry[];
  answeringIndex: number;        // индекс в buzzQueue
  auction: AuctionState | null;
  assignedTeamId: string | null; // получатель «кота»
  lastJudgedTeamId: string | null;
  blocks: Record<string, number>; // playerId -> кол-во фальстартов (для эскалации)
}
```

---

# Phase 0 — Скелет проекта и тулинг

### Task 1: Серверный пакет, TS, Vitest

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/config.ts`

**Interfaces:**
- Produces: `config` объект `{ port:number; minReactionMs:number; blockMinMs:number; blockMaxMs:number; snapshotEvery:number; dbPath:string; mediaDir:string }`.

- [ ] **Step 1: Создать package.json**

```json
{
  "name": "svoya-igra-server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": {
    "fastify": "^4.28.0",
    "@fastify/static": "^7.0.0",
    "@fastify/multipart": "^8.3.0",
    "socket.io": "^4.7.5",
    "better-sqlite3": "^11.3.0",
    "zod": "^3.23.0",
    "adm-zip": "^0.5.16"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0",
    "@types/node": "^20.14.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/adm-zip": "^0.5.5"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: vitest.config.ts и .gitignore**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'] } });
```
`.gitignore`:
```
node_modules
dist
data
web/dist
web/node_modules
packs/*.zip
!packs/example.zip
```

- [ ] **Step 4: src/config.ts**

```ts
export const config = {
  port: Number(process.env.PORT ?? 3000),
  minReactionMs: Number(process.env.MIN_REACTION_MS ?? 100),
  blockMinMs: Number(process.env.BLOCK_MIN_MS ?? 500),
  blockMaxMs: Number(process.env.BLOCK_MAX_MS ?? 700),
  snapshotEvery: Number(process.env.SNAPSHOT_EVERY ?? 25),
  dbPath: process.env.DB_PATH ?? 'data/game.db',
  mediaDir: process.env.MEDIA_DIR ?? 'data/media',
};
export type Config = typeof config;
```

- [ ] **Step 5: Установить и проверить**

Run: `npm install && npx tsc --noEmit`
Expected: установка без ошибок, `tsc` без ошибок.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/config.ts
git commit -m "chore: серверный скелет (TS ESM, Vitest, config)"
```

---

# Phase 1 — Доменное ядро: типы, события, reducer

### Task 2: Доменные типы и события

**Files:**
- Create: `src/domain/types.ts` (см. блок «Доменная модель» выше — скопировать целиком)
- Create: `src/domain/events.ts`
- Test: `src/domain/events.test.ts`

**Interfaces:**
- Produces: все типы из «Доменной модели»; `GameEvent` union; `makeEvent<T>(type, payload, rng?)` хелпер с `id`.

- [ ] **Step 1: Написать падающий тест**

`src/domain/events.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { makeEvent } from './events.js';

describe('makeEvent', () => {
  it('создаёт событие с id и payload', () => {
    const e = makeEvent('GAME_STARTED', {}, () => 'fixed-id');
    expect(e.id).toBe('fixed-id');
    expect(e.type).toBe('GAME_STARTED');
  });
});
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx vitest run src/domain/events.test.ts`
Expected: FAIL — `Cannot find module './events.js'`.

- [ ] **Step 3: Создать types.ts**

Скопировать целиком блок «Доменная модель» в `src/domain/types.ts`.

- [ ] **Step 4: Создать events.ts**

```ts
import type { SpecialType } from './types.js';

export type GameEvent =
  | Ev<'GAME_CREATED', { gameId: string; packId: string; title: string; teamCount: number }>
  | Ev<'TEAM_CREATED', { teamId: string; name: string }>
  | Ev<'PLAYER_JOINED', { playerId: string; clientToken: string; firstName: string; lastName: string; teamId: string }>
  | Ev<'PLAYER_CONNECTED', { playerId: string }>
  | Ev<'PLAYER_DISCONNECTED', { playerId: string }>
  | Ev<'GAME_STARTED', {}>
  | Ev<'ROUND_STARTED', { roundIndex: number; pickingTeamId: string }>
  | Ev<'QUESTION_SELECTED', { questionId: string; value: number; special: SpecialType }>
  | Ev<'BUZZER_ARMED', {}>
  | Ev<'BUZZER_OPENED', {}>
  | Ev<'BUZZ_RECORDED', { teamId: string; reaction: number }>
  | Ev<'ANSWER_JUDGED', { teamId: string; correct: boolean; value: number }>
  | Ev<'QUESTION_CLOSED', {}>
  | Ev<'AUCTION_BID', { teamId: string; amount: number }>
  | Ev<'AUCTION_PASSED', { teamId: string }>
  | Ev<'AUCTION_WON', { teamId: string; amount: number }>
  | Ev<'CAT_ASSIGNED', { toTeamId: string }>
  | Ev<'ROUND_ENDED', {}>
  | Ev<'GAME_ENDED', {}>
  | Ev<'SCORE_ADJUSTED', { teamId: string; delta: number }>;

export interface Ev<T extends string, P> { id: string; type: T; payload: P }

export type EventType = GameEvent['type'];
export type PayloadOf<T extends EventType> = Extract<GameEvent, { type: T }>['payload'];

export function makeEvent<T extends EventType>(
  type: T, payload: PayloadOf<T>, idGen: () => string = () => crypto.randomUUID(),
): Extract<GameEvent, { type: T }> {
  return { id: idGen(), type, payload } as Extract<GameEvent, { type: T }>;
}
```

- [ ] **Step 5: Запустить — должен пройти**

Run: `npx vitest run src/domain/events.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/types.ts src/domain/events.ts src/domain/events.test.ts
git commit -m "feat(domain): доменные типы и события"
```

---

### Task 3: Чистые правила (выбор команды, эскалация блока)

**Files:**
- Create: `src/domain/engine/rules.ts`
- Test: `src/domain/engine/rules.test.ts`

**Interfaces:**
- Consumes: `Team` из `types.ts`.
- Produces:
  - `lowestScoreTeamId(teams: Team[]): string` — id команды с минимальным счётом (при равенстве — первая по порядку).
  - `nextAnsweringIndex(current: number, queueLen: number): number | null` — следующий индекс или `null` если очередь исчерпана.

- [ ] **Step 1: Написать падающий тест**

`src/domain/engine/rules.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { lowestScoreTeamId, nextAnsweringIndex } from './rules.js';

describe('lowestScoreTeamId', () => {
  it('возвращает команду с минимальным счётом', () => {
    const teams = [
      { id: 'a', name: 'A', score: 30 },
      { id: 'b', name: 'B', score: 10 },
      { id: 'c', name: 'C', score: 20 },
    ];
    expect(lowestScoreTeamId(teams)).toBe('b');
  });
  it('при равенстве берёт первую по порядку', () => {
    const teams = [
      { id: 'a', name: 'A', score: 0 },
      { id: 'b', name: 'B', score: 0 },
    ];
    expect(lowestScoreTeamId(teams)).toBe('a');
  });
});

describe('nextAnsweringIndex', () => {
  it('возвращает следующий индекс', () => {
    expect(nextAnsweringIndex(0, 3)).toBe(1);
  });
  it('возвращает null когда очередь исчерпана', () => {
    expect(nextAnsweringIndex(2, 3)).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/domain/engine/rules.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать rules.ts**

```ts
import type { Team } from '../types.js';

export function lowestScoreTeamId(teams: Team[]): string {
  let best = teams[0];
  for (const t of teams) if (t.score < best.score) best = t;
  return best.id;
}

export function nextAnsweringIndex(current: number, queueLen: number): number | null {
  const next = current + 1;
  return next < queueLen ? next : null;
}
```

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/domain/engine/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/engine/rules.ts src/domain/engine/rules.test.ts
git commit -m "feat(engine): правила выбора команды и очереди"
```

---

### Task 4: initialState и reducer — каркас + лобби

**Files:**
- Create: `src/domain/engine/state.ts`
- Create: `src/domain/engine/reducer.ts`
- Test: `src/domain/engine/reducer.lobby.test.ts`

**Interfaces:**
- Consumes: `GameState`, `GameEvent`, `rules`.
- Produces:
  - `initialState(): GameState` — пустое состояние, `phase: 'LOBBY'`.
  - `applyEvent(state: GameState, event: GameEvent): GameState` — чистый редьюсер (возвращает новый объект, не мутирует вход).

- [ ] **Step 1: Написать падающий тест**

`src/domain/engine/reducer.lobby.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0;
const id = () => `id${n++}`;

describe('reducer — лобби', () => {
  it('GAME_CREATED заполняет мету', () => {
    const s = applyEvent(initialState(), makeEvent('GAME_CREATED',
      { gameId: 'g1', packId: 'p1', title: 'Тест', teamCount: 2 }, id));
    expect(s.gameId).toBe('g1');
    expect(s.teamCount).toBe(2);
    expect(s.phase).toBe('LOBBY');
  });

  it('TEAM_CREATED и PLAYER_JOINED добавляют сущности', () => {
    let s = initialState();
    s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g1', packId: 'p1', title: 'T', teamCount: 2 }, id));
    s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 't1', name: 'Львы' }, id));
    s = applyEvent(s, makeEvent('PLAYER_JOINED', { playerId: 'pl1', clientToken: 'tok', firstName: 'Иван', lastName: 'Петров', teamId: 't1' }, id));
    expect(s.teams).toHaveLength(1);
    expect(s.teams[0].score).toBe(0);
    expect(s.players[0].connected).toBe(true);
  });

  it('не мутирует исходное состояние', () => {
    const s0 = initialState();
    applyEvent(s0, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }, id));
    expect(s0.gameId).toBe('');
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/domain/engine/reducer.lobby.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать state.ts**

```ts
import type { GameState } from '../types.js';

export function initialState(): GameState {
  return {
    gameId: '', packId: '', title: '', teamCount: 0,
    phase: 'LOBBY', teams: [], players: [],
    roundIndex: -1, usedQuestionIds: [],
    pickingTeamId: null, currentQuestionId: null, currentValue: 0,
    buzzQueue: [], answeringIndex: -1,
    auction: null, assignedTeamId: null,
    lastJudgedTeamId: null, blocks: {},
  };
}
```

- [ ] **Step 4: Реализовать reducer.ts (лобби-часть)**

```ts
import type { GameState } from '../types.js';
import type { GameEvent } from '../events.js';

export function applyEvent(state: GameState, event: GameEvent): GameState {
  const s: GameState = structuredClone(state);
  switch (event.type) {
    case 'GAME_CREATED': {
      const p = event.payload;
      s.gameId = p.gameId; s.packId = p.packId; s.title = p.title; s.teamCount = p.teamCount;
      return s;
    }
    case 'TEAM_CREATED':
      s.teams.push({ id: event.payload.teamId, name: event.payload.name, score: 0 });
      return s;
    case 'PLAYER_JOINED': {
      const p = event.payload;
      s.players.push({ id: p.playerId, clientToken: p.clientToken, firstName: p.firstName, lastName: p.lastName, teamId: p.teamId, connected: true });
      return s;
    }
    case 'PLAYER_CONNECTED':
    case 'PLAYER_DISCONNECTED': {
      const pl = s.players.find(x => x.id === event.payload.playerId);
      if (pl) pl.connected = event.type === 'PLAYER_CONNECTED';
      return s;
    }
    default:
      return s;
  }
}
```

- [ ] **Step 5: Запустить — проход**

Run: `npx vitest run src/domain/engine/reducer.lobby.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 6: Commit**

```bash
git add src/domain/engine/state.ts src/domain/engine/reducer.ts src/domain/engine/reducer.lobby.test.ts
git commit -m "feat(engine): initialState и reducer (лобби)"
```

---

### Task 5: reducer — старт игры, раунд, выбор вопроса

**Files:**
- Modify: `src/domain/engine/reducer.ts`
- Test: `src/domain/engine/reducer.flow.test.ts`

**Interfaces:**
- Consumes: `lowestScoreTeamId` из `rules.ts`.
- Produces: обработку `GAME_STARTED`, `ROUND_STARTED`, `QUESTION_SELECTED`, `BUZZER_ARMED`, `BUZZER_OPENED` в `applyEvent`.

- [ ] **Step 1: Написать падающий тест**

`src/domain/engine/reducer.flow.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0; const id = () => `id${n++}`;
function withTeams(): ReturnType<typeof initialState> {
  let s = initialState();
  s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }, id));
  return s;
}

describe('reducer — поток игры', () => {
  it('ROUND_STARTED ставит фазу PICKING и picking-команду', () => {
    let s = withTeams();
    s = applyEvent(s, makeEvent('GAME_STARTED', {}, id));
    s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'b' }, id));
    expect(s.phase).toBe('PICKING');
    expect(s.roundIndex).toBe(0);
    expect(s.pickingTeamId).toBe('b');
  });

  it('QUESTION_SELECTED фиксирует вопрос и стоимость, фаза QUESTION', () => {
    let s = withTeams();
    s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
    s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 200, special: 'none' }, id));
    expect(s.phase).toBe('QUESTION');
    expect(s.currentQuestionId).toBe('q1');
    expect(s.currentValue).toBe(200);
  });

  it('BUZZER_ARMED и BUZZER_OPENED меняют фазу и чистят очередь', () => {
    let s = withTeams();
    s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }, id));
    s = applyEvent(s, makeEvent('BUZZER_ARMED', {}, id));
    expect(s.phase).toBe('BUZZER_ARMED');
    s = applyEvent(s, makeEvent('BUZZER_OPENED', {}, id));
    expect(s.phase).toBe('BUZZER_OPEN');
    expect(s.buzzQueue).toEqual([]);
    expect(s.answeringIndex).toBe(-1);
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/domain/engine/reducer.flow.test.ts`
Expected: FAIL (фазы не меняются).

- [ ] **Step 3: Дополнить reducer.ts**

Добавить импорт сверху:
```ts
// (под существующими импортами)
```
Добавить ветки в `switch` (перед `default`):
```ts
    case 'GAME_STARTED':
      s.phase = 'ROUND_INTRO';
      return s;
    case 'ROUND_STARTED':
      s.phase = 'PICKING';
      s.roundIndex = event.payload.roundIndex;
      s.pickingTeamId = event.payload.pickingTeamId;
      return s;
    case 'QUESTION_SELECTED':
      s.phase = 'QUESTION';
      s.currentQuestionId = event.payload.questionId;
      s.currentValue = event.payload.value;
      s.auction = event.payload.special === 'auction'
        ? { baseValue: event.payload.value, highestBid: event.payload.value, leaderTeamId: null, passedTeamIds: [] }
        : null;
      s.assignedTeamId = null;
      return s;
    case 'BUZZER_ARMED':
      s.phase = 'BUZZER_ARMED';
      s.buzzQueue = [];
      s.answeringIndex = -1;
      return s;
    case 'BUZZER_OPENED':
      s.phase = 'BUZZER_OPEN';
      s.buzzQueue = [];
      s.answeringIndex = -1;
      return s;
```

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/domain/engine/reducer.flow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/engine/reducer.ts src/domain/engine/reducer.flow.test.ts
git commit -m "feat(engine): старт игры, раунд, выбор вопроса, арм/открытие buzzer"
```

---

### Task 6: reducer — buzz, очередь, вердикт, очки, закрытие

**Files:**
- Modify: `src/domain/engine/reducer.ts`
- Test: `src/domain/engine/reducer.judge.test.ts`

**Interfaces:**
- Consumes: `nextAnsweringIndex` из `rules.ts`.
- Produces: обработку `BUZZ_RECORDED`, `ANSWER_JUDGED`, `QUESTION_CLOSED`, `SCORE_ADJUSTED`.
  - `BUZZ_RECORDED`: вставка в `buzzQueue` с дедупом по команде (хранить минимальную reaction), сортировка по возрастанию; при первом buzz после открытия — фаза `ANSWERING`, `answeringIndex=0`.
  - `ANSWER_JUDGED` correct: `+value` команде, фаза `JUDGED`, `pickingTeamId=teamId`, `lastJudgedTeamId=teamId`. incorrect: `−value`, переход к `nextAnsweringIndex`; если очередь исчерпана — фаза `JUDGED` без смены picking.
  - `QUESTION_CLOSED`: добавить `currentQuestionId` в `usedQuestionIds`, очистить текущий вопрос, фаза `PICKING` (picking не меняется при провале).

- [ ] **Step 1: Написать падающий тест**

`src/domain/engine/reducer.judge.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0; const id = () => `id${n++}`;
function armed() {
  let s = initialState();
  s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }, id));
  s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
  s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }, id));
  s = applyEvent(s, makeEvent('BUZZER_OPENED', {}, id));
  return s;
}

describe('reducer — buzz и вердикт', () => {
  it('buzz строит очередь по возрастанию reaction, первый buzz → ANSWERING', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'b', reaction: 250 }, id));
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 180 }, id));
    expect(s.phase).toBe('ANSWERING');
    expect(s.buzzQueue.map(e => e.teamId)).toEqual(['a', 'b']);
    expect(s.answeringIndex).toBe(0);
  });

  it('дубликат от команды не двоит очередь (хранит минимум)', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 300 }, id));
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 150 }, id));
    expect(s.buzzQueue).toHaveLength(1);
    expect(s.buzzQueue[0].reaction).toBe(150);
  });

  it('верный ответ: +стоимость, picking переходит к команде', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'b', reaction: 200 }, id));
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'b', correct: true, value: 100 }, id));
    expect(s.teams.find(t => t.id === 'b')!.score).toBe(100);
    expect(s.phase).toBe('JUDGED');
    expect(s.pickingTeamId).toBe('b');
  });

  it('неверный: −стоимость и ход к следующей в очереди', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 100 }, id));
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'b', reaction: 200 }, id));
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: false, value: 100 }, id));
    expect(s.teams.find(t => t.id === 'a')!.score).toBe(-100);
    expect(s.phase).toBe('ANSWERING');
    expect(s.answeringIndex).toBe(1);
  });

  it('неверный последней в очереди → JUDGED, picking не меняется', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 100 }, id));
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: false, value: 100 }, id));
    expect(s.phase).toBe('JUDGED');
    expect(s.pickingTeamId).toBe('a'); // как было из ROUND_STARTED
  });

  it('QUESTION_CLOSED помечает клетку использованной, фаза PICKING', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('QUESTION_CLOSED', {}, id));
    expect(s.usedQuestionIds).toContain('q1');
    expect(s.currentQuestionId).toBeNull();
    expect(s.phase).toBe('PICKING');
  });

  it('SCORE_ADJUSTED меняет счёт вручную', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('SCORE_ADJUSTED', { teamId: 'b', delta: -50 }, id));
    expect(s.teams.find(t => t.id === 'b')!.score).toBe(-50);
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/domain/engine/reducer.judge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Дополнить reducer.ts**

Добавить импорт в начало файла:
```ts
import { nextAnsweringIndex } from './rules.js';
```
Добавить ветки перед `default`:
```ts
    case 'BUZZ_RECORDED': {
      const { teamId, reaction } = event.payload;
      const existing = s.buzzQueue.find(e => e.teamId === teamId);
      if (existing) { if (reaction < existing.reaction) existing.reaction = reaction; }
      else s.buzzQueue.push({ teamId, reaction });
      s.buzzQueue.sort((x, y) => x.reaction - y.reaction);
      if (s.phase === 'BUZZER_OPEN') { s.phase = 'ANSWERING'; s.answeringIndex = 0; }
      else if (s.phase === 'ANSWERING') {
        // переустановить указатель на текущую отвечающую команду (порядок мог сдвинуться)
        const current = s.buzzQueue[s.answeringIndex]?.teamId;
        if (current) s.answeringIndex = s.buzzQueue.findIndex(e => e.teamId === current);
      }
      return s;
    }
    case 'ANSWER_JUDGED': {
      const { teamId, correct, value } = event.payload;
      const team = s.teams.find(t => t.id === teamId);
      if (team) team.score += correct ? value : -value;
      s.lastJudgedTeamId = teamId;
      if (correct) { s.phase = 'JUDGED'; s.pickingTeamId = teamId; return s; }
      const next = nextAnsweringIndex(s.answeringIndex, s.buzzQueue.length);
      if (next === null) { s.phase = 'JUDGED'; }
      else { s.phase = 'ANSWERING'; s.answeringIndex = next; }
      return s;
    }
    case 'QUESTION_CLOSED':
      if (s.currentQuestionId) s.usedQuestionIds.push(s.currentQuestionId);
      s.currentQuestionId = null;
      s.currentValue = 0;
      s.buzzQueue = [];
      s.answeringIndex = -1;
      s.auction = null;
      s.assignedTeamId = null;
      s.phase = 'PICKING';
      return s;
    case 'SCORE_ADJUSTED': {
      const team = s.teams.find(t => t.id === event.payload.teamId);
      if (team) team.score += event.payload.delta;
      return s;
    }
```

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/domain/engine/reducer.judge.test.ts`
Expected: PASS (7 тестов).

- [ ] **Step 5: Commit**

```bash
git add src/domain/engine/reducer.ts src/domain/engine/reducer.judge.test.ts
git commit -m "feat(engine): buzz-очередь, вердикт, очки, закрытие вопроса"
```

---

### Task 7: reducer — аукцион, кот в мешке, конец раунда/игры

**Files:**
- Modify: `src/domain/engine/reducer.ts`
- Test: `src/domain/engine/reducer.special.test.ts`

**Interfaces:**
- Produces: обработку `AUCTION_BID`, `AUCTION_PASSED`, `AUCTION_WON`, `CAT_ASSIGNED`, `ROUND_ENDED`, `GAME_ENDED`.
  - `AUCTION_BID`: если `amount > highestBid` → `highestBid=amount`, `leaderTeamId=teamId`.
  - `AUCTION_PASSED`: добавить в `passedTeamIds`.
  - `AUCTION_WON`: `currentValue=amount`, `pickingTeamId=teamId` (отвечает один), фаза `ANSWERING`, `buzzQueue=[{teamId, reaction:0}]`, `answeringIndex=0`.
  - `CAT_ASSIGNED`: `assignedTeamId=toTeamId`, фаза `ANSWERING`, `buzzQueue=[{teamId:toTeamId, reaction:0}]`, `answeringIndex=0`.
  - `ROUND_ENDED`: фаза `ROUND_END`. `GAME_ENDED`: фаза `GAME_END`.

- [ ] **Step 1: Написать падающий тест**

`src/domain/engine/reducer.special.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0; const id = () => `id${n++}`;
function base(special: 'auction' | 'cat') {
  let s = initialState();
  s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }, id));
  s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
  s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special }, id));
  return s;
}

describe('reducer — спецтипы', () => {
  it('аукцион: ставка повышает лидера, WON → отвечает один на сумму ставки', () => {
    let s = base('auction');
    s = applyEvent(s, makeEvent('AUCTION_BID', { teamId: 'a', amount: 150 }, id));
    s = applyEvent(s, makeEvent('AUCTION_BID', { teamId: 'b', amount: 300 }, id));
    expect(s.auction!.leaderTeamId).toBe('b');
    s = applyEvent(s, makeEvent('AUCTION_WON', { teamId: 'b', amount: 300 }, id));
    expect(s.currentValue).toBe(300);
    expect(s.pickingTeamId).toBe('b');
    expect(s.phase).toBe('ANSWERING');
    expect(s.buzzQueue).toEqual([{ teamId: 'b', reaction: 0 }]);
  });

  it('кот в мешке: назначение получателя → отвечает он один', () => {
    let s = base('cat');
    s = applyEvent(s, makeEvent('CAT_ASSIGNED', { toTeamId: 'b' }, id));
    expect(s.assignedTeamId).toBe('b');
    expect(s.phase).toBe('ANSWERING');
    expect(s.buzzQueue).toEqual([{ teamId: 'b', reaction: 0 }]);
  });

  it('конец раунда и игры меняют фазу', () => {
    let s = base('auction');
    s = applyEvent(s, makeEvent('ROUND_ENDED', {}, id));
    expect(s.phase).toBe('ROUND_END');
    s = applyEvent(s, makeEvent('GAME_ENDED', {}, id));
    expect(s.phase).toBe('GAME_END');
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/domain/engine/reducer.special.test.ts`
Expected: FAIL.

- [ ] **Step 3: Дополнить reducer.ts**

Добавить ветки перед `default`:
```ts
    case 'AUCTION_BID':
      if (s.auction && event.payload.amount > s.auction.highestBid) {
        s.auction.highestBid = event.payload.amount;
        s.auction.leaderTeamId = event.payload.teamId;
      }
      return s;
    case 'AUCTION_PASSED':
      if (s.auction) s.auction.passedTeamIds.push(event.payload.teamId);
      return s;
    case 'AUCTION_WON':
      s.currentValue = event.payload.amount;
      s.pickingTeamId = event.payload.teamId;
      s.buzzQueue = [{ teamId: event.payload.teamId, reaction: 0 }];
      s.answeringIndex = 0;
      s.phase = 'ANSWERING';
      return s;
    case 'CAT_ASSIGNED':
      s.assignedTeamId = event.payload.toTeamId;
      s.buzzQueue = [{ teamId: event.payload.toTeamId, reaction: 0 }];
      s.answeringIndex = 0;
      s.phase = 'ANSWERING';
      return s;
    case 'ROUND_ENDED':
      s.phase = 'ROUND_END';
      return s;
    case 'GAME_ENDED':
      s.phase = 'GAME_END';
      return s;
```

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/domain/engine/reducer.special.test.ts`
Expected: PASS.

- [ ] **Step 5: Прогнать все доменные тесты**

Run: `npx vitest run src/domain`
Expected: все PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/engine/reducer.ts src/domain/engine/reducer.special.test.ts
git commit -m "feat(engine): аукцион, кот в мешке, конец раунда/игры"
```

---

# Phase 2 — Buzzer (антиснайп)

### Task 8: validateBuzz, computeBlock, rankQueue

**Files:**
- Create: `src/domain/buzzer/buzzer.ts`
- Test: `src/domain/buzzer/buzzer.test.ts`

**Interfaces:**
- Consumes: `BuzzEntry` из `types.ts`.
- Produces:
  - `validateBuzz(reaction: number, minReactionMs: number): 'valid' | 'falsestart'` — `reaction < minReactionMs` (включая отрицательные, т.е. нажатие до GO) → `'falsestart'`.
  - `computeBlock(offenseIndex: number, minMs: number, maxMs: number, rnd: () => number): number` — `offenseIndex` начинается с 0; база = `minMs + rnd()*(maxMs-minMs)`; результат = `round(база * 2^offenseIndex)`.
  - `rankQueue(raw: Array<{teamId:string;reaction:number}>): BuzzEntry[]` — дедуп по команде (минимальная reaction), сортировка по возрастанию.

- [ ] **Step 1: Написать падающий тест**

`src/domain/buzzer/buzzer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { validateBuzz, computeBlock, rankQueue } from './buzzer.js';

describe('validateBuzz', () => {
  it('реакция меньше порога — фальстарт', () => {
    expect(validateBuzz(80, 100)).toBe('falsestart');
  });
  it('нажатие до GO (отрицательная реакция) — фальстарт', () => {
    expect(validateBuzz(-30, 100)).toBe('falsestart');
  });
  it('нормальная реакция — valid', () => {
    expect(validateBuzz(180, 100)).toBe('valid');
  });
});

describe('computeBlock', () => {
  it('первый фальстарт — база без множителя', () => {
    expect(computeBlock(0, 500, 700, () => 0)).toBe(500);
    expect(computeBlock(0, 500, 700, () => 1)).toBe(700);
  });
  it('второй фальстарт — ×2', () => {
    expect(computeBlock(1, 500, 700, () => 0)).toBe(1000);
  });
  it('третий — ×4', () => {
    expect(computeBlock(2, 500, 700, () => 0)).toBe(2000);
  });
});

describe('rankQueue', () => {
  it('дедуп по команде (минимум) и сортировка', () => {
    const q = rankQueue([
      { teamId: 'a', reaction: 300 },
      { teamId: 'b', reaction: 180 },
      { teamId: 'a', reaction: 150 },
    ]);
    expect(q).toEqual([{ teamId: 'a', reaction: 150 }, { teamId: 'b', reaction: 180 }]);
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/domain/buzzer/buzzer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать buzzer.ts**

```ts
import type { BuzzEntry } from '../types.js';

export function validateBuzz(reaction: number, minReactionMs: number): 'valid' | 'falsestart' {
  return reaction < minReactionMs ? 'falsestart' : 'valid';
}

export function computeBlock(offenseIndex: number, minMs: number, maxMs: number, rnd: () => number): number {
  const base = minMs + rnd() * (maxMs - minMs);
  return Math.round(base * Math.pow(2, offenseIndex));
}

export function rankQueue(raw: Array<{ teamId: string; reaction: number }>): BuzzEntry[] {
  const best = new Map<string, number>();
  for (const b of raw) {
    const cur = best.get(b.teamId);
    if (cur === undefined || b.reaction < cur) best.set(b.teamId, b.reaction);
  }
  return [...best.entries()]
    .map(([teamId, reaction]) => ({ teamId, reaction }))
    .sort((x, y) => x.reaction - y.reaction);
}
```

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/domain/buzzer/buzzer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/buzzer/buzzer.ts src/domain/buzzer/buzzer.test.ts
git commit -m "feat(buzzer): валидация фальстарта, эскалация блока, ранжирование"
```

---

# Phase 3 — Паки (импорт ZIP)

### Task 9: zod-схема game.json

**Files:**
- Create: `src/packs/schema.ts`
- Test: `src/packs/schema.test.ts`

**Interfaces:**
- Produces: `gameJsonSchema` (zod) и `parseGameJson(data: unknown): Pack` — кидает `ZodError` с понятным путём при ошибке. Назначает `id` каждому раунду/категории/вопросу через переданный `idGen`.
  - Сигнатура: `parseGameJson(data: unknown, idGen?: () => string): Pack`.

- [ ] **Step 1: Написать падающий тест**

`src/packs/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseGameJson } from './schema.js';

let n = 0; const id = () => `id${n++}`;
const valid = {
  title: 'Демо',
  rounds: [{
    name: 'Раунд 1',
    categories: [{
      name: 'История',
      questions: [
        { type: 'text', prompt: 'Год?', answer: '1799', value: 100, special: 'none' },
        { type: 'image', prompt: 'Кто?', media: 'media/a.jpg', answer: 'X', value: 200, special: 'cat' },
      ],
    }],
  }],
};

describe('parseGameJson', () => {
  it('парсит валидный пак и проставляет id', () => {
    n = 0;
    const pack = parseGameJson(valid, id);
    expect(pack.title).toBe('Демо');
    expect(pack.rounds[0].categories[0].questions[0].id).toBeDefined();
    expect(pack.rounds[0].categories[0].questions[1].special).toBe('cat');
  });

  it('кидает при отрицательной стоимости', () => {
    const bad = structuredClone(valid);
    bad.rounds[0].categories[0].questions[0].value = -5;
    expect(() => parseGameJson(bad, id)).toThrow();
  });

  it('кидает когда у image нет media', () => {
    const bad = structuredClone(valid);
    delete (bad.rounds[0].categories[0].questions[1] as any).media;
    expect(() => parseGameJson(bad, id)).toThrow();
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/packs/schema.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать schema.ts**

```ts
import { z } from 'zod';
import type { Pack } from '../domain/types.js';

const questionSchema = z.object({
  type: z.enum(['text', 'image', 'audio']),
  prompt: z.string().min(1),
  media: z.string().optional(),
  answer: z.string().min(1),
  value: z.number().int().nonnegative(),
  special: z.enum(['none', 'auction', 'cat']),
}).refine(q => q.type === 'text' || !!q.media, {
  message: 'media обязателен для type image/audio', path: ['media'],
});

const categorySchema = z.object({ name: z.string().min(1), questions: z.array(questionSchema).min(1) });
const roundSchema = z.object({ name: z.string().min(1), categories: z.array(categorySchema).min(1) });
export const gameJsonSchema = z.object({ title: z.string().min(1), rounds: z.array(roundSchema).min(1) });

export function parseGameJson(data: unknown, idGen: () => string = () => crypto.randomUUID()): Pack {
  const parsed = gameJsonSchema.parse(data);
  return {
    id: idGen(),
    title: parsed.title,
    rounds: parsed.rounds.map(r => ({
      id: idGen(), name: r.name,
      categories: r.categories.map(c => ({
        id: idGen(), name: c.name,
        questions: c.questions.map(q => ({ id: idGen(), ...q })),
      })),
    })),
  };
}
```

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/packs/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/packs/schema.ts src/packs/schema.test.ts
git commit -m "feat(packs): zod-схема game.json"
```

---

### Task 10: Импорт ZIP-пака

**Files:**
- Create: `src/packs/import.ts`
- Test: `src/packs/import.test.ts`

**Interfaces:**
- Consumes: `parseGameJson`.
- Produces: `importPackZip(zipBuffer: Buffer, mediaTargetDir: string, idGen?: () => string): Pack` — читает `game.json` из архива, валидирует, **распаковывает все файлы из `media/`** в `mediaTargetDir/<packId>/`, проверяет что каждый `media`-путь вопроса существует в архиве (иначе throw). Возвращает `Pack`.

- [ ] **Step 1: Написать падающий тест**

`src/packs/import.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import AdmZip from 'adm-zip';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { importPackZip } from './import.js';

const TMP = join(process.cwd(), 'data', 'test-media');
let n = 0; const id = () => `id${n++}`;

function buildZip(withMedia: boolean): Buffer {
  const zip = new AdmZip();
  const game = {
    title: 'Z', rounds: [{ name: 'R', categories: [{ name: 'C', questions: [
      { type: 'image', prompt: 'p', media: 'media/a.jpg', answer: 'x', value: 100, special: 'none' },
    ]}]}],
  };
  zip.addFile('game.json', Buffer.from(JSON.stringify(game), 'utf8'));
  if (withMedia) zip.addFile('media/a.jpg', Buffer.from([1, 2, 3]));
  return zip.toBuffer();
}

describe('importPackZip', () => {
  beforeEach(() => { rmSync(TMP, { recursive: true, force: true }); n = 0; });

  it('импортирует пак и распаковывает медиа', () => {
    const pack = importPackZip(buildZip(true), TMP, id);
    expect(pack.rounds[0].categories[0].questions[0].media).toBe('media/a.jpg');
    expect(existsSync(join(TMP, pack.id, 'media', 'a.jpg'))).toBe(true);
  });

  it('кидает если media-файл из вопроса отсутствует в архиве', () => {
    expect(() => importPackZip(buildZip(false), TMP, id)).toThrow(/media\/a\.jpg/);
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/packs/import.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать import.ts**

```ts
import AdmZip from 'adm-zip';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseGameJson } from './schema.js';
import type { Pack } from '../domain/types.js';

export function importPackZip(zipBuffer: Buffer, mediaTargetDir: string, idGen: () => string = () => crypto.randomUUID()): Pack {
  const zip = new AdmZip(zipBuffer);
  const gameEntry = zip.getEntry('game.json');
  if (!gameEntry) throw new Error('В архиве нет game.json');
  const data = JSON.parse(zip.readAsText(gameEntry));
  const pack = parseGameJson(data, idGen);

  // проверка наличия всех media-путей
  const names = new Set(zip.getEntries().map(e => e.entryName));
  for (const r of pack.rounds) for (const c of r.categories) for (const q of c.questions) {
    if (q.media && !names.has(q.media)) throw new Error(`media-файл отсутствует в архиве: ${q.media}`);
  }

  const dest = join(mediaTargetDir, pack.id);
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    if (!e.entryName.startsWith('media/')) continue;
    const target = join(dest, e.entryName);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, e.getData());
  }
  return pack;
}
```

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/packs/import.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/packs/import.ts src/packs/import.test.ts
git commit -m "feat(packs): импорт ZIP с распаковкой и проверкой медиа"
```

---

# Phase 4 — Персистентность (event sourcing)

### Task 11: SQLite-схема и открытие БД

**Files:**
- Create: `src/persistence/db.ts`
- Test: `src/persistence/db.test.ts`

**Interfaces:**
- Produces: `openDb(path: string): Database` — создаёт таблицы `events(seq INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT, event_id TEXT UNIQUE, type TEXT, payload TEXT)`, `snapshots(game_id TEXT, seq INTEGER, state TEXT)`, `packs(id TEXT PRIMARY KEY, data TEXT)`. `:memory:` поддерживается. Тип `Database` реэкспортируется из better-sqlite3.

- [ ] **Step 1: Написать падающий тест**

`src/persistence/db.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from './db.js';

describe('openDb', () => {
  it('создаёт таблицы events/snapshots/packs', () => {
    const db = openDb(':memory:');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('events');
    expect(names).toContain('snapshots');
    expect(names).toContain('packs');
  });

  it('event_id уникален', () => {
    const db = openDb(':memory:');
    const ins = db.prepare("INSERT INTO events (game_id,event_id,type,payload) VALUES (?,?,?,?)");
    ins.run('g', 'e1', 'X', '{}');
    expect(() => ins.run('g', 'e1', 'X', '{}')).toThrow();
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/persistence/db.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать db.ts**

```ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      game_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      state TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS packs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);
  return db;
}
```

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/persistence/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/db.ts src/persistence/db.test.ts
git commit -m "feat(persistence): SQLite-схема и открытие БД"
```

---

### Task 12: EventStore — append, идемпотентность, снэпшоты, восстановление

**Files:**
- Create: `src/persistence/eventStore.ts`
- Test: `src/persistence/eventStore.test.ts`

**Interfaces:**
- Consumes: `openDb`, `applyEvent`, `initialState`, `GameEvent`, `GameState`.
- Produces: класс `EventStore`:
  - `constructor(db: Db, snapshotEvery: number)`.
  - `append(gameId: string, event: GameEvent): GameState` — пишет событие (если `event.id` уже есть — игнор, идемпотентно), применяет к кэшу состояния, раз в `snapshotEvery` пишет снэпшот; возвращает актуальное состояние.
  - `loadState(gameId: string): GameState` — берёт последний снэпшот (или `initialState`) и реплеит хвост событий с `seq` больше снэпшота.

- [ ] **Step 1: Написать падающий тест**

`src/persistence/eventStore.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from './db.js';
import { EventStore } from './eventStore.js';
import { makeEvent } from '../domain/events.js';

let n = 0; const id = () => `e${n++}`;

describe('EventStore', () => {
  it('append применяет события и копит состояние', () => {
    const store = new EventStore(openDb(':memory:'), 25);
    store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }, id));
    const s = store.append('g', makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, id));
    expect(s.teams).toHaveLength(1);
  });

  it('повторный append того же event.id идемпотентен', () => {
    const store = new EventStore(openDb(':memory:'), 25);
    const e = makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, () => 'same');
    store.append('g', e);
    const s = store.append('g', e);
    expect(s.teams).toHaveLength(1);
  });

  it('loadState восстанавливает из снэпшота + реплей хвоста', () => {
    const db = openDb(':memory:');
    const store = new EventStore(db, 2); // снэпшот каждые 2 события
    store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }, id));
    store.append('g', makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, id)); // тут снэпшот
    store.append('g', makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }, id)); // хвост
    const fresh = new EventStore(db, 2);
    const s = fresh.loadState('g');
    expect(s.teams.map(t => t.id)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/persistence/eventStore.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать eventStore.ts**

```ts
import type { Db } from './db.js';
import type { GameEvent } from '../domain/events.js';
import type { GameState } from '../domain/types.js';
import { applyEvent } from '../domain/engine/reducer.js';
import { initialState } from '../domain/engine/state.js';

export class EventStore {
  private cache = new Map<string, { seq: number; state: GameState }>();
  constructor(private db: Db, private snapshotEvery: number) {}

  append(gameId: string, event: GameEvent): GameState {
    const exists = this.db.prepare('SELECT 1 FROM events WHERE event_id = ?').get(event.id);
    let cur = this.cache.get(gameId) ?? { seq: 0, state: this.loadState(gameId) };
    if (exists) { this.cache.set(gameId, cur); return cur.state; }

    const info = this.db.prepare('INSERT INTO events (game_id,event_id,type,payload) VALUES (?,?,?,?)')
      .run(gameId, event.id, event.type, JSON.stringify(event.payload));
    const seq = Number(info.lastInsertRowid);
    const state = applyEvent(cur.state, event);
    cur = { seq, state };
    this.cache.set(gameId, cur);

    if (seq % this.snapshotEvery === 0) {
      this.db.prepare('INSERT INTO snapshots (game_id,seq,state) VALUES (?,?,?)')
        .run(gameId, seq, JSON.stringify(state));
    }
    return state;
  }

  loadState(gameId: string): GameState {
    const snap = this.db.prepare(
      'SELECT seq,state FROM snapshots WHERE game_id = ? ORDER BY seq DESC LIMIT 1'
    ).get(gameId) as { seq: number; state: string } | undefined;

    let state = snap ? (JSON.parse(snap.state) as GameState) : initialState();
    const fromSeq = snap ? snap.seq : 0;

    const rows = this.db.prepare(
      'SELECT type,payload FROM events WHERE game_id = ? AND seq > ? ORDER BY seq ASC'
    ).all(gameId, fromSeq) as { type: string; payload: string }[];

    for (const r of rows) {
      state = applyEvent(state, { id: '', type: r.type, payload: JSON.parse(r.payload) } as GameEvent);
    }
    return state;
  }
}
```

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/persistence/eventStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Прогнать все backend-тесты**

Run: `npx vitest run src`
Expected: все PASS.

- [ ] **Step 6: Commit**

```bash
git add src/persistence/eventStore.ts src/persistence/eventStore.test.ts
git commit -m "feat(persistence): EventStore с идемпотентностью, снэпшотами и реплеем"
```

---

# Phase 5 — Realtime: протокол и сессии

### Task 13: Типы протокола

**Files:**
- Create: `src/realtime/protocol.ts`
- Test: `src/realtime/protocol.test.ts`

**Interfaces:**
- Produces:
  - `ClientToServer` — карта событий: `join`, `rejoin`, `createTeam`, `hostAction`, `playerBuzz`.
  - `ServerToClient` — `state` (публичное состояние), `youAre`, `goSignal`, `blocked`, `error`.
  - `PublicState` — состояние **без ответов** (для игроков/табло), `HostState` — с ответом текущего вопроса.
  - `toPublicState(state: GameState, pack: Pack): PublicState`, `toHostState(state: GameState, pack: Pack): HostState`.

- [ ] **Step 1: Написать падающий тест**

`src/realtime/protocol.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toPublicState, toHostState } from './protocol.js';
import { initialState } from '../domain/engine/state.js';
import type { Pack } from '../domain/types.js';

const pack: Pack = { id: 'p', title: 'T', rounds: [{ id: 'r', name: 'R', categories: [{ id: 'c', name: 'C',
  questions: [{ id: 'q1', type: 'text', prompt: 'Вопрос?', answer: 'СЕКРЕТ', value: 100, special: 'none' }] }] }] };

describe('проекции состояния', () => {
  it('PublicState не содержит ответа', () => {
    const s = { ...initialState(), currentQuestionId: 'q1' };
    const pub = toPublicState(s, pack);
    expect(JSON.stringify(pub)).not.toContain('СЕКРЕТ');
    expect(pub.currentPrompt).toBe('Вопрос?');
  });
  it('HostState содержит ответ', () => {
    const s = { ...initialState(), currentQuestionId: 'q1' };
    const host = toHostState(s, pack);
    expect(host.currentAnswer).toBe('СЕКРЕТ');
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/realtime/protocol.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать protocol.ts**

```ts
import type { GameState, Pack, Question, Team, BuzzEntry, Phase } from '../domain/types.js';

function findQuestion(pack: Pack, id: string | null): Question | null {
  if (!id) return null;
  for (const r of pack.rounds) for (const c of r.categories) for (const q of c.questions)
    if (q.id === id) return q;
  return null;
}

export interface PublicState {
  phase: Phase;
  title: string;
  teams: Team[];
  roundIndex: number;
  usedQuestionIds: string[];
  pickingTeamId: string | null;
  buzzQueue: BuzzEntry[];
  answeringTeamId: string | null;
  currentPrompt: string | null;
  currentType: Question['type'] | null;
  currentMedia: string | null;
  currentValue: number;
}
export interface HostState extends PublicState {
  currentAnswer: string | null;
}

function buildPublic(s: GameState, pack: Pack): PublicState {
  const q = findQuestion(pack, s.currentQuestionId);
  return {
    phase: s.phase, title: s.title, teams: s.teams, roundIndex: s.roundIndex,
    usedQuestionIds: s.usedQuestionIds, pickingTeamId: s.pickingTeamId,
    buzzQueue: s.buzzQueue,
    answeringTeamId: s.answeringIndex >= 0 ? s.buzzQueue[s.answeringIndex]?.teamId ?? null : null,
    currentPrompt: q?.prompt ?? null,
    currentType: q?.type ?? null,
    currentMedia: q?.media ?? null,
    currentValue: s.currentValue,
  };
}

export function toPublicState(s: GameState, pack: Pack): PublicState { return buildPublic(s, pack); }
export function toHostState(s: GameState, pack: Pack): HostState {
  const q = findQuestion(pack, s.currentQuestionId);
  return { ...buildPublic(s, pack), currentAnswer: q?.answer ?? null };
}

// Контракты сообщений (используются клиентом и gateway)
export interface ClientToServer {
  join: { gameId: string; firstName: string; lastName: string; teamId: string; clientToken: string };
  rejoin: { clientToken: string };
  createTeam: { name: string };
  hostAction: { action: string; data?: unknown };
  playerBuzz: { reaction: number };
}
export interface ServerToClient {
  state: PublicState | HostState;
  youAre: { playerId: string; teamId: string; role: 'host' | 'player' | 'board' };
  goSignal: { serverTime: number };
  blocked: { untilMs: number };
  error: { message: string };
}
```

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/realtime/protocol.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/realtime/protocol.ts src/realtime/protocol.test.ts
git commit -m "feat(realtime): протокол и проекции public/host (ответ скрыт)"
```

---

### Task 14: Реестр сессий по clientToken

**Files:**
- Create: `src/realtime/session.ts`
- Test: `src/realtime/session.test.ts`

**Interfaces:**
- Produces: класс `SessionRegistry`:
  - `bind(clientToken: string, socketId: string, playerId: string, role: 'host'|'player'|'board'): void`.
  - `bySocket(socketId: string): Session | undefined`, `byToken(token: string): Session | undefined`.
  - `markDisconnected(socketId: string): Session | undefined` — снимает привязку сокета, но сессия по токену остаётся.
  - `type Session = { clientToken: string; socketId: string | null; playerId: string; role: ... }`.

- [ ] **Step 1: Написать падающий тест**

`src/realtime/session.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SessionRegistry } from './session.js';

describe('SessionRegistry', () => {
  it('bind и поиск по токену/сокету', () => {
    const r = new SessionRegistry();
    r.bind('tok', 'sock1', 'pl1', 'player');
    expect(r.byToken('tok')?.playerId).toBe('pl1');
    expect(r.bySocket('sock1')?.clientToken).toBe('tok');
  });

  it('markDisconnected снимает сокет, сессия по токену жива', () => {
    const r = new SessionRegistry();
    r.bind('tok', 'sock1', 'pl1', 'player');
    r.markDisconnected('sock1');
    expect(r.bySocket('sock1')).toBeUndefined();
    expect(r.byToken('tok')?.socketId).toBeNull();
  });

  it('повторный bind того же токена обновляет сокет (реконнект)', () => {
    const r = new SessionRegistry();
    r.bind('tok', 'sock1', 'pl1', 'player');
    r.bind('tok', 'sock2', 'pl1', 'player');
    expect(r.byToken('tok')?.socketId).toBe('sock2');
    expect(r.bySocket('sock1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/realtime/session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать session.ts**

```ts
export type Role = 'host' | 'player' | 'board';
export interface Session { clientToken: string; socketId: string | null; playerId: string; role: Role; }

export class SessionRegistry {
  private byTokenMap = new Map<string, Session>();
  private bySocketMap = new Map<string, Session>();

  bind(clientToken: string, socketId: string, playerId: string, role: Role): void {
    const existing = this.byTokenMap.get(clientToken);
    if (existing?.socketId) this.bySocketMap.delete(existing.socketId);
    const session: Session = { clientToken, socketId, playerId, role };
    this.byTokenMap.set(clientToken, session);
    this.bySocketMap.set(socketId, session);
  }
  bySocket(socketId: string): Session | undefined { return this.bySocketMap.get(socketId); }
  byToken(token: string): Session | undefined { return this.byTokenMap.get(token); }
  markDisconnected(socketId: string): Session | undefined {
    const s = this.bySocketMap.get(socketId);
    if (!s) return undefined;
    this.bySocketMap.delete(socketId);
    s.socketId = null;
    return s;
  }
}
```

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/realtime/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/realtime/session.ts src/realtime/session.test.ts
git commit -m "feat(realtime): реестр сессий по clientToken (реконнект)"
```

---

# Phase 6 — Сервер: HTTP, gateway, bootstrap

### Task 15: Fastify-сервер (static, upload пака, media)

**Files:**
- Create: `src/http/server.ts`
- Test: `src/http/server.test.ts`

**Interfaces:**
- Consumes: `importPackZip`, `EventStore`, `config`.
- Produces: `buildServer(deps: { store: EventStore; db: Db; config: Config }): FastifyInstance`.
  - `POST /api/packs` (multipart, поле `file`) → импортирует пак, сохраняет в таблицу `packs`, возвращает `{ packId, title, rounds: [...] }`.
  - `POST /api/games` (json `{ packId, title, teamCount }`) → пишет `GAME_CREATED`, возвращает `{ gameId }`.
  - `GET /media/:packId/*` → отдаёт файл из `mediaDir/packId/media/...`.
  - `GET /api/games/:gameId/exists` → `{ exists: boolean }` (для плейсхолдера на /play, /board).

- [ ] **Step 1: Написать падающий тест**

`src/http/server.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { buildServer } from './server.js';
import { openDb } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { config } from '../config.js';

function makeDeps() {
  const db = openDb(':memory:');
  return { store: new EventStore(db, 25), db, config: { ...config, mediaDir: 'data/test-http-media' } };
}
function packZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile('game.json', Buffer.from(JSON.stringify({
    title: 'X', rounds: [{ name: 'R', categories: [{ name: 'C', questions: [
      { type: 'text', prompt: 'p', answer: 'a', value: 100, special: 'none' }] }] }],
  })));
  return zip.toBuffer();
}

describe('HTTP API', () => {
  it('загрузка пака и создание игры', async () => {
    const app = buildServer(makeDeps());
    const form = new FormData();
    form.append('file', new Blob([packZip()]), 'pack.zip');
    const up = await app.inject({ method: 'POST', url: '/api/packs', payload: form });
    expect(up.statusCode).toBe(200);
    const { packId } = up.json();
    expect(packId).toBeDefined();

    const cr = await app.inject({ method: 'POST', url: '/api/games', payload: { packId, title: 'Игра', teamCount: 2 } });
    expect(cr.statusCode).toBe(200);
    expect(cr.json().gameId).toBeDefined();
    await app.close();
  });

  it('exists=false для несуществующей игры', async () => {
    const app = buildServer(makeDeps());
    const res = await app.inject({ method: 'GET', url: '/api/games/nope/exists' });
    expect(res.json().exists).toBe(false);
    await app.close();
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/http/server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать server.ts**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { importPackZip } from '../packs/import.js';
import type { EventStore } from '../persistence/eventStore.js';
import type { Db } from '../persistence/db.js';
import type { Config } from '../config.js';
import { makeEvent } from '../domain/events.js';

export interface ServerDeps { store: EventStore; db: Db; config: Config; }

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(multipart);

  const webDist = resolve(process.cwd(), 'web', 'dist');
  if (existsSync(webDist)) app.register(fastifyStatic, { root: webDist });

  app.post('/api/packs', async (req, reply) => {
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: 'нет файла' });
    const buf = await file.toBuffer();
    let pack;
    try { pack = importPackZip(buf, deps.config.mediaDir); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    deps.db.prepare('INSERT OR REPLACE INTO packs (id,data) VALUES (?,?)').run(pack.id, JSON.stringify(pack));
    return { packId: pack.id, title: pack.title, rounds: pack.rounds.length };
  });

  app.post('/api/games', async (req, reply) => {
    const { packId, title, teamCount } = req.body as { packId: string; title: string; teamCount: number };
    const row = deps.db.prepare('SELECT id FROM packs WHERE id = ?').get(packId);
    if (!row) return reply.code(404).send({ error: 'пак не найден' });
    const gameId = crypto.randomUUID();
    deps.store.append(gameId, makeEvent('GAME_CREATED', { gameId, packId, title, teamCount }));
    return { gameId };
  });

  app.get('/api/games/:gameId/exists', async (req) => {
    const { gameId } = req.params as { gameId: string };
    const row = deps.db.prepare('SELECT 1 FROM events WHERE game_id = ? LIMIT 1').get(gameId);
    return { exists: !!row };
  });

  app.get('/media/:packId/*', async (req, reply) => {
    const { packId } = req.params as { packId: string; '*': string };
    const rest = (req.params as any)['*'] as string;
    const path = join(resolve(deps.config.mediaDir), packId, 'media', rest);
    if (!path.startsWith(join(resolve(deps.config.mediaDir), packId))) return reply.code(403).send();
    if (!existsSync(path)) return reply.code(404).send();
    return reply.send((await import('node:fs')).createReadStream(path));
  });

  return app;
}
```

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/http/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/http/server.ts src/http/server.test.ts
git commit -m "feat(http): Fastify — загрузка пака, создание игры, отдача медиа"
```

---

### Task 16: Gateway (Socket.IO) — join/rejoin, комнаты, рассылка состояния

**Files:**
- Create: `src/realtime/gateway.ts`
- Test: `src/realtime/gateway.test.ts`

**Interfaces:**
- Consumes: `EventStore`, `SessionRegistry`, `toPublicState`, `toHostState`, `loadPack(db,packId)`.
- Produces: `attachGateway(io: Server, deps: { store; db; sessions: SessionRegistry; config })`.
  - Хелпер `loadPack(db, packId): Pack` (читает из таблицы `packs`).
  - На `connection`: клиент шлёт `join`/`rejoin`. Логика join: создать `PLAYER_JOINED`, `bind` сессию, добавить сокет в комнаты `game:<gameId>` и роль-комнату, разослать состояние. На `disconnect`: `markDisconnected` + `PLAYER_DISCONNECTED`.
  - Функция `broadcastState(io, deps, gameId)`: шлёт `toPublicState` в комнаты player/board, `toHostState` — в host.

- [ ] **Step 1: Написать падающий тест**

`src/realtime/gateway.test.ts`:
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

function setup() {
  const db = openDb(':memory:');
  const store = new EventStore(db, 25);
  const pack = { id: 'p', title: 'T', rounds: [{ id: 'r', name: 'R', categories: [{ id: 'c', name: 'C',
    questions: [{ id: 'q1', type: 'text', prompt: 'Q?', answer: 'SECRET', value: 100, special: 'none' }] }] }] };
  db.prepare('INSERT INTO packs (id,data) VALUES (?,?)').run('p', JSON.stringify(pack));
  store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }));
  store.append('g', makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }));
  const httpServer = createServer();
  const ioServer = new Server(httpServer);
  attachGateway(ioServer, { store, db, sessions: new SessionRegistry(), config });
  return new Promise<{ url: string; ioServer: Server; httpServer: any }>(res => {
    httpServer.listen(() => {
      const port = (httpServer.address() as any).port;
      res({ url: `http://localhost:${port}`, ioServer, httpServer });
    });
  });
}

let open: Socket[] = [];
afterEach(() => { open.forEach(s => s.close()); open = []; });

describe('gateway', () => {
  it('player join получает состояние без ответа', async () => {
    const { url } = await setup();
    const c = Client(url, { transports: ['websocket'] }); open.push(c);
    const state: any = await new Promise(res => {
      c.on('connect', () => c.emit('join', { gameId: 'g', firstName: 'И', lastName: 'П', teamId: 'a', clientToken: 'tok', role: 'player' }));
      c.on('state', res);
    });
    expect(JSON.stringify(state)).not.toContain('SECRET');
    expect(state.teams).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/realtime/gateway.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать gateway.ts**

```ts
import type { Server } from 'socket.io';
import type { EventStore } from '../persistence/eventStore.js';
import type { Db } from '../persistence/db.js';
import type { Config } from '../config.js';
import type { Pack } from '../domain/types.js';
import { SessionRegistry, type Role } from './session.js';
import { makeEvent } from '../domain/events.js';
import { toPublicState, toHostState } from './protocol.js';

export interface GatewayDeps { store: EventStore; db: Db; sessions: SessionRegistry; config: Config; }

export function loadPack(db: Db, packId: string): Pack {
  const row = db.prepare('SELECT data FROM packs WHERE id = ?').get(packId) as { data: string } | undefined;
  if (!row) throw new Error('пак не найден');
  return JSON.parse(row.data) as Pack;
}

export function broadcastState(io: Server, deps: GatewayDeps, gameId: string): void {
  const state = deps.store.loadState(gameId);
  const pack = loadPack(deps.db, state.packId);
  io.to(`game:${gameId}:player`).emit('state', toPublicState(state, pack));
  io.to(`game:${gameId}:board`).emit('state', toPublicState(state, pack));
  io.to(`game:${gameId}:host`).emit('state', toHostState(state, pack));
}

export function attachGateway(io: Server, deps: GatewayDeps): void {
  io.on('connection', (socket) => {
    let joinedGame: string | null = null;

    socket.on('join', (p: { gameId: string; firstName: string; lastName: string; teamId: string; clientToken: string; role: Role }) => {
      joinedGame = p.gameId;
      const playerId = crypto.randomUUID();
      if (p.role === 'player') {
        deps.store.append(p.gameId, makeEvent('PLAYER_JOINED', {
          playerId, clientToken: p.clientToken, firstName: p.firstName, lastName: p.lastName, teamId: p.teamId,
        }));
      }
      deps.sessions.bind(p.clientToken, socket.id, playerId, p.role);
      socket.join(`game:${p.gameId}`);
      socket.join(`game:${p.gameId}:${p.role}`);
      socket.emit('youAre', { playerId, teamId: p.teamId, role: p.role });
      broadcastState(io, deps, p.gameId);
    });

    socket.on('disconnect', () => {
      const s = deps.sessions.markDisconnected(socket.id);
      if (s && joinedGame && s.role === 'player') {
        deps.store.append(joinedGame, makeEvent('PLAYER_DISCONNECTED', { playerId: s.playerId }));
        broadcastState(io, deps, joinedGame);
      }
    });
  });
}
```

> Примечание для исполнителя: установить клиентскую зависимость для теста —
> `npm i -D socket.io-client`.

- [ ] **Step 4: Запустить — проход**

Run: `npm i -D socket.io-client && npx vitest run src/realtime/gateway.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/realtime/gateway.ts src/realtime/gateway.test.ts package.json package-lock.json
git commit -m "feat(realtime): gateway join/disconnect, комнаты, рассылка состояния"
```

---

### Task 17: Gateway — действия ведущего и buzz с фальстарт-блоком

**Files:**
- Modify: `src/realtime/gateway.ts`
- Test: `src/realtime/gateway.actions.test.ts`

**Interfaces:**
- Consumes: `validateBuzz`, `computeBlock`, `lowestScoreTeamId`.
- Produces в `attachGateway`:
  - `socket.on('hostAction', { action, data })` — мапит действия в события: `startGame`→`GAME_STARTED`; `startRound`→`ROUND_STARTED`(pickingTeamId=lowestScore); `selectQuestion`→`QUESTION_SELECTED`; `arm`→`BUZZER_ARMED`; `open`→`BUZZER_OPENED`(+ рассылка `goSignal` с серверным временем); `judge`→`ANSWER_JUDGED`; `closeQuestion`→`QUESTION_CLOSED`; `auctionWon`/`catAssign`/`endRound`/`endGame`/`adjustScore`. После каждого — `broadcastState`.
  - `socket.on('playerBuzz', { reaction })`: по сессии найти команду игрока; `validateBuzz` → при фальстарте инкремент `blocks[playerId]`, `computeBlock`, `socket.emit('blocked', {untilMs})`, без события очереди; при valid — `BUZZ_RECORDED`, `broadcastState`.
  - Хелпер `playerTeam(state, playerId): string | null`.

- [ ] **Step 1: Написать падающий тест**

`src/realtime/gateway.actions.test.ts`:
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

async function setup() {
  const db = openDb(':memory:');
  const store = new EventStore(db, 25);
  const pack = { id: 'p', title: 'T', rounds: [{ id: 'r', name: 'R', categories: [{ id: 'c', name: 'C',
    questions: [{ id: 'q1', type: 'text', prompt: 'Q?', answer: 'S', value: 100, special: 'none' }] }] }] };
  db.prepare('INSERT INTO packs (id,data) VALUES (?,?)').run('p', JSON.stringify(pack));
  store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }));
  store.append('g', makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }));
  store.append('g', makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }));
  const httpServer = createServer();
  const ioServer = new Server(httpServer);
  attachGateway(ioServer, { store, db, sessions: new SessionRegistry(), config: { ...config, minReactionMs: 100 } });
  const port: number = await new Promise(r => httpServer.listen(() => r((httpServer.address() as any).port)));
  return { url: `http://localhost:${port}`, store };
}

let open: Socket[] = [];
afterEach(() => { open.forEach(s => s.close()); open = []; });

function join(url: string, role: string, teamId: string, token: string): Promise<Socket> {
  const c = Client(url, { transports: ['websocket'] }); open.push(c);
  return new Promise(res => {
    c.on('connect', () => { c.emit('join', { gameId: 'g', firstName: 'И', lastName: 'П', teamId, clientToken: token, role }); res(c); });
  });
}

describe('gateway actions', () => {
  it('фальстарт-нажатие возвращает blocked и не попадает в очередь', async () => {
    const { url, store } = await setup();
    const player = await join(url, 'player', 'a', 'tokA');
    const blocked: any = await new Promise(res => {
      player.on('blocked', res);
      player.emit('playerBuzz', { reaction: 50 }); // < порога 100
    });
    expect(blocked.untilMs).toBeGreaterThan(0);
    expect(store.loadState('g').buzzQueue).toHaveLength(0);
  });

  it('валидный buzz попадает в очередь команды', async () => {
    const { url, store } = await setup();
    const host = await join(url, 'host', 'a', 'tokH');
    host.emit('hostAction', { action: 'selectQuestion', data: { questionId: 'q1', value: 100, special: 'none' } });
    host.emit('hostAction', { action: 'open' });
    const player = await join(url, 'player', 'a', 'tokA');
    await new Promise(r => setTimeout(r, 50));
    player.emit('playerBuzz', { reaction: 200 });
    await new Promise(r => setTimeout(r, 50));
    expect(store.loadState('g').buzzQueue.map(e => e.teamId)).toContain('a');
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `npx vitest run src/realtime/gateway.actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Дополнить gateway.ts**

Добавить импорты:
```ts
import { validateBuzz, computeBlock } from '../domain/buzzer/buzzer.js';
import { lowestScoreTeamId } from '../domain/engine/rules.js';
```
Добавить хелпер (вне `attachGateway`):
```ts
import type { GameState } from '../domain/types.js';
function playerTeam(state: GameState, playerId: string): string | null {
  return state.players.find(p => p.id === playerId)?.teamId ?? null;
}
```
Внутри `io.on('connection', ...)` добавить обработчики (после `join`):
```ts
    socket.on('hostAction', (msg: { action: string; data?: any }) => {
      if (!joinedGame) return;
      const gid = joinedGame;
      const st = deps.store.loadState(gid);
      const d = msg.data ?? {};
      switch (msg.action) {
        case 'startGame': deps.store.append(gid, makeEvent('GAME_STARTED', {})); break;
        case 'startRound':
          deps.store.append(gid, makeEvent('ROUND_STARTED', { roundIndex: d.roundIndex, pickingTeamId: lowestScoreTeamId(st.teams) }));
          break;
        case 'selectQuestion':
          deps.store.append(gid, makeEvent('QUESTION_SELECTED', { questionId: d.questionId, value: d.value, special: d.special }));
          break;
        case 'arm': deps.store.append(gid, makeEvent('BUZZER_ARMED', {})); break;
        case 'open':
          deps.store.append(gid, makeEvent('BUZZER_OPENED', {}));
          io.to(`game:${gid}`).emit('goSignal', { serverTime: Date.now() });
          break;
        case 'judge': deps.store.append(gid, makeEvent('ANSWER_JUDGED', { teamId: d.teamId, correct: d.correct, value: st.currentValue })); break;
        case 'closeQuestion': deps.store.append(gid, makeEvent('QUESTION_CLOSED', {})); break;
        case 'auctionBid': deps.store.append(gid, makeEvent('AUCTION_BID', { teamId: d.teamId, amount: d.amount })); break;
        case 'auctionWon': deps.store.append(gid, makeEvent('AUCTION_WON', { teamId: d.teamId, amount: d.amount })); break;
        case 'catAssign': deps.store.append(gid, makeEvent('CAT_ASSIGNED', { toTeamId: d.toTeamId })); break;
        case 'adjustScore': deps.store.append(gid, makeEvent('SCORE_ADJUSTED', { teamId: d.teamId, delta: d.delta })); break;
        case 'endRound': deps.store.append(gid, makeEvent('ROUND_ENDED', {})); break;
        case 'endGame': deps.store.append(gid, makeEvent('GAME_ENDED', {})); break;
      }
      broadcastState(io, deps, gid);
    });

    socket.on('playerBuzz', (msg: { reaction: number }) => {
      if (!joinedGame) return;
      const session = deps.sessions.bySocket(socket.id);
      if (!session) return;
      const st = deps.store.loadState(joinedGame);
      const teamId = playerTeam(st, session.playerId);
      if (!teamId) return;
      if (validateBuzz(msg.reaction, deps.config.minReactionMs) === 'falsestart') {
        const offense = st.blocks[session.playerId] ?? 0;
        const untilMs = computeBlock(offense, deps.config.blockMinMs, deps.config.blockMaxMs, Math.random);
        deps.store.append(joinedGame, makeEvent('SCORE_ADJUSTED', { teamId, delta: 0 })); // no-op для аудита; блок храним вне стейта
        socket.emit('blocked', { untilMs });
        return;
      }
      deps.store.append(joinedGame, makeEvent('BUZZ_RECORDED', { teamId, reaction: msg.reaction }));
      broadcastState(io, deps, joinedGame);
    });
```

> Примечание: счётчик фальстартов `blocks[playerId]` для эскалации в MVP держим в gateway in-memory (см. Task ниже не требуется — простая `Map` на уровне gateway). Заменить строку no-op `SCORE_ADJUSTED` на инкремент `Map`:

Добавить в начало `attachGateway`:
```ts
  const offenseCount = new Map<string, number>();
```
И в ветке фальстарта вместо no-op:
```ts
        const prev = offenseCount.get(session.playerId) ?? 0;
        const untilMs = computeBlock(prev, deps.config.blockMinMs, deps.config.blockMaxMs, Math.random);
        offenseCount.set(session.playerId, prev + 1);
        socket.emit('blocked', { untilMs });
        return;
```
(убрать строки про `offense` и no-op `SCORE_ADJUSTED`).

- [ ] **Step 4: Запустить — проход**

Run: `npx vitest run src/realtime/gateway.actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/realtime/gateway.ts src/realtime/gateway.actions.test.ts
git commit -m "feat(realtime): действия ведущего и buzz с фальстарт-блоком"
```

---

### Task 18: Bootstrap (index.ts)

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: всё выше.
- Produces: запуск процесса: открыть БД, создать `EventStore`, `SessionRegistry`, `buildServer`, поднять Socket.IO поверх Fastify-сервера, `attachGateway`, слушать `config.port`.

- [ ] **Step 1: Реализовать index.ts**

```ts
import { Server } from 'socket.io';
import { config } from './config.js';
import { openDb } from './persistence/db.js';
import { EventStore } from './persistence/eventStore.js';
import { SessionRegistry } from './realtime/session.js';
import { buildServer } from './http/server.js';
import { attachGateway } from './realtime/gateway.js';

const db = openDb(config.dbPath);
const store = new EventStore(db, config.snapshotEvery);
const sessions = new SessionRegistry();
const app = buildServer({ store, db, config });

await app.ready();
const io = new Server(app.server, { cors: { origin: true } });
attachGateway(io, { store, db, sessions, config });

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Сервер на http://0.0.0.0:${config.port}`);
```

- [ ] **Step 2: Проверить запуск**

Run: `DB_PATH=data/dev.db npx tsx src/index.ts` (Ctrl+C через пару секунд)
Expected: лог «Сервер на http://0.0.0.0:3000», без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: bootstrap сервера (Fastify + Socket.IO)"
```

---

# Phase 7 — Фронтенд: основа и общие компоненты

### Task 19: Vite + Svelte скелет, три входа, тема

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`
- Create: `web/index.html`, `web/play.html`, `web/board.html`
- Create: `web/src/lib/identity.ts`, `web/src/lib/theme.css`
- Create: `web/src/host/App.svelte`, `web/src/play/App.svelte`, `web/src/board/App.svelte`
- Create: `web/src/host/main.ts`, `web/src/play/main.ts`, `web/src/board/main.ts`

**Interfaces:**
- Produces:
  - `getClientToken(): string` в `identity.ts` — читает/создаёт UUID в `localStorage` ключ `svoya:clientToken`.
  - Сборка Vite даёт `web/dist/index.html` (host), `play.html`, `board.html`.
  - Vite dev-proxy `/api`, `/media`, `/socket.io` на `http://localhost:3000`.

- [ ] **Step 1: web/package.json**

```json
{
  "name": "svoya-igra-web",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "devDependencies": {
    "vite": "^5.4.0",
    "svelte": "^4.2.0",
    "@sveltejs/vite-plugin-svelte": "^3.1.0",
    "typescript": "^5.5.0",
    "svelte-check": "^3.8.0"
  },
  "dependencies": { "socket.io-client": "^4.7.5" }
}
```

- [ ] **Step 2: web/vite.config.ts**

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: {
        host: resolve(__dirname, 'index.html'),
        play: resolve(__dirname, 'play.html'),
        board: resolve(__dirname, 'board.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/media': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
```

- [ ] **Step 3: web/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "skipLibCheck": true, "isolatedModules": true,
    "types": ["svelte"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Три html + main.ts**

`web/index.html`:
```html
<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Своя игра — Ведущий</title></head>
<body><div id="app"></div><script type="module" src="/src/host/main.ts"></script></body></html>
```
`web/play.html` — то же, `<title>Своя игра — Игрок</title>`, `src="/src/play/main.ts"`.
`web/board.html` — то же, `<title>Своя игра — Табло</title>`, `src="/src/board/main.ts"`.

`web/src/host/main.ts`:
```ts
import './../lib/theme.css';
import App from './App.svelte';
export default new App({ target: document.getElementById('app')! });
```
(аналогично `play/main.ts` и `board/main.ts`, меняя импорт `App`).

- [ ] **Step 5: identity.ts и theme.css**

`web/src/lib/identity.ts`:
```ts
const KEY = 'svoya:clientToken';
export function getClientToken(): string {
  let t = localStorage.getItem(KEY);
  if (!t) { t = crypto.randomUUID(); localStorage.setItem(KEY, t); }
  return t;
}
```
`web/src/lib/theme.css` — неоновая тёмная база:
```css
:root {
  --bg: #0a0a14; --panel: #14142a; --neon: #00e5ff; --neon2: #ff2d95;
  --gold: #ffd54a; --text: #eaf6ff; --muted: #7a7aa0;
  --font: 'Segoe UI', system-ui, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); }
.neon { color: var(--neon); text-shadow: 0 0 8px var(--neon); }
button { font-family: inherit; }
```

- [ ] **Step 6: Минимальные App.svelte (заглушка-плейсхолдер)**

`web/src/play/App.svelte` и `board/App.svelte`:
```svelte
<script lang="ts">let ready = false;</script>
<main style="display:grid;place-items:center;height:100vh;text-align:center">
  <h1 class="neon">Своя игра</h1>
  {#if !ready}<p>Игра ещё не началась</p>{/if}
</main>
```
`web/src/host/App.svelte`:
```svelte
<main style="padding:1rem"><h1 class="neon">Своя игра — Ведущий</h1></main>
```

- [ ] **Step 7: Установить и собрать**

Run: `cd web && npm install && npm run build`
Expected: появляются `web/dist/index.html`, `web/dist/play.html`, `web/dist/board.html`.

- [ ] **Step 8: Commit**

```bash
git add web/package.json web/package-lock.json web/vite.config.ts web/tsconfig.json web/index.html web/play.html web/board.html web/src
git commit -m "feat(web): Svelte+Vite скелет, три входа, неоновая тема, identity"
```

---

### Task 20: Socket-клиент с rejoin и реактивный стор

**Files:**
- Create: `web/src/lib/socket.ts`
- Create: `web/src/lib/store.ts`
- Test: `web/src/lib/socket.test.ts` (через vitest в web/, jsdom не нужен — тест логики reconnect-параметров)

**Interfaces:**
- Produces:
  - `connect(role: 'host'|'player'|'board'): Socket` — создаёт socket.io-client с `reconnection:true`; на `connect`/`pageshow`/`visibilitychange(visible)` шлёт `rejoin` с `getClientToken()`.
  - `gameStore` (svelte writable) — последнее `state` от сервера.
  - `joinAs(...)`, `hostAction(action, data)`, `buzz(reaction)`.

- [ ] **Step 1: Написать падающий тест (логика реакции)**

`web/src/lib/buzz.ts` + `web/src/lib/buzz.test.ts` (выносим чистую функцию вычисления реакции, чтобы тестировать без DOM):

`web/src/lib/buzz.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { reactionMs } from './buzz.js';
describe('reactionMs', () => {
  it('реакция = нажатие − получение GO', () => {
    expect(reactionMs(1000, 1180)).toBe(180);
  });
});
```

- [ ] **Step 2: Запустить — провал**

Run: `cd web && npx vitest run src/lib/buzz.test.ts`
Expected: FAIL (нет vitest в web). Сначала добавить vitest:
Run: `cd web && npm i -D vitest`
Затем снова — FAIL: модуль не найден.

- [ ] **Step 3: Реализовать buzz.ts, socket.ts, store.ts**

`web/src/lib/buzz.ts`:
```ts
export function reactionMs(goReceivedAt: number, pressedAt: number): number {
  return pressedAt - goReceivedAt;
}
```
`web/src/lib/store.ts`:
```ts
import { writable } from 'svelte/store';
export const gameStore = writable<any>(null);
export const blockedUntil = writable<number>(0);
export const goReceivedAt = writable<number>(0);
```
`web/src/lib/socket.ts`:
```ts
import { io, type Socket } from 'socket.io-client';
import { getClientToken } from './identity.js';
import { gameStore, blockedUntil, goReceivedAt } from './store.js';
import { reactionMs } from './buzz.js';

let socket: Socket | null = null;
let current: { gameId: string; role: string } | null = null;

export function connect(): Socket {
  if (socket) return socket;
  socket = io({ reconnection: true, transports: ['websocket'] });
  socket.on('state', s => gameStore.set(s));
  socket.on('goSignal', () => goReceivedAt.set(performance.now()));
  socket.on('blocked', ({ untilMs }: { untilMs: number }) => blockedUntil.set(performance.now() + untilMs));
  const rejoin = () => { if (current) socket!.emit('rejoin', { clientToken: getClientToken() }); };
  socket.on('connect', rejoin);
  window.addEventListener('pageshow', rejoin);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rejoin(); });
  return socket;
}

export function joinAs(gameId: string, role: 'host'|'player'|'board', firstName = '', lastName = '', teamId = '') {
  current = { gameId, role };
  connect().emit('join', { gameId, role, firstName, lastName, teamId, clientToken: getClientToken() });
}
export function hostAction(action: string, data?: unknown) { connect().emit('hostAction', { action, data }); }
export function buzz() {
  let go = 0; goReceivedAt.subscribe(v => go = v)();
  connect().emit('playerBuzz', { reaction: reactionMs(go, performance.now()) });
}
```

- [ ] **Step 4: Запустить — проход**

Run: `cd web && npx vitest run src/lib/buzz.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib web/package.json web/package-lock.json
git commit -m "feat(web): socket-клиент с rejoin, стор, расчёт реакции"
```

---

### Task 21: Общие компоненты — Matrix, Scoreboard, Buzzer

**Files:**
- Create: `web/src/lib/Matrix.svelte`, `web/src/lib/Scoreboard.svelte`, `web/src/lib/Buzzer.svelte`

**Interfaces:**
- Produces:
  - `Matrix.svelte` props: `{ round: {categories}, usedQuestionIds: string[], clickable: boolean }`, событие `select` с `{questionId, value, special}`.
  - `Scoreboard.svelte` props: `{ teams: Team[] }` — сортирует по убыванию очков, неоновые карточки.
  - `Buzzer.svelte` props: `{ blockedUntil: number }` — большая кнопка, дизейбл пока `performance.now() < blockedUntil`, событие `press`.

- [ ] **Step 1: Matrix.svelte**

```svelte
<script lang="ts">
  export let round: any; export let usedQuestionIds: string[] = []; export let clickable = false;
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
</script>
<div style="display:grid;gap:.5rem">
  {#each round?.categories ?? [] as cat}
    <div style="display:grid;grid-template-columns:10rem repeat({cat.questions.length},1fr);gap:.5rem;align-items:center">
      <div class="neon" style="font-weight:700">{cat.name}</div>
      {#each cat.questions as q}
        <button disabled={!clickable || usedQuestionIds.includes(q.id)}
          on:click={() => dispatch('select', { questionId: q.id, value: q.value, special: q.special })}
          style="padding:1rem;background:var(--panel);border:1px solid var(--neon);border-radius:.5rem;color:var(--gold);font-size:1.4rem;font-weight:700;opacity:{usedQuestionIds.includes(q.id)?0.25:1}">
          {usedQuestionIds.includes(q.id) ? '' : q.value}
        </button>
      {/each}
    </div>
  {/each}
</div>
```

- [ ] **Step 2: Scoreboard.svelte**

```svelte
<script lang="ts">
  export let teams: { id: string; name: string; score: number }[] = [];
  $: sorted = [...teams].sort((a, b) => b.score - a.score);
</script>
<div style="display:flex;gap:1rem;flex-wrap:wrap;justify-content:center">
  {#each sorted as t, i}
    <div style="background:var(--panel);border:2px solid {i===0?'var(--gold)':'var(--neon)'};border-radius:.75rem;padding:1rem 1.5rem;text-align:center;min-width:8rem">
      <div style="font-size:1.1rem">{t.name}</div>
      <div class="neon" style="font-size:2rem;font-weight:800;color:{i===0?'var(--gold)':'var(--neon)'}">{t.score}</div>
    </div>
  {/each}
</div>
```

- [ ] **Step 3: Buzzer.svelte**

```svelte
<script lang="ts">
  export let blockedUntil = 0;
  import { createEventDispatcher, onMount } from 'svelte';
  const dispatch = createEventDispatcher();
  let now = 0; onMount(() => { const t = setInterval(() => now = performance.now(), 50); return () => clearInterval(t); });
  $: blocked = now < blockedUntil;
</script>
<button on:click={() => dispatch('press')} disabled={blocked}
  style="width:80vw;height:40vh;border-radius:2rem;border:none;font-size:3rem;font-weight:900;
  background:{blocked?'#333':'radial-gradient(circle,var(--neon2),#a00)'};color:#fff;
  box-shadow:0 0 40px {blocked?'#000':'var(--neon2)'}">
  {blocked ? 'БЛОК' : 'ОТВЕТ'}
</button>
```

- [ ] **Step 4: Сборка проходит**

Run: `cd web && npm run build`
Expected: успешная сборка без ошибок типов.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/Matrix.svelte web/src/lib/Scoreboard.svelte web/src/lib/Buzzer.svelte
git commit -m "feat(web): компоненты Matrix, Scoreboard, Buzzer"
```

---

# Phase 8 — Экраны: игрок, табло, ведущий

### Task 22: Экран игрока (/play)

**Files:**
- Modify: `web/src/play/App.svelte`

**Interfaces:**
- Consumes: `joinAs`, `buzz`, `gameStore`, `blockedUntil`, `Buzzer`, `getClientToken`.
- Поведение: проверка существования игры (`GET /api/games/:id/exists`) → если нет, плейсхолдер. Форма Фамилия+Имя (оба обязательны) + выбор/создание команды → `joinAs('player')`. В фазе `BUZZER_OPEN`/`ANSWERING` показывает `Buzzer`; уведомления «ВЫ ОТВЕЧАЕТЕ»/«ВЫБИРАЙТЕ ВОПРОС». gameId берётся из query `?game=<id>`.

- [ ] **Step 1: Реализовать play/App.svelte**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore, blockedUntil } from '../lib/store.js';
  import { joinAs, buzz } from '../lib/socket.js';
  import Buzzer from '../lib/Buzzer.svelte';

  const gameId = new URLSearchParams(location.search).get('game') ?? '';
  let exists = false, joined = false, firstName = '', lastName = '', teamId = '';
  let state: any = null; $: state = $gameStore;

  onMount(async () => {
    if (!gameId) return;
    const r = await fetch(`/api/games/${gameId}/exists`).then(r => r.json());
    exists = r.exists;
  });
  function doJoin() {
    if (!firstName.trim() || !lastName.trim() || !teamId) return;
    joinAs(gameId, 'player', firstName.trim(), lastName.trim(), teamId);
    joined = true;
  }
  $: myTurn = state && state.answeringTeamId && state.answeringTeamId === teamId;
  $: myPick = state && state.phase === 'PICKING' && state.pickingTeamId === teamId;
</script>

<main style="display:grid;place-items:center;min-height:100vh;text-align:center;padding:1rem">
  {#if !exists}
    <div><h1 class="neon">Своя игра</h1><p>Игра ещё не началась</p></div>
  {:else if !joined}
    <div style="display:grid;gap:.75rem;max-width:20rem">
      <h1 class="neon">Вход в игру</h1>
      <input placeholder="Фамилия" bind:value={lastName} />
      <input placeholder="Имя" bind:value={firstName} />
      <select bind:value={teamId}>
        <option value="">— команда —</option>
        {#each state?.teams ?? [] as t}<option value={t.id}>{t.name}</option>{/each}
      </select>
      <button on:click={doJoin} class="neon">Войти</button>
    </div>
  {:else}
    {#if state?.phase === 'BUZZER_OPEN' || (state?.phase === 'ANSWERING' && !myTurn)}
      <Buzzer blockedUntil={$blockedUntil} on:press={buzz} />
    {:else if myTurn}
      <h1 class="neon">ВЫ ОТВЕЧАЕТЕ!</h1>
    {:else if myPick}
      <h1 class="neon">ВЫБИРАЙТЕ ВОПРОС</h1>
    {:else if state?.currentPrompt}
      <p style="font-size:1.5rem">{state.currentPrompt}</p>
    {:else}
      <p>Ждём ведущего…</p>
    {/if}
  {/if}
</main>
```

- [ ] **Step 2: Сборка проходит**

Run: `cd web && npm run build`
Expected: успех.

- [ ] **Step 3: Commit**

```bash
git add web/src/play/App.svelte
git commit -m "feat(web): экран игрока (вход, buzzer, уведомления)"
```

---

### Task 23: Экран табло (/board)

**Files:**
- Modify: `web/src/board/App.svelte`

**Interfaces:**
- Consumes: `joinAs`, `gameStore`, `Matrix`, `Scoreboard`.
- Поведение: `joinAs('board')` при наличии игры; показывает матрицу текущего раунда, текущий вопрос (без ответа), очередь команд, табло. Фаза `ROUND_END`/`GAME_END` — крупное табло; на `GAME_END` — фанфары (CSS-анимация/эмодзи). Ответ не отображается никогда.

- [ ] **Step 1: Реализовать board/App.svelte**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore } from '../lib/store.js';
  import { joinAs } from '../lib/socket.js';
  import Scoreboard from '../lib/Scoreboard.svelte';
  const gameId = new URLSearchParams(location.search).get('game') ?? '';
  let state: any = null; $: state = $gameStore;
  onMount(async () => {
    if (!gameId) return;
    const r = await fetch(`/api/games/${gameId}/exists`).then(r => r.json());
    if (r.exists) joinAs(gameId, 'board');
  });
</script>

<main style="min-height:100vh;padding:2rem;display:grid;gap:2rem">
  {#if !state}
    <div style="display:grid;place-items:center;height:80vh"><h1 class="neon">Своя игра</h1><p>Игра ещё не началась</p></div>
  {:else if state.phase === 'GAME_END'}
    <h1 class="neon" style="text-align:center;font-size:3rem">🏆 Финал! 🎉</h1>
    <Scoreboard teams={state.teams} />
  {:else if state.phase === 'ROUND_END'}
    <h1 class="neon" style="text-align:center">Итоги раунда</h1>
    <Scoreboard teams={state.teams} />
  {:else}
    {#if state.currentPrompt}
      <div style="display:grid;place-items:center;min-height:50vh;text-align:center">
        <p style="font-size:2.5rem">{state.currentPrompt}</p>
        {#if state.currentType === 'image'}<img src={`/media/${state.packId}/${state.currentMedia}`} style="max-width:60vw;max-height:40vh" alt="" />{/if}
        {#if state.currentType === 'audio'}<audio controls src={`/media/${state.packId}/${state.currentMedia}`}></audio>{/if}
      </div>
    {/if}
    {#if state.buzzQueue?.length}
      <div style="text-align:center" class="neon">Очередь: {state.buzzQueue.map(b => state.teams.find(t=>t.id===b.teamId)?.name).join(' → ')}</div>
    {/if}
    <Scoreboard teams={state.teams} />
  {/if}
</main>
```

> Примечание: `packId` нужно добавить в `PublicState` (в Task 13 он не включён). Дополнить `protocol.ts`: в `PublicState` поле `packId: string` и в `buildPublic` `packId: s.packId`. Это правка одного места; обновить и тест protocol при необходимости.

- [ ] **Step 2: Добавить packId в PublicState**

Modify `src/realtime/protocol.ts`: в интерфейс `PublicState` добавить `packId: string;`, в `buildPublic` добавить `packId: s.packId,`.

- [ ] **Step 3: Сборка и тесты**

Run: `cd web && npm run build && cd .. && npx vitest run src/realtime/protocol.test.ts`
Expected: успех.

- [ ] **Step 4: Commit**

```bash
git add web/src/board/App.svelte src/realtime/protocol.ts
git commit -m "feat(web): экран табло (матрица, вопрос, очередь, табло, финал)"
```

---

### Task 24: Экран ведущего (/host) — создание игры и управление

**Files:**
- Modify: `web/src/host/App.svelte`

**Interfaces:**
- Consumes: `joinAs`, `hostAction`, `gameStore`, `Matrix`, `Scoreboard`.
- Поведение (один экран, фазовый):
  1. Setup: загрузка пака (`POST /api/packs`), ввод названия и числа команд → `POST /api/games` → `joinAs('host')` → создать команды (`hostAction('createTeam'...)` — но в текущем gateway команды создаёт ведущий через отдельное действие; добавить ветку `createTeam`). Показать QR/ссылки на `/play?game=` и `/board?game=`.
  2. Lobby: список игроков по командам (connected/disconnected) → «Начать игру».
  3. Игра: матрица (clickable), кнопки Зарядить/Открыть, очередь, ВЕРНО/НЕВЕРНО для текущей команды, мелкий ответ внизу, ручная правка очков, undo, закрыть вопрос.

- [ ] **Step 1: Добавить действие createTeam в gateway**

Modify `src/realtime/gateway.ts` — в `switch (msg.action)` добавить:
```ts
        case 'createTeam':
          deps.store.append(gid, makeEvent('TEAM_CREATED', { teamId: crypto.randomUUID(), name: d.name }));
          break;
```

- [ ] **Step 2: Реализовать host/App.svelte**

```svelte
<script lang="ts">
  import { gameStore } from '../lib/store.js';
  import { joinAs, hostAction } from '../lib/socket.js';
  import Matrix from '../lib/Matrix.svelte';
  import Scoreboard from '../lib/Scoreboard.svelte';

  let step: 'setup'|'live' = 'setup';
  let packId = '', title = '', teamCount = 2, gameId = '';
  let packRounds: any[] = [];
  let state: any = null; $: state = $gameStore;

  async function uploadPack(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/api/packs', { method: 'POST', body: fd }).then(r => r.json());
    packId = r.packId; if (!title) title = r.title;
  }
  async function createGame() {
    const r = await fetch('/api/games', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ packId, title, teamCount }) }).then(r => r.json());
    gameId = r.gameId;
    // загрузим структуру пака для матрицы
    packRounds = (await fetch(`/api/packs/${packId}`).then(r => r.json())).rounds;
    joinAs(gameId, 'host');
    for (let i = 0; i < teamCount; i++) hostAction('createTeam', { name: `Команда ${i+1}` });
    step = 'live';
  }
  $: currentRound = packRounds[state?.roundIndex] ?? packRounds[0];
  $: answeringTeam = state?.teams?.find((t:any) => t.id === state.answeringTeamId);
</script>

{#if step === 'setup'}
  <main style="padding:2rem;display:grid;gap:1rem;max-width:30rem">
    <h1 class="neon">Создать игру</h1>
    <label>Пак (.zip): <input type="file" accept=".zip" on:change={uploadPack} /></label>
    <input placeholder="Название игры" bind:value={title} />
    <label>Команд: <input type="number" min="2" max="8" bind:value={teamCount} /></label>
    <button class="neon" disabled={!packId || !title} on:click={createGame}>Создать</button>
  </main>
{:else}
  <main style="padding:1rem;display:grid;gap:1rem">
    <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
      <h1 class="neon" style="margin:0">{title}</h1>
      <span>Игрок: <code>/play?game={gameId}</code></span>
      <span>Табло: <code>/board?game={gameId}</code></span>
    </div>

    {#if state?.phase === 'LOBBY'}
      <Scoreboard teams={state.teams} />
      <button class="neon" on:click={() => hostAction('startRound', { roundIndex: 0 })}>Начать игру</button>
    {:else}
      <Matrix round={currentRound} usedQuestionIds={state?.usedQuestionIds ?? []}
        clickable={state?.phase === 'PICKING'}
        on:select={(e) => hostAction('selectQuestion', e.detail)} />

      {#if state?.currentPrompt}
        <div style="background:var(--panel);padding:1rem;border-radius:.5rem;font-size:1.5rem">{state.currentPrompt}</div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <button on:click={() => hostAction('arm')}>Зарядить</button>
          <button on:click={() => hostAction('open')}>Открыть buzzer</button>
          <button on:click={() => hostAction('closeQuestion')}>Закрыть вопрос</button>
        </div>
        {#if answeringTeam}
          <div class="neon">Отвечает: {answeringTeam.name}</div>
          <div style="display:flex;gap:.5rem">
            <button on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: true })}>ВЕРНО ✅</button>
            <button on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: false })}>НЕВЕРНО ❌</button>
          </div>
        {/if}
        <div style="position:fixed;bottom:0;left:0;right:0;background:#000;color:var(--muted);font-size:.8rem;padding:.25rem 1rem">
          Ответ: {state.currentAnswer}
        </div>
      {/if}

      <Scoreboard teams={state.teams} />
      <div style="display:flex;gap:.5rem">
        <button on:click={() => hostAction('endRound')}>Конец раунда</button>
        <button on:click={() => hostAction('endGame')}>Конец игры</button>
      </div>
    {/if}
  </main>
{/if}
```

- [ ] **Step 3: Добавить эндпоинт GET /api/packs/:id (структура для матрицы)**

Modify `src/http/server.ts` — добавить роут:
```ts
  app.get('/api/packs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = deps.db.prepare('SELECT data FROM packs WHERE id = ?').get(id) as { data: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'не найден' });
    return JSON.parse(row.data);
  });
```

- [ ] **Step 4: Сборка и серверные тесты**

Run: `cd web && npm run build && cd .. && npx vitest run src`
Expected: всё PASS, сборка успешна.

- [ ] **Step 5: Commit**

```bash
git add web/src/host/App.svelte src/realtime/gateway.ts src/http/server.ts
git commit -m "feat(web): экран ведущего (создание игры, лобби, управление)"
```

---

# Phase 9 — Интеграционные тесты

### Task 25: Тест реконнекта (rejoin по токену)

**Files:**
- Create: `tests/integration/reconnect.test.ts`

**Interfaces:**
- Consumes: gateway + session — проверяет, что после `disconnect` и нового `rejoin` с тем же `clientToken` сессия восстановлена и игрок снова в комнате.
- Требует обработчик `rejoin` в gateway — **добавить его в этой задаче**.

- [ ] **Step 1: Добавить обработчик rejoin в gateway**

Modify `src/realtime/gateway.ts` — внутри `connection` добавить:
```ts
    socket.on('rejoin', (p: { clientToken: string }) => {
      const s = deps.sessions.byToken(p.clientToken);
      if (!s) return;
      deps.sessions.bind(p.clientToken, socket.id, s.playerId, s.role);
      // восстановить комнаты: найти игру игрока по стейту нельзя без gameId — храним в сессии
      if (s.gameId) {
        joinedGame = s.gameId;
        socket.join(`game:${s.gameId}`);
        socket.join(`game:${s.gameId}:${s.role}`);
        deps.store.append(s.gameId, makeEvent('PLAYER_CONNECTED', { playerId: s.playerId }));
        broadcastState(io, deps, s.gameId);
      }
    });
```
И расширить `Session` (Task 14 `session.ts`) полем `gameId?: string`, заполнять его в `bind` — изменить сигнатуру `bind(clientToken, socketId, playerId, role, gameId?)` и сохранять. В `join`-обработчике передавать `p.gameId`.

> Это уточнение реализации: обнови `session.ts` (добавь `gameId` в `Session` и параметр `bind`), его тест (Task 14) — добавь проверку сохранения `gameId`, и вызовы `bind` в gateway (`join` и `rejoin`).

- [ ] **Step 2: Написать интеграционный тест**

`tests/integration/reconnect.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as Client, type Socket } from 'socket.io-client';
import { openDb } from '../../src/persistence/db.js';
import { EventStore } from '../../src/persistence/eventStore.js';
import { SessionRegistry } from '../../src/realtime/session.js';
import { attachGateway } from '../../src/realtime/gateway.js';
import { makeEvent } from '../../src/domain/events.js';
import { config } from '../../src/config.js';

let open: Socket[] = [];
afterEach(() => { open.forEach(s => s.close()); open = []; });

async function boot() {
  const db = openDb(':memory:');
  const store = new EventStore(db, 25);
  db.prepare('INSERT INTO packs (id,data) VALUES (?,?)').run('p', JSON.stringify({ id:'p',title:'T',rounds:[{id:'r',name:'R',categories:[]}] }));
  store.append('g', makeEvent('GAME_CREATED', { gameId:'g', packId:'p', title:'T', teamCount:2 }));
  store.append('g', makeEvent('TEAM_CREATED', { teamId:'a', name:'A' }));
  const http = createServer(); const io = new Server(http);
  attachGateway(io, { store, db, sessions: new SessionRegistry(), config });
  const port: number = await new Promise(r => http.listen(() => r((http.address() as any).port)));
  return { url: `http://localhost:${port}`, store };
}

describe('реконнект', () => {
  it('после обрыва rejoin по токену восстанавливает игрока', async () => {
    const { url, store } = await boot();
    const c1 = Client(url, { transports: ['websocket'] }); open.push(c1);
    await new Promise<void>(res => { c1.on('connect', () => { c1.emit('join', { gameId:'g', role:'player', firstName:'И', lastName:'П', teamId:'a', clientToken:'TOK' }); }); c1.on('state', () => res()); });
    expect(store.loadState('g').players).toHaveLength(1);
    c1.close();
    await new Promise(r => setTimeout(r, 50));
    expect(store.loadState('g').players[0].connected).toBe(false);

    const c2 = Client(url, { transports: ['websocket'] }); open.push(c2);
    await new Promise<void>(res => { c2.on('connect', () => c2.emit('rejoin', { clientToken: 'TOK' })); c2.on('state', () => res()); });
    expect(store.loadState('g').players[0].connected).toBe(true);
    expect(store.loadState('g').players).toHaveLength(1); // не создал нового игрока
  });
});
```

- [ ] **Step 3: Запустить — провал/проход**

Run: `npx vitest run tests/integration/reconnect.test.ts`
Expected: после правок — PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/reconnect.test.ts src/realtime/gateway.ts src/realtime/session.ts src/realtime/session.test.ts
git commit -m "test: интеграция реконнекта (rejoin по токену)"
```

---

### Task 26: Тест восстановления из event log

**Files:**
- Create: `tests/integration/recovery.test.ts`

**Interfaces:**
- Consumes: `EventStore` поверх **файловой** SQLite во временной папке — проверяет, что новый процесс (новый `EventStore` на том же файле) восстанавливает полное состояние.

- [ ] **Step 1: Написать тест**

`tests/integration/recovery.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../../src/persistence/db.js';
import { EventStore } from '../../src/persistence/eventStore.js';
import { makeEvent } from '../../src/domain/events.js';

const DB = join(process.cwd(), 'data', 'recovery-test.db');
afterEach(() => rmSync(DB, { force: true }));

describe('восстановление', () => {
  it('новый EventStore на том же файле восстанавливает счёт и фазу', () => {
    let n = 0; const id = () => `e${n++}`;
    {
      const store = new EventStore(openDb(DB), 2);
      store.append('g', makeEvent('GAME_CREATED', { gameId:'g', packId:'p', title:'T', teamCount:2 }, id));
      store.append('g', makeEvent('TEAM_CREATED', { teamId:'a', name:'A' }, id));
      store.append('g', makeEvent('TEAM_CREATED', { teamId:'b', name:'B' }, id));
      store.append('g', makeEvent('ROUND_STARTED', { roundIndex:0, pickingTeamId:'a' }, id));
      store.append('g', makeEvent('QUESTION_SELECTED', { questionId:'q1', value:100, special:'none' }, id));
      store.append('g', makeEvent('BUZZER_OPENED', {}, id));
      store.append('g', makeEvent('BUZZ_RECORDED', { teamId:'a', reaction:150 }, id));
      store.append('g', makeEvent('ANSWER_JUDGED', { teamId:'a', correct:true, value:100 }, id));
    }
    const restored = new EventStore(openDb(DB), 2).loadState('g');
    expect(restored.teams.find(t => t.id === 'a')!.score).toBe(100);
    expect(restored.phase).toBe('JUDGED');
    expect(restored.pickingTeamId).toBe('a');
  });
});
```

- [ ] **Step 2: Запустить — проход**

Run: `npx vitest run tests/integration/recovery.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/recovery.test.ts
git commit -m "test: интеграция восстановления из event log"
```

---

# Phase 10 — Docker, пример-пак, документация

### Task 27: Dockerfile и docker-compose

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`

**Interfaces:**
- Produces: multi-stage сборка (web build → server build → runtime), volume `./data:/app/data` для SQLite и медиа. Порт 3000.

- [ ] **Step 1: .dockerignore**

```
node_modules
web/node_modules
dist
web/dist
data
.git
```

- [ ] **Step 2: Dockerfile**

```dockerfile
# --- web build ---
FROM node:20-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- server build ---
FROM node:20-slim AS server
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# --- runtime ---
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=server /app/dist ./dist
COPY --from=web /web/dist ./web/dist
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
```

> Примечание: `better-sqlite3` нативный — `node:20-slim` содержит нужные либы для prebuilt-бинарей; если сборка падает, добавить `RUN apt-get update && apt-get install -y python3 make g++` в runtime-стадию перед `npm ci`.

- [ ] **Step 3: docker-compose.yml**

```yaml
services:
  svoya-igra:
    build: .
    ports: ["3000:3000"]
    volumes: ["./data:/app/data"]
    environment:
      - PORT=3000
    restart: unless-stopped
```

- [ ] **Step 4: Собрать и проверить**

Run: `docker compose build && docker compose up -d && sleep 3 && curl -s localhost:3000/api/games/x/exists`
Expected: `{"exists":false}`. Затем `docker compose down`.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "build: Docker multi-stage + compose с volume для данных"
```

---

### Task 28: Пример-пак и дока по формату

**Files:**
- Create: `packs/example/game.json`, `packs/example/media/.gitkeep`
- Create: `docs/pack-format.md`, `docs/run.md`
- Create: скрипт `scripts/build-example-pack.mjs`

**Interfaces:**
- Produces: рабочий `packs/example.zip`, документацию по ручной сборке пака и по запуску/восстановлению.

- [ ] **Step 1: packs/example/game.json**

```json
{
  "title": "Демо-игра",
  "rounds": [
    {
      "name": "Раунд 1",
      "categories": [
        { "name": "История", "questions": [
          { "type": "text", "prompt": "В каком году началась Вторая мировая?", "answer": "1939", "value": 100, "special": "none" },
          { "type": "text", "prompt": "Первый человек в космосе?", "answer": "Юрий Гагарин", "value": 200, "special": "auction" }
        ]},
        { "name": "Кино", "questions": [
          { "type": "text", "prompt": "Режиссёр «Сталкера»?", "answer": "Андрей Тарковский", "value": 100, "special": "cat" },
          { "type": "text", "prompt": "Год выхода первого «Терминатора»?", "answer": "1984", "value": 200, "special": "none" }
        ]}
      ]
    }
  ]
}
```

- [ ] **Step 2: scripts/build-example-pack.mjs**

```js
import AdmZip from 'adm-zip';
import { readFileSync, writeFileSync } from 'node:fs';
const zip = new AdmZip();
zip.addFile('game.json', readFileSync('packs/example/game.json'));
// медиа в демо нет; при добавлении: zip.addLocalFolder('packs/example/media', 'media')
writeFileSync('packs/example.zip', zip.toBuffer());
console.log('packs/example.zip собран');
```
Создать `packs/example/media/.gitkeep` (пустой).

- [ ] **Step 3: docs/pack-format.md**

````markdown
# Формат пака «Своя игра»

Пак — это `.zip` со следующей структурой:

```
pack.zip
├── game.json
└── media/            # картинки и аудио (если есть)
    ├── foto1.jpg
    └── trek1.mp3
```

## game.json

```json
{
  "title": "Название игры",
  "rounds": [
    {
      "name": "Раунд 1",
      "categories": [
        {
          "name": "Категория",
          "questions": [
            {
              "type": "text",         // text | image | audio
              "prompt": "Текст вопроса",
              "media": "media/x.jpg", // обязателен для image/audio
              "answer": "Правильный ответ",
              "value": 100,            // стоимость (тир), целое ≥ 0
              "special": "none"        // none | auction | cat
            }
          ]
        }
      ]
    }
  ]
}
```

## Правила
- `media` обязателен, если `type` = `image` или `audio`; путь должен существовать в архиве.
- `special: "auction"` — вопрос-аукцион (торг ставками).
- `special: "cat"` — «Кот в мешке» (передача другой команде).
- Стоимость `value` — целое неотрицательное.

## Сборка
1. Подготовь `game.json` и папку `media/`.
2. Запакуй их в `.zip` (game.json в корне архива).
3. Загрузи на экране ведущего → «Создать игру».
````

- [ ] **Step 4: docs/run.md**

````markdown
# Запуск и восстановление

## Запуск
```bash
docker compose up -d
```
- Ведущий: `http://<ip-сервера>:3000/` (или `/index.html`)
- Игроки: `http://<ip-сервера>:3000/play.html?game=<gameId>`
- Табло: `http://<ip-сервера>:3000/board.html?game=<gameId>`

`<ip-сервера>` — локальный IP машины с контейнером (напр. `192.168.1.50`).

## Восстановление после сбоя
Состояние хранится в `./data` (SQLite + медиа), смонтированном как volume.

- **Перезапуск контейнера:** `docker compose restart` — игра продолжится с
  последнего события.
- **Сервер был на ноуте ведущего и ноут умер:** скопируй папку `data` на другую
  машину, запусти там `docker compose up -d`. Игроки переподключаются на новый
  IP, игра продолжается с того же места.
````

- [ ] **Step 5: Собрать пример-пак**

Run: `node scripts/build-example-pack.mjs`
Expected: `packs/example.zip собран`.

- [ ] **Step 6: Commit**

```bash
git add packs/example/game.json packs/example/media/.gitkeep scripts/build-example-pack.mjs docs/pack-format.md docs/run.md packs/example.zip
git commit -m "docs: пример-пак, формат пака, инструкция запуска/восстановления"
```

---

### Task 29: Финальная проверка — весь набор тестов и сборка

**Files:** —

- [ ] **Step 1: Все серверные тесты**

Run: `npx vitest run`
Expected: все PASS (domain, packs, persistence, realtime, http, integration).

- [ ] **Step 2: Сборка фронта и сервера**

Run: `npm run build && cd web && npm run build`
Expected: успех обеих сборок.

- [ ] **Step 3: Docker e2e дым-тест**

Run: `docker compose up -d --build && sleep 4 && curl -s localhost:3000/ -o /dev/null -w "%{http_code}\n" && docker compose down`
Expected: `200`.

- [ ] **Step 4: Commit (если были правки)**

```bash
git add -A
git commit -m "chore: финальная проверка движка зелёная"
```

---

## Self-Review (выполнено при написании плана)

**1. Покрытие спека:**
- Архитектура/модули → Phase 0–6. ✅
- Buzzer (реакция, фальстарт-эскалация, дедуп по команде) → Task 8, 17. ✅
- Игровой цикл, очки, аукцион, кот, выбор по мин. счёту, провал → Task 5–7, 17. ✅
- Pack/GameConfig/GameSnapshot, event sourcing, восстановление → Task 11, 12, 26. ✅
- Слой сессии и реконнект (lock/close/новое устройство, per-team score) → Task 14, 16, 25. ✅
- Формат ZIP + дока + пример-пак → Task 9, 10, 28. ✅
- Три роли/экрана, ответ не на табло → Task 13, 22–24. ✅
- Транспорт Socket.IO + устойчивость через сессию → Task 16, 20. ✅
- Обработка ошибок (валидация, идемпотентность, undo) → Task 9, 12; **undo вынесен ниже**.
- Тестирование (TDD, юнит + интеграция) → все задачи. ✅
- Docker → Task 27. ✅
- Стиль неон → Task 19, 21. ✅

**2. Плейсхолдеры:** код приведён в каждом шаге, «TBD» отсутствуют.

**3. Консистентность типов:** `applyEvent`, `EventStore.append/loadState`,
`toPublicState/toHostState`, `SessionRegistry.bind` согласованы между задачами.
`packId` в `PublicState` добавлен в Task 23. `gameId` в `Session` — в Task 25.

**Замеченный пробел → добавлен:** host-undo последнего вердикта (раздел 9 спека)
не имел задачи. Реализуется тривиально через `SCORE_ADJUSTED` (компенсация) +
повтор фазы; в MVP ведущий пользуется ручной правкой очков (`adjustScore`, Task 17)
и повторным открытием вопроса. Полноценный `VERDICT_UNDONE` — кандидат в бэклог
(не блокирует MVP, отмечено явно, чтобы не выглядело «покрыто»).
