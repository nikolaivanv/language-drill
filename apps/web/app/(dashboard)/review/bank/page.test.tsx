import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import type { BankRow } from '@language-drill/api-client';
import { ActiveLanguageProvider } from '../../../../components/shell';
import VocabularyBankPage from './page';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockUseVocabularyBank = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
  useVocabularyBank: (...args: unknown[]) => mockUseVocabularyBank(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const rows: BankRow[] = [
  {
    stateId: '00000000-0000-0000-0000-0000000000a0',
    lemma: 'aprovechar',
    gloss: 'to take advantage of',
    pos: 'verb',
    cefr: 'B1',
    status: 'mature',
    stability: 22.4,
    dueAt: '2999-01-01T00:00:00.000Z',
  },
  {
    stateId: '00000000-0000-0000-0000-0000000000b0',
    lemma: 'imprescindible',
    gloss: 'essential',
    pos: 'adjective',
    cefr: 'B2',
    status: 'leech',
    stability: 0.6,
    dueAt: '2000-01-01T00:00:00.000Z',
  },
];

function lastBankCall() {
  return mockUseVocabularyBank.mock.calls[mockUseVocabularyBank.mock.calls.length - 1][0];
}

function renderBank() {
  return render(
    <ActiveLanguageProvider
      profiles={[{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }]}
    >
      <VocabularyBankPage />
    </ActiveLanguageProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseVocabularyBank.mockReturnValue({
    isLoading: false,
    error: null,
    data: { rows },
    refetch: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Query wiring (Req 12.1)
// ---------------------------------------------------------------------------

describe('VocabularyBankPage query', () => {
  it('queries the active language with no status/q initially', () => {
    renderBank();
    expect(lastBankCall()).toMatchObject({
      language: Language.ES,
      status: undefined,
      q: undefined,
    });
  });

  it('renders one row per lemma with gloss, status, stability, and next-due', () => {
    renderBank();
    expect(screen.getByText('aprovechar')).toBeInTheDocument();
    expect(screen.getByText('to take advantage of')).toBeInTheDocument();
    // 'mature' is both a filter chip (button) and the row status chip (span).
    expect(screen.getByText('mature', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('22.4d')).toBeInTheDocument();
    // Past-due leech row reads "now".
    expect(screen.getByText('now')).toBeInTheDocument();
    // Rows are links to the detail page.
    const link = screen.getByText('aprovechar').closest('a');
    expect(link).toHaveAttribute('href', `/review/bank/${rows[0].stateId}`);
  });
});

// ---------------------------------------------------------------------------
// Filters (Req 12.2)
// ---------------------------------------------------------------------------

describe('VocabularyBankPage filters', () => {
  it('passes the chosen status filter to the query', () => {
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: 'mature' }));
    expect(lastBankCall()).toMatchObject({ status: 'mature' });
  });

  it('passes free-text search to the query (trimmed)', () => {
    renderBank();
    fireEvent.change(screen.getByLabelText('search vocabulary'), {
      target: { value: '  apro ' },
    });
    expect(lastBankCall()).toMatchObject({ q: 'apro' });
  });

  it('marks the active status chip with aria-pressed', () => {
    renderBank();
    const chip = screen.getByRole('button', { name: 'leeches' });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

// ---------------------------------------------------------------------------
// Leech surfacing (Req 12.6)
// ---------------------------------------------------------------------------

describe('VocabularyBankPage leech surfacing', () => {
  it('shows a leech banner when the leech filter is active and rows exist', () => {
    renderBank();
    expect(screen.queryByText(/have lapsed ≥ 3 times/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'leeches' }));
    expect(screen.getByText(/have lapsed ≥ 3 times/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

describe('VocabularyBankPage states', () => {
  it('renders a skeleton while loading', () => {
    mockUseVocabularyBank.mockReturnValue({ isLoading: true, error: null, data: undefined });
    const { container } = renderBank();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders an error card with retry on failure', () => {
    mockUseVocabularyBank.mockReturnValue({
      isLoading: false,
      error: new Error('boom'),
      data: undefined,
      refetch: vi.fn(),
    });
    renderBank();
    expect(screen.getByText(/couldn't load your vocabulary/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders an empty state when there are no rows', () => {
    mockUseVocabularyBank.mockReturnValue({
      isLoading: false,
      error: null,
      data: { rows: [] },
      refetch: vi.fn(),
    });
    renderBank();
    expect(screen.getByText('no words here.')).toBeInTheDocument();
  });
});
