import { describe, it, expect } from 'vitest';
import { gameJsonSchema, parseGameJson } from './schema.js';

describe('final round schema', () => {
  const finalRound = {
    type: 'final', name: 'Финал',
    themes: [
      { name: 'Тема A', question: { type: 'text', prompt: 'В1', answer: 'О1' } },
      { name: 'Тема B', question: { type: 'text', prompt: 'В2', answer: 'О2' } },
    ],
  };

  it('принимает валидный final-раунд', () => {
    const r = gameJsonSchema.safeParse({ title: 'T', rounds: [finalRound] });
    expect(r.success).toBe(true);
  });

  it('отвергает финал с <2 темами', () => {
    const r = gameJsonSchema.safeParse({ title: 'T', rounds: [{ ...finalRound, themes: [finalRound.themes[0]] }] });
    expect(r.success).toBe(false);
  });

  it('отвергает тему без вопроса', () => {
    const bad = { type: 'final', name: 'Ф', themes: [{ name: 'X' }, { name: 'Y' }] };
    expect(gameJsonSchema.safeParse({ title: 'T', rounds: [bad] }).success).toBe(false);
  });

  it('обратная совместимость: normal-раунд без type', () => {
    const normal = { name: 'Р1', categories: [{ name: 'К', questions: [{ type: 'text', prompt: 'p', answer: 'a', value: 100, special: 'none' }] }] };
    expect(gameJsonSchema.safeParse({ title: 'T', rounds: [normal] }).success).toBe(true);
  });

  it('parseGameJson нормализует финал-вопрос: value=0, special=none, UID', () => {
    const pack = parseGameJson({ title: 'T', rounds: [finalRound] }) as any;
    const round = pack.rounds[0];
    expect(round.type).toBe('final');
    expect(round.themes[0].id).toBeTruthy();
    expect(round.themes[0].question.id).toBeTruthy();
    expect(round.themes[0].question.value).toBe(0);
    expect(round.themes[0].question.special).toBe('none');
  });
});
