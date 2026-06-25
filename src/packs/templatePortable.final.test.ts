import { describe, it, expect } from 'vitest';
import { toPortable, fromPortable } from './templatePortable.js';

describe('portable финал-раунд', () => {
  it('round-trip финал-раунда через portable', () => {
    const doc = { id: 'g1', title: 'T', rounds: [{ id: 'r1', type: 'final', name: 'Финал', themes: [
      { id: 'th1', name: 'A', questionId: 'q1' }, { id: 'th2', name: 'B', questionId: null },
    ] }] };
    const portable = toPortable(doc as any);
    const back = fromPortable(JSON.stringify(portable));
    expect(back.rounds[0].type).toBe('final');
    expect((back.rounds[0] as any).themes).toHaveLength(2);
    expect(back.id).not.toBe('g1'); // новый id
  });
});
