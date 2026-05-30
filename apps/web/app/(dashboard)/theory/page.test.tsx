import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Language, type LearningLanguage } from '@language-drill/shared';
import type { TheoryTopicListItem } from '../../../lib/hooks/use-theory-topics';
import TheoryLibraryPage from './page';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockUseActiveLanguage = vi.fn<
  () => { activeLanguage: LearningLanguage; setActiveLanguage: () => void }
>(() => ({ activeLanguage: Language.ES, setActiveLanguage: vi.fn() }));
vi.mock('../../../components/shell/active-language-provider', () => ({
  useActiveLanguage: () => mockUseActiveLanguage(),
}));

const mockIsMobile = vi.fn(() => false);
vi.mock('../../../lib/responsive', () => ({
  useIsMobile: () => mockIsMobile(),
}));

const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

const mockUseTheoryTopics = vi.fn();
vi.mock('../../../lib/hooks/use-theory-topics', () => ({
  useTheoryTopics: () => mockUseTheoryTopics(),
}));

// next/link → plain anchor (jsdom).
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function topic(o: Partial<TheoryTopicListItem> & { id: string }): TheoryTopicListItem {
  return {
    title: o.title ?? o.id,
    cefr: o.cefr ?? 'B1',
    category: o.category ?? 'other',
    order: o.order ?? null,
    ...o,
  };
}

const TOPICS: TheoryTopicListItem[] = [
  topic({ id: 't-tenses', title: 'compound tenses', cefr: 'B2', category: 'tenses', order: 7 }),
  topic({ id: 't-subj', title: 'present subjunctive', cefr: 'B1', category: 'moods', order: 1 }),
  topic({ id: 't-cases', title: 'locative case', cefr: 'A1', category: 'cases', order: 3 }),
];

function loaded(topics: TheoryTopicListItem[]) {
  return { topics, isLoading: false, isError: false, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsMobile.mockReturnValue(false);
  mockUseActiveLanguage.mockReturnValue({
    activeLanguage: Language.ES,
    setActiveLanguage: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TheoryLibraryPage', () => {
  it('renders the header with the total topic count and the title', () => {
    mockUseTheoryTopics.mockReturnValue(loaded(TOPICS));
    render(<TheoryLibraryPage />);

    expect(screen.getByRole('heading', { name: 'theory library.' })).toBeInTheDocument();
    expect(screen.getByText(/grammar reference · 3 topics/i)).toBeInTheDocument();
  });

  it('groups by category (default) with taxonomy-ordered headings', () => {
    mockUseTheoryTopics.mockReturnValue(loaded(TOPICS));
    render(<TheoryLibraryPage />);

    // Category labels from THEORY_CATEGORIES.
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['verb tenses', 'moods & conditionals', 'noun cases']);
  });

  it('collapses to a single "all topics" group when group-by is flat list', () => {
    mockUseTheoryTopics.mockReturnValue(loaded(TOPICS));
    render(<TheoryLibraryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'flat list' }));

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['all topics']);
  });

  it('filters to a results group on search while keeping the header total', () => {
    mockUseTheoryTopics.mockReturnValue(loaded(TOPICS));
    render(<TheoryLibraryPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: /search theory topics/i }), {
      target: { value: 'subjunctive' },
    });

    // Only the matching topic's row is present (the title is split across a
    // <mark> while searching, so assert by the row's detail link).
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/theory/t-subj');
    expect(links).not.toContain('/theory/t-tenses');
    // …but the header count stays the full language total.
    expect(screen.getByText(/grammar reference · 3 topics/i)).toBeInTheDocument();
  });

  it('shows the no-results state with a clear action when search matches nothing', () => {
    mockUseTheoryTopics.mockReturnValue(loaded(TOPICS));
    render(<TheoryLibraryPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: /search theory topics/i }), {
      target: { value: 'zzzzz' },
    });

    expect(screen.getByText(/no topics match/i)).toBeInTheDocument();
    // Clearing restores the grouped list. Exact name disambiguates from the
    // search box's "clear search box" × button.
    fireEvent.click(screen.getByRole('button', { name: 'clear search' }));
    expect(screen.getByText('compound tenses')).toBeInTheDocument();
  });

  it('shows the empty-language state when there are no topics', () => {
    mockUseTheoryTopics.mockReturnValue(loaded([]));
    render(<TheoryLibraryPage />);

    expect(screen.getByText(/no topics yet for spanish/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry that invalidates the list query', () => {
    mockUseTheoryTopics.mockReturnValue({
      topics: [],
      isLoading: false,
      isError: true,
      error: new Error('boom'),
    });
    render(<TheoryLibraryPage />);

    expect(screen.getByText(/couldn't load theory/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['theory', 'list', Language.ES],
    });
  });

  it('shows the loading state before topics arrive', () => {
    mockUseTheoryTopics.mockReturnValue({
      topics: [],
      isLoading: true,
      isError: false,
      error: null,
    });
    render(<TheoryLibraryPage />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading theory/i);
  });

  it('links each topic row to its detail route', () => {
    mockUseTheoryTopics.mockReturnValue(loaded(TOPICS));
    render(<TheoryLibraryPage />);

    expect(screen.getByText('present subjunctive').closest('a')).toHaveAttribute(
      'href',
      '/theory/t-subj',
    );
  });
});
