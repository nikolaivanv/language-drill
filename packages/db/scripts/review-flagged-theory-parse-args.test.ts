/**
 * Tests for the `pnpm review:flagged-theory` CLI argument parser.
 *
 * Pure tests — no DB, no Claude, no stdin. Structural mirror of
 * `review-flagged-parse-args.test.ts` (exercise side), minus the `--type`
 * cases and with the C1/C2-rejection cases added (theory curriculum stops
 * at B2).
 */

import { CefrLevel, Language } from '@language-drill/shared';
import { describe, expect, it, vi } from 'vitest';

import { parseTheoryReviewArgs } from './review-flagged-theory-parse-args';

describe('parseTheoryReviewArgs', () => {
  it('returns defaults when only --lang is provided', () => {
    expect(parseTheoryReviewArgs(['--lang', 'es'])).toEqual({
      lang: Language.ES,
      level: null,
      grammarPoint: null,
      limit: 25,
      allowProd: false,
    });
  });

  it('accepts every valid flag combination', () => {
    const args = parseTheoryReviewArgs([
      '--lang',
      'es',
      '--level',
      'B1',
      '--grammar-point',
      'es-b1-present-subjunctive',
      '--limit',
      '50',
    ]);
    expect(args).toEqual({
      lang: Language.ES,
      level: CefrLevel.B1,
      grammarPoint: 'es-b1-present-subjunctive',
      limit: 50,
      allowProd: false,
    });
  });

  it('uppercases --lang and --level (case-insensitive)', () => {
    const args = parseTheoryReviewArgs(['--lang', 'de', '--level', 'a2']);
    expect(args.lang).toBe(Language.DE);
    expect(args.level).toBe(CefrLevel.A2);
  });

  it('accepts every theory-supported --level (A1..B2)', () => {
    for (const level of ['A1', 'A2', 'B1', 'B2'] as const) {
      expect(
        parseTheoryReviewArgs(['--lang', 'es', '--level', level]).level,
      ).toBe(level);
    }
  });

  it('rejects --level C1 with the B2-ceiling message', () => {
    expect(() =>
      parseTheoryReviewArgs(['--lang', 'es', '--level', 'C1']),
    ).toThrow(/--level must be one of A1, A2, B1, B2 .*Theory curriculum stops at B2/);
  });

  it('rejects --level C2 with the B2-ceiling message', () => {
    expect(() =>
      parseTheoryReviewArgs(['--lang', 'es', '--level', 'C2']),
    ).toThrow(/--level must be one of A1, A2, B1, B2/);
  });

  it('rejects --lang en with the explicit metalanguage message', () => {
    expect(() => parseTheoryReviewArgs(['--lang', 'en'])).toThrow(
      /--lang en is not a learning language/,
    );
  });

  it('throws when --lang is missing', () => {
    expect(() => parseTheoryReviewArgs([])).toThrow(/--lang is required/);
  });

  it('throws on unknown --lang', () => {
    expect(() => parseTheoryReviewArgs(['--lang', 'fr'])).toThrow(
      /--lang must be one of ES, DE, TR/,
    );
  });

  it('throws on unknown --level', () => {
    expect(() =>
      parseTheoryReviewArgs(['--lang', 'es', '--level', 'D1']),
    ).toThrow(/--level must be one of A1, A2, B1, B2/);
  });

  it('throws on out-of-range --limit (above max)', () => {
    expect(() =>
      parseTheoryReviewArgs(['--lang', 'es', '--limit', '201']),
    ).toThrow(/--limit must be in \[1, 200\]/);
  });

  it('throws on out-of-range --limit (below min)', () => {
    expect(() =>
      parseTheoryReviewArgs(['--lang', 'es', '--limit', '0']),
    ).toThrow(/--limit must be in \[1, 200\]/);
  });

  it('throws on non-integer --limit', () => {
    expect(() =>
      parseTheoryReviewArgs(['--lang', 'es', '--limit', 'abc']),
    ).toThrow(/--limit must be an integer/);
  });

  it('parses --limit 10 as 10', () => {
    expect(
      parseTheoryReviewArgs(['--lang', 'es', '--limit', '10']).limit,
    ).toBe(10);
  });

  it('passes --grammar-point through verbatim with no curriculum lookup', () => {
    const args = parseTheoryReviewArgs([
      '--lang',
      'es',
      '--grammar-point',
      'es-b1-no-such-thing-yet',
    ]);
    expect(args.grammarPoint).toBe('es-b1-no-such-thing-yet');
  });

  it('accepts --allow-prod outside production but emits a stderr warning', () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      const args = parseTheoryReviewArgs(['--lang', 'es', '--allow-prod']);
      expect(args.allowProd).toBe(true);
      const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(
        calls.some((line) =>
          /--allow-prod ignored: not running in production/.test(line),
        ),
      ).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('exits 0 with --help and prints usage', () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__exit__');
    }) as never);
    try {
      expect(() => parseTheoryReviewArgs(['--help'])).toThrow('__exit__');
      expect(exitSpy).toHaveBeenCalledWith(0);
      const printed = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(printed).toMatch(/pnpm review:flagged-theory/);
      expect(printed).toMatch(/--lang/);
      expect(printed).toMatch(/--level/);
      expect(printed).toMatch(/--grammar-point/);
      expect(printed).toMatch(/--limit/);
      expect(printed).toMatch(/--allow-prod/);
      // Example invocation appears in the help text.
      expect(printed).toMatch(
        /pnpm review:flagged-theory --lang es --level B1/,
      );
    } finally {
      stdoutSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
