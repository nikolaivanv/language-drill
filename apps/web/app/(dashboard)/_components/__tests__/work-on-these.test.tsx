import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { InsightsErrorTheme } from '@language-drill/api-client';
import { WorkOnThese } from '../work-on-these';

const theme = (over: Partial<InsightsErrorTheme> = {}): InsightsErrorTheme => ({
  grammarPointKey: 'tr-a1-locative',
  grammarPointName: 'Locative case',
  errorType: 'grammar',
  count: 6,
  majorCount: 4,
  lastOccurredAt: '2026-06-19T00:00:00.000Z',
  sample: { wrongText: 'pazarda', correction: 'pazara' },
  score: 4.2,
  ...over,
});

describe('WorkOnThese', () => {
  it('renders nothing when there are no themes', () => {
    const { container } = render(<WorkOnThese themes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the grammar point, the slip, and the count', () => {
    render(<WorkOnThese themes={[theme()]} />);
    expect(screen.getByText('Locative case')).toBeInTheDocument();
    expect(screen.getByText(/pazarda/)).toBeInTheDocument();
    expect(screen.getByText(/pazara/)).toBeInTheDocument();
    expect(screen.getByText(/6×/)).toBeInTheDocument();
  });

  it('falls back to the error type when grammar point name is null', () => {
    render(<WorkOnThese themes={[theme({ grammarPointKey: null, grammarPointName: null })]} />);
    expect(screen.getByText(/grammar/i)).toBeInTheDocument();
  });

  it('caps the list at three themes', () => {
    const themes = ['a', 'b', 'c', 'd', 'e'].map((k, i) =>
      theme({ grammarPointKey: k, grammarPointName: `Point ${k}`, count: 10 - i }),
    );
    render(<WorkOnThese themes={themes} />);
    expect(screen.getByText('Point a')).toBeInTheDocument();
    expect(screen.queryByText('Point d')).not.toBeInTheDocument();
  });
});
