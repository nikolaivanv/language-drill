import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { createRef } from 'react';
import { Textarea } from '../textarea';

describe('Textarea', () => {
  it('renders a textarea element', () => {
    render(<Textarea data-testid="ta" />);
    expect(screen.getByTestId('ta').tagName).toBe('TEXTAREA');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('defaults to 4 rows', () => {
    render(<Textarea data-testid="ta" />);
    expect(screen.getByTestId('ta')).toHaveAttribute('rows', '4');
  });

  it('accepts custom rows', () => {
    render(<Textarea data-testid="ta" rows={8} />);
    expect(screen.getByTestId('ta')).toHaveAttribute('rows', '8');
  });

  it('applies resize-none class', () => {
    render(<Textarea data-testid="ta" />);
    expect(screen.getByTestId('ta').className).toContain('resize-none');
  });

  it('applies base classes', () => {
    render(<Textarea data-testid="ta" />);
    const el = screen.getByTestId('ta');
    expect(el.className).toContain('border-rule');
    expect(el.className).toContain('rounded-md');
    expect(el.className).toContain('bg-card');
  });

  it('merges custom className', () => {
    render(<Textarea data-testid="ta" className="mt-2" />);
    expect(screen.getByTestId('ta').className).toContain('mt-2');
  });
});
