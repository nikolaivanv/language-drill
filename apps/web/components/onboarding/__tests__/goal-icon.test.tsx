import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GOAL_IDS } from '@language-drill/shared';
import { GoalIcon } from '../goal-icon';

describe('GoalIcon', () => {
  it('renders an aria-hidden svg with a stable testid for every goal id', () => {
    for (const id of GOAL_IDS) {
      const { container } = render(<GoalIcon id={id} />);
      const svg = container.querySelector(`[data-testid="goal-icon-${id}"]`);
      expect(svg, `missing icon for ${id}`).not.toBeNull();
      expect(svg!.tagName.toLowerCase()).toBe('svg');
      expect(svg!.getAttribute('aria-hidden')).toBe('true');
      expect(svg!.querySelector('path, rect, circle')).not.toBeNull();
    }
  });
});
