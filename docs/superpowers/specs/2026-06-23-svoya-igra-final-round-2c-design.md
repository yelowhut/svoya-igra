# Стадия 2c — Финальный раунд — дизайн

Дата: 2026-06-23
Статус: согласован, готов к написанию плана
Под-проект: 2 «Редактор паков», стадия 2c (после 2b-core).

> **Связь со спеками.** Финал был помечен «вне области» в 2b
> (`docs/superpowers/specs/2026-06-23-svoya-igra-pack-editor-2b-builder-design.md`,
> «Корректировки 2026-06-23», п.7) и вынесен сюда как самостоятельная вертикальная фича.
> Это первое расширение движка после SP1: спек 2b декларировал «движок не меняется» — 2c
> это **сознательно нарушает**, добавляя фазы финала.

## Цель

Добавить в игру **финальный раунд** по модели ТВ-шоу «Своя игра»: вычёркивание тем →
тайные ставки → тайные ответы → вскрытие на экране с верификацией ведущим. Фича проходит
через все слои: формат пака, движок, realtime, UI host/board/player и конструктор (2b).

## Объём и стадирование

- **2c-core** — формат пака (`final`-раунд), фазы движка + события, realtime-протокол,
  UI host/board/player, концепт капитана, конструктор финала в Builder. Минимально
  играбельный финал «собрал в конструкторе → сыграл до победителя».
- Без под-стадий: финал бессмысленен по частям (нельзя сыграть половину фазы).

## Предусловие — капитан команды

Сейчас в модели (`src/domain/types.ts`) у команды есть игроки, но капитана нет. Финал
требует «одна команда = одна отправка», поэтому вводим **капитана**:

- В `Team` добавляется `captainPlayerId: string | null`.
- Назначение капитана — **в Host UI** перед стартом финала (ведущий выбирает игрока из
  команды). Дефолт-кандидат для удобства — первый присоединившийся игрок команды, но
  ведущий может переназначить. Если капитан отключился — ведущий назначает другого.
- Только капитан видит органы управления финалом в Player UI; остальные игроки команды
  видят статус («ваш капитан делает ставку…»).

Это затрагивает зону лобби/команд (SP1), но изменение точечное (одно поле + событие
`CAPTAIN_ASSIGNED` + UI выбора в Host).

## Формат пака — расширение

Раунд получает признак типа. Обратная совместимость: отсутствие поля = `normal`.

```jsonc
{
  "name": "Финал",
  "type": "final",          // "normal" (по умолчанию) | "final"
  "themes": [               // только для type=final; вместо "categories"
    {
      "name": "Тема финала",
      "question": {         // ровно один вопрос на тему
        "type": "text",     // text | image | audio
        "prompt": "…",
        "media": "media/x.jpg",
        "answer": "…"
        // value/special в финале НЕ используются — играем на ставку
      }
    }
  ]
}
```

- `gameJsonSchema` (`src/packs/schema.ts`) расширяется: дискриминированное объединение
  раунда по `type`. Для `normal` — текущая `categories`-форма (без изменений). Для `final`
  — `themes` (≥2, чтобы было что вычёркивать), у темы ровно один `question`.
- `docs/pack-format.md` дополняется разделом про финал.
- Финал в паке **опционален и единственен**: 0 или 1 финал-раунд, обычно последним. На
  движок «нет финала» = игра заканчивается после последнего `normal`-раунда (как сейчас).

## Движок — новые фазы и события

### Фазы (`Phase` в `types.ts`)

Добавляются между `ROUND_END` последнего обычного раунда и `GAME_END`:

- `FINAL_INTRO` — показ всех тем финала.
- `FINAL_ELIMINATION` — капитаны по очереди вычёркивают темы; **беднейший ходит первым**,
  по кругу, пока не останется одна тема. Команды со счётом ≤ 0 в финале **не участвуют**
  (не ходят в вычёркивании, не ставят, не отвечают).
- `FINAL_BETTING` — каждый участвующий капитан вводит тайную ставку **0..текущий счёт**.
  Ставка **лочится при отправке** (вопрос ещё не показан — иначе ставку подгонят).
- `FINAL_QUESTION` — показ вопроса оставшейся темы + таймер. Капитан вводит ответ,
  **свободно правит**, кнопка **«Готово»** фиксирует досрочно. Когда **все** участвующие
  нажали «Готово» → таймер останавливается, переход к вскрытию. По истечении таймера —
  авто-фиксация текущего текста.
- `FINAL_REVEAL` — **все ответы команд выводятся на board**; ведущий по очереди открывает
  ставку+ответ и судит **Правильно/Неправильно** (ручная верификация — авто-сравнение
  строк ненадёжно из-за опечаток). Верно → ставка прибавляется, неверно → вычитается.
- `GAME_END` — победитель по счёту.

### Состояние (`GameState`)

Добавляется блок финала (или вложенный объект `final`):
```ts
final: {
  themeIds: string[];          // оставшиеся темы (стартово все)
  eliminationOrder: string[];  // teamId по возрастанию счёта на входе в финал
  eliminationTurnIndex: number;
  bets: Record<string, number>;          // teamId -> ставка (после лока)
  answers: Record<string, { text: string; locked: boolean }>;
  revealIndex: number;         // прогресс вскрытия по командам
} | null
```

### События (`src/domain/events.ts`)

`FINAL_STARTED`, `CAPTAIN_ASSIGNED`, `FINAL_THEME_REMOVED` (themeId, byTeamId),
`FINAL_BET_PLACED` (teamId, amount), `FINAL_ANSWER_UPDATED` (teamId, text) —
не-секретное хранение только для капитана/ведущего, на board не транслируется до reveal,
`FINAL_ANSWER_LOCKED` (teamId), `FINAL_REVEALED`, `FINAL_ANSWER_JUDGED` (teamId, correct).
Event-sourcing, отдельных таблиц не нужно.

**Тайна на стороне сервера.** Ставки и ответы до `FINAL_REVEAL` не попадают в
board/player-проекции чужих команд (`toPublicState`); капитан видит только своё. Это
серверный фильтр, не клиентский — иначе ответы утекут в трафик.

## Realtime-протокол

Новые клиент→сервер сообщения: `finalRemoveTheme`, `finalPlaceBet`, `finalUpdateAnswer`,
`finalLockAnswer` (от капитана, валидируются на принадлежность к команде капитана и фазу);
host→сервер: `assignCaptain`, `finalReveal`, `finalJudge`. Серверная валидация: чужой
игрок/не капитан/не своя фаза → отклоняется.

## UI

### Board (проектор)
- `FINAL_INTRO`/`FINAL_ELIMINATION`: сетка тем; вычеркнутые — зачёркнуты/затемнены; чья
  очередь вычёркивать — подсветка.
- `FINAL_BETTING`: «команды делают ставки», индикатор «кто уже поставил» (без сумм).
- `FINAL_QUESTION`: вопрос оставшейся темы + таймер; «кто уже готов».
- `FINAL_REVEAL`: ответы всех команд списком; по мере судейства — ✓/✗, ставка, новый счёт.
- `GAME_END`: победитель.

### Host (ведущий)
- Кнопка «Начать финал»; назначение/переназначение капитанов.
- Управление фазами (старт ставок, старт вопроса/таймера, переход к вскрытию).
- Экран вскрытия: по команде — ставка, ответ, **эталонный `answer`**, кнопки
  Правильно/Неправильно.

### Player (капитан)
- `FINAL_ELIMINATION`: в свой ход — список тем, тап «вычеркнуть».
- `FINAL_BETTING`: числовой ввод ставки 0..счёт (клиентская + серверная валидация),
  «Сделать ставку» (лочит).
- `FINAL_QUESTION`: текстовое поле ответа + «Готово».
- Не-капитаны команды: статус-экран без органов управления.

### Конструктор финала (Builder, 2b-кодовая база)
- В «Список раундов» — добавить **финал-раунд** (один на игру).
- Финал-раунд редактируется не сеткой цен, а списком **тем**: «+ Тема» → имя темы +
  перетащить один вопрос из банка (тип любой). Минимум 2 темы (иначе нечего вычёркивать).
- Лайв-валидация финала: ≥2 тем, у каждой назначен вопрос, медиа существует (как в 2b).
- Flatten финала: тема → `{ name, question }` в `themes`; снапшот имени темы и контента
  вопроса; копирование медиа — как в 2b.

## Strict-валидация публикации (дополнение к 2b)

- Финал-раунд: `type=final`, ≥2 тем, у каждой темы назначен `questionId`, вопрос
  существует в банке, для `image`/`audio` медиа-файл физически присутствует.
- Финал в игре не более одного.

## Тестирование

Движок (основной фокус):
- Фазовый автомат финала: порядок вычёркивания (беднейший первый, по кругу до одной темы);
  команды со счётом ≤0 исключены; лок ставки; «все готовы → reveal» и авто-фиксация по
  таймеру; начисление по судейству (верно +ставка / неверно −ставка); переход в `GAME_END`.
- Серверная тайна: ставки/ответы чужих команд не попадают в проекции до `FINAL_REVEAL`.
- Валидация realtime: не-капитан/чужая команда/не та фаза → отклонено.

Формат/пак:
- Расширенная `gameJsonSchema` принимает `final`-раунд и отвергает вырожденный (<2 тем,
  тема без вопроса); обратная совместимость `normal`-раундов без поля `type`.
- Flatten финала из шаблона: темы, снапшот, копирование медиа.

Клиент: smoke-тесты валидатора финала в конструкторе; визуальная проверка фаз финала
через Playwright (board/host/player) по проектному правилу.

## Затрагиваемые файлы (ориентир)

Движок/домен:
- `src/domain/types.ts` — `Phase` (фазы финала), `GameState.final`, `Team.captainPlayerId`.
- `src/domain/events.ts` — события финала + `CAPTAIN_ASSIGNED`.
- `src/domain/engine/reducer.ts` — редьюсеры фаз финала.
- `src/domain/engine/reducer.final.test.ts` (новый).

Пак/схема:
- `src/packs/schema.ts` — дискриминированный раунд `normal`/`final`.
- `src/packs/templateSchema.ts` (из 2b) — flatten финала.

Realtime/HTTP:
- `src/realtime/protocol.ts` — проекции с фильтром тайны; новые сообщения.
- `src/realtime/gateway.ts` — обработчики финала, валидация капитана/фазы.

Веб:
- `web/src/board`, `web/src/host`, `web/src/player` — экраны фаз финала, назначение
  капитана, ввод ставки/ответа.
- `web/src/admin/` (Builder) — редактор финал-раунда (темы вместо сетки цен).

Документация:
- `docs/pack-format.md` — раздел про финал; `docs/run.md` — как играть финал.

## Вне области (2c)

- Несколько финал-раундов в одной игре.
- Авто-проверка текстового ответа (всегда ручная верификация ведущим).
- Командный ввод не-капитаном (только капитан; fallback-ввод ведущим — backlog).
- Анимации/звук вскрытия сверх базовой подачи.

---

# Ревизия 2026-06-25 — приведение к текущему коду + закрытие архитектурных развилок

Дата ревизии: 2026-06-25
Статус: согласован (brainstorming-сессия 2026-06-25), готов к написанию плана.

> **Зачем ревизия.** Исходный дизайн (выше) согласован 2026-06-23 и концептуально остаётся
> в силе: модель ТВ-финала (вычёркивание → тайные ставки → тайные ответы → вскрытие с
> ручной верификацией) и концепт капитана **не меняются**. Но с 23.06 кодовая база ушла
> вперёд: волна баззер-редизайна (F1-старт, `revealed`, `ROUND_RESET`, `questionResults`,
> `roundScoreLog`), engine-таймер ответа, SP3 (удалён `web/src/host/App.svelte` — опыт
> ведущего переехал в `web/src/admin/sections/{Lobby,Pult}.svelte`). Карта «затрагиваемые
> файлы» в исходном дизайне устарела, а шесть архитектурных точек он называл одной строкой,
> не закрывая. Эта секция: (1) обновляет карту под текущий код, (2) фиксирует решения по
> шести развилкам, (3) добавляет матрицу видимости. **При расхождении приоритет у этой секции.**

## Актуальная карта кода (что реально есть сейчас)

- **Фазы** (`src/domain/types.ts:31`): `LOBBY | ROUND_INTRO | PICKING | QUESTION |
  BUZZER_ARMED | BUZZER_OPEN | ANSWERING | JUDGED | ROUND_END | GAME_END`. Фазы финала
  добавляются между `ROUND_END` и `GAME_END`.
- **`Team`** (`src/domain/types.ts:17`): `{ id, name, score }` — **капитана нет**, добавляем.
- **`GameState`** не знает общего числа раундов; `roundIndex` — просто счётчик.
  `totalRounds` вычисляется на сервере из пака (`packRow.data.rounds.length`). Игра **не
  заканчивается автоматически** после последнего раунда — переход в `GAME_END` только через
  host-action `endGame` (`gateway.ts`) или переиздание/удаление пака (`templates.ts`).
- **Reducer** (`src/domain/engine/reducer.ts`) чист, без эффектов; хелпер `nextAttempt`
  (штраф −value + сдвиг очереди + сброс таймер-полей) — общий для «Неверно» и таймаута.
  Эффекты (broadcast, setTimeout, persistence) — в `gateway.ts`.
- **engine-таймер ответа**: поля `answerTimerSec/answerDeadline/answerPausedRemainingMs` в
  `GameState`; чистая `answerTimerDecision(state, now)` жёстко гард `phase==='ANSWERING'`;
  оркестрация `syncAnswerTimer` + приватная `Map<gameId, {timeout, deadline}>` в gateway;
  события `ANSWER_TIMER_STARTED/PAUSED/RESUMED` + `ANSWER_TIMED_OUT`.
- **Проекции** (`src/realtime/protocol.ts`): `toPublicState` (игрок+табло, одинаковая,
  без `currentAnswer`, без `players`) и `toHostState` (+`currentAnswer`, +`players`).
  Рассылка `broadcastState` (`gateway.ts`) — `io.to('game:{gid}:player'|':board'|':host')`.
  **Per-team фильтрации сейчас нет** — все игроки получают идентичный `PublicState`.
- **Сокет-протокол**: c→s `join/rejoin/createTeam/hostAction/playerBuzz`; s→c
  `state/youAre/goSignal/blocked/appError`. host-действия идут через
  `hostAction{action,data}` с гардом `role==='host'`.
- **Схема пака** (`src/packs/schema.ts`): `roundSchema = { name, categories[] }` — признака
  типа раунда нет. **`Pack`-домен** (`types.ts`): `Round = { id, name, categories[] }`.
- **Шаблон** (`src/packs/templateTypes.ts`): `TemplateRound = { id, name, columns[], rows[] }`
  (сетка). Валидация `templateValidate.ts` (13 Problem kinds), flatten `templateFlatten.ts`,
  portable `templatePortable.ts` (zod `svoya-game-template@1`). Клиент-зеркало
  `web/src/admin/lib/templateValidate.ts`.
- **UI ведущего**: `Pult.svelte` диспетчит по `phase` (if/switch по `gameStore.phase`),
  шлёт `hostAction(...)`. `Lobby.svelte` — настройка/команды/чип таймера.
- **UI игрока**: `web/src/play/App.svelte` диспетчит по `phase`, `me={playerId,teamId,role}`.
- **Табло**: `web/src/board/App.svelte` диспетчит по `phase`.
- **Конструктор**: `Builder.svelte` (список) → `builder/{GameEditor,RoundGrid,SourceSidebar,
  QuestionPicker}.svelte`. `GameEditor` уже умеет табы раундов.

> Замечание: Explore-разведка ошибочно предложила фазу «FINAL_THEME_PICKING» (выбор темы для
> игры). Это **не** наша модель — у нас **вычёркивание** тем (`FINAL_ELIMINATION`), как в
> исходном дизайне. Игнорировать.

## Закрытие шести архитектурных развилок

### Р1. Механизм приватности проекций — **per-socket emit в фазах финала**

Per-team rooms отклонены (нужно управлять членством при смене команды). Решение: в
`broadcastState` добавить ветку «фаза финала?». Вне финала — без изменений (rooms-рассылка).
В фазах финала (`FINAL_*`):
- **board** и **host** — рассылка по своим rooms как сейчас (host видит всё через
  `toHostState`, board — публичную проекцию **без** ставок/ответов до reveal).
- **player** — НЕ массовый emit в room. Итерируем подключённые player-сессии
  (`SessionRegistry` знает `socketId` + `playerId` → `teamId`), для каждой строим
  `toPlayerFinalState(state, pack, viewerTeamId)` (маскирует чужие ставки/ответы) и
  `socket.to(socketId).emit('state', …)`. Новая чистая проекция в `protocol.ts`.
- До `FINAL_REVEAL` ставки/ответы **чужих** команд в player-проекцию не попадают; на
  `FINAL_REVEAL` маска снимается (все ответы/ставки видны всем — это и есть вскрытие).

### Р2. Правка текста ответа — **state-хранение + клиентский дебаунс, без потока событий**

`FINAL_ANSWER_UPDATED{teamId,text}` остаётся событием, но клиент капитана шлёт его
**дебаунсом ~1000мс** (+принудительный flush на blur и на «Готово»). Reducer кладёт
`state.final.answers[teamId] = { text, locked:false }`. Это держит event-log в разумных
рамках (≤~60 событий на команду за вопрос) и гарантирует, что форс-лок по таймеру знает
последний текст. `FINAL_ANSWER_LOCKED{teamId}` ставит `locked:true` (финальный текст —
последний из `answers`). Per-keystroke событий нет.

### Р3. Таймер финала — **отдельный механизм, параллельный engine-таймеру** (решение пользователя)

Не расширяем `answerTimerDecision` (другая семантика таймаута: не штраф, а форс-лок всех
незалоченных ответов). Вводим:
- Поля в блоке финала: `final.answerDeadline: number|null`,
  `final.answerPausedRemainingMs: number|null`; номинал `final.answerTimerSec`.
- **Номинал настраивается ведущим в лобби** (решение пользователя), по образцу
  `answerTimerSec`: степпер/пресеты в `Lobby.svelte`, едет в `GAME_CREATED.payload` как
  `finalAnswerTimerSec`, кламп на сервере в `POST /api/games` (диапазон 30–300, дефолт **60**).
  Reducer кладёт его в `final.answerTimerSec` при инициализации блока на `FINAL_STARTED`.
- Чистая `finalTimerDecision(state, now)` (гард `phase==='FINAL_QUESTION'`), по образцу
  `answerTimerDecision`, но `kind:'timeout'` → форс-лок незалоченных + переход к `FINAL_REVEAL`.
- Отдельная `Map<gameId, {timeout, deadline}>` и `syncFinalTimer` в gateway (близнец
  `syncAnswerTimer`); восстановление при рестарте — как у engine-таймера.
- События `FINAL_TIMER_STARTED/PAUSED/RESUMED` + `FINAL_TIMED_OUT`. Управление ведущим:
  host-actions `finalTimerPause/Resume/Reset` (по аналогии с `timerPause/Resume/Reset`).
- «Все капитаны нажали Готово» → таймер останавливается, переход к `FINAL_REVEAL` (досрочно).

### Р4. Schema-дискриминатор — **`z.union` + optional `type`, обратная совместимость**

`z.discriminatedUnion` требует обязательного `type` и сломал бы старые паки. Решение:
`normalRoundSchema` с `type: z.literal('normal').optional()` (отсутствие = normal) и
`finalRoundSchema` с `type: z.literal('final')`; `roundSchema = z.union([normal, final])`.
Старый пак без `type` валиден как normal. Аналогично — `Round`-домен и portable-схема.

### Р5. Триггер финала — **host-action `startFinal`, оркестрация в gateway, не reducer**

Reducer не знает пак. Решение: после `ROUND_ENDED` последнего **обычного** раунда `Pult`
показывает «Начать финал» (если в паке есть `type:'final'`-раунд) **или** «Завершить игру»
(иначе — как сейчас). host-action `startFinal` валидируется в gateway (последний раунд,
финал существует, ещё не игрался) → событие `FINAL_STARTED` → reducer переходит в
`FINAL_INTRO` и инициализирует `state.final`. Проверка «есть ли финал» живёт в gateway/UI.

### Р6. Тай-брейк порядка вычёркивания — **порядок создания команд**

`eliminationOrder` — по возрастанию счёта; при равных счётах порядок стабилен по индексу
команды в `state.teams` (= порядок создания). Одна детерминированная сортировка.

## Матрица видимости (кто что видит в каждой фазе)

Абсолютная тайна ставок/ответов до `FINAL_REVEAL` — **в т.ч. от ведущего** (host видит
ставки/ответы только на вскрытии, вместе с эталоном). Это безопаснее и проще проекций.

| Фаза | board (проектор) | host (ведущий) | captain (своя команда) | teammate (не капитан) |
|---|---|---|---|---|
| `FINAL_INTRO` | все темы | все темы + «Начать вычёркивание» | все темы | все темы |
| `FINAL_ELIMINATION` | темы; вычеркнутые затемнены; подсветка чьей очереди | то же + кто ходит | в свой ход — список тем + «вычеркнуть»; иначе статус | статус «идёт вычёркивание» |
| `FINAL_BETTING` | «команды делают ставки» + кто **уже поставил** (без сумм) | кто уже поставил (без сумм) | ввод своей ставки 0..счёт + «Сделать ставку» (лочит) | статус «капитан ставит» |
| `FINAL_QUESTION` | **вопрос оставшейся темы + таймер + «кто готов»** | вопрос + **эталонный ответ** + таймер + кто готов + пауза/сброс | поле ответа (свободная правка) + «Готово» | статус «капитан отвечает» |
| `FINAL_REVEAL` | ответы всех команд; по мере суда ✓/✗ + ставка + новый счёт | по командам: ставка, ответ, **эталон**, кнопки Правильно/Неправильно | свой результат | результат своей команды |
| `GAME_END` | победитель | победитель | победитель | победитель |

Команды со счётом **≤ 0** на входе в финал не участвуют: не в `eliminationOrder`, не ставят,
не отвечают; их экран — наблюдательный статус.

## Обновлённая карта «затрагиваемые файлы» (заменяет раздел исходного дизайна)

**Движок/домен:**
- `src/domain/types.ts` — фазы финала в `Phase`; `Team.captainPlayerId: string|null`;
  блок `GameState.final` (см. ниже); поля `Round` (тип раунда + `themes`).
- `src/domain/events.ts` — события финала (см. ниже) + `CAPTAIN_ASSIGNED`.
- `src/domain/engine/reducer.ts` — редьюсеры фаз финала; инициализация `state.final` на
  `FINAL_STARTED`; форс-лок на `FINAL_TIMED_OUT`.
- `src/domain/engine/finalTimer.ts` (новый) — чистая `finalTimerDecision(state, now)`.
- `src/domain/engine/reducer.final.test.ts`, `finalTimer.test.ts` (новые).
- `src/domain/engine/state.ts` — `initialState`: `final: null`, бэкфилл снэпшота.

**Блок `GameState.final` (уточнён):**
```ts
final: {
  themeIds: string[];                    // оставшиеся темы (стартово все)
  eliminationOrder: string[];            // teamId по возрастанию счёта, тай-брейк = порядок team
  eliminationTurnIndex: number;
  bets: Record<string, number>;          // teamId -> ставка (после лока)
  answers: Record<string, { text: string; locked: boolean }>;
  revealIndex: number;                   // прогресс вскрытия
  answerTimerSec: number;                // дефолт 60
  answerDeadline: number | null;
  answerPausedRemainingMs: number | null;
} | null
```

**События финала:** `FINAL_STARTED`, `CAPTAIN_ASSIGNED{teamId,playerId}`,
`FINAL_THEME_REMOVED{themeId,byTeamId}`, `FINAL_BET_PLACED{teamId,amount}`,
`FINAL_ANSWER_UPDATED{teamId,text}` (дебаунс, не на board до reveal),
`FINAL_ANSWER_LOCKED{teamId}`, `FINAL_TIMER_STARTED{deadline}`,
`FINAL_TIMER_PAUSED{remainingMs}`, `FINAL_TIMER_RESUMED{deadline}`,
`FINAL_TIMED_OUT{}`, `FINAL_REVEALED{}`, `FINAL_ANSWER_JUDGED{teamId,correct}`.

**Пак/схема:**
- `src/packs/schema.ts` — `z.union` normal/final (Р4); `parseGameJson` присваивает UID темам.
- `src/packs/templateTypes.ts` — `TemplateRound` как union: сетка ИЛИ
  `{ type:'final', themes: { id, name, questionId|null }[] }`; `makeDefaultTemplate` без изм.
- `src/packs/templateValidate.ts` (+клиент-зеркало) — Problem kinds финала:
  `final-too-few-themes` (<2), `final-theme-no-question`, `final-theme-bad-question`,
  `final-theme-missing-media`, `final-multiple` (>1 финала в игре).
- `src/packs/templateFlatten.ts` — ветка финала: тема → `{name, question}` в `themes`,
  снапшот контента, копирование медиа (как для сетки).
- `src/packs/templatePortable.ts` — portable-схема + round union (Р4).
- `docs/pack-format.md` — раздел про финал.

**Realtime/HTTP:**
- `src/realtime/protocol.ts` — `toPlayerFinalState(state,pack,viewerTeamId)`; фильтр тайны;
  таймер-поля финала в проекциях.
- `src/realtime/gateway.ts` — ветка финал-фаз в `broadcastState` (per-socket, Р1); host-actions
  `startFinal/assignCaptain/finalReveal/finalJudge/finalTimerPause/Resume/Reset`; player-actions
  `finalRemoveTheme/finalPlaceBet/finalUpdateAnswer/finalLockAnswer` (валидация капитан+фаза+
  принадлежность); `syncFinalTimer` + `Map` (Р3); восстановление таймера финала на старте.

**Веб:**
- `web/src/admin/sections/Lobby.svelte` — настройка `finalAnswerTimerSec` (степпер/пресеты,
  дефолт 60, диапазон 30–300) рядом с `answerTimerSec`; едет в `createGame`.
- `web/src/admin/sections/Pult.svelte` — ветки фаз финала: назначение капитанов, управление
  фазами (старт вычёркивания/ставок/вопроса), экран вскрытия (ставка/ответ/эталон/суд),
  пауза/сброс таймера финала.
- `src/http/server.ts` (`POST /api/games`) — приём+кламп `finalAnswerTimerSec` (30–300);
  `src/domain/events.ts` `GAME_CREATED.payload` +`finalAnswerTimerSec`; `web/src/admin/store.ts`
  +стор `finalAnswerTimerSec`; `web/src/admin/gameApi.ts` — передача поля.
- `web/src/play/App.svelte` — ветки фаз финала для капитана (вычеркнуть/ставка/ответ+Готово)
  и не-капитана (статус); счёт-нижняя плашка переиспользуется.
- `web/src/board/App.svelte` — ветки фаз финала (темы/вычёркивание/ставят/вопрос+готовность/
  вскрытие/победитель).
- `web/src/admin/sections/builder/` — новый `FinalRoundEditor.svelte` (список тем + выбор
  вопроса из банка через существующий `QuestionPicker`, ≥2 тем) вместо `RoundGrid` для
  финал-раунда; `GameEditor` — добавление финал-раунда (один на игру) в табы.

**Документация:** `docs/pack-format.md` (финал), `docs/run.md` (как играть финал).

## Стадирование реализации

Как и в исходном дизайне — **без под-стадий** (финал не играбелен по частям). Естественный
порядок задач плана: формат+схема+валидация+flatten → домен (типы/события/reducer/finalTimer)
→ realtime (проекции тайны + gateway + таймер) → UI (board/player/host) → конструктор
(FinalRoundEditor) → E2E (Playwright, фазы финала) + докуменация. Реализация — subagent-driven
(как все стадии 2*), финальное ревью opus, Docker-гейт + Playwright по проектному правилу.
