/**
 * Scheduler-side vocab coverage counts (Spec 2). For each umbrella with
 * approved vocab_target rows, how many targets are approved and how many are
 * covered by an approved vocab_recall exercise. The scheduler feeds these as
 * (target, approvedInPool) into the unchanged decideEnqueue so
 * need = |uncovered targets| — the cell converges to full coverage then stops.
 * Uses the same normalizeWord as the read model + the generator's exclude.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { exercises, vocabTarget, type Db } from '@language-drill/db';
import { normalizeWord } from '@language-drill/shared';

export type VocabTargetCoverage = { approvedTargets: number; coveredTargets: number };

type TargetRow = {
  language: string;
  umbrellaKey: string;
  lemma: string;
  displayForm: string;
};

const APPROVED_STATUSES = ['auto-approved', 'manual-approved'] as const;

const keyOf = (language: string, umbrellaKey: string): string =>
  `${language}|${umbrellaKey}`;

/** Pure combine: approved-target count + distinct-covered count per umbrella. */
export function computeVocabTargetCoverage(
  targets: readonly TargetRow[],
  expectedWordsByUmbrella: ReadonlyMap<string, readonly string[]>,
): Map<string, VocabTargetCoverage> {
  const byUmbrella = new Map<string, TargetRow[]>();
  for (const t of targets) {
    const k = keyOf(t.language, t.umbrellaKey);
    const list = byUmbrella.get(k);
    if (list) list.push(t);
    else byUmbrella.set(k, [t]);
  }

  const out = new Map<string, VocabTargetCoverage>();
  for (const [k, rows] of byUmbrella) {
    const covered = new Set(
      (expectedWordsByUmbrella.get(k) ?? []).map((w) => normalizeWord(w)),
    );
    let coveredTargets = 0;
    for (const t of rows) {
      if (covered.has(normalizeWord(t.lemma)) || covered.has(normalizeWord(t.displayForm))) {
        coveredTargets += 1;
      }
    }
    out.set(k, { approvedTargets: rows.length, coveredTargets });
  }
  return out;
}

/** Two reads (approved targets; approved vocab_recall expectedWords) + combine. */
export async function loadVocabTargetCoveragePerUmbrella(
  db: Db,
): Promise<Map<string, VocabTargetCoverage>> {
  const targets = await db
    .select({
      language: vocabTarget.language,
      umbrellaKey: vocabTarget.umbrellaKey,
      lemma: vocabTarget.lemma,
      displayForm: vocabTarget.displayForm,
    })
    .from(vocabTarget)
    .where(eq(vocabTarget.status, 'approved'));

  const exRows = await db
    .select({
      language: exercises.language,
      umbrellaKey: exercises.grammarPointKey,
      word: sql<string>`content_json->>'expectedWord'`,
    })
    .from(exercises)
    .where(
      and(
        eq(exercises.type, 'vocab_recall'),
        inArray(exercises.reviewStatus, [...APPROVED_STATUSES]),
        sql`content_json ? 'expectedWord'`,
      ),
    );

  const expectedWordsByUmbrella = new Map<string, string[]>();
  for (const r of exRows) {
    if (r.umbrellaKey == null || typeof r.word !== 'string' || !r.word) continue;
    const k = keyOf(r.language ?? '', r.umbrellaKey);
    const list = expectedWordsByUmbrella.get(k);
    if (list) list.push(r.word);
    else expectedWordsByUmbrella.set(k, [r.word]);
  }

  return computeVocabTargetCoverage(targets, expectedWordsByUmbrella);
}
