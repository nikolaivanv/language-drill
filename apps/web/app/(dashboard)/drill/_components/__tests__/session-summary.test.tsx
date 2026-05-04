import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CompleteSessionResponse } from '@language-drill/api-client';
import { SessionSummary } from '../session-summary';

const SESSION_ID = '11111111-1111-1111-1111-111111111111';

function makeSummary(overrides: Partial<CompleteSessionResponse> = {}): CompleteSessionResponse {
  return {
    id: SESSION_ID,
    exerciseCount: 5,
    correctCount: 4,
    attemptedCount: 5,
    skippedCount: 0,
    durationSeconds: 240,
    ...overrides,
  };
}

function renderSummary(overrides: Partial<CompleteSessionResponse> = {}) {
  const onAnother = vi.fn();
  const onDone = vi.fn();
  const summary = makeSummary(overrides);
  const utils = render(
    <SessionSummary summary={summary} onAnother={onAnother} onDone={onDone} />,
  );
  return { onAnother, onDone, summary, ...utils };
}

describe('SessionSummary', () => {
  describe('all-correct session', () => {
    it('renders correct/total, accuracy, duration, and the strong coach line', () => {
      renderSummary({ correctCount: 5, attemptedCount: 5, durationSeconds: 240 });
      expect(screen.getByText('5 of 5')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
      expect(screen.getByText('4:00')).toBeInTheDocument();
      expect(screen.getByText('Strong session — that one stuck.')).toBeInTheDocument();
    });
  });

  describe('mixed session', () => {
    it('renders 4 of 5 and 80% with the solid coach line', () => {
      renderSummary({ correctCount: 4, attemptedCount: 5, durationSeconds: 180 });
      expect(screen.getByText('4 of 5')).toBeInTheDocument();
      expect(screen.getByText('80%')).toBeInTheDocument();
      expect(screen.getByText('3:00')).toBeInTheDocument();
      expect(screen.getByText('Solid session.')).toBeInTheDocument();
    });
  });

  describe('all-wrong session', () => {
    it('renders 0 of 5 and 0% with the tough coach line', () => {
      renderSummary({ correctCount: 0, attemptedCount: 5, durationSeconds: 60 });
      expect(screen.getByText('0 of 5')).toBeInTheDocument();
      expect(screen.getByText('0%')).toBeInTheDocument();
      expect(screen.getByText('1:00')).toBeInTheDocument();
      expect(
        screen.getByText('That one was tough — good signal.'),
      ).toBeInTheDocument();
    });
  });

  describe('with skipped > 0', () => {
    it('appends the skipped count and uses correct/attempted for accuracy', () => {
      renderSummary({
        correctCount: 2,
        exerciseCount: 5,
        attemptedCount: 4,
        skippedCount: 1,
        durationSeconds: 125,
      });
      expect(screen.getByText('2 of 5 · 1 skipped')).toBeInTheDocument();
      // 2 correct of 4 attempted → 50%
      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.getByText('2:05')).toBeInTheDocument();
    });
  });

  describe('attemptedCount === 0 (all skipped)', () => {
    it('renders accuracy as em-dash and uses the null-accuracy coach line', () => {
      renderSummary({
        correctCount: 0,
        exerciseCount: 5,
        attemptedCount: 0,
        skippedCount: 5,
        durationSeconds: 30,
      });
      expect(screen.getByText('0 of 5 · 5 skipped')).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
      expect(
        screen.getByText("Nice work — let's see what landed."),
      ).toBeInTheDocument();
    });
  });

  describe('button wiring', () => {
    it('clicking "another session" fires onAnother', () => {
      const { onAnother, onDone } = renderSummary();
      fireEvent.click(screen.getByRole('button', { name: 'another session' }));
      expect(onAnother).toHaveBeenCalledTimes(1);
      expect(onDone).not.toHaveBeenCalled();
    });

    it('clicking "done" fires onDone', () => {
      const { onAnother, onDone } = renderSummary();
      fireEvent.click(screen.getByRole('button', { name: 'done' }));
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onAnother).not.toHaveBeenCalled();
    });
  });

  describe('copy hygiene', () => {
    it('does not render streak/XP/lesson/points text', () => {
      const { container } = renderSummary({
        correctCount: 4,
        attemptedCount: 5,
      });
      expect(container.textContent ?? '').not.toMatch(/streak|xp|lesson|point/i);
    });
  });
});
