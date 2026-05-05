import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalibrationStrip } from '../calibration-strip';

// ---------------------------------------------------------------------------
// CalibrationStrip — pure render of two strings + a no-op "adjust" button
// (Requirements 6.2, 6.11).
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
