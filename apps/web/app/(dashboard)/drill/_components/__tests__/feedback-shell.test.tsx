import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeedbackShell } from '../feedback-shell';
import {
  DrillActionProvider,
  useDrillAction,
  type DrillPrimaryAction,
} from '../drill-action-context';

function renderShell(overrides: Partial<React.ComponentProps<typeof FeedbackShell>> = {}) {
  const props = {
    tier: 'sage' as const,
    label: 'spot on',
    scoreChipText: '94%',
    onNext: vi.fn(),
    children: <p data-testid="body-slot">body content</p>,
    ...overrides,
  };
  return { props, ...render(<FeedbackShell {...props} />) };
}

describe('FeedbackShell', () => {
  describe('tier background mapping', () => {
    it('applies the sage soft background for tier=sage', () => {
      const { container } = renderShell({ tier: 'sage' });
      const card = container.firstElementChild as HTMLElement;
      expect(card.className).toContain('bg-[var(--color-ok-soft)]');
    });

    it('applies the yellow soft background for tier=yellow', () => {
      const { container } = renderShell({ tier: 'yellow' });
      const card = container.firstElementChild as HTMLElement;
      expect(card.className).toContain('bg-[var(--color-hilite-soft)]');
    });

    it('applies the terracotta soft background for tier=terracotta', () => {
      const { container } = renderShell({ tier: 'terracotta' });
      const card = container.firstElementChild as HTMLElement;
      expect(card.className).toContain('bg-[var(--color-accent-soft)]');
    });
  });

  describe('header content', () => {
    it('renders the label and score chip', () => {
      renderShell({ label: 'right word · wrong inflection', scoreChipText: '78%' });
      expect(screen.getByText('right word · wrong inflection')).toBeInTheDocument();
      expect(screen.getByText('78%')).toBeInTheDocument();
    });
  });

  describe('scaffolded chip', () => {
    it('renders the scaffolded chip when scaffolded=true', () => {
      renderShell({ scaffolded: true });
      const chip = screen.getByText('scaffolded');
      expect(chip).toBeInTheDocument();
      expect(chip).toHaveAttribute(
        'aria-label',
        'answered using multiple-choice scaffolding',
      );
    });

    it('does not render the scaffolded chip when scaffolded=false', () => {
      renderShell({ scaffolded: false });
      expect(screen.queryByText('scaffolded')).not.toBeInTheDocument();
    });

    it('does not render the scaffolded chip when scaffolded is omitted', () => {
      renderShell();
      expect(screen.queryByText('scaffolded')).not.toBeInTheDocument();
    });
  });

  describe('hint level chip', () => {
    it('renders "hint level 2" when hintLevel=2', () => {
      renderShell({ hintLevel: 2 });
      expect(screen.getByText('hint level 2')).toBeInTheDocument();
    });

    it('renders "hint level 1" when hintLevel=1', () => {
      renderShell({ hintLevel: 1 });
      expect(screen.getByText('hint level 1')).toBeInTheDocument();
    });

    it('does not render the hint chip when hintLevel=0', () => {
      renderShell({ hintLevel: 0 });
      expect(screen.queryByText(/hint level/i)).not.toBeInTheDocument();
    });

    it('does not render the hint chip when hintLevel is omitted', () => {
      renderShell();
      expect(screen.queryByText(/hint level/i)).not.toBeInTheDocument();
    });
  });

  describe('body slot', () => {
    it('renders the children inside the body slot', () => {
      renderShell();
      expect(screen.getByTestId('body-slot')).toBeInTheDocument();
      expect(screen.getByText('body content')).toBeInTheDocument();
    });
  });

  describe('next button', () => {
    it('calls onNext exactly once when clicked', () => {
      const onNext = vi.fn();
      renderShell({ onNext });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('renders the inline next button on desktop (no provider / inactive)', () => {
      renderShell();
      expect(
        screen.getByRole('button', { name: /next/i }),
      ).toBeInTheDocument();
    });
  });

  describe('advance on Enter', () => {
    it('calls onNext when the learner presses plain Enter', () => {
      const onNext = vi.fn();
      renderShell({ onNext });
      fireEvent.keyDown(document.body, { key: 'Enter' });
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('ignores a held Enter (auto-repeat) so it does not skip the verdict', () => {
      const onNext = vi.fn();
      renderShell({ onNext });
      fireEvent.keyDown(document.body, { key: 'Enter', repeat: true });
      expect(onNext).not.toHaveBeenCalled();
    });
  });

  describe('mobile action publishing', () => {
    it('publishes the next action and omits the inline button when active', () => {
      const onNext = vi.fn();
      let captured: DrillPrimaryAction | null = null;
      const getCaptured = () => captured;
      function Capture() {
        captured = useDrillAction().primaryAction;
        return null;
      }
      render(
        <DrillActionProvider active>
          <FeedbackShell
            tier="sage"
            label="spot on"
            scoreChipText="94%"
            onNext={onNext}
            nextLabel="see results"
          >
            <p>body</p>
          </FeedbackShell>
          <Capture />
        </DrillActionProvider>,
      );

      // No inline next button while active.
      expect(screen.queryByRole('button', { name: 'see results' })).toBeNull();

      // The published action carries the next label + onNext + accent variant.
      const action = getCaptured();
      expect(action?.label).toBe('see results');
      expect(action?.variant).toBe('accent');
      action?.onClick();
      expect(onNext).toHaveBeenCalledTimes(1);
    });
  });
});
