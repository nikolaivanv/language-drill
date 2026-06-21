import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppShell } from '../app-shell';

const mockIsMobile = vi.fn();

vi.mock('../../../lib/responsive', () => ({
  useIsMobile: () => mockIsMobile(),
}));

// Stub the shell pieces — this test exercises only AppShell's viewport seam.
vi.mock('../nav', () => ({
  Nav: () => <div data-testid="desktop-rail" />,
}));
vi.mock('../mobile-top-bar', () => ({
  MobileTopBar: () => <div data-testid="mobile-top-bar" />,
}));
vi.mock('../mobile-tab-bar', () => ({
  MobileTabBar: () => <div data-testid="mobile-tab-bar" />,
}));
vi.mock('../app-footer', () => ({
  AppFooter: () => <div data-testid="app-footer" />,
}));

describe('AppShell', () => {
  beforeEach(() => {
    mockIsMobile.mockReset();
  });

  it('renders the desktop rail and no mobile chrome above the breakpoint', () => {
    mockIsMobile.mockReturnValue(false);
    render(
      <AppShell profiles={[]}>
        <p>content</p>
      </AppShell>,
    );

    expect(screen.getByTestId('desktop-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-top-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-tab-bar')).not.toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('renders the top app-bar + tab-bar and hides the rail at mobile width', () => {
    mockIsMobile.mockReturnValue(true);
    render(
      <AppShell profiles={[]}>
        <p>content</p>
      </AppShell>,
    );

    expect(screen.getByTestId('mobile-top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('desktop-rail')).not.toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
