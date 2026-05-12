import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalibrationStrip } from '../calibration-strip';

// ---------------------------------------------------------------------------
// CalibrationStrip — pure render of two strings + a no-op "adjust" button
// (Requirements 6.2, 6.11) plus the streaming/zero-flag variants added in
// task 37 (Requirements 5.3, 5.5, NFR Usability).
// ---------------------------------------------------------------------------

describe('CalibrationStrip', () => {
  it('renders the eyebrow inside a chip and the explanation alongside', () => {
    render(
      <CalibrationStrip
        eyebrow="~B1+ calibration"
        explanation="showing words rarer than top-3000 · refined by your known set"
      />,
    );
    expect(screen.getByText('~B1+ calibration')).toBeInTheDocument();
    expect(
      screen.getByText(
        'showing words rarer than top-3000 · refined by your known set',
      ),
    ).toBeInTheDocument();
  });

  it('renders the null-band fallback strings when calibration is unknown', () => {
    render(
      <CalibrationStrip
        eyebrow="your calibration"
        explanation="showing words above your current band"
      />,
    );
    expect(screen.getByText('your calibration')).toBeInTheDocument();
    expect(
      screen.getByText('showing words above your current band'),
    ).toBeInTheDocument();
  });

  it('renders the "adjust" ghost button as a no-op (no handler attached, no DOM mutation on click)', () => {
    const { container } = render(
      <CalibrationStrip eyebrow="x" explanation="y" />,
    );
    const adjust = screen.getByRole('button', { name: /adjust/i });
    const before = container.innerHTML;
    fireEvent.click(adjust);
    expect(container.innerHTML).toBe(before);
  });
});

describe('CalibrationStrip — streaming state', () => {
  it('renders mono progress text and a determinate progress bar', () => {
    render(
      <CalibrationStrip
        eyebrow="~B1+ calibration"
        explanation="should-not-render-while-streaming"
        streaming={{ flaggedCount: 2, candidateCount: 5 }}
      />,
    );
    expect(screen.getByText(/annotating · 2 \/ 5/)).toBeInTheDocument();
    // Eyebrow + explanation + adjust must be hidden while streaming.
    expect(screen.queryByText('~B1+ calibration')).not.toBeInTheDocument();
    expect(
      screen.queryByText('should-not-render-while-streaming'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /adjust/i }),
    ).not.toBeInTheDocument();

    const bar = screen.getByRole('progressbar');
    expect(bar).toBeInTheDocument();
    // The inner fill div carries the width style.
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe('40%');
  });

  it('handles candidateCount = 0 without dividing by zero', () => {
    render(
      <CalibrationStrip
        eyebrow="~B1+ calibration"
        explanation="x"
        streaming={{ flaggedCount: 0, candidateCount: 0 }}
      />,
    );
    const bar = screen.getByRole('progressbar');
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('0%');
    expect(screen.getByText(/annotating · 0 \/ 0/)).toBeInTheDocument();
  });

  it('uses aria-valuenow / aria-valuemax for screen readers', () => {
    render(
      <CalibrationStrip
        eyebrow="x"
        explanation="x"
        streaming={{ flaggedCount: 3, candidateCount: 7 }}
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '7');
    expect(bar).toHaveAttribute('aria-valuenow', '3');
  });
});

describe('CalibrationStrip — no above-level words suffix', () => {
  it('replaces the explanation with "· no above-level words" when noAboveLevelWords is true', () => {
    render(
      <CalibrationStrip
        eyebrow="~B1+ calibration"
        explanation="should-not-render"
        noAboveLevelWords
      />,
    );
    expect(screen.getByText('· no above-level words')).toBeInTheDocument();
    expect(screen.queryByText('should-not-render')).not.toBeInTheDocument();
  });

  it('keeps the eyebrow chip text unchanged', () => {
    render(
      <CalibrationStrip
        eyebrow="~B1+ calibration"
        explanation="ignored"
        noAboveLevelWords
      />,
    );
    expect(screen.getByText('~B1+ calibration')).toBeInTheDocument();
    // Adjust button still rendered in the completion state.
    expect(
      screen.getByRole('button', { name: /adjust/i }),
    ).toBeInTheDocument();
  });
});
