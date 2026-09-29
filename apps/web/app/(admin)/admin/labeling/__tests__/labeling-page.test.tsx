import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const saveMutate = vi.fn();
const refetchQueue = vi.fn();
const queueData = {
  items: [
    {
      submissionId: 'sub-1', exerciseId: 'ex-1', language: 'ES', cefrLevel: 'B1',
      exerciseType: 'cloze', grammarPointKey: 'es.b1.x',
      learnerView: 'Ayer ___ al mercado.', referenceAnswers: { correctAnswer: 'fui' },
      userAnswer: 'iba', evaluation: { score: 0.4, feedback: 'nope', errors: [] },
      score: 0.4, evaluatedAt: null, optionsRevealed: false,
    },
    {
      submissionId: 'sub-2', exerciseId: 'ex-2', language: 'TR', cefrLevel: 'A2',
      exerciseType: 'translation', grammarPointKey: 'tr.a2.y',
      learnerView: 'Translate: I went.', referenceAnswers: { referenceTranslation: 'Gittim.' },
      userAnswer: 'gidiyorum', evaluation: { score: 0.5, feedback: 'tense', errors: [] },
      score: 0.5, evaluatedAt: null, optionsRevealed: false,
    },
  ],
  remaining: 2,
  dropped: 0,
};

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('@language-drill/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@language-drill/api-client')>()),
  createAuthenticatedFetch: () => vi.fn(),
  useLabelingQueue: () => ({ data: queueData, isLoading: false, isError: false, refetch: refetchQueue }),
  useSaveLabel: () => ({ mutate: saveMutate, mutateAsync: saveMutate, isPending: false }),
  useLabelingStats: () => ({ data: { strata: [], tags: [], labeledToday: 0 }, isLoading: false }),
}));

import LabelingPage from '../page';

describe('LabelingPage', () => {
  beforeEach(() => {
    saveMutate.mockReset();
    refetchQueue.mockReset();
    saveMutate.mockResolvedValue({ saved: true, promptVersion: 'evaluate@2026-09-22' });
    refetchQueue.mockResolvedValue({ data: queueData });
  });

  it('shows the first queued submission', () => {
    render(<LabelingPage />);
    expect(screen.getByText(/Ayer ___ al mercado/)).toBeInTheDocument();
  });

  it('records grade-wrong on "f" and feedback-ok on "k", then saves on Enter', async () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.change(screen.getByLabelText(/critique/i), { target: { value: 'me fui is fine' } });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    expect(saveMutate.mock.calls[0][0]).toMatchObject({
      submissionId: 'sub-1',
      gradeOk: false,
      feedbackOk: true,
      critique: 'me fui is fine',
      stratum: 'random',
    });
  });

  it('advances to the next submission after a save', async () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Translate: I went/)).toBeInTheDocument());
  });

  it('refuses to save a wrong verdict with no critique, and does not advance', async () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(saveMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/say what was wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/Ayer ___ al mercado/)).toBeInTheDocument();
  });

  it('does not fire a shortcut while the critique box has focus', async () => {
    render(<LabelingPage />);
    const box = screen.getByLabelText(/critique/i);
    box.focus();
    fireEvent.keyDown(box, { key: 'f' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it('refetches the queue and resets to the top after labeling the last item on the page', async () => {
    render(<LabelingPage />);

    // Label item 1 of 2, advance to item 2.
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Translate: I went/)).toBeInTheDocument());

    expect(refetchQueue).not.toHaveBeenCalled();

    // Label item 2 of 2 (the last item on the page) — this should trigger a
    // queue refetch instead of clamping the index and leaving the same
    // already-labelled card on screen.
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refetchQueue).toHaveBeenCalledTimes(1));
  });
});
