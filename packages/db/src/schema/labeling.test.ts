import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { submissionLabels } from './labeling';

describe('labeling schema', () => {
  it('submission_labels has the expected columns', () => {
    const cfg = getTableConfig(submissionLabels);
    expect(cfg.name).toBe('submission_labels');
    const cols = cfg.columns.map((c) => c.name).sort();
    expect(cols).toEqual(
      [
        'id',
        'submission_id',
        'grade_ok',
        'feedback_ok',
        'tags',
        'critique',
        'stratum',
        'prompt_version',
        'labeled_by',
        'labeled_at',
      ].sort(),
    );
  });

  it('is unique per (submission, labeler) so re-labelling upserts', () => {
    const cfg = getTableConfig(submissionLabels);
    const uniqueIdxCols = cfg.indexes
      .filter((i) => i.config.unique)
      .flatMap((i) => (i.config.columns ?? []).map((c) => (c as { name: string }).name));
    expect(uniqueIdxCols).toEqual(expect.arrayContaining(['submission_id', 'labeled_by']));
  });

  it('nulls grade_ok and feedback_ok by default so "unsure" is representable', () => {
    const cfg = getTableConfig(submissionLabels);
    const byName = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(byName['grade_ok'].notNull).toBe(false);
    expect(byName['feedback_ok'].notNull).toBe(false);
    expect(byName['stratum'].notNull).toBe(true);
    expect(byName['labeled_by'].notNull).toBe(true);
  });

  it('does not foreign-key labeled_by, so labels survive the labeler', () => {
    const cfg = getTableConfig(submissionLabels);
    const fkCols = cfg.foreignKeys.flatMap((fk) =>
      fk.reference().columns.map((c) => c.name),
    );
    expect(fkCols).toEqual(['submission_id']);
  });
});
