import { describe, it, expect } from 'vitest';
import { validateForPublish } from './templateValidate.js';
import type { GameTemplate, TemplateNormalRound } from './templateTypes.js';
import type { BankView } from '../persistence/templateRepo.js';

function bankWith(): BankView {
  return {
    categories: new Map([['c1', { id: 'c1', name: 'Кино' }]]),
    questions: new Map([
      ['q1', { id: 'q1', categoryId: 'c1', type: 'text', prompt: 'p', answer: 'a', media: null }],
      ['qimg', { id: 'qimg', categoryId: 'c1', type: 'image', prompt: 'p', answer: 'a', media: 'bank/media/x.png' }],
      ['qother', { id: 'qother', categoryId: 'cX', type: 'text', prompt: 'p', answer: 'a', media: null }],
    ]),
  };
}
const always = () => true;
const nr0 = (d: GameTemplate) => d.rounds[0] as TemplateNormalRound;

function validDoc(): GameTemplate {
  return {
    id: 't', title: 'Игра',
    rounds: [{
      id: 'r1', name: 'Раунд 1',
      columns: [{ id: 'k1', value: 100 }],
      rows: [{ id: 'row1', categoryId: 'c1', cells: [{ columnId: 'k1', questionId: 'q1', special: 'none' }] }],
    }],
  };
}

describe('validateForPublish', () => {
  it('валидный документ → нет ошибок', () => {
    expect(validateForPublish(validDoc(), bankWith(), always).errors).toEqual([]);
  });
  it('пустой title → error no-title', () => {
    const d = validDoc(); d.title = '  ';
    expect(validateForPublish(d, bankWith(), always).errors.some(e => e.kind === 'no-title')).toBe(true);
  });
  it('value не целое >0 → error bad-value', () => {
    const d = validDoc(); nr0(d).columns[0].value = 0;
    expect(validateForPublish(d, bankWith(), always).errors.some(e => e.kind === 'bad-value')).toBe(true);
  });
  it('value не кратно 100 → error bad-value', () => {
    const d = validDoc(); nr0(d).columns[0].value = 150;
    expect(validateForPublish(d, bankWith(), always).errors.some(e => e.kind === 'bad-value')).toBe(true);
  });
  it('строка без категории → error row-no-category', () => {
    const d = validDoc(); nr0(d).rows[0].categoryId = null;
    expect(validateForPublish(d, bankWith(), always).errors.some(e => e.kind === 'row-no-category')).toBe(true);
  });
  it('пустая ячейка → error cell-empty', () => {
    const d = validDoc(); nr0(d).rows[0].cells[0].questionId = null;
    expect(validateForPublish(d, bankWith(), always).errors.some(e => e.kind === 'cell-empty')).toBe(true);
  });
  it('вопрос из чужой категории → error cell-wrong-category', () => {
    const d = validDoc(); nr0(d).rows[0].cells[0].questionId = 'qother';
    expect(validateForPublish(d, bankWith(), always).errors.some(e => e.kind === 'cell-wrong-category')).toBe(true);
  });
  it('image без файла → error cell-missing-media', () => {
    const d = validDoc(); nr0(d).rows[0].cells[0].questionId = 'qimg';
    const res = validateForPublish(d, bankWith(), () => false);
    expect(res.errors.some(e => e.kind === 'cell-missing-media')).toBe(true);
  });
  it('image с файлом → нет ошибки', () => {
    const d = validDoc(); nr0(d).rows[0].cells[0].questionId = 'qimg';
    expect(validateForPublish(d, bankWith(), always).errors).toEqual([]);
  });
  it('дубль цены → warning dup-value', () => {
    const d = validDoc();
    nr0(d).columns = [{ id: 'k1', value: 100 }, { id: 'k2', value: 100 }];
    nr0(d).rows[0].cells = [
      { columnId: 'k1', questionId: 'q1', special: 'none' },
      { columnId: 'k2', questionId: 'q1', special: 'none' },
    ];
    const res = validateForPublish(d, bankWith(), always);
    expect(res.warnings.some(w => w.kind === 'dup-value')).toBe(true);
    expect(res.warnings.some(w => w.kind === 'dup-question')).toBe(true);
  });
});
