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
import {
  CefrLevel,
  ExerciseType,
  GenerationReasonCode,
  Language,
} from '@language-drill/shared';
import type {
  ClaudeUsageBreakdown,
  ExerciseDraft,
  GenerateBatchResult,
  GenerationSpec,
  LlmTraceContext,
  ValidateDraftResult,
} from '@language-drill/ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '../client';

import type { Cell } from './cells';

// `withLlmTrace` / `getCurrentLlmTraceContext` are intentionally NOT mocked
// (the `...actual` spread keeps the real ALS-backed implementations). They
// share the module-singleton `AsyncLocalStorage` with `validate-and-insert.ts`,
// so a real outer `withLlmTrace` scope here is observed by the production code's
// nested scope — letting the trace-context tests assert true end-to-end ALS
// behavior rather than a stubbed call count.
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

import {
  generateBatch,
  getCurrentLlmTraceContext,
  validateDraft,
  withLlmTrace,
} from '@language-drill/ai';

import {
  PARSER_FAILURE_REASON,
  VOCAB_MAX_PER_WORD,
  validateAndInsertWithRetry,
} from './validate-and-insert';

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
    coverage: {},
  },
  tokenUsage: {
    inputTokens: 10,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 5,
  },
};

/** Routes to `rejected`: sub-0.5 quality AND a spoiling context, so the
 *  routed reasons are deterministic and ordered (low-quality, then spoils). */
const REJECTING_VALIDATION: ValidateDraftResult = {
  result: {
    qualityScore: 0.3,
    ambiguous: false,
    contextSpoilsAnswer: true,
    levelMatch: true,
    grammarPointMatch: true,
    culturalIssues: [],
    flaggedReasons: [],
    coverage: {},
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
    // The deterministic reason is persisted as a coded `{ code, detail }`
    // object (the reconstructed surface form lives in `detail`, never baked
    // into the code key).
    expect(capture.exercise?.flaggedReasons).toContainEqual({
      code: GenerationReasonCode.MalformedSurfaceForm,
      detail: 'domeşler',
    });
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
    // No reasons → `flagged_reasons` is persisted as `null`, not an empty array.
    expect(capture.exercise?.flaggedReasons).toBeNull();
    // The inserted row id is surfaced so the generation handler can enqueue
    // an audio-synth job for newly-approved dictation rows (PR 2). On a clean
    // first-attempt insert it equals the original draft id.
    expect(outcome.insertedExerciseId).toBe('draft-0');
  });
});

// ---------------------------------------------------------------------------
// Seed persistence (R5.3 / R5.7): the ordinal's frequency seed is written as a
// writer-only `seedWord` inside content_json (next to `_dedupKey`) so a later
// run can read it back as the cross-run "already anchored" exclude set.
// ---------------------------------------------------------------------------

describe('validateAndInsertWithRetry — seed persistence', () => {
  it('persists the ordinal seed as a writer-only seedWord in content_json', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    const capture: { exercise?: Record<string, unknown> } = {};

    const outcome = await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb(capture),
      client: mockClient,
      spec: { ...trSpec, seedWords: ['kahve'] }, // seed assigned to ordinal 0
      draft: makeTrDraft('Sokakta ev___ var.', 'ler'),
      ordinal: 0,
      cell: trCell,
      args,
      generatedAt,
    });

    expect(outcome.terminalStatus).toBe('inserted-approved');
    const content = capture.exercise?.contentJson as Record<string, unknown>;
    expect(content.seedWord).toBe('kahve');
    // The existing dedup key is still written alongside it.
    expect(content._dedupKey).toEqual(expect.any(String));
  });

  it('reads the seed at the ordinal index (not slot 0)', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    const capture: { exercise?: Record<string, unknown> } = {};

    await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb(capture),
      client: mockClient,
      spec: { ...trSpec, seedWords: ['kahve', 'kitap', 'okul'] },
      draft: makeTrDraft('Sokakta ev___ var.', 'ler'),
      ordinal: 2,
      cell: trCell,
      args,
      generatedAt,
    });

    const content = capture.exercise?.contentJson as Record<string, unknown>;
    expect(content.seedWord).toBe('okul');
  });

  it('omits seedWord when the spec carries no seeds', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    const capture: { exercise?: Record<string, unknown> } = {};

    await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb(capture),
      client: mockClient,
      spec: trSpec, // no seedWords
      draft: makeTrDraft('Sokakta ev___ var.', 'ler'),
      ordinal: 0,
      cell: trCell,
      args,
      generatedAt,
    });

    const content = capture.exercise?.contentJson as Record<string, unknown>;
    expect('seedWord' in content).toBe(false);
  });

  it('omits seedWord when the ordinal seed is null (unseeded fallback)', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    const capture: { exercise?: Record<string, unknown> } = {};

    await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb(capture),
      client: mockClient,
      spec: { ...trSpec, seedWords: [null] },
      draft: makeTrDraft('Sokakta ev___ var.', 'ler'),
      ordinal: 0,
      cell: trCell,
      args,
      generatedAt,
    });

    const content = capture.exercise?.contentJson as Record<string, unknown>;
    expect('seedWord' in content).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 coverage controller — realizedCoverage on inserted DraftOutcome.
// The validator's full `coverage` tags are surfaced on the outcome so the
// per-axis tally in `run-one-cell` can credit the right buckets without re-
// reading from the DB. Set ONLY on the inserted-* / dedup-then-success
// return paths; absent on rejected / dedup-given-up.
// ---------------------------------------------------------------------------

describe('validateAndInsertWithRetry — realizedCoverage on inserted outcome', () => {
  const throwaway: { exercise?: Record<string, unknown> } = {};

  it('carries realizedCoverage from the validator coverage on an inserted-approved outcome', async () => {
    // Validator approves with a person tag; the outcome must surface the tags.
    mockValidateDraft.mockResolvedValue({
      ...PASSING_VALIDATION,
      result: { ...PASSING_VALIDATION.result, coverage: { person: '2pl' } },
    });

    const outcome = await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb(throwaway),
      client: mockClient,
      spec: trSpec,
      draft: makeTrDraft('Sokakta ev___ var.', 'ler'),
      ordinal: 0,
      cell: trCell,
      args,
      generatedAt,
    });

    expect(outcome.terminalStatus).toBe('inserted-approved');
    expect(outcome.realizedCoverage).toEqual({ person: '2pl' });
  });

  it('surfaces empty realizedCoverage when the validator reports no axes', async () => {
    // PASSING_VALIDATION already has coverage: {} (no axes).
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);

    const outcome = await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb(throwaway),
      client: mockClient,
      spec: trSpec,
      draft: makeTrDraft('Sokakta ev___ var.', 'ler'),
      ordinal: 0,
      cell: trCell,
      args,
      generatedAt,
    });

    expect(outcome.terminalStatus).toBe('inserted-approved');
    expect(outcome.realizedCoverage).toEqual({});
    expect(outcome.realizedCoverage?.person).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rejection-reason capture — the discarded ordinal carries its reasons out via
// `DraftOutcome.rejectionReasons` so `runOneCell` can aggregate the
// distribution. Insert behavior is unchanged; this only surfaces what was
// already computed and previously thrown away.
// ---------------------------------------------------------------------------

describe('validateAndInsertWithRetry — rejectionReasons capture', () => {
  it('surfaces the routed validator reasons on a first-attempt rejection', async () => {
    mockValidateDraft.mockResolvedValue(REJECTING_VALIDATION);

    const outcome = await validateAndInsertWithRetry({
      db: makeDedupAlwaysCollidesDb(), // insert never reached on the rejected branch
      client: mockClient,
      spec,
      draft: makeDraft(),
      ordinal: 0,
      cell,
      args,
      generatedAt,
    });

    expect(outcome.terminalStatus).toBe('rejected');
    // routeValidationResult order: low-quality first, then context-spoils.
    // Both are predicate-only codes (no detail).
    expect(outcome.rejectionReasons).toEqual([
      { code: GenerationReasonCode.LowQualityReject },
      { code: GenerationReasonCode.ContextSpoilsAnswer },
    ]);
    // A rejected ordinal inserts nothing → no audio-synth id (PR 2).
    expect(outcome.insertedExerciseId).toBeUndefined();
    // No retry: a non-deduped first-attempt rejection terminates immediately.
    expect(mockGenerateBatch).not.toHaveBeenCalled();
  });

  it('captures the deterministic wrong-harmony reason (prepended) on a TR rejection', async () => {
    // LLM approves, but the pure Turkish gate vetoes the wrong allomorph.
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);

    const outcome = await validateAndInsertWithRetry({
      db: makeDedupAlwaysCollidesDb(),
      client: mockClient,
      spec: trSpec,
      draft: makeTrDraft('Pazarda taze domat___ satıyorlar.', 'ler'),
      ordinal: 0,
      cell: trCell,
      args,
      generatedAt,
    });

    expect(outcome.terminalStatus).toBe('rejected');
    // Deterministic reason is prepended as a coded object; the interpolated
    // allomorph values land in `detail`, never in the code key.
    expect(outcome.rejectionReasons?.[0].code).toBe(
      GenerationReasonCode.VowelHarmonyAllomorph,
    );
    expect(outcome.rejectionReasons?.[0].detail).toMatch(/^expected .+, got /);
  });

  it('uses the synthetic PARSER_FAILURE_REASON when retries exhaust on parser failures', async () => {
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

    expect(outcome.terminalStatus).toBe('rejected');
    expect(outcome.parserFailedAtFinal).toBe(true);
    expect(outcome.rejectionReasons).toEqual([PARSER_FAILURE_REASON]);
  });
});

// ---------------------------------------------------------------------------
// R6 — vocab_recall per-word count cap. Before INSERT, the approved/flagged
// rows for (cell, expectedWord) are counted; at/over VOCAB_MAX_PER_WORD the
// draft is treated as a collision and routed through the dedup-retry path
// (asks the generator for a different word). Under cap, the insert proceeds.
// ---------------------------------------------------------------------------

const vocabGrammarPoint = {
  key: 'es-a1-vocab',
  language: Language.ES,
  cefrLevel: CefrLevel.A1,
  title: 'Core vocabulary',
  summary: 'test',
} as unknown as GenerationSpec['grammarPoint'];

const vocabSpec: GenerationSpec = {
  language: Language.ES,
  cefrLevel: CefrLevel.A1,
  exerciseType: ExerciseType.VOCAB_RECALL,
  grammarPoint: vocabGrammarPoint,
  topicDomain: null,
  count: 1,
  batchSeed: 'vocab-seed',
};

const vocabCell: Cell = {
  language: Language.ES,
  cefrLevel: CefrLevel.A1,
  exerciseType: ExerciseType.VOCAB_RECALL,
  grammarPoint: vocabGrammarPoint,
  cellKey: 'es:a1:vocab_recall:es-a1-vocab',
};

function makeVocabDraft(): ExerciseDraft {
  return {
    id: 'vocab-draft-0',
    contentJson: {
      type: ExerciseType.VOCAB_RECALL,
      instructions: 'Recall the word.',
      prompt: 'What is the Spanish for "house"?',
      expectedWord: 'casa',
      hints: [],
      exampleSentence: 'La casa es grande.',
    },
    metadata: {
      grammarPointKey: 'es-a1-vocab',
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

/**
 * Stub DB whose per-word count query (`select(...).from(...).where(...)`)
 * resolves to `wordCount`, and whose exercises/tags INSERT succeeds (returns
 * one row), optionally capturing the inserted exercise `values`.
 */
function makeVocabDb(wordCount: number, capture?: { exercise?: Record<string, unknown> }): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ n: wordCount }]),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        if (capture && v && typeof v === 'object' && 'reviewStatus' in v) {
          capture.exercise = v;
        }
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

describe('validateAndInsertWithRetry — R6 vocab per-word cap', () => {
  it('inserts a vocab_recall draft when the word is under the per-word cap', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    const capture: { exercise?: Record<string, unknown> } = {};

    const outcome = await validateAndInsertWithRetry({
      db: makeVocabDb(VOCAB_MAX_PER_WORD - 1, capture),
      client: mockClient,
      spec: vocabSpec,
      draft: makeVocabDraft(),
      ordinal: 0,
      cell: vocabCell,
      args,
      generatedAt,
    });

    expect(outcome.terminalStatus).toBe('inserted-approved');
    // Under cap: the INSERT proceeded, no regeneration was needed.
    expect(mockGenerateBatch).not.toHaveBeenCalled();
    expect((capture.exercise?.contentJson as Record<string, unknown>).expectedWord).toBe('casa');
  });

  it('routes an at-cap vocab_recall word through dedup-retry to dedup-given-up', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    // Every retry returns a parseable vocab draft for the SAME word, so the
    // cap check trips on every attempt and the slot is never inserted.
    mockGenerateBatch.mockResolvedValue({
      drafts: [makeVocabDraft()],
      malformedDrafts: [],
      tokenUsage: PARSER_FAIL_USAGE,
    } satisfies GenerateBatchResult);

    const outcome = await validateAndInsertWithRetry({
      db: makeVocabDb(VOCAB_MAX_PER_WORD), // word already at the cap
      client: mockClient,
      spec: vocabSpec,
      draft: makeVocabDraft(),
      ordinal: 0,
      cell: vocabCell,
      args,
      generatedAt,
    });

    // At cap → collision on every attempt → all retries exhausted.
    expect(outcome.terminalStatus).toBe('dedup-given-up');
    // The generator WAS asked for a different word (one retry per remaining slot).
    expect(outcome.extraProduced).toBe(3);
    expect(mockGenerateBatch).toHaveBeenCalledTimes(3);
    // Nothing was inserted, so there is no audio-synth id to surface (PR 2).
    expect(outcome.insertedExerciseId).toBeUndefined();
  });

  it('does not apply the per-word cap to cloze cells', async () => {
    // A non-vocab cell whose count query (if ever called) would report "at cap"
    // must still insert — the cap is vocab_recall-only.
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);

    const outcome = await validateAndInsertWithRetry({
      db: makeVocabDb(VOCAB_MAX_PER_WORD),
      client: mockClient,
      spec, // CLOZE spec/cell from the top of the file
      draft: makeDraft(),
      ordinal: 0,
      cell,
      args,
      generatedAt,
    });

    expect(outcome.terminalStatus).toBe('inserted-approved');
    expect(mockGenerateBatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R8 / tech-debt "Langfuse `validate` traces missing `exerciseId` metadata":
// `validateAndInsertWithRetry` opens a per-ordinal `withLlmTrace` scope that
// inherits the cell-level parent context and contributes `exerciseId`, so every
// validator (and retry-generator) call this ordinal emits shares the draft id as
// a Langfuse join key. These tests drive the REAL ALS — `withLlmTrace` /
// `getCurrentLlmTraceContext` are unmocked — and capture the context observed at
// each `validateDraft` call.
// ---------------------------------------------------------------------------

/** A representative cell-level parent scope, mirroring the one opened in
 *  `infra/lambda/src/generation/handler.ts` around each SQS record. */
const parentCellCtx: LlmTraceContext = {
  feature: 'generate',
  env: 'dev',
  promptVersion: 'generate@2026-06-02',
  requestId: 'req-test-0001',
  jobId: 'job-abc',
  cellKey: cell.cellKey,
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CLOZE,
};

describe('validateAndInsertWithRetry — per-ordinal exerciseId trace scope', () => {
  it('tags the validate call with exerciseId=draft.id and inherits the parent cell scope', async () => {
    const seen: Array<LlmTraceContext | undefined> = [];
    mockValidateDraft.mockImplementation(async () => {
      seen.push(getCurrentLlmTraceContext());
      return PASSING_VALIDATION;
    });
    const capture: { exercise?: Record<string, unknown> } = {};

    // Run inside a real outer (cell-level) scope, as the generation Lambda does.
    const outcome = await withLlmTrace(parentCellCtx, () =>
      validateAndInsertWithRetry({
        db: makeInsertSucceedsDb(capture),
        client: mockClient,
        spec,
        draft: makeDraft(),
        ordinal: 0,
        cell,
        args,
        generatedAt,
      }),
    );

    expect(outcome.terminalStatus).toBe('inserted-approved');
    expect(seen).toHaveLength(1);
    // The nested scope carries the draft id as `exerciseId` …
    expect(seen[0]?.exerciseId).toBe('draft-0');
    // … while inheriting the parent cell context (feature/jobId/cellKey/etc.).
    expect(seen[0]?.feature).toBe('generate');
    expect(seen[0]?.jobId).toBe('job-abc');
    expect(seen[0]?.cellKey).toBe(cell.cellKey);
    expect(seen[0]?.promptVersion).toBe('generate@2026-06-02');
  });

  it('reuses the same exerciseId across every dedup-retry validation', async () => {
    const seen: Array<LlmTraceContext | undefined> = [];
    mockValidateDraft.mockImplementation(async () => {
      seen.push(getCurrentLlmTraceContext());
      return PASSING_VALIDATION;
    });
    // Each retry returns a parseable draft with a DIFFERENT id, so the loop
    // re-validates a fresh `currentDraft` on every attempt. The scope, opened
    // once with the ORIGINAL draft id, must still tag each of those calls.
    let retryN = 0;
    mockGenerateBatch.mockImplementation(async () => {
      retryN += 1;
      const d = makeDraft();
      d.id = `draft-retry-${retryN}`;
      return {
        drafts: [d],
        malformedDrafts: [],
        tokenUsage: PARSER_FAIL_USAGE,
      } satisfies GenerateBatchResult;
    });

    const outcome = await withLlmTrace(parentCellCtx, () =>
      validateAndInsertWithRetry({
        db: makeDedupAlwaysCollidesDb(), // every insert dedups → drives the retry loop
        client: mockClient,
        spec,
        draft: makeDraft(), // id 'draft-0'
        ordinal: 0,
        cell,
        args,
        generatedAt,
      }),
    );

    // Loop exhausts all retry slots: attempt 0 + MAX_DEDUP_RETRIES re-validations.
    expect(outcome.terminalStatus).toBe('dedup-given-up');
    expect(seen.length).toBeGreaterThanOrEqual(2);
    // Stable across retries: the join key is the ORIGINAL draft id throughout,
    // even though `currentDraft` was replaced by `draft-retry-N` mid-loop.
    expect(seen.every((c) => c?.exerciseId === 'draft-0')).toBe(true);
  });

  it('does not fabricate a trace scope on the CLI path (no parent context)', async () => {
    // CLI runs (`generate-exercises.ts`) call in without an outer `withLlmTrace`;
    // the function must skip the wrap rather than invent a context with missing
    // required fields — so the validate call observes no ALS scope.
    const seen: Array<LlmTraceContext | undefined> = [];
    mockValidateDraft.mockImplementation(async () => {
      seen.push(getCurrentLlmTraceContext());
      return PASSING_VALIDATION;
    });
    const capture: { exercise?: Record<string, unknown> } = {};

    const outcome = await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb(capture),
      client: mockClient,
      spec,
      draft: makeDraft(),
      ordinal: 0,
      cell,
      args,
      generatedAt,
    });

    expect(outcome.terminalStatus).toBe('inserted-approved');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeUndefined();
  });
});
