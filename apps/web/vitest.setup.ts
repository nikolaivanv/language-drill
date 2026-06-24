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
