import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExerciseType } from '@language-drill/shared';
import { TimelineItem, type TimelineItemStatus } from '../timeline-item';

// ---------------------------------------------------------------------------
// Render helper — wraps TimelineItem in an <ol> since it renders an <li>
// ---------------------------------------------------------------------------

type Props = React.ComponentProps<typeof TimelineItem>;

function renderItem(overrides: Partial<Props> = {}) {
  const defaults: Props = {
    index: 2,
    total: 5,
    type: ExerciseType.CLOZE,
    topicHint: 'pronoun placement',
    grammarPointName: null,
    itemCount: 4,
    estimatedMinutes: 3,
    status: 'queued' as TimelineItemStatus,
    isLast: false,
    href: null,
  };
  return render(
    <ol>
      <TimelineItem {...defaults} {...overrides} />
    </ol>,
  );
}

describe('TimelineItem — next-up', () => {
  it('renders the "next up" chip and the start link with the supplied href', () => {
    renderItem({
      status: 'next-up',
      href: '/drill?language=ES',
      index: 2,
      type: ExerciseType.CLOZE,
    });
    expect(screen.getByText('next up')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /start/ });
    expect(link).toHaveAttribute('href', '/drill?language=ES');
  });

  it('does not render the start link when href is null even if status is next-up', () => {
    renderItem({ status: 'next-up', href: null });
    expect(screen.queryByRole('link', { name: /start/ })).toBeNull();
  });

  it('shows the padded index in the rail circle (e.g. "02")', () => {
    renderItem({ status: 'next-up', href: '/drill?language=ES', index: 2 });
    expect(screen.getByText('02')).toBeInTheDocument();
  });

  it('CTA is a primary (ink-filled) button — row body has no terracotta fill', () => {
    renderItem({
      status: 'next-up',
      href: '/drill?language=ES',
    });

    // The CTA link carries primary button classes (ink fill).
    const cta = screen.getByRole('link', { name: /start/ });
    expect(cta.className).toMatch(/bg-ink/);

    // The list item itself must not carry a terracotta background fill class
    // (the accent circle on the rail node is intentional and lives inside a child).
    const li = screen.getByRole('listitem');
    expect(li.className).not.toMatch(/bg-accent/);
  });
});

describe('TimelineItem — done', () => {
  it('renders ✓, the done chip, and line-through on the title', () => {
    const { container } = renderItem({
      status: 'done',
      index: 1,
      type: ExerciseType.CLOZE,
      topicHint: 'pronoun placement',
    });
    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading.className).toContain('line-through');
    // The whole row dims when done.
    expect(container.querySelector('.opacity-55')).not.toBeNull();
  });

  it('hides the rail number when done (replaced by ✓)', () => {
    renderItem({ status: 'done', index: 3 });
    expect(screen.queryByText('03')).toBeNull();
  });
});

describe('TimelineItem — queued', () => {
  it('renders neither chip nor start link', () => {
    renderItem({ status: 'queued' });
    expect(screen.queryByText('next up')).toBeNull();
    expect(screen.queryByText('done')).toBeNull();
    expect(screen.queryByRole('link', { name: /start/ })).toBeNull();
  });
});

describe('TimelineItem — subtitle fallback (Req 3.5)', () => {
  it('falls back to the type label when topicHint is null', () => {
    renderItem({
      status: 'queued',
      type: ExerciseType.VOCAB_RECALL,
      topicHint: null,
      itemCount: 6,
    });
    // composeSubtitle(null, VOCAB_RECALL, 6) = "vocabulary recall · 6 items"
    expect(screen.getByText('vocabulary recall · 6 items')).toBeInTheDocument();
  });

  it('uses topicHint when provided', () => {
    renderItem({
      status: 'queued',
      type: ExerciseType.CLOZE,
      topicHint: 'pronoun placement',
      itemCount: 4,
    });
    expect(screen.getByText('pronoun placement · 4 items')).toBeInTheDocument();
  });

  it('leads with the grammar-point name over the topic when present (D5)', () => {
    renderItem({
      status: 'queued',
      type: ExerciseType.TRANSLATION,
      grammarPointName: 'Locative case -DA',
      topicHint: 'everyday life / transport',
      itemCount: 1,
    });
    expect(screen.getByText('Locative case -DA · 1 items')).toBeInTheDocument();
    expect(
      screen.queryByText('everyday life / transport · 1 items'),
    ).toBeNull();
  });
});

describe('TimelineItem — accessibility', () => {
  it('aria-label contains the index, the composed title, and the status', () => {
    renderItem({
      status: 'next-up',
      href: '/drill?language=ES',
      index: 2,
      type: ExerciseType.CLOZE,
      topicHint: 'pronoun placement',
    });
    // composeTitle(2, 5, CLOZE) = "core · cloze"
    const li = screen.getByRole('listitem');
    expect(li).toHaveAttribute('aria-label', '2. core · cloze, next-up');
  });
});

describe('TimelineItem — rail line', () => {
  it('renders the connecting line when isLast is false', () => {
    const { container } = renderItem({ isLast: false });
    // Connecting line is the only flex-1 div under the rail column.
    expect(container.querySelector('.bg-rule')).not.toBeNull();
  });

  it('omits the connecting line when isLast is true', () => {
    const { container } = renderItem({ isLast: true });
    expect(container.querySelector('.bg-rule')).toBeNull();
  });
});

describe('TimelineItem — mobile rail node (Req 4.3)', () => {
  it('shrinks the rail circle from 38px to ~28px at mobile width', () => {
    const { container } = renderItem({ status: 'queued', index: 2 });
    const circle = container.querySelector('.rounded-full')!;
    expect(circle).toHaveClass('h-[38px]', 'w-[38px]');
    expect(circle).toHaveClass('mobile:h-[28px]', 'mobile:w-[28px]');
  });
});

describe('TimelineItem — planned-time chip', () => {
  it('shows the estimated minutes', () => {
    renderItem({ estimatedMinutes: 9 });
    expect(screen.getByText('9 min')).toBeInTheDocument();
  });
});

describe('TimelineItem — reason hint', () => {
  it('shows "recent error spot" with accent tint when reason is error-fix', () => {
    renderItem({ reason: 'error-fix' });
    const hint = screen.getByText('recent error spot');
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveClass('text-accent-2');
  });

  it('shows "new point" with muted text when reason is new', () => {
    renderItem({ reason: 'new' });
    const hint = screen.getByText('new point');
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveClass('text-ink-mute');
  });

  it('shows "reinforcing" with muted text when reason is reinforce', () => {
    renderItem({ reason: 'reinforce' });
    const hint = screen.getByText('reinforcing');
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveClass('text-ink-mute');
  });

  it('shows "due for review" with muted text when reason is review', () => {
    renderItem({ reason: 'review' });
    const hint = screen.getByText('due for review');
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveClass('text-ink-mute');
  });

  it('does not render a hint when reason is null', () => {
    renderItem({ reason: null });
    expect(screen.queryByText(/new point|reinforcing|due for review|recent error spot/)).toBeNull();
  });

  it('does not render a hint when reason is undefined', () => {
    renderItem({ reason: undefined });
    expect(screen.queryByText(/new point|reinforcing|due for review|recent error spot/)).toBeNull();
  });
});
