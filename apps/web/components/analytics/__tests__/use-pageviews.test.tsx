import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const analytics = vi.hoisted(() => ({ captureEvent: vi.fn() }));
vi.mock('../../../lib/analytics/posthog', () => analytics);

let pathname = '/drill';
const search = new URLSearchParams('');
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => search,
}));

import { usePageviews } from '../use-pageviews';

function Harness() {
  usePageviews();
  return null;
}

describe('usePageviews', () => {
  beforeEach(() => vi.clearAllMocks());

  it('captures a $pageview on mount', () => {
    pathname = '/drill';
    render(<Harness />);
    expect(analytics.captureEvent).toHaveBeenCalledWith('$pageview', expect.objectContaining({}));
    expect(analytics.captureEvent.mock.calls[0][0]).toBe('$pageview');
  });

  it('captures again when the path changes', () => {
    pathname = '/drill';
    const { rerender } = render(<Harness />);
    expect(analytics.captureEvent).toHaveBeenCalledTimes(1);
    pathname = '/progress';
    rerender(<Harness />);
    expect(analytics.captureEvent).toHaveBeenCalledTimes(2);
  });
});
