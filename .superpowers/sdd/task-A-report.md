# Task A Report — Domain additions for team management

## TDD Evidence

### RED Phase
Ran `npx vitest run src/domain/teamName.test.ts src/domain/engine/reducer.teams.test.ts` **before** implementation:
- `teamName.test.ts`: FAIL — `Failed to load url ./teamName.js` (file did not exist)
- `reducer.teams.test.ts`: FAIL — 3 tests failed (PLAYER_MOVED, TEAM_DELETED), 4 passed (tests that hit `default:` no-op in reducer, plus TEAM_RENAMED also silently fell to default)
  - `PLAYER_MOVED изменяет teamId игрока`: expected 't2', got 't1'
  - `TEAM_DELETED удаляет команду`: expected length 1, got 2
  - TypeScript event types TEAM_RENAMED/TEAM_DELETED/PLAYER_MOVED did not exist yet → tests that used them silently fell to default branch

### GREEN Phase
After implementation: all 21 new tests passed.

## Files Changed / Created

| File | Action | Description |
|------|--------|-------------|
| `src/domain/events.ts` | edited | Added `TEAM_RENAMED`, `TEAM_DELETED`, `PLAYER_MOVED` to `GameEvent` union |
| `src/domain/engine/reducer.ts` | edited | Added 3 new `case` branches before `default` |
| `src/domain/teamName.ts` | created | Pure `isValidTeamName(name: string): boolean` validator |
| `src/domain/teamName.test.ts` | created | 14 tests: 6 valid, 8 invalid cases |
| `src/domain/engine/reducer.teams.test.ts` | created | 7 tests: rename, move, delete, no-op variants, non-mutation |

## Test Results

### New tests: 21/21 passed
```
✓ src/domain/teamName.test.ts (14 tests)
✓ src/domain/engine/reducer.teams.test.ts (7 tests)
```

### Full suite: 80/80 passed (20 test files)
Previously 59 tests; 21 new tests added. All existing tests remain green.

## Self-Review

- Events added in the correct location (alongside existing team/player events).
- Reducer branches use `structuredClone`-protected copy `s` — mutations are safe (no input mutation).
- TEAM_RENAMED: no-op if team not found ✓
- TEAM_DELETED: filter approach — does not touch players (as specified) ✓
- PLAYER_MOVED: no-op if player not found ✓
- `isValidTeamName`: exact regex from spec, length check on trimmed value ✓
- ESM `.js` import extensions used in test imports ✓
- No concerns. Implementation matches spec exactly.
