# Validator: alternative-filler enumeration + model upgrade

**Date:** 2026-08-11
**Status:** design approved, pending implementation
**Surfaces:** `packages/ai/src/validate.ts`, `packages/ai/src/validation-prompts.ts`, new `packages/ai/scripts/eval-validator-run.ts`

---

## Problem

Eight merged PRs (#606, #607, #611, #612, #614, #619, #625, #633) fixed defects that the
generation validator saw in full and approved at 0.85–0.9. The dominant family —
#611, #619, #633, and the pre-deterministic half of #625 — shares one shape:

> a single stored `correctAnswer`, plus a second filler that is equally valid on
> the visible stem and is not listed in `acceptableAnswers`.

The validator is asked a closed question — "is this ambiguous?" — and answers it
without searching. Finding the counterexample (`el menos` for `el más`, `dejaba`
for `deja`, `hacía` for `hace`) is the actual work, and nothing in the current
request creates a place for that work to happen: `tool_choice` is forced, there
is no thinking, and the tool's first emitted token is already a verdict field.

Each PR responded by adding a narrower rule to the `ambiguous` dimension. That
approach does not generalise — it patches one frame at a time, and
`VALIDATION_SYSTEM_PROMPT_TEMPLATE` is now 12,885 characters against a 13,000
test ceiling. There are 115 characters left. The next frame-specific rule does
not fit.

## Goals

1. Make the validator **enumerate and adjudicate candidate fillers before**
   committing to `ambiguous`, so the search is structural rather than requested.
2. Raise validator capability, where the marginal cost is near zero.
3. Measure both changes against a labelled set before merge.

## Non-goals

- Changing the generator. This is validator-side only.
- Any exercise type other than `cloze` (see Scope).
- A blind-solver pre-pass (a second call that hides `correctAnswer`). That is the
  stronger long-term mechanism and the natural follow-up, but it doubles
  validation calls and is out of scope here.
- Hard-enforcing the self-consistency rule in routing (see Component 4).

## Scope

**Cloze only.** All four defects in the target family are cloze. Confining the
change keeps attribution clean and — critically — keeps it away from
`sentence_construction`, where multiple valid answers *are* the task design and
where #606 has only just brought `ambiguous` down from 81% of flagged drafts.

---

## Design

### Component 1 — `candidateFillers`, a required first tool field

`VALIDATION_TOOL` becomes `buildValidationTool(exerciseType)`. For
`ExerciseType.CLOZE` only, the returned schema gains `candidateFillers` as its
**first** property, listed first in `required`:

```ts
candidateFillers: {
  type: "array",
  description:
    "Fill this FIRST, before any other field. List 2-4 distinct fillers a " +
    "competent speaker might write in the blank — including `correctAnswer` " +
    "itself — and adjudicate each against the VISIBLE sentence alone. This is " +
    "your working-out for `ambiguous`, not a verdict.",
  items: {
    type: "object",
    properties: {
      filler: { type: "string", description: "The candidate fill." },
      verdict: {
        type: "string",
        enum: ["also-correct", "ruled-out"],
        description:
          "`also-correct`: fully correct on the visible sentence and satisfies " +
          "the grammar point. `ruled-out`: something in the visible sentence " +
          "forbids it.",
      },
      reason: {
        type: "string",
        description:
          "For `ruled-out`, quote the span of the visible sentence that " +
          "forbids it. For `also-correct`, one clause on why it fits.",
      },
    },
    required: ["filler", "verdict", "reason"],
  },
}
```

Ordering is the mechanism. The model writes its candidate search before it writes
`ambiguous`, so the verdict is conditioned on the search rather than replacing it.
Direct precedent: `evaluate.ts` requires a `reasoning` scratchpad as the first
tool field, and raised `MAX_TOKENS` 1024 → 2048 so the forced tool call cannot
truncate mid-JSON.

Requiring `reason` to **quote the visible span** for a `ruled-out` verdict is what
stops cheap dismissals. `El examen fue ___ difícil de todos` cannot produce a
quotable span that forbids `el menos`, because none exists — which is exactly the
#633 defect, surfaced rather than reasoned past.

Building per type rather than extending the shared const is deliberate:
`sentence_construction` must never be handed an enumerate-alternatives field.

### Component 2 — system-prompt instruction

Replace the opening of the `ambiguous` dimension's cloze clause with a pointer to
the new field, and delete nothing else — the #611/#619/#633 sub-bullets stay, now
serving as worked examples of what a `also-correct` verdict looks like rather than
as the sole detection mechanism.

New text (~600 chars) on dimension 2:

> **For cloze, fill `candidateFillers` before deciding this field.** Propose 2–4
> distinct fillers a competent speaker might write — same-lexeme tense variants,
> opposite-polarity alternants, and different lexemes that fit the frame — and
> adjudicate each against the visible sentence alone, never against
> `correctAnswer`. A filler is `ruled-out` only when you can quote the span of the
> visible sentence that forbids it; "it is not the intended answer" is not a
> ruling. Then set `ambiguous = true` if any filler you marked `also-correct` is
> absent from `acceptableAnswers`.

Budget: the template is currently **12,885 characters against a 13,000 ceiling**
(`validation-prompts.test.ts:266`) — 115 characters of headroom. The ceiling raise
is mandatory, not incidental: the new text does not fit without it. Raise to
14,500, which leaves ~1 KB for the next edit.

### Component 3 — model and request shaping

`VALIDATION_MODEL`: `claude-sonnet-4-6` → `claude-sonnet-5`.

Sonnet 5 changes the request surface, and `evaluate.ts:399-443` already carries
the working pattern to port:

| Change | Why |
|---|---|
| Omit `temperature` | Sonnet 5 rejects non-default sampling params; `temperature: 0` returns 400. Keep `VALIDATION_TEMPERATURE` exported and applied only on models that accept it, matching `evaluate.ts`'s `rejectsSamplingParams` guard. |
| Send explicit `thinking: {type: "disabled"}` | Sonnet 5 runs **adaptive** thinking when `thinking` is omitted. Without this the change silently becomes a thinking change too, confounding the measurement and putting thinking spend against `max_tokens`. |
| `VALIDATION_MAX_TOKENS` 1024 → 2048 | `candidateFillers` adds ~150–250 output tokens; 1024 risks truncating the forced tool call. Mirrors `evaluate.ts`'s bump for the same reason. |

Cost is roughly neutral: same $3/$15 list price, currently $2/$10 intro through
2026-08-31. The 1024-token prompt-cache minimum is unchanged, so the cached
system block keeps hitting.

`validate.test.ts:89-98` pins a three-way `VALIDATION_MODEL === GENERATION_MODEL
=== "claude-sonnet-4-6"` invariant. Replace it with an explicit
decoupling test asserting `VALIDATION_MODEL === "claude-sonnet-5"` and
`!== GENERATION_MODEL`, with a comment giving the reason: a validator miss ships
a defect to learners and costs a demote-plus-backfill repass, whereas a generator
miss wastes one draft. `theory-generate.test.ts:219` is the precedent for a
deliberately-decoupled model pin.

### Component 4 — self-consistency metric, report-only

`candidateFillers` makes `ambiguous` derivable: if any filler is marked
`also-correct` and is not in `acceptableAnswers`, then `ambiguous: false` is
self-contradictory.

Compute that predicate in `validate.ts` and, on mismatch, append a
`'validator-self-inconsistent'` entry to `flaggedReasons`. **Do not** override
`ambiguous` and do not change routing. Enforcement waits until the harness shows
the enumeration is trustworthy; flipping verdicts on day one is how #606's
over-flagging happened.

### Component 5 — labelled replay harness

New `packages/ai/scripts/eval-validator-run.ts` plus a committed fixture
`packages/ai/scripts/fixtures/validator-ambiguity-cases.json`. Validation-only —
no generation, no DB, no prod access. Precedent: `pnpm eval:seed` already curates
failure cases into a committed fixture.

Each fixture entry is a self-contained `{ contentJson, spec-fields, label,
provenance }`, where `label` is `ambiguous` or `clean`:

| Bucket | Source | Approx n |
|---|---|---|
| `ambiguous` | The rows named in #633 (`ba31a2cc`, `bea095af`, `a74cce3a`), #611 (the anchorless-preterite family), #619 (`9ffc33c1`, the `por las noches` case), #625 (the zero-article and multi-word overlap rows) | ~20 |
| `clean` | The well-formed exemplars the same PRs name: #633's two anchored superlatives, #611's ~9 well-anchored preterites plus 3 borderline items, #612's four over-accept controls | ~20 |

The `clean` bucket is load-bearing. It is the only thing that catches an
over-flagging regression, which is the specific way this class of change has
failed before.

`validateDraft` gains an options bag mirroring `evaluateAnswer`'s
(`modelOverride`, `systemPromptOverride`) so the harness can run arms without
touching production defaults.

Arms are a 2×2 so prompt and model are never confounded:

| Arm | Prompt | Model |
|---|---|---|
| baseline | repo @ HEAD~ | sonnet-4-6 |
| prompt-only | new | sonnet-4-6 |
| model-only | repo @ HEAD~ | sonnet-5 |
| both | new | sonnet-5 |

Output to `./eval-runs/validator-<runName>.json`: per-arm recall on `ambiguous`,
false-flag rate on `clean`, the self-consistency mismatch rate from Component 4,
and cost. Supports `--limit`, `--max-cost-usd`, `--dry-run` — matching the other
`packages/ai` CLIs.

**Merge criterion:** the `both` arm must strictly beat baseline on recall over the
`ambiguous` bucket while not increasing the false-flag rate on `clean`. A recall
gain bought with a false-flag increase is a #606 repeat and does not ship.

---

## Data flow

```
fixture case ──> validateDraft(draft, spec, {modelOverride, systemPromptOverride})
                     │
                     ├─ buildValidationTool(CLOZE)  ── candidateFillers first
                     ├─ buildValidationSystemPrompt(spec)  ── Langfuse or fallback
                     └─ messages.create(no temperature, thinking: disabled)
                                │
                     parseValidationResult
                        ├─ candidateFillers ── lenient coerce, never throws
                        └─ self-consistency check ──> flaggedReasons (report-only)
                                │
                     harness ──> recall / false-flag / mismatch-rate / cost
```

Production routing through `routeValidationResult` is unchanged. `candidateFillers`
is not persisted to `exercises` in this change; it reaches Langfuse traces via the
normal tool-input capture, which is sufficient for triage.

## Error handling

`candidateFillers` is **non-load-bearing** and follows the existing
`coerceStringArray` / `coerceCoverage` contract in `validate.ts:267-290`: a
missing, non-array, or malformed value coerces to `[]` and never throws. A
malformed scratchpad must never veto a draft — that is the exact failure that
killed `tr-a1-cloze-personal-suffixes` on 2026-05-24 and drove the R8 lenient-parse
split. Entries missing `filler`/`verdict` are dropped individually; an unknown
`verdict` string drops that entry.

With `candidateFillers` empty for any reason, the self-consistency check in
Component 4 is skipped and behaviour is identical to today.

## Testing

- `validate.test.ts` — `buildValidationTool(CLOZE)` emits `candidateFillers` first
  in both `properties` and `required`; `buildValidationTool(SENTENCE_CONSTRUCTION)`
  omits it entirely; the model pin and decoupling assertion; the request omits
  `temperature` and sends `thinking: disabled`; `MAX_TOKENS` is 2048.
- `validate.test.ts` — `parseValidationResult` leniency: missing / non-array /
  malformed-entry / unknown-verdict cases all coerce without throwing.
- `validate.test.ts` — self-consistency check fires on an unlisted `also-correct`
  filler, stays silent when it is in `acceptableAnswers`, and never mutates
  `ambiguous`.
- `validation-prompts.test.ts` — new pinned phrases on dimension 2, the raised
  14,500 ceiling, the bumped version in both pin locations (lines 193 and 920),
  and the existing `VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity` block still
  passing.
- `eval-validator-run.test.ts` — fixture shape validation, arm construction, and
  metric arithmetic against a mocked `validateDraft`.
- Full gate before push: `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## Rollout

1. Merge. `VALIDATION_PROMPT_VERSION` bumps to the commit date; the current value
   already claims `validate@2026-08-11`, so a same-day commit uses
   `validate@2026-08-11a` (the `2026-07-08a` changelog entry is the precedent).
2. **Langfuse push required.** This edits the registered `validate-system-prompt`
   template body, so the runtime keeps serving the old prompt until synced. Run
   `push-prompts` for prod and dev per `docs/runbooks/prompt-update-and-revalidate.md`,
   from fresh `main` — never a stale worktree.
3. The model change is *not* a prompt-body edit; Langfuse records the model
   natively per generation, so it needs no version bump of its own (same
   convention `evaluate.ts:305-307` documents).
4. No pool repass in this change. Generation is paused, and a repass on a
   just-changed validator should wait for the first live generation run's flag
   rates.

## Risks

| Risk | Mitigation |
|---|---|
| Over-flagging — the #606 failure mode | The `clean` bucket is a merge gate, not a nice-to-have. Self-consistency is report-only. |
| The model enumerates junk fillers to satisfy the schema | `ruled-out` requires a quoted visible span; the harness reports the mismatch rate so junk enumeration is visible rather than silent. |
| Prompt-cache invalidation | Tools render before system in the cache prefix, so the schema change invalidates once, on deploy. No steady-state cost. |
| Sonnet 5 + forced `tool_choice` | Already in production on this exact shape via `evaluate.ts` since 2026-07-05. |
| Reverting | Two constants (`VALIDATION_MODEL`, `VALIDATION_PROMPT_VERSION`) plus re-pointing the Langfuse `production` label at the prior version, which `push-prompts` logs. |

## Follow-ups (not in this change)

- **Blind-solver pre-pass** — hide `correctAnswer` and ask a fresh call to fill the
  stem. Information asymmetry beats self-review; this is the stronger mechanism.
- **Enforce the self-consistency rule** in `routeValidationResult` once the
  mismatch rate is understood.
- **Extend to `translation` and `vocab_recall`**, which carry `acceptableAnswers`
  for the same reason (#600, #595).
- **Persist `candidateFillers`** if trace-only triage proves insufficient.
