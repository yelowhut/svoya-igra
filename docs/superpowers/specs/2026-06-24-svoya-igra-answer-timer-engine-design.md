# Engine-таймер ответа — дизайн

> Движковая механика «Таймер ответа», отложенная из SP3. Цель: серверно-авторитетный
> обратный отсчёт на время, пока команда отвечает (фаза `ANSWERING`); по истечении —
> команде засчитывается **неверный ответ** (−цена), ход переходит следующей в очереди.
> Затрагивает движок (`reducer`/`types`/`events`/event-store), gateway, protocol и три
> клиентских экрана. Антифальстарт и дедуп «одно самое быстрое нажатие на команду»
> **сохраняются без изменений**.

Дата: 2026-06-24. Стек и текущее состояние — память `svoya-igra-status`,
`docs/ui-design-brief.md`. Дизайн-эталон — `docs/design_handoff_svoya_igra/`
(прототип `Своя игра - Студия.dc.html`, скриншоты `screenshots/`, токены README §8).
SP3-резерв таймера (`answerTimerSec` в `web/src/admin/store.ts`, степпер/пресеты в Лобби,
статичный чип в Пульте) — оживляется этим спеком.

---

## 1. Скоуп

**Входит:**
1. Обратный отсчёт на фазе `ANSWERING` — везде, где команда отвечает: обычный buzzer,
   победитель **аукциона**, получатель **«Кота»**.
2. По таймауту — **штраф −цена** (эквивалент кнопки «Неверно»), ход следующей команде в
   очереди; если очередь исчерпана → `JUDGED`.
3. Серверно-авторитетный отсчёт, переживающий рестарт сервера.
4. Отображение отсчёта всем трём ролям (ведущий / отвечающая команда / наблюдатели +
   табло).
5. Ручные органы ведущего: **пауза / возобновление / сброс** (рестарт на полный номинал).
6. Проводка номинала `answerTimerSec` из Лобби в создаваемую игру (`GAME_CREATED`).

**Не входит:**
- Таймер «времени на размышление» в `BUZZER_OPEN` (никто не нажал → авто-закрытие вопроса).
  Отсчёт только на `ANSWERING`; buzzer-open остаётся как есть (магента «ЖМУ, кто быстрее»,
  сбор очереди по реакции).
- Изменение антифальстарт-логики и дедупа нажатий по команде — **не трогаем**.
- «+время» как отдельный орган (только пауза/возобновление/сброс; сброс = полный номинал).

---

## 2. Жёсткие рамки (из устройства движка)

- Reducer **чистый**, история событийная, снэпшот+реплей. Дедлайн **обязан жить в
  `GameState`**; wall-clock (`Date.now()`) попадает в состояние **только через payload
  событий** (как существующий `goSignal.serverTime`). `setTimeout` — эффект в gateway,
  который лишь *аппендит* событие; факт истечения фиксируется событием.
- При рестарте сервера `setTimeout` в памяти теряется → восстановление опирается на
  дедлайн **из состояния** (реплей + перевзвод таймера на старте).

**Когда идёт «новый ход ответа» (концептуально, для понимания — реализация в §4
state-driven, не диффингом):**

| Переход | `answeringIndex` | Отсчёт |
|---|---|---|
| Первый базз `BUZZER_OPEN→ANSWERING` | `-1 → 0` | старт |
| Смена лидера в окне сбора (антиснайп) | `0 → 0` | **не перезапускаем** (якорь на первый базз) |
| «Неверно»/таймаут → следующий | `0 → 1` (растёт) | новый отсчёт |
| Аукцион выигран / «Кот» назначен | `→ 0` | старт |

Соответствие «новый ход» ↔ смена `answeringIndex` точно (антиснайп-якорь — idx `0→0`).
Но **триггером реализации диффинг индекса быть не может**: `ANSWER_TIMED_OUT` аппендится из
`setTimeout`-колбэка мимо обёртки `hostAction`/`playerBuzz`, и диф там не выполнился бы →
следующая команда осталась бы без таймера. Поэтому старт выражен **инвариантом состояния**
(§4): `phase==='ANSWERING' && answerDeadline==null && answerPausedRemainingMs==null` →
завести отсчёт. Этот инвариант сам даёт нужное поведение во всех строках таблицы, а
антиснайп-якорь сохраняется, т.к. в окне сбора `answerDeadline` уже не-`null`.

---

## 3. Событийная модель (вариант A — выделенные таймер-события)

Выбран **вариант A**: gateway после доменного аппенда, увидев смену `answeringIndex`,
аппендит отдельное `ANSWER_TIMER_STARTED`. Доменные события остаются чистыми от wall-clock;
вся временна́я логика в одном месте; пауза/возобновление и так требуют своих событий.

Отклонены: **B** (расширить payload 4 доменных событий полем `deadline` — связывает
wall-clock с доменом, ломает `BUZZ_RECORDED` в окне сбора); **C** (эфемерный серверный
таймер без события — ломает реплей и восстановление после рестарта).

**4 новых события** (`src/domain/events.ts`):

| Событие | payload | Reducer |
|---|---|---|
| `ANSWER_TIMER_STARTED` | `{ deadline: number }` | `answerDeadline=deadline; answerPausedRemainingMs=null` |
| `ANSWER_TIMER_PAUSED` | `{ remainingMs: number }` | `answerPausedRemainingMs=remainingMs; answerDeadline=null` |
| `ANSWER_TIMER_RESUMED` | `{ deadline: number }` | `answerDeadline=deadline; answerPausedRemainingMs=null` |
| `ANSWER_TIMED_OUT` | `{ teamId: string }` | как «Неверно»: `score−=currentValue`, `lastJudgedTeamId=teamId`, переход к следующему/`JUDGED`, сброс таймер-полей |

`GAME_CREATED.payload` += `answerTimerSec: number`.

**Общий helper перехода к следующей попытке** (`nextAttempt`), используемый и веткой
`correct:false` в `ANSWER_JUDGED`, и `ANSWER_TIMED_OUT`:
1. `score −= currentValue`, `lastJudgedTeamId = teamId`;
2. `nextAnsweringIndex` → следующий индекс или `null`;
3. установка фазы (`ANSWERING` со следующим индексом, либо `JUDGED`);
4. **безусловный сброс** `answerDeadline = null; answerPausedRemainingMs = null`.

Сброс (4) **безусловен** и не привязан к выходу из `ANSWERING`: при `correct:false → next`
фаза остаётся `ANSWERING`, но старый дедлайн обязан обнулиться, иначе он «протухает» от
прошлой попытки. Это инвариант **состояния**, а не control-flow — новый отсчёт заводится
отдельным state-driven шагом (§4), не этим helper'ом. Цена берётся из `s.currentValue`
(в payload `ANSWER_TIMED_OUT` только `{ teamId }`). Исход таймаута — **−цена** (как
«Неверно»); в UI на факте таймаута показываем «Время вышло».

**Поля `GameState`** (`src/domain/types.ts`, инициализация в `state.ts`):
- `answerTimerSec: number` (из `GAME_CREATED`; дефолт 45);
- `answerDeadline: number | null` — серверный epoch-ms истечения, либо `null`;
- `answerPausedRemainingMs: number | null` — заморожённый остаток на паузе.

Оба таймер-поля обнуляются (`null`) при выходе из `ANSWERING` (`ANSWER_JUDGED` correct,
переход в `JUDGED`, `QUESTION_CLOSED`, `ROUND_ENDED`, `GAME_ENDED`) **и** в helper'е
`nextAttempt` (переход `correct:false → next`, остаётся в `ANSWERING`).

**Защитные инварианты reducer (пояс-и-подтяжки, не зависят от gateway-гардов):**
- `ANSWER_TIMED_OUT` при `phase !== 'ANSWERING'` или `teamId !==
  buzzQueue[answeringIndex]?.teamId` — **no-op** (идемпотентность при гонке колбэка).
- `GAME_CREATED`: `s.answerTimerSec = payload.answerTimerSec ?? 45` — реплей старых событий
  без поля не даёт `undefined` (риск низкий из-за single-active-game, но страховка дешёвая).
- `ANSWER_TIMER_PAUSED`/`RESUMED` вне `ANSWERING` — no-op.

---

## 4. Серверный планировщик и восстановление (`gateway.ts`, `index.ts`)

Вся «живость» в gateway; reducer чист. **Старт отсчёта — state-driven, а не диффинг
индекса.** Единственный инвариант покрывает все входы (первый базз, переход после judge,
переход после таймаута, аукцион, «Кот», рестарт): если игра в `ANSWERING` без активного и
без приостановленного отсчёта — заводим отсчёт. Антиснайп-якорь сохраняется сам собой: в
окне сбора `answerDeadline` уже не-`null`, условие старта не срабатывает (idx 0→0 ничего
не трогает).

- **Карта таймеров:** `Map<gameId, NodeJS.Timeout>` в замыкании `attachGateway`.
- **`syncAnswerTimer(io, deps, gameId, state)`** — вызывается после **каждого**
  `broadcastState`. Ровно одно действие за вызов; цикл «аппенд → бродкаст → повторный
  sync» самостабилизируется (см. ниже):
  1. `phase !== 'ANSWERING'` → `clearTimer(gameId)`; **return**.
  2. `answerPausedRemainingMs != null` (пауза) → `clearTimer(gameId)`; **return**.
  3. `answerDeadline == null` (**нужно стартовать**) → аппенд
     `ANSWER_TIMER_STARTED { deadline: Date.now() + answerTimerSec*1000 }`;
     `broadcastState` → `syncAnswerTimer` (повторно); **return**.
  4. `answerDeadline != null`:
     - `answerDeadline <= Date.now()` (**истёк**) → `teamId = buzzQueue[answeringIndex]?.teamId`;
       если `teamId == null` (пустая очередь / отрицательный индекс) → **return** (no-op);
       иначе аппенд `ANSWER_TIMED_OUT { teamId }`; `broadcastState` → `syncAnswerTimer`;
       **return**.
     - иначе (**идёт**) → если для `gameId` ещё нет `setTimeout` → поставить
       `setTimeout(answerDeadline − Date.now())`, положить в карту; **return**.
- **`setTimeout`-колбэк:** удаляет свою запись из карты, делает `loadState(gameId)` и зовёт
  `syncAnswerTimer`. Сам колбэк решений не принимает — вся логика в (4): на момент
  срабатывания `answerDeadline <= now` → аппендится `ANSWER_TIMED_OUT`. **Null-safe гард
  гонки с паузой:** условие истечения именно `answerDeadline != null && answerDeadline <=
  now`, поэтому пауза, прошедшая между постановкой и срабатыванием (дедлайн уже `null`),
  ложного таймаута не даёт — ветка (2) уйдёт в `clearTimer`.
- **Самостабилизация (один-два уровня рекурсии).** Каждый аппенд в (3)/(4) сдвигает
  состояние к стабильному: (3) ставит дедлайн → повторный sync попадает в (4-идёт) и
  взводит `setTimeout`; (4-истёк) аппендит `ANSWER_TIMED_OUT` → reducer сбрасывает дедлайн и
  переходит к следующему/`JUDGED` → повторный sync либо (3) заводит новый отсчёт следующей
  команды, либо (1) чистит таймер. Глубина ограничена (каждый шаг — либо терминальный
  переход, либо null→set), зацикливания нет.
- **Восстановление после рестарта:** на старте сервера (`index.ts`, после `attachGateway`)
  берём активную игру из `active_game` (синглтон SP3), `loadState`, вызываем
  `syncAnswerTimer`. Все случаи покрыты тем же инвариантом: `ANSWERING` без дедлайна (упали
  сразу после `ANSWER_TIMED_OUT`) → (3) заведёт отсчёт; дедлайн в будущем → (4) перевзвод;
  в прошлом → (4) немедленный `ANSWER_TIMED_OUT`; на паузе → (2) ничего не взводит.
- **Бэкфилл снэпшота** (`eventStore.loadState`):
  `state = snap ? { ...initialState(), ...JSON.parse(snap.state) } : initialState()` —
  новые поля не теряются на снэпшотах, снятых до деплоя.

> **Замечание по варианту A.** Диффинг `answeringIndex` (исходная редакция §2) — лишь
> *концептуальное* обоснование «когда новый ход». Реализуется он **не** сравнением индексов
> в обёртке `hostAction`/`playerBuzz` (тогда `ANSWER_TIMED_OUT` из колбэка прошёл бы мимо и
> следующая команда осталась без таймера), а инвариантом (3) выше. Сам `ANSWER_TIMER_STARTED`
> по-прежнему отдельное событие — суть варианта A сохранена.

---

## 5. Контракт состояния для клиентов (`protocol.ts`)

`PublicState` (и наследник `HostState`) получают:
- `answerTimerSec: number` — номинал (чип «Ответ N с»);
- `answerDeadline: number | null` — серверный epoch-ms истечения;
- `answerPausedRemainingMs: number | null` — остаток на паузе;
- `serverNow: number` — снимок `Date.now()` на момент бродкаста.

Клиент при получении state, **в этом порядке**:
1. `answerPausedRemainingMs != null` → показываем его **статично** (пауза), отсчёт стоит;
2. иначе `answerDeadline != null` → `baseRemaining = answerDeadline − serverNow`, далее
   локальный отсчёт от `performance.now()` (LAN-латентность пренебрежимо мала);
3. иначе таймера нет.

Пауза проверяется **раньше** дедлайна намеренно (на паузе `answerDeadline == null`, и
соблазн «сперва читать дедлайн» дал бы пустой экран). Порог **«мало времени» `≤10с`**
переключает число на красный/крупный по прототипу. Все комнаты (`player`/`board`/`host`)
уже получают `state` — отдельный публичный канал не нужен.

---

## 6. Host-actions (`gateway.ts`)

Новые `hostAction` (LAN-доверие, как остальные host-actions):
- `timerPause` → `ANSWER_TIMER_PAUSED { remainingMs: answerDeadline − Date.now() }`
  (только если идёт: `answerDeadline!=null`);
- `timerResume` → `ANSWER_TIMER_RESUMED { deadline: Date.now() + answerPausedRemainingMs }`
  (только если на паузе: `answerPausedRemainingMs!=null`);
- `timerReset` → `ANSWER_TIMER_STARTED { deadline: Date.now() + answerTimerSec*1000 }`
  (рестарт на полный номинал; допустим и из паузы).

Существующие `playerBuzz` (антифальстарт `validateBuzz`/эскалация бана) и `BUZZ_RECORDED`
(дедуп по `teamId` + min-реакция — «одно самое быстрое нажатие на команду», команды разного
размера) **не изменяются**.

---

## 7. Экраны и копирайт (по прототипу)

- **Игрок-отвечающий** (зелёный круг): «ВЫ ОТВЕЧАЕТЕ!», число `timeLeft`
  (Oswald gold `#f5c518` → red `#ff6b6b` при low-time), «секунд на ответ — говорите вслух!».
- **Игрок-наблюдатель:** «ОТВЕЧАЕТ {Команда}», «осталось N с»; забаззившим, но не текущим —
  плашка «Вы в очереди · #{поз}».
- **Табло `/board`:** «ОТВЕЧАЕТ {Команда}» + крупный `timeLeft` (54/66px).
- **Ведущий (Пульт):** квадрат-бейдж с числом + подпись «секунд на ответ. На нуле ответ не
  засчитан — ход следующему в очереди» + ✓Верно/✗Неверно; **добавляем** мелкие кнопки
  **Пауза / ▶ / Сброс** рядом с бейджем (новый UI поверх прототипа). Чип «Ответ N с» в шапке
  Пульта берёт `answerTimerSec` из `state`.
- **Копирайт-правка:** на факте таймаута показываем «Время вышло» (исход — −цена); ожидающая
  подпись остаётся прототипной «…не засчитан».
- Анимация кольца — существующий `pulseRing` / `prefers-reduced-motion` дизайн-фундамента.

---

## 8. Настройка `answerTimerSec` (проводка SP3-резерва)

- `GAME_CREATED.payload` += `answerTimerSec`; reducer пишет `s.answerTimerSec`.
- `POST /api/games` принимает `answerTimerSec` (дефолт 45, кламп 10–120) и проносит в
  `GAME_CREATED`.
- Лобби: значение из `answerTimerSec`-стора (степпер/пресеты 30/45/60, SP3) **подключается**
  в тело запроса создания игры (сейчас клиентское, никуда не уходит).
- Пульт: чип берёт `answerTimerSec` из `state`, а не из клиентского стора.

---

## 9. Тестирование и верификация

**Reducer (vitest, корень):**
- `ANSWER_TIMER_STARTED/PAUSED/RESUMED` — мутации полей.
- `ANSWER_TIMED_OUT` — `−value`, переход к следующему / `JUDGED`, сброс таймер-полей;
  идентичность исхода ветке `ANSWER_JUDGED` correct=false.
- Сброс таймер-полей на `JUDGED` / `QUESTION_CLOSED` / `ROUND_ENDED` / `GAME_ENDED`.
- `GAME_CREATED` пишет `answerTimerSec`.
- Неизменность антиснайпа: `BUZZ_RECORDED` в окне сбора держит `answeringIndex` (idx 0→0).

**Gateway (vitest, корень):**
- **State-driven старт:** `syncAnswerTimer` в `ANSWERING` без дедлайна/паузы аппендит
  `ANSWER_TIMER_STARTED`; в окне сбора (дедлайн уже стоит) — нет.
- **Блокер-регрессия (обязательно):** после `ANSWER_TIMED_OUT` при **непустой** остаточной
  очереди аппендится новый `ANSWER_TIMER_STARTED` и `setTimeout` взводится для следующей
  команды (именно этот тест ловит исходный разрыв колбэк-vs-обёртка).
- `timerPause`/`timerResume`/`timerReset` — корректные события и guard'ы; пауза очищает
  `setTimeout`, не давая ложного таймаута (гонка дедлайн-`null`).
- `syncAnswerTimer` взводит/чистит `setTimeout`; колбэк-таймаут идемпотентен (нет двойного
  `ANSWER_TIMED_OUT`); пустая очередь / отрицательный индекс → no-op.
- Восстановление: `loadState` с дедлайном в прошлом → немедленный таймаут; в будущем →
  перевзвод; в `ANSWERING` без дедлайна (упали после `ANSWER_TIMED_OUT`) → старт нового.
- Регрессия: антифальстарт, дедуп-по-команде, force-завершение игр не сломаны.

**Web unit (vitest из `web/`):** маппинг `answerDeadline`/`serverNow` → `timeLeft`; порог
low-time; заморозка на паузе; чип берёт `answerTimerSec` из `state`.

**Playwright E2E — обязательный гейт на пересобранном Docker (:3000):**
- `docker compose up -d --build`.
- Полный путь: buzzer → ответ → **таймаут** → следующая команда (свежий отсчёт) → −цена;
  пауза/возобновление ведущим; спец-вопрос («Кот») с таймаутом → `JUDGED`.
- Попиксельная сверка экранов `ANSWERING` (ведущий / игрок-отвечающий / табло) с
  прототипными скринами `docs/design_handoff_svoya_igra/screenshots/`. Расхождения — в
  отчёт.

---

## 10. Открытые решения для этапа плана

- Точная величина low-time порога (по умолчанию `≤10с`) и поведение на `0` (показывать `0`
  до прихода `ANSWER_TIMED_OUT`-state).
- Нужен ли «+время» сверх пауза/возобновление/сброс (по умолчанию — нет).
- Формат `serverNow` vs. явный clock-offset handshake (по умолчанию — `serverNow` в каждом
  state, клиент считает от `performance.now()`; для LAN достаточно).
