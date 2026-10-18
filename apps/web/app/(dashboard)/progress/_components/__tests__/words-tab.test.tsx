import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { VocabTopicSummary, VocabTopicsResponse } from '@language-drill/api-client';
import { WordsTab } from '../words-tab';

// next/link → plain anchor (jsdom); VocabTopicCard renders a <Link>.
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

function topic(o: Partial<VocabTopicSummary> & { umbrellaKey: string }): VocabTopicSummary {
  return {
    name: o.name ?? o.umbrellaKey,
    cefrLevel: o.cefrLevel ?? 'A1',
    wordCount: o.wordCount ?? 0,
    available: o.available ?? 0,
    practiced: o.practiced ?? 0,
    strong: o.strong ?? 0,
    group: o.group ?? null,
    ...o,
  };
}

function loaded(topics: VocabTopicSummary[]): VocabTopicsResponse {
  return { topics };
}

const mockRetry = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WordsTab', () => {
  it('renders topic cards linking to the detail route', () => {
    render(
      <WordsTab
        data={loaded([
          topic({ umbrellaKey: 'es-a1-vocab-food-drink', name: 'Food and drink (A1)' }),
        ])}
        isLoading={false}
        isError={false}
        onRetry={mockRetry}
      />,
    );
    const link = screen.getByRole('link', { name: /food and drink/i });
    expect(link).toHaveAttribute('href', '/vocab/es-a1-vocab-food-drink');
  });

  it('shows a mastery bar split into strong and shaky words', () => {
    render(
      <WordsTab
        data={loaded([
          topic({ umbrellaKey: 'es-a2-body', wordCount: 20, available: 15, practiced: 8, strong: 5 }),
        ])}
        isLoading={false}
        isError={false}
        onRetry={mockRetry}
      />,
    );
    expect(screen.getByTestId('mastery-strong')).toHaveStyle({ width: '25%' });
    expect(screen.getByTestId('mastery-shaky')).toHaveStyle({ width: '15%' });
    expect(screen.getByText('5 / 20 strong · 3 shaky')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '5 of 20 words strong, 3 shaky' })).toBeInTheDocument();
  });

  it('marks an unstarted topic as not started', () => {
    render(
      <WordsTab
        data={loaded([topic({ umbrellaKey: 'es-a2-home', wordCount: 30, available: 12 })])}
        isLoading={false}
        isError={false}
        onRetry={mockRetry}
      />,
    );
    expect(screen.getByText('30 words · 12 drillable · not started')).toBeInTheDocument();
  });

  it('shows the loading state', () => {
    render(<WordsTab data={undefined} isLoading isError={false} onRetry={mockRetry} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the error state and wires retry', () => {
    render(<WordsTab data={undefined} isLoading={false} isError onRetry={mockRetry} />);
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(mockRetry).toHaveBeenCalled();
  });

  it('shows the empty state when there are no topics', () => {
    render(<WordsTab data={loaded([])} isLoading={false} isError={false} onRetry={mockRetry} />);
    expect(screen.getByText(/no vocab topics/i)).toBeInTheDocument();
  });
});

describe('WordsTab — level sections', () => {
  it('sections topics A1→B2 regardless of API order and keeps unknown levels last', () => {
    render(
      <WordsTab
        data={loaded([
          topic({ umbrellaKey: 'b1', cefrLevel: 'B1' }),
          topic({ umbrellaKey: 'a1', cefrLevel: 'A1' }),
          topic({ umbrellaKey: 'x', cefrLevel: 'Z9' }),
          topic({ umbrellaKey: 'a1b', cefrLevel: 'A1' }),
        ])}
        isLoading={false}
        isError={false}
        onRetry={mockRetry}
      />,
    );
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['A1', 'B1', 'Z9']);
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('tags word-class groups', () => {
    render(
      <WordsTab
        data={loaded([topic({ umbrellaKey: 'v', name: 'Describing words (A1)', group: 'describing' })])}
        isLoading={false}
        isError={false}
        onRetry={mockRetry}
      />,
    );
    expect(screen.getByText('adjectives')).toBeDefined();
  });
});
