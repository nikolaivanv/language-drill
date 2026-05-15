import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Language } from '@language-drill/shared';
import { TheoryPanel } from '../theory-panel';
import { mockIntersectionObserverInstances } from '../../../vitest.setup';

// TheoryPanel consumes `useTheoryTopic` (TanStack Query) — provider required
// in scope. Tests omit `fetchFn`, so the hook degrades to static-only and
// `useQuery` stays `enabled: false`.
function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockIntersectionObserverInstances.length = 0;
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

  it('calls onClose when the "back to drill" CTA is clicked', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /back to drill/i }));
    expect(onClose).toHaveBeenCalled();
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
    expect(within(dialog).getByText('el subjuntivo')).toBeInTheDocument();

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
      within(dialog).getByText('pretérito vs. imperfecto'),
    ).toBeInTheDocument();
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
});
