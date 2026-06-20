import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import type { DeepCard, FlaggedMap, WordFlag } from '@language-drill/shared';
import type {
  ReadEntriesResponse,
  ReadEntryResponse,
} from '@language-drill/api-client';
import { ActiveLanguageProvider } from '../../../components/shell';
import ReadPage from './page';
import wordFlagStyles from './_components/word-flag-styles.module.css';

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
const mockUseReadAnnotateStream = vi.fn();
const mockUseSaveReadEntry = vi.fn();
const mockUseUpdateReadBank = vi.fn();
const mockUseReadAnnotateSpanStream = vi.fn();
const mockUseSaveVocabularyCard = vi.fn();
const mockUseDeleteVocabularyCard = vi.fn();
const mockUseGenerateReadingText = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  useReadEntries: (...args: unknown[]) => mockUseReadEntries(...args),
  useReadEntry: (...args: unknown[]) => mockUseReadEntry(...args),
  useReadAnnotateStream: (...args: unknown[]) =>
    mockUseReadAnnotateStream(...args),
  useSaveReadEntry: (...args: unknown[]) => mockUseSaveReadEntry(...args),
  useUpdateReadBank: (...args: unknown[]) => mockUseUpdateReadBank(...args),
  useReadAnnotateSpanStream: (...args: unknown[]) =>
    mockUseReadAnnotateSpanStream(...args),
  useSaveVocabularyCard: (...args: unknown[]) =>
    mockUseSaveVocabularyCard(...args),
  useDeleteVocabularyCard: (...args: unknown[]) =>
    mockUseDeleteVocabularyCard(...args),
  useGenerateReadingText: (...args: unknown[]) =>
    mockUseGenerateReadingText(...args),
  // Under-review highlight source (Req 13.2) — default to no active lemmas so
  // existing reader assertions are unaffected.
  useActiveReviewLemmas: () => ({ data: { lemmas: [], surfaces: [] } }),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTRY_ID = '11111111-1111-1111-1111-111111111111';
const ENTRY_ID_2 = '22222222-2222-2222-2222-222222222222';

const FLAG_ALDEA: WordFlag = {
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
// Mock helpers — streaming annotate hook
// ---------------------------------------------------------------------------
//
// The new hook contract is `{ state, start, abort, reset }` where `state`
// is a discriminated union over `phase`. The mock returns whatever value
// is currently stored in `currentAnnotateState`; tests can mutate that
// directly (and call `rerender(...)`) or via `annotateStart.mockImplementation`
// to flip the state when the page calls `start(...)`.

type Calibration = { cefr: string; top: number };

type AnnotateStreamState =
  | { phase: 'idle' }
  | {
      phase: 'streaming';
      candidateCount: number;
      flaggedMap: FlaggedMap;
      flaggedCount: number;
      calibration: Calibration;
    }
  | {
      phase: 'complete';
      candidateCount: number;
      flaggedMap: FlaggedMap;
      flaggedCount: number;
      calibration: Calibration;
    }
  | {
      phase: 'error';
      candidateCount?: number;
      flaggedMap: FlaggedMap;
      flaggedCount: number;
      calibration?: Calibration;
      error: { code: string; message: string; status?: number };
    };

let annotateStart: ReturnType<typeof vi.fn>;
let annotateAbort: ReturnType<typeof vi.fn>;
let annotateResetMock: ReturnType<typeof vi.fn>;
let currentAnnotateState: AnnotateStreamState = { phase: 'idle' };

function setAnnotateState(state: AnnotateStreamState) {
  currentAnnotateState = state;
}

function resetAnnotateMock() {
  currentAnnotateState = { phase: 'idle' };
  annotateStart = vi.fn();
  annotateAbort = vi.fn();
  annotateResetMock = vi.fn();
  mockUseReadAnnotateStream.mockImplementation(() => ({
    state: currentAnnotateState,
    start: annotateStart,
    abort: annotateAbort,
    reset: annotateResetMock,
  }));
}

// Convenience: stub `start` so calling it flips the hook into `complete`
// with the provided flagged map. The page re-renders synchronously after
// the click handler dispatches reducer actions, so the next read of
// `mockUseReadAnnotateStream` returns the freshly-mutated state.
function stubAnnotateCompleteOnStart(
  flagged: FlaggedMap = { aldea: FLAG_ALDEA },
) {
  annotateStart.mockImplementation(() => {
    setAnnotateState({
      phase: 'complete',
      flaggedMap: flagged,
      flaggedCount: Object.keys(flagged).length,
      candidateCount: Object.keys(flagged).length,
      calibration: { cefr: 'B1', top: 3000 },
    });
  });
}

// ---------------------------------------------------------------------------
// Mock helpers — streaming deep-span hook (useReadAnnotateSpanStream)
// ---------------------------------------------------------------------------
//
// The deep card now streams: the hook contract is `{ state, start, abort,
// reset }` where `state` is `{ phase: 'idle' | 'streaming' | 'complete' |
// 'error' }`. The page mirrors that state into its reducer's `deepCard` slice
// via an effect, so flipping `currentSpanState` on `start(...)` drives the
// progressive → terminal render. `stub*OnStart` helpers wire `start` to flip
// the phase synchronously; the page re-renders off the reducer dispatch in
// `handleSpanSelect`, so the next read of the mock returns the new state.

type SpanReq = {
  language: Language;
  text: string;
  start: number;
  end: number;
  entryId?: string;
};

type DeepCardStreamState =
  | { phase: 'idle' }
  | { phase: 'streaming'; partial: Record<string, unknown>; span: SpanReq }
  | { phase: 'complete'; card: DeepCard; span: SpanReq }
  | {
      phase: 'error';
      error: { code: string; message: string; status?: number };
      span: SpanReq;
    };

let spanStart: ReturnType<typeof vi.fn>;
let spanAbort: ReturnType<typeof vi.fn>;
let spanResetMock: ReturnType<typeof vi.fn>;
let currentSpanState: DeepCardStreamState = { phase: 'idle' };
let lastSpanOnResolved: ((card: DeepCard, span: SpanReq) => void) | undefined;

function setSpanState(state: DeepCardStreamState) {
  currentSpanState = state;
}

function resetSpanMock() {
  currentSpanState = { phase: 'idle' };
  spanStart = vi.fn();
  spanAbort = vi.fn();
  spanResetMock = vi.fn();
  lastSpanOnResolved = undefined;
  mockUseReadAnnotateSpanStream.mockImplementation(
    (opts: { onResolved?: (card: DeepCard, span: SpanReq) => void } = {}) => {
      lastSpanOnResolved = opts.onResolved;
      return {
        state: currentSpanState,
        start: spanStart,
        abort: spanAbort,
        reset: spanResetMock,
      };
    },
  );
}

// `start` → terminal `complete`: the stream resolves immediately with `card`
// and fires `onResolved` (the page's entry-cache write-through), exactly as a
// `done` frame would.
function stubSpanCompleteOnStart(card: DeepCard) {
  spanStart.mockImplementation((input: SpanReq) => {
    setSpanState({ phase: 'complete', card, span: input });
    lastSpanOnResolved?.(card, input);
  });
}

// `start` → `streaming` and STAYS there (no terminal): the deep card slice
// stays `loading`, so the chrome shows the progressive/loading state.
function stubSpanStreamingOnStart(partial: Record<string, unknown>) {
  spanStart.mockImplementation((input: SpanReq) => {
    setSpanState({ phase: 'streaming', partial, span: input });
  });
}

// `start` → terminal `error`: mirrors a mid-stream upstream failure (Req 1.5).
function stubSpanErrorOnStart(error: {
  code: string;
  message: string;
  status?: number;
}) {
  spanStart.mockImplementation((input: SpanReq) => {
    setSpanState({ phase: 'error', error, span: input });
  });
}

// ---------------------------------------------------------------------------
// Mock helpers — other hooks
// ---------------------------------------------------------------------------

let saveMutate: ReturnType<typeof vi.fn>;
let updateBankMutate: ReturnType<typeof vi.fn>;
let saveVocabMutate: ReturnType<typeof vi.fn>;
let deleteVocabMutate: ReturnType<typeof vi.fn>;
let generateMutate: ReturnType<typeof vi.fn>;

type MutateImpl = (
  vars: unknown,
  opts?: { onSuccess?: (data: unknown) => void; onError?: (err: Error) => void },
) => void;

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

function setVocabMutations(
  opts: { saveImpl?: MutateImpl; deleteImpl?: MutateImpl } = {},
) {
  saveVocabMutate = vi.fn(opts.saveImpl ?? (() => {}));
  deleteVocabMutate = vi.fn(opts.deleteImpl ?? (() => {}));
  mockUseSaveVocabularyCard.mockReturnValue({
    mutate: saveVocabMutate,
    reset: vi.fn(),
    isPending: false,
    error: null,
  });
  mockUseDeleteVocabularyCard.mockReturnValue({
    mutate: deleteVocabMutate,
    reset: vi.fn(),
    isPending: false,
    error: null,
  });
}

function setGenerate(
  opts: { mutateImpl?: MutateImpl; isPending?: boolean; error?: Error | null } = {},
) {
  generateMutate = vi.fn(opts.mutateImpl ?? (() => {}));
  mockUseGenerateReadingText.mockReturnValue({
    mutate: generateMutate,
    reset: vi.fn(),
    isPending: opts.isPending ?? false,
    error: opts.error ?? null,
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
  resetAnnotateMock();
  setSave();
  setUpdateBank();
  resetSpanMock();
  setVocabMutations();
  setGenerate();
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
    expect(screen.getByText('nothing to read yet.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /generate a passage/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /or paste your own/i }),
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
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
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
    // The redesigned library renders each entry as a clickable card button.
    expect(
      screen.getByRole('button', { name: /Cien años — ch\. 1/i }),
    ).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    const ta = screen.getByLabelText(/passage/i);
    fireEvent.change(ta, { target: { value: 'a'.repeat(2001) } });
    expect(
      screen.getByRole('button', { name: /annotate →/i }),
    ).toBeDisabled();
    const counter = screen.getByText(/2,001 \/ 2,000 · too long/);
    expect(counter.className).toContain('text-accent');
  });
});

describe('ReadPage — generate flow', () => {
  it('clicking "generate a text" from the EmptyView opens the GenerateView', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ generate/i }));
    expect(screen.getByText('generate a passage')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /generate a passage/i }),
    ).toBeInTheDocument();
  });

  it('a successful generation feeds the text into the annotate pipeline', () => {
    // The generate mutation immediately resolves onSuccess with a passage; the
    // page mirrors it into paste state and fires the streaming annotate hook.
    setGenerate({
      mutateImpl: (_vars, opts) => {
        opts?.onSuccess?.({
          title: 'El gato',
          text: 'un gato pequeño',
          cefr: CefrLevel.A2,
          difficultyScore: 0.1,
          fromCache: false,
          runsHard: false,
        });
      },
    });
    annotateStart.mockImplementation(() => {
      setAnnotateState({
        phase: 'streaming',
        candidateCount: 0,
        flaggedMap: {},
        flaggedCount: 0,
        calibration: { cefr: 'A2', top: 0 },
      });
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ generate/i }));
    fireEvent.change(screen.getByLabelText(/what to read about/i), {
      target: { value: 'a cat' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate a passage/i }));
    // Mutation fired with the form's selections.
    expect(generateMutate).toHaveBeenCalledTimes(1);
    expect(generateMutate.mock.calls[0][0]).toMatchObject({ topic: 'a cat' });
    // Annotate started against the GENERATED text (not stale paste state).
    expect(annotateStart).toHaveBeenCalledWith({
      language: Language.ES,
      text: 'un gato pequeño',
    });
    // The annotated reader shows the generated text.
    expect(screen.getByTestId('rd-text')).toHaveTextContent('un gato pequeño');
  });

  it('surfaces the generation error body in the GenerateView', () => {
    setGenerate({ error: new Error('the model is busy') });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ generate/i }));
    expect(screen.getByText('the model is busy')).toBeInTheDocument();
  });
});

describe('ReadPage — streaming annotate flow', () => {
  it('clicking "annotate →" transitions to the annotated view immediately and shows the raw text before any flags arrive (Req 5.1)', () => {
    // Keep state idle: the streaming events never "arrive" in this test.
    // The view flip is driven by the reducer dispatch inside handleAnnotate,
    // not by the hook's state — so the raw text must render before any flag
    // events. NOTE: with phase='idle', the page renders <AnnotatedSkeleton />
    // (no annotatedEntry yet) — see the "shows raw text DURING streaming"
    // case below for the post-START render path.
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'había una vez' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    // The hook's `start` is called with the typed text.
    expect(annotateStart).toHaveBeenCalledTimes(1);
    expect(annotateStart).toHaveBeenCalledWith({
      language: Language.ES,
      text: 'había una vez',
    });
  });

  it('shows the raw pasted text during streaming, before any flagged word arrives', () => {
    // Simulate hook entering `streaming` with empty flaggedMap on `start`.
    annotateStart.mockImplementation(() => {
      setAnnotateState({
        phase: 'streaming',
        candidateCount: 0,
        flaggedMap: {},
        flaggedCount: 0,
        calibration: { cefr: 'B1', top: 0 },
      });
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    // Reader text is visible (rendered inside the AnnotatedView).
    expect(screen.getByTestId('rd-text')).toHaveTextContent('aldea grande');
    // Every word is now tappable (tap-any-word, Req 3.2), but with an empty
    // flaggedMap none carries the flagged-highlight styling yet.
    const aldea = screen.getByRole('button', { name: 'aldea' });
    expect(aldea.className).not.toContain(wordFlagStyles.subtle);
    expect(aldea.className).not.toContain(wordFlagStyles.assertive);
    expect(aldea.className).not.toContain(wordFlagStyles.saved);
  });

  it('renders the progress strip during streaming and increments flaggedCount as flags arrive (Req 5.3)', () => {
    // Click happens while idle (so PasteView is interactive). `start` flips
    // the hook into `streaming { candidateCount: 5, flaggedCount: 0 }`.
    annotateStart.mockImplementation(() => {
      setAnnotateState({
        phase: 'streaming',
        candidateCount: 5,
        flaggedMap: {},
        flaggedCount: 0,
        calibration: { cefr: 'B1', top: 3000 },
      });
    });
    const { rerender } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));

    // Initial: 0 / 5
    expect(screen.getByText(/annotating · 0 \/ 5/)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '5');

    // Advance: 2 flags arrived. The reducer (in real life) would receive
    // FLAG events; here we mutate the mock state and force a re-render via
    // the rerender helper.
    setAnnotateState({
      phase: 'streaming',
      candidateCount: 5,
      flaggedMap: { aldea: FLAG_ALDEA },
      flaggedCount: 2,
      calibration: { cefr: 'B1', top: 3000 },
    });
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ActiveLanguageProvider
          profiles={[{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }]}
        >
          <ReadPage />
        </ActiveLanguageProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/annotating · 2 \/ 5/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
  });

  it('a bank toggle during streaming updates local state but does NOT lazy-POST the entry (Req 5.8)', () => {
    // The Req 5.8 "save disabled until complete" guard now lives inside
    // `handleBankToggle`: a toggle while `phase !== 'complete'` skips the POST.
    annotateStart.mockImplementation(() => {
      setAnnotateState({
        phase: 'streaming',
        candidateCount: 1,
        flaggedMap: { aldea: FLAG_ALDEA },
        flaggedCount: 1,
        calibration: { cefr: 'B1', top: 3000 },
      });
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to bank/i }),
    );
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it('a bank toggle on a stream-error state does NOT lazy-POST the entry (Req 5.8)', () => {
    annotateStart.mockImplementation(() => {
      setAnnotateState({
        phase: 'error',
        candidateCount: 1,
        flaggedMap: { aldea: FLAG_ALDEA },
        flaggedCount: 1,
        calibration: { cefr: 'B1', top: 3000 },
        error: { code: 'AI_UNAVAILABLE', message: 'down', status: 502 },
      });
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    // Partial flags survive into the error state, so the popover still opens.
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to bank/i }),
    );
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it('banking a flagged word from the skim card refetches the entry so it surfaces in the word bank', () => {
    // Regression: flagged-word saves go through the bank PUT, which materialises
    // a vocab row server-side. Without a follow-up refetch the word never
    // appeared in the (vocab-driven) word-bank panel until reload — while
    // non-flagged on-demand saves showed at once. We invalidate the entry query
    // on PUT success so both behave the same.
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    setUpdateBank({
      mutateImpl: (_vars, opts) => opts?.onSuccess?.({ id: ENTRY_ID, bank: ['aldea'] }),
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(screen.getByRole('button', { name: /\+ save to bank/i }));

    expect(updateBankMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: ENTRY_ID, bank: ['aldea'] }),
      expect.anything(),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['readEntry', ENTRY_ID],
    });
    invalidateSpy.mockRestore();
  });

  it('un-banking a flagged word from the skim card deletes its vocabulary row', () => {
    // The word-bank panel is vocab-driven, so un-saving a flagged word must drop
    // the materialised vocab row (the same delete the panel ✕ runs) — not just
    // the bank membership — or the word would linger in the panel.
    setEntries(ENTRIES_3);
    setEntry({
      ...FULL_ENTRY,
      bank: ['aldea'],
      savedVocab: [
        {
          id: 'vocab-aldea',
          word: 'aldea',
          lemma: 'aldea',
          gloss: 'a small village',
          type: 'word',
          cefr: CefrLevel.B2,
        },
      ],
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    // Already banked → the skim card shows the saved/undo affordance.
    fireEvent.click(screen.getByRole('button', { name: /✓ saved · undo/i }));

    expect(deleteVocabMutate).toHaveBeenCalledWith(
      'vocab-aldea',
      expect.anything(),
    );
    // And the bank PUT drops the membership too.
    expect(updateBankMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: ENTRY_ID, bank: [] }),
      expect.anything(),
    );
  });

  it('error event with partial flags retains the AnnotatedView (and does NOT surface the inline AnnotatedError card) — Req 5.6, 5.10', () => {
    // start flips to error WITH a partial flag already buffered.
    annotateStart.mockImplementation(() => {
      setAnnotateState({
        phase: 'error',
        candidateCount: 5,
        flaggedMap: { aldea: FLAG_ALDEA },
        flaggedCount: 1,
        error: { code: 'AI_UNAVAILABLE', message: 'down', status: 502 },
      });
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    // Partial flagged word still rendered.
    expect(
      screen.getByRole('button', { name: 'aldea' }),
    ).toBeInTheDocument();
    // The dedicated AnnotatedError heading is NOT shown.
    expect(
      screen.queryByText("couldn't annotate this"),
    ).not.toBeInTheDocument();
  });

  it('error event with zero partial flags surfaces the AnnotatedError card (Req 5.6)', () => {
    annotateStart.mockImplementation(() => {
      setAnnotateState({
        phase: 'error',
        candidateCount: 0,
        flaggedMap: {},
        flaggedCount: 0,
        error: {
          code: 'AI_UNAVAILABLE',
          message: 'something went wrong — try again',
          status: 502,
        },
      });
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'foo bar baz' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    expect(screen.getByText("couldn't annotate this")).toBeInTheDocument();
    expect(
      screen.getByText('something went wrong — try again'),
    ).toBeInTheDocument();
  });

  it('clicking "+ paste new" mid-stream calls abort and reset on the hook (Req 5.7)', () => {
    // Click annotate while idle so the PasteView is interactive; `start`
    // flips the hook into `streaming` so the AnnotatedView (with the
    // "+ paste new" button in the top bar) is rendered.
    annotateStart.mockImplementation(() => {
      setAnnotateState({
        phase: 'streaming',
        candidateCount: 5,
        flaggedMap: { aldea: FLAG_ALDEA },
        flaggedCount: 1,
        calibration: { cefr: 'B1', top: 3000 },
      });
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    // Sanity: streaming + flagged word visible.
    expect(screen.getByText(/annotating · 1 \/ 5/)).toBeInTheDocument();
    // Click "+ paste new" — should abort and reset.
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    expect(annotateAbort).toHaveBeenCalled();
    expect(annotateResetMock).toHaveBeenCalled();
  });

  it('annotation rate-limit (429) error surfaces in the AnnotatedError card with "try again" disabled (Req 11.4)', () => {
    annotateStart.mockImplementation(() => {
      setAnnotateState({
        phase: 'error',
        candidateCount: 0,
        flaggedMap: {},
        flaggedCount: 0,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: "you've hit today's evaluation limit (50). it resets daily.",
          status: 429,
        },
      });
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'había una vez' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    // After the click, the view flips to 'annotated' and renders AnnotatedError.
    expect(screen.getByText("couldn't annotate this")).toBeInTheDocument();
    expect(screen.getByText(/evaluation limit/i)).toBeInTheDocument();
    // Per Req 11.4 the "try again" button is disabled for rate-limit kind.
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeDisabled();
    // "edit text" is still enabled so the user can go back to PasteView.
    expect(
      screen.getByRole('button', { name: /edit text/i }),
    ).toBeEnabled();
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

describe('ReadPage — deep annotation flow (Req 3, 9.4, 11)', () => {
  // 'aldea' occupies offsets [0,5) in 'aldea grande'.
  const DEEP_ALDEA: NonNullable<ReadEntryResponse['spanAnnotations']>[string] = {
    type: 'word',
    surface: 'aldea',
    lemma: 'aldea',
    pos: 'noun',
    contextualSense: 'a small rural settlement',
    definition: 'pueblo pequeño',
    definitionLabel: 'Español',
    cefr: CefrLevel.B2,
    freq: 4321,
  };

  it('tapping a word starts the deep stream with the passage text, offsets, and entryId (Req 3.2, 3.4)', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    expect(spanStart).toHaveBeenCalledTimes(1);
    expect(spanStart).toHaveBeenCalledWith({
      language: Language.ES,
      text: 'aldea grande',
      start: 0,
      end: 5,
      entryId: ENTRY_ID,
    });
  });

  it('renders a persisted span instantly and does NOT start the stream (Req 11.3, 11.4, 2.8)', () => {
    setEntries(ENTRIES_3);
    setEntry({ ...FULL_ENTRY, spanAnnotations: { '0:5': DEEP_ALDEA } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    // Loaded deep card renders from the seeded snapshot…
    expect(screen.getByText('pueblo pequeño')).toBeInTheDocument();
    // …and the stream is never started.
    expect(spanStart).not.toHaveBeenCalled();
  });

  it('shows a field mid-stream then swaps to the deep card on the terminal done (Req 1.2, 1.3, 3.3)', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    // First tap keeps the stream in `streaming`: the deep slice stays
    // `loading`, so the chrome shows the skim card + the "looking it up…"
    // indicator — a field is visible mid-stream (Req 1.2).
    stubSpanStreamingOnStart({ contextualSense: 'a small rural settlement' });
    const { unmount } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    expect(spanStart).toHaveBeenCalledTimes(1);
    expect(screen.getByText('a small village')).toBeInTheDocument();
    expect(screen.getByTestId('skim-loading-deep')).toBeInTheDocument();
    // The deep card body has not replaced the skim preview yet.
    expect(screen.queryByText('pueblo pequeño')).not.toBeInTheDocument();
    unmount();

    // A terminal `done` swaps the authoritative deep card in (Req 1.3).
    stubSpanCompleteOnStart(DEEP_ALDEA);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    expect(screen.getByText('pueblo pequeño')).toBeInTheDocument();
  });

  it('a repeat tap within the session renders from cache with no new stream (Req 2.8)', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    stubSpanCompleteOnStart(DEEP_ALDEA);
    renderPage();
    // First tap resolves and seeds the reducer's spanAnnotations session map.
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    expect(screen.getByText('pueblo pequeño')).toBeInTheDocument();
    expect(spanStart).toHaveBeenCalledTimes(1);
    // Re-tap the same span — the OPEN_DEEP_CARD cache check serves it from the
    // session map with no second stream (Req 2.8).
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    expect(screen.getByText('pueblo pequeño')).toBeInTheDocument();
    expect(spanStart).toHaveBeenCalledTimes(1);
  });

  it('surfaces an inline error and retries from the card (Req 1.5, 9.4)', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    stubSpanErrorOnStart({
      code: 'AI_UNAVAILABLE',
      message: 'network blip',
      status: 502,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    expect(screen.getByTestId('deep-card-error')).toBeInTheDocument();
    expect(spanStart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(spanStart).toHaveBeenCalledTimes(2);
  });

  const VOCAB_ID = '99999999-9999-9999-9999-999999999999';

  function saveAldea() {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    stubSpanCompleteOnStart(DEEP_ALDEA);
    setVocabMutations({
      saveImpl: (_vars, opts) => opts?.onSuccess?.({ id: VOCAB_ID }),
      deleteImpl: (_vars, opts) => opts?.onSuccess?.({ id: VOCAB_ID }),
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to vocabulary/i }),
    );
  }

  it('saving a resolved word card posts it to vocabulary and shows the toast (Req 8.4)', () => {
    saveAldea();
    expect(saveVocabMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        language: Language.ES,
        card: DEEP_ALDEA,
        sourceReadEntryId: ENTRY_ID,
      }),
      expect.any(Object),
    );
    // Confirmation toast + the card footer flipped to the saved state.
    expect(screen.getByRole('status')).toHaveTextContent(/saved.*to vocabulary/i);
    expect(
      screen.getByRole('button', { name: /✓ saved · undo/i }),
    ).toBeInTheDocument();
  });

  it('flips the in-passage word to the saved style after a save (Req 8.4)', () => {
    saveAldea();
    const token = screen.getByRole('button', { name: 'aldea' });
    expect(token.className).toContain(wordFlagStyles.saved);
  });

  it('undo from the toast deletes the vocabulary record and reverts (Req 8.5)', () => {
    saveAldea();
    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    expect(deleteVocabMutate).toHaveBeenCalledWith(VOCAB_ID, expect.any(Object));
    // Toast gone and the card footer reverted to the unsaved label.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /\+ save to vocabulary/i }),
    ).toBeInTheDocument();
  });

  // "One save does both": a deep-card save also banks the word + persists the
  // text to history, and the vocab record links to that entry.
  it('also adds the word to the bank (PUT) on an already-saved entry', () => {
    saveAldea(); // FULL_ENTRY has an empty bank
    expect(updateBankMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: ENTRY_ID, bank: ['aldea'] }),
      expect.any(Object),
    );
  });

  it('undo also removes the word it added to the bank', () => {
    saveAldea();
    updateBankMutate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    expect(updateBankMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: ENTRY_ID, bank: [] }),
      expect.any(Object),
    );
  });

  // Regression: a deep card can resolve ANY tapped word, but the passage word
  // bank only holds flagged words (bank ⊆ flagged, enforced server-side). Saving
  // a NON-flagged word must save to vocabulary WITHOUT attempting the bank PUT —
  // otherwise the bank write 400s and the user sees a spurious "couldn't update
  // — try again" beside the successful vocab save.
  it('saving a non-flagged tapped word skips the bank PUT (no spurious error)', () => {
    // 'grande' occupies offsets [6,12) in 'aldea grande' and is NOT flagged.
    const DEEP_GRANDE: NonNullable<ReadEntryResponse['spanAnnotations']>[string] =
      {
        type: 'word',
        surface: 'grande',
        lemma: 'grande',
        pos: 'adjective',
        contextualSense: 'big',
        definition: 'de gran tamaño',
        definitionLabel: 'Español',
        cefr: CefrLevel.A1,
        freq: 120,
      };
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY); // flaggedWords = { aldea } only
    stubSpanCompleteOnStart(DEEP_GRANDE);
    setVocabMutations({
      saveImpl: (_vars, opts) => opts?.onSuccess?.({ id: VOCAB_ID }),
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'grande' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to vocabulary/i }),
    );

    // Vocab save still happens and confirms…
    expect(saveVocabMutate).toHaveBeenCalledWith(
      expect.objectContaining({ card: DEEP_GRANDE, sourceReadEntryId: ENTRY_ID }),
      expect.any(Object),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/saved.*to vocabulary/i);
    // …but the bank is never touched and no error toast appears.
    expect(updateBankMutate).not.toHaveBeenCalled();
    expect(
      screen.queryByText("couldn't update — try again"),
    ).not.toBeInTheDocument();
  });

  it('on a fresh paste, saving a word lazy-POSTs the entry first, then links the vocab to it', () => {
    stubAnnotateCompleteOnStart();
    setSave({
      mutateImpl: (_vars, opts) =>
        opts?.onSuccess?.({ id: ENTRY_ID, pastedAt: '2026-05-05T00:00:00.000Z' }),
    });
    stubSpanCompleteOnStart(DEEP_ALDEA);
    setVocabMutations({ saveImpl: (_vars, opts) => opts?.onSuccess?.({ id: VOCAB_ID }) });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(screen.getByRole('button', { name: /\+ save to vocabulary/i }));

    // The source text is persisted (with the banked word) so it lands in history…
    expect(saveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'aldea grande', bank: ['aldea'] }),
      expect.any(Object),
    );
    // …and the vocab record links to the just-created entry.
    expect(saveVocabMutate).toHaveBeenCalledWith(
      expect.objectContaining({ card: DEEP_ALDEA, sourceReadEntryId: ENTRY_ID }),
      expect.any(Object),
    );
  });
});

describe('ReadPage — lazy entry save + toast', () => {
  // The explicit "save N to bank →" footer button is gone. The first
  // `+ save to bank` on a fresh paste lazy-creates the entry via
  // `useSaveReadEntry`, then the SaveToast confirms.

  it('first "+ save to bank" lazy-POSTs the entry and raises the SaveToast', () => {
    stubAnnotateCompleteOnStart();
    setSave({
      mutateImpl: (_vars, opts) =>
        opts?.onSuccess?.({ id: ENTRY_ID, pastedAt: '2026-05-05T00:00:00.000Z' }),
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to bank/i }),
    );
    expect(saveMutate).toHaveBeenCalledTimes(1);
    expect(saveMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        language: Language.ES,
        text: 'aldea grande',
        bank: ['aldea'],
      }),
      expect.any(Object),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/1 word added/);
    expect(screen.getByRole('status')).toHaveTextContent(
      /your next session will weave them in/,
    );
  });

  it('SaveToast auto-dismisses after 4 seconds (Req 8.3)', () => {
    vi.useFakeTimers();
    stubAnnotateCompleteOnStart();
    setSave({
      mutateImpl: (_vars, opts) =>
        opts?.onSuccess?.({ id: ENTRY_ID, pastedAt: '2026-05-05T00:00:00.000Z' }),
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to bank/i }),
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('"see next session" from the SaveToast routes to /drill', () => {
    stubAnnotateCompleteOnStart();
    setSave({
      mutateImpl: (_vars, opts) =>
        opts?.onSuccess?.({ id: ENTRY_ID, pastedAt: '2026-05-05T00:00:00.000Z' }),
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    fireEvent.change(screen.getByLabelText(/passage/i), {
      target: { value: 'aldea grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to bank/i }),
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
