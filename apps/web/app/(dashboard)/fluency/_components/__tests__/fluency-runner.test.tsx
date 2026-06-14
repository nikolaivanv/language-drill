import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FluencyRunner } from '../fluency-runner';

const exercises = [
  { id: 'e1', type: 'cloze', language: 'ES', difficulty: 'B1', grammarPointKey: null, contentJson: { type: 'cloze', sentence: 'El gato ___', correctAnswer: 'está' } },
  { id: 'e2', type: 'cloze', language: 'ES', difficulty: 'B1', grammarPointKey: null, contentJson: { type: 'cloze', sentence: 'La casa ___', correctAnswer: 'es' } },
];

describe('FluencyRunner', () => {
  it('submits an answer, shows the verdict, then advances', async () => {
    const submit = vi.fn(async () => ({ correct: true, correctAnswer: 'está', latencyMs: 1000 }));
    render(<FluencyRunner exercises={exercises as never} onSubmitAttempt={submit} onDone={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'está' } });
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ exerciseId: 'e1', answer: 'está' })));
    await screen.findByRole('status'); // verdict shown
    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    // second item now visible
    await screen.findByText('La casa ___');
  });

  it('calls onDone after the last item', async () => {
    const submit = vi.fn(async () => ({ correct: true, correctAnswer: 'x', latencyMs: 1 }));
    const onDone = vi.fn();
    render(<FluencyRunner exercises={[exercises[0]] as never} onSubmitAttempt={submit} onDone={onDone} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'está' } });
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));
    await screen.findByRole('button', { name: 'finish' });
    fireEvent.click(screen.getByRole('button', { name: 'finish' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('ignores a second submit click while the first is in flight', async () => {
    let resolve!: (v: { correct: boolean; correctAnswer: string; latencyMs: number }) => void;
    const submit = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(<FluencyRunner exercises={[exercises[0]] as never} onSubmitAttempt={submit as never} onDone={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'está' } });
    const btn = screen.getByRole('button', { name: 'submit' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    resolve({ correct: true, correctAnswer: 'está', latencyMs: 100 });
    await screen.findByRole('status');
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
