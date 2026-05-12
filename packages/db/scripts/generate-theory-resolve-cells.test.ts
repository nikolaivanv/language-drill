/**
 * Tests for `resolveTheoryCells` — the pure cell resolver wired up between
 * the CLI argument parser and the orchestrator.
 *
 * Pinning every branch of the resolver: single-grammar-point happy path, the
 * four pre-checks (missing-from-curriculum, language mismatch, level
 * mismatch, vocab-umbrella reject), and the multi-cell branch including the
 * zero-cell error. Pure — no DB, no Claude, no I/O.
 */

import { type LearningLanguage } from '@language-drill/shared';
import { describe, expect, it } from 'vitest';

import { ALL_CURRICULA, esCurriculum } from '../src/curriculum';

import { resolveTheoryCells } from './generate-theory-resolve-cells';

// Fail fast if the curriculum ever ships with zero ES grammar entries — the
// suite below depends on a representative grammar entry to drive several of
// the single-grammar-point branches.
const esGrammarEntry = esCurriculum.find((e) => e.kind === 'grammar')!;
if (!esGrammarEntry) {
  throw new Error(
    'esCurriculum has no grammar entries — generate-theory-resolve-cells.test.ts depends on one',
  );
}

const baseArgs = {
  batchSeed: 'theory-v1',
  maxCostUsd: 1.0,
  concurrency: 1,
  dryRun: false,
  allowProd: false,
};

describe('generate-theory-resolve-cells > resolveTheoryCells', () => {
  it('returns every grammar cell for the language when level=all', () => {
    const cells = resolveTheoryCells(
      { ...baseArgs, lang: 'ES', level: 'all', grammarPoint: null },
      ALL_CURRICULA,
    );

    const expectedCount = ALL_CURRICULA.filter(
      (e) => e.language === 'ES' && e.kind === 'grammar',
    ).length;

    expect(cells.length).toBe(expectedCount);
    for (const cell of cells) {
      expect(cell.language).toBe('ES');
      expect(cell.grammarPoint.kind).toBe('grammar');
    }
  });

  it('filters cells to a single CEFR level when one is provided', () => {
    const cells = resolveTheoryCells(
      { ...baseArgs, lang: 'ES', level: 'B1', grammarPoint: null },
      ALL_CURRICULA,
    );

    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.cefrLevel).toBe('B1');
      expect(cell.language).toBe('ES');
    }
  });

  it('returns a single matching cell when --grammar-point pins one entry', () => {
    const cells = resolveTheoryCells(
      {
        ...baseArgs,
        lang: 'ES',
        level: esGrammarEntry.cefrLevel,
        grammarPoint: esGrammarEntry.key,
      },
      ALL_CURRICULA,
    );

    expect(cells.length).toBe(1);
    expect(cells[0].grammarPoint.key).toBe(esGrammarEntry.key);
  });

  const vocabEntry = ALL_CURRICULA.find((e) => e.kind === 'vocab');
  it.skipIf(!vocabEntry)(
    'rejects --grammar-point that points at a vocab umbrella (decision #6)',
    () => {
      expect(() =>
        resolveTheoryCells(
          {
            ...baseArgs,
            lang: vocabEntry!.language as LearningLanguage,
            level: 'all',
            grammarPoint: vocabEntry!.key,
          },
          ALL_CURRICULA,
        ),
      ).toThrow(/is a vocab umbrella.*resolved decision #6/);
    },
  );

  it('throws when --grammar-point belongs to a different language than --lang', () => {
    expect(() =>
      resolveTheoryCells(
        {
          ...baseArgs,
          lang: 'DE',
          level: 'all',
          grammarPoint: esGrammarEntry.key,
        },
        ALL_CURRICULA,
      ),
    ).toThrow(/not --lang DE/);
  });

  it('throws when --level disagrees with the --grammar-point entry CEFR level', () => {
    const wrongLevel = esGrammarEntry.cefrLevel === 'B1' ? 'A1' : 'B1';
    expect(() =>
      resolveTheoryCells(
        {
          ...baseArgs,
          lang: 'ES',
          level: wrongLevel,
          grammarPoint: esGrammarEntry.key,
        },
        ALL_CURRICULA,
      ),
    ).toThrow(/not --level/);
  });

  it('throws when --grammar-point is not in the curriculum', () => {
    expect(() =>
      resolveTheoryCells(
        {
          ...baseArgs,
          lang: 'ES',
          level: 'all',
          grammarPoint: 'es-b1-bogus-not-in-curriculum',
        },
        ALL_CURRICULA,
      ),
    ).toThrow(/not in curriculum/);
  });

  // DE A1: the German curriculum is currently entirely disabled (see
  // packages/db/src/curriculum/de.ts), so this combo produces zero cells.
  // If DE A1 grammar ever returns, the test is skipped — swap to another
  // empty combo at that point.
  const deA1HasGrammar = ALL_CURRICULA.some(
    (e) => e.language === 'DE' && e.cefrLevel === 'A1' && e.kind === 'grammar',
  );
  it.skipIf(deA1HasGrammar)(
    'throws with a "no cells resolved" message when (lang, level) yields zero cells',
    () => {
      expect(() =>
        resolveTheoryCells(
          { ...baseArgs, lang: 'DE', level: 'A1', grammarPoint: null },
          ALL_CURRICULA,
        ),
      ).toThrow(/no cells resolved/);
    },
  );
});
