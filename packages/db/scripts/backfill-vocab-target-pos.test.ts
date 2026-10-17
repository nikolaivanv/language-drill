import { describe, expect, it } from 'vitest';
import { acceptLlmPos, parseArgs, posFromUd, revertTargets } from './backfill-vocab-target-pos';

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
    expect(parseArgs(['--apply', '--no-llm'])).toEqual({ apply: true, noLlm: true, revert: null, outDir: 'backfill-runs' });
    expect(parseArgs(['--revert', 'a.json'])).toEqual({ apply: false, noLlm: false, revert: 'a.json', outDir: 'backfill-runs' });
    expect(() => parseArgs(['--revert'])).toThrow('--revert requires an artifact path');
    expect(parseArgs(['--out-dir', '/x']).outDir).toBe('/x');
    expect(() => parseArgs(['--out-dir'])).toThrow('--out-dir requires a path');
    expect(() => parseArgs(['--nope'])).toThrow('Unknown argument: --nope');
  });
});

describe('revertTargets', () => {
  const planned = [
    { id: 'a', lemma: 'a', pos: 'noun' as const, source: 'llm' as const },
    { id: 'b', lemma: 'b', pos: 'verb' as const, source: 'corpus' as const },
  ];
  it('refuses a dry-run artifact', () => {
    expect(() => revertTargets({ applied: false, planned, writtenIds: ['a'] })).toThrow('dry-run');
  });
  it('refuses an artifact without writtenIds', () => {
    expect(() => revertTargets({ applied: true, planned })).toThrow('writtenIds');
  });
  it('returns only the written ids with their planned pos', () => {
    expect(revertTargets({ applied: true, planned, writtenIds: ['b'] })).toEqual([{ id: 'b', pos: 'verb' }]);
  });
});

describe('acceptLlmPos', () => {
  it('rejects a multi-token item classified as noun/adjective/adverb/other', () => {
    expect(acceptLlmPos('por la mañana', 'por la mañana', 'adverb')).toBeNull();
    expect(acceptLlmPos('x', 'la cena fría', 'noun')).toBeNull();
  });
  it('keeps phrase/verb for multi-token and any class for single tokens', () => {
    expect(acceptLlmPos('por la mañana', 'por la mañana', 'phrase')).toBe('phrase');
    expect(acceptLlmPos('acordarse de', 'acordarse de', 'verb')).toBe('verb');
    expect(acceptLlmPos('rápido', 'rápido', 'adjective')).toBe('adjective');
    expect(acceptLlmPos('rápido', 'rápido', null)).toBeNull();
  });
});
