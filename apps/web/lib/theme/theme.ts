// ---------------------------------------------------------------------------
// Theme core — pure helpers + the pre-paint init script
// ---------------------------------------------------------------------------
// The dark theme works by overriding the Tailwind `@theme` `--color-*` tokens
// under `html.dark` (see globals.css), so flipping a single class on <html>
// re-themes the whole app. The user's choice (light / dark / system) lives in
// localStorage under THEME_STORAGE_KEY and is shared across every screen.
//
// `system` resolves to the OS `prefers-color-scheme`; `light` / `dark` are
// explicit. THEME_INIT_SCRIPT runs before first paint (injected into <head> by
// the root layout) so the correct theme is applied with no flash of the wrong
// palette. The ThemeProvider takes over at runtime for live toggling and to
// follow the OS while on `system`.
// ---------------------------------------------------------------------------

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** localStorage key — kept identical to the design prototype's controller. */
export const THEME_STORAGE_KEY = 'drill-theme';

/** Respect the OS by default; a fresh visitor sees their system preference. */
export const DEFAULT_THEME: ThemeChoice = 'system';

export const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Collapse a stored choice + the current OS preference to an effective theme. */
export function resolveTheme(
  choice: ThemeChoice,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}

/**
 * Apply an effective theme to the document root: toggle the `.dark` class that
 * the CSS keys off, and set `color-scheme` so native UI (form controls,
 * scrollbars) matches.
 */
export function applyResolvedTheme(
  resolved: ResolvedTheme,
  root: HTMLElement = document.documentElement,
): void {
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

// A self-contained IIFE stringified for <head> injection. Mirrors
// resolveTheme + applyResolvedTheme so first paint matches the React runtime.
// Wrapped in try/catch so a blocked localStorage (privacy mode) can never break
// rendering — it just falls back to the default theme.
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var c=localStorage.getItem(k);if(c!=='light'&&c!=='dark'&&c!=='system')c=${JSON.stringify(
  DEFAULT_THEME,
)};var d=c==='dark'||(c==='system'&&window.matchMedia(${JSON.stringify(
  PREFERS_DARK_QUERY,
)}).matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
