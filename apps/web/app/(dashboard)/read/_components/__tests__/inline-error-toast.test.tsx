import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineErrorToast } from '../inline-error-toast';

// ---------------------------------------------------------------------------
// InlineErrorToast — kind-driven copy + a11y (Requirement 11.6).
// ---------------------------------------------------------------------------

describe('InlineErrorToast', () => {
  it('renders "couldn\'t save — try again" for kind="save"', () => {
    render(<InlineErrorToast kind="save" onDismiss={() => {}} />);
    expect(
      screen.getByText("couldn't save — try again"),
    ).toBeInTheDocument();
  });

  it('renders "couldn\'t update — try again" for kind="bank"', () => {
    render(<InlineErrorToast kind="bank" onDismiss={() => {}} />);
    expect(
      screen.getByText("couldn't update — try again"),
    ).toBeInTheDocument();
  });

  it('declares role="status" and aria-live="polite"', () => {
    render(<InlineErrorToast kind="bank" onDismiss={() => {}} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('clicking the × dismiss fires onDismiss', () => {
    const onDismiss = vi.fn();
    render(<InlineErrorToast kind="bank" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
