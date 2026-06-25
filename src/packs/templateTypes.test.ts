import { describe, it, expect, beforeEach } from 'vitest';
import { makeDefaultTemplate, isFinalRound, type TemplateNormalRound } from './templateTypes.js';

let n = 0;
const id = () => `id${n++}`;
beforeEach(() => {
  n = 0;
});

describe('makeDefaultTemplate', () => {
  it('5x5: 1 раунд, 5 столбцов 100..500, 5 строк по 5 пустых ячеек', () => {
    const t = makeDefaultTemplate({ template: '5x5', title: 'Игра' }, id);
    expect(t.title).toBe('Игра');
    expect(t.rounds).toHaveLength(1);
    const r = t.rounds[0];
    expect(r.name).toBe('Раунд 1');
    const nr = r as TemplateNormalRound;
    expect(nr.columns.map(c => c.value)).toEqual([100, 200, 300, 400, 500]);
    expect(nr.rows).toHaveLength(5);
    expect(nr.rows[0].categoryId).toBeNull();
    expect(nr.rows[0].cells).toHaveLength(5);
    expect(nr.rows[0].cells[0]).toMatchObject({ questionId: null, special: 'none' });
    expect(nr.rows[0].cells[0].columnId).toBe(nr.columns[0].id);
  });
  it('пустой: 1 раунд без столбцов и строк', () => {
    const t = makeDefaultTemplate({}, id);
    const nr = t.rounds[0] as TemplateNormalRound;
    expect(nr.columns).toEqual([]);
    expect(nr.rows).toEqual([]);
  });
});
