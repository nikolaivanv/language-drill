import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PgDialect } from 'drizzle-orm/pg-core';
import { freshFirstOrderBy } from './exercise-filters';

describe('freshFirstOrderBy', () => {
  it('orders never-seen first (nulls first), then oldest-seen, then random, binding the userId', () => {
    const { sql, params } = new PgDialect().sqlToQuery(freshFirstOrderBy('user_abc'));
    const lower = sql.toLowerCase();
    expect(lower).toContain('max(');
    expect(lower).toContain('nulls first');
    expect(lower).toContain('random()');
    expect(params).toContain('user_abc');
  });
});

// The route tests mock the db module, so a mocked query returns its canned rows
// no matter what the WHERE clause says — a behavioural test cannot prove the
// predicate is applied. This guards the next-best thing: that each scoring
// surface still references it, so deleting the filter fails a test rather than
// silently regressing every learner's scores.
const SCORING_SURFACES = [
  '../routes/progress.ts',
  '../routes/insights.ts',
  '../routes/sessions.ts',
  '../email/gather.ts',
];

describe('scoringEvidenceFilter call sites', () => {
  it.each(SCORING_SURFACES)('%s filters broken-exercise evidence', (rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    expect(src).toContain('scoringEvidenceFilter');
  });
});
