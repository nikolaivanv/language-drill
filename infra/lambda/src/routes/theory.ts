import { Hono } from 'hono';
import { z } from 'zod';
import { parseTheoryTopicJson } from '@language-drill/shared';
import { deriveRelatedGrammarPoints } from '../lib/theory-related';
import {
  THEORY_TOPIC_ID_REGEX,
  fetchApprovedTopicList,
  fetchApprovedTopicContent,
  filterApprovedRelated,
} from '../lib/theory-queries';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Validation primitives
// ---------------------------------------------------------------------------

const LANGUAGE_SCHEMA = z.enum(['ES', 'DE', 'TR']);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const theory = new Hono<{ Bindings: Bindings; Variables: Variables }>();

theory.use('/theory/*', authMiddleware);

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
  if (!THEORY_TOPIC_ID_REGEX.test(topicId)) {
    return c.json({ error: 'Invalid topicId', code: 'VALIDATION_ERROR' }, 400);
  }

  try {
    const row = await fetchApprovedTopicContent(lang, topicId);

    if (!row) {
      return c.json({ error: 'Topic not found', code: 'TOPIC_NOT_FOUND' }, 404);
    }

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
    const { rows, total } = await fetchApprovedTopicList(lang);
    if (total > rows.length) {
      console.warn(
        `theory: dropped corrupt rows from list response`,
        { language: lang, dropped: total - rows.length },
      );
    }

    // `subtitle` and `grammarPointKey` are internal to the shared query
    // (category/order enrichment, plus a future public-route need) — neither
    // is part of this authenticated endpoint's wire contract, so strip both.
    const topics = rows.map(({ subtitle: _subtitle, grammarPointKey: _key, ...rest }) => rest);

    return c.json({ topics });
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    console.error(`theory: list query failed for ${lang}: ${message}`);
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default theory;
