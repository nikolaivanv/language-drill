'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 * Coordinates whether {@link AppShell} renders its bottom `<AppFooter/>`.
 *
 * Most pages flow their content normally and let the shell footer sit at the end
 * of the `main` scroll region. But a page that owns a full-height *internal*
 * scroller (the theory detail page, whose `.theory-scroll` is the scroll-spy's
 * IntersectionObserver root) wants the footer at the end of *its* scroller, not
 * parked permanently below a viewport-tall panel. Such a page suppresses the
 * shell footer via {@link useSuppressShellFooter} and renders `<AppFooter/>`
 * inside its own scroller instead.
 *
 * Suppression is ref-counted so overlapping mounts (e.g. a route transition
 * where the old and new page briefly coexist) resolve correctly: the footer
 * stays hidden until the last suppressor unmounts.
 */
interface ShellFooterContextValue {
  suppressed: boolean;
  /** Register a suppressor; returns an idempotent-per-call unregister. */
  register: () => () => void;
}

const ShellFooterContext = createContext<ShellFooterContextValue | null>(null);

export function ShellFooterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [count, setCount] = useState(0);

  const register = useCallback(() => {
    setCount((c) => c + 1);
    return () => setCount((c) => c - 1);
  }, []);

  const value = useMemo<ShellFooterContextValue>(
    () => ({ suppressed: count > 0, register }),
    [count, register],
  );

  return (
    <ShellFooterContext.Provider value={value}>
      {children}
    </ShellFooterContext.Provider>
  );
}

/** Read whether the shell footer is currently suppressed. */
export function useShellFooterSuppressed(): boolean {
  return useContext(ShellFooterContext)?.suppressed ?? false;
}

/**
 * Suppress the shell footer while `active` is true. Safe to call
 * unconditionally (Rules of Hooks); pass a boolean to gate it. A no-op outside
 * a {@link ShellFooterProvider}.
 */
export function useSuppressShellFooter(active: boolean): void {
  const register = useContext(ShellFooterContext)?.register;
  useEffect(() => {
    if (!active || !register) return;
    return register();
  }, [active, register]);
}
