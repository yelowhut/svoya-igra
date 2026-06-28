import { describe, it, expect } from 'vitest';
import { toPublicState, toHostState, toPlayerFinalState } from './protocol.js';
import { initialState } from '../domain/engine/state.js';
import type { Pack, GameState } from '../domain/types.js';

// Pack с финал-раундом: 2 темы, чтобы показать устранение
function packFinal(): Pack {
  return {
    id: 'pf', title: 'Финал-пак',
    rounds: [
      {
        id: 'r1', name: 'Обычный раунд',
        categories: [{ id: 'c1', name: 'Кат1', questions: [
          { id: 'qq1', type: 'text', prompt: 'Обычный?', answer: 'ОБЫЧНЫЙ', value: 100, special: 'none' },
        ] }],
      },
      {
        id: 'rf', name: 'Финал', type: 'final',
        themes: [
          {
            id: 't1', name: 'Тема Раз',
            question: { id: 'fq1', type: 'text', prompt: 'Финал-вопрос?', media: 'media/fin.jpg', answer: 'ЭТАЛОН', value: 0, special: 'none' },
          },
          {
            id: 't2', name: 'Тема Два',
            question: { id: 'fq2', type: 'text', prompt: 'Другой финал?', answer: 'ДРУГОЙ_ЭТАЛОН', value: 0, special: 'none' },
          },
        ],
      },
    ],
  };
}

// Базовый GameState в финале: 3 команды A, B, C; тема t1 осталась (t2 устранена)
function baseFinaState(phase: GameState['phase']): GameState {
  return {
    ...initialState(),
    phase,
    teams: [
      { id: 'A', name: 'Команда А', score: 100, captainPlayerId: 'pA' },
      { id: 'B', name: 'Команда Б', score: 200, captainPlayerId: 'pB' },
      { id: 'C', name: 'Команда В', score: 150, captainPlayerId: 'pC' },
    ],
    roundIndex: 1,
    finalAnswerTimerSec: 60,
    final: {
      themeIds: ['t1'],                   // осталась 1 тема
      eliminationOrder: ['t2'],
      eliminationTurnIndex: 2,
      bets: { B: 50, C: 100 },           // A не поставил
      answers: {
        B: { text: 'отв-B', locked: true },
        C: { text: 'отв-C', locked: false },
      },
      revealIndex: 0,
      answerDeadline: 99999,
      answerPausedRemainingMs: null,
      verdicts: {},
    },
  };
}

function stateInFinalQuestion(): GameState {
  return baseFinaState('FINAL_QUESTION');
}

function stateInFinalReveal(): GameState {
  return baseFinaState('FINAL_REVEAL');
}

describe('протокол финала — тайна до вскрытия', () => {
  it('player видит только свою ставку/ответ до reveal', () => {
    const ps = toPlayerFinalState(stateInFinalQuestion(), packFinal(), 'B');
    expect(ps.final!.bets).toEqual({});                       // суммы скрыты
    expect(Object.keys(ps.final!.answers)).toEqual(['B']);    // только своя
    expect(ps.final!.betPlaced).toContain('C');               // факт виден
  });

  it('player видит текст своего ответа', () => {
    const ps = toPlayerFinalState(stateInFinalQuestion(), packFinal(), 'B');
    expect(ps.final!.answers['B'].text).toBe('отв-B');
  });

  it('player без ставки не видит чужих ответов', () => {
    // A не ставил и не отвечал
    const ps = toPlayerFinalState(stateInFinalQuestion(), packFinal(), 'A');
    expect(ps.final!.answers).toEqual({});
  });

  it('board не видит ответы/ставки до reveal', () => {
    const ps = toPublicState(stateInFinalQuestion(), packFinal());
    expect(ps.final!.answers).toEqual({});
    expect(ps.final!.bets).toEqual({});
  });

  it('host не видит суммы/тексты до reveal, но видит betPlaced/answerLocked и эталон', () => {
    const hs = toHostState(stateInFinalQuestion(), packFinal());
    expect(hs.final!.bets).toEqual({});
    expect(hs.finalReferenceAnswer).toBeTruthy();             // эталон оставшейся темы
    expect(hs.finalReferenceAnswer).toBe('ЭТАЛОН');
    // betPlaced содержит поставивших
    expect(hs.final!.betPlaced).toContain('B');
    expect(hs.final!.betPlaced).toContain('C');
  });

  it('answerLocked содержит только команды с locked=true', () => {
    const hs = toHostState(stateInFinalQuestion(), packFinal());
    expect(hs.final!.answerLocked).toContain('B');
    expect(hs.final!.answerLocked).not.toContain('C');  // C.locked=false
  });

  it('на FINAL_REVEAL все ставки/ответы видны всем проекциям', () => {
    const ps = toPublicState(stateInFinalReveal(), packFinal());
    expect(Object.keys(ps.final!.bets).length).toBeGreaterThan(0);
    expect(Object.keys(ps.final!.answers).length).toBeGreaterThan(0);
  });

  it('verdicts видны на FINAL_REVEAL, скрыты до вскрытия (п.11)', () => {
    const rev = stateInFinalReveal();
    rev.final!.verdicts = { B: false, C: true };
    expect(toPublicState(rev, packFinal()).final!.verdicts).toEqual({ B: false, C: true });

    const q = stateInFinalQuestion();
    q.final!.verdicts = { B: false };
    expect(toPublicState(q, packFinal()).final!.verdicts).toEqual({});
  });

  it('finalQuestion виден в FINAL_QUESTION (вопрос оставшейся темы)', () => {
    expect(toPublicState(stateInFinalQuestion(), packFinal()).finalQuestion?.prompt).toBeTruthy();
    expect(toPublicState(stateInFinalQuestion(), packFinal()).finalQuestion?.prompt).toBe('Финал-вопрос?');
  });

  it('finalQuestion.media без префикса media/', () => {
    const fq = toPublicState(stateInFinalQuestion(), packFinal()).finalQuestion;
    expect(fq?.media).toBe('fin.jpg');
  });

  it('finalQuestion виден на FINAL_REVEAL', () => {
    expect(toPublicState(stateInFinalReveal(), packFinal()).finalQuestion?.prompt).toBe('Финал-вопрос?');
  });

  it('captains проецируются во всех проекциях', () => {
    const ps = toPublicState(stateInFinalQuestion(), packFinal());
    expect(ps.captains?.['B']).toBe('pB');
    const hs = toHostState(stateInFinalQuestion(), packFinal());
    expect(hs.captains?.['A']).toBe('pA');
  });

  it('finalThemes содержит все темы финал-раунда', () => {
    const ps = toPublicState(stateInFinalQuestion(), packFinal());
    expect(ps.finalThemes).toHaveLength(2);
    expect(ps.finalThemes![0].name).toBe('Тема Раз');
  });

  it('answerTimerSec = finalAnswerTimerSec (60)', () => {
    const ps = toPublicState(stateInFinalQuestion(), packFinal());
    expect(ps.final!.answerTimerSec).toBe(60);
  });

  it('answerDeadline и answerPausedRemainingMs прокидываются', () => {
    const ps = toPublicState(stateInFinalQuestion(), packFinal());
    expect(ps.final!.answerDeadline).toBe(99999);
    expect(ps.final!.answerPausedRemainingMs).toBeNull();
  });

  it('PublicState не содержит эталонный ответ (не утекает)', () => {
    const ps = toPublicState(stateInFinalQuestion(), packFinal());
    expect(JSON.stringify(ps)).not.toContain('ЭТАЛОН');
  });

  it('final/finalThemes/finalQuestion = null вне финал-фаз', () => {
    const s = initialState();  // phase: 'LOBBY'
    const ps = toPublicState(s, packFinal());
    expect(ps.final).toBeNull();
    expect(ps.finalThemes).toBeNull();
    expect(ps.finalQuestion).toBeNull();
  });
});
