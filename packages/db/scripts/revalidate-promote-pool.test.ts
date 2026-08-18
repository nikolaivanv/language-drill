import { describe, it, expect } from 'vitest';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';

import { parsePromoteArgs } from './revalidate-promote-pool';

// A real curriculum key, so `--grammar-point` validation passes. Using the
// point this generalization was written for keeps the fixture honest.
const GP = 'es-b1-reported-speech';

// ---------------------------------------------------------------------------
// parsePromoteArgs
// ---------------------------------------------------------------------------

describe('parsePromoteArgs', () => {
  it('defaults to dry-run with no filters beyond the required type', () => {
    const args = parsePromoteArgs(['--type', 'sentence_construction']);
    expect(args.apply).toBe(false);
    expect(args.exerciseType).toBe(ExerciseType.SENTENCE_CONSTRUCTION);
    expect(args.grammarPoints).toEqual([]);
    expect(args.language).toBeNull();
    expect(args.cefrLevel).toBeNull();
    expect(args.limit).toBeNull();
    expect(args.concurrency).toBeGreaterThan(0);
    expect(args.maxCostUsd).toBeGreaterThan(0);
  });

  it('parses --apply, --language, --cefr, --limit, --concurrency, --max-cost-usd', () => {
    const args = parsePromoteArgs([
      '--type',
      'sentence_construction',
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
    const args = parsePromoteArgs([
      '--type',
      'sentence_construction',
      '--lang',
      'ES',
      '--level',
      'B2',
    ]);
    expect(args.language).toBe(Language.ES);
    expect(args.cefrLevel).toBe(CefrLevel.B2);
  });

  it('--dry-run overrides a prior --apply', () => {
    const args = parsePromoteArgs(['--type', 'sentence_construction', '--apply', '--dry-run']);
    expect(args.apply).toBe(false);
  });

  it('rejects unknown languages', () => {
    expect(() =>
      parsePromoteArgs(['--type', 'sentence_construction', '--language', 'FR']),
    ).toThrow();
  });

  it('rejects unknown CEFR levels', () => {
    expect(() => parsePromoteArgs(['--type', 'sentence_construction', '--cefr', 'D3'])).toThrow();
  });

  it('rejects unrecognized flags', () => {
    expect(() => parsePromoteArgs(['--type', 'sentence_construction', '--bogus'])).toThrow(
      /Unrecognized argument/,
    );
  });

  it('rejects --limit values that are not positive integers', () => {
    const base = ['--type', 'sentence_construction'];
    expect(() => parsePromoteArgs([...base, '--limit', '0'])).toThrow();
    expect(() => parsePromoteArgs([...base, '--limit', '-5'])).toThrow();
    expect(() => parsePromoteArgs([...base, '--limit', 'abc'])).toThrow();
  });

  // -------------------------------------------------------------------------
  // --type: required, so a promote pass can never sweep the whole pool by
  // omission. The historical SC sweep (#606) must stay expressible.
  // -------------------------------------------------------------------------

  it('requires --type', () => {
    expect(() => parsePromoteArgs([])).toThrow(/--type is required/);
    expect(() => parsePromoteArgs(['--grammar-point', GP])).toThrow(/--type is required/);
  });

  it('rejects an unknown --type', () => {
    expect(() => parsePromoteArgs(['--type', 'clozy'])).toThrow(/--type/);
  });

  it('rejects --type without a value', () => {
    expect(() => parsePromoteArgs(['--type'])).toThrow(/requires a value/);
  });

  it('accepts every exercise type it is given by name', () => {
    expect(parsePromoteArgs(['--type', 'cloze', '--grammar-point', GP]).exerciseType).toBe(
      ExerciseType.CLOZE,
    );
    expect(parsePromoteArgs(['--type', 'translation', '--grammar-point', GP]).exerciseType).toBe(
      ExerciseType.TRANSLATION,
    );
  });

  // -------------------------------------------------------------------------
  // --grammar-point: the promote policy is only justified where a specific
  // validator over-flag bug was fixed, so anything other than the historical
  // pool-wide SC sweep must name the points it has that evidence for.
  // -------------------------------------------------------------------------

  it('requires --grammar-point for any type other than sentence_construction', () => {
    expect(() => parsePromoteArgs(['--type', 'cloze'])).toThrow(/--grammar-point is required/);
    expect(() => parsePromoteArgs(['--type', 'translation'])).toThrow(
      /--grammar-point is required/,
    );
  });

  it('does not require --grammar-point for sentence_construction', () => {
    expect(parsePromoteArgs(['--type', 'sentence_construction']).grammarPoints).toEqual([]);
  });

  it('accepts --grammar-point for sentence_construction too', () => {
    const args = parsePromoteArgs([
      '--type',
      'sentence_construction',
      '--grammar-point',
      'es-b1-conditional',
    ]);
    expect(args.grammarPoints).toEqual(['es-b1-conditional']);
  });

  it('rejects an unknown grammar point', () => {
    expect(() => parsePromoteArgs(['--type', 'cloze', '--grammar-point', 'es-b1-nope'])).toThrow(
      /unknown grammar point/,
    );
  });

  it('rejects --grammar-point without a value', () => {
    expect(() => parsePromoteArgs(['--type', 'cloze', '--grammar-point'])).toThrow(
      /requires a value/,
    );
  });

  it('is repeatable and de-duplicates', () => {
    const args = parsePromoteArgs([
      '--type',
      'cloze',
      '--grammar-point',
      GP,
      '--grammar-point',
      'es-b1-conditional',
      '--grammar-point',
      GP,
    ]);
    expect(args.grammarPoints).toEqual([GP, 'es-b1-conditional']);
  });
});
