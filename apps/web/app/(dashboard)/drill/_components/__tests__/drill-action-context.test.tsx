import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DrillActionProvider,
  useDrillAction,
  type DrillPrimaryAction,
} from '../drill-action-context';

function Probe({ action }: { action?: DrillPrimaryAction }) {
  const { active, primaryAction, setPrimaryAction, meta, setMeta } =
    useDrillAction();
  return (
    <div>
      <span data-testid="active">{String(active)}</span>
      <span data-testid="label">{primaryAction?.label ?? 'none'}</span>
      <span data-testid="meta">
        {meta ? `${meta.current}/${meta.total}` : 'none'}
      </span>
      <button
        onClick={() =>
          setPrimaryAction(action ?? { label: 'submit', onClick: vi.fn() })
        }
      >
        publish
      </button>
      <button onClick={() => setMeta({ current: 2, total: 5 })}>set-meta</button>
    </div>
  );
}

describe('DrillActionContext', () => {
  it('exposes active and lets consumers publish/update the action and meta', () => {
    render(
      <DrillActionProvider active>
        <Probe />
      </DrillActionProvider>,
    );

    expect(screen.getByTestId('active')).toHaveTextContent('true');
    expect(screen.getByTestId('label')).toHaveTextContent('none');
    expect(screen.getByTestId('meta')).toHaveTextContent('none');

    fireEvent.click(screen.getByRole('button', { name: 'publish' }));
    expect(screen.getByTestId('label')).toHaveTextContent('submit');

    fireEvent.click(screen.getByRole('button', { name: 'set-meta' }));
    expect(screen.getByTestId('meta')).toHaveTextContent('2/5');
  });

  it('reports active=false from the provider when given active={false}', () => {
    render(
      <DrillActionProvider active={false}>
        <Probe />
      </DrillActionProvider>,
    );
    expect(screen.getByTestId('active')).toHaveTextContent('false');
  });

  it('returns an inert default with no-op setters when used outside a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('active')).toHaveTextContent('false');

    // Calling the no-op setters must not throw and must not change anything.
    fireEvent.click(screen.getByRole('button', { name: 'publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'set-meta' }));
    expect(screen.getByTestId('label')).toHaveTextContent('none');
    expect(screen.getByTestId('meta')).toHaveTextContent('none');
  });
});
