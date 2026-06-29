import { describe, it, expect } from 'vitest';
import { ExerciseType, Language, CefrLevel } from '@language-drill/shared';
import { parseDedupeArgs, planDedupe, type DedupeRow } from './dedupe-conjugation-pool';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function conjContent(
  lemma: string,
  targetForm: string,
  pronoun: string,
  featureBundle: string,
  extra: Record<string, unknown> = {},
) {
  return {
    type: ExerciseType.CONJUGATION,
    instructions: 'x',
    lemma,
    lemmaGloss: 'x',
    featureBundle,
    subject: { pronoun, gloss: 'x' },
    targetForm,
    breakdown: 'x',
    exampleSentences: ['x'],
    ...extra,
  };
}

function row(id: string, content: unknown, opts: Partial<DedupeRow> = {}): DedupeRow {
  return {
    id,
    language: Language.TR,
    type: ExerciseType.CONJUGATION,
    difficulty: CefrLevel.A1,
    grammarPointKey: 'tr-a1-personal-suffixes',
    contentJson: content,
    createdAt: new Date('2026-06-20T00:00:00Z'),
    historyCount: 0,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// parseDedupeArgs
// ---------------------------------------------------------------------------

describe('parseDedupeArgs', () => {
  it('defaults to dry-run, no filters', () => {
    expect(parseDedupeArgs([])).toEqual({ apply: false, language: null, cefrLevel: null });
  });

  it('parses --apply, --language, --cefr', () => {
    expect(parseDedupeArgs(['--apply', '--language', 'tr', '--cefr', 'a1'])).toEqual({
      apply: true,
      language: Language.TR,
      cefrLevel: CefrLevel.A1,
    });
  });

  it('rejects an invalid language', () => {
    expect(() => parseDedupeArgs(['--language', 'fr'])).toThrow();
  });

  it('rejects an unknown flag', () => {
    expect(() => parseDedupeArgs(['--nope'])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// planDedupe
// ---------------------------------------------------------------------------

describe('planDedupe', () => {
  it('collapses duplicate content (varying featureBundle) to one survivor', () => {
    const rows = [
      row('a', conjContent('öğrenci', 'öğrencisin', 'sen', 'kişi eki · 2. tekil kişi (sen)')),
      row('b', conjContent('öğrenci', 'öğrencisin', 'sen', 'kişi eki (yüklem) · 2. tekil şahıs')),
      row('c', conjContent('öğrenci', 'öğrencisin', 'sen', 'kişi eki · 2. tekil şahıs')),
    ];
    const plan = planDedupe(rows);
    expect(plan.totalGroups).toBe(1);
    expect(plan.duplicateGroups).toBe(1);
    expect(plan.demotions).toHaveLength(2);
    // Exactly one survivor across the three rows.
    const demotedIds = new Set(plan.demotions.map((d) => d.id));
    expect(demotedIds.size).toBe(2);
    expect(['a', 'b', 'c'].filter((id) => !demotedIds.has(id))).toHaveLength(1);
  });

  it('keeps the most-practiced row, demoting the rest to it', () => {
    const rows = [
      row('fresh', conjContent('öğrenci', 'öğrencisin', 'sen', 'fb1'), { historyCount: 0 }),
      row('practiced', conjContent('öğrenci', 'öğrencisin', 'sen', 'fb2'), { historyCount: 3 }),
    ];
    const plan = planDedupe(rows);
    expect(plan.demotions).toEqual([{ id: 'fresh', keptId: 'practiced' }]);
  });

  it('does NOT collapse genuinely different prompts (different targetForm/pronoun)', () => {
    const rows = [
      row('a', conjContent('öğrenci', 'öğrencisin', 'sen', 'fb')),
      row('b', conjContent('öğrenci', 'öğrenciyim', 'ben', 'fb')),
    ];
    const plan = planDedupe(rows);
    expect(plan.totalGroups).toBe(2);
    expect(plan.duplicateGroups).toBe(0);
    expect(plan.demotions).toHaveLength(0);
  });

  it('separates the same prompt under different grammar points / levels', () => {
    const rows = [
      row('a', conjContent('öğrenci', 'öğrencisin', 'sen', 'fb'), { grammarPointKey: 'tr-a1-x' }),
      row('b', conjContent('öğrenci', 'öğrencisin', 'sen', 'fb'), { grammarPointKey: 'tr-a1-y' }),
    ];
    expect(planDedupe(rows).demotions).toHaveLength(0);
  });

  it('re-keys a survivor whose stored _dedupKey is the old (featureBundle) format', () => {
    const rows = [
      row('a', conjContent('öğrenci', 'öğrencisin', 'sen', 'fb', { _dedupKey: 'ogrenci::kisi eki' })),
    ];
    const plan = planDedupe(rows);
    expect(plan.demotions).toHaveLength(0);
    expect(plan.rekeys).toHaveLength(1);
    expect(plan.rekeys[0].id).toBe('a');
    expect(plan.rekeys[0].dedupKey).toBe('ogrenci::ogrencisin::sen');
    expect(plan.rekeys[0].contentJson['_dedupKey']).toBe('ogrenci::ogrencisin::sen');
  });

  it('does NOT re-key a survivor whose _dedupKey is already canonical', () => {
    const rows = [
      row('a', conjContent('öğrenci', 'öğrencisin', 'sen', 'fb', { _dedupKey: 'ogrenci::ogrencisin::sen' })),
    ];
    expect(planDedupe(rows).rekeys).toHaveLength(0);
  });

  it('skips rows with malformed / non-conjugation content', () => {
    const rows = [
      row('a', null),
      row('b', { type: 'cloze', sentence: 'x' }),
      row('c', conjContent('ev', 'evim', 'ben', 'fb')),
    ];
    const plan = planDedupe(rows);
    // Only the valid conjugation row forms a group.
    expect(plan.totalGroups).toBe(1);
    expect(plan.demotions).toHaveLength(0);
  });
});
