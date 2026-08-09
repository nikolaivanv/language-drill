import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { exercises } from '../schema';
import {
  DEMOTION_REASONS,
  NON_EVIDENCE_DEMOTION_REASONS,
  scoringEvidenceFilter,
} from './evidence';

describe('demotion reason vocabulary', () => {
  it('exposes the non-evidence set as a subset of the vocabulary', () => {
    for (const r of NON_EVIDENCE_DEMOTION_REASONS) {
      expect(DEMOTION_REASONS).toContain(r);
    }
  });

  it('keeps pool-hygiene demotions out of the non-evidence set', () => {
    expect(NON_EVIDENCE_DEMOTION_REASONS).not.toContain('duplicate');
    expect(NON_EVIDENCE_DEMOTION_REASONS).not.toContain('pool-hygiene');
  });
});

describe('scoringEvidenceFilter', () => {
  it('renders a coalesce-guarded NOT IN so NULL rows survive', () => {
    const { sql } = new PgDialect().sqlToQuery(scoringEvidenceFilter(exercises));
    const lower = sql.toLowerCase();
    expect(lower).toContain('coalesce');
    expect(lower).toContain('demotion_reason');
    expect(lower).toContain('not in');
    // Qualified reference — an unqualified column would be ambiguous once the
    // predicate is composed into a join against user_exercise_history.
    expect(lower).toContain('"exercises"."demotion_reason"');
  });

  it('binds every non-evidence reason as a parameter', () => {
    const { params } = new PgDialect().sqlToQuery(scoringEvidenceFilter(exercises));
    expect(params).toContain('quality');
    expect(params).toContain('learner-flag');
  });
});
