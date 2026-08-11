import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import { cellKeyOf, groupRowsIntoCells, parseAuditArgs, type LoadedRow } from './audit-collapse.js';

describe('cellKeyOf', () => {
  it('renders the canonical language:level:type:point key', () => {
    expect(cellKeyOf('ES', 'B1', ExerciseType.CLOZE, 'es-b1-impersonal-plural')).toBe(
      'ES:B1:cloze:es-b1-impersonal-plural',
    );
  });
});

describe('parseAuditArgs', () => {
  it('defaults to the PR #631 sweep thresholds', () => {
    const a = parseAuditArgs([]);
    expect(a.minRows).toBe(15);
    expect(a.threshold).toBe(0.65);
    expect(a.dryRun).toBe(false);
  });

  it('uppercases the language filter so `--language es` works', () => {
    expect(parseAuditArgs(['--language', 'es']).language).toBe('ES');
  });

  it('uppercases the cefr filter', () => {
    expect(parseAuditArgs(['--cefr', 'b1']).cefr).toBe('B1');
  });

  it('parses numeric flags', () => {
    const a = parseAuditArgs(['--min-rows', '25', '--threshold', '0.8', '--max-cost-usd', '5']);
    expect(a.minRows).toBe(25);
    expect(a.threshold).toBe(0.8);
    expect(a.maxCostUsd).toBe(5);
  });

  it('rejects a threshold outside (0, 1]', () => {
    expect(() => parseAuditArgs(['--threshold', '1.5'])).toThrow(/threshold/);
    expect(() => parseAuditArgs(['--threshold', '0'])).toThrow(/threshold/);
  });

  it('rejects a non-positive min-rows', () => {
    expect(() => parseAuditArgs(['--min-rows', '0'])).toThrow(/min-rows/);
  });

  it('--dry-run skips triage', () => {
    expect(parseAuditArgs(['--dry-run']).dryRun).toBe(true);
  });
});

describe('groupRowsIntoCells', () => {
  const row = (over: Partial<LoadedRow> = {}): LoadedRow => ({
    id: `id-${Math.random()}`,
    type: 'cloze',
    language: 'ES',
    difficulty: 'B1',
    grammarPointKey: 'es-b1-impersonal-plural',
    contentJson: { correctAnswer: 'Dicen' },
    coverageTags: null,
    ...over,
  });

  it('groups rows by (language, level, type, point) and resolves the target', () => {
    const cells = groupRowsIntoCells([row(), row(), row({ type: 'translation' })]);
    expect(cells).toHaveLength(2);
    const cloze = cells.find((c) => c.exerciseType === ExerciseType.CLOZE)!;
    expect(cloze.rows).toHaveLength(2);
    expect(cloze.target).toBeGreaterThan(0);
    expect(cloze.grammarPoint.key).toBe('es-b1-impersonal-plural');
  });

  it('drops rows whose grammar point is no longer in the curriculum', () => {
    expect(groupRowsIntoCells([row({ grammarPointKey: 'es-b1-deleted-point' })])).toHaveLength(0);
  });

  it('drops rows with a null grammar point key or an unknown exercise type', () => {
    expect(groupRowsIntoCells([row({ grammarPointKey: null })])).toHaveLength(0);
    expect(groupRowsIntoCells([row({ type: 'listening' })])).toHaveLength(0);
  });

  it('coerces a null contentJson to an empty object rather than throwing', () => {
    const cells = groupRowsIntoCells([row({ contentJson: null })]);
    expect(cells[0].rows[0].content).toEqual({});
  });

  it('sorts cells deterministically by cellKey', () => {
    const cells = groupRowsIntoCells([
      row({ type: 'translation' }),
      row({ type: 'cloze' }),
      row({ type: 'conjugation' }),
    ]);
    expect(cells.map((c) => c.cellKey)).toEqual([...cells.map((c) => c.cellKey)].sort());
  });
});
