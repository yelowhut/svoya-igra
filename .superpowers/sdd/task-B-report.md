# Task B Report — Команды и список игр

## TDD Evidence

### RED phase
- `src/realtime/gateway.teams.test.ts` written first: 8 tests, all failed (timeout/assertion) before implementation.
- `src/http/server.test.ts` extended with `GET /api/games` test: failed with 404 before implementation.

### GREEN phase
All tests pass after implementation. No test modifications needed.

## Gateway Changes (`src/realtime/gateway.ts`)

- **Import added**: `isValidTeamName` from `../domain/teamName.js`.
- **`join` handler**: Extended payload type to include `newTeamName?: string; teamId?: string`. For `role === 'player'`:
  - If `newTeamName` is non-empty: validates via `isValidTeamName`; if invalid → `socket.emit('error', { message: 'Недопустимое имя команды' })` and return (no bind, no join, no broadcast). If valid → appends `TEAM_CREATED` with `crypto.randomUUID()` teamId and trimmed name, uses that teamId as `effectiveTeamId`.
  - If `teamId` provided: uses it as `effectiveTeamId`.
  - If neither: `socket.emit('error', { message: 'Выберите или создайте команду' })` and return.
  - Error paths return before `joinedGame` assignment, session bind, room join, and broadcast.
  - `youAre` emits `effectiveTeamId` (the newly-created team's id for the `newTeamName` path).
- **`createTeam` hardened**: validates `isValidTeamName(d.name)` before appending; emits error and returns if invalid; trims name on success.
- **New `hostAction` cases** (inside host role-gate):
  - `renameTeam`: validates name → error or appends `TEAM_RENAMED { teamId, name.trim() }`.
  - `deleteTeam`: checks `st.players.some(p => p.teamId === d.teamId)` → error or appends `TEAM_DELETED { teamId }`.
  - `movePlayer`: appends `PLAYER_MOVED { playerId, teamId }`.
  - Error paths `return` before `broadcastState`.

## HTTP Change (`src/http/server.ts`)

- `GET /api/games` route added before `GET /api/games/:gameId/exists`.
- Queries `events` table for all `GAME_CREATED` events ordered by `seq ASC`.
- Parses title from each event's payload JSON.
- Computes `phase` via `deps.store.loadState(gameId).phase`.
- Returns `Array<{ gameId, title, phase }>`.

## Test Results

### Targeted (`gateway.teams.test.ts` + `server.test.ts`)
- 11 tests, 11 passed, clean exit.

### Full suite (`src tests`)
- 21 test files, **89 tests passed** (was 80), clean exit in 823ms.
- +8 gateway team tests, +1 HTTP games list test.

## Self-Review

- **Server-side name validation**: `isValidTeamName` is called in gateway on both `newTeamName` join path and all team-name host actions (`createTeam`, `renameTeam`). Client cannot bypass; invalid names are rejected before any event is appended.
- **Delete-if-empty enforced**: `deleteTeam` checks `st.players.some(p => p.teamId === d.teamId)` against current state loaded at top of `hostAction`. If any player belongs to the team, error is emitted and no `TEAM_DELETED` event is appended.
- **Error paths don't leak**: All error paths `return` before appending events and before `broadcastState`, so state remains unchanged.

## Files Changed

- `src/realtime/gateway.ts` — extended join + new hostAction cases + createTeam hardening
- `src/http/server.ts` — `GET /api/games` route
- `src/realtime/gateway.teams.test.ts` — new test file (8 tests)
- `src/http/server.test.ts` — extended with `GET /api/games` test
