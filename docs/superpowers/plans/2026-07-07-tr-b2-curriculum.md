# TR B2 Curriculum — Implementation Plan

_Design: `docs/superpowers/specs/2026-07-07-tr-b2-curriculum-design.md`._
_One PR, additive only (no key renames → no DB migration)._

## Scope

19 B2 grammar points: 17 from Yedi İklim B2 (Units 1–8, grouped by function,
deduped vs A1–B1) + 2 from the G&K reverse-audit (`tr-b2-dir-generalizing`,
`tr-b2-as-if-gibi`). Grammar only — no B2 vocab/dictation/free-writing umbrellas.

## Steps

1. **Author points** — `packages/db/src/curriculum/tr.ts`: append the 19 points
   after `tr-b1-participles-dik-acak`, before the vocab umbrellas, in spec table
   order. Each carries `description` (≤300 chars), ≥2 positive + ≥1 negative
   (`*`) examples, ≥1 commonError, prereqs, and a G&K `§` anchor comment. Destructure
   `B2` from `CefrLevel`. Finite points (`compound-past-hikaye`,
   `compound-evidential-rivayet`, `double-voice`) get `conjugationSuitable` +
   person/polarity `coverageSpec`; 15 clause-linking/bipartite points get
   `clozeUnsuitable`. ✅
2. **Version + floor** — bump `CURRICULUM_VERSION_TR` (→ `2026-07-09`, with a
   changelog entry) and raise `PER_LANGUAGE_GRAMMAR_MIN.TR.B2` 0 → 19
   (`curriculum/index.ts`). ✅
3. **Theory categories** — add 19 `KEY_TO_CATEGORY` entries in
   `packages/shared/src/theory-categories.ts` and the mirrored
   `EXPECTED_KEY_CATEGORY` in its test. ✅
4. **Curriculum tests** — `curriculum.test.ts`: TR count test `grammar.B2`
   `toBe(0)` → `toBe(19)` (+ title); closed-set clozeUnsuitable list 19 → 34
   (+ title). ✅
5. **Gates** — `pnpm build` (turbo) → `pnpm typecheck` / `pnpm lint` /
   `pnpm test`. All green. ✅

## Not touched (deliberate)

- `packages/db/scripts/seed-exercises.ts` — the sample `tr-*-b2-1` seeds stay
  mapping-disabled (as the B1 seeds are), so no restore needed; also there is no
  B2 vocab umbrella for `tr-vocab-b2-1` to map to. Matches the B1 precedent.
- No `ExerciseType` enum change → no exhaustiveness ripple.
- No prompt edits → nothing to push to Langfuse.

## Post-merge (operator checklist)

1. Nothing to push to Langfuse (no prompt edits).
2. Scheduler enumerates the new B2 cells at the next run, paced by the budget cap.
3. Run theory batch generation for the new B2 grammar points
   (`pnpm generate:theory --batch-seed`).
4. Spot-check per-cell approval rates on the admin pool page after the first run
   (TR runs hot — expect a meaningful flag rate on cloze/translation).

## Follow-up (from the reverse-audit; NOT this cycle)

Confirmed A1–B1 gaps to greenlight as a later cycle: spatial relational
postpositions (evin önünde) [A1/A2, high priority], nominal/adjectival past &
evidential copula (hastaydım) [A2], suppletive `ol-` copula [B1], additive `dA`
[A1/A2], `-lI`/`-sIz` derivational [A2], `bile` / `tane` / `olarak` [lighter].
