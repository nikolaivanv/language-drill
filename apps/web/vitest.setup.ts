import { vi, type Mock } from 'vitest';
import '@testing-library/jest-dom/vitest';

// ---------------------------------------------------------------------------
// IntersectionObserver mock
// ---------------------------------------------------------------------------
// jsdom doesn't ship `IntersectionObserver`, so anything that mounts the
// theory panel or `useScrollSpy` would crash without this stub. Tests can
// import `mockIntersectionObserverInstances` to invoke the captured callback
// and assert active-section behavior. Remember to clear the registry in a
// `beforeEach` so it doesn't leak across tests.

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  root: Element | Document | null = null;
  rootMargin = '';
  thresholds: ReadonlyArray<number> = [];
  observe: Mock = vi.fn();
  unobserve: Mock = vi.fn();
  disconnect: Mock = vi.fn();
  takeRecords: Mock = vi.fn(() => [] as IntersectionObserverEntry[]);

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    mockIntersectionObserverInstances.push(this);
  }
}

export const mockIntersectionObserverInstances: MockIntersectionObserver[] = [];

vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

// ---------------------------------------------------------------------------
// Radix UI polyfills
// ---------------------------------------------------------------------------
// @radix-ui/react-dropdown-menu (and siblings) call DOM APIs jsdom doesn't
// implement. Without these, mounting a Radix menu or driving it via
// user-event throws.

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();

// ---------------------------------------------------------------------------
// Web Storage polyfill (Node >= 24)
// ---------------------------------------------------------------------------
// Vitest's jsdom environment installs jsdom globals by copying window keys, but
// its `getWindowKeys` SKIPS any key already present on Node's `globalThis`
// unless vitest lists it explicitly — and neither `localStorage` nor
// `sessionStorage` is on that list. Node 24+ exposes Web Storage globals by
// default, so from Node 24 on jsdom's storages are never installed and Node's
// own are left in place:
//
//   - Node's `localStorage` is unusable without `--localstorage-file`, which is
//     why the entire consent / PostHog suite failed with
//     `localStorage.clear is not a function` (~51 tests) on Node 25 while CI,
//     pinned to Node 22, stayed green. Nothing in the app had changed.
//   - Node's `sessionStorage` DOES work, but it is process-wide, so a value
//     written by one test file was visible to the next file sharing a worker.
//     The drill answer-draft components use sessionStorage, so that is a real
//     cross-file leak, not a hypothetical one.
//
// Installing our own store fixes both and is version-agnostic: on Node 22 the
// environment's storage is already sound, `isUsableStorage` returns true, and
// this is a no-op — so CI behaviour is unchanged today and stays correct when
// CI moves to a newer Node.
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      map.delete(String(key));
    },
    clear: () => {
      map.clear();
    },
  } satisfies Storage;
}

/** Whether the environment's storage actually implements the Web Storage API. */
function isUsableStorage(candidate: unknown): boolean {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const s = candidate as Partial<Storage>;
  return (
    typeof s.getItem === 'function' &&
    typeof s.setItem === 'function' &&
    typeof s.removeItem === 'function' &&
    typeof s.clear === 'function'
  );
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  let existing: unknown;
  try {
    existing = globalThis[name];
  } catch {
    // Node throws ERR_INVALID_STATE rather than returning a broken object when
    // Web Storage is exposed but unconfigured — treat that as unusable too.
    existing = undefined;
  }
  // `sessionStorage` is replaced even when it works: Node's is shared across
  // every file in the worker, and per-file isolation is what a test double owes
  // the suite.
  if (!isUsableStorage(existing) || name === 'sessionStorage') {
    Object.defineProperty(globalThis, name, {
      value: createMemoryStorage(),
      writable: true,
      configurable: true,
    });
  }
}
