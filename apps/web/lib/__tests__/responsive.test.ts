import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import {
  MOBILE_MAX_WIDTH,
  MOBILE_MEDIA_QUERY,
  useIsMobile,
} from '../responsive';

// Builds a controllable `window.matchMedia` mock. `setMatches` flips the match
// state and fires the registered `change` listeners, mirroring the browser.
function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();

  const mql = {
    get matches() {
      return matches;
    },
    media: MOBILE_MEDIA_QUERY,
    onchange: null,
    addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
    addListener: (cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeListener: (cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;

  const matchMedia = vi.fn((query: string) => {
    (mql as { media: string }).media = query;
    return mql;
  });

  vi.stubGlobal('matchMedia', matchMedia);

  return {
    matchMedia,
    listenerCount: () => listeners.size,
    setMatches(next: boolean) {
      matches = next;
      for (const cb of listeners) {
        cb({ matches } as MediaQueryListEvent);
      }
    },
  };
}

describe('responsive constants', () => {
  it('derives the media query from the single breakpoint constant', () => {
    expect(MOBILE_MAX_WIDTH).toBe(760);
    expect(MOBILE_MEDIA_QUERY).toBe('(max-width: 760px)');
  });
});

describe('useIsMobile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the desktop default (false) during SSR', () => {
    // Even when the query would match, the server snapshot is always desktop so
    // hydration stays stable.
    installMatchMedia(true);
    const html = renderToString(
      createElement(function Probe() {
        return createElement('span', null, String(useIsMobile()));
      }),
    );
    expect(html).toContain('false');
  });

  it('reconciles to true on mount when the query matches', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('reports false on mount when the query does not match', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('updates when the media query change event fires', () => {
    const mm = installMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => mm.setMatches(true));
    expect(result.current).toBe(true);

    act(() => mm.setMatches(false));
    expect(result.current).toBe(false);
  });

  it('subscribes and unsubscribes from the media query list', () => {
    const mm = installMatchMedia(true);
    const { unmount } = renderHook(() => useIsMobile());
    expect(mm.listenerCount()).toBe(1);
    unmount();
    expect(mm.listenerCount()).toBe(0);
  });

  it('falls back to false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});
