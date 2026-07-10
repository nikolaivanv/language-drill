import { describe, expect, it } from 'vitest';
import { normalizeWord } from './vocab-normalize';

describe('normalizeWord', () => {
  it('lowercases and trims', () => {
    expect(normalizeWord('  Manzana  ')).toBe('manzana');
  });

  it('strips a leading article on multi-token strings', () => {
    expect(normalizeWord('la manzana')).toBe('manzana');
    expect(normalizeWord('los libros')).toBe('libros');
    expect(normalizeWord('un coche')).toBe('coche');
  });

  it('does NOT strip a single bare token that happens to be an article', () => {
    expect(normalizeWord('la')).toBe('la');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeWord('la   casa')).toBe('casa');
  });
});
