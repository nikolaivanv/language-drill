import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DrillActionBar } from '../drill-action-bar';
import {
  DrillActionProvider,
  useDrillAction,
  type DrillPrimaryAction,
  type DrillActionMeta,
} from '../drill-action-context';

// Publishes the action/meta into the context the way a real exercise does.
function Publisher({
  action,
  meta,
}: {
  action: DrillPrimaryAction | null;
  meta: DrillActionMeta | null;
}) {
  const { setPrimaryAction, setMeta } = useDrillAction();
  useEffect(() => {
    setPrimaryAction(action);
    setMeta(meta);
  }, [setPrimaryAction, setMeta, action, meta]);
  return null;
}

function renderBar(
  action: DrillPrimaryAction | null,
  meta: DrillActionMeta | null = { current: 2, total: 5 },
) {
  return render(
    <DrillActionProvider active>
      <Publisher action={action} meta={meta} />
      <DrillActionBar />
    </DrillActionProvider>,
  );
}

describe('DrillActionBar', () => {
  it('shows the progress meta and the published primary action', () => {
    const onClick = vi.fn();
    renderBar({ label: 'submit', onClick });

    expect(screen.getByText('item 2 of 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a disabled placeholder when no action is published', () => {
    renderBar(null, null);
    const button = screen.getByRole('button', { name: 'waiting' });
    expect(button).toBeDisabled();
  });

  it('maps the disabled state through to the button', () => {
    renderBar({ label: 'submit', onClick: vi.fn(), disabled: true });
    expect(screen.getByRole('button', { name: 'submit' })).toBeDisabled();
  });

  it('maps the loading state through to the button', () => {
    // When loading, Button swaps its label for a spinner — query the sole
    // button in the bar and assert aria-busy.
    renderBar({ label: 'submit', onClick: vi.fn(), loading: true });
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });
});
