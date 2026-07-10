import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { AudioPlayer } from '../audio-player';
import { mockIntersectionObserverInstances } from '../../../../../vitest.setup';

let mockIsMobile = false;
vi.mock('../../../../../lib/responsive', () => ({
  useIsMobile: () => mockIsMobile,
}));

beforeEach(() => {
  // jsdom doesn't implement media playback.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  mockIsMobile = false;
  mockIntersectionObserverInstances.length = 0;
});

/** jsdom returns a zero-size rect; give the seek slider a real width so the
 *  click→fraction math has something to divide by. */
function stubWidth(el: HTMLElement, left: number, width: number) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left,
    width,
    right: left + width,
    top: 0,
    bottom: 0,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('AudioPlayer', () => {
  // Exact name 'play' (not /play/i) so the query doesn't also match "replay".
  it('disables all controls when no src', () => {
    render(<AudioPlayer src={undefined} waveform={[0.5, 0.8]} durationSec={5} />);
    expect(screen.getByRole('button', { name: 'play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'replay' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /0\.75/ })).toBeDisabled();
    // The seek slider reports itself disabled when there's nothing to scrub.
    expect(screen.getByRole('slider', { name: /seek/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
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

  it('exposes the waveform as a seek slider with duration bounds', () => {
    render(<AudioPlayer src="blob:x" waveform={[0.5, 0.8]} durationSec={6} />);
    const slider = screen.getByRole('slider', { name: /seek/i });
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '6');
    expect(slider).toHaveAttribute('aria-valuenow', '0');
  });

  it('seeks to the clicked position on the waveform', () => {
    render(<AudioPlayer src="blob:x" waveform={[0.5, 0.8]} durationSec={10} />);
    const slider = screen.getByRole('slider', { name: /seek/i });
    stubWidth(slider, 0, 100);
    fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 });
    // 50% of a 10s clip → 5s.
    expect(slider).toHaveAttribute('aria-valuenow', '5');
  });

  it('scrubs while dragging across the waveform', () => {
    render(<AudioPlayer src="blob:x" waveform={[0.5, 0.8]} durationSec={10} />);
    const slider = screen.getByRole('slider', { name: /seek/i });
    stubWidth(slider, 0, 100);
    fireEvent.pointerDown(slider, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 80, pointerId: 1 });
    expect(slider).toHaveAttribute('aria-valuenow', '8');
    // A move after pointer-up should NOT keep scrubbing.
    fireEvent.pointerUp(slider, { clientX: 80, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 10, pointerId: 1 });
    expect(slider).toHaveAttribute('aria-valuenow', '8');
  });

  it('nudges with arrow keys and clamps at the ends', () => {
    render(<AudioPlayer src="blob:x" waveform={[0.5]} durationSec={10} />);
    const slider = screen.getByRole('slider', { name: /seek/i });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '1');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    // Clamp: can't go below 0.
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    // Home/End jump to the bounds.
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider).toHaveAttribute('aria-valuenow', '10');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');
  });

  it('ignores seek interactions when there is no src', () => {
    render(<AudioPlayer src={undefined} waveform={[0.5]} durationSec={10} />);
    const slider = screen.getByRole('slider', { name: /seek/i });
    stubWidth(slider, 0, 100);
    fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');
  });

  // Regression: the seek math used the durationSec PROP while timeupdate read the
  // real audio.duration. When they disagreed, the playhead jumped and arrow keys
  // were asymmetric. Both must now follow the loaded audio's true duration.
  it('adopts the real audio duration once metadata loads (prop is only an estimate)', () => {
    const durSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'duration', 'get')
      .mockReturnValue(20);
    try {
      const { container } = render(
        <AudioPlayer src="blob:x" waveform={[0.5, 0.8]} durationSec={6} />,
      );
      const audio = container.querySelector('audio')!;
      const slider = screen.getByRole('slider', { name: /seek/i });
      // Before metadata: falls back to the 6s estimate.
      expect(slider).toHaveAttribute('aria-valuemax', '6');
      fireEvent.loadedMetadata(audio);
      // After metadata: the bar reflects the real 20s clip.
      expect(slider).toHaveAttribute('aria-valuemax', '20');
      stubWidth(slider, 0, 100);
      fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 });
      // 50% of the REAL 20s clip → 10s (not 3s off the stale 6s estimate).
      expect(slider).toHaveAttribute('aria-valuenow', '10');
      // And the seek wrote that real time onto the element.
      expect(audio.currentTime).toBeCloseTo(10, 1);
    } finally {
      durSpy.mockRestore();
    }
  });

  it('renders a continuous progress track when waveform is empty', () => {
    render(<AudioPlayer src="blob:x" waveform={[]} durationSec={10} />);
    expect(screen.getByTestId('progress-track')).toBeInTheDocument();
    expect(screen.queryByTestId('progress-fill')).toBeInTheDocument();
    // Amplitude bars should not be rendered in the empty case.
  });

  it('still renders amplitude bars for a non-empty waveform', () => {
    render(<AudioPlayer src="blob:x" waveform={[0.2, 0.8, 0.5]} durationSec={10} />);
    expect(screen.queryByTestId('progress-track')).not.toBeInTheDocument();
  });
});

describe('AudioPlayer floating control', () => {
  function revealFloating() {
    const io = mockIntersectionObserverInstances[mockIntersectionObserverInstances.length - 1];
    act(() => {
      io.callback(
        [{ isIntersecting: false, boundingClientRect: { top: -200 } } as unknown as IntersectionObserverEntry],
        io as unknown as IntersectionObserver,
      );
    });
  }

  it('does not render the floating twin on desktop', () => {
    mockIsMobile = false;
    render(<AudioPlayer src="blob:x" waveform={[]} durationSec={47} floating />);
    expect(mockIntersectionObserverInstances).toHaveLength(0);
    expect(screen.queryByRole('group', { name: /audio controls/i })).not.toBeInTheDocument();
  });

  it('does not render the floating twin when floating is not set', () => {
    mockIsMobile = true;
    render(<AudioPlayer src="blob:x" waveform={[]} durationSec={47} />);
    expect(mockIntersectionObserverInstances).toHaveLength(0);
  });

  it('reveals the floating twin on mobile once scrolled past', () => {
    mockIsMobile = true;
    render(<AudioPlayer src="blob:x" waveform={[]} durationSec={47} floating />);
    expect(screen.queryByRole('group', { name: /audio controls/i })).not.toBeInTheDocument();
    revealFloating();
    expect(screen.getByRole('group', { name: /audio controls/i })).toBeInTheDocument();
  });

  it('floating +10 / -10 move the same shared progress and clamp', () => {
    mockIsMobile = true;
    render(<AudioPlayer src="blob:x" waveform={[]} durationSec={47} floating />);
    revealFloating();
    const group = screen.getByRole('group', { name: /audio controls/i });
    const slider = screen.getByRole('slider', { name: /seek/i });

    fireEvent.click(within(group).getByRole('button', { name: /forward 10 seconds/i }));
    expect(slider).toHaveAttribute('aria-valuenow', '10');

    fireEvent.click(within(group).getByRole('button', { name: /back 10 seconds/i }));
    expect(slider).toHaveAttribute('aria-valuenow', '0');

    // Clamp at the low end: another back-10 from zero stays at zero.
    fireEvent.click(within(group).getByRole('button', { name: /back 10 seconds/i }));
    expect(slider).toHaveAttribute('aria-valuenow', '0');
  });

  it('hides the floating twin when floatingSuppressed', () => {
    mockIsMobile = true;
    render(<AudioPlayer src="blob:x" waveform={[]} durationSec={47} floating floatingSuppressed />);
    revealFloating();
    expect(screen.queryByRole('group', { name: /audio controls/i })).not.toBeInTheDocument();
  });
});
