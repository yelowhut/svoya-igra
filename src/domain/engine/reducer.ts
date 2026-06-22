import type { GameState } from '../types.js';
import type { GameEvent } from '../events.js';

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
    default:
      return s;
  }
}
