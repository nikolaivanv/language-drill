import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import type {
  ReadEntriesResponse,
  ReadEntryResponse,
} from '@language-drill/api-client';
import { ActiveLanguageProvider } from '../../../components/shell';
import ReadPage from './page';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseLanguageProfiles = vi.fn();
const mockUseReadEntries = vi.fn();
const mockUseReadEntry = vi.fn();
const mockUseReadAnnotate = vi.fn();
const mockUseSaveReadEntry = vi.fn();
const mockUseUpdateReadBank = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  useReadEntries: (...args: unknown[]) => mockUseReadEntries(...args),
  useReadEntry: (...args: unknown[]) => mockUseReadEntry(...args),
  useReadAnnotate: (...args: unknown[]) => mockUseReadAnnotate(...args),
  useSaveReadEntry: (...args: unknown[]) => mockUseSaveReadEntry(...args),
  useUpdateReadBank: (...args: unknown[]) => mockUseUpdateReadBank(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTRY_ID = '11111111-1111-1111-1111-111111111111';
const ENTRY_ID_2 = '22222222-2222-2222-2222-222222222222';

const FLAG_ALDEA = {
  lemma: 'aldea',
  pos: 'noun',
  gloss: 'a small village',
  example: 'la aldea está cerca',
  freq: 4321,
  cefr: CefrLevel.B2,
};

const FULL_ENTRY: ReadEntryResponse = {
  id: ENTRY_ID,
  language: Language.ES,
  title: 'Cien años — ch. 1',
  source: 'García Márquez',
  text: 'aldea grande',
  flaggedWords: { aldea: FLAG_ALDEA },
  bank: [],
  pastedAt: '2026-04-30T12:00:00.000Z',
};

const ENTRIES_3: ReadEntriesResponse = {
  entries: [
    {
      id: ENTRY_ID,
      title: 'Cien años — ch. 1',
      source: 'García Márquez',
      preview: 'aldea grande',
      flaggedCount: 1,
      savedCount: 0,
      pastedAt: '2026-04-30T12:00:00.000Z',
    },
    {
      id: ENTRY_ID_2,
      title: 'second',
      source: '',
      preview: 'el pueblo',
      flaggedCount: 1,
      savedCount: 1,
      pastedAt: '2026-04-29T12:00:00.000Z',
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      title: 'third',
      source: '',
      preview: 'algo',
      flaggedCount: 0,
      savedCount: 0,
      pastedAt: '2026-04-28T12:00:00.000Z',
    },
  ],
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

let annotateMutate: ReturnType<typeof vi.fn>;
let annotateReset: ReturnType<typeof vi.fn>;
let saveMutate: ReturnType<typeof vi.fn>;
let updateBankMutate: ReturnType<typeof vi.fn>;

type MutateImpl = (
  vars: unknown,
  opts?: { onSuccess?: (data: unknown) => void; onError?: (err: Error) => void },
) => void;

function setAnnotate(opts: {
  mutateImpl?: MutateImpl;
  data?: unknown;
  error?: Error | null;
  isPending?: boolean;
} = {}) {
  annotateMutate = vi.fn(opts.mutateImpl ?? (() => {}));
  annotateReset = vi.fn();
  mockUseReadAnnotate.mockReturnValue({
    mutate: annotateMutate,
    reset: annotateReset,
    data: opts.data ?? undefined,
    error: opts.error ?? null,
    isPending: opts.isPending ?? false,
  });
}

function setSave(opts: { mutateImpl?: MutateImpl; isPending?: boolean } = {}) {
  saveMutate = vi.fn(opts.mutateImpl ?? (() => {}));
  mockUseSaveReadEntry.mockReturnValue({
    mutate: saveMutate,
    reset: vi.fn(),
    isPending: opts.isPending ?? false,
    error: null,
  });
}

function setUpdateBank(
  opts: { mutateImpl?: MutateImpl; isPending?: boolean } = {},
) {
  updateBankMutate = vi.fn(opts.mutateImpl ?? (() => {}));
  mockUseUpdateReadBank.mockReturnValue({
    mutate: updateBankMutate,
    reset: vi.fn(),
    isPending: opts.isPending ?? false,
    error: null,
  });
}

function setEntries(data: ReadEntriesResponse | undefined, isLoading = false) {
  mockUseReadEntries.mockReturnValue({
    data,
    isLoading,
    error: null,
    refetch: vi.fn(),
  });
}

function setEntry(data: ReadEntryResponse | undefined, isLoading = false, error: Error | null = null) {
  mockUseReadEntry.mockReturnValue({
    data,
    isLoading,
    error,
    refetch: vi.fn(),
  });
}

function setProfile(level: CefrLevel | null) {
  mockUseLanguageProfiles.mockReturnValue({
    data: {
      profiles:
        level === null
          ? []
          : [{ language: Language.ES, proficiencyLevel: level }],
    },
    isLoading: false,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveLanguageProvider
        profiles={[{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }]}
      >
        <ReadPage />
      </ActiveLanguageProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// beforeEach — clean defaults
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  setProfile(CefrLevel.B1);
  setEntries({ entries: [] });
  setEntry(undefined);
  setAnnotate();
  setSave();
  setUpdateBank();
});

afterEach(() => {
  // Always restore real timers so tests don't leak the fake-timer state.
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReadPage — initial mount', () => {
  it('mount with 0 entries renders the EmptyView', () => {
    renderPage();
    expect(screen.getByText('read in the wild')).toBeInTheDocument();
    expect(screen.getByText("paste anything you're reading.")).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /paste a text/i }),
    ).toBeInTheDocument();
  });

  it('mount with 3 entries auto-resolves to the AnnotatedView for the most recent', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    renderPage();
    expect(screen.getByText('Cien años — ch. 1')).toBeInTheDocument();
    expect(screen.getByText('García Márquez')).toBeInTheDocument();
    // Calibration strip uses B1 profile.
    expect(screen.getByText('~B1+ calibration')).toBeInTheDocument();
    // Word bank rail visible (≥1 flagged).
    expect(screen.getByText('word bank')).toBeInTheDocument();
  });
});

describe('ReadPage — top-bar view switching', () => {
  it('clicking "+ paste new" switches to the PasteView', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste new/i }));
    expect(screen.getByText('paste a passage')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /annotate →/i }),
    ).toBeInTheDocument();
  });

  it('clicking "history" with entries shows the HistoryView', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^history/i }));
    expect(screen.getByText('past texts')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('clicking "history" with no entries shows the HistoryEmptyState', () => {
    setEntries({ entries: [] });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^history/i }));
    expect(
      screen.getByText('no past texts yet — paste one to start.'),
    ).toBeInTheDocument();
  });
});

describe('ReadPage — paste view counter behavior', () => {
  it('typing 1,500 chars enables the CTA and shows the muted counter', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /paste a text/i }));
    const ta = screen.getByLabelText(/passage/i);
    fireEvent.change(ta, { target: { value: 'a'.repeat(1500) } });
    expect(
      screen.getByRole('button', { name: /annotate →/i }),
    ).toBeEnabled();
    const counter = screen.getByText(/1,500 \/ 2,000/);
    expect(counter.className).toContain('text-ink-mute');
    expect(counter.className).not.toContain('text-accent');
  });

  it('typing 2,001 chars disables the CTA and flips the counter to accent', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /paste a text/i }));
    const ta = screen.getByLabelText(/passage/i);
    fireEvent.change(ta, { target: { value: 'a'.repeat(2001) } });
    expect(
      screen.getByRole('button', { name: /annotate →/i }),
    ).toBeDisabled();
    const counter = screen.getByText(/2,001 \/ 2,000 · too long/);
    expect(counter.className).toContain('text-accent');
  });
});

describe('ReadPage — annotate flow', () => {
  it('clicking "annotate →" calls the mutation with the typed text', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /paste a text/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'había una vez' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    expect(annotateMutate).toHaveBeenCalledTimes(1);
    expect(annotateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        language: Language.ES,
        text: 'había una vez',
      }),
      expect.any(Object),
    );
  });

  it('on annotate success, switches to the AnnotatedView with the ephemeral entry', () => {
    setAnnotate({
      mutateImpl: (_vars, opts) => {
        opts?.onSuccess?.({
          flagged: { aldea: FLAG_ALDEA },
          calibration: { cefr: CefrLevel.B1, top: 3000 },
        });
      },
      data: {
        flagged: { aldea: FLAG_ALDEA },
        calibration: { cefr: CefrLevel.B1, top: 3000 },
      },
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /paste a text/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    // After onSuccess, view flips to annotated and the rail shows.
    expect(screen.getByText('word bank')).toBeInTheDocument();
    // The flagged word renders as a button.
    expect(
      screen.getByRole('button', { name: 'aldea' }),
    ).toBeInTheDocument();
  });

  it('annotation 429 surfaces in PasteView and disables the annotate button (Req 11.4)', () => {
    const error = new Error("you've hit today's evaluation limit (50). it resets daily.");
    (error as Error & { status?: number }).status = 429;
    setAnnotate({ error });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /paste a text/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'había una vez' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/evaluation limit/i);
    expect(
      screen.getByRole('button', { name: /annotate →/i }),
    ).toBeDisabled();
  });
});

describe('ReadPage — popover + bank flow', () => {
  it('clicking a flagged word opens the popover', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('a small village')).toBeInTheDocument();
  });

  it('clicking "save to bank" inside the popover fires the bank-update mutation', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to bank/i }),
    );
    expect(updateBankMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ENTRY_ID,
        language: Language.ES,
        bank: ['aldea'],
      }),
      expect.any(Object),
    );
  });

  it('bank-update failure shows the inline error toast (Req 11.6)', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    setUpdateBank({
      mutateImpl: (_vars, opts) => {
        opts?.onError?.(new Error('network down'));
      },
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to bank/i }),
    );
    expect(
      screen.getByText("couldn't update — try again"),
    ).toBeInTheDocument();
  });
});

describe('ReadPage — save flow + toast', () => {
  it('clicking "save N to bank →" fires the save mutation and shows the SaveToast on success', () => {
    setAnnotate({
      mutateImpl: (_vars, opts) =>
        opts?.onSuccess?.({
          flagged: { aldea: FLAG_ALDEA },
          calibration: { cefr: CefrLevel.B1, top: 3000 },
        }),
      data: {
        flagged: { aldea: FLAG_ALDEA },
        calibration: { cefr: CefrLevel.B1, top: 3000 },
      },
    });
    setSave({
      mutateImpl: (_vars, opts) =>
        opts?.onSuccess?.({ id: ENTRY_ID, pastedAt: '2026-05-05T00:00:00.000Z' }),
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /paste a text/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to bank/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /save 1 to bank →/i }),
    );
    expect(saveMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/1 word added/);
    expect(screen.getByRole('status')).toHaveTextContent(
      /your next session will weave them in/,
    );
  });

  it('SaveToast auto-dismisses after 4 seconds (Req 8.3)', () => {
    vi.useFakeTimers();
    setAnnotate({
      mutateImpl: (_vars, opts) =>
        opts?.onSuccess?.({
          flagged: { aldea: FLAG_ALDEA },
          calibration: { cefr: CefrLevel.B1, top: 3000 },
        }),
      data: {
        flagged: { aldea: FLAG_ALDEA },
        calibration: { cefr: CefrLevel.B1, top: 3000 },
      },
    });
    setSave({
      mutateImpl: (_vars, opts) =>
        opts?.onSuccess?.({ id: ENTRY_ID, pastedAt: '2026-05-05T00:00:00.000Z' }),
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /paste a text/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to bank/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /save 1 to bank →/i }),
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('"see next session" routes to /drill', () => {
    setAnnotate({
      mutateImpl: (_vars, opts) =>
        opts?.onSuccess?.({
          flagged: { aldea: FLAG_ALDEA },
          calibration: { cefr: CefrLevel.B1, top: 3000 },
        }),
      data: {
        flagged: { aldea: FLAG_ALDEA },
        calibration: { cefr: CefrLevel.B1, top: 3000 },
      },
    });
    setSave({
      mutateImpl: (_vars, opts) =>
        opts?.onSuccess?.({ id: ENTRY_ID, pastedAt: '2026-05-05T00:00:00.000Z' }),
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /paste a text/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to bank/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /save 1 to bank →/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /see next session/i }),
    );
    expect(mockPush).toHaveBeenCalledWith('/drill');
  });
});

describe('ReadPage — history → entry load', () => {
  it('clicking a history card swaps to the AnnotatedView for that entry', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^history/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cien años/i }));
    // After clicking the card the page is back on the annotated view (the
    // entry was already cached because we mocked useReadEntry to resolve).
    expect(screen.getByText('word bank')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'aldea' }),
    ).toBeInTheDocument();
  });

  it('renders the AnnotatedSkeleton while a pinned entry is loading', () => {
    setEntries(ENTRIES_3);
    // Entry query is in-flight: data undefined, isLoading true.
    setEntry(undefined, true);
    renderPage();
    expect(screen.getByTestId('annotated-skeleton')).toBeInTheDocument();
    expect(screen.getByText('annotating…')).toBeInTheDocument();
  });
});
