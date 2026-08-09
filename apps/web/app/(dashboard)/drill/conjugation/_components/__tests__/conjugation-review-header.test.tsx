import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConjugationReviewHeader } from '../conjugation-review-header';

describe('ConjugationReviewHeader', () => {
  it('renders the tier title and the count line', () => {
    render(<ConjugationReviewHeader correctCount={1} totalCount={1} durationSeconds={65} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('nice work.');
    expect(screen.getByText(/you got 1 of 1/i)).toBeInTheDocument();
  });

  it('renders the mid tier for a partial score', () => {
    render(<ConjugationReviewHeader correctCount={3} totalCount={5} durationSeconds={0} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('good attempt.');
  });

  it('renders no percent sign', () => {
    const { container } = render(
      <ConjugationReviewHeader correctCount={1} totalCount={3} durationSeconds={0} />,
    );
    expect(container.textContent).not.toContain('%');
  });

  it('formats the duration as m:ss', () => {
    render(<ConjugationReviewHeader correctCount={1} totalCount={1} durationSeconds={65} />);
    expect(screen.getByText(/1:05/)).toBeInTheDocument();
  });
});
