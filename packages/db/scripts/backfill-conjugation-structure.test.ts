import { describe, it, expect } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';

import {
  parseBackfillArgs,
  extractCellDescriptor,
} from './backfill-conjugation-structure';

// ---------------------------------------------------------------------------
// parseBackfillArgs
// ---------------------------------------------------------------------------

describe('parseBackfillArgs', () => {
  it('defaults to dry-run with no filters', () => {
    const args = parseBackfillArgs([]);
    expect(args.apply).toBe(false);
    expect(args.language).toBeNull();
    expect(args.cefrLevel).toBeNull();
    expect(args.limit).toBeNull();
    expect(args.concurrency).toBeGreaterThan(0);
    expect(args.maxCostUsd).toBeGreaterThan(0);
  });

  it('parses --apply, --lang, --level, --limit, --concurrency, --max-cost-usd', () => {
    const args = parseBackfillArgs([
      '--apply',
      '--lang',
      'tr',
      '--level',
      'a1',
      '--limit',
      '25',
      '--concurrency',
      '6',
      '--max-cost-usd',
      '3',
    ]);
    expect(args.apply).toBe(true);
    expect(args.language).toBe(Language.TR);
    expect(args.cefrLevel).toBe(CefrLevel.A1);
    expect(args.limit).toBe(25);
    expect(args.concurrency).toBe(6);
    expect(args.maxCostUsd).toBe(3);
  });

  it('accepts --language and --cefr aliases', () => {
    const args = parseBackfillArgs(['--language', 'ES', '--cefr', 'B1']);
    expect(args.language).toBe(Language.ES);
    expect(args.cefrLevel).toBe(CefrLevel.B1);
  });

  it('rejects unknown languages, CEFR levels, and flags', () => {
    expect(() => parseBackfillArgs(['--lang', 'FR'])).toThrow();
    expect(() => parseBackfillArgs(['--level', 'Z9'])).toThrow();
    expect(() => parseBackfillArgs(['--bogus'])).toThrow(/Unrecognized/);
  });
});

// ---------------------------------------------------------------------------
// extractCellDescriptor
// ---------------------------------------------------------------------------

describe('extractCellDescriptor', () => {
  const GOOD = {
    type: 'conjugation',
    lemma: 'içmek',
    lemmaGloss: 'to drink',
    featureBundle: 'geçmiş zaman (-DI) · olumlu · 3. tekil şahıs (o)',
    targetForm: 'içti',
  };

  it('extracts the descriptor from a valid flat conjugation content', () => {
    const out = extractCellDescriptor(GOOD, 'TR');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.cell).toEqual({
        language: 'TR',
        lemma: 'içmek',
        lemmaGloss: 'to drink',
        featureBundle: 'geçmiş zaman (-DI) · olumlu · 3. tekil şahıs (o)',
        targetForm: 'içti',
      });
    }
  });

  it('skips a row that already has structured features', () => {
    const out = extractCellDescriptor(
      { ...GOOD, features: [{ term: 'x', gloss: 'y' }] },
      'TR',
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('already-structured');
  });

  it('skips a row whose content_json is not an object', () => {
    expect(extractCellDescriptor(null, 'TR').ok).toBe(false);
    expect(extractCellDescriptor('x', 'TR').ok).toBe(false);
  });

  it('skips a row missing a required string field', () => {
    const out = extractCellDescriptor({ ...GOOD, featureBundle: '' }, 'TR');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('missing-fields');
  });
});
