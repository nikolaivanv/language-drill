import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { InsightsErrorTheme } from '@language-drill/api-client';

// DrillTodayStatus pulls today data; stub it so the hub renders in isolation.
vi.mock('../drill-today-status', () => ({
  DrillTodayStatus: () => <div data-testid="today-status" />,
}));

import { DrillHub } from '../drill-hub';

function theme(over: Partial<InsightsErrorTheme> = {}): InsightsErrorTheme {
  return {
    grammarPointKey: 'tr-a1-accusative',
    grammarPointName: 'Accusative -(y)I',
    errorType: 'morphology',
    count: 8,
    majorCount: 3,
    lastOccurredAt: new Date().toISOString(),
    score: 0.75,
    sample: { wrongText: 'bulaşık', correction: 'bulaşıkları' },
    ...over,
  };
}

function setup(overrides: Partial<React.ComponentProps<typeof DrillHub>> = {}) {
  const onStartQuick = vi.fn();
  const onStartDictation = vi.fn();
  const onStartTargeted = vi.fn();
  render(
    <DrillHub
      onStartQuick={onStartQuick}
      onStartDictation={onStartDictation}
      themes={[]}
      onStartTargeted={onStartTargeted}
      {...overrides}
    />,
  );
  return { onStartQuick, onStartDictation, onStartTargeted };
}

describe('DrillHub', () => {
  it('renders the today-status strip and all five drill-type cards', () => {
    setup();
    expect(screen.getByTestId('today-status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quick drill/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dictation/i })).toBeInTheDocument();
    // Free writing is a link to the standalone flow.
    const fw = screen.getByRole('link', { name: /free writing/i });
    expect(fw).toHaveAttribute('href', '/drill/free-writing');
    // Conjugation is an opt-in standalone warm-up.
    const conj = screen.getByRole('link', { name: /conjugation/i });
    expect(conj).toHaveAttribute('href', '/drill/conjugation');
    // Fluency is a timed drill hub.
    const fluency = screen.getByRole('link', { name: /fluency/i });
    expect(fluency).toHaveAttribute('href', '/fluency');
  });

  it('features the quick drill as the dark "today\'s drill" card', () => {
    setup();
    const quick = screen.getByRole('button', { name: /quick drill/i });
    // Featured card is the ink-filled surface...
    expect(quick.className).toContain('bg-ink');
    // ...carrying the "today's drill" eyebrow tag.
    expect(screen.getByText(/today's drill/i)).toBeInTheDocument();
  });

  it('fires onStartQuick / onStartDictation when those cards are clicked', () => {
    const { onStartQuick, onStartDictation } = setup();
    fireEvent.click(screen.getByRole('button', { name: /quick drill/i }));
    fireEvent.click(screen.getByRole('button', { name: /dictation/i }));
    expect(onStartQuick).toHaveBeenCalledTimes(1);
    expect(onStartDictation).toHaveBeenCalledTimes(1);
  });

  it('gives normal cards a resting rule border that strengthens (no terracotta) on hover', () => {
    setup();
    const fw = screen.getByRole('link', { name: /free writing/i });
    // Resting border is the neutral rule; hover strengthens it + lifts the card.
    // No permanent or hover terracotta border.
    expect(fw.className).toContain('border-rule');
    expect(fw.className).toContain('hover:border-rule-strong');
    expect(fw.className).not.toContain('border-accent');
  });

  it('renders weak spots + a link to /progress, and fires onStartTargeted on tap', () => {
    const onStartTargeted = vi.fn();
    setup({ themes: [theme()], onStartTargeted });
    // the map link
    expect(
      screen.getByRole('link', { name: /full map|progress/i }).getAttribute('href'),
    ).toBe('/progress');
    // tapping the weak spot starts a targeted drill
    fireEvent.click(screen.getByRole('button', { name: /Accusative/ }));
    expect(onStartTargeted).toHaveBeenCalledWith('tr-a1-accusative');
    // mode cards still present
    expect(screen.getByRole('button', { name: /quick drill/i })).toBeInTheDocument();
  });

  it('hides the weak-spot section + map link when there are no themes', () => {
    setup({ themes: [], onStartTargeted: vi.fn() });
    expect(screen.queryByRole('link', { name: /full map|progress/i })).toBeNull();
    expect(screen.getByRole('button', { name: /quick drill/i })).toBeInTheDocument();
  });
});
