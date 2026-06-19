import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluencyDebrief } from '../fluency-debrief';
import type { FluencyItemResult } from '../fluency-metrics';

const results: FluencyItemResult[] = [
  { index: 0, type: 'cloze', promptLabel: 'El gato ___', userAnswer: 'está', correct: true, correctAnswer: 'está', latencyMs: 1000 },
  { index: 1, type: 'cloze', promptLabel: 'Bu film kısa ___.', userAnswer: 'degil', correct: false, correctAnswer: 'değil', latencyMs: 3000 },
];

describe('FluencyDebrief', () => {
  it('shows headline metrics and one recap row per item', () => {
    render(<FluencyDebrief results={results} onRestart={vi.fn()} />);
    // median of [1000,3000] = 2000ms -> 2.0s
    expect(screen.getByText('2.0s')).toBeInTheDocument();
    expect(screen.getByText(/1\/2 correct/)).toBeInTheDocument();
    expect(screen.getByText('El gato ___')).toBeInTheDocument();
    expect(screen.getByText('Bu film kısa ___.')).toBeInTheDocument();
    // the wrong item surfaces the correct answer
    expect(screen.getByText(/değil/)).toBeInTheDocument();
  });

  it('fires onRestart from the "drill again" control', () => {
    const onRestart = vi.fn();
    render(<FluencyDebrief results={results} onRestart={onRestart} />);
    fireEvent.click(screen.getByRole('button', { name: 'drill again' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('falls back to a minimal message when there are no results', () => {
    render(<FluencyDebrief results={[]} onRestart={vi.fn()} />);
    expect(screen.getByText('nice — that was fast')).toBeInTheDocument();
  });
});
