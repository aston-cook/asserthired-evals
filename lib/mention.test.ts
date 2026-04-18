import { describe, it, expect } from 'vitest';
import { mentions } from './mention.js';

describe('mentions', () => {
  describe('case insensitivity', () => {
    it('matches regardless of case in haystack', () => {
      expect(mentions('EQUIVALENCE PARTITIONING is key', 'equivalence partitioning')).toBe(true);
    });

    it('matches regardless of case in needle', () => {
      expect(mentions('we used equivalence partitioning', 'EQUIVALENCE Partitioning')).toBe(true);
    });
  });

  describe('whitespace handling', () => {
    it('collapses multiple spaces', () => {
      expect(mentions('edge    case  analysis', 'edge case')).toBe(true);
    });

    it('handles tabs and newlines', () => {
      expect(mentions('edge\tcase\nanalysis', 'edge case')).toBe(true);
    });

    it('trims leading and trailing whitespace', () => {
      expect(mentions('   edge case   ', '   edge case   ')).toBe(true);
    });
  });

  describe('punctuation tolerance', () => {
    it('treats punctuation as whitespace', () => {
      expect(mentions('equivalence-partitioning, boundaries', 'equivalence partitioning')).toBe(true);
    });
  });

  describe('trailing -s plural tolerance', () => {
    it('needle singular, haystack plural (edge case -> edge cases)', () => {
      expect(mentions('I would check edge cases', 'edge case')).toBe(true);
    });

    it('needle plural, haystack singular (edge cases -> edge case)', () => {
      expect(mentions('I would check an edge case', 'edge cases')).toBe(true);
    });
  });

  describe('-es plural tolerance', () => {
    it('class -> classes', () => {
      expect(mentions('we covered classes', 'class')).toBe(true);
    });

    it('box -> boxes', () => {
      expect(mentions('three boxes', 'box')).toBe(true);
    });
  });

  describe('y to ies tolerance (consonant y)', () => {
    it('boundary -> boundaries', () => {
      expect(mentions('the boundaries are tested', 'boundary')).toBe(true);
    });

    it('boundaries -> boundary', () => {
      expect(mentions('one boundary case', 'boundaries')).toBe(true);
    });

    it('category -> categories', () => {
      expect(mentions('the categories are set', 'category')).toBe(true);
    });
  });

  describe('vowel-y words do not generate ies variant', () => {
    it('boy -> boys (regular -s plural)', () => {
      expect(mentions('these boys are testers', 'boy')).toBe(true);
    });

    it('key -> keys', () => {
      expect(mentions('multiple keys exist', 'key')).toBe(true);
    });

    it('does not match nonsense variant boies', () => {
      expect(mentions('boies appears here', 'boy')).toBe(false);
    });
  });

  describe('non-matches', () => {
    it('returns false when no variant matches', () => {
      expect(mentions('totally unrelated text', 'equivalence partitioning')).toBe(false);
    });

    it('returns false on empty needle', () => {
      expect(mentions('anything', '')).toBe(false);
    });

    it('returns false on empty haystack', () => {
      expect(mentions('', 'needle')).toBe(false);
    });

    it('documented substring behavior: sonic matches inside supersonic', () => {
      expect(mentions('supersonic', 'sonic')).toBe(true);
    });
  });
});
