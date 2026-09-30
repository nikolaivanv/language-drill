import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PointPicker } from '../_components/point-picker';

const POINTS = [
  { key: 'es-b1-conditional', name: 'Conditional', category: 'tenses', order: 1, count: 12 },
  { key: 'es-b1-futuro-simple', name: 'Simple future', category: 'tenses', order: 2, count: 9 },
  {
    key: 'es-b1-present-subjunctive',
    name: 'Present subjunctive',
    category: 'moods',
    order: 3,
    count: 52,
  },
];

function setup(props: Partial<React.ComponentProps<typeof PointPicker>> = {}) {
  render(<PointPicker lang="ES" level="B1" points={POINTS} {...props} />);
}

describe('PointPicker', () => {
  it('names the mixed set when no point is selected', () => {
    setup();
    expect(screen.getByText(/Everything at B1/)).toBeInTheDocument();
  });

  it('names the selected point instead', () => {
    setup({ activePoint: 'es-b1-present-subjunctive' });
    expect(screen.getByText('Present subjunctive')).toBeInTheDocument();
    expect(screen.queryByText(/Everything at B1/)).not.toBeInTheDocument();
  });

  it('stays collapsed until asked — the drill is the page, not the picker', () => {
    setup();
    expect(screen.queryByRole('link', { name: /Conditional/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose a topic/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('groups points by category when opened, keeping server order within a group', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /choose a topic/i }));

    expect(screen.getByText('Tenses')).toBeInTheDocument();
    expect(screen.getByText('Moods')).toBeInTheDocument();

    const links = screen.getAllByRole('link').map((l) => l.textContent ?? '');
    const conditional = links.findIndex((t) => t.includes('Conditional'));
    const future = links.findIndex((t) => t.includes('Simple future'));
    expect(conditional).toBeLessThan(future);
  });

  it('links each point with its own key and shows how much content it has', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /choose a topic/i }));

    const link = screen.getByRole('link', { name: /Conditional/ });
    expect(link).toHaveAttribute('href', '/try/forms?lang=ES&level=B1&point=es-b1-conditional');
    expect(within(link).getByText('12')).toBeInTheDocument();
  });

  it('offers a route back to the mixed set, marked current when active', async () => {
    setup({ activePoint: 'es-b1-conditional' });
    await userEvent.click(screen.getByRole('button', { name: /choose a topic/i }));

    const mixed = screen.getByRole('link', { name: /Everything at B1/ });
    expect(mixed).toHaveAttribute('href', '/try/forms?lang=ES&level=B1');
    expect(mixed).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /Conditional/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('offers no picker at all when the cell has no points', () => {
    setup({ points: [] });
    expect(screen.queryByRole('button', { name: /choose a topic/i })).not.toBeInTheDocument();
  });
});
