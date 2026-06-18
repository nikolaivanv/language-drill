import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SkillMovement } from '@language-drill/shared';
import { SkillMovementsPanel } from './skill-movements-panel';

const m = (over: Partial<SkillMovement>): SkillMovement => ({
  grammarPointKey: 'gp', label: 'Point', band: 'gain', confidence: 'high', ...over,
});

describe('SkillMovementsPanel', () => {
  it('renders the no-movement message when there are no movements', () => {
    render(<SkillMovementsPanel movements={[]} />);
    expect(screen.getByText('what moved')).toBeInTheDocument();
    expect(screen.getByText(/no skill movement recorded/i)).toBeInTheDocument();
  });

  it('renders the all-steady message when every movement is steady', () => {
    render(
      <SkillMovementsPanel
        movements={[m({ grammarPointKey: 'a', band: 'steady' }), m({ grammarPointKey: 'b', band: 'steady' })]}
      />,
    );
    expect(screen.getByText(/nothing shifted much/i)).toBeInTheDocument();
    expect(screen.getByText(/2 skills held steady/i)).toBeInTheDocument();
    expect(screen.getByText(/adds signal/i)).toBeInTheDocument();
  });

  it('renders mover rows with reworded band + confidence copy and no mastery numbers', () => {
    render(
      <SkillMovementsPanel
        movements={[
          m({ grammarPointKey: 'a', label: 'Subjuntivo', band: 'strong-gain', confidence: 'high' }),
          m({ grammarPointKey: 'b', label: 'Concesivos', band: 'slip', confidence: 'low' }),
        ]}
      />,
    );
    expect(screen.getByText('Subjuntivo')).toBeInTheDocument();
    expect(screen.getByText(/strong gain · we're confident/)).toBeInTheDocument();
    expect(screen.getByText(/slipped · early signal/)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/\d\.\d/);
  });

  it('sorts movers positive-first (strong-gain → gain → new → slip)', () => {
    render(
      <SkillMovementsPanel
        movements={[
          m({ grammarPointKey: 'd', label: 'Dslip', band: 'slip' }),
          m({ grammarPointKey: 'c', label: 'Cnew', band: 'new' }),
          m({ grammarPointKey: 'b', label: 'Bgain', band: 'gain' }),
          m({ grammarPointKey: 'a', label: 'Astrong', band: 'strong-gain' }),
        ]}
      />,
    );
    const labels = screen.getAllByText(/Astrong|Bgain|Cnew|Dslip/).map((el) => el.textContent);
    expect(labels).toEqual(['Astrong', 'Bgain', 'Cnew', 'Dslip']);
  });

  it('summarizes steady points beside movers with a pluralized footnote', () => {
    render(
      <SkillMovementsPanel
        movements={[
          m({ grammarPointKey: 'a', label: 'Gained', band: 'gain' }),
          m({ grammarPointKey: 'b', label: 'Flat1', band: 'steady' }),
          m({ grammarPointKey: 'c', label: 'Flat2', band: 'steady' }),
        ]}
      />,
    );
    expect(screen.queryByText('Flat1')).not.toBeInTheDocument();
    expect(screen.getByText(/2 skills held steady/)).toBeInTheDocument();
  });

  it('uses singular "skill" when exactly one held steady', () => {
    render(
      <SkillMovementsPanel
        movements={[
          m({ grammarPointKey: 'a', label: 'Gained', band: 'gain' }),
          m({ grammarPointKey: 'b', label: 'Flat1', band: 'steady' }),
        ]}
      />,
    );
    expect(screen.getByText(/1 skill held steady/)).toBeInTheDocument();
  });

  it('preserves input order within the same band (stable sort)', () => {
    render(
      <SkillMovementsPanel
        movements={[
          m({ grammarPointKey: 'a', label: 'Gfirst', band: 'gain' }),
          m({ grammarPointKey: 'b', label: 'Gsecond', band: 'gain' }),
        ]}
      />,
    );
    const labels = screen.getAllByText(/Gfirst|Gsecond/).map((el) => el.textContent);
    expect(labels).toEqual(['Gfirst', 'Gsecond']);
  });
});
