import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ContentFieldView } from '../content-field-view';

describe('ContentFieldView', () => {
  const content = {
    type: 'cloze',
    instructions: 'Fill the blank',
    sentence: 'Maria ___ lo dio.',
    correctAnswer: 'se',
    acceptableAnswers: ['se', 'se lo'],
    _dedupKey: 'should-not-show',
  };

  it('renders labeled fields including the answer, hides type and _dedupKey', () => {
    render(<ContentFieldView content={content} />);
    expect(screen.getByText('sentence')).toBeInTheDocument();
    expect(screen.getByText('Maria ___ lo dio.')).toBeInTheDocument();
    expect(screen.getByText('correctAnswer')).toBeInTheDocument();
    expect(screen.getByText('se')).toBeInTheDocument();
    expect(screen.queryByText('_dedupKey')).not.toBeInTheDocument();
    expect(screen.queryByText('type')).not.toBeInTheDocument();
  });

  it('renders a raw JSON disclosure', () => {
    render(<ContentFieldView content={content} />);
    expect(screen.getByText('raw JSON')).toBeInTheDocument();
  });

  it('falls back to JSON for non-object content', () => {
    render(<ContentFieldView content={'just a string'} />);
    expect(screen.getByText(/just a string/)).toBeInTheDocument();
  });
});
