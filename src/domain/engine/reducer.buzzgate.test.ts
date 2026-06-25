import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';
import type { GameState } from '../types.js';

let n = 0; const id = () => `id${n++}`;

/** Игра с двумя командами и по одному подключённому игроку в каждой, вопрос открыт под баззер. */
function opened(opts: { teams?: string[]; withPlayers?: string[] } = {}): GameState {
  const teams = opts.teams ?? ['a', 'b'];
  const withPlayers = opts.withPlayers ?? teams;
  let s = initialState();
  s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: teams.length, answerTimerSec: 30, finalAnswerTimerSec: 60 }, id));
  for (const t of teams) s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: t, name: t.toUpperCase() }, id));
  for (const t of withPlayers) {
    s = applyEvent(s, makeEvent('PLAYER_JOINED', { playerId: `pl-${t}`, clientToken: `tok-${t}`, firstName: t, lastName: t, teamId: t }, id));
  }
  s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: teams[0] }, id));
  s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }, id));
  s = applyEvent(s, makeEvent('QUESTION_REVEALED', {}, id));
  s = applyEvent(s, makeEvent('BUZZER_OPENED', {}, id));
  return s;
}

describe('reducer — reveal', () => {
  it('QUESTION_SELECTED не раскрывает вопрос; QUESTION_REVEALED раскрывает', () => {
    let s = initialState();
    s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec: 30, finalAnswerTimerSec: 60 }, id));
    s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
    s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }, id));
    expect(s.phase).toBe('QUESTION');
    expect(s.revealed).toBe(false);
    s = applyEvent(s, makeEvent('QUESTION_REVEALED', {}, id));
    expect(s.revealed).toBe(true);
  });
});

describe('reducer — приём ответов после нажатия всех активных команд', () => {
  it('пока не нажали все активные команды — фаза остаётся BUZZER_OPEN', () => {
    let s = opened(); // a и b активны (есть игроки)
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 25 }, id));
    expect(s.phase).toBe('BUZZER_OPEN');          // ждём b
    expect(s.buzzQueue.map(e => e.teamId)).toEqual(['a']);
  });

  it('когда нажали все активные команды — ANSWERING в порядке реакции', () => {
    let s = opened();
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'b', reaction: 150 }, id));
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 25 }, id));
    expect(s.phase).toBe('ANSWERING');
    expect(s.buzzQueue.map(e => e.teamId)).toEqual(['a', 'b']); // по возрастанию ms
    expect(s.answeringIndex).toBe(0);
  });

  it('команда без подключённых игроков не блокирует начало ответов', () => {
    // 'b' существует, но игроков нет → не активна; достаточно нажатия 'a'
    let s = opened({ teams: ['a', 'b'], withPlayers: ['a'] });
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 40 }, id));
    expect(s.phase).toBe('ANSWERING');
    expect(s.answeringIndex).toBe(0);
  });

  it('ANSWERS_STARTED принудительно начинает ответы с текущей очередью', () => {
    let s = opened(); // активны a и b, но нажала только a
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 30 }, id));
    expect(s.phase).toBe('BUZZER_OPEN');
    s = applyEvent(s, makeEvent('ANSWERS_STARTED', {}, id));
    expect(s.phase).toBe('ANSWERING');
    expect(s.buzzQueue[s.answeringIndex].teamId).toBe('a');
  });

  it('ANSWERS_STARTED без нажатий — no-op', () => {
    let s = opened();
    s = applyEvent(s, makeEvent('ANSWERS_STARTED', {}, id));
    expect(s.phase).toBe('BUZZER_OPEN');
  });
});

describe('reducer — questionResults (фидбэк командам)', () => {
  it('фиксирует вердикт и дельту: неверно → −value, верно → +value; сброс на новом вопросе', () => {
    let s = opened();
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 10 }, id));
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'b', reaction: 20 }, id)); // ANSWERING, a первый
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: false, value: 100 }, id));
    expect(s.questionResults['a']).toEqual({ correct: false, delta: -100 }); // ход к b
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'b', correct: true, value: 100 }, id));
    expect(s.questionResults['b']).toEqual({ correct: true, delta: 100 });
    expect(s.phase).toBe('JUDGED');
    // закрытие вопроса очищает результаты
    s = applyEvent(s, makeEvent('QUESTION_CLOSED', {}, id));
    expect(s.questionResults).toEqual({});
  });
});

describe('reducer — ROUND_RESET', () => {
  it('очищает отыгранные вопросы и возвращает в PICKING, счёт не трогает', () => {
    let s = opened();
    s.teams.find(t => t.id === 'a')!.score = 300;
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 10 }, id));
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'b', reaction: 20 }, id));
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: true, value: 100 }, id));
    s = applyEvent(s, makeEvent('QUESTION_CLOSED', {}, id));
    expect(s.usedQuestionIds).toContain('q1');
    s = applyEvent(s, makeEvent('ROUND_RESET', {}, id));
    expect(s.usedQuestionIds).toEqual([]);
    expect(s.phase).toBe('PICKING');
    expect(s.currentQuestionId).toBeNull();
    expect(s.revealed).toBe(false);
    expect(s.teams.find(t => t.id === 'a')!.score).toBe(400); // 300 + 100, сброс не трогает счёт
  });
});
