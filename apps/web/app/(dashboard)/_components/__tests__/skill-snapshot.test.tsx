import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type {
  ProgressRadarResponse,
  RadarAxis,
  RadarAxisKey,
} from '@language-drill/api-client';
import { Language, type LearningLanguage } from '@language-drill/shared';
import { SkillRow } from '../skill-row';
import { SkillSnapshotGrid } from '../skill-snapshot-grid';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function axis(
  key: RadarAxisKey,
  currentMastery: number,
  previousMastery = currentMastery,
  evidenceCount = 5,
  label: string = key,
): RadarAxis {
  return {
    key,
    label,
    currentMastery,
    previousMastery,
    lastPracticedAt: null,
    evidenceCount,
  };
}

function radar(
  axes: RadarAxis[],
  language: LearningLanguage = Language.ES,
): ProgressRadarResponse {
  return { language, axes };
}

const baseGridProps: {
  language: LearningLanguage;
  onRetry: () => void;
} = { language: Language.ES, onRetry: () => {} };

// ---------------------------------------------------------------------------
// SkillRow — visual branches + delta formatting
// ---------------------------------------------------------------------------

describe('SkillRow — colour branches', () => {
  it('renders the percentage in accent and the bar fill in accent when mastery < 0.5', () => {
    const { container } = render(<SkillRow axis={axis('grammar', 0.42)} />);
    expect(screen.getByText('42%').className).toContain('text-accent');
    // The Bar fill <div> has the bg-accent class.
    expect(container.querySelector('.bg-accent')).not.toBeNull();
  });

  it('renders the percentage in ink-soft and the bar fill in ink when mastery ≥ 0.5', () => {
    const { container } = render(<SkillRow axis={axis('grammar', 0.7)} />);
    expect(screen.getByText('70%').className).toContain('text-ink-soft');
    expect(container.querySelector('.bg-accent')).toBeNull();
    expect(container.querySelector('.bg-ink')).not.toBeNull();
  });
});

describe('SkillRow — delta formatting', () => {
  it('renders an em dash when current === previous (delta rounds to 0)', () => {
    render(<SkillRow axis={axis('grammar', 0.6, 0.6)} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders "+4" with a plain plus for a +4-point gain', () => {
    render(<SkillRow axis={axis('grammar', 0.7, 0.66)} />);
    expect(screen.getByText('+4')).toBeInTheDocument();
  });

  it('renders "−2" with the U+2212 minus character for a -2-point drop', () => {
    render(<SkillRow axis={axis('grammar', 0.6, 0.62)} />);
    // Use the actual minus character to assert the right glyph was used.
    expect(screen.getByText('−2')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SkillSnapshotGrid — sort, error, empty, no-gamification
// ---------------------------------------------------------------------------

describe('SkillSnapshotGrid — sort order', () => {
  it('renders rows weakest-first; ties broken by axis.key.localeCompare', () => {
    const axes: RadarAxis[] = [
      axis('vocabulary', 0.92),
      axis('writing', 0.5, 0.5, 5, 'writing'),
      axis('reading', 0.5, 0.5, 5, 'reading'),
      axis('speaking', 0.71),
      axis('grammar', 0.31),
      axis('listening', 0.6),
    ];
    const { container } = render(
      <SkillSnapshotGrid
        {...baseGridProps}
        data={radar(axes)}
        isLoading={false}
        error={null}
      />,
    );
    // grab the visible label text in DOM order (select by the label class to avoid
    // matching the thin-cue spans that are first-child of the pct wrapper span)
    const labels = Array.from(
      container.querySelectorAll('.flex-1 span.text-\\[13px\\]'),
    ).map((el) => el.textContent);
    // Expected: grammar (0.31), reading (0.5, ties → 'reading' < 'writing'),
    // writing (0.5), listening (0.6), speaking (0.71), vocabulary (0.92)
    expect(labels).toEqual([
      'grammar',
      'reading',
      'writing',
      'listening',
      'speaking',
      'vocabulary',
    ]);
  });
});

describe('SkillSnapshotGrid — canonical breakpoint (Req 4.4, 1.6)', () => {
  it('stacks the skill meters 1-col ≤760 / 2-col above (no ad-hoc sm:)', () => {
    const axes: RadarAxis[] = [
      axis('grammar', 0.42),
      axis('vocabulary', 0.7),
    ];
    const { container } = render(
      <SkillSnapshotGrid
        {...baseGridProps}
        data={radar(axes)}
        isLoading={false}
        error={null}
      />,
    );
    const grid = container.querySelector('.grid')!;
    expect(grid).toHaveClass('grid-cols-2', 'mobile:grid-cols-1');
    expect(grid).not.toHaveClass('sm:grid-cols-2');
  });
});

describe('SkillSnapshotGrid — error state', () => {
  it('renders an error card with a retry button that calls onRetry', () => {
    const onRetry = vi.fn();
    render(
      <SkillSnapshotGrid
        {...baseGridProps}
        data={undefined}
        isLoading={false}
        error={new Error('snapshot down')}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('snapshot down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('SkillSnapshotGrid — empty state', () => {
  it('renders EmptySnapshotCard when every axis has evidenceCount === 0', () => {
    const axes: RadarAxis[] = [
      axis('listening', 0, 0, 0),
      axis('reading', 0, 0, 0),
      axis('speaking', 0, 0, 0),
      axis('writing', 0, 0, 0),
      axis('grammar', 0, 0, 0),
      axis('vocabulary', 0, 0, 0),
    ];
    render(
      <SkillSnapshotGrid
        {...baseGridProps}
        data={radar(axes)}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(
        /practice a few exercises and your skill snapshot will appear here\./,
      ),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /start a session/ });
    expect(link).toHaveAttribute('href', '/drill?start=quick');
  });
});

// ---------------------------------------------------------------------------
// SkillSnapshotGrid — trained vs not-started partition
// ---------------------------------------------------------------------------

describe('SkillSnapshotGrid — trained vs not-started', () => {
  it('excludes zero-evidence axes from the weakest-first list and shows them as not started', () => {
    const data = radar([
      axis('reading', 0, 0, 0),
      axis('grammar', 0.84, 0.84, 47),
      axis('writing', 0.85, 0.85, 38),
    ]);
    render(
      <SkillSnapshotGrid
        {...baseGridProps}
        data={data}
        isLoading={false}
        error={null}
      />,
    );
    // 'reading' is presented as not started, not as a 0% weakest row
    const notStartedEl = screen.getByText(/not started/i);
    expect(notStartedEl).toBeInTheDocument();
    // the not-started label text contains 'reading'
    expect(notStartedEl.textContent).toMatch(/reading/i);
    // a trained axis still shows its percentage
    expect(screen.getByText('84%')).toBeInTheDocument();
    // the zero-evidence axis must NOT appear as a 0% weakest-first row
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SkillRow — thin evidence cue
// ---------------------------------------------------------------------------

describe('SkillRow — thin evidence', () => {
  it('marks a trained-but-thin axis (evidenceCount < 5)', () => {
    render(<SkillRow axis={axis('listening', 0.97, 0.97, 4)} />);
    expect(screen.getByText(/thin/i)).toBeInTheDocument();
  });

  it('does not mark a well-evidenced axis', () => {
    render(<SkillRow axis={axis('grammar', 0.84, 0.84, 47)} />);
    expect(screen.queryByText(/thin/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// No-gamification invariant
// ---------------------------------------------------------------------------

describe('SkillSnapshotGrid — no streak / XP / lesson copy', () => {
  it('contains no streak / XP / lesson text in any state', () => {
    const axes: RadarAxis[] = [
      axis('listening', 0.42),
      axis('reading', 0.55),
      axis('speaking', 0.6),
      axis('writing', 0.7),
      axis('grammar', 0.8),
      axis('vocabulary', 0.9),
    ];
    const { container } = render(
      <SkillSnapshotGrid
        {...baseGridProps}
        data={radar(axes)}
        isLoading={false}
        error={null}
      />,
    );
    expect(container.textContent ?? '').not.toMatch(/streak|xp|lesson/i);
  });
});
