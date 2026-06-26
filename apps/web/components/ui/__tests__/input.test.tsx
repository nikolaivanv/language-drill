import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { Input } from '../input';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input placeholder="type here" />);
    expect(screen.getByPlaceholderText('type here')).toBeInTheDocument();
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('applies base classes', () => {
    render(<Input data-testid="input" />);
    const el = screen.getByTestId('input');
    expect(el.className).toContain('border-rule');
    expect(el.className).toContain('rounded-md');
    expect(el.className).toContain('bg-card');
  });

  it('merges custom className', () => {
    render(<Input data-testid="input" className="mt-4" />);
    expect(screen.getByTestId('input').className).toContain('mt-4');
  });

  it('passes through HTML attributes', () => {
    render(<Input type="email" disabled placeholder="email" />);
    const el = screen.getByPlaceholderText('email');
    expect(el).toHaveAttribute('type', 'email');
    expect(el).toBeDisabled();
  });

  it('handles onChange', () => {
    const onChange = vi.fn();
    render(<Input data-testid="input" onChange={onChange} />);
    fireEvent.change(screen.getByTestId('input'), { target: { value: 'hi' } });
    expect(onChange).toHaveBeenCalled();
  });
});
