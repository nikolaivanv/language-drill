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
import { assertArtifactWritable, parseArtifact, entriesToRestore } from './backfill-variant-seeds';
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

  it('parses --max-cells and its --limit alias into the same field', () => {
    // The unit differs from every sibling CLI: revalidate:cloze and
    // backfill:coverage-tags bound ROWS, this bounds CELLS. The alias exists
    // for muscle memory; both spellings must land in the same place.
    expect(parseBackfillArgs(['--max-cells', '3']).maxCells).toBe(3);
    expect(parseBackfillArgs(['--limit', '3']).maxCells).toBe(3);
    expect(parseBackfillArgs([])).toMatchObject({ maxCells: null });
    expect(() => parseBackfillArgs(['--max-cells', '0'])).toThrow(/max-cells/);
  });

  it('validates --grammar-point against the curriculum instead of silently matching nothing', () => {
    expect(parseBackfillArgs(['--grammar-point', 'es-b1-que-vs-cual']).grammarPoint).toBe(
      'es-b1-que-vs-cual',
    );
    expect(() => parseBackfillArgs(['--grammar-point', 'es-b1-que-vs-kual'])).toThrow(
      /unknown grammar point/,
    );
  });

  it('defaults --force off and parses it on', () => {
    expect(parseBackfillArgs([]).force).toBe(false);
    expect(parseBackfillArgs(['--force']).force).toBe(true);
  });
});

describe('assertArtifactWritable', () => {
  const applied = JSON.stringify({ applied: true, appliedCount: 218, entries: [] });
  const dryRun = JSON.stringify({ applied: false, appliedCount: 0, entries: [] });

  it('REFUSES to overwrite the artifact of an applied run', () => {
    // That file is the only fine-grained record of those rows' original
    // seedWord — isEligible skips labelled rows forever, and backfill-runs/ is
    // gitignored. `persist` writes it as the FIRST action of an --apply, so a
    // second default-named run would destroy it before doing any work.
    expect(() => assertArtifactWritable('backfill-runs/x.json', false, () => applied)).toThrow(
      /refusing to overwrite/,
    );
    expect(() => assertArtifactWritable('backfill-runs/x.json', false, () => applied)).toThrow(
      /--name|--force/,
    );
  });

  it('REFUSES to overwrite the artifact of a PARTIAL apply', () => {
    // A partial apply persists {applied: false, appliedCount: N>0} — those N
    // rows ARE in production, and this file is the only record of what they
    // held before. Guarding only on `applied === true` left them unprotected.
    const partial = JSON.stringify({ applied: false, appliedCount: 2, entries: [] });
    expect(() => assertArtifactWritable('backfill-runs/x.json', false, () => partial)).toThrow(
      /refusing to overwrite/,
    );
    expect(() => assertArtifactWritable('backfill-runs/x.json', false, () => partial)).toThrow(
      /--name|--force/,
    );
  });

  it('permits the overwrite when --force is passed', () => {
    const partial = JSON.stringify({ applied: false, appliedCount: 2, entries: [] });
    expect(() => assertArtifactWritable('backfill-runs/x.json', true, () => applied)).not.toThrow();
    expect(() => assertArtifactWritable('backfill-runs/x.json', true, () => partial)).not.toThrow();
  });

  it('permits overwriting a dry-run artifact — scratch, nothing to protect', () => {
    expect(() => assertArtifactWritable('backfill-runs/x.json', false, () => dryRun)).not.toThrow();
  });

  it('permits writing when no artifact exists, or when the existing one is unreadable', () => {
    expect(() => assertArtifactWritable('backfill-runs/x.json', false, () => null)).not.toThrow();
    expect(() => assertArtifactWritable('backfill-runs/x.json', false, () => '{oops')).not.toThrow();
  });
});

describe('parseArtifact', () => {
  const ok = {
    name: 'run',
    createdAtIso: '2026-08-11T00:00:00.000Z',
    applied: true,
    appliedCount: 1,
    snapshotBranchId: 'br-abc',
    minConfidence: 'high',
    entries: [{ id: 'a', cellKey: 'cell', oldSeedWord: 'abran', newSeedWord: 'v1', confidence: 'high' }],
  };

  it('accepts a well-formed artifact', () => {
    const a = parseArtifact(ok);
    expect(a.entries).toHaveLength(1);
    expect(a.entries[0].oldSeedWord).toBe('abran');
    expect(a.appliedCount).toBe(1);
  });

  it('accepts an artifact written before provenance existed, as null', () => {
    // The production artifacts predate these fields and must stay revertible.
    const a = parseArtifact(ok);
    expect(a.classifierPromptVersion).toBeNull();
    expect(a.classifierModel).toBeNull();
    expect(parseArtifact({ ...ok, classifierModel: 'claude-sonnet-4-6' }).classifierModel).toBe(
      'claude-sonnet-4-6',
    );
  });

  it('rejects a non-object', () => {
    expect(() => parseArtifact(null)).toThrow(/object/);
    expect(() => parseArtifact('{}')).toThrow(/object/);
  });

  it('rejects a missing entries array', () => {
    expect(() => parseArtifact({ ...ok, entries: undefined })).toThrow(/entries/);
  });

  it('rejects an entry with a non-string id', () => {
    expect(() => parseArtifact({ ...ok, entries: [{ ...ok.entries[0], id: 42 }] })).toThrow(/id/);
  });

  it('rejects an entry whose oldSeedWord is undefined — the to_jsonb(::text) trap', () => {
    // With oldSeedWord undefined, drizzle omits the bind parameter and emits
    // literal `to_jsonb(::text)`, which Postgres rejects as a syntax error —
    // aborting a restore partway. Fail before the first row instead.
    const missing = { id: 'a', cellKey: 'cell', newSeedWord: 'v1', confidence: 'high' };
    expect(() => parseArtifact({ ...ok, entries: [missing] })).toThrow(/oldSeedWord/);
    expect(() =>
      parseArtifact({ ...ok, entries: [{ ...ok.entries[0], oldSeedWord: undefined }] }),
    ).toThrow(/oldSeedWord/);
  });

  it('accepts a null oldSeedWord — that means "remove the key", not "missing"', () => {
    const a = parseArtifact({ ...ok, entries: [{ ...ok.entries[0], oldSeedWord: null }] });
    expect(a.entries[0].oldSeedWord).toBeNull();
  });

  it('rejects an appliedCount that is not an integer or exceeds the entries', () => {
    expect(() => parseArtifact({ ...ok, appliedCount: 'lots' })).toThrow(/appliedCount/);
    expect(() => parseArtifact({ ...ok, appliedCount: 9 })).toThrow(/appliedCount/);
  });
});

describe('entriesToRestore', () => {
  const artifact = (over: Partial<Artifact>): Artifact =>
    ({
      name: 'run',
      createdAtIso: '',
      applied: true,
      appliedCount: 3,
      snapshotBranchId: null,
      minConfidence: 'high',
      classifierPromptVersion: null,
      classifierModel: null,
      entries: [
        { id: 'a', cellKey: 'c', oldSeedWord: null, newSeedWord: 'v1', confidence: 'high' },
        { id: 'b', cellKey: 'c', oldSeedWord: 'x', newSeedWord: 'v2', confidence: 'high' },
        { id: 'c', cellKey: 'c', oldSeedWord: null, newSeedWord: 'v3', confidence: 'high' },
      ],
      ...over,
    }) as Artifact;

  it('restores every entry of a completed run', () => {
    expect(entriesToRestore(artifact({})).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('restores only the first appliedCount of a PARTIAL run', () => {
    // `entries` is always the full candidate set; a partial apply wrote only
    // the first appliedCount. Replaying the rest is pointless work against a
    // live table.
    expect(
      entriesToRestore(artifact({ applied: false, appliedCount: 1 })).map((e) => e.id),
    ).toEqual(['a']);
  });

  it('restores EVERY entry from an appliedCount=0 artifact — the crash case', () => {
    // `applyAndPersist` persists {applied: false, appliedCount: 0} BEFORE the
    // first row is written, so a crash mid-apply (SIGINT during an 876-row
    // sequential run) leaves exactly this shape while rows are already
    // changed. Slicing to 0 made that artifact restore nothing, defeating the
    // whole point of the pre-write persist. Restoring an unwritten row just
    // rewrites oldSeedWord onto a row that still has it — a harmless no-op.
    expect(entriesToRestore(artifact({ applied: false, appliedCount: 0 })).map((e) => e.id)).toEqual(
      ['a', 'b', 'c'],
    );
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

  it('SKIPS an exercise type that carries no variant seed', () => {
    expect(isEligible(withVariants, row({ type: ExerciseType.CONJUGATION }))).toBe(false);
    expect(isEligible(withVariants, row({ type: ExerciseType.VOCAB_RECALL }))).toBe(false);
  });

  it('accepts sentence_construction rows — seedKindFor has routed SC to variants since #652', () => {
    const r = row({
      type: ExerciseType.SENTENCE_CONSTRUCTION,
      contentJson: { prompt: 'Express a wish.', modelAnswers: ['Espero que vengas.'] },
    });
    expect(isEligible(withVariants, r)).toBe(true);
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

  it('maps a sentence-construction row to prompt + model answers', () => {
    const r = row({
      type: ExerciseType.SENTENCE_CONSTRUCTION,
      contentJson: {
        prompt: 'Express a wish for a friend travelling abroad.',
        targetStructure: 'present subjunctive after espero que',
        modelAnswers: ['Espero que tengas buen viaje.', 'Quiero que te diviertas.'],
      },
    });
    expect(toClassifierRow(r)).toEqual({
      rowId: 'row-1',
      prompt:
        'Express a wish for a friend travelling abroad.\n[target structure: present subjunctive after espero que]',
      answer: 'Espero que tengas buen viaje. | Quiero que te diviertas.',
    });
  });

  it('caps the model answers it sends at three', () => {
    const r = row({
      type: ExerciseType.SENTENCE_CONSTRUCTION,
      contentJson: { prompt: 'p', modelAnswers: ['a', 'b', 'c', 'd'] },
    });
    expect(toClassifierRow(r)?.answer).toBe('a | b | c');
  });

  it('omits the target-structure hint when the row has none', () => {
    const r = row({
      type: ExerciseType.SENTENCE_CONSTRUCTION,
      contentJson: { prompt: 'p', modelAnswers: ['a'] },
    });
    expect(toClassifierRow(r)?.prompt).toBe('p');
  });

  it('returns null when the content lacks a usable field rather than sending empty text', () => {
    expect(toClassifierRow(row({ contentJson: {} }))).toBeNull();
    expect(toClassifierRow(row({ contentJson: { sentence: 'x ___' } }))).toBeNull();
  });

  it('returns null for a sentence-construction row with no usable model answer', () => {
    // An SC row has no correctAnswer; with no model answers there is nothing but
    // the situation prompt to judge from, which is not enough to pick a variant.
    const base = { prompt: 'p', targetStructure: 't' };
    expect(
      toClassifierRow(row({ type: ExerciseType.SENTENCE_CONSTRUCTION, contentJson: base })),
    ).toBeNull();
    expect(
      toClassifierRow(
        row({ type: ExerciseType.SENTENCE_CONSTRUCTION, contentJson: { ...base, modelAnswers: ['', '  '] } }),
      ),
    ).toBeNull();
    expect(
      toClassifierRow(
        row({ type: ExerciseType.SENTENCE_CONSTRUCTION, contentJson: { modelAnswers: ['a'] } }),
      ),
    ).toBeNull();
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

  it('writes oldSeedWord when the revert selector is passed — the same loop, the other direction', async () => {
    const written: Array<{ id: string; seedWord: string | null }> = [];
    const result = await applyWrites(
      entries,
      async (id, seedWord) => {
        written.push({ id, seedWord });
      },
      (e) => e.oldSeedWord,
    );
    expect(result).toEqual({ appliedCount: 3, failure: null });
    expect(written).toEqual([
      { id: 'a', seedWord: null },
      { id: 'b', seedWord: 'x' },
      { id: 'c', seedWord: null },
    ]);
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
    classifierPromptVersion: 'variant-seed-classifier@2026-08-11',
    classifierModel: 'claude-sonnet-4-6',
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
    // And that pre-write artifact — the one a crash would leave behind — must
    // be able to revert every row the dead run might have written.
    expect(entriesToRestore(persisted[0]).map((e) => e.id)).toEqual(['a', 'b', 'c']);
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
    // Even though the run failed partway, both persists happened. The artifact
    // on disk still records ALL 3 candidates — `entries` is never trimmed —
    // with `appliedCount: 1` marking how far the writes actually got. A revert
    // reads that count and restores only the first entry.
    expect(persisted).toHaveLength(2);
    expect(persisted[1].applied).toBe(false);
    expect(persisted[1].appliedCount).toBe(1);
    expect(persisted[1].entries).toHaveLength(3);
    expect(entriesToRestore(persisted[1]).map((e) => e.id)).toEqual(['a']);
  });

  it('does not mutate the artifact object passed in', async () => {
    const snapshot = JSON.parse(JSON.stringify(baseArtifact)) as Artifact;
    await applyAndPersist(baseArtifact, async () => {}, () => {});
    expect(baseArtifact).toEqual(snapshot);
  });
});
