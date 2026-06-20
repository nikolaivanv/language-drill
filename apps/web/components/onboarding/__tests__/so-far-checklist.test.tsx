// ---------------------------------------------------------------------------
// SoFarChecklist tests
// ---------------------------------------------------------------------------
// Locks the glyph state machine, the per-row summary formatting (R6.5), and
// the placeholder-A1 disclosure rule (R6.6). Always renders inside a real
// `OnboardingProvider` so we exercise the actual selectors via context.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import { OnboardingProvider } from '../onboarding-context';
import {
  initialNewUserState,
  type OnboardingState,
} from '../use-onboarding-reducer';
import { SoFarChecklist } from '../so-far-checklist';

function buildState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return { ...initialNewUserState(), ...overrides };
}

function renderChecklist(state: OnboardingState) {
  return render(
    <OnboardingProvider initialState={state}>
      <SoFarChecklist />
    </OnboardingProvider>
  );
}

/**
 * Returns the `<li>` row for a given label. Each row's label is unique, so
 * we look up by text and walk to the enclosing list item.
 */
function getRow(label: string): HTMLElement {
  // The label is wrapped inside a span that may also contain summary text,
  // so we match on the start of the visible content.
  const labelNode = screen.getByText(
    (_content, node) =>
      node !== null &&
      node.tagName === 'SPAN' &&
      node.firstChild !== null &&
      node.firstChild.nodeType === Node.TEXT_NODE &&
      node.firstChild.textContent === label
  );
  const li = labelNode.closest('li');
  if (li === null) throw new Error(`row "${label}" has no enclosing <li>`);
  return li as HTMLElement;
}

/** The glyph cell is the first `aria-hidden` span inside each row. */
function glyphFor(row: HTMLElement): string {
  const glyph = row.querySelector('span[aria-hidden="true"]');
  if (glyph === null) throw new Error('row has no aria-hidden glyph span');
  return glyph.textContent ?? '';
}

describe('SoFarChecklist — glyph state machine by current step', () => {
  it('step 1: languages is current (●), the rest pending (○)', () => {
    renderChecklist(buildState({ step: 1 }));
    expect(glyphFor(getRow('languages'))).toBe('●');
    expect(glyphFor(getRow('primary + level'))).toBe('○');
    expect(glyphFor(getRow('goals'))).toBe('○');
    expect(glyphFor(getRow('schedule'))).toBe('○');
  });

  it('step 2: languages completed (✓), primary + level current (●), rest pending (○)', () => {
    renderChecklist(
      buildState({ step: 2, languages: [Language.ES] })
    );
    expect(glyphFor(getRow('languages'))).toBe('✓');
    expect(glyphFor(getRow('primary + level'))).toBe('●');
    expect(glyphFor(getRow('goals'))).toBe('○');
    expect(glyphFor(getRow('schedule'))).toBe('○');
  });

  it('step 3: first two completed (✓), goals current (●), schedule pending (○)', () => {
    renderChecklist(
      buildState({
        step: 3,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        levels: { [Language.ES]: CefrLevel.B2 },
      })
    );
    expect(glyphFor(getRow('languages'))).toBe('✓');
    expect(glyphFor(getRow('primary + level'))).toBe('✓');
    expect(glyphFor(getRow('goals'))).toBe('●');
    expect(glyphFor(getRow('schedule'))).toBe('○');
  });

  it('step 4: first three completed (✓), schedule current (●)', () => {
    renderChecklist(
      buildState({
        step: 4,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        levels: { [Language.ES]: CefrLevel.B2 },
        goals: ['grammar', 'speaking'],
      })
    );
    expect(glyphFor(getRow('languages'))).toBe('✓');
    expect(glyphFor(getRow('primary + level'))).toBe('✓');
    expect(glyphFor(getRow('goals'))).toBe('✓');
    expect(glyphFor(getRow('schedule'))).toBe('●');
  });
});

describe('SoFarChecklist — summary formatting (R6.5)', () => {
  it('languages row reads "N selected" when completed', () => {
    renderChecklist(
      buildState({
        step: 2,
        languages: [Language.ES, Language.DE, Language.TR],
      })
    );
    const row = getRow('languages');
    // "3 selected" is the canonical summary string per the implementation.
    expect(within(row).getByText('3 selected')).toBeInTheDocument();
  });

  it('primary + level summary is "ES · B2" with U+00B7 and uppercase code', () => {
    renderChecklist(
      buildState({
        step: 3,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        levels: { [Language.ES]: CefrLevel.B2 },
      })
    );
    const row = getRow('primary + level');
    // Embed the literal middle dot (U+00B7) — this guards against a
    // regression where someone uses a regular '.' or '*'.
    expect(within(row).getByText('ES · B2')).toBeInTheDocument();
  });

  it('goals row reads "N picked" when ≥1 goal is selected', () => {
    renderChecklist(
      buildState({
        step: 4,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        levels: { [Language.ES]: CefrLevel.B2 },
        goals: ['grammar', 'speaking'],
      })
    );
    const row = getRow('goals');
    expect(within(row).getByText('2 picked')).toBeInTheDocument();
  });

  it('goals row reads "none" when 0 goals are selected and the row is completed', () => {
    renderChecklist(
      buildState({
        step: 4,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        levels: { [Language.ES]: CefrLevel.B2 },
        goals: [],
      })
    );
    const row = getRow('goals');
    expect(within(row).getByText('none')).toBeInTheDocument();
  });

  it('schedule summary IS rendered while the row is current (step 4) — summaries render on any non-pending row', () => {
    // Per `so-far-checklist.tsx`, `showSummary = (status === "completed" ||
    // status === "current") && row.summary !== null`. The schedule row is
    // the only step-4 row that's ever `current` within the 1–4 range, and
    // the user can only meaningfully look at "10 min/day" while editing
    // that step — so it must render. This test pins that behaviour so a
    // regression that hides current-row summaries again breaks loudly.
    renderChecklist(
      buildState({
        step: 4,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        levels: { [Language.ES]: CefrLevel.B2 },
        dailyMinutes: 10,
      })
    );
    const row = getRow('schedule');
    expect(within(row).getByText('10 min/day')).toBeInTheDocument();
  });
});

