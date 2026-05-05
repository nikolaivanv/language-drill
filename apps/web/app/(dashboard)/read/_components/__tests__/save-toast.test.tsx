import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SaveToast } from '../save-toast';

// ---------------------------------------------------------------------------
// SaveToast — count + callbacks + a11y (Requirements 8.2, 14.4).
// ---------------------------------------------------------------------------

describe('SaveToast', () => {
  it('renders the body with the word count and the secondary line', () => {
    render(
      <SaveToast count={3} onSeeNextSession={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByText(/3 words added/)).toBeInTheDocument();
    expect(screen.getByText(/to your bank\./)).toBeInTheDocument();
    expect(
      screen.getByText(/your next session will weave them in/),
    ).toBeInTheDocument();
  });

  it('uses the singular "1 word" form when count is 1', () => {
    render(
      <SaveToast count={1} onSeeNextSession={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByText(/1 word added/)).toBeInTheDocument();
    expect(screen.queryByText(/words added/)).not.toBeInTheDocument();
  });

  it('declares role="status" and aria-live="polite" so screen readers pick it up (Req 14.4)', () => {
    render(
      <SaveToast count={2} onSeeNextSession={() => {}} onDismiss={() => {}} />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('clicking "see next session" fires onSeeNextSession', () => {
    const onSeeNextSession = vi.fn();
    render(
      <SaveToast
        count={2}
        onSeeNextSession={onSeeNextSession}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /see next session/i }),
    );
    expect(onSeeNextSession).toHaveBeenCalledTimes(1);
  });

  it('clicking the × dismiss fires onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <SaveToast
        count={2}
        onSeeNextSession={() => {}}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
