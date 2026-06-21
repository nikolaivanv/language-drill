import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const analytics = vi.hoisted(() => ({ identifyUser: vi.fn(), resetUser: vi.fn() }));
vi.mock('../../../lib/analytics/posthog', () => analytics);

let auth: { isLoaded: boolean; isSignedIn: boolean; userId: string | null };
vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));

import { useIdentify } from '../use-identify';

function Harness() {
  useIdentify();
  return null;
}

describe('useIdentify', () => {
  beforeEach(() => vi.clearAllMocks());

  it('identifies the user when signed in', () => {
    auth = { isLoaded: true, isSignedIn: true, userId: 'user_42' };
    render(<Harness />);
    expect(analytics.identifyUser).toHaveBeenCalledWith('user_42');
    expect(analytics.resetUser).not.toHaveBeenCalled();
  });

  it('does nothing until Clerk is loaded', () => {
    auth = { isLoaded: false, isSignedIn: false, userId: null };
    render(<Harness />);
    expect(analytics.identifyUser).not.toHaveBeenCalled();
    expect(analytics.resetUser).not.toHaveBeenCalled();
  });

  it('resets on sign-out transition', () => {
    auth = { isLoaded: true, isSignedIn: true, userId: 'user_42' };
    const { rerender } = render(<Harness />);
    analytics.identifyUser.mockClear();
    auth = { isLoaded: true, isSignedIn: false, userId: null };
    rerender(<Harness />);
    expect(analytics.resetUser).toHaveBeenCalledTimes(1);
  });
});
