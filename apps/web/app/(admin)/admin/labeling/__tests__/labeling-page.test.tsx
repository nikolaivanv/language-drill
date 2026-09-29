import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LABEL_TAGS } from '@language-drill/shared';

const saveMutate = vi.fn();
const refetchQueue = vi.fn();
const useLabelingQueueSpy = vi.fn();
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
  useLabelingQueue: (args: unknown) => {
    useLabelingQueueSpy(args);
    return { data: queueData, isLoading: false, isError: false, refetch: refetchQueue };
  },
  useSaveLabel: () => ({ mutate: saveMutate, mutateAsync: saveMutate, isPending: false }),
  useLabelingStats: () => ({ data: { strata: [], tags: [], labeledToday: 0 }, isLoading: false }),
}));

import LabelingPage from '../page';

describe('LabelingPage', () => {
  beforeEach(() => {
    saveMutate.mockReset();
    refetchQueue.mockReset();
    useLabelingQueueSpy.mockReset();
    saveMutate.mockResolvedValue({ saved: true, promptVersion: 'evaluate@2026-09-22' });
    // Matches the real useQuery#refetch() shape closely enough for the
    // page's `res.isError` check: it resolves (never rejects) with a
    // result object.
    refetchQueue.mockResolvedValue({ data: queueData, isError: false, error: null });
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

  it('ignores verdict-shortcut keys typed while the critique box has focus', async () => {
    render(<LabelingPage />);
    const box = screen.getByLabelText(/critique/i);
    box.focus();
    // Dispatched on the box itself: in a real browser, a keydown while a
    // textarea is focused reports that textarea as e.target (fireEvent
    // dispatching on `window` instead does not reproduce real focus/target
    // behavior).
    fireEvent.keyDown(box, { key: 'f' });
    fireEvent.change(box, { target: { value: 'typed literally' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    expect(saveMutate.mock.calls[0][0]).toMatchObject({
      submissionId: 'sub-1',
      gradeOk: null, // the 'f' pressed while the box had focus had no effect
      critique: 'typed literally',
    });
  });

  it('saves when Enter is pressed from inside the focused critique box', async () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'f' });
    const box = screen.getByLabelText(/critique/i);
    fireEvent.change(box, { target: { value: 'wrong because X' } });
    box.focus();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    expect(saveMutate.mock.calls[0][0]).toMatchObject({
      submissionId: 'sub-1',
      gradeOk: false,
      critique: 'wrong because X',
    });
  });

  it('does not save on Shift+Enter from inside the critique box (newline instead)', () => {
    render(<LabelingPage />);
    const box = screen.getByLabelText(/critique/i);
    box.focus();
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it('does not double-save when Enter fires again while the end-of-page refetch is in flight', async () => {
    let resolveRefetch!: (value: { data: typeof queueData; isError: boolean; error: null }) => void;
    refetchQueue.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefetch = resolve;
        }),
    );

    render(<LabelingPage />);

    // Advance to the last item.
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Translate: I went/)).toBeInTheDocument());

    // Label the last item on the page — this starts the refetch and holds
    // it open (the mock above doesn't resolve yet).
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refetchQueue).toHaveBeenCalledTimes(1));

    // A repeated Enter — key-repeat from holding it down, or a habitual
    // double-press — must not re-save the row that already saved.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(saveMutate).toHaveBeenCalledTimes(2);

    resolveRefetch({ data: queueData, isError: false, error: null });
    await waitFor(() => expect(screen.queryByText(/Loading…/)).not.toBeInTheDocument());
  });

  it('keeps the position and shows a distinct message when the end-of-page refetch fails', async () => {
    refetchQueue.mockResolvedValueOnce({ data: undefined, isError: true, error: new Error('network') });

    render(<LabelingPage />);

    // Advance to the last item.
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Translate: I went/)).toBeInTheDocument());

    // Label the last item — the save succeeds but the refetch fails.
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(refetchQueue).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText(/label saved.*next page failed to load/i)).toBeInTheDocument(),
    );
    // The index was NOT reset: the still-displayed item is the one that was
    // just labelled, not item 0 of an (unfetched) new page.
    expect(screen.getByText(/Translate: I went/)).toBeInTheDocument();
    // Only the one save happened — no accidental second save from the
    // failed-refetch path.
    expect(saveMutate).toHaveBeenCalledTimes(2);
  });

  it('discards a draft typed during the refetch-failed retry once the retry succeeds', async () => {
    // First refetch (automatic, after saving the last item) fails; the
    // second (manual retry via Enter) succeeds.
    refetchQueue.mockResolvedValueOnce({ data: undefined, isError: true, error: new Error('network') });
    refetchQueue.mockResolvedValueOnce({ data: queueData, isError: false, error: null });

    render(<LabelingPage />);

    // Advance to the last item and label it: save succeeds, refetch fails.
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Translate: I went/)).toBeInTheDocument());

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByText(/label saved.*next page failed to load/i)).toBeInTheDocument(),
    );

    // The labeler, still looking at the stale (already-saved) card, types a
    // draft — a critique, and a verdict via the shortcut. This must never
    // ride onto the fresh page's first item once the retry succeeds.
    const box = screen.getByLabelText(/critique/i);
    fireEvent.change(box, { target: { value: 'typed while stale' } });
    fireEvent.keyDown(window, { key: 'f' });

    // Retry the refetch (this time it succeeds).
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText(/Ayer ___ al mercado/)).toBeInTheDocument());
    expect(screen.getByLabelText(/critique/i)).toHaveValue('');
    // Both verdict badges read "unsure" (draft.gradeOk/feedbackOk both
    // null) — the 'f' pressed while looking at the stale card did not
    // survive into the fresh item's draft.
    expect(screen.getAllByText('unsure')).toHaveLength(2);
    // No save happened off the back of the stale draft — only the original 2.
    expect(saveMutate).toHaveBeenCalledTimes(2);
  });

  it('clears the refetch-failed state and its error when switching strata', async () => {
    refetchQueue.mockResolvedValueOnce({ data: undefined, isError: true, error: new Error('network') });

    render(<LabelingPage />);

    // Advance to the last item and label it: save succeeds, refetch fails.
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Translate: I went/)).toBeInTheDocument());

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByText(/label saved.*next page failed to load/i)).toBeInTheDocument(),
    );

    // Switch strata to escape the stuck retry.
    fireEvent.change(screen.getByLabelText('stratum'), { target: { value: 'targeted' } });

    expect(screen.queryByText(/label saved.*next page failed to load/i)).not.toBeInTheDocument();

    // The next Enter must be a normal save attempt — not silently swallowed
    // into a retry-fetch for a state that no longer applies.
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(3));
  });

  it('does not double-save when Enter fires twice in the same tick, before either await resolves', async () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    // Fired back-to-back with no `await` between them, unlike the
    // "refetch in flight" test above (which waits for the first save before
    // firing the repeat). This is the narrower, same-tick race the ref-based
    // guard (committingRef) exists to close: on the first item (not the
    // page's last), isRefetching is never touched, and the mocked
    // save.isPending never turns true — so the state-based checks alone
    // would not have caught this even in principle.
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    // Flush any pending microtasks and confirm no further call ever lands.
    await Promise.resolve();
    await Promise.resolve();
    expect(saveMutate).toHaveBeenCalledTimes(1);
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

  // ---------------------------------------------------------------------
  // Filter UI (language / type / hasErrors) — previously unreachable dead
  // code in useLabelingQueue's `filters` param. These pin that the selects
  // actually reach the hook, and that (like the stratum select) changing one
  // resets the in-progress draft rather than letting it leak onto whatever
  // the new query serves at the same index.
  // ---------------------------------------------------------------------

  it('reaches useLabelingQueue with the selected language filter', () => {
    render(<LabelingPage />);
    fireEvent.change(screen.getByLabelText('language'), { target: { value: 'ES' } });
    expect(useLabelingQueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        stratum: 'random',
        filters: expect.objectContaining({ language: 'ES', type: undefined, hasErrors: undefined }),
      }),
    );
  });

  it('reaches useLabelingQueue with the selected type filter', () => {
    render(<LabelingPage />);
    fireEvent.change(screen.getByLabelText('type'), { target: { value: 'translation' } });
    expect(useLabelingQueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ type: 'translation' }),
      }),
    );
  });

  it('reaches useLabelingQueue with the hasErrors filter', () => {
    render(<LabelingPage />);
    fireEvent.change(screen.getByLabelText('hasErrors'), { target: { value: 'true' } });
    expect(useLabelingQueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ hasErrors: true }),
      }),
    );
  });

  it('resets the draft when a filter changes, same as switching strata', () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.change(screen.getByLabelText(/critique/i), { target: { value: 'typed before filtering' } });
    fireEvent.change(screen.getByLabelText('language'), { target: { value: 'ES' } });
    expect(screen.getByLabelText(/critique/i)).toHaveValue('');
    expect(screen.getAllByText('unsure')).toHaveLength(2);
  });

  // ---------------------------------------------------------------------
  // Keyboard bindings not otherwise covered above: d, u, /, the 1-7 tag
  // digits, and ←/→. (↑/↓ card-scrolling is verified by a throwaway
  // Playwright script per the dispatch — jsdom has no real layout/scroll
  // machinery to meaningfully assert scrollBy against, so it is skipped
  // here rather than faked.)
  // ---------------------------------------------------------------------

  it('records feedback-wrong on "d"', async () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'd' });
    fireEvent.change(screen.getByLabelText(/critique/i), { target: { value: 'feedback is wrong' } });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    expect(saveMutate.mock.calls[0][0]).toMatchObject({ gradeOk: true, feedbackOk: false });
  });

  it('clears both verdicts on "u"', () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'u' });
    expect(screen.getAllByText('unsure')).toHaveLength(2);
  });

  it('focuses the critique box on "/"', () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByLabelText(/critique/i)).toHaveFocus();
  });

  it('toggles tags 1 and 3 on digit keys, saved in LABEL_TAGS order', async () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: '1' });
    fireEvent.keyDown(window, { key: '3' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    expect(saveMutate.mock.calls[0][0].tags).toEqual([LABEL_TAGS[0], LABEL_TAGS[2]]);
  });

  it('untoggles a tag on a second press of the same digit', async () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    expect(saveMutate.mock.calls[0][0].tags).toEqual([]);
  });

  it('moves forward and back with ArrowRight/ArrowLeft', () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText(/Translate: I went/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText(/Ayer ___ al mercado/)).toBeInTheDocument();
  });
});
