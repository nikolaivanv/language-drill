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
    reason: null,
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

    // Primary CTA is an ink button linking to the drill hub.
    const link = screen.getByRole('link', { name: /start/i });
    expect(link).toHaveAttribute('href', '/drill?start=quick');
    // Title from composeTitle(2, 3, CLOZE) = "core · cloze"; meta from the subtitle.
    expect(screen.getByText('core · cloze')).toBeInTheDocument();
    expect(screen.getByText(/subjunctive · 5 items · 4 min/)).toBeInTheDocument();
    // The "next up" eyebrow is the terracotta accent (raw utilities so the
    // accent colour wins over the muted type-scale class).
    const eyebrow = screen.getByText('next up');
    expect(eyebrow.className).toContain('text-accent-2');
    expect(eyebrow.className).not.toContain('t-micro');
  });

  it('routes to the quick-launch hub regardless of active language', () => {
    const data = planResponse([makeItem(1, 'queued')]);
    render(<NextUpCard data={data} language={Language.DE} />);
    expect(screen.getByRole('link', { name: /start/i })).toHaveAttribute(
      'href',
      '/drill?start=quick',
    );
  });

  it('CTA is a primary (ink-filled) button — card is not terracotta-filled', () => {
    const data = planResponse([makeItem(1, 'queued', { topicHint: 'subjunctive' })]);
    const { container } = render(<NextUpCard data={data} language={Language.ES} />);

    // The card surface must be neutral (bg-card), not accent-soft.
    const card = container.firstChild as HTMLElement;
    expect(card.className).toMatch(/bg-card/);
    expect(card.className).not.toMatch(/bg-accent(?!-soft)/);
    expect(card.className).not.toMatch(/bg-accent-soft/);

    // The CTA link carries primary button classes (ink fill).
    const cta = screen.getByRole('link', { name: /start/i });
    expect(cta.className).toMatch(/bg-ink/);
  });

  it('whole card is tappable via stretched-link — CTA has after:absolute after:inset-0, outer div has no aria-label', () => {
    const data = planResponse([makeItem(1, 'queued', { topicHint: 'subjunctive' })]);
    const { container } = render(<NextUpCard data={data} language={Language.ES} />);

    // Outer card div is position:relative and has NO aria-label (the inert div label was silent).
    const card = container.firstChild as HTMLElement;
    expect(card.className).toMatch(/\brelative\b/);
    expect(card).not.toHaveAttribute('aria-label');

    // The single CTA anchor carries the stretched-link overlay classes.
    const cta = screen.getByRole('link', { name: /start/i });
    expect(cta.className).toMatch(/after:absolute/);
    expect(cta.className).toMatch(/after:inset-0/);
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
