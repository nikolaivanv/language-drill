import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import type {
  TodayPlanItem,
  TodayPlanItemStatus,
  TodayPlanResponse,
} from '@language-drill/api-client';
import { NextUpCard } from '../next-up-card';

function makeItem(
  index: number,
  status: TodayPlanItemStatus,
  overrides: Partial<TodayPlanItem> = {},
): TodayPlanItem {
  return {
    index,
    type: ExerciseType.CLOZE,
    topicHint: 'pronoun placement',
    grammarPointKey: null,
    grammarPointName: null,
    difficulty: CefrLevel.B1,
    itemCount: 4,
    estimatedMinutes: 3,
    status,
    ...overrides,
  };
}

function planResponse(
  items: TodayPlanItem[],
  overrides: Partial<TodayPlanResponse> = {},
): TodayPlanResponse {
  return {
    language: Language.ES,
    generatedAt: '2026-05-04T10:00:00.000Z',
    totalEstimatedMinutes: items.reduce((s, i) => s + i.estimatedMinutes, 0),
    items,
    summary: null,
    code: null,
    freeWriting: null,
    resumeSessionId: null,
    ...overrides,
  };
}

describe('NextUpCard', () => {
  it('surfaces the first not-done item with its title + meta and routes to the drill', () => {
    const data = planResponse([
      makeItem(1, 'done'),
      makeItem(2, 'queued', { topicHint: 'subjunctive', itemCount: 5, estimatedMinutes: 4 }),
      makeItem(3, 'queued'),
    ]);
    render(<NextUpCard data={data} language={Language.ES} />);

    const link = screen.getByRole('link', { name: /next up/i });
    expect(link).toHaveAttribute('href', '/drill?start=quick');
    // Title from composeTitle(2, CLOZE) = "core · cloze"; meta from the subtitle.
    expect(screen.getByText('core · cloze')).toBeInTheDocument();
    expect(screen.getByText(/subjunctive · 5 items · 4 min/)).toBeInTheDocument();
  });

  it('routes to the quick-launch hub regardless of active language', () => {
    const data = planResponse([makeItem(1, 'queued')]);
    render(<NextUpCard data={data} language={Language.DE} />);
    expect(screen.getByRole('link', { name: /next up/i })).toHaveAttribute(
      'href',
      '/drill?start=quick',
    );
  });

  it('renders nothing when there is no plan data', () => {
    const { container } = render(
      <NextUpCard data={undefined} language={Language.ES} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when every item is done', () => {
    const data = planResponse([makeItem(1, 'done'), makeItem(2, 'done')]);
    const { container } = render(
      <NextUpCard data={data} language={Language.ES} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the pool is insufficient', () => {
    const data = planResponse([], { code: 'INSUFFICIENT_POOL' });
    const { container } = render(
      <NextUpCard data={data} language={Language.ES} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
