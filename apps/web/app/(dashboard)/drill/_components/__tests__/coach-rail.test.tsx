import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExerciseType } from '@language-drill/shared';
import { CoachRail } from '../coach-rail';

describe('CoachRail', () => {
  it('renders the message text', () => {
    render(
      <CoachRail message="hello there" exerciseType={ExerciseType.CLOZE} />,
    );
    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  it('renders the persona labels', () => {
    render(
      <CoachRail message="anything" exerciseType={ExerciseType.CLOZE} />,
    );
    expect(screen.getByText('coach')).toBeInTheDocument();
    expect(screen.getByText('guiding this session')).toBeInTheDocument();
  });

  it('renders a "c" avatar character', () => {
    render(
      <CoachRail message="anything" exerciseType={ExerciseType.CLOZE} />,
    );
    expect(screen.getByText('c')).toBeInTheDocument();
  });

  it.each([
    ['cloze', ExerciseType.CLOZE],
    ['translation', ExerciseType.TRANSLATION],
    ['vocab', ExerciseType.VOCAB_RECALL],
  ])('renders for exerciseType=%s without crashing', (_label, type) => {
    render(<CoachRail message="hello" exerciseType={type} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('shows the new message when re-rendered with a different message prop', () => {
    const { rerender } = render(
      <CoachRail message="first" exerciseType={ExerciseType.CLOZE} />,
    );
    expect(screen.getByText('first')).toBeInTheDocument();

    rerender(
      <CoachRail message="second" exerciseType={ExerciseType.CLOZE} />,
    );
    expect(screen.getByText('second')).toBeInTheDocument();
    expect(screen.queryByText('first')).not.toBeInTheDocument();
  });

  it('does not render any streak/XP/day/lesson/points text', () => {
    // Note: bare "sessions?" intentionally excluded — the rail's
    // "guiding this session" persona label is legitimate copy.
    // Page-level test (task 32) covers the "session N of M" counter pattern.
    const { container } = render(
      <CoachRail message="anything" exerciseType={ExerciseType.CLOZE} />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/streak|xp|lesson|days?|points?/i);
  });

  it('renders session-position dots when sessionCurrent/sessionTotal are provided', () => {
    render(
      <CoachRail
        message="anything"
        exerciseType={ExerciseType.CLOZE}
        sessionCurrent={2}
        sessionTotal={5}
      />,
    );
    expect(
      screen.getByRole('list', { name: 'item 2 of 5' }),
    ).toBeInTheDocument();
  });

  it('does not render session-position dots when position props are absent', () => {
    render(
      <CoachRail message="anything" exerciseType={ExerciseType.CLOZE} />,
    );
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('does not render a vocabulary tracker even when vocabActiveCount is provided', () => {
    render(
      <CoachRail
        message="anything"
        exerciseType={ExerciseType.VOCAB_RECALL}
        vocabActiveCount={42}
      />,
    );
    expect(screen.queryByText(/active words?/i)).not.toBeInTheDocument();
    expect(screen.queryByText('42')).not.toBeInTheDocument();
  });
});
