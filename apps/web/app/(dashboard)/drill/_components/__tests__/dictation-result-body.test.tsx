import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DictationResultBody } from '../dictation-result-body';

const result = {
  kind: 'dictation' as const,
  score: 0.82, grammarAccuracy: 0.82, vocabularyRange: 'B1', taskAchievement: 0.9,
  feedback: 'f', errors: [], estimatedCefrEvidence: 'B1',
  rawCharAccuracy: 0.8, adjustedCharAccuracy: 0.82, wordAccuracy: 0.9, listeningCefr: 'B1',
  headline: 'Casi', summary: 's',
  diff: [
    { kind: 'match' as const, text: 'el tiempo' },
    { kind: 'error' as const, id: 1, got: 'locura', expected: 'lo cura', severity: 'high' as const },
  ],
  differences: [
    { id: 1, kind: 'error' as const, category: 'word boundary', severity: 'high' as const, got: 'locura', expected: 'lo cura', note: 'Mis-segmented.' },
  ],
  criteria: [
    { id: 'phon', label: 'Phoneme discrimination', score: 0.8, cefr: 'B1', note: 'n' },
    { id: 'bound', label: 'Word-boundary tracking', score: 0.6, cefr: 'A2', note: 'n' },
  ],
};

it('renders the accuracy line, a difference card, and criteria rows', () => {
  render(<DictationResultBody result={result} />);
  expect(screen.getByText(/words/)).toBeInTheDocument();
  expect(screen.getByText('word boundary')).toBeInTheDocument();
  expect(screen.getByText('Mis-segmented.')).toBeInTheDocument();
  expect(screen.getByText('Phoneme discrimination')).toBeInTheDocument();
  expect(screen.getByText('Word-boundary tracking')).toBeInTheDocument();
});
