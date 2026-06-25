# Стадия 2b-ext — Экспорт/импорт шаблона игры — дизайн

Дата: 2026-06-25
Статус: согласован, готов к написанию плана
Под-проект: 2 «Редактор паков», стадия 2b-ext (после 2b-core, влитого в `main`).

> **Связь со stage-спеком 2b.** Это продолжение `docs/superpowers/specs/2026-06-23-svoya-igra-pack-editor-2b-builder-design.md`
> (раздел «Экспорт / импорт шаблона (2b-ext)» и строки `export`/`import` в таблице API).
> Здесь зафиксированы решения brainstorming-сессии 2026-06-25, уточняющие формат файла и
> поведение импорта. При расхождении приоритет у этого документа.

## Цель

Дать перенос **компоновки игры** (сетка, цены столбцов, теги мини-игр, ссылки на вопросы
банка по UID) между установками одним файлом: кнопка «Скачать шаблон» на экране игры и
«Импортировать шаблон» в списке игр. Это отдельная ветка переноса, **не связанная** с
экспортом банка (2a) и с публикацией.

Контекст: 2b-core реализован и влит в `main` — таблица `game_templates` (JSON-blob),
`src/persistence/templateRepo.ts`, типы `src/packs/templateTypes.ts`, лайв-валидация
(серверная `src/packs/templateValidate.ts` + клиентское зеркало `web/src/lib/templateValidate.ts`),
flatten `src/packs/templateFlatten.ts`, роуты `src/http/templates.ts`, UI
`web/src/admin/sections/Builder.svelte` (список игр) + `builder/GameEditor.svelte`.

## Ключевое решение: две независимые ветки переноса

Контент и медиа живут **в банке**; шаблон игры — **только компоновка со ссылками на банк
по UID**. Поэтому перенос разведён:

- **Банк (2a)** — `bank.zip`, несёт категории/вопросы/контент **и медиа-файлы**, мёрджится
  по UID на импорте.
- **Шаблон игры (этот документ)** — `*.game.json`, несёт **только** структуру и UID-ссылки,
  **без медиа и без контента вопросов**.

Следствие: чтобы перенести игру целиком на другую установку, переносят **обе** ветки —
сначала банк (медиа приедет с ним), потом шаблон. Если на целевой машине нужного банка нет,
шаблон импортируется, но ячейки с неразрешёнными UID помечаются невалидными (см. «Импорт»).
Самодостаточный пакет «шаблон + срез банка + медиа» рассмотрен и **отклонён** — не нужен при
раздельном переносе банка.

## Формат файла

Простой JSON, расширение `.game.json`, с маркером формата (для дружелюбной ошибки при
загрузке не того файла):

```json
{
  "format": "svoya-game-template@1",
  "title": "Моя игра",
  "rounds": [
    {
      "id": "...", "name": "Раунд 1",
      "columns": [ { "id": "...", "value": 100 } ],
      "rows": [
        {
          "id": "...", "categoryId": "<bank-category-UID|null>",
          "cells": [ { "columnId": "...", "questionId": "<bank-question-UID|null>", "special": "none|auction|cat" } ]
        }
      ]
    }
  ]
}
```

Тело = текущий документ `GameTemplate` (`src/packs/templateTypes.ts`) **минус**
`lastPublishedPackId`, **плюс** поле `format`. `categoryId`/`questionId` — UID банка (это и
есть суть ссылочной модели). Внутренние id (раунд/столбец/строка/ячейка) — обычные
doc-локальные UUID.

## Серверный слой

### `src/packs/templatePortable.ts` (новый)

Чистый модуль, без обращений к БД/ФС:

- `PORTABLE_FORMAT = 'svoya-game-template@1'` — константа маркера.
- zod-схема портативного формата (зеркало `templateTypes`: `format`-литерал, `title`,
  `rounds[]` с `columns`/`rows`/`cells`, `special` enum, `value` int).
- `toPortable(doc: GameTemplate): Portable` — выкидывает `id` и `lastPublishedPackId`,
  проставляет `format`. (Внутренние id раундов/столбцов/строк/ячеек сохраняются.)
- `fromPortable(json: unknown, idGen = crypto.randomUUID): GameTemplate` — zod-парсит
  (ошибка формата/структуры → throw), присваивает **новый** top-level `id`, возвращает
  `GameTemplate` без `lastPublishedPackId`. Внутренние id оставляет как в файле (они
  doc-локальны, межфайловых коллизий нет; повторный импорт одного файла даёт два независимых
  документа).

### Роуты в `src/http/templates.ts` (за `requireAdmin`)

| Метод | Путь | Поведение |
|---|---|---|
| GET | `/api/game-templates/:id/export` | `getTemplate` → 404 если нет; `toPortable`; ответ с заголовком `Content-Disposition: attachment; filename="<title>.game.json"` (имя файла санитайзится — небезопасные/не-ASCII символы заменяются, фолбэк `template.game.json`), тело — JSON. |
| POST | `/api/game-templates/import` | `multipart/form-data`, поле `file`; читает текст, `JSON.parse` (битый → 400), `fromPortable` (не тот формат/структура → 400 с понятным текстом); вставка нового документа в `game_templates` (переиспользуем существующую запись `INSERT`, как в `createTemplate`, но с готовым doc); ответ `{ id }`. |

Импорт **не** резолвит UID банка и **не** валидирует ссылки — мягкая инвалидация выполняется
лайв-валидацией при открытии шаблона.

`templateRepo.ts`: добавить `insertTemplate(db, doc: GameTemplate)` (вставка готового
документа; `createTemplate` рефакторится поверх него: `insertTemplate(db, makeDefaultTemplate(...))`).

Multipart уже подключён в проекте (используется загрузкой медиа банка `src/http/bankMedia.ts` /
`bank.ts` import) — переиспользуем тот же механизм чтения файла; новых зависимостей нет.

## Клиентский слой

### `web/src/admin/templateApi.ts`

- `templateExportUrl(id)` → строка `/api/game-templates/<id>/export` для прямой навигации
  (кука `svoya_admin` уйдёт с запросом, браузер скачает файл по `Content-Disposition`).
- `importTemplate(file: File): Promise<{ id: string }>` — `FormData` с полем `file`, POST на
  `/api/game-templates/import` (зеркало `importBank` из `bankApi.ts`).

### UI

- **`builder/GameEditor.svelte`** — в панель действий шапки добавить кнопку **«Скачать
  шаблон»**: `<a href={templateExportUrl(doc.id)} download>` (или программная навигация).
  Перед скачиванием — **flush debounced-PUT** (как перед «Опубликовать»/«Сыграть тестовую»),
  чтобы экспортнулся актуальный черновик, а не предыдущий.
- **`Builder.svelte`** (список игр) — кнопка **«Импортировать шаблон»**: скрытый
  `<input type="file" accept=".json,application/json">` → `importTemplate(file)` → обновить
  список → открыть импортированный шаблон (перейти в редактор по `{id}`). Ошибку импорта
  (400) показать инлайн (стиль ошибок как в Base/Builder, без `alert`).

## Тестирование

Сервер (основной фокус):

- `templatePortable.test.ts`: `toPortable` выкидывает `id`+`lastPublishedPackId` и ставит
  `format`; `fromPortable` присваивает новый `id`, не несёт `lastPublishedPackId`; round-trip
  `fromPortable(toPortable(doc))` структурно эквивалентен (кроме `id`); `fromPortable`
  бросает на битом JSON-объекте, на чужом `format`, на сломанной структуре.
- Роуты (`templates.test.ts`): export опубликованного шаблона **не** содержит
  `lastPublishedPackId`, ставит `Content-Disposition`; export несуществующего → 404; import
  валидного файла создаёт документ и возвращает новый `id`, отличный от исходного; import
  битого/чужого файла → 400; **import шаблона со ссылкой на отсутствующий в банке UID
  всё равно создаёт документ** (валидация отложена); оба роута за `requireAdmin` (401 без
  куки).

Клиент: 1 smoke по желанию (`importTemplate` шлёт FormData на верный путь).

Playwright (по проектному правилу): на живом контейнере — кнопка «Скачать шаблон» отдаёт
файл; «Импортировать шаблон» поднимает игру в списке и открывает редактор.

## Затрагиваемые файлы

Сервер:
- `src/packs/templatePortable.ts` (новый) — формат + `toPortable`/`fromPortable` + zod.
- `src/persistence/templateRepo.ts` — `insertTemplate`; `createTemplate` поверх него.
- `src/http/templates.ts` — роуты `export`/`import`.

Веб:
- `web/src/admin/templateApi.ts` — `templateExportUrl` + `importTemplate`.
- `web/src/admin/sections/builder/GameEditor.svelte` — кнопка «Скачать шаблон» (+ flush).
- `web/src/admin/sections/Builder.svelte` — кнопка «Импортировать шаблон» + инлайн-ошибка.

Документация:
- `docs/run.md` — короткий абзац про перенос шаблона (и что медиа едет банком).

## Вне области

- Перенос медиа/контента вопросов внутри шаблона (идёт банком 2a).
- Самодостаточный пакет «шаблон + срез банка».
- Мастер пере-привязки висящих UID (ручная пере-привязка через существующий пикер достаточна).
- ZIP-импорт чужого пака движка обратно в редактор (плохо ложится на ссылочную модель;
  уже вне области 2b).
- Регенерация внутренних id на импорте (не нужна — id doc-локальны).
