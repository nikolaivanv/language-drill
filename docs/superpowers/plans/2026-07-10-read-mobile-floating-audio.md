# Read Practice — floating mobile audio control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On mobile, once the inline Read-practice audio player scrolls out of view, pin a compact floating transport (seek −10s · play/pause · seek +10s) to the bottom-right so shadowing playback stays controllable while reading.

**Architecture:** `AudioPlayer` stays the sole owner of the `<audio>` element and its playback state. It gains a `seekBy` helper and, when `floating && isMobile && !disabled`, renders a new `FloatingAudioControl` from within its own render (so it closes over the same state/handlers). `FloatingAudioControl` portals to `document.body` (`position: fixed`), reveals via an `IntersectionObserver` on the inline player, and is suppressed while a bottom sheet is open. Props are threaded `annotated-view → audioRow → PassageAudio → AudioPlayer`.

**Tech Stack:** Next.js (App Router) + TypeScript, React, Tailwind (design tokens in `apps/web/app/globals.css`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-10-read-mobile-floating-audio-design.md`

## Global Constraints

- **All work happens in the worktree** `/.claude/worktrees/read-mobile-floating-audio/` on branch `feat/read-mobile-floating-audio`. Assert the branch (`git branch --show-current` = `feat/read-mobile-floating-audio`) before every commit, and use absolute paths rooted at the worktree — the main checkout silently flips to `main`.
- **Mobile breakpoint** is `useIsMobile()` from `apps/web/lib/responsive.ts` (≤760px). Never introduce a new breakpoint constant.
- **Design tokens only** (verified present in `globals.css`): `--shadow-3`, `--radius-pill` (→ `rounded-pill`), `--color-card` (→ `bg-card`), `--color-paper-2` (→ `bg-paper-2`), `--color-rule` (→ `border-rule`), `--color-ink` (→ `bg-ink`), `--color-paper` (→ `text-paper`), `--color-accent`. Use `style={{ boxShadow: 'var(--shadow-3)' }}` for the shadow (avoids depending on a `shadow-3` utility being registered).
- **Do not modify `AudioPlayer`'s existing inline behavior** (drag / keyboard / `liveDuration()` / slow / replay). Additions only. The drill/dictation caller must keep working unchanged (it never passes `floating`).
- **Fixed `MobileTabBar`** sits at `bottom-0 z-40 min-h-[64px] pb-[env(safe-area-inset-bottom)]`. The floating control must clear it: `bottom: calc(64px + env(safe-area-inset-bottom) + 16px)`, `z-40`.
- **Pre-push gate** (run from the worktree root before finishing): `pnpm lint`, `pnpm typecheck`, `pnpm test`. Zero failures.

---

## File Structure

- **Create** `apps/web/app/(dashboard)/drill/_components/floating-audio-control.tsx` — the `FloatingAudioControl` component: reveal (IntersectionObserver), scroll-room reservation, portal, and the pill UI. Co-located with `AudioPlayer` (its only consumer), consistent with `AudioPlayer` already living here despite being used by Read.
- **Create** `apps/web/app/(dashboard)/drill/_components/__tests__/floating-audio-control.test.tsx` — unit tests for the control in isolation.
- **Modify** `apps/web/app/(dashboard)/drill/_components/audio-player.tsx` — add `seekBy`, `floating`/`floatingSuppressed` props, `rootRef`, `useIsMobile()`, and render `FloatingAudioControl`.
- **Modify** `apps/web/app/(dashboard)/drill/_components/__tests__/audio-player.test.tsx` — floating-integration tests.
- **Modify** `apps/web/app/(dashboard)/read/_components/passage-audio.tsx` — accept and forward `floating`/`floatingSuppressed`.
- **Modify** `apps/web/app/(dashboard)/read/_components/passage-audio.test.tsx` — forwarding + gating tests.
- **Modify** `apps/web/app/(dashboard)/read/_components/annotated-view.tsx` — move `audioRow` below the `cardOpen` computation and pass `floating floatingSuppressed={cardOpen || bankSheetOpen}`.
- **Modify** `apps/web/app/(dashboard)/read/_components/__tests__/annotated-view.test.tsx` — prop-threading test via a `PassageAudio` spy mock.

---

## Task 1: `FloatingAudioControl` component (isolated)

**Files:**
- Create: `apps/web/app/(dashboard)/drill/_components/floating-audio-control.tsx`
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/floating-audio-control.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface FloatingAudioControlProps {
    anchorRef: React.RefObject<HTMLDivElement | null>;
    playing: boolean;
    progress: number;            // 0..1
    onToggle: () => void;
    onSeekBy: (deltaSec: number) => void;
    suppressed?: boolean;
  }
  export function FloatingAudioControl(props: FloatingAudioControlProps): React.ReactElement | null
  ```
- Consumes: the global `IntersectionObserver` mock + `mockIntersectionObserverInstances` registry from `apps/web/vitest.setup.ts`.

**Behavior notes:**
- Renders `null` until the observed anchor has scrolled up out of the viewport (`!entry.isIntersecting && entry.boundingClientRect.top < 0`), and also when `suppressed`.
- On mount reserves scroll room by setting `anchor.closest('main')`'s `paddingBottom`; restores on unmount.
- Portals the pill to `document.body`. The pill is `role="group" aria-label="audio controls"`; play/pause is `aria-label={playing ? 'pause' : 'play'}`; the seek buttons are `aria-label="back 10 seconds"` / `"forward 10 seconds"`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(dashboard)/drill/_components/__tests__/floating-audio-control.test.tsx`:

```tsx
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- floating-audio-control`
Expected: FAIL — cannot resolve `../floating-audio-control`.

- [ ] **Step 3: Write the component**

Create `apps/web/app/(dashboard)/drill/_components/floating-audio-control.tsx`:

```tsx
'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

export interface FloatingAudioControlProps {
  /** The inline player root; the control reveals once this scrolls out of view. */
  anchorRef: React.RefObject<HTMLDivElement | null>;
  playing: boolean;
  progress: number; // 0..1
  onToggle: () => void;
  onSeekBy: (deltaSec: number) => void;
  /** Hide while a bottom sheet covers the lower screen. */
  suppressed?: boolean;
}

// Progress ring geometry around the play/pause button.
const RING_R = 24;
const RING_C = 2 * Math.PI * RING_R;

export function FloatingAudioControl({
  anchorRef,
  playing,
  progress,
  onToggle,
  onSeekBy,
  suppressed = false,
}: FloatingAudioControlProps) {
  const [pastAnchor, setPastAnchor] = React.useState(false);

  // Reveal once the inline player has scrolled up out of the viewport, and
  // reserve scroll room so the passage's last content clears the pinned pill.
  React.useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const scroller = anchor.closest('main');
    const prevPad = scroller?.style.paddingBottom ?? '';
    if (scroller) {
      // Base tab-bar clearance (mirrors app-shell) + room for the pill.
      scroller.style.paddingBottom = 'calc(64px + env(safe-area-inset-bottom) + 114px)';
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        // Reveal only when the anchor has left the TOP of the viewport (scrolled
        // past), not when it sits below an as-yet-unscrolled fold.
        setPastAnchor(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 },
    );
    io.observe(anchor);

    return () => {
      io.disconnect();
      if (scroller) scroller.style.paddingBottom = prevPad;
    };
  }, [anchorRef]);

  if (suppressed || !pastAnchor || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="group"
      aria-label="audio controls"
      className="fixed right-[16px] z-40 flex items-center gap-[2px] rounded-pill border border-rule bg-card p-[5px]"
      style={{
        bottom: 'calc(64px + env(safe-area-inset-bottom) + 16px)',
        boxShadow: 'var(--shadow-3)',
      }}
    >
      <MiniSeekButton label="back 10 seconds" dir={-1} onClick={() => onSeekBy(-10)} />
      <button
        type="button"
        aria-label={playing ? 'pause' : 'play'}
        onClick={onToggle}
        className="relative h-[52px] w-[52px] flex-shrink-0 cursor-pointer border-none bg-transparent p-0"
      >
        <svg width="52" height="52" viewBox="0 0 52 52" className="absolute inset-0" aria-hidden>
          <circle cx="26" cy="26" r={RING_R} fill="none" stroke="var(--color-rule)" strokeWidth="3" />
          <circle
            cx="26"
            cy="26"
            r={RING_R}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - progress)}
            transform="rotate(-90 26 26)"
            style={{ transition: 'stroke-dashoffset .1s linear' }}
          />
        </svg>
        <span className="absolute left-1/2 top-1/2 flex h-[40px] w-[40px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-paper">
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </span>
      </button>
      <MiniSeekButton label="forward 10 seconds" dir={1} onClick={() => onSeekBy(10)} />
    </div>,
    document.body,
  );
}

function MiniSeekButton({
  label,
  dir,
  onClick,
}: {
  label: string;
  dir: -1 | 1;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-[44px] w-[44px] flex-shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-ink transition-colors hover:bg-paper-2"
    >
      <span className="relative inline-flex h-[26px] w-[26px] items-center justify-center">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {dir < 0 ? (
            <>
              <path d="M4 12a8 8 0 1 0 2.3-5.6" />
              <path d="M3.5 4v3.6h3.6" />
            </>
          ) : (
            <>
              <path d="M20 12a8 8 0 1 1-2.3-5.6" />
              <path d="M20.5 4v3.6h-3.6" />
            </>
          )}
        </svg>
        <span
          aria-hidden
          className="t-mono absolute left-1/2 top-[54%] -translate-x-1/2 -translate-y-1/2 text-[8px] font-semibold"
          style={{ letterSpacing: '-0.5px' }}
        >
          10
        </span>
      </span>
    </button>
  );
}

function PlayGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ marginLeft: 2 }}>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6.5" y="5.5" width="3.6" height="13" rx="1" />
      <rect x="13.9" y="5.5" width="3.6" height="13" rx="1" />
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- floating-audio-control`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/read-mobile-floating-audio
test "$(git branch --show-current)" = "feat/read-mobile-floating-audio" || exit 1
git add "apps/web/app/(dashboard)/drill/_components/floating-audio-control.tsx" \
        "apps/web/app/(dashboard)/drill/_components/__tests__/floating-audio-control.test.tsx"
git commit -m "feat(read): FloatingAudioControl — reveal-on-scroll mobile transport pill"
```

---

## Task 2: Wire `FloatingAudioControl` into `AudioPlayer`

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/audio-player.tsx`
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/audio-player.test.tsx`

**Interfaces:**
- Consumes: `FloatingAudioControl` from Task 1; `useIsMobile` from `apps/web/lib/responsive.ts`.
- Produces: extended `AudioPlayerProps`:
  ```ts
  export interface AudioPlayerProps {
    src: string | undefined;
    waveform: number[];
    durationSec: number;
    floating?: boolean;            // enable the mobile floating twin (default false)
    floatingSuppressed?: boolean;  // hide the twin (e.g. a bottom sheet is open)
  }
  ```
  Behavior: the twin renders only when `floating && isMobile && !disabled`; it shares the same `<audio>` state (`playing`, `progress`) and drives `togglePlay` / `seekBy`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/app/(dashboard)/drill/_components/__tests__/audio-player.test.tsx`. First, at the very top of the file (below the existing imports), add the responsive mock and IO registry import:

```tsx
import { mockIntersectionObserverInstances } from '../../../../../vitest.setup';

let mockIsMobile = false;
vi.mock('../../../../../lib/responsive', () => ({
  useIsMobile: () => mockIsMobile,
}));
```

Extend the existing `beforeEach` body (keep the existing `play`/`pause` spies) with:

```tsx
  mockIsMobile = false;
  mockIntersectionObserverInstances.length = 0;
```

Then add a new `describe` block at the end of the file:

```tsx
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
```

Add `act` and `within` to the existing top-of-file testing-library import:

```tsx
import { render, screen, fireEvent, act, within } from '@testing-library/react';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/web test -- audio-player`
Expected: FAIL — the new `floating` prop is unknown / no floating group renders.

- [ ] **Step 3: Implement the AudioPlayer changes**

In `apps/web/app/(dashboard)/drill/_components/audio-player.tsx`:

Add imports below the existing `import * as React from 'react';`:

```tsx
import { useIsMobile } from '../../../../lib/responsive';
import { FloatingAudioControl } from './floating-audio-control';
```

Extend the props interface:

```tsx
export interface AudioPlayerProps {
  src: string | undefined;
  waveform: number[];
  durationSec: number;
  /** Render a mobile-only floating transport once the inline player scrolls away. */
  floating?: boolean;
  /** Hide the floating transport (e.g. while a bottom sheet is open). */
  floatingSuppressed?: boolean;
}
```

Update the destructure and add the root ref + mobile flag. Replace:

```tsx
export function AudioPlayer({ src, waveform, durationSec }: AudioPlayerProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const waveRef = React.useRef<HTMLDivElement | null>(null);
```

with:

```tsx
export function AudioPlayer({
  src,
  waveform,
  durationSec,
  floating = false,
  floatingSuppressed = false,
}: AudioPlayerProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const waveRef = React.useRef<HTMLDivElement | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const isMobile = useIsMobile();
```

Add a `seekBy` helper next to the existing `seekToFraction` function (mirrors `onKeyDown`'s `const cur = progress * d`):

```tsx
  // Seek relative to the current position, used by the floating ±10 controls.
  function seekBy(deltaSec: number) {
    if (disabled) return;
    const d = liveDuration();
    const cur = progress * d;
    const next = Math.min(d, Math.max(0, cur + deltaSec));
    seekToFraction(d > 0 ? next / d : 0);
  }
```

Attach the root ref to the outer container. Change:

```tsx
    <div className="rounded-lg border border-rule bg-paper-2 p-s-4 sm:p-s-5">
```

to:

```tsx
    <div ref={rootRef} className="rounded-lg border border-rule bg-paper-2 p-s-4 sm:p-s-5">
```

Render the floating twin as the last child inside that root `<div>`, immediately before its closing `</div>` (the one that closes the outer container returned by the component):

```tsx
      {floating && isMobile && !disabled && (
        <FloatingAudioControl
          anchorRef={rootRef}
          playing={playing}
          progress={progress}
          onToggle={togglePlay}
          onSeekBy={seekBy}
          suppressed={floatingSuppressed}
        />
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/web test -- audio-player`
Expected: PASS — all existing AudioPlayer tests plus the 5 new floating tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/read-mobile-floating-audio
test "$(git branch --show-current)" = "feat/read-mobile-floating-audio" || exit 1
git add "apps/web/app/(dashboard)/drill/_components/audio-player.tsx" \
        "apps/web/app/(dashboard)/drill/_components/__tests__/audio-player.test.tsx"
git commit -m "feat(read): AudioPlayer renders the floating twin (mobile) + seekBy"
```

---

## Task 3: Forward `floating` / `floatingSuppressed` through `PassageAudio`

**Files:**
- Modify: `apps/web/app/(dashboard)/read/_components/passage-audio.tsx`
- Test: `apps/web/app/(dashboard)/read/_components/passage-audio.test.tsx`

**Interfaces:**
- Produces: `PassageAudio` accepts optional `floating?: boolean` and `floatingSuppressed?: boolean` and forwards both to `<AudioPlayer>`. Existing Listen → preparing → player gating is unchanged.

- [ ] **Step 1: Write the failing test**

Add the responsive + IO mocks at the top of `apps/web/app/(dashboard)/read/_components/passage-audio.test.tsx` (below the existing imports):

```tsx
import { act, within } from '@testing-library/react';
import { mockIntersectionObserverInstances } from '../../../../vitest.setup';

let mockIsMobile = false;
vi.mock('../../../../lib/responsive', () => ({
  useIsMobile: () => mockIsMobile,
}));

beforeEach(() => {
  mockIsMobile = false;
  mockIntersectionObserverInstances.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
```

Add `beforeEach` to the top-of-file vitest import:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
```

Update `renderWith` to forward optional props:

```tsx
function renderWith(
  fetchFn: unknown,
  props?: { floating?: boolean; floatingSuppressed?: boolean },
) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PassageAudio entryId="e1" fetchFn={fetchFn as never} {...props} />
    </QueryClientProvider>,
  );
}
```

Add a new test at the end of the `describe`:

```tsx
  it('forwards floating to the mobile audio player once ready', async () => {
    mockIsMobile = true;
    const fetchFn = vi.fn(async () => ({
      json: async () => ({ audioUrl: 'https://signed/x.mp3', durationSec: 12, reason: 'ok' }),
    }));
    renderWith(fetchFn, { floating: true });
    await userEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'play' })).toBeInTheDocument());

    const io = mockIntersectionObserverInstances[mockIntersectionObserverInstances.length - 1];
    act(() => {
      io.callback(
        [{ isIntersecting: false, boundingClientRect: { top: -200 } } as unknown as IntersectionObserverEntry],
        io as unknown as IntersectionObserver,
      );
    });
    expect(screen.getByRole('group', { name: /audio controls/i })).toBeInTheDocument();
  });

  it('suppresses the floating control when floatingSuppressed is set', async () => {
    mockIsMobile = true;
    const fetchFn = vi.fn(async () => ({
      json: async () => ({ audioUrl: 'https://signed/x.mp3', durationSec: 12, reason: 'ok' }),
    }));
    renderWith(fetchFn, { floating: true, floatingSuppressed: true });
    await userEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'play' })).toBeInTheDocument());

    const io = mockIntersectionObserverInstances[mockIntersectionObserverInstances.length - 1];
    act(() => {
      io.callback(
        [{ isIntersecting: false, boundingClientRect: { top: -200 } } as unknown as IntersectionObserverEntry],
        io as unknown as IntersectionObserver,
      );
    });
    expect(screen.queryByRole('group', { name: /audio controls/i })).not.toBeInTheDocument();
  });
```

> Note: `within` is imported for parity with the other test files; it is not required by these two assertions. If lint flags it as unused, drop it from the import.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- passage-audio`
Expected: FAIL — `floating` isn't forwarded, so no `audio controls` group appears.

- [ ] **Step 3: Implement the forwarding**

In `apps/web/app/(dashboard)/read/_components/passage-audio.tsx`, change the component signature:

```tsx
export function PassageAudio({
  entryId,
  fetchFn,
}: {
  entryId: string;
  fetchFn: AuthenticatedFetch;
}) {
```

to:

```tsx
export function PassageAudio({
  entryId,
  fetchFn,
  floating = false,
  floatingSuppressed = false,
}: {
  entryId: string;
  fetchFn: AuthenticatedFetch;
  floating?: boolean;
  floatingSuppressed?: boolean;
}) {
```

Change the final render (the `<AudioPlayer .../>` line) from:

```tsx
  return <AudioPlayer src={data.audioUrl} waveform={[]} durationSec={data.durationSec} />;
```

to:

```tsx
  return (
    <AudioPlayer
      src={data.audioUrl}
      waveform={[]}
      durationSec={data.durationSec}
      floating={floating}
      floatingSuppressed={floatingSuppressed}
    />
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- passage-audio`
Expected: PASS — existing tests plus the 2 new ones.

- [ ] **Step 5: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/read-mobile-floating-audio
test "$(git branch --show-current)" = "feat/read-mobile-floating-audio" || exit 1
git add "apps/web/app/(dashboard)/read/_components/passage-audio.tsx" \
        "apps/web/app/(dashboard)/read/_components/passage-audio.test.tsx"
git commit -m "feat(read): PassageAudio forwards floating props to AudioPlayer"
```

---

## Task 4: Enable floating + suppression from `annotated-view`

**Files:**
- Modify: `apps/web/app/(dashboard)/read/_components/annotated-view.tsx`
- Test: `apps/web/app/(dashboard)/read/_components/__tests__/annotated-view.test.tsx`

**Interfaces:**
- Consumes: `PassageAudio` `floating` / `floatingSuppressed` props (Task 3).
- Produces: the shared `audioRow` passes `floating` and `floatingSuppressed={cardOpen || bankSheetOpen}`. `audioRow` must be defined **after** `cardOpen` is computed (currently `audioRow` is at line ~264, `bankSheetOpen` at ~276, `cardOpen` at ~346).

- [ ] **Step 1: Write the failing test**

At the top of `apps/web/app/(dashboard)/read/_components/__tests__/annotated-view.test.tsx`, add a `PassageAudio` spy mock that records the props it receives. Place this `vi.mock` alongside the file's existing `vi.mock` calls (near the `lib/responsive` mock at line ~11):

```tsx
const passageAudioProps: Array<{ floating?: boolean; floatingSuppressed?: boolean }> = [];
vi.mock('../passage-audio', () => ({
  PassageAudio: (props: { floating?: boolean; floatingSuppressed?: boolean }) => {
    passageAudioProps.push({ floating: props.floating, floatingSuppressed: props.floatingSuppressed });
    return null;
  },
}));
```

Add a focused test (adapt the render helper to whatever the file already uses to mount `AnnotatedView` with `entryId` + `fetchFn`; `AnnotatedView` only renders `audioRow` when both are present). Clear the recorder in the test:

```tsx
it('passes floating to PassageAudio with suppression tied to open sheets', () => {
  passageAudioProps.length = 0;
  // Render AnnotatedView with an entryId + fetchFn so audioRow mounts.
  // (Use the file's existing render helper / default props; add entryId="e1"
  //  and a fetchFn if the helper doesn't already supply them.)
  renderAnnotatedView({ entryId: 'e1' });
  const last = passageAudioProps[passageAudioProps.length - 1];
  expect(last.floating).toBe(true);
  // No sheet open initially → not suppressed.
  expect(last.floatingSuppressed).toBe(false);
});
```

> Implementer note: match the existing test's render helper name/signature (it may be `renderView`, `setup`, or an inline `render(<AnnotatedView .../>)`). If the helper hard-codes props, extend it to accept `entryId`/`fetchFn` overrides. `fetchFn` can be `vi.fn()` — `audioRow` only checks truthiness of `entryId && fetchFn`; the mocked `PassageAudio` never calls it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- annotated-view`
Expected: FAIL — `last.floating` is `undefined` (audioRow doesn't pass `floating` yet).

- [ ] **Step 3: Implement the annotated-view changes**

In `apps/web/app/(dashboard)/read/_components/annotated-view.tsx`:

1. **Delete** the current `audioRow` definition at its early position (the block starting `// Listen / audio — own full-width row…` through the `const audioRow = … ) : null;`).

2. **Re-add** it immediately after the `cardOpen` computation (`const cardOpen = deepActive || (activeFlag !== null && activeWord !== null);`), now wiring the two new props:

```tsx
  // Listen / audio — own full-width row so the expanded player never overlaps
  // the header (shared verbatim between the mobile and desktop branches below).
  // On mobile a floating transport appears once this row scrolls out of view;
  // it is suppressed whenever a bottom sheet (word card / bank) covers the
  // lower screen. Defined after `cardOpen` so `floatingSuppressed` can read it.
  const audioRow =
    entryId && fetchFn ? (
      <div className="mb-[18px]">
        <PassageAudio
          entryId={entryId}
          fetchFn={fetchFn}
          floating
          floatingSuppressed={cardOpen || bankSheetOpen}
        />
      </div>
    ) : null;
```

Both branches (mobile at line ~408, desktop at line ~510) already reference `{audioRow}`; leave those usages unchanged. Since `cardOpen` (~346) and `bankSheetOpen` (~276) precede the new position, and the branches (~385, ~473) follow it, ordering is valid.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/web test -- annotated-view`
Expected: PASS.

Also run the read page test (unaffected desktop path, but it renders the reader):

Run: `pnpm --filter @language-drill/web test -- "read/page"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/read-mobile-floating-audio
test "$(git branch --show-current)" = "feat/read-mobile-floating-audio" || exit 1
git add "apps/web/app/(dashboard)/read/_components/annotated-view.tsx" \
        "apps/web/app/(dashboard)/read/_components/__tests__/annotated-view.test.tsx"
git commit -m "feat(read): enable mobile floating audio control from annotated-view"
```

---

## Task 5: Full gate + browser verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full pre-push gate from the worktree root**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/read-mobile-floating-audio
pnpm lint && pnpm typecheck && pnpm test
```
Expected: zero failures across all three. Fix any issue locally before proceeding.

- [ ] **Step 2: Browser-verify the floating control (mobile width)**

Per the "verify drill components via esbuild harness" memory (see `docs/testing.md` and the spec's Verification section), bundle `AudioPlayer` with `floating` against the Next-built CSS chunk, drive it at ≤760px width with Playwright, using a silent-WAV blob for `src`. Confirm:
1. Inline player visible at top; after scrolling the anchor out of view, the pill appears bottom-right, clear of where the tab bar sits.
2. Tap play / −10 / +10 → progress ring + inline slider `aria-valuenow` update together.
3. Toggling `floatingSuppressed` (simulating an open word sheet) hides the pill; clearing it restores.
4. Both light and dark themes render correctly (card bg, accent ring, ink play button, `shadow-3`).

Capture a screenshot (or short frame sequence) to `apps/web/e2e/.shots/` as evidence.

- [ ] **Step 3: Push and open the PR**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/read-mobile-floating-audio
test "$(git branch --show-current)" = "feat/read-mobile-floating-audio" || exit 1
git push -u origin feat/read-mobile-floating-audio
ghp pr create --title "feat(read): floating mobile audio control for shadowing" --body "<summary>"
```
(Squash-merge per project convention.)

---

## Self-Review (completed during planning)

- **Spec coverage:** single-owner twin (Task 2) · FloatingAudioControl look + reveal + suppress + scroll-room (Task 1) · seekBy ±10 (Task 2) · mobile-only gating (Task 2) · position above tab bar (Task 1) · prop threading annotated-view→PassageAudio→AudioPlayer (Tasks 3–4) · tests in existing files (Tasks 1–4) · browser verify (Task 5). All spec sections map to a task.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code. The only prose-guided step is Task 4 Step 1's render-helper adaptation, which is unavoidable (the existing helper's shape must be matched) and is bounded with an explicit implementer note.
- **Type consistency:** `FloatingAudioControlProps` (Task 1) is consumed verbatim in Task 2 (`anchorRef`, `playing`, `progress`, `onToggle`, `onSeekBy`, `suppressed`). `AudioPlayerProps.floating`/`floatingSuppressed` (Task 2) match `PassageAudio`'s forwarded props (Task 3) and `annotated-view`'s call site (Task 4). `seekBy(deltaSec: number)` signature matches `onSeekBy`.
