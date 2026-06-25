import { describe, it, expect } from 'vitest';
import { lowestScoreTeamId, nextAnsweringIndex } from './rules.js';

describe('lowestScoreTeamId', () => {
  it('возвращает команду с минимальным счётом', () => {
    const teams = [
      { id: 'a', name: 'A', score: 30, captainPlayerId: null },
      { id: 'b', name: 'B', score: 10, captainPlayerId: null },
      { id: 'c', name: 'C', score: 20, captainPlayerId: null },
    ];
    expect(lowestScoreTeamId(teams)).toBe('b');
  });
  it('при равенстве берёт первую по порядку', () => {
    const teams = [
      { id: 'a', name: 'A', score: 0, captainPlayerId: null },
      { id: 'b', name: 'B', score: 0, captainPlayerId: null },
    ];
    expect(lowestScoreTeamId(teams)).toBe('a');
  });
});

describe('nextAnsweringIndex', () => {
  it('возвращает следующий индекс', () => {
    expect(nextAnsweringIndex(0, 3)).toBe(1);
  });
  it('возвращает null когда очередь исчерпана', () => {
    expect(nextAnsweringIndex(2, 3)).toBeNull();
  });
});
