import { describe, it, expect } from 'vitest';
import { validateFinalAction } from './gateway.js';
import { initialState } from '../domain/engine/state.js';
import type { GameState } from '../domain/types.js';

// -----------------------------------------------------------------------
// Helpers для создания состояний финал-раунда
// -----------------------------------------------------------------------

/** Состояние в FINAL_ELIMINATION: 3 команды B, C, D; B — капитан pB, C — pC, D — pD.
 *  eliminationOrder = ['B','C','D'], turnIndex = 0 → ход команды B.
 */
function finalEliminationState(): GameState {
  return {
    ...initialState(),
    phase: 'FINAL_ELIMINATION',
    teams: [
      { id: 'B', name: 'Команда Б', score: 200, captainPlayerId: 'pB' },
      { id: 'C', name: 'Команда В', score: 150, captainPlayerId: 'pC' },
      { id: 'D', name: 'Команда Г', score: 100, captainPlayerId: 'pD' },
    ],
    players: [
      { id: 'pB', clientToken: 'tB', firstName: 'B', lastName: 'B', teamId: 'B', connected: true },
      { id: 'pC', clientToken: 'tC', firstName: 'C', lastName: 'C', teamId: 'C', connected: true },
      { id: 'pD', clientToken: 'tD', firstName: 'D', lastName: 'D', teamId: 'D', connected: true },
    ],
    final: {
      themeIds: ['t1', 't2', 't3'],
      eliminationOrder: ['B', 'C', 'D'],
      eliminationTurnIndex: 0, // ход B
      bets: {},
      answers: {},
      revealIndex: 0,
      answerDeadline: null,
      answerPausedRemainingMs: null,
    },
  };
}

/** Состояние в FINAL_BETTING: те же 3 команды, все в eliminationOrder. */
function finalBettingState(): GameState {
  return {
    ...finalEliminationState(),
    phase: 'FINAL_BETTING',
    final: {
      themeIds: ['t1'],
      eliminationOrder: ['B', 'C', 'D'],
      eliminationTurnIndex: 3, // устранение окончено
      bets: {},
      answers: {},
      revealIndex: 0,
      answerDeadline: null,
      answerPausedRemainingMs: null,
    },
  };
}

/** Состояние в FINAL_QUESTION: те же 3 команды. */
function finalQuestionState(): GameState {
  return {
    ...finalBettingState(),
    phase: 'FINAL_QUESTION',
    final: {
      themeIds: ['t1'],
      eliminationOrder: ['B', 'C', 'D'],
      eliminationTurnIndex: 3,
      bets: { B: 50, C: 100, D: 75 },
      answers: {},
      revealIndex: 0,
      answerDeadline: Date.now() + 60000,
      answerPausedRemainingMs: null,
    },
  };
}

/** Вернуть playerId капитана команды teamId из состояния. */
function captainOf(s: GameState, teamId: string): string {
  return s.teams.find(t => t.id === teamId)!.captainPlayerId!;
}

// -----------------------------------------------------------------------
// Тесты validateFinalAction
// -----------------------------------------------------------------------

describe('validateFinalAction — removeTheme', () => {
  it('отклонён, если не капитан', () => {
    const s = finalEliminationState();
    expect(validateFinalAction(s, 'removeTheme', 'someoneElse', { themeId: 't1' }).ok).toBe(false);
  });

  it('отклонён не в свой ход (капитан C пытается в ход B)', () => {
    const s = finalEliminationState(); // turnIndex=0 → ход B
    expect(validateFinalAction(s, 'removeTheme', captainOf(s, 'C'), { themeId: 't1' }).ok).toBe(false);
  });

  it('принят от капитана B в свой ход', () => {
    const s = finalEliminationState(); // turnIndex=0 → ход B
    const r = validateFinalAction(s, 'removeTheme', captainOf(s, 'B'), { themeId: 't1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.teamId).toBe('B');
  });

  it('отклонён вне фазы FINAL_ELIMINATION', () => {
    const s = finalBettingState();
    expect(validateFinalAction(s, 'removeTheme', captainOf(s, 'B'), { themeId: 't1' }).ok).toBe(false);
  });

  it('отклонён, если игрок не в eliminationOrder', () => {
    const s = finalEliminationState();
    // Сделаем команду B капитаном, но уберём из eliminationOrder
    const modified: GameState = {
      ...s,
      final: { ...s.final!, eliminationOrder: ['C', 'D'], eliminationTurnIndex: 0 },
    };
    expect(validateFinalAction(modified, 'removeTheme', captainOf(s, 'B'), { themeId: 't1' }).ok).toBe(false);
  });
});

describe('validateFinalAction — placeBet', () => {
  it('принят от капитана в FINAL_BETTING', () => {
    const s = finalBettingState();
    const r = validateFinalAction(s, 'placeBet', captainOf(s, 'B'), { amount: 50 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.teamId).toBe('B');
  });

  it('отклонён вне FINAL_BETTING', () => {
    expect(
      validateFinalAction(finalEliminationState(), 'placeBet', captainOf(finalEliminationState(), 'B'), { amount: 50 }).ok
    ).toBe(false);
  });

  it('отклонён, если не капитан', () => {
    const s = finalBettingState();
    expect(validateFinalAction(s, 'placeBet', 'unknownPlayer', { amount: 50 }).ok).toBe(false);
  });
});

describe('validateFinalAction — updateAnswer', () => {
  it('принят от капитана в FINAL_QUESTION', () => {
    const s = finalQuestionState();
    const r = validateFinalAction(s, 'updateAnswer', captainOf(s, 'C'), { text: 'мой ответ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.teamId).toBe('C');
  });

  it('отклонён вне FINAL_QUESTION', () => {
    const s = finalBettingState();
    expect(validateFinalAction(s, 'updateAnswer', captainOf(s, 'B'), { text: 'ответ' }).ok).toBe(false);
  });
});

describe('validateFinalAction — lockAnswer', () => {
  it('принят от капитана в FINAL_QUESTION', () => {
    const s = finalQuestionState();
    const r = validateFinalAction(s, 'lockAnswer', captainOf(s, 'D'), {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.teamId).toBe('D');
  });

  it('отклонён вне FINAL_QUESTION', () => {
    const s = finalEliminationState();
    expect(validateFinalAction(s, 'lockAnswer', captainOf(s, 'B'), {}).ok).toBe(false);
  });
});

describe('validateFinalAction — неизвестное действие', () => {
  it('отклонён неизвестный action', () => {
    const s = finalBettingState();
    expect(validateFinalAction(s, 'unknownAction', captainOf(s, 'B'), {}).ok).toBe(false);
  });
});

describe('validateFinalAction — нет final в состоянии', () => {
  it('отклонён, если final === null', () => {
    const s = initialState(); // phase LOBBY, final null
    expect(validateFinalAction(s, 'placeBet', 'pB', { amount: 50 }).ok).toBe(false);
  });
});
