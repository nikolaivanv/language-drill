import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FwCorrections } from './fw-corrections';
import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';

const evaluation: FreeWritingEvaluationResponse = {
  overallScore: 0.8,
  overallCefr: 'B2',
  headline: 'h',
  summary: 's',
  criteria: [
    { id: 'task', label: 'Task achievement', score: 0.85, cefr: 'B2', note: 'n' },
    { id: 'coherence', label: 'Coherence & cohesion', score: 0.9, cefr: 'C1', note: 'n' },
    { id: 'lexis', label: 'Lexical resource', score: 0.75, cefr: 'B2', note: 'n' },
    { id: 'grammar', label: 'Grammatical range & accuracy', score: 0.68, cefr: 'B1', note: 'n' },
  ],
  errors: [
    {
      n: 1,
      severity: 'high',
      type: 'Modo verbal',
      original: 'tendría',
      correction: 'tuviera',
      where: '§3',
      note: 'Use subjunctive.',
    },
  ],
  goodSpans: ['Sin embargo'],
  improved: { text: 'x' },
  wordCount: 162,
  improvedWordCount: 168,
};
const original = 'Sin embargo, si yo tendría la oportunidad, elegiría.';

describe('FwCorrections', () => {
  it('renders the error list with type and correction', () => {
    render(
      <FwCorrections
        evaluation={evaluation}
        original={original}
        onCompare={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getByText('Modo verbal')).toBeInTheDocument();
    expect(screen.getAllByText('tuviera').length).toBeGreaterThan(0);
  });
  it('advances to compare', () => {
    const onCompare = vi.fn();
    render(
      <FwCorrections
        evaluation={evaluation}
        original={original}
        onCompare={onCompare}
        onBack={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /compare/i }));
    expect(onCompare).toHaveBeenCalled();
  });
  it('labels severity counts in English, not Spanish', () => {
    render(
      <FwCorrections
        evaluation={evaluation}
        original={original}
        onCompare={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getByText('1 high')).toBeInTheDocument();
    expect(screen.getByText('0 medium')).toBeInTheDocument();
    expect(screen.getByText('0 low')).toBeInTheDocument();
    // The per-error SevTag is English too (no Spanish severity words anywhere).
    expect(screen.queryByText('alta')).toBeNull();
    expect(screen.queryByText('media')).toBeNull();
    expect(screen.queryByText('baja')).toBeNull();
  });
  it('goes back on click', () => {
    const onBack = vi.fn();
    render(
      <FwCorrections
        evaluation={evaluation}
        original={original}
        onCompare={() => {}}
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalled();
  });
});
