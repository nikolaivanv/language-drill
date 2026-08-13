import { describe, it, expect } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';

import { parseIdsFile, parseRevalidateArgs } from './revalidate-cloze-pool';

// ---------------------------------------------------------------------------
// parseRevalidateArgs
// ---------------------------------------------------------------------------

describe('parseRevalidateArgs', () => {
  it('defaults to dry-run with no filters', () => {
    const args = parseRevalidateArgs([]);
    expect(args.apply).toBe(false);
    expect(args.language).toBeNull();
    expect(args.cefrLevel).toBeNull();
    expect(args.limit).toBeNull();
    expect(args.concurrency).toBeGreaterThan(0);
    expect(args.maxCostUsd).toBeGreaterThan(0);
  });

  it('parses --apply, --language, --cefr, --limit, --concurrency, --max-cost-usd', () => {
    const args = parseRevalidateArgs([
      '--apply',
      '--language',
      'tr',
      '--cefr',
      'a1',
      '--limit',
      '50',
      '--concurrency',
      '8',
      '--max-cost-usd',
      '12.5',
    ]);
    expect(args.apply).toBe(true);
    expect(args.language).toBe(Language.TR);
    expect(args.cefrLevel).toBe(CefrLevel.A1);
    expect(args.limit).toBe(50);
    expect(args.concurrency).toBe(8);
    expect(args.maxCostUsd).toBe(12.5);
  });

  it('accepts --lang and --level as aliases', () => {
    const args = parseRevalidateArgs(['--lang', 'ES', '--level', 'B1']);
    expect(args.language).toBe(Language.ES);
    expect(args.cefrLevel).toBe(CefrLevel.B1);
  });

  it('rejects unknown languages', () => {
    expect(() => parseRevalidateArgs(['--language', 'FR'])).toThrow();
  });

  it('rejects unknown CEFR levels', () => {
    expect(() => parseRevalidateArgs(['--cefr', 'D3'])).toThrow();
  });

  it('rejects unrecognized flags', () => {
    expect(() => parseRevalidateArgs(['--bogus'])).toThrow(
      /Unrecognized argument/,
    );
  });

  it('rejects --limit values that are not positive integers', () => {
    expect(() => parseRevalidateArgs(['--limit', '0'])).toThrow();
    expect(() => parseRevalidateArgs(['--limit', '-5'])).toThrow();
    expect(() => parseRevalidateArgs(['--limit', 'abc'])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Narrowing flags (--grammar-point / --ids-file / --deterministic-only).
// A full pass is ~13k rows; these exist so a targeted worklist does not have to
// pay for the whole pool.
// ---------------------------------------------------------------------------

describe('parseRevalidateArgs — narrowing flags', () => {
  it('defaults to no point filter, no ids file, and the LLM pass', () => {
    const args = parseRevalidateArgs([]);
    expect(args.grammarPoints).toEqual([]);
    expect(args.idsFile).toBeNull();
    expect(args.deterministicOnly).toBe(false);
  });

  it('accumulates repeated --grammar-point into a worklist', () => {
    const args = parseRevalidateArgs([
      '--grammar-point',
      'tr-a1-vowel-harmony',
      '--grammar-point',
      'tr-a1-plural-suffix',
    ]);
    expect(args.grammarPoints).toEqual([
      'tr-a1-vowel-harmony',
      'tr-a1-plural-suffix',
    ]);
  });

  it('rejects a grammar point that does not resolve in the curriculum', () => {
    // An unvalidated key silently selects zero rows, which reads as
    // "nothing to do" rather than "you typo'd".
    expect(() =>
      parseRevalidateArgs(['--grammar-point', 'tr-a1-does-not-exist']),
    ).toThrow(/unknown grammar point/);
  });

  it('parses --ids-file and --deterministic-only', () => {
    const args = parseRevalidateArgs([
      '--ids-file',
      './worklist.txt',
      '--deterministic-only',
    ]);
    expect(args.idsFile).toBe('./worklist.txt');
    expect(args.deterministicOnly).toBe(true);
  });
});

describe('parseIdsFile', () => {
  it('reads one id per line, ignoring blanks and # comments', () => {
    const ids = parseIdsFile(
      [
        '# context-carrying ES rows, 2026-08-13',
        '9ffc33c1-0000-4000-8000-000000000001',
        '',
        '  9ffc33c1-0000-4000-8000-000000000002  ',
      ].join('\n'),
    );
    expect(ids).toEqual([
      '9ffc33c1-0000-4000-8000-000000000001',
      '9ffc33c1-0000-4000-8000-000000000002',
    ]);
  });

  it('dedupes repeated ids so a row is never validated twice', () => {
    const ids = parseIdsFile(
      '9ffc33c1-0000-4000-8000-000000000001\n9ffc33c1-0000-4000-8000-000000000001',
    );
    expect(ids).toHaveLength(1);
  });

  it('throws on a line that is not a UUID rather than silently selecting nothing', () => {
    expect(() => parseIdsFile('not-a-uuid')).toThrow(/not a UUID/);
  });

  it('throws when the file yields no ids', () => {
    expect(() => parseIdsFile('# only a comment\n')).toThrow(/no ids/);
  });
});
