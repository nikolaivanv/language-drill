import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExerciseType, type ClozeContent } from '@language-drill/shared';
import { ClozePrompt } from '../cloze-prompt';

const base: ClozeContent = {
  type: ExerciseType.CLOZE,
  instructions: 'fill the gap',
  sentence: 'Ahmet bugün ___ kalkar.',
  correctAnswer: 'erken',
  context: 'geniş zaman',
  glossEn: 'Ahmet gets up ___ today.',
};

function Harness({ content = base }: { content?: ClozeContent }) {
  const [answer, setAnswer] = React.useState('');
  const ref = React.useRef<HTMLInputElement | null>(null);
  return (
    <ClozePrompt
      content={content}
      answer={answer}
      onAnswerChange={setAnswer}
      blankState={answer ? 'filled' : 'idle'}
      disabled={false}
      onEnterSubmit={() => {}}
      inputRef={ref}
    />
  );
}

describe('ClozePrompt', () => {
  it('renders the context eyebrow, the split sentence with an inline blank, and the gloss', () => {
    render(<Harness />);
    expect(screen.getByText('geniş zaman')).toBeInTheDocument();
    expect(screen.getByText(/Ahmet bugün/)).toBeInTheDocument();
    expect(screen.getByText(/Ahmet gets up/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'fill the blank' })).toBeInTheDocument();
  });

  it('fires onEnterSubmit when Enter is pressed in the blank', () => {
    const onEnter = vi.fn();
    const ref = React.createRef<HTMLInputElement>();
    render(
      <ClozePrompt
        content={base}
        answer="erken"
        onAnswerChange={() => {}}
        blankState="filled"
        disabled={false}
        onEnterSubmit={onEnter}
        inputRef={ref}
      />,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'fill the blank' }), { key: 'Enter' });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
