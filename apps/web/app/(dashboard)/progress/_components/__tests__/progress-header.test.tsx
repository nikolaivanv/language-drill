import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import { ProgressHeader } from '../progress-header';

describe('ProgressHeader', () => {
  it('renders the title and subtitle from the design prototype', () => {
    render(
      <ProgressHeader
        language={Language.ES}
        proficiencyLevel={CefrLevel.B2}
        weeksActive={6}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: /your progress/i }),
    ).toBeDefined();
    expect(
      screen.getByText(
        /honest skill numbers\. no xp, no levels — just where you actually are\./i,
      ),
    ).toBeDefined();
  });

  it('renders the full eyebrow when all three segments are provided', () => {
    render(
      <ProgressHeader
        language={Language.ES}
        proficiencyLevel={CefrLevel.B2}
        weeksActive={6}
      />,
    );
    expect(screen.getByText('español · B2 · 6 weeks in')).toBeDefined();
  });

  it('omits the level segment when proficiencyLevel is null', () => {
    render(
      <ProgressHeader
        language={Language.DE}
        proficiencyLevel={null}
        weeksActive={3}
      />,
    );
    expect(screen.getByText('deutsch · 3 weeks in')).toBeDefined();
    expect(screen.queryByText(/B[12]/)).toBeNull();
  });

  it('omits the weeks segment when weeksActive is null', () => {
    render(
      <ProgressHeader
        language={Language.TR}
        proficiencyLevel={CefrLevel.A2}
        weeksActive={null}
      />,
    );
    expect(screen.getByText('türkçe · A2')).toBeDefined();
    expect(screen.queryByText(/weeks in/)).toBeNull();
  });

  it('renders only the language segment when both level and weeks are null', () => {
    render(
      <ProgressHeader
        language={Language.ES}
        proficiencyLevel={null}
        weeksActive={null}
      />,
    );
    expect(screen.getByText('español')).toBeDefined();
  });

  it('does not render any streak / XP-counter / lesson-count indicators (CLAUDE.md hard rule)', () => {
    // The subtitle intentionally references "no XP, no levels" as an
    // anti-gamification message; this test rejects *indicators* (e.g.
    // "12 day streak", "120 XP earned", "47 lessons completed") not the
    // mere appearance of those words in disclaimer copy.
    const { container } = render(
      <ProgressHeader
        language={Language.ES}
        proficiencyLevel={CefrLevel.B2}
        weeksActive={6}
      />,
    );
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toMatch(/\d+\s+day\s+streak/);
    expect(text).not.toMatch(/\d+\s+xp\b/);
    expect(text).not.toMatch(/\d+\s+lessons?\s+completed/);
    // Bare "🔥 streak" indicator (no number) — also disallowed.
    expect(text).not.toMatch(/🔥/);
  });
});
