// ---------------------------------------------------------------------------
// OnboardingPage integration tests (task 32a, updated task-6)
// ---------------------------------------------------------------------------
// Locks the page-level happy path + the most common failure modes:
//   - new mode: 0 profiles → wizard mounts on Step 1 → walk through Steps 1–4
//     → submit calls `useUpdateLanguages.mutateAsync` then
//     `useUpdatePreferences.mutateAsync` with the expected payloads
//     → `router.push('/home')`.
//   - ?edit=1: redirects to /settings immediately (wizard never mounts).
//   - 4xx: the inline error row shows the server's message verbatim and the
//     primary CTA stays on Step 4 and re-enables.
//   - 5xx / network: the inline error row reads
//     "something went wrong — try again." (em-dash U+2014).
//
// Mocks:
//   - `next/navigation` — `useRouter`, `useSearchParams` (driven per test).
//   - `next/link` — plain anchor stub so the WizardFooter cancel link in
//     edit mode renders cleanly under JSDOM.
//   - `@clerk/nextjs` — `useAuth` returning a stub `getToken`.
//   - `@language-drill/api-client` — `useLanguageProfiles`,
//     `useUpdateLanguages`, `useUpdatePreferences` are mocked while
//     `createAuthenticatedFetch` is preserved from `vi.importActual` so the
//     page can construct a fetcher without hitting the network.
//
// Helpers:
//   - `setupNewMode()` configures the hook return values for new-user mode.
//   - `walkToStep4New()` drives the wizard through Steps 1–3 by interacting
//     with the rendered tiles, leaving the user on Step 4.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  CefrLevel,
  Language,
} from '@language-drill/shared';
import OnboardingPage from './page';

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

// ---------------------------------------------------------------------------
// next/link mock
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// @clerk/nextjs mock
// ---------------------------------------------------------------------------

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: vi.fn(async () => 'test-token') }),
}));

// ---------------------------------------------------------------------------
// @language-drill/api-client mock
// ---------------------------------------------------------------------------

const mockUseLanguageProfiles = vi.fn();
const mockUpdateLanguagesMutateAsync = vi.fn();
const mockUpdatePreferencesMutateAsync = vi.fn();
const mockUseUpdateLanguages = vi.fn();
const mockUseUpdatePreferences = vi.fn();

vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<
    typeof import('@language-drill/api-client')
  >('@language-drill/api-client');
  return {
    ...actual,
    useLanguageProfiles: () => mockUseLanguageProfiles(),
    useUpdateLanguages: () => mockUseUpdateLanguages(),
    useUpdatePreferences: () => mockUseUpdatePreferences(),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupNewMode() {
  mockSearchParams = new URLSearchParams();
  mockUseLanguageProfiles.mockReturnValue({
    data: { profiles: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockUseUpdateLanguages.mockReturnValue({
    mutateAsync: mockUpdateLanguagesMutateAsync,
    isPending: false,
    isError: false,
  });
  mockUseUpdatePreferences.mockReturnValue({
    mutateAsync: mockUpdatePreferencesMutateAsync,
    isPending: false,
    isError: false,
  });
}

/**
 * Drive a freshly-mounted new-mode wizard from Step 1 → Step 4. Selects ES
 * on Step 1 (single-language fast-path auto-sets it as primary), B2 on
 * Step 2, skips goals + notes on Step 3, and arrives on Step 4 with the
 * default 10-min tile + gentle nudges already enabled by `initialNewUserState`.
 */
async function walkToStep4New() {
  // Step 1: click the ES tile (first checkbox in the learning-languages group).
  const step1Group = await screen.findByRole('group', {
    name: /learning languages/i,
  });
  const esTile = within(step1Group).getAllByRole('checkbox')[0];
  fireEvent.click(esTile);

  // Continue to Step 2.
  fireEvent.click(screen.getByTestId('wizard-footer-primary'));

  // Step 2: pick CEFR B2 (4th radio in the CEFR group for ES; CEFR order
  // is A1, A2, B1, B2, C1, C2 — see CEFR_LEVELS in step-level.tsx).
  // The on-mount setPrimary effect already set ES as the primary because
  // exactly one language is selected. The aria-label is "{nativeName} level"
  // (LANGUAGE_NATIVE_NAMES[ES] = "español").
  const cefrGroup = await screen.findByRole('radiogroup', {
    name: /español level/i,
  });
  const b2 = within(cefrGroup).getAllByRole('radio')[3];
  fireEvent.click(b2);

  // Continue to Step 3.
  fireEvent.click(screen.getByTestId('wizard-footer-primary'));

  // Step 3 is fully optional — skip goals + notes.
  await screen.findByRole('group', { name: /goals/i });
  fireEvent.click(screen.getByTestId('wizard-footer-primary'));

  // We're now on Step 4 — wait for the daily-time radiogroup to mount.
  await screen.findByRole('radiogroup', { name: /daily time/i });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it('walks through Steps 1–4 in new mode, submits with the expected payloads, and redirects to /home', async () => {
    setupNewMode();
    mockUpdateLanguagesMutateAsync.mockResolvedValue({});
    mockUpdatePreferencesMutateAsync.mockResolvedValue({});

    render(<OnboardingPage />);

    await walkToStep4New();

    // Step 4 CTA reads "finish setup →" in new mode (R1.5).
    const cta = screen.getByRole('button', { name: /finish setup →/ });
    expect(cta).toBeInTheDocument();
    fireEvent.click(cta);

    // updateLanguages called first with profiles array and primaryLanguage.
    await waitFor(() => {
      expect(mockUpdateLanguagesMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateLanguagesMutateAsync).toHaveBeenCalledWith({
      profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
      primaryLanguage: Language.ES,
    });

    // updatePreferences called second with the preferences payload.
    await waitFor(() => {
      expect(mockUpdatePreferencesMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdatePreferencesMutateAsync).toHaveBeenCalledWith({
      goals: [],
      dailyMinutes: 10,
      gentleNudges: true,
      notes: '',
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/home');
    });
  });

  it('redirects to /settings immediately when ?edit=1 is present and does not render the wizard', async () => {
    // Set up edit mode search params.
    mockSearchParams = new URLSearchParams('edit=1');
    // Profiles still need to be set up (the hook is always called).
    mockUseLanguageProfiles.mockReturnValue({
      data: { profiles: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUseUpdateLanguages.mockReturnValue({
      mutateAsync: mockUpdateLanguagesMutateAsync,
      isPending: false,
      isError: false,
    });
    mockUseUpdatePreferences.mockReturnValue({
      mutateAsync: mockUpdatePreferencesMutateAsync,
      isPending: false,
      isError: false,
    });

    render(<OnboardingPage />);

    // Should redirect to /settings via replace.
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/settings');
    });

    // The wizard's Step 1 markup is NOT in the DOM — the page returns null.
    expect(
      screen.queryByRole('group', { name: /learning languages/i }),
    ).not.toBeInTheDocument();
    // And the WizardFooter's "continue →" CTA never renders either.
    expect(
      screen.queryByRole('button', { name: /continue/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the server error message inline and keeps the user on Step 4 when the submission returns 4xx', async () => {
    setupNewMode();
    // `createAuthenticatedFetch` attaches `.status` to the thrown Error on
    // non-2xx responses; the page's `classifyError` reads that and surfaces
    // the message verbatim for 4xx (R7.5).
    const err = Object.assign(
      new Error('preferences validation failed'),
      { status: 400 },
    );
    mockUpdateLanguagesMutateAsync.mockRejectedValue(err);

    render(<OnboardingPage />);

    await walkToStep4New();

    fireEvent.click(screen.getByRole('button', { name: /finish setup →/ }));

    // Inline error row renders with the server message verbatim.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'preferences validation failed',
      );
    });

    // No redirect.
    expect(mockPush).not.toHaveBeenCalled();

    // CTA re-enabled — `selectCanAdvance` is still true on Step 4.
    const cta = screen.getByRole('button', { name: /finish setup →/ });
    expect(cta).not.toBeDisabled();
  });

  it('shows the generic "something went wrong — try again." message on a 5xx error', async () => {
    setupNewMode();
    const err = Object.assign(new Error('Internal Server Error'), {
      status: 500,
    });
    mockUpdateLanguagesMutateAsync.mockRejectedValue(err);

    render(<OnboardingPage />);

    await walkToStep4New();

    fireEvent.click(screen.getByRole('button', { name: /finish setup →/ }));

    // The em dash below is U+2014 — embedding it directly is the regression
    // guard against someone replacing it with the ASCII fallback `--`.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'something went wrong — try again.',
      );
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('redirects returning users (with profiles, no ?edit=1) via router.replace("/home") and does not render the wizard', async () => {
    // No ?edit=1 search param — `editMode` is false.
    mockSearchParams = new URLSearchParams();
    // Existing profiles → triggers the returning-user redirect effect.
    mockUseLanguageProfiles.mockReturnValue({
      data: {
        profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUseUpdateLanguages.mockReturnValue({
      mutateAsync: mockUpdateLanguagesMutateAsync,
      isPending: false,
      isError: false,
    });
    mockUseUpdatePreferences.mockReturnValue({
      mutateAsync: mockUpdatePreferencesMutateAsync,
      isPending: false,
      isError: false,
    });

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/home');
    });

    // The wizard's Step 1 markup is NOT in the DOM — the page returns null
    // while the redirect is in flight.
    expect(
      screen.queryByRole('group', { name: /learning languages/i }),
    ).not.toBeInTheDocument();
    // And the WizardFooter's "continue →" CTA never renders either.
    expect(
      screen.queryByRole('button', { name: /continue/i }),
    ).not.toBeInTheDocument();
  });
});
