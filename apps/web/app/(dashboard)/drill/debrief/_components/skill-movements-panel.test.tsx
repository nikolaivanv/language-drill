import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SkillMovement } from '@language-drill/shared';
import { SkillMovementsPanel } from './skill-movements-panel';

const m = (over: Partial<SkillMovement>): SkillMovement => ({
  grammarPointKey: 'gp', label: 'Point', band: 'gain', confidence: 'high', ...over,
});

describe('SkillMovementsPanel', () => {
  it('renders nothing when there are no movements', () => {
    const { container } = render(<SkillMovementsPanel movements={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders mover rows with band copy and no mastery numbers', () => {
    render(
      <SkillMovementsPanel
        movements={[
          m({ grammarPointKey: 'a', label: 'Subjuntivo', band: 'strong-gain', confidence: 'high' }),
          m({ grammarPointKey: 'b', label: 'Concesivos', band: 'slip', confidence: 'low' }),
        ]}
      />,
    );
    expect(screen.getByText('Subjuntivo')).toBeInTheDocument();
    expect(screen.getByText(/Strong gain/)).toBeInTheDocument();
    expect(screen.getByText(/Slipped/)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/\d\.\d/);
  });

  it('summarizes steady points instead of listing them', () => {
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
    expect(screen.getByText(/2 held steady/)).toBeInTheDocument();
  });
});
