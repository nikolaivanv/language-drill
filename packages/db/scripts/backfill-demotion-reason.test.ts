import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { BACKFILL_STEPS, previewBuckets } from './backfill-demotion-reason';
import type { Db } from '../src/client';
import type { DemotionReason } from '../src/lib/evidence';

const render = (i: number) => new PgDialect().sqlToQuery(BACKFILL_STEPS[i].predicate);

describe('BACKFILL_STEPS', () => {
  it('classifies in narrowest-first order so the catch-all cannot swallow the others', () => {
    expect(BACKFILL_STEPS.map((s) => s.reason)).toEqual([
      'quality',
      'learner-flag',
      'pool-hygiene',
    ]);
  });

  it('treats rows carrying validator reasons as quality demotions', () => {
    expect(render(0).sql.toLowerCase()).toContain('flagged_reasons');
  });

  it('matches upheld learner flags on resolved_rejected, not rejected', () => {
    const { sql, params } = render(1);
    const all = (sql + JSON.stringify(params)).toLowerCase();
    expect(all).toContain('resolved_rejected');
    expect(all).toContain('user_flag.reject');
  });

  it('files everything else still unclassified as pool hygiene', () => {
    expect(render(2).sql.toLowerCase()).toContain('demotion_reason');
  });

  it('scopes every step to rejected rows only', () => {
    for (let i = 0; i < BACKFILL_STEPS.length; i += 1) {
      expect(render(i).sql.toLowerCase()).toContain('review_status');
    }
  });
});

describe('previewBuckets', () => {
  it('classifies rows into mutually exclusive buckets via a single grouped query', async () => {
    // A row that would satisfy BOTH the quality predicate (flagged_reasons
    // set) AND the learner-flag predicate (also in the upheld-flag set) must
    // land in exactly one bucket, the narrowest — not both. A single grouped
    // query is inherently mutually exclusive (postgres GROUP BY cannot
    // double-assign a row); the regression this test guards against is code
    // that instead runs BACKFILL_STEPS.length independent `COUNT(*) WHERE
    // <predicate>` queries, one per step, which double-counts overlap rows.
    const groupedRows: { bucket: DemotionReason; n: number }[] = [
      { bucket: 'quality', n: 5 },
      { bucket: 'learner-flag', n: 1 },
      { bucket: 'pool-hygiene', n: 2 },
    ];
    let groupByCalls = 0;
    const chain = {
      from: () => chain,
      groupBy: () => {
        groupByCalls += 1;
        return Promise.resolve(groupedRows);
      },
    };
    const db = { select: () => chain } as unknown as Db;

    const counts = await previewBuckets(db);

    // Exactly one query — not one per BACKFILL_STEPS entry. The mock chain
    // exposes no `.where()`, so a regression back to per-predicate
    // independent counting would throw here instead of silently
    // over-counting.
    expect(groupByCalls).toBe(1);

    expect(counts.get('quality')).toBe(5);
    expect(counts.get('learner-flag')).toBe(1);
    expect(counts.get('pool-hygiene')).toBe(2);

    // The bucket counts must sum to the underlying row count, not exceed it
    // — the bug this guards against overstated the catch-all bucket by the
    // size of the narrower ones (observed on dev as 330 / 3 / 672 printed,
    // when the true partition summed to 672, not 1005).
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(8);
  });

  it('drops the unmatched group (rows already classified) from the result', async () => {
    // A row whose demotion_reason is already set matches none of the
    // BACKFILL_STEPS predicates (each requires demotion_reason IS NULL), so
    // the CASE expression falls through to its implicit NULL branch. Those
    // rows are out of scope for the preview/apply and must not appear under
    // a bogus `null` bucket.
    const groupedRows: { bucket: DemotionReason | null; n: number }[] = [
      { bucket: 'quality', n: 2 },
      { bucket: null, n: 99 },
    ];
    const chain = {
      from: () => chain,
      groupBy: () => Promise.resolve(groupedRows),
    };
    const db = { select: () => chain } as unknown as Db;

    const counts = await previewBuckets(db);

    expect([...counts.keys()]).toEqual(['quality']);
    expect(counts.get('quality')).toBe(2);
  });
});
