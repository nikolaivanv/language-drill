/**
 * Tests for the scheduler-side vocab-target coverage counts (Spec 2). Pure
 * `computeVocabTargetCoverage` unit tests first (TDD), then a `toSQL` guard
 * on the two reads `loadVocabTargetCoveragePerUmbrella` issues, then a
 * decide-passthrough check pinning the intended `decideEnqueue` semantics
 * once the scheduler feeds coverage-based `(approvedInPool, target)`.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { exercises, vocabTarget } from '@language-drill/db';

import { computeVocabTargetCoverage } from './vocab-target-coverage';
import { decideEnqueue } from './scheduler-decision';

describe('computeVocabTargetCoverage', () => {
  const targets = [
    { language: 'ES', umbrellaKey: 'es-a1-vocab-food-drink', lemma: 'manzana', displayForm: 'la manzana' },
    { language: 'ES', umbrellaKey: 'es-a1-vocab-food-drink', lemma: 'pan', displayForm: 'el pan' },
    { language: 'ES', umbrellaKey: 'es-a1-vocab-food-drink', lemma: 'agua', displayForm: 'el agua' },
  ];

  it('counts approved targets and distinct covered targets per umbrella', () => {
    // Two approved exercises: one for "manzana", one "el pan" (article form).
    const byUmbrella = new Map([
      ['ES|es-a1-vocab-food-drink', ['manzana', 'el pan']],
    ]);
    const out = computeVocabTargetCoverage(targets, byUmbrella);
    expect(out.get('ES|es-a1-vocab-food-drink')).toEqual({
      approvedTargets: 3,
      coveredTargets: 2, // manzana + pan (via displayForm normalize); agua uncovered
    });
  });

  it('reports zero covered when no exercises exist', () => {
    const out = computeVocabTargetCoverage(targets, new Map());
    expect(out.get('ES|es-a1-vocab-food-drink')).toEqual({
      approvedTargets: 3,
      coveredTargets: 0,
    });
  });

  it('keys per-umbrella, not globally, so unrelated umbrellas do not bleed', () => {
    const multi = [
      ...targets,
      { language: 'ES', umbrellaKey: 'es-a1-vocab-travel', lemma: 'billete', displayForm: 'el billete' },
    ];
    const byUmbrella = new Map([
      ['ES|es-a1-vocab-food-drink', ['manzana']],
      ['ES|es-a1-vocab-travel', ['billete']],
    ]);
    const out = computeVocabTargetCoverage(multi, byUmbrella);
    expect(out.get('ES|es-a1-vocab-food-drink')).toEqual({
      approvedTargets: 3,
      coveredTargets: 1,
    });
    expect(out.get('ES|es-a1-vocab-travel')).toEqual({
      approvedTargets: 1,
      coveredTargets: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// toSQL guard — the two reads `loadVocabTargetCoveragePerUmbrella` issues must
// render well-formed, unambiguous SQL. Mirrors the driver-less
// `new QueryBuilder()` pattern from `infra/lambda/src/routes/admin.test.ts`
// (the "drizzle projection subquery unqualified" hazard precedent) rather
// than the `drizzle({} as never)` snippet from the task brief, since that
// precedent already exists in this repo and is the simpler, proven pattern
// for rendering SQL with no live connection.
// ---------------------------------------------------------------------------

describe('loadVocabTargetCoveragePerUmbrella reads (toSQL guard)', () => {
  it('renders the vocab_target read against the approved-status column', async () => {
    const { QueryBuilder } = await import('drizzle-orm/pg-core');
    const qb = new QueryBuilder();

    const targetsSql = qb
      .select({ language: vocabTarget.language, umbrellaKey: vocabTarget.umbrellaKey })
      .from(vocabTarget)
      .where(eq(vocabTarget.status, 'approved'))
      .toSQL();
    expect(targetsSql.sql).toContain('vocab_target');
    expect(targetsSql.sql).toMatch(/"status"\s*=/);
  });

  it('renders the vocab_recall exercises read with the expectedWord JSON extraction', async () => {
    const { QueryBuilder } = await import('drizzle-orm/pg-core');
    const qb = new QueryBuilder();

    const exSql = qb
      .select({
        language: exercises.language,
        umbrellaKey: exercises.grammarPointKey,
        word: sql<string>`content_json->>'expectedWord'`,
      })
      .from(exercises)
      .where(
        and(
          eq(exercises.type, 'vocab_recall'),
          inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
          sql`content_json ? 'expectedWord'`,
        ),
      )
      .toSQL();
    expect(exSql.sql).toContain('exercises');
    expect(exSql.sql).toContain("content_json->>'expectedWord'");
  });
});

// ---------------------------------------------------------------------------
// Decide-passthrough — pins the intended semantics once the scheduler feeds
// coverage-based (approvedInPool, target) into the UNCHANGED decideEnqueue.
// ---------------------------------------------------------------------------

const vocabCell = {
  cefrLevel: 'A1',
  language: 'ES',
  exerciseType: 'vocab_recall',
  grammarPoint: { key: 'es-a1-vocab-food-drink' },
  cellKey: 'es:a1:vocab_recall:es-a1-vocab-food-drink',
} as never;

describe('coverage-aware need (via decideEnqueue)', () => {
  it('enqueues need = uncovered when targets remain', () => {
    // approvedTargets 30, coveredTargets 4 → target 30, approvedInPool 4.
    expect(decideEnqueue(vocabCell, 4, 30, null, undefined)).toEqual({
      kind: 'enqueue',
      need: 26,
    });
  });

  it('skips when every target is covered', () => {
    expect(decideEnqueue(vocabCell, 30, 30, null, undefined)).toEqual({
      kind: 'skip-target-reached',
    });
  });
});
