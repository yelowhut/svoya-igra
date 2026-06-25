import { describe, it, expect } from 'vitest';
import { flattenTemplate } from './templateFlatten.js';
import { gameJsonSchema } from './schema.js';
import type { GameTemplate, TemplateNormalRound } from './templateTypes.js';
import type { BankView } from '../persistence/templateRepo.js';

function bank(): BankView {
  return {
    categories: new Map([['c1', { id: 'c1', name: 'Кино' }]]),
    questions: new Map([
      ['q1', { id: 'q1', categoryId: 'c1', type: 'text', prompt: 'дешёвый', answer: 'a1', media: null }],
      ['q2', { id: 'q2', categoryId: 'c1', type: 'image', prompt: 'дорогой', answer: 'a2', media: 'bank/media/x.png' }],
    ]),
  };
}
function doc(): GameTemplate {
  return {
    id: 't', title: 'Игра',
    rounds: [{
      id: 'r1', name: 'Раунд 1',
      columns: [{ id: 'k2', value: 300 }, { id: 'k1', value: 100 }],
      rows: [{ id: 'row1', categoryId: 'c1', cells: [
        { columnId: 'k2', questionId: 'q2', special: 'auction' },
        { columnId: 'k1', questionId: 'q1', special: 'none' },
      ] }],
    }],
  };
}

describe('flattenTemplate', () => {
  it('строит валидный для gameJsonSchema объект, вопросы по возрастанию цены', () => {
    const { game } = flattenTemplate(doc(), bank());
    expect(() => gameJsonSchema.parse(game)).not.toThrow();
    const cat = (game as any).rounds[0].categories[0];
    expect(cat.name).toBe('Кино');
    expect(cat.questions.map((q: any) => q.value)).toEqual([100, 300]);
    expect(cat.questions[0]).toMatchObject({ prompt: 'дешёвый', answer: 'a1', value: 100, special: 'none' });
    expect(cat.questions[1]).toMatchObject({ value: 300, special: 'auction', media: 'media/x.png' });
  });
  it('возвращает mediaCopies с переписанными путями', () => {
    const { mediaCopies } = flattenTemplate(doc(), bank());
    expect(mediaCopies).toEqual([{ from: 'bank/media/x.png', to: 'media/x.png' }]);
  });
  it('строка без категории → бросает', () => {
    const d = doc(); (d.rounds[0] as TemplateNormalRound).rows[0].categoryId = null;
    expect(() => flattenTemplate(d, bank())).toThrow();
  });
});
