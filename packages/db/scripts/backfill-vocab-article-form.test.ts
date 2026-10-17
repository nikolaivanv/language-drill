import { describe, expect, it } from 'vitest';
import { acceptClassified, parseArgs } from './backfill-vocab-article-form';

describe('parseArgs', () => {
  it('defaults to a dry run', () => {
    expect(parseArgs([])).toEqual({ apply: false, noLlm: false, revert: null });
  });
  it('parses --apply, --no-llm and --revert', () => {
    expect(parseArgs(['--apply', '--no-llm'])).toMatchObject({ apply: true, noLlm: true });
    expect(parseArgs(['--revert', 'a.json']).revert).toBe('a.json');
  });
  it('rejects unknown flags and a bare --revert', () => {
    expect(() => parseArgs(['--limit', '3'])).toThrow();
    expect(() => parseArgs(['--revert'])).toThrow();
  });
});

describe('acceptClassified', () => {
  it('accepts a definite article + the same word', () => {
    expect(acceptClassified('ES', 'empatía', 'la empatía')).toBe('la empatía');
    expect(acceptClassified('DE', 'Ökotourismus', 'Der Ökotourismus')).toBe('der Ökotourismus');
  });
  it('rejects null, other languages’ articles, and rewritten words', () => {
    expect(acceptClassified('ES', 'reciclar', null)).toBeNull();
    expect(acceptClassified('ES', 'empatía', 'die empatía')).toBeNull();
    expect(acceptClassified('ES', 'empatía', 'la simpatía')).toBeNull();
    expect(acceptClassified('DE', 'Medien', 'Medien')).toBeNull();
  });
});
