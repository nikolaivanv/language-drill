import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Bar } from '../bar';

describe('Bar', () => {
  it('renders track and fill elements', () => {
    render(<Bar value={50} />);
    const meter = screen.getByRole('meter');
    expect(meter).toBeInTheDocument();
    expect(meter.firstChild).toBeInTheDocument();
  });

  it('sets fill width based on value/max ratio', () => {
    render(<Bar value={75} max={100} />);
    const fill = screen.getByRole('meter').firstChild as HTMLElement;
    expect(fill.style.width).toBe('75%');
  });

  it('clamps fill at 100%', () => {
    render(<Bar value={150} max={100} />);
    const fill = screen.getByRole('meter').firstChild as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('uses custom max', () => {
    render(<Bar value={5} max={10} />);
    const fill = screen.getByRole('meter').firstChild as HTMLElement;
    expect(fill.style.width).toBe('50%');
  });

  it('applies default ink color', () => {
    render(<Bar value={50} />);
    const fill = screen.getByRole('meter').firstChild as HTMLElement;
    expect(fill.className).toContain('bg-ink');
  });

  it('applies accent color', () => {
    render(<Bar value={50} color="accent" />);
    const fill = screen.getByRole('meter').firstChild as HTMLElement;
    expect(fill.className).toContain('bg-accent');
  });

  it('applies ok color', () => {
    render(<Bar value={50} color="ok" />);
    const fill = screen.getByRole('meter').firstChild as HTMLElement;
    expect(fill.className).toContain('bg-ok');
  });

  it('has correct aria attributes', () => {
    render(<Bar value={30} max={50} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '30');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '50');
  });

  it('merges custom className on track', () => {
    render(<Bar value={50} className="mt-2" />);
    expect(screen.getByRole('meter').className).toContain('mt-2');
  });

  it('applies track classes', () => {
    render(<Bar value={50} />);
    const track = screen.getByRole('meter');
    expect(track.className).toContain('bg-paper-3');
    expect(track.className).toContain('rounded-r-pill');
    expect(track.className).toContain('h-[6px]');
  });
});
