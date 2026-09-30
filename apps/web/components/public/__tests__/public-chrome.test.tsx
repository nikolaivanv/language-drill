import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublicHeader } from '../public-header';
import { ThemeCycleButton } from '../theme-cycle-button';

const setTheme = vi.fn();
let currentTheme = 'system';
vi.mock('../../theme/theme-provider', () => ({
  useTheme: () => ({ theme: currentTheme, setTheme }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentTheme = 'system';
});

describe('PublicHeader', () => {
  it('links the wordmark home', () => {
    render(<PublicHeader />);
    expect(screen.getByRole('link', { name: /drill/i })).toHaveAttribute('href', '/');
  });

  it('renders no language rail when no href builder is given', () => {
    render(<PublicHeader />);
    expect(screen.queryByRole('navigation', { name: 'language' })).not.toBeInTheDocument();
  });

  it('builds every language pill from the supplied href builder', () => {
    render(
      <PublicHeader activeLanguage="TR" languageHref={(l) => `/x?lang=${l}`} />,
    );
    const rail = screen.getByRole('navigation', { name: 'language' });
    expect(rail).toBeInTheDocument();
    // Native names, which is the vocabulary the marketing pages already use.
    expect(screen.getByRole('link', { name: 'español' })).toHaveAttribute('href', '/x?lang=ES');
    expect(screen.getByRole('link', { name: 'deutsch' })).toHaveAttribute('href', '/x?lang=DE');
    expect(screen.getByRole('link', { name: 'türkçe' })).toHaveAttribute('href', '/x?lang=TR');
  });

  it('marks only the active language as current', () => {
    render(
      <PublicHeader activeLanguage="TR" languageHref={(l) => `/x?lang=${l}`} />,
    );
    expect(screen.getByRole('link', { name: 'türkçe' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'español' })).not.toHaveAttribute('aria-current');
  });
});

describe('ThemeCycleButton', () => {
  it('names the current theme, not the icon', () => {
    currentTheme = 'dark';
    render(<ThemeCycleButton />);
    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeInTheDocument();
  });

  it('advances light → dark → system → light', async () => {
    currentTheme = 'light';
    const { unmount } = render(<ThemeCycleButton />);
    await userEvent.click(screen.getByRole('button'));
    expect(setTheme).toHaveBeenLastCalledWith('dark');
    unmount();

    currentTheme = 'dark';
    const second = render(<ThemeCycleButton />);
    await userEvent.click(screen.getByRole('button'));
    expect(setTheme).toHaveBeenLastCalledWith('system');
    second.unmount();

    currentTheme = 'system';
    render(<ThemeCycleButton />);
    await userEvent.click(screen.getByRole('button'));
    expect(setTheme).toHaveBeenLastCalledWith('light');
  });

  it('keeps system reachable so a visitor can hand control back to the OS', async () => {
    currentTheme = 'dark';
    render(<ThemeCycleButton />);
    await userEvent.click(screen.getByRole('button'));
    expect(setTheme).toHaveBeenCalledWith('system');
  });
});
