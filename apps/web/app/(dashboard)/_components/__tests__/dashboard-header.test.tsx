import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RadarAxis, RadarAxisKey } from '@language-drill/api-client';
import { Language, type LearningLanguage } from '@language-drill/shared';
import { DashboardHeader } from '../dashboard-header';

// ---------------------------------------------------------------------------
// Lock the clock so GreetingBlock's post-mount strings are deterministic.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 4, 4, 10, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

function axis(
  key: RadarAxisKey,
  currentMastery: number,
  evidenceCount = 5,
  label: string = key,
): RadarAxis {
  return {
    key,
    label,
    currentMastery,
    previousMastery: currentMastery,
    lastPracticedAt: null,
    evidenceCount,
  };
}

const baseProps: { language: LearningLanguage; firstName: string | null } = {
  language: Language.ES,
  firstName: 'juno',
};

// ---------------------------------------------------------------------------
// Framing paragraph
// ---------------------------------------------------------------------------

describe('DashboardHeader — framing paragraph', () => {
  it('renders the production-leaning line for a weakest-axis-below-0.5 array', () => {
    const axes: RadarAxis[] = [
      axis('grammar', 0.3, 5, 'grammar'),
      axis('vocabulary', 0.8),
    ];
    render(
      <DashboardHeader
        {...baseProps}
        axes={axes}
        totalEstimatedMinutes={12}
      />,
    );
    expect(
      screen.getByText(/grammar is the weakest right now/),
    ).toBeInTheDocument();
    expect(screen.getByText(/production, not recognition/)).toBeInTheDocument();
  });

  it('renders the generic line when axes is undefined (radar in flight)', () => {
    render(
      <DashboardHeader
        {...baseProps}
        axes={undefined}
        totalEstimatedMinutes={12}
      />,
    );
    expect(
      screen.getByText(
        /a balanced session — production first, then a vocabulary rep\./,
      ),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Total minutes vs skeleton
// ---------------------------------------------------------------------------

describe('DashboardHeader — total minutes', () => {
  it('shows "~12 min planned" when totalEstimatedMinutes is provided', () => {
    render(
      <DashboardHeader
        {...baseProps}
        axes={undefined}
        totalEstimatedMinutes={12}
      />,
    );
    expect(screen.getByText('~12 min planned')).toBeInTheDocument();
  });

  it('shows a skeleton placeholder when totalEstimatedMinutes is null', () => {
    const { container } = render(
      <DashboardHeader
        {...baseProps}
        axes={undefined}
        totalEstimatedMinutes={null}
      />,
    );
    expect(screen.queryByText(/min planned/)).not.toBeInTheDocument();
    // Skeleton element is the only animate-pulse node in the header.
    const skeleton = container.querySelector('span.animate-pulse');
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveAttribute('aria-hidden');
  });
});

// ---------------------------------------------------------------------------
// Subline + non-gamification guarantee
// ---------------------------------------------------------------------------

describe('DashboardHeader — copy invariants', () => {
  it("includes the \"here's today's plan.\" subline", () => {
    render(
      <DashboardHeader
        {...baseProps}
        axes={undefined}
        totalEstimatedMinutes={12}
      />,
    );
    expect(screen.getByText("here's today's plan.")).toBeInTheDocument();
  });

  it('renders no streak / XP / lesson-count copy anywhere', () => {
    const axes: RadarAxis[] = [
      axis('grammar', 0.3, 5, 'grammar'),
      axis('vocabulary', 0.8),
    ];
    const { container } = render(
      <DashboardHeader
        {...baseProps}
        axes={axes}
        totalEstimatedMinutes={12}
      />,
    );
    expect(container.textContent ?? '').not.toMatch(/streak|xp|lesson/i);
  });
});
