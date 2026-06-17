import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel } from '@language-drill/shared';

// DrillTodayStatus pulls today data; stub it so the hub renders in isolation.
vi.mock('../drill-today-status', () => ({
  DrillTodayStatus: () => <div data-testid="today-status" />,
}));

import { DrillHub } from '../drill-hub';

function setup(overrides: Partial<React.ComponentProps<typeof DrillHub>> = {}) {
  const onStartQuick = vi.fn();
  const onStartDictation = vi.fn();
  const onDifficultyChange = vi.fn();
  render(
    <DrillHub
      difficulty={CefrLevel.B1}
      baseline={CefrLevel.B1}
      onDifficultyChange={onDifficultyChange}
      onStartQuick={onStartQuick}
      onStartDictation={onStartDictation}
      {...overrides}
    />,
  );
  return { onStartQuick, onStartDictation, onDifficultyChange };
}

describe('DrillHub', () => {
  it('renders the today-status strip and the launchers', () => {
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
  });

  it('fires onStartQuick / onStartDictation when the launchers are clicked', () => {
    const { onStartQuick, onStartDictation } = setup();
    fireEvent.click(screen.getByRole('button', { name: /quick drill/i }));
    fireEvent.click(screen.getByRole('button', { name: /dictation/i }));
    expect(onStartQuick).toHaveBeenCalledTimes(1);
    expect(onStartDictation).toHaveBeenCalledTimes(1);
  });

  it('fires onDifficultyChange when the drill-level select changes', () => {
    const { onDifficultyChange } = setup();
    fireEvent.change(screen.getByLabelText(/drill level/i), {
      target: { value: 'A2' },
    });
    expect(onDifficultyChange).toHaveBeenCalledWith('A2');
  });
});
