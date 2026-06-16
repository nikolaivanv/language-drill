import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DebriefResponse } from '@language-drill/api-client';
import { DebriefTab } from '../debrief-tab';

// next/link in tests just renders an anchor; mock it minimally.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// What's-next routing (Req 4.4)
// ---------------------------------------------------------------------------

describe('DebriefTab — what\'s-next link', () => {
  it('high-tier renders a link to /progress', () => {
    render(<DebriefTab debrief={makeDebrief({ correctCount: 5, attemptedCount: 5 })} />);
    const link = screen.getByRole('link', { name: /see what moved/ });
    expect(link.getAttribute('href')).toBe('/progress');
  });

  it('mid-tier renders a link to /drill?start=quick', () => {
    render(<DebriefTab debrief={makeDebrief({ correctCount: 3, attemptedCount: 5 })} />);
    const link = screen.getByRole('link', { name: /another short session/ });
    expect(link.getAttribute('href')).toBe('/drill?start=quick');
  });

  it('low-tier renders a link to /drill?start=quick', () => {
    render(<DebriefTab debrief={makeDebrief({ correctCount: 1, attemptedCount: 5 })} />);
    const link = screen.getByRole('link', { name: /another short session/ });
    expect(link.getAttribute('href')).toBe('/drill?start=quick');
  });

  it('all-skipped (attemptedCount === 0) renders a link to /drill?start=quick', () => {
    render(
      <DebriefTab
        debrief={makeDebrief({
          correctCount: 0,
          attemptedCount: 0,
          skippedCount: 5,
        })}
      />,
    );
    const link = screen.getByRole('link', { name: /another short session/ });
    expect(link.getAttribute('href')).toBe('/drill?start=quick');
  });

  it('renders the "what\'s next" eyebrow above the link', () => {
    const { container } = render(<DebriefTab debrief={makeDebrief()} />);
    expect(container.textContent).toContain("what's next");
  });
});

// ---------------------------------------------------------------------------
// Narrative paragraphs (Req 4.2, 4.3)
// ---------------------------------------------------------------------------

describe('DebriefTab — narrative paragraphs', () => {
  it('renders 1–2 paragraphs in the coach card', () => {
    const { container } = render(
      <DebriefTab debrief={makeDebrief({ correctCount: 4, attemptedCount: 5 })} />,
    );
    // Coach card paragraphs use t-body-l; the italic quoted-speech line uses
    // t-body. Count <p> elements with t-body-l class.
    const bodyParagraphs = container.querySelectorAll('p.t-body-l');
    expect(bodyParagraphs.length).toBeGreaterThanOrEqual(1);
    expect(bodyParagraphs.length).toBeLessThanOrEqual(2);
  });

  it('paragraphs reference the language name (Req 4.3)', () => {
    const { container } = render(
      <DebriefTab debrief={makeDebrief({ language: 'ES' as DebriefResponse['language'] })} />,
    );
    expect(container.textContent?.toLowerCase()).toContain('spanish');
  });

  it('paragraphs reference the language name for German (DE)', () => {
    const { container } = render(
      <DebriefTab debrief={makeDebrief({ language: 'DE' as DebriefResponse['language'] })} />,
    );
    expect(container.textContent?.toLowerCase()).toContain('german');
  });

  it('paragraphs reference the language name for Turkish (TR)', () => {
    const { container } = render(
      <DebriefTab debrief={makeDebrief({ language: 'TR' as DebriefResponse['language'] })} />,
    );
    expect(container.textContent?.toLowerCase()).toContain('turkish');
  });
});

// ---------------------------------------------------------------------------
// Coach speech-bubble line via coachMessage (design parity)
// ---------------------------------------------------------------------------

describe('DebriefTab — coach speech-bubble line', () => {
  it('renders the quoted coachMessage(sessionComplete) line for high accuracy', () => {
    const { container } = render(
      <DebriefTab debrief={makeDebrief({ correctCount: 5, attemptedCount: 5 })} />,
    );
    // ≥0.9 → "Strong session — that one stuck."
    expect(container.textContent).toContain('Strong session');
  });

  it('renders the "Solid session." line for >= 0.7 accuracy', () => {
    const { container } = render(
      <DebriefTab debrief={makeDebrief({ correctCount: 7, attemptedCount: 10 })} />,
    );
    expect(container.textContent).toContain('Solid session.');
  });

  it('renders the all-skipped line when attemptedCount === 0', () => {
    const { container } = render(
      <DebriefTab
        debrief={makeDebrief({
          correctCount: 0,
          attemptedCount: 0,
          skippedCount: 5,
        })}
      />,
    );
    // accuracy === null branch → "Nice work — let's see what landed."
    expect(container.textContent).toContain("Nice work");
  });
});

// ---------------------------------------------------------------------------
// No skill-delta section (Req 4.5)
// ---------------------------------------------------------------------------

describe('DebriefTab — no skill deltas in v1', () => {
  // The skill-delta section from the prototype renders a "skill impact · this
  // session" header followed by per-topic before/after bars. None of that
  // should appear in v1 (Req 4.5). We test for the prototype-specific labels
  // and for the lack of any progress bar (<svg>) inside the panel.
  it('does not render the prototype "skill impact" subheader or progress bars', () => {
    const { container } = render(<DebriefTab debrief={makeDebrief()} />);
    const text = container.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('skill impact');
    expect(text.toLowerCase()).not.toContain('skill delta');
    // No SVG tile (the prototype's delta arrows + sparkline use SVG).
    expect(container.querySelector('svg')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Coach avatar
// ---------------------------------------------------------------------------

describe('DebriefTab — coach avatar', () => {
  it('renders the "c" coach avatar with aria-hidden', () => {
    const { container } = render(<DebriefTab debrief={makeDebrief()} />);
    const avatar = container.querySelector('[aria-hidden="true"]');
    expect(avatar).not.toBeNull();
    expect(avatar?.textContent).toBe('c');
  });
});
