import { describe, it, expect } from 'vitest';
import { validateClient, summarize, type BankClientView } from './templateValidate.js';
import type { GameTemplate } from './templateTypes.js';

const bank: BankClientView = { categories: new Set(['c1']), questionCategory: new Map([['q1', 'c1'], ['qX', 'cX']]) };
function doc(): GameTemplate {
  return { id: 't', title: 'Игра', rounds: [{ id: 'r', name: 'Раунд 1',
    columns: [{ id: 'k1', value: 100 }],
    rows: [{ id: 'row1', categoryId: 'c1', cells: [{ columnId: 'k1', questionId: 'q1', special: 'none' }] }] }] };
}

describe('validateClient', () => {
  it('валидный → нет ошибок', () => { expect(validateClient(doc(), bank).errors).toEqual([]); });
  it('пустая ячейка и строка без категории учитываются в summarize', () => {
    const d = doc(); d.rounds[0].rows[0].categoryId = null; d.rounds[0].rows[0].cells[0].questionId = null;
    const { errors } = validateClient(d, bank);
    const s = summarize(errors);
    expect(s.rowsNoCategory).toBe(1);
    expect(s.emptyCells).toBe(1);
  });
  it('чужая категория → cell-wrong-category', () => {
    const d = doc(); d.rounds[0].rows[0].cells[0].questionId = 'qX';
    expect(validateClient(d, bank).errors.some(e => e.kind === 'cell-wrong-category')).toBe(true);
  });
});
