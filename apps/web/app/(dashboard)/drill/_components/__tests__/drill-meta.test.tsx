import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel } from '@language-drill/shared';

import { DrillMeta } from '../drill-meta';

function setup(overrides: Partial<React.ComponentProps<typeof DrillMeta>> = {}) {
  const onLevelChange = vi.fn();
  render(
    <DrillMeta
      level={CefrLevel.A1}
      baseline={CefrLevel.A1}
      onLevelChange={onLevelChange}
      {...overrides}
    />,
  );
  return { onLevelChange };
}

describe('DrillMeta', () => {
  it('renders the level pill labelled "drill level"', () => {
    setup();
    const select = screen.getByLabelText(/drill level/i);
    expect(select).toHaveValue('A1');
  });

  it('fires onLevelChange when the level pill changes', () => {
    const { onLevelChange } = setup();
    fireEvent.change(screen.getByLabelText(/drill level/i), {
      target: { value: 'B1' },
    });
    expect(onLevelChange).toHaveBeenCalledWith('B1');
  });

  it('hides the drift signal when the level matches the baseline', () => {
    setup({ level: CefrLevel.A1, baseline: CefrLevel.A1 });
    expect(screen.queryByText(/baseline/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reset/i }),
    ).not.toBeInTheDocument();
  });

  it('shows an "above" drift signal when the level is over the baseline', () => {
    setup({ level: CefrLevel.B2, baseline: CefrLevel.A1 });
    expect(screen.getByText(/above your A1 baseline/i)).toBeInTheDocument();
  });

  it('shows a "below" drift signal when the level is under the baseline', () => {
    setup({ level: CefrLevel.A1, baseline: CefrLevel.B2 });
    expect(screen.getByText(/below your B2 baseline/i)).toBeInTheDocument();
  });

  it('reset returns the level to the baseline', () => {
    const { onLevelChange } = setup({
      level: CefrLevel.C1,
      baseline: CefrLevel.A2,
    });
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(onLevelChange).toHaveBeenCalledWith(CefrLevel.A2);
  });

  it('never shows drift when the baseline is unknown (null)', () => {
    setup({ level: CefrLevel.C2, baseline: null });
    expect(screen.queryByText(/baseline/i)).not.toBeInTheDocument();
  });

  it('renders an inline topic slot when provided', () => {
    setup({ topic: <span>theory · vowel harmony</span> });
    expect(screen.getByText(/vowel harmony/i)).toBeInTheDocument();
  });
});
