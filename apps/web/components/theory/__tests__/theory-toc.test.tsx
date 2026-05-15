import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Language } from '@language-drill/shared';
import { TheoryToc } from '../theory-toc';
import type { TheoryTopic } from '../types';

// TheoryToc consumes `useTheoryTopics` (TanStack Query) — provider required
// in scope even though the tests omit `fetchFn` (the hook degrades to
// static-only with `enabled: false`).
function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const mockTopic: TheoryTopic = {
  id: 'subjunctive',
  title: 'el subjuntivo',
  subtitle: '',
  cefr: 'B1–B2',
  sections: [
    { id: 'what', title: 'what is it?', body: <div /> },
    { id: 'when', title: 'when to use it', body: <div /> },
    { id: 'examples', title: 'examples', body: <div /> },
  ],
};

describe('TheoryToc', () => {
  it('renders the section list in render order', () => {
    render(
      <TheoryToc
        topic={mockTopic}
        activeSectionId="what"
        onJump={vi.fn()}
        language={Language.ES}
        onSwitchTopic={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    const sectionButtons = screen.getAllByRole('button');
    // The TOC also renders "other topics" buttons after the section list, but
    // the first 3 buttons should be the sections in render order.
    const labels = sectionButtons.slice(0, 3).map((b) => b.textContent);
    expect(labels).toEqual(['what is it?', 'when to use it', 'examples']);
  });

  it('marks the active section with aria-current="true"', () => {
    render(
      <TheoryToc
        topic={mockTopic}
        activeSectionId="when"
        onJump={vi.fn()}
        language={Language.ES}
        onSwitchTopic={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    const activeBtn = screen.getByRole('button', { name: 'when to use it' });
    expect(activeBtn.getAttribute('aria-current')).toBe('true');

    const inactive = screen.getByRole('button', { name: 'what is it?' });
    expect(inactive.getAttribute('aria-current')).toBeNull();
  });

  it('calls onJump with the section id when a TOC item is clicked', () => {
    const onJump = vi.fn();
    render(
      <TheoryToc
        topic={mockTopic}
        activeSectionId="what"
        onJump={onJump}
        language={Language.ES}
        onSwitchTopic={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: 'examples' }));
    expect(onJump).toHaveBeenCalledWith('examples');
  });

  it('shows the "other topics" list when the language has additional topics', () => {
    render(
      <TheoryToc
        topic={mockTopic}
        activeSectionId="what"
        onJump={vi.fn()}
        language={Language.ES}
        onSwitchTopic={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    // ES has 3 topics; subjunctive is current, so 2 others should appear.
    expect(screen.getByText(/other topics/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /pretérito vs\. imperfecto/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /el condicional/i }),
    ).toBeInTheDocument();
  });

  it('hides the "other topics" block when the language has no other topics', () => {
    // DE has zero topics in v1, so even with current topic.id="subjunctive",
    // the filtered "other topics" list is empty.
    render(
      <TheoryToc
        topic={mockTopic}
        activeSectionId="what"
        onJump={vi.fn()}
        language={Language.DE}
        onSwitchTopic={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.queryByText(/other topics/i)).toBeNull();
  });

  it('calls onSwitchTopic with the chosen id when an "other topics" button is clicked', () => {
    const onSwitchTopic = vi.fn();
    render(
      <TheoryToc
        topic={mockTopic}
        activeSectionId="what"
        onJump={vi.fn()}
        language={Language.ES}
        onSwitchTopic={onSwitchTopic}
      />,
      { wrapper: Wrapper },
    );
    fireEvent.click(
      screen.getByRole('button', { name: /pretérito vs\. imperfecto/i }),
    );
    expect(onSwitchTopic).toHaveBeenCalledWith('preterite-imperfect');
  });
});
