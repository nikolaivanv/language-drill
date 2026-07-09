import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Language, type LearningLanguage } from '@language-drill/shared';
import type { VocabTopicSummary } from '@language-drill/api-client';
import VocabPage from './page';

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

const mockRefetch = vi.fn();
const mockUseVocabTopics = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
  useVocabTopics: () => mockUseVocabTopics(),
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

function topic(o: Partial<VocabTopicSummary> & { umbrellaKey: string }): VocabTopicSummary {
  return {
    name: o.name ?? o.umbrellaKey,
    cefrLevel: o.cefrLevel ?? 'A1',
    wordCount: o.wordCount ?? 0,
    available: o.available ?? 0,
    practiced: o.practiced ?? 0,
    ...o,
  };
}

const TOPICS: VocabTopicSummary[] = [
  topic({
    umbrellaKey: 'es-a1-vocab-food-drink',
    name: 'Food and drink (A1)',
    cefrLevel: 'A1',
    wordCount: 30,
    available: 12,
    practiced: 5,
  }),
];

function loaded(topics: VocabTopicSummary[]) {
  return { data: { topics }, isLoading: false, isError: false, refetch: mockRefetch };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseActiveLanguage.mockReturnValue({
    activeLanguage: Language.ES,
    setActiveLanguage: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VocabPage', () => {
  it('renders topic cards linking to detail', () => {
    mockUseVocabTopics.mockReturnValue(loaded(TOPICS));
    render(<VocabPage />);

    const link = screen.getByRole('link', { name: /food and drink/i });
    expect(link).toHaveAttribute('href', '/vocab/es-a1-vocab-food-drink');
  });

  it('shows loading and error states', () => {
    mockUseVocabTopics.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockRefetch,
    });
    const { rerender } = render(<VocabPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();

    mockUseVocabTopics.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
    });
    rerender(<VocabPage />);
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows the empty state when there are no topics', () => {
    mockUseVocabTopics.mockReturnValue(loaded([]));
    render(<VocabPage />);

    expect(screen.getByText(/no vocab topics/i)).toBeInTheDocument();
  });
});
