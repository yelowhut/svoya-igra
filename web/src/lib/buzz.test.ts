import { describe, it, expect } from 'vitest';
import { reactionMs } from './buzz.js';
describe('reactionMs', () => {
  it('реакция = нажатие − получение GO', () => {
    expect(reactionMs(1000, 1180)).toBe(180);
  });
});
