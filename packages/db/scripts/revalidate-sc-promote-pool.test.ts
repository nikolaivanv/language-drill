import { describe, it, expect } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';

import { parsePromoteArgs } from './revalidate-sc-promote-pool';

// ---------------------------------------------------------------------------
// parsePromoteArgs
// ---------------------------------------------------------------------------

describe('parsePromoteArgs', () => {
  it('defaults to dry-run with no filters', () => {
    const args = parsePromoteArgs([]);
    expect(args.apply).toBe(false);
    expect(args.language).toBeNull();
    expect(args.cefrLevel).toBeNull();
    expect(args.limit).toBeNull();
    expect(args.concurrency).toBeGreaterThan(0);
    expect(args.maxCostUsd).toBeGreaterThan(0);
  });

  it('parses --apply, --language, --cefr, --limit, --concurrency, --max-cost-usd', () => {
    const args = parsePromoteArgs([
      '--apply',
      '--language',
      'tr',
      '--cefr',
      'b1',
      '--limit',
      '20',
      '--concurrency',
      '6',
      '--max-cost-usd',
      '10',
    ]);
    expect(args.apply).toBe(true);
    expect(args.language).toBe(Language.TR);
    expect(args.cefrLevel).toBe(CefrLevel.B1);
    expect(args.limit).toBe(20);
    expect(args.concurrency).toBe(6);
    expect(args.maxCostUsd).toBe(10);
  });

  it('accepts --lang and --level as aliases', () => {
    const args = parsePromoteArgs(['--lang', 'ES', '--level', 'B2']);
    expect(args.language).toBe(Language.ES);
    expect(args.cefrLevel).toBe(CefrLevel.B2);
  });

  it('--dry-run overrides a prior --apply', () => {
    const args = parsePromoteArgs(['--apply', '--dry-run']);
    expect(args.apply).toBe(false);
  });

  it('rejects unknown languages', () => {
    expect(() => parsePromoteArgs(['--language', 'FR'])).toThrow();
  });

  it('rejects unknown CEFR levels', () => {
    expect(() => parsePromoteArgs(['--cefr', 'D3'])).toThrow();
  });

  it('rejects unrecognized flags', () => {
    expect(() => parsePromoteArgs(['--bogus'])).toThrow(/Unrecognized argument/);
  });

  it('rejects --limit values that are not positive integers', () => {
    expect(() => parsePromoteArgs(['--limit', '0'])).toThrow();
    expect(() => parsePromoteArgs(['--limit', '-5'])).toThrow();
    expect(() => parsePromoteArgs(['--limit', 'abc'])).toThrow();
  });
});
