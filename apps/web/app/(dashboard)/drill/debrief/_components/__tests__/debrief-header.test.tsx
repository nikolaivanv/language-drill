import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DebriefResponse } from '@language-drill/api-client';
import type { SkillMovement } from '@language-drill/shared';
import { DebriefHeader } from '../debrief-header';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDebrief(overrides: Partial<DebriefResponse> = {}): DebriefResponse {
  return {
    id: '11111111-2222-4222-8222-555555555555',
    language: 'ES' as DebriefResponse['language'],
    difficulty: 'B1' as DebriefResponse['difficulty'],
    startedAt: '2026-05-04T10:00:00.000Z',
    completedAt: '2026-05-04T10:04:38.000Z',
    durationSeconds: 278,
    exerciseCount: 5,
    correctCount: 4,
    attemptedCount: 5,
    skippedCount: 0,
    items: [],
    skillMovements: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Title + subline vary by skill movement (movement-summary.ts)
// ---------------------------------------------------------------------------

const mv = (band: SkillMovement['band'], key: string): SkillMovement => ({
  grammarPointKey: key,
  label: `Point ${key}`,
  band,
  confidence: 'high',
});

describe('DebriefHeader — movement title', () => {
  it('renders the gained title when a skill gained', () => {
    render(<DebriefHeader debrief={makeDebrief({ skillMovements: [mv('gain', 'a')] })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('solid session.');
    expect(screen.getByText('one skill gained · nothing slipped')).toBeInTheDocument();
  });

  it('renders the slipped title when a skill slipped with no gain', () => {
    render(<DebriefHeader debrief={makeDebrief({ skillMovements: [mv('slip', 'a')] })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('worth another look.');
  });

  it('renders the none title when nothing was attempted', () => {
    render(
      <DebriefHeader
        debrief={makeDebrief({ skillMovements: [], attemptedCount: 0 })}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('nothing answered.');
  });

  it('renders the steady title when movements are empty but items were attempted', () => {
    render(
      <DebriefHeader
        debrief={makeDebrief({ skillMovements: [], attemptedCount: 5 })}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('steady session.');
  });
});

describe('DebriefHeader — factual line', () => {
  it('renders the item count without a skipped clause at zero', () => {
    render(<DebriefHeader debrief={makeDebrief({ exerciseCount: 5, skippedCount: 0 })} />);
    expect(screen.getByText('5 items')).toBeInTheDocument();
  });

  it('appends the skipped clause when skippedCount > 0', () => {
    render(<DebriefHeader debrief={makeDebrief({ exerciseCount: 5, skippedCount: 2 })} />);
    expect(screen.getByText('5 items · 2 skipped')).toBeInTheDocument();
  });
});

describe('DebriefHeader — no accuracy percentage', () => {
  // The regression guard for this change: the header must never again put a
  // percentage next to a movement verdict.
  it('renders no percent sign, whatever the counts', () => {
    const { container } = render(
      <DebriefHeader
        debrief={makeDebrief({
          correctCount: 5, attemptedCount: 5, exerciseCount: 5,
          skillMovements: [mv('slip', 'a')],
        })}
      />,
    );
    expect(container.textContent).not.toContain('%');
  });
});

// ---------------------------------------------------------------------------
// Eyebrow with m:ss duration formatting (Req 3.1)
// ---------------------------------------------------------------------------

describe('DebriefHeader — duration formatting', () => {
  type Case = { seconds: number; expected: string };

  const cases: Case[] = [
    { seconds: 0, expected: '0:00' },
    { seconds: 5, expected: '0:05' },
    { seconds: 59, expected: '0:59' },
    { seconds: 60, expected: '1:00' },
    { seconds: 278, expected: '4:38' },
    { seconds: 600, expected: '10:00' },
    { seconds: 3601, expected: '60:01' },
  ];

  it.each(cases)(
    'durationSeconds=$seconds renders as "session done · $expected"',
    ({ seconds, expected }) => {
      const { container } = render(
        <DebriefHeader debrief={makeDebrief({ durationSeconds: seconds })} />,
      );
      // The eyebrow uses t-micro which uppercases via CSS, so look at raw text.
      expect(container.textContent).toContain(`session done · ${expected}`);
    },
  );

  it('handles negative durations defensively (clamps to 0)', () => {
    const { container } = render(
      <DebriefHeader debrief={makeDebrief({ durationSeconds: -10 })} />,
    );
    expect(container.textContent).toContain('session done · 0:00');
  });
});

// ---------------------------------------------------------------------------
// No streak / XP copy (Req 3.6 — CLAUDE.md hard rule)
// ---------------------------------------------------------------------------

describe('DebriefHeader — no streak / XP / day-counter copy', () => {
  it('does not render the words "streak", "xp", "day", or "🔥"', () => {
    const { container } = render(<DebriefHeader debrief={makeDebrief()} />);
    const text = container.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('streak');
    expect(text.toLowerCase()).not.toContain('xp');
    // "day" — match as a whole word, not as a substring of e.g. "today" (none rendered)
    expect(text).not.toMatch(/\bday\b/i);
    expect(text).not.toContain('🔥');
  });
});

// ---------------------------------------------------------------------------
// Lowercase invariant (Req 3.7)
// ---------------------------------------------------------------------------

describe('DebriefHeader — lowercase copy invariant', () => {
  it('all letter characters in the rendered text are lowercase', () => {
    const { container } = render(
      <DebriefHeader debrief={makeDebrief({ correctCount: 4, attemptedCount: 5, exerciseCount: 5 })} />,
    );
    const text = container.textContent ?? '';
    const letters = text.match(/[a-z]/gi) ?? [];
    for (const ch of letters) {
      expect(ch).toBe(ch.toLowerCase());
    }
  });
});
