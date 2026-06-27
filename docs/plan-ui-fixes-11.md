# План: 11 правок конструктора/игры (UI + игровой движок)

Статус: **план готов, реализация — отдельной сессией.**
Решение по п.10 (кик): **простой кик** — удалить из ростера + отключить сокет + сбросить
localStorage клиента. Полную блокировку повторного входа (бан clientToken) НЕ делаем.

Карта файлов получена обследованием на 2026-06-27. Перед правкой строк — перечитать файл,
номера строк могли сдвинуться.

---

## Сводка пунктов

| # | Что просили | Где правим |
|---|---|---|
| 1 | менять выбор карточки, пока не нажата «Прочитать вопрос» | Pult (Matrix `clickable`) + reducer (buzzQueue) |
| 2 | ведущий не видит вопрос до «Прочитать вопрос» | `protocol.toHostState` + Pult (условия qcard/flow) |
| 3 | прервать создание игры — кнопка «назад» на 1-й экран | Lobby.svelte |
| 4 | состав команд (участники) на табло | `PublicState.roster` (protocol) + board/App.svelte |
| 5 | название игры по центру до старта раунда 1 | board/App.svelte (ветка LOBBY/ROUND_INTRO) |
| 6 | ведущий видит, кто выбирает вопрос | Pult.svelte (баннер pickingTeam) |
| 7 | итоги раунда на ТВ — адаптив на всё место | board/App.svelte + Scoreboard.svelte (вариант `lg`) |
| 8 | разброс баззера, общее время ~5–6 с | buzzer.ts `f1Schedule` + buzzer.test.ts |
| 9 | не прятать последнюю скорость реакции до новой карточки | reducer (buzzQueue) + board/play (показ в PICKING) |
| 10 | выгнать игрока из игры | `PLAYER_KICKED` event + gateway + Lobby/Pult кнопка |
| 11 | финал: неверные ответы красным на ТВ и планшетах | `FinalRuntime.verdicts` + protocol + board/play |

---

## Бэкенд

### Доменные типы — `src/domain/types.ts`

`FinalRuntime` (строки ~50–59): добавить поле вердиктов для п.11:

```ts
export interface FinalRuntime {
  // …существующие поля…
  verdicts: Record<string, boolean>;   // teamId -> верно/неверно (выставляется при FINAL_ANSWER_JUDGED)
}
```

### События — `src/domain/events.ts`

Добавить в union (п.10):

```ts
| Ev<'PLAYER_KICKED', { playerId: string }>
```

(`FINAL_ANSWER_JUDGED` уже есть — `{ teamId; correct }`, добавлять не нужно.)

### Reducer — `src/domain/engine/reducer.ts`

**п.1 + п.9 — buzzQueue:**
- `QUESTION_SELECTED` (строки 71–81): добавить `s.buzzQueue = []; s.answeringIndex = -1;`
  (новая карточка — чистим прошлую очередь реакций).
- `QUESTION_CLOSED` (строки 137–149): **убрать** `s.buzzQueue = [];` и `s.answeringIndex = -1;`
  — чтобы последняя очередь реакций оставалась видна в PICKING до выбора новой карточки.
  ⚠️ Проверить, что `ROUND_RESET` (150–164) очередь по-прежнему чистит (оставить там очистку).

**п.10 — `PLAYER_KICKED`:**
```ts
case 'PLAYER_KICKED':
  s.players = s.players.filter(p => p.id !== event.payload.playerId);
  return s;
```

**п.11 — инициализация и заполнение verdicts:**
- `FINAL_STARTED` (207–219): в литерал `s.final = {…}` добавить `verdicts: {}`.
- `FINAL_ANSWER_JUDGED` (307–314): перед/после изменения счёта добавить
  `s.final.verdicts[event.payload.teamId] = event.payload.correct;`

### Buzzer — `src/domain/buzzer/buzzer.ts` (п.8)

Сейчас `f1Schedule`: каждый из трёх огней 400–800 мс ⇒ суммарно 1.2–2.4 с (слишком быстро).
Цель: «общее время ~5–6 с» + больше разброса. Делаем каждый интервал 1300–2300 мс:

```ts
export function f1Schedule(rnd: () => number): { greyMs: number; redMs: number; yellowMs: number } {
  const gap = () => Math.round(1300 + rnd() * 1000); // 1300..2300 каждый ⇒ сумма 3.9..6.9 с (среднее ~5.4)
  return { greyMs: gap(), redMs: gap(), yellowMs: gap() };
}
```

Клиент (`web/src/lib/socket.ts`) считает `greenAt = t0 + grey + red + yellow` — менять не нужно,
зелёный сдвинется автоматически.

Тест `src/domain/buzzer/buzzer.test.ts` (строки 34–39) обновить:
```ts
expect(f1Schedule(() => 0)).toEqual({ greyMs: 1300, redMs: 1300, yellowMs: 1300 });
expect(f1Schedule(() => 1)).toEqual({ greyMs: 2300, redMs: 2300, yellowMs: 2300 });
```

### Протокол — `src/realtime/protocol.ts`

**п.2 — ведущий не видит вопрос до «Прочитать»:**
Сейчас `toHostState` (169–185) всегда отдаёт `currentPrompt/currentAnswer` (комментарий «видит всегда»).
Меняем: прятать текст/медиа/ответ в окне «выбран, но не прочитан», НО `currentSpecial` оставить
(чтобы работали панели аукциона/кота до reveal).

```ts
export function toHostState(s, pack, now = Date.now()): HostState {
  const q = findQuestion(pack, s.currentQuestionId);          // полный — для special
  const hideText = s.phase === 'QUESTION' && !s.revealed;     // окно «выбран, не прочитан»
  const remTheme = remainingTheme(s, pack);
  return {
    ...buildPublic(s, pack, now, null),
    currentPrompt: hideText ? null : (q?.prompt ?? null),
    currentType:   hideText ? null : (q?.type ?? null),
    currentMedia:  hideText ? null : (q?.media?.replace(/^media\//, '') ?? null),
    currentSpecial: q?.special ?? null,                         // ВСЕГДА — для аукциона/кота
    currentAnswer:  hideText ? null : (q?.answer ?? null),
    players: s.players.map(({ id, firstName, lastName, teamId, connected }) => ({ id, firstName, lastName, teamId, connected })),
    finalReferenceAnswer: remTheme?.question.answer ?? null,
  };
}
```
Замечание: для аукциона/кота после `AUCTION_WON`/`CAT_ASSIGNED` фаза = `ANSWERING` (не `QUESTION`),
поэтому `hideText=false` и ведущий увидит текст. Для обычного вопроса текст появляется по reveal. ✔

**п.4 — состав команд на табло:** добавить ростер в `PublicState`.
- В интерфейс `PublicState` (46–75) добавить:
  ```ts
  roster: Array<{ firstName: string; lastName: string; teamId: string; connected: boolean }>;
  ```
- В `buildPublic` (133–157) в возвращаемый объект:
  ```ts
  roster: s.players.map(({ firstName, lastName, teamId, connected }) => ({ firstName, lastName, teamId, connected })),
  ```
  (без id/clientToken — публично только имена; табло это и так показывает.)

**п.11 — verdicts в финал-блоке:** в `FinalPublicBlock` (32–44) добавить `verdicts: Record<string, boolean>`;
в `buildFinalBlock` (82–115) отдавать вердикты **только по уже вскрытым** командам (как answers):
```ts
const verdicts: Record<string, boolean> = reveal
  ? Object.fromEntries(Object.entries(f.verdicts).filter(([tid]) =>
      f.eliminationOrder.indexOf(tid) < f.revealIndex))   // только до revealIndex
  : {};
```
Проще и безопаснее: на reveal-фазе отдавать `f.verdicts` целиком — клиент и так рисует только
вскрытые строки (`idx < revealIndex`). Выбрать вариант при реализации; тест держать на «до revealIndex».

### Gateway — `src/realtime/gateway.ts`

**п.10 — `kickPlayer`** в `switch (msg.action)` (после `movePlayer`, ~299):
```ts
case 'kickPlayer': {
  const pid = d.playerId;
  if (!st.players.some(p => p.id === pid)) return;
  // отключить открытые сокеты этого игрока + сказать клиенту очиститься
  for (const sess of deps.sessions.all()) {
    if (sess.gameId === gid && sess.playerId === pid && sess.socketId) {
      io.to(sess.socketId).emit('kicked', {});
      io.sockets.sockets.get(sess.socketId)?.disconnect(true);
    }
  }
  deps.store.append(gid, makeEvent('PLAYER_KICKED', { playerId: pid }));
  break;
}
```
⚠️ `disconnect` вызовет хендлер `disconnect` (237–242) → он добавит `PLAYER_DISCONNECTED` для уже
удалённого игрока. Reducer `PLAYER_CONNECTED/DISCONNECTED` (56–61) делает `find` — на отсутствующем
игроке это no-op. Безопасно. Порядок: сначала emit+disconnect, потом append KICKED — ок.

Добавить в `ServerToClient` (protocol.ts 196–202) тип `kicked: {}`.

### Тесты бэкенда (обновить/добавить)
- `buzzer.test.ts` — новые значения f1Schedule (см. выше).
- `reducer.*.test.ts` — найти тесты, проверяющие очистку `buzzQueue` на `QUESTION_CLOSED`
  (grep `buzzQueue` в `src/domain/engine/*.test.ts`) и перенести ожидание на `QUESTION_SELECTED`.
- Новый тест: `PLAYER_KICKED` убирает игрока из `players`.
- Новый тест: `FINAL_ANSWER_JUDGED` пишет `final.verdicts[teamId]`.
- `protocol.*.test.ts` — host: в фазе `QUESTION`&!revealed `currentPrompt===null`,
  но `currentSpecial` остаётся; после reveal — текст виден. Добавить `roster` в ожидания публичного стейта.

---

## Фронтенд

### `web/src/admin/sections/Pult.svelte`

**п.1 — переключение карточки до reveal.** Matrix `clickable` (строка 335):
```svelte
clickable={state?.phase === 'PICKING' || (state?.phase === 'QUESTION' && !state?.revealed)}
```

**п.2 — qcard и flow-кнопка по новому контракту.**
- qcard (338): `{#if state?.currentPrompt}` оставить — при скрытии currentPrompt=null карточка
  сама исчезнет. (Текст появится после «Прочитать».)
- Блок управления вопросом (392): заменить условие `{:else if state?.currentPrompt}` на
  `{:else if state?.currentQuestionId}` — иначе кнопка «Прочитать вопрос» исчезнет (currentPrompt
  теперь null до reveal). Внутри блок уже умеет ветку `{#if !state.revealed}` → «Прочитать вопрос».

**п.6 — кто выбирает.** В «живой» ветке (после `.head`, ~325) добавить баннер в фазе PICKING:
```svelte
{#if state.phase === 'PICKING' && state.pickingTeamId}
  <div class="pick-banner">Выбирает: <strong>{teamName(state.pickingTeamId)}</strong></div>
{/if}
```
Стиль `.pick-banner` — по аналогии с `.answering-banner`.

**п.10 — кнопка «выгнать» в ростере.** В Pult ростер отдельной панелью отсутствует — кнопку кладём
в Lobby (см. ниже). Опционально продублировать в Pult, если ростер там покажем; в первую очередь — Lobby.

### `web/src/admin/sections/Lobby.svelte`

**п.3 — «Назад» к выбору игры.** В шапке выбранной игры (`.head-actions`, ~185) добавить
неразрушающую кнопку:
```svelte
<button class="ghost" on:click={() => { workingGameId.set(null); }}>← К списку игр</button>
```
Это вернёт на 1-й экран (создание/выбор), игра НЕ удаляется. `workingGameId` уже импортирован.

**п.10 — кик в ростере.** В блоке ростера (244–253) к строке игрока добавить:
```svelte
<button class="icon" title="Выгнать игрока"
  on:click={() => { if (confirm(`Выгнать ${player.lastName} ${player.firstName}?`)) hostAction('kickPlayer', { playerId: player.id }); }}>🚫</button>
```

### `web/src/lib/socket.ts` (п.10, клиент)
Добавить обработчик `kicked`: очистить `localStorage('svoya:player')` и перезагрузить/показать форму:
```ts
socket.on('kicked', () => { try { localStorage.removeItem('svoya:player'); } catch {} location.reload(); });
```
(После reload play/App снова покажет форму входа; авто-rejoin не сработает — записи в localStorage нет.)

### `web/src/board/App.svelte`

**п.5 + п.4 — название игры по центру и состав команд до раунда 1.**
Добавить ветку перед `{:else}` (default), для фаз до начала игрового поля:
```svelte
{:else if state.phase === 'LOBBY' || state.phase === 'ROUND_INTRO'}
  <div class="stack pregame">
    <h1 class="neon game-name">{state.title}</h1>
    <div class="rosters">
      {#each state.teams as t}
        <div class="roster-card">
          <div class="roster-team">{t.name}</div>
          <div class="roster-players">
            {#each (state.roster ?? []).filter(p => p.teamId === t.id) as p}
              <span class="roster-player" class:off={!p.connected}>{p.firstName} {p.lastName}</span>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
```
Стиль: `.game-name { font-size: clamp(2.5rem, 8vw, 6rem); }`, `.rosters` — flex/grid с wrap,
`.roster-player.off { opacity:.4 }`. (Состав команд можно дополнительно показать и в `!state`-экране,
но там ещё нет teams — оставляем как есть.)

**п.7 — итоги раунда адаптив.** Ветка `ROUND_END` (86–90) и `GAME_END` (81–85): обернуть в
полноэкранный контейнер и передать в Scoreboard крупный режим:
```svelte
{:else if state.phase === 'ROUND_END'}
  <div class="results-screen">
    <h1 class="neon results-title">Итоги раунда {state.roundIndex + 1}</h1>
    <Scoreboard teams={state.teams} size="lg" />
  </div>
```
CSS:
```css
.results-screen { height: 100vh; box-sizing: border-box; padding: 2rem;
  display: flex; flex-direction: column; gap: clamp(1rem,4vh,3rem);
  align-items: center; justify-content: center; }
.results-title { font-size: clamp(2rem, 6vw, 5rem); text-align: center; }
```

**п.9 — очередь реакций в PICKING.** Очередь `{#if state.buzzQueue?.length}` (236–238) уже в `.stage`
и рендерится независимо от под-ветки — после правок reducer (buzzQueue живёт до новой карточки)
она останется видна в JUDGED и в PICKING/матрице. Проверить визуально; при желании поднять
заметность (`font-size`). Доп. кода в board, скорее всего, не требуется.

**п.11 — красный неверный в финале (board).** Ветка `FINAL_REVEAL` (170–188): в `revealRows`
прокинуть вердикт и подсветить. В `<script>` (55–63) добавить `verdict: (final.verdicts ?? {})[tid]`.
В разметке строки:
```svelte
<div class="reveal-row" class:revealed={row.revealed}
     class:correct={row.revealed && row.verdict === true}
     class:wrong={row.revealed && row.verdict === false}>
  …
  <span class="reveal-answer">{row.answerText ?? '—'}</span>
</div>
```
CSS:
```css
.reveal-row.wrong { border-color: var(--err); }
.reveal-row.wrong .reveal-answer { color: var(--err); }
.reveal-row.correct { border-color: var(--ok); }
.reveal-row.correct .reveal-answer { color: var(--ok); }
```

### `web/src/lib/Scoreboard.svelte` (п.7)
Добавить проп `size` и адаптивные размеры:
```svelte
export let size: 'md' | 'lg' = 'md';
```
В разметке: `<div class="board {size}">`. CSS для `.board.lg`:
```css
.board.lg { gap: clamp(1rem,2vw,2rem); }
.board.lg .team { min-width: clamp(10rem,18vw,20rem); padding: clamp(1rem,2.5vw,2.5rem) clamp(1.5rem,3vw,3rem); }
.board.lg .name { font-size: clamp(1rem,2vw,1.8rem); }
.board.lg .score { font-size: clamp(2rem,5vw,4.5rem); }
```
Дефолт `md` — существующие вызовы (Pult, прочие) не меняются.

### `web/src/play/App.svelte`

**п.9 — скорость реакции до новой карточки.** Сейчас `queueWithMs` (506–512) показывается только
в ветке открытого вопроса (`{:else}` при `currentPrompt`). После правок reducer очередь живёт и в
PICKING (нет currentPrompt) → нужно показать её и в «ждущей» ветке. В блок
`{:else if !state?.currentPrompt}` (465–466, «Ждём ведущего») добавить вывод `queueWithMs`
(тот же шаблон `.queue`), если массив непуст.

**п.11 — красный неверный (планшет).** Ветка `FINAL_REVEAL` (435–461): `myRevealRow` (90–100)
дополнить `verdict: (final.verdicts ?? {})[myTeamId]`. В карточке вскрытия добавить строку статуса:
```svelte
{#if myRevealRow.verdict !== undefined}
  <div class="reveal-row-item">
    <span class="reveal-label">Результат:</span>
    <span class="reveal-val" class:ok={myRevealRow.verdict} class:err={!myRevealRow.verdict}>
      {myRevealRow.verdict ? '✓ Верно' : '✗ Неверно'}
    </span>
  </div>
{/if}
```
CSS: `.reveal-val.ok { color: var(--ok); } .reveal-val.err { color: var(--err); }`.
(Игрок видит вердикт только своей команды — `verdicts` приходит per-socket в reveal-фазе, ок.)

---

## Рекомендуемый порядок (TDD, отдельной сессией)

1. **Домен/тесты** (без UI): `f1Schedule` (8), buzzQueue в reducer (1/9), `PLAYER_KICKED` (10),
   `final.verdicts` (11). Прогон `npm test`.
2. **Протокол/тесты**: `toHostState` скрытие текста (2), `roster` (4), `verdicts` в финал-блоке (11),
   `kicked` в `ServerToClient` (10). Прогон `npm test`.
3. **Gateway**: `kickPlayer` (10). Прогон.
4. **Фронтенд host**: Pult (1,2,6), Lobby (3,10), socket.ts `kicked` (10).
5. **Фронтенд board**: (4,5,7,9,11) + Scoreboard `size`.
6. **Фронтенд play**: (9,11).
7. Сборка `npm --prefix web run build`, прогон E2E при наличии, ручная проверка по `docs/run.md`.

## Открытые мелочи / на что смотреть
- п.9: после переноса очистки buzzQueue на `QUESTION_SELECTED` проверить аукцион/кота — там
  `AUCTION_WON`/`CAT_ASSIGNED` сами выставляют `buzzQueue=[{…}]`; повторного выбора там нет, ок.
- п.2: проверить, что для special-вопросов панель аукциона/кота появляется по `currentSpecial`
  (он теперь всегда не-null у ведущего) — баг «ведущий не видит, что это спец» не должен возникнуть.
- п.10: простой кик — повторный вход возможен как новый игрок (по согласованию). Если позже
  понадобится бан — добавить set забаненных clientToken в gateway, проверять в `join`.
