import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ExerciseType,
  Language,
  type DictationContent,
  type DictationResult,
} from '@language-drill/shared';
import { DictationExercise } from '../dictation-exercise';
import { DrillActionProvider } from '../drill-action-context';

const content: DictationContent = {
  type: ExerciseType.DICTATION,
  title: 'El tiempo lo cura todo',
  referenceText: 'el tiempo lo cura todo',
  sentences: ['el tiempo lo cura todo'],
  accent: 'español peninsular',
  voiceId: 'Sergio',
  tested: ['sinalefa'],
  durationSec: 6,
  waveform: [0.5, 0.8],
  audioUrl: 'blob:x',
};

const result: DictationResult = {
  kind: 'dictation',
  score: 0.97,
  grammarAccuracy: 0.97,
  vocabularyRange: 'B2',
  taskAchievement: 0.95,
  feedback: 'good',
  errors: [],
  estimatedCefrEvidence: 'B2',
  rawCharAccuracy: 0.94,
  adjustedCharAccuracy: 0.97,
  wordAccuracy: 0.95,
  listeningCefr: 'B2',
  headline: 'oído fino',
  summary: 'good',
  diff: [
    { kind: 'match', text: 'el tiempo' },
    { kind: 'error', id: 1, got: 'locura', expected: 'lo cura', severity: 'high' },
    { kind: 'match', text: 'todo' },
  ],
  differences: [
    {
      id: 1,
      kind: 'error',
      category: 'word boundary',
      severity: 'high',
      got: 'locura',
      expected: 'lo cura',
      note: 'la sinalefa borró el límite',
    },
  ],
  criteria: [
    { id: 'char', label: 'Character accuracy', score: 0.97, cefr: 'C1', note: 'n' },
  ],
};

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

function renderEx(submission: { kind: string; result?: DictationResult; meta?: Record<string, unknown> }) {
  const onSubmit = vi.fn();
  render(
    <DrillActionProvider active={false}>
      <DictationExercise
        content={content}
        language={Language.ES}
        submission={submission as Parameters<typeof DictationExercise>[0]['submission']}
        onSubmit={onSubmit}
        onNext={() => {}}
      />
    </DrillActionProvider>,
  );
  return { onSubmit };
}

describe('DictationExercise', () => {
  it('shows the brief + player and submits the typed transcription', () => {
    const { onSubmit } = renderEx({ kind: 'idle' });
    expect(screen.getByText('El tiempo lo cura todo')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'el tiempo locura todo' } });
    fireEvent.click(screen.getByRole('button', { name: /check|submit/i }));
    expect(onSubmit).toHaveBeenCalledWith('el tiempo locura todo', expect.anything());
  });

  it('renders the diff + a flagged difference note when evaluated', () => {
    renderEx({ kind: 'evaluated', result, meta: {} });
    expect(screen.getByText(/oído fino/)).toBeInTheDocument();
    expect(screen.getByText(/word boundary/i)).toBeInTheDocument();
    expect(screen.getByText(/la sinalefa borró el límite/)).toBeInTheDocument();
  });
});

describe('DictationExercise — Cmd/Ctrl+Enter submits', () => {
  it('keeps plain Enter as a newline, but submits on Cmd+Enter', () => {
    const { onSubmit } = renderEx({ kind: 'idle' });
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'el tiempo lo cura todo' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
