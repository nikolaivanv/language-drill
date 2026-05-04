import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import {
  AllDoneCard,
  PoolNotReadyCard,
  TimelineErrorCard,
} from '../state-cards';

describe('AllDoneCard', () => {
  it('renders the summary "5 of 5 · 18 minutes" and the fresh-session link', () => {
    render(
      <AllDoneCard
        summary={{ itemCount: 5, correctCount: 4, durationMinutes: 18 }}
        href="/drill?language=ES"
      />,
    );
    expect(screen.getByText('5 of 5 · 18 minutes')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /start a fresh session/ });
    expect(link).toHaveAttribute('href', '/drill?language=ES');
  });

  it('contains no streak / XP / lesson copy', () => {
    const { container } = render(
      <AllDoneCard
        summary={{ itemCount: 5, correctCount: 5, durationMinutes: 18 }}
        href="/drill?language=ES"
      />,
    );
    expect(container.textContent ?? '').not.toMatch(/streak|xp|lesson/i);
  });
});

describe('PoolNotReadyCard', () => {
  it('renders the language name lowercased (Spanish → spanish)', () => {
    render(<PoolNotReadyCard language={Language.ES} />);
    expect(
      screen.getByText(
        /your spanish pool isn't ready yet — check back tomorrow\./,
      ),
    ).toBeInTheDocument();
  });

  it('uses the German name when language is DE', () => {
    render(<PoolNotReadyCard language={Language.DE} />);
    expect(screen.getByText(/your german pool/)).toBeInTheDocument();
  });
});

describe('TimelineErrorCard', () => {
  it('renders the error message and calls onRetry when retry is clicked', () => {
    const onRetry = vi.fn();
    render(
      <TimelineErrorCard
        error={new Error('the network had a bad day')}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('the network had a bad day')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
