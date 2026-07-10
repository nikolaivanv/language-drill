import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import * as React from 'react';
import { FloatingAudioControl } from '../floating-audio-control';
import { mockIntersectionObserverInstances } from '../../../../../vitest.setup';

beforeEach(() => {
  mockIntersectionObserverInstances.length = 0;
});

/** Drive the captured IntersectionObserver so the control reveals. */
function scrollPastAnchor() {
  const io = mockIntersectionObserverInstances[mockIntersectionObserverInstances.length - 1];
  act(() => {
    io.callback(
      [{ isIntersecting: false, boundingClientRect: { top: -200 } } as unknown as IntersectionObserverEntry],
      io as unknown as IntersectionObserver,
    );
  });
}

function Harness(props: Partial<React.ComponentProps<typeof FloatingAudioControl>>) {
  const anchorRef = React.useRef<HTMLDivElement | null>(null);
  return (
    <div>
      <div ref={anchorRef} data-testid="anchor" />
      <FloatingAudioControl
        anchorRef={anchorRef}
        playing={false}
        progress={0}
        onToggle={() => {}}
        onSeekBy={() => {}}
        {...props}
      />
    </div>
  );
}

describe('FloatingAudioControl', () => {
  it('is hidden until the anchor scrolls out of view', () => {
    render(<Harness />);
    expect(screen.queryByRole('group', { name: /audio controls/i })).not.toBeInTheDocument();
    scrollPastAnchor();
    expect(screen.getByRole('group', { name: /audio controls/i })).toBeInTheDocument();
  });

  it('renders play, back-10 and forward-10 controls', () => {
    render(<Harness playing={false} />);
    scrollPastAnchor();
    const group = screen.getByRole('group', { name: /audio controls/i });
    expect(within(group).getByRole('button', { name: 'play' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /back 10 seconds/i })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /forward 10 seconds/i })).toBeInTheDocument();
  });

  it('wires toggle and ±10 seek to the callbacks', () => {
    const onToggle = vi.fn();
    const onSeekBy = vi.fn();
    render(<Harness onToggle={onToggle} onSeekBy={onSeekBy} />);
    scrollPastAnchor();
    const group = screen.getByRole('group', { name: /audio controls/i });
    within(group).getByRole('button', { name: 'play' }).click();
    within(group).getByRole('button', { name: /back 10 seconds/i }).click();
    within(group).getByRole('button', { name: /forward 10 seconds/i }).click();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onSeekBy).toHaveBeenNthCalledWith(1, -10);
    expect(onSeekBy).toHaveBeenNthCalledWith(2, 10);
  });

  it('shows pause when playing', () => {
    render(<Harness playing />);
    scrollPastAnchor();
    const group = screen.getByRole('group', { name: /audio controls/i });
    expect(within(group).getByRole('button', { name: 'pause' })).toBeInTheDocument();
  });

  it('stays hidden when suppressed even after scrolling past', () => {
    render(<Harness suppressed />);
    scrollPastAnchor();
    expect(screen.queryByRole('group', { name: /audio controls/i })).not.toBeInTheDocument();
  });

  it('reserves <main> bottom padding only once the pill is shown', () => {
    function MainHarness() {
      const anchorRef = React.useRef<HTMLDivElement | null>(null);
      return (
        <main data-testid="scroller">
          <div ref={anchorRef} data-testid="anchor" />
          <FloatingAudioControl
            anchorRef={anchorRef}
            playing={false}
            progress={0}
            onToggle={() => {}}
            onSeekBy={() => {}}
          />
        </main>
      );
    }
    render(<MainHarness />);
    const main = screen.getByTestId('scroller');
    expect(main.style.paddingBottom).toBe(''); // not reserved before reveal
    scrollPastAnchor(); // reuse the existing helper
    // jsdom's CSSOM folds the two literal px terms in the calc() expression
    // (64 + 114 = 178) rather than preserving the source string verbatim, so
    // assert on the safe-area-aware calc it actually produces.
    expect(main.style.paddingBottom).toBe('calc(178px + env(safe-area-inset-bottom))');
  });
});
