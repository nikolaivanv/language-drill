import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DebriefResponse } from '@language-drill/api-client';
import { DebriefTab } from '../debrief-tab';

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

describe('DebriefTab — what moved panel', () => {
  it('renders mover rows when the debrief carries movers', () => {
    render(
      <DebriefTab
        debrief={makeDebrief({
          skillMovements: [
            { grammarPointKey: 'es-b1-subjunctive', label: 'Subjuntivo', band: 'strong-gain', confidence: 'high' },
          ],
        })}
      />,
    );
    expect(screen.getByText('Subjuntivo')).toBeInTheDocument();
    expect(screen.getByText(/strong gain/)).toBeInTheDocument();
  });

  it('renders the all-steady message when nothing moved', () => {
    const { container } = render(
      <DebriefTab
        debrief={makeDebrief({
          skillMovements: [
            { grammarPointKey: 'a', label: 'A', band: 'steady', confidence: 'high' },
            { grammarPointKey: 'b', label: 'B', band: 'steady', confidence: 'high' },
          ],
        })}
      />,
    );
    expect(container.textContent).toContain('held steady');
    expect(container.textContent).toContain('adds signal');
  });

  it('renders the no-movement message when there are no movements', () => {
    const { container } = render(<DebriefTab debrief={makeDebrief({ skillMovements: [] })} />);
    expect(container.textContent).toContain('No skill movement recorded');
  });
});

describe('DebriefTab — consolidation', () => {
  it('does not render a coach card / coach voice', () => {
    const { container } = render(<DebriefTab debrief={makeDebrief()} />);
    expect((container.textContent ?? '').toLowerCase()).not.toContain('coach');
  });

  it('does not render a what\'s-next callout', () => {
    const { container } = render(<DebriefTab debrief={makeDebrief()} />);
    expect((container.textContent ?? '').toLowerCase()).not.toContain("what's next");
  });

  it('does not restate the score (no "X of Y" — that lives in the header)', () => {
    const { container } = render(
      <DebriefTab
        debrief={makeDebrief({
          correctCount: 4,
          attemptedCount: 5,
          skillMovements: [
            { grammarPointKey: 'a', label: 'A', band: 'gain', confidence: 'high' },
          ],
        })}
      />,
    );
    expect(container.textContent ?? '').not.toMatch(/\d of \d/);
  });

  it('does not render any link (forward actions live in the footer)', () => {
    render(<DebriefTab debrief={makeDebrief()} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
