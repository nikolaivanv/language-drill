import { describe, expect, it } from 'vitest';
import { parseArgs, posFromUd } from './backfill-vocab-target-pos';

describe('posFromUd', () => {
  it('treats an ES/DE article display form as a noun regardless of corpus tags', () => {
    expect(posFromUd('ES', 'la cena', ['VERB'])).toBe('noun');
    expect(posFromUd('DE', 'das Essen', ['VERB', 'NOUN'])).toBe('noun');
  });

  it('maps a single unambiguous UD class', () => {
    expect(posFromUd('ES', 'comer', ['VERB'])).toBe('verb');
    expect(posFromUd('TR', 'güzel', ['ADJ'])).toBe('adjective');
    expect(posFromUd('DE', 'oft', ['ADV'])).toBe('adverb');
    expect(posFromUd('ES', 'aunque', ['SCONJ'])).toBe('other');
    expect(posFromUd('TR', 'ev', ['NOUN', 'PROPN'])).toBe('noun');
  });

  it('leaves ambiguous, missing and multi-token rows for the classifier', () => {
    expect(posFromUd('TR', 'yemek', ['NOUN', 'VERB'])).toBeNull();
    expect(posFromUd('ES', 'rápido', null)).toBeNull();
    expect(posFromUd('ES', 'por la mañana', ['ADP'])).toBeNull();
  });

  it('does not read an article off Turkish forms', () => {
    expect(posFromUd('TR', 'bir şey', ['NOUN'])).toBeNull();
  });
});

describe('parseArgs', () => {
  it('parses flags and rejects unknown ones', () => {
    expect(parseArgs(['--apply', '--no-llm'])).toEqual({ apply: true, noLlm: true, revert: null });
    expect(parseArgs(['--revert', 'a.json'])).toEqual({ apply: false, noLlm: false, revert: 'a.json' });
    expect(() => parseArgs(['--revert'])).toThrow('--revert requires an artifact path');
    expect(() => parseArgs(['--nope'])).toThrow('Unknown argument: --nope');
  });
});
