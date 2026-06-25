# Финальный раунд (2c) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в игру финальный раунд по модели ТВ-шоу «Своя игра»: вычёркивание тем → тайные ставки → тайные ответы → вскрытие с ручной верификацией ведущим — сквозь формат пака, движок, realtime, UI (board/player/host) и конструктор.

**Architecture:** Финал — вертикальная фича без под-стадий (не играбелен по частям). Формат пака расширяется `z.union` normal/final-раунда (обратная совместимость: отсутствие `type` = normal). Движок получает 5 новых фаз и блок `GameState.final`; reducer остаётся чистым, эффекты (broadcast, setTimeout) — в gateway. Тайна ставок/ответов до вскрытия реализуется per-socket проекцией в финал-фазах. Таймер финала — самостоятельный механизм, параллельный engine-таймеру.

**Tech Stack:** Node 20 ESM, TypeScript, Fastify + Socket.IO, better-sqlite3 (event sourcing), zod, Svelte + Vite, Vitest, Playwright.

**Спека:** `docs/superpowers/specs/2026-06-23-svoya-igra-final-round-2c-design.md` (включая секцию «Ревизия 2026-06-25»).

## Global Constraints

- **TDD строго:** каждый шаг — failing test → run-fail → minimal impl → run-pass → commit. Реализация — subagent-driven (кодинг haiku/sonnet, финал opus), как все стадии 2*.
- **Reducer чист, без эффектов.** Никаких `Date.now()`, `setTimeout`, broadcast, обращений к паку в reducer. Эффекты — только в `gateway.ts`.
- **Таймер финала стартует state-driven из gateway, НЕ из reducer.** Reducer переводит фазу в `FINAL_QUESTION`; `syncFinalTimer` в gateway видит инвариант `phase==='FINAL_QUESTION' && final.answerDeadline==null && final.answerPausedRemainingMs==null` → эмитит `FINAL_TIMER_STARTED`. Задача «BETTING→QUESTION» НЕ эмитит таймер из reducer. (Это блокер, на котором разворачивали ветку engine-таймера.)
- **`CAPTAIN_ASSIGNED` всегда явное событие.** Никакого «reducer auto-default = первый connected». Gateway вычисляет кандидата и эмитит событие; host UI перезаписывает тем же событием. `captainPlayerId` меняется только по `CAPTAIN_ASSIGNED`.
- **Снэпшот-бэкфилл обязателен.** Загрузчик состояния применяет `{ ...initialState(), ...snap }`, чтобы старые снэпшоты без `final`/`finalAnswerTimerSec` не падали на replay.
- **Reducer не знает пак.** Темы приходят в `FINAL_STARTED.payload.themeIds` (gateway формирует из `pack.rounds.find(r=>r.type==='final')`). `eliminationOrder` reducer вычисляет сам из `state.teams`.
- **Тайна до вскрытия — в том числе от ведущего.** До `FINAL_REVEAL` ставки и тексты ответов чужих команд не попадают ни в player-, ни в host-, ни в board-проекцию; host видит только факт «поставил/готов». На `FINAL_REVEAL` маска снимается у всех. Эталонный `answer` доступен host всегда (он в паке).
- **Финал в игре максимум один**, обычно последний раунд. Валидатор это гарантирует (`final-multiple`).
- **RU-копирайт** во всех пользовательских строках (UI, ошибки). Технические идентификаторы — латиницей.
- **Деньги/цены кратны 100** — НЕ относится к финалу (играем на ставку, не на цену).
- **Тесты web запускаются из `web/`** (`cd web && npm test`); корневой vitest их не включает. Сервер-тесты — из корня (`npm test`). E2E — `npm run test:e2e` (нужен `npx playwright install`).
- **Не ломать `gameJsonSchema` для существующих паков** — старый пак без `type` валиден как normal.

---

## Контракты (финальные сигнатуры — все задачи ссылаются на этот раздел)

Эти типы/имена — единый источник правды. В блоках `Interfaces` задач указано «см. Контракты».

### Доменные типы (`src/domain/types.ts`)

```ts
export type Phase =
  | 'LOBBY' | 'ROUND_INTRO' | 'PICKING' | 'QUESTION'
  | 'BUZZER_ARMED' | 'BUZZER_OPEN' | 'ANSWERING' | 'JUDGED'
  | 'ROUND_END'
  | 'FINAL_INTRO' | 'FINAL_ELIMINATION' | 'FINAL_BETTING' | 'FINAL_QUESTION' | 'FINAL_REVEAL'
  | 'GAME_END';

export interface Team { id: string; name: string; score: number; captainPlayerId: string | null; }

// Раунд — дискриминированный union (по необязательному type)
export interface FinalTheme { id: string; name: string; question: Question; }
export interface NormalRound { id: string; name: string; type?: 'normal'; categories: Category[]; }
export interface FinalRound  { id: string; name: string; type: 'final'; themes: FinalTheme[]; }
export type Round = NormalRound | FinalRound;

export interface FinalRuntime {
  themeIds: string[];                                       // оставшиеся темы (стартово все id финал-раунда)
  eliminationOrder: string[];                               // teamId, возрастание score; тай-брейк = индекс в state.teams
  eliminationTurnIndex: number;                             // чей ход вычёркивать (индекс в eliminationOrder)
  bets: Record<string, number>;                             // teamId -> ставка (после лока)
  answers: Record<string, { text: string; locked: boolean }>;
  revealIndex: number;                                      // прогресс вскрытия (индекс в eliminationOrder)
  answerDeadline: number | null;                            // epoch-ms истечения таймера финала
  answerPausedRemainingMs: number | null;                  // остаток при паузе
}

// GameState получает два новых поля:
//   finalAnswerTimerSec: number;   // номинал, из GAME_CREATED (дефолт 60)
//   final: FinalRuntime | null;
```

`Question` остаётся прежней (`{ id, type, prompt, media?, answer, value, special }`). Для финал-темы `value:0`, `special:'none'` проставляются при парсинге/flatten.

### События (`src/domain/events.ts`) — добавляемые

```ts
| Ev<'CAPTAIN_ASSIGNED', { teamId: string; playerId: string }>
| Ev<'FINAL_STARTED', { themeIds: string[] }>            // gateway формирует themeIds из пака
| Ev<'FINAL_ELIMINATION_BEGAN', {}>                       // host: INTRO -> ELIMINATION
| Ev<'FINAL_THEME_REMOVED', { themeId: string; byTeamId: string }>
| Ev<'FINAL_BET_PLACED', { teamId: string; amount: number }>
| Ev<'FINAL_ANSWER_UPDATED', { teamId: string; text: string }>  // клиент дебаунсит ~1000мс
| Ev<'FINAL_ANSWER_LOCKED', { teamId: string }>
| Ev<'FINAL_TIMER_STARTED', { deadline: number }>
| Ev<'FINAL_TIMER_PAUSED', { remainingMs: number }>
| Ev<'FINAL_TIMER_RESUMED', { deadline: number }>
| Ev<'FINAL_TIMED_OUT', {}>
| Ev<'FINAL_ANSWER_JUDGED', { teamId: string; correct: boolean }>
```

`GAME_CREATED.payload` дополняется `finalAnswerTimerSec: number`. (Событие `FINAL_REVEALED` намеренно НЕ вводится — переход в `FINAL_REVEAL` происходит автоматически в reducer на «все залочены» или `FINAL_TIMED_OUT`.)

### Host-actions (socket `hostAction{action,data}`, гард `role==='host'`)

| action | data | эмитит |
|---|---|---|
| `startFinal` | — | `FINAL_STARTED{themeIds}` + `CAPTAIN_ASSIGNED` на каждую участвующую команду (кандидат — первый connected игрок) |
| `assignCaptain` | `{teamId, playerId}` | `CAPTAIN_ASSIGNED{teamId,playerId}` |
| `finalBeginElimination` | — | `FINAL_ELIMINATION_BEGAN{}` |
| `finalJudge` | `{teamId, correct}` | `FINAL_ANSWER_JUDGED{teamId,correct}` |
| `finalTimerPause` | — | `FINAL_TIMER_PAUSED{remainingMs}` |
| `finalTimerResume` | — | `FINAL_TIMER_RESUMED{deadline}` |
| `finalTimerReset` | — | сбрасывает на номинал (эмитит `FINAL_TIMER_RESUMED` с новым deadline) |
| `endGame` | — | `GAME_ENDED{}` (существует) — на `FINAL_REVEAL` это «Завершить игру → победитель» |

### Player-actions (новое socket-сообщение `finalAction{action,data}`, валидация: капитан своей команды + правильная фаза)

| action | data | фаза | эмитит |
|---|---|---|---|
| `removeTheme` | `{themeId}` | FINAL_ELIMINATION, свой ход | `FINAL_THEME_REMOVED{themeId,byTeamId}` |
| `placeBet` | `{amount}` | FINAL_BETTING, ещё не поставил | `FINAL_BET_PLACED{teamId,amount}` (после валидации 0..score) |
| `updateAnswer` | `{text}` | FINAL_QUESTION, не залочен | `FINAL_ANSWER_UPDATED{teamId,text}` |
| `lockAnswer` | — | FINAL_QUESTION, не залочен | `FINAL_ANSWER_LOCKED{teamId}` |

### Проекции (`src/realtime/protocol.ts`)

`PublicState`/`HostState` дополняются полями (доступны всем; **значения маскируются до reveal**):
```ts
phase: Phase;                       // уже есть; теперь включает FINAL_*
captains: Record<string, string | null>;   // teamId -> captainPlayerId (из teams)
final: {
  themeIds: string[];               // оставшиеся темы
  eliminationOrder: string[];
  eliminationTurnIndex: number;
  betPlaced: string[];              // teamId тех, кто поставил (БЕЗ сумм) — до reveal
  answerLocked: string[];           // teamId тех, кто нажал Готово — до reveal
  bets: Record<string, number>;     // {} до reveal; полное на FINAL_REVEAL
  answers: Record<string, { text: string; locked: boolean }>; // только своя команда (player) / {} (board до reveal) / полное на reveal
  revealIndex: number;
  answerTimerSec: number;           // = finalAnswerTimerSec
  answerDeadline: number | null;
  answerPausedRemainingMs: number | null;
} | null;
finalThemes: Array<{ id: string; name: string }> | null;   // из pack финал-раунда (для отрисовки)
finalQuestion: { type: Question['type']; prompt: string; media: string | null } | null; // вопрос оставшейся темы, виден в FINAL_QUESTION+; null иначе
```

Новая функция:
```ts
export function toPlayerFinalState(s: GameState, pack: Pack | null, viewerTeamId: string | null, now?: number): PublicState
```
— как `toPublicState`, но `final.answers` содержит запись только для `viewerTeamId` (если не reveal), `final.bets` пуст до reveal. На `FINAL_REVEAL` `bets`/`answers` полные.

`toPublicState` (board): до reveal `final.bets={}`, `final.answers={}`; на reveal — полные.
`toHostState`: до reveal `final.bets={}`, `final.answers={}` (тайна и от ведущего), `betPlaced`/`answerLocked` заполнены; на reveal — полные; `currentAnswer`/эталон темы доступны через `finalQuestion`+пак (host резолвит эталон по оставшейся теме отдельным полем — см. Task 14).

### Веб-зеркала
- `web/src/admin/lib/templateTypes.ts` — `TemplateFinalRound`, `TemplateFinalTheme`, union.
- `web/src/admin/lib/templateValidate.ts` — финал Problem kinds (зеркало без media-проверки).
- `web/src/lib/socket.ts` — `finalAction(action, data)`; `gameStore` несёт новые поля.

### Шаблон (`src/packs/templateTypes.ts`)
```ts
export interface TemplateFinalTheme { id: string; name: string; questionId: string | null; }
export interface TemplateFinalRound { id: string; type: 'final'; name: string; themes: TemplateFinalTheme[]; }
export interface TemplateNormalRound { id: string; type?: 'normal'; name: string; columns: TemplateColumn[]; rows: TemplateRow[]; }
export type TemplateRound = TemplateNormalRound | TemplateFinalRound;
```

### Problem kinds финала (`templateValidate.ts`, и серверный, и клиентский)
```ts
| { kind: 'final-too-few-themes'; roundId: string }      // <2 тем
| { kind: 'final-theme-no-question'; roundId: string; themeId: string }
| { kind: 'final-theme-bad-question'; roundId: string; themeId: string }   // questionId не в банке
| { kind: 'final-theme-missing-media'; roundId: string; themeId: string }  // только сервер
| { kind: 'final-multiple' }                              // >1 финал-раунда
```

---

## Структура файлов

**Создаются:**
- `src/domain/engine/finalTimer.ts` — чистая `finalTimerDecision`.
- `src/domain/engine/reducer.final.test.ts` — тесты фаз финала.
- `src/domain/engine/finalTimer.test.ts` — тесты таймера.
- `web/src/admin/sections/builder/FinalRoundEditor.svelte` — редактор финал-раунда.
- `tests/e2e/final-round.spec.ts` — E2E финала.

**Модифицируются (с указанием задачи):** `src/packs/schema.ts`, `src/domain/types.ts`, `src/domain/engine/state.ts`, `src/domain/events.ts`, `src/domain/engine/reducer.ts`, `src/packs/templateTypes.ts`, `src/packs/templateValidate.ts`, `src/packs/templateFlatten.ts`, `src/packs/templatePortable.ts`, `src/realtime/protocol.ts`, `src/realtime/gateway.ts`, `src/http/server.ts`, `docs/pack-format.md`, `docs/run.md`; web: `web/src/admin/lib/templateTypes.ts`, `web/src/admin/lib/templateValidate.ts`, `web/src/admin/store.ts`, `web/src/admin/gameApi.ts`, `web/src/lib/socket.ts`, `web/src/lib/store.ts`, `web/src/admin/sections/Lobby.svelte`, `web/src/admin/sections/Pult.svelte`, `web/src/play/App.svelte`, `web/src/board/App.svelte`, `web/src/admin/sections/builder/GameEditor.svelte`, `web/src/admin/sections/Builder.svelte`.

---

## Task 1: Схема пака — final-раунд + нормализация парсинга

**Files:**
- Modify: `src/packs/schema.ts`
- Modify: `docs/pack-format.md`
- Test: `src/packs/schema.final.test.ts` (создать)

**Interfaces:**
- Produces: `gameJsonSchema` принимает раунд с `type:'final'` и `themes[]`; `parseGameJson` нормализует финал-вопрос (`value:0, special:'none'`, UID темам/вопросам). См. Контракты → доменные типы (`FinalRound`, `FinalTheme`).

- [ ] **Step 1: Failing-тест** — `src/packs/schema.final.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { gameJsonSchema, parseGameJson } from './schema.js';

describe('final round schema', () => {
  const finalRound = {
    type: 'final', name: 'Финал',
    themes: [
      { name: 'Тема A', question: { type: 'text', prompt: 'В1', answer: 'О1' } },
      { name: 'Тема B', question: { type: 'text', prompt: 'В2', answer: 'О2' } },
    ],
  };

  it('принимает валидный final-раунд', () => {
    const r = gameJsonSchema.safeParse({ title: 'T', rounds: [finalRound] });
    expect(r.success).toBe(true);
  });

  it('отвергает финал с <2 темами', () => {
    const r = gameJsonSchema.safeParse({ title: 'T', rounds: [{ ...finalRound, themes: [finalRound.themes[0]] }] });
    expect(r.success).toBe(false);
  });

  it('отвергает тему без вопроса', () => {
    const bad = { type: 'final', name: 'Ф', themes: [{ name: 'X' }, { name: 'Y' }] };
    expect(gameJsonSchema.safeParse({ title: 'T', rounds: [bad] }).success).toBe(false);
  });

  it('обратная совместимость: normal-раунд без type', () => {
    const normal = { name: 'Р1', categories: [{ name: 'К', questions: [{ type: 'text', prompt: 'p', answer: 'a', value: 100, special: 'none' }] }] };
    expect(gameJsonSchema.safeParse({ title: 'T', rounds: [normal] }).success).toBe(true);
  });

  it('parseGameJson нормализует финал-вопрос: value=0, special=none, UID', () => {
    const pack = parseGameJson({ title: 'T', rounds: [finalRound] }) as any;
    const round = pack.rounds[0];
    expect(round.type).toBe('final');
    expect(round.themes[0].id).toBeTruthy();
    expect(round.themes[0].question.id).toBeTruthy();
    expect(round.themes[0].question.value).toBe(0);
    expect(round.themes[0].question.special).toBe('none');
  });
});
```

- [ ] **Step 2: Run-fail** — `npm test -- src/packs/schema.final.test.ts` → FAIL (схема не знает `themes`).

- [ ] **Step 3: Реализация** — в `src/packs/schema.ts`:
```ts
const finalQuestionSchema = z.object({
  type: z.enum(['text', 'image', 'audio']),
  prompt: z.string().min(1),
  media: z.string().optional(),
  answer: z.string().min(1),
}).refine(q => q.type === 'text' || !!q.media, { message: 'media обязателен для image/audio', path: ['media'] });

const finalThemeSchema = z.object({ name: z.string().min(1), question: finalQuestionSchema });
const finalRoundSchema = z.object({ type: z.literal('final'), name: z.string().min(1), themes: z.array(finalThemeSchema).min(2) });
const normalRoundSchema = z.object({ type: z.literal('normal').optional(), name: z.string().min(1), categories: z.array(categorySchema).min(1) });
const roundSchema = z.union([finalRoundSchema, normalRoundSchema]);
export const gameJsonSchema = z.object({ title: z.string().min(1), rounds: z.array(roundSchema).min(1) });
```
В `parseGameJson` — при разборе раунда: если `r.type === 'final'`, отдавать `{ id: idGen(), type: 'final', name: r.name, themes: r.themes.map(t => ({ id: idGen(), name: t.name, question: { id: idGen(), type: t.question.type, prompt: t.question.prompt, media: t.question.media, answer: t.question.answer, value: 0, special: 'none' } })) }`; иначе текущая normal-ветка (с `type:'normal'` опускаемым или явным).

- [ ] **Step 4: Run-pass** — `npm test -- src/packs/schema.final.test.ts` → PASS.

- [ ] **Step 5: docs/pack-format.md** — добавить раздел «Финальный раунд» с примером JSON (`type:'final'`, `themes[]`, вопрос без `value/special`), пометить опциональность и единственность.

- [ ] **Step 6: Commit**
```bash
git add src/packs/schema.ts src/packs/schema.final.test.ts docs/pack-format.md
git commit -m "feat(2c): схема пака — final-раунд (z.union) + нормализация parseGameJson"
```

---

## Task 2: Доменные типы + initialState + снэпшот-бэкфилл

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/engine/state.ts`
- Test: `src/domain/engine/state.final.test.ts` (создать)

**Interfaces:**
- Produces: `Phase` с финал-фазами; `Team.captainPlayerId`; `Round` union; `GameState.finalAnswerTimerSec`, `GameState.final: FinalRuntime|null`; `initialState()` инициализирует их; загрузчик снэпшота бэкфиллит. См. Контракты.
- Consumes: `Round`/`FinalTheme` из Task 1 (тип домена).

- [ ] **Step 1: Failing-тест** — `src/domain/engine/state.final.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';

describe('initialState финал-поля', () => {
  it('finalAnswerTimerSec по умолчанию 60, final = null', () => {
    const s = initialState();
    expect(s.finalAnswerTimerSec).toBe(60);
    expect(s.final).toBeNull();
  });
  it('у команд есть captainPlayerId (через тип) — список пуст по умолчанию', () => {
    expect(initialState().teams).toEqual([]);
  });
});
```
Если в `state.ts` есть фабрика загрузки снэпшота — добавить тест, что `{...initialState(), ...snapWithoutFinal}` даёт `final===null` и `finalAnswerTimerSec===60` (бэкфилл). Если бэкфилл живёт в `src/persistence/*Repo` или `store.loadState` — тест разместить там и проверить replay старого снэпшота.

- [ ] **Step 2: Run-fail** — `npm test -- src/domain/engine/state.final.test.ts` → FAIL.

- [ ] **Step 3: Реализация:**
  - В `types.ts`: расширить `Phase`; добавить `captainPlayerId` в `Team`; добавить `FinalTheme`/`NormalRound`/`FinalRound`/`Round` union; добавить в `GameState` поля `finalAnswerTimerSec: number;` и `final: FinalRuntime | null;`; добавить `FinalRuntime` интерфейс (см. Контракты).
  - В `state.ts` `initialState()`: `finalAnswerTimerSec: 60, final: null`. Любой существующий код, создающий `Team`, дополнить `captainPlayerId: null`.
  - Найти загрузчик снэпшота (там, где сейчас `{...initialState(), ...snap}` для engine-таймера — по memory это паттерн бэкфилла) и убедиться, что он покрывает новые поля. Если spread уже `{...initialState(), ...snap}` — менять не нужно, только тест.

- [ ] **Step 4: Run-pass** — `npm test -- src/domain/engine/state.final.test.ts` → PASS. Затем `npm test` целиком — могут упасть тесты, создающие `Team` без `captainPlayerId` (тип). Починить их (добавить поле). Цель: вся сборка `npx tsc --noEmit` зелёная.

- [ ] **Step 5: Commit**
```bash
git add src/domain/types.ts src/domain/engine/state.ts src/domain/engine/state.final.test.ts
git commit -m "feat(2c): доменные типы финала + captainPlayerId + бэкфилл снэпшота"
```

---

## Task 3: События финала + GAME_CREATED.finalAnswerTimerSec

**Files:**
- Modify: `src/domain/events.ts`
- Test: `src/domain/events.final.test.ts` (создать)

**Interfaces:**
- Produces: типы событий финала + `CAPTAIN_ASSIGNED`; `GAME_CREATED.payload.finalAnswerTimerSec`. См. Контракты → события.

- [ ] **Step 1: Failing-тест** — `src/domain/events.final.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { makeEvent } from './events.js';

describe('события финала', () => {
  it('makeEvent создаёт FINAL_STARTED с themeIds и id', () => {
    const e = makeEvent('FINAL_STARTED', { themeIds: ['t1', 't2'] });
    expect(e.type).toBe('FINAL_STARTED');
    expect(e.payload.themeIds).toEqual(['t1', 't2']);
    expect(e.id).toBeTruthy();
  });
  it('GAME_CREATED несёт finalAnswerTimerSec', () => {
    const e = makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 3, answerTimerSec: 45, finalAnswerTimerSec: 60 });
    expect(e.payload.finalAnswerTimerSec).toBe(60);
  });
});
```

- [ ] **Step 2: Run-fail** → FAIL (тип не существует).

- [ ] **Step 3: Реализация** — добавить в union `GameEvent` все события из раздела Контракты; дополнить `GAME_CREATED` payload полем `finalAnswerTimerSec: number`.

- [ ] **Step 4: Run-pass** → PASS. `npx tsc --noEmit` — починить места, конструирующие `GAME_CREATED` без нового поля (передавать `finalAnswerTimerSec`).

- [ ] **Step 5: Commit**
```bash
git add src/domain/events.ts src/domain/events.final.test.ts
git commit -m "feat(2c): события финала + GAME_CREATED.finalAnswerTimerSec"
```

---

## Task 4: Reducer — старт финала, капитан, finalAnswerTimerSec

**Files:**
- Modify: `src/domain/engine/reducer.ts`
- Test: `src/domain/engine/reducer.final.test.ts` (создать)

**Interfaces:**
- Consumes: типы/события из Task 2–3.
- Produces: reducer-кейсы `GAME_CREATED` (set `finalAnswerTimerSec`), `CAPTAIN_ASSIGNED`, `FINAL_STARTED`. Хелпер `finalParticipants(s): string[]` (teamId со `score>0`, порядок = индекс в `state.teams`), `eliminationOrderFrom(s): string[]` (участники по возрастанию score, тай-брейк = индекс).

- [ ] **Step 1: Failing-тест** — `reducer.final.test.ts` (хелпер сборки state с командами и счётами; используйте существующий паттерн из `reducer.flow.test.ts`):
```ts
// GAME_CREATED проставляет finalAnswerTimerSec
it('GAME_CREATED сохраняет finalAnswerTimerSec', () => {
  const s = apply(initialState(), makeEvent('GAME_CREATED', { gameId:'g', packId:'p', title:'T', teamCount:3, answerTimerSec:45, finalAnswerTimerSec: 90 }));
  expect(s.finalAnswerTimerSec).toBe(90);
});

// CAPTAIN_ASSIGNED меняет только captainPlayerId
it('CAPTAIN_ASSIGNED проставляет капитана', () => {
  let s = withTeams([{ id:'A', score:100 }, { id:'B', score:50 }]);
  s = apply(s, makeEvent('CAPTAIN_ASSIGNED', { teamId:'A', playerId:'p1' }));
  expect(s.teams.find(t=>t.id==='A')!.captainPlayerId).toBe('p1');
});

// FINAL_STARTED: фаза, eliminationOrder (беднейший первый), исключение score<=0
it('FINAL_STARTED строит eliminationOrder по возрастанию счёта, исключая <=0', () => {
  let s = withTeams([{ id:'A', score:300 }, { id:'B', score:100 }, { id:'C', score:0 }, { id:'D', score:-50 }]);
  s = apply(s, makeEvent('FINAL_STARTED', { themeIds: ['t1','t2','t3'] }));
  expect(s.phase).toBe('FINAL_INTRO');
  expect(s.final).not.toBeNull();
  expect(s.final!.eliminationOrder).toEqual(['B','A']); // C,D исключены
  expect(s.final!.themeIds).toEqual(['t1','t2','t3']);
  expect(s.final!.eliminationTurnIndex).toBe(0);
});

// тай-брейк по индексу в teams
it('равные счета — тай-брейк по порядку команд', () => {
  let s = withTeams([{ id:'A', score:100 }, { id:'B', score:100 }]);
  s = apply(s, makeEvent('FINAL_STARTED', { themeIds: ['t1','t2'] }));
  expect(s.final!.eliminationOrder).toEqual(['A','B']);
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация** — в `reducer.ts`:
```ts
function finalParticipants(s: GameState): string[] {
  return s.teams.filter(t => t.score > 0).map(t => t.id);
}
function eliminationOrderFrom(s: GameState): string[] {
  const idx = new Map(s.teams.map((t, i) => [t.id, i]));
  return finalParticipants(s)
    .sort((a, b) => {
      const sa = s.teams.find(t => t.id === a)!.score, sb = s.teams.find(t => t.id === b)!.score;
      return sa !== sb ? sa - sb : idx.get(a)! - idx.get(b)!;
    });
}
// case 'GAME_CREATED': ... s.finalAnswerTimerSec = event.payload.finalAnswerTimerSec ?? 60;
// case 'CAPTAIN_ASSIGNED': { const t = s.teams.find(t=>t.id===event.payload.teamId); if (t) t.captainPlayerId = event.payload.playerId; return s; }
// case 'FINAL_STARTED':
//   s.phase = 'FINAL_INTRO';
//   s.final = { themeIds: [...event.payload.themeIds], eliminationOrder: eliminationOrderFrom(s),
//     eliminationTurnIndex: 0, bets: {}, answers: {}, revealIndex: 0, answerDeadline: null, answerPausedRemainingMs: null };
//   return s;
```

- [ ] **Step 4: Run-pass** → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/domain/engine/reducer.ts src/domain/engine/reducer.final.test.ts
git commit -m "feat(2c): reducer — FINAL_STARTED/CAPTAIN_ASSIGNED + eliminationOrder"
```

---

## Task 5: Reducer — вычёркивание тем

**Files:**
- Modify: `src/domain/engine/reducer.ts`
- Test: `src/domain/engine/reducer.final.test.ts` (дополнить)

**Interfaces:**
- Consumes: `FINAL_STARTED` state из Task 4.
- Produces: кейсы `FINAL_ELIMINATION_BEGAN` (→ `FINAL_ELIMINATION`), `FINAL_THEME_REMOVED` (убрать тему, продвинуть turn по кругу; remaining==1 → `FINAL_BETTING`).

- [ ] **Step 1: Failing-тест** (дополнить):
```ts
function startedFinal() {
  let s = withTeams([{ id:'A', score:300 }, { id:'B', score:100 }, { id:'C', score:200 }]);
  s = apply(s, makeEvent('FINAL_STARTED', { themeIds: ['t1','t2','t3'] }));
  return apply(s, makeEvent('FINAL_ELIMINATION_BEGAN', {}));
}
it('FINAL_ELIMINATION_BEGAN → фаза FINAL_ELIMINATION', () => {
  expect(startedFinal().phase).toBe('FINAL_ELIMINATION');
});
it('FINAL_THEME_REMOVED убирает тему и продвигает ход по кругу', () => {
  let s = startedFinal();                       // order: B(100),C(200),A(300); turn=0 → B
  s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId:'t1', byTeamId:'B' }));
  expect(s.final!.themeIds).toEqual(['t2','t3']);
  expect(s.final!.eliminationTurnIndex).toBe(1); // теперь C
});
it('после удаления до одной темы → FINAL_BETTING', () => {
  let s = startedFinal();
  s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId:'t1', byTeamId:'B' }));
  s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId:'t2', byTeamId:'C' }));
  expect(s.final!.themeIds).toEqual(['t3']);
  expect(s.phase).toBe('FINAL_BETTING');
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация:**
```ts
// case 'FINAL_ELIMINATION_BEGAN': if (s.final) s.phase = 'FINAL_ELIMINATION'; return s;
// case 'FINAL_THEME_REMOVED': {
//   if (!s.final) return s;
//   s.final.themeIds = s.final.themeIds.filter(id => id !== event.payload.themeId);
//   if (s.final.themeIds.length <= 1) { s.phase = 'FINAL_BETTING'; }
//   else { s.final.eliminationTurnIndex = (s.final.eliminationTurnIndex + 1) % s.final.eliminationOrder.length; }
//   return s;
// }
```

- [ ] **Step 4: Run-pass** → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/domain/engine/reducer.ts src/domain/engine/reducer.final.test.ts
git commit -m "feat(2c): reducer — вычёркивание тем + переход к ставкам"
```

---

## Task 6: Reducer — тайные ставки

**Files:**
- Modify: `src/domain/engine/reducer.ts`
- Test: `src/domain/engine/reducer.final.test.ts` (дополнить)

**Interfaces:**
- Produces: кейс `FINAL_BET_PLACED` (кладёт `bets[teamId]=amount`; когда все из `eliminationOrder` поставили → `FINAL_QUESTION`). Валидация диапазона ставки — в gateway (reducer доверяет событию), но reducer клампит на всякий случай `0..score`.

- [ ] **Step 1: Failing-тест:**
```ts
function betting() {
  let s = startedFinal();
  s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId:'t1', byTeamId:'B' }));
  s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId:'t2', byTeamId:'C' }));
  return s; // FINAL_BETTING, участники B,C,A
}
it('FINAL_BET_PLACED копит ставки, не меняя фазу пока не все', () => {
  let s = betting();
  s = apply(s, makeEvent('FINAL_BET_PLACED', { teamId:'B', amount:50 }));
  expect(s.final!.bets.B).toBe(50);
  expect(s.phase).toBe('FINAL_BETTING');
});
it('когда все участники поставили → FINAL_QUESTION', () => {
  let s = betting();
  for (const [tid, amt] of [['B',50],['C',200],['A',300]] as const) s = apply(s, makeEvent('FINAL_BET_PLACED', { teamId:tid, amount:amt }));
  expect(s.phase).toBe('FINAL_QUESTION');
  expect(s.final!.answerDeadline).toBeNull(); // таймер стартует в gateway, не тут
});
it('ставка клампится 0..score', () => {
  let s = betting();
  s = apply(s, makeEvent('FINAL_BET_PLACED', { teamId:'B', amount:9999 }));
  expect(s.final!.bets.B).toBe(100); // score B = 100
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация:**
```ts
// case 'FINAL_BET_PLACED': {
//   if (!s.final || s.phase !== 'FINAL_BETTING') return s;
//   const team = s.teams.find(t => t.id === event.payload.teamId);
//   if (!team || !s.final.eliminationOrder.includes(team.id)) return s;
//   s.final.bets[team.id] = Math.max(0, Math.min(team.score, Math.floor(event.payload.amount)));
//   if (s.final.eliminationOrder.every(tid => tid in s.final!.bets)) s.phase = 'FINAL_QUESTION';
//   return s;
// }
```

- [ ] **Step 4: Run-pass** → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/domain/engine/reducer.ts src/domain/engine/reducer.final.test.ts
git commit -m "feat(2c): reducer — тайные ставки + переход к вопросу"
```

---

## Task 7: Reducer — ответы и переход к вскрытию

**Files:**
- Modify: `src/domain/engine/reducer.ts`
- Test: `src/domain/engine/reducer.final.test.ts` (дополнить)

**Interfaces:**
- Produces: кейсы `FINAL_ANSWER_UPDATED` (кладёт `answers[teamId]={text,locked:false}` если не залочен), `FINAL_ANSWER_LOCKED` (`locked:true`); когда все участники залочены → `FINAL_REVEAL`.

- [ ] **Step 1: Failing-тест:**
```ts
function question() {
  let s = betting();
  for (const [tid, amt] of [['B',50],['C',200],['A',300]] as const) s = apply(s, makeEvent('FINAL_BET_PLACED', { teamId:tid, amount:amt }));
  return s; // FINAL_QUESTION
}
it('FINAL_ANSWER_UPDATED копит текст незалоченного', () => {
  let s = question();
  s = apply(s, makeEvent('FINAL_ANSWER_UPDATED', { teamId:'B', text:'Пушкин' }));
  expect(s.final!.answers.B).toEqual({ text:'Пушкин', locked:false });
});
it('обновление залоченного игнорируется', () => {
  let s = question();
  s = apply(s, makeEvent('FINAL_ANSWER_UPDATED', { teamId:'B', text:'Пушкин' }));
  s = apply(s, makeEvent('FINAL_ANSWER_LOCKED', { teamId:'B' }));
  s = apply(s, makeEvent('FINAL_ANSWER_UPDATED', { teamId:'B', text:'Лермонтов' }));
  expect(s.final!.answers.B).toEqual({ text:'Пушкин', locked:true });
});
it('когда все залочены → FINAL_REVEAL', () => {
  let s = question();
  for (const tid of ['B','C','A']) { s = apply(s, makeEvent('FINAL_ANSWER_UPDATED', { teamId:tid, text:'x' })); s = apply(s, makeEvent('FINAL_ANSWER_LOCKED', { teamId:tid })); }
  expect(s.phase).toBe('FINAL_REVEAL');
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация:**
```ts
// case 'FINAL_ANSWER_UPDATED': {
//   if (!s.final || s.phase !== 'FINAL_QUESTION') return s;
//   const cur = s.final.answers[event.payload.teamId];
//   if (cur?.locked) return s;
//   s.final.answers[event.payload.teamId] = { text: event.payload.text, locked: false };
//   return s;
// }
// case 'FINAL_ANSWER_LOCKED': {
//   if (!s.final || s.phase !== 'FINAL_QUESTION') return s;
//   const tid = event.payload.teamId;
//   const cur = s.final.answers[tid] ?? { text: '', locked: false };
//   s.final.answers[tid] = { text: cur.text, locked: true };
//   if (s.final.eliminationOrder.every(t => s.final!.answers[t]?.locked)) s.phase = 'FINAL_REVEAL';
//   return s;
// }
```

- [ ] **Step 4: Run-pass** → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/domain/engine/reducer.ts src/domain/engine/reducer.final.test.ts
git commit -m "feat(2c): reducer — ответы финала + переход к вскрытию"
```

---

## Task 8: Таймер финала — finalTimerDecision + reducer-кейсы

**Files:**
- Create: `src/domain/engine/finalTimer.ts`
- Create: `src/domain/engine/finalTimer.test.ts`
- Modify: `src/domain/engine/reducer.ts`
- Test: `src/domain/engine/reducer.final.test.ts` (дополнить для TIMED_OUT)

**Interfaces:**
- Produces: `finalTimerDecision(s: GameState, now: number): TimerDecision` (тот же тип `TimerDecision` из `answerTimer.ts` — переиспользовать импортом); reducer-кейсы `FINAL_TIMER_STARTED/PAUSED/RESUMED`, `FINAL_TIMED_OUT` (форс-лок всех участников → `FINAL_REVEAL`).
- Consumes: `TimerDecision` из `src/domain/engine/answerTimer.ts`.

- [ ] **Step 1: Failing-тесты** — `finalTimer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { finalTimerDecision } from './finalTimer.js';
// builder q() из reducer.final хелперов или собрать вручную FINAL_QUESTION state
it('вне FINAL_QUESTION → clear', () => {
  const s: any = { phase: 'FINAL_BETTING', final: { answerDeadline: null, answerPausedRemainingMs: null } };
  expect(finalTimerDecision(s, 1000)).toEqual({ kind: 'clear' });
});
it('FINAL_QUESTION без дедлайна → start', () => {
  const s: any = { phase: 'FINAL_QUESTION', final: { answerDeadline: null, answerPausedRemainingMs: null } };
  expect(finalTimerDecision(s, 1000)).toEqual({ kind: 'start' });
});
it('дедлайн истёк → timeout', () => {
  const s: any = { phase: 'FINAL_QUESTION', final: { answerDeadline: 500, answerPausedRemainingMs: null } };
  expect(finalTimerDecision(s, 1000)).toEqual({ kind: 'timeout' });
});
it('пауза → clear', () => {
  const s: any = { phase: 'FINAL_QUESTION', final: { answerDeadline: 5000, answerPausedRemainingMs: 3000 } };
  expect(finalTimerDecision(s, 1000)).toEqual({ kind: 'clear' });
});
```
Reducer-тест (в `reducer.final.test.ts`) — форс-лок на таймауте, включая команду без записи:
```ts
it('FINAL_TIMED_OUT лочит всех участников (включая без текста) и идёт в FINAL_REVEAL', () => {
  let s = question();
  s = apply(s, makeEvent('FINAL_ANSWER_UPDATED', { teamId:'B', text:'Пушкин' })); // только B печатал
  s = apply(s, makeEvent('FINAL_TIMED_OUT', {}));
  expect(s.phase).toBe('FINAL_REVEAL');
  expect(s.final!.answers.B).toEqual({ text:'Пушкин', locked:true });
  expect(s.final!.answers.C).toEqual({ text:'', locked:true });
  expect(s.final!.answers.A).toEqual({ text:'', locked:true });
});
it('FINAL_TIMER_PAUSED/RESUMED двигают поля', () => {
  let s = question();
  s = apply(s, makeEvent('FINAL_TIMER_STARTED', { deadline: 10000 }));
  expect(s.final!.answerDeadline).toBe(10000);
  s = apply(s, makeEvent('FINAL_TIMER_PAUSED', { remainingMs: 4000 }));
  expect(s.final!.answerPausedRemainingMs).toBe(4000);
  expect(s.final!.answerDeadline).toBeNull();
  s = apply(s, makeEvent('FINAL_TIMER_RESUMED', { deadline: 20000 }));
  expect(s.final!.answerPausedRemainingMs).toBeNull();
  expect(s.final!.answerDeadline).toBe(20000);
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация** — `finalTimer.ts`:
```ts
import type { GameState } from '../types.js';
import type { TimerDecision } from './answerTimer.js';

export function finalTimerDecision(s: GameState, now: number): TimerDecision {
  if (s.phase !== 'FINAL_QUESTION' || !s.final) return { kind: 'clear' };
  if (s.final.answerPausedRemainingMs != null) return { kind: 'clear' };
  if (s.final.answerDeadline == null) return { kind: 'start' };
  if (s.final.answerDeadline <= now) return { kind: 'timeout' };
  return { kind: 'arm', delayMs: s.final.answerDeadline - now };
}
```
> Примечание: `TimerDecision.timeout` в `answerTimer.ts` несёт `teamId`. Для финала teamId не нужен. Если тип жёсткий — расширить `TimerDecision` на `{ kind:'timeout'; teamId?: string }` или завести локальный тип `FinalTimerDecision`. Выбор: локальный тип в `finalTimer.ts`, чтобы не трогать engine-таймер.

reducer-кейсы:
```ts
// case 'FINAL_TIMER_STARTED': if (s.final) s.final.answerDeadline = event.payload.deadline; return s;
// case 'FINAL_TIMER_PAUSED': if (s.final) { s.final.answerPausedRemainingMs = event.payload.remainingMs; s.final.answerDeadline = null; } return s;
// case 'FINAL_TIMER_RESUMED': if (s.final) { s.final.answerDeadline = event.payload.deadline; s.final.answerPausedRemainingMs = null; } return s;
// case 'FINAL_TIMED_OUT': {
//   if (!s.final || s.phase !== 'FINAL_QUESTION') return s;
//   for (const tid of s.final.eliminationOrder) {
//     const cur = s.final.answers[tid];
//     s.final.answers[tid] = { text: cur?.text ?? '', locked: true };
//   }
//   s.final.answerDeadline = null; s.final.answerPausedRemainingMs = null;
//   s.phase = 'FINAL_REVEAL';
//   return s;
// }
```

- [ ] **Step 4: Run-pass** → `npm test -- src/domain/engine/finalTimer.test.ts src/domain/engine/reducer.final.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/domain/engine/finalTimer.ts src/domain/engine/finalTimer.test.ts src/domain/engine/reducer.ts src/domain/engine/reducer.final.test.ts
git commit -m "feat(2c): таймер финала — finalTimerDecision + reducer timer-кейсы + форс-лок"
```

---

## Task 9: Reducer — вскрытие и начисление

**Files:**
- Modify: `src/domain/engine/reducer.ts`
- Test: `src/domain/engine/reducer.final.test.ts` (дополнить)

**Interfaces:**
- Produces: кейс `FINAL_ANSWER_JUDGED` (верно → `score += bet`, неверно → `score -= bet`; `revealIndex++`). `GAME_ENDED` (существует) переводит в `GAME_END` из любой фазы.

- [ ] **Step 1: Failing-тест:**
```ts
function reveal() {
  let s = question();
  for (const tid of ['B','C','A']) { s = apply(s, makeEvent('FINAL_ANSWER_UPDATED', { teamId:tid, text:'x' })); s = apply(s, makeEvent('FINAL_ANSWER_LOCKED', { teamId:tid })); }
  return s; // FINAL_REVEAL; bets B=50,C=200,A=300
}
it('верный ответ прибавляет ставку, revealIndex++', () => {
  let s = reveal();
  const before = s.teams.find(t=>t.id==='B')!.score; // 100
  s = apply(s, makeEvent('FINAL_ANSWER_JUDGED', { teamId:'B', correct:true }));
  expect(s.teams.find(t=>t.id==='B')!.score).toBe(before + 50);
  expect(s.final!.revealIndex).toBe(1);
});
it('неверный ответ вычитает ставку', () => {
  let s = reveal();
  const before = s.teams.find(t=>t.id==='C')!.score; // 200
  s = apply(s, makeEvent('FINAL_ANSWER_JUDGED', { teamId:'C', correct:false }));
  expect(s.teams.find(t=>t.id==='C')!.score).toBe(before - 200);
});
it('GAME_ENDED из FINAL_REVEAL → GAME_END', () => {
  let s = reveal();
  s = apply(s, makeEvent('GAME_ENDED', {}));
  expect(s.phase).toBe('GAME_END');
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация:**
```ts
// case 'FINAL_ANSWER_JUDGED': {
//   if (!s.final || s.phase !== 'FINAL_REVEAL') return s;
//   const team = s.teams.find(t => t.id === event.payload.teamId);
//   const bet = s.final.bets[event.payload.teamId] ?? 0;
//   if (team) team.score += event.payload.correct ? bet : -bet;
//   s.final.revealIndex += 1;
//   return s;
// }
```
(`GAME_ENDED` уже переводит в `GAME_END` — проверить, что не сбрасывает `final`; оставить `final` как есть для отображения победителя/истории.)

- [ ] **Step 4: Run-pass** → PASS. Затем `npm test` целиком зелёный, `npx tsc --noEmit` чисто.

- [ ] **Step 5: Commit**
```bash
git add src/domain/engine/reducer.ts src/domain/engine/reducer.final.test.ts
git commit -m "feat(2c): reducer — вскрытие финала + начисление по ставке"
```

---

## Task 10: Шаблон — типы финал-раунда (сервер + клиент)

**Files:**
- Modify: `src/packs/templateTypes.ts`
- Modify: `web/src/admin/lib/templateTypes.ts`
- Test: `src/packs/templateTypes.final.test.ts` (создать) — smoke на конструкторы/гварды.

**Interfaces:**
- Produces: `TemplateFinalTheme`, `TemplateFinalRound`, `TemplateRound` union; хелпер `isFinalRound(r): r is TemplateFinalRound`; конструктор `makeFinalRound(idGen): TemplateFinalRound` (2 пустые темы). См. Контракты → шаблон.

- [ ] **Step 1: Failing-тест:**
```ts
import { describe, it, expect } from 'vitest';
import { makeFinalRound, isFinalRound } from './templateTypes.js';
it('makeFinalRound создаёт финал-раунд с 2 пустыми темами', () => {
  let n = 0; const r = makeFinalRound(() => `id${n++}`);
  expect(r.type).toBe('final');
  expect(r.themes).toHaveLength(2);
  expect(r.themes[0].questionId).toBeNull();
  expect(isFinalRound(r)).toBe(true);
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация** — добавить интерфейсы и:
```ts
export function isFinalRound(r: TemplateRound): r is TemplateFinalRound { return (r as TemplateFinalRound).type === 'final'; }
export function makeFinalRound(idGen: () => string): TemplateFinalRound {
  return { id: idGen(), type: 'final', name: 'Финал', themes: [
    { id: idGen(), name: 'Тема 1', questionId: null },
    { id: idGen(), name: 'Тема 2', questionId: null },
  ] };
}
```
Скопировать типы + хелперы в `web/src/admin/lib/templateTypes.ts` (зеркало; там `makeDefaultTemplate` уже есть — не ломать normal-ветку, теперь `rounds` типизированы `TemplateRound[]`).

- [ ] **Step 4: Run-pass** → `npm test -- src/packs/templateTypes.final.test.ts` PASS; `cd web && npx svelte-check` (или `npm run check`) — 0 ошибок типов.

- [ ] **Step 5: Commit**
```bash
git add src/packs/templateTypes.ts web/src/admin/lib/templateTypes.ts src/packs/templateTypes.final.test.ts
git commit -m "feat(2c): типы шаблона финал-раунда (сервер + клиент)"
```

---

## Task 11: Шаблон — валидация финала (сервер + клиент-зеркало)

**Files:**
- Modify: `src/packs/templateValidate.ts`
- Modify: `web/src/admin/lib/templateValidate.ts`
- Test: `src/packs/templateValidate.final.test.ts` (создать)

**Interfaces:**
- Consumes: `TemplateRound` union (Task 10), `BankView` (существует).
- Produces: Problem kinds финала (см. Контракты). `validateForPublish` обрабатывает финал-раунды; `final-multiple` если >1 финала.

- [ ] **Step 1: Failing-тест** (используйте фейковый `BankView` с одной категорией/вопросом, как в существующих тестах валидатора):
```ts
it('финал с <2 темами → final-too-few-themes', () => {
  const doc = tmpl([{ id:'r1', type:'final', name:'Ф', themes:[{ id:'th1', name:'A', questionId:'q1' }] }]);
  const probs = validateForPublish(doc, bankWith('q1'), () => true);
  expect(probs.some(p => p.kind === 'final-too-few-themes')).toBe(true);
});
it('тема без вопроса → final-theme-no-question', () => {
  const doc = tmpl([{ id:'r1', type:'final', name:'Ф', themes:[{ id:'th1', name:'A', questionId:null }, { id:'th2', name:'B', questionId:'q1' }] }]);
  expect(validateForPublish(doc, bankWith('q1'), () => true).some(p => p.kind === 'final-theme-no-question')).toBe(true);
});
it('>1 финала → final-multiple', () => {
  const fr = (id) => ({ id, type:'final', name:'Ф', themes:[{ id:id+'a', name:'A', questionId:'q1' }, { id:id+'b', name:'B', questionId:'q1' }] });
  expect(validateForPublish(tmpl([fr('r1'), fr('r2')]), bankWith('q1'), () => true).some(p => p.kind === 'final-multiple')).toBe(true);
});
it('валидный финал-раунд → нет ошибок финала', () => {
  const doc = tmpl([{ id:'r1', type:'final', name:'Ф', themes:[{ id:'th1', name:'A', questionId:'q1' }, { id:'th2', name:'B', questionId:'q1' }] }]);
  const probs = validateForPublish(doc, bankWith('q1'), () => true);
  expect(probs.filter(p => p.kind.startsWith('final-'))).toEqual([]);
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация** — в `validateForPublish`: ветвление по `isFinalRound(round)`. Для финала: `themes.length<2` → `final-too-few-themes`; на каждую тему: `!questionId` → `final-theme-no-question`; `questionId && !bank.questions.has(questionId)` → `final-theme-bad-question`; вопрос с media и `!mediaExists(...)` → `final-theme-missing-media`. После цикла раундов: `rounds.filter(isFinalRound).length>1` → `final-multiple`. Добавить Problem kinds в union. Клиент-зеркало — те же проверки без `final-theme-missing-media` (нет доступа к ФС).

- [ ] **Step 4: Run-pass** → PASS; `cd web && npm run check` 0.

- [ ] **Step 5: Commit**
```bash
git add src/packs/templateValidate.ts web/src/admin/lib/templateValidate.ts src/packs/templateValidate.final.test.ts
git commit -m "feat(2c): валидация финал-раунда (сервер + клиент-зеркало)"
```

---

## Task 12: Шаблон — flatten финала

**Files:**
- Modify: `src/packs/templateFlatten.ts`
- Test: `src/packs/templateFlatten.final.test.ts` (создать)

**Interfaces:**
- Consumes: `TemplateRound` union, `BankView`.
- Produces: `flattenTemplate` для финал-раунда → `{ type:'final', name, themes:[{name, question:{type,prompt,answer,media?}}] }`; снапшот контента из банка; `mediaCopies` (bank/media/X → media/X) как для сетки. Результат проходит `gameJsonSchema`.

- [ ] **Step 1: Failing-тест:**
```ts
it('flatten финал-раунда: темы из банка, снапшот, без value/special', () => {
  const doc = tmpl([{ id:'r1', type:'final', name:'Финал', themes:[
    { id:'th1', name:'История', questionId:'q1' },
    { id:'th2', name:'Кино', questionId:'q2' },
  ]}]);
  const { game } = flattenTemplate(doc, bankWith2('q1','q2'));
  const round = (game as any).rounds[0];
  expect(round.type).toBe('final');
  expect(round.themes).toHaveLength(2);
  expect(round.themes[0]).toMatchObject({ name:'История', question:{ prompt: expect.any(String), answer: expect.any(String) } });
  expect(gameJsonSchema.safeParse(game).success).toBe(true);
});
it('flatten финала с медиа возвращает mediaCopies bank→pack', () => {
  const { mediaCopies } = flattenTemplate(tmplFinalWithMedia(), bankWithMedia());
  expect(mediaCopies[0]).toMatchObject({ from: expect.stringContaining('bank/media/'), to: expect.stringContaining('media/') });
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация** — в `flattenTemplate`, при `isFinalRound(r)`: маппить `themes` → `{ name, question }`, резолвя `questionId` из `bank.questions`; media-переписывание/копирование как в normal-ветке (тот же `seenMedia`/`mediaCopies`); вопрос без `value/special` (схема финала их не требует). Если `questionId` null или не найден — `throw` (валидация публикации уже это ловит; flatten — последний рубеж).

- [ ] **Step 4: Run-pass** → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/packs/templateFlatten.ts src/packs/templateFlatten.final.test.ts
git commit -m "feat(2c): flatten финал-раунда из шаблона"
```

---

## Task 13: Шаблон — portable экспорт/импорт финала

**Files:**
- Modify: `src/packs/templatePortable.ts`
- Test: `src/packs/templatePortable.final.test.ts` (создать)

**Interfaces:**
- Produces: portable zod-схема round = union normal/final; `toPortable`/`fromPortable` сохраняют финал-раунды (компоновка: темы + questionId-ссылки, без контента/медиа).

- [ ] **Step 1: Failing-тест:**
```ts
it('round-trip финал-раунда через portable', () => {
  const doc = { id:'g1', title:'T', rounds:[{ id:'r1', type:'final', name:'Финал', themes:[
    { id:'th1', name:'A', questionId:'q1' }, { id:'th2', name:'B', questionId:null },
  ]}]};
  const portable = toPortable(doc as any);
  const back = fromPortable(JSON.stringify(portable));
  expect(back.rounds[0].type).toBe('final');
  expect((back.rounds[0] as any).themes).toHaveLength(2);
  expect(back.id).not.toBe('g1'); // новый id
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация** — `portableRoundSchema = z.union([finalRoundPortable, normalRoundPortable])`; финал: `{ type:z.literal('final'), id, name, themes: z.array(z.object({ id, name, questionId: z.string().nullable() })) }`. `toPortable`/`fromPortable` — без спец-логики (общая структура), убедиться что union пропускает оба типа.

- [ ] **Step 4: Run-pass** → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/packs/templatePortable.ts src/packs/templatePortable.final.test.ts
git commit -m "feat(2c): portable экспорт/импорт финал-раунда"
```

---

## Task 14: Realtime — проекции с тайной + поля финала

**Files:**
- Modify: `src/realtime/protocol.ts`
- Test: `src/realtime/protocol.final.test.ts` (создать)

**Interfaces:**
- Consumes: `GameState.final`, `Pack` с финал-раундом.
- Produces: расширенные `PublicState`/`HostState` (поля `captains`, `final`, `finalThemes`, `finalQuestion`; для host — `finalReferenceAnswer: string|null`); функция `toPlayerFinalState(s, pack, viewerTeamId, now?)`. Маска тайны: до `FINAL_REVEAL` — `bets={}`, `answers` только своя (player) / `{}` (board/host); `betPlaced`/`answerLocked` — списки id. На `FINAL_REVEAL` — полные `bets`/`answers`. См. Контракты → проекции.

- [ ] **Step 1: Failing-тесты:**
```ts
// helper: соберите GameState в FINAL_QUESTION с bets и answers нескольких команд + pack с финал-раундом
it('player видит только свою ставку/ответ до reveal', () => {
  const ps = toPlayerFinalState(stateInFinalQuestion(), packFinal(), 'B');
  expect(ps.final!.bets).toEqual({});                       // суммы скрыты
  expect(Object.keys(ps.final!.answers)).toEqual(['B']);    // только своя
  expect(ps.final!.betPlaced).toContain('C');               // факт виден
});
it('board не видит ответы/ставки до reveal', () => {
  const ps = toPublicState(stateInFinalQuestion(), packFinal());
  expect(ps.final!.answers).toEqual({});
  expect(ps.final!.bets).toEqual({});
});
it('host не видит суммы/тексты до reveal, но видит betPlaced/answerLocked и эталон', () => {
  const hs = toHostState(stateInFinalQuestion(), packFinal());
  expect(hs.final!.bets).toEqual({});
  expect(hs.finalReferenceAnswer).toBeTruthy();             // эталон оставшейся темы
});
it('на FINAL_REVEAL все ставки/ответы видны всем проекциям', () => {
  const ps = toPublicState(stateInFinalReveal(), packFinal());
  expect(Object.keys(ps.final!.bets).length).toBeGreaterThan(0);
  expect(Object.keys(ps.final!.answers).length).toBeGreaterThan(0);
});
it('finalQuestion виден в FINAL_QUESTION (вопрос оставшейся темы)', () => {
  expect(toPublicState(stateInFinalQuestion(), packFinal()).finalQuestion?.prompt).toBeTruthy();
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация** — в `protocol.ts`:
  - Хелпер `finalRound(pack)` = `pack?.rounds.find(r => r.type === 'final') as FinalRound | undefined`.
  - `remainingTheme(s, pack)` = тема с `id === s.final.themeIds[0]` когда `themeIds.length===1`.
  - Общий билдер финал-блока с параметрами `reveal: boolean` и `viewerTeamId: string|null`:
    - `reveal = s.phase === 'FINAL_REVEAL' || s.phase === 'GAME_END'`.
    - `bets`: `reveal ? s.final.bets : {}`.
    - `answers`: `reveal ? s.final.answers : (viewerTeamId && s.final.answers[viewerTeamId] ? { [viewerTeamId]: s.final.answers[viewerTeamId] } : {})`.
    - `betPlaced = Object.keys(s.final.bets)`, `answerLocked = Object.entries(s.final.answers).filter(([,a])=>a.locked).map(([t])=>t)`.
    - `answerTimerSec = s.finalAnswerTimerSec`, `answerDeadline`/`answerPausedRemainingMs` из `s.final`.
  - `finalThemes`: `finalRound?.themes.map(t=>({id:t.id,name:t.name})) ?? null`.
  - `finalQuestion`: в фазах `FINAL_QUESTION`/`FINAL_REVEAL`/`GAME_END` (когда `themeIds.length===1`) → `{type,prompt,media}` оставшейся темы; иначе `null`.
  - `captains`: `Object.fromEntries(s.teams.map(t=>[t.id,t.captainPlayerId]))`.
  - `toPublicState`: финал-блок с `viewerTeamId=null`.
  - `toPlayerFinalState(s,pack,viewerTeamId,now)`: финал-блок с переданным `viewerTeamId`.
  - `toHostState`: финал-блок с `viewerTeamId=null` (host тоже не видит до reveal) + `finalReferenceAnswer = remainingTheme(...)?.question.answer ?? null`.
  - Вне финал-фаз `final=null`, `finalThemes=null`, `finalQuestion=null` (не ломать существующие тесты проекций).

- [ ] **Step 4: Run-pass** → `npm test -- src/realtime/protocol.final.test.ts` PASS; весь `npm test` зелёный.

- [ ] **Step 5: Commit**
```bash
git add src/realtime/protocol.ts src/realtime/protocol.final.test.ts
git commit -m "feat(2c): проекции финала — тайна ставок/ответов до вскрытия + toPlayerFinalState"
```

---

## Task 15: Gateway — host/player-actions финала + per-socket рассылка

**Files:**
- Modify: `src/realtime/gateway.ts`
- Modify: `src/realtime/protocol.ts` (тип `ClientToServer` — добавить `finalAction`)
- Test: `src/realtime/gateway.final.test.ts` (создать — на чистую логику-валидацию, где возможно; интеграционная проверка — в E2E Task 23)

**Interfaces:**
- Consumes: события/проекции из Task 3,14; `SessionRegistry`, `loadPack`.
- Produces: обработчики host-actions (`startFinal`, `assignCaptain`, `finalBeginElimination`, `finalJudge`, `finalTimer*`) и socket-сообщение `finalAction` (player-actions `removeTheme/placeBet/updateAnswer/lockAnswer`) с валидацией капитан+фаза+принадлежность; `broadcastState` рассылает финал-фазы per-socket игрокам.

- [ ] **Step 1: Failing-тест** — выделить чистый хелпер валидации и протестировать его. Создать в gateway экспортируемую чистую функцию:
```ts
export function validateFinalAction(
  s: GameState, action: string, playerId: string, data: any
): { ok: true; teamId: string } | { ok: false } {
  // находит команду игрока; проверяет, что playerId — капитан этой команды;
  // что команда в eliminationOrder; что фаза соответствует действию;
  // для removeTheme — что сейчас ход этой команды (eliminationOrder[turnIndex]===teamId)
}
```
Тесты:
```ts
it('removeTheme отклонён, если не капитан', () => {
  const s = finalEliminationState(); // капитан B = pB
  expect(validateFinalAction(s, 'removeTheme', 'someoneElse', { themeId:'t1' }).ok).toBe(false);
});
it('removeTheme отклонён не в свой ход', () => {
  const s = finalEliminationState(); // ход B (turnIndex 0)
  // капитан C пытается в чужой ход
  expect(validateFinalAction(s, 'removeTheme', captainOf(s,'C'), { themeId:'t1' }).ok).toBe(false);
});
it('placeBet принят от капитана в FINAL_BETTING', () => {
  const s = finalBettingState();
  const r = validateFinalAction(s, 'placeBet', captainOf(s,'B'), { amount: 50 });
  expect(r.ok).toBe(true);
});
it('placeBet отклонён вне FINAL_BETTING', () => {
  expect(validateFinalAction(finalEliminationState(), 'placeBet', captainOf(finalEliminationState(),'B'), { amount:50 }).ok).toBe(false);
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация:**
  - `validateFinalAction` как описано (чистая, экспортируемая).
  - В `socket.on('hostAction')` добавить кейсы:
    - `startFinal`: найти финал-раунд в паке; если нет — `appError`. Для каждой участвующей команды (`score>0`) с `captainPlayerId===null` вычислить кандидата (первый connected игрок команды) и `append(CAPTAIN_ASSIGNED)`. Затем `append(FINAL_STARTED, { themeIds: finalRound.themes.map(t=>t.id) })`.
    - `assignCaptain`: `append(CAPTAIN_ASSIGNED, data)`.
    - `finalBeginElimination`: `append(FINAL_ELIMINATION_BEGAN, {})`.
    - `finalJudge`: `append(FINAL_ANSWER_JUDGED, data)`.
    - `finalTimerPause`: вычислить `remainingMs` из `final.answerDeadline - Date.now()`, `append(FINAL_TIMER_PAUSED,{remainingMs})`.
    - `finalTimerResume`: `append(FINAL_TIMER_RESUMED, { deadline: Date.now() + remainingMs })`.
    - `finalTimerReset`: `append(FINAL_TIMER_RESUMED, { deadline: Date.now() + s.finalAnswerTimerSec*1000 })`.
    - После каждого — `broadcastState` + `syncFinalTimer(gid)` (Task 16).
  - Новое `socket.on('finalAction', (msg:{action,data}) => {...})`: загрузить state, `sess=bySocket`, найти `playerId`; `validateFinalAction`; если ok — `append` соответствующего события (`placeBet`: gateway клампит `amount` 0..score, хотя reducer тоже клампит; `updateAnswer`: `FINAL_ANSWER_UPDATED`; `lockAnswer`: `FINAL_ANSWER_LOCKED`; `removeTheme`: `FINAL_THEME_REMOVED{themeId,byTeamId}`). Затем `broadcastState` + `syncFinalTimer`.
  - `broadcastState`: если `state.phase` — финал-фаза, для player-room делать per-socket: итерировать сессии роли `player` в игре (через `SessionRegistry`), `io.to(sess.socketId).emit('state', toPlayerFinalState(state, pack, sess→teamId))`. board/host — как сейчас (`toPublicState`/`toHostState`). Вне финала — текущая логика без изменений.
  - В `protocol.ts` `ClientToServer` добавить `finalAction: { action: string; data?: unknown }`.

- [ ] **Step 4: Run-pass** → `npm test -- src/realtime/gateway.final.test.ts` PASS; весь `npm test` зелёный.

- [ ] **Step 5: Commit**
```bash
git add src/realtime/gateway.ts src/realtime/protocol.ts src/realtime/gateway.final.test.ts
git commit -m "feat(2c): gateway — host/player-actions финала + per-socket тайная рассылка"
```

---

## Task 16: Gateway — syncFinalTimer + восстановление

**Files:**
- Modify: `src/realtime/gateway.ts`
- Test: ручной/E2E (логика setTimeout — проверяется в E2E Task 23; здесь — smoke на decision-ветку через существующий стиль)

**Interfaces:**
- Consumes: `finalTimerDecision` (Task 8).
- Produces: `syncFinalTimer(gameId)` (близнец `syncAnswerTimer`): отдельная `Map<string,{timeout,deadline}>`; на `start` эмитит `FINAL_TIMER_STARTED{deadline: Date.now()+s.finalAnswerTimerSec*1000}`; на `timeout` эмитит `FINAL_TIMED_OUT{}`; на `arm` ставит setTimeout; на `clear` чистит. Вызывается отовсюду, где меняется финал-состояние. `recoverTimers` на старте сервера дополнительно зовёт `syncFinalTimer(activeGameId)`.

- [ ] **Step 1: Реализация** (это инфраструктурная задача; явный unit на setTimeout хрупок — основная проверка в E2E):
```ts
const finalTimers = new Map<string, { timeout: ReturnType<typeof setTimeout>; deadline: number }>();
function clearFinalTimer(gameId: string) { const e = finalTimers.get(gameId); if (e) { clearTimeout(e.timeout); finalTimers.delete(gameId); } }
function syncFinalTimer(gameId: string): void {
  const s = deps.store.loadState(gameId);
  const d = finalTimerDecision(s, Date.now());
  switch (d.kind) {
    case 'clear': clearFinalTimer(gameId); return;
    case 'start':
      deps.store.append(gameId, makeEvent('FINAL_TIMER_STARTED', { deadline: Date.now() + s.finalAnswerTimerSec * 1000 }));
      broadcastState(io, deps, gameId); syncFinalTimer(gameId); return;
    case 'timeout':
      deps.store.append(gameId, makeEvent('FINAL_TIMED_OUT', {}));
      broadcastState(io, deps, gameId); syncFinalTimer(gameId); return;
    case 'arm': {
      const existing = finalTimers.get(gameId);
      if (existing && existing.deadline === s.final!.answerDeadline) return;
      if (existing) clearTimeout(existing.timeout);
      const timeout = setTimeout(() => { finalTimers.delete(gameId); syncFinalTimer(gameId); }, d.delayMs);
      finalTimers.set(gameId, { timeout, deadline: s.final!.answerDeadline! });
      return;
    }
  }
}
```
Подключить `syncFinalTimer(gid)` после `broadcastState` во всех финал-обработчиках Task 15 (рядом с `syncAnswerTimer`). В `recoverAnswerTimers`/recover-функции на старте добавить вызов `syncFinalTimer(activeGameId)`.

- [ ] **Step 2: Проверка** — `npx tsc --noEmit` чисто; `npm test` зелёный (существующие не падают).

- [ ] **Step 3: Commit**
```bash
git add src/realtime/gateway.ts
git commit -m "feat(2c): gateway — syncFinalTimer (state-driven) + восстановление на старте"
```

---

## Task 17: HTTP + лобби — настройка finalAnswerTimerSec

**Files:**
- Modify: `src/http/server.ts` (`POST /api/games`)
- Modify: `web/src/admin/store.ts`, `web/src/admin/gameApi.ts`, `web/src/admin/sections/Lobby.svelte`
- Test: `src/http/server.final.test.ts` (создать) — кламп.

**Interfaces:**
- Consumes: `GAME_CREATED.finalAnswerTimerSec` (Task 3).
- Produces: `POST /api/games` принимает `finalAnswerTimerSec`, клампит 30–300 (дефолт 60), кладёт в `GAME_CREATED`. Лобби — степпер/пресеты.

- [ ] **Step 1: Failing-тест** (по образцу существующего теста клампа `answerTimerSec`):
```ts
it('POST /api/games клампит finalAnswerTimerSec в 30..300', async () => {
  const r = await createGame({ packId, teamCount: 3, answerTimerSec: 45, finalAnswerTimerSec: 5 });
  // прочитать GAME_CREATED из event-store / state
  expect(loadState(r.gameId).finalAnswerTimerSec).toBe(30);
  const r2 = await createGame({ ..., finalAnswerTimerSec: 999 });
  expect(loadState(r2.gameId).finalAnswerTimerSec).toBe(300);
});
```

- [ ] **Step 2: Run-fail** → FAIL.

- [ ] **Step 3: Реализация:**
  - `server.ts`: рядом с клампом `answerTimerSec` — `const finalAnswerTimerSec = clamp(body.finalAnswerTimerSec ?? 60, 30, 300);` и передать в `GAME_CREATED`.
  - `gameApi.ts`: `createGame` шлёт `finalAnswerTimerSec`.
  - `store.ts` (admin): добавить writable `finalAnswerTimerSec` (дефолт 60).
  - `Lobby.svelte`: рядом с чипом `answerTimerSec` — блок «Таймер финала» с пресетами 45/60/90 и ±15 (диапазон 30–300), привязка к стору; при «Активировать»/создании передаётся в `createGame`.

- [ ] **Step 4: Run-pass** → PASS; `cd web && npm run check` 0, `npm run build` ок.

- [ ] **Step 5: Commit**
```bash
git add src/http/server.ts src/http/server.final.test.ts web/src/admin/store.ts web/src/admin/gameApi.ts web/src/admin/sections/Lobby.svelte
git commit -m "feat(2c): finalAnswerTimerSec — кламп 30..300 + настройка в лобби"
```

---

## Task 18: Web — протокол-зеркало, socket finalAction, store

**Files:**
- Modify: `web/src/lib/socket.ts`, `web/src/lib/store.ts`
- Test: `cd web && npm run check` (типы) — структурный; функциональная проверка в Task 19–21 (Playwright).

**Interfaces:**
- Produces: `finalAction(action, data?)` в `socket.ts` (emit `finalAction`); `gameStore` несёт поля `final`, `captains`, `finalThemes`, `finalQuestion` (тип `any`, как сейчас).

- [ ] **Step 1: Реализация:**
  - `socket.ts`: `export function finalAction(action: string, data?: unknown) { socket.emit('finalAction', { action, data }); }`.
  - `store.ts`: поля приходят в общий `state`-обработчик (gameStore уже `any`), доп. изменений может не требоваться — убедиться, что `gameStore.set(payload)` сохраняет новые поля.
  - Если есть production-derived store для отображения — не требуется.

- [ ] **Step 2: Проверка** — `cd web && npm run check` 0; `npm run build` ок.

- [ ] **Step 3: Commit**
```bash
git add web/src/lib/socket.ts web/src/lib/store.ts
git commit -m "feat(2c): web — socket finalAction + поля финала в gameStore"
```

---

## Task 19: Board — экраны фаз финала

**Files:**
- Modify: `web/src/board/App.svelte`
- Test: Playwright (визуальная проверка) — добавляется в Task 23; в этой задаче — `npm run check` + `npm run build` + ручной скриншот.

**Interfaces:**
- Consumes: `gameStore.final`, `finalThemes`, `finalQuestion`, `captains`, таймер-поля; `answerSecondsLeft`-аналог для финала.
- Produces: ветки рендера по `phase` FINAL_*.

- [ ] **Step 1: Реализация** — в диспетчере по `phase` добавить:
  - `FINAL_INTRO`: заголовок «Финал» + сетка всех тем (`finalThemes`).
  - `FINAL_ELIMINATION`: темы; вычеркнутые (не в `final.themeIds`) — зачёркнуты/затемнены; подсветка имени команды, чей ход (`final.eliminationOrder[final.eliminationTurnIndex]`).
  - `FINAL_BETTING`: «Команды делают ставки» + индикатор кто уже поставил (`final.betPlaced`), без сумм.
  - `FINAL_QUESTION`: крупно вопрос оставшейся темы (`finalQuestion`: текст/изображение/аудио) + таймер (отсчёт из `final.answerDeadline`/`serverNow`) + «кто готов» (`final.answerLocked`).
  - `FINAL_REVEAL`: список команд с ответами (`final.answers`) и ставками (`final.bets`); по мере `final.revealIndex` — ✓/✗ и новый счёт.
  - `GAME_END`: победитель (существует Scoreboard) — учесть, что финал доиграл счета.
  - Для таймера финала — derived-стор по образцу `web/src/lib/answerTimer.ts`, но на `final.answerDeadline` (можно вынести `finalSecondsLeft` в `answerTimer.ts` или локально в компоненте).

- [ ] **Step 2: Проверка** — `cd web && npm run check` 0, `npm run build` ок. Запустить dev/Docker, вручную прогнать фазы (или дождаться Task 23 Playwright).

- [ ] **Step 3: Commit**
```bash
git add web/src/board/App.svelte web/src/lib/answerTimer.ts
git commit -m "feat(2c): табло — экраны фаз финала (темы/вычёркивание/ставки/вопрос/вскрытие)"
```

---

## Task 20: Player — экраны фаз финала (капитан + не-капитан)

**Files:**
- Modify: `web/src/play/App.svelte`
- Test: Playwright (Task 23) + `npm run check`/`build`.

**Interfaces:**
- Consumes: `me={playerId,teamId,role}`, `gameStore.captains`, `final`, `finalQuestion`; `finalAction` (Task 18).
- Produces: ветки по `phase`, различающие капитана (`captains[myTeamId]===me.playerId`) и не-капитана; не-участников (нет в `final.eliminationOrder`).

- [ ] **Step 1: Реализация:**
  - Вычислить `iAmCaptain = final && me && $gameStore.captains?.[myTeamId] === me.playerId`; `iParticipate = final?.eliminationOrder.includes(myTeamId)`.
  - `FINAL_INTRO`: статус «Скоро финал» / «Ваша команда не участвует (счёт ≤ 0)» для не-участников.
  - `FINAL_ELIMINATION`: если капитан и мой ход (`eliminationOrder[turnIndex]===myTeamId`) — список `final.themeIds` (резолв имён через `finalThemes`) с кнопками «Вычеркнуть» (`finalAction('removeTheme',{themeId})`); иначе статус «идёт вычёркивание, ходит N».
  - `FINAL_BETTING`: капитан — числовой ввод 0..`myScore` + «Сделать ставку» (`finalAction('placeBet',{amount})`), клиентская валидация диапазона; после — «ставка принята»; не-капитан — «капитан делает ставку».
  - `FINAL_QUESTION`: капитан — текстовое поле (`bind:value`), дебаунс ~1000мс → `finalAction('updateAnswer',{text})` (+flush на blur), кнопка «Готово» → `finalAction('lockAnswer')`; после лока — «ответ зафиксирован»; вопрос (`finalQuestion`) виден; не-капитан — «капитан отвечает» + вопрос; таймер-отсчёт.
  - `FINAL_REVEAL`: свой результат (ставка/ответ/вердикт по мере судейства).
  - `GAME_END`: победитель (существует).
  - Дебаунс: завести `let answerText=''; let t; function onInput(){ clearTimeout(t); t=setTimeout(()=>finalAction('updateAnswer',{text:answerText}),1000); }`, и flush в `lockAnswer`.

- [ ] **Step 2: Проверка** — `cd web && npm run check` 0, `npm run build` ок.

- [ ] **Step 3: Commit**
```bash
git add web/src/play/App.svelte
git commit -m "feat(2c): экран игрока — фазы финала (капитан вычёркивает/ставит/отвечает)"
```

---

## Task 21: Pult — управление финалом + вскрытие

**Files:**
- Modify: `web/src/admin/sections/Pult.svelte`
- Test: Playwright (Task 23) + `npm run check`/`build`.

**Interfaces:**
- Consumes: `HostState.final`, `finalThemes`, `finalQuestion`, `finalReferenceAnswer`, `captains`, `players`; `hostAction`.
- Produces: ветки по `phase` FINAL_* для ведущего.

- [ ] **Step 1: Реализация:**
  - На `ROUND_END` последнего обычного раунда — если в паке есть финал-раунд, показать кнопку **«Начать финал»** (`hostAction('startFinal')`) рядом с «Завершить игру». (Признак «есть финал» — прокинуть через активную игру / `gameStore.finalThemes!==null` после старта, либо отдельный флаг `hasFinal` в состоянии/active-game; если нет простого признака на ROUND_END — добавить в `GET /api/active-game`/state поле `hasFinal`. Минимальный путь: показывать «Начать финал» всегда на ROUND_END, а `startFinal` без финал-раунда отвечает `appError` — UX-приемлемо; но лучше скрывать.)
  - `FINAL_INTRO`: список тем; назначение капитанов — на каждую участвующую команду селект игрока (`players` команды) → `hostAction('assignCaptain',{teamId,playerId})`; кнопка «Начать вычёркивание» (`finalBeginElimination`).
  - `FINAL_ELIMINATION`: показать чей ход, темы (вычеркнутые помечены). (Действие вычёркивания — у капитана; ведущий наблюдает; опц. — нет host-форса в MVP.)
  - `FINAL_BETTING`: «кто уже поставил» (`final.betPlaced`), сумм нет.
  - `FINAL_QUESTION`: вопрос + эталон (`finalReferenceAnswer`) + «кто готов» (`final.answerLocked`) + таймер с кнопками Пауза/Возобновить/Сброс (`finalTimerPause/Resume/Reset`).
  - `FINAL_REVEAL`: по командам в порядке `eliminationOrder` — ставка (`final.bets[tid]`), ответ (`final.answers[tid].text`), эталон, кнопки **Правильно/Неправильно** (`hostAction('finalJudge',{teamId,correct})`); по мере `revealIndex` отмечать обработанные; когда все — кнопка «Завершить игру» (`endGame`).
  - `GAME_END`: финальный счёт (существует).

- [ ] **Step 2: Проверка** — `cd web && npm run check` 0, `npm run build` ок.

- [ ] **Step 3: Commit**
```bash
git add web/src/admin/sections/Pult.svelte
git commit -m "feat(2c): пульт — управление финалом, назначение капитанов, вскрытие+верификация"
```

---

## Task 22: Конструктор — FinalRoundEditor + интеграция

**Files:**
- Create: `web/src/admin/sections/builder/FinalRoundEditor.svelte`
- Modify: `web/src/admin/sections/builder/GameEditor.svelte`
- Test: Playwright (Task 23) + `npm run check`/`build`.

**Interfaces:**
- Consumes: `TemplateFinalRound`/`isFinalRound`/`makeFinalRound` (Task 10), `QuestionPicker`, банк.
- Produces: редактор финал-раунда (список тем + выбор вопроса из банка любой категории), кнопка «+ Финал» в табах (только если финала ещё нет).

- [ ] **Step 1: Реализация:**
  - `GameEditor.svelte`: в зоне табов — кнопка «+ Финал» (показывать, только если `!doc.rounds.some(isFinalRound)`), добавляет `makeFinalRound(uuid)`; при выборе финал-таба рендерить `FinalRoundEditor` вместо `RoundGrid`. Удаление финал-раунда — как обычного (× на табе).
  - `FinalRoundEditor.svelte`: пропсы `round: TemplateFinalRound`, колбэк изменения (через `draft`/реактивный doc, как `RoundGrid`). UI: заголовок, список тем: имя темы (`input bind`), превью назначенного вопроса или кнопка «+ выбрать вопрос» → `QuestionPicker` (без ограничения категорией — финал-тема берёт любой вопрос; `scope` уникальности — весь doc, как сейчас), ⚙ сменить, × очистить вопрос; кнопки «+ Тема», «−» удалить тему (минимум 2 — кнопка удаления disabled при `themes.length<=2`).
  - Лайв-валидация финала: переиспользовать клиентский `validateClient` (Task 11) — баннер ошибок (тема без вопроса, <2 тем) рисуется существующим механизмом в `GameEditor`.

- [ ] **Step 2: Проверка** — `cd web && npm run check` 0, `npm run build` ок; вручную/Playwright: создать финал-раунд, назначить вопросы, опубликовать.

- [ ] **Step 3: Commit**
```bash
git add web/src/admin/sections/builder/FinalRoundEditor.svelte web/src/admin/sections/builder/GameEditor.svelte
git commit -m "feat(2c): конструктор — редактор финал-раунда (темы) + интеграция в табы"
```

---

## Task 23: E2E финала (Playwright) + docs/run.md

**Files:**
- Create: `tests/e2e/final-round.spec.ts`
- Modify: `docs/run.md`
- Test: `npm run test:e2e`

**Interfaces:**
- Consumes: весь стек финала.
- Produces: E2E round-trip: собрать в конструкторе игру с обычным раундом + финалом (≥2 тем) → опубликовать → создать игру (с командами и игроками-капитанами) → доиграть обычный раунд → «Начать финал» → вычёркивание до 1 темы → ставки → ответы → вскрытие+верификация → GAME_END с победителем. Визуальная сверка board/player/host в фазах финала (скриншоты).

- [ ] **Step 1: Тест** — по образцу `tests/e2e/smoke.spec.ts`/`template-export-import.spec.ts`. Минимум проверок: после `startFinal` фаза показывает темы; тайна — в player-проекции другой команды нет чужого текста ответа (проверить через DOM/нет утечки); вскрытие меняет счёт; финальный экран показывает победителя. Сделать скриншоты ключевых фаз (board) в `test-results`.

- [ ] **Step 2: Run** — `npm run test:e2e` → новый спек зелёный (изолированный webServer :3100). При флки `reuseExistingServer` — убедиться, что зомби-сервер :3100 не висит.

- [ ] **Step 3: docs/run.md** — раздел «Как играть финал»: настройка таймера финала в лобби, создание финал-раунда в конструкторе, ход игры (вычёркивание → ставки → ответы → вскрытие).

- [ ] **Step 4: Commit**
```bash
git add tests/e2e/final-round.spec.ts docs/run.md
git commit -m "test(2c): E2E финала round-trip + docs/run.md — как играть финал"
```

---

## Финальная проверка (после всех задач)

- [ ] `npm test` (сервер) — всё зелёное.
- [ ] `cd web && npm test && npm run check && npm run build` — зелёное, 0 ошибок типов.
- [ ] `npm run test:e2e` — включая `final-round.spec.ts`.
- [ ] `npx tsc --noEmit` — чисто.
- [ ] Docker-гейт: `docker compose up -d --build`, на :3000 — пройти полный финал руками/Playwright (по проектному правилу «верифицировать UI через Playwright»), снять скриншоты board/player/host фаз финала, сложить в `docs/superpowers/final-round-pixel-diff.md` (по образцу прошлых пиксель-сверок).
- [ ] Финальное whole-branch ревью (opus) перед merge.
- [ ] Обновить memory `svoya-igra-status.md` после merge.

## Самопроверка плана (spec coverage)

- Капитан (`captainPlayerId`, `CAPTAIN_ASSIGNED`, назначение в Host) → Task 2,3,4,15,21. ✔
- Формат пака (final-раунд, `z.union`, back-compat) → Task 1. ✔
- Фазы движка (5 фаз) + события → Task 2,3,4–9. ✔
- Вычёркивание (беднейший первый, по кругу, ≤0 исключены, тай-брейк) → Task 4,5. ✔
- Тайные ставки (лок, 0..счёт) → Task 6. ✔
- Тайные ответы (правка, Готово, авто-фиксация по таймеру) → Task 7,8. ✔
- Таймер финала (отдельный, пауза/сброс, настройка в лобби) → Task 8,16,17. ✔
- Вскрытие + верификация (начисление +/−) → Task 9,21. ✔
- Тайна проекций (per-socket, до reveal в т.ч. от host) → Task 14,15. ✔
- Realtime-протокол (host/player actions, валидация) → Task 15. ✔
- UI board/player/host → Task 19,20,21. ✔
- Конструктор финала (темы, валидация, flatten, portable) → Task 10–13,22. ✔
- Strict-валидация публикации финала → Task 11. ✔
- Тестирование (движок, тайна, валидация realtime, формат, E2E) → Task 1–23. ✔
- docs (pack-format, run) → Task 1,23. ✔
