import { describe, it, expect } from 'vitest';
import {
  CefrLevel,
  Language,
  READ_TEXT_MAX_CHARS,
  READ_TITLE_MAX_CHARS,
  READ_SOURCE_MAX_CHARS,
} from '@language-drill/shared';
import {
  AnnotateRequestSchema,
  AnnotateResponseSchema,
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
// AnnotateResponseSchema
// ---------------------------------------------------------------------------

describe('AnnotateResponseSchema', () => {
  it('accepts a valid response', () => {
    const result = AnnotateResponseSchema.safeParse({
      flagged: validFlaggedMap,
      calibration: { cefr: CefrLevel.B1, top: 3000 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flagged.aldea.lemma).toBe('aldea');
      expect(result.data.calibration.top).toBe(3000);
    }
  });

  it('accepts an empty flagged map (in-level passage)', () => {
    const result = AnnotateResponseSchema.safeParse({
      flagged: {},
      calibration: { cefr: CefrLevel.B2, top: 5000 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when calibration.cefr is missing', () => {
    const result = AnnotateResponseSchema.safeParse({
      flagged: validFlaggedMap,
      calibration: { top: 3000 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when calibration.top is negative', () => {
    const result = AnnotateResponseSchema.safeParse({
      flagged: {},
      calibration: { cefr: CefrLevel.B1, top: -5 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects flag entries missing a required WordFlag field', () => {
    const result = AnnotateResponseSchema.safeParse({
      flagged: { aldea: { ...validFlag, lemma: undefined } },
      calibration: { cefr: CefrLevel.B1, top: 3000 },
    });
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
