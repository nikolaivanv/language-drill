import { describe, it, expect } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';

import { parseRevalidateArgs } from './revalidate-cloze-pool';

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
