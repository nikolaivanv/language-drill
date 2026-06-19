import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: vi.fn() }),
}));

// Captures the options passed to redeem.mutate so each test can drive the
// success/error callback synchronously. Defined via vi.hoisted so the values
// exist when the hoisted vi.mock factory below runs.
const { mockMutate, MockRedeemError } = vi.hoisted(() => {
  class MockRedeemError extends Error {
    kind: string;
    constructor(kind: string, message: string) {
      super(message);
      this.name = 'RedeemError';
      this.kind = kind;
    }
  }
  return { mockMutate: vi.fn(), MockRedeemError };
});

vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: () => vi.fn(),
  useRedeemInvite: () => ({ mutate: mockMutate }),
  RedeemError: MockRedeemError,
}));

import { PostSignupRedeem } from '../post-signup-redeem';

const SUCCESS_TEXT = "Invite applied — you've got 10× the daily limit.";

function setPendingInvite(code: string | null) {
  if (code === null) localStorage.removeItem('pending_invite');
  else localStorage.setItem('pending_invite', code);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PostSignupRedeem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders nothing when there is no pending invite', () => {
    setPendingInvite(null);

    const { container } = render(<PostSignupRedeem />);

    expect(mockMutate).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the success banner after redeeming a stashed code', () => {
    setPendingInvite('ABCD1234');
    mockMutate.mockImplementation((_vars, opts) => opts.onSuccess());

    render(<PostSignupRedeem />);

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(SUCCESS_TEXT);
  });

  it('hides the banner when the dismiss button is clicked', () => {
    setPendingInvite('ABCD1234');
    mockMutate.mockImplementation((_vars, opts) => opts.onSuccess());

    render(<PostSignupRedeem />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('auto-dismisses the banner after a timeout', () => {
    setPendingInvite('ABCD1234');
    mockMutate.mockImplementation((_vars, opts) => opts.onSuccess());

    render(<PostSignupRedeem />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the banner as a fixed overlay so it never sits in document flow', () => {
    setPendingInvite('ABCD1234');
    mockMutate.mockImplementation((_vars, opts) => opts.onSuccess());

    const { container } = render(<PostSignupRedeem />);

    // The outermost rendered node must be taken out of flow (position: fixed)
    // so it can't overlap a page that pulls itself flush with negative margins.
    const root = container.firstElementChild as HTMLElement | null;
    expect(root).not.toBeNull();
    expect(root!.className).toContain('fixed');
  });

  it('shows an error banner when redemption fails', () => {
    setPendingInvite('ABCD1234');
    mockMutate.mockImplementation((_vars, opts) =>
      opts.onError(new MockRedeemError('used', 'used')),
    );

    render(<PostSignupRedeem />);

    expect(screen.getByRole('alert')).toHaveTextContent(/already used/i);
  });
});
