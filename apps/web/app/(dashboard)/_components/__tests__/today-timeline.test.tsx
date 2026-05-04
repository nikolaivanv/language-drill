import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type {
  TodayPlanItem,
  TodayPlanItemStatus,
  TodayPlanResponse,
} from '@language-drill/api-client';
import {
  CefrLevel,
  ExerciseType,
  Language,
  type LearningLanguage,
} from '@language-drill/shared';
import { TodayTimeline } from '../today-timeline';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeItem(
  index: number,
  status: TodayPlanItemStatus,
  overrides: Partial<TodayPlanItem> = {},
): TodayPlanItem {
  const isCloze = index === 1 || index === 2 || index === 5;
  return {
    index,
    type: isCloze
      ? ExerciseType.CLOZE
      : index === 3
        ? ExerciseType.TRANSLATION
        : ExerciseType.VOCAB_RECALL,
    topicHint: 'pronoun placement',
    difficulty: CefrLevel.B1,
    itemCount: 4,
    estimatedMinutes: 3,
    status,
    ...overrides,
  };
}

function makeResponse(
  items: TodayPlanItem[],
  overrides: Partial<TodayPlanResponse> = {},
): TodayPlanResponse {
  return {
    language: Language.ES,
    generatedAt: '2026-05-04T10:00:00.000Z',
    totalEstimatedMinutes: items.reduce(
      (sum, it) => sum + it.estimatedMinutes,
      0,
    ),
    items,
    summary: null,
    code: null,
    ...overrides,
  };
}

const baseProps: { language: LearningLanguage; onRetry: () => void } = {
  language: Language.ES,
  onRetry: () => {},
};

// ---------------------------------------------------------------------------
// Loading + error + non-success cards
// ---------------------------------------------------------------------------

describe('TodayTimeline — loading state', () => {
  it('renders 5 skeleton rows when isLoading is true', () => {
    const { container } = render(
      <TodayTimeline
        {...baseProps}
        data={undefined}
        isLoading
        error={null}
      />,
    );
    const skeletons = container.querySelectorAll('li.animate-pulse');
    expect(skeletons.length).toBe(5);
  });
});

describe('TodayTimeline — error state', () => {
  it('renders TimelineErrorCard and calls onRetry on click', () => {
    const onRetry = vi.fn();
    render(
      <TodayTimeline
        {...baseProps}
        data={undefined}
        isLoading={false}
        error={new Error('boom')}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('boom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('TodayTimeline — pool not ready', () => {
  it('renders PoolNotReadyCard when code is INSUFFICIENT_POOL', () => {
    const data = makeResponse([], { code: 'INSUFFICIENT_POOL' });
    render(
      <TodayTimeline
        {...baseProps}
        data={data}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(/your spanish pool isn't ready yet/),
    ).toBeInTheDocument();
  });
});

describe('TodayTimeline — all done', () => {
  it('renders AllDoneCard when every item is done and summary is present', () => {
    const items = [1, 2, 3, 4, 5].map((i) => makeItem(i, 'done'));
    const data = makeResponse(items, {
      summary: { itemCount: 5, correctCount: 4, durationMinutes: 18 },
    });
    render(
      <TodayTimeline
        {...baseProps}
        data={data}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("you're done for today.")).toBeInTheDocument();
    expect(screen.getByText('5 of 5 · 18 minutes')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /start a fresh session/ });
    expect(link).toHaveAttribute('href', '/drill?language=ES');
  });
});

// ---------------------------------------------------------------------------
// Default render — next-up logic
// ---------------------------------------------------------------------------

describe('TodayTimeline — next-up assignment', () => {
  it('flags the first item as next-up when all 5 are queued', () => {
    const items = [1, 2, 3, 4, 5].map((i) => makeItem(i, 'queued'));
    render(
      <TodayTimeline
        {...baseProps}
        data={makeResponse(items)}
        isLoading={false}
        error={null}
      />,
    );
    // Exactly one "next up" chip and one start link.
    expect(screen.getAllByText('next up').length).toBe(1);
    const link = screen.getByRole('link', { name: /start/ });
    expect(link).toHaveAttribute('href', '/drill?language=ES');
    // No `done` chips on a fresh plan.
    expect(screen.queryAllByText('done').length).toBe(0);
  });

  it('with 2 done + 3 queued, the 3rd item is next-up and items 1–2 are done', () => {
    const items: TodayPlanItem[] = [
      makeItem(1, 'done'),
      makeItem(2, 'done'),
      makeItem(3, 'queued'),
      makeItem(4, 'queued'),
      makeItem(5, 'queued'),
    ];
    render(
      <TodayTimeline
        {...baseProps}
        data={makeResponse(items)}
        isLoading={false}
        error={null}
      />,
    );
    // Two `done` chips on the first two rows.
    expect(screen.getAllByText('done').length).toBe(2);
    // Exactly one `next up` chip — on item 3.
    const nextUpChip = screen.getByText('next up');
    // The chip lives inside the row whose aria-label starts with "3."
    const li = nextUpChip.closest('li');
    expect(li).not.toBeNull();
    expect(li!.getAttribute('aria-label')).toMatch(/^3\. /);
    expect(li!.getAttribute('aria-label')).toContain('next-up');
  });
});

// ---------------------------------------------------------------------------
// Screen-reader summary
// ---------------------------------------------------------------------------

describe('TodayTimeline — sr-only summary', () => {
  it('renders a visually-hidden ordered list with one <li> per plan item', () => {
    const items = [1, 2, 3, 4, 5].map((i) => makeItem(i, 'queued'));
    const { container } = render(
      <TodayTimeline
        {...baseProps}
        data={makeResponse(items)}
        isLoading={false}
        error={null}
      />,
    );
    const summary = container.querySelector('ol.sr-only');
    expect(summary).not.toBeNull();
    const lis = within(summary as HTMLElement).getAllByRole('listitem');
    expect(lis.length).toBe(5);
    // Each <li> mentions its index and status.
    expect(lis[0].textContent).toMatch(/^1\. /);
    expect(lis[0].textContent).toMatch(/next-up/);
    expect(lis[4].textContent).toMatch(/^5\. /);
    expect(lis[4].textContent).toMatch(/queued/);
  });
});
