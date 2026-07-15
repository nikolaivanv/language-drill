import { Hono } from 'hono';
import { z } from 'zod';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { theoryTopics, curriculumOrderOf } from '@language-drill/db';
import { parseTheoryTopicJson, resolveTheoryCategory } from '@language-drill/shared';
import { db } from '../db';
import {
  deriveRelatedGrammarPoints,
  type RelatedTheoryTopics,
  type RelatedTopicRef,
} from '../lib/theory-related';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Validation primitives
// ---------------------------------------------------------------------------

const LANGUAGE_SCHEMA = z.enum(['ES', 'DE', 'TR']);
const TOPIC_ID_REGEX = /^[a-z0-9-]+$/;
const APPROVED_STATUSES = ['auto-approved', 'manual-approved'] as const;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const theory = new Hono<{ Bindings: Bindings; Variables: Variables }>();

theory.use('/theory/*', authMiddleware);

// ---------------------------------------------------------------------------
// Related-topics enrichment: keep only candidates that actually have an
// approved theory page, so the client never renders a dead link. Related
// links are an enhancement — on any failure the topic still renders, with
// empty groups.
// ---------------------------------------------------------------------------
async function filterApprovedRelated(
  lang: z.infer<typeof LANGUAGE_SCHEMA>,
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
          inArray(theoryTopics.reviewStatus, [...APPROVED_STATUSES]),
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

// ---------------------------------------------------------------------------
// GET /theory/:lang/:topicId — return one approved theory topic as raw
// TheoryTopicJson (no envelope). 404 when no approved row exists.
// ---------------------------------------------------------------------------
theory.get('/theory/:lang/:topicId', async (c) => {
  const langParse = LANGUAGE_SCHEMA.safeParse(c.req.param('lang'));
  if (!langParse.success) {
    return c.json({ error: 'Invalid language', code: 'VALIDATION_ERROR' }, 400);
  }
  const lang = langParse.data;

  const topicId = c.req.param('topicId');
  if (!TOPIC_ID_REGEX.test(topicId)) {
    return c.json({ error: 'Invalid topicId', code: 'VALIDATION_ERROR' }, 400);
  }

  try {
    const rows = await db
      .select({ id: theoryTopics.id, contentJson: theoryTopics.contentJson })
      .from(theoryTopics)
      .where(
        and(
          eq(theoryTopics.language, lang),
          eq(theoryTopics.topicId, topicId),
          inArray(theoryTopics.reviewStatus, [...APPROVED_STATUSES]),
        ),
      )
      .orderBy(sql`${theoryTopics.generatedAt} DESC NULLS LAST`)
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: 'Topic not found', code: 'TOPIC_NOT_FOUND' }, 404);
    }

    const row = rows[0];
    try {
      const parsed = parseTheoryTopicJson(row.contentJson);
      // Additive enrichment: `related` is derived per-request from curriculum
      // data (prereq edges + theory category), NOT stored in content_json —
      // the generated-content contract stays untouched and clients that
      // predate the field ignore it (parseTheoryTopicJson picks known keys).
      const related = await filterApprovedRelated(
        lang,
        deriveRelatedGrammarPoints(lang, topicId),
      );
      return c.json({ ...parsed, related });
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : String(parseError);
      console.error(
        `theory: failed to parse content_json for row ${row.id}: ${message}`,
      );
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    console.error(
      `theory: DB query failed for (${lang}, ${topicId}): ${message}`,
    );
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /theory/:lang — list approved topics for a language as
// { topics: [{ id, title, cefr }] }, sorted by title. Corrupt rows missing
// `title`/`cefr` are filtered out at SQL and counted via warn log so an
// operator can see degraded data without the list endpoint 500ing.
// ---------------------------------------------------------------------------
theory.get('/theory/:lang', async (c) => {
  const langParse = LANGUAGE_SCHEMA.safeParse(c.req.param('lang'));
  if (!langParse.success) {
    return c.json({ error: 'Invalid language', code: 'VALIDATION_ERROR' }, 400);
  }
  const lang = langParse.data;

  try {
    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: theoryTopics.topicId,
          title: sql<string>`${theoryTopics.contentJson}->>'title'`,
          cefr: sql<string>`${theoryTopics.contentJson}->>'cefr'`,
          grammarPointKey: theoryTopics.grammarPointKey,
        })
        .from(theoryTopics)
        .where(
          and(
            eq(theoryTopics.language, lang),
            inArray(theoryTopics.reviewStatus, [...APPROVED_STATUSES]),
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
            inArray(theoryTopics.reviewStatus, [...APPROVED_STATUSES]),
          ),
        ),
    ]);

    const total = totalRows[0]?.total ?? 0;
    if (total > rows.length) {
      console.warn(
        `theory: dropped corrupt rows from list response`,
        { language: lang, dropped: total - rows.length },
      );
    }

    // Enrich each surviving row with its theory category and curriculum-order
    // position, both resolved from the topic's grammar-point key. Done here
    // (server-side) so the client groups/sorts without shipping curriculum
    // data to the browser. `grammarPointKey` itself is not part of the wire
    // contract — drop it after enrichment.
    const topics = rows.map(({ grammarPointKey, ...rest }) => ({
      ...rest,
      category: resolveTheoryCategory(grammarPointKey),
      order: curriculumOrderOf(grammarPointKey ?? '') ?? null,
    }));

    return c.json({ topics });
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    console.error(`theory: list query failed for ${lang}: ${message}`);
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default theory;
