import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Choice } from '../choice';

describe('Choice', () => {
  it('renders children', () => {
    render(
      <Choice selected={false} onSelect={() => {}}>
        español
      </Choice>
    );
    expect(screen.getByText('español')).toBeInTheDocument();
  });

  it('defaults to radio mode with role="radio"', () => {
    render(
      <Choice selected={false} onSelect={() => {}}>
        option
      </Choice>
    );
    expect(screen.getByRole('radio')).toBeInTheDocument();
  });

  it('renders with checkbox role when mode="checkbox"', () => {
    render(
      <Choice selected={false} onSelect={() => {}} mode="checkbox">
        option
      </Choice>
    );
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('reflects aria-checked when selected', () => {
    render(
      <Choice selected={true} onSelect={() => {}}>
        option
      </Choice>
    );
    expect(screen.getByRole('radio')).toHaveAttribute('aria-checked', 'true');
  });

  it('reflects aria-checked when not selected', () => {
    render(
      <Choice selected={false} onSelect={() => {}}>
        option
      </Choice>
    );
    expect(screen.getByRole('radio')).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onSelect on click', () => {
    const onSelect = vi.fn();
    render(
      <Choice selected={false} onSelect={onSelect}>
        option
      </Choice>
    );
    fireEvent.click(screen.getByRole('radio'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('applies selected state classes', () => {
    render(
      <Choice selected={true} onSelect={() => {}}>
        option
      </Choice>
    );
    const el = screen.getByRole('radio');
    expect(el.className).toContain('border-ink');
    expect(el.className).toContain('bg-hilite-soft');
  });

  it('applies default state classes when not selected', () => {
    render(
      <Choice selected={false} onSelect={() => {}}>
        option
      </Choice>
    );
    const el = screen.getByRole('radio');
    expect(el.className).toContain('bg-card');
    expect(el.className).toContain('border-rule');
  });

  it('renders radio dot indicator when selected in radio mode', () => {
    const { container } = render(
      <Choice selected={true} onSelect={() => {}} mode="radio">
        option
      </Choice>
    );
    // Radio dot is a span with bg-ink and rounded-full
    const dot = container.querySelector('span.bg-ink.rounded-full');
    expect(dot).toBeInTheDocument();
  });

  it('does not render radio dot when not selected', () => {
    const { container } = render(
      <Choice selected={false} onSelect={() => {}} mode="radio">
        option
      </Choice>
    );
    const dot = container.querySelector('span.bg-ink.rounded-full');
    expect(dot).not.toBeInTheDocument();
  });

  it('renders checkmark SVG when selected in checkbox mode', () => {
    const { container } = render(
      <Choice selected={true} onSelect={() => {}} mode="checkbox">
        option
      </Choice>
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('does not render checkmark when not selected in checkbox mode', () => {
    const { container } = render(
      <Choice selected={false} onSelect={() => {}} mode="checkbox">
        option
      </Choice>
    );
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('merges custom className', () => {
    render(
      <Choice selected={false} onSelect={() => {}} className="mt-2">
        option
      </Choice>
    );
    expect(screen.getByRole('radio').className).toContain('mt-2');
  });

  it('applies the ≥48px mobile tap-target floor (Req 11.1)', () => {
    render(
      <Choice selected={false} onSelect={() => {}}>
        option
      </Choice>
    );
    expect(screen.getByRole('radio').className).toContain('mobile:min-h-[48px]');
  });
});
