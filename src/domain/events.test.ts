import { describe, it, expect } from 'vitest';
import { makeEvent } from './events.js';

describe('makeEvent', () => {
  it('создаёт событие с id и payload', () => {
    const e = makeEvent('GAME_STARTED', {}, () => 'fixed-id');
    expect(e.id).toBe('fixed-id');
    expect(e.type).toBe('GAME_STARTED');
  });
});
