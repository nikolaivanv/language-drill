import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavItem } from '../nav-item';

const mockUsePathname = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('NavItem', () => {
  beforeEach(() => {
    mockUsePathname.mockReset();
  });

  function renderItem(href: string, pathname: string) {
    mockUsePathname.mockReturnValue(pathname);
    return render(
      <NavItem href={href} label="today" icon={<span data-testid="icon">i</span>} />
    );
  }

  it('renders Link with href and label', () => {
    renderItem('/drill', '/');
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/drill');
    expect(link).toHaveTextContent('today');
  });

  it('marks active when pathname matches href exactly', () => {
    renderItem('/drill', '/drill');
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link.className).toContain('bg-ink');
    expect(link.className).toContain('text-paper');
  });

  it('marks active when pathname is a nested route under href', () => {
    renderItem('/drill', '/drill/cloze');
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('aria-current', 'page');
  });

  it('marks active when href is "/" and pathname is "/"', () => {
    renderItem('/', '/');
    expect(screen.getByRole('link')).toHaveAttribute('aria-current', 'page');
  });

  it('does NOT mark active when href is "/" and pathname is "/drill"', () => {
    renderItem('/', '/drill');
    const link = screen.getByRole('link');
    expect(link).not.toHaveAttribute('aria-current');
  });

  it('applies inactive classes when not active', () => {
    renderItem('/read', '/drill');
    const link = screen.getByRole('link');
    expect(link).not.toHaveAttribute('aria-current');
    expect(link.className).toContain('text-ink-soft');
    expect(link.className).toContain('hover:bg-paper-2');
  });

  it('renders the icon node', () => {
    renderItem('/drill', '/');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('applies focus-visible ring class', () => {
    renderItem('/drill', '/');
    expect(screen.getByRole('link').className).toContain('focus-visible:shadow-');
  });
});
