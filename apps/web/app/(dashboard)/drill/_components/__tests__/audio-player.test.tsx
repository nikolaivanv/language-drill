import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioPlayer } from '../audio-player';

beforeEach(() => {
  // jsdom doesn't implement media playback.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

describe('AudioPlayer', () => {
  // Exact name 'play' (not /play/i) so the query doesn't also match "replay".
  it('disables all controls when no src', () => {
    render(<AudioPlayer src={undefined} waveform={[0.5, 0.8]} durationSec={5} />);
    expect(screen.getByRole('button', { name: 'play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'replay' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /0\.75/ })).toBeDisabled();
  });

  it('toggles play when clicked', () => {
    render(<AudioPlayer src="blob:x" waveform={[0.5, 0.8]} durationSec={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'play' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('toggles 0.75x slow', () => {
    render(<AudioPlayer src="blob:x" waveform={[0.5]} durationSec={5} />);
    const slow = screen.getByRole('button', { name: /0\.75/ });
    fireEvent.click(slow);
    expect(slow).toHaveAttribute('aria-pressed', 'true');
  });
});
