import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Checkbox } from '../checkbox';

describe('Checkbox', () => {
  it('renders with role="checkbox"', () => {
    render(<Checkbox checked={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('reflects aria-checked when checked', () => {
    render(<Checkbox checked={true} onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('reflects aria-checked when unchecked', () => {
    render(<Checkbox checked={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('calls onChange with toggled value when clicked unchecked', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange with toggled value when clicked checked', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('shows checkmark SVG when checked', () => {
    const { container } = render(
      <Checkbox checked={true} onChange={() => {}} />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('does not show checkmark when unchecked', () => {
    const { container } = render(
      <Checkbox checked={false} onChange={() => {}} />
    );
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('has 32px min tap target', () => {
    render(<Checkbox checked={false} onChange={() => {}} />);
    const el = screen.getByRole('checkbox');
    expect(el.className).toContain('min-w-[32px]');
    expect(el.className).toContain('min-h-[32px]');
  });

  it('merges custom className', () => {
    render(<Checkbox checked={false} onChange={() => {}} className="ml-2" />);
    expect(screen.getByRole('checkbox').className).toContain('ml-2');
  });
});
