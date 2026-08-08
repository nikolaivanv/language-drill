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

  describe('answer variant', () => {
    it('sets the learner sentence in the display serif scale', () => {
      render(<Textarea data-testid="ta" variant="answer" />);
      expect(screen.getByTestId('ta').className).toContain('t-answer');
    });

    it('does not emit the sans body size that would compete with it', () => {
      // `cn()` has no tailwind-merge: if both sizes were emitted, which one
      // won would depend on stylesheet order rather than on the variant.
      render(<Textarea data-testid="ta" variant="answer" />);
      expect(screen.getByTestId('ta').className).not.toContain('text-[14px]');
    });

    it('defaults to 3 rows because its lines are taller', () => {
      render(<Textarea data-testid="ta" variant="answer" />);
      expect(screen.getByTestId('ta')).toHaveAttribute('rows', '3');
    });

    it('still honours an explicit rows override', () => {
      render(<Textarea data-testid="ta" variant="answer" rows={6} />);
      expect(screen.getByTestId('ta')).toHaveAttribute('rows', '6');
    });

    it('leaves the default variant on the sans body size', () => {
      render(<Textarea data-testid="ta" />);
      const el = screen.getByTestId('ta');
      expect(el.className).toContain('text-[14px]');
      expect(el.className).not.toContain('t-answer');
    });
  });
});
