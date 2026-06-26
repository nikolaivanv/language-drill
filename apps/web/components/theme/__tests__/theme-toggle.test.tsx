import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThemeToggle } from '../theme-toggle';
import { ThemeProvider } from '../theme-provider';
import { THEME_STORAGE_KEY } from '../../../lib/theme/theme';

function installMatchMedia(dark = false) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    installMatchMedia(false);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders the three appearance options', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole('radiogroup', { name: /appearance/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /system/i })).toBeInTheDocument();
  });

  it('marks the stored choice as checked', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole('radio', { name: /dark/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /light/i })).not.toBeChecked();
  });

  it('clicking an option sets the theme', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: /dark/i }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('radio', { name: /dark/i })).toBeChecked();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does not crash without a ThemeProvider (default context)', () => {
    expect(() => render(<ThemeToggle />)).not.toThrow();
    expect(screen.getByRole('radio', { name: /system/i })).toBeChecked();
  });
});
