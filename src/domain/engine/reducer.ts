import type { GameState } from '../types.js';
import type { GameEvent } from '../events.js';
import { nextAnsweringIndex } from './rules.js';

function finalParticipants(s: GameState): string[] {
  return s.teams.filter(t => t.score > 0).map(t => t.id);
}
function eliminationOrderFrom(s: GameState): string[] {
  const idx = new Map(s.teams.map((t, i) => [t.id, i]));
  return finalParticipants(s)
    .sort((a, b) => {
      const sa = s.teams.find(t => t.id === a)!.score, sb = s.teams.find(t => t.id === b)!.score;
      return sa !== sb ? sa - sb : idx.get(a)! - idx.get(b)!;
    });
}

/** Команды, в которых есть хотя бы один ПОДКЛЮЧЁННЫЙ игрок. Только такие
 *  команды обязаны нажать баззер, прежде чем начнётся приём ответов. */
function activeTeamIds(s: GameState): string[] {
  return s.teams.filter(t => s.players.some(p => p.connected && p.teamId === t.id)).map(t => t.id);
}

/** Переход к следующей попытке (используется «Неверно» и таймаутом):
 *  штраф −currentValue, сдвиг очереди, безусловный сброс таймер-полей. */
function nextAttempt(s: GameState, teamId: string): GameState {
  const team = s.teams.find(t => t.id === teamId);
  if (team) team.score -= s.currentValue;
  s.questionResults[teamId] = { correct: false, delta: -s.currentValue };
  s.roundScoreLog.push({ teamId, delta: -s.currentValue, kind: 'judge', correct: false });
  s.lastJudgedTeamId = teamId;
  const next = nextAnsweringIndex(s.answeringIndex, s.buzzQueue.length);
  if (next === null) { s.phase = 'JUDGED'; }
  else { s.phase = 'ANSWERING'; s.answeringIndex = next; }
  s.answerDeadline = null; s.answerPausedRemainingMs = null;
  return s;
}

export function applyEvent(state: GameState, event: GameEvent): GameState {
  const s: GameState = structuredClone(state);
  switch (event.type) {
    case 'GAME_CREATED': {
      const p = event.payload;
      s.gameId = p.gameId; s.packId = p.packId; s.title = p.title; s.teamCount = p.teamCount;
      s.answerTimerSec = p.answerTimerSec ?? 45;
      s.finalAnswerTimerSec = p.finalAnswerTimerSec ?? 60;
      return s;
    }
    case 'TEAM_CREATED':
      s.teams.push({ id: event.payload.teamId, name: event.payload.name, score: 0, captainPlayerId: null });
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
      s.roundScoreLog = [];          // новый раунд — чистим историю очков
      return s;
    case 'QUESTION_SELECTED':
      s.phase = 'QUESTION';
      s.currentQuestionId = event.payload.questionId;
      s.revealed = false;            // выбран, но ещё не прочитан игрокам/табло
      s.questionResults = {};        // новый вопрос — чистим вердикты прошлого
      s.currentValue = event.payload.value;
      s.auction = event.payload.special === 'auction'
        ? { baseValue: event.payload.value, highestBid: event.payload.value, leaderTeamId: null, passedTeamIds: [] }
        : null;
      s.assignedTeamId = null;
      return s;
    case 'QUESTION_REVEALED':
      s.revealed = true;             // «Прочитать вопрос» — открыть игрокам и табло
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
      if (s.phase === 'BUZZER_OPEN') {
        // Приём ответов начинается только когда ВСЕ активные команды нажали баззер
        // (хотя бы одним игроком). Если активных команд нет — переходим по первому
        // нажатию (вакуумная истина; путь сетап-тестов без живых игроков).
        const active = activeTeamIds(s);
        const buzzed = new Set(s.buzzQueue.map(e => e.teamId));
        if (active.every(tid => buzzed.has(tid))) { s.phase = 'ANSWERING'; s.answeringIndex = 0; }
      } else if (s.phase === 'ANSWERING') {
        s.answeringIndex = lockedTeamId
          ? s.buzzQueue.findIndex(e => e.teamId === lockedTeamId)
          : 0;
      }
      return s;
    }
    case 'ANSWERS_STARTED':
      // Ведущий принудительно начинает приём ответов (команда не нажала/отключилась)
      if (s.phase === 'BUZZER_OPEN' && s.buzzQueue.length > 0) { s.phase = 'ANSWERING'; s.answeringIndex = 0; }
      return s;
    case 'ANSWER_JUDGED': {
      const { teamId, correct, value } = event.payload;
      if (correct) {
        const team = s.teams.find(t => t.id === teamId);
        if (team) team.score += value;
        s.questionResults[teamId] = { correct: true, delta: value };
        s.roundScoreLog.push({ teamId, delta: value, kind: 'judge', correct: true });
        s.lastJudgedTeamId = teamId;
        s.phase = 'JUDGED'; s.pickingTeamId = teamId;
        s.answerDeadline = null; s.answerPausedRemainingMs = null;
        return s;
      }
      return nextAttempt(s, teamId);
    }
    case 'QUESTION_CLOSED':
      if (s.currentQuestionId) s.usedQuestionIds.push(s.currentQuestionId);
      s.currentQuestionId = null;
      s.revealed = false;
      s.questionResults = {};
      s.currentValue = 0;
      s.buzzQueue = [];
      s.answeringIndex = -1;
      s.auction = null;
      s.assignedTeamId = null;
      s.phase = 'PICKING';
      s.answerDeadline = null; s.answerPausedRemainingMs = null;
      return s;
    case 'ROUND_RESET':
      // Полный сброс доски раунда: все клетки снова доступны. Счёт команд не трогаем.
      s.usedQuestionIds = [];
      s.roundScoreLog = [];
      s.currentQuestionId = null;
      s.revealed = false;
      s.questionResults = {};
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
      s.roundScoreLog.push({ teamId: event.payload.teamId, delta: event.payload.delta, kind: 'adjust' });
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
    case 'CAPTAIN_ASSIGNED': {
      const t = s.teams.find(t => t.id === event.payload.teamId);
      if (t) t.captainPlayerId = event.payload.playerId;
      return s;
    }
    case 'FINAL_STARTED':
      s.phase = 'FINAL_INTRO';
      s.final = {
        themeIds: [...event.payload.themeIds],
        eliminationOrder: eliminationOrderFrom(s),
        eliminationTurnIndex: 0,
        bets: {},
        answers: {},
        revealIndex: 0,
        answerDeadline: null,
        answerPausedRemainingMs: null,
      };
      return s;
    case 'FINAL_ELIMINATION_BEGAN':
      if (s.final) s.phase = 'FINAL_ELIMINATION';
      return s;
    case 'FINAL_THEME_REMOVED': {
      if (!s.final) return s;
      s.final.themeIds = s.final.themeIds.filter(id => id !== event.payload.themeId);
      if (s.final.themeIds.length <= 1) { s.phase = 'FINAL_BETTING'; }
      else { s.final.eliminationTurnIndex = (s.final.eliminationTurnIndex + 1) % s.final.eliminationOrder.length; }
      return s;
    }
    case 'FINAL_BET_PLACED': {
      if (!s.final || s.phase !== 'FINAL_BETTING') return s;
      const team = s.teams.find(t => t.id === event.payload.teamId);
      if (!team || !s.final.eliminationOrder.includes(team.id)) return s;
      s.final.bets[team.id] = Math.max(0, Math.min(team.score, Math.floor(event.payload.amount)));
      if (s.final.eliminationOrder.every(tid => tid in s.final!.bets)) s.phase = 'FINAL_QUESTION';
      return s;
    }
    case 'FINAL_ANSWER_UPDATED': {
      if (!s.final || s.phase !== 'FINAL_QUESTION') return s;
      const cur = s.final.answers[event.payload.teamId];
      if (cur?.locked) return s;
      s.final.answers[event.payload.teamId] = { text: event.payload.text, locked: false };
      return s;
    }
    case 'FINAL_ANSWER_LOCKED': {
      if (!s.final || s.phase !== 'FINAL_QUESTION') return s;
      const tid = event.payload.teamId;
      const cur = s.final.answers[tid] ?? { text: '', locked: false };
      s.final.answers[tid] = { text: cur.text, locked: true };
      if (s.final.eliminationOrder.every(t => s.final!.answers[t]?.locked)) s.phase = 'FINAL_REVEAL';
      return s;
    }
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
    case 'ANSWER_TIMED_OUT': {
      const current = s.buzzQueue[s.answeringIndex]?.teamId;
      if (s.phase !== 'ANSWERING' || event.payload.teamId !== current) return s; // no-op (гонка/идемпотентность)
      return nextAttempt(s, event.payload.teamId);
    }
    default:
      return s;
  }
}
