# Conjugation Drill UI/UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the conjugation drill for mobile web — compact chips, no mobile accent keyboard, a flag button, a theory link, and a rearranged header with a working level selector.

**Architecture:** Three independent edits. (1) Hide the shared `AccentPicker` on mobile at the component level so every surface inherits it. (2) Tighten the conjugation feature-bundle chip styles. (3) Rework `drill/conjugation/page.tsx` to reuse the existing `DrillMeta`, `TheoryTrigger`/`TheoryPanel`, and `FlagExerciseControl` building blocks already proven on the generic drill page.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind v4 (custom `mobile:` variant + `t-*`/`s-*` design tokens), Vitest + Testing Library, TanStack Query.

## Global Constraints

- Do **not** modify shared base components (Button, Input, Textarea, Chip) — only their composition. (Spec: "don't change basic existing UI components".)
- Do **not** prefix any `--radius-*` token with a direction letter; keep `rounded-lg` on chips as-is (memory: radius-token directional collision).
- Mobile breakpoint is the single source of truth in `apps/web/lib/responsive.ts` (`useIsMobile()`, 760px). Use it; never hand-roll a media query in TS.
- No backend/API changes — flag (`useFlagExercise`) and theory (`/theory/:lang/:topicId`) endpoints already exist.
- Pre-push gate (run from repo root, must be clean): `pnpm lint && pnpm typecheck && pnpm test`. Web-only fast loop: `pnpm --filter @language-drill/web test`.

---

### Task 1: Hide the accent keyboard on mobile (app-wide)

**Files:**
- Modify: `apps/web/components/ui/accent-picker.tsx`
- Test: `apps/web/components/ui/__tests__/accent-picker.test.tsx`

**Interfaces:**
- Consumes: `useIsMobile(): boolean` from `apps/web/lib/responsive.ts`.
- Produces: `AccentPicker` renders `null` on mobile (≤760px); unchanged on desktop. No prop/signature change — every existing call site (conjugation, cloze, vocab, translation, dictation, sentence-construction, free-writing, fluency, review) inherits the behavior.

- [ ] **Step 1: Write the failing test**

Add this test inside the top-level `describe('AccentPicker', …)` block in `accent-picker.test.tsx` (after the `'returns null for unsupported language'` test). It stubs `matchMedia` to report mobile, then restores it so sibling tests keep their desktop default:

```tsx
it('renders nothing on mobile viewports', () => {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  try {
    const { container } = render(<ControlledHarness language="ES" />);
    // The harness still renders its own <input>, but no AccentPicker buttons.
    expect(container.querySelectorAll('button').length).toBe(0);
  } finally {
    window.matchMedia = original;
  }
});
```

Also add `vi` to the existing import: change `import { describe, it, expect } from 'vitest';` to `import { describe, it, expect, vi } from 'vitest';`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- accent-picker`
Expected: FAIL — the new test finds 8 buttons (picker still renders) instead of 0.

- [ ] **Step 3: Implement the mobile guard**

In `accent-picker.tsx`, add the import near the top (the file is at `components/ui/`, so `lib` is two levels up):

```tsx
import { useIsMobile } from '../../lib/responsive';
```

Inside the `AccentPicker` component, add the hook alongside the other hooks — place it immediately after the `shiftHeld` effect's closing `}, []);` and **before** the `if (!chars) return null;` line (all hooks must run before any early return):

```tsx
  const isMobile = useIsMobile();
```

Then widen the existing early return:

```tsx
  // Hide on mobile: the device keyboard already provides accented characters
  // (long-press), so the on-screen row is redundant and steals vertical space.
  if (!chars || isMobile) return null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/web test -- accent-picker`
Expected: PASS — all existing desktop tests stay green (jsdom has no `matchMedia` → `useIsMobile()` is `false`), and the new mobile test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ui/accent-picker.tsx apps/web/components/ui/__tests__/accent-picker.test.tsx
git commit -m "feat(accent-picker): hide accent keyboard on mobile (device keyboard suffices)"
```

---

### Task 2: Compact conjugation chips

**Files:**
- Modify: `apps/web/components/drill/conjugation-feature-bundle.tsx` (the `card` variant block only)
- Test: `apps/web/components/drill/__tests__/conjugation-feature-bundle.test.tsx` (existing — must stay green; it asserts text, not classes)

**Interfaces:**
- Consumes: nothing new.
- Produces: same DOM text/structure; only the `card`-variant chip styling is tightened (smaller pronoun, less vertical padding, smaller top gap). The `inline` variant is untouched.

- [ ] **Step 1: Tighten the card-variant styles**

In `conjugation-feature-bundle.tsx`, replace the entire `return (...)` block of the `card` path (the JSX that starts with `<div className="mt-s-3 flex flex-wrap items-stretch gap-s-2">`) with:

```tsx
  return (
    <div className="mt-s-2 flex flex-wrap items-stretch gap-s-2">
      {subject && (
        <div
          className="flex flex-col justify-center rounded-lg px-s-3 py-[5px] text-center"
          style={{ background: 'var(--color-accent)' }}
        >
          <span
            className="leading-none font-display font-semibold"
            style={{ color: 'var(--color-paper)', fontSize: '18px' }}
          >
            {subject.pronoun}
          </span>
          <span className="t-micro mt-[2px]" style={{ color: 'var(--color-accent-soft)' }}>
            {subject.gloss}
          </span>
        </div>
      )}
      {features.map((f) => (
        <div
          key={`${f.term}|${f.gloss}`}
          className="flex flex-col justify-center rounded-lg border border-rule bg-paper-2 px-s-3 py-[5px]"
        >
          <span className="t-body font-medium text-ink leading-tight">{f.term}</span>
          <span className="t-micro text-ink-mute mt-[2px]">{f.gloss}</span>
        </div>
      ))}
    </div>
  );
```

Changes vs. the original: top gap `mt-s-3`→`mt-s-2`; badge vertical padding `py-s-2` (8px)→`py-[5px]`; pronoun drops from the 22px `t-display-s` class to an explicit 18px display glyph (`fontSize:'18px'` always wins over a class, and `font-display`/`font-semibold` keep the serif weight); gloss/term gap `mt-s-1` (4px)→`mt-[2px]`. Corner radius (`rounded-lg`) is deliberately unchanged.

> Note: if `font-display` is not a generated Tailwind utility in this project, swap that span's `className` to `leading-none` and add `fontFamily: 'var(--font-display)'` to its inline `style` — the same approach already used for color. Verify by checking the compiled output in Step 3.

- [ ] **Step 2: Run the existing bundle test + typecheck**

Run: `pnpm --filter @language-drill/web test -- conjugation-feature-bundle`
Expected: PASS (assertions are on text content — `nosotros`, `we`, `condicional`, `conditional` — which is unchanged).

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS.

- [ ] **Step 3: Verify the compact look visually**

The chip change is visual; confirm it renders (and that `font-display` actually applies the serif). Per the drill-component verification memory, screenshot the bundle with the esbuild harness, or run `pnpm dev:web` and open `/drill/conjugation` on a TR/ES profile at a mobile viewport (≤760px). Confirm: two-line chips, visibly tighter than before, pronoun ~18px in the display serif, no layout breakage when chips wrap.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/drill/conjugation-feature-bundle.tsx
git commit -m "feat(conjugation): compact target-form chips to reclaim mobile vertical space"
```

---

### Task 3: Conjugation page — level selector, theory link, flag button, header rearrange

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/conjugation/page.tsx`
- Test: `apps/web/app/(dashboard)/drill/conjugation/page.test.tsx`

**Interfaces:**
- Consumes:
  - `DrillMeta` from `../_components/drill-meta` — props `{ level: CefrLevel; baseline: CefrLevel | null; onLevelChange: (l: CefrLevel) => void; topic?: React.ReactNode }`.
  - `TheoryTrigger`, `TheoryPanel` from `../../../../components/theory`.
  - `topicIdForGrammarPointKey`, `exerciseTypeHasTheory` from `../../../../lib/theory-topic-map`.
  - `FlagExerciseControl` from `../_components/flag-exercise-control` — props `{ exerciseId: string; submissionId: string; fetchFn }`.
- Produces: the conjugation page renders a working CEFR level pill (changing it refetches at that level), a theory link when the grammar point maps to a topic, and a flag control after evaluation. No exported signature changes.

- [ ] **Step 1: Write the failing tests**

In `page.test.tsx`, make these edits:

(a) Add `useFlagExercise` to the `@language-drill/api-client` mock and a fake theory module. Replace the existing `vi.mock('@language-drill/api-client', …)` block with:

```tsx
const mockUseExercise = vi.fn();
const mockUseSubmitAnswer = vi.fn();
const mockUseLanguageProfiles = vi.fn();
const mockUseFlagExercise = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useExercise: (...args: unknown[]) => mockUseExercise(...args),
  useSubmitAnswer: (...args: unknown[]) => mockUseSubmitAnswer(...args),
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  useFlagExercise: (...args: unknown[]) => mockUseFlagExercise(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// Stub the theory surface: render a recognizable trigger button, no-op panel.
vi.mock('../../../../components/theory', () => ({
  TheoryTrigger: ({ topicId }: { topicId: string }) => (
    <button type="button">theory · {topicId}</button>
  ),
  TheoryPanel: () => null,
}));
```

(b) Give the sample result a `submissionId` so the flag control can render. Change the `SAMPLE_RESULT` fixture to include it:

```tsx
const SAMPLE_RESULT = {
  score: 1,
  grammarAccuracy: 1,
  vocabularyRange: 'n/a',
  taskAchievement: 1,
  feedback: 'Correct.',
  errors: [],
  estimatedCefrEvidence: 'B1',
  submissionId: '11111111-1111-4111-8111-111111111111',
};
```

(c) Wire the flag-exercise mock default in `beforeEach` (after the `mockUseSubmitAnswer.mockReturnValue(...)` block):

```tsx
  mockUseFlagExercise.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  });
```

(d) Add three new tests at the end of the main `describe('ConjugationPage', …)` block:

```tsx
  it('renders the drill-level selector defaulting to the profile baseline', () => {
    renderWithProviders(<ConjugationPage />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe(CefrLevel.B1);
  });

  it('changing the drill level refetches at the new CEFR level', () => {
    renderWithProviders(<ConjugationPage />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: CefrLevel.B2 },
    });
    expect(mockUseExercise).toHaveBeenLastCalledWith(
      expect.objectContaining({ difficulty: CefrLevel.B2 }),
    );
  });

  it('renders a theory link for a grammar point that maps to a topic', () => {
    renderWithProviders(<ConjugationPage />);
    // es-b1-conditional → topicId "b1-conditional" (lang prefix stripped).
    expect(
      screen.getByRole('button', { name: /theory · b1-conditional/i }),
    ).toBeInTheDocument();
  });

  it('shows the flag control after the answer is evaluated', async () => {
    renderWithProviders(<ConjugationPage />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'iríamos' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => {
      expect(screen.getByText('ir + íamos')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /flag this exercise/i }),
    ).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/web test -- conjugation/page`
Expected: FAIL — no `combobox` (no level select yet), no `theory · …` button, no flag control. Existing tests should still pass.

- [ ] **Step 3: Rewrite the conjugation page**

Replace the contents of `apps/web/app/(dashboard)/drill/conjugation/page.tsx` with the following (imports extended; `difficulty` becomes state-driven; header rearranged; theory + flag wired):

```tsx
'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { CefrLevel, ExerciseType } from '@language-drill/shared';
import {
  useExercise,
  useSubmitAnswer,
  useLanguageProfiles,
  createAuthenticatedFetch,
} from '@language-drill/api-client';
// One extra `../` compared to drill/page.tsx because we are one level deeper:
// (dashboard)/drill/conjugation/page.tsx vs (dashboard)/drill/page.tsx
import { useActiveLanguage } from '../../../../components/shell';
import { TheoryPanel, TheoryTrigger } from '../../../../components/theory';
import {
  topicIdForGrammarPointKey,
  exerciseTypeHasTheory,
} from '../../../../lib/theory-topic-map';
import { ExercisePane } from '../_components/exercise-pane';
import { DrillMeta } from '../_components/drill-meta';
import { FlagExerciseControl } from '../_components/flag-exercise-control';
import type { SubmissionMeta, SubmissionState } from '../_components/types';

// ---------------------------------------------------------------------------
// /drill/conjugation — opt-in conjugation warm-up (Plan, Task 16)
// ---------------------------------------------------------------------------
// Conjugation is intentionally NOT part of the adaptive rotation; this
// dedicated page is the only surface for it. It fetches one conjugation
// exercise from the pool, renders it via ExercisePane (which dispatches to
// ConjugationExercise), submits the answer WITHOUT a sessionId (the route
// validates session linkage only when sessionId is provided), shows feedback,
// and lets the user advance to a fresh exercise.
//
// Single-stage: submit → feedback → next. Mirrors free-writing/page.tsx's
// difficulty/fetchFn resolution but is simpler (no multi-stage navigation).
// ---------------------------------------------------------------------------

function ConjugationPageContent() {
  const { getToken } = useAuth();
  const searchParams = useSearchParams();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const { activeLanguage } = useActiveLanguage();
  const [grammarPointKey] = useState<string | null>(() => {
    const g = searchParams.get('grammarPoint');
    return g && g.length > 0 ? g : null;
  });

  // The learner's recorded baseline for the active language (identity), used as
  // the level default + the DrillMeta drift signal. Null when no profile yet.
  const { data: profilesData } = useLanguageProfiles({ fetchFn });
  const profiles = profilesData?.profiles ?? [];
  const baseline =
    (profiles.find((p) => p.language === activeLanguage)?.proficiencyLevel as
      | CefrLevel
      | undefined) ?? null;

  // The session-scoped level override. Null until the user picks one, then the
  // chosen level wins; effective difficulty falls back baseline → B1.
  const [level, setLevel] = useState<CefrLevel | null>(null);
  const difficulty = level ?? baseline ?? CefrLevel.B1;

  const [submission, setSubmission] = useState<SubmissionState>({ kind: 'idle' });
  // Which exercise the current `submission` belongs to. Advancing pulls a fresh
  // *random* exercise via refetch, and React Query keeps the previous `data` in
  // place while that refetch is in flight — so resetting submission to idle on
  // "next" would briefly re-render the OUTGOING exercise as a blank, unanswered
  // prompt before the new one lands (a visible flash / double-load). Instead we
  // pin the submission to its exercise id and derive `effectiveSubmission`: when
  // a different exercise arrives, the feedback falls back to idle in the *same*
  // render that swaps the prompt — atomic, no intermediate blank flash.
  const [submittedExerciseId, setSubmittedExerciseId] = useState<string | null>(null);

  // Theory panel host (open topic + the trigger element for focus return).
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);

  // useExercise is a TanStack `useQuery`. The backend returns a *random*
  // exercise per call, but the query is pinned (`staleTime: Infinity`,
  // `refetchOnWindowFocus: false`) so the task stays stable mid-answer.
  // Advancing to a new exercise is therefore an explicit `refetch()`.
  const { data: exercise, isError, error, refetch } = useExercise({
    language: activeLanguage,
    difficulty,
    type: ExerciseType.CONJUGATION,
    fetchFn,
    ...(grammarPointKey ? { grammarPointKey } : {}),
  });

  const submit = useSubmitAnswer({ fetchFn });

  const onSubmit = async (answer: string, _meta: SubmissionMeta) => {
    if (!exercise) return;
    setSubmittedExerciseId(exercise.id);
    setSubmission({ kind: 'submitting' });
    try {
      // No sessionId — the submit route validates session linkage only when a
      // sessionId is provided, and conjugation lives outside any drill session.
      const result = await submit.mutateAsync({ exerciseId: exercise.id, answer });
      setSubmission({
        kind: 'evaluated',
        result,
        meta: {},
        submissionId: (result as { submissionId?: string }).submissionId,
      });
    } catch (err) {
      setSubmission({
        kind: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  };

  const onNext = () => {
    // Pull a fresh exercise. Deliberately do NOT reset `submission` here: while
    // the refetch is in flight React Query still returns the current exercise,
    // so an eager idle-reset would flash the outgoing prompt blank before the
    // new one lands. The feedback stays pinned (see `effectiveSubmission`) until
    // a different exercise arrives, then clears in the same render as the swap.
    void refetch();
  };

  // The submission is only meaningful for the exercise it was made against. Once
  // a different exercise loads, treat it as idle — this is what makes advancing
  // atomic (new prompt + cleared feedback in one render) instead of a flash.
  const effectiveSubmission: SubmissionState =
    exercise && submittedExerciseId === exercise.id
      ? submission
      : { kind: 'idle' };

  // Theory topic for the current exercise's grammar point (null when the type
  // can't have theory or the key doesn't map). TheoryTrigger self-hides when
  // the resolved topic has no content, so a non-null id here is safe.
  const theoryTopicId =
    exercise && exerciseTypeHasTheory(exercise.type)
      ? topicIdForGrammarPointKey(exercise.grammarPointKey ?? null, activeLanguage)
      : null;

  const topicTrigger = theoryTopicId ? (
    <TheoryTrigger
      topicId={theoryTopicId}
      language={activeLanguage}
      onOpen={(id, el) => {
        setOpenTopicId(id);
        setTriggerEl(el);
      }}
      fetchFn={fetchFn}
    />
  ) : null;

  // Empty-pool / 404: the API returns 404 NO_EXERCISES when nothing matches the
  // (language, difficulty, conjugation) filter. createAuthenticatedFetch throws
  // an Error whose `body.code` is 'NO_EXERCISES', surfaced here via `isError`.
  // Show a friendly message rather than spinning forever.
  if (isError) {
    const isNoExercises =
      (error as { body?: { code?: string } } | undefined)?.body?.code === 'NO_EXERCISES';
    return (
      <div className="p-s-6">
        <h1 className="t-display-l mb-s-4">conjugation warm-up</h1>
        <p className="t-body text-ink-mute">
          {isNoExercises
            ? 'no conjugation exercises yet for this language and level — check back soon.'
            : 'could not load a conjugation exercise. try again in a moment.'}
        </p>
      </div>
    );
  }

  if (!exercise) {
    return (
      <div className="t-body" style={{ padding: 24 }}>
        loading…
      </div>
    );
  }

  return (
    <div className="p-s-6">
      {/* Title owns its own line so the meta controls below never compete with
          it on the baseline (DRILL-UI: open up before the title). */}
      <h1 className="t-display-l mb-s-4">conjugation warm-up</h1>

      {/* One meta row: writable level pill (+ drift/reset) and the read-only
          theory link, with the rapid-fire deep-link pushed to the far right. */}
      <div className="mb-s-6 flex flex-wrap items-center gap-s-3">
        <DrillMeta
          level={difficulty}
          baseline={baseline}
          onLevelChange={setLevel}
          topic={topicTrigger}
        />
        <Link
          href="/fluency?type=conjugation"
          className="ml-auto t-small text-ink-2 no-underline transition-colors hover:text-ink"
        >
          drill these fast <span className="lk-arr" aria-hidden="true">→</span>
        </Link>
      </div>

      <ExercisePane
        exercise={exercise}
        language={activeLanguage}
        submission={effectiveSubmission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel="next"
      />

      {effectiveSubmission.kind === 'evaluated' &&
        effectiveSubmission.submissionId && (
          <FlagExerciseControl
            exerciseId={exercise.id}
            submissionId={effectiveSubmission.submissionId}
            fetchFn={fetchFn}
          />
        )}

      {openTopicId && (
        <TheoryPanel
          topicId={openTopicId}
          language={activeLanguage}
          triggerEl={triggerEl}
          onClose={() => setOpenTopicId(null)}
          fetchFn={fetchFn}
        />
      )}
    </div>
  );
}

// `useSearchParams()` forces this client page out of static prerendering;
// Next.js requires the bailout to sit under a Suspense boundary.
export default function ConjugationPage() {
  return (
    <Suspense fallback={<div className="t-body" style={{ padding: 24 }}>loading…</div>}>
      <ConjugationPageContent />
    </Suspense>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/web test -- conjugation/page`
Expected: PASS — all existing tests plus the four new ones (`combobox` default B1, level change refetches at B2, theory link present, flag control after eval). The `grammarPoint` targeting tests still pass because `...(grammarPointKey ? { grammarPointKey } : {})` is unchanged.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS. (`DrillMeta.onLevelChange` is `(l: CefrLevel) => void`; `setLevel` accepts `CefrLevel | null`, so passing a `CefrLevel` is assignable.)

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/conjugation/page.tsx" "apps/web/app/(dashboard)/drill/conjugation/page.test.tsx"
git commit -m "feat(conjugation): level selector, theory link, flag button, rearranged header"
```

---

### Task 4: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate from the repo root**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures across all packages. If `infra` synth tests flake under parallel load or stale `dist` surfaces phantom failures, consult the relevant memory before assuming a regression (e.g. `rm -rf infra/lambda/dist`; esbuild-at-root symlink for infra synth) — those are environmental, not caused by this change.

- [ ] **Step 2: Manual mobile smoke (optional but recommended)**

Run `pnpm dev:web`, open `/drill/conjugation` at a ≤760px viewport on a TR or ES profile. Confirm: (a) no accent keyboard row under the input; (b) compact chips; (c) title on its own line with `drill level ▾ · theory · …` and `drill these fast →` below it, not competing with the title; (d) after submitting, a "Flag this exercise" link appears; (e) tapping the theory link opens the panel; (f) changing the level pill loads a fresh exercise. On desktop (>760px), confirm the accent keyboard still renders.

---

## Self-Review

**Spec coverage:**
- Delta 1 (compact chips) → Task 2. ✓
- Delta 2 (remove mobile accent keyboard, all exercises, app-wide) → Task 1. ✓
- Delta 3 (flag button once evaluated) → Task 3 (FlagExerciseControl + submissionId capture). ✓
- Delta 4 (theory link) → Task 3 (TheoryTrigger/TheoryPanel). ✓
- Delta 5 (rearrange quick/level vs. title + functional level selector) → Task 3 (title on own line, DrillMeta meta row, fast link right-aligned). ✓
- Delta 6 (grammar-point title — omit) → honored by *not* adding it; page stays title → meta → prompt. ✓

**Placeholder scan:** No TBD/TODO. Every code step shows complete code. The one conditional ("if `font-display` isn't a utility…") gives an exact, concrete fallback rather than a vague instruction.

**Type consistency:** `setLevel: (l: CefrLevel | null) => void` passed where `(l: CefrLevel) => void` is expected — assignable. `effectiveSubmission.submissionId` is valid (the `evaluated` variant in `types.ts` carries optional `submissionId`). `exercise.type` / `exercise.grammarPointKey` match the fields used by the generic drill page's theory derivation. Mock names (`mockUseFlagExercise`) are consistent across mock/`beforeEach`.
