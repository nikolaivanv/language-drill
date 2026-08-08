import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { BACKFILL_STEPS } from './backfill-demotion-reason';

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
