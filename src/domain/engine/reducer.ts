import type { GameState } from '../types.js';
import type { GameEvent } from '../events.js';
import { nextAnsweringIndex } from './rules.js';

export function applyEvent(state: GameState, event: GameEvent): GameState {
  const s: GameState = structuredClone(state);
  switch (event.type) {
    case 'GAME_CREATED': {
      const p = event.payload;
      s.gameId = p.gameId; s.packId = p.packId; s.title = p.title; s.teamCount = p.teamCount;
      s.answerTimerSec = p.answerTimerSec ?? 45;
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
      // Лок только после advance (idx>0): пока idx=0 идёт сбор — лидирует быстрейшая
      const lockedTeamId = (s.phase === 'ANSWERING' && s.answeringIndex > 0)
        ? s.buzzQueue[s.answeringIndex]?.teamId
        : undefined;
      const existing = s.buzzQueue.find(e => e.teamId === teamId);
      if (existing) { if (reaction < existing.reaction) existing.reaction = reaction; }
      else s.buzzQueue.push({ teamId, reaction });
      s.buzzQueue.sort((x, y) => x.reaction - y.reaction);
      if (s.phase === 'BUZZER_OPEN') { s.phase = 'ANSWERING'; s.answeringIndex = 0; }
      else if (s.phase === 'ANSWERING') {
        s.answeringIndex = lockedTeamId
          ? s.buzzQueue.findIndex(e => e.teamId === lockedTeamId)
          : 0;
      }
      return s;
    }
    case 'ANSWER_JUDGED': {
      const { teamId, correct, value } = event.payload;
      const team = s.teams.find(t => t.id === teamId);
      if (team) team.score += correct ? value : -value;
      s.lastJudgedTeamId = teamId;
      if (correct) { s.phase = 'JUDGED'; s.pickingTeamId = teamId; s.answerDeadline = null; s.answerPausedRemainingMs = null; return s; }
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
      s.answerDeadline = null; s.answerPausedRemainingMs = null;
      return s;
    case 'SCORE_ADJUSTED': {
      const team = s.teams.find(t => t.id === event.payload.teamId);
      if (team) team.score += event.payload.delta;
      return s;
    }
    case 'AUCTION_BID':
      if (s.auction && event.payload.amount > s.auction.highestBid) {
        s.auction.highestBid = event.payload.amount;
        s.auction.leaderTeamId = event.payload.teamId;
      }
      return s;
    case 'AUCTION_PASSED':
      if (s.auction) s.auction.passedTeamIds.push(event.payload.teamId);
      return s;
    case 'AUCTION_WON':
      s.currentValue = event.payload.amount;
      s.pickingTeamId = event.payload.teamId;
      s.buzzQueue = [{ teamId: event.payload.teamId, reaction: 0 }];
      s.answeringIndex = 0;
      s.phase = 'ANSWERING';
      s.auction = null;
      return s;
    case 'CAT_ASSIGNED':
      s.assignedTeamId = event.payload.toTeamId;
      s.buzzQueue = [{ teamId: event.payload.toTeamId, reaction: 0 }];
      s.answeringIndex = 0;
      s.phase = 'ANSWERING';
      return s;
    case 'ROUND_ENDED':
      s.phase = 'ROUND_END';
      s.answerDeadline = null; s.answerPausedRemainingMs = null;
      return s;
    case 'GAME_ENDED':
      s.phase = 'GAME_END';
      s.answerDeadline = null; s.answerPausedRemainingMs = null;
      return s;
    case 'TEAM_RENAMED': {
      const team = s.teams.find(t => t.id === event.payload.teamId);
      if (team) team.name = event.payload.name;
      return s;
    }
    case 'TEAM_DELETED':
      s.teams = s.teams.filter(t => t.id !== event.payload.teamId);
      return s;
    case 'PLAYER_MOVED': {
      const player = s.players.find(p => p.id === event.payload.playerId);
      if (player) player.teamId = event.payload.teamId;
      return s;
    }
    case 'ANSWER_TIMER_STARTED':
      if (s.phase !== 'ANSWERING') return s;
      s.answerDeadline = event.payload.deadline;
      s.answerPausedRemainingMs = null;
      return s;
    case 'ANSWER_TIMER_PAUSED':
      if (s.phase !== 'ANSWERING') return s;
      s.answerPausedRemainingMs = event.payload.remainingMs;
      s.answerDeadline = null;
      return s;
    case 'ANSWER_TIMER_RESUMED':
      if (s.phase !== 'ANSWERING') return s;
      s.answerDeadline = event.payload.deadline;
      s.answerPausedRemainingMs = null;
      return s;
    default:
      return s;
  }
}
