import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Language } from '@language-drill/shared';
import { TheoryPanel } from '../theory-panel';
import { mockIntersectionObserverInstances } from '../../../vitest.setup';

// The panel branches on `useIsMobile()` for the title-switcher. Default to
// desktop so the existing sidebar-based assertions hold; the mobile suite
// flips it on.
const mockIsMobile = vi.fn(() => false);
vi.mock('../../../lib/responsive', () => ({
  useIsMobile: () => mockIsMobile(),
}));

// Theory content now comes exclusively from the DB. Mock the topic/list hooks
// with a fixed set of ES fixtures so the panel's rendering, hub link, and
// topic-switching can be exercised without a fetch. Any non-ES language
// resolves to no topic / an empty list (the "coming soon" empty state).
const { esTopics } = vi.hoisted(() => ({
  esTopics: {
    subjunctive: {
      id: 'subjunctive',
      title: 'el subjuntivo',
      subtitle: 'the subjunctive mood',
      cefr: 'B1',
      sections: [],
    },
    'preterite-imperfect': {
      id: 'preterite-imperfect',
      title: 'pretérito vs. imperfecto',
      subtitle: '',
      cefr: 'B1',
      sections: [],
    },
    conditional: {
      id: 'conditional',
      title: 'el condicional',
      subtitle: '',
      cefr: 'B1',
      sections: [],
    },
  } as Record<string, { id: string; title: string; subtitle: string; cefr: string; sections: [] }>,
}));

vi.mock('../../../lib/hooks/use-theory-topic', () => ({
  useTheoryTopic: ({ language, topicId }: { language: string; topicId: string }) => ({
    topic: language === 'ES' ? (esTopics[topicId] ?? null) : null,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('../../../lib/hooks/use-theory-topics', () => ({
  useTheoryTopics: ({ language }: { language: string }) => ({
    topics:
      language === 'ES'
        ? Object.values(esTopics).map((t) => ({
            id: t.id,
            title: t.title,
            cefr: t.cefr,
            category: 'other' as const,
            order: null,
          }))
        : [],
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

// TheoryPanel renders inside a QueryClientProvider in the real app; keep one in
// scope for nested consumers even though the theory hooks are mocked.
function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockIntersectionObserverInstances.length = 0;
  mockIsMobile.mockReturnValue(false);
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
});

afterEach(() => {
  // The portal renders into document.body; cleanup() handles it, but the
  // body style lock can survive if a test errors before unmount.
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
});

describe('TheoryPanel', () => {
  it('renders into a portal on document.body', () => {
    render(
      <TheoryPanel
        topicId="subjunctive"
        language={Language.ES}
        triggerEl={null}
        onClose={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('sets aria-modal="true" and aria-labelledby resolves to the topic title', () => {
    render(
      <TheoryPanel
        topicId="subjunctive"
        language={Language.ES}
        triggerEl={null}
        onClose={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    const dialog = document.body.querySelector(
      '[role="dialog"]',
    ) as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const labelEl = document.getElementById(labelledBy!);
    expect(labelEl?.textContent).toBe('el subjuntivo');
  });

  it('renders a link to open the topic in the theory hub (new tab)', () => {
    render(
      <TheoryPanel
        topicId="subjunctive"
        language={Language.ES}
        triggerEl={null}
        onClose={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    const link = screen.getByRole('link', {
      name: /open el subjuntivo in theory hub \(new tab\)/i,
    });
    expect(link).toHaveAttribute('href', '/theory/subjunctive');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <TheoryPanel
        topicId="subjunctive"
        language={Language.ES}
        triggerEl={null}
        onClose={onClose}
      />,
      { wrapper: Wrapper },
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the overlay (backdrop) is clicked', () => {
    const onClose = vi.fn();
    render(
      <TheoryPanel
        topicId="subjunctive"
        language={Language.ES}
        triggerEl={null}
        onClose={onClose}
      />,
      { wrapper: Wrapper },
    );
    const overlay = document.body.querySelector('.theory-overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT call onClose when the panel itself (aside) is clicked', () => {
    const onClose = vi.fn();
    render(
      <TheoryPanel
        topicId="subjunctive"
        language={Language.ES}
        triggerEl={null}
        onClose={onClose}
      />,
      { wrapper: Wrapper },
    );
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the × button is clicked', () => {
    const onClose = vi.fn();
    render(
      <TheoryPanel
        topicId="subjunctive"
        language={Language.ES}
        triggerEl={null}
        onClose={onClose}
      />,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render an in-content "back to drill" CTA', () => {
    render(
      <TheoryPanel
        topicId="subjunctive"
        language={Language.ES}
        triggerEl={null}
        onClose={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    expect(
      screen.queryByRole('button', { name: /back to drill/i }),
    ).not.toBeInTheDocument();
  });

  it('swaps the rendered topic in place when an "other topic" is selected', () => {
    render(
      <TheoryPanel
        topicId="subjunctive"
        language={Language.ES}
        triggerEl={null}
        onClose={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    const dialog = document.body.querySelector(
      '[role="dialog"]',
    ) as HTMLElement;
    // The title (heading) — the topic also appears as a highlighted row in the
    // "all topics" nav list, so scope to the heading to avoid a double match.
    expect(
      within(dialog).getByRole('heading', { name: 'el subjuntivo' }),
    ).toBeInTheDocument();

    // Click the "other topic" button for preterite vs. imperfecto.
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: /pretérito vs\. imperfecto/i,
      }),
    );

    // Title in the same dialog should now reflect the new topic without a
    // remount (we keep the same dialog element reference).
    const dialogAfter = document.body.querySelector('[role="dialog"]');
    expect(dialogAfter).toBe(dialog);
    expect(
      within(dialog).getByRole('heading', { name: 'pretérito vs. imperfecto' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', {
        name: /open pretérito vs\. imperfecto in theory hub \(new tab\)/i,
      }),
    ).toHaveAttribute('href', '/theory/preterite-imperfect');
  });

  it('renders the empty state when the topic does not exist for the language', () => {
    render(
      <TheoryPanel
        topicId={'subjunctive' as never}
        language={Language.DE}
        triggerEl={null}
        onClose={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    // Empty-state copy from theory-empty.tsx — the "coming soon" line is
    // unique to the no-topics-for-this-language branch (FR-7.2).
    expect(
      screen.getByText(/coming soon/i),
    ).toBeInTheDocument();
  });

  describe('mobile (≤760px)', () => {
    beforeEach(() => {
      mockIsMobile.mockReturnValue(true);
    });

    it('renders the title as a topic-switcher control (no second ribbon)', () => {
      render(
        <TheoryPanel
          topicId="subjunctive"
          language={Language.ES}
          triggerEl={null}
          onClose={vi.fn()}
        />,
        { wrapper: Wrapper },
      );
      // The title is now a button that opens the switcher…
      expect(
        screen.getByRole('button', { name: /switch topic.*el subjuntivo/i }),
      ).toBeInTheDocument();
      // …and the old in-TOC "other topics" ribbon button is gone.
      expect(
        screen.queryByRole('button', { name: /pretérito vs\. imperfecto/i }),
      ).toBeNull();
    });

    it('opens the switcher sheet when the title is tapped', () => {
      render(
        <TheoryPanel
          topicId="subjunctive"
          language={Language.ES}
          triggerEl={null}
          onClose={vi.fn()}
        />,
        { wrapper: Wrapper },
      );
      expect(
        screen.queryByRole('searchbox', { name: /search all topics/i }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole('button', { name: /switch topic.*el subjuntivo/i }),
      );
      expect(
        screen.getByRole('searchbox', { name: /search all topics/i }),
      ).toBeInTheDocument();
    });

    it('swaps the topic when a sheet row is picked', () => {
      render(
        <TheoryPanel
          topicId="subjunctive"
          language={Language.ES}
          triggerEl={null}
          onClose={vi.fn()}
        />,
        { wrapper: Wrapper },
      );
      fireEvent.click(
        screen.getByRole('button', { name: /switch topic.*el subjuntivo/i }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: /pretérito vs\. imperfecto/i }),
      );
      // Sheet closed and the title now reflects the new topic.
      expect(
        screen.queryByRole('searchbox', { name: /search all topics/i }),
      ).toBeNull();
      expect(
        screen.getByRole('button', {
          name: /switch topic.*pretérito vs\. imperfecto/i,
        }),
      ).toBeInTheDocument();
    });

    it('Escape closes the switcher sheet without closing the panel', () => {
      const onClose = vi.fn();
      render(
        <TheoryPanel
          topicId="subjunctive"
          language={Language.ES}
          triggerEl={null}
          onClose={onClose}
        />,
        { wrapper: Wrapper },
      );
      fireEvent.click(
        screen.getByRole('button', { name: /switch topic.*el subjuntivo/i }),
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      // Sheet gone, panel still open (its onClose not called).
      expect(
        screen.queryByRole('searchbox', { name: /search all topics/i }),
      ).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
