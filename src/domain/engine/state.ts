import type { GameState } from '../types.js';

export function initialState(): GameState {
  return {
    gameId: '', packId: '', title: '', teamCount: 0,
    phase: 'LOBBY', teams: [], players: [],
    roundIndex: -1, usedQuestionIds: [],
    pickingTeamId: null, currentQuestionId: null, revealed: false, currentValue: 0,
    buzzQueue: [], answeringIndex: -1,
    auction: null, assignedTeamId: null,
    questionResults: {},
    roundScoreLog: [],
    lastJudgedTeamId: null, blocks: {},
    answerTimerSec: 45, answerDeadline: null, answerPausedRemainingMs: null,
    finalAnswerTimerSec: 60, final: null,
  };
}
