import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubmissionErrorCard } from '../submission-error-card';

const rateLimitError = new Error('Request failed with status 429');
const fiveXxError = new Error('Evaluation temporarily unavailable (502)');

describe('SubmissionErrorCard', () => {
  describe('rate-limit message', () => {
    it('renders the rate-limit copy when error message contains "429"', () => {
      render(<SubmissionErrorCard error={rateLimitError} onRetry={vi.fn()} />);
      expect(
        screen.getByText("You've reached your daily practice limit. Come back tomorrow!"),
      ).toBeInTheDocument();
    });

    it('also matches a "rate limit" message regardless of casing', () => {
      render(
        <SubmissionErrorCard
          error={new Error('Rate Limit exceeded')}
          onRetry={vi.fn()}
        />,
      );
      expect(
        screen.getByText("You've reached your daily practice limit. Come back tomorrow!"),
      ).toBeInTheDocument();
    });

    it('renders only "try again" when no extra callbacks provided', () => {
      render(<SubmissionErrorCard error={rateLimitError} onRetry={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'try again' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'end session early' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'skip item' })).not.toBeInTheDocument();
    });

    it('renders "end session early" when onEndSession provided', () => {
      render(
        <SubmissionErrorCard
          error={rateLimitError}
          onRetry={vi.fn()}
          onEndSession={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: 'end session early' })).toBeInTheDocument();
    });

    it('does NOT render "skip item" on rate-limit even when onSkip provided', () => {
      render(
        <SubmissionErrorCard
          error={rateLimitError}
          onRetry={vi.fn()}
          onSkip={vi.fn()}
        />,
      );
      expect(screen.queryByRole('button', { name: 'skip item' })).not.toBeInTheDocument();
    });
  });

  describe('non-rate-limit message', () => {
    it('renders the failure copy with the underlying error message', () => {
      render(<SubmissionErrorCard error={fiveXxError} onRetry={vi.fn()} />);
      expect(
        screen.getByText(`Failed to submit answer: ${fiveXxError.message}`),
      ).toBeInTheDocument();
    });

    it('renders "skip item" when onSkip provided', () => {
      render(
        <SubmissionErrorCard
          error={fiveXxError}
          onRetry={vi.fn()}
          onSkip={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: 'skip item' })).toBeInTheDocument();
    });

    it('does NOT render "end session early" on non-rate-limit even when onEndSession provided', () => {
      render(
        <SubmissionErrorCard
          error={fiveXxError}
          onRetry={vi.fn()}
          onEndSession={vi.fn()}
        />,
      );
      expect(screen.queryByRole('button', { name: 'end session early' })).not.toBeInTheDocument();
    });
  });

  describe('callback wiring', () => {
    it('"try again" calls onRetry', () => {
      const onRetry = vi.fn();
      render(<SubmissionErrorCard error={fiveXxError} onRetry={onRetry} />);
      fireEvent.click(screen.getByRole('button', { name: 'try again' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('"skip item" calls onSkip', () => {
      const onSkip = vi.fn();
      render(
        <SubmissionErrorCard error={fiveXxError} onRetry={vi.fn()} onSkip={onSkip} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'skip item' }));
      expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it('"end session early" calls onEndSession', () => {
      const onEndSession = vi.fn();
      render(
        <SubmissionErrorCard
          error={rateLimitError}
          onRetry={vi.fn()}
          onEndSession={onEndSession}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'end session early' }));
      expect(onEndSession).toHaveBeenCalledTimes(1);
    });
  });
});
