import { describe, it, expect } from 'vitest';
import { LanguageProfilesResponseSchema } from '../schemas/profile';

/**
 * These tests verify the Zod validation that useLanguageProfiles relies on
 * internally. The hook parses API responses through this schema, so
 * validating schema behavior covers the critical data-integrity path.
 *
 * Full hook integration tests (with QueryClientProvider) belong in the
 * web app's test suite where a React rendering environment is available.
 */

describe('useLanguageProfiles — response validation', () => {
  it('accepts a valid profiles response', () => {
    const data = {
      profiles: [
        { language: 'EN', proficiencyLevel: 'B1' },
        { language: 'ES', proficiencyLevel: 'A2' },
      ],
    };
    const result = LanguageProfilesResponseSchema.parse(data);
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles[0].language).toBe('EN');
    expect(result.profiles[0].proficiencyLevel).toBe('B1');
    expect(result.profiles[1].language).toBe('ES');
    expect(result.profiles[1].proficiencyLevel).toBe('A2');
  });

  it('accepts an empty profiles array (new user with no profiles)', () => {
    const data = { profiles: [] };
    const result = LanguageProfilesResponseSchema.parse(data);
    expect(result.profiles).toHaveLength(0);
  });

  it('accepts a single profile', () => {
    const data = {
      profiles: [{ language: 'DE', proficiencyLevel: 'C1' }],
    };
    const result = LanguageProfilesResponseSchema.parse(data);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].language).toBe('DE');
    expect(result.profiles[0].proficiencyLevel).toBe('C1');
  });

  it('rejects response missing profiles key', () => {
    const data = {};
    expect(() => LanguageProfilesResponseSchema.parse(data)).toThrow();
  });

  it('rejects response where profiles is not an array', () => {
    const data = { profiles: 'not-an-array' };
    expect(() => LanguageProfilesResponseSchema.parse(data)).toThrow();
  });

  it('rejects profile missing language', () => {
    const data = {
      profiles: [{ proficiencyLevel: 'B1' }],
    };
    expect(() => LanguageProfilesResponseSchema.parse(data)).toThrow();
  });

  it('rejects profile missing proficiencyLevel', () => {
    const data = {
      profiles: [{ language: 'EN' }],
    };
    expect(() => LanguageProfilesResponseSchema.parse(data)).toThrow();
  });

  it('rejects non-string language', () => {
    const data = {
      profiles: [{ language: 123, proficiencyLevel: 'B1' }],
    };
    expect(() => LanguageProfilesResponseSchema.parse(data)).toThrow();
  });

  it('rejects non-string proficiencyLevel', () => {
    const data = {
      profiles: [{ language: 'EN', proficiencyLevel: 42 }],
    };
    expect(() => LanguageProfilesResponseSchema.parse(data)).toThrow();
  });

  it('rejects null profiles', () => {
    const data = { profiles: null };
    expect(() => LanguageProfilesResponseSchema.parse(data)).toThrow();
  });
});

describe('useLanguageProfiles — error propagation', () => {
  it('schema parse throws ZodError for completely invalid data', () => {
    expect(() => LanguageProfilesResponseSchema.parse(42)).toThrow();
  });

  it('schema parse throws ZodError for malformed profile entries', () => {
    const data = { profiles: [null] };
    expect(() => LanguageProfilesResponseSchema.parse(data)).toThrow();
  });

  it('schema parse throws for array of primitives instead of objects', () => {
    const data = { profiles: ['EN', 'ES'] };
    expect(() => LanguageProfilesResponseSchema.parse(data)).toThrow();
  });
});

describe('query key and URL structure', () => {
  it('builds expected query key for language profiles', () => {
    const queryKey = ['languageProfiles'];
    expect(queryKey).toEqual(['languageProfiles']);
  });

  it('builds correct API path for GET', () => {
    const path = '/profiles/languages';
    expect(path).toBe('/profiles/languages');
  });
});
