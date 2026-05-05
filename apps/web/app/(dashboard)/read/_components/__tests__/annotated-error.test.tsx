import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotatedError } from '../annotated-error';

// ---------------------------------------------------------------------------
// AnnotatedError — body + buttons, rate-limit disable rule.
// (Requirements 11.2, 11.3, 11.4)
// ---------------------------------------------------------------------------

const baseProps = {
  body: 'evaluation temporarily unavailable — try again in a moment.',
  kind: 'aiUnavailable' as const,
  onEditText: () => {},
  onTryAgain: () => {},
};

describe('AnnotatedError', () => {
  it('renders the heading and the server-supplied body', () => {
    render(<AnnotatedError {...baseProps} />);
    expect(screen.getByText("couldn't annotate this")).toBeInTheDocument();
    expect(
      screen.getByText(/evaluation temporarily unavailable/i),
    ).toBeInTheDocument();
  });

  it('renders both ghost buttons; "try again" is enabled for non-rate-limit kinds', () => {
    render(<AnnotatedError {...baseProps} />);
    const edit = screen.getByRole('button', { name: /edit text/i });
    const retry = screen.getByRole('button', { name: /try again/i });
    expect(edit).toBeEnabled();
    expect(retry).toBeEnabled();
  });

  it('disables "try again" when kind === "rateLimit" (Requirement 11.4)', () => {
    render(
      <AnnotatedError
        {...baseProps}
        kind="rateLimit"
        body="you've hit today's evaluation limit (50). it resets daily."
      />,
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeDisabled();
    // "edit text" is always available — error states never dead-end the user.
    expect(screen.getByRole('button', { name: /edit text/i })).toBeEnabled();
  });

  it('clicking "edit text" fires onEditText', () => {
    const onEditText = vi.fn();
    render(<AnnotatedError {...baseProps} onEditText={onEditText} />);
    fireEvent.click(screen.getByRole('button', { name: /edit text/i }));
    expect(onEditText).toHaveBeenCalledTimes(1);
  });

  it('clicking "try again" fires onTryAgain when enabled', () => {
    const onTryAgain = vi.fn();
    render(<AnnotatedError {...baseProps} onTryAgain={onTryAgain} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it('does not fire onTryAgain when disabled (rateLimit)', () => {
    const onTryAgain = vi.fn();
    render(
      <AnnotatedError
        {...baseProps}
        kind="rateLimit"
        onTryAgain={onTryAgain}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onTryAgain).not.toHaveBeenCalled();
  });
});
