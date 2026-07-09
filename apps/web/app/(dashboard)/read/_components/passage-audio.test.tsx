import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { PassageAudio } from './passage-audio';

function renderWith(fetchFn: unknown) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PassageAudio entryId="e1" fetchFn={fetchFn as never} />
    </QueryClientProvider>,
  );
}

describe('PassageAudio', () => {
  it('fetches and mounts the player on click', async () => {
    const fetchFn = vi.fn(async () => ({
      json: async () => ({ audioUrl: 'https://signed/x.mp3', durationSec: 12, reason: 'ok' }),
    }));
    renderWith(fetchFn);
    await userEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'play' })).toBeInTheDocument());
    expect(fetchFn).toHaveBeenCalledWith('/read/e1/audio', { method: 'POST' });
  });

  it('shows an unavailable state when the passage is too long', async () => {
    const fetchFn = vi.fn(async () => ({
      json: async () => ({ audioUrl: null, durationSec: 0, reason: 'too_long' }),
    }));
    renderWith(fetchFn);
    await userEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(screen.getByText(/too long/i)).toBeInTheDocument());
  });

  it('shows a neutral unavailable state when presigning fails (reason ok, no audioUrl)', async () => {
    const fetchFn = vi.fn(async () => ({
      json: async () => ({ audioUrl: null, durationSec: 0, reason: 'ok' }),
    }));
    renderWith(fetchFn);
    await userEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(screen.getByText(/try again later/i)).toBeInTheDocument());
    expect(screen.queryByText(/too long/i)).not.toBeInTheDocument();
  });
});
