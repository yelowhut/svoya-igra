import { describe, it, expect } from 'vitest';
import { bankMediaUrl } from './bankApi.js';

describe('bankMediaUrl', () => {
  it('срезает префикс bank/media/ и даёт URL отдачи', () => {
    expect(bankMediaUrl('bank/media/Q1-pic.png')).toBe('/media/bank/Q1-pic.png');
  });
  it('терпит уже-чистое имя', () => {
    expect(bankMediaUrl('pic.png')).toBe('/media/bank/pic.png');
  });
});
