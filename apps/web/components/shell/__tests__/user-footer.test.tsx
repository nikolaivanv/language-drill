import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserFooter } from '../user-footer';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    [key: string]: unknown;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

const mockUseUser = vi.fn();
const mockSignOut = vi.fn();

vi.mock('@clerk/nextjs', () => ({
  useUser: () => mockUseUser(),
  useClerk: () => ({ signOut: mockSignOut }),
}));

vi.mock('../../consent/consent-provider', () => ({
  useConsent: () => ({ openPreferences: () => {} }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setUser(
  user: { firstName?: string | null; lastName?: string | null } | null,
  isLoaded = true
) {
  mockUseUser.mockReturnValue({ user, isLoaded });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UserFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a skeleton when Clerk is not loaded yet', () => {
    setUser(null, false);

    const { container } = render(<UserFooter />);

    // No interactive trigger button while loading
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // Skeleton uses paper-2 + animate-pulse placeholders
    const placeholders = container.querySelectorAll('.animate-pulse');
    expect(placeholders.length).toBeGreaterThanOrEqual(2);
  });

  it('renders initials from firstName + lastName ("Sam Smith" -> "SS")', () => {
    setUser({ firstName: 'Sam', lastName: 'Smith' });

    render(<UserFooter />);

    const trigger = screen.getByRole('button', { name: /sam/i });
    expect(within(trigger).getByText('SS')).toBeInTheDocument();
  });

  it('renders firstName initial only when no lastName ("Sam" -> "S")', () => {
    setUser({ firstName: 'Sam', lastName: null });

    render(<UserFooter />);

    const trigger = screen.getByRole('button', { name: /sam/i });
    expect(within(trigger).getByText('S')).toBeInTheDocument();
  });

  it('renders "?" when neither firstName nor lastName is present', () => {
    setUser({ firstName: null, lastName: null });

    render(<UserFooter />);

    const trigger = screen.getByRole('button', { name: /you/i });
    expect(within(trigger).getByText('?')).toBeInTheDocument();
  });

  it('renders the lowercase first name as text', () => {
    setUser({ firstName: 'Sam', lastName: 'Smith' });

    render(<UserFooter />);

    const trigger = screen.getByRole('button', { name: /sam/i });
    expect(within(trigger).getByText('sam')).toBeInTheDocument();
  });

  it('falls back to "you" when firstName is null', () => {
    setUser({ firstName: null, lastName: null });

    render(<UserFooter />);

    const trigger = screen.getByRole('button', { name: /you/i });
    expect(within(trigger).getByText('you')).toBeInTheDocument();
  });

  it('clicking the trigger opens the menu (aria-expanded becomes true)', () => {
    setUser({ firstName: 'Sam', lastName: 'Smith' });

    render(<UserFooter />);

    const trigger = screen.getByRole('button', { name: /sam/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('menu shows a "settings" link to /settings', () => {
    setUser({ firstName: 'Sam', lastName: 'Smith' });

    render(<UserFooter />);

    fireEvent.click(screen.getByRole('button', { name: /sam/i }));

    const settingsLink = screen.getByRole('menuitem', { name: /settings/i });
    expect(settingsLink).toHaveAttribute('href', '/settings');
  });

  it('clicking "sign out" calls signOut with { redirectUrl: "/sign-in" }', () => {
    setUser({ firstName: 'Sam', lastName: 'Smith' });

    render(<UserFooter />);

    fireEvent.click(screen.getByRole('button', { name: /sam/i }));
    const signOutBtn = screen.getByRole('menuitem', { name: /sign out/i });
    fireEvent.click(signOutBtn);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ redirectUrl: '/sign-in' });
  });

  it('Escape key closes the menu', () => {
    setUser({ firstName: 'Sam', lastName: 'Smith' });

    render(<UserFooter />);

    fireEvent.click(screen.getByRole('button', { name: /sam/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clicking outside closes the menu', () => {
    setUser({ firstName: 'Sam', lastName: 'Smith' });

    render(<UserFooter />);

    fireEvent.click(screen.getByRole('button', { name: /sam/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
