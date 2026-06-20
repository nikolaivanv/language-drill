import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import type { CurriculumMapResponse, CurriculumMapPoint } from '@language-drill/api-client';
import { MapTab } from '../map-tab';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const noop = () => {};

function pt(
  key: string,
  name: string,
  order: number,
  state: CurriculumMapPoint['state'],
  opts: Partial<CurriculumMapPoint> = {},
): CurriculumMapPoint {
  return {
    key,
    name,
    cefrLevel: 'A1',
    order,
    state,
    errorProne: false,
    mastery: null,
    confidence: null,
    evidenceCount: 0,
    lastPracticedAt: null,
    recentErrorCount: 0,
    prereqKeys: [],
    prereqNames: [],
    prereqUnmet: false,
    ...opts,
  };
}

// Fixture: active level with 1 learning, 3 solids (collapsible run), 1 error-prone, 1 not-started+prereqUnmet
function buildFixture(): CurriculumMapResponse {
  return {
    language: Language.TR,
    activeLevel: 'A1',
    levels: [
      {
        level: 'A1',
        solidCount: 3,
        total: 6,
        readyToAdvance: false,
        isPreview: false,
        points: [
          pt('tr-a1-vowel-harmony', 'Vowel Harmony', 1, 'learning'),
          // 3 consecutive solids — will be collapsed
          pt('tr-a1-plural', 'Plural suffix', 2, 'solid'),
          pt('tr-a1-case', 'Accusative case', 3, 'solid'),
          pt('tr-a1-possessive', 'Possessive suffixes', 4, 'solid'),
          // error-prone solid — must NOT be in the collapsed run
          pt('tr-a1-verb-to-be', 'Verb "to be"', 5, 'solid', {
            errorProne: true,
            recentErrorCount: 3,
          }),
          // not-started with unmet prereq
          pt('tr-a1-negation', 'Negation', 6, 'not-started', {
            prereqUnmet: true,
            prereqKeys: ['tr-a1-verb-to-be'],
            prereqNames: ['Verb "to be"'],
          }),
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MapTab', () => {
  it('renders the readiness rollup text with solidCount and total', () => {
    render(
      <MapTab
        data={buildFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    // "3 of 6 A1 grammar points solid."
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('6')).toBeDefined();
    expect(screen.getByText(/grammar points solid/i)).toBeDefined();
  });

  it('renders the learning point name', () => {
    render(
      <MapTab
        data={buildFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    expect(screen.getByText('Vowel Harmony')).toBeDefined();
  });

  it('renders a collapsed-run control for the run of 3 solids', () => {
    render(
      <MapTab
        data={buildFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    // The 3 consecutive non-error-prone solids collapse into "3 solid — show"
    expect(screen.getByText(/3 solid — show/i)).toBeDefined();
  });

  it('renders the error-prone point name and ⚠ flag (not hidden in collapsed run)', () => {
    render(
      <MapTab
        data={buildFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    // Verb "to be" is errorProne so it breaks the run and renders as its own row
    expect(screen.getByText('Verb "to be"')).toBeDefined();
    // The ⚠ 3× error flag
    expect(screen.getByText(/⚠.*3×/)).toBeDefined();
  });

  it('renders the "builds on X" cue for a not-started prereq-unmet point', () => {
    render(
      <MapTab
        data={buildFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    expect(screen.getByText(/builds on Verb "to be"/i)).toBeDefined();
  });

  it('renders a loading spinner while isLoading is true', () => {
    render(
      <MapTab
        data={undefined}
        isLoading={true}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('renders the error card with retry button when error is set', () => {
    const { getByRole, getByText } = render(
      <MapTab
        data={undefined}
        isLoading={false}
        error={new Error('network error')}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    expect(getByText(/couldn't load the curriculum map/i)).toBeDefined();
    expect(getByRole('button', { name: /retry/i })).toBeDefined();
  });
});
