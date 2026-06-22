import { describe, it, expect } from 'vitest';
import { toPublicState, toHostState } from './protocol.js';
import { initialState } from '../domain/engine/state.js';
import type { Pack } from '../domain/types.js';

const pack: Pack = { id: 'p', title: 'T', rounds: [{ id: 'r', name: 'R', categories: [{ id: 'c', name: 'C',
  questions: [{ id: 'q1', type: 'text', prompt: 'Вопрос?', answer: 'СЕКРЕТ', value: 100, special: 'none' }] }] }] };

describe('проекции состояния', () => {
  it('PublicState не содержит ответа', () => {
    const s = { ...initialState(), currentQuestionId: 'q1' };
    const pub = toPublicState(s, pack);
    expect(JSON.stringify(pub)).not.toContain('СЕКРЕТ');
    expect(pub.currentPrompt).toBe('Вопрос?');
  });
  it('HostState содержит ответ', () => {
    const s = { ...initialState(), currentQuestionId: 'q1' };
    const host = toHostState(s, pack);
    expect(host.currentAnswer).toBe('СЕКРЕТ');
  });
});
