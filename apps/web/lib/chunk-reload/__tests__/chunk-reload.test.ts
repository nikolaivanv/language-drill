import { describe, expect, it, vi } from 'vitest';

import {
  RELOAD_SUPPRESS_WINDOW_MS,
  type ReloadGuardDeps,
  handleChunkError,
  isChunkLoadError,
} from '../chunk-reload';

describe('isChunkLoadError', () => {
  it('matches a ChunkLoadError by name regardless of message', () => {
    const err = Object.assign(new Error('whatever'), { name: 'ChunkLoadError' });
    expect(isChunkLoadError(err)).toBe(true);
  });

  it.each([
    'Loading chunk 4823 failed.',
    'Loading chunk app/(dashboard)/drill/conjugation/page failed.',
    'Loading CSS chunk 17 failed.',
    'Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
  ])('matches chunk-load message: %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('matches a bare string reason', () => {
    expect(isChunkLoadError('Loading chunk 12 failed.')).toBe(true);
  });

  it.each([
    'TypeError: e[o] is not a function',
    'x is not a function',
    'Cannot read properties of undefined (reading "map")',
    'NetworkError when attempting to fetch resource.',
    'Something completely unrelated',
  ])('does NOT match ambiguous/unrelated error: %s', (message) => {
    // The module-id-mismatch variant (`x is not a function`) is intentionally
    // not auto-reloaded — it is indistinguishable from a real bug by message.
    expect(isChunkLoadError(new Error(message))).toBe(false);
  });

  it.each([null, undefined, 42, {}, { message: 123 }])(
    'returns false for non-error-like value: %s',
    (value) => {
      expect(isChunkLoadError(value)).toBe(false);
    },
  );
});

describe('handleChunkError', () => {
  function makeDeps(overrides: Partial<ReloadGuardDeps> = {}): {
    deps: ReloadGuardDeps;
    reload: ReturnType<typeof vi.fn>;
    setLastReloadAt: ReturnType<typeof vi.fn>;
  } {
    const reload = vi.fn();
    const setLastReloadAt = vi.fn();
    const deps: ReloadGuardDeps = {
      now: 1_000_000,
      getLastReloadAt: () => null,
      setLastReloadAt,
      reload,
      ...overrides,
    };
    return { deps, reload, setLastReloadAt };
  }

  it('reloads and records the timestamp on a first chunk error', () => {
    const { deps, reload, setLastReloadAt } = makeDeps();
    const triggered = handleChunkError(new Error('Loading chunk 1 failed.'), deps);

    expect(triggered).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(setLastReloadAt).toHaveBeenCalledWith(deps.now);
  });

  it('does nothing for a non-chunk error', () => {
    const { deps, reload } = makeDeps();
    const triggered = handleChunkError(new Error('e[o] is not a function'), deps);

    expect(triggered).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('suppresses a second reload within the anti-loop window', () => {
    const now = 1_000_000;
    const { deps, reload } = makeDeps({
      now,
      getLastReloadAt: () => now - (RELOAD_SUPPRESS_WINDOW_MS - 1),
    });
    const triggered = handleChunkError(new Error('Loading chunk 1 failed.'), deps);

    expect(triggered).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('allows a reload again once the window has elapsed', () => {
    const now = 1_000_000;
    const { deps, reload } = makeDeps({
      now,
      getLastReloadAt: () => now - RELOAD_SUPPRESS_WINDOW_MS,
    });
    const triggered = handleChunkError(new Error('Loading chunk 1 failed.'), deps);

    expect(triggered).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
