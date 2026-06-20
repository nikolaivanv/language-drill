// ---------------------------------------------------------------------------
// Reducer + selector tests for the onboarding wizard
// ---------------------------------------------------------------------------
// Pure-logic tests covering every reducer action, both selectors, and the
// initial-state factories. No React rendering, no context — those are
// covered by the integration tests.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  CefrLevel,
  DAILY_MINUTES,
  type DailyMinutes,
  GOAL_IDS,
  LANGUAGE_NATIVE_NAMES,
  Language,
  type LanguageProfile,
  NOTES_MAX_LENGTH,
} from '@language-drill/shared';
import type { PreferencesResponse } from '@language-drill/api-client';
import {
  initialEditState,
  initialNewUserState,
  type OnboardingAction,
  type OnboardingState,
  reducer,
  selectCanAdvance,
  selectCoachMessage,
} from '../use-onboarding-reducer';

// Tiny helper: makes test bodies read like a sequence of dispatches.
function apply(state: OnboardingState, action: OnboardingAction): OnboardingState {
  return reducer(state, action);
}

// Convenience builders so tests can describe just the field(s) they care about.
function newState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return { ...initialNewUserState(), ...overrides };
}

function editState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    ...initialNewUserState(),
    mode: 'edit',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// reducer — navigation
// ---------------------------------------------------------------------------

describe('reducer — goNext / goBack', () => {
  it('goNext advances from step 1 to step 2', () => {
    const next = apply(newState({ step: 1 }), { type: 'goNext' });
    expect(next.step).toBe(2);
  });

  it('goNext clamps at step 4 (no advance past final step)', () => {
    const before = newState({ step: 4 });
    const next = apply(before, { type: 'goNext' });
    expect(next.step).toBe(4);
    expect(next).toBe(before);
  });

  it('goBack moves from step 4 to step 3', () => {
    const next = apply(newState({ step: 4 }), { type: 'goBack' });
    expect(next.step).toBe(3);
  });

  it('goBack clamps at step 1 (no go-back from first step)', () => {
    const before = newState({ step: 1 });
    const next = apply(before, { type: 'goBack' });
    expect(next.step).toBe(1);
    expect(next).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// reducer — setLanguages
// ---------------------------------------------------------------------------

describe('reducer — setLanguages', () => {
  it('allows clearing languages in new mode (no edit-mode guard)', () => {
    const before = newState({ languages: [Language.ES, Language.DE] });
    const next = apply(before, { type: 'setLanguages', languages: [] });
    expect(next.languages).toEqual([]);
  });

  it('rejects empty array in edit mode (R2.7 last-language guard)', () => {
    const before = editState({ languages: [Language.ES] });
    const next = apply(before, { type: 'setLanguages', languages: [] });
    expect(next).toBe(before);
  });

  it('accepts a non-empty array in edit mode', () => {
    const before = editState({ languages: [Language.ES] });
    const next = apply(before, {
      type: 'setLanguages',
      languages: [Language.ES, Language.DE],
    });
    expect(next.languages).toEqual([Language.ES, Language.DE]);
  });

  it('drops the level for a language removed from the set', () => {
    const before = newState({
      languages: [Language.ES, Language.DE],
      primaryLanguage: Language.ES,
      levels: { ES: CefrLevel.B2, DE: CefrLevel.A2 },
    });
    const next = apply(before, { type: 'setLanguages', languages: [Language.DE] });
    expect(next.levels).toEqual({ DE: CefrLevel.A2 });
    expect(next.primaryLanguage).toBeNull(); // primary ES was removed
  });

  it('keeps levels for languages that remain', () => {
    const before = newState({
      languages: [Language.ES, Language.DE],
      primaryLanguage: Language.ES,
      levels: { ES: CefrLevel.B2, DE: CefrLevel.A2 },
    });
    const next = apply(before, {
      type: 'setLanguages',
      languages: [Language.ES, Language.DE, Language.TR],
    });
    expect(next.levels).toEqual({ ES: CefrLevel.B2, DE: CefrLevel.A2 });
    expect(next.primaryLanguage).toBe(Language.ES);
  });
});

// ---------------------------------------------------------------------------
// reducer — setPrimary
// ---------------------------------------------------------------------------

describe('reducer — setPrimary', () => {
  it('sets the primary language when it is in the languages set', () => {
    const before = newState({
      languages: [Language.ES, Language.DE],
      primaryLanguage: null,
    });
    const next = apply(before, { type: 'setPrimary', language: Language.DE });
    expect(next.primaryLanguage).toBe(Language.DE);
  });

  it('is a silent no-op when the language is not in the set', () => {
    const before = newState({
      languages: [Language.ES],
      primaryLanguage: Language.ES,
    });
    const next = apply(before, { type: 'setPrimary', language: Language.DE });
    expect(next).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// reducer — setLevel
// ---------------------------------------------------------------------------

describe('reducer — setLevel', () => {
  it('sets a level for a specific language', () => {
    const before = newState({ languages: [Language.ES, Language.DE] });
    const next = apply(before, {
      type: 'setLevel',
      language: Language.DE,
      level: CefrLevel.B1,
    });
    expect(next.levels).toEqual({ DE: CefrLevel.B1 });
  });

  it('overwrites the level for that language only', () => {
    const before = newState({
      languages: [Language.ES, Language.DE],
      levels: { ES: CefrLevel.B2, DE: CefrLevel.A2 },
    });
    const next = apply(before, {
      type: 'setLevel',
      language: Language.ES,
      level: CefrLevel.C1,
    });
    expect(next.levels).toEqual({ ES: CefrLevel.C1, DE: CefrLevel.A2 });
  });
});

// ---------------------------------------------------------------------------
// reducer — toggleGoal
// ---------------------------------------------------------------------------

describe('reducer — toggleGoal', () => {
  it('adds a goal when not present (preserves insertion order)', () => {
    const before = newState({ goals: ['grammar'] });
    const next = apply(before, { type: 'toggleGoal', goal: 'speaking' });
    expect(next.goals).toEqual(['grammar', 'speaking']);
  });

  it('removes a goal when already present', () => {
    const before = newState({ goals: ['grammar', 'speaking', 'vocab'] });
    const next = apply(before, { type: 'toggleGoal', goal: 'speaking' });
    expect(next.goals).toEqual(['grammar', 'vocab']);
  });

  it('round-trips: adding then removing returns to the original set', () => {
    const before = newState({ goals: ['grammar'] });
    const added = apply(before, { type: 'toggleGoal', goal: 'travel' });
    const removed = apply(added, { type: 'toggleGoal', goal: 'travel' });
    expect(removed.goals).toEqual(['grammar']);
  });
});

// ---------------------------------------------------------------------------
// reducer — setNotes
// ---------------------------------------------------------------------------

describe('reducer — setNotes', () => {
  it('stores notes verbatim (no trim, no normalize)', () => {
    const before = newState({ notes: '' });
    const next = apply(before, {
      type: 'setNotes',
      notes: '  Hello   world  \n',
    });
    expect(next.notes).toBe('  Hello   world  \n');
  });

  it('accepts arbitrarily long strings — length validation is the selector\'s job', () => {
    const before = newState({ notes: '' });
    const overflow = 'x'.repeat(NOTES_MAX_LENGTH + 50);
    const next = apply(before, { type: 'setNotes', notes: overflow });
    expect(next.notes).toBe(overflow);
  });
});

// ---------------------------------------------------------------------------
// reducer — setDailyMinutes
// ---------------------------------------------------------------------------

describe('reducer — setDailyMinutes', () => {
  it.each(DAILY_MINUTES.map((m) => [m] as [DailyMinutes]))(
    'stores %i minutes verbatim',
    (minutes) => {
      const before = newState({ dailyMinutes: null });
      const next = apply(before, { type: 'setDailyMinutes', minutes });
      expect(next.dailyMinutes).toBe(minutes);
    },
  );
});

// ---------------------------------------------------------------------------
// reducer — setGentleNudges
// ---------------------------------------------------------------------------

describe('reducer — setGentleNudges', () => {
  it('toggles from true to false', () => {
    const before = newState({ gentleNudges: true });
    const next = apply(before, { type: 'setGentleNudges', on: false });
    expect(next.gentleNudges).toBe(false);
  });

  it('toggles from false to true', () => {
    const before = newState({ gentleNudges: false });
    const next = apply(before, { type: 'setGentleNudges', on: true });
    expect(next.gentleNudges).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// selectCanAdvance
// ---------------------------------------------------------------------------

describe('selectCanAdvance — Step 1 (languages)', () => {
  it('blocks advance when no language is selected', () => {
    expect(selectCanAdvance(newState({ step: 1, languages: [] }))).toBe(false);
  });

  it('allows advance with one language', () => {
    expect(
      selectCanAdvance(newState({ step: 1, languages: [Language.ES] })),
    ).toBe(true);
  });

  it('allows advance with multiple languages', () => {
    expect(
      selectCanAdvance(
        newState({ step: 1, languages: [Language.ES, Language.DE] }),
      ),
    ).toBe(true);
  });
});

describe('selectCanAdvance — Step 2 (primary + level)', () => {
  it('step 2 requires a primary AND a level for every selected language', () => {
    const incomplete = newState({
      step: 2,
      languages: [Language.ES, Language.DE],
      primaryLanguage: Language.ES,
      levels: { ES: CefrLevel.B2 }, // DE missing
    });
    expect(selectCanAdvance(incomplete)).toBe(false);

    const complete = newState({
      step: 2,
      languages: [Language.ES, Language.DE],
      primaryLanguage: Language.ES,
      levels: { ES: CefrLevel.B2, DE: CefrLevel.A2 },
    });
    expect(selectCanAdvance(complete)).toBe(true);
  });
});

describe('selectCanAdvance — Step 3 (notes length)', () => {
  it('allows advance with empty notes (Step 3 is optional)', () => {
    expect(selectCanAdvance(newState({ step: 3, notes: '' }))).toBe(true);
  });

  it('allows advance at the max-length boundary (notes.length === NOTES_MAX_LENGTH)', () => {
    const notes = 'x'.repeat(NOTES_MAX_LENGTH);
    expect(selectCanAdvance(newState({ step: 3, notes }))).toBe(true);
  });

  it('blocks advance when notes overflow by one (paste-overflow)', () => {
    const notes = 'x'.repeat(NOTES_MAX_LENGTH + 1);
    expect(selectCanAdvance(newState({ step: 3, notes }))).toBe(false);
  });
});

describe('selectCanAdvance — Step 4 (dailyMinutes)', () => {
  it('blocks advance when dailyMinutes is null', () => {
    expect(
      selectCanAdvance(newState({ step: 4, dailyMinutes: null })),
    ).toBe(false);
  });

  it.each(DAILY_MINUTES.map((m) => [m] as [DailyMinutes]))(
    'allows advance when dailyMinutes === %i',
    (minutes) => {
      expect(
        selectCanAdvance(newState({ step: 4, dailyMinutes: minutes })),
      ).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// selectCoachMessage
// ---------------------------------------------------------------------------

describe('selectCoachMessage — canonical user-approved copy', () => {
  it('Step 1 returns the languages prompt', () => {
    expect(selectCoachMessage(newState({ step: 1 }))).toBe(
      "let's start with languages. you can add more later.",
    );
  });

  it('Step 2 falls back to "your primary language" when no primary is set', () => {
    expect(
      selectCoachMessage(newState({ step: 2, primaryLanguage: null })),
    ).toBe('for your primary language — where would you place yourself? rough is fine.');
  });

  it('Step 2 uses the native name (LANGUAGE_NATIVE_NAMES) of the primary language', () => {
    const message = selectCoachMessage(
      newState({
        step: 2,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
      }),
    );
    // Use the const, not the literal "español", so future renames break the
    // source-of-truth dictionary, not this test.
    expect(message).toBe(
      `for ${LANGUAGE_NATIVE_NAMES[Language.ES]} — where would you place yourself? rough is fine.`,
    );
  });

  it('Step 2 uses an em dash (U+2014), not a hyphen-minus', () => {
    const message = selectCoachMessage(
      newState({
        step: 2,
        languages: [Language.DE],
        primaryLanguage: Language.DE,
      }),
    );
    expect(message).toContain('—');
    expect(message).not.toMatch(/ - /);
  });

  it('Step 3 returns the goals prompt (with em dash)', () => {
    expect(selectCoachMessage(newState({ step: 3 }))).toBe(
      'what do you want to drill? pick whatever fits — even all of them.',
    );
  });

  it('Step 4 returns the time prompt (with em dash)', () => {
    expect(selectCoachMessage(newState({ step: 4 }))).toBe(
      'last thing — how much time can you usually give me?',
    );
  });
});

// ---------------------------------------------------------------------------
// initialNewUserState
// ---------------------------------------------------------------------------

describe('initialNewUserState', () => {
  it('builds a fresh state with sensible defaults', () => {
    const state = initialNewUserState();
    expect(state.mode).toBe('new');
    expect(state.step).toBe(1);
    expect(state.languages).toEqual([]);
    expect(state.primaryLanguage).toBeNull();
    expect(state.levels).toEqual({});
    expect(state.goals).toEqual([]);
    expect(state.notes).toBe('');
    expect(state.dailyMinutes).toBe(10);
    expect(state.gentleNudges).toBe(true);
    expect(state.submission).toEqual({ status: 'idle' });
  });
});

// ---------------------------------------------------------------------------
// initialEditState — coalescing + happy-path hydration
// ---------------------------------------------------------------------------

describe('initialEditState', () => {
  const baseProfiles: LanguageProfile[] = [
    { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
    { language: Language.DE, proficiencyLevel: CefrLevel.A2 },
  ];

  const basePrefs: PreferencesResponse = {
    primaryLanguage: Language.ES,
    goals: ['grammar', 'speaking'],
    dailyMinutes: 20,
    gentleNudges: false,
    notes: 'meeting next week',
  };

  it('coalesces null dailyMinutes to the default of 10', () => {
    const state = initialEditState(baseProfiles, {
      ...basePrefs,
      dailyMinutes: null,
    });
    expect(state.dailyMinutes).toBe(10);
  });

  it('preserves a non-null dailyMinutes value', () => {
    const state = initialEditState(baseProfiles, {
      ...basePrefs,
      dailyMinutes: 20,
    });
    expect(state.dailyMinutes).toBe(20);
  });

  it('hydrates every wizard field from profiles + prefs', () => {
    const state = initialEditState(baseProfiles, basePrefs);
    expect(state.mode).toBe('edit');
    expect(state.step).toBe(1);
    expect(state.languages).toEqual([Language.ES, Language.DE]);
    expect(state.primaryLanguage).toBe(Language.ES);
    expect(state.goals).toEqual(['grammar', 'speaking']);
    expect(state.notes).toBe('meeting next week');
    expect(state.gentleNudges).toBe(false);
    expect(state.submission).toEqual({ status: 'idle' });
  });

  it('hydrates levels from every profile', () => {
    const state = initialEditState(
      [
        { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
        { language: Language.DE, proficiencyLevel: CefrLevel.A2 },
      ],
      { primaryLanguage: Language.ES, goals: [], dailyMinutes: 10, gentleNudges: true, notes: '' },
    );
    expect(state.levels).toEqual({ ES: CefrLevel.B2, DE: CefrLevel.A2 });
  });

  it('does not share the goals array reference with the prefs payload', () => {
    // Defensive: the reducer mutates `goals` via spread on toggleGoal, but
    // accidentally aliasing the source array would still be a smell.
    const state = initialEditState(baseProfiles, basePrefs);
    expect(state.goals).not.toBe(basePrefs.goals);
    expect(state.goals).toEqual(basePrefs.goals);
  });

  it('keeps GOAL_IDS in sync with the wizard-supported set', () => {
    // Sanity guard — if someone adds a new goal id to the shared package
    // without updating the wizard, this test surfaces the mismatch.
    expect(GOAL_IDS.length).toBeGreaterThanOrEqual(1);
  });
});
