import { describe, it, expect } from 'vitest';
import { insertIndexForNormalRound, computeUsedCategoryIds } from './builderRounds.js';
import type { TemplateRound } from './templateTypes.js';

const normal = (id: string, rows: { categoryId: string | null }[] = []): TemplateRound =>
  ({ id, name: id, columns: [], rows: rows.map((r, i) => ({ id: `${id}-row${i}`, categoryId: r.categoryId, cells: [] })) }) as TemplateRound;
const final = (id: string, themeQids: (string | null)[] = []): TemplateRound =>
  ({ id, type: 'final', name: 'Финал', themes: themeQids.map((q, i) => ({ id: `${id}-th${i}`, name: `T${i}`, questionId: q })) }) as TemplateRound;

describe('insertIndexForNormalRound', () => {
  it('без финала — в конец', () => {
    expect(insertIndexForNormalRound([normal('r1'), normal('r2')])).toBe(2);
  });
  it('с финалом — перед финалом', () => {
    expect(insertIndexForNormalRound([normal('r1'), normal('r2'), final('f')])).toBe(2);
  });
  it('финал первый (вырожденный) — индекс 0', () => {
    expect(insertIndexForNormalRound([final('f'), normal('r1')])).toBe(0);
  });
  it('пустой список — 0', () => {
    expect(insertIndexForNormalRound([])).toBe(0);
  });
});

describe('computeUsedCategoryIds', () => {
  it('собирает categoryId из строк обычных раундов', () => {
    const rounds = [normal('r1', [{ categoryId: 'cA' }, { categoryId: 'cB' }]), normal('r2', [{ categoryId: 'cC' }])];
    expect(computeUsedCategoryIds(rounds, new Map())).toEqual(new Set(['cA', 'cB', 'cC']));
  });
  it('игнорирует строки без категории', () => {
    expect(computeUsedCategoryIds([normal('r1', [{ categoryId: null }, { categoryId: 'cA' }])], new Map())).toEqual(new Set(['cA']));
  });
  it('финал-темы добавляют категорию вопроса', () => {
    const qcat = new Map([['q1', 'cFinal'], ['q2', 'cFinal2']]);
    expect(computeUsedCategoryIds([final('f', ['q1', null, 'q2'])], qcat)).toEqual(new Set(['cFinal', 'cFinal2']));
  });
  it('сквозь обычные и финал, дедуп', () => {
    const rounds = [normal('r1', [{ categoryId: 'cA' }]), final('f', ['q1'])];
    const qcat = new Map([['q1', 'cA']]);
    expect(computeUsedCategoryIds(rounds, qcat)).toEqual(new Set(['cA']));
  });
});
