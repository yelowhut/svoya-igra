import { describe, it, expect, beforeEach } from 'vitest';
import { makeDefaultTemplate } from './templateTypes.js';

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
    expect(r.columns.map(c => c.value)).toEqual([100, 200, 300, 400, 500]);
    expect(r.rows).toHaveLength(5);
    expect(r.rows[0].categoryId).toBeNull();
    expect(r.rows[0].cells).toHaveLength(5);
    expect(r.rows[0].cells[0]).toMatchObject({ questionId: null, special: 'none' });
    expect(r.rows[0].cells[0].columnId).toBe(r.columns[0].id);
  });
  it('пустой: 1 раунд без столбцов и строк', () => {
    const t = makeDefaultTemplate({}, id);
    expect(t.rounds[0].columns).toEqual([]);
    expect(t.rounds[0].rows).toEqual([]);
  });
});
