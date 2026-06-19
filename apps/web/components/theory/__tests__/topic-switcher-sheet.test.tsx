import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { Language } from '@language-drill/shared';
import { TopicSwitcherSheet } from '../topic-switcher-sheet';

// A `fetchFn` that resolves the `/theory/:lang` list to `topics`. Lets a test
// inject a categorized list (the static registry only ships 3 uncategorized ES
// topics) so grouping/search have something to work on.
function listFetch(
  topics: Array<{
    id: string;
    title: string;
    cefr: string;
    category?: string;
    order?: number;
  }>,
) {
  return vi.fn<AuthenticatedFetch>().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ topics }),
  } as unknown as Response);
}

// DE has no static topics, so the injected list is the whole catalog.
const CATALOG = [
  { id: 'present', title: 'present continuous', cefr: 'A1', category: 'tenses', order: 1 },
  { id: 'past', title: 'past tense', cefr: 'A1', category: 'tenses', order: 2 },
  { id: 'subj', title: 'subjunctive mood', cefr: 'B1', category: 'moods', order: 1 },
];

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderSheet(
  props: Partial<React.ComponentProps<typeof TopicSwitcherSheet>> = {},
) {
  return render(
    <TopicSwitcherSheet
      language={Language.DE}
      currentTopicId="present"
      onPick={vi.fn()}
      onClose={vi.fn()}
      fetchFn={listFetch(CATALOG)}
      {...props}
    />,
    { wrapper: Wrapper },
  );
}

describe('TopicSwitcherSheet', () => {
  it('lists every topic, grouped by category in taxonomy order', async () => {
    renderSheet();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /past tense/i }),
      ).toBeInTheDocument(),
    );
    // Category group headers (taxonomy labels) are present.
    expect(screen.getByText('verb tenses')).toBeInTheDocument();
    expect(screen.getByText('moods & conditionals')).toBeInTheDocument();
    // All three topics surface as rows.
    expect(screen.getByRole('button', { name: /present continuous/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /subjunctive mood/i })).toBeInTheDocument();
  });

  it('marks the current topic with aria-current and a "viewing" badge', async () => {
    renderSheet({ currentTopicId: 'subj' });
    const current = await screen.findByRole('button', {
      name: /subjunctive mood/i,
    });
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(within(current).getByText(/viewing/i)).toBeInTheDocument();

    const other = screen.getByRole('button', { name: /present continuous/i });
    expect(other.getAttribute('aria-current')).toBeNull();
  });

  it('narrows the list as the user searches', async () => {
    renderSheet();
    const search = await screen.findByRole('searchbox', {
      name: /search all topics/i,
    });
    fireEvent.change(search, { target: { value: 'subjunctive' } });

    expect(screen.getByRole('button', { name: /subjunctive mood/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /past tense/i })).toBeNull();
  });

  it('shows an empty state when nothing matches', async () => {
    renderSheet();
    const search = await screen.findByRole('searchbox', {
      name: /search all topics/i,
    });
    fireEvent.change(search, { target: { value: 'zzz-nope' } });
    expect(screen.getByText(/no topics match/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /past tense/i })).toBeNull();
  });

  it('calls onPick with the chosen topic id', async () => {
    const onPick = vi.fn();
    renderSheet({ onPick });
    const row = await screen.findByRole('button', { name: /subjunctive mood/i });
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith('subj');
  });

  it('closes via the × button and the scrim', async () => {
    const onClose = vi.fn();
    const { container } = renderSheet({ onClose });
    await screen.findByRole('button', { name: /present continuous/i });

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    const scrim = container.querySelector('.theory-switcher-scrim');
    expect(scrim).not.toBeNull();
    fireEvent.click(scrim!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    renderSheet({ onClose });
    await screen.findByRole('button', { name: /present continuous/i });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
