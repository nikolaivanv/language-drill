/**
 * Tests for the `pnpm review:flagged` CLI argument parser.
 *
 * Pure planning tests — no DB, no Claude, no stdin. Mirrors the
 * `parseGenerateArgs` test style.
 */

import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { describe, expect, it, vi } from 'vitest';

import { parseReviewArgs } from './review-flagged-parse-args';

describe('parseReviewArgs', () => {
  it('returns defaults when only --lang is provided', () => {
    expect(parseReviewArgs(['--lang', 'es'])).toEqual({
      lang: Language.ES,
      level: null,
      type: null,
      grammarPoint: null,
      limit: 20,
      allowProd: false,
    });
  });

  it('accepts every valid flag combination', () => {
    const args = parseReviewArgs([
      '--lang',
      'es',
      '--level',
      'B1',
      '--type',
      'cloze',
      '--grammar-point',
      'es-b1-present-subjunctive',
      '--limit',
      '50',
    ]);
    expect(args).toEqual({
      lang: Language.ES,
      level: CefrLevel.B1,
      type: ExerciseType.CLOZE,
      grammarPoint: 'es-b1-present-subjunctive',
      limit: 50,
      allowProd: false,
    });
  });

  it('uppercases --lang and --level (case-insensitive)', () => {
    const args = parseReviewArgs([
      '--lang',
      'de',
      '--level',
      'a2',
    ]);
    expect(args.lang).toBe(Language.DE);
    expect(args.level).toBe(CefrLevel.A2);
  });

  it('accepts C1 and C2 for --level', () => {
    expect(parseReviewArgs(['--lang', 'es', '--level', 'C1']).level).toBe(
      CefrLevel.C1,
    );
    expect(parseReviewArgs(['--lang', 'es', '--level', 'C2']).level).toBe(
      CefrLevel.C2,
    );
  });

  it('accepts every valid --type', () => {
    expect(
      parseReviewArgs(['--lang', 'es', '--type', 'translation']).type,
    ).toBe(ExerciseType.TRANSLATION);
    expect(
      parseReviewArgs(['--lang', 'es', '--type', 'vocab_recall']).type,
    ).toBe(ExerciseType.VOCAB_RECALL);
  });

  it('rejects --lang en with the EN exclusion message', () => {
    expect(() => parseReviewArgs(['--lang', 'en'])).toThrow(
      /not a learning language for generation/i,
    );
  });

  it('throws when --lang is missing', () => {
    expect(() => parseReviewArgs([])).toThrow(/--lang is required/);
  });

  it('throws on unknown --lang', () => {
    expect(() => parseReviewArgs(['--lang', 'fr'])).toThrow(
      /--lang must be one of ES, DE, TR/,
    );
  });

  it('throws on unknown --type', () => {
    expect(() =>
      parseReviewArgs(['--lang', 'es', '--type', 'speaking']),
    ).toThrow(/--type must be one of cloze, translation, vocab_recall/);
  });

  it('throws on unknown --level', () => {
    expect(() =>
      parseReviewArgs(['--lang', 'es', '--level', 'D1']),
    ).toThrow(/--level must be one of A1, A2, B1, B2, C1, C2/);
  });

  it('throws on out-of-range --limit (above max)', () => {
    expect(() =>
      parseReviewArgs(['--lang', 'es', '--limit', '201']),
    ).toThrow(/--limit must be in \[1, 200\]/);
  });

  it('throws on out-of-range --limit (below min)', () => {
    expect(() =>
      parseReviewArgs(['--lang', 'es', '--limit', '0']),
    ).toThrow(/--limit must be in \[1, 200\]/);
  });

  it('throws on non-integer --limit', () => {
    expect(() =>
      parseReviewArgs(['--lang', 'es', '--limit', 'abc']),
    ).toThrow(/--limit must be an integer/);
  });

  it('passes --grammar-point through verbatim with no curriculum lookup', () => {
    const args = parseReviewArgs([
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
      const args = parseReviewArgs(['--lang', 'es', '--allow-prod']);
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
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('__exit__');
      }) as never);
    try {
      expect(() => parseReviewArgs(['--help'])).toThrow('__exit__');
      expect(exitSpy).toHaveBeenCalledWith(0);
      const printed = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(printed).toMatch(/pnpm review:flagged/);
      expect(printed).toMatch(/--lang/);
      expect(printed).toMatch(/--level/);
      expect(printed).toMatch(/--type/);
      expect(printed).toMatch(/--grammar-point/);
      expect(printed).toMatch(/--limit/);
      expect(printed).toMatch(/--allow-prod/);
    } finally {
      stdoutSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
