# Form-contrast cloze disambiguation + vocab_recall acceptableAnswers

**Date:** 2026-07-16
**Trigger:** 2026-07-16 generation-run analysis. Two chronic low-yield patterns:

1. `es:b2:cloze:es-b2-perception-verbs` approved 2/9 today (19/50 → 10/31 → 8/21 → 2/13 → 2/11 → 2/9 across runs). All 7 of today's flags are the same disease: the generator follows the generic "enumerate near-synonymous alternants in `acceptableAnswers`" rule and lists BOTH the infinitive and the gerund as acceptable — but for this point the two forms are the taught contrast (completed event vs. caught in progress), so accepting both defeats the pedagogy and the validator flags `ambiguous`. Two further drafts dodged the choice by blanking the conjugated perception verb itself (`vi/veía`), which tests B1 tense selection, not the B2 construction (`grammar-point-mismatch`).
2. TR A1 vocab cells (transport-places 3/8, home-objects 2/6 today) keep flagging on definition ambiguity: any natural definition of "station" fits *istasyon* and *gar* equally; "shops under one roof" fits *alışveriş merkezi* as well as *mağaza*. `VocabRecallContent` has **no** `acceptableAnswers` field, so the generator has no escape valve and the validator's rule ("the prompt must pick out exactly one headword") has no enumeration alternative. This is the "acceptableAnswers for ambiguous nouns" follow-up from the 2026-07-14 vocab work.

## Fix 1 — form-contrast cloze rule (generation + validation)

**Approach chosen:** a prose rule in both prompt templates, following the precedent of the
existing point-conditioned rules (TR case clozes, TR possessive clozes). Alternatives
considered and rejected:

- `clozeUnsuitable: true` on the point — kills the cloze cell outright. The validator's
  own notes show tight contexts CAN force one reading ("Seguían ___ cuando llegué" →
  gerund; "Los vi ___ y luego marcharse" → infinitive), so suppression is premature.
  Kept as the documented fallback if yield does not recover.
- A new `GrammarPoint` flag (à la `selfRevealingElicitation`) — heavier schema ripple for
  one point; the prose rule generalises to future contrast points without schema change.

**Generation template** (`GENERATION_SYSTEM_PROMPT_TEMPLATE`, cloze rules section):
new **Form-contrast clozes** rule:

- When the grammar point itself CONTRASTS two forms with different meanings (e.g. ES
  perception verbs: infinitive = completed event vs. gerund = action caught in progress),
  the alternants are NOT interchangeable near-synonyms. Do NOT resolve ambiguity by
  enumerating both in `acceptableAnswers` — the sentence context MUST force exactly one
  of the contrasting forms, and the other contrasting form must NOT appear in
  `acceptableAnswers`.
- The blank MUST sit on the contrast slot (the infinitive/gerund), never on the
  conjugated perception verb — blanking `vi/veía` tests tense selection, not the point.
- Carve-outs added to the two generic rules this collides with ("Ambiguous blank" option
  (b) and "One correct fill, or enumerate them"): enumeration cures ambiguity only for
  near-synonymous alternants (same meaning, e.g. `koşa koşa`/`koşarak`), never for
  meaning-bearing contrast pairs.

**Validation template** (mirror, per the generate↔validate contract-split rule): the
`ambiguous` dimension gets the same exception — for a contrast point, a draft listing
both contrasting forms in `acceptableAnswers` IS ambiguous (codifies what the validator
already does in practice), and a context-forced single-form draft with no enumeration is
GOOD. Blank-on-the-wrong-slot stays `grammarPointMatch: false`.

**Versions:** `GENERATION_PROMPT_VERSION` → `generate@2026-07-16`,
`VALIDATION_PROMPT_VERSION` → `validate@2026-07-16`.

**Curriculum:** `CURRICULUM_VERSION_ES` → `2026-07-16a` — the cell approved 2 (<3) today,
so it is low-yield-suppressed and a prompt-only fix would never re-run it.

## Fix 2 — `acceptableAnswers` on vocab_recall

**Approach chosen:** add the same optional enumeration field cloze already has, end to
end. Alternative rejected: per-point curated word lists in the curriculum (heavier, and
the ambiguity is a property of individual definitions, not of the umbrella point).

- `packages/shared/src/index.ts` — `VocabRecallContent.acceptableAnswers?: string[]`
  (mirrors the cloze field: every additional headword the definition equally picks out;
  `expectedWord` not auto-included).
- `packages/shared/src/fluency.ts` — vocab branch of `gradeFluencyAnswer` accepts
  `expectedWord` + `acceptableAnswers` (same shape as the cloze branch).
- `packages/ai/src/generate.ts` — `VOCAB_RECALL_GENERATION_TOOL` gains optional
  `acceptableAnswers` (array of canonical headword forms); the vocab draft parser
  passes it through with the same normalisation as `expectedWord`.
- Generation template, vocab rules: prefer tightening the definition so exactly one
  headword fits; when the target language has true near-synonyms that any natural
  definition admits equally (TR *istasyon*/*gar*, *alışveriş merkezi*/*çarşı*), set
  `expectedWord` to the most common one and enumerate every other defensible headword in
  `acceptableAnswers`. Hints must not disambiguate orthographically (anti-leak rule
  unchanged).
- Validation template: vocab `ambiguous` rule becomes "picks out exactly one headword,
  OR every equally-defensible near-synonym is enumerated in `acceptableAnswers`"; the
  per-draft vocab block renders the declared acceptable answers.
- Evaluator (`packages/ai/src/prompts.ts`): system prompt's vocab line accepts "the
  target word or any listed acceptable answer"; the per-answer vocab block renders
  `acceptableAnswers` like the cloze block does. `EVALUATION_SYSTEM_PROMPT_VERSION`
  bumped.
- `CURRICULUM_VERSION_TR` → `2026-07-16a` — home-objects approved 2 (<3) today
  (suppressed).

Client side: `contentJson` is `z.unknown()` in api-client, so no schema ripple there.
UI display of alternates is out of scope (grading accepts them server-side).

## Out of scope

- TR copula translation failures (`tr-a2-past-copula`, `tr-b1-copula-ol`) — separate
  reference-anchoring/instruction-mismatch issues.
- Scheduler-level circuit-breaker and over-rare-A1-target pruning from the 07-14
  follow-up list.
- The "borrowed from English and sounds very similar" hint leak (one transport flag) —
  already covered by the existing anti-leak rule; not a rule gap.

## Testing / verification

1. Unit: fluency grader vocab-alternates case; generation tool-schema/parser round-trip;
   prompt-template tests (version bumps, byte-parity blocks) updated.
2. Full gate: `pnpm lint && pnpm typecheck && pnpm test` (with the known stale-dist
   cleanups if needed).
3. `pnpm eval:gen` A/B on the affected cells (baseline = pre-edit template via `file:`,
   candidate = repo) over a small hand-built cell dataset (perception-verbs cloze + the
   two TR vocab cells), `--drafts-per-cell 5`, capped via `--max-cost-usd`. Expect:
   approval rate up on perception-verbs; `ambiguous` flag share down on vocab cells.
4. Post-merge ops: `push-prompts` to prod + dev Langfuse (generation, validation,
   evaluation templates all drift); ~04:00 UTC scheduler re-runs the unsuppressed cells
   under the new curriculum versions — verify next-day yields.
