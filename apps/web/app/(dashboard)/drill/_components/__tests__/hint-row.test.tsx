import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HintRow } from '../hint-row';

const PROPS = {
  expectedWord: 'aprovechar',
  exampleSentence: 'Voy a aprovechar el día.',
} as const;

describe('HintRow', () => {
  // The hint is a single "show me a hint" chip that escalates one level per
  // click (first letter → letter count → example sentence) and hides once the
  // deepest available hint is shown — one consistent control across drills.
  describe('show me a hint chip', () => {
    it('shows the chip while deeper hints remain (with example, level 0)', () => {
      render(<HintRow {...PROPS} level={0} onAdvance={() => {}} />);
      expect(
        screen.getByRole('button', { name: 'show me a hint' }),
      ).toBeInTheDocument();
    });

    it('keeps the chip visible at an intermediate level', () => {
      render(<HintRow {...PROPS} level={2} onAdvance={() => {}} />);
      // An example sentence exists, so level 3 is still available.
      expect(
        screen.getByRole('button', { name: 'show me a hint' }),
      ).toBeInTheDocument();
    });

    it('hides the chip once the deepest hint is shown (with example, level 3)', () => {
      render(<HintRow {...PROPS} level={3} onAdvance={() => {}} />);
      expect(
        screen.queryByRole('button', { name: 'show me a hint' }),
      ).not.toBeInTheDocument();
    });

    it('hides the chip at level 2 when there is no example sentence', () => {
      render(
        <HintRow expectedWord="aprovechar" level={2} onAdvance={() => {}} />,
      );
      expect(
        screen.queryByRole('button', { name: 'show me a hint' }),
      ).not.toBeInTheDocument();
    });

    it('still shows the chip at level 1 when there is no example sentence', () => {
      render(
        <HintRow expectedWord="aprovechar" level={1} onAdvance={() => {}} />,
      );
      expect(
        screen.getByRole('button', { name: 'show me a hint' }),
      ).toBeInTheDocument();
    });
  });

  describe('reveal content', () => {
    it('reveals the first letter when level >= 1', () => {
      render(<HintRow {...PROPS} level={1} onAdvance={() => {}} />);
      expect(screen.getByText('a')).toBeInTheDocument();
      expect(screen.getByText(/first letter:/i)).toBeInTheDocument();
    });

    it('reveals the letter count when level >= 2', () => {
      render(<HintRow {...PROPS} level={2} onAdvance={() => {}} />);
      expect(screen.getByText('10 letters')).toBeInTheDocument();
    });

    it('reveals the example sentence with word masked as ___ when level >= 3', () => {
      render(<HintRow {...PROPS} level={3} onAdvance={() => {}} />);
      expect(screen.getByText('Voy a ___ el día.')).toBeInTheDocument();
    });

    it('does not reveal the first letter when level=0', () => {
      render(<HintRow {...PROPS} level={0} onAdvance={() => {}} />);
      expect(screen.queryByText(/first letter:/i)).not.toBeInTheDocument();
    });

    it('masks the word case-insensitively in the example sentence', () => {
      render(
        <HintRow
          expectedWord="aprovechar"
          exampleSentence="APROVECHAR ese día."
          level={3}
          onAdvance={() => {}}
        />,
      );
      expect(screen.getByText('___ ese día.')).toBeInTheDocument();
    });
  });

  describe('onAdvance callback', () => {
    it('calls onAdvance when the hint chip is clicked', () => {
      const onAdvance = vi.fn();
      render(<HintRow {...PROPS} level={0} onAdvance={onAdvance} />);
      fireEvent.click(screen.getByRole('button', { name: 'show me a hint' }));
      expect(onAdvance).toHaveBeenCalledTimes(1);
    });
  });
});
