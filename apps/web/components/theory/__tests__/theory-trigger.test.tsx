import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Language } from '@language-drill/shared';
import { TheoryTrigger } from '../theory-trigger';

// Components consume `useTheoryTopic` via TanStack Query — every render needs
// a QueryClientProvider in scope. Tests omit `fetchFn`, so the hook degrades
// to static-only and `useQuery` stays `enabled: false`; the provider is still
// required because the hook always calls `useQuery`.
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
    // 'subjunctive' is mapped, but DE registry is empty, so no topic exists.
    const { container } = render(
      <TheoryTrigger
        topicId={'subjunctive' as never}
        language={Language.DE}
        onOpen={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    expect(container.querySelector('button')).toBeNull();
  });
});
