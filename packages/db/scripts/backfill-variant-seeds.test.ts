import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';
import {
  parseBackfillArgs,
  isEligible,
  toClassifierRow,
  type CandidateRow,
} from './backfill-variant-seeds';

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
