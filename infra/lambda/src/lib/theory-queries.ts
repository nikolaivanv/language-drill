import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { theoryTopics, curriculumOrderOf } from '@language-drill/db';
import { resolveTheoryCategory } from '@language-drill/shared';
import { db } from '../db';
import type { RelatedTheoryTopics, RelatedTopicRef } from './theory-related';

/**
 * The single definition of "approved theory content". Both the authenticated
 * theory router and the public one filter on this; a second copy is how a
 * public surface starts serving flagged content without anyone noticing.
 */
export const APPROVED_THEORY_STATUSES = ['auto-approved', 'manual-approved'] as const;

// Bounded to 80 chars — comfortably above the longest real slug — because this
// is now internet-facing and an unbounded `+` lets an arbitrarily long path
// reach the query layer.
export const THEORY_TOPIC_ID_REGEX = /^[a-z0-9-]{1,80}$/;

export type TheoryListRow = {
  id: string;
  title: string;
  cefr: string;
  subtitle: string | null;
  category: string;
  order: number | null;
  grammarPointKey: string | null;
};

/**
 * Approved topics for one language, enriched server-side with theory category
 * and curriculum order so no caller ships the curriculum to a browser.
 *
 * `total` is the count BEFORE the corrupt-row filter, so a caller can report
 * how many rows it dropped. The `title`/`cefr` NOT NULL guards are deliberately
 * the only ones in SQL: adding a `subtitle` guard here would change what the
 * already-shipped authenticated endpoint returns. Callers that need a subtitle
 * drop those rows themselves.
 */
export async function fetchApprovedTopicList(
  lang: string,
): Promise<{ rows: TheoryListRow[]; total: number }> {
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: theoryTopics.topicId,
        title: sql<string>`${theoryTopics.contentJson}->>'title'`,
        cefr: sql<string>`${theoryTopics.contentJson}->>'cefr'`,
        subtitle: sql<string | null>`${theoryTopics.contentJson}->>'subtitle'`,
        grammarPointKey: theoryTopics.grammarPointKey,
      })
      .from(theoryTopics)
      .where(
        and(
          eq(theoryTopics.language, lang),
          inArray(theoryTopics.reviewStatus, [...APPROVED_THEORY_STATUSES]),
          sql`${theoryTopics.contentJson}->>'title' IS NOT NULL`,
          sql`${theoryTopics.contentJson}->>'cefr' IS NOT NULL`,
        ),
      )
      .orderBy(sql`${theoryTopics.contentJson}->>'title' ASC`),
    db
      .select({ total: count() })
      .from(theoryTopics)
      .where(
        and(
          eq(theoryTopics.language, lang),
          inArray(theoryTopics.reviewStatus, [...APPROVED_THEORY_STATUSES]),
        ),
      ),
  ]);

  return {
    // Postgres returns a bigint count as a string over the wire.
    total: Number(totalRows[0]?.total ?? 0),
    rows: rows.map(({ grammarPointKey, ...rest }) => ({
      ...rest,
      grammarPointKey,
      category: resolveTheoryCategory(grammarPointKey),
      order: curriculumOrderOf(grammarPointKey ?? '') ?? null,
    })),
  };
}

/** The newest approved row for one topic, or null when there is none. */
export async function fetchApprovedTopicContent(
  lang: string,
  topicId: string,
): Promise<{ id: string; contentJson: unknown; grammarPointKey: string | null } | null> {
  const rows = await db
    .select({
      id: theoryTopics.id,
      contentJson: theoryTopics.contentJson,
      grammarPointKey: theoryTopics.grammarPointKey,
    })
    .from(theoryTopics)
    .where(
      and(
        eq(theoryTopics.language, lang),
        eq(theoryTopics.topicId, topicId),
        inArray(theoryTopics.reviewStatus, [...APPROVED_THEORY_STATUSES]),
      ),
    )
    .orderBy(sql`${theoryTopics.generatedAt} DESC NULLS LAST`)
    .limit(1);

  return rows.length === 0 ? null : rows[0];
}

/**
 * Keep only related candidates that actually have an approved theory page, so
 * no caller renders a dead link. Related links are an enhancement — on any
 * failure the topic still renders, with empty groups.
 */
export async function filterApprovedRelated(
  lang: string,
  related: RelatedTheoryTopics,
): Promise<RelatedTheoryTopics> {
  const slugs = [...related.buildsOn, ...related.leadsTo, ...related.siblings].map(
    (r) => r.topicId,
  );
  if (slugs.length === 0) return related;
  try {
    const rows = await db
      .select({ topicId: theoryTopics.topicId })
      .from(theoryTopics)
      .where(
        and(
          eq(theoryTopics.language, lang),
          inArray(theoryTopics.topicId, slugs),
          inArray(theoryTopics.reviewStatus, [...APPROVED_THEORY_STATUSES]),
        ),
      );
    const approved = new Set(rows.map((r) => r.topicId));
    const keep = (refs: RelatedTopicRef[]) => refs.filter((r) => approved.has(r.topicId));
    return {
      buildsOn: keep(related.buildsOn),
      leadsTo: keep(related.leadsTo),
      siblings: keep(related.siblings),
    };
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    console.error(`theory: related-topics approved-filter failed for ${lang}: ${message}`);
    return { buildsOn: [], leadsTo: [], siblings: [] };
  }
}
