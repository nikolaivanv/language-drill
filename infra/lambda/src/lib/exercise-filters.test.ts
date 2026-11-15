import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ALL_CURRICULA, exercises } from '@language-drill/db';
import { freshFirstOrderBy, inCurriculumFilter, inCurriculumSql } from './exercise-filters';

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

// Points removed from the curriculum on 2026-06-07 whose rows kept being served
// until 2026-11-15 — the regression these predicates exist for.
const REMOVED_KEYS = ['tr-a1-everyday-vocab', 'tr-a2-everyday-vocab'];

describe('inCurriculumFilter', () => {
  it('keeps NULL-keyed rows and binds every live curriculum key, never a removed one', () => {
    const { sql, params } = new PgDialect().sqlToQuery(inCurriculumFilter(exercises));
    expect(sql).toContain('"grammar_point_key" is null');
    expect(sql.toLowerCase()).toContain(' in (');
    expect(params).toHaveLength(ALL_CURRICULA.length);
    expect(params).toEqual(expect.arrayContaining(['tr-a1-vocab-home-objects', 'es-a2-imperfect']));
    for (const key of REMOVED_KEYS) expect(params).not.toContain(key);
  });
});

describe('inCurriculumSql', () => {
  it('renders the same predicate against the given raw column, one bound param per key', () => {
    const { sql, params } = new PgDialect().sqlToQuery(inCurriculumSql('e.grammar_point_key'));
    expect(sql).toMatch(/^\(e\.grammar_point_key IS NULL OR e\.grammar_point_key IN \(\$1, \$2/);
    expect(params).toHaveLength(ALL_CURRICULA.length);
    expect(params).toContain('tr-a1-vocab-home-objects');
    for (const key of REMOVED_KEYS) expect(params).not.toContain(key);
  });
});

// Same file-level guard as the scoring one below: route tests mock the filter
// module, so they can only prove a call, not that every pool-discovery file
// still applies the predicate. A new pool draw in one of these files that
// forgets it is not caught here; a file that drops it entirely is.
const POOL_DISCOVERY_SURFACES = [
  '../routes/exercises.ts',
  '../routes/sessions.ts',
  '../routes/fluency.ts',
  '../routes/public.ts',
];

describe('inCurriculum call sites', () => {
  it.each(POOL_DISCOVERY_SURFACES)('%s gates its pool draws on curriculum membership', (rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    expect(src).toMatch(/inCurriculum(Filter|Sql)\(/);
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
