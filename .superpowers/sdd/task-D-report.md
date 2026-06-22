# Task D Report — Player Screen (room list, name entry, team choice, resume)

## Flows implemented

### A. No `?game=` — Room List
- `onMount` fetches `GET /api/games` → array of `{gameId,title,phase}`.
- Each room renders as a button `«{title} ({phase})»`; `phase === 'GAME_END'` rooms are shown at 45% opacity.
- Empty list shows «Нет активных игр».
- Click navigates `location.href = '/play?game=' + gameId`.

### B. `?game=<id>` present — Join form
- `onMount` calls `connect()` then `GET /api/games/${gameId}/exists`.
- If not exists → «Игра не найдена» placeholder.
- **Resume:** localStorage key `svoya:player` → `{gameId,firstName,lastName,teamId}`. If `stored.gameId === gameId` and game exists, `joinAs(...)` is called immediately; `joined = true` is set without waiting for `youAre` (server reclaims via clientToken). `pendingJoin` flag is still raised so `youAre` will update stored `teamId` once the server responds.
- **Join form (no resume):** Фамилия + Имя inputs both required (trim). Team section: `<select>` for existing teams OR free-text «Название команды» for new team (mutually exclusive by precedence — non-empty `newTeamName` wins). `isValidTeamName` client-validates new name; server errors shown in red via `$lastError`. On `youAre`: teamId from `$me.teamId` is persisted, `joined = true`.

### C. `joined === true` — Existing play view
- Unchanged: Buzzer for BUZZER_OPEN/ANSWERING (not-my-turn), «ВЫ ОТВЕЧАЕТЕ!», «ВЫБИРАЙТЕ ВОПРОС», currentPrompt, «Ждём ведущего…».

## Store / socket additions
- `web/src/lib/store.ts`: added `export const me = writable<{playerId,teamId,role}|null>(null)`.
- `web/src/lib/socket.ts`: imported `me`; added `socket.on('youAre', (m:any) => me.set(m))` in `connect()`.

## Self-review checklist
- Both names required: YES — `if (!fn || !ln)` guard with inline hint before any emit.
- Client + server validation for new team name: YES — `isValidTeamName` on client; `$lastError` (appError) surfaces server rejections.
- Resume auto-joins only when stored gameId matches AND game exists: YES — checked in order: `exists && stored.gameId === gameId`.
- teamId persisted from `$me`: YES — `localStorage.setItem` runs inside `$: if ($me && pendingJoin)` reactive block using `$me.teamId`.
- `state?.…` guarded: YES — `state?.teams ?? []`, `state?.phase`, `state?.answeringTeamId`, `state?.pickingTeamId`, `state?.currentPrompt`.

## Build result
- `cd web && npm run build` — clean, 0 errors. play chunk: 9.65 kB (gzip 4.30 kB).

## Backend suite result
- `npx vitest run src tests` — 22 test files, 92 tests, all passed.

## Files modified
- `web/src/lib/store.ts` — added `me` writable
- `web/src/lib/socket.ts` — import `me`, add `youAre` handler
- `web/src/play/App.svelte` — full rewrite with room list, resume, join form, play view

## Concerns
- Teams `<select>` may be empty on first open (before any player has joined the socket and before the server broadcasts state). This is expected behaviour — the player can still create a new team. If the server broadcasts initial state upon socket connect (before join), it will populate automatically once socket is live. No fix needed.
- Room list has no auto-refresh; the user must reload to see newly created games.
