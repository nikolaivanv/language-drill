import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CefrLevel,
  ExerciseType,
  Language,
  type LearningLanguage,
} from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Mock @language-drill/db before importing the module under test. Only the
// `generationJobs` table object's `id` and `status` columns are referenced by
// `checkAuditRowState`; `Db` is a type-only re-export so no runtime stub is
// needed. Pattern mirrors infra/lambda/src/middleware/auth.test.ts.
// ---------------------------------------------------------------------------

vi.mock('@language-drill/db', () => ({
  generationJobs: { id: 'id', status: 'status' },
}));

import {
  parseGenerationJobMessage,
  checkAuditRowState,
  type GenerationJobMessage,
} from './job-message';
import type { CurriculumCefrLevel, Db } from '@language-drill/db';

// ---------------------------------------------------------------------------
// Test fixture factory: a known-good message each test derives from.
// ---------------------------------------------------------------------------

function validMessage(): GenerationJobMessage {
  return {
    jobId: 'job-123',
    trigger: 'cli',
    spec: {
      language: Language.ES as LearningLanguage,
      cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
      exerciseType: ExerciseType.CLOZE,
      grammarPointKey: 'es-b1-present-subjunctive',
      topicDomain: null,
      count: 50,
      batchSeed: 'phase-4-test',
    },
    maxCostUsd: 0.5,
  };
}

// Helper: clone the valid fixture as a plain mutable object so tests can
// delete fields or overwrite them with invalid values without mutating the
// shared factory output.
function cloneAsRecord(): Record<string, unknown> {
  const m = validMessage();
  return {
    jobId: m.jobId,
    trigger: m.trigger,
    spec: { ...m.spec },
    maxCostUsd: m.maxCostUsd,
  };
}

describe('parseGenerationJobMessage — top-level shape', () => {
  it('throws when input is null', () => {
    expect(() => parseGenerationJobMessage(null)).toThrow(
      /GenerationJobMessage: expected object, got null/,
    );
  });

  it('throws when input is an array', () => {
    expect(() => parseGenerationJobMessage([])).toThrow(
      /GenerationJobMessage: expected object, got array/,
    );
  });

  it('throws when input is a number', () => {
    expect(() => parseGenerationJobMessage(42)).toThrow(
      /GenerationJobMessage: expected object, got number/,
    );
  });

  it('throws when input is a string', () => {
    expect(() => parseGenerationJobMessage('not an object')).toThrow(
      /GenerationJobMessage: expected object, got string/,
    );
  });
});

describe('parseGenerationJobMessage — missing required fields', () => {
  it('throws when jobId is missing', () => {
    const msg = cloneAsRecord();
    delete msg.jobId;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/jobId/);
  });

  it('throws when trigger is missing', () => {
    const msg = cloneAsRecord();
    delete msg.trigger;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/trigger/);
  });

  it('throws when spec is missing', () => {
    const msg = cloneAsRecord();
    delete msg.spec;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec/);
  });

  it('throws when spec.language is missing', () => {
    const msg = cloneAsRecord();
    delete (msg.spec as Record<string, unknown>).language;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.language/);
  });

  it('throws when spec.cefrLevel is missing', () => {
    const msg = cloneAsRecord();
    delete (msg.spec as Record<string, unknown>).cefrLevel;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.cefrLevel/);
  });

  it('throws when spec.exerciseType is missing', () => {
    const msg = cloneAsRecord();
    delete (msg.spec as Record<string, unknown>).exerciseType;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.exerciseType/);
  });

  it('throws when spec.grammarPointKey is missing', () => {
    const msg = cloneAsRecord();
    delete (msg.spec as Record<string, unknown>).grammarPointKey;
    expect(() => parseGenerationJobMessage(msg)).toThrow(
      /spec\.grammarPointKey/,
    );
  });

  it('throws when spec.topicDomain is missing', () => {
    const msg = cloneAsRecord();
    delete (msg.spec as Record<string, unknown>).topicDomain;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.topicDomain/);
  });

  it('throws when spec.count is missing', () => {
    const msg = cloneAsRecord();
    delete (msg.spec as Record<string, unknown>).count;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.count/);
  });

  it('throws when spec.batchSeed is missing', () => {
    const msg = cloneAsRecord();
    delete (msg.spec as Record<string, unknown>).batchSeed;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.batchSeed/);
  });

  it('throws when maxCostUsd is missing', () => {
    const msg = cloneAsRecord();
    delete msg.maxCostUsd;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });
});

describe('parseGenerationJobMessage — wrong types per field', () => {
  it('throws when jobId is a number', () => {
    const msg = cloneAsRecord();
    msg.jobId = 123;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/jobId/);
  });

  it('throws when trigger is a boolean', () => {
    const msg = cloneAsRecord();
    msg.trigger = true;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/trigger/);
  });

  it('throws when spec is a string', () => {
    const msg = cloneAsRecord();
    msg.spec = 'not-an-object';
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec/);
  });

  it('throws when spec.count is a string', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).count = '50';
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.count/);
  });

  it('throws when spec.topicDomain is a number (must be string-or-null)', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).topicDomain = 42;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.topicDomain/);
  });

  it('throws when maxCostUsd is a string', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = '0.5';
    expect(() => parseGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });
});

describe('parseGenerationJobMessage — value constraints', () => {
  it('rejects empty-string jobId', () => {
    const msg = cloneAsRecord();
    msg.jobId = '';
    expect(() => parseGenerationJobMessage(msg)).toThrow(/jobId/);
  });

  it('rejects unknown trigger value', () => {
    const msg = cloneAsRecord();
    msg.trigger = 'foo';
    expect(() => parseGenerationJobMessage(msg)).toThrow(/trigger/);
  });

  it("rejects unknown spec.language (e.g. 'FR')", () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).language = 'FR';
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.language/);
  });

  it("rejects unknown spec.language ('EN' is excluded from runtime allow-set)", () => {
    // The shared LearningLanguage type is `Exclude<Language, Language.EN>`
    // already, but the parser's runtime allow-set is ES | DE | TR — assert
    // against the runtime allow-set, not the type.
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).language = 'EN';
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.language/);
  });

  it("rejects unknown spec.cefrLevel ('A0')", () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).cefrLevel = 'A0';
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.cefrLevel/);
  });

  it("rejects unknown spec.cefrLevel ('D1')", () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).cefrLevel = 'D1';
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.cefrLevel/);
  });

  it("rejects unknown spec.exerciseType ('speaking')", () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).exerciseType = 'speaking';
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.exerciseType/);
  });

  it('rejects spec.count = 0 (below min)', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).count = 0;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.count/);
  });

  it('rejects spec.count = 201 (above max)', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).count = 201;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.count/);
  });

  it('rejects non-integer spec.count (1.5)', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).count = 1.5;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.count/);
  });

  it('rejects empty-string spec.batchSeed', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).batchSeed = '';
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.batchSeed/);
  });

  it('rejects spec.batchSeed of length 101', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).batchSeed = 'a'.repeat(101);
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.batchSeed/);
  });

  it('accepts spec.batchSeed of length 100 (boundary)', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).batchSeed = 'a'.repeat(100);
    const parsed = parseGenerationJobMessage(msg);
    expect(parsed.spec.batchSeed.length).toBe(100);
  });

  it('rejects maxCostUsd = 0', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = 0;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });

  it('rejects maxCostUsd = -1', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = -1;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });

  it('rejects maxCostUsd = 100 (exclusive max)', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = 100;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });

  it('rejects maxCostUsd = 101', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = 101;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });

  it('rejects maxCostUsd = NaN', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = NaN;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });

  it('rejects maxCostUsd = Infinity', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = Infinity;
    expect(() => parseGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });

  it('accepts maxCostUsd = 0.5 (within (0, 100))', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = 0.5;
    const parsed = parseGenerationJobMessage(msg);
    expect(parsed.maxCostUsd).toBe(0.5);
  });
});

describe('parseGenerationJobMessage — round-trip and forward-compat', () => {
  it('round-trips a valid round-1 message field-by-field', () => {
    const input = validMessage();
    const parsed = parseGenerationJobMessage(input);
    expect(parsed).toEqual(input);
  });

  it("accepts forward-compat spec.cefrLevel = 'C1' (Phase 6 shape)", () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).cefrLevel = 'C1';
    const parsed = parseGenerationJobMessage(msg);
    expect(parsed.spec.cefrLevel).toBe('C1');
  });

  it("accepts forward-compat spec.cefrLevel = 'C2' (Phase 6 shape)", () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).cefrLevel = 'C2';
    const parsed = parseGenerationJobMessage(msg);
    expect(parsed.spec.cefrLevel).toBe('C2');
  });
});

// ---------------------------------------------------------------------------
// checkAuditRowState
// ---------------------------------------------------------------------------

describe('checkAuditRowState', () => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const fakeDb = { select: mockSelect } as unknown as Db;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns {status:'absent'} when the query returns []", async () => {
    mockLimit.mockResolvedValueOnce([]);

    const result = await checkAuditRowState(fakeDb, 'job-123');

    expect(result).toEqual({ status: 'absent' });
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("returns {status:'in-progress'} when the row is 'running'", async () => {
    mockLimit.mockResolvedValueOnce([{ status: 'running' }]);

    const result = await checkAuditRowState(fakeDb, 'job-123');

    expect(result).toEqual({ status: 'in-progress' });
  });

  it("returns {status:'in-progress'} when the row is 'queued' (forward-compat)", async () => {
    mockLimit.mockResolvedValueOnce([{ status: 'queued' }]);

    const result = await checkAuditRowState(fakeDb, 'job-123');

    expect(result).toEqual({ status: 'in-progress' });
  });

  it("returns {status:'completed', jobStatus:'succeeded'} when the row is 'succeeded'", async () => {
    mockLimit.mockResolvedValueOnce([{ status: 'succeeded' }]);

    const result = await checkAuditRowState(fakeDb, 'job-123');

    expect(result).toEqual({ status: 'completed', jobStatus: 'succeeded' });
  });

  it("returns {status:'completed', jobStatus:'failed'} when the row is 'failed'", async () => {
    mockLimit.mockResolvedValueOnce([{ status: 'failed' }]);

    const result = await checkAuditRowState(fakeDb, 'job-123');

    expect(result).toEqual({ status: 'completed', jobStatus: 'failed' });
  });
});
