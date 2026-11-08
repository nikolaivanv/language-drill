import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

type MutationState = {
  mutate: ReturnType<typeof vi.fn>;
  data: { audioUrl: string | null; durationSec: number } | undefined;
  isPending: boolean;
  isError: boolean;
  error: (Error & { status?: number }) | null;
};
const state: MutationState = { mutate: vi.fn(), data: undefined, isPending: false, isError: false, error: null };

vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, usePhraseAudio: () => state };
});

import { SpokenSentence } from '../spoken-sentence';

const fetchFn = vi.fn();
const props = { text: 'Eve gidiyorum.', exerciseId: 'ex-1', submissionId: 'sub-1', fetchFn };

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.mocked(HTMLMediaElement.prototype.play).mockClear();
  state.mutate = vi.fn();
  state.data = undefined;
  state.isPending = false;
  state.isError = false;
  state.error = null;
});

describe('SpokenSentence', () => {
  it('shows the sentence and a play button, no request before click', () => {
    render(<SpokenSentence {...props} />);
    expect(screen.getByText('Eve gidiyorum.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /listen/i })).toBeInTheDocument();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('listen is a content-width design-system chip, not a full-width bar', () => {
    render(<SpokenSentence {...props} />);
    const btn = screen.getByRole('button', { name: /listen/i });
    // The card body is a flex column, which stretches children to full width.
    expect(btn).toHaveClass('self-start');
    expect(btn).toHaveClass('!rounded-pill');
  });

  it('first click calls mutate with exerciseId + submissionId', () => {
    render(<SpokenSentence {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    expect(state.mutate).toHaveBeenCalledWith({ exerciseId: 'ex-1', submissionId: 'sub-1' });
  });

  it('second click replays without a second mutate', () => {
    const { rerender } = render(<SpokenSentence {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    state.data = { audioUrl: 'https://signed/a.mp3', durationSec: 2 };
    rerender(<SpokenSentence {...props} />);
    // The loaded clip auto-plays once, then the player owns replay.
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'replay' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(state.mutate).toHaveBeenCalledTimes(1);
  });

  it("pending shows 'preparing audio…'", () => {
    const { rerender } = render(<SpokenSentence {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    state.isPending = true;
    rerender(<SpokenSentence {...props} />);
    expect(screen.getByText(/preparing audio/i)).toBeInTheDocument();
  });

  it('error shows a quiet retry chip', () => {
    const { rerender } = render(<SpokenSentence {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    state.isError = true;
    state.error = Object.assign(new Error('boom'), { status: 500 });
    rerender(<SpokenSentence {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /retry audio/i }));
    expect(state.mutate).toHaveBeenCalledTimes(2);
  });

  it("429 shows 'daily audio limit reached' inline", () => {
    const { rerender } = render(<SpokenSentence {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    state.isError = true;
    state.error = Object.assign(new Error('Daily audio limit reached'), { status: 429 });
    rerender(<SpokenSentence {...props} />);
    expect(screen.getByText(/daily audio limit reached/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry audio/i })).not.toBeInTheDocument();
  });
});
