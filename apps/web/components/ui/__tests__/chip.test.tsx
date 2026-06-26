import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Chip } from '../chip';

describe('Chip', () => {
  it('renders children', () => {
    render(<Chip>B1</Chip>);
    expect(screen.getByText('B1')).toBeInTheDocument();
  });

  it('renders as a span', () => {
    render(<Chip>tag</Chip>);
    expect(screen.getByText('tag').tagName).toBe('SPAN');
  });

  it('applies default variant classes', () => {
    render(<Chip>tag</Chip>);
    const el = screen.getByText('tag');
    expect(el.className).toContain('bg-paper');
    expect(el.className).toContain('text-ink-soft');
    expect(el.className).toContain('border-rule');
  });

  it('applies solid variant classes', () => {
    render(<Chip variant="solid">tag</Chip>);
    const el = screen.getByText('tag');
    expect(el.className).toContain('bg-ink');
    expect(el.className).toContain('text-paper');
  });

  it('applies accent variant classes', () => {
    render(<Chip variant="accent">tag</Chip>);
    const el = screen.getByText('tag');
    expect(el.className).toContain('bg-accent-soft');
    expect(el.className).toContain('text-accent-2');
  });

  it('applies ok variant classes', () => {
    render(<Chip variant="ok">tag</Chip>);
    const el = screen.getByText('tag');
    expect(el.className).toContain('bg-ok-soft');
    expect(el.className).toContain('text-ok');
  });

  it('applies shared classes', () => {
    render(<Chip>tag</Chip>);
    const el = screen.getByText('tag');
    expect(el.className).toContain('rounded-pill');
    expect(el.className).toContain('text-[11px]');
    expect(el.className).toContain('font-medium');
  });

  it('merges custom className', () => {
    render(<Chip className="mt-2">tag</Chip>);
    expect(screen.getByText('tag').className).toContain('mt-2');
  });
});
