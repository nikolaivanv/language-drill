import { describe, it, expect } from 'vitest';
import {
  CefrLevel,
  DAILY_MINUTES,
  GOAL_IDS,
  Language,
  NOTES_MAX_LENGTH,
} from '@language-drill/shared';
import { SavePreferencesInputSchema } from './preferences';

// Build a valid baseline payload that the table-driven cases below can mutate.
// Keeping a single canonical shape makes each rejection case a focused diff.
const validPayload = {
  profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
  primaryLanguage: Language.ES,
  goals: ['grammar' as const],
  dailyMinutes: 10 as const,
  gentleNudges: true,
  notes: '',
};

describe('SavePreferencesInputSchema', () => {
  describe('accepts valid payloads', () => {
    it('parses the canonical single-profile ES B2 shape', () => {
      const result = SavePreferencesInputSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it('parses a multi-profile payload with primaryLanguage in the set', () => {
      const data = {
        ...validPayload,
        profiles: [
          { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
          { language: Language.DE, proficiencyLevel: CefrLevel.A1 },
          { language: Language.TR, proficiencyLevel: CefrLevel.A1 },
        ],
        primaryLanguage: Language.DE,
      };
      const result = SavePreferencesInputSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    // Iterate the canonical goal-id list rather than hardcoding it so that a
    // future addition to GOAL_IDS automatically extends this coverage.
    for (const goal of GOAL_IDS) {
      it(`accepts goal id "${goal}"`, () => {
        const result = SavePreferencesInputSchema.safeParse({
          ...validPayload,
          goals: [goal],
        });
        expect(result.success).toBe(true);
      });
    }

    it('accepts the full goals array (every canonical id at once)', () => {
      const result = SavePreferencesInputSchema.safeParse({
        ...validPayload,
        goals: [...GOAL_IDS],
      });
      expect(result.success).toBe(true);
    });

    // Same iteration pattern for the daily-minutes literal union.
    for (const minutes of DAILY_MINUTES) {
      it(`accepts dailyMinutes value ${minutes}`, () => {
        const result = SavePreferencesInputSchema.safeParse({
          ...validPayload,
          dailyMinutes: minutes,
        });
        expect(result.success).toBe(true);
      });
    }

    it('accepts notes at exactly the max length', () => {
      const result = SavePreferencesInputSchema.safeParse({
        ...validPayload,
        notes: 'a'.repeat(NOTES_MAX_LENGTH),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('rejects invalid payloads', () => {
    it('rejects EN as a profile language', () => {
      const result = SavePreferencesInputSchema.safeParse({
        ...validPayload,
        profiles: [
          { language: Language.EN, proficiencyLevel: CefrLevel.B2 },
        ],
        primaryLanguage: Language.ES,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) =>
          i.path.length >= 3 &&
          i.path[0] === 'profiles' &&
          i.path[1] === 0 &&
          i.path[2] === 'language',
        )).toBe(true);
      }
    });

    it('rejects EN as primaryLanguage', () => {
      const result = SavePreferencesInputSchema.safeParse({
        ...validPayload,
        primaryLanguage: Language.EN,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(
          (i) => i.path.length === 1 && i.path[0] === 'primaryLanguage',
        )).toBe(true);
      }
    });

    it('rejects a 4-profile array (max 3)', () => {
      const result = SavePreferencesInputSchema.safeParse({
        ...validPayload,
        profiles: [
          { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
          { language: Language.DE, proficiencyLevel: CefrLevel.A1 },
          { language: Language.TR, proficiencyLevel: CefrLevel.A1 },
          { language: Language.ES, proficiencyLevel: CefrLevel.A1 },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(
          (i) => i.path.length === 1 && i.path[0] === 'profiles',
        )).toBe(true);
      }
    });

    it('rejects an empty profiles array', () => {
      const result = SavePreferencesInputSchema.safeParse({
        ...validPayload,
        profiles: [],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(
          (i) => i.path.length === 1 && i.path[0] === 'profiles',
        )).toBe(true);
      }
    });

    it('rejects an unknown goal id', () => {
      const result = SavePreferencesInputSchema.safeParse({
        ...validPayload,
        goals: ['cooking'],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(
          (i) =>
            i.path.length >= 2 && i.path[0] === 'goals' && i.path[1] === 0,
        )).toBe(true);
      }
    });

    it('rejects notes longer than the max length', () => {
      const result = SavePreferencesInputSchema.safeParse({
        ...validPayload,
        notes: 'a'.repeat(NOTES_MAX_LENGTH + 1),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(
          (i) => i.path.length === 1 && i.path[0] === 'notes',
        )).toBe(true);
      }
    });

    it('rejects primaryLanguage not present in profiles[]', () => {
      const result = SavePreferencesInputSchema.safeParse({
        ...validPayload,
        profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
        primaryLanguage: Language.DE,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        // Cross-field refinement reports its issue at the primaryLanguage path
        // (see the schema's `.refine({ path: ['primaryLanguage'] })`).
        expect(result.error.issues.some(
          (i) => i.path.length === 1 && i.path[0] === 'primaryLanguage',
        )).toBe(true);
      }
    });

    it('rejects dailyMinutes not in {5,10,20,30}', () => {
      const result = SavePreferencesInputSchema.safeParse({
        ...validPayload,
        dailyMinutes: 15,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(
          (i) => i.path.length === 1 && i.path[0] === 'dailyMinutes',
        )).toBe(true);
      }
    });
  });
});
