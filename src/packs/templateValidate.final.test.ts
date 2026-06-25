import { describe, it, expect } from 'vitest';
import { validateForPublish } from './templateValidate.js';
import type { GameTemplate, TemplateFinalRound } from './templateTypes.js';
import type { BankView } from '../persistence/templateRepo.js';

function bankWith(...qIds: string[]): BankView {
  const questions = new Map(
    qIds.map(id => [
      id,
      { id, categoryId: 'c1', type: 'text' as const, prompt: 'p', answer: 'a', media: null },
    ]),
  );
  return {
    categories: new Map([['c1', { id: 'c1', name: 'Кино' }]]),
    questions,
  };
}

function tmpl(rounds: TemplateFinalRound[]): GameTemplate {
  return { id: 't', title: 'Игра', rounds };
}

describe('validateForPublish — финал-раунды', () => {
  it('финал с <2 темами → final-too-few-themes', () => {
    const doc = tmpl([{ id: 'r1', type: 'final', name: 'Ф', themes: [{ id: 'th1', name: 'A', questionId: 'q1' }] }]);
    const probs = validateForPublish(doc, bankWith('q1'), () => true);
    expect(probs.errors.some(p => p.kind === 'final-too-few-themes')).toBe(true);
  });

  it('тема без вопроса → final-theme-no-question', () => {
    const doc = tmpl([{ id: 'r1', type: 'final', name: 'Ф', themes: [{ id: 'th1', name: 'A', questionId: null }, { id: 'th2', name: 'B', questionId: 'q1' }] }]);
    expect(validateForPublish(doc, bankWith('q1'), () => true).errors.some(p => p.kind === 'final-theme-no-question')).toBe(true);
  });

  it('>1 финала → final-multiple', () => {
    const fr = (id: string): TemplateFinalRound => ({ id, type: 'final', name: 'Ф', themes: [{ id: id + 'a', name: 'A', questionId: 'q1' }, { id: id + 'b', name: 'B', questionId: 'q1' }] });
    expect(validateForPublish(tmpl([fr('r1'), fr('r2')]), bankWith('q1'), () => true).errors.some(p => p.kind === 'final-multiple')).toBe(true);
  });

  it('валидный финал-раунд → нет ошибок финала', () => {
    const doc = tmpl([{ id: 'r1', type: 'final', name: 'Ф', themes: [{ id: 'th1', name: 'A', questionId: 'q1' }, { id: 'th2', name: 'B', questionId: 'q1' }] }]);
    const probs = validateForPublish(doc, bankWith('q1'), () => true);
    expect(probs.errors.filter(p => p.kind.startsWith('final-'))).toEqual([]);
  });

  it('тема с questionId не в банке → final-theme-bad-question', () => {
    const doc = tmpl([{ id: 'r1', type: 'final', name: 'Ф', themes: [{ id: 'th1', name: 'A', questionId: 'q-missing' }, { id: 'th2', name: 'B', questionId: 'q1' }] }]);
    expect(validateForPublish(doc, bankWith('q1'), () => true).errors.some(p => p.kind === 'final-theme-bad-question')).toBe(true);
  });

  it('тема с медиа-вопросом без файла → final-theme-missing-media', () => {
    const doc = tmpl([{
      id: 'r1', type: 'final', name: 'Ф',
      themes: [
        { id: 'th1', name: 'A', questionId: 'qimg' },
        { id: 'th2', name: 'B', questionId: 'q1' },
      ],
    }]);
    const bank: BankView = {
      categories: new Map([['c1', { id: 'c1', name: 'Кино' }]]),
      questions: new Map([
        ['qimg', { id: 'qimg', categoryId: 'c1', type: 'image', prompt: 'p', answer: 'a', media: 'bank/media/x.png' }],
        ['q1', { id: 'q1', categoryId: 'c1', type: 'text', prompt: 'p', answer: 'a', media: null }],
      ]),
    };
    expect(validateForPublish(doc, bank, () => false).errors.some(p => p.kind === 'final-theme-missing-media')).toBe(true);
  });
});
