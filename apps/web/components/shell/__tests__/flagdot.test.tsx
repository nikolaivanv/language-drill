import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Language } from '@language-drill/shared';
import { Flagdot } from '../flagdot';

describe('Flagdot', () => {
  it('renders ES with terracotta accent color', () => {
    const { container } = render(<Flagdot language={Language.ES} />);
    const dot = container.querySelector('span');
    expect(dot?.className).toContain('bg-accent');
  });

  it('renders DE with dark brown color', () => {
    const { container } = render(<Flagdot language={Language.DE} />);
    const dot = container.querySelector('span');
    expect(dot?.className).toContain('bg-[#4b4138]');
  });

  it('renders TR with red color', () => {
    const { container } = render(<Flagdot language={Language.TR} />);
    const dot = container.querySelector('span');
    expect(dot?.className).toContain('bg-[#c01818]');
  });

  it('renders the lowercase 2-letter code as text content', () => {
    const { container } = render(<Flagdot language={Language.ES} />);
    expect(container.textContent).toBe('es');
  });

  it('has aria-hidden="true"', () => {
    const { container } = render(<Flagdot language={Language.ES} />);
    expect(container.querySelector('span')).toHaveAttribute('aria-hidden', 'true');
  });

  it('has font-mono class', () => {
    const { container } = render(<Flagdot language={Language.DE} />);
    expect(container.querySelector('span')?.className).toContain('font-mono');
  });

  it('merges custom className', () => {
    const { container } = render(
      <Flagdot language={Language.TR} className="ml-2" />
    );
    expect(container.querySelector('span')?.className).toContain('ml-2');
  });

  it('applies sizing classes', () => {
    const { container } = render(<Flagdot language={Language.ES} />);
    const cls = container.querySelector('span')?.className ?? '';
    expect(cls).toContain('w-[24px]');
    expect(cls).toContain('h-[24px]');
    expect(cls).toContain('rounded-full');
  });
});
