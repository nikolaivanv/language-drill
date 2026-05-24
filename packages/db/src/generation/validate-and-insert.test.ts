/**
 * Unit tests for `validateAndInsertWithRetry`'s R5 malformed-retry recovery.
 *
 * No DB, no env vars, no live Anthropic. `validateDraft` and `generateBatch`
 * are mocked via `vi.mock`; the DB is a hand-rolled stub whose `.insert(...)
 * .values(...).onConflictDoNothing().returning(...)` chain simulates a dedup
 * conflict so the dedup-retry path fires.
 *
 * The exhaustive coverage of the retry loop (validator-rejected, dedup-
 * collided then approved, all-validator-rejected, etc.) lives in
 * `packages/db/scripts/generate-exercises.test.ts` (Phase 3 integration)
 * and `packages/db/src/generation/run-one-cell.test.ts` (Phase 4
 * integration). This file pins the R5 no-crash contract for the
 * specific patch: when a regenerated draft lands in
 * `result.malformedDrafts`, the function must surface
 * `{ ok: false, ... }` cleanly rather than crash on `undefined.contentJson`.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import type {
  ClaudeUsageBreakdown,
  ExerciseDraft,
  GenerateBatchResult,
  GenerationSpec,
  ValidateDraftResult,
} from '@language-drill/ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '../client';

import type { Cell } from './cells';

vi.mock('@language-drill/ai', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/ai')>(
    '@language-drill/ai',
  );
  return {
    ...actual,
    validateDraft: vi.fn(),
    generateBatch: vi.fn(),
  };
});

import { generateBatch, validateDraft } from '@language-drill/ai';

import { validateAndInsertWithRetry } from './validate-and-insert';

const mockValidateDraft = vi.mocked(validateDraft);
const mockGenerateBatch = vi.mocked(generateBatch);
const mockClient = {} as unknown as Anthropic;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const grammarPoint = {
  key: 'es-b1-test',
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  title: 'test',
  summary: 'test',
} as unknown as GenerationSpec['grammarPoint'];

const spec: GenerationSpec = {
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint,
  topicDomain: null,
  count: 1,
  batchSeed: 'test-seed',
};

const cell: Cell = {
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint,
  cellKey: 'es:b1:cloze:es-b1-test',
};

const args = {
  count: 1,
  batchSeed: 'test-seed',
  topicDomain: null,
  maxCostUsd: 5,
};

const generatedAt = new Date('2026-05-23T00:00:00Z');

const PASSING_VALIDATION: ValidateDraftResult = {
  result: {
    qualityScore: 0.9,
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

const PARSER_FAIL_USAGE: ClaudeUsageBreakdown = {
  // Distinct non-zero values so the test can assert these specific bytes
  // landed in `extraUsage` (not some other call's usage).
  inputTokens: 777,
  cacheCreationInputTokens: 33,
  cacheReadInputTokens: 22,
  outputTokens: 111,
};

function makeDraft(): ExerciseDraft {
  return {
    id: 'draft-0',
    contentJson: {
      type: ExerciseType.CLOZE,
      instructions: 'Fill in the blank.',
      sentence: 'Espero que tú ___ pronto.',
      correctAnswer: 'vengas',
    },
    metadata: {
      grammarPointKey: 'es-b1-test',
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

/**
 * Stub DB that:
 *   - INSERT into `exercises` returns `[]` (simulates dedup-index conflict on
 *     the `_dedupKey` constraint), so every attempt routes through the
 *     dedup-retry branch.
 *   - INSERT into `exerciseTags` is a no-op (never reached in the dedup-only
 *     scenario this file tests).
 *
 * The `as unknown as Db` cast is the same one used in `outcome-pool.test.ts`
 * — the production code only calls `db.insert(...).values(...)
 * .onConflictDoNothing().returning(...)` (plus a tags insert), so a minimal
 * builder that satisfies that chain shape is enough.
 */
function makeDedupAlwaysCollidesDb(): Db {
  return {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => {
          const promiseLike = Promise.resolve([]);
          return Object.assign(promiseLike, {
            returning: () => Promise.resolve([]),
          });
        },
      }),
    }),
  } as unknown as Db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockValidateDraft.mockReset();
  mockGenerateBatch.mockReset();
});

describe('validateAndInsertWithRetry — R5 malformed-retry recovery', () => {
  it('does not throw when every dedup-retry yields zero drafts + populated malformedDrafts', async () => {
    // Validator always approves so the flow falls through to INSERT (and
    // INSERT always dedups, dispatching the retry path).
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    // Every retry call returns the malformed shape. Before R5's fix, the
    // first such call would return `{ draft: undefined, usage }` and the
    // caller crashed on `currentDraft.contentJson`.
    mockGenerateBatch.mockResolvedValue({
      drafts: [],
      malformedDrafts: [
        {
          ordinal: 0,
          errorMessage: 'tool_use parser: missing required field correctAnswer',
        },
      ],
      tokenUsage: PARSER_FAIL_USAGE,
    } satisfies GenerateBatchResult);

    await expect(
      validateAndInsertWithRetry({
        db: makeDedupAlwaysCollidesDb(),
        client: mockClient,
        spec,
        draft: makeDraft(),
        ordinal: 0,
        cell,
        args,
        generatedAt,
      }),
    ).resolves.toBeDefined();
  });

  it('folds the parser-failed retry usage into extraUsage', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    mockGenerateBatch.mockResolvedValue({
      drafts: [],
      malformedDrafts: [{ ordinal: 0, errorMessage: 'parser err' }],
      tokenUsage: PARSER_FAIL_USAGE,
    } satisfies GenerateBatchResult);

    const outcome = await validateAndInsertWithRetry({
      db: makeDedupAlwaysCollidesDb(),
      client: mockClient,
      spec,
      draft: makeDraft(),
      ordinal: 0,
      cell,
      args,
      generatedAt,
    });

    // R5.2 — the wasted call's usage MUST land in `extraUsage` whether or
    // not Claude returned a parseable draft, otherwise budget accounting
    // diverges from billed cost.
    expect(outcome.extraUsage.inputTokens).toBeGreaterThanOrEqual(
      PARSER_FAIL_USAGE.inputTokens,
    );
    expect(outcome.extraUsage.outputTokens).toBeGreaterThanOrEqual(
      PARSER_FAIL_USAGE.outputTokens,
    );
    expect(outcome.extraUsage.cacheCreationInputTokens).toBeGreaterThanOrEqual(
      PARSER_FAIL_USAGE.cacheCreationInputTokens,
    );
    expect(outcome.extraUsage.cacheReadInputTokens).toBeGreaterThanOrEqual(
      PARSER_FAIL_USAGE.cacheReadInputTokens,
    );
  });

  it('returns terminalStatus="rejected" with parserFailedAtFinal=true after retries exhaust on parser failures', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    mockGenerateBatch.mockResolvedValue({
      drafts: [],
      malformedDrafts: [{ ordinal: 0, errorMessage: 'parser err' }],
      tokenUsage: PARSER_FAIL_USAGE,
    } satisfies GenerateBatchResult);

    const outcome = await validateAndInsertWithRetry({
      db: makeDedupAlwaysCollidesDb(),
      client: mockClient,
      spec,
      draft: makeDraft(),
      ordinal: 0,
      cell,
      args,
      generatedAt,
    });

    // R5.3 — when every retry slot consumes a parser failure, the ordinal
    // terminates with terminalStatus='rejected' AND parserFailedAtFinal=true
    // so the caller (`runOneCell`) can bump CellResult.parserFailedCount.
    // Either path is acceptable per task 16 — but both end with no throw.
    expect(outcome.terminalStatus).toBe('rejected');
    expect(outcome.parserFailedAtFinal).toBe(true);
  });

  it('survives a parser-failed retry mid-loop and continues without crashing', async () => {
    // First retry: parser-fail. Subsequent retries: still parser-fail
    // (so we don't accidentally exercise the success path). The point is
    // that the loop's `continue` survives a !retry.ok mid-iteration.
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    let generateCallCount = 0;
    mockGenerateBatch.mockImplementation(async () => {
      generateCallCount += 1;
      return {
        drafts: [],
        malformedDrafts: [
          {
            ordinal: 0,
            errorMessage: `parser err on retry ${generateCallCount}`,
          },
        ],
        tokenUsage: PARSER_FAIL_USAGE,
      };
    });

    const outcome = await validateAndInsertWithRetry({
      db: makeDedupAlwaysCollidesDb(),
      client: mockClient,
      spec,
      draft: makeDraft(),
      ordinal: 0,
      cell,
      args,
      generatedAt,
    });

    // At least one retry was dispatched (the loop didn't bail before
    // trying). `extraProduced` counts every retry call dispatched,
    // including parser-failed ones (R5.2 — they're billed regardless).
    expect(generateCallCount).toBeGreaterThanOrEqual(1);
    expect(outcome.extraProduced).toBeGreaterThanOrEqual(1);
    expect(outcome.terminalStatus).toBe('rejected');
  });
});

// ---------------------------------------------------------------------------
// tr-harmony-eval-grounding R3.2/R3.3 — the deterministic gate downgrades an
// LLM-approved Turkish cloze on the live insert path, with no extra Claude
// calls (the checker is pure).
// ---------------------------------------------------------------------------

const trGrammarPoint = {
  key: 'tr-a1-vowel-harmony',
  language: Language.TR,
  cefrLevel: CefrLevel.A1,
  title: 'Vowel harmony',
  summary: 'test',
} as unknown as GenerationSpec['grammarPoint'];

const trSpec: GenerationSpec = {
  language: Language.TR,
  cefrLevel: CefrLevel.A1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: trGrammarPoint,
  topicDomain: null,
  count: 1,
  batchSeed: 'tr-seed',
};

const trCell: Cell = {
  language: Language.TR,
  cefrLevel: CefrLevel.A1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: trGrammarPoint,
  cellKey: 'tr:a1:cloze:tr-a1-vowel-harmony',
};

function makeTrDraft(sentence: string, correctAnswer: string): ExerciseDraft {
  return {
    id: 'draft-0',
    contentJson: {
      type: ExerciseType.CLOZE,
      instructions: 'Fill in the blank.',
      sentence,
      correctAnswer,
    },
    metadata: {
      grammarPointKey: 'tr-a1-vowel-harmony',
      topicDomain: null,
      modelId: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inBatchDuplicate: false,
    },
  };
}

/** Stub DB whose exercises INSERT succeeds (returns one row), capturing the
 *  inserted `values` so the test can assert reviewStatus/flaggedReasons. */
function makeInsertSucceedsDb(capture: { exercise?: Record<string, unknown> }): Db {
  return {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        if (v && typeof v === 'object' && 'reviewStatus' in v) capture.exercise = v;
        const id = (v as { id?: string }).id ?? 'x';
        return {
          onConflictDoNothing: () =>
            Object.assign(Promise.resolve([{ id }]), {
              returning: () => Promise.resolve([{ id }]),
            }),
        };
      },
    }),
  } as unknown as Db;
}

describe('validateAndInsertWithRetry — deterministic Turkish gate', () => {
  it('rejects an LLM-approved cloze with a wrong-harmony blank, with no generator call', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);

    const outcome = await validateAndInsertWithRetry({
      db: makeDedupAlwaysCollidesDb(), // insert never reached on the rejected branch
      client: mockClient,
      spec: trSpec,
      draft: makeTrDraft('Pazarda taze domat___ satıyorlar.', 'ler'),
      ordinal: 0,
      cell: trCell,
      args,
      generatedAt,
    });

    expect(outcome.terminalStatus).toBe('rejected');
    expect(mockGenerateBatch).not.toHaveBeenCalled(); // pure check, no extra Claude call
    expect(outcome.validatedCount).toBe(1);
  });

  it('inserts a non-word-stem cloze as flagged with the deterministic reason persisted', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    const capture: { exercise?: Record<string, unknown> } = {};

    const outcome = await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb(capture),
      client: mockClient,
      spec: trSpec,
      draft: makeTrDraft('Bu domeş___ geldi.', 'ler'),
      ordinal: 0,
      cell: trCell,
      args,
      generatedAt,
    });

    expect(outcome.terminalStatus).toBe('inserted-flagged');
    expect(outcome.terminalReviewStatus).toBe('flagged');
    expect(capture.exercise?.reviewStatus).toBe('flagged');
    expect(capture.exercise?.flaggedReasons).toContain(
      'suspected malformed surface form (deterministic): domeşler',
    );
    expect(mockGenerateBatch).not.toHaveBeenCalled();
  });

  it('leaves a clean Turkish cloze auto-approved (gate is pass-through)', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    const capture: { exercise?: Record<string, unknown> } = {};

    const outcome = await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb(capture),
      client: mockClient,
      spec: trSpec,
      draft: makeTrDraft('Sokakta ev___ var.', 'ler'),
      ordinal: 0,
      cell: trCell,
      args,
      generatedAt,
    });

    expect(outcome.terminalStatus).toBe('inserted-approved');
    expect(capture.exercise?.reviewStatus).toBe('auto-approved');
  });
});
