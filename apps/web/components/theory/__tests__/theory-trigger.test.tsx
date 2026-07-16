import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Language } from '@language-drill/shared';
import { TheoryTrigger } from '../theory-trigger';

// Theory content now comes exclusively from the DB via `useTheoryTopic`. Mock
// that hook to supply a fixture topic so the trigger's render/omit behavior can
// be exercised without a fetch: ES/'subjunctive' resolves; any other
// language/slug returns no topic.
vi.mock('../../../lib/hooks/use-theory-topic', () => ({
  useTheoryTopic: ({ language, topicId }: { language: string; topicId: string }) => ({
    topic:
      language === 'ES' && topicId === 'subjunctive'
        ? { id: 'subjunctive', title: 'el subjuntivo', subtitle: '', cefr: 'B1', sections: [] }
        : null,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

// The trigger renders inside a QueryClientProvider in the real app; keep one in
// scope so nested consumers stay happy even though the hook itself is mocked.
function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('TheoryTrigger', () => {
  it('renders the topic title in the pill label', () => {
    render(
      <TheoryTrigger
        topicId="subjunctive"
        language={Language.ES}
        onOpen={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    expect(
      screen.getByRole('button', { name: /theory · el subjuntivo/i }),
    ).toBeInTheDocument();
  });

  it('sets aria-haspopup="dialog"', () => {
    render(
      <TheoryTrigger
        topicId="subjunctive"
        language={Language.ES}
        onOpen={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('invokes onOpen with the topic id and the button element on click', () => {
    const onOpen = vi.fn();
    render(
      <TheoryTrigger
        topicId="subjunctive"
        language={Language.ES}
        onOpen={onOpen}
      />,
      { wrapper: Wrapper },
    );
    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('subjunctive', button);
  });

  it('renders nothing when the topic does not exist for the language', () => {
    // No DE topic resolves for this slug, so the hook returns no topic.
    const { container } = render(
      <TheoryTrigger
        topicId="subjunctive"
        language={Language.DE}
        onOpen={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    expect(container.querySelector('button')).toBeNull();
  });
});
