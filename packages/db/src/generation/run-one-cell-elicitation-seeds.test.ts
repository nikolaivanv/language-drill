/**
 * Pure unit test for the `'elicitation-values'` prior-seed exclusion wiring
 * inside `runOneCell`.
 *
 * `seedKindFor` routes self-revealing flagged cloze/translation cells
 * (`grammarPoint.selfRevealingElicitation`) to `seedKind: 'elicitation-values'`,
 * whose `buildSeedWords` branch seeds from the curated
 * `grammarPoint.elicitationSeedValues` pool (no DB query — see the
 * `'buildSeedWords — elicitation-values (curated pool, no DB)'` suite in
 * `run-one-cell.test.ts`). But the cross-run *exclude* set (`priorSeeds`) fed
 * into that call is computed one level up, inside `runOneCell`, by a ternary
 * keyed on `seedKind` that decides which `fetchPrior*Seeds` query to run.
 * That ternary is the thing under test here: it must route
 * `'elicitation-values'` into the same `fetchPriorSeeds` arm as `'frequency'`
 * (both read `content_json->>'seedWord'` scoped to the cell), or a re-run of
 * a below-target flagged cell re-picks values already live in the pool
 * forever, and the documented bounded-pool termination ("once the live pool
 * covers it, `pickSeeds` returns nulls and the cell stops") never engages.
 *
 * Lives in a sibling file (not inside `run-one-cell.test.ts`) for the same
 * reason as `run-one-cell-r5-accounting.test.ts`: `vi.mock(...)` is hoisted
 * to module scope, so adding pool mocks to the integration file would
 * replace the real pools for the existing `TEST_DATABASE_URL`-gated tests.
 * This file stays unit-pure: no DB, no env vars, no Claude — it reuses the
 * exact stub-`Db` + mocked-pools convention from
 * `run-one-cell-r5-accounting.test.ts`.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  ZERO_USAGE,
  type ExerciseDraft,
  type GenerationSpec,
  type ValidateDraftResult,
} from '@language-drill/ai';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '../client';

vi.mock('./generator-pool', async () => ({
  runGeneratorPool: vi.fn(),
}));
vi.mock('./validator-pool', async () => ({
  runValidatorPool: vi.fn(),
}));
vi.mock('./outcome-pool', async () => ({
  runOutcomePool: vi.fn(),
}));

import { runGeneratorPool } from './generator-pool';
import { runValidatorPool } from './validator-pool';
import { runOutcomePool } from './outcome-pool';

import type { Cell } from './cells';
import { runOneCell } from './run-one-cell';
import type { DraftOutcome } from './validate-and-insert';

const mockGeneratorPool = vi.mocked(runGeneratorPool);
const mockValidatorPool = vi.mocked(runValidatorPool);
const mockOutcomePool = vi.mocked(runOutcomePool);
const mockClient = {} as unknown as Anthropic;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A flagged self-revealing grammar point with a curated pool of exactly one
// value. Sizing the pool to exactly `count` is what makes the exclusion
// wiring observable without depending on `pickSeeds`'s hash-based start
// index: if the one prior value ISN'T excluded, it's the only candidate and
// gets re-picked; if it IS excluded, the band is exhausted and the slot is
// `null` (the documented bounded-pool termination).
const flaggedGrammarPoint = {
  key: 'tr-a2-elicitation-test',
  language: Language.TR,
  cefrLevel: CefrLevel.A2,
  title: 'test',
  summary: 'test',
  selfRevealingElicitation: 'digit-form' as const,
  elicitationSeedValues: ['birinci'],
} as unknown as GenerationSpec['grammarPoint'];

const flaggedCell: Cell = {
  language: Language.TR,
  cefrLevel: CefrLevel.A2,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: flaggedGrammarPoint,
  cellKey: 'tr:a2:cloze:tr-a2-elicitation-test',
};

function makeDraft(ordinal: number): ExerciseDraft {
  return {
    id: `draft-${ordinal}`,
    contentJson: {
      type: ExerciseType.CLOZE,
      instructions: 'Fill in the blank.',
      sentence: `Sentence ${ordinal} ___.`,
      correctAnswer: 'birinci',
    },
    metadata: {
      grammarPointKey: flaggedGrammarPoint.key,
      topicDomain: null,
      modelId: 'claude-sonnet-4-5',
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inBatchDuplicate: false,
    },
  };
}

function makeValidation(): ValidateDraftResult {
  return {
    result: {
      qualityScore: 0.85,
      ambiguous: false,
      contextSpoilsAnswer: false,
      levelMatch: true,
      grammarPointMatch: true,
      culturalIssues: [],
      flaggedReasons: [],
    },
    tokenUsage: {
      inputTokens: 10,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 5,
    },
  };
}

function makeApprovedOutcome(): DraftOutcome {
  return {
    terminalStatus: 'inserted-approved',
    terminalReviewStatus: 'auto-approved',
    extraUsage: ZERO_USAGE,
    extraProduced: 0,
    validatedCount: 1,
  };
}

/**
 * Minimal DB stub for the `runOneCell` call paths exercised by this test:
 *   - `db.select({id}).from(skillTopics).where(...).limit(1)` (precheck)
 *     resolves via `.limit()` to a matching skill-topic row.
 *   - `db.select({seed}).from(exercises).where(...)` (awaited directly, no
 *     `.limit()`/`.orderBy()`) is `fetchPriorSeeds` — resolves to a row
 *     carrying `content_json->>'seedWord' = 'birinci'`, simulating a prior
 *     run that already anchored the pool's only curated value. The
 *     `elicitation-values` `buildSeedWords` branch never queries the DB
 *     itself (curated pool, not a DB band), so this is the ONLY row-bearing
 *     select in play for this cell.
 *   - `db.insert(generationJobs).values(...)` / `db.update(generationJobs)`
 *     resolve (audit row open/close).
 */
function makeStubDb(): Db {
  const selectChain = {
    from: () => ({
      where: () =>
        Object.assign(Promise.resolve([{ seed: 'birinci' }] as unknown[]), {
          limit: () => Promise.resolve([{ id: 'skill-topic-stub' }]),
        }),
    }),
  };
  const insertChain = {
    values: () => Promise.resolve(),
  };
  const updateChain = {
    set: () => ({
      where: () => Promise.resolve(),
    }),
  };
  return {
    select: () => selectChain,
    insert: () => insertChain,
    update: () => updateChain,
  } as unknown as Db;
}

beforeEach(() => {
  mockGeneratorPool.mockReset();
  mockValidatorPool.mockReset();
  mockOutcomePool.mockReset();
});

describe('runOneCell — elicitation-values prior-seed exclusion', () => {
  it('excludes a value already anchored in the live pool instead of re-picking it', async () => {
    mockGeneratorPool.mockResolvedValue({
      drafts: [makeDraft(0)],
      tokenUsage: ZERO_USAGE,
      malformedDrafts: [],
    });
    mockValidatorPool.mockResolvedValue(new Map([[0, makeValidation()]]));
    mockOutcomePool.mockResolvedValue({
      results: new Map<number, DraftOutcome>([[0, makeApprovedOutcome()]]),
      earlyBailed: false,
    });

    await runOneCell({
      db: makeStubDb(),
      client: mockClient,
      cell: flaggedCell,
      args: {
        count: 1,
        batchSeed: 'elicitation-exclude-test',
        topicDomain: null,
        maxCostUsd: 5,
      },
      jobId: 'job-elicitation-test',
      trigger: 'cli',
    });

    expect(mockGeneratorPool).toHaveBeenCalledTimes(1);
    const spec = mockGeneratorPool.mock.calls[0]![0].spec as GenerationSpec;
    // 'birinci' is the pool's only curated value AND is already live in the
    // pool (per the stub's `fetchPriorSeeds` row) — a correctly-wired
    // exclude set exhausts the band, leaving the one ordinal seedless
    // (`null`), not a re-picked 'birinci'.
    expect(spec.seedWords).toEqual([null]);
  });
});
