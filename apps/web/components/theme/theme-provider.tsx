'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  DEFAULT_THEME,
  PREFERS_DARK_QUERY,
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  isThemeChoice,
  resolveTheme,
  type ResolvedTheme,
  type ThemeChoice,
} from '../../lib/theme/theme';

interface ThemeContextValue {
  /** The stored preference (what the toggle highlights). */
  theme: ThemeChoice;
  /** The effective theme after resolving `system` against the OS. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeChoice) => void;
}

// A non-null default so consumers (the account-menu toggle) never crash when
// rendered outside the provider — e.g. in isolated component tests. The real
// behaviour comes from <ThemeProvider> mounted at the app root.
const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  resolvedTheme: 'light',
  setTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

function readStoredChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeChoice(stored)) return stored;
  } catch {
    // localStorage can throw in privacy mode — fall through to the default.
  }
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // SSR + first client render use the default so markup matches; the stored
  // choice is read after mount (the pre-paint script already applied the class
  // to <html>, so there is no visual flash from this catch-up).
  const [theme, setThemeState] = useState<ThemeChoice>(DEFAULT_THEME);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  useEffect(() => {
    setThemeState(readStoredChoice());
  }, []);

  // Apply on every choice change, and while on `system` keep following the OS.
  useEffect(() => {
    const mq = window.matchMedia(PREFERS_DARK_QUERY);
    const apply = () => {
      const resolved = resolveTheme(theme, mq.matches);
      applyResolvedTheme(resolved);
      setResolvedTheme(resolved);
    };
    apply();
    if (theme !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = useCallback((next: ThemeChoice) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persist is best-effort; the in-memory choice still applies this session.
    }
    setThemeState(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
