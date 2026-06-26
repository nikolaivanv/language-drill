import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReviewItemResult } from '@language-drill/api-client';
import { ReviewFeedback, type ReviewFeedbackProps } from '../review-feedback';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const correctResult: ReviewItemResult = {
  outcome: 'correct',
  correctAnswer: 'evlerinden',
  schedulerDelta: {
    intervalFrom: 4,
    intervalTo: 8,
    stabilityFrom: 4.2,
    stabilityTo: 7.1,
    stateFrom: 'learning',
    stateTo: 'mature',
  },
  masteryDeltas: [
    { grammarPoint: 'ablative case', from: 0.62, to: 0.71 },
    { grammarPoint: 'plural -ler', from: 0.7, to: 0.68 },
  ],
};

const incorrectResult: ReviewItemResult = {
  outcome: 'incorrect',
  correctAnswer: 'apenas',
  schedulerDelta: {
    intervalFrom: 12,
    intervalTo: 0,
    stabilityFrom: 9,
    stabilityTo: 2,
    stateFrom: 'mature',
    stateTo: 'leech',
  },
  masteryDeltas: [],
};

function renderFeedback(overrides: Partial<ReviewFeedbackProps> = {}) {
  const props: ReviewFeedbackProps = {
    result: correctResult,
    onNext: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ReviewFeedback {...props} />) };
}

// ---------------------------------------------------------------------------
// Verdict + corrected form (Req 10.2)
// ---------------------------------------------------------------------------

describe('ReviewFeedback verdict & corrected form', () => {
  it('renders the correct verdict and confirms the form', () => {
    renderFeedback();
    expect(screen.getByText('correct.')).toBeInTheDocument();
    expect(screen.getByText('evlerinden')).toBeInTheDocument();
  });

  it('renders the incorrect verdict and shows the answer', () => {
    renderFeedback({ result: incorrectResult });
    expect(screen.getByText('not quite.')).toBeInTheDocument();
    expect(screen.getByText(/answer ·/)).toBeInTheDocument();
    expect(screen.getByText('apenas')).toBeInTheDocument();
  });

  it('renders the partial verdict', () => {
    renderFeedback({
      result: { ...correctResult, outcome: 'partial' },
    });
    expect(screen.getByText('close.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Scheduler delta — human line (Req 10.2)
// ---------------------------------------------------------------------------

describe('ReviewFeedback scheduler delta', () => {
  it('renders the human next-review line instead of raw FSRS numbers', () => {
    renderFeedback();
    // correctResult: intervalTo=8, stateTo='mature' → "next review in ~8 days · solid"
    expect(screen.getByText('next review in ~8 days · solid')).toBeInTheDocument();
    expect(screen.queryByText('stability')).not.toBeInTheDocument();
    expect(screen.queryByText(/scheduler delta/i)).not.toBeInTheDocument();
  });

  it('shows a promotion chip when the lifecycle state advances', () => {
    renderFeedback();
    expect(
      screen.getByLabelText('promoted to mature'),
    ).toBeInTheDocument();
  });

  it('does not show a promotion chip on a lapse', () => {
    renderFeedback({ result: incorrectResult });
    expect(screen.queryByLabelText(/promoted to/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// What moved (Req 9.4)
// ---------------------------------------------------------------------------

describe('ReviewFeedback "what moved"', () => {
  it('renders a delta pill per mastery delta with percentages', () => {
    renderFeedback();
    expect(screen.getByText('ablative case')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('71%')).toBeInTheDocument();
    expect(screen.getByText('plural -ler')).toBeInTheDocument();
  });

  it('shows an up arrow for gains and a down arrow for drops', () => {
    renderFeedback();
    expect(screen.getByText('↑')).toBeInTheDocument(); // ablative 62→71
    expect(screen.getByText('↓')).toBeInTheDocument(); // plural 71→68
  });

  it('omits the "also moved" section when there are no mastery deltas', () => {
    renderFeedback({ result: incorrectResult });
    expect(screen.queryByText(/also moved/)).not.toBeInTheDocument();
  });

  it('renders each delta as a rounded box, not a full-radius pill', () => {
    // Grammar-point labels can be long, multi-line descriptions; a 999px pill
    // radius turns those into an oversized capsule that breaks the design feel.
    renderFeedback();
    const box = screen.getByText('ablative case').parentElement;
    expect(box?.className).toContain('rounded-md');
    expect(box?.className).not.toContain('rounded-pill');
  });
});

// ---------------------------------------------------------------------------
// Advance (Req 10.3)
// ---------------------------------------------------------------------------

describe('ReviewFeedback advance', () => {
  it('calls onNext when the CTA is clicked', () => {
    const onNext = vi.fn();
    renderFeedback({ onNext });
    fireEvent.click(screen.getByRole('button', { name: /next item/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('renders a custom nextLabel (e.g. last item)', () => {
    renderFeedback({ nextLabel: 'finish →' });
    expect(screen.getByRole('button', { name: /finish/i })).toBeInTheDocument();
  });

  it('advances on Enter (keyboard advance)', () => {
    const onNext = vi.fn();
    renderFeedback({ onNext });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('does not advance on other keys', () => {
    const onNext = vi.fn();
    renderFeedback({ onNext });
    fireEvent.keyDown(document, { key: 'a' });
    expect(onNext).not.toHaveBeenCalled();
  });

  it('removes the keydown listener on unmount', () => {
    const onNext = vi.fn();
    const { unmount } = renderFeedback({ onNext });
    unmount();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onNext).not.toHaveBeenCalled();
  });
});
