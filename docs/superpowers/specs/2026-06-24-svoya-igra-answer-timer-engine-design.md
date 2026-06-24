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

**Когда стартует/перезапускается отсчёт — признак «новый ход ответа» = смена
`answeringIndex`:**

| Переход | `answeringIndex` | Таймер |
|---|---|---|
| Первый базз `BUZZER_OPEN→ANSWERING` | `-1 → 0` | старт |
| Смена лидера в окне сбора (антиснайп) | `0 → 0` | **не перезапускаем** (якорь на первый базз) |
| «Неверно»/таймаут → следующий | `0 → 1` (растёт) | перезапуск |
| Аукцион выигран / «Кот» назначен | `→ 0` | старт |

То есть `newState.answeringIndex !== prevState.answeringIndex && phase==='ANSWERING'` —
единственный триггер авто-старта/перезапуска. Окно сбора (idx не меняется) дедлайн не
сбрасывает.

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

`ANSWER_TIMED_OUT` и ветка `correct:false` в `ANSWER_JUDGED` делят **общий helper**
перехода (`nextAnsweringIndex` + штраф + установка фазы) — без дублирования. Исход
таймаута — **−цена** (как «Неверно»); в UI на факте таймаута показываем «Время вышло».

**Поля `GameState`** (`src/domain/types.ts`, инициализация в `state.ts`):
- `answerTimerSec: number` (из `GAME_CREATED`; дефолт 45);
- `answerDeadline: number | null` — серверный epoch-ms истечения, либо `null`;
- `answerPausedRemainingMs: number | null` — заморожённый остаток на паузе.

`answerDeadline` и `answerPausedRemainingMs` сбрасываются в `null` при выходе из
`ANSWERING`: `ANSWER_JUDGED` (correct), переход в `JUDGED` (очередь исчерпана),
`QUESTION_CLOSED`, `ROUND_ENDED`, `GAME_ENDED`.

---

## 4. Серверный планировщик и восстановление (`gateway.ts`, `index.ts`)

Вся «живость» в gateway; reducer чист.

- **Карта таймеров:** `Map<gameId, NodeJS.Timeout>` в замыкании `attachGateway`.
- **`syncAnswerTimer(io, deps, gameId, state)`** — вызывается после каждого
  `broadcastState`:
  - `phase==='ANSWERING' && answerDeadline!=null`:
    - `remaining = answerDeadline − Date.now()`;
    - `remaining ≤ 0` → аппенд `ANSWER_TIMED_OUT { teamId: answeringTeamId }`, ребродкаст
      (идемпотентно: если фаза/отвечающий уже сменились — пропуск);
    - иначе, если таймер для `gameId` не стоит → `setTimeout(remaining)`.
  - иначе (пауза или не-`ANSWERING`) → `clearTimeout` + удалить из карты.
- **setTimeout-колбэк:** аппендит `ANSWER_TIMED_OUT` с **защитой от повторного входа**
  (фаза всё ещё `ANSWERING`, дедлайн в прошлом, `answeringTeamId` совпадает), затем
  `broadcastState` + `syncAnswerTimer` — что автоматически заводит таймер следующей
  команды (смена `answeringIndex` → `ANSWER_TIMER_STARTED`).
- **Авто-старт/перезапуск (триггер варианта A):** обёртка в `hostAction`/`playerBuzz`
  сравнивает `answeringIndex` до/после доменного аппенда; сменился и фаза `ANSWERING` →
  аппенд `ANSWER_TIMER_STARTED { deadline: Date.now() + answerTimerSec*1000 }`. Все ветки
  завершаются `broadcastState` → `syncAnswerTimer`.
- **Восстановление после рестарта:** на старте сервера (`index.ts`, после `attachGateway`)
  берём активную игру из `active_game` (синглтон SP3), `loadState`, вызываем
  `syncAnswerTimer`: дедлайн в будущем → перевзвод `setTimeout`; в прошлом → немедленный
  `ANSWER_TIMED_OUT`.
- **Бэкфилл снэпшота** (`eventStore.loadState`):
  `state = snap ? { ...initialState(), ...JSON.parse(snap.state) } : initialState()` —
  новые поля не теряются на снэпшотах, снятых до деплоя.

---

## 5. Контракт состояния для клиентов (`protocol.ts`)

`PublicState` (и наследник `HostState`) получают:
- `answerTimerSec: number` — номинал (чип «Ответ N с»);
- `answerDeadline: number | null` — серверный epoch-ms истечения;
- `answerPausedRemainingMs: number | null` — остаток на паузе;
- `serverNow: number` — снимок `Date.now()` на момент бродкаста.

Клиент при получении state:
`baseRemaining = (answerDeadline ?? (serverNow + (answerPausedRemainingMs ?? 0))) − serverNow`,
далее локальный отсчёт от `performance.now()` (LAN-латентность пренебрежимо мала); на
паузе показываем `answerPausedRemainingMs` статично. Порог **«мало времени» `≤10с`**
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
- Смена `answeringIndex` рождает `ANSWER_TIMER_STARTED`; окно сбора — нет.
- `timerPause`/`timerResume`/`timerReset` — корректные события и guard'ы.
- `syncAnswerTimer` взводит/чистит `setTimeout`; колбэк-таймаут идемпотентен (нет двойного
  `ANSWER_TIMED_OUT`).
- Восстановление: `loadState` с дедлайном в прошлом → немедленный таймаут; в будущем →
  перевзвод.
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
