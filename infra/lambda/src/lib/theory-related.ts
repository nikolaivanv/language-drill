import {
  ALL_CURRICULA,
  curriculumOrderOf,
  getGrammarPoint,
  type GrammarPoint,
} from '@language-drill/db';
import { FALLBACK_CATEGORY_ID, resolveTheoryCategory } from '@language-drill/shared';

/**
 * Related-topics derivation for the theory detail endpoint. Pure curriculum
 * data — no I/O; the route intersects the result with approved theory rows.
 *
 * Three tiers, disjoint, in priority order:
 *  - buildsOn:  the point's own prerequisiteKeys (curated, directional)
 *  - leadsTo:   points that declare this one as a prerequisite (reverse edges)
 *  - siblings:  same theory category, ranked by CEFR then curriculum-order
 *               proximity, filling up to TOTAL_RELATED_CAP overall
 *
 * Future tier (book-coverage ledger, 2026-07-15 design doc): points claiming
 * sections of the same reference-grammar chapter — slot between leadsTo and
 * siblings once the per-language ledgers land.
 */

export type RelatedTopicRef = {
  /** Theory topic slug (grammar-point key minus the language prefix). */
  topicId: string;
  title: string;
  cefr: string;
};

export type RelatedTheoryTopics = {
  buildsOn: RelatedTopicRef[];
  leadsTo: RelatedTopicRef[];
  siblings: RelatedTopicRef[];
};

export const TOTAL_RELATED_CAP = 6;

const CEFR_INDEX: Record<string, number> = { A1: 0, A2: 1, B1: 2, B2: 3 };

function toRef(gp: GrammarPoint, languagePrefix: string): RelatedTopicRef {
  return {
    topicId: gp.key.slice(languagePrefix.length),
    title: gp.name,
    cefr: gp.cefrLevel,
  };
}

export function deriveRelatedGrammarPoints(
  language: 'ES' | 'DE' | 'TR',
  topicId: string,
): RelatedTheoryTopics {
  const prefix = `${language.toLowerCase()}-`;
  const key = `${prefix}${topicId}`;
  const gp = getGrammarPoint(key);
  if (!gp || gp.kind !== 'grammar' || gp.language !== language) {
    return { buildsOn: [], leadsTo: [], siblings: [] };
  }

  const pool = ALL_CURRICULA.filter(
    (p) => p.language === language && p.kind === 'grammar' && p.key !== key,
  );

  const buildsOn = (gp.prerequisiteKeys ?? [])
    .map((k) => getGrammarPoint(k))
    .filter((p): p is GrammarPoint => p !== undefined && p.kind === 'grammar');

  const leadsTo = pool.filter((p) => (p.prerequisiteKeys ?? []).includes(key));

  const taken = new Set([key, ...buildsOn.map((p) => p.key), ...leadsTo.map((p) => p.key)]);
  const category = resolveTheoryCategory(key);
  const siblingBudget = Math.max(0, TOTAL_RELATED_CAP - buildsOn.length - leadsTo.length);
  const order = curriculumOrderOf(key) ?? 0;
  const cefr = CEFR_INDEX[gp.cefrLevel] ?? 0;
  const siblings =
    category === FALLBACK_CATEGORY_ID
      ? [] // 'other' is a junk drawer, not a relatedness signal
      : pool
          .filter((p) => !taken.has(p.key) && resolveTheoryCategory(p.key) === category)
          .sort((a, b) => {
            const byCefr =
              Math.abs((CEFR_INDEX[a.cefrLevel] ?? 0) - cefr) -
              Math.abs((CEFR_INDEX[b.cefrLevel] ?? 0) - cefr);
            if (byCefr !== 0) return byCefr;
            return (
              Math.abs((curriculumOrderOf(a.key) ?? 0) - order) -
              Math.abs((curriculumOrderOf(b.key) ?? 0) - order)
            );
          })
          .slice(0, siblingBudget);

  return {
    buildsOn: buildsOn.map((p) => toRef(p, prefix)),
    leadsTo: leadsTo.map((p) => toRef(p, prefix)),
    siblings: siblings.map((p) => toRef(p, prefix)),
  };
}
