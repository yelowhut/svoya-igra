import { describe, it, expect } from 'vitest';
import { isValidTeamName } from './teamName.js';

describe('isValidTeamName', () => {
  describe('valid names', () => {
    it('accepts Russian word', () => expect(isValidTeamName('Львы')).toBe(true));
    it('accepts Latin with hyphen and digit', () => expect(isValidTeamName('Team-1')).toBe(true));
    it('accepts mixed RU/EN with dot, underscore, quote', () => expect(isValidTeamName('А.Б_В "Кот"')).toBe(true));
    it('accepts two digits', () => expect(isValidTeamName('12')).toBe(true));
    it('accepts single char', () => expect(isValidTeamName('А')).toBe(true));
    it('accepts exactly 40 chars', () => expect(isValidTeamName('А'.repeat(40))).toBe(true));
  });

  describe('invalid names', () => {
    it('rejects empty string', () => expect(isValidTeamName('')).toBe(false));
    it('rejects only spaces', () => expect(isValidTeamName('   ')).toBe(false));
    it('rejects 41-char name', () => expect(isValidTeamName('А'.repeat(41))).toBe(false));
    it('rejects name with <', () => expect(isValidTeamName('Team<1')).toBe(false));
    it('rejects name with @', () => expect(isValidTeamName('user@host')).toBe(false));
    it('rejects name with /', () => expect(isValidTeamName('path/to')).toBe(false));
    it('rejects emoji', () => expect(isValidTeamName('Team🦁')).toBe(false));
    it('rejects newline', () => expect(isValidTeamName('Team\n1')).toBe(false));
  });
});
