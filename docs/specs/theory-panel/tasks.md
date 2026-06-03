# Theory Panel — Tasks

## Task Overview

25 atomic tasks. Order: foundation types → topic map → registry & content → primitives & hooks → panel components → drill integration → tests → styles → final verification. Every task lists exact file paths, requirement refs, leverage points, and a one-line verify step. The default verify is `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web test` from repo root unless a stronger check is needed.

Dependencies (informal): Tasks 1–3 unblock everything. Tasks 4–7 unblock the panel. Tasks 8–14 build the panel. Task 15 wires it into the drill page. Tasks 16–22 are tests. Task 23 is final verify.

## Steering Document Compliance

- **`.claude/steering/tech.md`** — every task uses Next.js + Tailwind v4 + Vitest + RTL; no new dependencies introduced.
- **`CLAUDE.md`** — every task ends with the project's verification commands (`pnpm typecheck` and/or `pnpm test`); pre-push checks (`pnpm lint && pnpm typecheck && pnpm test`) are run in Task 23.
- **Monorepo layout** — code lives under `apps/web/` (one additive line per variant in `packages/shared/src/index.ts`); no `packages/db`, `packages/ai`, or `infra/` changes.

---

## Atomic Task Requirements

Each task touches **1–3 files maximum**, fits in **15–30 min**, has a **single testable outcome**, and lists exact file paths. Verification per task uses commands already documented in `CLAUDE.md`.

## Task Format Guidelines

- Checkbox + numbered. Bullets list implementation steps.
- `_Requirements: …_` cites FR/NFR ids from `requirements.md`.
- `_Leverage: …_` cites concrete file paths in this repo.
- `_Verify: …_` lists the exact command(s) to run from repo root.

---

## Tasks

### Foundation — types, map, registry skeleton

- [x] 1. Add `topicHint?: string` to `ExerciseContent` variants in `packages/shared/src/index.ts`
  - File: `packages/shared/src/index.ts` (modify)
  - Append optional `topicHint?: string` to `ClozeContent`, `TranslationContent`, and `VocabRecallContent` (one line each)
  - Do NOT touch the Zod schema in `packages/api-client/src/schemas/exercise.ts` — `contentJson: z.unknown()` already passes the field through
  - Purpose: lets seed authors associate an exercise with a theory topic without a backend change
  - _Leverage: `packages/shared/src/index.ts` lines 63–88 (existing variant types)_
  - _Requirements: FR-6.1, FR-6.2; Data Models §`topicHint?: string` on ExerciseContent_
  - _Verify: `pnpm --filter @language-drill/shared typecheck && pnpm --filter @language-drill/shared test`_

- [x] 2. Create `apps/web/components/theory/types.ts` with `TheoryTopic` and `TheorySection`
  - File: `apps/web/components/theory/types.ts` (create)
  - Export `TheorySection = { id: string; title: string; body: React.ReactNode }`
  - Export `TheoryTopic = { id: string; title: string; subtitle: string; cefr: string; sections: TheorySection[] }`
  - Do NOT export `TheoryTopicId` from this file — it lives in the registry to avoid a cycle
  - Purpose: one place authors and the panel both reference for topic shape
  - _Leverage: existing pattern of standalone type files (none yet — small file)_
  - _Requirements: Data Models §TheoryTopic, §TheorySection_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 3. Create empty registry skeleton `apps/web/content/theory/index.ts`
  - File: `apps/web/content/theory/index.ts` (create)
  - Define `theoryRegistry = { ES: {}, DE: {}, TR: {} } as const satisfies Record<LearningLanguage, Record<string, TheoryTopic>>`
  - Export `TheoryTopicId = keyof typeof theoryRegistry.ES | keyof typeof theoryRegistry.DE | keyof typeof theoryRegistry.TR` (resolves to `never` for now — that's fine)
  - Implement `getTheoryTopic(language, topicId)` and `listTheoryTopics(language)` per design (sort by `title` via `localeCompare`)
  - Purpose: callable API for the panel and topic map; topics get added in later tasks
  - _Leverage: `packages/shared/src/index.ts` (`Language` enum), `apps/web/components/theory/types.ts`_
  - _Requirements: FR-5.1, FR-5.2, FR-5.3, FR-5.4_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 4. Create `apps/web/lib/theory-topic-map.ts` with `topicIdForHint`
  - File: `apps/web/lib/theory-topic-map.ts` (create)
  - Export `HINT_TO_TOPIC: Record<string, TheoryTopicId>` — leave it `{}` for now (entries added with topics in tasks 6–8)
  - Export `topicIdForHint(hint: string | undefined, language: LearningLanguage): TheoryTopicId | null` — string-map lookup, then `getTheoryTopic` existence check, return `null` otherwise
  - In dev (`process.env.NODE_ENV === 'development'`), `console.warn` once when `hint` is set but unmapped (Scenario 2 dev affordance)
  - Purpose: single point of truth for "does this exercise have theory?"
  - _Leverage: `apps/web/content/theory/index.ts` (`getTheoryTopic`, `TheoryTopicId`)_
  - _Requirements: FR-6.2, FR-6.3, Error Scenario 2_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

### Primitives, content, registry wiring

- [x] 5. Create theory section primitives `apps/web/components/theory/primitives.tsx`
  - File: `apps/web/components/theory/primitives.tsx` (create)
  - Export tiny components that wrap `globals.css` classes with the right semantics:
    - `<Callout variant="default" | "warn">` → `<div className="callout">` / `"callout warn"`
    - `<Example>` with sub-components `<Example.ES>` (target-language line), `<Example.EN>` (translation, italic), `<Example.Note>`
    - `<TheoryList>` → `<ul className="theory-list">`
    - `<ConjugationTable>` → `<table className="theory-table">` with `<ConjugationTable.Head>` / `<ConjugationTable.Body>` (or just thin wrappers exposing `<thead>`/`<tbody>`)
    - `<Hilite>` → `<span className="hilite">`, `<Mono>` → `<span className="t-mono">`
  - All components are pure presentational; no state; no event handlers
  - Purpose: keep content files free of raw class strings so primitives can be unit-rendered in `registry.test.tsx`
  - _Leverage: `apps/web/app/globals.css` (`.hilite`, `.t-mono`, plus `.callout`/`.example`/`.theory-list`/`.theory-table` added in Task 21)_
  - _Requirements: FR-4.1, FR-4.2_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 6. Author `apps/web/content/theory/es/subjunctive.tsx`
  - File: `apps/web/content/theory/es/subjunctive.tsx` (create)
  - Default-export a `TheoryTopic` with `id: 'subjunctive'`, `title: 'el subjuntivo'`, `cefr: 'B1–B2'`, and the six sections from the prototype: `what`, `when`, `form-regular`, `form-irregular`, `examples`, `pitfalls` — translate the JSX from `design_handoff_language_drill/prototypes/web/hifi/theory.jsx` lines 5–131 into our `<Callout>` / `<Example>` / `<ConjugationTable>` / `<TheoryList>` / `<Hilite>` / `<Mono>` primitives
  - Then in `apps/web/content/theory/index.ts`: import this file and add `subjunctive` to `theoryRegistry.ES`; add `'subjunctive': 'subjunctive'` and `'present-subjunctive': 'subjunctive'` to `HINT_TO_TOPIC` in `apps/web/lib/theory-topic-map.ts`
  - Purpose: ship the v1 marquee topic; the registry now has its first real entry
  - _Leverage: `design_handoff_language_drill/prototypes/web/hifi/theory.jsx`, `apps/web/components/theory/primitives.tsx`_
  - _Requirements: FR-4, FR-5, US-1, Assumptions §"v1 ships with content for ES only"_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 7. Author `apps/web/content/theory/es/preterite-imperfect.tsx`
  - File: `apps/web/content/theory/es/preterite-imperfect.tsx` (create)
  - Default-export a `TheoryTopic` with `id: 'preterite-imperfect'`, `title: 'pretérito vs. imperfecto'`, `cefr: 'A2–B1'`, and at least four sections: `what` (the prototype's "what's the difference?"), `signals` (signal words: `ayer/anoche/de repente` → preterite vs `siempre/todos los días/cuando era niño` → imperfect), `examples`, `formation`
  - The prototype only ships `what` + `examples` + a "stub" placeholder; flesh out `signals` and `formation` from common B1 reference material — keep the writing voice editorial and concise (≤120 words per section)
  - Then in `apps/web/content/theory/index.ts`: import + add to `theoryRegistry.ES`; add `'preterite-vs-imperfect': 'preterite-imperfect'` and `'pret-imp': 'preterite-imperfect'` to `HINT_TO_TOPIC`
  - Purpose: second full topic — proves the panel handles a second TOC entry and the "other topics" list
  - _Leverage: `design_handoff_language_drill/prototypes/web/hifi/theory.jsx` lines 133–166, `apps/web/components/theory/primitives.tsx`_
  - _Requirements: FR-3.4, FR-4, FR-5_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 8. Author stub `apps/web/content/theory/es/conditional.tsx`
  - File: `apps/web/content/theory/es/conditional.tsx` (create)
  - Default-export a `TheoryTopic` with `id: 'conditional'`, `title: 'el condicional'`, `subtitle: 'would-statements, polite requests, hypotheticals'`, `cefr: 'B1–B2'`, and a single `overview` section with one paragraph in `<Callout>` saying "more sections coming soon — formation, uses, irregulars, examples"
  - Then in `apps/web/content/theory/index.ts`: import + add to `theoryRegistry.ES`; add `'conditional': 'conditional'` to `HINT_TO_TOPIC`
  - Purpose: provides the third entry needed to verify "other topics" sorting and behavior with a deliberately tiny topic
  - _Leverage: `design_handoff_language_drill/prototypes/web/hifi/theory.jsx` lines 168–175_
  - _Requirements: FR-3.4, FR-5_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

### Hooks

- [x] 9. Create `apps/web/components/theory/use-scroll-spy.ts`
  - File: `apps/web/components/theory/use-scroll-spy.ts` (create)
  - Export `useScrollSpy(sectionIds: string[], scrollRef: RefObject<HTMLElement | null>): string`
  - Inside a single `useEffect`: build one `IntersectionObserver` rooted at `scrollRef.current` with `rootMargin: '-20% 0px -60% 0px'` and `threshold: [0, 0.25, 0.5, 0.75, 1]`, observe each `#{id}` element (querySelector on the root)
  - Sort entries by `intersectionRatio` desc on each fire; setState to the most-visible id
  - Default state: `sectionIds[0] ?? ''`
  - Re-run when `sectionIds` joined string changes (use `sectionIds.join('|')` as a dep proxy)
  - Purpose: TOC active state without per-section scroll listeners
  - _Leverage: `design_handoff_language_drill/prototypes/web/hifi/theory.jsx` lines 188–202 (same logic, typed)_
  - _Requirements: FR-3.2, NFR Performance §"single IntersectionObserver"_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 10. Create `apps/web/components/theory/use-focus-trap.ts`
  - File: `apps/web/components/theory/use-focus-trap.ts` (create)
  - Export `useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>): void`
  - When `active` becomes true: query focusable elements with selector `'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'` inside `containerRef.current`, focus the first one (the close button, by render order)
  - Listen for `keydown` Tab/Shift+Tab and wrap focus across the first/last
  - Cleanup removes the listener on unmount or when `active` flips to false
  - Selector limitation (no `select`/`textarea`/`[contenteditable]`) is intentional per design — add a comment
  - Purpose: a11y focus trap (FR-9.2)
  - _Leverage: none — small standalone hook_
  - _Requirements: FR-9.1, FR-9.2_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 11. Create `apps/web/components/theory/use-body-scroll-lock.ts`
  - File: `apps/web/components/theory/use-body-scroll-lock.ts` (create)
  - Export `useBodyScrollLock(active: boolean): void`
  - On `active = true`: cache `document.body.style.overflow` and `document.documentElement.style.overflow`, then set both to `'hidden'`
  - On `active = false` or unmount: restore both
  - Single-instance assumption is fine — only one panel can open at a time
  - Purpose: prevents drill-page scroll bleed-through (FR-8.7)
  - _Leverage: none_
  - _Requirements: FR-8.7_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

### Panel components

- [x] 12. Create empty / error state `apps/web/components/theory/theory-empty.tsx`
  - File: `apps/web/components/theory/theory-empty.tsx` (create)
  - Props: `{ attemptedTopicId: string; language: LearningLanguage; onSwitchTopic: (topicId: TheoryTopicId) => void }`
  - Render: eyebrow `t-micro` "theory · reference"; heading `no theory written yet for "{attemptedTopicId}"`; body "we'll add this topic soon — try one of these:"; list other topics from `listTheoryTopics(language)` as buttons that call `onSwitchTopic`
  - When `listTheoryTopics(language)` is empty: show "no theory written yet for {LANGUAGE_NAMES[language]} — coming soon." instead of an empty list
  - Purpose: render path for missing/broken topics
  - _Leverage: `apps/web/content/theory/index.ts` (`listTheoryTopics`), `packages/shared/src/index.ts` (`LANGUAGE_NAMES`)_
  - _Requirements: FR-7.1, FR-7.2, Error Scenario 4_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 13. Create `apps/web/components/theory/theory-toc.tsx`
  - File: `apps/web/components/theory/theory-toc.tsx` (create)
  - Props: `{ topic: TheoryTopic; activeSectionId: string; onJump: (sectionId: string) => void; language: LearningLanguage; onSwitchTopic: (topicId: TheoryTopicId) => void }`
  - Layout: `<nav className="theory-toc">` containing eyebrow `jump to`, then `<ul>` with one `<button>` per section. Active button gets `className="active"` and `aria-current="true"`
  - Below the section list: dashed-rule separator + eyebrow `other topics` + buttons from `listTheoryTopics(language).filter(t => t.id !== topic.id)`. Hide the entire "other topics" block when the filtered list is empty (FR-3.5)
  - Purpose: TOC + topic switcher
  - _Leverage: `apps/web/content/theory/index.ts` (`listTheoryTopics`)_
  - _Requirements: FR-3.1, FR-3.3, FR-3.4, FR-3.5, FR-9.5_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 14. Create `apps/web/components/theory/theory-content.tsx` with embedded error boundary
  - File: `apps/web/components/theory/theory-content.tsx` (create)
  - Props: `{ topic: TheoryTopic; scrollRef: RefObject<HTMLDivElement | null>; onClose: () => void }`
  - Render `<div ref={scrollRef} className="theory-scroll">` wrapping `topic.sections.map(s => <section id={s.id} className="theory-section"><h3 className="theory-section-title">{s.title}</h3><div className="theory-content">{s.body}</div></section>)`, then `<div style={{ height: 80 }} />`, then a sticky footer `<div className="theory-footer-cta"><Button variant="primary" size="sm" onClick={onClose}>back to drill →</Button></div>`
  - In the same file, declare a small `class TheoryErrorBoundary extends React.Component<{children, fallback}, {hasError: boolean}>` that catches render errors and shows the fallback. Wrap the sections (NOT the footer) in it; pass `<TheoryEmpty …>` as the fallback
  - Purpose: scrollable section column + Reliability NFR error boundary
  - _Leverage: `apps/web/components/ui/button.tsx`, `apps/web/components/theory/theory-empty.tsx`_
  - _Requirements: FR-2.5, NFR Reliability §scenario 3_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 15a. Scaffold `apps/web/components/theory/theory-panel.tsx` — props, refs, render shell
  - File: `apps/web/components/theory/theory-panel.tsx` (create — `'use client'`)
  - Props type: `{ topicId: TheoryTopicId; language: LearningLanguage; triggerEl: HTMLElement | null; onClose: () => void }`
  - Local state: `const [internalTopicId, setInternalTopicId] = useState(topicId)`; refs `scrollRef = useRef<HTMLDivElement>(null)`, `panelRef = useRef<HTMLElement>(null)`, `closeBtnRef = useRef<HTMLButtonElement>(null)`
  - Resolve `topic = getTheoryTopic(language, internalTopicId)`. Compute `activeSectionId` as `topic?.sections[0]?.id ?? ''` for now (real spy wiring lands in 15b)
  - Render via `createPortal(<div className="theory-overlay" onClick={onClose}><aside className="theory-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="theory-title" onClick={e => e.stopPropagation()}>{header}{body}</aside></div>, document.body)` where:
    - `header` = `theory · reference` eyebrow, `<h2 id="theory-title">{topic.title}</h2>`, `<Chip>{topic.cefr}</Chip>`, subtitle, close `<button ref={closeBtnRef} className="theory-close" onClick={onClose}>×</button>`
    - `body` = if `!topic` → `<TheoryEmpty …>`; else `<div className="theory-body"><TheoryToc topic={topic} activeSectionId={activeSectionId} onJump={() => {}} language={language} onSwitchTopic={setInternalTopicId} /><TheoryContent topic={topic} scrollRef={scrollRef} onClose={onClose} /></div>`
  - No effects, no hooks composed yet — that lands in 15b/15c
  - Purpose: get the panel rendering with valid composition; subsequent tasks add behavior
  - _Leverage: `apps/web/components/ui/{button,chip}.tsx`, `theory-toc.tsx`, `theory-content.tsx`, `theory-empty.tsx`, `apps/web/content/theory/index.ts`_
  - _Requirements: FR-2.1, FR-2.2, FR-2.3, FR-2.4, FR-9.4_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 15b. Compose hooks in `theory-panel.tsx` — scroll-spy, focus trap, body scroll lock
  - File: `apps/web/components/theory/theory-panel.tsx` (modify, continue from 15a)
  - Replace the static `activeSectionId` with `const activeSectionId = useScrollSpy(topic ? topic.sections.map(s => s.id) : [], scrollRef)`
  - Add `useFocusTrap(true, panelRef)` and `useBodyScrollLock(true)`
  - Implement `handleJump(id: string)` → `panelRef.current?.querySelector('#' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })` and pass it to `<TheoryToc onJump={handleJump}>`
  - Purpose: scroll-spy + a11y wiring without changing the render shell from 15a
  - _Leverage: `use-scroll-spy.ts`, `use-focus-trap.ts`, `use-body-scroll-lock.ts` from tasks 9–11_
  - _Requirements: FR-3.2, FR-3.3, FR-8.7, FR-9.1, FR-9.2_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 15c. Add Esc, focus-restore, and topic-swap reset effects to `theory-panel.tsx`
  - File: `apps/web/components/theory/theory-panel.tsx` (modify, continue from 15b)
  - Add `useEffect` listening for `keydown` on `document`; if `e.key === 'Escape'` call `onClose()`. Cleanup removes the listener. Dep: `[onClose]`
  - Add `useEffect(() => { closeBtnRef.current?.focus(); }, [])` — auto-focus close button on first mount
  - Add `useEffect(() => () => { triggerEl?.focus(); }, [])` — on unmount, restore focus to the trigger pill (FR-9.3)
  - Add `useEffect(() => { setInternalTopicId(topicId); }, [topicId])` — when the parent reopens with a new id, sync internal state
  - Add `useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [internalTopicId])` — reset scroll on topic swap (FR-8.5)
  - Purpose: complete the panel's behavior contract
  - _Leverage: same as 15b_
  - _Requirements: FR-8.1, FR-8.5, FR-9.1, FR-9.3_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

- [x] 16. Create trigger pill `apps/web/components/theory/theory-trigger.tsx` and barrel
  - Files: `apps/web/components/theory/theory-trigger.tsx` (create), `apps/web/components/theory/index.ts` (create)
  - Trigger: `'use client'`. Props `{ topicId: TheoryTopicId; language: LearningLanguage; onOpen: (topicId, triggerEl) => void }`. Render `<button>` with `aria-haspopup="dialog"`, dashed border, label `theory · {topic.title}` (read from `getTheoryTopic`). On click, call `onOpen(topicId, e.currentTarget)`
  - Barrel re-exports `TheoryPanel`, `TheoryTrigger`, plus `TheoryTopicId` from `apps/web/content/theory`
  - Purpose: clean import surface for the drill page
  - _Leverage: `apps/web/content/theory/index.ts`_
  - _Requirements: FR-1.1, FR-1.3, FR-1.4_
  - _Verify: `pnpm --filter @language-drill/web typecheck`_

### Drill page integration

- [x] 17. Wire trigger + panel into `apps/web/app/(dashboard)/drill/page.tsx`
  - File: `apps/web/app/(dashboard)/drill/page.tsx` (modify)
  - Import `useActiveLanguage` (already exists in shell), `topicIdForHint`, `TheoryPanel`, `TheoryTrigger` from `@/components/theory`
  - Add state: `const [openTopicId, setOpenTopicId] = useState<TheoryTopicId | null>(null)` and `const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null)`
  - In `ExercisePrompt` (or above the prompt content), compute `const topicId = topicIdForHint((content as any).topicHint, language as LearningLanguage)` and conditionally render `<TheoryTrigger topicId={topicId} language={language as LearningLanguage} onOpen={(id, el) => { setOpenTopicId(id); setTriggerEl(el); }} />` (skip render when `topicId === null`)
  - Below `<ExercisePrompt>`, render `{openTopicId && <TheoryPanel topicId={openTopicId} language={language as LearningLanguage} triggerEl={triggerEl} onClose={() => setOpenTopicId(null)} />}`
  - Add `useEffect(() => setOpenTopicId(null), [activeLanguage])` watching the shell's active language (FR-8.6)
  - Use the language from `useActiveLanguage()`, NOT the page-local `language` state (the page's `language` is the *exercise filter*; the *active learning language* is what scopes theory)
  - Purpose: the only edit to the drill page; everything else is composition
  - _Leverage: `apps/web/app/(dashboard)/drill/page.tsx` (existing structure), `apps/web/components/shell/active-language-provider.tsx` (`useActiveLanguage`), `apps/web/lib/theory-topic-map.ts`_
  - _Requirements: FR-1, FR-6, FR-8.4, FR-8.6, US-1, US-4_
  - _Verify: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web test`_

### Tests

- [x] 18. Add `IntersectionObserver` mock to `apps/web/vitest.setup.ts`
  - File: `apps/web/vitest.setup.ts` (modify)
  - After the existing `import '@testing-library/jest-dom/vitest'` line, define a `MockIntersectionObserver` class with `observe`/`unobserve`/`disconnect`/`takeRecords` (all no-ops or `vi.fn()`), and call `vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)`
  - Purpose: enables jsdom rendering of `<TheoryPanel>` and `useScrollSpy` in tests
  - _Leverage: `apps/web/vitest.setup.ts`_
  - _Requirements: NFR Testing §IntersectionObserver mock_
  - _Verify: `pnpm --filter @language-drill/web test` (existing tests still pass)_

- [x] 19. Test `theory-topic-map` and registry
  - Files: `apps/web/lib/__tests__/theory-topic-map.test.ts` (create), `apps/web/content/theory/__tests__/registry.test.tsx` (create)
  - `theory-topic-map.test.ts`: known hint maps to id; unknown hint returns null; undefined returns null; cross-language gap (e.g., `'subjunctive'` for `Language.DE`) returns null
  - `registry.test.tsx`: for each topic in `theoryRegistry.ES`, render every section's `body` via RTL (`render(<>{section.body}</>)`) and assert no error throws; assert section IDs are unique within a topic; assert `title`/`subtitle`/`cefr` are non-empty
  - Purpose: prove the registry plumbing and content files are valid
  - _Leverage: existing test pattern in `apps/web/components/ui/__tests__/`_
  - _Requirements: NFR Testing — unit tests for registry + map_
  - _Verify: `pnpm --filter @language-drill/web test`_

- [x] 20. Test the three hooks (`use-scroll-spy`, `use-focus-trap`, `use-body-scroll-lock`)
  - Files: `apps/web/components/theory/__tests__/use-scroll-spy.test.ts` (create), `apps/web/components/theory/__tests__/use-focus-trap.test.tsx` (create), `apps/web/components/theory/__tests__/use-body-scroll-lock.test.ts` (create)
  - `use-scroll-spy`: render a tiny harness that mounts the hook with three section divs, capture the IntersectionObserver constructor callback (via the mock from Task 18), invoke it with synthetic entries, assert the returned active id matches the highest-ratio entry
  - `use-focus-trap`: mount a harness with three buttons (close + two others), assert focus lands on the first button on activation; fire `Tab` keydown from the last → focus wraps to the first; fire `Shift+Tab` from the first → wraps to the last
  - `use-body-scroll-lock`: assert `document.body.style.overflow` becomes `'hidden'` on mount-with-active-true and is restored on unmount
  - Purpose: hooks have unit coverage independent of the panel
  - _Leverage: Task 18 mock; existing RTL pattern_
  - _Requirements: NFR Testing — hook tests; FR-3.2, FR-9.1, FR-9.2, FR-8.7_
  - _Verify: `pnpm --filter @language-drill/web test`_

- [x] 21. Test trigger, TOC, and panel components
  - Files: `apps/web/components/theory/__tests__/theory-trigger.test.tsx` (create), `apps/web/components/theory/__tests__/theory-toc.test.tsx` (create), `apps/web/components/theory/__tests__/theory-panel.test.tsx` (create)
  - `theory-trigger`: renders title from registry; `aria-haspopup="dialog"` set; click invokes `onOpen` with `(topicId, HTMLElement)`; Enter/Space activate via the underlying `<button>` (jsdom default behavior is fine)
  - `theory-toc`: section list rendered in render order; active item gets `aria-current="true"`; click on a section calls `onJump` with its id; "other topics" list shown when there are other topics for the language; hidden when none; click on an "other topic" calls `onSwitchTopic` with that id
  - `theory-panel`: opens via portal — assert `document.body.querySelector('[role="dialog"]')` exists; `aria-modal="true"`; `aria-labelledby` attribute resolves to an element containing the topic title; pressing Escape calls `onClose`; clicking the overlay (not the aside) calls `onClose`; clicking the close button calls `onClose`; clicking the "back to drill" CTA calls `onClose`; selecting an "other topic" updates the rendered title in place without unmount; when `getTheoryTopic` returns null, `<TheoryEmpty>` renders
  - Purpose: component-level a11y and behavior assertions
  - _Leverage: Task 18 mock; existing RTL pattern_
  - _Requirements: FR-1, FR-2, FR-3, FR-7, FR-8.1–8.3, FR-9.4–9.5_
  - _Verify: `pnpm --filter @language-drill/web test`_

- [x] 22. Extend drill-page test
  - File: `apps/web/app/(dashboard)/drill/page.test.tsx` (modify)
  - Add three test cases: (a) trigger pill renders when the mocked exercise's `contentJson.topicHint` is `'subjunctive'` and active language is `Language.ES`; (b) trigger pill does NOT render when `topicHint` is missing; (c) clicking the trigger pill opens the panel (assert `document.body.querySelector('[role="dialog"]')` exists)
  - Match the file's existing mocking pattern for `useExercise` / `useLanguageProfiles` / Clerk's `useAuth`
  - Purpose: integration coverage that drill ↔ theory wiring works
  - _Leverage: `apps/web/app/(dashboard)/drill/page.test.tsx` (existing setup)_
  - _Requirements: NFR Testing §drill page test extension; FR-1.1, FR-1.2, FR-1.3_
  - _Verify: `pnpm --filter @language-drill/web test`_

### Styles + final verification

- [x] 23. Add theory styles to `apps/web/app/globals.css` and run pre-push checks
  - File: `apps/web/app/globals.css` (modify)
  - Append the `.theory-overlay`, `.theory-panel`, `.theory-header`, `.theory-close`, `.theory-body`, `.theory-toc` (with `ul button.active`), `.theory-other`, `.theory-otherbtn`, `.theory-scroll`, `.theory-section`, `.theory-section-title`, `.callout` (+ `.warn`), `.example` (with `.example-es`/`.example-en`/`.example-note`), `.theory-list`, `.theory-table`, `.theory-footer-cta` styles per the design's "Styling" section
  - Append a `@media (prefers-reduced-motion: reduce)` block disabling slide-in transition and `scroll-behavior: smooth`
  - Use existing tokens only (`--color-paper-2`, `--color-rule`, `--color-accent`, `--color-accent-soft`, `--font-display`, `--font-mono`, etc.) — no new tokens
  - Verify: from repo root run `pnpm lint && pnpm typecheck && pnpm test`. Confirm zero failures. Run `pnpm --filter @language-drill/web build` and inspect the route output for `/drill` — confirm bundle delta < 50KB gzipped vs `main`
  - Purpose: final styling pass + the one mandatory pre-push run from `CLAUDE.md`
  - _Leverage: existing `apps/web/app/globals.css` token system_
  - _Requirements: FR-2.1–FR-2.4, FR-9.7, NFR Performance bundle budget; CLAUDE.md Pre-Push Checks_
  - _Verify: `pnpm lint && pnpm typecheck && pnpm test` from repo root, all green; `pnpm --filter @language-drill/web build` confirms bundle budget_
