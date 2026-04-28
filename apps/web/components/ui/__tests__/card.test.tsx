import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Card } from '../card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>content</Card>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('applies base classes', () => {
    render(<Card>content</Card>);
    const el = screen.getByText('content');
    expect(el.className).toContain('bg-card');
    expect(el.className).toContain('border-rule');
    expect(el.className).toContain('rounded-r-lg');
    expect(el.className).toContain('shadow-1');
  });

  it('applies md padding by default', () => {
    render(<Card>content</Card>);
    expect(screen.getByText('content').className).toContain('p-s-4');
  });

  it('applies none padding', () => {
    render(<Card padding="none">content</Card>);
    expect(screen.getByText('content').className).toContain('p-0');
  });

  it('applies sm padding', () => {
    render(<Card padding="sm">content</Card>);
    expect(screen.getByText('content').className).toContain('p-s-3');
  });

  it('applies lg padding', () => {
    render(<Card padding="lg">content</Card>);
    expect(screen.getByText('content').className).toContain('p-s-6');
  });

  it('merges custom className', () => {
    render(<Card className="mt-4">content</Card>);
    expect(screen.getByText('content').className).toContain('mt-4');
  });
});
