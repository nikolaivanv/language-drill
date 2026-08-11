import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';
import { MONOTONY_THRESHOLD_DEFAULT } from '../src/collapse-metrics.js';
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

  it('takes the monotony default from the documented constant, not a literal', () => {
    // A hard-coded '0.85' here meant editing MONOTONY_THRESHOLD_DEFAULT (and its
    // long calibration rationale) changed nothing the CLI actually used.
    expect(parseAuditArgs([]).monotonyThreshold).toBe(MONOTONY_THRESHOLD_DEFAULT);
  });

  it('rejects a --type that is not an ExerciseType', () => {
    // Unvalidated, a typo yields a zero-row run reported as a clean bill of health.
    expect(() => parseAuditArgs(['--type', 'close'])).toThrow(/--type/);
  });

  it('accepts a real exercise type', () => {
    expect(parseAuditArgs(['--type', 'cloze']).type).toBe('cloze');
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

  // Surface collapses onto the dismissed `a`, but every stem is lexically unique
  // so the monotony signal stays quiet — these tests isolate the surface
  // dismissal. (A shared `x ___ y` stem is 100% monotony, which now correctly
  // keeps the cell in triage on the OTHER signal.)
  const dismissedRows = Array.from({ length: 20 }, (_, i) => ({
    correctAnswer: 'a',
    sentence: `frase${i} ___ palabra${i}`,
  }));

  it('respects the dismissals ledger', () => {
    const dismissed = point({ key: 'es-a2-personal-a', cefrLevel: 'A2' });
    const f = analyzeCell({ ...cell(dismissed, dismissedRows), cefrLevel: 'A2' }, opts);
    expect(f.surfaceFlagged).toBe(true);
    expect(f.surfaceDismissed).toBe(true);
    expect(f.monotonyFlagged).toBe(false);
    expect(f.dismissedByLedger).toBe(true);
    expect(f.needsTriage).toBe(false);
  });

  it('carries the matched ledger entry so the report can print its rationale', () => {
    const dismissed = point({ key: 'es-a2-personal-a', cefrLevel: 'A2' });
    const f = analyzeCell({ ...cell(dismissed, dismissedRows), cefrLevel: 'A2' }, opts);
    expect(f.ledgerNotes).toHaveLength(1);
    expect(f.ledgerNotes[0].signal).toBe('answer-surface');
    expect(f.ledgerNotes[0].surface).toBe('a');
    expect(f.ledgerNotes[0].reason).toMatch(/personal `a`/);
    expect(f.ledgerNotes[0].dismissedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a dismissal on ONE signal does not suppress the other', () => {
    // `es-b1-ser-location-events` carries a `surface: null` answer-surface
    // dismissal, so the surface flag is covered whatever dominates. Nothing in the
    // ledger covers stem-monotony, so that signal must survive — collapsing the
    // two into one boolean used to drop it from its section AND from triage.
    const gp = point({ key: 'es-b1-ser-location-events' });
    const rows = Array.from({ length: 20 }, () => ({
      correctAnswer: 'es',
      sentence: 'La reunión es aquí.',
    }));
    const f = analyzeCell(cell(gp, rows), opts);
    expect(f.surfaceFlagged).toBe(true);
    expect(f.surfaceDismissed).toBe(true);
    expect(f.monotonyFlagged).toBe(true);
    expect(f.monotonyDismissed).toBe(false);
    expect(f.needsTriage).toBe(true);
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
      surfaceDismissed: false,
      monotonyDismissed: false,
      dismissedByLedger: false,
      ledgerNotes: [],
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
      findings: [
        finding({
          surfaceDismissed: true,
          dismissedByLedger: true,
          ledgerNotes: [
            {
              signal: 'answer-surface',
              surface: 'dicen',
              reason: 'The marker IS the point.',
              dismissedOn: '2026-08-11',
            },
          ],
          needsTriage: false,
        }),
      ],
    });
    expect(md).toContain('## Dismissed');
    expect(md).toContain('ledger');
    // The ledger's own words and date, not the bare token 'ledger' — a stale
    // dismissal has to be visible rather than silently permanent.
    expect(md).toContain('The marker IS the point.');
    expect(md).toContain('2026-08-11');
    expect(md).toContain('`dicen`');
  });

  it('renders `*any*` for a surface-agnostic ledger entry', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [
        finding({
          surfaceDismissed: true,
          dismissedByLedger: true,
          ledgerNotes: [
            {
              signal: 'answer-surface',
              surface: null,
              reason: 'Any dominant surface here is legitimate.',
              dismissedOn: '2026-08-11',
            },
          ],
          needsTriage: false,
        }),
      ],
    });
    expect(md).toContain('*any*');
  });

  it('a dismissed surface flag does not suppress an undismissed monotony flag', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [
        finding({
          surfaceFlagged: true,
          surfaceDismissed: true,
          dismissedByLedger: true,
          ledgerNotes: [
            { signal: 'answer-surface', surface: 'ser', reason: 'ser is the point.', dismissedOn: '2026-08-11' },
          ],
          monotonyFlagged: true,
          monotonyDismissed: false,
          monotony: { topLemma: 'reunión', count: 19, total: 20, share: 0.95 },
          needsTriage: true,
        }),
      ],
    });
    expect(md).toContain('## Stem monotony');
    expect(md).toContain('reunión');
    // …and it still reaches triage rather than vanishing into the ledger line.
    expect(md).toContain('## Awaiting triage');
  });

  it('a dismissed monotony flag does not suppress an undismissed surface collapse', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [
        finding({
          surfaceFlagged: true,
          surfaceDismissed: false,
          monotonyFlagged: true,
          monotonyDismissed: true,
          dismissedByLedger: true,
          ledgerNotes: [
            { signal: 'stem-monotony', surface: 'casa', reason: 'Topic is fixed by design.', dismissedOn: '2026-08-11' },
          ],
          monotony: { topLemma: 'casa', count: 19, total: 20, share: 0.95 },
          needsTriage: true,
        }),
      ],
    });
    expect(md).toContain('## Awaiting triage');
    expect(md).toContain('Top surface');
    expect(md).not.toContain('## Stem monotony');
  });

  it('reports monotony numbers, not surface numbers, for a monotony-only finding', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [
        finding({
          surface: null,
          surfaceFlagged: false,
          monotonyFlagged: true,
          monotony: { topLemma: 'restaurante', count: 19, total: 20, share: 0.95 },
          needsTriage: true,
        }),
      ],
    });
    expect(md).toContain('Signal: **stem-monotony**');
    expect(md).toContain('Top stem lemma: `restaurante`');
    // The old renderer printed `Top surface: \`undefined\` at **0%**`.
    expect(md).not.toContain('undefined');
    expect(md).not.toContain('Top surface');
  });

  it('renders a surface-flagged, not-yet-triaged cell under "Awaiting triage" (dry-run gap)', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [
        finding({
          needsTriage: true,
          verdict: null,
          triageError: null,
          specShortfall: null,
          variantSkew: null,
        }),
      ],
    });
    expect(md).toContain('## Awaiting triage');
    expect(md).not.toContain('No collapse findings');
  });

  it('renders a clean report when nothing is flagged', () => {
    const md = renderMarkdown({ name: 'run', scanned: 100, costUsd: 0, findings: [] });
    expect(md).toContain('No collapse findings');
  });

  const overQuotaOnly = (): CellFinding =>
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
        declaredRows: 24,
      },
    });

  it('renders an overQuota-only finding rather than dropping it', () => {
    const md = renderMarkdown({ name: 'run', scanned: 1, costUsd: 0, findings: [overQuotaOnly()] });
    expect(md).toContain('## Variant spread uneven');
    expect(md).toContain('hearsay');
    expect(md).not.toContain('No collapse findings');
  });

  it('does NOT prescribe a demote for an overQuota-only cell — the mechanism IS realized', () => {
    // `overQuota` fires on any split that is not exactly even, so an at-target
    // cell with a healthy 15/13/12/11/9 spread used to land under "At target —
    // stuck, needs a demote", which destroys approved rows and pays to regenerate.
    const md = renderMarkdown({ name: 'run', scanned: 1, costUsd: 0, findings: [overQuotaOnly()] });
    expect(md).not.toContain('demote required');
    expect(md).not.toContain('## Declared-but-unrealized');
    expect(md).toContain('No demote is indicated');
  });

  it('keeps a cell with BOTH a missing mechanism and overQuota in the demote bucket', () => {
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
              { id: 'hearsay', count: 20, share: 1, quota: 11 },
              { id: 'adversity', count: 2, share: 1, quota: 11 },
            ],
            overQuota: ['hearsay'],
            underMin: ['adversity'],
            unrecognizedSeedCount: 0,
            declaredRows: 22,
          },
        }),
      ],
    });
    expect(md).toContain('## Declared-but-unrealized');
    expect(md).toContain('At target');
    expect(md).not.toContain('## Variant spread uneven');
    // The variant detail still lists both sides of the skew.
    expect(md).toContain('below MIN_PER_VARIANT');
    expect(md).toContain('over quota');
  });

  it('puts a below-target unrealized cell in the self-heals bucket, with no demote', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [
        finding({
          approved: 12,
          target: 50,
          surfaceFlagged: false,
          needsTriage: false,
          specShortfall: {
            shortfalls: [{ axis: 'person', value: '2pl', floor: 5, actual: 0 }],
            approved: 12,
            target: 50,
            atTarget: false,
          },
        }),
      ],
    });
    expect(md).toContain('Below target — self-heals on resume');
    expect(md).not.toContain('At target — stuck');
    expect(md).not.toContain('demote required');
  });

  it('cross-references a cell that is both dismissed and declared-but-unrealized', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [
        finding({
          needsTriage: false,
          surfaceDismissed: true,
          dismissedByLedger: true,
          ledgerNotes: [
            { signal: 'answer-surface', surface: 'dicen', reason: 'Fixed frame.', dismissedOn: '2026-08-11' },
          ],
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

  /**
   * The section filters are exhaustive ONLY because every `declaredButUnrealized`
   * trigger is also covered by the `unrealized` / `imbalanced` render predicates —
   * two lists written independently ~100 lines apart, which produced three
   * separate "finding renders nowhere" bugs on this branch. This locks the
   * invariant: any non-trivial finding must appear somewhere in the markdown.
   */
  describe('every non-trivial finding renders somewhere', () => {
    const KEY = 'ES:B1:cloze:es-b1-shape';
    const variantSkew = (over: Partial<NonNullable<CellFinding['variantSkew']>>) => ({
      perVariant: [
        { id: 'hearsay', count: 12, share: 1, quota: 8 },
        { id: 'adversity', count: 2, share: 1, quota: 8 },
      ],
      overQuota: [],
      underMin: [],
      unrecognizedSeedCount: 0,
      declaredRows: 14,
      ...over,
    });
    const quiet = { surfaceFlagged: false, monotonyFlagged: false, needsTriage: false, surface: null };
    const specShortfall = {
      shortfalls: [{ axis: 'person' as const, value: '2pl', floor: 5, actual: 0 }],
      approved: 50,
      target: 50,
      atTarget: true,
    };

    const shapes: Array<[string, Partial<CellFinding>]> = [
      ['a coverageSpec shortfall only', { ...quiet, specShortfall }],
      ['an underMin variant only', { ...quiet, variantSkew: variantSkew({ underMin: ['adversity'] }) }],
      ['an overQuota variant only', { ...quiet, variantSkew: variantSkew({ overQuota: ['hearsay'] }) }],
      [
        'unrecognized seed rows only',
        { ...quiet, variantSkew: variantSkew({ unrecognizedSeedCount: 30 }) },
      ],
      [
        'flagged + preempted',
        {
          surfaceFlagged: true,
          needsTriage: false,
          preempted: true,
          variantSkew: variantSkew({ unrecognizedSeedCount: 30 }),
        },
      ],
      [
        'flagged + dismissed by the ledger',
        {
          surfaceFlagged: true,
          needsTriage: false,
          surfaceDismissed: true,
          dismissedByLedger: true,
          ledgerNotes: [
            { signal: 'answer-surface' as const, surface: 'dicen', reason: 'Fixed frame.', dismissedOn: '2026-08-11' },
          ],
        },
      ],
      ['monotony-flagged only', {
        ...quiet,
        monotonyFlagged: true,
        needsTriage: true,
        monotony: { topLemma: 'restaurante', count: 19, total: 20, share: 0.95 },
      }],
      ['needsTriage with no verdict (dry-run)', { needsTriage: true, verdict: null }],
      [
        'needsTriage + a collapsed verdict',
        {
          verdict: {
            verdict: 'collapsed' as const,
            mechanism: 'construction-variants' as const,
            rationale: 'um…zu is never drilled.',
            confidence: 'high' as const,
          },
        },
      ],
      [
        'needsTriage + a metric-artifact verdict',
        {
          verdict: {
            verdict: 'metric-artifact' as const,
            rationale: 'The bigram key merged two frames.',
            confidence: 'medium' as const,
          },
        },
      ],
      ['needsTriage + a triage error', { triageError: 'skipped — run hit --max-cost-usd 2' }],
    ];

    for (const [label, over] of shapes) {
      it(`renders ${label}`, () => {
        const md = renderMarkdown({
          name: 'run',
          scanned: 1,
          costUsd: 0,
          findings: [finding({ cellKey: KEY, ...over })],
        });
        expect(md, `${label} rendered nowhere`).toContain(KEY);
        expect(md).not.toContain('No collapse findings');
      });
    }

    it('may render a healthy cell nowhere', () => {
      const md = renderMarkdown({
        name: 'run',
        scanned: 1,
        costUsd: 0,
        findings: [finding({ cellKey: KEY, ...quiet })],
      });
      expect(md).not.toContain(KEY);
      expect(md).toContain('No collapse findings');
    });
  });
});
