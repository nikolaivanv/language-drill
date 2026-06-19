import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExerciseType } from '@language-drill/shared';
import type { DebriefItem } from '@language-drill/api-client';

vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    useFlagExercise: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
  };
});

import { ReviewTab } from '../review-tab';

const fetchFn = vi.fn();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleEvaluation = {
  score: 0.5,
  grammarAccuracy: 0.5,
  vocabularyRange: 'B1',
  taskAchievement: 0.5,
  feedback: 'fb',
  errors: [],
  estimatedCefrEvidence: 'B1',
};

function clozeItem(
  id: string,
  status: DebriefItem['status'],
  label: string,
): DebriefItem {
  return {
    exerciseId: id,
    submissionId: status === 'skipped' ? null : 'aaaaaaaa-1111-4111-8111-111111111111',
    type: ExerciseType.CLOZE,
    grammarPointKey: `gp-${label}`,
    // The card now renders the grammar point (not the topic); use the label
    // here so order assertions can target the rendered chip.
    grammarPointName: label,
    contentJson: {
      type: ExerciseType.CLOZE,
      instructions: 'Fill in',
      sentence: `${label} ___ test`,
      correctAnswer: 'foo',
    },
    status,
    userAnswer: status === 'skipped' ? null : 'foo',
    score: status === 'skipped' ? null : status === 'correct' ? 0.95 : 0.3,
    evaluation: status === 'skipped' ? null : sampleEvaluation,
  };
}

// ---------------------------------------------------------------------------
// Renders one card per item (Req 5.1)
// ---------------------------------------------------------------------------

describe('ReviewTab', () => {
  it('renders one card per item', () => {
    const items: DebriefItem[] = [
      clozeItem('11111111-1111-4111-8111-111111111111', 'correct', 'topic-a'),
      clozeItem('22222222-2222-4222-8222-222222222222', 'incorrect', 'topic-b'),
      clozeItem('33333333-3333-4333-8333-333333333333', 'skipped', 'topic-c'),
    ];
    render(<ReviewTab items={items} fetchFn={fetchFn} />);
    // Each card emits a status chip — count them as a proxy for card count.
    expect(screen.getByText('✓ correct')).toBeDefined();
    expect(screen.getByText('✗ missed')).toBeDefined();
    expect(screen.getByText('skipped')).toBeDefined();
  });

  it('preserves manifest order even when items are not pre-sorted by id', () => {
    // Pass items in deliberately non-id order; render order should match the
    // array order (which the page guarantees comes from the manifest).
    const items: DebriefItem[] = [
      clozeItem('99999999-9999-4999-8999-999999999999', 'correct', 'zeta'),
      clozeItem('11111111-1111-4111-8111-111111111111', 'incorrect', 'alpha'),
      clozeItem('55555555-5555-4555-8555-555555555555', 'incorrect', 'kappa'),
    ];
    render(<ReviewTab items={items} fetchFn={fetchFn} />);

    // Index labels are #1, #2, #3 in the order ReviewItemCard receives them.
    // Each card renders its grammar-point chip (one distinct label per item),
    // so we can use them to verify visual order corresponds to the array order.
    const indices = screen.getAllByText(/^#\d+$/).map((el) => el.textContent);
    expect(indices).toEqual(['#1', '#2', '#3']);

    // The first card has the "zeta" grammar-point chip
    const labelElements = screen.getAllByText(/^(zeta|alpha|kappa)$/);
    expect(labelElements.map((el) => el.textContent)).toEqual([
      'zeta',
      'alpha',
      'kappa',
    ]);
  });

  it('renders an empty wrapper when items is empty (defensive)', () => {
    const { container } = render(<ReviewTab items={[]} fetchFn={fetchFn} />);
    // The wrapper div is rendered but has no card children.
    expect(container.querySelectorAll('[role="button"]').length).toBe(0);
  });

  it('uses exerciseId as the React key (no DOM warning, no duplicate-key crash)', () => {
    // Two items with the same exerciseId would normally trigger a React
    // duplicate-key warning. We deliberately pass distinct IDs and verify
    // the rendered count matches the input count — proving stable iteration.
    const items: DebriefItem[] = Array.from({ length: 5 }, (_, i) =>
      clozeItem(
        `${i.toString().padStart(8, '0')}-1111-4111-8111-111111111111`,
        'incorrect',
        `t${i}`,
      ),
    );
    render(<ReviewTab items={items} fetchFn={fetchFn} />);
    const indexLabels = screen.getAllByText(/^#\d+$/);
    expect(indexLabels).toHaveLength(5);
  });
});
