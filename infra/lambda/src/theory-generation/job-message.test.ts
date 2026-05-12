import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CefrLevel,
  Language,
  type LearningLanguage,
} from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Mock @language-drill/db before importing the module under test. Only the
// `theoryGenerationJobs` table object's `id` and `status` columns are
// referenced by `checkTheoryAuditRowState`; `Db` and `CurriculumCefrLevel` are
// type-only re-exports so no runtime stubs are needed. Pattern mirrors
// infra/lambda/src/generation/job-message.test.ts.
// ---------------------------------------------------------------------------

vi.mock('@language-drill/db', () => ({
  theoryGenerationJobs: { id: 'id', status: 'status' },
}));

import {
  parseTheoryGenerationJobMessage,
  checkTheoryAuditRowState,
  type TheoryGenerationJobMessage,
} from './job-message';
import type { CurriculumCefrLevel, Db } from '@language-drill/db';

// ---------------------------------------------------------------------------
// Test fixture factory: a known-good message each test derives from.
// ---------------------------------------------------------------------------

function validMessage(): TheoryGenerationJobMessage {
  return {
    jobId: 'job-123',
    trigger: 'cli',
    spec: {
      language: Language.ES as LearningLanguage,
      cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
      grammarPointKey: 'es-b1-present-subjunctive',
      batchSeed: 'phase-4-test',
    },
    maxCostUsd: 0.25,
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

describe('parseTheoryGenerationJobMessage — top-level shape', () => {
  it('throws when input is null', () => {
    expect(() => parseTheoryGenerationJobMessage(null)).toThrow(
      /TheoryGenerationJobMessage: expected object, got null/,
    );
  });

  it('throws when input is an array', () => {
    expect(() => parseTheoryGenerationJobMessage([])).toThrow(
      /TheoryGenerationJobMessage: expected object, got array/,
    );
  });

  it('throws when input is a number', () => {
    expect(() => parseTheoryGenerationJobMessage(42)).toThrow(
      /TheoryGenerationJobMessage: expected object, got number/,
    );
  });

  it('throws when input is a string', () => {
    expect(() => parseTheoryGenerationJobMessage('not an object')).toThrow(
      /TheoryGenerationJobMessage: expected object, got string/,
    );
  });
});

describe('parseTheoryGenerationJobMessage — missing required fields', () => {
  it('throws when jobId is missing', () => {
    const msg = cloneAsRecord();
    delete msg.jobId;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/jobId/);
  });

  it('throws when trigger is missing', () => {
    const msg = cloneAsRecord();
    delete msg.trigger;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/trigger/);
  });

  it('throws when spec is missing', () => {
    const msg = cloneAsRecord();
    delete msg.spec;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/spec/);
  });

  it('throws when spec.language is missing', () => {
    const msg = cloneAsRecord();
    delete (msg.spec as Record<string, unknown>).language;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/spec\.language/);
  });

  it('throws when spec.cefrLevel is missing', () => {
    const msg = cloneAsRecord();
    delete (msg.spec as Record<string, unknown>).cefrLevel;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/spec\.cefrLevel/);
  });

  it('throws when spec.grammarPointKey is missing', () => {
    const msg = cloneAsRecord();
    delete (msg.spec as Record<string, unknown>).grammarPointKey;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(
      /spec\.grammarPointKey/,
    );
  });

  it('throws when spec.batchSeed is missing', () => {
    const msg = cloneAsRecord();
    delete (msg.spec as Record<string, unknown>).batchSeed;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/spec\.batchSeed/);
  });

  it('throws when maxCostUsd is missing', () => {
    const msg = cloneAsRecord();
    delete msg.maxCostUsd;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });
});

describe('parseTheoryGenerationJobMessage — wrong types per field', () => {
  it('throws when jobId is a number', () => {
    const msg = cloneAsRecord();
    msg.jobId = 123;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/jobId/);
  });

  it('throws when trigger is a boolean', () => {
    const msg = cloneAsRecord();
    msg.trigger = true;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/trigger/);
  });

  it('throws when spec is a string', () => {
    const msg = cloneAsRecord();
    msg.spec = 'not-an-object';
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/spec/);
  });

  it('throws when maxCostUsd is a string', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = '0.25';
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });
});

describe('parseTheoryGenerationJobMessage — value constraints', () => {
  it('rejects empty-string jobId', () => {
    const msg = cloneAsRecord();
    msg.jobId = '';
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/jobId/);
  });

  it('rejects unknown trigger value', () => {
    const msg = cloneAsRecord();
    msg.trigger = 'foo';
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/trigger/);
  });

  it("rejects unknown spec.language (e.g. 'FR')", () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).language = 'FR';
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/spec\.language/);
  });

  it("rejects spec.language === 'EN' (theory is L2-only)", () => {
    // The shared LearningLanguage type is `Exclude<Language, Language.EN>`
    // already, but the parser's runtime allow-set is ES | DE | TR — assert
    // against the runtime allow-set, not the type.
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).language = 'EN';
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/spec\.language/);
  });

  it("rejects unknown spec.cefrLevel ('A0')", () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).cefrLevel = 'A0';
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/spec\.cefrLevel/);
  });

  it("rejects unknown spec.cefrLevel ('D1')", () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).cefrLevel = 'D1';
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/spec\.cefrLevel/);
  });

  it('rejects empty-string spec.grammarPointKey', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).grammarPointKey = '';
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(
      /spec\.grammarPointKey/,
    );
  });

  it('rejects empty-string spec.batchSeed', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).batchSeed = '';
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/spec\.batchSeed/);
  });

  it('rejects spec.batchSeed of length 101', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).batchSeed = 'a'.repeat(101);
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/spec\.batchSeed/);
  });

  it('accepts spec.batchSeed of length 100 (boundary)', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).batchSeed = 'a'.repeat(100);
    const parsed = parseTheoryGenerationJobMessage(msg);
    expect(parsed.spec.batchSeed.length).toBe(100);
  });

  it('rejects maxCostUsd = 0', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = 0;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });

  it('rejects maxCostUsd = -1', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = -1;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });

  it('rejects maxCostUsd = 100 (exclusive max)', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = 100;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });

  it('rejects maxCostUsd = 101', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = 101;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });

  it('rejects maxCostUsd = NaN', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = NaN;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });

  it('rejects maxCostUsd = Infinity', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = Infinity;
    expect(() => parseTheoryGenerationJobMessage(msg)).toThrow(/maxCostUsd/);
  });

  it('accepts maxCostUsd = 0.25 (within (0, 100))', () => {
    const msg = cloneAsRecord();
    msg.maxCostUsd = 0.25;
    const parsed = parseTheoryGenerationJobMessage(msg);
    expect(parsed.maxCostUsd).toBe(0.25);
  });
});

describe('parseTheoryGenerationJobMessage — round-trip and forward-compat', () => {
  it('round-trips a valid ES round-1 message field-by-field', () => {
    const input = validMessage();
    const parsed = parseTheoryGenerationJobMessage(input);
    expect(parsed).toEqual(input);
  });

  it('round-trips a valid DE message', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).language = Language.DE;
    (msg.spec as Record<string, unknown>).grammarPointKey =
      'de-b1-passive-voice';
    const parsed = parseTheoryGenerationJobMessage(msg);
    expect(parsed.spec.language).toBe(Language.DE);
    expect(parsed.spec.grammarPointKey).toBe('de-b1-passive-voice');
  });

  it('round-trips a valid TR message', () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).language = Language.TR;
    (msg.spec as Record<string, unknown>).grammarPointKey =
      'tr-b1-evidential-mishli';
    const parsed = parseTheoryGenerationJobMessage(msg);
    expect(parsed.spec.language).toBe(Language.TR);
    expect(parsed.spec.grammarPointKey).toBe('tr-b1-evidential-mishli');
  });

  it("accepts forward-compat spec.cefrLevel = 'C1' (Phase 6 shape)", () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).cefrLevel = 'C1';
    const parsed = parseTheoryGenerationJobMessage(msg);
    expect(parsed.spec.cefrLevel).toBe('C1');
  });

  it("accepts forward-compat spec.cefrLevel = 'C2' (Phase 6 shape)", () => {
    const msg = cloneAsRecord();
    (msg.spec as Record<string, unknown>).cefrLevel = 'C2';
    const parsed = parseTheoryGenerationJobMessage(msg);
    expect(parsed.spec.cefrLevel).toBe('C2');
  });
});

// ---------------------------------------------------------------------------
// checkTheoryAuditRowState
// ---------------------------------------------------------------------------

describe('checkTheoryAuditRowState', () => {
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

    const result = await checkTheoryAuditRowState(fakeDb, 'job-123');

    expect(result).toEqual({ status: 'absent' });
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("returns {status:'in-progress'} when the row is 'running'", async () => {
    mockLimit.mockResolvedValueOnce([{ status: 'running' }]);

    const result = await checkTheoryAuditRowState(fakeDb, 'job-123');

    expect(result).toEqual({ status: 'in-progress' });
  });

  it("returns {status:'in-progress'} when the row is 'queued' (forward-compat)", async () => {
    mockLimit.mockResolvedValueOnce([{ status: 'queued' }]);

    const result = await checkTheoryAuditRowState(fakeDb, 'job-123');

    expect(result).toEqual({ status: 'in-progress' });
  });

  it("returns {status:'completed', jobStatus:'succeeded'} when the row is 'succeeded'", async () => {
    mockLimit.mockResolvedValueOnce([{ status: 'succeeded' }]);

    const result = await checkTheoryAuditRowState(fakeDb, 'job-123');

    expect(result).toEqual({ status: 'completed', jobStatus: 'succeeded' });
  });

  it("returns {status:'completed', jobStatus:'failed'} when the row is 'failed'", async () => {
    mockLimit.mockResolvedValueOnce([{ status: 'failed' }]);

    const result = await checkTheoryAuditRowState(fakeDb, 'job-123');

    expect(result).toEqual({ status: 'completed', jobStatus: 'failed' });
  });

  it("returns {status:'in-progress'} for an unknown-future-value status", async () => {
    mockLimit.mockResolvedValueOnce([{ status: 'unknown-future-value' }]);

    const result = await checkTheoryAuditRowState(fakeDb, 'job-123');

    expect(result).toEqual({ status: 'in-progress' });
  });
});
