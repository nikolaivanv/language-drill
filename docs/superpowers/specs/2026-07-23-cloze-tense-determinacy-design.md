# Cloze tense-determinacy rule for finite-verb blanks

**Date:** 2026-07-23
**Status:** Approved design
**Branch:** `fix/cloze-tense-determinacy`

## Problem

A learner drilling `es-b1-influence-verbs-infinitive` (Dejar, permitir, hacer + infinitive)
was marked **wrong (20%)** for answering `deja` (present) on:

> El guardia de seguridad no nos ___ entrar al edificio sin identificación.

The stored `correctAnswer` was `dejó` (preterite). But the visible sentence carries **no
temporal anchor** — nothing forces past over present. `deja` (a standing/habitual rule:
"the guard doesn't let us in without ID") is at least as natural, arguably more so. The
evaluator's own feedback exposed the failure: it asserted *"the sentence describes a
specific past event"* — inventing context that is not in the text.

### Root cause is twofold

1. **Generation** emits tense-ambiguous stems — a finite-verb blank with no temporal
   anchor — but assigns a single non-present `correctAnswer`. With no time cue, the
   present (habitual/general) is the default reading, so the "correct" answer is arbitrary.

2. **Evaluator information asymmetry.** `buildClozeUserPrompt` (prompts.ts:128) feeds the
   evaluator strictly MORE than the learner sees — `correctAnswer`, `acceptableAnswers`,
   and `context` — and frames it as *"If it matches Correct Answer… score 1.0… Otherwise
   consider whether it is still valid."* That primes the model to defend the stored
   reference and rationalize why a divergent answer falls short. Nothing tells it to judge
   only on what the visible stem licenses. This is the same reference-anchoring failure
   class already seen in the translation evaluator.

### Scope of the problem (prod pool audit, 2026-07-23)

48 approved clozes on the point. ~24 test the influence verb (the rest blank the infinitive
complement — given as a `(lemma)` cue — or a clitic, neither tense-sensitive). Of the ~24:

- **~6 clear false-negative traps** — preterite target, no anchor, present natural or more so:
  - `El entrenador nos ___ correr diez kilómetros todos los días.` → `hizo`
    ("todos los días" is a *habitual* cue that actively fights the preterite — worst case)
  - `El portero no ___ entrar al mensajero sin identificación.` → `dejó` (same as the
    reported item)
  - `Los celos le ___ actuar de una manera muy extraña.` → `hicieron`
  - `La profesora nos ___ aprender la lección de memoria.` → `hizo`
  - `Las imágenes tan bonitas del documental me ___ llorar de emoción.` → `hicieron`
  - `Llevar tanto equipaje me ___ caminar muy despacio.` → `hizo`
- **~3 borderline** (bounded-span / deictic cue defensibly licenses preterite — treated as
  PASS): `durante toda la noche` → `hizo`; `en el momento más emocionante` → `hizo`;
  `por primera vez hoy` → `dejó`.
- **~9 well-anchored preterite (good)** — the anchor is IN the stem: `Cuando llegué tarde…`,
  `El viento era tan fuerte…`, `El bebé se despertó…`, `porque no estábamos autorizados`,
  `insistió en acompañarnos`, `No sé qué fue lo que…`. These are the model of correctness
  and MUST keep passing.

~25% clear-defect rate on the tense-bearing subset — systemic, not a one-off.

## Decisions made

- **Core rule: anchor forces one tense.** Each item keeps exactly ONE defensible answer —
  cleanest for the single-answer UI. (Rejected: "accept all licensed tenses at eval time",
  which leaves the UI showing an arbitrary reference and can confuse a learner who typed a
  valid alternative.)
- **General determinacy rule, not a causative-only carve-out.** The same trap exists
  wherever a cloze blanks a finite verb whose tense isn't the drilled feature (ser/estar,
  por/para, relative-clause points, …). The rule is stated as a principle over all cloze.
- **No evaluator change this pass.** Fixing generation + validation, plus a pool re-pass,
  resolves the observed failure. The evaluator anti-anchoring rule is noted as future
  defense-in-depth but is explicitly OUT of scope here.
- **Existing pool: revalidate-CLI sweep**, not hand-patching the 6.
- **Borderline-3 treated as PASS.**

## The rule

> A cloze must admit exactly one correct answer given ONLY the visible sentence. When the
> blank is a **finite verb** and tense/aspect is **not** the feature this grammar point
> drills, the stem MUST contain a temporal cue that forces the tense. Absent any cue, the
> verb MUST be present/habitual (the default reading of a generic statement). Never rely on
> unstated narrative context.

**Cure is anchor-or-present, NOT enumeration.** Listing `deja, dejó` in `acceptableAnswers`
would teach the learner they are interchangeable (they are not) — this parallels the
existing Form-contrast rule (generation-prompts.ts:412), which forbids enumerating
contrasting alternants. So this mirrors the ambiguous-lexeme cure: *constrain the sentence*,
don't enumerate.

**Anchors that force PAST:** a preterite/imperfect/pluperfect verb elsewhere in the stem
(`llegué`, `era`, `habíamos logrado`) or an explicit past adverbial (`ayer`, `anoche`,
`esa noche`, `la semana pasada`).

**Cues that force PRESENT/HABITUAL and therefore FORBID preterite:** `siempre`,
`cada vez que`, `todos los días`, `por las noches`. The rule must name these — a habitual
adverbial paired with a preterite target (`todos los días … hizo`) is a live offender.

**Over-correction guard:** the rule must NOT flag well-anchored preterite items (they carry
an in-stem anchor) nor legitimate present/habitual items. Verified by the eval below.

## Implementation

### 1. Generation prompt (`packages/ai/src/generation-prompts.ts`)

- Add a new bullet after "One correct fill, or enumerate them" (~line 411) stating the
  tense-determinacy rule, the anchor-or-present cure (not enumeration), the past-forcing
  anchors, and the habitual cues that forbid preterite.
- Add a short clause to the "Ambiguous blank" rule (~line 397) naming *same-lexeme,
  different-tense* as a form of ambiguity (the existing text only covers different lexemes).
- Bump `GENERATION_PROMPT_VERSION` → `generate@2026-07-23`.

### 2. Validation prompt (`packages/ai/src/validation-prompts.ts`)

- Extend the `ambiguous` dimension (~line 144): a finite-verb blank in a non-present tense
  with no in-stem temporal anchor is `ambiguous` (same lexeme, ≥2 defensible tenses), and is
  **not** curable by enumeration — the cure is anchor-or-present. Mirror the past-forcing /
  habitual-cue lists so validator and generator share one contract.
- Bump `VALIDATION_PROMPT_VERSION` → `validate@2026-07-23`.

> Contract-split note: a generation fix is nullified if the validator still rejects the new
> shape (or fails to reject the old one). Both prompts must state the same rule and both
> versions bump in the same commit.

### 3. Tests

- `generation-prompts.test.ts` / `validation-prompts.test.ts`: assert the new rule text is
  present and the version constants bumped (existing tests are string-presence + structural).
- Full `pnpm lint && pnpm typecheck && pnpm test` green before push.

### 4. Verification — `eval:gen` A/B (before merge)

Langfuse convergence takes ~2 days, so A/B locally instead:
1. Build a fixture dataset from the audit: the 6 known traps (expect → now rejected,
   `ambiguous`) + the 9 well-anchored good items (expect → still approved) + the 3
   borderline (expect → approved).
2. `pnpm eval:gen --baseline repo --candidate file:<edited generation prompt>` over that
   dataset; confirm approval-rate holds on good/borderline items and the traps flip to
   rejected with an `ambiguous` reason. This directly measures over-correction.

### 5. Langfuse sync (post-merge, per CLAUDE.md prompt-editing protocol)

Editing the in-repo constant is not enough — the runtime fetches the body from Langfuse.
After merge, from a FRESH main checkout (stale-worktree push reverts unrelated prompts):
`push-prompts --dry-run` then `push-prompts` for prod AND dev; confirm with
`bootstrap-prompts --check` (exit 0).

### 6. Existing-pool re-pass (post-sync)

`pnpm revalidate:cloze --language es --cefr B1 --apply` scoped to the point re-scores every
stored cloze through the new validator and demotes failures. Expected: the ~6 traps demote;
the 9 good + 3 borderline survive. Nightly regen refills under the new generation rule.
Small single-point ES-B1 deficit — no water-fill starvation risk.

## Out of scope

- Evaluator anti-anchoring rule (`buildClozeUserPrompt` / `EVALUATION_SYSTEM_PROMPT`) — a
  worthwhile future defense-in-depth, but the gen+validate fix plus pool re-pass resolves the
  observed failure without touching a hot, cross-cutting prompt.
- `acceptableAnswers` synonymy gaps (permitió↔dejó) — a separate, smaller defect; not this
  change.
