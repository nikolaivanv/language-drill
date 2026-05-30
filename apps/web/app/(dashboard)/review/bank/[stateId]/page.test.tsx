import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import type { WordDetail } from '@language-drill/api-client';
import WordDetailPage from './page';

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

const mockUseVocabularyWord = vi.fn();
const mockUpdateMutate = vi.fn();
const mockDeleteMutate = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
  useVocabularyWord: (...args: unknown[]) => mockUseVocabularyWord(...args),
  useUpdateVocabularyWord: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useDeleteVocabularyWord: () => ({ mutate: mockDeleteMutate, isPending: false }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATE_ID = '00000000-0000-0000-0000-0000000000a0';

const word: WordDetail = {
  stateId: STATE_ID,
  lemma: 'ev',
  language: Language.TR,
  gloss: 'house',
  pos: 'noun',
  cefr: 'A1',
  freqRank: 42,
  isPhrase: false,
  deepCard: {
    type: 'word',
    surface: 'evler',
    lemma: 'ev',
    pos: 'noun',
    contextualSense: 'dwelling',
    definition: 'a building for living in',
    definitionLabel: 'definition',
    cefr: 'A1',
    freq: 42,
  },
  occurrences: [
    {
      surface: 'evler',
      sentence: 'Burada çok evler var.',
      translation: 'There are many houses here.',
      source: 'Yedi İklim A1',
      contextualSense: 'houses',
      whyThisForm: 'plural of ev',
      grammarPoints: ['plural'],
    },
  ],
  fsrs: {
    stability: 7.2,
    difficulty: 4.1,
    reps: 5,
    lapses: 1,
    state: 'mature',
    dueAt: '2999-01-01T00:00:00.000Z',
    lastReviewedAt: '2026-05-01T00:00:00.000Z',
    nextIntervalDays: 12,
  },
  grammarPoints: ['plural -ler', 'ablative case'],
  history: [
    { itemType: 'cloze', surface: 'evler', outcome: 'correct', rating: 3, reviewedAt: '2026-05-01T00:00:00.000Z' },
    { itemType: 'meaning', surface: null, outcome: 'incorrect', rating: 1, reviewedAt: '2026-04-20T00:00:00.000Z' },
  ],
};

function fulfilledThenable<T>(value: T): Promise<T> {
  const t = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  t.status = 'fulfilled';
  t.value = value;
  return t;
}

function renderDetail() {
  return render(<WordDetailPage params={fulfilledThenable({ stateId: STATE_ID })} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseVocabularyWord.mockReturnValue({
    isLoading: false,
    error: null,
    data: word,
    refetch: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

describe('WordDetailPage states', () => {
  it('renders a skeleton while loading', () => {
    mockUseVocabularyWord.mockReturnValue({ isLoading: true, error: null, data: undefined });
    const { container } = renderDetail();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders an error card with retry on failure', () => {
    mockUseVocabularyWord.mockReturnValue({
      isLoading: false,
      error: new Error('boom'),
      data: undefined,
      refetch: vi.fn(),
    });
    renderDetail();
    expect(screen.getByText(/couldn't load this word/i)).toBeInTheDocument();
  });

  it('queries with the stateId from params', () => {
    renderDetail();
    expect(mockUseVocabularyWord).toHaveBeenCalledWith(
      expect.objectContaining({ stateId: STATE_ID }),
    );
  });
});

// ---------------------------------------------------------------------------
// Snapshot / occurrences / stats / history / grammar (Req 12.3)
// ---------------------------------------------------------------------------

describe('WordDetailPage content', () => {
  it('renders the deep-card snapshot definition', () => {
    renderDetail();
    expect(screen.getByText('a building for living in')).toBeInTheDocument();
  });

  it('renders pooled occurrences with surface, sentence, and why-this-form', () => {
    renderDetail();
    expect(screen.getByText('There are many houses here.')).toBeInTheDocument();
    expect(screen.getByText(/plural of ev/)).toBeInTheDocument();
    expect(screen.getByText(/1 surface form pooled/)).toBeInTheDocument();
  });

  it('renders FSRS scheduler stats', () => {
    renderDetail();
    expect(screen.getByText('7.2d')).toBeInTheDocument(); // stability
    expect(screen.getByText('4.1')).toBeInTheDocument(); // difficulty
    expect(screen.getByText('12d')).toBeInTheDocument(); // next interval
  });

  it('renders the review history with outcome ticks', () => {
    renderDetail();
    expect(screen.getByLabelText('correct')).toBeInTheDocument();
    expect(screen.getByLabelText('incorrect')).toBeInTheDocument();
  });

  it('renders the grammar points the card feeds', () => {
    renderDetail();
    expect(screen.getByText('plural -ler')).toBeInTheDocument();
    expect(screen.getByText('ablative case')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Actions (Req 12.4, 12.5)
// ---------------------------------------------------------------------------

describe('WordDetailPage actions', () => {
  it('suspends via the suspend action', () => {
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'suspend' }));
    expect(mockUpdateMutate).toHaveBeenCalledWith({ stateId: STATE_ID, action: 'suspend' });
  });

  it('shows unsuspend and calls unsuspend when already suspended', () => {
    mockUseVocabularyWord.mockReturnValue({
      isLoading: false,
      error: null,
      data: { ...word, fsrs: { ...word.fsrs, state: 'suspended' } },
      refetch: vi.fn(),
    });
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'unsuspend' }));
    expect(mockUpdateMutate).toHaveBeenCalledWith({ stateId: STATE_ID, action: 'unsuspend' });
  });

  it('marks known and resets SR', () => {
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: /mark known/i }));
    expect(mockUpdateMutate).toHaveBeenCalledWith({ stateId: STATE_ID, action: 'mark_known' });
    fireEvent.click(screen.getByRole('button', { name: /reset sr/i }));
    expect(mockUpdateMutate).toHaveBeenCalledWith({ stateId: STATE_ID, action: 'reset' });
  });

  it('disables mark-known when the word is already known', () => {
    mockUseVocabularyWord.mockReturnValue({
      isLoading: false,
      error: null,
      data: { ...word, fsrs: { ...word.fsrs, state: 'known' } },
      refetch: vi.fn(),
    });
    renderDetail();
    expect(screen.getByRole('button', { name: /mark known/i })).toBeDisabled();
  });

  it('deletes only after an inline confirm, then routes back to the bank', () => {
    renderDetail();
    // First click reveals the confirm; no delete yet.
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    expect(mockDeleteMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
    expect(mockDeleteMutate).toHaveBeenCalledWith(
      { stateId: STATE_ID },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    // Simulate the mutation success → navigation.
    mockDeleteMutate.mock.calls[0][1].onSuccess();
    expect(mockPush).toHaveBeenCalledWith('/review/bank');
  });

  it('can cancel the delete confirm', () => {
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(screen.getByRole('button', { name: 'delete' })).toBeInTheDocument();
    expect(mockDeleteMutate).not.toHaveBeenCalled();
  });
});
