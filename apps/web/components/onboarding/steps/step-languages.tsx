'use client';

// ---------------------------------------------------------------------------
// StepLanguages — Step 1 of 4
// ---------------------------------------------------------------------------
// Renders the eyebrow / headline / body copy from R2.6 and a 2-column grid of
// 3 `Choice` tiles (mode `checkbox`) for the learning languages ES / DE / TR
// (English is excluded — it is a source-only language for translation
// exercises). Tile order is fixed at ES → DE → TR; the order is part of the
// step's contract (see step-languages.test.tsx).
//
// Edit-mode last-language guard (R2.7): the reducer silently rejects
// `setLanguages([])` when `state.mode === 'edit'`, but this component owns
// the user-facing message. When the user attempts to deselect their only
// remaining language we surface an inline `t-small ink-mute` explanation
// instead of dispatching. Any successful selection or deselection clears the
// message.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import {
  LANGUAGE_NATIVE_NAMES,
  Language,
  type LearningLanguage,
} from '@language-drill/shared';
import { Choice } from '../../ui/choice';
import { Flagdot } from '../../shell/flagdot';
import { useOnboarding } from '../onboarding-context';

// Fixed display order. Do not sort or rederive — the contract is asserted in
// `step-languages.test.tsx` and the design treats the order as part of the
// layout.
const LEARNING_LANGUAGES: readonly LearningLanguage[] = [
  Language.ES,
  Language.DE,
  Language.TR,
] as const;

// R2.7: the em dash is U+2014 — match exactly so screen readers and tests
// see the canonical string.
const LAST_LANGUAGE_GUARD_MESSAGE =
  'you need at least one language — to fully reset, delete your account from settings.';

export function StepLanguages() {
  const { state, dispatch } = useOnboarding();
  const [showLastLanguageGuard, setShowLastLanguageGuard] = useState(false);

  const isSelected = (language: LearningLanguage) =>
    state.languages.includes(language);

  const handleToggle = (language: LearningLanguage) => {
    const wasSelected = isSelected(language);

    // Edit mode + only one language remaining + user is trying to deselect
    // it → surface the inline guard, do not dispatch. The reducer would
    // silently reject the empty array anyway; this is purely a UX message.
    if (
      state.mode === 'edit' &&
      wasSelected &&
      state.languages.length === 1
    ) {
      setShowLastLanguageGuard(true);
      return;
    }

    setShowLastLanguageGuard(false);
    const next = wasSelected
      ? state.languages.filter((l) => l !== language)
      : [...state.languages, language];
    dispatch({ type: 'setLanguages', languages: next });
  };

  return (
    <div className="flex flex-col gap-s-5">
      <header className="flex flex-col gap-s-2">
        <p className="t-micro text-ink-mute">step 1</p>
        <h2 className="t-display-l">which languages are you learning?</h2>
        <p className="t-body text-ink-mute">
          pick any you&apos;re working on — even ones you haven&apos;t started
          yet.
        </p>
      </header>

      <div
        className="grid grid-cols-2 mobile:grid-cols-1 gap-[12px]"
        role="group"
        aria-label="learning languages"
      >
        {LEARNING_LANGUAGES.map((language) => (
          <Choice
            key={language}
            mode="checkbox"
            selected={isSelected(language)}
            onSelect={() => handleToggle(language)}
            className="mobile:min-h-[48px]"
          >
            <span className="flex items-center gap-s-3">
              <Flagdot language={language} />
              <span className="t-body text-ink">
                {LANGUAGE_NATIVE_NAMES[language]}
              </span>
            </span>
          </Choice>
        ))}
      </div>

      {showLastLanguageGuard ? (
        <p
          role="status"
          aria-live="polite"
          className="t-small text-ink-mute"
        >
          {LAST_LANGUAGE_GUARD_MESSAGE}
        </p>
      ) : null}
    </div>
  );
}
