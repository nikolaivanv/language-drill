/**
 * Tests for the `pnpm generate:theory` CLI argument parser.
 *
 * Pure parsing tests — no DB, no Claude, no stdin. Mirrors the
 * `parseReviewArgs` / `parseGenerateArgs` test style and pins the argv
 * contract documented in spec
 * `.claude/specs/theory-generation-phase-2/requirements.md` §Requirement 6.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseTheoryGenerateArgs } from './generate-theory-parse-args';

describe('generate-theory-parse-args > parseTheoryGenerateArgs', () => {
  it('returns defaults when only --lang is provided', () => {
    expect(parseTheoryGenerateArgs(['--lang', 'es'])).toEqual({
      lang: 'ES',
      level: 'all',
      grammarPoint: null,
      batchSeed: 'theory-v1',
      maxCostUsd: 1.0,
      concurrency: 1,
      dryRun: false,
      allowProd: false,
    });
  });

  it('rejects --lang en with the EN exclusion message (decision #5)', () => {
    expect(() => parseTheoryGenerateArgs(['--lang', 'en'])).toThrow(
      /--lang en is not a learning language for theory generation.*resolved decision #5/,
    );
  });

  it('throws when --lang is missing', () => {
    expect(() => parseTheoryGenerateArgs([])).toThrow(/lang/);
  });

  it('throws on unknown --level (C1 is not a curriculum level)', () => {
    expect(() =>
      parseTheoryGenerateArgs(['--lang', 'es', '--level', 'C1']),
    ).toThrow(/--level must be one of A1, A2, B1, B2, all/);
  });

  it('normalizes lowercase --level to uppercase', () => {
    expect(
      parseTheoryGenerateArgs(['--lang', 'es', '--level', 'b1']).level,
    ).toBe('B1');
  });

  it("accepts --level 'all' explicitly", () => {
    expect(
      parseTheoryGenerateArgs(['--lang', 'es', '--level', 'all']).level,
    ).toBe('all');
  });

  it.each([['0'], ['6'], ['abc']])(
    'rejects invalid --concurrency value %s',
    (value) => {
      expect(() =>
        parseTheoryGenerateArgs(['--lang', 'es', '--concurrency', value]),
      ).toThrow();
    },
  );

  it.each([['0'], ['-1'], ['abc']])(
    'rejects invalid --max-cost-usd value %s',
    (value) => {
      expect(() =>
        parseTheoryGenerateArgs(['--lang', 'es', '--max-cost-usd', value]),
      ).toThrow();
    },
  );

  it('accepts a custom --batch-seed verbatim', () => {
    expect(
      parseTheoryGenerateArgs(['--lang', 'es', '--batch-seed', 'theory-v2'])
        .batchSeed,
    ).toBe('theory-v2');
  });

  it('passes --grammar-point through verbatim with no curriculum lookup', () => {
    expect(
      parseTheoryGenerateArgs([
        '--lang',
        'es',
        '--grammar-point',
        'es-b1-x',
      ]).grammarPoint,
    ).toBe('es-b1-x');
  });

  describe('--allow-prod warning', () => {
    let stderrSpy: ReturnType<typeof vi.spyOn>;
    const originalNodeEnv = process.env['NODE_ENV'];

    beforeEach(() => {
      delete process.env['NODE_ENV'];
      stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
    });

    afterEach(() => {
      stderrSpy.mockRestore();
      if (originalNodeEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = originalNodeEnv;
      }
    });

    it('emits a stderr warning exactly once when --allow-prod is passed outside production', () => {
      const parsed = parseTheoryGenerateArgs(['--lang', 'es', '--allow-prod']);
      expect(parsed.allowProd).toBe(true);
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy).toHaveBeenCalledWith(
        '--allow-prod ignored: not running in production\n',
      );
    });
  });
});
