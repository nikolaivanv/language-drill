'use client';

// ---------------------------------------------------------------------------
// StepLevel — Step 2 of 4
// ---------------------------------------------------------------------------
// Renders the eyebrow / headline / body copy from R3.x and:
//   1. (Only when more than one language was selected in Step 1) a primary-
//      language radiogroup of `Choice` tiles in `mode="radio"`, each tile
//      showing a `Flagdot` plus the uppercase language code. Arrow keys move
//      focus among the tiles (WAI-ARIA roving-focus pattern); selection is
//      handled by `Choice`'s own click/Enter/Space behaviour.
//   2. A vertical stack of 6 CEFR cards (`Choice` `mode="radio"`) showing the
//      level code, lowercase name, and short description. Copy is verbatim
//      from the prototype `docs/design-archive/design_handoff_language_drill/prototypes/web/hifi/
//      onboarding.jsx` (lines 138–145), which R3.4 cites as canonical.
//   3. The `<PlacementTestCallout />` disabled-callout below the cards.
//
// Single-language fast-path (R3.1): when exactly one language is selected,
// the primary-language row is suppressed AND the component auto-dispatches
// `setPrimary` on mount so the wizard's `selectCanAdvance` gate (which
// requires `primaryLanguage !== null`) is satisfiable as soon as the user
// picks a CEFR card. The reducer's `setPrimary` no-op-on-not-in-languages
// guard is satisfied because the language is in `state.languages`.
//
// The primary-language radiogroup arrow-key navigation is focus-only — we
// deliberately do NOT dispatch `setPrimary` on arrow-key navigation. That
// matches the WAI-ARIA "roving tabindex" pattern: arrows move focus,
// click/Enter/Space commits selection.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import {
  CefrLevel,
  LANGUAGE_NATIVE_NAMES,
  type LearningLanguage,
} from '@language-drill/shared';
import { Choice } from '../../ui/choice';
import { Flagdot } from '../../shell/flagdot';
import { useOnboarding } from '../onboarding-context';

// Verbatim from the hi-fi prototype (onboarding.jsx:139-144). R3.4 cites the
// prototype as the source of truth for these descriptions; A1 and B2 also
// appear inline in R3.4 as exact-match examples.
const CEFR_CARD_COPY: Record<
  CefrLevel,
  { name: string; description: string }
> = {
  [CefrLevel.A1]: {
    name: 'beginner',
    description: 'basic phrases, hello / goodbye',
  },
  [CefrLevel.A2]: {
    name: 'elementary',
    description: 'simple convos, familiar topics',
  },
  [CefrLevel.B1]: {
    name: 'intermediate',
    description: 'can handle most situations',
  },
  [CefrLevel.B2]: {
    name: 'upper int.',
    description: 'fluent on familiar topics, some friction',
  },
  [CefrLevel.C1]: {
    name: 'advanced',
    description: 'comfortable, occasional gaps',
  },
  [CefrLevel.C2]: {
    name: 'mastery',
    description: 'near-native, all registers',
  },
};

// Display order is fixed to the natural CEFR progression. Tests treat this
// order as part of the contract.
const CEFR_LEVELS: readonly CefrLevel[] = [
  CefrLevel.A1,
  CefrLevel.A2,
  CefrLevel.B1,
  CefrLevel.B2,
  CefrLevel.C1,
  CefrLevel.C2,
] as const;

// Headline fallback when the user has selected ≥2 languages but hasn't yet
// picked a primary. Mirrors the pattern used in `selectCoachMessage` for
// Step 2's coach copy so the rail and headline stay in sync.
const PRIMARY_LANGUAGE_FALLBACK = 'your primary language';

export function StepLevel() {
  const { state, dispatch } = useOnboarding();
  const radioGroupRef = useRef<HTMLDivElement | null>(null);

  // Single-language fast-path: auto-set the only selected language as primary
  // so the wizard footer's "continue" gate (primaryLanguage !== null && level
  // !== null) is satisfiable as soon as the user picks a CEFR card. Guarded
  // on `primaryLanguage === null` so we don't clobber a user-driven choice.
  useEffect(() => {
    if (
      state.languages.length === 1 &&
      state.primaryLanguage === null
    ) {
      dispatch({ type: 'setPrimary', language: state.languages[0] });
    }
  }, [state.languages, state.primaryLanguage, dispatch]);

  const primaryName =
    state.primaryLanguage !== null
      ? LANGUAGE_NATIVE_NAMES[state.primaryLanguage]
      : PRIMARY_LANGUAGE_FALLBACK;

  const handlePrimaryKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (!radioGroupRef.current) return;
    const tiles = Array.from(
      radioGroupRef.current.querySelectorAll<HTMLElement>('[role="radio"]'),
    );
    const index = tiles.indexOf(event.target as HTMLElement);
    if (index === -1) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      tiles[(index + 1) % tiles.length].focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      tiles[(index - 1 + tiles.length) % tiles.length].focus();
    }
  };

  const showPrimarySelector = state.languages.length > 1;

  return (
    <div className="flex flex-col gap-s-5">
      <header className="flex flex-col gap-s-2">
        <p className="t-micro text-ink-mute">step 2</p>
        <h2 className="t-display-l">
          roughly, where are you with{' '}
          <span className="hilite">{primaryName}</span>?
        </h2>
        <p className="t-body text-ink-mute">
          don&apos;t overthink it. you can always retake the placement test
          later.
        </p>
      </header>

      {showPrimarySelector ? (
        <div
          ref={radioGroupRef}
          role="radiogroup"
          aria-label="primary language"
          onKeyDown={handlePrimaryKeyDown}
          className="grid grid-cols-2 gap-[12px]"
        >
          {state.languages.map((language: LearningLanguage) => (
            <Choice
              key={language}
              mode="radio"
              selected={state.primaryLanguage === language}
              onSelect={() =>
                dispatch({ type: 'setPrimary', language })
              }
            >
              <span className="flex items-center gap-s-3 w-full">
                <Flagdot language={language} />
                <span className="flex-1 t-body text-ink">
                  {LANGUAGE_NATIVE_NAMES[language]}
                </span>
                {state.primaryLanguage === language ? (
                  <span className="t-micro uppercase tracking-[0.4px] text-accent-2 bg-accent-soft border border-accent rounded-pill px-s-2 py-[2px] flex-shrink-0">
                    primary
                  </span>
                ) : null}
              </span>
            </Choice>
          ))}
        </div>
      ) : null}

      {state.languages.map((language) => (
        <div key={language} className="flex flex-col gap-s-2">
          <p className="t-small text-ink-soft">
            {LANGUAGE_NATIVE_NAMES[language]}
          </p>
          <div
            role="radiogroup"
            aria-label={`${LANGUAGE_NATIVE_NAMES[language]} level`}
            className="flex flex-col gap-s-2"
          >
            {CEFR_LEVELS.map((level) => {
              const copy = CEFR_CARD_COPY[level];
              const selected = state.levels[language] === level;
              return (
                <Choice
                  key={level}
                  mode="radio"
                  selected={selected}
                  onSelect={() =>
                    dispatch({ type: 'setLevel', language, level })
                  }
                >
                  <span className="flex items-center gap-s-3 w-full">
                    <span
                      className={
                        selected
                          ? 't-mono text-ink w-[38px]'
                          : 't-mono text-ink-mute w-[38px]'
                      }
                    >
                      {level}
                    </span>
                    <span className="flex-1 flex flex-col">
                      <span className="t-body text-ink">{copy.name}</span>
                      <span className="t-small text-ink-mute">
                        {copy.description}
                      </span>
                    </span>
                  </span>
                </Choice>
              );
            })}
          </div>
        </div>
      ))}

    </div>
  );
}
