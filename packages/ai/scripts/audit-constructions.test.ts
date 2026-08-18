import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import {
  parseAuditConstructionsArgs,
  groupRowsIntoCells,
} from './audit-constructions.js';

describe('parseAuditConstructionsArgs', () => {
  it('defaults the knobs to the spec values', () => {
    const f = parseAuditConstructionsArgs([]);
    expect(f.minRows).toBe(8);
    expect(f.samplePerCell).toBe(24);
    expect(f.maxCostUsd).toBe(2);
    expect(f.concurrency).toBe(4);
    expect(f.dryRun).toBe(false);
    expect(f.seed).toBe('default');
  });

  it('parses the filters', () => {
    const f = parseAuditConstructionsArgs([
      '--language', 'ES', '--cefr', 'B1', '--grammar-point', 'es-b1-reported-speech',
      '--max-points', '5', '--seed', 'abc', '--dry-run',
    ]);
    expect(f.language).toBe('ES');
    expect(f.cefr).toBe('B1');
    expect(f.grammarPoint).toBe('es-b1-reported-speech');
    expect(f.maxPoints).toBe(5);
    expect(f.seed).toBe('abc');
    expect(f.dryRun).toBe(true);
  });

  // The spec forbids a --limit alias: it already means rows in
  // revalidate:cloze and cells in backfill:variant-seeds.
  it('rejects --limit outright rather than guessing what it means', () => {
    expect(() => parseAuditConstructionsArgs(['--limit', '5'])).toThrow(/--max-points/);
  });

  it('rejects a non-positive --max-points', () => {
    expect(() => parseAuditConstructionsArgs(['--max-points', '0'])).toThrow(/max-points/);
  });

  it('rejects a sentence_construction type — out of scope', () => {
    expect(() => parseAuditConstructionsArgs(['--type', 'sentence_construction'])).toThrow(
      /cloze|translation/,
    );
  });
});

describe('groupRowsIntoCells', () => {
  it('groups by (grammarPointKey, type) and skips rows missing either', () => {
    const cells = groupRowsIntoCells([
      { id: '1', type: ExerciseType.CLOZE, grammarPointKey: 'p', contentJson: {} },
      { id: '2', type: ExerciseType.CLOZE, grammarPointKey: 'p', contentJson: {} },
      { id: '3', type: ExerciseType.TRANSLATION, grammarPointKey: 'p', contentJson: {} },
      { id: '4', type: ExerciseType.CLOZE, grammarPointKey: null, contentJson: {} },
    ]);
    expect(cells).toHaveLength(2);
    const cloze = cells.find((c) => c.type === ExerciseType.CLOZE);
    expect(cloze?.rows).toHaveLength(2);
    expect(cloze?.cellKey).toBe('p:cloze');
  });
});
