import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';
import {
  analyzeCell,
  cellKeyOf,
  estimateTriageCostUsd,
  groupRowsIntoCells,
  parseAuditArgs,
  renderMarkdown,
  type AuditCell,
  type CellFinding,
  type LoadedRow,
} from './audit-collapse.js';

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

const point = (extra: Partial<GrammarPoint> = {}): GrammarPoint =>
  ({
    key: 'es-b1-test',
    kind: 'grammar',
    name: 'Test point',
    description: 'A test point.',
    cefrLevel: 'B1',
    language: 'ES',
    examplesPositive: ['a', 'b'],
    examplesNegative: ['*c'],
    commonErrors: ['d'],
    ...extra,
  }) as GrammarPoint;

const cell = (gp: GrammarPoint, contents: Record<string, unknown>[]): AuditCell => ({
  cellKey: 'ES:B1:cloze:es-b1-test',
  language: 'ES',
  cefrLevel: 'B1',
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: gp,
  target: 50,
  rows: contents.map((content, i) => ({
    id: `r${i}`,
    type: ExerciseType.CLOZE,
    content,
    coverageTags: null,
  })),
});

const opts = { minRows: 15, threshold: 0.65, monotonyThreshold: 0.5 };
const collapsed = Array.from({ length: 20 }, () => ({ correctAnswer: 'Dicen', sentence: 'x ___ y' }));

describe('analyzeCell', () => {
  it('flags surface collapse and marks it as needing triage', () => {
    const f = analyzeCell(cell(point(), collapsed), opts);
    expect(f.surfaceFlagged).toBe(true);
    expect(f.needsTriage).toBe(true);
  });

  it('does not flag a diverse cell', () => {
    const diverse = Array.from({ length: 20 }, (_, i) => ({
      correctAnswer: `w${i}`,
      // Every content token is unique per row: the previous `stem ${i}` put the
      // literal word "stem" in all 20 stems, which is 100% monotony by design.
      sentence: `frase${i} palabra${i}`,
    }));
    const f = analyzeCell(cell(point(), diverse), opts);
    expect(f.surfaceFlagged).toBe(false);
    expect(f.needsTriage).toBe(false);
  });

  it('signal 2 PRE-EMPTS triage: a declared mechanism the pool has not realized is the finding', () => {
    const withVariants = point({
      constructionVariants: [
        { id: 'hearsay', directive: 'H' },
        { id: 'adversity', directive: 'A' },
      ],
    });
    const f = analyzeCell(cell(withVariants, collapsed), opts);
    expect(f.surfaceFlagged).toBe(true);
    expect(f.variantSkew!.unrecognizedSeedCount).toBe(20);
    // Declared but unrealized — no LLM call is warranted or made.
    expect(f.needsTriage).toBe(false);
    expect(f.preempted).toBe(true);
  });

  it('does not pre-empt when the declared variants ARE realized', () => {
    const withVariants = point({
      constructionVariants: [
        { id: 'hearsay', directive: 'H' },
        { id: 'adversity', directive: 'A' },
      ],
    });
    const rows = [
      ...Array.from({ length: 16 }, () => ({ correctAnswer: 'Dicen', seedWord: 'hearsay' })),
      ...Array.from({ length: 4 }, () => ({ correctAnswer: 'Dicen', seedWord: 'adversity' })),
    ];
    const f = analyzeCell(cell(withVariants, rows), opts);
    expect(f.preempted).toBe(false);
    expect(f.needsTriage).toBe(true);
  });

  it('does not pre-empt on overQuota alone — imbalance is not an unrealized mechanism', () => {
    const withVariants = point({
      constructionVariants: [
        { id: 'hearsay', directive: 'H' },
        { id: 'adversity', directive: 'A' },
      ],
    });
    // 11/9: both variants well above MIN_PER_VARIANT, nothing unrecognized, but
    // hearsay sits just over its fair quota of 10. A healthy pool.
    const rows = [
      ...Array.from({ length: 11 }, () => ({ correctAnswer: 'Dicen', seedWord: 'hearsay' })),
      ...Array.from({ length: 9 }, () => ({ correctAnswer: 'Dicen', seedWord: 'adversity' })),
    ];
    const f = analyzeCell(cell(withVariants, rows), opts);
    expect(f.variantSkew!.overQuota).toEqual(['hearsay']);
    expect(f.variantSkew!.underMin).toEqual([]);
    expect(f.preempted).toBe(false);
  });

  it('respects the dismissals ledger', () => {
    const dismissed = point({ key: 'es-a2-personal-a', cefrLevel: 'A2' });
    const rows = Array.from({ length: 20 }, () => ({ correctAnswer: 'a', sentence: 'x ___ y' }));
    const f = analyzeCell({ ...cell(dismissed, rows), cefrLevel: 'A2' }, opts);
    expect(f.surfaceFlagged).toBe(true);
    expect(f.dismissedByLedger).toBe(true);
    expect(f.needsTriage).toBe(false);
  });

  it('reports spec shortfalls without requesting triage', () => {
    const spec = point({
      coverageSpec: { axes: [{ name: 'person', floors: { '1sg': 5, '3sg': 5 } }] },
    });
    const f = analyzeCell(cell(spec, collapsed), opts);
    expect(f.specShortfall!.shortfalls).toHaveLength(2);
    expect(f.specShortfall!.atTarget).toBe(false); // 20 rows against target 50
    expect(f.needsTriage).toBe(false); // signal 2 pre-empts
  });
});

describe('estimateTriageCostUsd', () => {
  it('prices Sonnet input and output tokens', () => {
    // 1M input @ $3, 1M output @ $15
    expect(estimateTriageCostUsd({ input_tokens: 1_000_000, output_tokens: 0 } as never)).toBeCloseTo(3, 5);
    expect(estimateTriageCostUsd({ input_tokens: 0, output_tokens: 1_000_000 } as never)).toBeCloseTo(15, 5);
  });

  it('is zero for zero usage', () => {
    expect(estimateTriageCostUsd({ input_tokens: 0, output_tokens: 0 } as never)).toBe(0);
  });
});

describe('renderMarkdown', () => {
  const finding = (over: Partial<CellFinding>): CellFinding =>
    ({
      cellKey: 'ES:B1:cloze:es-b1-test',
      grammarPointKey: 'es-b1-test',
      grammarPointName: 'Test point',
      exerciseType: ExerciseType.CLOZE,
      approved: 50,
      target: 50,
      surface: { topSurface: 'dicen', topCount: 49, total: 50, share: 0.98, distribution: [] },
      surfaceFlagged: true,
      monotony: null,
      monotonyFlagged: false,
      specShortfall: null,
      variantSkew: null,
      dismissedByLedger: false,
      preempted: false,
      needsTriage: true,
      verdict: null,
      triageError: null,
      ...over,
    }) as CellFinding;

  it('lists a confirmed collapse with its mechanism and next action', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 100,
      costUsd: 0.4,
      findings: [
        finding({
          verdict: {
            verdict: 'collapsed',
            mechanism: 'construction-variants',
            missingConstructions: ['um … zu'],
            rationale: 'um…zu is never drilled.',
            confidence: 'high',
          },
        }),
      ],
    });
    expect(md).toContain('## Confirmed collapsed');
    expect(md).toContain('construction-variants');
    expect(md).toContain('author `constructionVariants`');
  });

  it('warns that an at-target cell will not self-heal', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [
        finding({
          approved: 50,
          target: 50,
          verdict: {
            verdict: 'collapsed',
            mechanism: 'coverage-spec',
            axis: 'person',
            rationale: 'All 3sg.',
            confidence: 'high',
          },
        }),
      ],
    });
    expect(md).toContain('demote required');
  });

  it('puts declared-but-unrealized in its own section, split by at-target', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 2,
      costUsd: 0,
      findings: [
        finding({
          needsTriage: false,
          surfaceFlagged: false,
          specShortfall: {
            shortfalls: [{ axis: 'person', value: '2pl', floor: 5, actual: 0 }],
            approved: 50,
            target: 50,
            atTarget: true,
          },
        }),
      ],
    });
    expect(md).toContain('## Declared-but-unrealized');
    expect(md).toContain('At target');
  });

  it('lists dismissals so the report is auditable, not a filtered view', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [finding({ dismissedByLedger: true, needsTriage: false })],
    });
    expect(md).toContain('## Dismissed');
    expect(md).toContain('ledger');
  });

  it('renders a clean report when nothing is flagged', () => {
    const md = renderMarkdown({ name: 'run', scanned: 100, costUsd: 0, findings: [] });
    expect(md).toContain('No collapse findings');
  });

  it('renders an overQuota-only finding rather than dropping it', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [
        finding({
          surfaceFlagged: false,
          needsTriage: false,
          surface: null,
          variantSkew: {
            perVariant: [
              { id: 'hearsay', count: 12, share: 1, quota: 8 },
              { id: 'adversity', count: 6, share: 1, quota: 8 },
              { id: 'agentless', count: 6, share: 1, quota: 8 },
            ],
            overQuota: ['hearsay'],
            underMin: [],
            unrecognizedSeedCount: 0,
            approved: 24,
          },
        }),
      ],
    });
    expect(md).toContain('## Declared-but-unrealized');
    expect(md).toContain('hearsay');
    expect(md).not.toContain('No collapse findings');
  });

  it('cross-references a cell that is both dismissed and declared-but-unrealized', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [
        finding({
          needsTriage: false,
          dismissedByLedger: true,
          specShortfall: {
            shortfalls: [{ axis: 'person', value: '2pl', floor: 5, actual: 0 }],
            approved: 50,
            target: 50,
            atTarget: true,
          },
        }),
      ],
    });
    expect(md).toContain('## Declared-but-unrealized');
    expect(md).toContain('## Dismissed');
    expect(md).toContain('also has an unrealized declared mechanism');
  });
});
