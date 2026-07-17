import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import type { CurriculumMapResponse, CurriculumMapPoint } from '@language-drill/api-client';
import { MapTab } from '../map-tab';

// next/link renders as <a> in jsdom
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...(rest as Record<string, unknown>)}>
      {children}
    </a>
  ),
}));

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
    compatibleTypes: [],
    hasTheory: false,
    errorSample: null,
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

// Fixture: active level readyToAdvance + a preview A2 level
function buildReadyFixture(): CurriculumMapResponse {
  return {
    language: Language.TR,
    activeLevel: 'A1',
    levels: [
      {
        level: 'A1',
        solidCount: 6,
        total: 6,
        readyToAdvance: true,
        isPreview: false,
        points: [
          pt('tr-a1-vowel-harmony', 'Vowel Harmony', 1, 'solid'),
          pt('tr-a1-plural', 'Plural suffix', 2, 'solid'),
          pt('tr-a1-case', 'Accusative case', 3, 'solid'),
          pt('tr-a1-possessive', 'Possessive suffixes', 4, 'solid'),
          pt('tr-a1-verb-to-be', 'Verb "to be"', 5, 'solid'),
          pt('tr-a1-negation', 'Negation', 6, 'solid'),
        ],
      },
      {
        level: 'A2',
        solidCount: 0,
        total: 4,
        readyToAdvance: false,
        isPreview: true,
        points: [
          pt('tr-a2-dative', 'Dative case', 1, 'not-started'),
          pt('tr-a2-aorist', 'Aorist tense', 2, 'not-started'),
          pt('tr-a2-ablative', 'Ablative case', 3, 'not-started'),
          pt('tr-a2-conditional', 'Conditional', 4, 'not-started'),
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

  it('numbers points 1-based by position within the level, not the raw curriculum order', () => {
    // Prod `order` is a 0-based whole-language index, so the first point's raw
    // order is 0. The spine node must show "01" (position), never "00" (order).
    const data: CurriculumMapResponse = {
      language: Language.TR,
      activeLevel: 'A1',
      levels: [
        {
          level: 'A1',
          solidCount: 0,
          total: 3,
          readyToAdvance: false,
          isPreview: false,
          points: [
            pt('tr-a1-a', 'Alpha', 0, 'learning'),
            pt('tr-a1-b', 'Beta', 1, 'learning'),
            pt('tr-a1-c', 'Gamma', 2, 'not-started'),
          ],
        },
      ],
    };
    render(
      <MapTab
        data={data}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    expect(screen.queryByText('00')).toBeNull();
    expect(screen.getByText('01')).toBeDefined();
    expect(screen.getByText('02')).toBeDefined();
    expect(screen.getByText('03')).toBeDefined();
  });

  it('shows ✓ instead of a number for a solid point, and numbers resume by position after it', () => {
    // A solid point still consumes a position slot, so the next point is "03"
    // even though the solid one renders ✓ — matching the 01,02,✓,04 look.
    const data: CurriculumMapResponse = {
      language: Language.TR,
      activeLevel: 'A1',
      levels: [
        {
          level: 'A1',
          solidCount: 1,
          total: 3,
          readyToAdvance: false,
          isPreview: false,
          points: [
            pt('tr-a1-a', 'Alpha', 0, 'learning'),
            pt('tr-a1-b', 'Beta', 1, 'solid'),
            pt('tr-a1-c', 'Gamma', 2, 'learning'),
          ],
        },
      ],
    };
    render(
      <MapTab
        data={data}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    expect(screen.getByText('01')).toBeDefined();
    expect(screen.queryByText('02')).toBeNull(); // position 2 is the solid ✓
    expect(screen.getByText('03')).toBeDefined();
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

  it('explains the ⚠ N× badge with an accessible label and a hover tooltip', () => {
    render(
      <MapTab
        data={buildFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    // The badge carries a self-describing accessible name (read by AT instead
    // of the bare "⚠ 3×").
    expect(
      screen.getByLabelText(
        /still generating errors — 3 recent slips in the last 30 days/i,
      ),
    ).toBeInTheDocument();
    // ...and a (hover-revealed) tooltip bubble with the same wording.
    expect(
      screen.getByText('3 recent slips in the last 30 days'),
    ).toBeInTheDocument();
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

  it('renders the mastery bar with correct width for a learning point with mastery', () => {
    const fixtureWithMastery: CurriculumMapResponse = {
      language: Language.TR,
      activeLevel: 'A1',
      levels: [
        {
          level: 'A1',
          solidCount: 0,
          total: 1,
          readyToAdvance: false,
          isPreview: false,
          points: [
            pt('tr-a1-test', 'Test Point', 1, 'learning', {
              mastery: 0.65,
              errorProne: false,
            }),
          ],
        },
      ],
    };

    render(
      <MapTab
        data={fixtureWithMastery}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    const masteryBar = screen.getByTestId('mastery-bar');
    expect(masteryBar).toBeDefined();
    expect(masteryBar.style.width).toBe('65%');
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

  it('clicking a point row opens the detail sheet with the point name', () => {
    render(
      <MapTab
        data={buildFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    // Click the "Vowel Harmony" point row body (it's a button)
    fireEvent.click(screen.getByText('Vowel Harmony'));
    // The detail sheet should now be visible as a dialog containing the point name
    expect(screen.getByRole('dialog')).toBeDefined();
    // The dialog should contain the point name in its aria-label or content
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Vowel Harmony');
  });

  // ---------------------------------------------------------------------------
  // Advance action tests
  // ---------------------------------------------------------------------------

  it('renders "add A2 →" button when readyToAdvance + preview level + onAdvance provided', () => {
    const onAdvance = vi.fn();
    render(
      <MapTab
        data={buildReadyFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
        onAdvance={onAdvance}
        advancing={false}
      />,
    );
    expect(screen.getByRole('button', { name: /add A2 →/i })).toBeDefined();
  });

  it('calls onAdvance when the "add A2 →" button is clicked', () => {
    const onAdvance = vi.fn();
    render(
      <MapTab
        data={buildReadyFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
        onAdvance={onAdvance}
        advancing={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add A2 →/i }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('shows "adding…" label and disables button while advancing', () => {
    const onAdvance = vi.fn();
    render(
      <MapTab
        data={buildReadyFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
        onAdvance={onAdvance}
        advancing={true}
      />,
    );
    const btn = screen.getByRole('button', { name: /adding…/i });
    expect(btn).toBeDefined();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('does NOT render the advance button when readyToAdvance is false (no preview level shown)', () => {
    const onAdvance = vi.fn();
    render(
      <MapTab
        data={buildFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
        onAdvance={onAdvance}
        advancing={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /add .* →/i })).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Chevron affordance tests
  // ---------------------------------------------------------------------------

  it('renders a trailing chevron (›) on each visible grammar-point row', () => {
    render(
      <MapTab
        data={buildFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    // The fixture has at least 2 visible SpineRows: "Vowel Harmony" (learning)
    // and 'Verb "to be"' (error-prone solid, not collapsed).
    // Each should have an aria-hidden chevron span.
    const chevrons = document
      .querySelectorAll('[aria-hidden="true"]');
    // Filter to only the › chevron spans
    const chevronSpans = Array.from(chevrons).filter(
      (el) => el.textContent === '›',
    );
    expect(chevronSpans.length).toBeGreaterThanOrEqual(2);
  });

  it('each point row is still clickable (opens the sheet) with the chevron present', () => {
    render(
      <MapTab
        data={buildFixture()}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
      />,
    );
    // Clicking the row text (part of the button) should still open the sheet
    fireEvent.click(screen.getByText('Vowel Harmony'));
    expect(screen.getByRole('dialog')).toBeDefined();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Vowel Harmony');
  });

  it('does NOT render the advance button when no preview level exists even if readyToAdvance is true', () => {
    const onAdvance = vi.fn();
    // Build a fixture that is ready to advance but has no preview level
    const noPreviewFixture: CurriculumMapResponse = {
      language: Language.TR,
      activeLevel: 'A1',
      levels: [
        {
          level: 'A1',
          solidCount: 6,
          total: 6,
          readyToAdvance: true,
          isPreview: false,
          points: [pt('tr-a1-vowel-harmony', 'Vowel Harmony', 1, 'solid')],
        },
      ],
    };
    render(
      <MapTab
        data={noPreviewFixture}
        isLoading={false}
        error={null}
        onRetry={noop}
        errorThemes={[]}
        onAdvance={onAdvance}
        advancing={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /add .* →/i })).toBeNull();
  });
});
