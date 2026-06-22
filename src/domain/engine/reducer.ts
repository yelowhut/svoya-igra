import type { GameState } from '../types.js';
import type { GameEvent } from '../events.js';
import { nextAnsweringIndex } from './rules.js';

export function applyEvent(state: GameState, event: GameEvent): GameState {
  const s: GameState = structuredClone(state);
  switch (event.type) {
    case 'GAME_CREATED': {
      const p = event.payload;
      s.gameId = p.gameId; s.packId = p.packId; s.title = p.title; s.teamCount = p.teamCount;
      return s;
    }
    case 'TEAM_CREATED':
      s.teams.push({ id: event.payload.teamId, name: event.payload.name, score: 0 });
      return s;
    case 'PLAYER_JOINED': {
      const p = event.payload;
      s.players.push({ id: p.playerId, clientToken: p.clientToken, firstName: p.firstName, lastName: p.lastName, teamId: p.teamId, connected: true });
      return s;
    }
    case 'PLAYER_CONNECTED':
    case 'PLAYER_DISCONNECTED': {
      const pl = s.players.find(x => x.id === event.payload.playerId);
      if (pl) pl.connected = event.type === 'PLAYER_CONNECTED';
      return s;
    }
    case 'GAME_STARTED':
      s.phase = 'ROUND_INTRO';
      return s;
    case 'ROUND_STARTED':
      s.phase = 'PICKING';
      s.roundIndex = event.payload.roundIndex;
      s.pickingTeamId = event.payload.pickingTeamId;
      return s;
    case 'QUESTION_SELECTED':
      s.phase = 'QUESTION';
      s.currentQuestionId = event.payload.questionId;
      s.currentValue = event.payload.value;
      s.auction = event.payload.special === 'auction'
        ? { baseValue: event.payload.value, highestBid: event.payload.value, leaderTeamId: null, passedTeamIds: [] }
        : null;
      s.assignedTeamId = null;
      return s;
    case 'BUZZER_ARMED':
      s.phase = 'BUZZER_ARMED';
      s.buzzQueue = [];
      s.answeringIndex = -1;
      return s;
    case 'BUZZER_OPENED':
      s.phase = 'BUZZER_OPEN';
      s.buzzQueue = [];
      s.answeringIndex = -1;
      return s;
    case 'BUZZ_RECORDED': {
      const { teamId, reaction } = event.payload;
      const answeringTeamId = s.phase === 'ANSWERING' ? s.buzzQueue[s.answeringIndex]?.teamId : undefined;
      const existing = s.buzzQueue.find(e => e.teamId === teamId);
      if (existing) { if (reaction < existing.reaction) existing.reaction = reaction; }
      else s.buzzQueue.push({ teamId, reaction });
      s.buzzQueue.sort((x, y) => x.reaction - y.reaction);
      if (s.phase === 'BUZZER_OPEN') {
        s.phase = 'ANSWERING';
        s.answeringIndex = 0;
      }
      else if (s.phase === 'ANSWERING' && answeringTeamId) {
        s.answeringIndex = s.buzzQueue.findIndex(e => e.teamId === answeringTeamId);
      }
      return s;
    }
    case 'ANSWER_JUDGED': {
      const { teamId, correct, value } = event.payload;
      const team = s.teams.find(t => t.id === teamId);
      if (team) team.score += correct ? value : -value;
      s.lastJudgedTeamId = teamId;
      if (correct) { s.phase = 'JUDGED'; s.pickingTeamId = teamId; return s; }
      const next = nextAnsweringIndex(s.answeringIndex, s.buzzQueue.length);
      if (next === null) { s.phase = 'JUDGED'; }
      else { s.phase = 'ANSWERING'; s.answeringIndex = next; }
      return s;
    }
    case 'QUESTION_CLOSED':
      if (s.currentQuestionId) s.usedQuestionIds.push(s.currentQuestionId);
      s.currentQuestionId = null;
      s.currentValue = 0;
      s.buzzQueue = [];
      s.answeringIndex = -1;
      s.auction = null;
      s.assignedTeamId = null;
      s.phase = 'PICKING';
      return s;
    case 'SCORE_ADJUSTED': {
      const team = s.teams.find(t => t.id === event.payload.teamId);
      if (team) team.score += event.payload.delta;
      return s;
    }
    default:
      return s;
  }
}
