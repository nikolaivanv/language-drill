/**
 * Schema-shape regression test for the Phase 1 theory tables. Gated on
 * `TEST_DATABASE_URL` — without it, the entire suite skips and the local
 * run passes (matching the pattern in
 * `packages/db/src/generation/run-one-cell.test.ts`). Migrations 0008 + 0009
 * must already be applied to the target branch — this test does NOT run
 * migrations itself.
 */

import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import type { TheoryTopicJson } from '@language-drill/shared';

import { createDb, type Db } from '../client';
import { theoryTopics } from './theory';

/**
 * Drizzle wraps the underlying postgres error in a `DrizzleQueryError` whose
 * top-level message is `Failed query: …`; the actual postgres error (with
 * the constraint name we want to assert against) lives on `error.cause`.
 * `expect(...).rejects.toThrow(regex)` only matches `error.message`, so we
 * use this helper to walk the cause chain instead.
 */
async function expectRejectsWithMessage(
  promise: Promise<unknown>,
  regex: RegExp,
): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    const haystack = [err.message, err.cause?.message ?? ''].join('\n');
    if (!regex.test(haystack)) {
      throw new Error(
        `expected rejection to match ${regex}, got:\n  message: ${err.message}\n  cause:   ${err.cause?.message ?? '<none>'}`,
      );
    }
    return;
  }
  throw new Error(`expected promise to reject with ${regex}, but it resolved`);
}

const MINIMAL_CONTENT: TheoryTopicJson = {
  id: 't',
  title: 'x',
  subtitle: 'x',
  cefr: 'B1',
  sections: [
    {
      id: 's',
      title: 's',
      body: [{ kind: 'paragraph', text: [{ kind: 'text', text: 'hello' }] }],
    },
  ],
};

describe.skipIf(!process.env['TEST_DATABASE_URL'])(
  'theory schema — shape regression',
  () => {
    let db: Db;

    beforeAll(() => {
      db = createDb(process.env['TEST_DATABASE_URL']!);
    });

    beforeEach(async () => {
      await db.execute(sql`DELETE FROM theory_topics`);
      await db.execute(sql`DELETE FROM theory_generation_jobs`);
    });

    afterAll(async () => {
      await db.execute(sql`DELETE FROM theory_topics`);
      await db.execute(sql`DELETE FROM theory_generation_jobs`);
    });

    // -----------------------------------------------------------------------
    // Column shape
    // -----------------------------------------------------------------------

    it('theory_topics has all 14 columns with the expected nullability', async () => {
      const result = await db.execute(sql`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'theory_topics'
        ORDER BY column_name
      `);
      const rows = result.rows as Array<{
        column_name: string;
        is_nullable: 'YES' | 'NO';
      }>;
      expect(rows).toHaveLength(14);

      const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
      // NOT NULL columns
      for (const col of [
        'id',
        'language',
        'grammar_point_key',
        'topic_id',
        'cefr_level',
        'content_json',
        'generation_source',
        'review_status',
        'created_at',
        'updated_at',
      ]) {
        expect(byName[col]?.is_nullable).toBe('NO');
      }
      // Nullable columns
      for (const col of [
        'model_id',
        'quality_score',
        'flagged_reasons',
        'generated_at',
      ]) {
        expect(byName[col]?.is_nullable).toBe('YES');
      }
    });

    it('theory_generation_jobs has all 13 columns with the expected nullability', async () => {
      const result = await db.execute(sql`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'theory_generation_jobs'
        ORDER BY column_name
      `);
      const rows = result.rows as Array<{
        column_name: string;
        is_nullable: 'YES' | 'NO';
      }>;
      expect(rows).toHaveLength(13);

      const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
      for (const col of ['id', 'cell_key', 'status', 'trigger', 'started_at']) {
        expect(byName[col]?.is_nullable).toBe('NO');
      }
      for (const col of [
        'finished_at',
        'input_tokens_used',
        'output_tokens_used',
        'cost_usd_estimate',
        'approved',
        'flagged',
        'rejected',
        'error_message',
      ]) {
        expect(byName[col]?.is_nullable).toBe('YES');
      }
    });

    // -----------------------------------------------------------------------
    // Indices
    // -----------------------------------------------------------------------

    it('theory_topics has both pool-lookup and panel indices', async () => {
      const result = await db.execute(sql`
        SELECT indexname FROM pg_indexes WHERE tablename = 'theory_topics'
      `);
      const indexNames = (result.rows as Array<{ indexname: string }>).map(
        (r) => r.indexname,
      );
      expect(indexNames).toEqual(
        expect.arrayContaining([
          'theory_topics_pool_lookup_idx',
          'theory_topics_panel_idx',
        ]),
      );
    });

    it('theory_generation_jobs has the cell-key descending index', async () => {
      const result = await db.execute(sql`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'theory_generation_jobs'
      `);
      const indexNames = (result.rows as Array<{ indexname: string }>).map(
        (r) => r.indexname,
      );
      expect(indexNames).toContain('theory_generation_jobs_cell_idx');
    });

    // -----------------------------------------------------------------------
    // CHECK constraints (each constraint is exercised by one bad INSERT)
    // -----------------------------------------------------------------------

    const validRow = () => ({
      id: randomUUID(),
      language: 'ES',
      grammarPointKey: 'es-b1-test',
      topicId: 'b1-test',
      cefrLevel: 'B1',
      contentJson: MINIMAL_CONTENT,
    });

    it('rejects an invalid language (FR) via theory_topics_language_check', async () => {
      await expectRejectsWithMessage(
        db.insert(theoryTopics).values({ ...validRow(), language: 'FR' }),
        /theory_topics_language_check/,
      );
    });

    it('rejects an invalid cefr_level (C1) via theory_topics_cefr_check', async () => {
      await expectRejectsWithMessage(
        db.insert(theoryTopics).values({ ...validRow(), cefrLevel: 'C1' }),
        /theory_topics_cefr_check/,
      );
    });

    it('rejects an invalid generation_source via theory_topics_generation_source_check', async () => {
      await expectRejectsWithMessage(
        db
          .insert(theoryTopics)
          .values({ ...validRow(), generationSource: 'bogus' }),
        /theory_topics_generation_source_check/,
      );
    });

    it('rejects an invalid review_status via theory_topics_review_status_check', async () => {
      await expectRejectsWithMessage(
        db
          .insert(theoryTopics)
          .values({ ...validRow(), reviewStatus: 'bogus' }),
        /theory_topics_review_status_check/,
      );
    });

    // -----------------------------------------------------------------------
    // Unique partial pool-lookup index
    // -----------------------------------------------------------------------

    it('blocks a second auto-approved row with the same (language, grammar_point_key)', async () => {
      await db.insert(theoryTopics).values({
        ...validRow(),
        reviewStatus: 'auto-approved',
      });

      await expectRejectsWithMessage(
        db.insert(theoryTopics).values({
          ...validRow(),
          // Same language + grammar_point_key as the first row, different id.
          reviewStatus: 'auto-approved',
        }),
        /theory_topics_pool_lookup_idx/,
      );
    });

    it('allows a rejected row alongside an auto-approved one (partial index excludes rejected)', async () => {
      await db.insert(theoryTopics).values({
        ...validRow(),
        reviewStatus: 'auto-approved',
      });
      // A second row with the same cell but review_status='rejected'
      // is outside the partial unique index — should succeed.
      await db.insert(theoryTopics).values({
        ...validRow(),
        reviewStatus: 'rejected',
      });

      const count = await db.execute(
        sql`SELECT count(*)::int AS n FROM theory_topics`,
      );
      const n = (count.rows[0] as { n: number }).n;
      expect(n).toBe(2);
    });
  },
);
