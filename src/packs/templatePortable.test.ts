import { describe, it, expect } from 'vitest';
import { makeDefaultTemplate } from './templateTypes.js';
import { PORTABLE_FORMAT, toPortable, fromPortable } from './templatePortable.js';

describe('toPortable', () => {
  it('ставит маркер формата и выкидывает id/lastPublishedPackId', () => {
    const doc = makeDefaultTemplate({ template: '5x5' });
    doc.lastPublishedPackId = 'pack-xyz';
    const p = toPortable(doc);
    expect(p.format).toBe(PORTABLE_FORMAT);
    expect(p.title).toBe(doc.title);
    expect((p as Record<string, unknown>).id).toBeUndefined();
    expect((p as Record<string, unknown>).lastPublishedPackId).toBeUndefined();
    expect(p.rounds[0].columns).toHaveLength(5);
  });
});

describe('fromPortable', () => {
  it('присваивает новый id, не несёт lastPublishedPackId', () => {
    const doc = makeDefaultTemplate({ template: '5x5' });
    const restored = fromPortable(toPortable(doc), () => 'new-id');
    expect(restored.id).toBe('new-id');
    expect(restored.lastPublishedPackId).toBeUndefined();
  });

  it('round-trip структурно эквивалентен (кроме id)', () => {
    const doc = makeDefaultTemplate({ template: '5x5' });
    doc.rounds[0].rows[0].categoryId = 'cat-1';
    doc.rounds[0].rows[0].cells[0].questionId = 'q-1';
    doc.rounds[0].rows[0].cells[0].special = 'cat';
    const restored = fromPortable(toPortable(doc), () => 'new-id');
    expect(restored.rounds).toEqual(doc.rounds);
    expect(restored.title).toBe(doc.title);
  });

  it('бросает на чужом формате', () => {
    expect(() => fromPortable({ format: 'bank@1', title: 'x', rounds: [] }))
      .toThrow(/формат/i);
  });

  it('бросает на сломанной структуре', () => {
    expect(() => fromPortable({ format: PORTABLE_FORMAT, title: 'x' }))
      .toThrow(/структур/i);
  });

  it('не бросает на ссылках, которых нет в банке (резолв отложен)', () => {
    const doc = makeDefaultTemplate({ template: '5x5' });
    doc.rounds[0].rows[0].categoryId = 'нет-такой';
    doc.rounds[0].rows[0].cells[0].questionId = 'нет-такого';
    expect(() => fromPortable(toPortable(doc))).not.toThrow();
  });
});
