import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DebriefResponse } from '@language-drill/api-client';
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
// Title varies by accuracy tier (Req 3.2–3.4)
// ---------------------------------------------------------------------------

describe('DebriefHeader — title by accuracy tier', () => {
  it('renders "nice work." for accuracy >= 0.8 (high tier)', () => {
    render(<DebriefHeader debrief={makeDebrief({ correctCount: 5, attemptedCount: 5 })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('nice work.');
  });

  it('renders "nice work." at the 0.8 boundary (8 of 10)', () => {
    render(<DebriefHeader debrief={makeDebrief({ correctCount: 8, attemptedCount: 10, exerciseCount: 10 })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('nice work.');
  });

  it('renders "good attempt." for 0.5 <= accuracy < 0.8 (mid tier)', () => {
    render(<DebriefHeader debrief={makeDebrief({ correctCount: 3, attemptedCount: 5 })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('good attempt.');
  });

  it('renders "good attempt." at the 0.5 boundary (5 of 10)', () => {
    render(<DebriefHeader debrief={makeDebrief({ correctCount: 5, attemptedCount: 10, exerciseCount: 10 })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('good attempt.');
  });

  it('renders "back next time?" for accuracy < 0.5 (low tier)', () => {
    render(<DebriefHeader debrief={makeDebrief({ correctCount: 1, attemptedCount: 5 })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('back next time?');
  });

  it('renders "back next time?" when attemptedCount === 0', () => {
    render(<DebriefHeader debrief={makeDebrief({
      correctCount: 0,
      attemptedCount: 0,
      skippedCount: 5,
    })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('back next time?');
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
// Body line — "you got X of Y · accuracy Z%[ · N skipped]" (Req 3.1, 3.5)
// ---------------------------------------------------------------------------

describe('DebriefHeader — body line', () => {
  it('renders "you got 4 of 5 · accuracy 80%" for a 4/5 attempt', () => {
    const { container } = render(
      <DebriefHeader debrief={makeDebrief({ correctCount: 4, attemptedCount: 5, exerciseCount: 5, skippedCount: 0 })} />,
    );
    expect(container.textContent).toContain('you got 4 of 5');
    expect(container.textContent).toContain('accuracy 80%');
    // No skipped suffix when skippedCount === 0
    expect(container.textContent).not.toContain('skipped');
  });

  it('appends " · N skipped" when skippedCount > 0', () => {
    const { container } = render(
      <DebriefHeader debrief={makeDebrief({
        correctCount: 2,
        attemptedCount: 3,
        exerciseCount: 5,
        skippedCount: 2,
      })} />,
    );
    expect(container.textContent).toContain('you got 2 of 5');
    expect(container.textContent).toContain('accuracy 67%');
    expect(container.textContent).toContain('2 skipped');
  });

  it('renders accuracy as "—" when attemptedCount === 0', () => {
    const { container } = render(
      <DebriefHeader debrief={makeDebrief({
        correctCount: 0,
        attemptedCount: 0,
        exerciseCount: 5,
        skippedCount: 5,
      })} />,
    );
    expect(container.textContent).toContain('accuracy —');
    expect(container.textContent).toContain('5 skipped');
  });

  it('rounds accuracy via Math.round (e.g., 7/10 → 70%)', () => {
    const { container } = render(
      <DebriefHeader debrief={makeDebrief({ correctCount: 7, attemptedCount: 10, exerciseCount: 10 })} />,
    );
    expect(container.textContent).toContain('accuracy 70%');
  });

  it('rounds accuracy via Math.round (e.g., 1/3 ≈ 33%)', () => {
    const { container } = render(
      <DebriefHeader debrief={makeDebrief({ correctCount: 1, attemptedCount: 3, exerciseCount: 3 })} />,
    );
    expect(container.textContent).toContain('accuracy 33%');
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
