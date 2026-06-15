import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FwCompare } from './fw-compare';
import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';

const evaluation: FreeWritingEvaluationResponse = {
  overallScore: 0.8, overallCefr: 'B2', headline: 'h', summary: 's',
  criteria: [
    { id: 'task', label: 'Task achievement', score: 0.85, cefr: 'B2', note: 'n' },
    { id: 'coherence', label: 'Coherence & cohesion', score: 0.9, cefr: 'C1', note: 'n' },
    { id: 'lexis', label: 'Lexical resource', score: 0.75, cefr: 'B2', note: 'n' },
    { id: 'grammar', label: 'Grammatical range & accuracy', score: 0.68, cefr: 'B1', note: 'n' },
  ],
  errors: [{ n: 1, severity: 'high', type: 'Modo', original: 'tendría', correction: 'tuviera', note: 'n' }],
  goodSpans: [],
  improved: { text: 'Si yo tuviera la oportunidad.', upgrades: ['tuviera'] },
  wordCount: 5, improvedWordCount: 5,
};

describe('FwCompare', () => {
  it('shows both columns and the improved text', () => {
    render(
      <FwCompare
        evaluation={evaluation}
        original="Si yo tendría la oportunidad."
        onBack={() => {}}
      />,
    );
    expect(screen.getByText(/your text/i)).toBeInTheDocument();
    expect(screen.getByText(/improved/i)).toBeInTheDocument();
  });
  it('goes back on click', () => {
    const onBack = vi.fn();
    render(
      <FwCompare
        evaluation={evaluation}
        original="Si yo tendría la oportunidad."
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalled();
  });
});
