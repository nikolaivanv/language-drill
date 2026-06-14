import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FwResults } from './fw-results';
import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';

const evaluation: FreeWritingEvaluationResponse = {
  overallScore: 0.8, overallCefr: 'B2', headline: 'Persuasive.', summary: 'Good.',
  criteria: [
    { id: 'task', label: 'Task achievement', score: 0.85, cefr: 'B2', note: 'n' },
    { id: 'coherence', label: 'Coherence & cohesion', score: 0.9, cefr: 'C1', note: 'n' },
    { id: 'lexis', label: 'Lexical resource', score: 0.75, cefr: 'B2', note: 'n' },
    { id: 'grammar', label: 'Grammatical range & accuracy', score: 0.68, cefr: 'B1', note: 'n' },
  ],
  errors: [], goodSpans: [], improved: { text: 'x' }, wordCount: 162, improvedWordCount: 168,
};

describe('FwResults', () => {
  it('shows the headline, overall CEFR and the four criteria', () => {
    render(<FwResults evaluation={evaluation} onCorrections={() => {}} onCompare={() => {}} onAnother={() => {}} />);
    expect(screen.getByText('Persuasive.')).toBeInTheDocument();
    expect(screen.getByText('Task achievement')).toBeInTheDocument();
    expect(screen.getByText('Grammatical range & accuracy')).toBeInTheDocument();
  });
  it('navigates to corrections', () => {
    const onCorrections = vi.fn();
    render(<FwResults evaluation={evaluation} onCorrections={onCorrections} onCompare={() => {}} onAnother={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /corrections/i }));
    expect(onCorrections).toHaveBeenCalled();
  });
});
