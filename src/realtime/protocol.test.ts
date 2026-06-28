import { describe, it, expect } from 'vitest';
import { toPublicState, toHostState } from './protocol.js';
import { initialState } from '../domain/engine/state.js';
import type { Pack } from '../domain/types.js';

const pack: Pack = { id: 'p', title: 'T', rounds: [{ id: 'r', name: 'R', categories: [{ id: 'c', name: 'C',
  questions: [{ id: 'q1', type: 'text', prompt: 'Вопрос?', answer: 'СЕКРЕТ', value: 100, special: 'none' }] }] }] };

const auctionPack: Pack = { id: 'p2', title: 'T2', rounds: [{ id: 'r', name: 'R', categories: [{ id: 'c', name: 'C',
  questions: [{ id: 'qa', type: 'text', prompt: 'Аукцион?', answer: 'АУКЦИОН_ОТВЕТ', value: 200, special: 'auction' }] }] }] };

describe('проекции состояния', () => {
  it('PublicState не содержит ответа', () => {
    const s = { ...initialState(), currentQuestionId: 'q1', revealed: true };
    const pub = toPublicState(s, pack);
    expect(JSON.stringify(pub)).not.toContain('СЕКРЕТ');
    expect(pub.currentPrompt).toBe('Вопрос?');
  });
  it('HostState содержит ответ', () => {
    const s = { ...initialState(), currentQuestionId: 'q1' };
    const host = toHostState(s, pack);
    expect(host.currentAnswer).toBe('СЕКРЕТ');
  });

  it('вопрос скрыт от игроков/табло и от ведущего до «Прочитать» (phase QUESTION, !revealed) (п.2)', () => {
    const s = { ...initialState(), phase: 'QUESTION', currentQuestionId: 'q1', revealed: false } as any;
    const pub = toPublicState(s, pack);
    expect(pub.currentPrompt).toBeNull();        // игрокам не виден
    expect(pub.currentQuestionId).toBe('q1');    // но клетка известна (для подсветки)
    expect(pub.revealed).toBe(false);
    const host = toHostState(s, pack);
    expect(host.currentPrompt).toBeNull();        // ведущий тоже не видит текст до «Прочитать»
    expect(host.currentAnswer).toBeNull();        // и ответ скрыт
    expect(host.currentQuestionId).toBe('q1');    // но знает, какая клетка выбрана
  });

  it('после «Прочитать» (revealed) ведущий видит текст и ответ (п.2)', () => {
    const s = { ...initialState(), phase: 'QUESTION', currentQuestionId: 'q1', revealed: true } as any;
    const host = toHostState(s, pack);
    expect(host.currentPrompt).toBe('Вопрос?');
    expect(host.currentAnswer).toBe('СЕКРЕТ');
  });

  it('ведущий видит currentSpecial аукциона даже до reveal (для панели), но текст скрыт (п.2)', () => {
    const s = { ...initialState(), phase: 'QUESTION', currentQuestionId: 'qa', revealed: false } as any;
    const host = toHostState(s, auctionPack);
    expect(host.currentSpecial).toBe('auction');  // панель аукциона работает
    expect(host.currentPrompt).toBeNull();         // но сам вопрос ещё скрыт
  });

  it('currentMedia отдаётся без префикса media/', () => {
    const p: Pack = { id: 'p', title: 'T', rounds: [{ id: 'r', name: 'R', categories: [{ id: 'c', name: 'C',
      questions: [{ id: 'q1', type: 'image', prompt: 'Кто?', media: 'media/pic.jpg', answer: 'X', value: 100, special: 'none' }] }] }] };
    const s = { ...initialState(), currentQuestionId: 'q1', revealed: true };
    expect(toPublicState(s, p).currentMedia).toBe('pic.jpg');
  });

  it('PublicState содержит currentSpecial, auction, assignedTeamId для аукционного вопроса', () => {
    const auctionState = { baseValue: 200, highestBid: 300, leaderTeamId: 't1', passedTeamIds: [] };
    const s = { ...initialState(), currentQuestionId: 'qa', revealed: true, auction: auctionState, assignedTeamId: null };
    const pub = toPublicState(s, auctionPack);
    expect(pub.currentSpecial).toBe('auction');
    expect(pub.auction?.highestBid).toBe(300);
    expect(pub.auction?.leaderTeamId).toBe('t1');
    expect(pub.assignedTeamId).toBeNull();
    // ответ всё равно не должен утекать
    expect(JSON.stringify(pub)).not.toContain('АУКЦИОН_ОТВЕТ');
  });

  it('toHostState.players отражает вошедших игроков; toPublicState не содержит поле players', () => {
    const token = 'SECRET_TOKEN_XYZ';
    const s = {
      ...initialState(),
      players: [{ id: 'p1', clientToken: token, firstName: 'Иван', lastName: 'Иванов', teamId: 't1', connected: true }],
    };
    const host = toHostState(s, pack);
    expect(host.players).toHaveLength(1);
    expect(host.players[0].firstName).toBe('Иван');
    expect(host.players[0].connected).toBe(true);
    // clientToken должен быть исключён
    expect(JSON.stringify(host)).not.toContain(token);

    const pub = toPublicState(s, pack);
    expect('players' in pub).toBe(false);
  });

  it('toPublicState содержит roster (имена без id/токена) для табло (п.4)', () => {
    const token = 'ROSTER_TOKEN_XYZ';
    const s = {
      ...initialState(),
      players: [{ id: 'p1', clientToken: token, firstName: 'Аня', lastName: 'Б', teamId: 't1', connected: false }],
    };
    const pub = toPublicState(s, pack);
    expect(pub.roster).toEqual([{ firstName: 'Аня', lastName: 'Б', teamId: 't1', connected: false }]);
    expect(JSON.stringify(pub)).not.toContain(token);
  });

  it('toPublicState проносит таймер-поля и serverNow', () => {
    const pack_test = { id: 'p', title: 'T', rounds: [] };
    const s = { ...initialState(), phase: 'ANSWERING', answerTimerSec: 30, answerDeadline: 5000, answerPausedRemainingMs: null } as any;
    const pub = toPublicState(s, pack_test as any, 1234);
    expect(pub.answerTimerSec).toBe(30);
    expect(pub.answerDeadline).toBe(5000);
    expect(pub.answerPausedRemainingMs).toBeNull();
    expect(pub.serverNow).toBe(1234);
  });

  // Регресс Bug2: answeringTeamId выводится из buzzQueue[answeringIndex], но reducer
  // оставляет answeringIndex stale при исчерпании очереди (next===null → JUDGED).
  // Проекция ОБЯЗАНА гейтить по phase==='ANSWERING', иначе в JUDGED утечёт чужой teamId.
  it('answeringTeamId === null в JUDGED после таймаута (stale answeringIndex)', () => {
    const s = { ...initialState(), phase: 'JUDGED', answeringIndex: 0, buzzQueue: [{ teamId: 'a', reaction: 1 }] } as any;
    expect(toPublicState(s, pack).answeringTeamId).toBeNull();
  });
  it('answeringTeamId === teamId в ANSWERING (компаньон-кейс)', () => {
    const s = { ...initialState(), phase: 'ANSWERING', answeringIndex: 0, buzzQueue: [{ teamId: 'a', reaction: 1 }] } as any;
    expect(toPublicState(s, pack).answeringTeamId).toBe('a');
  });
});
