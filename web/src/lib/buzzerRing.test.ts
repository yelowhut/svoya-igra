import { describe, it, expect } from 'vitest';
import { ringFraction, ringDashoffset, secondsLeft } from './buzzerRing.js';

describe('ringFraction', () => {
  it('1 в начале блокировки', () => expect(ringFraction(1000, 1000, 4000)).toBe(1));
  it('0 в конце', () => expect(ringFraction(4000, 1000, 4000)).toBe(0));
  it('0.5 на середине', () => expect(ringFraction(2500, 1000, 4000)).toBeCloseTo(0.5));
  it('клампится после истечения', () => expect(ringFraction(9999, 1000, 4000)).toBe(0));
  it('0 при нулевом/невалидном окне', () => expect(ringFraction(0, 4000, 4000)).toBe(0));
});

describe('ringDashoffset', () => {
  it('полное кольцо при fraction=1 → offset 0', () => expect(ringDashoffset(1, 691)).toBe(0));
  it('пустое кольцо при fraction=0 → offset = C', () => expect(ringDashoffset(0, 691)).toBe(691));
});

describe('secondsLeft', () => {
  it('округляет вверх', () => expect(secondsLeft(1000, 3200)).toBe(3));
  it('не отрицателен', () => expect(secondsLeft(5000, 3000)).toBe(0));
});
