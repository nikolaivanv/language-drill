import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';
import {
  parseBackfillArgs,
  isEligible,
  toClassifierRow,
  type CandidateRow,
} from './backfill-variant-seeds';
import { selectWrites, summarize, type ArtifactEntry } from './backfill-variant-seeds';
import { applyWrites, applyAndPersist, type Artifact } from './backfill-variant-seeds';
import type { ClassifierAssignment } from '@language-drill/ai';

const withVariants = {
  key: 'es-b1-que-vs-cual',
  kind: 'grammar',
  constructionVariants: [
    { id: 'que-definition-of-concept', directive: 'A' },
    { id: 'que-before-noun', directive: 'B' },
  ],
} as unknown as GrammarPoint;

const noVariants = { key: 'es-b1-plain', kind: 'grammar' } as unknown as GrammarPoint;

const row = (over: Partial<CandidateRow> = {}): CandidateRow => ({
  id: 'row-1',
  grammarPointKey: 'es-b1-que-vs-cual',
  type: ExerciseType.CLOZE,
  language: 'ES',
  difficulty: 'B1',
  contentJson: { sentence: '¿___ libro lees?', correctAnswer: 'Qué', seedWord: 'abran' },
  ...over,
});

describe('parseBackfillArgs', () => {
  it('defaults to dry-run and high confidence', () => {
    const a = parseBackfillArgs([]);
    expect(a.apply).toBe(false);
    expect(a.minConfidence).toBe('high');
  });

  it('skips a bare -- so `pnpm ... -- --apply` works', () => {
    expect(parseBackfillArgs(['--', '--apply', '--no-snapshot']).apply).toBe(true);
  });

  it('REFUSES --apply without --snapshot or --no-snapshot', () => {
    expect(() => parseBackfillArgs(['--apply'])).toThrow(/--snapshot/);
  });

  it('accepts --apply with a snapshot branch id', () => {
    const a = parseBackfillArgs(['--apply', '--snapshot', 'br-abc123']);
    expect(a.apply).toBe(true);
    expect(a.snapshot).toBe('br-abc123');
  });

  it('accepts --apply with an explicit --no-snapshot escape hatch', () => {
    const a = parseBackfillArgs(['--apply', '--no-snapshot']);
    expect(a.apply).toBe(true);
    expect(a.snapshot).toBeNull();
  });

  it('does not require a snapshot for a dry run', () => {
    expect(() => parseBackfillArgs([])).not.toThrow();
  });

  it('does not require a snapshot to revert — the undo path must stay frictionless', () => {
    const a = parseBackfillArgs(['--revert', 'runs/x.json', '--apply']);
    expect(a.revertFrom).toBe('runs/x.json');
    expect(a.apply).toBe(true);
  });

  it('uppercases --language and --cefr', () => {
    const a = parseBackfillArgs(['--language', 'es', '--cefr', 'b1']);
    expect(a.language).toBe('ES');
    expect(a.cefrLevel).toBe('B1');
  });

  it('rejects an unknown --min-confidence, including low', () => {
    expect(() => parseBackfillArgs(['--min-confidence', 'low'])).toThrow(/min-confidence/);
    expect(() => parseBackfillArgs(['--min-confidence', 'wat'])).toThrow(/min-confidence/);
  });

  it('accepts --min-confidence medium', () => {
    expect(parseBackfillArgs(['--min-confidence', 'medium']).minConfidence).toBe('medium');
  });

  it('rejects a non-positive --batch-size', () => {
    expect(() => parseBackfillArgs(['--batch-size', '0'])).toThrow(/batch-size/);
  });
});

describe('isEligible', () => {
  it('accepts a cloze row on a variant-bearing point carrying a frequency word', () => {
    expect(isEligible(withVariants, row())).toBe(true);
  });

  it('accepts a row whose seedWord is null', () => {
    expect(isEligible(withVariants, row({ contentJson: { sentence: 'x ___', correctAnswer: 'Qué' } }))).toBe(true);
  });

  it('SKIPS a row already carrying a declared variant id', () => {
    const r = row({ contentJson: { sentence: 'x ___', correctAnswer: 'Qué', seedWord: 'que-before-noun' } });
    expect(isEligible(withVariants, r)).toBe(false);
  });

  it('SKIPS a point that declares no constructionVariants', () => {
    expect(isEligible(noVariants, row())).toBe(false);
  });

  it('SKIPS an exercise type other than cloze/translation', () => {
    expect(isEligible(withVariants, row({ type: ExerciseType.CONJUGATION }))).toBe(false);
    expect(isEligible(withVariants, row({ type: ExerciseType.SENTENCE_CONSTRUCTION }))).toBe(false);
  });

  it('accepts translation rows', () => {
    const r = row({
      type: ExerciseType.TRANSLATION,
      contentJson: { sourceText: 'Which book?', referenceTranslation: '¿Qué libro?', seedWord: 'abran' },
    });
    expect(isEligible(withVariants, r)).toBe(true);
  });
});

describe('toClassifierRow', () => {
  it('maps a cloze row to sentence + correctAnswer', () => {
    expect(toClassifierRow(row())).toEqual({
      rowId: 'row-1',
      prompt: '¿___ libro lees?',
      answer: 'Qué',
    });
  });

  it('maps a translation row to sourceText + referenceTranslation', () => {
    const r = row({
      type: ExerciseType.TRANSLATION,
      contentJson: { sourceText: 'Which book?', referenceTranslation: '¿Qué libro?' },
    });
    expect(toClassifierRow(r)).toEqual({
      rowId: 'row-1',
      prompt: 'Which book?',
      answer: '¿Qué libro?',
    });
  });

  it('returns null when the content lacks a usable field rather than sending empty text', () => {
    expect(toClassifierRow(row({ contentJson: {} }))).toBeNull();
    expect(toClassifierRow(row({ contentJson: { sentence: 'x ___' } }))).toBeNull();
  });
});

describe('selectWrites', () => {
  const rows: CandidateRow[] = [
    row({ id: 'a', contentJson: { sentence: 'x ___', correctAnswer: 'Qué', seedWord: 'abran' } }),
    row({ id: 'b', contentJson: { sentence: 'y ___', correctAnswer: 'Qué' } }),
    row({ id: 'c', contentJson: { sentence: 'z ___', correctAnswer: 'Qué', seedWord: 'acepto' } }),
  ];

  const assignments: ClassifierAssignment[] = [
    { rowId: 'a', variantId: 'que-before-noun', confidence: 'high' },
    { rowId: 'b', variantId: 'que-definition-of-concept', confidence: 'medium' },
    { rowId: 'c', variantId: null, confidence: 'low' },
  ];

  it('writes only high confidence by default, and records the old value', () => {
    const w = selectWrites(rows, assignments, 'high', 'ES:B1:cloze:es-b1-que-vs-cual');
    expect(w).toHaveLength(1);
    expect(w[0]).toEqual({
      id: 'a',
      cellKey: 'ES:B1:cloze:es-b1-que-vs-cual',
      oldSeedWord: 'abran',
      newSeedWord: 'que-before-noun',
      confidence: 'high',
    });
  });

  it('includes medium when --min-confidence medium is set', () => {
    const w = selectWrites(rows, assignments, 'medium', 'cell');
    expect(w.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('records a null oldSeedWord rather than omitting it — revert must restore null', () => {
    const w = selectWrites(rows, assignments, 'medium', 'cell');
    expect(w.find((e) => e.id === 'b')!.oldSeedWord).toBeNull();
  });

  it('never writes a null variantId, whatever the confidence', () => {
    const confident: ClassifierAssignment[] = [{ rowId: 'c', variantId: null, confidence: 'high' }];
    expect(selectWrites(rows, confident, 'high', 'cell')).toHaveLength(0);
  });

  it('ignores an assignment whose rowId is not among the rows', () => {
    const stray: ClassifierAssignment[] = [{ rowId: 'zzz', variantId: 'que-before-noun', confidence: 'high' }];
    expect(selectWrites(rows, stray, 'high', 'cell')).toHaveLength(0);
  });
});

describe('summarize', () => {
  const entries: ArtifactEntry[] = [
    { id: 'a', cellKey: 'ES:B1:cloze:p', oldSeedWord: 'abran', newSeedWord: 'v1', confidence: 'high' },
    { id: 'b', cellKey: 'ES:B1:cloze:p', oldSeedWord: null, newSeedWord: 'v1', confidence: 'high' },
    { id: 'c', cellKey: 'ES:B1:translation:p', oldSeedWord: 'x', newSeedWord: 'v2', confidence: 'medium' },
  ];

  it('groups by cell and counts per variant', () => {
    const s = summarize(entries);
    expect(s).toContain('ES:B1:cloze:p');
    expect(s).toContain('v1: 2');
    expect(s).toContain('ES:B1:translation:p');
    expect(s).toContain('v2: 1');
  });

  it('renders the exact per-cell, per-variant table in sorted order', () => {
    // A substring-only check would still pass if counts were flattened
    // across cells into one shared map — pin the exact multi-line shape.
    expect(summarize(entries)).toBe(
      ['  ES:B1:cloze:p', '    v1: 2', '  ES:B1:translation:p', '    v2: 1'].join('\n'),
    );
  });

  it('does NOT merge same-named variants counted in different cells', () => {
    const crossCell: ArtifactEntry[] = [
      { id: 'a', cellKey: 'ES:B1:cloze:p', oldSeedWord: null, newSeedWord: 'v1', confidence: 'high' },
      { id: 'd', cellKey: 'ES:B2:cloze:q', oldSeedWord: null, newSeedWord: 'v1', confidence: 'high' },
    ];
    // If counts were keyed only by variant id (ignoring cell), this would
    // render a single merged 'v1: 2' instead of two separate '1's.
    expect(summarize(crossCell)).toBe(
      ['  ES:B1:cloze:p', '    v1: 1', '  ES:B2:cloze:q', '    v1: 1'].join('\n'),
    );
  });

  it('reports nothing to do for an empty set rather than printing an empty table', () => {
    expect(summarize([])).toContain('no rows');
  });
});

describe('applyWrites', () => {
  const entries: ArtifactEntry[] = [
    { id: 'a', cellKey: 'cell', oldSeedWord: null, newSeedWord: 'v1', confidence: 'high' },
    { id: 'b', cellKey: 'cell', oldSeedWord: 'x', newSeedWord: 'v2', confidence: 'high' },
    { id: 'c', cellKey: 'cell', oldSeedWord: null, newSeedWord: 'v3', confidence: 'high' },
  ];

  it('applies every entry and reports no failure when all writes succeed', async () => {
    const written: Array<{ id: string; seedWord: string | null }> = [];
    const result = await applyWrites(entries, async (id, seedWord) => {
      written.push({ id, seedWord });
    });
    expect(result).toEqual({ appliedCount: 3, failure: null });
    expect(written).toEqual([
      { id: 'a', seedWord: 'v1' },
      { id: 'b', seedWord: 'v2' },
      { id: 'c', seedWord: 'v3' },
    ]);
  });

  it('stops at the first failure and reports how many succeeded before it', async () => {
    const written: string[] = [];
    const result = await applyWrites(entries, async (id) => {
      if (id === 'b') throw new Error('write failed: transient DB error');
      written.push(id);
    });
    expect(result.appliedCount).toBe(1);
    expect(result.failure).toBe('write failed: transient DB error');
    // The third entry must never be attempted once the second one threw —
    // no pressing on into what may be a persistent fault.
    expect(written).toEqual(['a']);
  });
});

describe('applyAndPersist', () => {
  const baseArtifact: Artifact = {
    name: 'run',
    createdAtIso: '2026-08-11T00:00:00.000Z',
    applied: false,
    appliedCount: 0,
    snapshotBranchId: 'br-abc',
    minConfidence: 'high',
    entries: [
      { id: 'a', cellKey: 'cell', oldSeedWord: null, newSeedWord: 'v1', confidence: 'high' },
      { id: 'b', cellKey: 'cell', oldSeedWord: 'x', newSeedWord: 'v2', confidence: 'high' },
      { id: 'c', cellKey: 'cell', oldSeedWord: null, newSeedWord: 'v3', confidence: 'high' },
    ],
  };

  it('persists the artifact BEFORE any write, and again with the final state after', async () => {
    const persisted: Artifact[] = [];
    const result = await applyAndPersist(
      baseArtifact,
      async () => {},
      (a) => persisted.push(a),
    );
    expect(result).toEqual({ appliedCount: 3, failure: null });
    expect(persisted).toHaveLength(2);
    // First persist happens before any row is touched: unapplied, zero count.
    expect(persisted[0].applied).toBe(false);
    expect(persisted[0].appliedCount).toBe(0);
    // Second persist reflects the completed apply.
    expect(persisted[1].applied).toBe(true);
    expect(persisted[1].appliedCount).toBe(3);
  });

  it('still persists a completed artifact when a write fails partway — the fine-grained revert source must survive the crash', async () => {
    const persisted: Artifact[] = [];
    let calls = 0;
    const result = await applyAndPersist(
      baseArtifact,
      async () => {
        calls++;
        if (calls === 2) throw new Error('boom');
      },
      (a) => persisted.push(a),
    );
    expect(result).toEqual({ appliedCount: 1, failure: 'boom' });
    // Even though the run failed partway, both persists happened — the
    // artifact on disk reflects exactly the 1 row that was actually written,
    // not the 3 that were candidates.
    expect(persisted).toHaveLength(2);
    expect(persisted[1].applied).toBe(false);
    expect(persisted[1].appliedCount).toBe(1);
  });

  it('does not mutate the artifact object passed in', async () => {
    const snapshot = JSON.parse(JSON.stringify(baseArtifact)) as Artifact;
    await applyAndPersist(baseArtifact, async () => {}, () => {});
    expect(baseArtifact).toEqual(snapshot);
  });
});
