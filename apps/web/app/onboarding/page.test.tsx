// ---------------------------------------------------------------------------
// OnboardingPage integration tests (task 32a)
// ---------------------------------------------------------------------------
// Locks the page-level happy path + the most common failure modes:
//   - new mode: 0 profiles → wizard mounts on Step 1 → walk through Steps 1–4
//     → submit calls `useSavePreferences.mutateAsync` with the expected payload
//     → `router.push('/')`.
//   - edit mode: existing profiles + prefs hydrate Steps 1–4 and the final
//     CTA reads "save changes →".
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
//     `useGetPreferences`, `useSavePreferences` are mocked while
//     `createAuthenticatedFetch` is preserved from `vi.importActual` so the
//     page can construct a fetcher without hitting the network.
//
// Helpers:
//   - `setupNewMode()` / `setupEditMode()` configure the hook return values
//     for each scenario.
//   - `walkToStep4New()` / `walkToStep4Edit()` drive the wizard through Steps
//     1–3 by interacting with the rendered tiles, leaving the user on Step 4.
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
  type LanguageProfile,
} from '@language-drill/shared';
import type { PreferencesResponse } from '@language-drill/api-client';
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
const mockUseGetPreferences = vi.fn();
const mockMutateAsync = vi.fn();
const mockUseSavePreferences = vi.fn();

vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<
    typeof import('@language-drill/api-client')
  >('@language-drill/api-client');
  return {
    ...actual,
    useLanguageProfiles: () => mockUseLanguageProfiles(),
    useGetPreferences: () => mockUseGetPreferences(),
    useSavePreferences: () => mockUseSavePreferences(),
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
  mockUseGetPreferences.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockUseSavePreferences.mockReturnValue({
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
  });
}

function setupEditMode(opts: {
  profiles: LanguageProfile[];
  prefs: PreferencesResponse;
}) {
  mockSearchParams = new URLSearchParams('edit=1');
  mockUseLanguageProfiles.mockReturnValue({
    data: { profiles: opts.profiles },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockUseGetPreferences.mockReturnValue({
    data: opts.prefs,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockUseSavePreferences.mockReturnValue({
    mutateAsync: mockMutateAsync,
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

  // Step 2: pick CEFR B2 (4th radio in the proficiency-level group; CEFR
  // order is A1, A2, B1, B2, C1, C2 — see CEFR_LEVELS in step-level.tsx).
  // The on-mount setPrimary effect already set ES as the primary because
  // exactly one language is selected.
  const cefrGroup = await screen.findByRole('radiogroup', {
    name: /proficiency level/i,
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

/**
 * Drive an edit-mode wizard with pre-filled state from Step 1 → Step 4
 * without touching anything. Each `findBy*` call doubles as an assertion
 * that the corresponding step rendered with hydrated state.
 */
async function walkToStep4Edit() {
  // Step 1 is rendered with pre-filled checkboxes — click continue.
  await screen.findByRole('group', { name: /learning languages/i });
  fireEvent.click(screen.getByTestId('wizard-footer-primary'));

  // Step 2 — primary already set, level already set; click continue.
  await screen.findByRole('radiogroup', { name: /proficiency level/i });
  fireEvent.click(screen.getByTestId('wizard-footer-primary'));

  // Step 3 — goals + notes pre-filled; click continue.
  await screen.findByRole('group', { name: /goals/i });
  fireEvent.click(screen.getByTestId('wizard-footer-primary'));

  // Step 4 — daily time pre-filled.
  await screen.findByRole('radiogroup', { name: /daily time/i });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// document.referrer stubbing
// ---------------------------------------------------------------------------
// JSDOM exposes `document.referrer` as a read-only getter. To drive it from
// tests we override the property descriptor with a custom getter — same shape
// as `Object.defineProperty(window, 'location', ...)` in
// `apps/web/components/shell/__tests__/language-switcher.test.tsx`. JSDOM's
// default `window.location.origin` is `http://localhost:3000` (see vitest's
// JSDOM env), so we can build same-origin referrers directly off that without
// stubbing `window.location` at all — keeping the test surface small.
// ---------------------------------------------------------------------------

function setReferrer(value: string) {
  Object.defineProperty(document, 'referrer', {
    configurable: true,
    get: () => value,
  });
}

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    setReferrer('');
  });

  it('walks through Steps 1–4 in new mode, submits with the expected payload, and redirects to /', async () => {
    setupNewMode();
    mockMutateAsync.mockResolvedValue({
      profiles: [],
      preferences: {
        primaryLanguage: Language.ES,
        goals: [],
        dailyMinutes: 10,
        gentleNudges: true,
        notes: '',
      },
    });

    render(<OnboardingPage />);

    await walkToStep4New();

    // Step 4 CTA reads "finish setup →" in new mode (R1.5).
    const cta = screen.getByRole('button', { name: /finish setup →/ });
    expect(cta).toBeInTheDocument();
    fireEvent.click(cta);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    // The wire payload mirrors the wizard reducer state at submit time:
    // 1 selected language (ES), ES as primary, B2 level, no goals, empty
    // notes, default 10 daily minutes, gentle nudges left at the default
    // (true). `useSavePreferences` is responsible for expanding `languages`
    // into the `profiles[]` shape and normalising notes — those concerns
    // are tested in `packages/api-client/src/hooks/usePreferences.test.ts`.
    expect(mockMutateAsync).toHaveBeenCalledWith({
      languages: [Language.ES],
      primaryLanguage: Language.ES,
      primaryLevel: CefrLevel.B2,
      goals: [],
      notes: '',
      dailyMinutes: 10,
      gentleNudges: true,
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('pre-fills all 4 steps from existing profiles + prefs in edit mode and the final CTA reads "save changes →"', async () => {
    setupEditMode({
      profiles: [
        { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
        { language: Language.DE, proficiencyLevel: CefrLevel.A1 },
      ],
      prefs: {
        primaryLanguage: Language.ES,
        goals: ['grammar', 'speaking'],
        dailyMinutes: 20,
        gentleNudges: false,
        notes: 'practice subjunctive',
      },
    });

    render(<OnboardingPage />);

    // Step 1: ES + DE pre-selected, TR not selected.
    const step1Group = await screen.findByRole('group', {
      name: /learning languages/i,
    });
    const tiles = within(step1Group).getAllByRole('checkbox');
    expect(tiles[0]).toHaveAttribute('aria-checked', 'true'); // ES
    expect(tiles[1]).toHaveAttribute('aria-checked', 'true'); // DE
    expect(tiles[2]).toHaveAttribute('aria-checked', 'false'); // TR

    await walkToStep4Edit();

    // Step 4 CTA in edit mode reads "save changes →" (R1.5).
    const cta = screen.getByRole('button', { name: /save changes →/ });
    expect(cta).toBeInTheDocument();
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
    mockMutateAsync.mockRejectedValue(err);

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
    mockMutateAsync.mockRejectedValue(err);

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

  // -------------------------------------------------------------------------
  // Redirect cases (task 32b)
  // -------------------------------------------------------------------------
  // Locks the open-redirect guard in `sameOriginReferrer()` and the
  // returning-user redirect that fires from a `useEffect` watching
  // `profilesQuery.data` + `editMode`. The submit cases reuse
  // `setupEditMode()` + `walkToStep4Edit()` from the happy-path suite — the
  // only delta is `document.referrer`. The returning-user case wires the
  // hooks directly so we can assert the wizard never mounts.
  // -------------------------------------------------------------------------

  it('redirects to document.referrer in edit mode when the referrer is same-origin', async () => {
    setupEditMode({
      profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
      prefs: {
        primaryLanguage: Language.ES,
        goals: [],
        dailyMinutes: 10,
        gentleNudges: true,
        notes: '',
      },
    });
    mockMutateAsync.mockResolvedValue({ profiles: [], preferences: {} });

    // Same-origin referrer — JSDOM's window.location.origin is
    // http://localhost:3000, so this is a same-origin URL.
    const sameOriginReferrer = `${window.location.origin}/dashboard?from=settings`;
    setReferrer(sameOriginReferrer);

    render(<OnboardingPage />);

    await walkToStep4Edit();
    fireEvent.click(screen.getByRole('button', { name: /save changes →/ }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(sameOriginReferrer);
    });
    // Did NOT fall back to /settings.
    expect(mockPush).not.toHaveBeenCalledWith('/settings');
  });

  it('falls back to /settings in edit mode when the referrer is cross-origin', async () => {
    setupEditMode({
      profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
      prefs: {
        primaryLanguage: Language.ES,
        goals: [],
        dailyMinutes: 10,
        gentleNudges: true,
        notes: '',
      },
    });
    mockMutateAsync.mockResolvedValue({ profiles: [], preferences: {} });

    // Cross-origin referrer — the open-redirect guard must reject this.
    const crossOriginReferrer = 'https://evil.example.com/whatever';
    setReferrer(crossOriginReferrer);

    render(<OnboardingPage />);

    await walkToStep4Edit();
    fireEvent.click(screen.getByRole('button', { name: /save changes →/ }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/settings');
    });
    // Critical: never redirect to the cross-origin URL.
    expect(mockPush).not.toHaveBeenCalledWith(crossOriginReferrer);
  });

  it('falls back to /settings in edit mode when document.referrer is empty', async () => {
    setupEditMode({
      profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
      prefs: {
        primaryLanguage: Language.ES,
        goals: [],
        dailyMinutes: 10,
        gentleNudges: true,
        notes: '',
      },
    });
    mockMutateAsync.mockResolvedValue({ profiles: [], preferences: {} });

    // Explicit empty referrer (also the beforeEach default — explicit here
    // so the case reads end-to-end without hopping back to the hook).
    setReferrer('');

    render(<OnboardingPage />);

    await walkToStep4Edit();
    fireEvent.click(screen.getByRole('button', { name: /save changes →/ }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/settings');
    });
  });

  it('redirects returning users (with profiles, no ?edit=1) via router.replace("/") and does not render the wizard', async () => {
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
    mockUseGetPreferences.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUseSavePreferences.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
    });

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/');
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
