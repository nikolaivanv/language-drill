# Read Audio Player Layout + Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the read-practice "Listen" audio control out of the passage header into its own full-width row (desktop), add the same control to mobile (currently desktop-only), and align the `PassageAudio` control to the design system (`<Button>`, speaker icon, loading spinner).

**Architecture:** UI-only change to two components in `apps/web`. `PassageAudio` gains design-system styling; `AnnotatedView` moves the audio mount point on desktop and adds it on mobile. No backend/API/schema/`<AudioPlayer>` changes.

**Tech Stack:** Next.js/React + TypeScript, Tailwind (design tokens), Vitest + Testing Library.

## Global Constraints

- Design source: Claude Design prototypes `read-proto/Reading Mode Desktop.html` (`read-desktop-app.jsx`) and `read-proto/Reading Mode.html` (`read-app.jsx`), shared `read-ui.jsx`. Prototype tokens == app `globals.css` tokens, so this is restructuring, not re-skinning.
- The prototype is a **simplified mock**. Preserve everything it omits: the `error`/`too_long`/null-`audioUrl` states, the `entryId && fetchFn` gate (Listen only for a persisted entry), `reset`-on-`entryId`-change, and `<AudioPlayer>` a11y (role=slider, keyboard) + empty-waveform fallback.
- `<AudioPlayer>` (`apps/web/app/(dashboard)/drill/_components/audio-player.tsx`) is **unchanged** — the prototype's player is a faithful copy of it.
- Use design-system components per theme (dark/light) via tokens — no bespoke colors. `<Button>` import path from a read `_component`: `../../../../components/ui/button`.
- Listen/retry controls keep the **pill** radius (`rounded-pill`) — the prototype and the current control are pills, not the chip variant's default `rounded-sm`.
- Audio row position on BOTH breakpoints: directly **after the passage header** and **before the calibration strip**, full width, `mb-[18px]`, gated `entryId && fetchFn`.
- All paths relative to worktree root `/Users/seal/dev/language-drill/.claude/worktrees/feat+read-audio-player-layout`. Run all commands from there.
- Pre-push gate must be clean: `pnpm lint && pnpm typecheck && pnpm test`; plus `pnpm --filter @language-drill/web build` (read page is touched).

---

### Task 1: `PassageAudio` — design-system Button + speaker icon + loading spinner

**Files:**
- Modify: `apps/web/app/(dashboard)/read/_components/passage-audio.tsx`
- Modify: `apps/web/app/(dashboard)/read/_components/passage-audio.test.tsx`

**Interfaces:**
- Consumes: `Button` from `../../../../components/ui/button`; `useReadAudio`, `AuthenticatedFetch` from `@language-drill/api-client`; `AudioPlayer` from `../../drill/_components/audio-player`.
- Produces: `PassageAudio({ entryId, fetchFn })` — unchanged props/behavior; only the idle/loading/error markup changes. Idle renders a `<button>` (accessible name "Listen") containing an `aria-hidden` speaker `<svg>`; loading renders an `aria-hidden` spinner + "preparing audio…".

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/app/(dashboard)/read/_components/passage-audio.test.tsx` (keep all existing cases; this file already has the QueryClientProvider harness):

```tsx
it('renders a speaker icon in the idle Listen button', () => {
  const fetchFn = vi.fn();
  renderWith(fetchFn); // existing helper that mounts <PassageAudio entryId="e1" fetchFn={fetchFn} />
  const listen = screen.getByRole('button', { name: /listen/i });
  expect(listen.querySelector('svg')).toBeInTheDocument();
});

it('shows a spinner while preparing audio', async () => {
  // fetchFn that never resolves so the mutation stays pending
  const fetchFn = vi.fn(() => new Promise(() => {})) as unknown as Parameters<typeof renderWith>[0];
  const { container } = renderWith(fetchFn);
  await userEvent.click(screen.getByRole('button', { name: /listen/i }));
  expect(await screen.findByText(/preparing audio/i)).toBeInTheDocument();
  expect(container.querySelector('.animate-spin')).toBeInTheDocument();
});
```

> Match the file's existing harness: if it doesn't already expose a `renderWith(fetchFn)` helper, mirror whatever mount pattern the existing tests use (QueryClientProvider wrapper + `<PassageAudio entryId="e1" fetchFn={fetchFn} />`) and adapt these two tests to it. Import `userEvent` the same way the existing tests do.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/read/_components/passage-audio.test.tsx"`
Expected: FAIL — no `svg` in the Listen button / no `.animate-spin` in the loading state.

- [ ] **Step 3: Rewrite the component**

Replace the entire body of `apps/web/app/(dashboard)/read/_components/passage-audio.tsx` with:

```tsx
'use client';

import * as React from 'react';
import { useReadAudio, type AuthenticatedFetch } from '@language-drill/api-client';
import { Button } from '../../../../components/ui/button';
import { AudioPlayer } from '../../drill/_components/audio-player';

// Speaker + sound-wave glyph (from the read-proto Listen control).
function SpeakerIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

export function PassageAudio({
  entryId,
  fetchFn,
}: {
  entryId: string;
  fetchFn: AuthenticatedFetch;
}) {
  const { mutate, data, isPending, isError, reset } = useReadAudio({ fetchFn });
  const [opened, setOpened] = React.useState(false);

  // Reset when switching passages.
  React.useEffect(() => {
    setOpened(false);
    reset();
  }, [entryId, reset]);

  // Design-system chip button, kept as a pill for the Listen affordance.
  const controlClass = 'rounded-pill min-h-[44px]';

  if (!opened) {
    return (
      <Button
        variant="chip"
        size="sm"
        className={controlClass}
        onClick={() => {
          setOpened(true);
          mutate({ entryId });
        }}
      >
        <SpeakerIcon />
        Listen
      </Button>
    );
  }

  if (isPending) {
    return (
      <span className="t-small inline-flex min-h-[44px] items-center gap-[8px] text-ink-mute">
        <span
          aria-hidden="true"
          className="inline-block h-[12px] w-[12px] animate-spin rounded-full border border-rule border-t-accent"
        />
        preparing audio…
      </span>
    );
  }

  if (isError) {
    return (
      <Button variant="chip" size="sm" className={controlClass} onClick={() => mutate({ entryId })}>
        retry audio
      </Button>
    );
  }

  if (data?.reason === 'too_long') {
    return (
      <span className="t-small inline-flex min-h-[44px] items-center gap-[6px] text-ink-mute">
        audio unavailable — passage too long to narrate
      </span>
    );
  }

  if (!data?.audioUrl) {
    return (
      <span className="t-small inline-flex min-h-[44px] items-center gap-[6px] text-ink-mute">
        audio unavailable — try again later
      </span>
    );
  }

  return <AudioPlayer src={data.audioUrl} waveform={[]} durationSec={data.durationSec} />;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/read/_components/passage-audio.test.tsx"`
Expected: PASS (new + existing cases — Listen click mounts player, too_long, unavailable).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/read/_components/passage-audio.tsx" "apps/web/app/(dashboard)/read/_components/passage-audio.test.tsx"
git commit -m "feat(read): PassageAudio uses design-system Button + speaker icon + spinner"
```

---

### Task 2: `AnnotatedView` — desktop relayout + mobile audio row

**Files:**
- Modify: `apps/web/app/(dashboard)/read/_components/annotated-view.tsx`
- Modify: `apps/web/app/(dashboard)/read/_components/__tests__/annotated-view.test.tsx`

**Interfaces:**
- Consumes: `PassageAudio` (already imported at `annotated-view.tsx:34`); props `entryId?: string | null`, `fetchFn?: AuthenticatedFetch` (already declared).
- Produces: the audio control renders in a full-width row after the header / before calibration on BOTH the mobile and desktop branches, gated by `entryId && fetchFn`.

The current desktop header cluster (≈ lines 491-495) is:

```tsx
          <div className="flex items-center gap-[8px]">
            {entryId && fetchFn ? <PassageAudio entryId={entryId} fetchFn={fetchFn} /> : null}
            <span className="t-micro text-ink-mute">highlight</span>
            <IntensityToggle value={intensity} onChange={onIntensityChange} />
          </div>
```

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `apps/web/app/(dashboard)/read/_components/__tests__/annotated-view.test.tsx`. Mock `PassageAudio` to a marker so the audio hook/QueryClient isn't needed, and drive both breakpoints via the file's existing `mockIsMobile` control:

```tsx
// At top of file, alongside the other vi.mock calls:
vi.mock('../passage-audio', () => ({
  PassageAudio: () => <div data-testid="passage-audio" />,
}));

describe('AnnotatedView — Listen audio control placement', () => {
  const audioProps = { ...baseProps, entryId: 'entry-1', fetchFn: (() => {}) as never };

  it('renders the audio control (desktop) before the calibration strip, not in the header cluster', () => {
    mockIsMobile.mockReturnValue(false);
    render(<AnnotatedView {...audioProps} />);
    const audio = screen.getByTestId('passage-audio');
    const intensity = screen.getByRole('radiogroup'); // IntensityToggle lives in the header cluster
    // Audio precedes the calibration eyebrow, and is a sibling row (not inside the intensity/header cluster).
    expect(audio).toBeInTheDocument();
    expect(intensity.contains(audio)).toBe(false);
  });

  it('renders the audio control on mobile', () => {
    mockIsMobile.mockReturnValue(true);
    render(<AnnotatedView {...audioProps} />);
    expect(screen.getByTestId('passage-audio')).toBeInTheDocument();
  });

  it('hides the audio control when there is no persisted entry', () => {
    mockIsMobile.mockReturnValue(false);
    render(<AnnotatedView {...baseProps} />); // baseProps has no entryId/fetchFn
    expect(screen.queryByTestId('passage-audio')).not.toBeInTheDocument();
  });
});
```

> `mockIsMobile` is the existing mock backing `useIsMobile` (see the top of the file). If it's a plain function rather than a `vi.fn()`, adapt (e.g. set a module-level `let mobile = false` the mock reads, toggled per test) — match the file's established pattern. `baseProps` already omits `entryId`/`fetchFn`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/read/_components/__tests__/annotated-view.test.tsx"`
Expected: FAIL — mobile test finds no `passage-audio` (mobile branch renders none today); desktop test may find it but inside the header cluster.

- [ ] **Step 3: Desktop — remove audio from the header cluster**

In the desktop header cluster (the `<div className="flex items-center gap-[8px]">` at ≈ line 491), remove the `PassageAudio` line so it becomes:

```tsx
          <div className="flex items-center gap-[8px]">
            <span className="t-micro text-ink-mute">highlight</span>
            <IntensityToggle value={intensity} onChange={onIntensityChange} />
          </div>
```

- [ ] **Step 4: Desktop — add the full-width audio row**

Immediately AFTER the desktop header block (the `<div className="flex items-start justify-between gap-[16px] mb-[12px]">…</div>` that closes just before `{/* Calibration */}`) and BEFORE the `{/* Calibration */}` block, add:

```tsx
        {/* Listen / audio — own full-width row so the expanded player never overlaps the header */}
        {entryId && fetchFn ? (
          <div className="mb-[18px]">
            <PassageAudio entryId={entryId} fetchFn={fetchFn} />
          </div>
        ) : null}
```

- [ ] **Step 5: Mobile — add the same full-width audio row**

In the `if (isMobile)` branch, immediately AFTER the mobile header block (the `<div className="mb-[12px] flex items-start justify-between gap-[16px]">…</div>` containing the title + "word bank · N" chip, closing just before `{/* Calibration */}`) and BEFORE the mobile `{/* Calibration */}` block, add the identical row:

```tsx
        {/* Listen / audio — own full-width row */}
        {entryId && fetchFn ? (
          <div className="mb-[18px]">
            <PassageAudio entryId={entryId} fetchFn={fetchFn} />
          </div>
        ) : null}
```

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/read/_components/__tests__/annotated-view.test.tsx"`
Expected: PASS (new placement tests + all existing AnnotatedView tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/app/(dashboard)/read/_components/annotated-view.tsx" "apps/web/app/(dashboard)/read/_components/__tests__/annotated-view.test.tsx"
git commit -m "feat(read): move Listen audio to its own row (desktop) + add to mobile"
```

---

### Task 3: Verify — read suite, full gate, web build, visual check

**Files:** none (verification only; may touch the two files above if a regression surfaces).

- [ ] **Step 1: Run the full read suite (catches page.test.tsx / sibling regressions)**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/read"`
Expected: PASS. `page.test.tsx` already stubs `useReadAudio`; moving the control within `AnnotatedView` should not disturb it. If a read page test asserted the old header structure, update it to match the new row placement (grep the read dir for header/audio assertions).

- [ ] **Step 2: Web build (Next prerender — read page is touched)**

Run: `pnpm --filter @language-drill/web build`
Expected: PASS (no prerender/Suspense errors).

- [ ] **Step 3: Full pre-push gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures.

- [ ] **Step 4: Visual check (best-effort — layout confirmation)**

Render the authenticated read screen and screenshot it to confirm the Listen control sits in its own row below the header (not in the header cluster), in both themes if feasible:

Run: `pnpm --filter @language-drill/web shoot --route /read`
Expected: a screenshot under `apps/web/e2e/.shots/`. Inspect it: the "Listen" pill should appear on its own line beneath the title/highlight header. If the seeded read screen has no persisted entry (so no Listen control shows), note that the control is gated to persisted entries and rely on the unit tests for placement — do not block on the screenshot. (This is a fresh worktree; `.env` files were copied for `shoot` to authenticate.)

- [ ] **Step 5: Commit (only if Step 1/3 required a test fix)**

```bash
git add -A
git commit -m "test(read): update read-page assertions for relocated audio control"
```

(If no fixes were needed, skip this commit.)

---

## Self-Review

**Spec coverage:**
- Desktop relayout (header → own row) → Task 2 Steps 3-4. ✔
- Mobile audio row (new) → Task 2 Step 5. ✔
- `PassageAudio` design-system Button + speaker icon + spinner → Task 1. ✔
- Preserve all states / gate / reset / `<AudioPlayer>` unchanged → Task 1 (states kept verbatim; AudioPlayer import untouched). ✔
- Theme via tokens/`<Button>` → Task 1 (chip variant + tokens). ✔
- Tests (component + placement + build) → Tasks 1-3. ✔

**Placeholder scan:** No TBD/TODO. The two "match the file's existing harness" notes (Task 1 Step 1, Task 2 Step 1) point at concrete existing patterns the implementer reads in-file, with full test bodies provided.

**Type consistency:** `PassageAudio` props (`entryId: string`, `fetchFn: AuthenticatedFetch`) are unchanged and match `AnnotatedView`'s `entryId?: string | null` + `fetchFn?: AuthenticatedFetch` gate (`entryId && fetchFn` narrows to the required non-null types). `<Button variant="chip" size="sm">` matches the real `ButtonVariant`/`ButtonSize` unions. `controlClass` is applied via `<Button className>` (merged last through `cn`).
