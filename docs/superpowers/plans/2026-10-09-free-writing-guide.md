# Free-Writing Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-before-you-write guide per language × level band at `/drill/free-writing/guide`, styled like the grammar theory pages and linked from the free-writing brief.

**Architecture:** Six hand-authored `TheoryTopicJson` files in `apps/web/content/writing-guides/`, loaded through a typed registry that parses each with `parseTheoryTopicJson`. A client page resolves language + band and renders `FwGuide`, which reuses the theory page's CSS, `TheoryToc` (with no `fetchFn`, so its grammar topic list is hidden and never fetched), `TheorySections`, `renderTheoryTopicJson` and `useScrollSpy`. No API, DB or prompt change.

**Tech Stack:** Next.js App Router (client components), TypeScript, Vitest + Testing Library, `@language-drill/shared` theory types.

**Spec:** `docs/superpowers/specs/2026-10-09-free-writing-guide-design.md`

## Global Constraints

- Work only in the worktree `/Users/seal/dev/language-drill/.claude/worktrees/fw-guide` on branch `free-writing-guide`; prefix every path with it.
- Languages: `Language.ES`, `Language.DE`, `Language.TR` (`LearningLanguage`). Bands: `'a1-a2'`, `'b1-b2'`.
- Level → band: `A1`,`A2` → `a1-a2`; `B1`,`B2`,`C1`,`C2` → `b1-b2`. Level resolves like `drill/free-writing/page.tsx`: profile level for the active language, default `CefrLevel.B1`.
- Section ids, in order, identical in every guide: `what-is-graded`, `paragraph-shape`, `connectors`, `register`, `task-and-length`, `common-mistakes`, `checklist`.
- Guide `id` = `<lang lowercase>-<band>` (e.g. `es-b1-b2`); `cefr` = `"A1–A2"` or `"B1–B2"` (en dash U+2013).
- Word bands (from `FREE_WRITING_LENGTH_BY_CEFR`): A1 30–60 words / 10 min, A2 60–100 / 15, B1 80–120 / 15, B2 150–200 / 25.
- Explanations in English; examples in the target language with an English gloss (`example` block `target` + `en`).
- Only existing block kinds: `paragraph`, `callout` (`default`|`warn`), `example`, `list`, `conjugation-table`. Inline kinds: `text`, `strong`, `em`, `hilite`, `mono`.
- Do not modify `components/theory/*` — grammar theory behaviour must stay byte-identical.
- Copy style matches the free-writing surfaces: lowercase micro labels ("free writing · guide"), arrows as `→`.
- Package manager pnpm; run web tests with `pnpm --filter @language-drill/web exec vitest run <path>`.

## Review Focus

1. **Profiles still loading** — the level is unknown for a moment; the guide must not render the B1–B2 band and then jump to A1–A2. Expect a loading state until profiles resolve (unless `?band=` is given). Test in Task 3.
2. **Invalid or stale `?band=`** (`?band=c1`, `?band=`) — must fall back to the profile band, never crash or render nothing. Test in Task 3.
3. **Active language switch** — the guide follows the active language (ES→DE shows the German guide). Test in Task 3.
4. **Mobile width** — the theory layout collapses its TOC into a strip; the band switch and header must fit at 402px with no horizontal scroll. Verified by screenshot in Task 5.
5. **TheoryToc without `fetchFn`** — the "all topics" grammar list must be absent and no `/theory/<lang>` request made. Test in Task 3 (asserts no "all topics" text and that `fetchFn` is never passed).

---

### Task 1: Guide content + registry

**Files:**
- Create: `apps/web/content/writing-guides/es-a1-a2.json`, `es-b1-b2.json`, `de-a1-a2.json`, `de-b1-b2.json`, `tr-a1-a2.json`, `tr-b1-b2.json`
- Create: `apps/web/content/writing-guides/index.ts`
- Test: `apps/web/content/writing-guides/writing-guides.test.ts`

**Interfaces:**
- Produces:
  - `type WritingGuideBand = 'a1-a2' | 'b1-b2'`
  - `const WRITING_GUIDE_BANDS: readonly WritingGuideBand[]` (`['a1-a2', 'b1-b2']`)
  - `const WRITING_GUIDE_SECTION_IDS: readonly string[]` (the seven ids, in order)
  - `function bandForLevel(level: CefrLevel): WritingGuideBand`
  - `function isWritingGuideBand(value: unknown): value is WritingGuideBand`
  - `function getWritingGuide(language: LearningLanguage, band: WritingGuideBand): TheoryTopicJson`
  - `const WRITING_GUIDE_BAND_LABELS: Record<WritingGuideBand, string>` (`{ 'a1-a2': 'A1–A2', 'b1-b2': 'B1–B2' }`)

- [ ] **Step 1: Write the failing test**

`apps/web/content/writing-guides/writing-guides.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CefrLevel, Language, parseTheoryTopicJson, type LearningLanguage } from '@language-drill/shared';
import {
  WRITING_GUIDE_BANDS,
  WRITING_GUIDE_SECTION_IDS,
  WRITING_GUIDE_BAND_LABELS,
  bandForLevel,
  getWritingGuide,
  isWritingGuideBand,
} from './index';

const LANGUAGES: LearningLanguage[] = [Language.ES, Language.DE, Language.TR];

describe('writing guides', () => {
  for (const language of LANGUAGES) {
    for (const band of WRITING_GUIDE_BANDS) {
      describe(`${language} ${band}`, () => {
        const guide = getWritingGuide(language, band);

        it('is a valid theory topic', () => {
          expect(() => parseTheoryTopicJson(guide)).not.toThrow();
        });

        it('is identified by language and band', () => {
          expect(guide.id).toBe(`${language.toLowerCase()}-${band}`);
          expect(guide.cefr).toBe(WRITING_GUIDE_BAND_LABELS[band]);
        });

        it('has exactly the seven guide sections, in order', () => {
          expect(guide.sections.map((s) => s.id)).toEqual([...WRITING_GUIDE_SECTION_IDS]);
        });

        it('includes at least one target-language example in the model and mistakes sections', () => {
          for (const id of ['paragraph-shape', 'common-mistakes']) {
            const section = guide.sections.find((s) => s.id === id)!;
            const json = JSON.stringify(section.body);
            expect(json, id).toContain('"kind":"example"');
          }
        });
      });
    }
  }
});

describe('bandForLevel', () => {
  it.each([
    [CefrLevel.A1, 'a1-a2'],
    [CefrLevel.A2, 'a1-a2'],
    [CefrLevel.B1, 'b1-b2'],
    [CefrLevel.B2, 'b1-b2'],
    [CefrLevel.C1, 'b1-b2'],
    [CefrLevel.C2, 'b1-b2'],
  ])('%s → %s', (level, band) => {
    expect(bandForLevel(level)).toBe(band);
  });
});

describe('isWritingGuideBand', () => {
  it('accepts only the two bands', () => {
    expect(isWritingGuideBand('a1-a2')).toBe(true);
    expect(isWritingGuideBand('b1-b2')).toBe(true);
    for (const v of ['c1', '', 'A1-A2', null, undefined, 3]) {
      expect(isWritingGuideBand(v)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run content/writing-guides`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Write the registry**

`apps/web/content/writing-guides/index.ts`:

```ts
// Free-writing guides — one hand-authored theory topic per language × level
// band, read before an attempt (/drill/free-writing/guide). Content is the
// grammar-theory JSON format so the theory renderer draws it unchanged; each
// file is parsed once here so a malformed guide fails at import and in tests,
// never silently at render.
import {
  CefrLevel,
  Language,
  parseTheoryTopicJson,
  type LearningLanguage,
  type TheoryTopicJson,
} from '@language-drill/shared';
import esA1A2 from './es-a1-a2.json';
import esB1B2 from './es-b1-b2.json';
import deA1A2 from './de-a1-a2.json';
import deB1B2 from './de-b1-b2.json';
import trA1A2 from './tr-a1-a2.json';
import trB1B2 from './tr-b1-b2.json';

export type WritingGuideBand = 'a1-a2' | 'b1-b2';

export const WRITING_GUIDE_BANDS: readonly WritingGuideBand[] = ['a1-a2', 'b1-b2'];

export const WRITING_GUIDE_BAND_LABELS: Record<WritingGuideBand, string> = {
  'a1-a2': 'A1–A2',
  'b1-b2': 'B1–B2',
};

export const WRITING_GUIDE_SECTION_IDS: readonly string[] = [
  'what-is-graded',
  'paragraph-shape',
  'connectors',
  'register',
  'task-and-length',
  'common-mistakes',
  'checklist',
];

const GUIDES: Record<LearningLanguage, Record<WritingGuideBand, TheoryTopicJson>> = {
  [Language.ES]: { 'a1-a2': parseTheoryTopicJson(esA1A2), 'b1-b2': parseTheoryTopicJson(esB1B2) },
  [Language.DE]: { 'a1-a2': parseTheoryTopicJson(deA1A2), 'b1-b2': parseTheoryTopicJson(deB1B2) },
  [Language.TR]: { 'a1-a2': parseTheoryTopicJson(trA1A2), 'b1-b2': parseTheoryTopicJson(trB1B2) },
};

export function bandForLevel(level: CefrLevel): WritingGuideBand {
  return level === CefrLevel.A1 || level === CefrLevel.A2 ? 'a1-a2' : 'b1-b2';
}

export function isWritingGuideBand(value: unknown): value is WritingGuideBand {
  return value === 'a1-a2' || value === 'b1-b2';
}

export function getWritingGuide(language: LearningLanguage, band: WritingGuideBand): TheoryTopicJson {
  return GUIDES[language][band];
}
```

If `Record<LearningLanguage, …>` fails typecheck because `LearningLanguage` has more members than ES/DE/TR, stop and report — do not widen to `Partial`; the spec requires every learning language to have both guides.

- [ ] **Step 4: Author the six guides**

Each file is one `TheoryTopicJson`. Shape (abbreviated — every section must be fully written):

```json
{
  "id": "es-b1-b2",
  "title": "Writing a paragraph in Spanish",
  "subtitle": "How to write an opinion or argument paragraph at B1–B2 — what the grader looks for and how to deliver it.",
  "cefr": "B1–B2",
  "sections": [
    {
      "id": "what-is-graded",
      "title": "what the grader looks for",
      "body": [
        { "kind": "paragraph", "text": [{ "kind": "text", "text": "Every attempt is scored on four criteria…" }] },
        { "kind": "list", "items": [
          [{ "kind": "paragraph", "text": [{ "kind": "strong", "children": [{ "kind": "text", "text": "Task" }] }, { "kind": "text", "text": " — did you answer the prompt, cover every required element, and stay inside the word range?" }] }]
        ] }
      ]
    },
    {
      "id": "paragraph-shape",
      "title": "the shape of a paragraph",
      "body": [
        { "kind": "example", "target": [{ "kind": "text", "text": "En mi opinión, el teletrabajo…" }], "en": "In my opinion, remote work…", "note": [{ "kind": "text", "text": "Opening sentence: states the position." }] }
      ]
    }
  ]
}
```

Section titles are lowercase like the grammar theory pages. Content requirements per section (all six guides; band-appropriate vocabulary and length):

1. `what-is-graded`: paragraph + list of the four criteria (task, coherence, lexis, grammar) in plain words; a callout with the word range and timer for **both** levels of the band (A1 30–60/10 min + A2 60–100/15 min; or B1 80–120/15 min + B2 150–200/25 min).
2. `paragraph-shape`: opening sentence → 2–3 supporting points (each with a reason or example) → closing sentence. One complete model paragraph at the band's length as consecutive `example` blocks (one per sentence, each with `en` and a `note` naming its role), on a generic topic (A1–A2: my weekend / my city; B1–B2: an opinion such as remote work or social media).
3. `connectors`: a `list` grouped by job — adding, contrasting, cause/effect, giving an example, sequencing/concluding — each with 2–4 connectors in `mono` and one `example`. A1–A2 core set (ES y, pero, porque, también, primero, después; DE und, aber, weil, auch, zuerst, dann; TR ve, ama, çünkü, de/da, önce, sonra). B1–B2 adds range (ES sin embargo, por lo tanto, además, por ejemplo, en conclusión, aunque; DE trotzdem, deshalb, außerdem, zum Beispiel, obwohl, zusammenfassend; TR ancak, bu yüzden, ayrıca, örneğin, sonuç olarak, -sa bile / rağmen). A `warn` callout for word-order or form effects: DE `weil`/`dass`/`obwohl` send the verb to the end and `deshalb`/`trotzdem` take the verb in second position (inversion); ES `aunque` + subjunctive for hypothetical concession (B1–B2 only); TR clause-final connectors and suffixes (`-dığı için`, `-mesine rağmen`, B1–B2 only).
4. `register`: informal / neutral / formal in practice — ES tú vs usted (verb forms change), DE du vs Sie (capitalised, verb forms), TR sen vs siz (and `-sınız` forms); opening and closing formulas for an informal message and a formal letter/email, as `example` blocks (e.g. ES "Querida Ana:" / "Estimado señor López:" / "Un abrazo" / "Atentamente"; DE "Liebe Anna," / "Sehr geehrte Damen und Herren," / "Viele Grüße" / "Mit freundlichen Grüßen"; TR "Sevgili Ayşe," / "Sayın Yetkili," / "Görüşmek üzere" / "Saygılarımla").
5. `task-and-length`: make each required element visibly present (one sentence per element, use the element's own key word); plan before writing (list the elements, assign each a sentence); count words; what to do if short (add a reason or example) or long (cut repetition).
6. `common-mistakes`: 4–6 mistakes the grader flags most at this band, each as an `example` whose `target` shows the corrected sentence (with the wrong form in the `note`, e.g. "not: *Soy cansado*") and `en` gloss. ES: ser/estar, gender/number agreement, missing accents, (B1–B2) subjunctive after *no creo que* / *es importante que*, por/para. DE: verb in second position, verb-final in subordinate clauses, (A1–A2) article gender, (B1–B2) case after prepositions / two-way prepositions, separable verbs. TR: vowel harmony in suffixes, consonant mutation (kitap → kitabı), verb-final order, (B1–B2) `-dığı`/`-acağı` relative clauses, accusative on definite objects.
7. `checklist`: a `list` of 5–6 checks: every required element present; inside the word range; opening and closing sentence; at least N connectors (A1–A2: 2; B1–B2: 4, including one contrast); register consistent throughout; reread for the mistakes in the previous section.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/web exec vitest run content/writing-guides`
Expected: PASS (6 guides × 4 tests + 6 + 1).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @language-drill/web exec tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/content/writing-guides
git commit -m "Add free-writing guides for ES/DE/TR at A1–A2 and B1–B2"
```

### Task 2: Language-accuracy review

**Files:**
- Modify: `apps/web/content/writing-guides/{es,de,tr}-{a1-a2,b1-b2}.json`

**Interfaces:**
- Consumes: the six guide files from Task 1. Must keep the structure rules (Task 1's tests).

- [ ] **Step 1: Dispatch one independent reviewer per language (three in parallel)**

Each reviewer gets the two guides for its language and this brief: "You are a native-level teacher of <language> for English speakers. Review these two learner guides (A1–A2 and B1–B2) for: (1) any ungrammatical or unidiomatic target-language example; (2) any incorrect rule; (3) English glosses that mistranslate; (4) content not appropriate for the band (too advanced for A1–A2, too trivial for B1–B2); (5) any claim about connectors, word order or register that is wrong or oversimplified to the point of misleading. Report each finding with the file, section id, the exact text, the problem and the corrected text. Do not edit files."

- [ ] **Step 2: Apply the findings**

For each finding, edit the JSON. Where a reviewer is uncertain or two readings are both acceptable, keep the simpler form and note it in the PR description for the user's final read.

- [ ] **Step 3: Re-run the content tests**

Run: `pnpm --filter @language-drill/web exec vitest run content/writing-guides`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/content/writing-guides
git commit -m "Fix language-accuracy findings in the free-writing guides"
```

### Task 3: Guide page

**Files:**
- Create: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-guide.tsx`
- Create: `apps/web/app/(dashboard)/drill/free-writing/guide/page.tsx`
- Test: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-guide.test.tsx`
- Test: `apps/web/app/(dashboard)/drill/free-writing/guide/page.test.tsx`

**Interfaces:**
- Consumes (Task 1): `getWritingGuide`, `bandForLevel`, `isWritingGuideBand`, `WRITING_GUIDE_BANDS`, `WRITING_GUIDE_BAND_LABELS`, `type WritingGuideBand` from `apps/web/content/writing-guides`.
- Produces: `FwGuide({ language: LearningLanguage; band: WritingGuideBand; onBandChange: (band: WritingGuideBand) => void })`; route `/drill/free-writing/guide` accepting `?band=a1-a2|b1-b2`.

- [ ] **Step 1: Write the failing component test**

`fw-guide.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Language } from '@language-drill/shared';
import { FwGuide } from './fw-guide';
import { getWritingGuide } from '../../../../../content/writing-guides';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

function renderGuide(props: Partial<Parameters<typeof FwGuide>[0]> = {}) {
  const onBandChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FwGuide language={Language.ES} band="b1-b2" onBandChange={onBandChange} {...props} />
    </QueryClientProvider>,
  );
  return { onBandChange };
}

describe('FwGuide', () => {
  it('renders the guide title, band chip and all seven sections', () => {
    renderGuide();
    const guide = getWritingGuide(Language.ES, 'b1-b2');
    expect(screen.getByRole('heading', { level: 1, name: guide.title })).toBeInTheDocument();
    for (const section of guide.sections) {
      expect(screen.getByRole('heading', { level: 3, name: section.title })).toBeInTheDocument();
    }
  });

  it('shows the guide for the given language and band', () => {
    renderGuide({ language: Language.DE, band: 'a1-a2' });
    expect(
      screen.getByRole('heading', { level: 1, name: getWritingGuide(Language.DE, 'a1-a2').title }),
    ).toBeInTheDocument();
  });

  it('marks the current band and switches to the other', () => {
    const { onBandChange } = renderGuide({ band: 'b1-b2' });
    expect(screen.getByRole('button', { name: 'B1–B2' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'A1–A2' }));
    expect(onBandChange).toHaveBeenCalledWith('a1-a2');
  });

  it('links back to free writing', () => {
    renderGuide();
    expect(screen.getByRole('link', { name: /free writing/ })).toHaveAttribute('href', '/drill/free-writing');
  });

  it('has a section table of contents but no grammar topic list', () => {
    renderGuide();
    expect(screen.getByRole('navigation', { name: 'theory sections' })).toBeInTheDocument();
    expect(screen.queryByText('all topics')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/drill/free-writing/_components/fw-guide"`
Expected: FAIL — cannot resolve `./fw-guide`.

- [ ] **Step 3: Implement `FwGuide`**

`fw-guide.tsx`:

```tsx
'use client';

import { useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import type { LearningLanguage } from '@language-drill/shared';
import { useScrollSpy } from '../../../../../lib/hooks/use-scroll-spy';
import { useSuppressShellFooter } from '../../../../../components/shell/shell-footer-context';
import { AppFooter } from '../../../../../components/shell/app-footer';
import { Chip } from '../../../../../components/ui/chip';
import { TheoryToc } from '../../../../../components/theory/theory-toc';
import { TheorySections } from '../../../../../components/theory/theory-sections';
import { renderTheoryTopicJson } from '../../../../../components/theory/render-json';
import {
  getWritingGuide,
  WRITING_GUIDE_BANDS,
  WRITING_GUIDE_BAND_LABELS,
  type WritingGuideBand,
} from '../../../../../content/writing-guides';

export interface FwGuideProps {
  language: LearningLanguage;
  band: WritingGuideBand;
  onBandChange: (band: WritingGuideBand) => void;
}

const noop = () => {};

// How to write a free-writing paragraph in one language at one level band.
// Laid out like the grammar theory detail page (same CSS, TOC, sections) but
// static: the content ships in the bundle. TheoryToc gets no fetchFn, so its
// "all topics" grammar list is hidden and never fetched.
export function FwGuide({ language, band, onBandChange }: FwGuideProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const topic = useMemo(() => renderTheoryTopicJson(getWritingGuide(language, band)), [language, band]);
  const sectionIds = topic.sections.map((s) => s.id);
  const activeSectionId = useScrollSpy(sectionIds, scrollRef);

  // The article scrolls inside `.theory-scroll`; render the footer there.
  useSuppressShellFooter(true);

  const handleJump = useCallback((id: string) => {
    const target = scrollRef.current?.querySelector(`#${CSS.escape(id)}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="theory-detail">
      <header className="theory-detail-header">
        <Link href="/drill/free-writing" className="theory-detail-back t-small text-ink-soft hover:text-ink">
          ← free writing
        </Link>
        <div className="t-micro" style={{ marginTop: 8 }}>
          free writing · guide
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
          <h1 className="t-display-l" style={{ margin: 0 }}>
            {topic.title}
          </h1>
          <Chip>{topic.cefr}</Chip>
        </div>
        <div
          style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 6 }}
        >
          <div className="t-small" style={{ flex: '1 1 260px' }}>
            {topic.subtitle}
          </div>
          <div role="group" aria-label="level band" style={{ display: 'flex', gap: 6 }}>
            {WRITING_GUIDE_BANDS.map((b) => (
              <button
                key={b}
                type="button"
                className={b === band ? 'btn sm primary' : 'btn sm ghost'}
                aria-pressed={b === band}
                onClick={() => b !== band && onBandChange(b)}
              >
                {WRITING_GUIDE_BAND_LABELS[b]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="theory-detail-body theory-body">
        <TheoryToc
          topic={topic}
          activeSectionId={activeSectionId}
          onJump={handleJump}
          language={language}
          currentTopicId={topic.id}
          onSwitchTopic={noop}
        />
        <div ref={scrollRef} className="theory-scroll">
          <TheorySections topic={topic} language={language} onSwitchTopic={noop} />
          <div style={{ height: 40 }} aria-hidden="true" />
          <AppFooter />
        </div>
      </div>
    </div>
  );
}
```

The `.btn`, `.btn.sm`, `.btn.primary` and `.btn.ghost` classes are defined in `drill/free-writing/free-writing.css`, **not** globally — the guide page (Step 7) imports that stylesheet, as the other free-writing routes do. The theory classes (`.theory-detail`, `.theory-toc`, …) are global (`app/globals.css`).

- [ ] **Step 4: Run the component test**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/drill/free-writing/_components/fw-guide"`
Expected: PASS (5 tests). If `AppFooter` or `useSuppressShellFooter` needs a provider in tests, mirror how `app/(dashboard)/theory/_components/__tests__/theory-detail.test.tsx` mounts `TheoryDetail` (mock or wrap identically).

- [ ] **Step 5: Write the failing page test**

`guide/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import FreeWritingGuidePage from './page';

const mockUseLanguageProfiles = vi.fn();
const mockReplace = vi.fn();
let mockSearch = '';
let mockActiveLanguage: Language = Language.ES;
const mockFwGuide = vi.fn();

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('@language-drill/api-client', () => ({
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
vi.mock('../../../../../components/shell', () => ({
  useActiveLanguage: () => ({ activeLanguage: mockActiveLanguage }),
}));
vi.mock('../_components/fw-guide', () => ({
  FwGuide: (props: { language: Language; band: string; onBandChange: (b: string) => void }) => {
    mockFwGuide(props);
    return (
      <button type="button" onClick={() => props.onBandChange('a1-a2')}>
        guide {props.language} {props.band}
      </button>
    );
  },
}));

function profiles(level: CefrLevel | null, language: Language = Language.ES) {
  return {
    data: level ? { profiles: [{ language, proficiencyLevel: level }] } : { profiles: [] },
    isPending: false,
  };
}

beforeEach(() => {
  mockSearch = '';
  mockActiveLanguage = Language.ES;
  mockReplace.mockReset();
  mockFwGuide.mockReset();
});

describe('FreeWritingGuidePage', () => {
  it('picks the band from the profile level', () => {
    mockUseLanguageProfiles.mockReturnValue(profiles(CefrLevel.A2));
    render(<FreeWritingGuidePage />);
    expect(screen.getByText('guide ES a1-a2')).toBeInTheDocument();
  });

  it('defaults to B1–B2 when the language has no profile', () => {
    mockUseLanguageProfiles.mockReturnValue(profiles(null));
    render(<FreeWritingGuidePage />);
    expect(screen.getByText('guide ES b1-b2')).toBeInTheDocument();
  });

  it('follows the active language', () => {
    mockActiveLanguage = Language.DE;
    mockUseLanguageProfiles.mockReturnValue(profiles(CefrLevel.A1, Language.DE));
    render(<FreeWritingGuidePage />);
    expect(screen.getByText('guide DE a1-a2')).toBeInTheDocument();
  });

  it('honours a valid ?band= over the profile', () => {
    mockSearch = 'band=a1-a2';
    mockUseLanguageProfiles.mockReturnValue(profiles(CefrLevel.B2));
    render(<FreeWritingGuidePage />);
    expect(screen.getByText('guide ES a1-a2')).toBeInTheDocument();
  });

  it.each(['band=c1', 'band=', 'band=A1-A2'])('ignores an invalid %s', (search) => {
    mockSearch = search;
    mockUseLanguageProfiles.mockReturnValue(profiles(CefrLevel.B2));
    render(<FreeWritingGuidePage />);
    expect(screen.getByText('guide ES b1-b2')).toBeInTheDocument();
  });

  it('waits for profiles instead of flashing the default band', () => {
    mockUseLanguageProfiles.mockReturnValue({ data: undefined, isPending: true });
    render(<FreeWritingGuidePage />);
    expect(mockFwGuide).not.toHaveBeenCalled();
    expect(screen.getByText('loading…')).toBeInTheDocument();
  });

  it('does not wait for profiles when ?band= is given', () => {
    mockSearch = 'band=b1-b2';
    mockUseLanguageProfiles.mockReturnValue({ data: undefined, isPending: true });
    render(<FreeWritingGuidePage />);
    expect(screen.getByText('guide ES b1-b2')).toBeInTheDocument();
  });

  it('writes a band switch to the URL with replace', () => {
    mockUseLanguageProfiles.mockReturnValue(profiles(CefrLevel.B2));
    render(<FreeWritingGuidePage />);
    screen.getByText('guide ES b1-b2').click();
    expect(mockReplace).toHaveBeenCalledWith('/drill/free-writing/guide?band=a1-a2', { scroll: false });
  });
});
```

The `useActiveLanguage` mock path must match the import used by the page (`'../../../../../components/shell'` from `guide/page.tsx`). `useSearchParams` is mocked, so the page's Suspense wrapper renders straight through.

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/drill/free-writing/guide"`
Expected: FAIL — cannot resolve `./page`.

- [ ] **Step 7: Implement the page**

`guide/page.tsx`:

```tsx
'use client';

import { Suspense, useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { CefrLevel } from '@language-drill/shared';
import { useLanguageProfiles, createAuthenticatedFetch } from '@language-drill/api-client';
import { useActiveLanguage } from '../../../../../components/shell';
import { FwGuide } from '../_components/fw-guide';
import {
  bandForLevel,
  isWritingGuideBand,
  type WritingGuideBand,
} from '../../../../../content/writing-guides';
import '../free-writing.css';

const GUIDE_PATH = '/drill/free-writing/guide';

function FreeWritingGuide() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeLanguage } = useActiveLanguage();
  const profiles = useLanguageProfiles({ fetchFn });

  const requested = searchParams.get('band');
  const override = isWritingGuideBand(requested) ? requested : null;

  // Without an explicit band, wait for the profile so the page never renders
  // the default band and then jumps to the learner's real one.
  if (!override && profiles.isPending) {
    return <div className="t-body" style={{ padding: 24 }}>loading…</div>;
  }

  // Same resolution as the free-writing page: profile level for the active
  // language, defaulting to B1 — so the brief and its guide always agree.
  const level =
    (profiles.data?.profiles.find((p) => p.language === activeLanguage)?.proficiencyLevel as CefrLevel) ??
    CefrLevel.B1;
  const band = override ?? bandForLevel(level);

  const onBandChange = (next: WritingGuideBand) => {
    router.replace(`${GUIDE_PATH}?band=${next}`, { scroll: false });
  };

  return <FwGuide language={activeLanguage} band={band} onBandChange={onBandChange} />;
}

// `useSearchParams()` opts this client page out of static prerendering; Next
// requires that bailout to sit under a Suspense boundary.
export default function FreeWritingGuidePage() {
  return (
    <Suspense fallback={<div className="t-body" style={{ padding: 24 }}>loading…</div>}>
      <FreeWritingGuide />
    </Suspense>
  );
}
```

- [ ] **Step 8: Run the page and component tests**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/drill/free-writing"`
Expected: PASS (all free-writing tests, including the existing ones).

- [ ] **Step 9: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/_components/fw-guide.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-guide.test.tsx" "apps/web/app/(dashboard)/drill/free-writing/guide"
git commit -m "Add the free-writing guide page"
```

### Task 4: Link the guide from the brief

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-brief.tsx` (props interface; right-rail `<aside>`, between the "graded on" card and the "feeds" card)
- Modify: `apps/web/app/(dashboard)/drill/free-writing/page.tsx` (pass `guideHref`)
- Test: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-brief.test.tsx`

**Interfaces:**
- Produces: `FwBriefProps.guideHref?: string` (omitted → no card).

- [ ] **Step 1: Write the failing test** (add to `fw-brief.test.tsx`, beside the existing `historyHref` test)

```tsx
  it('shows the writing-guide card only when given a guide href', () => {
    const { rerender } = render(
      <FwBrief content={content} examMode={false} onToggleExam={() => {}} onBegin={() => {}} />,
    );
    expect(screen.queryByRole('link', { name: /how to write this/i })).toBeNull();
    rerender(
      <FwBrief
        content={content}
        examMode={false}
        onToggleExam={() => {}}
        onBegin={() => {}}
        guideHref="/drill/free-writing/guide"
      />,
    );
    expect(screen.getByRole('link', { name: /how to write this/i })).toHaveAttribute(
      'href',
      '/drill/free-writing/guide',
    );
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/drill/free-writing/_components/fw-brief"`
Expected: FAIL — link not found.

- [ ] **Step 3: Implement**

In `FwBriefProps` add:

```ts
  /** Link to the writing guide for this language and level; omitted → no card. */
  guideHref?: string;
```

Destructure `guideHref` in `FwBrief`'s signature. In the right-rail `<aside>`, after the closing `</div>` of the "graded on" card and before the "feeds" card, insert:

```tsx
          {guideHref && (
            <div className="card" style={{ padding: 18 }}>
              <div className="rv-h" style={{ marginBottom: 6 }}>
                before you write
              </div>
              <div className="t-small" style={{ marginBottom: 10 }}>
                how a good paragraph is built, the connectors and register to use, and the
                mistakes the grader flags most.
              </div>
              <Link href={guideHref} className="t-mono text-[13px] text-ink-soft hover:text-ink">
                how to write this <span className="lk-arr" aria-hidden="true">→</span>
              </Link>
            </div>
          )}
```

In `drill/free-writing/page.tsx`, add to the `<FwBrief>` props next to `historyHref`:

```tsx
          guideHref="/drill/free-writing/guide"
```

- [ ] **Step 4: Run the free-writing tests**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/drill/free-writing"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/_components/fw-brief.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-brief.test.tsx" "apps/web/app/(dashboard)/drill/free-writing/page.tsx"
git commit -m "Link the writing guide from the free-writing brief"
```

### Task 5: Visual verification and full suite

**Files:** none changed unless a defect is found.

- [ ] **Step 1: Prepare the worktree** — copy `/.env` and `apps/web/.env` from the main checkout if missing; `pnpm install` and `pnpm build --filter='./packages/*'` if not done.

- [ ] **Step 2: Screenshots** (no API needed — content is static; the brief needs an exercise, so shoot it `--full-stack` with `pnpm dev:api` running and `NEXT_PUBLIC_API_URL=http://localhost:3001`):

```bash
cd apps/web
SHOOT_OUT=guide-desktop pnpm shoot --route '/drill/free-writing/guide?band=b1-b2' --wait 'text=what the grader looks for'
SHOOT_OUT=guide-mobile pnpm shoot --route '/drill/free-writing/guide?band=a1-a2' --viewport mobile --wait 'text=what the grader looks for'
NEXT_PUBLIC_API_URL=http://localhost:3001 SHOOT_OUT=brief-guide-card pnpm shoot --route /drill/free-writing --full-stack --wait 'text=how to write this'
```

The e2e user's active language is German; to also shoot Spanish, temporarily add an `active_language=ES` cookie in `e2e/shoot.spec.ts` (see memory note "Shoot a non-German language") and revert it after. Check: header and band switch fit at mobile width with no horizontal scroll; TOC shows the seven sections and no "all topics"; examples render; the footer sits at the end of the scroller.

- [ ] **Step 3: Restore `next dev` artefacts** — `git checkout apps/web/next-env.d.ts apps/web/AGENTS.md` if modified.

- [ ] **Step 4: Full suite from the repo root**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green. Report counts; re-run any failure in an unrelated file in isolation before calling it a flake.

- [ ] **Step 5: Commit any fixes** from Steps 2–4 with a message naming the defect.
