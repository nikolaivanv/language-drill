# Book-Coverage Ledger — Design (2026-07-15)

**Goal:** make reference-grammar coverage of each curriculum a durable, test-enforced
ledger instead of a one-shot prose audit, so construction-level gaps (like the
`es-b2-remote-conditionals` one) surface as unclaimed rows rather than survive
review.

## Motivation — why the existing audits miss gaps

The reverse-coverage audits (TR/G&K 2026-06-20, ES/B&B 2026-07-09, DE/Hammer
2026-07-12) walk the reference grammar chapter by chapter and list what the
curriculum is missing. ES's audit added 22 points and **still missed B&B ch. 29.3
(remote conditionals)**, found only when a user navigated theory with the sentence
*"Yo iría contigo si pudiera"* and discovered both halves existed
(`es-b1-conditional`, `es-b2-past-subjunctive`) but no topic taught the
two-clause construction. Two structural weaknesses caused this:

1. **No per-section ledger.** A prose audit records findings, not non-findings.
   "Conditional" and "past subjunctive" both existed, so ch. 29 *looked* covered —
   coverage was judged at the tense/form level, and there is no artifact saying
   "29.3 → claimed by X / excluded because Y" to review or diff.
2. **One-shot, not enforced.** The audit doc goes stale immediately; nothing
   re-checks when points are added, split, re-leveled, or re-scoped — which this
   curriculum does constantly (e.g. the 07-11 preterite split).

## Design

### Ledger format

One TS data module per language in `packages/db/src/curriculum/book-coverage/`
(`es.ts`, `de.ts`, `tr.ts`). Each maps a **book section anchor** (the `anchor`
values from the mirror's `index.json`, e.g. `'29-3'`) to exactly one decision:

```ts
// packages/db/src/curriculum/book-coverage/es.ts
export const ES_BOOK = 'Butt & Benjamin, A New Reference Grammar of Modern Spanish (5th ed.)';

export const ES_BOOK_COVERAGE: Readonly<Record<string, CoverageDecision>> = {
  '29-2':   { points: ['es-a2-si-present-conditional'] },
  '29-3':   { points: ['es-b2-remote-conditionals'] },
  '29-4':   { points: ['es-b2-complex-conditionals'] },
  '29-5':   { excluded: 'colloquial imperfect-for-conditional; noted in es-b2-remote-conditionals commonErrors' },
  '29-8-2': { excluded: 'como = si: C1, regional' },
  '29-9':   { points: ['es-b2-conditional-connectors'] },
  // subtree exclusion: one row covers a whole chapter/section and its children
  'ch00':   { excludedSubtree: 'conventions/front-matter — no grammar content' },
};
```

```ts
// packages/db/src/curriculum/book-coverage/types.ts
export type CoverageDecision =
  | { points: readonly string[] }        // ≥1 curriculum keys own this section
  | { excluded: string }                 // conscious skip, with reason
  | { excludedSubtree: string };         // skip this anchor AND all descendants
```

Conventions:

- **Granularity:** decisions at any level of the book index; a decision on a
  parent (`29-8`) covers nothing implicitly — children still need rows — *unless*
  it is `excludedSubtree`, which covers all descendant anchors. This keeps
  orthography/front-matter chapters to one line while forcing explicit calls on
  content chapters. (ES/B&B: 1,219 sections — 406 level-2 + 813 level-3;
  DE/Hammer: 609; TR/G&K: 551. Subtree exclusions shrink the real row count
  substantially.)
- **Exclusion reasons are short but real** — `'C1+'`, `'regional'`,
  `'receptive-only'`, `'lexical not grammatical'`, `'folded into <key>'s
  commonErrors'`. The ledger's value is that every section got a *conscious*
  decision, not 100% coverage; PCIC/Goethe/Yedi İklim remain the level-placement
  spine, the book map is the completeness net.
- A section may be claimed by multiple points (split constructions) and a point
  may claim many sections. No `sourceSections` field on `GrammarPoint` — the
  ledger is the single home for the join (keeps curriculum entries lean).

### Vendored TOC snapshot

CI cannot read the book mirrors (they live outside the repo at
`/Users/seal/dev/language-tools/<Lang>/…-grammar-md/`). Each ledger file therefore
also exports the **anchor + title list snapshot** generated from the mirror's
`index.json` at authoring time:

```ts
export const ES_BOOK_TOC: readonly TocEntry[] = [
  { anchor: '29-3', title: '29.3 Remote conditions', level: 2, parent: '29' },
  // … generated, do not hand-edit
];
```

Titles-only, no book text — a TOC snapshot, tiny and static (the mirrors are
frozen EPUB conversions). Completeness against the *actual* book is an
authoring-time property (the generator script reads `index.json`); the in-repo
test is fully self-contained against the snapshot.

### Invariant test

Extend the curriculum test suite (a new `book-coverage.test.ts` in
`packages/db/src/curriculum/`, NOT inside `assertCurriculumInvariants` — the
ledger has no runtime consumer and should not ship in the Lambda path):

1. **Completeness:** every TOC anchor is covered by exactly one decision (its own
   row, or an ancestor `excludedSubtree`). Unclaimed anchor ⇒ test failure naming
   the section title — this is the check that would have caught 29.3.
2. **No dangling keys:** every key in a `points` array exists in that language's
   curriculum. Catches renames/splits/deletions automatically (the most frequent
   churn).
3. **No orphan rows:** every ledger anchor exists in the TOC snapshot (catches
   typos).
4. *(soft, reported not asserted)* curriculum points claiming **zero** sections —
   fine for coursebook-only topics (e.g. themed vocab umbrellas are exempt by
   `kind !== 'grammar'`), but worth a console listing during the retrofit.

Ledger edits do **not** bump `CURRICULUM_VERSION_*` — the ledger is metadata with
no generation-side effect. Only when closing a gap adds/rescopes an actual
curriculum point does the normal version-bump rule apply.

### Authoring workflow (LLM-assisted, human-reviewed)

A CLI in the mold of `propose:coverage-spec` — `pnpm propose:book-coverage
--language es --chapter 29`:

1. Reads the mirror's `index.json` + the chapter markdown + the language's
   curriculum entries (keys, names, descriptions).
2. Asks Claude to propose a decision per section (claim / exclude+reason),
   grounded in the chapter text.
3. Prints a paste-ready ledger fragment for human review and commit. Never writes
   the ledger itself.

Also generates/refreshes the TOC snapshot (`--emit-toc`). Chunked per chapter,
the ES pass is a bounded one-time job (~46 chapters).

## Sequencing

1. **DE pilot (cheapest, do first):** the DE A1–B2 plan
   (`docs/superpowers/plans/2026-07-12-de-a1-b2-curriculum.md`) already annotates
   every point with Hammer `H §x` references — harvest those into
   `book-coverage/de.ts` as the points are authored, then run one
   `propose:book-coverage` pass over the ~609 sections to fill exclusions.
   Recording decisions while authoring is nearly free; reconstructing later is
   the expensive version. Add a ledger task to that plan.
2. **ES retrofit:** run the proposer against the mature ES curriculum (mostly
   classification, little judgment). Expect a handful of genuine gap findings —
   triage them like the 07-09 audit (HIGH → new points, rest → exclusions).
3. **TR:** same, against Göksel & Kerslake. **Note:** the mirror moved to
   `/Users/seal/dev/language-tools/Turkish/turkish-grammar-book/turkish-grammar-md`
   (old top-level `~/dev/turkish-grammar-book` path is gone).

## Non-goals / future

- **Not** 100% book coverage; excluded-with-reason is a first-class success state.
- **Not** runtime data: no scheduler, generation, or API surface reads the ledger.
- **Orphan-sentence probe (future complement):** the ledger is supply-side; this
  gap was found demand-side (a sentence with no owning page). A periodic eval —
  sample level-appropriate sentences, ask which grammar point owns each
  construction, flag unclaimed ones — would catch gap classes the book's own
  structure hides (constructions scattered across chapters). Run occasionally as
  an eval, not built as infrastructure.
