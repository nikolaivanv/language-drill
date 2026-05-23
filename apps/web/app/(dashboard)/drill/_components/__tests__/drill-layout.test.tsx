import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DrillLayout } from '../drill-layout';

// Default to desktop (false) so the existing assertions below — which expect
// the side rail — keep passing. The mobile suite flips this per-test.
const mockIsMobile = vi.fn(() => false);
vi.mock('../../../../../lib/responsive', () => ({
  useIsMobile: () => mockIsMobile(),
}));

beforeEach(() => {
  mockIsMobile.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DrillLayout', () => {
  // ---- Slot rendering -----------------------------------------------------

  it('renders both rail and main slots', () => {
    render(
      <DrillLayout
        rail={<div data-testid="rail-slot" />}
        main={<div data-testid="main-slot" />}
      />
    );

    expect(screen.getByTestId('rail-slot')).toBeInTheDocument();
    expect(screen.getByTestId('main-slot')).toBeInTheDocument();
  });

  // ---- Progress strip ARIA ------------------------------------------------

  it('sets correct ARIA attributes on the progress strip when fraction is 0', () => {
    render(
      <DrillLayout
        rail={<div data-testid="rail-slot" />}
        main={<div data-testid="main-slot" />}
        progressFraction={0}
      />
    );

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '0');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
  });

  // ---- Progress strip width values ----------------------------------------

  it('renders fill at 50% width when progressFraction is 0.5', () => {
    render(
      <DrillLayout
        rail={<div data-testid="rail-slot" />}
        main={<div data-testid="main-slot" />}
        progressFraction={0.5}
      />
    );

    const fill = screen.getByRole('progressbar').firstElementChild;
    expect(fill).toHaveStyle({ width: '50%' });
  });

  it('renders fill at 100% width when progressFraction is 1', () => {
    render(
      <DrillLayout
        rail={<div data-testid="rail-slot" />}
        main={<div data-testid="main-slot" />}
        progressFraction={1}
      />
    );

    const fill = screen.getByRole('progressbar').firstElementChild;
    expect(fill).toHaveStyle({ width: '100%' });
  });

  // ---- Progress strip clamping --------------------------------------------

  it('clamps fill width to 100% when progressFraction exceeds 1', () => {
    render(
      <DrillLayout
        rail={<div data-testid="rail-slot" />}
        main={<div data-testid="main-slot" />}
        progressFraction={2}
      />
    );

    const fill = screen.getByRole('progressbar').firstElementChild;
    expect(fill).toHaveStyle({ width: '100%' });
  });

  it('clamps fill width to 0% when progressFraction is below 0', () => {
    render(
      <DrillLayout
        rail={<div data-testid="rail-slot" />}
        main={<div data-testid="main-slot" />}
        progressFraction={-0.5}
      />
    );

    const fill = screen.getByRole('progressbar').firstElementChild;
    expect(fill).toHaveStyle({ width: '0%' });
  });

  // ---- progressFraction default ------------------------------------------

  it('defaults progressFraction to 0 when omitted', () => {
    render(
      <DrillLayout
        rail={<div data-testid="rail-slot" />}
        main={<div data-testid="main-slot" />}
      />
    );

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '0');
  });

  // ---- Loading state ------------------------------------------------------

  it('shows the loading skeleton and hides the main slot when isLoading is true', () => {
    const { container } = render(
      <DrillLayout
        rail={<div data-testid="rail-slot" />}
        main={<div data-testid="main-slot" />}
        isLoading
      />
    );

    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).toBeInTheDocument();
    expect(screen.queryByTestId('main-slot')).not.toBeInTheDocument();
  });

  it('still renders the rail slot when isLoading is true', () => {
    render(
      <DrillLayout
        rail={<div data-testid="rail-slot" />}
        main={<div data-testid="main-slot" />}
        isLoading
      />
    );

    expect(screen.getByTestId('rail-slot')).toBeInTheDocument();
  });

  // ---- isLoading default --------------------------------------------------

  it('defaults isLoading to false and renders the main slot when omitted', () => {
    render(
      <DrillLayout
        rail={<div data-testid="rail-slot" />}
        main={<div data-testid="main-slot" />}
      />
    );

    expect(screen.getByTestId('main-slot')).toBeInTheDocument();
  });

  // ---- Mobile branch ------------------------------------------------------

  describe('mobile', () => {
    beforeEach(() => {
      mockIsMobile.mockReturnValue(true);
    });

    it('renders main + the action-bar slot and omits the side rail', () => {
      render(
        <DrillLayout
          rail={<div data-testid="rail-slot" />}
          main={<div data-testid="main-slot" />}
          actionBar={<div data-testid="action-bar-slot" />}
        />
      );

      expect(screen.getByTestId('main-slot')).toBeInTheDocument();
      expect(screen.getByTestId('action-bar-slot')).toBeInTheDocument();
      expect(screen.queryByTestId('rail-slot')).not.toBeInTheDocument();
    });

    it('keeps the top progress strip on mobile', () => {
      render(
        <DrillLayout
          rail={null}
          main={<div data-testid="main-slot" />}
          progressFraction={0.5}
        />
      );
      const fill = screen.getByRole('progressbar').firstElementChild;
      expect(fill).toHaveStyle({ width: '50%' });
    });
  });

  it('renders the side rail (not the action bar) on desktop', () => {
    render(
      <DrillLayout
        rail={<div data-testid="rail-slot" />}
        main={<div data-testid="main-slot" />}
        actionBar={<div data-testid="action-bar-slot" />}
      />
    );
    expect(screen.getByTestId('rail-slot')).toBeInTheDocument();
    expect(screen.queryByTestId('action-bar-slot')).not.toBeInTheDocument();
  });
});
