import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { Language } from '@language-drill/shared';
import { TheoryToc } from '../theory-toc';
import type { TheoryTopic } from '../types';

// A `fetchFn` that resolves the `/theory/:lang` list to `topics`. Lets a test
// inject a long "other topics" list (the static registry only ships 3 ES
// topics) so the topic-filter affordance has something to filter.
function listFetch(topics: Array<{ id: string; title: string; cefr: string }>) {
  return vi.fn<AuthenticatedFetch>().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ topics }),
  } as unknown as Response);
}

// 12 DE topics — none collide with the current topic id ('subjunctive'), so all
// 12 land in "other topics", comfortably above the filter threshold.
const MANY_TOPICS = [
  { id: 'vowel-harmony', title: 'vowel harmony', cefr: 'A1' },
  ...Array.from({ length: 11 }, (_, i) => ({
    id: `topic-${i}`,
    title: `placeholder topic ${i}`,
    cefr: 'A2',
  })),
];

// TheoryToc branches on `useIsMobile()` — default to desktop so the existing
// sidebar assertions hold; the mobile-strip test flips it on.
const mockIsMobile = vi.fn(() => false);
vi.mock('../../../lib/responsive', () => ({
  useIsMobile: () => mockIsMobile(),
}));

beforeEach(() => {
  mockIsMobile.mockReturnValue(false);
});

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

  it('renders the vertical sidebar (not the strip) on desktop', () => {
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
    const nav = screen.getByRole('navigation', { name: /theory sections/i });
    expect(nav).not.toHaveClass('theory-toc-strip');
    // Sidebar-only chrome: the "jump to" label and the stacked "other topics".
    expect(screen.getByText(/jump to/i)).toBeInTheDocument();
    expect(screen.getByText(/other topics/i)).toBeInTheDocument();
  });

  describe('other-topics filter (long lists)', () => {
    it('does not render a filter when the other-topics list is short', () => {
      // ES static = 3 topics; minus the current one, only 2 others — below the
      // threshold, so no filter chrome.
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
      expect(screen.queryByRole('searchbox', { name: /filter topics/i })).toBeNull();
    });

    it('renders a filter when the other-topics list is long', async () => {
      render(
        <TheoryToc
          topic={mockTopic}
          activeSectionId="what"
          onJump={vi.fn()}
          language={Language.DE}
          onSwitchTopic={vi.fn()}
          fetchFn={listFetch(MANY_TOPICS)}
        />,
        { wrapper: Wrapper },
      );
      await waitFor(() =>
        expect(
          screen.getByRole('searchbox', { name: /filter topics/i }),
        ).toBeInTheDocument(),
      );
      // All 12 topics present before filtering.
      expect(
        screen.getByRole('button', { name: /vowel harmony/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /placeholder topic 3/i }),
      ).toBeInTheDocument();
    });

    it('narrows the other-topics list as the user types', async () => {
      render(
        <TheoryToc
          topic={mockTopic}
          activeSectionId="what"
          onJump={vi.fn()}
          language={Language.DE}
          onSwitchTopic={vi.fn()}
          fetchFn={listFetch(MANY_TOPICS)}
        />,
        { wrapper: Wrapper },
      );
      const filter = await screen.findByRole('searchbox', {
        name: /filter topics/i,
      });
      fireEvent.change(filter, { target: { value: 'harmony' } });

      expect(
        screen.getByRole('button', { name: /vowel harmony/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /placeholder topic 3/i }),
      ).toBeNull();
    });

    it('still switches topics when a filtered result is clicked', async () => {
      const onSwitchTopic = vi.fn();
      render(
        <TheoryToc
          topic={mockTopic}
          activeSectionId="what"
          onJump={vi.fn()}
          language={Language.DE}
          onSwitchTopic={onSwitchTopic}
          fetchFn={listFetch(MANY_TOPICS)}
        />,
        { wrapper: Wrapper },
      );
      const filter = await screen.findByRole('searchbox', {
        name: /filter topics/i,
      });
      fireEvent.change(filter, { target: { value: 'harmony' } });
      fireEvent.click(screen.getByRole('button', { name: /vowel harmony/i }));
      expect(onSwitchTopic).toHaveBeenCalledWith('vowel-harmony');
    });

    it('shows an empty hint when nothing matches the query', async () => {
      render(
        <TheoryToc
          topic={mockTopic}
          activeSectionId="what"
          onJump={vi.fn()}
          language={Language.DE}
          onSwitchTopic={vi.fn()}
          fetchFn={listFetch(MANY_TOPICS)}
        />,
        { wrapper: Wrapper },
      );
      const filter = await screen.findByRole('searchbox', {
        name: /filter topics/i,
      });
      fireEvent.change(filter, { target: { value: 'zzz-no-match' } });

      expect(screen.getByText(/no topics match/i)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /vowel harmony/i }),
      ).toBeNull();
    });
  });

  describe('mobile (≤760px)', () => {
    beforeEach(() => {
      mockIsMobile.mockReturnValue(true);
    });

    it('renders a horizontal strip instead of the vertical sidebar', () => {
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
      const nav = screen.getByRole('navigation', { name: /theory sections/i });
      expect(nav).toHaveClass('theory-toc-strip');
      // The vertical-only chrome is dropped on the strip.
      expect(screen.queryByText(/jump to/i)).toBeNull();
      expect(screen.queryByText(/other topics/i)).toBeNull();
    });

    it('keeps jump-to-section: clicking a tab calls onJump', () => {
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

    it('highlights the active section tab with aria-current', () => {
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
      expect(activeBtn).toHaveClass('active');
    });

    it('folds topic switches into the strip as trailing tabs', () => {
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
});
