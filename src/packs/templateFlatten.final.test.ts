import { describe, it, expect } from 'vitest';
import { flattenTemplate } from './templateFlatten.js';
import { gameJsonSchema } from './schema.js';
import type { GameTemplate } from './templateTypes.js';
import type { BankView } from '../persistence/templateRepo.js';

function tmpl(rounds: GameTemplate['rounds']): GameTemplate {
  return { id: 't', title: 'Игра', rounds };
}

function bankWith2(q1: string, q2: string): BankView {
  return {
    categories: new Map([['c1', { id: 'c1', name: 'История' }]]),
    questions: new Map([
      [q1, { id: q1, categoryId: 'c1', type: 'text', prompt: 'Вопрос 1', answer: 'Ответ 1', media: null }],
      [q2, { id: q2, categoryId: 'c1', type: 'text', prompt: 'Вопрос 2', answer: 'Ответ 2', media: null }],
    ]),
  };
}

function tmplFinalWithMedia(): GameTemplate {
  return tmpl([{
    id: 'r1', type: 'final', name: 'Финал',
    themes: [
      { id: 'th1', name: 'Медиа тема', questionId: 'qm1' },
      { id: 'th2', name: 'Текст тема', questionId: 'qm2' },
    ],
  }]);
}

function bankWithMedia(): BankView {
  return {
    categories: new Map([['c1', { id: 'c1', name: 'Медиа' }]]),
    questions: new Map([
      ['qm1', { id: 'qm1', categoryId: 'c1', type: 'image', prompt: 'Картинка', answer: 'Ответ картинки', media: 'bank/media/img.png' }],
      ['qm2', { id: 'qm2', categoryId: 'c1', type: 'text', prompt: 'Текст', answer: 'Текстовый ответ', media: null }],
    ]),
  };
}

describe('flattenTemplate — финал-раунд', () => {
  it('flatten финал-раунда: темы из банка, снапшот, без value/special', () => {
    const doc = tmpl([{ id: 'r1', type: 'final', name: 'Финал', themes: [
      { id: 'th1', name: 'История', questionId: 'q1' },
      { id: 'th2', name: 'Кино', questionId: 'q2' },
    ] }]);
    const { game } = flattenTemplate(doc, bankWith2('q1', 'q2'));
    const round = (game as any).rounds[0];
    expect(round.type).toBe('final');
    expect(round.themes).toHaveLength(2);
    expect(round.themes[0]).toMatchObject({ name: 'История', question: { prompt: expect.any(String), answer: expect.any(String) } });
    expect(gameJsonSchema.safeParse(game).success).toBe(true);
  });

  it('flatten финала с медиа возвращает mediaCopies bank→pack', () => {
    const { mediaCopies } = flattenTemplate(tmplFinalWithMedia(), bankWithMedia());
    expect(mediaCopies[0]).toMatchObject({ from: expect.stringContaining('bank/media/'), to: expect.stringContaining('media/') });
  });

  it('финал-раунд с questionId null → бросает', () => {
    const doc = tmpl([{ id: 'r1', type: 'final', name: 'Финал', themes: [
      { id: 'th1', name: 'История', questionId: null },
      { id: 'th2', name: 'Кино', questionId: 'q2' },
    ] }]);
    expect(() => flattenTemplate(doc, bankWith2('q1', 'q2'))).toThrow();
  });

  it('финал-раунд с несуществующим questionId → бросает', () => {
    const doc = tmpl([{ id: 'r1', type: 'final', name: 'Финал', themes: [
      { id: 'th1', name: 'История', questionId: 'nonexistent' },
      { id: 'th2', name: 'Кино', questionId: 'q2' },
    ] }]);
    expect(() => flattenTemplate(doc, bankWith2('q1', 'q2'))).toThrow();
  });
});
