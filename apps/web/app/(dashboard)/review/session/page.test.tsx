import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import type { ReviewItem, ReviewItemResult } from '@language-drill/api-client';
import { ActiveLanguageProvider } from '../../../../components/shell';
import ReviewSessionPage from './page';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockPush = vi.fn();
let mockSearch = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

const mockIsMobile = vi.fn(() => false);
vi.mock('../../../../lib/responsive', () => ({
  useIsMobile: () => mockIsMobile(),
}));

const mockStartMutate = vi.fn();
const mockSubmitMutate = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
  useStartReviewSession: () => ({ mutate: mockStartMutate }),
  useSubmitReviewItem: () => ({ mutate: mockSubmitMutate }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = '11111111-1111-1111-1111-111111111111';

const clozeItem: ReviewItem = {
  stateId: '00000000-0000-0000-0000-0000000000a0',
  lemma: 'ev',
  language: Language.TR,
  itemType: 'cloze',
  gloss: 'house',
  pos: 'noun',
  cefr: 'A1',
  freqRank: 12,
  occurrence: {
    surface: 'evler',
    sentence: 'Burada çok evler var.',
    translation: 'There are many houses here.',
    contextualSense: 'houses',
    grammarPoints: ['plural'],
  },
};

const meaningItem: ReviewItem = {
  stateId: '00000000-0000-0000-0000-0000000000b0',
  lemma: 'apenas',
  language: Language.ES,
  itemType: 'meaning',
  gloss: 'barely',
  pos: 'adverb',
  cefr: 'B1',
  freqRank: 88,
  occurrence: null,
};

const sessionResponse = { sessionId: SESSION_ID, items: [clozeItem, meaningItem] };

function makeResult(correctAnswer: string): ReviewItemResult {
  return {
    outcome: 'correct',
    correctAnswer,
    schedulerDelta: {
      intervalFrom: 0,
      intervalTo: 1,
      stabilityFrom: 0,
      stabilityTo: 2.5,
      stateFrom: 'new',
      stateTo: 'learning',
    },
    masteryDeltas: [],
  };
}

function renderSession() {
  return render(
    <ActiveLanguageProvider
      profiles={[{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }]}
    >
      <ReviewSessionPage />
    </ActiveLanguageProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearch = '';
  mockIsMobile.mockReturnValue(false);
  // Start succeeds synchronously with the two-item queue.
  mockStartMutate.mockImplementation((_params, opts) => opts.onSuccess(sessionResponse));
  // Submit succeeds synchronously, echoing the cloze surface as the answer key.
  mockSubmitMutate.mockImplementation((params, opts) =>
    opts.onSuccess(makeResult(params.itemType === 'cloze' ? 'evler' : 'apenas')),
  );
});

// ---------------------------------------------------------------------------
// Session start (Req 10.1) + filter parsing
// ---------------------------------------------------------------------------

describe('ReviewSessionPage start', () => {
  it('starts a session for the active language with the default (all) filter', () => {
    renderSession();
    expect(mockStartMutate).toHaveBeenCalledTimes(1);
    expect(mockStartMutate.mock.calls[0][0]).toEqual({
      language: Language.ES,
      filter: 'all',
    });
  });

  it('parses ?filter=new into the new-intake filter', () => {
    mockSearch = 'filter=new';
    renderSession();
    expect(mockStartMutate.mock.calls[0][0]).toMatchObject({ filter: 'new' });
  });

  it('parses ?readEntryId into a passage filter (Req 13.1)', () => {
    mockSearch = 'readEntryId=entry-9';
    renderSession();
    expect(mockStartMutate.mock.calls[0][0]).toMatchObject({
      filter: { readEntryId: 'entry-9' },
    });
  });

  it('still starts when the first mount-effect pass is abandoned (StrictMode double-invoke)', () => {
    // Reproduces the `next dev` failure: under StrictMode the mount effect runs,
    // is cleaned up, then runs again. A mutation fired in the *first* pass is
    // torn down and its onSuccess never fires — only a later pass's call lands
    // on the live observer. Model that by dropping the first mutate's callbacks
    // and honouring the second. With the once-guard removed the effect re-fires
    // on remount and the session starts; a re-introduced guard would leave the
    // page stuck on the loading skeleton.
    let calls = 0;
    mockStartMutate.mockImplementation((_params, opts) => {
      calls += 1;
      if (calls >= 2) opts.onSuccess(sessionResponse);
    });
    render(
      <StrictMode>
        <ActiveLanguageProvider
          profiles={[{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }]}
        >
          <ReviewSessionPage />
        </ActiveLanguageProvider>
      </StrictMode>,
    );
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('type the form that fits.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Burndown + no score/streak (Req 10.1)
// ---------------------------------------------------------------------------

describe('ReviewSessionPage burndown', () => {
  it('shows item position out of total and never a streak/score', () => {
    renderSession();
    expect(screen.getByText(/item 1 of 2/i)).toBeInTheDocument();
    expect(screen.queryByText(/streak/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bscore\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bxp\b/i)).not.toBeInTheDocument();
  });

  it('routes the first item to the cloze pane', () => {
    renderSession();
    expect(screen.getByText('type the form that fits.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Submit → feedback → advance (Req 10.2, 10.6)
// ---------------------------------------------------------------------------

describe('ReviewSessionPage flow', () => {
  it('submits the cloze item with the occurrence surface and shows feedback', () => {
    const { container } = renderSession();
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'evler' } });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));

    expect(mockSubmitMutate).toHaveBeenCalledTimes(1);
    expect(mockSubmitMutate.mock.calls[0][0]).toMatchObject({
      stateId: clozeItem.stateId,
      itemType: 'cloze',
      surface: 'evler',
      sessionId: SESSION_ID,
    });
    // Inline feedback appears before advancing (Req 10.2).
    expect(screen.getByText('correct.')).toBeInTheDocument();
  });

  it('advances to the next item on "next" and routes it to the meaning pane', () => {
    const { container } = renderSession();
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'evler' } });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    fireEvent.click(screen.getByRole('button', { name: /next item/i }));

    expect(screen.getByText(/item 2 of 2/i)).toBeInTheDocument();
    expect(screen.getByText("what's the word that means…")).toBeInTheDocument();
  });

  it('routes to the summary after the last item (Req 10.6)', () => {
    const { container } = renderSession();

    // Item 1
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: 'evler' },
    });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    fireEvent.click(screen.getByRole('button', { name: /next item/i }));

    // Item 2 (last) — the feedback CTA reads "finish"
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: 'apenas' },
    });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    fireEvent.click(screen.getByRole('button', { name: /finish/i }));

    expect(mockPush).toHaveBeenCalledWith(`/review/summary/${SESSION_ID}`);
  });
});

// ---------------------------------------------------------------------------
// Error path
// ---------------------------------------------------------------------------

describe('ReviewSessionPage error handling', () => {
  it('shows an error card with retry/skip when an item fails to grade', () => {
    mockSubmitMutate.mockImplementation((_params, opts) =>
      opts.onError(new Error('boom')),
    );
    const { container } = renderSession();
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: 'evler' },
    });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));

    expect(screen.getByText(/didn't grade/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
  });

  it('shows a start-error card with retry when the session fails to start', () => {
    mockStartMutate.mockImplementation((_params, opts) => opts.onError(new Error('nope')));
    renderSession();
    expect(screen.getByText(/couldn't start your review session/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Responsive (Req 10.5)
// ---------------------------------------------------------------------------

describe('ReviewSessionPage responsive', () => {
  it('renders the mobile sticky exit bar when on mobile', () => {
    mockIsMobile.mockReturnValue(true);
    renderSession();
    // Two "save & exit" affordances: the header one and the sticky bottom one.
    expect(screen.getAllByRole('link', { name: /save & exit/i }).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('renders the coach/scheduler rail on desktop', () => {
    renderSession();
    expect(screen.getByText('this card')).toBeInTheDocument();
  });
});
