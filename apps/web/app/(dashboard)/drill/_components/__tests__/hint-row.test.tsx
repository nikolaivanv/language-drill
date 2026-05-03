import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HintRow } from '../hint-row';

const PROPS = {
  expectedWord: 'aprovechar',
  exampleSentence: 'Voy a aprovechar el día.',
} as const;

describe('HintRow', () => {
  describe('button visibility', () => {
    it('renders all three buttons when an exampleSentence is provided', () => {
      render(<HintRow {...PROPS} level={0} onAdvance={() => {}} />);
      expect(
        screen.getByRole('button', { name: 'first letter' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'letter count' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'example sentence' }),
      ).toBeInTheDocument();
    });

    it('hides the L3 button when exampleSentence is undefined', () => {
      render(
        <HintRow expectedWord="aprovechar" level={0} onAdvance={() => {}} />,
      );
      expect(
        screen.queryByRole('button', { name: 'example sentence' }),
      ).not.toBeInTheDocument();
    });

    it('hides the L3 button when exampleSentence is empty string', () => {
      render(
        <HintRow
          expectedWord="aprovechar"
          exampleSentence=""
          level={0}
          onAdvance={() => {}}
        />,
      );
      expect(
        screen.queryByRole('button', { name: 'example sentence' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('disabled state by level', () => {
    it('at level=0, only L1 is enabled', () => {
      render(<HintRow {...PROPS} level={0} onAdvance={() => {}} />);
      expect(
        screen.getByRole('button', { name: 'first letter' }),
      ).not.toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'letter count' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'example sentence' }),
      ).toBeDisabled();
    });

    it('at level=1, only L2 is enabled', () => {
      render(<HintRow {...PROPS} level={1} onAdvance={() => {}} />);
      expect(
        screen.getByRole('button', { name: 'first letter' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'letter count' }),
      ).not.toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'example sentence' }),
      ).toBeDisabled();
    });

    it('at level=2, only L3 is enabled', () => {
      render(<HintRow {...PROPS} level={2} onAdvance={() => {}} />);
      expect(
        screen.getByRole('button', { name: 'first letter' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'letter count' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'example sentence' }),
      ).not.toBeDisabled();
    });

    it('at level=3, all buttons are disabled', () => {
      render(<HintRow {...PROPS} level={3} onAdvance={() => {}} />);
      expect(
        screen.getByRole('button', { name: 'first letter' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'letter count' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'example sentence' }),
      ).toBeDisabled();
    });
  });

  describe('aria-pressed by level', () => {
    it('at level=0, all aria-pressed are false', () => {
      render(<HintRow {...PROPS} level={0} onAdvance={() => {}} />);
      expect(
        screen.getByRole('button', { name: 'first letter' }),
      ).toHaveAttribute('aria-pressed', 'false');
      expect(
        screen.getByRole('button', { name: 'letter count' }),
      ).toHaveAttribute('aria-pressed', 'false');
      expect(
        screen.getByRole('button', { name: 'example sentence' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });

    it('at level=2, L1 and L2 are aria-pressed', () => {
      render(<HintRow {...PROPS} level={2} onAdvance={() => {}} />);
      expect(
        screen.getByRole('button', { name: 'first letter' }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.getByRole('button', { name: 'letter count' }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.getByRole('button', { name: 'example sentence' }),
      ).toHaveAttribute('aria-pressed', 'false');
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
    it('calls onAdvance when the active L1 button is clicked', () => {
      const onAdvance = vi.fn();
      render(<HintRow {...PROPS} level={0} onAdvance={onAdvance} />);
      fireEvent.click(screen.getByRole('button', { name: 'first letter' }));
      expect(onAdvance).toHaveBeenCalledTimes(1);
    });

    it('does not call onAdvance when a disabled button is clicked', () => {
      const onAdvance = vi.fn();
      render(<HintRow {...PROPS} level={0} onAdvance={onAdvance} />);
      fireEvent.click(screen.getByRole('button', { name: 'letter count' }));
      expect(onAdvance).not.toHaveBeenCalled();
    });
  });
});
