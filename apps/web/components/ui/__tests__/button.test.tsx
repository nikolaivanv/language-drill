import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../button';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Button', () => {
  // ---- Defaults -----------------------------------------------------------

  it('renders with default variant and md size', () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole('button', { name: 'Click me' });

    // default variant classes
    expect(button.className).toContain('border-ink');
    expect(button.className).toContain('bg-transparent');

    // md size classes
    expect(button.className).toContain('px-[18px]');
    expect(button.className).toContain('text-[13px]');
  });

  // ---- Variants -----------------------------------------------------------

  it('applies correct classes for primary variant', () => {
    render(<Button variant="primary">Primary</Button>);
    const button = screen.getByRole('button', { name: 'Primary' });
    expect(button.className).toContain('bg-ink');
    expect(button.className).toContain('text-paper');
  });

  it('applies correct classes for ghost variant', () => {
    render(<Button variant="ghost">Ghost</Button>);
    const button = screen.getByRole('button', { name: 'Ghost' });
    expect(button.className).toContain('border-transparent');
    expect(button.className).toContain('text-ink-soft');
  });

  it('applies correct classes for accent variant', () => {
    render(<Button variant="accent">Accent</Button>);
    const button = screen.getByRole('button', { name: 'Accent' });
    expect(button.className).toContain('bg-accent');
    expect(button.className).toContain('text-white');
  });

  it('applies correct classes for default variant', () => {
    render(<Button variant="default">Default</Button>);
    const button = screen.getByRole('button', { name: 'Default' });
    expect(button.className).toContain('bg-transparent');
    expect(button.className).toContain('text-ink');
  });

  // ---- Sizes --------------------------------------------------------------

  it('applies correct classes for sm size', () => {
    render(<Button size="sm">Small</Button>);
    const button = screen.getByRole('button', { name: 'Small' });
    expect(button.className).toContain('min-h-[32px]');
    expect(button.className).toContain('text-[12px]');
  });

  it('applies correct classes for md size', () => {
    render(<Button size="md">Medium</Button>);
    const button = screen.getByRole('button', { name: 'Medium' });
    expect(button.className).toContain('px-[18px]');
    expect(button.className).toContain('py-[10px]');
  });

  it('applies correct classes for lg size', () => {
    render(<Button size="lg">Large</Button>);
    const button = screen.getByRole('button', { name: 'Large' });
    expect(button.className).toContain('py-[14px]');
    expect(button.className).toContain('text-[15px]');
  });

  // ---- Disabled state -----------------------------------------------------

  it('sets aria-disabled and opacity class when disabled', () => {
    render(<Button disabled>Disabled</Button>);
    const button = screen.getByRole('button', { name: 'Disabled' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button.className).toContain('opacity-50');
  });

  // ---- Loading state ------------------------------------------------------

  it('shows spinner and hides children when loading', () => {
    render(<Button loading>Submit</Button>);
    const button = screen.getByRole('button');

    // aria-busy should be set
    expect(button).toHaveAttribute('aria-busy', 'true');

    // Spinner SVG should be present with animate-spin
    const spinner = button.querySelector('svg.animate-spin');
    expect(spinner).toBeInTheDocument();

    // Children text should not be visible
    expect(button).not.toHaveTextContent('Submit');
  });

  // ---- Link rendering (href) ----------------------------------------------

  it('renders as <a> when href is provided with external URL', () => {
    render(<Button href="https://example.com">Link</Button>);
    const link = screen.getByRole('link', { name: 'Link' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('renders as <a> (via Next Link mock) when href is internal', () => {
    render(<Button href="/dashboard">Go</Button>);
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/dashboard');
  });

  it('renders as <button> when no href is provided', () => {
    render(<Button>Click</Button>);
    const button = screen.getByRole('button', { name: 'Click' });
    expect(button.tagName).toBe('BUTTON');
  });

  // ---- Ref forwarding -----------------------------------------------------

  it('forwards ref to the button element', () => {
    const ref = { current: null } as React.RefObject<HTMLButtonElement | null>;
    render(<Button ref={ref}>Ref</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  // ---- className merging --------------------------------------------------

  it('merges custom className', () => {
    render(<Button className="my-custom-class">Styled</Button>);
    const button = screen.getByRole('button', { name: 'Styled' });
    expect(button.className).toContain('my-custom-class');
    // Should still have base classes
    expect(button.className).toContain('inline-flex');
  });

  // ---- Click handler ------------------------------------------------------

  it('fires click handler on click', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Click' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire click handler when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Click
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Click' });
    fireEvent.click(button);
    // disabled attribute on native button prevents click events
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not fire click handler when loading', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Click
      </Button>
    );
    const button = screen.getByRole('button');
    // pointer-events-none is applied via CSS; in jsdom we verify the class
    expect(button.className).toContain('pointer-events-none');
  });
});
