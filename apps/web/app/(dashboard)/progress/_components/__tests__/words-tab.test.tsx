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
