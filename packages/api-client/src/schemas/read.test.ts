import { describe, it, expect } from 'vitest';
import {
  CefrLevel,
  Language,
  READ_TEXT_MAX_CHARS,
  READ_TITLE_MAX_CHARS,
  READ_SOURCE_MAX_CHARS,
} from '@language-drill/shared';
import {
  AnnotateDoneEventSchema,
  AnnotateErrorEventSchema,
  AnnotateFlagEventSchema,
  AnnotateMetaEventSchema,
  AnnotateRequestSchema,
  ReadEntriesResponseSchema,
  ReadEntryResponseSchema,
  ReadEntrySummarySchema,
  SaveReadEntryRequestSchema,
  SaveReadEntryResponseSchema,
  UpdateBankRequestSchema,
  UpdateBankResponseSchema,
} from './read';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validUuid = '11111111-1111-1111-1111-111111111111';
const validIso = '2026-05-04T08:00:00.000Z';

const validFlag = {
  lemma: 'aldea',
  pos: 'noun',
  gloss: 'small village',
  example: 'Visitamos la aldea ayer.',
  freq: 4200,
  cefr: CefrLevel.B2,
};

const validFlaggedMap = { aldea: validFlag };

// ---------------------------------------------------------------------------
// AnnotateRequestSchema
// ---------------------------------------------------------------------------

describe('AnnotateRequestSchema', () => {
  it('accepts a valid ES request', () => {
    const result = AnnotateRequestSchema.safeParse({
      text: 'La aldea recibió al pintor.',
      language: Language.ES,
    });
    expect(result.success).toBe(true);
  });

  it('accepts text exactly at READ_TEXT_MAX_CHARS', () => {
    const result = AnnotateRequestSchema.safeParse({
      text: 'a'.repeat(READ_TEXT_MAX_CHARS),
      language: Language.DE,
    });
    expect(result.success).toBe(true);
  });

  it('rejects text > READ_TEXT_MAX_CHARS', () => {
    const result = AnnotateRequestSchema.safeParse({
      text: 'a'.repeat(READ_TEXT_MAX_CHARS + 1),
      language: Language.ES,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty text', () => {
    const result = AnnotateRequestSchema.safeParse({
      text: '',
      language: Language.ES,
    });
    expect(result.success).toBe(false);
  });

  it('rejects language=EN (LearningLanguageEnum is ES/DE/TR)', () => {
    const result = AnnotateRequestSchema.safeParse({
      text: 'hello world',
      language: Language.EN,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognized language', () => {
    const result = AnnotateRequestSchema.safeParse({
      text: 'bonjour',
      language: 'FR',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Annotate streaming events — meta / flag / done / error
// ---------------------------------------------------------------------------

describe('AnnotateMetaEventSchema', () => {
  it('accepts a valid meta event', () => {
    const result = AnnotateMetaEventSchema.safeParse({
      calibration: { cefr: CefrLevel.B1, top: 3000 },
      candidateCount: 12,
    });
    expect(result.success).toBe(true);
  });

  it('accepts candidateCount=0', () => {
    const result = AnnotateMetaEventSchema.safeParse({
      calibration: { cefr: CefrLevel.A2, top: 1500 },
      candidateCount: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a meta event missing candidateCount', () => {
    const result = AnnotateMetaEventSchema.safeParse({
      calibration: { cefr: CefrLevel.B1, top: 3000 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a meta event missing calibration', () => {
    const result = AnnotateMetaEventSchema.safeParse({ candidateCount: 5 });
    expect(result.success).toBe(false);
  });

  it('rejects negative candidateCount', () => {
    const result = AnnotateMetaEventSchema.safeParse({
      calibration: { cefr: CefrLevel.B1, top: 3000 },
      candidateCount: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe('AnnotateFlagEventSchema', () => {
  it('accepts a valid flag event', () => {
    const result = AnnotateFlagEventSchema.safeParse({
      ...validFlag,
      matchedForm: 'aldea',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.matchedForm).toBe('aldea');
      expect(result.data.lemma).toBe('aldea');
    }
  });

  it('rejects a flag event missing matchedForm', () => {
    const result = AnnotateFlagEventSchema.safeParse(validFlag);
    expect(result.success).toBe(false);
  });

  it('rejects an empty matchedForm', () => {
    const result = AnnotateFlagEventSchema.safeParse({
      ...validFlag,
      matchedForm: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a matchedForm longer than 120 chars', () => {
    const result = AnnotateFlagEventSchema.safeParse({
      ...validFlag,
      matchedForm: 'a'.repeat(121),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a flag event missing a required WordFlag field', () => {
    const result = AnnotateFlagEventSchema.safeParse({
      ...validFlag,
      matchedForm: 'aldea',
      lemma: undefined,
    });
    expect(result.success).toBe(false);
  });
});

describe('AnnotateDoneEventSchema', () => {
  it('accepts a valid done event', () => {
    const result = AnnotateDoneEventSchema.safeParse({ flaggedCount: 7 });
    expect(result.success).toBe(true);
  });

  it('accepts flaggedCount=0 (no candidates passed the pre-filter)', () => {
    const result = AnnotateDoneEventSchema.safeParse({ flaggedCount: 0 });
    expect(result.success).toBe(true);
  });

  it('rejects a done event missing flaggedCount', () => {
    const result = AnnotateDoneEventSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects negative flaggedCount', () => {
    const result = AnnotateDoneEventSchema.safeParse({ flaggedCount: -1 });
    expect(result.success).toBe(false);
  });
});

describe('AnnotateErrorEventSchema', () => {
  it.each([
    'AI_UNAVAILABLE',
    'VALIDATION_ERROR',
    'RATE_LIMIT_EXCEEDED',
    'UNSUPPORTED_LANGUAGE',
  ])('accepts each error code: %s', (code) => {
    const result = AnnotateErrorEventSchema.safeParse({
      code,
      message: 'something went wrong',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown code', () => {
    const result = AnnotateErrorEventSchema.safeParse({
      code: 'SOMETHING_ELSE',
      message: 'oops',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an error event missing message', () => {
    const result = AnnotateErrorEventSchema.safeParse({ code: 'AI_UNAVAILABLE' });
    expect(result.success).toBe(false);
  });

  it('rejects an error event missing code', () => {
    const result = AnnotateErrorEventSchema.safeParse({ message: 'oops' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SaveReadEntryRequestSchema
// ---------------------------------------------------------------------------

describe('SaveReadEntryRequestSchema', () => {
  const validBody = {
    language: Language.ES,
    title: 'aldea',
    source: 'El País',
    text: 'La aldea recibió al pintor.',
    flagged: validFlaggedMap,
    bank: ['aldea'],
  };

  it('accepts a valid body', () => {
    const result = SaveReadEntryRequestSchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it('accepts an empty bank (server enforces .min(1) independently per Req 8.1)', () => {
    const result = SaveReadEntryRequestSchema.safeParse({
      ...validBody,
      bank: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects text > READ_TEXT_MAX_CHARS', () => {
    const result = SaveReadEntryRequestSchema.safeParse({
      ...validBody,
      text: 'a'.repeat(READ_TEXT_MAX_CHARS + 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects title > READ_TITLE_MAX_CHARS', () => {
    const result = SaveReadEntryRequestSchema.safeParse({
      ...validBody,
      title: 'a'.repeat(READ_TITLE_MAX_CHARS + 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects source > READ_SOURCE_MAX_CHARS', () => {
    const result = SaveReadEntryRequestSchema.safeParse({
      ...validBody,
      source: 'a'.repeat(READ_SOURCE_MAX_CHARS + 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty bank-word string', () => {
    const result = SaveReadEntryRequestSchema.safeParse({
      ...validBody,
      bank: ['aldea', ''],
    });
    expect(result.success).toBe(false);
  });

  it('rejects language=EN', () => {
    const result = SaveReadEntryRequestSchema.safeParse({
      ...validBody,
      language: Language.EN,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SaveReadEntryResponseSchema
// ---------------------------------------------------------------------------

describe('SaveReadEntryResponseSchema', () => {
  it('accepts a valid response', () => {
    const result = SaveReadEntryResponseSchema.safeParse({
      id: validUuid,
      pastedAt: validIso,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed UUID', () => {
    const result = SaveReadEntryResponseSchema.safeParse({
      id: 'not-a-uuid',
      pastedAt: validIso,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO pastedAt', () => {
    const result = SaveReadEntryResponseSchema.safeParse({
      id: validUuid,
      pastedAt: '2026-05-04 08:00:00',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UpdateBankRequestSchema / UpdateBankResponseSchema
// ---------------------------------------------------------------------------

describe('UpdateBankRequestSchema', () => {
  it('accepts a non-empty bank', () => {
    const result = UpdateBankRequestSchema.safeParse({
      bank: ['aldea', 'indiferencia'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty bank (clear-bank flow per Req 8.8)', () => {
    const result = UpdateBankRequestSchema.safeParse({ bank: [] });
    expect(result.success).toBe(true);
  });

  it('rejects when bank is not an array', () => {
    const result = UpdateBankRequestSchema.safeParse({ bank: 'aldea' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string bank entry', () => {
    const result = UpdateBankRequestSchema.safeParse({ bank: [''] });
    expect(result.success).toBe(false);
  });
});

describe('UpdateBankResponseSchema', () => {
  it('accepts a valid response', () => {
    const result = UpdateBankResponseSchema.safeParse({
      id: validUuid,
      bank: ['aldea'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty bank in the response', () => {
    const result = UpdateBankResponseSchema.safeParse({
      id: validUuid,
      bank: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects when id is not a UUID', () => {
    const result = UpdateBankResponseSchema.safeParse({
      id: 'not-a-uuid',
      bank: [],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ReadEntrySummarySchema / ReadEntriesResponseSchema
// ---------------------------------------------------------------------------

describe('ReadEntrySummarySchema', () => {
  const validSummary = {
    id: validUuid,
    title: 'aldea',
    source: '',
    preview: 'La aldea recibió al pintor.',
    flaggedCount: 5,
    savedCount: 1,
    pastedAt: validIso,
  };

  it('accepts a valid summary row', () => {
    const result = ReadEntrySummarySchema.safeParse(validSummary);
    expect(result.success).toBe(true);
  });

  it('accepts zero counts', () => {
    const result = ReadEntrySummarySchema.safeParse({
      ...validSummary,
      flaggedCount: 0,
      savedCount: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative counts', () => {
    const result = ReadEntrySummarySchema.safeParse({
      ...validSummary,
      flaggedCount: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed UUID', () => {
    const result = ReadEntrySummarySchema.safeParse({
      ...validSummary,
      id: 'no',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer flaggedCount', () => {
    const result = ReadEntrySummarySchema.safeParse({
      ...validSummary,
      flaggedCount: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('ReadEntriesResponseSchema', () => {
  it('accepts an empty entries array', () => {
    const result = ReadEntriesResponseSchema.safeParse({ entries: [] });
    expect(result.success).toBe(true);
  });

  it('accepts a multi-entry response', () => {
    const summary = {
      id: validUuid,
      title: 'aldea',
      source: '',
      preview: 'preview',
      flaggedCount: 0,
      savedCount: 0,
      pastedAt: validIso,
    };
    const result = ReadEntriesResponseSchema.safeParse({
      entries: [summary, summary],
    });
    expect(result.success).toBe(true);
  });

  it('rejects when entries is not an array', () => {
    const result = ReadEntriesResponseSchema.safeParse({ entries: {} });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ReadEntryResponseSchema
// ---------------------------------------------------------------------------

describe('ReadEntryResponseSchema', () => {
  const validEntry = {
    id: validUuid,
    language: Language.ES,
    title: 'aldea',
    source: '',
    text: 'La aldea recibió al pintor.',
    flaggedWords: validFlaggedMap,
    bank: ['aldea'],
    pastedAt: validIso,
  };

  it('accepts a valid full entry', () => {
    const result = ReadEntryResponseSchema.safeParse(validEntry);
    expect(result.success).toBe(true);
  });

  it('accepts an empty bank in the full entry shape', () => {
    const result = ReadEntryResponseSchema.safeParse({
      ...validEntry,
      bank: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects language=EN', () => {
    const result = ReadEntryResponseSchema.safeParse({
      ...validEntry,
      language: Language.EN,
    });
    expect(result.success).toBe(false);
  });

  it('rejects flaggedWords entries missing a required WordFlag field', () => {
    const result = ReadEntryResponseSchema.safeParse({
      ...validEntry,
      flaggedWords: { aldea: { ...validFlag, freq: 'rare' } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed UUID', () => {
    const result = ReadEntryResponseSchema.safeParse({
      ...validEntry,
      id: 'no-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO pastedAt', () => {
    const result = ReadEntryResponseSchema.safeParse({
      ...validEntry,
      pastedAt: 'yesterday',
    });
    expect(result.success).toBe(false);
  });
});
