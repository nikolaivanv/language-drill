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
// predicate is applied. This guards the next-best thing: that each FILE
// hosting a scoring surface still references the filter somewhere in it.
//
// This is a file-level guard, not a per-call-site one: `exercise-filters.ts`'s
// own doc comment lists EIGHT scoring call sites living across these FIVE
// files (progress.ts, insights.ts and sessions.ts host more than one apiece;
// gather.ts and mastery/rank-context.ts one each). A single
// `toContain('scoringEvidenceFilter')` per file passes as long as ONE call
// site in that file still uses it — dropping the filter from up to three of
// the eight (one each from progress.ts, insights.ts and sessions.ts) would
// not fail this test. Widening it to a real per-call-site check would mean
// asserting on line numbers or AST shape, which is more brittle than the
// behavioural test this file already can't do; the trade-off accepted here
// is coarse-but-durable over precise-but-fragile.
//
// Keep this list in step with that doc comment: a new scoring surface in a
// NEW file is invisible to this guard until it is added here, which is
// exactly how mastery/rank-context.ts went unguarded when it was introduced.
const SCORING_SURFACES = [
  '../routes/progress.ts',
  '../routes/insights.ts',
  '../routes/sessions.ts',
  '../email/gather.ts',
  './mastery/rank-context.ts',
];

describe('scoringEvidenceFilter call sites', () => {
  it.each(SCORING_SURFACES)('%s filters broken-exercise evidence', (rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    expect(src).toContain('scoringEvidenceFilter');
  });
});
