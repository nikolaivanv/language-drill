import { describe, expect, it } from 'vitest';

/**
 * Guards the test ENVIRONMENT, not app code.
 *
 * Vitest's jsdom environment installs jsdom's globals by copying window keys,
 * but `getWindowKeys` skips any key already present on Node's `globalThis`
 * unless vitest lists it explicitly — and neither storage key is listed. Node
 * 24+ exposes Web Storage globals by default, so from Node 24 on, jsdom's
 * `localStorage` is never installed and Node's own is left in place. Node's
 * `localStorage` is unusable without `--localstorage-file`, which is why the
 * whole consent / PostHog suite failed with `localStorage.clear is not a
 * function` on Node 25 while CI (Node 22) stayed green.
 *
 * `vitest.setup.ts` installs a real in-memory Storage when it finds a
 * non-functional one. These assertions fail loudly if that stops working,
 * rather than letting ~51 unrelated tests fail with a confusing TypeError.
 */
describe.each(['localStorage', 'sessionStorage'] as const)('%s', (name) => {
  const storage = () => globalThis[name];

  it('exposes the Web Storage API', () => {
    for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) {
      expect(typeof storage()[method]).toBe('function');
    }
  });

  it('round-trips a value and coerces to string like the real API', () => {
    storage().clear();
    storage().setItem('k', 'v');
    expect(storage().getItem('k')).toBe('v');
    storage().setItem('n', 1 as never);
    expect(storage().getItem('n')).toBe('1');
  });

  it('returns null for a missing key, never undefined', () => {
    storage().clear();
    expect(storage().getItem('nope')).toBeNull();
  });

  it('tracks length, removeItem and clear', () => {
    storage().clear();
    expect(storage().length).toBe(0);
    storage().setItem('a', '1');
    storage().setItem('b', '2');
    expect(storage().length).toBe(2);
    storage().removeItem('a');
    expect(storage().length).toBe(1);
    expect(storage().getItem('a')).toBeNull();
    storage().clear();
    expect(storage().length).toBe(0);
  });

  it('enumerates keys by index', () => {
    storage().clear();
    storage().setItem('only', 'x');
    expect(storage().key(0)).toBe('only');
    expect(storage().key(1)).toBeNull();
  });

  // window and globalThis are the same object under vitest's jsdom, so app
  // code reaching for `window.localStorage` must see the same store.
  it('is the same object on window', () => {
    expect(window[name]).toBe(storage());
  });
});

// Node's own sessionStorage is process-wide, so before this polyfill a value
// written by one test FILE was visible to the next one sharing the worker.
describe('storage isolation', () => {
  it('does not carry a value planted by another test file', () => {
    expect(localStorage.getItem('__leak_probe__')).toBeNull();
    expect(sessionStorage.getItem('__leak_probe__')).toBeNull();
    localStorage.setItem('__leak_probe__', 'planted');
    sessionStorage.setItem('__leak_probe__', 'planted');
  });
});
