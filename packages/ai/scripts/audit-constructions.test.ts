import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExerciseType } from '@language-drill/shared';
import {
  parseAuditConstructionsArgs,
  groupRowsIntoCells,
  renderConstructionsMarkdown,
  estimateCallCostUsd,
  rankFindings,
  createBudget,
  loadFixtureCases,
  scoreFixtureCase,
  FIXTURE_DRAWS_PER_CASE,
  type ConstructionAuditReport,
} from './audit-constructions.js';
import { CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT } from '../src/index.js';

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

const baseReport: ConstructionAuditReport = {
  runName: 'test-run',
  promptVersion: 'construction-coverage@2026-08-18',
  seed: 'default',
  samplePerCell: 24,
  partial: false,
  stoppedReason: null,
  summary: {
    pointsEnumerated: 2,
    pointsSingleConstruction: 1,
    cellsClassified: 1,
    rowsSampled: 24,
    findings: 1,
    enumerationSuspect: 0,
    dismissed: 0,
    thinCellsSkipped: 1,
    enumerationErrors: 0,
    costUsd: 0.42,
  },
  findings: [
    {
      cellKey: 'es-b1-reported-speech:cloze',
      grammarPointKey: 'es-b1-reported-speech',
      grammarPointName: 'Reported speech',
      type: 'cloze',
      language: 'ES',
      cefrLevel: 'B1',
      mechanism: 'construction-variants',
      sampled: 24,
      classified: 24,
      unresolved: 0,
      missing: [
        { id: 'command', label: 'que + present subjunctive', mustRepresent: true, count: 1, share: 0.0416 },
      ],
      counts: [
        { id: 'backshift', label: 'dijo que + imperfect', mustRepresent: true, count: 23, share: 0.958 },
        { id: 'command', label: 'que + present subjunctive', mustRepresent: true, count: 1, share: 0.0416 },
      ],
      proposal: { mechanism: 'construction-variants', snippet: 'constructionVariants: [...]', notes: 'n' },
    },
  ],
  enumerationSuspect: [],
  dismissed: [],
  thinCells: [{ cellKey: 'tr-a1-beri-dir:cloze', rows: 1 }],
  enumerationErrors: [],
};

describe('renderConstructionsMarkdown', () => {
  it('prints the sample denominator, never a bare count', () => {
    const md = renderConstructionsMarkdown(baseReport);
    expect(md).toContain('1/24');
    expect(md).toContain('sampled');
  });

  it('includes the prompt version and seed so a run is reproducible', () => {
    const md = renderConstructionsMarkdown(baseReport);
    expect(md).toContain('construction-coverage@2026-08-18');
    expect(md).toContain('default');
  });

  it('puts proposals in their own section', () => {
    const md = renderConstructionsMarkdown(baseReport);
    expect(md).toContain('## Proposed snippets');
  });

  it('lists skipped thin cells so a silent cap is impossible', () => {
    const md = renderConstructionsMarkdown(baseReport);
    expect(md).toContain('tr-a1-beri-dir:cloze');
  });

  it('marks a partial run prominently, with the coverage-absence caveat', () => {
    const md = renderConstructionsMarkdown({
      ...baseReport,
      partial: true,
      stoppedReason: 'cost cap of $2 reached',
    });
    expect(md).toContain('PARTIAL');
    expect(md).toContain('cost cap');
    expect(md).toContain('absence of a finding below is NOT evidence of coverage');
  });

  it('omits the PARTIAL banner entirely for a non-partial report', () => {
    const md = renderConstructionsMarkdown(baseReport);
    expect(md).not.toContain('PARTIAL');
    expect(md).not.toContain('NOT evidence of coverage');
  });
});

describe('rankFindings', () => {
  it('puts zero-realized constructions before merely-rare ones', () => {
    const zero = {
      ...baseReport.findings[0],
      cellKey: 'a:cloze',
      missing: [{ id: 'x', label: 'x', mustRepresent: true, count: 0, share: 0 }],
    };
    const rare = {
      ...baseReport.findings[0],
      cellKey: 'b:cloze',
      missing: [{ id: 'y', label: 'y', mustRepresent: true, count: 1, share: 0.04 }],
    };
    expect(rankFindings([rare, zero]).map((f) => f.cellKey)).toEqual(['a:cloze', 'b:cloze']);
  });

  it('breaks ties by cell size, biggest first', () => {
    const small = { ...baseReport.findings[0], cellKey: 'a:cloze', sampled: 10,
      missing: [{ id: 'x', label: 'x', mustRepresent: true, count: 0, share: 0 }] };
    const big = { ...baseReport.findings[0], cellKey: 'b:cloze', sampled: 24,
      missing: [{ id: 'y', label: 'y', mustRepresent: true, count: 0, share: 0 }] };
    expect(rankFindings([small, big]).map((f) => f.cellKey)).toEqual(['b:cloze', 'a:cloze']);
  });
});

describe('estimateCallCostUsd', () => {
  it('prices at Sonnet rates', () => {
    expect(estimateCallCostUsd({ input_tokens: 1_000_000, output_tokens: 0 } as never)).toBeCloseTo(3);
    expect(estimateCallCostUsd({ input_tokens: 0, output_tokens: 1_000_000 } as never)).toBeCloseTo(15);
  });

  it('prices a cache WRITE at 1.25x base input — all three stages cache-mark their system block', () => {
    expect(
      estimateCallCostUsd({
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
      } as never),
    ).toBeCloseTo(3.75);
  });

  it('prices a cache READ at 0.1x base input — every enumeration after the first hits the cache', () => {
    expect(
      estimateCallCostUsd({
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 1_000_000,
      } as never),
    ).toBeCloseTo(0.3);
  });

  it('reads cache fields defensively — null (the SDK type) must not throw or NaN the total', () => {
    expect(
      estimateCallCostUsd({
        input_tokens: 100,
        output_tokens: 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      } as never),
    ).toBeCloseTo(0.0003);
  });
});

describe('createBudget', () => {
  it('reports left() as true while spend stays under the cap', () => {
    const budget = createBudget(2);
    budget.spend(1);
    expect(budget.left()).toBe(true);
    expect(budget.partial()).toBe(false);
    expect(budget.reason()).toBeNull();
  });

  it('latches partial() and a cap-naming reason once spend reaches the cap', () => {
    const budget = createBudget(2);
    budget.spend(2);
    expect(budget.left()).toBe(false);
    expect(budget.partial()).toBe(true);
    expect(budget.reason()).toContain('cost cap');
    expect(budget.reason()).toContain('$2');
  });

  it('does not let a later markPartial overwrite an already-latched cost-cap reason', () => {
    const budget = createBudget(2);
    budget.spend(2);
    expect(budget.left()).toBe(false);
    const capReason = budget.reason();
    budget.markPartial('3 point(s) failed enumeration and were never examined');
    expect(budget.reason()).toBe(capReason);
  });

  it('markPartial alone latches partial() with its own reason, independent of the cap', () => {
    const budget = createBudget(2);
    budget.markPartial('3 point(s) failed enumeration and were never examined');
    expect(budget.partial()).toBe(true);
    expect(budget.reason()).toBe('3 point(s) failed enumeration and were never examined');
    // spend never reached the cap — left() still reflects the cap check, not markPartial.
    expect(budget.left()).toBe(true);
  });

  it('total() reflects cumulative spend, unaffected by markPartial', () => {
    const budget = createBudget(10);
    budget.spend(1.5);
    budget.spend(2.5);
    expect(budget.total()).toBeCloseTo(4);
  });
});

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(SCRIPT_DIR, 'fixtures', 'construction-coverage-cases.json');

describe('fixture', () => {
  it('parses', () => {
    expect(loadFixtureCases(FIXTURE_PATH).length).toBeGreaterThan(0);
  });

  // Memory: never build a judge's fixture from its own few-shot examples — the
  // check would measure memorisation, not judgment. Enforced mechanically so a
  // later prompt edit that adds an example breaks the build.
  it('shares no point key with the enumeration prompt examples', () => {
    for (const c of loadFixtureCases(FIXTURE_PATH)) {
      expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).not.toContain(c.grammarPointKey);
    }
  });

  it('gives every case an expected must-represent count', () => {
    for (const c of loadFixtureCases(FIXTURE_PATH)) {
      expect(Number.isInteger(c.expectedMustRepresentCount)).toBe(true);
    }
  });
});

describe('scoreFixtureCase', () => {
  it('takes the majority across draws', () => {
    expect(scoreFixtureCase([2, 2, 3], 2)).toEqual({ majority: 2, passed: true });
    expect(scoreFixtureCase([1, 1, 3], 2)).toEqual({ majority: 1, passed: false });
  });

  it('uses three draws', () => {
    expect(FIXTURE_DRAWS_PER_CASE).toBe(3);
  });
});
