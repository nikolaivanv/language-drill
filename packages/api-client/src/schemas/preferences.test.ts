import { describe, it, expect } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';
import { UpdateLanguagesInputSchema, UpdatePreferencesInputSchema } from './preferences';

// ---------------------------------------------------------------------------
// UpdateLanguagesInputSchema
// ---------------------------------------------------------------------------

describe('UpdateLanguagesInputSchema', () => {
  const validPayload = {
    profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
    primaryLanguage: Language.ES,
  };

  it('accepts a valid single-profile ES B2 payload', () => {
    const result = UpdateLanguagesInputSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects primaryLanguage not present in profiles', () => {
    const result = UpdateLanguagesInputSchema.safeParse({
      profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
      primaryLanguage: Language.DE,
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate languages', () => {
    const result = UpdateLanguagesInputSchema.safeParse({
      profiles: [
        { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
        { language: Language.ES, proficiencyLevel: CefrLevel.A1 },
      ],
      primaryLanguage: Language.ES,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === 'Duplicate languages are not allowed')).toBe(true);
    }
  });

  it('rejects EN in profiles', () => {
    const result = UpdateLanguagesInputSchema.safeParse({
      profiles: [{ language: Language.EN, proficiencyLevel: CefrLevel.B2 }],
      primaryLanguage: Language.EN,
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 3 profiles', () => {
    const result = UpdateLanguagesInputSchema.safeParse({
      profiles: [
        { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
        { language: Language.DE, proficiencyLevel: CefrLevel.A1 },
        { language: Language.TR, proficiencyLevel: CefrLevel.A1 },
        { language: Language.ES, proficiencyLevel: CefrLevel.B1 },
      ],
      primaryLanguage: Language.ES,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty profiles array', () => {
    const result = UpdateLanguagesInputSchema.safeParse({
      profiles: [],
      primaryLanguage: Language.ES,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UpdatePreferencesInputSchema
// ---------------------------------------------------------------------------

describe('UpdatePreferencesInputSchema', () => {
  it('accepts a single-field partial update', () => {
    const result = UpdatePreferencesInputSchema.safeParse({ dailyMinutes: 20 });
    expect(result.success).toBe(true);
  });

  it('rejects an empty object', () => {
    const result = UpdatePreferencesInputSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === 'At least one field must be provided')).toBe(true);
    }
  });

  it('rejects an invalid dailyMinutes value', () => {
    const result = UpdatePreferencesInputSchema.safeParse({ dailyMinutes: 7 });
    expect(result.success).toBe(false);
  });
});
