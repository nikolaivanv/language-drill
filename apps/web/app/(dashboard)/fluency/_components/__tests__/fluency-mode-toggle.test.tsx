import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluencyModeToggle } from '../fluency-mode-toggle';

describe('FluencyModeToggle', () => {
  it('renders both modes and marks the active one selected', () => {
    render(<FluencyModeToggle mode="conjugation" onSelect={() => {}} />);
    const all = screen.getByRole('tab', { name: 'all' });
    const conj = screen.getByRole('tab', { name: 'conjugation' });
    expect(all).toHaveAttribute('aria-selected', 'false');
    expect(conj).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onSelect with the clicked mode', () => {
    const onSelect = vi.fn();
    render(<FluencyModeToggle mode="all" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: 'conjugation' }));
    expect(onSelect).toHaveBeenCalledWith('conjugation');
  });
});
