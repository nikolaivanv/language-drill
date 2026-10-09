# Free-writing guide — design

**Status:** approved in chat 2026-10-09; awaiting written-spec review.

## Problem

Free writing lets a learner practise and get graded feedback, but nothing tells
them *how* to write such a text before they try. The grader scores four
IELTS-style criteria (task, coherence, lexis, grammar), and the only statement
of what "good" means is one generic line per CEFR level inside the evaluator
prompt. A learner meets those expectations for the first time in their score.

## Goal

A read-before-you-write guide, visually like the grammar theory pages, that
explains how to write a good free-writing paragraph in the learner's language at
their level — and is one click from the brief.

**Success:** from the free-writing brief, a learner opens a guide for their
active language and level band, reads concrete, language-specific guidance
mapped to what the grader scores, and returns to the brief.

## Decisions (agreed in chat)

| Question | Decision | Rejected |
| --- | --- | --- |
| Granularity | One guide per **language × level band** | Per text type (prompts carry no text-type field); per-prompt tips (overlap the existing writing helpers) |
| Source | **Hand-authored JSON in the repo**, drafted by Claude, reviewed by the user | Generated + stored like grammar theory (prompt, validator, table rows — too much machinery for six pages) |
| Placement | **Inside free writing** at `/drill/free-writing/guide`, linked from the brief | A "writing" group in `/theory` (library grouping, search and drill links are grammar-point-shaped) |

## Scope

Six guides: languages `ES`, `DE`, `TR` (the `LearningLanguage`s) × bands
`a1-a2`, `b1-b2`.

Level → band: `A1`, `A2` → `a1-a2`; `B1`, `B2`, `C1`, `C2` → `b1-b2`. The guide
resolves the level exactly as `drill/free-writing/page.tsx` does (the profile
level for the active language, defaulting to `B1`, hence `b1-b2`), so the brief
and the guide always agree.

**Out of scope:** an English guide; per-text-type guides; linking guide sections
from evaluator feedback; the brief's hardcoded copy ("address a general reader;
avoid colloquialisms" shown for every register, "DELE" shown for every language)
— a separate small fix.

## Content

Each guide is a `TheoryTopicJson` (`packages/shared/src/theory.ts`) — the same
format grammar theory uses — so it is validated by `parseTheoryTopicJson` and
rendered by `renderTheoryTopicJson` with no new block kinds. Explanations are in
English; examples are in the target language with an English gloss (the
`example` block's `target` + `en`).

Top-level fields: `id` (`<lang>-<band>`, e.g. `es-b1-b2`), `title` (e.g.
"Writing a paragraph in Spanish"), `subtitle` (one line naming the band and the
kind of text), `cefr` (`"A1–A2"` / `"B1–B2"`, shown in the header chip).

Every guide has the **same seven sections, with these ids**, so the structure is
enforced by a test while the content is per language and band:

1. `what-is-graded` — **What the grader looks for.** The four criteria in plain
   language, and the band's word ranges and timer from
   `FREE_WRITING_LENGTH_BY_CEFR` (A1 30–60 / 10 min, A2 60–100 / 15, B1 80–120 /
   15, B2 150–200 / 25 — a band guide states both of its levels).
2. `paragraph-shape` — **The shape of a paragraph.** Opening sentence → supporting
   points → closing sentence, with one short model paragraph at the band's
   length, annotated (callout or list) and glossed.
3. `connectors` — **Connectors by job.** Adding, contrasting, cause/effect,
   giving an example, concluding. `a1-a2`: a small core set (y/pero/porque;
   und/aber/weil; ve/ama/çünkü). `b1-b2`: wider range (sin embargo, por lo tanto;
   trotzdem, deshalb; ancak, bu yüzden). Flags connectors that change word order
   or require a form (DE `weil`/`dass` → verb-final; ES `aunque` + subjunctive
   at B1–B2; TR clause-final connectors and converbs).
4. `register` — **Register.** What informal / neutral / formal mean in practice
   (tú/usted, du/Sie, sen/siz), plus opening and closing formulas for letters
   and emails.
5. `task-and-length` — **Required elements and length.** Making each required
   element visibly present; staying inside the word band.
6. `common-mistakes` — **Common mistakes in <language>.** What the grader flags
   most at this band, with wrong → right examples (e.g. ES ser/estar, accents,
   subjunctive after *no creo que*; DE verb-second, verb-final after `weil`/`dass`,
   case after prepositions; TR vowel harmony in suffixes, verb-final order,
   `-dığı` clauses).
7. `checklist` — **Checklist before you submit.** Five or six quick checks.

### Accuracy review

Claude drafts all six. Before the PR, each guide gets an **independent
language-accuracy review** by a separate reviewer agent per language (grammar of
every example, correctness of every rule stated, band-appropriateness). Findings
are fixed in the JSON. The user does the final read — this matters most for TR
and DE, where the author's own level is lower.

## Architecture

All web; no API, database, migration or Langfuse change. The content ships in
the web bundle (six small JSON files).

```
apps/web/content/writing-guides/
  es-a1-a2.json  es-b1-b2.json
  de-a1-a2.json  de-b1-b2.json
  tr-a1-a2.json  tr-b1-b2.json
  index.ts                 — registry + band mapping
  writing-guides.test.ts   — content validation
```

**`index.ts`** exports:
- `type WritingGuideBand = 'a1-a2' | 'b1-b2'`
- `bandForLevel(level: CefrLevel): WritingGuideBand`
- `getWritingGuide(language: LearningLanguage, band: WritingGuideBand): TheoryTopicJson`
  — returns the parsed guide (parsed once via `parseTheoryTopicJson`, so a
  malformed file fails loudly in tests and at import, never silently at render).
- `WRITING_GUIDE_SECTION_IDS` — the seven ids above, in order.

**Route** `apps/web/app/(dashboard)/drill/free-writing/guide/page.tsx` (client
component, like the other free-writing pages): resolves the active language
(`useActiveLanguage`) and level (`useLanguageProfiles`, default `B1`), reads an
optional `?band=a1-a2|b1-b2` override (invalid values ignored), and renders
`FwGuide`.

**`FwGuide`** (`drill/free-writing/_components/fw-guide.tsx`) — presentational,
props `{ language, band, onBandChange }`:
- Reuses the grammar page's look: the `.theory-detail` / `.theory-detail-body` /
  `.theory-scroll` classes and the theory CSS, `TheorySections`, and
  `renderTheoryTopicJson`.
- Header: "← free writing" (link to `/drill/free-writing`), micro "free writing ·
  guide", `t-display-l` title, CEFR chip, subtitle, and a two-option band switch
  ("A1–A2 / B1–B2"). Switching updates `?band=` with `router.replace` (no
  history spam) and the guide re-renders.
- Left: a table of contents with scroll-spy over the seven sections, **without**
  `TheoryToc`'s "other topics" list (that list fetches and links grammar
  topics). The implementation plan picks between a prop on `TheoryToc` that
  hides the topic list and skips its fetch, or a small dedicated TOC; whichever
  keeps `TheoryToc`'s grammar behaviour unchanged with the smaller diff.
- Mobile: same responsive behaviour as the theory detail page (TOC collapses;
  the topic switcher sheet is not used).

**Brief link** — `fw-brief.tsx` right rail gets a third card between "graded
on" and "feeds": a one-line pitch and a "how to write this →" link to
`/drill/free-writing/guide`. Optional prop `guideHref` (omitted → no card),
passed by `drill/free-writing/page.tsx`, mirroring how `historyHref` works.

## Error handling

There is no runtime failure path: content is static and validated at build/test
time. A language with no guide cannot occur (all `LearningLanguage`s are covered
and the test enforces it). An unknown `?band=` falls back to the profile band.

## Testing

- `writing-guides.test.ts`: every `LearningLanguage` × band exists; each parses
  with `parseTheoryTopicJson`; each has exactly `WRITING_GUIDE_SECTION_IDS` in
  order; `id` matches the file name; `cefr` matches the band; `bandForLevel`
  covers all levels.
- `fw-guide.test.tsx`: renders title, chip and all seven section headings;
  band switch calls `onBandChange`; back link targets `/drill/free-writing`.
- Guide page test: picks the band from the profile level (A2 → `a1-a2`, B2 →
  `b1-b2`), honours a valid `?band=`, ignores an invalid one, follows the active
  language.
- `fw-brief.test.tsx`: guide card renders only with `guideHref`, link target.
- TOC: if `TheoryToc` gains a prop, a test that the topic list and its fetch are
  absent when hidden, and existing theory TOC tests still pass.
- `pnpm shoot` (full-stack not needed — no API): a guide on desktop and mobile,
  in ES and one other language, and the brief card.
