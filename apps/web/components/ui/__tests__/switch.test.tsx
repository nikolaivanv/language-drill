import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from '../switch';

describe('Switch', () => {
  it('renders a switch reflecting checked state and toggles on click', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} aria-label="gentle nudges" />);
    const sw = screen.getByRole('switch', { name: 'gentle nudges' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
